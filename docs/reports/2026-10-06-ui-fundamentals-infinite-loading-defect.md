# Defect: Trader position Fundamentals card stays on "Loading fundamentals…" indefinitely

**Recorded**: 2026-10-06
**Severity**: SEV-3
**Impact type**: indefinite-loading-state
**Environment**: dev (staging)
**Affected service(s)**: xstockstrat-ui
**Config-only fix possible**: no

## Observed

On `/trader/positions/AXP` (mobile, staging) the Fundamentals card shows "Loading fundamentals…"
and never resolves to either the metrics grid or the "No fundamentals data for AXP — <reason>" error
state. At the same time the backend answered `GetFundamentals(AXP)` promptly over gRPC (agent
`query_fundamentals`), and staging was degraded (agent `list_opportunities` timed out at 60s).

## Expected

A stalled or slow `GetFundamentals` call terminates within a bounded deadline and the card falls
through to its existing error branch (`page.tsx:1054-1058`) instead of loading forever.

## Reproduction

1. Make `xstockstrat-marketdata` `GetFundamentals` (or the BFF hop) stall — e.g. block the
   `GetLatestQuotes` live-price join or saturate the UI→marketdata channel.
2. Open `/trader/positions/<held symbol>`.
3. The Fundamentals card stays on "Loading fundamentals…"; no error is ever surfaced.

## Evidence

`services/xstockstrat-ui/src/lib/traderBff.ts:76`
> getFundamentals: forward((req, opts) => marketDataClient.getFundamentals(req, opts)),

`services/xstockstrat-ui/src/lib/bffShared.ts:70`
> if (options.timeoutMs !== undefined) callOpts.timeoutMs = options.timeoutMs;

`services/xstockstrat-ui/src/lib/insightsBff.ts:55` (existing precedent for a bounded BFF call)
> timeoutMs: 30_000,

`services/xstockstrat-ui/src/hooks/useFundamentals.ts:11-16`
> useQuery({ queryKey: ['fundamentals', symbol], queryFn: () => marketDataClient.getFundamentals({ symbol }), enabled: Boolean(symbol), retry: false })

`services/xstockstrat-ui/src/app/trader/positions/[symbol]/page.tsx:1052-1053`
> {isLoading ? ( <p ...>Loading fundamentals…</p>

## Root cause hypothesis

No deadline at any hop: the trader BFF forwards `getFundamentals` without `timeoutMs` and the browser
transport sets none, so a hung upstream never rejects and React Query's `isLoading` never clears.

## Confidence

high
