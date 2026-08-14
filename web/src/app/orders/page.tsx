"use client";

import { useCallback, useEffect, useState } from "react";
import { BrowserProvider, Contract } from "ethers";
import { ORDERBOOK_ABI, ORDER_STATUS } from "@/lib/abi";
import { usePoll } from "@/lib/api";
import { explorerTx, fmtAmount, fmtPrice, shortHash, timeAgo } from "@/lib/format";
import { loadOrders } from "@/lib/orders";
import { useWallet } from "@/lib/wallet";
import type { EnclaveInfo, LocalOrder } from "@/lib/types";

interface OrderRow extends LocalOrder {
  status: string;
  depositRemaining: bigint;
}

export default function OrdersPage() {
  const { data: enclave } = usePoll<EnclaveInfo>("/api/enclave", 8000);
  const { account, connect, provider: eip1193, ensureChain } = useWallet();
  const [rows, setRows] = useState<OrderRow[]>([]);
  const [busy, setBusy] = useState("");
  const [note, setNote] = useState("");
  const [reload, setReload] = useState(0);

  useEffect(() => {
    if (!enclave || !account || !eip1193) {
      setRows([]);
      return;
    }
    let alive = true;
    const provider = new BrowserProvider(eip1193 as never);
    const book = new Contract(enclave.contracts.orderBook, ORDERBOOK_ABI, provider);
    const load = async () => {
      const local = loadOrders(account).reverse();
      const next = await Promise.all(
        local.map(async (o) => {
          try {
            const onchain = await book.getOrder(o.orderId);
            const expired =
              ORDER_STATUS[Number(onchain.status)] === "Active" &&
              o.expiry > 0 &&
              o.expiry <= Math.floor(Date.now() / 1000);
            return {
              ...o,
              status: expired ? "Expired" : ORDER_STATUS[Number(onchain.status)] ?? "Unknown",
              depositRemaining: onchain.depositRemaining as bigint,
            };
          } catch {
            return { ...o, status: "Unknown", depositRemaining: 0n };
          }
        }),
      );
      if (alive) setRows(next);
    };
    void load();
    const id = setInterval(load, 5000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [enclave, account, reload, eip1193]);

  const cancel = useCallback(
    async (orderId: string) => {
      if (!enclave) return;
      setBusy(orderId);
      setNote("");
      try {
        if (!(await ensureChain(enclave.chainId))) {
          throw new Error("Wrong network. Approve the switch in your wallet, then try again.");
        }
        const provider = new BrowserProvider(eip1193 as never);
        const signer = await provider.getSigner();
        const book = new Contract(enclave.contracts.orderBook, ORDERBOOK_ABI, signer);
        const tx = await book.cancelOrder(orderId);
        await tx.wait();
        setNote("Order cancelled. Collateral unlocked.");
        setReload((n) => n + 1);
      } catch (err) {
        const msg = (err as Error).message ?? "failed";
        setNote(msg.includes("user rejected") ? "Transaction rejected." : msg.slice(0, 140));
      } finally {
        setBusy("");
      }
    },
    [enclave, eip1193, ensureChain],
  );

  // Expired orders belong here, not in history: the enclave stops matching them
  // but the contract has no expiry concept, so their collateral stays locked
  // until the trader cancels. Filing them under "past" hid the only control
  // that can release it.
  const open = rows.filter((r) => r.status === "Active" || r.status === "Expired");
  const past = rows.filter((r) => r.status !== "Active" && r.status !== "Expired");
  const expiredCount = open.filter((r) => r.status === "Expired").length;

  // Both sides of the same pair open under one account can never fill each
  // other — the engine and the contract both reject self-trades. Without this
  // the orders just sit there looking like the pool is broken.
  const selfCrossing = open.find(
    (a) => a.direction === "buy" && open.some((b) => b.direction === "sell" && b.pair === a.pair),
  )?.pair;

  if (!enclave) {
    return <div className="mx-auto max-w-6xl px-4 py-24 text-center text-ink-3 sm:px-6">Connecting…</div>;
  }

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
      <h1 className="text-xl font-semibold tracking-tight">Orders</h1>
      <p className="mt-1 max-w-2xl text-[13px] text-ink-2">
        Details below are decrypted from <em>your</em> browser&apos;s local storage. The chain holds only
        ciphertext. Anyone else inspecting these orders on-chain sees an opaque blob.
      </p>

      {!account ? (
        <div className="panel mt-6 px-6 py-16 text-center">
          <p className="text-[14px] text-ink-2">Connect a wallet to see your orders.</p>
          <button
            onClick={() => void connect()}
            className="mt-5 rounded-md bg-accent px-6 py-2.5 text-[13px] font-semibold text-bg hover:opacity-90"
          >
            Connect wallet
          </button>
        </div>
      ) : (
        <>
          {expiredCount > 0 && (
            <div className="mt-6 rounded-md border border-warn/40 bg-warn/10 px-4 py-3 text-[13px] leading-6 text-warn">
              {expiredCount === 1 ? "One order has" : `${expiredCount} orders have`} passed their
              expiry. The matching engine no longer considers them, but their collateral stays
              locked until you release it, because expiry is part of the encrypted order and the
              contract cannot enforce it. Hit <strong>Reclaim</strong> to get those funds back.
            </div>
          )}

          {selfCrossing && (
            <div className="mt-6 rounded-md border border-warn/40 bg-warn/10 px-4 py-3 text-[13px] leading-6 text-warn">
              You have an active buy <em>and</em> an active sell on {selfCrossing}. These will never
              match each other: trading with yourself is blocked by both the matching engine and the
              settlement contract, since it would be wash trading. They stay open, with collateral
              locked, until a different trader takes the other side. Cancel one to free it.
            </div>
          )}

          <Section title={`Open (${open.length})`}>
            <OrderTable
              rows={open}
              enclave={enclave}
              action={(r) => (
                <button
                  disabled={busy === r.orderId}
                  onClick={() => void cancel(r.orderId)}
                  className="rounded-md border border-line px-3 py-1 text-[12px] text-ink-2 transition-colors hover:border-sell hover:text-sell disabled:opacity-40"
                >
                  {busy === r.orderId
                    ? "Working…"
                    : r.status === "Expired"
                      ? "Reclaim"
                      : "Cancel"}
                </button>
              )}
              empty="No active orders. Place one from the Trade page."
            />
          </Section>
          <Section title={`History (${past.length})`}>
            <OrderTable rows={past} enclave={enclave} empty="Filled, cancelled, and expired orders appear here." />
          </Section>
          {note && <p className="mt-4 text-[13px] text-ink-2">{note}</p>}
        </>
      )}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="panel mt-6">
      <div className="panel-head">
        <h2 className="text-[13px] font-medium text-ink-2">{title}</h2>
      </div>
      <div className="overflow-x-auto">{children}</div>
    </div>
  );
}

function StatusPill({ status }: { status: string }) {
  const styles: Record<string, string> = {
    Active: "border-accent-dim text-accent",
    Filled: "border-buy/50 text-buy",
    Cancelled: "border-line-2 text-ink-3",
    Expired: "border-warn/50 text-warn",
  };
  return (
    <span className={`rounded-full border px-2.5 py-0.5 text-[11px] ${styles[status] ?? "border-line-2 text-ink-3"}`}>
      {status}
    </span>
  );
}

function OrderTable({
  rows,
  enclave,
  action,
  empty,
}: {
  rows: OrderRow[];
  enclave: EnclaveInfo;
  action?: (r: OrderRow) => React.ReactNode;
  empty: string;
}) {
  if (rows.length === 0) {
    return <p className="px-5 py-8 text-center text-[13px] text-ink-3">{empty}</p>;
  }
  const meta = enclave.pairs[0];
  return (
    <table className="w-full text-[13px]">
      <thead>
        <tr className="text-left text-[11px] uppercase tracking-[0.12em] text-ink-3">
          <th className="px-5 py-2.5 font-medium">Order</th>
          <th className="px-2 py-2.5 font-medium">Side</th>
          <th className="px-2 py-2.5 text-right font-medium">Amount</th>
          <th className="px-2 py-2.5 text-right font-medium">Price</th>
          <th className="px-2 py-2.5 font-medium">Status</th>
          <th className="px-2 py-2.5 text-right font-medium">Placed</th>
          {action && <th className="px-5 py-2.5" />}
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => {
          const link = explorerTx(enclave.chainId, r.txHash);
          const [base] = r.pair.split("/");
          return (
            <tr key={r.orderId} className="border-t border-line/60">
              <td className="num px-5 py-3 text-ink-2">
                {link ? (
                  <a className="hover:text-accent" href={link} target="_blank" rel="noreferrer">
                    {shortHash(r.orderId)}
                  </a>
                ) : (
                  shortHash(r.orderId)
                )}
              </td>
              <td className={`px-2 py-3 font-medium ${r.direction === "buy" ? "text-buy" : "text-sell"}`}>
                {r.direction === "buy" ? "↑ Buy" : "↓ Sell"}
              </td>
              <td className="num px-2 py-3 text-right">
                {fmtAmount(r.amount, meta.baseDecimals)} <span className="text-ink-3">{base}</span>
              </td>
              <td className="num px-2 py-3 text-right">
                {r.limitPrice ? fmtPrice(r.limitPrice) : <span className="text-ink-3">market</span>}
              </td>
              <td className="px-2 py-3">
                <StatusPill status={r.status} />
              </td>
              <td className="px-2 py-3 text-right text-ink-3">{timeAgo(r.submittedAt)}</td>
              {action && <td className="px-5 py-3 text-right">{action(r)}</td>}
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
