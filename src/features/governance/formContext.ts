import { Contract, getAddress, isAddress, type JsonRpcProvider } from "ethers";
import { getPublicProvider } from "../../lib/chain";
import { GOVERNANCE_ADDRESSES as A, GOVERNANCE_CALLS, GOVERNANCE_CHAIN_ID, GOVERNANCE_CONTEXT_ABI, GOVERNANCE_CREDIT_ABI, GOVERNANCE_POOL_ABI, GOVERNANCE_ALLOCATION_ABI, GOVERNANCE_TOKEN_ABI, type GovernanceModule } from "./governanceSpec";
import { isNativeTreasuryToken } from "./treasury";

export type GovernanceFormContext = {
  account?: string; block: number; timestamp: number; loadedAt: number;
  cost: bigint; baseDelay: bigint; credit?: bigint; totalSupply?: bigint;
  poolCount?: bigint; totalPulseAllocation?: bigint;
  pools: { id: bigint; participant: string; allocation: bigint }[];
  rolloverPools: string[];
};
export type ProposalAsset = { address: string; block: number; module: GovernanceModule; decimals: number; symbol: string; existingPool: boolean };
export type FormContextReader = {
  chainId: () => Promise<bigint>;
  latestBlock: () => Promise<{ number: number; timestamp: number } | null>;
  read: (address: string, abi: readonly string[], method: string, args: readonly unknown[], block: number) => Promise<unknown>;
  code: (address: string, block: number) => Promise<string>;
};
const uint = (value: unknown) => {
  if (typeof value !== "bigint" || value < 0n) throw new Error("Invalid contract value");
  return value;
};

export async function readGovernanceFormContext(module: GovernanceModule, account: string | undefined, reader: FormContextReader): Promise<GovernanceFormContext> {
  if (await reader.chainId() !== GOVERNANCE_CHAIN_ID) throw new Error("The RPC is not connected to PulseChain");
  if (account && !isAddress(account)) throw new Error("Invalid wallet address");
  const block = await reader.latestBlock();
  if (!block || !Number.isSafeInteger(block.number) || block.number < 0 || !Number.isSafeInteger(block.timestamp) || block.timestamp < 0) throw new Error("Latest PulseChain block unavailable");
  const read = (address: string, abi: readonly string[], method: string, args: readonly unknown[] = []) => reader.read(address, abi, method, args, block.number);
  const targetName = GOVERNANCE_CALLS[module].target;
  const target = A[targetName];
  const governorTargetGetter = { farms: "farmContract", basic: "basicContract", treasury: "consensusContract" }[targetName];
  const identity = async (address: string, getter: string, expected: string) => {
    const value = await read(address, [`function ${getter}() view returns(address)`], getter);
    if (String(value).toLowerCase() !== expected.toLowerCase()) throw new Error(`Contract identity changed (${getter}); manual review required`);
  };
  await Promise.all([
    identity(A.token, "governor", A.governor), identity(target, "owner", A.governor),
    identity(target, "creditContract", A.credit), identity(target, "token", A.token),
    identity(A.governor, governorTargetGetter, target),
    read(A.credit, ["function deductingContract(address) view returns(bool)"], "deductingContract", [target]).then(value => {
      if (value !== true) throw new Error("Proposal contract is not an authorized credit deductor");
    }),
    ...(module === "allocation" || module === "newtoken" ? [
      identity(A.governor, "masterchef", A.masterChef), identity(A.token, "masterchefAddress", A.masterChef), identity(A.masterChef, "owner", A.governor),
      ...(module === "allocation" ? [identity(A.farms, "masterchef", A.masterChef)] : []),
    ] : []),
  ]);
  const [cost, delay, creditContract, credit] = await Promise.all([
    read(A.governor, GOVERNANCE_CONTEXT_ABI, "costToVote"), read(A.governor, GOVERNANCE_CONTEXT_ABI, "delayBeforeEnforce"),
    read(A.governor, GOVERNANCE_CONTEXT_ABI, "creditContract"),
    account ? read(A.credit, GOVERNANCE_CREDIT_ABI, "userCredit", [account]) : undefined,
  ]);
  if (String(creditContract).toLowerCase() !== A.credit.toLowerCase()) throw new Error("Governor voting-credit contract changed; review is required");
  const context: GovernanceFormContext = {
    account: account ? getAddress(account) : undefined, block: block.number, timestamp: block.timestamp,
    loadedAt: Date.now(), cost: uint(cost), baseDelay: uint(delay), credit: credit === undefined ? undefined : uint(credit), pools: [], rolloverPools: [],
  };
  if (module === "votecost") context.totalSupply = uint(await read(A.token, GOVERNANCE_TOKEN_ABI, "totalSupply"));
  if (module === "rollover") {
    context.rolloverPools = await Promise.all([1, 2, 3, 4].map(async index => getAddress(String(await read(A.governor, GOVERNANCE_CONTEXT_ABI, `acPool${index}`)))));
  }
  if (module === "allocation" || module === "newtoken") {
    context.poolCount = uint(await read(A.masterChef, GOVERNANCE_POOL_ABI, "poolLength"));
    if (context.poolCount > 500n) throw new Error("Pool count exceeds supported verification range");
  }
  if (module === "allocation") {
    context.totalPulseAllocation = uint(await read(A.farms, GOVERNANCE_ALLOCATION_ABI, "percentageAllocatedToPulseEcosystem"));
    for (let start = 4; start < Number(context.poolCount); start += 6) {
      const rows = await Promise.all(Array.from({ length: Math.min(6, Number(context.poolCount) - start) }, async (_, offset) => {
        const id = BigInt(start + offset);
        const [pool, allocation] = await Promise.all([
          read(A.masterChef, GOVERNANCE_POOL_ABI, "poolInfo", [id]), read(A.farms, GOVERNANCE_ALLOCATION_ABI, "poolAllocationPercentage", [id]),
        ]);
        if (!Array.isArray(pool) || !isAddress(String(pool[2]))) throw new Error("Unable to verify pool participant");
        return { id, participant: getAddress(String(pool[2])), allocation: uint(allocation) };
      }));
      context.pools.push(...rows);
    }
  }
  context.loadedAt = Date.now();
  return context;
}

