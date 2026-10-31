import { Interface, getAddress, isAddress, ZeroAddress } from "ethers";
import { CREDIT_UNIT, GOVERNANCE_ADDRESSES, GOVERNANCE_CALLS, GOVERNANCE_CHAIN_ID, MAX_UINT256, SEVEN_DAYS, type GovernanceAction, type GovernanceModule } from "./governanceSpec";
import type { GovernanceFormContext, ProposalAsset } from "./formContext";

export type ProposalDraft = { value: string; poolId: string; poolAddress: string; feeType: string; tokenAddress: string; recipient: string; commitment: string; extraDelay: string };
export const EMPTY_PROPOSAL_DRAFT: ProposalDraft = { value: "", poolId: "", poolAddress: "", feeType: "0", tokenAddress: GOVERNANCE_ADDRESSES.token, recipient: "", commitment: "", extraDelay: "0" };
export type DraftErrors = Partial<Record<keyof ProposalDraft | "context", string>>;
export type GovernanceCall = {
  module: GovernanceModule; action: GovernanceAction; chainId: bigint; to: string;
  signature: string; method: string; args: readonly (bigint | string | boolean)[];
  data: string; value: bigint; creditConsumed: bigint;
};

/** Exact plain-decimal parsing: no floating point, exponents, rounding or truncation. */
export function parseGovernanceAmount(input: string, decimals: number): bigint {
  const value = input.trim();
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 255) throw new Error("Unsupported precision.");
  if (value.length > 335) throw new Error("Amount exceeds the contract integer range.");
  if (!/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(value)) throw new Error("Use a plain non-negative number without commas or exponents.");
  if (value.includes(".") && value.split(".")[1].length > decimals) throw new Error(decimals ? `Use at most ${decimals} decimal places.` : "Use whole numbers only.");
  const [whole, fraction = ""] = value.split(".");
  const raw = BigInt(whole) * 10n ** BigInt(decimals) + BigInt(fraction.padEnd(decimals, "0") || "0");
  if (raw > MAX_UINT256) throw new Error("Amount exceeds the contract integer range.");
  return raw;
}

export function encodeGovernanceCall(module: GovernanceModule, action: GovernanceAction, args: readonly (bigint | string | boolean)[], creditConsumed = 0n): GovernanceCall {
  const spec = GOVERNANCE_CALLS[module];
  const signature = spec[action];
  const iface = new Interface([`function ${signature}`]);
  return { module, action, chainId: GOVERNANCE_CHAIN_ID, to: GOVERNANCE_ADDRESSES[spec.target], signature, method: signature.split("(")[0], args,
    data: iface.encodeFunctionData(signature, [...args]), value: 0n, creditConsumed };
}

// Prepared bytes only: this module has no provider, signer or broadcasting capability.
export function encodeProposalAction(module: GovernanceModule, action: Exclude<GovernanceAction, "create">, id: string, credit = "0", withAction = false): GovernanceCall {
  const proposalId = parseGovernanceAmount(id, 0);
  // Ordinary votes have no costToVote minimum and support exact fractional credit.
  const amount = action === "yes" || action === "no" ? parseGovernanceAmount(credit, 18) : 0n;
  const args = action === "yes" ? [proposalId, amount] : action === "no" ? [proposalId, amount, withAction]
    : action === "enforce" && module === "allocation" ? [proposalId, true] : [proposalId];
  return encodeGovernanceCall(module, action, args, amount);
}

