import { describe, expect, it } from "vitest";
import { REWARD_POOL_NAMES, rewardPoolOptionLabel } from "../src/features/governance/rewardPoolNames";

describe("reward pool names", () => {
  const hex = { id: 4n, participant: "0x7979bEe7F5Fe93F4b22d7A24C629803950610e56", allocation: 200n };
  it("matches the requested name(symbol) and current-allocation format", () => {
    expect(rewardPoolOptionLabel(hex)).toBe("HEX-HTT3000 V2 LP(HEX-HTT3000) (Current: 2%)");
    expect(rewardPoolOptionLabel({ id: 21n, participant: "0xc667a6EC483edB71f6329413FbcFE8042348956C", allocation: 10n }))
      .toBe("EMIT-PLSX V2 LP(EMIT-PLSX) (Current: 0.1%)");
  });
  it("uses the contract allocation exactly, including zero and fractional values", () => {
    expect(rewardPoolOptionLabel({ ...hex, allocation: 0n })).toContain("(Current: 0%)");
    expect(rewardPoolOptionLabel({ ...hex, allocation: 12n })).toContain("(Current: 0.12%)");
    expect(rewardPoolOptionLabel({ ...hex, allocation: 199n })).toContain("(Current: 1.99%)");
    expect(rewardPoolOptionLabel({ ...hex, allocation: 770n })).toContain("(Current: 7.7%)");
  });
  it("requires both the numeric ID and participant, ignoring address letter case", () => {
    expect(rewardPoolOptionLabel({ ...hex, participant: hex.participant.toLowerCase() })).toBe(rewardPoolOptionLabel(hex));
    expect(rewardPoolOptionLabel({ ...hex, id: 5n })).toBe("Pool #5 (Current: 2%)");
    expect(rewardPoolOptionLabel({ ...hex, participant: "0x1111111111111111111111111111111111111111" })).toBe("Pool #4 (Current: 2%)");
  });
  it("never applies stale Inactive metadata to the replacement participant in pool 28", () => {
    expect(rewardPoolOptionLabel({ id: 28n, participant: "0x4d1CF153b982466c8db3D41DBfAb15aBE12a9dFf", allocation: 0n }))
      .toBe("Pool #28 (Current: 0%)");
  });
  it("covers special named pools without creating selectable entries from metadata", () => {
    const ids = REWARD_POOL_NAMES.map(item => item.id);
    expect(new Set(ids).size).toBe(29);
    for (const id of [24, 31, 32]) {
      const item = REWARD_POOL_NAMES.find(entry => entry.id === id)!;
      expect(rewardPoolOptionLabel({ id: BigInt(id), participant: item.participant, allocation: 900n })).toContain(item.name);
    }
    expect(rewardPoolOptionLabel({ id: 33n, participant: hex.participant, allocation: 150n })).toBe("Pool #33 (Current: 1.5%)");
  });
});
