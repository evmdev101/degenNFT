import { GovernanceMaintenance } from "./governance/GovernanceMaintenancePanel";
import { GOVERNANCE_ACTIONS_DISABLED, GOVERNANCE_ACTIONS_NOTICE } from "../config/publicPreview";
import { GovernanceActionControls, GovernanceWalletContext } from "./governance/GovernanceActions";
import { ChangingValue } from "../components/ChangingValue";
import { useQuietRead } from "../hooks/useQuietRead";
import { HelpTip } from "../components/HelpTip";
import { GOVERNANCE_ADDRESSES } from "./governance/governanceSpec";
// Governance ("Degen Council") page — redesign of the original govern.html.
// Current values and verified proposals come from deployed contracts; legacy
// API tables provide optional legacy metadata, never proposal discovery or authority.
// User actions use fresh source-verified preflight and receipt/outcome checks.
import { useEffect, useRef, useState } from "react";
import { GovernanceComposer } from "./governance/GovernanceComposer";
import type { GovernanceModule } from "./governance/governanceSpec";
import { ScrollRegion } from "../components/ScrollRegion";
import { isSnapshotModule, loadProposalSnapshot, type ProposalSnapshot, type SnapshotModule } from "./governance/proposalSnapshots";
import { NewTokenProposals } from "./governance/NewTokenProposals";
import { isParameterModule, ParameterProposals } from "./governance/ParameterProposalList";
import { cleanProposalText, proposalColumnLabel, ProposalCard, ProposalTextCell, ProposalVotes } from "./governance/ProposalPresentation";
import "./governance/governance-studio.css";
import { Contract, formatUnits } from "ethers";
import type { WalletState } from "../hooks/useWallet";
import { getPublicProvider, shortAddress } from "../lib/chain";
import {
  formatAllocationPercent,
  type RewardAllocationReconciliation,
} from "./governance/rewardAllocation";
import {
  formatRolloverBonusPercent,
  rolloverPoolLabel,
  type RolloverBonusReconciliation,
} from "./governance/rolloverBonus";
import {
  formatTransactionTaxPercent,
  type TransactionTaxReconciliation,
} from "./governance/transactionTax";
import {
  formatEmissionPerBlock,
  type EmissionsReconciliation,
} from "./governance/emissions";
import {
  formatTreasuryAmount,
  type TreasuryReconciliation,
} from "./governance/treasury";

const GOV_API = "https://api.oink-pls.com/";
const GOVERNOR_CONTRACT = GOVERNANCE_ADDRESSES.governor;
const DEGEN_TOKEN = GOVERNANCE_ADDRESSES.token;
const MASTER_CHEF = GOVERNANCE_ADDRESSES.masterChef;

const GOVERNOR_READ_ABI = [
  "function costToVote() view returns (uint256)",
  "function delayBeforeEnforce() view returns (uint256)",
  "function depositFee() view returns (uint256)",
  "function fundingRate() view returns (uint256)",
  "function referralBonus() view returns (uint256)",
  "function getRollBonus(address pool) view returns (uint256)",
] as const;

const DEGEN_READ_ABI = ["function tax() view returns (uint256)"] as const;
const MASTER_CHEF_READ_ABI = [
  "function DTXPerBlock() view returns (uint256)",
] as const;

type GovStats = {
  costToVote?: string;
  delayHours?: string;
  taxPercent?: string;
  rewardPerBlock?: string;
  rollBonuses?: number[];
  miningFees?: {
    depositPercent: number;
    fundingPercent: number;
    referralPercent: number;
  };
};

type ProposalAction = {
  label: string;
  proposalId?: string;
};

type ProposalRow = {
  cells: string[];
  actions: ProposalAction[];
  proposalId?: string;
  rewardAllocation?: RewardAllocationReconciliation;
  rolloverBonus?: RolloverBonusReconciliation;
  transactionTax?: TransactionTaxReconciliation;
  emissions?: EmissionsReconciliation;
  treasury?: TreasuryReconciliation;
};

type ProposalTable = {
  headers: string[];
  rows: ProposalRow[];
};

type ProposalTables = {
  active: ProposalTable;
  expired: ProposalTable;
  snapshotBlock?: number;
  snapshotTime?: number;
  proposalCount?: bigint;
  failedReads?: number;
  ignoredLegacyRows?: number;
  legacyStatus?: "loading" | "available" | "unavailable";
};

type ProposalState = { module: string; revision: number } & (
  | { status: "loading"; completed?: number; total?: number }
  | { status: "ready"; tables: ProposalTables }
  | { status: "error"; message: string });

type VotingPowerState =
  | { status: "disconnected" }
  | { status: "loading" }
  | {
      status: "ready";
      total: number;
      balances: Array<(typeof VOTING_POOLS)[number] & { balance: number }>;
    }
  | { status: "error"; message: string };

function cellText(cell: Element): string {
  const copy = cell.cloneNode(true) as Element;
  copy.querySelectorAll("br").forEach((br) => br.replaceWith(" | "));
  copy.querySelectorAll("img").forEach((image) => image.remove());
  return (copy.textContent ?? "").replace(/\s+/g, " ").trim();
}

