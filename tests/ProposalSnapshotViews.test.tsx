import { act, fireEvent, render, screen, within, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GovernancePage, GovernanceProposalCards, proposalTablesFromSnapshot } from "../src/features/GovernancePage";
import { loadProposalSnapshot, type ProposalSnapshot, type SnapshotModule, type SnapshotRow } from "../src/features/governance/proposalSnapshots";
import type { WalletState } from "../src/hooks/useWallet";

vi.mock("../src/features/governance/proposalSnapshots", async original => ({
  ...await original<typeof import("../src/features/governance/proposalSnapshots")>(), loadProposalSnapshot: vi.fn(),
}));
vi.mock("../src/lib/chain", async original => ({
  ...await original<typeof import("../src/lib/chain")>(),
  getPublicProvider: vi.fn(async () => { throw new Error("Statistics are not part of these view tests"); }),
}));

const load = vi.mocked(loadProposalSnapshot);
const wallet = { address: null, connecting: false, connect: vi.fn(), getSigner: vi.fn() } as unknown as WalletState;
const allocationRow = (id: string, valid: boolean): SnapshotRow => ({ id, module: "allocation", value: {
  status: "verified", lifecycle: valid ? "enforceable" : "finished", observedAt: 1000, reviewEndsAt: 500,
  proposal: { valid, poolId: 21n, newAllocation: 15n, votesFor: 20n * 10n ** 18n, votesAgainst: 0n, extraDelay: 0n, createdAt: 100n },
} });
const allocation: ProposalSnapshot = {
  module: "allocation", block: 42, timestamp: 1000, count: 3n, baseDelay: 500n,
  rows: [allocationRow("0", true), allocationRow("1", false), { id: "2", module: "allocation", value: { status: "error", message: "RPC unavailable" } }],
};
const empty = (module: SnapshotModule, block = 43): ProposalSnapshot => ({ module, block, timestamp: 1100, count: 0n, baseDelay: 500n, rows: [] });
const api = vi.fn<typeof fetch>();
beforeEach(() => {
  load.mockReset();
  api.mockReset().mockRejectedValue(new Error("API offline"));
  vi.stubGlobal("fetch", api);
});
afterEach(() => { vi.unstubAllGlobals(); });

