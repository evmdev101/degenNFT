import { HelpTip } from "../components/HelpTip";
import { filterMiners, graceEndingSoon, minerDurationLabel, minerStatus, type MinerFilters } from "./minerFilters";
import { confirmTransaction } from "../lib/transactions";
// OINK-style portfolio layout with DEGEN's existing miner transaction paths.
import { Contract, ZeroAddress, formatEther, isAddress, parseEther } from "ethers";
import { useCallback, useEffect, useRef, useState } from "react";
import { usePageActive } from "../hooks/usePageActive";
import "./miner-forms.css";
import { CONTRACTS, ERC20_ABI } from "../config/contracts";
import type { WalletState } from "../hooks/useWallet";
import { getPublicProvider, readableError } from "../lib/chain";

// ── Constants from the original script ──────────────────────────────────────
const MASTERCHEF_ABI = [
  "function getNrOfStakes(address _user) view returns (uint256)",
  "function userInfo(address _address, uint256 _stakeID) view returns (uint256 shares, uint256 lastMineredTime, uint256 xvmcAtLastUserAction, uint256 lastUserActionTime, uint256 mandatoryTimeToServe)",
  "function getPricePerFullShare() view returns (uint256)",
  "function totalShares() view returns (uint256)",
  "function gracePeriod() view returns (uint256)",
  "function withdrawFeePeriod() view returns (uint256)",
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
    maximumFractionDigits: 6,
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
  amountRaw: bigint;
  fingerprint: string;
  poolDur: number;
  startedAt: number;
  gracePeriod: number | null;
  timingKnown: boolean;
  ts: number; // fetch timestamp for the live counter
};

type MinerModal =
  | { kind: "hop"; miner: Miner }
  | { kind: "withdraw"; miner: Miner }
  | { kind: "transfer"; miner: Miner }
  | null;

