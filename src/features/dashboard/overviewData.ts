import { Contract, Interface, formatUnits, toQuantity, zeroPadValue } from "ethers";
import { CONTRACTS } from "../../config/contracts";
import { getPublicProvider } from "../../lib/chain";
import { DASHBOARD_ASSETS, TREASURY, type DashboardAsset } from "./config";
import { readTokenPrices } from "./marketData";

export type TreasuryHolding = { asset: DashboardAsset; raw: bigint | null; usd: number | null };
export type OverviewSnapshot = {
  block: number; timestamp: number; supplyRaw: bigint | null;
  holdings: TreasuryHolding[]; prices: Record<string, number | null>;
  totalUsd: number | null; knownUsd: number; pricedCount: number;
};
export type OverviewReader = {
  snapshot(): Promise<{ block: number; timestamp: number }>;
  supply(block: number): Promise<bigint>;
  balance(asset: DashboardAsset, block: number): Promise<bigint>;
  prices(addresses: readonly string[]): Promise<Record<string, number | null>>;
};
async function deadline<T>(operation: Promise<T>, ms = 12_000): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try { return await Promise.race([operation, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("Treasury read timed out")), ms); })]); }
  finally { if (timer) clearTimeout(timer); }
}
function unsigned(value: bigint): bigint { if (typeof value !== "bigint" || value < 0n) throw new Error("Invalid balance"); return value; }
export function valueTreasuryAmount(raw: bigint | null, decimals: number, price: number | null | undefined): number | null {
  if (raw === null) return null;
  if (raw === 0n) return 0;
  if (!(price && Number.isFinite(price) && price > 0)) return null;
  const value = Number(formatUnits(raw, decimals)) * price;
  return Number.isFinite(value) ? value : null;
}

/** Field failures stay unavailable. A zero balance needs no market price. */
export async function readOverviewSnapshot(reader: OverviewReader, assets: readonly DashboardAsset[] = DASHBOARD_ASSETS): Promise<OverviewSnapshot> {
  const { block, timestamp } = await deadline(reader.snapshot());
  if (!Number.isSafeInteger(block) || block < 0 || !Number.isFinite(timestamp) || timestamp <= 0
    || Date.now() / 1000 - timestamp > 120 || timestamp > Date.now() / 1000 + 30) throw new Error("Current treasury block unavailable");
  const [supplyRaw, balances, prices] = await Promise.all([
    deadline(reader.supply(block)).then(unsigned).catch(() => null),
    Promise.all(assets.map(asset => deadline(reader.balance(asset, block)).then(unsigned).catch(() => null))),
    deadline(reader.prices(assets.map(asset => asset.address))).catch(() => ({} as Record<string, number | null>)),
  ]);
  const holdings = assets.map((asset, index) => ({ asset, raw: balances[index], usd: valueTreasuryAmount(balances[index], asset.decimals, prices[asset.address.toLowerCase()]) }));
  const knownUsd = holdings.reduce((sum, row) => sum + (row.usd ?? 0), 0);
  return { block, timestamp, supplyRaw, holdings, prices, knownUsd,
    pricedCount: holdings.filter(row => row.usd !== null).length,
    totalUsd: holdings.every(row => row.usd !== null) ? knownUsd : null };
}

export async function readPublicOverview(): Promise<OverviewSnapshot> {
  const provider = await deadline(getPublicProvider());
  const token = new Contract(CONTRACTS.degen, ["function totalSupply() view returns (uint256)"], provider);
  return readOverviewSnapshot({
    snapshot: async () => {
      if (BigInt(await deadline(provider.send("eth_chainId", []))) !== 369n) throw new Error("Wrong chain");
      const block = await deadline(provider.getBlock("latest"));
      if (!block) throw new Error("Current block unavailable");
      return { block: block.number, timestamp: block.timestamp };
    },
    supply: block => token.totalSupply({ blockTag: block }),
    balance: (asset, block) => asset.native ? provider.getBalance(TREASURY, block)
      : new Contract(asset.address, ["function balanceOf(address) view returns (uint256)"], provider).balanceOf(TREASURY, { blockTag: block }),
    prices: readTokenPrices,
  });
}

