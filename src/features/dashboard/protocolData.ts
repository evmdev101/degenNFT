import { Contract, getAddress, isAddress } from "ethers";
import { CONTRACTS } from "../../config/contracts";
import { getPublicProvider } from "../../lib/chain";
import { GOVERNANCE_ADDRESSES as A } from "../governance/governanceSpec";
import { REWARD_POOL_NAMES } from "../governance/rewardPoolNames";
import { MINER_POOLS, TREASURY } from "./config";

export type ProtocolPool = { id: number; address: string; label: string; allocRaw: bigint; percent: number | null };
export type ProtocolMiner = {
  address: string; label: string; duration: number; accountingRaw: bigint | null; sharesRaw: bigint | null;
  issuedRaw: bigint | null; dailyRewardsRaw: bigint | null; apr: number | null; weightPercent: number | null;
};
export type ProtocolPair = { address: string; baseSymbol: string; quoteSymbol: string };
export type ProtocolOverviewSnapshot = {
  block: number; timestamp: number; hash: string; pools: ProtocolPool[] | null;
  totalAllocRaw: bigint | null; rewardPerBlockRaw: bigint | null; miners: ProtocolMiner[];
  minerAccountingRaw: bigint | null; minerSharesRaw: bigint | null; votingBaseRaw: bigint | null;
  supply: { totalRaw: bigint | null; minerTokensRaw: bigint | null; pairTokensRaw: bigint | null; otherRaw: bigint | null };
  stats: { registeredPools: number | null; allocatedPools: number | null; nftPools: number | null; governorProposals: number | null; senators: number | null };
  blockSeconds: number | null; pair: ProtocolPair | null;
  virtualSupplyRaw?: bigint | null; governorTokensRaw?: bigint | null; treasuryTokensRaw?: bigint | null;
};
export type ProtocolReader = {
  block(tag: number | "latest"): Promise<{ number: number; timestamp: number; hash: string }>;
  call(address: string, signature: string, args: readonly unknown[], block: number): Promise<unknown>;
  pair?(): Promise<ProtocolPair | null>;
};

export const PROTOCOL_READS = {
  poolLength: "function poolLength() view returns(uint256)",
  poolInfo: "function poolInfo(uint256) view returns(uint256 allocPoint,uint256 lastRewardBlock,address participant)",
  totalAlloc: "function totalAllocPoint() view returns(uint256)",
  emission: "function DTXPerBlock() view returns(uint256)",
  start: "function startBlock() view returns(uint256)",
  accounting: "function balanceOf() view returns(uint256)",
  shares: "function totalShares() view returns(uint256)",
  masterchef: "function masterchef() view returns(address)",
  poolId: "function poolID() view returns(uint256)",
  supply: "function totalSupply() view returns(uint256)",
  balance: "function balanceOf(address) view returns(uint256)",
  token0: "function token0() view returns(address)",
  token1: "function token1() view returns(address)",
  governors: "function governorCount() view returns(uint256)",
  votingBase: "function totalDTXStaked() view returns(uint256)",
  virtualSupply: "function virtualTotalSupply() view returns(uint256)",
} as const;
const WPLS = "0xa1077a294dde1b09bb078844df40758a5d0f9a27";
const equal = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
function uint(value: unknown): bigint {
  if (typeof value !== "bigint" && !(typeof value === "string" && /^\d+$/.test(value))
    && !(typeof value === "number" && Number.isSafeInteger(value))) throw new Error("Invalid protocol quantity");
  const parsed = BigInt(value);
  if (parsed < 0n) throw new Error("Invalid protocol quantity");
  return parsed;
}
function address(value: unknown): string {
  if (typeof value !== "string" || !isAddress(value)) throw new Error("Invalid protocol address");
  return getAddress(value.toLowerCase());
}
function count(value: unknown, maximum = 1_000_000): number {
  const parsed = uint(value);
  if (parsed > BigInt(maximum)) throw new Error("Protocol registry exceeds read limit");
  return Number(parsed);
}
function field(value: unknown, index: number, name: string): unknown {
  if (!value || typeof value !== "object") throw new Error("Invalid protocol record");
  const record = value as Record<string, unknown>;
  return record[name] ?? record[index];
}
function total(values: readonly (bigint | null)[]): bigint | null {
  return values.every(value => value !== null) ? values.reduce<bigint>((sum, value) => sum + value!, 0n) : null;
}
/** Fixed-point division keeps percentages valid even when token amounts exceed Number precision. */
export function protocolPercent(amount: bigint, denominator: bigint): number | null {
  if (amount < 0n || denominator <= 0n || amount > denominator) return null;
  return Number(amount * 100_000_000n / denominator) / 1_000_000;
}
export function minerEmissionEstimate(balance: bigint | null, emission: bigint | null, allocation: bigint | null,
  totalAllocation: bigint | null, elapsedBlocks: number, elapsedSeconds: number, started: boolean): { dailyRaw: bigint | null; apr: number | null } {
  if (balance === null || emission === null || allocation === null || totalAllocation === null || balance < 0n || emission < 0n
    || allocation < 0n || totalAllocation <= 0n || allocation > totalAllocation || !Number.isSafeInteger(elapsedBlocks)
    || elapsedBlocks <= 0 || !Number.isSafeInteger(elapsedSeconds) || elapsedSeconds <= 0) return { dailyRaw: null, apr: null };
  const dailyRaw = started ? emission * allocation * 86400n * BigInt(elapsedBlocks) / (totalAllocation * BigInt(elapsedSeconds)) : 0n;
  const apr = balance > 0n ? Number(dailyRaw * 365n * 100_000_000n / balance) / 1_000_000 : null;
  return { dailyRaw, apr: apr !== null && Number.isFinite(apr) ? apr : null };
}
function validBlock(block: { number: number; timestamp: number; hash: string }) {
  if (!Number.isSafeInteger(block.number) || block.number < 0 || !Number.isSafeInteger(block.timestamp) || block.timestamp <= 0
    || !/^0x[0-9a-f]{64}$/i.test(block.hash)) throw new Error("Protocol snapshot unavailable");
  return block;
}

