import { Interface, toQuantity, zeroPadValue } from "ethers";
import { getPublicProvider } from "../../lib/chain";
import { GOVERNANCE_ADDRESSES } from "../governance/governanceSpec";
import { DASHBOARD_ASSETS, FARM_REGISTRY, MINER_POOLS, TREASURY } from "./config";

export const ACTIVITY_CATEGORIES = ["All", "Miners", "Farms", "Treasury", "Governance"] as const;
export type ActivityCategory = Exclude<typeof ACTIVITY_CATEGORIES[number], "All">;
export type ActivityFilter = typeof ACTIVITY_CATEGORIES[number];
export type ProtocolActivityRow = {
  key: string; hash: string; block: number; blockHash: string; index: number;
  category: ActivityCategory; label: string; address: string;
  raw?: bigint; symbol?: string; decimals?: number; timestamp: number;
};
export type ActivityAnchor = { head: number; headHash: string };
export type ProtocolActivityPage = ActivityAnchor & {
  from: number; to: number; timestamp: number; rows: ProtocolActivityRow[];
};
export type ActivityReadOptions = { end?: number; anchor?: ActivityAnchor; signal?: AbortSignal };
export type ActivityRpc = { send(method: string, params: unknown[]): Promise<unknown> };
export class ActivityAnchorChangedError extends Error {
  constructor() { super("Activity history changed"); }
}

