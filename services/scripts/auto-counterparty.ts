/**
 * Auto-counterparty: watches OrderBook for orders from ANY unknown trader and
 * automatically submits the crossing market order, so a human testing the UI
 * always gets a fill.
 *
 * How it knows what to do without decrypting anything: the collateral is
 * public. Locking FXRP ⇒ the trader is selling (counter with a buy of that
 * size); locking USDC ⇒ buying (counter with a sell of ~budget/price). This
 * is a live demonstration of the documented collateral leak.
 *
 *   pnpm tsx scripts/auto-counterparty.ts    # runs for 45 minutes
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import nacl from "tweetnacl";
import {
  Contract,
  JsonRpcProvider,
  NonceManager,
  Wallet,
  formatUnits,
  getBytes,
  hexlify,
  keccak256,
  toUtf8Bytes,
} from "ethers";

const RPC_URL = process.env.RPC_URL ?? "https://coston2-api.flare.network/ext/C/rpc";
const API_URL = process.env.API_URL ?? "http://127.0.0.1:8787";
const KEY = process.env.COUNTERPARTY_KEY ?? "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d";
const LIFETIME_MS = 45 * 60 * 1000;

const erc20Abi = ["function mint(address,uint256)", "function approve(address,uint256) returns (bool)"];
const vaultAbi = [
  "function deposit(address,uint256)",
  "function availableBalance(address,address) view returns (uint256)",
];
const bookAbi = [
  "function submitOrder(bytes32,bytes,address,uint256) returns (bytes32)",
  "event OrderSubmitted(bytes32 indexed orderId, address indexed trader, bytes32 indexed pair, address depositToken, uint256 depositAmount, bytes encryptedPayload)",
];

const log = (msg: string) => console.log(`[${new Date().toISOString()}] ${msg}`);

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
  const provider = new JsonRpcProvider(RPC_URL, undefined, { pollingInterval: 2000 });
  const chainId = Number((await provider.getNetwork()).chainId);
  const d = JSON.parse(readFileSync(resolve(`../contracts/deployments/${chainId}.json`), "utf8"));
  const enclave = (await (await fetch(`${API_URL}/api/enclave`)).json()) as { boxPublicKey: string };

  const me = Object.assign(new NonceManager(new Wallet(KEY, provider)), {
    address: new Wallet(KEY).address,
  });
  const ignore = new Set([me.address.toLowerCase()]);
  const vault = new Contract(d.vault, vaultAbi, me);
  const book = new Contract(d.orderBook, bookAbi, me);
  let busy = false;

  log(`watching for orders on chain ${chainId} — counterparty ${me.address.slice(0, 10)}…`);
  log(`(place an order from the UI; it will be matched within ~15s)`);

  book.on("OrderSubmitted", async (...args: unknown[]) => {
    const payload = (args.at(-1) as { args: unknown[] }).args;
    const [, trader, , depositToken, depositAmount] = payload as [string, string, string, string, bigint];
    if (ignore.has(String(trader).toLowerCase())) return;
    if (busy) return; // one counter-order at a time
    busy = true;
    try {
      const prices = (await (await fetch(`${API_URL}/api/prices`)).json()) as {
        "FXRP/USDC": { latest: string | null };
      };
      const ftso = BigInt(prices["FXRP/USDC"].latest ?? "0");
      if (ftso === 0n) return;

      const theyLockedBase = String(depositToken).toLowerCase() === String(d.fxrp).toLowerCase();
      // They locked base ⇒ they sell ⇒ we buy the same size.
      // They locked quote ⇒ they buy ⇒ we sell ~their budget at FTSO.
      const myDirection = theyLockedBase ? "buy" : "sell";
      const baseSize = theyLockedBase
        ? BigInt(depositAmount)
        : (BigInt(depositAmount) * 10n ** 30n) / ftso; // quote 6d -> base 18d at FTSO

      log(
        `order from ${String(trader).slice(0, 10)}…: locked ${
          theyLockedBase ? `${formatUnits(depositAmount, 18)} FXRP (a sell)` : `${formatUnits(depositAmount, 6)} USDC (a buy)`
        } → countering with a market ${myDirection} of ~${formatUnits(baseSize, 18)} FXRP`,
      );

      const needToken = myDirection === "sell" ? d.fxrp : d.usdc;
      const needAmount =
        myDirection === "sell" ? baseSize : (baseSize * ftso * 105n * 10n ** 6n) / (100n * 10n ** 36n);
      const available: bigint = await vault.availableBalance(me.address, needToken);
      if (available < needAmount) {
        const missing = needAmount - available;
        const erc20 = new Contract(needToken, erc20Abi, me);
        await (await erc20.mint(me.address, missing)).wait();
        await (await erc20.approve(d.vault, missing)).wait();
        await (await vault.deposit(needToken, missing)).wait();
        log("collateral topped up");
      }

      const encrypted = encrypt(
        {
          direction: myDirection,
          pair: "FXRP/USDC",
          amount: baseSize.toString(),
          limitPrice: null,
          expiry: Math.floor(Date.now() / 1000) + 1800,
          trader: me.address,
        },
        enclave.boxPublicKey,
      );
      await (await book.submitOrder(keccak256(toUtf8Bytes("FXRP/USDC")), encrypted, needToken, needAmount)).wait();
      log("counter-order submitted — the enclave should match within seconds");
    } catch (err) {
      log(`counter failed: ${(err as Error).message}`);
    } finally {
      busy = false;
    }
  });

  setTimeout(() => {
    log("auto-counterparty lifetime reached — exiting");
    process.exit(0);
  }, LIFETIME_MS);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
