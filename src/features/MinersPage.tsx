import { usePageActive } from "../hooks/usePageActive";
import { confirmTransaction } from "../lib/transactions";
// Miners tab (Deploy Miner) — markup and styling restored verbatim from the
// original single-file site (commit 825e9f2). Logic mirrors
// loadDeployMinerTab / renderDeployGrid / deployMiner from the original.
import { Contract, ZeroAddress, formatEther, isAddress, parseEther } from "ethers";
import type { CSSProperties } from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { CONTRACTS, ERC20_ABI, POOL_DEPOSIT_ABI } from "../config/contracts";
import type { WalletState } from "../hooks/useWallet";
import { getPublicProvider, readableError } from "../lib/chain";
import "./miner-forms.css";

const DEGEN_POOLS = [
  { label: "1 Month", addr: "0xD9B491ac0f5487673500B67224b67b4171a08aCa" },
  { label: "3 Month", addr: "0x7ED33f65A0398cb26eaB2B03877825c96D9B6077" },
  { label: "1 Year", addr: "0x3d175C8359169b0e830d36EA9CD3FE209f46f7BD" },
  { label: "10 Year", addr: "0xdE672FccA32365bD704c39bd1164a0D34a3a73e6" },
];

function fmtMinerAmt(n: number) {
  if (n >= 1e9) return (n / 1e9).toFixed(2) + "B";
  if (n >= 1e6) return (n / 1e6).toFixed(2) + "M";
  if (n >= 1e3) return (n / 1e3).toFixed(2) + "K";
  return n.toFixed(2);
}

type CardState = {
  amount: string;
  dest: "self" | "gift";
  giftAddr: string;
  mandatory: string;
  status: { text: string; cls: "" | "active" | "ok" | "err" };
};

const emptyCard = (): CardState => ({
  amount: "",
  dest: "self",
  giftAddr: "",
  mandatory: "0",
  status: { text: "", cls: "" },
});

