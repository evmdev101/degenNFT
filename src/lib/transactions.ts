import { getPublicProvider } from "./chain";

export type Receipt = {
  status?: number | null; hash?: string; blockNumber?: number; blockHash?: string;
  from?: string; to?: string | null;
  logs?: readonly { address: string; topics: readonly string[]; data: string }[];
};
type SubmittedTransaction = {
  hash?: string; from?: string; nonce?: number;
  wait: (confirmations?: number, timeout?: number) => Promise<Receipt | null>;
};
type Pending = { hash: string; from?: string; nonce?: number; started: number };
const STORAGE_KEY = "degen:submitted-transactions";
const pending = new Map<string, Pending>();
const hashPattern = /^0x[0-9a-f]{64}$/i;
const addressPattern = /^0x[0-9a-f]{40}$/i;
let readers = 0, running = false;
let timer: ReturnType<typeof setTimeout> | undefined;

function save() {
  try { sessionStorage.setItem(STORAGE_KEY, JSON.stringify([...pending.values()].slice(-20))); } catch { /* Storage is optional. */ }
}
function settled(hash: string | undefined, state: "confirmed" | "failed" | "cancelled" | "replaced") {
  if (hash) pending.delete(hash);
  save();
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("degen:transaction-settled", { detail: { hash, state } }));
    if (state === "confirmed") window.dispatchEvent(new CustomEvent("degen:transaction-confirmed", { detail: { hash } }));
  }
}
async function reconcile() {
  if (running || !readers || document.hidden) return;
  running = true;
  try {
    const records = [...pending.values()];
    if (!records.length) return;
    const provider = await getPublicProvider();
    // Sequential receipt reads avoid bursts when an old tab is restored.
    for (const record of records) {
      if (Date.now() - record.started > 24 * 60 * 60_000) { pending.delete(record.hash); continue; }
      try {
        const receipt = await provider.getTransactionReceipt(record.hash);
        if (receipt) settled(record.hash, receipt.status === 1 ? "confirmed" : "failed");
        else if (record.from && record.nonce !== undefined && await provider.getTransactionCount(record.from, "latest") > record.nonce) {
          // The original nonce was mined by another transaction. Re-read balances;
          // this does not assert that the original action succeeded.
          settled(record.hash, "replaced");
        }
      } catch { /* A temporary RPC failure must not alter the submitted record. */ }
    }
    save();
  } finally {
    running = false;
    clearTimeout(timer);
    if (readers) timer = setTimeout(() => void reconcile(), 20_000);
  }
}
export function startTransactionReconciliation() {
  readers++;
  if (readers === 1) {
    try {
      const records: unknown = JSON.parse(sessionStorage.getItem(STORAGE_KEY) ?? "[]");
      if (Array.isArray(records)) for (const value of records.slice(-20)) {
        if (value && hashPattern.test(value.hash) && Number.isFinite(value.started) && value.started <= Date.now()
          && Date.now() - value.started < 24 * 60 * 60_000) {
          pending.set(value.hash, { hash: value.hash, started: value.started,
            from: addressPattern.test(value.from) ? value.from : undefined,
            nonce: Number.isSafeInteger(value.nonce) && value.nonce >= 0 ? value.nonce : undefined });
        }
      }
    } catch { /* Ignore malformed or unavailable storage. */ }
    void reconcile();
    document.addEventListener("visibilitychange", reconcile);
    window.addEventListener("online", reconcile);
  }
  return () => {
    readers = Math.max(0, readers - 1);
    if (!readers) {
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", reconcile);
      window.removeEventListener("online", reconcile);
    }
  };
}

/** Observe a submitted transaction only. Records never authorize or lock future actions. */
export async function confirmTransaction(transaction: SubmittedTransaction): Promise<Receipt> {
  const hash = transaction.hash && hashPattern.test(transaction.hash) ? transaction.hash : undefined;
  if (hash) { pending.set(hash, { hash, from: transaction.from, nonce: transaction.nonce, started: Date.now() }); save(); }
  try {
    const receipt = await transaction.wait(1, 120_000);
    if (!receipt || receipt.status !== 1) {
      settled(hash, "failed");
      throw new Error("Transaction did not confirm successfully.");
    }
    settled(hash, "confirmed");
    return receipt;
  } catch (error) {
    const replacement = error as { code?: string; cancelled?: boolean; receipt?: Receipt };
    if (replacement.code === "TRANSACTION_REPLACED") {
      if (replacement.cancelled) { settled(hash, "cancelled"); throw new Error("Transaction cancelled in your wallet."); }
      if (replacement.receipt?.status === 1) { settled(hash, "confirmed"); return replacement.receipt; }
      settled(hash, "failed");
    } else if (replacement.code === "CALL_EXCEPTION") settled(hash, "failed");
    if (replacement.code === "TIMEOUT") {
      void reconcile();
      throw new Error("Confirmation is taking longer than expected. Check your wallet before trying again.");
    }
    throw error;
  }
}
