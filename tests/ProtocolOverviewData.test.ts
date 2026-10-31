import { describe, expect, it, vi } from "vitest";
import { CONTRACTS } from "../src/config/contracts";
import { MINER_POOLS } from "../src/features/dashboard/config";
import { GOVERNANCE_ADDRESSES as A } from "../src/features/governance/governanceSpec";
import {
  minerEmissionEstimate, protocolPairFromMarkets, protocolPercent, PROTOCOL_READS as R,
  readProtocolOverview, type ProtocolReader,
} from "../src/features/dashboard/protocolData";

const U = 10n ** 18n, head = 1000;
const hash = (number: number) => `0x${number.toString(16).padStart(64, "0")}`;
const pairAddress = "0x0000000000000000000000000000000000000010";
const unknownPool = "0x0000000000000000000000000000000000000020";
const wpls = "0xa1077a294dde1b09bb078844df40758a5d0f9a27";
const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
function fixture(options: { fail?: (target: string, signature: string) => boolean; mismatchedAllocation?: boolean; wrongMiner?: boolean; wrongPair?: boolean; tooManyPools?: boolean; impossibleSupply?: boolean; reorg?: boolean; stale?: boolean; noPair?: boolean; unstarted?: boolean } = {}) {
  const now = Math.floor(Date.now() / 1000) - (options.stale ? 500 : 0);
  const participants = [...MINER_POOLS.map(pool => pool.address), CONTRACTS.nft, unknownPool];
  const points = [400n, 300n, 200n, 100n, 0n, 1000n];
  const block = vi.fn(async (tag: number | "latest") => {
    const number = tag === "latest" ? head : tag;
    return { number, timestamp: now - (head - number) * 12, hash: hash(options.reorg && tag === head ? head + 1 : number) };
  });
  const call = vi.fn(async (target: string, signature: string, args: readonly unknown[], pinned: number): Promise<unknown> => {
    expect(pinned).toBe(head);
    if (options.fail?.(target, signature)) throw new Error("Read unavailable");
    if (same(target, A.masterChef)) {
      if (signature === R.poolLength) return options.tooManyPools ? 101n : BigInt(participants.length);
      if (signature === R.totalAlloc) return options.mismatchedAllocation ? 1999n : 2000n;
      if (signature === R.emission) return U;
      if (signature === R.virtualSupply) return 2000n * U;
      if (signature === R.start) return options.unstarted ? 1001n : 0n;
      if (signature === R.poolInfo) { const id = Number(args[0]); return [points[id], 0n, participants[id]]; }
    }
    if (same(target, CONTRACTS.degen)) {
      if (signature === R.supply) return (options.impossibleSupply ? 1n : 1000n) * U;
      if (signature === R.balance) return same(String(args[0]), pairAddress) ? 100n * U : U;
    }
    if (same(target, A.treasury)) {
      if (signature === R.governors) return 2n;
      if (signature === R.votingBase) return 1000n * U;
    }
    if (same(target, pairAddress)) {
      if (signature === R.token0) return options.wrongPair ? CONTRACTS.oink : CONTRACTS.degen;
      if (signature === R.token1) return wpls;
    }
    const index = MINER_POOLS.findIndex(pool => same(pool.address, target));
    if (index >= 0) {
      if (signature === R.accounting) return BigInt(index + 1) * 100n * U;
      if (signature === R.shares) return BigInt(index + 1) * 10n * U;
      if (signature === R.masterchef) return options.wrongMiner ? unknownPool : A.masterChef;
      if (signature === R.poolId) return BigInt(index);
    }
    throw new Error(`Unexpected read ${target}: ${signature}`);
  });
  const reader: ProtocolReader = { block, call, pair: async () => options.noPair ? null : { address: pairAddress, baseSymbol: "DEGEN", quoteSymbol: "PLS" } };
  return { reader, call, block };
}