const minerPid = (m: Miner) => `mc-${m.poolAddr.slice(2, 8)}-${m.stakeId}`;
const DEGEN_LOGO = "https://raw.githubusercontent.com/degenstrategy/interface/main/img/degen.png";
const displayMinerAmount = (value: number) => value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 3 });
const minerDate = (timestamp: number | null) => timestamp === null || !Number.isFinite(timestamp) || !Number.isFinite(new Date(timestamp * 1000).getTime()) ? "Unavailable" : (
  <time dateTime={new Date(timestamp * 1000).toISOString()}>
    {new Date(timestamp * 1000).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" })}
    <small>{new Date(timestamp * 1000).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}</small>
  </time>
);

type MinerSummary =
  | { state: "connect" }
  | { state: "loading" }
  | { state: "error" }
  | { state: "ready"; wallet: number; staked: number | null; price: number | null };
const minerSnapshots = new Map<string, { miners: Miner[]; summary: MinerSummary; failedPools: number }>();

// ── Component ────────────────────────────────────────────────────────────────
export function MyMinersPage({ wallet }: { wallet: WalletState }) {
  const cached = minerSnapshots.get(wallet.address?.toLowerCase() ?? "");
  const [miners, setMiners] = useState<Miner[]>(cached?.miners ?? []);
  const [pendingPools, setPendingPools] = useState(0);
  const [failedPools, setFailedPools] = useState(cached?.failedPools ?? 0);
  const [loaded, setLoaded] = useState(Boolean(cached));
  const [viewMode, setViewMode] = useState<"grid" | "list">("grid");
  const [openMenu, setOpenMenu] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [duration, setDuration] = useState("all");
  const [statusFilter, setStatusFilter] = useState<MinerFilters["status"] | "grace-soon">("all");
  const [sort, setSort] = useState<MinerFilters["sort"]>("progress-desc");
  const clearFilters = () => { setSearch(""); setDuration("all"); setStatusFilter("all"); setSort("progress-desc"); };
  const [summary, setSummary] = useState<MinerSummary>(cached?.summary ?? {
    state: wallet.address ? "loading" : "connect",
  });

  const [modal, setModal] = useState<MinerModal>(null);
  const [hopPool, setHopPool] = useState("");
  const [amtMode, setAmtMode] = useState<"full" | "partial">("full");
  const [customAmt, setCustomAmt] = useState("");
  const [recipient, setRecipient] = useState("");
  const [modalStatus, setModalStatus] = useState("");
  const [modalBusy, setModalBusy] = useState(false);
  const loadSeq = useRef(0);
  const submitting = useRef(false);
  const pageActive = usePageActive();

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
      setFailedPools(0);
      setSummary({ state: "connect" });
      return;
    }
    const address = wallet.address;
    const snapshot = minerSnapshots.get(address.toLowerCase());
    setMiners(snapshot?.miners ?? []);
    setLoaded(Boolean(snapshot));
    setPendingPools(DEGEN_POOL_ADDRS.length);
    setSummary(snapshot?.summary ?? { state: "loading" });

    const provider = await getPublicProvider();
    const collected: Miner[] = [];
    const failed = new Set<string>();

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

        let gracePeriod: number | null = null;
        let contractDuration: number | null = null;
        try {
          const [grace, duration] = await withTimeout(Promise.all([pool.gracePeriod(), pool.withdrawFeePeriod()]), 8000);
          gracePeriod = Number(grace); contractDuration = Number(duration);
        }
        catch { /* Unknown grace rules must not be displayed as a zero fee. */ }

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
          if (!info) {
            failed.add(poolAddr);
            const previous = snapshot?.miners.find(miner => miner.poolAddr.toLowerCase() === poolAddr.toLowerCase() && miner.stakeId === i);
            if (previous) result.push(previous);
            continue;
          }
          const amountRaw = (info.shares * pricePerShare) / 1_000_000_000_000_000_000n;
          const amount = Number(formatEther(amountRaw));
          if (info.shares <= 0n) continue;
          const served = Math.max(0, now - Number(info.lastMineredTime));
          const total = Number(info.mandatoryTimeToServe);
          const pct = total > 0 ? Math.min(100, (served / total) * 100) : 100;
          const poolDur =
            contractDuration ?? POOL_DURATIONS[poolAddr.toLowerCase()] ?? 2592000;
          const progressPct =
            poolDur > 0 ? Math.min(100, (served / poolDur) * 100) : pct;
          const withdrawReady =
            contractDuration !== null && gracePeriod !== null && served >= poolDur && served <= poolDur + gracePeriod;
          const dailyReward = 0;
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
            amountRaw,
            fingerprint: [info.shares, info.lastMineredTime, info.xvmcAtLastUserAction, info.lastUserActionTime, info.mandatoryTimeToServe].join(":"),
            poolDur,
            startedAt: Number(info.lastMineredTime),
            gracePeriod,
            timingKnown: contractDuration !== null && gracePeriod !== null,
            ts: Date.now(),
          });
        }
      } catch (e) {
        console.warn("fetchPoolMiners", poolAddr, (e as Error).message);
        failed.add(poolAddr);
        return snapshot?.miners.filter(miner => miner.poolAddr.toLowerCase() === poolAddr.toLowerCase()) ?? [];
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
        } catch { failed.add(poolAddr); }
        if (loadSeq.current !== seq) return;
        if (!snapshot) setMiners([...collected]);
        setPendingPools((p) => Math.max(0, p - 1));
      }
    }
    await Promise.all(Array.from({ length: 3 }, poolWorker));
    if (loadSeq.current !== seq) return;
    setMiners([...collected]);
    setFailedPools(failed.size);
    setLoaded(true);

    // Populate the summary bar
    try {
      const degenTok = new Contract(CONTRACTS.degen, ERC20_ABI, provider);
      const [walletRaw, price] = await Promise.all([
        degenTok.balanceOf(address),
        fetchDegenPrice(),
      ]);
      if (loadSeq.current !== seq) return;
      const nextSummary: MinerSummary = {
        state: "ready",
        wallet: parseFloat(formatEther(walletRaw)),
        staked: failed.size > 0
          ? snapshot?.summary.state === "ready" ? snapshot.summary.staked : null
          : collected.reduce((s, m) => s + m.amount, 0),
        price,
      };
      setSummary(nextSummary);
      if (minerSnapshots.size >= 8) minerSnapshots.delete(minerSnapshots.keys().next().value!);
      minerSnapshots.set(address.toLowerCase(), { miners: [...collected], summary: nextSummary, failedPools: failed.size });
    } catch (e) {
      console.warn("summary bar:", (e as Error).message);
      if (loadSeq.current === seq && !snapshot) setSummary({ state: "error" });
    }
  }, [wallet.address]);

  useEffect(() => {
    if (!pageActive) return;
    let disposed = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      if (disposed) return;
      try { if (!document.hidden) await loadStakedMiners(); }
      catch {
        if (!disposed) {
          setFailedPools(DEGEN_POOL_ADDRS.length);
          setPendingPools(0); setLoaded(true);
          setSummary(previous => previous.state === "ready" ? previous : { state: "error" });
        }
      }
      finally { if (!disposed) timer = setTimeout(() => void poll(), 60_000); }
    };
    void poll();
    return () => { disposed = true; clearTimeout(timer); loadSeq.current += 1; };
  }, [loadStakedMiners, pageActive]);

  // ── Modal actions (hop / withdraw / transfer) ──────────────────────────────
  function openMinerModal(kind: "hop" | "withdraw" | "transfer", miner: Miner) {
    if (submitting.current) return;
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
    if (!submitting.current) setModal(null);
  }

  function sharesFor(miner: Miner, currentShares = miner.shares, currentAmount = miner.amountRaw): bigint | null {
    if (amtMode === "full") return currentShares;
    try {
      const requested = parseEther(customAmt.trim());
      if (requested <= 0n || requested > currentAmount || currentAmount <= 0n) return null;
      const shares = currentShares * requested / currentAmount;
      return shares > 0n ? shares : null;
    } catch { return null; }
  }

  async function execModalAction() {
    if (!modal || submitting.current) return;
    const miner = modal.miner;
    submitting.current = true; setModalBusy(true); setModalStatus("");
    try {
      const target = recipient.trim();
      if (modal.kind === "transfer" && (!isAddress(target) || target === ZeroAddress)) throw new Error("Enter a valid recipient address.");
      if (!DEGEN_POOL_ADDRS.some(address => address.toLowerCase() === miner.poolAddr.toLowerCase())) throw new Error("Unsupported miner contract.");
      if (modal.kind === "hop" && !HOP_POOLS.some(pool => pool.addr === hopPool && pool.dur > miner.poolDur)) throw new Error("Choose a longer supported pool.");
      const signer = await wallet.getSigner();
      const account = await signer.getAddress();
      const pool = new Contract(miner.poolAddr, [...POOL_ACTION_ABI, ...MASTERCHEF_ABI], signer);
      const [count, current, price] = await Promise.all([pool.getNrOfStakes(account), pool.userInfo(account, miner.stakeId), pool.getPricePerFullShare()]);
      const fingerprint = [current.shares, current.lastMineredTime, current.xvmcAtLastUserAction, current.lastUserActionTime, current.mandatoryTimeToServe].join(":");
      if (BigInt(miner.stakeId) >= count || fingerprint !== miner.fingerprint) {
        void loadStakedMiners();
        throw new Error("This miner changed. Close this panel and select its current position.");
      }
      const amountRaw = BigInt(current.shares) * BigInt(price) / 10n ** 18n;
      const shares = sharesFor(miner, current.shares, amountRaw);
      if (shares === null) throw new Error("Enter an amount up to the current miner balance.");
      let method, args: unknown[];
      if (modal.kind === "hop") { method = pool.hopStakeToAnotherPool; args = [shares, miner.stakeId, hopPool]; }
      else if (modal.kind === "transfer") { method = pool.transferStakeToAnotherWallet; args = [shares, miner.stakeId, target]; }
      else if (amtMode === "full") { method = pool.withdrawAll; args = [miner.stakeId]; }
      else { method = pool.withdraw; args = [shares, miner.stakeId]; }
      await method.staticCall(...args);
      await confirmTransaction(await method(...args));
      setModal(null);
      await loadStakedMiners().catch(() => undefined);
    } catch (error) { setModalStatus(readableError(error)); }
    finally { submitting.current = false; setModalBusy(false); }
  }

  // ── Render helpers ─────────────────────────────────────────────────────────
  const filteredMiners = filterMiners(miners, { search, duration, status: statusFilter === "grace-soon" ? "mature" : statusFilter, sort });
  const sortedMiners = statusFilter === "grace-soon" ? filteredMiners.filter(graceEndingSoon) : filteredMiners;
  const durationMiners = miners.filter(m => duration === "all" || m.poolAddr.toLowerCase() === duration.toLowerCase());
  const countsKnown = loaded && pendingPools === 0 && failedPools === 0;
  const statusCount = (status: string) => !countsKnown ? "—" : durationMiners.filter(m => status === "all" || (status === "grace-soon" ? graceEndingSoon(m) : minerStatus(m) === status)).length;
  const penalty = (m: Miner) => !m.done ? "Service required" : m.withdrawReady ? "Maturity window" : "Fees may apply";
  // Share value is a confirmed snapshot. Emission estimates cannot authorize a
  // continuously accruing balance, especially after pool/governance changes.
  const liveAmount = (m: Miner) => m.amount;

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

  const summaryCol = (label: string, n: number | null, price: number | null) => (
    <div className="miners-summary-col">
      <div className="miners-summary-col-label">{label}:</div>
      <div className="miners-summary-col-val">
        <strong>{n === null ? "—" : displayMinerAmount(n)}</strong>{n !== null && <span className="miner-summary-token"><img src={DEGEN_LOGO} alt="" />DEGEN</span>}
        {n !== null && summaryUsd(n, price) && (
          <span className="miners-summary-usd">({summaryUsd(n, price)})</span>
        )}
      </div>
    </div>
  );

  const minersCount =
    `${sortedMiners.length !== miners.length ? sortedMiners.length + " of " : ""}${miners.length} ${failedPools > 0 ? "known " : ""}miner${miners.length === 1 ? "" : "s"}${pendingPools > 0 ? "…" : ""}`;

  const gridBody = !wallet.address ? (
    <div className="rw-miners-loading">
      Connect your wallet to view staked miners
    </div>
  ) : !loaded && miners.length === 0 ? (
    <div className="rw-miners-loading">Loading miners…</div>
  ) : miners.length === 0 ? (
    <div className="rw-miners-loading">{failedPools > 0 ? "Miner positions temporarily unavailable." : "No staked miners found."}</div>
  ) : sortedMiners.length === 0 ? (
    <div className="miners-empty" role="status"><h2>No matching miners</h2><p>Try a different search, duration, or status.</p><button type="button" onClick={clearFilters}>Show all miners</button></div>
  ) : viewMode === "list" ? (
    <div className="miner-table-scroll" role="region" aria-label="Miner list" tabIndex={0}>
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
          <th>Withdrawal Terms</th>
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
                      &nbsp;<span className="rw-list-ready">Service complete</span>
                    </>
                  )}
                </div>
              </td>
              <td className="rw-list-days">
                {servedDays.toLocaleString()} / {totalDays.toLocaleString()}
              </td>
              <td className={`rw-list-penalty${m.withdrawReady ? " done" : ""}`}>
                {penalty(m)}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
    </div>
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
            className={`mc-card${m.withdrawReady ? " mc-ready" : ""}`}
            style={{ "--mc": "var(--red)" } as React.CSSProperties}
          >
            <div className="mc-card-toprow">
              <span className="mc-card-dur">{minerDurationLabel(m.poolDur || m.total)}</span>
              <span className="mc-card-num">#{m.stakeId}</span>
            </div>
            <div className="mc-card-hero">
              <div className={`mc-card-amount${displayMinerAmount(liveAmount(m)).length > 12 ? " mc-card-amount-long" : ""}`}>{displayMinerAmount(liveAmount(m))}</div>
              <div className="mc-card-token-name"><img src={DEGEN_LOGO} alt="" /> DEGEN <HelpTip label="miner value">Current pool shares × price per share. This includes the position’s accrued value; it is separate from liquid DEGEN in your wallet and may be reduced by withdrawal fees.</HelpTip></div>
            </div>
            <div className="mc-card-progress">
              <div className="mc-card-prog-label">
                <span>Lock progress</span>
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
                <span>Mandatory service</span>
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
                  {m.total === 0 ? "No minimum service" : `${servedDays.toLocaleString()} / ${Math.floor(m.total / 86400).toLocaleString()} days`}
                </span>
                {m.done && <span className="mc-ready-pill">Service complete</span>}
              </div>
            </div>
            <dl className="miner-dates">
              <div><dt>{m.served >= m.poolDur ? "Matured" : "Matures"}</dt><dd>{minerDate(m.timingKnown ? m.startedAt + m.poolDur : null)}</dd></div>
              <div><dt>{minerStatus(m) === "overdue" ? "Grace ended" : "Grace ends"}</dt><dd>{minerDate(m.timingKnown && m.gracePeriod !== null ? m.startedAt + m.poolDur + m.gracePeriod : null)}</dd></div>
            </dl>
            <div className="mc-actions-wrap" onKeyDown={event => {
              if (event.key === "Escape") {
                setOpenMenu(null);
                event.currentTarget.querySelector<HTMLButtonElement>(".mc-actions-btn")?.focus();
              }
            }}>
              <button
                type="button"
                className="mc-actions-btn"
                aria-expanded={openMenu === pid}
                aria-controls={`${pid}-actions`}
                onClick={(event) => {
                  event.stopPropagation();
                  setOpenMenu(openMenu === pid ? null : pid);
                }}
              >
                <span>Actions</span><span aria-hidden="true">{openMenu === pid ? "−" : "+"}</span>
              </button>
              <div
                id={`${pid}-actions`}
                className="mc-actions-menu"
                role="group"
                aria-label={`Actions for ${dur} miner #${m.stakeId}`}
                hidden={openMenu !== pid}
              >
                <button type="button" aria-label="Upgrade Miner" onClick={() => openMinerModal("hop", m)}>
                  <strong>Upgrade miner</strong><span>Move to a longer lock duration</span>
                </button>
                <button type="button" aria-label="Transfer Miner To Another Wallet" onClick={() => openMinerModal("transfer", m)}>
                  <strong>Transfer miner</strong><span>Send this position to another wallet</span>
                </button>
                <button type="button" aria-label="End Miner (Withdraw)" onClick={() => openMinerModal("withdraw", m)}>
                  <strong>Withdraw</strong><span>End all or part of this miner</span>
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
    <main className="legacy-main degen-miner-portfolio">
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
            {summaryCol("Miner value", summary.staked, summary.price)}
            {summaryCol(
              "Wallet + miner value",
              summary.staked === null ? null : summary.wallet + summary.staked,
              summary.price,
            )}
          </div>
        )}
      </div>
      <div className="rw-miners-section">
        <div className="rw-miners-header">
          <div>
            <h1 className="rw-miners-title">Miners <small className="farms-count" aria-live="polite">{wallet.address ? minersCount : ""}</small></h1>
            <span className="rw-miners-sub">
              Time-locked DEGEN positions
            </span>
          </div>
          <div className="rw-view-toggle">
            <button
              className={`rw-view-btn${viewMode === "grid" ? " active" : ""}`}
              aria-label="Grid view"
              aria-pressed={viewMode === "grid"}
              onClick={() => setViewMode("grid")}
            >
              Grid
            </button>
            <button
              className={`rw-view-btn${viewMode === "list" ? " active" : ""}`}
              aria-label="List view"
              aria-pressed={viewMode === "list"}
              onClick={() => setViewMode("list")}
            >
              List
            </button>
          </div>
        </div>
        <div className="miners-toolbar" role="search" aria-label="Find miners">
          <label>Search miners<input type="search" placeholder="Duration, miner # or contract address" value={search} onChange={event => setSearch(event.target.value)} /></label>
          <label>Duration<select value={duration} onChange={event => setDuration(event.target.value)}>
            <option value="all">All durations ({loaded ? miners.length : "—"})</option>
            {HOP_POOLS.map(pool => <option key={pool.addr} value={pool.addr}>{minerDurationLabel(pool.dur)} ({loaded ? miners.filter(m => m.poolAddr.toLowerCase() === pool.addr.toLowerCase()).length : "—"})</option>)}
          </select></label>
          <label>Status<select value={statusFilter} onChange={event => setStatusFilter(event.target.value as typeof statusFilter)}>
            {([ ["all", "All statuses"], ["locked", "Not yet mature"], ["mature", "Mature"], ["grace-soon", "Grace ending in 48h"], ["overdue", "Overdue"], ["unknown", "Timing unavailable"] ] as const).map(([value, label]) => <option key={value} value={value}>{label} ({statusCount(value)})</option>)}
          </select></label>
          <label>Sort by<select value={sort} onChange={event => setSort(event.target.value as MinerFilters["sort"])}>
            <option value="progress-desc">Lock progress</option><option value="value-desc">Highest value</option><option value="duration-asc">Shortest duration</option><option value="duration-desc">Longest duration</option>
          </select></label>
          <button type="button" onClick={clearFilters}>Clear filters</button>
        </div>
        <div className="miner-deadline-shortcuts" role="group" aria-label="Miner maturity filters">
          {([ ["mature", "Mature"], ["grace-soon", "Grace ending in 48h"], ["overdue", "Overdue"] ] as const).map(([value, label]) => <button key={value} type="button" disabled={!countsKnown} aria-pressed={statusFilter === value} onClick={() => { setSearch(""); setStatusFilter(statusFilter === value ? "all" : value); }}>{label}{" "}<strong>{statusCount(value)}</strong></button>)}
        </div>
        <div id="rwMinersGrid" role="region" aria-label="Owned miners">{gridBody}</div>
      </div>

      {/* ── Hop Miner Modal ── */}
      {modal?.kind === "hop" && (
        <div className="modal-overlay miner-action-overlay">
          <div className="modal-box" style={modalBoxStyle} role="dialog" aria-modal="false" aria-label="Upgrade miner">
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
            <div style={modalHeadStyle}>Amount of miner value</div>
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
        <div className="modal-overlay miner-action-overlay">
          <div className="modal-box" style={modalBoxStyle} role="dialog" aria-modal="false" aria-label="Withdraw miner">
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
                  Outside the maturity window, the contract deducts an early or late withdrawal fee. Mandatory service may prevent withdrawal. Current eligibility is checked before your wallet opens.
                </>
              )}
            </p>
            <div style={modalHeadStyle}>Amount of miner value</div>
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
        <div className="modal-overlay miner-action-overlay">
          <div className="modal-box" style={modalBoxStyle} role="dialog" aria-modal="false" aria-label="Transfer miner">
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
              The selected miner shares and their lock rules transfer to the recipient. Check the address carefully.
            </p>
            <div style={modalHeadStyle}>Recipient Address:</div>
            <input
              className="modal-input"
              placeholder="0x..."
              style={{ marginBottom: 20, textAlign: "left" }}
              value={recipient}
              onChange={(event) => setRecipient(event.target.value)}
            />
            <div style={modalHeadStyle}>Amount of miner value</div>
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
