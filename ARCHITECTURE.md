# ShadowPool architecture

Deep dive into how the system works internally. Read [README.md](README.md) first for setup
and orientation; this document explains *why* things are built the way they are and covers the
details you need before modifying matching or settlement.

---

## 1. The central design problem

A dark pool needs a matching engine nobody can observe. But an unobservable matching engine is
also unaccountable — it could invent trades, fill you at terrible prices, or steal collateral,
and you'd never know.

The resolution: **make the engine confidential but its output verifiable.** The enclave decides
*which* orders match; the chain independently validates that the resulting settlement is
legitimate before moving anything. Neither side is trusted alone.

This produces a strict split that runs through the whole codebase:

| | Confidential side | Untrusted side |
|---|---|---|
| **Code** | `services/src/enclave/` | `services/src/relay/`, contracts, frontend |
| **Sees** | Plaintext orders, full book | Ciphertext, signed instructions |
| **Trusted for** | Privacy only | Nothing — everything is verified |
| **If compromised** | Orders leak; funds still safe | Nothing leaks; funds still safe |

**Rule for contributors:** never move plaintext-order handling out of `src/enclave/`, and never
introduce filesystem or network calls into it. It must stay portable into a real TEE.

---

## 2. Cryptography

### Order sealing (trader → enclave)

Orders use **NaCl box** (X25519 key exchange + XSalsa20-Poly1305 AEAD). The trader's browser:

1. Generates a fresh ephemeral X25519 keypair per order.
2. Encrypts the JSON order to the enclave's long-lived box public key.
3. Concatenates `[32-byte ephemeral pubkey | 24-byte nonce | ciphertext]` and hex-encodes it.

```
web/src/lib/enclave.ts      →  encryptOrder()
services/src/enclave/crypto.ts →  openOrderPayload()
```

Ephemeral keys mean two orders from the same trader share no key material, so ciphertexts
can't be linked cryptographically. Poly1305 authentication means a tampered blob fails to open
rather than decrypting to garbage.

**The enclave's box public key is published** at `/api/enclave` — it must be, since traders
need it to encrypt. It's a public key; publishing it is safe.

### Settlement attestation (enclave → chain)

The enclave signs settlement instructions with a **secp256k1** key whose address is registered
on-chain as `teeSigner`. The digest is:

```
keccak256(abi.encode(chainId, settlementEngineAddress, instruction))
```

wrapped in the EIP-191 personal-message prefix. Including `chainId` and the contract address
means a signature captured on Coston2 cannot be replayed on mainnet or against a different
deployment.

**This is the piece that changes under a real TEE.** Today the signature proves "the holder of
this key produced this instruction." Under Flare Confidential Compute it would additionally
carry a hardware attestation quote proving *which code* holds that key — verified in
`SettlementEngine.verifyAttestation`. The contract-side interface is already shaped for it.

`instructionHash()` in `crypto.ts` must stay byte-identical to `instructionDigest()` in
`SettlementEngine.sol`. **`engine.test.ts` asserts this** — if you change the instruction
struct, that test fails first, which is intentional.

---

## 3. The matching engine

`services/src/enclave/engine.ts` — the most important file in the repo.

### Host injection

The engine receives an `EngineHost` providing `getPrice()`, `now()`, and `log()`. It never
calls `Date.now()`, never opens a socket, never reads a file. This is what makes it
deterministic and TEE-portable — and also what makes it trivially unit-testable with a fake
clock and fixed prices.

### Order validation

Before an order enters the book, `validate()` rejects it unless:

- The payload's `trader` matches the on-chain submitter. **This is essential** — without it,
  anyone could submit a ciphertext claiming to be someone else's order.
- The payload's pair hash matches the on-chain `pair` field.
- Direction is `buy`/`sell`, amounts and prices are positive, and it hasn't already expired.
- The collateral token matches the direction (sells lock base, buys lock quote).
- For sells, collateral ≥ order size.

Rejections are logged and dropped silently on-chain — the order stays Active until it expires
or is cancelled. (A cleaner design would surface rejections; see limitations.)

### Book structure

`book.ts` keeps per-pair arrays: bids sorted best-price-first, asks best-price-first, FIFO
within a price level. Market orders (`limitPrice === null`) sort ahead of all limit orders on
their side.

Arrays with a re-sort on insert are O(n log n) per order — fine at hackathon scale, and the
obvious thing to replace with a proper price-level tree if depth grows.

### The matching loop

For each pair, repeatedly:

1. Take best bid and best ask. Stop if either is missing.
2. Stop if they're the same trader (**self-trades are never matched** — they'd be a way to
   probe the book).
