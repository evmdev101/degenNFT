import { withGovernanceReadDeadline } from "./readDeadline";
import { assertGovernanceActionsEnabled } from "../../config/publicPreview";
import { Interface, getAddress } from "ethers";
import type { WalletState } from "../../hooks/useWallet";
import { getPublicProvider } from "../../lib/chain";
import { confirmTransaction, type Receipt } from "../../lib/transactions";
import { proposalSimulationReader, runProposalPreflight, type ProposalPreflight, type SimulationReader } from "./proposalPreflight";
import { GOVERNANCE_CHAIN_ID, FORM_SNAPSHOT_MAX_AGE_MS, type GovernanceModule } from "./governanceSpec";
import type { GovernanceCall, ProposalDraft } from "./proposalValidation";
import { verifySubmittedGovernanceReceipt, type GovernanceReceipt, type GovernanceReceiptProvider } from "./governanceReceipt";

// Checked against the explorer-verified Farms, Basic and Treasury sources saved
// under reference-original/extracted/Governance*.verified.json.
export const CREATION_EFFECTS = {
  allocation: { event: "event InitiateFarmProposal(uint256 indexed proposalID,uint256 depositingTokens,uint256 indexed poolid,uint256 newAllocation,uint16 depositFee,address indexed enforcer,uint256 delay)", getter: "proposalFarmUpdate", returns: "bool,uint256,uint256,uint256,uint256,uint256,uint256,uint16", count: 0 },
  rollover: { event: "event InitiateRolloverBonus(uint256 indexed proposalID,uint256 depositingTokens,address indexed forPool,uint256 newBonus,address indexed enforcer,uint256 delay)", getter: "rolloverBonuses", returns: "bool,uint256,uint256,uint256,uint256,address,uint256", count: 3 },
  tax: { event: "event ProposeGovTax(uint256 indexed proposalID,uint256 valueSacrificedForVote,uint256 proposedTax,address indexed enforcer,uint256 delay)", getter: "govTaxProposals", returns: "bool,uint256,uint256,uint256,uint256,uint256", count: 3 },
  emissions: { event: "event ProposeGovernorTransfer(uint256 indexed proposalID,uint256 valueSacrificedForVote,uint256 proposedAmount,address indexed enforcer,bool isBurn,uint256 startTimestamp,uint256 delay)", getter: "governorTransferProposals", returns: "bool,uint256,uint256,uint256,uint256,uint256,bool,uint256", count: 2 },
  treasury: { event: "event TreasuryProposal(uint256 indexed proposalID,uint256 sacrificedTokens,address tokenAddress,address recipient,uint256 amount,uint256 consensusVoteID,address indexed enforcer,uint256 delay)", getter: "treasuryProposal", returns: "bool,uint256,uint256,uint256,uint256,address,address,uint256,uint256", count: 0 },
  newtoken: { event: "event ProposeNewPool(uint256 indexed proposalID,uint256 valueSacrificedForVote,address newPool,address indexed enforcer,uint256 delay)", getter: "newPoolProposal", returns: "bool,uint256,uint256,uint256,uint256,address", count: 1 },
  fees: { event: "event ProposeVault(uint256 indexed proposalID,uint256 valueSacrificedForVote,uint256 indexed _type,uint256 _amount,address indexed enforcer,uint256 delay)", getter: "vaultProposals", returns: "bool,uint256,uint256,uint256,uint256,uint256,uint256", count: 1 },
  votecost: { event: "event ProposeMinDeposit(uint256 indexed proposalID,uint256 valueSacrificedForVote,uint256 proposedMinDeposit,address indexed enforcer,uint256 delay)", getter: "minDepositProposals", returns: "bool,uint256,uint256,uint256,uint256,uint256", count: 0 },
  delay: { event: "event DelayBeforeEnforce(uint256 indexed proposalID,uint256 valueSacrificedForVote,uint256 proposedMinDeposit,address indexed enforcer,uint256 delay)", getter: "delayProposals", returns: "bool,uint256,uint256,uint256,uint256,uint256", count: 2 },
} as const;
const equal = (left: unknown, right: unknown) => typeof left === "string" && typeof right === "string"
  ? left.toLowerCase() === right.toLowerCase() : left === right;
