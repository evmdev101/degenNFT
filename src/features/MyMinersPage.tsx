// My Miners tab — markup and styling restored verbatim from the original
// single-file site (commit 825e9f2). Logic mirrors loadStakedMiners,
// renderSummaryCards, minerCards/minerRows, the live miner ticker and the
// hop / transfer / withdraw miner modals from the original inline script.
import { Contract, formatEther, isAddress } from "ethers";
import { useCallback, useEffect, useRef, useState } from "react";
import { CONTRACTS, ERC20_ABI } from "../config/contracts";
import type { WalletState } from "../hooks/useWallet";
import { getPublicProvider } from "../lib/chain";

// ── Constants from the original script ──────────────────────────────────────
const MASTERCHEF2 = "0xC84FbE083713544BB4Ea85E2fe95148D076b2942"; // DEGEN pool
const MASTERCHEF_ABI = [
  "function getNrOfStakes(address _user) view returns (uint256)",
  "function userInfo(address _address, uint256 _stakeID) view returns (uint256 shares, uint256 lastMineredTime, uint256 xvmcAtLastUserAction, uint256 lastUserActionTime, uint256 mandatoryTimeToServe)",
  "function getPricePerFullShare() view returns (uint256)",
  "function totalShares() view returns (uint256)",
  "function gracePeriod() view returns (uint256)",
];
const DTX_CHEF_ABI = [
  "function poolLength() view returns (uint256)",
  "function poolInfo(uint256) view returns (uint256 allocPoint, uint256 lastRewardBlock, address participant)",
];
const POOL_ACTION_ABI = [
  "function hopStakeToAnotherPool(uint256 _shares, uint256 _stakeID, address _poolAddress) external",
  "function transferStakeToAnotherWallet(uint256 _shares, uint256 _stakeID, address _recipientAddress) external",
  "function withdraw(uint256 _shares, uint256 _stakeID) external",
  "function withdrawAll(uint256 _stakeID) external",
];

const DEGEN_POOL_ADDRS = [
  "0xdE672FccA32365bD704c39bd1164a0D34a3a73e6", // 10 Year (NFT auto-harvest default)
  "0x3d175C8359169b0e830d36EA9CD3FE209f46f7BD", // 1 Year
  "0x7ED33f65A0398cb26eaB2B03877825c96D9B6077", // 3 Month
  "0xD9B491ac0f5487673500B67224b67b4171a08aCa", // 1 Month
];

const POOL_DURATIONS: Record<string, number> = {
  "0xd9b491ac0f5487673500b67224b67b4171a08aca": 2592000,
  "0x7ed33f65a0398cb26eab2b03877825c96d9b6077": 7776000,
  "0x3d175c8359169b0e830d36ea9cd3fe209f46f7bd": 31536000,
  "0xde672fcca32365bd704c39bd1164a0d34a3a73e6": 315360000,
};

const HOP_POOLS = [
  { addr: "0xD9B491ac0f5487673500B67224b67b4171a08aCa", label: "1 Month", dur: 2592000 },
  { addr: "0x7ED33f65A0398cb26eaB2B03877825c96D9B6077", label: "3 Month", dur: 7776000 },
  { addr: "0x3d175C8359169b0e830d36EA9CD3FE209f46f7BD", label: "1 Year", dur: 31536000 },
  { addr: "0xdE672FccA32365bD704c39bd1164a0D34a3a73e6", label: "10 Year", dur: 315360000 },
];

const BLOCKS_PER_DAY = 8000;

