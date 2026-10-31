import { fireEvent, render, screen, within, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FarmsPage } from "../src/features/FarmsPage";
import type { WalletState } from "../src/hooks/useWallet";

const mocks = vi.hoisted(() => ({
  vault: "0x61b374fd8fa06767927bfb11b947d165c06a8c5e",
  lp: "0xef9ea3d72e28c7140481209190601c085027d6fe",
  secondVault: "0xBCb904a9422F223f5A79660f026310D4bd8C9941",
  helper: "0xe1cAF2F0da06A97A7f04B9Ea1B43C91F447cf343",
  extraStakes: new Map<string, { amount: bigint; debt: bigint; feesPaid: bigint; lastAction: bigint }[]>(),
  extraRewards: new Map<string, bigint>(), helperRaw: 0n, failVault: "", quotedOverride: null as bigint | null,
  stakes: [] as { amount: bigint; debt: bigint; feesPaid: bigint; lastAction: bigint }[],
  withdraw: vi.fn(), deposit: vi.fn(), claimWithHarvest: vi.fn(), claimRewards: vi.fn(),
  walletRaw: 10n ** 19n, decimals: 18, rewardRaw: 0n, payoutBps: 10000n, fundingRate: 0n,
}));


vi.mock("../src/features/farmClaimQuote", () => ({
  quoteFarmClaim: vi.fn(async () => mocks.quotedOverride ?? mocks.helperRaw + mocks.rewardRaw + [...mocks.extraRewards.values()].reduce((sum, amount) => sum + amount, 0n)),
}));

vi.mock("../src/lib/chain", () => ({
  shortAddress: (address: string) => address.slice(0, 8),
  getPublicProvider: async () => ({ getBlock: async () => ({ number: 123, timestamp: Math.floor(Date.now() / 1000) }), getBlockNumber: async () => 123 }), pulsechainRpcCall: async () => "0x0",
}));
vi.mock("ethers", async (importOriginal) => ({
  ...await importOriginal<typeof import("ethers")>(),
  Contract: class {
    constructor(private address: string) {}
    poolLength = async () => 0n;
    getNrOfStakes = async () => {
      if (this.address.toLowerCase() === mocks.failVault.toLowerCase()) throw new Error("Farm read unavailable");
      return this.address.toLowerCase() === mocks.vault ? BigInt(mocks.stakes.length) : BigInt(mocks.extraStakes.get(this.address.toLowerCase())?.length ?? 0);
    };
    userInfo = async (_: string, id: bigint) => (this.address.toLowerCase() === mocks.vault ? mocks.stakes : mocks.extraStakes.get(this.address.toLowerCase()) ?? [])[Number(id)];
    viewUserTotalEarnings = async () => {
      if (this.address.toLowerCase() === mocks.failVault.toLowerCase()) throw new Error("Farm read unavailable");
      return this.address.toLowerCase() === mocks.vault ? mocks.rewardRaw : mocks.extraRewards.get(this.address.toLowerCase()) ?? 0n;
    };
    viewStakeEarnings = async () => this.address.toLowerCase() === mocks.vault ? mocks.rewardRaw / BigInt(mocks.stakes.length || 1) : (mocks.extraRewards.get(this.address.toLowerCase()) ?? 0n) / BigInt(mocks.extraStakes.get(this.address.toLowerCase())?.length || 1);
    balanceOf = async () => this.address.toLowerCase() === mocks.lp ? mocks.walletRaw : this.address.toLowerCase() === mocks.helper.toLowerCase() ? mocks.helperRaw : 0n;
    totalSupply = async () => 10n ** 20n;
    allowance = async () => 10n ** 30n;
    decimals = async () => mocks.decimals;
    stakeToken = async () => mocks.lp;
    depositFee = async () => 0n;
    fundingRate = async () => mocks.fundingRate;
    withdraw = mocks.withdraw;
    deposit = mocks.deposit;
    claimWithHarvest = mocks.claimWithHarvest;
    claimRewards = mocks.claimRewards;
    defaultDirectPayout = async () => 50n;
    viewPoolPayout = async () => mocks.payoutBps;
    viewPoolMinServe = async () => 0n;
    minimumGift = async () => 0n;
  },
}));

