import { Contract, JsonRpcProvider } from "ethers";
import { CHAIN_ID, CONTRACTS, MINT_ABI, NFT_ABI } from "../config/contracts";

const RPCS = [
  "https://rpc.pulsechain.com",
  "https://pulsechain.publicnode.com",
  "https://rpc-pulsechain.g4mm4.io",
];

let cachedProvider: JsonRpcProvider | null = null;

export async function getPublicProvider() {
  if (cachedProvider) return cachedProvider;
  for (const rpc of RPCS) {
    const provider = new JsonRpcProvider(
      rpc,
      { chainId: Number(CHAIN_ID), name: "pulsechain" },
      { staticNetwork: true, batchMaxCount: 6 },
    );
    try {
      await provider.getBlockNumber();
      cachedProvider = provider;
      return provider;
    } catch {
      provider.destroy();
    }
  }
  throw new Error("PulseChain RPC is temporarily unavailable.");
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
