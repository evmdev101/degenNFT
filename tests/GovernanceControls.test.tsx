import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { GovernanceActionControls, GovernanceWalletContext } from "../src/features/governance/GovernanceActions";
import { submitGovernanceAction } from "../src/features/governance/governanceTransactions";
// The default paused UI and real send guards are covered in GovernancePause.
vi.mock("../src/config/publicPreview", () => ({ GOVERNANCE_ACTIONS_DISABLED: false, assertGovernanceActionsEnabled: () => undefined }));
import type { WalletState } from "../src/hooks/useWallet";
import { PageActivity } from "../src/hooks/usePageActive";
vi.mock("../src/features/governance/governanceTransactions", () => ({ submitGovernanceAction: vi.fn() }));
const submit = vi.mocked(submitGovernanceAction);
const wallet = { address: "0x1111111111111111111111111111111111111111", chainId: 369n, isWrongNetwork: false } as WalletState;
beforeEach(() => submit.mockReset().mockResolvedValue({ outcome: "voted", message: "Vote recorded.", hash: "0x" + "1".repeat(64) }));
it("opens an amount field before requesting a vote and blocks rapid duplicate submissions", async () => {
  let finish!: () => void;
  submit.mockImplementationOnce(() => new Promise(resolve => { finish = () => resolve({ outcome: "voted", message: "Vote recorded.", hash: "0x" + "1".repeat(64) }); }));
  render(<GovernanceWalletContext.Provider value={wallet}><GovernanceActionControls module="tax" proposalId="2" verified phase="voting" /></GovernanceWalletContext.Provider>);
  fireEvent.click(screen.getByRole("button", { name: "Vote for" }));
  expect(submit).not.toHaveBeenCalled();
  fireEvent.change(screen.getByRole("textbox"), { target: { value: "0.125" } });
  const form = screen.getByRole("textbox").closest("form")!;
  fireEvent.submit(form); fireEvent.submit(form);
  expect(submit).toHaveBeenCalledTimes(1);
  expect(submit).toHaveBeenCalledWith({ module: "tax", proposalId: "2", action: "yes", credit: "0.125" }, wallet, expect.anything());
  await act(async () => finish());
  expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
});
it("invalidates pending preflight intent when its page becomes inactive", async () => {
  let isCurrent!: () => boolean;
  submit.mockImplementationOnce(async (_request, _wallet, options) => { isCurrent = options!.isCurrent!; return new Promise(() => {}); });
  const view = render(<PageActivity.Provider value={true}><GovernanceWalletContext.Provider value={wallet}><GovernanceActionControls module="tax" proposalId="2" verified phase="enforceable" /></GovernanceWalletContext.Provider></PageActivity.Provider>);
  fireEvent.click(screen.getByRole("button", { name: "Enforce" }));
  expect(isCurrent()).toBe(true);
  view.rerender(<PageActivity.Provider value={false}><GovernanceWalletContext.Provider value={wallet}><GovernanceActionControls module="tax" proposalId="2" verified phase="enforceable" /></GovernanceWalletContext.Provider></PageActivity.Provider>);
  expect(isCurrent()).toBe(false);
});
it("reports partial fee synchronization instead of silently treating all vaults as updated", async () => {
  submit.mockResolvedValueOnce({ outcome: "partial", message: "Transaction confirmed. Vault fees verified for 1 of 2 vaults; the remaining vaults need checking.", hash: "0x" + "1".repeat(64) });
  render(<GovernanceWalletContext.Provider value={wallet}><GovernanceActionControls module="fees" proposalId="2" verified valid={false} /></GovernanceWalletContext.Provider>);
  fireEvent.click(screen.getByRole("button", { name: "Synchronize vault fees" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("1 of 2");
});
it("does not offer actionable controls for failed or unsupported proposal reads", () => {
  render(<GovernanceWalletContext.Provider value={wallet}><GovernanceActionControls module="emissions" proposalId="2" verified blockedReason="Not an emissions proposal" /></GovernanceWalletContext.Provider>);
  expect(screen.queryByRole("button")).not.toBeInTheDocument();
  expect(submit).not.toHaveBeenCalled();
});
