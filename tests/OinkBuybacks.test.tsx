import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { OinkBuybacks } from "../src/features/dashboard/OinkBuybacks";
import { OINK_BUYBACK_ADDRESS, type BuybackSnapshot } from "../src/features/dashboard/buybackData";
const mocks = vi.hoisted(() => ({ read: vi.fn() }));
vi.mock("../src/features/dashboard/buybackData", async original => ({ ...await original<typeof import("../src/features/dashboard/buybackData")>(), readPublicBuybacks: mocks.read }));
const unit = 10n ** 18n;
function snapshot(): BuybackSnapshot {
  const timestamp = Math.floor(Date.now() / 1000);
  return { block: 100, timestamp, hash: `0x${"1".repeat(64)}`, totalOinkRaw: 700n * unit, totalSpentRaw: 1400n * unit,
    rows: Array.from({ length: 7 }, (_, i) => ({ address: OINK_BUYBACK_ADDRESS, key: `row-${i}`, tx: `0x${String(i + 1).padStart(64, "0")}`, block: 100 - i,
      blockHash: `0x${String(100 - i).padStart(64, "0")}`, index: 0, timestamp: timestamp - (i === 6 ? 40 : i) * 86400,
      spentRaw: 200n * unit, oinkRaw: 100n * unit })) };
}
beforeEach(() => { mocks.read.mockReset(); });
describe("OINK buyback dashboard", () => {
  it("separates cumulative purchases from current reserves and reveals real transaction links", async () => {
    mocks.read.mockResolvedValue(snapshot());
    render(<OinkBuybacks treasuryOinkRaw={500n * unit} oinkPriceUsd={2} />);
    const stats = within(screen.getByLabelText("OINK buyback statistics"));
    await stats.findByText("700", { exact: false });
    expect(stats.getByText("Recorded OINK bought").parentElement).toHaveTextContent("700 OINK");
    expect(stats.getByText("OINK held in treasury").parentElement).toHaveTextContent("500 OINK");
    expect(stats.getByText("Recorded PLS spent").parentElement).toHaveTextContent("1.4K PLS");
    expect(stats.getByText("Buybacks recorded").parentElement).toHaveTextContent("7");
    expect(stats.getByText("Recorded OINK bought").parentElement).toHaveTextContent("Current value: $1,400.00 USD");
    fireEvent.click(screen.getByRole("button", { name: "30D" }));
    expect(screen.getByRole("img", { name: "OINK buybacks over last 30 days: 600 OINK" })).toBeVisible();
    const rows = () => screen.getAllByRole("link").filter(link => link.getAttribute("href")?.includes("/tx/"));
    expect(rows()).toHaveLength(5);
    fireEvent.click(screen.getByRole("button", { name: "Show more buybacks" }));
    expect(rows()).toHaveLength(7);
    expect(rows()[0]).toHaveAttribute("href", `https://scan.pulsechain.com/tx/0x${"1".padStart(64, "0")}`);
    expect(screen.queryByRole("button", { name: /refresh/i })).not.toBeInTheDocument();
  });
  it("does not turn unavailable history into zero purchases", async () => {
    mocks.read.mockRejectedValue(new Error("RPC unavailable"));
    render(<OinkBuybacks />);
    await screen.findByText("Buyback history is unavailable.");
    expect(screen.getByText("Recorded OINK bought").parentElement).toHaveTextContent("— OINK");
    expect(screen.queryByText("No purchases recorded")).not.toBeInTheDocument();
    expect(screen.queryByText("No buybacks recorded.")).not.toBeInTheDocument();
  });
  it("includes the exact 30-day boundary consistently in the chart and recent totals", async () => {
    const data = snapshot();
    data.rows[6].timestamp = data.timestamp - 30 * 86400;
    mocks.read.mockResolvedValue(data);
    render(<OinkBuybacks />);
    await screen.findByRole("button", { name: "30D" });
    fireEvent.click(screen.getByRole("button", { name: "30D" }));
    expect(screen.getByRole("img", { name: "OINK buybacks over last 30 days: 700 OINK" })).toBeVisible();
    const windows = within(screen.getByLabelText("Recent buyback totals"));
    expect(windows.getByText("30 days").parentElement).toHaveTextContent("700 OINK bought7 buybacks");
  });
  it("switches chart ranges and lets keyboard users inspect real intervals", async () => {
    mocks.read.mockResolvedValue(snapshot());
    render(<OinkBuybacks />);
    const chart = await screen.findByRole("img", { name: "OINK buybacks over last 24 hours: 200 OINK" });
    expect(screen.getByRole("button", { name: "24H" })).toHaveAttribute("aria-pressed", "true");
    fireEvent.keyDown(chart, { key: "End" });
    expect(document.getElementById("buyback-chart-readout")).toHaveTextContent("100 OINK1 buyback");
    fireEvent.keyDown(chart, { key: "Escape" });
    expect(document.getElementById("buyback-chart-readout")).toHaveTextContent("200 OINK bought2 buybacks");
    fireEvent.click(screen.getByRole("button", { name: "7D" }));
    expect(screen.getByRole("img", { name: "OINK buybacks over last 7 days: 600 OINK" })).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "All" }));
    expect(screen.getByRole("img", { name: "OINK buybacks over all recorded history: 700 OINK" })).toBeVisible();
    expect(screen.getByRole("button", { name: "All" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText("Recorded OINK bought").parentElement).toHaveTextContent("700 OINK");
  });
});
