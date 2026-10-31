import { Interface, toQuantity } from "ethers";
import { describe, expect, it, vi } from "vitest";
import { TREASURY, type DashboardAsset } from "../src/features/dashboard/config";
import { aggregateInflows, readOlderTreasuryInflows, readTreasuryInflows, type TreasuryInflows } from "../src/features/dashboard/overviewData";

const asset: DashboardAsset = { address: "0x0000000000000000000000000000000000000001", symbol: "TEST", decimals: 6, logo: "" };
const native: DashboardAsset = { address: "0x0000000000000000000000000000000000000002", symbol: "PLS", decimals: 18, logo: "", native: true };
const sender = "0x0000000000000000000000000000000000000003";
const transfer = new Interface(["event Transfer(address indexed from,address indexed to,uint256 value)"]);
const head = 1_000_000;
const hash = (number: number) => "0x" + number.toString(16).padStart(64, "0");
const currentTimestamp = () => Math.floor(Date.now() / 1000);
function log(block: number, index = 0, value = 2_000_001n, from = sender, to = TREASURY) {
  return { ...transfer.encodeEventLog(transfer.getEvent("Transfer")!, [from, to, value]),
    address: asset.address, blockNumber: toQuantity(block), blockHash: hash(block),
    transactionHash: hash(block * 100 + index), logIndex: toQuantity(index) };
}
function fixture(logs: ReturnType<typeof log>[] = [], options: { wrongChain?: boolean; reorg?: boolean; oversized?: boolean } = {}) {
  const timestamp = currentTimestamp();
  let anchorReads = 0;
  const send = vi.fn(async (method: string, params: unknown[]): Promise<unknown> => {
    if (method === "eth_chainId") return options.wrongChain ? "0x1" : "0x171";
    if (method === "eth_getBlockByNumber") {
      const number = params[0] === "latest" ? head : Number(BigInt(params[0] as string));
      if (number === head && params[0] !== "latest") anchorReads++;
      return { number: toQuantity(number), hash: options.reorg && anchorReads > 1 && number === head ? hash(head + 1) : hash(number), timestamp: toQuantity(timestamp - (head - number) * 10) };
    }
    if (method === "eth_getLogs") {
      const range = params[0] as { fromBlock: string; toBlock: string; address: string[] };
      expect(range.address).not.toContain(native.address);
      if (options.oversized) return Array(1000).fill(log(700_000));
      return logs.filter(row => Number(BigInt(row.blockNumber)) >= Number(BigInt(range.fromBlock)) && Number(BigInt(row.blockNumber)) <= Number(BigInt(range.toBlock)));
    }
    throw new Error(`Unexpected method ${method}`);
  });
  const anchor: TreasuryInflows = { from: 725_001, to: head, fromTimestamp: timestamp - 2_749_990, timestamp, hash: hash(head), rows: [], boundaryRowsIncluded: true };
  return { send, anchor };
}
function ranges(send: ReturnType<typeof fixture>["send"]) {
  return send.mock.calls.filter(([method]) => method === "eth_getLogs").map(([, params]) => {
    const range = params[0] as { fromBlock: string; toBlock: string };
    return { from: Number(BigInt(range.fromBlock)), to: Number(BigInt(range.toBlock)) };
  });
}

