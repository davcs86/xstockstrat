// Shared money / percentage formatters for the trader Book screens (Exposure, Portfolio, …).
// Single source of truth (DRY guard rail) — these were previously inlined per page.

/** `$1,234.56`, or `—` for null/NaN. */
export function fmtUsd(n: number | undefined | null): string {
  if (n === undefined || n === null || Number.isNaN(Number(n))) return '—';
  return `$${Number(n).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

/** Signed USD (`+$100.00` / `-$50.00`), or `—`. */
export function fmtSignedUsd(n: number | undefined | null): string {
  if (n === undefined || n === null || Number.isNaN(Number(n))) return '—';
  return `${Number(n) >= 0 ? '+' : ''}${fmtUsd(n)}`;
}

/** Signed percentage from a 0–1 ratio (`+2.57%`), or `—`. */
export function fmtPct(n: number | undefined | null): string {
  if (n === undefined || n === null || Number.isNaN(Number(n))) return '—';
  const pct = Number(n) * 100;
  return `${pct >= 0 ? '+' : ''}${pct.toFixed(2)}%`;
}

/** Tailwind class colouring a P&L figure green/red by sign (buy/destructive palette). */
export function pnlClass(n: number | undefined | null): string {
  return Number(n ?? 0) >= 0 ? 'text-buy' : 'text-destructive';
}