// ── Formatting helpers from the original script ──────────────────────────────
function durLabel(sec: number) {
  const s = Number(sec);
  const y = s / 31536000;
  const m = s / 2592000;
  if (y >= 9) return "10 Year";
  if (y >= 4) return "5 Year";
  if (y >= 2) return "3 Year";
  if (y >= 0.9) return "1 Year";
  if (m >= 5) return "6 Month";
  if (m >= 2) return "3 Month";
  return "1 Month";
}
function fmtMinerAmt(n: number) {
  if (n >= 1e9) return (n / 1e9).toFixed(2) + "B";
  if (n >= 1e6) return (n / 1e6).toFixed(2) + "M";
  if (n >= 1e3) return (n / 1e3).toFixed(2) + "K";
  return n.toFixed(2);
}
function fmtMinerWhole(n: number) {
  return Math.floor(Number(n || 0)).toLocaleString();
}
function fmtFullReward(n: number) {
  return Number(n || 0).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

const withTimeout = <T,>(promise: Promise<T>, ms: number) =>
  Promise.race([
    promise,
    new Promise<never>((_, rej) =>
      setTimeout(() => rej(new Error("timeout")), ms),
    ),
  ]);

async function fetchDegenPrice(): Promise<number | null> {
  try {
    const res = await withTimeout(
      fetch(
        `https://api.dexscreener.com/tokens/v1/pulsechain/${CONTRACTS.degen}`,
      ).then((r) => r.json()),
      6000,
    );
    if (!Array.isArray(res) || !res.length) return null;
    const p = parseFloat(res[0].priceUsd);
    return isNaN(p) || p <= 0 ? null : p;
  } catch {
    return null;
  }
}

type AllocMap = {
  map: Map<string, { allocPoint: number; poolId: number }>;
  totalAlloc: number;
  rewardPerBlock: number;
} | null;

async function buildAllocMap(): Promise<AllocMap> {
  try {
    const provider = await getPublicProvider();
    const mc = new Contract(MASTERCHEF2, DTX_CHEF_ABI, provider);
    // totalAllocPoint / DTXPerBlock have non-standard selectors — raw eth_call
    // like the original (verified selectors 0x17caf6f1 / 0x9cc34559)
    const rpcCall = async (data: string) => {
      const res = (await withTimeout(
        fetch("https://rpc.pulsechain.com", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            jsonrpc: "2.0",
            method: "eth_call",
            params: [{ to: MASTERCHEF2, data }, "latest"],
            id: 1,
          }),
        }).then((r) => r.json()),
        8000,
      )) as { error?: { message: string }; result: string };
      if (res.error) throw new Error(res.error.message);
      return BigInt(res.result);
    };
    const [poolLen, totalAlloc, rpb] = await Promise.all([
      mc.poolLength(),
      rpcCall("0x17caf6f1"),
      rpcCall("0x9cc34559"),
    ]);
    const n = Number(poolLen);
    const poolInfos = await Promise.allSettled(
      Array.from({ length: n }, (_, i) => mc.poolInfo(i)),
    );
    const map = new Map<string, { allocPoint: number; poolId: number }>();
    poolInfos.forEach((r, i) => {
      if (r.status === "fulfilled") {
        const [allocPoint, , participant] = r.value;
        map.set(String(participant).toLowerCase(), {
          allocPoint: Number(allocPoint),
          poolId: i,
        });
      }
    });
    return {
      map,
      totalAlloc: Number(totalAlloc),
      rewardPerBlock: parseFloat(formatEther(rpb)),
    };
  } catch (e) {
    console.error("[APR] buildAllocMap FAILED", (e as Error).message);
    return null;
  }
}

// ── Types ────────────────────────────────────────────────────────────────────
type Miner = {
  amount: number;
  pct: number;
  progressPct: number;
  withdrawReady: boolean;
  dailyReward: number;
  done: boolean;
  total: number;
  served: number;
  stakeId: number;
  poolAddr: string;
  shares: bigint;
  poolDur: number;
  ts: number; // fetch timestamp for the live counter
};

type MinerModal =
  | { kind: "hop"; miner: Miner }
  | { kind: "withdraw"; miner: Miner }
  | { kind: "transfer"; miner: Miner }
  | null;

const minerPid = (m: Miner) => `mc-${m.poolAddr.slice(2, 8)}-${m.stakeId}`;

