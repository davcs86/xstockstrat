# Recon: fix-trading-config-plumbing

**Created**: 2026-11-20
**From**: product-spec.md
**Tree**: feature/fix-trading-config-plumbing@3da4293d (≡ origin; origin/main-dev 36aed60b merged)
**Affected services**: xstockstrat-trading, xstockstrat-config (consumer surfaces checked: xstockstrat-ui, xstockstrat-agent — no change, see Dependencies)

---

## Objective

Close four trading config/persistence defects: the IBKR HTTP client ignores `broker.timeout_ms`
(hardcoded 10s); int-documented keys are read with `GetFloat`; `trading.orders.requires_approval` is
always persisted `false`; and `broker.paper` has an environment-derived default that no single-literal
seed can express. **Two of the product spec's premises are stale at HEAD** (see Risks): the getters no
longer return `0` on the other numeric branch, and three of the four keys are already seeded.

## Codebase Map

- **`xstockstrat-trading`** (Go)
  - IBKR client: `internal/broker/ibkr.go:66-68` (`const IBKRRequestTimeout = 10 * time.Second`), `:70`
    `NewIBKRClient(cfg IBKRConfig)`, `:83` `httpClient: &http.Client{Timeout: IBKRRequestTimeout}`;
    `IBKRConfig` `:26-42` (has `Timing func() IBKRTiming`, no timeout field); `httpClient.Do` at
    `ibkr_session.go:304`, `:448`. Handshake bound is separate (`ibkr.handshake_timeout_ms`, `trading.go:2659`).
  - Sole production IBKR construction: `internal/service/trading.go:3355` in `instantiateBrokerLocked`
    (`:3348`; callers `:315`, `:2748`, `:2802`). Clients are cached in `s.brokers` (`:320`, `:2807`) and
    never rebuilt on config change.
  - Alpaca live timeout: `trading.go:3377` `Timeout: func() time.Duration { return brokerCallTimeout(s.cfgW) }`;
    `broker/alpaca.go:25-26` (read before every request), `:33` `defaultTimeoutMs = 5000`, `:56`
    `&http.Client{}` (no client timeout), `:75-81` `timeout()`, `:91`/`:127` `context.WithTimeout`.
  - `brokerCallTimeout`: `trading.go:2634-2640` — `GetFloat("broker.timeout_ms", 5000)`, the key's sole
    reader (callers `:1480`, `:2169`, `:2572`, `:2645`, `:3377`, `order_intent.go:110`).
    `alpacaCallContext` skips IBKR accounts (`trading.go:1474-1481`).
  - `staleThreshold`: `internal/service/order_intent.go:109-117` — floor = max(broker ms,
    `IBKRRequestTimeout`), × `order_intent.stale_multiplier`; `rateLimitBudget` `:100-105`
    (`max(t, stale-2*t)`). Test re-derives the formula: `order_intent_test.go:153-180`.
  - Getters: `internal/config/watchcore.go:393` `GetInt` (int branch only; else WARN + default), `:406`
    `GetFloat` (float, or int widened; else WARN + default), `:422` `GetBool`, `:380` `GetString`.
    Tests: `internal/config/config_test.go:447-482` (`TestWatcher_AC12_UniformGetterRule`).
  - Flatten retry: `trading.go:3083-3084` (`int(GetFloat("order.max_retries", 3))`,
    `GetFloat("order.retry_delay_ms", 500)`), loop `:3087`, `submitOrder(..., false, ...)` `:3091`.
  - Approval decision: `trading.go:586-589` (`GetFloat("approval.require_above_qty", 500)`,
    `…notional", 50000)`); `submitOrder` `:599-610` (`requiresApproval` is the 7th param, `:606`; used
    at `:614-615`, `:622`, `:703-708`; never stored on the order). Callers: `:593`, `:3091`,
    test `trading_order_state_audit_test.go:763-770`.
  - `UpsertOrder`: `internal/repository/trading_repo.go:53`; INSERT columns `:63-76` (`requires_approval`
    = `$17`); literal `false` bound at `:93`; `ON CONFLICT … DO UPDATE SET` `:77-86` does not touch
    `requires_approval`. Call sites: `trading.go:694`, `:793`, `:882`, `:997`, `:1923`, `:3980`.
    Columns: `migrations/001_orders_hypertable.up.sql:24-26`. Last trading migration: `011`.
  - `broker.paper`: `trading.go:2831` (`environmentIsPaper`) and `:3852` (`resolveTradingMode`), both
    `GetBool("broker.paper", s.cfg.TradingMode == "paper")`. `Config.TradingMode` `config.go:30,46`
    (`TRADING_MODE`, default `paper`); `Config.ApplicationEnv` `config.go:31`; `resolveEnvironment`
    `config.go:100-105`; `s.cfg.ApplicationEnv == "production"` already used at `trading.go:2362`.
