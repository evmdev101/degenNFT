import { Interface, toQuantity } from "ethers";
import { CONTRACTS } from "../../config/contracts";
import { getPublicProvider } from "../../lib/chain";
import { TREASURY } from "./config";
import history from "./buybackHistory.json";

export const OINK_BUYBACK_ADDRESS = "0xCbC05cCC8257A085bC55e2EF184e16cd3ECD462A";
export const OINK_BUYBACK_ADDRESSES = [OINK_BUYBACK_ADDRESS, "0x5E4b93e3E50eFCe211FEFddE4E635326e89381D6", "0x0fA727BD2eef5f0FF0cBb6522Da77917CA3eD4b0", "0x310d0571dcb462f81B5DCcD3bcB50149cEd3C9c4"] as const;
export const BUYBACK_EVENTS = new Interface(["event BoughtOink(uint256 amountSpent,uint256 amountReceived)"]);
const identity = new Interface(["function OINK() view returns(address)", "function WPLS() view returns(address)", "function treasury() view returns(address)"]);
const WPLS = "0xa1077a294dde1b09bb078844df40758a5d0f9a27";
const HASH = /^0x[0-9a-f]{64}$/i;
export type BuybackRow = { address: string; key: string; tx: string; block: number; blockHash: string; index: number; timestamp: number; spentRaw: bigint; oinkRaw: bigint };
export type BuybackSnapshot = { block: number; hash: string; timestamp: number; rows: BuybackRow[]; totalOinkRaw: bigint; totalSpentRaw: bigint };
export type BuybackSeed = { contracts: { address: string; fromBlock: number }[]; block: number; hash: string; timestamp: number; rows: (Omit<BuybackRow, "spentRaw" | "oinkRaw"> & { spentRaw: string; oinkRaw: string })[] };
export type BuybackRpc = { send(method: string, params: unknown[]): Promise<unknown> };
type Block = { number: string; hash: string; timestamp: string };
type Log = { address: string; topics: string[]; data: string; blockNumber: string; blockHash: string; transactionHash: string; logIndex: string; removed?: boolean };
const unsigned = (value: unknown) => {
  if (typeof value !== "string" || !/^0x[0-9a-f]+$/i.test(value)) throw new Error("Invalid buyback record");
  const number = Number(BigInt(value));
  if (!Number.isSafeInteger(number) || number < 0) throw new Error("Invalid buyback record");
  return number;
};
function blockOf(value: unknown, expected?: number): Block {
  const block = value as Block | null;
  if (!block || !HASH.test(block.hash) || unsigned(block.timestamp) <= 0 || (expected !== undefined && unsigned(block.number) !== expected)) throw new Error("Buyback block unavailable");
  unsigned(block.number);
  return block;
}
function merge(rows: readonly BuybackRow[]) {
  const unique = new Map<string, BuybackRow>();
  for (const row of rows) {
    if (!OINK_BUYBACK_ADDRESSES.some(address => address.toLowerCase() === row.address.toLowerCase()) || !HASH.test(row.tx) || !HASH.test(row.blockHash) || row.key !== `${row.tx.toLowerCase()}:${row.index}`
      || !Number.isSafeInteger(row.block) || row.block < 0 || !Number.isSafeInteger(row.index) || row.index < 0
      || !Number.isSafeInteger(row.timestamp) || row.timestamp <= 0 || row.spentRaw < 0n || row.oinkRaw < 0n) throw new Error("Invalid buyback history");
    const old = unique.get(row.key);
    if (old && (old.address.toLowerCase() !== row.address.toLowerCase() || old.block !== row.block || old.blockHash !== row.blockHash || old.spentRaw !== row.spentRaw || old.oinkRaw !== row.oinkRaw || old.timestamp !== row.timestamp)) throw new Error("Conflicting buyback history");
    unique.set(row.key, row);
  }
  return [...unique.values()].sort((a, b) => b.block - a.block || b.index - a.index);
}
export function aggregateBuybacks(snapshot: BuybackSnapshot, seconds?: number) {
  const rows = snapshot.rows.filter(row => row.timestamp <= snapshot.timestamp && (seconds === undefined || row.timestamp >= snapshot.timestamp - seconds));
  return { count: rows.length, spentRaw: rows.reduce((sum, row) => sum + row.spentRaw, 0n), oinkRaw: rows.reduce((sum, row) => sum + row.oinkRaw, 0n) };
}

/** Historical purchase events are bundled once; every refresh verifies their
 * canonical anchor and reads all subsequent purchases directly from PulseChain. */
