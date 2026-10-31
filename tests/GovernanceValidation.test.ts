import { describe, expect, it } from "vitest";
import { GOVERNANCE_MODULE_IDS, MAX_UINT256, type GovernanceModule } from "../src/features/governance/governanceSpec";
import { encodeProposalAction, parseGovernanceAmount, validateProposal } from "../src/features/governance/proposalValidation";
import { ACCOUNT, TOKEN, assetFixture, contextFixture, draftFixture } from "./governanceFixtures";

// Independently pinned selectors from extracted ABI + audited source eb964b1.
// Word construction is deliberately independent of ethers.Interface.
const U = 10n ** 18n;
const SELECTORS: Record<GovernanceModule, string[]> = {
  allocation: ["1f45f605", "3da13129", "1a7aa556", "30726048", "4da3a462"],
  rollover: ["d8c8577a", "9162295f", "84e1ef91", "7c3b98ed", "c9e52e2f"],
  tax: ["95a09a75", "f679b9ec", "eb6e9ff4", "dc73276b", "3200b003"],
  emissions: ["60de2460", "44707238", "c53ceaeb", "d0bf4f02", "e09af3bd"],
  treasury: ["e51d4f0d", "d17cf413", "96b6da00", "b798f196", "e5715c18"],
  newtoken: ["dfa907a7", "37e4f528", "9348c50c", "4b591ca5", "9ff8aaa8"],
  fees: ["784be684", "fc14ef4e", "a5a2fe14", "2d63260d", "c3c18d59"],
  votecost: ["88f22096", "b5993567", "1a225b5b", "a74441ab", "4c871574"],
  delay: ["03dd8a31", "2e3548c0", "62d5145b", "fcb63f21", "a9645aa7"],
};
const word = (value: bigint | string | boolean) => (typeof value === "boolean" ? (value ? "1" : "0") : typeof value === "bigint" ? value.toString(16) : value.slice(2).toLowerCase()).padStart(64, "0");
const bytes = (selector: string, args: (bigint | string | boolean)[]) => `0x${selector}${args.map(word).join("")}`;
const target = (module: GovernanceModule) => module === "treasury" ? "0xF97148335B4C104cfcC0d6abbCCC58c6408BacDF"
  : ["rollover", "newtoken", "votecost", "delay"].includes(module) ? "0xb30702C84Fc7ADA23d613B9D0c447009d8183785" : "0xCcA87BE305394E3145C9e84464656eF4939B666B";

describe("exact proposal calldata", () => {
  const args: Record<GovernanceModule, (bigint | string | boolean)[]> = {
    allocation: [1000n * U, 4n, 100n, 0n, 3600n], rollover: [1000n * U, TOKEN, 100n, 3600n],
    tax: [1000n * U, 10n, 3600n], emissions: [1000n * U, U, true, 0n, 3600n],
    treasury: [1000n * U, TOKEN, ACCOUNT, 1000000n, 3600n], newtoken: [1000n * U, TOKEN, 3600n],
    fees: [1000n * U, 0n, 100n, 3600n], votecost: [1000n * U, U, 3600n], delay: [1000n * U, 86400n, 3600n],
  };
  it.each(GOVERNANCE_MODULE_IDS)("pins %s create target, arguments, units and full bytes", module => {
    const draft = draftFixture({ extraDelay: "1", ...(module === "delay" ? { value: "24" } : {}) });
    const result = validateProposal(module, draft, contextFixture(), assetFixture({ module }));
    expect(result.errors).toEqual({});
    expect(result.call).toMatchObject({ chainId: 369n, to: target(module), value: 0n, creditConsumed: 1000n * U, args: args[module] });
    expect(result.call?.data).toBe(bytes(SELECTORS[module][0], args[module]));
  });
  const cases = GOVERNANCE_MODULE_IDS.flatMap(module => (["yes", "no", "veto", "enforce"] as const).map((action, index) => ({ module, action, selector: SELECTORS[module][index + 1] })));
  it.each(cases)("pins $module $action full calldata", ({ module, action, selector }) => {
    const args = action === "yes" ? [7n, U / 2n] : action === "no" ? [7n, U / 2n, true] : action === "enforce" && module === "allocation" ? [7n, true] : [7n];
    const call = encodeProposalAction(module, action, "7", "0.5", true);
    expect(call.data).toBe(bytes(selector, args));
    expect(call).toMatchObject({ to: target(module), value: 0n, chainId: 369n, creditConsumed: action === "yes" || action === "no" ? U / 2n : 0n });
  });
  it("does not sneak an automatic veto into ordinary opposition votes", () => {
    expect(encodeProposalAction("tax", "no", "7", "0").args).toEqual([7n, 0n, false]);
  });
});

