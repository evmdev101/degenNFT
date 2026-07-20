import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, useLocation } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { Header } from "../src/components/Header";
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
  return <output data-testid="location">{location.pathname}</output>;
}

describe("Header navigation", () => {
  it("uses real routes and updates the URL without a page reload", async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={["/farms"]}>
        <Header
          wallet={wallet}
          theme="original"
          setTheme={vi.fn()}
        />
        <LocationProbe />
      </MemoryRouter>,
    );

    expect(screen.getByRole("link", { name: "Farms" })).toHaveClass("active");
    expect(screen.getByRole("link", { name: "NFT" })).toHaveAttribute(
      "href",
      "/nft",
    );
    expect(
      screen.queryByRole("link", { name: "Miners" }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "My Miners" })).toHaveAttribute(
      "href",
      "/my-miners",
    );

    await user.click(screen.getByRole("link", { name: "NFT" }));

    expect(screen.getByTestId("location")).toHaveTextContent("/nft");
    expect(screen.getByRole("link", { name: "NFT" })).toHaveClass("active");
    expect(screen.getByRole("link", { name: "Farms" })).not.toHaveClass(
      "active",
    );
  });
});
