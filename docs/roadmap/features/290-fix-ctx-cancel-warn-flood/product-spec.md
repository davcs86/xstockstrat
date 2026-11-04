# Product Spec: fix-ctx-cancel-warn-flood

**Type**: bug
**Defect report**: `docs/reports/2026-11-04-portfolio-marketdata-warn-flood-after-ctx-cancel-defect.md`
**Severity**: SEV-3
**Created**: 2026-11-04
**Revised**: 2026-11-04 (design gate; product-spec review fixes)

---

## Problem Statement

The on-call operator reading Loki, and the `GetBars` callers (analysis backtests, chart reads), are hit by two
independent floods of cancel-caused WARNs, confirmed in Loki (staging) during design:

- **Portfolio** — at shutdown the position-sync consumer's context is done, yet `processPositionSync` keeps
  upserting and logging one WARN per position plus one for the delete (`upsert position from sync failed` 2,770 lines,
  `delete positions not in sync failed` 545 lines in 7 days), and returns nil (acked) so the consumer keeps draining
  already-buffered events: ~39 events (5 upserts + 1 delete each) in ~10 ms after `shutting down portfolio service`.
- **Marketdata** — when a client cancels a `GetBars` request after the live Alpaca fetch, the cache insert (the
  `InsertBars` call at `marketdata_service.go:370` inside `fetchAndCacheBars`, `:356`) runs on the canceled request
  context and fails (`GetBars: cache insert failed … begin tx: context canceled`, 557 lines in 7 days, bursts of up to
  27 distinct symbols in a minute). The caller still gets the live page, but the fetched bars are **not persisted** and
  are fetched again on the next request.

Out of scope (named follow-up): `docs/reports/2026-11-04-cancel-warn-remaining-sites-defect.md` (warm poller, ingest,
`GetLatestQuote`, `processAccountDeregistered`, other `ackAlways` consumers).

## Functional Requirements

- **FR-1 (portfolio):** Once the position-sync consumer's context is done, `processPositionSync` makes no further
  repository call, returns the context's cancellation (never parked, cursor withheld — a canceled **broker** sync with
  positions now also returns the cancellation instead of nil, to stop draining) and logs no per-item WARN. While the
  context is live, every write failure is WARNed and handled exactly as before (including a driver-reported
  `context.Canceled`), and the feature-206 empty-snapshot skip path (a broker sync with no positions returns nil) is
  unchanged. BrokerType-agnostic: it applies to broker and offline sync events alike; no order, fill, dispatch or
  credential logic is touched.
- **FR-2 (marketdata):** The `GetBars` live-fallback cache write persists the fetched bars even if the client leaves:
  - a write that **starts after the client has left** ("departed-client write") runs on a context detached from the
    request, bounded by a fixed grace of **5 s**, and at most one departed-client write runs at a time (others are
    skipped silently, as today); a client that leaves **mid-write** does not cancel the in-flight write, which is
    bounded by the same grace;
  - while the client is live the write behaves exactly as today (no new deadline);
  - if the request context is done after the write, the re-read is skipped and the live page is returned with no WARN;
  - a failed write still WARNs and the caller still gets the live bars with a nil error, whatever the client's state;
  - accepted, not tested (no read seam, C-18): a client that leaves during the single indexed re-read can still produce
    one re-read WARN.

## Reproduction Steps

1. Portfolio: deploy/restart the service on staging while `account.positions.synced` events are buffered; query Loki
   for the WARN burst starting within ~1.5 s of `shutting down portfolio service`.
2. Marketdata: cancel a cold `GetBars` request after the live fetch (or burst-cancel several); observe the WARN and a
   repeated Alpaca fetch on the next request.

## Root Cause

Portfolio: `processPositionSync` (`portfolio_service.go:1381`) never consults `ctx.Err()`; broker syncs return nil
even when every write failed, so the stream keeps handing it buffered events after the process ctx is canceled.
Marketdata: `fetchAndCacheBars` inserts on the request ctx, so a client cancel fails the write and the following
re-reads. Details and evidence: `design.md`, `context.md`.

## Affected Services

xstockstrat-portfolio, xstockstrat-marketdata

## Consumer Surface(s)

None — internal/platform-only (log hygiene and cache persistence; no UI, agent or MCP behaviour changes; C-14).

## Fix Scope

- Proto: none. Database: none.
- Config keys: none. The one new bound (the post-departure write grace, 5 s) is a fixed resource-protection invariant
  that decides neither what the caller receives nor how old data can be (precedent: `barsPartialMargin`, `etfFlagTTL`);
  operator-approved at the design gate. Its **provenance**: sized from observed whole-request `GetBars` latency in Tempo
  (24 h: p99 195 ms, worst 2.70 s; 5 s ≈ 1.85× the worst) because `InsertBars` has no trace span — **a direct staging
  `InsertBars` timing is a mandatory pre-PR gate**. If the operator later wants it tunable, the fallback is one key
  `marketdata.bars.cache_write_timeout_ms` with config-team approval.

## Acceptance Criteria

See `acceptance.feature` — regression scenarios fail on the buggy behaviour and pass after the fix (Constitution
**C-15**); characterization guards (pass before and after) are labelled. Plus: existing tests pass; affected services
smoke-tested on dev.

## Out of Scope

- Refactoring unrelated to the bug; wrapping the portfolio sync in a transaction
- Warm poller, ingest, `GetLatestQuote`, `processAccountDeregistered`, other `ackAlways` consumers (follow-up report)
- Batching `InsertBars`
