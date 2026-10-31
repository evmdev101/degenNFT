import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { GOVERNANCE_ACTIONS_DISABLED, GOVERNANCE_ACTIONS_NOTICE } from "../src/config/publicPreview";
import { getPublicProvider } from "../src/lib/chain";
import { submitGovernanceAction } from "../src/features/governance/governanceTransactions";
import { submitGovernanceCreation } from "../src/features/governance/creationTransactions";
import { submitGovernanceMaintenance } from "../src/features/governance/governanceMaintenance";
import { GovernanceActionControls, GovernanceWalletContext } from "../src/features/governance/GovernanceActions";
import { GovernanceComposer } from "../src/features/governance/GovernanceComposer";
import { GovernanceMaintenance } from "../src/features/governance/GovernanceMaintenancePanel";
import { loadGovernanceFormContext } from "../src/features/governance/formContext";
import { proposalSimulationReader, runProposalPreflight } from "../src/features/governance/proposalPreflight";
import { validateProposal } from "../src/features/governance/proposalValidation";
import type { GovernanceModule } from "../src/features/governance/governanceSpec";
import type { WalletState } from "../src/hooks/useWallet";
import { ACCOUNT, contextFixture, draftFixture, readerFixture } from "./governanceFixtures";

// Use the real default pause and all three real submission boundaries.
vi.mock("../src/lib/chain", async original => ({ ...await original<typeof import("../src/lib/chain")>(), getPublicProvider: vi.fn() }));
vi.mock("../src/features/governance/formContext", async original => ({ ...await original<typeof import("../src/features/governance/formContext")>(), loadGovernanceFormContext: vi.fn() }));
vi.mock("../src/features/governance/proposalPreflight", async original => ({ ...await original<typeof import("../src/features/governance/proposalPreflight")>(), proposalSimulationReader: vi.fn(), runProposalPreflight: vi.fn() }));

const wallet = {
  address: ACCOUNT, chainId: 369n, isWrongNetwork: false, isConnected: true,
  connecting: false, error: "", connect: vi.fn(), switchNetwork: vi.fn(), getSigner: vi.fn(),
} as unknown as WalletState;
const modules: GovernanceModule[] = ["allocation", "rollover", "tax", "emissions", "treasury", "newtoken", "fees", "votecost", "delay"];
const paused = { message: GOVERNANCE_ACTIONS_NOTICE, code: 4100, walletRequestStarted: false };

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(loadGovernanceFormContext).mockResolvedValue(contextFixture());
  vi.mocked(proposalSimulationReader).mockResolvedValue(readerFixture());
  vi.mocked(runProposalPreflight).mockResolvedValue({
    context: contextFixture(), validation: validateProposal("tax", draftFixture(), contextFixture()),
    simulation: { status: "passed", message: "Creation simulation passed. No transaction sent." },
  });
});

describe("local governance testing pause", () => {
  it.each(modules)("blocks %s creation and every proposal action before RPC or wallet access", async module => {
    expect(GOVERNANCE_ACTIONS_DISABLED).toBe(true);
    await expect(submitGovernanceCreation(module, draftFixture(), wallet)).rejects.toMatchObject(paused);
    for (const action of ["yes", "no", "veto", "enforce", "sync"] as const) {
      await expect(submitGovernanceAction({ module, action, proposalId: "0", credit: "1" }, wallet)).rejects.toMatchObject(paused);
    }
    expect(wallet.getSigner).not.toHaveBeenCalled();
    expect(getPublicProvider).not.toHaveBeenCalled();
    expect(proposalSimulationReader).not.toHaveBeenCalled();
  });

  it.each(["rebalance", "import-credit"] as const)("blocks maintenance %s before RPC or wallet access", async action => {
    await expect(submitGovernanceMaintenance(action, wallet)).rejects.toMatchObject(paused);
    expect(wallet.getSigner).not.toHaveBeenCalled();
    expect(getPublicProvider).not.toHaveBeenCalled();
  });

  it("disables votes, veto, enforcement, fee sync and maintenance for a connected wallet", () => {
    render(<GovernanceWalletContext.Provider value={wallet}>
      <GovernanceActionControls module="tax" proposalId="0" verified />
      <GovernanceActionControls module="fees" proposalId="0" verified valid={false} />
      <GovernanceMaintenance />
    </GovernanceWalletContext.Provider>);
    for (const name of ["Vote for", "Vote against", "Veto", "Enforce", "Synchronize vault fees", "Rebalance Rewards", "Import Eligible Voting Credit"]) {
      const button = screen.getByRole("button", { name, exact: true });
      expect(button).toBeDisabled();
      fireEvent.click(button);
    }
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(wallet.getSigner).not.toHaveBeenCalled();
    expect(getPublicProvider).not.toHaveBeenCalled();
  });

  it("disables proposal submission while allowing fields and the read-only check", async () => {
    render(<GovernanceComposer module="tax" title="Set Transaction Tax" subtitle="Current tax" explain="" wallet={wallet} />);
    await waitFor(() => expect(screen.getByRole("button", { name: "Check proposal" })).toBeEnabled());
    const field = screen.getByLabelText("New Tax (%)");
    expect(field).toBeEnabled();
    fireEvent.change(field, { target: { value: "1" } });
    fireEvent.change(screen.getByLabelText("Your Commitment (whole DEGEN voting credit)"), { target: { value: "1000" } });
    const submit = screen.getByRole("button", { name: "Submit Proposal" });
    expect(submit).toBeDisabled();
    fireEvent.click(submit);
    expect(wallet.getSigner).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Check proposal" }));
    await waitFor(() => expect(runProposalPreflight).toHaveBeenCalledOnce());
    expect(await screen.findByText("Creation simulation passed. No transaction sent.")).toBeInTheDocument();
    expect(wallet.getSigner).not.toHaveBeenCalled();
  });
});
