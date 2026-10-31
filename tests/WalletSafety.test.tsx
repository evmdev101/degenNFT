import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ send: vi.fn(async () => ({ hash: "submitted" })) }));
vi.mock("ethers", async original => ({
  ...await original<typeof import("ethers")>(),
  BrowserProvider: class {
    constructor(private ethereum: Eip1193Provider) {}
    send = (method: string) => this.ethereum.request({ method });
    getNetwork = async () => ({ chainId: BigInt(await this.ethereum.request({ method: "eth_chainId" }) as string) });
    getSigner = async () => ({ sendTransaction: mocks.send });
  },
}));
import { useWallet } from "../src/hooks/useWallet";
const accountA = "0x1111111111111111111111111111111111111111";
const accountB = "0x2222222222222222222222222222222222222222";
function walletHost() {
  const events = new Map<string, (...args: unknown[]) => void>();
  let account = accountA, chain = "0x171";
  const host = {
    request: vi.fn(async ({ method }: { method: string }) => method === "eth_accounts" ? [account] : chain),
    on: (event: string, listener: (...args: unknown[]) => void) => { events.set(event, listener); },
    removeListener: (event: string) => { events.delete(event); },
  };
  vi.stubGlobal("ethereum", host);
  return { host, account: (value: string) => { account = value; events.get("accountsChanged")?.([value]); }, chain: (value: string) => { chain = value; events.get("chainChanged")?.(value); } };
}
afterEach(() => { vi.unstubAllGlobals(); mocks.send.mockClear(); });
describe("wallet request boundary", () => {
  it("rejects a previously obtained signer after account changes during preflight", async () => {
    const host = walletHost();
    const { result } = renderHook(useWallet);
    await waitFor(() => expect(result.current.address).toBe(accountA));
    const signer = await result.current.getSigner();
    act(() => host.account(accountB));
    await expect(signer.sendTransaction({ to: accountB })).rejects.toThrow("Wallet changed");
    expect(mocks.send).not.toHaveBeenCalled();
    await waitFor(() => expect(result.current.address).toBe(accountB));
  });
  it("rejects a wrong network without requesting an automatic network switch", async () => {
    const host = walletHost();
    const { result } = renderHook(useWallet);
    await waitFor(() => expect(result.current.address).toBe(accountA));
    act(() => host.chain("0x1"));
    await waitFor(() => expect(result.current.chainId).toBe(1n));
    await expect(result.current.getSigner()).rejects.toThrow("Switch to PulseChain");
    expect(host.host.request.mock.calls.some(([request]) => request.method === "wallet_switchEthereumChain")).toBe(false);
  });
  it("rechecks and sends once with a matching account and network", async () => {
    walletHost();
    const { result } = renderHook(useWallet);
    await waitFor(() => expect(result.current.address).toBe(accountA));
    const signer = await result.current.getSigner();
    await signer.sendTransaction({ to: accountB });
    expect(mocks.send).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ chainId: 369n }));
  });
  it("allows only one active wallet send across separate action panels", async () => {
    walletHost();
    const { result } = renderHook(useWallet);
    await waitFor(() => expect(result.current.address).toBe(accountA));
    const first = await result.current.getSigner();
    const second = await result.current.getSigner();
    let finish!: (value: { hash: string }) => void;
    mocks.send.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const pending = first.sendTransaction({ to: accountB });
    await waitFor(() => expect(mocks.send).toHaveBeenCalledTimes(1));
    await expect(second.sendTransaction({ to: accountB })).rejects.toThrow("Finish the open wallet request");
    finish({ hash: "submitted" });
    await pending;
    await second.sendTransaction({ to: accountB });
    expect(mocks.send).toHaveBeenCalledTimes(2);
  });

});
