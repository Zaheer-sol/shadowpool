export interface PairInfo {
  pair: string;
  pairHash: string;
  baseToken: string;
  quoteToken: string;
  baseDecimals: number;
  quoteDecimals: number;
}

export interface EnclaveInfo {
  status: string;
  mode: string;
  boxPublicKey: string;
  signerAddress: string;
  openOrders: number;
  uptimeSeconds: number;
  chainId: number;
  contracts: {
    vault: string;
    orderBook: string;
    settlementEngine: string;
    priceOracle: string;
  };
  tokens: { FXRP: string; USDC: string };
  pairs: PairInfo[];
}

export interface TradeRecord {
  matchId: string;
  pair: string;
  executionPrice: string;
  baseAmount: string;
  quoteAmount: string;
  txHash: string;
  timestamp: number;
}

export interface PricePoint {
  t: number;
  price: string;
}

export interface PricesResponse {
  [pair: string]: { latest: string | null; history: PricePoint[] };
}

export interface StatsResponse {
  tradeCount: number;
  openOrders: number;
  volume: Record<"24h" | "7d" | "30d", Record<string, string>>;
  settlementSuccessRate: number;
  avgQuoteSize: string;
  series: { day: string; count: number; quoteVolume: string }[];
}

export type Direction = "buy" | "sell";

/** Plaintext order kept only in the trader's browser (localStorage). */
export interface LocalOrder {
  orderId: string;
  direction: Direction;
  pair: string;
  amount: string; // base units
  limitPrice: string | null; // 18d or null for market
  expiry: number;
  submittedAt: number;
  txHash: string;
}
