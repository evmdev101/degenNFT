import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MyMinersPage } from "../src/features/MyMinersPage";
import { PageActivity } from "../src/hooks/usePageActive";
import type { WalletState } from "../src/hooks/useWallet";
const mocks = vi.hoisted(() => ({ shares: 3n * 10n ** 18n, transfer: vi.fn(), started: 0n, failRead: false, count: vi.fn(), info: vi.fn() }));
vi.mock("../src/lib/chain", () => ({ getPublicProvider: async () => ({}), readableError: (error: Error) => error.message }));
vi.mock("ethers", async (original) => ({ ...await original<typeof import("ethers")>(), Contract: class {
  constructor(private address: string) {}
  getNrOfStakes = async () => {
    if (mocks.failRead) throw new Error("temporary RPC failure");
    return mocks.count(this.address);
  };
  getPricePerFullShare = async () => 2n * 10n ** 18n;
  gracePeriod = async () => 86400n;
  withdrawFeePeriod = async () => 315360000n;
  balanceOf = async () => 10n ** 18n;
  userInfo = async (_wallet: string, id: number) => mocks.info(this.address, id);
  transferStakeToAnotherWallet = mocks.transfer;
} }));
const tenYear = "0xdE672FccA32365bD704c39bd1164a0D34a3a73e6";
const oneYear = "0x3d175C8359169b0e830d36EA9CD3FE209f46f7BD";
const info = () => ({ shares: mocks.shares, lastMineredTime: mocks.started, xvmcAtLastUserAction: 0n, lastUserActionTime: mocks.started, mandatoryTimeToServe: 0n });
const deferred = <T,>() => { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; };
const wallet = { address: "0x0000000000000000000000000000000000000001", getSigner: async () => ({ getAddress: async () => "0x0000000000000000000000000000000000000001" }) } as WalletState;
beforeEach(() => {
  mocks.failRead = false;
  mocks.count.mockReset().mockImplementation(async (pool: string) => pool.toLowerCase() === tenYear.toLowerCase() ? 1n : 0n);
  mocks.info.mockReset().mockImplementation(async () => info());
  mocks.shares = 3n * 10n ** 18n; mocks.started = BigInt(Math.floor(Date.now() / 1000) - 10);
  mocks.transfer.mockReset().mockResolvedValue({ wait: async () => ({ status: 1 }) });
  Object.assign(mocks.transfer, { staticCall: vi.fn(async () => undefined) });
  vi.stubGlobal("fetch", vi.fn(async () => ({ json: async () => [{ priceUsd: "1" }] })));
});
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });
describe("miner positions", () => {
  it("keeps unavailable miner positions and totals distinct from an actual zero", async () => {
    mocks.failRead = true;
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      render(<MyMinersPage wallet={{ ...wallet, address: "0x0000000000000000000000000000000000000099" }} />);
      await screen.findByText("Miner positions temporarily unavailable.");
      expect(screen.queryByText("No staked miners found.")).not.toBeInTheDocument();
      await waitFor(() => expect(screen.getByText("Miner value:").parentElement).toHaveTextContent("—"));
      expect(screen.getByText("Wallet + miner value:").parentElement).toHaveTextContent("—");
    } finally { warn.mockRestore(); }
  });
  it("does not label completed mandatory service as zero withdrawal penalty", async () => {
    render(<MyMinersPage wallet={wallet} />);
    await screen.findByRole("button", { name: "Actions" });
    fireEvent.click(screen.getByRole("button", { name: "List view" }));
    await screen.findByText("Fees may apply");
    expect(screen.queryByText("0%")).not.toBeInTheDocument();
  });
  it("filters the loaded collection without changing wallet totals and clears back to all miners", async () => {
    render(<MyMinersPage wallet={wallet} />);
    await screen.findByRole("button", { name: "Actions" });
    const walletTotal = screen.getByText("Wallet Balance:").parentElement!.textContent;
    fireEvent.change(screen.getByRole("searchbox", { name: "Search miners" }), { target: { value: "no-match" } });
    expect(screen.getByText("No matching miners")).toBeVisible();
    expect(screen.getByText("Wallet Balance:").parentElement!.textContent).toBe(walletTotal);
    fireEvent.click(screen.getByRole("button", { name: "Show all miners" }));
    expect(screen.getByRole("button", { name: "Actions" })).toBeVisible();
    fireEvent.change(screen.getByRole("combobox", { name: "Duration" }), { target: { value: "0x7ED33f65A0398cb26eaB2B03877825c96D9B6077" } });
    expect(screen.getByText("No matching miners")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Clear filters" }));
    fireEvent.click(screen.getByRole("button", { name: "Mature 0" }));
    expect(screen.getByText("No matching miners")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Clear filters" }));
    expect(screen.getByRole("button", { name: "Actions" })).toBeVisible();
    expect(screen.getByRole("combobox", { name: "Sort by" })).toHaveValue("progress-desc");
  });
  it("opens actions with an expanded state and lets Escape close them and return focus", async () => {
    render(<MyMinersPage wallet={wallet} />);
    await screen.findByRole("button", { name: "Actions" });
    const actions = screen.getByRole("button", { name: "Actions" });
    expect(actions).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("button", { name: "End Miner (Withdraw)" })).not.toBeInTheDocument();
    fireEvent.click(actions);
    expect(actions).toHaveAttribute("aria-expanded", "true");
    const withdraw = screen.getByRole("button", { name: "End Miner (Withdraw)" });
    fireEvent.keyDown(withdraw, { key: "Escape" });
    expect(actions).toHaveAttribute("aria-expanded", "false");
    expect(actions).toHaveFocus();
  });
  it("rejects a position that changed after the action panel opened", async () => {
    render(<MyMinersPage wallet={wallet} />);
    await screen.findByRole("button", { name: "Actions" });
    fireEvent.click(screen.getByRole("button", { name: /Actions/ }));
    fireEvent.click(screen.getByRole("button", { name: "Transfer Miner To Another Wallet" }));
    fireEvent.change(screen.getByPlaceholderText("0x..."), { target: { value: "0x0000000000000000000000000000000000000002" } });
    mocks.shares = 1n;
    fireEvent.click(screen.getByRole("button", { name: "Proceed!" }));
    await screen.findByText("This miner changed. Close this panel and select its current position.");
    expect(mocks.transfer).not.toHaveBeenCalled();
  });
  it("simulates a transfer against current miner shares before submission", async () => {
    render(<MyMinersPage wallet={wallet} />);
    await screen.findByRole("button", { name: "Actions" });
    fireEvent.click(screen.getByRole("button", { name: /Actions/ }));
    fireEvent.click(screen.getByRole("button", { name: "Transfer Miner To Another Wallet" }));
    fireEvent.change(screen.getByPlaceholderText("0x..."), { target: { value: "0x0000000000000000000000000000000000000002" } });
    fireEvent.click(screen.getByRole("button", { name: "Proceed!" }));
    await waitFor(() => expect(mocks.transfer).toHaveBeenCalledWith(3n * 10n ** 18n, 0, "0x0000000000000000000000000000000000000002"));
    expect(mocks.transfer.staticCall).toHaveBeenCalledWith(3n * 10n ** 18n, 0, "0x0000000000000000000000000000000000000002");
  });
});


