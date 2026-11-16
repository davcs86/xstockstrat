# Recon: alpaca-adaptive-rate-limit

**Created**: 2026-11-16
**From**: product-spec.md
**Tree**: ccr-47ce6aaf-i0ffis@b8e25a1 ≡ origin/main-dev@9f88562 (+ docs-only commits; harness-pinned branch, see context.md)
**Affected services**: xstockstrat-marketdata, xstockstrat-trading, xstockstrat-config

Paths are relative to the named service directory unless they start with `services/`, `scripts/`, `docs/`
or `.github/`.

---

## Objective

Make the Alpaca REST clients in marketdata and trading read `X-RateLimit-Limit/Remaining/Reset`, pace
requests per host and credential before the window runs out, and retry a 429 inside the client (wait for
`Reset`, else 1s doubling backoff with add-only jitter) within the request context and a fixed total wait.
`marketdata.backfill.rate_limit_rps` stays as a ceiling; one seeded bool kill switch per service turns the
behavior off live. Order mutations are retried too and must never double-apply or outlive the
order-intent staleness threshold.

## Codebase Map

- **`xstockstrat-marketdata`** (Go, module `github.com/xstockstrat/marketdata`, `go.mod:1`, go 1.27.0)
  - Entry point: `cmd/server/main.go:64` (`config.NewWatcher(..., "marketdata", ...)`), background loops
    started `cmd/server/main.go:147-157`.
  - Alpaca client: `internal/alpaca/client.go` — `ClientConfig` `:29`, `Settings` `:54`, `Client` `:68`,
    `NewClient` `:81`, `NewLiveClient` `:96`, `conf` `:105` (copies `Settings` field by field `:110-113`),
    `currentLimiter` `:118` (`rate.NewLimiter(rate.Limit(rps), rps)` `:125`, nil when `rps<=0`),
    `Limit` `:134`, `do` `:145-168`, `alpacaOp` `:171`. `httpClient` has a 30s per-attempt `Timeout`
    (`:90`, `:100`).
  - `do` is the only `httpClient.Do` in the package (`:157`); MARKETDATA-4 pins it
    (`docs/context-constitution.md:18`). `internal/alpaca/stream.go` uses `websocket.Dial` (`:277`), not `do`.
  - Eight `c.do(` call sites, all `GET` with a nil body, a fresh request per page: `GetBars` `:273`,
    `GetCashDividends` `:336`, `GetLatestQuote` `:389`, `GetLatestTrade` `:431`, `GetLatestTradesMulti` `:471`,
    `GetBarsMulti` `:519`, `GetLatestQuotesMulti` `:576` (all `DataURL`), `ListAssets` `:623` (`BaseURL`).
    Non-200 format is `"alpaca <op> %d: %s"` in each caller (e.g. `:283`).
  - Config-read pattern: settings closure `cmd/server/main.go:82-99`
    (`RateLimitRPS: int(cfgWatcher.GetInt("backfill.rate_limit_rps", 200))` `:94`); `GetBool` at
    `internal/config/watchcore.go:422` (missing or mistyped → default plus rate-limited WARN).
  - Callers and deadlines (`internal/service/marketdata_service.go`):
    - With a deadline: `GetLatestQuotes` cold fetch `:672` (`quotes.batch_timeout_ms`, 2500),
      `BatchGetLatestPrice` `:946` (`price.batch_timeout_ms`, 2500, bounded `[500,2500]`),
      `BatchGetBars` `allow_partial` `:906-916` (caller deadline minus 250ms).
    - RPC ctx, no added deadline: `GetBars` `:409`, `GetLatestQuote` `:625`, `GetLatestPrice` `:761`,
      `ListAssets` `:1468`, `BackfillBars` `:1526`, dividends `:2338`.
    - No deadline at all (main ctx): warm quote poller `:1236`/`:1253`, bar ingester `:1401`/`:1418`,
      asset refresher `internal/service/asset_servability.go:119` (own 1m→30m backoff).
  - Telemetry: `internal/telemetry/otel.go` — outcomes `:339-352`, `HTTPErrorOutcome` `:375`,
    `RecordVendorRequest` `:389` (**forces outcome `ctx` whenever `outcome != ok` and `ctx.Err() != nil`**,
    `:390-392`; duration only when `sentAt` is non-zero). Label keys are a closed set of five
    (`internal/service/telemetry_allowlist_test.go:28-31`).
  - Tests: `internal/alpaca/client_test.go` is the external package `alpaca_test`; `makeTestServer` `:23`;
    metric helpers `:636-704`; `TestDo_RecordsOKOutcome_AC13` `:709`, `TestDo_RecordsCtxOutcome_AC13` `:730`,
    `TestLiveClient_RateLimitFollowsSettings_AC32` `:750`. Real time only, no clock seam.
  - Last migration: none relevant (config seeds live in `xstockstrat-config`).
  - CI: coverage threshold 40, `internal/alpaca` counted (`.github/workflows/ci.yml:332-333`, `:374`);
    `go test ./... -race -count=1`, `GOWORK=off`.

