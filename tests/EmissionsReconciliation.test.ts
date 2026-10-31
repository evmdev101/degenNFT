import { describe, expect, it, vi } from "vitest";
import {
  classifyEmissionsProposal,
  decodeEmissionsProposal,
  formatEmissionPerBlock,
  reconcileEmissionsCandidates,
  type EmissionsContractResult,
  type EmissionsProposal,
} from "../src/features/governance/emissions";

const proposal = (
  overrides: Partial<EmissionsProposal> = {},
): EmissionsProposal => ({
  valid: true,
  createdAt: 1_000n,
  proposedValue: 2_500_000n * 10n ** 18n,
  votesFor: 1_000n * 10n ** 18n,
  votesAgainst: 0n,
  extraDelay: 20n,
  isEmissions: true,
  startsAt: 0n,
  ...overrides,
});

describe("Emissions on-chain reconciliation", () => {
  it("models voting, veto, settlement, scheduling, and enforcement boundaries", () => {
    expect(
      classifyEmissionsProposal(proposal({ valid: false }), 100n, 1_050)
        .lifecycle,
    ).toBe("finished");
    expect(classifyEmissionsProposal(proposal(), 100n, 1_019).lifecycle).toBe(
      "voting",
    );
    expect(
      classifyEmissionsProposal(
        proposal({ votesAgainst: 2_000n * 10n ** 18n }),
        100n,
        1_020,
      ).lifecycle,
    ).toBe("vetoable");
    expect(classifyEmissionsProposal(proposal(), 100n, 1_120).lifecycle).toBe(
      "settling",
    );
    expect(
      classifyEmissionsProposal(proposal({ startsAt: 1_200n }), 100n, 1_200)
        .lifecycle,
    ).toBe("scheduled");
    expect(
      classifyEmissionsProposal(proposal({ startsAt: 1_200n }), 100n, 1_201)
        .lifecycle,
    ).toBe("enforceable");
  });

  it("rejects malformed/out-of-range IDs and isolates individual RPC failures", async () => {
    const readProposal = vi.fn(async (id: bigint) => {
      if (id === 1n) throw new Error("RPC failure");
      return proposal();
    });

    const result = await reconcileEmissionsCandidates({
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

  it("decodes the deployed tuple and formats 18-decimal reward units", () => {
    const decoded = decodeEmissionsProposal(
      [
        false,
        1_000n,
        2_500_000n * 10n ** 18n,
        1_000n * 10n ** 18n,
        0n,
        20n,
        true,
        0n,
      ] as EmissionsContractResult,
    );

    expect(decoded.isEmissions).toBe(true);
    expect(formatEmissionPerBlock(decoded.proposedValue)).toBe(
      "2,500,000 DEGEN / block",
    );
    expect(formatEmissionPerBlock(15n * 10n ** 17n)).toBe(
      "1.5 DEGEN / block",
    );
  });

  it("blocks a Governor Transfer proposal belonging to the other subtype", async () => {
    const result = await reconcileEmissionsCandidates({
      proposalIds: ["0"],
      proposalCount: 1n,
      baseDelay: 100n,
      blockTimestamp: 1_121,
      readProposal: async () => proposal({ isEmissions: false }),
    });

    expect(result["0"]).toMatchObject({
      status: "verified",
      executionBlockedReason:
        "Governor Transfer subtype is not an emissions update",
    });
  });
});
