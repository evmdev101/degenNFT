import type { ComponentProps } from "react";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { GovernanceProposalAction, GovernanceProposalCards, GovernanceProposalCell } from "../src/features/GovernancePage";
import { cleanProposalText, proposalColumnLabel, ProposalStatus, ProposalTextCell, ProposalVotes } from "../src/features/governance/ProposalPresentation";

type Row = ComponentProps<typeof GovernanceProposalCell>["row"];
const allocation: Row = {
  cells: [], actions: [{ label: "Enforce", proposalId: "8" }], proposalId: "8",
  rewardAllocation: {
    status: "verified", lifecycle: "enforceable", observedAt: 123, reviewEndsAt: 100,
    proposal: { valid: true, poolId: 21n, newAllocation: 15n, votesFor: 20n * 10n ** 18n, votesAgainst: 0n, extraDelay: 0n, createdAt: 10n },
  },
};
const treasury: Row = {
  cells: [], actions: [], proposalId: "14",
  treasury: {
    status: "verified", lifecycle: "finalizable-approval", observedAt: 123, creditVotingEndsAt: 50, finalizesAt: 100,
    consensusSupportRequired: 15n * 10n ** 18n,
    consensus: { votesFor: 20n * 10n ** 18n, votesAgainst: 1n * 10n ** 18n, totalStaked: 100n * 10n ** 18n },
    asset: { address: "0x0000000000000000000000000000000000000000", symbol: "PLS", decimals: 18 },
    proposal: { valid: true, createdAt: 1n, creditVotesFor: 100n * 10n ** 18n, creditVotesAgainst: 2n * 10n ** 18n, extraDelay: 0n,
      tokenAddress: "0x0000000000000000000000000000000000000000", beneficiary: "0x0000000000000000000000000000000000000001", amountToSend: 1n, consensusProposalId: 4n },
  },
};

