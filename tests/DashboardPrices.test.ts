import { afterEach, describe, expect, it, vi } from "vitest";
import { clearDashboardPriceCache, pricesFromPairs, readTokenPrices } from "../src/features/dashboard/marketData";
afterEach(() => { vi.unstubAllGlobals(); clearDashboardPriceCache(); });
describe("dashboard market quotes", () => {
  it("uses the deepest PulseChain market and derives quote-token USD from priceNative", () => {
    expect(pricesFromPairs(["0xAA", "0xBB", "0xCC"], [
      { chainId: "ethereum", baseToken: { address: "0xaa" }, priceUsd: "999", liquidity: { usd: 999999 } },
      { chainId: "pulsechain", baseToken: { address: "0xaa" }, priceUsd: "100", liquidity: { usd: 1 } },
      { chainId: "pulsechain", baseToken: { address: "0xaa" }, quoteToken: { address: "0xbb" }, priceUsd: "10", priceNative: "2", liquidity: { usd: 100 } },
    ])).toEqual({ "0xaa": 10, "0xbb": 5, "0xcc": null });
  });
  it("deduplicates concurrent quotes, normalizes keys, and caches them briefly", async () => {
    const fetch = vi.fn(async () => ({ ok: true, json: async () => [{ chainId: "pulsechain", baseToken: { address: "0xaa" }, priceUsd: "2" }] }));
    vi.stubGlobal("fetch", fetch);
    const [first, second] = await Promise.all([readTokenPrices(["0xAA", "0xaa"]), readTokenPrices(["0xaa"])]);
    expect(first).toEqual({ "0xaa": 2 });
    expect(second).toEqual(first);
    await readTokenPrices(["0xAA"]);
    expect(fetch).toHaveBeenCalledOnce();
  });
  it("represents a failed price request as unavailable", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("Offline"); }));
    expect(await readTokenPrices(["0xaa"])).toEqual({ "0xaa": null });
  });
});
