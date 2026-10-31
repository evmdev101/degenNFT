import { describe, expect, it, vi } from "vitest";
import {
  classifyRolloverBonusProposal,
  decodeRolloverBonusProposal,
  formatRolloverBonusPercent,
  reconcileRolloverBonusCandidates,
  rolloverPoolLabel,
  type RolloverBonusContractResult,
  type RolloverBonusProposal,
} from "../src/features/governance/rolloverBonus";

const proposal = (
  overrides: Partial<RolloverBonusProposal> = {},
): RolloverBonusProposal => ({
  valid: true,
  createdAt: 1_000n,
  votesFor: 2n * 10n ** 18n,
  votesAgainst: 0n,
  extraDelay: 20n,
  poolAddress: "0xD9B491ac0f5487673500B67224b67b4171a08aCa",
  newBonus: 50n,
  ...overrides,
});

describe("Roll-Over Bonus on-chain reconciliation", () => {
  it("matches the Basic Settings contract's strict lifecycle boundaries", () => {
    expect(
      classifyRolloverBonusProposal(
        proposal({ valid: false }),
        100n,
        1_050,
      ).lifecycle,
    ).toBe("finished");
    expect(
      classifyRolloverBonusProposal(
        proposal({ votesAgainst: 3n * 10n ** 18n }),
        100n,
        1_020,
      ).lifecycle,
    ).toBe("voting");
    expect(
      classifyRolloverBonusProposal(
        proposal({ votesAgainst: 3n * 10n ** 18n }),
        100n,
        1_021,
      ).lifecycle,
    ).toBe("vetoable");
    expect(
      classifyRolloverBonusProposal(proposal(), 100n, 1_120).lifecycle,
    ).toBe("settling");
    expect(
      classifyRolloverBonusProposal(proposal(), 100n, 1_121).lifecycle,
    ).toBe("enforceable");
  });

  it("rejects malformed/out-of-range IDs and isolates individual RPC failures", async () => {
    const readProposal = vi.fn(async (id: bigint) => {
      if (id === 1n) throw new Error("RPC failure");
      return proposal();
    });

    const result = await reconcileRolloverBonusCandidates({
      proposalIds: ["0", "0", "bad", "2", "1"],
      proposalCount: 2n,
      baseDelay: 100n,
      blockTimestamp: 1_100,
      readProposal,
    });

    expect(result["0"].status).toBe("verified");
    expect(result.bad).toEqual({
      status: "error",
      message: "Invalid proposal ID from legacy API",
    });
    expect(result["2"]).toEqual({
      status: "error",
      message: "Proposal ID is outside the on-chain range",
    });
    expect(result["1"]).toEqual({
      status: "error",
      message: "PulseChain proposal read failed",
    });
    expect(readProposal).toHaveBeenCalledTimes(2);
  });

  it("decodes the deployed tuple order and formats bonus units", () => {
    const decoded = decodeRolloverBonusProposal(
      [
        true,
        1_000n,
        10n,
        2n,
        20n,
        "0xD9B491ac0f5487673500B67224b67b4171a08aCa",
        1_000n,
      ] as RolloverBonusContractResult,
    );

    expect(decoded.poolAddress).toBe(
      "0xD9B491ac0f5487673500B67224b67b4171a08aCa",
    );
    expect(formatRolloverBonusPercent(decoded.newBonus)).toBe("10%");
    expect(formatRolloverBonusPercent(50n)).toBe("0.5%");
    expect(formatRolloverBonusPercent(1n)).toBe("0.01%");
    expect(rolloverPoolLabel(decoded.poolAddress)).toBe("1 Month Miner");
  });
});
