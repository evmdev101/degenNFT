import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, useLocation } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { DocsPage } from "../src/features/DocsPage";
import { CONTRACTS } from "../src/config/contracts";

function LocationProbe() {
  const location = useLocation();
  return <output data-testid="docs-location">{location.pathname}{location.search}</output>;
}
function page(path = "/protocol") {
  return <MemoryRouter initialEntries={[path]}><DocsPage /><LocationProbe /></MemoryRouter>;
}

describe("DEGEN documentation", () => {
  it("opens the public guides with working internal and source links", () => {
    render(page());
    expect(screen.getByRole("heading", { level: 1, name: "Understand the protocol." })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Start here" })).toBeInTheDocument();
    const nav = within(screen.getByRole("navigation", { name: "Documentation sections" }));
    expect(nav.getByRole("link", { name: "Guides & sources" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("heading", { name: "How it works" }).closest("a")).toHaveAttribute("href", "/how-it-works");
    expect(screen.getByRole("heading", { name: "DEGEN interface source" }).closest("a")).toHaveAttribute("href", "https://github.com/degenstrategy/interface");
    expect(screen.queryByRole("button", { name: /Connect wallet/i })).not.toBeInTheDocument();
  });

  it("loads FAQ deep links and preserves other URL parameters when changing section", async () => {
    const user = userEvent.setup();
    render(page("/protocol?section=faq&from=guide"));
    expect(screen.getByRole("heading", { name: "Frequently asked questions" })).toBeInTheDocument();
    const nav = within(screen.getByRole("navigation", { name: "Documentation sections" }));
    await user.click(nav.getByRole("link", { name: "Contracts", exact: true }));
    expect(screen.getByRole("heading", { name: "Contract directory" })).toBeInTheDocument();
    expect(screen.getByTestId("docs-location")).toHaveTextContent("/protocol?section=contracts&from=guide");
    const nft = screen.getByRole("heading", { name: "NFT miner", exact: true }).closest("article")!;
    expect(within(nft).getByRole("link", { name: "View contract ↗" })).toHaveAttribute("href", `https://scan.pulsechain.com/address/${CONTRACTS.nft}`);
    expect(within(nft).getByRole("button", { name: "Copy NFT miner address" })).toBeInTheDocument();
  });

  it("searches the full answers and expands matching FAQs", async () => {
    const user = userEvent.setup();
    render(page());
    await user.type(screen.getByRole("searchbox", { name: "Find a topic" }), "ERC-1155 quantity");
    expect(screen.getByRole("heading", { name: "Search results" })).toBeInTheDocument();
    const summary = screen.getByText("What do I receive when I mint an NFT?");
    expect(summary.closest("details")).toHaveAttribute("open");
    expect(summary.closest("details")).toHaveTextContent("token ID 1");
    expect(summary.closest("details")).toHaveTextContent("paying wallet");
  });

  it("finds full contract addresses regardless of case and can clear an empty search", async () => {
    const user = userEvent.setup();
    render(page("/protocol?section=faq"));
    const search = screen.getByRole("searchbox", { name: "Find a topic" });
    await user.type(search, CONTRACTS.mint.toUpperCase());
    expect(screen.getByRole("heading", { name: "Matching contracts" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "NFT purchases", exact: true })).toBeInTheDocument();
    await user.clear(search);
    await user.type(search, "zzzz-no-matching-topic");
    expect(screen.getByText(/No topics match/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Clear search" }));
    expect(search).toHaveValue("");
    expect(screen.getByRole("heading", { name: "Frequently asked questions" })).toBeInTheDocument();
  });

  it("falls back to guides for an unknown section", () => {
    render(page("/protocol?section=unknown"));
    expect(screen.getByRole("heading", { name: "Start here" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Contract directory", level: 2 })).not.toBeInTheDocument();
  });
});
