import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MyMinersPage } from "../src/features/MyMinersPage";
import type { WalletState } from "../src/hooks/useWallet";
const mocks = vi.hoisted(() => ({ shares: 3n * 10n ** 18n, transfer: vi.fn(), started: 0n, failRead: false }));
vi.mock("../src/lib/chain", () => ({ getPublicProvider: async () => ({}), readableError: (error: Error) => error.message }));
vi.mock("ethers", async (original) => ({ ...await original<typeof import("ethers")>(), Contract: class {
  constructor(private address: string) {}
  getNrOfStakes = async () => {
    if (mocks.failRead) throw new Error("temporary RPC failure");
    return this.address.toLowerCase() === "0xde672fcca32365bd704c39bd1164a0d34a3a73e6" ? 1n : 0n;
  };
  getPricePerFullShare = async () => 2n * 10n ** 18n;
  gracePeriod = async () => 86400n;
  withdrawFeePeriod = async () => 315360000n;
  balanceOf = async () => 10n ** 18n;
  userInfo = async () => ({ shares: mocks.shares, lastMineredTime: mocks.started, xvmcAtLastUserAction: 0n, lastUserActionTime: mocks.started, mandatoryTimeToServe: 0n });
  transferStakeToAnotherWallet = mocks.transfer;
} }));
const wallet = { address: "0x0000000000000000000000000000000000000001", getSigner: async () => ({ getAddress: async () => "0x0000000000000000000000000000000000000001" }) } as WalletState;
beforeEach(() => {
  mocks.failRead = false;
  mocks.shares = 3n * 10n ** 18n; mocks.started = BigInt(Math.floor(Date.now() / 1000) - 10);
  mocks.transfer.mockReset().mockResolvedValue({ wait: async () => ({ status: 1 }) });
  Object.assign(mocks.transfer, { staticCall: vi.fn(async () => undefined) });
  vi.stubGlobal("fetch", vi.fn(async () => ({ json: async () => [{ priceUsd: "1" }] })));
});
afterEach(() => vi.unstubAllGlobals());
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
