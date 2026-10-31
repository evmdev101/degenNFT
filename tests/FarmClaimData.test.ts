import { getAddress } from "ethers";
import { describe, expect, it, vi } from "vitest";
import { readFarmClaimSnapshot } from "../src/features/farmClaimData";
const ACCOUNT = "0x1111111111111111111111111111111111111111";
const A = "0x" + "22".repeat(19) + "aa";
const B = "0x3333333333333333333333333333333333333333";
function reader() {
  return {
    helperBalance: vi.fn(async () => 24900136055361391n),
    stakeCount: vi.fn(async (vault: string) => vault.toLowerCase() === A.toLowerCase() ? 2n : 1n),
    pendingRewards: vi.fn(async (vault: string) => vault.toLowerCase() === A.toLowerCase() ? 2000000000000000001n : 5000000000000000000n),
  };
}
it("counts helper credit once and preserves all wei while deduplicating farm addresses", async () => {
  const read = reader();
  const snapshot = await readFarmClaimSnapshot(ACCOUNT, [A, B, A.toUpperCase().replace("0X", "0x")], read);
  expect(snapshot.helperRaw).toBe(24900136055361391n);
  expect(snapshot.totalRaw).toBe(7024900136055361392n);
  expect(snapshot.farms).toEqual([{ address: getAddress(A), stakeIds: [0n, 1n], pendingRaw: 2000000000000000001n }, { address: B, stakeIds: [0n], pendingRaw: 5000000000000000000n }]);
  expect(read.helperBalance).toHaveBeenCalledExactlyOnceWith(ACCOUNT);
  expect(read.pendingRewards).toHaveBeenCalledTimes(2);
});
it("does not turn an unreadable farm into a zero or a partial all-farms claim", async () => {
  const read = reader();
  read.stakeCount.mockRejectedValueOnce(new Error("RPC unavailable"));
  await expect(readFarmClaimSnapshot(ACCOUNT, [A, B], read)).rejects.toThrow();
});
it("fails closed when pending rewards cannot be checked", async () => {
  const read = reader();
  read.pendingRewards.mockRejectedValueOnce(new Error("RPC unavailable"));
  await expect(readFarmClaimSnapshot(ACCOUNT, [A, B], read)).rejects.toThrow();
});
it("skips reward reads for unstaked farms and still includes helper credit", async () => {
  const read = reader(); read.stakeCount.mockResolvedValue(0n);
  const snapshot = await readFarmClaimSnapshot(ACCOUNT, [A, B], read);
  expect(snapshot.totalRaw).toBe(24900136055361391n);
  expect(snapshot.farms).toEqual([]);
  expect(read.pendingRewards).not.toHaveBeenCalled();
});
it("refuses unsupported stake counts instead of omitting positions", async () => {
  const read = reader(); read.stakeCount.mockResolvedValue(5001n);
  await expect(readFarmClaimSnapshot(ACCOUNT, [A], read)).rejects.toThrow();
});