- **`xstockstrat-trading`** (Go, module `github.com/xstockstrat/trading`, go 1.27.0)
  - Alpaca adapter: `internal/broker/alpaca.go` — `ClientConfig` `:15-23` (has `Timeout func() time.Duration`,
    no logger, clock or config getter), `Client` `:29-32`, `NewClient` `:34-45` (`&http.Client{}`, no
    timeout), `timeout()` `:47-54`, `do` `:57-66`, `cancelOnClose` `:68-77`, `baseURL()` `:79-84`,
    `setAuthHeaders` `:541-544` (called by each method, not by `do`).
  - `do` applies `context.WithTimeout(req.Context(), c.timeout())` **per attempt** and hands the cancel to
    the response body; a retry loop must close each 429 body or it leaks the ctx.
  - Eight `c.do(` call sites; nothing bypasses `do`:
    `SubmitOrder` POST `/v2/orders` `:189` (body `bytes.NewReader`, so `GetBody` is set; carries
    `client_order_id` `:139`; error `:201`), `CancelOrder` DELETE `:242` (422 → `ErrOrderNotCancelable`
    `:248`), `ReplaceOrder` PATCH `:299` (replayable body, **no idempotency key**), `GetOrder` `:332`,
    `ListOrders` `:383`, `GetPositions` `:426`, `GetAccount` `:484`, `ValidateCredentials` `:525`
    (401/403 → `ErrInvalidCredentials` `:533`). `SubmitBracketLegs` `:548` makes no HTTP call.
  - Sentinels: `internal/broker/broker.go:10` `ErrInvalidCredentials`, `:14` `ErrOutcomeUncertain`,
    `:18` `ErrOrderNotCancelable`. `DeriveBrokerClientOrderID(intentID) = "xss-"+intentID`
    (`internal/broker/clientorderid.go:5`), stable across an in-client retry.
  - Client construction: one `broker.Client` per account, `instantiateBrokerLocked`
    `internal/service/trading.go:3241-3273` (`Timeout: func() ... brokerCallTimeout(s.cfgW)` `:3270`);
    pool `brokers map[string]brokerPoolEntry` keyed by account id (`:138`); replaced on credential update
    (`:2701-2708`), deleted on deregister (`:3155-3157`).
  - Staleness: `computeStaleThreshold` `internal/service/order_intent.go:91-96` (multiplier floor 1.5),
    `staleThreshold` `:100-108` = `max(brokerCallTimeout, IBKRRequestTimeout=10s)` × `stale_multiplier`
    (default 3.0 → 30s; **worst case 15s** at the 1.5 floor). Sweeper `:112-133` reclaims stale PENDING
    intents every `order_intent.sweep_interval_ms` (5000).
  - Intent seam: submit `InsertIntent` `trading.go:623` → broker call `:730` → `FinalizeIntent` `:754`/`:798`;
    cancel `:1334` → `:1383`; replace `:1531` → `:1580`. **No per-call `context.WithTimeout`** around the
    three mutations; the handler adds none (`internal/handler/trading.go:30,36,148`).
  - Error classification: `isUncertainBrokerOutcome` `trading.go:2565-2569` is true for
    `context.DeadlineExceeded`, a `net.Error` timeout, or `ErrOutcomeUncertain`; anything else is a
    definite rejection (`:743`, order REJECTED, intent finalized Rejected). No string matching on
    `"status %d"` anywhere.
  - Callers that loop or bound broker calls: `flattenAndHalt` `trading.go:2908` (loop `:2986-3010`,
    `order.max_retries` 3, `order.retry_delay_ms` 500, **mints a new intent id after a non-uncertain
    error** `:2994-2999`); `reconcileTick` `:2063-2200` (`ListOrders`/`GetPositions` each under
    `WithTimeout(ctx, brokerCallTimeout)` `:2079`, `:2169`; any non-credential error counts toward the
    systemic `REDUCE_ONLY` escalation); `syncPositions` `:2477-2520` (same per-call timeout);
    fill poller `:1822` (sequential `GetOrder`, loop ctx, no per-call timeout);
    `validateAndRecordCredential` `:2735-2739` (5s ctx).
  - Telemetry: `internal/telemetry/otel.go` label-key allowlist `:311-316`; counters `:331-338`; no
    broker HTTP request instrument. `alpaca.go` has no logging; service code uses `slog.WarnContext`.
  - Tests: `internal/broker/alpaca_test.go` (package `broker_test`), `makeTestServer` `:19-25`, client
    pointed at the server via `PaperURL`/`LiveURL`; real-time timeout tests `:227-264`. No clock seam.
  - Constitution: TRADING-3 (`docs/context-constitution.md:17`) — only 401/403 return
    `ErrInvalidCredentials`.
  - CI: coverage threshold 40, `internal/broker` counted (`.github/workflows/ci.yml:330-331`, `:374`).

