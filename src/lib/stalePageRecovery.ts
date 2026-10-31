type RecoveryHost = { storage: Pick<Storage, "getItem" | "setItem">; reload: () => void };

// One recovery per tab session: a broken deployment must never cause a reload loop.
export function recoverStalePage(error: unknown, host?: RecoveryHost): boolean {
  const message = error instanceof Error ? error.message : typeof error === "string" ? error : "";
  if (!/Failed to fetch dynamically imported module|Importing a module script failed|error loading dynamically imported module|Loading chunk .* failed/i.test(message)) return false;
  try {
    const env = host ?? { storage: window.sessionStorage, reload: () => window.location.reload() };
    const key = "degen:stale-page-recovery";
    if (env.storage.getItem(key)) return false;
    env.storage.setItem(key, "attempted");
    if (env.storage.getItem(key) !== "attempted") return false;
    env.reload();
    return true;
  } catch { return false; }
}
