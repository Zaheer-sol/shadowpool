# ShadowPool Demo Video Script

**Target: 3–4 minutes | Track 2: Confidential Compute Applications**

Record with OBS or Loom. Have MetaMask connected to Coston2 with test tokens already minted. Wake the enclave before recording (visit the site 2 min early).

---

## INTRO — say over the landing page (0:00–0:30)

> "ShadowPool is a dark pool for FAssets on Flare — built for the Flare Summer Signal hackathon, Track 2: Confidential Compute.
>
> The problem is simple: when you trade large amounts on-chain, everyone sees your order. Front-runners extract value, and your execution price suffers. Traditional finance solved this decades ago with dark pools — venues where orders are hidden until they match. But on a public blockchain, how do you hide an order that lives on-chain?
>
> ShadowPool uses Flare's Confidential Compute — a TEE-based matching engine — to bring dark pool trading to FAssets like FXRP."

**Screen:** Landing page at shadowpools.onrender.com. Scroll slowly through the hero and feature cards.

---

## ARCHITECTURE — say while clicking to Security page (0:30–1:10)

> "Here's how it works. Orders are encrypted in your browser using NaCl box cryptography before they ever hit the chain. On-chain, your order is just a ciphertext blob plus collateral — no one can see your side, price, or size.
>
> The matching engine runs inside a Trusted Execution Environment. It's the only place where orders are decrypted. It maintains a price-time priority order book, matches at the midpoint clamped to a 1.5% band around Flare's FTSO oracle price, and signs settlement instructions with an ECDSA key that only the enclave holds.
>
> Settlement happens on-chain through a SettlementEngine contract that verifies five things: the enclave's signature, replay protection, order status, self-trade prevention, and that the price is within 2% of FTSO. If any check fails, the trade reverts."

**Screen:** Click "Security" in the nav. Scroll through the enclave section, privacy model, and FTSO price band explanation.

---

## LIVE DEMO — Trade page (1:10–1:50)

> "Let me show you it working live on Coston2 testnet."

**Screen:** Click "Trade". Point out:

> "This is a live FTSO price feed for FXRP/USDC — updating every two seconds directly from Flare's oracle. You can place market or limit orders, set expiry, and use privacy padding to blur your on-chain collateral size."

Enter 100 in the amount field.

> "When I enter 100 FXRP, the preview shows exactly how much USDC collateral will be locked — including a 1% price buffer. The order gets encrypted client-side and submitted as ciphertext."

(If you want, click "Place encrypted order" and approve the tx. Otherwise skip and just show the preview.)

---

## VAULT — show deposits and balances (1:50–2:20)

> "The Vault is the escrow layer."

**Screen:** Click "Vault".

> "Deposits are public — the contract holds your tokens. But what you do with them is private. When you place an order, collateral gets locked. The vault tracks total balance, locked in orders, and available balance. There's also a test-token faucet so anyone can try this on testnet — mint FXRP and USDC with one click."

---

## ORDERS — show the active order (2:20–2:40)

**Screen:** Click "Orders".

> "The Orders page decrypts your orders from your browser's local storage. On-chain, anyone inspecting these orders sees only an opaque blob. Only you can see the details — side, amount, price, status. You can cancel active orders to unlock your collateral."

---

## SETTLEMENT PROOF — Analytics page (2:40–3:15)

**Screen:** Click "Analytics".

> "And here's the proof it works end-to-end. We have a real on-chain settlement — 100 FXRP traded at 1.0081 USDC, settled through the TEE matching engine and verified by the SettlementEngine contract on Coston2."

**Screen:** Scroll to show the volume and trades charts, then the FTSO reference price chart.

> "The analytics show only aggregate venue metrics. Individual orders, trader identities, and open interest per account are structurally unavailable — they exist only inside the enclave. That's not a policy choice, it's an architectural guarantee."

**Screen:** Go back to Trade, scroll to "Recent settlements".

> "Every settlement is anonymized — no addresses, no order IDs. You can click through to verify the transaction on the Coston2 explorer."

---

## WRAP-UP — back to landing page (3:15–3:40)

> "To summarize: ShadowPool uses three Flare-native primitives. FTSO for real-time price feeds and on-chain price band verification. FAssets — specifically FXRP — as the traded asset. And Flare's Confidential Compute to run the matching engine inside a TEE, keeping order flow private while settling transparently on-chain.
>
> Everything you saw is live on Coston2. Contracts are deployed, the enclave is running, and the settlement is on-chain. Thanks for watching."

---

## PRE-RECORDING CHECKLIST

- [ ] Wake the enclave: visit the site 2 min before recording
- [ ] Verify "Enclave active · Coston2" shows in the nav
- [ ] MetaMask on Coston2 with test tokens minted
- [ ] Connect wallet before recording so all 6 nav links show
- [ ] Have the Coston2 explorer tx open in another tab: https://coston2-explorer.flare.network/tx/0x301ec7ec2b58236501731c810433990589eedcfc368b4b715a1ff79e634096e8
- [ ] Screen resolution: 1440×900 or 1920×1080
- [ ] Close unrelated browser tabs and notifications
