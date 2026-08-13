import { formatUnits } from "ethers";

/** "1234567.891" → "1,234,567.89" with sensible precision. */
export function fmtAmount(raw: string | bigint, decimals: number, maxFrac = 2): string {
  const s = formatUnits(raw, decimals);
  const n = Number(s);
  if (!Number.isFinite(n)) return s;
  if (n !== 0 && Math.abs(n) < 0.01) return n.toPrecision(2);
  return n.toLocaleString("en-US", { maximumFractionDigits: maxFrac });
}

/** 18-decimal price → "3.0042" */
export function fmtPrice(raw: string | bigint, frac = 4): string {
  const n = Number(formatUnits(raw, 18));
  return n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: frac });
}

export function shortAddr(addr: string): string {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

export function shortHash(hash: string): string {
  return `${hash.slice(0, 10)}…`;
}

export function timeAgo(unixSeconds: number): string {
  const s = Math.max(0, Math.floor(Date.now() / 1000) - unixSeconds);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

export function explorerTx(chainId: number | undefined, hash: string): string | null {
  if (chainId === 114) return `https://coston2-explorer.flare.network/tx/${hash}`;
  if (chainId === 14) return `https://flare-explorer.flare.network/tx/${hash}`;
  if (chainId === 19) return `https://songbird-explorer.flare.network/tx/${hash}`;
  return null;
}

export function explorerAddr(chainId: number | undefined, addr: string): string | null {
  if (chainId === 114) return `https://coston2-explorer.flare.network/address/${addr}`;
  if (chainId === 14) return `https://flare-explorer.flare.network/address/${addr}`;
  if (chainId === 19) return `https://songbird-explorer.flare.network/address/${addr}`;
  return null;
}

export function chainName(chainId: number | undefined): string {
  switch (chainId) {
    case 114: return "Coston2";
    case 14: return "Flare";
    case 19: return "Songbird";
    case 31337: return "Local";
    default: return chainId ? `Chain ${chainId}` : "-";
  }
}
