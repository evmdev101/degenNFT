import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { GovernanceComposer } from "../src/features/governance/GovernanceComposer";
import { loadGovernanceFormContext } from "../src/features/governance/formContext";
import { proposalSimulationReader, runProposalPreflight } from "../src/features/governance/proposalPreflight";
import { validateProposal } from "../src/features/governance/proposalValidation";
import { submitGovernanceCreation } from "../src/features/governance/creationTransactions";
// Keep the underlying form/submission checks exercised for future re-enablement.
vi.mock("../src/config/publicPreview", () => ({ GOVERNANCE_ACTIONS_DISABLED: false, assertGovernanceActionsEnabled: () => undefined }));
import { ACCOUNT, TOKEN, contextFixture, draftFixture, readerFixture } from "./governanceFixtures";

vi.mock("../src/features/governance/formContext", async original => ({ ...await original<typeof import("../src/features/governance/formContext")>(), loadGovernanceFormContext: vi.fn() }));
vi.mock("../src/features/governance/proposalPreflight", async original => ({ ...await original<typeof import("../src/features/governance/proposalPreflight")>(), runProposalPreflight: vi.fn(), proposalSimulationReader: vi.fn() }));
vi.mock("../src/features/governance/creationTransactions", async original => ({ ...await original<typeof import("../src/features/governance/creationTransactions")>(), submitGovernanceCreation: vi.fn() }));
const props = { module: "tax" as const, title: "Set Transaction Tax", subtitle: "Current tax", explain: "Test explanation", wallet: { address: ACCOUNT, chainId: 369n, getSigner: vi.fn() } };
const load = vi.mocked(loadGovernanceFormContext), preflight = vi.mocked(runProposalPreflight);
const success = () => ({ context: contextFixture(), validation: validateProposal("tax", draftFixture(), contextFixture()), simulation: { status: "passed" as const, message: "Creation simulation passed. No transaction sent." } });
beforeEach(() => { load.mockReset().mockResolvedValue(contextFixture()); preflight.mockReset().mockResolvedValue(success()); vi.mocked(proposalSimulationReader).mockResolvedValue(readerFixture()); });

