# Implementation Spec: fix-trading-config-plumbing

**Status**: `pending`
**Created**: 2026-11-20
**Feature**: `docs/roadmap/features/321-fix-trading-config-plumbing/feature.md`
**Total Steps**: 13
**Feature Branch**: `feature/fix-trading-config-plumbing`

**Tree**: `feature/fix-trading-config-plumbing@b5756b2 ≡ origin/feature/fix-trading-config-plumbing`
(`origin/main-dev` merged). Every `path:line` below was read on this tree. `services/xstockstrat-trading`,
`packages/proto` and `scripts/` are unchanged since recon's tree `3da4293d`.

---

## Execution Summary

The steps follow design D-18. Steps 1–2 make IBKR signed requests read `broker.timeout_ms` live. Step 3
adds the int-row flatten test (no production change). Steps 4–5 persist `requires_approval`. Steps 6–9
move `broker.paper` to an `APPLICATION_ENV` fallback and seed it per environment. Steps 10–11 fix one
stale proto comment. Step 12 updates the docs. Step 13 is the operator-only stored-state check that
gates the integration PR's draft state.

**Consumer surface (C-14):** none — internal/platform-only, as decided in design.md § Chosen Approach and
restated in product-spec.md § Consumer Surface(s). No UI or agent step exists by decision.

**Scenario coverage (C-15):**

| Scenario | Covered by |
|---|---|
| `@AC-1` | Step 2 |
| `@AC-2` | Step 3 |
| `@AC-3` | Step 5 |
| `@AC-4` | Step 7 (trading fallback), Step 9 (per-environment seed and wiring gate) |

**Not in recon or design — found at spec time (impl-spec review should confirm each):**

1. `scripts/config-wiring.test.mjs:618` asserts `findings.length > 0` on the committed baseline. The
   `broker.paper` entry is the only finding (`scripts/config-wiring.json:5-12`), so removing it (D-6, D-14)
   fails test `baseline 2 @AC-8`. Step 9 replaces that one assertion with `assert.ok(Array.isArray(findings), …)` (never delete it, never assert an empty baseline). Prototyped on a scratch copy of
   `b5756b2`: with the reader change, two stored rows, the entry removed and line 618 deleted (the prototype used the deletion variant; the `Array.isArray` replacement is equivalent for that test but was not re-run),
   `node --test scripts/config-wiring.test.mjs` passes 75/75 and `--final` exits 0 with no `broker.paper`
   line. With the entry kept, `--final` prints `STALE: config-wiring.json:broker.paper:read-unseeded`.
2. D-18's U1a (RED scaffold) and U1b (wiring) are one atomic unit here (Steps 1–2). A scaffold-only commit
   would carry failing tests and cannot pass its own Verification (F-05). The scaffold is a transient state
   inside the unit.
3. Step 2 pins the stored state of D-20 as well as D-17: rows for `10000 × 4.0` (S = 40 s, B = 20 s) next
   to D-17's `10000 × 3.0` rows.
4. Step 13 covers the staging deployments only (operator ruling 2026-11-20, context.md). Its record
   already exists; the step is the re-check before the integration PR leaves draft.
5. The AC-2 test was prototyped on the scratch copy: it passes at HEAD, fails with `maxRetries := 3`
   (`submissions = 4, want 2`) and fails with `retryDelay := 500 * time.Millisecond`
   (`elapsed 502ms, want < 400ms`).

## Step Dependencies

- Steps 1+2 land together: Step 1 deletes `broker.IBKRRequestTimeout`, which `order_intent_test.go:175-176`
  references, and Step 2's tests reference symbols Step 1 creates (`step-constraints.md` §C: deleted
  referenced resource; test references a later symbol).
- Step 3 stands alone (test only). Step 5 [test] covers Step 4 [service]; each passes its own Verification
  apart, so no `**Lands with**`.
- Steps 6+7+8+9 land together: the seed migration, the reader change, the baseline entry removal and the
  stored-set regeneration fail the wiring gate in every partial combination (§C: seeds a config key; D-18,
  O-28). One consumer surface (backend).
- Steps 10+11 land together: a `.proto` edit and its regenerated stubs (§C).
- Step 12 requires Steps 1–11 (it documents their result).
- Step 13 has no code dependency. The integration PR is opened as a **draft** and leaves draft only after
  Step 13 is recorded (D-16; fails.md 2026-11-08 merge-gate, 2026-11-10 fix-sandbox-seed-keys).
- **RED capture for Steps 1–2 (D-8).** Order inside the unit: scaffold (Step 1, part A) → write Step 2's
  tests → run and record the failures → wire (Step 1, part C) → run green. The scaffold is never committed.
- **Step 8 needs a reachable Postgres plus `psql` and `migrate`** to regenerate
  `scripts/config-wiring-stored.json` (`scripts/config-wiring-stored.py:4-5`). This is artifact generation,
  not verification. Routes: (a) a local scratch Postgres with the tools from `scripts/Dockerfile.migrate`
  (the CI recipe, `.github/workflows/ci.yml:1348-1355`); (b) the `config-wiring-stored` CI job's uploaded
  artifact (`ci.yml:1368-1374`), committed unedited with the run URL recorded in `context.md`. The JSON is
  never written by hand. At spec time this host has `psql` and `docker` but no `migrate` on `PATH`.
  **Preflight before Step 6:** confirm which route works and record it in `context.md`; with neither, the
  unit is blocked (P-03).
- **Merge checklist — config migration number (fails.md 2026-11-10 fix-marketdata-dead-symbol-ingest).** Run
  before Step 6 and again after every `origin/main-dev` merge into the branch.
  1. `git fetch origin`.
  2. `git log --all --oneline -- 'services/xstockstrat-config/migrations/056*' 'services/xstockstrat-config/migrations/057*' 'services/xstockstrat-config/migrations/058*'`.
  3. The final number is max(`origin/main-dev` config migrations) + 1.
  4. On a renumber: rename both SQL files and regenerate `scripts/config-wiring-stored.json`. The SQL body,
     the sentinel, the test and the docs carry no number.
  5. Regenerate `scripts/config-wiring-stored.json` after any merge that brings in another config
     migration (`inputs_sha256` hashes every config migration; `scripts/check-config-wiring.mjs:714`
     `freshness`). On a conflict in that file, regenerate; never hand-merge (fails.md 2026-11-18).
  - Spec-time result (`b5756b2`): the trunk tail is `055_analysis_live_enrich_ttl_reseed`; `053` is absent;
    command 2 returns nothing. Peers: `317-fix-marketdata-miss-path-noise` also plans `056`
    (`origin/feature/fix-marketdata-miss-path-noise`, `implementation-spec.md:115`). Whichever merges second
    renumbers.
- **Textual overlap:** features 311, 312, 315 and 347 also edit `internal/service/trading.go` and
  `order_intent.go` (`docs/roadmap/features/merge-order.md:395-431`). After a main-dev merge, re-grep each
  step's anchors by symbol before editing.
- **277 halt condition (design Open Risks):** stop for an operator re-scope if any step pushes toward
  rewriting stored config descriptions, editing `scripts/config-heal/catalog.tsv`, or touching
  `internal/config/watchcore.go`.
- **Integration PR checklist (not a step):** C-16 promotion of `@AC-1..4`, read from
  `origin/feature/fix-trading-config-plumbing` (fails.md 2026-11-18); a two-line "Superseded by
  @feature-321" comment directly above 304 `@AC-14` (`docs/sdd/business-rules/platform.feature:2095-2100`),
  its text unchanged (D-10); the merge checklist above; Step 13 recorded.

---

### Step 1 — service: IBKR signed requests read `broker.timeout_ms` live

**Status**: `done`
**Service**: `xstockstrat-trading`
**Files**:
- `services/xstockstrat-trading/internal/broker/broker.go` — modify
- `services/xstockstrat-trading/internal/broker/alpaca.go` — modify
- `services/xstockstrat-trading/internal/broker/ibkr.go` — modify
- `services/xstockstrat-trading/internal/broker/ibkr_session.go` — modify
- `services/xstockstrat-trading/internal/service/trading.go` — modify
- `services/xstockstrat-trading/internal/service/order_intent.go` — modify

**Reviewers**: xstockstrat-trading service owner — order execution correctness, broker API safety

**Codebase Evidence**:
- `internal/broker/ibkr.go:26-42` `IBKRConfig` has `Timing func() IBKRTiming` (`:35`) and no timeout field;
  `:44-62` `IBKRClient` holds `timingFn` (`:56`); `:66-68` `const IBKRRequestTimeout = 10 * time.Second`;
  `:70` `NewIBKRClient`; `:83` `httpClient: &http.Client{Timeout: IBKRRequestTimeout}`; `:87`
  `timingFn: cfg.Timing`.
