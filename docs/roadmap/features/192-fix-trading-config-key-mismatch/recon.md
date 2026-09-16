# Recon: fix-trading-config-key-mismatch

**Created**: 2026-09-15
**From**: product-spec.md
**Affected services**: xstockstrat-trading (primary), xstockstrat-portfolio, xstockstrat-marketdata, xstockstrat-config

---

## Objective

The trading service rejects every exposure-increasing order with `trading halted:
platform.trading_state=HALTED` regardless of the real config value, because its config getters never
resolve the live value and fall to a fail-closed default. Root cause is a config key-contract
mismatch (Constitution CONFIG-9): consumers read **full-dotted** getter strings against a WatchConfig
snapshot keyed by the **raw namespace-relative `key` column**, and the trading watcher never
subscribes to the `platform` namespace at all. Fix so `platform.trading_state`/`platform.maintenance_mode`
and the deviating `trading.*`/`portfolio.*`/`marketdata.*` keys are actually honored, with a read-path
regression test that would have caught it.

## Runtime evidence (staging, deployment `042f44a6-…`, tag `968281f`)

- `xstockstrat-config` log: `New WatchConfig subscriber namespace=trading` — trading subscribes to
  the **`trading` namespace only**. No `platform` subscriber exists (Go/Node/Python all confirmed).
- `xstockstrat-config` log: **every** `Broadcast config update namespace=platform env=staging
  subscribers=0`, including the one at `2026-09-15T07:39:19.030` — the `platform.trading_state=ACTIVE`
  write made during triage reached **zero** subscribers. Empirical proof of the namespace fault.
- `get_config(platform)` → `trading_state` (bare); `get_config(trading)` → `risk.sizing_enabled`
  (bare). Confirms the server streams bare namespace-relative keys for these namespaces.

## Codebase Map

