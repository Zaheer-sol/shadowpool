/**
 * Chain relay: bridges OrderBook events into the enclave and enclave settlement
 * instructions back on-chain. Also maintains a cached FTSO price history for
 * the API. This half of the node is untrusted — it only ever handles encrypted
 * blobs and signed instructions.
 */
import { readFileSync } from "node:fs";
import { Contract, JsonRpcProvider, NonceManager, Wallet, keccak256, toUtf8Bytes } from "ethers";
import { MatchingEngine, type IncomingOrder } from "../enclave/engine.js";
import type { MatchResult, PairConfig } from "../enclave/types.js";
import type { TradeStore } from "./store.js";

const abi = (name: string) =>
  JSON.parse(readFileSync(new URL(`../../abi/${name}.json`, import.meta.url), "utf8")).abi;

export interface Deployment {
  chainId: number;
  vault: string;
  orderBook: string;
  settlementEngine: string;
  priceOracle: string;
  fxrp: string;
  usdc: string;
  teeSigner: string;
}

export interface PricePoint {
  t: number;
  price: string; // 18 decimals
}

export class ChainRelay {
  readonly provider: JsonRpcProvider;
  readonly orderBook: Contract;
  readonly settlement: Contract;
  readonly oracle: Contract;
  readonly priceHistory = new Map<string, PricePoint[]>(); // pair name -> ring buffer
  private readonly latestPrice = new Map<string, bigint>(); // pairHash -> price

  constructor(
    rpcUrl: string,
    readonly deployment: Deployment,
    readonly pairs: PairConfig[],
    private readonly relaySigner: Wallet,
    private readonly store: TradeStore,
    private readonly log: (msg: string) => void,
  ) {
    this.provider = new JsonRpcProvider(rpcUrl, undefined, { pollingInterval: 1500 });
    const managed = new NonceManager(relaySigner.connect(this.provider));
    this.orderBook = new Contract(deployment.orderBook, abi("OrderBook"), managed);
    this.settlement = new Contract(deployment.settlementEngine, abi("SettlementEngine"), managed);
    this.oracle = new Contract(deployment.priceOracle, abi("PriceOracle"), this.provider);
  }

  getPrice(pair: PairConfig): bigint | undefined {
    return this.latestPrice.get(pair.pairHash);
  }

  /** Poll FTSO (via PriceOracle) and append to the history ring buffer. */
  async refreshPrices(): Promise<void> {
    for (const pair of this.pairs) {
      try {
        const [value] = await this.oracle.getPrice.staticCall(pair.baseFeedId);
        this.latestPrice.set(pair.pairHash, value as bigint);
        const hist = this.priceHistory.get(pair.pair) ?? [];
        hist.push({ t: Math.floor(Date.now() / 1000), price: (value as bigint).toString() });
        if (hist.length > 2000) hist.shift();
        this.priceHistory.set(pair.pair, hist);
      } catch (err) {
        this.log(`price refresh failed for ${pair.pair}: ${(err as Error).message}`);
      }
    }
  }

  /**
   * Watch OrderBook events by polling block ranges with `queryFilter`.
   *
   * We deliberately do NOT use ethers' `contract.on()` here. That installs a
   * server-side filter via `eth_newFilter` and polls `eth_getFilterChanges`;
   * public RPC nodes expire those filters (and lose them on restart or
   * load-balancer rotation), after which every poll fails with
   * `-32000 filter not found` and the subscription is permanently dead — while
   * the rest of the process looks perfectly healthy. We hit exactly that in
   * testing: the node ran for 57 hours and silently stopped hearing orders.
   *
   * Block-range polling keeps all state client-side, survives RPC restarts, and
   * catches up automatically after an outage.
   */
  listen(engine: MatchingEngine, fromBlock?: number): void {
    const seen = new Set<string>(); // orderIds already handed to the enclave
    let cursor = fromBlock ?? -1;
    let polling = false;

    const poll = async () => {
      if (polling) return; // never overlap; a slow batch must not double-process
      polling = true;
      try {
        const head = await this.provider.getBlockNumber();
        if (cursor < 0) cursor = head; // first run: start at the tip
        if (head < cursor) return; // RPC rolled back; wait for it to catch up
        // Cap the span so a long outage doesn't request a huge range at once.
        const to = Math.min(head, cursor + 500);

        const [submitted, cancelled] = await Promise.all([
          this.orderBook.queryFilter(this.orderBook.filters.OrderSubmitted(), cursor, to),
          this.orderBook.queryFilter(this.orderBook.filters.OrderCancelled(), cursor, to),
        ]);

        // Process in chain order so a cancel can never precede its submit.
        const events = [...submitted, ...cancelled].sort(
          (a, b) => a.blockNumber - b.blockNumber || a.index - b.index,
        );

        for (const ev of events) {
          const args = (ev as unknown as { args: unknown[]; fragment: { name: string } }).args;
          const name = (ev as unknown as { fragment: { name: string } }).fragment.name;
          const orderId = String(args[0]);

          if (name === "OrderSubmitted") {
            if (seen.has(orderId)) continue; // idempotent across overlapping polls
            seen.add(orderId);
            const [, trader, pairHash, depositToken, depositAmount, encryptedPayload] = args;
            this.log(`chain: OrderSubmitted ${orderId.slice(0, 10)}… from ${String(trader).slice(0, 8)}…`);
            const incoming: IncomingOrder = {
              orderId,
              trader: String(trader),
              pairHash: String(pairHash),
              depositToken: String(depositToken),
              depositAmount: BigInt(depositAmount as bigint),
              encryptedPayload: String(encryptedPayload),
            };
            await this.settleAll(await engine.submitOrder(incoming));
          } else {
            this.log(`chain: OrderCancelled ${orderId.slice(0, 10)}…`);
            engine.cancelOrder(orderId);
          }
        }

        cursor = to + 1;
      } catch (err) {
        // Transient RPC failure: keep the cursor so the next tick retries the
        // same range rather than skipping orders.
        this.log(`event poll failed (will retry): ${(err as Error).message}`);
      } finally {
        polling = false;
      }
    };

    // 1s: this interval is the dominant source of order-to-fill latency, since
    // an order sits unnoticed until the next poll. Coston2 blocks are ~1.8s, so
    // polling faster than this mostly burns RPC quota without finding anything.
    void poll();
    setInterval(() => void poll(), 1000);
  }