- **`xstockstrat-config`** (Node.js; config-data migration only)
  - Last migration: `migrations/049_notify_commsgun_channel_keys.{up,down}.sql`; next free is `050`.
  - Stored-key CHECK: `migrations/045_config_keys_relative_check.up.sql:128-129`; write-path rejection
    `src/grpc/configServiceImpl.ts:186`.
  - Current `backfill.rate_limit_rps` description (the guard text for an UPDATE): "Max outbound Alpaca
    REST calls per second. Read at startup into a token-bucket limiter the client waits on before every
    REST call; `0` disables rate limiting." (`scripts/config-wiring-stored.json:2620`, `:2632`).

## Patterns to REUSE

- Single chokepoint for the whole change → `internal/alpaca/client.go:145` `do` (marketdata) and
  `internal/broker/alpaca.go:57` `do` (trading). No call site changes.
- Static ceiling → the existing live-resized `x/time/rate` limiter, `internal/alpaca/client.go:118-131`.
  Trading has no `golang.org/x/time` dependency (its `go.mod`); marketdata has `v0.15.0` (`go.mod:25`).
- Live value into the trading client → the `Timeout func() time.Duration` field pattern
  (`internal/broker/alpaca.go:22`, wired `internal/service/trading.go:3270`); a kill switch is a second
  func field at the same site. Marketdata: a new `Settings` field read in the closure
  `cmd/server/main.go:82-99` and copied in `conf()` `internal/alpaca/client.go:110-113`.
- Explicit-true bool default → `s.fundCfg.GetBool("edgar.enabled", true)`
  (`internal/service/marketdata_service.go:1996`); note a zero-value `Settings`/`ClientConfig` bool is
  `false`, so `NewClient` and test literals default the switch off unless the field is inverted.
- Request replay → IBKR's `req.Clone(ctx)` + `req.GetBody()` resend
  (`internal/broker/ibkr_session.go:412-417`).
- Backoff shape → inline doubling with a cap and `math/rand/v2` jitter,
  `internal/config/watchcore.go:213-225` (equal jitter; add-only jitter is new code). Not exported.
- Injectable time seam → FMP's `ClientConfig.Now func() time.Time` and `HTTPClient`
  (`internal/fmp/fmp_client.go:39-44`, `:87-90`).
- Vendor telemetry → `RecordVendorRequest` with the existing `http_429` / `throttle` outcome values
  (`internal/telemetry/otel.go:339-352`, `:389`); no new label key.
- Config seed → `049_notify_commsgun_channel_keys.up.sql:4-6,55` (relative keys, `updated_by`
  `system:config-migration-feature-<slug>`, `ON CONFLICT (namespace, key, environment,
  COALESCE(user_id, '')) DO NOTHING`), guarded down `049...down.sql:5-18`. Bool is `value_type 'bool'`,
  value `'true'`.
- Description update → `032_analysis_zero_trap_descriptions.{up,down}.sql` (UPDATE guarded on the exact
  old text; down swaps).