export type CreationRead = SimulationReader & {
  estimateGas: (call: GovernanceCall, account: string) => Promise<bigint>;
  feePerGas: () => Promise<bigint>;
  balance: (account: string) => Promise<bigint>;
};
export class CreationValidationError extends Error {
  constructor(public preflight: ProposalPreflight) {
    super(Object.values(preflight.validation.errors).join(" ") || preflight.simulation?.message || "Check the proposal fields.");
  }
}
export async function prepareGovernanceCreation(module: GovernanceModule, draft: ProposalDraft, account: string,
  chain: bigint | null, reader: CreationRead) {
  const preflight = await runProposalPreflight(module, { ...draft }, account, chain, reader);
  if (!preflight.validation.call || preflight.simulation?.status !== "passed") throw new CreationValidationError(preflight);
  const call = preflight.validation.call;
  const [estimate, price, balance] = await Promise.all([reader.estimateGas(call, account), reader.feePerGas(), reader.balance(account)]);
  if (estimate <= 0n || price <= 0n) throw new Error("The network fee could not be checked. Please try again shortly.");
  const gasLimit = (estimate * 120n + 99n) / 100n;
  if (balance < gasLimit * price) throw new Error("Keep enough PLS for the network fee.");
  const block = await reader.latestBlock();
  if (!block || Date.now() - block.timestamp * 1000 > FORM_SNAPSHOT_MAX_AGE_MS || block.timestamp * 1000 - Date.now() > 30_000
    || Date.now() - preflight.context.loadedAt > FORM_SNAPSHOT_MAX_AGE_MS || await reader.chainId() !== GOVERNANCE_CHAIN_ID) {
    throw new Error("Current contract rules could not be verified. Choose the action again.");
  }
  // Check the same immutable arguments at the newest head after gas/balance work.
  if (await reader.simulate(call, account, block.number) !== "0x") throw new Error("The current proposal check did not pass.");
  return { preflight, call, gasLimit };
}
export type CreationReceiptReader = GovernanceReceiptProvider & {
  read: SimulationReader["read"];
  blockTimestamp: (block: number) => Promise<number>;
};

export async function verifyGovernanceCreation(reader: CreationReceiptReader, receipt: GovernanceReceipt, call: GovernanceCall, account: string) {
  const hash = await verifySubmittedGovernanceReceipt(reader, receipt, call, account);
  const spec = CREATION_EFFECTS[call.module];
  const iface = new Interface([spec.event]);
  const events = (receipt.logs ?? []).flatMap(log => {
    if (!equal(log.address, call.to)) return [];
    try { const parsed = iface.parseLog({ topics: [...log.topics], data: log.data }); return parsed ? [parsed] : []; } catch { return []; }
  });
  if (events.length !== 1) throw new Error("The proposal creation event could not be verified. Check wallet activity before trying again.");
  const event = events[0].args;
  const a = call.args;
  const consensusId = call.module === "treasury" ? event[5] : 0n;
  const eventExpected: Record<GovernanceModule, readonly unknown[]> = {
    allocation: [a[0], a[1], a[2], 0n, account, a[4]],
    rollover: [a[0], a[1], a[2], account, a[3]],
    tax: [a[0], a[1], account, a[2]],
    emissions: [a[0], a[1], account, a[2], a[3], a[4]],
    treasury: [a[0], a[1], a[2], a[3], consensusId, account, a[4]],
    newtoken: [a[0], a[1], account, a[2]],
    fees: [a[0], a[1], a[2], account, a[3]],
    votecost: [a[0], a[1], account, a[2]], delay: [a[0], a[1], account, a[2]],
  };
  const expected = eventExpected[call.module];
  if (typeof event[0] !== "bigint" || event[0] < 0n || expected.some((value, index) => !equal(event[index + 1], value))) {
    throw new Error("The created proposal does not match your requested terms. Check wallet activity before trying again.");
  }
  const id = event[0] as bigint, block = receipt.blockNumber!;
  const getterAbi = [`function ${spec.getter}(uint256) view returns(${spec.returns})`];
  const countAbi = call.module === "treasury" ? ["function treasuryRequestsCount() view returns(uint256)"] : ["function proposalLengths() view returns(uint256,uint256,uint256,uint256)"];
  const [raw, counts, timestamp] = await Promise.all([
    reader.read(call.to, getterAbi, spec.getter, [id], block),
    reader.read(call.to, countAbi, call.module === "treasury" ? "treasuryRequestsCount" : "proposalLengths", [], block),
    reader.blockTimestamp(block),
  ]);
  const count = call.module === "treasury" ? counts : Array.isArray(counts) ? counts[spec.count] : undefined;
  if (typeof count !== "bigint" || id >= count || !Array.isArray(raw)) throw new Error("The created proposal could not be read back at its mined block.");
  const t = BigInt(timestamp);
  const fields: Record<GovernanceModule, readonly [number, unknown][]> = {
    allocation: [[1,a[1]],[2,a[2]],[5,a[4]],[6,t],[7,0n]],
    rollover: [[1,t],[4,a[3]],[5,a[1]],[6,a[2]]],
    tax: [[1,t],[2,a[1]],[5,a[2]]],
    emissions: [[1,t],[2,a[1]],[5,a[4]],[6,true],[7,0n]],
    treasury: [[1,t],[4,a[4]],[5,a[1]],[6,a[2]],[7,a[3]],[8,consensusId]],
    newtoken: [[1,t],[4,a[2]],[5,a[1]]],
    fees: [[1,t],[2,a[1]],[3,a[2]],[6,a[3]]],
    votecost: [[1,t],[4,a[2]],[5,a[1]]], delay: [[1,t],[4,a[2]],[5,a[1]]],
  };
  const voteIndex = { allocation: 3, rollover: 2, tax: 3, emissions: 3, treasury: 2, newtoken: 2, fees: 4, votecost: 2, delay: 2 }[call.module];
  if (typeof raw[0] !== "boolean" || typeof raw[voteIndex] !== "bigint" || raw[voteIndex] < call.creditConsumed
    || fields[call.module].some(([index,value]) => !equal(raw[index], value))) {
    throw new Error("The mined proposal state did not match your requested terms. Check wallet activity before trying again.");
  }
  const canonical = await reader.getBlock(block);
  if (!equal(canonical?.hash, receipt.blockHash)) throw new Error("The mined proposal block changed. Check wallet activity before trying again.");
  return { id: id.toString(), hash };
}

