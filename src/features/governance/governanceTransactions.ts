import { withGovernanceReadDeadline } from "./readDeadline";
import { assertGovernanceActionsEnabled } from "../../config/publicPreview";
import { Interface, getAddress, isAddress, type JsonRpcSigner } from "ethers";
import type { WalletState } from "../../hooks/useWallet";
import { getPublicProvider } from "../../lib/chain";
import { confirmTransaction } from "../../lib/transactions";
import { CONTRACTS } from "../../config/contracts";
import { readGovernanceFormContext, type GovernanceFormContext } from "./formContext";
import { proposalSimulationReader, type SimulationReader } from "./proposalPreflight";
import { encodeProposalAction, parseGovernanceAmount, type GovernanceCall } from "./proposalValidation";
import { FORM_SNAPSHOT_MAX_AGE_MS, GOVERNANCE_ADDRESSES as A, GOVERNANCE_CALLS, GOVERNANCE_CHAIN_ID, SEVEN_DAYS, type GovernanceModule } from "./governanceSpec";
import { SNAPSHOT_MODULES } from "./proposalSnapshots";
import { NEW_TOKEN_ABI } from "./newToken";
import { PARAMETER_BASIC_READ_ABI, PARAMETER_FARMS_READ_ABI } from "./parameterProposals";
import { verifySubmittedGovernanceReceipt, type GovernanceReceipt } from "./governanceReceipt";

export const GOVERNANCE_TREASURY_WALLET = "0xD540b89Ee52F81bE921Aa856bb2808A96BA9E3a1";
export const GOVERNANCE_FEE_SYNC = "0x3d4A3008B751A5226fBe864BfC2934a1e47EFf4C";
export type GovernanceActionRequest = { module: GovernanceModule; action: "yes" | "no" | "veto" | "enforce" | "sync"; proposalId?: string; credit?: string };
export type ActionProposal = { raw: readonly unknown[]; valid: boolean; createdAt: bigint; extraDelay: bigint; votesFor: bigint; votesAgainst: bigint; economicKey: string };
export type PreparedGovernanceAction = { request: GovernanceActionRequest; account: string; context: GovernanceFormContext; call: GovernanceCall; proposal?: ActionProposal; sync?: { vaults: string[]; fees: bigint[] } };
export type GovernanceActionResult = { hash: string; message: string; outcome: "voted" | "applied" | "rejected" | "synced" | "partial" };
const EVENT_TYPES: Record<GovernanceModule, bigint> = { allocation: 0n, emissions: 2n, tax: 4n, fees: 5n, votecost: 0n, delay: 1n, newtoken: 2n, rollover: 3n, treasury: 0n };
const UINT = (value: unknown): bigint => { if (typeof value !== "bigint" || value < 0n) throw new Error("Unexpected governance integer response."); return value; };
const equal = (a: unknown, b: unknown) => String(a).toLowerCase() === String(b).toLowerCase();
const keyOf = (raw: readonly unknown[], excluded: number[]) => JSON.stringify(raw.filter((_, index) => !excluded.includes(index)).map(value => typeof value === "bigint" ? value.toString() : value));

