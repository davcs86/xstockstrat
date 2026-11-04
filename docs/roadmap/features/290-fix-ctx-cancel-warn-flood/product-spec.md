# Product Spec: fix-ctx-cancel-warn-flood

**Type**: bug
**Defect report**: `docs/reports/2026-11-04-portfolio-marketdata-warn-flood-after-ctx-cancel-defect.md`
**Severity**: SEV-3
**Created**: 2026-11-04
**Revised**: 2026-11-04 (design gate — root cause, FRs, scope)

---

## Problem Statement

Two independent floods of cancel-caused WARNs, confirmed in Loki (staging) during design:

- **Portfolio** — at shutdown the position-sync consumer's context is done, yet `processPositionSync` keeps
  upserting and logging one WARN per position plus one for the delete (`upsert position from sync failed` 2,770 lines,
  `delete positions not in sync failed` 545 lines in 7 days), and returns nil (acked) so the consumer keeps draining
  already-buffered events: ~39 events (5 upserts + 1 delete each) in ~10 ms after `shutting down portfolio service`.
- **Marketdata** — when a client cancels a `GetBars` request after the live Alpaca fetch, the cache insert runs on the
  canceled request context and fails (`GetBars: cache insert failed … begin tx: context canceled`, 557 lines in 7 days,
  bursts of up to 27 distinct symbols in a minute). The fetched bars are discarded and fetched again on the next request.

Out of scope (named follow-up): `docs/reports/2026-11-04-cancel-warn-remaining-sites-defect.md` (warm poller, ingest,
`GetLatestQuote`, `processAccountDeregistered`, other `ackAlways` consumers).

## Functional Requirements

- **FR-1 (portfolio):** Once the position-sync consumer's context is done, `processPositionSync` makes no further
  repository call, returns the context's cancellation (never parked, cursor withheld) and logs no per-item WARN. While
  the context is live, every write failure is WARNed and handled exactly as before (including a driver-reported
  `context.Canceled`), and the feature-206 empty-snapshot skip path is unchanged.
- **FR-2 (marketdata):** The `GetBars` live-fallback cache write persists the fetched bars even if the client leaves:
  after the client leaves, the write runs on a context detached from the request, bounded by a fixed grace, with at
  most one such departed-client write at a time (others are skipped silently, as today). While the client is live the
  write behaves exactly as today. If the request context is done after the write, the re-read is skipped and the live
  page is returned with no WARN. With a live context a failed write or re-read still WARNs and the caller still gets
  the live bars with no error.

## Reproduction Steps

1. Portfolio: deploy/restart the service on staging while `account.positions.synced` events are buffered; query Loki
   for the WARN burst starting within ~1.5 s of `shutting down portfolio service`.
2. Marketdata: cancel a cold `GetBars` request after the live fetch (or burst-cancel several); observe the WARN and a
   repeated Alpaca fetch on the next request.

## Root Cause

Portfolio: `processPositionSync` (`portfolio_service.go:1381`) never consults `ctx.Err()`; broker syncs return nil
even when every write failed, so the stream keeps handing it buffered events after the process ctx is canceled.
Marketdata: `fetchAndCacheBars` (`marketdata_service.go:370`) inserts on the request ctx, so a client cancel fails
the write and the following re-reads. Details and evidence: `design.md`, `context.md`.

## Affected Services

xstockstrat-portfolio, xstockstrat-marketdata

## Consumer Surface(s)

None — internal/platform-only (log hygiene and cache persistence; no UI, agent or MCP behaviour changes; C-14).

## Fix Scope

- [x] No proto changes anticipated
- [x] No database migrations anticipated
- [x] No config key changes anticipated — the one new bound (the post-departure write grace) is a fixed
  resource-protection invariant, sized from a measured `InsertBars` p99 and operator-approved (it decides neither what
  the caller receives nor how old data can be); if the operator later wants it tunable, the fallback is one key
  `marketdata.bars.cache_write_timeout_ms` with config-team approval.

## Acceptance Criteria

See `acceptance.feature` — the regression scenario(s) that must fail on the buggy behavior and pass after the fix
(Constitution **C-15**); characterization guards are labelled. Plus: existing tests pass; affected services
smoke-tested on dev.

## Out of Scope

- Refactoring unrelated to the bug; wrapping the portfolio sync in a transaction
- Warm poller, ingest, `GetLatestQuote`, `processAccountDeregistered`, other `ackAlways` consumers (follow-up report)
- Batching `InsertBars`
