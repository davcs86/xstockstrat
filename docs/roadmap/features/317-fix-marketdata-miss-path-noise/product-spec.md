# Product Spec: fix-marketdata-miss-path-noise

**Type**: bug
**GitHub Issue**: none (Issues disabled) — reports: docs/reports/2026-11-04-cancel-warn-remaining-sites-defect.md, docs/reports/2026-11-04-marketdata-getbars-miss-path-refetch-every-call-defect.md
**Severity**: SEV-3
**Created**: 2026-11-10

---

## Problem Statement

### Remaining cancel-caused WARN sites not covered by feature 290 (SEV-3)

- **Observed:** the "work continues / logs WARN after the context is done" shape fixed by feature 290 for portfolio
  `processPositionSync` and marketdata `fetchAndCacheBars` remains at other sites — marketdata: `GetBars: live
  fetch failed` on client cancel, `GetLatestQuote: cache insert failed`, warm-poller cache insert (471 lines / 7
  days), bar-ingest insert / live-fetch WARNs (one per symbol under a done ctx), the residual re-read WARN; portfolio:
  `processAccountDeregistered` (two WARNs) and the `ackAlways` consumers draining at shutdown (balance sync,
  bracket update, order-fill).
- **Expected:** cancel-caused repeats are stopped or quieted while genuine failures keep their WARN, reusing feature
  290's settled pattern where it fits.
- Report: [docs/reports/2026-11-04-cancel-warn-remaining-sites-defect.md](../../../reports/2026-11-04-cancel-warn-remaining-sites-defect.md) (confidence: low)

### GetBars re-fetches live on every call for symbols with no stored bars (SEV-3)

- **Observed:** `GetBars` live-refetches on the first page whenever a symbol has no stored bars; the staleness
  rate limiter covers only stored-but-stale bars. A symbol that never returns bars (delisted/OTC/unknown) costs a
  live Alpaca call and a WARN `GetBars: no bars stored and live fetch returned none` on every call. Loki (staging,
  7 days): 952 lines in a two-day burst, ~238 each on BOSSY, CRTD, DNB, FORL.
- **Expected:** a symbol that returned no bars recently is not live-fetched on every call (negative cache / back-off
  or the feature-282 servability gate), and the WARN is reported once per state change.
- Report: [docs/reports/2026-11-04-marketdata-getbars-miss-path-refetch-every-call-defect.md](../../../reports/2026-11-04-marketdata-getbars-miss-path-refetch-every-call-defect.md) (confidence: low)

## Reproduction Steps

1. Cancel WARNs: roll a staging deploy under traffic; query Loki for the messages above around each `shutting down …
   service` line.
2. Miss path: call `GetBars` repeatedly for a symbol with no stored bars and no vendor data (e.g. DNB); each call
   performs a live fetch and logs the WARN.

## Root Cause Hypothesis

- Handlers and loops do not consult their context before logging per-item failures (same as 290); the warm-poller
  and ingest loops run on the process context, cancelled only at shutdown.
- No negative cache on the `GetBars` miss path.
- Current sites (main-dev 0fecb24d), moved from the reports' line numbers:
  - `services/xstockstrat-marketdata/internal/service/marketdata_service.go:338` (`refetch := len(bars) == 0`),
    `:353` (miss-path WARN), `:367` (`staleCheckDue`), `:411` (`GetBars: live fetch failed`), `:431`/`:438`
    (re-read WARN), `:630` (`GetLatestQuote: cache insert failed`), `:1409`/`:1421`/`:1429` (bar ingest WARNs).
    The warm-poller cache-insert lines (`:1239`, `:1263`) are now `DebugContext` — re-verify whether that site is
    already resolved.
  - `services/xstockstrat-portfolio/internal/service/portfolio_service.go:1540` (`processAccountDeregistered`),
    `:185` (`ackAlways`), `:1693` (bracket update), `:1741` (balance sync).

## Affected Services

- xstockstrat-marketdata
- xstockstrat-portfolio

## Fix Scope

- Proto changes anticipated: **no** — logging and in-process caching only.
- DB migrations anticipated: **no** — a negative cache need not be persisted; neither report names schema work.
- Config key changes anticipated: **no** — unless design chooses a new negative-cache TTL / back-off key (open
  question 3).

## Open Questions

1. Both reports are low-confidence and gate routing on a Loki re-check: features 290 and 282 have since launched —
   which sites still flood, and which are already silenced (e.g. warm poller now at Debug)?
2. How much of the miss-path noise feature 282's servability gate already removed (servable-but-empty symbols —
   halted/thin — remain per the report)?
3. Negative-cache shape: reuse the staleness interval vs. a new TTL key.

## Acceptance Criteria

See `acceptance.feature` — the regression scenario(s) that must fail on the buggy behavior and pass after the fix
(Constitution **C-15**). Plus: existing tests pass; affected service(s) smoke-tested on dev.

## Out of Scope

- Batching `InsertBars` (`pgx.Batch`/`CopyFrom`) to shrink the write transaction — rejected alternative recorded
  by feature 290.
- Changing the cold-fetch error surfacing guarded by `@AC-53 @feature-240` (feature 291 deliberately left that path).
- Refactoring unrelated to the bug; performance improvements unrelated to the fix.
