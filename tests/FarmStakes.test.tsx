import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { FarmStakes } from "../src/features/FarmStakes";
import {
  farmStakeCountLabel, readFarmStakes, StakeChangedError, summarizeFarmStakes,
  withdrawSelectedStake, type FarmStake, type StakeInfo,
} from "../src/features/farmStakeData";

const info = (amount = 10n ** 18n): StakeInfo => ({ amount, debt: 7n, feesPaid: 0n, lastAction: 100n });
const stake = (id = 0n): FarmStake => ({ id, info: info(), rewardsRaw: 2n * 10n ** 18n });

describe("individual farm stakes", () => {
  it("reads every stake beyond 20, in ordered bounded batches", async () => {
    let running = 0;
    let maxRunning = 0;
    const userInfo = vi.fn(async () => {
      running++;
      maxRunning = Math.max(maxRunning, running);
      await Promise.resolve();
      running--;
      return info();
    });
    const stakes = await readFarmStakes({ userInfo, viewStakeEarnings: vi.fn(async () => 1n) }, "wallet", 25);
    expect(stakes).toHaveLength(25);
    expect(stakes.map((s) => s.id)).toEqual(Array.from({ length: 25 }, (_, i) => BigInt(i)));
    expect(maxRunning).toBeLessThanOrEqual(4);
    expect(summarizeFarmStakes(stakes).totalRaw).toBe(25n * 10n ** 18n);
    expect(summarizeFarmStakes(stakes).claimableIds).toHaveLength(25);
  });

  it("preserves unknown reads rather than summing a partial balance as complete", async () => {
    const stakes = await readFarmStakes({
      userInfo: async (_, id) => { if (id === 1n) throw new Error("RPC"); return info(); },
      viewStakeEarnings: async (_, id) => { if (id === 0n) throw new Error("RPC"); return 0n; },
    }, "wallet", 2);
    expect(stakes[1].info).toBeNull();
    expect(stakes[0].rewardsRaw).toBeNull();
    expect(summarizeFarmStakes(stakes)).toEqual({ totalRaw: null, rewardsRaw: null, claimableIds: [] });
  });

  it("counts actual stakes, including farms whose rewards are zero", () => {
    expect(farmStakeCountLabel([0, 2, 0])).toBe("1 farm · 2 stakes");
    expect(farmStakeCountLabel([1, 3])).toBe("2 farms · 4 stakes");
    expect(farmStakeCountLabel([1])).toBe("1 farm · 1 stake");
    expect(farmStakeCountLabel([0])).toBe("0 farms · 0 stakes");
    expect(farmStakeCountLabel([null, 2])).toBe("Stake counts unavailable");
  });

  it("submits exactly one withdrawal for the selected on-chain ID", async () => {
    const tx = { wait: vi.fn() };
    const vault = {
      getNrOfStakes: vi.fn(async () => 3n), userInfo: vi.fn(async () => info()),
      withdraw: vi.fn(async () => tx),
    };
    expect(await withdrawSelectedStake(vault, "wallet", stake(1n))).toBe(tx);
    expect(vault.userInfo).toHaveBeenCalledWith("wallet", 1n);
    expect(vault.withdraw).toHaveBeenCalledExactlyOnceWith(1n);
  });

  it("refuses stale or missing IDs and does not request a signature", async () => {
    const vault = {
      getNrOfStakes: vi.fn(async () => 1n), userInfo: vi.fn(async () => info(3n)),
      withdraw: vi.fn(),
    };
    await expect(withdrawSelectedStake(vault, "wallet", stake(1n))).rejects.toBeInstanceOf(StakeChangedError);
    await expect(withdrawSelectedStake(vault, "wallet", stake())).rejects.toBeInstanceOf(StakeChangedError);
    await expect(withdrawSelectedStake(vault, "wallet", { ...stake(), info: null })).rejects.toThrow("unavailable");
    expect(vault.withdraw).not.toHaveBeenCalled();
  });

  it("also checks the stake fingerprint when two amounts match", async () => {
    const vault = {
      getNrOfStakes: async () => 2n,
      userInfo: async () => ({ ...info(), lastAction: 101n }), withdraw: vi.fn(),
    };
    await expect(withdrawSelectedStake(vault, "wallet", stake())).rejects.toBeInstanceOf(StakeChangedError);
    expect(vault.withdraw).not.toHaveBeenCalled();
  });

  it("fails closed when the preflight RPC read fails", async () => {
    const vault = {
      getNrOfStakes: async () => 2n,
      userInfo: async () => { throw new Error("RPC unavailable"); }, withdraw: vi.fn(),
    };
    await expect(withdrawSelectedStake(vault, "wallet", stake())).rejects.toThrow("RPC unavailable");
    expect(vault.withdraw).not.toHaveBeenCalled();
  });

  it("lists amounts and rewards separately and selects the right row", () => {
    const onWithdraw = vi.fn();
    const onToggle = vi.fn();
    render(<FarmStakes stakes={[stake(), stake(1n)]} count={2} decimals={18} open busy={false}
      onToggle={onToggle} onWithdraw={onWithdraw} onRefresh={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Your Stakes (2)" })).toHaveAttribute("aria-expanded", "true");
    expect(screen.getAllByText("1 LP")).toHaveLength(2);
    expect(screen.getAllByText("2 DEGEN")).toHaveLength(2);
    fireEvent.click(screen.getByRole("button", { name: "Withdraw This Stake #1" }));
    expect(onWithdraw).toHaveBeenCalledExactlyOnceWith(stake(1n));
    fireEvent.click(screen.getByRole("button", { name: "Your Stakes (2)" }));
    expect(onToggle).toHaveBeenCalledOnce();
  });

  it("disables withdrawals while busy and automatically retries unknown amounts", () => {
    const onRefresh = vi.fn();
    const { rerender } = render(<FarmStakes stakes={[stake()]} count={1} decimals={18} open busy
      onToggle={vi.fn()} onWithdraw={vi.fn()} onRefresh={onRefresh} />);
    expect(screen.getByRole("button", { name: "Withdraw This Stake #0" })).toBeDisabled();
    rerender(<FarmStakes stakes={[{ ...stake(), info: null, rewardsRaw: null }]} count={1} decimals={18} open busy={false}
      onToggle={vi.fn()} onWithdraw={vi.fn()} onRefresh={onRefresh} />);
    expect(screen.getByRole("button", { name: "Withdraw This Stake #0" })).toBeDisabled();
    expect(screen.getAllByText("Unavailable")).toHaveLength(2);
    expect(screen.queryByRole("button", { name: "Refresh" })).not.toBeInTheDocument();
  });

  it("keeps a collapsed list out of the DOM and shows an explicit empty state", () => {
    const props = { stakes: [], count: 0, decimals: 18, busy: false, onToggle: vi.fn(), onWithdraw: vi.fn(), onRefresh: vi.fn() };
    const { rerender } = render(<FarmStakes {...props} open={false} />);
    expect(screen.queryByText("No active stakes")).not.toBeInTheDocument();
    rerender(<FarmStakes {...props} open />);
    expect(screen.getByText("No active stakes")).toBeInTheDocument();
  });
});
