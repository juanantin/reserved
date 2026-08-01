"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
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

type WalletState = {
  address: string | null;
  chainId: string | null;
  wrongNetwork: boolean;
  connecting: boolean;
  error: string | null;
  connect: () => Promise<void>;
  disconnect: () => void;
  switchToBsc: () => Promise<void>;
  getSigner: () => Promise<ethers.JsonRpcSigner>;
};

// A single shared connection, not one per component. Every component that
// calls useWallet() reads and updates the SAME address/chainId state — so
// connecting from the navbar immediately reflects everywhere else (dashboard
// card, redeem panel) without depending on the wallet's own accountsChanged
// event to fire and every independent listener catching it.
const WalletContext = createContext<WalletState | null>(null);

export function WalletProvider({ children }: { children: ReactNode }) {
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

  // MetaMask/EIP-1193 has no cross-wallet-supported way for a dapp to revoke
  // its own permission — this is the standard "soft disconnect" pattern
  // basically every dapp uses: forget the address locally so the app treats
  // the user as disconnected, even though the wallet extension itself may
  // still remember the site (a fresh Connect click won't re-prompt approval).
  const disconnect = useCallback(() => {
    setAddress(null);
    setError(null);
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

  const value = useMemo<WalletState>(
    () => ({ address, chainId, wrongNetwork, connecting, error, connect, disconnect, switchToBsc, getSigner }),
    [address, chainId, wrongNetwork, connecting, error, connect, disconnect, switchToBsc, getSigner]
  );

  return <WalletContext.Provider value={value}>{children}</WalletContext.Provider>;
}

export function useWallet(): WalletState {
  const ctx = useContext(WalletContext);
  if (!ctx) throw new Error("useWallet() must be used within <WalletProvider>");
  return ctx;
}