- Per-migration test → `src/__tests__/barIngestBackoffSeedMigration.test.ts` with `migrationSql.ts`
  `findOne`; optional `scripts/migration-assertions/<slug>.sql`.
- Registered-keys log → `docs/patterns/config-governance.md` § "Per-Feature Registered Keys" (line 145),
  modelled on the feature 338 entry.

## Existing Business Rules (preserve / extend)

No CHANGE was found. Three rules need the design to act: every wait must end at the request context
(229 @AC-8, 240 @AC-54, 282 @AC-14); a whole broker call must finish below the staleness threshold
(267 @AC-4/@AC-8/@AC-9); the 050 description UPDATE must be guarded (293 @AC-9).

- **PRESERVE** `@AC-8 @regression @feature-229` "A cold-fetch failure returns the warm subset instead of failing the batch" (`services/xstockstrat-marketdata/acceptance/fix-book-portfolio-page.feature`) — GetLatestQuotes cold fetch is bounded by `quotes.batch_timeout_ms`; any in-client wait or 429 retry must end at the context deadline (TIME BOUND).
- **PRESERVE** `@AC-3 @regression @feature-229` "Coalesced quote waiters are not failed by the first caller's cancellation" (same file) — retries stay inside the one detached shared fetch.
- **PRESERVE** `@AC-53 @FR-5 @feature-240` "allow_partial opts in to returning stored bars when the live fetch fails" (`services/xstockstrat-marketdata/acceptance/offline-account-full-pnl.feature`) — strict BatchGetBars returns INTERNAL carrying the live-fetch error; no ResourceExhausted remap.
- **PRESERVE** `@AC-54 @FR-5 @feature-240` "allow_partial budgets the live fetch from the caller's deadline" (same file) — returns within the caller's 1000 ms deadline (TIME BOUND).
- **PRESERVE** `@AC-14 @FR-3 @feature-282` "Partial BatchGetBars still fetches servable cold symbols within the deadline" (`services/xstockstrat-marketdata/acceptance/filter-otc-symbols.feature`) — same deadline guarantee (TIME BOUND).
- **PRESERVE** `@AC-10 @FR-5 @feature-282` "A failed refresh keeps the last good asset set" (same file) — the asset refresher's failure path and backoff survive a rate-limit wait or exhaustion.
- **PRESERVE** `@AC-3 @regression @feature-227` "marketdata logs the vendor error it falls back from" (`services/xstockstrat-marketdata/acceptance/fix-opportunities-read-hangs.feature`) — an exhausted 429 on the multi-symbol trades call is still logged with symbol count and fallback path.
- **PRESERVE** `@AC-3 @FR-3 @feature-178` "Concurrent cold-symbol requests coalesce to one Alpaca fetch" (`services/xstockstrat-marketdata/acceptance/quote-fanout-batching.feature`) — retries must not multiply upstream fetches or break single-flight.
- **PRESERVE** `@AC-5 @FR-1 @FR-4 @feature-291` "Per-symbol fetch errors never count as empty" (`services/xstockstrat-marketdata/acceptance/fix-marketdata-dead-symbol-ingest.feature`) — a rate-limited fetch stays an error so a throttled symbol is never held as dead.
- **EXTEND** `@AC-13 @FR-4 @feature-294` "Vendor requests are counted by bounded outcome without leaking the FMP key" (`services/xstockstrat-marketdata/acceptance/signal-map-instrumentation.feature`) — adds vendor "alpaca" points with `http_429` and `throttle`; no new attribute keys, no credential or symbol in attributes.
- **PRESERVE** `@AC-14 @FR-4 @feature-294` "A backfill of 5 symbols with 2 failures is counted per outcome and returns as before" (same file) — an exhausted rate limit on one symbol is a FailedSymbols entry with a nil RPC error.
- **PRESERVE** `@AC-32 @FR-7 @regression @feature-295` "Marketdata vendor-client settings and analysis's provider read change without a restart" (`services/xstockstrat-marketdata/acceptance/fix-config-keys-drift.feature`) — `backfill.rate_limit_rps` stays live per request.
- **PRESERVE** `@AC-16 @FR-7 @regression @feature-295` "A rotated vendor secret is used without a restart" (same file) — per-credential limiter state follows a rotated key; the key never appears in state keys, logs or errors.
- **PRESERVE** `@AC-7 @FR-6 @feature-147` "A missing Alpaca credential warns but marketdata still starts" (`services/xstockstrat-marketdata/acceptance/config-secrets-and-scoping.feature`) — per-credential keying tolerates an empty credential.
- **PRESERVE** `@AC-3 @FR-1 @feature-304` "Marketdata builds provider keys relative to its namespace" (`services/xstockstrat-marketdata/acceptance/config-keys-relative-consumers.feature`) — the new key is read as `alpaca.adaptive_rate_limit_enabled`.
- **PRESERVE** `@AC-17 @FR-7 @regression @feature-295` "The broker HTTP timeout changes for existing broker clients without a restart" (`services/xstockstrat-trading/acceptance/fix-config-keys-drift.feature`) — per-attempt timeout stays live; the FR-8 total bound is derived from the live timeout (TIME BOUND).
- **PRESERVE** `@AC-12 @FR-11 @regression @feature-295` "A type-mismatched or absent value follows the uniform getter rule" (same file) — a per-request kill-switch read must be seeded so it does not WARN on every call.
- **PRESERVE** `@AC-1 @FR-1 @regression @feature-267` "A failed order-state write after a broker timeout is logged" (`services/xstockstrat-trading/acceptance/fix-trading-order-state-audit.feature`) — a broker timeout leaves the order NEW (uncertain), including a timeout inside a retry loop.
- **PRESERVE** `@AC-2 @FR-2 @regression @feature-267` "A failed order-state write after a broker reject is logged" (same file) — a definite reject leaves REJECTED; design must classify an exhausted 429 on submit explicitly.
- **PRESERVE** `@AC-3 @FR-3 @regression @feature-267` "A failed final write in CancelOrder is logged" (same file) — a retried cancel yields exactly one CANCELED write.
- **PRESERVE** `@AC-6 @FR-4 @regression @feature-267` "A failed final write in ReplaceOrder is logged" (same file) — a retried replace has a single effect.
- **PRESERVE** `@AC-4 @FR-5 @regression @feature-267` "A reactive stale-intent reclaim is audited like a sweeper reclaim" (same file) — ORDER SAFETY: total broker-call time, retries included, stays below the stale threshold, or the intent is reclaimed mid-flight and a duplicate submit becomes possible.
- **PRESERVE** `@AC-8 @FR-5 @regression @feature-267` "A reactive stale-intent reclaim in CancelOrder is audited" (same file) — same bound for cancel.
- **PRESERVE** `@AC-9 @FR-5 @regression @feature-267` "A reactive stale-intent reclaim in ReplaceOrder is audited" (same file) — same bound for replace.
- **PRESERVE** `@AC-5 @FR-1 @feature-294` "Trading records the broker submit outcome as a bounded value" (`services/xstockstrat-trading/acceptance/signal-map-instrumentation.feature`) — the outcome set is closed and no error text goes into attributes.
- **PRESERVE** `@AC-45 @FR-1 @feature-294` "Repeated systemic escalation is countable and the broker label covers IBKR" (same file) — rate-limit errors in `reconcileTick` count as account errors as today; waits must not cause a false systemic escalation.
- **PRESERVE** `@AC-6 @FR-2 @feature-294` "A loop writes one record per successful tick and none for a failed tick" (same file) — a rate-limited `GetOrder` is a failed tick.
- **PRESERVE** `@AC-1 @FR-1 @FR-6 @feature-304` "Trading gates an order on the platform key read through its platform watcher with the alias off" (`services/xstockstrat-trading/acceptance/config-keys-relative-consumers.feature`) — the new key is read relative on the trading watcher.
- **EXTEND** `@AC-14 @FR-5 @regression @feature-295` "Every read key has a complete seed row in both environments" (`services/xstockstrat-config/acceptance/fix-config-keys-drift.feature`) — both new keys need a complete seed row in staging and production.
- **EXTEND** `@AC-27 @FR-1 @FR-5 @feature-282` "Both new keys are seeded at their code defaults by config migrations" (`services/xstockstrat-config/acceptance/filter-otc-symbols.feature`) — 050 follows insert-if-absent global rows; down deletes only global rows.
- **PRESERVE** `@AC-9 @FR-2 @regression @feature-293` "The seed never overwrites operator-written metadata" (`services/xstockstrat-config/acceptance/fix-analysis-live-loop-budget-seed.feature`) — the 050 description update must not overwrite an operator-edited description.
- **PRESERVE** `@AC-4 @FR-2 @feature-293` "Applying the seed migration twice leaves one row per environment" (same file) — 050 is replay-safe.
- **PRESERVE** `@AC-7 @FR-6 @feature-293` "Rolling back the seed keeps an operator-set value" (same file) — 050 down keeps operator-set values and per-user overrides.
- **PRESERVE** `@AC-1 @FR-1 @regression @feature-296` "A stored key never repeats its namespace" (`services/xstockstrat-config/acceptance/fix-config-keys-contract.feature`) — both new stored keys are namespace-relative.
- **PRESERVE** `@AC-2 @FR-2 @feature-306` "SetConfig updates exactly the stored row" (`services/xstockstrat-config/acceptance/config-keys-alias-removal.feature`) — the kill switches are settable by their relative key.
- **PRESERVE** `@AC-3 @FR-1 @feature-278` "A key that code reads but no migration seeds is reported as unseeded" (`docs/sdd/business-rules/platform.feature`) — readers and seed land together.
- **PRESERVE** `@AC-19 @FR-13 @regression @feature-295` "The config-wiring gate keeps only 296-owned dead rows and rejects new drift" (`docs/sdd/business-rules/platform.feature`) — bool readers match the seeded bool value_type.
- **PRESERVE** `@AC-41 @FR-15 @feature-294` "No new label can carry an identifier and registered signals are untouched" (`docs/sdd/business-rules/platform.feature`) — no host, credential, symbol or order id as a label.

