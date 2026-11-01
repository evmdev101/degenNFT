import { formatUnits } from "ethers";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { CONTRACTS } from "../config/contracts";
import { useQuietRead } from "../hooks/useQuietRead";
import { usePageActive } from "../hooks/usePageActive";
import { DASHBOARD_ASSETS, FARM_REGISTRY, MINER_POOLS, TREASURY } from "./dashboard/config";
import { aggregateInflows, readPublicOverview, readPublicTreasuryInflows, readPublicOlderTreasuryInflows, type TreasuryInflow, type TreasuryInflows } from "./dashboard/overviewData";
import { dashboardSnapshotStale, useDashboardClock } from "./dashboard/freshness";
import { TreasuryPositions } from "./dashboard/TreasuryFarming";
import { ContractShowcase } from "./dashboard/ContractShowcase";
import { ProtocolInsights } from "./dashboard/ProtocolInsights";
import { RecentActivity } from "./dashboard/RecentActivity";
import { OinkBuybacks } from "./dashboard/OinkBuybacks";

const usd = (value: number | null | undefined) => value == null ? "—" : value > 0 && value < .01 ? "<$0.01" : new Intl.NumberFormat(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 2 }).format(value);
function amount(raw: bigint | null | undefined, decimals = 18, compact = false) {
  if (raw == null) return "—";
  const value = Number(formatUnits(raw, decimals));
  if (!Number.isFinite(value)) return "—";
  if (value > 0 && value < .001) return "<0.001";
  return new Intl.NumberFormat(undefined, compact ? { notation: "compact", maximumFractionDigits: 2 } : { maximumFractionDigits: 3 }).format(value);
}
function age(timestamp: number, now: number) {
  const seconds = Math.max(0, now - timestamp);
  if (seconds < 60) return "Just now";
  const days = Math.floor(seconds / 86400);
  const [value, unit] = seconds < 3600 ? [Math.floor(seconds / 60), "minute"]
    : days < 1 ? [Math.floor(seconds / 3600), "hour"]
    : days < 31 ? [days, "day"]
    : days < 365 ? [Math.floor(days / 30), "month"] : [Math.floor(days / 365), "year"];
  return new Intl.RelativeTimeFormat(undefined, { numeric: "always" }).format(-Number(value), unit as Intl.RelativeTimeFormatUnit);
}
function AssetIcon({ src }: { src: string }) {
  return <img className="dash-token-icon" src={src} alt="" loading="lazy" onLoad={event => { event.currentTarget.style.visibility = "visible"; }} onError={event => { event.currentTarget.style.visibility = "hidden"; }} />;
}

function mergeInflows(...groups: readonly TreasuryInflow[][]): TreasuryInflow[] {
  return [...new Map(groups.flat().map(row => [row.key, row])).values()]
    .sort((a, b) => b.block - a.block || b.index - a.index);
}
type InflowArchive = { anchor: TreasuryInflows; from: number; rows: TreasuryInflow[]; boundaryComplete: boolean };

