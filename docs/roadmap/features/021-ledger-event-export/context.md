# Context: ledger-event-export  (archived 2026-09-02)

**Feature**: ./feature.md
**Status**: launched — archived by /sdd-archiver; verbose specs pruned (recoverable via git history).

## Archive Synthesis — 2026-09-02 — /sdd-archiver

**What**: Shipped an additive server-streaming `ExportEvents` gRPC on `xstockstrat-ledger`, fronted by a `/trader` BFF `route.ts` that streams NDJSON/CSV to the browser. Grew mid-flight from proto-only to proto + a DB migration: added `user_id` to `LedgerEvent`/`AppendEventRequest` protos and a nullable `user_id` column + `(user_id, sequence)` index. Attribution is dual-channel: ledger `appendEvent` resolves `req.user_id || x-user-id metadata || NULL`, and `xstockstrat-trading` threads the owning `user_id` through `emitLedgerEvent` for fills/order-lifecycle events.

**Why (irrecoverable rationale)**: Per-user was an operator directive injected **after** product-spec approval — that is why scope jumped to proto+DB+DBA-gate and why a `user_id` field exists at all. Attribution had to touch a producer (trading emits fills from background pollers on a ctx with no inbound `x-user-id`; pure server-side stamping would leave every fill `user_id=NULL` and silently excluded from the tax-export use case); only trading changed because it is the only producer whose omission breaks an `@AC` (AC-8/AC-11). Historical rows are excluded **by construction** — `deny_mutation` triggers block UPDATE so backfilling `user_id` is impossible, and `WHERE user_id = $caller` auto-drops NULL rows, satisfying per-user isolation + historical exclusion in one predicate.

**Rejected alternatives**: host on `/insights` — lost, no ledger service registered there; server-side stamping only — lost, poller fills all NULL; update all 5 producers — lost, platform-scoped events (config_change, ingest) have no owning user (overbuild); one event per gRPC message — lost, 1M rows = 1M messages; reuse `queryEvents` pagination — lost, orders by non-deterministic `recorded_at`, buffers a page in the write pool, no per-user filter; order by `recorded_at` — lost, only `sequence` is monotonic; speculative `(event_type, occurred_at)` index — dropped, export scans by `user_id`+`sequence` and `event_type` is a post-filter.

**Scars & gotchas**: The export download deliberately uses `fetch → res.blob() → URL.createObjectURL → transient <a download> click`, **not** a plain `<a href … download>` GET — a bare anchor GET bypasses the session-cookie'd `fetch` refresh interceptor and would silently break auth-token refresh on the export request; a future "simplify to an anchor" defeats token refresh. Adding `userID` to `emitLedgerEvent` rippled to a call site outside the spec's Files list (`order_intent.go:166`); 26 total call sites, 4 platform-scoped emits pass `""`. `pg-cursor` was absent and added as a dep. The ledger Node unit suite runs vacuously under `--experimental-strip-types --test` (parameter-property constructor won't load; guard swallows; 0% coverage exits 0) — real red→green needs `tsc` then `node --test dist/…`.

**Permanent deviations**: design said use `connectCodeToHttp` → shipped an explicit gRPC→HTTP map → because AC-10's disabled path needs `FailedPrecondition`→403, not the mapper's 400. design said `backendHeaders(claims, ctx)` → shipped an inline three-header build → because a raw `route.ts` GET has no Connect `HandlerContext`. Producer scope realized wider than design's localized pointer (a shared helper-signature change, all 26 call sites).

**Cross-feature signal**: First durable acceptance suite for `xstockstrat-ledger` (scenarios promoted to `services/xstockstrat-ledger/acceptance/` at archival). Reuses the F-06 dedicated-`pg.Client`-outside-the-write-pool (EventNotifier) precedent and the config fail-open native-type trap.

**Deferred follow-ons**: `021b-ledger-producer-attribution` (per-user event classes owned by portfolio/analysis/ingest; admin-sees-all scope + a `ledger.export.max_concurrent` cap). Export DB-connection concurrency is uncapped — ledger is a direct service, so N concurrent exports = +N backend slots. The vacuous Node strip-types runner is a platform-wide test-infra bug (→ /sdd-qa / /sdd-triage).

**Ledger entries written**: insights.md (2), fails.md (1) — see the 2026-09-02 entries.
**Runtime-invariant recommendations (→ /context-constitution)**: LEDGER-* — per-user `ExportEvents` returns no pre-021 events (NULL by construction, backfill blocked by append-only triggers); ledger has no gRPC server interceptor, `appendEvent` reads inbound `x-user-id` in-handler and `src/middleware/propagation.ts` is the dead HTTP-era helper.
**Pruned artifacts**: product-spec.md, recon.md, design.md, implementation-spec.md — last present at 519e730.
