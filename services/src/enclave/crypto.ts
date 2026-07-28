/**
 * Enclave cryptography.
 *
 * Orders are sealed to the enclave with NaCl box (X25519 + XSalsa20-Poly1305):
 * the client generates an ephemeral keypair and encrypts against the enclave's
 * box public key. Payload layout, hex-encoded on-chain:
 *
 *   [32B ephemeral pubkey | 24B nonce | ciphertext]
 *
 * Settlement instructions are signed with a secp256k1 key ("attestation" — in
 * production this key is generated inside the TEE and bound to a hardware
 * attestation quote; the contract-side verification is identical).
 */
import nacl from "tweetnacl";
import { AbiCoder, Wallet, getBytes, hexlify, keccak256 } from "ethers";
import type { SettlementInstruction } from "./types.js";

export interface EnclaveKeys {
  /** X25519 keypair for order decryption. */
  boxSecretKey: Uint8Array;
  boxPublicKey: Uint8Array;
  /** secp256k1 signing key for settlement attestations. */
  signer: Wallet;
}

export function keysFromSeed(boxSecretHex: string, signerKeyHex: string): EnclaveKeys {
  const boxSecretKey = getBytes(boxSecretHex);
  const pair = nacl.box.keyPair.fromSecretKey(boxSecretKey);
  return { boxSecretKey: pair.secretKey, boxPublicKey: pair.publicKey, signer: new Wallet(signerKeyHex) };
}

export function generateKeys(): { boxSecretHex: string; signerKeyHex: string } {
  return {
    boxSecretHex: hexlify(nacl.box.keyPair().secretKey),
    signerKeyHex: Wallet.createRandom().privateKey,
  };
}

/** Open a sealed order payload. Returns the plaintext JSON string or null. */
export function openOrderPayload(keys: EnclaveKeys, payloadHex: string): string | null {
  const data = getBytes(payloadHex);
  if (data.length < 32 + 24 + 1) return null;
  const ephemeralPub = data.slice(0, 32);
  const nonce = data.slice(32, 56);
  const box = data.slice(56);
  const opened = nacl.box.open(box, nonce, ephemeralPub, keys.boxSecretKey);
  if (!opened) return null;
  return new TextDecoder().decode(opened);
}

const IX_TUPLE =
  "tuple(bytes32,bytes32,bytes32,bytes32,address,address,uint256,uint256,uint256,bytes21,bool,bool,uint64)";

/** keccak256(abi.encode(chainId, engine, ix)) — must match SettlementEngine.instructionDigest. */
export function instructionHash(chainId: bigint, engineAddress: string, ix: SettlementInstruction): string {
  const encoded = AbiCoder.defaultAbiCoder().encode(
    ["uint256", "address", IX_TUPLE],
    [
      chainId,
      engineAddress,
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
    ],
  );
  return keccak256(encoded);
}

/** Sign an instruction (EIP-191 personal-message over the hash bytes). */
export async function signInstruction(
  keys: EnclaveKeys,
  chainId: bigint,
  engineAddress: string,
  ix: SettlementInstruction,
): Promise<string> {
  return keys.signer.signMessage(getBytes(instructionHash(chainId, engineAddress, ix)));
}
