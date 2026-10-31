import { formatUnits } from "ethers";
import { useState } from "react";
import { Link } from "react-router-dom";
import { useQuietRead } from "../../hooks/useQuietRead";
import { MINER_POOLS, TREASURY } from "./config";
import { readPublicProtocolOverview, protocolPercent, type ProtocolMiner, type ProtocolOverviewSnapshot } from "./protocolData";
import { useOverviewSectionReady } from "./useOverviewSectionReady";
import { PoolTokenIcons } from "./PoolTokenIcons";
import "./protocol-insights.css";

const colors = ["#7b6cff", "#17a7c7", "#d74fe6", "#0fb15f", "#ff9f32", "#ff3d7f"];
const amount = (raw: bigint | null | undefined, compact = true) => raw == null ? "—" : new Intl.NumberFormat(undefined,
  compact ? { notation: "compact", maximumFractionDigits: 2 } : { maximumFractionDigits: 3 }).format(Number(formatUnits(raw, 18)));
function pct(value: number | null | undefined, digits = 1) {
  if (value == null) return "—";
  const precision = digits === 1 && value > 0 && value < .1 ? 3 : digits === 1 && value > 99.9 && value < 100 ? 2 : digits;
  return `${new Intl.NumberFormat(undefined, { maximumFractionDigits: precision, minimumFractionDigits: precision }).format(value)}%`;
}
const minerRoute = (address: string) => `/my-miners?tab=deploy&pool=${encodeURIComponent(address)}`;

type Part = { label: string; raw: bigint | null; color: string };
function Distribution({ title, parts, total, columns = false }: { title: string; parts: Part[]; total: bigint | null; columns?: boolean }) {
  const [selected, setSelected] = useState<number | null>(null);
  const complete = total !== null && parts.every(row => row.raw !== null);
  const current = selected === null ? null : parts[selected];
  const percentage = (value: bigint | null) => value !== null && total !== null ? protocolPercent(value, total) : null;
  return <article className="dash-card dash-distribution-card">
    <h2>{title}</h2>
    <div className="dash-distribution-summary">
      <span>{current?.label ?? (columns ? "Miner accounting balance" : "Total DEGEN supply")}</span>
      <strong>{amount(current ? current.raw : total)} <small>DEGEN</small></strong>
      <span>{current ? pct(percentage(current.raw)) : columns ? "Share of miner accounting weight" : "Issued tokens by location"}</span>
    </div>
    <div className={columns ? "dash-distribution-columns" : "dash-distribution-stack"} aria-label={title}>
      {complete && parts.map((part, index) => {
        const share = percentage(part.raw) ?? 0;
        return columns ? <button type="button" key={part.label} onClick={() => setSelected(index)} aria-pressed={selected === index}
          aria-label={`${part.label}: ${pct(share)}`}>
          <strong>{pct(share)}</strong><span className="dash-column-track"><span style={{ height: `${share}%`, background: part.color }} /></span><small>{part.label}</small>
        </button> : share > 0 ? <button type="button" key={part.label} style={{ flexBasis: `${share}%`, background: part.color }}
          aria-label={`${part.label}: ${pct(share)}`} aria-pressed={selected === index} onClick={() => setSelected(index)} /> : null;
      })}
    </div>
    <div className="dash-chart-legend">{parts.map((part, index) => <button type="button" key={part.label}
      aria-pressed={selected === index} onClick={() => setSelected(selected === index ? null : index)}>
      <span><i style={{ background: part.color }} />{part.label}</span><strong>{amount(part.raw)} <small>DEGEN</small></strong><span>{pct(percentage(part.raw))}</span>
    </button>)}</div>
  </article>;
}

