import { describe, expect, it, vi } from "vitest";
import { CONTRACTS, DEGEN_REWARDS_HELPER } from "../src/config/contracts";
import { FARM_REGISTRY, MINER_POOLS } from "../src/features/dashboard/config";
import { portfolioUsd, readPortfolioWithReader, type PortfolioReader } from "../src/features/dashboard/portfolioData";

const user = "0x0000000000000000000000000000000000000001";
const lp = "0x0000000000000000000000000000000000000010";
const token0 = "0x0000000000000000000000000000000000000020";
const token1 = "0x0000000000000000000000000000000000000030";
const unit = 10n ** 18n;
function fixture(options: { active?: boolean; badFarm?: boolean; badCount?: boolean; missingPrice?: boolean; empty?: boolean; countLimit?: boolean } = {}) {
  const timestamp = Math.floor(Date.now() / 1000);
  const calls: { address: string; signature: string; args: readonly unknown[]; block: number }[] = [];
  const quote = vi.fn(async () => 20n * unit);
  const reader: PortfolioReader = {
    block: async () => ({ number: 1234, timestamp }),
    quote,
    prices: async addresses => Object.fromEntries(addresses.map(address => [address.toLowerCase(), options.missingPrice ? null : address === token0 ? 1 : 2])),
    call: async (address, signature, args, block) => {
      calls.push({ address, signature, args, block });
      const normalized = address.toLowerCase();
      const farm = normalized === FARM_REGISTRY[0].address.toLowerCase();
      const pool = normalized === MINER_POOLS[0].address.toLowerCase();
      if (signature.includes("getNrOfStakes")) {
        if (farm && options.badCount) throw new Error("RPC failure");
        if (farm && options.countLimit) return 5001n;
        return options.active && (farm || pool) ? 2n : 0n;
      }
      if (signature.includes("balanceOf")) {
        if (normalized === CONTRACTS.nft.toLowerCase()) return 2n;
        if (normalized === DEGEN_REWARDS_HELPER.toLowerCase()) return 5n * unit;
        return options.empty ? 0n : 10n * unit;
      }
      if (signature.includes("viewUserTotalEarnings")) return normalized === CONTRACTS.nft.toLowerCase() ? [100n * unit, 200n * unit] : 19n * unit;
      if (signature.includes("getPricePerFullShare")) return 3n * unit;
      if (signature.includes("withdrawFeePeriod")) return 1000n;
      if (signature.includes("gracePeriod")) return 100n;
      if (signature.includes("userInfo")) {
        if (farm && options.badFarm && args[1] === 1n) throw new Error("Failed stake");
        return farm ? [10n * unit, 0n, 0n, 0n] : [1n * unit, BigInt(timestamp - 1050), 0n, 0n, 0n];
      }
      if (signature.includes("stakeToken")) return lp;
      if (signature.includes("decimals")) return address === token0 ? 6n : 18n;
      if (signature.includes("token0")) return token0;
      if (signature.includes("token1")) return token1;
      if (signature.includes("getReserves")) return [1000n * 10n ** 6n, 2000n * unit, 0n];
      if (signature.includes("totalSupply")) return 100n * unit;
      throw new Error("Unexpected read");
    },
  };
  return { reader, calls, quote };
}

