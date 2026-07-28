# ShadowPool — an on-chain dark pool for FAssets

**Track 2: Confidential Compute Applications · Flare Summer Signal Hackathon**

Repo: https://github.com/0x-kayser/shadowpool · Demo recording script: [DEMO.md](DEMO.md)

On a transparent chain, a large order is a signal everyone trades against. ShadowPool is a
private trading venue for FAssets (FXRP/USDC): orders are encrypted in the trader's browser,
matched inside a (TEE-ready) enclave against FTSO reference prices, and settled on-chain
through a contract that verifies the enclave's signature and re-checks the price against FTSO
before a single token moves.

```
Trader ──encrypted order──▶ OrderBook.sol ──event──▶ Relay ──▶ Enclave (decrypt, match, sign)
                                                                    │
Vault balances ◀── SettlementEngine.sol ◀──signed settlement instruction──┘
        (verify signature · replay guard · 2% FTSO price band · collateral bounds)
```

## Repository layout

| Path | What it is |
|---|---|
| `contracts/` | Foundry project — `ShadowVault`, `OrderBook`, `SettlementEngine`, `PriceOracle`, mocks, 14 tests, deploy script |
| `services/` | The off-chain node. `src/enclave/` is the TEE-ready matching engine (pure logic, injected I/O, NaCl order decryption, ECDSA attestation signing, 7 unit tests). `src/relay/` bridges chain events ↔ enclave and serves the public API |
| `web/` | Next.js frontend — landing, trade, vault, orders, analytics, security, docs |

## What's private vs. public

Private (enclave only): order direction, size, price, trader-per-order, the resting book.
Public (on-chain): vault deposits/withdrawals, settled transfers, total volume, attestation
signatures, contract addresses.

## Trust model in one paragraph

The chain does not trust the enclave. `SettlementEngine.settle()` requires (1) an ECDSA
signature by the registered enclave key over the exact instruction, (2) a never-seen match id,
(3) both orders Active, (4) execution price within 2% of the live FTSO price, and (5) transfers
drawn only from collateral each trader locked when submitting. A fully compromised matcher can
therefore do nothing worse than match real orders at market prices. Funds never leave the
`ShadowVault` contract; if the enclave dies, traders cancel on-chain and withdraw.

While Flare Confidential Compute is pre-launch, the node runs the identical engine as a normal
process (“simulated” mode). The enclave module has no filesystem/network dependencies, so it
lifts into the real TEE unchanged; the on-chain verification path is identical either way.

## Run it locally (three terminals)

```bash
# 0. prerequisites: node 20+, pnpm, foundry

# 1. chain
anvil

# 2. deploy + node
cd contracts && forge script script/Deploy.s.sol --rpc-url http://127.0.0.1:8545 --broadcast
cd ../services && pnpm install && pnpm start        # boots enclave + relay + API :8787

# 3. frontend
cd web && pnpm install && pnpm dev                  # http://localhost:3000

# optional: scripted two-trader demo (deposits, encrypted orders, match, settle)
cd services && pnpm tsx scripts/demo.ts
```

MetaMask: add network `http://127.0.0.1:8545`, chain id 31337, then use the Vault page faucet.

## Deploy to Coston2

```bash
# fund the deployer in contracts/.env with C2FLR: https://faucet.flare.network
cd contracts && ./deploy-coston2.sh
# then: restart the node with RPC_URL=https://coston2-api.flare.network/ext/C/rpc RELAY_KEY=$PRIVATE_KEY
# frontend: NEXT_PUBLIC_API_URL=<node url> pnpm build
```

The script checks the faucet balance, reads the enclave signer from the node's key file,
deploys all contracts + test tokens, and writes `deployments/114.json` for the node/frontend.

### Live Coston2 deployment

| Contract | Address |
|---|---|
| ShadowVault | [`0x62273F162ddCdEB69311A4b87D69Eb3eDD34af18`](https://coston2-explorer.flare.network/address/0x62273F162ddCdEB69311A4b87D69Eb3eDD34af18) |
| OrderBook | [`0x70ff8f4DA28B2c13C0614539e701a6Bc3e8b5dA5`](https://coston2-explorer.flare.network/address/0x70ff8f4DA28B2c13C0614539e701a6Bc3e8b5dA5) |
| SettlementEngine | [`0x3A552EB014a19ED2F09121F472431fB0910DFaaa`](https://coston2-explorer.flare.network/address/0x3A552EB014a19ED2F09121F472431fB0910DFaaa) |
| PriceOracle (FtsoV2) | [`0x7cE817e8E51108d57B31E3e9061DAB9F4E542840`](https://coston2-explorer.flare.network/address/0x7cE817e8E51108d57B31E3e9061DAB9F4E542840) |
| FXRP (test) | `0xd062F2Dd4984727f1129cCdEcDD0798CE9CDc15a` |
| USDC (test) | `0x4C6549249c26Dee1AeE57fF22ac1457EC4BA2b51` |

First settled trade (encrypted orders → TEE match at 99% of live FTSO → on-chain verification):
[`0x62263f…6028`](https://coston2-explorer.flare.network/tx/0x62263f12cfa841542d860c0a8dcd6b27b6ee47003d1ea5f5d6837a30ba7f6028)

On Coston2 the `PriceOracle` reads real FTSO feeds through the `FlareContractRegistry`
(`0xaD67FE66660Fb8dFE9d6b1b4240d8650e30F6019`); locally it uses an owner-set fallback price.

## Tests

```bash
cd contracts && forge test     # 14 tests: lifecycle, partial fills, replay/signature/band/overfill rejections
cd services && pnpm test       # 7 tests: encryption roundtrip, matching, expiry, self-trade guard, digest compat
```

## Flare integration

- **Confidential Compute** — the matching engine is architected for the TEE: sealed keys,
  deterministic core, attestation-signed settlement instructions verified on-chain.
- **FTSO** — reference pricing for market orders inside the enclave, the on-chain 2% sanity
  band in `SettlementEngine`, and live prices/charts in the UI.
- **FAssets** — FXRP is the flagship traded asset; the vault is standard ERC-20 escrow, so any
  FAsset lists by adding a pair config.
