/**
 * Public API for the frontend. Serves only public data: the enclave's box
 * public key (needed to encrypt orders), aggregate stats, settled trades, and
 * FTSO price history. Order contents never pass through here.
 */
import express from "express";
import cors from "cors";
import { hexlify } from "ethers";
import type { MatchingEngine } from "../enclave/engine.js";
import type { EnclaveKeys } from "../enclave/crypto.js";
import type { ChainRelay } from "./chain.js";
import type { TradeStore } from "./store.js";

export function createServer(
  keys: EnclaveKeys,
  engine: MatchingEngine,
  relay: ChainRelay,
  store: TradeStore,
  startedAt: number,
) {
  const app = express();
  app.use(cors());

  app.get("/api/enclave", (_req, res) => {
    res.json({
      status: "active",
      mode: "simulated", // would read the attestation quote in production
      boxPublicKey: hexlify(keys.boxPublicKey),
      signerAddress: keys.signer.address,
      openOrders: engine.openOrderCount,
      uptimeSeconds: Math.floor(Date.now() / 1000) - startedAt,
      chainId: relay.deployment.chainId,
      contracts: {
        vault: relay.deployment.vault,
        orderBook: relay.deployment.orderBook,
        settlementEngine: relay.deployment.settlementEngine,
        priceOracle: relay.deployment.priceOracle,
      },
      tokens: { FXRP: relay.deployment.fxrp, USDC: relay.deployment.usdc },
      pairs: relay.pairs.map((p) => ({
        pair: p.pair,
        pairHash: p.pairHash,
        baseToken: p.baseToken,
        quoteToken: p.quoteToken,
        baseDecimals: p.baseDecimals,
        quoteDecimals: p.quoteDecimals,
      })),
    });
  });

  app.get("/api/prices", (_req, res) => {
    const out: Record<string, { latest: string | null; history: { t: number; price: string }[] }> = {};
    for (const p of relay.pairs) {
      const history = relay.priceHistory.get(p.pair) ?? [];
      out[p.pair] = { latest: history.at(-1)?.price ?? null, history };
    }
    res.json(out);
  });

  app.get("/api/trades", (req, res) => {
    const limit = Math.min(Number(req.query.limit ?? 50), 200);
    res.json(store.recent(limit));
  });

  app.get("/api/stats", (_req, res) => {
    res.json({ ...store.stats(), openOrders: engine.openOrderCount, series: store.series() });
  });

  return app;
}
