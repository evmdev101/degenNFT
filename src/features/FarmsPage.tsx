// Farms tab (Stake LP) — markup and styling restored verbatim from the
// original single-file site (commit 825e9f2). Logic mirrors
// loadBrowseDegenFarms / fetchDegenVaultData / renderDegenFarmCard /
// renderFarmHighlights / updateDegenRewardsBanner / pickHarvestDest and the
// approve / stake / unstake / harvest handlers from the original script.
import {
  Contract,
  MaxUint256,
  ZeroAddress,
  formatEther,
  formatUnits,
  parseUnits,
} from "ethers";
import type { CSSProperties, ReactNode } from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { CONTRACTS, ERC20_ABI } from "../config/contracts";
import type { WalletState } from "../hooks/useWallet";
import { getPublicProvider } from "../lib/chain";

// ── Constants from the original script ──────────────────────────────────────
const MASTERCHEF2 = "0xC84FbE083713544BB4Ea85E2fe95148D076b2942";
const BLOCKS_PER_DAY = 8000;
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

const _DS_IMG = (name: string) =>
  `https://raw.githubusercontent.com/degenstrategy/interface/main/img/${name}.png`;
const _PT_IMG = (addr: string) =>
  `https://raw.githubusercontent.com/piteasio/app-tokens/main/token-logo/${addr}.png`;

const TOKEN_LOGOS: Record<string, string> = {
  PLS: "pls.png",
  PLSX: _PT_IMG("0x95B303987A60C71504D99Aa1b13B4DA07b0790ab"),
  INC: _PT_IMG("0x2fa878Ab3F87CC1C9737Fc071108F904c0B0C95d"),
  HEX: _DS_IMG("hex"),
  "T-Shares": _DS_IMG("hex"),
  HOA: _PT_IMG("0x7901a3569679AEc3501dbeC59399F327854a70fe"),
  ATROPA: _PT_IMG("0xCc78A0acDF847A2C1714D2A925bB4477df5d48a6"),
  pDAI: _DS_IMG("dai"),
  pUSDT: _PT_IMG("0xdAC17F958D2ee523a2206206994597C13D831ec7"),
  pUSDC: _PT_IMG("0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48"),
  PDRIP: _PT_IMG("0xeB2CEed77147893Ba8B250c796c2d4EF02a72B68"),
  EMIT: _DS_IMG("emit"),
  COM: _PT_IMG("0x5A9780Bfe63f3ec57f01b087cD65BD656C9034A8"),
  HTT: _DS_IMG("htt"),
  PRINT: _DS_IMG("print"),
  sPRINT: _DS_IMG("print"),
  INCD: _DS_IMG("incd"),
  "9INCH": _DS_IMG("9inch"),
  vPLS: "vouchpls.png",
  HOC: _DS_IMG("hoc"),
  ISLAND:
    "https://cdn.dexscreener.com/cms/images/654e3bc18fb1a952a77693c1ee11a95c9fdfb989c0e1b63106127992675c8ae5?width=800&height=800&quality=95&format=auto",
  IMPLS:
    "https://coin-images.coingecko.com/coins/images/31493/small/impls_200x200.png?1696530304",
  OINK: _DS_IMG("oink"),
  DEGEN: _DS_IMG("degen"),
};

type FarmDef = { name: string; tokens: string[]; addr: string; dec: number };