- **`xstockstrat-config`** (Node) + wiring tooling
  - Seeds: `approval.*` float — `migrations/001_config_tables.up.sql:57-58`, per-env values from
    `002_config_environment.up.sql:51-57` (production 100 / 10000, staging 500 / 50000 after 017's
    collapse). `broker.timeout_ms` int 5000, `order.max_retries` int 3, `order.retry_delay_ms` int 500 —
    seeded in both environments by `041_heal_config_keys_to_reader_catalog.up.sql` (catalog rows
    `:210`, `:216-217`; seed rule `:349-361`). `broker.paper`: **not seeded** (041 guard `:360`;
    comment `:349`).
  - Catalog: `scripts/config-heal/catalog.tsv:169-180` (`:171` `broker.paper`, empty `code_default`,
    "must never be seeded from this catalog"; `:172` `broker.timeout_ms` description is Alpaca-only
    and says "read at construction" — stale; `:180` quotes the staleThreshold formula).
  - Wiring gate: `scripts/check-config-wiring.mjs` — kinds `:169`, owner regex `:170`, Go getter regex
    `:266`, arm/type rule `:532-533` + `:646-650` (float reader on an int row is tolerated; int reader
    on a float row is `type-mismatch`), `read-unseeded` `:629`, ratchet `:698-712`, `--final` `:939-941`.
    Baseline `scripts/config-wiring.json:5-12`: the single finding is `trading`/`broker.paper`
    `read-unseeded`, owner `defect 2026-11-06-trading-broker-paper-env-derived-default-unseedable`.
  - Last config migration: `055_analysis_live_enrich_ttl_reseed` (no 053). Next free: `056`, provisional
    until merge.
  - `SetConfig` never changes an existing row's `value_type`
    (`src/grpc/configServiceImpl.ts:831-845`); wire encoding `buildConfigValue` `:926-940`.

## Patterns to REUSE

- IBKR live timeout → the Alpaca `Timeout func() time.Duration` closure (`trading.go:3377`,
  `broker/alpaca.go:25-26,75-81`) fed by `brokerCallTimeout`; `IBKRConfig` already carries a live
  `Timing func()` (`ibkr.go:26-42`).
- Environment-derived default → `s.cfg.ApplicationEnv == "production"` (`trading.go:2362`) /
  `resolveEnvironment` (`config.go:100-105`).
- Getter regression test → `TestWatcher_AC12_UniformGetterRule` table (`config_test.go:447-482`) and
  `MustSnapshotWatcher` (`config.go:119`); service-level watchers `snapshotInts`
  (`trading_ibkr_auth_test.go:121-126`), `rateLimitWatcher` (`trading_rate_limit_test.go:47-55`).
- Flatten test → `newFlattenHarness` (`trading_flatten_rejection_test.go:99`), `fakeBroker`
  (`trading_bracket_test.go:26`).
- `requires_approval` bind capture → `newConfirmHarness` + `upsertRequiresApprovalArg`
  (`trading_offline_test.go:1601-1696`); pgxmock repo tests `repository/trading_repo_test.go:273-306`;
  fixtures `internal/testdata/order_rows.go` (C-13).
- IBKR client tests → `ibkrTestConfig` (`broker/ibkr_do_test.go:26`), `lenientIBKRClient` (`:77`).
- Per-environment seed migration → hand-written INSERT-if-absent like
  `054_marketdata_delisting_confirmation_days.up.sql` (+ `delistingConfirmationSeedMigration.test.ts`);
  guarded UPDATE + notify like `055_analysis_live_enrich_ttl_reseed`; helpers
  `src/__tests__/migrationSql.ts`; sentinel `system:config-migration-feature-321`
  (`docs/patterns/config-governance.md:142-144`).

## Existing Business Rules (preserve / extend)