function setup() {
  const wallet = {
    address: "0x0000000000000000000000000000000000000001", isConnected: true,
    chainId: 369n, isWrongNetwork: false, connecting: false, error: "",
    connect: vi.fn(), switchNetwork: vi.fn(), getSigner: vi.fn(async () => ({ getAddress: async () => "0x0000000000000000000000000000000000000001" })),
  } as unknown as WalletState;
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return render(<QueryClientProvider client={client}><FarmsPage wallet={wallet} /></QueryClientProvider>);
}

async function readyClaimAll() {
  const button = screen.getByRole("button", { name: "Claim All Rewards" });
  await waitFor(() => expect(button).toBeEnabled());
  return button;
}

beforeEach(() => {
  mocks.extraStakes.clear(); mocks.extraRewards.clear(); mocks.helperRaw = 0n; mocks.failVault = ""; mocks.quotedOverride = null;
  mocks.claimRewards.mockReset().mockResolvedValue({ wait: async () => ({ status: 1 }) });
  Object.assign(mocks.claimRewards, { staticCall: vi.fn(async () => undefined) });
  mocks.walletRaw = 10n ** 19n; mocks.decimals = 18; mocks.rewardRaw = 0n; mocks.payoutBps = 10000n; mocks.fundingRate = 0n;
  mocks.claimWithHarvest.mockReset().mockResolvedValue({ wait: async () => ({ status: 1 }) });
  Object.assign(mocks.claimWithHarvest, { staticCall: vi.fn(async () => undefined) });
  mocks.stakes = [
    { amount: 10n ** 18n, debt: 0n, feesPaid: 0n, lastAction: 100n },
    { amount: 2n * 10n ** 18n, debt: 0n, feesPaid: 0n, lastAction: 200n },
  ];
  mocks.withdraw.mockReset().mockImplementation(async (id: bigint) => ({ wait: async () => { mocks.stakes.splice(Number(id), 1); return { status: 1 }; } }));
  mocks.deposit.mockReset().mockImplementation(async (amount: bigint) => ({ wait: async () => { mocks.stakes.push({ amount, debt: 0n, feesPaid: 0n, lastAction: 300n }); return { status: 1 }; } }));
  Object.assign(mocks.withdraw, { staticCall: vi.fn(async () => undefined) });
  Object.assign(mocks.deposit, { staticCall: vi.fn(async () => undefined) });
  vi.stubGlobal("fetch", vi.fn(async (url: string) => ({
    ok: true,
    json: async () => url.includes("vaultData.json")
      ? [{ vaultContract: mocks.vault, tokenContract: mocks.lp, decimals: mocks.decimals, isLP: false }]
      : url.includes("vaultDataOutput") ? { vaultDetails: [] } : [{ priceUsd: "1" }],
  })));
});
afterEach(() => vi.unstubAllGlobals());

