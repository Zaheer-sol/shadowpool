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
