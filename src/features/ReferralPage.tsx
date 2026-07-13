import { Contract, formatEther } from "ethers";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  CONTRACTS,
  REFERRAL_ABI,
  REFERRAL_GOVERNANCE_ABI,
} from "../config/contracts";
import type { WalletState } from "../hooks/useWallet";
import { getPublicProvider, readableError } from "../lib/chain";
import { SETTINGS_POOLS } from "./nft/options";

const BASE58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
function encodeAddress(address: string) {
  let n = BigInt(address);
  let output = "";
  while (n > 0n) {
    output = BASE58[Number(n % 58n)] + output;
    n /= 58n;
  }
  return output;
}
const fmt = (value: bigint) =>
  Number(formatEther(value)).toLocaleString(undefined, {
    maximumFractionDigits: 2,
  });

export function ReferralPage({ wallet }: { wallet: WalletState }) {
  const [bonus, setBonus] = useState<bigint>(0n),
    [total, setTotal] = useState(0n),
    [claimed, setClaimed] = useState(0n);
  const [pool, setPool] = useState(SETTINGS_POOLS.DEGEN.at(-1)!.address),
    [status, setStatus] = useState(""),
    [busy, setBusy] = useState(false),
    [copied, setCopied] = useState(false);
  const available = total > claimed ? total - claimed : 0n;
  const link = useMemo(
    () =>
      wallet.address
        ? `https://degen-pls.com/?r=${encodeAddress(wallet.address)}`
        : "Connect your wallet to create your referral link",
    [wallet.address],
  );
  const load = useCallback(async () => {
    try {
      const provider = await getPublicProvider();
      const contract = new Contract(
        CONTRACTS.referralRewards,
        REFERRAL_ABI,
        provider,
      );
      const governance = new Contract(
        CONTRACTS.referral,
        REFERRAL_GOVERNANCE_ABI,
        provider,
      );
      const nextBonus = await governance.referralBonus();
      setBonus(nextBonus);
      if (wallet.address) {
        const [earned, redeemed] = await Promise.all([
          contract.totalUserRewards(wallet.address),
          contract.amountRedeemed(wallet.address),
        ]);
        setTotal(earned);
        setClaimed(redeemed);
      }
    } catch (error) {
      setStatus(readableError(error));
    }
  }, [wallet.address]);
  useEffect(() => {
    void load();
  }, [load]);
  const claim = async () => {
    if (!wallet.address) {
      await wallet.connect();
      return;
    }
    try {
      setBusy(true);
      setStatus("Confirm the referral claim in your wallet…");
      const signer = await wallet.getSigner();
      const contract = new Contract(
        CONTRACTS.referralRewards,
        REFERRAL_ABI,
        signer,
      );
      const tx = await contract.redeemRewards(available, pool);
      setStatus("Claim submitted. Waiting for confirmation…");
      await tx.wait();
      setStatus(`Claim confirmed: ${tx.hash.slice(0, 10)}…`);
      await load();
    } catch (error) {
      setStatus(readableError(error));
    } finally {
      setBusy(false);
    }
  };
  return (
    <main className="legacy-section ref-wrap">
      <section className="ref-card">
        <h1>Earn Referral Bonuses</h1>
        <p>
          Share your referral link. When someone stakes using your link, both of
          you earn bonus DEGEN tokens — up to{" "}
          <strong>{Number(bonus) / 100}%</strong> bonus.
        </p>
        <p className="ref-note">
          Bonuses are managed by governance and paid from inflation / treasury.
          Tokens must be sent by the DAO to the reward contract before
          they&apos;re redeemable.
        </p>
        <label>Your Referral Link</label>
        <div className="ref-link-row">
          <input readOnly value={link} />
          <button
            disabled={!wallet.address}
            onClick={() =>
              void navigator.clipboard.writeText(link).then(() => {
                setCopied(true);
                setTimeout(() => setCopied(false), 1500);
              })
            }
          >
            {copied ? "Copied!" : "Copy"}
          </button>
        </div>
      </section>
      <section className="ref-card">
        <h1>Redeem Referral Rewards</h1>
        <div className="ref-stats-row">
          <article>
            <span>Total earned</span>
            <strong>{fmt(total)} DEGEN</strong>
          </article>
          <article>
            <span>Already claimed</span>
            <strong>{fmt(claimed)} DEGEN</strong>
          </article>
          <article>
            <span>Available</span>
            <strong>{fmt(available)} DEGEN</strong>
          </article>
        </div>
        <div className="ref-destination">
          <span>Redeem into</span>
          <div className="ref-dest-grid">
            {SETTINGS_POOLS.DEGEN.map((item) => (
              <button
                className={pool === item.address ? "active" : ""}
                onClick={() => setPool(item.address)}
                key={item.address}
              >
                {item.label.replace(" (default)", "")}
              </button>
            ))}
          </div>
        </div>
        <button
          className="ref-claim-btn"
          disabled={busy || (wallet.isConnected && available === 0n)}
          onClick={() => void claim()}
        >
          {busy
            ? "CLAIM PENDING"
            : wallet.isConnected
              ? available > 0n
                ? `CLAIM ${fmt(available)} DEGEN`
                : "NO REWARDS AVAILABLE"
              : "CONNECT WALLET"}
        </button>
        {status && <div className="transaction-status">{status}</div>}
      </section>
    </main>
  );
}
