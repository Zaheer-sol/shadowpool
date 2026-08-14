/**
 * ShadowPool node entrypoint. Boots the (simulated) enclave, wires it to the
 * chain relay, and serves the public API.
 *
 * Env:
 *   RPC_URL          chain RPC       (default http://127.0.0.1:8545)
 *   DEPLOYMENT_FILE  deployment json (default ../contracts/deployments/<chainId>.json)
 *   RELAY_KEY        tx submitter    (default anvil #0 — set a funded key on Coston2)
 *   PORT             API port        (default 8787)
 *   KEYS_FILE        enclave keys    (default .data/enclave-keys.json; sealed storage in prod)
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { Wallet } from "ethers";
import { generateKeys, keysFromSeed } from "./enclave/crypto.js";
import { MatchingEngine } from "./enclave/engine.js";
import { ChainRelay, defaultPairs, type Deployment } from "./relay/chain.js";
import { TradeStore } from "./relay/store.js";
import { createServer } from "./relay/server.js";

const log = (msg: string) => console.log(`[${new Date().toISOString()}] ${msg}`);

const RPC_URL = process.env.RPC_URL ?? "http://127.0.0.1:8545";
const PORT = Number(process.env.PORT ?? 8787);
const KEYS_FILE = resolve(process.env.KEYS_FILE ?? ".data/enclave-keys.json");
const ANVIL_0 = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";

async function main() {
  // --- enclave keys (sealed storage stand-in) ---
  //
  // Prefer env vars. Hosted platforms (Render, Railway, Fly) usually give you an
  // ephemeral filesystem, so a file-based key would be regenerated on every
  // deploy — the new signer would no longer match the on-chain `teeSigner` and
  // EVERY settlement would revert with InvalidAttestation. Supplying the keys
  // as secrets keeps the enclave identity stable across restarts.
  let seed: { boxSecretHex: string; signerKeyHex: string };
  if (process.env.ENCLAVE_BOX_SECRET && process.env.ENCLAVE_SIGNER_KEY) {
    seed = {
      boxSecretHex: process.env.ENCLAVE_BOX_SECRET,
      signerKeyHex: process.env.ENCLAVE_SIGNER_KEY,
    };
    log("enclave keys loaded from environment");
  } else {
    if (!existsSync(KEYS_FILE)) {
      mkdirSync(dirname(KEYS_FILE), { recursive: true });
      writeFileSync(KEYS_FILE, JSON.stringify(generateKeys(), null, 2), { mode: 0o600 });
      log(`generated new enclave keys at ${KEYS_FILE}`);
    }
    seed = JSON.parse(readFileSync(KEYS_FILE, "utf8"));
  }
  const keys = keysFromSeed(seed.boxSecretHex, seed.signerKeyHex);
  log(`enclave signer: ${keys.signer.address}`);

  // --- deployment ---
  const relayWallet = new Wallet(process.env.RELAY_KEY ?? ANVIL_0);
  const probe = new ChainRelayProbe(RPC_URL);
  const chainId = await probe.chainId();
  const deploymentFile = resolve(
    process.env.DEPLOYMENT_FILE ?? `../contracts/deployments/${chainId}.json`,
  );
  if (!existsSync(deploymentFile)) {
    throw new Error(`no deployment file at ${deploymentFile} — run the Deploy script first`);
  }
  const deployment = JSON.parse(readFileSync(deploymentFile, "utf8")) as Deployment;
  log(`deployment loaded for chain ${chainId}: engine ${deployment.settlementEngine}`);

  // --- wiring ---
  const store = new TradeStore(resolve(".data/trades.json"));
  const pairs = defaultPairs(deployment);
  const relay = new ChainRelay(RPC_URL, deployment, pairs, relayWallet, store, log);
  const engine = new MatchingEngine(
    keys,
    BigInt(chainId),
    deployment.settlementEngine,
    pairs,
    {
      getPrice: (pair) => relay.getPrice(pair),
      now: () => Math.floor(Date.now() / 1000),
      log: (msg) => log(`enclave: ${msg}`),
    },
  );

  await relay.ensureTeeSigner(keys.signer.address);
  // Analytics reads a JSON cache that ephemeral hosting wipes on deploy;
  // settlements are permanent on chain, so rebuild the history from there.
  await relay.backfillTrades(Number(process.env.BACKFILL_BLOCKS ?? 2000));
  await relay.refreshPrices();
  // Replay recent history so a restart doesn't strand still-open orders with
  // their collateral locked and no way to ever match. ~2000 Coston2 blocks is
  // roughly an hour; raise BACKFILL_BLOCKS to look further back.
  relay.listen(engine, Number(process.env.BACKFILL_BLOCKS ?? 2000));
  setInterval(() => void relay.refreshPrices(), 2000);
  // Matching already runs on every order insert; this tick is the fallback that
  // prunes expiries and re-crosses resting orders when the FTSO price moves.
  // 2s keeps a market order that arrived before the first price tick from
  // sitting idle for several seconds.
  setInterval(() => void engine.tick().then((r) => relay.settleAll(r)), 2000);

  const app = createServer(keys, engine, relay, store, Math.floor(Date.now() / 1000));
  // Bind 0.0.0.0 — hosted platforms route to the container's external interface.
  app.listen(PORT, "0.0.0.0", () => log(`api listening on port ${PORT}`));
}

/** Tiny helper to read the chain id before constructing the full relay. */
class ChainRelayProbe {
  constructor(private readonly rpcUrl: string) {}
  async chainId(): Promise<number> {
    const res = await fetch(this.rpcUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_chainId", params: [] }),
    });
    const json = (await res.json()) as { result: string };
    return Number(json.result);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
