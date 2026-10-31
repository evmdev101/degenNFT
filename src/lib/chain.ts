import { Contract, FetchRequest, JsonRpcProvider } from "ethers";
import { CHAIN_ID, CONTRACTS, MINT_ABI, NFT_ABI } from "../config/contracts";

export const PULSECHAIN_RPCS = [
  "https://rpc.pulsechain.com",
  "https://pulsechain-rpc.publicnode.com",
  "https://pulsechain.publicnode.com",
  "https://rpc-pulsechain.g4mm4.io",
];

let cachedProvider: JsonRpcProvider | null = null;
let pendingProvider: Promise<JsonRpcProvider> | null = null;
let preferredRpc = PULSECHAIN_RPCS[0];
let lastProviderCheck = 0;

export async function getPublicProvider() {
  if (pendingProvider) return pendingProvider;
  if (cachedProvider && Date.now() - lastProviderCheck < 30_000) return cachedProvider;
  const previous = cachedProvider;
  pendingProvider = (async () => {
    if (previous) {
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([previous.getBlockNumber(), new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error("RPC health check timed out")), 3000);
        })]);
        lastProviderCheck = Date.now();
        return previous;
      } catch { cachedProvider = null; previous.destroy(); }
      finally { if (timer) clearTimeout(timer); }
    }
    return connectPublicProvider();
  })();
  try { return await pendingProvider; }
  finally { pendingProvider = null; }
}

async function connectPublicProvider() {
  const candidates = PULSECHAIN_RPCS.map(async (rpc) => {
    const request = new FetchRequest(rpc);
    request.timeout = 8000;
    const provider = new JsonRpcProvider(
      request,
      { chainId: Number(CHAIN_ID), name: "pulsechain" },
      { staticNetwork: true, batchMaxCount: 6, batchStallTime: 16 },
    );
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        provider.getBlockNumber(),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error("RPC connection timed out")), 3000);
        }),
      ]);
      if (cachedProvider) {
        provider.destroy();
        return cachedProvider;
      }
      cachedProvider = provider;
      lastProviderCheck = Date.now();
      preferredRpc = rpc;
      return provider;
    } catch (error) {
      provider.destroy();
      throw error;
    } finally {
      if (timer) clearTimeout(timer);
    }
  });
  try {
    return await Promise.any(candidates);
  } catch {
    throw new Error("PulseChain RPC is temporarily unavailable.");
  }
}

export async function pulsechainRpcCall<T = unknown>(
  method: string,
  params: unknown[],
  timeoutMs = 8000,
) {
  let lastError: unknown;

  for (const rpc of [preferredRpc, ...PULSECHAIN_RPCS.filter((rpc) => rpc !== preferredRpc)]) {
    const controller = new AbortController();
    const timeout = globalThis.setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(rpc, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", method, params, id: 1 }),
        signal: controller.signal,
      });
      const result = (await response.json()) as {
        error?: { message?: string };
        result?: T;
      };
      if (!response.ok || result.error || result.result === undefined) {
        throw new Error(
          result.error?.message || `RPC request failed (${response.status})`,
        );
      }
      return result.result;
    } catch (error) {
      lastError = error;
    } finally {
      globalThis.clearTimeout(timeout);
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error("PulseChain RPC is temporarily unavailable.");
}

export async function getPublicContracts() {
  const provider = await getPublicProvider();
  return {
    provider,
    nft: new Contract(CONTRACTS.nft, NFT_ABI, provider),
    mint: new Contract(CONTRACTS.mint, MINT_ABI, provider),
  };
}

export function toGatewayUrl(value: string) {
  return value.startsWith("ipfs://")
    ? `https://cloudflare-ipfs.com/ipfs/${value.slice(7)}`
    : value;
}

export async function fetchTokenMetadata(uri: string) {
  const response = await fetch(toGatewayUrl(uri));
  if (!response.ok)
    throw new Error(`Metadata request failed (${response.status})`);
  return response.json() as Promise<{
    name?: string;
    description?: string;
    image?: string;
    attributes?: Array<{ trait_type?: string; value?: string | number }>;
  }>;
}

export function shortAddress(address?: string | null) {
  return address ? `${address.slice(0, 6)}…${address.slice(-4)}` : "";
}

export function readableError(error: unknown) {
  const candidate = error as {
    shortMessage?: string;
    reason?: string;
    message?: string;
  };
  return (
    candidate?.shortMessage ||
    candidate?.reason ||
    candidate?.message ||
    "Something went wrong."
  );
}