/** Public protocol amounts use one canonical block; incomplete totals never become zero. */
export async function readProtocolOverview(reader: ProtocolReader): Promise<ProtocolOverviewSnapshot> {
  const endsAt = Date.now() + 40_000;
  async function bounded<T>(read: () => Promise<T>): Promise<T> {
    const ms = Math.min(8_000, endsAt - Date.now());
    if (ms <= 0) throw new Error("Protocol read timed out");
    let timer: ReturnType<typeof setTimeout> | undefined;
    try { return await Promise.race([Promise.resolve().then(read), new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error("Protocol read timed out")), ms);
    })]); } finally { clearTimeout(timer); }
  }
  const head = validBlock(await bounded(() => reader.block("latest")));
  if (Date.now() / 1000 - head.timestamp > 120 || head.timestamp > Date.now() / 1000 + 30) throw new Error("Current protocol block unavailable");
  const call = (target: string, signature: string, args: readonly unknown[] = []) => bounded(() => reader.call(target, signature, args, head.number));
  const amount = (target: string, signature: string, args: readonly unknown[] = []) => call(target, signature, args).then(uint).catch(() => null);
  const earlierNumber = Math.max(0, head.number - 100);
  const [registeredPools, totalAllocRaw, rewardPerBlockRaw, start, totalRaw, governorProposals, votingBaseRaw, earlier, candidate, virtualSupplyRaw, governorTokensRaw, treasuryTokensRaw] = await Promise.all([
    call(A.masterChef, PROTOCOL_READS.poolLength).then(value => count(value, 100)).catch(() => null),
    amount(A.masterChef, PROTOCOL_READS.totalAlloc), amount(A.masterChef, PROTOCOL_READS.emission),
    amount(A.masterChef, PROTOCOL_READS.start), amount(CONTRACTS.degen, PROTOCOL_READS.supply),
    call(A.treasury, PROTOCOL_READS.governors).then(value => count(value)).catch(() => null),
    amount(A.treasury, PROTOCOL_READS.votingBase),
    bounded(() => reader.block(earlierNumber)).then(validBlock).catch(() => null),
    reader.pair ? bounded(reader.pair).catch(() => null) : null,
    amount(A.masterChef, PROTOCOL_READS.virtualSupply),
    amount(CONTRACTS.degen, PROTOCOL_READS.balance, [A.governor]),
    amount(CONTRACTS.degen, PROTOCOL_READS.balance, [TREASURY]),
  ]);
  let pools: ProtocolPool[] | null = null;
  if (registeredPools !== null) {
    const rows: (ProtocolPool | null)[] = [];
    for (let first = 0; first < registeredPools; first += 6) rows.push(...await Promise.all(
      Array.from({ length: Math.min(6, registeredPools - first) }, (_, offset) => first + offset).map(async id => {
        try {
          const row = await call(A.masterChef, PROTOCOL_READS.poolInfo, [id]);
          const participant = address(field(row, 2, "participant")), allocRaw = uint(field(row, 0, "allocPoint"));
          const miner = MINER_POOLS.find(pool => equal(pool.address, participant));
          const metadata = REWARD_POOL_NAMES.find(pool => pool.id === id && equal(pool.participant, participant));
          return { id, address: participant, label: miner ? `${miner.label} DEGEN miners` : metadata?.name ?? `Pool #${id}`,
            allocRaw, percent: totalAllocRaw === null ? null : protocolPercent(allocRaw, totalAllocRaw) };
        } catch { return null; }
      }),
    ));
    if (rows.every(row => row !== null)) {
      pools = rows as ProtocolPool[];
      // Allocation fractions require the complete registry and matching denominator.
      if (totalAllocRaw === null || pools.reduce((sum, row) => sum + row.allocRaw, 0n) !== totalAllocRaw) pools = pools.map(row => ({ ...row, percent: null }));
    }
  }
  let pair: ProtocolPair | null = null, pairTokensRaw: bigint | null = null;
  if (candidate) {
    try {
      const pairAddress = address(candidate.address);
      const [token0, token1] = await Promise.all([
        call(pairAddress, PROTOCOL_READS.token0).then(address), call(pairAddress, PROTOCOL_READS.token1).then(address),
      ]);
      if (!([token0, token1].some(token => equal(token, CONTRACTS.degen)) && [token0, token1].some(token => equal(token, WPLS)))) throw new Error("Unmatched chart pair");
      pair = { address: pairAddress, baseSymbol: "DEGEN", quoteSymbol: "PLS" };
      pairTokensRaw = await amount(CONTRACTS.degen, PROTOCOL_READS.balance, [pairAddress]);
    } catch { /* An unverified trading pair does not contribute a supply segment. */ }
  }
  const elapsedBlocks = earlier && earlier.number === earlierNumber ? head.number - earlier.number : 0;
  const elapsedSeconds = earlier ? head.timestamp - earlier.timestamp : 0;
  const blockSeconds = elapsedBlocks > 0 && elapsedSeconds > 0 ? elapsedSeconds / elapsedBlocks : null;
  const allocationsValid = pools !== null && pools.every(row => row.percent !== null);
  const miners = await Promise.all([...MINER_POOLS].sort((a, b) => a.duration - b.duration).map(async pool => {
    const [accountingRaw, sharesRaw, issuedRaw, masterchef, pid] = await Promise.all([
      amount(pool.address, PROTOCOL_READS.accounting), amount(pool.address, PROTOCOL_READS.shares),
      amount(CONTRACTS.degen, PROTOCOL_READS.balance, [pool.address]),
      call(pool.address, PROTOCOL_READS.masterchef).then(address).catch(() => null),
      call(pool.address, PROTOCOL_READS.poolId).then(value => count(value, 99)).catch(() => null),
    ]);
    const registered = allocationsValid ? pools?.find(row => row.id === pid && equal(row.address, pool.address)) : null;
    const estimate = masterchef && equal(masterchef, A.masterChef) && registered && start !== null
      ? minerEmissionEstimate(accountingRaw, rewardPerBlockRaw, registered.allocRaw, totalAllocRaw, elapsedBlocks, elapsedSeconds, BigInt(head.number) > start)
      : { dailyRaw: null, apr: null };
    return { ...pool, accountingRaw, sharesRaw, issuedRaw, dailyRewardsRaw: estimate.dailyRaw, apr: estimate.apr, weightPercent: null as number | null };
  }));
  const minerAccountingRaw = total(miners.map(row => row.accountingRaw)), minerSharesRaw = total(miners.map(row => row.sharesRaw));
  for (const miner of miners) if (miner.accountingRaw !== null && minerAccountingRaw !== null) miner.weightPercent = protocolPercent(miner.accountingRaw, minerAccountingRaw);
  const minerTokensRaw = total(miners.map(row => row.issuedRaw));
  const otherRaw = totalRaw !== null && minerTokensRaw !== null && pairTokensRaw !== null && minerTokensRaw + pairTokensRaw <= totalRaw
    ? totalRaw - minerTokensRaw - pairTokensRaw : null;
  const finalBlock = validBlock(await bounded(() => reader.block(head.number)));
  if (finalBlock.number !== head.number || finalBlock.hash.toLowerCase() !== head.hash.toLowerCase()) throw new Error("Protocol snapshot changed while loading");
  return { block: head.number, timestamp: head.timestamp, hash: head.hash, pools, totalAllocRaw, rewardPerBlockRaw,
    miners, minerAccountingRaw, minerSharesRaw, votingBaseRaw, supply: { totalRaw, minerTokensRaw, pairTokensRaw, otherRaw },
    stats: { registeredPools, allocatedPools: pools ? pools.filter(row => row.allocRaw > 0n).length : null,
      nftPools: pools ? pools.filter(row => equal(row.address, CONTRACTS.nft) || REWARD_POOL_NAMES.some(metadata => metadata.id === row.id && equal(metadata.participant, row.address) && /NFT Miner/.test(metadata.name))).length : null,
      governorProposals, senators: null }, blockSeconds, pair, virtualSupplyRaw, governorTokensRaw, treasuryTokensRaw };
}

