import { useEffect, useMemo, useRef, useState, type PointerEvent } from "react";
import { buybackChartSeries, type BuybackChartRange } from "./buybackChartData";
import type { BuybackSnapshot } from "./buybackData";
import { dashboardAmount } from "./format";

const ranges = ["24H", "7D", "30D", "ALL"] as const;
const rangeNames = { "24H": "last 24 hours", "7D": "last 7 days", "30D": "last 30 days", ALL: "all recorded history" };
const axisAmount = (value: number) => new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(value);
function scale(maximum: bigint) {
  const maximumTokens = Number(maximum) / 1e18;
  if (maximumTokens <= 0) return { top: 1, ticks: [0, .25, .5, .75, 1] };
  const magnitude = 10 ** Math.floor(Math.log10(maximumTokens / 5));
  const step = ([1, 2, 2.5, 5, 10].find(value => value >= maximumTokens / 5 / magnitude) ?? 10) * magnitude;
  const count = Math.ceil(maximumTokens / step);
  return { top: count * step, ticks: Array.from({ length: count + 1 }, (_, index) => index * step) };
}

export function BuybackActivityChart({ snapshot }: { snapshot: BuybackSnapshot }) {
  const [range, setRange] = useState<BuybackChartRange>("24H");
  const [selected, setSelected] = useState<number | null>(null);
  const [width, setWidth] = useState(960);
  const container = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const element = container.current;
    if (!element) return;
    const measure = () => { const next = element.getBoundingClientRect().width; if (next > 0) setWidth(Math.max(220, next)); };
    measure();
    if (typeof ResizeObserver === "undefined") { window.addEventListener("resize", measure); return () => window.removeEventListener("resize", measure); }
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const series = useMemo(() => buybackChartSeries(snapshot, range), [snapshot, range]);
  const maximum = series.points.reduce((max, point) => point.oinkRaw > max ? point.oinkRaw : max, 0n);
  const axis = scale(maximum);
  const height = width < 500 ? 260 : 300;
  const left = width < 500 ? 42 : 52, right = 18, top = 18, bottom = 38;
  const plotWidth = width - left - right, plotHeight = height - top - bottom, baseline = top + plotHeight;
  const points = series.points.map((point, index) => ({ ...point, x: left + index / Math.max(1, series.points.length - 1) * plotWidth,
    y: baseline - (Number(point.oinkRaw) / 1e18 / axis.top) * plotHeight }));
  const line = points.map((point, index) => {
    if (!index) return `M ${point.x} ${point.y}`;
    const previous = points[index - 1], middle = (previous.x + point.x) / 2;
    return `C ${middle} ${previous.y} ${middle} ${point.y} ${point.x} ${point.y}`;
  }).join(" ");
  const step = Math.max(1, Math.ceil((points.length - 1) / (width < 500 ? 3 : 8)));
  const tickIndexes = new Set([0, points.length - 1, ...points.map((_, index) => index).filter(index => index % step === 0 && index < points.length - 1 - step / 2)]);
  const dateFormat = new Intl.DateTimeFormat(undefined, range === "24H" ? { hour: "numeric" } : range === "ALL" ? { month: "short", year: "2-digit", timeZone: "UTC" } : { month: "short", day: "numeric" });
  const bucketDate = (index: number) => range === "ALL"
    ? Date.UTC(new Date(series.from * 1000).getUTCFullYear(), new Date(series.from * 1000).getUTCMonth() + index, 1)
    : points[index].timestamp * 1000;
  const active = selected === null ? null : points[selected];
  const label = `OINK buybacks over ${rangeNames[range]}: ${dashboardAmount(series.totalRaw)} OINK`;
  const selectPoint = (event: PointerEvent<SVGSVGElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect();
    if (bounds.width <= 0) return;
    const x = (event.clientX - bounds.left) * width / bounds.width;
    setSelected(Math.max(0, Math.min(points.length - 1, Math.round((x - left) / plotWidth * (points.length - 1)))));
  };
  return <div className="buyback-chart" ref={container}>
    <header className="buyback-activity-heading"><h3>Buyback activity</h3><div className="buyback-chart-ranges" role="group" aria-label="Buyback chart time range">
      {ranges.map(value => <button key={value} type="button" aria-pressed={range === value} onClick={() => { setRange(value); setSelected(null); }}>{value === "ALL" ? "All" : value}</button>)}
    </div></header>
    <div className="buyback-plot">
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={label} aria-describedby="buyback-chart-readout" tabIndex={0}
        onPointerMove={selectPoint} onPointerDown={selectPoint}
        onPointerLeave={event => { if (event.pointerType !== "touch") setSelected(null); }} onBlur={() => setSelected(null)}
        onKeyDown={event => {
          if (!["ArrowLeft", "ArrowRight", "Home", "End", "Escape"].includes(event.key)) return;
          event.preventDefault();
          if (event.key === "Escape") setSelected(null);
          else if (event.key === "Home") setSelected(0);
          else if (event.key === "End") setSelected(points.length - 1);
          else setSelected(index => Math.max(0, Math.min(points.length - 1, (index ?? points.length - 1) + (event.key === "ArrowLeft" ? -1 : 1))));
        }}>
        {axis.ticks.map(value => {
          const y = baseline - value / axis.top * plotHeight;
          return <g key={value} className="buyback-chart-grid"><line x1={left} x2={width - right} y1={y} y2={y} /><text x={left - 9} y={y + 4} textAnchor="end">{axisAmount(value)}</text></g>;
        })}
        {points.map((point, index) => <line className="buyback-chart-vertical" key={index} x1={point.x} x2={point.x} y1={top} y2={baseline} />)}
        <path className="buyback-chart-line" d={line} />
        {points.map((point, index) => <circle className="buyback-chart-dot" key={index} cx={point.x} cy={point.y} r={width < 500 ? 2.5 : 3} />)}
        {[...tickIndexes].sort((a, b) => a - b).map(index => <text className="buyback-chart-tick" key={index} x={points[index].x} y={height - 12} textAnchor={index === 0 ? "start" : index === points.length - 1 ? "end" : "middle"}>{dateFormat.format(bucketDate(index))}</text>)}
        {active && <g className="buyback-chart-active"><line x1={active.x} x2={active.x} y1={top} y2={baseline} /><circle cx={active.x} cy={active.y} r="5" /></g>}
      </svg>
    </div>
    <div className="buyback-chart-readout" id="buyback-chart-readout" aria-live="polite">
      {active ? <><span>{new Intl.DateTimeFormat(undefined, range === "ALL" ? { month: "long", year: "numeric", timeZone: "UTC" } : { month: "short", day: "numeric", ...(range === "24H" || range === "7D" ? { hour: "numeric", minute: "2-digit" } : { year: "numeric" }) }).format(bucketDate(selected!))}</span><strong>{dashboardAmount(active.oinkRaw)} OINK</strong><span>{active.count} buyback{active.count === 1 ? "" : "s"}</span></>
        : <><strong>{dashboardAmount(series.totalRaw)} OINK bought</strong><span>{series.count.toLocaleString()} buyback{series.count === 1 ? "" : "s"} · {rangeNames[range]}</span></>}
    </div>
  </div>;
}
