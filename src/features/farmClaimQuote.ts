import { Interface, ZeroAddress, getAddress, keccak256, toQuantity, type JsonRpcProvider } from "ethers";

// PulseChain deployment listed by the Multicall3 project and verified by the
// explorer. Observed at block 27,938,563; evidence is in the test fixture.
export const FARM_QUOTE_MULTICALL = "0xcA11bde05977b3631167028862bE2a173976CA11";
export const FARM_QUOTE_RUNTIME_HASH = "0xd5c15df687b16f2ff992fc8d767b4216323184a2bbc6ee2f9c398c318e770891";
export const FARM_QUOTE_MULTICALL_ABI = [
  "function aggregate3(tuple(address target,bool allowFailure,bytes callData)[] calls) payable returns(tuple(bool success,bytes returnData)[] returnData)",
] as const;
const multicall = new Interface(FARM_QUOTE_MULTICALL_ABI);
const vault = new Interface(["function selfHarvest(address user,uint256[] stakeIds)"]);
const helper = new Interface(["function balanceOf(address user) view returns(uint256)"]);
const MAX_UINT256 = (1n << 256n) - 1n;

export type FarmClaimQuoteFarm = { address: string; stakeIds: bigint[] };

function address(value: string): string {
  const normalized = getAddress(value);
  if (normalized === ZeroAddress) throw new Error("A farm claim address is unavailable.");
  return normalized;
}
function balanceResult(data: unknown): bigint {
  if (typeof data !== "string" || !/^0x[0-9a-f]{64}$/i.test(data)) throw new Error("The simulated claim balance could not be verified.");
  return helper.decodeFunctionResult("balanceOf", data)[0] as bigint;
}

/**
 * Read-only stateful quote. Calls temporarily harvest into the user's helper
 * balance inside one eth_call; the node discards every resulting state change.
 * The aggregator is never a signing or transaction target in this module.
 *
 * tokenVault.selfHarvest receives the beneficiary explicitly. Its harvest,
 * payFee and helper-mint paths do not depend on the caller being the wallet.
 */
export async function quoteFarmClaim(
  provider: Pick<JsonRpcProvider, "send" | "getCode">,
  account: string,
  helperAddress: string,
  farms: readonly FarmClaimQuoteFarm[],
  block: number,
): Promise<bigint> {
  if (!Number.isSafeInteger(block) || block < 0) throw new Error("The farm claim snapshot is unavailable.");
  const beneficiary = address(account), credit = address(helperAddress);
  const seen = new Set<string>();
  let totalStakes = 0;
  if (farms.length > 256) throw new Error("There are too many farms to quote in one claim.");
  const calls = farms.map(farm => {
    const target = address(farm.address), key = target.toLowerCase();
    if (seen.has(key) || target === credit || target === FARM_QUOTE_MULTICALL) throw new Error("The farm claim contains a duplicate or unsupported target.");
    seen.add(key);
    if (!farm.stakeIds.length || farm.stakeIds.some(id => typeof id !== "bigint" || id < 0n || id > MAX_UINT256)
      || new Set(farm.stakeIds.map(String)).size !== farm.stakeIds.length) throw new Error("The farm claim stake list could not be verified.");
    totalStakes += farm.stakeIds.length;
    if (totalStakes > 5000) throw new Error("There are too many stakes to quote in one claim.");
    return { target, allowFailure: false, callData: vault.encodeFunctionData("selfHarvest", [beneficiary, [...farm.stakeIds]]) };
  });
  const balanceCall = helper.encodeFunctionData("balanceOf", [beneficiary]);
  const tag = toQuantity(block);
  if (!calls.length) {
    return balanceResult(await provider.send("eth_call", [{ from: beneficiary, to: credit, data: balanceCall, value: "0x0" }, tag]));
  }
  const code = await provider.getCode(FARM_QUOTE_MULTICALL, block);
  if (!/^0x(?:[0-9a-f]{2})+$/i.test(code) || keccak256(code) !== FARM_QUOTE_RUNTIME_HASH) {
    throw new Error("The verified farm claim simulator is unavailable. No transaction was sent.");
  }
  calls.push({ target: credit, allowFailure: false, callData: balanceCall });
  let result: unknown;
  try {
    result = await provider.send("eth_call", [{
      from: beneficiary, to: FARM_QUOTE_MULTICALL,
      data: multicall.encodeFunctionData("aggregate3", [calls]), value: "0x0",
    }, tag]);
  } catch (cause) {
    throw new Error("The complete farm claim could not be simulated. No transaction was sent.", { cause });
  }
  try {
    if (typeof result !== "string") throw new Error("Invalid simulation response");
    const rows = multicall.decodeFunctionResult("aggregate3", result)[0];
    if (!Array.isArray(rows) || rows.length !== calls.length || rows.some(row => row[0] !== true)
      || rows.slice(0, -1).some(row => row[1] !== "0x")) throw new Error("Incomplete simulation response");
    return balanceResult(rows.at(-1)![1]);
  } catch (cause) {
    throw new Error("The complete farm claim quote could not be verified. No transaction was sent.", { cause });
  }
}
