import { BrowserProvider } from "ethers";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CHAIN_ID, CHAIN_HEX, PULSECHAIN } from "../config/contracts";
import { readableError } from "../lib/chain";

export function useWallet() {
  const [address, setAddress] = useState<string | null>(null);
  const [chainId, setChainId] = useState<bigint | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState("");

  const refreshSequence = useRef(0);
  const connectingRef = useRef(false);
  const transactionRequest = useRef(false);

  const refresh = useCallback(async () => {
    if (!window.ethereum) return;
    const sequence = ++refreshSequence.current;
    const browserProvider = new BrowserProvider(window.ethereum);
    const [accounts, network] = await Promise.all([
      browserProvider.send("eth_accounts", []) as Promise<string[]>,
      browserProvider.getNetwork(),
    ]);
    if (sequence !== refreshSequence.current) return;
    setAddress(accounts[0] ?? null);
    setChainId(network.chainId);
  }, []);

  useEffect(() => {
    const safelyRefresh = () => void refresh().catch(() => {
      setError("Wallet unavailable. Check your wallet connection.");
    });
    safelyRefresh();
    const changed = () => {
      ++refreshSequence.current;
      setAddress(null);
      setChainId(null);
      setError("");
      safelyRefresh();
    };
    window.ethereum?.on?.("accountsChanged", changed);
    window.ethereum?.on?.("chainChanged", changed);
    return () => {
      ++refreshSequence.current;
      window.ethereum?.removeListener?.("accountsChanged", changed);
      window.ethereum?.removeListener?.("chainChanged", changed);
    };
  }, [refresh]);

  const switchNetwork = useCallback(async () => {
    if (!window.ethereum)
      throw new Error("Install MetaMask, Rabby, or another EVM wallet.");
    try {
      await window.ethereum.request({
        method: "wallet_switchEthereumChain",
        params: [{ chainId: CHAIN_HEX }],
      });
    } catch (switchError) {
      const code = (switchError as { code?: number }).code;
      if (code !== 4902) throw switchError;
      await window.ethereum.request({
        method: "wallet_addEthereumChain",
        params: [PULSECHAIN],
      });
    }
    await refresh();
  }, [refresh]);

  const connect = useCallback(async () => {
    if (connectingRef.current) return;
    connectingRef.current = true;
    setError("");
    setConnecting(true);
    try {
      if (!window.ethereum)
        throw new Error("Install MetaMask, Rabby, or another EVM wallet.");
      await window.ethereum.request({ method: "eth_requestAccounts" });
      await refresh();
    } catch (connectError) {
      setError(readableError(connectError));
    } finally {
      connectingRef.current = false;
      setConnecting(false);
    }
  }, [refresh]);

  const getSigner = useCallback(async () => {
    const ethereum = window.ethereum;
    if (!ethereum || !address) throw new Error("Connect an EVM wallet first.");
    const expectedAddress = address.toLowerCase();
    const session = refreshSequence.current;
    const validate = async () => {
      const [accounts, chain] = await Promise.all([
        ethereum.request({ method: "eth_accounts" }) as Promise<string[]>,
        ethereum.request({ method: "eth_chainId" }),
      ]);
      if (window.ethereum !== ethereum || session !== refreshSequence.current || accounts[0]?.toLowerCase() !== expectedAddress) {
        throw new Error("Wallet changed. Choose the action again.");
      }
      if (BigInt(chain as string) !== CHAIN_ID) throw new Error("Switch to PulseChain before continuing.");
    };
    await validate();
    const signer = await new BrowserProvider(ethereum).getSigner(address);
    await validate();
    // Contracts may perform multiple asynchronous preflight reads after obtaining
    // a signer. Revalidate again at the final wallet request boundary.
    const send = signer.sendTransaction.bind(signer);
    signer.sendTransaction = async transaction => {
      if (transactionRequest.current) throw new Error("Finish the open wallet request before starting another action.");
      transactionRequest.current = true;
      try {
        await validate();
        if (transaction.chainId != null && BigInt(transaction.chainId) !== CHAIN_ID) throw new Error("Switch to PulseChain before continuing.");
        return await send({ ...transaction, chainId: CHAIN_ID });
      } finally { transactionRequest.current = false; }
    };
    return signer;
  }, [address]);

  return useMemo(
    () => ({
      address,
      chainId,
      isConnected: Boolean(address),
      isWrongNetwork: chainId !== null && chainId !== CHAIN_ID,
      connecting,
      error,
      connect,
      switchNetwork,
      getSigner,
    }),
    [address, chainId, connecting, error, connect, switchNetwork, getSigner],
  );
}

export type WalletState = ReturnType<typeof useWallet>;