- **PRESERVE** `@AC-12` "A type-mismatched or absent value follows the uniform getter rule" (`services/xstockstrat-trading/acceptance/fix-config-keys-drift.feature:8`) — float-stored read by the int getter returns default + WARN; no silent 0, no silent coercion.
- **EXTEND** `@AC-17` "The broker HTTP timeout changes for existing broker clients without a restart" (same file `:22`) — IBKR must read `broker.timeout_ms` live per request, as Alpaca does.
- **PRESERVE (high risk)** `@AC-27` "An attempt that times out inside a retry stays uncertain" (`services/xstockstrat-trading/acceptance/alpaca-adaptive-rate-limit.feature:88`) — at T=1000 it needs S=30 s (the 10s floor) to allow 2 attempts; dropping the floor gives B=1 s and breaks it.
- **PRESERVE** `@AC-28` "A rate-limited emergency flatten halts the account first and keeps retrying" (same file `:97`) — `order.max_retries`=3 → 4 flatten attempts.
- **PRESERVE** `@AC-23`, `@AC-26`, `@AC-34`, `@AC-35`, `@AC-36` (same file `:62,79,139,148,160`) — Alpaca bounds use the live `broker.timeout_ms`.
- **PRESERVE** `@AC-4`, `@AC-8` (`services/xstockstrat-trading/acceptance/fix-ibkr-request-signing.feature:37,96`) — an IBKR timeout stays `CREDENTIAL_STATUS_UNKNOWN`; a pre-POST session failure stays REJECTED.
- **PRESERVE** `@AC-4/5/7/8/9` (`services/xstockstrat-trading/acceptance/fix-trading-order-state-audit.feature:39,46,54,62,69`) — an intent older than the stale threshold is reclaimed and audited.
- **PRESERVE** `@AC-14` "Every read key has a complete seed row in both environments" (`services/xstockstrat-config/acceptance/fix-config-keys-drift.feature:60`).
- **EXTEND** `@AC-29` "A key whose readers disagree on the default is not seeded" (same file `:111`) — the precedent for 321 `@AC-4`.
- **PRESERVE** `@AC-24` "A row whose stored value differs from the code default is not retyped" (same file `:81`) and `@AC-3/4/5/28` (`:33,43,51,102`) — heals are idempotent, keep operator values, never retype silently.
- **PRESERVE** `@AC-1` "A stored key never repeats its namespace" (`services/xstockstrat-config/acceptance/fix-config-keys-contract.feature:13`).
- **PRESERVE** `@AC-10`, `@AC-12` (`services/xstockstrat-config/acceptance/config-secrets-and-scoping.feature:72,101`) — paper/live is derived from the environment; no `trading_mode` scope.
- **PRESERVE** `@AC-22` (`docs/sdd/business-rules/platform.feature:1197`), `@AC-18` (`:2356`), `@AC-29` (`:1247`) — rendered `TRADING_MODE` is `live` in production, `paper` in staging; a mismatch fails the render.
- **PRESERVE** `@AC-19` (`platform.feature:1422`), `@AC-20` (`:1431`, `:1454`), 278 `@AC-3` (`:819`) — every read key is seeded; no doc or gate may permit an unseeded read key.
- **CHANGE (if `broker.paper` is seeded)** 304 `@AC-14` "The broker.paper defect entry is respelled and stays owned by its defect" (`platform.feature:2095`) — seeding makes the baseline entry STALE, so it must be removed; needs operator sign-off in `context.md`. If the key stays unseeded this is PRESERVE and the every-read-key-is-seeded convention stays knowingly unmet.
- **EXTEND** 295 `@AC-27` "Every language's getters follow the uniform rule" (`platform.feature:1438`) — no trading Go row in its Examples today.
- **PRESERVE** 304 `@AC-17` (`platform.feature:2109`), 304 `@AC-2` (`:2036`) — tests use relative keys and a stored value that differs from the code default.
- **PRESERVE** UI paper/live display: `services/xstockstrat-ui/acceptance/strategy-performance-dashboard.feature:87,93`, `fix-ui-trader-feedback.feature:23,84` — `GetTradingEnvironment` semantics unchanged.
- No existing scenario covers `requires_approval` / PENDING_APPROVAL / `approval.require_above_*`, the IBKR 10s literal, or the trading service's own `TRADING_MODE` fallback. xstockstrat-agent: none.

## Dependencies

- Proto/RPC: none expected. `PlaceOrderRequest.requires_approval = 11` (`packages/proto/trading/v1/trading.proto:126`) is an ignored client input; `ORDER_STATUS_PENDING_APPROVAL = 7` (`:99`); no response message carries `requires_approval` / `approved_*`; no Approve RPC exists.
- Migration: trading — none (columns exist, `001:24-26`). Config — `056` only if `broker.paper` is seeded per environment or a description is rewritten (then regenerate `scripts/config-wiring-stored.json`; CI job `config-wiring-stored`, `.github/workflows/ci.yml:1321`).
- Config keys (all existing): `trading` / `broker.timeout_ms` (int, new reader: IBKR), `order.max_retries`, `order.retry_delay_ms` (int), `broker.paper` (bool, unseeded), `approval.require_above_qty|notional` (float), `order_intent.stale_multiplier` (formula text).
- Inter-service edges: none new.
- New env vars / ports: none. `TRADING_MODE` is set in `docker-compose.yml:17`, `.do/app.dev.yaml:30` (`paper`), `.do/app.yaml:30` (`live`); `APPLICATION_ENV` at `:16` / `:28`.
- Consumer surfaces (C-14): UI shows only the status enum (`OrderFilters.tsx:41`, `orderShared.tsx:22`); agent has no hit. Persisting `requires_approval=true` changes nothing a user sees.
- Copies: `watchcore.go` is byte-identical across trading, portfolio and marketdata (`scripts/check-watcher-copies.py:13-18`) — any getter edit must land in all three.
- Break radius: `NewIBKRClient` is constructed in ~25 test sites (additive field is safe; arity change is not); `UpsertOrder` positional args are pinned in `repository/trading_repo_test.go:273-280,302` and `trading_offline_test.go:1609,1658-1664`; `IBKRRequestTimeout` is used at `ibkr.go:68,83`, `order_intent.go:112`, `order_intent_test.go:175-176`.
- Siblings: 322 leaves `broker.paper` / the `TRADING_MODE` fallback to 321 (`322/product-spec.md:109-110,131`); 311/312/315/347 overlap `trading.go` and `order_intent.go` textually (`merge-order.md:395-402,428-431`).

