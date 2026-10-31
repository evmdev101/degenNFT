import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

// Vitest stubs CSS imports; inspect the actual stylesheet for this source-level check.
const css = readFileSync("src/features/governance/governance-studio.css", "utf8");

describe("Governance shared theme", () => {
  it("inherits the five shared palette values instead of replacing them", () => {
    const shared = new Set(["--bg", "--fg", "--panel", "--border", "--accent"]);
    for (const match of css.matchAll(/(--[\w-]+)\s*:/g)) expect(shared.has(match[1])).toBe(false);
    for (const token of shared) expect(css).toContain(`var(${token})`);
    expect(css).toContain("--red: var(--accent)");
  });

  it("has no fixed palette colors and all derived tokens resolve to live theme values", () => {
    expect(css).not.toMatch(/#[a-f\d]{3,8}\b|\brgba?\(|\bhsla?\(/i);
    const tokens = new Map<string, string>();
    for (const match of css.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) tokens.set(match[1], match[2]);
    const shared = new Set(["--bg", "--fg", "--panel", "--border", "--accent"]);
    function check(value: string, visited = new Set<string>()) {
      for (const match of value.matchAll(/var\((--[\w-]+)/g)) {
        const token = match[1];
        if (shared.has(token)) continue;
        expect(visited.has(token), `Circular color token ${token}`).toBe(false);
        expect(tokens.has(token), `Missing color token ${token}`).toBe(true);
        check(tokens.get(token)!, new Set([...visited, token]));
      }
    }
    check(css);
  });

  it("keeps the approved layout and responsive card structure", () => {
    // Inspect the authored top-level rule, before its responsive overrides.
    const rule = (selector: string) => {
      const start = css.indexOf(`${selector} {`);
      expect(start).toBeGreaterThanOrEqual(0);
      return css.slice(start, css.indexOf("}", start));
    };
    expect(rule(".governance-studio .gov-wrap")).toContain("max-width: 1180px");
    expect(rule(".governance-studio .gov-compose .gov-card")).toContain("width: 100%");
    expect(rule(".governance-studio .gov-compose .gov-card")).toContain("max-width: none");
    expect(rule(".governance-studio .gov-compose .gov-card")).toContain("padding: 32px");
    expect(css).not.toContain(".gov-compose > summary");
    expect(rule(".governance-studio .gov-proposal-list")).toContain("display: grid");
    expect(rule(".governance-studio .gov-proposal-card")).toContain("border-radius: 10px");
    expect(rule(".governance-studio .gov-status-warning")).toContain("border-style: dashed");
    expect(css).toContain("@media (max-width: 760px)");
  });

  it("uses independent theme-aware stat cards with tablet and phone layouts", () => {
    expect(css).not.toContain(".governance-studio .gov-stat::before");
    expect(css).toContain("@media (max-width: 64rem)");
    expect(css).toContain("@media (max-width: 34rem)");
    expect(css).toContain(".governance-studio .gov-stats { grid-template-columns: minmax(0, 1fr); }");
    expect(css).not.toMatch(/\.gov-stat\s*\+\s*\.gov-stat|\.gov-stat:nth-child/);
  });
});