function proposalSpec(module: GovernanceModule) {
  if (module in SNAPSHOT_MODULES) return SNAPSHOT_MODULES[module as keyof typeof SNAPSHOT_MODULES];
  if (module === "newtoken") return { address: A.basic, abi: NEW_TOKEN_ABI, getter: "newPoolProposal", countIndex: 1 };
  return module === "fees" ? { address: A.farms, abi: PARAMETER_FARMS_READ_ABI, getter: "vaultProposals", countIndex: 1 }
    : { address: A.basic, abi: PARAMETER_BASIC_READ_ABI, getter: module === "delay" ? "delayProposals" : "minDepositProposals", countIndex: module === "delay" ? 2 : 0 };
}
export async function readActionProposal(module: GovernanceModule, id: bigint, block: number, reader: SimulationReader): Promise<ActionProposal> {
  const spec = proposalSpec(module);
  const counts = await reader.read(spec.address, spec.abi, module === "treasury" ? "treasuryRequestsCount" : "proposalLengths", [], block);
  const count = module === "treasury" ? UINT(counts) : Array.isArray(counts) && counts.length === 4 ? UINT(counts[spec.countIndex]) : -1n;
  if (count < 0n || id < 0n || id >= count) throw new Error("This proposal ID is not present in the deployed contract.");
  const value = await reader.read(spec.address, spec.abi, spec.getter, [id], block);
  const length = module === "allocation" || module === "emissions" ? 8 : module === "rollover" || module === "fees" ? 7 : module === "treasury" ? 9 : 6;
  if (!Array.isArray(value) || value.length !== length || typeof value[0] !== "boolean") throw new Error("The proposal could not be verified.");
  const raw: readonly unknown[] = Array.from(value);
  const voteIndices = module === "allocation" || module === "tax" || module === "emissions" ? [3, 4] : module === "fees" ? [4, 5] : [2, 3];
  const createdIndex = module === "allocation" ? 6 : 1;
  const delayIndex = module === "allocation" || module === "tax" || module === "emissions" ? 5 : module === "fees" ? 6 : 4;
  const addressIndices = module === "rollover" || module === "newtoken" ? [5] : module === "treasury" ? [5, 6] : [];
  raw.forEach((item, index) => {
    if (index === 0) return;
    if (addressIndices.includes(index)) { if (!isAddress(String(item))) throw new Error("The proposal address could not be verified."); }
    else if (module === "emissions" && index === 6) { if (item !== true) throw new Error("This Governor-Transfer proposal is not an emissions update."); }
    else UINT(item);
  });
  return { raw, valid: raw[0] as boolean, createdAt: UINT(raw[createdIndex]), extraDelay: UINT(raw[delayIndex]),
    votesFor: UINT(raw[voteIndices[0]]), votesAgainst: UINT(raw[voteIndices[1]]), economicKey: keyOf(raw, [0, ...voteIndices]) };
}

const FEE_NAMES = ["depositFee", "fundingRate", "referralBonus"] as const;
const FEE_ABI = FEE_NAMES.map(name => `function ${name}() view returns(uint256)`);
async function prepareSync(context: GovernanceFormContext, reader: SimulationReader) {
  const read = (address: string, abi: readonly string[], method: string) => reader.read(address, abi, method, [], context.block);
  const [token, governor, reward, fees] = await Promise.all([
    read(GOVERNANCE_FEE_SYNC, ["function tokenDTX() view returns(address)"], "tokenDTX"),
    read(A.token, ["function governor() view returns(address)"], "governor"),
    read(A.governor, ["function rewardContract() view returns(address)"], "rewardContract"),
    Promise.all(FEE_NAMES.map(name => read(A.governor, FEE_ABI, name).then(UINT))),
  ]);
  if (!equal(token, A.token) || !equal(governor, A.governor) || !equal(reward, CONTRACTS.referralRewards)) throw new Error("The fee synchronization contract identity changed.");
  const vaults = await read(String(reward), ["function viewVaults() view returns(address[])"], "viewVaults");
  if (!Array.isArray(vaults) || vaults.length === 0 || vaults.length > 256 || vaults.some(address => !isAddress(String(address)))) throw new Error("The vault registry could not be verified.");
  return { vaults: [...new Set(vaults.map(address => getAddress(String(address))))], fees };
}

