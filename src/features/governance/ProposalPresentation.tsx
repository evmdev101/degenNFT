import { formatUnits } from "ethers";
import type { ReactNode } from "react";

export type ProposalCardField = { label: string; value: ReactNode };

export function ProposalCard({ id, title, status, fields, votes, votesLabel = "DEGEN credit", metadata = [], action }: {
  id?: string; title: ReactNode; status: ReactNode; fields: ProposalCardField[];
  votes?: ReactNode; votesLabel?: string; metadata?: ProposalCardField[]; action?: ReactNode;
}) {
  return <article className="gov-proposal-card" aria-label={id ? `Proposal ${id}` : "Legacy proposal"}>
    <header className="gov-card-head">
      <div><p className="gov-proposal-number">{id ? `Proposal #${id}` : "Legacy record · ID unavailable"}</p>
        <div className="gov-card-title" role="heading" aria-level={3}>{title}</div></div>
      {status}
    </header>
    <div className="gov-card-body">
      <dl className="gov-change-values">{fields.map((field, index) => <div key={`${field.label}-${index}`}>
        <dt>{field.label}</dt><dd>{field.value}</dd>
      </div>)}</dl>
      {votes && <div className="gov-card-votes"><p>Voting commitment <span>{votesLabel}</span></p>{votes}</div>}
    </div>
    {(metadata.length > 0 || action) && <footer className="gov-card-footer">
      {metadata.length > 0 && <details className="gov-record-details"><summary>Record details</summary>
        <dl>{metadata.map((field, index) => <div key={`${field.label}-${index}`}><dt>{field.label}</dt><dd>{field.value}</dd></div>)}</dl>
      </details>}
      {action}
    </footer>}
  </article>;
}

/** Presentation only: never use cleaned API text to authorize an action. */
export function cleanProposalText(text: string): string {
  return text.replace(/✅|✔️?|☑️?/gu, "Approved")
    .replace(/❌|✖️?|❎/gu, "Rejected")
    .replace(/⚠️?/gu, "Warning")
    .replace(/[\p{Extended_Pictographic}\uFE0F\u200D]/gu, "")
    .replace(/\s*\(View\)\s*$/i, "")
    .replace(/\s+/g, " ").trim();
}

export function proposalColumnLabel(header: string): string {
  const labels: Record<string, string> = {
    "for pool": "Pool",
    "degen committed": "Votes · DEGEN credit",
    "commitment": "Voting commitment",
    "credit for / against": "Votes · DEGEN credit",
    "validates in": "Proposal status",
    "on-chain state": "Proposal status",
    "user rep": "Representative · legacy",
    "action": "Action · locked",
  };
  return labels[header.trim().toLowerCase()] ?? cleanProposalText(header);
}

function creditNumber(value: bigint): string {
  const [whole, fraction] = formatUnits(value, 18).split(".");
  const decimals = fraction?.replace(/0+$/, "");
  return `${BigInt(whole).toLocaleString("en-US")}${decimals ? `.${decimals}` : ""}`;
}

export function ProposalVotes({ forVotes, againstVotes }: { forVotes: bigint; againstVotes: bigint }) {
  return <VoteTotals support={creditNumber(forVotes)} opposition={creditNumber(againstVotes)} />;
}

function VoteTotals({ support, opposition }: { support: string; opposition: string }) {
  return <div className="gov-vote-totals" aria-label={`${support} DEGEN credit for; ${opposition} DEGEN credit against`}>
    <div><span>For</span><strong>{support}</strong></div>
    <div><span>Against</span><strong>{opposition}</strong></div>
  </div>;
}

export function ProposalStatus({ text, verified = false }: { text: string; verified?: boolean }) {
  const detail = cleanProposalText(text);
  let label = "Unverified";
  let tone = "neutral";
  if (verified) {
    if (/Blocked:|would revert/i.test(detail)) { label = "Execution blocked"; tone = "warning"; }
    else if (/^Finished/i.test(detail)) label = "Finished";
    else if (/veto/i.test(detail)) { label = "Opposition leads"; tone = "warning"; }
    else if (/^Ready to finalize rejection|^Credit vote failed/i.test(detail)) { label = "Rejection pending"; tone = "warning"; }
    else if (/^Ready for final approval/i.test(detail)) label = "Approval pending";
    else if (/scheduled/i.test(detail)) label = "Scheduled";
    else if (/^Voting until|^DEGEN credit voting|^Locked-miner consensus|^Voting window|^Credit voting open/i.test(detail)) { label = "Voting open"; tone = "active"; }
    else if (/^Ready to enforce|^Review complete/i.test(detail)) label = "Review complete";
    else if (/next block|review boundary/i.test(detail)) label = "Awaiting next block";
  }
  const description = /^Ready to enforce on-chain$/i.test(detail)
    ? "Timing requirements met. Execution not yet verified."
    : detail;
  return <div className="gov-status-cell">
    <span className={`gov-status-badge gov-status-${tone}`}>{label}</span>
    {description && <span className="gov-cell-detail">{!verified && !/^Unverified/i.test(description) ? "Legacy feed: " : ""}{description}</span>}
  </div>;
}

export function ProposalTextCell({ header, text, verified = false }: { header: string; text: string; verified?: boolean }) {
  const key = header.trim().toLowerCase();
  if (["validates in", "status", "on-chain state"].includes(key)) {
    return <ProposalStatus text={text} verified={verified} />;
  }
  const clean = cleanProposalText(text);
  if (key === "for pool") {
    const match = clean.match(/^(.*?)\s*·\s*(Pool #\d+)$/);
    return <div className="gov-pool-cell"><strong>{match?.[1] || clean || "Unknown pool"}</strong>
      {match && <span className="gov-cell-detail">{match[2]}</span>}</div>;
  }
  if (["user rep", "proposer", "enforcer", "rejector", "recipient"].includes(key)) {
    return <span className="gov-address-cell">{clean || "—"}</span>;
  }
  return <span className="gov-cell-value">{clean || "—"}</span>;
}