// Sourced from https://raw.githubusercontent.com/DegenStrategy/DEGEN/refs/heads/main/vaultData.json
const DEGEN_FARMS: FarmDef[] = [
  { name: "HEX-HTT3000 V2 LP", tokens: ["HEX", "HTT"], addr: "0x7979bEe7F5Fe93F4b22d7A24C629803950610e56", dec: 18 },
  { name: "HEX-HTT5000 V2 LP", tokens: ["HEX", "HTT"], addr: "0xCAadb7032B8Fd0DD8386092b871d275c5c9684b0", dec: 18 },
  { name: "HEX-HTT7000 V2 LP", tokens: ["HEX", "HTT"], addr: "0xeea4a58838029d8Df7Cb0cE8a50045222551708A", dec: 18 },
  { name: "INC-PRINT V2 LP", tokens: ["INC", "PRINT"], addr: "0x5055a3F634349437f4E87d915Cf85Ca836FF1FFC", dec: 18 },
  { name: "DAI-INCD V2 LP", tokens: ["pDAI", "INCD"], addr: "0x988f2af54cE20D3d2F44177f953158B74341e1C9", dec: 18 },
  { name: "EMIT", tokens: ["EMIT"], addr: "0xB57aA188ab1B01B48e6d71F98264503C8B212B70", dec: 18 },
  { name: "EMIT-PLS V2 LP", tokens: ["EMIT", "PLS"], addr: "0x61CB65c28040c26B1Fc31eFa17B4566c69199cC2", dec: 18 },
  { name: "DAI-PLS V1 LP", tokens: ["pDAI", "PLS"], addr: "0x221e0B764Bb29d720C747a5885B0cE71d0a202Ac", dec: 18 },
  { name: "INC-PLSX V1 LP", tokens: ["INC", "PLSX"], addr: "0x30d1895243d7E5A6db345158879DBe6CBBE03FE6", dec: 18 },
  { name: "PLS-PLSX V1 LP", tokens: ["PLS", "PLSX"], addr: "0x7196998B37774b4652c389c359f30FC8d9EC7f53", dec: 18 },
  { name: "HEX-PLS V1 LP", tokens: ["HEX", "PLS"], addr: "0x437Cd9eaFaF8E062069f04C11994ed38ABd73D34", dec: 18 },
  { name: "DAI-9INCH V2 LP", tokens: ["pDAI", "9INCH"], addr: "0x6d6Ed53A3647B96d147850495e57F6E7F52cA0bf", dec: 18 },
  { name: "vPLS-PLS V2 LP", tokens: ["vPLS", "PLS"], addr: "0x3a37c64B56F0F7cF7F402688753B1692BB46BC32", dec: 18 },
  { name: "HOC-PLS V2 LP", tokens: ["HOC", "PLS"], addr: "0xc4dA722b1D7b13B46786f79F46F274fe16E096Ae", dec: 18 },
  { name: "PRINT-sPRINT V2 LP", tokens: ["PRINT", "sPRINT"], addr: "0x9Ba60bB19f21a01a0323F54BB001497f00B7A304", dec: 18 },
  { name: "OINK-PLS V2 LP", tokens: ["OINK", "PLS"], addr: "0x61B374Fd8Fa06767927bfb11B947d165C06a8c5E", dec: 18 },
  { name: "OINK-DEGEN V2 LP", tokens: ["OINK", "DEGEN"], addr: "0xBCb904a9422F223f5A79660f026310D4bd8C9941", dec: 18 },
  { name: "EMIT-PLSX V2 LP", tokens: ["EMIT", "PLSX"], addr: "0xc667a6EC483edB71f6329413FbcFE8042348956C", dec: 18 },
  { name: "ISLAND-PLS V2 LP", tokens: ["ISLAND", "PLS"], addr: "0xBCFd877b255fF3c2416e2fe5DA7EC8778cC5b57d", dec: 18 },
  { name: "IMPLS-INC V2 LP", tokens: ["IMPLS", "INC"], addr: "0xd100e649956aCAa3B6F90D58546219C373d28ce2", dec: 18 },
  { name: "PLSX-9INCH V2 LP", tokens: ["PLSX", "9INCH"], addr: "0x6a89ef54f612bcf35582bad159760223eec20690", dec: 18 },
  { name: "USDC-PLS V1 LP", tokens: ["pUSDC", "PLS"], addr: "0x52763911bDe0651D0709120d51afE3E33c5EccA5", dec: 18 },
  { name: "USDT-PLS V1 LP", tokens: ["pUSDT", "PLS"], addr: "0x43724568cAb0CCf712eF5dfA40E9Aec68fff5a95", dec: 18 },
  { name: "HEX-HTT4000 V2 LP", tokens: ["HEX", "HTT"], addr: "0xF3EAbb9297B8c7EacFf46190BE97D04bA5b707e2", dec: 18 },
  { name: "HEX-HTT6000 V2 LP", tokens: ["HEX", "HTT"], addr: "0x38906e4747e6669D26928F39Fd9f3ddd2f299d46", dec: 18 },
];

const DEGEN_DAILY_REWARD_FALLBACKS: Record<string, number> = {
  // Official DegenStrategy view reports this rate for the active OINK-DEGEN LP position.
  "0xbcb904a9422f223f5a79660f026310d4bd8c9941": 681625,
};