describe("DEGEN protocol overview accounting", () => {
  it("pins the complete registry and every balance to one canonical block", async () => {
    const { reader, call, block } = fixture();
    const result = await readProtocolOverview(reader);
    expect(result).toMatchObject({ block: head, hash: hash(head), blockSeconds: 12 });
    expect(call.mock.calls.every(row => row[3] === head)).toBe(true);
    expect(block).toHaveBeenCalledWith(head);
    expect(result.stats).toEqual({ registeredPools: 6, allocatedPools: 5, nftPools: 1, governorProposals: 2, senators: null });
    expect(result.pools?.[0]).toMatchObject({ allocRaw: 400n, percent: 20 });
    expect(result.pools?.[5]).toMatchObject({ label: "Pool #5", percent: 50 });
    expect(result.pools?.reduce((sum, row) => sum + (row.percent ?? 0), 0)).toBe(100);
  });

  it("separates issued tokens from miner credit and preserves the exact supply total", async () => {
    const result = await readProtocolOverview(fixture().reader);
    expect(result.supply).toEqual({ totalRaw: 1000n * U, minerTokensRaw: 4n * U, pairTokensRaw: 100n * U, otherRaw: 896n * U });
    expect(result.minerAccountingRaw).toBe(1000n * U);
    expect(result.minerSharesRaw).toBe(100n * U);
    expect(result.votingBaseRaw).toBe(1000n * U);
    expect(result.virtualSupplyRaw).toBe(2000n * U);
    expect(result.governorTokensRaw).toBe(U);
    expect(result.treasuryTokensRaw).toBe(U);
    expect(result.miners.map(row => row.label)).toEqual(["1 month", "3 months", "1 year", "10 years"]);
    expect(result.miners.map(row => row.weightPercent)).toEqual([40, 30, 20, 10]);
    expect(result.pair).toMatchObject({ address: pairAddress, baseSymbol: "DEGEN", quoteSymbol: "PLS" });
  });

  it("annualizes current emissions with observed block timing and the full allocation denominator", async () => {
    const result = await readProtocolOverview(fixture().reader);
    const oneMonth = result.miners[0];
    expect(oneMonth.dailyRewardsRaw).toBe(360n * U); // 7200 observed blocks/day × 1 DEGEN × 5%.
    expect(oneMonth.apr).toBe(32_850); // 360 × 365 / 400 × 100.
    expect(result.miners[3].dailyRewardsRaw).toBe(1440n * U);
    expect(result.miners[3].apr).toBe(525_600);
  });

  it("keeps independent fields when a balance fails and withholds incomplete totals and shares", async () => {
    const result = await readProtocolOverview(fixture({ fail: (target, signature) => same(target, MINER_POOLS[0].address) && signature === R.accounting }).reader);
    expect(result.miners[3].accountingRaw).toBeNull();
    expect(result.miners[0].accountingRaw).toBe(400n * U);
    expect(result.minerAccountingRaw).toBeNull();
    expect(result.miners.every(row => row.weightPercent === null)).toBe(true);
    expect(result.supply.otherRaw).toBe(896n * U);
    expect(result.minerSharesRaw).toBe(100n * U);
  });

  it("does not renormalize around a failed registry row or fabricate unavailable allocation", async () => {
    const result = await readProtocolOverview(fixture({ fail: (target, signature) => same(target, A.masterChef) && signature === R.poolInfo }).reader);
    expect(result.pools).toBeNull();
    expect(result.stats.registeredPools).toBe(6);
    expect(result.stats.allocatedPools).toBeNull();
    expect(result.stats.nftPools).toBeNull();
    expect(result.miners.every(row => row.apr === null)).toBe(true);
    expect(result.supply.totalRaw).toBe(1000n * U);
  });

  it("withholds fractions and APR if complete allocation points disagree with the denominator", async () => {
    const result = await readProtocolOverview(fixture({ mismatchedAllocation: true }).reader);
    expect(result.pools).toHaveLength(6);
    expect(result.pools?.every(row => row.percent === null)).toBe(true);
    expect(result.miners.every(row => row.apr === null && row.dailyRewardsRaw === null)).toBe(true);
  });

  it("requires verified miner identity and does not assign an estimate to a changed dependency", async () => {
    const result = await readProtocolOverview(fixture({ wrongMiner: true }).reader);
    expect(result.miners.every(row => row.apr === null && row.dailyRewardsRaw === null)).toBe(true);
    expect(result.minerAccountingRaw).toBe(1000n * U);
  });

  it("does not count an unrelated pair or turn missing pair data into zero supply", async () => {
    for (const options of [{ wrongPair: true }, { noPair: true }]) {
      const result = await readProtocolOverview(fixture(options).reader);
      expect(result.pair).toBeNull();
      expect(result.supply.pairTokensRaw).toBeNull();
      expect(result.supply.otherRaw).toBeNull();
      expect(result.supply.minerTokensRaw).toBe(4n * U);
    }
    const impossible = await readProtocolOverview(fixture({ impossibleSupply: true }).reader);
    expect(impossible.supply.otherRaw).toBeNull();
  });

  it("caps registry scanning and rejects stale snapshots or a changed anchor", async () => {
    const oversized = fixture({ tooManyPools: true });
    const result = await readProtocolOverview(oversized.reader);
    expect(result.stats.registeredPools).toBeNull();
    expect(oversized.call.mock.calls.some(row => row[1] === R.poolInfo)).toBe(false);
    await expect(readProtocolOverview(fixture({ stale: true }).reader)).rejects.toThrow("Current protocol block unavailable");
    await expect(readProtocolOverview(fixture({ reorg: true }).reader)).rejects.toThrow("Protocol snapshot changed");
  });

  it("shows zero scheduled emissions before the start block while retaining the accounting balance", async () => {
    const result = await readProtocolOverview(fixture({ unstarted: true }).reader);
    expect(result.miners.every(row => row.dailyRewardsRaw === 0n && row.apr === 0)).toBe(true);
    expect(result.minerAccountingRaw).toBe(1000n * U);
  });
});

describe("protocol display calculations", () => {
  it("preserves percentage precision with quantities far above Number's safe integer range", () => {
    expect(protocolPercent(10n ** 70n, 4n * 10n ** 70n)).toBe(25);
    expect(protocolPercent(1n, 0n)).toBeNull();
    expect(protocolPercent(3n, 2n)).toBeNull();
    expect(minerEmissionEstimate(0n, U, 1n, 2n, 100, 1200, true).apr).toBeNull();
    expect(minerEmissionEstimate(U, U, 1n, 2n, 0, 1200, true).dailyRaw).toBeNull();
  });

  it("chooses only DEGEN/WPLS on PulseChain and prefers available liquidity", () => {
    const market = (pairAddress: string, liquidity: number) => ({ chainId: "pulsechain", pairAddress, baseToken: { address: CONTRACTS.degen }, quoteToken: { address: wpls }, liquidity: { usd: liquidity } });
    expect(protocolPairFromMarkets([
      { ...market(unknownPool, 999), chainId: "ethereum" },
      { ...market(unknownPool, 999), quoteToken: { address: CONTRACTS.oink } },
      market(unknownPool, 1), market(pairAddress, 100),
    ])).toEqual({ address: pairAddress, baseSymbol: "DEGEN", quoteSymbol: "PLS" });
    expect(protocolPairFromMarkets({ pairs: [] })).toBeNull();
    expect(protocolPairFromMarkets([{ ...market("invalid", 100) }])).toBeNull();
  });
});
