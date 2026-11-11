# Context: fix-ctx-cancel-warn-flood  (archived 2026-11-10)

**Feature**: ./feature.md
**Status**: launched — archived by /sdd-archiver; verbose specs pruned (recoverable via git history).

## Archive Synthesis — 2026-11-10 — /sdd-archiver

**What**: One symptom ("WARN flood with `context canceled`") had two unrelated causes.
- **Portfolio** was draining about 39 buffered `account.positions.synced` events in about 10 ms during shutdown, through a handler that ignored its ctx and acked nil. It now returns `ctx.Err()` before each further write (`portfolio_service.go`, `stop` closure).
- **Marketdata** had clients cancelling `GetBars` while the process was alive. Its live-fallback cache write is now detached from the client's cancel, and bounded only after the client leaves. The bars are persisted instead of dropped and refetched (`marketdata_service.go` `cacheLiveBars`).

Launched 2026-11-07 (PR #1472).

**Why (irrecoverable rationale)**:
- **The design was gated on log proof** (Loki staging, 2026-11-04 06:07 UTC). Portfolio logged `shutting down portfolio service` at :53.6, and the first cancel WARN followed at :54.94 on the same process. So the handler ctx really was done. This settled recon's "root cause unresolved" risk, and the defect report's ledger-stream-cancel guess was wrong.
- **Marketdata's lines were client cancels, not shutdown.** `begin tx: context canceled` started about 3 minutes AFTER marketdata's own shutdown line, with no restart. Burst shape: at most 27 cancels a minute, across distinct symbols, in 9 minute-buckets over 7 days. That is why there is a one-writer slot, and why per-key singleflight would not help.
- **Returning an error from a canceled broker sync is safe.** The goal is to stop draining at shutdown. The cursor does not matter, because `lastSeq` is in memory and history replays from 0 at boot. Round 1 explicitly rejected the claim that the 2 s sleep "rate-limits redelivery": that sleep is never reached, because `consumeEventStream` exits on `ctx.Err()` first.
- **Operator steer at the round-1 gate (P-04).** Persist bars after a client cancel instead of just quieting the log, so the Alpaca fetch is not repeated. Marketdata scope is limited to `fetchAndCacheBars`.
- **`barsCacheWriteGrace` (5 s) is a fixed resource-protection invariant, not a config key** (operator sign-off, C-18/F-07). It decides neither what the caller receives nor how old data can get, because the ingester re-upserts warm symbols. If it ever needs tuning, the fallback is one key, `marketdata.bars.cache_write_timeout_ms`, with config-team approval.

**Rejected alternatives**:
- Plain `WithTimeout(WithoutCancel(ctx), 5s)` — it would also cut a LIVE caller's 500-1000-row serial write. That returns a full page with an empty next-page token, which analysis reads as end-of-data (`services/xstockstrat-analysis/app/handlers/servicer.py` `@feature-272` paging). Caught by the round-2 adversary.
- A detached write with no concurrency cap — at 27 cancels a minute, N×grace on marketdata's 2-connection pool delays other reads.
- A buffered channel of 1 as the writer slot — test literals `&MarketDataService{}` leave it nil. A nil channel in a non-blocking `select` always takes `default`, so every departed write would be skipped silently. Replaced by `atomic.Bool`.
- `AfterFunc` form for every write — that ctx has no `Deadline()`, so `@AC-6` "deadline ≤ grace" cannot be asserted.
- `errors.Is(err, context.Canceled)` as the stop test — it also hides a pgx-reported cancel while the ctx is alive (pinned by the `@AC-4` negative control).
- `break` out of the portfolio loop — `presentSymbols` is built per iteration, so the delete would run on a truncated list. Use `return`.
- A transaction around the portfolio sync — scope creep: new repo surface and a longer `positionsMu` hold, while boot replay already repairs partial state.
- Log-level downgrade only (a `logCacheFailure` helper at 7 sites) — the operator rejected it, because bars would still be discarded and refetched.
- A shared cross-module cancel helper — portfolio and marketdata are separate Go modules.
- A second `barsCacheStore` interface — DRY; `barsBatchStore` already has `InsertBars`.
- `CopyFrom` batching of `InsertBars` — scope creep on the `@feature-196` persistence path.
- Warm-poller, ingest, `GetLatestQuote` and deregistration in scope — no flood evidence; moved to a follow-up report.

**Scars & gotchas**:
- **Getting RED with test and fix in separate steps (P-06).** Tests were drafted, then the pre-step service file was swapped in (`git show <sha>~1:…`), plus a temporary stub file declaring the new constant `barsCacheWriteGrace`. Without the stub the whole package fails to compile, which proves nothing. The file was then restored and checked byte-identical with `cmp`.
- **On the old marketdata code, RED is a nil-`s.repo` panic, not an assertion.** Test literals leave `s.repo` nil, and the panic doubles as the "no re-read" guard. AC-9 and AC-12 panic inside a goroutine, which aborts the binary with no `--- FAIL` line.
- **`truncateBars` clears the deprecated `Timeframe` string on the shared `live` slice in place.** Consequences:
  - the write must stay synchronous, before truncation;
  - the store fake snapshots `Timeframe` on entry to `InsertBars`;
  - returned-page checks read `TimeframeEnum`;
  - each call gets fresh bars (AC-9).
- **The AC-6 deadline is measured against an `entryTime` recorded inside `InsertBars`.** A `time.Now()` taken before the call can never satisfy `<= +grace`.
- **Grace was sized from a proxy measurement.** `InsertBars` has no trace span (pgx is uninstrumented), so "size grace from measured p99" was impossible as written. Grace was sized from whole-request `GetBars` Tempo traces instead: worst 2.70 s, so 5 s is 1.85×. The spec then made a direct staging timing a BLOCKING pre-PR gate. The executor had no staging DB access, and the operator waived it (Option C, 2026-11-06).
- **No `t.Parallel()` anywhere** — every test uses a process-global slog recorder.
- **Husky did not run in a worktree without `node_modules`** (`.husky/_` missing).
  - A `node_modules` symlink fixed Steps 1, 4 and 5.
  - The Step 3 marketdata service commit (`c0ceb051`) and the early docs-only commits landed with NO hook run, because the symlink would have dangled.
  - `--no-verify` was never used.
- **Restart churn was seen and never followed up.** Staging portfolio showed about 15 start→shutdown pairs, about 26 s apart, in 2 days. That churn likely multiplies the shutdown drains, which would account for recon's 300–580 lines/hour puzzle. This is inferred, not verified. Nobody investigated its cause.
- **Teardown was manual.** `/context-forge:context-constitution` was unavailable, so it was reconciled by hand, with line hints re-stamped (marketdata +35, portfolio +22).

**Permanent deviations**:
- **Writer slot.** Design: buffered chan(1). Shipped: `atomic.Bool` + `CompareAndSwap`. Because: a nil channel in zero-valued test literals would skip every departed write.
- **Write context.** Design: every write uses `WithCancel(WithoutCancel)` + `AfterFunc(grace)`. Shipped: split on `ctx.Err()` at write start. A client already gone gets `WithTimeout(WithoutCancel, grace)` (a real deadline); a live client keeps the `AfterFunc` form. Because: `AfterFunc` has no `Deadline()`, so `@AC-6` could not be asserted.
- **Which failures WARN.** Design: only a live-ctx write failure WARNs. Shipped: ANY failed write WARNs, whatever the client state (`@AC-11`). Because: a detached write can never fail from the client's cancel, so a failure means a real DB error or an undersized grace. With one departed writer at a time, that is at most one WARN per grace.
- **Grace sizing.** Design: from a measured `InsertBars` p99. Shipped: 5 s from the Tempo whole-request ceiling under an operator waiver, plus the out-of-scope read-only `scripts/measure-insertbars-cost.py` (commit `9a9a11cf`, reads `pg_stat_statements`). Its ~1000-bar figure is a lower bound: it excludes round trips, BEGIN/COMMIT and pool wait.
- **Burst bound only partly true.** Design: the one-writer slot bounds a cancel burst's pool cost to one connection for at most grace. Shipped: a request that is live at write start and departs mid-write takes the `AfterFunc` branch with no slot, so such a burst can still hold N×grace pooled connections. Accepted residual (impl-spec review F-06/C-18).

**Cross-feature signal**:
- **291 and 294 overlap.** 291 shares the `barsStore` field comment; 294's `boundedRetry` instrumentation touches the same consumer path. 290 merges before 291 (291's `barsStore` verification presupposes 290's swap) and before 294 (a shutdown sync is now an `error` outcome). Nothing orders 291 against 294.
- **F-07 precedent.** In the same batch, 291 made its staleness window a config key, while 290's grace was approved as an invariant because it does not decide data age.
- **Stale cite.** `merge-order.md` cites `boundedRetry` at a stale `portfolio_service.go` line; it was left for whoever next edits that row.

**Deferred follow-ons**:
- **Tune `barsCacheWriteGrace`.** Run `uv run scripts/measure-insertbars-cost.py` against staging and production. Re-size if the ~1000-bar estimate approaches ~2.5 s (50% of grace).
- **Open defect report `docs/reports/2026-11-04-cancel-warn-remaining-sites-defect.md` covers the remaining sites:**
  - warm poller, ingest, `GetLatestQuote`;
  - `processAccountDeregistered`;
  - `ackAlways` consumers' shutdown-drain WARNs;
  - the WARN when a client departs during the re-read.
- **Update findings at the next `/context-constitution` refresh.** The broker-sync "swallows write failures" row in `services/xstockstrat-portfolio/docs/context-constitution-findings.md` is partly superseded. A ctx-done sync now returns `ctx.Err()`, while a live-ctx broker failure is still swallowed.
- **Stale line hints.** Older stale `~L` hints (MARKETDATA-5/6/8/14/N1) are left for the next full constitution refresh.
- **Separate defect, out of scope.** `toGRPCError` maps `Canceled`/`DeadlineExceeded` to `Internal`.
- **The remaining-sites report cites this feature's pruned `design.md`.** Its "settled pattern" is now this synthesis plus `cacheLiveBars` / `processPositionSync` (design.md is at `2d91b567`). The report also lists `GetBars: live fetch failed` on a client cancel and the bar-ingest per-symbol fallback-loop WARNs.
- **Accepted residuals not tracked elsewhere:**
  - In a cancel burst, departed writes that find the slot busy are dropped SILENTLY and the bars stay uncached. That is the same outcome as before the fix, so no WARN was added; this is not a bug.
  - a portfolio cancel can apply k of N upserts (no transaction); boot replay repairs it;
  - a detached write still in flight at process exit dies with the process (`GracefulStop` is capped at 3 s); rollback plus idempotent upsert make this safe;
  - grace expiry on a mid-write departure is untested, because the constant is not injectable.

**Ledger entries written**: insights.md (1), fails.md (2) — see the 2026-11-10 entries. The 2026-11-04 design entry and the WithTimeout/AfterFunc split reuse entry already existed and were skipped.

**Runtime-invariant recommendations (→ /context-constitution)**:
- **MARKETDATA:** `fetchAndCacheBars` must write synchronously, before `truncateBars`. `omitDeprecatedTimeframe` mutates the shared `live` slice in place, so a fire-and-forget write could persist an empty `timeframe` (`@AC-8 @feature-196`). Verify that MARKETDATA-3 carries this.
- **PORTFOLIO:** in `processPositionSync`, stop by `return`, never `break`. `presentSymbols` is built per iteration and drives `DeletePositionsNotInSync`.

**Pruned artifacts**: product-spec.md, recon.md, design.md, implementation-spec.md — last present at 2d91b5671335fcce267679b50caa494440205f51. Defect report `docs/reports/2026-11-04-portfolio-marketdata-warn-flood-after-ctx-cancel-defect.md` (pruned 2026-11-10; `git show 2d91b567:docs/reports/2026-11-04-portfolio-marketdata-warn-flood-after-ctx-cancel-defect.md`) (+ `.status`) was pruned in the same run.
