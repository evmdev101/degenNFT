import { useQuery } from "@tanstack/react-query";
import { Contract, EventLog, ZeroAddress, formatEther } from "ethers";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import type { WalletState } from "../../hooks/useWallet";
import {
  CONTRACTS,
  MINT_ABI,
  NFT_ABI,
  NFT_REWARDS_ABI,
  NFT_TOKEN_ID,
} from "../../config/contracts";
import {
  fetchTokenMetadata,
  getPublicContracts,
  readableError,
  shortAddress,
  toGatewayUrl,
} from "../../lib/chain";
import { RewardsActions } from "./RewardsActions";
import { CashxArtwork } from "./CashxArtwork";

type NftTab = "mint" | "rewards" | "calculator" | "holders" | "activity";
type Holder = { address: string; value: number };
type MintEvent = {
  address: string;
  quantity: number;
  blockNumber: number;
  transactionHash: string;
  timestamp?: number;
};

type MinerData = {
  loading: boolean;
  error: string;
  price: bigint;
  active: number;
  minted: number | null;
  burned: number | null;
  image: string;
  name: string;
  description: string;
  traits: number;
  events: MintEvent[];
  holders: Holder[];
  walletBalance: bigint;
  pendingOink: bigint;
  pendingDegen: bigint;
  perNftOinkSecond: bigint;
  perNftDegenSecond: bigint;
};

const initialData: MinerData = {
  loading: true,
  error: "",
  price: 0n,
  active: 0,
  minted: null,
  burned: null,
  image: "",
  name: "DegenStrategy NFT Miner",
  description: "NFT Miner used to accrue OINK and DEGEN mining rewards",
  traits: 0,
  events: [],
  holders: [],
  walletBalance: 0n,
  pendingOink: 0n,
  pendingDegen: 0n,
  perNftOinkSecond: 0n,
  perNftDegenSecond: 0n,
};

