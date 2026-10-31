import { Contract } from "ethers";
import { CHAIN_ID, CONTRACTS, DEGEN_REWARDS_HELPER } from "../../config/contracts";
import { getPublicProvider } from "../../lib/chain";
import { quoteFarmClaim } from "../farmClaimQuote";
import { DASHBOARD_ASSETS, TREASURY } from "./config";
import { readTokenPrices } from "./marketData";
import { readOverviewSnapshot, type OverviewSnapshot } from "./overviewData";
import { readPortfolioWithReader, type PortfolioFarm, type PortfolioSnapshot } from "./portfolioData";

export type TreasuryPositionsSnapshot = {
  block: number; timestamp: number; farms: PortfolioFarm[];
  farmingUsd: number | null; walletUsd: number | null; combinedUsd: number | null;
};

export function combineTreasuryPositions(wallet: OverviewSnapshot, positions: PortfolioSnapshot): TreasuryPositionsSnapshot {
  if (positions.account.toLowerCase() !== TREASURY.toLowerCase() || wallet.block !== positions.blockNumber
    || wallet.timestamp * 1000 !== positions.observedAt) throw new Error("Treasury position snapshots do not match");
  const farmingUsd = positions.farms.usd;
  return { block: wallet.block, timestamp: wallet.timestamp, farms: positions.farms.positions,
    walletUsd: wallet.totalUsd, farmingUsd,
    combinedUsd: wallet.totalUsd !== null && farmingUsd !== null ? wallet.totalUsd + farmingUsd : null };
}

export async function readPublicTreasuryPositions(): Promise<TreasuryPositionsSnapshot> {
  const provider = await getPublicProvider();
  if (BigInt(await provider.send("eth_chainId", [])) !== CHAIN_ID) throw new Error("PulseChain provider required");
  const block = await provider.getBlock("latest");
  if (!block?.hash) throw new Error("Treasury block unavailable");
  const [wallet, positions] = await Promise.all([
    readOverviewSnapshot({
      snapshot: async () => ({ block: block.number, timestamp: block.timestamp }),
      supply: tag => new Contract(CONTRACTS.degen, ["function totalSupply() view returns(uint256)"], provider).totalSupply({ blockTag: tag }),
      balance: (asset, tag) => asset.native ? provider.getBalance(TREASURY, tag)
        : new Contract(asset.address, ["function balanceOf(address) view returns(uint256)"], provider).balanceOf(TREASURY, { blockTag: tag }),
      prices: readTokenPrices,
    }, DASHBOARD_ASSETS),
    readPortfolioWithReader(TREASURY, {
      block: async () => block,
      call: (address, signature, args, tag) => {
        const contract = new Contract(address.toLowerCase(), [signature], provider);
        return contract[signature.match(/function\s+(\w+)/)![1]](...args, { blockTag: tag });
      },
      prices: readTokenPrices,
      quote: (account, farms, tag) => quoteFarmClaim(provider, account, DEGEN_REWARDS_HELPER, farms, tag),
    }),
  ]);
  if ((await provider.getBlock(block.number))?.hash !== block.hash) throw new Error("Treasury block changed");
  return combineTreasuryPositions(wallet, positions);
}
