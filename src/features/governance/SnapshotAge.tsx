import { useEffect, useState } from "react";
import { FORM_SNAPSHOT_MAX_AGE_MS } from "./governanceSpec";

export function snapshotAgeLabel(timestamp: number, now: number): string {
  const age = now - timestamp * 1000;
  if (age < -30_000) return "Snapshot clock mismatch — check connection";
  if (age > FORM_SNAPSHOT_MAX_AGE_MS) return `Stale snapshot · ${Math.floor(age / 60_000)} minutes old — refresh for current state`;
  return "Snapshot under 2 minutes old";
}

export function SnapshotAge({ timestamp }: { timestamp: number | bigint }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(timer);
  }, []);
  return <p className="gov-form-note" aria-live="polite">{snapshotAgeLabel(Number(timestamp), now)}</p>;
}
