import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { Interface } from "ethers";
import type { SimulationReader } from "../src/features/governance/proposalPreflight";
import { ACCOUNT, readerFixture } from "./governanceFixtures";
import { GOVERNANCE_ADDRESSES as A, CREDIT_UNIT as U } from "../src/features/governance/governanceSpec";
import { submitGovernanceAction } from "../src/features/governance/governanceTransactions";
// Exercise the verified submission flow independently of the default local pause.
vi.mock("../src/config/publicPreview", () => ({ GOVERNANCE_ACTIONS_DISABLED: false, assertGovernanceActionsEnabled: () => undefined }));
const runtime = vi.hoisted(() => ({ reader: undefined as unknown as SimulationReader, sent: undefined as unknown as { to: string; data: string; value: bigint }, send: vi.fn(), receipt: undefined as unknown as object, transaction: vi.fn(), block: vi.fn() }));
vi.mock("../src/features/governance/proposalPreflight", async original => ({ ...await original<typeof import("../src/features/governance/proposalPreflight")>(), proposalSimulationReader: async () => runtime.reader }));
vi.mock("../src/lib/chain", async original => ({ ...await original<typeof import("../src/lib/chain")>(), getPublicProvider: async () => ({ getTransaction: runtime.transaction, getBlock: runtime.block }) }));
const hash = "0x" + "a".repeat(64), blockHash = "0x" + "b".repeat(64);
const iface = new Interface(["event AddVotes(uint256 indexed,uint256 indexed,address indexed,uint256,bool)"]);
const wallet = () => ({ address: ACCOUNT, chainId: 369n, getSigner: async () => ({ getAddress: async () => ACCOUNT, estimateGas: async () => 10000n, sendTransaction: runtime.send,
  provider: { getFeeData: async () => ({ gasPrice: 1n }), getBalance: async () => 10n ** 20n } }) } as unknown as Parameters<typeof submitGovernanceAction>[1]);
beforeEach(() => {
  const reader = readerFixture(); const fallback = reader.read;
  reader.latestBlock = vi.fn().mockResolvedValueOnce({ number: 42, timestamp: Math.floor(Date.now()/1000) }).mockResolvedValue({ number: 44, timestamp: Math.floor(Date.now()/1000) });
  reader.read = vi.fn(async (address, abi, method, args, block) => method === "proposalLengths" ? [1n, 1n, 1n, 1n] : method === "govTaxProposals" ? [true, BigInt(Math.floor(Date.now()/1000))-100n, 10n, block === 43 ? U/2n : 0n, 0n, 0n] : fallback(address, abi, method, args, block));
  runtime.reader = reader;
  const event = iface.encodeEventLog(iface.getEvent("AddVotes")!, [4n, 0n, ACCOUNT, U/2n, true]);
  runtime.receipt = { status: 1, hash, blockNumber: 43, blockHash, from: ACCOUNT, to: A.farms, logs: [{ address: A.farms, ...event }] };
  runtime.send.mockReset().mockImplementation(async transaction => { runtime.sent = transaction; return { hash, from: ACCOUNT, nonce: 0, wait: async () => runtime.receipt }; });
  runtime.transaction.mockReset().mockImplementation(async () => ({ ...runtime.sent, from: ACCOUNT, blockHash }));
  runtime.block.mockReset().mockResolvedValue({ hash: blockHash });
});
afterEach(() => vi.useRealTimers());
it("checks the latest head after estimating and verifies the exact mined vote", async () => {
  expect(await submitGovernanceAction({ module: "tax", action: "yes", proposalId: "0", credit: "0.5" }, wallet())).toMatchObject({ outcome: "voted", hash });
  expect(vi.mocked(runtime.reader.simulate).mock.calls.map(call => call[2])).toEqual([42, 44]);
  expect(runtime.send).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ chainId: 369n, value: 0n, gasLimit: 12000n }));
});
it("does not request a transaction if the latest-head simulation fails", async () => {
  vi.mocked(runtime.reader.simulate).mockResolvedValueOnce("0x").mockRejectedValueOnce(new Error("voting closed"));
  await expect(submitGovernanceAction({ module: "tax", action: "yes", proposalId: "0", credit: "0.5" }, wallet())).rejects.toThrow("voting closed");
  expect(runtime.send).not.toHaveBeenCalled();
});
it("uses a successful repricing replacement receipt instead of the old hash", async () => {
  const replacementHash = "0x" + "c".repeat(64);
  runtime.send.mockImplementationOnce(async transaction => { runtime.sent = transaction; return { hash, from: ACCOUNT, nonce: 0, wait: async () => { throw { code: "TRANSACTION_REPLACED", cancelled: false, receipt: { ...runtime.receipt, hash: replacementHash } }; } }; });
  expect(await submitGovernanceAction({ module: "tax", action: "yes", proposalId: "0", credit: "0.5" }, wallet())).toMatchObject({ outcome: "voted", hash: replacementHash });
  expect(runtime.transaction).toHaveBeenCalledExactlyOnceWith(replacementHash);
});
it("releases a timed-out read without allowing the late read to send", async () => {
  vi.useFakeTimers();
  let resolve!: (value: unknown) => void;
  const fallback = runtime.reader.read;
  runtime.reader.read = vi.fn((address, abi, method, args, block) => method === "govTaxProposals" ? new Promise(done => { resolve = done; }) : fallback(address, abi, method, args, block));
  const result = submitGovernanceAction({ module: "tax", action: "yes", proposalId: "0", credit: "0.5" }, wallet()).catch(error => error.message);
  await vi.advanceTimersByTimeAsync(60_001);
  expect(await result).toMatch(/timed out/);
  resolve([true, BigInt(Math.floor(Date.now()/1000))-100n, 10n, 0n, 0n, 0n]);
  await vi.advanceTimersByTimeAsync(0);
  expect(runtime.send).not.toHaveBeenCalled();
});
