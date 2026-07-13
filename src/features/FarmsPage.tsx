import {
  Contract,
  MaxUint256,
  ZeroAddress,
  formatUnits,
  parseUnits,
} from "ethers";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  DEGEN_FARM_VAULT_ABI,
  DEGEN_REWARDS_ABI,
  DEGEN_REWARDS_HELPER,
  ERC20_ABI,
} from "../config/contracts";
import type { WalletState } from "../hooks/useWallet";
import { getPublicProvider, readableError } from "../lib/chain";
import { HARVEST_DESTINATIONS } from "./nft/options";

type Farm = {
  name: string;
  symbol: string;
  vault: string;
  token: string;
  decimals: number;
  poolId: number;
  wallet: bigint;
  stakes: number;
  staked: bigint;
  pending: bigint;
  stakeIds: number[];
  claimIds: number[];
  apr: number | null;
  tvlUsd: number | null;
};
type Meta = {
  vaultContract: string;
  tokenContract?: string;
  symbol: string;
  name: string;
  decimals?: number;
  poolId?: number;
  notStakeable?: boolean;
};
type Stats = { poolId: number; apr: number; valueOfTVAL: number | null };
const DATA =
  "https://raw.githubusercontent.com/DegenStrategy/DEGEN/refs/heads/main/vaultData.json";
const STATS = "https://api.oink-pls.com/api2/vaultDataOutput.json";
const fmt = (value: bigint, decimals = 18) =>
  Number(formatUnits(value, decimals)).toLocaleString(undefined, {
    maximumFractionDigits: 4,
  });

export function FarmsPage({ wallet }: { wallet: WalletState }) {
  const [farms, setFarms] = useState<Farm[]>([]),
    [loading, setLoading] = useState(false),
    [search, setSearch] = useState(""),
    [status, setStatus] = useState("");
  const load = useCallback(async () => {
    if (!wallet.address) {
      setFarms([]);
      return;
    }
    setLoading(true);
    setStatus("");
    try {
      const provider = await getPublicProvider();
      const [metaResponse, statsResponse] = await Promise.all([
        fetch(DATA),
        fetch(STATS).catch(() => null),
      ]);
      const metadata = (await metaResponse.json()) as Meta[];
      const details = statsResponse?.ok
        ? ((await statsResponse.json()) as { vaultDetails?: Stats[] })
            .vaultDetails || []
        : [];
      const stats = new Map(details.map((item) => [item.poolId, item]));
      const definitions = metadata.filter(
        (item) =>
          !item.notStakeable && item.tokenContract && item.poolId !== undefined,
      );
      const rows = await Promise.all(
        definitions.map(async (item) => {
          const vault = new Contract(
            item.vaultContract,
            DEGEN_FARM_VAULT_ABI,
            provider,
          );
          const token = new Contract(item.tokenContract!, ERC20_ABI, provider);
          const [countRaw, walletRaw] = await Promise.all([
            vault.getNrOfStakes(wallet.address).catch(() => 0n),
            token.balanceOf(wallet.address).catch(() => 0n),
          ]);
          const stakes = Number(countRaw);
          let staked = 0n,
            pending = 0n;
          const stakeIds: number[] = [],
            claimIds: number[] = [];
          for (let id = 0; id < stakes; id++) {
            try {
              const [info, earnings] = await Promise.all([
                vault.userInfo(wallet.address, id),
                vault.viewStakeEarnings(wallet.address, id).catch(() => 0n),
              ]);
              const amount = BigInt(info.amount),
                earned = BigInt(earnings);
              if (amount > 0n) {
                stakeIds.push(id);
                staked += amount;
              }
              if (earned > 0n) {
                claimIds.push(id);
                pending += earned;
              }
            } catch {}
          }
          const official = stats.get(item.poolId!);
          return {
            name: item.name,
            symbol: item.symbol,
            vault: item.vaultContract,
            token: item.tokenContract!,
            decimals: item.decimals || 18,
            poolId: item.poolId!,
            wallet: BigInt(walletRaw),
            stakes,
            staked,
            pending,
            stakeIds,
            claimIds,
            apr: official?.apr ?? null,
            tvlUsd: official?.valueOfTVAL ?? null,
          };
        }),
      );
      setFarms(rows);
    } catch (error) {
      setStatus(readableError(error));
    } finally {
      setLoading(false);
    }
  }, [wallet.address]);
  useEffect(() => {
    void load();
  }, [load]);
  const visible = useMemo(
    () =>
      farms.filter((farm) =>
        `${farm.name} ${farm.symbol}`
          .toLowerCase()
          .includes(search.toLowerCase()),
      ),
    [farms, search],
  );
  if (!wallet.isConnected)
    return (
      <main className="legacy-section">
        <section className="rw-miners-section empty-state">
          <h2>Farms</h2>
          <p>Connect your wallet to view farms</p>
          <button className="mint-button" onClick={() => void wallet.connect()}>
            Connect Wallet
          </button>
        </section>
      </main>
    );
  const ranked = [...farms]
    .filter((f) => f.apr !== null)
    .sort((a, b) => (b.apr || 0) - (a.apr || 0))
    .slice(0, 3);
  return (
    <main className="legacy-section">
      <section className="rw-miners-section">
        <header className="farms-header">
          <div>
            <h1>DEGEN Farms</h1>
            <p>Stake supported assets to mine DEGEN rewards</p>
          </div>
          <input
            placeholder="Search farms"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </header>
        {status && <div className="panel-message error">{status}</div>}
        {ranked.length > 0 && (
          <div className="farm-highlights">
            {ranked.map((farm, index) => (
              <article key={farm.vault}>
                <span>#{index + 1} Highest APR</span>
                <b>{farm.symbol}</b>
                <strong>{farm.apr?.toLocaleString()}%</strong>
              </article>
            ))}
          </div>
        )}
        <div className="browse-farms-grid">
          {loading ? (
            <div className="rw-miners-loading">Loading DEGEN farms…</div>
          ) : (
            visible.map((farm) => (
              <FarmCard
                key={farm.vault}
                farm={farm}
                wallet={wallet}
                reload={load}
              />
            ))
          )}
          {!loading && !visible.length && (
            <div className="rw-miners-loading">No DEGEN farms found.</div>
          )}
        </div>
      </section>
    </main>
  );
}

