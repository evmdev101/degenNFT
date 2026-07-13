import { lazy, Suspense, useState } from "react";
import { Header, type MainTab } from "./components/Header";
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
const MinersPage = lazy(() =>
  import("./features/MinersPage").then((module) => ({
    default: module.MinersPage,
  })),
);
const MyMinersPage = lazy(() =>
  import("./features/MyMinersPage").then((module) => ({
    default: module.MyMinersPage,
  })),
);
const FarmsPage = lazy(() =>
  import("./features/FarmsPage").then((module) => ({
    default: module.FarmsPage,
  })),
);

export default function App() {
  const [tab, setTab] = useState<MainTab>("nft");
  const wallet = useWallet();
  const { theme, setTheme } = useTheme();
  return (
    <div className="app-shell">
      <Header
        active={tab}
        onNavigate={setTab}
        wallet={wallet}
        theme={theme}
        setTheme={setTheme}
      />
      {wallet.error && <div className="global-message">{wallet.error}</div>}
      <Suspense
        fallback={
          <main className="standalone-page">
            <p>Loading dashboard…</p>
          </main>
        }
      >
        {tab === "nft" ? (
          <NftPage wallet={wallet} />
        ) : tab === "referral" ? (
          <ReferralPage wallet={wallet} />
        ) : tab === "sale" ? (
          <SalePage wallet={wallet} />
        ) : tab === "miners" ? (
          <MinersPage wallet={wallet} />
        ) : tab === "rewards" ? (
          <MyMinersPage wallet={wallet} />
        ) : tab === "farms" ? (
          <FarmsPage wallet={wallet} />
        ) : (
          <NftPage wallet={wallet} />
        )}
      </Suspense>
    </div>
  );
}
