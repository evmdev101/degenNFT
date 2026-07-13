// Referral tab — markup and styling restored verbatim from the original
// single-file site (commit 825e9f2). Logic mirrors loadReferralTab /
// claimReferralRewards / copyRefLink from the original inline script.
import { Contract, formatEther } from "ethers";
import { useCallback, useEffect, useState } from "react";
import { CONTRACTS, REFERRAL_ABI } from "../config/contracts";
import type { WalletState } from "../hooks/useWallet";
import { getPublicProvider, readableError } from "../lib/chain";

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
  { addr: "0xdE672FccA32365bD704c39bd1164a0D34a3a73e6", label: "10 Year", pct: "100%" },
  { addr: "0x3d175C8359169b0e830d36EA9CD3FE209f46f7BD", label: "1 Year", pct: "~90%" },
  { addr: "0x7ED33f65A0398cb26eaB2B03877825c96D9B6077", label: "3 Month", pct: "~95%" },
  { addr: "0xd9b491ac0f5487673500b67224b67b4171a08aca", label: "1 Month", pct: "~97%" },
];

const fmt = (n: number) =>
  n.toLocaleString(undefined, { maximumFractionDigits: 2 });

export function ReferralPage({ wallet }: { wallet: WalletState }) {
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

  const totalAmt = totalWei === null ? null : parseFloat(formatEther(totalWei));
  const claimedAmt =
    claimedWei === null ? null : parseFloat(formatEther(claimedWei));
  const available =
    totalAmt === null || claimedAmt === null
      ? null
      : Math.max(0, totalAmt - claimedAmt);
  const availableWei =
    totalWei !== null && claimedWei !== null && totalWei > claimedWei
      ? totalWei - claimedWei
      : 0n;

  const load = useCallback(async () => {
    try {
      const provider = await getPublicProvider();
      const refContract = new Contract(
        CONTRACTS.referral,
        REFERRAL_ABI,
        provider,
      );
      try {
        const bonus = await refContract.referralBonus();
        setBonusPct(Number(bonus) / 100 + "%");
      } catch (e) {
        console.warn("referralBonus failed:", e);
      }
      if (!wallet.address) return;
      const [total, claimed] = await Promise.all([
        refContract.totalUserRewards(wallet.address),
        refContract.amountRedeemed(wallet.address),
      ]);
      setTotalWei(total);
      setClaimedWei(claimed);
    } catch (e) {
      console.warn("referral rewards fetch failed:", e);
    }
  }, [wallet.address]);

  useEffect(() => {
    setTotalWei(null);
    setClaimedWei(null);
    void load();
  }, [load]);

  function copyRefLink() {
    if (!link) return;
    void navigator.clipboard.writeText(link).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }

  async function claimReferralRewards() {
    if (!availableWei || availableWei <= 0n) return;
    setClaimBusy(true);
    setClaimStatus({
      kind: "pending",
      text: "Waiting for wallet confirmation…",
    });
    try {
      const signer = await wallet.getSigner();
      const rc = new Contract(CONTRACTS.referral, REFERRAL_ABI, signer);
      const tx = await rc.redeemRewards(availableWei, selectedPool);
      setClaimStatus({ kind: "pending", text: "Transaction sent — confirming…" });
      await tx.wait();
      setClaimStatus({
        kind: "success",
        text: `Claimed! TX: ${tx.hash.slice(0, 10)}…`,
      });
      void load();
    } catch (e) {
      setClaimStatus({ kind: "error", text: readableError(e) });
    } finally {
      setClaimBusy(false);
    }
  }

  const claimDisabled =
    claimBusy || !wallet.address || available === null || available <= 0;
  const claimLabel = !wallet.address
    ? "Connect wallet to claim"
    : available === null
      ? "Connect wallet to claim"
      : available > 0
        ? `Claim ${fmt(available)} DEGEN`
        : "No rewards available";

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
              <div className="ref-stat-label">Total Earned</div>
              <div className="ref-stat-val">
                {totalAmt === null ? "—" : `${fmt(totalAmt)} DEGEN`}
              </div>
            </div>
            <div className="ref-stat">
              <div className="ref-stat-label">Already Claimed</div>
              <div className="ref-stat-val">
                {claimedAmt === null ? "—" : `${fmt(claimedAmt)} DEGEN`}
              </div>
            </div>
            <div className="ref-stat">
              <div className="ref-stat-label">Available</div>
              <div className="ref-stat-val" style={{ color: "var(--red)" }}>
                {available === null ? "—" : `${fmt(available)} DEGEN`}
              </div>
            </div>
          </div>

          <div className="ref-dest-label">Redeem into</div>
          <div className="ref-dest-grid">
            {REF_DEST_POOLS.map((pool) => (
              <button
                key={pool.addr}
                className={`ref-dest-btn${selectedPool === pool.addr ? " active" : ""}`}
                onClick={() => setSelectedPool(pool.addr)}
              >
                {pool.label} <span className="ref-dest-pct">{pool.pct}</span>
              </button>
            ))}
          </div>

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
