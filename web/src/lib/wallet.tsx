"use client";

/**
 * Thin MetaMask wallet context over ethers v6 — account, chain, signer access.
 */
import { BrowserProvider, JsonRpcSigner } from "ethers";
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

interface Eip1193 {
  request(args: { method: string; params?: unknown[] }): Promise<unknown>;
  on?(event: string, cb: (...args: unknown[]) => void): void;
  removeListener?(event: string, cb: (...args: unknown[]) => void): void;
}

declare global {
  interface Window {
    ethereum?: Eip1193;
  }
}

interface WalletState {
  account: string | null;
  chainId: number | null;
  hasWallet: boolean;
  connect(): Promise<void>;
  getSigner(): Promise<JsonRpcSigner>;
}

const WalletContext = createContext<WalletState | null>(null);

export function WalletProvider({ children }: { children: React.ReactNode }) {
  const [account, setAccount] = useState<string | null>(null);
  const [chainId, setChainId] = useState<number | null>(null);
  const [hasWallet, setHasWallet] = useState(false);

  useEffect(() => {
    const eth = window.ethereum;
    if (!eth) return;
    setHasWallet(true);

    void eth.request({ method: "eth_accounts" }).then((accs) => {
      const list = accs as string[];
      if (list.length > 0) setAccount(list[0]);
    });
    void eth.request({ method: "eth_chainId" }).then((id) => setChainId(Number(id)));

    const onAccounts = (...args: unknown[]) => {
      const list = args[0] as string[];
      setAccount(list[0] ?? null);
    };
    const onChain = (...args: unknown[]) => setChainId(Number(args[0]));
    eth.on?.("accountsChanged", onAccounts);
    eth.on?.("chainChanged", onChain);
    return () => {
      eth.removeListener?.("accountsChanged", onAccounts);
      eth.removeListener?.("chainChanged", onChain);
    };
  }, []);

  const connect = useCallback(async () => {
    const eth = window.ethereum;
    if (!eth) {
      window.open("https://metamask.io/download/", "_blank");
      return;
    }
    const accs = (await eth.request({ method: "eth_requestAccounts" })) as string[];
    setAccount(accs[0] ?? null);
    setChainId(Number(await eth.request({ method: "eth_chainId" })));
  }, []);

  const getSigner = useCallback(async () => {
    if (!window.ethereum) throw new Error("No wallet");
    return new BrowserProvider(window.ethereum as never).getSigner();
  }, []);

  const value = useMemo(
    () => ({ account, chainId, hasWallet, connect, getSigner }),
    [account, chainId, hasWallet, connect, getSigner],
  );

  return <WalletContext.Provider value={value}>{children}</WalletContext.Provider>;
}

export function useWallet(): WalletState {
  const ctx = useContext(WalletContext);
  if (!ctx) throw new Error("useWallet outside WalletProvider");
  return ctx;
}
