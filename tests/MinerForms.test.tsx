import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MinersPage } from "../src/features/MinersPage";
import { ReferralPage } from "../src/features/ReferralPage";
import { CONTRACTS } from "../src/config/contracts";
import type { WalletState } from "../src/hooks/useWallet";
const mock = vi.hoisted(() => ({ balance: 1234567890123456789n, deposit: vi.fn(), redeem: vi.fn(), destinations: [] as string[] }));
vi.mock("../src/lib/chain", () => ({ getPublicProvider: async () => ({}), readableError: (e: Error) => e.message }));
vi.mock("ethers", async (original) => ({ ...await original<typeof import("ethers")>(), Contract: class {
  constructor(address: string) { mock.destinations.push(address); }
  balanceOf = async (account: string) => account === CONTRACTS.referralRewards ? 1000n * 10n ** 18n : mock.balance;
  allowance = async () => 10n ** 30n;
  deposit = mock.deposit;
  referralBonus = async () => 1000n;
  rewardContract = async () => CONTRACTS.referralRewards;
  helperToken = async () => "0x0000000000000000000000000000000000000010";
  governor = async () => CONTRACTS.referral;
  token = async () => CONTRACTS.degen;
  viewPoolPayout = async (into: string) => into === "0x0000000000000000000000000000000000000001" ? 0n : 10000n;
  defaultDirectPayout = async () => 100n;
  viewPoolMinServe = async () => 86400n;
  minimumGift = async () => 1n;
  totalUserRewards = async () => 100n * 10n ** 18n;
  amountRedeemed = async () => 20n * 10n ** 18n;
  redeemRewards = mock.redeem;
} }));
const wallet = { address: "0x0000000000000000000000000000000000000001", getSigner: async () => ({ getAddress: async () => "0x0000000000000000000000000000000000000001" }) } as WalletState;
beforeEach(() => {
  mock.destinations = [];
  mock.balance = 1234567890123456789n;
  mock.deposit.mockReset().mockResolvedValue({ wait: async () => ({ status: 1 }) });
  Object.assign(mock.deposit, { staticCall: vi.fn(async () => undefined) });
  mock.redeem.mockReset().mockResolvedValue({ wait: async () => ({ status: 1 }) });
  Object.assign(mock.redeem, { staticCall: vi.fn(async () => undefined) });
});
describe("miner forms", () => {
  it("Max preserves all token precision and duplicate clicks send one deposit", async () => {
    const { container } = render(<MinersPage wallet={wallet} />);
    const card = container.querySelector(".deploy-pool-card") as HTMLElement;
    await waitFor(() => expect(within(card).getByRole("button", { name: "MAX" })).toBeEnabled());
    fireEvent.click(within(card).getByRole("button", { name: "MAX" }));
    expect(within(card).getByRole("spinbutton")).toHaveValue(1.2345678901234567);
    await act(async () => {
      fireEvent.click(within(card).getByRole("button", { name: "Deploy Miner" }));
      fireEvent.click(within(card).getByRole("button", { name: "Deploy Miner" }));
    });
    await waitFor(() => expect(mock.deposit).toHaveBeenCalledTimes(1));
    expect(mock.deposit).toHaveBeenCalledWith(1234567890123456789n);
    expect(mock.deposit.staticCall).toHaveBeenCalledWith(1234567890123456789n);
  });
  it("does not use a displayed old balance to authorize a deposit", async () => {
    const { container } = render(<MinersPage wallet={wallet} />);
    const card = container.querySelector(".deploy-pool-card") as HTMLElement;
    await waitFor(() => expect(within(card).getByRole("button", { name: "MAX" })).toBeEnabled());
    fireEvent.click(within(card).getByRole("button", { name: "MAX" }));
    mock.balance = 1n;
    fireEvent.click(within(card).getByRole("button", { name: "Deploy Miner" }));
    await screen.findByText("Amount exceeds your current DEGEN balance.");
    expect(mock.deposit).not.toHaveBeenCalled();
  });
  it("reads referral points from the rewards contract and converts them to DEGEN", async () => {
    render(<ReferralPage wallet={wallet} />);
    await screen.findAllByText("8 DEGEN");
    expect(mock.destinations).toContain(CONTRACTS.referralRewards);
    fireEvent.click(screen.getByRole("button", { name: "Claim referral rewards" }));
    await waitFor(() => expect(mock.redeem).toHaveBeenCalledWith(80n * 10n ** 18n, "0xdE672FccA32365bD704c39bd1164a0D34a3a73e6"));
  });
});