/** Authoritative action checks; display snapshots and legacy HTML are never transaction input. */
export async function prepareGovernanceAction(request: GovernanceActionRequest, account: string, walletChain: bigint | null, injected?: SimulationReader): Promise<PreparedGovernanceAction> {
  request = { ...request };
  const reader = injected ?? await proposalSimulationReader();
  if (walletChain !== GOVERNANCE_CHAIN_ID) throw new Error("Switch to PulseChain before continuing.");
  if (!Object.hasOwn(GOVERNANCE_CALLS, request.module) || !["yes", "no", "veto", "enforce", "sync"].includes(request.action)) throw new Error("Unsupported governance action.");
  account = getAddress(account);
  const captured = { ...request };
  const context = await readGovernanceFormContext(request.module, account, reader);
  const identity = async (address: string, getter: string, expected: string) => {
    const actual = await reader.read(address, [`function ${getter}() view returns(address)`], getter, [], context.block);
    if (!equal(actual, expected)) throw new Error("A governance execution destination changed. Review is required before sending.");
  };
  if (request.module === "emissions") await Promise.all([
    identity(A.governor, "masterchef", A.masterChef), identity(A.token, "masterchefAddress", A.masterChef), identity(A.masterChef, "owner", A.governor),
  ]);
  if (request.module === "treasury") {
    await Promise.all([identity(A.governor, "treasuryWallet", GOVERNANCE_TREASURY_WALLET), identity(GOVERNANCE_TREASURY_WALLET, "token", A.token)]);
    if (await reader.code(GOVERNANCE_TREASURY_WALLET, context.block) === "0x") throw new Error("The treasury funds wallet could not be verified.");
  }
  const now = BigInt(context.timestamp);
  if (Date.now() - context.timestamp * 1000 > FORM_SNAPSHOT_MAX_AGE_MS || context.timestamp * 1000 - Date.now() > 30_000) throw new Error("Current governance terms are stale. Try again shortly.");
  let call: GovernanceCall, proposal: ActionProposal | undefined, sync: PreparedGovernanceAction["sync"];
  if (request.action === "sync") {
    if (request.module !== "fees") throw new Error("Fee synchronization is only available for mining fees.");
    sync = await prepareSync(context, reader);
    const signature = "updateFees()";
    call = { module: "fees", action: "enforce", chainId: GOVERNANCE_CHAIN_ID, to: GOVERNANCE_FEE_SYNC, signature, method: "updateFees", args: [], data: new Interface([`function ${signature}`]).encodeFunctionData(signature), value: 0n, creditConsumed: 0n };
  } else {
    const id = parseGovernanceAmount(request.proposalId ?? "", 0);
    proposal = await readActionProposal(request.module, id, context.block, reader);
    if (!proposal.valid) throw new Error("This proposal has already finished.");
    const base = request.module === "fees" ? SEVEN_DAYS : context.baseDelay;
    const vetoStart = proposal.createdAt + proposal.extraDelay;
    const end = vetoStart + base;
    if (request.action === "yes" || request.action === "no") {
      const credit = parseGovernanceAmount(request.credit ?? "", 18);
      if (credit <= 0n) throw new Error("Enter a positive voting-credit amount.");
      if (context.credit === undefined || credit > context.credit) throw new Error("Not enough DEGEN voting credit. Wallet tokens are separate.");
      if (now >= end) throw new Error("The credit-voting window has closed.");
    } else if (request.action === "veto") {
      const strict = GOVERNANCE_CALLS[request.module].target === "basic";
      if (strict ? now <= vetoStart : now < vetoStart) throw new Error("The veto delay has not ended yet.");
      if (request.module === "treasury" && now > end) throw new Error("Treasury credit vetoes close when locked-miner voting begins.");
      if (proposal.votesAgainst <= proposal.votesFor) throw new Error("A veto requires more opposing voting credit than support.");
    } else {
      if (request.module === "treasury" ? now < vetoStart + base * 2n : now <= end) throw new Error("The proposal cannot be finalized yet.");
      if (request.module === "emissions" && now <= UINT(proposal.raw[7])) throw new Error("The scheduled emissions start has not arrived yet.");
      if (request.module === "tax" && proposal.votesFor >= proposal.votesAgainst && UINT(proposal.raw[2]) > 100n) throw new Error("This tax proposal exceeds the token contract’s 10% execution limit.");
      if (request.module === "fees" && UINT(proposal.raw[2]) > 2n) throw new Error("This fee proposal has an unsupported fee type.");
    }
    call = encodeProposalAction(request.module, request.action, id.toString(), request.credit ?? "0", false);
  }
  if (await reader.code(call.to, context.block) === "0x" || await reader.chainId() !== GOVERNANCE_CHAIN_ID) throw new Error("The governance destination could not be verified.");
  const result = await reader.simulate(call, account, context.block);
  if (result !== "0x") throw new Error("Unexpected governance simulation response.");
  if (Date.now() - context.timestamp * 1000 > FORM_SNAPSHOT_MAX_AGE_MS) throw new Error("Governance terms expired while checking the action.");
  return { request: captured, account, context, call, proposal, sync };
}

