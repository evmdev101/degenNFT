import { describe, expect, it } from "vitest";
import { filterMiners, graceEndingSoon, minerDurationLabel, minerStatus, type MinerFilterRecord, type MinerFilters } from "../src/features/minerFilters";

const defaults: MinerFilters = { search: "", duration: "all", status: "all", sort: "progress-desc" };
const miner = (overrides: Partial<MinerFilterRecord> = {}): MinerFilterRecord => ({
  poolAddr: "0xAbC", stakeId: 0, poolDur: 2592000, served: 100,
  progressPct: 1, amount: 1, amountRaw: 10n ** 18n,
  gracePeriod: 86400, timingKnown: true, ...overrides,
});

describe("miner collection filters", () => {
  it("keeps locked, mature and overdue boundary states distinct, including zero grace", () => {
    expect(minerStatus(miner({ served: 2591999 }))).toBe("locked");
    expect(minerStatus(miner({ served: 2592000 }))).toBe("mature");
    expect(minerStatus(miner({ served: 2678400 }))).toBe("mature");
    expect(minerStatus(miner({ served: 2678401 }))).toBe("overdue");
    expect(minerStatus(miner({ served: 2592000, gracePeriod: 0 }))).toBe("mature");
    expect(minerStatus(miner({ served: 2592001, gracePeriod: 0 }))).toBe("overdue");
  });

  it("does not infer a known maturity state from missing or invalid timing", () => {
    for (const value of [miner({ timingKnown: false }), miner({ gracePeriod: null }), miner({ gracePeriod: -1 }), miner({ poolDur: NaN })]) {
      expect(minerStatus(value)).toBe("unknown");
      expect(graceEndingSoon(value)).toBe(false);
    }
  });

  it("counts grace ending soon only while mature and within the inclusive 48-hour threshold", () => {
    const base = miner({ gracePeriod: 259200 });
    expect(graceEndingSoon({ ...base, served: base.poolDur + 86400 - 1 })).toBe(false);
    expect(graceEndingSoon({ ...base, served: base.poolDur + 86400 })).toBe(true);
    expect(graceEndingSoon({ ...base, served: base.poolDur - 1 })).toBe(false);
    expect(graceEndingSoon({ ...base, served: base.poolDur + base.gracePeriod! + 1 })).toBe(false);
  });

  it("combines case-insensitive duration, status and search without losing records", () => {
    const match = miner({ poolDur: 7776000, served: 7776000, stakeId: 12 });
    const others = [miner({ stakeId: 2 }), miner({ poolAddr: "0xDEF", poolDur: 7776000, served: 7776000 })];
    expect(filterMiners([match, ...others], { ...defaults, duration: "0xABC", status: "mature", search: " 3 MONTHS " })).toEqual([match]);
    expect(filterMiners([match, ...others], { ...defaults, search: "#12" })).toEqual([match]);
    expect(filterMiners([match], { ...defaults, search: "0XaBc" })).toEqual([match]);
    expect(filterMiners([match], { ...defaults, search: "no match" })).toEqual([]);
    expect(filterMiners([miner({ poolDur: 315360000 })], { ...defaults, search: "10years" })).toHaveLength(1);
  });

  it("sorts values exactly in wei even when display numbers are identical", () => {
    const lower = miner({ stakeId: 0, amount: 1e15, amountRaw: 10n ** 33n });
    const higher = miner({ stakeId: 1, amount: 1e15, amountRaw: lower.amountRaw + 1n });
    expect(filterMiners([lower, higher], { ...defaults, sort: "value-desc" })).toEqual([higher, lower]);
  });

  it("orders equal progress by maturity time then identity without mutating the collection", () => {
    const later = miner({ poolAddr: "0xZ", stakeId: 2, progressPct: 100, served: 3000000 });
    const earlier = miner({ ...later, served: 4000000 });
    const tie = miner({ ...earlier, poolAddr: "0xA", stakeId: 3 });
    const input = Object.freeze([later, earlier, tie]);
    const result = filterMiners(input, defaults);
    expect(result).toEqual([tie, earlier, later]);
    expect(result[0]).toBe(tie);
    expect(input).toEqual([later, earlier, tie]);
  });

  it("sorts by duration in both directions and labels the supported pool durations", () => {
    const month = miner(), year = miner({ poolDur: 31536000 });
    expect(filterMiners([year, month], { ...defaults, sort: "duration-asc" })).toEqual([month, year]);
    expect(filterMiners([month, year], { ...defaults, sort: "duration-desc" })).toEqual([year, month]);
    expect([2592000, 7776000, 31536000, 315360000].map(minerDurationLabel)).toEqual(["1 month", "3 months", "1 year", "10 years"]);
  });
});
