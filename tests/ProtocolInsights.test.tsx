import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ProtocolInsights } from "../src/features/dashboard/ProtocolInsights";
import { MINER_POOLS } from "../src/features/dashboard/config";
import type { ProtocolOverviewSnapshot } from "../src/features/dashboard/protocolData";

const mocks = vi.hoisted(() => ({ read: vi.fn() }));
vi.mock("../src/features/dashboard/protocolData", async original => ({
  ...await original<typeof import("../src/features/dashboard/protocolData")>(), readPublicProtocolOverview: mocks.read,
}));
vi.mock("../src/features/dashboard/useOverviewSectionReady", () => ({ useOverviewSectionReady: () => ({ ref: { current: null }, ready: true }) }));

const U = 10n ** 18n;
const pairAddress = "0x0000000000000000000000000000000000000010";
const inactiveAddress = "0x0000000000000000000000000000000000000020";
function snapshot(overrides: Partial<ProtocolOverviewSnapshot> = {}): ProtocolOverviewSnapshot {
  const miners = [...MINER_POOLS].sort((a, b) => a.duration - b.duration).map((pool, index) => ({ ...pool,
    accountingRaw: BigInt(index + 1) * 100n * U, sharesRaw: BigInt(index + 1) * 10n * U, issuedRaw: 0n,
    dailyRewardsRaw: BigInt(index + 1) * U, apr: [1.5, 2.5, 5, 25][index], weightPercent: (index + 1) * 10,
  }));
  return {
    block: 1000, timestamp: Math.floor(Date.now() / 1000), hash: `0x${"1".repeat(64)}`,
    pools: [...miners.map((miner, id) => ({ id, address: miner.address, label: `${miner.label} DEGEN miners`, allocRaw: BigInt(id + 1) * 10n, percent: (id + 1) * 10 })),
      { id: 4, address: inactiveAddress, label: "Inactive registered pool", allocRaw: 0n, percent: 0 }],
    totalAllocRaw: 100n, rewardPerBlockRaw: U, miners, minerAccountingRaw: 1000n * U,
    minerSharesRaw: 100n * U, votingBaseRaw: 1000n * U,
    supply: { totalRaw: 10_000n * U, minerTokensRaw: 0n, pairTokensRaw: 1000n * U, otherRaw: 9000n * U },
    stats: { registeredPools: 5, allocatedPools: 4, nftPools: 2, governorProposals: 0, senators: null },
    blockSeconds: 12, pair: { address: pairAddress, baseSymbol: "DEGEN", quoteSymbol: "PLS" },
    virtualSupplyRaw: 10_000n * U, governorTokensRaw: 100n * U, treasuryTokensRaw: 200n * U,
    ...overrides,
  };
}
const article = (heading: string) => screen.getByRole("heading", { name: heading, exact: true }).closest("article")!;
const tile = (label: string) => screen.getByText(label, { selector: ".dash-metric > span:first-child" }).closest("article")!;
const draw = () => render(<MemoryRouter><ProtocolInsights /></MemoryRouter>);
const loaded = () => screen.findByRole("link", { name: /Open on Dexscreener/ });

beforeEach(() => { mocks.read.mockReset().mockResolvedValue(snapshot()); });

