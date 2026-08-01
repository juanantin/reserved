"use client";

import { useCallback, useEffect, useState } from "react";
import { ethers } from "ethers";
import { BSC_CHAIN_ID_HEX, BSC_CHAIN_PARAMS } from "./contracts";

// Minimal EIP-1193 surface — avoids pulling in a full wallet-connector library
// for a single injected-provider (MetaMask and compatible) flow.
type Eip1193Provider = {
  request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
  on: (event: string, handler: (...args: unknown[]) => void) => void;
  removeListener: (event: string, handler: (...args: unknown[]) => void) => void;
};

declare global {
  interface Window {
    ethereum?: Eip1193Provider;
  }
}

export function useWallet() {
  const [address, setAddress] = useState<string | null>(null);
  const [chainId, setChainId] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const wrongNetwork = chainId !== null && chainId !== BSC_CHAIN_ID_HEX;

  const connect = useCallback(async () => {
    setError(null);
    if (!window.ethereum) {
      setError("No wallet found — install MetaMask or another BNB Chain-compatible wallet.");
      return;
    }
    setConnecting(true);
    try {
      const accounts = (await window.ethereum.request({ method: "eth_requestAccounts" })) as string[];
      const currentChainId = (await window.ethereum.request({ method: "eth_chainId" })) as string;
      setAddress(accounts[0] ?? null);
      setChainId(currentChainId);
    } catch {
      setError("Connection request was rejected or failed.");
    } finally {
      setConnecting(false);
    }
  }, []);

  const switchToBsc = useCallback(async () => {
    if (!window.ethereum) return;
    try {
      await window.ethereum.request({
        method: "wallet_switchEthereumChain",
        params: [{ chainId: BSC_CHAIN_ID_HEX }],
      });
    } catch (switchError) {
      // 4902 = chain not added to the wallet yet.
      if ((switchError as { code?: number }).code === 4902) {
        await window.ethereum.request({
          method: "wallet_addEthereumChain",
          params: [BSC_CHAIN_PARAMS],
        });
      }
    }
  }, []);

  useEffect(() => {
    if (!window.ethereum) return;
    const eth = window.ethereum;

    const handleAccountsChanged = (...args: unknown[]) => {
      const accounts = args[0] as string[];
      setAddress(accounts[0] ?? null);
    };
    const handleChainChanged = (...args: unknown[]) => {
      setChainId(args[0] as string);
    };

    eth.on("accountsChanged", handleAccountsChanged);
    eth.on("chainChanged", handleChainChanged);

    // Pick up an already-connected wallet (e.g. returning visitor) without
    // forcing a fresh connect prompt.
    eth.request({ method: "eth_accounts" }).then((accounts) => {
      const list = accounts as string[];
      if (list.length > 0) setAddress(list[0]);
    });
    eth.request({ method: "eth_chainId" }).then((id) => setChainId(id as string));

    return () => {
      eth.removeListener("accountsChanged", handleAccountsChanged);
      eth.removeListener("chainChanged", handleChainChanged);
    };
  }, []);

  const getSigner = useCallback(async () => {
    if (!window.ethereum) throw new Error("No wallet found.");
    const provider = new ethers.BrowserProvider(window.ethereum);
    return provider.getSigner();
  }, []);

  return { address, chainId, wrongNetwork, connecting, error, connect, switchToBsc, getSigner };
}
