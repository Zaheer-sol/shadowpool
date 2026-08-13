"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { usePoll } from "@/lib/api";
import { chainName } from "@/lib/format";
import { useWallet } from "@/lib/wallet";
import type { EnclaveInfo } from "@/lib/types";
import { ConnectButton } from "./ConnectButton";

// Vault/Orders/Analytics show your own funds and activity, so there's nothing
// there for a disconnected visitor to look at — surfacing them just invites a
// dead click into a wallet prompt. Trade/Security/Docs stay visible always.
const LINKS = [
  { href: "/trade", label: "Trade" },
  { href: "/vault", label: "Vault", gated: true },
  { href: "/orders", label: "Orders", gated: true },
  { href: "/analytics", label: "Analytics", gated: true },
  { href: "/security", label: "Security" },
  { href: "/docs", label: "Docs" },
];

export function Nav() {
  const pathname = usePathname();
  const { data: enclave, offline } = usePoll<EnclaveInfo>("/api/enclave", 6000);
  const { account, chainId, switchChain } = useWallet();
  const wrongNetwork = !!account && !!enclave && chainId !== null && chainId !== enclave.chainId;
  const links = LINKS.filter((l) => !l.gated || account);

  // On first connect to the wrong network, immediately offer the switch —
  // the app should start on the deployment chain like any well-behaved dapp.
  const prompted = useRef(false);
  useEffect(() => {
    if (wrongNetwork && !prompted.current && enclave) {
      prompted.current = true;
      void switchChain(enclave.chainId);
    }
  }, [wrongNetwork, enclave, switchChain]);

  // The bottom tab bar is the primary mobile nav once connected. Before that
  // there's nowhere for a phone to reach Trade/Security/Docs at all — this
  // menu is that entry point, scoped to disconnected so it doesn't duplicate
  // the tab bar once there's something to switch between.
  const [menuOpen, setMenuOpen] = useState(false);
  // Derived, not synced via effect: once connected the panel is gated off
  // below anyway, so folding that into `menuVisible` covers both "just
  // connected" and "connected on a later visit" without extra state.
  const menuVisible = menuOpen && !account;

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
          {links.map((l) => (
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
          {!account && (
            <button
              type="button"
              aria-label="Toggle menu"
              aria-expanded={menuVisible}
              onClick={() => setMenuOpen((v) => !v)}
              className="flex h-8 w-8 items-center justify-center rounded-md border border-line text-ink-2 md:hidden"
            >
              {menuVisible ? <CloseIcon /> : <BurgerIcon />}
            </button>
          )}
        </div>
      </div>

      {menuVisible && (
        <nav className="border-t border-line bg-bg px-4 pb-3 pt-1 md:hidden" aria-label="Menu">
          {links.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              onClick={() => setMenuOpen(false)}
              className={`block rounded-md px-2 py-2.5 text-[14px] ${
                pathname === l.href ? "text-ink" : "text-ink-2"
              }`}
            >
              {l.label}
            </Link>
          ))}
        </nav>
      )}
    </header>
  );
}

function BurgerIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <path d="M4 7h16M4 12h16M4 17h16" strokeLinecap="round" />
    </svg>
  );
}
function CloseIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <path d="M6 6l12 12M18 6L6 18" strokeLinecap="round" />
    </svg>
  );
}
