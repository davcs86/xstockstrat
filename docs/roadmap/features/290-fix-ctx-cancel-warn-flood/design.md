# Design: fix-ctx-cancel-warn-flood

**Created**: 2026-11-04
**Rounds**: 2 (full; termination: approved)
**Approved by**: user @ 2026-11-04 (round-2 gate; marketdata variant "Detach, post-departure bound + 1 writer")
**Grounded in**: recon.md

---

## Chosen Approach

Two independent fixes in separate Go modules (separate steps/PRs). Internal/platform-only — no proto, UI, agent or MCP surface (C-14 n/a). No config key (the one new bound is a fixed resource-protection invariant, operator-approved below).

### Portfolio (FR-1) — `processPositionSync` (`services/xstockstrat-portfolio/internal/service/portfolio_service.go:1381-1447`)

Evidence (context.md): at flood time the process ctx IS done — `shutting down portfolio service` at :53.6, first `upsert position from sync failed … context canceled` at :54.94 on the same process, ~39 buffered `account.positions.synced` events (5 upserts + 1 delete each) handled in ~10 ms, every one returning nil (acked). The flood is shutdown draining already-buffered events through a handler that ignores its ctx.

- Decide on the caller's ctx state (`ctx.Err() != nil`), never on the driver error text (`errors.Is(err, context.Canceled)` would also hide a ctx-alive pgx cancel — the negative control below pins this). Return `ctx.Err()` itself, so the class is exactly `Canceled`/`DeadlineExceeded` → `retryTransient` at `:1279` → `boundedRetry` returns the error without parking (`:1316-1323`) → `streamEventsFrom` returns and withholds the cursor (`:232-233`) → `consumeEventStream` exits at `:197` (the `:205` sleep is never reached).
- One local closure inside `processPositionSync` — `stop := func(sym string) error { slog.DebugContext(ctx, "position sync stopped: context done", …); return ctx.Err() }` — used at every check site (not a cross-module helper; portfolio and marketdata are separate modules). Check sites: (1) top of the per-symbol loop `:1409`, before each `UpsertPositionFromSync`; (2) the upsert error branch `:1420`, before the WARN; (3) **inside** the `shouldReconcileSyncDeletions` true branch `:1426`, immediately before `DeletePositionsNotInSync`, and in its error branch; (4) **inside** `if sync.RealizedPnl != nil` `:1437`, immediately before `UpsertOfflineRealized`, and in its error branch. The feature-206 `else` skip path (`:1431-1433`) gets no check → unchanged by construction.
- **Return, never `break`**: `presentSymbols` is appended per iteration (`:1424`); breaking would run the delete on a truncated list.
- A canceled **broker** sync now returns the cancel error instead of nil (stops the drain). The rationale is stated honestly: *stop draining at shutdown; the cursor is irrelevant because `lastSeq` is in memory (`:192`) and the full history replays from 0 at boot* — no "2 s sleep rate-limits redelivery" and no gRPC-buffering claim.
- Update the doc comment at `:1379-1380` ("returns an error only for an offline sync…") to: *"Returns ctx.Err() as soon as ctx is done (before the next write, any sync); otherwise an offline sync attempts every write and joins the failures, and a broker sync stays warn-and-continue."*
- `boundedRetry`, `classifyConsumerErr`, `processAccountDeregistered` and the other consumers are untouched.
- Partial application (k of N upserts, no transaction) is identical to today and repaired by boot replay (absolute recompute, `@AC-10`/`@AC-11 @feature-157`). Wrapping the sync in a transaction is explicitly rejected (new repo surface, longer `positionsMu` hold).

### Marketdata (FR-2) — `fetchAndCacheBars` only (`services/xstockstrat-marketdata/internal/service/marketdata_service.go:356-388`)

