import { GovernanceActionControls } from "./GovernanceActions";
import { useState } from "react";
import { ScrollRegion } from "../../components/ScrollRegion";
import { useQuietRead } from "../../hooks/useQuietRead";
import { formatUnits } from "ethers";
import { ProposalCard, ProposalStatus, ProposalVotes } from "./ProposalPresentation";
import {
  classifyParameterProposal,
  formatParameterValue,
  loadParameterProposals,
  type ParameterModule,
  type ParameterProposal,
} from "./parameterProposals";

const EXPLANATIONS: Record<ParameterModule, string> = {
  fees: "Mining-fee proposals use a fixed seven-day base window, plus their extra delay. Deposit and referral percentages use a different scale from the hourly funding rate. Enforcing a change also needs a separate vault-sync transaction.",
  votecost: "These proposals change the minimum voting-credit cost used by proposal creation and related thresholds. Ordinary credit votes do not all have this minimum. Amounts below are DEGEN voting credit, not wallet token balances.",
  delay: "These proposals change the governor’s base review delay. Their current timing is calculated using the governor value at the snapshot block, not the delay they propose. Mining-fee proposals have their own fixed window.",
};

const STATE_LABELS = {
  finished: "Finished — outcome not verified",
  voting: "Voting window",
  vetoable: "Veto window — against leads",
  settling: "At review boundary — wait for next block",
  "review-complete": "Review complete — execution not verified",
};

function proposedChange(module: ParameterModule, proposal: ParameterProposal): string {
  const value = formatParameterValue(module, proposal);
  if (module !== "fees") return module === "votecost" ? `${value} credit` : value;
  const label = proposal.feeType === 0n ? "Deposit fee"
    : proposal.feeType === 1n ? "Hourly funding rate"
    : proposal.feeType === 2n ? "Referral bonus" : `Unknown fee type ${proposal.feeType ?? "—"}`;
  return `${label}: ${value}`;
}

export function isParameterModule(value: string): value is ParameterModule {
  return value === "fees" || value === "votecost" || value === "delay";
}

export function ParameterProposals({ module }: { module: ParameterModule }) {
  const [history, setHistory] = useState(false);
  const [limit, setLimit] = useState(20);
  const current = useQuietRead(`governance:parameters:${module}`, () => loadParameterProposals(module));
  const data = current.data;
  const failed = data?.rows.filter(row => row.status === "error").length ?? 0;
  // A failed read cannot safely be classified as either open or finished.
  const rows = data?.rows.filter(row => row.status === "error" || row.proposal.valid !== history);

  return <section className="gov-card" aria-label="On-chain parameter proposals">
    <div className="gov-prop-header">
      <div><h2>Proposals</h2><p className="gov-proposal-caption">On-chain review <span>On-chain</span></p></div>
      <div className="gov-prop-toggle">
        <button aria-pressed={!history} className={!history ? "active" : undefined} onClick={() => setHistory(false)}>Open</button>
        <button aria-pressed={history} className={history ? "active" : undefined} onClick={() => setHistory(true)}>History</button>
      </div>
    </div>
    {module === "fees" && <section className="gov-fee-sync" aria-label="Current vault fee synchronization"><p className="gov-form-note">After enforcing a fee change, synchronize the current deposit and funding fees to registered vaults. Each vault is checked separately.</p><GovernanceActionControls module="fees" proposalId="" verified valid={false} /></section>}
    {failed > 0 && <p role="alert" className="gov-prop-error">
      {failed} proposal {failed === 1 ? "read failed" : "reads failed"}. Unverified IDs remain in both views.
    </p>}
    {!data && current.error ? <p role="alert" className="gov-prop-error">Unable to verify proposals on PulseChain.</p>
      : !data ? <p role="status" className="gov-empty-note">Checking on-chain proposals…</p>
      : !rows?.length ? <p className="gov-empty-note">No {history ? "finished" : "open"} proposals at this snapshot.</p>
      : <ScrollRegion label={history ? "Parameter proposal history" : "Open parameter proposals"} resetKey={`${module}:${history}`} contentClassName="gov-proposal-list">{rows.slice(0, limit).map(row => <ProposalCard key={row.id} id={row.id}
        title={module === "fees" ? "Mining fee update" : module === "votecost" ? "Voting cost update" : "Review delay update"}
        fields={[{ label: "Proposed change", value: row.status === "verified" ? proposedChange(module, row.proposal) : "Unverified" }]}
        votes={row.status === "verified" ? <ProposalVotes forVotes={row.proposal.votesFor} againstVotes={row.proposal.votesAgainst} /> : undefined}
        action={row.status === "verified" && row.proposal.valid ? <GovernanceActionControls module={module} proposalId={row.id} verified valid={row.proposal.valid} phase={classifyParameterProposal(module, row.proposal, data.baseDelay, data.timestamp)} /> : undefined}
        status={<ProposalStatus verified={row.status === "verified"} text={row.status === "verified" ? STATE_LABELS[classifyParameterProposal(module, row.proposal, data.baseDelay, data.timestamp)] : row.message} />}
      />)}</ScrollRegion>}
    {rows && rows.length > limit && <button className="gov-action-btn" onClick={() => setLimit(value => value + 20)}>Show more</button>}
    <details className="gov-source-details"><summary>Data sources & verification</summary>
      <p className="gov-explain">{EXPLANATIONS[module]}</p>
      {data && <p className="gov-chain-note">
        {data.rows.length - failed} of {data.rows.length} proposal IDs verified.
        {" "}Current minimum proposal cost: {formatUnits(data.costToVote, 18)} DEGEN credit; some proposal families require a multiple.
      </p>}
      <p className="gov-chain-note">Finished means no longer valid, not necessarily executed. Timing alone does not prove an action will succeed. Actions recheck current contract rules and verify transaction outcomes.</p>
    </details>
  </section>;
}