- **`xstockstrat-trading`** (Go)
  - Watcher: `internal/config/config.go` — `NewWatcher` `:75`; `stream()` WatchConfig request `:125-131`
    (`Namespace: w.namespace`, `Environment`, no `trading_mode`); snapshot stored **verbatim** `:144`
    (`w.snapshot = snap.Values`), delta merge `:146-148`; getters do a raw `w.snapshot[key]` lookup
    with **no transform** — `GetString :170`, `GetInt :177`, `GetBool :187`, `GetFloat :199`.
  - Namespace wiring: `cmd/server/main.go:61` → `config.NewWatcher(cfg.ConfigEndpoint, "trading", …)`;
    `WaitForSnapshot :67` (90s).
  - Kill-switch gate: `internal/service/trading.go` — `parseTradingState :3207` (default→`HALTED`),
    `currentTradingState :3220-3221` (`GetString("platform.trading_state","HALTED")`),
    `checkTradingStateForPlaceOrder :3249` (called `:400`), `checkTradingStateForReplace :3280`
    (called `:1243`), HALTED message `:3254`/`:3285`.
  - Writer: `escalateSystemic :1898` → `SetConfig(..., {Namespace:"platform", Key:"trading_state",
    Value:"REDUCE_ONLY"})` `:1903-1910` — bare key, writer/reader asymmetry.
  - Getter call-sites (≈28 distinct keys) across `internal/service/trading.go` and `order_intent.go`:
    `platform.maintenance_mode` `:344`, `platform.trading_state` `:3221`; `trading.risk.*`
    (`:414,:422,:604,:2846,:2977-2979,:3048,:3095`), `trading.approval.*` (`:465,:466`),
    `trading.reconciliation.*` (`:1652-1654,:2183`), `trading.broker.*` (`:2173,:2329,:2833,:3301`),
    `trading.fill_poller.interval_ms` (`:1482,:2592`), `trading.position_sync.interval_ms` (`:2049`),
    `trading.credential_health.interval_ms` (`:2381`), `trading.order.*` (`:2563,:2564`),
    `trading.order_intent.*` (`order_intent.go:98,:115`).
  - Last service migration: `migrations/009_offline_position_baselines.up.sql` (no config-value seed
    here — trading's config keys live in xstockstrat-config).
  - Doc: `services/xstockstrat-trading/CLAUDE.md` § "Config Keys Consumed" lists `platform.*` keys and
    claims all keys are served by namespace `trading` — a contradiction to update.

- **`xstockstrat-portfolio`** (Go) — identical watcher: `NewWatcher :62`, verbatim store
  `config.go:213`, raw getters `:111/:125/:139/:169`; namespace `"portfolio"` at `cmd/server/main.go:46`.
  Keys: `portfolio.snapshot.interval_minutes` (`portfolio_service.go:706`), `portfolio.risk.max_drawdown_pct`
  (`:777`), `portfolio.risk.concentration_limit_pct` (`:778`), `portfolio.watchlist.max_per_user`
  (`:1333`), `portfolio.watchlist.max_symbols_per_list` (`:1337`), `portfolio.exposure.factor_map`
  (`config.go:151,156`). Reads **no** `platform.*` key.

- **`xstockstrat-marketdata`** (Go) — identical watcher: `NewWatcher :69`, verbatim store `config.go:228`,
  raw getters `:141/:155/:169/:185`; namespace `"marketdata"` at `cmd/server/main.go:53`. ~20
  `marketdata.*` getters (`cmd/server/main.go:89-193`, `marketdata_service.go:401-1373`), incl. dynamic
  `"marketdata."+s.fundProvider+".enabled"`. Reads **no** `platform.*` key. **Separate `GetSecret`/
  `ResolveSecret` path** (`config.go:113-117`, called `cmd/server/main.go:66`) passes **namespace-relative**
  keys (`"alpaca.api_key"`) with `Namespace`+`Key` sent separately — works, and is **out of scope**
  (must not be disturbed).

- **`xstockstrat-config`** (Node/TS) — `src/grpc/configServiceImpl.ts`: snapshot keyed by bare
  `row.key` (`reloadAll :161-170`, `reloadNamespace :185-194`, `resolveOverlayValues :216-223`,
  `toProtoSnapPayload :45-54`); single-namespace subscription (`watchConfig :262-285`, filter `:245`
  `sub.namespace !== namespace`); `SetConfig` stores `key` verbatim (`:387`), ON CONFLICT
  `(namespace,key,environment,COALESCE(user_id,''))` (`:487-499`), `pg_notify('config_changed',
  {namespace,key,environment,user_id})` (`:500-502`). Internal-caller allowlist `platform`/`trading_state`
  at `src/grpc/authz.ts:69`. Last migration: `migrations/028_analysis_opportunity_keys.up.sql` →
  **next = 029**.
  - Seed key formats (mixed convention, confirmed): **namespace-relative** — `011_platform_trading_state`
    (`'platform','trading_state'`), `012_trading_risk_sizing` (`'trading','risk.sizing_enabled'`, …),
    `013_trading_risk_bracket` (`'trading','risk.bracket_orders_enabled'`, …), `025_ingest_mcp_client_keys`
    (`'ingest','mcp_client.*'`). **Full-dotted** — `026_analysis_engine_blend_keys`
    (`'analysis','analysis.engine.*'`), and per its comment `021_notify_push_min_severity`.

## Patterns to REUSE

- **Two-operand bare/dotted probe** → `lookupScalarBounds` at `configServiceImpl.ts:133-135`
  (`REGISTRY[key] ?? REGISTRY[`${namespace}.${key}`]`), reused at `:411,:528`. Prior art for tolerating
  both key forms at an edge without a data migration.
- **CONFIG-9 seed↔reader match** → the established rule (`services/xstockstrat-config/docs/context-constitution.md:26`):
  the stored `key` column must equal the consumer's literal getter string. The fix aligns the two,
  it does not invent a new convention.
- **Migration idempotency** → seed migrations use `ON CONFLICT … DO NOTHING`; a key-rewrite migration
  should be idempotent (`WHERE key NOT LIKE namespace||'.%'`) and ship a real `.down.sql` (F-01/C-07).
- **Read-path test shape** → each service's `internal/config/config_test.go` already has a
  `newTestWatcher`/populated-snapshot harness (portfolio `:57-131`, marketdata `:132-140`, trading via
  the fake client) — extend it to assert a getter resolves a realistically-keyed snapshot (the missing
  RED test), rather than building a new harness.
- **GetSecret asymmetry** → marketdata already resolves namespace-relative keys via a separate
  `Namespace`+`Key` RPC (`config.go:113-117`); a namespace-aware subscription for the WatchConfig path
  can mirror that separation of namespace from key.

## Existing Business Rules (preserve / extend)

- **PRESERVE** `@AC-1` "dead `getEnvBool` gone from the Go config packages" (`docs/sdd/business-rules/platform.feature`, `@feature-175`) — the fix edits trading/portfolio/marketdata `internal/config`; they must still compile/lint/pass and not reintroduce `getEnvBool`.
- **PRESERVE** `@AC-12` "trading_mode rows collapse deterministically; config resolves full-dotted `platform.trading_state`→HALTED per environment" (`services/xstockstrat-config/acceptance/config-secrets-and-scoping.feature`, `@feature-147`) — consume without changing config-side resolution.
- **PRESERVE** `@AC-2` "WatchConfig snapshot keyed by full-dotted `marketdata.fmp.api_key`, redacted" and `@AC-13` "per-user overlay resolves full-dotted `portfolio.watchlist.max_per_user`" (`config-secrets-and-scoping.feature`, `@feature-147`) — **these keys are already full-dotted and working**; the fix must not re-key them to bare and must not weaken redaction/overlay.
- **PRESERVE** `@AC-10` "`WatchConfigRequest` carries `environment`, no `trading_mode`" (`@feature-147`) — any subscription change keeps the request shape.
- **PRESERVE** `@AC-1` "`config.config_values.key` holds the full dotted form" (`services/xstockstrat-config/acceptance/opportunity-config-operability.feature`, `@feature-184`) — **central seam**: the durable contract for the `@feature-147/184` keys is full-dotted storage. Aligning the consumer (or the deviating older seeds) to full-dotted PRESERVES it; re-keying the config-service snapshot/DB *to* bare would be a **CHANGE** requiring sign-off.
- **PRESERVE** `@AC-1` "drawdown breach alerts from live `portfolio.risk.max_drawdown_pct`" (`services/xstockstrat-portfolio/acceptance/drawdown-enforcement.feature`, `@feature-172`) — the fix *restores* this from the silent-default fallback; must end green.
- **PRESERVE** `@AC-2` "higher confidence → larger auto-sized position, reading `trading.risk.*`" (`services/xstockstrat-trading/acceptance/wire-signal-confidence-to-position-sizing.feature`, `@feature-110`) — sizing will now read live values; monotonicity must survive.
- **PRESERVE** `@AC-6/@AC-7` "marketdata resolves vendor creds via `GetSecret`, not env" (`services/xstockstrat-marketdata/acceptance/config-secrets-and-scoping.feature`, `@feature-147`) — distinct path; the watcher refactor must leave it intact.
- **Coverage gap (report, not invent):** no durable `@AC-*` guards the `platform.trading_state`
  HALTED/REDUCE_ONLY **order-blocking gate** itself — it lives only in trading's CLAUDE.md. This
  feature's `acceptance.feature` (AC-1..AC-3) is the new guard (C-15/C-16).
- No **CHANGE** intended; where uncertain, default PRESERVE.

## Dependencies

- Proto/RPC: none anticipated (no `.proto` change; the fix is config-data + watcher wiring).
- Migration: next number **029** for `services/xstockstrat-config/migrations/` (if the seed-alignment
  path is chosen). None in the Go services.
- Config keys: existing keys only — `platform.trading_state`, `platform.maintenance_mode`,
  `trading.*`, `portfolio.risk.*`/`snapshot.*`, deviating `marketdata.*`. No new keys; **no
  `value_type` change** (fails.md:346).
- Inter-service edges: trading→config `WatchConfig` (add a `platform` subscription); trading→config
  `SetConfig` writer (`escalateSystemic`).
- New env vars / ports: none.

## Risks / Not-found

- **Mixed key formats within a namespace** (scenario-recon central seam): some keys already full-dotted
  and working (`portfolio.watchlist.max_per_user`, `marketdata.fmp.api_key`, `analysis.opportunity.*`),
  others bare and broken (`trading.risk.*`, `platform.*`, `portfolio.risk.*`). A blanket "prefix the
  namespace in the watcher" would **double-prefix and corrupt** the already-full-dotted keys — the
  design must not assume a namespace is uniformly one format. **Which specific portfolio/marketdata
  seed rows are bare vs full-dotted is not yet enumerated per-row** (Not found — needs a config
  `db_execute_sql`/migration audit, currently the postgres-mcp co-process is down).
- **Writer symmetry:** `escalateSystemic` hardcodes `Key:"trading_state"` and the `authz.ts:69`
  allowlist keys on `platform`/`trading_state`; any move to full-dotted `platform.trading_state` must
  update both, or the reconciliation escalation writes a row the reader can't see.
- **Namespace delivery is orthogonal to key format:** even a correctly full-dotted `platform.trading_state`
  won't reach trading unless trading subscribes to the `platform` namespace. Config supports only
  single-namespace subscriptions (`req.namespace`), so a multi-namespace consumer opens N streams and
  merges — a real watcher-structure change (trading only; portfolio/marketdata read no `platform.*`).
- **Per-service copied watcher:** `internal/config/config.go` is duplicated in all three Go services
  (no shared module). A watcher-code fix is applied ×3 (or motivates extracting a shared module —
  weigh against C-18/YAGNI for a bug fix).
- **Missing read-path test** in all three services' `config_test.go` (none exercises a getter against
  a realistically-keyed populated snapshot) — the exact gap the bug slipped through (P-06 RED target).