export type ProposalValidation = { errors: DraftErrors; warnings: string[]; call?: GovernanceCall };
export function validateProposal(module: GovernanceModule, draft: ProposalDraft, context?: GovernanceFormContext, asset?: ProposalAsset): ProposalValidation {
  const errors: DraftErrors = {};
  const warnings: string[] = [];
  const amount = (key: keyof ProposalDraft, decimals: number) => {
    try { return parseGovernanceAmount(draft[key], decimals); }
    catch (error) { errors[key] = error instanceof Error ? error.message : "Invalid value"; return 0n; }
  };
  const address = (key: "recipient" | "poolAddress" | "tokenAddress", allowZero = false) => {
    const value = draft[key].trim();
    if (!isAddress(value) || (!allowZero && value.toLowerCase() === ZeroAddress)) {
      errors[key] = "Enter a complete, non-zero address."; return ZeroAddress;
    }
    return getAddress(value);
  };
  const commitment = amount("commitment", 0) * CREDIT_UNIT;
  const hours = amount("extraDelay", 0);
  const delay = hours * 3600n;
  if (commitment > MAX_UINT256) errors.commitment = "Commitment exceeds the contract integer range.";
  if (delay > MAX_UINT256) errors.extraDelay = "Delay exceeds the contract integer range.";
  if (!context) errors.context = "Load current contract rules before reviewing a proposal.";
  else {
    if (delay > (module === "fees" ? SEVEN_DAYS : context.baseDelay)) errors.extraDelay = "Extra delay exceeds the current maximum.";
    if (!context.account || context.credit === undefined) errors.context = "Connect your wallet to verify available DEGEN voting credit.";
    else if (commitment > context.credit) errors.commitment = "Not enough DEGEN voting credit. Wallet DEGEN tokens are not voting credit.";
  }
  let minimum = context?.cost ?? 0n;
  let args: (bigint | string | boolean)[] = [];
  if (module === "allocation") {
    const id = amount("poolId", 0), value = amount("value", 2);
    const pool = context?.pools.find(item => item.id === id);
    if (context && (!pool || id <= 3n || id >= (context.poolCount ?? 0n))) errors.poolId = "Select a verified on-chain reward pool.";
    if (context && pool) {
      const total = context.totalPulseAllocation;
      if (total === undefined || total < pool.allocation) errors.context = "Pool allocation totals are inconsistent; refresh to retry.";
      else if (total - pool.allocation + value >= 10000n) errors.value = "This change would bring the Pulse allocation total to 100% or more and could not execute.";
    }
    args = [commitment, id, value, 0n, delay];
  } else if (module === "rollover") {
    const pool = address("poolAddress"), value = amount("value", 2);
    if (value > 1000n) errors.value = "The proposal contract allows a maximum bonus of 10%.";
    if (context && !context.rolloverPools.some(item => item.toLowerCase() === pool.toLowerCase())) errors.poolAddress = "This site supports the four verified Governor miner pools.";
    args = [commitment, pool, value, delay];
  } else if (module === "tax") {
    const value = amount("value", 1);
    if (value > 100n) errors.value = "The DEGEN token rejects execution above 10%, even though the proposal contract accepts more.";
    args = [commitment, value, delay];
  } else if (module === "emissions") {
    minimum *= 1000n;
    args = [commitment, amount("value", 18), true, 0n, delay];
    warnings.push("This changes protocol-wide issuance. A successful creation simulation does not verify later execution.");
  } else if (module === "treasury" || module === "newtoken") {
    const token = address("tokenAddress", module === "treasury");
    if (!asset || asset.module !== module || asset.address.toLowerCase() !== token.toLowerCase() || asset.block !== context?.block) errors.tokenAddress ??= "Check this asset at the current snapshot before review.";
    if (module === "treasury") {
      minimum *= 100n;
      const recipient = address("recipient"), value = amount("value", asset?.decimals ?? 18);
      if (value === 0n) errors.value ??= "This site requires a positive transfer amount.";
      args = [commitment, token, recipient, value, delay];
      warnings.push("Treasury transfers need a separate locked-miner consensus phase. Simulation of creation does not prove funds will move.");
    } else {
      // The owner can change a private multiplier with no public getter.
      // Never infer the live minimum from a historical source default.
      minimum = 0n;
      if (asset?.existingPool) errors.tokenAddress = "This address is already registered in MasterChef.";
      if (context && (context.poolCount === undefined || context.poolCount >= 50n)) errors.context = "New pools cannot execute at the current pool-count limit.";
      args = [commitment, token, delay];
      warnings.push("The current minimum commitment is checked by the contract before your wallet opens. It can change.");
    }
  } else if (module === "fees") {
    const feeType = amount("feeType", 0), value = amount("value", feeType === 1n ? 4 : 2);
    if (feeType > 2n) errors.feeType = "Select Deposit, Hourly Funding or Referral; other values can execute without changing a setting.";
    if (value > (feeType === 1n ? 1000n : 2500n)) errors.value = feeType === 1n ? "This site's source-based safety limit is 0.1% per hour." : "This site's safety limit is 25%.";
    args = [commitment, feeType, value, delay];
    warnings.push("Fee execution needs a separate vault synchronization. Source-based limits are not a substitute for checking every deployed vault; a successful sync receipt alone is insufficient.");
  } else if (module === "votecost") {
    const value = amount("value", 18);
    if (value > minimum) minimum = value;
    if (context && (context.totalSupply === undefined || value > context.totalSupply / 10000n)) errors.value = "New cost cannot exceed 0.01% of the token's current totalSupply getter.";
    args = [commitment, value, delay];
  } else {
    minimum = 0n; // Basic's delay initializer does not enforce costToVote.
    const value = amount("value", 0);
    if (value < 24n || value > 336n) errors.value = "New delay must be 24–336 whole hours.";
    args = [commitment, value * 3600n, delay];
    warnings.push("This proposal family has no minimum commitment requirement; any committed credit is still consumed.");
  }
  if (context && commitment < minimum) errors.commitment ??= `Requires at least ${(minimum + CREDIT_UNIT - 1n) / CREDIT_UNIT} whole DEGEN voting credit in this form.`;
  if (Object.keys(errors).length) return { errors, warnings };
  return { errors, warnings, call: encodeGovernanceCall(module, "create", args, commitment) };
}