async function loadMinerData(address: string | null): Promise<MinerData> {
  try {
    const { nft, mint, provider } = await getPublicContracts();
    const [price, active, rawUri] = await Promise.all([
      mint.nftPrice() as Promise<bigint>,
      nft.totalNFTs() as Promise<bigint>,
      nft.uri(NFT_TOKEN_ID) as Promise<string>,
    ]);
    const metadata = await fetchTokenMetadata(
      rawUri.replace("{id}", NFT_TOKEN_ID.toString(16).padStart(64, "0")),
    );
    const image = toGatewayUrl(metadata.image || "");

      let events: MintEvent[] = [];
      let holders: Holder[] = [];
      let minted: number | null = null;
      let burned: number | null = null;
      try {
        const transferLogs = await nft.queryFilter(
          nft.filters.TransferSingle(null, null, null),
        );
        const matchingTransfers = transferLogs.filter(
          (log) =>
            log instanceof EventLog && BigInt(log.args.id) === NFT_TOKEN_ID,
        ) as EventLog[];
        const matchingMints = matchingTransfers.filter(
          (log) =>
            String(log.args.from).toLowerCase() === ZeroAddress.toLowerCase(),
        );
        const matchingBurns = matchingTransfers.filter(
          (log) =>
            String(log.args.to).toLowerCase() === ZeroAddress.toLowerCase(),
        );
        minted = matchingMints.reduce(
          (sum, log) => sum + Number(log.args.value),
          0,
        );
        burned = matchingBurns.reduce(
          (sum, log) => sum + Number(log.args.value),
          0,
        );
        events = matchingMints
          .map((log) => ({
            address: String(log.args.to),
            quantity: Number(log.args.value),
            blockNumber: log.blockNumber,
            transactionHash: log.transactionHash,
          }))
          .sort((a, b) => b.blockNumber - a.blockNumber)
          .slice(0, 50);
        const timedEvents = await Promise.all(
          events.slice(0, 25).map(async (event) => {
            try {
              const block = await provider.getBlock(event.blockNumber);
              return {
                ...event,
                timestamp: block ? Number(block.timestamp) : undefined,
              };
            } catch {
              return event;
            }
          }),
        );
        events = [...timedEvents, ...events.slice(25)];

        const balances = new Map<string, number>();
        for (const log of matchingTransfers) {
          const from = String(log.args.from).toLowerCase();
          const to = String(log.args.to).toLowerCase();
          const value = Number(log.args.value);
          if (from !== ZeroAddress.toLowerCase())
            balances.set(from, (balances.get(from) || 0) - value);
          if (to !== ZeroAddress.toLowerCase())
            balances.set(to, (balances.get(to) || 0) + value);
        }
        holders = [...balances.entries()]
          .filter(([, value]) => value > 0)
          .map(([holderAddress, value]) => ({
            address: holderAddress,
            value,
          }))
          .sort((a, b) => b.value - a.value);
      } catch (eventError) {
        console.warn("Event history unavailable:", eventError);
      }

      if (!holders.length) {
        try {
          const response = await fetch(
            `https://api.scan.pulsechain.com/api?module=token&action=getTokenHolders&contractaddress=${CONTRACTS.nft}&offset=200&page=1`,
          );
          const payload = (await response.json()) as {
            result?: Array<{ address?: string; value?: string }>;
          };
          holders = (payload.result || [])
            .map((item) => ({
              address: String(item.address || ""),
              value: Number(item.value || 0),
            }))
            .filter(
              (item) =>
                /^0x[0-9a-f]{40}$/i.test(item.address) && item.value > 0,
            )
            .sort((a, b) => b.value - a.value);
        } catch (holderError) {
          console.warn("Holder index unavailable:", holderError);
        }
      }

      let walletBalance = 0n,
        pendingOink = 0n,
        pendingDegen = 0n,
        perNftOinkSecond = 0n,
        perNftDegenSecond = 0n;
      if (address) {
        walletBalance = (await nft.balanceOf(address, NFT_TOKEN_ID)) as bigint;
        const pending = (await nft.viewUserTotalEarnings(address)) as [
          bigint,
          bigint,
        ];
        pendingOink = pending[0];
        pendingDegen = pending[1];
      }
      const rateAddress = address || events[0]?.address;
      if (rateAddress) {
        try {
          const rateBalance = (await nft.balanceOf(
            rateAddress,
            NFT_TOKEN_ID,
          )) as bigint;
          if (rateBalance > 0n) {
            const rewards = new Contract(
              CONTRACTS.rewards,
              NFT_REWARDS_ABI,
              provider,
            );
            const rates = await rewards.getEarnings(rateAddress);
            perNftOinkSecond = BigInt(rates.oinkRate) / 3n / rateBalance;
            perNftDegenSecond = BigInt(rates.degenRate) / 3n / rateBalance;
          }
        } catch (rateError) {
          console.warn("Reward rates unavailable:", rateError);
        }
      }
    return {
      loading: false,
      error: "",
      price,
      active: Number(active),
      minted,
      burned,
      image,
      name: metadata.name || initialData.name,
      description: metadata.description || initialData.description,
      traits: metadata.attributes?.length || 0,
      events,
      holders,
      walletBalance,
      pendingOink,
      pendingDegen,
      perNftOinkSecond,
      perNftDegenSecond,
    };
  } catch (error) {
    throw new Error(readableError(error), { cause: error });
  }
}

function useMinerData(address: string | null) {
  const query = useQuery({
    queryKey: ["nft-miner-data", address ?? "guest"],
    queryFn: () => loadMinerData(address),
    refetchInterval: 60_000,
  });

  const data = query.data
    ? {
        ...query.data,
        loading: query.isPending,
        error: query.error ? readableError(query.error) : "",
      }
    : {
        ...initialData,
        loading: query.isPending,
        error: query.error ? readableError(query.error) : "",
      };

  const reload = useCallback(async () => {
    await query.refetch();
  }, [query.refetch]);

  return { data, reload };
}

