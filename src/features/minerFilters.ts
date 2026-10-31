export type MinerFilterRecord = {
  poolAddr: string;
  stakeId: number;
  poolDur: number;
  served: number;
  progressPct: number;
  amount: number;
  amountRaw: bigint;
  gracePeriod: number | null;
  timingKnown: boolean;
};

export type MinerStatus = "locked" | "mature" | "overdue" | "unknown";
export type MinerFilters = {
  search: string;
  duration: string;
  status: "all" | MinerStatus;
  sort: "progress-desc" | "value-desc" | "duration-asc" | "duration-desc";
};

/** Window status is descriptive only; transaction eligibility must be rechecked. */
export function minerStatus(miner: MinerFilterRecord): MinerStatus {
  if (!miner.timingKnown || miner.gracePeriod === null
    || !Number.isFinite(miner.gracePeriod) || miner.gracePeriod < 0
    || !Number.isFinite(miner.poolDur) || miner.poolDur <= 0
    || !Number.isFinite(miner.served) || miner.served < 0) return "unknown";
  if (miner.served < miner.poolDur) return "locked";
  return miner.served <= miner.poolDur + miner.gracePeriod ? "mature" : "overdue";
}

export function graceEndingSoon(miner: MinerFilterRecord): boolean {
  return minerStatus(miner) === "mature"
    && miner.poolDur + miner.gracePeriod! - miner.served <= 48 * 60 * 60;
}

export function minerDurationLabel(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return "Unknown duration";
  const year = 31536000, month = 2592000, day = 86400;
  const unit = seconds % year === 0 ? "year" : seconds % month === 0 ? "month" : "day";
  const count = seconds / (unit === "year" ? year : unit === "month" ? month : day);
  const label = Number.isInteger(count) ? String(count) : String(Number(count.toFixed(2)));
  return `${label} ${unit}${count === 1 ? "" : "s"}`;
}

function identityOrder(a: MinerFilterRecord, b: MinerFilterRecord): number {
  const left = a.poolAddr.toLowerCase(), right = b.poolAddr.toLowerCase();
  return (left < right ? -1 : left > right ? 1 : 0) || a.stakeId - b.stakeId;
}

/** Search, filter and sort the complete loaded collection without changing it. */
export function filterMiners<T extends MinerFilterRecord>(miners: readonly T[], filters: MinerFilters): T[] {
  const search = filters.search.trim().toLowerCase().replace(/\s+/g, "");
  const duration = filters.duration.toLowerCase();
  return miners.filter(miner => {
    if (duration !== "all" && miner.poolAddr.toLowerCase() !== duration) return false;
    if (filters.status !== "all" && minerStatus(miner) !== filters.status) return false;
    if (!search) return true;
    return [minerDurationLabel(miner.poolDur), `#${miner.stakeId}`, miner.poolAddr]
      .some(value => value.toLowerCase().replace(/\s+/g, "").includes(search));
  }).sort((a, b) => {
    let order = 0;
    switch (filters.sort) {
      case "progress-desc":
        order = b.progressPct - a.progressPct || (a.poolDur - a.served) - (b.poolDur - b.served);
        break;
      case "value-desc":
        order = a.amountRaw > b.amountRaw ? -1 : a.amountRaw < b.amountRaw ? 1 : 0;
        break;
      case "duration-asc": order = a.poolDur - b.poolDur; break;
      case "duration-desc": order = b.poolDur - a.poolDur; break;
    }
    return order || identityOrder(a, b);
  });
}