## Dependencies

- Proto/RPC: none.
- Migration: next number `050` for `services/xstockstrat-config/migrations/` (also named by 341, 343,
  330; re-derived at execute, see `docs/roadmap/features/merge-order.md`). No service-schema migration.
- Config keys: new `marketdata.alpaca.adaptive_rate_limit_enabled`,
  `trading.broker.adaptive_rate_limit_enabled` (bool, `true`); existing
  `marketdata.backfill.rate_limit_rps` (description change), `trading.broker.timeout_ms`,
  `trading.order_intent.stale_multiplier` (read for the bound).
- Generated inventory: `scripts/config-wiring-stored.json` must be regenerated with
  `scripts/config-wiring-stored.py` (CI `config-wiring-stored`, `.github/workflows/ci.yml:1250-1293`);
  no `scripts/config-wiring.json` baseline entry and no `SCALAR_BOUNDS_REGISTRY` entry for a bool.
  `--declared-from` reads the spec's `## Config Key Changes` backticked keys.
- CI gates touched: `go-lint` (both Go services), `migration-rerun` (`ci.yml:898`),
  `migration-contract-gate` (`:938`), `config-wiring` (`:1222`), `config-wiring-stored` (`:1250`).
- Go modules: trading would gain `golang.org/x/time` only if the design uses `rate.Limiter` there
  (`go.mod`/`go.sum` change). No shared non-proto Go module exists; `go.work` lists the proto module and
  the three Go services, and CI runs `GOWORK=off`.
