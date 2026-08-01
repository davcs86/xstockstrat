import { cn } from '../ui/utils';

// Nocturne "kicker stat" tile (feature 083): a mono uppercase kicker label, a large tabular
// value tinted by semantic tone, and an optional sub line. Single source of truth for the
// Opportunities / Exposure (and other) stat rows (DRY guard rail).
export function StatTile({
  label,
  value,
  sub,
  tone,
  size = 'lg',
}: {
  label: string;
  value: string | number;
  sub?: string;
  tone?: 'accent' | 'gain' | 'loss' | 'paper';
  size?: 'lg' | 'md';
}) {
  return (
    <div className="border-r border-border px-4 py-3 last:border-r-0">
      <div className="font-mono text-[9px] font-semibold uppercase tracking-[0.13em] text-muted-foreground">
        {label}
      </div>
      <div
        className={cn(
          'mt-1 font-mono font-semibold tabular-nums',
          size === 'lg' ? 'text-2xl' : 'text-xl',
          tone === 'accent' && 'text-primary',
          tone === 'gain' && 'text-buy',
          tone === 'loss' && 'text-destructive',
          tone === 'paper' && 'text-yellow-400',
        )}
      >
        {value}
      </div>
      {sub && <div className="mt-0.5 text-xs text-muted-foreground">{sub}</div>}
    </div>
  );
}
