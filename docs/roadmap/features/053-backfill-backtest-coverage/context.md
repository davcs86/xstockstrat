# Context: backfill-backtest-coverage  (archived 2026-08-06)

**Feature**: ./feature.md
**Status**: launched — archived by /sdd-archiver; verbose specs pruned (recoverable via git history).

## Archive Synthesis — 2026-08-06 — /sdd-archiver

**What**: Closed the backfill↔backtest blind spot by adding a `GetDataCoverage` read-query RPC on
marketdata, replacing analysis's silent flat-equity no-op with a structured
`BACKTEST_STATUS_INSUFFICIENT_DATA` + `coverage_gaps` result, and introducing a shared
`common.v1.Timeframe` enum (additive, deprecated-string-alongside) meant to reconcile the
`"1d"`/`"1Day"` vocabulary mismatch. The UI got a "backfill this range" action wired through the
existing `TriggerBackfill` RPC. In hindsight the timeframe fix was narrower than its own FR-4
promised: it fixed the **read** path (`analysis`'s `GetBars` call sites) but not the **write** path
(`ingest.TriggerBackfill`'s persistence of the raw string) — see Permanent deviations below.

**Why (irrecoverable rationale)**: `RunBacktest` was deliberately made to return a soft structured
result (`status` + `coverage_gaps`) rather than a gRPC error specifically so partial multi-symbol
backtests (some symbols covered, others not) still return usable per-symbol results instead of
failing the whole call. UI scope was reversed mid-spec-review from explicitly "out of scope" to
in-scope (FR-6) by direct user directive tied to an external tracking item ("053-Q4").

**Rejected alternatives**:
- Hard gRPC error on insufficient data — lost because it would fail an entire multi-symbol backtest
  even when only some symbols lacked coverage.
- Auto-triggering a backfill from inside `RunBacktest` — rejected because it would hide cost/latency
  from the caller; the RPC only reports the gap, never fetches silently.
- A `v2` proto for the insufficient-data shape — rejected in favor of additive fields on the
  existing `BacktestResult`, keeping the change non-breaking.

**Scars & gotchas**:
- Marking existing proto `timeframe` string fields `[deprecated = true]` made `golangci-lint`'s
  staticcheck (SA1019) fail on marketdata Go code that legitimately still reads those fields during
  the one-release deprecation window. Fix was targeted `//nolint:staticcheck` annotations with a
  deprecation-window reason — not ripping out the still-needed readers early.
- Playwright e2e for the gap-message/backfill-action flow could not run locally: Next.js dev-server
  cold-compile exceeded the harness's 10s hard timeout on `page.goto`. Fell back to `tsc --noEmit` +
  `pnpm run lint` as a CI-equivalent gate; the spec + mock-backend changes were written and
  committed regardless.
- Sequential stack on 052 required a re-spec gate before the step loop: `ingest.BackfillJob`'s
  highest field moved from 11→12 because 052 (the stacked base) had already added
  `failed_symbols=11` — field numbers computed at `/sdd-spec` time were stale by execute time.

**Permanent deviations**: FR-4 said the `timeframe` vocabulary migration covered "the backfill and
`GetBars` paths" so `"1d"` (backfill) and `"1Day"` (backtest) "MUST no longer be able to silently
miss each other." Shipped: only `analysis`'s `GetBars` call sites were fixed; `xstockstrat-ingest`'s
`TriggerBackfill` continued to persist `request.timeframe` **raw**, uncanonicalized. Because this
feature's own new "backfill this range" UI action (FR-6) sends only `timeframeEnum` with no string,
every UI-created backfill row this feature itself shipped landed with `timeframe=''` in the DB — the
exact class of silent mismatch this feature was built to eliminate. Undetected until feature
`080-fix-backfill-timeframe-enum` traced it (root-caused at
`services/xstockstrat-ingest/app/handlers/servicer.py:153,161,284`; full account in
`docs/roadmap/ledger/fails.md`, 2026-07-29 — 080-fix-backfill-timeframe-enum — assumption). Because:
Step 7 of the implementation spec scoped the timeframe fix narrowly to the read-side `GetBars`
calls, with no producer+reader sweep across the write path this same feature introduced.

**Cross-feature signal**: This feature is the origin case for the "absence claim not grep-verified"
and "producer/reader/untyped 3-pass sweep" lessons later generalized by 080 (see
`docs/roadmap/ledger/fails.md` and `insights.md`, both 2026-07-29/2026-07-30 entries) — a
deprecated-field migration that touches only producers (or only the read half) leaves
readers/writers elsewhere silently mismatched, and stayed hidden here because staging evidence came
from **agent**-created jobs (which send both fields) rather than the **UI**-created jobs this
feature itself shipped.

**Deferred follow-ons**:
- FR-5 (expose `GetDataCoverage` to the MCP agent as a tool) — explicitly deferred at sdd-review
  2026-06-08, still not implemented by any later feature as of this archival.
- Live progress display of a triggered backfill job in the UI's "backfill this range" panel —
  deferred because it needed P0 (`durable-observable-backfills`, i.e. 052) for reliable
  `bars_total`/status; 052 has since merged, so this soft follow-up may now be unblocked.

**Ledger entries written**: insights.md (2), fails.md (0 — this feature's own defect is already
recorded under 080's 2026-07-29 entry) — see the 2026-08-06 entries.
**Runtime-invariant recommendations (→ /context-constitution)**: none.
**Pruned artifacts**: product-spec.md, implementation-spec.md — last present at
`fe278020abe1e4b0c128a7a2207fd46596d8a9e8`.
