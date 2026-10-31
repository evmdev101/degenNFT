import { usePageActive } from "../../hooks/usePageActive";
import { HelpTip } from "../../components/HelpTip";
import { useEffect, useRef, useState } from "react";
import { formatUnits } from "ethers";
import type { WalletState } from "../../hooks/useWallet";
import { readableError, shortAddress } from "../../lib/chain";
import { CreationValidationError, submitGovernanceCreation } from "./creationTransactions";
import { loadGovernanceFormContext, type GovernanceFormContext } from "./formContext";
import { GOVERNANCE_CHAIN_ID, TREASURY_TOKEN_OPTIONS, type GovernanceModule } from "./governanceSpec";
import { EMPTY_PROPOSAL_DRAFT, type DraftErrors, type ProposalDraft } from "./proposalValidation";
import { proposalSimulationReader, runProposalPreflight, type ProposalPreflight } from "./proposalPreflight";
import { withGovernanceReadDeadline } from "./readDeadline";
import { rewardPoolOptionLabel } from "./rewardPoolNames";
import { GOVERNANCE_ACTIONS_DISABLED } from "../../config/publicPreview";

type Props = { module: GovernanceModule; title: string; subtitle: string; explain: string; wallet: Pick<WalletState, "address" | "chainId" | "getSigner"> };
const VALUE_LABELS: Record<GovernanceModule, string> = {
  allocation: "New Allocation (%)", rollover: "New Bonus (%)", tax: "New Tax (%)", emissions: "New Reward Amount (DEGEN per block)",
  treasury: "Amount to Send", newtoken: "", fees: "New Fee (%)", votecost: "New Minimum Cost (DEGEN credit)", delay: "New Delay Before Enforce (hours, 24–336)",
};
const MINER_LABELS = ["1 Month Miner", "3 Month Miner", "1 Year Miner", "10 Year Miner"];

// Account/network changes remount the workspace, so another wallet's credit or preview is never displayed.
export function GovernanceComposer(props: Props) {
  return <ComposerSession key={`${props.module}:${props.wallet.address?.toLowerCase() ?? "none"}:${props.wallet.chainId}`} {...props} />;
}

