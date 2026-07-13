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

type NftTab = "mint" | "rewards" | "calculator" | "holders" | "activity";
type Holder = { address: string; value: number };
type MintEvent = {
  address: string;
  quantity: number;
  blockNumber: number;
  transactionHash: string;
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

function useMinerData(address: string | null) {
  const [data, setData] = useState(initialData);

  const load = useCallback(async () => {
    setData((current) => ({ ...current, loading: true, error: "" }));
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
      let minted: number | null = null;
      let burned: number | null = null;
      try {
        const [mintLogs, burnLogs] = await Promise.all([
          nft.queryFilter(nft.filters.TransferSingle(null, ZeroAddress, null)),
          nft.queryFilter(nft.filters.TransferSingle(null, null, ZeroAddress)),
        ]);
        const matchingMints = mintLogs.filter(
          (log) =>
            log instanceof EventLog && BigInt(log.args.id) === NFT_TOKEN_ID,
        ) as EventLog[];
        const matchingBurns = burnLogs.filter(
          (log) =>
            log instanceof EventLog && BigInt(log.args.id) === NFT_TOKEN_ID,
        ) as EventLog[];
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
      } catch (eventError) {
        console.warn("Event history unavailable:", eventError);
      }

      let holders: Holder[] = [];
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
            (item) => /^0x[0-9a-f]{40}$/i.test(item.address) && item.value > 0,
          )
          .sort((a, b) => b.value - a.value);
      } catch (holderError) {
        console.warn("Holder index unavailable:", holderError);
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
      setData({
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
      });
      void provider;
    } catch (error) {
      setData((current) => ({
        ...current,
        loading: false,
        error: readableError(error),
      }));
    }
  }, [address]);

  useEffect(() => {
    void load();
  }, [load]);
  return { data, reload: load };
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
        <span className="eyebrow">DegenStrategy NFT Miner</span>
        <h1>Mint Overview</h1>
        <div className="overview-grid">
          <Metric
            label="Price per NFT"
            value={data.price ? `${formatPls(data.price, 4)} PLS` : "Loading…"}
            note="Paid in native PLS"
          />
          <Metric
            label="Active Miners"
            value={data.active.toLocaleString()}
            note="Currently earning rewards"
          />
          <Metric
            label="Total Minted"
            value={data.minted?.toLocaleString() ?? "Indexing…"}
            note="All-time miners created"
          />
          <Metric
            label="Total Burned"
            value={data.burned?.toLocaleString() ?? "Indexing…"}
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
      {tab === "holders" && <HoldersPanel holders={data.holders} />}
      {tab === "activity" && <ActivityPanel events={data.events} />}
    </main>
  );
}

