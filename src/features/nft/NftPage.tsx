import { ChangingValue } from "../../components/ChangingValue";
import { confirmTransaction } from "../../lib/transactions";
import { useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { Contract, Interface, ZeroAddress, formatEther, parseEther } from "ethers";
import { useCallback, useRef, useState } from "react";
import type { ReactNode } from "react";
import { ScrollRegion } from "../../components/ScrollRegion";
import type { WalletState } from "../../hooks/useWallet";
import {
  CONTRACTS,
  MINT_ABI,
  NFT_ABI,
  NFT_TOKEN_ID,
} from "../../config/contracts";
import {
  fetchTokenMetadata,
  getPublicContracts,
  pulsechainRpcCall,
  readableError,
  shortAddress,
  toGatewayUrl,
} from "../../lib/chain";
import { PageActivity, usePageActive } from "../../hooks/usePageActive";
import { HelpTip } from "../../components/HelpTip";
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
  walletLoading: boolean;
  historyLoading: boolean;
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
};

const initialData: MinerData = {
  loading: true,
  walletLoading: true,
  historyLoading: true,
  error: "",
  price: 0n,
  active: 0,
  minted: null,
  burned: null,
  image: "https://avatars.githubusercontent.com/u/211634181?s=400&u=9fe309d180b8809e8494e16da2d5c3882e2d4399&v=4",
  name: "DegenStrategy NFT Miner",
  description: "NFT Miner used to accrue OINK and DEGEN mining rewards",
  traits: 0,
  events: [],
  holders: [],
  walletBalance: 0n,
  pendingOink: 0n,
  pendingDegen: 0n,
};

