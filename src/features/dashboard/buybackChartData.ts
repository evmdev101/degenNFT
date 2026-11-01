import type { BuybackSnapshot } from "./buybackData";

export type BuybackChartRange = "24H" | "7D" | "30D" | "ALL";
export type BuybackChartPoint = { timestamp: number; oinkRaw: bigint; count: number };
export type BuybackChartSeries = { points: BuybackChartPoint[]; totalRaw: bigint; count: number; from: number; to: number };

const HOUR = 3_600;
const WINDOWS = {
  "24H": { seconds: 24 * HOUR, step: HOUR, bins: 24 },
  "7D": { seconds: 7 * 24 * HOUR, step: 6 * HOUR, bins: 28 },
  "30D": { seconds: 30 * 24 * HOUR, step: 24 * HOUR, bins: 30 },
} as const;

/** Each point is a bucket total, located at the bucket's end. The final bucket
 * ends at the snapshot block time. Range cutoffs include a purchase exactly on
 * the boundary, as the overview's recent totals do. */
export function buybackChartSeries(snapshot: BuybackSnapshot, range: BuybackChartRange): BuybackChartSeries {
  const to = snapshot.timestamp;
  const eligible = snapshot.rows.filter(row => row.timestamp <= to);
  let from: number;
  let points: BuybackChartPoint[];
  let indexOf: (timestamp: number) => number;

  if (range === "ALL") {
    const earliest = eligible.reduce((minimum, row) => Math.min(minimum, row.timestamp), to);
    const first = new Date(earliest * 1_000);
    const last = new Date(to * 1_000);
    const firstMonth = first.getUTCFullYear() * 12 + first.getUTCMonth();
    const lastMonth = last.getUTCFullYear() * 12 + last.getUTCMonth();
    from = Date.UTC(first.getUTCFullYear(), first.getUTCMonth(), 1) / 1_000;
    points = Array.from({ length: lastMonth - firstMonth + 1 }, (_, index) => {
      const month = firstMonth + index;
      return { timestamp: Math.min(to, Date.UTC(Math.floor(month / 12), month % 12 + 1, 1) / 1_000), oinkRaw: 0n, count: 0 };
    });
    indexOf = timestamp => {
      const date = new Date(timestamp * 1_000);
      return date.getUTCFullYear() * 12 + date.getUTCMonth() - firstMonth;
    };
  } else {
    const window = WINDOWS[range];
    from = to - window.seconds;
    points = Array.from({ length: window.bins }, (_, index) => ({ timestamp: from + (index + 1) * window.step, oinkRaw: 0n, count: 0 }));
    indexOf = timestamp => Math.min(window.bins - 1, Math.floor((timestamp - from) / window.step));
  }

  let totalRaw = 0n;
  let count = 0;
  for (const row of eligible) {
    if (row.timestamp < from) continue;
    const point = points[indexOf(row.timestamp)];
    point.oinkRaw += row.oinkRaw;
    point.count++;
    totalRaw += row.oinkRaw;
    count++;
  }
  return { points, totalRaw, count, from, to };
}
