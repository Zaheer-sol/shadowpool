"use client";

/**
 * Anonymized settled-trades feed. Everything shown here is already public
 * on-chain: pair, price, size, tx. No addresses, no order ids.
 */
import { usePoll } from "@/lib/api";
import { explorerTx, fmtAmount, fmtPrice, timeAgo } from "@/lib/format";
import type { EnclaveInfo, TradeRecord } from "@/lib/types";

export function TradesFeed({ enclave, limit = 12 }: { enclave: EnclaveInfo | null; limit?: number }) {
  const { data: trades } = usePoll<TradeRecord[]>(`/api/trades?limit=${limit}`, 4000);

  if (!trades || trades.length === 0) {
    return (
      <p className="px-5 py-8 text-center text-[13px] text-ink-3">
        No settled trades yet. Matched orders appear here the moment they clear on-chain.
      </p>
    );
  }

  const pairMeta = (pair: string) => enclave?.pairs.find((p) => p.pair === pair);

  return (
    <table className="w-full text-[13px]">
      <thead>
        <tr className="text-left text-[11px] uppercase tracking-[0.12em] text-ink-3">
          <th className="px-5 py-2.5 font-medium">Pair</th>
          <th className="px-2 py-2.5 text-right font-medium">Price</th>
          <th className="px-2 py-2.5 text-right font-medium">Size</th>
          <th className="hidden px-2 py-2.5 text-right font-medium sm:table-cell">Value</th>
          <th className="px-5 py-2.5 text-right font-medium">Settled</th>
        </tr>
      </thead>
      <tbody>
        {trades.map((t) => {
          const meta = pairMeta(t.pair);
          const [base, quote] = t.pair.split("/");
          const link = explorerTx(enclave?.chainId, t.txHash);
          return (
            <tr key={t.matchId} className="border-t border-line/60">
              <td className="px-5 py-2.5">{t.pair}</td>
              <td className="num px-2 py-2.5 text-right">{fmtPrice(t.executionPrice)}</td>
              <td className="num px-2 py-2.5 text-right">
                {fmtAmount(t.baseAmount, meta?.baseDecimals ?? 18)} <span className="text-ink-3">{base}</span>
              </td>
              <td className="num hidden px-2 py-2.5 text-right sm:table-cell">
                {fmtAmount(t.quoteAmount, meta?.quoteDecimals ?? 6)} <span className="text-ink-3">{quote}</span>
              </td>
              <td className="px-5 py-2.5 text-right text-ink-3">
                {link ? (
                  <a className="hover:text-accent" href={link} target="_blank" rel="noreferrer">
                    {timeAgo(t.timestamp)} ↗
                  </a>
                ) : (
                  timeAgo(t.timestamp)
                )}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
