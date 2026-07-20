import { useSearchParams } from "react-router-dom";
import type { WalletState } from "../hooks/useWallet";
import { MinersPage } from "./MinersPage";
import { MyMinersPage } from "./MyMinersPage";

type MinerHubTab = "my-miners" | "deploy";

export function MinersHubPage({ wallet }: { wallet: WalletState }) {
  const [searchParams, setSearchParams] = useSearchParams();
  const activeTab: MinerHubTab =
    searchParams.get("tab") === "deploy" ? "deploy" : "my-miners";

  const selectTab = (tab: MinerHubTab) => {
    const nextParams = new URLSearchParams(searchParams);
    if (tab === "deploy") {
      nextParams.set("tab", "deploy");
    } else {
      nextParams.delete("tab");
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
      </nav>

      <div
        id={`${activeTab === "deploy" ? "deploy-miners" : "my-miners"}-panel`}
        role="tabpanel"
        aria-labelledby={
          activeTab === "deploy" ? "deploy-miners-tab" : "my-miners-tab"
        }
      >
        {activeTab === "deploy" ? (
          <MinersPage wallet={wallet} />
        ) : (
          <MyMinersPage wallet={wallet} />
        )}
      </div>
    </div>
  );
}