const formatPls = (value: bigint, digits = 2) =>
  Number(formatEther(value)).toLocaleString(undefined, {
    maximumFractionDigits: digits,
  });
const formatToken = (value: bigint) =>
  Number(formatEther(value)).toLocaleString(undefined, {
    maximumFractionDigits: 6,
  });
const APR_BLOCKS_PER_YEAR = 3_061_747;
const NFT_PRICE_USD = 50;
const OINK_PRICE_PAIR = "0xef9ea3d72e28c7140481209190601c085027d6fe";
const DEGEN_PRICE_PAIR = "0x3029aa801176f6904e2b6c7527334c215eaf1d8f";

async function fetchPairPrice(address: string) {
  const response = await fetch(
    `https://api.dexscreener.com/latest/dex/pairs/pulsechain/${address}`,
  );
  if (!response.ok) throw new Error("Live token prices are unavailable.");
  const payload = (await response.json()) as {
    pairs?: Array<{ priceUsd?: string; priceNative?: string }>;
  };
  return payload.pairs?.[0];
}

function useRewardsApr(oinkPerNftSecond: bigint, degenPerNftSecond: bigint) {
  const query = useQuery({
    queryKey: [
      "nft-rewards-apr",
      oinkPerNftSecond.toString(),
      degenPerNftSecond.toString(),
    ],
    enabled: oinkPerNftSecond > 0n || degenPerNftSecond > 0n,
    staleTime: 5 * 60 * 1_000,
    refetchInterval: 5 * 60 * 1_000,
    queryFn: async () => {
      const [oinkPair, degenPair] = await Promise.all([
        fetchPairPrice(OINK_PRICE_PAIR),
        fetchPairPrice(DEGEN_PRICE_PAIR),
      ]);
      const oinkUsd = Number(oinkPair?.priceUsd || 0);
      const degenUsd = Number(degenPair?.priceNative || 0) * oinkUsd;
      if (!(oinkUsd > 0) || !(degenUsd > 0))
        throw new Error("Live token prices are unavailable.");
      const rawOinkRate = oinkPerNftSecond * 3n;
      const rawDegenRate = degenPerNftSecond * 3n;
      const annualOink =
        Number(formatEther(rawOinkRate)) * APR_BLOCKS_PER_YEAR;
      const annualDegen =
        Number(formatEther(rawDegenRate)) * APR_BLOCKS_PER_YEAR;
      const annualUsd = annualOink * oinkUsd + annualDegen * degenUsd;
      return (annualUsd / NFT_PRICE_USD) * 100;
    },
  });
  return query.data && query.data > 0
    ? `${Math.round(query.data).toLocaleString()}%`
    : "—";
}