export async function readBuybacks(rpc: BuybackRpc, previous: BuybackSnapshot | null = null, seed: BuybackSeed = history): Promise<BuybackSnapshot> {
  const deadlineAt = Date.now() + 40_000;
  const send = async (method: string, params: unknown[]) => {
    const remaining = deadlineAt - Date.now();
    if (remaining <= 0) throw new Error("Buyback read timed out");
    let timer: ReturnType<typeof setTimeout> | undefined;
    try { return await Promise.race([rpc.send(method, params), new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("Buyback read timed out")), Math.min(remaining, 10_000)); })]); }
    finally { if (timer) clearTimeout(timer); }
  };
  if (BigInt(await send("eth_chainId", []) as string) !== 369n) throw new Error("PulseChain required");
  const head = blockOf(await send("eth_getBlockByNumber", ["latest", false]));
  const block = unsigned(head.number), timestamp = unsigned(head.timestamp);
  if (Date.now() / 1000 - timestamp > 120 || timestamp > Date.now() / 1000 + 30) throw new Error("Current buyback block unavailable");
  const contracts = new Map(seed.contracts.map(contract => [contract.address.toLowerCase(), contract.fromBlock]));
  if (contracts.size !== OINK_BUYBACK_ADDRESSES.length || seed.contracts.length !== contracts.size
    || OINK_BUYBACK_ADDRESSES.some(address => !contracts.has(address.toLowerCase()))
    || seed.contracts.some(contract => !Number.isSafeInteger(contract.fromBlock) || contract.fromBlock < 0 || contract.fromBlock > seed.block)
    || !Number.isSafeInteger(seed.block) || seed.block > block || !HASH.test(seed.hash)) throw new Error("Invalid buyback archive");
  const at = new Map<number, Block>([[block, head]]);
  const blockAt = async (number: number) => {
    let found = at.get(number);
    if (!found) { found = blockOf(await send("eth_getBlockByNumber", [toQuantity(number), false]), number); at.set(number, found); }
    return found;
  };
  const anchor = await blockAt(seed.block);
  if (anchor.hash.toLowerCase() !== seed.hash.toLowerCase() || unsigned(anchor.timestamp) !== seed.timestamp) throw new Error("Buyback archive anchor changed");
  await Promise.all(OINK_BUYBACK_ADDRESSES.flatMap(address => ([ ["OINK", CONTRACTS.oink], ["WPLS", WPLS], ["treasury", TREASURY] ] as const).map(async ([method, expected]) => {
    const raw = await send("eth_call", [{ to: address, data: identity.encodeFunctionData(method) }, toQuantity(block)]);
    const resolved = identity.decodeFunctionResult(method, raw as string)[0] as string;
    if (resolved.toLowerCase() !== expected.toLowerCase()) throw new Error("Buyback contract identity changed");
  })));
  let base: { block: number; rows: BuybackRow[] } = { block: seed.block,
    rows: merge(seed.rows.map(row => ({ ...row, spentRaw: BigInt(row.spentRaw), oinkRaw: BigInt(row.oinkRaw) }))) };
  if (base.rows.some(row => row.block < contracts.get(row.address.toLowerCase())! || row.block > seed.block || row.timestamp > seed.timestamp)) throw new Error("Invalid buyback archive range");
  if (previous && previous.block >= seed.block && previous.block <= block) {
    const prior = await blockAt(previous.block);
    if (prior.hash.toLowerCase() === previous.hash.toLowerCase() && unsigned(prior.timestamp) === previous.timestamp) base = previous;
  }
  const rows = [...base.rows];
  const range = async (from: number, to: number): Promise<BuybackRow[]> => {
    const response = await send("eth_getLogs", [{ address: [...OINK_BUYBACK_ADDRESSES], topics: [BUYBACK_EVENTS.getEvent("BoughtOink")!.topicHash], fromBlock: toQuantity(from), toBlock: toQuantity(to) }]);
    if (!Array.isArray(response)) throw new Error("Buyback history unavailable");
    if (response.length >= 1000) {
      if (from === to) throw new Error("Buyback history incomplete");
      const middle = Math.floor((from + to) / 2);
      return [...await range(from, middle), ...await range(middle + 1, to)];
    }
    const decoded: BuybackRow[] = [];
    for (const log of response as Log[]) {
      const number = unsigned(log.blockNumber);
      if (log.removed || !contracts.has(log.address.toLowerCase()) || number < from || number > to || !HASH.test(log.transactionHash)) throw new Error("Unexpected buyback record");
      const event = BUYBACK_EVENTS.parseLog(log);
      if (!event || event.name !== "BoughtOink") throw new Error("Unexpected buyback event");
      const eventBlock = await blockAt(number);
      if (eventBlock.hash.toLowerCase() !== log.blockHash.toLowerCase() || unsigned(eventBlock.timestamp) > timestamp) throw new Error("Buyback event block changed");
      const tx = log.transactionHash.toLowerCase(), index = unsigned(log.logIndex);
      decoded.push({ address: log.address.toLowerCase(), key: `${tx}:${index}`, tx, block: number, blockHash: log.blockHash.toLowerCase(), index,
        timestamp: unsigned(eventBlock.timestamp), spentRaw: event.args.amountSpent, oinkRaw: event.args.amountReceived });
    }
    return decoded;
  };
  for (let from = base.block + 1; from <= block; from += 25_000) rows.push(...await range(from, Math.min(block, from + 24_999)));
  const canonical = blockOf(await send("eth_getBlockByNumber", [toQuantity(block), false]), block);
  if (canonical.hash.toLowerCase() !== head.hash.toLowerCase()) throw new Error("Buyback head changed");
  const snapshot: BuybackSnapshot = { block, timestamp, hash: head.hash, rows: merge(rows), totalOinkRaw: 0n, totalSpentRaw: 0n };
  const totals = aggregateBuybacks(snapshot);
  return { ...snapshot, totalOinkRaw: totals.oinkRaw, totalSpentRaw: totals.spentRaw };
}
let previous: BuybackSnapshot | null = null;
export async function readPublicBuybacks() {
  const snapshot = await readBuybacks(await getPublicProvider(), previous);
  previous = snapshot;
  return snapshot;
}
