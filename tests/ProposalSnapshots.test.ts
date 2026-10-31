import { describe, expect, it, vi } from "vitest";
import { readProposalSnapshot, snapshotProposalIds, SNAPSHOT_MODULES, SNAPSHOT_READ_BATCH, SNAPSHOT_PROPOSAL_LIMIT, type SnapshotModule, type SnapshotReader } from "../src/features/governance/proposalSnapshots";

const token = "0x0000000000000000000000000000000000000011";
const consensus = "0x0000000000000000000000000000000000000022";
const pool = "0x0000000000000000000000000000000000000033";
const offset = 10n ** 29n;
const tuples: Record<SnapshotModule, readonly unknown[]> = {
  allocation: [true, 21n, 15n, 20n * 10n ** 18n, 0n, 0n, 100n, 0n],
  rollover: [true, 100n, 20n, 0n, 0n, pool, 250n],
  tax: [true, 100n, 150n, 20n, 0n, 0n],
  emissions: [true, 100n, 123n, 20n, 0n, 0n, false, 1500n],
  treasury: [true, 100n, 20n, 0n, 0n, token, pool, 1250000n, 7n],
};

function mockReader(module: SnapshotModule, count = 2n) {
  const spec = SNAPSHOT_MODULES[module];
  const read = vi.fn<SnapshotReader["read"]>(async (_address, _abi, method, args, block) => {
    expect(block).toBe(42);
    if (method === "proposalLengths") {
      const counts = [87n, 89n, 91n, 93n];
      counts[spec.countIndex] = count;
      return counts;
    }
    if (method === "treasuryRequestsCount") return count;
    if (method === "delayBeforeEnforce") return 500n;
    if (method === spec.getter) return [args[0] === 0n, ...tuples[module].slice(1)];
    if (method === "getOinkConsensusContract") return consensus;
    if (method === "OFFSET") return offset;
    if (method === "totalDTXStaked") return 100n;
    if (method === "highestConsensusVotes") return args[0] === offset + 7n ? 20n : 0n;
    if (method === "decimals") return 6n;
    if (method === "symbol") return "USDC";
    throw new Error(`Unexpected ${method}`);
  });
  return { latestBlock: vi.fn(async () => ({ number: 42, timestamp: 1000 })), read };
}

