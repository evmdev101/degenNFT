import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ContractShowcase } from "../src/features/dashboard/ContractShowcase";
import { CONTRACTS } from "../src/config/contracts";
import { GOVERNANCE_ADDRESSES } from "../src/features/governance/governanceSpec";
import deployments from "./fixtures/governanceDeployments.json";

const tokenSource = "// Verified token dependencies\npragma solidity ^0.8.20;\ncontract DEGEN {\n string public symbol = \"DEGEN\";\n}\n";
const governorSource = "pragma solidity ^0.8.20;\ncontract DTXgovernor { }\n";
const response = (source: string) => ({ ok: true, text: async () => source });
const originalShowModal = Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, "showModal");
const originalClose = Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, "close");
afterEach(() => {
  vi.unstubAllGlobals(); vi.restoreAllMocks();
  for (const [name, descriptor] of [["showModal", originalShowModal], ["close", originalClose]] as const) {
    if (descriptor) Object.defineProperty(HTMLDialogElement.prototype, name, descriptor);
    else Reflect.deleteProperty(HTMLDialogElement.prototype, name);
  }
});

describe("DEGEN contract source showcase", () => {
  it("loads local verified source, jumps to its token declaration, wraps and copies exact code", async () => {
    const user = userEvent.setup();
    const copy = vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue();
    const fetchSource = vi.fn().mockResolvedValue(response(tokenSource));
    vi.stubGlobal("fetch", fetchSource);
    render(<ContractShowcase />);
    const region = await screen.findByRole("region", { name: "DEGEN Solidity source code" });
    await waitFor(() => expect(region).toHaveTextContent("contract DEGEN"));
    expect(fetchSource).toHaveBeenCalledWith("/contracts/DEGEN-explorer.sol", expect.objectContaining({ signal: expect.any(AbortSignal) }));
    const declaration = region.querySelector('[data-source-line="3"]')!;
    Object.defineProperty(declaration, "offsetTop", { value: 120 });
    await user.click(screen.getByRole("button", { name: "Jump to DEGEN" }));
    expect(region.scrollTop).toBe(106);
    expect(region).toHaveFocus();
    await user.click(screen.getByRole("checkbox", { name: "Wrap lines" }));
    expect(region).toHaveClass("is-wrapped");
    await user.click(screen.getByRole("button", { name: "Copy code" }));
    expect(copy).toHaveBeenCalledWith(tokenSource);
    expect(screen.getByRole("button", { name: "Copied!" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Explorer source/ })).toHaveAttribute("href", `https://scan.pulsechain.com/address/${CONTRACTS.degen}?tab=contract`);
  });

  it("switches to the actual governor source and caches previously loaded source files", async () => {
    const user = userEvent.setup();
    const fetchSource = vi.fn().mockImplementation((url: string) => Promise.resolve(response(url.includes("DTXgovernor") ? governorSource : tokenSource)));
    vi.stubGlobal("fetch", fetchSource);
    render(<ContractShowcase />);
    await screen.findByRole("button", { name: "Jump to DEGEN" });
    await waitFor(() => expect(screen.getByRole("button", { name: "Jump to DEGEN" })).toBeEnabled());
    await user.selectOptions(screen.getByRole("combobox", { name: "Contract source file" }), "DTXgovernor-explorer.sol");
    await waitFor(() => expect(screen.getByRole("button", { name: "Jump to Governor" })).toBeEnabled());
    expect(screen.getByRole("link", { name: /Explorer source/ })).toHaveAttribute("href", `https://scan.pulsechain.com/address/${GOVERNANCE_ADDRESSES.governor}?tab=contract`);
    expect(screen.getByRole("region", { name: "DTXgovernor Solidity source code" })).toHaveTextContent("contract DTXgovernor");
    await user.selectOptions(screen.getByRole("combobox", { name: "Contract source file" }), "DEGEN-explorer.sol");
    expect(screen.getByRole("button", { name: "Jump to DEGEN" })).toBeEnabled();
    expect(fetchSource).toHaveBeenCalledTimes(2);
  });

  it("expands a native source dialog and closes it without navigating", async () => {
    const user = userEvent.setup();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response(tokenSource)));
    Object.defineProperty(HTMLDialogElement.prototype, "showModal", { configurable: true, value: function (this: HTMLDialogElement) { this.setAttribute("open", ""); } });
    Object.defineProperty(HTMLDialogElement.prototype, "close", { configurable: true, value: function (this: HTMLDialogElement) { this.removeAttribute("open"); } });
    render(<ContractShowcase />);
    const expand = screen.getByRole("button", { name: "Expand ↗" });
    await waitFor(() => expect(expand).toBeEnabled());
    await user.click(expand);
    const dialog = screen.getByRole("dialog", { name: "DEGEN · Solidity source" });
    expect(within(dialog).getByRole("region", { name: "Expanded DEGEN Solidity source code" })).toHaveTextContent("contract DEGEN");
    await user.click(within(dialog).getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(expand).toHaveFocus();
  });

  it("does not present a failed or unrelated response as contract source", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response("<!doctype html><html>Not a contract</html>")));
    render(<ContractShowcase />);
    await screen.findByText("Contract source unavailable.");
    expect(screen.getByRole("button", { name: "Copy code" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Expand ↗" })).toBeDisabled();
    expect(screen.queryByText("Not a contract")).not.toBeInTheDocument();
  });

  it("renders the complete bundled governor source and keeps display controls usable", async () => {
    const user = userEvent.setup();
    const fullGovernor = readFileSync(resolve("public/contracts/DTXgovernor-explorer.sol"), "utf8");
    vi.stubGlobal("fetch", vi.fn().mockImplementation((url: string) => Promise.resolve(response(url.includes("DTXgovernor") ? fullGovernor : tokenSource))));
    render(<ContractShowcase />);
    await waitFor(() => expect(screen.getByRole("button", { name: "Jump to DEGEN" })).toBeEnabled());
    await user.selectOptions(screen.getByRole("combobox", { name: "Contract source file" }), "DTXgovernor-explorer.sol");
    await waitFor(() => expect(screen.getByRole("button", { name: "Jump to Governor" })).toBeEnabled());
    const region = screen.getByRole("region", { name: "DTXgovernor Solidity source code" });
    expect(region.querySelectorAll("[data-source-line]")).toHaveLength(fullGovernor.split("\n").length);
    expect(region).toHaveTextContent("contract DTXgovernor");
    await user.click(screen.getByRole("checkbox", { name: "Wrap lines" }));
    expect(region).toHaveClass("is-wrapped");
    await user.click(screen.getByRole("button", { name: "Light On" }));
    expect(screen.getByRole("button", { name: "Light Off" })).toBeInTheDocument();
  });

  it("aborts an unfinished local source request on unmount and lets users pause decorative motion", async () => {
    const user = userEvent.setup();
    let signal: AbortSignal;
    vi.stubGlobal("fetch", vi.fn().mockImplementation((_url, options) => { signal = options.signal; return new Promise(() => {}); }));
    const view = render(<ContractShowcase />);
    await user.click(screen.getByRole("button", { name: "Pause motion" }));
    expect(screen.getByRole("button", { name: "Resume motion" })).toHaveAttribute("aria-pressed", "true");
    await user.click(screen.getByRole("button", { name: "Light On" }));
    expect(screen.getByRole("button", { name: "Light Off" })).toHaveAttribute("aria-pressed", "true");
    view.unmount();
    expect(signal!.aborted).toBe(true);
  });
});