describe("DEGEN portfolio accounting", () => {
  it("values only the wallet's principal and owned LP reserves, excluding every pending reward and NFT mint value", async () => {
    const { reader, calls, quote } = fixture({ active: true });
    const result = await readPortfolioWithReader(user, reader);
    expect(result.wallet).toEqual({ raw: 10n * unit, usd: 20 });
    expect(result.miners.raw).toBe(6n * unit);
    expect(result.miners.count).toBe(2);
    expect(result.miners.matureCount).toBe(2);
    expect(result.farms.positions[0].depositedRaw).toBe(20n * unit);
    expect(result.farms.positionCount).toBe(2);
    expect(result.farms.usd).toBe(1000);
    expect(result.totalUsd).toBe(1032);
    expect(result.rewards).toMatchObject({ helperRaw: 5n * unit, farmRaw: 15n * unit, totalRaw: 20n * unit, usd: 40 });
    expect(result.nft).toMatchObject({ countRaw: 2n, pendingDegenRaw: 200n * unit, pendingOinkRaw: 100n * unit });
    expect(quote).toHaveBeenCalledExactlyOnceWith(expect.any(String), [{ address: FARM_REGISTRY[0].address, stakeIds: [0n, 1n], pendingRaw: 19n * unit }], 1234);
    expect(calls.every(call => call.block === 1234)).toBe(true);
  });
  it("keeps a failed stake read unknown and shows a known subtotal instead of a complete total", async () => {
    const result = await readPortfolioWithReader(user, fixture({ active: true, badFarm: true }).reader);
    expect(result.farms.positions[0].depositedRaw).toBeNull();
    expect(result.farms.usd).toBeNull();
    expect(result.totalUsd).toBeNull();
    expect(result.knownTotalUsd).toBe(32);
    expect(result.complete).toBe(false);
  });
  it("does not quote a partial farm collection after an unknown stake count", async () => {
    const { reader, quote } = fixture({ badCount: true });
    const result = await readPortfolioWithReader(user, reader);
    expect(result.farms.positionCount).toBeNull();
    expect(result.farms.positions[0].stakeCount).toBeNull();
    expect(result.rewards.totalRaw).toBeNull();
    expect(result.totalUsd).toBeNull();
    expect(quote).not.toHaveBeenCalled();
  });
  it("does not silently truncate an oversized stake collection", async () => {
    const { reader, calls, quote } = fixture({ countLimit: true });
    const result = await readPortfolioWithReader(user, reader);
    expect(result.farms.positionCount).toBeNull();
    expect(calls.some(call => call.signature.includes("userInfo"))).toBe(false);
    expect(quote).not.toHaveBeenCalled();
  });
  it("requires a price for positive balances while a verified empty wallet can still total zero", async () => {
    expect((await readPortfolioWithReader(user, fixture({ missingPrice: true }).reader)).totalUsd).toBeNull();
    const empty = await readPortfolioWithReader(user, fixture({ empty: true, missingPrice: true }).reader);
    expect(empty.totalUsd).toBe(0);
    expect(empty.complete).toBe(true);
    expect(portfolioUsd(0n, 18, null)).toBe(0);
  });
  it("does not fall back to the vault getter sum when the exact reward quote fails", async () => {
    const { reader } = fixture({ active: true });
    reader.quote = async () => { throw new Error("Quote unavailable"); };
    const result = await readPortfolioWithReader(user, reader);
    expect(result.rewards.totalRaw).toBeNull();
    expect(result.rewards.farmRaw).toBeNull();
    expect(result.totalUsd).toBe(1032);
  });
  it("rejects stale or future blocks before reading balances", async () => {
    for (const difference of [-121, 31]) {
      const { reader, calls } = fixture();
      reader.block = async () => ({ number: 1, timestamp: Math.floor(Date.now() / 1000) + difference });
      await expect(readPortfolioWithReader(user, reader)).rejects.toThrow("recent PulseChain block");
      expect(calls).toHaveLength(0);
    }
  });
  it("excludes zero-share miner records from active and maturity counts", async () => {
    const { reader } = fixture({ active: true });
    const original = reader.call;
    reader.call = async (address, signature, args, block) => address.toLowerCase() === MINER_POOLS[0].address.toLowerCase() && signature.includes("userInfo") && args[1] === 1n
      ? [0n, 0n, 0n, 0n, 0n] : original(address, signature, args, block);
    const result = await readPortfolioWithReader(user, reader);
    expect(result.miners.count).toBe(1);
    expect(result.miners.matureCount).toBe(1);
    expect(result.miners.raw).toBe(3n * unit);
  });
});
