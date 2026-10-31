import { Interface } from "ethers";
import { describe, expect, it } from "vitest";
import { CREDIT_IMPORT_EVENT, importableCredit, rebalanceAllocations, verifyCreditImportEvent } from "../src/features/governance/governanceMaintenance";
import { GOVERNANCE_ADDRESSES as A } from "../src/features/governance/governanceSpec";
const ACCOUNT = "0x1111111111111111111111111111111111111111";
it("uses source weights and integer floors rather than the old presentation multipliers", () => {
  expect(rebalanceAllocations([100n, 200n, 300n, 400n])).toEqual([5333n, 15000n, 75000n, 500000n]);
  expect(() => rebalanceAllocations([0n, 0n, 0n, 0n])).toThrow("no miner balances");
});
it("imports only the burned OINK credit that has not already been credited", () => {
  expect(importableCredit(500n, 450n)).toBe(50n);
  expect(importableCredit(500n, 500n)).toBe(0n);
  expect(() => importableCredit(499n, 500n)).toThrow();
});
it("requires the exact imported-credit event from the pinned credit contract", () => {
  const iface = new Interface([CREDIT_IMPORT_EVENT]);
  const log = iface.encodeEventLog(iface.getEvent("AddCredit")!, [ACCOUNT, 50n]);
  expect(() => verifyCreditImportEvent({ logs: [{ address: A.credit, ...log }] }, ACCOUNT, 50n)).not.toThrow();
  expect(() => verifyCreditImportEvent({ logs: [{ address: A.token, ...log }] }, ACCOUNT, 50n)).toThrow();
  expect(() => verifyCreditImportEvent({ logs: [{ address: A.credit, ...log }] }, ACCOUNT, 51n)).toThrow();
  expect(() => verifyCreditImportEvent({ logs: [{ address: A.credit, ...log }] }, "0x2222222222222222222222222222222222222222", 50n)).toThrow();
});
