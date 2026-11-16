# Recon: delisted-symbol-handling

**Created**: 2026-11-16
**From**: product-spec.md
**Tree**: claude/story-delisted-symbol-handling@1804395 (contains origin/main-dev@78ab5ca) — the story PR #1563 is not merged, so recon ran on the story branch, not `main-dev` (deviation from `docs/sdd/tree-freshness.md`, recorded in context.md)
**Affected services**: xstockstrat-marketdata, xstockstrat-portfolio, xstockstrat-ingest, xstockstrat-agent, xstockstrat-ui, xstockstrat-notify, xstockstrat-analysis (watchlist reader, found by recon), packages/proto

---

## Objective

Detect a symbol that stays unservable for 5 trading days, record that once per symbol in a marketdata
profile, remove it from system-managed watchlists, mark it on user watchlists, stop watchlist-driven
work from requesting it, and report it `skipped` with a per-symbol reason in backfill job status so a
job no longer ends `PARTIAL` because of it. Alert on flag and on recovery; stored data is kept.

## Codebase Map

Paths are relative to the service directory unless they start with `packages/`, `docs/` or `services/`.

- **`xstockstrat-marketdata`** (Go)
  - Entry point: `cmd/server/main.go:139` (`NewMarketDataService`), `:156` (`go svc.StartAssetSetRefresher(ctx)`); six goroutines at `:148-158`
  - Handler: `internal/handler/marketdata_handler.go:168` (`GetSymbolServability`), adapter near `:377`
  - Last migration: `009_symbol_classification.up.sql` (007 unused on purpose) → next `010`
  - Config-read pattern: `internal/service/asset_servability.go:169` `resolveAssetRefreshInterval` → `cfg.GetInt(assetRefreshHoursKey, default)` (`:173`) on `intGetter` (`internal/service/marketdata_service.go:134`), watcher assigned `:253`; helpers `internal/config/watchcore.go:393` (`GetInt`)
  - Asset set: `assetSet{otc map[string]bool}` `asset_servability.go:31` (no timestamp, no load date); `classify` `:46`; `refreshAssets` `:113`; shrink guard `:127`; **single commit point `:135` `s.assets.snap.Store(next)`**; first-load-only prune `:136-148`; `StartAssetSetRefresher` `:185` (immediate attempt `:197`, 1-minute ticker `:198`, interval key `assets.refresh_interval_hours` default 6 h `:27`)
  - Asset source: `internal/alpaca/client.go:777` `GET /v2/assets?status=active`; `internal/source/source.go:19` `ListAssets`
  - Warm set: `warmSymbols map[string]struct{}` under `warmMu` `marketdata_service.go:51-55`; gated add `markWarmIfServable` `asset_servability.go:81` (callers `marketdata_service.go:284`, `:818`, `:935`); **ungated add `markWarm` `:1167`** (callers `:615` GetLatestQuote, `:645` GetLatestQuotes, `:758` GetLatestPrice); readers `warmSnapshot` `:1178` (used by `ingestRecentBars` `:1379` and `classification_service.go:82`), `StartWarmQuotePoller` inline copy `:1213-1218`; only removal is the first-load prune
  - Feature-291 hold: `internal/service/bar_hold.go:8-11`, `planBarRequest` `:47`
  - Backfill: `BackfillFundamentals` `marketdata_service.go:2292` (per-symbol loop `:2323-2337`, WARN `:2326`, `failed` append `:2327`); `backfillOneSymbol` `:2344`; `BackfillBars` `:1501` (loop `:1549-1570`, failures `:1552-1565`)
  - Metric: `internal/telemetry/otel.go:360-366` (`BackfillWritten|Empty|Failed`, no `Skipped`), `RecordBackfillSymbol` `:419`; `internal/service/telemetry_allowlist_test.go` exists (not opened)
  - EDGAR error: `internal/edgar/edgar_client.go:180` plain `fmt.Errorf("no CIK for ticker %q")` — errors are untyped strings
  - Notify client already present: field `marketdata_service.go:44`, dial `:225-238`, `emitAlert` `:1739`, `emitWarning` `:2160`, once-per-window precedent `maybeAlertQuota` `:2142`; test fake `marketdata_service_test.go:325`
  - Repo pattern: `internal/repository/classification_repo.go` (`NewClassificationRepo(r *MarketDataRepo)` shares the pool), `pool.go:15` (max 2), `:31-33` (`QueryExecModeExec` under PgBouncer)
  - Tests: `_test.go` beside source; fixtures `internal/testdata/assets.go`; real-DB job `marketdata-db-test` (`-tags dbtest`)
