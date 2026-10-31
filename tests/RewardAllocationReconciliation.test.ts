import { describe, expect, it, vi } from "vitest";
import {
  classifyRewardAllocationProposal,
  formatAllocationPercent,
  reconcileRewardAllocationCandidates,
  type RewardAllocationProposal,
} from "../src/features/governance/rewardAllocation";

const proposal = (
  overrides: Partial<RewardAllocationProposal> = {},
): RewardAllocationProposal => ({
  valid: true,
  poolId: 15n,
  newAllocation: 300n,
  votesFor: 2n * 10n ** 18n,
  votesAgainst: 0n,
  extraDelay: 20n,
  createdAt: 1_000n,
  ...overrides,
});

describe("Reward Allocation on-chain reconciliation", () => {
  it("classifies the contract lifecycle at every timing boundary", () => {
    expect(
      classifyRewardAllocationProposal(
        proposal({ valid: false }),
        100n,
        1_050,
      ).lifecycle,
    ).toBe("finished");
    expect(
      classifyRewardAllocationProposal(proposal(), 100n, 1_100).lifecycle,
    ).toBe("voting");
    expect(
      classifyRewardAllocationProposal(
        proposal({ votesAgainst: 3n * 10n ** 18n }),
        100n,
        1_050,
      ).lifecycle,
    ).toBe("vetoable");
    expect(
      classifyRewardAllocationProposal(proposal(), 100n, 1_120).lifecycle,
    ).toBe("settling");
    expect(
      classifyRewardAllocationProposal(proposal(), 100n, 1_121).lifecycle,
    ).toBe("enforceable");
  });

  it("rejects malformed/out-of-range IDs and isolates individual RPC failures", async () => {
    const readProposal = vi.fn(async (id: bigint) => {
      if (id === 2n) throw new Error("RPC failure");
      return proposal();
    });

    const result = await reconcileRewardAllocationCandidates({
      proposalIds: ["1", "1", "bad", "4", "2"],
      proposalCount: 4n,
      baseDelay: 100n,
      blockTimestamp: 1_100,
      readProposal,
    });

    expect(result["1"].status).toBe("verified");
    expect(result.bad).toEqual({
      status: "error",
      message: "Invalid proposal ID from legacy API",
    });
    expect(result["4"]).toEqual({
      status: "error",
      message: "Proposal ID is outside the on-chain range",
    });
    expect(result["2"]).toEqual({
      status: "error",
      message: "PulseChain proposal read failed",
    });
    expect(readProposal).toHaveBeenCalledTimes(2);
  });

  it("formats the contract's hundredths-of-a-percent allocation units", () => {
    expect(formatAllocationPercent(300n)).toBe("3%");
    expect(formatAllocationPercent(15n)).toBe("0.15%");
    expect(formatAllocationPercent(1n)).toBe("0.01%");
  });
});
