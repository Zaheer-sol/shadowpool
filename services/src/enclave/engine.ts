/**
 * The matching engine — the code that runs inside the TEE.
 *
 * Everything here is deterministic given its inputs. The host injects the FTSO
 * price and the clock; the engine never touches the network or filesystem, so
 * the same module can be lifted into Flare Confidential Compute unchanged.
 */
import { keccak256, toUtf8Bytes, AbiCoder } from "ethers";
import { PairBook } from "./book.js";
import { openOrderPayload, signInstruction, type EnclaveKeys } from "./crypto.js";
import type { BookOrder, MatchResult, PairConfig, PlainOrder, SettlementInstruction } from "./types.js";

const E18 = 10n ** 18n;

export interface EngineHost {
  /** Current FTSO price for the pair's base asset, 18 decimals (quote per base). */
  getPrice(pair: PairConfig): bigint | undefined;
  now(): number;
  log(msg: string): void;
}

export interface IncomingOrder {
  orderId: string;
  trader: string;
  pairHash: string;
  depositToken: string;
  depositAmount: bigint;
  encryptedPayload: string;
}

/**
 * Execution prices are clamped slightly tighter than the contract's 2% FTSO band
 * so oracle drift between match time and settle time can't cause reverts.
 */
const ENGINE_BAND_BPS = 150n;

export class MatchingEngine {
  private readonly books = new Map<string, PairBook>(); // pairHash -> book
  private readonly pairsByHash = new Map<string, PairConfig>();
  private matchCounter = 0;

  constructor(
    private readonly keys: EnclaveKeys,
    private readonly chainId: bigint,
    private readonly engineAddress: string,
    pairs: PairConfig[],
    private readonly host: EngineHost,
  ) {
    for (const p of pairs) {
      this.pairsByHash.set(p.pairHash, p);
      this.books.set(p.pairHash, new PairBook());
    }
  }

  /** Decrypt, validate and insert an order; then try to match its pair. */
  async submitOrder(incoming: IncomingOrder): Promise<MatchResult[]> {
    const pair = this.pairsByHash.get(incoming.pairHash);
    if (!pair) {
      this.host.log(`order ${short(incoming.orderId)} rejected: unknown pair`);
      return [];
    }

    const plaintext = openOrderPayload(this.keys, incoming.encryptedPayload);
    if (!plaintext) {
      this.host.log(`order ${short(incoming.orderId)} rejected: cannot decrypt`);
      return [];
    }

    let plain: PlainOrder;
    try {
      plain = JSON.parse(plaintext) as PlainOrder;
    } catch {
      this.host.log(`order ${short(incoming.orderId)} rejected: bad payload`);
      return [];
    }

    const order = this.validate(incoming, plain, pair);
    if (!order) return [];

    this.books.get(incoming.pairHash)!.insert(order);
    this.host.log(
      `order ${short(order.orderId)} accepted: ${order.direction} ${order.remainingBase} base @ ${
        order.limitPrice === null ? "market" : order.limitPrice
      }`,
    );
    return this.matchPair(pair);
  }

  cancelOrder(orderId: string): void {
    for (const book of this.books.values()) {
      if (book.remove(orderId)) {
        this.host.log(`order ${short(orderId)} cancelled`);
        return;
      }
    }
  }

  /** Periodic tick: prune expired orders and re-run matching (market orders may now cross). */
  async tick(): Promise<MatchResult[]> {
    const now = this.host.now();
    const results: MatchResult[] = [];
    for (const [hash, book] of this.books) {
      for (const o of book.pruneExpired(now)) {
        this.host.log(`order ${short(o.orderId)} expired`);
      }
      results.push(...(await this.matchPair(this.pairsByHash.get(hash)!)));
    }
    return results;
  }

  /** Public order count only — nothing about contents leaves the enclave. */
  get openOrderCount(): number {
    let n = 0;
    for (const book of this.books.values()) n += book.depth;
    return n;
  }

  // ---------- internals ----------