- **`xstockstrat-portfolio`** (Go)
  - Entry point: `cmd/server/main.go:75-81` (background goroutines; `:81` `go svc.PruneExpiredSignalEntries(ctx)`)
  - Service: `internal/service/portfolio_service.go` — `refuseUnservable` `:568`, `servabilityTimeout` `:550`, insert paths `:2181`, `:2332`, `:2451`; reads `GetWatchlist` `:2233`, `ListWatchlists` `:2246`; `ListAllWatchlistSymbols` `:2220`; `WatchlistStore` interface `:1987`; `emitRiskAlert` `:1320`; marketdata client field `:47`, dial `:137-144`
  - Last migration: `018_watchlist_signal_expiry.up.sql` → next `019`
  - Config-read pattern: `s.wlCfg.GetInt(signalPruneIntervalKey, 300)` `internal/service/signal_prune.go:33`
  - Existing automatic deleter: `signal_prune.go:37` loop + `internal/repository/signal_expiry_repo.go:35` (`pruneListTx` `:61`, `SKIP LOCKED` `:70`, expiry-row cleanup `:126-134`)
  - Binding read points: `internal/repository/watchlist_repo.go:162` `bindingsByWatchlist`, `:464` `listBindings`; `ListAllSymbols` `:446`; `RemoveSymbols` `:325`
  - Internal-caller allow-list: `internal/service/authz.go:20`
  - Tables: `migrations/007_watchlists.up.sql:6,16`, `011_watchlist_system_managed_source.up.sql:11,26,31`, `018_watchlist_signal_expiry.up.sql:4` (expiry FK is to `watchlists`, not the binding)
  - Tests: `internal/service/watchlist_service_test.go`, `signal_prune_test.go`, stub `portfolio_service_test.go:33-57`; fixtures `internal/testdata/`; CI threshold 40 (`.github/workflows/ci.yml:334`)
- **`xstockstrat-ingest`** (Python)
  - Servicer: `app/handlers/servicer.py` — `_run_backfill` `:632`; fundamentals path `:686-731` (status rule `:705-707`); bars path `_run_chunks` `:921-1007`, `_finalize_backfill` `:815-879` (rule `:827-833`); `job_row_to_proto` `:300-324`; `_emit_backfill_alert` `:603`
  - Last migration: `016_seed_source_templates` → next `017`
  - Repo: `app/repositories/backfill_jobs.py:13-26` (`_UPDATABLE_COLUMNS` allow-list)
  - Webhook payload: `app/engine/webhook_handoff_loop.py:41-62` (exactly 8 keys, row columns only)
  - Tests: `tests/test_ingest_servicer.py`, `tests/test_webhook_handoff_loop.py:37-46` (`_PAYLOAD_KEYS`), `tests/_helpers.py:62` (`job_row` mirrors the DDL); CI threshold 40 (`.github/workflows/ci.yml:470`)
- **`xstockstrat-agent`** (Python)
  - Mapping: `app/client.py:377` `_watchlist_to_dict` (plain `MessageToDict`, proto3 defaults omitted), `:382` `_refused_to_list` (enum-name pattern), `:2146` `get_backfill_status` (`MessageToDict` with `always_print_fields_with_no_presence=True`)
  - Tools: `app/tools.py:2153`, `:2169`, `:2190`, `:2281`, `:1642` (docstring `:1650-1652`)
  - Docs: `docs/runbooks/mcp-tools.md` sections at 1052-1083, 1380-1396, 1400-1417, 1421-1468, 1472-1505; `plugins/strat-lab/skills/backtest/reference/backfill.md` L54-58, L66-75; `plugins/strat-lab/skills/backtest/SKILL.md` L205-221
  - Tests: `tests/test_watchlist_client.py`, `tests/test_client.py:670-752`, `tests/test_tools.py:1782-1802`; CI threshold 40
