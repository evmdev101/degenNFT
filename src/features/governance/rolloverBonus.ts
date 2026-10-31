import { GOVERNANCE_ADDRESSES } from "./governanceSpec";
export const BASIC_SETTINGS_CONTRACT =
  GOVERNANCE_ADDRESSES.basic;

// The legacy extracted ABI declares more proposalLengths outputs than the
// deployed Basic Settings contract actually returns. Keep this narrow fragment
// aligned with the deployed four-value response.
export const ROLLOVER_BONUS_READ_ABI = [
  "function proposalLengths() view returns (uint256 minDepositCount, uint256 newPoolCount, uint256 delayCount, uint256 rolloverBonusCount)",
  "function rolloverBonuses(uint256 proposalId) view returns (bool valid, uint256 firstCallTimestamp, uint256 valueSacrificedForVote, uint256 valueSacrificedAgainst, uint256 delay, address poolAddress, uint256 newBonus)",
] as const;

export type RolloverBonusProposal = {
  valid: boolean;
  createdAt: bigint;
  votesFor: bigint;
  votesAgainst: bigint;
  extraDelay: bigint;
  poolAddress: string;
  newBonus: bigint;
};

export type RolloverBonusLifecycle =
  | "finished"
  | "voting"
  | "vetoable"
  | "settling"
  | "enforceable";

export type VerifiedRolloverBonus = {
  status: "verified";
  proposal: RolloverBonusProposal;
  lifecycle: RolloverBonusLifecycle;
  reviewEndsAt: number;
  observedAt: number;
};

export type RolloverBonusReconciliation =
  | VerifiedRolloverBonus
  | { status: "error"; message: string };

export type RolloverBonusContractResult = readonly [
  boolean,
  bigint,
  bigint,
  bigint,
  bigint,
  string,
  bigint,
] & {
  valid?: boolean;
  firstCallTimestamp?: bigint;
  valueSacrificedForVote?: bigint;
  valueSacrificedAgainst?: bigint;
  delay?: bigint;
  poolAddress?: string;
  newBonus?: bigint;
};

export function decodeRolloverBonusProposal(
  result: RolloverBonusContractResult,
): RolloverBonusProposal {
  return {
    valid: result.valid ?? result[0],
    createdAt: result.firstCallTimestamp ?? result[1],
    votesFor: result.valueSacrificedForVote ?? result[2],
    votesAgainst: result.valueSacrificedAgainst ?? result[3],
    extraDelay: result.delay ?? result[4],
    poolAddress: result.poolAddress ?? result[5],
    newBonus: result.newBonus ?? result[6],
  };
}

export function classifyRolloverBonusProposal(
  proposal: RolloverBonusProposal,
  baseDelay: bigint,
  blockTimestamp: number,
): { lifecycle: RolloverBonusLifecycle; reviewEndsAt: number } {
  const vetoStartsAt = Number(proposal.createdAt + proposal.extraDelay);
  const reviewEndsAt = Number(
    proposal.createdAt + proposal.extraDelay + baseDelay,
  );
  if (!proposal.valid) return { lifecycle: "finished", reviewEndsAt };

  // Basic Settings uses a strict timestamp comparison for rollover vetoes.
  // At exactly vetoStartsAt the proposal is still in the voting state.
  if (
    blockTimestamp > vetoStartsAt &&
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
  readProposal: (proposalId: bigint) => Promise<RolloverBonusProposal>;
};

export async function reconcileRolloverBonusCandidates({
  proposalIds,
  proposalCount,
  baseDelay,
  blockTimestamp,
  readProposal,
}: ReconcileCandidatesInput): Promise<
  Record<string, RolloverBonusReconciliation>
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
        const lifecycle = classifyRolloverBonusProposal(
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

export function formatRolloverBonusPercent(raw: bigint): string {
  const whole = raw / 100n;
  const fractional = (raw % 100n).toString().padStart(2, "0").replace(/0+$/, "");
  return `${whole}${fractional ? `.${fractional}` : ""}%`;
}

const ROLLOVER_POOL_LABELS: Record<string, string> = {
  "0xd9b491ac0f5487673500b67224b67b4171a08aca": "1 Month Miner",
  "0x7ed33f65a0398cb26eab2b03877825c96d9b6077": "3 Month Miner",
  "0x3d175c8359169b0e830d36ea9cd3fe209f46f7bd": "1 Year Miner",
  "0xde672fcca32365bd704c39bd1164a0d34a3a73e6": "10 Year Miner",
};

export function rolloverPoolLabel(address: string): string {
  return (
    ROLLOVER_POOL_LABELS[address.toLowerCase()] ??
    `${address.slice(0, 6)}…${address.slice(-4)}`
  );
}