describe("farm position management", () => {
  it("counts zero-reward stakes, withdraws only the chosen stake, and reloads IDs", async () => {
    const { container } = setup();
    await screen.findByText("1 farm · 2 stakes");
    const card = container.querySelector("#farm-card-degen-15") as HTMLElement;
    fireEvent.click(within(card).getByRole("button", { name: "Your Stakes (2)" }));
    expect(within(card).getByText("1 LP")).toBeInTheDocument();
    expect(within(card).getByText("2 LP")).toBeInTheDocument();
    fireEvent.click(within(card).getByRole("button", { name: "Withdraw This Stake #0" }));
    await screen.findByText("1 farm · 1 stake");
    expect(mocks.withdraw).toHaveBeenCalledExactlyOnceWith(0n);
    expect(within(card).getByText("2 LP")).toBeInTheDocument();
    expect(within(card).queryByText("Stake #1")).not.toBeInTheDocument();
    expect(within(card).getByRole("button", { name: "Withdraw This Stake #0" })).toBeEnabled();
  });

  it("creates another stake without merging it into an existing one", async () => {
    const { container } = setup();
    await screen.findByText("1 farm · 2 stakes");
    const card = container.querySelector("#farm-card-degen-15") as HTMLElement;
    fireEvent.change(within(card).getByRole("spinbutton"), { target: { value: "3" } });
    fireEvent.click(within(card).getByRole("button", { name: "Create New Stake" }));
    await screen.findByText("1 farm · 3 stakes");
    expect(mocks.deposit).toHaveBeenCalledExactlyOnceWith(3n * 10n ** 18n, "0x0000000000000000000000000000000000000000");
    expect(within(card).getByText("Stake #2")).toBeInTheDocument();
    expect(within(card).getByText("3 LP")).toBeInTheDocument();
    expect(within(card).getByRole("spinbutton")).toHaveValue(null);
  });

  it("exposes the same individual stake actions in table view", async () => {
    setup();
    await screen.findByText("1 farm · 2 stakes");
    fireEvent.click(screen.getByRole("button", { name: "Table view" }));
    fireEvent.click(screen.getByRole("button", { name: "Your Stakes (2)" }));
    expect(screen.getByRole("button", { name: "Withdraw This Stake #1" })).toBeInTheDocument();
    expect(screen.getByRole("table")).toContainElement(screen.getByText("Stake #1"));
  });
  it("rechecks the live balance and refuses a deposit authorized only by the cached snapshot", async () => {
    const { container } = setup();
    await screen.findByText("1 farm · 2 stakes");
    const card = container.querySelector("#farm-card-degen-15") as HTMLElement;
    mocks.walletRaw = 0n;
    fireEvent.change(within(card).getByRole("spinbutton"), { target: { value: "3" } });
    fireEvent.click(within(card).getByRole("button", { name: "Create New Stake" }));
    await screen.findByText(/Amount exceeds your current LP balance/);
    expect(mocks.deposit).not.toHaveBeenCalled();
  });

  it("uses token precision for Max and prevents simultaneous duplicate deposits", async () => {
    mocks.decimals = 6; mocks.walletRaw = 1234567n;
    const { container } = setup();
    await screen.findByText("1 farm · 2 stakes");
    const card = container.querySelector("#farm-card-degen-15") as HTMLElement;
    fireEvent.click(within(card).getByRole("button", { name: "MAX" }));
    expect(within(card).getByRole("spinbutton")).toHaveValue(1.234567);
    const button = within(card).getByRole("button", { name: "Create New Stake" });
    fireEvent.click(button); fireEvent.click(button);
    await screen.findByText("1 farm · 3 stakes");
    expect(mocks.deposit).toHaveBeenCalledExactlyOnceWith(1234567n, "0x0000000000000000000000000000000000000000");
  });

  it("uses current claim terms, exact amounts and current stake IDs", async () => {
    mocks.rewardRaw = 2n * 10n ** 18n;
    const { container } = setup();
    await screen.findByText("1 farm · 2 stakes");
    const card = container.querySelector("#farm-card-degen-15") as HTMLElement;
    expect(screen.getByRole("button", { name: /Claim All/i })).toBeInTheDocument();
    fireEvent.click(within(card).getByRole("button", { name: /Claim .* DEGEN/ }));
    const dialog = await screen.findByRole("dialog", { name: "Harvest Rewards" });
    const amount = within(dialog).getByRole("textbox");
    fireEvent.change(amount, { target: { value: "0" } });
    expect(within(dialog).getByRole("button", { name: "Confirm Claim" })).toBeDisabled();
    fireEvent.change(amount, { target: { value: "1.234567890123456789" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Confirm Claim" }));
    await screen.findByText("Claim confirmed.");
    expect(mocks.claimWithHarvest).toHaveBeenCalledExactlyOnceWith(
      [expect.stringMatching(new RegExp(mocks.vault, "i"))], "0x0000000000000000000000000000000000000001", [[0n, 1n]],
      1234567890123456789n, "0xdE672FccA32365bD704c39bd1164a0D34a3a73e6",
    );
  });

  it("refuses changed payout terms before sending a claim", async () => {
    mocks.rewardRaw = 2n * 10n ** 18n;
    const { container } = setup();
    await screen.findByText("1 farm · 2 stakes");
    const card = container.querySelector("#farm-card-degen-15") as HTMLElement;
    fireEvent.click(within(card).getByRole("button", { name: /Claim .* DEGEN/ }));
    const dialog = await screen.findByRole("dialog", { name: "Harvest Rewards" });
    mocks.payoutBps = 5000n;
    fireEvent.click(within(dialog).getByRole("button", { name: "Confirm Claim" }));
    await screen.findByText(/Claim terms changed/);
    expect(mocks.claimWithHarvest).not.toHaveBeenCalled();
  });

  it("claims the combined total from every farm plus helper once, independently of filters", async () => {
    mocks.rewardRaw = 2n * 10n ** 18n;
    mocks.helperRaw = 24900136055361391n;
    mocks.extraStakes.set(mocks.secondVault.toLowerCase(), [{ amount: 3n * 10n ** 18n, debt: 0n, feesPaid: 0n, lastAction: 300n }]);
    mocks.extraRewards.set(mocks.secondVault.toLowerCase(), 5n * 10n ** 18n);
    setup();
    await screen.findByText("2 farms · 3 stakes");
    const filter = screen.getByRole("button", { name: "Staked", exact: true });
    fireEvent.click(filter);
    expect(screen.queryByRole("button", { name: /Claim unstaked/i })).not.toBeInTheDocument();
    const claimAll = await readyClaimAll();
    fireEvent.click(claimAll); fireEvent.click(claimAll);
    const dialog = await screen.findByRole("dialog", { name: "Harvest Rewards" });
    expect(within(dialog).getByRole("textbox")).toHaveValue("7.024900136055361391");
    expect(mocks.claimWithHarvest).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole("button", { name: "Confirm Claim" }));
    await waitFor(() => expect(mocks.claimWithHarvest).toHaveBeenCalledTimes(1));
    expect(mocks.claimWithHarvest).toHaveBeenCalledExactlyOnceWith(
      [expect.stringMatching(new RegExp(mocks.vault, "i")), expect.stringMatching(new RegExp(mocks.secondVault, "i"))],
      "0x0000000000000000000000000000000000000001", [[0n, 1n], [0n]],
      7024900136055361391n, "0xdE672FccA32365bD704c39bd1164a0D34a3a73e6",
    );
  });

  it("rereads current stake IDs for Claim All rather than replaying a cached position list", async () => {
    mocks.rewardRaw = 2n * 10n ** 18n;
    setup();
    await screen.findByText("1 farm · 2 stakes");
    fireEvent.click(await readyClaimAll());
    const dialog = await screen.findByRole("dialog", { name: "Harvest Rewards" });
    mocks.stakes.splice(1, 1);
    fireEvent.click(within(dialog).getByRole("button", { name: "Confirm Claim" }));
    await waitFor(() => expect(mocks.claimWithHarvest).toHaveBeenCalledTimes(1));
    expect(mocks.claimWithHarvest).toHaveBeenCalledWith(
      [expect.stringMatching(new RegExp(mocks.vault, "i"))], expect.any(String), [[0n]],
      2n * 10n ** 18n, expect.any(String),
    );
  });

  it("never silently opens a partial Claim All when one farm cannot be read", async () => {
    mocks.rewardRaw = 2n * 10n ** 18n;
    setup();
    await screen.findByText("1 farm · 2 stakes");
    mocks.failVault = mocks.secondVault;
    fireEvent.click(await readyClaimAll());
    await waitFor(() => expect(screen.getByRole("button", { name: "Claim All Rewards" })).toBeEnabled());
    expect(screen.queryByRole("dialog", { name: "Harvest Rewards" })).not.toBeInTheDocument();
    expect(mocks.claimWithHarvest).not.toHaveBeenCalled();
    expect(mocks.claimRewards).not.toHaveBeenCalled();
  });

  it("refuses to send Claim All if the available total becomes zero before confirmation", async () => {
    mocks.rewardRaw = 2n * 10n ** 18n;
    setup();
    await screen.findByText("1 farm · 2 stakes");
    fireEvent.click(await readyClaimAll());
    const dialog = await screen.findByRole("dialog", { name: "Harvest Rewards" });
    mocks.rewardRaw = 0n;
    fireEvent.click(within(dialog).getByRole("button", { name: "Confirm Claim" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Claim All Rewards" })).toBeEnabled());
    expect(mocks.claimWithHarvest).not.toHaveBeenCalled();
    expect(mocks.claimRewards).not.toHaveBeenCalled();
  });

  it("uses the same Claim All flow when only helper rewards remain", async () => {
    mocks.stakes = [];
    mocks.helperRaw = 24900136055361391n;
    setup();
    await screen.findByText("0 farms · 0 stakes");
    expect(screen.queryByRole("button", { name: /Claim unstaked/i })).not.toBeInTheDocument();
    fireEvent.click(await readyClaimAll());
    const dialog = await screen.findByRole("dialog", { name: "Harvest Rewards" });
    expect(within(dialog).getByRole("textbox")).toHaveValue("0.024900136055361391");
    fireEvent.click(within(dialog).getByRole("button", { name: "Confirm Claim" }));
    await waitFor(() => expect(mocks.claimRewards.mock.calls.length + mocks.claimWithHarvest.mock.calls.length).toBe(1));
  });

  it("uses the actual harvest quote rather than a larger pending-view estimate", async () => {
    mocks.rewardRaw = 37233951041n * 10n ** 16n;
    mocks.helperRaw = 24900136055361391n;
    mocks.quotedOverride = 1234567890123456789n;
    setup();
    await screen.findByText("1 farm · 2 stakes");
    fireEvent.click(await readyClaimAll());
    const dialog = await screen.findByRole("dialog", { name: "Harvest Rewards" });
    expect(within(dialog).getByRole("textbox")).toHaveValue("1.234567890123456789");
    fireEvent.click(within(dialog).getByRole("button", { name: "Confirm Claim" }));
    await waitFor(() => expect(mocks.claimWithHarvest).toHaveBeenCalledTimes(1));
    expect(mocks.claimWithHarvest.mock.calls[0][3]).toBe(1234567890123456789n);
  });

  it("keeps Max as all currently claimable rewards when the fresh quote changes", async () => {
    mocks.rewardRaw = 2n * 10n ** 18n;
    setup();
    await screen.findByText("1 farm · 2 stakes");
    fireEvent.click(await readyClaimAll());
    const dialog = await screen.findByRole("dialog", { name: "Harvest Rewards" });
    mocks.rewardRaw = 1n * 10n ** 18n;
    fireEvent.click(within(dialog).getByRole("button", { name: "Confirm Claim" }));
    await waitFor(() => expect(mocks.claimWithHarvest).toHaveBeenCalledTimes(1));
    expect(mocks.claimWithHarvest.mock.calls[0][3]).toBe(1n * 10n ** 18n);
  });

  it("refuses a custom claim amount above the new nonzero harvest quote", async () => {
    mocks.rewardRaw = 2n * 10n ** 18n;
    setup();
    await screen.findByText("1 farm · 2 stakes");
    fireEvent.click(await readyClaimAll());
    const dialog = await screen.findByRole("dialog", { name: "Harvest Rewards" });
    fireEvent.change(within(dialog).getByRole("textbox"), { target: { value: "1.5" } });
    mocks.rewardRaw = 1n * 10n ** 18n;
    fireEvent.click(within(dialog).getByRole("button", { name: "Confirm Claim" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Claim All Rewards" })).toBeEnabled());
    expect(mocks.claimWithHarvest).not.toHaveBeenCalled();
  });

});
