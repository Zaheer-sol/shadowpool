"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { usePoll } from "@/lib/api";
import { chainName } from "@/lib/format";
import { useWallet } from "@/lib/wallet";
import type { EnclaveInfo } from "@/lib/types";
import { ConnectButton } from "./ConnectButton";

const LINKS = [
  { href: "/trade", label: "Trade" },
  { href: "/vault", label: "Vault" },
  { href: "/orders", label: "Orders" },
  { href: "/analytics", label: "Analytics" },
  { href: "/security", label: "Security" },
  { href: "/docs", label: "Docs" },
];

export function Nav() {
  const pathname = usePathname();
  const { data: enclave, offline } = usePoll<EnclaveInfo>("/api/enclave", 6000);
  const { account, chainId, switchChain } = useWallet();
  const wrongNetwork = !!account && !!enclave && chainId !== null && chainId !== enclave.chainId;

  // On first connect to the wrong network, immediately offer the switch —
  // the app should start on the deployment chain like any well-behaved dapp.
  const prompted = useRef(false);
  useEffect(() => {
    if (wrongNetwork && !prompted.current && enclave) {
      prompted.current = true;
      void switchChain(enclave.chainId);
    }
  }, [wrongNetwork, enclave, switchChain]);

  return (
    <header className="sticky top-0 z-40 border-b border-line bg-bg/85 backdrop-blur">
      {wrongNetwork && (
        <div className="flex items-center justify-center gap-3 border-b border-warn/30 bg-warn/10 px-4 py-2 text-[12px] text-warn">
          <span>
            ⚠ Your wallet is on {chainName(chainId)}, but ShadowPool is deployed on {chainName(enclave.chainId)}.
          </span>
          <button
            onClick={() => void switchChain(enclave.chainId)}
            className="rounded-md border border-warn/50 px-2.5 py-1 font-medium transition-colors hover:bg-warn/20"
          >
            Switch to {chainName(enclave.chainId)}
          </button>
        </div>
      )}
      <div className="mx-auto flex h-14 max-w-6xl items-center gap-6 px-4 sm:px-6">
        <Link href="/" className="flex items-center gap-2.5">
          {/* Two offset circles: the visible market and the dark pool behind it. */}
          <svg width="22" height="22" viewBox="0 0 22 22" aria-hidden>
            <circle cx="9" cy="11" r="7" fill="none" stroke="var(--color-ink-3)" strokeWidth="1.5" />
            <circle cx="13" cy="11" r="7" fill="var(--color-bg)" stroke="var(--color-accent)" strokeWidth="1.5" />
          </svg>
          <span className="text-[15px] font-semibold tracking-tight">ShadowPool</span>
        </Link>

        <nav className="hidden items-center gap-1 md:flex">
          {LINKS.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              className={`rounded-md px-2.5 py-1.5 text-[13px] transition-colors ${
                pathname === l.href ? "bg-surface-2 text-ink" : "text-ink-2 hover:text-ink"
              }`}
            >
              {l.label}
            </Link>
          ))}
        </nav>

        <div className="ml-auto flex items-center gap-3">
          <span
            className="hidden items-center gap-2 rounded-full border border-line px-2.5 py-1 text-[11px] text-ink-2 sm:flex"
            title="Matching engine enclave status"
          >
            <span
              className={`h-1.5 w-1.5 rounded-full ${offline || !enclave ? "bg-ink-3" : "bg-accent enclave-dot"}`}
            />
            {offline || !enclave ? "Enclave offline" : "Enclave active"}
            {enclave && <span className="text-ink-3">· {chainName(enclave.chainId)}</span>}
          </span>
          <ConnectButton />
        </div>
      </div>
    </header>
  );
}