function MinerApr({ miners }: { miners: ProtocolMiner[] }) {
  const available = miners.some(row => row.apr !== null);
  const max = Math.max(1, ...miners.map(row => row.apr ?? 0)) * 1.15;
  const x = (index: number) => 85 + index * 830 / Math.max(1, miners.length - 1);
  const y = (value: number) => 270 - value / max * 210;
  const segments = miners.flatMap((miner, index) => index > 0 && miner.apr !== null && miners[index - 1].apr !== null
    ? [`${x(index - 1)},${y(miners[index - 1].apr!)} ${x(index)},${y(miner.apr)}`] : []);
  return <article className="dash-card dash-apr-card">
    <header className="dash-section-heading"><h2>Mining rewards by duration</h2><Link to="/my-miners?tab=deploy">Create a miner →</Link></header>
    <p className="dash-chart-subtitle">Current emissions across DEGEN’s four lock-up durations</p>
    <div className="dash-apr-plot" role="img" aria-label={available ? miners.map(row => `${row.label}: ${pct(row.apr)} estimated APR`).join(", ") : "Miner APR data unavailable"}>
      <svg viewBox="0 0 1000 340" aria-hidden="true">
        {[0, .5, 1].map(tick => <g key={tick}><line x1="65" x2="960" y1={y(max * tick)} y2={y(max * tick)} className="dash-chart-grid" /><text x="55" y={y(max * tick) + 5} textAnchor="end">{pct(max * tick, 0)}</text></g>)}
        {segments.map((points, index) => <polyline key={index} points={points} fill="none" className="dash-chart-line" />)}
        {miners.map((miner, index) => <g key={miner.address}>
          {miner.apr !== null && <><circle cx={x(index)} cy={y(miner.apr)} r="6" fill={colors[index % colors.length]} /><text x={x(index)} y={y(miner.apr) - 18} textAnchor="middle">{pct(miner.apr)}</text></>}
          <text x={x(index)} y="310" textAnchor="middle">{miner.label}</text>
        </g>)}
      </svg>
    </div>
    <div className="dash-table-wrap" tabIndex={0} role="region" aria-label="Mining rewards by duration table"><table className="dash-protocol-table">
      <thead><tr><th>Duration</th><th>Estimated APR</th><th>Miner weight</th><th>Accounting balance</th><th><span className="sr-only">Create miner</span></th></tr></thead>
      <tbody>{miners.map(miner => <tr key={miner.address}><td>{miner.label}</td><td><strong>{pct(miner.apr)}</strong></td><td>{pct(miner.weightPercent)}</td>
        <td><strong>{amount(miner.accountingRaw)} DEGEN</strong></td><td><Link to={minerRoute(miner.address)} aria-label={`Create ${miner.label} miner`}>Create →</Link></td></tr>)}</tbody>
    </table></div>
  </article>;
}

function Allocation({ data }: { data?: ProtocolOverviewSnapshot }) {
  const active = data?.pools?.filter(pool => pool.allocRaw > 0n) ?? [];
  return <article className="dash-card dash-allocation-card">
    <h2>DEGEN reward allocation</h2>
    <div className="dash-allocation-bar" role="img" aria-label={active.length ? active.map(row => `${row.label}: ${pct(row.percent, 4)}`).join(", ") : "Reward allocation unavailable"}>
      {active.map((pool, index) => <a key={pool.id} href={`https://scan.pulsechain.com/address/${pool.address}`} target="_blank" rel="noreferrer"
        style={{ flexBasis: `${pool.percent ?? 0}%`, background: colors[index % colors.length] }} aria-label={`${pool.label}: ${pct(pool.percent, 4)}`} />)}
    </div>
    <div className="dash-allocation-list">{active.map((pool, index) => <a key={pool.id} href={`https://scan.pulsechain.com/address/${pool.address}`} target="_blank" rel="noreferrer">
      <span><PoolTokenIcons pool={pool} fallbackColor={colors[index % colors.length]} />{pool.label}</span><strong>{pct(pool.percent, 4)}</strong>
    </a>)}</div>
    <details className="dash-protocol-details"><summary>All {data?.pools?.length ?? ""} registered pools</summary>
      <div className="dash-registry-list">{data?.pools?.map(pool => <div key={pool.id}>
        <a href={`https://scan.pulsechain.com/address/${pool.address}`} target="_blank" rel="noreferrer">#{pool.id} · {pool.label} ↗</a><strong>{pct(pool.percent, 4)}</strong>
      </div>)}</div>
    </details>
  </article>;
}

function BalanceDetails({ data }: { data?: ProtocolOverviewSnapshot }) {
  const rows = [
    ["Issued DEGEN supply", data?.supply.totalRaw], ["DEGEN held by miner contracts", data?.supply.minerTokensRaw],
    ["DEGEN in the trading pair", data?.supply.pairTokensRaw], ["DEGEN in other accounts", data?.supply.otherRaw],
    ["DEGEN held by the Governor", data?.governorTokensRaw], ["DEGEN held by the Treasury", data?.treasuryTokensRaw],
    ["Miner accounting value", data?.minerAccountingRaw], ["Governance voting base", data?.votingBaseRaw],
  ] as const;
  return <details className="dash-card dash-protocol-balances"><summary>Show all DEGEN balances &amp; supply</summary>
    <div className="dash-balance-facts">{rows.map(([label, value]) => <div key={label}><span>{label}</span><strong>{amount(value, false)} DEGEN</strong></div>)}</div>
  </details>;
}

