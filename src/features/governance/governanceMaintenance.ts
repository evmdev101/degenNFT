import { Contract, Interface, getAddress } from "ethers";
import { assertGovernanceActionsEnabled } from "../../config/publicPreview";
import type { WalletState } from "../../hooks/useWallet";
import { getPublicProvider } from "../../lib/chain";
import { confirmTransaction } from "../../lib/transactions";
import { GOVERNANCE_ADDRESSES as A, GOVERNANCE_CHAIN_ID } from "./governanceSpec";
import { verifySubmittedGovernanceReceipt, type GovernanceReceipt } from "./governanceReceipt";

export const OINK_CREDIT = "0xCF14DbcfFA6E99A444539aBbc9aE273a7bb5d75A";
export const TREASURY_WALLET = "0xD540b89Ee52F81bE921Aa856bb2808A96BA9E3a1";
export type MaintenanceAction = "rebalance" | "import-credit";
export const CREDIT_IMPORT_EVENT = "event AddCredit(address indexed depositor,uint256 amount)";
const same = (a: unknown, b: string) => typeof a === "string" && a.toLowerCase() === b.toLowerCase();
export function rebalanceAllocations(balances: readonly bigint[]) {
  if (balances.length !== 4 || balances.some(value => value < 0n)) throw new Error("Miner balances could not be verified.");
  const total = balances.reduce((sum, value) => sum + value, 0n);
  if (!total) throw new Error("There are no miner balances to rebalance.");
  return balances.map((balance, index) => 100000n * [5333n, 7500n, 25000n, 125000n][index] * balance / (total * 10000n));
}
export function importableCredit(burned: bigint, imported: bigint) {
  if (burned < imported || imported < 0n) throw new Error("Voting-credit history could not be verified.");
  return burned - imported;
}
export function verifyCreditImportEvent(receipt: GovernanceReceipt, account: string, amount: bigint) {
  const iface = new Interface([CREDIT_IMPORT_EVENT]);
  const events = receipt.logs?.filter(log => same(log.address, A.credit)).flatMap(log => {
    try { const event = iface.parseLog(log); return event?.name === "AddCredit" ? [event] : []; } catch { return []; }
  }) ?? [];
  if (events.length !== 1 || !same(events[0].args[0], account) || events[0].args[1] !== amount) throw new Error("The imported voting credit could not be verified.");
}
const locks = new Set<string>();
export async function submitGovernanceMaintenance(action: MaintenanceAction, wallet: WalletState, isCurrent = () => true) {
  assertGovernanceActionsEnabled();
  if (!wallet.address || wallet.chainId !== GOVERNANCE_CHAIN_ID) throw new Error("Connect your wallet on PulseChain first.");
  const account = getAddress(wallet.address), scope = account.toLowerCase() + ":" + action;
  if (locks.has(scope)) throw new Error("Finish the current wallet request first.");
  locks.add(scope);
  let mined = false;
  try {
    const provider = await getPublicProvider();
    if (BigInt(await provider.send("eth_chainId", [])) !== GOVERNANCE_CHAIN_ID) throw new Error("The connection is not on PulseChain.");
    const block = await provider.getBlock("latest");
    if (!block || Date.now() - block.timestamp * 1000 > 120_000 || block.timestamp * 1000 - Date.now() > 30_000) throw new Error("Current contract rules could not be verified.");
    const at = { blockTag: block.number };
    const governor = new Contract(A.governor, ["function masterchef() view returns(address)", "function acPool1() view returns(address)", "function acPool2() view returns(address)", "function acPool3() view returns(address)", "function acPool4() view returns(address)", ...[1,2,3,4].map(index => `function acPool${index}ID() view returns(uint256)`) ], provider);
    const token = new Contract(A.token, ["function governor() view returns(address)"], provider);
    if (!same(await token.governor(at), A.governor)) throw new Error("Governance identity changed. This action is unavailable.");
    let to: string = A.governor, method = "rebalancePools";
    let amount = 0n, expectedImported = 0n;
    let pools: string[] = [], ids: bigint[] = [];
    const credit = new Contract(A.credit, ["function getOinkCreditContract() view returns(address)", "function addedCredit(address) view returns(uint256)", "function userCredit(address) view returns(uint256)"], provider);
    const chef = new Contract(A.masterChef, ["function owner() view returns(address)", "function poolInfo(uint256) view returns(uint256,uint256,address)"], provider);
    if (action === "rebalance") {
      if (!same(await governor.masterchef(at), A.masterChef) || !same(await chef.owner(at), A.governor)) throw new Error("Miner reward contracts changed. This action is unavailable.");
      pools = await Promise.all([1,2,3,4].map(index => governor[`acPool${index}`](at).then(String)));
      ids = await Promise.all([1,2,3,4].map(index => governor[`acPool${index}ID`](at)));
      if (new Set(pools.map(value => value.toLowerCase())).size !== 4 || new Set(ids.map(String)).size !== 4) throw new Error("Miner pool identities could not be verified.");
      const balances = await Promise.all(pools.map(async (pool, index) => {
        const current = await chef.poolInfo(ids[index], at);
        if (!same(current[2], pool) || await provider.getCode(pool, block.number) === "0x") throw new Error("Miner pool identity changed.");
        return BigInt(await new Contract(pool, ["function balanceOf() view returns(uint256)"], provider).balanceOf(at));
      }));
      rebalanceAllocations(balances);
    } else if (action === "import-credit") {
      to = A.credit; method = "addCredit";
      if (!same(await credit.getOinkCreditContract(at), OINK_CREDIT) || await provider.getCode(OINK_CREDIT, block.number) === "0x") throw new Error("Voting-credit contracts changed. This action is unavailable.");
      const source = new Contract(OINK_CREDIT, ["function burnedForId(uint256) view returns(uint256)"], provider);
      const [burned, imported] = await Promise.all([source.burnedForId(BigInt(account), at), credit.addedCredit(account, at)]);
      amount = importableCredit(burned, imported);
      expectedImported = burned;
      if (amount === 0n) throw new Error("There is no eligible voting credit to import.");
    } else throw new Error("Unsupported governance maintenance action.");
    if (await provider.getCode(to, block.number) === "0x") throw new Error("The verified contract is unavailable.");
    const data = new Interface([`function ${method}()`]).encodeFunctionData(method);
    const call = { from: account, to, data, value: 0n, chainId: GOVERNANCE_CHAIN_ID };
    if (await provider.call(call) !== "0x") throw new Error("Unexpected governance simulation response.");
    const [gas, fee, balance] = await Promise.all([provider.estimateGas(call), provider.getFeeData(), provider.getBalance(account)]);
    const price = fee.maxFeePerGas ?? fee.gasPrice ?? 0n;
    const gasLimit = (gas * 120n + 99n) / 100n;
    if (gas <= 0n || price <= 0n || balance < gasLimit * price) throw new Error("Keep enough PLS for the network fee.");
    const currentBlock = await provider.getBlock("latest");
    if (!currentBlock || Date.now() - currentBlock.timestamp * 1000 > 120_000 || Date.now() - block.timestamp * 1000 > 120_000) throw new Error("Contract rules expired. Choose the action again.");
    if (await provider.call(call) !== "0x") throw new Error("Unexpected governance simulation response.");
    if (!isCurrent()) throw new Error("Wallet changed. Choose the action again.");
    assertGovernanceActionsEnabled();
    const signer = await wallet.getSigner();
    if (!same(await signer.getAddress(), account) || !isCurrent()) throw new Error("Wallet changed. Choose the action again.");
    assertGovernanceActionsEnabled();
    const receipt = await confirmTransaction(await signer.sendTransaction({ to, data, value: 0n, chainId: GOVERNANCE_CHAIN_ID, gasLimit }));
    mined = true;
    await verifySubmittedGovernanceReceipt(provider, receipt, call, account);
    const after = { blockTag: receipt.blockNumber! };
    if (action === "import-credit") {
      verifyCreditImportEvent(receipt, account, amount);
      const [beforeCredit, afterCredit, imported] = await Promise.all([
        credit.userCredit(account, { blockTag: Math.max(0, receipt.blockNumber! - 1) }),
        credit.userCredit(account, after), credit.addedCredit(account, after),
      ]);
      if (imported < expectedImported || afterCredit < beforeCredit + amount) throw new Error("Imported credit state could not be verified.");
    } else {
      const balances = await Promise.all(pools.map(pool => new Contract(pool, ["function balanceOf() view returns(uint256)"], provider).balanceOf(after).then(BigInt)));
      const allocations = rebalanceAllocations(balances);
      const actual = await Promise.all(ids.map(id => chef.poolInfo(id, after)));
      if (actual.some((row, index) => row[0] !== allocations[index] || !same(row[2], pools[index]))) throw new Error("Miner reward allocations could not be verified.");
    }
    const canonical = await provider.getBlock(receipt.blockNumber!);
    if (!canonical?.hash || canonical.hash.toLowerCase() !== receipt.blockHash?.toLowerCase()) throw new Error("The mined governance block changed.");
    window.dispatchEvent(new CustomEvent("degen:governance-updated"));
  } catch (error) {
    if (mined) throw new Error("Transaction confirmed, but its outcome could not be verified. Check wallet activity before trying again.");
    throw error;
  } finally { locks.delete(scope); }
}
