import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ParameterProposals } from "../src/features/governance/ParameterProposalList";
import { loadParameterProposals, type ParameterSnapshot } from "../src/features/governance/parameterProposals";

vi.mock("../src/features/governance/parameterProposals", async importOriginal => ({
  ...await importOriginal<typeof import("../src/features/governance/parameterProposals")>(),
  loadParameterProposals: vi.fn(),
}));

const load = vi.mocked(loadParameterProposals);
const snapshot: ParameterSnapshot = {
  block: 123, timestamp: 1_788_600_000n, baseDelay: 43200n, costToVote: 10n ** 18n,
  rows: [
    { id: "0", status: "verified", proposal: { valid: true, createdAt: 100n, extraDelay: 0n, votesFor: 10n ** 18n, votesAgainst: 0n, value: 125n, feeType: 0n } },
    { id: "1", status: "verified", proposal: { valid: false, createdAt: 100n, extraDelay: 0n, votesFor: 0n, votesAgainst: 0n, value: 500n, feeType: 2n } },
    { id: "2", status: "error", message: "Proposal read failed — refresh to retry" },
  ],
};

beforeEach(() => { load.mockReset(); });

describe("Parameter proposal views", () => {
  it("distinguishes initial loading, RPC failure, retry, and a verified empty list", async () => {
    let reject!: (reason: Error) => void;
    load.mockImplementationOnce(() => new Promise((_, fail) => { reject = fail; }));
    render(<ParameterProposals module="delay" />);
    expect(screen.getByRole("status")).toHaveTextContent("Checking on-chain");
    expect(screen.queryByText(/No open proposals/)).not.toBeInTheDocument();
    await waitFor(() => expect(load).toHaveBeenCalled());
    await act(async () => reject(new Error("offline")));
    expect(screen.getByRole("alert")).toHaveTextContent("Unable to verify");
    expect(screen.queryByText(/No open proposals/)).not.toBeInTheDocument();
    load.mockResolvedValueOnce({ ...snapshot, rows: [] });
    fireEvent(window, new Event("online"));
    expect(await screen.findByText("No open proposals at this snapshot.")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByText(/0 of 0 proposal IDs verified/)).toBeInTheDocument();
  });

  it("shows fee types and partial failures without putting finished proposals in Open", async () => {
    load.mockResolvedValue(snapshot);
    render(<ParameterProposals module="fees" />);
    expect(await screen.findByText("Deposit fee: 1.25%")).toBeInTheDocument();
    expect(screen.queryByText("Referral bonus: 5%")).not.toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("1 proposal read failed");
    expect(screen.getByText(/2 of 3 proposal IDs verified/)).toBeInTheDocument();
    expect(screen.getAllByText("Unverified")).toHaveLength(2);
    expect(screen.getByText("Review complete — execution not verified")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "History" }));
    expect(screen.getByRole("button", { name: "History" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText("Referral bonus: 5%")).toBeInTheDocument();
    expect(screen.queryByText("Deposit fee: 1.25%")).not.toBeInTheDocument();
    expect(screen.getByText("Finished — outcome not verified")).toBeInTheDocument();
    expect(screen.getAllByText("Unverified")).toHaveLength(2);
  });

  it("ignores a slower previous module response", async () => {
    let completeFees!: (value: ParameterSnapshot) => void;
    load.mockImplementationOnce(() => new Promise(resolve => { completeFees = resolve; }));
    const view = render(<ParameterProposals module="fees" />);
    load.mockResolvedValueOnce({ ...snapshot, rows: [] });
    view.rerender(<ParameterProposals module="delay" />);
    expect(await screen.findByText("No open proposals at this snapshot.")).toBeInTheDocument();
    await act(async () => completeFees(snapshot));
    expect(screen.queryByText("Deposit fee: 1.25%")).not.toBeInTheDocument();
    expect(screen.getByText("No open proposals at this snapshot.")).toBeInTheDocument();
    expect(load.mock.calls.map(call => call[0])).toEqual(["fees", "delay"]);
  });

  it("retains prior values and combines overlapping automatic refreshes", async () => {
    load.mockResolvedValueOnce(snapshot);
    render(<ParameterProposals module="fees" />);
    await screen.findByText("Deposit fee: 1.25%");
    let complete!: (value: ParameterSnapshot) => void;
    load.mockImplementationOnce(() => new Promise(resolve => { complete = resolve; }));
    fireEvent(window, new Event("online"));
    await waitFor(() => expect(load).toHaveBeenCalledTimes(2));
    expect(screen.getByText("Deposit fee: 1.25%")).toBeInTheDocument();
    fireEvent(window, new Event("online"));
    expect(load).toHaveBeenCalledTimes(2);
    await act(async () => complete({ ...snapshot, rows: [] }));
    expect(await screen.findByText("No open proposals at this snapshot.")).toBeInTheDocument();
    expect(screen.queryByText("Deposit fee: 1.25%")).not.toBeInTheDocument();
  });
});