export async function readProposalAsset(address: string, context: GovernanceFormContext, module: GovernanceModule, reader: FormContextReader): Promise<ProposalAsset> {
  if (!isAddress(address)) throw new Error("Enter a complete token contract address");
  address = getAddress(address);
  if (module === "treasury" && isNativeTreasuryToken(address)) return { address, block: context.block, module, decimals: 18, symbol: "PLS", existingPool: false };
  if (isNativeTreasuryToken(address) || await reader.code(address, context.block) === "0x") throw new Error("The token address has no deployed contract");
  const decimals = Number(uint(await reader.read(address, GOVERNANCE_TOKEN_ABI, "decimals", [], context.block)));
  if (decimals > 255) throw new Error("Invalid token precision");
  let symbol = "TOKEN";
  try { symbol = String(await reader.read(address, GOVERNANCE_TOKEN_ABI, "symbol", [], context.block)); } catch { /* Symbol is display-only. */ }
  const existingPool = module === "newtoken" ? await reader.read(A.masterChef, GOVERNANCE_POOL_ABI, "existingParticipant", [address], context.block) : false;
  if (typeof existingPool !== "boolean") throw new Error("Pool eligibility could not be verified");
  return { address, block: context.block, module, decimals, symbol, existingPool };
}

export async function governanceFormReader(sharedProvider?: JsonRpcProvider): Promise<FormContextReader> {
  const provider = sharedProvider ?? await getPublicProvider();
  const cache = new Map<string, Contract>();
  return {
    chainId: async () => BigInt(await provider.send("eth_chainId", [])),
    latestBlock: () => provider.getBlock("latest"),
    code: (address, block) => provider.getCode(address, block),
    read: (address, abi, method, args, block) => {
      const key = `${address}:${abi.join(";")}`;
      if (!cache.has(key)) cache.set(key, new Contract(address, abi, provider));
      return cache.get(key)!.getFunction(method)(...args, { blockTag: block });
    },
  };
}

export async function loadGovernanceFormContext(module: GovernanceModule, account?: string) {
  return readGovernanceFormContext(module, account, await governanceFormReader());
}