function MarketChart({ data }: { data?: ProtocolOverviewSnapshot }) {
  const pair = data?.pair;
  const url = pair ? `https://dexscreener.com/pulsechain/${pair.address}` : null;
  return <section className="dash-card dash-market-card" aria-labelledby="degen-market-heading">
    <header className="dash-section-heading"><h2 id="degen-market-heading">DEGEN / PLS</h2>{url && <a href={url} target="_blank" rel="noreferrer">Open on Dexscreener ↗</a>}</header>
    {url ? <iframe src={`${url}?embed=1&theme=dark&trades=0&info=0`} title="DEGEN / PLS market chart on Dexscreener" loading="lazy" allowFullScreen />
      : <div className="dash-market-placeholder">{data ? "Trading pair unavailable." : "—"}</div>}
  </section>;
}

export function ProtocolInsights() {
  const { ref, ready } = useOverviewSectionReady();
  const { data, error } = useQuietRead("dashboard:protocol:369", readPublicProtocolOverview, 90_000, ready);
  const miners: ProtocolMiner[] = data?.miners ?? [...MINER_POOLS].sort((a, b) => a.duration - b.duration).map(pool => ({ ...pool,
    accountingRaw: null, sharesRaw: null, issuedRaw: null, dailyRewardsRaw: null, apr: null, weightPercent: null }));
  const stats = [
    { label: "Governor proposals", value: data?.stats.governorProposals, detail: "Recorded replacement proposals" },
    { label: "Registered pools", value: data?.stats.registeredPools, detail: "On-chain reward registry" },
    { label: "Allocated pools", value: data?.stats.allocatedPools, detail: "Pools receiving reward allocation" },
    { label: "NFT reward pools", value: data?.stats.nftPools, detail: "Registered NFT reward vaults" },
    { label: "Miner accounting value", value: amount(data?.minerAccountingRaw), detail: "Across four time-miner pools" },
    { label: "Governance voting base", value: amount(data?.votingBaseRaw), detail: "Miner accounting balance" },
    { label: "Miner shares", value: amount(data?.minerSharesRaw), detail: "Total time-miner shares" },
    { label: "DEGEN in LP", value: amount(data?.supply.pairTokensRaw), detail: "Tokens held by the trading pair" },
  ];
  return <section ref={ref} className="dash-protocol-section" aria-labelledby="protocol-distribution-heading">
    <header className="dash-protocol-heading"><span>Protocol distribution</span><h2 id="protocol-distribution-heading">Supply, rewards and miner weight</h2></header>
    {error && !data && <p className="dash-data-error" role="status">Protocol statistics are unavailable.</p>}
    <Allocation data={data} />
    <MinerApr miners={miners} />
    <div className="dash-distribution-grid">
      <Distribution title="DEGEN supply by location" total={data?.supply.totalRaw ?? null} parts={[
        { label: "Miner contracts", raw: data?.supply.minerTokensRaw ?? null, color: colors[0] },
        { label: "Other accounts", raw: data?.supply.otherRaw ?? null, color: colors[1] },
        { label: "Liquidity pair", raw: data?.supply.pairTokensRaw ?? null, color: colors[2] },
      ]} />
      <Distribution title="Miners by lock-up" total={data?.minerAccountingRaw ?? null} columns parts={miners.map((miner, index) => ({ label: miner.label, raw: miner.accountingRaw, color: colors[index % colors.length] }))} />
    </div>
    <div className="dash-metrics dash-protocol-metrics">{stats.map(stat => <article className="dash-card dash-metric" key={stat.label}>
      <span>{stat.label}</span><strong>{stat.value ?? "—"}</strong><span className="dash-stat-sub">{stat.detail}</span>
    </article>)}</div>
    <BalanceDetails data={data} />
    <MarketChart data={data} />
    <div className="dash-protocol-links"><Link to="/protocol?section=contracts">Explore DEGEN contracts →</Link><a href={`https://scan.pulsechain.com/address/${TREASURY}`} target="_blank" rel="noreferrer">Treasury ↗</a></div>
  </section>;
}
