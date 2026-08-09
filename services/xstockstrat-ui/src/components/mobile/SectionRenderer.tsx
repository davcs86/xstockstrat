'use client';
import Link from 'next/link';
import { CaretRight, Warning } from '@phosphor-icons/react';
import { EnumBadge } from '@/lib/opportunityShared';
import { cn } from '../ui/utils';
import { Alert, AlertDescription } from '../ui/alert';
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
      const body = (
        <div className={cn('flex items-center justify-between gap-3 px-3 py-2', TAP)}>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="font-mono font-semibold">{s.symbol}</span>
              {s.badge && <EnumBadge render={s.badge} />}
            </div>
            {s.caption && <p className="truncate text-xs text-muted-foreground">{s.caption}</p>}
          </div>
          <div className="flex items-center gap-2">
            {typeof s.conviction === 'number' && (
              <div className="h-1.5 w-16 overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full bg-primary"
                  style={{ width: `${Math.round(s.conviction * 100)}%` }}
                />
              </div>
            )}
            {s.href && <CaretRight className="h-4 w-4 shrink-0 text-muted-foreground" />}
          </div>
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