function proposalIdFrom(value: string): string | undefined {
  return (
    value.match(/\b(?:enforce|vote|veto|approve)[A-Za-z]*\(\s*(\d+)/i)?.[1] ??
    value.match(/votes2\/[A-Za-z]+(\d+)\.html/i)?.[1]
  );
}

function dedupeProposalRows(rows: ProposalRow[]): ProposalRow[] {
  const seenProposalIds = new Set<string>();
  return rows.filter((row) => {
    // The legacy API occasionally repeats the same proposal row many times.
    // Only IDs extracted from its handlers are stable enough to deduplicate;
    // rows without an ID stay visible until on-chain reconciliation exists.
    if (!row.proposalId) return true;
    if (seenProposalIds.has(row.proposalId)) return false;
    seenProposalIds.add(row.proposalId);
    return true;
  });
}

const SNAPSHOT_HEADERS: Record<SnapshotModule, string[]> = {
  allocation: ["For Pool", "Allocation", "DEGEN Committed", "Validates in", "Action"],
  rollover: ["For Pool", "Proposed Bonus", "DEGEN Committed", "Validates in", "Action"],
  tax: ["Proposed Tax", "DEGEN Committed", "Validates in", "Action"],
  emissions: ["New Emissions Per Block", "DEGEN Committed", "Validates in", "Action"],
  treasury: ["Token", "Recipient", "Amount", "DEGEN Committed", "Validates in", "Action"],
};

// Legacy HTML can enrich a known ID, but cannot add, omit or classify chain records.
export function proposalTablesFromSnapshot(snapshot: ProposalSnapshot, legacy?: ProposalTables): ProposalTables {
  const metadata = ["User Rep", "Proposer", "Enforcer", "Rejector", "Legacy outcome"];
  const headers = [...SNAPSHOT_HEADERS[snapshot.module], ...(legacy ? metadata : [])];
  const sourceRows = new Map<string, Map<string, string>>();
  let ignoredLegacyRows = 0;
  for (const table of legacy ? [legacy.active, legacy.expired] : []) {
    for (const row of table.rows) {
      if (!row.proposalId || !/^\d+$/.test(row.proposalId) || BigInt(row.proposalId) >= snapshot.count) {
        ignoredLegacyRows++;
        continue;
      }
      const id = BigInt(row.proposalId).toString();
      const fields = sourceRows.get(id) ?? new Map<string, string>();
      table.headers.forEach((header, index) => {
        const value = row.cells[index]?.trim();
        if (value) fields.set(header.trim().toLowerCase(), value);
      });
      sourceRows.set(id, fields);
    }
  }
  const active: ProposalTable = { headers, rows: [] };
  const expired: ProposalTable = { headers, rows: [] };
  let failedReads = 0;
  for (const item of snapshot.rows) {
    const source = sourceRows.get(item.id);
    const verified = item.value.status === "verified";
    const finished = item.value.status === "verified" && item.value.lifecycle === "finished";
    const row: ProposalRow = {
      proposalId: item.id,
      actions: finished ? [] : [{ label: "On-chain state", proposalId: item.id }],
      cells: headers.map(header => {
        if (header === "For Pool") {
          const label = source?.get("for pool");
          return label && verified ? `${label} (legacy label)` : verified ? "Reward pool" : "Pool unavailable";
        }
        if (header === "Legacy outcome") return source?.get("status") ?? "Not supplied";
        if (metadata.includes(header)) return source?.get(header.toLowerCase()) ?? "Not supplied";
        return verified ? "" : "Unavailable";
      }),
    };
    switch (item.module) {
      case "allocation": row.rewardAllocation = item.value; break;
      case "rollover": row.rolloverBonus = item.value; break;
      case "tax": row.transactionTax = item.value; break;
      case "emissions": row.emissions = item.value; break;
      case "treasury": row.treasury = item.value; break;
    }
    if (!verified) {
      failedReads++;
      active.rows.push(row);
      expired.rows.push(row);
    } else {
      (finished ? expired : active).rows.push(row);
    }
  }
  return {
    active, expired, snapshotBlock: snapshot.block, snapshotTime: snapshot.timestamp,
    proposalCount: snapshot.count, failedReads, ignoredLegacyRows,
    legacyStatus: legacy ? "available" : "loading",
  };
}

function parseProposalTable(table: Element | null): ProposalTable {
  if (!table) return { headers: [], rows: [] };

  const headers = [...table.querySelectorAll("thead th")].map(cellText);
  const rows = dedupeProposalRows(
    [...table.querySelectorAll("tbody tr")].map((row) => {
      const actions = [...row.querySelectorAll("button[onclick]")].map(
        (button) => {
          const handler = button.getAttribute("onclick") ?? "";
          return {
            label: cellText(button),
            proposalId: proposalIdFrom(handler),
          };
        },
      );
      const handlers = [...row.querySelectorAll("[onclick]")]
        .map((element) => element.getAttribute("onclick") ?? "")
        .join(" ");

      return {
        cells: [...row.querySelectorAll(":scope > td")].map(cellText),
        actions,
        proposalId:
          actions.find((action) => action.proposalId)?.proposalId ??
          proposalIdFrom(handlers),
      };
    }),
  );

  return { headers, rows };
}

export function parseProposalTables(html: string): ProposalTables {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const tables = [...doc.querySelectorAll("table")];
  return {
    active: parseProposalTable(
      tables.find((table) => table.id.toLowerCase().endsWith("-active")) ??
        null,
    ),
    expired: parseProposalTable(
      tables.find((table) => table.id.toLowerCase().endsWith("-expired")) ??
        null,
    ),
  };
}

type GovCategory = {
  id: GovernanceModule;
  navLabel: string;
  title: string;
  subtitle: string;
  explain: string;
};

const CATEGORIES: GovCategory[] = [
  {
    id: "allocation",
    navLabel: "Reward Allocation",
    title: "Set Reward Allocation",
    subtitle: "Share of total emissions directed to each pool",
    explain:
      "Every block, the protocol mints new DEGEN and splits it across the staking pools. This module decides who gets what share. Think of it as the DAO's budget: propose a bigger slice for pools you believe deserve more rewards, and a smaller one for pools that don't.",
  },
  {
    id: "rollover",
    navLabel: "Roll-Over Bonuses",
    title: "Set Roll-Over Bonuses",
    subtitle: "Bonuses for each verified miner duration",
    explain:
      "When a miner matures, its owner can extend (roll over) instead of cashing out — and pay themself a bonus for doing so. This module sets how big that bonus is for each miner duration. Higher bonuses encourage people to keep their miners locked.",
  },
  {
    id: "tax",
    navLabel: "Transaction Tax",
    title: "Set Transaction Tax",
    subtitle: "Current transfer tax is read directly from the DEGEN token",
    explain:
      "A tax charged on DEGEN transfers. Proceeds support the protocol. This module lets the DAO raise or lower it — higher tax means more revenue but less trading, lower tax the reverse.",
  },
  {
    id: "emissions",
    navLabel: "Emissions",
    title: "Change Emissions",
    subtitle: "New DEGEN issued as rewards per block",
    explain:
      "Emissions are the new DEGEN minted with every block and paid out as rewards. Raising emissions makes mining more rewarding but inflates supply faster; lowering them does the opposite. This is the protocol's money printer dial.",
  },
  {
    id: "treasury",
    navLabel: "Treasury Withdraw",
    title: "Request Withdraw From Treasury",
    subtitle: "Collectively controlled by long-term miners and the senate",
    explain:
      "The treasury wallet holds protocol funds and can only be spent through governance. To move money out, someone proposes a transfer here; it must pass the normal vote and then a further share-holder approval before tokens actually leave the treasury. Two locks on the vault.",
  },
  {
    id: "newtoken",
    navLabel: "New Token Rewards",
    title: "Allocate Rewards Towards a New Token",
    subtitle: "Make a new token eligible for emissions",
    explain:
      "Want the protocol to reward stakers of a token it doesn't support yet? Propose its contract address here. If the proposal passes, the DAO can then direct a share of emissions to it via Reward Allocation.",
  },
  {
    id: "fees",
    navLabel: "Mining Fees",
    title: "Set Mining-Associated Fees",
    subtitle: "Read directly from the Governor contract",
    explain:
      "Fees on Pulse-ecosystem mining, sent to the treasury. Deposit and referral values use basis points, while the hourly funding rate uses a separate, finer scale. Enforcing a fee proposal updates the Governor first, then requires a second transaction to synchronize every vault.",
  },
  {
    id: "votecost",
    navLabel: "Cost To Vote",
    title: "Set Minimum Cost To Vote",
    subtitle: "Base voting-credit cost for proposal creation",
    explain:
      "This minimum sets the voting-credit cost used by proposal creation and related thresholds; some modules require a multiple. Ordinary credit votes do not all enforce this minimum. This module changes the balance between proposal cost and accessibility.",
  },
  {
    id: "delay",
    navLabel: "Enforce Delay",
    title: "Set Delay Before Enforce",
    subtitle: "Base review window before enforcement",
    explain:
      "This is the base review window for most proposal families. Extra delay and module-specific rules also apply; Mining Fees uses a fixed seven-day window.",
  },
];

const PROPOSAL_ENDPOINTS: Record<string, string> = {
  allocation: "proposals2/poolAllocation.html",
  rollover: "proposals2/rollOverBonus.html",
  tax: "proposals2/governorTax.html",
  emissions: "proposals2/tokenBurn.html",
  treasury: "proposals2/treasuryTransfer.html",
  newtoken: "proposals2/addToken.html",
  fees: "proposals2/miningFees.html",
  votecost: "proposals2/costToVote.html",
  delay: "proposals2/delayBeforeEnforce.html",
};

const VOTING_POOLS = [
  {
    label: "1 Month",
    address: "0xd9b491ac0f5487673500b67224b67b4171a08aca",
    multiplier: 0.2,
  },
  {
    label: "3 Month",
    address: "0x7ED33f65A0398cb26eaB2B03877825c96D9B6077",
    multiplier: 0.3,
  },
  {
    label: "1 Year",
    address: "0x3d175C8359169b0e830d36EA9CD3FE209f46f7BD",
    multiplier: 0.6,
  },
  {
    label: "10 Year",
    address: "0xdE672FccA32365bD704c39bd1164a0D34a3a73e6",
    multiplier: 1.5,
  },
] as const;

const VOTING_POOL_ABI = [
  "function getUserTotalShares(address user) view returns (uint256)",
  "function getPricePerFullShare() view returns (uint256)",
] as const;

function formatVotingPower(value: number): string {
  return Math.round(value).toLocaleString();
}

function formatCreditAmount(value: bigint): string {
  const formatted = formatUnits(value, 18);
  const [whole, fractional = ""] = formatted.split(".");
  const trimmed = fractional.replace(/0+$/, "");
  return `${BigInt(whole).toLocaleString()}${trimmed ? `.${trimmed}` : ""}`;
}

function formatCompactCreditAmount(value: bigint): string {
  const [whole, fractional = ""] = formatCreditAmount(value).split(".");
  const shortened = fractional.slice(0, 6).replace(/0+$/, "");
  return `${whole}${shortened ? `.${shortened}` : ""}`;
}

function rewardAllocationLifecycleText(
  reconciliation: RewardAllocationReconciliation,
): string {
  if (reconciliation.status === "error") {
    return `Unverified — ${reconciliation.message}`;
  }
  switch (reconciliation.lifecycle) {
    case "finished":
      return "Finished on-chain";
    case "voting":
      return `Voting until ${new Date(reconciliation.reviewEndsAt * 1000).toLocaleString()}`;
    case "vetoable":
      return "Against votes lead — veto is available";
    case "settling":
      return "Voting closed — waiting for the next block";
    case "enforceable":
      return "Ready to enforce on-chain";
  }
}

function rewardAllocationActionText(
  reconciliation: RewardAllocationReconciliation,
): string {
  if (reconciliation.status === "error") return "Unverified";
  switch (reconciliation.lifecycle) {
    case "finished":
      return "Finished";
    case "voting":
      return "Voting Open";
    case "vetoable":
      return "Veto";
    case "settling":
      return "Waiting";
    case "enforceable":
      return "Enforce";
  }
}

function rewardAllocationCell(
  row: ProposalRow,
  header: string,
  fallback: string,
): string {
  const reconciliation = row.rewardAllocation;
  if (!reconciliation || reconciliation.status === "error") return fallback;

  switch (header.toLowerCase()) {
    case "for pool":
      return `${fallback} · Pool #${reconciliation.proposal.poolId}`;
    case "allocation":
      return formatAllocationPercent(reconciliation.proposal.newAllocation);
    case "degen committed":
      return `For: ${formatCreditAmount(reconciliation.proposal.votesFor)} DEGEN | Against: ${formatCreditAmount(reconciliation.proposal.votesAgainst)} DEGEN`;
    case "validates in":
      return rewardAllocationLifecycleText(reconciliation);
    default:
      return fallback;
  }
}

function rolloverBonusLifecycleText(
  reconciliation: RolloverBonusReconciliation,
): string {
  if (reconciliation.status === "error") {
    return `Unverified — ${reconciliation.message}`;
  }
  switch (reconciliation.lifecycle) {
    case "finished":
      return "Finished on-chain";
    case "voting":
      return `Voting until ${new Date(reconciliation.reviewEndsAt * 1000).toLocaleString()}`;
    case "vetoable":
      return "Against votes lead — veto is available";
    case "settling":
      return "Voting closed — waiting for the next block";
    case "enforceable":
      return "Ready to enforce on-chain";
  }
}

function rolloverBonusActionText(
  reconciliation: RolloverBonusReconciliation,
): string {
  if (reconciliation.status === "error") return "Unverified";
  switch (reconciliation.lifecycle) {
    case "finished":
      return "Finished";
    case "voting":
      return "Voting Open";
    case "vetoable":
      return "Veto";
    case "settling":
      return "Waiting";
    case "enforceable":
      return "Enforce";
  }
}

function rolloverBonusCell(
  row: ProposalRow,
  header: string,
  fallback: string,
): string {
  const reconciliation = row.rolloverBonus;
  if (!reconciliation || reconciliation.status === "error") return fallback;

  switch (header.toLowerCase()) {
    case "for pool":
      return rolloverPoolLabel(reconciliation.proposal.poolAddress);
    case "proposed bonus":
      return formatRolloverBonusPercent(reconciliation.proposal.newBonus);
    case "degen committed":
      return `For: ${formatCreditAmount(reconciliation.proposal.votesFor)} DEGEN | Against: ${formatCreditAmount(reconciliation.proposal.votesAgainst)} DEGEN`;
    case "validates in":
      return rolloverBonusLifecycleText(reconciliation);
    default:
      return fallback;
  }
}

function transactionTaxLifecycleText(
  reconciliation: TransactionTaxReconciliation,
): string {
  if (reconciliation.status === "error") {
    return `Unverified — ${reconciliation.message}`;
  }

  const lifecycle = (() => {
    switch (reconciliation.lifecycle) {
      case "finished":
        return "Finished on-chain";
      case "voting":
        return `Voting until ${new Date(reconciliation.reviewEndsAt * 1000).toLocaleString()}`;
      case "vetoable":
        return "Against votes lead — veto is available";
      case "settling":
        return "Voting closed — waiting for the next block";
      case "enforceable":
        return "Ready to enforce on-chain";
    }
  })();

  return reconciliation.executionBlockedReason
    ? `${lifecycle} · Blocked: ${reconciliation.executionBlockedReason}`
    : lifecycle;
}

function transactionTaxActionText(
  reconciliation: TransactionTaxReconciliation,
): string {
  if (reconciliation.status === "error") return "Unverified";
  if (reconciliation.executionBlockedReason) return "Blocked";
  switch (reconciliation.lifecycle) {
    case "finished":
      return "Finished";
    case "voting":
      return "Voting Open";
    case "vetoable":
      return "Veto";
    case "settling":
      return "Waiting";
    case "enforceable":
      return "Enforce";
  }
}

function transactionTaxCell(
  row: ProposalRow,
  header: string,
  fallback: string,
): string {
  const reconciliation = row.transactionTax;
  if (!reconciliation || reconciliation.status === "error") return fallback;

  switch (header.toLowerCase()) {
    case "tax":
    case "proposed tax":
    case "transaction tax":
      return formatTransactionTaxPercent(
        reconciliation.proposal.proposedValue,
      );
    case "degen committed":
      return `For: ${formatCreditAmount(reconciliation.proposal.votesFor)} DEGEN | Against: ${formatCreditAmount(reconciliation.proposal.votesAgainst)} DEGEN`;
    case "validates in":
    case "status":
      return transactionTaxLifecycleText(reconciliation);
    default:
      return fallback;
  }
}

function emissionsLifecycleText(
  reconciliation: EmissionsReconciliation,
): string {
  if (reconciliation.status === "error") {
    return `Unverified — ${reconciliation.message}`;
  }

  const lifecycle = (() => {
    switch (reconciliation.lifecycle) {
      case "finished":
        return "Finished on-chain";
      case "voting":
        return `Voting until ${new Date(reconciliation.reviewEndsAt * 1000).toLocaleString()}`;
      case "vetoable":
        return "Against votes lead — veto is available";
      case "settling":
        return "Voting closed — waiting for the next block";
      case "scheduled":
        return `Review passed — scheduled for after ${new Date(Number(reconciliation.proposal.startsAt) * 1000).toLocaleString()}`;
      case "enforceable":
        return "Ready to enforce on-chain";
    }
  })();

  return reconciliation.executionBlockedReason
    ? `${lifecycle} · Blocked: ${reconciliation.executionBlockedReason}`
    : lifecycle;
}

function emissionsActionText(
  reconciliation: EmissionsReconciliation,
): string {
  if (reconciliation.status === "error") return "Unverified";
  if (reconciliation.executionBlockedReason) return "Blocked";
  switch (reconciliation.lifecycle) {
    case "finished":
      return "Finished";
    case "voting":
      return "Voting Open";
    case "vetoable":
      return "Veto";
    case "settling":
      return "Waiting";
    case "scheduled":
      return "Scheduled";
    case "enforceable":
      return "Enforce";
  }
}

function emissionsCell(
  row: ProposalRow,
  header: string,
  fallback: string,
): string {
  const reconciliation = row.emissions;
  if (!reconciliation || reconciliation.status === "error") return fallback;

  switch (header.toLowerCase()) {
    case "new reward per block":
    case "new emissions per block":
      return reconciliation.proposal.isEmissions
        ? formatEmissionPerBlock(reconciliation.proposal.proposedValue)
        : `${reconciliation.proposal.proposedValue.toString()} raw units (non-emissions subtype)`;
    case "commitment":
    case "degen committed":
      return `For: ${formatCreditAmount(reconciliation.proposal.votesFor)} DEGEN | Against: ${formatCreditAmount(reconciliation.proposal.votesAgainst)} DEGEN`;
    case "validates in":
      return emissionsLifecycleText(reconciliation);
    case "status": {
      const onChainState = emissionsLifecycleText(reconciliation);
      return reconciliation.lifecycle === "finished" && fallback
        ? `${onChainState} · Legacy feed: ${fallback}`
        : onChainState;
    }
    default:
      return fallback;
  }
}

function treasuryLifecycleText(
  reconciliation: TreasuryReconciliation,
): string {
  if (reconciliation.status === "error") {
    return `Unverified — ${reconciliation.message}`;
  }

  const consensusFor = formatCompactCreditAmount(
    reconciliation.consensus.votesFor,
  );
  const consensusAgainst = formatCompactCreditAmount(
    reconciliation.consensus.votesAgainst,
  );
  const supportRequired = formatCompactCreditAmount(
    reconciliation.consensusSupportRequired,
  );
  switch (reconciliation.lifecycle) {
    case "finished":
      return "Finished on-chain";
    case "credit-voting":
      return `DEGEN credit voting until ${new Date(reconciliation.creditVotingEndsAt * 1000).toLocaleString()}`;
    case "credit-vetoable":
      return "Against credit votes lead — veto is available";
    case "consensus-voting":
      return `Locked-miner consensus until ${new Date(reconciliation.finalizesAt * 1000).toLocaleString()} · support ${consensusFor} / ${supportRequired} required · against ${consensusAgainst}`;
    case "consensus-rejection-pending":
      return `Credit vote failed — awaiting final rejection after ${new Date(reconciliation.finalizesAt * 1000).toLocaleString()}`;
    case "finalizable-approval":
      return `Ready for final approval · locked support ${consensusFor} / ${supportRequired} required · against ${consensusAgainst}`;
    case "finalizable-rejection":
      return `Ready to finalize rejection · locked support ${consensusFor} / ${supportRequired} required · against ${consensusAgainst}`;
  }
}

function treasuryActionText(
  reconciliation: TreasuryReconciliation,
): string {
  if (reconciliation.status === "error") return "Unverified";
  switch (reconciliation.lifecycle) {
    case "finished":
      return "Finished";
    case "credit-voting":
      return "Credit Voting Open";
    case "credit-vetoable":
      return "Veto";
    case "consensus-voting":
      return "Consensus Open";
    case "consensus-rejection-pending":
      return "Awaiting Rejection";
    case "finalizable-approval":
      return "Approve Transfer";
    case "finalizable-rejection":
      return "Finalize Rejection";
  }
}

function treasuryCell(
  row: ProposalRow,
  header: string,
  fallback: string,
): string {
  const reconciliation = row.treasury;
  if (!reconciliation || reconciliation.status === "error") return fallback;

  switch (header.toLowerCase()) {
    case "token":
      return `Proposal #${row.proposalId ?? "?"} · ${reconciliation.asset.symbol} (${shortAddress(reconciliation.proposal.tokenAddress)})`;
    case "recipient":
      return shortAddress(reconciliation.proposal.beneficiary);
    case "amount":
      return formatTreasuryAmount(
        reconciliation.proposal.amountToSend,
        reconciliation.asset.decimals,
        reconciliation.asset.symbol,
      );
    case "commitment":
    case "degen committed":
      return `For: ${formatCreditAmount(reconciliation.proposal.creditVotesFor)} DEGEN | Against: ${formatCreditAmount(reconciliation.proposal.creditVotesAgainst)} DEGEN`;
    case "validates in":
      return treasuryLifecycleText(reconciliation);
    case "status": {
      const onChainState = treasuryLifecycleText(reconciliation);
      return reconciliation.lifecycle === "finished" && fallback
        ? `${onChainState} · Legacy feed: ${fallback}`
        : onChainState;
    }
    default:
      return fallback;
  }
}

const COUNCIL_ACTIONS = [
  "Rebalance Rewards",
  "Harvest Vault Rewards",
  "Buy-Back OINK & Create Reserves",
  "NFT Miner Buy-Back",
  "Harvest NFT Miners",
];

export function GovernanceProposalCell({ row, header, fallback, category }: {
  row: ProposalRow; header: string; fallback: string; category: string;
}) {
  const key = header.trim().toLowerCase();
  const reconciliation = category === "allocation" ? row.rewardAllocation
    : category === "rollover" ? row.rolloverBonus
    : category === "tax" ? row.transactionTax
    : category === "emissions" ? row.emissions
    : category === "treasury" ? row.treasury : undefined;
  if (["degen committed", "commitment"].includes(key) && reconciliation?.status === "verified") {
    const proposal = reconciliation.proposal;
    return <ProposalVotes
      forVotes={"creditVotesFor" in proposal ? proposal.creditVotesFor : proposal.votesFor}
      againstVotes={"creditVotesAgainst" in proposal ? proposal.creditVotesAgainst : proposal.votesAgainst}
    />;
  }
  const format = category === "allocation" ? rewardAllocationCell
    : category === "rollover" ? rolloverBonusCell
    : category === "tax" ? transactionTaxCell
    : category === "emissions" ? emissionsCell
    : category === "treasury" ? treasuryCell : undefined;
  const text = reconciliation?.status === "error" && ["validates in", "status"].includes(key)
    ? `Unverified — ${reconciliation.message}`
    : format ? format(row, key, fallback) : fallback;
  return <ProposalTextCell header={key} text={text} verified={reconciliation?.status === "verified"} />;
}

export function GovernanceProposalAction({ row, category }: { row: ProposalRow; category: string }) {
  const result = category === "allocation" ? row.rewardAllocation
    : category === "rollover" ? row.rolloverBonus : category === "tax" ? row.transactionTax
    : category === "emissions" ? row.emissions : category === "treasury" ? row.treasury : undefined;
  if (!row.proposalId || !result || result.status !== "verified") return <span className="gov-form-note">Proposal verification unavailable.</span>;
  return <GovernanceActionControls module={category as GovernanceModule} proposalId={row.proposalId}
    verified valid={result.proposal.valid} phase={result.lifecycle}
    blockedReason={category === "emissions" && row.emissions?.status === "verified" ? row.emissions.executionBlockedReason : undefined} />;

}

export function GovernanceProposalCards({ table, category, categoryLabel }: {
  table: ProposalTable; category: string; categoryLabel: string;
}) {
  const columns = table.headers.map((header, index) => ({ header, index, key: header.trim().toLowerCase() }));
  const identity = columns.find(col => ["for pool", "token", "proposed pool"].includes(col.key));
  const status = columns.find(col => ["validates in", "status", "on-chain state"].includes(col.key));
  const votes = columns.find(col => ["degen committed", "commitment"].includes(col.key));
  const other = columns.filter(col => col !== identity && col !== status && col !== votes && col.key !== "action");
  const isMetadata = (key: string) => ["user rep", "proposer", "enforcer", "rejector", "recipient", "legacy outcome"].includes(key);
  return <div className="gov-proposal-list">{table.rows.map((row, index) => {
    const verifiedVotes = (category === "allocation" ? row.rewardAllocation
      : category === "rollover" ? row.rolloverBonus : category === "tax" ? row.transactionTax
      : category === "emissions" ? row.emissions : category === "treasury" ? row.treasury : undefined)?.status === "verified";
    const cell = (col: typeof columns[number]) => <GovernanceProposalCell row={row} header={col.header} fallback={row.cells[col.index] ?? ""} category={category} />;
    const field = (col: typeof columns[number]) => ({ label: proposalColumnLabel(col.header), value: cell(col) });
    // Unexpected or extra legacy fields remain accessible, including cells lacking a header.
    const metadata = other.filter(col => isMetadata(col.key)).map(field);
    row.cells.slice(table.headers.length).forEach((value, extra) => metadata.push({ label: `Additional legacy field ${extra + 1}`, value: <ProposalTextCell header="legacy" text={value} /> }));
    return <ProposalCard key={`${row.proposalId ?? "legacy"}-${index}`} id={row.proposalId}
      title={identity ? cell(identity) : categoryLabel}
      status={status ? cell(status) : <ProposalTextCell header="status" text="Status unavailable" />}
      fields={other.filter(col => !isMetadata(col.key)).map(field)}
      votes={votes ? cell(votes) : undefined} metadata={metadata}
      votesLabel={verifiedVotes ? "DEGEN credit" : row.rewardAllocation || row.rolloverBonus || row.transactionTax || row.emissions || row.treasury ? "DEGEN credit · unavailable" : "Legacy feed · units unverified"}
      action={row.actions.length > 0 ? <GovernanceProposalAction row={row} category={category} /> : undefined}
    />;
  })}</div>;
}

export function GovernancePage({ wallet }: { wallet: WalletState }) {
  const [activeCat, setActiveCat] = useState(CATEGORIES[0].id);
  const [proposalView, setProposalView] = useState<"active" | "expired">(
    "active",
  );
  const [proposalLimit, setProposalLimit] = useState(20);
  const lastStats = useRef<GovStats>({});

  const statsRead = useQuietRead("governance:stats", async () => {
      const provider = await getPublicProvider();
      const governor = new Contract(
        GOVERNOR_CONTRACT,
        GOVERNOR_READ_ABI,
        provider,
      );
      const degen = new Contract(DEGEN_TOKEN, DEGEN_READ_ABI, provider);
      const masterChef = new Contract(
        MASTER_CHEF,
        MASTER_CHEF_READ_ABI,
        provider,
      );
      const block = await provider.getBlock("latest");
      if (!block) throw new Error("Latest PulseChain block unavailable");
      const atBlock = { blockTag: block.number };
      const results = await Promise.allSettled([
        governor.costToVote(atBlock) as Promise<bigint>,
        governor.delayBeforeEnforce(atBlock) as Promise<bigint>,
        degen.tax(atBlock) as Promise<bigint>,
        masterChef.DTXPerBlock(atBlock) as Promise<bigint>,
        Promise.all(
          VOTING_POOLS.map(
            (pool) => governor.getRollBonus(pool.address, atBlock) as Promise<bigint>,
          ),
        ),
        governor.depositFee(atBlock) as Promise<bigint>,
        governor.fundingRate(atBlock) as Promise<bigint>,
        governor.referralBonus(atBlock) as Promise<bigint>,
      ]);
      const [
        cost,
        delay,
        tax,
        reward,
        roll,
        depositFee,
        fundingRate,
        referralBonus,
      ] = results;
      const next: GovStats = {};
      if (cost.status === "fulfilled")
        next.costToVote = Number(formatUnits(cost.value, 18)).toLocaleString();
      if (delay.status === "fulfilled")
        next.delayHours = (Number(delay.value) / 3600).toString();
      if (tax.status === "fulfilled")
        // DEGEN applies raw tax / 1000, so raw 100 is 10%.
        next.taxPercent = (Number(tax.value) / 10).toString();
      if (reward.status === "fulfilled")
        next.rewardPerBlock = Number(
          formatUnits(reward.value, 18),
        ).toLocaleString();
      if (roll.status === "fulfilled")
        next.rollBonuses = roll.value.map((value) => Number(value) / 100);
      if (
        depositFee.status === "fulfilled" &&
        fundingRate.status === "fulfilled" &&
        referralBonus.status === "fulfilled"
      )
        next.miningFees = {
          depositPercent: Number(depositFee.value) / 100,
          fundingPercent: Number(fundingRate.value) / 10_000,
          referralPercent: Number(referralBonus.value) / 100,
        };
      lastStats.current = { ...lastStats.current, ...next };
      return lastStats.current;
  });
  const stats = statsRead.data ?? {};

  const chainRead = useQuietRead(`governance:snapshot:${activeCat}`, async () => {
    if (!isSnapshotModule(activeCat)) return null;
    return loadProposalSnapshot(activeCat);
  });
  const legacyRead = useQuietRead(`governance:labels:${activeCat}`, async () => {
    const response = await fetch(GOV_API + PROPOSAL_ENDPOINTS[activeCat as SnapshotModule], { signal: AbortSignal.timeout(8000) });
    if (!response.ok) throw new Error("Metadata unavailable");
    return parseProposalTables(await response.text());
  }, 5 * 60_000, Boolean(chainRead.data));
  useEffect(() => setProposalLimit(20), [activeCat, proposalView]);

  const votingRead = useQuietRead(`governance:voting:${wallet.address?.toLowerCase() ?? "guest"}`, async (): Promise<VotingPowerState> => {
    const address = wallet.address!;
        const provider = await getPublicProvider();
        const balances = await Promise.all(
          VOTING_POOLS.map(async (pool) => {
            const contract = new Contract(
              pool.address,
              VOTING_POOL_ABI,
              provider,
            );
            const [shares, pricePerShare] = (await Promise.all([
              contract.getUserTotalShares(address),
              contract.getPricePerFullShare(),
            ])) as [bigint, bigint];
            return {
              ...pool,
              // This is the original site's formula: shares and price per
              // share both use 18 decimals, so their product uses 36.
              balance: Number(formatUnits(shares * pricePerShare, 36)),
            };
          }),
        );
        return {
          status: "ready",
          balances,
          total: balances.reduce((sum, pool) => sum + pool.balance * pool.multiplier, 0),
        };
  }, 60_000, Boolean(wallet.address));
  const votingPower: VotingPowerState = !wallet.address ? { status: "disconnected" }
    : votingRead.data ?? (votingRead.error ? { status: "error", message: "Voting credit unavailable" } : { status: "loading" });

  const category =
    CATEGORIES.find((entry) => entry.id === activeCat) ?? CATEGORIES[0];
  const snapshotTables = chainRead.data ? {
    ...proposalTablesFromSnapshot(chainRead.data, legacyRead.data),
    legacyStatus: legacyRead.data ? "ready" : legacyRead.error ? "unavailable" : "loading",
  } : undefined;
  const fullProposalTable = snapshotTables?.[proposalView] ?? null;
  const proposalTable = fullProposalTable ? { ...fullProposalTable, rows: fullProposalTable.rows.slice(0, proposalLimit) } : null;

  const categorySubtitle = (() => {
    switch (category.id) {
      case "rollover":
        return stats.rollBonuses
          ? `Current: ${stats.rollBonuses.map((value) => `${value}%`).join(" / ")} by miner duration`
          : category.subtitle;
      case "tax":
        return stats.taxPercent !== undefined
          ? `Current transaction tax: ${stats.taxPercent}%`
          : category.subtitle;
      case "emissions":
        return stats.rewardPerBlock
          ? `Current: ${stats.rewardPerBlock} DEGEN per block`
          : category.subtitle;
      case "fees":
        return stats.miningFees
          ? `Deposit ${stats.miningFees.depositPercent}% · Hourly funding ${stats.miningFees.fundingPercent}% · Referral bonus ${stats.miningFees.referralPercent}%`
          : category.subtitle;
      case "votecost":
        return stats.costToVote
          ? `Current: ${stats.costToVote} DEGEN voting credit`
          : category.subtitle;
      case "delay":
        return stats.delayHours
          ? `Current: ${stats.delayHours} hours (${Number(stats.delayHours) / 24} days)`
          : category.subtitle;
      default:
        return category.subtitle;
    }
  })();

  return (
    <GovernanceWalletContext.Provider value={wallet}><main className="governance-studio" aria-label="Governance">
      <div className="gov-wrap">
        {GOVERNANCE_ACTIONS_DISABLED && <aside className="gov-preview-notice" aria-label="Governance actions status">
          <strong>Governance · Actions temporarily disabled</strong>
          <p>{GOVERNANCE_ACTIONS_NOTICE}</p>
        </aside>}
        <header className="gov-page-header">
          <div className="gov-mode"><strong>Degen Council</strong><span>{GOVERNANCE_ACTIONS_DISABLED ? "Read-only preview" : "Verified contract actions"}</span></div>
        </header>
        <dl className="gov-stats" aria-label="Protocol parameters">
          <div className="gov-stat">
            <dt className="gov-stat-label">Base proposal cost<HelpTip label="proposal cost">Voting credit is consumed when used. It is separate from wallet tokens and miner principal.</HelpTip></dt>
            <dd className="gov-stat-val">
              {stats.costToVote
                ? stats.costToVote
                : "…"}
              <span className="gov-stat-unit">DEGEN credit</span>
            </dd>
          </div>
          <div className="gov-stat">
            <dt className="gov-stat-label">Base review window</dt>
            <dd className="gov-stat-val">
              {stats.delayHours ? `${stats.delayHours} hours` : "…"}
            </dd>
          </div>
          <div className="gov-stat">
            <dt className="gov-stat-label">Transaction Tax</dt>
            <dd className="gov-stat-val">
              {stats.taxPercent !== undefined ? `${stats.taxPercent}%` : "…"}
            </dd>
          </div>
          <div className="gov-stat">
            <dt className="gov-stat-label">DEGEN emissions / block</dt>
            <dd className="gov-stat-val"><ChangingValue value={stats.rewardPerBlock}>{stats.rewardPerBlock ?? "…"}</ChangingValue></dd>
          </div>
        </dl>


        <div className="gov-grid">
          <nav className="gov-rail" aria-label="Governance modules">
            {CATEGORIES.map((entry) => (
              <button
                key={entry.id}
                className={`gov-rail-btn${entry.id === activeCat ? " active" : ""}`}
                aria-pressed={entry.id === activeCat}
                onClick={() => setActiveCat(entry.id)}
              >
                {entry.navLabel}
              </button>
            ))}
          </nav>

          <div className="gov-content">
            <div className="gov-module-heading"><h2 className="gov-module-title">{category.navLabel}</h2><p className="gov-current">{categorySubtitle}</p></div>
            <GovernanceComposer module={activeCat} title={category.title} subtitle={categorySubtitle} explain={category.explain} wallet={wallet} />
            {activeCat === "newtoken" ? <NewTokenProposals /> : isParameterModule(activeCat) ? <ParameterProposals key={activeCat} module={activeCat} /> : <div className="gov-card">
              <div className="gov-prop-header">
                <div><h2>Proposals</h2><p className="gov-proposal-caption">On-chain review <span>On-chain</span></p></div>
                <div className="gov-prop-toggle">
                  <button
                    className={proposalView === "active" ? "active" : undefined}
                    aria-pressed={proposalView === "active"}
                    onClick={() => setProposalView("active")}
                  >
                    Open
                  </button>
                  <button
                    aria-pressed={proposalView === "expired"}
                    className={
                      proposalView === "expired" ? "active" : undefined
                    }
                    onClick={() => setProposalView("expired")}
                  >
                    History
                  </button>
                </div>
              </div>
              {!!snapshotTables?.failedReads && <p className="gov-prop-error" role="alert">{snapshotTables.failedReads} proposal reads failed. Unverified IDs remain in both views. </p>}
              {chainRead.isLoading ? (
                <div className="gov-empty-note" role="status">Loading on-chain proposals…</div>
              ) : !chainRead.data && chainRead.error ? (
                <div className="gov-empty-note gov-prop-error" role="alert">On-chain proposals are temporarily unavailable.</div>
              ) : proposalTable && proposalTable.rows.length > 0 ? (
                <ScrollRegion label={`${category.navLabel} ${proposalView === "active" ? "open proposals" : "proposal history"}`} resetKey={`${activeCat}:${proposalView}`}>
                  <GovernanceProposalCards table={proposalTable} category={activeCat} categoryLabel={category.navLabel} />
                </ScrollRegion>
              ) : (
                <div className="gov-empty-note">
                  No {proposalView === "active" ? "open" : "historical"} proposals
                  for this module.
                </div>
              )}
              {fullProposalTable && fullProposalTable.rows.length > proposalLimit && <button className="gov-action-btn" onClick={() => setProposalLimit(value => value + 20)}>Show more</button>}
              <details className="gov-source-details"><summary>Data sources & verification</summary>
                <div className="gov-explain">
                  Every proposal ID is read directly from the deployed contract at one block.
                  Open contains valid, unresolved proposals; their voting window may already have ended.
                  History contains finished proposals, not proof of successful execution.
                  Failed reads remain in both views until a refresh verifies their state.
                  Legacy labels and actor/outcome details are optional, unverified metadata.
                </div>
                {snapshotTables && <div className="gov-chain-note">
                  {Number(snapshotTables.proposalCount ?? 0n) - (snapshotTables.failedReads ?? 0)} of {String(snapshotTables.proposalCount ?? 0n)} proposal IDs verified
                  directly from the deployed contract.
                  {snapshotTables.legacyStatus === "unavailable" && " Legacy metadata is unavailable; on-chain results remain visible."}
                  {snapshotTables.legacyStatus === "loading" && " Optional legacy metadata is loading."}
                  {!!snapshotTables.ignoredLegacyRows && ` ${snapshotTables.ignoredLegacyRows} legacy records could not be matched to a snapshot ID and were excluded.`}

                </div>}
                {activeCat === "tax" && <div className="gov-chain-note">Values above 10% remain flagged because the token contract rejects their execution even though Farms can create them.</div>}
                {activeCat === "emissions" && <div className="gov-chain-note">The Governor-Transfer namespace is fully enumerated. Non-emissions subtypes are explicitly flagged, not treated as emission updates. Amounts use 18-decimal units.</div>}
                {activeCat === "treasury" && <div className="gov-chain-note">Token precision, DEGEN credit votes and linked OINK locked-miner consensus are read at the same snapshot block. Transfer outcomes are checked against contract events and asset effects after confirmation.</div>}
              </details>
            </div>}
          </div>
        </div>

        <section className="gov-resources" aria-label="Governance reference">
          <details><summary>How governance works</summary><div className="gov-resource-body">
        <div className="gov-how">
          <div className="gov-how-step">
            <span className="gov-how-num">1</span>
            <strong>Check voting credit</strong>
            <p>
              Proposal and yes/no calls consume DEGEN voting credit. It is
              sacrificed on-chain, not temporarily locked or automatically
              returned.
            </p>
          </div>
          <div className="gov-how-step">
            <span className="gov-how-num">2</span>
            <strong>Propose a change</strong>
            <p>
              Pick a setting, enter its new value, and choose how much voting
              credit to sacrifice.
            </p>
          </div>
          <div className="gov-how-step">
            <span className="gov-how-num">3</span>
            <strong>Community reviews</strong>
            <p>
              Most proposals wait the selected extra delay plus the current
              {` ${stats.delayHours ?? "…"}-hour `}
              base delay. During that window, voters can spend credit for or
              against the proposal.
            </p>
          </div>
          <div className="gov-how-step">
            <span className="gov-how-num">4</span>
            <strong>Enforce it</strong>
            <p>
              After review, an eligible proposal can enter enforcement.
            </p>
          </div>
        </div>

        <div className="gov-glossary">
          <span className="gov-term">
            <b>Commitment</b> — DEGEN voting credit permanently consumed by a
            proposal or vote; it is not a refundable lock
          </span>
          <span className="gov-term">
            <b>Delay</b> — the review window where others can reject a proposal
            before it passes
          </span>
          <span className="gov-term">
            <b>Enforce</b> — the final click that applies a passed proposal
            on-chain
          </span>
          <span className="gov-term">
            <b>Miner consensus</b> — a separate locked-share vote used by
            treasury approval, not ordinary proposal voting
          </span>
        </div>


          </div></details>
          <details><summary>Miner voting & wallet</summary><div className="gov-resource-body">
        <div className="gov-section-label">
          Reference DEGEN Miner Weight (separate consensus path)
        </div>
        <div className="gov-power-row">
          <div className="gov-power">
            <span>1 Month Miner</span>
            <strong>20%</strong>
          </div>
          <div className="gov-power">
            <span>3 Month Miner</span>
            <strong>30%</strong>
          </div>
          <div className="gov-power">
            <span>1 Year Miner</span>
            <strong>60%</strong>
          </div>
          <div className="gov-power max">
            <span>10 Year Miner</span>
            <strong>150%</strong>
          </div>
        </div>

        <div className="gov-mypower">
          <div className="gov-mypower-info">
            <div className="gov-mypower-label">Your Effective Voting Power</div>
            <div className="gov-mypower-val">
              {votingPower.status === "ready"
                ? `${formatVotingPower(votingPower.total)} DEGEN`
                : votingPower.status === "loading"
                  ? "Loading…"
                  : votingPower.status === "error"
                    ? "Unavailable"
                    : "Connect wallet"}
            </div>
            <div className="gov-mypower-sub">
              This is how much weight your vote carries when you support or
              reject through a compatible miner-consensus contract. It comes
              from the DEGEN inside each miner, multiplied by that miner&apos;s
              duration bonus. This is not the credit balance spent by the
              proposal forms below.
            </div>
            {votingPower.status === "ready" ? (
              <div className="gov-power-breakdown">
                {votingPower.balances.map((pool) => (
                  <span key={pool.address}>
                    <b>{pool.label}</b>
                    {formatVotingPower(pool.balance * pool.multiplier)}
                  </span>
                ))}
              </div>
            ) : votingPower.status === "error" ? (
              <div className="gov-mypower-error" role="alert">
                {votingPower.message}
              </div>
            ) : null}
          </div>
          {wallet.address ? (
            <button className="gov-vote-btn" disabled>
              Miner proxy unavailable
            </button>
          ) : (
            <button
              className="gov-vote-btn"
              disabled={wallet.connecting}
              onClick={() => void wallet.connect()}
            >
              {wallet.connecting ? "Connecting…" : "Connect Wallet"}
            </button>
          )}
        </div>


          </div></details>
          <details><summary>Council operations</summary><div className="gov-resource-body">
        <div className="gov-section-label">Council Actions</div>
        <GovernanceMaintenance />
        <details><summary>Other maintenance operations</summary><p className="gov-form-note">These operations remain unavailable because their complete swap or per-vault outcomes have not been verified.</p><div className="gov-actions">
          {COUNCIL_ACTIONS.filter(action => action !== "Rebalance Rewards").map((action) => (
            <button
              key={action}
              className="gov-action-btn"
              disabled
            >
              {action}
            </button>
          ))}
        </div></details>


          </div></details>
        </section>
      </div>
    </main></GovernanceWalletContext.Provider>
  );
}
