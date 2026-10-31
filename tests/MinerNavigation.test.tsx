import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MinersHubPage } from "../src/features/MinersHubPage";
import { MinersPage } from "../src/features/MinersPage";
import { PageActivity } from "../src/hooks/usePageActive";
import type { WalletState } from "../src/hooks/useWallet";

const mocks = vi.hoisted(() => ({ balance: vi.fn(), signer: vi.fn(), scroll: vi.fn() }));
vi.mock("../src/lib/chain", () => ({ getPublicProvider: async () => ({}), readableError: (error: Error) => error.message }));
vi.mock("ethers", async original => ({ ...await original<typeof import("ethers")>(), Contract: class { balanceOf = mocks.balance; } }));
vi.mock("../src/features/MyMinersPage", () => ({ MyMinersPage: () => <div>My miners content</div> }));
vi.mock("../src/features/SalePage", () => ({ SalePage: () => <div>Sale content</div> }));
vi.mock("../src/features/ReferralPage", () => ({ ReferralPage: () => <div>Referral content</div> }));

const wallet = { address: "0x0000000000000000000000000000000000000001", getSigner: mocks.signer } as unknown as WalletState;
const month = "0xD9B491ac0f5487673500B67224b67b4171a08aCa";
const year = "0x3d175C8359169b0e830d36EA9CD3FE209f46f7BD";
const oldScroll = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "scrollIntoView");

beforeEach(() => {
  mocks.balance.mockReset().mockResolvedValue(123n * 10n ** 18n);
  mocks.signer.mockReset(); mocks.scroll.mockReset();
  Object.defineProperty(HTMLElement.prototype, "scrollIntoView", { configurable: true, value: mocks.scroll });
});
afterEach(() => {
  vi.restoreAllMocks();
  if (oldScroll) Object.defineProperty(HTMLElement.prototype, "scrollIntoView", oldScroll);
  else Reflect.deleteProperty(HTMLElement.prototype, "scrollIntoView");
});

describe("Overview miner duration links", () => {
  it("opens Deploy and focuses the requested allowlisted card without prefill or signing", async () => {
    render(<MemoryRouter initialEntries={[`/my-miners?tab=deploy&pool=${year.toLowerCase()}`]}>
      <header className="site-header" ref={element => { if (element) vi.spyOn(element, "getBoundingClientRect").mockReturnValue({ height: 124 } as DOMRect); }} />
      <MinersHubPage wallet={wallet} />
    </MemoryRouter>);
    const target = screen.getByRole("group", { name: "1 Year DEGEN miner deployment" });
    expect(screen.getByRole("tab", { name: "Deploy Miners" })).toHaveAttribute("aria-selected", "true");
    expect(target).toHaveFocus();
    expect(target.style.scrollMarginTop).toBe("144px");
    expect(mocks.scroll).toHaveBeenCalledExactlyOnceWith({ behavior: "instant", block: "start", inline: "nearest" });
    expect(mocks.scroll.mock.instances[0]).toBe(target);
    for (const card of screen.getAllByRole("group")) expect(within(card).getByRole("spinbutton")).toHaveValue(null);
    await waitFor(() => expect(within(target).getByRole("button", { name: "MAX" })).toBeEnabled());
    expect(mocks.scroll).toHaveBeenCalledTimes(1);
    expect(mocks.signer).not.toHaveBeenCalled();
  });

  it.each(["not-an-address", "0x0000000000000000000000000000000000000001", "https://untrusted.example/pool"])("ignores an unknown pool parameter: %s", async pool => {
    render(<MemoryRouter initialEntries={[`/my-miners?tab=deploy&pool=${encodeURIComponent(pool)}`]}><MinersHubPage wallet={wallet} /></MemoryRouter>);
    await waitFor(() => expect(mocks.balance).toHaveBeenCalled());
    expect(screen.getAllByRole("group")).toHaveLength(4);
    expect(mocks.scroll).not.toHaveBeenCalled();
    expect(mocks.signer).not.toHaveBeenCalled();
  });

  it("waits for an active page, focuses a new request once, and leaves balance updates alone", async () => {
    const { rerender } = render(<PageActivity.Provider value={false}><MinersPage wallet={wallet} poolAddress={month} /></PageActivity.Provider>);
    expect(mocks.scroll).not.toHaveBeenCalled();
    expect(mocks.balance).not.toHaveBeenCalled();
    rerender(<PageActivity.Provider value={true}><MinersPage wallet={wallet} poolAddress={month} /></PageActivity.Provider>);
    const first = screen.getByRole("group", { name: "1 Month DEGEN miner deployment" });
    expect(first).toHaveFocus();
    await waitFor(() => expect(within(first).getByRole("button", { name: "MAX" })).toBeEnabled());
    rerender(<PageActivity.Provider value={true}><MinersPage wallet={{ ...wallet }} poolAddress={month.toUpperCase()} /></PageActivity.Provider>);
    expect(mocks.scroll).toHaveBeenCalledTimes(1);
    rerender(<PageActivity.Provider value={true}><MinersPage wallet={wallet} poolAddress={year} /></PageActivity.Provider>);
    expect(screen.getByRole("group", { name: "1 Year DEGEN miner deployment" })).toHaveFocus();
    expect(mocks.scroll).toHaveBeenCalledTimes(2);
    expect(mocks.signer).not.toHaveBeenCalled();
  });

  it("does not focus a hidden deployment card when another hub tab is selected", async () => {
    const user = userEvent.setup();
    render(<MemoryRouter initialEntries={[`/my-miners?tab=deploy&pool=${year}`]}><MinersHubPage wallet={wallet} /></MemoryRouter>);
    expect(mocks.scroll).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole("tab", { name: "My Miners" }));
    expect(screen.getByRole("tab", { name: "My Miners" })).toHaveAttribute("aria-selected", "true");
    expect(mocks.scroll).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("tab", { name: "My Miners" })).toHaveFocus();
  });
});
