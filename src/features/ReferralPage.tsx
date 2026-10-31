import { HelpTip } from "../components/HelpTip";
import { usePageActive } from "../hooks/usePageActive";
import { confirmTransaction } from "../lib/transactions";
// Referral tab — markup and styling restored verbatim from the original
// single-file site (commit 825e9f2). Logic mirrors loadReferralTab /
// claimReferralRewards / copyRefLink from the original inline script.
import { formatEther } from "ethers";
import { useCallback, useEffect, useRef, useState } from "react";
import type { WalletState } from "../hooks/useWallet";
import { getPublicProvider, readableError } from "../lib/chain";
import "./miner-forms.css";
import { readReferralContext, quoteReferralDestination, type ReferralQuote } from "./referralQuote";

const BASE58_CHARS =
  "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
function addrToBase58(addr: string) {
  let n = BigInt(addr);
  let out = "";
  while (n > 0n) {
    out = BASE58_CHARS[Number(n % 58n)] + out;
    n /= 58n;
  }
  return out;
}

// Same destination pools + payout labels as the original markup
const REF_DEST_POOLS = [
  { addr: "0xdE672FccA32365bD704c39bd1164a0D34a3a73e6", label: "10 Year" },
  { addr: "0x3d175C8359169b0e830d36EA9CD3FE209f46f7BD", label: "1 Year" },
  { addr: "0x7ED33f65A0398cb26eaB2B03877825c96D9B6077", label: "3 Month" },
  { addr: "0xd9b491ac0f5487673500b67224b67b4171a08aca", label: "1 Month" },
];

