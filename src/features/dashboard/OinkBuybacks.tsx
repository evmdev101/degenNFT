import { formatUnits } from "ethers";
import { useState } from "react";
import { TOKEN_LOGOS } from "../../config/tokenLogos";
import { useQuietRead } from "../../hooks/useQuietRead";
import { aggregateBuybacks, OINK_BUYBACK_ADDRESSES, readPublicBuybacks } from "./buybackData";
import { dashboardAmount, dashboardUsd } from "./format";
import { useDashboardClock } from "./freshness";
import { BuybackActivityChart } from "./BuybackActivityChart";
import "./buybacks.css";

const DAY = 86_400;
function compact(raw: bigint | null | undefined) {
  if (raw == null) return "—";
  const value = Number(formatUnits(raw, 18));
  if (!Number.isFinite(value)) return "—";
  if (value > 0 && value < .001) return "<0.001";
  return new Intl.NumberFormat(undefined, { notation: "compact", maximumFractionDigits: 2 }).format(value);
}
function currentValue(raw: bigint | null | undefined, price: number | null | undefined) {
  if (raw == null) return null;
  if (raw === 0n) return 0;
  if (price == null || !Number.isFinite(price) || price <= 0) return null;
  return Number(formatUnits(raw, 18)) * price;
}
function age(timestamp: number, now: number) {
  const seconds = Math.max(0, Math.floor(now / 1000) - timestamp);
  if (seconds < 60) return "Just now";
  const days = Math.floor(seconds / DAY);
  const [value, unit] = seconds < 3600 ? [Math.floor(seconds / 60), "minute"]
    : days < 1 ? [Math.floor(seconds / 3600), "hour"]
    : days < 31 ? [days, "day"]
    : days < 365 ? [Math.floor(days / 30), "month"] : [Math.floor(days / 365), "year"];
  return new Intl.RelativeTimeFormat(undefined, { numeric: "always" }).format(-Number(value), unit as Intl.RelativeTimeFormatUnit);
}

export function OinkBuybacks({ treasuryOinkRaw, oinkPriceUsd }: { treasuryOinkRaw?: bigint | null; oinkPriceUsd?: number | null }) {
  const { data, error } = useQuietRead("dashboard:buybacks:369", readPublicBuybacks, 60_000);
  const [limit, setLimit] = useState(5);
  const now = useDashboardClock();
  const all = data ? aggregateBuybacks(data) : null;
  const latest = data?.rows[0];
  return <section className="dash-card oink-buybacks" aria-labelledby="oink-buybacks-heading">
    <header className="buyback-heading">
      <div className="buyback-title"><img src={TOKEN_LOGOS.OINK} alt="" width="42" height="42" /><div><span className="buyback-kicker">DEGEN → OINK</span><h2 id="oink-buybacks-heading">OINK buybacks</h2></div></div>
      <details className="buyback-contracts"><summary>Buyback contracts</summary><div>{OINK_BUYBACK_ADDRESSES.map((address, index) => <a key={address} href={`https://scan.pulsechain.com/address/${address}`} target="_blank" rel="noreferrer">Contract {index + 1} <span>{address.slice(0, 6)}…{address.slice(-4)} ↗</span></a>)}</div></details>
    </header>
    <p className="buyback-intro">DEGEN buys OINK and builds the treasury’s OINK reserves. Follow purchases across verified buyback contracts.</p>
    <div className="buyback-stats" aria-label="OINK buyback statistics">
      <div><span>Recorded OINK bought</span><strong>{compact(all?.oinkRaw)} <small>OINK</small></strong><small>Current value: {dashboardUsd(currentValue(all?.oinkRaw, oinkPriceUsd))}</small></div>
      <div><span>Recorded PLS spent</span><strong>{compact(all?.spentRaw)} <small>PLS</small></strong><small>Paid in wrapped PLS</small></div>
      <div><span>Buybacks recorded</span><strong>{all ? all.count.toLocaleString() : "—"}</strong><small>{latest ? `Latest ${age(latest.timestamp, now)}` : data ? "No purchases recorded" : "—"}</small></div>
      <div><span>OINK held in treasury</span><strong>{compact(treasuryOinkRaw)} <small>OINK</small></strong><small>Current value: {dashboardUsd(currentValue(treasuryOinkRaw, oinkPriceUsd))}</small></div>
    </div>
    <div className="buyback-windows" aria-label="Recent buyback totals">
      {([ ["24 hours", DAY], ["7 days", 7 * DAY], ["30 days", 30 * DAY] ] as const).map(([label, seconds]) => {
        const total = data ? aggregateBuybacks(data, seconds) : null;
        return <div key={label}><span>{label}</span><strong>{compact(total?.oinkRaw)} <small>OINK bought</small></strong><small>{total ? `${total.count.toLocaleString()} buyback${total.count === 1 ? "" : "s"}` : "—"}</small></div>;
      })}
    </div>
    {error && !data && <p className="dash-data-error" role="status">Buyback history is unavailable.</p>}
    {data && <div className="buyback-history-layout">
      <BuybackActivityChart snapshot={data} />
      <div className="buyback-history">
        <h3>Recent buybacks</h3>
        {data.rows.length === 0 && <p className="dash-data-note">No buybacks recorded.</p>}
        <div className="buyback-list" id="oink-buyback-history" role="region" aria-label="Recent buyback history" tabIndex={0}>
          {data.rows.slice(0, limit).map(row => <a href={`https://scan.pulsechain.com/tx/${row.tx}`} target="_blank" rel="noreferrer" className="buyback-row" key={row.key}>
            <span><strong>{dashboardAmount(row.oinkRaw)} OINK</strong><small>{dashboardAmount(row.spentRaw)} PLS spent</small></span>
            <span className="buyback-time"><time dateTime={new Date(row.timestamp * 1000).toISOString()}>{age(row.timestamp, now)}</time><span aria-hidden="true">↗</span></span>
          </a>)}
        </div>
        {limit < data.rows.length && <button className="dash-secondary-button buyback-show-more" type="button" aria-controls="oink-buyback-history" onClick={() => setLimit(previous => previous + 5)}>Show more buybacks</button>}
      </div>
    </div>}
  </section>;
}
