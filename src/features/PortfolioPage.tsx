import { Link } from "react-router-dom";
import { CHAIN_ID } from "../config/contracts";
import { useQuietRead } from "../hooks/useQuietRead";
import type { WalletState } from "../hooks/useWallet";
import { readPortfolio } from "./dashboard/portfolioData";
import { dashboardAmount as amount, dashboardUsd as usd } from "./dashboard/format";
import type { ReactNode } from "react";

export function PortfolioPage({ wallet }: { wallet: WalletState }) {
  const allowed = Boolean(wallet.address) && wallet.chainId === CHAIN_ID && !wallet.isWrongNetwork;
  const query = useQuietRead(`dashboard:portfolio:${CHAIN_ID}:${wallet.address?.toLowerCase() ?? "guest"}`, () => readPortfolio(wallet.address!), 60_000, allowed);
  const data = allowed && query.data?.account.toLowerCase() === wallet.address?.toLowerCase() ? query.data : undefined;
  const valuedDegen = data?.wallet.usd != null && data?.miners.usd != null ? data.wallet.usd + data.miners.usd : null;
  const activeFarms = data?.farms.positions.filter(farm => farm.stakeCount !== 0) ?? [];
  const minerPools = data?.miners.pools ?? [];
  const row = (label: ReactNode, value: string, className = "") => <div className={`dash-value-row ${className}`}><span>{label}</span><strong>{value}</strong></div>;
  return <main className="dashboard-main dashboard-portfolio">
    <section className="dash-card dash-portfolio-value" aria-label="Portfolio value" aria-busy={allowed && query.isRefreshing}>
      <div className="dash-kicker">Portfolio value</div>
      <h1 className="dash-portfolio-total">{usd(data?.totalUsd).replace(/ USD$/, "")}</h1>
      <div className="dash-portfolio-columns">
        <div aria-label="DEGEN value breakdown">
          {row("DEGEN", usd(valuedDegen), "dash-group-total")}
          {row(<span>In wallet{data && <small className="dash-row-token-amount">{amount(data.wallet.raw)} DEGEN</small>}</span>, usd(data?.wallet.usd))}
          {row("In time miners", usd(data?.miners.usd))}
          {row("Pending farm rewards", usd(data?.rewards.usd))}
          {data?.farms.positions.filter(farm => farm.pendingRaw !== null && farm.pendingRaw > 0n).map(farm => <div key={farm.address} className="dash-value-row dash-value-child"><span>{amount(farm.pendingRaw)} DEGEN estimated from {farm.name}</span></div>)}
          {data?.rewards.helperRaw != null && data.rewards.helperRaw > 0n && <div className="dash-value-row dash-value-child"><span>{amount(data.rewards.helperRaw)} DEGEN already collected for claiming</span></div>}
        </div>
        <div aria-label="Farm asset value breakdown">
          {row("Farm assets", usd(data?.farms.usd), "dash-group-total")}
          {activeFarms.map(farm => <div key={farm.address} className="dash-value-row"><span>{farm.name} deposited</span><strong>{usd(farm.usd)}</strong></div>)}
          {data?.farms.complete && activeFarms.length === 0 && <p className="dash-data-note">No supported farm deposits.</p>}
        </div>
      </div>
      {allowed && data?.totalUsd === null && data.knownTotalUsd > 0 && <p className="dash-data-note">Known subtotal: <strong>{usd(data.knownTotalUsd)}</strong> · incomplete</p>}
      {!allowed && <button className="dash-button" type="button" disabled={wallet.connecting} onClick={() => void (wallet.address ? wallet.switchNetwork() : wallet.connect())}>{wallet.address ? "Switch to PulseChain" : wallet.connecting ? "Connecting…" : "Connect wallet"}</button>}
    </section>

    <section className="dash-card dash-portfolio-positions" aria-labelledby="portfolio-positions-title">
      <h2 id="portfolio-positions-title">Your portfolio</h2>
      <div className="dash-portfolio-stats">
        <div><span>In time miners</span><strong>{amount(data?.miners.raw)} <small>DEGEN</small></strong><small>{usd(data?.miners.usd)}</small></div>
        <div><span>Active miners</span><strong>{data?.miners.count ?? "—"}</strong><small>{data?.miners.matureCount == null ? "Maturity counts unavailable" : `${data.miners.matureCount} miner${data.miners.matureCount === 1 ? "" : "s"} in ${data.miners.matureCount === 1 ? "its" : "their"} maturity window`}</small></div>
        <div><span>Farm positions</span><strong>{data?.farms.positionCount ?? "—"}</strong><small>{usd(data?.farms.usd)}</small></div>
        <div><span>Pending farm rewards</span><strong>{amount(data?.rewards.totalRaw)} <small>DEGEN</small></strong><small>{usd(data?.rewards.usd)}</small></div>
      </div>

      <section className="dash-position-section" aria-labelledby="portfolio-miners-title">
        <div className="dash-section-heading"><h2 id="portfolio-miners-title">Time miners</h2><Link to="/my-miners">Manage miners →</Link></div>
        <div className="dash-table-wrap" tabIndex={0} role="region" aria-label="Time miner balances"><table className="dash-table"><thead><tr><th scope="col">Duration</th><th scope="col">Miners</th><th scope="col">DEGEN value</th><th scope="col">Estimated value</th></tr></thead><tbody>
          {minerPools.map(pool => <tr key={pool.address}><th scope="row">{pool.label}</th><td>{pool.count ?? "—"}</td><td>{amount(pool.raw)}</td><td>{usd(pool.usd)}</td></tr>)}
          {!data && <tr><td colSpan={4}>{allowed ? "Reading miner balances…" : "Connect on PulseChain to view miner balances."}</td></tr>}
        </tbody></table></div>
      </section>

      <section className="dash-position-section" aria-labelledby="portfolio-farms-title">
        <div className="dash-section-heading"><h2 id="portfolio-farms-title">Farm positions</h2><Link to="/farms">Manage farms →</Link></div>
        <div className="dash-table-wrap" tabIndex={0} role="region" aria-label="Farm deposit balances"><table className="dash-table"><thead><tr><th scope="col">Farm</th><th scope="col">Recorded deposit</th><th scope="col">Estimated value</th><th scope="col">DEGEN rewards (est.)</th></tr></thead><tbody>
          {activeFarms.map(farm => <tr key={farm.address}><th scope="row">{farm.name}</th><td>{amount(farm.depositedRaw, farm.decimals)} {farm.name.endsWith("LP") ? "LP" : "tokens"}</td><td>{usd(farm.usd)}</td><td>{amount(farm.pendingRaw)}</td></tr>)}
          {activeFarms.length === 0 && <tr><td colSpan={4}>{!data ? allowed ? "Reading farm positions…" : "Connect on PulseChain to view farm positions." : data.farms.complete ? "No deposits in the supported farms." : "Some farm positions are unavailable."}</td></tr>}
        </tbody></table></div>
      </section>
    </section>

    <section className="dash-card dash-nft-summary" aria-labelledby="portfolio-nft-title">
      <div className="dash-section-heading"><h2 id="portfolio-nft-title">NFT miners</h2><Link to="/nft">Manage NFTs →</Link></div>
      <div className="dash-portfolio-stats">
        <div><span>NFT miners held</span><strong>{amount(data?.nft.countRaw, 0)}</strong></div>
        <div><span>Pending DEGEN</span><strong>{amount(data?.nft.pendingDegenRaw)} <small>DEGEN</small></strong></div>
        <div><span>Pending OINK</span><strong>{amount(data?.nft.pendingOinkRaw)} <small>OINK</small></strong></div>
      </div>
    </section>
  </main>;
}