describe("governance composer safety", () => {
  it("shows friendly pool names in the native selector while submitting only verified IDs", async () => {
    load.mockResolvedValueOnce(contextFixture({ pools: [
      { id: 4n, participant: "0x7979bEe7F5Fe93F4b22d7A24C629803950610e56", allocation: 200n },
      { id: 21n, participant: "0xc667a6EC483edB71f6329413FbcFE8042348956C", allocation: 10n },
    ] }));
    render(<GovernanceComposer {...props} module="allocation" />);
    const label = "EMIT-PLSX V2 LP(EMIT-PLSX) (Current: 0.1%)";
    expect(await screen.findByRole("option", { name: "HEX-HTT3000 V2 LP(HEX-HTT3000) (Current: 2%)" })).toHaveValue("4");
    expect(screen.getByRole("option", { name: label })).toHaveValue("21");
    const selector = screen.getByLabelText("Select Pool");
    expect(selector.tagName).toBe("SELECT");
    expect(screen.getAllByRole("option")).toHaveLength(3); // placeholder + two verified rows only
    fireEvent.change(selector, { target: { value: "21" } });
    expect(selector).toHaveDisplayValue(label);
    fireEvent.click(screen.getByRole("button", { name: "Check proposal" }));
    await waitFor(() => expect(preflight).toHaveBeenCalledWith("allocation", expect.objectContaining({ poolId: "21" }), ACCOUNT, 369n, expect.anything()));
    expect(screen.getByRole("button", { name: "Submit Proposal" })).toBeEnabled();
  });
  it("shows real credit and exact review, keeps submission locked, and clears preview after edits", async () => {
    render(<GovernanceComposer {...props} />);
    expect(await screen.findByText(/Available DEGEN voting credit: 10000/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("New Tax (%)"), { target: { value: "1" } });
    fireEvent.change(screen.getByLabelText("Your Commitment (whole DEGEN voting credit)"), { target: { value: "1000" } });
    fireEvent.click(screen.getByRole("button", { name: "Check proposal" }));
    expect(await screen.findByText("Proposal preview")).toBeInTheDocument();
    expect(preflight).toHaveBeenCalledWith("tax", expect.objectContaining({ value: "1", commitment: "1000" }), ACCOUNT, 369n, expect.anything());
    expect(screen.getByRole("button", { name: "Submit Proposal" })).toBeEnabled();
    expect(screen.getByText("proposeGovTax(uint256,uint256,uint256)")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("New Tax (%)"), { target: { value: "2" } });
    expect(screen.queryByText("Proposal preview")).not.toBeInTheDocument();
  });
  it("does not show an old balance or old async review under another wallet", async () => {
    let resolve!: (value: ReturnType<typeof success>) => void;
    preflight.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
    const view = render(<GovernanceComposer {...props} />);
    await screen.findByText(/Available DEGEN voting credit: 10000/);
    fireEvent.click(screen.getByRole("button", { name: "Check proposal" }));
    await waitFor(() => expect(preflight).toHaveBeenCalled());
    load.mockImplementationOnce(() => new Promise(() => {}));
    view.rerender(<GovernanceComposer {...props} wallet={{ address: TOKEN, chainId: 369n, getSigner: vi.fn() }} />);
    expect(screen.queryByText(/Available DEGEN voting credit: 10000/)).not.toBeInTheDocument();
    await act(async () => resolve(success()));
    expect(screen.queryByText("Proposal preview")).not.toBeInTheDocument();
  });
  it("invalidates preview after network or module changes", async () => {
    const view = render(<GovernanceComposer {...props} />);
    await screen.findByText(/Available DEGEN voting credit: 10000/);
    fireEvent.click(screen.getByRole("button", { name: "Check proposal" }));
    await screen.findByText("Proposal preview");
    view.rerender(<GovernanceComposer {...props} wallet={{ address: ACCOUNT, chainId: 1n, getSigner: vi.fn() }} />);
    expect(screen.queryByText("Proposal preview")).not.toBeInTheDocument();
    expect(screen.getByText("Select PulseChain in your wallet before submitting.")).toBeInTheDocument();
    view.rerender(<GovernanceComposer {...props} module="newtoken" />);
    expect(screen.getByLabelText("Token Contract Address")).toHaveValue("");
  });
  it("ignores in-flight simulation after an input changes", async () => {
    let resolve!: (value: ReturnType<typeof success>) => void;
    preflight.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
    render(<GovernanceComposer {...props} />);
    await screen.findByText(/Available DEGEN voting credit: 10000/);
    fireEvent.click(screen.getByRole("button", { name: "Check proposal" }));
    await waitFor(() => expect(preflight).toHaveBeenCalled());
    fireEvent.change(screen.getByLabelText("New Tax (%)"), { target: { value: "5" } });
    await act(async () => resolve(success()));
    expect(screen.queryByText("Proposal preview")).not.toBeInTheDocument();
    expect(screen.getByLabelText("New Tax (%)")).toHaveValue("5");
    expect(screen.getByRole("button", { name: "Check proposal" })).toBeEnabled();
  });
  it("retains display credit on failed optional checks while submissions always recheck", async () => {
    preflight.mockRejectedValueOnce(new Error("RPC offline"));
    render(<GovernanceComposer {...props} />);
    await screen.findByText(/Available DEGEN voting credit: 10000/);
    fireEvent.click(screen.getByRole("button", { name: "Check proposal" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("RPC offline");
    expect(screen.getByText(/Available DEGEN voting credit: 10000/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Refresh/ })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Submit Proposal" })).toBeEnabled();
  });
  it("associates a preset-token error with its control and announces the validation summary", async () => {
    preflight.mockResolvedValueOnce({ context: contextFixture(), validation: { errors: { tokenAddress: "No token code", value: "Amount is required" }, warnings: [] } });
    render(<GovernanceComposer {...props} module="treasury" />);
    await screen.findByText(/Available DEGEN voting credit: 10000/);
    fireEvent.click(screen.getByRole("button", { name: "Check proposal" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("No token code");
    expect(screen.getByLabelText("Token to Transfer")).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByLabelText("Token to Transfer")).toHaveAttribute("aria-describedby", "gov-error-tokenAddress");
    expect(screen.getByLabelText("Amount to Send")).toHaveAttribute("aria-invalid", "true");
  });
  it("lets disconnected users explore without inventing a zero balance or opening a wallet", async () => {
    load.mockResolvedValueOnce(contextFixture({ account: undefined, credit: undefined }));
    render(<GovernanceComposer {...props} wallet={{ address: null, chainId: null }} />);
    await waitFor(() => expect(screen.getByRole("button", { name: "Check proposal" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "Check proposal" }));
    expect(screen.getByRole("alert")).toHaveTextContent(/Connect your wallet/);
    expect(preflight).not.toHaveBeenCalled();
  });
  it("submits directly with fresh terms and prevents duplicate clicks while the wallet request is active", async () => {
    const send=vi.mocked(submitGovernanceCreation);
    let finish!: (value: Awaited<ReturnType<typeof submitGovernanceCreation>>) => void;
    send.mockReset().mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));
    render(<GovernanceComposer {...props} />);
    await screen.findByText(/Available DEGEN voting credit: 10000/);
    fireEvent.change(screen.getByLabelText("New Tax (%)"),{target:{value:"1"}});
    fireEvent.change(screen.getByLabelText("Your Commitment (whole DEGEN voting credit)"),{target:{value:"1000"}});
    const button=screen.getByRole("button",{name:"Submit Proposal"});
    fireEvent.click(button); fireEvent.click(button);
    expect(send).toHaveBeenCalledTimes(1);
    expect(preflight).not.toHaveBeenCalled(); // optional check is never a prerequisite
    expect(send).toHaveBeenCalledWith("tax",expect.objectContaining({value:"1",commitment:"1000"}),props.wallet,expect.any(Function));
    await act(async()=>finish({id:"7",hash:"0x123",preflight:success()}));
    expect(await screen.findByText("Proposal #7 created.")).toBeInTheDocument();
  });

});
