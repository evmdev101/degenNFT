type Pair = { chainId?: string; baseToken?: { address?: string }; quoteToken?: { address?: string }; priceUsd?: string; priceNative?: string; liquidity?: { usd?: number } };
const cache = new Map<string, { value: number | null; at: number }>();
const pending = new Map<string, Promise<Record<string, number | null>>>();

/** Market estimates only. Never use these numbers to construct transactions. */
export function pricesFromPairs(addresses: readonly string[], pairs: readonly Pair[]): Record<string, number | null> {
  return Object.fromEntries(addresses.map(address => {
    const key = address.toLowerCase();
    const candidates = pairs.flatMap(pair => {
      if (pair.chainId !== "pulsechain") return [];
      const base = Number(pair.priceUsd), native = Number(pair.priceNative);
      const value = pair.baseToken?.address?.toLowerCase() === key ? base
        : pair.quoteToken?.address?.toLowerCase() === key && native > 0 ? base / native : NaN;
      return Number.isFinite(value) && value > 0 ? [{ value, liquidity: Number(pair.liquidity?.usd) || 0 }] : [];
    }).sort((a, b) => b.liquidity - a.liquidity);
    return [key, candidates[0]?.value ?? null];
  }));
}

export async function readTokenPrices(addresses: readonly string[]): Promise<Record<string, number | null>> {
  const unique = [...new Set(addresses.map(address => address.toLowerCase()))];
  const missing = unique.filter(address => !cache.has(address) || Date.now() - cache.get(address)!.at > 60_000);
  for (let start = 0; start < missing.length; start += 30) {
    const batch = missing.slice(start, start + 30).sort();
    const key = batch.join(",");
    let read = pending.get(key);
    if (!read) {
      read = (async () => {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 8_000);
        try {
          const response = await fetch(`https://api.dexscreener.com/tokens/v1/pulsechain/${key}`, { signal: controller.signal });
          if (!response.ok) throw new Error("Prices unavailable");
          const pairs: unknown = await response.json();
          if (!Array.isArray(pairs)) throw new Error("Invalid price response");
          const values = pricesFromPairs(batch, pairs);
          for (const address of batch) cache.set(address, { value: values[address], at: Date.now() });
          return values;
        } finally { clearTimeout(timer); }
      })().finally(() => pending.delete(key));
      pending.set(key, read);
    }
    await read.catch(() => undefined);
  }
  // Failed refreshes do not present stale quotes as current prices.
  return Object.fromEntries(unique.map(address => {
    const value = cache.get(address);
    return [address, value && Date.now() - value.at <= 60_000 ? value.value : null];
  }));
}

export function clearDashboardPriceCache() { cache.clear(); }
