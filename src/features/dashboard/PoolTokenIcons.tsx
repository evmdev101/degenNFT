import { useState } from "react";
import { TOKEN_LOGOS } from "../../config/tokenLogos";
import { REWARD_POOL_NAMES } from "../governance/rewardPoolNames";
import { FARM_REGISTRY, MINER_POOLS } from "./config";
import type { ProtocolPool } from "./protocolData";

function TokenIcon({ symbol }: { symbol: string }) {
  const [failed, setFailed] = useState(false);
  const src = TOKEN_LOGOS[symbol];
  return <span className="dash-allocation-coin">
    {src && !failed ? <img src={src} alt="" loading="lazy" onError={() => setFailed(true)} /> : symbol.replace(/^p/, "").slice(0, 3)}
  </span>;
}

export function PoolTokenIcons({ pool, fallbackColor }: { pool: ProtocolPool; fallbackColor: string }) {
  const address = pool.address.toLowerCase();
  const miner = MINER_POOLS.some(item => item.address.toLowerCase() === address);
  const metadata = REWARD_POOL_NAMES.find(item => item.id === pool.id && item.participant.toLowerCase() === address);
  const farm = metadata && FARM_REGISTRY.find(item => item.address.toLowerCase() === address);
  const tokens = miner ? ["DEGEN"] : farm ? farm.tokens
    : metadata && (metadata.symbol === "Treasury Miner" || metadata.symbol.includes("NFT Miner")) ? ["DEGEN"] : [];
  return tokens.length ? <span className="dash-allocation-coins" aria-hidden="true">
    {tokens.map(symbol => <TokenIcon symbol={symbol} key={symbol} />)}
  </span> : <i style={{ background: fallbackColor }} aria-hidden="true" />;
}
