import { describe, expect, it } from "vitest";
import { nftDailyYield } from "../src/features/nft/yieldData";

describe("NFT yield from current pool emissions", () => {
  it("uses allocation, NFT supply and observed block timing to calculate daily rewards", () => {
    const unit = 10n ** 18n;
    // 10 tokens/block, 20% allocation, 100 NFTs, 10-second blocks.
    const daily = nftDailyYield(10n * unit, 20n, 100n, 100n, 100, 1000);
    expect(daily).toBe(1728n * unit / 10n);
    expect(daily * 30n * 5n).toBe(25920n * unit);
  });
  it("shows zero for a pool with no allocation", () => {
    expect(nftDailyYield(100n, 0n, 100n, 10n, 100, 1000)).toBe(0n);
  });
  it("does not invent a rate when supply or block timing is unavailable", () => {
    expect(() => nftDailyYield(100n, 1n, 100n, 0n, 100, 1000)).toThrow();
    expect(() => nftDailyYield(100n, 1n, 100n, 10n, 100, 0)).toThrow();
  });
});
