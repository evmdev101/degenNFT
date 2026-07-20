import { Contract, ZeroAddress, formatEther, parseEther } from "ethers";
import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import {
  CONTRACTS,
  MINT_ABI,
  NFT_ABI,
  NFT_TOKEN_ID,
} from "../../config/contracts";
import type { WalletState } from "../../hooks/useWallet";
import {
  getPublicContracts,
  readableError,
  shortAddress,
} from "../../lib/chain";
import {
  BURN_DESTINATIONS,
  HARVEST_DESTINATIONS,
  SETTINGS_POOLS,
} from "./options";
import type { RewardToken } from "./options";

type Action = "harvest" | "settings" | "burn" | null;
type Settings = {
  oinkPool: string;
  degenPool: string;
  minOink: string;
  minDegen: string;
  fee: string;
};
type SettingsSummary = {
  loading: boolean;
  error: string;
  oinkPool: string;
  degenPool: string;
  minOink: string;
  minDegen: string;
  fee: string;
};
type Purchase = {
  id: number;
  amount: bigint;
  amountPaid: bigint;
  tokenPaid: string;
};

const display = (value: bigint) =>
  Number(formatEther(value)).toLocaleString(undefined, {
    maximumFractionDigits: 6,
  });
const compactDisplay = (value: bigint | number) => {
  const amount =
    typeof value === "bigint" ? Number(formatEther(value)) : Number(value);
  if (!Number.isFinite(amount)) return "0";
  if (amount >= 1e9) return `${(amount / 1e9).toFixed(3)}B`;
  if (amount >= 1e6) return `${(amount / 1e6).toFixed(3)}M`;
  if (amount >= 1e3) return `${(amount / 1e3).toFixed(2)}K`;
  return amount.toFixed(4);
};
const harvestInput = (value: bigint) => {
  const amount = Number(formatEther(value));
  if (!Number.isFinite(amount) || amount <= 0) return "0";
  return amount >= 1_000
    ? String(Math.floor(amount))
    : String(Number(amount.toFixed(6)));
};
const canonicalPool = (
  token: RewardToken,
  address: unknown,
  fallback: string,
) =>
  SETTINGS_POOLS[token].find(
    (item) =>
      item.address.toLowerCase() === String(address || "").toLowerCase(),
  )?.address || fallback;
const initialSettings: Settings = {
  oinkPool: SETTINGS_POOLS.OINK.at(-1)!.address,
  degenPool: SETTINGS_POOLS.DEGEN.at(-1)!.address,
  minOink: "0",
  minDegen: "0",
  fee: "0",
};
const initialSettingsSummary: SettingsSummary = {
  loading: true,
  error: "",
  oinkPool: "Loading…",
  degenPool: "Loading…",
  minOink: "Loading…",
  minDegen: "Loading…",
  fee: "Loading…",
};
const poolSummary = (token: RewardToken, address: unknown) => {
  const rawAddress = String(address || "");
  if (!rawAddress || rawAddress === ZeroAddress) {
    return token === "OINK"
      ? "OINK — 5 Year (contract default)"
      : "DEGEN — 10 Year (contract default)";
  }
  const pool = SETTINGS_POOLS[token].find(
    (item) => item.address.toLowerCase() === rawAddress.toLowerCase(),
  );
  return pool
    ? `${token} — ${pool.label}`
    : `${token} — ${shortAddress(rawAddress)}`;
};
const settingAmount = (value: bigint) => {
  const amount = Number(formatEther(value));
  return amount > 0
    ? amount.toLocaleString(undefined, { maximumFractionDigits: 2 })
    : "Contract default";
};