// ── Component ────────────────────────────────────────────────────────────────
export function MyMinersPage({ wallet }: { wallet: WalletState }) {
  const [miners, setMiners] = useState<Miner[]>([]);
  const [pendingPools, setPendingPools] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const [viewMode, setViewMode] = useState<"grid" | "list">("grid");
  const [openMenu, setOpenMenu] = useState<string | null>(null);
  const [summary, setSummary] = useState<
    | { state: "connect" }
    | { state: "loading" }
    | { state: "error" }
    | { state: "ready"; wallet: number; staked: number; price: number | null }
  >({ state: wallet.address ? "loading" : "connect" });
  const [, setTick] = useState(0); // 1s re-render for the live miner counters

  const [modal, setModal] = useState<MinerModal>(null);
  const [hopPool, setHopPool] = useState("");
  const [amtMode, setAmtMode] = useState<"full" | "partial">("full");
  const [customAmt, setCustomAmt] = useState("");
  const [recipient, setRecipient] = useState("");
  const [modalStatus, setModalStatus] = useState("");
  const [modalBusy, setModalBusy] = useState(false);
  const loadSeq = useRef(0);

  // Live counter — original startDegenFarmTicker ticked every second
  useEffect(() => {
    const timer = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(timer);
  }, []);

  // Close the actions dropdown on any document click (original behaviour)
  useEffect(() => {
    const close = () => setOpenMenu(null);
    document.addEventListener("click", close);
    return () => document.removeEventListener("click", close);
  }, []);

  const loadStakedMiners = useCallback(async () => {
    const seq = ++loadSeq.current;
    if (!wallet.address) {
      setMiners([]);
      setLoaded(false);
      setSummary({ state: "connect" });
      return;
    }
    const address = wallet.address;
    setMiners([]);
    setLoaded(false);
    setPendingPools(DEGEN_POOL_ADDRS.length);
    setSummary({ state: "loading" });

    const provider = await getPublicProvider();
    const allocMap = await buildAllocMap().catch(() => null);
    const collected: Miner[] = [];

    async function fetchPoolMiners(poolAddr: string) {
      const result: Miner[] = [];
      try {
        const pool = new Contract(poolAddr, MASTERCHEF_ABI, provider);
        const [count, pricePerShare] = (await withTimeout(
          Promise.all([
            pool.getNrOfStakes(address),
            pool.getPricePerFullShare(),
          ]),
          12000,
        )) as [bigint, bigint];
        const n = Number(count);
        if (n === 0) return result;

        let poolDaily = 0;
        let poolTotal = 0;
        let gracePeriod = 0;
        try {
          const tShares = (await withTimeout(pool.totalShares(), 8000).catch(
            () => 0n,
          )) as bigint;
          if (tShares > 0n)
            poolTotal = Number(
              formatEther(
                (tShares * pricePerShare) / 1_000_000_000_000_000_000n,
              ),
            );
          gracePeriod = Number(
            await withTimeout(pool.gracePeriod(), 8000).catch(() => 0n),
          );
          const entry = allocMap?.map?.get(poolAddr.toLowerCase());
          if (entry && allocMap && allocMap.totalAlloc > 0) {
            poolDaily =
              allocMap.rewardPerBlock *
              BLOCKS_PER_DAY *
              (entry.allocPoint / allocMap.totalAlloc);
          }
        } catch {
          /* emission data is best-effort */
        }

        // Fetch stake info in small chunks with per-call timeouts — large
        // parallel bursts get rate-limited (same as the original)
        const infos: (Record<string, bigint> | null)[] = new Array(n).fill(
          null,
        );
        const CHUNK = 8;
        for (let start = 0; start < n; start += CHUNK) {
          const idxs = Array.from(
            { length: Math.min(CHUNK, n - start) },
            (_, k) => start + k,
          );
          const results = await Promise.all(
            idxs.map((i) =>
              withTimeout(pool.userInfo(address, i), 8000).catch(() => null),
            ),
          );
          results.forEach((r, k) => {
            infos[idxs[k]] = r as Record<string, bigint> | null;
          });
        }
        for (let i = 0; i < n; i++) {
          if (!infos[i])
            infos[i] = (await withTimeout(pool.userInfo(address, i), 8000).catch(
              () => null,
            )) as Record<string, bigint> | null;
        }

        const now = Math.floor(Date.now() / 1000);
        for (let i = 0; i < n; i++) {
          const info = infos[i];
          if (!info) continue;
          const amount = Number(
            formatEther(
              (info.shares * pricePerShare) / 1_000_000_000_000_000_000n,
            ),
          );
          if (amount < 0.000001) continue;
          const served = now - Number(info.lastMineredTime);
          const total = Number(info.mandatoryTimeToServe);
          const pct = total > 0 ? Math.min(100, (served / total) * 100) : 100;
          const poolDur =
            POOL_DURATIONS[poolAddr.toLowerCase()] || Number(total) || 2592000;
          const progressPct =
            poolDur > 0 ? Math.min(100, (served / poolDur) * 100) : pct;
          const withdrawReady =
            served >= poolDur &&
            (gracePeriod <= 0 || served <= poolDur + gracePeriod);
          const dailyReward =
            poolTotal > 0 && poolDaily > 0
              ? (amount / poolTotal) * poolDaily
              : 0;
          result.push({
            amount,
            pct,
            progressPct,
            withdrawReady,
            dailyReward,
            done: served >= total,
            total,
            served,
            stakeId: i,
            poolAddr,
            shares: info.shares,
            poolDur,
            ts: Date.now(),
          });
        }
      } catch (e) {
        console.warn("fetchPoolMiners", poolAddr, (e as Error).message);
      }
      return result;
    }

    // Stream results in as pools resolve — a few at a time (original used 3)
    let cursor = 0;
    async function poolWorker() {
      while (cursor < DEGEN_POOL_ADDRS.length) {
        const poolAddr = DEGEN_POOL_ADDRS[cursor++];
        try {
          const m = await fetchPoolMiners(poolAddr);
          collected.push(...m);
        } catch {
          /* pool failures already logged */
        }
        if (loadSeq.current !== seq) return;
        setMiners([...collected]);
        setPendingPools((p) => Math.max(0, p - 1));
      }
    }
    await Promise.all(Array.from({ length: 3 }, poolWorker));
    if (loadSeq.current !== seq) return;
    setLoaded(true);

    // Populate the summary bar
    try {
      const degenTok = new Contract(CONTRACTS.degen, ERC20_ABI, provider);
      const [walletRaw, price] = await Promise.all([
        degenTok.balanceOf(address).catch(() => 0n),
        fetchDegenPrice(),
      ]);
      if (loadSeq.current !== seq) return;
      setSummary({
        state: "ready",
        wallet: parseFloat(formatEther(walletRaw)),
        staked: collected.reduce((s, m) => s + m.amount, 0),
        price,
      });
    } catch (e) {
      console.warn("summary bar:", (e as Error).message);
      if (loadSeq.current === seq) setSummary({ state: "error" });
    }
  }, [wallet.address]);

  useEffect(() => {
    void loadStakedMiners();
  }, [loadStakedMiners]);

  // ── Modal actions (hop / withdraw / transfer) ──────────────────────────────
  function openMinerModal(kind: "hop" | "withdraw" | "transfer", miner: Miner) {
    setOpenMenu(null);
    if (kind === "hop") {
      const eligible = HOP_POOLS.filter((p) => p.dur > miner.poolDur);
      if (!eligible.length) {
        alert("This miner is already in the longest available pool.");
        return;
      }
      setHopPool(eligible[0].addr);
    }
    setAmtMode("full");
    setCustomAmt("");
    setRecipient("");
    setModalStatus("");
    setModalBusy(false);
    setModal({ kind, miner });
  }

  function closeModal() {
    setModal(null);
  }

  function sharesFor(miner: Miner): bigint | null {
    if (amtMode === "full") return miner.shares;
    const custom = parseFloat(customAmt || "0");
    if (!custom || custom <= 0 || custom > miner.amount) return null;
    const partE = BigInt(Math.round(custom * 1e6));
    const totE = BigInt(Math.round(miner.amount * 1e6));
    return (miner.shares * partE) / totE;
  }

  async function execModalAction() {
    if (!modal) return;
    const miner = modal.miner;
    try {
      if (modal.kind === "transfer" && !isAddress(recipient.trim())) {
        setModalStatus("Invalid recipient address.");
        return;
      }
      const shares = modal.kind === "withdraw" ? null : sharesFor(miner);
      if (modal.kind !== "withdraw" && shares === null) {
        setModalStatus("Invalid custom amount.");
        return;
      }
      setModalBusy(true);
      setModalStatus("Awaiting wallet confirmation…");
      const signer = await wallet.getSigner();
      const pool = new Contract(miner.poolAddr, POOL_ACTION_ABI, signer);
      let tx;
      if (modal.kind === "hop") {
        tx = await pool.hopStakeToAnotherPool(shares, miner.stakeId, hopPool);
      } else if (modal.kind === "transfer") {
        tx = await pool.transferStakeToAnotherWallet(
          shares,
          miner.stakeId,
          recipient.trim(),
        );
      } else if (amtMode === "full") {
        tx = await pool.withdrawAll(miner.stakeId);
      } else {
        const partShares = sharesFor(miner);
        if (partShares === null) {
          setModalStatus("Invalid custom amount.");
          setModalBusy(false);
          return;
        }
        tx = await pool.withdraw(partShares, miner.stakeId);
      }
      setModalStatus("Transaction submitted, waiting for confirmation…");
      await tx.wait();
      closeModal();
      void loadStakedMiners();
    } catch (e) {
      const err = e as { reason?: string; shortMessage?: string; message?: string };
      setModalStatus(
        "Error: " +
          (err.reason || err.shortMessage || err.message || "Transaction failed"),
      );
      setModalBusy(false);
    }
  }

  // ── Render helpers ─────────────────────────────────────────────────────────
  const sortedMiners = miners
    .slice()
    .sort((a, b) => (a.poolDur || a.total) - (b.poolDur || b.total));
  const penalty = (m: Miner) =>
    m.done ? "0%" : (100 - m.pct).toFixed(1) + "%";
  const liveAmount = (m: Miner) =>
    m.dailyReward > 0
      ? m.amount + m.dailyReward * ((Date.now() - m.ts) / 86400000)
      : m.amount;

  const summaryUsd = (n: number, price: number | null) => {
    if (!price) return null;
    const usd = n * price;
    return usd < 0.01
      ? "<$0.01"
      : "$" +
          usd.toLocaleString("en-US", {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2,
          });
  };

  const summaryCol = (label: string, n: number, price: number | null) => (
    <div className="miners-summary-col">
      <div className="miners-summary-col-label">{label}:</div>
      <div className="miners-summary-col-val">
        {fmtFullReward(n)} DEGEN{" "}
        {summaryUsd(n, price) && (
          <span className="miners-summary-usd">({summaryUsd(n, price)})</span>
        )}
      </div>
    </div>
  );

  const minersCount =
    pendingPools > 0
      ? `${sortedMiners.length} miner${sortedMiners.length === 1 ? "" : "s"}…`
      : `${sortedMiners.length} miner${sortedMiners.length === 1 ? "" : "s"}`;

  const gridBody = !wallet.address ? (
    <div className="rw-miners-loading">
      Connect your wallet to view staked miners
    </div>
  ) : !loaded && sortedMiners.length === 0 ? (
    <div className="rw-miners-loading">Loading miners…</div>
  ) : sortedMiners.length === 0 ? (
    <div className="rw-miners-loading">No staked miners found.</div>
  ) : viewMode === "list" ? (
    <table
      className="rw-miners-list"
      style={{ "--mc": "var(--red)" } as React.CSSProperties}
    >
      <thead>
        <tr>
          <th>Duration</th>
          <th>Amount</th>
          <th>Time Served</th>
          <th>Days</th>
          <th>Early Exit Penalty</th>
        </tr>
      </thead>
      <tbody>
        {sortedMiners.map((m) => {
          const dur = durLabel(m.poolDur || m.total);
          const servedDays = Math.floor(m.served / 86400);
          const totalDays = Math.floor((m.poolDur || m.total) / 86400);
          return (
            <tr key={minerPid(m)}>
              <td className="rw-list-dur">{dur}</td>
              <td className="rw-list-amount">{fmtFullReward(liveAmount(m))}</td>
              <td>
                <div className="rw-list-bar-track">
                  <div
                    className="rw-list-bar-fill"
                    style={{ width: `${Math.min(m.pct, 100)}%` }}
                  />
                </div>
                <div className="rw-list-pct">
                  {m.pct.toFixed(1)}%
                  {m.done && (
                    <>
                      {" "}
                      &nbsp;<span className="rw-list-ready">Ready</span>
                    </>
                  )}
                </div>
              </td>
              <td className="rw-list-days">
                {servedDays.toLocaleString()} / {totalDays.toLocaleString()}
              </td>
              <td className={`rw-list-penalty${m.done ? " done" : ""}`}>
                {penalty(m)}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  ) : (
    <div className="rw-miners-grid">
      {sortedMiners.map((m) => {
        const dur = durLabel(m.poolDur || m.total);
        const servedDays = Math.floor(m.served / 86400);
        const totalDays = Math.floor((m.poolDur || m.total) / 86400);
        const pid = minerPid(m);
        return (
          <div
            key={pid}
            className={`mc-card${m.done ? " mc-ready" : ""}`}
            style={{ "--mc": "var(--red)" } as React.CSSProperties}
          >
            <div className="mc-card-toprow">
              <span className="mc-card-dur">{dur} Lock</span>
              <span className="mc-card-num">#{m.stakeId}</span>
            </div>
            <div className={`mc-card-amount${m.done ? " mc-ready" : ""}`}>
              {fmtFullReward(liveAmount(m))}
            </div>
            <div className="mc-card-token-name">DEGEN</div>
            <div className="mc-card-progress">
              <div className="mc-card-prog-label">
                <span>Progress ({dur} Miner)</span>
                <span>{(m.progressPct ?? m.pct).toFixed(1)}%</span>
              </div>
              <div className="mc-card-bar-track">
                <div
                  className="mc-card-bar-fill"
                  style={{ width: `${Math.min(m.progressPct ?? m.pct, 100)}%` }}
                />
              </div>
              <div className="mc-card-days">
                <span>
                  {servedDays.toLocaleString()} / {totalDays.toLocaleString()}{" "}
                  days
                </span>
              </div>
            </div>
            <div className="mc-card-progress">
              <div className="mc-card-prog-label">
                <span>Mandatory Serve</span>
                <span>{m.pct.toFixed(1)}%</span>
              </div>
              <div className="mc-card-bar-track">
                <div
                  className="mc-card-bar-fill"
                  style={{ width: `${Math.min(m.pct, 100)}%` }}
                />
              </div>
              <div className="mc-card-days">
                <span>
                  {servedDays.toLocaleString()} /{" "}
                  {Math.floor(m.total / 86400).toLocaleString()} days
                </span>
                {m.done && <span className="mc-ready-pill">Ready</span>}
              </div>
            </div>
            <div className="mc-card-footer">
              <span className="mc-penalty-label">Early Exit Penalty</span>
              <span className={`mc-penalty-val${m.done ? " done" : ""}`}>
                {penalty(m)}
              </span>
            </div>
            <div className="mc-actions-wrap">
              <button
                className="mc-actions-btn"
                onClick={(event) => {
                  event.stopPropagation();
                  setOpenMenu(openMenu === pid ? null : pid);
                }}
              >
                Actions ▼
              </button>
              <div
                className={`mc-actions-menu${openMenu === pid ? "" : " hidden"}`}
              >
                <button onClick={() => openMinerModal("hop", m)}>
                  Upgrade Miner
                </button>
                <button onClick={() => openMinerModal("transfer", m)}>
                  Transfer Miner To Another Wallet
                </button>
                <button onClick={() => openMinerModal("withdraw", m)}>
                  End Miner (Withdraw)
                </button>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );

  const modalBoxStyle: React.CSSProperties = {
    maxWidth: 480,
    textAlign: "center",
    fontFamily: "'Segoe UI',Arial,sans-serif",
  };
  const modalIconStyle = (color: string): React.CSSProperties => ({
    width: 66,
    height: 66,
    borderRadius: "50%",
    border: `2.5px solid ${color}`,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    margin: "0 auto 18px",
    fontSize: "1.7rem",
    color,
    fontWeight: 700,
    lineHeight: 1,
  });
  const modalHeadStyle: React.CSSProperties = {
    fontWeight: 700,
    fontSize: "0.95rem",
    marginBottom: 10,
    textAlign: "center",
  };
  const confirmBtnStyle: React.CSSProperties = {
    background: "linear-gradient(135deg,#1565C0,#1976D2)",
    borderColor: "#1976D2",
    textTransform: "none",
    fontFamily: "'Segoe UI',Arial,sans-serif",
    fontSize: "0.9rem",
  };
  const cancelBtnStyle: React.CSSProperties = {
    background: "#c62828",
    borderColor: "#c62828",
    color: "#fff",
    opacity: 1,
    textTransform: "none",
    fontFamily: "'Segoe UI',Arial,sans-serif",
    fontSize: "0.9rem",
  };
  const statusStyle: React.CSSProperties = {
    minHeight: 18,
    fontSize: "0.65rem",
    textAlign: "center",
    marginTop: 10,
    opacity: 0.6,
  };

  const amtOptions = (miner: Miner, verb: "Transfer" | "Withdraw") => (
    <select
      className="modal-select"
      style={{ marginBottom: 8, textAlign: "left" }}
      value={amtMode}
      onChange={(event) => setAmtMode(event.target.value as "full" | "partial")}
    >
      {verb === "Withdraw" ? (
        <>
          <option value="full">
            Withdraw All ({fmtMinerWhole(miner.amount)} DEGEN)
          </option>
          <option value="partial">Withdraw Partially (Custom Amount)</option>
        </>
      ) : (
        <>
          <option value="full">
            Transfer Full Miner ({fmtMinerAmt(miner.amount)} DEGEN)
          </option>
          <option value="partial">Transfer Partial (Custom Amount)</option>
        </>
      )}
    </select>
  );

  const customAmtInput = amtMode === "partial" && (
    <div style={{ marginBottom: 8 }}>
      <input
        className="modal-input"
        type="number"
        min="0"
        placeholder="Custom amount"
        value={customAmt}
        onChange={(event) => setCustomAmt(event.target.value)}
      />
    </div>
  );

  return (
    <main className="legacy-main">
      <div className="miners-summary" id="minersSummary">
        {summary.state === "connect" ? (
          <div className="miners-summary-loading">
            Connect your wallet to view balances
          </div>
        ) : summary.state === "loading" ? (
          <div className="miners-summary-loading">
            <span className="spinner" />
            Loading balances…
          </div>
        ) : summary.state === "error" ? (
          <div className="miners-summary-loading">Could not load balances</div>
        ) : (
          <div className="miners-summary-row">
            {summaryCol("Wallet Balance", summary.wallet, summary.price)}
            {summaryCol("Total Miners", summary.staked, summary.price)}
            {summaryCol(
              "Total Balance",
              summary.wallet + summary.staked,
              summary.price,
            )}
          </div>
        )}
      </div>
      <div className="rw-miners-section">
        <div className="rw-miners-header">
          <div>
            <span className="rw-miners-title">
              Miners <span className="farms-count">{wallet.address ? minersCount : ""}</span>
            </span>
            <span className="rw-miners-sub">
              Time-locked positions from auto-harvest — sorted by % progress
            </span>
          </div>
          <div className="rw-view-toggle">
            <button
              className={`rw-view-btn${viewMode === "grid" ? " active" : ""}`}
              title="Grid view"
              onClick={() => setViewMode("grid")}
            >
              <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor">
                <rect x="0" y="0" width="6" height="6" rx="1" />
                <rect x="8" y="0" width="6" height="6" rx="1" />
                <rect x="0" y="8" width="6" height="6" rx="1" />
                <rect x="8" y="8" width="6" height="6" rx="1" />
              </svg>
            </button>
            <button
              className={`rw-view-btn${viewMode === "list" ? " active" : ""}`}
              title="List view"
              onClick={() => setViewMode("list")}
            >
              <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor">
                <rect x="0" y="1" width="14" height="2" rx="1" />
                <rect x="0" y="6" width="14" height="2" rx="1" />
                <rect x="0" y="11" width="14" height="2" rx="1" />
              </svg>
            </button>
          </div>
        </div>
        <div className="miner-token-tabs miner-token-tabs-hidden">
          <button className="miner-token-tab active" data-token="degen">
            DEGEN
          </button>
        </div>
        <div id="rwMinersGrid">{gridBody}</div>
      </div>

      {/* ── Hop Miner Modal ── */}
      {modal?.kind === "hop" && (
        <div className="modal-overlay">
          <div className="modal-box" style={modalBoxStyle}>
            <div
              style={{
                ...modalIconStyle("#4fc3f7"),
                fontStyle: "italic",
              }}
            >
              i
            </div>
            <div
              className="modal-title"
              style={{
                textTransform: "none",
                fontSize: "1.35rem",
                marginBottom: 14,
              }}
            >
              Hop Miner to Another Pool
            </div>
            <p
              style={{
                fontSize: "0.8rem",
                opacity: 0.7,
                lineHeight: 1.7,
                margin: "0 0 22px",
                textAlign: "center",
              }}
            >
              You can always transfer your miner into a pool with longer-lockup
              period and get rewarded with higher APYs and more voting power.
              <br />
              Your time served, as well as principal and earned interest will
              be transferred into another miner option.
            </p>
            <div style={modalHeadStyle}>Select Miner Duration</div>
            <select
              className="modal-select"
              style={{ marginBottom: 20, textAlign: "left" }}
              value={hopPool}
              onChange={(event) => setHopPool(event.target.value)}
            >
              {HOP_POOLS.filter((p) => p.dur > modal.miner.poolDur).map((p) => (
                <option key={p.addr} value={p.addr}>
                  {p.label}
                </option>
              ))}
            </select>
            <div style={modalHeadStyle}>Amount to transfer</div>
            {amtOptions(modal.miner, "Transfer")}
            {customAmtInput}
            <div className="modal-btn-row" style={{ marginTop: 22 }}>
              <button
                className="modal-btn-confirm"
                style={confirmBtnStyle}
                disabled={modalBusy}
                onClick={() => void execModalAction()}
              >
                Hop Pools!
              </button>
              <button
                className="modal-btn-cancel"
                style={cancelBtnStyle}
                onClick={closeModal}
              >
                Cancel
              </button>
            </div>
            <div style={statusStyle}>{modalStatus}</div>
          </div>
        </div>
      )}

      {/* ── End Miner (Withdraw) Modal ── */}
      {modal?.kind === "withdraw" && (
        <div className="modal-overlay">
          <div className="modal-box" style={modalBoxStyle}>
            <div style={{ ...modalIconStyle("var(--red)"), fontWeight: 900 }}>
              !
            </div>
            <div
              className="modal-title"
              style={{
                textTransform: "none",
                fontSize: "1.35rem",
                marginBottom: 14,
              }}
            >
              Withdrawing Stake
            </div>
            <p
              style={{
                fontSize: "0.8rem",
                opacity: 0.7,
                lineHeight: 1.7,
                margin: "0 0 22px",
                textAlign: "center",
              }}
            >
              {modal.miner.withdrawReady ? (
                "Your miner has matured and can be withdrawn. Please choose your withdrawal option."
              ) : (
                <>
                  💀💀💀<strong>WARNING:</strong> 💀💀💀
                  <br />
                  The miner either hasn&apos;t matured or is already past grace
                  period. You are attempting to perform an emergency
                  withdrawal. Withdraw penalties will Apply. You have been
                  warned.
                </>
              )}
            </p>
            <div style={modalHeadStyle}>Amount to transfer</div>
            {amtOptions(modal.miner, "Withdraw")}
            {customAmtInput}
            <div className="modal-btn-row" style={{ marginTop: 22 }}>
              <button
                className="modal-btn-confirm"
                style={confirmBtnStyle}
                disabled={modalBusy}
                onClick={() => void execModalAction()}
              >
                Proceed
              </button>
              <button
                className="modal-btn-cancel"
                style={cancelBtnStyle}
                onClick={closeModal}
              >
                Cancel
              </button>
            </div>
            <div style={statusStyle}>{modalStatus}</div>
          </div>
        </div>
      )}

      {/* ── Transfer Miner Modal ── */}
      {modal?.kind === "transfer" && (
        <div className="modal-overlay">
          <div className="modal-box" style={modalBoxStyle}>
            <div style={{ ...modalIconStyle("#f5a623"), fontWeight: 900 }}>
              !
            </div>
            <div
              className="modal-title"
              style={{
                textTransform: "none",
                fontSize: "1.35rem",
                marginBottom: 14,
              }}
            >
              Transfer Miner To Another Wallet
            </div>
            <p
              style={{
                fontSize: "0.8rem",
                opacity: 0.7,
                lineHeight: 1.7,
                margin: "0 0 22px",
                textAlign: "center",
              }}
            >
              💀💀💀 WARNING: 💀💀💀
              <br />
              <br />
              You will transfer your miner to another wallet. Please make sure
              you are transferring to the wallet you own and control (else
              somebody might be attempting to steal your tokens!)
            </p>
            <div style={modalHeadStyle}>Recipient Address:</div>
            <input
              className="modal-input"
              placeholder="0x..."
              style={{ marginBottom: 20, textAlign: "left" }}
              value={recipient}
              onChange={(event) => setRecipient(event.target.value)}
            />
            <div style={modalHeadStyle}>Amount to transfer</div>
            {amtOptions(modal.miner, "Transfer")}
            {customAmtInput}
            <div className="modal-btn-row" style={{ marginTop: 22 }}>
              <button
                className="modal-btn-confirm"
                style={confirmBtnStyle}
                disabled={modalBusy}
                onClick={() => void execModalAction()}
              >
                Proceed!
              </button>
              <button
                className="modal-btn-cancel"
                style={cancelBtnStyle}
                onClick={closeModal}
              >
                Cancel
              </button>
            </div>
            <div style={statusStyle}>{modalStatus}</div>
          </div>
        </div>
      )}
    </main>
  );
}
