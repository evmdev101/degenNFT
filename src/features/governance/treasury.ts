import { GOVERNANCE_ADDRESSES } from "./governanceSpec";
export const TREASURY_CONSENSUS_CONTRACT =
  GOVERNANCE_ADDRESSES.treasury;

export const TREASURY_READ_ABI = [
  "function treasuryRequestsCount() view returns (uint256)",
  "function treasuryProposal(uint256 proposalId) view returns (bool valid, uint256 firstCallTimestamp, uint256 valueSacrificedForVote, uint256 valueSacrificedAgainst, uint256 delay, address tokenAddress, address beneficiary, uint256 amountToSend, uint256 consensusProposalID)",
  "function getOinkConsensusContract() view returns (address)",
  "function OFFSET() view returns (uint256)",
] as const;

export const LOCKED_CONSENSUS_READ_ABI = [
  "function totalDTXStaked() view returns (uint256)",
  "function highestConsensusVotes(uint256 proposalId) view returns (uint256)",
] as const;

export type TreasuryProposal = {
  valid: boolean;
  createdAt: bigint;
  creditVotesFor: bigint;
  creditVotesAgainst: bigint;
  extraDelay: bigint;
  tokenAddress: string;
  beneficiary: string;
  amountToSend: bigint;
  consensusProposalId: bigint;
};

export type TreasuryAsset = {
  address: string;
  decimals: number;
  symbol: string;
};

export type TreasuryConsensusSnapshot = {
  votesFor: bigint;
  votesAgainst: bigint;
  totalStaked: bigint;
};

export type TreasuryLifecycle =
  | "finished"
  | "credit-voting"
  | "credit-vetoable"
  | "consensus-voting"
  | "consensus-rejection-pending"
  | "finalizable-approval"
  | "finalizable-rejection";

export type VerifiedTreasury = {
  status: "verified";
  proposal: TreasuryProposal;
  asset: TreasuryAsset;
  consensus: TreasuryConsensusSnapshot;
  lifecycle: TreasuryLifecycle;
  creditVotingEndsAt: number;
  finalizesAt: number;
  consensusSupportRequired: bigint;
  observedAt: number;
};

export type TreasuryReconciliation =
  | VerifiedTreasury
  | { status: "error"; message: string };

export type TreasuryContractResult = readonly [
  boolean,
  bigint,
  bigint,
  bigint,
  bigint,
  string,
  string,
  bigint,
  bigint,
] & {
  valid?: boolean;
  firstCallTimestamp?: bigint;
  valueSacrificedForVote?: bigint;
  valueSacrificedAgainst?: bigint;
  delay?: bigint;
  tokenAddress?: string;
  beneficiary?: string;
  amountToSend?: bigint;
  consensusProposalID?: bigint;
};

export function decodeTreasuryProposal(
  result: TreasuryContractResult,
): TreasuryProposal {
  return {
    valid: result.valid ?? result[0],
    createdAt: result.firstCallTimestamp ?? result[1],
    creditVotesFor: result.valueSacrificedForVote ?? result[2],
    creditVotesAgainst: result.valueSacrificedAgainst ?? result[3],
    extraDelay: result.delay ?? result[4],
    tokenAddress: result.tokenAddress ?? result[5],
    beneficiary: result.beneficiary ?? result[6],
    amountToSend: result.amountToSend ?? result[7],
    consensusProposalId: result.consensusProposalID ?? result[8],
  };
}

