import { confirmTransaction } from "../../lib/transactions";
import { Contract, ZeroAddress, formatEther, parseEther, parseUnits, type JsonRpcSigner } from "ethers";
import { useEffect, useRef, useState } from "react";
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
import { usePageActive } from "../../hooks/usePageActive";
import { HelpTip } from "../../components/HelpTip";
import type { RewardToken } from "./options";

// Verified NFTVault/NFTMint source: reference-original/extracted/NFT*.verified.json.
const NFT_ACTION_ABI = [...NFT_ABI,
  "function poolPayout(address) view returns (uint256 amount, uint256 minServe)",
  "function poolPayout2(address) view returns (uint256 amount, uint256 minServe)",
  "function defaultDirectPayout() view returns (uint256)",
  "function defaultFee() view returns (uint256)",
] as const;
const MINT_ACTION_ABI = [...MINT_ABI,
  "function penalty(address) view returns (uint256)",
  "function getPricesInInputToken(address) view returns (uint256 oinkPerInputToken, uint256 tokenXPerInputToken)",
] as const;
type HarvestRule = { bps: bigint; minServe: bigint };
export function parseNftFee(value: string): bigint {
  const bps = parseUnits(value || "0", 2);
  if (bps < 0n || bps > 2500n) throw new Error("Automatic harvest fee must be between 0% and 25%, with up to two decimal places.");
  return bps;
}
export function burnPayment(purchase: Purchase, amount: bigint): bigint {
  return amount === purchase.amount ? purchase.amountPaid : purchase.amountPaid / purchase.amount * amount;
}
async function readHarvestRule(contract: Contract, token: RewardToken, destination: string): Promise<HarvestRule> {
  if (destination === "WALLET") return { bps: BigInt(await contract.defaultDirectPayout()), minServe: 0n };
  const raw = token === "OINK" ? await contract.poolPayout(destination) : await contract.poolPayout2(destination);
  return { bps: BigInt(raw.amount), minServe: BigInt(raw.minServe) };
}
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
const harvestInput = (value: bigint) => formatEther(value);
async function checkNetworkFee(signer: JsonRpcSigner, gas: bigint) {
  const [fee, balance] = await Promise.all([signer.provider.getFeeData(), signer.provider.getBalance(await signer.getAddress())]);
  const price = fee.maxFeePerGas ?? fee.gasPrice;
  if (!price || balance < gas * price * 120n / 100n) throw new Error("Keep enough PLS for the network fee.");
}
const initialSettings: Settings = {
  oinkPool: ZeroAddress,
  degenPool: ZeroAddress,
  minOink: "0",
  minDegen: "0",
  fee: "0",
};
const initialSettingsSummary: SettingsSummary = {
  loading: true,
  error: "",
  oinkPool: "—",
  degenPool: "—",
  minOink: "—",
  minDegen: "—",
  fee: "—",
};
const poolSummary = (token: RewardToken, address: unknown) => {
  const rawAddress = String(address || "");
  if (!rawAddress || rawAddress === ZeroAddress) {
    return `${token} — Contract default`;
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
  const submissionLock = useRef(false);
  const pageActive = usePageActive();
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const [settingsRevision, setSettingsRevision] = useState(0);
  const [settingsSummary, setSettingsSummary] =
    useState<SettingsSummary>(initialSettingsSummary);
  useEffect(() => {
    if (!dashboard || !wallet.address || !pageActive) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      if (document.hidden) { timer = setTimeout(() => void poll(), 60_000); return; }
      try {
        const { provider } = await getPublicContracts();
        const nft = new Contract(CONTRACTS.nft, NFT_ACTION_ABI, provider);
        const [raw, defaultFee] = await Promise.all([nft.userSettings(wallet.address), nft.defaultFee()]);
        if (cancelled) return;
        setSettingsSummary({
          loading: false,
          error: "",
          oinkPool: poolSummary("OINK", raw.defaultHarvest1),
          degenPool: poolSummary("DEGEN", raw.defaultHarvest2),
          minOink: settingAmount(raw.minimumHarvest1),
          minDegen: settingAmount(raw.minimumHarvest2),
          fee: raw.fee === 1n ? "0%" : raw.fee === 0n ? `${Number(defaultFee) / 100}% (default)` : `${Number(raw.fee) / 100}%`,
        });
      } catch (error) {
        if (cancelled) return;
        setSettingsSummary(current => ({ ...current, loading: false, error: readableError(error) }));
      } finally {
        if (!cancelled) timer = setTimeout(() => void poll(), 60_000);
      }
    };
    void poll();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [dashboard, wallet.address, settingsRevision, pageActive]);
  const complete = async () => {
    await onComplete().catch(() => undefined);
    setSettingsRevision((current) => current + 1);
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
              disabled={pendingOink <= 0n && pendingDegen <= 0n}
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
              Choose a destination to claim pending rewards. Shorter pools and wallet payouts can reduce the amount received.
            </span>
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
                Settings temporarily unavailable.
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
          submissionLock={submissionLock}
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
          submissionLock={submissionLock}
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
          submissionLock={submissionLock}
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
  submissionLock: { current: boolean };
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
      className="modal-backdrop nft-action-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) close();
      }}
    >
      <section
        className={`action-modal ${className}`.trim()}
        role="dialog"
        aria-modal="false"
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
  submissionLock,
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
  const [minimums, setMinimums] = useState<{ OINK: bigint; DEGEN: bigint } | null>(null);
  const [rules, setRules] = useState<Record<string, HarvestRule>>({});
  useEffect(() => {
    let active = true;
    setRules({});
    void getPublicContracts().then(async ({ provider }) => {
      const contract = new Contract(CONTRACTS.nft, NFT_ACTION_ABI, provider);
      const values = await Promise.allSettled(HARVEST_DESTINATIONS[token].map(async choice => {
        const key = choice.address || "WALLET";
        return [key, await readHarvestRule(contract, token, key)] as const;
      }));
      if (active) setRules(Object.fromEntries(values.flatMap(value => value.status === "fulfilled" ? [value.value] : [])));
    }).catch(() => undefined);
    return () => { active = false; };
  }, [token]);
  useEffect(() => {
    let active = true;
    void getPublicContracts().then(async ({ nft }) => {
      const [OINK, DEGEN] = await Promise.all([nft.defaultMinHarvestOink(), nft.defaultMinHarvestDegen()]);
      if (active) setMinimums({ OINK, DEGEN });
    }).catch(() => undefined);
    return () => { active = false; };
  }, [wallet.address]);
  const max = token === "OINK" ? pendingOink : pendingDegen;
  const [amount, setAmount] = useState(() => harvestInput(pendingOink));
  const [destination, setDestination] = useState(
    HARVEST_DESTINATIONS.OINK[0].address!,
  );
  const choices = HARVEST_DESTINATIONS[token];
  let amountRaw = 0n;
  try { amountRaw = parseEther(amount.replace(/[, ]/g, "")); } catch { /* Incomplete input has no estimate. */ }
  const selectedRule = rules[destination];
  const chooseToken = (nextToken: RewardToken) => {
    const nextMax = nextToken === "OINK" ? pendingOink : pendingDegen;
    setToken(nextToken);
    setAmount(harvestInput(nextMax));
    setDestination(
      HARVEST_DESTINATIONS[nextToken][0].address || "WALLET",
    );
  };
  const submit = async () => {
    if (submissionLock.current) return;
    submissionLock.current = true;
    try {
      setBusy(true);
      setStatus("");
      const amountWei = parseEther(amount.replace(/,/g, ""));
      if (amountWei <= 0n || amountWei > max)
        throw new Error(`Enter an amount up to ${display(max)} ${token}.`);
      const signer = await wallet.getSigner();
      const contract = new Contract(CONTRACTS.nft, NFT_ACTION_ABI, signer);
      if (!choices.some(item => (item.address || "WALLET") === destination)) throw new Error("Choose a supported destination.");
      const target = destination === "WALLET" ? wallet.address! : destination;
      const freshRule = await readHarvestRule(contract, token, destination);
      const listedRule = rules[destination];
      if (freshRule.bps <= 0n || freshRule.bps > 10000n) throw new Error("This harvest destination is unavailable.");
      if (!listedRule || listedRule.bps !== freshRule.bps || listedRule.minServe !== freshRule.minServe) {
        setRules(current => ({ ...current, [destination]: freshRule }));
        throw new Error("Destination terms changed. Check the updated payout and choose Harvest again.");
      }
      const pending = await contract.viewUserTotalEarnings(await signer.getAddress());
      const currentMax: bigint = token === "OINK" ? pending[0] : pending[1];
      if (amountWei > currentMax) throw new Error("Pending rewards changed. Enter an amount within your current balance.");
      await contract.selfHarvest.staticCall(amountWei, target, token === "OINK");
      await checkNetworkFee(signer, await contract.selfHarvest.estimateGas(amountWei, target, token === "OINK"));
      await wallet.getSigner();
      const tx = await contract.selfHarvest(
        amountWei,
        target,
        token === "OINK",
      );
      setStatus("");
      await confirmTransaction(tx);
      setStatus("");
      await onComplete();
    } catch (error) {
      setStatus(readableError(error));
    } finally {
      submissionLock.current = false;
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
      <button type="button" className="amount-max" disabled={busy} onClick={() => setAmount(harvestInput(max))}>Max</button>
      <small className="form-hint">Max fills the last available pending balance. The current balance is checked before claiming.</small>
      {minimums && <p className="form-hint">Automatic harvest minimum: {display(minimums[token])} {token} <HelpTip label="automatic harvest minimum">The contract default threshold applies to automated harvesting; your saved settings may override it. A manual claim is checked against the current contract rules before your wallet opens.</HelpTip></p>}
      <div className="modal-section-label">Harvest Into… · Current payout comparison</div>
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
                {rules[item.address || "WALLET"] ? <>{display(amountRaw * rules[item.address || "WALLET"].bps / 10000n)} {token} · {100 - Number(rules[item.address || "WALLET"].bps) / 100}% penalty{rules[item.address || "WALLET"].minServe > 0n ? ` · at least ${Number(rules[item.address || "WALLET"].minServe) / 86400} days` : ""}</> : "Payout quote unavailable"}
              </small>
            </span>
          </label>
        ))}
      </div>
      <p className="form-hint">Expected payout: {selectedRule ? `${display(amountRaw * selectedRule.bps / 10000n)} ${token}` : "Unavailable"} <HelpTip label="claim destination penalties">Amounts use the NFT contract's current payout basis points and minimum lock period. Manual harvesting does not charge the automatic harvesting fee. Terms and eligibility are checked again before your wallet opens.</HelpTip></p>
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
  submissionLock,
  busy,
  setBusy,
  status,
  setStatus,
  close,
  onComplete,
}: Shared) {
  const [settings, setSettings] = useState<Settings>(initialSettings);
  const [defaults, setDefaults] = useState({ oink: "0", degen: "0" });
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
          oinkPool: String(raw.defaultHarvest1),
          degenPool: String(raw.defaultHarvest2),
          minOink: formatEther(raw.minimumHarvest1),
          minDegen: formatEther(raw.minimumHarvest2),
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
    if (submissionLock.current) return;
    submissionLock.current = true;
    try {
      setBusy(true);
      setStatus("");
      const feeBps = parseNftFee(settings.fee);
      const signer = await wallet.getSigner();
      const contract = new Contract(CONTRACTS.nft, NFT_ACTION_ABI, signer);
      for (const [token, destination] of [["OINK", settings.oinkPool], ["DEGEN", settings.degenPool]] as const) {
        if (destination === ZeroAddress) continue;
        const rule = await readHarvestRule(contract, token, destination);
        if (rule.bps <= 0n || rule.bps > 10000n) throw new Error("Choose supported harvest pools.");
      }
      const minOink = parseEther(settings.minOink || "0"), minDegen = parseEther(settings.minDegen || "0");
      if (minOink < 0n || minDegen < 0n) throw new Error("Minimum harvest amounts cannot be negative.");
      await contract.setUserSettings.staticCall(settings.oinkPool, settings.degenPool, minOink, minDegen, feeBps);
      await checkNetworkFee(signer, await contract.setUserSettings.estimateGas(settings.oinkPool, settings.degenPool, minOink, minDegen, feeBps));
      await wallet.getSigner();
      const tx = await contract.setUserSettings(
        settings.oinkPool,
        settings.degenPool,
        parseEther(settings.minOink || "0"),
        parseEther(settings.minDegen || "0"),
        feeBps,
      );
      setStatus("");
      await confirmTransaction(tx);
      setStatus("");
      await onComplete();
    } catch (error) {
      setStatus(readableError(error));
    } finally {
      submissionLock.current = false;
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
          <label>
            OINK Harvest
            <select
              value={settings.oinkPool}
              onChange={(e) => field("oinkPool", e.target.value)}
            >
              <option value={ZeroAddress}>Contract default</option>
              {settings.oinkPool !== ZeroAddress && !SETTINGS_POOLS.OINK.some(item => item.address.toLowerCase() === settings.oinkPool.toLowerCase()) && <option value={settings.oinkPool}>Current pool · {shortAddress(settings.oinkPool)}</option>}
              {SETTINGS_POOLS.OINK.map((item) => (
                <option value={item.address} key={item.address}>
                  {item.label}
                </option>
              ))}
            </select>
            <small>
              Destination for automatically harvested OINK rewards.
            </small>
          </label>
          <label>
            DEGEN Harvest
            <select
              value={settings.degenPool}
              onChange={(e) => field("degenPool", e.target.value)}
            >
              <option value={ZeroAddress}>Contract default</option>
              {settings.degenPool !== ZeroAddress && !SETTINGS_POOLS.DEGEN.some(item => item.address.toLowerCase() === settings.degenPool.toLowerCase()) && <option value={settings.degenPool}>Current pool · {shortAddress(settings.degenPool)}</option>}
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
              Enter 0 for the contract default ({defaults.oink} OINK). Threshold for automatic harvests.
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
              Enter 0 for the contract default ({defaults.degen} DEGEN). Threshold for automatic harvests.
            </small>
          </label>
          <label>
            Automatic harvest fee (%)
            <input
              inputMode="decimal"
              value={settings.fee}
              onChange={(e) => field("fee", e.target.value)}
            />
            <small>
              Maximum 25%. Enter 0 for the contract default, or 0.01 to disable the automatic fee. Manual harvests have no automatic harvest fee.
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
  submissionLock,
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
  const [recordLimit, setRecordLimit] = useState(20);
  const [moreRecords, setMoreRecords] = useState(false);
  const [payouts, setPayouts] = useState<Record<string, bigint>>({});
  const [burnPenalties, setBurnPenalties] = useState<Record<string, bigint>>({});
  const [purchaseRevision, setPurchaseRevision] = useState(0);
  const [purchaseId, setPurchaseId] = useState(0);
  const [preview, setPreview] = useState<bigint | null>(null);

  const selected = purchases.find((item) => item.id === purchaseId);
  const burnAmount = selected ? (balance < selected.amount ? balance : selected.amount) : 0n;
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
        let lastExists = false;
        for (let start = 0; start < recordLimit; start += 5) {
          const results = await Promise.allSettled(Array.from({ length: Math.min(5, recordLimit - start) }, (_, offset) => mint.userPurchases(wallet.address, start + offset)));
          for (const [offset, result] of results.entries()) {
            if (result.status === "rejected") {
              const failure = result.reason as { code?: string };
              // A successful earlier page can end at the contract's array boundary.
              if (failure.code !== "CALL_EXCEPTION") throw result.reason;
              continue;
            }
            const raw = result.value;
            lastExists = start + offset === recordLimit - 1;
            if (raw.amount > 0n) found.push({ id: start + offset, amount: raw.amount, amountPaid: raw.amountPaid, tokenPaid: String(raw.tokenPaid) });
          }
        }
        if (!cancelled) {
          setPurchases(found);
          setPurchaseId(current => found.some(item => item.id === current) ? current : found[0]?.id || 0);
          setMoreRecords(lastExists);
        }
      } catch (error) {
        if (!cancelled) setStatus(readableError(error));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [wallet.address, setStatus, recordLimit, purchaseRevision]);
  useEffect(() => {
    if (!selected || !wallet.address) return;
    let cancelled = false;
    setPayouts({});
    setPreview(null);
    void (async () => {
      try {
        const { provider } = await getPublicContracts();
        const mint = new Contract(CONTRACTS.mint, MINT_ACTION_ABI, provider);
        const rates = await mint.getPricesInInputToken(selected.tokenPaid);
        const payment = burnPayment(selected, burnAmount);
        const rate: bigint = token === "OINK" ? rates[0] : rates[1];
        const results = await Promise.allSettled(BURN_DESTINATIONS[token].filter(choice => choice.address).map(async choice => {
          const target = choice.address!;
          const [, payoutPct] = await Promise.all([
            mint.previewBurnReturn(selected.id, burnAmount, token === "OINK", target, { from: wallet.address }),
            mint.penalty(target) as Promise<bigint>,
          ]);
          if (payoutPct <= 0n || payoutPct > 100n) throw new Error("Invalid payout percentage");
          return [target, { payout: (rate * payment / 10n ** 18n) * payoutPct / 100n, payoutPct }] as const;
        }));
        if (!cancelled) {
          const entries = results.flatMap(result => result.status === "fulfilled" ? [result.value] : []);
          setPayouts(Object.fromEntries(entries.map(([key, value]) => [key, value.payout])));
          setBurnPenalties(Object.fromEntries(entries.map(([key, value]) => [key, value.payoutPct])));
        }
      } catch {
        if (!cancelled) setPreview(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selected, token, burnAmount, wallet.address]);
  useEffect(() => { setPreview(payouts[destination] ?? null); }, [payouts, destination]);
  const submit = async () => {
    if (submissionLock.current) return;
    submissionLock.current = true;
    try {
      setBusy(true);
      setStatus("");
      if (!selected)
        throw new Error("No purchase record was found for this wallet.");
      const signer = await wallet.getSigner();
      const contract = new Contract(CONTRACTS.mint, MINT_ACTION_ABI, signer);
      const target = destination === "WALLET" ? wallet.address! : destination;
      if (!BURN_DESTINATIONS[token].some(item => (item.address || "WALLET") === destination)) throw new Error("Choose a supported destination.");
      const nft = new Contract(CONTRACTS.nft, NFT_ABI, signer);
      const [currentBalance, purchase, rates, payoutPct] = await Promise.all([
        nft.balanceOf(await signer.getAddress(), NFT_TOKEN_ID),
        contract.userPurchases(await signer.getAddress(), selected.id),
        contract.getPricesInInputToken(selected.tokenPaid),
        contract.penalty(target) as Promise<bigint>,
      ]);
      if (burnAmount <= 0n || currentBalance < burnAmount || purchase.amount !== selected.amount || purchase.amountPaid !== selected.amountPaid || String(purchase.tokenPaid).toLowerCase() !== selected.tokenPaid.toLowerCase()) throw new Error("Your NFT balance or purchase record changed. Choose the action again.");
      const rate: bigint = token === "OINK" ? rates[0] : rates[1];
      const freshPreview = (rate * burnPayment(selected, burnAmount) / 10n ** 18n) * payoutPct / 100n;
      if (preview === null || freshPreview !== preview) {
        setPreview(freshPreview);
        throw new Error("The return changed. Check the updated estimate and choose Burn again.");
      }
      await contract.burnNFT.staticCall(selected.id, token === "OINK", burnAmount, target);
      await checkNetworkFee(signer, await contract.burnNFT.estimateGas(selected.id, token === "OINK", burnAmount, target));
      await wallet.getSigner();
      const tx = await contract.burnNFT(
        selected.id,
        token === "OINK",
        burnAmount,
        target,
      );
      setStatus("");
      await confirmTransaction(tx);
      setStatus("");
      setPurchaseRevision(current => current + 1);
      await onComplete();
    } catch (error) {
      setStatus(readableError(error));
    } finally {
      submissionLock.current = false;
      setBusy(false);
    }
  };
  const choices = BURN_DESTINATIONS[token].filter(choice => choice.address);
  return (
    <Modal title="Burn / Cash Out NFT Miners" close={close}>
      <p className="destructive-copy">
        {selected ? `Burning permanently destroys ${burnAmount.toString()} NFT miner${burnAmount === 1n ? "" : "s"} from the selected purchase record. This cannot be undone.` : "Choose an available purchase record to view the burn amount and expected return."}
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
      {moreRecords && <button type="button" disabled={busy} onClick={() => setRecordLimit(limit => limit + 20)}>Show more purchase records</button>}
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
              <small>{payouts[item.address!] !== undefined ? `${display(payouts[item.address!])} ${token} · ${100 - Number(burnPenalties[item.address!])}% penalty` : "Payout quote unavailable"}</small>
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
      <ActionFooter
        busy={busy || !selected || preview === null || burnAmount === 0n}
        status={status}
        close={close}
        submit={() => void submit()}
        label={`Burn ${burnAmount.toString()} NFT${burnAmount === 1n ? "" : "s"}`}
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
