import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, useLocation } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Header } from "../src/components/Header";
import type { WalletState } from "../src/hooks/useWallet";
import { preloadPage } from "../src/lib/pageLoaders";

vi.mock("../src/lib/pageLoaders", () => ({ preloadPage: vi.fn() }));

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
  beforeEach(() => vi.clearAllMocks());

  it("uses real routes and updates the URL without a page reload", async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={["/portfolio"]}>
        <Header
          wallet={wallet}
          theme="original"
          setTheme={vi.fn()}
        />
        <LocationProbe />
      </MemoryRouter>,
    );

    const degen = screen.getByRole("link", { name: "Degen", exact: true });
    expect(degen).toHaveAttribute("href", "/farms");
    await user.click(degen);
    expect(screen.getByTestId("location")).toHaveTextContent("/farms");
    expect(screen.getByRole("button", { name: "Degen menu" })).toHaveAttribute("aria-expanded", "false");
    await user.click(screen.getByRole("button", { name: "Degen menu" }));
    expect(screen.getByRole("link", { name: "Farms" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "NFTs" })).toHaveAttribute(
      "href",
      "/nft",
    );
    expect(screen.getByRole("link", { name: "Miners" })).toHaveAttribute(
      "href",
      "/my-miners",
    );
    expect(screen.getByRole("link", { name: "Governance" })).toHaveAttribute(
      "href",
      "/governance",
    );

    await user.click(screen.getByRole("link", { name: "NFTs" }));

    expect(screen.getByTestId("location")).toHaveTextContent("/nft");
    expect(screen.getByRole("button", { name: "Degen menu" })).toHaveAttribute("aria-expanded", "false");
    await user.click(screen.getByRole("button", { name: "Degen menu" }));
    expect(screen.getByRole("link", { name: "NFTs" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "Farms" })).not.toHaveAttribute("aria-current");
  });

  it("groups the DEGEN brand, routes and wallet controls in the centered header", async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={["/my-miners?tab=deploy"]}>
        <Header wallet={wallet} theme="midnight" setTheme={vi.fn()} />
      </MemoryRouter>,
    );
    const header = screen.getByRole("banner");
    expect(header.firstElementChild).toHaveClass("site-header-inner");
    expect(header.firstElementChild?.children).toHaveLength(3);
    expect(within(header).queryByRole("img", { name: "DEGEN" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Degen menu" }));
    expect(within(header).getByRole("link", { name: "Miners" })).toHaveAttribute("aria-current", "page");
    expect(within(screen.getByRole("navigation", { name: "Primary navigation" })).getAllByRole("link")).toHaveLength(11);
    const socialLinks = within(header).getAllByRole("link").filter(link => link.classList.contains("nav-icon"));
    expect(socialLinks).toHaveLength(0);
    expect(within(header).getByRole("link", { name: "DEGEN home" })).toHaveAttribute("href", "/");
    expect(within(header).getByText("DEGEN")).toBeInTheDocument();
  });

  it("opens Overview and Portfolio as distinct tabs and returns home through the brand", async () => {
    const user = userEvent.setup();
    render(<MemoryRouter initialEntries={["/"]}><Header wallet={wallet} theme="ocean" setTheme={vi.fn()} /><LocationProbe /></MemoryRouter>);
    const navigation = screen.getByRole("navigation", { name: "Primary navigation" });
    const overview = within(navigation).getByRole("link", { name: "Overview" });
    const portfolio = within(navigation).getByRole("link", { name: "Portfolio" });
    expect(overview).toHaveAttribute("href", "/");
    expect(overview).toHaveAttribute("aria-current", "page");
    expect(portfolio).toHaveAttribute("href", "/portfolio");
    expect(within(navigation).getAllByRole("link").filter(link => link.getAttribute("aria-current") === "page")).toEqual([overview]);
    await user.click(portfolio);
    expect(screen.getByTestId("location")).toHaveTextContent("/portfolio");
    expect(portfolio).toHaveAttribute("aria-current", "page");
    expect(overview).not.toHaveClass("active");
    expect(preloadPage).toHaveBeenCalledWith("/portfolio");
    await user.click(screen.getByRole("link", { name: "DEGEN home" }));
    expect(screen.getByTestId("location")).toHaveTextContent(/^\/$/);
    expect(overview).toHaveAttribute("aria-current", "page");
    expect(wallet.connect).not.toHaveBeenCalled();
  });

  it("preloads a route on hover and keyboard focus without navigating", async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={["/nft"]}>
        <Header wallet={wallet} theme="midnight" setTheme={vi.fn()} />
        <LocationProbe />
      </MemoryRouter>,
    );
    await user.click(screen.getByRole("button", { name: "Degen menu" }));
    await user.hover(screen.getByRole("link", { name: "Farms" }));
    expect(preloadPage).toHaveBeenCalledWith("/farms");
    screen.getByRole("link", { name: "Miners" }).focus();
    expect(preloadPage).toHaveBeenCalledWith("/my-miners");
    expect(screen.getByTestId("location")).toHaveTextContent("/nft");
  });

  it.each([
    ["How it works", "/how-it-works"],
    ["Docs", "/protocol"],
  ])("opens %s as its own navigation tab", async (name, path) => {
    const user = userEvent.setup();
    render(<MemoryRouter initialEntries={["/"]}><Header wallet={wallet} theme="ocean" setTheme={vi.fn()} /><LocationProbe /></MemoryRouter>);
    const link = screen.getByRole("link", { name, exact: true });
    await user.hover(link);
    expect(preloadPage).toHaveBeenCalledWith(path);
    await user.click(link);
    expect(screen.getByTestId("location")).toHaveTextContent(path);
    expect(link).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("button", { name: "Degen menu" }).parentElement).not.toHaveClass("active");
    expect(wallet.connect).not.toHaveBeenCalled();
    expect(wallet.getSigner).not.toHaveBeenCalled();
  });

  it("keeps wallet connection and the theme picker independent", async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter><Header wallet={wallet} theme="midnight" setTheme={vi.fn()} /></MemoryRouter>,
    );
    await user.click(screen.getByRole("button", { name: /Theme/ }));
    expect(screen.getByRole("dialog", { name: "Theme picker" })).toBeInTheDocument();
    expect(wallet.connect).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Close theme picker" }));
    expect(screen.queryByRole("dialog", { name: "Theme picker" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Connect Wallet" }));
    expect(wallet.connect).toHaveBeenCalledOnce();
    expect(wallet.getSigner).not.toHaveBeenCalled();
  });

  it("opens with the keyboard, closes with Escape or outside clicks, and routes Sale correctly", async () => {
    const user = userEvent.setup();
    render(<MemoryRouter initialEntries={["/portfolio"]}><Header wallet={wallet} theme="ocean" setTheme={vi.fn()} /><LocationProbe /></MemoryRouter>);
    const button = screen.getByRole("button", { name: "Degen menu" });
    expect(screen.queryByRole("link", { name: "Sale" })).not.toBeInTheDocument();
    button.focus();
    await user.keyboard("{Enter}");
    expect(button).toHaveAttribute("aria-expanded", "true");
    await user.tab();
    expect(screen.getByRole("link", { name: "Miners" })).toHaveFocus();
    await user.keyboard("{Escape}");
    expect(button).toHaveFocus();
    expect(button).toHaveAttribute("aria-expanded", "false");
    await user.click(button);
    await user.click(screen.getByRole("link", { name: "DEGEN home" }));
    expect(button).toHaveAttribute("aria-expanded", "false");
    await user.click(button);
    expect(screen.getByRole("link", { name: "Referral" })).toHaveAttribute("href", "/my-miners?tab=referral");
    await user.click(screen.getByRole("link", { name: "Sale" }));
    expect(button).toHaveAttribute("aria-expanded", "false");
    await user.click(button);
    expect(screen.getByRole("link", { name: "Sale" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "Miners" })).not.toHaveAttribute("aria-current");
    expect(wallet.connect).not.toHaveBeenCalled();
  });

  it("keeps connecting disabled and displays the shortened connected address", () => {
    const { rerender } = render(
      <MemoryRouter><Header wallet={{ ...wallet, connecting: true }} theme="midnight" setTheme={vi.fn()} /></MemoryRouter>,
    );
    expect(screen.getByRole("button", { name: "Connecting..." })).toBeDisabled();
    rerender(
      <MemoryRouter><Header wallet={{ ...wallet, address: "0x1234567890123456789012345678901234567890", isConnected: true }} theme="midnight" setTheme={vi.fn()} /></MemoryRouter>,
    );
    expect(screen.getByRole("button", { name: "0x1234…7890" })).toBeEnabled();
  });

  it("preserves the switch-network action", async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter><Header wallet={{ ...wallet, isWrongNetwork: true }} theme="midnight" setTheme={vi.fn()} /></MemoryRouter>,
    );
    await user.click(screen.getByRole("button", { name: "Switch Network" }));
    expect(wallet.switchNetwork).toHaveBeenCalledOnce();
    expect(wallet.connect).not.toHaveBeenCalled();
    expect(wallet.getSigner).not.toHaveBeenCalled();
  });
});
