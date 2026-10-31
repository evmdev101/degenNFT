import { GOVERNANCE_ADDRESSES } from "./governanceSpec";
import { Contract } from "ethers";
import { getPublicProvider } from "../../lib/chain";
import { FARMS_CONTRACT } from "./rewardAllocation";
import { BASIC_SETTINGS_CONTRACT } from "./rolloverBonus";

export type ParameterModule = "fees" | "votecost" | "delay";

export const PARAMETER_BASIC_READ_ABI = [
  // The deployed contract returns four counts; the legacy extracted ABI declares six.
  "function proposalLengths() view returns(uint256,uint256,uint256,uint256)",
  "function minDepositProposals(uint256) view returns(bool,uint256,uint256,uint256,uint256,uint256)",
  "function delayProposals(uint256) view returns(bool,uint256,uint256,uint256,uint256,uint256)",
] as const;

export const PARAMETER_FARMS_READ_ABI = [
  "function proposalLengths() view returns(uint256,uint256,uint256,uint256)",
  "function vaultProposals(uint256) view returns(bool,uint256,uint256,uint256,uint256,uint256,uint256)",
] as const;

const GOVERNOR_ADDRESS = GOVERNANCE_ADDRESSES.governor;
const GOVERNOR_READ_ABI = [
  "function delayBeforeEnforce() view returns(uint256)",
  "function costToVote() view returns(uint256)",
] as const;

export const MINING_FEE_REVIEW_SECONDS = 7n * 24n * 60n * 60n;
export const PARAMETER_PROPOSAL_LIMIT = 500n;
const READ_CONCURRENCY = 6;

export type ParameterProposal = {
  valid: boolean;
  createdAt: bigint;
  extraDelay: bigint;
  votesFor: bigint;
  votesAgainst: bigint;
  value: bigint;
  feeType?: bigint;
};

export type ParameterRow =
  | { id: string; status: "verified"; proposal: ParameterProposal }
  | { id: string; status: "error"; message: string };

export type ParameterSnapshot = {
  rows: ParameterRow[];
  block: number;
  timestamp: bigint;
  baseDelay: bigint;
  costToVote: bigint;
};

export type ParameterLifecycle =
  | "finished"
  | "voting"
  | "vetoable"
  | "settling"
  | "review-complete";

export function decodeParameterProposal(
  module: ParameterModule,
  result: readonly unknown[],
): ParameterProposal {
  const expectedLength = module === "fees" ? 7 : 6;
  if (
    result.length !== expectedLength ||
    typeof result[0] !== "boolean" ||
    result.slice(1).some(value => typeof value !== "bigint" || value < 0n)
  ) {
    throw new Error("Unexpected parameter proposal response");
  }
  const raw = result as readonly [boolean, bigint, bigint, bigint, bigint, bigint, bigint?];
  return module === "fees"
    ? {
        valid: raw[0], createdAt: raw[1], feeType: raw[2], value: raw[3],
        votesFor: raw[4], votesAgainst: raw[5], extraDelay: raw[6]!,
      }
    : {
        valid: raw[0], createdAt: raw[1], votesFor: raw[2], votesAgainst: raw[3],
        extraDelay: raw[4], value: raw[5],
      };
}

export function parameterProposalCount(module: ParameterModule, counts: readonly unknown[]): bigint {
  const index = module === "fees" ? 1 : module === "votecost" ? 0 : 2;
  const count = counts[index];
  if (counts.length !== 4 || typeof count !== "bigint" || count < 0n || count > PARAMETER_PROPOSAL_LIMIT) {
    throw new Error("Proposal count exceeds the supported range or response is invalid");
  }
  return count;
}

export function classifyParameterProposal(
  module: ParameterModule,
  proposal: ParameterProposal,
  baseDelay: bigint,
  timestamp: bigint,
): ParameterLifecycle {
  if (!proposal.valid) return "finished";
  const vetoStart = proposal.createdAt + proposal.extraDelay;
  const reviewEnd = vetoStart + (module === "fees" ? MINING_FEE_REVIEW_SECONDS : baseDelay);
  const vetoTimePassed = module === "fees" ? timestamp >= vetoStart : timestamp > vetoStart;
  if (vetoTimePassed && proposal.votesAgainst > proposal.votesFor) return "vetoable";
  if (timestamp < reviewEnd) return "voting";
  if (timestamp === reviewEnd) return "settling";
  // This describes timing only: downstream execution and vault synchronization
  // have separate requirements and have not been simulated here.
  return "review-complete";
}

