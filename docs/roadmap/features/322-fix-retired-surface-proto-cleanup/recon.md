# Recon: fix-retired-surface-proto-cleanup

**Created**: 2026-11-11
**From**: product-spec.md
**Tree**: main-dev@c4fd48b0a ≡ origin/main-dev (no `feature/fix-retired-surface-proto-cleanup` branch yet). The 13 discovery digests carried no stamp. Every load-bearing cite below was re-grepped at this tree.
**Affected services**: packages/proto, xstockstrat-analysis, xstockstrat-indicators, xstockstrat-ingest, xstockstrat-trading, xstockstrat-portfolio, xstockstrat-marketdata, xstockstrat-config, xstockstrat-identity, xstockstrat-ledger, xstockstrat-notify, xstockstrat-agent

---

## Objective

This SEV-3 bug cluster removes leftovers of three retired or drifting contract surfaces:

1. **The `trading_mode` config axis.** Feature 147 retired it, but the watchers in 10 services still plumb it, marketdata still sets an unread `Paper` field, and 8 service `CLAUDE.md` env blocks still list it.
2. **The server-side opportunity sparkline.** Feature 227 moved it client-side, but the durable acceptance clause, proto field 17 and the agent projection remain.
3. **Proto hygiene.**
   - Two request `timeframe` fields are still plain strings.
   - The `common.v1` `Decimal`/`Error` types are orphaned.
   - `SnapshotOfflinePositionsRequest.user_id` is mislabelled.