const activeCreations = new Set<string>();

type CreationWallet = Pick<WalletState, "address" | "chainId" | "getSigner">;
export async function submitGovernanceCreation(module: GovernanceModule, draft: ProposalDraft, wallet: CreationWallet,
  isCurrent: () => boolean = () => true) {
  assertGovernanceActionsEnabled();
  if (!wallet.address) throw new Error("Connect your wallet before submitting a proposal.");
  const account = getAddress(wallet.address);
  const scope = `${account.toLowerCase()}:${module}`;
  if (activeCreations.has(scope)) throw new Error("Finish the current proposal submission first.");
  activeCreations.add(scope);
  try {
  const provider = await getPublicProvider();
  const simulation = await proposalSimulationReader();
  const reader: CreationRead = {
    ...simulation,
    estimateGas: (call, from) => provider.estimateGas({ from, to: call.to, data: call.data, value: 0n }),
    feePerGas: async () => { const fee = await provider.getFeeData(); return fee.maxFeePerGas ?? fee.gasPrice ?? 0n; },
    balance: from => provider.getBalance(from),
  };
  const prepared = await withGovernanceReadDeadline(prepareGovernanceCreation(module, draft, account, wallet.chainId, reader));
  if (!isCurrent()) throw new Error("The proposal changed. Choose the action again.");
  assertGovernanceActionsEnabled();
  const signer = await wallet.getSigner();
  if (!equal(await signer.getAddress(), account) || !isCurrent()) throw new Error("Wallet changed. Choose the action again.");
  assertGovernanceActionsEnabled();
  const transaction = await signer.sendTransaction({ to: prepared.call.to, data: prepared.call.data, value: 0n, chainId: GOVERNANCE_CHAIN_ID, gasLimit: prepared.gasLimit });
  const receipt: Receipt = await confirmTransaction(transaction);
  try {
    const result = await withGovernanceReadDeadline(verifyGovernanceCreation({
      getTransaction: hash => provider.getTransaction(hash),
      getBlock: block => provider.getBlock(block),
      read: simulation.read,
      blockTimestamp: async block => { const value = await provider.getBlock(block); if (!value) throw new Error("Mined block unavailable"); return value.timestamp; },
    }, receipt, prepared.call, account));
    if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent("degen:governance-updated", { detail: { module, id: result.id } }));
    return { ...result, preflight: prepared.preflight };
  } catch {
    throw new Error("Transaction confirmed, but the proposal outcome could not be verified. Check wallet activity before trying again.");
  }
  } finally { activeCreations.delete(scope); }
}
