'use client';
import { useMemo, useState } from 'react';
import Link from 'next/link';
import { AppShell } from '@/components/insights/AppShell';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { cn } from '@/components/ui/utils';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { OpportunityActionTag } from '@xstockstrat/proto/analysis/v1/analysis_pb';
import { OPPORTUNITY_ACTION, EnumBadge } from '@/lib/opportunityShared';
import { useOpportunities } from '@/hooks/useOpportunities';

/** Expiry label from a protobuf-es Timestamp ({ seconds: bigint }). */
function expiryLabel(validUntil: { seconds: bigint } | undefined): string {
  if (!validUntil || !validUntil.seconds) return '—';
  return new Date(Number(validUntil.seconds) * 1000).toISOString().slice(0, 10);
}

function StatTile({ label, value }: { label: string; value: string | number }) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="text-xs text-muted-foreground">{label}</div>
        <div className="mt-1 text-2xl font-mono tabular-nums font-semibold">{value}</div>
      </CardContent>
    </Card>
  );
}

/**
 * Decide → Opportunities (feature 083, FR-5). The ranked opportunity queue over
 * analysis.ListOpportunities: 5-stat row, source-filter chips, min-conviction slider, ranked
 * rows with an action tag + conviction strength bar. Conviction is a defined value (never a
 * fabricated %); "N/M conditions" renders when the row carries per-condition readiness.
 */
export default function OpportunitiesPage() {
  const { data, isLoading, error } = useOpportunities(0);
  const opportunities = useMemo(() => data?.opportunities ?? [], [data]);

  const [minConviction, setMinConviction] = useState(0);
  const [activeSources, setActiveSources] = useState<string[]>([]);

  const sources = useMemo(
    () => Array.from(new Set(opportunities.map((o) => o.source).filter(Boolean))).sort(),
    [opportunities],
  );

  const rows = useMemo(
    () =>
      opportunities.filter(
        (o) =>
          o.conviction >= minConviction &&
          (activeSources.length === 0 || activeSources.includes(o.source)),
      ),
    [opportunities, minConviction, activeSources],
  );

  const countBy = (tag: OpportunityActionTag) => rows.filter((o) => o.action === tag).length;
  const avgConviction = rows.length
    ? (rows.reduce((s, o) => s + o.conviction, 0) / rows.length).toFixed(2)
    : '0.00';

  const toggleSource = (s: string) =>
    setActiveSources((prev) => (prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s]));

  return (
    <AppShell>
      <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6 space-y-6">
        <div>
          <h1 className="text-lg font-semibold">Opportunities</h1>
          <p className="text-sm text-muted-foreground">
            Explained buy / trim / exit signals, ranked by conviction. The broker owns the ledger —
            you act with one confirmation.
          </p>
        </div>

        {/* 5-stat row */}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
          <StatTile label="Opportunities" value={rows.length} />
          <StatTile label="Enter" value={countBy(OpportunityActionTag.ENTER)} />
          <StatTile label="Add" value={countBy(OpportunityActionTag.ADD)} />
          <StatTile label="Reduce" value={countBy(OpportunityActionTag.REDUCE)} />
          <StatTile label="Avg conviction" value={avgConviction} />
        </div>

        {/* Filters */}
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-wrap items-center gap-2">
            {sources.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => toggleSource(s)}
                className={cn(
                  'rounded-full border px-3 py-1 text-xs transition-colors',
                  activeSources.includes(s)
                    ? 'border-primary bg-primary/20 text-foreground'
                    : 'border-border text-muted-foreground hover:text-foreground',
                )}
              >
                {s}
              </button>
            ))}
          </div>
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            Min conviction
            <input
              type="range"
              min={0}
              max={100}
              value={Math.round(minConviction * 100)}
              onChange={(e) => setMinConviction(Number(e.target.value) / 100)}
              className="accent-primary"
              aria-label="Minimum conviction"
            />
            <span className="w-8 font-mono tabular-nums text-foreground">
              {minConviction.toFixed(2)}
            </span>
          </label>
        </div>

        {/* Queue */}
        <Card>
          <CardContent className="p-0">
            {isLoading ? (
              <div className="p-6 text-sm text-muted-foreground">Loading opportunities…</div>
            ) : error ? (
              <div className="p-6 text-sm text-sell">Failed to load opportunities.</div>
            ) : rows.length === 0 ? (
              <div className="p-6 text-sm text-muted-foreground">
                No opportunities match the filter.
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Symbol</TableHead>
                    <TableHead>Action</TableHead>
                    <TableHead>Conviction</TableHead>
                    <TableHead>Thesis</TableHead>
                    <TableHead>Source</TableHead>
                    <TableHead>Expires</TableHead>
                    <TableHead className="text-right">Review</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((o) => (
                    <TableRow key={`${o.symbol}-${o.source}`}>
                      <TableCell className="font-mono font-semibold">{o.symbol}</TableCell>
                      <TableCell>
                        <EnumBadge render={OPPORTUNITY_ACTION[o.action]} />
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <div className="h-1.5 w-20 overflow-hidden rounded-full bg-muted">
                            <div
                              className="h-full bg-primary"
                              style={{ width: `${Math.round(o.conviction * 100)}%` }}
                            />
                          </div>
                          <span className="font-mono tabular-nums text-xs text-muted-foreground">
                            {o.totalConditions > 0
                              ? `${o.passingConditions}/${o.totalConditions}`
                              : o.conviction.toFixed(2)}
                          </span>
                        </div>
                      </TableCell>
                      <TableCell className="max-w-[22rem] truncate text-muted-foreground">
                        {o.thesis || '—'}
                      </TableCell>
                      <TableCell className="text-muted-foreground">{o.source || '—'}</TableCell>
                      <TableCell className="font-mono tabular-nums text-xs text-muted-foreground">
                        {expiryLabel(o.validUntil)}
                      </TableCell>
                      <TableCell className="text-right">
                        <Button asChild variant="ghost" size="sm">
                          <Link href={`/insights/market/${o.symbol}`}>Review</Link>
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