- Inter-service edges: none new.
- New env vars / ports: none.
- Docs to update: `services/xstockstrat-marketdata/CLAUDE.md` (`:62` row, new key row, `:141` outcome
  list only if a value is added), `services/xstockstrat-marketdata/docs/context-constitution.md:18`
  (MARKETDATA-4), `services/xstockstrat-marketdata/docs/alpaca-integration.md`,
  `services/xstockstrat-trading/CLAUDE.md` (broker rows; `broker.timeout_ms` row says "read at
  construction" but the code reads it live), `docs/patterns/config-governance.md` registered-keys log.

## Risks / Not-found

- **Spec vs code conflict (telemetry).** FR-9 and AC-21 say a rate-limit wait cut short by the context
  records outcome `throttle`. `RecordVendorRequest` forces `ctx` whenever the context has errored
  (`internal/telemetry/otel.go:390-392`), and the service CLAUDE.md documents "`ctx` wins". Today's
  limiter-wait failure at `internal/alpaca/client.go:152` already passes `throttle` and is recorded as
  `ctx`. Design must either keep the precedence (and amend FR-9/AC-21 to `ctx`) or change it with a
  recorded sign-off.
- **Uncertain-outcome misclassification (trading).** A retry loop that ends on
  `context.DeadlineExceeded` is classified "uncertain" by `isUncertainBrokerOutcome`
  (`trading.go:2565-2569`), leaving the intent PENDING, although a 429 means the request was never
  processed. Conversely an exhausted 429 returned as a plain error is a definite REJECTED with an
  `order.broker_rejected` event. Design must classify it explicitly.
- **`flattenAndHalt` amplification.** After a non-uncertain error it mints a new intent id and retries
  (`trading.go:2994-2999`), so in-client retries multiply (up to 4 × the in-client attempts) and a rate
  limit is treated as a rejection of the order's content. fails.md ~L2627 applies.
- **Staleness bound is 15s in the worst case**, not 30s, and each attempt may itself take
  `broker.timeout_ms` (5s). The sweeper can flip a PENDING intent to UNKNOWN mid-call and race
  `FinalizeIntent`. AC-13 uses the 30s default inputs.
- **Per-call contexts already cut waits short.** `reconcileTick`, `syncPositions` (one
  `brokerCallTimeout`) and `validateAndRecordCredential` (5s) bound the call below any useful wait;
  those errors are `DeadlineExceeded` and, in `reconcileTick`, count toward systemic escalation.
- **Fill poller stall.** Sequential `GetOrder` with no per-call timeout (`trading.go:1822`): in-client
  waits would block the whole tick across all orders.
- **Per-credential state is lost on credential update** because the pool replaces the `Client`
  (`trading.go:2701-2708`), and one `Client` per account means accounts sharing an Alpaca key do not
  share state unless it lives outside the `Client`. Any registry keyed by credential must not hold or
  log key material (295 @AC-16).
- **Bar ingester cycle.** A no-deadline wait of up to 300s inside a 5-minute ingest cycle delays the
  next cycle; no scenario pins this.
- **Kill-switch zero value.** A positive-sense bool field defaults to off for `NewClient` and every
  existing test literal; production reads `GetBool(key, true)`.
- **Trading API headers are undocumented.** Alpaca's Trading API reference (`/v2/orders`,
  `/v2/account`, the overview) lists no rate-limit headers and no 429; only the Market Data reference
  does. Not verified against a live paper response (no credentials in this session).