export function RewardsActions({
  wallet,
  balance,
  pendingOink,
  pendingDegen,
  onComplete,
  dashboard = false,
}: {
  wallet: WalletState;
  balance: bigint;
  pendingOink: bigint;
  pendingDegen: bigint;
  onComplete: () => Promise<void>;
  dashboard?: boolean;
}) {
  const [action, setAction] = useState<Action>(null);
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshedAt, setRefreshedAt] = useState(() => new Date());
  const [settingsRevision, setSettingsRevision] = useState(0);
  const [settingsSummary, setSettingsSummary] =
    useState<SettingsSummary>(initialSettingsSummary);
  useEffect(() => {
    if (!dashboard || !wallet.address) return;
    let cancelled = false;
    setSettingsSummary((current) => ({ ...current, loading: true }));
    void (async () => {
      try {
        const { nft } = await getPublicContracts();
        const raw = await nft.userSettings(wallet.address);
        if (cancelled) return;
        setSettingsSummary({
          loading: false,
          error: "",
          oinkPool: poolSummary("OINK", raw.defaultHarvest1),
          degenPool: poolSummary("DEGEN", raw.defaultHarvest2),
          minOink: settingAmount(raw.minimumHarvest1),
          minDegen: settingAmount(raw.minimumHarvest2),
          fee:
            Number(raw.fee) > 0
              ? `${(Number(raw.fee) / 100).toFixed(2)}%`
              : "Contract default (1%)",
        });
      } catch (error) {
        if (cancelled) return;
        setSettingsSummary({
          ...initialSettingsSummary,
          loading: false,
          error: readableError(error),
          oinkPool: "Unavailable",
          degenPool: "Unavailable",
          minOink: "Unavailable",
          minDegen: "Unavailable",
          fee: "Unavailable",
        });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [dashboard, wallet.address, settingsRevision]);
  const complete = async () => {
    await onComplete();
    setSettingsRevision((current) => current + 1);
    setRefreshedAt(new Date());
  };
  const refresh = async () => {
    try {
      setRefreshing(true);
      await complete();
    } finally {
      setRefreshing(false);
    }
  };
  const close = () => {
    if (!busy) {
      setAction(null);
      setStatus("");
    }
  };
  return (
    <>
      {dashboard ? (
        <>
          <div className="rewards-dashboard-actions">
            <button
              disabled={balance === 0n}
              onClick={() => setAction("harvest")}
            >
              Manual Harvest
            </button>
            <button
              className="burn"
              disabled={balance === 0n}
              onClick={() => setAction("burn")}
            >
              Burn NFT
            </button>
          </div>
          <div className="rewards-dashboard-footer">
            <span>
              Rewards auto-distribute every ~50 min. Manual harvest claims your
              pending balance now.
            </span>
            <div>
              <time dateTime={refreshedAt.toISOString()}>
                {refreshedAt.toLocaleTimeString()}
              </time>
              <button
                disabled={refreshing}
                onClick={() => void refresh()}
              >
                {refreshing ? "Refreshing…" : "↻ Refresh"}
              </button>
            </div>
          </div>
          <section className="rewards-settings-summary">
            <header>
              <h3>Miner Settings</h3>
              <span>
                Configure where auto-harvested rewards are staked
              </span>
            </header>
            <dl>
              <div>
                <dt>OINK Harvest Pool</dt>
                <dd>{settingsSummary.oinkPool}</dd>
              </div>
              <div>
                <dt>DEGEN Harvest Pool</dt>
                <dd>{settingsSummary.degenPool}</dd>
              </div>
              <div>
                <dt>Min Harvest OINK</dt>
                <dd>{settingsSummary.minOink}</dd>
              </div>
              <div>
                <dt>Min Harvest DEGEN</dt>
                <dd>{settingsSummary.minDegen}</dd>
              </div>
              <div>
                <dt>Harvest Fee</dt>
                <dd>{settingsSummary.fee}</dd>
              </div>
            </dl>
            <button
              className="rewards-edit-settings"
              disabled={settingsSummary.loading || Boolean(settingsSummary.error)}
              onClick={() => setAction("settings")}
            >
              Edit Settings
            </button>
            {settingsSummary.error && (
              <p className="settings-summary-error">
                Settings temporarily unavailable. Refresh to try again.
              </p>
            )}
          </section>
        </>
      ) : (
        <div className="reward-actions">
          <button onClick={() => setAction("harvest")}>Manual Harvest</button>
          <button onClick={() => setAction("settings")}>Edit Settings</button>
          <button
            className="danger"
            disabled={balance === 0n}
            onClick={() => setAction("burn")}
          >
            Burn NFT
          </button>
        </div>
      )}
      {action === "harvest" && (
        <HarvestDialog
          wallet={wallet}
          pendingOink={pendingOink}
          pendingDegen={pendingDegen}
          busy={busy}
          setBusy={setBusy}
          status={status}
          setStatus={setStatus}
          close={close}
          onComplete={complete}
        />
      )}
      {action === "settings" && (
        <SettingsDialog
          wallet={wallet}
          busy={busy}
          setBusy={setBusy}
          status={status}
          setStatus={setStatus}
          close={close}
          onComplete={complete}
        />
      )}
      {action === "burn" && (
        <BurnDialog
          wallet={wallet}
          balance={balance}
          busy={busy}
          setBusy={setBusy}
          status={status}
          setStatus={setStatus}
          close={close}
          onComplete={complete}
        />
      )}
    </>
  );
}

type Shared = {
  wallet: WalletState;
  busy: boolean;
  setBusy: (value: boolean) => void;
  status: string;
  setStatus: (value: string) => void;
  close: () => void;
  onComplete: () => Promise<void>;
};

function Modal({
  title,
  children,
  close,
  className = "",
  eyebrow = "NFT Miner",
}: {
  title: string;
  children: ReactNode;
  close: () => void;
  className?: string;
  eyebrow?: string | null;
}) {
  return (
    <div
      className="modal-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) close();
      }}
    >
      <section
        className={`action-modal ${className}`.trim()}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <header>
          <div>
            {eyebrow && <span className="eyebrow">{eyebrow}</span>}
            <h2>{title}</h2>
          </div>
          <button aria-label="Close" onClick={close}>
            ×
          </button>
        </header>
        {children}
      </section>
    </div>
  );
}

function HarvestDialog({
  wallet,
  pendingOink,
  pendingDegen,
  busy,
  setBusy,
  status,
  setStatus,
  close,
  onComplete,
}: Shared & { pendingOink: bigint; pendingDegen: bigint }) {
  const [token, setToken] = useState<RewardToken>("OINK");
  const max = token === "OINK" ? pendingOink : pendingDegen;
  const [amount, setAmount] = useState(() => harvestInput(pendingOink));
  const [destination, setDestination] = useState(
    HARVEST_DESTINATIONS.OINK[0].address!,
  );
  const choices = HARVEST_DESTINATIONS[token];
  const option =
    choices.find(
      (item) => (item.address || "WALLET") === destination,
    ) || choices[0];
  const amountNumber = Number(amount.replace(/[, ]/g, "")) || 0;
  const chooseToken = (nextToken: RewardToken) => {
    const nextMax = nextToken === "OINK" ? pendingOink : pendingDegen;
    setToken(nextToken);
    setAmount(harvestInput(nextMax));
    setDestination(
      HARVEST_DESTINATIONS[nextToken][0].address || "WALLET",
    );
  };
  const submit = async () => {
    try {
      setBusy(true);
      setStatus("Confirm the harvest in your wallet…");
      const amountWei = parseEther(amount.replace(/,/g, ""));
      if (amountWei <= 0n || amountWei > max)
        throw new Error(`Enter an amount up to ${display(max)} ${token}.`);
      const signer = await wallet.getSigner();
      const contract = new Contract(CONTRACTS.nft, NFT_ABI, signer);
      const target = destination === "WALLET" ? wallet.address! : destination;
      const tx = await contract.selfHarvest(
        amountWei,
        target,
        token === "OINK",
      );
      setStatus("Transaction submitted. Waiting for confirmation…");
      await tx.wait();
      setStatus(`Harvest confirmed: ${tx.hash.slice(0, 10)}…`);
      await onComplete();
    } catch (error) {
      setStatus(readableError(error));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      title="Manual Harvest"
      close={close}
      className="harvest-modal"
      eyebrow={null}
    >
      <div className="harvest-balances">
        <article>
          <span>OINK Earned</span>
          <strong className="oink">{compactDisplay(pendingOink)}</strong>
        </article>
        <article>
          <span>DEGEN Earned</span>
          <strong className="degen">{compactDisplay(pendingDegen)}</strong>
        </article>
      </div>
      <div className="modal-section-label">Select Token to Harvest</div>
      <div className="token-switch">
        <button
          className={token === "OINK" ? "active" : ""}
          onClick={() => chooseToken("OINK")}
        >
          OINK
        </button>
        <button
          className={token === "DEGEN" ? "active" : ""}
          onClick={() => chooseToken("DEGEN")}
        >
          DEGEN
        </button>
      </div>
      <label className="field-label">
        Amount to Harvest (Max: {display(max)} {token})
        <input
          value={amount}
          inputMode="decimal"
          onChange={(event) => setAmount(event.target.value)}
        />
      </label>
      <div className="modal-section-label">Harvest Into…</div>
      <div className="destination-list">
        {choices.map((item) => (
          <label
            className={
              (item.address || "WALLET") === destination ? "selected" : ""
            }
            key={item.label}
          >
            <input
              type="radio"
              checked={(item.address || "WALLET") === destination}
              onChange={() => setDestination(item.address || "WALLET")}
            />
            <span>
              <b>{item.label}</b>
              <small>
                {item.payoutPct === 100
                  ? `Receive 100% (${compactDisplay(amountNumber)})`
                  : `-${100 - item.payoutPct}% Penalty (${compactDisplay(
                      (amountNumber * item.payoutPct) / 100,
                    )})`}
              </small>
            </span>
          </label>
        ))}
      </div>
      <span className="sr-only">
        Selected payout: {option.payoutPct} percent
      </span>
      <ActionFooter
        busy={busy}
        status={status}
        close={close}
        submit={() => void submit()}
        label="Harvest"
      />
    </Modal>
  );
}

function SettingsDialog({
  wallet,
  busy,
  setBusy,
  status,
  setStatus,
  close,
  onComplete,
}: Shared) {
  const [settings, setSettings] = useState<Settings>(initialSettings);
  const [defaults, setDefaults] = useState({ oink: "0", degen: "0" });
  const [showCompounded, setShowCompounded] = useState(
    () => localStorage.getItem("degen-compounded") !== "false",
  );
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const { nft } = await getPublicContracts();
        const [raw, defOink, defDegen] = await Promise.all([
          nft.userSettings(wallet.address),
          nft.defaultMinHarvestOink(),
          nft.defaultMinHarvestDegen(),
        ]);
        if (cancelled) return;
        const defaultOink = formatEther(defOink);
        const defaultDegen = formatEther(defDegen);
        setDefaults({ oink: defaultOink, degen: defaultDegen });
        setSettings({
          oinkPool:
            raw.defaultHarvest1 === ZeroAddress
              ? initialSettings.oinkPool
              : canonicalPool(
                  "OINK",
                  raw.defaultHarvest1,
                  initialSettings.oinkPool,
                ),
          degenPool:
            raw.defaultHarvest2 === ZeroAddress
              ? initialSettings.degenPool
              : canonicalPool(
                  "DEGEN",
                  raw.defaultHarvest2,
                  initialSettings.degenPool,
                ),
          minOink: formatEther(
            raw.minimumHarvest1 > 0n ? raw.minimumHarvest1 : defOink,
          ),
          minDegen: formatEther(
            raw.minimumHarvest2 > 0n ? raw.minimumHarvest2 : defDegen,
          ),
          fee: Number(raw.fee) > 0 ? (Number(raw.fee) / 100).toString() : "0",
        });
      } catch (error) {
        setStatus(readableError(error));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [wallet.address, setStatus]);
  const submit = async () => {
    try {
      setBusy(true);
      setStatus("Confirm the settings transaction in your wallet…");
      const fee = Number(settings.fee);
      if (!Number.isFinite(fee) || fee < 0)
        throw new Error("Enter a valid fee.");
      if (fee > 0 && fee < 1)
        throw new Error(
          "The protocol minimum fee is 1%. Use 0 for the contract default.",
        );
      localStorage.setItem(
        "degen-compounded",
        showCompounded ? "true" : "false",
      );
      window.dispatchEvent(new Event("degen-compounded-change"));
      const signer = await wallet.getSigner();
      const contract = new Contract(CONTRACTS.nft, NFT_ABI, signer);
      const tx = await contract.setUserSettings(
        settings.oinkPool,
        settings.degenPool,
        parseEther(settings.minOink || "0"),
        parseEther(settings.minDegen || "0"),
        BigInt(Math.round(fee * 100)),
      );
      setStatus("Transaction submitted. Waiting for confirmation…");
      await tx.wait();
      setStatus(`Settings saved: ${tx.hash.slice(0, 10)}…`);
      await onComplete();
    } catch (error) {
      setStatus(readableError(error));
    } finally {
      setBusy(false);
    }
  };
  const field = (key: keyof Settings, value: string) =>
    setSettings((current) => ({ ...current, [key]: value }));
  return (
    <Modal
      title="Settings"
      close={close}
      className="settings-modal"
      eyebrow={null}
    >
      {loading ? (
        <p>Loading your on-chain settings…</p>
      ) : (
        <div className="settings-grid">
          <label className="settings-checkbox-row">
            <span>
              <input
                type="checkbox"
                checked={showCompounded}
                onChange={(event) =>
                  setShowCompounded(event.target.checked)
                }
              />
              <b>Show Mining Rewards (compounded)</b>
            </span>
            <small>
              When on, reward counters show earnings accumulating between
              auto-harvest cycles. When off, they show only the confirmed
              on-chain snapshot.
            </small>
          </label>
          <label>
            OINK Harvest
            <select
              value={settings.oinkPool}
              onChange={(e) => field("oinkPool", e.target.value)}
            >
              {SETTINGS_POOLS.OINK.map((item) => (
                <option value={item.address} key={item.address}>
                  {item.label}
                </option>
              ))}
            </select>
            <small>
              Pool your OINK rewards are auto-staked into. Longer locks
              provide higher APY.
            </small>
          </label>
          <label>
            DEGEN Harvest
            <select
              value={settings.degenPool}
              onChange={(e) => field("degenPool", e.target.value)}
            >
              {SETTINGS_POOLS.DEGEN.map((item) => (
                <option value={item.address} key={item.address}>
                  {item.label}
                </option>
              ))}
            </select>
            <small>
              Pool your DEGEN rewards are auto-staked into.
            </small>
          </label>
          <label>
            Minimum Harvest OINK
            <input
              inputMode="decimal"
              value={settings.minOink}
              onChange={(e) => field("minOink", e.target.value)}
            />
            <small>
              Protocol default: {defaults.oink} · Minimum pending OINK before
              auto-harvest.
            </small>
          </label>
          <label>
            Minimum Harvest DEGEN
            <input
              inputMode="decimal"
              value={settings.minDegen}
              onChange={(e) => field("minDegen", e.target.value)}
            />
            <small>
              Protocol default: {defaults.degen} · Minimum pending DEGEN before
              auto-harvest.
            </small>
          </label>
          <label>
            Harvest fee (%)
            <input
              inputMode="decimal"
              value={settings.fee}
              onChange={(e) => field("fee", e.target.value)}
            />
            <small>
              Protocol minimum is 1%. Enter 0 to use the default; a higher fee
              donates the difference to the treasury.
            </small>
          </label>
        </div>
      )}
      <ActionFooter
        busy={busy || loading}
        status={status}
        close={close}
        submit={() => void submit()}
        label="Update Settings"
      />
    </Modal>
  );
}

function BurnDialog({
  wallet,
  balance,
  busy,
  setBusy,
  status,
  setStatus,
  close,
  onComplete,
}: Shared & { balance: bigint }) {
  const [token, setToken] = useState<RewardToken>("DEGEN");
  const [destination, setDestination] = useState(
    BURN_DESTINATIONS.DEGEN[0].address!,
  );
  const [purchases, setPurchases] = useState<Purchase[]>([]);
  const [purchaseId, setPurchaseId] = useState(0);
  const [preview, setPreview] = useState<bigint | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const selected = purchases.find((item) => item.id === purchaseId);
  useEffect(() => {
    setDestination(BURN_DESTINATIONS[token][0].address!);
    setPreview(null);
  }, [token]);
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const { mint } = await getPublicContracts();
        const found: Purchase[] = [];
        for (let i = 0; i < 50; i++) {
          try {
            const raw = await mint.userPurchases(wallet.address, i);
            if (raw.amount === 0n) break;
            found.push({
              id: i,
              amount: raw.amount,
              amountPaid: raw.amountPaid,
              tokenPaid: String(raw.tokenPaid),
            });
          } catch {
            break;
          }
        }
        if (!cancelled) {
          setPurchases(found);
          setPurchaseId(found[0]?.id || 0);
        }
      } catch (error) {
        if (!cancelled) setStatus(readableError(error));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [wallet.address, setStatus]);
  useEffect(() => {
    if (!selected || !wallet.address) return;
    let cancelled = false;
    void (async () => {
      try {
        const { mint } = await getPublicContracts();
        const target = destination === "WALLET" ? wallet.address : destination;
        const result = await mint.previewBurnReturn(
          selected.id,
          balance,
          token === "OINK",
          target,
        );
        if (!cancelled) setPreview(result);
      } catch {
        if (!cancelled) setPreview(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selected, destination, token, balance, wallet.address]);
  const submit = async () => {
    if (!confirmed) return;
    try {
      setBusy(true);
      setStatus("Confirm the permanent NFT burn in your wallet…");
      if (!selected)
        throw new Error("No purchase record was found for this wallet.");
      const signer = await wallet.getSigner();
      const contract = new Contract(CONTRACTS.mint, MINT_ABI, signer);
      const target = destination === "WALLET" ? wallet.address! : destination;
      const tx = await contract.burnNFT(
        selected.id,
        token === "OINK",
        balance,
        target,
      );
      setStatus("Burn submitted. Waiting for confirmation…");
      await tx.wait();
      setStatus(`Burn confirmed: ${tx.hash.slice(0, 10)}…`);
      await onComplete();
    } catch (error) {
      setStatus(readableError(error));
    } finally {
      setBusy(false);
    }
  };
  const choices = BURN_DESTINATIONS[token];
  return (
    <Modal title="Burn / Cash Out NFT Miners" close={close}>
      <p className="destructive-copy">
        Burning permanently destroys all {balance.toString()} NFT miner
        {balance === 1n ? "" : "s"} held by this wallet. This cannot be undone.
      </p>
      {purchases.length > 1 && (
        <label className="field-label">
          Purchase record
          <select
            value={purchaseId}
            onChange={(e) => setPurchaseId(Number(e.target.value))}
          >
            {purchases.map((item) => (
              <option value={item.id} key={item.id}>
                Purchase #{item.id + 1} · {display(item.amountPaid)} paid
              </option>
            ))}
          </select>
        </label>
      )}
      <div className="token-switch">
        <button
          className={token === "DEGEN" ? "active" : ""}
          onClick={() => setToken("DEGEN")}
        >
          Cash out as DEGEN
        </button>
        <button
          className={token === "OINK" ? "active" : ""}
          onClick={() => setToken("OINK")}
        >
          Cash out as OINK
        </button>
      </div>
      <div className="destination-list">
        {choices.map((item) => (
          <label
            className={
              (item.address || "WALLET") === destination ? "selected" : ""
            }
            key={item.label}
          >
            <input
              type="radio"
              checked={(item.address || "WALLET") === destination}
              onChange={() => setDestination(item.address || "WALLET")}
            />
            <span>
              <b>{item.label}</b>
              <small>Receive {item.payoutPct}%</small>
            </span>
          </label>
        ))}
      </div>
      <div className="burn-preview">
        <span>Estimated return</span>
        <strong>
          {preview === null
            ? "Unable to preview"
            : `${display(preview)} ${token}`}
        </strong>
        <small>
          Destination:{" "}
          {destination === "WALLET"
            ? shortAddress(wallet.address)
            : choices.find((item) => item.address === destination)?.label}
        </small>
      </div>
      <label className="burn-confirm">
        <input
          type="checkbox"
          checked={confirmed}
          onChange={(e) => setConfirmed(e.target.checked)}
        />
        <span>
          I understand this permanently burns every NFT miner currently held by
          this wallet.
        </span>
      </label>
      <ActionFooter
        busy={busy || !confirmed || !selected}
        status={status}
        close={close}
        submit={() => void submit()}
        label="Permanently Burn NFTs"
        danger
      />
    </Modal>
  );
}

function ActionFooter({
  busy,
  status,
  close,
  submit,
  label,
  danger = false,
}: {
  busy: boolean;
  status: string;
  close: () => void;
  submit: () => void;
  label: string;
  danger?: boolean;
}) {
  return (
    <>
      <div className="modal-actions">
        <button onClick={close}>Cancel</button>
        <button
          className={danger ? "danger" : ""}
          disabled={busy}
          onClick={submit}
        >
          {busy ? "Please wait…" : label}
        </button>
      </div>
      {status && <div className="transaction-status">{status}</div>}
    </>
  );
}