describe("bundled verified DEGEN source provenance", () => {
  it("pins explorer source contents and keeps the contract-only view an exact excerpt", () => {
    const read = (name: string) => readFileSync(resolve("public/contracts", name), "utf8");
    const manifest = JSON.parse(read("sources.json"));
    expect(manifest.chainId).toBe(369);
    const expectedHashes: Record<string, string> = {
      "DEGEN-explorer.sol": "403ead6bad68a08477a028b9a92e59cb0f580738eb6fa05af5aa186b5fc02a9e",
      "DEGEN-token.sol": "35831bb5061e6bf1c33179f168c13892be93e90a5283fc17528cb81d8286e669",
      "DTXgovernor-explorer.sol": "0901890578ccb24169cd806b98b65cb1c46203e48bff845c367be15237e02028",
    };
    for (const entry of manifest.files) {
      expect(createHash("sha256").update(read(entry.filename)).digest("hex")).toBe(expectedHashes[entry.filename]);
      expect(entry.sha256).toBe(expectedHashes[entry.filename]);
      expect(entry.sourceUrl).toContain(`address=${entry.address}`);
      if (!entry.excerptOf) {
        const deployed = deployments.contracts.find(contract => contract.address.toLowerCase() === entry.address.toLowerCase())!;
        expect(deployed.isProxy).toBe(false);
        // The independently pinned source used CRLF; public files normalize only newlines.
        expect(createHash("sha256").update(read(entry.filename).replace(/\n/g, "\r\n")).digest("hex")).toBe(deployed.sourceSha256);
      }
    }
    expect(read("DEGEN-explorer.sol")).toContain(read("DEGEN-token.sol"));
    expect(read("DEGEN-token.sol")).toContain('constructor() ERC20("DegenStrategy", "DEGEN")');
    expect(read("DTXgovernor-explorer.sol")).toMatch(/contract DTXgovernor\b/);
  });
});
