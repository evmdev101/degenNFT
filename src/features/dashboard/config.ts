import { CONTRACTS } from "../../config/contracts";
import { TOKEN_LOGOS } from "../../config/tokenLogos";

export const TREASURY = "0xD540b89Ee52F81bE921Aa856bb2808A96BA9E3a1";
export const MINER_POOLS = [
  { address: "0xdE672FccA32365bD704c39bd1164a0D34a3a73e6", label: "10 years", duration: 315360000 },
  { address: "0x3d175C8359169b0e830d36EA9CD3FE209f46f7BD", label: "1 year", duration: 31536000 },
  { address: "0x7ED33f65A0398cb26eaB2B03877825c96D9B6077", label: "3 months", duration: 7776000 },
  { address: "0xD9B491ac0f5487673500B67224b67b4171a08aCa", label: "1 month", duration: 2592000 },
] as const;

// Same supported vault list as the Farms page; indexed in original display order.
export const FARM_REGISTRY = [
  { name: "HEX-HTT3000 V2 LP", tokens: ["HEX", "HTT"], address: "0x7979bEe7F5Fe93F4b22d7A24C629803950610e56", decimals: 18 },
  { name: "HEX-HTT5000 V2 LP", tokens: ["HEX", "HTT"], address: "0xCAadb7032B8Fd0DD8386092b871d275c5c9684b0", decimals: 18 },
  { name: "HEX-HTT7000 V2 LP", tokens: ["HEX", "HTT"], address: "0xeea4a58838029d8Df7Cb0cE8a50045222551708A", decimals: 18 },
  { name: "INC-PRINT V2 LP", tokens: ["INC", "PRINT"], address: "0x5055a3F634349437f4E87d915Cf85Ca836FF1FFC", decimals: 18 },
  { name: "DAI-INCD V2 LP", tokens: ["pDAI", "INCD"], address: "0x988f2af54cE20D3d2F44177f953158B74341e1C9", decimals: 18 },
  { name: "EMIT", tokens: ["EMIT"], address: "0xB57aA188ab1B01B48e6d71F98264503C8B212B70", decimals: 18 },
  { name: "EMIT-PLS V2 LP", tokens: ["EMIT", "PLS"], address: "0x61CB65c28040c26B1Fc31eFa17B4566c69199cC2", decimals: 18 },
  { name: "DAI-PLS V1 LP", tokens: ["pDAI", "PLS"], address: "0x221e0B764Bb29d720C747a5885B0cE71d0a202Ac", decimals: 18 },
  { name: "INC-PLSX V1 LP", tokens: ["INC", "PLSX"], address: "0x30d1895243d7E5A6db345158879DBe6CBBE03FE6", decimals: 18 },
  { name: "PLS-PLSX V1 LP", tokens: ["PLS", "PLSX"], address: "0x7196998B37774b4652c389c359f30FC8d9EC7f53", decimals: 18 },
  { name: "HEX-PLS V1 LP", tokens: ["HEX", "PLS"], address: "0x437Cd9eaFaF8E062069f04C11994ed38ABd73D34", decimals: 18 },
  { name: "DAI-9INCH V2 LP", tokens: ["pDAI", "9INCH"], address: "0x6d6Ed53A3647B96d147850495e57F6E7F52cA0bf", decimals: 18 },
  { name: "vPLS-PLS V2 LP", tokens: ["vPLS", "PLS"], address: "0x3a37c64B56F0F7cF7F402688753B1692BB46BC32", decimals: 18 },
  { name: "HOC-PLS V2 LP", tokens: ["HOC", "PLS"], address: "0xc4dA722b1D7b13B46786f79F46F274fe16E096Ae", decimals: 18 },
  { name: "PRINT-sPRINT V2 LP", tokens: ["PRINT", "sPRINT"], address: "0x9Ba60bB19f21a01a0323F54BB001497f00B7A304", decimals: 18 },
  { name: "OINK-PLS V2 LP", tokens: ["OINK", "PLS"], address: "0x61B374Fd8Fa06767927bfb11B947d165C06a8c5E", decimals: 18 },
  { name: "OINK-DEGEN V2 LP", tokens: ["OINK", "DEGEN"], address: "0xBCb904a9422F223f5A79660f026310D4bd8C9941", decimals: 18 },
  { name: "EMIT-PLSX V2 LP", tokens: ["EMIT", "PLSX"], address: "0xc667a6EC483edB71f6329413FbcFE8042348956C", decimals: 18 },
  { name: "ISLAND-PLS V2 LP", tokens: ["ISLAND", "PLS"], address: "0xBCFd877b255fF3c2416e2fe5DA7EC8778cC5b57d", decimals: 18 },
  { name: "IMPLS-INC V2 LP", tokens: ["IMPLS", "INC"], address: "0xd100e649956aCAa3B6F90D58546219C373d28ce2", decimals: 18 },
  { name: "PLSX-9INCH V2 LP", tokens: ["PLSX", "9INCH"], address: "0x6a89ef54f612bcf35582bad159760223eec20690", decimals: 18 },
  { name: "USDC-PLS V1 LP", tokens: ["pUSDC", "PLS"], address: "0x52763911bDe0651D0709120d51afE3E33c5EccA5", decimals: 18 },
  { name: "USDT-PLS V1 LP", tokens: ["pUSDT", "PLS"], address: "0x43724568cAb0CCf712eF5dfA40E9Aec68fff5a95", decimals: 18 },
  { name: "HEX-HTT4000 V2 LP", tokens: ["HEX", "HTT"], address: "0xF3EAbb9297B8c7EacFf46190BE97D04bA5b707e2", decimals: 18 },
  { name: "HEX-HTT6000 V2 LP", tokens: ["HEX", "HTT"], address: "0x38906e4747e6669D26928F39Fd9f3ddd2f299d46", decimals: 18 },
] as const;

