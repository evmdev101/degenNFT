import { Link } from "react-router-dom";
import { GOVERNANCE_ACTIONS_DISABLED } from "../config/publicPreview";
import { MINER_POOLS } from "./dashboard/config";
import "./guides.css";

const paths = [
  {
    title: "Time miners", flow: "DEGEN → locked miner → DEGEN",
    text: "Choose a duration and deposit DEGEN. Your miner holds shares in its pool, and its DEGEN value follows the pool’s current share price. Track each position’s balance and lock progress in My Miners.",
    to: "/my-miners", action: "Explore miners",
  },
  {
    title: "Asset farms", flow: "Supported asset → farm position → DEGEN rewards",
    text: "Deposit the token or LP accepted by a farm. Each card brings together your wallet balance, staked positions and DEGEN rewards. Use the farm’s Claim button for that farm, or Claim All Rewards for your combined farm rewards.",
    to: "/farms", action: "Explore farms",
  },
  {
    title: "NFT miners", flow: "PLS → NFT miner → OINK + DEGEN rewards",
    text: "Mint NFT miner units with PLS, then follow your NFT balance and pending OINK and DEGEN rewards. The NFT page brings minting, harvest settings, reward claims and the reward calculator together.",
    to: "/nft", action: "Explore NFT miners",
  },
];

export function HowItWorksPage() {
  return <main className="guide-main" aria-labelledby="how-it-works-title">
    <header className="guide-hero">
      <span className="guide-kicker">How it works</span>
      <h1 id="how-it-works-title">Your route through DEGEN.</h1>
      <p>Understand the choices, follow your positions and see how rewards fit together.</p>
    </header>

    <section className="guide-grid guide-three-columns" aria-label="Ways to use DEGEN">
      {paths.map((path, index) => <article className="guide-card guide-path" key={path.title}>
        <span className="guide-card-index">0{index + 1}</span>
        <h2>{path.title}</h2>
        <strong>{path.flow}</strong>
        <p>{path.text}</p>
        <Link to={path.to}>{path.action} →</Link>
      </article>)}
    </section>

    <section className="guide-card guide-section" aria-labelledby="miner-timeline-title">
      <h2 id="miner-timeline-title">A miner’s timeline</h2>
      <ol className="guide-steps">
        <li><h3>Create</h3><p>Choose your DEGEN amount and miner duration. Approve the amount when needed, then create the miner with your wallet.</p></li>
        <li><h3>Track</h3><p>Follow the position’s DEGEN value, lock progress and maturity status in My Miners. Search, filter and sort your positions as they grow.</p></li>
        <li><h3>Mature</h3><p>Once the lock duration ends, the miner enters its grace window. Its current contract terms determine the available withdrawal and rollover actions.</p></li>
        <li><h3>Exit or renew</h3><p>Withdraw the selected position or move it into an available miner duration. A rollover starts a new lock with the destination pool’s terms.</p></li>
      </ol>
      <Link to="/portfolio">View your portfolio →</Link>
    </section>

    <section className="guide-grid guide-two-columns guide-section" aria-label="More about DEGEN">
      <article className="guide-card">
        <h2>Choose your duration</h2>
        <p>The site lists {MINER_POOLS.length} time-miner pools. Each duration has its own pool and your positions are tracked separately.</p>
        <ul className="guide-duration-list">{[...MINER_POOLS].reverse().map(pool => <li key={pool.address}>{pool.label}</li>)}</ul>
        <Link to="/my-miners?tab=deploy">Deploy a miner →</Link>
      </article>
      <article className="guide-card">
        <h2>Where governance fits</h2>
        <p>Governance covers reward allocation, rollover bonuses, emissions, fees and other protocol settings. Explore the current parameters and proposal history from the Governance tab.</p>
        {GOVERNANCE_ACTIONS_DISABLED && <p>Governance transaction actions are temporarily paused while this section is being tested. Forms and read-only proposal checks remain available.</p>}
        <Link to="/governance">Explore governance →</Link>
      </article>
    </section>

    <section className="guide-card guide-section" aria-labelledby="guide-numbers-title">
      <h2 id="guide-numbers-title">Understand the numbers</h2>
      <dl className="guide-glossary">
        <dt>Miner value</dt><dd>Your shares multiplied by the pool’s current price per share.</dd>
        <dt>Pending rewards</dt><dd>Unclaimed farm or NFT rewards, shown separately from your deposited portfolio value.</dd>
        <dt>APR</dt><dd>An annualized projection calculated from current emissions, pool allocation and asset prices.</dd>
        <dt>Allocation</dt><dd>The portion of protocol emissions assigned to a pool.</dd>
      </dl>
      <Link to="/protocol?section=faq">Read more in Docs →</Link>
    </section>
  </main>;
}