type Rpc = { send(method: string, params: unknown[]): Promise<unknown> };
type RpcBlock = { number: string; hash: string; timestamp: string };
type RpcLog = { address: string; topics: string[]; data: string; blockNumber: string; blockHash: string; transactionHash: string; logIndex: string; removed?: boolean };
export type TreasuryInflow = { key: string; asset: DashboardAsset; raw: bigint; block: number; index: number; timestamp: number; tx: string };
export type TreasuryInflows = { from: number; to: number; fromTimestamp: number; timestamp: number; hash: string; rows: TreasuryInflow[]; boundaryRowsIncluded?: boolean };
export type TreasuryInflowPage = { from: number; to: number; rows: TreasuryInflow[]; anchorBlock: number; anchorHash: string };
const transfer = new Interface(["event Transfer(address indexed from,address indexed to,uint256 value)"]);
const MONTH = 30 * 86400;
function numberOf(value: string): number { const number = Number(BigInt(value)); if (!Number.isSafeInteger(number) || number < 0) throw new Error("Invalid history record"); return number; }
function asBlock(value: unknown, expected?: number): RpcBlock {
  const block = value as RpcBlock | null;
  if (!block || typeof block.hash !== "string" || !/^0x[0-9a-f]{64}$/i.test(block.hash)
    || typeof block.number !== "string" || typeof block.timestamp !== "string"
    || (expected !== undefined && numberOf(block.number) !== expected)) throw new Error("Inflow block unavailable");
  numberOf(block.number); numberOf(block.timestamp);
  return block;
}

async function untilAborted<T>(operation: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return operation;
  signal.throwIfAborted();
  let abort: (() => void) | undefined;
  try {
    return await Promise.race([operation, new Promise<never>((_, reject) => {
      abort = () => reject(signal.reason ?? new Error("Treasury history read cancelled"));
      signal.addEventListener("abort", abort, { once: true });
    })]);
  } finally { if (abort) signal.removeEventListener("abort", abort); }
}

function inflowReader(rpc: Rpc, assets: readonly DashboardAsset[], signal?: AbortSignal) {
  const deadlineAt = Date.now() + 40_000;
  const send = async (method: string, params: unknown[]) => {
    signal?.throwIfAborted();
    const remaining = deadlineAt - Date.now();
    if (remaining <= 0) throw new Error("Treasury history read budget expired");
    const result = await untilAborted(deadline(rpc.send(method, params), Math.min(12_000, remaining)), signal);
    signal?.throwIfAborted();
    return result;
  };
  const tracked = assets.filter(asset => !asset.native);
  const byAddress = new Map(tracked.map(asset => [asset.address.toLowerCase(), asset]));
  const blocks = new Map<number, RpcBlock>();
  const blockAt = async (number: number) => asBlock(await send("eth_getBlockByNumber", [toQuantity(number), false]), number);
  const cachedBlock = async (number: number) => { if (!blocks.has(number)) blocks.set(number, await blockAt(number)); return blocks.get(number)!; };
  async function range(start: number, end: number, timestamp: number) {
    const [first, result] = await Promise.all([
      cachedBlock(start), send("eth_getLogs", [{ address: tracked.map(asset => asset.address), topics: [transfer.getEvent("Transfer")!.topicHash, null, zeroPadValue(TREASURY, 32)], fromBlock: toQuantity(start), toBlock: toQuantity(end) }]),
    ]);
    if (!Array.isArray(result) || result.length >= 1000) throw new Error("Treasury history response is incomplete");
    const decoded: { row: Omit<TreasuryInflow, "timestamp">; hash: string }[] = [];
    for (const value of result) {
      const log = value as RpcLog;
      if (!log || log.removed || typeof log.address !== "string" || !Array.isArray(log.topics) || typeof log.data !== "string"
        || typeof log.blockNumber !== "string" || typeof log.logIndex !== "string" || typeof log.blockHash !== "string"
        || !/^0x[0-9a-f]{64}$/i.test(log.blockHash) || !/^0x[0-9a-f]{64}$/i.test(log.transactionHash ?? "")) throw new Error("Unexpected treasury inflow record");
      const asset = byAddress.get(log.address.toLowerCase());
      let event;
      try { event = transfer.parseLog(log); } catch { throw new Error("Unexpected treasury inflow record"); }
      if (!asset || !event || String(event.args.to).toLowerCase() !== TREASURY.toLowerCase()) throw new Error("Unexpected treasury inflow record");
      const block = numberOf(log.blockNumber), index = numberOf(log.logIndex), raw = unsigned(event.args.value);
      if (block < start || block > end) throw new Error("Unexpected treasury inflow range");
      if (!raw || String(event.args.from).toLowerCase() === TREASURY.toLowerCase()) continue;
      decoded.push({ row: { key: `${log.transactionHash.toLowerCase()}:${index}`, asset, raw, block, index, tx: log.transactionHash }, hash: log.blockHash });
    }
    const numbers = [...new Set(decoded.map(item => item.row.block))];
    for (let index = 0; index < numbers.length; index += 6) await Promise.all(numbers.slice(index, index + 6).map(cachedBlock));
    const rows = new Map<string, TreasuryInflow>();
    for (const item of decoded) {
      const block = blocks.get(item.row.block)!;
      if (block.hash.toLowerCase() !== item.hash.toLowerCase()) throw new Error("Treasury inflow history changed");
      const observed = numberOf(block.timestamp);
      if (observed > timestamp) throw new Error("Unexpected treasury inflow timestamp");
      appendInflow(rows, { ...item.row, timestamp: observed });
    }
    return { first, rows: [...rows.values()] };
  }
  return { send, tracked, blocks, blockAt, range };
}

