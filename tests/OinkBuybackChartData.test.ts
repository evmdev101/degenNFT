import { describe, expect, it } from "vitest";
import type { BuybackSnapshot } from "../src/features/dashboard/buybackData";
import { buybackChartSeries, type BuybackChartRange } from "../src/features/dashboard/buybackChartData";

const HOUR = 3_600;
const DAY = 24 * HOUR;
const unit = 10n ** 18n;
const timestamp = (value: string) => Date.parse(value) / 1_000;
function snapshot(to: number, values: [number, bigint][]): BuybackSnapshot {
  return { block: 100, hash: `0x${"1".repeat(64)}`, timestamp: to, totalOinkRaw: 0n, totalSpentRaw: 0n,
    rows: values.map(([time, raw], index) => ({ address: `0x${"1".repeat(40)}`, key: String(index), tx: `0x${index.toString(16).padStart(64, "0")}`,
      block: index, blockHash: `0x${"1".repeat(64)}`, index, timestamp: time, oinkRaw: raw, spentRaw: 0n })) };
}

describe("OINK buyback activity chart series", () => {
  it.each([
    ["24H", DAY, HOUR, 24],
    ["7D", 7 * DAY, 6 * HOUR, 28],
    ["30D", 30 * DAY, DAY, 30],
  ] as const)("keeps %s totals precise and includes its exact cutoff once", (range, seconds, step, bins) => {
    const to = timestamp("2026-10-31T19:17:34Z");
    const data = snapshot(to, [[to - seconds - 1, 99n * unit], [to - seconds, unit + 7n], [to - seconds + step, 2n * unit + 3n], [to, 3n * unit + 1n], [to + 1, 77n * unit]]);
    const series = buybackChartSeries(data, range);
    expect(series.points).toHaveLength(bins);
    expect(series.from).toBe(to - seconds);
    expect(series.to).toBe(to);
    expect(series.count).toBe(3);
    expect(series.totalRaw).toBe(6n * unit + 11n);
    expect(series.points[0]).toEqual({ timestamp: to - seconds + step, oinkRaw: unit + 7n, count: 1 });
    expect(series.points[1].oinkRaw).toBe(2n * unit + 3n);
    expect(series.points.at(-1)).toEqual({ timestamp: to, oinkRaw: 3n * unit + 1n, count: 1 });
    expect(series.points.reduce((sum, point) => sum + point.oinkRaw, 0n)).toBe(series.totalRaw);
  });

  it("combines purchases within an interval and leaves empty intervals as genuine zeros", () => {
    const to = timestamp("2026-10-31T19:00:00Z");
    const series = buybackChartSeries(snapshot(to, [[to - 15 * 60, 5n], [to - 50 * 60, 7n], [to - 4 * HOUR, 11n]]), "24H");
    expect(series.points.at(-1)).toEqual({ timestamp: to, oinkRaw: 12n, count: 2 });
    expect(series.points.slice(0, 20).every(point => point.oinkRaw === 0n && point.count === 0)).toBe(true);
    expect(series.totalRaw).toBe(23n);
    expect(series.count).toBe(3);
  });

  it("uses UTC calendar months across years and includes the oldest recorded purchase in All", () => {
    const to = timestamp("2026-02-15T10:15:00Z");
    const data = snapshot(to, [
      [timestamp("2025-11-30T23:59:59Z"), 1n],
      [timestamp("2025-12-01T00:00:00Z"), 2n],
      [timestamp("2025-12-31T23:59:59Z"), 3n],
      [to, 4n], [to + 1, 100n],
    ]);
    const series = buybackChartSeries(data, "ALL");
    expect(series.from).toBe(timestamp("2025-11-01T00:00:00Z"));
    expect(series.points).toEqual([
      { timestamp: timestamp("2025-12-01T00:00:00Z"), oinkRaw: 1n, count: 1 },
      { timestamp: timestamp("2026-01-01T00:00:00Z"), oinkRaw: 5n, count: 2 },
      { timestamp: timestamp("2026-02-01T00:00:00Z"), oinkRaw: 0n, count: 0 },
      { timestamp: to, oinkRaw: 4n, count: 1 },
    ]);
    expect(series.totalRaw).toBe(10n);
    expect(series.count).toBe(4);
  });

  it.each(["24H", "7D", "30D", "ALL"] as BuybackChartRange[])("returns a zero series without inventing purchases in %s", range => {
    const to = timestamp("2026-10-31T19:00:00Z");
    const series = buybackChartSeries(snapshot(to, [[to + 1, 100n]]), range);
    expect(series.totalRaw).toBe(0n);
    expect(series.count).toBe(0);
    expect(series.points.length).toBeGreaterThan(0);
    expect(series.points.every(point => point.oinkRaw === 0n && point.count === 0)).toBe(true);
    expect(series.points.at(-1)?.timestamp).toBe(to);
  });
});
