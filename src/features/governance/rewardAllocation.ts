import { GOVERNANCE_ADDRESSES } from "./governanceSpec";
export const FARMS_CONTRACT = GOVERNANCE_ADDRESSES.farms;

export const REWARD_ALLOCATION_READ_ABI = [
  "function proposalLengths() view returns (uint256 farmCount, uint256 vaultCount, uint256 governorTransferCount, uint256 taxCount)",
  "function proposalFarmUpdate(uint256 proposalId) view returns (bool valid, uint256 poolid, uint256 newAllocation, uint256 valueSacrificedForVote, uint256 valueSacrificedAgainst, uint256 delay, uint256 firstCallTimestamp, uint16 newDepositFee)",
] as const;

export type RewardAllocationProposal = {
  valid: boolean;
  poolId: bigint;
  newAllocation: bigint;
  votesFor: bigint;
  votesAgainst: bigint;
  extraDelay: bigint;
  createdAt: bigint;
};

export type RewardAllocationLifecycle =
  | "finished"
  | "voting"
  | "vetoable"
  | "settling"
  | "enforceable";

export type VerifiedRewardAllocation = {
  status: "verified";
  proposal: RewardAllocationProposal;
  lifecycle: RewardAllocationLifecycle;
  reviewEndsAt: number;
  observedAt: number;
};

export type RewardAllocationReconciliation =
  | VerifiedRewardAllocation
  | { status: "error"; message: string };

export type RewardAllocationContractResult = readonly [
  boolean,
  bigint,
  bigint,
  bigint,
  bigint,
  bigint,
  bigint,
  bigint,
] & {
  valid?: boolean;
  poolid?: bigint;
  newAllocation?: bigint;
  valueSacrificedForVote?: bigint;
  valueSacrificedAgainst?: bigint;
  delay?: bigint;
  firstCallTimestamp?: bigint;
};

export function decodeRewardAllocationProposal(
  result: RewardAllocationContractResult,
): RewardAllocationProposal {
  return {
    valid: result.valid ?? result[0],
    poolId: result.poolid ?? result[1],
    newAllocation: result.newAllocation ?? result[2],
    votesFor: result.valueSacrificedForVote ?? result[3],
    votesAgainst: result.valueSacrificedAgainst ?? result[4],
    extraDelay: result.delay ?? result[5],
    createdAt: result.firstCallTimestamp ?? result[6],
  };
}

export function classifyRewardAllocationProposal(
  proposal: RewardAllocationProposal,
  baseDelay: bigint,
  blockTimestamp: number,
): { lifecycle: RewardAllocationLifecycle; reviewEndsAt: number } {
  const reviewEndsAt = Number(
    proposal.createdAt + proposal.extraDelay + baseDelay,
  );
  if (!proposal.valid) return { lifecycle: "finished", reviewEndsAt };

  const vetoStartsAt = Number(proposal.createdAt + proposal.extraDelay);
  if (
    blockTimestamp >= vetoStartsAt &&
    proposal.votesAgainst > proposal.votesFor
  ) {
    return { lifecycle: "vetoable", reviewEndsAt };
  }
  if (blockTimestamp < reviewEndsAt) {
    return { lifecycle: "voting", reviewEndsAt };
  }
  // Voting closes at exactly reviewEndsAt, while updateFarm requires the
  // timestamp to be strictly greater. Model that one-second boundary instead
  // of claiming the proposal can already be enforced.
  if (blockTimestamp === reviewEndsAt) {
    return { lifecycle: "settling", reviewEndsAt };
  }
  return { lifecycle: "enforceable", reviewEndsAt };
}

type ReconcileCandidatesInput = {
  proposalIds: string[];
  proposalCount: bigint;
  baseDelay: bigint;
  blockTimestamp: number;
  readProposal: (proposalId: bigint) => Promise<RewardAllocationProposal>;
};

export async function reconcileRewardAllocationCandidates({
  proposalIds,
  proposalCount,
  baseDelay,
  blockTimestamp,
  readProposal,
}: ReconcileCandidatesInput): Promise<
  Record<string, RewardAllocationReconciliation>
> {
  const uniqueIds = [...new Set(proposalIds)];
  const entries = await Promise.all(
    uniqueIds.map(async (proposalId) => {
      if (!/^\d+$/.test(proposalId)) {
        return [
          proposalId,
          { status: "error", message: "Invalid proposal ID from legacy API" },
        ] as const;
      }

      const numericId = BigInt(proposalId);
      if (numericId >= proposalCount) {
        return [
          proposalId,
          { status: "error", message: "Proposal ID is outside the on-chain range" },
        ] as const;
      }

      try {
        const proposal = await readProposal(numericId);
        const lifecycle = classifyRewardAllocationProposal(
          proposal,
          baseDelay,
          blockTimestamp,
        );
        return [
          proposalId,
          {
            status: "verified",
            proposal,
            lifecycle: lifecycle.lifecycle,
            reviewEndsAt: lifecycle.reviewEndsAt,
            observedAt: blockTimestamp,
          },
        ] as const;
      } catch {
        return [
          proposalId,
          { status: "error", message: "PulseChain proposal read failed" },
        ] as const;
      }
    }),
  );

  return Object.fromEntries(entries);
}

export function formatAllocationPercent(raw: bigint): string {
  const whole = raw / 100n;
  const fractional = (raw % 100n).toString().padStart(2, "0").replace(/0+$/, "");
  return `${whole}${fractional ? `.${fractional}` : ""}%`;
}
