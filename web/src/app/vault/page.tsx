"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { BrowserProvider, Contract, MaxUint256, parseUnits } from "ethers";
import { ERC20_ABI, VAULT_ABI } from "@/lib/abi";
import { usePoll } from "@/lib/api";
import { fmtAmount, fmtPrice } from "@/lib/format";
import { useWallet } from "@/lib/wallet";
import type { EnclaveInfo, PricesResponse } from "@/lib/types";

interface TokenRow {
  symbol: string;
  address: string;
  decimals: number;
  wallet: bigint;
  total: bigint;
  locked: bigint;
}

export default function VaultPage() {
  const { data: enclave } = usePoll<EnclaveInfo>("/api/enclave", 8000);
  const { data: prices } = usePoll<PricesResponse>("/api/prices", 5000);
  const { account, connect, provider: eip1193, ensureChain } = useWallet();
  const [rows, setRows] = useState<TokenRow[]>([]);
  const [busy, setBusy] = useState<string>("");
  const [note, setNote] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [reload, setReload] = useState(0);

  const tokens = useMemo(
    () =>
      enclave
        ? [
            { symbol: "FXRP", address: enclave.tokens.FXRP, decimals: 18 },
            { symbol: "USDC", address: enclave.tokens.USDC, decimals: 6 },
          ]
        : [],
    [enclave],
  );

  useEffect(() => {
    if (!enclave || !account || !eip1193) {
      setRows([]);
      return;
    }
    let alive = true;
    const provider = new BrowserProvider(eip1193 as never);
    const vault = new Contract(enclave.contracts.vault, VAULT_ABI, provider);
    const load = async () => {
      try {
        const next = await Promise.all(
          tokens.map(async (t) => {
            const erc20 = new Contract(t.address, ERC20_ABI, provider);
            const [wallet, total, locked] = await Promise.all([
              erc20.balanceOf(account),
              vault.totalBalance(account, t.address),
              vault.lockedBalance(account, t.address),
            ]);
            return { ...t, wallet, total, locked };
          }),
        );
        if (alive) setRows(next);
      } catch { /* wrong network */ }
    };
    void load();
    const id = setInterval(load, 5000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [enclave, account, tokens, reload, eip1193]);

  const portfolioUsd = useMemo(() => {
    if (!rows.length) return null;
    let usd = 0;
    for (const r of rows) {
      const amount = Number(r.total) / 10 ** r.decimals;
      if (r.symbol === "USDC") usd += amount;
      else {
        const p = prices?.[`${r.symbol}/USDC`]?.latest;
        if (p) usd += amount * (Number(p) / 1e18);
      }
    }
    return usd;
  }, [rows, prices]);

  const run = useCallback(
    async (label: string, fn: () => Promise<void>) => {
      setBusy(label);
      setNote(null);
      try {
        if (enclave && !(await ensureChain(enclave.chainId))) {
          throw new Error("Wrong network — approve the switch in your wallet, then try again.");
        }
        await fn();
        setNote({ kind: "ok", text: `${label} confirmed.` });
        setReload((n) => n + 1);
      } catch (err) {
        const msg = (err as Error).message ?? "failed";
        setNote({
          kind: "err",
          text: msg.includes("user rejected") ? "Transaction rejected." : msg.slice(0, 140),
        });
      } finally {
        setBusy("");
      }
    },
    [enclave, ensureChain],
  );

  if (!enclave) {
    return <div className="mx-auto max-w-6xl px-4 py-24 text-center text-ink-3 sm:px-6">Connecting…</div>;
  }

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
      <div className="mb-6 flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Vault</h1>
          <p className="mt-1 text-[13px] text-ink-2">
            Your escrow account inside ShadowPool. Deposits are public; what you do with them is not.
          </p>
        </div>
        {portfolioUsd !== null && (
          <div className="text-right">
            <p className="text-[11px] uppercase tracking-[0.14em] text-ink-3">Portfolio value</p>
            <p className="num text-xl">${portfolioUsd.toLocaleString("en-US", { maximumFractionDigits: 2 })}</p>
          </div>
        )}
      </div>

      {!account ? (
        <div className="panel px-6 py-16 text-center">
          <p className="text-[14px] text-ink-2">Connect a wallet to manage vault balances.</p>
          <button
            onClick={() => void connect()}
            className="mt-5 rounded-md bg-accent px-6 py-2.5 text-[13px] font-semibold text-bg hover:opacity-90"
          >
            Connect wallet
          </button>
        </div>
      ) : (
        <>
          {/* Balances */}
          <div className="panel overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="text-left text-[11px] uppercase tracking-[0.12em] text-ink-3">
                  <th className="px-5 py-3 font-medium">Token</th>
                  <th className="px-2 py-3 text-right font-medium">Wallet</th>
                  <th className="px-2 py-3 text-right font-medium">Vault total</th>
                  <th className="px-2 py-3 text-right font-medium">Locked in orders</th>
                  <th className="px-5 py-3 text-right font-medium">Available</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.symbol} className="border-t border-line/60">
                    <td className="px-5 py-3 font-medium">{r.symbol}</td>
                    <td className="num px-2 py-3 text-right text-ink-2">{fmtAmount(r.wallet, r.decimals)}</td>
                    <td className="num px-2 py-3 text-right">{fmtAmount(r.total, r.decimals)}</td>
                    <td className="num px-2 py-3 text-right text-ink-2">{fmtAmount(r.locked, r.decimals)}</td>
                    <td className="num px-5 py-3 text-right text-accent">
                      {fmtAmount(r.total - r.locked, r.decimals)}
                    </td>
                  </tr>
                ))}
                {rows.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-5 py-8 text-center text-ink-3">
                      Loading balances… (check that your wallet is on {enclave.chainId === 114 ? "Coston2" : `chain ${enclave.chainId}`})
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <div className="mt-4 grid gap-4 md:grid-cols-2">
            <MoveForm
              title="Deposit"
              hint="Approve once, then deposit. Locks nothing until you place an order."
              cta="Deposit into vault"
              tokens={tokens}
              busy={busy}
              onSubmit={(token, amount) =>
                run("Deposit", async () => {
                  const provider = new BrowserProvider(eip1193 as never);
                  const signer = await provider.getSigner();
                  const erc20 = new Contract(token.address, ERC20_ABI, signer);
                  const allowance: bigint = await erc20.allowance(account, enclave.contracts.vault);
                  if (allowance < amount) {
                    const txA = await erc20.approve(enclave.contracts.vault, MaxUint256);
                    await txA.wait();
                  }
                  const vault = new Contract(enclave.contracts.vault, VAULT_ABI, signer);
                  const tx = await vault.deposit(token.address, amount);
                  await tx.wait();
                })
              }
            />
            <MoveForm
              title="Withdraw"
              hint="Only unlocked balance can leave. Cancel orders to free locked funds."
              cta="Withdraw to wallet"
              tokens={tokens}
              busy={busy}
              onSubmit={(token, amount) =>
                run("Withdraw", async () => {
                  const provider = new BrowserProvider(eip1193 as never);
                  const signer = await provider.getSigner();
                  const vault = new Contract(enclave.contracts.vault, VAULT_ABI, signer);
                  const tx = await vault.withdraw(token.address, amount);
                  await tx.wait();
                })
              }
            />
          </div>

          {/* Faucet */}
          <div className="panel mt-4 flex flex-wrap items-center justify-between gap-3 px-5 py-4">
            <div>
              <p className="text-[13px] font-medium">Test-token faucet</p>
              <p className="text-[12px] text-ink-3">
                Mint FXRP and USDC to your wallet for trying the pool on testnet.
              </p>
            </div>
            <div className="flex gap-2">
              {tokens.map((t) => (
                <button
                  key={t.symbol}
                  disabled={!!busy}
                  onClick={() =>
                    run(`Mint ${t.symbol}`, async () => {
                      const provider = new BrowserProvider(eip1193 as never);
                      const signer = await provider.getSigner();
                      const erc20 = new Contract(t.address, ERC20_ABI, signer);
                      const amount = parseUnits(t.symbol === "USDC" ? "100000" : "50000", t.decimals);
                      const tx = await erc20.mint(account, amount);
                      await tx.wait();
                    })
                  }
                  className="rounded-md border border-line px-4 py-2 text-[12px] text-ink-2 transition-colors hover:border-line-2 hover:text-ink disabled:opacity-40"
                >
                  Mint {t.symbol === "USDC" ? "100k USDC" : "50k FXRP"}
                </button>
              ))}
            </div>
          </div>

          {note && (
            <p className={`mt-4 text-[13px] ${note.kind === "ok" ? "text-buy" : "text-sell"}`}>{note.text}</p>
          )}
        </>
      )}
    </div>
  );
}

