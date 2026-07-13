import { Contract, formatEther, isAddress } from "ethers";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { CSSProperties } from "react";
import { MINER_POOL_ABI } from "../config/contracts";
import type { WalletState } from "../hooks/useWallet";
import { getPublicProvider, readableError, shortAddress } from "../lib/chain";
import { SETTINGS_POOLS } from "./nft/options";

type Miner = {
  token: "DEGEN";
  pool: string;
  poolLabel: string;
  duration: number;
  stakeId: number;
  shares: bigint;
  amount: bigint;
  started: number;
  mandatory: number;
  grace: number;
};
type Action = "hop" | "transfer" | "withdraw";
const DURATIONS: Record<string, number> = {
  "0xd9b491ac0f5487673500b67224b67b4171a08aca": 2592000,
  "0x7ed33f65a0398cb26eab2b03877825c96d9b6077": 7776000,
  "0x3d175c8359169b0e830d36ea9cd3fe209f46f7bd": 31536000,
  "0xde672fcca32365bd704c39bd1164a0d34a3a73e6": 315360000,
};
const fmt = (value: bigint) =>
  Number(formatEther(value)).toLocaleString(undefined, {
    maximumFractionDigits: 4,
  });
const percent = (miner: Miner) =>
  Math.min(
    100,
    Math.max(0, ((Date.now() / 1000 - miner.started) / miner.duration) * 100),
  );

