import { describe, expect, it } from "vitest";
import { dashboardSnapshotStale } from "../src/features/dashboard/freshness";
describe("dashboard snapshot freshness", () => {
  it("separates missing, current, stale, and implausibly future snapshots", () => {
    const now = 1_000_000;
    expect(dashboardSnapshotStale(undefined, now)).toBe(false);
    expect(dashboardSnapshotStale(now - 120_000, now)).toBe(false);
    expect(dashboardSnapshotStale(now - 120_001, now)).toBe(true);
    expect(dashboardSnapshotStale(now + 30_001, now)).toBe(true);
    expect(dashboardSnapshotStale(NaN, now)).toBe(true);
  });
});
