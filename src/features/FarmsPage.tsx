import { FARM_REGISTRY } from "./dashboard/config";
import { TOKEN_LOGOS } from "../config/tokenLogos";
import { readFarmClaimSnapshot, type FarmClaimSnapshot } from "./farmClaimData";
import { quoteFarmClaim } from "./farmClaimQuote";
import { usePageActive } from "../hooks/usePageActive";
import { confirmTransaction } from "../lib/transactions";
// DEGEN's LP vaults, with the OINK/CashX card layout and per-stake withdrawals.
import {
  Contract,
  ZeroAddress,
  formatEther,
  formatUnits,
  parseUnits,
} from "ethers";
import type { CSSProperties, ReactNode } from "react";
import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { CopyAddress } from "../components/CopyAddress";
import { FarmPop } from "./FarmPop";
import { FarmStakes } from "./FarmStakes";
import { farmStakeCountLabel, readFarmStakes, StakeChangedError, summarizeFarmStakes, withdrawSelectedStake } from "./farmStakeData";
import type { FarmStake } from "./farmStakeData";
import { CONTRACTS, ERC20_ABI } from "../config/contracts";
import type { WalletState } from "../hooks/useWallet";
import { getPublicProvider, pulsechainRpcCall } from "../lib/chain";

// ── Constants from the original script ──────────────────────────────────────
const MASTERCHEF2 = "0xC84FbE083713544BB4Ea85E2fe95148D076b2942";
// Display projections use the same stated block assumption as APR.
const BLOCKS_PER_DAY = 600;
const APR_BLOCKS_PER_DAY = 600;
const DAYS_PER_YEAR = 365;
const DEGEN_VAULT_DATA_URL =
  "https://raw.githubusercontent.com/DegenStrategy/DEGEN/refs/heads/main/vaultData.json";
const DEGEN_OFFICIAL_STATS_URL =
  "https://api.oink-pls.com/api2/vaultDataOutput.json";
const DEGEN_REWARDS_HELPER = "0xe1cAF2F0da06A97A7f04B9Ea1B43C91F447cf343";

const PULSEX_BASE_URL =
  "https://pulsex.mypinata.cloud/ipfs/bafybeiaq4jgcpz4hdzwid6letizdnhijlp6lu5ivcjcp5vbgpgf54jknn4/#";
const PULSEX_ADD_V1_URL = PULSEX_BASE_URL + "/add/V1";
const PULSEX_ADD_V2_URL = PULSEX_BASE_URL + "/add/V2";
const PULSEX_SWAP_URL = PULSEX_BASE_URL + "/swap";

type FarmDef = { name: string; tokens: string[]; addr: string; dec: number };

// Sourced from https://raw.githubusercontent.com/DegenStrategy/DEGEN/refs/heads/main/vaultData.json
const DEGEN_FARMS: FarmDef[] = FARM_REGISTRY.map(farm => ({ name: farm.name, tokens: [...farm.tokens], addr: farm.address, dec: farm.decimals }));

const DTX_CHEF_ABI = [
  "function poolLength() view returns (uint256)",
  "function poolInfo(uint256) view returns (uint256 allocPoint, uint256 lastRewardBlock, address participant)",
];
const PAIR_ABI = [
  "function token0() view returns (address)",
  "function token1() view returns (address)",
  "function getReserves() view returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast)",
  "function balanceOf(address) view returns (uint256)",
  "function totalSupply() view returns (uint256)",
];
const DEGEN_VAULT_ABI = [
  "function getNrOfStakes(address _user) view returns (uint256)",
  "function userInfo(address, uint256) view returns (uint256 amount, uint256 debt, uint256 feesPaid, uint256 lastAction)",
  "function viewUserTotalEarnings(address _user) view returns (uint256)",
  "function viewStakeEarnings(address _user, uint256 _stakeID) view returns (uint256)",
  "function deposit(uint256 _amount, address referral) payable",
  "function withdraw(uint256 _stakeID)",
  "function stakeToken() view returns (address)",
  "function depositFee() view returns (uint256)",
  "function fundingRate() view returns (uint256)",
];
const DEGEN_REWARDS_HELPER_ABI = [
  "function claimWithHarvest(address[] _contractAddresses, address _userAddress, uint256[][] _stakeIDs, uint256 _amount, address _into)",
  "function claimRewards(uint256 _amount, address _harvestInto)",
  "function defaultDirectPayout() view returns (uint256)",
  "function viewPoolPayout(address) view returns (uint256)",
  "function viewPoolMinServe(address) view returns (uint256)",
  "function balanceOf(address) view returns (uint256)",
];
const TOKEN_DEC_ABI = ["function decimals() view returns (uint8)"];
const SYMBOL_ABI = ["function symbol() view returns (string)"];

const HARVEST_DESTS_DEGEN = [
  { label: "10 Year DEGEN Pool (default)", addr: "0xdE672FccA32365bD704c39bd1164a0D34a3a73e6" },
  { label: "1 Year DEGEN Pool", addr: "0x3d175C8359169b0e830d36EA9CD3FE209f46f7BD" },
  { label: "3 Month DEGEN Pool", addr: "0x7ED33f65A0398cb26eaB2B03877825c96D9B6077" },
  { label: "1 Month DEGEN Pool", addr: "0xd9b491ac0f5487673500b67224b67b4171a08aca" },
  { label: "Into Wallet", addr: null as string | null },
];

// ── Formatting helpers from the original script ──────────────────────────────
function fmtFullReward(n: number) {
  return Number(n || 0).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}
function fmtLpAmount(n: number) {
  const value = Number(n || 0);
  const abs = Math.abs(value);
  if (abs === 0) return "0.00";
  let maxDec = 2;
  if (abs < 1)
    maxDec = Math.min(8, Math.max(2, 3 - Math.floor(Math.log10(abs))));
  return value.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: maxDec,
  });
}
function farmAprText(apr: number | null | undefined) {
  if (apr === null || apr === undefined) return "—";
  const n = Number(apr);
  if (!Number.isFinite(n)) return "—";
  if (n === 0) return "0%";
  if (!(n > 0)) return "—";
  if (n > 999999) return ">999K%";
  if (n >= 1000) return Math.round(n).toLocaleString() + "%";
  if (n >= 100) return n.toFixed(0) + "%";
  return n.toFixed(2) + "%";
}
function formatClaimableAmount(raw: bigint) {
  const value = Number(formatUnits(raw, 18));
  return raw > 0n && value < 1e-8 ? "<0.00000001" : fmtLpAmount(value);
}
function friendlyTxError(err: unknown) {
  const e = err as { reason?: string; shortMessage?: string; message?: string };
  const m = String(e?.reason || e?.shortMessage || e?.message || "Transaction failed");
  if (/user rejected|user denied|ACTION_REJECTED/i.test(m))
    return "Transaction rejected in wallet";
  return m.length > 120 ? m.slice(0, 120) + "…" : m;
}
const farmTimeout = <T,>(promise: Promise<T>, ms: number, fallback: T | null = null) =>
  Promise.race([
    promise,
    new Promise<T | null>((resolve) => setTimeout(() => resolve(fallback), ms)),
  ]);
const withT = <T,>(p: Promise<T>, ms: number) =>
  Promise.race([
    p,
    new Promise<never>((_, r) => setTimeout(() => r(new Error("timeout")), ms)),
  ]);

// ── Module-level caches (mirror the original globals) ────────────────────────
type OfficialStats = {
  symbol?: string;
  poolId?: number;
  apr: number;
  valueOfTVAL: number;
  valueOfAnnualInterest?: number;
  rewardAllocation?: string | number;
};
type VaultMeta = {
  vaultContract?: string;
  tokenContract?: string;
  decimals?: number;
  poolId?: number;
  isLP?: boolean;
};
type AllocMap = {
  map: Map<string, { allocPoint: number; poolId: number }>;
  byPool: Map<number, { allocPoint: number; poolId: number }>;
  totalAlloc: number;
  rewardPerBlock: number;
} | null;
type PairInfo = {
  lp: string;
  token0: string;
  token1: string;
  reserve0: number;
  reserve1: number;
  totalSupply: number;
} | null;

let _degenAllocMap: AllocMap = null;
let _degenVaultMetaMap: Map<string, VaultMeta> | null = null;
let officialStatsReadAt = 0;
let priceCacheReadAt = 0;
let allocationReadAt = 0;
let _degenOfficialStatsMap: Map<string, OfficialStats> | null = null;
let _degenPairPriceGraph: Map<string, { token: string; rate: number }[]> | null =
  null;
const _farmTokenPriceCache = new Map<string, number | null>();
const _farmPairLiquidityCache = new Map<string, number | null>();
const _farmTokenDecimalsCache = new Map<string, number>();
const _farmPairInfoCache = new Map<string, PairInfo>();
const _lpBreakdownCache = new Map<
  string,
  (NonNullable<PairInfo> & { sym0: string; sym1: string }) | null
>();

async function buildAllocMap(): Promise<AllocMap> {
  try {
    const provider = await getPublicProvider();
    const mc = new Contract(MASTERCHEF2, DTX_CHEF_ABI, provider);
    const rpcCall = async (data: string) => {
      const result = await withT(
        pulsechainRpcCall<string>(
          "eth_call",
          [{ to: MASTERCHEF2, data }, "latest"],
          8000,
        ),
        9000,
      );
      return BigInt(result);
    };
    const [poolLen, totalAlloc, rpb] = await Promise.all([
      mc.poolLength(),
      rpcCall("0x17caf6f1"),
      rpcCall("0x9cc34559"),
    ]);
    const n = Number(poolLen);
    const poolInfos = await Promise.allSettled(
      Array.from({ length: n }, (_, i) => mc.poolInfo(i)),
    );
    const map = new Map<string, { allocPoint: number; poolId: number }>();
    const byPool = new Map<number, { allocPoint: number; poolId: number }>();
    poolInfos.forEach((r, i) => {
      if (r.status === "fulfilled") {
        const [allocPoint, , participant] = r.value;
        const entry = { allocPoint: Number(allocPoint), poolId: i };
        map.set(String(participant).toLowerCase(), entry);
        byPool.set(i, entry);
      }
    });
    return {
      map,
      byPool,
      totalAlloc: Number(totalAlloc),
      rewardPerBlock: parseFloat(formatEther(rpb)),
    };
  } catch (e) {
    console.error("[APR] buildAllocMap FAILED", (e as Error).message);
    return null;
  }
}

async function fetchTokenUsd(addr: string | null): Promise<number | null> {
  if (!addr) return null;
  const key = addr.toLowerCase();
  if (_farmTokenPriceCache.has(key)) return _farmTokenPriceCache.get(key)!;
  let price: number | null = null;
  try {
    const data = await withT(
      fetch(`https://api.dexscreener.com/tokens/v1/pulsechain/${addr}`).then(
        (r) => r.json(),
      ),
      6000,
    );
    if (Array.isArray(data) && data.length) {
      const best = data
        .filter((p) => p && p.priceUsd)
        .sort(
          (a, b) => Number(b.liquidity?.usd || 0) - Number(a.liquidity?.usd || 0),
        )[0];
      price = best ? Number(best.priceUsd) : null;
    }
  } catch (e) {
    console.warn("fetchTokenUsd/v1", addr, (e as Error).message);
  }
  if (!(price !== null && price > 0)) {
    try {
      const data = (await withT(
        fetch(`https://api.dexscreener.com/latest/dex/search?q=${addr}`).then(
          (r) => r.json(),
        ),
        6000,
      )) as { pairs?: Array<{ priceUsd?: string; chainId?: string; liquidity?: { usd?: number } }> };
      const pairs = data?.pairs || [];
      const best = pairs
        .filter((p) => p && p.priceUsd && p.chainId === "pulsechain")
        .sort(
          (a, b) => Number(b.liquidity?.usd || 0) - Number(a.liquidity?.usd || 0),
        )[0];
      price = best ? Number(best.priceUsd) : null;
    } catch (e) {
      console.warn("fetchTokenUsd/search", addr, (e as Error).message);
    }
  }
  price = price !== null && price > 0 ? price : null;
  _farmTokenPriceCache.set(key, price);
  return price;
}

async function fetchPairLiquidityUsd(pairAddr: string): Promise<number | null> {
  if (!pairAddr) return null;
  const key = pairAddr.toLowerCase();
  if (_farmPairLiquidityCache.has(key)) return _farmPairLiquidityCache.get(key)!;
  let liquidity: number | null = null;
  try {
    const data = (await withT(
      fetch(
        `https://api.dexscreener.com/latest/dex/pairs/pulsechain/${pairAddr}`,
      ).then((r) => r.json()),
      6000,
    )) as { pair?: { liquidity?: { usd?: number } } };
    liquidity = Number(data?.pair?.liquidity?.usd || 0);
  } catch (e) {
    console.warn("fetchPairLiquidityUsd", pairAddr, (e as Error).message);
  }
  liquidity = liquidity !== null && liquidity > 0 ? liquidity : null;
  _farmPairLiquidityCache.set(key, liquidity);
  return liquidity;
}

