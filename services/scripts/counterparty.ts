/**
 * Counterparty on demand — takes the other side of a trade you placed in the UI.
 *
 *   pnpm tsx scripts/counterparty.ts buy 5000    # market-buys 5,000 FXRP
 *   pnpm tsx scripts/counterparty.ts sell 5000   # market-sells 5,000 FXRP
 *
 * Mints/deposits whatever collateral it needs, submits an encrypted market
 * order, then reports the settlement. Uses the funded demo account, anchored
 * to the live FTSO price. RPC_URL env selects the chain (defaults to Coston2
 * if a 114 deployment exists and no local RPC responds).
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

const RPC_URL = process.env.RPC_URL ?? "https://coston2-api.flare.network/ext/C/rpc";
const API_URL = process.env.API_URL ?? "http://127.0.0.1:8787";
const KEY = process.env.COUNTERPARTY_KEY ?? "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d";

const direction = process.argv[2] as "buy" | "sell";
const size = process.argv[3];
if ((direction !== "buy" && direction !== "sell") || !size || Number.isNaN(Number(size))) {
  console.error("usage: pnpm tsx scripts/counterparty.ts <buy|sell> <fxrp amount>");
  process.exit(1);
}

const erc20Abi = ["function mint(address,uint256)", "function approve(address,uint256) returns (bool)"];
const vaultAbi = [
  "function deposit(address,uint256)",
  "function availableBalance(address,address) view returns (uint256)",
];
const bookAbi = ["function submitOrder(bytes32,bytes,address,uint256) returns (bytes32)"];

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

async function main() {
  const provider = new JsonRpcProvider(RPC_URL);
  const chainId = Number((await provider.getNetwork()).chainId);
  const d = JSON.parse(readFileSync(resolve(`../contracts/deployments/${chainId}.json`), "utf8"));
  const enclave = (await (await fetch(`${API_URL}/api/enclave`)).json()) as { boxPublicKey: string };
  const prices = (await (await fetch(`${API_URL}/api/prices`)).json()) as { "FXRP/USDC": { latest: string | null } };
  const ftso = BigInt(prices["FXRP/USDC"].latest ?? "0");
  if (ftso === 0n) throw new Error("no FTSO price from the node yet");

  const w = Object.assign(new NonceManager(new Wallet(KEY, provider)), {
    address: new Wallet(KEY).address,
  });
  const amount = parseUnits(size, 18);
  const needToken = direction === "sell" ? d.fxrp : d.usdc;
  const needAmount =
    direction === "sell" ? amount : (amount * ftso * 105n * 10n ** 6n) / (100n * 10n ** 36n);

  console.log(`counterparty ${w.address.slice(0, 8)}… ${direction}s ${size} FXRP at FTSO ${Number(ftso) / 1e18}`);

  const vault = new Contract(d.vault, vaultAbi, w);
  const available: bigint = await vault.availableBalance(w.address, needToken);
  if (available < needAmount) {
    const missing = needAmount - available;
    const erc20 = new Contract(needToken, erc20Abi, w);
    await (await erc20.mint(w.address, missing)).wait();
    await (await erc20.approve(d.vault, missing)).wait();
    await (await vault.deposit(needToken, missing)).wait();
    console.log("collateral topped up and deposited");
  }

  const payload = encrypt(
    {
      direction,
      pair: "FXRP/USDC",
      amount: amount.toString(),
      limitPrice: null, // market order — crosses anything reasonable
      expiry: Math.floor(Date.now() / 1000) + 3600,
      trader: w.address,
    },
    enclave.boxPublicKey,
  );
  const book = new Contract(d.orderBook, bookAbi, w);
  const before = ((await (await fetch(`${API_URL}/api/trades?limit=200`)).json()) as unknown[]).length;
  await (await book.submitOrder(keccak256(toUtf8Bytes("FXRP/USDC")), payload, needToken, needAmount)).wait();
  console.log("encrypted market order submitted — waiting for a match…");

  for (let i = 0; i < 45; i++) {
    await new Promise((r) => setTimeout(r, 1000));
    const trades = (await (await fetch(`${API_URL}/api/trades?limit=200`)).json()) as {
      txHash: string;
      executionPrice: string;
      baseAmount: string;
    }[];
    if (trades.length > before) {
      const t = trades[0];
      console.log(
        `MATCHED ✓  ${Number(t.baseAmount) / 1e18} FXRP @ ${Number(t.executionPrice) / 1e18}\n` +
          `tx: https://coston2-explorer.flare.network/tx/${t.txHash}`,
      );
      return;
    }
  }
  console.log(
    "no match yet — the order is resting in the enclave. " +
      "It will fill when a crossing order arrives, or expire in an hour.",
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