// Event signatures checked against the explorer-verified miner, vault, and
// governance sources under reference-original/extracted/Governance*.sol.
export const MINER_ACTIVITY_EVENTS = new Interface([
  "event Deposit(address indexed sender,uint256 amount,uint256 shares,uint256 lastDepositedTime)",
  "event GiftDeposit(address indexed sender,address indexed recipient,uint256 amount,uint256 shares,uint256 lastDepositedTime)",
  "event AddAndExtendStake(address indexed sender,address indexed recipient,uint256 amount,uint256 stakeID,uint256 shares,uint256 lastDepositedTime)",
  "event Withdraw(address indexed sender,uint256 amount,uint256 penalty,uint256 shares)",
  "event TransferStake(address indexed sender,address indexed recipient,uint256 shares,uint256 stakeID)",
  "event HopPool(address indexed sender,uint256 DTXamount,uint256 shares,address indexed newPool)",
  "event MigrateStake(address indexed goodSamaritan,uint256 DTXamount,uint256 shares,address indexed recipient)",
  "event HopDeposit(address indexed recipient,uint256 amount,uint256 shares,uint256 previousLastDepositedTime,uint256 mandatoryTime)",
]);
export const FARM_ACTIVITY_EVENTS = new Interface([
  "event Deposit(address indexed sender,uint256 amount,uint256 debt,uint256 depositFee,address indexed referral)",
  "event Withdraw(address indexed sender,uint256 stakeID,uint256 harvestAmount)",
  "event SelfHarvest(address indexed user,uint256 harvestAmount)",
]);
export const TRANSFER_ACTIVITY_EVENT = new Interface(["event Transfer(address indexed from,address indexed to,uint256 value)"]);
export const GOVERNANCE_ACTIVITY_EVENTS = {
  farms: new Interface([
    "event InitiateFarmProposal(uint256 indexed proposalID,uint256 depositingTokens,uint256 indexed poolid,uint256 newAllocation,uint16 depositFee,address indexed enforcer,uint256 delay)",
    "event ProposeGovTax(uint256 indexed proposalID,uint256 valueSacrificedForVote,uint256 proposedTax,address indexed enforcer,uint256 delay)",
    "event ProposeGovernorTransfer(uint256 indexed proposalID,uint256 valueSacrificedForVote,uint256 proposedAmount,address indexed enforcer,bool isBurn,uint256 startTimestamp,uint256 delay)",
    "event ProposeVault(uint256 indexed proposalID,uint256 valueSacrificedForVote,uint256 indexed _type,uint256 _amount,address indexed enforcer,uint256 delay)",
    "event AddVotes(uint256 indexed _type,uint256 indexed proposalID,address indexed voter,uint256 tokensSacrificed,bool _for)",
    "event EnforceProposal(uint256 indexed _type,uint256 indexed proposalID,address indexed enforcer,bool isSuccess)",
  ]),
  basic: new Interface([
    "event InitiateRolloverBonus(uint256 indexed proposalID,uint256 depositingTokens,address indexed forPool,uint256 newBonus,address indexed enforcer,uint256 delay)",
    "event ProposeNewPool(uint256 indexed proposalID,uint256 valueSacrificedForVote,address newPool,address indexed enforcer,uint256 delay)",
    "event ProposeMinDeposit(uint256 indexed proposalID,uint256 valueSacrificedForVote,uint256 proposedMinDeposit,address indexed enforcer,uint256 delay)",
    "event DelayBeforeEnforce(uint256 indexed proposalID,uint256 valueSacrificedForVote,uint256 proposedMinDeposit,address indexed enforcer,uint256 delay)",
    "event InitiateSetCallFee(uint256 indexed proposalID,uint256 depositingTokens,uint256 newCallFee,address indexed enforcer,uint256 delay)",
    "event AddVotes(uint256 _type,uint256 indexed proposalID,address indexed voter,uint256 tokensSacrificed,bool _for)",
    "event EnforceProposal(uint256 _type,uint256 indexed proposalID,address indexed enforcer,bool isSuccess)",
  ]),
  treasury: new Interface([
    "event TreasuryProposal(uint256 indexed proposalID,uint256 sacrificedTokens,address tokenAddress,address recipient,uint256 amount,uint256 consensusVoteID,address indexed enforcer,uint256 delay)",
    "event AddVotes(uint256 _type,uint256 proposalID,address indexed voter,uint256 tokensSacrificed,bool _for)",
    "event TreasuryEnforce(uint256 indexed proposalID,address indexed enforcer,bool isSuccess)",
  ]),
  governor: new Interface([
    "event EnforceGovernor(address indexed _newGovernor,address indexed enforcer)",
    "event GiveRolloverBonus(address indexed recipient,uint256 amount,address indexed poolInto)",
  ]),
} as const;
const governance = Object.entries(GOVERNANCE_ACTIVITY_EVENTS).map(([key, iface]) => ({
  address: GOVERNANCE_ADDRESSES[key as keyof typeof GOVERNANCE_ACTIVITY_EVENTS], iface,
}));
const miners = new Map(MINER_POOLS.map(pool => [pool.address.toLowerCase(), pool]));
const farms = new Map(FARM_REGISTRY.map(farm => [farm.address.toLowerCase(), farm]));
const assets = new Map(DASHBOARD_ASSETS.filter(asset => !asset.native).map(asset => [asset.address.toLowerCase(), asset]));
const HASH = /^0x[0-9a-f]{64}$/i;
type RpcBlock = { number: string; hash: string; timestamp: string };
type RpcLog = { address: string; topics: string[]; data: string; transactionHash: string; blockNumber: string; blockHash: string; logIndex: string; removed?: boolean };
function unsignedNumber(value: unknown) {
  if (typeof value !== "string" || !/^0x[0-9a-f]+$/i.test(value)) throw new Error("Invalid activity record");
  const number = Number(BigInt(value));
  if (!Number.isSafeInteger(number) || number < 0) throw new Error("Invalid activity record");
  return number;
}
function asBlock(value: unknown, expected?: number): RpcBlock {
  const block = value as RpcBlock | null;
  if (!block || !HASH.test(block.hash ?? "") || unsignedNumber(block.timestamp) <= 0
    || (expected !== undefined && unsignedNumber(block.number) !== expected)) throw new Error("Activity block unavailable");
  unsignedNumber(block.number);
  return block;
}
const topicsFor = (iface: Interface) => iface.fragments.filter(fragment => fragment.type === "event")
  .map(fragment => iface.getEvent(fragment.format("sighash"))!.topicHash);