  /** Submit signed settlement instructions on-chain and record outcomes. */
  async settleAll(results: MatchResult[]): Promise<void> {
    for (const { instruction: ix, attestation } of results) {
      const pairName = this.pairs.find((p) => p.pairHash === ix.pair)?.pair ?? ix.pair;
      try {
        const args = [
          [
            ix.matchId,
            ix.buyOrderId,
            ix.sellOrderId,
            ix.pair,
            ix.baseToken,
            ix.quoteToken,
            ix.baseAmount,
            ix.quoteAmount,
            ix.executionPrice,
            ix.baseFeedId,
            ix.buyFullyFilled,
            ix.sellFullyFilled,
            ix.timestamp,
          ],
          attestation,
        ] as const;

        // Fixed gas limit, deliberately not estimateGas. Two reasons:
        //   1. Speed — estimateGas is a full RPC round trip on the critical path
        //      of every settlement, and against a public RPC that is often
        //      several hundred ms of pure latency.
        //   2. Reliability — `settle` reads an FTSO feed whose gas cost varies by
        //      block (a feed due for update costs materially more), so an
        //      estimate taken now can be too low by the time the tx executes,
        //      reverting with OutOfGas *after* every validity check has passed.
        // A settle costs ~350k; 1.5M is generous headroom and unused gas is
        // refunded, so the only cost is a higher upfront balance requirement.
        const tx = await this.settlement.settle(...args, { gasLimit: 1_500_000n });
        const receipt = await tx.wait();
        this.store.recordAttempt(true);
        this.store.recordTrade({
          matchId: ix.matchId,
          pair: pairName,
          executionPrice: ix.executionPrice.toString(),
          baseAmount: ix.baseAmount.toString(),
          quoteAmount: ix.quoteAmount.toString(),
          txHash: receipt.hash,
          timestamp: Math.floor(Date.now() / 1000),
        });
        this.log(`settled ${ix.matchId.slice(0, 10)}… in tx ${receipt.hash.slice(0, 10)}…`);
      } catch (err) {
        this.store.recordAttempt(false);
        this.log(`settlement failed for ${ix.matchId.slice(0, 10)}…: ${(err as Error).message}`);
      }
    }
  }

  /** Ensure the on-chain teeSigner matches the enclave key (local dev convenience). */
  async ensureTeeSigner(enclaveSigner: string): Promise<void> {
    const current = (await this.settlement.teeSigner()) as string;
    if (current.toLowerCase() === enclaveSigner.toLowerCase()) return;
    try {
      const tx = await this.settlement.setTeeSigner(enclaveSigner);
      await tx.wait();
      this.log(`registered enclave signer ${enclaveSigner} on-chain`);
    } catch {
      this.log(
        `WARNING: on-chain teeSigner is ${current}, enclave signs as ${enclaveSigner}, ` +
          `and the relay key is not the owner. Settlements will revert until fixed.`,
      );
    }
  }
}

export function defaultPairs(deployment: Deployment): PairConfig[] {
  return [
    {
      pair: "FXRP/USDC",
      pairHash: keccak256(toUtf8Bytes("FXRP/USDC")),
      baseToken: deployment.fxrp,
      quoteToken: deployment.usdc,
      baseDecimals: 18,
      quoteDecimals: 6,
      // FTSO v2 feed id: 0x01 (crypto category) + "XRP/USD" + zero padding to 21 bytes.
      baseFeedId: "0x015852502f55534400000000000000000000000000",
    },
  ];
}
