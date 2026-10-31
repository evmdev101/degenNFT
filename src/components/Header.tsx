import { useEffect, useId, useRef, useState } from "react";
import { Link, NavLink, useLocation } from "react-router-dom";
import { shortAddress } from "../lib/chain";
import type { WalletState } from "../hooks/useWallet";
import type { ThemeName } from "../themes/themes";
import { ThemePanel } from "./ThemePanel";
import { preloadPage } from "../lib/pageLoaders";

export type MainTab = "overview" | "portfolio" | "nft" | "rewards" | "farms" | "governance" | "how-it-works" | "docs";

const nav: Array<[MainTab, string, string]> = [
  ["overview", "Overview", "/"],
  ["portfolio", "Portfolio", "/portfolio"],
];

const degenPages = [
  ["Miners", "/my-miners"],
  ["Farms", "/farms"],
  ["NFTs", "/nft"],
  ["Sale", "/my-miners?tab=sale"],
  ["Referral", "/my-miners?tab=referral"],
] as const;

export function Header({ wallet, theme, setTheme }: {
  wallet: WalletState;
  theme: ThemeName;
  setTheme: (theme: ThemeName) => void;
}) {
  const location = useLocation();
  const [open, setOpen] = useState(false);
  const dropdown = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const dropdownId = useId();
  const degenActive = ["/my-miners", "/miners", "/farms", "/nft", "/degen-sale", "/referral"].includes(location.pathname);
  useEffect(() => { setOpen(false); }, [location.pathname, location.search]);
  useEffect(() => {
    if (!open) return;
    const dismiss = (event: PointerEvent) => {
      if (!dropdown.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", dismiss);
    return () => document.removeEventListener("pointerdown", dismiss);
  }, [open]);
  return (
    <header className="site-header">
      <div className="site-header-inner">
        <NavLink className="header-brand" to="/" end aria-label="DEGEN home">
          <img src="https://raw.githubusercontent.com/degenstrategy/interface/main/img/degen.png" alt="" width="40" height="40" />
          <strong>DEGEN</strong>
        </NavLink>
        <nav className="primary-nav" aria-label="Primary navigation">
          {nav.map(([key, label, path]) => (
            <NavLink className={({ isActive }) => (isActive ? "active" : undefined)} key={key} to={path} end={path === "/"}
              onMouseEnter={() => preloadPage(path)}
              onFocus={() => preloadPage(path)}
              onTouchStart={() => preloadPage(path)}>
              {label}
            </NavLink>
          ))}
          <div className={`degen-nav${degenActive || open ? " active" : ""}`} ref={dropdown} onBlur={event => {
            if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOpen(false);
          }} onKeyDown={event => {
            if (event.key === "Escape") { event.preventDefault(); setOpen(false); trigger.current?.focus(); }
          }}>
            <button ref={trigger} type="button" aria-label="Degen menu"
              aria-expanded={open} aria-controls={dropdownId} onClick={() => setOpen(value => !value)}>
              Degen
              <span aria-hidden="true">{open ? "▴" : "▾"}</span>
            </button>
            <div id={dropdownId} className="degen-nav-dropdown" hidden={!open}>
              {degenPages.map(([label, path]) => {
                const [pathname, search = ""] = path.split("?");
                const tab = new URLSearchParams(location.search).get("tab");
                const active = location.pathname === pathname && (search ? location.search === `?${search}` : pathname !== "/my-miners" || (tab !== "sale" && tab !== "referral"));
                return <Link key={path} to={path} aria-current={active ? "page" : undefined}
                  onClick={() => setOpen(false)} onMouseEnter={() => preloadPage(pathname)}
                  onFocus={() => preloadPage(pathname)} onTouchStart={() => preloadPage(pathname)}>{label}</Link>;
              })}
            </div>
          </div>
          <NavLink to="/governance" className={({ isActive }) => isActive ? "active" : undefined}
            onMouseEnter={() => preloadPage("/governance")} onFocus={() => preloadPage("/governance")}>Governance</NavLink>
          <NavLink to="/how-it-works" className={({ isActive }) => isActive ? "active" : undefined}
            onMouseEnter={() => preloadPage("/how-it-works")} onFocus={() => preloadPage("/how-it-works")} onTouchStart={() => preloadPage("/how-it-works")}>How it works</NavLink>
          <NavLink to="/protocol" className={({ isActive }) => isActive ? "active" : undefined}
            onMouseEnter={() => preloadPage("/protocol")} onFocus={() => preloadPage("/protocol")} onTouchStart={() => preloadPage("/protocol")}>Docs</NavLink>
        </nav>
        <div className="header-actions">
          <ThemePanel theme={theme} setTheme={setTheme} />
          {wallet.isWrongNetwork ? (
            <button className="wallet-button warning" onClick={() => void wallet.switchNetwork()}>
              Switch Network
            </button>
          ) : (
            <button className="wallet-button" onClick={() => void wallet.connect()} disabled={wallet.connecting}>
              {wallet.address ? shortAddress(wallet.address) : wallet.connecting ? "Connecting..." : "Connect Wallet"}
            </button>
          )}
        </div>
      </div>
    </header>
  );
}