- **`xstockstrat-ui`** (Next.js)
  - Page: `src/app/insights/watchlists/page.tsx:189`; rows `src/components/insights/WatchlistReadiness.tsx:303-368` and `:372-396`, `SignalSourceBadge` `:41-48`; local types `WatchlistDetail.tsx:38,40`, `WatchlistReadiness.tsx:34`
  - Transport: `src/hooks/useWatchlists.ts:33` → BFF `src/lib/insightsBff.ts:133-147` (proto passes through unchanged)
  - Reason text: `src/lib/opportunityShared.tsx:48-52` `UNSERVABLE_REASON`; badge `src/components/ui/badge.tsx`
  - Backfill page (optional surface): `src/app/insights/backfills/page.tsx:388-392`
  - Tests: `e2e/insights/watchlists.spec.ts`, `e2e/helpers/watchlistMock.ts:23-54`, `e2e/fixtures/INVENTORY.md:47,63`, `src/lib/opportunityShared.test.ts:47`
- **`xstockstrat-analysis`** (Python, watchlist reader)
  - Three watchlist read sites: `app/handlers/servicer.py:5995` `_drain_watchlist_bindings`, `app/engine/live_loop.py:592` `_drain_watchlist`, `app/engine/fundsignal_loop.py:394` `_enumerate_watchlist_union`; plus `servicer.py:4132` `GetWatchlistReadiness`
- **`xstockstrat-notify`** (Node)
  - `EmitAlert`: `packages/proto/notify/v1/notify.proto:14,73-83` (`category` is a free string, no dedup key); handler `src/grpc/notifyServiceImpl.ts:50-70`; fanout dedup only `src/fanout/fanout.ts:81-92,144-151`; `fanout.min_severity` default WARNING (`fanout.ts:61-66`)

## Patterns to REUSE

- Per-load detection hook → attach after `asset_servability.go:135`; no new loop, the refresher already runs (`:185`).
- Per-symbol profile repo → copy `internal/repository/classification_repo.go` (shared pool, pgxmock test beside it, `dbtest` real-DB test).
- Live int config key with a nil-safe default → `resolveBarIngestBackoff` `bar_hold.go:35` / `resolveAssetRefreshInterval` `asset_servability.go:169`.
- Config seed row shape → `services/xstockstrat-config/migrations/052_alpaca_adaptive_rate_limit_keys.up.sql:4-19` (namespace-relative key, global staging + production, `updated_by` sentinel, `ON CONFLICT DO NOTHING`).
- Best-effort alert from marketdata → `emitWarning` `marketdata_service.go:2160`; `NOTIFY_ENDPOINT` is already wired (`docker-compose.yml:276`, `.do/app.yaml:173`, `.do/app.dev.yaml:173`) — no new env var.
- Portfolio asking marketdata with a deadline and fail-open → `refuseUnservable` `portfolio_service.go:568`.
- Cross-user automatic removal in portfolio → `PruneExpiredSignalEntries` (`signal_prune.go:37`, `signal_expiry_repo.go:35-137`): one deleter, `SKIP LOCKED`, delete the expiry row with the binding, commit per list.
- Per-symbol enum name on an agent tool → `_refused_to_list` `client.py:382-389`.
- UI reason text and row badge → `UNSERVABLE_REASON` `opportunityShared.tsx:48-52`, `SignalSourceBadge` `WatchlistReadiness.tsx:41-48`.
- UI test data → `mockWatchlists` / `MockBinding` `e2e/helpers/watchlistMock.ts`, catalog row `e2e/fixtures/INVENTORY.md:47` (C-12).
- Go test fixtures → `services/xstockstrat-marketdata/internal/testdata/assets.go`, `services/xstockstrat-portfolio/internal/testdata/` (C-13).

