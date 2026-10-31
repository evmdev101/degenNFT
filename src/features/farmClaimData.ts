import { getAddress } from "ethers";
export type FarmClaimSnapshot = {
  helperRaw: bigint; totalRaw: bigint;
  farms: { address: string; stakeIds: bigint[]; pendingRaw: bigint }[];
};
export type FarmClaimReader = {
  helperBalance: (account: string) => Promise<bigint>;
  stakeCount: (vault: string, account: string) => Promise<bigint>;
  pendingRewards: (vault: string, account: string) => Promise<bigint>;
};
const uint = (value: bigint) => {
  if (typeof value !== "bigint" || value < 0n) throw new Error("Farm rewards could not be verified.");
  return value;
};
/** Discovery snapshot, not an authorization or exact post-funding-fee harvest quote. */
export async function readFarmClaimSnapshot(account: string, vaultAddresses: readonly string[], reader: FarmClaimReader): Promise<FarmClaimSnapshot> {
  account = getAddress(account);
  const addresses = [...new Map(vaultAddresses.map(address => [address.toLowerCase(), getAddress(address)])).values()];
  const helperRaw = uint(await reader.helperBalance(account));
  const farms: FarmClaimSnapshot["farms"] = [];
  for (let start = 0; start < addresses.length; start += 4) {
    const batch = await Promise.all(addresses.slice(start, start + 4).map(async address => {
      const count = uint(await reader.stakeCount(address, account));
      if (count > 5000n) throw new Error("This farm's stake count exceeds the supported claim range.");
      if (count === 0n) return null;
      return { address, stakeIds: Array.from({ length: Number(count) }, (_, index) => BigInt(index)), pendingRaw: uint(await reader.pendingRewards(address, account)) };
    }));
    for (const farm of batch) if (farm) farms.push(farm);
  }
  return { helperRaw, farms, totalRaw: farms.reduce((sum, farm) => sum + farm.pendingRaw, helperRaw) };
}