export type DashboardAsset = { address: string; symbol: string; decimals: number; logo: string; native?: boolean };
const tokenLogo = (address: string) => `https://raw.githubusercontent.com/piteasio/app-tokens/main/token-logo/${address}.png`;
export const DASHBOARD_ASSETS: readonly DashboardAsset[] = [
  { address: "0xa1077a294dde1b09bb078844df40758a5d0f9a27", symbol: "PLS", decimals: 18, native: true, logo: new URL("../../../pls.png", import.meta.url).href },
  { address: CONTRACTS.degen, symbol: "DEGEN", decimals: 18, logo: "https://raw.githubusercontent.com/degenstrategy/interface/main/img/degen.png" },
  { address: CONTRACTS.oink, symbol: "OINK", decimals: 18, logo: TOKEN_LOGOS.OINK },
  { address: "0x6B175474E89094C44Da98b954EedeAC495271d0F", symbol: "pDAI", decimals: 18, logo: tokenLogo("0x6B175474E89094C44Da98b954EedeAC495271d0F") },
  { address: "0x2fa878Ab3F87CC1C9737Fc071108F904c0B0C95d", symbol: "INC", decimals: 18, logo: tokenLogo("0x2fa878Ab3F87CC1C9737Fc071108F904c0B0C95d") },
  { address: "0x95B303987A60C71504D99Aa1b13B4DA07b0790ab", symbol: "PLSX", decimals: 18, logo: tokenLogo("0x95B303987A60C71504D99Aa1b13B4DA07b0790ab") },
  { address: "0x2b591e99afE9f32eAA6214f7B7629768c40Eeb39", symbol: "HEX", decimals: 8, logo: tokenLogo("0x2b591e99afE9f32eAA6214f7B7629768c40Eeb39") },
  { address: "0xCc78A0acDF847A2C1714D2A925bB4477df5d48a6", symbol: "ATROPA", decimals: 18, logo: tokenLogo("0xCc78A0acDF847A2C1714D2A925bB4477df5d48a6") },
];