/** Only known event signatures from their pinned DEGEN contract are decoded. */
export function decodeProtocolActivity(log: RpcLog): Omit<ProtocolActivityRow, "timestamp"> | null {
  if (log.removed) return null;
  const address = log.address.toLowerCase(), miner = miners.get(address), farm = farms.get(address), asset = assets.get(address);
  let category: ActivityCategory, label: string, raw: bigint | undefined, symbol: string | undefined, decimals: number | undefined;
  try {
    if (miner) {
      const event = MINER_ACTIVITY_EVENTS.parseLog(log);
      if (!event) return null;
      const labels: Record<string, string> = { Deposit: "Miner deployed", GiftDeposit: "Miner gifted", Withdraw: "Miner ended",
        TransferStake: "Miner transferred", HopPool: "Miner upgraded", HopDeposit: "Miner received", MigrateStake: "Miner migrated", AddAndExtendStake: "Miner extended" };
      label = `${miner.label} · ${labels[event.name]}`; category = "Miners";
      raw = event.args.amount ?? event.args.DTXamount ?? event.args.shares;
      symbol = event.name === "TransferStake" ? "shares" : "DEGEN"; decimals = 18;
    } else if (farm) {
      const event = FARM_ACTIVITY_EVENTS.parseLog(log);
      if (!event) return null;
      category = "Farms";
      label = `${farm.name} · ${event.name === "Deposit" ? "Position opened" : event.name === "Withdraw" ? "Position withdrawn" : "Rewards claimed"}`;
      raw = event.name === "Deposit" ? event.args.amount : event.args.harvestAmount;
      symbol = event.name === "Deposit" ? (farm.name.endsWith(" LP") ? "LP" : farm.tokens[0]) : "DEGEN rewards";
      decimals = event.name === "Deposit" ? farm.decimals : 18;
    } else if (asset) {
      const event = TRANSFER_ACTIVITY_EVENT.parseLog(log);
      if (!event || !event.args.value) return null;
      const incoming = String(event.args.to).toLowerCase() === TREASURY.toLowerCase();
      const outgoing = String(event.args.from).toLowerCase() === TREASURY.toLowerCase();
      if ((!incoming && !outgoing) || (incoming && outgoing)) return null;
      category = "Treasury"; label = incoming ? "Treasury received" : "Treasury sent";
      raw = event.args.value; symbol = asset.symbol; decimals = asset.decimals;
    } else {
      const target = governance.find(item => item.address.toLowerCase() === address);
      const event = target?.iface.parseLog(log);
      if (!event) return null;
      category = "Governance";
      const labels: Record<string, string> = { InitiateFarmProposal: "Farm allocation proposed", ProposeGovTax: "Transaction tax proposed",
        ProposeGovernorTransfer: "Emissions change proposed", ProposeVault: "Farm fees proposed", InitiateRolloverBonus: "Rollover bonus proposed",
        ProposeNewPool: "New pool proposed", ProposeMinDeposit: "Voting cost proposed", DelayBeforeEnforce: "Voting delay proposed",
        InitiateSetCallFee: "Harvest fee proposed", TreasuryProposal: "Treasury transfer proposed", EnforceGovernor: "Governor changed",
        GiveRolloverBonus: "Rollover bonus received" };
      label = event.name === "AddVotes" ? `Vote ${event.args._for ? "for" : "against"} proposal #${event.args.proposalID}`
        : event.name === "EnforceProposal" || event.name === "TreasuryEnforce"
          ? `Proposal #${event.args.proposalID} · ${event.args.isSuccess ? "Executed" : "Rejected"}`
          : `${labels[event.name]}${event.args.proposalID !== undefined ? ` #${event.args.proposalID}` : ""}`;
      if (event.name === "GiveRolloverBonus") { raw = event.args.amount; symbol = "DEGEN"; decimals = 18; }
    }
    if (raw !== undefined && (typeof raw !== "bigint" || raw < 0n)) return null;
    return { key: `${log.transactionHash.toLowerCase()}:${unsignedNumber(log.logIndex)}`, hash: log.transactionHash,
      block: unsignedNumber(log.blockNumber), blockHash: log.blockHash, index: unsignedNumber(log.logIndex), address: log.address,
      category, label, raw, symbol, decimals };
  } catch { return null; }
}

export function mergeProtocolActivity(...groups: readonly ProtocolActivityRow[][]) {
  const rows = new Map<string, ProtocolActivityRow>();
  for (const row of groups.flat()) {
    const previous = rows.get(row.key);
    if (previous && (previous.blockHash.toLowerCase() !== row.blockHash.toLowerCase() || previous.raw !== row.raw
      || previous.label !== row.label || previous.address.toLowerCase() !== row.address.toLowerCase())) throw new ActivityAnchorChangedError();
    rows.set(row.key, row);
  }
  return [...rows.values()].sort((a, b) => b.block - a.block || b.index - a.index);
}

