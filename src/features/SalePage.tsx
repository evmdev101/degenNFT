import { Contract, formatEther, parseEther } from "ethers";
import { useCallback, useEffect, useState } from "react";
import { CONTRACTS, ERC20_ABI, SALE_ABI } from "../config/contracts";
import type { WalletState } from "../hooks/useWallet";
import { getPublicProvider, readableError } from "../lib/chain";
import { SETTINGS_POOLS } from "./nft/options";

type Payment = "PLS" | "PLSX" | "INC";
const fmt = (value: bigint, digits = 0) =>
  Number(formatEther(value)).toLocaleString(undefined, {
    maximumFractionDigits: digits,
  });

export function SalePage({ wallet }: { wallet: WalletState }) {
  const [available, setAvailable] = useState(0n),
    [pending, setPending] = useState(0n),
    [bonus, setBonus] = useState(0n),
    [payment, setPayment] = useState<Payment>("PLS"),
    [amount, setAmount] = useState("");
  const [quote, setQuote] = useState<bigint | null>(null),
    [tokenAddresses, setTokenAddresses] = useState({ PLSX: "", INC: "" }),
    [pool, setPool] = useState(SETTINGS_POOLS.DEGEN.at(-1)!.address);
  const [status, setStatus] = useState(""),
    [busy, setBusy] = useState(false),
    [buyOpen, setBuyOpen] = useState(false),
    [claimOpen, setClaimOpen] = useState(false);
  const load = useCallback(async () => {
    try {
      const provider = await getPublicProvider();
      const sale = new Contract(CONTRACTS.sale, SALE_ABI, provider);
      const degen = new Contract(CONTRACTS.degen, ERC20_ABI, provider);
      const [inventory, plsx, inc] = await Promise.all([
        degen.balanceOf(CONTRACTS.sale),
        sale.PLSX(),
        sale.INC(),
      ]);
      setAvailable(inventory);
      setTokenAddresses({ PLSX: plsx, INC: inc });
      if (wallet.address) {
        const [base, extra] = await Promise.all([
          sale.userTokens(wallet.address),
          sale.bonusAmount(wallet.address),
        ]);
        setPending(base);
        setBonus(extra);
      }
    } catch (error) {
      setStatus(readableError(error));
    }
  }, [wallet.address]);
  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    if (!amount || Number(amount) <= 0) {
      setQuote(null);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(
      () =>
        void (async () => {
          try {
            const provider = await getPublicProvider();
            const sale = new Contract(CONTRACTS.sale, SALE_ABI, provider);
            const raw = parseEther(amount);
            const next =
              payment === "PLS"
                ? await sale.getWithPLS(raw, pool)
                : payment === "PLSX"
                  ? await sale.getWithPLSX(raw, pool)
                  : await sale.getWithINC(raw, pool);
            if (!cancelled) setQuote(next);
          } catch {
            if (!cancelled) setQuote(null);
          }
        })(),
      350,
    );
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [amount, payment, pool]);
  const buy = async () => {
    if (!wallet.address) {
      await wallet.connect();
      return;
    }
    try {
      setBusy(true);
      setStatus("Preparing purchase…");
      const raw = parseEther(amount);
      if (raw <= 0n) throw new Error("Enter an amount to spend.");
      const signer = await wallet.getSigner();
      const sale = new Contract(CONTRACTS.sale, SALE_ABI, signer);
      let tx;
      if (payment === "PLS") {
        setStatus("Confirm the PLS purchase in your wallet…");
        tx = await sale.buyWithPLS(raw, pool, { value: raw });
      } else {
        const tokenAddress = tokenAddresses[payment];
        if (!tokenAddress)
          throw new Error(`${payment} address is not available yet.`);
        const token = new Contract(tokenAddress, ERC20_ABI, signer);
        const allowance = await token.allowance(wallet.address, CONTRACTS.sale);
        if (allowance < raw) {
          setStatus(`Approve ${payment} in your wallet…`);
          const approval = await token.approve(CONTRACTS.sale, raw);
          await approval.wait();
        }
        setStatus("Confirm the purchase in your wallet…");
        tx =
          payment === "PLSX"
            ? await sale.buyWithPLSX(raw, pool)
            : await sale.buyWithINC(raw, pool);
      }
      setStatus("Purchase submitted. Waiting for confirmation…");
      await tx.wait();
      setStatus(`Purchase confirmed: ${tx.hash.slice(0, 10)}…`);
      await load();
    } catch (error) {
      setStatus(readableError(error));
    } finally {
      setBusy(false);
    }
  };
  const claim = async () => {
    try {
      setBusy(true);
      setStatus("Confirm the DEGEN claim in your wallet…");
      const signer = await wallet.getSigner();
      const sale = new Contract(CONTRACTS.sale, SALE_ABI, signer);
      const tx = await sale.claimTokens(pending + bonus, pool);
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
  const poolOptions = (
    <div className="dsale-modal-seg">
      {SETTINGS_POOLS.DEGEN.filter(
        (item) => !item.label.startsWith("1 Month"),
      ).map((item) => (
        <button
          type="button"
          className={pool === item.address ? "active" : ""}
          onClick={() => setPool(item.address)}
          key={item.address}
        >
          {item.label.replace(" (default)", "")}
        </button>
      ))}
    </div>
  );
  return (
    <main className="legacy-section">
      <section className="dsale-wrap">
        <article className="dsale-card">
          <div className="dsale-logo">DegenStrategy</div>
          <h1>Limited Time DEGEN Miner Sale!</h1>
          <p>
            Sale proceeds are used to create OINK reserves and fill the
            decentralized treasury!
            <br />
            Buy a virtual DEGEN miner that helps secure the protocol — you get a
            discount and protocol rewards for doing so!
          </p>
          <div className="dsale-avail">
            <span>Tokens Available For Sale</span>
            <strong>{fmt(available)} DEGEN</strong>
          </div>
          <div className="dsale-discounts">
            <b>Available discounts:</b>
            <span>10 Year Miner: ~30% bonus tokens</span>
            <span>1 Year Miner: ~10% bonus tokens</span>
            <span>3 Month Miner: ~5% bonus tokens</span>
          </div>
          <a
            className="dsale-action-btn any-chain"
            href="https://degen-pls.com/?buy"
            target="_blank"
            rel="noreferrer"
          >
            Click to get DEGEN using ANY token on ANY chain
          </a>
          <button
            className="dsale-action-btn pls-buy"
            onClick={() => setBuyOpen(true)}
          >
            Click to get DEGEN instantly using PLS, PLSX or INC
          </button>
          <div className="dsale-pending-card">
            <span>Your Pending DEGEN</span>
            <strong>
              {wallet.isConnected
                ? `${fmt(pending + bonus)} DEGEN`
                : "Connect wallet"}
            </strong>
            {bonus > 0n && (
              <small>
                {fmt(pending)} base + {fmt(bonus)} bonus
              </small>
            )}
            <button
              disabled={!wallet.isConnected || pending + bonus === 0n}
              onClick={() => setClaimOpen(true)}
            >
              Claim Tokens
            </button>
          </div>
        </article>
      </section>
      {buyOpen && (
        <div
          className="dsale-modal-overlay"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setBuyOpen(false);
          }}
        >
          <section className="dsale-modal-box">
            <header>
              <h2>Buy DEGEN Tokens</h2>
              <button onClick={() => setBuyOpen(false)}>×</button>
            </header>
            <label>
              Buy With
              <div className="dsale-modal-seg">
                {(["PLS", "PLSX", "INC"] as Payment[]).map((item) => (
                  <button
                    className={payment === item ? "active" : ""}
                    onClick={() => setPayment(item)}
                    key={item}
                  >
                    {item}
                  </button>
                ))}
              </div>
            </label>
            <label>Choose Discount (Lock-up Duration){poolOptions}</label>
            <label>
              Amount to Spend
              <input
                value={amount}
                placeholder="0.00"
                onChange={(e) => setAmount(e.target.value)}
              />
            </label>
            <div className="dsale-modal-quote">
              <span>DEGEN You&apos;ll Receive</span>
              <strong>{quote === null ? "—" : `${fmt(quote)} DEGEN`}</strong>
            </div>
            <button
              className="dsale-modal-exec"
              disabled={busy}
              onClick={() => void buy()}
            >
              {wallet.isConnected ? "Get DEGEN!" : "Connect Wallet"}
            </button>
            {status && <div className="transaction-status">{status}</div>}
          </section>
        </div>
      )}
      {claimOpen && (
        <div
          className="dsale-modal-overlay"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setClaimOpen(false);
          }}
        >
          <section className="dsale-modal-box">
            <header>
              <h2>Claim DEGEN Tokens</h2>
              <button onClick={() => setClaimOpen(false)}>×</button>
            </header>
            <div className="dsale-modal-quote">
              <span>Total Claimable</span>
              <strong>{fmt(pending + bonus)} DEGEN</strong>
            </div>
            <label>Stake Claimed Tokens Into{poolOptions}</label>
            <button
              className="dsale-modal-exec"
              disabled={busy}
              onClick={() => void claim()}
            >
              Claim Tokens
            </button>
            {status && <div className="transaction-status">{status}</div>}
          </section>
        </div>
      )}
    </main>
  );
}