## Existing Business Rules (preserve / extend)

- **CHANGE** `@AC-15 @FR-3 @feature-282` "The first successful load removes unservable symbols warmed while unloaded" (`services/xstockstrat-marketdata/acceptance/filter-otc-symbols.feature`) — only the clause "a later refresh that stops listing AAPL does not remove it from the warm set". Signed off by the operator (D-11, context.md). Same PR: the "only the first successful load prunes" sentence and residual R2 in `services/xstockstrat-marketdata/CLAUDE.md`, and MARKETDATA-16.
- **PRESERVE (at risk, N1)** `@AC-16 @FR-3 @feature-282` "Quote and price paths are not gated" and `@AC-26 @FR-3 @feature-282` "A held symbol pruned by the first load is re-warmed by the next quote read" (same file); `@AC-17 @FR-3 @feature-282` "A held offline unservable symbol stays valued and warm across later refreshes" (`docs/sdd/business-rules/platform.feature`). A quote read re-warms a flagged symbol through `markWarm`; altering that needs its own sign-off.
- **PRESERVE** `@AC-1`, `@AC-4`, `@AC-9`, `@AC-10`, `@AC-11`, `@AC-12`, `@AC-13`, `@AC-14`, `@AC-23`, `@AC-24` `@feature-282` (marketdata `filter-otc-symbols.feature`); `@AC-7`, `@AC-22` `@feature-282` (`platform.feature`).
- **PRESERVE** `@AC-2`, `@AC-3`, `@AC-6`, `@AC-8`, `@AC-25` `@feature-282` (`services/xstockstrat-portfolio/acceptance/filter-otc-symbols.feature`).
- **PRESERVE (ambiguous, N2)** `@AC-19 @FR-2 @feature-282` "A name-only replace-all update drops a stored unservable symbol and reports it" (portfolio `filter-otc-symbols.feature`) — conflicts with FR-4 for a flagged symbol on a user list.
- **EXTEND** `@AC-18 @FR-2 @feature-282` (`services/xstockstrat-agent/acceptance/filter-otc-symbols.feature`); **PRESERVE** `@AC-5 @FR-4 @feature-282` (same file).
- **PRESERVE** `@AC-20`, `@AC-21` `@feature-282` (`services/xstockstrat-ui/acceptance/filter-otc-symbols.feature`).
- **PRESERVE** `@AC-1`, `@AC-7` `@feature-127` (`platform.feature`); `@AC-6 @feature-127` (`services/xstockstrat-portfolio/acceptance/consolidate-watchlist-signal.feature`) — identify lists by `system_managed`, never by name.
- **PRESERVE** `@AC-2`..`@AC-8`, `@AC-13` `@feature-281` (`services/xstockstrat-portfolio/acceptance/signal-watchlist-expiry-pruning.feature`) — the removal drops the expiry row and emits neither 281 ledger event.
- **EXTEND** `@AC-1 @feature-154` (`services/xstockstrat-portfolio/acceptance/fundsignal-watchlist-universe.feature`), `@AC-3`, `@AC-4` `@feature-154` (`services/xstockstrat-analysis/acceptance/fundsignal-watchlist-universe.feature`), `@AC-2 @feature-180` (`services/xstockstrat-analysis/acceptance/watchlist-readiness-precompute.feature`) — flagged symbols leave the union / universe.
- **EXTEND** `@AC-14 @FR-4 @feature-294` (`services/xstockstrat-marketdata/acceptance/signal-map-instrumentation.feature`) — outcome value `skipped`; **PRESERVE** `@AC-41 @feature-294` (`platform.feature`) — no new label key.
- **PRESERVE** `@AC-9`, `@AC-8` `@feature-348` (`services/xstockstrat-marketdata/acceptance/fix-edgar-historical-fundamentals.feature`).
- **PRESERVE (at risk, N3)** `@AC-30 @FR-3 @FR-10 @feature-334` (`services/xstockstrat-ingest/acceptance/webhook-fanout-callback.feature`) — the webhook payload keeps exactly its 8 keys and no error text; **PRESERVE** `@AC-17`, `@AC-29` `@feature-334`.
- **PRESERVE** `@AC-6 @feature-261` (`services/xstockstrat-ingest/acceptance/fix-ingest-poller-backfill.feature`) — CANCELED wins over the skipped handling.
- **PRESERVE** `@AC-9 @feature-343` (`services/xstockstrat-ui/acceptance/backtest-inline-backfill.feature`) — a skipped-only chunk is not a failed chunk.
- **EXTEND** `@AC-1`, `@AC-2`, `@AC-7`, `@AC-8` `@feature-148` (`services/xstockstrat-agent/acceptance/mcp-watchlist-tools.feature`); **PRESERVE** `@AC-5`, `@AC-6`, `@AC-9` (same file).
- **EXTEND** `@AC-8 @feature-127` (`services/xstockstrat-ui/acceptance/consolidate-watchlist-signal.feature`); **PRESERVE** `@AC-1`..`@AC-3 @feature-181` (`services/xstockstrat-ui/acceptance/watchlist-readiness-list-ux.feature`).
- **PRESERVE** `@AC-1`, `@AC-5`, `@AC-8` `@feature-242` (`services/xstockstrat-notify/acceptance/fix-push-untargeted-broadcast.feature`) — an untargeted alert is pushed to admin devices only.
- **PRESERVE** `@AC-1`, `@AC-6` `@feature-291` (`services/xstockstrat-marketdata/acceptance/fix-marketdata-dead-symbol-ingest.feature`), `@AC-33` and the other `@feature-347` scenarios (`services/xstockstrat-marketdata/acceptance/alpaca-adaptive-rate-limit.feature`) — the 291 hold is a different state from the 352 flag.
- No durable scenario defines "PARTIAL derives from failed_symbols", the `get_backfill_status` return shape, the "Signals" removal path or a symbol profile; 352's own scenarios become those guards.
- The product spec's Design Input expecting CHANGE scenarios in the portfolio and agent `filter-otc-symbols.feature` suites does not hold: only marketdata `@AC-15` changes.

