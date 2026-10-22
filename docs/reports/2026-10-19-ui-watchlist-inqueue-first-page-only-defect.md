# Defect: Watchlist "in queue" flag only sees the first loaded opportunity page

**Recorded**: 2026-10-19
**Severity**: SEV-3
**Impact type**: misleading-status
**Environment**: dev (main-dev) @ 1302e6d
**Affected service(s)**: xstockstrat-ui
**Config-only fix possible**: no
**Source**: `services/xstockstrat-ui/docs/context-constitution-findings.md` § Latent bugs, "Watchlist 'in queue' flag reads only loaded opportunity pages"

## Observed
`WatchlistDetail` builds its `inQueue` symbol set from `useOpportunities()` called with no symbol
filter and never pages (`fetchNextPage` unused). Only the loaded page(s) — page 1 holds ≤50 rows —
are scanned, so a watchlisted symbol that IS in the Decide queue but ranked below the loaded page
renders as not-in-queue in `WatchlistReadiness`. Same class as the detail-page bug feature 215
fixed by adding the server-side `symbol` filter.

## Expected
In-queue status reflects actual queue membership regardless of rank (e.g. filter by the
watchlist's symbols server-side, or page through).

## Reproduction
1. Seed a user's opportunity queue with >50 rows.
2. Add to a watchlist a symbol whose opportunity ranks below row 50.
3. Open the watchlist detail — the symbol shows as not in queue though `ListOpportunities` with `symbol=<it>` returns a row.

## Evidence
`services/xstockstrat-ui/src/components/insights/WatchlistDetail.tsx:72`
> `  const { data: oppData } = useOpportunities();`

`services/xstockstrat-ui/src/components/insights/WatchlistDetail.tsx:90-91`
> `  const inQueue = new Set(`
> `    (oppData?.pages.flatMap((p) => p.opportunities) ?? []).map((o) => o.symbol.toUpperCase()),`

`services/xstockstrat-ui/src/components/insights/WatchlistReadiness.tsx:295`
> `            const queued = inQueue?.has(binding.symbol.toUpperCase()) ?? false;`

`services/xstockstrat-ui/src/hooks/useOpportunities.ts:30` (available filter, unused here)
> `  symbol = '',`

## Root cause hypothesis
The feature-215 per-symbol filter fix was applied to the Signal-detail page only; the watchlist
consumer still derives membership from the shared rank-paged cache.

## Confidence
high