function formatScaled(value: bigint, decimalPlaces: number): string {
  const divisor = 10n ** BigInt(decimalPlaces);
  const whole = (value / divisor).toLocaleString("en-US");
  const fraction = (value % divisor).toString().padStart(decimalPlaces, "0").replace(/0+$/, "");
  return `${whole}${fraction ? `.${fraction}` : ""}`;
}

export function formatParameterValue(module: ParameterModule, proposal: ParameterProposal): string {
  if (module === "votecost") return `${formatScaled(proposal.value, 18)} DEGEN`;
  if (module === "delay") {
    const hours = proposal.value / 3600n;
    const remainder = proposal.value % 3600n;
    if (remainder === 0n) return `${hours.toLocaleString("en-US")} ${hours === 1n ? "hour" : "hours"}`;
    return `${proposal.value.toLocaleString("en-US")} seconds`;
  }
  if (proposal.feeType === 1n) return `${formatScaled(proposal.value, 4)}%/hour`;
  if (proposal.feeType === 0n || proposal.feeType === 2n) return `${formatScaled(proposal.value, 2)}%`;
  return `${proposal.value.toLocaleString("en-US")} (raw units; unknown fee type)`;
}

export async function enumerateParameterProposals(
  count: bigint,
  readProposal: (id: bigint) => Promise<ParameterProposal>,
): Promise<ParameterRow[]> {
  if (count < 0n || count > PARAMETER_PROPOSAL_LIMIT) {
    throw new Error("Proposal count exceeds the supported range");
  }
  const rows: ParameterRow[] = [];
  for (let start = 0; start < Number(count); start += READ_CONCURRENCY) {
    const batch = await Promise.all(
      Array.from({ length: Math.min(READ_CONCURRENCY, Number(count) - start) }, async (_, offset): Promise<ParameterRow> => {
        const id = BigInt(start + offset);
        try {
          return { id: String(id), status: "verified", proposal: await readProposal(id) };
        } catch {
          return { id: String(id), status: "error", message: "Proposal read failed — refresh to retry" };
        }
      }),
    );
    rows.push(...batch);
  }
  return rows;
}

export type ParameterReader = {
  latestBlock: () => Promise<{ number: number; timestamp: number } | null>;
  counts: (block: number) => Promise<readonly unknown[]>;
  baseDelay: (block: number) => Promise<bigint>;
  costToVote: (block: number) => Promise<bigint>;
  proposal: (id: bigint, block: number) => Promise<readonly unknown[]>;
};

// Every dependency is read at one block so an update cannot mix old counts,
// a new Governor delay, and proposal values from a third point in time.
export async function readParameterSnapshot(
  module: ParameterModule,
  reader: ParameterReader,
): Promise<ParameterSnapshot> {
  const block = await reader.latestBlock();
  if (!block) throw new Error("Latest PulseChain block unavailable");
  const [counts, baseDelay, costToVote] = await Promise.all([
    reader.counts(block.number), reader.baseDelay(block.number), reader.costToVote(block.number),
  ]);
  const count = parameterProposalCount(module, counts);
  const rows = await enumerateParameterProposals(count, async id =>
    decodeParameterProposal(module, await reader.proposal(id, block.number)),
  );
  return { rows, block: block.number, timestamp: BigInt(block.timestamp), baseDelay, costToVote };
}

export async function loadParameterProposals(module: ParameterModule): Promise<ParameterSnapshot> {
  const provider = await getPublicProvider();
  const proposalContract = new Contract(
    module === "fees" ? FARMS_CONTRACT : BASIC_SETTINGS_CONTRACT,
    module === "fees" ? PARAMETER_FARMS_READ_ABI : PARAMETER_BASIC_READ_ABI,
    provider,
  );
  const getter = module === "fees" ? "vaultProposals" : module === "votecost" ? "minDepositProposals" : "delayProposals";
  const governor = new Contract(GOVERNOR_ADDRESS, GOVERNOR_READ_ABI, provider);
  return readParameterSnapshot(module, {
    latestBlock: () => provider.getBlock("latest"),
    counts: block => proposalContract.proposalLengths({ blockTag: block }),
    baseDelay: block => governor.delayBeforeEnforce({ blockTag: block }),
    costToVote: block => governor.costToVote({ blockTag: block }),
    proposal: (id, block) => proposalContract[getter](id, { blockTag: block }),
  });
}
