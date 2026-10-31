import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { GovernancePage } from "../src/features/GovernancePage";
import type { WalletState } from "../src/hooks/useWallet";

describe("Governance workspace layout", () => {
  it("keeps the proposal form always visible and retains the separate proposal area and reference controls", () => {
    const wallet: WalletState = {
      address: null, chainId: null, isConnected: false, isWrongNetwork: false, connecting: false, error: "",
      connect: vi.fn(async () => {}), switchNetwork: vi.fn(async () => {}),
      getSigner: vi.fn(async () => { throw new Error("Not connected"); }),
    };
    // Server rendering checks the complete JSX structure without RPC or wallet effects.
    const markup = renderToStaticMarkup(<GovernancePage wallet={wallet} />);
    const doc = new DOMParser().parseFromString(markup, "text/html");
    expect(doc.querySelector("main")?.className).toBe("governance-studio");
    expect(doc.querySelector("main")?.getAttribute("aria-label")).toBe("Governance");
    expect(doc.querySelector(".gov-eyebrow, .gov-title, .gov-desc")).toBeNull();
    expect(doc.body.textContent).not.toContain("Review proposed changes to the DEGEN protocol.");
    expect(doc.querySelector('.gov-stats[aria-label="Protocol parameters"]')?.tagName).toBe("DL");
    expect(Array.from(doc.querySelectorAll(".gov-stat dt"), (label) => Array.from(label.childNodes).filter(node => node.nodeType === 3).map(node => node.textContent).join(""))).toEqual([
      "Base proposal cost", "Base review window", "Transaction Tax", "DEGEN emissions / block",
    ]);
    expect(doc.querySelectorAll(".gov-stat dd")).toHaveLength(4);
    expect(doc.querySelector(".gov-stat-unit")?.textContent).toBe("DEGEN credit");
    expect(doc.querySelectorAll('[aria-label="Governance modules"] button')).toHaveLength(9);
    expect(doc.querySelector('.gov-rail-btn[aria-pressed="true"]')?.textContent).toBe("Reward Allocation");
    expect(doc.querySelector(".gov-compose")?.tagName).toBe("SECTION");
    expect(doc.querySelector(".gov-compose summary")).toBeNull();
    expect(doc.querySelector(".gov-compose")?.closest("details")).toBeNull();
    expect(doc.querySelector(".gov-compose")?.getAttribute("aria-labelledby")).toBe("gov-compose-title");
    expect(doc.querySelector("#gov-compose-title")?.textContent).toBe("Set Reward Allocation");
    expect(doc.querySelector(".gov-compose-header span")?.textContent).toBe("Create proposal");
    expect(doc.querySelectorAll(".gov-compose")).toHaveLength(1);
    expect(doc.querySelector(".gov-compose .gov-submit-btn")?.hasAttribute("disabled")).toBe(true);
    expect(doc.querySelectorAll(".gov-compose input[aria-label]").length).toBeGreaterThan(0);
    expect(doc.querySelector(".gov-compose .gov-prop-header")).toBeNull();
    expect(doc.querySelector(".gov-source-details .gov-submit-btn")).toBeNull();
    expect(doc.querySelectorAll(".gov-resources > details")).toHaveLength(3);
    expect(doc.querySelectorAll(".gov-resources .gov-action-btn")).toHaveLength(6);
    expect(doc.querySelector(".gov-mode")?.textContent).toContain("Read-only preview");
    expect(doc.querySelector('[aria-label="Governance actions status"]')?.textContent).toContain("Actions temporarily disabled");
    expect(doc.querySelector("table")).toBeNull();
    expect(wallet.connect).not.toHaveBeenCalled();
  });
});
