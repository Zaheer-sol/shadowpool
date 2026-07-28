"use client";

import { useWallet } from "@/lib/wallet";
import { shortAddr } from "@/lib/format";

export function ConnectButton() {
  const { account, connect, hasWallet } = useWallet();

  if (account) {
    return (
      <span className="num rounded-md border border-line bg-surface px-3 py-1.5 text-[12px] text-ink-2">
        {shortAddr(account)}
      </span>
    );
  }
  return (
    <button
      onClick={() => void connect()}
      className="rounded-md bg-accent px-3.5 py-1.5 text-[13px] font-medium text-bg transition-opacity hover:opacity-90"
    >
      {hasWallet ? "Connect wallet" : "Install MetaMask"}
    </button>
  );
}