describe("Governance proposal presentation", () => {
  it("renders exact large and zero credit totals with text labels, not emojis", () => {
    const value = 12345678901234567890123456789012345678n;
    const { container } = render(<ProposalVotes forVotes={value} againstVotes={0n} />);
    expect(screen.getByText("12,345,678,901,234,567,890.123456789012345678")).toBeInTheDocument();
    expect(screen.getByText("0")).toBeInTheDocument();
    expect(screen.getByText("For")).toBeInTheDocument();
    expect(screen.getByText("Against")).toBeInTheDocument();
    expect(container.textContent).not.toMatch(/\p{Extended_Pictographic}/u);
  });

  it("uses typed chain votes instead of stale API totals and handles commitment aliases", () => {
    const view = render(<GovernanceProposalCell row={allocation} category="allocation" header=" DEGEN COMMITTED " fallback="✅ 999 DEGEN" />);
    expect(screen.getByText("20")).toBeInTheDocument();
    expect(screen.queryByText(/999/)).not.toBeInTheDocument();
    view.rerender(<GovernanceProposalCell row={treasury} category="treasury" header="Commitment" fallback="999" />);
    expect(screen.getByText("100")).toBeInTheDocument();
    expect(screen.getByText("2")).toBeInTheDocument();
  });

  it("keeps cleaned legacy status explicitly unverified and never invents links", () => {
    const view = render(<ProposalTextCell header="status" text="✅ Enforced" />);
    expect(screen.getByText("Unverified")).toBeInTheDocument();
    expect(screen.getByText("Legacy feed: Approved Enforced")).toBeInTheDocument();
    view.rerender(<ProposalTextCell header="user rep" text="0x…677(View)" />);
    expect(screen.getByText("0x…677")).toBeInTheDocument();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
    expect(cleanProposalText("⚠️ Delay ❌ rejected ✔️ approved")).toBe("Warning Delay Rejected rejected Approved approved");
  });

  it("separates pool name and on-chain ID and preserves safe literal text", () => {
    const view = render(<ProposalTextCell header="for pool" text="EMIT-PLSX · Pool #21" verified />);
    expect(screen.getByText("EMIT-PLSX")).toBeInTheDocument();
    expect(screen.getByText("Pool #21")).toBeInTheDocument();
    view.rerender(<ProposalTextCell header="token" text={'<img src=x onerror="alert(1)">'} />);
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
  });

  it("preserves execution blockers, error messages, and the full treasury thresholds", () => {
    const view = render(<ProposalStatus verified text="Ready to enforce on-chain · Blocked: DEGEN tax exceeds 10%" />);
    expect(screen.getByText("Execution blocked")).toBeInTheDocument();
    expect(screen.getByText(/Blocked: DEGEN tax exceeds 10%/)).toBeInTheDocument();
    view.rerender(<GovernanceProposalCell row={{ cells: [], actions: [], rewardAllocation: { status: "error", message: "RPC unavailable" } }} category="allocation" header="validates in" fallback="Ready" />);
    expect(screen.getByText("Unverified — RPC unavailable")).toBeInTheDocument();
    view.rerender(<GovernanceProposalCell row={treasury} category="treasury" header="validates in" fallback="Expired" />);
    expect(screen.getByText("Approval pending")).toBeInTheDocument();
    expect(screen.getByText(/locked support 20 \/ 15 required · against 1/)).toBeInTheDocument();
  });

  it("does not equate timing readiness with execution or enable actions without a wallet", () => {
    render(<><GovernanceProposalCell row={allocation} category="allocation" header="validates in" fallback="Expired" />
      <GovernanceProposalAction row={allocation} category="allocation" /></>);
    expect(screen.getByText("Review complete")).toBeInTheDocument();
    expect(screen.getByText("Timing requirements met. Execution not yet verified.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Enforce" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Enforce" })).toHaveAccessibleDescription("Connect a wallet to use this action");
    expect(screen.getByRole("button", { name: "Enforce" })).not.toHaveAttribute("title");
  });

  it("renames display headers without losing the distinction between chain and legacy fields", () => {
    expect(proposalColumnLabel(" DEGEN COMMITTED ")).toBe("Votes · DEGEN credit");
    expect(proposalColumnLabel("Validates in")).toBe("Proposal status");
    expect(proposalColumnLabel("User Rep")).toBe("Representative · legacy");
    expect(proposalColumnLabel("Action")).toBe("Action · locked");
  });

  it("replaces the table with proposal cards without changing column-to-value mapping", () => {
    const headers = ["Action", "Allocation", "For Pool", "User Rep", "DEGEN Committed", "Validates in", "Custom history field"];
    render(<GovernanceProposalCards category="allocation" categoryLabel="Reward Allocation" table={{ headers, rows: [{
      ...allocation, cells: ["Enforce", "999% stale", "EMIT-PLSX", "0x…677(View)", "999 OINK stale", "Expired", "Extra history value", "Unheaded legacy value"],
    }] }} />);
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    expect(screen.getByRole("article", { name: "Proposal 8" })).toBeInTheDocument();
    expect(screen.getByText("EMIT-PLSX")).toBeInTheDocument();
    expect(screen.getByText("Pool #21")).toBeInTheDocument();
    expect(screen.getByText("0.15%")).toBeInTheDocument();
    expect(screen.getByText("20")).toBeInTheDocument();
    expect(screen.queryByText(/999/)).not.toBeInTheDocument();
    expect(screen.getByText("Extra history value")).toBeInTheDocument();
    expect(screen.getByText("Unheaded legacy value")).toBeInTheDocument();
    expect(screen.getByText("0x…677")).toBeInTheDocument();
    expect(screen.getByText("Record details").closest("details")).not.toHaveAttribute("open");
    expect(screen.getByRole("button", { name: "Enforce" })).toBeDisabled();
  });

  it("does not invent a proposal ID or credit units for a legacy-only record", () => {
    render(<GovernanceProposalCards category="emissions" categoryLabel="Emissions" table={{
      headers: ["Commitment", "Status"], rows: [{ cells: ["500 OINK", "✅ Enforced"], actions: [] }],
    }} />);
    expect(screen.getByRole("article", { name: "Legacy proposal" })).toBeInTheDocument();
    expect(screen.getByText("Legacy record · ID unavailable")).toBeInTheDocument();
    expect(screen.getByText("Legacy feed · units unverified")).toBeInTheDocument();
    expect(screen.getByText("500 OINK")).toBeInTheDocument();
    expect(screen.getByText("Unverified")).toBeInTheDocument();
    expect(screen.getByText("Legacy feed: Approved Enforced")).toBeInTheDocument();
  });
});
