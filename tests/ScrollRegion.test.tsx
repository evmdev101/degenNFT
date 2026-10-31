import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { ScrollRegion } from "../src/components/ScrollRegion";

let notifyResize: () => void;
const observe = vi.fn();
const disconnect = vi.fn();

beforeEach(() => {
  observe.mockClear();
  disconnect.mockClear();
  vi.stubGlobal("ResizeObserver", class {
    constructor(callback: () => void) { notifyResize = callback; }
    observe = observe;
    disconnect = disconnect;
  });
});
afterEach(() => vi.unstubAllGlobals());

function dimensions(element: HTMLElement, height: number, width = 300) {
  Object.defineProperties(element, {
    clientHeight: { configurable: true, value: 200 },
    scrollHeight: { configurable: true, value: height },
    clientWidth: { configurable: true, value: 300 },
    scrollWidth: { configurable: true, value: width },
  });
}

describe("native collection scrolling", () => {
  it("adds keyboard access and a hint only when content overflows, and observes expanded content", () => {
    render(<ScrollRegion label="Proposal history"><details><summary>Record details</summary>Metadata</details></ScrollRegion>);
    const region = screen.getByRole("region", { name: "Proposal history" });
    expect(region).not.toHaveAttribute("tabindex");
    expect(screen.queryByText(/Scroll within/)).not.toBeInTheDocument();
    expect(observe).toHaveBeenCalledWith(region);
    expect(observe).toHaveBeenCalledWith(region.firstElementChild);

    dimensions(region, 1000);
    act(() => notifyResize());
    expect(region).toHaveAttribute("tabindex", "0");
    expect(region).toHaveAccessibleDescription("Scroll within this list to see more");
    region.focus();
    expect(region).toHaveFocus();

    dimensions(region, 180);
    act(() => notifyResize());
    expect(region).not.toHaveAttribute("tabindex");
    expect(region).not.toHaveAttribute("aria-describedby");
    expect(screen.queryByText(/Scroll within/)).not.toBeInTheDocument();
  });

  it("also exposes wide tables to keyboard users without a second nested scroller", () => {
    render(<ScrollRegion label="Owned miners"><table><tbody><tr><td>Miner</td></tr></tbody></table></ScrollRegion>);
    const region = screen.getByRole("region", { name: "Owned miners" });
    dimensions(region, 150, 800);
    act(() => notifyResize());
    expect(region).toHaveAttribute("tabindex", "0");
    expect(region.querySelectorAll(".scroll-region")).toHaveLength(0);
  });

  it("resets on a module/view/filter change but preserves position during live row updates", () => {
    const view = render(<ScrollRegion label="Proposals" resetKey="allocation:history">First snapshot</ScrollRegion>);
    const region = screen.getByRole("region", { name: "Proposals" });
    region.scrollTop = 800;
    region.scrollLeft = 40;
    view.rerender(<ScrollRegion label="Proposals" resetKey="allocation:history">Updated snapshot</ScrollRegion>);
    expect(region.scrollTop).toBe(800);
    expect(region.scrollLeft).toBe(40);
    view.rerender(<ScrollRegion label="Proposals" resetKey="allocation:open">Open proposals</ScrollRegion>);
    expect(region.scrollTop).toBe(0);
    expect(region.scrollLeft).toBe(0);
    view.unmount();
    expect(disconnect).toHaveBeenCalledOnce();
  });

  it("keeps native scrolling usable when ResizeObserver is unavailable", () => {
    vi.stubGlobal("ResizeObserver", undefined);
    render(<ScrollRegion label="Farm listings">Farms</ScrollRegion>);
    const region = screen.getByRole("region", { name: "Farm listings" });
    dimensions(region, 1000);
    fireEvent.resize(window);
    expect(region).toHaveAttribute("tabindex", "0");
  });

  it("uses a responsive height cap, inherited colors and natural page scroll chaining", () => {
    const css = readFileSync("src/components/scroll-region.css", "utf8");
    expect(css).toContain("max-height: min(68dvh, 44rem)");
    expect(css).toContain("overflow: auto");
    expect(css).toContain("overscroll-behavior: auto");
    expect(css).toContain("scrollbar-gutter: stable");
    expect(css).toContain("var(--accent)");
    expect(css).toContain(":focus-visible");
    expect(css).not.toMatch(/#[\da-f]{3,8}\b/i);
    const code = readFileSync("src/components/ScrollRegion.tsx", "utf8");
    expect(code).not.toMatch(/preventDefault|onWheel|onKeyDown|onTouchMove/);
  });
});