export function OverviewPage() {
  const treasury = useQuietRead("dashboard:overview:369", readPublicOverview, 60_000);
  const history = useQuietRead("dashboard:treasury-inflows:369", readPublicTreasuryInflows, 120_000);
  const [visibleInflows, setVisibleInflows] = useState(10);
  const [archive, setArchive] = useState<InflowArchive | null>(null);
  const archiveRef = useRef(archive); archiveRef.current = archive;
  const [olderBusy, setOlderBusy] = useState(false);
  const [olderError, setOlderError] = useState("");
  const olderRequest = useRef<AbortController | null>(null);
  const pageActive = usePageActive();
  const snapshot = treasury.data, activity = history.data;
  useEffect(() => {
    if (!activity) return;
    const previous = archiveRef.current;
    if (!previous || activity.from > previous.anchor.to + 1 || activity.to < previous.anchor.to
      || (activity.to === previous.anchor.to && activity.hash !== previous.anchor.hash)) {
      olderRequest.current?.abort();
      setVisibleInflows(10); setOlderError("");
    }
    setArchive(previous => {
      if (!previous || activity.from > previous.anchor.to + 1 || activity.to < previous.anchor.to
        || (activity.to === previous.anchor.to && activity.hash !== previous.anchor.hash)) {
        return { anchor: activity, from: activity.from, rows: activity.rows, boundaryComplete: Boolean(activity.boundaryRowsIncluded) };
      }
      return { anchor: activity, from: Math.min(previous.from, activity.from), boundaryComplete: previous.boundaryComplete || Boolean(activity.boundaryRowsIncluded),
        rows: mergeInflows(previous.rows.filter(row => row.block < activity.from), activity.rows) };
    });
  }, [activity]);
  useEffect(() => {
    if (!pageActive) olderRequest.current?.abort();
    return () => { olderRequest.current?.abort(); };
  }, [pageActive]);
  const inflowRows = useMemo(() => mergeInflows(archive?.rows ?? [], activity?.rows ?? []), [archive, activity]);
  const oldest = archive ?? (activity ? { anchor: activity, from: activity.from, rows: activity.rows, boundaryComplete: Boolean(activity.boundaryRowsIncluded) } : null);
  const allHistoryLoaded = oldest?.from === 0 && oldest.boundaryComplete;
  async function showMoreInflows() {
    if (!activity || !oldest || !pageActive || olderRequest.current) return;
    if (visibleInflows < inflowRows.length) { setVisibleInflows(value => value + 10); return; }
    if (allHistoryLoaded) return;
    const controller = new AbortController();
    olderRequest.current = controller;
    setOlderBusy(true); setOlderError("");
    try {
      const cursor = !oldest.boundaryComplete && oldest.from === oldest.anchor.from ? undefined : oldest.from - 1;
      const page = await readPublicOlderTreasuryInflows(oldest.anchor, cursor, controller.signal);
      if (!controller.signal.aborted) {
        setArchive(previous => previous ? { ...previous, from: Math.min(previous.from, page.from), rows: mergeInflows(previous.rows, page.rows), boundaryComplete: true }
          : { anchor: oldest.anchor, from: page.from, rows: mergeInflows(inflowRows, page.rows), boundaryComplete: true });
        setVisibleInflows(value => Math.max(value, inflowRows.length) + 10);
      }
    } catch {
      if (!controller.signal.aborted) setOlderError("Older inflows could not be loaded.");
    } finally {
      if (olderRequest.current === controller) { olderRequest.current = null; setOlderBusy(false); }
    }
  }
  const now = useDashboardClock();
  const balancesStale = dashboardSnapshotStale(snapshot ? snapshot.timestamp * 1000 : undefined, now);
  const currentPrices = !balancesStale && !treasury.error ? snapshot?.prices ?? {} : {};
  const degen = snapshot?.holdings.find(row => row.asset.address.toLowerCase() === CONTRACTS.degen.toLowerCase());
  const oink = snapshot?.holdings.find(row => row.asset.address.toLowerCase() === CONTRACTS.oink.toLowerCase());
  const pls = snapshot?.holdings.find(row => row.asset.native);
  const metrics = [
    { label: "DEGEN supply", value: amount(snapshot?.supplyRaw, 18, true), detail: "Current total supply" },
    { label: "Treasury DEGEN", value: amount(degen?.raw, degen?.asset.decimals, true), detail: "Listed treasury wallet" },
    { label: "Treasury PLS", value: amount(pls?.raw, pls?.asset.decimals, true), detail: "Listed treasury wallet" },
    { label: "Miner durations", value: String(MINER_POOLS.length), detail: "Listed time-miner contracts", href: "/my-miners?tab=deploy" },
    { label: "Listed farms", value: String(FARM_REGISTRY.length), detail: "Supported ecosystem farms", href: "/farms" },
    { label: "NFT projects", value: "1", detail: "Linked project dashboard", href: "/nft" },
  ];
  return <main className="dashboard-main overview-page">
    <h1 className="sr-only">DEGEN Overview</h1>
    <section className="dash-metrics" aria-label="Protocol statistics">
      {metrics.map(metric => <article className="dash-card dash-metric" key={metric.label}>
        <span className="dash-metric-label">{metric.label}</span>
        <strong>{metric.value}</strong>
        {metric.href ? <Link className="dash-stat-sub" to={metric.href}>{metric.detail}</Link> : <span className="dash-stat-sub">{metric.detail}</span>}
      </article>)}
    </section>
    <OinkBuybacks treasuryOinkRaw={oink?.raw} oinkPriceUsd={currentPrices[CONTRACTS.oink.toLowerCase()]} />
    {treasury.error && !snapshot && <p className="dash-data-error" role="status">Treasury balances are temporarily unavailable.</p>}
    <div className="dash-overview-columns">
      <section className="dash-card dash-inflow-card" aria-labelledby="treasury-inflows-heading">
        <header className="dash-section-heading"><h2 id="treasury-inflows-heading">DEGEN treasury inflows</h2></header>
        <div className="dash-inflow-windows" aria-label="Tracked token inflow totals">
          {([ ["24h", 86400], ["7d", 7 * 86400], ["30d", 30 * 86400] ] as const).map(([label, seconds]) => {
            const total = activity ? aggregateInflows(activity, seconds, currentPrices) : null;
            return <div key={label}><span>{label}</span><strong>{!activity && !history.error ? "Loading…" : usd(total?.usd)}</strong><small>{total ? `${total.count} inflow${total.count === 1 ? "" : "s"}` : history.error ? "Unavailable" : "Reading history"}</small></div>;
          })}
        </div>
        <div id="treasury-inflow-history" className="dash-inflow-list" role="region" aria-label="Treasury inflow history" tabIndex={0} aria-busy={!activity && !history.error}>
        {history.error && !activity && <p className="dash-data-error" role="status">The complete 30-day inflow history is unavailable.</p>}
        {!activity && !history.error && <p className="dash-data-note" role="status">Reading treasury inflows…</p>}
        {activity && inflowRows.length === 0 && <p className="dash-data-note">No tracked token inflows in the last 30 days.</p>}
        {activity && <div className="dash-feed">
          {inflowRows.slice(0, visibleInflows).map(row => <a className="dash-feed-row" href={`https://scan.pulsechain.com/tx/${row.tx}`} key={row.key} target="_blank" rel="noreferrer">
            <span>Treasury received</span>
            <strong><AssetIcon src={row.asset.logo} /><span>{amount(row.raw, row.asset.decimals)} {row.asset.symbol}</span></strong>
            <small>{age(row.timestamp, Math.floor(now / 1000))}</small>
          </a>)}
        </div>}
        </div>
        <div className="dash-inflow-actions">
          {olderError && <p className="dash-data-error" role="alert">{olderError}</p>}
          <button className="dash-show-more" type="button" aria-controls="treasury-inflow-history" aria-busy={olderBusy}
            disabled={!activity || olderBusy || Boolean(allHistoryLoaded && visibleInflows >= inflowRows.length)}
            onClick={() => void showMoreInflows()}>Show more inflows</button>
        </div>
      </section>
      <section className="dash-card" aria-labelledby="treasury-holdings-heading">
        <header className="dash-section-heading"><h2 id="treasury-holdings-heading">Treasury Wallet Holdings</h2></header>
        <div className="dash-holdings">
          {(snapshot?.holdings ?? DASHBOARD_ASSETS.map(asset => ({ asset, raw: null, usd: null }))).map(row => <div className="dash-asset-row" key={row.asset.address}>
            <span className="dash-asset-name"><AssetIcon src={row.asset.logo} />{row.asset.symbol}</span>
            <span className="dash-asset-value"><strong>{amount(row.raw, row.asset.decimals)}</strong><small>{row.raw === null ? "Balance unavailable" : usd(row.usd)}</small></span>
          </div>)}
          <div className="dash-asset-row dash-holdings-total"><span>{snapshot && snapshot.totalUsd === null ? "Known priced holdings" : "Total"}</span><strong>{usd(snapshot?.totalUsd ?? (snapshot && snapshot.pricedCount > 0 ? snapshot.knownUsd : null))}</strong></div>
        </div>
        <a className="dash-inline-link" href={`https://scan.pulsechain.com/address/${TREASURY}`} target="_blank" rel="noreferrer">View treasury wallet ↗</a>
      </section>
    </div>
    <div className="dash-overview-columns dash-overview-extras">
      <TreasuryPositions />
      <ContractShowcase />
    </div>
    <ProtocolInsights />
    <RecentActivity />
  </main>;
}
