import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { ThemePanel, fitThemeWindowTop } from "../src/components/ThemePanel";

describe("compact-screen scroll safeguards", () => {
  it("keeps the complete theme header and a usable body visible when dragged to the bottom", () => {
    expect(fitThemeWindowTop(750, 800)).toBe(552);
    expect(fitThemeWindowTop(190, 240)).toBe(8);
    expect(fitThemeWindowTop(-100, 800)).toBe(8);
    expect(fitThemeWindowTop(100, 800)).toBe(100);
  });

  it("exposes theme settings to keyboard users without putting header controls in the scroller", async () => {
    const user = userEvent.setup();
    render(<ThemePanel theme="original" setTheme={vi.fn()} />);
    await user.click(screen.getByRole("button", { name: /Theme/ }));
    const region = screen.getByRole("region", { name: "Theme settings" });
    expect(region).toHaveAttribute("tabindex", "0");
    expect(region).not.toContainElement(screen.getByRole("button", { name: "Close theme picker" }));
  });

  it("protects tables, dialogs and edge-card menus without nested scrolling", () => {
    const css = readFileSync("src/features/legacy.css", "utf8");
    expect(css).toContain(".scroll-region .farm-table { min-width: 700px; }");
    expect(css).toContain(".scroll-region .rw-miners-list { min-width: 660px; }");
    expect(css).toContain(".scroll-region .mc-actions-menu { position: static;");
    expect(css).toMatch(/\.modal-box\s*\{[^}]+max-height: calc\(100dvh - 24px\);[^}]+overflow-y: auto/);
    const farms = readFileSync("src/features/FarmsPage.tsx", "utf8");
    expect(farms).toContain('<div className="browse-farms-table-wrap">');
    expect(farms).toContain('<div className="browse-farms-grid">');
    expect(farms).not.toContain('<ScrollRegion');
  });
});
