import { Contract } from "ethers";
import { CONTRACTS } from "../../config/contracts";
import { getPublicProvider } from "../../lib/chain";

export function nftDailyYield(emission: bigint, allocation: bigint, totalAllocation: bigint, supply: bigint, blocks: number, seconds: number) {
  if (supply <= 0n || totalAllocation <= 0n || allocation < 0n || allocation > totalAllocation || emission < 0n || blocks <= 0 || seconds <= 0) throw new Error("NFT reward rates unavailable");
  return emission * allocation * 86400n * BigInt(blocks) / (totalAllocation * supply * BigInt(seconds));
}

export async function readNftYield() {
  const provider = await getPublicProvider();
  if (BigInt(await provider.send("eth_chainId", [])) !== 369n) throw new Error("Wrong chain");
  const head = await provider.getBlock("latest");
  if (!head || Date.now() / 1000 - head.timestamp > 120) throw new Error("NFT reward block unavailable");
  const earlier = await provider.getBlock(Math.max(0, head.number - 100));
  if (!earlier) throw new Error("Block timing unavailable");
  const at = { blockTag: head.number };
  const nft = new Contract(CONTRACTS.nft, ["function totalNFTs() view returns(uint256)", "function masterchef1() view returns(address)", "function masterchef2() view returns(address)", "function poolID1() view returns(uint256)", "function poolID2() view returns(uint256)", "function rewardToken1() view returns(address)", "function rewardToken2() view returns(address)"], provider);
  const supply: bigint = await nft.totalNFTs(at);
  const rates = await Promise.all(([1, 2] as const).map(async index => {
    const [chefAddress, poolId, token] = await Promise.all([nft.getFunction(`masterchef${index}`)(at), nft.getFunction(`poolID${index}`)(at), nft.getFunction(`rewardToken${index}`)(at)]);
    if (String(token).toLowerCase() !== (index === 1 ? CONTRACTS.oink : CONTRACTS.degen).toLowerCase()) throw new Error("NFT reward token changed");
    const chef = new Contract(chefAddress, ["function DTXPerBlock() view returns(uint256)", "function totalAllocPoint() view returns(uint256)", "function startBlock() view returns(uint256)", "function poolInfo(uint256) view returns(uint256 allocPoint,uint256 lastRewardBlock,address participant)"], provider);
    const [emission, total, start, pool] = await Promise.all([chef.DTXPerBlock(at), chef.totalAllocPoint(at), chef.startBlock(at), chef.poolInfo(poolId, at)]);
    if (String(pool.participant).toLowerCase() !== CONTRACTS.nft.toLowerCase()) throw new Error("NFT reward pool changed");
    return nftDailyYield(BigInt(head.number) > start ? emission : 0n, pool.allocPoint, total, supply, head.number - earlier.number, head.timestamp - earlier.timestamp);
  }));
  return { oink: rates[0], degen: rates[1] };
}