function eventsFor(module: GovernanceModule) {
  const typeIndex = GOVERNANCE_CALLS[module].target === "farms" ? " indexed" : "";
  return new Interface(module === "treasury" ? [
    "event AddVotes(uint256 _type,uint256 proposalID,address indexed voter,uint256 tokensSacrificed,bool _for)",
    "event TreasuryEnforce(uint256 indexed proposalID,address indexed enforcer,bool isSuccess)",
  ] : [
    `event AddVotes(uint256${typeIndex} _type,uint256 indexed proposalID,address indexed voter,uint256 tokensSacrificed,bool _for)`,
    `event EnforceProposal(uint256${typeIndex} _type,uint256 indexed proposalID,address indexed enforcer,bool isSuccess)`,
  ]);
}
async function verifyParameterEffect(prepared: PreparedGovernanceAction, block: number, reader: SimulationReader) {
  const p = prepared.proposal!.raw, module = prepared.request.module;
  let actual: unknown, expected: unknown;
  const read = (address: string, method: string, args: readonly unknown[] = [], result = "uint256") => reader.read(address, [`function ${method}(${args.length ? "address" : ""}) view returns(${result})`], method, args, block);
  switch (module) {
    case "allocation": actual = await reader.read(A.farms, ["function poolAllocationPercentage(uint256) view returns(uint256)"], "poolAllocationPercentage", [p[1]], block); expected = p[2]; break;
    case "rollover": actual = await read(A.governor, "getRollBonus", [p[5]]); expected = p[6]; break;
    case "tax": actual = await read(A.token, "tax"); expected = p[2]; break;
    case "emissions": actual = await read(A.masterChef, "DTXPerBlock"); expected = p[2]; break;
    case "fees": actual = await read(A.governor, FEE_NAMES[Number(p[2])]); expected = p[3]; break;
    case "votecost": actual = await read(A.governor, "costToVote"); expected = p[5]; break;
    case "delay": actual = await read(A.governor, "delayBeforeEnforce"); expected = p[5]; break;
    case "newtoken": actual = await read(A.masterChef, "existingParticipant", [p[5]], "bool"); expected = true; break;
    case "treasury": return;
  }
  if (actual !== expected) throw new Error("The expected governance parameter update was not verified.");
}
export async function verifyGovernanceActionOutcome(prepared: PreparedGovernanceAction, receipt: GovernanceReceipt, reader: SimulationReader): Promise<Omit<GovernanceActionResult, "hash">> {
  const { request, call, proposal } = prepared;
  if (!Number.isSafeInteger(receipt.blockNumber)) throw new Error("Mined block unavailable.");
  const block = receipt.blockNumber!;
  if (request.action === "sync") {
    // The helper uses the current registry and silently skips failing vaults.
    // Re-read that registry and current Governor fees at the receipt block.
    const currentSync = await prepareSync({ ...prepared.context, block }, reader);
    const results = await Promise.all(currentSync.vaults.map(async address => {
      try { return (await Promise.all(FEE_NAMES.slice(0, 2).map(name => reader.read(address, FEE_ABI, name, [], block)))).every((value, index) => value === currentSync.fees[index]); }
      catch { return false; }
    }));
    const verified = results.filter(Boolean).length;
    return { outcome: verified === results.length ? "synced" : "partial", message: verified === results.length ? "Vault fees synchronized." : `Transaction confirmed. Vault fees verified for ${verified} of ${results.length} vaults; the remaining vaults need checking.` };
  }
  const iface = eventsFor(request.module);
  const events = (receipt.logs ?? []).filter(log => equal(log.address, call.to)).flatMap(log => { try { const event = iface.parseLog({ topics: [...log.topics], data: log.data }); return event ? [event] : []; } catch { return []; } });
  const id = parseGovernanceAmount(request.proposalId!, 0);
  const after = await readActionProposal(request.module, id, block, reader);
  if (after.economicKey !== proposal!.economicKey) throw new Error("The proposal terms changed in the mined block.");
  if (request.action === "yes" || request.action === "no") {
    const amount = call.creditConsumed, forVote = request.action === "yes";
    if (!events.some(event => event.name === "AddVotes" && event.args[0] === EVENT_TYPES[request.module] && event.args[1] === id && equal(event.args[2], prepared.account) && event.args[3] === amount && event.args[4] === forVote)) throw new Error("The expected vote event was not found.");
    if ((forVote ? after.votesFor - proposal!.votesFor : after.votesAgainst - proposal!.votesAgainst) < amount) throw new Error("The updated voting total was not verified.");
    return { outcome: "voted", message: "Vote recorded." };
  }
  const event = events.find(item => request.module === "treasury" ? item.name === "TreasuryEnforce" && item.args[0] === id && equal(item.args[1], prepared.account)
    : item.name === "EnforceProposal" && item.args[0] === EVENT_TYPES[request.module] && item.args[1] === id && equal(item.args[2], prepared.account));
  if (!event || after.valid) throw new Error("The completed proposal state was not verified.");
  const success = event.args[request.module === "treasury" ? 2 : 3] === true;
  if (request.action === "veto" && success) throw new Error("Unexpected veto outcome.");
  if (!success) return { outcome: "rejected", message: "Proposal finalized as rejected." };
  if (request.module === "treasury") {
    const wallet = await reader.read(A.governor, ["function treasuryWallet() view returns(address)"], "treasuryWallet", [], block);
    const transfer = new Interface(["event ExecuteTransaction(address indexed token,address indexed recipientAddress,uint256 value)"]);
    const matched = (receipt.logs ?? []).some(log => {
      if (!equal(log.address, wallet)) return false;
      try { const decoded = transfer.parseLog({ topics: [...log.topics], data: log.data }); return decoded?.name === "ExecuteTransaction" && equal(decoded.args[0], proposal!.raw[5]) && equal(decoded.args[1], proposal!.raw[6]) && decoded.args[2] === proposal!.raw[7]; } catch { return false; }
    });
    if (!matched) throw new Error("The treasury wallet payout event was not verified.");
    const asset = String(proposal!.raw[5]), recipient = String(proposal!.raw[6]), amount = UINT(proposal!.raw[7]);
    const native = equal(asset, "0x0000000000000000000000000000000000000000") || equal(asset, "0x0000000000000000000000000000000000001010");
    if (!native) {
      const transfers = new Interface(["event Transfer(address indexed from,address indexed to,uint256 value)"]);
      const paid = (receipt.logs ?? []).filter(log => equal(log.address, asset)).some(log => {
        try { const event = transfers.parseLog({ topics: [...log.topics], data: log.data }); return event?.name === "Transfer" && equal(event.args[0], wallet) && equal(event.args[1], recipient) && event.args[2] === amount; } catch { return false; }
      });
      if (!paid) throw new Error("The treasury token transfer was not verified.");
      const balanceAbi = ["function balanceOf(address) view returns(uint256)"];
      const [before, afterBalance] = await Promise.all([
        reader.read(asset, balanceAbi, "balanceOf", [recipient], Math.max(0, block - 1)),
        reader.read(asset, balanceAbi, "balanceOf", [recipient], block),
      ]);
      if (UINT(afterBalance) < UINT(before) + amount) throw new Error("The beneficiary token balance change was not verified.");
    }
  } else await verifyParameterEffect(prepared, block, reader);
  return { outcome: "applied", message: request.module === "fees" ? "Mining fees updated. Synchronize vault fees to apply them to registered vaults." : request.module === "treasury" ? "Treasury transfer executed." : "Proposal applied." };
}

