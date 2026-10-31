import { useEffect, useState } from "react";
import { PageActivity, usePageActive } from "../hooks/usePageActive";
import { useSearchParams } from "react-router-dom";
import type { WalletState } from "../hooks/useWallet";
import { MinersPage } from "./MinersPage";
import { MyMinersPage } from "./MyMinersPage";
import { ReferralPage } from "./ReferralPage";
import { SalePage } from "./SalePage";

type MinerHubTab = "my-miners" | "deploy" | "sale" | "referral";

export function MinersHubPage({ wallet }: { wallet: WalletState }) {
  const [searchParams, setSearchParams] = useSearchParams();
  const requestedTab = searchParams.get("tab");
  const activeTab: MinerHubTab =
    requestedTab === "deploy" ||
    requestedTab === "sale" ||
    requestedTab === "referral"
      ? requestedTab
      : "my-miners";

  const pageActive = usePageActive();
  const [visited, setVisited] = useState<MinerHubTab[]>([activeTab]);
  useEffect(() => { setVisited(previous => previous.includes(activeTab) ? previous : [...previous, activeTab]); }, [activeTab]);
  const visibleTabs = visited.includes(activeTab) ? visited : [...visited, activeTab];

  const selectTab = (tab: MinerHubTab) => {
    const nextParams = new URLSearchParams(searchParams);
    if (tab === "my-miners") {
      nextParams.delete("tab");
    } else {
      nextParams.set("tab", tab);
    }
    setSearchParams(nextParams);
  };

  return (
    <div className="miners-hub">
      <nav
        className="miners-hub-tabs"
        aria-label="My Miners sections"
        role="tablist"
      >
        <button
          type="button"
          id="my-miners-tab"
          className={activeTab === "my-miners" ? "active" : undefined}
          role="tab"
          aria-selected={activeTab === "my-miners"}
          aria-controls="my-miners-panel"
          onClick={() => selectTab("my-miners")}
        >
          My Miners
        </button>
        <button
          type="button"
          id="deploy-miners-tab"
          className={activeTab === "deploy" ? "active" : undefined}
          role="tab"
          aria-selected={activeTab === "deploy"}
          aria-controls="deploy-miners-panel"
          onClick={() => selectTab("deploy")}
        >
          Deploy Miners
        </button>
        <button
          type="button"
          id="degen-miner-sale-tab"
          className={activeTab === "sale" ? "active" : undefined}
          role="tab"
          aria-selected={activeTab === "sale"}
          aria-controls="degen-miner-sale-panel"
          onClick={() => selectTab("sale")}
        >
          Degen Miner Sale
        </button>
        <button
          type="button"
          id="miner-referral-tab"
          className={activeTab === "referral" ? "active" : undefined}
          role="tab"
          aria-selected={activeTab === "referral"}
          aria-controls="miner-referral-panel"
          onClick={() => selectTab("referral")}
        >
          Referral
        </button>
      </nav>

      {visibleTabs.map(tab => <div key={tab} hidden={tab !== activeTab} role="tabpanel"
        id={tab === "deploy" ? "deploy-miners-panel" : tab === "sale" ? "degen-miner-sale-panel" : tab === "referral" ? "miner-referral-panel" : "my-miners-panel"}
        aria-labelledby={tab === "deploy" ? "deploy-miners-tab" : tab === "sale" ? "degen-miner-sale-tab" : tab === "referral" ? "miner-referral-tab" : "my-miners-tab"}>
        <PageActivity.Provider value={pageActive && tab === activeTab}>
          {tab === "deploy" ? <MinersPage wallet={wallet} poolAddress={searchParams.get("pool") ?? undefined} /> : tab === "sale" ? <SalePage wallet={wallet} /> : tab === "referral" ? <ReferralPage wallet={wallet} /> : <MyMinersPage wallet={wallet} />}
        </PageActivity.Provider>
      </div>)}
    </div>
  );
}
