'use client';
import Link from 'next/link';
import { CaretRight, Warning } from '@phosphor-icons/react';
import { EnumBadge } from '@/lib/opportunityShared';
import { readinessState } from '@/lib/readinessRollup';
import { cn } from '../ui/utils';
import { Alert, AlertDescription } from '../ui/alert';
import { Badge } from '../ui/badge';
import { Progress } from '../ui/progress';
import type { Section, SignalItem } from './sections';

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

    case 'signal':
      return (
        <div className="rounded-md border bg-card">
          <SignalRow item={s} />
        </div>
      );

    // feature 155 (FR-4, AC-9) — one card per symbol, mirroring the desktop `SymbolGroupCard`; each
    // signal renders through the same `SignalRow` as the flat `signal` kind (no divergent tree).
    case 'signalGroup':
      return (
        <div
          data-testid={`mobile-group-${s.symbol}`}
          className="overflow-hidden rounded-md border bg-card"
        >
          <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-2">
            {s.href ? (
              <Link href={s.href} className="font-mono text-sm font-semibold hover:underline">
                {s.symbol}
              </Link>
            ) : (
              <span className="font-mono text-sm font-semibold">{s.symbol}</span>
            )}
            <span className="text-xs text-muted-foreground">
              {s.signals.length} {s.signals.length === 1 ? 'signal' : 'signals'}
            </span>
          </div>
          <div className="divide-y divide-border">
            {s.signals.map((sig, i) => (
              <SignalRow key={i} item={sig} showSymbol={false} />
            ))}
          </div>
        </div>
      );

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

/**
 * One signal row — the shared body for the flat `signal` section and each row inside a `signalGroup`
 * card (feature 155, FR-4). Carries the desktop-parity tags (strategy id, source/provenance chips,
 * expiry). `showSymbol` is false inside a group (the group card header already names the symbol). The
 * readiness meter's color derives from the shared `readinessState` bucketer — no 4th copy of the
 * 4-way branch.
 */
function SignalRow({ item: s, showSymbol = true }: { item: SignalItem; showSymbol?: boolean }) {
  const hasReadiness = !!s.readiness && s.readiness.total > 0;
  const readyPct = hasReadiness ? Math.round((s.readiness!.passing / s.readiness!.total) * 100) : 0;
  const rs = s.readiness
    ? readinessState({
        passingConditions: s.readiness.passing,
        totalConditions: s.readiness.total,
      })
    : 'nodata';
  const readyVariant =
    rs === 'firing' ? 'buy' : rs === 'watching' ? 'paper' : rs === 'quiet' ? 'sell' : 'muted';
  const body = (
    <div className={cn('flex flex-col gap-2 px-3 py-2', TAP)}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          {showSymbol && <span className="font-mono font-semibold">{s.symbol}</span>}
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
          {/* feature 155 (FR-4, AC-10) — the strategy id + provenance/source chips mobile omitted. */}
          {s.strategyId && (
            <span className="font-mono text-[11px] text-muted-foreground">{s.strategyId}</span>
          )}
          {s.chips?.map((c) => (
            <Badge key={c} variant="outline" className="text-[10px] text-muted-foreground">
              {c}
            </Badge>
          ))}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {s.expiry && s.expiry !== '—' && (
            <span className="font-mono text-[11px] text-muted-foreground">exp {s.expiry}</span>
          )}
          {s.href && <CaretRight className="h-4 w-4 shrink-0 text-muted-foreground" />}
        </div>
      </div>
      {s.caption && <p className="truncate text-xs text-muted-foreground">{s.caption}</p>}
      {/* Conviction + strategy-readiness meters (mobile parity with the desktop card). The readiness
          slot renders whenever the row carries readiness data — with a "—" when there are no traced
          conditions — so both meters stay aligned across rows. */}
      {(typeof s.conviction === 'number' || s.readiness) && (
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
          {s.readiness && (
            <div className="flex min-w-0 flex-1 items-center gap-1.5">
              <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
                ready
              </span>
              {hasReadiness ? (
                <>
                  <Progress value={readyPct} className="h-1.5 flex-1" variant={readyVariant} />
                  <span className="font-mono text-[11px] tabular-nums text-muted-foreground">
                    {s.readiness.passing}/{s.readiness.total}
                  </span>
                </>
              ) : (
                <span className="flex-1 text-[11px] text-muted-foreground/70">—</span>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
  return s.href ? (
    <Link href={s.href} className="block hover:bg-accent/40">
      {body}
    </Link>
  ) : (
    body
  );
}
