import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NftPage } from "../src/features/nft/NftPage";
import type { WalletState } from "../src/hooks/useWallet";
import { Interface, ZeroAddress } from "ethers";
import { NFT_ABI } from "../src/config/contracts";

const mocks = vi.hoisted(() => ({
  contracts: vi.fn(), metadata: vi.fn(), history: vi.fn(), balance: vi.fn(), earnings: vi.fn(), uri: vi.fn(),
}));
vi.mock("../src/lib/chain", async (original) => ({
  ...await original<typeof import("../src/lib/chain")>(),
  getPublicContracts: mocks.contracts,
  pulsechainRpcCall: mocks.history,
  fetchTokenMetadata: mocks.metadata,
}));
vi.mock("../src/features/nft/RewardsActions", () => ({ RewardsActions: () => null }));

const wallet = {
  address: null, isConnected: false, isWrongNetwork: false,
  connecting: false, connect: vi.fn(), getSigner: vi.fn(),
} as unknown as WalletState;
let client: QueryClient;
const never = () => new Promise<never>(() => {});
function mount(address: string | null = null) {
  return render(
    <QueryClientProvider client={client}>
      <NftPage wallet={{ ...wallet, address, isConnected: Boolean(address) }} />
    </QueryClientProvider>,
  );
}

describe("NFT progressive loading", () => {
  beforeEach(() => {
    client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    vi.clearAllMocks();
    mocks.metadata.mockImplementation(never);
    mocks.history.mockImplementation(never);
    mocks.uri.mockResolvedValue("ipfs://metadata");
    mocks.balance.mockResolvedValue(0n);
    mocks.earnings.mockResolvedValue([0n, 0n]);
    mocks.contracts.mockResolvedValue({
      nft: {
        totalNFTs: vi.fn(async () => 662n),
        uri: mocks.uri,
        queryFilter: mocks.history,
        filters: { TransferSingle: vi.fn() },
        balanceOf: mocks.balance,
        viewUserTotalEarnings: mocks.earnings,
      },
      mint: {
        nftPrice: vi.fn(async () => 10n ** 18n),
        priceWithDiscount: vi.fn(async () => 10n ** 18n),
      },
      provider: {},
    });
  });
  afterEach(() => client.clear());

  it("renders the page, artwork and tabs even when RPC is still connecting", () => {
    mocks.contracts.mockImplementation(never);
    mount();
    expect(screen.getByRole("heading", { name: "Mint Overview" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Holders" })).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "DegenStrategy NFT Miner" })).toBeInTheDocument();
    expect(screen.queryByText("Loading NFT data…")).not.toBeInTheDocument();
  });

  it("shows live price and supply without waiting for metadata or transfer history", async () => {
    mocks.uri.mockImplementation(never);
    mount();
    expect(await screen.findByText("662")).toBeInTheDocument();
    await waitFor(() => expect(mocks.history).toHaveBeenCalledOnce());
    expect(screen.getByText("1 PLS")).toBeInTheDocument();
    expect(screen.getByText("Loading recent mints…")).toBeInTheDocument();
  });

  it("reuses public overview data when the connected wallet changes", async () => {
    const first = mount("0x1111111111111111111111111111111111111111");
    await screen.findByText("662");
    await waitFor(() => expect(mocks.balance).toHaveBeenCalled());
    const overview = client.getQueryData(["nft-overview"]);
    first.unmount();
    mount("0x2222222222222222222222222222222222222222");
    expect(screen.getByText("662")).toBeInTheDocument();
    expect(client.getQueryData(["nft-overview"])).toBe(overview);
    await waitFor(() => expect(mocks.balance).toHaveBeenCalledWith(
      "0x2222222222222222222222222222222222222222", expect.any(BigInt),
    ));
  });

  it("loads wallet earnings while the historical log request is still pending", async () => {
    const address = "0x1111111111111111111111111111111111111111";
    mocks.earnings.mockResolvedValue([123n, 456n]);
    mount(address);
    await waitFor(() => expect(client.getQueryData(["nft-wallet", address])).toMatchObject({
      pendingOink: 123n, pendingDegen: 456n,
    }));
    expect(screen.getByText("Loading recent mints…")).toBeInTheDocument();
  });

  it("decodes historical logs without making artwork metadata a dependency", async () => {
    const iface = new Interface(NFT_ABI);
    const address = "0x1111111111111111111111111111111111111111";
    const event = iface.encodeEventLog(iface.getEvent("TransferSingle")!, [
      address, ZeroAddress, address, 1n, 3n,
    ]);
    mocks.history.mockResolvedValue([{ ...event, blockNumber: "0x1", transactionHash: "0xabc" }]);
    mount();
    await waitFor(() => expect(client.getQueryData(["nft-history"])).toMatchObject({
      minted: 3, burned: 0, holders: [{ address, value: 3 }],
    }));
  });
  it("preserves entered calculator assumptions when switching sections", async () => {
    mount();
    await screen.findByText("662");
    fireEvent.click(screen.getByRole("button", { name: "Yield Calculator" }));
    const input = screen.getByLabelText("Assumed daily OINK per NFT");
    fireEvent.change(input, { target: { value: "2.5" } });
    expect(screen.getByText("2.5 OINK")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Mint", exact: true }));
    fireEvent.click(screen.getByRole("button", { name: "Yield Calculator" }));
    expect(screen.getByLabelText("Assumed daily OINK per NFT")).toHaveValue("2.5");
  });

});
