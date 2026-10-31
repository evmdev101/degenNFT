import { describe, it, expect } from "vitest";
import { newTokenState, enumerateNewTokens, type NewTokenProposal } from "../src/features/governance/newToken";
const p: NewTokenProposal = {id: "0", valid: true, createdAt: 100n, extraDelay: 20n, votesFor: 250n, votesAgainst: 0n, newPool: "0x0000000000000000000000000000000000000001"};
describe("New reward pools", () => {
  it("keeps the strict veto and execution boundaries", () => {
    expect(newTokenState({...p, votesAgainst: 251n},100n,1n,120n)).toBe("Credit voting open");
    expect(newTokenState({...p, votesAgainst: 251n},100n,1n,121n)).toBe("Veto available");
    expect(newTokenState(p,100n,1n,220n)).toContain("awaiting next block");
    expect(newTokenState(p,100n,1n,221n)).toContain("Review complete");
  });
  it("defers the private current threshold to simulation and prioritizes finished state", () => {
    expect(newTokenState(p,100n,2n,221n)).toContain("current threshold checked before execution");
    expect(newTokenState({...p,valid:false},100n,2n,221n)).toBe("Finished on-chain");
  });
  it("enumerates missing feed IDs and preserves failed reads", async () => {
    const rows = await enumerateNewTokens(3n,async id => {
      if(id===1n) throw Error("offline");
      return {...p,id:String(id)};
    });
    expect(rows.map(r=>r.id)).toEqual(["0","1","2"]);
    expect(rows[1].error).toBeTruthy();
    expect(rows[2].proposal?.id).toBe("2");
    await expect(enumerateNewTokens(501n,async()=>p)).rejects.toThrow();
  });
});
