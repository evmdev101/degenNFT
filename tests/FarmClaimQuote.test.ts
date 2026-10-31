import { Interface, keccak256 } from "ethers";
import { describe, expect, it, vi } from "vitest";
import { FARM_QUOTE_MULTICALL, FARM_QUOTE_MULTICALL_ABI, FARM_QUOTE_RUNTIME_HASH, quoteFarmClaim } from "../src/features/farmClaimQuote";
import deployment from "./fixtures/farmClaimMulticall.json";

const ACCOUNT = "0x1111111111111111111111111111111111111111";
const HELPER = "0x2222222222222222222222222222222222222222";
const FARM_A = "0x3333333333333333333333333333333333333333";
const FARM_B = "0x4444444444444444444444444444444444444444";
const aggregate = new Interface(FARM_QUOTE_MULTICALL_ABI);
const harvest = new Interface(["function selfHarvest(address user,uint256[] stakeIds)"]);
const credit = new Interface(["function balanceOf(address) view returns(uint256)"]);
const encodedBalance = (value: bigint) => credit.encodeFunctionResult("balanceOf", [value]);
const response = (value: bigint) => aggregate.encodeFunctionResult("aggregate3", [[
  { success: true, returnData: "0x" }, { success: true, returnData: "0x" },
  { success: true, returnData: encodedBalance(value) },
]]);
const farms = [{ address: FARM_A, stakeIds: [0n, 3n] }, { address: FARM_B, stakeIds: [0n] }];
function provider(result = response(372339510410000000000000001n)) {
  return { getCode: vi.fn(async () => deployment.runtime), send: vi.fn(async () => result) };
}

describe("read-only complete farm claim simulation", () => {
  it("pins the independently recorded PulseChain Multicall3 runtime", () => {
    expect(deployment.chainId).toBe(369);
    expect(deployment.isProxy).toBe(false);
    expect(deployment.address).toBe(FARM_QUOTE_MULTICALL);
    expect(keccak256(deployment.runtime)).toBe(FARM_QUOTE_RUNTIME_HASH);
  });
  it("harvests every supplied stake before reading the final helper balance in the same eth_call", async () => {
    const rpc = provider();
    const quoted = await quoteFarmClaim(rpc, ACCOUNT, HELPER, farms, 12345);
    expect(quoted).toBe(372339510410000000000000001n);
    expect(rpc.getCode).toHaveBeenCalledExactlyOnceWith(FARM_QUOTE_MULTICALL, 12345);
    expect(rpc.send).toHaveBeenCalledTimes(1);
    const [method, [transaction, block]] = rpc.send.mock.calls[0] as unknown as [string, [{ from: string; to: string; data: string; value: string }, string]];
    expect(method).toBe("eth_call");
    expect(block).toBe("0x3039");
    expect(transaction).toMatchObject({ from: ACCOUNT, to: FARM_QUOTE_MULTICALL, value: "0x0" });
    const calls = aggregate.decodeFunctionData("aggregate3", transaction.data)[0];
    expect(calls.map((call: readonly unknown[]) => call[0])).toEqual([FARM_A, FARM_B, HELPER]);
    expect(calls.every((call: readonly unknown[]) => call[1] === false)).toBe(true);
    expect(harvest.decodeFunctionData("selfHarvest", calls[0][2])).toMatchObject({ 0: ACCOUNT, 1: [0n, 3n] });
    expect(harvest.decodeFunctionData("selfHarvest", calls[1][2])).toMatchObject({ 0: ACCOUNT, 1: [0n] });
    expect(credit.decodeFunctionData("balanceOf", calls[2][2])[0]).toBe(ACCOUNT);
  });
  it("reads existing helper credit directly when no farm stakes are present", async () => {
    const rpc = provider(encodedBalance(24900136055361391n));
    await expect(quoteFarmClaim(rpc, ACCOUNT, HELPER, [], 42)).resolves.toBe(24900136055361391n);
    expect(rpc.getCode).not.toHaveBeenCalled();
    expect(rpc.send).toHaveBeenCalledExactlyOnceWith("eth_call", [{ from: ACCOUNT, to: HELPER, data: credit.encodeFunctionData("balanceOf", [ACCOUNT]), value: "0x0" }, "0x2a"]);
  });
  it("rejects changed or missing aggregator code before any simulated harvest", async () => {
    const rpc = provider(); rpc.getCode.mockResolvedValue("0x1234");
    await expect(quoteFarmClaim(rpc, ACCOUNT, HELPER, farms, 42)).rejects.toThrow("simulator is unavailable");
    expect(rpc.send).not.toHaveBeenCalled();
  });
  it("does not turn a reverted farm simulation into a partial or helper-only quote", async () => {
    const rpc = provider(); rpc.send.mockRejectedValue(new Error("Multicall3: call failed"));
    await expect(quoteFarmClaim(rpc, ACCOUNT, HELPER, farms, 42)).rejects.toThrow("complete farm claim could not be simulated");
    expect(rpc.send).toHaveBeenCalledTimes(1);
  });
  it.each([
    "0x",
    aggregate.encodeFunctionResult("aggregate3", [[{ success: true, returnData: encodedBalance(1n) }]]),
    aggregate.encodeFunctionResult("aggregate3", [[{ success: false, returnData: "0x" }, { success: true, returnData: "0x" }, { success: true, returnData: encodedBalance(1n) }]]),
    aggregate.encodeFunctionResult("aggregate3", [[{ success: true, returnData: encodedBalance(1n) }, { success: true, returnData: "0x" }, { success: true, returnData: encodedBalance(1n) }]]),
    aggregate.encodeFunctionResult("aggregate3", [[{ success: true, returnData: "0x" }, { success: true, returnData: "0x" }, { success: true, returnData: "0x" }]]),
  ])("rejects malformed, failed, missing or unexpected simulated outputs", async result => {
    await expect(quoteFarmClaim(provider(result), ACCOUNT, HELPER, farms, 42)).rejects.toThrow("quote could not be verified");
  });
  it("rejects duplicate farm or stake entries and invalid block snapshots", async () => {
    const rpc = provider();
    await expect(quoteFarmClaim(rpc, ACCOUNT, HELPER, [farms[0], farms[0]], 42)).rejects.toThrow("duplicate");
    await expect(quoteFarmClaim(rpc, ACCOUNT, HELPER, [{ address: FARM_A, stakeIds: [0n, 0n] }], 42)).rejects.toThrow("stake list");
    await expect(quoteFarmClaim(rpc, ACCOUNT, HELPER, farms, -1)).rejects.toThrow("snapshot");
    expect(rpc.getCode).not.toHaveBeenCalled(); expect(rpc.send).not.toHaveBeenCalled();
  });
});
