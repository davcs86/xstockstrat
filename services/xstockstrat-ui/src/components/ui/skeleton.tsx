import { cn } from './utils';

/**
 * Loading skeleton primitive (feature 083, FR-17). A muted, pulsing placeholder block sized by
 * the caller (width/height via className). Use it per card/table row while data is in flight so
 * the shell keeps its shape instead of collapsing to a bare "Loading…" line.
 */
export function Skeleton({ className }: { className?: string }) {
  return (
    <div
      data-testid="skeleton"
      aria-hidden
      className={cn('animate-pulse rounded-md bg-muted', className)}
    />
  );
}
