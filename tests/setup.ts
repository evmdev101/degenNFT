import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { clearQuietReadCache } from "../src/hooks/useQuietRead";
import { afterEach } from "vitest";

afterEach(() => {
  cleanup();
  clearQuietReadCache();
  localStorage.clear();
});