/** Read one complete, bounded block page. A failed category never becomes an empty feed. */
export async function readProtocolActivity(rpc: ActivityRpc, options: ActivityReadOptions = {}): Promise<ProtocolActivityPage> {
  const deadline = Date.now() + 40_000, { signal } = options;
  const send = async (method: string, params: unknown[]) => {
    signal?.throwIfAborted();
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw new Error("Activity read budget expired");
    let timer: ReturnType<typeof setTimeout> | undefined, abort: (() => void) | undefined;
    try {
      return await Promise.race([rpc.send(method, params), new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("Activity read timed out")), Math.min(12_000, remaining));
        abort = () => reject(signal?.reason ?? new Error("Activity read cancelled"));
        signal?.addEventListener("abort", abort, { once: true });
      })]);
    } finally { if (timer) clearTimeout(timer); if (abort) signal?.removeEventListener("abort", abort); signal?.throwIfAborted(); }
  };
  const blockAt = async (number: number) => asBlock(await send("eth_getBlockByNumber", [toQuantity(number), false]), number);
  if (BigInt(await send("eth_chainId", []) as string) !== 369n) throw new Error("Wrong chain");
  const latest = asBlock(await send("eth_getBlockByNumber", ["latest", false]));
  const head = unsignedNumber(latest.number), timestamp = unsignedNumber(latest.timestamp);
  if (Date.now() / 1000 - timestamp > 120 || timestamp > Date.now() / 1000 + 30) throw new Error("Current activity block unavailable");
  const { anchor } = options;
  if (anchor && (!Number.isSafeInteger(anchor.head) || anchor.head < 0 || anchor.head > head || !HASH.test(anchor.headHash)
    || (await blockAt(anchor.head)).hash.toLowerCase() !== anchor.headHash.toLowerCase())) throw new ActivityAnchorChangedError();
  const to = options.end ?? head;
  if (!Number.isSafeInteger(to) || to < 0 || to > head || (anchor && options.end !== undefined && to >= anchor.head)) throw new Error("Invalid activity range");
  const from = Math.max(0, to - 24_999), endBlock = to === head ? latest : await blockAt(to);
  const transferTopic = TRANSFER_ACTIVITY_EVENT.getEvent("Transfer")!.topicHash;
  const governanceTopics = [...new Set(Object.values(GOVERNANCE_ACTIVITY_EVENTS).flatMap(topicsFor))];
  const filters = [
    { address: MINER_POOLS.map(pool => pool.address), topics: [topicsFor(MINER_ACTIVITY_EVENTS)] },
    { address: FARM_REGISTRY.map(farm => farm.address), topics: [topicsFor(FARM_ACTIVITY_EVENTS)] },
    { address: governance.map(item => item.address), topics: [governanceTopics] },
    { address: [...assets.values()].map(asset => asset.address), topics: [transferTopic, null, zeroPadValue(TREASURY, 32)] },
    { address: [...assets.values()].map(asset => asset.address), topics: [transferTopic, zeroPadValue(TREASURY, 32)] },
  ];
  // PublicNode accepts at most ten addresses in one event query. Splitting the
  // farm list also prevents one rejected query from invalidating an RPC batch.
  const queries = filters.flatMap(filter => Array.from({ length: Math.ceil(filter.address.length / 10) }, (_, index) => ({
    ...filter, address: filter.address.slice(index * 10, index * 10 + 10),
  })));
  const responses = await Promise.all(queries.map(async filter => {
    const result = await send("eth_getLogs", [{ ...filter, fromBlock: toQuantity(from), toBlock: toQuantity(to) }]);
    if (!Array.isArray(result) || result.length >= 1000) throw new Error("Activity response is incomplete");
    const allowed = new Set(filter.address.map(address => address.toLowerCase()));
    return result.flatMap(value => {
      const log = value as RpcLog;
      if (log?.removed) return [];
      if (!log || typeof log.address !== "string" || !allowed.has(log.address.toLowerCase()) || !Array.isArray(log.topics)
        || typeof log.data !== "string" || !HASH.test(log.transactionHash ?? "") || !HASH.test(log.blockHash ?? "")
        || unsignedNumber(log.blockNumber) < from || unsignedNumber(log.blockNumber) > to) throw new Error("Unexpected activity record");
      const row = decodeProtocolActivity(log);
      return row ? [row] : [];
    });
  }));
  const decoded = responses.flat();
  if (decoded.length > 3000) throw new Error("Activity response is incomplete");
  const blocks = new Map<number, RpcBlock>([[to, endBlock]]), numbers = [...new Set(decoded.map(row => row.block))];
  for (let index = 0; index < numbers.length; index += 6) await Promise.all(numbers.slice(index, index + 6).map(async number => {
    if (!blocks.has(number)) blocks.set(number, await blockAt(number));
  }));
  const rows = decoded.map(row => {
    const block = blocks.get(row.block)!;
    if (block.hash.toLowerCase() !== row.blockHash.toLowerCase() || unsignedNumber(block.timestamp) > timestamp) throw new ActivityAnchorChangedError();
    return { ...row, timestamp: unsignedNumber(block.timestamp) };
  });
  if ((await blockAt(to)).hash.toLowerCase() !== endBlock.hash.toLowerCase()
    || (anchor && (await blockAt(anchor.head)).hash.toLowerCase() !== anchor.headHash.toLowerCase())) throw new ActivityAnchorChangedError();
  return { from, to, head, headHash: latest.hash, timestamp, rows: mergeProtocolActivity(rows) };
}

export async function readPublicProtocolActivity(options: ActivityReadOptions = {}) {
  options.signal?.throwIfAborted();
  const provider = await getPublicProvider();
  options.signal?.throwIfAborted();
  return readProtocolActivity(provider, options);
}
