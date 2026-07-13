// DEGEN Sale tab — markup and styling restored verbatim from the original
// single-file site (commit 825e9f2). Logic mirrors loadDegenSaleTab,
// openDsaleBuyModal / executeDsaleBuy, openDsaleClaimModal / executeDsaleClaim.
import { Contract, formatEther, parseEther } from "ethers";
import { useCallback, useEffect, useRef, useState } from "react";
import { CONTRACTS, ERC20_ABI, SALE_ABI } from "../config/contracts";
import type { WalletState } from "../hooks/useWallet";
import { getPublicProvider, readableError } from "../lib/chain";

const POOL_10Y = "0xdE672FccA32365bD704c39bd1164a0D34a3a73e6";
const POOL_1Y = "0x3d175C8359169b0e830d36EA9CD3FE209f46f7BD";
const POOL_3M = "0x7ED33f65A0398cb26eaB2B03877825c96D9B6077";

type BuyMethod = "PLS" | "PLSX" | "INC";

function fmtDsaleWholeToken(rawWei: bigint) {
  const whole = rawWei / 1000000000000000000n;
  return whole.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}
const fmt0 = (wei: bigint) =>
  parseFloat(formatEther(wei)).toLocaleString(undefined, {
    maximumFractionDigits: 0,
  });

type ModalStatus = {
  kind: "pending" | "success" | "error";
  text: string;
} | null;

