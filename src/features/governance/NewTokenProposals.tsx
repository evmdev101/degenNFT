import { GovernanceActionControls } from "./GovernanceActions";
import { useState } from "react";
import { ScrollRegion } from "../../components/ScrollRegion";
import { useQuietRead } from "../../hooks/useQuietRead";
import { formatUnits } from "ethers";
import { loadNewTokens, newTokenState } from "./newToken";
import { ProposalCard, ProposalStatus, ProposalVotes } from "./ProposalPresentation";

export function NewTokenProposals() {
  const [history, setHistory] = useState(false);
  const [limit, setLimit] = useState(20);
  const { data, error } = useQuietRead("governance:new-pools", loadNewTokens);
  const rows = data?.rows.filter(row => !row.proposal || row.proposal.valid !== history);
  return <div className="gov-card">
    <div className="gov-prop-header"><div><h2>Proposals</h2><p className="gov-proposal-caption">On-chain review <span>On-chain</span></p></div><div className="gov-prop-toggle">
      <button aria-pressed={!history} className={!history ? "active" : undefined} onClick={() => setHistory(false)}>Open</button>
      <button aria-pressed={history} className={history ? "active" : undefined} onClick={() => setHistory(true)}>History</button>
    </div></div>
    {!data && error ? <p role="alert">{error}</p> : !data ? <p className="gov-empty-note">Checking on-chain proposals…</p> : !rows?.length ? <p className="gov-empty-note">No {history ? "finished" : "open"} proposals.</p> :
      <ScrollRegion label={history ? "Reward pool proposal history" : "Open reward pool proposals"} resetKey={history} contentClassName="gov-proposal-list">{rows.slice(0, limit).map(row => <ProposalCard key={row.id} id={row.id} title="New reward pool"
        fields={[{ label: "Proposed pool", value: row.proposal ? <a className="gov-address-cell" href={`https://scan.pulsechain.com/address/${row.proposal.newPool}`} target="_blank" rel="noreferrer">{row.proposal.newPool}</a> : "Unverified" }]}
        votes={row.proposal ? <ProposalVotes forVotes={row.proposal.votesFor} againstVotes={row.proposal.votesAgainst} /> : undefined}
        action={row.proposal ? <GovernanceActionControls module="newtoken" proposalId={row.id} verified valid={row.proposal.valid} phase={data.timestamp > row.proposal.createdAt + row.proposal.extraDelay && row.proposal.votesAgainst > row.proposal.votesFor ? "vetoable" : data.timestamp < row.proposal.createdAt + row.proposal.extraDelay + data.delay ? "voting" : "enforceable"} /> : undefined}
        status={<ProposalStatus verified={!!row.proposal} text={row.proposal ? newTokenState(row.proposal, data.delay, data.cost, data.timestamp) : row.error ?? "Read failed"} />}
      />)}</ScrollRegion>}
    {rows && rows.length > limit && <button className="gov-action-btn" onClick={() => setLimit(value => value + 20)}>Show more</button>}
    <details className="gov-source-details"><summary>Data sources & verification</summary>
      <p className="gov-explain">These proposals add a reward pool. The support threshold can change and has no public getter. A fresh simulation checks the current rule before your wallet opens. Finished means no longer valid, not necessarily executed.</p>
      {data && <p className="gov-chain-note">{data.rows.filter(row => row.proposal).length} of {data.rows.length} proposal IDs verified.</p>}
    </details>
  </div>;
}
