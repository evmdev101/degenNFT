import { Contract, formatUnits, getAddress, isAddress } from "ethers";
import { CHAIN_ID, CONTRACTS, DEGEN_REWARDS_HELPER, NFT_TOKEN_ID } from "../../config/contracts";
import { getPublicProvider } from "../../lib/chain";
import { quoteFarmClaim } from "../farmClaimQuote";
import { FARM_REGISTRY, MINER_POOLS } from "./config";
import { readTokenPrices } from "./marketData";

export type PortfolioFarm = {
  address: string; name: string; tokenAddress: string | null; decimals: number;
  depositedRaw: bigint | null; usd: number | null; pendingRaw: bigint | null;
  stakeCount: number | null; complete: boolean;
};
export type PortfolioMinerPool = {
  address: string; label: string; raw: bigint | null; usd: number | null;
  count: number | null; matureCount: number | null; complete: boolean;
};
export type PortfolioSnapshot = {
  account: string; blockNumber: number; observedAt: number; degenPriceUsd: number | null;
  wallet: { raw: bigint | null; usd: number | null };
  miners: { raw: bigint | null; usd: number | null; count: number | null; matureCount: number | null; knownRaw: bigint; knownCount: number; complete: boolean; pools: PortfolioMinerPool[] };
  farms: { positions: PortfolioFarm[]; usd: number | null; knownUsd: number; positionCount: number | null; complete: boolean };
  rewards: { farmRaw: bigint | null; helperRaw: bigint | null; totalRaw: bigint | null; usd: number | null; complete: boolean };
  nft: { countRaw: bigint | null; pendingDegenRaw: bigint | null; pendingOinkRaw: bigint | null };
  totalUsd: number | null; knownTotalUsd: number; complete: boolean;
};
export type PortfolioReader = {
  block: () => Promise<{ number: number; timestamp: number }>;
  call: (address: string, signature: string, args: readonly unknown[], block: number) => Promise<unknown>;
  prices: (addresses: readonly string[]) => Promise<Record<string, number | null>>;
  quote: (account: string, farms: { address: string; stakeIds: bigint[]; pendingRaw: bigint }[], block: number) => Promise<bigint>;
};
const READS = {
  balance: "function balanceOf(address) view returns (uint256)",
  count: "function getNrOfStakes(address) view returns (uint256)",
  minerInfo: "function userInfo(address,uint256) view returns (uint256 shares,uint256 lastMineredTime,uint256 xvmcAtLastUserAction,uint256 lastUserActionTime,uint256 mandatoryTimeToServe)",
  farmInfo: "function userInfo(address,uint256) view returns (uint256 amount,uint256 debt,uint256 feesPaid,uint256 lastAction)",
  sharePrice: "function getPricePerFullShare() view returns (uint256)",
  duration: "function withdrawFeePeriod() view returns (uint256)",
  grace: "function gracePeriod() view returns (uint256)",
  stakeToken: "function stakeToken() view returns (address)",
  pending: "function viewUserTotalEarnings(address) view returns (uint256)",
  nftBalance: "function balanceOf(address,uint256) view returns (uint256)",
  nftPending: "function viewUserTotalEarnings(address) view returns (uint256 pendingToken1,uint256 pendingToken2)",
  decimals: "function decimals() view returns (uint8)",
  token0: "function token0() view returns (address)",
  token1: "function token1() view returns (address)",
  supply: "function totalSupply() view returns (uint256)",
  reserves: "function getReserves() view returns (uint112 reserve0,uint112 reserve1,uint32 timestamp)",
};

