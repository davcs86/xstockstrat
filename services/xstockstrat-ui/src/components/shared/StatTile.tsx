import { cn } from '../ui/utils';
import { Eyebrow } from './Eyebrow';

// Single source of truth for the platform's kicker stat tiles (Opportunities / Exposure and others).
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
      <Eyebrow>{label}</Eyebrow>
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
