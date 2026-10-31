import { Contract, ZeroAddress, isAddress, type ContractRunner } from "ethers";
import { CONTRACTS, ERC20_ABI, REFERRAL_ABI, REFERRAL_GOVERNANCE_ABI } from "../config/contracts";
const GOVERNANCE = [...REFERRAL_GOVERNANCE_ABI, "function helperToken() view returns(address)"];
const REWARDS = [...REFERRAL_ABI, "function governor() view returns(address)", "function token() view returns(address)"];
const HELPER = ["function viewPoolPayout(address) view returns(uint256)", "function viewPoolMinServe(address) view returns(uint256)", "function defaultDirectPayout() view returns(uint256)"];
export const referralPayout = (points: bigint, bonus: bigint, rate: bigint) => (points * bonus / 10000n) * rate / 10000n;
export type ReferralQuote = { into: string; rate: bigint; minimum: bigint; minServe: bigint; payout: bigint; points: bigint; fingerprint: string; funded: boolean };
export async function readReferralContext(runner: ContractRunner, account: string) {
  const governance = new Contract(CONTRACTS.referral, GOVERNANCE, runner);
  const [bonus, rewardAddress, helperAddress] = await Promise.all([governance.referralBonus(), governance.rewardContract(), governance.helperToken()]);
  if (String(rewardAddress).toLowerCase() !== CONTRACTS.referralRewards.toLowerCase()) throw new Error("Referral reward contract changed.");
  if (!isAddress(helperAddress) || helperAddress === ZeroAddress) throw new Error("Referral payout rules are unavailable.");
  const rewards = new Contract(rewardAddress, REWARDS, runner);
  const [governor, tokenAddress, total, claimed] = await Promise.all([rewards.governor(), rewards.token(), rewards.totalUserRewards(account), rewards.amountRedeemed(account)]);
  if (String(governor).toLowerCase() !== CONTRACTS.referral.toLowerCase() || String(tokenAddress).toLowerCase() !== CONTRACTS.degen.toLowerCase()) throw new Error("Referral dependencies changed.");
  const token = new Contract(tokenAddress, ERC20_ABI, runner);
  const funding: bigint = await token.balanceOf(rewardAddress);
  const points: bigint = BigInt(total) > BigInt(claimed) ? BigInt(total) - BigInt(claimed) : 0n;
  return { runner, account, rewards, helper: new Contract(helperAddress, HELPER, runner), helperAddress, rewardAddress, bonus: BigInt(bonus), total: BigInt(total), claimed: BigInt(claimed), points, funding };
}
export async function quoteReferralDestination(context: Awaited<ReturnType<typeof readReferralContext>>, into: string, wallet: boolean): Promise<ReferralQuote> {
  const registered: bigint = await context.helper.viewPoolPayout(into);
  if (!wallet && registered === 0n) throw new Error("This pool is unavailable for referral claims.");
  if (wallet && registered !== 0n) throw new Error("Wallet payout route is unavailable for this account.");
  const rate: bigint = wallet ? await context.helper.defaultDirectPayout() : registered;
  if (rate < 0n || rate > 10000n) throw new Error("Referral payout rate is invalid.");
  const [minimum, minServe] = wallet ? [0n, 0n] : await Promise.all([
    new Contract(into, ["function minimumGift() view returns(uint256)"], context.runner).minimumGift(),
    context.helper.viewPoolMinServe(into),
  ]);
  const payout = referralPayout(context.points, context.bonus, rate);
  const fingerprint = [context.rewardAddress, context.helperAddress, context.bonus, context.points, into, rate, minimum, minServe, payout].join(":").toLowerCase();
  return { into, rate: BigInt(rate), minimum: BigInt(minimum), minServe: BigInt(minServe), payout, points: context.points, fingerprint, funded: context.funding >= payout };
}