async function loadMinerHistory() {
  let events: MintEvent[] = [];
  let holders: Holder[] = [];
  let minted: number | null = null;
  let burned: number | null = null;
  try {
    const iface = new Interface(NFT_ABI);
    const transferLogs = await pulsechainRpcCall<Array<{
      topics: string[]; data: string; blockNumber: string; transactionHash: string;
    }>>("eth_getLogs", [{
      address: CONTRACTS.nft, fromBlock: "0x0", toBlock: "latest",
      topics: [iface.getEvent("TransferSingle")!.topicHash],
    }]);
    const matchingTransfers = transferLogs.flatMap((log) => {
      const decoded = iface.parseLog(log);
      if (!decoded || BigInt(decoded.args.id) !== NFT_TOKEN_ID) return [];
      return [{ args: decoded.args, blockNumber: Number(BigInt(log.blockNumber)),
        transactionHash: log.transactionHash }];
    });
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
      .sort((a, b) => b.blockNumber - a.blockNumber);

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


  return { events, holders, minted, burned };
}

const overviewOptions = {
  queryKey: ["nft-overview"],
  queryFn: async () => {
    const { nft, mint } = await getPublicContracts();
    const [price, active] = await Promise.all([
      mint.nftPrice() as Promise<bigint>,
      nft.totalNFTs() as Promise<bigint>,
    ]);
    return { price, active: Number(active) };
  },
  staleTime: 30_000,
  refetchInterval: 60_000,
};

const uriOptions = {
  queryKey: ["nft-uri"],
  queryFn: async () => {
    const { nft } = await getPublicContracts();
    return nft.uri(NFT_TOKEN_ID) as Promise<string>;
  },
  staleTime: 5 * 60_000,
};

const metadataOptions = (uri: string) => ({
  queryKey: ["nft-metadata", uri],
  queryFn: () => fetchTokenMetadata(
    uri.replace("{id}", NFT_TOKEN_ID.toString(16).padStart(64, "0")),
  ),
  staleTime: Infinity,
});

const walletOptions = (address: string | null) => ({
  queryKey: ["nft-wallet", address?.toLowerCase() ?? "guest"],
  enabled: Boolean(address),
  staleTime: 15_000,
  refetchInterval: 60_000,
  queryFn: async () => {
    const { nft } = await getPublicContracts();
    const [walletBalance, pending] = await Promise.all([
      nft.balanceOf(address, NFT_TOKEN_ID) as Promise<bigint>,
      nft.viewUserTotalEarnings(address) as Promise<[bigint, bigint]>,
    ]);
    return { walletBalance, pendingOink: pending[0], pendingDegen: pending[1] };
  },
});

export async function prefetchNftData(client: QueryClient, address: string | null) {
  await Promise.all([
    client.prefetchQuery(overviewOptions),
    client.prefetchQuery(uriOptions),
    address ? client.prefetchQuery(walletOptions(address)) : Promise.resolve(),
  ]);
  const uri = client.getQueryData<string>(uriOptions.queryKey);
  if (uri) await client.prefetchQuery(metadataOptions(uri));
}

function useMinerData(address: string | null) {
  const pageActive = usePageActive();
  const overview = useQuery({ ...overviewOptions, enabled: pageActive });
  const uri = useQuery({ ...uriOptions, enabled: pageActive });
  const metadata = useQuery({
    ...metadataOptions(uri.data ?? ""),
    enabled: pageActive && Boolean(uri.data),
  });
  const history = useQuery({
    queryKey: ["nft-history"],
    queryFn: loadMinerHistory,
    enabled: pageActive && Boolean(overview.data),
    staleTime: 5 * 60_000,
    refetchInterval: 5 * 60_000,
  });
  const blocks = [...new Set(history.data?.events.slice(0, 25).map((event) => event.blockNumber) ?? [])];
  const timestamps = useQuery({
    queryKey: ["nft-mint-timestamps", blocks],
    enabled: pageActive && blocks.length > 0,
    staleTime: Infinity,
    queryFn: async () => {
      const { provider } = await getPublicContracts();
      const entries = await Promise.all(blocks.map(async (number) => {
        try {
          const block = await provider.getBlock(number);
          return [number, block?.timestamp] as const;
        } catch {
          return [number, undefined] as const;
        }
      }));
      return Object.fromEntries(entries) as Record<number, number | undefined>;
    },
  });
  // Public history and metadata never hold up wallet balances or the page.
  const account = useQuery({ ...walletOptions(address), enabled: pageActive && Boolean(address) });
  const error = overview.error || (address ? account.error : null);
  const data: MinerData = {
    ...initialData,
    ...overview.data,
    ...history.data,
    events: (history.data?.events ?? []).map((event) => ({
      ...event, timestamp: timestamps.data?.[event.blockNumber],
    })),
    loading: !overview.data,
    walletLoading: Boolean(address) && !account.data,
    historyLoading: history.isPending,
    error: error ? readableError(error) : "",
    image: metadata.data?.image ? toGatewayUrl(metadata.data.image) : initialData.image,
    name: metadata.data?.name || initialData.name,
    description: metadata.data?.description || initialData.description,
    traits: metadata.data?.attributes?.length || 0,
    walletBalance: address ? account.data?.walletBalance ?? 0n : 0n,
    pendingOink: address ? account.data?.pendingOink ?? 0n : 0n,
    pendingDegen: address ? account.data?.pendingDegen ?? 0n : 0n,
  };
  const reload = useCallback(async () => {
    void history.refetch();
    await Promise.all([overview.refetch(), account.refetch()]);
  }, [overview.refetch, account.refetch, history.refetch]);
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
export function NftPage({ wallet }: { wallet: WalletState }) {
  const [tab, setTab] = useState<NftTab>("mint");
  const [visited, setVisited] = useState<NftTab[]>(["mint"]);
  const selectTab = (next: NftTab) => { setTab(next); setVisited(current => current.includes(next) ? current : [...current, next]); };
  const [quantity, setQuantity] = useState(1);
  const queryClient = useQueryClient();
  const mintLock = useRef(false);
  const pageActive = usePageActive();
  const [txStatus, setTxStatus] = useState("");
  const [txPending, setTxPending] = useState(false);
  const { data, reload } = useMinerData(wallet.address);

  const quoteKey = ["nft-purchase-quote", quantity, data.price.toString()];
  const quote = useQuery({
    queryKey: quoteKey,
    enabled: pageActive && data.price > 0n,
    staleTime: 30_000,
    queryFn: async () => (await getPublicContracts()).mint.priceWithDiscount(BigInt(quantity), data.price) as Promise<bigint>,
  });
  const cost = quote.data ?? 0n;

  const mint = async () => {
    if (mintLock.current) return;
    if (!wallet.isConnected) {
      await wallet.connect();
      return;
    }
    mintLock.current = true;
    setTxPending(true);
    setTxStatus("");
    try {
      const signer = await wallet.getSigner();
      const contract = new Contract(CONTRACTS.mint, MINT_ABI, signer);
      const [freshPrice, balance, fee] = await Promise.all([
        contract.nftPrice() as Promise<bigint>,
        signer.provider.getBalance(await signer.getAddress()),
        signer.provider.getFeeData(),
      ]);
      const freshCost: bigint = await contract.priceWithDiscount(BigInt(quantity), freshPrice);
      if (freshCost !== cost) {
        queryClient.setQueryData(quoteKey, freshCost);
        throw new Error("The price changed. Check the updated total and choose Mint again.");
      }
      if (freshCost <= 0n) throw new Error("Mint price is unavailable.");
      await contract.buyWithPLS.staticCall(BigInt(quantity), { value: freshCost });
      const gas = await contract.buyWithPLS.estimateGas(BigInt(quantity), { value: freshCost });
      const gasPrice = fee.maxFeePerGas ?? fee.gasPrice;
      if (!gasPrice) throw new Error("Network fee is unavailable. Please try again shortly.");
      if (balance < freshCost + gas * gasPrice * 120n / 100n)
        throw new Error("Keep enough PLS for the purchase and network fee.");
      await wallet.getSigner();
      const transaction = await contract.buyWithPLS(BigInt(quantity), {
        value: freshCost,
      });

      await confirmTransaction(transaction);
      setTxStatus("");
      await reload().catch(() => undefined);
    } catch (error) {
      setTxStatus(readableError(error));
    } finally {
      mintLock.current = false;
      setTxPending(false);
    }
  };

  return (
    <main className="nft-page" aria-busy={data.loading}>
      <section className="overview-section">
        <h1>Mint Overview</h1>
        <div className="overview-grid">
          <Metric
            label="Price per NFT"
            value={data.price ? formatPls(data.price, 2) : "—"}
            unit="PLS"
            note="Paid in native PLS"
          />
          <Metric
            label="Active Miners"
            value={data.loading ? "—" : data.active.toLocaleString()}
            unit="miners"
            note="Currently earning rewards"
          />
          <Metric
            label="Total Minted"
            value={data.minted?.toLocaleString() ?? "—"}
            unit="NFTs"
            note="All-time miners created"
          />
          <Metric
            label="Total Burned"
            value={data.burned?.toLocaleString() ?? "—"}
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
            onClick={() => selectTab(key)}
          >
            {label}
          </button>
        ))}
      </nav>

      {data.error && <div className="panel-message error">{data.error}</div>}
      <div className="nft-tab-panel" hidden={tab !== "mint"}>
        <MintPanel data={data} quantity={quantity} setQuantity={setQuantity}
          cost={cost} txPending={txPending} txStatus={txStatus}
          wallet={wallet} onMint={() => void mint()} />
      </div>
      {visited.includes("rewards") && <div className="nft-tab-panel" hidden={tab !== "rewards"}>
        <PageActivity.Provider value={pageActive && tab === "rewards"}>
          <RewardsPanel data={data} wallet={wallet} reload={reload} />
        </PageActivity.Provider>
      </div>}
      {visited.includes("calculator") && <div className="nft-tab-panel" hidden={tab !== "calculator"}>
        <PageActivity.Provider value={pageActive && tab === "calculator"}><CalculatorPanel price={data.price} /></PageActivity.Provider>
      </div>}
      {visited.includes("holders") && <div className="nft-tab-panel" hidden={tab !== "holders"}><HoldersPanel holders={data.holders} image={data.image} /></div>}
      {visited.includes("activity") && <div className="nft-tab-panel" hidden={tab !== "activity"}><ActivityPanel events={data.events} /></div>}
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
          <ChangingValue value={value === "—" ? undefined : value}>{value}</ChangingValue>
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
                  ? "Minting…"
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

          </div>
          <div className="recent-mints-scroll">
            <div className="recent-mints-table">
              <div className="recent-mints-header" aria-hidden="true">
                <span>Minter</span>
                <span>Asset</span>
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
                      NFT #1
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
            <p>{data.historyLoading ? "Loading recent mints…" : "No recent events available from the current RPC."}</p>
          )}
          <div className="nft-contract-line">
            <span>NFT Contract:</span>
            <a
              href={`https://scan.pulsechain.com/address/${CONTRACTS.nft}`}
              target="_blank"
              rel="noreferrer"
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

  const displayedOink = data.pendingOink;
  const displayedDegen = data.pendingDegen;
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
              <dd>{data.walletLoading ? "—" : `${data.walletBalance.toString()}x`}</dd>
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
            <strong>{data.walletLoading ? "—" : data.walletBalance.toString()}</strong>
            <span>
              NFT Miner{data.walletBalance === 1n ? "" : "s"} Held
            </span>
          </div>
        </header>
        <div className="rewards-token-grid">
          <article>
            <span>OINK Pending</span>
            <strong>{data.walletLoading ? "—" : formatToken(displayedOink)}</strong>
          </article>
          <article>
            <span>DEGEN Pending</span>
            <strong>{data.walletLoading ? "—" : formatToken(displayedDegen)}</strong>
          </article>
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
}: {
  price: bigint;
}) {
  const [quantity, setQuantity] = useState(1);
  const pageActive = usePageActive();
  const [dailyOink, setDailyOink] = useState("");
  const [dailyDegen, setDailyDegen] = useState("");
  const quote = useQuery({
    queryKey: ["nft-calculator-quote", quantity, price.toString()],
    enabled: pageActive && price > 0n,
    queryFn: async () => (await getPublicContracts()).mint.priceWithDiscount(BigInt(quantity), price) as Promise<bigint>,
    staleTime: 60_000,
  });
  const total = quote.data;
  const projected = (amount: string, days: number) => {
    try {
      if (!amount.trim()) return "—";
      const raw = parseEther(amount);
      return raw >= 0n ? formatToken(raw * BigInt(days) * BigInt(quantity)) : "—";
    } catch { return "—"; }
  };
  return (
    <section className="feature-panel">
      <span className="eyebrow">Planning tool</span>
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
          <small>Contract purchase quote; excludes network fees</small>
        </div>
      </div>
      <div className="calculator-assumptions">
        <label>Assumed daily OINK per NFT<input inputMode="decimal" value={dailyOink} onChange={e => setDailyOink(e.target.value)} placeholder="Enter a daily estimate" /></label>
        <label>Assumed daily DEGEN per NFT<input inputMode="decimal" value={dailyDegen} onChange={e => setDailyDegen(e.target.value)} placeholder="Enter a daily estimate" /></label>
      </div>
      <div className="projection-grid">
        <article>
          <span>Daily</span>
          <b>{projected(dailyOink, 1)} OINK</b>
          <b>{projected(dailyDegen, 1)} DEGEN</b>
        </article>
        <article>
          <span>30 Days</span>
          <b>{projected(dailyOink, 30)} OINK</b>
          <b>{projected(dailyDegen, 30)} DEGEN</b>
        </article>
        <article>
          <span>365 Days</span>
          <b>{projected(dailyOink, 365)} OINK</b>
          <b>{projected(dailyDegen, 365)} DEGEN</b>
        </article>
      </div>
      <p className="migration-note">Scenario estimate <HelpTip label="yield estimates">Uses your daily estimates at a constant rate. It excludes compounding, claim penalties, network fees, and future rate changes. The contract reward return has no verified time unit, so it is not presented as live APR.</HelpTip></p>
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
      <ScrollRegion
        className="cashx-holder-scroll"
        label="NFT holder wallets"
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
      </ScrollRegion>
      <div className="cashx-holder-footer">
        {`${holders.length.toLocaleString()} holders · ${total.toLocaleString()} active NFTs`}
      </div>
    </section>
  );
}

function ActivityPanel({ events }: { events: MintEvent[] }) {
  const [visible, setVisible] = useState(25);
  const recentEvents = events.slice(0, visible);
  return (
    <section className="cashx-activity" aria-label="Recent NFT mints">
      <div className="cashx-activity-heading">
        <h2>Recent Mints</h2>
        <span>{recentEvents.length.toLocaleString()} events</span>
      </div>
      <ScrollRegion
        className="cashx-activity-scroll"
        label="Latest NFT mint events"
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
      </ScrollRegion>
      {visible < events.length && <button type="button" onClick={() => setVisible(count => count + 25)}>Show more</button>}
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