function MoveForm({
  title,
  hint,
  cta,
  tokens,
  busy,
  onSubmit,
}: {
  title: string;
  hint: string;
  cta: string;
  tokens: { symbol: string; address: string; decimals: number }[];
  busy: string;
  onSubmit: (token: { symbol: string; address: string; decimals: number }, amount: bigint) => void;
}) {
  const [symbol, setSymbol] = useState("FXRP");
  const [amount, setAmount] = useState("");
  const token = tokens.find((t) => t.symbol === symbol) ?? tokens[0];

  const parsed = useMemo(() => {
    try {
      return amount && token ? parseUnits(amount, token.decimals) : null;
    } catch {
      return null;
    }
  }, [amount, token]);

  return (
    <div className="panel p-5">
      <h2 className="text-[15px] font-semibold">{title}</h2>
      <p className="mt-1 text-[12px] text-ink-3">{hint}</p>
      <div className="mt-4 flex gap-2">
        <select
          value={symbol}
          onChange={(e) => setSymbol(e.target.value)}
          className="rounded-md border border-line bg-surface-2 px-3 py-2.5 text-[13px] outline-none"
        >
          {tokens.map((t) => (
            <option key={t.symbol} value={t.symbol}>
              {t.symbol}
            </option>
          ))}
        </select>
        <input
          type="number"
          min="0"
          placeholder="0.00"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          className="num w-full rounded-md border border-line bg-surface-2 px-3 py-2.5 text-[14px] outline-none placeholder:text-ink-3 focus:border-accent-dim"
        />
      </div>
      <button
        disabled={!parsed || parsed <= 0n || !!busy}
        onClick={() => token && parsed && onSubmit(token, parsed)}
        className="mt-3 w-full rounded-md bg-accent py-2.5 text-[13px] font-semibold text-bg transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
      >
        {busy ? "Working…" : cta}
      </button>
    </div>
  );
}