export function MinersPage({ wallet, poolAddress }: { wallet: WalletState; poolAddress?: string }) {
  const pageActive = usePageActive();
  const requestedPool = DEGEN_POOLS.find(pool => pool.addr.toLowerCase() === poolAddress?.toLowerCase())?.addr;
  const deploymentCards = useRef(new Map<string, HTMLDivElement>());
  const focusedPool = useRef<string | undefined>(undefined);
  const [walletBal, setWalletBal] = useState<bigint | null>(null);
  const active = useRef(false);
  const [busy, setBusy] = useState(false);
  const sequence = useRef(0);
  const [cards, setCards] = useState<CardState[]>(() =>
    DEGEN_POOLS.map(emptyCard),
  );

  // Overview links select a known deployment card, never an amount or action.
  useEffect(() => {
    if (!pageActive) { focusedPool.current = undefined; return; }
    if (!requestedPool) { focusedPool.current = undefined; return; }
    if (focusedPool.current === requestedPool) return;
    const card = deploymentCards.current.get(requestedPool);
    if (!card) return;
    const headerHeight = document.querySelector(".site-header")?.getBoundingClientRect().height ?? 96;
    card.style.scrollMarginTop = `${Math.ceil(headerHeight) + 20}px`;
    focusedPool.current = requestedPool;
    card.focus({ preventScroll: true });
    card.scrollIntoView({ behavior: "instant", block: "start", inline: "nearest" });
  }, [pageActive, requestedPool]);

  const patchCard = (index: number, patch: Partial<CardState>) =>
    setCards((prev) =>
      prev.map((card, i) => (i === index ? { ...card, ...patch } : card)),
    );
  const setStatus = (
    index: number,
    text: string,
    cls: CardState["status"]["cls"] = "",
  ) => patchCard(index, { status: { text, cls } });

  const loadWalletBal = useCallback(async () => {
    if (!wallet.address) {
      setWalletBal(null);
      return;
    }
    const seq = ++sequence.current;
    try {
      const provider = await getPublicProvider();
      const degenTok = new Contract(CONTRACTS.degen, ERC20_ABI, provider);
      const bal: bigint = await degenTok.balanceOf(wallet.address);
      if (seq === sequence.current) setWalletBal(bal);
    } catch {
      /* keep previous balance */
    }
  }, [wallet.address]);

  useEffect(() => {
    setWalletBal(null);
    setCards(DEGEN_POOLS.map(emptyCard));
  }, [wallet.address]);

  useEffect(() => {
    let disposed = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      if (disposed) return;
      if (pageActive && !document.hidden) await loadWalletBal();
      if (!disposed) timer = setTimeout(() => void poll(), 60_000);
    };
    void poll();
    return () => { disposed = true; sequence.current++; clearTimeout(timer); };
  }, [loadWalletBal, pageActive]);

  async function deployMiner(index: number) {
    if (active.current) return;
    const pool = DEGEN_POOLS[index];
    const card = cards[index];
    if (!wallet.address || !pool) {
      setStatus(index, "Connect wallet first", "err");
      return;
    }
    active.current = true;
    setBusy(true);
    try {
      const amount = parseEther(card.amount.trim());
      if (amount <= 0n) throw new Error("Enter a positive DEGEN amount.");
      const recipient = card.dest === "gift" ? card.giftAddr.trim() : wallet.address;
      if (!isAddress(recipient) || recipient === ZeroAddress) throw new Error("Enter a valid recipient address.");
      if (!/^\d+$/.test(card.mandatory || "0")) throw new Error("Mandatory service must be whole days.");
      const mandatory = BigInt(card.mandatory || "0") * 86400n;
      const signer = await wallet.getSigner();
      const account = await signer.getAddress();
      const tok = new Contract(CONTRACTS.degen, ERC20_ABI, signer);
      const [balance, allowance] = await Promise.all([tok.balanceOf(account), tok.allowance(account, pool.addr)]);
      if (amount > balance) throw new Error("Amount exceeds your current DEGEN balance.");
      if (allowance < amount) {
        await tok.approve.staticCall(pool.addr, amount);
        const approval = await tok.approve(pool.addr, amount);
        await confirmTransaction(approval);
      }
      const currentSigner = await wallet.getSigner();
      if ((await currentSigner.getAddress()).toLowerCase() !== account.toLowerCase()) throw new Error("Wallet changed. Choose the action again.");
      const poolContract = new Contract(pool.addr, POOL_DEPOSIT_ABI, currentSigner);
      const currentBalance: bigint = await tok.balanceOf(account);
      if (currentBalance < amount || await tok.allowance(account, pool.addr) < amount) throw new Error("Balance or allowance changed. Check the amount.");
      let tx;
      if (card.dest === "gift") {
        await poolContract.giftDeposit.staticCall(amount, recipient, mandatory);
        tx = await poolContract.giftDeposit(amount, recipient, mandatory);
      } else {
        await poolContract.deposit.staticCall(amount);
        tx = await poolContract.deposit(amount);
      }
      await confirmTransaction(tx);
      setStatus(index, card.dest === "gift" ? "Miner gifted." : "Miner deployed.", "ok");
      patchCard(index, { amount: "" });
      await loadWalletBal();
    } catch (error) {
      setStatus(index, readableError(error), "err");
    } finally {
      active.current = false;
      setBusy(false);
    }
  }

  return (
    <main className="legacy-main">
      <div style={{ padding: 28 }}>
        <div style={{ marginBottom: 22 }}>
          <div
            style={{
              fontFamily: "'Barlow Condensed',sans-serif",
              fontSize: "1.5rem",
              fontWeight: 800,
              letterSpacing: 2,
              textTransform: "uppercase",
              color: "var(--fg)",
            }}
          >
            Deploy Miner
          </div>
          <div
            style={{
              fontSize: "0.58rem",
              opacity: 0.4,
              letterSpacing: 1.5,
              marginTop: 4,
            }}
          >
            Stake DEGEN into a time-locked pool to earn rewards
          </div>
        </div>
        <div className="deploy-pools-grid">
          {DEGEN_POOLS.map((pool, index) => {
            const card = cards[index];
            const apy = "Earn DEGEN";
            return (
              <div
                key={pool.addr}
                ref={element => { if (element) deploymentCards.current.set(pool.addr, element); else deploymentCards.current.delete(pool.addr); }}
                className="deploy-pool-card"
                role="group"
                aria-label={`${pool.label} DEGEN miner deployment`}
                tabIndex={-1}
                style={{ "--deploy-color": "var(--red)", scrollMarginTop: 116 } as CSSProperties}
              >
                <div className="deploy-dur">{pool.label} Miner</div>
                <div
                  style={{
                    fontSize: "0.62rem",
                    opacity: 0.45,
                    marginBottom: 14,
                    letterSpacing: 0.5,
                  }}
                >
                  Mining using DEGEN tokens
                </div>
                <div className="deploy-apy-badge">{apy}</div>
                <div className="deploy-wallet-bal">
                  Wallet: {walletBal === null ? "—" : fmtMinerAmt(Number(formatEther(walletBal)))} DEGEN
                </div>
                <div className="deploy-divider" />
                <div className="deploy-input-row">
                  <input
                    className="deploy-input"
                    type="number"
                    min="0"
                    step="any"
                    placeholder="0.00"
                    value={card.amount}
                    onChange={(event) =>
                      patchCard(index, { amount: event.target.value })
                    }
                  />
                  <button
                    className="deploy-max"
                    disabled={walletBal === null || busy}
                    onClick={() =>
                      patchCard(index, {
                        amount: walletBal === null ? "" : formatEther(walletBal),
                      })
                    }
                  >
                    MAX
                  </button>
                </div>
                <div style={{ width: "100%", marginBottom: 10 }}>
                  <div
                    style={{
                      fontSize: "0.6rem",
                      opacity: 0.45,
                      letterSpacing: 0.5,
                      marginBottom: 5,
                      textAlign: "left",
                    }}
                  >
                    Create Miner To:
                  </div>
                  <select
                    className="deploy-input"
                    style={{ cursor: "pointer", padding: "10px 13px" }}
                    value={card.dest}
                    onChange={(event) =>
                      patchCard(index, {
                        dest: event.target.value as CardState["dest"],
                      })
                    }
                  >
                    <option value="self">Your Wallet</option>
                    <option value="gift">Another Wallet (Gift)</option>
                  </select>
                </div>
                {card.dest === "gift" && (
                  <div style={{ width: "100%", marginBottom: 10 }}>
                    <input
                      className="deploy-input"
                      placeholder="Recipient wallet address"
                      style={{
                        width: "100%",
                        marginBottom: 8,
                        textAlign: "left",
                      }}
                      value={card.giftAddr}
                      onChange={(event) =>
                        patchCard(index, { giftAddr: event.target.value })
                      }
                    />
                    <div
                      style={{
                        fontSize: "0.6rem",
                        opacity: 0.45,
                        letterSpacing: 0.5,
                        marginBottom: 5,
                        textAlign: "left",
                      }}
                    >
                      Mandatory Serve (Days):
                    </div>
                    <input
                      className="deploy-input"
                      type="number"
                      min="0"
                      style={{ width: "100%", textAlign: "left" }}
                      value={card.mandatory}
                      onChange={(event) =>
                        patchCard(index, { mandatory: event.target.value })
                      }
                    />
                    <div
                      style={{
                        fontSize: "0.55rem",
                        opacity: 0.35,
                        marginTop: 6,
                        lineHeight: 1.4,
                        textAlign: "left",
                      }}
                    >
                      Mandatory Serve is an optional period of days during
                      which stake can not be withdrawn under any circumstances
                      (no emergency end possible).
                    </div>
                  </div>
                )}
                <p className="miner-form-estimate">Miner deposit: {card.amount || "—"} DEGEN</p>
                <button
                  className="deploy-btn"
                  disabled={busy}
                  onClick={() => void deployMiner(index)}
                >
                  Deploy Miner
                </button>
                <div
                  className={`deploy-card-status${card.status.cls ? " " + card.status.cls : ""}`}
                >
                  {card.status.text}
                </div>
              </div>
            );
          })}
        </div>
        <div
          style={{
            fontSize: "0.6rem",
            opacity: 0.4,
            marginTop: 12,
            minHeight: 16,
          }}
        />
      </div>
    </main>
  );
}
