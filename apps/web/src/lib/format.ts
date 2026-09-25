export const formatInt = (n: number) => Math.round(n).toLocaleString("en-US");

export function formatUsd(n: number): string {
  if (n === 0) return "$0.00";
  if (n < 0.01) return `$${n.toFixed(n < 0.0001 ? 6 : 4)}`;
  return `$${n.toFixed(2)}`;
}

export const formatPercent = (p: number) => `${Math.round(p * 100)}%`;
