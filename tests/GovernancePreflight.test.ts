import { afterEach, describe, expect, it, vi } from "vitest";
import { readGovernanceFormContext, readProposalAsset } from "../src/features/governance/formContext";
import { runProposalPreflight } from "../src/features/governance/proposalPreflight";
import { CREDIT_UNIT as U, GOVERNANCE_ADDRESSES as A, GOVERNANCE_MODULE_IDS } from "../src/features/governance/governanceSpec";
import { snapshotAgeLabel } from "../src/features/governance/SnapshotAge";
import { withGovernanceReadDeadline } from "../src/features/governance/readDeadline";
import { ACCOUNT, TOKEN, contextFixture, draftFixture, readerFixture } from "./governanceFixtures";

afterEach(() => vi.useRealTimers());
describe("same-block governance form context", () => {
  it.each(GOVERNANCE_MODULE_IDS)("reads %s credit and all dependencies at one block", async module => {
    const reader = readerFixture();
    const context = await readGovernanceFormContext(module, ACCOUNT, reader);
    expect(context).toMatchObject({ account: ACCOUNT, block: 42, cost: U, credit: 10000n * U, baseDelay: 43200n });
    const reads = vi.mocked(reader.read).mock.calls;
    expect(reads.every(call => call[4] === 42)).toBe(true);
    expect(reads.find(call => call[2] === "userCredit")).toMatchObject({ 0: A.credit, 3: [ACCOUNT] });
    expect(reads.some(call => call[2] === "deductingContract")).toBe(true);
    if (module === "allocation") expect(context.pools).toEqual([{ id: 4n, participant: TOKEN, allocation: 200n }]);
  });
  it("does not replace a disconnected or failed balance with zero", async () => {
    const reader = readerFixture();
    expect((await readGovernanceFormContext("tax", undefined, reader)).credit).toBeUndefined();
    expect(vi.mocked(reader.read).mock.calls.some(call => call[2] === "userCredit")).toBe(false);
    const original = reader.read;
    reader.read = vi.fn((...args) => args[2] === "userCredit" ? Promise.reject(new Error("Credit RPC offline")) : original(...args));
    await expect(readGovernanceFormContext("tax", ACCOUNT, reader)).rejects.toThrow(/offline/);
  });
  it.each(["creditContract", "owner", "governor", "farmContract", "token", "masterchef", "masterchefAddress"])("fails closed when %s changes", async getter => {
    const reader = readerFixture(), original = reader.read;
    reader.read = vi.fn((...args) => args[2] === getter ? Promise.resolve(TOKEN) : original(...args));
    await expect(readGovernanceFormContext("allocation", ACCOUNT, reader)).rejects.toThrow(/changed/);
  });
  it("rejects wrong RPC chain, missing latest block and unauthorized credit deductor", async () => {
    await expect(readGovernanceFormContext("tax", ACCOUNT, readerFixture({ chainId: async () => 1n }))).rejects.toThrow(/PulseChain/);
    await expect(readGovernanceFormContext("tax", ACCOUNT, readerFixture({ latestBlock: async () => null }))).rejects.toThrow(/unavailable/);
    await expect(readGovernanceFormContext("tax", ACCOUNT, readerFixture({ latestBlock: async () => ({ number: 42, timestamp: NaN }) }))).rejects.toThrow(/unavailable/);
    const reader = readerFixture(), original = reader.read;
    reader.read = vi.fn((...args) => args[2] === "deductingContract" ? Promise.resolve(false) : original(...args));
    await expect(readGovernanceFormContext("tax", ACCOUNT, reader)).rejects.toThrow(/authorized/);
  });
  it("checks code and decimals, keeps symbol optional, and marks eligibility provenance", async () => {
    const reader = readerFixture(), original = reader.read;
    reader.read = vi.fn((...args) => args[2] === "symbol" ? Promise.reject(new Error("No symbol")) : original(...args));
    expect(await readProposalAsset(TOKEN, contextFixture(), "newtoken", reader)).toMatchObject({ module: "newtoken", decimals: 6, symbol: "TOKEN", existingPool: false, block: 42 });
    expect(vi.mocked(reader.code).mock.calls[0]).toEqual([TOKEN, 42]);
    await expect(readProposalAsset(TOKEN, contextFixture(), "treasury", readerFixture({ code: async () => "0x" }))).rejects.toThrow(/no deployed/);
    reader.read = vi.fn((...args) => args[2] === "decimals" ? Promise.reject(new Error("No decimals")) : original(...args));
    await expect(readProposalAsset(TOKEN, contextFixture(), "treasury", reader)).rejects.toThrow(/No decimals/);
  });
  it.each(["0x0000000000000000000000000000000000000000", "0x0000000000000000000000000000000000001010"])("resolves native alias %s only for Treasury", async address => {
    const reader = readerFixture();
    expect(await readProposalAsset(address, contextFixture(), "treasury", reader)).toMatchObject({ decimals: 18, symbol: "PLS", module: "treasury" });
    expect(reader.read).not.toHaveBeenCalled();
    await expect(readProposalAsset(address, contextFixture(), "newtoken", reader)).rejects.toThrow();
  });
});

