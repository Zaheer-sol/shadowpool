/**
 * Client-side order sealing. The order is encrypted in the browser with NaCl box
 * against the enclave's public key — the chain, the relay, and this app's server
 * only ever see the ciphertext. Layout: [32B ephemeral pub | 24B nonce | box].
 */
import nacl from "tweetnacl";
import { getBytes, hexlify } from "ethers";
import type { Direction } from "./types";

export interface OrderPlaintext {
  direction: Direction;
  pair: string;
  amount: string; // base units
  limitPrice: string | null; // 18d
  expiry: number;
  trader: string;
}

export function encryptOrder(order: OrderPlaintext, enclaveBoxPublicKeyHex: string): string {
  const enclavePub = getBytes(enclaveBoxPublicKeyHex);
  const ephemeral = nacl.box.keyPair();
  const nonce = nacl.randomBytes(24);
  const message = new TextEncoder().encode(JSON.stringify(order));
  const box = nacl.box(message, nonce, enclavePub, ephemeral.secretKey);

  const payload = new Uint8Array(32 + 24 + box.length);
  payload.set(ephemeral.publicKey, 0);
  payload.set(nonce, 32);
  payload.set(box, 56);
  return hexlify(payload);
}
