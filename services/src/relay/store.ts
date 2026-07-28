/**
 * Trade log persistence. Stores only what is already public on-chain
 * (settlement events) — never order contents. JSON file keeps the hackathon
 * deploy dependency-free; swap for Postgres in production.
 */
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname } from "node:path";

export interface TradeRecord {
  matchId: string;
  pair: string; // human name, e.g. "FXRP/USDC"
  executionPrice: string; // 18 decimals
  baseAmount: string;
  quoteAmount: string;
  txHash: string;
  timestamp: number;
}

export interface SettlementAttempt {
  ok: boolean;
  timestamp: number;
}

export class TradeStore {
  private trades: TradeRecord[] = [];
  private attempts: SettlementAttempt[] = [];

  constructor(private readonly file: string) {
    if (existsSync(file)) {
      try {
        const raw = JSON.parse(readFileSync(file, "utf8"));
        this.trades = raw.trades ?? [];
        this.attempts = raw.attempts ?? [];
      } catch {
        // corrupt file — start fresh rather than crash the relay
      }
    }
  }

  recordAttempt(ok: boolean): void {
    this.attempts.push({ ok, timestamp: Math.floor(Date.now() / 1000) });
    this.flush();
  }

  recordTrade(trade: TradeRecord): void {
    this.trades.push(trade);
    this.flush();
  }

  recent(limit = 50): TradeRecord[] {
    return this.trades.slice(-limit).reverse();
  }

  stats() {
    const now = Math.floor(Date.now() / 1000);
    const windows = { "24h": 86_400, "7d": 604_800, "30d": 2_592_000 } as const;
    const volume: Record<string, Record<string, string>> = {};
    for (const [label, secs] of Object.entries(windows)) {
      const byPair: Record<string, bigint> = {};
      for (const t of this.trades) {
        if (t.timestamp >= now - secs) {
          byPair[t.pair] = (byPair[t.pair] ?? 0n) + BigInt(t.quoteAmount);
        }
      }
      volume[label] = Object.fromEntries(Object.entries(byPair).map(([k, v]) => [k, v.toString()]));
    }
    const okCount = this.attempts.filter((a) => a.ok).length;
    return {
      tradeCount: this.trades.length,
      volume,
      settlementSuccessRate: this.attempts.length === 0 ? 1 : okCount / this.attempts.length,
      avgQuoteSize:
        this.trades.length === 0
          ? "0"
          : (
              this.trades.reduce((acc, t) => acc + BigInt(t.quoteAmount), 0n) / BigInt(this.trades.length)
            ).toString(),
    };
  }

  /** Daily trade series for the analytics page. */
  series(days = 30): { day: string; count: number; quoteVolume: string }[] {
    const byDay = new Map<string, { count: number; vol: bigint }>();
    for (const t of this.trades) {
      const day = new Date(t.timestamp * 1000).toISOString().slice(0, 10);
      const cur = byDay.get(day) ?? { count: 0, vol: 0n };
      cur.count += 1;
      cur.vol += BigInt(t.quoteAmount);
      byDay.set(day, cur);
    }
    return [...byDay.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .slice(-days)
      .map(([day, v]) => ({ day, count: v.count, quoteVolume: v.vol.toString() }));
  }

  private flush(): void {
    mkdirSync(dirname(this.file), { recursive: true });
    writeFileSync(this.file, JSON.stringify({ trades: this.trades, attempts: this.attempts }, null, 2));
  }
}
