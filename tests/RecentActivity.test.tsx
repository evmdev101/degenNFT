import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PageActivity } from "../src/hooks/usePageActive";
import { RecentActivity } from "../src/features/dashboard/RecentActivity";
import type { ProtocolActivityPage, ProtocolActivityRow } from "../src/features/dashboard/activityData";

const mocks = vi.hoisted(() => ({ read: vi.fn() }));
vi.mock("../src/features/dashboard/activityData", async original => ({
  ...await original<typeof import("../src/features/dashboard/activityData")>(), readPublicProtocolActivity: mocks.read,
}));
const hash = (id: number) => `0x${id.toString(16).padStart(64, "0")}`;
const row = (id: number, category: ProtocolActivityRow["category"] = "Miners", block = 900 - id): ProtocolActivityRow => ({
  key: `${hash(id)}:0`, hash: hash(id), block, blockHash: hash(block), index: 0, category,
  label: `${category} event ${id}`, address: "0x0000000000000000000000000000000000000001", raw: BigInt(id) * 10n ** 18n,
  symbol: "DEGEN", decimals: 18, timestamp: Math.floor(Date.now() / 1000),
});
const page = (rows: ProtocolActivityRow[] = [], from = 800, head = 1000): ProtocolActivityPage => ({ from, to: head, head,
  headHash: hash(head), timestamp: Math.floor(Date.now() / 1000), rows });
const feed = () => within(screen.getByRole("region", { name: "Recent protocol events" }));
beforeEach(() => { mocks.read.mockReset(); });

describe("Overview recent activity", () => {
  it("filters real categories and reveals cached events without another read", async () => {
    mocks.read.mockResolvedValue(page([...Array.from({ length: 23 }, (_, i) => row(i + 1)), row(30, "Treasury"), row(31, "Governance")], 0));
    render(<RecentActivity />);
    await waitFor(() => expect(feed().getAllByRole("link")).toHaveLength(20));
    fireEvent.click(screen.getByRole("button", { name: "Show more", exact: true }));
    expect(feed().getAllByRole("link")).toHaveLength(25);
    expect(screen.getByRole("button", { name: "Show more", exact: true })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Treasury", exact: true }));
    expect(feed().getAllByRole("link")).toHaveLength(1);
    expect(feed().getByRole("link")).toHaveTextContent("Treasury event 30");
    expect(screen.getByRole("button", { name: "Treasury", exact: true })).toHaveAttribute("aria-pressed", "true");
    expect(mocks.read).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("button", { name: /refresh|retry|latest/i })).not.toBeInTheDocument();
  });

  it("loads older blocks once, deduplicates results, and stops at the chain boundary", async () => {
    const initial = page([row(1)]);
    let finish!: (value: ProtocolActivityPage) => void;
    mocks.read.mockResolvedValueOnce(initial).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    render(<RecentActivity />);
    await waitFor(() => expect(feed().getAllByRole("link")).toHaveLength(1));
    const older = screen.getByRole("button", { name: "Load older events" });
    fireEvent.click(older); fireEvent.click(older);
    expect(mocks.read).toHaveBeenCalledTimes(2);
    expect(mocks.read.mock.calls[1][0]).toEqual({ end: 799, anchor: initial, signal: expect.any(AbortSignal) });
    expect(older).toBeDisabled();
    await act(async () => finish({ ...page([row(2, "Farms", 700), row(1)], 0), to: 799 }));
    expect(feed().getAllByRole("link")).toHaveLength(2); expect(older).toBeDisabled();
  });

  it("keeps events after an older read fails and retries exactly that range", async () => {
    const initial = page([row(1)]);
    mocks.read.mockResolvedValueOnce(initial).mockRejectedValueOnce(new Error("RPC unavailable"))
      .mockResolvedValueOnce({ ...page([row(2, "Treasury", 700)], 0), to: 799 });
    render(<RecentActivity />);
    await screen.findByText("Miners event 1");
    fireEvent.click(screen.getByRole("button", { name: "Load older events" }));
    await screen.findByText("Older activity could not be loaded.");
    expect(feed().getAllByRole("link")).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "Load older events" }));
    await screen.findByText("Treasury event 2");
    expect(mocks.read.mock.calls.slice(1).map(([options]) => options.end)).toEqual([799, 799]);
  });

  it("keeps older history when automatic current events arrive", async () => {
    const initial = page([row(1)]);
    mocks.read.mockResolvedValueOnce(initial)
      .mockResolvedValueOnce({ ...page([row(2, "Farms", 700)], 0), to: 799 })
      .mockResolvedValueOnce(page([row(3, "Treasury", 1001), row(1)], 801, 1001));
    render(<RecentActivity />);
    await screen.findByText("Miners event 1");
    fireEvent.click(screen.getByRole("button", { name: "Load older events" }));
    await screen.findByText("Farms event 2");
    fireEvent(window, new Event("online"));
    await screen.findByText("Treasury event 3");
    expect(feed().getAllByRole("link")).toHaveLength(3);
    expect(screen.getByRole("button", { name: "Load older events" })).toBeDisabled();
  });

  it("cancels requests when the cached page becomes inactive and resumes without a locked button", async () => {
    let pendingSignal: AbortSignal | undefined;
    mocks.read.mockResolvedValueOnce(page([row(1)]))
      .mockImplementationOnce(({ signal }) => { pendingSignal = signal; return new Promise(() => {}); })
      .mockResolvedValue(page([row(1)]));
    const { rerender } = render(<PageActivity.Provider value={true}><RecentActivity /></PageActivity.Provider>);
    await screen.findByText("Miners event 1");
    fireEvent.click(screen.getByRole("button", { name: "Load older events" }));
    rerender(<PageActivity.Provider value={false}><RecentActivity /></PageActivity.Provider>);
    expect(pendingSignal?.aborted).toBe(true);
    rerender(<PageActivity.Provider value={true}><RecentActivity /></PageActivity.Provider>);
    await waitFor(() => expect(screen.getByRole("button", { name: "Load older events" })).toBeEnabled());
    expect(feed().getAllByRole("link")).toHaveLength(1);
  });

  it("keeps initial errors distinct from a valid empty category", async () => {
    mocks.read.mockRejectedValue(new Error("Unavailable"));
    render(<RecentActivity />);
    await screen.findByText("Activity is temporarily unavailable.");
    expect(screen.queryByText("No matching events in the loaded range.")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Load older events" })).toBeDisabled();
  });
});
