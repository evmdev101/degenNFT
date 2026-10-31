/** End UI waiting without allowing a late read to replace the failure/retry state. */
export async function withGovernanceReadDeadline<T>(operation: Promise<T>, timeoutMs = 60_000): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([operation, new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error("Reading contract rules timed out. Please try the action again shortly.")), timeoutMs);
    })]);
  } finally { if (timer !== undefined) clearTimeout(timer); }
}