export function classifyTreasuryProposal(
  proposal: TreasuryProposal,
  consensus: TreasuryConsensusSnapshot,
  baseDelay: bigint,
  blockTimestamp: number,
): {
  lifecycle: TreasuryLifecycle;
  creditVotingEndsAt: number;
  finalizesAt: number;
  consensusSupportRequired: bigint;
} {
  const vetoStartsAt = Number(proposal.createdAt + proposal.extraDelay);
  const creditVotingEndsAt = Number(
    proposal.createdAt + proposal.extraDelay + baseDelay,
  );
  const finalizesAt = Number(
    proposal.createdAt + proposal.extraDelay + baseDelay * 2n,
  );
  const consensusSupportRequired = (consensus.totalStaked * 15n) / 100n;

  if (!proposal.valid) {
    return {
      lifecycle: "finished",
      creditVotingEndsAt,
      finalizesAt,
      consensusSupportRequired,
    };
  }

  const creditRejected =
    proposal.creditVotesAgainst > proposal.creditVotesFor;
  if (
    creditRejected &&
    blockTimestamp >= vetoStartsAt &&
    blockTimestamp <= creditVotingEndsAt
  ) {
    return {
      lifecycle: "credit-vetoable",
      creditVotingEndsAt,
      finalizesAt,
      consensusSupportRequired,
    };
  }
  if (blockTimestamp < creditVotingEndsAt) {
    return {
      lifecycle: "credit-voting",
      creditVotingEndsAt,
      finalizesAt,
      consensusSupportRequired,
    };
  }
  if (creditRejected && blockTimestamp < finalizesAt) {
    return {
      lifecycle: "consensus-rejection-pending",
      creditVotingEndsAt,
      finalizesAt,
      consensusSupportRequired,
    };
  }
  if (blockTimestamp < finalizesAt) {
    return {
      lifecycle: "consensus-voting",
      creditVotingEndsAt,
      finalizesAt,
      consensusSupportRequired,
    };
  }

  const hasEnoughSupport = consensus.votesFor >= consensusSupportRequired;
  const rejectionThreshold = (consensus.votesFor * 33n) / 100n;
  const rejectedByConsensus = consensus.votesAgainst >= rejectionThreshold;
  return {
    lifecycle:
      !creditRejected && hasEnoughSupport && !rejectedByConsensus
        ? "finalizable-approval"
        : "finalizable-rejection",
    creditVotingEndsAt,
    finalizesAt,
    consensusSupportRequired,
  };
}

type ReconcileCandidatesInput = {
  proposalIds: string[];
  proposalCount: bigint;
  baseDelay: bigint;
  blockTimestamp: number;
  readProposal: (proposalId: bigint) => Promise<TreasuryProposal>;
  readAsset: (tokenAddress: string) => Promise<TreasuryAsset>;
  readConsensus: (
    proposal: TreasuryProposal,
  ) => Promise<TreasuryConsensusSnapshot>;
};

export async function reconcileTreasuryCandidates({
  proposalIds,
  proposalCount,
  baseDelay,
  blockTimestamp,
  readProposal,
  readAsset,
  readConsensus,
}: ReconcileCandidatesInput): Promise<Record<string, TreasuryReconciliation>> {
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
        const [asset, consensus] = await Promise.all([
          readAsset(proposal.tokenAddress),
          readConsensus(proposal),
        ]);
        const lifecycle = classifyTreasuryProposal(
          proposal,
          consensus,
          baseDelay,
          blockTimestamp,
        );
        return [
          proposalId,
          {
            status: "verified",
            proposal,
            asset,
            consensus,
            lifecycle: lifecycle.lifecycle,
            creditVotingEndsAt: lifecycle.creditVotingEndsAt,
            finalizesAt: lifecycle.finalizesAt,
            consensusSupportRequired: lifecycle.consensusSupportRequired,
            observedAt: blockTimestamp,
          },
        ] as const;
      } catch {
        return [
          proposalId,
          { status: "error", message: "PulseChain treasury read failed" },
        ] as const;
      }
    }),
  );

  return Object.fromEntries(entries);
}

export function treasuryProposalIds(proposalCount: bigint): string[] {
  if (proposalCount > 500n) {
    throw new Error("Treasury proposal count exceeds the safe enumeration limit");
  }
  return Array.from({ length: Number(proposalCount) }, (_, index) =>
    index.toString(),
  );
}

export function isNativeTreasuryToken(address: string): boolean {
  const normalized = address.toLowerCase();
  return (
    normalized === "0x0000000000000000000000000000000000000000" ||
    normalized === "0x0000000000000000000000000000000000001010"
  );
}

export function formatTreasuryAmount(
  raw: bigint,
  decimals: number,
  symbol: string,
): string {
  const unit = 10n ** BigInt(decimals);
  const whole = raw / unit;
  const fractional = (raw % unit)
    .toString()
    .padStart(decimals, "0")
    .replace(/0+$/, "");
  return `${whole.toLocaleString()}${fractional ? `.${fractional}` : ""} ${symbol}`;
}