export function MyMinersPage({ wallet }: { wallet: WalletState }) {
  const [miners, setMiners] = useState<Miner[]>([]),
    [loading, setLoading] = useState(false),
    [error, setError] = useState(""),
    [selected, setSelected] = useState<Miner | null>(null),
    [action, setAction] = useState<Action>("hop"),
    [status, setStatus] = useState("");
  const load = useCallback(async () => {
    if (!wallet.address) {
      setMiners([]);
      return;
    }
    setLoading(true);
    setError("");
    try {
      const provider = await getPublicProvider();
      const pools = SETTINGS_POOLS.DEGEN.map((p) => ({
        ...p,
        token: "DEGEN" as const,
      }));
      const groups = await Promise.all(
        pools.map(async (p) => {
          try {
            const c = new Contract(p.address, MINER_POOL_ABI, provider);
            const [count, pps, grace] = await Promise.all([
              c.getNrOfStakes(wallet.address),
              c.getPricePerFullShare(),
              c.gracePeriod().catch(() => 0n),
            ]);
            const records = await Promise.all(
              Array.from({ length: Number(count) }, async (_, stakeId) => {
                const info = await c.userInfo(wallet.address, stakeId);
                const shares = BigInt(info.shares);
                const amount = (shares * BigInt(pps)) / 1000000000000000000n;
                return amount > 0n
                  ? {
                      token: p.token,
                      pool: p.address,
                      poolLabel: p.label,
                      duration:
                        DURATIONS[p.address.toLowerCase()] ||
                        Number(info.mandatoryTimeToServe) ||
                        2592000,
                      stakeId,
                      shares,
                      amount,
                      started: Number(info.lastMineredTime),
                      mandatory: Number(info.mandatoryTimeToServe),
                      grace: Number(grace),
                    }
                  : null;
              }),
            );
            return records.filter(Boolean) as Miner[];
          } catch {
            return [];
          }
        }),
      );
      setMiners(groups.flat());
    } catch (e) {
      setError(readableError(e));
    } finally {
      setLoading(false);
    }
  }, [wallet.address]);
  useEffect(() => {
    void load();
  }, [load]);
  const total = miners.reduce((sum, m) => sum + m.amount, 0n);
  if (!wallet.isConnected)
    return (
      <main className="legacy-section">
        <section className="rw-miners-section empty-state">
          <h2>Miners</h2>
          <p>Connect your wallet to view staked miners</p>
          <button className="mint-button" onClick={() => void wallet.connect()}>
            Connect Wallet
          </button>
        </section>
      </main>
    );
  return (
    <main className="legacy-section">
      <section className="miners-summary">
        <div>
          <span>Wallet:</span>
          <b>{shortAddress(wallet.address)}</b>
        </div>
        <div>
          <span>Total Miners:</span>
          <b>{fmt(total)} DEGEN</b>
        </div>
        <div>
          <span>Positions:</span>
          <b>{miners.length}</b>
        </div>
      </section>
      {error && <div className="panel-message error">{error}</div>}
      <section className="rw-miners-section">
        <header className="rw-miners-header">
          <div>
            <h1>
              Miners <small>{miners.length}</small>
            </h1>
            <p>
              Time-locked positions from auto-harvest — sorted by % progress
            </p>
          </div>
        </header>
        <div className="rw-miners-grid">
          {loading ? (
            <p>Loading miners…</p>
          ) : (
            miners.map((m) => {
              const pct = percent(m),
                served = Math.max(
                  0,
                  Math.floor((Date.now() / 1000 - m.started) / 86400),
                ),
                days = Math.floor(m.duration / 86400);
              return (
                <article
                  className="mc-card"
                  style={{ "--mc": "var(--accent)" } as CSSProperties}
                  key={`${m.pool}-${m.stakeId}`}
                >
                  <header className="mc-card-toprow">
                    <b className="mc-card-dur">
                      {m.poolLabel.replace(" (default)", "")} Lock
                    </b>
                    <span className="mc-card-num">#{m.stakeId}</span>
                  </header>
                  <strong className="mc-card-amount">{fmt(m.amount)}</strong>
                  <div className="mc-card-token-name">DEGEN</div>
                  <div className="mc-card-progress">
                    <div className="mc-card-prog-label">
                      <span>
                        Progress ({m.poolLabel.replace(" (default)", "")} Miner)
                      </span>
                      <span>{pct.toFixed(1)}%</span>
                    </div>
                    <div className="mc-card-bar-track">
                      <i
                        className="mc-card-bar-fill"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                    <div className="mc-card-days">
                      <span>
                        {served.toLocaleString()} / {days.toLocaleString()} days
                      </span>
                    </div>
                  </div>
                  <div className="mc-card-footer">
                    <span className="mc-penalty-label">Early Exit Penalty</span>
                    <b className="mc-penalty-val">
                      {pct >= 100 ? "0%" : `${(100 - pct).toFixed(1)}%`}
                    </b>
                  </div>
                  <div className="miner-actions">
                    <button
                      onClick={() => {
                        setAction("hop");
                        setSelected(m);
                      }}
                    >
                      Upgrade
                    </button>
                    <button
                      onClick={() => {
                        setAction("transfer");
                        setSelected(m);
                      }}
                    >
                      Transfer
                    </button>
                    <button
                      className="danger"
                      onClick={() => {
                        setAction("withdraw");
                        setSelected(m);
                      }}
                    >
                      Withdraw
                    </button>
                  </div>
                </article>
              );
            })
          )}
          {!loading && !miners.length && <p>No staked miners found.</p>}
        </div>
      </section>
      {selected && (
        <MinerAction
          miner={selected}
          action={action}
          wallet={wallet}
          status={status}
          setStatus={setStatus}
          close={() => {
            setSelected(null);
            setStatus("");
          }}
          complete={load}
        />
      )}
    </main>
  );
}

