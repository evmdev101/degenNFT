import { GOVERNANCE_ADDRESSES } from "./governanceSpec";
export const EMISSIONS_FARMS_CONTRACT =
  GOVERNANCE_ADDRESSES.farms;

export const EMISSIONS_READ_ABI = [
  "function proposalLengths() view returns (uint256 farmCount, uint256 vaultCount, uint256 governorTransferCount, uint256 taxCount)",
  "function governorTransferProposals(uint256 proposalId) view returns (bool valid, uint256 firstCallTimestamp, uint256 proposedValue, uint256 valueSacrificedForVote, uint256 valueSacrificedAgainst, uint256 delay, bool isBurn, uint256 startTimestamp)",
] as const;

export type EmissionsProposal = {
  valid: boolean;
  createdAt: bigint;
  proposedValue: bigint;
  votesFor: bigint;
  votesAgainst: bigint;
  extraDelay: bigint;
  isEmissions: boolean;
  startsAt: bigint;
};

export type EmissionsLifecycle =
  | "finished"
  | "voting"
  | "vetoable"
  | "settling"
  | "scheduled"
  | "enforceable";

export type VerifiedEmissions = {
  status: "verified";
  proposal: EmissionsProposal;
  lifecycle: EmissionsLifecycle;
  reviewEndsAt: number;
  observedAt: number;
  executionBlockedReason?: string;
};

export type EmissionsReconciliation =
  | VerifiedEmissions
  | { status: "error"; message: string };

export type EmissionsContractResult = readonly [
  boolean,
  bigint,
  bigint,
  bigint,
  bigint,
  bigint,
  boolean,
  bigint,
] & {
  valid?: boolean;
  firstCallTimestamp?: bigint;
  proposedValue?: bigint;
  valueSacrificedForVote?: bigint;
  valueSacrificedAgainst?: bigint;
  delay?: bigint;
  isBurn?: boolean;
  startTimestamp?: bigint;
};

export function decodeEmissionsProposal(
  result: EmissionsContractResult,
): EmissionsProposal {
  return {
    valid: result.valid ?? result[0],
    createdAt: result.firstCallTimestamp ?? result[1],
    proposedValue: result.proposedValue ?? result[2],
    votesFor: result.valueSacrificedForVote ?? result[3],
    votesAgainst: result.valueSacrificedAgainst ?? result[4],
    extraDelay: result.delay ?? result[5],
    isEmissions: result.isBurn ?? result[6],
    startsAt: result.startTimestamp ?? result[7],
  };
}

export function classifyEmissionsProposal(
  proposal: EmissionsProposal,
  baseDelay: bigint,
  blockTimestamp: number,
): { lifecycle: EmissionsLifecycle; reviewEndsAt: number } {
  const vetoStartsAt = Number(proposal.createdAt + proposal.extraDelay);
  const reviewEndsAt = Number(
    proposal.createdAt + proposal.extraDelay + baseDelay,
  );
  if (!proposal.valid) return { lifecycle: "finished", reviewEndsAt };

  if (
    blockTimestamp >= vetoStartsAt &&
    proposal.votesAgainst > proposal.votesFor
  ) {
    return { lifecycle: "vetoable", reviewEndsAt };
  }
  if (blockTimestamp < reviewEndsAt) {
    return { lifecycle: "voting", reviewEndsAt };
  }
  if (blockTimestamp === reviewEndsAt) {
    return { lifecycle: "settling", reviewEndsAt };
  }
  // executeGovernorTransfer also requires startTimestamp < block.timestamp.
  if (blockTimestamp <= Number(proposal.startsAt)) {
    return { lifecycle: "scheduled", reviewEndsAt };
  }
  return { lifecycle: "enforceable", reviewEndsAt };
}

type ReconcileCandidatesInput = {
  proposalIds: string[];
  proposalCount: bigint;
  baseDelay: bigint;
  blockTimestamp: number;
  readProposal: (proposalId: bigint) => Promise<EmissionsProposal>;
};

export async function reconcileEmissionsCandidates({
  proposalIds,
  proposalCount,
  baseDelay,
  blockTimestamp,
  readProposal,
}: ReconcileCandidatesInput): Promise<Record<string, EmissionsReconciliation>> {
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
        const lifecycle = classifyEmissionsProposal(
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
            executionBlockedReason: proposal.isEmissions
              ? undefined
              : "Governor Transfer subtype is not an emissions update",
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

export function formatEmissionPerBlock(raw: bigint): string {
  const unit = 10n ** 18n;
  const whole = raw / unit;
  const fractional = (raw % unit)
    .toString()
    .padStart(18, "0")
    .replace(/0+$/, "");
  return `${whole.toLocaleString()}${fractional ? `.${fractional}` : ""} DEGEN / block`;
}