const raw = (value: unknown): bigint => {
  const amount = BigInt(value as bigint);
  if (amount < 0n) throw new Error("Negative contract amount");
  return amount;
};
const count = (value: unknown) => {
  const result = raw(value);
  if (result > 5000n) throw new Error("Position count exceeds supported read limit");
  return Number(result);
};
const field = (value: unknown, index: number, name: string) => {
  const record = value as Record<string, unknown> & unknown[];
  return raw(record[name] ?? record[index]);
};
const precision = (value: unknown) => {
  const result = Number(value);
  if (!Number.isInteger(result) || result < 0 || result > 36) throw new Error("Unsupported precision");
  return result;
};
export function portfolioUsd(amount: bigint | null, decimals: number, price: number | null): number | null {
  if (amount === 0n) return 0;
  if (amount === null || price === null || !Number.isFinite(price) || price <= 0) return null;
  const value = Number(formatUnits(amount, decimals)) * price;
  return Number.isFinite(value) ? value : null;
}
async function batches<T, R>(values: readonly T[], read: (value: T, index: number) => Promise<R>): Promise<R[]> {
  const result: R[] = [];
  for (let start = 0; start < values.length; start += 4) {
    result.push(...await Promise.all(values.slice(start, start + 4).map((value, offset) => read(value, start + offset))));
  }
  return result;
}

