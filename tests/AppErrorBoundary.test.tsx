import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppErrorBoundary } from "../src/components/AppErrorBoundary";

function BrokenFeature() {
  throw new Error("Test feature failed");
}

describe("AppErrorBoundary", () => {
  let consoleError: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    consoleError.mockRestore();
  });

  it("shows the normal loader without exposing an error screen", () => {
    render(
      <AppErrorBoundary>
        <BrokenFeature />
      </AppErrorBoundary>,
    );

    expect(screen.getByRole("status")).toHaveTextContent("Loading…");
    expect(
      screen.queryByText("The dashboard hit a problem."),
    ).not.toBeInTheDocument();
    expect(screen.queryByText("Test feature failed")).not.toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
});
