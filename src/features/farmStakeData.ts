export type StakeInfo = {
  amount: bigint;
  debt: bigint;
  feesPaid: bigint;
  lastAction: bigint;
};

export type FarmStake = {
  id: bigint;
  info: StakeInfo | null;
  rewardsRaw: bigint | null;
};

type StakeReader = {
  userInfo: (address: string, id: bigint) => Promise<StakeInfo>;
  viewStakeEarnings: (address: string, id: bigint) => Promise<bigint>;
};

function normalizeInfo(info: StakeInfo): StakeInfo {
  return {
    amount: BigInt(info.amount),
    debt: BigInt(info.debt),
    feesPaid: BigInt(info.feesPaid),
    lastAction: BigInt(info.lastAction),
  };
}

export async function readFarmStakes(reader: StakeReader, address: string, count: number) {
  const stakes: FarmStake[] = [];
  // Bound concurrent RPC reads without silently dropping stakes after the first 20.
  for (let start = 0; start < count; start += 4) {
    const batch = await Promise.all(
      Array.from({ length: Math.min(4, count - start) }, async (_, offset) => {
        const id = BigInt(start + offset);
        const [info, rewards] = await Promise.allSettled([
          reader.userInfo(address, id).then(normalizeInfo),
          reader.viewStakeEarnings(address, id).then(BigInt),
        ]);
        return {
          id,
          info: info.status === "fulfilled" ? info.value : null,
          rewardsRaw: rewards.status === "fulfilled" ? rewards.value : null,
        };
      }),
    );
    stakes.push(...batch);
  }
  return stakes;
}

export function summarizeFarmStakes(stakes: FarmStake[]) {
  return {
    totalRaw: stakes.every((s) => s.info !== null)
      ? stakes.reduce((total, s) => total + s.info!.amount, 0n) : null,
    rewardsRaw: stakes.every((s) => s.rewardsRaw !== null)
      ? stakes.reduce((total, s) => total + s.rewardsRaw!, 0n) : null,
    claimableIds: stakes.filter((s) => s.rewardsRaw !== null && s.rewardsRaw > 0n).map((s) => s.id),
  };
}

export function farmStakeCountLabel(counts: (number | null)[]) {
  if (counts.some((count) => count === null)) return "Stake counts unavailable";
  const farms = counts.filter((count) => count! > 0).length;
  const stakes = counts.reduce<number>((total, count) => total + count!, 0);
  return `${farms} farm${farms === 1 ? "" : "s"} · ${stakes} stake${stakes === 1 ? "" : "s"}`;
}

export class StakeChangedError extends Error {
  constructor() {
    super("Your stakes changed. Select the updated stake again.");
  }
}

export async function withdrawSelectedStake<T>(
  vault: {
    getNrOfStakes: (address: string) => Promise<bigint>;
    userInfo: (address: string, id: bigint) => Promise<StakeInfo>;
    withdraw: (id: bigint) => Promise<T>;
  },
  address: string,
  selected: FarmStake,
) {
  if (!selected.info) throw new Error("Stake details are temporarily unavailable.");
  const count = await vault.getNrOfStakes(address);
  if (selected.id < 0n || selected.id >= count) throw new StakeChangedError();
  const current = normalizeInfo(await vault.userInfo(address, selected.id));
  // Vault withdrawals remove/reindex entries, so never trust a cached index alone.
  if (Object.keys(current).some((key) => current[key as keyof StakeInfo] !== selected.info![key as keyof StakeInfo])) {
    throw new StakeChangedError();
  }
  return vault.withdraw(selected.id);
}