## Dependencies

- Proto/RPC (next free numbers): `WatchlistBinding` 4, `Watchlist` 11 (`packages/proto/portfolio/v1/portfolio.proto:243,258`); `BackfillJob` 16 (`packages/proto/ingest/v1/ingest.proto:33-50`); `BackfillBarsResponse` 4, `BackfillFundamentalsResponse` 3, `SymbolServability` 4, `GetSymbolServabilityResponse` 3 (`packages/proto/marketdata/v1/marketdata.proto:161,316,417,423`); `UnservableReason` (`packages/proto/common/v1/common.proto:150`). `ListAllWatchlistSymbolsResponse` is bare `repeated string symbols = 1` (`portfolio.proto:375`).
- Migration: marketdata `010`, ingest `017`, config `054` (053 claimed by feature 345), portfolio `019` only if the design stores anything there.
- Config keys: one new `marketdata` int key (confirmation window, default 5); existing `assets.refresh_interval_hours` sets the detection cadence.
- Inter-service edges today: portfolio → marketdata (`GetSymbolServability`), marketdata → notify, marketdata → ledger, analysis → portfolio (`ListWatchlists`, `GetWatchlist`, `ListAllWatchlistSymbols`), ingest → marketdata (`BackfillBars`, `BackfillFundamentals`). **No marketdata → portfolio edge**; marketdata has no `PORTFOLIO_ENDPOINT` (`docker-compose.yml:261-295`).
- New env vars / ports: none needed if portfolio pulls from marketdata; a marketdata → portfolio push would need `PORTFOLIO_ENDPOINT` in the marketdata blocks of `docker-compose.yml`, `.do/app.dev.yaml`, `.do/app.yaml`, and a new `{callerID, rpc}` grant in portfolio `authz.go`.

## Risks / Not-found