export function NftPage({ wallet }: { wallet: WalletState }) {
  const [tab, setTab] = useState<NftTab>("mint");
  const [quantity, setQuantity] = useState(1);
  const [cost, setCost] = useState(0n);
  const [txStatus, setTxStatus] = useState("");
  const [txPending, setTxPending] = useState(false);
  const { data, reload } = useMinerData(wallet.address);

  useEffect(() => {
    if (!data.price) return;
    let cancelled = false;
    void getPublicContracts()
      .then(
        ({ mint }) =>
          mint.priceWithDiscount(
            BigInt(quantity),
            data.price,
          ) as Promise<bigint>,
      )
      .then((value) => {
        if (!cancelled) setCost(value);
      })
      .catch(() => {
        if (!cancelled) setCost(data.price * BigInt(quantity));
      });
    return () => {
      cancelled = true;
    };
  }, [quantity, data.price]);

  const mint = async () => {
    if (!wallet.isConnected) {
      await wallet.connect();
      return;
    }
    setTxPending(true);
    setTxStatus("Waiting for wallet confirmation…");
    try {
      const signer = await wallet.getSigner();
      const contract = new Contract(CONTRACTS.mint, MINT_ABI, signer);
      const balance = await signer.provider.getBalance(
        await signer.getAddress(),
      );
      if (balance < cost)
        throw new Error(`Insufficient PLS. You need ${formatPls(cost)} PLS.`);
      const transaction = await contract.buyWithPLS(BigInt(quantity), {
        value: cost,
      });
      setTxStatus("Transaction submitted. Waiting for confirmation…");
      await transaction.wait();
      setTxStatus(
        `Success! Transaction ${transaction.hash.slice(0, 10)}… confirmed.`,
      );
      await reload();
    } catch (error) {
      setTxStatus(readableError(error));
    } finally {
      setTxPending(false);
    }
  };

  return (
    <main className="nft-page">
      <section className="overview-section">
        <h1>Mint Overview</h1>
        <div className="overview-grid">
          <Metric
            label="Price per NFT"
            value={data.price ? formatPls(data.price, 2) : "Loading…"}
            unit="PLS"
            note="Paid in native PLS"
          />
          <Metric
            label="Active Miners"
            value={data.active.toLocaleString()}
            unit="miners"
            note="Currently earning rewards"
          />
          <Metric
            label="Total Minted"
            value={data.minted?.toLocaleString() ?? "Indexing…"}
            unit="NFTs"
            note="All-time miners created"
          />
          <Metric
            label="Total Burned"
            value={data.burned?.toLocaleString() ?? "Indexing…"}
            unit="NFTs"
            note="Cashed out permanently"
          />
        </div>
      </section>

      <nav className="nft-tabs" aria-label="NFT sections">
        {(
          [
            ["mint", "Mint"],
            ["rewards", "My NFTs / Rewards"],
            ["calculator", "Yield Calculator"],
            ["holders", "Holders"],
            ["activity", "Activity"],
          ] as Array<[NftTab, string]>
        ).map(([key, label]) => (
          <button
            key={key}
            className={tab === key ? "active" : ""}
            onClick={() => setTab(key)}
          >
            {label}
          </button>
        ))}
      </nav>

      {data.error && <div className="panel-message error">{data.error}</div>}
      {tab === "mint" && (
        <MintPanel
          data={data}
          quantity={quantity}
          setQuantity={setQuantity}
          cost={cost}
          txPending={txPending}
          txStatus={txStatus}
          wallet={wallet}
          onMint={() => void mint()}
        />
      )}
      {tab === "rewards" && (
        <RewardsPanel data={data} wallet={wallet} reload={reload} />
      )}
      {tab === "calculator" && (
        <CalculatorPanel
          price={data.price}
          oinkRate={data.perNftOinkSecond}
          degenRate={data.perNftDegenSecond}
        />
      )}
      {tab === "holders" && (
        <HoldersPanel holders={data.holders} image={data.image} />
      )}
      {tab === "activity" && <ActivityPanel events={data.events} />}
    </main>
  );
}

function Metric({
  label,
  value,
  unit,
  note,
}: {
  label: string;
  value: string;
  unit?: string;
  note: string;
}) {
  return (
    <article className="metric-card">
      <span>{label}</span>
      <div className="metric-value-row">
        <strong className={value.length > 9 ? "is-long" : undefined}>
          {value}
        </strong>
        {unit && <em>{unit}</em>}
      </div>
      <small>{note}</small>
    </article>
  );
}

function relativeMintTime(timestamp?: number) {
  if (!timestamp) return "Recent";
  const seconds = Math.max(0, Math.floor(Date.now() / 1000) - timestamp);
  if (seconds < 3600) return `${Math.max(1, Math.floor(seconds / 60))}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  const days = Math.floor(seconds / 86400);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo ago`;
  return `${Math.floor(months / 12)}y ago`;
}

