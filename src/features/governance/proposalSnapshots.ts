import { GOVERNANCE_ADDRESSES } from "./governanceSpec";
import { Contract } from "ethers";
import { getPublicProvider } from "../../lib/chain";
import { FARMS_CONTRACT, REWARD_ALLOCATION_READ_ABI, decodeRewardAllocationProposal, reconcileRewardAllocationCandidates, type RewardAllocationContractResult, type RewardAllocationReconciliation } from "./rewardAllocation";
import { BASIC_SETTINGS_CONTRACT, ROLLOVER_BONUS_READ_ABI, decodeRolloverBonusProposal, reconcileRolloverBonusCandidates, type RolloverBonusContractResult, type RolloverBonusReconciliation } from "./rolloverBonus";
import { TRANSACTION_TAX_READ_ABI, decodeTransactionTaxProposal, reconcileTransactionTaxCandidates, type TransactionTaxContractResult, type TransactionTaxReconciliation } from "./transactionTax";
import { EMISSIONS_READ_ABI, decodeEmissionsProposal, reconcileEmissionsCandidates, type EmissionsContractResult, type EmissionsReconciliation } from "./emissions";
import { TREASURY_CONSENSUS_CONTRACT, TREASURY_READ_ABI, LOCKED_CONSENSUS_READ_ABI, decodeTreasuryProposal, reconcileTreasuryCandidates, isNativeTreasuryToken, type TreasuryContractResult, type TreasuryReconciliation, type TreasuryAsset } from "./treasury";

export type SnapshotModule = "allocation" | "rollover" | "tax" | "emissions" | "treasury";
export type SnapshotRow = { id: string } & (
  | { module: "allocation"; value: RewardAllocationReconciliation }
  | { module: "rollover"; value: RolloverBonusReconciliation }
  | { module: "tax"; value: TransactionTaxReconciliation }
  | { module: "emissions"; value: EmissionsReconciliation }
  | { module: "treasury"; value: TreasuryReconciliation }
);
export type ProposalSnapshot = {
  module: SnapshotModule;
  block: number;
  timestamp: number;
  count: bigint;
  baseDelay: bigint;
  rows: SnapshotRow[];
};
export type SnapshotProgress = { completed: number; total: number };

const GOVERNOR = GOVERNANCE_ADDRESSES.governor;
const DELAY_ABI = ["function delayBeforeEnforce() view returns (uint256)"] as const;
const TOKEN_ABI = ["function decimals() view returns (uint8)", "function symbol() view returns (string)"] as const;
export const SNAPSHOT_READ_BATCH = 6;
export const SNAPSHOT_PROPOSAL_LIMIT = 2000n;
export const SNAPSHOT_MODULES = {
  allocation: { address: FARMS_CONTRACT, abi: REWARD_ALLOCATION_READ_ABI, getter: "proposalFarmUpdate", countIndex: 0 },
  rollover: { address: BASIC_SETTINGS_CONTRACT, abi: ROLLOVER_BONUS_READ_ABI, getter: "rolloverBonuses", countIndex: 3 },
  tax: { address: FARMS_CONTRACT, abi: TRANSACTION_TAX_READ_ABI, getter: "govTaxProposals", countIndex: 3 },
  emissions: { address: FARMS_CONTRACT, abi: EMISSIONS_READ_ABI, getter: "governorTransferProposals", countIndex: 2 },
  treasury: { address: TREASURY_CONSENSUS_CONTRACT, abi: TREASURY_READ_ABI, getter: "treasuryProposal", countIndex: 0 },
} as const;

export function isSnapshotModule(module: string): module is SnapshotModule {
  return Object.hasOwn(SNAPSHOT_MODULES, module);
}

/** Injectable, read-only adapter: every contract call requires an explicit block. */
export type SnapshotReader = {
  latestBlock: () => Promise<{ number: number; timestamp: number } | null>;
  read: (address: string, abi: readonly string[], method: string, args: readonly unknown[], block: number) => Promise<unknown>;
};

export function snapshotProposalIds(count: bigint): string[] {
  if (typeof count !== "bigint" || count < 0n || count > SNAPSHOT_PROPOSAL_LIMIT) {
    throw new Error("Proposal count exceeds the supported range; no partial list is shown.");
  }
  return Array.from({ length: Number(count) }, (_, id) => String(id));
}

function requireUint(value: unknown): bigint {
  if (typeof value !== "bigint" || value < 0n) throw new Error("Invalid on-chain integer response");
  return value;
}

function checkCancelled(signal?: AbortSignal) {
  if (signal?.aborted) throw new DOMException("Proposal load cancelled", "AbortError");
}