const sortedInflows = (rows: Iterable<TreasuryInflow>) => [...rows].sort((a, b) => b.block - a.block || b.index - a.index);
function appendInflow(rows: Map<string, TreasuryInflow>, row: TreasuryInflow) {
  const existing = rows.get(row.key);
  if (existing && (existing.block !== row.block || existing.raw !== row.raw || existing.timestamp !== row.timestamp
    || existing.asset.address.toLowerCase() !== row.asset.address.toLowerCase())) throw new Error("Conflicting treasury inflow record");
  rows.set(row.key, row);
}

/** Complete tracked ERC20 history only. Native PLS and unlisted tokens are excluded. */
export async function readTreasuryInflows(rpc: Rpc, previous: TreasuryInflows | null = null, assets: readonly DashboardAsset[] = DASHBOARD_ASSETS, options: { includeBoundaryRows?: boolean } = {}): Promise<TreasuryInflows> {
  // Stop the scan itself before its public read deadline. Expiring only the
  // outer promise would leave more chunks running behind a later refresh.
  const { send, tracked, blocks, blockAt, range } = inflowReader(rpc, assets);
  if (BigInt(await send("eth_chainId", []) as string) !== 369n) throw new Error("Wrong chain");
  const latest = asBlock(await send("eth_getBlockByNumber", ["latest", false]));
  const head = numberOf(latest.number), timestamp = numberOf(latest.timestamp), cutoff = timestamp - MONTH;
  if (Date.now() / 1000 - timestamp > 120 || timestamp > Date.now() / 1000 + 30) throw new Error("Treasury history snapshot is stale");
  if (!tracked.length) return { from: 0, to: head, fromTimestamp: cutoff, timestamp, hash: latest.hash, rows: [], boundaryRowsIncluded: Boolean(options.includeBoundaryRows) };
  let reuse = previous && previous.to <= head && previous.fromTimestamp <= cutoff && previous.fromTimestamp >= cutoff - MONTH
    && (!options.includeBoundaryRows || previous.boundaryRowsIncluded) ? previous : null;
  if (reuse && (await blockAt(reuse.to)).hash !== reuse.hash) reuse = null;
  const rows = new Map<string, TreasuryInflow>(reuse?.rows.map(row => [row.key, row]) ?? []);
  blocks.set(head, latest);
  let cursor = head, from = reuse?.from ?? head, fromTimestamp = reuse?.fromTimestamp ?? timestamp, complete = reuse?.to === head;
  for (let chunk = 0; !complete && chunk < 64; chunk++) {
    const start = Math.max(reuse ? reuse.to + 1 : 0, cursor - 24_999);
    const { first, rows: next } = await range(start, cursor, timestamp);
    if (rows.size + next.length > 3000) throw new Error("Treasury history response is incomplete");
    for (const row of next) appendInflow(rows, row);
    if (!reuse) { from = start; fromTimestamp = numberOf(first.timestamp); }
    complete = reuse ? start === reuse.to + 1 : fromTimestamp <= cutoff || start === 0;
    cursor = start - 1;
  }
  if (!complete) throw new Error("Thirty-day treasury history is not fully loaded");
  if ((await blockAt(head)).hash !== latest.hash) throw new Error("Treasury history changed while loading");
  return { from, to: head, fromTimestamp, timestamp, hash: latest.hash,
    rows: sortedInflows(rows.values()).filter(row => (options.includeBoundaryRows || row.timestamp >= cutoff) && row.timestamp <= timestamp), boundaryRowsIncluded: Boolean(options.includeBoundaryRows) };
}
let previousInflows: TreasuryInflows | null = null;
export async function readPublicTreasuryInflows(): Promise<TreasuryInflows> {
  const provider = await deadline(getPublicProvider());
  const snapshot = await deadline(readTreasuryInflows(provider, previousInflows, DASHBOARD_ASSETS, { includeBoundaryRows: true }), 45_000);
  previousInflows = snapshot;
  return snapshot;
}

