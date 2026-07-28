/**
 * Types shared across the enclave core. Everything in src/enclave is TEE-ready:
 * pure logic, no filesystem, no network — all I/O is injected by the host.
 */

export type Direction = "buy" | "sell";

/** Decrypted order as the trader authored it. */
export interface PlainOrder {
  direction: Direction;
  pair: string; // "FXRP/USDC"
  /** Base amount in base-token smallest units, as a decimal string. */
  amount: string;
  /** Limit price, 18 decimals (quote per base), or null for market. */
  limitPrice: string | null;
  /** Unix seconds after which the order is void. */
  expiry: number;
  /** Must match the on-chain submitter — the enclave rejects mismatches. */
  trader: string;
}

/** An order resting in the enclave's book. */
export interface BookOrder {
  orderId: string;
  trader: string;
  direction: Direction;
  pair: string;
  /** Base amount remaining to fill. */
  remainingBase: bigint;
  /** Limit price (18d quote per base); null = market. */
  limitPrice: bigint | null;
  expiry: number;
  /** Collateral still locked on-chain behind this order. */
  depositRemaining: bigint;
  /** Collateral token (quote for buys, base for sells). */
  depositToken: string;
  submittedAt: number;
}

export interface PairConfig {
  pair: string; // "FXRP/USDC"
  pairHash: string; // keccak256(pair)
  baseToken: string;
  quoteToken: string;
  baseDecimals: number;
  quoteDecimals: number;
  /** FTSO feed id (bytes21 hex) for the base asset's USD price. */
  baseFeedId: string;
}

/** Mirrors SettlementEngine.SettlementInstruction. */
export interface SettlementInstruction {
  matchId: string;
  buyOrderId: string;
  sellOrderId: string;
  pair: string; // bytes32 pair hash
  baseToken: string;
  quoteToken: string;
  baseAmount: bigint;
  quoteAmount: bigint;
  executionPrice: bigint;
  baseFeedId: string;
  buyFullyFilled: boolean;
  sellFullyFilled: boolean;
  timestamp: number;
}

export interface MatchResult {
  instruction: SettlementInstruction;
  /** EIP-191 signature by the enclave signing key ("attestation"). */
  attestation: string;
}