function MintPanel({
  data,
  quantity,
  setQuantity,
  cost,
  txPending,
  txStatus,
  wallet,
  onMint,
}: {
  data: MinerData;
  quantity: number;
  setQuantity: (value: number) => void;
  cost: bigint;
  txPending: boolean;
  txStatus: string;
  wallet: WalletState;
  onMint: () => void;
}) {
  const [contractCopied, setContractCopied] = useState(false);
  const full = data.price * BigInt(quantity),
    saved = full > cost ? full - cost : 0n;
  const activePercent = data.minted
    ? Math.min(100, (data.active / data.minted) * 100)
    : 0;
  const contractPreview = `${CONTRACTS.nft.slice(0, 10)}…${CONTRACTS.nft.slice(-8)}`;

  const copyNftContract = async () => {
    try {
      await navigator.clipboard.writeText(CONTRACTS.nft);
      setContractCopied(true);
      window.setTimeout(() => setContractCopied(false), 1600);
    } catch {
      setContractCopied(false);
    }
  };

  return (
    <section className="mint-layout-react">
      <div className="art-column">
        {data.image ? (
          <CashxArtwork imageUrl={data.image} />
        ) : (
          <div className="cashx-artwork-fallback">⛏</div>
        )}
      </div>
      <div className="purchase-column">
        <h2>Mint DegenStrategy NFT Miner</h2>
        <p>Earn auto-compounding OINK + DEGEN.</p>
        <div className="mint-progress">
          <div>
            <span>Active NFT miners</span>
            <strong>
              {data.active.toLocaleString()} /{" "}
              {data.minted?.toLocaleString() ?? "—"}
            </strong>
          </div>
          <div className="mint-progress-track">
            <span style={{ width: `${activePercent}%` }} />
          </div>
        </div>
        <section className="purchase-panel compact-purchase-panel">
          <div className="step-bar">
            <div className="step-item active">
              <span>1</span>
              <strong>Choose quantity</strong>
            </div>
            <span className="step-arrow">→</span>
            <div className="step-item">
              <span>2</span>
              <strong>Mint NFT</strong>
            </div>
          </div>
          <div className="compact-mint-row">
            <div className="compact-price">
              <strong>
                {data.price ? `${formatPls(data.price, 2)} PLS` : "—"}
              </strong>
              <small>
                Total · {cost ? `${formatPls(cost)} PLS` : "—"}
                {saved > 0n && ` · Save ${formatPls(saved)} PLS`}
              </small>
            </div>
            <div className="compact-mint-actions">
              <div className="stepper compact-stepper">
                <button
                  aria-label="Decrease quantity"
                  disabled={quantity <= 1}
                  onClick={() => setQuantity(Math.max(1, quantity - 1))}
                >
                  −
                </button>
                <strong>{quantity}</strong>
                <button
                  aria-label="Increase quantity"
                  disabled={quantity >= 999}
                  onClick={() => setQuantity(Math.min(999, quantity + 1))}
                >
                  +
                </button>
              </div>
              <button
                className="mint-button compact-mint-button"
                disabled={txPending || !cost}
                onClick={onMint}
              >
                {txPending
                  ? "Transaction pending"
                  : wallet.isConnected
                    ? `Mint ${quantity} NFT${quantity > 1 ? "s" : ""}`
                    : "Connect Wallet"}
              </button>
            </div>
          </div>
          {txStatus && <div className="transaction-status">{txStatus}</div>}
        </section>
        <section className="recent-mints">
          <div className="recent-mints-title">
            <h3>Live Mints</h3>
            <small>Updates automatically</small>
          </div>
          <div className="recent-mints-scroll">
            <div className="recent-mints-table">
              <div className="recent-mints-header" aria-hidden="true">
                <span>Minter</span>
                <span>Price</span>
                <span>Qty</span>
                <span>Time</span>
              </div>
              <div className="recent-mints-rows" aria-live="polite">
                {data.events.slice(0, 7).map((event) => (
                  <div
                    className="recent-mint-row"
                    key={event.transactionHash}
                  >
                    <div>
                      <a
                        href={`https://scan.pulsechain.com/address/${event.address}`}
                        target="_blank"
                        rel="noreferrer"
                      >
                        {shortAddress(event.address)}
                      </a>
                      <small>DegenStrategy #1</small>
                    </div>
                    <strong>
                      {data.price ? `${formatPls(data.price, 1)} PLS` : "—"}
                    </strong>
                    <span>{event.quantity}</span>
                    <a
                      className="recent-mint-time"
                      href={`https://scan.pulsechain.com/tx/${event.transactionHash}`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {relativeMintTime(event.timestamp)} ↗
                    </a>
                  </div>
                ))}
              </div>
            </div>
          </div>
          {!data.events.length && (
            <p>No recent events available from the current RPC.</p>
          )}
          <div className="nft-contract-line">
            <span>NFT Contract:</span>
            <a
              href={`https://scan.pulsechain.com/address/${CONTRACTS.nft}`}
              target="_blank"
              rel="noreferrer"
              title={CONTRACTS.nft}
            >
              {contractPreview}
            </a>
            <button
              type="button"
              className={contractCopied ? "copied" : ""}
              aria-label={
                contractCopied
                  ? "NFT contract copied"
                  : "Copy NFT contract address"
              }
              title="Copy NFT contract address"
              onClick={() => void copyNftContract()}
            >
              {contractCopied ? "Copied" : "⧉"}
            </button>
          </div>
        </section>
      </div>
    </section>
  );
}

function RewardsPanel({
  data,
  wallet,
  reload,
}: {
  data: MinerData;
  wallet: WalletState;
  reload: () => Promise<void>;
}) {
  const [showCompounded, setShowCompounded] = useState(
    () => localStorage.getItem("degen-compounded") !== "false",
  );
  const [elapsedMs, setElapsedMs] = useState(0);
  useEffect(() => {
    const syncPreference = () =>
      setShowCompounded(
        localStorage.getItem("degen-compounded") !== "false",
      );
    window.addEventListener("degen-compounded-change", syncPreference);
    return () =>
      window.removeEventListener(
        "degen-compounded-change",
        syncPreference,
      );
  }, []);
  useEffect(() => {
    setElapsedMs(0);
    if (!showCompounded) return;
    const startedAt = Date.now();
    const timer = window.setInterval(
      () => setElapsedMs(Date.now() - startedAt),
      100,
    );
    return () => window.clearInterval(timer);
  }, [
    showCompounded,
    data.pendingOink,
    data.pendingDegen,
    data.perNftOinkSecond,
    data.perNftDegenSecond,
    data.walletBalance,
  ]);
  const elapsed = BigInt(Math.floor(elapsedMs));
  const displayedOink =
    data.pendingOink +
    (data.perNftOinkSecond * data.walletBalance * elapsed) / 1_000n;
  const displayedDegen =
    data.pendingDegen +
    (data.perNftDegenSecond * data.walletBalance * elapsed) / 1_000n;
  const apr = useRewardsApr(
    data.perNftOinkSecond,
    data.perNftDegenSecond,
  );

  if (!wallet.isConnected)
    return (
      <section className="feature-panel empty-state">
        <h2>My NFTs / Rewards</h2>
        <p>Connect your wallet to view NFT miners and pending rewards.</p>
        <button className="mint-button" onClick={() => void wallet.connect()}>
          Connect Wallet
        </button>
      </section>
    );
  return (
    <section className="rewards-dashboard">
      <aside className="rewards-nft-profile">
        {data.image ? (
          <img src={data.image} alt={data.name} />
        ) : (
          <div className="rewards-nft-placeholder">⛏</div>
        )}
        <div className="rewards-nft-details">
          <h3>{data.name}</h3>
          <strong>DegenStrategy</strong>
          <p>{data.description}</p>
          <dl>
            <div>
              <dt>Token ID</dt>
              <dd>#{NFT_TOKEN_ID.toString()}</dd>
            </div>
            <div>
              <dt>Type</dt>
              <dd>ERC-1155</dd>
            </div>
            <div>
              <dt>Owned</dt>
              <dd>{data.walletBalance.toString()}x</dd>
            </div>
            <div>
              <dt>Traits</dt>
              <dd>{data.traits.toLocaleString()}</dd>
            </div>
          </dl>
          <a
            href={`https://scan.pulsechain.com/address/${CONTRACTS.nft}`}
            target="_blank"
            rel="noreferrer"
          >
            ↗ View Contract
          </a>
        </div>
      </aside>
      <div className="rewards-console">
        <header className="rewards-console-header">
          <h2>Mining Rewards</h2>
          <div>
            <strong>{data.walletBalance.toString()}</strong>
            <span>
              NFT Miner{data.walletBalance === 1n ? "" : "s"} Held
            </span>
          </div>
        </header>
        <div className="rewards-token-grid">
          <article>
            <span>OINK Pending</span>
            <strong>{formatToken(displayedOink)}</strong>
          </article>
          <article>
            <span>DEGEN Pending</span>
            <strong>{formatToken(displayedDegen)}</strong>
          </article>
        </div>
        <div className="rewards-apr">
          <span>Current APR:</span>
          <strong>{apr}</strong>
          <span
            className="rewards-apr-info"
            title="Estimated from current reward rates, live OINK and DEGEN prices, and the original $50 NFT valuation."
          >
            ⓘ
          </span>
          <small>
            {showCompounded ? "live compounded" : "on-chain snapshot"}
          </small>
        </div>
        <RewardsActions
          dashboard
          wallet={wallet}
          balance={data.walletBalance}
          pendingOink={displayedOink}
          pendingDegen={displayedDegen}
          onComplete={reload}
        />
      </div>
    </section>
  );
}

const MAX_CALCULATOR_MINERS = 5_000;

function CalculatorPanel({
  price,
  oinkRate,
  degenRate,
}: {
  price: bigint;
  oinkRate: bigint;
  degenRate: bigint;
}) {
  const [quantity, setQuantity] = useState(1);
  const full = price * BigInt(quantity);
  const total = quantity >= 10 ? (full * 97n) / 100n : full;
  const projected = (rate: bigint, seconds: number) =>
    formatToken(rate * BigInt(seconds) * BigInt(quantity));
  return (
    <section className="feature-panel">
      <span className="eyebrow">Live on-chain planning tool</span>
      <h2>Yield Calculator</h2>
      <div className="calculator-layout">
        <div>
          <label>Number of NFT miners</label>
          <input
            type="range"
            min="1"
            max={MAX_CALCULATOR_MINERS}
            value={quantity}
            onChange={(e) => setQuantity(Number(e.target.value))}
          />
          <div className="stepper">
            <button onClick={() => setQuantity(Math.max(1, quantity - 1))}>
              −
            </button>
            <strong>{quantity}</strong>
            <button
              onClick={() =>
                setQuantity(Math.min(MAX_CALCULATOR_MINERS, quantity + 1))
              }
            >
              +
            </button>
          </div>
        </div>
        <div className="total-card">
          <span>Estimated purchase cost</span>
          <strong>{total ? `${formatPls(total)} PLS` : "—"}</strong>
          {quantity >= 10 && <small>3% bulk discount included</small>}
        </div>
      </div>
      <div className="projection-grid">
        <article>
          <span>Daily</span>
          <b>{projected(oinkRate, 86400)} OINK</b>
          <b>{projected(degenRate, 86400)} DEGEN</b>
        </article>
        <article>
          <span>30 Days</span>
          <b>{projected(oinkRate, 2592000)} OINK</b>
          <b>{projected(degenRate, 2592000)} DEGEN</b>
        </article>
        <article>
          <span>365 Days</span>
          <b>{projected(oinkRate, 31536000)} OINK</b>
          <b>{projected(degenRate, 31536000)} DEGEN</b>
        </article>
      </div>
      {oinkRate === 0n && degenRate === 0n && (
        <p className="migration-note">
          Live reward rates are temporarily unavailable from the current RPC.
        </p>
      )}
    </section>
  );
}

function holderGradient(address: string) {
  const seed = Number.parseInt(address.slice(2, 8), 16) || 0;
  const hue = seed % 360;
  return `linear-gradient(135deg, hsl(${hue} 72% 58%), hsl(${(hue + 62) % 360} 68% 43%))`;
}

function HoldersPanel({
  holders,
  image,
}: {
  holders: Holder[];
  image: string;
}) {
  const total = holders.reduce((sum, item) => sum + item.value, 0);
  return (
    <section className="cashx-holders" aria-label="NFT miner holders">
      <div className="cashx-holder-header">
        <span>Wallet</span>
        <span>Owned</span>
        <span>% Owned</span>
        <span>Items</span>
      </div>
      <div
        className="cashx-holder-scroll"
        aria-label="Holder wallets with more available by scrolling"
      >
        {holders.map((holder) => (
            <div className="cashx-holder-row" key={holder.address}>
              <div className="cashx-holder-wallet">
                <span
                  className="cashx-holder-avatar"
                  style={{ background: holderGradient(holder.address) }}
                />
                <a
                  href={`https://scan.pulsechain.com/address/${holder.address}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  {shortAddress(holder.address)}
                </a>
              </div>
              <strong className="cashx-holder-owned">
                {holder.value.toLocaleString()}
              </strong>
              <span className="cashx-holder-share">
                {total ? `${((holder.value / total) * 100).toFixed(1)}%` : "—"}
              </span>
              <div className="cashx-holder-items">
                {image ? (
                  <img
                    src={image}
                    alt="DegenStrategy NFT Miner"
                    title="DegenStrategy NFT Miner"
                    loading="lazy"
                  />
                ) : (
                  <span className="cashx-holder-item-fallback" />
                )}
                <small>×{holder.value.toLocaleString()}</small>
              </div>
            </div>
          ))}
        {!holders.length && (
          <div className="cashx-holder-empty">
            Holder balances are temporarily unavailable.
          </div>
        )}
      </div>
      <div className="cashx-holder-footer">
        {`${holders.length.toLocaleString()} holders · ${total.toLocaleString()} active NFTs`}
      </div>
    </section>
  );
}

function ActivityPanel({ events }: { events: MintEvent[] }) {
  const recentEvents = events.slice(0, 25);
  return (
    <section className="cashx-activity" aria-label="Recent NFT mints">
      <div className="cashx-activity-heading">
        <h2>Recent Mints</h2>
        <span>{recentEvents.length.toLocaleString()} events</span>
      </div>
      <div
        className="cashx-activity-scroll"
        aria-label="Latest mint events with more available by scrolling"
      >
        {recentEvents.map((event) => (
          <article className="cashx-activity-row" key={event.transactionHash}>
            <div className="cashx-activity-details">
              <div className="cashx-activity-meta">
                <a
                  href={`https://scan.pulsechain.com/address/${event.address}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  {shortAddress(event.address)}
                </a>
                <span>
                  minted {event.quantity.toLocaleString()} NFT
                  {event.quantity === 1 ? "" : "s"}
                </span>
              </div>
              <div className="cashx-activity-name">DegenStrategy NFT #1</div>
            </div>
            <div className="cashx-activity-action">
              <span>{relativeMintTime(event.timestamp)}</span>
              <a
                href={`https://scan.pulsechain.com/tx/${event.transactionHash}`}
                target="_blank"
                rel="noreferrer"
              >
                View TX ↗
              </a>
            </div>
          </article>
        ))}
        {!recentEvents.length && (
          <div className="cashx-activity-empty">
            Activity is temporarily unavailable from the current RPC.
          </div>
        )}
      </div>
    </section>
  );
}

function Table({
  headings,
  rows,
}: {
  headings: string[];
  rows: Array<Array<ReactNode>>;
}) {
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            {headings.map((heading) => (
              <th key={heading}>{heading}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={index}>
              {row.map((cell, cellIndex) => (
                <td key={cellIndex}>{cell}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