## Risks / Not-found

- **Stale spec premise (defect 2).** Since feature 295, `GetFloat` widens an int row and a mismatch returns the default + WARN, not `0`; the flatten reads int rows correctly today. Remaining: int-documented keys are read with `GetFloat` (`order.max_retries`, `order.retry_delay_ms`, `broker.timeout_ms`, also `order_intent.sweep_interval_ms`, `credential_health.interval_ms`); no test drives an int row through `flattenAndHalt`. The feature's `@AC-2` may already pass before any change (no RED).
- **Stale spec premise (seeds).** "None of these keys has a seed row" is false: 041 seeded three as `int`. Only `broker.paper` is unseeded, and 041 already prevents a single-literal seed for it.
- **staleThreshold floor.** Making IBKR honour `broker.timeout_ms` invites dropping the 10s floor; 347 `@AC-27` depends on S=30 s at T=1000. The formula is also quoted in `catalog.tsv:180`, trading CLAUDE.md and `config-wiring-stored.json`.
- **`broker.paper` fork.** Per-environment seed (CHANGE to 304 `@AC-14`; production seed `false` differs from a single code default — the "readers disagree" case of 295 `@AC-29`) vs. keep unseeded with the baseline entry (no rule change; convention unmet). No allowlist mechanism exists for a must-not-seed key other than the baseline entry.
- **Fail-paper fallback.** A missing `TRADING_MODE` in production silently trades paper (`fails.md:3456`). `ApplicationEnv` gives the same mapping in all three deployments.
- **`requires_approval` source.** The repo takes `*tradingv1.Order`, which has no such field; a fix needs a new argument or signature (not a proto field, to keep "no proto change"). `approved_by`/`approved_at` have no writer path (no Approve RPC) — writing them is new capability, not a fix.
- **Not found:** any Approve/Reject RPC; any reader of `requires_approval`/`approved_*`; any cache eviction of broker clients on config change; which CI job runs `check-watcher-copies.py` was not located by the trading scout (the config scout places it in the `config-wiring` job, `ci.yml:1295-1319`).
- **Ledger traps:** never change a key's `value_type` in place (`fails.md:342-345`); every getter fix needs a read-path test over a real populated snapshot, a fake getter proves nothing (`fails.md:2357-2360`; 277 synthesis); a blanket heal once flipped `approval.require_above_*` (`fails.md:2362-2365`); watcher copies multiply bugs (`fails.md:2367-2370`); migration-number races and regenerating `config-wiring-stored.json` (`fails.md:3815-3817`, `:4092-4094`); blank-assigned `UpsertOrder` errors (`fails.md:3538`); test doubles whose zero value picks the production branch (`fails.md:4222`); a prose pre-merge gate gets overtaken by the merge (`fails.md:3686-3689`, `:3749-3755`).
- **277 prior art (this feature is recorded as its re-attempt):** scope creep over four rounds demoted it — halt for an operator re-scope the moment the spec must widen; prefer the mechanical wiring guard over a namespace heal (`insights.md:4146-4149`); seeding rows equal to code defaults changes nothing.

## Recommended Scope

1. IBKR: add a live `Timeout func() time.Duration` to `IBKRConfig`, fed by `brokerCallTimeout`; keep the `staleThreshold` result ≥ today's (decide the floor in the debate); paired tests.
2. Accessor discipline: decide between "leave `GetFloat` + add the missing regression tests" and "switch int-documented keys to `GetInt`" (three-copy watcher is untouched either way).
3. `requires_approval`: thread the computed flag into the first `UpsertOrder` insert; pgxmock bind test; `approved_by`/`approved_at` out of scope unless the operator rules otherwise.
4. `broker.paper`: replace the `TRADING_MODE` fallback with the `ApplicationEnv` derivation, and decide seed-per-environment vs keep-unseeded.
5. Docs: trading CLAUDE.md key table + Approval Flow, `catalog.tsv` descriptions, findings; product-spec/acceptance amendments for the two stale premises (operator call).
