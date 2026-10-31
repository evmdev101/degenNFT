import { describe, expect, it, vi } from "vitest";
import {
  classifyTreasuryProposal,
  decodeTreasuryProposal,
  formatTreasuryAmount,
  isNativeTreasuryToken,
  reconcileTreasuryCandidates,
  treasuryProposalIds,
  type TreasuryConsensusSnapshot,
  type TreasuryContractResult,
  type TreasuryProposal,
} from "../src/features/governance/treasury";

const proposal = (
  overrides: Partial<TreasuryProposal> = {},
): TreasuryProposal => ({
  valid: true,
  createdAt: 1_000n,
  creditVotesFor: 100n,
  creditVotesAgainst: 0n,
  extraDelay: 20n,
  tokenAddress: "0x3E79130ab714E97ee73f86a56a2427bb1A519896",
  beneficiary: "0xAAcA9cFc6Fe88Dc16e87ff8315C554220Bf13264",
  amountToSend: 150_000_000_000n * 10n ** 18n,
  consensusProposalId: 29n,
  ...overrides,
});

const consensus = (
  overrides: Partial<TreasuryConsensusSnapshot> = {},
): TreasuryConsensusSnapshot => ({
  votesFor: 0n,
  votesAgainst: 0n,
  totalStaked: 1_000n,
  ...overrides,
});

describe("Treasury on-chain reconciliation", () => {
  it("models both voting phases and their exact timestamp boundaries", () => {
    expect(
      classifyTreasuryProposal(
        proposal({ valid: false }),
        consensus(),
        100n,
        1_050,
      ).lifecycle,
    ).toBe("finished");
    expect(
      classifyTreasuryProposal(proposal(), consensus(), 100n, 1_019).lifecycle,
    ).toBe("credit-voting");
    expect(
      classifyTreasuryProposal(
        proposal({ creditVotesAgainst: 101n }),
        consensus(),
        100n,
        1_020,
      ).lifecycle,
    ).toBe("credit-vetoable");
    expect(
      classifyTreasuryProposal(
        proposal({ creditVotesAgainst: 101n }),
        consensus(),
        100n,
        1_120,
      ).lifecycle,
    ).toBe("credit-vetoable");
    expect(
      classifyTreasuryProposal(
        proposal({ creditVotesAgainst: 101n }),
        consensus(),
        100n,
        1_121,
      ).lifecycle,
    ).toBe("consensus-rejection-pending");
    expect(
      classifyTreasuryProposal(proposal(), consensus(), 100n, 1_120).lifecycle,
    ).toBe("consensus-voting");
    expect(
      classifyTreasuryProposal(proposal(), consensus(), 100n, 1_219).lifecycle,
    ).toBe("consensus-voting");
  });

  it("applies the 15% support and 33%-of-support rejection thresholds", () => {
    expect(
      classifyTreasuryProposal(
        proposal(),
        consensus({ votesFor: 150n, votesAgainst: 48n }),
        100n,
        1_220,
      ),
    ).toMatchObject({
      lifecycle: "finalizable-approval",
      consensusSupportRequired: 150n,
    });
    expect(
      classifyTreasuryProposal(
        proposal(),
        consensus({ votesFor: 149n, votesAgainst: 0n }),
        100n,
        1_220,
      ).lifecycle,
    ).toBe("finalizable-rejection");
    expect(
      classifyTreasuryProposal(
        proposal(),
        consensus({ votesFor: 150n, votesAgainst: 49n }),
        100n,
        1_220,
      ).lifecycle,
    ).toBe("finalizable-rejection");
  });

  it("rejects malformed/out-of-range IDs and isolates individual read failures", async () => {
    const readProposal = vi.fn(async (id: bigint) => {
      if (id === 1n) throw new Error("RPC failure");
      return proposal();
    });
    const readAsset = vi.fn(async (address: string) => ({
      address,
      decimals: 18,
      symbol: "DEGEN",
    }));
    const readConsensus = vi.fn(async () => consensus());

    const result = await reconcileTreasuryCandidates({
      proposalIds: ["0", "0", "bad", "2", "1"],
      proposalCount: 2n,
      baseDelay: 100n,
      blockTimestamp: 1_100,
      readProposal,
      readAsset,
      readConsensus,
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
      message: "PulseChain treasury read failed",
    });
    expect(readProposal).toHaveBeenCalledTimes(2);
    expect(readAsset).toHaveBeenCalledTimes(1);
    expect(readConsensus).toHaveBeenCalledTimes(1);
  });

  it("decodes the full tuple and formats amounts with asset-specific decimals", () => {
    const decoded = decodeTreasuryProposal(
      [
        true,
        1_000n,
        100n,
        0n,
        20n,
        "0x3E79130ab714E97ee73f86a56a2427bb1A519896",
        "0xAAcA9cFc6Fe88Dc16e87ff8315C554220Bf13264",
        1_234_567n,
        29n,
      ] as TreasuryContractResult,
    );

    expect(decoded.consensusProposalId).toBe(29n);
    expect(formatTreasuryAmount(decoded.amountToSend, 6, "USDC")).toBe(
      "1.234567 USDC",
    );
    expect(formatTreasuryAmount(150_000n * 10n ** 18n, 18, "DEGEN")).toBe(
      "150,000 DEGEN",
    );
  });

  it("recognizes native PLS aliases and safely enumerates every proposal ID", () => {
    expect(
      isNativeTreasuryToken("0x0000000000000000000000000000000000000000"),
    ).toBe(true);
    expect(
      isNativeTreasuryToken("0x0000000000000000000000000000000000001010"),
    ).toBe(true);
    expect(treasuryProposalIds(3n)).toEqual(["0", "1", "2"]);
    expect(() => treasuryProposalIds(501n)).toThrow(
      "Treasury proposal count exceeds the safe enumeration limit",
    );
  });
});
