"use client";

/**
 * Wallet context with EIP-6963 multi-wallet discovery.
 *
 * With several wallet extensions installed, `window.ethereum` is a battleground
 * — wallets overwrite each other or stop injecting entirely. EIP-6963 fixes
 * this: every wallet announces itself with an event, we list them all, and the
 * user picks one. `window.ethereum` remains as a legacy fallback.
 */
import { BrowserProvider, JsonRpcSigner } from "ethers";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";

export interface Eip1193 {
  request(args: { method: string; params?: unknown[] }): Promise<unknown>;
  on?(event: string, cb: (...args: unknown[]) => void): void;
  removeListener?(event: string, cb: (...args: unknown[]) => void): void;
  providers?: Eip1193[]; // some legacy multi-wallet shims expose this
}

export interface WalletOption {
  uuid: string;
  name: string;
  icon: string; // data: URI per EIP-6963
}

interface Announced {
  info: WalletOption;
  provider: Eip1193;
}

declare global {
  interface Window {
    ethereum?: Eip1193;
  }
}

interface WalletState {
  account: string | null;
  chainId: number | null;
  /** Wallets discovered via EIP-6963 (plus a legacy entry if only window.ethereum exists). */
  wallets: WalletOption[];
  /** True while the picker should be shown (connect() found several wallets). */
  pickerOpen: boolean;
  closePicker(): void;
  /** No uuid: connect the only/last-used wallet, or open the picker. */
  connect(uuid?: string): Promise<void>;
  disconnect(): void;
  /** The chosen wallet's raw EIP-1193 provider — use for reads. */
  provider: Eip1193 | null;
  getSigner(): Promise<JsonRpcSigner>;
  /** Switch the wallet to a chain, registering it (correct symbol, RPC, explorer) if unknown. */
  switchChain(chainId: number): Promise<void>;
  /**
   * Hard guard for transactions: returns true only once the wallet is actually
   * on `chainId`, prompting a switch if needed. Every write path calls this
   * first so a transaction can never be sent on the wrong network.
   */
  ensureChain(chainId: number): Promise<boolean>;
}

/** Params for wallet_addEthereumChain, keyed by chain id. */
const CHAIN_PARAMS: Record<number, object> = {
  114: {
    chainId: "0x72",
    chainName: "Flare Testnet Coston2",
    nativeCurrency: { name: "Coston2 Flare", symbol: "C2FLR", decimals: 18 },
    rpcUrls: ["https://coston2-api.flare.network/ext/C/rpc"],
    blockExplorerUrls: ["https://coston2-explorer.flare.network"],
  },
  14: {
    chainId: "0xe",
    chainName: "Flare Mainnet",
    nativeCurrency: { name: "Flare", symbol: "FLR", decimals: 18 },
    rpcUrls: ["https://flare-api.flare.network/ext/C/rpc"],
    blockExplorerUrls: ["https://flare-explorer.flare.network"],
  },
};

const WalletContext = createContext<WalletState | null>(null);
export const LAST_WALLET_KEY = "shadowpool.lastWallet";
const LEGACY_UUID = "legacy-window-ethereum";

