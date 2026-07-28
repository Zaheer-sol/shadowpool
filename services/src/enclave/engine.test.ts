import test from "node:test";
import assert from "node:assert/strict";
import nacl from "tweetnacl";
import { getBytes, hexlify, keccak256, toUtf8Bytes, verifyMessage } from "ethers";
import { generateKeys, keysFromSeed, instructionHash } from "./crypto.js";
import { MatchingEngine, type IncomingOrder } from "./engine.js";
import type { PairConfig, PlainOrder } from "./types.js";

const seed = generateKeys();
const keys = keysFromSeed(seed.boxSecretHex, seed.signerKeyHex);

const PAIR: PairConfig = {
  pair: "FXRP/USDC",
  pairHash: keccak256(toUtf8Bytes("FXRP/USDC")),
  baseToken: "0x1000000000000000000000000000000000000001",
  quoteToken: "0x2000000000000000000000000000000000000002",
  baseDecimals: 18,
  quoteDecimals: 6,
  baseFeedId: "0x015852502f55534400000000000000000000000000",
};

const BUYER = "0xaaa0000000000000000000000000000000000aaa";
const SELLER = "0xbbb0000000000000000000000000000000000bbb";
const PRICE = 3n * 10n ** 18n; // 3.00 USDC per FXRP

let now = 1_000_000;
const host = {
  getPrice: () => PRICE,
  now: () => now,
  log: () => {},
};

function encrypt(plain: PlainOrder): string {
  const eph = nacl.box.keyPair();
  const nonce = nacl.randomBytes(24);
  const box = nacl.box(new TextEncoder().encode(JSON.stringify(plain)), nonce, keys.boxPublicKey, eph.secretKey);
  const payload = new Uint8Array(32 + 24 + box.length);
  payload.set(eph.publicKey, 0);
  payload.set(nonce, 32);
  payload.set(box, 56);
  return hexlify(payload);
}

let seq = 0;
function order(
  trader: string,
  direction: "buy" | "sell",
  amountBase: bigint,
  limitPrice: bigint | null,
  depositAmount: bigint,
): IncomingOrder {
  const plain: PlainOrder = {
    direction,
    pair: "FXRP/USDC",
    amount: amountBase.toString(),
    limitPrice: limitPrice === null ? null : limitPrice.toString(),
    expiry: now + 3600,
    trader,
  };
  return {
    orderId: keccak256(toUtf8Bytes(`order-${seq++}`)),
    trader,
    pairHash: PAIR.pairHash,
    depositToken: direction === "sell" ? PAIR.baseToken : PAIR.quoteToken,
    depositAmount,
    encryptedPayload: encrypt(plain),
  };
}

function freshEngine(): MatchingEngine {
  return new MatchingEngine(keys, 31337n, "0x3000000000000000000000000000000000000003", [PAIR], host);
}

test("garbage payload is rejected without crashing", async () => {
  const engine = freshEngine();
  const bad = order(SELLER, "sell", 10n ** 18n, null, 10n ** 18n);
  bad.encryptedPayload = "0x" + "ab".repeat(80);
  assert.deepEqual(await engine.submitOrder(bad), []);
  assert.equal(engine.openOrderCount, 0);
});

test("crossing limit orders match at a band-clamped price", async () => {
  const engine = freshEngine();
  const sellAmt = 10_000n * 10n ** 18n;
  // Seller asks 2.95, buyer bids 3.05 — mid is 3.00, inside the band.
  assert.deepEqual(await engine.submitOrder(order(SELLER, "sell", sellAmt, 295n * 10n ** 16n, sellAmt)), []);
  const results = await engine.submitOrder(order(BUYER, "buy", sellAmt, 305n * 10n ** 16n, 31_000n * 10n ** 6n));

  assert.equal(results.length, 1);
  const ix = results[0].instruction;
  assert.equal(ix.executionPrice, PRICE);
  assert.equal(ix.baseAmount, sellAmt);
  assert.equal(ix.quoteAmount, 30_000n * 10n ** 6n);
  assert.ok(ix.buyFullyFilled && ix.sellFullyFilled);
  assert.equal(engine.openOrderCount, 0);

  // Attestation must recover to the enclave signer over the contract digest.
  const digest = instructionHash(31337n, "0x3000000000000000000000000000000000000003", ix);
  assert.equal(verifyMessage(getBytes(digest), results[0].attestation), keys.signer.address);
});

test("partial fill keeps the larger order resting", async () => {
  const engine = freshEngine();
  await engine.submitOrder(order(SELLER, "sell", 10_000n * 10n ** 18n, PRICE, 10_000n * 10n ** 18n));
  const results = await engine.submitOrder(order(BUYER, "buy", 4_000n * 10n ** 18n, PRICE, 12_000n * 10n ** 6n));

  assert.equal(results.length, 1);
  const ix = results[0].instruction;
  assert.equal(ix.baseAmount, 4_000n * 10n ** 18n);
  assert.ok(ix.buyFullyFilled);
  assert.ok(!ix.sellFullyFilled);
  assert.equal(engine.openOrderCount, 1); // seller still resting with 6,000 FXRP
});

test("market orders execute at the FTSO price", async () => {
  const engine = freshEngine();
  await engine.submitOrder(order(SELLER, "sell", 1_000n * 10n ** 18n, null, 1_000n * 10n ** 18n));
  const results = await engine.submitOrder(order(BUYER, "buy", 1_000n * 10n ** 18n, null, 3_100n * 10n ** 6n));
  assert.equal(results.length, 1);
  assert.equal(results[0].instruction.executionPrice, PRICE);
});

test("non-crossing book does not match", async () => {
  const engine = freshEngine();
  await engine.submitOrder(order(SELLER, "sell", 1_000n * 10n ** 18n, 320n * 10n ** 16n, 1_000n * 10n ** 18n));
  const results = await engine.submitOrder(
    order(BUYER, "buy", 1_000n * 10n ** 18n, 280n * 10n ** 16n, 2_800n * 10n ** 6n),
  );
  assert.deepEqual(results, []);
  assert.equal(engine.openOrderCount, 2);
});

test("expired orders are pruned on tick", async () => {
  const engine = freshEngine();
  await engine.submitOrder(order(SELLER, "sell", 1_000n * 10n ** 18n, PRICE, 1_000n * 10n ** 18n));
  assert.equal(engine.openOrderCount, 1);
  now += 4_000; // past expiry
  await engine.tick();
  assert.equal(engine.openOrderCount, 0);
  now -= 4_000;
});

test("self-trades are never matched", async () => {
  const engine = freshEngine();
  await engine.submitOrder(order(SELLER, "sell", 1_000n * 10n ** 18n, PRICE, 1_000n * 10n ** 18n));
  const results = await engine.submitOrder(
    order(SELLER, "buy", 1_000n * 10n ** 18n, PRICE, 3_000n * 10n ** 6n),
  );
  assert.deepEqual(results, []);
});
