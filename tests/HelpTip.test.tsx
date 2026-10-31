import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { HelpTip } from "../src/components/HelpTip";

describe("explicit help controls", () => {
  it("stays closed on hover and focus, toggles on activation and dismisses outside", () => {
    render(<HelpTip label="miner value">Miner value explanation</HelpTip>);
    const trigger = screen.getByRole("button", { name: "About miner value" });
    fireEvent.mouseEnter(trigger);
    fireEvent.focus(trigger);
    expect(screen.queryByRole("note")).not.toBeInTheDocument();
    fireEvent.click(trigger);
    expect(screen.getByRole("note")).toBeVisible();
    fireEvent.click(trigger);
    expect(screen.queryByRole("note")).not.toBeInTheDocument();
    fireEvent.click(trigger);
    fireEvent.pointerDown(document.body);
    expect(trigger).toHaveAttribute("aria-expanded", "false");
  });

  it("supports keyboard activation and Escape", async () => {
    const user = userEvent.setup();
    render(<HelpTip label="miner value">Miner value explanation</HelpTip>);
    const trigger = screen.getByRole("button", { name: "About miner value" });
    await user.tab();
    expect(trigger).toHaveFocus();
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    await user.keyboard("{Enter}");
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    await user.keyboard("{Escape}");
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(trigger).toHaveFocus();
  });
});
