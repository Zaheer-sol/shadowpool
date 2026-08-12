"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useWallet } from "@/lib/wallet";

const ALWAYS_TABS = [{ href: "/trade", label: "Trade", icon: TradeIcon }] as const;

// Same rule as the desktop nav: these show your own funds and activity, so
// they're pointless — and a little misleading — to a disconnected visitor.
const GATED_TABS = [
  { href: "/vault", label: "Vault", icon: VaultIcon },
  { href: "/orders", label: "Orders", icon: OrdersIcon },
  { href: "/analytics", label: "Stats", icon: StatsIcon },
] as const;

const MORE_LINKS = [
  { href: "/security", label: "Security" },
  { href: "/docs", label: "Docs" },
] as const;

/**
 * Bottom tab bar for small screens. The top `Nav` collapses its link list at
 * `md`, which used to leave phones with no way to reach any page but the one
 * they landed on — this replaces that gap rather than reusing the desktop menu,
 * since a persistent bar is the pattern people already know from trading apps.
 */
export function MobileNav() {
  const pathname = usePathname();
  const { account } = useWallet();
  const [moreOpen, setMoreOpen] = useState(false);
  const moreActive = MORE_LINKS.some((l) => l.href === pathname);
  const tabs = account ? [...ALWAYS_TABS, ...GATED_TABS] : ALWAYS_TABS;

  return (
    <>
      {moreOpen && (
        <button
          aria-label="Close menu"
          onClick={() => setMoreOpen(false)}
          className="fixed inset-0 z-40 bg-bg/60 backdrop-blur-sm md:hidden"
        />
      )}

      {moreOpen && (
        <div className="fixed inset-x-3 bottom-[calc(4.25rem+env(safe-area-inset-bottom))] z-50 overflow-hidden rounded-xl border border-line bg-surface shadow-lg md:hidden">
          {MORE_LINKS.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              onClick={() => setMoreOpen(false)}
              className={`block px-4 py-3 text-[13px] ${
                pathname === l.href ? "bg-surface-2 text-ink" : "text-ink-2"
              }`}
            >
              {l.label}
            </Link>
          ))}
        </div>
      )}

      <nav
        className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-surface/95 backdrop-blur md:hidden"
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
        aria-label="Primary"
      >
        <div className="grid" style={{ gridTemplateColumns: `repeat(${tabs.length + 1}, 1fr)` }}>
          {tabs.map((tab) => {
            const active = pathname === tab.href;
            return (
              <Link
                key={tab.href}
                href={tab.href}
                onClick={() => setMoreOpen(false)}
                className="flex flex-col items-center gap-1 py-2.5 text-[10px] font-medium"
              >
                <tab.icon active={active} />
                <span className={active ? "text-accent" : "text-ink-3"}>{tab.label}</span>
              </Link>
            );
          })}
          <button
            type="button"
            onClick={() => setMoreOpen((v) => !v)}
            aria-expanded={moreOpen}
            className="flex flex-col items-center gap-1 py-2.5 text-[10px] font-medium"
          >
            <MoreIcon active={moreOpen || moreActive} />
            <span className={moreOpen || moreActive ? "text-accent" : "text-ink-3"}>More</span>
          </button>
        </div>
      </nav>
    </>
  );
}

type IconProps = { active: boolean };
const STROKE_ACTIVE = "var(--color-accent)";
const STROKE_IDLE = "var(--color-ink-3)";

function TradeIcon({ active }: IconProps) {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={active ? STROKE_ACTIVE : STROKE_IDLE} strokeWidth="1.8" aria-hidden>
      <path d="M4 7h13l-3-3M20 17H7l3 3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
function VaultIcon({ active }: IconProps) {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={active ? STROKE_ACTIVE : STROKE_IDLE} strokeWidth="1.8" aria-hidden>
      <rect x="4" y="5" width="16" height="14" rx="2" />
      <circle cx="12" cy="12" r="2.6" />
      <path d="M12 9.4v0M12 14.6v0" strokeLinecap="round" />
    </svg>
  );
}
function OrdersIcon({ active }: IconProps) {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={active ? STROKE_ACTIVE : STROKE_IDLE} strokeWidth="1.8" aria-hidden>
      <path d="M6 6h12M6 12h12M6 18h7" strokeLinecap="round" />
      <circle cx="4" cy="6" r="0.9" fill={active ? STROKE_ACTIVE : STROKE_IDLE} stroke="none" />
      <circle cx="4" cy="12" r="0.9" fill={active ? STROKE_ACTIVE : STROKE_IDLE} stroke="none" />
      <circle cx="4" cy="18" r="0.9" fill={active ? STROKE_ACTIVE : STROKE_IDLE} stroke="none" />
    </svg>
  );
}
function StatsIcon({ active }: IconProps) {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={active ? STROKE_ACTIVE : STROKE_IDLE} strokeWidth="1.8" aria-hidden>
      <path d="M5 19V10M12 19V5M19 19v-6" strokeLinecap="round" />
    </svg>
  );
}
function MoreIcon({ active }: IconProps) {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill={active ? STROKE_ACTIVE : STROKE_IDLE} stroke="none" aria-hidden>
      <circle cx="5" cy="12" r="1.6" />
      <circle cx="12" cy="12" r="1.6" />
      <circle cx="19" cy="12" r="1.6" />
    </svg>
  );
}
