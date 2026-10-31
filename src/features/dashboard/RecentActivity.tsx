import { useEffect, useRef, useState } from "react";
import { usePageActive } from "../../hooks/usePageActive";
import { dashboardAmount } from "./format";
import {
  ACTIVITY_CATEGORIES, ActivityAnchorChangedError, mergeProtocolActivity, readPublicProtocolActivity,
  type ActivityFilter, type ProtocolActivityPage, type ProtocolActivityRow,
} from "./activityData";
import "./activity.css";

type History = { page: ProtocolActivityPage; from: number; rows: ProtocolActivityRow[] };

export function RecentActivity() {
  const active = usePageActive();
  const section = useRef<HTMLElement>(null);
  const [ready, setReady] = useState(typeof IntersectionObserver === "undefined");
  const [history, setHistory] = useState<History | null>(null);
  const historyRef = useRef(history);
  historyRef.current = history;
  const [filter, setFilter] = useState<ActivityFilter>("All");
  const [limit, setLimit] = useState(20);
  const [busy, setBusy] = useState(false), [olderBusy, setOlderBusy] = useState(false);
  const [error, setError] = useState(""), [olderError, setOlderError] = useState("");
  const latestRequest = useRef<AbortController | null>(null), olderRequest = useRef<AbortController | null>(null);

  useEffect(() => {
    if (ready || !section.current) return;
    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) { setReady(true); observer.disconnect(); }
    }, { rootMargin: "600px" });
    observer.observe(section.current);
    return () => observer.disconnect();
  }, [ready]);

  useEffect(() => {
    if (!active || !ready) { setBusy(false); setOlderBusy(false); return; }
    let stopped = false, timer: ReturnType<typeof setTimeout> | undefined;
    const load = async () => {
      if (stopped || latestRequest.current || document.hidden) return;
      if (timer) clearTimeout(timer);
      const controller = new AbortController();
      latestRequest.current = controller;
      setBusy(true); setError("");
      let retryIn = 60_000;
      try {
        const page = await readPublicProtocolActivity({ anchor: historyRef.current?.page, signal: controller.signal });
        if (stopped || controller.signal.aborted) return;
        // Current rows replace their whole range; older pages remain available.
        const previous = historyRef.current;
        const next = previous && page.from <= previous.page.to + 1
          ? { page, from: Math.min(previous.from, page.from), rows: mergeProtocolActivity(previous.rows.filter(row => row.block < page.from), page.rows) }
          : { page, from: page.from, rows: page.rows };
        historyRef.current = next; setHistory(next);
      } catch (failure) {
        if (stopped || controller.signal.aborted) return;
        if (failure instanceof ActivityAnchorChangedError) {
          olderRequest.current?.abort(); historyRef.current = null; setHistory(null); setLimit(20); setOlderError("");
          retryIn = 1000;
        } else { setError("Activity is temporarily unavailable."); retryIn = 10_000; }
      } finally {
        if (latestRequest.current === controller) latestRequest.current = null;
        if (!stopped) { setBusy(false); timer = setTimeout(() => void load(), retryIn); }
      }
    };
    const resume = () => {
      if (document.hidden) { latestRequest.current?.abort(); olderRequest.current?.abort(); }
      else void load();
    };
    void load();
    document.addEventListener("visibilitychange", resume);
    window.addEventListener("online", resume);
    window.addEventListener("degen:transaction-confirmed", resume);
    window.addEventListener("degen:governance-updated", resume);
    return () => {
      stopped = true; if (timer) clearTimeout(timer);
      latestRequest.current?.abort(); latestRequest.current = null;
      olderRequest.current?.abort(); olderRequest.current = null;
      document.removeEventListener("visibilitychange", resume);
      window.removeEventListener("online", resume);
      window.removeEventListener("degen:transaction-confirmed", resume);
      window.removeEventListener("degen:governance-updated", resume);
    };
  }, [active, ready]);

  const loadOlder = async () => {
    const previous = historyRef.current;
    if (!active || document.hidden || !previous || previous.from === 0 || olderRequest.current) return;
    const controller = new AbortController(); olderRequest.current = controller;
    setOlderBusy(true); setOlderError("");
    try {
      const page = await readPublicProtocolActivity({ end: previous.from - 1, anchor: previous.page, signal: controller.signal });
      if (controller.signal.aborted) return;
      const current = historyRef.current;
      if (!current) return;
      const next = { ...current, from: Math.min(current.from, page.from), rows: mergeProtocolActivity(current.rows, page.rows) };
      historyRef.current = next; setHistory(next); setLimit(value => value + 20);
    } catch (failure) {
      if (controller.signal.aborted) return;
      if (failure instanceof ActivityAnchorChangedError) {
        // The next automatic current read rebuilds the history from its tip.
        historyRef.current = null; setHistory(null); setLimit(20);
        window.dispatchEvent(new Event("degen:governance-updated"));
      } else setOlderError("Older activity could not be loaded.");
    } finally {
      if (olderRequest.current === controller) { olderRequest.current = null; setOlderBusy(false); }
    }
  };

  const rows = history?.rows.filter(row => filter === "All" || row.category === filter) ?? [];
  return <section ref={section} className="dash-card dash-recent-activity" aria-labelledby="recent-activity-heading">
    <h2 id="recent-activity-heading">Recent activity</h2>
    <div className="dash-activity-filters" role="group" aria-label="Activity category">
      {ACTIVITY_CATEGORIES.map(category => <button type="button" key={category} aria-pressed={filter === category}
        onClick={() => { setFilter(category); setLimit(20); }}>{category}</button>)}
    </div>
    <div className="dash-activity-list" role="region" aria-label="Recent protocol events" tabIndex={0} aria-busy={!history && busy}>
      {!history ? <p className="dash-data-note" role="status">{error || "Reading activity…"}</p>
        : !rows.length ? <p className="dash-data-note" role="status">No matching events in the loaded range.</p> : null}
      {rows.slice(0, limit).map(row => <a href={`https://scan.pulsechain.com/tx/${row.hash}`} target="_blank" rel="noreferrer" key={row.key}>
        <div><strong>{row.label}</strong><small>{row.category}</small></div>
        <span>{row.raw !== undefined ? `${dashboardAmount(row.raw, row.decimals ?? 18)} ${row.symbol}` : `${row.address.slice(0, 6)}…${row.address.slice(-4)}`} <span aria-hidden="true">↗</span></span>
      </a>)}
    </div>
    {olderError && <p className="dash-data-error" role="status">{olderError}</p>}
    <div className="dash-activity-pagination">
      <button type="button" disabled={rows.length <= limit} onClick={() => setLimit(value => value + 20)}>Show more</button>
      <button type="button" aria-busy={olderBusy} disabled={!history || history.from === 0 || olderBusy || !active}
        onClick={() => void loadOlder()}>Load older events</button>
    </div>
  </section>;
}