3. Read the FTSO price. **If unavailable, stop** — matching without a reference price is
   refused rather than guessed.
4. Effective prices: a market order's effective price is the FTSO price.
5. Stop if `bid < ask` (no cross).
6. **Execution price** = midpoint of the two effective prices, clamped into
   `[ftso × (1 − 1.5%), ftso × (1 + 1.5%)]`.
7. Re-check the clamped price still satisfies both limits; if not, hold rather than fill
   someone outside their limit.
8. **Fill size** = min(bid remaining, ask remaining, ask collateral), further reduced if the
   buyer's remaining collateral can't cover it.
9. Update both orders, remove any that are complete, build and sign the instruction.
10. Loop — one order can fill against several counterparties in one pass.

### Why 1.5% inside the engine but 2% on-chain

The contract rejects settlements more than 2% from FTSO. FTSO updates roughly every 1.8s, and
a settlement takes a few seconds to confirm — so a price valid at match time could drift past
the limit by settlement time and revert. The engine's tighter 1.5% band absorbs that drift.

**If you change either bound, change both**, keeping the engine's strictly tighter.
`ENGINE_BAND_BPS` in `engine.ts`, `maxPriceDeviationBps` in `SettlementEngine.sol`.

### Decimal arithmetic

Three different scales are in play: base token (FXRP, 18), quote token (USDC, 6), prices (18).
The conversion is:

```ts
quoteAmount = (baseAmount × price × 10^quoteDecimals) / (10^18 × 10^baseDecimals)
```

All integer math with `bigint`; division truncates, so rounding always favours the protocol
(never over-transfers). Inverting this for the collateral-bounded fill size is where mistakes
hide — read `quoteFor()` and the lines after it carefully before editing.

---

## 4. Settlement verification

`SettlementEngine.settle()` is the trust boundary. Its five checks, and what each prevents:

| Check | Prevents |
|---|---|
| `ECDSA.recover(digest, sig) == teeSigner` | Anyone forging settlements |
| `!settled[matchId]` | Replaying a valid settlement to drain balances |
| Both orders `Active` | Settling cancelled, expired, or already-filled orders |
| `buy.trader != sell.trader` | Self-trade wash trading |
| Price within 2% of FTSO | A compromised enclave filling at manipulated prices |
| `executeTransfer` draws from **locked** balance | Fills exceeding committed collateral |

The last one is structural rather than an explicit check: `ShadowVault.executeTransfer` reverts
if `amount > lockedBalance[from][token]`. Even a perfectly-signed instruction can't move funds
a trader never committed.

**Result:** a fully compromised enclave can do nothing worse than match genuine orders at
near-market prices. It cannot mint, steal, replay, or fill off-market. It *can* censor (refuse
to match), which is why on-chain cancellation exists and requires no enclave cooperation.

### Partial fills

`consumeDeposit(orderId, amount, fullyFilled)` decrements remaining collateral. When
`fullyFilled` is true, the order is marked Filled and any leftover collateral is unlocked —
this is what makes **privacy padding** safe: over-lock as much as you like, the remainder
always comes back. `test_OverlockedCollateralRefundedOnFill` proves it.

---

## 5. The relay

`services/src/relay/chain.ts`. Untrusted plumbing:

- **Event listener** — subscribes to `OrderSubmitted` / `OrderCancelled`, feeds the enclave.
  Note it reads decoded args off ethers v6's `ContractEventPayload` (the last listener
  argument) rather than positional parameters; positional destructuring broke on v6 and cost
  a debugging session.
