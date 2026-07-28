"use client";

import Link from "next/link";
import { usePoll } from "@/lib/api";
import { fmtAmount, fmtPrice } from "@/lib/format";
import { Stat } from "@/components/Stat";
import type { EnclaveInfo, PricesResponse, StatsResponse } from "@/lib/types";

const STEPS = [
  {
    n: "01",
    title: "Deposit",
    body: "Move FXRP or USDC into the ShadowVault. Deposits are the only thing the market ever sees.",
  },
  {
    n: "02",
    title: "Encrypt",
    body: "Your order — side, size, price — is sealed in your browser to the enclave's key. On-chain it is an unreadable blob.",
  },
  {
    n: "03",
    title: "Match in the dark",
    body: "Inside a Flare Confidential Compute TEE, the matching engine crosses orders against FTSO reference prices.",
  },
  {
    n: "04",
    title: "Settle on-chain",
    body: "A signed settlement instruction moves vault balances atomically, with an on-chain FTSO price check.",
  },
];

const FEATURES = [
  {
    title: "Private orders",
    body: "Order direction, size, price, and your identity per order never leave the hardware enclave. Node operators included.",
  },
  {
    title: "Fair matching",
    body: "Executions reference live FTSO prices and are clamped to a 2% band on-chain — a compromised matcher still can't fill you off-market.",
  },
  {
    title: "Trustless settlement",
    body: "Every fill settles through a contract that verifies the enclave's signature before a single token moves.",
  },
];

export default function Landing() {
  const { data: enclave } = usePoll<EnclaveInfo>("/api/enclave", 8000);
  const { data: prices } = usePoll<PricesResponse>("/api/prices", 5000);
  const { data: stats } = usePoll<StatsResponse>("/api/stats", 8000);

  const fxrp = prices?.["FXRP/USDC"]?.latest ?? null;
  const vol = stats?.volume?.["24h"]?.["FXRP/USDC"];

  return (
    <div>
      {/* Hero */}
      <section className="grid-field relative border-b border-line">
        <div className="mx-auto max-w-6xl px-4 pb-20 pt-24 text-center sm:px-6">
          <p className="mb-5 inline-flex items-center gap-2 rounded-full border border-line px-3 py-1 text-[11px] uppercase tracking-[0.16em] text-ink-2">
            <span className="h-1.5 w-1.5 rounded-full bg-accent enclave-dot" />
            The first dark pool on Flare
          </p>
          <h1 className="font-serif text-5xl leading-[1.05] tracking-tight sm:text-7xl">
            Trade large.
            <br />
            <em className="text-accent">Stay private.</em>
          </h1>
          <p className="mx-auto mt-6 max-w-xl text-[15px] leading-7 text-ink-2">
            On a transparent chain, a large order is a signal everyone else trades against. ShadowPool
            matches FAsset orders inside a hardware enclave — encrypted until the moment they settle.
          </p>
          <div className="mt-9 flex items-center justify-center gap-3">
            <Link
              href="/trade"
              className="rounded-md bg-accent px-6 py-3 text-[14px] font-semibold text-bg transition-opacity hover:opacity-90"
            >
              Enter the pool
            </Link>
            <Link
              href="/security"
              className="rounded-md border border-line px-6 py-3 text-[14px] text-ink-2 transition-colors hover:border-line-2 hover:text-ink"
            >
              How it stays private
            </Link>
          </div>
        </div>
      </section>

      {/* Live stats */}
      <section className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
        <div className="grid gap-3 sm:grid-cols-4">
          <Stat label="FXRP / USDC" value={fxrp ? fmtPrice(fxrp) : "—"} sub="live FTSO price" />
          <Stat
            label="24h volume"
            value={vol ? `$${fmtAmount(vol, 6)}` : "$0"}
            sub="settled through the pool"
          />
          <Stat
            label="Open orders"
            value={enclave ? String(enclave.openOrders) : "—"}
            sub="count only — contents are sealed"
          />
          <Stat
            label="Trades settled"
            value={stats ? String(stats.tradeCount) : "—"}
            sub="verified on-chain"
          />
        </div>
      </section>

      {/* How it works */}
      <section className="mx-auto max-w-6xl px-4 py-12 sm:px-6">
        <h2 className="font-serif text-3xl tracking-tight">Four steps, one secret</h2>
        <div className="mt-8 grid gap-3 md:grid-cols-4">
          {STEPS.map((s) => (
            <div key={s.n} className="panel p-5">
              <p className="num text-[12px] text-accent">{s.n}</p>
              <h3 className="mt-2 text-[15px] font-semibold">{s.title}</h3>
              <p className="mt-2 text-[13px] leading-6 text-ink-2">{s.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Features */}
      <section className="mx-auto max-w-6xl px-4 py-12 pb-20 sm:px-6">
        <div className="grid gap-3 md:grid-cols-3">
          {FEATURES.map((f) => (
            <div key={f.title} className="panel p-6">
              <h3 className="text-[15px] font-semibold text-accent">{f.title}</h3>
              <p className="mt-2.5 text-[13px] leading-6 text-ink-2">{f.body}</p>
            </div>
          ))}
        </div>
        <p className="mt-10 text-center text-[12px] text-ink-3">
          Supported pairs: FXRP/USDC · FBTC/USDC coming soon
        </p>
      </section>
    </div>
  );
}