- Ledger traps: **fails.md:344-346** config `value_type` immutable once read (do not widen/retype);
  **fails.md:2005-2014** config registry maps must key on full `namespace.key`; **fails.md:1215-1217**
  verify the native config type at recon (trading_state is `string`); **fails.md:1287-1289** WatchConfig
  must read `value_data`, not `default_value`.

## Recommended Scope (advisory — input to grilling)

Two roughly-separable defects; the debate decides the exact split and whether to fix client vs. seed:
1. **Namespace delivery (Layer A, trading-only):** trading's watcher must receive the `platform`
   namespace (multi-namespace subscription/merge), so `platform.trading_state`/`maintenance_mode`
   resolve. Reconcile the `escalateSystemic` writer + `authz.ts` allowlist with the final key form.
2. **Key-format alignment (Layer B, trading/portfolio/marketdata):** the deviating bare seeds vs.
   full-dotted getters (CONFIG-9). Candidate directions to debate — (B-mig) migration 029 rewrites the
   deviating bare rows to full-dotted (aligns to the @feature-147/184 contract; idempotent, guards the
   already-dotted rows) + fix the one hardcoded writer; (B-read) change the getters to bare (touches
   ≈28 trading + portfolio + marketdata sites + docs, and clashes with the full-dotted contract);
   (B-watcher) namespace-aware key handling in the watcher (risky given mixed formats).
3. **Regression coverage:** a config read-path RED test per touched service (getter resolves a
   realistically-keyed snapshot) + the feature's kill-switch acceptance scenarios (AC-1..AC-3).
4. **Docs:** update the trading/portfolio/marketdata `CLAUDE.md` config-key sections to match reality.
