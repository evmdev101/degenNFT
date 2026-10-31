/** Pinned DEGEN governance identities. Do not accept transaction targets from API HTML. */
export const GOVERNANCE_CHAIN_ID = 369n;
export const GOVERNANCE_ADDRESSES = {
  governor: "0x456d747622d30C4db69D40973ecf0D29EE007B57",
  farms: "0xCcA87BE305394E3145C9e84464656eF4939B666B",
  basic: "0xb30702C84Fc7ADA23d613B9D0c447009d8183785",
  treasury: "0xF97148335B4C104cfcC0d6abbCCC58c6408BacDF",
  credit: "0xa65fD776D1e495275A7A5B4B660cd228c3EBA6a4",
  token: "0x3E79130ab714E97ee73f86a56a2427bb1A519896",
  masterChef: "0xC84FbE083713544BB4Ea85E2fe95148D076b2942",
} as const;
export const GOVERNANCE_MODULE_IDS = ["allocation", "rollover", "tax", "emissions", "treasury", "newtoken", "fees", "votecost", "delay"] as const;
export type GovernanceModule = typeof GOVERNANCE_MODULE_IDS[number];
export const GOVERNANCE_CREDIT_ABI = ["function userCredit(address) view returns(uint256)"] as const;
export const GOVERNANCE_CONTEXT_ABI = [
  "function costToVote() view returns(uint256)", "function delayBeforeEnforce() view returns(uint256)",
  "function creditContract() view returns(address)",
  "function acPool1() view returns(address)", "function acPool2() view returns(address)",
  "function acPool3() view returns(address)", "function acPool4() view returns(address)",
] as const;
export const GOVERNANCE_POOL_ABI = [
  "function poolLength() view returns(uint256)",
  "function poolInfo(uint256) view returns(uint256 allocPoint,uint256 lastRewardBlock,address participant)",
  "function existingParticipant(address) view returns(bool)",
] as const;
export const GOVERNANCE_ALLOCATION_ABI = [
  "function percentageAllocatedToPulseEcosystem() view returns(uint256)",
  "function poolAllocationPercentage(uint256) view returns(uint256)",
] as const;
export const GOVERNANCE_TOKEN_ABI = [
  "function decimals() view returns(uint8)", "function symbol() view returns(string)",
  "function totalSupply() view returns(uint256)",
] as const;
export const MAX_UINT256 = (1n << 256n) - 1n;
export const CREDIT_UNIT = 10n ** 18n;
export const SEVEN_DAYS = 604800n;
export const FORM_SNAPSHOT_MAX_AGE_MS = 120_000;
// The new-pool multiplier has no public getter and can be changed by its owner.
// This is the last verified value, not an immutable/live-read guarantee.
export const LAST_VERIFIED_NEW_POOL_MULTIPLIER = 250n;

export const GOVERNANCE_CALLS = {
  allocation: { target: "farms", create: "initiateFarmProposal(uint256,uint256,uint256,uint16,uint256)", yes: "voteFarmProposalY(uint256,uint256)", no: "voteFarmProposalN(uint256,uint256,bool)", veto: "vetoFarmProposal(uint256)", enforce: "updateFarm(uint256,bool)" },
  rollover: { target: "basic", create: "initiateProposalRolloverBonus(uint256,address,uint256,uint256)", yes: "voteProposalRolloverBonusY(uint256,uint256)", no: "voteProposalRolloverBonusN(uint256,uint256,bool)", veto: "vetoProposalRolloverBonus(uint256)", enforce: "executeProposalRolloverBonus(uint256)" },
  tax: { target: "farms", create: "proposeGovTax(uint256,uint256,uint256)", yes: "voteGovTaxY(uint256,uint256)", no: "voteGovTaxN(uint256,uint256,bool)", veto: "vetoGovTax(uint256)", enforce: "executeGovTax(uint256)" },
  emissions: { target: "farms", create: "proposeGovernorTransfer(uint256,uint256,bool,uint256,uint256)", yes: "voteGovernorTransferY(uint256,uint256)", no: "voteGovernorTransferN(uint256,uint256,bool)", veto: "vetoGovernorTransfer(uint256)", enforce: "executeGovernorTransfer(uint256)" },
  treasury: { target: "treasury", create: "initiateTreasuryTransferProposal(uint256,address,address,uint256,uint256)", yes: "voteTreasuryTransferProposalY(uint256,uint256)", no: "voteTreasuryTransferProposalN(uint256,uint256,bool)", veto: "vetoTreasuryTransferProposal(uint256)", enforce: "approveTreasuryTransfer(uint256)" },
  newtoken: { target: "basic", create: "initiateNewPool(uint256,address,uint256)", yes: "voteNewPoolY(uint256,uint256)", no: "voteNewPoolN(uint256,uint256,bool)", veto: "vetoNewPool(uint256)", enforce: "executeNewPool(uint256)" },
  fees: { target: "farms", create: "proposeVault(uint256,uint256,uint256,uint256)", yes: "voteVaultY(uint256,uint256)", no: "voteVaultN(uint256,uint256,bool)", veto: "vetoVault(uint256)", enforce: "executeVault(uint256)" },
  votecost: { target: "basic", create: "initiateSetMinDeposit(uint256,uint256,uint256)", yes: "voteSetMinDepositY(uint256,uint256)", no: "voteSetMinDepositN(uint256,uint256,bool)", veto: "vetoSetMinDeposit(uint256)", enforce: "executeSetMinDeposit(uint256)" },
  delay: { target: "basic", create: "initiateDelayBeforeEnforceProposal(uint256,uint256,uint256)", yes: "voteDelayBeforeEnforceProposalY(uint256,uint256)", no: "voteDelayBeforeEnforceProposalN(uint256,uint256,bool)", veto: "vetoDelayBeforeEnforceProposal(uint256)", enforce: "executeDelayBeforeEnforceProposal(uint256)" },
} as const;
export type GovernanceAction = "create" | "yes" | "no" | "veto" | "enforce";

export const TREASURY_TOKEN_OPTIONS = [
  { label: "DegenStrategy (DEGEN)", value: GOVERNANCE_ADDRESSES.token },
  { label: "PulseChain (PLS)", value: "0x0000000000000000000000000000000000000000" },
  { label: "PulseX (PLSX)", value: "0x95B303987A60C71504D99Aa1b13B4DA07b0790ab" },
  { label: "Incentive (INC)", value: "0x2fa878Ab3F87CC1C9737Fc071108F904c0B0C95d" },
  { label: "Other (custom address)", value: "custom" },
] as const;
