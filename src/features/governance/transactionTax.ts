import { GOVERNANCE_ADDRESSES } from "./governanceSpec";
export const TRANSACTION_TAX_FARMS_CONTRACT =
  GOVERNANCE_ADDRESSES.farms;

export const TRANSACTION_TAX_READ_ABI = [
  "function proposalLengths() view returns (uint256 farmCount, uint256 vaultCount, uint256 governorTransferCount, uint256 taxCount)",
  "function govTaxProposals(uint256 proposalId) view returns (bool valid, uint256 firstCallTimestamp, uint256 proposedValue, uint256 valueSacrificedForVote, uint256 valueSacrificedAgainst, uint256 delay)",
] as const;

// DEGEN.updateTax rejects larger values even though Farms.proposeGovTax accepts
// values up to 1000. A proposal above this limit can be valid but cannot execute.
export const TRANSACTION_TAX_MAX_RAW = 100n;

export type TransactionTaxProposal = {
  valid: boolean;
  createdAt: bigint;
  proposedValue: bigint;
  votesFor: bigint;
  votesAgainst: bigint;
  extraDelay: bigint;
};

export type TransactionTaxLifecycle =
  | "finished"
  | "voting"
  | "vetoable"
  | "settling"
  | "enforceable";

export type VerifiedTransactionTax = {
  status: "verified";
  proposal: TransactionTaxProposal;
  lifecycle: TransactionTaxLifecycle;
  reviewEndsAt: number;
  observedAt: number;
  executionBlockedReason?: string;
};

export type TransactionTaxReconciliation =
  | VerifiedTransactionTax
  | { status: "error"; message: string };

export type TransactionTaxContractResult = readonly [
  boolean,
  bigint,
  bigint,
  bigint,
  bigint,
  bigint,
] & {
  valid?: boolean;
  firstCallTimestamp?: bigint;
  proposedValue?: bigint;
  valueSacrificedForVote?: bigint;
  valueSacrificedAgainst?: bigint;
  delay?: bigint;
};

export function decodeTransactionTaxProposal(
  result: TransactionTaxContractResult,
): TransactionTaxProposal {
  return {
    valid: result.valid ?? result[0],
    createdAt: result.firstCallTimestamp ?? result[1],
    proposedValue: result.proposedValue ?? result[2],
    votesFor: result.valueSacrificedForVote ?? result[3],
    votesAgainst: result.valueSacrificedAgainst ?? result[4],
    extraDelay: result.delay ?? result[5],
  };
}

export function classifyTransactionTaxProposal(
  proposal: TransactionTaxProposal,
  baseDelay: bigint,
  blockTimestamp: number,
): { lifecycle: TransactionTaxLifecycle; reviewEndsAt: number } {
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
  return { lifecycle: "enforceable", reviewEndsAt };
}

type ReconcileCandidatesInput = {
  proposalIds: string[];
  proposalCount: bigint;
  baseDelay: bigint;
  blockTimestamp: number;
  readProposal: (proposalId: bigint) => Promise<TransactionTaxProposal>;
};

export async function reconcileTransactionTaxCandidates({
  proposalIds,
  proposalCount,
  baseDelay,
  blockTimestamp,
  readProposal,
}: ReconcileCandidatesInput): Promise<
  Record<string, TransactionTaxReconciliation>
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
        const lifecycle = classifyTransactionTaxProposal(
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
            executionBlockedReason:
              proposal.proposedValue > TRANSACTION_TAX_MAX_RAW
                ? "Above the DEGEN token's executable 10% maximum"
                : undefined,
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

export function formatTransactionTaxPercent(raw: bigint): string {
  const whole = raw / 10n;
  const fractional = raw % 10n;
  return `${whole}${fractional ? `.${fractional}` : ""}%`;
}
