import { formatUnits } from "ethers";
import { useQuietRead } from "../../hooks/useQuietRead";
import { FARM_REGISTRY } from "./config";
import { readPublicTreasuryPositions } from "./treasuryPositions";
import { useOverviewSectionReady } from "./useOverviewSectionReady";

const usd = (value: number | null | undefined) => value == null ? "—" : value > 0 && value < .01 ? "<$0.01" : new Intl.NumberFormat(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 2 }).format(value);
const amount = (raw: bigint | null | undefined, decimals = 18) => raw == null ? "—" : new Intl.NumberFormat(undefined, { maximumFractionDigits: 3 }).format(Number(formatUnits(raw, decimals)));

export function TreasuryPositions() {
  const { ref, ready } = useOverviewSectionReady();
  const { data, error } = useQuietRead("dashboard:treasury-positions:369", readPublicTreasuryPositions, 90_000, ready);
  const deposits = data?.farms.filter(row => row.depositedRaw !== 0n) ?? [];
  return <section ref={ref} className="dash-card dash-treasury-positions" aria-labelledby="treasury-positions-heading">
    <header className="dash-section-heading"><h2 id="treasury-positions-heading">Treasury farming positions</h2></header>
    <div className="dash-holdings">
      {deposits.map(row => <div className="dash-asset-row" key={row.address}>
        <a href={`https://scan.pulsechain.com/address/${row.address}`} target="_blank" rel="noreferrer">{row.name} ↗</a>
        <span className="dash-asset-value"><strong>{amount(row.depositedRaw, row.decimals)}</strong><small>{usd(row.usd)}</small></span>
      </div>)}
      {data && deposits.length === 0 && <p className="dash-data-note">No deposits in the tracked DEGEN farms.</p>}
      {error && !data && <p className="dash-data-error" role="status">Treasury farm positions are unavailable.</p>}
      <div className="dash-asset-row dash-holdings-total"><span>Farming value</span><strong>{usd(data?.farmingUsd)}</strong></div>
      <div className="dash-asset-row dash-holdings-total"><span>Wallet + farm positions</span><strong>{usd(data?.combinedUsd)}</strong></div>
    </div>
    <details className="dash-protocol-details"><summary>View all {FARM_REGISTRY.length} tracked farms</summary>
      <div className="dash-registry-list">{FARM_REGISTRY.map(farm => {
        const position = data?.farms.find(row => row.address.toLowerCase() === farm.address.toLowerCase());
        return <div key={farm.address}><a href={`https://scan.pulsechain.com/address/${farm.address}`} target="_blank" rel="noreferrer">{farm.name} ↗</a>
          <span>{data ? position ? amount(position.depositedRaw, position.decimals) : "0" : "—"}</span></div>;
      })}</div>
    </details>
  </section>;
}
