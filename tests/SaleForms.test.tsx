import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SalePage } from "../src/features/SalePage";
import { CONTRACTS, SALE_ABI } from "../src/config/contracts";
import { Interface } from "ethers";
import type { WalletState } from "../src/hooks/useWallet";
const mocks = vi.hoisted(() => ({ buy: vi.fn(), claim: vi.fn(), approve: vi.fn(), saleToken: "", pending: 1234567890123456789n, available: 10000n * 10n ** 18n, secondaryFailure: false, quote: vi.fn(async (amount: bigint) => amount * 100n) }));
const provider = { getBalance: async () => 10n * 10n ** 18n, getFeeData: async () => ({ gasPrice: 10n ** 9n, maxFeePerGas: null }) };
vi.mock("../src/lib/chain", () => ({ getPublicProvider: async () => ({ getBalance: async () => 10n * 10n ** 18n, getFeeData: async () => ({ gasPrice: 10n ** 9n }) }), readableError: (error: Error) => error.message }));
vi.mock("ethers", async (original) => ({ ...await original<typeof import("ethers")>(), Contract: class {
  constructor(private address: string) {}
  // The deployed sale prices through OINK but sells TOKEN_X (DEGEN).
  DTX = async () => CONTRACTS.oink;
  TOKEN_X = async () => mocks.saleToken;
  PLSX = async () => "0x0000000000000000000000000000000000000002";
  INC = async () => { if (mocks.secondaryFailure) throw new Error("INC temporarily unavailable"); return "0x0000000000000000000000000000000000000003"; };
  balanceOf = async (owner: string) => owner === CONTRACTS.sale ? mocks.available : 10n * 10n ** 18n;
  decimals = async () => 18n;
  userTokens = async () => mocks.pending;
  getWithPLS = mocks.quote;
  getWithPLSX = mocks.quote;
  getWithINC = mocks.quote;
  buyWithPLS = mocks.buy;
  approve = mocks.approve;
  claimTokens = mocks.claim;
} }));
const wallet = { address: "0x0000000000000000000000000000000000000001", getSigner: async () => ({ provider, getAddress: async () => "0x0000000000000000000000000000000000000001" }) } as WalletState;
beforeEach(() => {
  mocks.secondaryFailure = false;
  mocks.saleToken = CONTRACTS.degen;
  mocks.pending = 1234567890123456789n; mocks.available = 10000n * 10n ** 18n;
  mocks.buy.mockReset().mockResolvedValue({ wait: async () => ({ status: 1 }) });
  Object.assign(mocks.buy, { staticCall: vi.fn(async () => undefined), estimateGas: vi.fn(async () => 100000n) });
  mocks.claim.mockReset().mockResolvedValue({ wait: async () => ({ status: 1 }) });
  Object.assign(mocks.claim, { staticCall: vi.fn(async () => undefined) });
  mocks.approve.mockReset();
});
describe("sale forms", () => {
  it("uses the sold-token getter from the deployed sale ABI", () => {
    const sale = new Interface(SALE_ABI);
    expect(sale.getFunction("TOKEN_X()")?.outputs.map(output => output.type)).toEqual(["address"]);
    expect(sale.getFunction("DTX()")?.outputs.map(output => output.type)).toEqual(["address"]);
  });

  it("buys DEGEN through the OINK-priced sale with exact native payment and prevents duplicate submission", async () => {
    const amount = 1234567890123456789n;
    const pool = "0xdE672FccA32365bD704c39bd1164a0D34a3a73e6";
    render(<SalePage wallet={wallet} />);
    await waitFor(() => expect(screen.getByRole("button", { name: "Max" })).toBeEnabled());
    fireEvent.change(screen.getByRole("spinbutton"), { target: { value: "1.234567890123456789" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Get DEGEN!" }));
      fireEvent.click(screen.getByRole("button", { name: "Get DEGEN!" }));
    });
    await screen.findByText("Miner purchased.");
    expect(mocks.buy.staticCall).toHaveBeenCalledExactlyOnceWith(amount, pool, { value: amount });
    expect(mocks.buy.estimateGas).toHaveBeenCalledExactlyOnceWith(amount, pool, { value: amount });
    expect(mocks.buy).toHaveBeenCalledExactlyOnceWith(amount, pool, { value: amount });
    expect(mocks.approve).not.toHaveBeenCalled();
    expect(screen.queryByText("Sale token changed. This purchase is unavailable.")).not.toBeInTheDocument();
  });

  it("still rejects a different sold token before simulation or payment", async () => {
    mocks.saleToken = CONTRACTS.oink;
    render(<SalePage wallet={wallet} />);
    await waitFor(() => expect(screen.getByRole("button", { name: "Max" })).toBeEnabled());
    fireEvent.change(screen.getByRole("spinbutton"), { target: { value: "1" } });
    fireEvent.click(screen.getByRole("button", { name: "Get DEGEN!" }));
    await screen.findByText("Sale token changed. This purchase is unavailable.");
    expect(mocks.buy.staticCall).not.toHaveBeenCalled();
    expect(mocks.buy.estimateGas).not.toHaveBeenCalled();
    expect(mocks.buy).not.toHaveBeenCalled();
    expect(mocks.approve).not.toHaveBeenCalled();
  });

  it("loads essential claim allocations when a secondary payment token fails", async () => {
    mocks.secondaryFailure = true;
    render(<SalePage wallet={wallet} />);
    await waitFor(() => expect(screen.getByRole("button", { name: "Max" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: /Claim Rewards/ }));
    expect(screen.getByRole("button", { name: "Claim Tokens" })).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: "Claim Tokens" }));
    await waitFor(() => expect(mocks.claim).toHaveBeenCalledTimes(1));
  });
  it("Max reserves native currency for fees and checks current inventory before purchase", async () => {
    render(<SalePage wallet={wallet} />);
    await waitFor(() => expect(screen.getByRole("button", { name: "Max" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "Max" }));
    expect(screen.getByRole("spinbutton")).toHaveValue(9.998);
    mocks.available = 1n;
    fireEvent.click(screen.getByRole("button", { name: "Get DEGEN!" }));
    await screen.findByText("The sale cannot fill this amount. Choose a smaller amount.");
    expect(mocks.buy).not.toHaveBeenCalled();
  });
  it("claims the exact allocation without adding an unsupported bonus or rounding Max", async () => {
    render(<SalePage wallet={wallet} />);
    await waitFor(() => expect(screen.getByRole("button", { name: "Max" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: /Claim Rewards/ }));
    fireEvent.click(screen.getByRole("button", { name: "Max" }));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Claim Tokens" }));
      fireEvent.click(screen.getByRole("button", { name: "Claim Tokens" }));
    });
    expect(mocks.claim).toHaveBeenCalledTimes(1);
    expect(mocks.claim).toHaveBeenCalledWith(1234567890123456789n, "0xdE672FccA32365bD704c39bd1164a0D34a3a73e6");
    expect(mocks.claim.staticCall).toHaveBeenCalledWith(1234567890123456789n, "0xdE672FccA32365bD704c39bd1164a0D34a3a73e6");
  });
});
