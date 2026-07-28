/**
 * Internal order book — one per trading pair. Bids sorted best (highest) first,
 * asks sorted best (lowest) first; FIFO within a price level. Market orders sort
 * ahead of all limit orders on their side.
 */
import type { BookOrder } from "./types.js";

export class PairBook {
  readonly bids: BookOrder[] = [];
  readonly asks: BookOrder[] = [];

  insert(order: BookOrder): void {
    const side = order.direction === "buy" ? this.bids : this.asks;
    side.push(order);
    side.sort((a, b) => {
      // Market orders (null limit) take priority on both sides.
      if (a.limitPrice === null && b.limitPrice !== null) return -1;
      if (a.limitPrice !== null && b.limitPrice === null) return 1;
      if (a.limitPrice !== null && b.limitPrice !== null && a.limitPrice !== b.limitPrice) {
        const diff = a.limitPrice - b.limitPrice;
        // Bids: high price first. Asks: low price first.
        const sign = order.direction === "buy" ? -1 : 1;
        return diff > 0n ? sign : -sign;
      }
      return a.submittedAt - b.submittedAt; // FIFO tiebreak
    });
  }

  remove(orderId: string): BookOrder | undefined {
    for (const side of [this.bids, this.asks]) {
      const i = side.findIndex((o) => o.orderId === orderId);
      if (i >= 0) return side.splice(i, 1)[0];
    }
    return undefined;
  }

  /** Drop expired orders; returns what was pruned so the host can log it. */
  pruneExpired(now: number): BookOrder[] {
    const pruned: BookOrder[] = [];
    for (const side of [this.bids, this.asks]) {
      for (let i = side.length - 1; i >= 0; i--) {
        if (side[i].expiry > 0 && side[i].expiry <= now) pruned.push(...side.splice(i, 1));
      }
    }
    return pruned;
  }

  get bestBid(): BookOrder | undefined {
    return this.bids[0];
  }

  get bestAsk(): BookOrder | undefined {
    return this.asks[0];
  }

  get depth(): number {
    return this.bids.length + this.asks.length;
  }
}
