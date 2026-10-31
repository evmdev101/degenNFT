import { useEffect, useRef } from "react";
import { usePageActive } from "../hooks/usePageActive";
import { formatUnits } from "ethers";
import type { FarmStake } from "./farmStakeData";

function amount(raw: bigint, decimals: number) {
  return Number(formatUnits(raw, decimals)).toLocaleString(undefined, {
    maximumFractionDigits: 6,
  });
}

export function FarmStakes({ stakes, count, decimals, open, busy, onToggle, onWithdraw, onRefresh }: {
  stakes: FarmStake[];
  count: number | null;
  decimals: number;
  open: boolean;
  busy: boolean;
  onToggle: () => void;
  onWithdraw: (stake: FarmStake) => void;
  onRefresh: () => void;
}) {
  const pageActive = usePageActive();
  const refreshRef = useRef(onRefresh);
  refreshRef.current = onRefresh;
  const incomplete = count === null || stakes.length !== count || stakes.some((s) => !s.info || s.rewardsRaw === null);
  useEffect(() => {
    if (!open || !incomplete || busy || !pageActive) return;
    const timer = setInterval(() => { if (!document.hidden) refreshRef.current(); }, 15_000);
    return () => clearInterval(timer);
  }, [open, incomplete, busy, pageActive]);
  return (
    <section className="farm-stakes">
      <div className="farm-stakes-header">
      <button className="farm-stakes-toggle" type="button" aria-expanded={open} onClick={onToggle}>
        <span>Your Stakes{count !== null ? ` (${count})` : ""}</span>
        <span aria-hidden="true">{open ? "−" : "+"}</span>
      </button>
      </div>
      {open && (
        <div className="farm-stakes-list">
          {count === 0 && <p className="farm-stakes-empty">No active stakes</p>}
          {stakes.map((stake) => (
            <div className="farm-stake-row" key={stake.id.toString()}>
              <div className="farm-stake-heading">Stake #{stake.id.toString()}</div>
              <dl className="farm-stake-values">
                <div><dt>Staked</dt><dd>
                  {stake.info ? `${amount(stake.info.amount, decimals)} LP` : "Unavailable"}
                </dd></div>
                <div><dt>Rewards</dt><dd>
                  {stake.rewardsRaw !== null ? `${amount(stake.rewardsRaw, 18)} DEGEN` : "Unavailable"}
                </dd></div>
              </dl>
              <button className="farm-stake-withdraw" type="button" disabled={busy || !stake.info}
                aria-label={`Withdraw This Stake #${stake.id}`} onClick={() => onWithdraw(stake)}>
                Withdraw This Stake
              </button>
            </div>
          ))}
          {incomplete && <div className="farm-stakes-retry">
            <span>Some stake details are unavailable</span>
          </div>}
        </div>
      )}
    </section>
  );
}