- **FTSO poller** — calls `PriceOracle.getPrice` every 2s via `staticCall` (the function is
  non-view because FtsoV2's reader is payable), keeping a 2000-point ring buffer for charts.
- **Settlement submitter** — submits signed instructions, records success/failure for the
  settlement-success-rate metric. Uses `NonceManager`; **without it, concurrent settlements
  collide on nonces.**
- **Signer reconciliation** — on boot, checks the on-chain `teeSigner` matches the enclave's
  key and re-registers it if the relay key is the owner. Convenience for local development;
  in production the signer would be governance-set.

---

## 6. Frontend data flow

Two independent sources, deliberately:

1. **The node API** (`lib/api.ts`, `usePoll`) — public aggregate data: prices, settled trades,
   stats, enclave status. Poll-based; failures flip an `offline` flag rather than blanking the
   UI.
2. **Direct chain reads** through the user's wallet — vault balances, order status. These go
   wallet → RPC → contract, never through our server, so the app can't silently observe your
   positions.

**Plaintext orders live only in `localStorage`** (`lib/orders.ts`), written at submission time.
The Orders page joins that local plaintext with on-chain status to show you your own orders.
Nobody else can reproduce that view.

### Wallet layer

`lib/wallet.tsx` implements **EIP-6963** multi-wallet discovery: wallets announce themselves
via events rather than fighting over `window.ethereum`, and the user picks from a list. It also
enforces the deployment chain — `ensureChain()` is called before *every* transaction, so the
app cannot send a transaction on the wrong network (this was a real incident during
development: transactions went to Ethereum mainnet addresses with no code).

---

## 7. Threat model

**Assumed capabilities of an attacker:** full chain observation, ability to submit orders,
ability to run their own node, and (today, without a real TEE) potential access to the machine
running the enclave.

| Attack | Outcome |
|---|---|
| Read someone's limit price from chain data | **Prevented** — ciphertext only |
| Front-run a pending order | **Prevented** — price and book unobservable |
| Forge a settlement | **Prevented** — signature check |
| Replay a settlement | **Prevented** — `matchId` guard |
| Settle at a manipulated price | **Bounded** — 2% FTSO band |
| Fill beyond a trader's collateral | **Prevented** — locked-balance accounting |
| Wash trade with yourself | **Prevented** — self-trade check, both layers |
| Submit an order impersonating another trader | **Prevented** — enclave matches payload trader to on-chain sender |
| Infer direction/size from collateral | **Partially mitigated** — padding gives an upper bound only |
| Censor orders (refuse to match) | **Possible** — mitigated by enclave-free on-chain cancellation |
| Compromise the host to read orders | **Possible today**, prevented by a real TEE |
| Steal vault funds | **Prevented** — no code path moves funds outside verified settlement or owner withdrawal |

The two live weaknesses — host-level order visibility and the collateral inference — are both
documented in the UI itself (`/security`) rather than papered over.

---

## 8. Adding a trading pair

The engine is already multi-pair. To add FBTC/USDC:

1. Deploy or obtain the token, and find its FTSO feed ID (21-byte hex: category byte `0x01` +
   symbol + zero padding).
2. Add a `PairConfig` in `defaultPairs()` (`services/src/relay/chain.ts`) with the token
   addresses, decimals, and feed ID.
3. Add the token to the frontend's token list in `web/src/app/vault/page.tsx`.
4. The pair hash is `keccak256("FBTC/USDC")` — the frontend and enclave derive it identically,
   so nothing else needs changing.

No contract changes are required; pairs are data, not code.

---

## 9. What a real TEE deployment would change

> **Update:** FCC is live on Coston2 and the official path is now documented — see
> [FCC overview](https://dev.flare.network/fcc/overview) and
> [developer guides](https://dev.flare.network/fcc/guides). Flare's model calls these **Flare
> Compute Extensions (FCE)**: an extension is defined by its authorized code versions (Docker
> image hashes) plus machines that have proven via attestation that they run those versions.
> Two system contracts mediate it — `TeeExtensionRegistry` (registers extensions, routes
> instructions) and `TeeMachineRegistry` (tracks attested machines, random selection).
> Registration needs Flare indexer credentials, obtained by contacting Flare support.
>
> Mapping our design onto theirs: our `teeSigner` + `ECDSA.recover` check is the hand-rolled
> equivalent of their attested-machine registry. The signature scheme is the same
> (secp256k1 ECDSA over a message digest); the difference is that we trust an owner-set
> address whereas FCC trusts a code measurement. One architectural note if you attempt this:
> the documented extensions are instruction-driven (an on-chain instruction is routed to a
> machine, which returns a result), whereas our engine is a long-running service holding a
> resting order book in memory. The Private Key Extension shows extensions *can* hold state
> across instructions, so this is workable — but the order-book lifetime is the design question
> to solve first.

1. **Key generation** — keys generated inside the enclave, sealed to the hardware, never
   written to disk in plaintext (today: `services/.data/enclave-keys.json`).
2. **Attestation** — settlement instructions accompanied by a hardware quote proving the code
   measurement, verified on-chain in `verifyAttestation` against a registered measurement
   rather than a bare address.
3. **Key registration** — `setTeeSigner` becomes attestation-gated instead of owner-set.
4. **Deployment target** — the enclave module packaged for Confidential Space (or Flare's
   framework) rather than run under `tsx`.

Nothing in the matching logic changes, which is the point of the boundary. The code was
written this way from the first commit specifically so this migration is configuration and
packaging, not a rewrite.
