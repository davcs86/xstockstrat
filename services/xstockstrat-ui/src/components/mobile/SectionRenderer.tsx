'use client';
import Link from 'next/link';
import { CaretRight, Warning } from '@phosphor-icons/react';
import { EnumBadge } from '@/lib/opportunityShared';
import { cn } from '../ui/utils';
import { Alert, AlertDescription } from '../ui/alert';
import { Progress } from '../ui/progress';
import type { Section } from './sections';

// Every interactive row is at least 44px tall (FR-16 tap-target floor).
const TAP = 'min-h-[44px]';

/**
 * The one shared mobile section renderer (feature 083, FR-16). Draws a screen's `Section[]` as
 * a stacked, thumb-friendly phone view — the same data the desktop screen shows, reflowed. All
 * tap targets are ≥44px. Used behind `sm:hidden` alongside the desktop layout so the two stay
 * in lock-step (no divergent mobile tree).
 */
export function SectionRenderer({ sections }: { sections: Section[] }) {
  return (
    <div data-testid="mobile-sections" className="space-y-2">
      {sections.map((s, i) => (
        <SectionItem key={i} section={s} />
      ))}
    </div>
  );
}

function SectionItem({ section: s }: { section: Section }) {
  switch (s.kind) {
    case 'head':
      return (
        <div className="pb-1 pt-2">
          <h2 className="text-base font-semibold">{s.title}</h2>
          {s.subtitle && <p className="text-sm text-muted-foreground">{s.subtitle}</p>}
        </div>
      );

    case 'stat':
      return (
        <div className="flex items-center justify-between rounded-md border bg-card px-3 py-2">
          <span className="text-sm text-muted-foreground">{s.label}</span>
          <span
            className={cn(
              'font-mono tabular-nums font-semibold',
              s.tone === 'up' && 'text-buy',
              s.tone === 'down' && 'text-destructive',
            )}
          >
            {s.value}
          </span>
        </div>
      );

    case 'signal': {
      const hasReadiness = !!s.readiness && s.readiness.total > 0;
      const readyPct = hasReadiness
        ? Math.round((s.readiness!.passing / s.readiness!.total) * 100)
        : 0;
      const readyVariant = !hasReadiness
        ? 'muted'
        : s.readiness!.passing >= s.readiness!.total
          ? 'buy'
          : s.readiness!.passing > 0
            ? 'paper'
            : 'sell';
      const body = (
        <div className={cn('flex flex-col gap-2 px-3 py-2', TAP)}>
          <div className="flex items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-2">
              <span className="font-mono font-semibold">{s.symbol}</span>
              {s.muted ? (
                <span
                  data-testid={`mobile-muted-${s.symbol}`}
                  className="rounded border px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground"
                >
                  Muted
                </span>
              ) : (
                s.badge && <EnumBadge render={s.badge} />
              )}
            </div>
            {s.href && <CaretRight className="h-4 w-4 shrink-0 text-muted-foreground" />}
          </div>
          {s.caption && <p className="truncate text-xs text-muted-foreground">{s.caption}</p>}
          {/* Conviction + strategy-readiness meters (feature: mobile parity with the desktop card). */}
          {(typeof s.conviction === 'number' || hasReadiness) && (
            <div className="flex items-center gap-4">
              {typeof s.conviction === 'number' && (
                <div className="flex min-w-0 flex-1 items-center gap-1.5">
                  <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
                    conv
                  </span>
                  <Progress
                    value={Math.round(s.conviction * 100)}
                    className="h-1.5 flex-1"
                    variant="default"
                  />
                  <span className="font-mono text-[11px] tabular-nums text-foreground">
                    {Math.round(s.conviction * 100)}
                  </span>
                </div>
              )}
              {hasReadiness && (
                <div className="flex min-w-0 flex-1 items-center gap-1.5">
                  <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
                    ready
                  </span>
                  <Progress value={readyPct} className="h-1.5 flex-1" variant={readyVariant} />
                  <span className="font-mono text-[11px] tabular-nums text-muted-foreground">
                    {s.readiness!.passing}/{s.readiness!.total}
                  </span>
                </div>
              )}
            </div>
          )}
        </div>
      );
      return (
        <div className="rounded-md border bg-card">
          {s.href ? (
            <Link href={s.href} className="block hover:bg-accent/40">
              {body}
            </Link>
          ) : (
            body
          )}
        </div>
      );
    }

    case 'chart':
      return (
        <div className="rounded-md border bg-card p-3">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {s.label}
          </p>
          {s.render}
        </div>
      );

    case 'row':
      return (
        <div className="flex items-center justify-between rounded-md border bg-card px-3 py-2 text-sm">
          <span className="text-muted-foreground">{s.label}</span>
          <span className="text-right">{s.value}</span>
        </div>
      );

    case 'form':
      return <div className="rounded-md border bg-card p-3">{s.render}</div>;

    case 'note':
      return (
        <Alert variant={s.tone === 'warn' ? 'warning' : 'default'} className="text-sm">
          {s.tone === 'warn' && <Warning weight="fill" className="h-4 w-4" />}
          <AlertDescription>{s.text}</AlertDescription>
        </Alert>
      );

    case 'action':
      return s.href ? (
        <Link
          href={s.href}
          className={cn(
            'flex items-center justify-center rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground',
            TAP,
          )}
        >
          {s.label}
        </Link>
      ) : (
        <button
          type="button"
          onClick={s.onClick}
          className={cn(
            'flex w-full items-center justify-center rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground',
            TAP,
          )}
        >
          {s.label}
        </button>
      );
  }
}
