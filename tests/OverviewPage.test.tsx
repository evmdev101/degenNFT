import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { OverviewPage } from "../src/features/OverviewPage";
import { DASHBOARD_ASSETS } from "../src/features/dashboard/config";
import type { TreasuryInflow, TreasuryInflowPage, TreasuryInflows } from "../src/features/dashboard/overviewData";
const mocks = vi.hoisted(() => ({ overview: vi.fn(), inflows: vi.fn(), older: vi.fn() }));
vi.mock("../src/features/dashboard/overviewData", async original => ({ ...await original<typeof import("../src/features/dashboard/overviewData")>(), readPublicOverview: mocks.overview, readPublicTreasuryInflows: mocks.inflows, readPublicOlderTreasuryInflows: mocks.older }));
vi.mock("../src/features/dashboard/TreasuryFarming", () => ({ TreasuryPositions: () => null }));
vi.mock("../src/features/dashboard/ContractShowcase", () => ({ ContractShowcase: () => null }));
vi.mock("../src/features/dashboard/ProtocolInsights", () => ({ ProtocolInsights: () => null }));
vi.mock("../src/features/dashboard/RecentActivity", () => ({ RecentActivity: () => null }));
const now = () => Math.floor(Date.now() / 1000);
const asset = DASHBOARD_ASSETS.find(asset => asset.symbol === "DEGEN")!;
const hash = (id: number) => `0x${id.toString(16).padStart(64, "0")}`;
function row(id: number, old = false): TreasuryInflow {
  return { key: `${hash(id)}:0`, asset, raw: 10n ** 18n, block: (old ? 700 : 1000) - id,
    index: 0, timestamp: now() - (old ? 35 * 86400 : id * 10), tx: hash(id) };
}
function history(count: number, from = 800): TreasuryInflows {
  return { from, to: 1000, fromTimestamp: now() - 31 * 86400, timestamp: now(), hash: hash(1000),
    rows: Array.from({ length: count }, (_, index) => row(index + 1)), boundaryRowsIncluded: true };
}
function loaded(snapshot: TreasuryInflows) {
  mocks.inflows.mockResolvedValue(snapshot);
  mocks.overview.mockResolvedValue({ block: 1000, timestamp: now(), supplyRaw: 10n ** 18n, holdings: [],
    prices: { [asset.address.toLowerCase()]: 1 }, totalUsd: 0, knownUsd: 0, pricedCount: 0 });
}
const feed = () => within(screen.getByRole("region", { name: "Treasury inflow history" }));
beforeEach(() => {
  mocks.overview.mockReset().mockRejectedValue(new Error("RPC down"));
  mocks.inflows.mockReset().mockRejectedValue(new Error("History unavailable"));
  mocks.older.mockReset();
});
describe("Overview dashboard", () => {
  it("is public and shows unavailable balances/history without inventing empty totals", async () => {
    render(<MemoryRouter><OverviewPage /></MemoryRouter>);
    await screen.findByText("Treasury balances are temporarily unavailable.");
    expect(screen.getByRole("heading", { name: "DEGEN Overview" })).toBeInTheDocument();
    expect(screen.getByText(/complete 30-day inflow history is unavailable/)).toBeVisible();
    expect(screen.queryByText("0 inflows")).not.toBeInTheDocument();
    expect(screen.queryByText("No tracked token inflows in the last 30 days.")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /refresh|retry/i })).not.toBeInTheDocument();
    fireEvent(window, new Event("online"));
    await waitFor(() => expect(mocks.overview).toHaveBeenCalledTimes(2));
    expect(screen.getByRole("link", { name: "Supported ecosystem farms" })).toHaveAttribute("href", "/farms");
  });

  it("keeps Show more inflows visible and disabled during initial loading", () => {
    mocks.inflows.mockImplementation(() => new Promise(() => {}));
    render(<MemoryRouter><OverviewPage /></MemoryRouter>);
    expect(screen.getByRole("button", { name: "Show more inflows" })).toBeDisabled();
    expect(feed().getByText("Reading treasury inflows…")).toBeInTheDocument();
  });

  it("reveals cached inflows ten at a time before requesting older history", async () => {
    loaded(history(25, 0));
    render(<MemoryRouter><OverviewPage /></MemoryRouter>);
    await waitFor(() => expect(feed().getAllByRole("link")).toHaveLength(10));
    const more = screen.getByRole("button", { name: "Show more inflows" });
    fireEvent.click(more);
    expect(feed().getAllByRole("link")).toHaveLength(20);
    fireEvent.click(more);
    expect(feed().getAllByRole("link")).toHaveLength(25);
    expect(more).toBeDisabled();
    expect(mocks.older).not.toHaveBeenCalled();
  });

  it("loads older rows once, deduplicates them, and keeps the summary totals unchanged", async () => {
    const initial = history(2);
    loaded(initial);
    let finish!: (page: TreasuryInflowPage) => void;
    mocks.older.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    render(<MemoryRouter><OverviewPage /></MemoryRouter>);
    await waitFor(() => expect(feed().getAllByRole("link")).toHaveLength(2));
    const totals = screen.getByLabelText("Tracked token inflow totals").textContent;
    const more = screen.getByRole("button", { name: "Show more inflows" });
    fireEvent.click(more); fireEvent.click(more);
    expect(mocks.older).toHaveBeenCalledTimes(1);
    expect(mocks.older).toHaveBeenCalledWith(initial, 799, expect.any(AbortSignal));
    expect(more).toBeDisabled();
    await act(async () => finish({ from: 0, to: 799, anchorBlock: 1000, anchorHash: initial.hash, rows: [row(9, true), initial.rows[0]] }));
    expect(feed().getAllByRole("link")).toHaveLength(3);
    expect(screen.getByLabelText("Tracked token inflow totals").textContent).toBe(totals);
    expect(more).toBeDisabled();
  });

  it("keeps existing rows on failure and retries the same older range on another click", async () => {
    const initial = history(1);
    loaded(initial);
    mocks.older.mockRejectedValueOnce(new Error("RPC down")).mockResolvedValueOnce({
      from: 0, to: 799, anchorBlock: 1000, anchorHash: initial.hash, rows: [row(9, true)],
    });
    render(<MemoryRouter><OverviewPage /></MemoryRouter>);
    await waitFor(() => expect(feed().getAllByRole("link")).toHaveLength(1));
    const more = screen.getByRole("button", { name: "Show more inflows" });
    fireEvent.click(more);
    expect(await screen.findByRole("alert")).toHaveTextContent("Older inflows could not be loaded.");
    expect(feed().getAllByRole("link")).toHaveLength(1);
    expect(more).toBeEnabled();
    fireEvent.click(more);
    await waitFor(() => expect(feed().getAllByRole("link")).toHaveLength(2));
    expect(mocks.older.mock.calls.map(call => call[1])).toEqual([799, 799]);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("keeps previously loaded older history through automatic current-month refreshes", async () => {
    const initial = history(1);
    loaded(initial);
    mocks.older.mockResolvedValue({ from: 500, to: 799, anchorBlock: 1000, anchorHash: initial.hash, rows: [row(9, true)] });
    render(<MemoryRouter><OverviewPage /></MemoryRouter>);
    await waitFor(() => expect(feed().getAllByRole("link")).toHaveLength(1));
    fireEvent.click(screen.getByRole("button", { name: "Show more inflows" }));
    await waitFor(() => expect(feed().getAllByRole("link")).toHaveLength(2));
    const updated = { ...initial, to: 1001, hash: hash(1001), rows: [{ ...row(20), block: 1001 }, ...initial.rows] };
    mocks.inflows.mockResolvedValue(updated);
    fireEvent(window, new Event("online"));
    await waitFor(() => expect(feed().getAllByRole("link")).toHaveLength(3));
    fireEvent.click(screen.getByRole("button", { name: "Show more inflows" }));
    await waitFor(() => expect(mocks.older).toHaveBeenCalledTimes(2));
    expect(mocks.older).toHaveBeenLastCalledWith(updated, 499, expect.any(AbortSignal));
  });

  it("cancels an older history request when the page unmounts", async () => {
    loaded(history(1));
    let signal!: AbortSignal;
    mocks.older.mockImplementation((_anchor, _cursor, nextSignal) => { signal = nextSignal; return new Promise(() => {}); });
    const view = render(<MemoryRouter><OverviewPage /></MemoryRouter>);
    await waitFor(() => expect(feed().getAllByRole("link")).toHaveLength(1));
    fireEvent.click(screen.getByRole("button", { name: "Show more inflows" }));
    expect(signal.aborted).toBe(false);
    view.unmount();
    expect(signal.aborted).toBe(true);
  });

  it("allows an older page to finish while a normal automatic refresh updates the current rows", async () => {
    const initial = history(1);
    loaded(initial);
    let finish!: (page: TreasuryInflowPage) => void;
    let signal!: AbortSignal;
    mocks.older.mockImplementation((_anchor, _cursor, nextSignal) => {
      signal = nextSignal; return new Promise(resolve => { finish = resolve; });
    });
    render(<MemoryRouter><OverviewPage /></MemoryRouter>);
    await waitFor(() => expect(feed().getAllByRole("link")).toHaveLength(1));
    fireEvent.click(screen.getByRole("button", { name: "Show more inflows" }));
    mocks.inflows.mockResolvedValue({ ...initial, to: 1001, hash: hash(1001), rows: [{ ...row(20), block: 1001 }, ...initial.rows] });
    fireEvent(window, new Event("online"));
    await waitFor(() => expect(feed().getAllByRole("link")).toHaveLength(2));
    expect(signal.aborted).toBe(false);
    await act(async () => finish({ from: 0, to: 799, anchorBlock: 1000, anchorHash: initial.hash, rows: [row(9, true)] }));
    expect(feed().getAllByRole("link")).toHaveLength(3);
  });

  it("backfills older rows from an existing month-only cache before marking history complete", async () => {
    const initial = { ...history(1, 0), boundaryRowsIncluded: undefined };
    loaded(initial);
    mocks.older.mockResolvedValue({ from: 0, to: 1000, anchorBlock: 1000, anchorHash: initial.hash, rows: [row(9, true)] });
    render(<MemoryRouter><OverviewPage /></MemoryRouter>);
    await waitFor(() => expect(feed().getAllByRole("link")).toHaveLength(1));
    const more = screen.getByRole("button", { name: "Show more inflows" });
    expect(more).toBeEnabled();
    fireEvent.click(more);
    await waitFor(() => expect(feed().getAllByRole("link")).toHaveLength(2));
    expect(mocks.older).toHaveBeenCalledWith(initial, undefined, expect.any(AbortSignal));
    expect(more).toBeDisabled();
  });
});