Evidence: `GetBars: cache insert failed … begin tx: context canceled` bursts (max 27 distinct symbols in one minute, 21 and 12 in others, 9 minutes in 7 days) are client-cancelled request contexts while the process is alive (≈3 min after marketdata's own shutdown line, no restart).

- Replace `s.repo.InsertBars(ctx, live)` (`:370`) with the existing `s.barsStore.InsertBars` seam (`barsBatchStore`, `:127-130`, wired `:239`) — no new interface, no second `InsertBars` holder.
- **Bound the write only after the client leaves.** The write context is `context.WithCancel(context.WithoutCancel(ctx))` with `context.AfterFunc(ctx, func(){ time.AfterFunc(grace, cancel) })`. While the client is live the write runs exactly as today (no new deadline → no new truncation trigger); only a departed client's write is capped at `grace`. (Round-2 finding: a plain `WithTimeout(WithoutCancel(ctx), 5s)` would also cut a *live* caller's ~500-1000-row serial write at 5 s and return a full page with an empty next-page token, which analysis reads as end of data — `services/xstockstrat-analysis/app/handlers/servicer.py:1482-1484`, `@feature-272`.)
- **One departed-client writer at a time.** If the request ctx is already done when the write would start, take a non-blocking single slot (buffered channel of 1); if busy, **skip silently** (bars not cached, no WARN — exactly today's outcome for that request) and return `truncateBars(live, pageSize, recent), ""`. This bounds the pool cost of a cancel burst to one pooled conn for ≤ `grace` (marketdata pool default 2; the PgBouncer backend cap is shared with five other services), instead of N×`grace`.
- `grace` is a **fixed invariant**, not a config key: a pure resource-protection bound that decides neither what the caller receives (every branch returns the live bars with a nil error — MARKETDATA-3) nor how old data can be (the bar ingester re-upserts warm symbols every `bar_ingest_interval_ms`). It is **sized from a measured `InsertBars` p99 for a ~1000-bar slice at spec time, not guessed** (`insights.md:3692-3693`); the provisional candidate is 5 s. Operator sign-off recorded in context.md; it goes into marketdata `CLAUDE.md` (GetBars bullet) and MARKETDATA-3's prose. If the operator later wants it tunable, the fallback is one key `marketdata.bars.cache_write_timeout_ms` with config-team approval.
- After the write: `if ctx.Err() != nil { return truncateBars(live, pageSize, recent), "" }` — the client is gone, so skip the re-reads (`:375`/`:382`): no DB call, no WARN. A live-ctx re-read failure (`:377`/`:384`) and a live-ctx write failure (`:371`) still WARN and still return the live page with a nil error. A client leaving *during* the single indexed re-read can still produce one WARN — accepted residual (a read seam would be needed to test it; C-18).
- The write stays **synchronous**: `truncateBars` → `omitDeprecatedTimeframe` mutates the shared `live` bars in place (`:404-408`); a fire-and-forget write would race it and could persist an empty `timeframe` (`@AC-8 @feature-196`). The test asserts the stored bars carry `Timeframe == "1d"`.
- The detached singleflight closures (`:604-632`, `:774-860`) are not touched (`@AC-3 @feature-229`).
- Update the stale doc comment at `:354-355` ("returns no bars" is already false on insert failure).

### RED tests (C-08, P-06, C-13; fakes inline, single consumer)

Portfolio (`internal/service`): (i) an inline `syncRecorderDB` variant (`portfolio_offline_test.go:220-236`, injected via `repository.NewPortfolioRepoWithDB`) whose `Exec` calls the test's `cancel()` and returns `ctx.Err()` → 1 exec, no delete, 0 WARN, `errors.Is(err, context.Canceled)`; (ii) cancel after a successful first upsert → the second upsert is not made; (iii) NEGATIVE CONTROL: live ctx + a write failing with a driver-reported `context.Canceled` → the WARN still fires; (iv) offline sync with a done ctx through `boundedRetry` → non-nil, `UpsertOfflineRealized` absent, no `event parked` Error; (v) empty broker snapshot with a done ctx → feature-206 skip path unchanged, returns nil. (iii) and (v) are **characterization guards**, not RED.

Marketdata (`internal/service/marketdata_service_test.go`): new inline `DataSourceClient` fake whose `GetBars` returns bars with `Timeframe:"1d"` and can call a captured `cancel()` before returning (`fakeMultiSource.GetBars`/`fakeBackfillSource.GetBars` return `nil, nil` and would pass vacuously — `:1345-1347`, `:904-907`); new inline recording `barsBatchStore` capturing ctx state at call time (`fakeBarsStore.InsertBars` is a stateless no-op, `:4074`). Tests: AC-6 (client cancels after the live fetch → store called ≥1 time on a ctx with `Err()==nil` and a deadline ≤ now+grace, stored bars `Timeframe=="1d"`, 0 WARN, no re-read, live page returned); AC-7 (live no-deadline ctx → write ctx has **no** deadline; byte-identical to today); AC-8 (live ctx + failing write → WARN, live page, nil error — characterization); AC-9 (second departed-client write while one is in flight is skipped silently). On today's code AC-6/AC-9 go RED by a nil `s.repo` panic at `:370`, not a failed assertion — noted in the spec.

### Follow-ups (named artifacts, not free text)

`docs/reports/2026-11-04-cancel-warn-remaining-sites-defect.md` (+ `.status` `open`) lists every site left out: marketdata `:364`, `:564`, `:1152`/`:1173` (warm poller), `:1305`/`:1326` (ingest), the residual mid-read re-read WARN; portfolio `processAccountDeregistered` `:1357-1363`, and the `ackAlways` consumers' shutdown-drain WARNs (balance sync `:1511`, bracket update `:1463`, order-fill `:174`). Batching/`CopyFrom` for `InsertBars` is recorded as a rejected scope-creep alternative (it touches the `@feature-196` persistence path) and noted in that report.

## Rejected Alternatives

- Shared cancel helper across services — rejected: portfolio and marketdata are separate Go modules; inline `ctx.Err()` is the existing idiom (`portfolio_service.go:197`).
- `errors.Is(err, context.Canceled)` as the stop test — rejected: hides ctx-alive pgx cancels (`@AC-3 @feature-227` spirit).
- `break` out of the portfolio loop — rejected: the delete would run on a truncated `presentSymbols`.
- Transaction around the portfolio sync — rejected: scope creep; boot replay repairs partial state.
- Log-level downgrade only in marketdata (`logCacheFailure` helper at seven sites) — rejected by the operator: bars stay discarded and re-fetched.
- Plain `WithTimeout(WithoutCancel(ctx), 5s)` — rejected: cuts live callers' writes, truncates backtest pages silently.
- Detached write with no concurrency cap — rejected: cancel bursts of up to 27/min would queue on 2 pooled conns for N×grace and delay other marketdata reads.
- A second `barsCacheStore` interface — rejected (C-18 DRY): `barsBatchStore` already holds `InsertBars`.
- Warm-poller / ingest / `:564` / deregistration in scope — rejected: no flood evidence in the checked window; tracked in the follow-up report.
- Singleflight per `(symbol, tf, start, end)` for detached writes — rejected (C-18): burst symbols are distinct, coalescing would not help.

## Open Risks

- [ ] `grace` value must be sized from measured `InsertBars` p99 — to be addressed in the marketdata spec step (measurement recorded in context.md).
- [ ] Dropped departed-client writes (slot busy) leave bars uncached in a burst — equals today's behaviour; accepted.
- [ ] A detached write in flight at process exit dies with the process (`cmd/server/main.go:204-211`; `GracefulStop` capped at 3 s by `StopServer`); rollback + idempotent upsert make this safe.
- [ ] A client leaving during the re-read can still log one WARN — accepted residual.
- [ ] Partial application on portfolio cancel is non-atomic (readers may see a mix) — identical to today; repaired by boot replay.

## Constitution Rules Touched

- `C-08` / `P-06` — honored by: paired RED tests per step; AC-6/AC-9 RED, others labelled characterization.
- `C-13` — honored by: fakes stay inline in the existing test files (single consumer each).
- `C-14` — honored by: stated internal/platform-only.
- `C-15` — honored by: FR-1/FR-2 in product-spec; every `@AC-*` tagged `@FR-*`; `@AC-1` keeps its meaning (tagged FR-1) and new IDs are appended.
- `C-16` — honored by: see Business Rules Touched.
- `C-18` — honored by: one closure, existing seams, no new interface, no helper, no config key.
- `F-04` — honored by: every symbol/line cited from recon or verified by the adversary.
- `F-06` — honored by: one-writer slot caps the extra pooled conn; no pool maximum changes.
- `F-07` — honored by: no tunable introduced; `grace` is a resource-protection bound (does not decide data age or content), operator-approved, applied only after client departure.

## Business Rules Touched (C-16)

- PRESERVE `@AC-1/@AC-6/@AC-9 @feature-256` (`services/xstockstrat-portfolio/acceptance/fix-offline-book-consistency.feature`) — cancel returns non-nil, classed transient, never parks; `boundedRetry` untouched so conditional `@AC-2 @feature-256`, platform `@AC-15 @feature-157`, `@AC-18 @feature-163` are not triggered.
- PRESERVE `@AC-4 @feature-206` (`…/fix-reconciliation-false-halt.feature`) — no check in the skip `else`; covered by `@AC-5` here.
- PRESERVE `@AC-7/@AC-10/@AC-11 @feature-157`, `@AC-14 @feature-163` — live-ctx write order and absolute recompute unchanged.
- PRESERVE `@AC-3/@AC-7/@AC-8 @feature-229` (`services/xstockstrat-marketdata/acceptance/fix-book-portfolio-page.feature`) — detached closures untouched; a genuine failure still WARNs.
- EXTEND `@AC-8 @FR-2 @regression @feature-196` (`…/proto-deprecated-field-removal-program.feature`) — persistence shape unchanged (same rows, same upsert, `timeframe` "1d"); the write now also survives the client leaving.
- PRESERVE `@AC-3 @feature-178`, `@AC-53/54 @feature-240`, `@AC-2/3 @feature-191`, `@AC-1 @feature-153`, `@AC-7 @feature-147`, `@AC-3 @feature-227`, `@AC-11 @feature-231`; analysis `@AC-1/@AC-2/@AC-6 @feature-272` and `@AC-6 @feature-275` (backtest pagination — guarded by the post-departure-only bound).
- No CHANGE; no sign-off required beyond the invariant approval recorded in context.md.

## Rounds

2 — round 1 NEEDS WORK (root cause gated on Loki evidence; rationale corrected; seam duplication; RED validity); round 2 NEEDS WORK with no Floor breach (live-path truncation, burst pool pressure, test fakes, follow-up report, spec hygiene) — all adopted; approved by the operator.
