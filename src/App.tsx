import { lazy, Suspense } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { Header } from "./components/Header";
import { LoadingScreen } from "./components/LoadingScreen";
import { useTheme } from "./components/ThemePanel";
import { useWallet } from "./hooks/useWallet";

const NftPage = lazy(() =>
  import("./features/nft/NftPage").then((module) => ({
    default: module.NftPage,
  })),
);
const ReferralPage = lazy(() =>
  import("./features/ReferralPage").then((module) => ({
    default: module.ReferralPage,
  })),
);
const SalePage = lazy(() =>
  import("./features/SalePage").then((module) => ({
    default: module.SalePage,
  })),
);
const MinersHubPage = lazy(() =>
  import("./features/MinersHubPage").then((module) => ({
    default: module.MinersHubPage,
  })),
);
const FarmsPage = lazy(() =>
  import("./features/FarmsPage").then((module) => ({
    default: module.FarmsPage,
  })),
);

function RouteFallback() {
  return <LoadingScreen />;
}

export default function App() {
  const wallet = useWallet();
  const { theme, setTheme } = useTheme();

  return (
    <div className="app-shell">
      <Header
        wallet={wallet}
        theme={theme}
        setTheme={setTheme}
      />
      {wallet.error && <div className="global-message">{wallet.error}</div>}
      <Suspense fallback={<RouteFallback />}>
        <Routes>
          <Route path="/" element={<Navigate to="/nft" replace />} />
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
          <Route path="/degen-sale" element={<SalePage wallet={wallet} />} />
          <Route
            path="/referral"
            element={<ReferralPage wallet={wallet} />}
          />
          <Route path="*" element={<Navigate to="/nft" replace />} />
        </Routes>
      </Suspense>
    </div>
  );
}
