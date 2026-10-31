import { GOVERNANCE_ADDRESSES } from "./governanceSpec";
import { Contract } from "ethers";
import { getPublicProvider } from "../../lib/chain";
import { BASIC_SETTINGS_CONTRACT } from "./rolloverBonus";

export const NEW_TOKEN_ABI = [
  "function proposalLengths() view returns(uint256,uint256,uint256,uint256)",
  "function newPoolProposal(uint256) view returns(bool valid,uint256 createdAt,uint256 votesFor,uint256 votesAgainst,uint256 extraDelay,address newPool)",
] as const;
export type NewTokenProposal = {
  id: string; valid: boolean; createdAt: bigint; votesFor: bigint;
  votesAgainst: bigint; extraDelay: bigint; newPool: string;
};

export function newTokenState(p: NewTokenProposal, delay: bigint, cost: bigint, now: bigint): string {
  if (!p.valid) return "Finished on-chain";
  const vetoStart = p.createdAt + p.extraDelay;
  const end = vetoStart + delay;
  if (now > vetoStart && p.votesAgainst > p.votesFor) return "Veto available";
  if (now < end) return "Credit voting open";
  if (now === end) return "Voting closed — awaiting next block";

  return "Review complete — current threshold checked before execution";
}

export type NewTokenRow = { id: string; proposal?: NewTokenProposal; error?: string };
export async function enumerateNewTokens(count: bigint, read: (id: bigint) => Promise<NewTokenProposal>): Promise<NewTokenRow[]> {
  if (count < 0n || count > 500n) throw new Error("Proposal count exceeds the supported range");
  const rows: NewTokenRow[] = [];
  // Bound request concurrency; a failed read remains visible and cannot imply an empty list.
  for (let start = 0; start < Number(count); start += 6) {
    rows.push(...await Promise.all(Array.from({length: Math.min(6, Number(count) - start)}, async (_, offset) => {
      const id = BigInt(start + offset);
      try { return { id: String(id), proposal: await read(id) }; }
      catch { return { id: String(id), error: "Proposal read failed — refresh to retry" }; }
    })));
  }
  return rows;
}

export async function loadNewTokens() {
  const provider = await getPublicProvider();
  const block = await provider.getBlock("latest");
  if (!block) throw new Error("Latest block unavailable");
  const overrides = { blockTag: block.number };
  const basic = new Contract(BASIC_SETTINGS_CONTRACT, NEW_TOKEN_ABI, provider);
  const governor = new Contract(GOVERNANCE_ADDRESSES.governor, [
    "function delayBeforeEnforce() view returns(uint256)", "function costToVote() view returns(uint256)",
  ], provider);
  const [lengths, delay, cost] = await Promise.all([
    basic.proposalLengths(overrides), governor.delayBeforeEnforce(overrides), governor.costToVote(overrides),
  ]);
  const rows = await enumerateNewTokens(lengths[1], async id => {
    const r = await basic.newPoolProposal(id, overrides);
    return {id: String(id), valid: r[0], createdAt: r[1], votesFor: r[2], votesAgainst: r[3], extraDelay: r[4], newPool: r[5]};
  });
  return {rows, delay: BigInt(delay), cost: BigInt(cost), timestamp: BigInt(block.timestamp), block: block.number};
}
