/**
 * Public API for the frontend. Serves only public data: the enclave's box
 * public key (needed to encrypt orders), aggregate stats, settled trades, and
 * FTSO price history. Order contents never pass through here.
 */
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
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

  // Serve the statically-exported frontend from the same origin, when it has
  // been built. This is what lets the whole product run as ONE deployment:
  // `/api/*` above, everything else the UI. If `web/out` is absent (e.g. during
  // local development, where Next serves itself on its own port) the API simply
  // runs alone.
  const webOut = fileURLToPath(new URL("../../../web/out", import.meta.url));
  if (existsSync(webOut)) {
    // `redirect: false`: the export contains both `trade.html` and a `trade/`
    // directory, and the default behaviour would 301 /trade → /trade/ instead
    // of serving the page.
    app.use(express.static(webOut, { redirect: false }));
    // Next's static export writes <route>.html; fall back to those for deep
    // links like /trade so a refresh doesn't 404.
    app.get("*", (req, res, next) => {
      if (req.path.startsWith("/api/")) return next();
      const page = `${webOut}${req.path.replace(/\/$/, "")}.html`;
      if (existsSync(page)) return res.sendFile(page);
      return res.sendFile(`${webOut}/index.html`);
    });
  }

  return app;
}
