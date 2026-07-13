// Miners tab (Deploy Miner) — markup and styling restored verbatim from the
// original single-file site (commit 825e9f2). Logic mirrors
// loadDeployMinerTab / renderDeployGrid / deployMiner from the original.
import { Contract, MaxUint256, formatEther, isAddress, parseEther } from "ethers";
import type { CSSProperties } from "react";
import { useCallback, useEffect, useState } from "react";
import { CONTRACTS, ERC20_ABI, POOL_DEPOSIT_ABI } from "../config/contracts";
import type { WalletState } from "../hooks/useWallet";
import { getPublicProvider } from "../lib/chain";

const DEGEN_POOLS = [
  { label: "1 Month", addr: "0xD9B491ac0f5487673500B67224b67b4171a08aCa" },
  { label: "3 Month", addr: "0x7ED33f65A0398cb26eaB2B03877825c96D9B6077" },
  { label: "1 Year", addr: "0x3d175C8359169b0e830d36EA9CD3FE209f46f7BD" },
  { label: "10 Year", addr: "0xdE672FccA32365bD704c39bd1164a0D34a3a73e6" },
];

const DEGEN_POOL_APY: Record<string, string> = {
  "0xdE672FccA32365bD704c39bd1164a0D34a3a73e6": "Est. 31% APY",
  "0x3d175C8359169b0e830d36EA9CD3FE209f46f7BD": "Est. 14% APY",
  "0x7ED33f65A0398cb26eaB2B03877825c96D9B6077": "Est. 10% APY",
  "0xD9B491ac0f5487673500B67224b67b4171a08aCa": "Est. 7% APY",
};

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

export function MinersPage({ wallet }: { wallet: WalletState }) {
  const [walletBal, setWalletBal] = useState(0);
  const [cards, setCards] = useState<CardState[]>(() =>
    DEGEN_POOLS.map(emptyCard),
  );

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
      setWalletBal(0);
      return;
    }
    try {
      const provider = await getPublicProvider();
      const degenTok = new Contract(CONTRACTS.degen, ERC20_ABI, provider);
      const bal: bigint = await degenTok
        .balanceOf(wallet.address)
        .catch(() => 0n);
      setWalletBal(parseFloat(formatEther(bal)));
    } catch {
      /* keep previous balance */
    }
  }, [wallet.address]);

  useEffect(() => {
    void loadWalletBal();
  }, [loadWalletBal]);

  async function deployMiner(index: number) {
    const pool = DEGEN_POOLS[index];
    const card = cards[index];
    if (!wallet.address) {
      setStatus(index, "Connect wallet first", "err");
      return;
    }
    const amount = parseFloat(card.amount);
    if (!amount || amount <= 0) {
      setStatus(index, "Enter an amount", "err");
      return;
    }
    const isGift = card.dest === "gift";
    const giftAddr = card.giftAddr.trim();
    const mandatory = parseInt(card.mandatory || "0", 10);
    if (isGift && (!giftAddr || !isAddress(giftAddr))) {
      setStatus(index, "Enter a valid recipient address", "err");
      return;
    }
    try {
      const signer = await wallet.getSigner();
      const amtBN = parseEther(String(amount));
      const tok = new Contract(CONTRACTS.degen, ERC20_ABI, signer);
      const allowance: bigint = await tok.allowance(wallet.address, pool.addr);
      if (allowance < amtBN) {
        setStatus(index, "Approve token — check wallet…", "active");
        const appTx = await tok.approve(pool.addr, MaxUint256);
        setStatus(index, "Approval confirming…", "active");
        await appTx.wait();
      }
      setStatus(index, "Confirm deposit in wallet…", "active");
      const poolContract = new Contract(pool.addr, POOL_DEPOSIT_ABI, signer);
      const tx = isGift
        ? await poolContract.giftDeposit(
            amtBN,
            giftAddr,
            BigInt(Math.max(0, mandatory)) * 86400n,
          )
        : await poolContract.deposit(amtBN);
      setStatus(index, "Tx submitted — confirming…", "active");
      await tx.wait();
      setStatus(index, isGift ? "Miner gifted!" : "Miner deployed!", "ok");
      patchCard(index, { amount: "" });
      void loadWalletBal();
    } catch (e) {
      const err = e as { reason?: string; message?: string };
      setStatus(
        index,
        err.reason || (err.message || "Error").slice(0, 70),
        "err",
      );
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
            const apy = DEGEN_POOL_APY[pool.addr] || "Earn DEGEN";
            return (
              <div
                key={pool.addr}
                className="deploy-pool-card"
                style={{ "--deploy-color": "var(--red)" } as CSSProperties}
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
                  Wallet: {fmtMinerAmt(walletBal)} DEGEN
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
                    onClick={() =>
                      patchCard(index, {
                        amount:
                          walletBal > 0
                            ? walletBal.toFixed(6).replace(/\.?0+$/, "")
                            : "",
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
                <button
                  className="deploy-btn"
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
