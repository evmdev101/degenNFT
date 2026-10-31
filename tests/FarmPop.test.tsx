import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FarmPop } from "../src/features/FarmPop";

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("farm details in a scrollable list", () => {
  it("opens only on activation, renders outside the scroll viewport and supports Escape", () => {
    const { container } = render(<div className="scroll-region"><FarmPop title="APR breakdown" icon="i" rows={[["Daily", "1%"]]} /></div>);
    const button = screen.getByRole("button", { name: "APR breakdown" });
    fireEvent.focus(button);
    fireEvent.mouseEnter(button);
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
    fireEvent.click(button);
    const tooltip = screen.getByRole("tooltip");
    expect(tooltip.parentElement).toBe(document.body);
    expect(container.querySelector("[role=tooltip]")).toBeNull();
    expect(button).toHaveAttribute("aria-describedby", tooltip.id);
    expect(tooltip).toHaveTextContent("Daily:1%");
    expect(button).toHaveAttribute("aria-expanded", "true");
    fireEvent.keyDown(button, { key: "Escape" });
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
    expect(button).toHaveAttribute("aria-expanded", "false");
  });

  it("can be opened by touch/click and dismisses when scrolling or clicking outside", () => {
    const { container } = render(<div className="scroll-region"><FarmPop title="Rewards" icon="i" rows={[["Yearly", "200"]]} /></div>);
    const button = screen.getByRole("button", { name: "Rewards" });
    fireEvent.click(button);
    expect(screen.getByRole("tooltip")).toBeInTheDocument();
    fireEvent.scroll(container.firstChild!);
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
    fireEvent.click(button);
    fireEvent.click(button);
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
    fireEvent.click(button);
    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
  });

  it("flips above the trigger and clamps to the viewport at the bottom-right edge", () => {
    vi.stubGlobal("innerWidth", 320);
    vi.stubGlobal("innerHeight", 240);
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
      return this.classList.contains("farm-pop-btn")
        ? { left: 300, top: 200, bottom: 220, width: 20, height: 20 } as DOMRect
        : { width: 260, height: 140 } as DOMRect;
    });
    render(<FarmPop title="Rewards" icon="i" rows={[["Yearly", "200"]]} />);
    fireEvent.click(screen.getByRole("button", { name: "Rewards" }));
    expect(screen.getByRole("tooltip")).toHaveStyle({ left: "48px", top: "52px" });
  });
});
