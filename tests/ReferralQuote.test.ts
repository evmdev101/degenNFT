import { beforeEach, describe, expect, it, vi } from "vitest";
import { quoteReferralDestination, readReferralContext, referralPayout } from "../src/features/referralQuote";
import { CONTRACTS } from "../src/config/contracts";
const state = vi.hoisted(() => ({ rate: 2500n, funding: 100n, minimum: 1n, bonus: 3333n }));
vi.mock("ethers", async original => ({ ...await original<typeof import("ethers")>(), Contract: class {
  referralBonus = async () => state.bonus;
  rewardContract = async () => CONTRACTS.referralRewards;
  helperToken = async () => "0x0000000000000000000000000000000000000010";
  governor = async () => CONTRACTS.referral;
  token = async () => CONTRACTS.degen;
  totalUserRewards = async () => 10001n;
  amountRedeemed = async () => 1n;
  balanceOf = async () => state.funding;
  viewPoolPayout = async () => state.rate;
  defaultDirectPayout = async () => 100n;
  viewPoolMinServe = async () => 604800n;
  minimumGift = async () => state.minimum;
} }));
beforeEach(() => { state.rate = 2500n; state.funding = 10000n; state.minimum = 1n; state.bonus = 3333n; });
describe("verified referral payout ordering", () => {
  it("floors the point conversion before applying destination payout", () => {
    expect(referralPayout(3n, 5000n, 7500n)).toBe(0n);
    expect(referralPayout(10000n, 3333n, 2500n)).toBe(833n);
  });
  it("reads helper rates, minimum gift and mandatory service", async () => {
    const context = await readReferralContext({}, "0x0000000000000000000000000000000000000001");
    const quote = await quoteReferralDestination(context, "0x0000000000000000000000000000000000000002", false);
    expect(quote.points).toBe(10000n); expect(quote.payout).toBe(833n);
    expect(quote.minimum).toBe(1n); expect(quote.minServe).toBe(604800n); expect(quote.funded).toBe(true);
    state.rate = 5000n;
    const changed = await quoteReferralDestination(context, "0x0000000000000000000000000000000000000002", false);
    expect(changed.fingerprint).not.toBe(quote.fingerprint);
  });
  it("blocks zero-rate named pools while allowing explicit wallet payouts", async () => {
    state.rate = 0n;
    const context = await readReferralContext({}, "0x0000000000000000000000000000000000000001");
    await expect(quoteReferralDestination(context, "0x0000000000000000000000000000000000000002", false)).rejects.toThrow("pool is unavailable");
    const wallet = await quoteReferralDestination(context, "0x0000000000000000000000000000000000000001", true);
    expect(wallet.payout).toBe(33n); expect(wallet.minServe).toBe(0n);
  });
});
