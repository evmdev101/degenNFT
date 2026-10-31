const degenImage = (name: string) =>
  `${import.meta.env.BASE_URL}tokens/${name}.png`;
const tokenImage = (address: string) =>
  `https://raw.githubusercontent.com/piteasio/app-tokens/main/token-logo/${address}.png`;

/** Shared display assets for farm cards and the public reward allocation. */
export const TOKEN_LOGOS: Record<string, string> = {
  PLS: new URL("../../pls.png", import.meta.url).href,
  PLSX: degenImage("plsx"),
  INC: degenImage("inc"),
  HEX: degenImage("hex"),
  "T-Shares": degenImage("hex"),
  HOA: tokenImage("0x7901a3569679AEc3501dbeC59399F327854a70fe"),
  ATROPA: tokenImage("0xCc78A0acDF847A2C1714D2A925bB4477df5d48a6"),
  pDAI: degenImage("dai"),
  pUSDT: tokenImage("0xdAC17F958D2ee523a2206206994597C13D831ec7"),
  pUSDC: tokenImage("0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48"),
  PDRIP: tokenImage("0xeB2CEed77147893Ba8B250c796c2d4EF02a72B68"),
  EMIT: degenImage("emit"),
  COM: tokenImage("0x5A9780Bfe63f3ec57f01b087cD65BD656C9034A8"),
  HTT: degenImage("htt"),
  PRINT: degenImage("print"),
  sPRINT: degenImage("print"),
  INCD: degenImage("incd"),
  "9INCH": degenImage("9inch"),
  vPLS: new URL("../../vouchpls.png", import.meta.url).href,
  HOC: degenImage("hoc"),
  ISLAND: "https://cdn.dexscreener.com/cms/images/654e3bc18fb1a952a77693c1ee11a95c9fdfb989c0e1b63106127992675c8ae5?width=800&height=800&quality=95&format=auto",
  IMPLS: "https://coin-images.coingecko.com/coins/images/31493/small/impls_200x200.png?1696530304",
  OINK: degenImage("oink"),
  DEGEN: `${import.meta.env.BASE_URL}degen.png`,
};