function Metric({
  label,
  value,
  note,
}: {
  label: string;
  value: string;
  note: string;
}) {
  return (
    <article className="metric-card">
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{note}</small>
    </article>
  );
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
  const full = data.price * BigInt(quantity),
    saved = full > cost ? full - cost : 0n;
  return (
    <section className="mint-layout-react">
      <article className="art-card">
        <div className="art-frame">
          {data.image ? (
            <img src={data.image} alt={data.name} />
          ) : (
            <span className="art-placeholder">⛏</span>
          )}
        </div>
        <div className="art-details">
          <h2>{data.name}</h2>
          <b>DegenStrategy</b>
          <p>{data.description}</p>
          <dl>
            <div>
              <dt>Token ID</dt>
              <dd>#1</dd>
            </div>
            <div>
              <dt>Type</dt>
              <dd>ERC-1155</dd>
            </div>
            <div>
              <dt>Rewards</dt>
              <dd>OINK + DEGEN</dd>
            </div>
            <div>
              <dt>Traits</dt>
              <dd>{data.traits}</dd>
            </div>
          </dl>
          <a
            href={`https://scan.pulsechain.com/address/${CONTRACTS.nft}`}
            target="_blank"
            rel="noreferrer"
          >
            Verified NFT contract ↗
          </a>
        </div>
      </article>
      <div className="purchase-column">
        <h2>Mint DegenStrategy NFT Miner</h2>
        <p>
          Hold NFT to earn auto-compounding OINK and DEGEN rewards. Burn any
          time to cash out.
        </p>
        <div className="step-bar">
          <b>
            <i>1</i> Choose quantity
          </b>
          <span>→</span>
          <b>
            <i>2</i> Mint NFT
          </b>
        </div>
        <div className="purchase-panel">
          <div className="purchase-stats">
            <Metric
              label="Price"
              value={data.price ? `${formatPls(data.price, 4)} PLS` : "—"}
              note="per NFT"
            />
            <Metric
              label="Minted"
              value={data.minted?.toLocaleString() ?? "—"}
              note={`${data.active.toLocaleString()} active`}
            />
            <Metric
              label="Burned"
              value={data.burned?.toLocaleString() ?? "—"}
              note="cashed out"
            />
          </div>
          <div className="quantity-row">
            <div>
              <span>Quantity</span>
              <small>3% off at 10+</small>
            </div>
            <div className="stepper">
              <button onClick={() => setQuantity(Math.max(1, quantity - 1))}>
                −
              </button>
              <strong>{quantity}</strong>
              <button onClick={() => setQuantity(Math.min(999, quantity + 1))}>
                +
              </button>
            </div>
          </div>
          <div className="total-card">
            <span>{saved ? "Discounted total" : "Total cost"}</span>
            <strong>{cost ? `${formatPls(cost)} PLS` : "—"}</strong>
            {saved > 0n && <small>You save {formatPls(saved)} PLS</small>}
          </div>
          <button
            className="mint-button"
            disabled={txPending || !cost}
            onClick={onMint}
          >
            {txPending
              ? "TRANSACTION PENDING"
              : wallet.isConnected
                ? `MINT ${quantity} NFT${quantity > 1 ? "S" : ""}`
                : "CONNECT WALLET TO MINT"}
          </button>
          {txStatus && <div className="transaction-status">{txStatus}</div>}
        </div>
        <section className="recent-mints">
          <h3>
            Recent Mints <small>Updates from PulseChain</small>
          </h3>
          {data.events.slice(0, 7).map((event) => (
            <div key={event.transactionHash}>
              <a
                href={`https://scan.pulsechain.com/address/${event.address}`}
                target="_blank"
                rel="noreferrer"
              >
                {shortAddress(event.address)}
              </a>
              <span>
                minted {event.quantity} miner{event.quantity === 1 ? "" : "s"}
              </span>
              <a
                href={`https://scan.pulsechain.com/tx/${event.transactionHash}`}
                target="_blank"
                rel="noreferrer"
              >
                ↗
              </a>
            </div>
          ))}
          {!data.events.length && (
            <p>No recent events available from the current RPC.</p>
          )}
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
    <section className="feature-panel">
      <span className="eyebrow">Connected wallet</span>
      <h2>Mining Rewards</h2>
      <div className="reward-grid">
        <Metric
          label="NFT Miners Held"
          value={data.walletBalance.toString()}
          note="Token ID #1"
        />
        <Metric
          label="OINK Pending"
          value={formatToken(data.pendingOink)}
          note="Current on-chain estimate"
        />
        <Metric
          label="DEGEN Pending"
          value={formatToken(data.pendingDegen)}
          note="Current on-chain estimate"
        />
      </div>
      <RewardsActions
        wallet={wallet}
        balance={data.walletBalance}
        pendingOink={data.pendingOink}
        pendingDegen={data.pendingDegen}
        onComplete={reload}
      />
    </section>
  );
}

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
            max="100"
            value={quantity}
            onChange={(e) => setQuantity(Number(e.target.value))}
          />
          <div className="stepper">
            <button onClick={() => setQuantity(Math.max(1, quantity - 1))}>
              −
            </button>
            <strong>{quantity}</strong>
            <button onClick={() => setQuantity(Math.min(100, quantity + 1))}>
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

function HoldersPanel({ holders }: { holders: Holder[] }) {
  const total = holders.reduce((sum, item) => sum + item.value, 0);
  return (
    <section className="feature-panel">
      <span className="eyebrow">On-chain ownership</span>
      <h2>NFT Miner Holders</h2>
      <div className="reward-grid">
        <Metric
          label="Indexed holders"
          value={holders.length.toLocaleString()}
          note="PulseChain explorer"
        />
        <Metric
          label="Miners represented"
          value={total.toLocaleString()}
          note="Across indexed wallets"
        />
        <Metric
          label="Largest position"
          value={(holders[0]?.value || 0).toLocaleString()}
          note="NFT miners"
        />
      </div>
      <Table
        headings={["Rank", "Holder", "NFT Miners", "Share", ""]}
        rows={holders.map((holder, index) => [
          String(index + 1),
          shortAddress(holder.address),
          holder.value.toLocaleString(),
          total ? `${((holder.value / total) * 100).toFixed(2)}%` : "—",
          <a
            href={`https://scan.pulsechain.com/address/${holder.address}`}
            target="_blank"
            rel="noreferrer"
          >
            View ↗
          </a>,
        ])}
      />
    </section>
  );
}

function ActivityPanel({ events }: { events: MintEvent[] }) {
  return (
    <section className="feature-panel">
      <span className="eyebrow">On-chain history</span>
      <h2>Mint Activity</h2>
      <Table
        headings={["Minter", "Quantity", "Block", "Transaction"]}
        rows={events.map((event) => [
          shortAddress(event.address),
          event.quantity.toLocaleString(),
          `#${event.blockNumber.toLocaleString()}`,
          <a
            href={`https://scan.pulsechain.com/tx/${event.transactionHash}`}
            target="_blank"
            rel="noreferrer"
          >
            View ↗
          </a>,
        ])}
      />
      {!events.length && (
        <p className="migration-note">
          Activity is temporarily unavailable from the current RPC.
        </p>
      )}
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
