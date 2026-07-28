import Link from "next/link";

export const metadata = { title: "Docs — ShadowPool" };

const FAQ: { q: string; a: string }[] = [
  {
    q: "Is my order really private?",
    a: "Your browser encrypts the order with the enclave's public key before anything touches the chain. On-chain there is only ciphertext plus the collateral you locked. Only code running inside the attested enclave holds the decryption key. The one unavoidable public signal is the settlement itself — once a trade fills, the transfer amounts are visible, but not who ordered what, when, or at what limit.",
  },
  {
    q: "How does matching work?",
    a: "The enclave keeps a conventional price-time-priority book per pair. When the best bid crosses the best ask, it executes at the midpoint, clamped to the live FTSO reference price band. Market orders execute at FTSO price. Partial fills leave the remainder resting.",
  },
  {
    q: "What if the enclave goes down?",
    a: "Funds are never inside the enclave — they sit in the ShadowVault contract. If the matching engine disappears, resting orders simply never match; you cancel them on-chain (no enclave involvement) and withdraw. Worst case is inconvenience, not loss.",
  },
  {
    q: "What stops a hacked enclave from stealing funds?",
    a: "The SettlementEngine contract independently verifies every instruction: signature, replay, order status, collateral bounds, and a 2% FTSO price band. A malicious matcher can at most match real orders at market prices — which is what it's supposed to do anyway.",
  },
  {
    q: "What fees are charged?",
    a: "None in the hackathon build. A production venue would charge basis points on settled notional, paid from the quote leg at settlement.",
  },
];

const STEPS = [
  ["Connect", "Use MetaMask on Coston2 (chain id 114). The header badge shows the enclave status."],
  ["Fund", "On the Vault page, mint test FXRP/USDC from the faucet, then approve and deposit."],
  ["Trade", "On the Trade page, pick a side, size, and market or limit price. The order is encrypted client-side and submitted."],
  ["Track", "The Orders page decrypts your orders locally; cancel any time to unlock collateral."],
  ["Withdraw", "Pull any unlocked balance back to your wallet from the Vault page."],
];

export default function DocsPage() {
  return (
    <div className="mx-auto max-w-4xl px-4 py-10 sm:px-6">
      <h1 className="font-serif text-4xl tracking-tight">Documentation</h1>

      <section className="mt-8">
        <h2 className="text-lg font-semibold tracking-tight text-accent">Getting started</h2>
        <ol className="mt-4 space-y-3">
          {STEPS.map(([title, body], i) => (
            <li key={title} className="panel flex gap-4 p-4">
              <span className="num text-[13px] text-accent">{String(i + 1).padStart(2, "0")}</span>
              <div>
                <p className="text-[14px] font-medium">{title}</p>
                <p className="mt-0.5 text-[13px] leading-6 text-ink-2">{body}</p>
              </div>
            </li>
          ))}
        </ol>
      </section>

      <section className="mt-10">
        <h2 className="text-lg font-semibold tracking-tight text-accent">FAQ</h2>
        <div className="mt-4 space-y-3">
          {FAQ.map((f) => (
            <details key={f.q} className="panel group p-4 open:bg-surface-2">
              <summary className="cursor-pointer list-none text-[14px] font-medium marker:content-none">
                <span className="mr-2 inline-block text-accent transition-transform group-open:rotate-90">›</span>
                {f.q}
              </summary>
              <p className="mt-2 pl-5 text-[13px] leading-6 text-ink-2">{f.a}</p>
            </details>
          ))}
        </div>
      </section>

      <section className="mt-10">
        <h2 className="text-lg font-semibold tracking-tight text-accent">Node API</h2>
        <p className="mt-3 text-[14px] leading-7 text-ink-2">
          The relay exposes a small read-only API used by this interface. All of it is public data.
        </p>
        <div className="num mt-3 space-y-1.5 rounded-md border border-line bg-surface-2 p-4 text-[12.5px] text-ink-2">
          <p><span className="text-accent">GET</span> /api/enclave — status, keys, contract addresses, pairs</p>
          <p><span className="text-accent">GET</span> /api/prices — FTSO price history per pair</p>
          <p><span className="text-accent">GET</span> /api/trades — settled trades (anonymized)</p>
          <p><span className="text-accent">GET</span> /api/stats — volume, counts, settlement success</p>
        </div>
        <p className="mt-6 text-[13px] text-ink-2">
          For the trust model and contract addresses, see <Link href="/security" className="text-accent hover:underline">Security</Link>.
        </p>
      </section>
    </div>
  );
}
