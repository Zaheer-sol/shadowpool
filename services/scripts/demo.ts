/**
 * End-to-end demo against a running chain + ShadowPool node.
 *
 *   anvil                       # terminal 1
 *   forge script ... --broadcast# deploy
 *   pnpm start                  # terminal 2 (this node)
 *   pnpm tsx scripts/demo.ts    # terminal 3
 *
 * Plays two traders: seller offers 10,000 FXRP, buyer bids for it. Verifies the
 * enclave matches and the trade settles on-chain.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import nacl from "tweetnacl";
import { Contract, JsonRpcProvider, NonceManager, Wallet, getBytes, hexlify, keccak256, parseUnits, toUtf8Bytes } from "ethers";

const RPC_URL = process.env.RPC_URL ?? "http://127.0.0.1:8545";
const API_URL = process.env.API_URL ?? "http://127.0.0.1:8787";
// anvil accounts #1 and #2
const SELLER_KEY = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d";
const BUYER_KEY = "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a";

const erc20Abi = [
  "function mint(address,uint256)",
  "function approve(address,uint256) returns (bool)",
];
const vaultAbi = [
  "function deposit(address,uint256)",
  "function totalBalance(address,address) view returns (uint256)",
  "function lockedBalance(address,address) view returns (uint256)",
];
const bookAbi = [
  "function submitOrder(bytes32,bytes,address,uint256) returns (bytes32)",
];

function encrypt(order: object, enclavePubHex: string): string {
  const eph = nacl.box.keyPair();
  const nonce = nacl.randomBytes(24);
  const box = nacl.box(
    new TextEncoder().encode(JSON.stringify(order)),
    nonce,
    getBytes(enclavePubHex),
    eph.secretKey,
  );
  const payload = new Uint8Array(56 + box.length);
  payload.set(eph.publicKey, 0);
  payload.set(nonce, 32);
  payload.set(box, 56);
  return hexlify(payload);
}

async function main() {
  const provider = new JsonRpcProvider(RPC_URL);
  const chainId = Number((await provider.getNetwork()).chainId);
  const deployment = JSON.parse(
    readFileSync(resolve(`../contracts/deployments/${chainId}.json`), "utf8"),
  );
  const enclave = (await (await fetch(`${API_URL}/api/enclave`)).json()) as {
    boxPublicKey: string;
  };

  // Anchor the demo to the live FTSO price so it works on any network.
  const prices = (await (await fetch(`${API_URL}/api/prices`)).json()) as {
    "FXRP/USDC": { latest: string | null };
  };
  const ftso = BigInt(prices["FXRP/USDC"].latest ?? "0");
  if (ftso === 0n) throw new Error("no FTSO price yet — let the node run a few seconds");
  console.log(`chain ${chainId}, enclave key ${enclave.boxPublicKey.slice(0, 18)}…, FTSO ${Number(ftso) / 1e18}`);

  const sellerWallet = new Wallet(SELLER_KEY, provider);
  const buyerWallet = new Wallet(BUYER_KEY, provider);
  const seller = Object.assign(new NonceManager(sellerWallet), { address: sellerWallet.address });
  const buyer = Object.assign(new NonceManager(buyerWallet), { address: buyerWallet.address });
  const pairHash = keccak256(toUtf8Bytes("FXRP/USDC"));

  const fxrpAmount = parseUnits("10000", 18);
  // Buyer collateral: 5% above FTSO notional. Seller limit: 2% under FTSO.
  const usdcAmount = (fxrpAmount * ftso * 105n * 10n ** 6n) / (100n * 10n ** 36n);
  const sellLimit = (ftso * 98n) / 100n;

  // Fund + deposit both traders.
  for (const [who, wallet, token, amount] of [
    ["seller", seller, deployment.fxrp, fxrpAmount],
    ["buyer", buyer, deployment.usdc, usdcAmount],
  ] as const) {
    const erc20 = new Contract(token, erc20Abi, wallet);
    await (await erc20.mint(wallet.address, amount)).wait();
    await (await erc20.approve(deployment.vault, amount)).wait();
    const vault = new Contract(deployment.vault, vaultAbi, wallet);
    await (await vault.deposit(token, amount)).wait();
    console.log(`${who} deposited`);
  }

  const expiry = Math.floor(Date.now() / 1000) + 3600;

  // Seller: limit ask 2.95. Buyer: market bid. Should cross at FTSO (3.00).
  const sellPayload = encrypt(
    {
      direction: "sell",
      pair: "FXRP/USDC",
      amount: fxrpAmount.toString(),
      limitPrice: sellLimit.toString(),
      expiry,
      trader: seller.address,
    },
    enclave.boxPublicKey,
  );
  const sellerBook = new Contract(deployment.orderBook, bookAbi, seller);
  await (await sellerBook.submitOrder(pairHash, sellPayload, deployment.fxrp, fxrpAmount)).wait();
  console.log("sell order submitted (encrypted)");

  const buyPayload = encrypt(
    {
      direction: "buy",
      pair: "FXRP/USDC",
      amount: fxrpAmount.toString(),
      limitPrice: null,
      expiry,
      trader: buyer.address,
    },
    enclave.boxPublicKey,
  );
  const buyerBook = new Contract(deployment.orderBook, bookAbi, buyer);
  await (await buyerBook.submitOrder(pairHash, buyPayload, deployment.usdc, usdcAmount)).wait();
  console.log("buy order submitted (encrypted)");

  // Wait for the enclave to match + settle.
  process.stdout.write("waiting for settlement");
  for (let i = 0; i < 30; i++) {
    await new Promise((r) => setTimeout(r, 1000));
    const trades = (await (await fetch(`${API_URL}/api/trades`)).json()) as unknown[];
    process.stdout.write(".");
    if (trades.length > 0) {
      console.log("\nsettled:", JSON.stringify(trades[0], null, 2));
      const vault = new Contract(deployment.vault, vaultAbi, provider);
      const buyerFxrp = await vault.totalBalance(buyer.address, deployment.fxrp);
      const sellerUsdc = await vault.totalBalance(seller.address, deployment.usdc);
      console.log(`buyer vault FXRP:  ${buyerFxrp} (expect ${fxrpAmount})`);
      console.log(`seller vault USDC: ${sellerUsdc}`);
      if (buyerFxrp !== fxrpAmount) throw new Error("buyer did not receive base");
      if (sellerUsdc === 0n) throw new Error("seller did not receive quote");
      console.log("E2E OK ✓");
      return;
    }
  }
  throw new Error("timed out waiting for settlement");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