async function getTokenDecimals(addr: string) {
  if (!addr) return 18;
  const key = String(addr).toLowerCase();
  if (_farmTokenDecimalsCache.has(key)) return _farmTokenDecimalsCache.get(key)!;
  let dec = 18;
  try {
    const provider = await getPublicProvider();
    const token = new Contract(addr, TOKEN_DEC_ABI, provider);
    dec = Number(await farmTimeout(token.decimals(), 3500, 18));
  } catch {
    /* default 18 */
  }
  if (!Number.isFinite(dec) || dec < 0) dec = 18;
  _farmTokenDecimalsCache.set(key, dec);
  return dec;
}

async function getLpPairInfo(lpAddr: string, lpDec = 18): Promise<PairInfo> {
  if (!lpAddr) return null;
  const key = String(lpAddr).toLowerCase();
  if (_farmPairInfoCache.has(key)) return _farmPairInfoCache.get(key)!;
  let info: PairInfo = null;
  try {
    const provider = await getPublicProvider();
    const pair = new Contract(lpAddr, PAIR_ABI, provider);
    const [token0, token1, reserves, supplyRaw] = await Promise.all([
      farmTimeout(pair.token0(), 4500, null).catch(() => null),
      farmTimeout(pair.token1(), 4500, null).catch(() => null),
      farmTimeout(pair.getReserves(), 4500, null).catch(() => null),
      farmTimeout(pair.totalSupply(), 4500, 0n).catch(() => 0n),
    ]);
    if (token0 && token1 && reserves && supplyRaw > 0n) {
      const [dec0, dec1] = await Promise.all([
        getTokenDecimals(token0),
        getTokenDecimals(token1),
      ]);
      const reserve0 = Number(formatUnits(reserves.reserve0 ?? reserves[0], dec0));
      const reserve1 = Number(formatUnits(reserves.reserve1 ?? reserves[1], dec1));
      const totalSupply = Number(formatUnits(supplyRaw, lpDec));
      if (reserve0 > 0 && reserve1 > 0 && totalSupply > 0) {
        info = {
          lp: key,
          token0: String(token0).toLowerCase(),
          token1: String(token1).toLowerCase(),
          reserve0,
          reserve1,
          totalSupply,
        };
      }
    }
  } catch (e) {
    console.warn("getLpPairInfo", lpAddr, (e as Error).message);
  }
  _farmPairInfoCache.set(key, info);
  return info;
}

async function getLpBreakdownInfo(lpAddr: string, lpDec: number) {
  const key = lpAddr.toLowerCase();
  if (_lpBreakdownCache.has(key)) return _lpBreakdownCache.get(key)!;
  const info = await getLpPairInfo(lpAddr, lpDec);
  let out: (NonNullable<PairInfo> & { sym0: string; sym1: string }) | null = null;
  if (info) {
    const provider = await getPublicProvider();
    const [sym0, sym1] = await Promise.all([
      new Contract(info.token0, SYMBOL_ABI, provider).symbol().catch(() => "?"),
      new Contract(info.token1, SYMBOL_ABI, provider).symbol().catch(() => "?"),
    ]);
    out = { ...info, sym0, sym1 };
  }
  _lpBreakdownCache.set(key, out);
  return out;
}

function breakdownTokenLogo(sym: string, farmTokens: string[]) {
  if (TOKEN_LOGOS[sym]) return TOKEN_LOGOS[sym];
  const norm = (s: string) => String(s || "").toLowerCase().replace(/^p/, "");
  const match = (farmTokens || []).find(
    (t) =>
      norm(t) === norm(sym) ||
      norm(sym).startsWith(norm(t)) ||
      norm(t).startsWith(norm(sym)),
  );
  return match ? TOKEN_LOGOS[match] || null : null;
}

function addPriceGraphEdge(
  graph: Map<string, { token: string; rate: number }[]>,
  from: string,
  to: string,
  rate: number,
) {
  if (!from || !to || !(rate > 0) || !Number.isFinite(rate)) return;
  const a = from.toLowerCase();
  const b = to.toLowerCase();
  if (!graph.has(a)) graph.set(a, []);
  graph.get(a)!.push({ token: b, rate });
}

async function buildVaultPairPriceGraph(metaMap: Map<string, VaultMeta>) {
  if (_degenPairPriceGraph) return _degenPairPriceGraph;
  const graph = new Map<string, { token: string; rate: number }[]>();
  const metas = Array.from(metaMap?.values?.() || []).filter(
    (m) => m?.tokenContract && m.isLP !== false,
  );
  const infos = await Promise.allSettled(
    metas.map((m) =>
      farmTimeout(getLpPairInfo(m.tokenContract!, m.decimals || 18), 9000, null),
    ),
  );
  infos.forEach((res) => {
    if (res.status !== "fulfilled" || !res.value) return;
    const info = res.value;
    addPriceGraphEdge(graph, info.token0, info.token1, info.reserve1 / info.reserve0);
    addPriceGraphEdge(graph, info.token1, info.token0, info.reserve0 / info.reserve1);
  });
  _degenPairPriceGraph = graph;
  return graph;
}

function findTokenPriceIn(
  graph: Map<string, { token: string; rate: number }[]> | null,
  fromToken: string,
  toToken: string,
) {
  if (!graph || !fromToken || !toToken) return null;
  const from = String(fromToken).toLowerCase();
  const to = String(toToken).toLowerCase();
  if (from === to) return 1;
  const seen = new Set([from]);
  const queue = [{ token: from, rate: 1 }];
  while (queue.length) {
    const cur = queue.shift()!;
    for (const edge of graph.get(cur.token) || []) {
      if (seen.has(edge.token)) continue;
      const nextRate = cur.rate * edge.rate;
      if (edge.token === to) return nextRate;
      seen.add(edge.token);
      queue.push({ token: edge.token, rate: nextRate });
    }
  }
  return null;
}

async function estimateLpVaultTvlInRewardToken(
  vaultAddr: string,
  lpAddr: string,
  rewardTokenAddr: string,
  lpDec = 18,
  priceGraph: Map<string, { token: string; rate: number }[]> | null = null,
) {
  try {
    const provider = await getPublicProvider();
    const pair = new Contract(lpAddr, PAIR_ABI, provider);
    const [vaultBalRaw, pairInfo] = await Promise.all([
      pair.balanceOf(vaultAddr).catch(() => 0n),
      getLpPairInfo(lpAddr, lpDec),
    ]);
    if (!pairInfo) return null;
    const share = Number(formatUnits(vaultBalRaw || 0n, lpDec)) / pairInfo.totalSupply;
    if (!(share > 0)) return null;
    const reward = rewardTokenAddr.toLowerCase();
    const price0 = findTokenPriceIn(priceGraph, pairInfo.token0, reward);
    const price1 = findTokenPriceIn(priceGraph, pairInfo.token1, reward);
    let rewardValue = 0;
    if (price0 !== null && price0 > 0) rewardValue += pairInfo.reserve0 * price0;
    if (price1 !== null && price1 > 0) rewardValue += pairInfo.reserve1 * price1;
    if (!(rewardValue > 0)) {
      if (pairInfo.token0 === reward) rewardValue = pairInfo.reserve0 * 2;
      if (pairInfo.token1 === reward) rewardValue = pairInfo.reserve1 * 2;
    }
    return rewardValue > 0 ? rewardValue * share : null;
  } catch (e) {
    console.warn("estimateLpVaultTvlInRewardToken", vaultAddr, (e as Error).message);
    return null;
  }
}

async function estimateLpVaultTvlUsd(vaultAddr: string, lpAddr: string, lpDec = 18) {
  try {
    const provider = await getPublicProvider();
    const lp = new Contract(lpAddr, ERC20_ABI, provider);
    const supplyAbi = new Contract(lpAddr, PAIR_ABI, provider);
    const [vaultBalRaw, supplyRaw, pairLiquidityUsd] = await Promise.all([
      lp.balanceOf(vaultAddr).catch(() => 0n),
      supplyAbi.totalSupply().catch(() => 0n),
      fetchPairLiquidityUsd(lpAddr),
    ]);
    if (!(pairLiquidityUsd !== null && pairLiquidityUsd > 0) || !supplyRaw || supplyRaw <= 0n)
      return null;
    const vaultBal = Number(formatUnits(vaultBalRaw || 0n, lpDec));
    const supply = Number(formatUnits(supplyRaw || 0n, lpDec));
    if (!(supply > 0)) return null;
    if (!(vaultBal > 0)) return null;
    const tvl = pairLiquidityUsd * (vaultBal / supply);
    return tvl >= 0.01 ? tvl : null;
  } catch (e) {
    console.warn("estimateLpVaultTvlUsd", vaultAddr, (e as Error).message);
    return null;
  }
}

async function estimateTokenVaultTvlUsd(vaultAddr: string, tokenAddr: string, dec = 18) {
  try {
    const provider = await getPublicProvider();
    const token = new Contract(tokenAddr, ERC20_ABI, provider);
    const [balRaw, priceUsd] = await Promise.all([
      token.balanceOf(vaultAddr).catch(() => 0n),
      fetchTokenUsd(tokenAddr),
    ]);
    const bal = Number(formatUnits(balRaw || 0n, dec));
    return bal > 0 && priceUsd !== null && priceUsd > 0 ? bal * priceUsd : null;
  } catch (e) {
    console.warn("estimateTokenVaultTvlUsd", vaultAddr, (e as Error).message);
    return null;
  }
}

function buildDegenOfficialStatsMap(details: OfficialStats[] | null) {
  const map = new Map<string, OfficialStats>();
  (details || []).forEach((item) => {
    if (!item) return;
    const entry = {
      ...item,
      apr: Number(item.apr),
      valueOfTVAL: Number(item.valueOfTVAL),
    };
    if (Number.isFinite(entry.poolId)) map.set(`pool:${Number(entry.poolId)}`, entry);
    if (entry.symbol) map.set(`symbol:${String(entry.symbol).toLowerCase()}`, entry);
  });
  return map;
}