const DEGEN_OFFICIAL_STATS_SNAPSHOT = [
  { symbol: "HEX-HTT3000", poolId: 4, apr: 1290, valueOfTVAL: 296.96386316, valueOfAnnualInterest: 3830.36315453463, rewardAllocation: "4.0" },
  { symbol: "HEX-HTT5000", poolId: 5, apr: 1141, valueOfTVAL: 318.83470398, valueOfAnnualInterest: 3638.8398805157003, rewardAllocation: "3.8" },
  { symbol: "HEX-HTT7000", poolId: 6, apr: 978, valueOfTVAL: 381.82510978, valueOfAnnualInterest: 3734.6015199192, rewardAllocation: "3.9" },
  { symbol: "INC-PRINT", poolId: 7, apr: 0, valueOfTVAL: 122.17353563, valueOfAnnualInterest: 0, rewardAllocation: "0.0" },
  { symbol: "DAI-INCD", poolId: 8, apr: 0, valueOfTVAL: 2651.60008061, valueOfAnnualInterest: 0, rewardAllocation: "0.0" },
  { symbol: "EMIT", poolId: 9, apr: 41, valueOfTVAL: 281.96891920585824, valueOfAnnualInterest: 114.91055339029, rewardAllocation: "0.1" },
  { symbol: "EMIT-PLS", poolId: 10, apr: 105, valueOfTVAL: 91.14377832, valueOfAnnualInterest: 95.74456993395, rewardAllocation: "0.1" },
  { symbol: "DAI-PLS", poolId: 11, apr: 416, valueOfTVAL: 528.98158375, valueOfAnnualInterest: 2202.4494284023, rewardAllocation: "2.3" },
  { symbol: "INC-PLSX", poolId: 12, apr: 832, valueOfTVAL: 885.84160038, valueOfAnnualInterest: 7373.4584651163805, rewardAllocation: "7.7" },
  { symbol: "PLS-PLSX", poolId: 13, apr: 941, valueOfTVAL: 732.86217715, valueOfAnnualInterest: 6894.66733756843, rewardAllocation: "7.2" },
  { symbol: "HEX-PLS", poolId: 14, apr: 387, valueOfTVAL: 1734.31604696, valueOfAnnualInterest: 6703.144058761431, rewardAllocation: "7.0" },
  { symbol: "DAI-9INCH", poolId: 15, apr: 239, valueOfTVAL: 200.04480013, valueOfAnnualInterest: 478.79112754795, rewardAllocation: "0.5" },
  { symbol: "vPLS-PLS", poolId: 16, apr: 282, valueOfTVAL: 3224.9341998954224, valueOfAnnualInterest: 9097.13383065221, rewardAllocation: "9.5" },
  { symbol: "HOC-PLS", poolId: 17, apr: 751, valueOfTVAL: 229.54301276, valueOfAnnualInterest: 1723.65830085435, rewardAllocation: "1.8" },
  { symbol: "PRINT-sPRINT", poolId: 18, apr: 297, valueOfTVAL: 419.0590610623356, valueOfAnnualInterest: 1244.8671733064, rewardAllocation: "1.3" },
  { symbol: "OINK-PLS", poolId: 19, apr: 602, valueOfTVAL: 238.44302398, valueOfAnnualInterest: 1436.37338264385, rewardAllocation: "1.5" },
  { symbol: "OINK-DEGEN", poolId: 20, apr: 249, valueOfTVAL: 1541.016634115349, valueOfAnnualInterest: 3830.36315453463, rewardAllocation: "4.0" },
  { symbol: "EMIT-PLSX", poolId: 21, apr: 108, valueOfTVAL: 88.26517575, valueOfAnnualInterest: 95.74456993395, rewardAllocation: "0.1" },
  { symbol: "ISLAND-PLS", poolId: 22, apr: 573, valueOfTVAL: 41.815770901720455, valueOfAnnualInterest: 239.39556616801002, rewardAllocation: "0.2" },
  { symbol: "IMPLS-INC", poolId: 23, apr: 98, valueOfTVAL: 292.45627812823716, valueOfAnnualInterest: 287.26784874095, rewardAllocation: "0.3" },
  { symbol: "PLSX-9INCH", poolId: 25, apr: 413, valueOfTVAL: 150.71507968, valueOfAnnualInterest: 622.42505431246, rewardAllocation: "0.6" },
  { symbol: "USDC-PLS", poolId: 26, apr: 28, valueOfTVAL: 338.98723038, valueOfAnnualInterest: 95.74456993395, rewardAllocation: "0.1" },
  { symbol: "USDT-PLS", poolId: 27, apr: 27, valueOfTVAL: 357.11357069, valueOfAnnualInterest: 95.74456993395, rewardAllocation: "0.1" },
  { symbol: "HEX-HTT4000", poolId: 29, apr: 1034, valueOfTVAL: 185.23620147, valueOfAnnualInterest: 1915.18157966135, rewardAllocation: "2.0" },
  { symbol: "HEX-HTT6000", poolId: 30, apr: 989, valueOfTVAL: 174.21123182999997, valueOfAnnualInterest: 1723.65830085435, rewardAllocation: "1.8" },
];

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
];
const DEGEN_REWARDS_HELPER_ABI = [
  "function claimWithHarvest(address[] _contractAddresses, address _userAddress, uint256[][] _stakeIDs, uint256 _amount, address _into)",
  "function claimRewards(uint256 _amount, address _harvestInto)",
  "function balanceOf(address) view returns (uint256)",
];
const TOKEN_DEC_ABI = ["function decimals() view returns (uint8)"];
const SYMBOL_ABI = ["function symbol() view returns (string)"];

