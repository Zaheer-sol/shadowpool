/**
 * Full product lifecycle simulation with on-chain assertions.
 *
 * Steps:
 *   1. Two traders mint test tokens and deposit into the ShadowVault.
 *   2. Seller places an encrypted limit order, then CANCELS it — assert the
 *      collateral unlocks.
 *   3. Seller re-places the sell (10,000 FXRP); buyer sends a 4,000 market buy —
 *      assert a PARTIAL fill: buyer done, seller resting with 6,000.
 *   4. Buyer sends a second 6,000 market buy — assert the seller fills fully.
 *   5. Both traders WITHDRAW their proceeds to their wallets — assert ERC-20
 *      balances actually moved.
 *
 * Run with the node up:  RPC_URL=<rpc> pnpm tsx scripts/simulate.ts
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import nacl from "tweetnacl";
import {
  Contract,
  JsonRpcProvider,
  NonceManager,
  Wallet,
  getBytes,
  hexlify,
  keccak256,
  parseUnits,
  toUtf8Bytes,
} from "ethers";

const RPC_URL = process.env.RPC_URL ?? "http://127.0.0.1:8545";
const API_URL = process.env.API_URL ?? "http://127.0.0.1:8787";
const SELLER_KEY = process.env.SELLER_KEY ?? "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d";
const BUYER_KEY = process.env.BUYER_KEY ?? "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a";

const erc20Abi = [
  "function mint(address,uint256)",
  "function approve(address,uint256) returns (bool)",
  "function balanceOf(address) view returns (uint256)",
];
const vaultAbi = [
  "function deposit(address,uint256)",
  "function withdraw(address,uint256)",
  "function totalBalance(address,address) view returns (uint256)",
  "function lockedBalance(address,address) view returns (uint256)",
  "function availableBalance(address,address) view returns (uint256)",
];
const bookAbi = [
  "function submitOrder(bytes32,bytes,address,uint256) returns (bytes32)",
  "function cancelOrder(bytes32)",
  "function getTraderOrders(address) view returns (bytes32[])",
  "function getOrder(bytes32) view returns (tuple(bytes32 orderId, address trader, bytes32 pair, address depositToken, uint256 depositRemaining, uint64 timestamp, uint8 status, bytes encryptedPayload))",
  "event OrderSubmitted(bytes32 indexed orderId, address indexed trader, bytes32 indexed pair, address depositToken, uint256 depositAmount, bytes encryptedPayload)",
];

const E18 = 10n ** 18n;
let step = 0;
const ok = (msg: string) => console.log(`  ✓ ${msg}`);
const section = (msg: string) => console.log(`\n[${++step}] ${msg}`);
function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(`ASSERTION FAILED: ${msg}`);
  ok(msg);
}

function encrypt(order: object, enclavePubHex: string): string {
  const eph = nacl.box.keyPair();
  const nonce = nacl.randomBytes(24);
  const box = nacl.box(new TextEncoder().encode(JSON.stringify(order)), nonce, getBytes(enclavePubHex), eph.secretKey);
  const payload = new Uint8Array(56 + box.length);
  payload.set(eph.publicKey, 0);
  payload.set(nonce, 32);
  payload.set(box, 56);
  return hexlify(payload);
}

async function tradeCount(): Promise<number> {
  return ((await (await fetch(`${API_URL}/api/trades?limit=200`)).json()) as unknown[]).length;
}

async function waitForTrades(target: number, seconds: number): Promise<void> {
  for (let i = 0; i < seconds; i++) {
    if ((await tradeCount()) >= target) return;
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error(`timed out: expected ${target} settled trades`);
}

async function main() {
  const provider = new JsonRpcProvider(RPC_URL);
  const chainId = Number((await provider.getNetwork()).chainId);
  const d = JSON.parse(readFileSync(resolve(`../contracts/deployments/${chainId}.json`), "utf8"));
  const enclave = (await (await fetch(`${API_URL}/api/enclave`)).json()) as { boxPublicKey: string };
  const prices = (await (await fetch(`${API_URL}/api/prices`)).json()) as { "FXRP/USDC": { latest: string | null } };
  const ftso = BigInt(prices["FXRP/USDC"].latest ?? "0");
  assert(ftso > 0n, `live FTSO price available: ${Number(ftso) / 1e18}`);

  const sellerW = new Wallet(SELLER_KEY, provider);
  const buyerW = new Wallet(BUYER_KEY, provider);
  const seller = Object.assign(new NonceManager(sellerW), { address: sellerW.address });
  const buyer = Object.assign(new NonceManager(buyerW), { address: buyerW.address });
  const pairHash = keccak256(toUtf8Bytes("FXRP/USDC"));
  const expiry = Math.floor(Date.now() / 1000) + 3600;

  const sellAmount = parseUnits("10000", 18);
  const sellLimit = (ftso * 98n) / 100n;
  const usdcFor = (base: bigint) => (base * ftso * 105n * 10n ** 6n) / (100n * E18 * E18);

  const vaultAs = (w: typeof seller) => new Contract(d.vault, vaultAbi, w);
  const bookAs = (w: typeof seller) => new Contract(d.orderBook, bookAbi, w);

  const submitOrder = async (
    w: typeof seller,
    plain: object,
    token: string,
    amount: bigint,
  ): Promise<string> => {
    const tx = await bookAs(w).submitOrder(pairHash, encrypt(plain, enclave.boxPublicKey), token, amount);
    const receipt = await tx.wait();
    for (const log of receipt.logs) {
      try {
        const parsed = bookAs(w).interface.parseLog(log);
        if (parsed?.name === "OrderSubmitted") return parsed.args[0] as string;
      } catch { /* not ours */ }
    }
    throw new Error("no OrderSubmitted event");
  };

  // Idempotency: cancel any orders left resting by earlier runs so matching
  // assertions below see a clean book.
  for (const w of [seller, buyer]) {
    const ids: string[] = await bookAs(w).getTraderOrders(w.address);
    for (const id of ids) {
      const o = await bookAs(w).getOrder(id);
      if (Number(o.status) === 1) {
        await (await bookAs(w).cancelOrder(id)).wait();
        console.log(`  (cleaned up resting order ${id.slice(0, 10)}…)`);
      }
    }
  }

  // Baselines: earlier runs may have left balances in the vault, so every
  // assertion below checks deltas, not absolutes.
  const buyerFxrpBase: bigint = await vaultAs(buyer).totalBalance(buyer.address, d.fxrp);

  // ---------- 1. fund + deposit ----------
  section("Mint and deposit");
  for (const [w, token, amount] of [
    [seller, d.fxrp, sellAmount],
    [buyer, d.usdc, usdcFor(sellAmount)],
  ] as const) {
    const erc20 = new Contract(token, erc20Abi, w);
    await (await erc20.mint(w.address, amount)).wait();
    await (await erc20.approve(d.vault, amount)).wait();
    await (await vaultAs(w).deposit(token, amount)).wait();
  }
  ok(`seller deposited 10,000 FXRP, buyer deposited ${Number(usdcFor(sellAmount)) / 1e6} USDC`);

  // ---------- 2. place + cancel ----------
  section("Place an encrypted order, then cancel it");
  const cancelId = await submitOrder(
    seller,
    { direction: "sell", pair: "FXRP/USDC", amount: sellAmount.toString(), limitPrice: sellLimit.toString(), expiry, trader: seller.address },
    d.fxrp,
    sellAmount,
  );
  let locked: bigint = await vaultAs(seller).lockedBalance(seller.address, d.fxrp);
  assert(locked === sellAmount, "collateral locked behind the order");
  await (await bookAs(seller).cancelOrder(cancelId)).wait();
  locked = await vaultAs(seller).lockedBalance(seller.address, d.fxrp);
  assert(locked === 0n, "cancel released the collateral");
  const cancelled = await bookAs(seller).getOrder(cancelId);
  assert(Number(cancelled.status) === 3, "order marked Cancelled on-chain");

  // ---------- 3. partial fill ----------
  section("Re-place the sell; partial fill with a 4,000 market buy");
  const before = await tradeCount();
  const sellId = await submitOrder(
    seller,
    { direction: "sell", pair: "FXRP/USDC", amount: sellAmount.toString(), limitPrice: sellLimit.toString(), expiry, trader: seller.address },
    d.fxrp,
    sellAmount,
  );
  const buy1 = parseUnits("4000", 18);
  await submitOrder(
    buyer,
    { direction: "buy", pair: "FXRP/USDC", amount: buy1.toString(), limitPrice: null, expiry, trader: buyer.address },
    d.usdc,
    usdcFor(buy1),
  );
  await waitForTrades(before + 1, 60);
  const sellAfterPartial = await bookAs(seller).getOrder(sellId);
  assert(Number(sellAfterPartial.status) === 1, "seller order still Active after partial fill");
  assert(
    (sellAfterPartial.depositRemaining as bigint) === parseUnits("6000", 18),
    "seller has exactly 6,000 FXRP collateral remaining",
  );
  const buyerFxrp1: bigint = await vaultAs(buyer).totalBalance(buyer.address, d.fxrp);
  assert(buyerFxrp1 - buyerFxrpBase === buy1, "buyer received 4,000 FXRP in the vault");

  // ---------- 4. fill the rest ----------
  section("Second market buy (6,000) fills the seller completely");
  const buy2 = parseUnits("6000", 18);
  await submitOrder(
    buyer,
    { direction: "buy", pair: "FXRP/USDC", amount: buy2.toString(), limitPrice: null, expiry, trader: buyer.address },
    d.usdc,
    usdcFor(buy2),
  );
  await waitForTrades(before + 2, 60);
  const sellDone = await bookAs(seller).getOrder(sellId);
  assert(Number(sellDone.status) === 2, "seller order marked Filled");
  const buyerFxrp2: bigint = await vaultAs(buyer).totalBalance(buyer.address, d.fxrp);
  assert(buyerFxrp2 - buyerFxrpBase === sellAmount, "buyer gained the full 10,000 FXRP");
  const sellerLocked: bigint = await vaultAs(seller).lockedBalance(seller.address, d.fxrp);
  assert(sellerLocked === 0n, "no seller collateral left locked");

  // ---------- 5. withdraw ----------
  section("Withdraw proceeds to wallets");
  const sellerUsdcVault: bigint = await vaultAs(seller).availableBalance(seller.address, d.usdc);
  assert(sellerUsdcVault > 0n, `seller earned ${Number(sellerUsdcVault) / 1e6} USDC`);
  const usdcWalletBefore: bigint = await new Contract(d.usdc, erc20Abi, provider).balanceOf(seller.address);
  await (await vaultAs(seller).withdraw(d.usdc, sellerUsdcVault)).wait();
  const usdcWalletAfter: bigint = await new Contract(d.usdc, erc20Abi, provider).balanceOf(seller.address);
  assert(usdcWalletAfter - usdcWalletBefore === sellerUsdcVault, "seller USDC arrived in wallet");

  const fxrpWalletBefore: bigint = await new Contract(d.fxrp, erc20Abi, provider).balanceOf(buyer.address);
  await (await vaultAs(buyer).withdraw(d.fxrp, sellAmount)).wait();
  const fxrpWalletAfter: bigint = await new Contract(d.fxrp, erc20Abi, provider).balanceOf(buyer.address);
  assert(fxrpWalletAfter - fxrpWalletBefore === sellAmount, "buyer FXRP arrived in wallet");

  const trades = (await (await fetch(`${API_URL}/api/trades?limit=2`)).json()) as { txHash: string; executionPrice: string }[];
  console.log("\nSettlement transactions:");
  for (const t of trades) {
    console.log(`  price ${Number(t.executionPrice) / 1e18}  tx ${t.txHash}`);
  }
  console.log("\nFULL LIFECYCLE OK ✓  (deposit → cancel → partial fill → full fill → withdraw)");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
