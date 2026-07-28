"use client";

import { usePoll } from "@/lib/api";
import { chainName, explorerAddr, shortAddr } from "@/lib/format";
import type { EnclaveInfo } from "@/lib/types";

const PRIVATE_PUBLIC: [string, string][] = [
  ["Limit prices — never revealed, even after a fill", "Vault deposits and withdrawals"],
  ["The resting order book (who is bidding what)", "That you posted an order, and the collateral you locked"],
  ["Whether and when an order will match", "Settlement: matched pair, execution price, amounts"],
  ["Contents of orders that never match", "Total protocol volume"],
  ["Market-vs-limit, expiry, order strategy", "Enclave attestation signatures, contract addresses"],
];

export default function SecurityPage() {
  const { data: enclave } = usePoll<EnclaveInfo>("/api/enclave", 8000);

  const contracts = enclave
    ? [
        ["ShadowVault", enclave.contracts.vault],
        ["OrderBook", enclave.contracts.orderBook],
        ["SettlementEngine", enclave.contracts.settlementEngine],
        ["PriceOracle", enclave.contracts.priceOracle],
        ["FXRP (test)", enclave.tokens.FXRP],
        ["USDC (test)", enclave.tokens.USDC],
      ]
    : [];

  return (
    <div className="mx-auto max-w-4xl px-4 py-10 sm:px-6">
      <h1 className="font-serif text-4xl tracking-tight">How ShadowPool stays dark</h1>
      <p className="mt-3 max-w-2xl text-[14px] leading-7 text-ink-2">
        The design goal: nobody — not node operators, not the relay, not us — can read an order
        before it settles. Privacy comes from hardware isolation; safety comes from on-chain
        verification that doesn&apos;t trust the hardware.
      </p>

      <Section title="1 · The enclave">
        <p>
          The matching engine runs inside a Trusted Execution Environment via{" "}
          <strong>Flare Confidential Compute</strong>. A TEE is a sealed region of CPU memory: code and
          data inside are invisible to the host operating system and its operators. The enclave holds
          two keys that never leave it — an X25519 key traders encrypt orders to, and a secp256k1 key
          that signs settlement instructions. Remote attestation proves the enclave runs the exact
          published matching-engine binary before anyone trusts its signatures.
        </p>
        {enclave && (
          <div className="num mt-4 space-y-1 rounded-md border border-line bg-surface-2 p-4 text-[12px] text-ink-2">
            <p>
              enclave status <span className="text-accent">{enclave.status}</span> · mode{" "}
              <span className={enclave.mode === "simulated" ? "text-warn" : "text-accent"}>{enclave.mode}</span>
            </p>
            <p className="break-all">order encryption key {enclave.boxPublicKey}</p>
            <p>attestation signer {enclave.signerAddress}</p>
          </div>
        )}
        <p className="mt-3 text-[12px] text-ink-3">
          Hackathon note: while Flare Confidential Compute is pre-launch, this deployment runs the
          identical engine as a normal process (&quot;simulated&quot; mode) with the same key handling and
          signature scheme. The enclave code has no filesystem or network dependencies, so it lifts
          into the real TEE unchanged.
        </p>
      </Section>

      <Section title="2 · What's private vs. public">
        <p className="mb-3">
          Honest accounting: the collateral you lock at submission is public, and for this pair
          the collateral token implies direction (locking FXRP ≈ selling, USDC ≈ buying) while
          its amount bounds your size. The order form&apos;s <em>privacy padding</em> lets you
          over-lock so observers see only an upper bound. What can never be read is your price
          and the state of the book — which is what front-running actually requires. Once a
          trade settles, the fill itself is public, exactly like post-trade prints in
          traditional dark pools.
        </p>
        <div className="overflow-hidden rounded-md border border-line">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="bg-surface-2 text-left text-[11px] uppercase tracking-[0.12em] text-ink-3">
                <th className="px-4 py-2.5 font-medium">Private — exists only in the enclave</th>
                <th className="px-4 py-2.5 font-medium">Public — visible on-chain</th>
              </tr>
            </thead>
            <tbody>
              {PRIVATE_PUBLIC.map(([priv, pub]) => (
                <tr key={priv} className="border-t border-line/60">
                  <td className="px-4 py-2.5 text-ink">{priv}</td>
                  <td className="px-4 py-2.5 text-ink-2">{pub}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      <Section title="3 · The FTSO circuit breaker">
        <p>
          The SettlementEngine contract does not blindly trust the enclave. Before any tokens move, it
          re-checks the execution price against the live <strong>FTSO</strong> feed on-chain and reverts
          if the deviation exceeds 2%. Combined with collateral locking (fills can only draw from
          balances a trader explicitly committed) and replay protection on every match id, a fully
          compromised enclave is limited to: matching honest orders at honest prices. It cannot invent
          trades, reuse fills, or settle off-market.
        </p>
      </Section>

      <Section title="4 · Settlement verification, step by step">
        <ol className="list-decimal space-y-2 pl-5">
          <li>Recover the signer of the settlement instruction; require the registered enclave key.</li>
          <li>Reject the match id if it has ever settled before.</li>
          <li>Require both orders to exist and be Active in the OrderBook.</li>
          <li>Query FTSO via the PriceOracle; require the execution price within the 2% band.</li>
          <li>Move quote collateral buyer → seller and base collateral seller → buyer, atomically.</li>
          <li>Mark orders filled (or reduce their remaining collateral on partial fills).</li>
        </ol>
      </Section>

      <Section title={`5 · Deployed contracts (${chainName(enclave?.chainId)})`}>
        <div className="overflow-hidden rounded-md border border-line">
          <table className="w-full text-[13px]">
            <tbody>
              {contracts.map(([name, addr]) => {
                const link = explorerAddr(enclave?.chainId, addr);
                return (
                  <tr key={name} className="border-t border-line/60 first:border-t-0">
                    <td className="px-4 py-2.5">{name}</td>
                    <td className="num px-4 py-2.5 text-right text-ink-2">
                      {link ? (
                        <a className="hover:text-accent" href={link} target="_blank" rel="noreferrer">
                          {addr} ↗
                        </a>
                      ) : (
                        addr
                      )}
                    </td>
                  </tr>
                );
              })}
              {contracts.length === 0 && (
                <tr>
                  <td className="px-4 py-6 text-center text-ink-3">Connect the node to load addresses.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <p className="mt-3 text-[12px] text-ink-3">
          Attestation signer registered on-chain: <span className="num">{enclave ? shortAddr(enclave.signerAddress) : "—"}</span>.
          Source code, contracts, enclave, and this UI: see the project README on GitHub.
        </p>
      </Section>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-10">
      <h2 className="text-lg font-semibold tracking-tight text-accent">{title}</h2>
      <div className="mt-3 text-[14px] leading-7 text-ink-2">{children}</div>
    </section>
  );
}
