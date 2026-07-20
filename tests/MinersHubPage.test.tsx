import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { MinersHubPage } from "../src/features/MinersHubPage";
import type { WalletState } from "../src/hooks/useWallet";

const wallet = {
  address: null,
  chainId: null,
  isConnected: false,
  isWrongNetwork: false,
  connecting: false,
  error: "",
  connect: vi.fn(async () => {}),
  switchNetwork: vi.fn(async () => {}),
  getSigner: vi.fn(),
} as unknown as WalletState;

function LocationProbe() {
  const location = useLocation();
  return (
    <output data-testid="location">
      {location.pathname}
      {location.search}
    </output>
  );
}

describe("Miners hub", () => {
  it("keeps My Miners and Deploy Miners together as URL-backed tabs", async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={["/my-miners"]}>
        <Routes>
          <Route
            path="/my-miners"
            element={
              <>
                <MinersHubPage wallet={wallet} />
                <LocationProbe />
              </>
            }
          />
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.getByRole("tab", { name: "My Miners" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(
      screen.getByText("Connect your wallet to view balances"),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: "Deploy Miners" }));

    expect(screen.getByTestId("location")).toHaveTextContent(
      "/my-miners?tab=deploy",
    );
    expect(screen.getByRole("tab", { name: "Deploy Miners" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(
      screen.getByText("Stake DEGEN into a time-locked pool to earn rewards"),
    ).toBeInTheDocument();
  });
});
