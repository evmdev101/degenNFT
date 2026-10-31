import { usePageActive } from "../../hooks/usePageActive";
import { useContext, useEffect, useRef, useState } from "react";
import { GovernanceWalletContext } from "./GovernanceActions";
import { submitGovernanceMaintenance, type MaintenanceAction } from "./governanceMaintenance";
import { readableError } from "../../lib/chain";
import { GOVERNANCE_ACTIONS_DISABLED } from "../../config/publicPreview";
export function GovernanceMaintenance() {
  const wallet = useContext(GovernanceWalletContext);
  const active = usePageActive(), activeRef = useRef(active); activeRef.current = active;
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const lock = useRef(false), generation = useRef(0);
  useEffect(() => () => { generation.current++; }, [wallet?.address, wallet?.chainId]);
  useEffect(() => { if (!active) generation.current++; }, [active]);
  async function submit(action: MaintenanceAction) {
    if (GOVERNANCE_ACTIONS_DISABLED || !wallet || lock.current) return;
    lock.current = true; setBusy(true); setError("");
    const session = generation.current;
    try { await submitGovernanceMaintenance(action, wallet, () => activeRef.current && session === generation.current); }
    catch (failure) { if (session === generation.current) setError(readableError(failure)); }
    finally { lock.current = false; if (session === generation.current) setBusy(false); }
  }
  return <><div className="gov-actions">
    <button className="gov-action-btn" disabled={GOVERNANCE_ACTIONS_DISABLED || !wallet?.address || wallet.isWrongNetwork || busy} onClick={() => void submit("rebalance")}>Rebalance Rewards</button>
    <button className="gov-action-btn" disabled={GOVERNANCE_ACTIONS_DISABLED || !wallet?.address || wallet.isWrongNetwork || busy} onClick={() => void submit("import-credit")}>Import Eligible Voting Credit</button>
  </div><p className="gov-form-note">Imports only OINK voting credit already burned for this wallet. It does not burn tokens or spend additional credit.</p>
  {error && <p className="gov-field-error" role="alert">{error}</p>}</>;
}