export function WalletProvider({ children }: { children: React.ReactNode }) {
  const [announced, setAnnounced] = useState<Announced[]>([]);
  const [selected, setSelected] = useState<Announced | null>(null);
  const [account, setAccount] = useState<string | null>(null);
  const [chainId, setChainId] = useState<number | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const announcedRef = useRef<Announced[]>([]);

  // --- discovery ---
  useEffect(() => {
    const onAnnounce = (event: Event) => {
      const detail = (event as CustomEvent<Announced>).detail;
      if (!detail?.info?.uuid) return;
      setAnnounced((prev) => {
        if (prev.some((a) => a.info.uuid === detail.info.uuid)) return prev;
        const next = [...prev, detail];
        announcedRef.current = next;
        return next;
      });
    };
    window.addEventListener("eip6963:announceProvider", onAnnounce);
    window.dispatchEvent(new Event("eip6963:requestProvider"));

    // Legacy fallback: only if nothing announces itself shortly after load.
    const legacyTimer = setTimeout(() => {
      if (announcedRef.current.length === 0 && window.ethereum) {
        const eth = window.ethereum.providers?.[0] ?? window.ethereum;
        const legacy: Announced = {
          info: { uuid: LEGACY_UUID, name: "Browser wallet", icon: "" },
          provider: eth,
        };
        announcedRef.current = [legacy];
        setAnnounced([legacy]);
      }
    }, 400);

    return () => {
      window.removeEventListener("eip6963:announceProvider", onAnnounce);
      clearTimeout(legacyTimer);
    };
  }, []);

  // --- silent reconnect to the last-used wallet ---
  useEffect(() => {
    if (selected || announced.length === 0) return;
    const lastUuid = localStorage.getItem(LAST_WALLET_KEY);
    const match = announced.find((a) => a.info.uuid === lastUuid);
    if (!match) return;
    match.provider
      .request({ method: "eth_accounts" })
      .then((accs) => {
        const list = accs as string[];
        if (list.length > 0) {
          setSelected(match);
          setAccount(list[0]);
          match.provider
            .request({ method: "eth_chainId" })
            .then((id) => setChainId(Number(id)))
            .catch(() => {});
        }
      })
      .catch(() => {});
  }, [announced, selected]);

  // --- react to account/chain switches on the chosen wallet ---
  useEffect(() => {
    const eth = selected?.provider;
    if (!eth) return;
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
  }, [selected]);

  const connectTo = useCallback(async (target: Announced) => {
    try {
      const accs = (await target.provider.request({ method: "eth_requestAccounts" })) as string[];
      setSelected(target);
      setAccount(accs[0] ?? null);
      setChainId(Number(await target.provider.request({ method: "eth_chainId" })));
      localStorage.setItem(LAST_WALLET_KEY, target.info.uuid);
      setPickerOpen(false);
    } catch (err) {
      const code = (err as { code?: number }).code;
      if (code !== 4001) console.warn(`connect to ${target.info.name} failed:`, err);
    }
  }, []);

  const connect = useCallback(
    async (uuid?: string) => {
      const list = announcedRef.current;
      if (list.length === 0) {
        window.open("https://metamask.io/download/", "_blank");
        return;
      }
      const target = uuid
        ? list.find((a) => a.info.uuid === uuid)
        : list.length === 1
          ? list[0]
          : list.find((a) => a.info.uuid === localStorage.getItem(LAST_WALLET_KEY));
      if (!target) {
        setPickerOpen(true); // several wallets, no memory of a choice — ask
        return;
      }
      await connectTo(target);
    },
    [connectTo],
  );

  const disconnect = useCallback(() => {
    setSelected(null);
    setAccount(null);
    setChainId(null);
    localStorage.removeItem(LAST_WALLET_KEY);
  }, []);

  const getSigner = useCallback(async () => {
    if (!selected) throw new Error("No wallet connected");
    return new BrowserProvider(selected.provider as never).getSigner();
  }, [selected]);

  const switchChain = useCallback(
    async (targetChainId: number) => {
      const eth = selected?.provider;
      if (!eth) return;
      const hexId = `0x${targetChainId.toString(16)}`;
      try {
        await eth.request({ method: "wallet_switchEthereumChain", params: [{ chainId: hexId }] });
      } catch (err) {
        // 4902: the wallet doesn't know this chain — register it with the
        // proper native-currency symbol so gas doesn't display as "ETH".
        const code = (err as { code?: number }).code;
        const params = CHAIN_PARAMS[targetChainId];
        if (code === 4902 && params) {
          try {
            await eth.request({ method: "wallet_addEthereumChain", params: [params] });
          } catch { /* user declined */ }
        } else if (code !== 4001) {
          console.warn("switchChain failed:", err);
        }
      }
    },
    [selected],
  );

  const ensureChain = useCallback(
    async (targetChainId: number) => {
      const eth = selected?.provider;
      if (!eth) return false;
      const read = async () =>
        Number(await eth.request({ method: "eth_chainId" }).catch(() => 0));
      if ((await read()) === targetChainId) return true;
      await switchChain(targetChainId);
      const after = await read();
      setChainId(after || null);
      return after === targetChainId;
    },
    [selected, switchChain],
  );

  const value = useMemo(
    () => ({
      account,
      chainId,
      wallets: announced.map((a) => a.info),
      pickerOpen,
      closePicker: () => setPickerOpen(false),
      connect,
      disconnect,
      provider: selected?.provider ?? null,
      getSigner,
      switchChain,
      ensureChain,
    }),
    [account, chainId, announced, pickerOpen, connect, disconnect, selected, getSigner, switchChain, ensureChain],
  );

  return <WalletContext.Provider value={value}>{children}</WalletContext.Provider>;
}

export function useWallet(): WalletState {
  const ctx = useContext(WalletContext);
  if (!ctx) throw new Error("useWallet outside WalletProvider");
  return ctx;
}
