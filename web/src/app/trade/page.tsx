"use client";

import { usePoll } from "@/lib/api";
import { fmtPrice } from "@/lib/format";
import { OrderForm } from "@/components/OrderForm";
import { PriceChart } from "@/components/PriceChart";
import { TradesFeed } from "@/components/TradesFeed";
import type { EnclaveInfo, PricesResponse } from "@/lib/types";

export default function TradePage() {
  const { data: enclave, offline } = usePoll<EnclaveInfo>("/api/enclave", 6000);
  const { data: prices } = usePoll<PricesResponse>("/api/prices", 3000);

  if (!enclave) {
    return (
      <div className="mx-auto max-w-6xl px-4 py-24 text-center text-[14px] text-ink-3 sm:px-6">
        {offline
          ? "The ShadowPool node is unreachable. Start the relay service and refresh."
          : "Connecting to the enclave…"}
      </div>
    );
  }

  const pair = enclave.pairs[0];
  const feed = prices?.[pair.pair];
  const latest = feed?.latest ?? null;
  const history = feed?.history ?? [];
  const first = history[0]?.price;
  const change =
    latest && first && first !== "0"
      ? ((Number(latest) - Number(first)) / Number(first)) * 100
      : null;

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
      {/* Pair header */}
      <div className="mb-5 flex flex-wrap items-baseline gap-x-5 gap-y-2">
        <h1 className="text-xl font-semibold tracking-tight">{pair.pair}</h1>
        <span className="num text-xl text-accent">{latest ? fmtPrice(latest) : "-"}</span>
        {change !== null && (
          <span className={`num text-[13px] ${change >= 0 ? "text-buy" : "text-sell"}`}>
            {change >= 0 ? "▲" : "▼"} {Math.abs(change).toFixed(2)}% session
          </span>
        )}
        <span className="ml-auto text-[12px] text-ink-3">reference price · Flare FTSO</span>
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_360px]">
        {/* Chart */}
        <div className="panel">
          <div className="panel-head">
            <h2 className="text-[13px] font-medium text-ink-2">FTSO price · {pair.pair}</h2>
            <span className="text-[11px] text-ink-3">updates every ~2s</span>
          </div>
          <div className="p-3">
            {history.length > 1 ? (
              <PriceChart history={history} />
            ) : (
              <div className="flex h-[320px] items-center justify-center text-[13px] text-ink-3">
                Collecting price history…
              </div>
            )}
          </div>
        </div>

        {/* Order form */}
        <OrderForm enclave={enclave} pair={pair} ftsoPrice={latest} />
      </div>

      {/* Recent settled trades */}
      <div className="panel mt-4">
        <div className="panel-head">
          <h2 className="text-[13px] font-medium text-ink-2">Recent settlements</h2>
          <span className="text-[11px] text-ink-3">anonymized · no addresses, no order ids</span>
        </div>
        <div className="overflow-x-auto">
          <TradesFeed enclave={enclave} />
        </div>
      </div>
    </div>
  );
}
