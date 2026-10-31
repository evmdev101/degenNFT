import { Interface, toQuantity } from "ethers";
import { describe, expect, it, vi } from "vitest";
import { GOVERNANCE_ADDRESSES } from "../src/features/governance/governanceSpec";
import { DASHBOARD_ASSETS, FARM_REGISTRY, MINER_POOLS, TREASURY } from "../src/features/dashboard/config";
import {
  ActivityAnchorChangedError, FARM_ACTIVITY_EVENTS, GOVERNANCE_ACTIVITY_EVENTS, MINER_ACTIVITY_EVENTS,
  TRANSFER_ACTIVITY_EVENT, decodeProtocolActivity, mergeProtocolActivity, readProtocolActivity,
} from "../src/features/dashboard/activityData";

const hash = (id: number) => `0x${id.toString(16).padStart(64, "0")}`;
const user = "0x0000000000000000000000000000000000000001";
const recipient = "0x0000000000000000000000000000000000000002";
const token = DASHBOARD_ASSETS.find(asset => asset.symbol === "DEGEN")!;
const now = () => Math.floor(Date.now() / 1000);
function log(iface: Interface, name: string, args: unknown[], address: string, id = 1, block = 29_999) {
  return { ...iface.encodeEventLog(iface.getEvent(name)!, args), address, transactionHash: hash(id),
    blockNumber: toQuantity(block), blockHash: hash(block), logIndex: toQuantity(id) };
}
const minerLog = () => log(MINER_ACTIVITY_EVENTS, "GiftDeposit", [user, recipient, 123n * 10n ** 18n, 5n * 10n ** 18n, 100n], MINER_POOLS[0].address);
const farmLog = () => log(FARM_ACTIVITY_EVENTS, "SelfHarvest", [user, 9n * 10n ** 18n], FARM_REGISTRY[0].address, 2);
const treasuryLog = () => log(TRANSFER_ACTIVITY_EVENT, "Transfer", [user, TREASURY, 7n * 10n ** 18n], token.address, 3);
const governanceLog = () => log(GOVERNANCE_ACTIVITY_EVENTS.farms, "AddVotes", [0n, 9n, user, 3n, true], GOVERNANCE_ADDRESSES.farms, 4);

function rpcFixture(records = [minerLog(), farmLog(), treasuryLog(), governanceLog()], options: { reorg?: boolean; failedCategory?: boolean; oversized?: boolean } = {}) {
  const head = 30_000, timestamp = now();
  return { send: vi.fn(async (method: string, params: unknown[]) => {
    if (method === "eth_chainId") return "0x171";
    if (method === "eth_getBlockByNumber") {
      const block = params[0] === "latest" ? head : Number(BigInt(params[0] as string));
      return { number: toQuantity(block), hash: hash(options.reorg && params[0] !== "latest" && block === head ? head + 1 : block),
        timestamp: toQuantity(timestamp - (head - block) * 10) };
    }
    if (method === "eth_getLogs") {
      const filter = params[0] as { address: string[]; topics: (string | string[] | null)[]; fromBlock: string; toBlock: string };
      if (options.failedCategory && filter.address.includes(FARM_REGISTRY[0].address)) throw new Error("Farms unavailable");
      if (options.oversized) return Array(1000).fill(minerLog());
      return records.filter(record => filter.address.map(address => address.toLowerCase()).includes(record.address.toLowerCase())
        && Number(BigInt(record.blockNumber)) >= Number(BigInt(filter.fromBlock)) && Number(BigInt(record.blockNumber)) <= Number(BigInt(filter.toBlock))
        && filter.topics.every((topic, index) => topic === null || (Array.isArray(topic) ? topic.includes(record.topics[index]) : topic.toLowerCase() === record.topics[index]?.toLowerCase())));
    }
    throw new Error("Unexpected RPC method");
  }) };
}

