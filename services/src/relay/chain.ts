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

  /** Subscribe to OrderBook events and feed them into the enclave. */
  listen(engine: MatchingEngine): void {
    // Ethers v6 passes a ContractEventPayload as the last listener argument;
    // read decoded args off it so the shape never bites.
    this.orderBook.on("OrderSubmitted", async (...listenerArgs: unknown[]) => {
      const payload = listenerArgs.at(-1) as { args: unknown[] };
      const [orderId, trader, pairHash, depositToken, depositAmount, encryptedPayload] = payload.args;
      this.log(`chain: OrderSubmitted ${String(orderId).slice(0, 10)}… from ${String(trader).slice(0, 8)}…`);
      const incoming: IncomingOrder = {
        orderId: String(orderId),
        trader: String(trader),
        pairHash: String(pairHash),
        depositToken: String(depositToken),
        depositAmount: BigInt(depositAmount as bigint),
        encryptedPayload: String(encryptedPayload),
      };
      await this.settleAll(await engine.submitOrder(incoming));
    });

    this.orderBook.on("OrderCancelled", (...listenerArgs: unknown[]) => {
      const payload = listenerArgs.at(-1) as { args: unknown[] };
      const orderId = String(payload.args[0]);
      this.log(`chain: OrderCancelled ${orderId.slice(0, 10)}…`);
      engine.cancelOrder(orderId);
    });
  }

  /** Submit signed settlement instructions on-chain and record outcomes. */
  async settleAll(results: MatchResult[]): Promise<void> {
    for (const { instruction: ix, attestation } of results) {
      const pairName = this.pairs.find((p) => p.pairHash === ix.pair)?.pair ?? ix.pair;
      try {
        const tx = await this.settlement.settle(
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
        );
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