describe("treasury inflow pagination", () => {
  it("retains receipts from the month boundary chunk without changing summary totals", async () => {
    const rpc = fixture([log(head - 2), log(730_000), log(700_000)]);
    const normal = await readTreasuryInflows(rpc, null, [asset, native]);
    expect(normal.rows.map(row => row.block)).toEqual([head - 2]);
    const initial = await readTreasuryInflows(rpc, null, [asset, native], { includeBoundaryRows: true });
    expect(initial.rows.map(row => row.block)).toEqual([head - 2, 730_000]);
    expect(initial.from).toBe(725_001);
    expect(initial.boundaryRowsIncluded).toBe(true);
    expect(aggregateInflows(initial, 30 * 86400, { [asset.address]: 2 })).toEqual({ count: 1, usd: 4.000002 });
    rpc.send.mockClear();
    const older = await readOlderTreasuryInflows(rpc, initial, undefined, [asset, native]);
    expect(ranges(rpc.send)[0].to).toBe(initial.from - 1);
    expect(older.rows.map(row => row.block)).toEqual([700_000]);
    expect([...initial.rows, ...older.rows].map(row => row.block)).toEqual([head - 2, 730_000, 700_000]);
  });

  it("also recovers the boundary receipts when passed a legacy month-filtered snapshot", async () => {
    const rpc = fixture([log(head - 2), log(730_000), log(700_000)]);
    const initial = await readTreasuryInflows(rpc, null, [asset]);
    const older = await readOlderTreasuryInflows(rpc, initial, undefined, [asset]);
    expect(older.rows.map(row => row.block)).toEqual([730_000, 700_000]);
    expect(older.rows.every(row => row.timestamp < initial.timestamp - 30 * 86400)).toBe(true);
  });

  it("advances through empty bounded pages and reaches the beginning only at block zero", async () => {
    const rpc = fixture();
    const first = await readOlderTreasuryInflows(rpc, rpc.anchor, undefined, [asset]);
    expect(first).toMatchObject({ from: 425_001, to: 725_000, rows: [], anchorBlock: head, anchorHash: hash(head) });
    const firstRanges = ranges(rpc.send);
    expect(firstRanges).toHaveLength(12);
    for (let index = 1; index < firstRanges.length; index++) expect(firstRanges[index].to).toBe(firstRanges[index - 1].from - 1);
    const second = await readOlderTreasuryInflows(rpc, rpc.anchor, first.from - 1, [asset]);
    expect(second.from).toBe(125_001);
    const last = await readOlderTreasuryInflows(rpc, rpc.anchor, second.from - 1, [asset]);
    expect(last.from).toBe(0);
    expect(last.to).toBe(125_000);
  });

  it("deduplicates events, sorts newest first and stops after a complete chunk has enough rows", async () => {
    const entries = Array.from({ length: 12 }, (_, index) => log(710_000, index));
    const rpc = fixture([entries[1], ...entries, log(711_000, 20, 0n), log(711_000, 21, 99n, TREASURY)]);
    const page = await readOlderTreasuryInflows(rpc, rpc.anchor, undefined, [asset]);
    expect(page.rows).toHaveLength(12);
    expect(page.rows.map(row => row.index)).toEqual(Array.from({ length: 12 }, (_, index) => 11 - index));
    expect(page.rows[0].raw).toBe(2_000_001n);
    expect(ranges(rpc.send)).toEqual([{ from: 700_001, to: 725_000 }]);
    const replay = await readOlderTreasuryInflows(rpc, rpc.anchor, undefined, [asset]);
    expect(replay.rows.map(row => row.key)).toEqual(page.rows.map(row => row.key));
  });

  it("rejects wrong chains, reorganized anchors and potentially truncated responses", async () => {
    const wrong = fixture([], { wrongChain: true });
    await expect(readOlderTreasuryInflows(wrong, wrong.anchor, undefined, [asset])).rejects.toThrow("Wrong chain");
    const reorganized = fixture([], { reorg: true });
    await expect(readOlderTreasuryInflows(reorganized, reorganized.anchor, undefined, [asset])).rejects.toThrow("changed");
    const truncated = fixture([], { oversized: true });
    await expect(readOlderTreasuryInflows(truncated, truncated.anchor, undefined, [asset])).rejects.toThrow("incomplete");
  });

  it("rejects a conflicting event identity even when the duplicates span separate chunks", async () => {
    const first = log(710_000), second = { ...log(690_000), transactionHash: first.transactionHash };
    const rpc = fixture([first, second]);
    await expect(readOlderTreasuryInflows(rpc, rpc.anchor, undefined, [asset])).rejects.toThrow("Conflicting");
  });

  it("rejects removed, wrong-recipient, out-of-range and noncanonical event records", async () => {
    const invalid = [
      { ...log(710_000), removed: true },
      log(710_000, 0, 1n, sender, sender),
      { ...log(710_000), blockHash: hash(1) },
      { ...log(710_000), address: native.address },
    ];
    for (const row of invalid) {
      const rpc = fixture([row]);
      await expect(readOlderTreasuryInflows(rpc, rpc.anchor, undefined, [asset])).rejects.toThrow();
    }
    const rpc = fixture();
    const send = async (method: string, params: unknown[]) => method === "eth_getLogs" ? [log(999_998)] : rpc.send(method, params);
    await expect(readOlderTreasuryInflows({ send }, rpc.anchor, undefined, [asset])).rejects.toThrow("range");
  });

  it("does not use filtered cached history for a full boundary scan or retain an unbounded cache", async () => {
    const rpc = fixture([log(730_000)]);
    const filtered = await readTreasuryInflows(rpc, null, [asset]);
    rpc.send.mockClear();
    const initial = await readTreasuryInflows(rpc, filtered, [asset], { includeBoundaryRows: true });
    expect(initial.rows.map(row => row.block)).toEqual([730_000]);
    expect(ranges(rpc.send).length).toBeGreaterThan(0);
    rpc.send.mockClear();
    await readTreasuryInflows(rpc, { ...initial, fromTimestamp: initial.timestamp - 61 * 86400 }, [asset], { includeBoundaryRows: true });
    expect(ranges(rpc.send).length).toBeGreaterThan(0);
  });

  it("rejects invalid cursors before doing any RPC work", async () => {
    const rpc = fixture();
    for (const cursor of [-2, 1.5, rpc.anchor.from]) await expect(readOlderTreasuryInflows(rpc, rpc.anchor, cursor, [asset])).rejects.toThrow("cursor");
    expect(rpc.send).not.toHaveBeenCalled();
  });

  it("cancels an in-flight page promptly and launches no more RPC work", async () => {
    const rpc = fixture(), controller = new AbortController();
    const send = vi.fn((method: string, params: unknown[]) => method === "eth_getLogs" ? new Promise(() => {}) : rpc.send(method, params));
    const result = readOlderTreasuryInflows({ send }, rpc.anchor, undefined, [asset], controller.signal).catch(error => error);
    await vi.waitFor(() => expect(send.mock.calls.some(([method]) => method === "eth_getLogs")).toBe(true));
    const count = send.mock.calls.length;
    controller.abort(new Error("Page cancelled"));
    expect(await result).toMatchObject({ message: "Page cancelled" });
    await Promise.resolve();
    expect(send).toHaveBeenCalledTimes(count);
    const beforeStart = new AbortController(); beforeStart.abort(new Error("Already cancelled"));
    await expect(readOlderTreasuryInflows(rpc, rpc.anchor, undefined, [asset], beforeStart.signal)).rejects.toThrow("Already cancelled");
  });

  it("stops launching requests once the whole-page budget expires", async () => {
    const realNow = Date.now(), rpc = fixture();
    let elapsed = 0;
    const clock = vi.spyOn(Date, "now").mockImplementation(() => realNow + elapsed);
    const send = vi.fn(async (method: string, params: unknown[]) => {
      const result = await rpc.send(method, params);
      if (method === "eth_getLogs") elapsed = 40_001;
      return result;
    });
    try {
      await expect(readOlderTreasuryInflows({ send }, rpc.anchor, undefined, [asset])).rejects.toThrow("read budget expired");
      expect(send.mock.calls.map(([method]) => method)).toEqual(["eth_chainId", "eth_getBlockByNumber", "eth_getBlockByNumber", "eth_getLogs"]);
    } finally { clock.mockRestore(); }
  });
});
