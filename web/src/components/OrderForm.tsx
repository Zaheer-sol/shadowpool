"use client";

import { useEffect, useMemo, useState } from "react";
import { BrowserProvider, Contract, Interface, parseUnits } from "ethers";
import { ORDERBOOK_ABI, VAULT_ABI } from "@/lib/abi";
import { encryptOrder } from "@/lib/enclave";
import { fmtAmount, fmtPrice } from "@/lib/format";
import { saveOrder } from "@/lib/orders";
import type { Direction, EnclaveInfo, PairInfo } from "@/lib/types";
import { useWallet } from "@/lib/wallet";

const EXPIRIES = [
  { label: "1 hour", secs: 3600 },
  { label: "4 hours", secs: 4 * 3600 },
  { label: "24 hours", secs: 24 * 3600 },
  { label: "7 days", secs: 7 * 24 * 3600 },
];

type Phase = "idle" | "encrypting" | "wallet" | "pending" | "done" | "error";

export function OrderForm({
  enclave,
  pair,
  ftsoPrice, // 18d string or null
  onSubmitted,
}: {
  enclave: EnclaveInfo;
  pair: PairInfo;
  ftsoPrice: string | null;
  onSubmitted?: () => void;
}) {
  const { account, connect, getSigner } = useWallet();
  const [direction, setDirection] = useState<Direction>("buy");
  const [orderType, setOrderType] = useState<"market" | "limit">("market");
  const [amount, setAmount] = useState("");
  const [limitPrice, setLimitPrice] = useState("");
  const [expiry, setExpiry] = useState(EXPIRIES[2].secs);
  const [padPct, setPadPct] = useState(0);
  const [phase, setPhase] = useState<Phase>("idle");
  const [note, setNote] = useState<string>("");

  const [base, quote] = pair.pair.split("/");

  // Vault balance for the collateral token of the chosen direction.
  const collateralToken = direction === "sell" ? pair.baseToken : pair.quoteToken;
  const collateralDecimals = direction === "sell" ? pair.baseDecimals : pair.quoteDecimals;
  const { data: balances } = useVaultBalance(enclave, account, collateralToken);

  const price18 = useMemo(() => {
    if (orderType === "limit") {
      try {
        return limitPrice ? parseUnits(limitPrice, 18) : null;
      } catch {
        return null;
      }
    }
    return ftsoPrice ? BigInt(ftsoPrice) : null;
  }, [orderType, limitPrice, ftsoPrice]);

  const amountBase = useMemo(() => {
    try {
      return amount ? parseUnits(amount, pair.baseDecimals) : null;
    } catch {
      return null;
    }
  }, [amount, pair.baseDecimals]);

  /**
   * Collateral to lock: base for sells; quote (with 1% market buffer) for buys.
   * Privacy padding over-locks beyond what the order needs, so the public
   * collateral amount is only an upper bound on the real size. Unused
   * collateral unlocks automatically when the order fills or is cancelled.
   */
  const collateral = useMemo(() => {
    if (!amountBase || !price18) return null;
    let exact: bigint;
    if (direction === "sell") {
      exact = amountBase;
    } else {
      const quoteScale = 10n ** BigInt(pair.quoteDecimals);
      const baseScale = 10n ** BigInt(pair.baseDecimals);
      exact = (amountBase * price18 * quoteScale) / (10n ** 18n * baseScale);
      if (orderType === "market") exact = (exact * 101n) / 100n;
    }
    return (exact * BigInt(100 + padPct)) / 100n;
  }, [amountBase, price18, direction, orderType, pair, padPct]);

  const insufficient =
    collateral !== null && balances !== null && collateral > balances.available;

  const canSubmit =
    !!account && !!amountBase && amountBase > 0n && !!price18 && !!collateral && !insufficient &&
    phase !== "encrypting" && phase !== "wallet" && phase !== "pending";

  async function submit() {
    if (!account || !amountBase || !collateral) return;
    try {
      setPhase("encrypting");
      setNote("Sealing order to the enclave key…");
      const payload = encryptOrder(
        {
          direction,
          pair: pair.pair,
          amount: amountBase.toString(),
          limitPrice: orderType === "limit" && price18 ? price18.toString() : null,
          expiry: Math.floor(Date.now() / 1000) + expiry,
          trader: account,
        },
        enclave.boxPublicKey,
      );

      setPhase("wallet");
      setNote("Confirm in your wallet…");
      const signer = await getSigner();
      const book = new Contract(enclave.contracts.orderBook, ORDERBOOK_ABI, signer);
      const tx = await book.submitOrder(pair.pairHash, payload, collateralToken, collateral);

      setPhase("pending");
      setNote("Waiting for confirmation…");
      const receipt = await tx.wait();

      // Recover the orderId from the OrderSubmitted event.
      const iface = new Interface(ORDERBOOK_ABI);
      let orderId = "";
      for (const log of receipt.logs) {
        try {
          const parsed = iface.parseLog(log);
          if (parsed?.name === "OrderSubmitted") orderId = parsed.args[0] as string;
        } catch { /* other contracts' logs */ }
      }
      saveOrder(account, {
        orderId,
        direction,
        pair: pair.pair,
        amount: amountBase.toString(),
        limitPrice: orderType === "limit" && price18 ? price18.toString() : null,
        expiry: Math.floor(Date.now() / 1000) + expiry,
        submittedAt: Math.floor(Date.now() / 1000),
        txHash: receipt.hash,
      });

      setPhase("done");
      setNote("Order encrypted and live. Only the enclave can read it.");
      setAmount("");
      onSubmitted?.();
    } catch (err) {
      setPhase("error");
      const msg = (err as Error).message ?? "failed";
      setNote(msg.includes("user rejected") ? "Transaction rejected." : msg.slice(0, 140));
    }
  }

  const dirColor = direction === "buy" ? "text-buy" : "text-sell";

  return (
    <div className="panel">
      <div className="grid grid-cols-2 border-b border-line">
        {(["buy", "sell"] as const).map((d) => (
          <button
            key={d}
            onClick={() => setDirection(d)}
            className={`py-3 text-[13px] font-semibold uppercase tracking-[0.1em] transition-colors ${
              direction === d
                ? d === "buy"
                  ? "border-b-2 border-buy text-buy"
                  : "border-b-2 border-sell text-sell"
                : "text-ink-3 hover:text-ink-2"
            }`}
          >
            {d === "buy" ? "↑ Buy" : "↓ Sell"} {base}
          </button>
        ))}
      </div>

      <div className="space-y-4 p-5">
        {/* Order type */}
        <div className="flex gap-2">
          {(["market", "limit"] as const).map((t) => (
            <button
              key={t}
              onClick={() => setOrderType(t)}
              className={`rounded-md border px-3 py-1.5 text-[12px] capitalize transition-colors ${
                orderType === t
                  ? "border-line-2 bg-surface-2 text-ink"
                  : "border-line text-ink-3 hover:text-ink-2"
              }`}
            >
              {t}
            </button>
          ))}
          <span className="num ml-auto self-center text-[12px] text-ink-3">
            FTSO {ftsoPrice ? fmtPrice(ftsoPrice) : "—"}
          </span>
        </div>

        {/* Amount */}
        <label className="block">
          <div className="mb-1.5 flex justify-between text-[12px] text-ink-3">
            <span>Amount ({base})</span>
            {balances && (
              <span className="num">
                vault: {fmtAmount(balances.available, collateralDecimals)}{" "}
                {direction === "sell" ? base : quote}
              </span>
            )}
          </div>
          <input
            type="number"
            min="0"
            placeholder="0.00"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            className="num w-full rounded-md border border-line bg-surface-2 px-3 py-2.5 text-[15px] outline-none transition-colors placeholder:text-ink-3 focus:border-accent-dim"
          />
        </label>

        {/* Limit price */}
        {orderType === "limit" && (
          <label className="block">
            <div className="mb-1.5 text-[12px] text-ink-3">Limit price ({quote} per {base})</div>
            <input
              type="number"
              min="0"
              placeholder={ftsoPrice ? fmtPrice(ftsoPrice) : "0.00"}
              value={limitPrice}
              onChange={(e) => setLimitPrice(e.target.value)}
              className="num w-full rounded-md border border-line bg-surface-2 px-3 py-2.5 text-[15px] outline-none transition-colors placeholder:text-ink-3 focus:border-accent-dim"
            />
          </label>
        )}

        {/* Expiry */}
        <label className="block">
          <div className="mb-1.5 text-[12px] text-ink-3">Expires in</div>
          <div className="grid grid-cols-4 gap-2">
            {EXPIRIES.map((e) => (
              <button
                key={e.secs}
                onClick={() => setExpiry(e.secs)}
                className={`rounded-md border py-1.5 text-[12px] transition-colors ${
                  expiry === e.secs
                    ? "border-line-2 bg-surface-2 text-ink"
                    : "border-line text-ink-3 hover:text-ink-2"
                }`}
              >
                {e.label}
              </button>
            ))}
          </div>
        </label>

        {/* Privacy padding */}
        <label className="block">
          <div className="mb-1.5 flex items-baseline justify-between text-[12px] text-ink-3">
            <span>Privacy padding</span>
            <span>blurs your size on-chain</span>
          </div>
          <div className="grid grid-cols-4 gap-2">
            {[0, 10, 25, 50].map((p) => (
              <button
                key={p}
                onClick={() => setPadPct(p)}
                className={`rounded-md border py-1.5 text-[12px] transition-colors ${
                  padPct === p
                    ? "border-line-2 bg-surface-2 text-ink"
                    : "border-line text-ink-3 hover:text-ink-2"
                }`}
              >
                {p === 0 ? "None" : `+${p}%`}
              </button>
            ))}
          </div>
        </label>

        {/* Summary */}
        <div className="rounded-md border border-line bg-surface-2 px-4 py-3 text-[12px] leading-5 text-ink-2">
          {amountBase && price18 && collateral ? (
            <>
              <span className={dirColor}>{direction === "buy" ? "Buying" : "Selling"}</span>{" "}
              <span className="num">{fmtAmount(amountBase, pair.baseDecimals)}</span> {base} at{" "}
              {orderType === "market" ? "FTSO market price" : <span className="num">{fmtPrice(price18)}</span>}.
              Locks <span className="num">{fmtAmount(collateral, collateralDecimals)}</span>{" "}
              {direction === "sell" ? base : quote} in the vault
              {orderType === "market" && direction === "buy" && " (incl. 1% price buffer)"}
              {padPct > 0 && ` — padded +${padPct}%, so observers see only an upper bound; the unused part unlocks when the order completes`}.
              {insufficient && (
                <span className="mt-1 block text-warn">⚠ Insufficient vault balance — deposit first.</span>
              )}
            </>
          ) : (
            "Enter an amount to preview the order."
          )}
        </div>

        {account ? (
          <button
            onClick={() => void submit()}
            disabled={!canSubmit}
            className={`w-full rounded-md py-3 text-[14px] font-semibold text-bg transition-opacity disabled:cursor-not-allowed disabled:opacity-40 ${
              direction === "buy" ? "bg-buy" : "bg-sell"
            }`}
          >
            {phase === "encrypting" || phase === "wallet" || phase === "pending"
              ? "Working…"
              : "Place encrypted order"}
          </button>
        ) : (
          <button
            onClick={() => void connect()}
            className="w-full rounded-md bg-accent py-3 text-[14px] font-semibold text-bg transition-opacity hover:opacity-90"
          >
            Connect wallet to trade
          </button>
        )}

        {note && (
          <p className={`text-[12px] ${phase === "error" ? "text-sell" : phase === "done" ? "text-buy" : "text-ink-3"}`}>
            {note}
          </p>
        )}

        <p className="flex items-center gap-2 border-t border-line pt-3 text-[11px] text-ink-3">
          <LockIcon /> Your price and terms are encrypted in your browser — on-chain there is only a
          ciphertext blob plus the collateral you lock. Use padding to blur what the collateral implies.
        </p>
      </div>
    </div>
  );
}

function LockIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <rect x="4" y="11" width="16" height="10" rx="2" />
      <path d="M8 11V7a4 4 0 0 1 8 0v4" />
    </svg>
  );
}

/** Poll the trader's vault balance for one token via the wallet RPC. */
function useVaultBalance(enclave: EnclaveInfo, account: string | null, token: string) {
  const key = `${account}-${token}`;
  const { provider: eip1193 } = useWallet();
  const [data, setData] = useState<{ available: bigint; locked: bigint } | null>(null);
  useEffect(() => {
    if (!account || !eip1193) {
      setData(null);
      return;
    }
    let alive = true;
    const provider = new BrowserProvider(eip1193 as never);
    const vault = new Contract(enclave.contracts.vault, VAULT_ABI, provider);
    const load = async () => {
      try {
        const [available, locked] = await Promise.all([
          vault.availableBalance(account, token),
          vault.lockedBalance(account, token),
        ]);
        if (alive) setData({ available, locked });
      } catch { /* wrong network, etc. */ }
    };
    void load();
    const id = setInterval(load, 5000);
    return () => {
      alive = false;
      clearInterval(id);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, enclave.contracts.vault, eip1193]);
  return { data };
}