- **ReplaceOrder has no idempotency key**; a retry is safe only because a 429 means "not processed".
- **Not found:** any `X-RateLimit-*`/`Retry-After` parsing in either service; any clock or sleep seam in
  `internal/alpaca` or `internal/broker`; a reusable add-only-jitter or "one WARN per window" helper; a
  logger on either client; a broker HTTP request instrument in trading; a shared non-proto Go module;
  a confirmed deadline on inbound `PlaceOrder`/`CancelOrder`/`ReplaceOrder` contexts; a nil-receiver
  guard on `config.Watcher.GetBool`; a post-043 migration that seeds a bool (form inferred from 041 and
  the stored JSON); Alpaca response fixtures under either `internal/testdata/`.
- Ledger traps: fails.md ~L2627 (retry through a dedup seam must check the outcome), ~L3317 (copy a
  retry loop's failure boundaries), ~L3180 (no deadline at any hop), ~L1312 (inspect concrete broker
  implementations). Insights: insights.md ~L2917 (extract a slow backoff into a named seam for tests),
  ~L1576/~L1606 (hoist a config-resolved bool as a parameter in trading tests), ~L3152 (bool kill
  switches and explicit defaults), ~L4364 (a "feature disabled" mutant must fail every new test).

## Recommended Scope

1. Limiter core in marketdata `internal/alpaca` (header parse, per-host state, pacing, 429 retry, time
   seam) behind `do`, with tests.
2. Marketdata wiring: `Settings` field, `main.go` closure, telemetry outcomes, WARN log, docs.
3. Trading adapter: the same behavior in `internal/broker/alpaca.go#do` with the staleness-derived
   budget, a typed rate-limit error and its classification in `trading.go`, `ClientConfig` func field
   wired in `instantiateBrokerLocked`, tests.
4. Config migration 050 (two seeds, guarded description UPDATE), per-migration test, regenerated
   `scripts/config-wiring-stored.json`, registered-keys log, service `CLAUDE.md` tables.
5. Each service step pairs with its test step (C-08) covering AC-1..AC-22.
