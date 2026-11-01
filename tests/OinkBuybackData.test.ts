import { Interface, toQuantity } from "ethers";
import { describe, expect, it, vi } from "vitest";
import { CONTRACTS } from "../src/config/contracts";
import { TREASURY } from "../src/features/dashboard/config";
import { aggregateBuybacks, BUYBACK_EVENTS, OINK_BUYBACK_ADDRESS, OINK_BUYBACK_ADDRESSES, readBuybacks, type BuybackSeed } from "../src/features/dashboard/buybackData";

const hash = (id: number) => `0x${id.toString(16).padStart(64, "0")}`;
const now = () => Math.floor(Date.now() / 1000);
const unit = 10n ** 18n;
const identity = new Interface(["function OINK() view returns(address)", "function WPLS() view returns(address)", "function treasury() view returns(address)"]);
function fixture(options: { reorg?: boolean; oldAnchor?: boolean; wrongIdentity?: boolean; wrongChain?: boolean; duplicates?: boolean; removed?: boolean; noLogs?: boolean; failLogs?: boolean; anotherContract?: boolean; untrackedContract?: boolean } = {}) {
  const timestamp = now();
  const seed: BuybackSeed = { contracts: OINK_BUYBACK_ADDRESSES.map(address => ({ address, fromBlock: 1 })), block: 100, hash: hash(100), timestamp: timestamp - 100,
    rows: [{ address: OINK_BUYBACK_ADDRESS, key: `${hash(1)}:0`, tx: hash(1), block: 50, blockHash: hash(50), index: 0, timestamp: timestamp - 40 * 86400, spentRaw: String(100n * unit), oinkRaw: String(50n * unit) }] };
  const log = { ...BUYBACK_EVENTS.encodeEventLog(BUYBACK_EVENTS.getEvent("BoughtOink")!, [20n * unit, 7n * unit + 123n]),
    address: options.untrackedContract ? CONTRACTS.degen : OINK_BUYBACK_ADDRESS, blockNumber: toQuantity(109), blockHash: hash(109), transactionHash: hash(2), logIndex: "0x1", removed: options.removed };
  const rpc = { send: vi.fn(async (method: string, params: unknown[]) => {
    if (method === "eth_chainId") return options.wrongChain ? "0x1" : "0x171";
    if (method === "eth_getBlockByNumber") {
      const block = params[0] === "latest" ? 110 : Number(BigInt(params[0] as string));
      return { number: toQuantity(block), hash: hash(options.reorg && params[0] !== "latest" && block === 110 || options.oldAnchor && block === 100 ? block + 1 : block), timestamp: toQuantity(timestamp - (110 - block) * 10) };
    }
    if (method === "eth_call") {
      const call = params[0] as { to: string; data: string };
      expect(OINK_BUYBACK_ADDRESSES).toContain(call.to); expect(params[1]).toBe(toQuantity(110));
      const name = identity.parseTransaction({ data: call.data })!.name;
      const value = name === "OINK" ? CONTRACTS.oink : name === "treasury" ? TREASURY : "0xa1077a294dde1b09bb078844df40758a5d0f9a27";
      return identity.encodeFunctionResult(name, [options.wrongIdentity ? CONTRACTS.degen : value]);
    }
    if (method === "eth_getLogs") {
      if (options.failLogs) throw new Error("RPC down");
      const filter = params[0] as { address: string[]; topics: string[]; fromBlock: string; toBlock: string };
      expect(filter.address).toEqual([...OINK_BUYBACK_ADDRESSES]);
      expect(filter.topics).toEqual([BUYBACK_EVENTS.getEvent("BoughtOink")!.topicHash]);
      return options.noLogs ? [] : options.duplicates ? [log, log] : options.anotherContract ? [log, { ...log, address: OINK_BUYBACK_ADDRESSES[1], transactionHash: hash(3) }] : [log];
    }
    throw new Error("Unexpected RPC method");
  }) };
  return { seed, rpc, timestamp, log };
}

describe("verified OINK buyback statistics", () => {
  it("combines historical purchases and fresh events exactly once, keeping full precision", async () => {
    const { seed, rpc } = fixture({ duplicates: true });
    const result = await readBuybacks(rpc, null, seed);
    expect(result.rows).toHaveLength(2);
    expect(result.rows[0]).toMatchObject({ tx: hash(2), oinkRaw: 7n * unit + 123n, spentRaw: 20n * unit });
    expect(result.totalOinkRaw).toBe(57n * unit + 123n);
    expect(result.totalSpentRaw).toBe(120n * unit);
    expect(aggregateBuybacks(result, 86400)).toEqual({ count: 1, oinkRaw: 7n * unit + 123n, spentRaw: 20n * unit });
    expect(aggregateBuybacks(result).count).toBe(2);
    expect(rpc.send.mock.calls.filter(([method]) => method === "eth_getLogs")[0][1]).toEqual([expect.objectContaining({ fromBlock: "0x65", toBlock: "0x6e" })]);
    expect(rpc.send.mock.calls.every(([method]) => !/sendTransaction|sign/.test(method))).toBe(true);
  });
  it("reuses canonical complete history without rescanning old purchases", async () => {
    const { seed, rpc } = fixture();
    const first = await readBuybacks(rpc, null, seed);
    rpc.send.mockClear();
    const next = await readBuybacks(rpc, first, seed);
    expect(next.totalOinkRaw).toBe(first.totalOinkRaw);
    expect(rpc.send.mock.calls.some(([method]) => method === "eth_getLogs")).toBe(false);
  });
  it("counts purchases across verified contracts without adding treasury balances", async () => {
    const { seed, rpc } = fixture({ anotherContract: true });
    const result = await readBuybacks(rpc, null, seed);
    expect(result.rows).toHaveLength(3);
    expect(result.totalOinkRaw).toBe(64n * unit + 246n);
    expect(result.totalSpentRaw).toBe(140n * unit);
    expect(new Set(result.rows.map(row => row.address.toLowerCase())).size).toBe(2);
  });
  it.each([
    [{ wrongChain: true }, "PulseChain required"],
    [{ wrongIdentity: true }, "identity changed"],
    [{ oldAnchor: true }, "archive anchor changed"],
    [{ reorg: true }, "head changed"],
    [{ removed: true }, "Unexpected buyback record"],
    [{ untrackedContract: true }, "Unexpected buyback record"],
    [{ failLogs: true }, "RPC down"],
  ] as const)("refuses unverifiable or incomplete history: %j", async (options, message) => {
    const { seed, rpc } = fixture(options);
    await expect(readBuybacks(rpc, null, seed)).rejects.toThrow(message);
  });
  it("keeps a genuine empty recent window separate from a failed read", async () => {
    const { seed, rpc } = fixture({ noLogs: true });
    const result = await readBuybacks(rpc, null, seed);
    expect(result.totalOinkRaw).toBe(50n * unit);
    expect(aggregateBuybacks(result, 86400)).toEqual({ count: 0, oinkRaw: 0n, spentRaw: 0n });
  });
});
