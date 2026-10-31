import { vi } from "vitest";
import { GOVERNANCE_ADDRESSES as A, CREDIT_UNIT as U } from "../src/features/governance/governanceSpec";
import type { GovernanceFormContext, ProposalAsset } from "../src/features/governance/formContext";
import type { SimulationReader } from "../src/features/governance/proposalPreflight";
import { EMPTY_PROPOSAL_DRAFT, type ProposalDraft } from "../src/features/governance/proposalValidation";

export const ACCOUNT = "0x1111111111111111111111111111111111111111";
export const TOKEN = "0x2222222222222222222222222222222222222222";
export const contextFixture = (extra: Partial<GovernanceFormContext> = {}): GovernanceFormContext => ({
  account: ACCOUNT, block: 42, timestamp: Math.floor(Date.now() / 1000), loadedAt: Date.now(), cost: U, baseDelay: 43200n,
  credit: 10000n * U, totalSupply: 10n ** 30n, poolCount: 49n, totalPulseAllocation: 6682n,
  pools: [{ id: 4n, participant: TOKEN, allocation: 200n }], rolloverPools: [TOKEN], ...extra,
});
export const assetFixture = (extra: Partial<ProposalAsset> = {}): ProposalAsset => ({ address: TOKEN, block: 42, module: "treasury", decimals: 6, symbol: "USDC", existingPool: false, ...extra });
export const draftFixture = (extra: Partial<ProposalDraft> = {}): ProposalDraft => ({ ...EMPTY_PROPOSAL_DRAFT, poolId: "4", poolAddress: TOKEN, value: "1", commitment: "1000", tokenAddress: TOKEN, recipient: ACCOUNT, ...extra });
export const readerFixture = (extra: Partial<SimulationReader> = {}): SimulationReader => ({
  chainId: vi.fn(async () => 369n), latestBlock: vi.fn(async () => ({ number: 42, timestamp: Math.floor(Date.now() / 1000) })),
  code: vi.fn(async () => "0x6000"), simulate: vi.fn(async () => "0x"),
  read: vi.fn(async (_address, _abi, method) => {
    switch (method) {
      case "governor": case "owner": return A.governor;
      case "creditContract": return A.credit;
      case "token": return A.token;
      case "farmContract": return A.farms;
      case "basicContract": return A.basic;
      case "consensusContract": return A.treasury;
      case "masterchef": case "masterchefAddress": return A.masterChef;
      case "deductingContract": return true;
      case "costToVote": return U;
      case "delayBeforeEnforce": return 43200n;
      case "userCredit": return 10000n * U;
      case "totalSupply": return 10n ** 30n;
      case "poolLength": return 5n;
      case "percentageAllocatedToPulseEcosystem": return 6682n;
      case "poolAllocationPercentage": return 200n;
      case "poolInfo": return [5n, 41n, TOKEN];
      case "acPool1": case "acPool2": case "acPool3": case "acPool4": return TOKEN;
      case "decimals": return 6n;
      case "symbol": return "USDC";
      case "existingParticipant": return false;
      default: throw new Error(`Unexpected getter ${method}`);
    }
  }), ...extra,
});