function FarmCard({
  farm,
  wallet,
  reload,
}: {
  farm: Farm;
  wallet: WalletState;
  reload: () => Promise<void>;
}) {
  const [amount, setAmount] = useState(""),
    [status, setStatus] = useState(""),
    [busy, setBusy] = useState(false);
  const act = async (type: "stake" | "claim" | "withdraw") => {
    try {
      setBusy(true);
      const signer = await wallet.getSigner();
      const vault = new Contract(farm.vault, DEGEN_FARM_VAULT_ABI, signer);
      let tx;
      if (type === "stake") {
        const raw = parseUnits(amount, farm.decimals);
        if (raw <= 0n || raw > farm.wallet)
          throw new Error("Enter an amount within your wallet balance");
        const token = new Contract(farm.token, ERC20_ABI, signer);
        if ((await token.allowance(wallet.address, farm.vault)) < raw) {
          setStatus("Approve LP token — check wallet…");
          await (await token.approve(farm.vault, MaxUint256)).wait();
        }
        setStatus("Confirm stake in wallet…");
        tx = await vault.deposit(raw, ZeroAddress);
      } else if (type === "withdraw") {
        if (!farm.stakeIds.length)
          throw new Error("No active stake to withdraw");
        for (const id of [...farm.stakeIds].reverse()) {
          setStatus(`Confirm withdrawal of stake #${id}…`);
          tx = await vault.withdraw(id);
          await tx.wait();
        }
        setStatus("All stakes withdrawn");
        await reload();
        return;
      } else {
        if (!farm.claimIds.length || farm.pending <= 0n)
          throw new Error("No DEGEN to claim");
        setStatus("Confirm reward claim in wallet…");
        const helper = new Contract(
          DEGEN_REWARDS_HELPER,
          DEGEN_REWARDS_ABI,
          signer,
        );
        tx = await helper.claimWithHarvest(
          [farm.vault],
          wallet.address,
          [farm.claimIds.map(BigInt)],
          farm.pending,
          HARVEST_DESTINATIONS.DEGEN[0].address!,
        );
      }
      setStatus("Transaction submitted — confirming…");
      await tx.wait();
      setStatus(type === "stake" ? "Staked!" : "Claimed!");
      setAmount("");
      await reload();
    } catch (error) {
      setStatus(readableError(error));
    } finally {
      setBusy(false);
    }
  };
  return (
    <article className="browse-farm-card">
      <header>
        <div className="farm-token-orb">{farm.symbol.slice(0, 4)}</div>
        <div>
          <h2>{farm.name}</h2>
          <span>Earn DEGEN</span>
        </div>
        <a
          href={`https://scan.pulsechain.com/address/${farm.vault}`}
          target="_blank"
          rel="noreferrer"
        >
          ↗
        </a>
      </header>
      <div className="farm-card-metrics">
        <div>
          <span>APR</span>
          <b>{farm.apr === null ? "—" : `${farm.apr.toLocaleString()}%`}</b>
        </div>
        <div>
          <span>TVL</span>
          <b>
            {farm.tvlUsd === null
              ? "—"
              : `$${farm.tvlUsd.toLocaleString(undefined, { maximumFractionDigits: 2 })}`}
          </b>
        </div>
        <div>
          <span>Wallet</span>
          <b>{fmt(farm.wallet, farm.decimals)}</b>
        </div>
        <div>
          <span>Staked</span>
          <b>{fmt(farm.staked, farm.decimals)}</b>
        </div>
        <div>
          <span>Rewards</span>
          <b>{fmt(farm.pending)} DEGEN</b>
        </div>
      </div>
      <div className="farm-input">
        <input
          value={amount}
          placeholder="0.00"
          onChange={(e) => setAmount(e.target.value)}
        />
        <button
          onClick={() => setAmount(formatUnits(farm.wallet, farm.decimals))}
        >
          MAX
        </button>
      </div>
      <div className="farm-actions">
        <button disabled={busy} onClick={() => void act("stake")}>
          Stake
        </button>
        <button
          disabled={busy || farm.pending === 0n}
          onClick={() => void act("claim")}
        >
          Claim
        </button>
        <button
          className="danger"
          disabled={busy || farm.stakes === 0}
          onClick={() => void act("withdraw")}
        >
          Withdraw
        </button>
      </div>
      {status && <div className="transaction-status">{status}</div>}
    </article>
  );
}
