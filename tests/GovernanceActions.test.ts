import { describe, expect, it, vi } from "vitest";
import { Interface } from "ethers";
import { prepareGovernanceAction, verifyGovernanceActionOutcome, GOVERNANCE_FEE_SYNC, GOVERNANCE_TREASURY_WALLET, type GovernanceActionRequest } from "../src/features/governance/governanceTransactions";
import { verifySubmittedGovernanceReceipt } from "../src/features/governance/governanceReceipt";
import { GOVERNANCE_MODULE_IDS, GOVERNANCE_ADDRESSES as A, GOVERNANCE_CALLS, CREDIT_UNIT as U, type GovernanceModule } from "../src/features/governance/governanceSpec";
import { CONTRACTS } from "../src/config/contracts";
import { ACCOUNT, TOKEN, readerFixture } from "./governanceFixtures";

function fixture(module: GovernanceModule, options: { age?: bigint; votesFor?: bigint; votesAgainst?: bigint; valid?: boolean } = {}) {
  const now = BigInt(Math.floor(Date.now() / 1000)), age = options.age ?? 100n;
  const created = now - age, votesFor = options.votesFor ?? 100n * U, votesAgainst = options.votesAgainst ?? 0n, valid = options.valid ?? true;
  const rows: Record<GovernanceModule, unknown[]> = {
    allocation: [valid, 4n, 250n, votesFor, votesAgainst, 0n, created, 0n],
    rollover: [valid, created, votesFor, votesAgainst, 0n, TOKEN, 200n],
    tax: [valid, created, 10n, votesFor, votesAgainst, 0n],
    emissions: [valid, created, 100n, votesFor, votesAgainst, 0n, true, 0n],
    treasury: [valid, created, votesFor, votesAgainst, 0n, TOKEN, ACCOUNT, 10n, 0n],
    newtoken: [valid, created, votesFor, votesAgainst, 0n, TOKEN],
    fees: [valid, created, 0n, 200n, votesFor, votesAgainst, 0n],
    votecost: [valid, created, votesFor, votesAgainst, 0n, 5n * U],
    delay: [valid, created, votesFor, votesAgainst, 0n, 86400n],
  };
  const state = { row: rows[module], referralGetter: false, vaultMismatch: false };
  const reader = readerFixture(); const fallback = reader.read;
  reader.read = vi.fn(async (address, abi, method, args, block) => {
    if (method === "proposalLengths") return [1n, 1n, 1n, 1n];
    if (method === "treasuryRequestsCount") return 1n;
    if (["proposalFarmUpdate", "rolloverBonuses", "govTaxProposals", "governorTransferProposals", "treasuryProposal", "newPoolProposal", "vaultProposals", "minDepositProposals", "delayProposals"].includes(method)) return [...state.row];
    if (method === "tokenDTX") return A.token;
    if (method === "rewardContract") return CONTRACTS.referralRewards;
    if (method === "viewVaults") return [TOKEN];
    if (method === "depositFee") return state.vaultMismatch && address === TOKEN ? 201n : 200n;
    if (method === "fundingRate") return 25n;
    if (method === "referralBonus") { if (address === TOKEN) { state.referralGetter = true; throw Error("Vault has no referral getter"); } return 100n; }
    if (block === 43 && method === "poolAllocationPercentage" && module === "allocation") return 250n;
    if (block === 43 && method === "costToVote" && module === "votecost") return 5n * U;
    if (block === 43 && method === "delayBeforeEnforce" && module === "delay") return 86400n;
    if (block === 43 && method === "existingParticipant" && module === "newtoken") return true;
    if (method === "tax") return 10n;
    if (method === "DTXPerBlock") return 100n;
    if (method === "getRollBonus") return 200n;
    if (method === "treasuryWallet") return GOVERNANCE_TREASURY_WALLET;
    if (method === "balanceOf") return block === 43 ? 10n : 0n;
    return fallback(address, abi, method, args, block);
  });
  return { reader, state, now };
}
const request = (module: GovernanceModule, action: GovernanceActionRequest["action"] = "yes"): GovernanceActionRequest => ({ module, action, proposalId: "0", credit: "0.5" });
function voteLog(module: GovernanceModule, to: string, amount = U / 2n, voter = ACCOUNT) {
  const indexed = GOVERNANCE_CALLS[module].target === "farms" ? " indexed" : "";
  const type = { allocation: 0n, rollover: 3n, tax: 4n, emissions: 2n, treasury: 0n, newtoken: 2n, fees: 5n, votecost: 0n, delay: 1n }[module];
  const iface = new Interface([module === "treasury" ? "event AddVotes(uint256,uint256,address indexed,uint256,bool)" : `event AddVotes(uint256${indexed},uint256 indexed,address indexed,uint256,bool)`]);
  return { address: to, ...iface.encodeEventLog(iface.getEvent("AddVotes")!, [type, 0n, voter, amount, true]) };
}
function finalLog(module: GovernanceModule, to: string, success: boolean) {
  const indexed = GOVERNANCE_CALLS[module].target === "farms" ? " indexed" : "";
  const type = { allocation: 0n, rollover: 3n, tax: 4n, emissions: 2n, treasury: 0n, newtoken: 2n, fees: 5n, votecost: 0n, delay: 1n }[module];
  const iface = new Interface([module === "treasury" ? "event TreasuryEnforce(uint256 indexed,address indexed,bool)" : `event EnforceProposal(uint256${indexed},uint256 indexed,address indexed,bool)`]);
  const name = module === "treasury" ? "TreasuryEnforce" : "EnforceProposal";
  return { address: to, ...iface.encodeEventLog(iface.getEvent(name)!, module === "treasury" ? [0n, ACCOUNT, success] : [type, 0n, ACCOUNT, success]) };
}
describe("existing governance action preflight", () => {
  it.each(GOVERNANCE_MODULE_IDS)("prepares a positive fractional credit vote for %s at one fresh block", async module => {
    const { reader } = fixture(module);
    const prepared = await prepareGovernanceAction(request(module), ACCOUNT, 369n, reader);
    expect(prepared.call.creditConsumed).toBe(U / 2n);
    expect(prepared.call.to).toBe(A[GOVERNANCE_CALLS[module].target]);
    expect(reader.simulate).toHaveBeenCalledExactlyOnceWith(prepared.call, ACCOUNT, 42);
    expect(vi.mocked(reader.read).mock.calls.every(call => call[4] === 42)).toBe(true);
  });
  it("never enables the vote-no combined veto flag", async () => {
    const { reader } = fixture("tax");
    const prepared = await prepareGovernanceAction(request("tax", "no"), ACCOUNT, 369n, reader);
    expect(prepared.call.args).toEqual([0n, U / 2n, false]);
  });
  it("rejects zero, excess and stale voting credit or finished proposals", async () => {
    const { reader } = fixture("tax");
    await expect(prepareGovernanceAction({ ...request("tax"), credit: "0" }, ACCOUNT, 369n, reader)).rejects.toThrow("positive");
    await expect(prepareGovernanceAction({ ...request("tax"), credit: "10001" }, ACCOUNT, 369n, reader)).rejects.toThrow("Not enough");
    await expect(prepareGovernanceAction(request("tax"), ACCOUNT, 1n, reader)).rejects.toThrow("PulseChain");
    const finished = fixture("tax", { valid: false });
    await expect(prepareGovernanceAction(request("tax"), ACCOUNT, 369n, finished.reader)).rejects.toThrow("already finished");
    const stale = fixture("tax"); stale.reader.latestBlock = async () => ({ number: 42, timestamp: Math.floor(Date.now()/1000) - 121 });
    await expect(prepareGovernanceAction(request("tax"), ACCOUNT, 369n, stale.reader)).rejects.toThrow("stale");
  });
  it("checks the real vote/enforce boundaries and the fixed seven-day fee window", async () => {
    const boundary = fixture("tax", { age: 43200n });
    await expect(prepareGovernanceAction(request("tax"), ACCOUNT, 369n, boundary.reader)).rejects.toThrow("window has closed");
    await expect(prepareGovernanceAction(request("tax", "enforce"), ACCOUNT, 369n, boundary.reader)).rejects.toThrow("cannot be finalized");
    const fee = fixture("fees", { age: 43201n });
    await expect(prepareGovernanceAction(request("fees", "enforce"), ACCOUNT, 369n, fee.reader)).rejects.toThrow("cannot be finalized");
    await expect(prepareGovernanceAction(request("fees"), ACCOUNT, 369n, fee.reader)).resolves.toBeDefined();
  });
  it("distinguishes Basic strict veto start and Farms inclusive veto start", async () => {
    const farms = fixture("tax", { age: 0n, votesFor: 0n, votesAgainst: U });
    await expect(prepareGovernanceAction(request("tax", "veto"), ACCOUNT, 369n, farms.reader)).resolves.toBeDefined();
    const basic = fixture("delay", { age: 0n, votesFor: 0n, votesAgainst: U });
    await expect(prepareGovernanceAction(request("delay", "veto"), ACCOUNT, 369n, basic.reader)).rejects.toThrow("veto delay");
  });
  it("rejects the wrong Governor-Transfer subtype and unsupported tax execution", async () => {
    const emissions = fixture("emissions"); emissions.state.row[6] = false;
    await expect(prepareGovernanceAction(request("emissions"), ACCOUNT, 369n, emissions.reader)).rejects.toThrow("not an emissions");
    const tax = fixture("tax", { age: 43201n }); tax.state.row[2] = 101n;
    await expect(prepareGovernanceAction(request("tax", "enforce"), ACCOUNT, 369n, tax.reader)).rejects.toThrow("10%");
  });
  it("checks source-specific treasury finalization and veto boundaries", async () => {
    const treasury = fixture("treasury", { age: 86400n });
    await expect(prepareGovernanceAction(request("treasury", "enforce"), ACCOUNT, 369n, treasury.reader)).resolves.toBeDefined();
    const veto = fixture("treasury", { age: 43201n, votesFor: 0n, votesAgainst: U });
    await expect(prepareGovernanceAction(request("treasury", "veto"), ACCOUNT, 369n, veto.reader)).rejects.toThrow("vetoes close");
  });
});
describe("mined governance outcomes", () => {
  it.each(GOVERNANCE_MODULE_IDS)("requires the exact %s vote event and updated vote total", async module => {
    const { reader, state } = fixture(module);
    const prepared = await prepareGovernanceAction(request(module), ACCOUNT, 369n, reader);
    const index = ["allocation", "tax", "emissions"].includes(module) ? 3 : module === "fees" ? 4 : 2;
    state.row[index] = (state.row[index] as bigint) + U / 2n;
    const receipt = { blockNumber: 43, logs: [voteLog(module, prepared.call.to)] };
    expect(await verifyGovernanceActionOutcome(prepared, receipt, reader)).toMatchObject({ outcome: "voted" });
    await expect(verifyGovernanceActionOutcome(prepared, { ...receipt, logs: [voteLog(module, prepared.call.to, U)] }, reader)).rejects.toThrow("expected vote event");
  });
  it("distinguishes final rejection from applying a proposal", async () => {
    const { reader, state } = fixture("tax", { age: 43201n, votesFor: 0n, votesAgainst: U });
    const prepared = await prepareGovernanceAction(request("tax", "enforce"), ACCOUNT, 369n, reader);
    state.row[0] = false;
    expect(await verifyGovernanceActionOutcome(prepared, { blockNumber: 43, logs: [finalLog("tax", prepared.call.to, false)] }, reader)).toMatchObject({ outcome: "rejected" });
  });
  it("checks the applied parameter, not just receipt success", async () => {
    const { reader, state } = fixture("tax", { age: 43201n });
    const prepared = await prepareGovernanceAction(request("tax", "enforce"), ACCOUNT, 369n, reader);
    state.row[0] = false;
    expect(await verifyGovernanceActionOutcome(prepared, { blockNumber: 43, logs: [finalLog("tax", prepared.call.to, true)] }, reader)).toMatchObject({ outcome: "applied" });
  });
  it.each(GOVERNANCE_MODULE_IDS.filter(module => module !== "treasury"))("verifies the source-specific %s enforcement parameter", async module => {
    const { reader, state } = fixture(module, { age: module === "fees" ? 604801n : 43201n, votesFor: 1000n * U });
    const prepared = await prepareGovernanceAction(request(module, "enforce"), ACCOUNT, 369n, reader);
    state.row[0] = false;
    expect(await verifyGovernanceActionOutcome(prepared, { blockNumber: 43, logs: [finalLog(module, prepared.call.to, true)] }, reader)).toMatchObject({ outcome: "applied" });
  });
  it("does not call a no-return ERC20 treasury payout verified without a Transfer event", async () => {
    const { reader, state } = fixture("treasury", { age: 86400n });
    const prepared = await prepareGovernanceAction(request("treasury", "enforce"), ACCOUNT, 369n, reader);
    state.row[0] = false;
    const transfer = new Interface(["event ExecuteTransaction(address indexed,address indexed,uint256)"]);
    const log = { address: GOVERNANCE_TREASURY_WALLET, ...transfer.encodeEventLog(transfer.getEvent("ExecuteTransaction")!, [TOKEN, ACCOUNT, 10n]) };
    await expect(verifyGovernanceActionOutcome(prepared, { blockNumber: 43, logs: [finalLog("treasury", prepared.call.to, true), log] }, reader)).rejects.toThrow("token transfer");
  });
  it("verifies only vault-cached deposit/funding fees and reports partial sync", async () => {
    const { reader, state } = fixture("fees");
    const prepared = await prepareGovernanceAction({ module: "fees", action: "sync" }, ACCOUNT, 369n, reader);
    expect(prepared.call.to).toBe(GOVERNANCE_FEE_SYNC);
    expect(await verifyGovernanceActionOutcome(prepared, { blockNumber: 43 }, reader)).toMatchObject({ outcome: "synced" });
    expect(state.referralGetter).toBe(false);
    state.vaultMismatch = true;
    expect(await verifyGovernanceActionOutcome(prepared, { blockNumber: 43 }, reader)).toMatchObject({ outcome: "partial" });
  });
  it("pins transaction calldata, sender, destination and canonical block", async () => {
    const hash = "0x" + "a".repeat(64), blockHash = "0x" + "b".repeat(64);
    const call = { to: A.farms, data: "0x1234", value: 0n };
    const receipt = { status: 1, hash, blockNumber: 43, blockHash };
    const provider = { getTransaction: vi.fn(async () => ({ from: ACCOUNT, to: A.farms, data: "0x1234", value: 0n, blockHash })), getBlock: vi.fn(async () => ({ hash: blockHash })) };
    await expect(verifySubmittedGovernanceReceipt(provider, receipt, call, ACCOUNT)).resolves.toBe(hash);
    provider.getTransaction.mockResolvedValueOnce({ from: ACCOUNT, to: A.farms, data: "0x5678", value: 0n, blockHash });
    await expect(verifySubmittedGovernanceReceipt(provider, receipt, call, ACCOUNT)).rejects.toThrow("does not match");
  });
});