describe("miner refresh latency", () => {
  it("refreshes a confirmed claim immediately rather than waiting for the polling timer", async () => {
    render(<MyMinersPage wallet={{ ...wallet, address: "0x0000000000000000000000000000000000000101" }} />);
    await screen.findByRole("button", { name: "Actions" });
    await waitFor(() => expect(screen.getByText("Wallet Balance:").parentElement).toHaveTextContent("1"));
    mocks.count.mockImplementation(async (pool: string) => pool === tenYear ? 2n : 0n);
    act(() => { window.dispatchEvent(new Event("degen:transaction-confirmed")); });
    await screen.findByText("#1");
    expect(screen.getAllByRole("button", { name: "Actions" })).toHaveLength(2);
  });

  it("starts a fresh read on confirmation without waiting for an older in-flight scan", async () => {
    const oldCount = deferred<bigint>();
    let countReads = 0;
    mocks.count.mockImplementation((pool: string) => pool === tenYear ? ++countReads === 1 ? oldCount.promise : Promise.resolve(2n) : Promise.resolve(0n));
    render(<MyMinersPage wallet={{ ...wallet, address: "0x0000000000000000000000000000000000000102" }} />);
    await waitFor(() => expect(countReads).toBe(1));
    act(() => { window.dispatchEvent(new Event("degen:transaction-confirmed")); });
    await screen.findByText("#1");
    expect(countReads).toBe(2);
    await act(async () => { oldCount.resolve(1n); });
    expect(screen.getByText("#1")).toBeVisible();
  });

  it("shows the newest stake while older reads and another pool are still pending, retaining cached cards", async () => {
    const account = { ...wallet, address: "0x0000000000000000000000000000000000000103" };
    mocks.count.mockImplementation(async (pool: string) => pool === tenYear || pool === oneYear ? 1n : 0n);
    const first = render(<MyMinersPage wallet={account} />);
    await waitFor(() => expect(screen.getAllByRole("button", { name: "Actions" })).toHaveLength(2));
    await waitFor(() => expect(screen.getByText("Miner value:").parentElement).toHaveTextContent("12"));
    first.unmount();
    const oldStake = deferred<ReturnType<typeof info>>();
    const slowPool = deferred<bigint>();
    mocks.count.mockImplementation((pool: string) => pool === tenYear ? Promise.resolve(10n) : pool === oneYear ? slowPool.promise : Promise.resolve(0n));
    mocks.info.mockClear();
    mocks.info.mockImplementation((pool: string, id: number) => pool === tenYear && id === 0 ? oldStake.promise : Promise.resolve(info()));
    render(<MyMinersPage wallet={account} />);
    await screen.findByText("#9");
    expect(mocks.info.mock.calls.filter(([pool]) => pool === tenYear)[0][1]).toBe(9);
    expect(screen.getAllByText("#0")).toHaveLength(2);
    expect(screen.getByText("Miner value:").parentElement).toHaveTextContent("12");
    await act(async () => { oldStake.resolve(info()); slowPool.resolve(1n); });
    await waitFor(() => expect(screen.getAllByRole("button", { name: "Actions" })).toHaveLength(11));
    await waitFor(() => expect(screen.getByText("Miner value:").parentElement).toHaveTextContent("66"));
  });

  it("pauses reads while hidden and refreshes immediately on returning to My Miners", async () => {
    const account = { ...wallet, address: "0x0000000000000000000000000000000000000104" };
    const view = render(<PageActivity.Provider value={false}><MyMinersPage wallet={account} /></PageActivity.Provider>);
    act(() => { window.dispatchEvent(new Event("degen:transaction-confirmed")); });
    expect(mocks.count).not.toHaveBeenCalled();
    view.rerender(<PageActivity.Provider value={true}><MyMinersPage wallet={account} /></PageActivity.Provider>);
    await screen.findByText("#0");
    view.rerender(<PageActivity.Provider value={false}><MyMinersPage wallet={account} /></PageActivity.Provider>);
    const calls = mocks.count.mock.calls.length;
    mocks.count.mockImplementation(async (pool: string) => pool === tenYear ? 2n : 0n);
    act(() => { window.dispatchEvent(new Event("degen:transaction-confirmed")); });
    expect(mocks.count).toHaveBeenCalledTimes(calls);
    view.rerender(<PageActivity.Provider value={true}><MyMinersPage wallet={account} /></PageActivity.Provider>);
    await screen.findByText("#1");
  });

  it("rechecks shortly after confirmation when the public RPC initially lags behind the receipt", async () => {
    render(<MyMinersPage wallet={{ ...wallet, address: "0x0000000000000000000000000000000000000105" }} />);
    await waitFor(() => expect(screen.getByText("Wallet Balance:").parentElement).toHaveTextContent("1"));
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    await act(async () => { window.dispatchEvent(new Event("degen:transaction-confirmed")); });
    expect(screen.queryByText("#1")).not.toBeInTheDocument();
    mocks.count.mockImplementation(async (pool: string) => pool === tenYear ? 2n : 0n);
    await act(async () => { await vi.advanceTimersByTimeAsync(3_000); });
    expect(screen.getByText("#1")).toBeVisible();
  });

  it("ignores an old wallet's delayed results after the wallet changes", async () => {
    const oldCount = deferred<bigint>();
    mocks.count.mockImplementation((pool: string) => pool === tenYear ? oldCount.promise : Promise.resolve(0n));
    const view = render(<MyMinersPage wallet={{ ...wallet, address: "0x0000000000000000000000000000000000000106" }} />);
    await waitFor(() => expect(mocks.count).toHaveBeenCalled());
    mocks.count.mockResolvedValue(0n);
    view.rerender(<MyMinersPage wallet={{ ...wallet, address: "0x0000000000000000000000000000000000000107" }} />);
    await screen.findByText("No staked miners found.");
    await act(async () => { oldCount.resolve(1n); });
    expect(screen.getByText("No staked miners found.")).toBeVisible();
    expect(screen.queryByText("#0")).not.toBeInTheDocument();
  });
});