- **No trading calendar exists in marketdata** (no Alpaca `/v2/calendar` client; `estimateExpectedBars` `marketdata_service.go:1590-1616` counts weekdays only). D-13 needs trading days; the spec's interim assumption "marketdata's existing market calendar" has nothing behind it.
- **Marketdata does not know which symbols are on watchlists** (no watchlist concept, no portfolio client). FR-1 says "on at least one watchlist".
- **Warm-set re-add (N1).** `markWarm` (`:1167`) is ungated and is how held positions stay quoted; a flagged symbol removed from the warm set is re-warmed by the next `GetLatestQuotes`. AC-8 vs 282 `@AC-16`/`@AC-26`/platform `@AC-17`.
- **Replace-all drop (N2).** A name-only replace-all through the agent drops a stored unservable symbol (282 `@AC-19`), which removes a flagged symbol from a user list without the user asking (FR-4).
- **Webhook key set (N3).** Adding per-symbol outcome or reason to the fan-out payload changes 334 `@AC-30`.
- **No per-symbol outcome storage in ingest**; two separate terminal-status code paths (fundamentals `servicer.py:705`, bars `:827`); `_resume_job` (`:890-916`) restarts `state` and does not re-accumulate failed symbols of chunks completed before a restart.
- **The agent omits proto3 default values** in watchlist dicts (`client.py:377`): `delisted: false` would be absent unless the tool sets it.
- **Alert once-per-transition must be decided by the emitter from persisted state**: notify has no idempotency key and its dedup covers external fanout only, in memory, for 300 s.
- **Flagged-symbol filtering has three analysis read sites** plus `ListAllWatchlistSymbols`; filtering in portfolio's responses covers all of them, filtering per consumer does not scale.
- **Offline valuation lookback**: a held flagged symbol reads `MARK_SOURCE_NONE` once its last close is older than `marketdata.last_close_lookback_days` (21) — existing behavior (`services/xstockstrat-portfolio/internal/service/offline_valuation.go:287-300`), not caused by this feature.
- **`symbol_classification` is a Type-2 SCD with NOT NULL sector columns** — not a fit for a one-row-per-symbol profile.
- Not examined: `telemetry_allowlist_test.go` contents, `scripts/config-wiring.json`, `.do/app.yaml` marketdata block detail, `PLAT-4` full text, feature 322's proto edits and feature 317's file list.
- Ledger traps that apply: migration numbers must be chosen from `git log --all` and every `origin/feature/*` tail (fails.md:3814); seed migration and reader land in the same commit, gate with `check-config-wiring.mjs --final` (fails.md:3772, 3829); every `except`/`continue` in a per-symbol loop must record an outcome when an aggregate status gate changes (fails.md:3573); a tool-response change updates `tools.py`, the agent CLAUDE.md, `docs/runbooks/mcp-tools.md` and the strat-lab skill in one PR (fails.md:306); confirm `git diff packages/proto/gen/` is limited to touched protos after buf-gen (fails.md:2167); an additive field enabling a destructive behavior defaults to the non-destructive state when absent (insights.md:4308); recompute a cross-service removal decision inside the write, one deleter per resource (insights.md:3762, 4297); check the dependency-graph direction before adding an edge (insights.md:423); a staleness window is a bounded config key with boundary tests (insights.md:4208, 4362).

## Recommended Scope

1. Proto: marketdata (profile read contract; per-symbol backfill outcomes), ingest (`BackfillJob` per-symbol outcomes), portfolio (`WatchlistBinding` delisted state) + buf-gen.
2. Marketdata: migration `010` profile table + repo; trading-day source; detection hook after `:135`; warm-set removal; config key + seed `054`; alerts.
3. Marketdata: backfill `skipped` outcome and reasons in both `Backfill*` RPCs; metric outcome.
4. Ingest: migration `017`, status rule in both paths, `job_row_to_proto`.
5. Portfolio: learn flagged symbols, remove from system-managed lists, decorate bindings on every read, filter `ListAllWatchlistSymbols`.
6. Analysis: skip flagged bindings at the read sites (if not covered by portfolio).
7. Agent: tool mapping + docstrings, `mcp-tools.md`, strat-lab skill.
8. UI: row marker, fixtures, e2e.
9. Docs: marketdata CLAUDE.md, MARKETDATA-16, 282 scenario change.
