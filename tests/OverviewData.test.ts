import { Interface, toQuantity } from "ethers";
import { describe, expect, it, vi } from "vitest";
import { TREASURY, type DashboardAsset } from "../src/features/dashboard/config";
import { aggregateInflows, readOverviewSnapshot, readTreasuryInflows, type OverviewReader } from "../src/features/dashboard/overviewData";

const asset: DashboardAsset = { address: "0x0000000000000000000000000000000000000001", symbol: "TEST", decimals: 6, logo: "" };
const native: DashboardAsset = { address: "0x0000000000000000000000000000000000000002", symbol: "PLS", decimals: 18, logo: "", native: true };
const now = () => Math.floor(Date.now() / 1000);
function reader(overrides: Partial<OverviewReader> = {}): OverviewReader {
  return { snapshot: async () => ({ block: 123, timestamp: now() }), supply: async () => 10n ** 24n,
    balance: async () => 2_000_000n, prices: async () => ({ [asset.address]: 2 }), ...overrides };
}
describe("public overview balances", () => {
  it("pins every amount to one block and preserves token precision", async () => {
    const balances = vi.fn(async () => 2_000_000n), supply = vi.fn(async () => 10n ** 24n);
    const snapshot = await readOverviewSnapshot(reader({ balance: balances, supply }), [asset]);
    expect(balances).toHaveBeenCalledWith(asset, 123);
    expect(supply).toHaveBeenCalledWith(123);
    expect(snapshot.holdings[0]).toMatchObject({ raw: 2_000_000n, usd: 4 });
    expect(snapshot.totalUsd).toBe(4);
  });
  it("keeps missing balances and prices distinct from real zero holdings", async () => {
    const missing = await readOverviewSnapshot(reader({ balance: async () => { throw new Error("RPC down"); } }), [asset]);
    expect(missing.holdings[0].raw).toBeNull(); expect(missing.totalUsd).toBeNull(); expect(missing.pricedCount).toBe(0);
    const noPrice = await readOverviewSnapshot(reader({ prices: async () => ({}) }), [asset]);
    expect(noPrice.holdings[0].usd).toBeNull(); expect(noPrice.totalUsd).toBeNull();
    const zero = await readOverviewSnapshot(reader({ balance: async () => 0n, prices: async () => ({}) }), [asset]);
    expect(zero.totalUsd).toBe(0);
  });
  it("keeps successfully read holdings when supply alone fails and rejects stale blocks", async () => {
    const snapshot = await readOverviewSnapshot(reader({ supply: async () => { throw new Error("Supply unavailable"); } }), [asset]);
    expect(snapshot.supplyRaw).toBeNull(); expect(snapshot.totalUsd).toBe(4);
    await expect(readOverviewSnapshot(reader({ snapshot: async () => ({ block: 123, timestamp: now() - 300 }) }), [asset])).rejects.toThrow("Current treasury block unavailable");
  });
});

const event = new Interface(["event Transfer(address indexed from,address indexed to,uint256 value)"]);
const hash = (number: number) => `0x${number.toString(16).padStart(64, "0")}`;
function fixture(options: { oversized?: boolean; reorg?: boolean; wrongRecipient?: boolean } = {}) {
  const head = 100_000, timestamp = now();
  const log = (from: string, value: bigint, index: number) => {
    const encoded = event.encodeEventLog(event.getEvent("Transfer")!, [from, options.wrongRecipient ? from : TREASURY, value]);
    return { ...encoded, address: asset.address, blockNumber: toQuantity(head - 2), blockHash: hash(head - 2), transactionHash: hash(999), logIndex: toQuantity(index) };
  };
  const logs = [log("0x0000000000000000000000000000000000000003", 2_000_000n, 0), log(TREASURY, 5_000_000n, 1), log("0x0000000000000000000000000000000000000003", 0n, 2)];
  const send = vi.fn(async (method: string, params: unknown[]) => {
    if (method === "eth_chainId") return "0x171";
    if (method === "eth_getBlockByNumber") {
      const number = params[0] === "latest" ? head : Number(BigInt(params[0] as string));
      return { number: toQuantity(number), hash: options.reorg && params[0] !== "latest" && number === head ? hash(head + 1) : hash(number), timestamp: toQuantity(timestamp - (head - number) * 30) };
    }
    if (method === "eth_getLogs") {
      if (options.oversized) return Array(1000).fill(logs[0]);
      const range = params[0] as { fromBlock: string; toBlock: string; address: string[] };
      expect(range.address).not.toContain(native.address);
      return Number(BigInt(range.fromBlock)) <= head - 2 && Number(BigInt(range.toBlock)) >= head - 2 ? logs : [];
    }
    throw new Error("Unexpected method");
  });
  return { send };
}
describe("verified treasury inflow history", () => {
  it("covers the whole month, excludes self/zero/native receipts and values the actual token units", async () => {
    const rpc = fixture(), snapshot = await readTreasuryInflows(rpc, null, [asset, native]);
    expect(snapshot.fromTimestamp).toBeLessThanOrEqual(snapshot.timestamp - 30 * 86400);
    expect(snapshot.rows).toHaveLength(1);
    expect(snapshot.rows[0]).toMatchObject({ raw: 2_000_000n, asset });
    expect(aggregateInflows(snapshot, 86400, { [asset.address]: 2 })).toEqual({ count: 1, usd: 4 });
    expect(aggregateInflows(snapshot, 86400, {})).toEqual({ count: 1, usd: null });
  });
  it("reuses canonical complete history without scanning it again", async () => {
    const rpc = fixture(), previous = await readTreasuryInflows(rpc, null, [asset]);
    rpc.send.mockClear();
    const next = await readTreasuryInflows(rpc, previous, [asset]);
    expect(next.rows).toEqual(previous.rows);
    expect(rpc.send.mock.calls.some(([method]) => method === "eth_getLogs")).toBe(false);
  });
  it("refuses incomplete, unexpected or reorganized history instead of displaying zero totals", async () => {
    await expect(readTreasuryInflows(fixture({ oversized: true }), null, [asset])).rejects.toThrow("incomplete");
    await expect(readTreasuryInflows(fixture({ wrongRecipient: true }), null, [asset])).rejects.toThrow("Unexpected");
    await expect(readTreasuryInflows(fixture({ reorg: true }), null, [asset])).rejects.toThrow("changed");
  });
  it("does not claim a wrong-chain history is valid", async () => {
    await expect(readTreasuryInflows({ send: async () => "0x1" }, null, [asset])).rejects.toThrow("Wrong chain");
  });
  it("stops launching RPC work when the entire history scan budget expires", async () => {
    const realNow = Date.now(), rpc = fixture();
    let elapsed = 0;
    const clock = vi.spyOn(Date, "now").mockImplementation(() => realNow + elapsed);
    const send = vi.fn(async (method: string, params: unknown[]) => {
      const result = await rpc.send(method, params);
      if (method === "eth_getLogs") elapsed = 40_001;
      return result;
    });
    try {
      await expect(readTreasuryInflows({ send }, null, [asset])).rejects.toThrow("read budget expired");
      expect(send.mock.calls.map(([method]) => method)).toEqual([
        "eth_chainId", "eth_getBlockByNumber", "eth_getBlockByNumber", "eth_getLogs",
      ]);
    } finally { clock.mockRestore(); }
  });
});