describe("DEGEN protocol activity", () => {
  it("decodes actual miner, farm, treasury and indexed governance events", () => {
    expect(decodeProtocolActivity(minerLog())).toMatchObject({ category: "Miners", label: "10 years · Miner gifted", raw: 123n * 10n ** 18n, symbol: "DEGEN" });
    expect(decodeProtocolActivity(farmLog())).toMatchObject({ category: "Farms", raw: 9n * 10n ** 18n, symbol: "DEGEN rewards" });
    expect(decodeProtocolActivity(treasuryLog())).toMatchObject({ category: "Treasury", label: "Treasury received", raw: 7n * 10n ** 18n });
    expect(decodeProtocolActivity(governanceLog())).toMatchObject({ category: "Governance", label: "Vote for proposal #9", raw: undefined });
    const basicVote = log(GOVERNANCE_ACTIVITY_EVENTS.basic, "AddVotes", [3n, 2n, user, 1n, false], GOVERNANCE_ADDRESSES.basic);
    expect(decodeProtocolActivity(basicVote)).toMatchObject({ category: "Governance", label: "Vote against proposal #2" });
  });

  it("distinguishes transfers of miner shares from DEGEN and skips unrelated/self/zero transfers", () => {
    const transfer = log(MINER_ACTIVITY_EVENTS, "TransferStake", [user, recipient, 22n, 4n], MINER_POOLS[2].address);
    expect(decodeProtocolActivity(transfer)).toMatchObject({ raw: 22n, symbol: "shares", label: "3 months · Miner transferred" });
    for (const args of [[user, recipient, 1n], [TREASURY, TREASURY, 1n], [user, TREASURY, 0n]]) {
      expect(decodeProtocolActivity(log(TRANSFER_ACTIVITY_EVENT, "Transfer", args, token.address))).toBeNull();
    }
    expect(decodeProtocolActivity({ ...minerLog(), removed: true })).toBeNull();
  });

  it("pins a complete range, validates event blocks, orders events and never submits transactions", async () => {
    const rpc = rpcFixture(), page = await readProtocolActivity(rpc);
    expect(page).toMatchObject({ from: 5001, to: 30_000, head: 30_000, headHash: hash(30_000) });
    expect(page.rows.map(row => row.category)).toEqual(["Governance", "Treasury", "Farms", "Miners"]);
    expect(page.rows.every(row => row.timestamp === page.timestamp - 10)).toBe(true);
    const queries = rpc.send.mock.calls.filter(([method]) => method === "eth_getLogs");
    expect(queries).toHaveLength(7);
    expect(queries.every(([, params]) => (params[0] as { address: string[] }).address.length <= 10)).toBe(true);
    expect(new Set(rpc.send.mock.calls.map(([method]) => method))).toEqual(new Set(["eth_chainId", "eth_getBlockByNumber", "eth_getLogs"]));
  });

  it("loads the next contiguous older page under a canonical anchor and deduplicates keys", async () => {
    const rpc = rpcFixture(), initial = await readProtocolActivity(rpc), older = await readProtocolActivity(rpc, { end: initial.from - 1, anchor: initial });
    expect(older.from).toBe(0); expect(older.to).toBe(initial.from - 1); expect(older.rows).toEqual([]);
    expect(mergeProtocolActivity(initial.rows, initial.rows)).toEqual(initial.rows);
    expect(() => mergeProtocolActivity(initial.rows, [{ ...initial.rows[0], blockHash: hash(5) }])).toThrow(ActivityAnchorChangedError);
    await expect(readProtocolActivity(rpc, { end: initial.head, anchor: initial })).rejects.toThrow("Invalid activity range");
  });

  it("rejects failed, truncated, wrong-chain and reorganized reads without inventing an empty page", async () => {
    await expect(readProtocolActivity(rpcFixture(undefined, { failedCategory: true }))).rejects.toThrow("Farms unavailable");
    await expect(readProtocolActivity(rpcFixture(undefined, { oversized: true }))).rejects.toThrow("incomplete");
    await expect(readProtocolActivity({ send: async () => "0x1" })).rejects.toThrow("Wrong chain");
    await expect(readProtocolActivity(rpcFixture(undefined, { reorg: true }))).rejects.toThrow(ActivityAnchorChangedError);
    await expect(readProtocolActivity(rpcFixture(), { anchor: { head: 29_000, headHash: hash(99) } })).rejects.toThrow(ActivityAnchorChangedError);
    const malformed = { ...treasuryLog(), blockHash: hash(5) };
    await expect(readProtocolActivity(rpcFixture([malformed]))).rejects.toThrow(ActivityAnchorChangedError);
  });

  it("cancels a pending scan and launches no work for an already cancelled request", async () => {
    const rpc = rpcFixture(), controller = new AbortController();
    controller.abort();
    await expect(readProtocolActivity(rpc, { signal: controller.signal })).rejects.toBeDefined();
    expect(rpc.send).not.toHaveBeenCalled();
    const active = new AbortController(), pendingRpc = rpcFixture();
    const original = pendingRpc.send.getMockImplementation()!;
    pendingRpc.send.mockImplementation((method, params) => method === "eth_getLogs" ? new Promise(() => {}) : original(method, params));
    const pending = readProtocolActivity(pendingRpc, { signal: active.signal });
    await vi.waitFor(() => expect(pendingRpc.send.mock.calls.some(([method]) => method === "eth_getLogs")).toBe(true));
    active.abort(); await expect(pending).rejects.toBeDefined();
    expect(pendingRpc.send.mock.calls.filter(([method]) => method === "eth_getBlockByNumber")).toHaveLength(1);
  });
});