describe("exact decimal parser", () => {
  it.each(["", "-1", "+1", "1e3", "1,000", "NaN", "Infinity", ".5", "1.", "01"])("rejects ambiguous input %s", value => expect(() => parseGovernanceAmount(value, 18)).toThrow());
  it("keeps precision above Number.MAX_SAFE_INTEGER and rejects silent rounding", () => {
    expect(parseGovernanceAmount("9007199254740993.000000000000000001", 18)).toBe(9007199254740993n * U + 1n);
    expect(() => parseGovernanceAmount("0.001", 2)).toThrow(/at most 2/);
    expect(() => parseGovernanceAmount("1.0", 0)).toThrow(/whole/);
    expect(parseGovernanceAmount(MAX_UINT256.toString(), 0)).toBe(MAX_UINT256);
    expect(() => parseGovernanceAmount((MAX_UINT256 + 1n).toString(), 0)).toThrow(/range/);
    expect(parseGovernanceAmount(`0.${"0".repeat(254)}1`, 255)).toBe(1n);
  });
});

describe("contract and site-policy boundaries", () => {
  const check = (module: GovernanceModule, value: string, context = contextFixture(), extra = {}) => validateProposal(module, draftFixture({ value, ...extra }), context, assetFixture({ module }));
  it("requires verified rules and a wallet credit balance, not a token balance", () => {
    expect(validateProposal("tax", draftFixture()).errors.context).toBeTruthy();
    expect(check("tax", "1", contextFixture({ account: undefined, credit: undefined })).errors.context).toMatch(/Connect/);
    expect(check("tax", "1", contextFixture({ credit: 999n * U })).errors.commitment).toMatch(/Not enough/);
  });
  it("validates reward IDs and strict total allocation below 100%", () => {
    expect(check("allocation", "35.17").call).toBeDefined();
    expect(check("allocation", "35.18").errors.value).toMatch(/100%/);
    expect(check("allocation", "1", contextFixture(), { poolId: "3" }).errors.poolId).toBeTruthy();
    expect(check("allocation", "1", contextFixture(), { poolId: "49" }).errors.poolId).toBeTruthy();
  });
  it("caps rollover and tax at their different precision boundaries", () => {
    expect(check("rollover", "10").call).toBeDefined();
    expect(check("rollover", "10.01").errors.value).toBeTruthy();
    expect(check("rollover", "1", contextFixture(), { poolAddress: ACCOUNT }).errors.poolAddress).toBeTruthy();
    expect(check("tax", "10").call).toBeDefined();
    expect(check("tax", "10.1").errors.value).toMatch(/rejects execution/);
    expect(check("tax", "1.01").errors.value).toBeTruthy();
  });
  it.each([ ["emissions", "999", "1000"], ["treasury", "99", "100"] ])("applies %s's own credit multiplier", (module, below, minimum) => {
    expect(check(module as GovernanceModule, "1", contextFixture(), { commitment: below }).errors.commitment).toBeTruthy();
    expect(check(module as GovernanceModule, "1", contextFixture(), { commitment: minimum }).call).toBeDefined();
  });
  it("does not treat the historical private new-pool multiplier as a live minimum", () => {
    const draft = draftFixture({ commitment: "1" });
    const result = validateProposal("newtoken", draft, contextFixture(), assetFixture({ module: "newtoken" }));
    expect(result.errors.commitment).toBeUndefined();
    expect(result.call).toBeDefined(); // authoritative live minimum is checked by preflight simulation
  });
  it("uses exact custom-token precision and refuses stale/mismatched eligibility", () => {
    const draft = draftFixture({ value: "1.234567" });
    expect(validateProposal("treasury", draft, contextFixture(), assetFixture()).call?.args[3]).toBe(1234567n);
    expect(check("treasury", "1.2345678").errors.value).toBeTruthy();
    expect(validateProposal("newtoken", draft, contextFixture(), assetFixture()).errors.tokenAddress).toBeTruthy();
    expect(validateProposal("newtoken", draft, contextFixture(), assetFixture({ module: "newtoken", existingPool: true })).errors.tokenAddress).toMatch(/already registered/);
    expect(validateProposal("treasury", draft, contextFixture(), assetFixture({ block: 41 })).errors.tokenAddress).toBeTruthy();
    expect(check("newtoken", "1", contextFixture({ poolCount: 49n })).call).toBeDefined();
    expect(check("newtoken", "1", contextFixture({ poolCount: 50n })).errors.context).toBeTruthy();
    expect(check("treasury", "0").errors.value).toMatch(/positive/);
    expect(check("treasury", "1", contextFixture(), { recipient: "0x0000000000000000000000000000000000000000" }).errors.recipient).toBeTruthy();
  });
  it("encodes native PLS amount as an argument, never transaction value", () => {
    const address = "0x0000000000000000000000000000000000000000";
    const call = validateProposal("treasury", draftFixture({ tokenAddress: address, value: "1.5" }), contextFixture(), assetFixture({ address, decimals: 18 })).call;
    expect(call?.args[3]).toBe(U * 3n / 2n); expect(call?.value).toBe(0n);
  });
  it("checks fee type, source safety caps and fixed seven-day extra delay", () => {
    expect(check("fees", "25").call).toBeDefined(); expect(check("fees", "25.01").errors.value).toBeTruthy();
    expect(check("fees", "0.1", contextFixture(), { feeType: "1", extraDelay: "168" }).call?.args).toEqual([1000n * U, 1n, 1000n, 604800n]);
    expect(check("fees", "0.1001", contextFixture(), { feeType: "1" }).errors.value).toBeTruthy();
    expect(check("fees", "1", contextFixture(), { feeType: "3" }).errors.feeType).toBeTruthy();
    expect(check("fees", "1", contextFixture(), { extraDelay: "169" }).errors.extraDelay).toBeTruthy();
  });
  it("checks new vote cost against the current supply getter floor and both minimums", () => {
    expect(check("votecost", "2", contextFixture(), { commitment: "1" }).errors.commitment).toBeTruthy();
    expect(check("votecost", "0", contextFixture(), { commitment: "0" }).errors.commitment).toBeTruthy();
    expect(check("votecost", "1", contextFixture({ totalSupply: 10000n * U + 9999n })).call).toBeDefined();
    expect(check("votecost", "1.000000000000000001", contextFixture({ totalSupply: 10000n * U + 9999n })).errors.value).toBeTruthy();
    expect(check("tax", "1", contextFixture({ cost: U + 1n }), { commitment: "1" }).errors.commitment).toMatch(/at least 2 whole/);
  });
  it("allows zero-commitment delay proposals, 24–336 hours, and verifies extra delay", () => {
    expect(check("delay", "24", contextFixture({ credit: 0n }), { commitment: "0" }).call?.args).toEqual([0n, 86400n, 0n]);
    expect(check("delay", "336").call).toBeDefined(); expect(check("delay", "337").errors.value).toBeTruthy();
    expect(check("delay", "23").errors.value).toBeTruthy(); expect(check("delay", "24.5").errors.value).toBeTruthy();
    expect(check("tax", "1", contextFixture(), { extraDelay: "12" }).call).toBeDefined();
    expect(check("tax", "1", contextFixture(), { extraDelay: "13" }).errors.extraDelay).toBeTruthy();
    expect(check("tax", "1", contextFixture(), { commitment: MAX_UINT256.toString() }).errors.commitment).toBeTruthy();
  });
});
