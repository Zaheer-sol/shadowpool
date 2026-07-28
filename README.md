# ShadowPool — an on-chain dark pool for FAssets

**Track 2: Confidential Compute Applications · Flare Summer Signal Hackathon**

Trade large FAsset positions on Flare without broadcasting your intent. Orders are encrypted
in the browser, matched inside a sealed enclave against FTSO reference prices, and settled
on-chain by a contract that verifies the enclave's signature before any tokens move.

**Live on Coston2** · [Contract addresses](#live-coston2-deployment) · [Demo script](DEMO.md) ·
[Architecture deep-dive](ARCHITECTURE.md)

---

## Table of contents

1. [The problem, and what we built](#1-the-problem-and-what-we-built)
2. [Project status — what's real, what's simulated](#2-project-status)
3. [Quick start (15 minutes to a working local pool)](#3-quick-start)
4. [Repository layout](#4-repository-layout)
5. [How a trade actually flows](#5-how-a-trade-actually-flows)
6. [The three components](#6-the-three-components)
7. [Smart contract reference](#7-smart-contract-reference)
8. [Node API reference](#8-node-api-reference)
9. [Testing](#9-testing)
10. [Deployment](#10-deployment)
11. [The privacy model — read this before pitching it](#11-the-privacy-model)
12. [Known limitations and gotchas](#12-known-limitations-and-gotchas)
13. [Where to contribute next](#13-where-to-contribute-next)
14. [Troubleshooting](#14-troubleshooting)

---

## 1. The problem, and what we built

On a transparent chain every order is public the moment it's submitted. A trader selling
100,000 FXRP announces that intent to the entire market — MEV bots front-run it, the price
moves against them, and they fill worse than they should have. This is a well-known reason
institutional desks avoid on-chain venues. Traditional finance solved it decades ago with
*dark pools*: private venues where orders stay hidden until they match.

ShadowPool is that, on Flare. The core insight is that a matching engine doesn't need to be
public to be trustworthy — it needs to be **verifiable**. So we run matching inside a
confidential enclave and make the *settlement* prove itself on-chain: every fill arrives as a
signed instruction that a contract independently checks against the FTSO oracle, replay
protection, order status, and locked collateral. The chain never trusts the enclave; it
verifies it.

**What that buys you:** nobody — not other traders, not MEV bots, not the node operator — can
read your limit price or see the resting order book. Front-running requires knowing what
you'll pay, and that never leaves the enclave.

---

## 2. Project status

Everything below has been executed end-to-end on Coston2, not just written.

| Component | Status |
|---|---|
| Smart contracts (4) | ✅ Complete, 15 tests passing, deployed to Coston2 |
| Matching enclave | ✅ Complete, 7 tests passing — **runs in simulated mode** (see below) |
| Chain relay + API | ✅ Complete, running against Coston2 |
| Frontend (7 pages) | ✅ Complete, production build clean |
| FTSO integration | ✅ Live — real XRP/USD feed drives pricing and the on-chain price band |
| FAssets | ⚠️ Test ERC-20 stand-ins for FXRP/USDC (real FAsset minting is out of scope) |
| Confidential Compute | ⚠️ **Simulated** — see below |

### What "simulated mode" means

Flare Confidential Compute was not available for deployment when this was built, so the
matching engine currently runs as an ordinary Node.js process rather than inside a hardware
TEE. **Everything else is identical:** the same code, the same key handling, the same
signature scheme, the same on-chain verification path.

The enclave module (`services/src/enclave/`) was written to be TEE-portable from day one —
pure deterministic logic, no filesystem access, no network calls, all I/O injected by the
host. Moving it into a real enclave is a deployment change, not a rewrite.

**The honest security implication:** today you trust the machine running the node not to peek
at orders. Under a real TEE you wouldn't. The *settlement* guarantees (signature, price band,
collateral bounds, replay protection) are enforced on-chain and hold either way.

---

## 3. Quick start

Prerequisites: **Node 20+**, **pnpm**, **Foundry** (`curl -L https://foundry.paradigm.xyz | bash`).

You'll need three terminals. This gets you a complete working pool on a local chain — no
testnet tokens or faucets required.

```bash
git clone https://github.com/Zaheer-sol/shadowpool.git
cd shadowpool
```

**Terminal 1 — local chain:**
```bash
anvil
```

**Terminal 2 — deploy contracts, then run the node:**
```bash
cd contracts
forge install                                    # first time only
forge test                                       # 15 tests should pass
forge script script/Deploy.s.sol --rpc-url http://127.0.0.1:8545 --broadcast

cd ../services
pnpm install
pnpm start                                       # enclave + relay + API on :8787
```
The node generates its own enclave keys on first run (`services/.data/enclave-keys.json`) and
registers the signing key on-chain automatically.

**Terminal 3 — frontend:**
```bash
cd web
pnpm install
pnpm dev                                         # http://localhost:3000
```

**Verify it works** without touching the UI:
```bash
cd services
pnpm tsx scripts/simulate.ts     # full lifecycle with assertions at every step
```
That runs deposit → cancel → partial fill → full fill → withdraw and asserts the on-chain
state after each. If it prints `FULL LIFECYCLE OK ✓`, your stack is healthy.

**To use the UI:** add the local network to MetaMask (RPC `http://127.0.0.1:8545`, chain ID
`31337`), import an anvil test account, then use the Vault page's faucet buttons to mint test
tokens.

**To get a fill while testing solo,** run the auto-counterparty — it watches the chain and
takes the opposite side of any order you place:
```bash
cd services && pnpm tsx scripts/auto-counterparty.ts
```

---

## 4. Repository layout

```
shadowpool/
├── contracts/                    Foundry project — all on-chain logic
│   ├── src/
│   │   ├── ShadowVault.sol        Escrow: deposits, locked/available balances, settlement transfers
│   │   ├── OrderBook.sol          Encrypted order storage + collateral locking + cancellation
│   │   ├── SettlementEngine.sol   ★ The trust boundary — verifies enclave instructions
│   │   ├── PriceOracle.sol        FTSO wrapper, normalises feeds to 18 decimals
│   │   ├── interfaces/IFtsoV2.sol Minimal Flare interfaces
│   │   └── mocks/MockERC20.sol    Test FXRP/USDC with an open faucet
│   ├── test/ShadowPool.t.sol      15 tests — lifecycle + every rejection path
│   ├── script/Deploy.s.sol        Deploys everything, writes deployments/<chainId>.json
│   ├── deploy-coston2.sh          One-command testnet deploy
│   └── deployments/               Generated address records (consumed by node + frontend)
│
├── services/                     The off-chain node (TypeScript)
│   ├── src/enclave/              ★ TEE-portable: no fs, no network, deterministic
│   │   ├── crypto.ts              NaCl order decryption + ECDSA settlement signing
│   │   ├── book.ts                Price-time priority order book
│   │   ├── engine.ts              ★ Matching logic — the heart of the system
│   │   ├── types.ts               Shared enclave types
│   │   └── engine.test.ts         7 unit tests
│   ├── src/relay/                Untrusted half — only handles ciphertext + signed data
│   │   ├── chain.ts               Event listener + settlement submitter + FTSO poller
│   │   ├── server.ts              Public read-only API
│   │   └── store.ts               Trade log persistence (JSON file)
│   ├── src/index.ts              Entrypoint — wires enclave + relay + API together
│   └── scripts/
│       ├── simulate.ts            Full lifecycle test with assertions ← start here
│       ├── demo.ts                Simple two-trader match
│       ├── counterparty.ts        Manually take the other side of a trade
│       └── auto-counterparty.ts   Auto-fill any order placed from the UI
│
└── web/                          Next.js 16 frontend (App Router, Tailwind v4)
    ├── src/app/                   7 pages: /, /trade, /vault, /orders, /analytics, /security, /docs
    ├── src/components/            Nav, OrderForm, charts, trade feed, wallet picker
    └── src/lib/
        ├── enclave.ts             ★ Client-side order encryption
        ├── wallet.tsx             EIP-6963 multi-wallet discovery + chain enforcement
        ├── orders.ts              Local plaintext order storage (privacy-critical)
        ├── abi.ts, api.ts, format.ts, types.ts
```

★ marks the files worth reading first to understand the system.

---

## 5. How a trade actually flows

```
 TRADER'S BROWSER                CHAIN                    NODE (relay + enclave)
 ────────────────                ─────                    ──────────────────────
 1. deposit ──────────────────▶ ShadowVault
                                 (balance credited)

 2. build order
    {side, size, price}
    encrypt with NaCl
    to enclave pubkey
         │
         └── ciphertext ──────▶ OrderBook.submitOrder
             + collateral       (locks collateral,
                                 emits OrderSubmitted) ──▶ 3. relay hears event
                                                              passes blob to enclave
                                                              enclave decrypts + validates
                                                              inserts into in-memory book
                                                              checks for a cross
                                                                    │
                                                              4. match found:
                                                                 price = midpoint,
                                                                 clamped to FTSO band
                                                                 sign instruction (ECDSA)
                                                                    │
                              SettlementEngine.settle ◀──────────── relay submits
                              ├─ recover signer == registered enclave key?
                              ├─ matchId never settled before?
                              ├─ both orders still Active?
                              ├─ price within 2% of live FTSO?
                              └─ transfers bounded by locked collateral?
                                        │
                                        ▼
                              ShadowVault.executeTransfer ×2
                              (quote buyer→seller, base seller→buyer)
                                        │
 5. balances update ◀───────────────────┘
    withdraw anytime
```

**The key property:** step 2's ciphertext is the only thing the public sees about your order's
terms. Steps 3–4 happen where nobody can observe them. Step 4's contract checks mean the
enclave can't cheat even though it's unobservable.

---

## 6. The three components

### Contracts (`contracts/`)

Four contracts, ~500 lines of Solidity. `SettlementEngine` is where the security lives — if
you read one file, read that one. The others are deliberately boring: `ShadowVault` is
double-entry balance accounting, `OrderBook` is a ciphertext store with collateral hooks,
`PriceOracle` normalises FTSO feeds.

The design principle throughout: **the enclave is untrusted input.** Every settlement is
checked as if it might be adversarial.

### Node (`services/`)

Deliberately split into two halves with different trust levels:

- **`src/enclave/`** — the confidential part. Holds the decryption key, sees plaintext orders,
  maintains the book, decides matches. Written to run inside a TEE: it never touches the
  filesystem or network, and receives the clock, prices, and logging through an injected
  `EngineHost` interface. This is what would move into Flare Confidential Compute.
- **`src/relay/`** — the untrusted part. Listens for chain events, ferries ciphertext to the
  enclave, submits signed settlements, polls FTSO, serves the public API. It handles only
  encrypted blobs and already-signed instructions, so compromising it leaks nothing.

Keeping that boundary clean is the most important architectural rule in this repo. **When
adding features, ask: does this belong on the confidential side or the untrusted side?**

### Frontend (`web/`)

Next.js 16 App Router, Tailwind v4, ethers v6, lightweight-charts. Dark theme throughout.

Two files carry privacy weight:
- **`lib/enclave.ts`** — encrypts orders client-side. Plaintext must never be sent anywhere.
- **`lib/orders.ts`** — stores your plaintext orders in `localStorage`, which is why the
  Orders page can show your own order details while the chain holds only ciphertext. Nothing
  server-side ever sees them.

---

## 7. Smart contract reference

### ShadowVault.sol
Escrow holding all trading capital. Balances are tracked as `totalBalance` and
`lockedBalance`; available = total − locked.

| Function | Access | Purpose |
|---|---|---|
| `deposit(token, amount)` | anyone | Pull ERC-20 in, credit balance (credits actual received, so fee-on-transfer tokens can't inflate) |
| `withdraw(token, amount)` | anyone | Withdraw up to *available* balance only |
| `lockBalance(trader, token, amount)` | authorized | Lock collateral behind a new order — called by OrderBook |
| `unlockBalance(...)` | authorized | Release on cancel/expiry/dust refund |
| `executeTransfer(from, to, token, amount)` | authorized | Settlement transfer, drawn from locked balance |

`authorized` = OrderBook and SettlementEngine, set by the owner at deploy.

### OrderBook.sol
Stores encrypted orders. Never sees plaintext.

| Function | Access | Purpose |
|---|---|---|
| `submitOrder(pair, encryptedPayload, depositToken, depositAmount)` | anyone | Locks collateral, stores ciphertext, emits `OrderSubmitted` (the relay's trigger) |
| `cancelOrder(orderId)` | order owner | Marks Cancelled, unlocks remaining collateral — **works without the enclave**, which is the liveness guarantee |
| `consumeDeposit(orderId, amount, fullyFilled)` | settler | Reduces remaining collateral on a fill; refunds dust and marks Filled when complete |

### SettlementEngine.sol ★
The trust boundary. `settle(instruction, attestation)` performs, in order:

1. **Signature** — `ECDSA.recover` over the instruction digest must equal the registered
   `teeSigner`. Digest binds `chainId` and the contract address, so signatures can't be
   replayed across chains or deployments.
2. **Replay** — `matchId` must be unused.
3. **Order status** — both orders must exist and be `Active`; self-trades rejected.
4. **Price band** — execution price must be within `maxPriceDeviationBps` (default 200 = 2%)
   of the live FTSO price.
5. **Transfers** — `executeTransfer` draws from *locked* balance, so a fill can never exceed
   what the trader committed.

Anyone may relay a settlement; the signature is the authority, not the sender.

### PriceOracle.sol
Wraps FtsoV2 via the `FlareContractRegistry`, normalising to 18 decimals (handles negative
FTSO decimals). On chains without FTSO (local anvil) it falls back to owner-set prices so the
same interface works everywhere.

---

## 8. Node API reference

Read-only, public data only, CORS-enabled. Default `http://127.0.0.1:8787`.

| Endpoint | Returns |
|---|---|
| `GET /api/enclave` | Status, mode, **box public key** (needed to encrypt orders), signer address, open-order count, chain ID, all contract addresses, pair configs |
| `GET /api/prices` | Latest + historical FTSO price per pair |
| `GET /api/trades?limit=N` | Settled trades — pair, price, amounts, tx hash, timestamp. No addresses, no order IDs |
| `GET /api/stats` | Volume by window, trade count, average size, settlement success rate, daily series |

There is deliberately **no endpoint that could expose order contents** — the API server has no
access to enclave state beyond an aggregate count.

---

## 9. Testing

```bash
cd contracts && forge test -vv     # 15 tests
cd services  && pnpm test          # 7 tests
```

**Contract tests** cover the happy path plus every rejection: forged signatures, replayed
match IDs, prices outside the FTSO band, fills exceeding locked collateral, settling cancelled
orders, unauthorized vault access, and correct refunding of over-locked (padded) collateral.

**Enclave tests** cover encryption round-trip, undecryptable payload rejection, limit orders
crossing at a band-clamped price, partial fills, market orders at FTSO price, non-crossing
books, expiry pruning, self-trade prevention, and — importantly — that the signature the
enclave produces verifies against the exact digest the contract computes.

**Integration:** `services/scripts/simulate.ts` exercises the entire product against a live
chain with assertions after every step. Run it after any change to matching or settlement.

---

## 10. Deployment

### Local
Covered in [Quick start](#3-quick-start).

### Coston2 testnet

```bash
cd contracts
cast wallet new                                  # generate a deployer
# save the private key into contracts/.env as PRIVATE_KEY=0x...
#   (this file is gitignored — never commit it)
# fund the address at https://faucet.flare.network (Coston2 tab)

cd ../services && pnpm start                     # generates enclave keys if absent
cd ../contracts && ./deploy-coston2.sh
```

`deploy-coston2.sh` checks the balance, reads the enclave signer address from the node's key
file, deploys everything, registers the signer on-chain, and writes `deployments/114.json`.

Then point the node at Coston2:
```bash
cd services
RPC_URL=https://coston2-api.flare.network/ext/C/rpc RELAY_KEY=$PRIVATE_KEY pnpm start
```
And the frontend: `NEXT_PUBLIC_API_URL=<node-url> pnpm build`.

### Live Coston2 deployment

| Contract | Address |
|---|---|
| ShadowVault | [`0x62273F162ddCdEB69311A4b87D69Eb3eDD34af18`](https://coston2-explorer.flare.network/address/0x62273F162ddCdEB69311A4b87D69Eb3eDD34af18) |
| OrderBook | [`0x70ff8f4DA28B2c13C0614539e701a6Bc3e8b5dA5`](https://coston2-explorer.flare.network/address/0x70ff8f4DA28B2c13C0614539e701a6Bc3e8b5dA5) |
| SettlementEngine | [`0x3A552EB014a19ED2F09121F472431fB0910DFaaa`](https://coston2-explorer.flare.network/address/0x3A552EB014a19ED2F09121F472431fB0910DFaaa) |
| PriceOracle | [`0x7cE817e8E51108d57B31E3e9061DAB9F4E542840`](https://coston2-explorer.flare.network/address/0x7cE817e8E51108d57B31E3e9061DAB9F4E542840) |
| FXRP (test) | `0xd062F2Dd4984727f1129cCdEcDD0798CE9CDc15a` |
| USDC (test) | `0x4C6549249c26Dee1AeE57fF22ac1457EC4BA2b51` |

Example settled trade:
[`0x62263f…6028`](https://coston2-explorer.flare.network/tx/0x62263f12cfa841542d860c0a8dcd6b27b6ee47003d1ea5f5d6837a30ba7f6028)

### Environment variables

| Variable | Where | Default | Purpose |
|---|---|---|---|
| `PRIVATE_KEY` | contracts | anvil #0 | Deployer key |
| `TEE_SIGNER` | contracts | deployer | Enclave signing address to register |
| `RPC_URL` | services | `http://127.0.0.1:8545` | Chain RPC |
| `RELAY_KEY` | services | anvil #0 | Key that pays gas for settlement txs |
| `PORT` | services | `8787` | API port |
| `KEYS_FILE` | services | `.data/enclave-keys.json` | Enclave key storage (sealed storage stand-in) |
| `NEXT_PUBLIC_API_URL` | web | `http://127.0.0.1:8787` | Node API location |

---

## 11. The privacy model

**Be precise about this when pitching — an informed judge will check.**

### Genuinely private, forever
- **Your limit price.** Never revealed, not even after a fill.
- **The resting order book.** Exists only in enclave memory.
- **Whether/when an order will match**, your expiry, market-vs-limit choice, strategy.
- **Contents of orders that never match.** Cancelled or expired orders keep their secrets permanently.

### Public at submission
`submitOrder` publicly records **who submitted**, the **collateral token**, and the **amount**.
For this pair, locking FXRP implies a sell and locking USDC implies a buy, and the amount
bounds your size.

**Mitigation shipped:** the order form has a **privacy padding** control (+10/25/50%) that
over-locks collateral, so observers see only an upper bound. Unused collateral is refunded
automatically on fill or cancel (contract-tested).

### Public at settlement
The `TradeSettled` event publishes the matched order pair, execution price, and amounts — the
transfers have to be public because vault balances are per-address and on-chain. This mirrors
traditional dark pools, which also print trades after execution.

### Why this still defeats front-running
To front-run you, an adversary needs to know **what price you'll accept**. That is exactly
what never leaves the enclave. Knowing "someone locked 10,000 FXRP" without knowing their
limit, timing, or whether it'll even match is not actionable the way a public order book is.

---

## 12. Known limitations and gotchas

**Architectural**
1. **Simulated TEE** — see [status](#2-project-status). The headline caveat.
2. **Direction/size leak via collateral** — mitigated by padding, not eliminated. Full
   direction-hiding needs dual-token collateral or a shielded balance pool.
3. **Single enclave, no HA** — if the node dies, orders stop matching. Funds stay safe and
   cancellation works without it, but there's no failover.
4. **Enclave state is in-memory** — restart the node and the resting book is lost. Orders
   remain Active on-chain, so they'd need re-feeding from events (not implemented).
5. **Trade log is a JSON file** — fine for a hackathon, replace with Postgres for production.

**Practical gotchas that will bite you**
6. **`localStorage` is the only copy of your plaintext orders.** Clear browser data and the
   Orders page can no longer show your own order details (they still exist on-chain and still
   match — you just can't read them locally).
7. **Nonce collisions** — scripts submitting in parallel need ethers' `NonceManager`.
   Already handled in the provided scripts; remember it if you write new ones.
8. **The enclave clamps prices tighter than the contract** (1.5% vs 2%) so oracle drift
   between match time and settlement doesn't cause reverts. If you change one, change both.
9. **Decimals differ** — FXRP is 18, USDC is 6, prices are always 18. Conversion errors here
   are the easiest bug to introduce; see `quoteFor()` in `engine.ts`.
10. **`deployments/<chainId>.json` is the source of truth** for the node and frontend.
    Redeploy without restarting the node and it'll talk to the old contracts.

---

## 13. Where to contribute next

Roughly ordered by value:

1. **Real TEE deployment** — move `services/src/enclave/` into Flare Confidential Compute,
   replace the ECDSA signature with a hardware attestation quote, and verify the quote in
   `SettlementEngine.verifyAttestation`. This is the headline feature.
2. **Order book recovery on restart** — replay `OrderSubmitted` events for still-Active orders
   so a node restart doesn't strand the book.
3. **More pairs** — FBTC/USDC needs only a `PairConfig` entry plus its FTSO feed ID; the
   engine is already multi-pair.
4. **Stronger size privacy** — randomised padding by default, or a shielded collateral pool.
5. **Fee mechanism** — basis points on settled notional, taken from the quote leg.
6. **Real FAssets** — swap the mock ERC-20s for actual FXRP once minting is wired.
7. **Multi-node / failover** — the hard, interesting problem: multiple enclaves sharing a book
   without leaking it.

### Conventions
- Keep the enclave/relay boundary clean — no filesystem or network calls in `src/enclave/`.
- Any change to matching or settlement needs both a unit test and a `simulate.ts` run.
- Contracts: every new rejection path gets a test proving it reverts.
- Be honest in UI copy about what's private. Overclaiming is the one thing that will sink this
  project's credibility.

---

## 14. Troubleshooting

| Symptom | Cause / fix |
|---|---|
| `no deployment file at ...` | Run the deploy script for that chain first |
| Frontend shows "Enclave offline" | Node isn't running, or `NEXT_PUBLIC_API_URL` is wrong |
| Orders submit but never match | Check the node log — likely no FTSO price yet, prices don't cross, or both orders are from the same address (self-trades are blocked) |
| `settlement failed: PriceOutOfBand` | FTSO moved more than 2% between match and settlement; check oracle freshness |
| Wallet shows gas as "ETH" | You're on the wrong network — the app's banner will switch you to Coston2 (gas is C2FLR) |
| Connect button does nothing | Multiple wallet extensions — the picker lists them all via EIP-6963; pick one |
| `nonce too low` in scripts | Wrap the signer in `NonceManager` |
| Vault balances show zero | Wallet is on a different chain than the deployment |

---

## Flare integration summary

- **Confidential Compute** — the matching engine is architected for the TEE: sealed keys,
  deterministic core, attestation-signed settlements verified on-chain.
- **FTSO** — reference pricing for market orders inside the enclave, the on-chain 2% price
  band in `SettlementEngine`, and live prices/charts in the UI. Read via
  `FlareContractRegistry` → `FtsoV2` → `getFeedById`.
- **FAssets** — FXRP is the flagship traded asset; the vault is standard ERC-20 escrow, so any
  FAsset lists by adding a pair config.
