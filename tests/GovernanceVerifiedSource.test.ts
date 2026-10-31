import { describe, expect, it } from "vitest";
import { Interface } from "ethers";
import { GOVERNANCE_ADDRESSES, GOVERNANCE_CALLS, GOVERNANCE_MODULE_IDS } from "../src/features/governance/governanceSpec";
import verified from "./fixtures/governanceVerifiedAbi.json";
import historical from "./fixtures/governanceHistoricalReceipts.json";
import archivedState from "./fixtures/governanceHistoricalState.json";
import deployments from "./fixtures/governanceDeployments.json";
import { CREATION_EFFECTS } from "../src/features/governance/creationTransactions";

const contractNames = { farms: "Farms", basic: "Basic", treasury: "Treasury" } as const;
const interfaces = new Map(Object.values(verified).map(contract => [contract.address.toLowerCase(), new Interface(contract.abi)]));
function events(sample: typeof historical[number]) {
  return sample.receipt.logs.flatMap(log => {
    try { const event = interfaces.get(log.address.toLowerCase())?.parseLog(log); return event ? [{ address: log.address.toLowerCase(), event }] : []; }
    catch { return []; }
  });
}
describe("publicly verified governance ABI evidence", () => {
  it.each(GOVERNANCE_MODULE_IDS)("matches every %s transaction signature, target and return shape to the verified ABI", module => {
    const spec = GOVERNANCE_CALLS[module], contract = verified[contractNames[spec.target]];
    expect(contract.address.toLowerCase()).toBe(GOVERNANCE_ADDRESSES[spec.target].toLowerCase());
    const iface = new Interface(contract.abi);
    for (const action of ["create", "yes", "no", "veto", "enforce"] as const) {
      const fn = iface.getFunction(spec[action]);
      expect(fn?.format("sighash")).toBe(spec[action]);
      expect(fn?.stateMutability).toBe("nonpayable");
      expect(fn?.outputs).toEqual([]);
    }
    const effect = CREATION_EFFECTS[module];
    const expectedEvent = new Interface([effect.event]).fragments.find(fragment => fragment.type === "event")!;
    const actualEvent = iface.getEvent(expectedEvent.format("sighash"))!;
    expect(actualEvent.format("full")).toBe(expectedEvent.format("full"));
    expect(iface.getFunction(effect.getter)!.outputs.map(output => output.type).join(",")).toBe(effect.returns);
  });
  it("records one chain head and non-proxy deployed runtime fingerprints for every enabled dependency", () => {
    expect(deployments.chainId).toBe(369);
    expect(deployments.contracts).toHaveLength(10);
    expect(deployments.blockHash).toMatch(/^0x[0-9a-f]{64}$/i);
    for (const contract of deployments.contracts) {
      expect(contract.isProxy).toBe(false);
      expect(contract.runtimeBytes).toBeGreaterThan(0);
      expect(contract.runtimeKeccak256).toMatch(/^0x[0-9a-f]{64}$/i);
      expect(contract.sourceSha256).toMatch(/^[0-9a-f]{64}$/i);
    }
  });
  it("preserves differing event indexing across Farms, Basic and Treasury", () => {
    const farms = new Interface(verified.Farms.abi), basic = new Interface(verified.Basic.abi), treasury = new Interface(verified.Treasury.abi);
    expect(farms.getEvent("AddVotes")!.inputs.map(x => !!x.indexed)).toEqual([true, true, true, false, false]);
    expect(basic.getEvent("AddVotes")!.inputs.map(x => !!x.indexed)).toEqual([false, true, true, false, false]);
    expect(treasury.getEvent("AddVotes")!.inputs.map(x => !!x.indexed)).toEqual([false, false, true, false, false]);
    expect(farms.getEvent("EnforceProposal")!.inputs.map(x => !!x.indexed)).toEqual([true, true, true, false]);
    expect(basic.getEvent("EnforceProposal")!.inputs.map(x => !!x.indexed)).toEqual([false, true, true, false]);
  });
});
describe("historical governance receipt evidence (no new transactions)", () => {
  it.each(historical.map((sample, index) => [sample.method, index] as const))("decodes historical %s calldata and pinned-target receipt", (_method, index) => {
    const sample = historical[index], iface = interfaces.get(sample.to.toLowerCase())!;
    expect(iface.parseTransaction({ data: sample.data })?.name).toBe(sample.method);
    expect(sample.receipt.status).toBe("0x1");
    expect(sample.receipt.transactionHash).toBe(sample.hash);
    expect(sample.receipt.to.toLowerCase()).toBe(sample.to.toLowerCase());
    expect(events(sample).some(({ event }) => ["InitiateFarmProposal", "EnforceProposal", "ProposeNewPool", "InitiateRolloverBonus", "ProposeGovernorTransfer", "TreasuryProposal", "TreasuryEnforce"].includes(event.name))).toBe(true);
  });
  it("recognizes a mined TreasuryEnforce(false) as rejection rather than transfer success", () => {
    const outcomes = historical.filter(x => x.method === "approveTreasuryTransfer").map(sample => ({ sample, logs: events(sample) }));
    const rejected = outcomes.find(x => x.logs.some(({ event }) => event.name === "TreasuryEnforce" && event.args[2] === false))!;
    expect(rejected).toBeDefined();
    expect(rejected.logs.some(({ event }) => event.name === "ExecuteTransaction")).toBe(false);
    const passed = outcomes.find(x => x.logs.some(({ event }) => event.name === "TreasuryEnforce" && event.args[2] === true))!;
    expect(passed.logs.some(({ address, event }) => address === verified.TreasuryWallet.address.toLowerCase() && event.name === "ExecuteTransaction")).toBe(true);
    expect(passed.logs.some(({ event }) => event.name === "Transfer" && String(event.args[0]).toLowerCase() === verified.TreasuryWallet.address.toLowerCase())).toBe(true);
  });
  it("corroborates requested parameter values with archive reads at the enforcement block", () => {
    const expected = [
      ["Farms", "poolAllocationPercentage", "initiateFarmProposal", 2],
      ["Governor", "getRollBonus", "initiateProposalRolloverBonus", 2],
      ["MasterChef", "DTXPerBlock", "proposeGovernorTransfer", 1],
    ] as const;
    for (const [contract, method, initializer, argument] of expected) {
      const state = archivedState.find(row => row.contract === contract && row.method === method)!;
      const creation = historical.find(sample => sample.method === initializer)!;
      expect(state.result[0]).toBe(creation.args[argument]);
    }
    expect(archivedState.find(row => row.method === "existingParticipant")!.result).toEqual([true]);
  });
  it("corroborates the emissions branch with the actual MasterChef UpdateEmissions event", () => {
    const sample = historical.find(x => x.method === "executeGovernorTransfer")!;
    const logs = events(sample);
    expect(logs.some(({ address, event }) => address === verified.MasterChef.address.toLowerCase() && event.name === "UpdateEmissions" && event.args[1] === 2500000n * 10n ** 18n)).toBe(true);
    expect(logs.some(({ event }) => event.name === "EnforceProposal" && event.args[0] === 2n && event.args[3] === true)).toBe(true);
  });
});