async function fetchDegenOfficialStatsMap() {
  if (_degenOfficialStatsMap && Date.now() - officialStatsReadAt < 60_000) return _degenOfficialStatsMap;
  let details: OfficialStats[] | null = null;
  try {
    const data = (await withT(
      fetch(DEGEN_OFFICIAL_STATS_URL, { cache: "no-cache" }).then((r) =>
        r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`)),
      ),
      6000,
    )) as { vaultDetails?: OfficialStats[] };
    if (Array.isArray(data?.vaultDetails)) details = data.vaultDetails;
  } catch (e) {
    console.warn("fetchDegenOfficialStatsMap", (e as Error).message);
  }
  if (details) officialStatsReadAt = Date.now();
  _degenOfficialStatsMap = buildDegenOfficialStatsMap(
    details || [],
  );
  return _degenOfficialStatsMap;
}

function degenFarmSymbolKey(farm: FarmDef) {
  return String(farm?.name || "")
    .replace(/\s+V2\s+LP$/i, "")
    .replace(/\s+V1\s+LP$/i, "")
    .replace(/\s+LP$/i, "")
    .replace(/\s*\/\s*/g, "-")
    .toLowerCase();
}

function officialDegenFarmStats(
  statsMap: Map<string, OfficialStats> | null,
  farm: FarmDef,
  meta: VaultMeta | null,
) {
  if (!statsMap) return null;
  const byPool =
    meta?.poolId !== null && meta?.poolId !== undefined
      ? statsMap.get(`pool:${Number(meta.poolId)}`)
      : null;
  return byPool || statsMap.get(`symbol:${degenFarmSymbolKey(farm)}`) || null;
}

async function fetchDegenVaultMetaMap() {
  if (_degenVaultMetaMap) return _degenVaultMetaMap;
  try {
    const res = (await withT(
      fetch(DEGEN_VAULT_DATA_URL).then((r) => r.json()),
      7000,
    )) as VaultMeta[];
    const map = new Map<string, VaultMeta>();
    if (Array.isArray(res)) {
      res.forEach((item) => {
        if (item && item.vaultContract)
          map.set(item.vaultContract.toLowerCase(), item);
      });
    }
    _degenVaultMetaMap = map;
  } catch (e) {
    console.warn("fetchDegenVaultMetaMap", (e as Error).message);
    return new Map<string, VaultMeta>();
  }
  return _degenVaultMetaMap;
}

function annualRewardToken(allocMap: AllocMap, vaultAddr: string, poolId: number | null = null) {
  if (!allocMap) return null;
  let entry =
    poolId !== null && poolId !== undefined
      ? allocMap.byPool?.get(Number(poolId))
      : allocMap.map.get(String(vaultAddr).toLowerCase());
  if (!entry) entry = allocMap.map.get(String(vaultAddr).toLowerCase());
  if (!entry || !(allocMap.totalAlloc > 0)) return null;
  const poolShare = entry.allocPoint / allocMap.totalAlloc;
  return allocMap.rewardPerBlock * APR_BLOCKS_PER_DAY * DAYS_PER_YEAR * poolShare;
}

function annualRewardUsd(
  allocMap: AllocMap,
  vaultAddr: string,
  rewardPriceUsd: number | null,
  poolId: number | null = null,
) {
  if (!allocMap || !(rewardPriceUsd !== null && rewardPriceUsd > 0)) return null;
  const tokens = annualRewardToken(allocMap, vaultAddr, poolId);
  return tokens !== null && tokens > 0 ? tokens * rewardPriceUsd : null;
}

// ── Farm data type ────────────────────────────────────────────────────────────
type FarmData = {
  decimals: number;
  depositFeeBps: bigint | null;
  fundingRateBps: bigint | null;
  pendingKnown: boolean;
  farm: FarmDef;
  idx: number;
  stakeCount: number;
  stakeCountKnown: boolean;
  stakes: FarmStake[];
  totalStaked: number;
  totalStakedRaw: bigint;
  pendingDegen: number;
  dailyReward: number;
  apr: number | null;
  tvlUsd: number | null;
  tvlRewardToken: number | null;
  officialStats: OfficialStats | null;
  claimableStakeIds: bigint[];
  lpAddr: string | null;
  allocPct: number | null;
  pairToken0: string | null;
  pairToken1: string | null;
  walletBal: number | null;
  walletUsd: number | null;
  walletBalRaw: bigint | null;
  allowanceRaw: bigint | null;
  lpPriceUsd: number | null;
  stakedUsd: number | null;
  stakedPct: number | null;
  pendingUsd: number | null;
  annualRewardTokens: number | null;
  annualRewardsUsd: number | null;
  rewardPriceUsd: number | null;
  ts: number;
};


function emptyFarm(farm: FarmDef, idx: number): FarmData {
  return {
          decimals: farm.dec, depositFeeBps: null, fundingRateBps: null, pendingKnown: false,
          farm,
          idx,
          stakeCount: 0,
          stakeCountKnown: false,
          stakes: [],
          totalStaked: 0,
          totalStakedRaw: 0n,
          pendingDegen: 0,
          dailyReward: 0,
          apr: null,
          tvlUsd: null,
          tvlRewardToken: null,
          officialStats: null,
          claimableStakeIds: [],
          lpAddr: null,
          allocPct: null,
          pairToken0: null,
          pairToken1: null,
          walletBal: null,
          walletUsd: null,
          walletBalRaw: null,
          allowanceRaw: null,
          lpPriceUsd: null,
          stakedUsd: null,
          stakedPct: null,
          pendingUsd: null,
          annualRewardTokens: null,
          annualRewardsUsd: null,
          rewardPriceUsd: null,
          ts: Date.now(),
        };
}

function isActiveDegenFarm(d: FarmData | null) {
  return (
    !!d &&
    ((d.stakeCount || 0) > 0 ||
      (d.totalStaked || 0) > 1e-10 ||
      (d.pendingDegen || 0) > 1e-8 ||
      (d.dailyReward || 0) > 1e-10)
  );
}

function farmHighlightValue(d: FarmData, metric: "apr" | "tvl" | "rewards") {
  if (!d) return null;
  const pos = (v: number | string | null | undefined) => {
    if (v === null || v === undefined || v === "") return null;
    const n = Number(v);
    return Number.isFinite(n) && n > 0 ? n : null;
  };
  if (metric === "apr") return pos(d.apr);
  if (metric === "tvl") return pos(d.tvlUsd);
  const officialAnnual = pos(d.officialStats?.valueOfAnnualInterest);
  if (officialAnnual) return officialAnnual;
  const annualUsd = pos(d.annualRewardsUsd);
  if (annualUsd) return annualUsd;
  const apr = pos(d.apr);
  const tvl = pos(d.tvlUsd);
  if (apr && tvl) return tvl * (apr / 100);
  return null;
}

function farmHighlightDisplay(value: number | null, metric: string) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return "—";
  if (metric === "apr") return farmAprText(n);
  if (metric === "tvl" || metric === "rewards") return "$" + fmtFullReward(n) + " USD";
  return fmtFullReward(n);
}

function pulsexAddUrlForFarm(farm: FarmDef | undefined) {
  return /\bV1\s+LP\b/i.test(String(farm?.name || ""))
    ? PULSEX_ADD_V1_URL
    : PULSEX_ADD_V2_URL;
}

function farmProtocolLabel(farm: FarmDef) {
  const version = String(farm?.name || "").match(/\bV(\d+)\s+LP\b/i)?.[1];
  if (version) return `PLP V${version}`;
  return (farm?.tokens?.length || 0) > 1 ? "PLP" : farm?.tokens?.[0] || "Token";
}

// ── Small presentational pieces ───────────────────────────────────────────────
function FarmTokenOrb({ token }: { token: string }) {
  const logo = TOKEN_LOGOS[token];
  const label = token.replace(/^p/, "").slice(0, 4);
  return (
    <span className="bfc-token-orb">
      {logo ? (
        <img
          src={logo}
          alt={token}
          onError={(event) => {
            event.currentTarget.outerHTML = label;
          }}
        />
      ) : (
        label
      )}
    </span>
  );
}

function FarmTokenPair({ tokens }: { tokens: string[] }) {
  return (
    <div className="bfc-avatar-pair">
      {tokens.map((token) => (
        <FarmTokenOrb key={token} token={token} />
      ))}
    </div>
  );
}

function AprBreakdownPop({ apr }: { apr: number | null }) {
  const n = Number(apr);
  if (!Number.isFinite(n) || !(n > 0)) return null;
  const f = (v: number) =>
    v >= 100 ? Math.round(v).toLocaleString() + "%" : v.toFixed(2) + "%";
  return (
    <FarmPop
      icon="📊"
      title="APR Breakdown"
      rows={[
        ["Daily", f(n / 365)],
        ["Weekly", f(n / 52)],
        ["Monthly", f(n / 12)],
        ["Yearly", f(n)],
        ["Assumptions", "Simple annual return, no compounding. Current prices and allocation; RPC estimate assumes 600 blocks/day. API estimates may use different timing."],
      ]}
    />
  );
}

function RewardsProjectionPop({ d }: { d: FarmData }) {
  const price = Number(d?.rewardPriceUsd) || 0;
  let daily = Number(d?.dailyReward) || 0;
  if (!(daily > 0) && (d?.stakedUsd || 0) > 0 && (d?.apr || 0) > 0 && price > 0) {
    daily = ((d.stakedUsd! * (d.apr! / 100)) / 365) / price;
  }
  const f = (mult: number) => {
    const t = daily * mult;
    const usd = price > 0 ? ` ($${fmtFullReward(t * price)} USD)` : "";
    return `${fmtFullReward(t)} DEGEN${usd}`;
  };
  return (
    <FarmPop
      icon="📈"
      title="Rewards Projection"
      rows={[
        ["Daily", f(1)],
        ["Weekly", f(7)],
        ["Monthly", f(30)],
        ["Yearly", f(365)],
      ]}
    />
  );
}

function farmTimeLeftNode(
  annualTokens: number | null,
  allocPctRaw: string | number | undefined,
): ReactNode {
  const alloc = Number(allocPctRaw);
  if ((annualTokens || 0) > 0 || alloc > 0)
    return "Active";
  if (annualTokens === 0 || alloc === 0) return "No allocation";
  return "—";
}

function farmStakeAmountsKnown(d: FarmData) {
  return d.stakeCountKnown && d.stakes?.length === d.stakeCount && d.stakes.every((s) => s.info !== null);
}

type Status = { msg: string; cls: string };
type Breakdown =
  | { state: "loading" }
  | { state: "unavailable" }
  | { state: "ready"; cells: { sym: string; amt: number; price: number | null; logo: string | null }[] };

type HarvestModalState = {
  amount: number;
  amountRaw: bigint;
  farmName: string | null;
  destinations: { label: string; addr: string | null; payoutBps: bigint; minimum: bigint; minimumServe: bigint }[];
  input: string;
  slider: number;
  selected: number;
  resolve: (v: { into: string; amount: bigint; payoutBps: bigint; minimum: bigint; minimumServe: bigint }) => void;
  reject: (e: Error) => void;
} | null;

const FARM_TVL_HIST_KEY = "cashx_farms_tvl_hist_v1";

function recordTvlSnapshot(tvl: number) {
  try {
    const now = Date.now();
    const stored = JSON.parse(localStorage.getItem(FARM_TVL_HIST_KEY) || "[]");
    let history: Array<{ t: number; v: number }> = Array.isArray(stored) ? stored : [];
    history = history.filter(
      (entry) =>
        entry &&
        Number.isFinite(entry.t) &&
        Number.isFinite(entry.v) &&
        now - entry.t < 8 * 86400000,
    );
    const last = history[history.length - 1];
    if (!last || now - last.t > 30 * 60000) {
      history.push({ t: now, v: tvl });
      localStorage.setItem(FARM_TVL_HIST_KEY, JSON.stringify(history));
    }
    return history;
  } catch {
    return [];
  }
}

function getTvlChange24h(tvl: number) {
  const history = recordTvlSnapshot(tvl);
  const now = Date.now();
  let reference: { t: number; v: number } | null = null;
  let bestDifference = Infinity;
  history.forEach((entry) => {
    const age = now - entry.t;
    if (age < 20 * 3600000 || age > 30 * 3600000) return;
    const difference = Math.abs(age - 86400000);
    if (difference < bestDifference) {
      bestDifference = difference;
      reference = entry;
    }
  });
  const selectedReference = reference as { t: number; v: number } | null;
  if (!selectedReference || !(selectedReference.v > 0)) return null;
  return ((tvl - selectedReference.v) / selectedReference.v) * 100;
}

// ── Component ─────────────────────────────────────────────────────────────────
export function FarmsPage({ wallet }: { wallet: WalletState }) {
  const queryClient = useQueryClient();
  const pageActive = usePageActive();
  const farmQueryKey = ["farm-snapshot", wallet.address?.toLowerCase() ?? null];
  const [farms, setFarms] = useState<(FarmData | null)[]>(() =>
    queryClient.getQueryData<(FarmData | null)[]>(farmQueryKey) ?? DEGEN_FARMS.map(emptyFarm),
  );
  const [loading, setLoading] = useState(false);
  const [helperCredit, setHelperCredit] = useState<number | null>(null);
  const [allClaimRaw, setAllClaimRaw] = useState<bigint | null>(null);
  const allClaimRead = useRef<Promise<{ snapshot: FarmClaimSnapshot; totalRaw: bigint }> | null>(null);
  const activeRef = useRef(pageActive); activeRef.current = pageActive;
  const claimGeneration = useRef(0);
  const [stakedOnly, setStakedOnly] = useState(false);
  const [view, setView] = useState<"grid" | "table">("grid");
  const [inputs, setInputs] = useState<Record<number, string>>({});
  const [statuses, setStatuses] = useState<Record<number, Status>>({});
  const [busy, setBusy] = useState<Record<number, boolean>>({});
  const [openStakes, setOpenStakes] = useState<Record<number, boolean>>({});
  const [breakdowns, setBreakdowns] = useState<Record<number, Breakdown | undefined>>({});
  const [harvestModal, setHarvestModal] = useState<HarvestModalState>(null);
  const [tvlChange24h, setTvlChange24h] = useState<number | null>(null);
  const loadSeq = useRef(0);
  const actionLocks = useRef(new Set<number>());
  const claimDialogLock = useRef(false);
  const claimSubmissionLock = useRef(false);
  const beginAction = (idx: number) => {
    if (actionLocks.current.has(idx) || actionLocks.current.has(-1) || (idx === -1 && actionLocks.current.size > 0)) return false;
    actionLocks.current.add(idx);
    setBusy(current => ({ ...current, [idx]: true }));
    return true;
  };
  const endAction = (idx: number) => {
    actionLocks.current.delete(idx);
    setBusy(current => ({ ...current, [idx]: false }));
  };
  const statusTimers = useRef<Record<number, ReturnType<typeof setTimeout>>>({});
  const harvestModalRef = useRef(harvestModal);
  harvestModalRef.current = harvestModal;
  useEffect(() => {
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && harvestModalRef.current) {
        harvestModalRef.current.reject(new Error("Cancelled")); setHarvestModal(null);
      }
    };
    window.addEventListener("keydown", escape);
    return () => {
      window.removeEventListener("keydown", escape);
      claimGeneration.current++;
      harvestModalRef.current?.reject(new Error("Cancelled"));
      Object.values(statusTimers.current).forEach(clearTimeout);
    };
  }, []);

  const setFarmStatus = useCallback((idx: number, msg: string, cls = "") => {
    setStatuses((prev) => ({ ...prev, [idx]: { msg, cls } }));
  }, []);
  const clearFarmStatusSoon = useCallback(
    (idx: number, ms = 6000) => {
      if (statusTimers.current[idx]) clearTimeout(statusTimers.current[idx]);
      statusTimers.current[idx] = setTimeout(
        () => setFarmStatus(idx, ""),
        ms,
      );
    },
    [setFarmStatus],
  );

  const patchFarm = (idx: number, patch: Partial<FarmData>) => {
    const update = (prev: (FarmData | null)[]) =>
      prev.map((d, i) => (i === idx && d ? { ...d, ...patch } : d));
    setFarms(update);
    queryClient.setQueryData<(FarmData | null)[]>(farmQueryKey, (prev) =>
      prev ? update(prev) : undefined,
    );
  };

  const fetchHelperCredit = useCallback(async () => {
    if (!wallet.address) return;
    try {
      const provider = await getPublicProvider();
      const helper = new Contract(
        DEGEN_REWARDS_HELPER,
        DEGEN_REWARDS_HELPER_ABI,
        provider,
      );
      const raw = await helper.balanceOf(wallet.address);
      setHelperCredit(Number(formatEther(raw)));
    } catch (e) {
      console.warn("fetchDegenHelperCredit", (e as Error).message);
    }
  }, [wallet.address]);

  const readFreshClaim = useCallback(async (farm: FarmData | null) => {
    if (!wallet.address) throw new Error("Connect your wallet first.");
    if (!farm && allClaimRead.current) return allClaimRead.current;
    const account = wallet.address;
    const read = (async () => {
      const provider = await getPublicProvider();
      const block = await provider.getBlock("latest");
      if (!block || !Number.isSafeInteger(block.number) || Date.now() - block.timestamp * 1000 > 120_000 || block.timestamp * 1000 - Date.now() > 30_000) throw new Error("Current farm rewards could not be checked. Please try again shortly.");
      const helper = new Contract(DEGEN_REWARDS_HELPER, DEGEN_REWARDS_HELPER_ABI, provider);
      const at = { blockTag: block.number };
      const vaults = new Map<string, Contract>();
      const vault = (address: string) => {
        if (!vaults.has(address)) vaults.set(address, new Contract(address, DEGEN_VAULT_ABI, provider));
        return vaults.get(address)!;
      };
      const snapshot = await readFarmClaimSnapshot(account, farm ? [farm.farm.addr] : DEGEN_FARMS.map(item => item.addr), {
        helperBalance: user => helper.balanceOf(user, at),
        stakeCount: (address, user) => vault(address).getNrOfStakes(user, at),
        pendingRewards: (address, user) => vault(address).viewUserTotalEarnings(user, at),
      });
      // Stateful eth_call includes funding fees and already accumulated Chef credit.
      // No simulated harvest or transfer is submitted to the chain.
      const totalRaw = await quoteFarmClaim(provider, account, DEGEN_REWARDS_HELPER, snapshot.farms, block.number);
      if (Date.now() - block.timestamp * 1000 > 120_000) throw new Error("Farm rewards changed while checking. Please try again.");
      return { snapshot, totalRaw };
    })();
    const bounded = withT(read, 20_000).catch(error => {
      if (error instanceof Error && error.message === "timeout") throw new Error("Farm rewards are taking longer to load. Please try the claim again shortly.");
      throw error;
    });
    if (!farm) allClaimRead.current = bounded;
    try { return await bounded; }
    finally { if (!farm && allClaimRead.current === bounded) allClaimRead.current = null; }
  }, [wallet.address]);

  useEffect(() => {
    if (!pageActive || !wallet.address) return;
    let stopped = false, running = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      if (stopped || running || document.hidden) return;
      running = true;
      try { const fresh = await readFreshClaim(null); if (!stopped) setAllClaimRaw(fresh.totalRaw); }
      catch { /* Retain the last successful total; a claim still requires a fresh quote. */ }
      finally { running = false; clearTimeout(timer); if (!stopped) timer = setTimeout(() => void poll(), 60_000); }
    };
    const resume = () => { if (!document.hidden) { clearTimeout(timer); void poll(); } };
    void poll();
    document.addEventListener("visibilitychange", resume);
    window.addEventListener("degen:transaction-settled", resume);
    return () => { stopped = true; clearTimeout(timer); document.removeEventListener("visibilitychange", resume); window.removeEventListener("degen:transaction-settled", resume); };
  }, [pageActive, wallet.address, readFreshClaim]);
  useEffect(() => {
    if (!pageActive) { claimGeneration.current++; harvestModalRef.current?.reject(new Error("Cancelled")); setHarvestModal(null); }
  }, [pageActive]);

  // ── fetchDegenVaultData (ported) ────────────────────────────────────────────
  const loadFarms = useCallback(async () => {
    if (!wallet.address) {
      setFarms([]);
      return;
    }
    const address = wallet.address;
    const seq = ++loadSeq.current;
    setLoading(true);
    setFarms(queryClient.getQueryData<(FarmData | null)[]>([
      "farm-snapshot", address.toLowerCase(),
    ]) ?? DEGEN_FARMS.map(emptyFarm));

    if (Date.now() - priceCacheReadAt > 60_000) {
      _farmTokenPriceCache.clear(); _farmPairLiquidityCache.clear(); _farmPairInfoCache.clear(); _lpBreakdownCache.clear();
      priceCacheReadAt = Date.now();
    }
    const [provider, metaMap, allocMap, degenPriceUsd, officialStatsMap] = await Promise.all([
      getPublicProvider(),
      fetchDegenVaultMetaMap(),
      _degenAllocMap && Date.now() - allocationReadAt < 60_000 ? Promise.resolve(_degenAllocMap) : buildAllocMap(),
      fetchTokenUsd(CONTRACTS.degen),
      fetchDegenOfficialStatsMap(),
    ]);
    if (allocMap) { _degenAllocMap = allocMap; allocationReadAt = Date.now(); }
    void fetchHelperCredit();
    let degenPriceGraph: Map<string, { token: string; rate: number }[]> | null =
      null;

    const results: (FarmData | null)[] = new Array(DEGEN_FARMS.length).fill(null);

    const loadDegenFarm = async (farm: FarmDef, idx: number) => {
      let stakeCount = 0,
        totalStaked = 0,
        totalStakedRaw = 0n,
        pendingDegen = 0,
        dailyReward = 0;
      let stakeCountKnown = false;
      let stakes: FarmStake[] = [];
      let apr: number | null = null,
        tvlUsd: number | null = null,
        tvlRewardToken: number | null = null;
      const claimableStakeIds: bigint[] = [];
      let walletBal: number | null = null,
        walletUsd: number | null = null,
        lpPriceUsd: number | null = null,
        vaultTotalLp: number | null = null;
      let stakedUsd: number | null = null,
        stakedPct: number | null = null,
        pendingUsd: number | null = null;
      let annualRewardTokens: number | null = null,
        annualRewardsUsd: number | null = null;
      let walletBalRaw: bigint | null = null,
        allowanceRaw: bigint | null = null;
      let pairToken0: string | null = null,
        pairToken1: string | null = null;

      const meta = metaMap.get(farm.addr.toLowerCase()) || null;
      const lpAddr = meta?.tokenContract || null;
      let lpDec = meta?.decimals ?? farm.dec;
      let depositFeeBps: bigint | null = null, fundingRateBps: bigint | null = null;
      let pendingKnown = false;

      const officialStats = officialDegenFarmStats(officialStatsMap, farm, meta);
      if (officialStats) {
        if (Number.isFinite(officialStats.apr)) apr = officialStats.apr;
        if (officialStats.valueOfTVAL > 0) tvlUsd = officialStats.valueOfTVAL;
        if ((officialStats.valueOfAnnualInterest || 0) > 0)
          annualRewardsUsd = officialStats.valueOfAnnualInterest!;
      }
      annualRewardTokens = annualRewardToken(_degenAllocMap, farm.addr, meta?.poolId ?? null);
      if (!(annualRewardTokens !== null && annualRewardTokens > 0) && (annualRewardsUsd || 0) > 0 && (degenPriceUsd || 0) > 0) {
        annualRewardTokens = annualRewardsUsd! / degenPriceUsd!;
      }
      if (!((annualRewardsUsd || 0) > 0) && (annualRewardTokens || 0) > 0 && (degenPriceUsd || 0) > 0) {
        annualRewardsUsd = annualRewardTokens! * degenPriceUsd!;
      }

      let allocPct: number | null = null;
      if (officialStats?.rewardAllocation !== undefined && officialStats?.rewardAllocation !== null) {
        const a = Number(officialStats.rewardAllocation);
        if (Number.isFinite(a)) allocPct = a;
      }
      if (allocPct === null && _degenAllocMap) {
        const aEntry =
          _degenAllocMap.map.get(farm.addr.toLowerCase()) ||
          (meta?.poolId !== null && meta?.poolId !== undefined
            ? _degenAllocMap.byPool?.get(Number(meta.poolId))
            : null);
        if (aEntry && _degenAllocMap.totalAlloc > 0)
          allocPct = (aEntry.allocPoint / _degenAllocMap.totalAlloc) * 100;
      }

      try {
        const c = new Contract(farm.addr, DEGEN_VAULT_ABI, provider);
        [depositFeeBps, fundingRateBps, lpDec] = await Promise.all([
          withT(c.depositFee(), 4000).then(BigInt).catch(() => null),
          withT(c.fundingRate(), 4000).then(BigInt).catch(() => null),
          lpAddr ? withT(new Contract(lpAddr, TOKEN_DEC_ABI, provider).decimals(), 4000).then(Number).catch(() => lpDec) : Promise.resolve(lpDec),
        ]);
        if (!Number.isInteger(lpDec) || lpDec < 0 || lpDec > 36) throw new Error("Unsupported token precision.");
        const nStakesRaw = await withT(c.getNrOfStakes(address), 6000).catch(() => null);
        const stakesKnown = nStakesRaw !== null;
        stakeCountKnown = stakesKnown;
        if (stakesKnown) stakeCount = Number(nStakesRaw);
        pendingKnown = stakesKnown && stakeCount === 0;

        let totalEarnedRaw: bigint | null = null;
        if (!stakesKnown || stakeCount > 0) {
          totalEarnedRaw = (await withT(c.viewUserTotalEarnings(address), 6000).catch(
            () => null,
          )) as bigint | null;
          pendingKnown = totalEarnedRaw !== null;
          if (totalEarnedRaw && totalEarnedRaw > 0n) {
            pendingDegen = Number(formatUnits(totalEarnedRaw, 18));
          }
        }

        if (stakeCount > 0) {
          stakes = await readFarmStakes({
            userInfo: (user, id) => withT(c.userInfo(user, id), 4000),
            viewStakeEarnings: (user, id) => withT(c.viewStakeEarnings(user, id), 4000),
          }, address, stakeCount);
          const totals = summarizeFarmStakes(stakes);
          if (totals.totalRaw !== null) {
            totalStakedRaw = totals.totalRaw;
            totalStaked = Number(formatUnits(totalStakedRaw, lpDec));
          }
          if (totalEarnedRaw === null && totals.rewardsRaw !== null) { pendingDegen = Number(formatUnits(totals.rewardsRaw, 18)); pendingKnown = true; }
          claimableStakeIds.push(...totals.claimableIds);
          if (totals.rewardsRaw === null && pendingDegen > 0) {
            claimableStakeIds.splice(0, claimableStakeIds.length, ...stakes.map((s) => s.id));
          }
          if (pendingDegen > 0 && claimableStakeIds.length === 0) {
            for (let s = 0; s < stakeCount; s++) claimableStakeIds.push(BigInt(s));
          }
        }

        if (lpAddr) {
          const lp = new Contract(lpAddr, ERC20_ABI, provider);
          const lpSupplyC = new Contract(lpAddr, PAIR_ABI, provider);
          const [wRaw, vRaw, sRaw, aRaw, pairLiq] = await Promise.all([
            withT(lp.balanceOf(address), 5000).catch(() => null),
            withT(lp.balanceOf(farm.addr), 5000).catch(() => null),
            withT(lpSupplyC.totalSupply(), 5000).catch(() => null),
            withT(lp.allowance(address, farm.addr), 5000).catch(() => null),
            meta?.isLP !== false ? fetchPairLiquidityUsd(lpAddr) : Promise.resolve(null),
          ]);
          if (wRaw !== null) {
            walletBal = Number(formatUnits(wRaw, lpDec));
            walletBalRaw = BigInt(wRaw);
          }
          if (aRaw !== null) allowanceRaw = BigInt(aRaw);
          if (vRaw !== null) vaultTotalLp = Number(formatUnits(vRaw, lpDec));
          if (meta?.isLP !== false) {
            const lpSupply = sRaw !== null ? Number(formatUnits(sRaw, lpDec)) : 0;
            if ((pairLiq || 0) > 0 && lpSupply > 0) lpPriceUsd = pairLiq! / lpSupply;
            const info = await getLpPairInfo(lpAddr, lpDec).catch(() => null);
            if (info) {
              pairToken0 = info.token0;
              pairToken1 = info.token1;
            }
            if (!((lpPriceUsd || 0) > 0) && info && info.totalSupply > 0) {
              const [p0, p1] = await Promise.all([
                fetchTokenUsd(info.token0),
                fetchTokenUsd(info.token1),
              ]);
              let liq = 0;
              if ((p0 || 0) > 0 && (p1 || 0) > 0)
                liq = info.reserve0 * p0! + info.reserve1 * p1!;
              else if ((p0 || 0) > 0) liq = info.reserve0 * p0! * 2;
              else if ((p1 || 0) > 0) liq = info.reserve1 * p1! * 2;
              if (liq > 0) lpPriceUsd = liq / info.totalSupply;
            }
          } else {
            lpPriceUsd = await fetchTokenUsd(lpAddr);
          }
        }

        const annualUsd = annualRewardUsd(_degenAllocMap, farm.addr, degenPriceUsd, meta?.poolId ?? null);
        if (!((tvlUsd || 0) > 0) && (vaultTotalLp || 0) > 0 && (lpPriceUsd || 0) > 0)
          tvlUsd = vaultTotalLp! * lpPriceUsd!;
        if (!((tvlUsd || 0) > 0) && meta?.tokenContract) {
          tvlUsd =
            meta.isLP !== false
              ? await estimateLpVaultTvlUsd(farm.addr, meta.tokenContract, meta.decimals || farm.dec)
              : await estimateTokenVaultTvlUsd(farm.addr, meta.tokenContract, meta.decimals || farm.dec);
        }
        if (!(apr !== null && apr >= 0))
          apr = (annualUsd || 0) > 0 && (tvlUsd || 0) > 0 ? (annualUsd! / tvlUsd!) * 100 : null;
        if (!(apr !== null && apr >= 0) && meta?.tokenContract) {
          if (meta.isLP !== false) {
            if (!degenPriceGraph) degenPriceGraph = await buildVaultPairPriceGraph(metaMap);
            tvlRewardToken = await estimateLpVaultTvlInRewardToken(
              farm.addr,
              meta.tokenContract,
              CONTRACTS.degen,
              meta.decimals || farm.dec,
              degenPriceGraph,
            );
          } else if (meta.tokenContract.toLowerCase() === CONTRACTS.degen.toLowerCase()) {
            const rewardToken = new Contract(meta.tokenContract, ERC20_ABI, provider);
            const balRaw = await rewardToken.balanceOf(farm.addr).catch(() => 0n);
            tvlRewardToken = Number(formatUnits(balRaw, meta.decimals || farm.dec));
          }
          const annualToken = annualRewardToken(_degenAllocMap, farm.addr, meta?.poolId ?? null);
          apr =
            (annualToken || 0) > 0 && (tvlRewardToken || 0) > 0
              ? (annualToken! / tvlRewardToken!) * 100
              : null;
        }
      } catch (e) {
        console.warn("degen vault", farm.name, (e as Error).message);
      }

      if ((lpPriceUsd || 0) > 0) {
        if (walletBal !== null) walletUsd = walletBal * lpPriceUsd!;
        if (totalStaked > 1e-10) stakedUsd = totalStaked * lpPriceUsd!;
      }
      if (totalStaked > 1e-10 && (vaultTotalLp || 0) > 0)
        stakedPct = (totalStaked / vaultTotalLp!) * 100;
      else if ((stakedUsd || 0) > 0 && (tvlUsd || 0) > 0)
        stakedPct = (stakedUsd! / tvlUsd!) * 100;
      if (pendingDegen > 0 && (degenPriceUsd || 0) > 0)
        pendingUsd = pendingDegen * degenPriceUsd!;

      if (_degenAllocMap && (stakedUsd || 0) > 0 && (tvlUsd || 0) > 0) {
        const entry =
          _degenAllocMap.map.get(farm.addr.toLowerCase()) ||
          (meta?.poolId !== null && meta?.poolId !== undefined
            ? _degenAllocMap.byPool?.get(Number(meta.poolId))
            : null);
        if (entry && _degenAllocMap.totalAlloc > 0) {
          const poolShare = entry.allocPoint / _degenAllocMap.totalAlloc;
          const userShare = Math.min(stakedUsd! / tvlUsd!, 1);
          dailyReward = userShare * _degenAllocMap.rewardPerBlock * BLOCKS_PER_DAY * poolShare;
        }
      }
      results[idx] = {
        decimals: lpDec, depositFeeBps, fundingRateBps, pendingKnown,
        farm,
        idx,
        stakeCount,
        stakeCountKnown,
        stakes,
        totalStaked,
        totalStakedRaw,
        pendingDegen,
        dailyReward,
        apr,
        tvlUsd,
        tvlRewardToken,
        officialStats,
        claimableStakeIds,
        lpAddr,
        allocPct,
        pairToken0,
        pairToken1,
        walletBal,
        walletUsd,
        walletBalRaw,
        allowanceRaw,
        lpPriceUsd,
        stakedUsd,
        stakedPct,
        pendingUsd,
        annualRewardTokens,
        annualRewardsUsd,
        rewardPriceUsd: degenPriceUsd,
        ts: Date.now(),
      };
    };

    // Batch RPC work to avoid public-node rate limits (25 farms × ~8 calls each)
    const BATCH = 8;
    for (let i = 0; i < DEGEN_FARMS.length; i += BATCH) {
      await Promise.allSettled(
        DEGEN_FARMS.slice(i, i + BATCH).map((farm, j) => loadDegenFarm(farm, i + j)),
      );
      if (loadSeq.current !== seq) return;
      setFarms((prev) => results.map((result, idx) => {
        const previous = prev[idx];
        if (result && previous) {
          if (!result.pendingKnown && previous.pendingKnown) { result.pendingDegen = previous.pendingDegen; result.pendingUsd = previous.pendingUsd; result.pendingKnown = true; }
          if (!farmStakeAmountsKnown(result) && farmStakeAmountsKnown(previous)) {
            result.totalStaked = previous.totalStaked; result.totalStakedRaw = previous.totalStakedRaw; result.stakedUsd = previous.stakedUsd; result.stakes = previous.stakes; result.stakeCountKnown = true; result.stakeCount = previous.stakeCount;
          }
          for (const key of ["walletBal", "walletBalRaw", "walletUsd", "allowanceRaw", "lpPriceUsd", "tvlUsd", "apr"] as const) {
            if (result[key] === null) Object.assign(result, { [key]: previous[key] });
          }
        }
        return result ?? previous ?? null;
      }));
    }

    const previous = queryClient.getQueryData<(FarmData | null)[]>(["farm-snapshot", address.toLowerCase()]);
    DEGEN_FARMS.forEach((farm, idx) => {
      if (!results[idx] && previous?.[idx]) results[idx] = previous[idx];
      if (!results[idx])
        results[idx] = emptyFarm(farm, idx);
    });
    if (loadSeq.current !== seq) return;
    queryClient.setQueryData(["farm-snapshot", address.toLowerCase()], results);
    setFarms(results);
    setLoading(false);
  }, [wallet.address, fetchHelperCredit, queryClient]);

  useEffect(() => {
    let disposed = false;
    let timer: ReturnType<typeof setTimeout>;
    let running = false;
    const poll = async () => {
      if (disposed || running || document.hidden || !pageActive) return;
      running = true;
      try { await loadFarms(); }
      catch { /* Preserve the previous snapshot; retry automatically. */ }
      finally {
        running = false;
        if (!disposed) {
          setLoading(false);
          timer = setTimeout(() => void poll(), 60_000);
        }
      }
    };
    const resume = () => {
      if (!document.hidden && !running) {
        clearTimeout(timer);
        void poll();
      }
    };
    void poll();
    document.addEventListener("visibilitychange", resume);
    window.addEventListener("degen:transaction-confirmed", resume);
    window.addEventListener("degen:transaction-settled", resume);
    return () => {
      disposed = true;
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", resume);
      window.removeEventListener("degen:transaction-confirmed", resume);
      window.removeEventListener("degen:transaction-settled", resume);
      loadSeq.current += 1;
    };
  }, [loadFarms, pageActive]);

  // ── refreshDegenFarmData (ported) ───────────────────────────────────────────
  const refreshFarm = useCallback(
    async (d: FarmData) => {
      if (!wallet.address) return;
      const address = wallet.address;
      try {
        const provider = await getPublicProvider();
        const c = new Contract(d.farm.addr, DEGEN_VAULT_ABI, provider);
        const lp = d.lpAddr ? new Contract(d.lpAddr, ERC20_ABI, provider) : null;
        const [nStakes, wRaw, aRaw] = await Promise.all([
          c.getNrOfStakes(address).catch(() => null),
          lp ? lp.balanceOf(address).catch(() => null) : null,
          lp ? lp.allowance(address, d.farm.addr).catch(() => null) : null,
        ]);
        const patch: Partial<FarmData> = { ts: Date.now() };
        let stakeCount = d.stakeCount;
        if (nStakes !== null) {
          stakeCount = Number(nStakes);
          patch.stakeCount = stakeCount;
        }
        patch.stakeCountKnown = nStakes !== null;
        if (wRaw !== null) {
          patch.walletBalRaw = BigInt(wRaw);
          patch.walletBal = Number(formatUnits(wRaw, d.decimals));
          if ((d.lpPriceUsd || 0) > 0) patch.walletUsd = patch.walletBal! * d.lpPriceUsd!;
        }
        if (aRaw !== null) patch.allowanceRaw = BigInt(aRaw);
        if (nStakes === null) {
          patchFarm(d.idx, patch);
          await fetchHelperCredit();
          return;
        }
        const stakes = await readFarmStakes({
          userInfo: (user, id) => withT(c.userInfo(user, id), 4000),
          viewStakeEarnings: (user, id) => withT(c.viewStakeEarnings(user, id), 4000),
        }, address, stakeCount);
        patch.stakes = stakes;
        const totals = summarizeFarmStakes(stakes);
        const totalStakedRaw = totals.totalRaw ?? d.totalStakedRaw;
        const totalStaked = Number(formatUnits(totalStakedRaw, d.decimals));
        const totalEarned = await withT(c.viewUserTotalEarnings(address), 4000).catch(() => totals.rewardsRaw);
        const pending = totalEarned !== null ? Number(formatUnits(totalEarned, 18)) : d.pendingDegen;
        const claimIds = totals.rewardsRaw === null && pending > 0 ? stakes.map((s) => s.id) : totals.claimableIds;
        patch.totalStaked = totalStaked;
        patch.totalStakedRaw = totalStakedRaw;
        if (totals.totalRaw !== null) {
          patch.dailyReward = totalStaked === 0 ? 0
            : d.totalStaked > 0 ? d.dailyReward * totalStaked / d.totalStaked : d.dailyReward;
        }
        patch.pendingDegen = pending;
        patch.pendingKnown = totalEarned !== null;
        patch.claimableStakeIds = claimIds;
        patch.stakedUsd =
          (d.lpPriceUsd || 0) > 0 && totalStaked > 1e-10 ? totalStaked * d.lpPriceUsd! : null;
        patch.stakedPct =
          (patch.stakedUsd || 0) > 0 && (d.tvlUsd || 0) > 0
            ? (patch.stakedUsd! / d.tvlUsd!) * 100
            : null;
        patch.pendingUsd =
          pending > 0 && (d.rewardPriceUsd || 0) > 0 ? pending * d.rewardPriceUsd! : null;
        patchFarm(d.idx, patch);
        await fetchHelperCredit();
      } catch (e) {
        console.warn("refreshDegenFarmData", (e as Error).message);
      }
    },
    [wallet.address, fetchHelperCredit],
  );

  // ── pickHarvestDest (ported as a modal driven by state) ────────────────────
  async function readClaimDestinations(helper: Contract) {
    return Promise.all(HARVEST_DESTS_DEGEN.map(async destination => {
      const [payout, minimumServe, minimum] = await Promise.all([
        destination.addr ? helper.viewPoolPayout(destination.addr) : helper.defaultDirectPayout(),
        destination.addr ? helper.viewPoolMinServe(destination.addr) : Promise.resolve(0n),
        destination.addr ? new Contract(destination.addr, ["function minimumGift() view returns (uint256)"], helper.runner).minimumGift() : Promise.resolve(0n),
      ]);
      const payoutBps = BigInt(payout);
      if (payoutBps < 0n || payoutBps > 10000n) throw new Error("Claim payout terms are unavailable.");
      return { label: destination.label, addr: destination.addr, payoutBps, minimum: BigInt(minimum), minimumServe: BigInt(minimumServe) };
    }));
  }
  async function pickHarvestDest(amountRaw: bigint, helper: Contract, farmName: string | null = null) {
    if (claimDialogLock.current) throw new Error("Choose or close the current claim first.");
    claimDialogLock.current = true;
    try {
      const destinations = await readClaimDestinations(helper);
      return await new Promise<{ into: string; amount: bigint; payoutBps: bigint; minimum: bigint; minimumServe: bigint }>((resolve, reject) => {
        setHarvestModal({ amount: Number(formatUnits(amountRaw, 18)), amountRaw, farmName, destinations,
          input: formatUnits(amountRaw, 18), slider: 100, selected: 0, resolve, reject });
      });
    } finally { claimDialogLock.current = false; }
  }
  const hdCurrentAmount = (modal: NonNullable<HarvestModalState>) => {
    try {
      if (!/^(0|[1-9]\d*)(\.\d+)?$/.test(modal.input)) return 0n;
      const value = parseUnits(modal.input, 18);
      return value > 0n && value <= modal.amountRaw ? value : 0n;
    } catch { return 0n; }
  };
  const hdPctText = (destination: NonNullable<HarvestModalState>["destinations"][number], claimAmt: bigint) => {
    const payout = claimAmt * destination.payoutBps / 10000n;
    return `${Number(10000n - destination.payoutBps) / 100}% penalty · ${formatUnits(payout, 18)} DEGEN${payout < destination.minimum ? ` · minimum payout ${formatUnits(destination.minimum, 18)}` : ""}`;
  };

  // ── Actions ────────────────────────────────────────────────────────────────
  const inputAmountWei = (idx: number) => {
    const v = inputs[idx]?.trim();
    if (!v || !(Number(v) > 0)) return null;
    try {
      if (!/^(0|[1-9]\d*)(\.\d+)?$/.test(v)) return null;
      return parseUnits(v, farms[idx]?.decimals ?? DEGEN_FARMS[idx].dec);
    } catch {
      return null;
    }
  };

  async function approveFarm(d: FarmData) {
    if (!d.lpAddr || !wallet.address) return;
    const amt = inputAmountWei(d.idx);
    if (!amt) { setFarmStatus(d.idx, "Enter the LP amount to approve.", "err"); return; }
    if (!beginAction(d.idx)) return;
    try {
      const signer = await wallet.getSigner();
      const lp = new Contract(d.lpAddr, [...ERC20_ABI, ...TOKEN_DEC_ABI], signer);
      const vault = new Contract(d.farm.addr, DEGEN_VAULT_ABI, signer);
      const [token, decimals] = await Promise.all([vault.stakeToken(), lp.decimals()]);
      if (String(token).toLowerCase() !== d.lpAddr.toLowerCase() || Number(decimals) !== d.decimals) throw new Error("Farm token changed. Select the farm again.");
      await lp.approve.staticCall(d.farm.addr, amt);
      setFarmStatus(d.idx, "", "");
      const tx = await lp.approve(d.farm.addr, amt);
      setFarmStatus(d.idx, "", "");
      await confirmTransaction(tx);
      patchFarm(d.idx, { allowanceRaw: amt });
      await refreshFarm(d);
      setFarmStatus(d.idx, "✓ Approved", "ok");
      clearFarmStatusSoon(d.idx);
    } catch (err) {
      setFarmStatus(d.idx, "✗ " + friendlyTxError(err), "err");
      clearFarmStatusSoon(d.idx);
    } finally {
      endAction(d.idx);
    }
  }

  async function stakeFarm(d: FarmData) {
    if (!wallet.address || busy[d.idx]) return;
    const amount = inputAmountWei(d.idx);
    if (!amount) {
      setFarmStatus(d.idx, "✗ Enter an amount first", "err");
      clearFarmStatusSoon(d.idx, 3000);
      return;
    }
    if (typeof d.walletBalRaw === "bigint" && amount > d.walletBalRaw) {
      setFarmStatus(d.idx, "✗ Amount exceeds wallet balance", "err");
      clearFarmStatusSoon(d.idx);
      return;
    }
    if (typeof d.allowanceRaw === "bigint" && d.allowanceRaw < amount) {
      setFarmStatus(d.idx, "✗ Approve this LP amount before staking", "err");
      clearFarmStatusSoon(d.idx, 5000);
      return;
    }
    if (!beginAction(d.idx)) return;
    try {
      const signer = await wallet.getSigner();
      if (!d.lpAddr) throw new Error("Farm token is unavailable.");
      const c = new Contract(d.farm.addr, DEGEN_VAULT_ABI, signer);
      const lp = new Contract(d.lpAddr, [...ERC20_ABI, ...TOKEN_DEC_ABI], signer);
      const account = await signer.getAddress();
      const [currentToken, decimals, currentBalance, allowance, fee] = await Promise.all([
        c.stakeToken(), lp.decimals(), lp.balanceOf(account), lp.allowance(account, d.farm.addr), c.depositFee(),
      ]);
      if (String(currentToken).toLowerCase() !== d.lpAddr.toLowerCase() || Number(decimals) !== d.decimals) throw new Error("Farm token changed. Select the farm again.");
      if (amount > currentBalance) throw new Error("Amount exceeds your current LP balance.");
      if (amount > allowance) throw new Error("Approve this LP amount before staking.");
      if (d.depositFeeBps === null || BigInt(fee) !== d.depositFeeBps) {
        patchFarm(d.idx, { depositFeeBps: BigInt(fee) });
        throw new Error("Deposit fee changed. Check the updated farm terms.");
      }
      await c.deposit.staticCall(amount, ZeroAddress);
      setFarmStatus(d.idx, "", "");
      const tx = await c.deposit(amount, ZeroAddress);
      setFarmStatus(d.idx, "", "");
      await confirmTransaction(tx);
      await refreshFarm(d);
      setInputs((prev) => ({ ...prev, [d.idx]: "" }));
      setOpenStakes((prev) => ({ ...prev, [d.idx]: true }));
      setFarmStatus(d.idx, "✓ New stake created!", "ok");
      clearFarmStatusSoon(d.idx);
    } catch (err) {
      setFarmStatus(d.idx, "✗ " + friendlyTxError(err), "err");
      clearFarmStatusSoon(d.idx);
    } finally {
      endAction(d.idx);
    }
  }

  async function withdrawStake(d: FarmData, stake: FarmStake) {
    if (!wallet.address || busy[d.idx]) return;
    if (!beginAction(d.idx)) return;
    try {
      const signer = await wallet.getSigner();
      const cW = new Contract(d.farm.addr, DEGEN_VAULT_ABI, signer);
      setFarmStatus(d.idx, "", "");
      const tx = await withdrawSelectedStake({
        getNrOfStakes: (user) => cW.getNrOfStakes(user),
        userInfo: (user, id) => cW.userInfo(user, id),
        withdraw: async (id) => { await cW.withdraw.staticCall(id); return cW.withdraw(id); },
      }, wallet.address, stake);
      setFarmStatus(d.idx, "", "");
      await confirmTransaction(tx);
      patchFarm(d.idx, { stakes: [], stakeCountKnown: false });
      await refreshFarm(d);
      setFarmStatus(
        d.idx,
        `✓ Stake #${stake.id} withdrawn — rewards added to your claimable balance`,
        "ok",
      );
      clearFarmStatusSoon(d.idx, 8000);
    } catch (err) {
      if (err instanceof StakeChangedError) await refreshFarm(d);
      setFarmStatus(d.idx, "✗ " + friendlyTxError(err), "err");
      clearFarmStatusSoon(d.idx);
    } finally {
      endAction(d.idx);
    }
  }

  async function harvestFarm(d: FarmData | null) {
    if (!wallet.address || !activeRef.current || (d && busy[d.idx])) return;
    const idx = d?.idx ?? -1;
    if (claimSubmissionLock.current || !beginAction(idx)) return;
    claimSubmissionLock.current = true;
    const session = claimGeneration.current;
    const current = () => activeRef.current && session === claimGeneration.current;
    const assertCurrent = () => { if (!current()) throw new Error("Cancelled"); };
    let confirmed = false;
    try {
      const account = wallet.address;
      const provider = await getPublicProvider();
      const publicHelper = new Contract(DEGEN_REWARDS_HELPER, DEGEN_REWARDS_HELPER_ABI, provider);
      const initial = await readFreshClaim(d);
      assertCurrent();
      if (!d) setAllClaimRaw(initial.totalRaw);
      if (initial.totalRaw <= 0n) throw new Error("No rewards are currently available to claim.");
      const chosen = await pickHarvestDest(initial.totalRaw, publicHelper, d?.farm.name ?? null);
      assertCurrent();
      const fresh = await readFreshClaim(d);
      assertCurrent();
      if (!d) setAllClaimRaw(fresh.totalRaw);
      const currentTerms = await readClaimDestinations(publicHelper);
      const terms = currentTerms.find(destination => (destination.addr || account).toLowerCase() === chosen.into.toLowerCase());
      if (!terms || terms.payoutBps !== chosen.payoutBps || terms.minimum !== chosen.minimum || terms.minimumServe !== chosen.minimumServe) throw new Error("Claim terms changed. Choose the destination again.");
      // Max means the complete currently harvestable total, including helper credit once.
      const amount = chosen.amount === initial.totalRaw ? fresh.totalRaw : chosen.amount;
      if (amount <= 0n) throw new Error("No rewards are currently available to claim.");
      if (amount > fresh.totalRaw) throw new Error("Available rewards changed. Choose the claim amount again.");
      const payout = amount * terms.payoutBps / 10000n;
      if (payout <= 0n || payout < terms.minimum) throw new Error("Claim amount is below the destination minimum.");
      assertCurrent();
      const signer = await wallet.getSigner();
      const helper = new Contract(DEGEN_REWARDS_HELPER, DEGEN_REWARDS_HELPER_ABI, signer);
      const addresses = fresh.snapshot.farms.map(farm => farm.address);
      const stakeIDs = fresh.snapshot.farms.map(farm => farm.stakeIds);
      let tx;
      if (addresses.length) {
        await helper.claimWithHarvest.staticCall(addresses, account, stakeIDs, amount, chosen.into);
        assertCurrent();
        tx = await helper.claimWithHarvest(addresses, account, stakeIDs, amount, chosen.into);
      } else {
        await helper.claimRewards.staticCall(amount, chosen.into);
        assertCurrent();
        tx = await helper.claimRewards(amount, chosen.into);
      }
      await confirmTransaction(tx);
      confirmed = true;
      // A failed display refresh must not turn a confirmed claim into a reported failure.
      if (d) await refreshFarm(d).catch(() => undefined);
      await fetchHelperCredit().catch(() => undefined);
      try { const after = await readFreshClaim(null); if (current()) setAllClaimRaw(after.totalRaw); } catch { /* Background polling retries. */ }
      if (current()) { setFarmStatus(idx, "Claim confirmed.", "ok"); clearFarmStatusSoon(idx); }
    } catch (error) {
      if (current()) { setFarmStatus(idx, (error as Error).message === "Cancelled" ? "" : confirmed ? "Claim confirmed. Balances will update shortly." : friendlyTxError(error), confirmed ? "ok" : "err"); clearFarmStatusSoon(idx); }
    } finally { claimSubmissionLock.current = false; endAction(idx); }
  }

  async function toggleBreakdown(d: FarmData) {
    const current = breakdowns[d.idx];
    if (current) {
      setBreakdowns((prev) => ({ ...prev, [d.idx]: undefined }));
      return;
    }
    setBreakdowns((prev) => ({ ...prev, [d.idx]: { state: "loading" } }));
    const info = d.lpAddr ? await getLpBreakdownInfo(d.lpAddr, 18) : null;
    if (!info || !(info.totalSupply > 0)) {
      setBreakdowns((prev) => ({ ...prev, [d.idx]: { state: "unavailable" } }));
      return;
    }
    const share = (d.totalStaked || 0) / info.totalSupply;
    const [p0, p1] = await Promise.all([
      fetchTokenUsd(info.token0),
      fetchTokenUsd(info.token1),
    ]);
    setBreakdowns((prev) => ({
      ...prev,
      [d.idx]: {
        state: "ready",
        cells: [
          { sym: info.sym0, amt: share * info.reserve0, price: p0, logo: breakdownTokenLogo(info.sym0, d.farm.tokens) },
          { sym: info.sym1, amt: share * info.reserve1, price: p1, logo: breakdownTokenLogo(info.sym1, d.farm.tokens) },
        ],
      },
    }));
  }

  async function manageLiquidity(d: FarmData) {
    const w = window.open("about:blank", "_blank");
    let url = pulsexAddUrlForFarm(d?.farm);
    try {
      if (d?.lpAddr) {
        if ((d.farm?.tokens?.length || 0) === 2) {
          const info = await getLpPairInfo(d.lpAddr, d.decimals);
          if (info?.token0 && info?.token1)
            url = `${pulsexAddUrlForFarm(d.farm)}/${info.token0}/${info.token1}`;
        } else {
          url = `${PULSEX_SWAP_URL}?outputCurrency=${d.lpAddr}`;
        }
      }
    } catch {
      /* fall back to the base add-liquidity URL */
    }
    if (w) w.location = url;
    else window.open(url, "_blank", "noopener");
  }

  function goToFarm(idx: number) {
    const d = farms[idx];
    if (stakedOnly && !isActiveDegenFarm(d)) setStakedOnly(false);
    if (view !== "grid") setView("grid");
    setTimeout(() => {
      const card = document.getElementById(`farm-card-degen-${idx}`);
      if (!card) return;
      card.scrollIntoView({ behavior: "smooth", block: "center" });
      card.classList.remove("farm-focus");
      void (card as HTMLElement).offsetWidth;
      card.classList.add("farm-focus");
      setTimeout(() => card.classList.remove("farm-focus"), 1700);
    }, 50);
  }

  // ── Live values ─────────────────────────────────────────────────────────────
  const livePending = (d: FarmData) => d.pendingDegen;
  const liveAnnual = (d: FarmData) => d.annualRewardTokens ?? 0;

  // ── Render ─────────────────────────────────────────────────────────────────
  const loadedFarms = farms.filter((d): d is FarmData => !!d);
  const summaryReady = loadedFarms.length === DEGEN_FARMS.length;
  const bannerTotal = allClaimRaw === null ? 0 : Number(formatUnits(allClaimRaw, 18));
  const liveBannerTotal = bannerTotal;
  const totalUserStakedUsd = loadedFarms.reduce(
    (sum, d) => sum + (Number.isFinite(d.stakedUsd) ? Number(d.stakedUsd) : 0),
    0,
  );
  const stakeCountLabel = summaryReady
    ? farmStakeCountLabel(loadedFarms.map((d) => d.stakeCountKnown ? d.stakeCount : null))
    : "Loading stake counts…";
  const rewardPriceUsd =
    loadedFarms.find((d) => (d.rewardPriceUsd || 0) > 0)?.rewardPriceUsd || null;
  const totalClaimableUsd = allClaimRaw !== null && rewardPriceUsd ? liveBannerTotal * rewardPriceUsd : null;
  const formatFarmSummaryUsd = (value: number | null) => value === null ? "—" : `$${fmtFullReward(value)} USD`;
  const claimableRewardValue = allClaimRaw === null ? "—" : `${formatClaimableAmount(allClaimRaw)} DEGEN`;

  const claimableRewardUsd =
    liveBannerTotal > 1e-8 && totalClaimableUsd !== null
      ? formatFarmSummaryUsd(totalClaimableUsd)
      : null;

  const visible = stakedOnly ? loadedFarms.filter(isActiveDegenFarm) : loadedFarms;
  const sortedVisible = visible.slice().sort((a, b) => a.idx - b.idx);

  const totalTvl = loadedFarms.reduce((sum, d) => {
    const tvl = Number(d?.tvlUsd || 0);
    return Number.isFinite(tvl) && tvl > 0 ? sum + tvl : sum;
  }, 0);
  const totalTvlText =
    summaryReady && loadedFarms.every(d => d.tvlUsd !== null)
      ? `$${totalTvl.toLocaleString(undefined, {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        })}`
      : "—";

  useEffect(() => {
    if (totalTvl <= 0 || loadedFarms.length < DEGEN_FARMS.length) {
      setTvlChange24h(null);
      return;
    }
    setTvlChange24h(getTvlChange24h(totalTvl));
  }, [loadedFarms.length, totalTvl]);

  const highlightCol = (title: string, metric: "apr" | "tvl" | "rewards") => {
    const top = loadedFarms
      .filter((d) => farmHighlightValue(d, metric) !== null)
      .slice()
      .sort((a, b) => Number(farmHighlightValue(b, metric)) - Number(farmHighlightValue(a, metric)))
      .slice(0, 3);
    return (
      <div className="farm-highlight-col">
        <h3 className="farm-highlight-title">{title}</h3>
        <div className="farm-highlight-list">
          {top.length ? (
            top.map((d, i) => (
              <div
                key={d.idx}
                className="farm-highlight-row"
                role="button"
                tabIndex={0}
                onClick={() => goToFarm(d.idx)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    goToFarm(d.idx);
                  }
                }}
              >
                <div className="farm-highlight-rank">{i + 1}</div>
                <div className="farm-highlight-farm">
                  <FarmTokenPair tokens={d.farm.tokens} />
                  <div className="farm-highlight-name">{d.farm.name}</div>
                </div>
                <div className="farm-highlight-value">
                  {farmHighlightDisplay(farmHighlightValue(d, metric), metric)}
                </div>
              </div>
            ))
          ) : (
            <div className="rw-miners-loading">—</div>
          )}
        </div>
      </div>
    );
  };

  async function reloadStakes(d: FarmData) {
    if (!beginAction(d.idx)) return;
    try { await refreshFarm(d); }
    finally { endAction(d.idx); }
  }

  const renderStakes = (d: FarmData) => (
    <FarmStakes
      stakes={d.stakes ?? []}
      count={d.stakeCountKnown ? d.stakeCount : null}
      decimals={d.decimals}
      open={!!openStakes[d.idx]}
      busy={!!busy[d.idx]}
      onToggle={() => setOpenStakes((prev) => ({ ...prev, [d.idx]: !prev[d.idx] }))}
      onWithdraw={(stake) => void withdrawStake(d, stake)}
      onRefresh={() => void reloadStakes(d)}
    />
  );

  const renderCard = (d: FarmData) => {
    const pendingLive = livePending(d);
    const pendingStr = d.pendingKnown ? fmtFullReward(pendingLive) : "—";
    const stakedStr = fmtLpAmount(d.totalStaked || 0);
    const isActive = isActiveDegenFarm(d);
    const stakedLabel = !farmStakeAmountsKnown(d) ? "—" : stakedStr;
    const tvlStr =
      (d.tvlUsd || 0) > 0
        ? "$" + fmtFullReward(d.tvlUsd!) + " USD"
        : (d.tvlRewardToken || 0) > 0
          ? fmtFullReward(d.tvlRewardToken!) + " DEGEN"
          : "—";
    const poolId = Number(d.officialStats?.poolId);
    const actionsEnabled = !!(d.lpAddr && wallet.address);
    const canBreakdown = !!(d.lpAddr && d.farm.tokens.length === 2);
    const liqLabel =
      d.farm.tokens.length === 2 ? "Manage Liquidity" : `Get ${d.farm.tokens[0]}`;
    const liqHref =
      d.farm.tokens.length === 2
        ? d.pairToken0 && d.pairToken1
          ? `${pulsexAddUrlForFarm(d.farm)}/${d.pairToken0}/${d.pairToken1}`
          : null
        : d.lpAddr
          ? `${PULSEX_SWAP_URL}?outputCurrency=${d.lpAddr}`
          : null;
    const allocStr =
      d.allocPct !== null && d.allocPct !== undefined && Number.isFinite(Number(d.allocPct))
        ? Number(d.allocPct).toFixed(1) + "%"
        : "—";
    const fmtUsd = (v: number | null) =>
      v !== null && (v > 0 || v === 0) && Number.isFinite(v)
        ? "$" + fmtFullReward(v) + " USD"
        : null;
    const walletStr =
      d.walletBal !== null && d.walletBal !== undefined ? fmtLpAmount(d.walletBal) : "—";
    const walletSub = fmtUsd(d.walletUsd) || "LP in wallet";
    const annualLive = liveAnnual(d);
    const annualStr = d.annualRewardTokens !== null ? fmtFullReward(annualLive) : "—";
    const annualSub = fmtUsd(d.annualRewardsUsd) || "DEGEN / year";
    const pctStr = d.stakedPct !== null
      ? (d.stakedPct >= 10 ? d.stakedPct.toFixed(1) : d.stakedPct.toFixed(2)) + "%" : "—";
    const stakedSub = !farmStakeAmountsKnown(d) ? "Unavailable"
      : d.totalStakedRaw === 0n ? "$0.00 USD (0%)" : d.stakedUsd !== null ? `${fmtUsd(d.stakedUsd)} (${pctStr})` : "USD value unavailable";
    const pendingSub = fmtUsd(d.pendingUsd) || (d.pendingKnown && d.pendingDegen === 0 ? "$0.00 USD" : "—");
    const status = statuses[d.idx];
    const breakdown = breakdowns[d.idx];
    const isBusy = !!busy[d.idx];
    const amtWei = inputAmountWei(d.idx);
    const approveLabel = amtWei
      ? "Approve " + fmtFullReward(Number(formatUnits(amtWei, d.decimals)))
      : "Approve LP amount";

    return (
      <div
        key={d.idx}
        className="browse-farm-card degen-farm-card"
        id={`farm-card-degen-${d.idx}`}
        style={{ "--bfc-color": "var(--accent)" } as CSSProperties}
      >
        <div className="bfc-head">
          <FarmTokenPair tokens={d.farm.tokens} />
          <div className="bfc-title-wrap">
            <div className="bfc-name-row"><div className="bfc-name">{d.farm.name}</div><CopyAddress compact address={d.farm.addr} label={`${d.farm.name} contract address`} /></div>
            <div className="bfc-sub">{farmProtocolLabel(d.farm)}</div>
          </div>
          {liqHref ? (
            <a className="bfc-liquidity-btn" href={liqHref} target="_blank" rel="noopener noreferrer">
              {liqLabel}
            </a>
          ) : (
            <button className="bfc-liquidity-btn" type="button" onClick={() => void manageLiquidity(d)}>
              {liqLabel}
            </button>
          )}
        </div>
        <div className="bfc-stats-grid bfc-stats-top">
          <div className="bfc-stat-cell bfc-compact">
            <span className="bfc-stat-label">APR</span>
            <div className="bfc-stat-reward-line">
              <span className="bfc-stat-val bfc-apr">{farmAprText(d.apr)}</span>
              <AprBreakdownPop apr={d.apr} />
            </div>
          </div>
        </div>
        <div className="bfc-stats-grid">
          <div className="bfc-stat-cell">
            <span className="bfc-stat-label">Balance</span>
            <div className="bfc-stat-balance-row">
              <span className="bfc-stat-val">
                {walletStr}
                <span className="bfc-stat-tok">LP</span>
              </span>
              <button
                className="bfc-stat-max"
                disabled={!(actionsEnabled && (d.walletBal || 0) > 0)}
                onClick={() => {
                  setInputs((prev) => ({
                    ...prev,
                    [d.idx]:
                      d.walletBalRaw !== null && d.walletBalRaw !== undefined
                        ? formatUnits(d.walletBalRaw, d.decimals)
                        : String(d.walletBal || 0),
                  }));
                }}
              >
                [MAX]
              </button>
            </div>
            <span className="bfc-stat-sub">{walletSub}</span>
          </div>
          <div className="bfc-stat-cell">
            <span className="bfc-stat-label">Pool Annual Rewards</span>
            <span className="bfc-stat-val">{annualStr}</span>
            <div className="bfc-stat-sub">
              <img
                className="bfc-reward-logo"
                src={TOKEN_LOGOS["DEGEN"]}
                onError={(event) => {
                  event.currentTarget.style.display = "none";
                }}
              />{" "}
              {annualSub}
            </div>
          </div>
          <div className="bfc-stat-cell">
            <span className="bfc-stat-label">
              Staked
              {canBreakdown && (
                <>
                  {" "}
                  <button className="bfc-stat-max" onClick={() => void toggleBreakdown(d)}>
                    {breakdown ? "[-]" : "[+]"}
                  </button>
                </>
              )}
            </span>
            <div className="bfc-stat-balance-row">
              <span className="bfc-stat-val">
                {stakedLabel}
                <span className="bfc-stat-tok">{farmStakeAmountsKnown(d) ? "LP" : ""}</span>
              </span>
              <button
                className="bfc-stat-max"
                disabled={!d.stakeCountKnown || d.stakeCount === 0}
                onClick={() => setOpenStakes((prev) => ({ ...prev, [d.idx]: true }))}
              >
                [VIEW]
              </button>
            </div>
            <span className="bfc-stat-sub">{stakedSub}</span>
          </div>
          <div className="bfc-stat-cell bfc-rewards-cell">
            <span className="bfc-stat-label">Rewards</span>
            <div className="bfc-stat-reward-line">
              <img
                className="bfc-reward-logo"
                src={TOKEN_LOGOS["DEGEN"]}
                onError={(event) => {
                  event.currentTarget.style.display = "none";
                }}
              />
              <span className="bfc-stat-val bfc-stat-accent">
                <span className="bfc-reward-amount">{pendingStr}</span>
                <span className="bfc-reward-symbol">DEGEN</span>
              </span>
              {farmStakeAmountsKnown(d) && <RewardsProjectionPop d={d} />}
            </div>
            <span className="bfc-stat-sub">{pendingSub}</span>
          </div>
        </div>
        {canBreakdown && breakdown && (
          <div className="bfc-breakdown" style={{ display: "grid" }}>
            {breakdown.state === "loading" ? (
              <span className="bfc-stat-sub">Loading breakdown…</span>
            ) : breakdown.state === "unavailable" ? (
              <span className="bfc-stat-sub">Breakdown unavailable</span>
            ) : (
              breakdown.cells.map((cell) => (
                <div className="bfc-stat-cell" key={cell.sym}>
                  <span className="bfc-stat-label">
                    {cell.logo && (
                      <img
                        className="bfc-reward-logo"
                        src={cell.logo}
                        onError={(event) => {
                          event.currentTarget.style.display = "none";
                        }}
                      />
                    )}{" "}
                    {cell.sym}
                  </span>
                  <span className="bfc-stat-val">{fmtFullReward(cell.amt)}</span>
                  {(cell.price || 0) > 0 && (
                    <span className="bfc-stat-sub">
                      ${fmtFullReward(cell.amt * cell.price!)} USD
                    </span>
                  )}
                </div>
              ))
            )}
          </div>
        )}
        {(d.pendingDegen || 0) > 1e-8 ? (
          <button className="bfc-harvest-btn" aria-label={`Claim ${pendingStr} DEGEN from ${d.farm.name}`} disabled={isBusy} onClick={() => void harvestFarm(d)}>
            Claim
          </button>
        ) : (
          <button className="bfc-harvest-btn" disabled>
            Claim
          </button>
        )}
        <div className="bfc-input-row">
          <input
            className="bfc-input"
            type="number"
            min="0"
            step="any"
            placeholder="Deposit amount · LP"
            aria-label={`New stake LP amount for ${d.farm.name}`}
            disabled={!actionsEnabled || isBusy}
            value={inputs[d.idx] || ""}
            onChange={(event) =>
              setInputs((prev) => ({ ...prev, [d.idx]: event.target.value }))
            }
          />
          <button
            className="bfc-max"
            disabled={!actionsEnabled || isBusy || d.walletBalRaw === null}
            onClick={() =>
              setInputs((prev) => ({
                ...prev,
                [d.idx]:
                  d.walletBalRaw !== null && d.walletBalRaw !== undefined
                    ? formatUnits(d.walletBalRaw, d.decimals)
                    : String(d.walletBal || 0),
              }))
            }
          >
            MAX
          </button>
        </div>
        <div className="bfc-action-grid">
          <button
            className="bfc-stake-btn"
            aria-label="Create New Stake"
            disabled={!actionsEnabled || isBusy}
            onClick={() => void stakeFarm(d)}
          >
            Stake
          </button>
          <button
            className="bfc-unstake-btn"
            aria-label="Unstake from a selected stake"
            aria-expanded={!!openStakes[d.idx]}
            disabled={isBusy}
            onClick={() => setOpenStakes((prev) => ({ ...prev, [d.idx]: !prev[d.idx] }))}
          >
            Unstake
          </button>
        </div>
        <button
          className="bfc-approve-btn"
          disabled={!actionsEnabled || isBusy}
          onClick={() => void approveFarm(d)}
        >
          {approveLabel}
        </button>
        {renderStakes(d)}
        <div className={`bfc-status${status?.cls ? " " + status.cls : ""}`}>
          {status?.msg || ""}
        </div>
        <div className="bfc-bottom-line">
          <span>Allocation: <b>{allocStr}</b></span>
          <span>
            Emissions:{" "}
            <b>{farmTimeLeftNode(d.annualRewardTokens, d.officialStats?.rewardAllocation)}</b>
          </span>
          <span>
            TVL: <b>{tvlStr}</b>
            {Number.isFinite(poolId) && <span className="bfc-pool-rank">#{poolId}</span>}
          </span>
        </div>
      </div>
    );
  };

  const renderTableRow = (d: FarmData) => {
    const stakedLabel = !farmStakeAmountsKnown(d) ? "—" : fmtLpAmount(d.totalStaked);
    const pendingStr = d.pendingKnown ? fmtFullReward(livePending(d)) : "—";
    const walletStr =
      d.walletBal !== null && d.walletBal !== undefined ? fmtLpAmount(d.walletBal) : "—";
    return (
      <Fragment key={d.idx}>
      <tr>
        <td>
          <div className="farm-table-farm">
            <FarmTokenPair tokens={d.farm.tokens} />
            <div>
              <div className="farm-table-name">{d.farm.name}</div>
              <div className="farm-table-sub">APR {farmAprText(d.apr)}</div>
            </div>
          </div>
        </td>
        <td>
          <div className="farm-table-val">{walletStr}</div>
          <div className="farm-table-small">Available</div>
        </td>
        <td>
          <div className="farm-table-val">{stakedLabel}</div>
          <div className="farm-table-small">LP tokens</div>
        </td>
        <td>
          <div className="farm-table-val farm-table-reward">
            <img
              src={TOKEN_LOGOS["DEGEN"]}
              onError={(event) => {
                event.currentTarget.style.display = "none";
              }}
            />
            {pendingStr}
          </div>
          <div className="farm-table-small">DEGEN</div>
        </td>
        <td>
          <button
            className="farm-table-manage-btn"
            type="button"
            onClick={() => {
              setView("grid");
              setOpenStakes((prev) => ({ ...prev, [d.idx]: true }));
              goToFarm(d.idx);
            }}
          >
            Manage
          </button>
        </td>
      </tr>
      <tr className="farm-table-stakes-row">
        <td colSpan={5}>
          {renderStakes(d)}
          {openStakes[d.idx] && statuses[d.idx]?.msg && (
            <div className={`bfc-status ${statuses[d.idx].cls}`}>{statuses[d.idx].msg}</div>
          )}
        </td>
      </tr>
      </Fragment>
    );
  };

  const hdModal = harvestModal && (
    <div id="harvestDestModal" className="farm-action-panel">
      <div className="modal-box" role="dialog" aria-label="Harvest Rewards" style={{ maxWidth: 440 }}>
        <div className="modal-title">{harvestModal.farmName ? "Claim Farm Rewards" : "Claim All Rewards"}</div>
        <div className="hd-available">
          Available for this claim: {formatClaimableAmount(harvestModal.amountRaw)} DEGEN
        </div>
        <p className="farm-deposit-estimate">{harvestModal.farmName ? `Includes rewards from ${harvestModal.farmName} and your already-collected rewards.` : "Collects rewards from all your farms in one claim."} Payouts below show destination penalties.</p>
        <div className="hd-amount-section">
          <div className="hd-amount-label">DEGEN To Claim:</div>
          <input
            type="text"
            className="modal-input hd-amount-input"
            aria-label="DEGEN to claim"
            inputMode="decimal"
            value={harvestModal.input}
            onChange={(event) => {
              const input = event.target.value;
              setHarvestModal((prev) => {
                if (!prev) return prev;
                const v = parseFloat(String(input).replace(/[, ]/g, ""));
                const amt = !Number.isFinite(v) || v < 0 ? 0 : Math.min(v, prev.amount);
                return {
                  ...prev,
                  input,
                  slider:
                    prev.amount > 0
                      ? Math.max(0, Math.min(100, Math.round((amt / prev.amount) * 100)))
                      : 0,
                };
              });
            }}
          />
          <input
            type="range"
            className="hd-slider"
            aria-label="Percent of available rewards"
            min="0"
            max="100"
            value={harvestModal.slider}
            onChange={(event) => {
              const slider = Number(event.target.value);
              setHarvestModal((prev) => {
                if (!prev) return prev;

                return {
                  ...prev,
                  slider,
                  input: formatUnits(prev.amountRaw * BigInt(slider) / 100n, 18),
                };
              });
            }}
          />
        </div>
        <div className="hd-dest-label">Harvest rewards into...</div>
        <div id="hd-options">
          {harvestModal.destinations.map((dest, i) => (
            <label
              key={dest.label}
              className={`hd-opt${harvestModal.selected === i ? " selected" : ""}`}
            >
              <input
                type="radio"
                name="harvestDest"
                checked={harvestModal.selected === i}
                onChange={() =>
                  setHarvestModal((prev) => (prev ? { ...prev, selected: i } : prev))
                }
              />
              <span className="hd-opt-name">{dest.label}{dest.minimumServe > 0n && <small>Minimum service: {(Number(dest.minimumServe) / 86400).toLocaleString(undefined, { maximumFractionDigits: 2 })} days</small>}</span>
              <span className={`hd-opt-pct${dest.payoutBps === 10000n ? " hd-good" : " hd-bad"}`}>
                {hdPctText(dest, hdCurrentAmount(harvestModal))}
              </span>
            </label>
          ))}
        </div>
        <div className="modal-btn-row" style={{ marginTop: 16 }}>
          <button
            className="modal-btn-cancel"
            onClick={() => {
              harvestModal.reject(new Error("Cancelled"));
              setHarvestModal(null);
            }}
          >
            Cancel
          </button>
          <button
            className="modal-btn-confirm"
            disabled={hdCurrentAmount(harvestModal) <= 0n || hdCurrentAmount(harvestModal) * harvestModal.destinations[harvestModal.selected].payoutBps / 10000n < harvestModal.destinations[harvestModal.selected].minimum || harvestModal.destinations[harvestModal.selected].payoutBps === 0n}
            onClick={() => {
              const dest = harvestModal.destinations[harvestModal.selected];
              const amt = hdCurrentAmount(harvestModal);
              harvestModal.resolve({
                into: dest.addr || wallet.address || "",
                amount: amt, payoutBps: dest.payoutBps, minimum: dest.minimum, minimumServe: dest.minimumServe,
              });
              setHarvestModal(null);
            }}
          >
            Confirm Claim
          </button>
        </div>
      </div>
    </div>
  );

  return (
    <main className="legacy-main">
      <div className="rw-miners-section">
        {!wallet.address ? (
          <div className="rw-miners-loading">Connect your wallet to browse farms</div>
        ) : (
          <>
            <div>
              <div className="farm-total-tvl">
                Total Value Locked:
                <span className="farm-summary-value">{totalTvlText}</span>
                <span
                  className={`farm-tvl-change ${
                    tvlChange24h === null
                      ? ""
                      : tvlChange24h > 0
                        ? "pct-up"
                        : tvlChange24h < 0
                          ? "pct-dn"
                          : "pct-neu"
                  }`}
                  hidden={tvlChange24h === null}
                >
                  {tvlChange24h === null
                    ? ""
                    : `${tvlChange24h >= 0 ? "+" : ""}${tvlChange24h.toFixed(2)}% (24h)`}
                </span>
              </div>
              <div className="farm-highlights">
                {highlightCol("Highest APR", "apr")}
                {highlightCol("Highest TVL", "tvl")}
                {highlightCol("Highest Rewards", "rewards")}
              </div>
            </div>
            <div className="farms-shell">
              <div className="farms-topbar">
                <a
                  className="farms-brand"
                  href="https://degenstrategy.github.io/interface/index.html"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <div className="farms-brand-logo">
                    <img src={TOKEN_LOGOS["DEGEN"]} alt="DEGEN" />
                  </div>
                  <span className="farms-title">DEGEN Farms</span>
                  <span className="farms-count">{DEGEN_FARMS.length} farms</span>
                </a>
                <button
                  className={`farms-filter${stakedOnly ? " active" : ""}`}
                  type="button"
                  onClick={() => setStakedOnly((s) => !s)}
                >
                  <span className="farms-filter-dot" />
                  Staked
                </button>
                <div className="farm-view-toggle" aria-label="Farm view">
                  <button
                    className={`farm-view-btn ${view === "grid" ? "active" : ""}`}
                    type="button"
                    onClick={() => setView("grid")}
                    aria-label="Grid view"
                  >
                    ▦
                  </button>
                  <button
                    className={`farm-view-btn ${view === "table" ? "active" : ""}`}
                    type="button"
                    onClick={() => setView("table")}
                    aria-label="Table view"
                  >
                    ☰
                  </button>
                </div>
              </div>
              <div className="farm-claimable-summary">
                <div className="farm-claimable-main">
                  <span>Total Staked:</span>
                  <span className="farm-summary-value">
                    {summaryReady && loadedFarms.every(d => farmStakeAmountsKnown(d) && (d.totalStakedRaw === 0n || d.stakedUsd !== null)) ? formatFarmSummaryUsd(totalUserStakedUsd) : "—"}
                  </span>
                </div>
                <div className="farm-claimable-main">
                  <span>Total Claimable Rewards:</span>
                  <span className="farm-summary-value">
                    {claimableRewardValue}
                    {claimableRewardUsd && (
                      <span className="farm-summary-subvalue">{claimableRewardUsd}</span>
                    )}
                  </span>
                </div>
                <div className="farm-claim-all-wrap">
                  <span className="farm-positions-label">{stakeCountLabel}</span>
                  <button className="bfc-harvest-btn farm-claim-all-btn" disabled={Object.values(busy).some(Boolean)} onClick={() => void harvestFarm(null)}>Claim All Rewards</button>
                  {statuses[-1]?.msg && <span role="status" className={`bfc-status ${statuses[-1].cls}`}>{statuses[-1].msg}</span>}
                </div>
              </div>
              {sortedVisible.length === 0 ? (
                <div className={view === "table" ? "browse-farms-table-wrap" : "browse-farms-grid"}>
                  <div className="rw-miners-loading">
                    {loading ? "Loading DEGEN farms…" : "No active DEGEN farms found. Toggle Staked off to browse all farms."}
                  </div>
                </div>
              ) : view === "table" ? (
                <div className="browse-farms-table-wrap">
                  <table className="farm-table">
                    <thead>
                      <tr>
                        <th style={{ width: "32%" }}>Farm</th>
                        <th style={{ width: "17%" }}>Wallet LP</th>
                        <th style={{ width: "17%" }}>Staked</th>
                        <th style={{ width: "18%" }}>Claimable</th>
                        <th style={{ width: "16%" }}>Action</th>
                      </tr>
                    </thead>
                    <tbody>{sortedVisible.map(renderTableRow)}</tbody>
                  </table>
                </div>
              ) : (
                <div className="browse-farms-grid">
                  {sortedVisible.map(renderCard)}
                </div>
              )}
            </div>
          </>
        )}
      </div>
      {hdModal}
    </main>
  );
}
