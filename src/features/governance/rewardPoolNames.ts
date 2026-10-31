import type { GovernanceFormContext } from "./formContext";
import { formatAllocationPercent } from "./rewardAllocation";

// Display-only names from DegenStrategy/DEGEN vaultData.json, checked 2026-09-05.
// https://raw.githubusercontent.com/DegenStrategy/DEGEN/refs/heads/main/vaultData.json
// Both ID and on-chain participant must match. Never use this catalog to supply
// selectable IDs, contract targets or allocations. Unknown/replaced pools keep
// neutral labels; in particular the source's old "Inactive" pool #28 does not match.
export const REWARD_POOL_NAMES = [
  { id: 4, participant: "0x7979bEe7F5Fe93F4b22d7A24C629803950610e56", name: "HEX-HTT3000 V2 LP", symbol: "HEX-HTT3000" },
  { id: 5, participant: "0xCAadb7032B8Fd0DD8386092b871d275c5c9684b0", name: "HEX-HTT5000 V2 LP", symbol: "HEX-HTT5000" },
  { id: 6, participant: "0xeea4a58838029d8Df7Cb0cE8a50045222551708A", name: "HEX-HTT7000 V2 LP", symbol: "HEX-HTT7000" },
  { id: 7, participant: "0x5055a3F634349437f4E87d915Cf85Ca836FF1FFC", name: "INC-PRINT V2 LP", symbol: "INC-PRINT" },
  { id: 8, participant: "0x988f2af54cE20D3d2F44177f953158B74341e1C9", name: "DAI-INCD V2 LP", symbol: "DAI-INCD" },
  { id: 9, participant: "0xB57aA188ab1B01B48e6d71F98264503C8B212B70", name: "EMIT", symbol: "EMIT" },
  { id: 10, participant: "0x61CB65c28040c26B1Fc31eFa17B4566c69199cC2", name: "EMIT-PLS V2 LP", symbol: "EMIT-PLS" },
  { id: 11, participant: "0x221e0B764Bb29d720C747a5885B0cE71d0a202Ac", name: "DAI-PLS V1 LP", symbol: "DAI-PLS" },
  { id: 12, participant: "0x30d1895243d7E5A6db345158879DBe6CBBE03FE6", name: "INC-PLSX V1 LP", symbol: "INC-PLSX" },
  { id: 13, participant: "0x7196998B37774b4652c389c359f30FC8d9EC7f53", name: "PLS-PLSX V1 LP", symbol: "PLS-PLSX" },
  { id: 14, participant: "0x437Cd9eaFaF8E062069f04C11994ed38ABd73D34", name: "HEX-PLS V1 LP", symbol: "HEX-PLS" },
  { id: 15, participant: "0x6d6Ed53A3647B96d147850495e57F6E7F52cA0bf", name: "DAI-9INCH 9INCH V2 LP", symbol: "DAI-9INCH" },
  { id: 16, participant: "0x3a37c64B56F0F7cF7F402688753B1692BB46BC32", name: "vPLS-PLS V2 LP", symbol: "vPLS-PLS" },
  { id: 17, participant: "0xc4dA722b1D7b13B46786f79F46F274fe16E096Ae", name: "HOC-PLS V2 LP", symbol: "HOC-PLS" },
  { id: 18, participant: "0x9Ba60bB19f21a01a0323F54BB001497f00B7A304", name: "PRINT-sPRINT V2 LP", symbol: "PRINT-sPRINT" },
  { id: 19, participant: "0x61B374Fd8Fa06767927bfb11B947d165C06a8c5E", name: "OINK-PLS V2 LP", symbol: "OINK-PLS" },
  { id: 20, participant: "0xBCb904a9422F223f5A79660f026310D4bd8C9941", name: "OINK-DEGEN V2 LP", symbol: "OINK-DEGEN" },
  { id: 21, participant: "0xc667a6EC483edB71f6329413FbcFE8042348956C", name: "EMIT-PLSX V2 LP", symbol: "EMIT-PLSX" },
  { id: 22, participant: "0xBCFd877b255fF3c2416e2fe5DA7EC8778cC5b57d", name: "ISLAND-PLS V2 LP", symbol: "ISLAND-PLS" },
  { id: 23, participant: "0xd100e649956aCAa3B6F90D58546219C373d28ce2", name: "IMPLS-INC V2 LP", symbol: "IMPLS-INC" },
  { id: 24, participant: "0x8Ac62EDa6dD2045d898AB5a0a9E360d4Ae26F77d", name: "Treasury Miner", symbol: "Treasury Miner" },
  { id: 25, participant: "0x6a89ef54f612bcf35582bad159760223eec20690", name: "PLSX-9INCH 9INCH V2 LP", symbol: "PLSX-9INCH" },
  { id: 26, participant: "0x52763911bDe0651D0709120d51afE3E33c5EccA5", name: "USDC-PLS PulseX V1 LP", symbol: "USDC-PLS" },
  { id: 27, participant: "0x43724568cAb0CCf712eF5dfA40E9Aec68fff5a95", name: "USDT-PLS PulseX V1 LP", symbol: "USDT-PLS" },
  { id: 28, participant: "0x2e3f97dbff7EE9a82c60F9088C92833789589A23", name: "Inactive", symbol: "Inactive" },
  { id: 29, participant: "0xF3EAbb9297B8c7EacFf46190BE97D04bA5b707e2", name: "HEX-HTT4000 V2 LP", symbol: "HEX-HTT4000" },
  { id: 30, participant: "0x38906e4747e6669D26928F39Fd9f3ddd2f299d46", name: "HEX-HTT6000 V2 LP", symbol: "HEX-HTT6000" },
  { id: 31, participant: "0x2EcB9c5460468e916FB8847CF5E903afc9aFE646", name: "(OLD) DegenStrategy NFT Miner", symbol: "(OLD) DegenStrategy NFT Miner" },
  { id: 32, participant: "0x7B2DcC0D0180D6863e4D6Fa14903459638c5b45B", name: "DegenStrategy NFT Miner", symbol: "DegenStrategy NFT Miner" },
] as const;

type RewardPool = GovernanceFormContext["pools"][number];

export function rewardPoolOptionLabel(pool: RewardPool): string {
  const metadata = REWARD_POOL_NAMES.find(item =>
    BigInt(item.id) === pool.id && item.participant.toLowerCase() === pool.participant.toLowerCase(),
  );
  const name = metadata ? `${metadata.name}(${metadata.symbol})` : `Pool #${pool.id}`;
  return `${name} (Current: ${formatAllocationPercent(pool.allocation)})`;
}