/** Select a market candidate only; on-chain pair token identities are checked before use. */
export function protocolPairFromMarkets(value: unknown): ProtocolPair | null {
  if (!Array.isArray(value)) return null;
  const candidates = value.filter((item): item is { chainId: string; pairAddress: string; baseToken: { address: string }; quoteToken: { address: string }; liquidity?: { usd?: number } } => {
    if (!item || typeof item !== "object" || item.chainId !== "pulsechain" || !isAddress(item.pairAddress ?? "")) return false;
    const tokens = [item.baseToken?.address, item.quoteToken?.address];
    return tokens.every(token => typeof token === "string" && isAddress(token)) && tokens.some(token => equal(token, CONTRACTS.degen)) && tokens.some(token => equal(token, WPLS));
  }).sort((a, b) => (Number(b.liquidity?.usd) || 0) - (Number(a.liquidity?.usd) || 0));
  return candidates[0] ? { address: candidates[0].pairAddress, baseSymbol: "DEGEN", quoteSymbol: "PLS" } : null;
}
export async function readPublicProtocolOverview(): Promise<ProtocolOverviewSnapshot> {
  const provider = await getPublicProvider();
  if (BigInt(await provider.send("eth_chainId", [])) !== 369n) throw new Error("Wrong chain");
  return readProtocolOverview({
    block: async tag => {
      const block = await provider.getBlock(tag);
      if (!block?.hash) throw new Error("Protocol block unavailable");
      return { number: block.number, timestamp: block.timestamp, hash: block.hash };
    },
    call: (target, signature, args, block) => {
      const contract = new Contract(target, [signature], provider);
      const method = contract.interface.fragments[0];
      return contract.getFunction(method.format("sighash"))(...args, { blockTag: block });
    },
    pair: async () => {
      const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 6_000);
      try {
        const response = await fetch(`https://api.dexscreener.com/tokens/v1/pulsechain/${CONTRACTS.degen}`, { signal: controller.signal });
        if (!response.ok) throw new Error("Chart pair unavailable");
        return protocolPairFromMarkets(await response.json());
      } finally { clearTimeout(timer); }
    },
  });
}
