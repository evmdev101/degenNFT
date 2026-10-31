import { createContext, useContext, useEffect, useId, useRef, useState } from "react";
import { usePageActive } from "../../hooks/usePageActive";
import type { WalletState } from "../../hooks/useWallet";
import { readableError } from "../../lib/chain";
import { HelpTip } from "../../components/HelpTip";
import type { GovernanceModule } from "./governanceSpec";
import { submitGovernanceAction } from "./governanceTransactions";
import { GOVERNANCE_ACTIONS_DISABLED } from "../../config/publicPreview";

export const GovernanceWalletContext = createContext<WalletState | null>(null);
type Action = "yes" | "no" | "veto" | "enforce" | "sync";
const LABELS: Record<Action, string> = { yes: "Vote for", no: "Vote against", veto: "Veto", enforce: "Enforce", sync: "Synchronize vault fees" };

/** Display state is advisory; every request is re-read and simulated before sending. */
export function GovernanceActionControls({ module, proposalId, verified, valid = true, phase, blockedReason }: {
  module: GovernanceModule; proposalId: string; verified: boolean; valid?: boolean; phase?: string; blockedReason?: string;
}) {
  const wallet = useContext(GovernanceWalletContext);
  const active = usePageActive(), activeRef = useRef(active); activeRef.current = active;
  const id = useId();
  const [selection, setSelection] = useState<"yes" | "no" | null>(null);
  const [credit, setCredit] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");
  const lock = useRef(false), generation = useRef(0);
  const identity = `${module}:${proposalId}:${wallet?.address?.toLowerCase()}:${wallet?.chainId}`;
  const identityRef = useRef(identity); identityRef.current = identity;
  useEffect(() => { generation.current++; setSelection(null); setCredit(""); setError(""); setInfo(""); setBusy(false); }, [identity]);
  useEffect(() => () => { generation.current++; }, []);
  useEffect(() => { if (!active) { generation.current++; setBusy(false); } }, [active]);
  const ready = !GOVERNANCE_ACTIONS_DISABLED && verified && Boolean(wallet?.address) && !wallet?.isWrongNetwork && !blockedReason;
  const enforceable = !phase || ["enforceable", "review-complete", "finalizable-approval", "finalizable-rejection", "consensus-rejection-pending"].includes(phase);
  const vetoable = !phase || phase === "vetoable" || phase === "credit-vetoable";
  const voting = !phase || ["voting", "vetoable", "credit-voting", "credit-vetoable"].includes(phase);
  async function submit(action: Action) {
    if (GOVERNANCE_ACTIONS_DISABLED || !wallet || !ready || lock.current) return;
    lock.current = true; setBusy(true); setError(""); setInfo("");
    const session = generation.current, expectedIdentity = identity;
    const current = () => activeRef.current && session === generation.current && identityRef.current === expectedIdentity;
    try {
      const outcome = await submitGovernanceAction({ module, action, proposalId, ...(action === "yes" || action === "no" ? { credit } : {}) }, wallet, { isCurrent: current });
      if (current()) {
        setSelection(null); setCredit("");
        if (outcome.outcome === "partial") setError(outcome.message);
        else if (outcome.outcome === "rejected" || module === "fees") setInfo(outcome.message);
      }
    } catch (failure) { if (current()) setError(readableError(failure)); }
    finally { lock.current = false; if (current()) setBusy(false); }
  }
  if (!verified) return <span className="gov-form-note">Action unavailable until this proposal can be verified.</span>;
  if (blockedReason) return <span className="gov-form-note">{blockedReason}</span>;
  if (!valid && module !== "fees") return null;
  const walletHint = !wallet?.address ? "Connect a wallet to use this action" : wallet.isWrongNetwork ? "Switch to PulseChain first" : undefined;
  const hintId = `${id}-eligibility`;
  return <div className="gov-action-workspace">
    <div className="gov-row-actions">
      {valid && voting && <><button type="button" aria-describedby={walletHint ? hintId : undefined} disabled={!ready || busy} onClick={() => { setSelection("yes"); setError(""); }}>Vote for</button>
      <button type="button" aria-describedby={walletHint ? hintId : undefined} disabled={!ready || busy} onClick={() => { setSelection("no"); setError(""); }}>Vote against</button></>}
      {valid && vetoable && <button type="button" aria-describedby={walletHint ? hintId : undefined} disabled={!ready || busy} onClick={() => void submit("veto")}>Veto</button>}
      {valid && enforceable && <button type="button" aria-describedby={walletHint ? hintId : undefined} disabled={!ready || busy} onClick={() => void submit("enforce")}>{module === "treasury" ? "Finalize transfer" : "Enforce"}</button>}
      {module === "fees" && !valid && <button type="button" aria-describedby={walletHint ? hintId : undefined} disabled={!ready || busy} onClick={() => void submit("sync")}>{LABELS.sync}</button>}
    </div>
    {walletHint && <span id={hintId} className="sr-only">{walletHint}</span>}
    {selection && <form className="gov-vote-form" onSubmit={event => { event.preventDefault(); void submit(selection); }}>
      <label htmlFor={id}>{LABELS[selection]} · Proposal #{proposalId}<HelpTip label="vote commitment">This consumes DEGEN voting credit permanently. It does not spend the DEGEN token balance in your wallet.</HelpTip></label>
      <div><input id={id} inputMode="decimal" autoComplete="off" placeholder="DEGEN voting credit" value={credit} onChange={event => setCredit(event.target.value)} disabled={busy} />
      <button className="gov-submit-btn" type="submit" disabled={GOVERNANCE_ACTIONS_DISABLED || busy || !credit.trim()}>{busy ? "Checking…" : LABELS[selection]}</button>
      <button type="button" disabled={busy} onClick={() => setSelection(null)}>Cancel</button></div>
    </form>}
    {info && <p className="gov-form-note" role="status">{info}</p>}
    {error && <p className="gov-field-error" role="alert">{error}</p>}
  </div>;
}
