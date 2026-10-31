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

  it("shows a concise unavailable state without exposing internal errors", () => {
    render(
      <AppErrorBoundary>
        <BrokenFeature />
      </AppErrorBoundary>,
    );

    expect(screen.getByRole("status")).toHaveTextContent("This page is temporarily unavailable.");
    expect(
      screen.queryByText("The dashboard hit a problem."),
    ).not.toBeInTheDocument();
    expect(screen.queryByText("Test feature failed")).not.toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
});
