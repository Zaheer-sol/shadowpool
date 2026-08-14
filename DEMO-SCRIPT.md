# ShadowPool Demo Video Script

**Target: ~3 minutes | Track 2: Confidential Compute Applications**

Record with OBS or Loom. Wallet connected, tokens minted, enclave awake before you hit record.

---

## 1. INTRO (0:00–0:15)

**Screen:** Landing page at shadowpools.onrender.com. Scroll slowly through hero.

> "ShadowPool is a dark pool for FAssets on Flare. On a transparent chain, large orders get front-run — everyone sees what you're doing before your trade settles. ShadowPool encrypts orders client-side, matches them inside a TEE at FTSO-fair prices, and settles on-chain. Let me show you."

---

## 2. TRADE — place a live order (0:15–0:50)

**Screen:** Click "Trade".

> "This is a live FTSO price feed for FXRP/USDC, updating every two seconds directly from Flare's oracle."

**Action:** Enter 100 in the amount field. Pause so the equivalent USDC value and order preview are visible.

> "I'm buying 100 FXRP. The form shows the exact USDC value at the current FTSO price, and the collateral that will be locked — with a 1% buffer for price movement. Privacy padding lets me over-collateralize so observers can't infer my real order size from the deposit."

**Action:** Click "Place encrypted order". MetaMask pops up — approve the transaction. Wait for confirmation.

> "That order was encrypted in my browser using NaCl box cryptography, sealed to the enclave's public key, and submitted on-chain as ciphertext. Nobody — not the node operator, not other traders, not block explorers — can read it."

---

## 3. VAULT (0:50–1:15)

**Screen:** Click "Vault".

> "The Vault is the escrow layer. You can see my deposit, the collateral locked by the order I just placed, and the available balance. Deposits are public — the contract holds your tokens. But what you do with them is private."

**Screen:** Scroll to the faucet.

> "There's a built-in test-token faucet — anyone can mint FXRP and USDC on Coston2 and try this right now."

---

## 4. ORDERS (1:15–1:35)

**Screen:** Click "Orders".

> "This page decrypts my orders from browser local storage. On-chain, anyone inspecting these sees only an opaque blob. Only I can see the side, amount, price, and status. I can cancel to unlock my collateral anytime."

---

## 5. ANALYTICS + SETTLEMENT PROOF (1:35–2:15)

**Screen:** Click "Analytics".

> "Here's proof the full pipeline works. We have a real settlement — 100 FXRP at 1.0081 USDC — matched by the TEE and verified on-chain by the SettlementEngine contract."

**Screen:** Point at the stat cards: $100.81 volume, 1 trade, 100% settlement success.

> "Analytics show only aggregate metrics. Individual orders, trader identities, open interest by account — these are structurally unavailable. They exist only inside the enclave. That's not a policy, it's architecture."

**Screen:** Click "Trade", scroll to "Recent settlements".

> "Settlements are anonymized — no addresses, no order IDs. But you can click through to verify on-chain."

**Screen:** Switch to the Coston2 explorer tab. Click the "Logs" tab.

> "Here's the settlement transaction. In the Logs you can see two TransferExecuted events from the ShadowVault — 100.81 USDC moved from buyer to seller, 100 FXRP moved from seller to buyer. These are internal vault ledger transfers — no ERC-20 Transfer events leak who traded with whom. That's the privacy model working exactly as designed."

---

## 6. SECURITY — quick scroll (2:15–2:35)

**Screen:** Click "Security". Scroll through slowly.

> "The Security page explains the full architecture — NaCl encryption, the TEE matching engine, and the FTSO price band that the on-chain contract enforces. Even if the enclave were compromised, it can't fill you more than 2% off the oracle price."

---

## 7. WRAP-UP (2:35–3:00)

**Screen:** Back to landing page.

> "ShadowPool uses three Flare-native primitives: FTSO for real-time price feeds and on-chain price verification. FAssets — FXRP — as the traded asset. And Flare Confidential Compute to run the matching engine inside a TEE.
>
> Everything you just saw is live on Coston2 — contracts deployed, enclave running, settlement verified on-chain. ShadowPool. Trade large, stay private."

---

## PRE-RECORDING CHECKLIST

- [ ] Wake the enclave: visit the site 2 min before recording
- [ ] Verify "Enclave active · Coston2" shows in the nav
- [ ] MetaMask connected to Coston2 with test tokens minted
- [ ] Deposit USDC into vault before recording (so you can place an order live)
- [ ] Have the Coston2 explorer tx open in a second tab: https://coston2-explorer.flare.network/tx/0x301ec7ec2b58236501731c810433990589eedcfc368b4b715a1ff79e634096e8
- [ ] Click to the Logs tab on the explorer so it's ready to show
- [ ] Screen resolution: 1440×900 or 1920×1080
- [ ] Close unrelated browser tabs and notifications
- [ ] Do a dry run once before recording