const active = new Set<string>();
export async function submitGovernanceAction(request: GovernanceActionRequest, wallet: Pick<WalletState, "address" | "chainId" | "getSigner">,
  options: { isCurrent?: () => boolean; onPrepared?: (prepared: PreparedGovernanceAction) => void } = {}): Promise<GovernanceActionResult> {
  assertGovernanceActionsEnabled();
  if (!wallet.address) throw new Error("Connect your wallet first.");
  const account = wallet.address, captured = { ...request };
  const scope = `${account.toLowerCase()}:${request.module}:${request.action === "sync" ? "sync" : request.proposalId}`;
  if (active.has(scope)) throw new Error("Finish the current action for this proposal first.");
  active.add(scope);
  let mined = false;
  try {
    const current = () => { if (options.isCurrent && !options.isCurrent()) throw new Error("The action changed. Choose it again."); };
    current();
    const reader = await proposalSimulationReader();
    const prepared = await withGovernanceReadDeadline(prepareGovernanceAction(captured, account, wallet.chainId, reader));
    options.onPrepared?.(prepared); current();
    assertGovernanceActionsEnabled();
    const signer: JsonRpcSigner = await wallet.getSigner();
    if (!equal(await signer.getAddress(), account)) throw new Error("Wallet changed. Choose the action again.");
    const transaction = { to: prepared.call.to, data: prepared.call.data, value: 0n, chainId: GOVERNANCE_CHAIN_ID };
    const [gas, fee, balance] = await Promise.all([signer.estimateGas(transaction), signer.provider.getFeeData(), signer.provider.getBalance(account)]);
    const gasLimit = (gas * 120n + 99n) / 100n;
    const price = fee.maxFeePerGas ?? fee.gasPrice;
    if (gas <= 0n || !price || price <= 0n) throw new Error("The network fee could not be checked.");
    if (balance < gasLimit * price) throw new Error("Keep enough PLS for the network fee.");
    current();
    if (Date.now() - prepared.context.timestamp * 1000 > FORM_SNAPSHOT_MAX_AGE_MS) throw new Error("Governance terms expired. Choose the action again.");
    const [head, chain] = await Promise.all([reader.latestBlock(), reader.chainId()]);
    if (!head || chain !== GOVERNANCE_CHAIN_ID || Date.now() - head.timestamp * 1000 > FORM_SNAPSHOT_MAX_AGE_MS
      || head.timestamp * 1000 - Date.now() > 30_000) throw new Error("Current governance terms could not be verified.");
    if (await reader.simulate(prepared.call, account, head.number) !== "0x") throw new Error("The latest governance simulation did not pass.");
    current();
    assertGovernanceActionsEnabled();
    const sent = await signer.sendTransaction({ ...transaction, gasLimit, ...(fee.maxFeePerGas != null && fee.maxPriorityFeePerGas != null
      ? { maxFeePerGas: fee.maxFeePerGas, maxPriorityFeePerGas: fee.maxPriorityFeePerGas } : { gasPrice: price }) });
    const receipt = await confirmTransaction(sent);
    mined = true;
    const provider = await getPublicProvider();
    const result = await withGovernanceReadDeadline((async () => {
      const hash = await verifySubmittedGovernanceReceipt(provider, receipt, prepared.call, account);
      const outcome = await verifyGovernanceActionOutcome(prepared, receipt, reader);
      const canonical = await provider.getBlock(receipt.blockNumber!);
      if (!canonical?.hash || canonical.hash.toLowerCase() !== receipt.blockHash?.toLowerCase()) throw new Error("The mined governance block changed during verification.");
      return { hash, ...outcome };
    })());
    if (typeof window !== "undefined") window.dispatchEvent(new Event("degen:transaction-confirmed"));
    return result;
  } catch (error) {
    if (mined) throw new Error("Transaction confirmed, but its governance outcome could not be verified. Check wallet activity before trying again.");
    throw error;
  } finally { active.delete(scope); }
}