describe("read-only creation preflight", () => {
  it.each(GOVERNANCE_MODULE_IDS)("simulates %s exact creation bytes with from, value zero, and pinned block", async module => {
    const reader = readerFixture();
    const result = await runProposalPreflight(module, draftFixture(module === "delay" ? { value: "24" } : {}), ACCOUNT, 369n, reader);
    expect(result.validation.errors).toEqual({});
    expect(result.simulation?.status).toBe("passed");
    expect(reader.simulate).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ action: "create", value: 0n, chainId: 369n }), ACCOUNT, 42);
  });
  it("does not simulate on wrong network, invalid fields, insufficient credit or changed identity", async () => {
    const reader = readerFixture();
    await expect(runProposalPreflight("tax", draftFixture(), ACCOUNT, 1n, reader)).rejects.toThrow(/Select PulseChain/);
    expect((await runProposalPreflight("tax", draftFixture({ value: "11" }), ACCOUNT, 369n, reader)).validation.errors.value).toBeTruthy();
    expect((await runProposalPreflight("tax", draftFixture({ commitment: "10001" }), ACCOUNT, 369n, reader)).validation.errors.commitment).toBeTruthy();
    expect(reader.simulate).not.toHaveBeenCalled();
  });
  it("blocks a stale node even if loading just finished and blocks slow simulations", async () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date("2026-09-05T12:00:00Z"));
    const reader = readerFixture({ latestBlock: async () => ({ number: 42, timestamp: Math.floor(Date.now() / 1000) - 121 }) });
    const stale = await runProposalPreflight("tax", draftFixture(), ACCOUNT, 369n, reader);
    expect(stale.simulation).toMatchObject({ status: "failed", message: expect.stringContaining("stale") });
    expect(reader.simulate).not.toHaveBeenCalled();
    const slow = readerFixture({ simulate: vi.fn(async () => { vi.setSystemTime(Date.now() + 121_000); return "0x"; }) });
    expect((await runProposalPreflight("tax", draftFixture(), ACCOUNT, 369n, slow)).simulation).toMatchObject({ status: "failed", message: expect.stringContaining("expired") });
  });
  it("fails closed on no contract code, unexpected return bytes and revert", async () => {
    const missing = readerFixture({ code: async () => "0x" });
    expect((await runProposalPreflight("tax", draftFixture(), ACCOUNT, 369n, missing)).simulation?.status).toBe("failed");
    expect(missing.simulate).not.toHaveBeenCalled();
    for (const simulate of [async () => "0x01", async () => { throw new Error("execution reverted"); }]) {
      expect((await runProposalPreflight("tax", draftFixture(), ACCOUNT, 369n, readerFixture({ simulate }))).simulation?.status).toBe("failed");
    }
  });
  it("handles token verification failure without preparing or simulating a call", async () => {
    const reader = readerFixture({ code: async () => "0x" });
    const result = await runProposalPreflight("treasury", draftFixture(), ACCOUNT, 369n, reader);
    expect(result.validation.errors.tokenAddress).toMatch(/no deployed/);
    expect(result.validation.call).toBeUndefined(); expect(reader.simulate).not.toHaveBeenCalled();
  });
  it("labels snapshot age without inventing freshness from load time", () => {
    expect(snapshotAgeLabel(100, 100_000)).toMatch(/under 2/);
    expect(snapshotAgeLabel(100, 220_001)).toMatch(/Stale/);
    expect(snapshotAgeLabel(131, 100_000)).toMatch(/clock mismatch/);
  });
  it("bounds UI waiting and does not publish a late response after timeout", async () => {
    vi.useFakeTimers();
    let resolve!: (value: string) => void;
    const pending = new Promise<string>(done => { resolve = done; });
    const outcome = withGovernanceReadDeadline(pending, 100).then(value => value, error => error.message);
    await vi.advanceTimersByTimeAsync(101);
    expect(await outcome).toMatch(/timed out/);
    resolve("too late");
    expect(await outcome).toMatch(/timed out/);
    expect(await withGovernanceReadDeadline(Promise.resolve("ready"))).toBe("ready");
    expect(vi.getTimerCount()).toBe(0);
  });
});
