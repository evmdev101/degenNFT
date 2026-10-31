import { useEffect, useState } from "react";
import { usePageActive } from "../../hooks/usePageActive";

export function dashboardSnapshotStale(timestampMs: number | undefined, now = Date.now()) {
  return timestampMs !== undefined && (!Number.isFinite(timestampMs) || now - timestampMs > 120_000 || timestampMs > now + 30_000);
}

/** Reassess the displayed snapshot age without polling hidden pages. */
export function useDashboardClock() {
  const active = usePageActive();
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    if (!active) return;
    const update = () => { if (!document.hidden) setNow(Date.now()); };
    update();
    const timer = setInterval(update, 15_000);
    document.addEventListener("visibilitychange", update);
    return () => { clearInterval(timer); document.removeEventListener("visibilitychange", update); };
  }, [active]);
  return Math.max(now, Date.now());
}
