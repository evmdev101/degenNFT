import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ThemePanel, useTheme } from "../src/components/ThemePanel";
import { applyBackground, backgroundDefaults, readBackground, type BackgroundSettings } from "../src/themes/backgroundEffects";
import { THEMES } from "../src/themes/themes";

vi.mock("../src/themes/backgroundEffects", async (original) => ({
  ...await original<typeof import("../src/themes/backgroundEffects")>(),
  applyBackground: vi.fn((settings: BackgroundSettings, persist = true) => {
    if (persist) localStorage.setItem("degen-react-background", JSON.stringify(settings));
  }),
}));

function ThemeControls() {
  const { theme, setTheme } = useTheme();
  return <ThemePanel theme={theme} setTheme={setTheme} />;
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
  document.documentElement.removeAttribute("style");
  delete document.documentElement.dataset.theme;
});

describe("theme preferences", () => {
  it("falls back to the Midnight palette for a saved name that is not a preset", () => {
    localStorage.setItem("degen-react-theme", "toString");
    render(<ThemeControls />);
    expect(document.documentElement.style.getPropertyValue("--accent")).toBe(THEMES.midnight.accent);
    expect(localStorage.getItem("degen-react-theme")).toBe("midnight");
  });

  it("restores valid custom colors without applying unrelated or invalid saved values", () => {
    localStorage.setItem("degen-react-theme", "ocean");
    localStorage.setItem("degen-react-custom", JSON.stringify({
      accent: "#ad45de", fg: 123, opacity: "0", panel: "invalid",
    }));
    render(<ThemeControls />);
    const root = document.documentElement;
    expect(root.style.getPropertyValue("--accent")).toBe("#ad45de");
    expect(root.style.getPropertyValue("--fg")).toBe(THEMES.ocean.fg);
    expect(root.style.getPropertyValue("--panel")).toBe(THEMES.ocean.panel);
    expect(root.style.getPropertyValue("--opacity")).toBe("");
  });

  it("choosing a preset replaces custom colors and background even for the same preset", async () => {
    const user = userEvent.setup();
    localStorage.setItem("degen-react-theme", "ocean");
    localStorage.setItem("degen-react-custom", JSON.stringify({ accent: "#ad45de" }));
    localStorage.setItem("degen-react-background", JSON.stringify({ pattern: "dots", frosted: true }));
    render(<ThemeControls />);
    await user.click(screen.getByRole("button", { name: /Theme/ }));
    const ocean = screen.getByRole("button", { name: "Ocean" });
    expect(ocean).toHaveAttribute("aria-pressed", "false");
    await user.click(ocean);
    expect(document.documentElement.style.getPropertyValue("--accent")).toBe(THEMES.ocean.accent);
    expect(ocean).toHaveAttribute("aria-pressed", "true");
    expect(localStorage.getItem("degen-react-custom")).toBeNull();
    expect(localStorage.getItem("degen-react-background")).toBeNull();
    expect(applyBackground).toHaveBeenLastCalledWith(backgroundDefaults("ocean"), false);
  });

  it("applies custom colors immediately and preserves them when reopened", async () => {
    const user = userEvent.setup();
    const first = render(<ThemeControls />);
    await user.click(screen.getByRole("button", { name: /Theme/ }));
    await user.click(screen.getByRole("button", { name: /Customize/ }));
    fireEvent.change(screen.getByLabelText("Accent"), { target: { value: "#aabbcc" } });
    await user.click(screen.getByRole("button", { name: "Apply Custom Theme" }));
    expect(document.documentElement.style.getPropertyValue("--accent")).toBe("#aabbcc");
    first.unmount();
    document.documentElement.style.removeProperty("--accent");
    render(<ThemeControls />);
    expect(document.documentElement.style.getPropertyValue("--accent")).toBe("#aabbcc");
  });

  it("moves focus into the picker and returns it when Escape closes it", async () => {
    const user = userEvent.setup();
    render(<ThemeControls />);
    const trigger = screen.getByRole("button", { name: /Theme/ });
    await user.click(trigger);
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("dialog", { name: "Theme picker" })).toHaveFocus();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog", { name: "Theme picker" })).not.toBeInTheDocument();
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(trigger).toHaveFocus();
  });

  it("lets users change presets when browser storage is unavailable", async () => {
    const user = userEvent.setup();
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("Storage disabled"); });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("Storage disabled"); });
    vi.spyOn(Storage.prototype, "removeItem").mockImplementation(() => { throw new Error("Storage disabled"); });
    render(<ThemeControls />);
    await user.click(screen.getByRole("button", { name: /Theme/ }));
    await user.click(screen.getByRole("button", { name: "Ocean" }));
    expect(document.documentElement.style.getPropertyValue("--accent")).toBe(THEMES.ocean.accent);
  });

  it("shows OINK's new and classic collections without changing the saved theme", async () => {
    const user = userEvent.setup();
    localStorage.setItem("degen-react-theme", "ocean");
    render(<ThemeControls />);
    await user.click(screen.getByRole("button", { name: "Theme", exact: true }));
    const newColors = within(screen.getByRole("region", { name: "New colors" }));
    expect(newColors.getAllByRole("button").map(button => button.textContent)).toEqual([
      "Obsidian", "Aurora", "Amethyst", "Sunset", "Gold", "Glacier", "Matcha", "Cherry", "Slate",
    ]);
    const classics = within(screen.getByRole("region", { name: "Classic themes" }));
    expect(classics.getAllByRole("button")).toHaveLength(17);
    expect(classics.getAllByRole("button")[0]).toHaveTextContent("Oink");
    expect(classics.getByRole("button", { name: "Ocean" })).toHaveAttribute("aria-pressed", "true");
    expect(localStorage.getItem("degen-react-theme")).toBe("ocean");
  });

  it("persists a new palette with matching custom hex values and background settings", async () => {
    const user = userEvent.setup();
    const first = render(<ThemeControls />);
    await user.click(screen.getByRole("button", { name: "Theme", exact: true }));
    await user.click(screen.getByRole("button", { name: "Obsidian", exact: true }));
    expect(localStorage.getItem("degen-react-theme")).toBe("obsidian");
    expect(document.documentElement.style.getPropertyValue("--accent")).toBe("#f5b331");
    await user.click(screen.getByRole("button", { name: "Customize", exact: true }));
    expect(screen.getByLabelText("Background")).toHaveValue("#09090f");
    expect(screen.getByLabelText("Text")).toHaveValue("#f4f4f5");
    expect(screen.getByLabelText("Panel")).toHaveValue("#131318");
    expect(screen.getByLabelText("Border")).toHaveValue("#34333d");
    expect(screen.getByText("#f5b331")).toBeVisible();
    expect(screen.getByLabelText("Animation")).toHaveValue("starlight");
    expect(screen.getByLabelText("Intensity")).toHaveValue("60");
    await user.selectOptions(screen.getByLabelText("Animation"), "dots");
    first.unmount();
    render(<ThemeControls />);
    await user.click(screen.getByRole("button", { name: "Theme", exact: true }));
    expect(screen.getByRole("button", { name: "Obsidian", exact: true })).toHaveAttribute("aria-pressed", "true");
    await user.click(screen.getByRole("button", { name: "Customize", exact: true }));
    expect(screen.getByLabelText("Animation")).toHaveValue("dots");
    expect(screen.getByLabelText("Background")).toHaveValue("#09090f");
  });
});

describe("saved background preferences", () => {
  it("preserves old percentage settings and normalizes invalid fields to preset defaults", () => {
    localStorage.setItem("degen-react-background", JSON.stringify({
      animation: "flow", intensity: 75, size: 125, effectColor: 123, frosted: "false",
    }));
    expect(readBackground("ocean")).toEqual({
      ...backgroundDefaults("ocean"), pattern: "perlin-flow", intensity: .75, size: 1.25,
    });
    localStorage.setItem("degen-react-background", "[]");
    expect(readBackground("ocean")).toEqual(backgroundDefaults("ocean"));
    expect(localStorage.getItem("degen-react-background")).toBeNull();
  });
});
