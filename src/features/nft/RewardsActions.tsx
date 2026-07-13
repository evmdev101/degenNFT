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
const initialSettings: Settings = {
  oinkPool: SETTINGS_POOLS.OINK.at(-1)!.address,
  degenPool: SETTINGS_POOLS.DEGEN.at(-1)!.address,
  minOink: "0",
  minDegen: "0",
  fee: "0",
};

export function RewardsActions({
  wallet,
  balance,
  pendingOink,
  pendingDegen,
  onComplete,
}: {
  wallet: WalletState;
  balance: bigint;
  pendingOink: bigint;
  pendingDegen: bigint;
  onComplete: () => Promise<void>;
}) {
  const [action, setAction] = useState<Action>(null);
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const close = () => {
    if (!busy) {
      setAction(null);
      setStatus("");
    }
  };
  return (
    <>
      <div className="reward-actions">
        <button onClick={() => setAction("harvest")}>Harvest Rewards</button>
        <button onClick={() => setAction("settings")}>Miner Settings</button>
        <button
          className="danger"
          disabled={balance === 0n}
          onClick={() => setAction("burn")}
        >
          Burn / Cash Out
        </button>
      </div>
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
          onComplete={onComplete}
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
          onComplete={onComplete}
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
          onComplete={onComplete}
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
}: {
  title: string;
  children: ReactNode;
  close: () => void;
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
        className="action-modal"
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <header>
          <div>
            <span className="eyebrow">NFT Miner</span>
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
  const [amount, setAmount] = useState(display(max));
  const [destination, setDestination] = useState(
    HARVEST_DESTINATIONS.OINK[0].address!,
  );
  useEffect(() => {
    setAmount(display(max));
    setDestination(HARVEST_DESTINATIONS[token][0].address!);
  }, [token, max]);
  const option = HARVEST_DESTINATIONS[token].find(
    (item) => (item.address || "WALLET") === destination,
  )!;
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
    <Modal title="Harvest Rewards" close={close}>
      <div className="token-switch">
        <button
          className={token === "OINK" ? "active" : ""}
          onClick={() => setToken("OINK")}
        >
          OINK · {display(pendingOink)}
        </button>
        <button
          className={token === "DEGEN" ? "active" : ""}
          onClick={() => setToken("DEGEN")}
        >
          DEGEN · {display(pendingDegen)}
        </button>
      </div>
      <label className="field-label">
        Amount (maximum {display(max)} {token})
        <input
          value={amount}
          inputMode="decimal"
          onChange={(event) => setAmount(event.target.value)}
        />
      </label>
      <div className="destination-list">
        {HARVEST_DESTINATIONS[token].map((item) => (
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
                  ? "Receive 100%"
                  : `Receive ${item.payoutPct}% · ${100 - item.payoutPct}% penalty`}
              </small>
            </span>
          </label>
        ))}
      </div>
      {option.payoutPct < 100 && (
        <p className="action-warning">
          This destination has a substantial early-withdrawal penalty. A
          full-payout pool is selected by default.
        </p>
      )}
      <ActionFooter
        busy={busy}
        status={status}
        close={close}
        submit={() => void submit()}
        label={`Harvest ${token}`}
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
        setSettings({
          oinkPool:
            raw.defaultHarvest1 === ZeroAddress
              ? initialSettings.oinkPool
              : String(raw.defaultHarvest1),
          degenPool:
            raw.defaultHarvest2 === ZeroAddress
              ? initialSettings.degenPool
              : String(raw.defaultHarvest2),
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
    <Modal title="Miner Settings" close={close}>
      {loading ? (
        <p>Loading your on-chain settings…</p>
      ) : (
        <div className="settings-grid">
          <label>
            OINK auto-harvest pool
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
          </label>
          <label>
            DEGEN auto-harvest pool
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
          </label>
          <label>
            Minimum OINK harvest
            <input
              value={settings.minOink}
              onChange={(e) => field("minOink", e.target.value)}
            />
          </label>
          <label>
            Minimum DEGEN harvest
            <input
              value={settings.minDegen}
              onChange={(e) => field("minDegen", e.target.value)}
            />
          </label>
          <label>
            Harvest fee (%)
            <input
              value={settings.fee}
              onChange={(e) => field("fee", e.target.value)}
            />
            <small>
              0 uses the contract default; custom fee cannot be below 1%.
            </small>
          </label>
        </div>
      )}
      <ActionFooter
        busy={busy || loading}
        status={status}
        close={close}
        submit={() => void submit()}
        label="Save On-Chain Settings"
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
