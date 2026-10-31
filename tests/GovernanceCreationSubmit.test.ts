import { Interface } from "ethers";
import { beforeEach, expect, it, vi } from "vitest";
import { CREATION_EFFECTS, submitGovernanceCreation } from "../src/features/governance/creationTransactions";
// Exercise the verified submission flow independently of the default local pause.
vi.mock("../src/config/publicPreview", () => ({ GOVERNANCE_ACTIONS_DISABLED: false, assertGovernanceActionsEnabled: () => undefined }));
import { proposalSimulationReader } from "../src/features/governance/proposalPreflight";
import { encodeGovernanceCall } from "../src/features/governance/proposalValidation";
import { CREDIT_UNIT as U } from "../src/features/governance/governanceSpec";
import { ACCOUNT, draftFixture, readerFixture } from "./governanceFixtures";
const mocks=vi.hoisted(()=>({ provider: { estimateGas:vi.fn(),getFeeData:vi.fn(),getBalance:vi.fn(),getTransaction:vi.fn(),getBlock:vi.fn() } }));
vi.mock("../src/lib/chain",()=>({getPublicProvider:async()=>mocks.provider}));
vi.mock("../src/features/governance/proposalPreflight",async original=>({...await original<typeof import("../src/features/governance/proposalPreflight")>(),proposalSimulationReader:vi.fn()}));
const HASH="0x"+"a".repeat(64), BLOCK="0x"+"b".repeat(64);
const call=encodeGovernanceCall("tax","create",[1000n*U,10n,0n],1000n*U);
const iface=new Interface([CREATION_EFFECTS.tax.event]);
function setup() {
  const timestamp=Math.floor(Date.now()/1000);
  const original=readerFixture();
  const reader=readerFixture({ read:vi.fn(async (address,abi,method,args,block)=>method==="proposalLengths"?[0n,0n,0n,1n]:method==="govTaxProposals"?[true,BigInt(timestamp),10n,1000n*U,0n,0n]:original.read(address,abi,method,args,block)) });
  vi.mocked(proposalSimulationReader).mockResolvedValue(reader);
  const receipt={status:1,hash:HASH,blockNumber:42,blockHash:BLOCK,from:ACCOUNT,to:call.to,logs:[{address:call.to,...iface.encodeEventLog(iface.fragments[0],[0n,1000n*U,10n,ACCOUNT,0n])}]};
  const wait=vi.fn(async()=>receipt);
  const sendTransaction=vi.fn(async()=>({hash:HASH,from:ACCOUNT,nonce:1,wait}));
  const wallet={address:ACCOUNT,chainId:369n,getSigner:vi.fn(async()=>({getAddress:async()=>ACCOUNT,sendTransaction}))};
  mocks.provider.estimateGas.mockResolvedValue(100n); mocks.provider.getFeeData.mockResolvedValue({gasPrice:2n}); mocks.provider.getBalance.mockResolvedValue(1000n);
  mocks.provider.getTransaction.mockResolvedValue({from:ACCOUNT,to:call.to,data:call.data,value:0n,blockHash:BLOCK}); mocks.provider.getBlock.mockResolvedValue({hash:BLOCK,timestamp});
  return {reader,wallet,sendTransaction,receipt,wait};
}
beforeEach(()=>{vi.clearAllMocks();});
it("sends one exact checked creation and verifies its receipt and mined fields",async()=>{
  const {wallet,sendTransaction,wait}=setup();
  const result=await submitGovernanceCreation("tax",draftFixture(),wallet as never);
  expect(result).toMatchObject({id:"0",hash:HASH});
  expect(sendTransaction).toHaveBeenCalledExactlyOnceWith({to:call.to,data:call.data,value:0n,chainId:369n,gasLimit:120n});
  expect(wait).toHaveBeenCalledExactlyOnceWith(1,120_000);
});
it("does not open the wallet when credit or current-session checks fail",async()=>{
  const {wallet,sendTransaction}=setup();
  await expect(submitGovernanceCreation("tax",draftFixture({commitment:"99999999"}),wallet as never)).rejects.toThrow("credit");
  await expect(submitGovernanceCreation("tax",draftFixture(),wallet as never,()=>false)).rejects.toThrow("proposal changed");
  expect(wallet.getSigner).not.toHaveBeenCalled();expect(sendTransaction).not.toHaveBeenCalled();
});
it("does not claim creation success from a bare successful receipt lacking the expected event",async()=>{
  const {wallet,receipt,sendTransaction}=setup();receipt.logs=[];
  await expect(submitGovernanceCreation("tax",draftFixture(),wallet as never)).rejects.toThrow("confirmed, but the proposal outcome could not be verified");
  expect(sendTransaction).toHaveBeenCalledTimes(1);
});
