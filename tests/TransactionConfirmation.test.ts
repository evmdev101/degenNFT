import { describe, expect, it, vi } from "vitest";
import { confirmTransaction } from "../src/lib/transactions";
import { recoverStalePage } from "../src/lib/stalePageRecovery";
describe("transaction observation", () => {
  it("accepts successful replacements without submitting again", async () => {
    const wait = vi.fn().mockRejectedValue({ code: "TRANSACTION_REPLACED", cancelled: false, receipt: { status: 1 } });
    await expect(confirmTransaction({ wait })).resolves.toMatchObject({ status: 1 });
    expect(wait).toHaveBeenCalledExactlyOnceWith(1, 120_000);
  });
  it("rejects cancellation and failed receipts", async () => {
    await expect(confirmTransaction({ wait: vi.fn().mockRejectedValue({ code: "TRANSACTION_REPLACED", cancelled: true }) })).rejects.toThrow("cancelled");
    await expect(confirmTransaction({ wait: vi.fn().mockResolvedValue({ status: 0 }) })).rejects.toThrow("did not confirm");
  });
});
it("recovers outdated chunks only once per tab session", () => {
  const values = new Map<string, string>();
  const host = { storage: { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); } }, reload: vi.fn() };
  expect(recoverStalePage(new Error("unrelated"), host)).toBe(false);
  expect(recoverStalePage(new Error("Failed to fetch dynamically imported module"), host)).toBe(true);
  expect(recoverStalePage(new Error("Failed to fetch dynamically imported module"), host)).toBe(false);
  expect(host.reload).toHaveBeenCalledTimes(1);
});
