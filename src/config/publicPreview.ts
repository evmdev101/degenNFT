// Source-controlled testing pause, matching OINK. Browser preferences and URL
// parameters cannot enable governance transactions. Read-only checks stay usable.
export const GOVERNANCE_ACTIONS_DISABLED = true;
export const GOVERNANCE_ACTIONS_NOTICE = "Governance actions are temporarily disabled while we finish and test this section. Farm and miner transactions remain available.";

export function assertGovernanceActionsEnabled(): void {
  if (GOVERNANCE_ACTIONS_DISABLED) {
    throw Object.assign(new Error(GOVERNANCE_ACTIONS_NOTICE), {
      code: 4100,
      walletRequestStarted: false,
    });
  }
}
