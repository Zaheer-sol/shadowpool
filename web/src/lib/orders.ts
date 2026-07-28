"use client";

/**
 * Plaintext order details live ONLY here — the trader's own browser storage.
 * On-chain there is just an encrypted blob; this is how the Orders page can
 * show you your own direction/size/price without leaking them anywhere.
 */
import type { LocalOrder } from "./types";

const key = (account: string) => `shadowpool.orders.${account.toLowerCase()}`;

export function loadOrders(account: string): LocalOrder[] {
  try {
    return JSON.parse(localStorage.getItem(key(account)) ?? "[]") as LocalOrder[];
  } catch {
    return [];
  }
}

export function saveOrder(account: string, order: LocalOrder): void {
  const all = loadOrders(account);
  all.push(order);
  localStorage.setItem(key(account), JSON.stringify(all));
}
