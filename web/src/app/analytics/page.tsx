"use client";

import { usePoll } from "@/lib/api";
import { fmtAmount, fmtPrice } from "@/lib/format";
import { BarChart } from "@/components/BarChart";
import { PriceChart } from "@/components/PriceChart";
import { Stat } from "@/components/Stat";
import type { EnclaveInfo, PricesResponse, StatsResponse } from "@/lib/types";

export default function AnalyticsPage() {
  const { data: enclave } = usePoll<EnclaveInfo>("/api/enclave", 8000);
  const { data: stats } = usePoll<StatsResponse>("/api/stats", 6000);
  const { data: prices } = usePoll<PricesResponse>("/api/prices", 5000);

  const volumeSeries =
    stats?.series.map((s) => ({ day: s.day, value: Number(s.quoteVolume) / 1e6 })) ?? [];
  const countSeries = stats?.series.map((s) => ({ day: s.day, value: s.count })) ?? [];
  const history = prices?.["FXRP/USDC"]?.history ?? [];

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
      <h1 className="text-xl font-semibold tracking-tight">Analytics</h1>
      <p className="mt-1 max-w-2xl text-[13px] text-ink-2">
        Aggregate venue metrics only. Individual orders, trader identities, and open interest by
        account are structurally unavailable — they exist solely inside the enclave.
      </p>

      <div className="mt-6 grid gap-3 sm:grid-cols-4">
        <Stat
          label="24h volume"
          value={stats ? `$${fmtAmount(stats.volume["24h"]["FXRP/USDC"] ?? "0", 6)}` : "—"}
          sub="FXRP/USDC, settled"
        />
        <Stat label="Trades settled" value={stats ? String(stats.tradeCount) : "—"} sub="all time" />
        <Stat
          label="Avg trade size"
          value={stats ? `$${fmtAmount(stats.avgQuoteSize, 6)}` : "—"}
          sub="quote value per fill"
        />
        <Stat
          label="Settlement success"
          value={stats ? `${(stats.settlementSuccessRate * 100).toFixed(1)}%` : "—"}
          sub="TEE instructions accepted on-chain"
        />
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <div className="panel">
          <div className="panel-head">
            <h2 className="text-[13px] font-medium text-ink-2">Daily volume (USDC)</h2>
          </div>
          <div className="p-3">
            {volumeSeries.length > 0 ? (
              <BarChart points={volumeSeries} format="usd" />
            ) : (
              <Empty />
            )}
          </div>
        </div>
        <div className="panel">
          <div className="panel-head">
            <h2 className="text-[13px] font-medium text-ink-2">Daily matched trades</h2>
          </div>
          <div className="p-3">{countSeries.length > 0 ? <BarChart points={countSeries} /> : <Empty />}</div>
        </div>
      </div>

      <div className="panel mt-4">
        <div className="panel-head">
          <h2 className="text-[13px] font-medium text-ink-2">FTSO reference price — FXRP/USDC</h2>
          <span className="num text-[12px] text-ink-3">
            {prices?.["FXRP/USDC"]?.latest ? fmtPrice(prices["FXRP/USDC"].latest!) : "—"}
          </span>
        </div>
        <div className="p-3">
          {history.length > 1 ? <PriceChart history={history} height={260} /> : <Empty />}
        </div>
      </div>

      <p className="mt-4 text-[12px] text-ink-3">
        Open orders in the enclave right now: <span className="num">{enclave?.openOrders ?? "—"}</span>{" "}
        (count only — sizes and sides are sealed).
      </p>
    </div>
  );
}

function Empty() {
  return (
    <div className="flex h-[220px] items-center justify-center text-[13px] text-ink-3">
      No data yet — settle some trades to populate this chart.
    </div>
  );
}
