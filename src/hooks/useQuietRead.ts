import { useEffect, useRef, useSyncExternalStore } from "react";

import { usePageActive } from "./usePageActive";

type Snapshot<T> = { data?: T; error?: string; updatedAt: number; isRefreshing: boolean };
type Entry<T> = { snapshot: Snapshot<T>; listeners: Set<() => void>; pending?: Promise<void> };
const entries = new Map<string, Entry<unknown>>();
export function clearQuietReadCache() { entries.clear(); }
function entryFor<T>(key: string): Entry<T> {
  if (!entries.has(key)) entries.set(key, { snapshot: { updatedAt: 0, isRefreshing: false }, listeners: new Set() });
  return entries.get(key)! as Entry<T>;
}

/** Shared display reads retain their last successful value. Actions must read fresh terms. */
export function useQuietRead<T>(key: string, read: () => Promise<T>, interval = 60_000, enabled = true) {
  const active = usePageActive() && enabled;
  const entry = entryFor<T>(key);
  const readRef = useRef(read);
  readRef.current = read;
  const snapshot = useSyncExternalStore(
    listener => { entry.listeners.add(listener); return () => { entry.listeners.delete(listener); }; },
    () => entry.snapshot,
    () => entry.snapshot,
  );
  const refresh = () => {
    if (entry.pending) return entry.pending;
    const runRead = readRef.current;
    entry.pending = Promise.resolve().then(runRead).then(
      data => { entry.snapshot = { data, updatedAt: Date.now(), isRefreshing: false }; },
      () => { entry.snapshot = { ...entry.snapshot, error: "Temporarily unavailable", isRefreshing: false }; },
    ).finally(() => {
      entry.pending = undefined;
      for (const notify of entry.listeners) notify();
    });
    // Refresh state belongs to the shared entry, so every subscriber sees the
    // same in-flight read without losing the last successful data or its age.
    entry.snapshot = { ...entry.snapshot, isRefreshing: true };
    for (const notify of entry.listeners) notify();
    return entry.pending;
  };
  useEffect(() => {
    if (!active) return;
    let stopped = false;
    let polling = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      if (stopped || polling) return;
      polling = true;
      if (!document.hidden && (entry.snapshot.error || Date.now() - entry.snapshot.updatedAt >= Math.min(interval, 15_000))) await refresh();
      polling = false;
      clearTimeout(timer);
      if (!stopped) timer = setTimeout(() => void poll(), interval);
    };
    const resume = () => { if (!document.hidden) { clearTimeout(timer); void poll(); } };
    void poll();
    document.addEventListener("visibilitychange", resume);
    const force = () => { if (!document.hidden) void refresh(); };
    window.addEventListener("online", force);
    window.addEventListener("degen:transaction-confirmed", force);
    window.addEventListener("degen:governance-updated", force);
    return () => {
      stopped = true; clearTimeout(timer);
      document.removeEventListener("visibilitychange", resume);
      window.removeEventListener("online", force);
      window.removeEventListener("degen:transaction-confirmed", force);
      window.removeEventListener("degen:governance-updated", force);
    };
  }, [entry, interval, active]);
  return { ...snapshot, isLoading: snapshot.data === undefined && !snapshot.error, refresh };
}
