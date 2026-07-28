# Demo video script (3:30–4:30)

Target: one continuous screen recording, 1440p, dark desktop. Practice once; the flow below
uses only things that exist in the app. Keep the block explorer and the node's terminal log
visible when the script says so — the "encrypted blob on-chain" moment is the whole pitch.

## Pre-flight (before recording)

- [ ] Chain + node + frontend running (`anvil` / `pnpm start` / `pnpm dev`), or Coston2 if deployed.
- [ ] MetaMask with **two accounts** (Trader A = seller, Trader B = buyer), both already:
      minted FXRP/USDC from the Vault faucet **and deposited** into the vault.
- [ ] Run `pnpm tsx scripts/demo.ts` once beforehand so Analytics/landing show non-zero stats.
- [ ] Terminal with the node log (`tail -f services/.data/node.log`) sized to show ~10 lines.
- [ ] Block explorer tab open (Coston2 explorer, or anvil: skip explorer shots and use the log).
- [ ] Close everything else. Hide bookmarks bar.

## Script

**0:00–0:30 — The problem.** (Landing page, slow scroll to the stat tiles.)
> "On every transparent DEX, your order is public before it fills. Sell 100,000 FXRP and the
> market sees you coming — front-runners jump ahead and the price walks away from you. This is
> the #1 reason institutions won't touch on-chain trading. TradFi solved this decades ago with
> dark pools. ShadowPool brings one on-chain."

**0:30–1:00 — The solution.** (Hover the four "Four steps, one secret" cards.)
> "ShadowPool is a dark pool for FAssets on Flare. Orders are encrypted in your browser,
> matched inside a Flare Confidential Compute enclave against FTSO reference prices, and
> settled by a contract that verifies the enclave's signature. No one — including the node
> operator — sees an order before it fills."

**1:00–2:10 — Place an encrypted order.** (Trader A. Go to Trade.)
- Point at the live FTSO chart and the enclave-active badge.
- Sell, Limit, 10,000 FXRP at ~2.95. Read the summary line aloud ("locks 10,000 FXRP").
- Click **Place encrypted order**, approve in MetaMask.
> "Watch what actually went on-chain." — switch to the explorer tx (or node log): show the
> `encryptedPayload` bytes. "That blob is the order. Direction, size, price — sealed to the
> enclave's X25519 key. This is all anyone can ever see."
- Open **Orders** page: "My own browser decrypts my order locally — nobody else can."

**2:10–3:00 — Match and settle.** (Switch MetaMask to Trader B.)
- Trade page: Buy, Market, 10,000 FXRP. Submit.
- Cut to the node log: decrypt → match → settle lines scroll past.
> "The enclave crossed the orders at the FTSO-referenced midpoint and signed a settlement
> instruction. The SettlementEngine contract verified that signature, checked the price against
> FTSO on-chain, and moved vault balances atomically."
- Show the trade appear in **Recent settlements**; flash both Vault pages (balances moved).

**3:00–3:45 — Under the hood.** (Security page, steady scroll.)
> "The chain never trusts the hardware. Every settlement passes five checks — enclave
> signature, replay guard, active orders, collateral bounds, and a 2% FTSO price band. A fully
> compromised enclave can do nothing worse than match real orders at market prices. And funds
> never leave the vault contract: if the enclave dies, you cancel and withdraw."
- Point at the live enclave keys and deployed contract addresses.

**3:45–4:15 — Analytics + roadmap.** (Analytics page.)
> "The venue publishes only aggregates — volume, trade count, settlement success. Roadmap:
> migrate the engine into Flare Confidential Compute at launch, add FBTC pairs, and cross-chain
> settlement via Protocol Managed Wallets. ShadowPool is the first dark pool on Flare — built
> on Confidential Compute, FTSO, and FAssets together."

## Judge-scoring reminders

- Say **"Flare Confidential Compute"**, **"FTSO"**, and **"FAssets"** by name, each at least once.
- The two hero shots: the encrypted blob on-chain (1:40) and the settlement with FTSO check (2:40).
- Keep a backup recording. Don't demo live on conference Wi-Fi.
