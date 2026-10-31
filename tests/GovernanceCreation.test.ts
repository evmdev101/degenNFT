import { Interface, EventFragment } from "ethers";
import { describe, expect, it, vi } from "vitest";
import { CREATION_EFFECTS, CreationValidationError, prepareGovernanceCreation, verifyGovernanceCreation, type CreationRead, type CreationReceiptReader } from "../src/features/governance/creationTransactions";
import { GOVERNANCE_ADDRESSES, GOVERNANCE_CALLS, GOVERNANCE_MODULE_IDS, CREDIT_UNIT as U, type GovernanceModule } from "../src/features/governance/governanceSpec";
import { encodeGovernanceCall } from "../src/features/governance/proposalValidation";
import { ACCOUNT, TOKEN, draftFixture, readerFixture } from "./governanceFixtures";
import verifiedEvidence from "./fixtures/governanceVerifiedAbi.json";
const HASH = "0x" + "a".repeat(64), BLOCK = "0x" + "b".repeat(64);
const args: Record<GovernanceModule, readonly (bigint | string | boolean)[]> = {
  allocation: [1000n*U,4n,100n,0n,0n], rollover: [1000n*U,TOKEN,100n,0n], tax: [1000n*U,10n,0n],
  emissions: [1000n*U,U,true,0n,0n], treasury: [1000n*U,TOKEN,ACCOUNT,1234567n,0n], newtoken: [1000n*U,TOKEN,0n],
  fees: [1000n*U,0n,100n,0n], votecost: [1000n*U,U,0n], delay: [0n,86400n,0n],
};
function created(module: GovernanceModule) {
  const a = args[module];
  const call = encodeGovernanceCall(module,"create",a,a[0] as bigint);
  const eventArgs: Record<GovernanceModule, unknown[]> = {
    allocation: [7n,a[0],a[1],a[2],0n,ACCOUNT,a[4]], rollover:[7n,a[0],a[1],a[2],ACCOUNT,a[3]], tax:[7n,a[0],a[1],ACCOUNT,a[2]],
    emissions:[7n,a[0],a[1],ACCOUNT,a[2],a[3],a[4]], treasury:[7n,a[0],a[1],a[2],a[3],99n,ACCOUNT,a[4]],
    newtoken:[7n,a[0],a[1],ACCOUNT,a[2]], fees:[7n,a[0],a[1],a[2],ACCOUNT,a[3]], votecost:[7n,a[0],a[1],ACCOUNT,a[2]], delay:[7n,a[0],a[1],ACCOUNT,a[2]],
  };
  const states: Record<GovernanceModule, unknown[]> = {
    allocation:[true,a[1],a[2],a[0],0n,a[4],1000n,0n], rollover:[true,1000n,a[0],0n,a[3],a[1],a[2]], tax:[true,1000n,a[1],a[0],0n,a[2]],
    emissions:[true,1000n,a[1],a[0],0n,a[4],true,0n], treasury:[true,1000n,a[0],0n,a[4],a[1],a[2],a[3],99n],
    newtoken:[true,1000n,a[0],0n,a[2],a[1]], fees:[true,1000n,a[1],a[2],a[0],0n,a[3]], votecost:[true,1000n,a[0],0n,a[2],a[1]], delay:[true,1000n,a[0],0n,a[2],a[1]],
  };
  const iface = new Interface([CREATION_EFFECTS[module].event]);
  const event = iface.fragments[0];
  const log = iface.encodeEventLog(event, eventArgs[module]);
  const receipt = { status:1,hash:HASH,blockNumber:42,blockHash:BLOCK,from:ACCOUNT,to:call.to,logs:[{address:call.to,...log}] };
  const reader: CreationReceiptReader = {
    getTransaction:vi.fn(async()=>({hash:HASH,blockHash:BLOCK,from:ACCOUNT,to:call.to,data:call.data,value:0n})),
    getBlock:vi.fn(async()=>({hash:BLOCK})), blockTimestamp:vi.fn(async()=>1000),
    read:vi.fn(async (_address,_abi,method)=>method===CREATION_EFFECTS[module].getter?states[module]:module==="treasury"?8n:[8n,8n,8n,8n]),
  };
  return {call,receipt,reader,states};
}
describe("source-verified creation effects",()=>{
  it.each(GOVERNANCE_MODULE_IDS)("verifies %s exact event and mined getter terms",async module=>{
    const {reader,receipt,call}=created(module);
    await expect(verifyGovernanceCreation(reader,receipt,call,ACCOUNT)).resolves.toEqual({id:"7",hash:HASH});
    expect(reader.read).toHaveBeenCalledWith(call.to,expect.any(Array),CREATION_EFFECTS[module].getter,[7n],42);
  });
  it("rejects changed actor, missing event, changed getter and mismatched transaction bytes",async()=>{
    const missing=created("tax"); missing.receipt.logs=[];
    await expect(verifyGovernanceCreation(missing.reader,missing.receipt,missing.call,ACCOUNT)).rejects.toThrow("event");
    const changed=created("tax"); changed.states.tax[2]=99n;
    await expect(verifyGovernanceCreation(changed.reader,changed.receipt,changed.call,ACCOUNT)).rejects.toThrow("state");
    const wrong=created("tax"); wrong.reader.getTransaction=async()=>({from:ACCOUNT,to:wrong.call.to,data:"0x12345678",value:0n,blockHash:BLOCK});
    await expect(verifyGovernanceCreation(wrong.reader,wrong.receipt,wrong.call,ACCOUNT)).rejects.toThrow("does not match");
    const reorg=created("tax");
    vi.mocked(reorg.reader.getBlock).mockResolvedValueOnce({hash:BLOCK}).mockResolvedValueOnce({hash:"0x"+"c".repeat(64)});
    await expect(verifyGovernanceCreation(reorg.reader,reorg.receipt,reorg.call,ACCOUNT)).rejects.toThrow("block changed");
    const actor=created("tax");
    await expect(verifyGovernanceCreation(actor.reader,actor.receipt,actor.call,TOKEN)).rejects.toThrow("does not match");
  });
});
const prepareReader = (extra: Partial<CreationRead> = {}): CreationRead => ({ ...readerFixture(),estimateGas:vi.fn(async()=>100n),feePerGas:vi.fn(async()=>2n),balance:vi.fn(async()=>1000n),...extra });
describe("creation preflight and fee budget",()=>{
  it("uses fresh contract rules, exact encoded terms and a newest-head simulation",async()=>{
    const reader=prepareReader();
    const prepared=await prepareGovernanceCreation("tax",draftFixture(),ACCOUNT,369n,reader);
    expect(prepared.gasLimit).toBe(120n);
    expect(prepared.call.args).toEqual([1000n*U,10n,0n]);
    expect(reader.simulate).toHaveBeenCalledTimes(2);
  });
  it("blocks stale credit, wrong chain, unavailable fees and insufficient PLS before a send",async()=>{
    await expect(prepareGovernanceCreation("tax",draftFixture({commitment:"9999999"}),ACCOUNT,369n,prepareReader())).rejects.toBeInstanceOf(CreationValidationError);
    await expect(prepareGovernanceCreation("tax",draftFixture(),ACCOUNT,1n,prepareReader())).rejects.toThrow("PulseChain");
    await expect(prepareGovernanceCreation("tax",draftFixture(),ACCOUNT,369n,prepareReader({feePerGas:async()=>0n}))).rejects.toThrow("network fee");
    await expect(prepareGovernanceCreation("tax",draftFixture(),ACCOUNT,369n,prepareReader({balance:async()=>1n}))).rejects.toThrow("enough PLS");
  });
});

it("matches every enabled creation call and event to the saved explorer-verified ABI", () => {
  for (const module of GOVERNANCE_MODULE_IDS) {
    const target=GOVERNANCE_CALLS[module].target;
    const filename=({farms:"Farms",basic:"Basic",treasury:"Treasury"} as const)[target];
    const record=verifiedEvidence[filename];
    expect(record.isProxy).toBe(false);
    expect(record.address.toLowerCase()).toBe(GOVERNANCE_ADDRESSES[target].toLowerCase());
    const verified=new Interface(record.abi);
    const call=verified.getFunction(GOVERNANCE_CALLS[module].create);
    expect(call?.format("sighash")).toBe(GOVERNANCE_CALLS[module].create);
    expect(call?.outputs).toHaveLength(0);
    const event=EventFragment.from(CREATION_EFFECTS[module].event);
    const deployedEvent=verified.getEvent(event.format("sighash"));
    expect(deployedEvent?.topicHash).toBe(event.topicHash);
    expect(deployedEvent?.inputs.map(input=>Boolean(input.indexed))).toEqual(event.inputs.map(input=>Boolean(input.indexed)));
    expect(verified.getFunction(CREATION_EFFECTS[module].getter)).toBeTruthy();
  }
});