  private validate(incoming: IncomingOrder, plain: PlainOrder, pair: PairConfig): BookOrder | null {
    const reject = (why: string) => {
      this.host.log(`order ${short(incoming.orderId)} rejected: ${why}`);
      return null;
    };

    if (plain.trader.toLowerCase() !== incoming.trader.toLowerCase()) {
      return reject("payload trader != on-chain submitter");
    }
    if (keccak256(toUtf8Bytes(plain.pair)) !== incoming.pairHash) return reject("payload pair mismatch");
    if (plain.direction !== "buy" && plain.direction !== "sell") return reject("bad direction");
    if (plain.expiry > 0 && plain.expiry <= this.host.now()) return reject("already expired");

    let amount: bigint, limitPrice: bigint | null;
    try {
      amount = BigInt(plain.amount);
      limitPrice = plain.limitPrice === null ? null : BigInt(plain.limitPrice);
    } catch {
      return reject("non-numeric fields");
    }
    if (amount <= 0n || (limitPrice !== null && limitPrice <= 0n)) return reject("non-positive amount/price");

    // Collateral sanity: sells lock base, buys lock quote.
    const expectedToken = plain.direction === "sell" ? pair.baseToken : pair.quoteToken;
    if (incoming.depositToken.toLowerCase() !== expectedToken.toLowerCase()) {
      return reject("wrong collateral token for direction");
    }
    if (plain.direction === "sell" && incoming.depositAmount < amount) {
      return reject("collateral below sell amount");
    }

    return {
      orderId: incoming.orderId,
      trader: incoming.trader,
      direction: plain.direction,
      pair: plain.pair,
      remainingBase: amount,
      limitPrice,
      expiry: plain.expiry,
      depositRemaining: incoming.depositAmount,
      depositToken: incoming.depositToken,
      submittedAt: this.host.now(),
    };
  }

  private async matchPair(pair: PairConfig): Promise<MatchResult[]> {
    const book = this.books.get(pair.pairHash)!;
    const results: MatchResult[] = [];

    for (;;) {
      const bid = book.bestBid;
      const ask = book.bestAsk;
      if (!bid || !ask) break;
      if (bid.trader.toLowerCase() === ask.trader.toLowerCase()) break; // no self-trades

      const ftso = this.host.getPrice(pair);
      if (ftso === undefined) break; // no reference price — hold matching

      const effBid = bid.limitPrice ?? ftso;
      const effAsk = ask.limitPrice ?? ftso;
      if (effBid < effAsk) break; // no cross

      // Execution price: midpoint, clamped into the FTSO band, re-checked vs limits.
      const lo = (ftso * (10_000n - ENGINE_BAND_BPS)) / 10_000n;
      const hi = (ftso * (10_000n + ENGINE_BAND_BPS)) / 10_000n;
      let px = (effBid + effAsk) / 2n;
      px = px < lo ? lo : px > hi ? hi : px;
      if ((bid.limitPrice !== null && px > bid.limitPrice) || (ask.limitPrice !== null && px < ask.limitPrice)) {
        break; // cross exists but not inside the oracle band — hold
      }

      // Fill size: bounded by both orders and by the buyer's remaining collateral.
      const baseScale = 10n ** BigInt(pair.baseDecimals);
      const quoteScale = 10n ** BigInt(pair.quoteDecimals);
      const quoteFor = (base: bigint) => (base * px * quoteScale) / (E18 * baseScale);

      let fillBase = min(bid.remainingBase, ask.remainingBase, ask.depositRemaining);
      if (quoteFor(fillBase) > bid.depositRemaining) {
        fillBase = (bid.depositRemaining * E18 * baseScale) / (px * quoteScale);
      }
      const fillQuote = quoteFor(fillBase);
      if (fillBase <= 0n || fillQuote <= 0n) {
        // Buyer's collateral can't cover a single unit — drop the bid.
        book.remove(bid.orderId);
        continue;
      }

      bid.remainingBase -= fillBase;
      ask.remainingBase -= fillBase;
      bid.depositRemaining -= fillQuote;
      ask.depositRemaining -= fillBase;

      const buyDone = bid.remainingBase === 0n || bid.depositRemaining === 0n;
      const sellDone = ask.remainingBase === 0n;
      if (buyDone) book.remove(bid.orderId);
      if (sellDone) book.remove(ask.orderId);

      const ix: SettlementInstruction = {
        matchId: keccak256(
          AbiCoder.defaultAbiCoder().encode(
            ["bytes32", "bytes32", "uint256"],
            [bid.orderId, ask.orderId, BigInt(this.matchCounter++)],
          ),
        ),
        buyOrderId: bid.orderId,
        sellOrderId: ask.orderId,
        pair: pair.pairHash,
        baseToken: pair.baseToken,
        quoteToken: pair.quoteToken,
        baseAmount: fillBase,
        quoteAmount: fillQuote,
        executionPrice: px,
        baseFeedId: pair.baseFeedId,
        buyFullyFilled: buyDone,
        sellFullyFilled: sellDone,
        timestamp: this.host.now(),
      };
      const attestation = await signInstruction(this.keys, this.chainId, this.engineAddress, ix);
      results.push({ instruction: ix, attestation });
      this.host.log(
        `match ${short(ix.matchId)}: ${fillBase} base @ ${px} (${buyDone ? "buy done" : "buy partial"}, ${
          sellDone ? "sell done" : "sell partial"
        })`,
      );
    }

    return results;
  }
}

function min(...xs: bigint[]): bigint {
  return xs.reduce((a, b) => (a < b ? a : b));
}

function short(id: string): string {
  return `${id.slice(0, 10)}…`;
}