- `internal/broker/ibkr_session.go:34-38` `defaultIBKRTiming` (`HandshakeTimeout: 10 * time.Second` at
  `:37`); `:303-315` `send` (handshake: `mintLST` `:214`, `initBrokerage` `:277`); the handshake context is
  detached and bounded at `:170` and `:342` (`context.WithTimeout(context.WithoutCancel(ctx),
  c.timing().HandshakeTimeout)`); `:362` `do`; `:446-455` `sendSigned`, which reads and closes the body
  inside the function.
- `internal/broker/alpaca.go:25-26` `ClientConfig.Timeout func() time.Duration`; `:33`
  `const defaultTimeoutMs = 5000`; `:56` `httpClient: &http.Client{}`; `:75-81` `timeout()`; `:91`
  `context.WithTimeout(req.Context(), c.timeout())`.
- `internal/broker/broker.go:3-6` imports `context`, `errors` only (the package's shared file).
- `internal/service/trading.go:2637-2644` `brokerCallTimeout` — `cfgW.GetFloat("broker.timeout_ms", 5000)`,
  `<= 0` → 5000; sole reader. `:3356-3389` `instantiateBrokerLocked`: IBKR config literal `:3363-3373`
  (`Timing: s.ibkrTiming`), Alpaca `Timeout: func() time.Duration { return brokerCallTimeout(s.cfgW) }` at
  `:3385`, `RateLimitBudget: s.alpacaRateLimitBudget` (method value) at `:3387`. `:90-98` `type ibkrCreds`.
  `:2663` `ms("ibkr.handshake_timeout_ms", 10000)` (lines re-grounded after the `f802b184` main-dev merge).
- `internal/service/order_intent.go:107-117` `staleThreshold`: floor =
  `max(brokerCallTimeout, broker.IBKRRequestTimeout)` (`:112`), then `computeStaleThreshold`.
- All Go references to `IBKRRequestTimeout`: `ibkr.go:66,68,83`, `order_intent.go:108,112`,
  `order_intent_test.go:175-176` (grep at `b5756b2`).
- `internal/service/trading.go:1476-1481` `alpacaCallContext` skips IBKR accounts; `:2173` and `:2576`
  bound reconciliation and position sync by `brokerCallTimeout` for every broker. None changes.
- Timeouts stay uncertain outcomes: `trading.go:2670-2674` `isUncertainBrokerOutcome` accepts
  `context.DeadlineExceeded` and `net.Error.Timeout()`; `:3222-3231` `credentialStatusFromError` maps any
  non-credential error to `UNKNOWN`.

**Lands with**: `Step 2`

**TDD**: `red-green required`

**Covers**: —

**Instructions**:

Part A — scaffold (compiles, behaviour identical to HEAD; never committed):
1. `ibkr.go`: add `Timeout func() time.Duration` to `IBKRConfig` after `Timing` (`:35`); add
   `timeoutFn func() time.Duration` to `IBKRClient` after `timingFn` (`:56`); set `timeoutFn: cfg.Timeout`
   in `NewIBKRClient` after `:87`.
2. `broker.go`: add `func callTimeout(fn func() time.Duration) time.Duration` returning `0`.
3. `ibkr_session.go`: add `const IBKRDefaultHandshakeTimeout = 10 * time.Second` above `defaultIBKRTiming`.
4. `trading.go`: add `func (s *TradingService) brokerTimeout() time.Duration` returning `0`, next to
   `brokerCallTimeout`; add
   `func (s *TradingService) ibkrClientConfig(rec *repository.BrokerAccountRecord, creds ibkrCreds) broker.IBKRConfig`
   returning exactly the literal at `:3363-3373`; the IBKR branch of `instantiateBrokerLocked` calls
   `broker.NewIBKRClient(s.ibkrClientConfig(rec, creds))`.

Part B — write Step 2's tests and record the RED run.

Part C — wiring:
5. `broker.go`: `callTimeout` returns `fn()` when `fn != nil` and the result is `> 0`, else
   `defaultTimeoutMs * time.Millisecond` (add the `time` import). `alpaca.go:75-81`: `timeout()` returns
   `callTimeout(c.cfg.Timeout)`. `defaultTimeoutMs` stays at `alpaca.go:33`.
6. `ibkr.go`: delete `IBKRRequestTimeout` and its comment (`:66-68`); `httpClient: &http.Client{}` (`:83`).
   Comment on `IBKRConfig.Timeout` (2 lines max): read before every signed request, nil or non-positive
   falls back to `defaultTimeoutMs`; the handshake is bounded by `Timing().HandshakeTimeout`.
7. `ibkr_session.go`: `defaultIBKRTiming.HandshakeTimeout: IBKRDefaultHandshakeTimeout` (`:37`). In
   `sendSigned` (`:446-455`) derive `ctx, cancel := context.WithTimeout(req.Context(),
   callTimeout(c.timeoutFn))`, `defer cancel()`, and send `req.WithContext(ctx)`. `send` (`:303-315`) is
   not changed (R-7).
8. `trading.go`: `brokerTimeout()` returns `brokerCallTimeout(s.cfgW)`; `ibkrClientConfig` adds
   `Timeout: s.brokerTimeout`; the Alpaca branch uses `Timeout: s.brokerTimeout` in place of the inline
   closure (`:3385`). Leave the literal `10000` at `:2663`: the wiring gate compares a reader's literal
   default with the seeded `default_value`.
9. `order_intent.go:107-117`: the floor reads `broker.IBKRDefaultHandshakeTimeout`; update the two-line
   comment to name it. The formula is unchanged: S = max(T, 10 s) × multiplier (D-2).

Config-key contract (C-05): namespace `trading`; key `broker.timeout_ms`; `value_type` `int`; code default
`5000`; reader `services/xstockstrat-trading/internal/service/trading.go:brokerCallTimeout` (sole reader;
`brokerTimeout` wraps it); seed: `041_heal_config_keys_to_reader_catalog` (already applied, int `5000` in
both environments); live mechanism: read through the `WatchConfig` watcher before every signed IBKR request
and every Alpaca request, no restart or client rebuild.

Trading-domain notes: both `BrokerType` clients are handled (IBKR new behaviour; Alpaca refactored onto the
shared helper with unchanged behaviour); `BROKER_TYPE_OFFLINE` is unaffected. Trading-mode gate, order type
handling and fill handling are unaffected by this step.

**Verification** (with Step 2 applied):
```bash
cd services/xstockstrat-trading
grep -rn "IBKRRequestTimeout" --include='*.go' . ; test $? -eq 1        # no reference left
grep -n "http.Client{" internal/broker/ibkr.go internal/broker/alpaca.go  # both `&http.Client{}`
grep -n "callTimeout(" internal/broker/broker.go internal/broker/alpaca.go internal/broker/ibkr_session.go
# expect: the definition, alpaca timeout(), sendSigned — and no hit inside send (:303-315)
grep -n "s.brokerTimeout" internal/service/trading.go                    # ibkrClientConfig + the Alpaca branch
grep -rn "IBKRDefaultHandshakeTimeout" --include='*.go' internal | grep -v _test.go
# expect: the const, defaultIBKRTiming, order_intent.go staleThreshold
GOWORK=off go build ./... && GOWORK=off go vet ./...
```
Lint and the test run are in Step 2.

---

### Step 2 — test: IBKR live timeout, shared fallback, floor and budget pins (AC-1)

**Status**: `done`
**Service**: `xstockstrat-trading`
**Files**:
- `services/xstockstrat-trading/internal/broker/ibkr_do_test.go` — modify
- `services/xstockstrat-trading/internal/broker/ibkr_session_internal_test.go` — modify
- `services/xstockstrat-trading/internal/service/trading_ibkr_auth_test.go` — modify
- `services/xstockstrat-trading/internal/service/trading_rate_limit_test.go` — modify
- `services/xstockstrat-trading/internal/service/order_intent_test.go` — modify

**Reviewers**: xstockstrat-trading service owner — order execution correctness, broker API safety

**Codebase Evidence**:
- `internal/broker/ibkr_do_test.go:1` `package broker_test`; `:26-44` `ibkrTestConfig`; `:77-89`
  `lenientIBKRClient(t, next, mod)` — handshake from the vectors, every other path from `next`; `:120-122`
  `ibkrConidReply`, `ibkrOrderReply`, `ibkrOrdersJSON`; `:455-493`
  `TestIBKRSubmitOrder_SessionFailureNoPOST` shows the pieces to reuse: a `block` channel closed in
  `t.Cleanup` (`:463-467`), a `cfg.Timing` override (`:473-475`), the `OrderRequest` literal (`:478`),
  `h.Count(http.MethodPost, "/iserver/account/U123/orders")` (`:482`), the timeout predicate (`:485-486`).
- `internal/testdata/ibkr.go:131-136` `IBKRAuthOverride{Status, Body, Delay, Block}`; `:185-224`
  `ServeHTTP` applies `Delay`/`Block` to the LST and init routes only and forwards other paths to `Next`.
- `internal/broker/ibkr.go:216` conid lookup `GET …/iserver/secdef/search`; `:280` order
  `POST …/iserver/account/{id}/orders`; `:414-416` `GetOrder` → `GET …/iserver/account/orders`; `:569-570`
  `ValidateCredentials` → `GET …/portfolio/accounts`.
- `internal/broker/ibkr_session_internal_test.go:1` `package broker` (internal test file; `sessionClient`
  `:51-84`).
- `internal/broker/alpaca_test.go:221-231` `TestNewClient_TimeoutFromConfig` and `:233-262`
  `TestSubmitOrder_TimeoutIsLive` (the `atomic.Int64` live-value pattern) already pin Alpaca's behaviour
  through `HTTPTimeout()`; they guard the `callTimeout` refactor unchanged.
- `internal/service/trading_ibkr_auth_test.go:69-109` `ibkrAuthService` builds a literal `broker.IBKRConfig`
  with `Timing: svc.ibkrTiming` (`:97`) and applies `mod` (`:105-107`); `:111-119` `portfolioAccountsOK`;
  `:121-126` `snapshotInts`.
- `internal/service/trading_rate_limit_test.go:29-45` `TestRateLimitBudget` rows; `:47-55`
  `rateLimitWatcher(timeoutMs, multiplier, enabled)` (float rows); `:58-69` rows of
  `TestAlpacaRateLimitBudget_FollowsConfig`; `:176`
  `Timeout: func() time.Duration { return brokerCallTimeout(h.svc.cfgW) }`.
- `internal/service/order_intent_test.go:171-181` `TestStaleThreshold_UsesLiveConfigDefaults` re-derives the
  floor from `broker.IBKRRequestTimeout` (`:175-176`).
- C-13: no new domain literal gains a second consumer. Reused: `lenientIBKRClient`, `ibkrTestConfig`,
  `testdata.IBKRAuthHandler`, `snapshotInts`, `rateLimitWatcher`.

**Lands with**: `Step 1`

**TDD**: `red-green required`

**Covers**: `AC-1`

**Instructions**:

Fixture timeouts are small (100–200 ms) so the suite stays fast; assertions use loose bounds for `-race`.

1. `ibkr_do_test.go` — `TestIBKRSignedRequest_BoundedByLiveTimeout_F321_AC1`. Client from
   `lenientIBKRClient` with `cfg.Timeout` returning 200 ms and a 2 s `HandshakeTimeout`. `next` answers the
   conid lookup with `ibkrConidReply` and blocks only the order POST until the request context ends (or a
   channel closed in `t.Cleanup`). `SubmitOrder` must return a timeout error (predicate of `:485-486`) in
   under 3 s, with exactly one order POST recorded. **RED on the scaffold:** the call returns after about
   10 s (the client timeout), so the elapsed bound fails.
2. `ibkr_do_test.go` — `TestIBKRSignedRequest_TimeoutChangeAppliesWithoutRebuild_F321_AC1`. One client;
   `cfg.Timeout` reads an `atomic.Int64`; `next` answers `GetOrder` with `ibkrOrdersJSON` after 300 ms. At
   5 s the call succeeds; after storing 100 ms the same client's next call fails as a timeout. **RED on the
   scaffold:** the second call succeeds.
3. `ibkr_do_test.go` — `TestIBKRHandshake_SlowerThanRequestTimeoutStillSucceeds_F321_AC1`.
   `h.SetOverride(testdata.IBKRLSTPath, testdata.IBKRAuthOverride{Delay: 300 * time.Millisecond})`, a 2 s
   `HandshakeTimeout`, `cfg.Timeout` 100 ms, `next` answering at once: `GetOrder` succeeds. This is a guard
   for R-7 and is green on the scaffold too. Show it discriminates once by mutation (apply the
   `callTimeout` deadline inside `send` → the test fails), revert, and record the result in `context.md`.
4. `ibkr_session_internal_test.go` — `TestCallTimeout_F321`: nil → 5 s; a function returning 0 → 5 s;
   negative → 5 s; 1234 ms → 1234 ms. **RED on the scaffold:** the stub returns 0.
5. `trading_ibkr_auth_test.go` — `ibkrAuthService` builds its config with
   `svc.ibkrClientConfig(&repository.BrokerAccountRecord{}, ibkrCreds{…})` (vector values, account `U123`)
   and then sets the test seams (`BaseURL`, `Now`, `Nonce`, `DHRandom`) and `mod`. New
   `TestIBKRClientConfig_WiresLiveBrokerTimeout_F321_AC1`: watcher
   `snapshotInts(map[string]int64{"broker.timeout_ms": 200})`, a non-strict handler whose `Next` blocks
   `GET …/portfolio/accounts`; `c.ValidateCredentials(context.Background())` returns a timeout in under
   3 s. **RED on the scaffold:** about 10 s. After wiring, a dropped `Timeout: s.brokerTimeout` falls back
   to 5 s and fails the bound (D-12).
6. `trading_rate_limit_test.go` — `TestBrokerTimeout_IntRow_F321`: with
   `snapshotInts(map[string]int64{"broker.timeout_ms": 10000})` `brokerTimeout()` is 10 s; with a zero
   watcher it is 5 s. **RED on the scaffold:** the stub returns 0. Replace the closure at `:176` with
   `h.svc.brokerTimeout`.
7. Pins that are green before and after (D-17, D-20) — literal expectations, never re-derived:
   `TestRateLimitBudget` rows `{true, 10 s, 30 s, 10 s}` and `{true, 10 s, 40 s, 20 s}`;
   `TestAlpacaRateLimitBudget_FollowsConfig` rows `{10000, 3.0, 10 s}` and `{10000, 4.0, 20 s}`.
8. `order_intent_test.go` — `:175-176` reference `broker.IBKRDefaultHandshakeTimeout`. New
   `TestStaleThreshold_FloorKept_F321`: `staleThreshold(rateLimitWatcher(1000, 3.0, nil))` and
   `staleThreshold(rateLimitWatcher(10000, 3.0, nil))` are both 30 s; `rateLimitWatcher(10000, 4.0, nil)`
   gives 40 s (pins; PRESERVE 347 `@AC-27`).

Coverage note: `internal/broker` is in the CI coverage set; `internal/service` is excluded, so no threshold
applies to the service-package tests.

**Verification**:
```bash
cd services/xstockstrat-trading
GOWORK=off go test ./internal/broker/ ./internal/service/ -race -count=1 \
  -run 'F321|TestStaleThreshold|TestRateLimitBudget|TestAlpacaRateLimitBudget|TestNewClient_TimeoutFromConfig|TestSubmitOrder_TimeoutIsLive|TestIBKR|TestEnsureSession|TestValidateAndRecordCredential'
GOWORK=off COVERPKGS=$(go list ./... | grep -Ev '/(cmd|handler|repository|telemetry|service)(/|$)' | tr '\n' ',' | sed 's/,$//') && go test ./... -race -count=1 -coverprofile=coverage.out -covermode=atomic -coverpkg="${COVERPKGS}" && go tool cover -func=coverage.out | grep "^total:"   # confirm >= 40%
GOWORK=off golangci-lint run --modules-download-mode=mod
grep -rn "func ibkrTestConfig\|func snapshotInts\|func rateLimitWatcher" --include='*_test.go' . | wc -l   # 3: one declaration each (C-13)
```
Record the RED run (items 1, 2, 4, 5, 6) and the green run in the PR body and `context.md`.

---

### Step 3 — test: an int `order.max_retries` row sets the flatten's attempts (AC-2)

**Status**: `done`
**Service**: `xstockstrat-trading`
**Files**:
- `services/xstockstrat-trading/internal/service/trading_flatten_rejection_test.go` — modify

**Reviewers**: xstockstrat-trading service owner — order execution correctness

**Codebase Evidence**:
- `internal/service/trading.go:3091-3092`
  `maxRetries := int(s.cfgW.GetFloat("order.max_retries", 3))`,
  `retryDelay := time.Duration(s.cfgW.GetFloat("order.retry_delay_ms", 500)) * time.Millisecond`; loop
  `for attempt := 0; attempt <= maxRetries; attempt++` at `:3095`; a definitive rejection re-mints the
  order ids (`:3108-3115`), so every attempt reaches the broker (lines re-grounded after the `f802b184`
  main-dev merge).
- `internal/config/watchcore.go:406` `GetFloat` widens an int row (feature 295).
- Harness reaches the real callee: `trading_flatten_rejection_test.go:99-123` `newFlattenHarness` builds a
  real `TradingService` with a real `TradingRepo` over `execOnlyDB`, `memIntentRepo` and a `fakeBroker`
  whose `submitOrderFn` records each submission (`:101-107`); `cfgW: &config.Watcher{}` at `:111`;
  `:125-131` `run` calls `h.svc.flattenAndHalt`; `:133` `errBuyingPower` is a definitive rejection; `:148`
  the default-config case expects 4 submissions (the merge added a halt-alert `TargetUserId` assertion at
  `:142-144` of `TestFlattenAndHalt_AlwaysRejected_HaltsAccount`; the harness is unchanged).
- `internal/service/trading_ibkr_auth_test.go:121-126` `snapshotInts` builds a populated int snapshot with
  `config.MustSnapshotWatcher`.
- Spec-time prototype on a scratch copy of `b5756b2`: the test below passes at HEAD; mutation results are
  in § Execution Summary item 5.

**TDD**: `red N/A — no behavior change; characterization test added`. P-06 natural-RED waiver granted by
the operator on 2026-11-20 (context.md, design D-11). Discrimination is shown by mutation.

**Covers**: `AC-2`

**Instructions**:
1. Add `TestFlattenAndHalt_IntRetryRowsSetAttempts_F321_AC2` after
   `TestFlattenAndHalt_UncertainTimeout_KeepsClientOrderID` (`:190-200`). For each of
   `{max_retries int 1 → 2 submissions; int 5 → 6}`: build `newFlattenHarness` with every submission
   returning `errBuyingPower`, set
   `h.svc.cfgW = snapshotInts(map[string]int64{"order.max_retries": n, "order.retry_delay_ms": 10})`, run,
   and assert `len(h.ids) == 1 + n`, elapsed `< 400 ms`, and that the account is halted.
2. Mutation evidence (record both failures and the reverted pass in the PR body and `context.md`, in the
   waiver's wording): hardwire `maxRetries := 3` at `trading.go:3091` → 4 submissions, the test fails;
   hardwire `retryDelay` to 500 ms at `:3092` → the elapsed assertion fails. Revert both; no production
   file is staged.
3. C-13: `snapshotInts` and `errBuyingPower` are reused; no new domain literal.

Trading-domain notes: order type, fill handling, broker dispatch and the trading-mode gate are unaffected.
New logic is test-only in an excluded package — no coverage threshold applies.

**Verification**:
```bash
cd services/xstockstrat-trading
GOWORK=off go test ./internal/service/ -race -count=1 -run 'TestFlattenAndHalt'
git diff --stat -- internal/service/trading.go   # empty: no production change in this step
GOWORK=off golangci-lint run --modules-download-mode=mod
```

---

### Step 4 — service: bind `requires_approval` from the insert-time status

**Status**: `done`
**Service**: `xstockstrat-trading`
**Files**:
- `services/xstockstrat-trading/internal/repository/trading_repo.go` — modify

**Reviewers**: xstockstrat-trading service owner — order execution correctness

**Codebase Evidence**:
- `internal/repository/trading_repo.go:53` `UpsertOrder(ctx, o *tradingv1.Order)`; INSERT column list
  `:63-69` (`requires_approval` is `$17`); `ON CONFLICT (order_id, created_at) DO UPDATE SET` `:77-86`
  updates nine columns and not `requires_approval`; the literal `false` is bound at `:93`
  (`false, createdAt, updatedAt,`).
- `internal/service/trading.go:586-589` approval decision; `:613-616` `submitOrder` sets
  `ORDER_STATUS_PENDING_APPROVAL` when `requiresApproval`; the first insert is at `:694`; the approval path
  returns at `:703-710` without a broker call.
- Column exists: `migrations/001_orders_hypertable.up.sql:24-26`. No reader of the column exists (recon
  § Risks, Not found).

**TDD**: `red-green required`

**Covers**: —

**Instructions**:
1. At `:93` bind `o.Status == tradingv1.OrderStatus_ORDER_STATUS_PENDING_APPROVAL` in place of `false`.
2. Add a constraint comment of at most two lines at the bind: the value is fixed by the first insert
   because `ON CONFLICT` never updates the column.
3. No signature, call-site, migration or proto change (D-4, R-6). `approved_by` / `approved_at` stay
   unwritten.

Trading-domain notes: an approval-required order never reaches a broker, so broker dispatch, the
trading-mode gate, order type handling and fill handling are unaffected.

**Verification**:
```bash
cd services/xstockstrat-trading
grep -n "ORDER_STATUS_PENDING_APPROVAL" internal/repository/trading_repo.go   # the bind
sed -n '77,86p' internal/repository/trading_repo.go | grep -c requires_approval   # 0
GOWORK=off go build ./... && GOWORK=off go test ./internal/repository/ ./internal/service/ -race -count=1
```
Lint is in Step 5.

---

### Step 5 — test: `requires_approval` bind (AC-3)

**Status**: `done`
**Service**: `xstockstrat-trading`
**Files**:
- `services/xstockstrat-trading/internal/repository/trading_repo_test.go` — modify
- `services/xstockstrat-trading/internal/service/trading_order_state_audit_test.go` — modify

**Reviewers**: xstockstrat-trading service owner — order execution correctness

**Codebase Evidence**:
- `internal/repository/trading_repo_test.go:274-280` `upsertArgs` (23 positional args, `AnyArg` except the
  last); `:284` `TestUpsertOrder_PersistsFeesPresence` (pgxmock `ExpectExec` with a SQL-shape regex,
  `repo := &TradingRepo{db: mock}`).
- `internal/service/trading_offline_test.go:1601-1607` `rowCapture` (records the bound value at one
  position); `:1609` `const upsertRequiresApprovalArg = 16`; `:1652-1659` `expectUpsert` (23 `rowCapture`
  args on `INSERT INTO trading\.orders`).
- `internal/service/trading_order_state_audit_test.go:105-109` `activeSnapshot`
  (`risk.max_position_pct` float 0); `:111-115` `activePlatformSnapshot` (`trading_state` `ACTIVE`);
  `:117-126` `auditSvc` — real `TradingRepo`, `fakeOrderIntentRepo`, a broker entry for `acct-1` owned by
  `u-1`; `:128-133` `placeReq` (qty 10, market); `:93` `waitForLedgerEvents`; existing `PlaceOrder`
  calls on this harness at `:184`, `:196` reach the broker, so the path before the approval decision
  needs only `Exec`.
- `internal/repository/trading_repo.go:41-43` `NewTradingRepoWithDB(db dbQuerier)`.
- Seeds for the approval thresholds are float rows (`services/xstockstrat-config/migrations/001_config_tables.up.sql:57-58`).
- C-13: `rowCapture`, `upsertRequiresApprovalArg`, `auditSvc`, `placeReq` are reused in-package; no new
  domain literal gains a second consumer.

**TDD**: `red-green required`

**Covers**: `AC-3`

**Instructions**:
1. `trading_repo_test.go` — `TestUpsertOrder_RequiresApprovalFromStatus_F321_AC3`, a table over
   `PENDING_APPROVAL → true`, `NEW → false`, `FILLED → false`: 23 args, `pgxmock.AnyArg()` everywhere
   except index 16 (`$17`), which is the expected bool. In the `PENDING_APPROVAL` case the `ExpectExec`
   regex also pins the full `DO UPDATE SET` list of `:78-86` through to the end of the statement, so adding
   `requires_approval` to it fails the test. **RED before Step 4:** the `true` case fails on the argument
   mismatch.
2. `trading_order_state_audit_test.go` —
   `TestPlaceOrder_AboveApprovalThreshold_PersistsRequiresApproval_F321_AC3`: build `auditSvc`, then set
   `svc.repo = repository.NewTradingRepoWithDB(mock)` (pgxmock pool) and `svc.cfgW` to a snapshot holding
   `risk.max_position_pct` float 0 and `approval.require_above_qty` float 20. Expect one upsert with 23
   `rowCapture` args. `PlaceOrder(ctxAsUser("u-1"), req)` with `req.Qty = 21` must return
   `ORDER_STATUS_PENDING_APPROVAL`, the captured value at `upsertRequiresApprovalArg` must be `true`, and
   the broker fake must not be called (its `submitOrderFn` fails the test). Wait for the two ledger events
   (`order.created`, `order.approval_requested`) with `waitForLedgerEvents` and check
   `mock.ExpectationsWereMet()`. **RED before Step 4:** the captured value is `false`.

New logic is in excluded packages (`repository`, `service`) — no coverage threshold applies; these tests
are the verification.

**Verification**:
```bash
cd services/xstockstrat-trading
GOWORK=off go test ./internal/repository/ ./internal/service/ -race -count=1 -run 'F321_AC3|TestUpsertOrder|TestPlaceOrder|TestConfirmOrder'
GOWORK=off COVERPKGS=$(go list ./... | grep -Ev '/(cmd|handler|repository|telemetry|service)(/|$)' | tr '\n' ',' | sed 's/,$//') && go test ./... -race -count=1 -coverprofile=coverage.out -covermode=atomic -coverpkg="${COVERPKGS}" && go tool cover -func=coverage.out | grep "^total:"   # confirm >= 40%
GOWORK=off golangci-lint run --modules-download-mode=mod
grep -rn "type rowCapture\|upsertRequiresApprovalArg =" --include='*_test.go' . | wc -l   # 2: one declaration each (C-13)
```

---

### Step 6 — service: `broker.paper` has one reader and an `APPLICATION_ENV` fallback

**Status**: `done`
**Service**: `xstockstrat-trading`
**Files**:
- `services/xstockstrat-trading/internal/service/trading.go` — modify

**Reviewers**: xstockstrat-trading service owner — paper-only dev invariant, broker API safety;
xstockstrat-config service owner — config key naming, environment (`production`/`staging`) scoping; DBA —
migration numbering, up+down pair (unit reviewers, D-18)

**Codebase Evidence**:
- `internal/service/trading.go:2832-2836` `environmentIsPaper` (comment `:2832-2833`, func `:2834`) —
  `s.cfgW.GetBool("broker.paper", s.cfg.TradingMode == "paper")`; callers `:1080`, `:2709`, `:2743`,
  `:2823` (`GetTradingEnvironment`, `:2821-2830`). Lines re-grounded after the `f802b184` main-dev merge.
- `:3854-3865` `resolveTradingMode` repeats the same `GetBool` at `:3860`; callers `:505`, `:817`, `:3079`.
- `:2366` already derives from the environment: `if s.cfg.ApplicationEnv == "production"`.
- `internal/config/config.go:30-31` `TradingMode`, `ApplicationEnv`; `:46-47`
  `getEnv("TRADING_MODE", "paper")`, `getEnv("APPLICATION_ENV", "development")`; `:98-105`
  `resolveEnvironment` (anything but `production` → staging), the axis that scopes the watcher's rows.
- Deployment values: `docker-compose.yml:16-17` (`APPLICATION_ENV: development`, `TRADING_MODE: paper`);
  `.do/app.dev.yaml:28,30`; `.do/app.yaml:28,30`; `deploy/homelab/compose.yml:5-6` (both required) with the
  pairing asserted at `deploy/homelab/render-assert.jq:39-40`.
- Routing of an existing account is by its persisted `is_paper` (`trading.go:3368` `IsPaper: rec.IsPaper`,
  `:3384` `Paper: rec.IsPaper`), not by this key.
- Spec-time prototype (scratch copy of `b5756b2`): with this change the wiring checker still attributes
  one reader with no literal default, and produces no `default-mismatch`, `type-mismatch` or
  `readers-disagree` finding once the key is seeded.

**Lands with**: `Step 7, Step 8, Step 9`

**TDD**: `red-green required`

**Covers**: —

**Instructions**:
1. `environmentIsPaper` (`:2832-2836`): fallback `s.cfg.ApplicationEnv != "production"`. Replace the
   two-line comment: it is the sole reader of `trading.broker.paper`; with no stored row only
   `APPLICATION_ENV=production` resolves live.
2. `resolveTradingMode` (`:3854-3865`): call `s.environmentIsPaper()` instead of its own `GetBool`; update
   the priority comment (explicit request field > `trading.broker.paper` > `APPLICATION_ENV`).
3. Do not touch `Config.TradingMode`, `NewWatcher`'s `tradingMode` parameter or
   `cmd/server/main.go:70,75` (dead plumbing left to feature 322, D-19). No env var is added, removed or
   changed in any deployment file.

Operator-accepted consequence (D-14, P-03): `APPLICATION_ENV` alone decides trading's paper/live. A target
pairing `APPLICATION_ENV=production` with `TRADING_MODE=paper` labels registrations and orders paper at
HEAD and live after this step. A missing `APPLICATION_ENV` resolves paper.

Config-key contract (C-05): namespace `trading`; key `broker.paper`; `value_type` `bool`; code default
environment-derived (`s.cfg.ApplicationEnv != "production"`, no literal); reader
`services/xstockstrat-trading/internal/service/trading.go:environmentIsPaper` (single); seed: Step 8's
migration (staging `true`, production `false`); live mechanism: read through the `WatchConfig` watcher on
every order and every account registration.

Trading-domain notes: the trading-mode gate is the function changed here; routing of existing accounts
stays on the persisted `is_paper`. Both `BrokerType` values pass through the same resolver. Order type
handling and fill handling are unaffected.

**Verification** (with Steps 7–9 applied):
```bash
cd services/xstockstrat-trading
grep -n '"broker.paper"' internal/service/trading.go                 # exactly one hit, in environmentIsPaper
grep -n 'cfg.TradingMode' internal/service/trading.go ; test $? -eq 1 # no reader left in the service
grep -n "environmentIsPaper()" internal/service/trading.go            # the gate: resolveTradingMode + the four existing callers
cd ../.. && grep -n "TRADING_MODE" docker-compose.yml .do/app.dev.yaml .do/app.yaml   # unchanged: paper, paper, live
git diff --stat origin/main-dev -- docker-compose.yml .do deploy                        # empty
cd services/xstockstrat-trading && GOWORK=off go build ./... && GOWORK=off go vet ./...
```
Lint and the test run are in Step 7.

---

### Step 7 — test: paper/live resolution follows `APPLICATION_ENV` and the stored row (AC-4)

**Status**: `done`
**Service**: `xstockstrat-trading`
**Files**:
- `services/xstockstrat-trading/internal/service/trading_paper_env_test.go` — create

**Reviewers**: xstockstrat-trading service owner — paper-only dev invariant; xstockstrat-config service
owner — environment scoping; DBA (unit reviewers, D-18)

**Codebase Evidence**:
- **Not found** — no test exercises `environmentIsPaper`, the service's `resolveTradingMode` or
  `GetTradingEnvironment` (`grep -rn "GetTradingEnvironment\|environmentIsPaper" --include='*_test.go'
  services/xstockstrat-trading` → none; `internal/config/config_test.go:652-658` tests the watcher's own
  `resolveTradingMode`, a different function). The test file is created from scratch.
- Bool snapshot pattern: `internal/service/trading_rate_limit_test.go:53`
  (`&configv1.ConfigValue{Value: &configv1.ConfigValue_BoolVal{BoolVal: …}}` with
  `config.MustSnapshotWatcher("trading", …)`).
- Harnesses that change resolved mode under the new fallback: eleven `&config.Config{}` sites
  (`trading_order_state_audit_test.go:119`, `trading_resume_account_test.go:101`,
  `trading_state_gate_test.go:213`, `trading_offline_test.go:435`, `trading_ibkr_auth_test.go:85,238`,
  `trading_bracket_test.go:526`, `trading_rate_limit_test.go:163`,
  `trading_flatten_rejection_test.go:111`, `trading_reconciliation_test.go:186`,
  `trading_sizing_test.go:64`) move from LIVE to PAPER; six `&config.Config{TradingMode: "paper"}` sites
  (`trading_offline_test.go:313,590,659,1152,1481`, `trading_ibkr_auth_test.go:287`) stay PAPER. No
  service test asserts `TRADING_MODE_LIVE` (grep at `b5756b2`).
- fails.md 2026-11-18 (fix-trading-reconcile-reads): compare against literal enums, never a value
  re-derived from the same double.

**Lands with**: `Step 6, Step 8, Step 9`

**TDD**: `red-green required`

**Covers**: `AC-4`

**Instructions**:
1. `TestEnvironmentIsPaper_F321_AC4`, a table over `(cfg.ApplicationEnv, cfg.TradingMode, watcher)`; each
   row asserts the same literal result on three surfaces: `environmentIsPaper()`,
   `resolveTradingMode(TRADING_MODE_UNSPECIFIED)` and `GetTradingEnvironment(ctx).TradingMode`.

   | ApplicationEnv | TradingMode | Stored `broker.paper` | Want | At HEAD |
   |---|---|---|---|---|
   | `production` | `paper` | none | LIVE | PAPER (**RED**) |
   | `development` | `live` | none | PAPER | LIVE (**RED**) |
   | `staging` | `live` | none | PAPER | LIVE (**RED**) |
   | `` (unset) | `live` | none | PAPER | LIVE (**RED**) |
   | `production` | `` | bool `false` (the production seed) | LIVE | LIVE |
   | `development` | `` | bool `true` (the staging seed) | PAPER | PAPER |
   | `production` | `paper` | bool `true` | PAPER (the stored row wins) | PAPER |
2. One more assertion: an explicit request mode wins —
   `resolveTradingMode(TRADING_MODE_LIVE)` is LIVE with `ApplicationEnv: "development"`.
3. Run the full service suite: the eleven `&config.Config{}` harnesses must stay green in PAPER (design
   Open Risks). A test that turns red here is a deviation to record, not to patch around.
4. C-13: the table is a scenario one-off with a single consumer; inline is compliant.

New logic is in an excluded package — no coverage threshold applies; integration test verification is
sufficient.

**Verification**:
```bash
cd services/xstockstrat-trading
GOWORK=off go test ./internal/service/ -race -count=1 -run 'TestEnvironmentIsPaper_F321_AC4'
GOWORK=off COVERPKGS=$(go list ./... | grep -Ev '/(cmd|handler|repository|telemetry|service)(/|$)' | tr '\n' ',' | sed 's/,$//') && go test ./... -race -count=1 -coverprofile=coverage.out -covermode=atomic -coverpkg="${COVERPKGS}" && go tool cover -func=coverage.out | grep "^total:"   # confirm >= 40%; the whole suite is green
GOWORK=off golangci-lint run --modules-download-mode=mod
```

---

### Step 8 — migration: seed `trading` / `broker.paper` per environment (config `056`, provisional)

**Status**: `done`
**Service**: `xstockstrat-config`
**Files**:
- `services/xstockstrat-config/migrations/057_trading_broker_paper_per_environment.up.sql` — create
- `services/xstockstrat-config/migrations/057_trading_broker_paper_per_environment.down.sql` — create
- `scripts/config-wiring-stored.json` — modify (regenerated, never hand-edited)

Re-spec 2026-11-26: `056` is taken on `origin/main-dev` by feature 366
(`056_analysis_live_only_cycle_max_days`), so this pair is `057` (the heading's `056` is superseded).

**Reviewers**: DBA — migration NNN numbering (no gaps, no conflicts), up+down pair present, run-order
compliance with `scripts/db-migrate.sh`; xstockstrat-config service owner — config key naming, environment
(`production`/`staging`) / global-per-user scoping; xstockstrat-trading service owner — paper-only dev
invariant (unit reviewers, D-18)

**Codebase Evidence**:
- Tail of `services/xstockstrat-config/migrations/`: `054_marketdata_delisting_confirmation_days`,
  `055_analysis_live_enrich_ttl_reseed`, `056_analysis_live_only_cycle_max_days` (feature 366, on
  `origin/main-dev` `f802b184`); `053` absent; no `origin` ref carries `057`+ (checked 2026-11-26;
  § Step Dependencies, merge checklist).
- Row shape: `054_marketdata_delisting_confirmation_days.up.sql:4-13` — ten columns
  `(namespace, key, value_type, value_data, description, default_value, consuming_service, updated_by,
  environment, user_id)`, one tuple per environment, `user_id` `NULL`,
  `ON CONFLICT (namespace, key, environment, COALESCE(user_id, '')) DO NOTHING`. Header comment lines
  `054_…up.sql:1-2`.
- Bool literal spelling: `052_alpaca_adaptive_rate_limit_keys.up.sql:7` (`'bool', 'true'`).
- Down shape: `054_…down.sql:4-10` — a `DELETE` filtered by namespace, key, environment,
  `user_id IS NULL`, the sentinel and the seeded `value_data`.
- The key is unseeded today: `041_heal_config_keys_to_reader_catalog.up.sql:349` skips it; no
  `broker.paper` row in `scripts/config-wiring-stored.json`; `scripts/config-heal/catalog.tsv:171` is not
  edited (D-6).
- `scripts/config-wiring-stored.json` records each seeded row with its file name (for example `:2620-2621`
  for `054`; `056` at `:965` and `:977`) and an `inputs_sha256`; a mismatch fails `--final` as
  `STALE-STORED` (`scripts/check-config-wiring.mjs:716`).
- Not affected by a new config migration: `scripts/config-heal-dryrun.py:181,188` runs `goto 40` / `goto
  41`; `scripts/migration-rerun.py:554` computes the config end state as the highest version found; no
  file under `scripts/migration-assertions/` names `broker.paper`.
- Sentinel convention: `docs/patterns/config-governance.md:142-144`.

**Lands with**: `Step 6, Step 7, Step 9`

**TDD**: `N/A (migration)`

**Covers**: —

**Instructions**:
1. Run the merge checklist and take the number as max(`origin/main-dev`) + 1 (`057` at the 2026-11-26 re-spec;
   `056` at spec time). Only
   the header comment line carries the file name.
2. Up — one `INSERT` in 054's shape with two tuples:
   `('trading', 'broker.paper', 'bool', 'true', <description>, 'true', 'xstockstrat-trading',
   'system:config-migration-feature-321', 'staging', NULL)` and the same with `'false'` / `'false'` /
   `'production'`, ending `ON CONFLICT (namespace, key, environment, COALESCE(user_id, '')) DO NOTHING`.
   Description, identical on both rows and without an apostrophe:
   `Paper or live for this deployment: true stamps new orders and registers new broker accounts as paper,
   false as live. Seeded per environment (staging true, production false); with no row trading resolves
   paper unless APPLICATION_ENV is production. Read live. Accounts already registered keep routing by their
   own stored mode, so changing this value does not re-route them.`
3. Down — one `DELETE FROM config.config_values WHERE namespace = 'trading' AND key = 'broker.paper' AND
   user_id IS NULL AND updated_by = 'system:config-migration-feature-321' AND ((environment = 'staging' AND
   value_data = 'true') OR (environment = 'production' AND value_data = 'false'));`. A row an operator has
   changed is never deleted.
4. No reseed of `broker.timeout_ms` and no description rewrite of any other key (R-9, D-19).
5. Regenerate the stored set: `DATABASE_URL=<scratch postgres> python3 scripts/config-wiring-stored.py`
   (routes and the blocked case: § Step Dependencies). Commit the output unedited.

**Verification** (offline, no database):
```bash
ls services/xstockstrat-config/migrations/057_trading_broker_paper_per_environment.up.sql \
   services/xstockstrat-config/migrations/057_trading_broker_paper_per_environment.down.sql
ls services/xstockstrat-config/migrations | sort | tail -2     # this pair is the highest number
# read both: the up's two-row INSERT is reversed by the down's sentinel- and value-filtered DELETE
grep -c "057_trading_broker_paper_per_environment.up.sql" scripts/config-wiring-stored.json   # 2
node scripts/check-config-wiring.mjs \
  --declared-from docs/roadmap/features/321-fix-trading-config-plumbing/product-spec.md \
  --declared-migration services/xstockstrat-config/migrations/057_trading_broker_paper_per_environment.up.sql   # exit 0
git diff --stat origin/main-dev -- scripts/config-heal/catalog.tsv services/xstockstrat-trading/internal/config   # empty
```
The generator applies every config migration's `up` on the scratch database (or CI does, on the artifact
route). The `down` is not executed locally: Step 9 pins its SQL text, and the rollback runs in CI
(`migration-rerun`) and at deploy.

---

### Step 9 — test: per-environment seed and a clean wiring gate (AC-4)

**Status**: `done`
**Service**: `xstockstrat-config`
**Files**:
- `services/xstockstrat-config/src/__tests__/brokerPaperSeedMigration.test.ts` — create
- `scripts/config-wiring.json` — modify
- `scripts/config-wiring.test.mjs` — modify

**Reviewers**: xstockstrat-config service owner — config key naming, environment
(`production`/`staging`) / global-per-user scoping; DBA — up+down pair; xstockstrat-trading service owner
(unit reviewers, D-18)

**Codebase Evidence**:
- Test to mirror: `services/xstockstrat-config/src/__tests__/delistingConfirmationSeedMigration.test.ts`
  (`findOne`/`splitStatements` from `./migrationSql`; `HEAD`, `CONFLICT` and `ROW` constants `:11-21`; the
  five cases at `:30`, `:36`, `:49`, `:53`, `:57`). `migrationSql.ts:8-16` `findOne(suffix, ext)` asserts exactly one matching file, so
  the suite fails before Step 8's files exist.
- `scripts/config-wiring.json:5-12` — the single `findings` entry: `trading` / `broker.paper` /
  `read-unseeded`, owner `defect 2026-11-06-trading-broker-paper-env-derived-default-unseedable`.
- `scripts/check-config-wiring.mjs:698-712` `ratchet`: an entry no finding matches prints `STALE:` and
  fails; `:629` produces `read-unseeded`; `:939-941` `--final`.
- `scripts/config-wiring.test.mjs:616-628` test `baseline 2 @AC-8`; `:618`
  `assert.ok(findings.length > 0, 'findings is empty')`; `:609-612` `baseline 1 @AC-7` runs `--final` on
  the real tree; `:627` checks the stored set's `inputs_sha256`.
- CI: job `config-wiring` runs `node --test scripts/config-wiring.test.mjs`,
  `node scripts/check-config-wiring.mjs --final`, `--doc-check` and `python3
  scripts/check-watcher-copies.py` (`.github/workflows/ci.yml:1309-1319`).
- C-16: 304 `@AC-14` (`docs/sdd/business-rules/platform.feature:2095-2100`) is superseded by 321 `@AC-4`
  with operator sign-off (D-10, D-14, context.md 2026-11-20).
- Spec-time prototype: § Execution Summary item 1.

**Lands with**: `Step 6, Step 7, Step 8`

**TDD**: `red-green required`

**Covers**: `AC-4`

**Instructions**:
1. `brokerPaperSeedMigration.test.ts`, mirroring the delisting test with suffix
   `_trading_broker_paper_per_environment` and actor `system:config-migration-feature-321`:
   - the up is exactly one statement, starts with the ten-column `INSERT` head and ends with the
     `ON CONFLICT … DO NOTHING` clause (an existing row is left unchanged);
   - exactly two tuples, both global bool rows for `trading` / `broker.paper` with a non-empty
     description and `consuming_service` `xstockstrat-trading`; the staging tuple has `value_data` and
     `default_value` `'true'`, the production tuple `'false'` — never one literal for both;
   - the stored key is namespace-relative (no `'trading.broker.paper'`);
   - the down is one `DELETE` restricted by the actor, `user_id IS NULL`, namespace, key and the
     per-environment value pair.
   **RED before Step 8:** `findOne` finds no file.
2. `scripts/config-wiring.json`: remove the `broker.paper` entry, leaving `"findings": []`.
3. `scripts/config-wiring.test.mjs:618`: replace the `findings.length > 0` assertion with
   `assert.ok(Array.isArray(findings), 'findings must be an array')`; do not delete it outright and never assert
   an empty baseline (the baseline is a ratchet that later features may refill; the loop below it still checks
   every entry a later feature adds). No other line of that test changes. (impl-spec review warning, resolved
   2026-11-21.)
4. C-13: the test's constants have one consumer; inline is compliant, as in the mirrored test.

**Verification**:
```bash
cd services/xstockstrat-config && pnpm run lint && pnpm run test:coverage && pnpm exec c8 check-coverage --lines 40
cd ../.. && node --test scripts/config-wiring.test.mjs                  # all pass
node scripts/check-config-wiring.mjs --final ; echo "exit $?"           # exit 0
node scripts/check-config-wiring.mjs --final | grep -c "broker.paper"   # 0: no read-unseeded, STALE or other line
node scripts/check-config-wiring.mjs --doc-check && python3 scripts/check-watcher-copies.py
grep -n "__tests__/fixtures" services/xstockstrat-config/src/__tests__/brokerPaperSeedMigration.test.ts ; test $? -eq 1   # C-13: single-consumer inline literal, no fixture home needed
```

---

### Step 10 — proto: fix the stale `TRADING_MODE env` comment on `is_paper`

**Status**: `pending`
**Service**: `packages/proto`
**Files**:
- `packages/proto/trading/v1/trading.proto` — modify

**Reviewers**: Proto Reviewer — no breaking changes without deprecation comment, `buf lint` passes,
`buf breaking` passes; xstockstrat-trading service owner — paper-only dev invariant

**Codebase Evidence**:
- `packages/proto/trading/v1/trading.proto:260-266` `RegisterBrokerAccountRequest`; the comment at
  `:263-265` reads "paper/live is owned by the deployment environment (trading.broker.paper config key /
  TRADING_MODE env). The server derives is_paper from the environment and ignores this field."; the field
  is `bool is_paper = 3 [deprecated = true];` at `:266`.
- `docs/runbooks/proto-versioning.md:15`: adding comments or documentation is not a breaking change.
- No other `.proto` names the `TRADING_MODE` env (grep over `packages/proto/**/*.proto` at `b5756b2`).

**Lands with**: `Step 11`

**TDD**: `N/A (proto)`

**Covers**: —

**Instructions**:
1. Rewrite only the comment at `:263-265`: paper/live is owned by the deployment environment — the
   `trading.broker.paper` config key, seeded per environment, with `APPLICATION_ENV` as the fallback when
   the row is absent; the server derives `is_paper` from it and ignores this field.
2. The field name, number `3`, type and `[deprecated = true]` are unchanged. No other line changes.

**Verification**:
```bash
cd packages/proto && buf lint && buf breaking --against "../../.git#branch=origin/main-dev,subdir=packages/proto"   # against main-dev, never the feature branch (vacuous after the commit); CI's breaking check excludes trading/v1/trading.proto (ci.yml:253), so this local run is the only real check (C-09)
cd ../.. && git diff -U0 origin/main-dev -- packages/proto/trading/v1/trading.proto | grep '^[+-]' | grep -v '^+++\|^---' | grep -v '^[+-] *//' ; test $? -eq 1   # only comment lines changed
grep -n "TRADING_MODE env" packages/proto/trading/v1/trading.proto ; test $? -eq 1
```
`buf` is not on this host's `PATH` at spec time; provision it per
`docs/runbooks/codegen-toolchain-host-setup.md` or use the `Dockerfile.codegen` container.

---

### Step 11 — proto-gen: regenerate the stubs

**Status**: `pending`
**Service**: `packages/proto`
**Files**:
- `packages/proto/gen/go/trading/v1/trading.pb.go` — modify (regenerated)
- `packages/proto/gen/ts/trading/v1/trading.ts` — modify (regenerated)
- `packages/proto/gen/ts/trading/v1/trading_pb.ts` — modify (regenerated)
- `packages/proto/gen/ts/dist/trading/v1/trading.d.ts` — modify (regenerated)
- `packages/proto/gen/ts/dist/trading/v1/trading_pb.d.ts` — modify (regenerated)

**Reviewers**: Proto Reviewer, xstockstrat-trading service owner (inherited from Step 10)

**Codebase Evidence**:
- The five files above are the generated files that carry the comment text
  (`grep -rln "TRADING_MODE env" packages/proto/gen` at `b5756b2`). Generated stubs are never read or
  edited by hand (root `CLAUDE.md` § Key File Paths).
- `scripts/buf-gen.sh` generates the TypeScript, Python and Go stubs and compiles the TS package; CI job
  `proto-freshness` requires an empty diff after it.
- No descriptor-parity guard is involved: a comment adds no field.

**Lands with**: `Step 10`

**TDD**: `N/A (proto-gen)`

**Covers**: —

**Instructions**:
1. Validate the toolchain against the committed stubs before the proto edit
   (`docs/runbooks/codegen-toolchain-host-setup.md` § 5), then run `./scripts/buf-gen.sh` after Step 10.
2. Stage only the regenerated files that changed. If a file outside the list above changes, the toolchain
   version is off: stop and reconcile against `Dockerfile.codegen` (do not commit the drift).

**Verification**:
```bash
./scripts/buf-gen.sh
git diff --stat -- packages/proto/gen            # only trading files
grep -rn "TRADING_MODE env" packages/proto/gen ; test $? -eq 1
cd services/xstockstrat-trading && GOWORK=off go build ./...
```

---

### Step 12 — docs: trading CLAUDE.md, config-governance log, findings

**Status**: `pending`
**Service**: `services/xstockstrat-trading/`, `docs/patterns/`, `docs/`
**Files**:
- `services/xstockstrat-trading/CLAUDE.md` — modify
- `services/xstockstrat-trading/docs/context-constitution-findings.md` — modify
- `docs/patterns/config-governance.md` — modify
- `docs/context-constitution-findings.md` — modify

**Reviewers**: none

**Codebase Evidence**:
- `services/xstockstrat-trading/CLAUDE.md`: `:13` "Paper vs live … falling back to the `TRADING_MODE` env
  var"; `:21` registration mode "(`trading.broker.paper` config / `TRADING_MODE` env)"; `:81`
  `broker.paper` row (default `true`); `:82` `broker.timeout_ms` row ("Alpaca broker HTTP call timeout");
  `:85` `ibkr.handshake_timeout_ms` row ("Independent of `IBKRRequestTimeout`"); `:90`
  `order_intent.stale_multiplier` row (`max(live trading.broker.timeout_ms, IBKRRequestTimeout)`); `:103`
  "`broker.timeout_ms` also bounds …"; `:115-117` Approval Flow; `:181-186` Adaptive rate limit table;
  `:231` `TRADING_MODE=paper` in the env block.
- `services/xstockstrat-trading/docs/context-constitution-findings.md`: `:24` the IBKR hardcoded-10 s row;
  `:25` the `requires_approval` row; `:43` the `NewWatcher` `tradingMode` open question; `:45` Resolved
  section; `:59-71` the filed-reports table (the merge added one latent-bug row at `:30`).
- `docs/patterns/config-governance.md`: `:146-150` the append-only Per-Feature Registered Keys log (newest
  first; first entry `:152` feature 366, then `:173` feature 330); older entries name `IBKRRequestTimeout`
  at `:378` (feature 249) and `:955` (feature 101) and are not edited. Lines re-grounded after the
  `f802b184` main-dev merge.
- `docs/context-constitution-findings.md:23`: "trading still uses it as the fallback for
  `trading.broker.paper` (`trading.go#environmentIsPaper`)".
- Stored descriptions that go stale and are recorded, not rewritten (D-19):
  `scripts/config-wiring-stored.json:4546` and `:4558` (`broker.timeout_ms`: "Alpaca broker HTTP call
  timeout. Read at account-client construction…") and the `order_intent.stale_multiplier` rows naming
  `IBKRRequestTimeout`.
- `internal/service/trading.go:2841` — the credential poller's hardcoded `5*time.Second`
  (`validateAndRecordCredential`), which ignores `broker.timeout_ms`.
- `scripts/check-config-wiring.mjs:862` `DOC_BANNED` phrases checked by `--doc-check`.

**TDD**: `N/A (docs)`

**Covers**: —

**Instructions**:
1. Trading `CLAUDE.md`:
   - `:13`, `:21`: mode comes from the account's persisted `is_paper` and `trading.broker.paper` (seeded
     per environment); with no row, paper unless `APPLICATION_ENV` is `production`. `TRADING_MODE` no
     longer affects trading's paper/live.
   - `:81`: default "environment-derived: paper unless `APPLICATION_ENV=production`; seeded staging `true`,
     production `false`"; note that changing it does not re-route registered accounts.
   - `:82`: the timeout of each Alpaca request and each signed IBKR request, read live.
   - `:85`: independent of `broker.timeout_ms` (the handshake keeps its own bound).
   - `:90`: `max(live trading.broker.timeout_ms, 10 s)` — the floor is `broker.IBKRDefaultHandshakeTimeout`.
   - `:115-117`: an approval-required order is persisted with `requires_approval = true`;
     `approved_by` / `approved_at` are not written.
   - `:181-186`: add rows `10 s | 3.0 | 30 s | 10 s (single attempt)` and `10 s | 4.0 | 40 s | 20 s`.
   - `:231`: mark `TRADING_MODE` as no longer read for paper/live in trading (cleanup: feature 322).
2. Trading findings: move `:24` and `:25` to Resolved (feature 321; `:25` narrowed — `approved_by` /
   `approved_at` remain unwritten). Add open rows: the credential poller's hardcoded 5 s; the two stale
   stored descriptions above; the IBKR call chain (handshake + T + re-init + T) equal to S with no margin
   and a conid-lookup timeout leaving the order PENDING; no check asserts the `APPLICATION_ENV` pairing for
   the DigitalOcean app specs. Extend `:43` with `Config.TradingMode` (no reader in the service after 321;
   left to feature 322). Leave the filed-reports table as is until the reports are resolved.
3. `docs/patterns/config-governance.md`: add `### feature 321 — fix-trading-config-plumbing
   (`xstockstrat-trading` / `xstockstrat-config`)` as the newest entry: directly below the log's
   introductory paragraphs and above the feature-366 entry (`:152`), keeping newest-first order. Content: `broker.timeout_ms`
   also bounds every signed IBKR request; the stale-threshold floor is the 10 s
   `IBKRDefaultHandshakeTimeout` (supersedes the feature-249 and feature-101 wording, which stays
   unedited); `broker.paper` is seeded per environment by migration `trading_broker_paper_per_environment`
   with the actor `system:config-migration-feature-321`, read by `environmentIsPaper`, fallback
   `APPLICATION_ENV`; the `scripts/config-wiring.json` baseline is empty. Approval: DBA + config owner +
   trading owner. One key table with the two keys. Avoid the `DOC_BANNED` phrases.
4. Root findings `:23`: trading no longer uses `TRADING_MODE` as the `broker.paper` fallback (feature
   321); the rest of the row stands.

**Verification**:
```bash
grep -n "IBKRRequestTimeout" services/xstockstrat-trading/CLAUDE.md ; test $? -eq 1
grep -n "feature 321" docs/patterns/config-governance.md services/xstockstrat-trading/docs/context-constitution-findings.md docs/context-constitution-findings.md
git diff -U0 origin/main-dev -- docs/patterns/config-governance.md | grep '^-[^-]' ; test $? -eq 1   # append-only: no line removed
node scripts/check-config-wiring.mjs --doc-check    # exit 0
python3 scripts/check-context-map.py                # exit 0
```

---

### Step 13 — config: operator-only stored-state check before the integration PR leaves draft

**Status**: `pending`
**Service**: `xstockstrat-trading` (config values held by `xstockstrat-config`)
**Files**:
- `docs/roadmap/features/321-fix-trading-config-plumbing/context.md` — modify (the record; no other file)

**Reviewers**: xstockstrat-trading service owner — broker API safety, order execution correctness

**Codebase Evidence**:
- Design D-13, D-16, D-20; operator ruling "production is out of the pre-deploy action" (context.md,
  2026-11-20).
- Already recorded (context.md, 2026-11-20): DO staging `broker.timeout_ms` 5000 → 10000 at
  `2026-11-20T13:59:10Z` and `order_intent.stale_multiplier` 3.0 → 4.0 at `13:59:12Z`; homelab staging the
  same two edits at `13:59:38Z` and `13:59:39Z`.
- Both keys are seeded by `041` (int `5000`, float `3`); `SetConfig` never changes a row's `value_type`
  (`services/xstockstrat-config/src/grpc/configServiceImpl.ts:838-850`: the upsert's `DO UPDATE SET` omits
  `value_type`; re-grounded after the `f802b184` main-dev merge).
- The stored description of `broker.timeout_ms` is Alpaca-only
  (`scripts/config-wiring-stored.json:4546`, `:4558`); after Steps 1–2 the key also bounds IBKR signed requests.

**TDD**: `N/A (config, operator-only)`

**Covers**: —

**Instructions**:
1. This step changes no reader and seeds no key; it adds no migration. It is run by the operator (or on
   the operator's instruction), not by the execute loop on its own.
2. Just before the integration PR leaves draft, read back on each staging deployment (DO staging and
   homelab staging): `trading` / `broker.timeout_ms` and `trading` / `order_intent.stale_multiplier`.
3. Pass condition (stored state): `broker.timeout_ms` is an int `>= 10000` and
   `order_intent.stale_multiplier` is `>= 4.0` on both, each with a `config.config_audit` row. A value
   above 10000 is recorded too, since it raises S and IBKR's bound.
4. Record the read-back values and time in `context.md`. If a value was reverted, re-apply it through
   `SetConfig` (never through a migration, R-9) and record the new audit time.
5. Production is not checked (never launched). Keep the Open Thread: at first launch its `trading` config
   must reach the same values before trading goes live there.

**Verification**:
```bash
grep -n "pre-deploy" docs/roadmap/features/321-fix-trading-config-plumbing/context.md   # the 2026-11-20 record and the re-check entry
```
The re-check entry names both staging deployments, both keys, the read-back values and the time. The
integration PR is a draft until it exists.

---

## Deviation Log

_Populated by /sdd-execute as implementation proceeds._

### Step 4 — RED captured with a transient, uncommitted probe test (2026-11-27)
- **Spec said**: Step 4 is `TDD: red-green required`; its paired test is Step 5, which runs after it, and Step 4's own Verification passes before the change (impl-spec review warning "Step 5: say how the RED before Step 4 run is captured").
- **Actual**: a transient `TestTransientStep4RedProbe` (PENDING_APPROVAL → true, NEW → false at arg index 16) was appended to `internal/repository/trading_repo_test.go`, the Verification block run RED (`argument 16 expected [bool - true] does not match actual [bool - false]`), the bind changed, run GREEN, then the probe reverted with `git checkout` before a final Verification run. Nothing outside Step 4's **Files** is committed; Step 5 authors the real AC-3 tests.
- **Disposition**: RED-capture method only; no scope or behavior change.

### Step 5 — RED captured by transiently reverting Step 4's bind (2026-11-27)
- **Spec said**: "RED before Step 4" for both AC-3 tests, but Step 4 is already committed (`2ffd368d`) when Step 5 runs.
- **Actual**: the `trading_repo.go` bind was set back to `false` in the worktree, the Verification block run RED (both new tests fail on the bound value), then the file restored with `git checkout` before the GREEN run. Not committed; `trading_repo.go` is unchanged by this step.
- **Disposition**: RED-capture method only; no scope or behavior change.

### Steps 6+7+8+9 — stored set regenerated on an operator-authorized scratch database (2026-11-27)
- **Spec said**: Step 8 Instruction 5 regenerates `scripts/config-wiring-stored.json` with `DATABASE_URL=<scratch postgres> python3 scripts/config-wiring-stored.py`; § Step Dependencies requires the route to be confirmed first, and SKILL.md never lets the execute agent start a database.
- **Actual**: the operator authorized (go-ahead of 2026-11-26) a local throwaway PostgreSQL 16 that the main session provisioned and kept running; this agent started or stopped no database. The generator ran once against it (route (a)); `scripts/scratch_db.py` created and dropped its own scratch DB. The output is committed unedited: two `broker.paper` rows (`057_…up.sql`, staging `true` / production `false`) and a new `inputs_sha256`. Migration number re-checked: `origin/main-dev` tail is `056_analysis_live_only_cycle_max_days`, so `057` stands (`057` also exists on feature 314's branch only, not on main-dev). Verification stayed offline; the database was used for artifact generation only.
- **Disposition**: operator-authorized generation route; no scope or behavior change.