export function ReferralPage({ wallet }: { wallet: WalletState }) {
  const pageActive = usePageActive();
  const [quotes, setQuotes] = useState<Record<string, ReferralQuote>>({});
  const [bonusRate, setBonusRate] = useState<bigint | null>(null);
  const active = useRef(false);
  const sequence = useRef(0);
  const [bonusPct, setBonusPct] = useState<string | null>(null);
  const [totalWei, setTotalWei] = useState<bigint | null>(null);
  const [claimedWei, setClaimedWei] = useState<bigint | null>(null);
  const [selectedPool, setSelectedPool] = useState(REF_DEST_POOLS[0].addr);
  const [copied, setCopied] = useState(false);
  const [claimBusy, setClaimBusy] = useState(false);
  const [claimStatus, setClaimStatus] = useState<{
    kind: "pending" | "success" | "error";
    text: string;
  } | null>(null);

  const link = wallet.address
    ? `https://degen-pls.com/?r=${addrToBase58(wallet.address)}`
    : "";

  const availableWei = totalWei !== null && claimedWei !== null ? (totalWei > claimedWei ? totalWei - claimedWei : 0n) : null;
  const reward = (points: bigint | null) => points === null || bonusRate === null ? null : points * bonusRate / 10000n;
  const available = reward(availableWei);
  const destinations = [...REF_DEST_POOLS, { addr: "WALLET", label: "Wallet" }];

  const load = useCallback(async () => {
    const seq = ++sequence.current;
    try {
      const provider = await getPublicProvider();
      if (!wallet.address) return;
      const context = await readReferralContext(provider, wallet.address);
      if (seq !== sequence.current) return;
      setBonusRate(context.bonus); setBonusPct(Number(context.bonus) / 100 + "%");
      setTotalWei(context.total); setClaimedWei(context.claimed);
      const results = await Promise.allSettled([...REF_DEST_POOLS.map(pool => ({ key: pool.addr, into: pool.addr, wallet: false })), { key: "WALLET", into: wallet.address, wallet: true }].map(async option => [option.key, await quoteReferralDestination(context, option.into, option.wallet)] as const));
      if (seq === sequence.current) setQuotes(Object.fromEntries(results.flatMap(result => result.status === "fulfilled" ? [result.value] : [])));
    } catch { /* Keep last known values and retry without interrupting the form. */ }
  }, [wallet.address]);

  useEffect(() => {
    setTotalWei(null); setClaimedWei(null); setQuotes({}); setSelectedPool(REF_DEST_POOLS[0].addr); setClaimStatus(null);
  }, [wallet.address]);

  useEffect(() => {
    let disposed = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      if (disposed) return;
      if (pageActive && !document.hidden) await load();
      if (!disposed) timer = setTimeout(() => void poll(), 60_000);
    };
    void poll();
    return () => { disposed = true; sequence.current++; clearTimeout(timer); };
  }, [load, pageActive]);

  function copyRefLink() {
    if (!link) return;
    void navigator.clipboard.writeText(link).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }).catch(() => setClaimStatus({ kind: "error", text: "Copy unavailable. Select and copy the link." }));
  }

  async function claimReferralRewards() {
    if (active.current) return;
    active.current = true; setClaimBusy(true); setClaimStatus(null);
    try {
      if (!destinations.some(pool => pool.addr === selectedPool)) throw new Error("Choose a supported reward destination.");
      const signer = await wallet.getSigner();
      const account = await signer.getAddress();
      const context = await readReferralContext(signer, account);
      if (context.points <= 0n) throw new Error("No referral rewards are available.");
      const into = selectedPool === "WALLET" ? account : selectedPool;
      const fresh = await quoteReferralDestination(context, into, selectedPool === "WALLET");
      if (fresh.payout <= 0n) throw new Error("This claim would pay zero DEGEN.");
      if (fresh.payout < fresh.minimum) throw new Error(`This pool requires at least ${display(fresh.minimum)} DEGEN per claim.`);
      if (!fresh.funded) throw new Error("The referral reward contract has insufficient DEGEN for this payout.");
      if (!quotes[selectedPool] || quotes[selectedPool].fingerprint !== fresh.fingerprint) {
        setQuotes(previous => ({ ...previous, [selectedPool]: fresh }));
        throw new Error("Referral terms changed. Check the updated payout and choose Claim again.");
      }
      await context.rewards.redeemRewards.staticCall(context.points, into);
      await confirmTransaction(await context.rewards.redeemRewards(context.points, into));
      setClaimStatus({ kind: "success", text: "Referral rewards claimed." });
      await load();
    } catch (error) { setClaimStatus({ kind: "error", text: readableError(error) }); }
    finally { active.current = false; setClaimBusy(false); }
  }

  const selectedQuote = quotes[selectedPool];
  const claimDisabled = claimBusy || !wallet.address || available === null || available <= 0n || !selectedQuote || selectedQuote.payout <= 0n || selectedQuote.payout < selectedQuote.minimum || !selectedQuote.funded;
  const claimLabel = !wallet.address ? "Connect wallet to claim" : available === null ? "Rewards unavailable" : available > 0n ? "Claim referral rewards" : "No rewards available";
  const display = (amount: bigint | null) => amount === null ? "—" : Number(formatEther(amount)).toLocaleString(undefined, { maximumFractionDigits: 4 });

  return (
    <main className="legacy-main">
      <div className="ref-wrap">
        <div className="ref-card">
          <div className="ref-card-title">Earn Referral Bonuses</div>
          <p className="ref-card-desc">
            Share your referral link. When someone stakes using your link, both
            of you earn bonus DEGEN tokens — up to{" "}
            <strong>{bonusPct ?? "—"}</strong> bonus.
          </p>
          <p
            className="ref-card-desc"
            style={{ opacity: 0.5, fontSize: "0.75rem" }}
          >
            Bonuses are managed by governance and paid from inflation /
            treasury. Tokens must be sent by the DAO to the reward contract
            before they&apos;re redeemable.
          </p>

          <div className="ref-link-label">Your Referral Link</div>
          <div className="ref-link-row">
            <input
              className="ref-link-input"
              readOnly
              value={link}
              placeholder="Connect wallet to generate link"
            />
            <button
              className={`ref-link-copy${copied ? " copied" : ""}`}
              onClick={copyRefLink}
            >
              {copied ? "✓ Copied" : "Copy"}
            </button>
          </div>
        </div>

        <div className="ref-card">
          <div className="ref-card-title">Redeem Referral Rewards</div>
          <div className="ref-stats-row">
            <div className="ref-stat">
              <div className="ref-stat-label">Total Referral Points</div>
              <div className="ref-stat-val">
                {display(totalWei)}
              </div>
            </div>
            <div className="ref-stat">
              <div className="ref-stat-label">Redeemed Points</div>
              <div className="ref-stat-val">
                {display(claimedWei)}
              </div>
            </div>
            <div className="ref-stat">
              <div className="ref-stat-label">Gross Reward</div>
              <div className="ref-stat-val" style={{ color: "var(--red)" }}>
                {available === null ? "—" : `${display(available)} DEGEN`}
              </div>
            </div>
          </div>

          <div className="ref-dest-label">Redeem into</div>
          <div className="ref-dest-grid">
            {destinations.map((pool) => (
              <button
                key={pool.addr}
                className={`ref-dest-btn${selectedPool === pool.addr ? " active" : ""}`}
                disabled={claimBusy || !quotes[pool.addr]}
                onClick={() => setSelectedPool(pool.addr)}
              >
                {pool.label} <span className="ref-dest-pct">{quotes[pool.addr] ? `${Number(quotes[pool.addr].rate) / 100}% payout` : "Unavailable"}</span>
              </button>
            ))}
          </div>

          <div className="miner-payout-comparison" aria-label="Estimated referral payouts">
            {destinations.map(pool => {
              const quote = quotes[pool.addr];
              return <div key={pool.addr}>{pool.label}<strong>{quote ? display(quote.payout) : "—"} DEGEN</strong>
                <span>{quote ? `${100 - Number(quote.rate) / 100}% destination penalty` : "Unavailable"}</span>
                {quote && quote.minServe > 0n && <small> · {(Number(quote.minServe) / 86400).toLocaleString()} days mandatory service</small>}
                {quote && quote.minimum > 0n && <small> · Minimum {display(quote.minimum)} DEGEN</small>}
                {quote && !quote.funded && <small> · Insufficient reward funding</small>}
              </div>;
            })}
          </div>
          <p className="miner-form-estimate">Estimated payouts <HelpTip label="referral payouts">Unredeemed referral points × current referral bonus × current destination payout rate, rounded down at each step. Named pool claims create a time-locked miner with the mandatory service shown. Wallet claims send DEGEN directly to your connected account.</HelpTip></p>
          <button
            className="ref-claim-btn"
            disabled={claimDisabled}
            onClick={() => void claimReferralRewards()}
          >
            {claimLabel}
          </button>
          {claimStatus && (
            <div
              className={`ref-claim-status ${claimStatus.kind}`}
              style={{ display: "block" }}
            >
              {claimStatus.text}
            </div>
          )}
        </div>
      </div>
    </main>
  );
}
