import { parseEther } from "ethers";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { RewardsActions } from "../src/features/nft/RewardsActions";
import type { WalletState } from "../src/hooks/useWallet";

const wallet = {
  address: "0x0000000000000000000000000000000000000001",
  chainId: 369n,
  isConnected: true,
  isWrongNetwork: false,
  connecting: false,
  error: "",
  connect: vi.fn(async () => {}),
  switchNetwork: vi.fn(async () => {}),
  getSigner: vi.fn(),
} as unknown as WalletState;

describe("RewardsActions", () => {
  it("switches from OINK to DEGEN without retaining an invalid destination", async () => {
    const user = userEvent.setup();
    render(
      <RewardsActions
        wallet={wallet}
        balance={1n}
        pendingOink={parseEther("3419.561148")}
        pendingDegen={parseEther("101043210.89142")}
        onComplete={vi.fn(async () => {})}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Manual Harvest" }));
    expect(
      screen.getByRole("dialog", { name: "Manual Harvest" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText("5 Year OINK Pool (default)"),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "DEGEN" }));

    expect(
      screen.getByRole("dialog", { name: "Manual Harvest" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText("10 Year DEGEN Pool (default)"),
    ).toBeInTheDocument();
    expect(
      screen.queryByText("5 Year OINK Pool (default)"),
    ).not.toBeInTheDocument();
  });
});