/** Every principal amount is pinned to one block; incomplete reads never become zero. */
export async function readPortfolioWithReader(account: string, reader: PortfolioReader): Promise<PortfolioSnapshot> {
  if (!isAddress(account)) throw new Error("Invalid wallet address");
  const normalized = getAddress(account.toLowerCase());
  const deadline = Date.now() + 45_000;
  const bounded = async <T,>(read: () => Promise<T>): Promise<T> => {
    const remaining = Math.min(8_000, deadline - Date.now());
    if (remaining <= 0) throw new Error("Portfolio read timed out");
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([Promise.resolve().then(read), new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("Portfolio read timed out")), remaining);
      })]);
    } finally { clearTimeout(timer); }
  };
  const block = await bounded(reader.block);
  const now = Date.now() / 1000;
  if (!Number.isSafeInteger(block.number) || block.number < 0 || !Number.isSafeInteger(block.timestamp) || block.timestamp <= 0
    || now - block.timestamp > 120 || block.timestamp - now > 30) throw new Error("A recent PulseChain block is unavailable");
  const call = (address: string, signature: string, args: readonly unknown[] = []) => bounded(() => reader.call(address, signature, args, block.number));
  const amount = (address: string, signature: string, args: readonly unknown[] = []) => call(address, signature, args).then(raw);
  const prices = (addresses: readonly string[]) => bounded(() => reader.prices(addresses)).catch(() => ({} as Record<string, number | null>));
  const [walletRaw, helperRaw, nftCount, nftPending, degenPrices] = await Promise.all([
    amount(CONTRACTS.degen, READS.balance, [normalized]).catch(() => null),
    amount(DEGEN_REWARDS_HELPER, READS.balance, [normalized]).catch(() => null),
    amount(CONTRACTS.nft, READS.nftBalance, [normalized, NFT_TOKEN_ID]).catch(() => null),
    call(CONTRACTS.nft, READS.nftPending, [normalized]).then(value => [field(value, 0, "pendingToken1"), field(value, 1, "pendingToken2")] as const).catch(() => null),
    prices([CONTRACTS.degen]),
  ]);
  const degenPriceUsd = degenPrices[CONTRACTS.degen.toLowerCase()] ?? null;

  const pools = await batches(MINER_POOLS, async pool => {
    const [nr, sharePrice, duration, grace] = await Promise.all([
      call(pool.address, READS.count, [normalized]).then(count).catch(() => null),
      amount(pool.address, READS.sharePrice).catch(() => null),
      amount(pool.address, READS.duration).catch(() => null),
      amount(pool.address, READS.grace).catch(() => null),
    ]);
    let total = 0n, known = 0n, mature = 0, active = 0, infoComplete = true, countsComplete = true, maturityComplete = duration !== null && grace !== null;
    if (nr !== null) await batches(Array.from({ length: nr }, (_, id) => id), async id => {
      try {
        const info = await call(pool.address, READS.minerInfo, [normalized, BigInt(id)]);
        const shares = field(info, 0, "shares");
        if (shares === 0n) return;
        active++;
        if (sharePrice === null) infoComplete = false;
        else { const value = shares * sharePrice / 10n ** 18n; total += value; known += value; }
        const started = field(info, 1, "lastMineredTime");
        if (duration !== null && grace !== null && BigInt(block.timestamp) >= started + duration && BigInt(block.timestamp) <= started + duration + grace) mature++;
      } catch { infoComplete = false; countsComplete = false; maturityComplete = false; }
    });
    const totalRaw = nr === 0 ? 0n : nr !== null && infoComplete ? total : null;
    return { address: pool.address, label: pool.label, raw: totalRaw, usd: portfolioUsd(totalRaw, 18, degenPriceUsd), count: nr !== null && countsComplete ? active : null,
      matureCount: nr === 0 ? 0 : nr !== null && maturityComplete ? mature : null, complete: totalRaw !== null, knownRaw: known, knownCount: active };
  });

  const farmDetails = await batches(FARM_REGISTRY, async farm => {
    const base: PortfolioFarm = { address: farm.address, name: farm.name, tokenAddress: null, decimals: farm.decimals,
      depositedRaw: null, usd: null, pendingRaw: null, stakeCount: null, complete: false };
    const stakeCount = await call(farm.address, READS.count, [normalized]).then(count).catch(() => null);
    base.stakeCount = stakeCount;
    if (stakeCount === null) return { position: base, ids: [] as bigint[] };
    if (stakeCount === 0) return { position: { ...base, depositedRaw: 0n, usd: 0, pendingRaw: 0n, complete: true }, ids: [] as bigint[] };
    const ids = Array.from({ length: stakeCount }, (_, id) => BigInt(id));
    const deposits = await batches(ids, id => call(farm.address, READS.farmInfo, [normalized, id]).then(info => field(info, 0, "amount")).catch(() => null));
    base.depositedRaw = deposits.every(value => value !== null) ? deposits.reduce<bigint>((sum, value) => sum + value!, 0n) : null;
    base.pendingRaw = await amount(farm.address, READS.pending, [normalized]).catch(() => null);
    try {
      const token = String(await call(farm.address, READS.stakeToken));
      if (!isAddress(token)) throw new Error("Invalid deposited token");
      base.tokenAddress = getAddress(token.toLowerCase());
      base.decimals = await call(token, READS.decimals).then(precision);
      if (base.depositedRaw === 0n) base.usd = 0;
      else if (base.depositedRaw !== null && farm.tokens.length === 1) {
        const quotes = await prices([token]);
        base.usd = portfolioUsd(base.depositedRaw, base.decimals, quotes[token.toLowerCase()] ?? null);
      } else if (base.depositedRaw !== null) {
        const [token0, token1, reserves, supply] = await Promise.all([
          call(token, READS.token0).then(String), call(token, READS.token1).then(String), call(token, READS.reserves), amount(token, READS.supply),
        ]);
        if (!isAddress(token0) || !isAddress(token1) || supply === 0n) throw new Error("LP composition unavailable");
        const [dec0, dec1, quotes] = await Promise.all([call(token0, READS.decimals).then(precision), call(token1, READS.decimals).then(precision), prices([token0, token1])]);
        const value0 = portfolioUsd(base.depositedRaw * field(reserves, 0, "reserve0") / supply, dec0, quotes[token0.toLowerCase()] ?? null);
        const value1 = portfolioUsd(base.depositedRaw * field(reserves, 1, "reserve1") / supply, dec1, quotes[token1.toLowerCase()] ?? null);
        if (value0 !== null && value1 !== null) base.usd = value0 + value1;
      }
    } catch { /* Preserve raw deposited principal when a token or price read fails. */ }
    base.complete = base.depositedRaw !== null && base.usd !== null;
    return { position: base, ids };
  });
  const allCountsKnown = farmDetails.every(row => row.position.stakeCount !== null);
  const totalRaw = allCountsKnown ? await bounded(() => reader.quote(normalized, farmDetails.filter(row => row.ids.length).map(row => ({ address: row.position.address, stakeIds: row.ids, pendingRaw: row.position.pendingRaw ?? 0n })), block.number)).then(raw).catch(() => null) : null;
  const farmRaw = totalRaw !== null && helperRaw !== null && totalRaw >= helperRaw ? totalRaw - helperRaw : null;
  const minerRaw = pools.every(pool => pool.raw !== null) ? pools.reduce((sum, pool) => sum + pool.raw!, 0n) : null;
  const minerKnownRaw = pools.reduce((sum, pool) => sum + pool.knownRaw, 0n);
  const minerUsd = portfolioUsd(minerRaw, 18, degenPriceUsd);
  const farmComplete = farmDetails.every(row => row.position.complete);
  const farmKnownUsd = farmDetails.reduce((sum, row) => sum + (row.position.usd ?? 0), 0);
  const farmUsd = farmComplete ? farmKnownUsd : null;
  const walletUsd = portfolioUsd(walletRaw, 18, degenPriceUsd);
  const complete = walletUsd !== null && minerUsd !== null && farmUsd !== null;
  return {
    account: normalized, blockNumber: block.number, observedAt: block.timestamp * 1000, degenPriceUsd,
    wallet: { raw: walletRaw, usd: walletUsd },
    miners: { raw: minerRaw, usd: minerUsd, knownRaw: minerKnownRaw, knownCount: pools.reduce((sum, pool) => sum + pool.knownCount, 0),
      count: pools.every(pool => pool.count !== null) ? pools.reduce((sum, pool) => sum + pool.count!, 0) : null,
      matureCount: pools.every(pool => pool.matureCount !== null) ? pools.reduce((sum, pool) => sum + pool.matureCount!, 0) : null,
      complete: minerRaw !== null, pools: pools.map(({ knownRaw: _, knownCount: _count, ...pool }) => pool) },
    farms: { positions: farmDetails.filter(row => row.position.stakeCount !== 0).map(row => row.position), usd: farmUsd, knownUsd: farmKnownUsd,
      positionCount: allCountsKnown ? farmDetails.reduce((sum, row) => sum + row.position.stakeCount!, 0) : null, complete: farmComplete },
    rewards: { farmRaw, helperRaw, totalRaw, usd: portfolioUsd(totalRaw, 18, degenPriceUsd), complete: totalRaw !== null && helperRaw !== null },
    nft: { countRaw: nftCount, pendingOinkRaw: nftPending?.[0] ?? null, pendingDegenRaw: nftPending?.[1] ?? null },
    totalUsd: complete ? walletUsd! + minerUsd! + farmUsd! : null,
    knownTotalUsd: (walletUsd ?? 0) + (portfolioUsd(minerKnownRaw, 18, degenPriceUsd) ?? 0) + farmKnownUsd,
    complete,
  };
}

export async function readPortfolio(account: string): Promise<PortfolioSnapshot> {
  const provider = await getPublicProvider();
  return readPortfolioWithReader(account, {
    block: async () => {
      if (BigInt(await provider.send("eth_chainId", [])) !== CHAIN_ID) throw new Error("PulseChain provider required");
      const block = await provider.getBlock("latest");
      if (!block) throw new Error("Block unavailable");
      return block;
    },
    call: async (address, signature, args, blockTag) => {
      const contract = new Contract(address.toLowerCase(), [signature], provider);
      const name = signature.match(/function\s+(\w+)/)![1];
      return contract[name](...args, { blockTag });
    },
    prices: readTokenPrices,
    quote: (user, farms, block) => quoteFarmClaim(provider, user, DEGEN_REWARDS_HELPER, farms, block),
  });
}
