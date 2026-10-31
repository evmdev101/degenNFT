import { describe, expect, it, vi } from "vitest";
import {
  classifyTransactionTaxProposal,
  decodeTransactionTaxProposal,
  formatTransactionTaxPercent,
  reconcileTransactionTaxCandidates,
  type TransactionTaxContractResult,
  type TransactionTaxProposal,
} from "../src/features/governance/transactionTax";

const proposal = (
  overrides: Partial<TransactionTaxProposal> = {},
): TransactionTaxProposal => ({
  valid: true,
  createdAt: 1_000n,
  proposedValue: 25n,
  votesFor: 2n * 10n ** 18n,
  votesAgainst: 0n,
  extraDelay: 20n,
  ...overrides,
});

describe("Transaction Tax on-chain reconciliation", () => {
  it("matches the Farms contract lifecycle boundaries", () => {
    expect(
      classifyTransactionTaxProposal(
        proposal({ valid: false }),
        100n,
        1_050,
      ).lifecycle,
    ).toBe("finished");
    expect(
      classifyTransactionTaxProposal(proposal(), 100n, 1_019).lifecycle,
    ).toBe("voting");
    expect(
      classifyTransactionTaxProposal(
        proposal({ votesAgainst: 3n * 10n ** 18n }),
        100n,
        1_020,
      ).lifecycle,
    ).toBe("vetoable");
    expect(
      classifyTransactionTaxProposal(proposal(), 100n, 1_120).lifecycle,
    ).toBe("settling");
    expect(
      classifyTransactionTaxProposal(proposal(), 100n, 1_121).lifecycle,
    ).toBe("enforceable");
  });

  it("rejects malformed/out-of-range IDs and isolates individual RPC failures", async () => {
    const readProposal = vi.fn(async (id: bigint) => {
      if (id === 1n) throw new Error("RPC failure");
      return proposal();
    });

    const result = await reconcileTransactionTaxCandidates({
      proposalIds: ["0", "0", "bad", "2", "1"],
      proposalCount: 2n,
      baseDelay: 100n,
      blockTimestamp: 1_100,
      readProposal,
    });

    expect(result["0"].status).toBe("verified");
    expect(result.bad).toEqual({
      status: "error",
      message: "Invalid proposal ID from legacy API",
    });
    expect(result["2"]).toEqual({
      status: "error",
      message: "Proposal ID is outside the on-chain range",
    });
    expect(result["1"]).toEqual({
      status: "error",
      message: "PulseChain proposal read failed",
    });
    expect(readProposal).toHaveBeenCalledTimes(2);
  });

  it("decodes the deployed tuple and formats raw tenths-of-a-percent units", () => {
    const decoded = decodeTransactionTaxProposal(
      [true, 1_000n, 25n, 10n, 2n, 20n] as TransactionTaxContractResult,
    );

    expect(decoded.proposedValue).toBe(25n);
    expect(formatTransactionTaxPercent(decoded.proposedValue)).toBe("2.5%");
    expect(formatTransactionTaxPercent(1n)).toBe("0.1%");
    expect(formatTransactionTaxPercent(100n)).toBe("10%");
  });

  it("flags proposals that Farms accepts but DEGEN cannot execute", async () => {
    const result = await reconcileTransactionTaxCandidates({
      proposalIds: ["0", "1"],
      proposalCount: 2n,
      baseDelay: 100n,
      blockTimestamp: 1_121,
      readProposal: async (id) =>
        proposal({ proposedValue: id === 0n ? 100n : 101n }),
    });

    expect(result["0"]).toMatchObject({
      status: "verified",
      executionBlockedReason: undefined,
    });
    expect(result["1"]).toMatchObject({
      status: "verified",
      executionBlockedReason:
        "Above the DEGEN token's executable 10% maximum",
    });
  });
});