/** One complete, bounded older block range. It never changes the live summary windows. */
export async function readOlderTreasuryInflows(rpc: Rpc, anchor: TreasuryInflows, cursor?: number, assets: readonly DashboardAsset[] = DASHBOARD_ASSETS, signal?: AbortSignal): Promise<TreasuryInflowPage> {
  signal?.throwIfAborted();
  if (!Number.isSafeInteger(anchor.from) || anchor.from < 0 || !Number.isSafeInteger(anchor.to) || anchor.to < anchor.from
    || !Number.isSafeInteger(anchor.timestamp) || anchor.timestamp <= 0 || !/^0x[0-9a-f]{64}$/i.test(anchor.hash)) throw new Error("Invalid treasury history cursor");
  // Older snapshots without boundary rows re-read the last scanned chunk and
  // select its pre-month receipts, so their already-filtered rows cannot create a gap.
  const upper = anchor.boundaryRowsIncluded ? anchor.from - 1 : Math.min(anchor.to, anchor.from + 24_999);
  const end = cursor ?? upper;
  if (!Number.isSafeInteger(end) || end < -1 || end > upper) throw new Error("Invalid treasury history cursor");
  const reader = inflowReader(rpc, assets, signal);
  if (BigInt(await reader.send("eth_chainId", []) as string) !== 369n) throw new Error("Wrong chain");
  const assertAnchor = async () => {
    const block = await reader.blockAt(anchor.to);
    if (block.hash.toLowerCase() !== anchor.hash.toLowerCase() || numberOf(block.timestamp) !== anchor.timestamp) throw new Error("Treasury history changed while loading");
  };
  await assertAnchor();
  if (end === -1 || !reader.tracked.length) return { from: 0, to: Math.max(0, end), rows: [], anchorBlock: anchor.to, anchorHash: anchor.hash };
  const rows = new Map<string, TreasuryInflow>();
  let next = end, from = end;
  for (let chunk = 0; chunk < 12; chunk++) {
    const start = Math.max(0, next - 24_999);
    const page = await reader.range(start, next, anchor.timestamp);
    for (const row of page.rows) {
      if (anchor.boundaryRowsIncluded || row.timestamp < anchor.timestamp - MONTH) appendInflow(rows, row);
    }
    if (rows.size > 3000) throw new Error("Treasury history response is incomplete");
    from = start;
    if (start === 0 || rows.size >= 10) break;
    next = start - 1;
  }
  await assertAnchor();
  return { from, to: end, rows: sortedInflows(rows.values()), anchorBlock: anchor.to, anchorHash: anchor.hash };
}

export async function readPublicOlderTreasuryInflows(anchor: TreasuryInflows, cursor?: number, signal?: AbortSignal): Promise<TreasuryInflowPage> {
  signal?.throwIfAborted();
  const provider = await untilAborted(deadline(getPublicProvider()), signal);
  signal?.throwIfAborted();
  return readOlderTreasuryInflows(provider, anchor, cursor, DASHBOARD_ASSETS, signal);
}
export function aggregateInflows(snapshot: TreasuryInflows, seconds: number, prices: Record<string, number | null>) {
  const rows = snapshot.rows.filter(row => row.timestamp >= snapshot.timestamp - seconds && row.timestamp <= snapshot.timestamp);
  const values = rows.map(row => valueTreasuryAmount(row.raw, row.asset.decimals, prices[row.asset.address.toLowerCase()]));
  return { count: rows.length, usd: values.every(value => value !== null) ? values.reduce<number>((sum, value) => sum + (value ?? 0), 0) : null };
}