export async function readProposalSnapshot(module: SnapshotModule, reader: SnapshotReader, signal?: AbortSignal, onProgress?: (progress: SnapshotProgress) => void): Promise<ProposalSnapshot> {
  checkCancelled(signal);
  const block = await reader.latestBlock();
  if (!block || !Number.isSafeInteger(block.number) || !Number.isSafeInteger(block.timestamp)) throw new Error("Latest PulseChain block unavailable");
  checkCancelled(signal);
  const spec = SNAPSHOT_MODULES[module];
  const read = (address: string, abi: readonly string[], method: string, args: readonly unknown[] = []) => {
    checkCancelled(signal);
    return reader.read(address, abi, method, args, block.number);
  };
  const [counts, delayValue] = await Promise.all([
    read(spec.address, spec.abi, module === "treasury" ? "treasuryRequestsCount" : "proposalLengths"),
    read(GOVERNOR, DELAY_ABI, "delayBeforeEnforce"),
  ]);
  checkCancelled(signal);
  if (module !== "treasury" && (!Array.isArray(counts) || counts.length !== 4)) throw new Error("Unexpected proposal count response");
  const count = requireUint(module === "treasury" ? counts : Array.isArray(counts) ? counts[spec.countIndex] : undefined);
  const baseDelay = requireUint(delayValue);
  const ids = snapshotProposalIds(count);
  const rows: SnapshotRow[] = [];
  const snapshot = { module, block: block.number, timestamp: block.timestamp, count, baseDelay, rows };
  onProgress?.({ completed: 0, total: ids.length });
  if (!ids.length) return snapshot;

  // These dependencies and the metadata cache belong to this one block only.
  const treasuryContext = module === "treasury" ? (async () => {
    const [address, offset] = await Promise.all([
      read(spec.address, spec.abi, "getOinkConsensusContract"),
      read(spec.address, spec.abi, "OFFSET"),
    ]);
    if (typeof address !== "string" || !/^0x[\da-f]{40}$/i.test(address)) throw new Error("Invalid consensus address");
    const totalStaked = requireUint(await read(address, LOCKED_CONSENSUS_READ_ABI, "totalDTXStaked"));
    return { address, offset: requireUint(offset), totalStaked };
  })() : undefined;
  // A failed shared dependency is a snapshot error, never a verified empty list.
  const context = await treasuryContext;
  const assets = new Map<string, Promise<TreasuryAsset>>();
  const readAsset = (address: string): Promise<TreasuryAsset> => {
    if (isNativeTreasuryToken(address)) return Promise.resolve({ address, decimals: 18, symbol: "PLS" });
    const key = address.toLowerCase();
    if (!assets.has(key)) assets.set(key, (async () => {
      const decimals = Number(requireUint(await read(address, TOKEN_ABI, "decimals")));
      if (decimals > 255) throw new Error("Invalid token decimals");
      let symbol = "TOKEN";
      try { symbol = String(await read(address, TOKEN_ABI, "symbol")); } catch { /* Symbol is optional; precision is not. */ }
      return { address, decimals, symbol };
    })());
    return assets.get(key)!;
  };

  for (let start = 0; start < ids.length; start += SNAPSHOT_READ_BATCH) {
    checkCancelled(signal);
    const proposalIds = ids.slice(start, start + SNAPSHOT_READ_BATCH);
    const common = { proposalIds, proposalCount: count, baseDelay, blockTimestamp: block.timestamp };
    const proposal = (id: bigint) => read(spec.address, spec.abi, spec.getter, [id]);
    switch (module) {
      case "allocation": {
        const values = await reconcileRewardAllocationCandidates({ ...common, readProposal: async id => decodeRewardAllocationProposal(await proposal(id) as RewardAllocationContractResult) });
        rows.push(...proposalIds.map(id => ({ id, module, value: values[id] })));
        break;
      }
      case "rollover": {
        const values = await reconcileRolloverBonusCandidates({ ...common, readProposal: async id => decodeRolloverBonusProposal(await proposal(id) as RolloverBonusContractResult) });
        rows.push(...proposalIds.map(id => ({ id, module, value: values[id] })));
        break;
      }
      case "tax": {
        const values = await reconcileTransactionTaxCandidates({ ...common, readProposal: async id => decodeTransactionTaxProposal(await proposal(id) as TransactionTaxContractResult) });
        rows.push(...proposalIds.map(id => ({ id, module, value: values[id] })));
        break;
      }
      case "emissions": {
        const values = await reconcileEmissionsCandidates({ ...common, readProposal: async id => decodeEmissionsProposal(await proposal(id) as EmissionsContractResult) });
        rows.push(...proposalIds.map(id => ({ id, module, value: values[id] })));
        break;
      }
      case "treasury": {
        const values = await reconcileTreasuryCandidates({ ...common,
          readProposal: async id => decodeTreasuryProposal(await proposal(id) as TreasuryContractResult),
          readAsset,
          readConsensus: async item => {
            const [forValue, againstValue] = await Promise.all([
              read(context!.address, LOCKED_CONSENSUS_READ_ABI, "highestConsensusVotes", [item.consensusProposalId + context!.offset]),
              read(context!.address, LOCKED_CONSENSUS_READ_ABI, "highestConsensusVotes", [item.consensusProposalId + 1n + context!.offset]),
            ]);
            return { votesFor: requireUint(forValue), votesAgainst: requireUint(againstValue), totalStaked: context!.totalStaked };
          },
        });
        rows.push(...proposalIds.map(id => ({ id, module, value: values[id] })));
      }
    }
    checkCancelled(signal);
    onProgress?.({ completed: rows.length, total: ids.length });
  }
  checkCancelled(signal);
  return snapshot;
}

export async function loadProposalSnapshot(module: SnapshotModule, signal?: AbortSignal, onProgress?: (progress: SnapshotProgress) => void): Promise<ProposalSnapshot> {
  const provider = await getPublicProvider();
  const contracts = new Map<string, Contract>();
  return readProposalSnapshot(module, {
    latestBlock: () => provider.getBlock("latest"),
    read: (address, abi, method, args, block) => {
      const key = `${address.toLowerCase()}:${abi.join(";")}`;
      if (!contracts.has(key)) contracts.set(key, new Contract(address, abi, provider));
      return contracts.get(key)!.getFunction(method)(...args, { blockTag: block });
    },
  }, signal, onProgress);
}