describe("complete same-block governance snapshots", () => {
  it.each<SnapshotModule>(["allocation", "rollover", "tax", "emissions", "treasury"])("enumerates all %s IDs using the correct counter and one block", async module => {
    const reader = mockReader(module);
    const result = await readProposalSnapshot(module, reader);
    expect(result.count).toBe(2n);
    expect(result.block).toBe(42);
    expect(result.rows.map(row => row.id)).toEqual(["0", "1"]);
    expect(result.rows.map(row => row.value.status)).toEqual(["verified", "verified"]);
    expect(result.rows[1].value).toMatchObject({ lifecycle: "finished", observedAt: 1000 });
    expect(reader.read.mock.calls.filter(call => call[2] === SNAPSHOT_MODULES[module].getter).map(call => call[3])).toEqual([[0n], [1n]]);
    expect(reader.read.mock.calls.every(call => call[4] === 42)).toBe(true);
    if (module === "tax") expect(result.rows[0].value).toHaveProperty("executionBlockedReason");
    if (module === "emissions") expect(result.rows[0].value).toMatchObject({ proposal: { isEmissions: false }, executionBlockedReason: "Governor Transfer subtype is not an emissions update" });
  });

  it("pins and caches Treasury asset precision and consensus dependencies", async () => {
    const reader = mockReader("treasury");
    const result = await readProposalSnapshot("treasury", reader);
    expect(reader.read.mock.calls.filter(call => call[2] === "decimals")).toHaveLength(1);
    expect(reader.read.mock.calls.filter(call => call[2] === "symbol")).toHaveLength(1);
    expect(reader.read.mock.calls.filter(call => call[2] === "totalDTXStaked")).toHaveLength(1);
    expect(reader.read.mock.calls.filter(call => call[2] === "highestConsensusVotes").map(call => [call[0], ...call[3], call[4]])).toEqual([
      [consensus, offset + 7n, 42], [consensus, offset + 8n, 42],
      [consensus, offset + 7n, 42], [consensus, offset + 8n, 42],
    ]);
    expect(result.rows[0].value).toMatchObject({ asset: { decimals: 6, symbol: "USDC" }, consensus: { votesFor: 20n, votesAgainst: 0n, totalStaked: 100n } });
  });

  it.each(["0x0000000000000000000000000000000000000000", "0x0000000000000000000000000000000000001010"])("handles native alias %s without ERC20 metadata calls", async address => {
    const reader = mockReader("treasury", 1n);
    const original = reader.read.getMockImplementation()!;
    reader.read.mockImplementation(async (...args) => args[2] === "treasuryProposal" ? [...tuples.treasury.slice(0, 5), address, ...tuples.treasury.slice(6)] : original(...args));
    const result = await readProposalSnapshot("treasury", reader);
    expect(result.rows[0].value).toMatchObject({ asset: { address, symbol: "PLS", decimals: 18 } });
    expect(reader.read.mock.calls.some(call => ["symbol", "decimals"].includes(call[2]))).toBe(false);
  });

  it("tolerates missing symbols but never substitutes precision when decimals fail", async () => {
    const reader = mockReader("treasury", 1n);
    const original = reader.read.getMockImplementation()!;
    reader.read.mockImplementation(async (...args) => { if (args[2] === "symbol") throw new Error("No symbol"); return original(...args); });
    expect((await readProposalSnapshot("treasury", reader)).rows[0].value).toMatchObject({ asset: { decimals: 6, symbol: "TOKEN" } });
    reader.read.mockImplementation(async (...args) => { if (args[2] === "decimals") throw new Error("No precision"); return original(...args); });
    expect((await readProposalSnapshot("treasury", reader)).rows[0].value.status).toBe("error");
  });

  it("rejects malformed/oversized counts and distinguishes an empty snapshot from global failure", async () => {
    expect(snapshotProposalIds(0n)).toEqual([]);
    expect(snapshotProposalIds(SNAPSHOT_PROPOSAL_LIMIT)).toHaveLength(Number(SNAPSHOT_PROPOSAL_LIMIT));
    for (const count of [-1n, SNAPSHOT_PROPOSAL_LIMIT + 1n, 2 as unknown as bigint]) expect(() => snapshotProposalIds(count)).toThrow();
    const reader = mockReader("allocation", 0n);
    expect((await readProposalSnapshot("allocation", reader)).rows).toEqual([]);
    reader.latestBlock.mockResolvedValueOnce(null as never);
    await expect(readProposalSnapshot("allocation", reader)).rejects.toThrow("Latest PulseChain block");
    reader.read.mockRejectedValueOnce(new Error("Counts unavailable"));
    await expect(readProposalSnapshot("allocation", reader)).rejects.toThrow("Counts unavailable");
    reader.read.mockResolvedValueOnce(["2", 0n, 0n, 0n]);
    await expect(readProposalSnapshot("allocation", reader)).rejects.toThrow("Invalid on-chain integer");
  });

  it("isolates one failed row and limits proposal calls to six at a time", async () => {
    const reader = mockReader("allocation", 14n);
    const original = reader.read.getMockImplementation()!;
    let inFlight = 0, maximum = 0;
    reader.read.mockImplementation(async (...args) => {
      if (args[2] !== "proposalFarmUpdate") return original(...args);
      inFlight++; maximum = Math.max(maximum, inFlight);
      await new Promise(resolve => setTimeout(resolve, 1));
      inFlight--;
      if (args[3][0] === 3n) throw new Error("RPC failed");
      return original(...args);
    });
    const result = await readProposalSnapshot("allocation", reader);
    expect(result.rows).toHaveLength(14);
    expect(result.rows[3].value.status).toBe("error");
    expect(result.rows.filter(row => row.value.status === "verified")).toHaveLength(13);
    expect(maximum).toBe(SNAPSHOT_READ_BATCH);
  });

  it("stops issuing new batches after cancellation and returns no partial success", async () => {
    const reader = mockReader("allocation", 14n);
    const controller = new AbortController();
    const original = reader.read.getMockImplementation()!;
    reader.read.mockImplementation(async (...args) => {
      const value = await original(...args);
      if (args[2] === "proposalFarmUpdate" && args[3][0] === 5n) controller.abort();
      return value;
    });
    await expect(readProposalSnapshot("allocation", reader, controller.signal)).rejects.toThrow("cancelled");
    expect(reader.read.mock.calls.filter(call => call[2] === "proposalFarmUpdate")).toHaveLength(6);
  });

  it("rejects a cancelled zero-count response and malformed count tuple", async () => {
    const reader = mockReader("tax", 0n);
    const controller = new AbortController();
    const original = reader.read.getMockImplementation()!;
    reader.read.mockImplementation(async (...args) => {
      const value = await original(...args);
      controller.abort();
      return value;
    });
    await expect(readProposalSnapshot("tax", reader, controller.signal)).rejects.toThrow("cancelled");
    reader.read.mockImplementation(original).mockResolvedValueOnce([0n]);
    await expect(readProposalSnapshot("tax", reader)).rejects.toThrow("Unexpected proposal count");
  });

  it("reports progress without returning partial snapshots as complete", async () => {
    const progress = vi.fn();
    const result = await readProposalSnapshot("allocation", mockReader("allocation", 14n), undefined, progress);
    expect(progress.mock.calls.map(call => call[0])).toEqual([
      { completed: 0, total: 14 }, { completed: 6, total: 14 },
      { completed: 12, total: 14 }, { completed: 14, total: 14 },
    ]);
    expect(result.rows).toHaveLength(14);
  });
});