export function SalePage({ wallet }: { wallet: WalletState }) {
  const [availText, setAvailText] = useState<string | null>(null);
  const [pendingWei, setPendingWei] = useState<bigint | null>(null);
  const [bonusWei, setBonusWei] = useState<bigint>(0n);

  const [buyOpen, setBuyOpen] = useState(false);
  const [buyMethod, setBuyMethod] = useState<BuyMethod>("PLS");
  const [buyPool, setBuyPool] = useState(POOL_10Y);
  const [buyAmount, setBuyAmount] = useState("");
  const [buyQuote, setBuyQuote] = useState("—");
  const [buyBusy, setBuyBusy] = useState(false);
  const [buyStatus, setBuyStatus] = useState<ModalStatus>(null);

  const [claimOpen, setClaimOpen] = useState(false);
  const [claimPool, setClaimPool] = useState(POOL_10Y);
  const [claimAmount, setClaimAmount] = useState("");
  const [claimBusy, setClaimBusy] = useState(false);
  const [claimStatus, setClaimStatus] = useState<ModalStatus>(null);

  const quoteTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const totalPending = (pendingWei ?? 0n) + bonusWei;

  const load = useCallback(async () => {
    try {
      const provider = await getPublicProvider();
      const sale = new Contract(CONTRACTS.sale, SALE_ABI, provider);
      // Available DEGEN (balance of the sale contract)
      try {
        const degen = new Contract(CONTRACTS.degen, ERC20_ABI, provider);
        const avail: bigint = await degen.balanceOf(CONTRACTS.sale);
        setAvailText(fmtDsaleWholeToken(avail) + " DEGEN");
      } catch {
        setAvailText("—");
      }
      // User pending
      if (wallet.address) {
        try {
          const [pending, bonus] = await Promise.all([
            sale.userTokens(wallet.address),
            sale.bonusAmount(wallet.address),
          ]);
          setPendingWei(pending);
          setBonusWei(bonus);
        } catch {
          setPendingWei(null);
          setBonusWei(0n);
        }
      } else {
        setPendingWei(null);
        setBonusWei(0n);
      }
    } catch (e) {
      console.warn("DSALE load", e);
      setAvailText("—");
    }
  }, [wallet.address]);

  useEffect(() => {
    void load();
  }, [load]);

  // ── Buy modal ──
  function openBuyModal() {
    if (!wallet.address) {
      alert("Connect your wallet first.");
      return;
    }
    setBuyAmount("");
    setBuyQuote("—");
    setBuyStatus(null);
    setBuyBusy(false);
    setBuyOpen(true);
  }

  function scheduleQuote(amtStr: string, method: BuyMethod, pool: string) {
    if (quoteTimer.current) clearTimeout(quoteTimer.current);
    setBuyQuote("…");
    quoteTimer.current = setTimeout(() => {
      void (async () => {
        if (!amtStr || parseFloat(amtStr) <= 0) {
          setBuyQuote("—");
          return;
        }
        try {
          const provider = await getPublicProvider();
          const sale = new Contract(CONTRACTS.sale, SALE_ABI, provider);
          const amtWei = parseEther(amtStr);
          let q: bigint;
          if (method === "PLS") q = await sale.getWithPLS(amtWei, pool);
          else if (method === "PLSX") q = await sale.getWithPLSX(amtWei, pool);
          else q = await sale.getWithINC(amtWei, pool);
          setBuyQuote(fmt0(q) + " DEGEN");
        } catch {
          setBuyQuote("Quote failed");
        }
      })();
    }, 420);
  }

  async function executeBuy() {
    if (!buyAmount || parseFloat(buyAmount) <= 0) {
      setBuyStatus({ kind: "error", text: "Enter an amount to spend." });
      return;
    }
    setBuyBusy(true);
    setBuyStatus({ kind: "pending", text: "Preparing transaction…" });
    try {
      const signer = await wallet.getSigner();
      const amtWei = parseEther(buyAmount);
      const sale = new Contract(CONTRACTS.sale, SALE_ABI, signer);
      let tx;
      if (buyMethod === "PLS") {
        setBuyStatus({
          kind: "pending",
          text: "Waiting for wallet confirmation…",
        });
        tx = await sale.buyWithPLS(amtWei, buyPool, { value: amtWei });
      } else {
        const provider = await getPublicProvider();
        const roSale = new Contract(CONTRACTS.sale, SALE_ABI, provider);
        const tokenAddr: string =
          buyMethod === "PLSX" ? await roSale.PLSX() : await roSale.INC();
        const tkn = new Contract(tokenAddr, ERC20_ABI, signer);
        const allowed: bigint = await tkn.allowance(
          wallet.address,
          CONTRACTS.sale,
        );
        if (allowed < amtWei) {
          setBuyStatus({ kind: "pending", text: `Approving ${buyMethod}…` });
          const appTx = await tkn.approve(CONTRACTS.sale, amtWei);
          setBuyStatus({
            kind: "pending",
            text: "Approve sent — confirming…",
          });
          await appTx.wait();
        }
        setBuyStatus({
          kind: "pending",
          text: "Waiting for wallet confirmation…",
        });
        tx =
          buyMethod === "PLSX"
            ? await sale.buyWithPLSX(amtWei, buyPool)
            : await sale.buyWithINC(amtWei, buyPool);
      }
      setBuyStatus({ kind: "pending", text: "Transaction sent — confirming…" });
      await tx.wait();
      setBuyStatus({
        kind: "success",
        text: `Purchased! TX: ${tx.hash.slice(0, 10)}…`,
      });
      void load();
    } catch (e) {
      setBuyStatus({ kind: "error", text: readableError(e) });
    } finally {
      setBuyBusy(false);
    }
  }

  // ── Claim modal ──
  function openClaimModal() {
    if (!wallet.address) {
      alert("Connect your wallet first.");
      return;
    }
    setClaimAmount(parseFloat(formatEther(totalPending)).toFixed(0));
    setClaimStatus(null);
    setClaimBusy(false);
    setClaimOpen(true);
  }

  async function executeClaim() {
    if (!claimAmount || parseFloat(claimAmount) <= 0) {
      setClaimStatus({ kind: "error", text: "Enter an amount to claim." });
      return;
    }
    setClaimBusy(true);
    setClaimStatus({
      kind: "pending",
      text: "Waiting for wallet confirmation…",
    });
    try {
      const signer = await wallet.getSigner();
      const amtWei = parseEther(claimAmount);
      const sale = new Contract(CONTRACTS.sale, SALE_ABI, signer);
      const tx = await sale.claimTokens(amtWei, claimPool);
      setClaimStatus({
        kind: "pending",
        text: "Transaction sent — confirming…",
      });
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

  return (
    <main className="legacy-main">
      <div className="dsale-wrap">
        <div className="dsale-card">
          <div className="dsale-logo">DegenStrategy</div>
          <div className="dsale-title">Limited Time DEGEN Miner Sale!</div>
          <p className="dsale-desc">
            Sale proceeds are used to create OINK reserves and fill the
            decentralized treasury!
            <br />
            Buy a virtual DEGEN miner that helps secure the protocol — you get
            a discount and protocol rewards for doing so!
          </p>

          <div className="dsale-avail">
            <div className="dsale-avail-label">Tokens Available For Sale</div>
            <div className="dsale-avail-val">
              {availText ?? <span className="spinner" />}
            </div>
          </div>

          <div className="dsale-discounts">
            <div className="dsale-discounts-title">Available discounts:</div>
            <div className="dsale-discount-line">
              10 Year Miner: ~30% bonus tokens
            </div>
            <div className="dsale-discount-line">
              1 Year Miner: ~10% bonus tokens
            </div>
            <div className="dsale-discount-line">
              3 Month Miner: ~5% bonus tokens
            </div>
          </div>

          <button
            className="dsale-action-btn any-chain"
            onClick={() =>
              window.open(
                "https://degen-pls.com/?buy",
                "_blank",
                "noopener noreferrer",
              )
            }
          >
            Click to get DEGEN using ANY token on ANY chain
          </button>
          <button className="dsale-action-btn pls-buy" onClick={openBuyModal}>
            Click to get DEGEN instantly using PLS, PLSX or INC
          </button>

          <div className="dsale-pending-card">
            <div className="dsale-pending-label">Your Pending DEGEN</div>
            <div className="dsale-pending-val">
              {!wallet.address
                ? "Connect wallet"
                : pendingWei === null
                  ? "—"
                  : `${fmt0(totalPending)} DEGEN`}
            </div>
            <div className="dsale-pending-sub">
              {wallet.address && pendingWei !== null && bonusWei > 0n
                ? `${fmt0(pendingWei)} base + ${fmt0(bonusWei)} bonus`
                : ""}
            </div>
            <button
              className="dsale-claim-action-btn"
              disabled={!wallet.address || totalPending === 0n}
              onClick={openClaimModal}
            >
              Claim Tokens
            </button>
          </div>
        </div>
      </div>

      {/* ── DEGEN Sale Buy Modal ── */}
      {buyOpen && (
        <div
          className="dsale-modal-overlay"
          style={{ display: "flex" }}
          onClick={(event) => {
            if (event.target === event.currentTarget) setBuyOpen(false);
          }}
        >
          <div className="dsale-modal-box">
            <div className="dsale-modal-header">
              <div className="dsale-modal-title">Buy DEGEN Tokens</div>
              <button
                className="dsale-modal-close"
                onClick={() => setBuyOpen(false)}
              >
                ×
              </button>
            </div>

            <div>
              <div className="dsale-modal-label">Buy With</div>
              <div className="dsale-modal-seg">
                {(
                  [
                    ["PLS", "PulseChain"],
                    ["PLSX", "PulseX"],
                    ["INC", "Incentive"],
                  ] as const
                ).map(([method, sub]) => (
                  <button
                    key={method}
                    className={`dsale-seg-btn${buyMethod === method ? " active" : ""}`}
                    onClick={() => {
                      setBuyMethod(method);
                      scheduleQuote(buyAmount, method, buyPool);
                    }}
                  >
                    {method}
                    <span className="dsale-seg-sub">{sub}</span>
                  </button>
                ))}
              </div>
            </div>

            <div>
              <div className="dsale-modal-label">
                Choose Discount (Lock-up Duration)
              </div>
              <div className="dsale-modal-seg">
                {(
                  [
                    [POOL_10Y, "10 Year", "~30% bonus"],
                    [POOL_1Y, "1 Year", "~10% bonus"],
                    [POOL_3M, "3 Month", "~5% bonus"],
                  ] as const
                ).map(([pool, label, sub]) => (
                  <button
                    key={pool}
                    className={`dsale-seg-btn${buyPool === pool ? " active" : ""}`}
                    onClick={() => {
                      setBuyPool(pool);
                      scheduleQuote(buyAmount, buyMethod, pool);
                    }}
                  >
                    {label}
                    <span className="dsale-seg-sub">{sub}</span>
                  </button>
                ))}
              </div>
            </div>

            <div>
              <div className="dsale-modal-label">Amount to Spend</div>
              <input
                className="dsale-modal-input"
                type="number"
                min="0"
                step="any"
                placeholder="0.00"
                value={buyAmount}
                onChange={(event) => {
                  setBuyAmount(event.target.value);
                  scheduleQuote(event.target.value, buyMethod, buyPool);
                }}
              />
            </div>

            <div className="dsale-modal-quote">
              <span className="dsale-modal-quote-label">
                DEGEN You&apos;ll Receive
              </span>
              <span className="dsale-modal-quote-val">{buyQuote}</span>
            </div>

            <button
              className="dsale-modal-exec-btn"
              disabled={buyBusy}
              onClick={() => void executeBuy()}
            >
              Get DEGEN!
            </button>
            {buyStatus && (
              <div className={`dsale-modal-status ${buyStatus.kind}`}>
                {buyStatus.text}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── DEGEN Sale Claim Modal ── */}
      {claimOpen && (
        <div
          className="dsale-modal-overlay"
          style={{ display: "flex" }}
          onClick={(event) => {
            if (event.target === event.currentTarget) setClaimOpen(false);
          }}
        >
          <div className="dsale-modal-box">
            <div className="dsale-modal-header">
              <div className="dsale-modal-title">Claim DEGEN Tokens</div>
              <button
                className="dsale-modal-close"
                onClick={() => setClaimOpen(false)}
              >
                ×
              </button>
            </div>

            <div className="dsale-modal-quote">
              <span className="dsale-modal-quote-label">Total Claimable</span>
              <span className="dsale-modal-quote-val">
                {fmt0(totalPending)} DEGEN
              </span>
            </div>

            <div>
              <div className="dsale-modal-label">Claim Amount</div>
              <input
                className="dsale-modal-input"
                type="number"
                min="0"
                step="any"
                placeholder="Amount of DEGEN to claim"
                value={claimAmount}
                onChange={(event) => setClaimAmount(event.target.value)}
              />
            </div>

            <div>
              <div className="dsale-modal-label">Stake Claimed Tokens Into</div>
              <div className="dsale-modal-seg">
                {(
                  [
                    [POOL_10Y, "10 Year", "100% payout"],
                    [POOL_1Y, "1 Year", "5% payout"],
                    [POOL_3M, "3 Month", "2.5% payout"],
                  ] as const
                ).map(([pool, label, sub]) => (
                  <button
                    key={pool}
                    className={`dsale-seg-btn${claimPool === pool ? " active" : ""}`}
                    onClick={() => setClaimPool(pool)}
                  >
                    {label}
                    <span className="dsale-seg-sub">{sub}</span>
                  </button>
                ))}
              </div>
            </div>

            <button
              className="dsale-modal-exec-btn"
              disabled={claimBusy}
              onClick={() => void executeClaim()}
            >
              Claim Tokens
            </button>
            {claimStatus && (
              <div className={`dsale-modal-status ${claimStatus.kind}`}>
                {claimStatus.text}
              </div>
            )}
          </div>
        </div>
      )}
    </main>
  );
}