Every proto change must be non-breaking (deprecate, don't delete). Breaking enum conversions are out of scope.

## Headline recon corrections (premise checks — fails.md 2026-07-29/080)

The product spec makes some claims that the code contradicts:

1. **The config-seed retirement is already done.**
   - Config migration `046_config_dead_rows_prune.up.sql:11-14` (feature 305, status `launched`, `CHANGELOG.md:37`) deletes both keys this spec wants to retire, in production and staging: `analysis`/`opportunity.sparkline_bars` and `marketdata`/`alpaca.paper`.
   - The delete is evidence-gated: a row goes only when its sha256 matches the signed value (`046…up.sql:18-22`). A non-matching row is reported as `unmatched-signed-tuple`, not raised.
   - The spec's "needs a new config migration (048)" is therefore probably moot. Design must decide: no migration, or a follow-up only for a tuple that 046 left unmatched (the live row state needs runtime evidence, which recon cannot see).
2. **`sparkline_bars` is not "bounded".**
   - `grep sparkline services/xstockstrat-config/src/grpc/configServiceImpl.ts` finds nothing in `SCALAR_BOUNDS_REGISTRY`.
   - `setConfigScalarBounds.test.ts:251` already says the key has no registry entry.
3. **`TRADING_MODE` is still a live input in trading** (see Codebase Map). "Finish the removal everywhere" would change trading's paper fallback, and feature 321 owns that semantics.
4. **`BatchGetBarsRequest` has no `timeframe_enum`.** Adding one needs a handler read change, not just a proto edit. The handler currently resolves from the string alone (`marketdata_service.go:787-788`).

## Codebase Map

### `packages/proto`

- **`config/v1/config.proto`**: every `trading_mode` field is already deprecated (`:43,57,106,129,148,165`, header `:14`). No change needed.
- **`analysis/v1/analysis.proto`**: `:626` `repeated SparklinePoint sparkline = 17;` (not deprecated). `SparklinePoint` is at `:660-662`.
- **`indicators/v1/indicators.proto`**: `ComputeIndicatorRequest` is at `:54-61`. `:60` is `string timeframe = 6;`. Fields 1-6 are used, so the next free number is **7**.
- **`marketdata/v1/marketdata.proto`**: `BatchGetBarsRequest` is at `:331-338`. `:333` is `string timeframe = 2;`. Fields 1-6 are used (`allow_partial = 6`), so the next free number is **7**.
- **`trading/v1/trading.proto`**: `SnapshotOfflinePositionsRequest` is at `:334-340`. `:336` is `string user_id = 2; // caller identity (ownership + reconciliation payload)`.
- **`common/v1/common.proto`**:
  - `:21` `message Error` and `:28` `message Decimal`.
  - A repo-wide grep for `common.v1.(Decimal|Error)`, `commonv1.(Decimal|Error)` and `common_pb2.(Decimal|Error)` outside `gen/` returns **zero** references. They are orphaned (confirmed).
  - The `Timeframe` enum is at `:77-85`. Only `TIMEFRAME_1DAY = 4` is requestable.
- Closed-set strings `analysis.proto:174,254,671,879` (`side`, `rating`, `fn`) are out of scope because the change would be breaking. They were not re-verified.

### `xstockstrat-trading` (Go)

`TRADING_MODE` is a **live consumer** here.

- **Env read**: `internal/config/config.go:46` `TradingMode: getEnv("TRADING_MODE", "paper")`.
- **Live readers (keep, or 321 decides)**:
  - `internal/service/trading.go:2727-2730` `environmentIsPaper()`: `s.cfgW.GetBool("broker.paper", s.cfg.TradingMode == "paper")`.
  - `trading.go:3743`, the same fallback inside the `Service.resolveTradingMode` method. That method is the per-order resolver and is not config-axis residue.
- **Dead watcher plumbing**:
  - field `config.go:64` `tradingMode`
  - `NewWatcher(endpoint, applicationEnv, tradingMode string, namespaces ...string)` at `:69`
  - assign `:79`
  - `resolveTradingMode` at `:109`
  - callers `cmd/server/main.go:70,75`
  - The watch request at `config.go:87-93` already omits trading_mode.
- **Tests**:
  - Tied to the dead resolver: `internal/config/config_test.go:522,532-541,627-628,647` (`TestResolveTradingMode`).
  - Fallback fixtures to keep: `config.Config{TradingMode: "paper"}` in `internal/service/trading_offline_test.go:313,590,659,1152,1481` and `trading_ibkr_auth_test.go:287`.
- **SnapshotOfflinePositions**:
  - The handler overwrites `user_id`: `internal/handler/trading.go:89-90` `req.Msg.UserId = extractUserID(ctx)`.
  - The service still reads it: `internal/service/trading.go:1178` `if req.UserId == "" {`.
  - **Marking the field `[deprecated = true]` will trip SA1019 on both lines** (insights 2026-08-06/053).
  - Test helper: `trading_offline_test.go:676`.
- **Docs**:
  - `CLAUDE.md:13,21` describe the env fallback.
  - `CLAUDE.md:298` `TRADING_MODE=paper # paper | live`.
  - The open finding `docs/context-constitution-findings.md:39` covers the dead `NewWatcher` tradingMode and the resolver.
- **Migrations**: the last migration is `011_offline_fees_snapshot_headers`. None is needed.

### `xstockstrat-portfolio` (Go)

- **Dead watcher plumbing**:
  - `internal/config/config.go:27` (field), `:40` (env), `:51` (field), `:56` (`NewWatcher(endpoint, namespace, applicationEnv, tradingMode string)`, with a stale doc comment at `:54-55`), `:66` (assign), `:93-99` (`resolveTradingMode`)
  - caller `cmd/server/main.go:58`
- **Tests**: `internal/config/config_test.go:34-35,42,53-54,193-194,213-224`.
- **BatchGetBars caller**: `internal/service/offline_valuation.go:170-176` sets `Timeframe: "1d"`. This is an in-window reader of the string that becomes deprecated.
- **Not residue — do not touch**: `TradingMode` as the per-position data dimension (`portfolio_service.go`, `portfolio_repo.go`, migration `002_add_trading_mode`, `CLAUDE.md:165`).
- **Docs**: `CLAUDE.md:214` `TRADING_MODE=paper`.

### `xstockstrat-marketdata` (Go)

- **Dead watcher plumbing**:
  - `internal/config/config.go:48` (env), `:59` (field), `:64` (`NewWatcher(endpoint, namespace, applicationEnv, tradingMode string)`), `:74` (assign), `:103` (`resolveTradingMode`)
  - caller `cmd/server/main.go:64`
- **`Paper` write-only vestige**:
  - `cmd/server/main.go:99` `}, cfg.TradingMode == "paper")`
  - `internal/alpaca/client.go:50` `Paper bool`, `:96` `NewLiveClient(settings, paper bool)`, `:98` `ClientConfig{Paper: paper}`, `:113` copies it into the settings-derived `ClientConfig`
  - `grep Paper internal/alpaca/*.go` (non-test) finds only these three lines, so nothing reads it.
- **BatchGetBars handler**: `internal/service/marketdata_service.go:782`. It resolves from `req.Timeframe` only (`:787-788`).
- **Enum-preferred precedent**: `:267` `legacyTf := req.Timeframe //nolint:staticcheck // SA1019 …(053)`, plus `:1499` and `internal/handler/marketdata_handler.go:40,429`.
- **Tests**: `internal/config/config_test.go:116,271,291-302`. The `internal/telemetry/otel_test.go:47` `Setenv` is a negative OTel test; keep it.
- **Docs**: `CLAUDE.md:277` already says TRADING_MODE is unused. There is no `TRADING_MODE=` line. Open findings: `docs/context-constitution-findings.md:12,34`.
- **Migrations**: the last migration is 009. None is needed.

### `xstockstrat-analysis` (Python)

- **Watcher**: `app/config/watcher.py:28` `resolve_trading_mode`, `:47` env read, `:63` `trading_mode=self._trading_mode`.
- **Tests**: `tests/test_config_watcher.py` (`test_resolve_trading_mode_*`) and `tests/test_analysis_servicer.py:508,513` (`w._trading_mode`, `req.trading_mode`).
- **Sparkline**:
  - `grep sparkline app/` returns nothing (confirmed).
  - Tests: `tests/test_analysis_servicer.py:6416` (`_INTENTIONALLY_UNSET` contains `"sparkline"`), `:7417,7440` (`len(opp.sparkline)==0`).
  - Stale docstrings: `tests/test_live_enrich_memo.py:12,29` and `tests/test_opportunities_latency.py:200`.
- **ComputeIndicatorRequest callers** set the string `timeframe`:
  - `app/handlers/servicer.py:1623,1633` (`timeframe="1d"`)
  - `app/services/screener.py:323,389`
  - `app/services/evaluator.py:517`
  - `app/engine/pnl_pattern_consumer.py:129`
- **BatchGetBars caller**: `servicer.py:5675-5677` (`timeframe="1d"`).
- **Acceptance**: `acceptance/opportunities-latency-fix.feature:19` is `@AC-8 @FR-6 @feature-191`. `:24` is the clause to drop.
- **Docs**: `CLAUDE.md:679` `TRADING_MODE=paper`. The `sparkline_bars` config row is also in this CLAUDE.md (per digest; line not re-read).

### `xstockstrat-indicators` (Python)

- **Watcher**: `app/config/watcher.py:30` (resolver), `:52` (env), `:69` (send inside `_build_watch_request` at `:64-70`). Keep `resolve_environment` at `:19-27,51`.
- **ComputeIndicator handler**: `app/handlers/servicer.py:214-241` reads only `indicator`, `values` and `params`. `timeframe` is never read, so the enum field needs **no** server change here.
- **Tests**:
  - `tests/test_config_watcher.py:2-3,23,48-57`.
  - No test calls `_build_watch_request`. The no-network pattern for a new one is `ConfigWatcher.__new__` plus `snapshot_watcher` in `tests/conftest.py`.
  - The telemetry negative tests `tests/test_telemetry.py:10-15,186` stay.
- **Docs**: `CLAUDE.md:250` `TRADING_MODE=paper`.

### `xstockstrat-ingest` (Python)

- **Watcher**: `app/config/watcher.py:40` (resolver), `:59` (env), `:75` (send inside `_build_watch_request` at `:70-76`).
- **Tests**: `tests/test_config_watcher.py:3,21,41-50` and `tests/test_ingest_servicer.py:1280-1288`. Keep `tests/test_telemetry.py:10-15,186`.
- **Docs**: `CLAUDE.md:176`. Open findings: `docs/context-constitution-findings.md:14,47`.
- **Timeframe**: ingest already prefers `timeframe_enum` (`app/handlers/servicer.py:240-274`) and is unaffected by the timeframe changes.

### `xstockstrat-config` (Node)

- **Watcher**: `src/services/configWatcher.ts:8` (`import { Environment, TradingMode }`), `:41-42` (comment), `:51` (`tradingMode: TradingMode.TRADING_MODE_UNSPECIFIED`). This copy is **not** in `scripts/check-watcher-copies.sh`.
- **Last migration**: `047_config_alias_removal_rows.{up,down}.sql`, so the next free number is **048**. Features 321 and 330 also claim config migrations; take numbers in merge order.
- **Seed history**:
  - `alpaca.paper`: seeded at `001_config_tables.up.sql:66` and `002_config_environment.up.sql:65-66`.
  - `sparkline_bars`: seeded at `028_analysis_opportunity_keys.up.sql:99-103`, with a down at `:24`.
  - Both were pruned by `046…up.sql:11-14`.
  - The `028…up.sql:112,115` TTL description belongs to **feature 330**.
- **Docs**: `CLAUDE.md:33,134` already say TRADING_MODE is unused. No change needed.

### `xstockstrat-identity`, `xstockstrat-ledger`, `xstockstrat-notify` (Node)

- **Watchers**: `src/services/configWatcher.ts:8` (import), `:80` (comment), `:89` (`tradingMode: TradingMode.TRADING_MODE_UNSPECIFIED`).
  - These three copies are byte-identical and enforced by `scripts/check-watcher-copies.sh:24-26`.
  - The Go `watchcore.go` and Python `watch_core.py` copies are also listed there (`:14-20`). `config.go` and `watcher.py`, which hold the residue, are **not**.
- **Docs**: `CLAUDE.md` `TRADING_MODE=paper` in identity `:106`, ledger `:138` and notify `:127`.
- **Open findings**: notify `docs/context-constitution-findings.md:45`; identity `:13` and ledger `:4,13` mention trading_mode (long lines, not read).
- **Tests**: the telemetry negative tests (`telemetry.test.ts:18-20`, `telemetry.export.test.ts`) stay. `src/__tests__/configWatcher.test.ts` in each service has no tradingMode assertion, which is where a regression test would go.
- **Migrations**: none needed.

### `xstockstrat-agent` (Python)

- **Sparkline projection**: `app/client.py:899-900` (`if o.sparkline:` → `d["sparkline"] = [...]`). The docstring at `:869` mentions the sparkline gap.
- **Parity guard**:
  - `tests/test_opportunity_projection.py:54-55` asserts the emitted keys equal `Opportunity.DESCRIPTOR.fields_by_name`. `:63` is `test_guard_has_teeth`.
  - Dropping the projection **breaks this guard** unless it explicitly excludes deprecated field 17 (re-read at this tree).
  - The fixture appends a sparkline point at `:45`.
- **Other sparkline tests**: `tests/test_client.py:1287,1311-1312,1337`.
- **SnapshotOfflinePositions caller**:
  - `app/client.py:2521-2523` sets the body `user_id=user_id`; `:2535` sends `x-user-id`.
  - The tool is called at `app/tools.py:2407`.
  - Tests: `tests/test_offline_client.py:193,220,232,262`.
- **Open findings**: `docs/context-constitution-findings.md:35` (sparkline) and `:43` (snapshot `user_id` question).
- **No residue**: no `TRADING_MODE` env, and no `ComputeIndicatorRequest`/`BatchGetBarsRequest` use.

## Patterns to REUSE

- **Timeframe enum sibling**: copy `marketdata.proto:89-92`:
  ```
  // DEPRECATED: use timeframe_enum. Removed in a future release once all callers migrate.
  string timeframe = N [deprecated = true];
  xstockstrat.common.v1.Timeframe timeframe_enum = M;
  ```
  For both requests M = 7.
- **Enum-preferred server read with an in-window legacy read**: `marketdata_service.go:267` (`legacyTf := req.Timeframe //nolint:staticcheck // SA1019 …`) and `timeframe.Resolve(enum, string)`.
- **Deprecated body `user_id`**: copy `trading.proto:144` `string user_id = 2 [deprecated = true]; // DEPRECATED: caller identity resolved from the x-user-id header; body value ignored.`
- **SA1019 on intentional in-window reads**: a scoped `//nolint:staticcheck // SA1019: …` (insights 2026-08-06/053).
  - It applies to `trading.go:1178` and `offline_valuation.go:172`.
  - Python and TS callers that set the field get no lint error, but the agent should stop setting body `user_id`, as its sibling builders already do.
- **Deprecated-field completeness sweep**: run a producer pass, then a reader pass (grep the accessor `\.Timeframe\b`, `\.timeframe\b`, `\.UserId\b`), then an untyped-surface pass (insights 2026-07-29/080).
- **Watcher request without trading_mode**: the Go `config.go:87-93` (trading) and `config.go:74-80` (portfolio) requests already omit it. Mirror them in Python `_build_watch_request` and Node.
- **Shared watcher copies**: edit the three Node `configWatcher.ts` copies byte-identically and run `scripts/check-watcher-copies.sh`.
- **Config retire migration**, if one is needed at all:
  - Copy the `046_config_dead_rows_prune` shape: signed-sha allowlist, `config_values_premigration_296` snapshot, one audit row, marker latch, restoring down. Verification is in `scripts/migration-assertions/config-046.sql`.
  - For annotating instead of deleting, copy the description-only rewrites `016_deprecate_analysis_signal_source_weights_desc` and `032_analysis_zero_trap_descriptions`.
- **Regression test without a network**: Python `ConfigWatcher.__new__` plus `snapshot_watcher` (`tests/conftest.py`); Node: capture the stubbed `watchConfig` request in `configWatcher.test.ts`.

## Existing Business Rules (preserve / extend)

Folded from the scenario-recon digest (keyword grep over every `acceptance/*.feature` plus `platform.feature`).

**CHANGE**

- **CHANGE** `@AC-8 @FR-6 @feature-191` "Live enrichment uses batch RPCs instead of per-symbol calls" (`services/xstockstrat-analysis/acceptance/opportunities-latency-fix.feature:19-25`).
  - Drop only `:24` `And it calls BatchGetBars once for all 30 symbols (sparkline)`. The BatchGetLatestPrice and no-`_bars_fetch_sem` clauses stay.
  - **Operator sign-off is recorded in `context.md` (Session 2026-11-10, operator decisions).** Carry it into design.md.

**PRESERVE: analysis**

- `@AC-7 @FR-5 @feature-191` (Phase 1 compute still uses `BatchGetBars`).
- `@AC-9 @FR-7 @feature-191` (memo TTL; the key is owned by 330).

**PRESERVE: config**

- `@AC-1..@AC-5 @feature-184` (`services/xstockstrat-config/acceptance/opportunity-config-operability.feature`). The header at `:18` already carves out `sparkline_bars`.
- `@AC-1`, `@AC-2`, `@AC-6 @feature-305` (`services/xstockstrat-config/acceptance/config-dead-rows-prune.feature`):
  - delete only with evidence, snapshot and audit
  - an unmatched signed tuple is reported, not raised (this names `alpaca.paper`)
  - replay is a no-op and the down restores the rows
  - Any new retire migration must keep all three.
- `@AC-3`, `@AC-4`, `@AC-5 @feature-305` (`docs/sdd/business-rules/platform.feature`): `deadRowVerdict` for both keys (`scripts/config-wiring.test.mjs:862-879`). Evaluator behavior must not change.
- `@AC-10 @FR-8 @feature-147` and `@AC-12 @FR-10 @feature-147` (`services/xstockstrat-config/acceptance/config-secrets-and-scoping.feature`): WatchConfigRequest carries no `trading_mode`, and no trading_mode axis returns. Removing the watchers' send strengthens these.

**PRESERVE: platform**

- `@AC-1 @FR-1 @regression @feature-171` (`platform.feature`): the OTel Resource carries no `trading_mode` even with `TRADING_MODE=paper`. Keep the negative telemetry tests in every service.
- `@AC-5 @FR-4 @regression @feature-196` (`platform.feature`): deprecation never removes a field or adds `reserved`, and `buf breaking` stays clean. This governs field 17 and the timeframe/user_id deprecations.
- `@AC-3 @FR-6 @regression @feature-196`: `TIMEFRAME_*` members stay defined.
- `@AC-9 @FR-5 @regression @feature-196`: dead request-body `user_id` stays server-ignored, and identity comes from `x-user-id`.
- **Homelab render rule** (`platform.feature` around `:1192-1194,1242`): the render sets `TRADING_MODE` for all 12 app services and rejects a trading `"paper"` injection in production.
  - Removing the env from `docker-compose.yml:17` or `.do/app*.yaml:30` would be an **unflagged CHANGE**.
  - The spec keeps those files untouched, so this stays PRESERVE.
  - The scenario tags were not confirmed.

**PRESERVE: marketdata**

- `@AC-8 @FR-2 @regression @feature-196` (`services/xstockstrat-marketdata/acceptance/proto-deprecated-field-removal-program.feature`): the `Bar` response and persistence contract does not change with a new request enum.
- `opportunities-latency-fix.feature`, `filter-otc-symbols.feature`, `offline-account-full-pnl.feature`: `BatchGetBars` / `allow_partial` behavior is unchanged.

**PRESERVE: trading**

- `@AC-6/7/8/9/15/16 @feature-163` (`services/xstockstrat-trading/acceptance/snapshot-offline-positions.feature`): `SnapshotOfflinePositions` behavior is unchanged by the `user_id` deprecation.

**PRESERVE: agent**

- `@AC-15 @FR-9 @FR-6 @feature-095` (`services/xstockstrat-agent/acceptance/opportunity-live-market-enrichment.feature`): `list_opportunities` keeps `live_price` and omits absent fields.

**PRESERVE: UI and indicators**

- UI sparkline scenarios (`services/xstockstrat-ui/acceptance/opportunity-live-market-enrichment.feature`, `sparkline-ohlc-replacement.feature`): the sparkline is client-side and independent of field 17. The UI is not an affected service, but confirm that no TS consumer reads `sparkline`.
- `ComputeIndicator` result suites (`services/xstockstrat-indicators/acceptance/fix-indicators-formula-correctness.feature`, `services/xstockstrat-analysis/acceptance/analysis-concurrency-offload.feature`): results are unchanged.

**Coverage**

- No suite asserts on `common.v1.Decimal`/`Error`.
- `acceptance/` directories were not individually confirmed for ingest, ledger and notify (glob truncated). The keyword grep reached them.

## Dependencies

- **Proto/RPC**: all changes non-breaking. Run `buf lint`, `buf breaking` and `./scripts/buf-gen.sh`, and commit `gen/` (C-09, proto-freshness).
  - `analysis.proto:626` field 17: add `[deprecated = true]`.
  - `indicators.proto:60`: deprecate field 6 and add `timeframe_enum = 7`.
  - `marketdata.proto:333`: deprecate field 2 and add `timeframe_enum = 7`.
  - `trading.proto:336`: deprecate `user_id = 2`.
  - `common.proto:21,28`: message-level `option deprecated = true;` plus a comment. Confirm buf breaking is safe (unverified).
  - `config.proto` needs no change.
- **Migration**: probably **none** (046 already prunes both keys). If design opts for an annotate or residual-retire migration, the number is `048` in `services/xstockstrat-config/migrations/`, taken in merge order with 321 and 330.
- **Config keys**: `analysis.opportunity.sparkline_bars` and `marketdata.alpaca.paper` already have dead-row prune rows (046), and nothing reads either.
  - Docs residue still describes them as live: `docs/patterns/config-governance.md:153,311,416,549-550`, the analysis `CLAUDE.md` row, `scripts/config-wiring-stored.json` and the `scripts/config-heal/*` fixtures. These come from the digest and were not all re-grepped.
  - No new keys.
- **Inter-service edges**: unchanged.
  - `portfolio → marketdata` and `analysis → marketdata` (`BatchGetBars`).
  - `analysis → indicators` (`ComputeIndicator`).
  - `agent → trading` (`SnapshotOfflinePositions`).
  - Every service `→ config` (`WatchConfig`).
- **New env vars / ports**: none. `TRADING_MODE` is injected through a shared anchor in `docker-compose.yml:17`, `.do/app.dev.yaml:30` and `.do/app.yaml:30`. The spec leaves these unchanged (C-1).

## Risks / Not-found

- **Q1 (trading_mode) is coupled to feature 321.**
  - Trading's `environmentIsPaper` and `resolveTradingMode` method (`trading.go:2730,3743`) read `s.cfg.TradingMode`.
  - Option (a): remove only the dead watcher plumbing in all 10 services and keep trading's `Config.TradingMode` plus its CLAUDE.md lines with the consumer named. This satisfies AC-1's "unless it names the consumer".
  - Option (b): full removal, which changes 321's fallback semantics and the homelab render rule.
  - Recon recommends (a). Design must choose.
- **SA1019 fallout from the deprecations.**
  - Go: `trading.go:1178` (`req.UserId`), `offline_valuation.go:172` (`Timeframe:`) and `marketdata_service.go:787-788` (`req.Timeframe`) will fail golangci-lint once the fields are deprecated. Each needs a migration to the enum or a scoped `//nolint:staticcheck`.
  - Python `DeprecationWarning` behavior for setting deprecated fields was not checked.
- **If BatchGetBars only adds the enum field without changing the reader, the enum does nothing.** Design must decide whether marketdata reads `timeframe_enum` first, mirroring `:267`, and whether the analysis and portfolio callers switch.
  - Caution (fails 2026-07-29/080): if callers switch to enum-only before the server reads the enum, the timeframe resolves to the empty string. The server read must land first, or in the same PR.
- **ComputeIndicator**: the server ignores `timeframe`, so the enum is contract-only. Design should weigh YAGNI (C-18): deprecate the string and add the enum without switching callers, versus switching the six analysis callers.
- **The agent parity guard** (`test_opportunity_projection.py:54-55,63`) must learn the deprecated-field exclusion in the same step that drops the projection.
- **Shared watcher copies**: the three Node copies are CI-checked byte-identical. The config-service copy is outside the check and must be edited separately.
- **Unverified**:
  - The live staging and production state of the four 046 tuples (sha match at apply time).
  - Whether the message-level `option deprecated` on `Decimal`/`Error` passes `buf breaking` under the repo config.
  - Python protobuf behavior on setting deprecated fields.
  - The identity and ledger findings rows' contents.
  - The analysis `CLAUDE.md` `sparkline_bars` row line number.
  - The `platform.feature` homelab TRADING_MODE scenario tags.
- **Overlaps**:
  - `indicators.proto` with 310, `trading.proto` with 312, `config.proto` with 328 (no change here).
  - Config migration NNN with 321 and 330.
  - The `trading.broker.paper` fallback with 321.
  - Proto field number 7 on both requests must be re-checked against 310 and other in-flight branches at `/sdd-spec` (fails 2026-07-29 union-of-refs rule).
- **Findings logs to resolve when fixing**:
  - trading `:39`
  - marketdata `:12,34`
  - ingest `:14,47`
  - notify `:45`
  - agent `:35,43`
  - `packages/proto/docs/context-constitution-findings.md`, which records dead Decimal/Error and the stalled timeframe migration (not read)

## Recommended Scope

These step boundaries are advisory, not binding.

1. **Proto (one PR-unit)**: deprecate field 17; add the timeframe enums (7) to `ComputeIndicatorRequest` and `BatchGetBarsRequest`; deprecate `SnapshotOfflinePositionsRequest.user_id`; deprecate and comment `Decimal`/`Error`. Run buf lint, buf breaking and buf-gen. Lands with the SA1019 `nolint` or reader changes it forces in trading, portfolio and marketdata.
2. **marketdata**: `BatchGetBars` prefers `timeframe_enum` with a legacy string fallback. Delete the `Paper` field, its `NewLiveClient` parameter, and the watcher `tradingMode` plumbing, plus tests and findings rows.
3. **Go watchers, trading and portfolio**: delete the `NewWatcher` tradingMode parameter, field and resolver. Keep trading's `Config.TradingMode` env read for the broker.paper fallback (pending Q1 and 321). Update tests and findings.
4. **Python watchers, analysis, indicators and ingest**: drop `resolve_trading_mode`, the env read and the request field. Add a new regression test asserting `trading_mode` is unset on `_build_watch_request()`. Update the existing tests.
5. **Node watchers**: config, plus the byte-identical identity, ledger and notify copies. Drop `tradingMode` and the import, add a `watchConfig`-request regression test, and run `check-watcher-copies.sh`.
6. **Agent**: drop the sparkline projection and docstring, teach the parity guard about deprecated field 17, and stop setting body `user_id` on the snapshot request. Update tests, the CLAUDE.md caller-identity paragraph and the findings rows.
7. **Analysis acceptance and tests**: apply the `@AC-8` clause drop (signed off), and remove the sparkline asserts and stale docstrings.
8. **Docs**: remove the `TRADING_MODE=paper` lines from seven service CLAUDE.md files (analysis, identity, indicators, ingest, ledger, notify, portfolio). In trading's CLAUDE.md, name the consumer instead. Clean up the config-governance and `sparkline_bars` docs residue.
9. **Config migration 048**: only if design rejects "046 already did it". Otherwise drop it from scope and record the reason in context.md.