function MinerAction({
  miner,
  action,
  wallet,
  status,
  setStatus,
  close,
  complete,
}: {
  miner: Miner;
  action: Action;
  wallet: WalletState;
  status: string;
  setStatus: (s: string) => void;
  close: () => void;
  complete: () => Promise<void>;
}) {
  const [mode, setMode] = useState<"full" | "partial">("full"),
    [amount, setAmount] = useState(""),
    [recipient, setRecipient] = useState(""),
    [target, setTarget] = useState(
      SETTINGS_POOLS[miner.token].find(
        (p) => DURATIONS[p.address.toLowerCase()] > miner.duration,
      )?.address || "",
    ),
    [confirmed, setConfirmed] = useState(false),
    [busy, setBusy] = useState(false);
  const eligible = useMemo(
    () =>
      SETTINGS_POOLS[miner.token].filter(
        (p) => DURATIONS[p.address.toLowerCase()] > miner.duration,
      ),
    [miner],
  );
  const shares = () => {
    if (mode === "full") return miner.shares;
    const n = Number(amount);
    const full = Number(formatEther(miner.amount));
    if (!n || n <= 0 || n > full)
      throw new Error("Enter a valid partial amount.");
    return (
      (miner.shares * BigInt(Math.round(n * 1e6))) /
      BigInt(Math.round(full * 1e6))
    );
  };
  const run = async () => {
    try {
      setBusy(true);
      setStatus("Confirm this miner action in your wallet…");
      const signer = await wallet.getSigner();
      const c = new Contract(miner.pool, MINER_POOL_ABI, signer);
      let tx;
      if (action === "hop") {
        if (!target)
          throw new Error("This miner is already in the longest pool.");
        tx = await c.hopStakeToAnotherPool(shares(), miner.stakeId, target);
      } else if (action === "transfer") {
        if (!isAddress(recipient))
          throw new Error("Enter a valid recipient wallet.");
        tx = await c.transferStakeToAnotherWallet(
          shares(),
          miner.stakeId,
          recipient,
        );
      } else {
        if (!confirmed)
          throw new Error("Confirm the withdrawal warning first.");
        tx =
          mode === "full"
            ? await c.withdrawAll(miner.stakeId)
            : await c.withdraw(shares(), miner.stakeId);
      }
      setStatus("Transaction submitted. Waiting for confirmation…");
      await tx.wait();
      setStatus(`${action} confirmed: ${tx.hash.slice(0, 10)}…`);
      await complete();
    } catch (e) {
      setStatus(readableError(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="modal-backdrop">
      <section className="action-modal">
        <header>
          <div>
            <span className="eyebrow">
              {miner.token} miner #{miner.stakeId}
            </span>
            <h2>
              {action === "hop"
                ? "Upgrade Miner"
                : action === "transfer"
                  ? "Transfer Miner"
                  : "Withdraw Miner"}
            </h2>
          </div>
          <button onClick={close}>×</button>
        </header>
        <div className="modal-content">
          {action === "hop" && (
            <label>
              New longer pool
              <select
                value={target}
                onChange={(e) => setTarget(e.target.value)}
              >
                {eligible.map((p) => (
                  <option value={p.address} key={p.address}>
                    {p.label}
                  </option>
                ))}
              </select>
            </label>
          )}
          {action === "transfer" && (
            <label>
              Recipient wallet
              <input
                value={recipient}
                onChange={(e) => setRecipient(e.target.value)}
              />
            </label>
          )}
          <label>
            Amount
            <select
              value={mode}
              onChange={(e) => setMode(e.target.value as "full" | "partial")}
            >
              <option value="full">
                Full miner ({fmt(miner.amount)} {miner.token})
              </option>
              <option value="partial">Partial amount</option>
            </select>
          </label>
          {mode === "partial" && (
            <label>
              Custom amount
              <input
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
              />
            </label>
          )}
          {action === "withdraw" && (
            <label className="burn-confirm">
              <input
                type="checkbox"
                checked={confirmed}
                onChange={(e) => setConfirmed(e.target.checked)}
              />
              <span>
                {percent(miner) >= 100
                  ? "I understand this ends the matured miner."
                  : "WARNING: This miner has not completed its full term. Emergency-withdraw penalties may apply."}
              </span>
            </label>
          )}
        </div>
        <div className="modal-actions">
          <button onClick={close}>Cancel</button>
          <button
            className={action === "withdraw" ? "danger" : ""}
            disabled={busy || (action === "withdraw" && !confirmed)}
            onClick={() => void run()}
          >
            {busy ? "Please wait…" : "Confirm On-Chain"}
          </button>
        </div>
        {status && <div className="transaction-status">{status}</div>}
      </section>
    </div>
  );
}
