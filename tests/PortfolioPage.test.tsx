import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PortfolioPage } from "../src/features/PortfolioPage";
import { readPortfolio, type PortfolioSnapshot } from "../src/features/dashboard/portfolioData";
import type { WalletState } from "../src/hooks/useWallet";
vi.mock("../src/features/dashboard/portfolioData", () => ({ readPortfolio: vi.fn() }));
const account = "0x0000000000000000000000000000000000000001";
const wallet = { address: account, chainId: 369n, isWrongNetwork: false, connect: vi.fn(), switchNetwork: vi.fn(), getSigner: vi.fn() } as unknown as WalletState;
function snapshot(): PortfolioSnapshot {
  return { account, blockNumber: 123, observedAt: Date.now(), degenPriceUsd: 1,
    wallet: { raw: 10n * 10n ** 18n, usd: 10 },
    miners: { raw: 20n * 10n ** 18n, usd: 20, count: 2, matureCount: 1, knownRaw: 20n * 10n ** 18n, knownCount: 2, complete: true, pools: [{ address: account, label: "1 year", raw: 20n * 10n ** 18n, usd: 20, count: 2, matureCount: 1, complete: true }] },
    farms: { usd: 5, knownUsd: 5, positionCount: 1, complete: true, positions: [{ address: account, name: "OINK–PLS V2 LP", tokenAddress: account, decimals: 18, depositedRaw: 3n * 10n ** 18n, usd: 5, pendingRaw: 100n * 10n ** 18n, stakeCount: 1, complete: true }] },
    rewards: { farmRaw: 100n * 10n ** 18n, helperRaw: 0n, totalRaw: 100n * 10n ** 18n, usd: 100, complete: true },
    nft: { countRaw: 2n, pendingDegenRaw: 4n * 10n ** 18n, pendingOinkRaw: 5n * 10n ** 18n }, totalUsd: 35, knownTotalUsd: 35, complete: true };
}
const page = (state = wallet) => <MemoryRouter><PortfolioPage wallet={state} /></MemoryRouter>;
beforeEach(() => { vi.mocked(readPortfolio).mockReset().mockResolvedValue(snapshot()); vi.clearAllMocks(); });
describe("Portfolio tab", () => {
  it("allows disconnected and wrong-network visitors to view the layout without reading wallet data", () => {
    const view = render(page({ ...wallet, address: null }));
    expect(screen.getByRole("button", { name: "Connect wallet" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("—");
    view.rerender(page({ ...wallet, chainId: 1n, isWrongNetwork: true }));
    expect(screen.getByRole("button", { name: "Switch to PulseChain" })).toBeInTheDocument();
    expect(readPortfolio).not.toHaveBeenCalled();
  });
  it("shows principal value and keeps pending and NFT balances separate, without requesting a signature", async () => {
    render(page());
    await screen.findByRole("heading", { name: "$35.00", level: 1 });
    expect(screen.getByRole("link", { name: "Manage miners →" })).toHaveAttribute("href", "/my-miners");
    expect(screen.getByRole("link", { name: "Manage farms →" })).toHaveAttribute("href", "/farms");
    expect(screen.getAllByText("Pending farm rewards")).toHaveLength(2);
    expect(screen.getByRole("region", { name: "Farm deposit balances" })).toHaveTextContent("3 LP");
    expect(screen.queryByText(/excluded from portfolio value/)).not.toBeInTheDocument();
    expect(wallet.getSigner).not.toHaveBeenCalled();
  });
  it("labels an incomplete subtotal and leaves the complete total unavailable", async () => {
    const data = snapshot(); data.totalUsd = null; data.complete = false; data.miners.usd = null;
    vi.mocked(readPortfolio).mockResolvedValue(data);
    render(page());
    await screen.findByText(/Known subtotal:/);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("—");
    expect(screen.queryByRole("status", { name: "Portfolio data status" })).not.toBeInTheDocument();
  });
  it("does not show the previous wallet's balances while a new wallet is loading", async () => {
    const view = render(page());
    await screen.findByRole("heading", { level: 1, name: "$35.00" });
    vi.mocked(readPortfolio).mockImplementationOnce(() => new Promise(() => {}));
    const nextAccount = "0x0000000000000000000000000000000000000002";
    view.rerender(page({ ...wallet, address: nextAccount }));
    await waitFor(() => expect(readPortfolio).toHaveBeenLastCalledWith(nextAccount));
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("—");
    expect(screen.queryByRole("status", { name: "Portfolio data status" })).not.toBeInTheDocument();
  });
  it("shows balances without stale-data notices, wallet metadata or manual refresh controls", async () => {
    const data = snapshot(); data.observedAt -= 300_000;
    vi.mocked(readPortfolio).mockResolvedValue(data);
    render(page());
    await screen.findByRole("heading", { level: 1, name: "$35.00" });
    expect(screen.queryByText(/out of date/)).not.toBeInTheDocument();
    expect(screen.queryByText("Connected wallet")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Refresh balances" })).not.toBeInTheDocument();
    expect(screen.getByText("10 DEGEN")).toBeInTheDocument();
    expect(screen.queryByText(/Balances at block|Last loaded:/)).not.toBeInTheDocument();
  });
  it("retains balances during an automatic refresh and then updates them", async () => {
    let finish!: (data: PortfolioSnapshot) => void;
    vi.mocked(readPortfolio).mockResolvedValueOnce(snapshot()).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    render(page());
    await screen.findByRole("heading", { level: 1, name: "$35.00" });
    fireEvent(window, new Event("degen:transaction-confirmed"));
    await waitFor(() => expect(readPortfolio).toHaveBeenCalledTimes(2));
    expect(screen.queryByRole("status", { name: "Portfolio data status" })).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("$35.00");
    const updated = snapshot(); updated.wallet = { raw: 1527n * 10n ** 16n, usd: 15.27 }; updated.totalUsd = 40.27; updated.knownTotalUsd = 40.27;
    await act(async () => finish(updated));
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("$40.27");
    expect(screen.queryByRole("status", { name: "Portfolio data status" })).not.toBeInTheDocument();
  });
  it("does not display a snapshot returned for a different wallet", async () => {
    const data = snapshot(); data.account = "0x0000000000000000000000000000000000000099";
    vi.mocked(readPortfolio).mockResolvedValue(data);
    render(page());
    await waitFor(() => expect(readPortfolio).toHaveBeenCalled());
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("—");
    expect(screen.queryByText("$35.00")).not.toBeInTheDocument();
  });
  it("reports unavailable NFT reads without turning missing rewards into zero", async () => {
    const data = snapshot(); data.nft.pendingDegenRaw = null;
    vi.mocked(readPortfolio).mockResolvedValue(data);
    render(page());
    await screen.findByRole("heading", { level: 1, name: "$35.00" });
    expect(screen.queryByRole("status", { name: "NFT data status" })).not.toBeInTheDocument();
    expect(screen.getByText("Pending DEGEN").nextElementSibling).toHaveTextContent("—");
  });
});
