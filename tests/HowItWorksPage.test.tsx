import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { HowItWorksPage } from "../src/features/HowItWorksPage";

describe("How it works guide", () => {
  it("explains DEGEN's three paths and links to the working pages", () => {
    render(<MemoryRouter><HowItWorksPage /></MemoryRouter>);
    expect(screen.getByRole("heading", { level: 1, name: "Your route through DEGEN." })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Explore miners →" })).toHaveAttribute("href", "/my-miners");
    expect(screen.getByRole("link", { name: "Explore farms →" })).toHaveAttribute("href", "/farms");
    expect(screen.getByRole("link", { name: "Explore NFT miners →" })).toHaveAttribute("href", "/nft");
    expect(screen.getByText("PLS → NFT miner → OINK + DEGEN rewards")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Read more in Docs →" })).toHaveAttribute("href", "/protocol?section=faq");
  });

  it("describes the four DEGEN durations and current governance availability", () => {
    render(<MemoryRouter><HowItWorksPage /></MemoryRouter>);
    for (const duration of ["1 month", "3 months", "1 year", "10 years"]) expect(screen.getByText(duration)).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "A miner’s timeline" })).toBeInTheDocument();
    expect(screen.getByText(/Governance transaction actions are temporarily paused/)).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Deploy a miner →" })).toHaveAttribute("href", "/my-miners?tab=deploy");
  });
});
