import { describe, expect, it, vi } from "vitest";
import {
  classifyParameterProposal,
  decodeParameterProposal,
  enumerateParameterProposals,
  formatParameterValue,
  MINING_FEE_REVIEW_SECONDS,
  parameterProposalCount,
  readParameterSnapshot,
  type ParameterProposal,
} from "../src/features/governance/parameterProposals";

const proposal: ParameterProposal = {
  valid: true, createdAt: 100n, extraDelay: 20n,
  votesFor: 50n, votesAgainst: 0n, value: 43200n,
};

describe("Mining fee, voting cost, and enforcement delay reads", () => {
  it("decodes the different Basic and Farms tuple orders without losing bigint precision", () => {
    const amount = 90071992547409930000001n;
    expect(decodeParameterProposal("fees", [false, 101n, 1n, amount, 401n, 501n, 601n])).toEqual({
      valid: false, createdAt: 101n, feeType: 1n, value: amount,
      votesFor: 401n, votesAgainst: 501n, extraDelay: 601n,
    });
    expect(decodeParameterProposal("votecost", [true, 101n, 201n, 301n, 401n, amount])).toEqual({
      valid: true, createdAt: 101n, votesFor: 201n, votesAgainst: 301n, extraDelay: 401n, value: amount,
    });
    expect(() => decodeParameterProposal("delay", [true, 101n, 201n])).toThrow();
    expect(() => decodeParameterProposal("fees", [true, 101n, 1n, -1n, 0n, 0n, 0n])).toThrow();
  });

  it("selects deployed four-count positions and refuses unsupported ranges", () => {
    const counts = [3n, 7n, 11n, 13n];
    expect(parameterProposalCount("votecost", counts)).toBe(3n);
    expect(parameterProposalCount("fees", counts)).toBe(7n);
    expect(parameterProposalCount("delay", counts)).toBe(11n);
    expect(() => parameterProposalCount("delay", [...counts, 0n, 0n])).toThrow();
    expect(() => parameterProposalCount("fees", [0n, 501n, 0n, 0n])).toThrow();
    expect(() => parameterProposalCount("fees", [0n, -1n, 0n, 0n])).toThrow();
  });

  it("keeps strict Basic veto boundaries and inclusive Farms veto boundaries", () => {
    const rejected = { ...proposal, votesAgainst: 51n };
    expect(classifyParameterProposal("fees", rejected, 100n, 119n)).toBe("voting");
    expect(classifyParameterProposal("fees", rejected, 100n, 120n)).toBe("vetoable");
    for (const module of ["votecost", "delay"] as const) {
      expect(classifyParameterProposal(module, rejected, 100n, 120n)).toBe("voting");
      expect(classifyParameterProposal(module, rejected, 100n, 121n)).toBe("vetoable");
      expect(classifyParameterProposal(module, proposal, 100n, 219n)).toBe("voting");
      expect(classifyParameterProposal(module, proposal, 100n, 220n)).toBe("settling");
      expect(classifyParameterProposal(module, proposal, 100n, 221n)).toBe("review-complete");
      expect(classifyParameterProposal(module, { ...rejected, valid: false }, 100n, 221n)).toBe("finished");
    }
  });

  it("uses a fixed seven-day fee review and does not confuse a tied vote with rejection", () => {
    const tied = { ...proposal, votesAgainst: proposal.votesFor };
    const feeEnd = 120n + MINING_FEE_REVIEW_SECONDS;
    expect(classifyParameterProposal("fees", tied, 43200n, 120n + 43201n)).toBe("voting");
    expect(classifyParameterProposal("fees", tied, 43200n, feeEnd)).toBe("settling");
    expect(classifyParameterProposal("fees", tied, 43200n, feeEnd + 1n)).toBe("review-complete");
    // Historical 12-hour values are displayed even though creation has a newer minimum.
    expect(classifyParameterProposal("delay", { ...proposal, valid: false }, 43200n, feeEnd)).toBe("finished");
  });

  it("formats exact fee scales, credit decimals, and durations without rounding historical values", () => {
    expect(formatParameterValue("fees", { ...proposal, feeType: 0n, value: 125n })).toBe("1.25%");
    expect(formatParameterValue("fees", { ...proposal, feeType: 1n, value: 125n })).toBe("0.0125%/hour");
    expect(formatParameterValue("fees", { ...proposal, feeType: 2n, value: 125n })).toBe("1.25%");
    expect(formatParameterValue("fees", { ...proposal, feeType: 3n, value: 125n })).toContain("raw units");
    expect(formatParameterValue("votecost", { ...proposal, value: 1234567890123456789012n })).toBe("1,234.567890123456789012 DEGEN");
    expect(formatParameterValue("delay", proposal)).toBe("12 hours");
    expect(formatParameterValue("delay", { ...proposal, value: 3600n })).toBe("1 hour");
    expect(formatParameterValue("delay", { ...proposal, value: 3601n })).toBe("3,601 seconds");
  });

  it("enumerates every ID with bounded concurrency and preserves individual failed reads", async () => {
    let active = 0;
    let peak = 0;
    const rows = await enumerateParameterProposals(14n, async id => {
      active += 1;
      peak = Math.max(peak, active);
      await Promise.resolve();
      active -= 1;
      if (id === 7n) throw new Error("RPC unavailable");
      return { ...proposal, value: id };
    });
    expect(rows.map(row => row.id)).toEqual(Array.from({ length: 14 }, (_, i) => String(i)));
    expect(rows[7]).toMatchObject({ id: "7", status: "error" });
    expect(rows[8]).toMatchObject({ id: "8", status: "verified", proposal: { value: 8n } });
    expect(peak).toBeLessThanOrEqual(6);
    expect(peak).toBeGreaterThan(1);
    const read = vi.fn(async () => proposal);
    expect(await enumerateParameterProposals(0n, read)).toEqual([]);
    await expect(enumerateParameterProposals(501n, read)).rejects.toThrow();
    await expect(enumerateParameterProposals(-1n, read)).rejects.toThrow();
    expect(read).not.toHaveBeenCalled();
  });

  it("pins counts, current settings, and every proposal to the same block", async () => {
    const readProposal = vi.fn(async () => [true, 100n, 50n, 0n, 20n, 43200n]);
    const reader = {
      latestBlock: vi.fn(async () => ({ number: 42, timestamp: 43210 })),
      counts: vi.fn(async () => [0n, 15n, 2n, 3n]),
      baseDelay: vi.fn(async () => 43200n),
      costToVote: vi.fn(async () => 10n ** 18n),
      proposal: readProposal,
    };
    const snapshot = await readParameterSnapshot("delay", reader);
    expect(snapshot).toMatchObject({ block: 42, timestamp: 43210n, baseDelay: 43200n, costToVote: 10n ** 18n });
    expect(snapshot.rows).toHaveLength(2);
    expect(reader.counts).toHaveBeenCalledWith(42);
    expect(reader.baseDelay).toHaveBeenCalledWith(42);
    expect(reader.costToVote).toHaveBeenCalledWith(42);
    expect(readProposal.mock.calls).toEqual([[0n, 42], [1n, 42]]);
    await expect(readParameterSnapshot("delay", { ...reader, latestBlock: async () => null })).rejects.toThrow("block unavailable");
  });
});
