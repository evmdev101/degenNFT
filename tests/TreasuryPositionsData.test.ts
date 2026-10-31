import { beforeEach, describe, expect, it, vi } from "vitest";
import { combineTreasuryPositions, readPublicTreasuryPositions } from "../src/features/dashboard/treasuryPositions";
import { DASHBOARD_ASSETS, FARM_REGISTRY, TREASURY } from "../src/features/dashboard/config";
import type { OverviewSnapshot } from "../src/features/dashboard/overviewData";
import type { PortfolioReader, PortfolioSnapshot } from "../src/features/dashboard/portfolioData";

const mocks = vi.hoisted(() => ({ provider: vi.fn(), overview: vi.fn(), portfolio: vi.fn() }));
vi.mock("../src/lib/chain", () => ({ getPublicProvider: mocks.provider }));
vi.mock("../src/features/dashboard/overviewData", () => ({ readOverviewSnapshot: mocks.overview }));
vi.mock("../src/features/dashboard/portfolioData", () => ({ readPortfolioWithReader: mocks.portfolio }));

function wallet(totalUsd: number | null = 12): OverviewSnapshot {
  return { block: 101, timestamp: 1700000000, supplyRaw: 100n, holdings: [], prices: {}, totalUsd, knownUsd: 12, pricedCount: 0 };
}
function positions(farmUsd: number | null = 4): PortfolioSnapshot {
  return {
    account: TREASURY, blockNumber: 101, observedAt: 1700000000000, degenPriceUsd: 1,
    wallet: { raw: 100n, usd: 100 },
    miners: { raw: 9999n, usd: 9999, count: 1, matureCount: 0, knownRaw: 9999n, knownCount: 1, complete: true, pools: [] },
    farms: { positions: [{ ...FARM_REGISTRY[0], tokenAddress: null, depositedRaw: 3n, usd: farmUsd, pendingRaw: 999999n, stakeCount: 1, complete: farmUsd !== null }],
      usd: farmUsd, knownUsd: 4, positionCount: 1, complete: farmUsd !== null },
    rewards: { farmRaw: 9000n, helperRaw: 2000n, totalRaw: 11000n, usd: 11000, complete: true },
    nft: { countRaw: 10n, pendingDegenRaw: 2222n, pendingOinkRaw: 3333n },
    totalUsd: 21103, knownTotalUsd: 21103, complete: true,
  };
}

beforeEach(() => { mocks.provider.mockReset(); mocks.overview.mockReset(); mocks.portfolio.mockReset(); });

describe("treasury wallet and farm accounting", () => {
  it("combines same-block wallet and farm principal once, excluding every pending reward and miner balance", () => {
    const farms = positions();
    const result = combineTreasuryPositions(wallet(), farms);
    expect(result).toMatchObject({ block: 101, timestamp: 1700000000, walletUsd: 12, farmingUsd: 4, combinedUsd: 16 });
    expect(result.farms).toEqual(farms.farms.positions);
    expect(result.combinedUsd).not.toBe(farms.totalUsd);
    expect(result.combinedUsd).not.toBe(16 + farms.rewards.usd!);
  });

  it("accepts treasury address casing but rejects another wallet", () => {
    expect(combineTreasuryPositions(wallet(), { ...positions(), account: TREASURY.toLowerCase() }).combinedUsd).toBe(16);
    expect(() => combineTreasuryPositions(wallet(), { ...positions(), account: "0x0000000000000000000000000000000000000001" })).toThrow(/do not match/);
  });

  it("rejects different blocks and different timestamps even when the account is correct", () => {
    expect(() => combineTreasuryPositions(wallet(), { ...positions(), blockNumber: 102 })).toThrow(/do not match/);
    expect(() => combineTreasuryPositions(wallet(), { ...positions(), observedAt: 1700000001000 })).toThrow(/do not match/);
  });

  it.each([[null, 4], [12, null], [null, null]] as const)("keeps an incomplete wallet/farm total unknown (%s, %s)", (walletUsd, farmingUsd) => {
    const result = combineTreasuryPositions(wallet(walletUsd), positions(farmingUsd));
    expect(result.walletUsd).toBe(walletUsd);
    expect(result.farmingUsd).toBe(farmingUsd);
    expect(result.combinedUsd).toBeNull();
  });

  it("preserves verified zero balances as zero rather than unavailable", () => {
    const farms = positions(0);
    farms.farms.positions = [];
    expect(combineTreasuryPositions(wallet(0), farms)).toMatchObject({ farms: [], farmingUsd: 0, walletUsd: 0, combinedUsd: 0 });
  });
});

describe("public treasury position snapshot binding", () => {
  const block = { number: 101, timestamp: 1700000000, hash: `0x${"1".repeat(64)}` };
  function publicFixture(reorg = false) {
    const provider = { send: vi.fn().mockResolvedValue("0x171"), getBlock: vi.fn().mockResolvedValueOnce(block).mockResolvedValueOnce(reorg ? { ...block, hash: `0x${"2".repeat(64)}` } : block) };
    mocks.provider.mockResolvedValue(provider);
    mocks.overview.mockImplementation(async reader => {
      expect(await reader.snapshot()).toEqual({ block: block.number, timestamp: block.timestamp });
      return wallet();
    });
    mocks.portfolio.mockImplementation(async (account: string, reader: PortfolioReader) => {
      expect(account).toBe(TREASURY);
      expect(await reader.block()).toEqual(block);
      return positions();
    });
    return provider;
  }
  it("binds both read services to one public head and verifies that head afterward", async () => {
    const provider = publicFixture();
    expect((await readPublicTreasuryPositions()).combinedUsd).toBe(16);
    expect(provider.send).toHaveBeenCalledExactlyOnceWith("eth_chainId", []);
    expect(provider.getBlock.mock.calls).toEqual([["latest"], [101]]);
    expect(mocks.overview).toHaveBeenCalledWith(expect.any(Object), DASHBOARD_ASSETS);
  });
  it("rejects a replaced head instead of displaying mixed-chain-state totals", async () => {
    publicFixture(true);
    await expect(readPublicTreasuryPositions()).rejects.toThrow("Treasury block changed");
  });
  it("rejects a provider on another chain before reading treasury balances", async () => {
    const provider = publicFixture();
    provider.send.mockResolvedValue("0x1");
    await expect(readPublicTreasuryPositions()).rejects.toThrow("PulseChain provider required");
    expect(mocks.overview).not.toHaveBeenCalled();
    expect(mocks.portfolio).not.toHaveBeenCalled();
  });
});
