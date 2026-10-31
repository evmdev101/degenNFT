import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TreasuryPositions } from "../src/features/dashboard/TreasuryFarming";
import { FARM_REGISTRY } from "../src/features/dashboard/config";
import type { TreasuryPositionsSnapshot } from "../src/features/dashboard/treasuryPositions";

const mocks = vi.hoisted(() => ({ read: vi.fn() }));
vi.mock("../src/features/dashboard/treasuryPositions", () => ({ readPublicTreasuryPositions: mocks.read }));
vi.mock("../src/features/dashboard/useOverviewSectionReady", () => ({ useOverviewSectionReady: () => ({ ref: { current: null }, ready: true }) }));
const empty = (): TreasuryPositionsSnapshot => ({ block: 101, timestamp: 1700000000, farms: [], farmingUsd: 0, walletUsd: 12, combinedUsd: 12 });
const totals = (label: string) => screen.getByText(label).parentElement!;
beforeEach(() => { mocks.read.mockReset(); });

describe("Treasury farming positions", () => {
  it("shows unknown totals while loading without claiming there are no deposits", () => {
    mocks.read.mockImplementation(() => new Promise(() => {}));
    render(<TreasuryPositions />);
    expect(totals("Farming value")).toHaveTextContent("—");
    expect(totals("Wallet + farm positions")).toHaveTextContent("—");
    expect(screen.queryByText("No deposits in the tracked DEGEN farms.")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /refresh|retry/i })).not.toBeInTheDocument();
  });

  it("shows verified empty deposits and all 25 tracked farm addresses with zero balances", async () => {
    const user = userEvent.setup();
    mocks.read.mockResolvedValue(empty());
    render(<TreasuryPositions />);
    await screen.findByText("No deposits in the tracked DEGEN farms.");
    expect(totals("Farming value")).toHaveTextContent("$0.00");
    expect(totals("Wallet + farm positions")).toHaveTextContent("$12.00");
    const summary = screen.getByText("View all 25 tracked farms");
    await user.click(summary);
    const details = summary.closest("details")!;
    expect(details).toHaveAttribute("open");
    expect(within(details).getAllByRole("link")).toHaveLength(FARM_REGISTRY.length);
    for (const farm of FARM_REGISTRY) {
      const link = within(details).getByRole("link", { name: `${farm.name} ↗` });
      expect(link).toHaveAttribute("href", `https://scan.pulsechain.com/address/${farm.address}`);
      expect(link.parentElement).toHaveTextContent("0");
    }
  });

  it("keeps failed farm amounts and totals unavailable rather than rendering zero deposits", async () => {
    const farm = FARM_REGISTRY[0];
    mocks.read.mockResolvedValue({ ...empty(), farmingUsd: null, combinedUsd: null,
      farms: [{ ...farm, tokenAddress: null, depositedRaw: null, usd: null, pendingRaw: null, stakeCount: null, complete: false }] });
    render(<TreasuryPositions />);
    await waitFor(() => expect(within(totals("Farming value").parentElement!).getByRole("link", { name: `${farm.name} ↗` })).toBeInTheDocument());
    expect(screen.queryByText("No deposits in the tracked DEGEN farms.")).not.toBeInTheDocument();
    expect(totals("Farming value")).toHaveTextContent("—");
    expect(totals("Wallet + farm positions")).toHaveTextContent("—");
    const row = within(totals("Farming value").parentElement!).getByRole("link", { name: `${farm.name} ↗` }).parentElement!;
    expect(within(row).getByRole("strong")).toHaveTextContent("—");
  });

  it("shows deposited principal and its totals without adding pending farm rewards", async () => {
    const farm = FARM_REGISTRY[0];
    mocks.read.mockResolvedValue({ ...empty(), farmingUsd: 10, combinedUsd: 22,
      farms: [{ ...farm, tokenAddress: null, depositedRaw: 1500n * 10n ** 15n, usd: 10, pendingRaw: 99999n * 10n ** 18n, stakeCount: 1, complete: true }] });
    render(<TreasuryPositions />);
    await waitFor(() => expect(totals("Farming value")).toHaveTextContent("$10.00"));
    expect(totals("Wallet + farm positions")).toHaveTextContent("$22.00");
    const row = within(totals("Farming value").parentElement!).getByRole("link", { name: `${farm.name} ↗` }).parentElement!;
    expect(row).toHaveTextContent("1.5");
    expect(row).not.toHaveTextContent("99,999");
  });

  it("reports a failed read without substituting a zero farm or combined balance", async () => {
    mocks.read.mockRejectedValue(new Error("RPC down"));
    render(<TreasuryPositions />);
    await screen.findByText("Treasury farm positions are unavailable.");
    expect(totals("Farming value")).toHaveTextContent("—");
    expect(totals("Wallet + farm positions")).toHaveTextContent("—");
    expect(screen.queryByText("No deposits in the tracked DEGEN farms.")).not.toBeInTheDocument();
  });
});
