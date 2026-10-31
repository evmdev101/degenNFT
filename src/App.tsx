import { startTransactionReconciliation } from "./lib/transactions";
import { lazy, Suspense, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import { AppErrorBoundary } from "./components/AppErrorBoundary";
import { Header } from "./components/Header";
import { LoadingScreen } from "./components/LoadingScreen";
import { useTheme } from "./components/ThemePanel";
import { useWallet } from "./hooks/useWallet";
import { pageLoaders } from "./lib/pageLoaders";
import { PageActivity } from "./hooks/usePageActive";
import { CopyAddress } from "./components/CopyAddress";
import { CONTRACTS } from "./config/contracts";
import { GOVERNANCE_ADDRESSES } from "./features/governance/governanceSpec";
import type { WalletState } from "./hooks/useWallet";
import { NftPage } from "./features/nft/NftPage";

const OverviewPage = lazy(() =>
  pageLoaders["/"]().then((module) => ({ default: module.OverviewPage })),
);
const PortfolioPage = lazy(() =>
  pageLoaders["/portfolio"]().then((module) => ({ default: module.PortfolioPage })),
);
const MinersHubPage = lazy(() =>
  pageLoaders["/my-miners"]().then((module) => ({
    default: module.MinersHubPage,
  })),
);
const FarmsPage = lazy(() =>
  pageLoaders["/farms"]().then((module) => ({
    default: module.FarmsPage,
  })),
);
const GovernancePage = lazy(() =>
  pageLoaders["/governance"]().then((module) => ({
    default: module.GovernancePage,
  })),
);
const HowItWorksPage = lazy(() =>
  pageLoaders["/how-it-works"]().then(module => ({ default: module.HowItWorksPage })),
);
const DocsPage = lazy(() =>
  pageLoaders["/protocol"]().then(module => ({ default: module.DocsPage })),
);

function RouteFallback() {
  return <LoadingScreen />;
}

export default function App() {
  const wallet = useWallet();
  const location = useLocation();
  const queryClient = useQueryClient();
  const { theme, setTheme } = useTheme();
  useEffect(() => {
    const stop = startTransactionReconciliation();
    const update = () => { void queryClient.invalidateQueries(); };
    window.addEventListener("degen:transaction-settled", update);
    return () => { stop(); window.removeEventListener("degen:transaction-settled", update); };
  }, [queryClient]);

  useEffect(() => {
    if (location.pathname !== "/nft") return;
    const timer = setTimeout(() => {
      // Intent-based preloading in the header handles heavier secondary routes.
      if (document.hidden) return;
      void pageLoaders["/nft"]().then((module) =>
        module.prefetchNftData(queryClient, wallet.address),
      ).catch(() => undefined);
    }, 150);
    return () => clearTimeout(timer);
  }, [queryClient, wallet.address, location.pathname]);

  return (
    <div className="app-shell">
      <Header
        wallet={wallet}
        theme={theme}
        setTheme={setTheme}
      />
      {wallet.error && <div className="global-message">{wallet.error}</div>}
      <CachedPages key={`${wallet.address ?? "guest"}:${wallet.chainId ?? "unknown"}`} wallet={wallet} />
      <details className="protocol-addresses"><summary>Contract & treasury addresses</summary><dl>
        {[
          ["NFT miner", CONTRACTS.nft],
          ["NFT purchases", CONTRACTS.mint],
          ["DEGEN token", CONTRACTS.degen],
          ["Treasury", "0xD540b89Ee52F81bE921Aa856bb2808A96BA9E3a1"],
          ["Governance", GOVERNANCE_ADDRESSES.governor],
        ].map(([label, address]) => <div className="protocol-address-row" key={label}>
          <dt>{label}</dt><dd><CopyAddress address={address} label={`${label} address`} iconOnly /></dd>
        </div>)}
      </dl></details>
    </div>
  );
}

function CachedPages({ wallet }: { wallet: WalletState }) {
  const location = useLocation();
  const [visited, setVisited] = useState<Record<string, typeof location>>({});
  const positions = useRef<Record<string, number>>({});
  const visible = { ...visited, [location.pathname]: location };
  useEffect(() => { setVisited(previous => Object.hasOwn(pageLoaders, location.pathname) ? ({ ...previous, [location.pathname]: location }) : previous); }, [location]);
  useLayoutEffect(() => {
    window.scrollTo(0, positions.current[location.pathname] ?? 0);
    return () => { positions.current[location.pathname] = window.scrollY; };
  }, [location.pathname]);
  return <>{Object.entries(visible).map(([path, saved]) =>
    <div key={path} hidden={path !== location.pathname}>
      <PageActivity.Provider value={path === location.pathname}>
        <AppErrorBoundary><Suspense fallback={<RouteFallback />}>
        <Routes location={saved}>
          <Route path="/" element={<OverviewPage />} />
          <Route path="/overview" element={<Navigate to="/" replace />} />
          <Route path="/portfolio" element={<PortfolioPage wallet={wallet} />} />
          <Route path="/how-it-works" element={<HowItWorksPage />} />
          <Route path="/protocol" element={<DocsPage />} />
          <Route path="/docs" element={<Navigate to={`/protocol${saved.search}`} replace />} />
          <Route path="/nft" element={<NftPage wallet={wallet} />} />
          <Route
            path="/miners"
            element={<Navigate to="/my-miners?tab=deploy" replace />}
          />
          <Route
            path="/my-miners"
            element={<MinersHubPage wallet={wallet} />}
          />
          <Route path="/farms" element={<FarmsPage wallet={wallet} />} />
          <Route
            path="/governance"
            element={<GovernancePage wallet={wallet} />}
          />
          <Route
            path="/degen-sale"
            element={<Navigate to="/my-miners?tab=sale" replace />}
          />
          <Route
            path="/referral"
            element={<Navigate to="/my-miners?tab=referral" replace />}
          />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
        </Suspense></AppErrorBoundary>
      </PageActivity.Provider>
    </div>
  )}</>;
}