function ComposerSession({ module, title, subtitle, explain, wallet }: Props) {
  const [draft, setDraft] = useState<ProposalDraft>({ ...EMPTY_PROPOSAL_DRAFT, ...(module === "newtoken" ? { tokenAddress: "" } : {}) });
  const [tokenChoice, setTokenChoice] = useState<string>(EMPTY_PROPOSAL_DRAFT.tokenAddress);
  const [context, setContext] = useState<GovernanceFormContext>();
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [busy, setBusy] = useState(false);
  const [submitStatus, setSubmitStatus] = useState("");
  const [review, setReview] = useState<ProposalPreflight>();
  const [errors, setErrors] = useState<DraftErrors>({});
  const pageActive = usePageActive();
  const requestBusy = useRef(false);
  const activeRef = useRef(pageActive);
  activeRef.current = pageActive;
  const contextRef = useRef(context);
  contextRef.current = context;
  const alive = useRef(true), contextRequest = useRef(0), reviewRequest = useRef(0);

  useEffect(() => {
    alive.current = true;
    if (!pageActive) return;
    let timer: ReturnType<typeof setTimeout>;
    let stopped = false;
    let polling = false;
    const poll = async () => {
      if (polling || stopped) return;
      polling = true;
      if (!stopped && !document.hidden && !requestBusy.current) await refreshContext(true);
      polling = false;
      clearTimeout(timer);
      if (!stopped) timer = setTimeout(() => void poll(), 60_000);
    };
    const resume = () => { if (!document.hidden) { clearTimeout(timer); void poll(); } };
    void poll();
    document.addEventListener("visibilitychange", resume);
    window.addEventListener("degen:transaction-confirmed", resume);
    return () => { stopped = true; contextRequest.current++; clearTimeout(timer); document.removeEventListener("visibilitychange", resume); window.removeEventListener("degen:transaction-confirmed", resume); };
  }, [pageActive]);
  useEffect(() => () => { alive.current = false; contextRequest.current++; reviewRequest.current++; }, []);

  function invalidateReview() { reviewRequest.current++; setReview(undefined); setErrors({}); setSubmitStatus(""); }
  function update(key: keyof ProposalDraft, value: string) {
    invalidateReview();
    setDraft(previous => ({ ...previous, [key]: value }));
  }
  async function refreshContext(background = false) {
    const request = ++contextRequest.current;
    if (!background) invalidateReview();
    if (!contextRef.current) setLoading(true);
    setLoadError("");
    try {
      const next = await withGovernanceReadDeadline(loadGovernanceFormContext(module, wallet.address ?? undefined));
      if (alive.current && request === contextRequest.current) { setContext(next); }
    } catch (error) {
      if (alive.current && request === contextRequest.current) setLoadError(error instanceof Error ? error.message : "Contract rules unavailable");
    } finally { if (alive.current && request === contextRequest.current) setLoading(false); }
  }
  async function reviewProposal() {
    if (requestBusy.current) return;
    requestBusy.current = true;
    if (!wallet.address) { requestBusy.current = false; setErrors({ context: "Connect your wallet using the header to check available voting credit." }); return; }
    const request = ++reviewRequest.current, contextId = ++contextRequest.current;
    const current = () => alive.current && request === reviewRequest.current;
    setBusy(true); setReview(undefined); setErrors({}); setLoadError(""); if (!contextRef.current) setLoading(true);
    try {
      const result = await withGovernanceReadDeadline(proposalSimulationReader().then(reader => runProposalPreflight(module, { ...draft }, wallet.address!, wallet.chainId, reader)));
      if (!current()) return;
      setContext(result.context); setReview(result); setErrors(result.validation.errors);
    } catch (error) {
      if (current()) setErrors({ context: error instanceof Error ? error.message : "Review could not be completed." });
    } finally {
      requestBusy.current = false;
      if (alive.current) setBusy(false);
      if (alive.current && contextId === contextRequest.current) setLoading(false);
    }
  }
  async function submitProposal() {
    if (GOVERNANCE_ACTIONS_DISABLED || requestBusy.current) return;
    if (!wallet.address) { setErrors({ context: "Connect your wallet before submitting a proposal." }); return; }
    requestBusy.current = true;
    const request = ++reviewRequest.current;
    const current = () => alive.current && activeRef.current && request === reviewRequest.current;
    setBusy(true); setSubmitStatus(""); setErrors({}); setReview(undefined);
    try {
      const result = await submitGovernanceCreation(module, { ...draft }, wallet, current);
      if (current()) {
        setContext(result.preflight.context);
        setSubmitStatus(`Proposal #${result.id} created.`);
      }
      if (alive.current) await refreshContext(true);
    } catch (error) {
      if (!current()) return;
      if (error instanceof CreationValidationError) {
        setContext(error.preflight.context);
        setErrors(error.preflight.validation.errors);
        if (!Object.keys(error.preflight.validation.errors).length) setErrors({ context: readableError(error) });
      } else setErrors({ context: readableError(error) });
    } finally {
      requestBusy.current = false;
      if (alive.current) setBusy(false);
    }
  }
  const errorFor = (key: keyof ProposalDraft) => errors[key] ? <p className="gov-field-error" id={`gov-error-${key}`}>{errors[key]}</p> : null;
  const field = (key: keyof ProposalDraft, label: string, placeholder = "0") => <div className="gov-field">
    <label className="gov-field-label" htmlFor={`gov-draft-${key}`}>{label}</label>
    <input id={`gov-draft-${key}`} aria-label={label} className="gov-input" type="text" value={draft[key]} disabled={busy} placeholder={placeholder}
      aria-invalid={Boolean(errors[key])} aria-describedby={errors[key] ? `gov-error-${key}` : undefined} onChange={event => update(key, event.target.value)} />
    {errorFor(key)}
  </div>;
  const select = (key: keyof ProposalDraft, label: string, options: { value: string; label: string }[]) => <div className="gov-field">
    <label className="gov-field-label" htmlFor={`gov-draft-${key}`}>{label}</label>
    <select id={`gov-draft-${key}`} aria-label={label} className="gov-input" disabled={busy} value={draft[key]}
      aria-invalid={Boolean(errors[key])} aria-describedby={errors[key] ? `gov-error-${key}` : undefined} onChange={event => update(key, event.target.value)}>
      {options.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
    </select>{errorFor(key)}
  </div>;
  const call = review?.validation.call;
  return <section className="gov-compose" aria-labelledby="gov-compose-title"><div className="gov-card">
    <div className="gov-compose-header"><h2 id="gov-compose-title">{title}</h2><span>Create proposal</span></div>
    <div className="gov-current">{subtitle}</div><div className="gov-explain">{explain}</div>
    <div className="gov-credit-context" aria-live="polite">
      <strong>Available DEGEN voting credit: {loading && !context ? "Checking…" : context?.credit === undefined ? "Not verified" : formatUnits(context.credit, 18)}</strong>
      <HelpTip label="voting credit">Voting credit is separate from wallet tokens and miner principal. Committed credit is consumed and is not refunded.</HelpTip>
      {!wallet.address && <p>Connect a wallet to read its credit. You can still explore the forms without connecting.</p>}
      {wallet.address && wallet.chainId !== GOVERNANCE_CHAIN_ID && <p>Select PulseChain in your wallet before submitting.</p>}
      {loadError && !context && <p>Contract rules temporarily unavailable.</p>}
    </div>
    {module === "allocation" && <>
      {select("poolId", "Select Pool", [{ value: "", label: loading ? "Loading pools…" : "Select a pool" }, ...(context?.pools ?? []).map(pool => ({ value: pool.id.toString(), label: rewardPoolOptionLabel(pool) }))])}
      {context?.pools.find(pool => pool.id.toString() === draft.poolId) && <p className="gov-form-note">Verified pool participant: {context.pools.find(pool => pool.id.toString() === draft.poolId)!.participant}</p>}
    </>}
    {module === "rollover" && select("poolAddress", "Miner Duration", [{ value: "", label: "Select a verified miner pool" }, ...(context?.rolloverPools ?? []).map((address, index) => ({ value: address, label: `${MINER_LABELS[index]} · ${shortAddress(address)}` }))])}
    {module === "fees" && select("feeType", "Fee Type", [{ value: "0", label: "Deposit Fee" }, { value: "1", label: "Hourly Funding Rate" }, { value: "2", label: "Referral Bonus" }])}
    {module === "treasury" && <>
      <div className="gov-field"><label className="gov-field-label" htmlFor="gov-token-choice">Token to Transfer</label>
        <select id="gov-token-choice" className="gov-input" disabled={busy} value={tokenChoice} aria-invalid={tokenChoice !== "custom" && Boolean(errors.tokenAddress)} aria-describedby={tokenChoice !== "custom" && errors.tokenAddress ? "gov-error-tokenAddress" : undefined} onChange={event => { setTokenChoice(event.target.value); update("tokenAddress", event.target.value === "custom" ? "" : event.target.value); }}>
          {TREASURY_TOKEN_OPTIONS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
        </select></div>
      {tokenChoice === "custom" ? field("tokenAddress", "Token Contract Address", "0x…") : errorFor("tokenAddress")}
      {field("recipient", "Send To Wallet", "0x…")}
    </>}
    {module === "newtoken" && field("tokenAddress", "Token Contract Address", "0x…")}
    {module !== "newtoken" && field("value", VALUE_LABELS[module])}
    {field("commitment", "Your Commitment (whole DEGEN voting credit)")}
    <div className="gov-field"><label className="gov-field-label" htmlFor="gov-extra-delay">Extra Delay</label><div className="gov-delay-row">
      <input id="gov-extra-delay" type="range" aria-label="Extra delay in hours" min="0" max={module === "fees" ? 168 : Number((context?.baseDelay ?? 0n) / 3600n)} step="1" value={draft.extraDelay} disabled={!context || loading || busy}
        aria-invalid={Boolean(errors.extraDelay)} aria-describedby={errors.extraDelay ? "gov-error-extraDelay" : undefined} onChange={event => update("extraDelay", event.target.value)} />
      <span className="gov-delay-val">{draft.extraDelay} hours</span></div>{errorFor("extraDelay")}</div>
    {errors.context && <p className="gov-field-error" role="alert">{errors.context}</p>}
    <div className="gov-review-controls">
      <button className="gov-submit-btn" type="button" disabled={GOVERNANCE_ACTIONS_DISABLED || busy || loading || !wallet.address || wallet.chainId !== GOVERNANCE_CHAIN_ID} onClick={() => void submitProposal()}>{busy ? "Checking proposal…" : "Submit Proposal"}</button>
      <button className="gov-action-btn" type="button" disabled={busy || loading} onClick={() => void reviewProposal()}>Check proposal</button>
    </div>
    {submitStatus && <p className="gov-form-note" role="status">{submitStatus}</p>}
    {review && <details open className="gov-proposal-review" aria-label="Proposal check" aria-live="polite"><summary>Proposal check</summary>
      <h3>{call ? "Proposal preview" : "Check your proposal fields"}</h3>
      {!call && <p role="alert">{Object.entries(review.validation.errors).map(([key, value]) => `${key}: ${value}`).join(" ")}</p>}
      {review.validation.warnings.map(warning => <p className="gov-form-note" key={warning}>{warning}</p>)}
      {call && <><dl>
        <dt>Network</dt><dd>PulseChain · Chain ID {call.chainId.toString()}</dd>
        <dt>From</dt><dd>{review.context.account}</dd><dt>Contract</dt><dd>{call.to}</dd>
        <dt>Method</dt><dd>{call.signature}</dd><dt>Voting credit consumed</dt><dd>{formatUnits(call.creditConsumed, 18)} DEGEN credit</dd>
        <dt>Native PLS sent with call</dt><dd>0 (gas would be separate)</dd>
        {review.asset && <><dt>Asset precision</dt><dd>{review.asset.symbol} · {review.asset.decimals} decimals</dd></>}
      </dl><details><summary>Exact arguments and calldata</summary><pre tabIndex={0} aria-label="Proposal calldata">{JSON.stringify({ args: call.args.map(value => value.toString()), data: call.data }, null, 2)}</pre></details></>}
      {review.simulation && <p role="status">{review.simulation.message}</p>}
    </details>}

  </div></section>;
}
