import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { parseEther } from "ethers";
import { RewardsActions, parseNftFee, burnPayment } from "../src/features/nft/RewardsActions";
import { HARVEST_DESTINATIONS, BURN_DESTINATIONS } from "../src/features/nft/options";
import type { WalletState } from "../src/hooks/useWallet";

const account = "0x0000000000000000000000000000000000000001";
const mocks = vi.hoisted(() => ({ earnings: vi.fn(), harvest: vi.fn(), burn: vi.fn(), preview: vi.fn(), purchases: vi.fn(), nftBalance: vi.fn() }));
vi.mock("ethers", async original => ({
  ...await original<typeof import("ethers")>(),
  Contract: class {
    viewUserTotalEarnings = mocks.earnings;
    selfHarvest = mocks.harvest;
    burnNFT = mocks.burn;
    previewBurnReturn = mocks.preview;
    userPurchases = mocks.purchases;
    balanceOf = mocks.nftBalance;
    poolPayout = async () => ({ amount: 10000n, minServe: 31536000n });
    poolPayout2 = async () => ({ amount: 10000n, minServe: 31536000n });
    defaultDirectPayout = async () => 50n;
    getPricesInInputToken = async () => [10n ** 18n, 10n ** 18n];
    penalty = async () => 100n;
  },
}));
vi.mock("../src/lib/chain", async original => ({
  ...await original<typeof import("../src/lib/chain")>(),
  getPublicContracts: async () => ({ mint: { userPurchases: mocks.purchases, previewBurnReturn: mocks.preview } }),
}));
const signer = {
  getAddress: async () => account,
  provider: { getBalance: async () => parseEther("1"), getFeeData: async () => ({ gasPrice: 1n }) },
};
const wallet = { address: account, isConnected: true, getSigner: vi.fn(async () => signer) } as unknown as WalletState;
function mount() {
  return render(<RewardsActions wallet={wallet} balance={5n} pendingOink={parseEther("100.123456789012345678")} pendingDegen={0n} onComplete={vi.fn(async () => {})} />);
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.earnings.mockResolvedValue([parseEther("101"), 0n]);
  mocks.harvest.mockResolvedValue({ wait: async () => ({ status: 1 }) });
  Object.assign(mocks.harvest, { staticCall: vi.fn(async () => undefined), estimateGas: vi.fn(async () => 100n) });
  mocks.burn.mockResolvedValue({ wait: async () => ({ status: 1 }) });
  Object.assign(mocks.burn, { staticCall: vi.fn(async () => undefined), estimateGas: vi.fn(async () => 100n) });
  mocks.purchases.mockImplementation(async (_: string, id: number) => {
    if (id > 0) throw Object.assign(new Error("bounds"), { code: "CALL_EXCEPTION" });
    return { amount: 2n, amountPaid: parseEther("10"), tokenPaid: account };
  });
  mocks.preview.mockResolvedValue(parseEther("10"));
  mocks.nftBalance.mockResolvedValue(5n);
});
describe("NFT form safeguards", () => {
  it("fills exact pending units with Max and submits only once during rapid clicks", async () => {
    mount();
    fireEvent.click(screen.getByRole("button", { name: "Manual Harvest" }));
    fireEvent.change(screen.getByLabelText(/Amount to Harvest/), { target: { value: "1" } });
    fireEvent.click(screen.getByRole("button", { name: "Max" }));
    expect(screen.getByLabelText(/Amount to Harvest/)).toHaveValue("100.123456789012345678");
    await screen.findByText(/100.123457 OINK/);
    const submit = screen.getByRole("button", { name: "Harvest", exact: true });
    fireEvent.click(submit); fireEvent.click(submit);
    await waitFor(() => expect(mocks.harvest).toHaveBeenCalledTimes(1));
    expect(mocks.harvest).toHaveBeenCalledWith(parseEther("100.123456789012345678"), HARVEST_DESTINATIONS.OINK[0].address, true);
    expect(mocks.harvest.staticCall).toHaveBeenCalledTimes(1);
  });
  it("rejects stale displayed rewards before requesting a transaction", async () => {
    mocks.earnings.mockResolvedValue([parseEther("1"), 0n]);
    mount();
    fireEvent.click(screen.getByRole("button", { name: "Manual Harvest" }));
    await screen.findByText(/100.123457 OINK/);
    fireEvent.click(screen.getByRole("button", { name: "Harvest", exact: true }));
    await screen.findByText("Pending rewards changed. Enter an amount within your current balance.");
    expect(mocks.harvest).not.toHaveBeenCalled();
  });
  it("burns only the selected purchase quantity and shows contract payout previews without acknowledgement", async () => {
    mount();
    fireEvent.click(screen.getByRole("button", { name: "Burn NFT" }));
    const submit = await screen.findByRole("button", { name: "Burn 2 NFTs" });
    await waitFor(() => expect(submit).toBeEnabled());
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
    expect(screen.queryByText("Into Wallet")).not.toBeInTheDocument();
    expect(mocks.preview).toHaveBeenCalledWith(0, 2n, false, BURN_DESTINATIONS.DEGEN[0].address, { from: account });
    fireEvent.click(submit);
    await waitFor(() => expect(mocks.burn).toHaveBeenCalledExactlyOnceWith(0, false, 2n, BURN_DESTINATIONS.DEGEN[0].address));
    expect(mocks.burn.staticCall).toHaveBeenCalledWith(0, false, 2n, BURN_DESTINATIONS.DEGEN[0].address);
  });
});

describe("verified NFT math", () => {
  it("parses decimal percentage input directly to exact basis points", () => {
    expect(parseNftFee("0.29")).toBe(29n);
    expect(parseNftFee("0.57")).toBe(57n);
    expect(parseNftFee("25")).toBe(2500n);
    expect(() => parseNftFee("25.01")).toThrow("25%");
    expect(() => parseNftFee("0.001")).toThrow();
  });
  it("matches burnNFT's division order for partial purchase records", () => {
    expect(burnPayment({ id: 0, amount: 3n, amountPaid: 11n, tokenPaid: account }, 2n)).toBe(6n);
    expect(burnPayment({ id: 0, amount: 3n, amountPaid: 11n, tokenPaid: account }, 3n)).toBe(11n);
  });
});