const HARVEST_DESTS_DEGEN = [
  { label: "10 Year DEGEN Pool (default)", payoutPct: 100, addr: "0xdE672FccA32365bD704c39bd1164a0D34a3a73e6" },
  { label: "1 Year DEGEN Pool", payoutPct: 5, addr: "0x3d175C8359169b0e830d36EA9CD3FE209f46f7BD" },
  { label: "3 Month DEGEN Pool", payoutPct: 2.5, addr: "0x7ED33f65A0398cb26eaB2B03877825c96D9B6077" },
  { label: "1 Month DEGEN Pool", payoutPct: 1, addr: "0xd9b491ac0f5487673500b67224b67b4171a08aca" },
  { label: "Into Wallet", payoutPct: 0.5, addr: null as string | null },
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
function friendlyTxError(err: unknown) {
  const e = err as { reason?: string; shortMessage?: string; message?: string };
  const m = String(e?.reason || e?.shortMessage || e?.message || "Transaction failed");
  if (/user rejected|user denied|ACTION_REJECTED/i.test(m))
    return "Transaction rejected in wallet";
  return m.length > 120 ? m.slice(0, 120) + "…" : m;
}
function rewardAmountToWei(amount: number) {
  return BigInt(Math.round(Number(amount || 0) * 1e8)) * 10000000000n;
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
      const res = (await withT(
        fetch("https://rpc.pulsechain.com", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            jsonrpc: "2.0",
            method: "eth_call",
            params: [{ to: MASTERCHEF2, data }, "latest"],
            id: 1,
          }),
        }).then((r) => r.json()),
        8000,
      )) as { error?: { message: string }; result: string };
      if (res.error) throw new Error(res.error.message);
      return BigInt(res.result);
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
  if (_degenOfficialStatsMap) return _degenOfficialStatsMap;
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
  _degenOfficialStatsMap = buildDegenOfficialStatsMap(
    details || (DEGEN_OFFICIAL_STATS_SNAPSHOT as OfficialStats[]),
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
    _degenVaultMetaMap = new Map();
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
  farm: FarmDef;
  idx: number;
  stakeCount: number;
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
    <span className="bfc-token-orb" title={token}>
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

function FarmPop({
  icon,
  title,
  rows,
}: {
  icon: string;
  title: string;
  rows: [string, string][];
}) {
  return (
    <span className="farm-pop">
      <button className="farm-pop-btn" type="button" aria-label={title}>
        {icon}
      </button>
      <span className="farm-pop-panel">
        <span className="farm-pop-title">
          {icon} {title}
        </span>
        {rows.map(([k, v]) => (
          <span className="farm-pop-row" key={k}>
            <span>{k}:</span>
            <b>{v}</b>
          </span>
        ))}
      </span>
    </span>
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
    return <span className="bfc-infinity">∞</span>;
  if (annualTokens === 0 || alloc === 0) return "Ended";
  return "—";
}

type Status = { msg: string; cls: string };
type Breakdown =
  | { state: "loading" }
  | { state: "unavailable" }
  | { state: "ready"; cells: { sym: string; amt: number; price: number | null; logo: string | null }[] };

type HarvestModalState = {
  amount: number;
  input: string;
  slider: number;
  selected: number;
  resolve: (v: { into: string; amount: number }) => void;
  reject: (e: Error) => void;
} | null;

// ── Component ─────────────────────────────────────────────────────────────────
export function FarmsPage({ wallet }: { wallet: WalletState }) {
  const [farms, setFarms] = useState<(FarmData | null)[]>([]);
  const [loading, setLoading] = useState(false);
  const [helperCredit, setHelperCredit] = useState(0);
  const [stakedOnly, setStakedOnly] = useState(false);
  const [view, setView] = useState<"grid" | "table">("grid");
  const [inputs, setInputs] = useState<Record<number, string>>({});
  const [statuses, setStatuses] = useState<Record<number, Status>>({});
  const [busy, setBusy] = useState<Record<number, boolean>>({});
  const [breakdowns, setBreakdowns] = useState<Record<number, Breakdown | undefined>>({});
  const [bannerStatus, setBannerStatus] = useState<Status>({ msg: "", cls: "" });
  const [harvestModal, setHarvestModal] = useState<HarvestModalState>(null);
  const [, setTick] = useState(0);
  const loadSeq = useRef(0);
  const statusTimers = useRef<Record<number, ReturnType<typeof setTimeout>>>({});

  useEffect(() => {
    const timer = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(timer);
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

  const patchFarm = (idx: number, patch: Partial<FarmData>) =>
    setFarms((prev) =>
      prev.map((d, i) => (i === idx && d ? { ...d, ...patch } : d)),
    );

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

  // ── fetchDegenVaultData (ported) ────────────────────────────────────────────
  const loadFarms = useCallback(async () => {
    if (!wallet.address) {
      setFarms([]);
      return;
    }
    const address = wallet.address;
    const seq = ++loadSeq.current;
    setLoading(true);
    setFarms([]);

    const provider = await getPublicProvider();
    const metaMap = await fetchDegenVaultMetaMap();
    if (!_degenAllocMap) _degenAllocMap = await buildAllocMap();
    const degenPriceUsd = await fetchTokenUsd(CONTRACTS.degen);
    const officialStatsMap = await fetchDegenOfficialStatsMap();
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
      const lpDec = meta?.decimals || farm.dec;

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
        const nStakesRaw = await withT(c.getNrOfStakes(address), 6000).catch(() => null);
        const stakesKnown = nStakesRaw !== null;
        if (stakesKnown) stakeCount = Number(nStakesRaw);

        let totalEarnedRaw: bigint | null = null;
        if (!stakesKnown || stakeCount > 0) {
          totalEarnedRaw = (await withT(c.viewUserTotalEarnings(address), 6000).catch(
            () => null,
          )) as bigint | null;
          if (totalEarnedRaw && totalEarnedRaw > 0n) {
            pendingDegen = Number(formatUnits(totalEarnedRaw, 18));
          }
        }

        if (stakeCount > 0) {
          let stakeEarningsWorks = false;
          let stakePendingDegen = 0;
          for (let s = 0; s < Math.min(stakeCount, 20); s++) {
            try {
              const [infoR, earnR] = await Promise.allSettled([
                withT(c.userInfo(address, s), 4000),
                withT(c.viewStakeEarnings(address, s), 4000),
              ]);
              if (infoR.status === "fulfilled") {
                totalStakedRaw += BigInt(infoR.value.amount);
                totalStaked += Number(formatUnits(infoR.value.amount, farm.dec));
              }
              if (earnR.status === "fulfilled") {
                stakeEarningsWorks = true;
                if (earnR.value > 0n) {
                  stakePendingDegen += Number(formatUnits(earnR.value, 18));
                  claimableStakeIds.push(BigInt(s));
                }
              }
            } catch {
              /* per-stake failures tolerated */
            }
          }
          if (stakeEarningsWorks) pendingDegen = stakePendingDegen;
          if (!stakeEarningsWorks) {
            if (totalEarnedRaw && totalEarnedRaw > 0n) {
              pendingDegen = Number(formatUnits(totalEarnedRaw, 18));
              for (let s = 0; s < stakeCount; s++) claimableStakeIds.push(BigInt(s));
            }
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
      if (!(dailyReward > 1e-10) && stakeCount > 0 && pendingDegen > 0) {
        dailyReward = DEGEN_DAILY_REWARD_FALLBACKS[farm.addr.toLowerCase()] || 0;
      }

      results[idx] = {
        farm,
        idx,
        stakeCount,
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
    }

    DEGEN_FARMS.forEach((farm, idx) => {
      if (!results[idx])
        results[idx] = {
          farm,
          idx,
          stakeCount: 0,
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
    });
    if (loadSeq.current !== seq) return;
    setFarms(results);
    setLoading(false);
  }, [wallet.address, fetchHelperCredit]);

  useEffect(() => {
    void loadFarms();
  }, [loadFarms]);

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
        if (wRaw !== null) {
          patch.walletBalRaw = BigInt(wRaw);
          patch.walletBal = Number(formatUnits(wRaw, 18));
          if ((d.lpPriceUsd || 0) > 0) patch.walletUsd = patch.walletBal! * d.lpPriceUsd!;
        }
        if (aRaw !== null) patch.allowanceRaw = BigInt(aRaw);
        let totalStaked = 0,
          totalStakedRaw = 0n,
          pending = 0;
        const claimIds: bigint[] = [];
        for (let s = 0; s < Math.min(stakeCount, 20); s++) {
          const [infoR, earnR] = await Promise.allSettled([
            c.userInfo(address, s),
            c.viewStakeEarnings(address, s),
          ]);
          if (infoR.status === "fulfilled") {
            totalStakedRaw += BigInt(infoR.value.amount);
            totalStaked += Number(formatUnits(infoR.value.amount, 18));
          }
          if (earnR.status === "fulfilled" && earnR.value > 0n) {
            pending += Number(formatUnits(earnR.value, 18));
            claimIds.push(BigInt(s));
          }
        }
        patch.totalStaked = totalStaked;
        patch.totalStakedRaw = totalStakedRaw;
        patch.pendingDegen = pending;
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
  function pickHarvestDest(amount: number) {
    return new Promise<{ into: string; amount: number }>((resolve, reject) => {
      const raw = (v: number) =>
        v >= 1000 ? String(Math.floor(v)) : String(Number(v.toFixed(4)));
      setHarvestModal({
        amount,
        input: amount > 0 ? raw(amount) : "0",
        slider: 100,
        selected: 0,
        resolve,
        reject,
      });
    });
  }

  const hdCurrentAmount = (modal: NonNullable<HarvestModalState>) => {
    const v = parseFloat(String(modal.input).replace(/[, ]/g, ""));
    if (!Number.isFinite(v) || v < 0) return 0;
    return Math.min(v, modal.amount);
  };
  const hdPctText = (
    d: (typeof HARVEST_DESTS_DEGEN)[number],
    claimAmt: number,
  ) => {
    const recv = claimAmt > 0 ? ` (${fmtFullReward((claimAmt * d.payoutPct) / 100)})` : "";
    return d.payoutPct === 100
      ? `Receive 100%${recv}`
      : `-${100 - d.payoutPct}% Penalty${recv}`;
  };

  // ── Actions ────────────────────────────────────────────────────────────────
  const inputAmountWei = (idx: number) => {
    const v = inputs[idx]?.trim();
    if (!v || !(Number(v) > 0)) return null;
    try {
      return parseUnits(v, 18);
    } catch {
      return null;
    }
  };

  async function approveFarm(d: FarmData) {
    if (!d.lpAddr || !wallet.address) return;
    const amt = inputAmountWei(d.idx) || MaxUint256;
    setBusy((b) => ({ ...b, [d.idx]: true }));
    try {
      const signer = await wallet.getSigner();
      const lp = new Contract(d.lpAddr, ERC20_ABI, signer);
      setFarmStatus(d.idx, "Confirm approval in wallet…", "active");
      const tx = await lp.approve(d.farm.addr, amt);
      setFarmStatus(d.idx, "Approval submitted — confirming…", "active");
      await tx.wait();
      patchFarm(d.idx, { allowanceRaw: amt });
      await refreshFarm(d);
      setFarmStatus(d.idx, "✓ Approved", "ok");
      clearFarmStatusSoon(d.idx);
    } catch (err) {
      setFarmStatus(d.idx, "✗ " + friendlyTxError(err), "err");
      clearFarmStatusSoon(d.idx);
    } finally {
      setBusy((b) => ({ ...b, [d.idx]: false }));
    }
  }

  async function stakeFarm(d: FarmData) {
    if (!wallet.address) return;
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
    setBusy((b) => ({ ...b, [d.idx]: true }));
    try {
      const signer = await wallet.getSigner();
      const c = new Contract(d.farm.addr, DEGEN_VAULT_ABI, signer);
      setFarmStatus(d.idx, "Confirm in wallet…", "active");
      const tx = await c.deposit(amount, ZeroAddress);
      setFarmStatus(d.idx, "Stake submitted — confirming…", "active");
      await tx.wait();
      await refreshFarm(d);
      setFarmStatus(d.idx, "✓ Staked!", "ok");
      clearFarmStatusSoon(d.idx);
    } catch (err) {
      setFarmStatus(d.idx, "✗ " + friendlyTxError(err), "err");
      clearFarmStatusSoon(d.idx);
    } finally {
      setBusy((b) => ({ ...b, [d.idx]: false }));
    }
  }

  async function unstakeFarm(d: FarmData) {
    if (!wallet.address) return;
    if (!(d.stakeCount > 0)) {
      setFarmStatus(d.idx, "✗ No active stake to withdraw", "err");
      clearFarmStatusSoon(d.idx, 4000);
      return;
    }
    const target = inputAmountWei(d.idx);
    const exceedsStake =
      target &&
      (d.totalStakedRaw != null
        ? target > d.totalStakedRaw
        : d.totalStaked > 0 && Number(formatUnits(target, 18)) > d.totalStaked * 1.000001);
    if (exceedsStake) {
      setFarmStatus(d.idx, "✗ Amount exceeds staked balance", "err");
      clearFarmStatusSoon(d.idx);
      return;
    }
    setBusy((b) => ({ ...b, [d.idx]: true }));
    try {
      const signer = await wallet.getSigner();
      const provider = await getPublicProvider();
      const cW = new Contract(d.farm.addr, DEGEN_VAULT_ABI, signer);
      const cR = new Contract(d.farm.addr, DEGEN_VAULT_ABI, provider);
      const n = Number(await cR.getNrOfStakes(wallet.address));
      if (!(n > 0)) {
        setFarmStatus(d.idx, "✗ No active stake to withdraw", "err");
        clearFarmStatusSoon(d.idx);
        return;
      }
      const amounts = await Promise.all(
        Array.from({ length: n }, (_, s) =>
          cR.userInfo(wallet.address, s)
            .then((u: { amount: bigint }) => BigInt(u.amount))
            .catch(() => 0n),
        ),
      );
      let withdrawn = 0n,
        txCount = 0;
      for (let s = n - 1; s >= 0; s--) {
        if (target && withdrawn >= target) break;
        setFarmStatus(d.idx, `Confirm withdrawal ${txCount + 1} in wallet… (stake #${s})`, "active");
        const tx = await cW.withdraw(s);
        setFarmStatus(d.idx, "Unstake submitted — confirming…", "active");
        await tx.wait();
        withdrawn += amounts[s];
        txCount++;
      }
      await refreshFarm(d);
      const lpOut = fmtFullReward(Number(formatUnits(withdrawn, 18)));
      setFarmStatus(
        d.idx,
        `✓ Unstaked ${lpOut} LP across ${txCount} stake${txCount === 1 ? "" : "s"} — rewards added to your claimable balance`,
        "ok",
      );
      clearFarmStatusSoon(d.idx, 8000);
    } catch (err) {
      setFarmStatus(d.idx, "✗ " + friendlyTxError(err), "err");
      clearFarmStatusSoon(d.idx);
    } finally {
      setBusy((b) => ({ ...b, [d.idx]: false }));
    }
  }

  async function harvestFarm(d: FarmData) {
    if (!wallet.address) {
      alert("Connect your wallet first");
      return;
    }
    if ((d.pendingDegen || 0) <= 1e-8) {
      setFarmStatus(d.idx, "No DEGEN to claim", "err");
      clearFarmStatusSoon(d.idx);
      return;
    }
    setBusy((b) => ({ ...b, [d.idx]: true }));
    setFarmStatus(d.idx, "Check wallet…", "active");
    try {
      const { into: harvestInto, amount: chosenAmount } = await pickHarvestDest(
        d.pendingDegen || 0,
      );
      const signer = await wallet.getSigner();
      const stakeIDs =
        d.claimableStakeIds && d.claimableStakeIds.length > 0
          ? d.claimableStakeIds
          : Array.from({ length: Math.max(1, d.stakeCount || 1) }, (_, i) => BigInt(i));
      const helper = new Contract(DEGEN_REWARDS_HELPER, DEGEN_REWARDS_HELPER_ABI, signer);
      const claimAmount = rewardAmountToWei(chosenAmount || d.pendingDegen || 0);
      setFarmStatus(d.idx, "Confirm claim/stake in wallet…", "active");
      const tx = await helper.claimWithHarvest(
        [d.farm.addr],
        wallet.address,
        [stakeIDs],
        claimAmount,
        harvestInto,
      );
      setFarmStatus(d.idx, "Confirming claim/stake…", "active");
      await tx.wait();
      const okMsg =
        harvestInto.toLowerCase() === wallet.address.toLowerCase()
          ? "✓ Claimed!"
          : "✓ Claimed and staked!";
      patchFarm(d.idx, { pendingDegen: 0, pendingUsd: null, claimableStakeIds: [] });
      await refreshFarm(d);
      setFarmStatus(d.idx, okMsg, "ok");
      clearFarmStatusSoon(d.idx);
    } catch (e) {
      if ((e as Error).message === "Cancelled") {
        setFarmStatus(d.idx, "");
      } else {
        setFarmStatus(d.idx, friendlyTxError(e), "err");
        clearFarmStatusSoon(d.idx);
      }
    } finally {
      setBusy((b) => ({ ...b, [d.idx]: false }));
    }
  }

  async function claimAllRewards() {
    if (!wallet.address) return;
    const loadedFarms = farms.filter((d): d is FarmData => !!d);
    const pendingFarms = loadedFarms.filter((d) => (d.pendingDegen || 0) > 1e-8);
    const pending = pendingFarms.reduce((s, d) => s + d.pendingDegen, 0);
    const total = (helperCredit || 0) + pending;
    if (!(total > 1e-8)) return;
    const setS = (msg: string, cls = "") => setBannerStatus({ msg, cls });
    try {
      const { into: dest, amount: chosenAmount } = await pickHarvestDest(total);
      const claimAmt = chosenAmount || total;
      const signer = await wallet.getSigner();
      const helper = new Contract(DEGEN_REWARDS_HELPER, DEGEN_REWARDS_HELPER_ABI, signer);
      setS("Confirm in wallet…", "active");
      let tx;
      if (pendingFarms.length) {
        tx = await helper.claimWithHarvest(
          pendingFarms.map((d) => d.farm.addr),
          wallet.address,
          pendingFarms.map((d) =>
            d.claimableStakeIds && d.claimableStakeIds.length
              ? d.claimableStakeIds
              : Array.from({ length: Math.max(1, d.stakeCount || 1) }, (_, i) => BigInt(i)),
          ),
          rewardAmountToWei(claimAmt),
          dest,
        );
      } else {
        tx = await helper.claimRewards(rewardAmountToWei(claimAmt), dest);
      }
      setS("Confirming…", "active");
      await tx.wait();
      pendingFarms.forEach((d) =>
        patchFarm(d.idx, { pendingDegen: 0, pendingUsd: null, claimableStakeIds: [] }),
      );
      await fetchHelperCredit();
      setS("✓ Claimed!", "ok");
      setTimeout(() => setS(""), 6000);
    } catch (e) {
      if ((e as Error).message === "Cancelled") {
        setS("");
        return;
      }
      setS("✗ " + friendlyTxError(e), "err");
      setTimeout(() => setS(""), 8000);
    }
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
          const info = await getLpPairInfo(d.lpAddr, 18);
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
  const livePending = (d: FarmData) =>
    (d.pendingDegen || 0) > 0 && (d.dailyReward || 0) > 0
      ? d.pendingDegen + d.dailyReward * ((Date.now() - d.ts) / 86400000)
      : d.pendingDegen || 0;
  const liveAnnual = (d: FarmData) =>
    (d.annualRewardTokens || 0) > 0
      ? d.annualRewardTokens! + d.annualRewardTokens! * ((Date.now() - d.ts) / 31536000000)
      : d.annualRewardTokens || 0;

  // ── Render ─────────────────────────────────────────────────────────────────
  const loadedFarms = farms.filter((d): d is FarmData => !!d);
  const bannerTs = loadedFarms.length ? Math.min(...loadedFarms.map((d) => d.ts)) : Date.now();
  const pendingSum = loadedFarms.reduce((s, d) => s + (d.pendingDegen || 0), 0);
  const dailySum = loadedFarms.reduce((s, d) => s + (d.dailyReward || 0), 0);
  const bannerTotal = (helperCredit || 0) + pendingSum;
  const liveBannerTotal =
    bannerTotal > 0 && dailySum > 0
      ? bannerTotal + dailySum * ((Date.now() - bannerTs) / 86400000)
      : bannerTotal;

  const visible = stakedOnly ? loadedFarms.filter(isActiveDegenFarm) : loadedFarms;
  const sortedVisible = visible
    .slice()
    .sort((a, b) => {
      const aa = Number.isFinite(Number(a?.apr)) ? Number(a.apr) : -1;
      const bb = Number.isFinite(Number(b?.apr)) ? Number(b.apr) : -1;
      return bb - aa;
    });

  const totalTvl = loadedFarms.reduce((sum, d) => {
    const tvl = Number(d?.tvlUsd || 0);
    return Number.isFinite(tvl) && tvl > 0 ? sum + tvl : sum;
  }, 0);

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
                title={`Go to ${d.farm.name}`}
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

  const renderCard = (d: FarmData) => {
    const pendingLive = livePending(d);
    const pendingStr = fmtFullReward(pendingLive);
    const stakedStr = fmtLpAmount(d.totalStaked || 0);
    const isActive = isActiveDegenFarm(d);
    const stakedLabel =
      d.totalStaked > 1e-10 ? stakedStr : isActive ? "Unknown" : "—";
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
    const annualStr = (d.annualRewardTokens || 0) > 0 ? fmtFullReward(annualLive) : "—";
    const annualSub = fmtUsd(d.annualRewardsUsd) || "DEGEN / year";
    const pctStr =
      (d.stakedPct || 0) > 0
        ? (d.stakedPct! >= 10 ? d.stakedPct!.toFixed(1) : d.stakedPct!.toFixed(2)) + "%"
        : "0%";
    const stakedSub =
      (d.stakedUsd || 0) > 0 ? `${fmtUsd(d.stakedUsd)} (${pctStr})` : "$0.00 USD (0%)";
    const pendingSub = fmtUsd(d.pendingUsd) || "$0.00 USD";
    const status = statuses[d.idx];
    const breakdown = breakdowns[d.idx];
    const isBusy = !!busy[d.idx];
    const amtWei = inputAmountWei(d.idx);
    const approveLabel = amtWei
      ? "Approve " + fmtFullReward(Number(formatUnits(amtWei, 18)))
      : "Approve MAX";

    return (
      <div
        key={d.idx}
        className="browse-farm-card degen-farm-card"
        id={`farm-card-degen-${d.idx}`}
        style={{ "--bfc-color": "var(--red)" } as CSSProperties}
      >
        <div className="bfc-head">
          <FarmTokenPair tokens={d.farm.tokens} />
          <div className="bfc-title-wrap">
            <div className="bfc-name">{d.farm.name}</div>
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
          <div
            className="bfc-stat-cell bfc-compact"
            title="Reward Allocation — share of total emissions (governance vote)"
          >
            <span className="bfc-stat-label">Alloc</span>
            <span className="bfc-stat-val">{allocStr}</span>
          </div>
          <div className="bfc-stat-cell bfc-compact">
            <span className="bfc-stat-label">Fees</span>
            <span className="bfc-stat-val">0% / 0%</span>
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
                        ? formatUnits(d.walletBalRaw, 18)
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
            <span className="bfc-stat-label">Annual Rewards</span>
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
                <span className="bfc-stat-tok">{d.totalStaked > 1e-10 ? "LP" : ""}</span>
              </span>
              <button
                className="bfc-stat-max"
                disabled={!(actionsEnabled && d.totalStaked > 1e-10)}
                onClick={() => {
                  setInputs((prev) => ({
                    ...prev,
                    [d.idx]:
                      d.totalStakedRaw != null && d.totalStakedRaw > 0n
                        ? formatUnits(d.totalStakedRaw, 18)
                        : (d.totalStaked || 0) > 1e-10
                          ? d.totalStaked.toFixed(6).replace(/\.?0+$/, "")
                          : "",
                  }));
                }}
              >
                [MAX]
              </button>
            </div>
            <span className="bfc-stat-sub">{stakedSub}</span>
          </div>
          <div className="bfc-stat-cell">
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
                <span>{pendingStr}</span> DEGEN
              </span>
              <RewardsProjectionPop d={d} />
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
          <button className="bfc-harvest-btn" disabled={isBusy} onClick={() => void harvestFarm(d)}>
            Claim {pendingStr} DEGEN
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
            placeholder="Amount"
            disabled={!actionsEnabled || isBusy}
            value={inputs[d.idx] || ""}
            onChange={(event) =>
              setInputs((prev) => ({ ...prev, [d.idx]: event.target.value }))
            }
          />
          <button
            className="bfc-max"
            disabled={!actionsEnabled || isBusy}
            onClick={() =>
              setInputs((prev) => ({
                ...prev,
                [d.idx]:
                  d.walletBalRaw !== null && d.walletBalRaw !== undefined
                    ? formatUnits(d.walletBalRaw, 18)
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
            disabled={!actionsEnabled || isBusy}
            onClick={() => void stakeFarm(d)}
          >
            Stake
          </button>
          <button
            className="bfc-unstake-btn"
            disabled={!(actionsEnabled && d.stakeCount > 0) || isBusy}
            onClick={() => void unstakeFarm(d)}
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
        <div className={`bfc-status${status?.cls ? " " + status.cls : ""}`}>
          {status?.msg || ""}
        </div>
        <div className="bfc-bottom-line">
          <span>
            Time Left:{" "}
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
    const stakedLabel = d.totalStaked > 1e-10 ? fmtLpAmount(d.totalStaked) : "—";
    const pendingStr = fmtFullReward(livePending(d));
    const walletStr =
      d.walletBal !== null && d.walletBal !== undefined ? fmtLpAmount(d.walletBal) : "—";
    return (
      <tr key={d.idx}>
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
              goToFarm(d.idx);
            }}
          >
            Manage
          </button>
        </td>
      </tr>
    );
  };

  const hdModal = harvestModal && (
    <div id="harvestDestModal" className="modal-overlay">
      <div className="modal-box" style={{ maxWidth: 400 }}>
        <div className="modal-title">Harvest Rewards</div>
        <div className="hd-available">
          Your Available Rewards: {fmtFullReward(harvestModal.amount)} DEGEN
        </div>
        <div className="hd-amount-section">
          <div className="hd-amount-label">DEGEN To Claim:</div>
          <input
            type="text"
            className="modal-input hd-amount-input"
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
            min="0"
            max="100"
            value={harvestModal.slider}
            onChange={(event) => {
              const slider = Number(event.target.value);
              setHarvestModal((prev) => {
                if (!prev) return prev;
                const pct = slider / 100;
                const raw = (v: number) =>
                  v >= 1000 ? String(Math.floor(v)) : String(Number(v.toFixed(4)));
                return {
                  ...prev,
                  slider,
                  input: prev.amount > 0 ? raw(prev.amount * pct) : "0",
                };
              });
            }}
          />
        </div>
        <div className="hd-dest-label">Harvest rewards into...</div>
        <div id="hd-options">
          {HARVEST_DESTS_DEGEN.map((dest, i) => (
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
              <span className="hd-opt-name">{dest.label}</span>
              <span className={`hd-opt-pct${dest.payoutPct === 100 ? " hd-good" : " hd-bad"}`}>
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
            onClick={() => {
              const dest = HARVEST_DESTS_DEGEN[harvestModal.selected];
              const amt = hdCurrentAmount(harvestModal);
              harvestModal.resolve({
                into: dest.addr || wallet.address || "",
                amount: amt > 0 ? amt : harvestModal.amount,
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
        ) : loading && loadedFarms.length === 0 ? (
          <div className="rw-miners-loading">
            <span className="spinner" />
            Loading DEGEN farms…
          </div>
        ) : (
          <>
            <div>
              <div className="farm-total-tvl">
                Total Value Locked:{" "}
                <b>{totalTvl > 0 ? "$" + Math.round(totalTvl).toLocaleString() : "—"}</b>
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
                  title="Open DegenStrategy farms"
                >
                  <div className="farms-brand-logo">
                    <img src={TOKEN_LOGOS["DEGEN"]} alt="DEGEN" />
                  </div>
                  <div>
                    <div className="farms-title">
                      DEGEN Farms{" "}
                      <span className="farms-count">{DEGEN_FARMS.length} farms</span>
                    </div>
                  </div>
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
                    title="Grid view"
                  >
                    ▦
                  </button>
                  <button
                    className={`farm-view-btn ${view === "table" ? "active" : ""}`}
                    type="button"
                    onClick={() => setView("table")}
                    title="Table view"
                  >
                    ☰
                  </button>
                </div>
              </div>
              {bannerTotal > 1e-8 && (
                <div>
                  <div className="farms-rewards-banner">
                    <span>
                      Total Rewards: <b>{fmtFullReward(liveBannerTotal)}</b> DEGEN
                    </span>
                    <button
                      className="bfc-liquidity-btn"
                      type="button"
                      onClick={() => void claimAllRewards()}
                    >
                      Claim Rewards
                    </button>
                    <span className={`bfc-status${bannerStatus.cls ? " " + bannerStatus.cls : ""}`}>
                      {bannerStatus.msg}
                    </span>
                  </div>
                </div>
              )}
              {sortedVisible.length === 0 ? (
                <div className={view === "table" ? "browse-farms-table-wrap" : "browse-farms-grid"}>
                  <div className="rw-miners-loading">
                    No active DEGEN farms found. Toggle Staked off to browse all farms.
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
                <div className="browse-farms-grid">{sortedVisible.map(renderCard)}</div>
              )}
            </div>
          </>
        )}
      </div>
      {hdModal}
    </main>
  );
}
