import { useEffect, useRef, useState } from "react";
import { shortAddress } from "../lib/chain";
export function CopyAddress({ address, label = "address", compact = false, iconOnly = false }: { address: string; label?: string; compact?: boolean; iconOnly?: boolean }) {
  const [message, setMessage] = useState("");
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  async function copy() {
    try { await navigator.clipboard.writeText(address); setMessage("Copied"); }
    catch { setMessage("Copy unavailable"); }
    clearTimeout(timer.current); timer.current = setTimeout(() => setMessage(""), 2000);
  }
  return <span className={`copy-address${compact ? " copy-address-compact" : ""}${iconOnly ? " copy-address-icon" : ""}`}>
    {!compact && <a href={`https://scan.pulsechain.com/address/${address}`} target="_blank" rel="noreferrer">{shortAddress(address)}</a>}
    <button type="button" aria-label={`Copy ${label}`} onClick={() => void copy()}>{compact || iconOnly ? <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">{message === "Copied" ? <path d="m5 12 4 4L19 6" /> : <><rect x="8" y="8" width="12" height="12" rx="2" /><path d="M16 8V4H4v12h4" /></>}</svg> : "Copy"}</button>
    <span className="sr-only" role="status">{message}</span></span>;
}