describe("DEGEN Overview protocol insights", () => {
  it("shows only DEGEN's four real durations, live APR values, and duration-specific creation links", async () => {
    draw();
    await loaded();
    const table = within(screen.getByRole("region", { name: "Mining rewards by duration table" }));
    const rows = table.getAllByRole("row");
    expect(rows).toHaveLength(5);
    expect(rows.slice(1).map(row => within(row).getAllByRole("cell")[0].textContent)).toEqual(["1 month", "3 months", "1 year", "10 years"]);
    expect(rows.slice(1).map(row => within(row).getAllByRole("cell")[1].textContent)).toEqual(["1.5%", "2.5%", "5.0%", "25.0%"]);
    expect(screen.getByRole("img", { name: /1 month: 1.5% estimated APR/ })).toHaveAccessibleName(/10 years: 25.0% estimated APR/);
    for (const miner of snapshot().miners) expect(screen.getByRole("link", { name: `Create ${miner.label} miner` })).toHaveAttribute("href", `/my-miners?tab=deploy&pool=${miner.address}`);
    expect(table.queryByText("6 months")).not.toBeInTheDocument();
    expect(table.queryByText("3 years")).not.toBeInTheDocument();
    expect(table.queryByText("5 years")).not.toBeInTheDocument();
    expect(screen.queryByText(/OINK/)).not.toBeInTheDocument();
  });

  it("uses the full allocation fractions and keeps inactive pools in the registry disclosure", async () => {
    draw();
    await loaded();
    const allocation = within(article("DEGEN reward allocation"));
    expect(allocation.getByRole("img", { name: /1 month DEGEN miners: 10.0000%/ })).toHaveAccessibleName(/10 years DEGEN miners: 40.0000%/);
    expect(allocation.queryByRole("link", { name: "Inactive registered pool" })).not.toBeInTheDocument();
    const disclosure = allocation.getByText("All 5 registered pools").closest("details")!;
    fireEvent.click(within(disclosure).getByText("All 5 registered pools"));
    const inactive = within(disclosure).getByRole("link", { name: "#4 · Inactive registered pool ↗" });
    expect(inactive).toBeVisible();
    expect(inactive).toHaveAttribute("href", `https://scan.pulsechain.com/address/${inactiveAddress}`);
    expect(within(inactive.parentElement!).getByText("0.0000%")).toBeInTheDocument();
    expect(within(tile("Registered pools")).getByText("5", { selector: "strong" })).toBeInTheDocument();
    expect(within(tile("Allocated pools")).getByText("4", { selector: "strong" })).toBeInTheDocument();
    expect(screen.queryByText("Senators")).not.toBeInTheDocument();
  });

  it("updates the selected supply location when a legend item is clicked and toggles back to total", async () => {
    draw();
    await loaded();
    const distribution = article("DEGEN supply by location");
    const summary = distribution.querySelector(".dash-distribution-summary")!;
    expect(summary).toHaveTextContent("Total DEGEN supply");
    expect(summary).toHaveTextContent("10K DEGEN");
    const legend = within(distribution).getByRole("button", { name: /Liquidity pair\s*1K DEGEN\s*10.0%/ });
    fireEvent.click(legend);
    expect(legend).toHaveAttribute("aria-pressed", "true");
    expect(summary).toHaveTextContent("Liquidity pair");
    expect(summary).toHaveTextContent("1K DEGEN");
    expect(summary).toHaveTextContent("10.0%");
    fireEvent.click(legend);
    expect(summary).toHaveTextContent("Total DEGEN supply");
    expect(summary).toHaveTextContent("10K DEGEN");
  });

  it("keeps issued supply separate from accounting credit and never adds the overlapping categories", async () => {
    draw();
    await loaded();
    const disclosure = screen.getByText("Show all DEGEN balances & supply").closest("details")!;
    fireEvent.click(screen.getByText("Show all DEGEN balances & supply"));
    const facts = within(disclosure);
    const value = (label: string) => facts.getByText(label).parentElement!;
    expect(value("Issued DEGEN supply")).toHaveTextContent("10,000 DEGEN");
    expect(value("DEGEN held by miner contracts")).toHaveTextContent("0 DEGEN");
    expect(value("Miner accounting value")).toHaveTextContent("1,000 DEGEN");
    expect(value("Governance voting base")).toHaveTextContent("1,000 DEGEN");
    expect(disclosure).not.toHaveTextContent("12,000");
    const supply = article("DEGEN supply by location");
    expect(supply.querySelector(".dash-distribution-summary")).toHaveTextContent("10K DEGEN");
    expect(article("Miners by lock-up").querySelector(".dash-distribution-summary")).toHaveTextContent("1K DEGEN");
  });

  it("embeds only the verified DEGEN pair and works without a wallet or refresh controls", async () => {
    draw();
    const link = await loaded();
    expect(link).toHaveAttribute("href", `https://dexscreener.com/pulsechain/${pairAddress}`);
    expect(screen.getByTitle("DEGEN / PLS market chart on Dexscreener")).toHaveAttribute("src", `https://dexscreener.com/pulsechain/${pairAddress}?embed=1&theme=dark&trades=0&info=0`);
    expect(screen.queryByRole("button", { name: /connect|refresh|retry/i })).not.toBeInTheDocument();
    expect(mocks.read).toHaveBeenCalledTimes(1);
  });

  it("does not fabricate zero values while data is loading or fields are unavailable", async () => {
    let finish!: (data: ProtocolOverviewSnapshot) => void;
    mocks.read.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    draw();
    expect(within(tile("Registered pools")).getByText("—", { selector: "strong" })).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Miner APR data unavailable" })).toBeInTheDocument();
    expect(within(screen.getByRole("region", { name: "Mining rewards by duration table" })).getAllByRole("row").slice(1).every(row => row.textContent?.includes("—"))).toBe(true);
    await waitFor(() => expect(mocks.read).toHaveBeenCalledOnce());
    await act(async () => finish(snapshot({ pools: null, pair: null,
      stats: { registeredPools: null, allocatedPools: null, nftPools: null, governorProposals: null, senators: null },
      supply: { totalRaw: null, minerTokensRaw: null, pairTokensRaw: null, otherRaw: null },
    })));
    expect(within(tile("Registered pools")).getByText("—", { selector: "strong" })).toBeInTheDocument();
    expect(screen.getByText("Trading pair unavailable.")).toBeInTheDocument();
    expect(screen.queryByTitle("DEGEN / PLS market chart on Dexscreener")).not.toBeInTheDocument();
    expect(article("DEGEN supply by location").querySelector(".dash-distribution-summary")).toHaveTextContent("— DEGEN");
  });

  it("shows the selected location as unavailable when that balance is missing rather than repeating total supply", async () => {
    mocks.read.mockResolvedValue(snapshot({ supply: { totalRaw: 10_000n * U, minerTokensRaw: 0n, pairTokensRaw: null, otherRaw: null } }));
    draw();
    await loaded();
    const distribution = article("DEGEN supply by location");
    const missing = within(distribution).getByRole("button", { name: /Liquidity pair\s*— DEGEN\s*—/ });
    fireEvent.click(missing);
    const summary = distribution.querySelector(".dash-distribution-summary")!;
    expect(summary).toHaveTextContent("Liquidity pair");
    expect(summary).toHaveTextContent("— DEGEN");
    expect(summary).not.toHaveTextContent("10K DEGEN");
  });

  it("keeps a failed read distinct from empty protocol statistics", async () => {
    mocks.read.mockRejectedValue(new Error("RPC unavailable"));
    draw();
    expect(await screen.findByRole("status")).toHaveTextContent("Protocol statistics are unavailable.");
    expect(within(tile("Registered pools")).getByText("—", { selector: "strong" })).toBeInTheDocument();
    expect(within(tile("Governor proposals")).getByText("—", { selector: "strong" })).toBeInTheDocument();
    expect(screen.queryByTitle("DEGEN / PLS market chart on Dexscreener")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /refresh|retry/i })).not.toBeInTheDocument();
  });
});
