import { usePageActive } from "../hooks/usePageActive";
import { confirmTransaction } from "../lib/transactions";
// DEGEN Sale tab — markup and styling restored verbatim from the original
// single-file site (commit 825e9f2). Logic mirrors loadDegenSaleTab,
// openDsaleBuyModal / executeDsaleBuy, openDsaleClaimModal / executeDsaleClaim.
import { Contract, formatEther, parseEther } from "ethers";
import { useCallback, useEffect, useRef, useState } from "react";
import { CONTRACTS, ERC20_ABI, SALE_ABI } from "../config/contracts";
import type { WalletState } from "../hooks/useWallet";
import { getPublicProvider, readableError } from "../lib/chain";
import "./miner-forms.css";

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
  const pageActive = usePageActive();
  const [availText, setAvailText] = useState<string | null>(null);
  const [inventory, setInventory] = useState<bigint | null>(null);
  const [pendingWei, setPendingWei] = useState<bigint | null>(null);
  const [activeTab, setActiveTab] = useState<"buy" | "claim">("buy");
  const [buyMethod, setBuyMethod] = useState<BuyMethod>("PLS");
  const [buyPool, setBuyPool] = useState(POOL_10Y);
  const [buyAmount, setBuyAmount] = useState("");
  const [buyQuote, setBuyQuote] = useState("—");
  const [buyBusy, setBuyBusy] = useState(false);
  const [buyStatus, setBuyStatus] = useState<ModalStatus>(null);
  const [claimPool, setClaimPool] = useState(POOL_10Y);
  const [claimAmount, setClaimAmount] = useState("");
  const [claimBusy, setClaimBusy] = useState(false);
  const [claimStatus, setClaimStatus] = useState<ModalStatus>(null);
  const [spendable, setSpendable] = useState<Partial<Record<BuyMethod, bigint>>>({});
  const [unitQuotes, setUnitQuotes] = useState<Record<string, bigint>>({});
  const active = useRef(false);
  const sequence = useRef(0);
  const quoteSequence = useRef(0);
  const quoteTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const totalPending = pendingWei ?? 0n;

  const load = useCallback(async () => {
    const seq = ++sequence.current;
    try {
      const provider = await getPublicProvider();
      const sale = new Contract(CONTRACTS.sale, SALE_ABI, provider);
      const current = () => seq === sequence.current;
      const jobs: Promise<unknown>[] = [
        (async () => {
          const degen = new Contract(CONTRACTS.degen, ERC20_ABI, provider);
          const available: bigint = await degen.balanceOf(CONTRACTS.sale);
          if (current()) { setInventory(available); setAvailText(fmtDsaleWholeToken(available) + " DEGEN"); }
        })(),
      ];
      if (wallet.address) {
        const account = wallet.address;
        // Claim allocation is essential and must not wait for optional Max data.
        jobs.push((async () => {
          const pending: bigint = await sale.userTokens(account);
          if (current()) setPendingWei(pending);
        })());
        jobs.push((async () => {
          const [nativeBalance, fees] = await Promise.all([provider.getBalance(account), provider.getFeeData()]);
          const reserve = fees.gasPrice === null ? nativeBalance : fees.gasPrice * 2_000_000n;
          if (current()) setSpendable(previous => ({ ...previous, PLS: nativeBalance > reserve ? nativeBalance - reserve : 0n }));
        })());
        for (const method of ["PLSX", "INC"] as const) jobs.push((async () => {
          const tokenAddress = await sale[method]();
          const token = new Contract(tokenAddress, [...ERC20_ABI, "function decimals() view returns (uint8)"], provider);
          const [balance, decimals] = await Promise.all([token.balanceOf(account), token.decimals()]);
          if (Number(decimals) !== 18) throw new Error("Payment token precision changed.");
          if (current()) setSpendable(previous => ({ ...previous, [method]: balance }));
        })());
      }
      const pools = [POOL_10Y, POOL_1Y, POOL_3M];
      jobs.push((async () => {
        const quotes = await Promise.all(pools.flatMap(pool => (["PLS", "PLSX", "INC"] as BuyMethod[]).map(async method => {
          const q: bigint = await sale[`getWith${method}`](10n ** 18n, pool);
          return [`${method}:${pool}`, q] as const;
        })));
        if (current()) setUnitQuotes(Object.fromEntries(quotes));
      })());
      await Promise.allSettled(jobs);
    } catch { /* Retain the last successful values; recover on the next poll. */ }
  }, [wallet.address]);

  useEffect(() => {
    setPendingWei(null); setSpendable({});
    setBuyAmount(""); setClaimAmount(""); setBuyQuote("—");
    setBuyStatus(null); setClaimStatus(null);
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
    return () => { disposed = true; sequence.current++; quoteSequence.current++; clearTimeout(timer); if (quoteTimer.current) clearTimeout(quoteTimer.current); };
  }, [load, pageActive]);

  function switchToBuy() { setActiveTab("buy"); }
  function switchToClaim() { setActiveTab("claim"); if (!claimAmount && pendingWei !== null) setClaimAmount(formatEther(totalPending)); }
  function scheduleQuote(amount: string, method: BuyMethod, pool: string) {
    const seq = ++quoteSequence.current;
    if (quoteTimer.current) clearTimeout(quoteTimer.current);
    setBuyQuote("—");
    quoteTimer.current = setTimeout(() => { void (async () => {
      try {
        const payment = parseEther(amount);
        if (payment <= 0n) return;
        const provider = await getPublicProvider();
        const sale = new Contract(CONTRACTS.sale, SALE_ABI, provider);
        const quote: bigint = await sale[`getWith${method}`](payment, pool);
        if (seq === quoteSequence.current) setBuyQuote(fmt0(quote) + " DEGEN");
      } catch { if (seq === quoteSequence.current) setBuyQuote("Unavailable"); }
    })(); }, 300);
  }
  function maxBuy() {
    let maximum = spendable[buyMethod];
    const rate = unitQuotes[`${buyMethod}:${buyPool}`];
    if (maximum === undefined || inventory === null || !rate) return;
    const inventoryLimit = inventory * 10n ** 18n / rate;
    if (maximum > inventoryLimit) maximum = inventoryLimit;
    const amount = formatEther(maximum);
    setBuyAmount(amount); scheduleQuote(amount, buyMethod, buyPool);
  }

  async function executeBuy() {
    if (active.current) return;
    active.current = true; setBuyBusy(true); setBuyStatus(null);
    try {
      const amount = parseEther(buyAmount);
      if (amount <= 0n) throw new Error("Enter a positive amount to spend.");
      if (![POOL_10Y, POOL_1Y, POOL_3M].includes(buyPool)) throw new Error("Choose a supported pool.");
      let signer = await wallet.getSigner();
      const account = await signer.getAddress();
      let sale = new Contract(CONTRACTS.sale, SALE_ABI, signer);
      // DTX is OINK, used by the sale's pricing route; TOKEN_X is the DEGEN sold.
      if (String(await sale.TOKEN_X()).toLowerCase() !== CONTRACTS.degen.toLowerCase()) throw new Error("Sale token changed. This purchase is unavailable.");
      const quote: bigint = await sale[`getWith${buyMethod}`](amount, buyPool);
      const available: bigint = await new Contract(CONTRACTS.degen, ERC20_ABI, signer).balanceOf(CONTRACTS.sale);
      if (quote <= 0n || quote > available) throw new Error("The sale cannot fill this amount. Choose a smaller amount.");
      if (buyMethod !== "PLS") {
        const tokenAddress = await sale[buyMethod]();
        const token = new Contract(tokenAddress, [...ERC20_ABI, "function decimals() view returns (uint8)"], signer);
        const [balance, allowance, decimals] = await Promise.all([token.balanceOf(account), token.allowance(account, CONTRACTS.sale), token.decimals()]);
        if (Number(decimals) !== 18) throw new Error("Payment token precision changed.");
        if (amount > balance) throw new Error("Amount exceeds your current token balance.");
        if (allowance < amount) {
          await token.approve.staticCall(CONTRACTS.sale, amount);
          await confirmTransaction(await token.approve(CONTRACTS.sale, amount));
          signer = await wallet.getSigner();
          if ((await signer.getAddress()).toLowerCase() !== account.toLowerCase()) throw new Error("Wallet changed. Choose the action again.");
          sale = new Contract(CONTRACTS.sale, SALE_ABI, signer);
        }
      }
      const method = sale[`buyWith${buyMethod}`];
      const overrides = buyMethod === "PLS" ? { value: amount } : {};
      await method.staticCall(amount, buyPool, overrides);
      const gas: bigint = await method.estimateGas(amount, buyPool, overrides);
      const [fees, balance] = await Promise.all([signer.provider.getFeeData(), signer.provider.getBalance(account)]);
      const price = fees.maxFeePerGas ?? fees.gasPrice;
      if (price === null || balance < (buyMethod === "PLS" ? amount : 0n) + gas * price * 120n / 100n) throw new Error("Keep enough PLS for the purchase and network fee.");
      await confirmTransaction(await method(amount, buyPool, overrides));
      setBuyStatus({ kind: "success", text: "Miner purchased." }); setBuyAmount(""); setBuyQuote("—");
      await load();
    } catch (error) { setBuyStatus({ kind: "error", text: readableError(error) }); }
    finally { active.current = false; setBuyBusy(false); }
  }

  async function executeClaim() {
    if (active.current) return;
    active.current = true; setClaimBusy(true); setClaimStatus(null);
    try {
      const amount = parseEther(claimAmount);
      if (amount <= 0n) throw new Error("Enter a positive claim amount.");
      const signer = await wallet.getSigner();
      const account = await signer.getAddress();
      const sale = new Contract(CONTRACTS.sale, SALE_ABI, signer);
      const pending: bigint = await sale.userTokens(account);
      if (amount > pending) throw new Error("Claimable balance changed. Choose a smaller amount.");
      if (![POOL_10Y, POOL_1Y, POOL_3M].includes(claimPool)) throw new Error("Choose a supported claim pool.");
      await sale.claimTokens.staticCall(amount, claimPool);
      await confirmTransaction(await sale.claimTokens(amount, claimPool));
      setClaimStatus({ kind: "success", text: "Rewards claimed." }); setClaimAmount("");
      await load();
    } catch (error) { setClaimStatus({ kind: "error", text: readableError(error) }); }
    finally { active.current = false; setClaimBusy(false); }
  }

  return (
    <main className="legacy-main">
      <div className="dsale-wrap">
        <div className="dsale-grid">
          <section className="dsale-info">
            <h1 className="dsale-title">Limited Time DEGEN Miner Sale!</h1>
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
                {availText ?? "—"}
              </div>
            </div>

            <div className="dsale-anychain">
              <div className="dsale-anychain-headline">
                Pay with <em>any token</em> on <em>any chain</em>
              </div>
              <div className="dsale-anychain-chips">
                {["ETH", "BNB", "SOL", "ARB", "BASE", "+ more"].map((chain) => (
                  <span key={chain} className="dsale-anychain-chip">
                    {chain}
                  </span>
                ))}
              </div>
              <a
                className="dsale-anychain-link"
                href="https://degen-pls.com/?buy"
                target="_blank"
                rel="noopener noreferrer"
              >
                <strong>
                  Get DEGEN on DegenStrategy
                  <span className="dsale-anychain-arrow">→</span>
                </strong>
              </a>
            </div>
          </section>

          <aside className="dsale-panel">
            <div className="dsale-panel-stat">
              <div className="dsale-panel-stat-label">
                Pending Protocol Rewards
              </div>
              <div className="dsale-panel-stat-val">
                {!wallet.address
                  ? "Connect wallet"
                  : pendingWei === null
                    ? "—"
                    : `${fmt0(totalPending)} DEGEN`}
              </div>
              <div className="dsale-panel-stat-sub">
                Protocol DEGEN allocated to your wallet and ready to claim.
              </div>
            </div>

            <div className="dsale-panel-tabs">
              <button
                className={`dsale-panel-tab${activeTab === "buy" ? " active" : ""}`}
                onClick={switchToBuy}
              >
                Buy DEGEN
              </button>
              <button
                className={`dsale-panel-tab${activeTab === "claim" ? " active" : ""}`}
                onClick={switchToClaim}
              >
                Claim Rewards
                {totalPending > 0n && <span className="dsale-panel-dot" />}
              </button>
            </div>

            <div className="dsale-panel-body">
              {!wallet.address ? (
                <div className="dsale-connect-prompt">
                  <p>
                    {activeTab === "buy"
                      ? "Connect your wallet to buy DEGEN directly with PLS, PLSX, or INC."
                      : "Connect your wallet to view and claim your protocol rewards."}
                  </p>
                  <button
                    className="dsale-modal-exec-btn"
                    disabled={wallet.connecting}
                    onClick={() => void wallet.connect()}
                  >
                    {wallet.connecting ? "Connecting…" : "Connect Wallet"}
                  </button>
                </div>
              ) : activeTab === "buy" ? (
                <>
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
                    <div className="dsale-modal-label">Amount to Spend <button type="button" className="miner-inline-max" onClick={maxBuy} disabled={buyBusy || claimBusy || spendable[buyMethod] === undefined || !unitQuotes[`${buyMethod}:${buyPool}`]}>Max</button></div>
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
                    disabled={buyBusy || claimBusy}
                    onClick={() => void executeBuy()}
                  >
                    Get DEGEN!
                  </button>
                  {buyStatus && (
                    <div className={`dsale-modal-status ${buyStatus.kind}`}>
                      {buyStatus.text}
                    </div>
                  )}
                </>
              ) : (
                <>
                  <div className="dsale-modal-quote">
                    <span className="dsale-modal-quote-label">
                      Total Claimable
                    </span>
                    <span className="dsale-modal-quote-val">
                      {pendingWei === null ? "—" : `${fmt0(totalPending)} DEGEN`}
                    </span>
                  </div>

                  <div>
                    <div className="dsale-modal-label">Claim Amount <button type="button" className="miner-inline-max" disabled={claimBusy || buyBusy || pendingWei === null} onClick={() => setClaimAmount(formatEther(totalPending))}>Max</button></div>
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
                    <div className="dsale-modal-label">
                      Stake Claimed Tokens Into
                    </div>
                    <div className="dsale-modal-seg">
                      {(
                        [
                          [POOL_10Y, "10 Year", "Full allocation"],
                          [POOL_1Y, "1 Year", "Reduced payout"],
                          [POOL_3M, "3 Month", "Reduced payout"],
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

                  <p className="miner-form-estimate">Shorter pools receive less of the claimed reward. The contract rechecks current payout rules before the wallet opens.</p>
                  <button
                    className="dsale-modal-exec-btn"
                    disabled={claimBusy || buyBusy || pendingWei === null || totalPending === 0n}
                    onClick={() => void executeClaim()}
                  >
                    Claim Tokens
                  </button>
                  {claimStatus && (
                    <div className={`dsale-modal-status ${claimStatus.kind}`}>
                      {claimStatus.text}
                    </div>
                  )}
                </>
              )}
            </div>
          </aside>
        </div>
      </div>
    </main>
  );
}
