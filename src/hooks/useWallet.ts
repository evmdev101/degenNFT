import { BrowserProvider } from "ethers";
import { useCallback, useEffect, useMemo, useState } from "react";
import { CHAIN_ID, CHAIN_HEX, PULSECHAIN } from "../config/contracts";
import { readableError } from "../lib/chain";

export function useWallet() {
  const [address, setAddress] = useState<string | null>(null);
  const [chainId, setChainId] = useState<bigint | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    if (!window.ethereum) return;
    const browserProvider = new BrowserProvider(window.ethereum);
    const [accounts, network] = await Promise.all([
      browserProvider.send("eth_accounts", []) as Promise<string[]>,
      browserProvider.getNetwork(),
    ]);
    setAddress(accounts[0] ?? null);
    setChainId(network.chainId);
  }, []);

  useEffect(() => {
    void refresh();
    const changed = () => void refresh();
    window.ethereum?.on?.("accountsChanged", changed);
    window.ethereum?.on?.("chainChanged", changed);
    return () => {
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
      setConnecting(false);
    }
  }, [refresh]);

  const getSigner = useCallback(async () => {
    if (!window.ethereum) throw new Error("Connect an EVM wallet first.");
    const browserProvider = new BrowserProvider(window.ethereum);
    const network = await browserProvider.getNetwork();
    if (network.chainId !== CHAIN_ID) await switchNetwork();
    return new BrowserProvider(window.ethereum).getSigner();
  }, [switchNetwork]);

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
