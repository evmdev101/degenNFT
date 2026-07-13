import {
  Contract,
  MaxUint256,
  formatEther,
  isAddress,
  parseEther,
} from "ethers";
import { useCallback, useEffect, useState } from "react";
import { CONTRACTS, ERC20_ABI, POOL_DEPOSIT_ABI } from "../config/contracts";
import type { WalletState } from "../hooks/useWallet";
import { getPublicProvider, readableError } from "../lib/chain";
import { SETTINGS_POOLS } from "./nft/options";

type Form = { amount: string; gift: boolean; recipient: string; days: string };
const EMPTY: Form = { amount: "", gift: false, recipient: "", days: "0" };
const APY: Record<string, string> = {
  "0xde672fcca32365bd704c39bd1164a0d34a3a73e6": "Est. 31% APY",
  "0x3d175c8359169b0e830d36ea9cd3fe209f46f7bd": "Est. 14% APY",
  "0x7ed33f65a0398cb26eab2b03877825c96d9b6077": "Est. 10% APY",
  "0xd9b491ac0f5487673500b67224b67b4171a08aca": "Est. 7% APY",
};
const fmt = (value: bigint) =>
  Number(formatEther(value)).toLocaleString(undefined, {
    maximumFractionDigits: 6,
  });

export function MinersPage({ wallet }: { wallet: WalletState }) {
  const [balance, setBalance] = useState(0n),
    [forms, setForms] = useState<Record<string, Form>>({}),
    [statuses, setStatuses] = useState<Record<string, string>>({}),
    [busy, setBusy] = useState("");
  const load = useCallback(async () => {
    if (!wallet.address) {
      setBalance(0n);
      return;
    }
    try {
      const provider = await getPublicProvider();
      setBalance(
        await new Contract(CONTRACTS.degen, ERC20_ABI, provider).balanceOf(
          wallet.address,
        ),
      );
    } catch (error) {
      setStatuses({ page: readableError(error) });
    }
  }, [wallet.address]);
  useEffect(() => {
    void load();
  }, [load]);
  const form = (address: string) => forms[address] || EMPTY;
  const update = (address: string, patch: Partial<Form>) =>
    setForms((current) => ({
      ...current,
      [address]: { ...form(address), ...patch },
    }));
  const deploy = async (pool: string) => {
    if (!wallet.address) {
      await wallet.connect();
      return;
    }
    const values = form(pool);
    try {
      setBusy(pool);
      setStatuses((s) => ({ ...s, [pool]: "Preparing miner deployment…" }));
      const raw = parseEther(values.amount);
      if (raw <= 0n) throw new Error("Enter an amount");
      if (raw > balance) throw new Error("Not enough DEGEN in this wallet");
      if (values.gift && !isAddress(values.recipient))
        throw new Error("Enter a valid recipient address");
      const signer = await wallet.getSigner();
      const token = new Contract(CONTRACTS.degen, ERC20_ABI, signer);
      if ((await token.allowance(wallet.address, pool)) < raw) {
        setStatuses((s) => ({ ...s, [pool]: "Approve DEGEN — check wallet…" }));
        await (await token.approve(pool, MaxUint256)).wait();
      }
      setStatuses((s) => ({ ...s, [pool]: "Confirm deposit in wallet…" }));
      const contract = new Contract(pool, POOL_DEPOSIT_ABI, signer);
      const tx = values.gift
        ? await contract.giftDeposit(
            raw,
            values.recipient,
            BigInt(Math.max(0, Number(values.days) || 0)) * 86400n,
          )
        : await contract.deposit(raw);
      setStatuses((s) => ({
        ...s,
        [pool]: "Transaction submitted — confirming…",
      }));
      await tx.wait();
      setStatuses((s) => ({
        ...s,
        [pool]: values.gift ? "Miner gifted!" : "Miner deployed!",
      }));
      update(pool, { amount: "" });
      await load();
    } catch (error) {
      setStatuses((s) => ({ ...s, [pool]: readableError(error) }));
    } finally {
      setBusy("");
    }
  };
  return (
    <main className="legacy-section deploy-section">
      <header className="legacy-section-heading">
        <h1>Deploy Miner</h1>
        <p>Stake DEGEN into a time-locked pool to earn rewards</p>
      </header>
      {statuses.page && (
        <div className="panel-message error">{statuses.page}</div>
      )}
      <div className="deploy-pools-grid">
        {SETTINGS_POOLS.DEGEN.map((pool) => {
          const values = form(pool.address);
          return (
            <article className="deploy-pool-card" key={pool.address}>
              <div className="deploy-dur">
                {pool.label.replace(" (default)", "")} Miner
              </div>
              <div className="deploy-copy">Mining using DEGEN tokens</div>
              <div className="deploy-apy-badge">
                {APY[pool.address.toLowerCase()] || "Earn DEGEN"}
              </div>
              <div className="deploy-wallet-bal">
                Wallet: {fmt(balance)} DEGEN
              </div>
              <div className="deploy-divider" />
              <div className="deploy-input-row">
                <input
                  value={values.amount}
                  inputMode="decimal"
                  placeholder="0.00"
                  onChange={(e) =>
                    update(pool.address, { amount: e.target.value })
                  }
                />
                <button
                  onClick={() =>
                    update(pool.address, { amount: formatEther(balance) })
                  }
                >
                  MAX
                </button>
              </div>
              <label className="deploy-label">
                Create Miner To:
                <select
                  value={values.gift ? "gift" : "self"}
                  onChange={(e) =>
                    update(pool.address, { gift: e.target.value === "gift" })
                  }
                >
                  <option value="self">Your Wallet</option>
                  <option value="gift">Another Wallet (Gift)</option>
                </select>
              </label>
              {values.gift && (
                <div className="deploy-gift">
                  <input
                    placeholder="Recipient wallet address"
                    value={values.recipient}
                    onChange={(e) =>
                      update(pool.address, { recipient: e.target.value })
                    }
                  />
                  <label>
                    Mandatory Serve (Days):
                    <input
                      type="number"
                      min="0"
                      value={values.days}
                      onChange={(e) =>
                        update(pool.address, { days: e.target.value })
                      }
                    />
                  </label>
                  <small>
                    Optional period during which this miner cannot be withdrawn.
                  </small>
                </div>
              )}
              <button
                className="deploy-btn"
                disabled={busy === pool.address}
                onClick={() => void deploy(pool.address)}
              >
                {wallet.isConnected
                  ? busy === pool.address
                    ? "PLEASE WAIT…"
                    : "DEPLOY MINER"
                  : "CONNECT WALLET"}
              </button>
              <div className="deploy-card-status">{statuses[pool.address]}</div>
            </article>
          );
        })}
      </div>
    </main>
  );
}
