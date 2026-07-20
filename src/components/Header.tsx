import { NavLink } from "react-router-dom";
import { shortAddress } from "../lib/chain";
import type { WalletState } from "../hooks/useWallet";
import type { ThemeName } from "../themes/themes";
import { ThemePanel } from "./ThemePanel";

export type MainTab =
  | "nft"
  | "rewards"
  | "farms"
  | "sale"
  | "referral";

const nav: Array<[MainTab, string, string]> = [
  ["nft", "NFT", "/nft"],
  ["rewards", "Miners", "/my-miners"],
  ["farms", "Farms", "/farms"],
  ["sale", "DEGEN Sale", "/degen-sale"],
  ["referral", "Referral", "/referral"],
];

export function Header({
  wallet,
  theme,
  setTheme,
}: {
  wallet: WalletState;
  theme: ThemeName;
  setTheme: (theme: ThemeName) => void;
}) {
  return (
    <header className="site-header">
      <div className="social-links" aria-label="Social links">
        <a
          href="https://t.me/plsDEGEN"
          target="_blank"
          rel="noreferrer"
          aria-label="Telegram"
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M21.7 3.3 18.4 20c-.2 1-.8 1.2-1.6.7l-4.9-3.6-2.4 2.3c-.3.3-.5.5-1 .5l.4-5 9-8.1c.4-.4-.1-.6-.6-.2L6.1 13.6 1.3 12.1c-1-.3-1-1 .2-1.5L20.2 3.4c.9-.3 1.7.2 1.5-.1z" />
          </svg>
        </a>
        <a
          href="https://dexscreener.com/pulsechain/0x3029aa801176f6904e2b6c7527334c215eaf1d8f"
          target="_blank"
          rel="noreferrer"
          aria-label="Dexscreener"
        >
          <svg viewBox="0 0 252 300" aria-hidden="true">
            <path d="M126 0c41 1 79 20 97 14-9 30-51 66-80 80-11-8-23-8-34 0-29-14-71-50-80-80 18 6 56-13 97-14Zm0 88c21 0 42 19 40 54l33 19c-35 20-45 62-73 119-28-57-38-99-73-119l33-19c-2-35 19-54 40-54Zm-88-29c-20 40-16 75-14 87 1 34-7 68-24 99l35-28 24 40 26-24 41 67 41-67 26 24 24-40 35 28c-17-31-25-65-24-99 2-12 6-47-14-87-8 13-21 24-31 22 15 24 13 48-18 60l33 19-25 14c-28 17-40 61-47 86-7-25-19-69-47-86l-25-14 33-19c-31-12-33-36-18-60-10 2-23-9-31-22Z" />
          </svg>
        </a>
      </div>
      <div className="brand">
        <img
          src="https://avatars.githubusercontent.com/u/211634181?s=400"
          alt="DEGEN"
        />
        <strong>DEGEN</strong>
      </div>
      <nav aria-label="Primary navigation">
        {nav.map(([key, label, path]) => (
          <NavLink
            className={({ isActive }) => (isActive ? "active" : undefined)}
            key={key}
            to={path}
          >
            {label}
          </NavLink>
        ))}
      </nav>
      <div className="header-actions">
        <ThemePanel theme={theme} setTheme={setTheme} />
        {wallet.isWrongNetwork ? (
          <button
            className="wallet-button warning"
            onClick={() => void wallet.switchNetwork()}
          >
            Switch Network
          </button>
        ) : (
          <button
            className="wallet-button"
            onClick={() => void wallet.connect()}
            disabled={wallet.connecting}
          >
            {wallet.address
              ? shortAddress(wallet.address)
              : wallet.connecting
                ? "Connecting…"
                : "Connect Wallet"}
          </button>
        )}
      </div>
    </header>
  );
}
