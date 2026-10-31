import { getAddress, toQuantity } from "ethers";
import { getPublicProvider } from "../../lib/chain";
import { governanceFormReader, readGovernanceFormContext, readProposalAsset, type FormContextReader, type GovernanceFormContext, type ProposalAsset } from "./formContext";
import { FORM_SNAPSHOT_MAX_AGE_MS, GOVERNANCE_CHAIN_ID, type GovernanceModule } from "./governanceSpec";
import { validateProposal, type GovernanceCall, type ProposalDraft, type ProposalValidation } from "./proposalValidation";

export type SimulationReader = FormContextReader & {
  simulate: (call: GovernanceCall, account: string, block: number) => Promise<string>;
};
export type ProposalPreflight = {
  context: GovernanceFormContext; asset?: ProposalAsset; validation: ProposalValidation;
  simulation?: { status: "passed" | "failed"; message: string };
};

/** Always re-read at a fresh, single block. Only eth_call; never a signer or send. */
export async function runProposalPreflight(module: GovernanceModule, draft: ProposalDraft, account: string, walletChain: bigint | null, reader: SimulationReader): Promise<ProposalPreflight> {
  if (walletChain !== GOVERNANCE_CHAIN_ID) throw new Error("Select PulseChain in your wallet before simulation. No network switch is requested automatically.");
  account = getAddress(account);
  const context = await readGovernanceFormContext(module, account, reader);
  let asset: ProposalAsset | undefined;
  if (module === "treasury" || module === "newtoken") {
    try { asset = await readProposalAsset(draft.tokenAddress.trim(), context, module, reader); }
    catch (error) {
      const validation = validateProposal(module, draft, context);
      validation.errors.tokenAddress = error instanceof Error ? error.message : "Token verification failed";
      return { context, validation };
    }
  }
  const validation = validateProposal(module, draft, context, asset);
  const call = validation.call;
  if (!call) return { context, asset, validation };
  try {
    if (Date.now() - context.timestamp * 1000 > FORM_SNAPSHOT_MAX_AGE_MS || context.timestamp * 1000 - Date.now() > 30_000) throw new Error("The contract rules are stale. Please try the action again shortly.");
    if (await reader.chainId() !== GOVERNANCE_CHAIN_ID) throw new Error("RPC network changed during verification");
    if (await reader.code(call.to, context.block) === "0x") throw new Error("The pinned proposal contract has no code at this block");
    const result = await reader.simulate(call, account, context.block);
    if (Date.now() - context.timestamp * 1000 > FORM_SNAPSHOT_MAX_AGE_MS) throw new Error("Simulation snapshot expired while waiting for the RPC. Run review again.");
    // All nine verified initializers have no return values. Unexpected responses fail closed.
    if (result !== "0x") throw new Error("Unexpected proposal simulation response");
    return { context, asset, validation, simulation: { status: "passed", message: "Creation simulation passed at this block. No signature requested and no transaction sent. This does not verify later voting, enforcement, or execution outcomes." } };
  } catch (error) {
    const detail = error as { shortMessage?: string; message?: string };
    return { context, asset, validation, simulation: { status: "failed", message: `Simulation did not pass: ${detail.shortMessage ?? detail.message ?? "RPC unavailable"}` } };
  }
}

export async function proposalSimulationReader(): Promise<SimulationReader> {
  const provider = await getPublicProvider();
  const reader = await governanceFormReader(provider);
  return { ...reader, simulate: (call, account, block) => provider.send("eth_call", [{ from: account, to: call.to, data: call.data, value: toQuantity(call.value) }, toQuantity(block)]) as Promise<string> };
}