describe("chain-first proposal views", () => {
  it("synthesizes every missing API ID, reclassifies both directions and ignores unmatched legacy records", () => {
    const headers = ["For Pool", "Allocation", "DEGEN Committed", "Status", "User Rep"];
    const legacy = {
      active: { headers, rows: [
        { proposalId: "1", actions: [], cells: ["Wrong open", "999%", "999", "Voting", "Actor A"] },
        { proposalId: "999", actions: [], cells: ["Invalid", "999%", "999", "Enforced", "Actor B"] },
      ] },
      expired: { headers, rows: [{ proposalId: "0", actions: [], cells: ["Example pool", "999%", "999", "Enforced", "Actor C"] }] },
    };
    const tables = proposalTablesFromSnapshot(allocation, legacy);
    expect(tables.active.rows.map(row => row.proposalId)).toEqual(["0", "2"]);
    expect(tables.expired.rows.map(row => row.proposalId)).toEqual(["1", "2"]);
    expect(tables.failedReads).toBe(1);
    expect(tables.ignoredLegacyRows).toBe(1);
    render(<GovernanceProposalCards category="allocation" categoryLabel="Reward Allocation" table={tables.active} />);
    expect(screen.getByText("Example pool (legacy label)")).toBeInTheDocument();
    expect(screen.getByText("Pool #21")).toBeInTheDocument();
    expect(screen.getByText("0.15%")).toBeInTheDocument();
    expect(screen.getByText("20")).toBeInTheDocument();
    expect(screen.queryByText(/999/)).not.toBeInTheDocument();
    expect(screen.getByText("Unverified — RPC unavailable")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Enforce" })).toBeDisabled();
  });

  it("keeps Open and History populated when the legacy API fails", async () => {
    load.mockResolvedValue(allocation);
    render(<GovernancePage wallet={wallet} />);
    expect(await screen.findByRole("article", { name: "Proposal 0" })).toBeInTheDocument();
    expect(screen.getByRole("article", { name: "Proposal 2" })).toBeInTheDocument();
    expect(await screen.findByText(/Legacy metadata is unavailable/)).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("1 proposal reads failed");
    fireEvent.click(screen.getByRole("button", { name: "History" }));
    expect(screen.getByRole("article", { name: "Proposal 1" })).toBeInTheDocument();
    expect(screen.getByRole("article", { name: "Proposal 2" })).toBeInTheDocument();
    expect(screen.queryByRole("article", { name: "Proposal 0" })).not.toBeInTheDocument();
    expect(wallet.getSigner).not.toHaveBeenCalled();
  });

  it("loads Treasury independently of failed metadata, while preserving token precision and recipient", async () => {
    const treasury: ProposalSnapshot = { ...empty("treasury"), count: 1n, rows: [{ id: "0", module: "treasury", value: {
      status: "verified", lifecycle: "finished", observedAt: 1100, creditVotingEndsAt: 300, finalizesAt: 500, consensusSupportRequired: 15n,
      consensus: { votesFor: 20n, votesAgainst: 0n, totalStaked: 100n },
      asset: { address: "0x0000000000000000000000000000000000000011", decimals: 6, symbol: "USDC" },
      proposal: { valid: false, createdAt: 1n, creditVotesFor: 100n * 10n ** 18n, creditVotesAgainst: 0n, extraDelay: 0n,
        tokenAddress: "0x0000000000000000000000000000000000000011", beneficiary: "0x1111111111111111111111111111111111111111", amountToSend: 1250000n, consensusProposalId: 7n },
    } }] };
    load.mockImplementation(async module => module === "treasury" ? treasury : empty(module));
    render(<GovernancePage wallet={wallet} />);
    fireEvent.click(screen.getByRole("button", { name: "Treasury Withdraw" }));
    await screen.findByText(/No open proposals/);
    fireEvent.click(screen.getByRole("button", { name: "History" }));
    const card = await screen.findByRole("article", { name: "Proposal 0" });
    expect(within(card).getByText("1.25 USDC")).toBeInTheDocument();
    expect(within(card).getByText("0x1111…1111")).toBeInTheDocument();
    expect(await screen.findByText(/Legacy metadata is unavailable/)).toBeInTheDocument();
  });

  it("distinguishes loading/global RPC failure from a verified empty list and retries", async () => {
    let fail!: (reason: Error) => void;
    load.mockImplementationOnce(() => new Promise((_, reject) => { fail = reject; }));
    render(<GovernancePage wallet={wallet} />);
    expect(screen.getByRole("status")).toHaveTextContent("Loading on-chain");
    expect(screen.queryByText(/No open proposals/)).not.toBeInTheDocument();
    await waitFor(() => expect(load).toHaveBeenCalled());
    await act(async () => fail(new Error("Proposal count unavailable")));
    expect(screen.getByRole("alert")).toHaveTextContent("temporarily unavailable");
    expect(screen.queryByText(/No open proposals/)).not.toBeInTheDocument();
    load.mockResolvedValueOnce(empty("allocation"));
    fireEvent(window, new Event("online"));
    expect(await screen.findByText(/No open proposals/)).toBeInTheDocument();
    expect(screen.getByText(/0 of 0 proposal IDs verified/)).toBeInTheDocument();
  });

  it("ignores a previous module's late chain result", async () => {
    let finish!: (value: ProposalSnapshot) => void;
    load.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    load.mockResolvedValueOnce(empty("tax"));
    render(<GovernancePage wallet={wallet} />);
    fireEvent.click(screen.getByRole("button", { name: "Transaction Tax" }));
    await screen.findByText(/No open proposals/);
    await act(async () => finish(allocation));
    expect(screen.queryByRole("article")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Transaction Tax" })).toHaveAttribute("aria-pressed", "true");
  });

  it("shows chain results while metadata hangs and ignores old metadata after refresh", async () => {
    let finishMetadata!: (response: Response) => void;
    api.mockImplementation(url => String(url).includes("pool-options") ? Promise.reject(new Error("Offline")) : new Promise(resolve => { finishMetadata = resolve; }));
    load.mockResolvedValueOnce(allocation);
    render(<GovernancePage wallet={wallet} />);
    await screen.findByRole("article", { name: "Proposal 0" });
    expect(screen.getByText(/Optional legacy metadata is loading/)).toBeInTheDocument();
    const stale = finishMetadata;
    load.mockResolvedValueOnce(empty("allocation", 99));
    fireEvent(window, new Event("online"));
    await screen.findByText(/0 of 0 proposal IDs verified/);
    await act(async () => stale({ ok: true, text: async () => '<table id="allocation-active"><thead><tr><th>For Pool</th></tr></thead><tbody><tr><td onclick="viewProposal(0)">Stale pool</td></tr></tbody></table>' } as Response));
    expect(screen.queryByRole("article")).not.toBeInTheDocument();
    expect(screen.queryByText("Stale pool")).not.toBeInTheDocument();
    expect(screen.getByText(/0 of 0 proposal IDs verified/)).toBeInTheDocument();
  });

  it("does not format a different Governor-Transfer subtype as emissions", () => {
    const snapshot: ProposalSnapshot = { ...empty("emissions"), count: 1n, rows: [{ module: "emissions", id: "0", value: {
      status: "verified", lifecycle: "finished", observedAt: 1000, reviewEndsAt: 500,
      executionBlockedReason: "Governor Transfer subtype is not an emissions update",
      proposal: { valid: false, createdAt: 100n, proposedValue: 123n, votesFor: 0n, votesAgainst: 0n, extraDelay: 0n, isEmissions: false, startsAt: 0n },
    } }] };
    render(<GovernanceProposalCards category="emissions" categoryLabel="Emissions" table={proposalTablesFromSnapshot(snapshot).expired} />);
    expect(screen.getByText("123 raw units (non-emissions subtype)")).toBeInTheDocument();
    expect(screen.getByText("Execution blocked")).toBeInTheDocument();
  });
});
