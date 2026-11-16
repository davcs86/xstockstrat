# Implementation Spec: alpaca-adaptive-rate-limit

**Status**: `pending`
**Created**: 2026-11-16
**Feature**: `docs/roadmap/features/347-alpaca-adaptive-rate-limit/feature.md`
**Total Steps**: 12
**Feature Branch**: `feature/alpaca-adaptive-rate-limit`
**Tree**: `ccr-47ce6aaf-i0ffis@4e594d1 ≡ origin/ccr-47ce6aaf-i0ffis` (contains `origin/main-dev@5730505`)

Paths are relative to the repo root. Short forms used below: `marketdata/` =
`services/xstockstrat-marketdata/`, `trading/` = `services/xstockstrat-trading/`, `config/` =
`services/xstockstrat-config/`. Every line number was read on the tree above.

---

## Execution Summary

The work follows `design.md` § 7: the shared pacing core first (Steps 1-2), then the marketdata client
and its loops (Steps 3-6), then the trading client and the trading service code around it (Steps 7-10),
and the config seed last (Steps 11-12). The core comes first because both clients import it. The seed
comes last so that both readers already exist when it lands; until then Steps 3 and 7 baseline their
unseeded read in `scripts/config-wiring.json` and Step 11 removes both entries. Three service/test
pairs are atomic units (1+2, 5+6, 9+10); the other three (3/4, 7/8, 11/12) are ordinary pairs. Trading's
service changes (Step 9) come after the trading client (Step 7) because their tests drive a real
`broker.NewClient` and because AC-36 only fails once the client retries.

Consumer surface (C-14): **None — internal/platform-only**. No RPC, response field, UI page or agent
tool changes; operators reach the two kill switches through the existing generic config surfaces. No
UI or agent step is required, by decision.

No proto change, no service-schema migration, no new env var, port or outbound gRPC call
(`grep -n "ADAPTIVE\|adaptive_rate" docker-compose.yml .do/app.dev.yaml .do/app.yaml` → none).

## Spec-time decisions to confirm at `/sdd-review impl-spec`

Each of these is a choice this spec made where `design.md` was silent or where a pipeline rule forced
a detail. None changes the Chosen Approach.

1. **Verified tree.** `origin/feature/alpaca-adaptive-rate-limit` does not exist yet, so
   `docs/sdd/tree-freshness.md` would name `main-dev` as the target. The feature's artifacts exist only
   on the harness branch, which contains `origin/main-dev@5730505`, so discovery ran there (same
   deviation as the earlier sessions in `context.md`).
2. **Discovery was done inline**, not by `codebase-discovery` subagents (this session cannot spawn
   them). `recon.md` evidence was reused and every cited line was re-read after the `main-dev` merge.
3. **Three of the six service/test pairs are atomic units** (1+2, 5+6, 9+10), the three where a
   `step-constraints.md` §C trigger applies (copy-gate group naming the test file, signature change, new
   interface method). Pairs 3/4, 7/8 and 11/12 are not units: the earlier step passes its own
   Verification alone and the RED is captured per `tdd-gate.md`.
4. **Step 11 is category `migration`** (reviewers: DBA + `xstockstrat-config` owner), where the design
   table says "config". Precedent: feature 341 Step 7. This adds the DBA to the reviewer snapshot.
5. **`pace_test.go` is an in-package test** (`package alpacapace`). An external test package would
   import a per-module path and the two copies could not be byte-identical (D-1).
6. **`export_test.go` also exposes the HTTP transport** in both client packages. `design.md` names the
   `now`, `sleep` and `jitter` seams only, but AC-6, AC-18, AC-21 and AC-23 assert a real Alpaca host
   name in an error or log, which needs the request URL to keep that host while a test `RoundTripper`
   answers.
7. **The trading budget closure is a named method**, `(*TradingService).alpacaRateLimitBudget`, passed
   as `RateLimitBudget: s.alpacaRateLimitBudget`. `design.md` § 4 writes it inline. D-30 requires the
   service tests to use "the same closures as `instantiateBrokerLocked`"; a method value is the only way
   to share that code with a test. Precedent: `Timing: s.ibkrTiming` (`trading/internal/service/trading.go:3257`).
8. **The budget table test moves from Step 10 to Step 8** (`trading_rate_limit_test.go` is created in
   Step 8 and extended in Step 10). `design.md` § 7 creates the file at S10. `rateLimitBudget` is
   written in Step 7, and P-06 needs its failing test in the same unit.
9. **Texts fixed here** (AC-37 and the design's open thread): the three config descriptions in Step 11,
   and the log messages and error formats in Steps 3 and 7.
10. **Guards.** `design.md` lists AC-2, AC-7, AC-20, AC-24 and AC-36 as passing on today's code. Read
    against the code, AC-8, AC-9, AC-10 and AC-11 also describe behavior today's code already has.
    Each test step names the mutant that turns its guards red (ledger `insights.md` ~L4363).
11. **Config-wiring mode.** CI runs `check-config-wiring.mjs --final` on every PR
    (`.github/workflows/ci.yml:1239-1240`), and an unseeded read fails it
    (`scripts/check-config-wiring.mjs:629-631`). Steps 3 and 7 therefore each add one temporary
    `findings` entry to `scripts/config-wiring.json`
    (`{"namespace": "marketdata", "key": "alpaca.adaptive_rate_limit_enabled", "kind": "read-unseeded", "owner": "feature 347 alpaca-adaptive-rate-limit"}`
    and the `trading` / `broker.adaptive_rate_limit_enabled` equivalent). Step 11 removes both, so a
    stale entry never reaches `--final`. Precedent: feature 341 Step 7 / Step 11.
12. **Filed separately:** the pre-existing `ReplaceOrder` defect (intent inserted before `validateTIF`)
    is recorded in `docs/reports/2026-11-16-replace-order-tif-validation-after-intent-claim-defect.md`
    (operator-confirmed, 2026-11-16). It is not fixed by this feature.
13. **The marketdata kill-switch reader is a named helper**, `alpacaAdaptiveRateLimit(cfgWatcher)` in
    `cmd/server/main.go`, where `design.md` § 2 reads the key inline in the settings closure. A helper
    is the only way a test can build a config snapshot and assert the real reader returns the seeded
    value. Precedent: `fundamentalsProvider(cfgWatcher)` (`marketdata/cmd/server/main.go:215`).
14. **Test names.** Every scenario test is named `Test<Subject>_F347_AC<N>`, ending in the scenario
    number (a Go name cannot hold the hyphen), so `-run 'F347_AC(…)\b'` selects only this feature's
    tests. A Scenario Outline (AC-13, AC-21) is one test with one subtest per Examples row.

## Scenario Coverage (C-15)

| Scenario | Steps | Scenario | Steps | Scenario | Steps |
|---|---|---|---|---|---|
| AC-1 | 2, 4 | AC-14 | 4 | AC-27 | 8, 10 |
| AC-2 | 4 | AC-15 | 8 | AC-28 | 10 |
| AC-3 | 2, 4 | AC-16 | 8 | AC-29 | 10 |
| AC-4 | 4 | AC-17 | 8 | AC-30 | 10 |
| AC-5 | 2, 4 | AC-18 | 8 | AC-31 | 10 |
| AC-6 | 4 | AC-19 | 2, 4 | AC-32 | 6 |
| AC-7 | 4 | AC-20 | 8 | AC-33 | 6 |
| AC-8 | 4 | AC-21 | 4 | AC-34 | 10 |
| AC-9 | 4 | AC-22 | 4 | AC-35 | 10 |
| AC-10 | 8 | AC-23 | 8 | AC-36 | 10 |
| AC-11 | 4 | AC-24 | 2, 4 | AC-37 | 12 |
| AC-12 | 8, 10 | AC-25 | 10 | | |
| AC-13 | 2, 8 | AC-26 | 10 | | |

Step 2 covers only the core arithmetic behind its scenarios; the scenario's full Given/When/Then is in
the client or service step listed beside it.

## Step Dependencies

- Steps 1+2 land together: the new `check-watcher-copies` groups name `pace_test.go`, which Step 2
  creates, and `scripts/tests/test_check_watcher_copies.py::test_the_real_tree_is_clean` reads the real
  tree (§C row 3). RED is captured with `pace.go` present as signatures returning zero values.
- Steps 5+6 land together: Step 5 changes three method signatures in a package with `_test.go` files;
  the 11 existing call sites are edited in Step 6 (§C row 1).
- Steps 9+10 land together: the new `OrderIntentRepository` method breaks the compile of
  `fakeReconciliationOrderIntentRepo` (`trading/internal/service/trading_reconciliation_test.go:865`),
  which Step 10 repairs (§C row 1).
- Steps 3/4, 7/8 and 11/12 are ordinary service/test pairs, not units: each earlier step passes its
  own Verification alone. Their RED is captured per `tdd-gate.md` — Step 4 with Step 3's fields and
  seams present and `do` still a single attempt; Step 8 with `ErrRateLimited`, `RateLimitBudget`,
  `rateLimitBudget` (returning 0) and the seams present and `do` unchanged; Step 12 with Step 11's
  files absent.
- Step 3 requires Step 1. Step 7 requires Step 1. Step 5 requires Step 3 only for AC-33's meaning (a
  rate-limited fetch is an error); it compiles without it.
- Step 9 requires Step 7 (`broker.ErrRateLimited`). Step 10 requires Step 8 (`trading_rate_limit_test.go`
  exists) and Step 7 (AC-36 fails only once the client retries).
- Step 11 requires Steps 3 and 7: `node scripts/check-config-wiring.mjs --final` needs both readers.
  Steps 3 and 7 baseline their `read-unseeded` finding in `scripts/config-wiring.json`; Step 11 removes
  both.
- The trading `CLAUDE.md` key row and default land in Step 9, before Step 11 seeds the key.
- Step 11 needs a reachable Postgres 16 plus `psql` and `migrate` on `PATH` to **generate**
  `scripts/config-wiring-stored.json` (`scripts/config-wiring-stored.py:1-6`). This is artifact
  generation, not verification. On the spec-time sandbox `psql` is present and `migrate` is not; the CI
  job builds `scripts/Dockerfile.migrate` for it (`.github/workflows/ci.yml:1274-1282`) and then checks
  the fresh heal dry-run (`:1284-1290`); Step 11 gives both commands. If the set cannot be generated the
  step is blocked (P-03); the JSON is never edited by hand.
- **Volatile at merge:** config `052` is the next free number on this tree (341 landed `050`, 343 landed `051`)
  (`ls config/migrations | tail -1` → `050_ui_chart_history_bars.up.sql`). Features 343 and 330 still
  name `050` on their branches (`docs/roadmap/features/merge-order.md:413-417`). Re-derive the number at
  Step 11 and at the integration PR; a renumber means regenerating `scripts/config-wiring-stored.json`.
  Step 12's lookup is number-free.
- `marketdata/internal/alpaca/client.go` is also edited by features 322 and 323 in other hunks
  (`merge-order.md:417-419`); whichever merges second re-greps its anchors.
- Before the Step 11 unit merges: owner + config-team approval for the two new keys
  (`docs/runbooks/approval-flow.md`, root `CLAUDE.md` § Approval Flow).
- **Open risks carried from `design.md`, with their step:** pollers always skip spreading → Step 8
  (one-attempt test); clamp row (T 10 s, ×1.5) and the 1 s margin row → Step 8 budget table, documented
  in Step 9; Trading API headers undocumented → Step 8 (FR-5 case), a real paper-host response is
  recorded at the integration PR; exhausted-window interactive latency → Step 4 (AC-6, AC-21);
  REJECTED flatten orders under a hold, the short-deadline REJECTED submit and the first delete path on
  `trading.order_intents` → documented in Step 9.
- C-16 promotion of the scenarios into the durable suites happens at the integration PR. Scenarios
  that hard-code jitter or core arithmetic stay feature-local (D-24).

---

### Step 1 — service: pacing core `internal/alpacapace` in both services, with copy governance

**Status**: `done`
**Service**: `xstockstrat-marketdata`, `xstockstrat-trading`, `scripts/`
**Files**:
- `services/xstockstrat-marketdata/internal/alpacapace/pace.go` — create
- `services/xstockstrat-trading/internal/alpacapace/pace.go` — create (byte-identical copy)
- `scripts/check-watcher-copies.py` — modify
- `.jscpd.json` — modify
- `docs/patterns/dry-guard-rail.md` — modify

**Reviewers**: `xstockstrat-marketdata` owner — OHLCV ingestion integrity, Alpaca feed idempotency; `xstockstrat-trading` owner — order execution correctness, broker API safety

**Codebase Evidence**:
- **Not found** — no `internal/alpacapace` directory exists in either service (`ls marketdata/internal trading/internal`); no `X-RateLimit-*` or `Retry-After` parsing exists in either service (recon § Risks). Both files are new.
- Byte-identical per-module copies are an existing, CI-checked pattern: `scripts/check-watcher-copies.py:13-35` (`COPIES` groups `go`, `py`, `py-limits`, `node`), run by CI at `.github/workflows/ci.yml:1245-1246`.
- `.jscpd.json:35-46` lists every governed copy by path; `**/*_test.go` is already ignored (`.jscpd.json` ignore list), so only the two `pace.go` files need entries.
- The exemption text lives at `docs/patterns/dry-guard-rail.md:87-99` ("This exemption names only these files").
- The two services are separate Go modules: `github.com/xstockstrat/marketdata` and `github.com/xstockstrat/trading` (`trading/go.mod:1`); CI runs `GOWORK=off` (`.github/workflows/ci.yml:376-377`).
- Jitter precedent: `math/rand/v2` in `trading/internal/config/watchcore.go:220`. The core itself draws no jitter (it is passed in).
- Lint: `goimports` with `local-prefixes: github.com/xstockstrat` (`trading/.golangci.yml:18-24`); the core imports the standard library only, so both copies format identically.

**Lands with**: `Step 2`

**TDD**: `red-green required`

**Covers**: —

**Instructions**:
1. Create `marketdata/internal/alpacapace/pace.go`, `package alpacapace`, standard library imports only (`hash/maphash`, `net/http`, `strconv`, `sync`, `time`). No I/O, sleep, logging or randomness; one mutex guards the pacer's own state.
2. Exported surface, exactly as `design.md` § 1:
   - Constants `Window = 60 * time.Second`, `ResetSlack = 5 * time.Second`, `LowWaterRatio = 10`, `BackoffBase = time.Second`, `BackoffCap = 8 * time.Second`, `MaxJitter = 500 * time.Millisecond`.
   - `type Key struct{ host string; cred uint64 }`, `type Headers struct{ Limit, Remaining int; Reset time.Time }`, `type Reservation struct{ Wait time.Duration; Fits bool }`.
   - `ParseHeaders(h http.Header) (Headers, bool)` — true only when `X-RateLimit-Limit`, `X-RateLimit-Remaining` and `X-RateLimit-Reset` all parse with `Limit > 0`, `Remaining >= 0`, `Reset > 0` (Unix seconds).
   - `ParseReset(h http.Header) (time.Time, bool)` — `X-RateLimit-Reset` alone.
   - `NewPacer() *Pacer`; `(*Pacer).Key(host, apiKey string) Key` — `cred` is a `maphash` of the key under a per-process random seed; an empty key is valid; no key material is stored.
   - `(*Pacer).Observe(k Key, h Headers, now time.Time)`, `(*Pacer).Reserve(k Key, now, latest time.Time, jitter time.Duration) Reservation`, `(*Pacer).WarnOnce(k Key, now, until time.Time) bool`, `RetryWait(attempt int, now, reset time.Time, jitter time.Duration) time.Duration`.
3. `Observe`: accept the headers only when `now < Reset <= now + Window + ResetSlack`; store `Reset` clamped to `now + Window`; within one stored `Reset`, `remaining = min(observed, local)`; replace the state only when `Reset` advances; `nextSlot` never moves backwards; prune windows whose `Reset` has passed.
4. `Reserve`: implement the seven-row table of `design.md` § 1 row for row. A zero wait is never fit-tested and always returns `{0, true}`. Jitter is added only to a non-zero wait. A hold (`remaining == 0`) reserves nothing and returns `Fits = now + min(Reset − now, Window) <= latest`.
5. `RetryWait`: `min(reset − now, Window) + jitter` when `reset` is non-zero and after `now` (no range filter); otherwise `min(BackoffBase << (attempt − 1), BackoffCap) + jitter`, `attempt` counted from 1.
6. `WarnOnce`: true the first time it is called for `k` in a throttled window ending at `until`, false for later calls until `now` passes that `until`.
7. Copy the finished file byte for byte to `trading/internal/alpacapace/pace.go`.
8. `scripts/check-watcher-copies.py`: add two groups to `COPIES` — `"go-alpacapace"` (the two `pace.go` paths) and `"go-alpacapace-test"` (the two `pace_test.go` paths). Update the one-line module docstring to name the pacing core.
9. `.jscpd.json`: add the two `pace.go` paths to `ignore`, after line 37 (the marketdata `watchcore.go` entry).
10. `docs/patterns/dry-guard-rail.md`: add one exemption bullet after the watcher-core bullet (`:87-99`) naming the four files, the reason (each Go module builds on its own; R-1 rejected a shared module) and the gate (`scripts/check-watcher-copies.py`, groups `go-alpacapace` and `go-alpacapace-test`). End it with "This exemption names only these files."
11. Comments: constraints only, two lines at most (root `CLAUDE.md` § How to Act #5).

**Verification**:
```bash
cmp services/xstockstrat-marketdata/internal/alpacapace/pace.go services/xstockstrat-trading/internal/alpacapace/pace.go
(cd services/xstockstrat-marketdata && GOWORK=off go build ./...)
(cd services/xstockstrat-trading && GOWORK=off go build ./...)
python3 scripts/check-watcher-copies.py     # "all groups byte-identical" (needs Step 2's files)
grep -n "alpacapace" .jscpd.json docs/patterns/dry-guard-rail.md scripts/check-watcher-copies.py
```

---

### Step 2 — test: core arithmetic and the copy gate

**Status**: `done`
**Service**: `xstockstrat-marketdata`, `xstockstrat-trading`, `scripts/`
**Files**:
- `services/xstockstrat-marketdata/internal/alpacapace/pace_test.go` — create
- `services/xstockstrat-trading/internal/alpacapace/pace_test.go` — create (byte-identical copy)
- `scripts/tests/test_check_watcher_copies.py` — modify

**Reviewers**: `xstockstrat-marketdata` owner — Alpaca feed idempotency; `xstockstrat-trading` owner — broker API safety

**Codebase Evidence**:
- `scripts/tests/test_check_watcher_copies.py` loads the script with `load_script("check-watcher-copies.py")` and already asserts drift, a missing copy and group independence generically over `wc.COPIES`; `test_the_real_tree_is_clean` runs `wc.problems` on the real tree.
- Scripts tests run with `cd scripts && uv run --extra dev pytest` (`docs/patterns/script-tooling.md:33`); CI job at `.github/workflows/ci.yml:862-894`.
- `internal/alpacapace` is a measured package: the coverage filter excludes only `cmd|handler|repository|telemetry|service` (`.github/workflows/ci.yml:374`).
- C-13: the tests use header values and instants only; no domain literal gets a second consumer.

**Lands with**: `Step 1`

**TDD**: `red-green required`

**Covers**: `AC-1, AC-3, AC-5, AC-13, AC-19, AC-24` (core arithmetic only)

**Instructions**:
1. `pace_test.go` is `package alpacapace` (in-package) with standard library imports only, so both copies stay byte-identical. It is the only test home of core arithmetic (D-1). Every case uses a fixed `now`; nothing sleeps.
2. Cases, one named test or table row each:
   - `ParseHeaders`: all three present → ok; any one missing, non-numeric, `Limit` 0, negative `Remaining` or `Reset` 0 → not ok. `ParseReset` with only `X-RateLimit-Reset` → ok.
   - `Reserve` with no state, and with a `Reset` in the past → `{0, true}`, no state change.
   - Above low-water (`Remaining 150`, `Limit 200`) → `{0, true}`.
   - AC-3 arithmetic: `Limit 200`, `Remaining 4`, `Reset = now + 4 s`, `latest = now + 30 s`, jitter 0: four `Reserve` calls at the same `now` return waits 0, 1 s, 2 s, 3 s, all `Fits`.
   - AC-24 arithmetic: after the first slot is reserved, a `Reserve` with `latest = now + 500 ms` returns `{0, true}`, lowers local remaining by one and leaves `nextSlot` unchanged (a later long-deadline `Reserve` still gets the 1 s slot).
   - AC-1 arithmetic: `Remaining 0`, `Reset = now + 3 s`: fits when `latest >= now + 3 s`, returns `Wait = 3 s + jitter`; does not fit when `latest < now + 3 s`; nothing is reserved either way.
   - Zero wait always sends: a no-state `Reserve` with `latest` before `now` still returns `{0, true}` (D-28b).
   - Jitter boundary: a slot less than `MaxJitter` before `latest` is not committed and then failed (D-15).
   - Jitter is add-only and absent on a zero wait: with jitter 400 ms a zero wait returns exactly 0, a 1 s slot returns 1.4 s.
   - `Observe` ordering: a later response reporting a higher `Remaining` for the same `Reset` does not raise the local count; a response with an advanced `Reset` replaces the state; `nextSlot` never moves backwards.
   - `Reset` filter and clamp: a `Reset` 66 s ahead changes nothing; one 62 s ahead is stored clamped to `now + 60 s`, and its hold fits exactly when `now + 60 s <= latest` (O-29).
   - AC-5 and AC-13 arithmetic: `RetryWait` with no reset for attempts 1..5 is 1, 2, 4, 8, 8 s plus jitter.
   - AC-19 arithmetic: `RetryWait` with `reset = now + 3600 s` is 60 s plus jitter; with a reset in the past it falls back to backoff.
   - Keys: `Key(host, "KEY-A") != Key(host, "KEY-B")`; a different host gives a different key; `Key(host, "")` is usable; state under one key does not affect a `Reserve` under another.
   - `WarnOnce`: true once per window, false until that window's `until` has passed, then true again.
3. Copy the finished file byte for byte to the trading module.
4. `scripts/tests/test_check_watcher_copies.py`: add one test asserting that groups `go-alpacapace` and `go-alpacapace-test` exist and that each lists exactly one path under `services/xstockstrat-marketdata/` and one under `services/xstockstrat-trading/`. The existing generic tests already cover drift and a missing copy for the new groups.
5. RED: with `pace.go` reduced to signatures returning zero values, the `pace_test.go` cases fail on assertions; with the two groups absent from `COPIES`, the new pytest fails.

**Verification**:
```bash
cmp services/xstockstrat-marketdata/internal/alpacapace/pace_test.go services/xstockstrat-trading/internal/alpacapace/pace_test.go
for s in xstockstrat-marketdata xstockstrat-trading; do (cd services/$s && GOWORK=off golangci-lint run --modules-download-mode=mod && GOWORK=off go test ./internal/alpacapace/... -race -count=1 -cover) || exit 1; done   # alpacapace coverage >= 40%
(cd scripts && uv run --extra dev pytest tests/test_check_watcher_copies.py && uv run --extra dev ruff check . && uv run --extra dev ruff format --check .)
python3 scripts/check-watcher-copies.py
grep -c "^func Test" services/xstockstrat-marketdata/internal/alpacapace/pace_test.go   # non-zero: cases executed
```

---

### Step 3 — service: marketdata Alpaca client paces from headers and retries a 429

**Status**: `done`
**Service**: `xstockstrat-marketdata`
**Files**:
- `services/xstockstrat-marketdata/internal/alpaca/client.go` — modify
- `services/xstockstrat-marketdata/cmd/server/main.go` — modify
- `services/xstockstrat-marketdata/CLAUDE.md` — modify
- `services/xstockstrat-marketdata/docs/context-constitution.md` — modify
- `scripts/config-wiring.json` — modify (one temporary `read-unseeded` findings entry)

**Reviewers**: `xstockstrat-marketdata` owner — OHLCV ingestion integrity, Alpaca feed idempotency

**Codebase Evidence**:
- `marketdata/internal/alpaca/client.go`: `ClientConfig` `:29-51` (`RateLimitRPS` `:42`), `Settings` `:54-65`, `Client` `:68-78`, `NewClient` `:81-92`, `NewLiveClient` `:96-102` (both build `&http.Client{Timeout: 30 * time.Second}`), `conf` `:105-115` (field-by-field copy `:110-113`), `currentLimiter` `:118-131`, `do` `:145-168`, `alpacaOp` `:171-185`.
- `do` today: `limiter.Wait(ctx)` `:151`, on failure one `VendorThrottle` point with a zero `sentAt` `:152` and `fmt.Errorf("rate limiter: %w", err)` `:153`; `sentAt := time.Now()` `:156`; the only `c.httpClient.Do(req)` `:157`; outcome from `telemetry.HTTPErrorOutcome` `:162`; one `RecordVendorRequest` `:166`.
- Eight `c.do(` call sites, all `GET` with a nil body and a fresh request: `:273`, `:336`, `:389`, `:431`, `:471`, `:519`, `:576`, `:623`. Callers format a non-200 as `"alpaca bars %d: %s"` (`:283`), `"alpaca quote %d: %s"` (`:399`) and so on; no call site changes.
- Telemetry: outcome values `marketdata/internal/telemetry/otel.go:340-350` (`VendorHTTP429`, `VendorCtx`, `VendorThrottle`, `VendorTransport`); `RecordVendorRequest` `:398-406` forces `ctx` when the passed context has ended (`:399-401`) and records a duration only for a non-zero `sentAt` (`:403-405`).
- Settings closure: `marketdata/cmd/server/main.go:82-99`, `RateLimitRPS: int(cfgWatcher.GetInt("backfill.rate_limit_rps", 200))` at `:94`. The watcher is built for namespace `marketdata` (`:64`).
- Config-wiring receiver: `"services/xstockstrat-marketdata/cmd/server/main.go:cfgWatcher": "marketdata"` (`scripts/config-wiring.json:113`). Baseline entries live in the `findings` array (`scripts/config-wiring.json:5-12`, shape `{"namespace", "key", "kind", "owner"}`); CI runs `--final` on every PR (`.github/workflows/ci.yml:1239-1240`) and an unbaselined unseeded read fails it (`scripts/check-config-wiring.mjs:629-631`).
- Testable-reader precedent: `func fundamentalsProvider(cfgWatcher *config.Watcher) func() string` (`marketdata/cmd/server/main.go:215`), a `main.go` helper that takes the watcher as a parameter named `cfgWatcher`.
- Explicit-true bool default precedent: `s.fundCfg.GetBool("edgar.enabled", true)` (recon § Patterns to REUSE).
- Docs: the key row `marketdata/CLAUDE.md:62`; MARKETDATA-4 at `marketdata/docs/context-constitution.md:18`. (`marketdata/docs/alpaca-integration.md` is updated in Step 5.)
- **Not found** — a clock, sleep or jitter seam, a logger, or any retry in `internal/alpaca` (recon § Risks).
- Config-key contract (C-05): namespace `marketdata`; key `alpaca.adaptive_rate_limit_enabled`; `value_type` `bool`; code default `true`; reader `services/xstockstrat-marketdata/cmd/server/main.go:alpacaAdaptiveRateLimit` (called from the `alpaca.NewLiveClient` settings closure in `main`); seed: Step 11; live mechanism: the `WatchConfig`-backed watcher, read on every Alpaca request, so a `SetConfig` applies on the next call.

**TDD**: `red-green required`

**Covers**: —

**Instructions**:
1. `client.go` fields: add `AdaptiveRateLimit bool` to `ClientConfig` (after `RateLimitRPS`) and to `Settings`; copy it in `conf()`. Positive sense: the zero value is the pre-feature behavior, so `NewClient` and every existing test literal stay off (D-6).
2. `Client` gains `pacer *alpacapace.Pacer` and three unexported seams: `now func() time.Time`, `sleep func(ctx context.Context, d time.Duration) error` (returns the context error when the context ends first) and `jitter func() time.Duration` (uniform in `[0, alpacapace.MaxJitter)`, `math/rand/v2`). Default all four in both constructors through one unexported helper.
3. Add two constants in this file: `minAttempt = time.Second` and `noDeadlineBound = 90 * time.Second`.
4. `do`: set the auth headers as today. When `cfg.AdaptiveRateLimit` is false, run today's body unchanged (same error text, same single point). When true, run the attempt loop of `design.md` § 2:
   - Key: `c.pacer.Key(req.URL.Host, cfg.APIKey)`.
   - Deadline `D`: the request deadline; with none, `start + noDeadlineBound`, where waits **and** attempts run under a context bounded by the remaining time measured on the `now` seam, and its cancel is released when the returned response body is closed (the `cancelOnClose` shape of `trading/internal/broker/alpaca.go:68-77`).
   - Per attempt: `Reserve(key, now, D − jitter − minAttempt, jitter)` → the static `limiter.Wait` (unchanged; nil when rps ≤ 0) → send `req.Clone(attemptCtx)` → `Observe` when `ParseHeaders` succeeds → one `RecordVendorRequest` point with the duration → on a 429 drain and close the body, compute `RetryWait(attempt, now, reset, jitter)` with the `ParseReset` value, and retry. Only a 429 is retried; every other outcome returns at once as today.
   - Marketdata waits, it does not fail fast (D-14): a hold or 429 wait that does not fit sleeps until the request context is done (or until `start + 90 s` for a call with no deadline) and then returns the error below. No request is sent after that.
   - A wait that ends early records one point with a zero `sentAt`, passed as `VendorThrottle` on the **caller's** context, so it reads `ctx` when that context ended and `throttle` otherwise (D-16). A wait that completes records nothing extra.
   - Error: `fmt.Errorf("alpaca %s rate limited by %s: %w", op, host, cause)` where `cause` is the context error or the static limiter's error. At the 90 s bound there is no cause and the caller's context is live: return `fmt.Errorf("alpaca %s rate limited by %s", op, host)`.
   - One WARN per throttled window per host, gated by `WarnOnce`: `slog.WarnContext(ctx, "alpaca rate limit: throttled", "host", host, "wait_ms", wait.Milliseconds())`. Never log or label the API key.
5. `main.go`: add `func alpacaAdaptiveRateLimit(cfgWatcher *config.Watcher) bool { return cfgWatcher.GetBool("alpaca.adaptive_rate_limit_enabled", true) }` (the parameter keeps the name `cfgWatcher` so the `main.go:cfgWatcher` receiver in `scripts/config-wiring.json:113` still attributes the read). In the settings closure after `:94` add `AdaptiveRateLimit: alpacaAdaptiveRateLimit(cfgWatcher),`.
6. `marketdata/CLAUDE.md`: add a row for `alpaca.adaptive_rate_limit_enabled` (bool, `true`, explicit-true default, read live per request, off = exactly the pre-feature client, seeded by the `alpaca_adaptive_rate_limit_keys` config migration); reword the `backfill.rate_limit_rps` row (`:62`) as a ceiling ("the effective rate is the lower of this and what Alpaca's headers allow; `0` disables only this ceiling"); add a short "Adaptive rate limit — fixed invariants" paragraph listing the constants of `product-spec.md` § Fixed Invariants that apply to marketdata (window 60 s, slack 5 s, low-water ratio 10, backoff 1 s to 8 s, jitter under 500 ms, 90 s no-deadline bound, 1 s minimum attempt); in § Observability note that an Alpaca attempt answered 429 is its own `http_429` point and an early-ended wait is one `ctx` or `throttle` point with no duration.
7. `marketdata/docs/context-constitution.md` MARKETDATA-4 (`:18`): add that `do()` is also the only place header pacing and the 429 retry run, and refresh its `(~L145)` pointer.
8. `scripts/config-wiring.json`: append one entry to the `findings` array — `{"namespace": "marketdata", "key": "alpaca.adaptive_rate_limit_enabled", "kind": "read-unseeded", "owner": "feature 347 alpaca-adaptive-rate-limit"}`. It is temporary: Step 11 removes it when the seed lands.
9. Broker coverage: this is the marketdata data-API client; `internal/alpaca/stream.go`, FMP, Finnhub and EDGAR are not touched (FR-7). No env var, port or outbound gRPC call is added, so header propagation is unaffected.

**Verification**:
```bash
cd services/xstockstrat-marketdata && GOWORK=off go build ./... && GOWORK=off go test ./internal/alpaca/... -race -count=1
cd ../.. && node scripts/check-config-wiring.mjs --final      # exit 0: the read-unseeded finding is baselined
node scripts/check-config-wiring.mjs --doc-check              # exit 0
grep -n "httpClient.Do" services/xstockstrat-marketdata/internal/alpaca/client.go     # only inside do / its attempt helper (MARKETDATA-4)
grep -n "alpacaAdaptiveRateLimit\|adaptive_rate_limit_enabled" services/xstockstrat-marketdata/cmd/server/main.go services/xstockstrat-marketdata/CLAUDE.md scripts/config-wiring.json
```

---

### Step 4 — test: marketdata client pacing, retry, telemetry and the FMP guard

**Status**: `done`
**Service**: `xstockstrat-marketdata`
**Files**:
- `services/xstockstrat-marketdata/internal/alpaca/export_test.go` — create
- `services/xstockstrat-marketdata/internal/alpaca/client_test.go` — modify
- `services/xstockstrat-marketdata/internal/fmp/fmp_client_test.go` — modify
- `services/xstockstrat-marketdata/cmd/server/main_test.go` — modify

**Reviewers**: `xstockstrat-marketdata` owner — Alpaca feed idempotency

**Codebase Evidence**:
- `marketdata/internal/alpaca/client_test.go` is the external package `alpaca_test` (`:1`); `makeTestServer` `:23-26`; metric helpers `vendorMetricReader` `:636-647` (swaps the global `MeterProvider`, so no `t.Parallel()`), `collectVendorMetrics` `:657-694` (requests keyed `vendor/op/outcome`, duration counts keyed `vendor/op`), `assertNoAttrContains` `:696-705`; existing outcome tests `TestDo_RecordsOKOutcome_AC13` `:709`, `TestDo_RecordsCtxOutcome_AC13` `:730`; live-settings pattern `TestLiveClient_RateLimitFollowsSettings_AC32` `:750` (`alpaca.NewLiveClient(func() alpaca.Settings {…}, true)`).
- **Not found** — `marketdata/internal/alpaca/export_test.go` (`ls marketdata/internal/alpaca` → `client.go client_test.go stream.go stream_metrics_test.go stream_test.go`). It is new.
- FMP: both test files are `package fmp`; `gatewayClient(rt, rps, dailyCap, now)` at `marketdata/internal/fmp/fmp_gateway_test.go:28-36`; the refund assertion pattern is `c.BudgetSnapshot()` in `TestGateway_BudgetRefundOn503_AC4` (`fmp_gateway_test.go:71-85`); `recordingRT` returns an empty header (`fmp_client_test.go:36-46`), so a 429 carrying `X-RateLimit-Reset` needs a local `RoundTripper`.
- Op labels: `/v2/stocks/<sym>/quotes/latest` → `quotes_latest`, `/bars` → `bars`, `/assets` → `assets` (`client.go:171-185`).
- Config-reader test precedent: `TestFundamentalsSource_ProviderSwitchIsLive_AC7` (`marketdata/cmd/server/main_test.go:193`) builds `config.MustSnapshotWatcher("marketdata", …)` (`:197`) and calls a `main.go` helper that takes `cfgWatcher` (`main.go:215`). `cmd` is excluded from the coverage threshold (`.github/workflows/ci.yml:374`).
- Existing tests in this service already carry `_AC<n>` names from other features (e.g. `TestDo_RecordsOKOutcome_AC13`), so this feature's tests use the `_F347_AC<N>` suffix to be selectable on their own.
- C-13: the tests use header values, symbols and instants as scenario one-offs; no domain literal gets a second consumer, so nothing moves to `internal/testdata/`.

**TDD**: `red-green required`

**Covers**: `AC-1, AC-2, AC-3, AC-4, AC-5, AC-6, AC-7, AC-8, AC-9, AC-11, AC-14, AC-19, AC-21, AC-22, AC-24`

**Instructions**:
1. `export_test.go` (`package alpaca`): setters for the `now`, `sleep` and `jitter` seams and for `httpClient.Transport`. Nothing else is exported.
2. In `client_test.go` add small local helpers: a fake clock with a recording sleep that advances it (and a variant that records without advancing, for "issued at the same moment"); a `RoundTripper` that keeps the request's URL host and answers from a script, recording each attempt's host, path and clock time; a WARN recorder installed with `slog.SetDefault` and restored in `t.Cleanup`.
3. One test per scenario, named `Test<Subject>_F347_AC<N>` with the name ending in the scenario number (a Go name cannot hold the hyphen). AC-21 is one test with two subtests. Clients are built with `NewLiveClient` and `Settings{AdaptiveRateLimit: true, …}` unless stated. `DataURL` is `https://data.alpaca.markets` and `BaseURL` is `https://paper-api.alpaca.markets` behind the scripted transport.
   - **AC-1**: a first 200 carries `Limit 200`, `Remaining 0`, `Reset now+3 s`; a bars request with a 30 s deadline is sent no earlier than the reset on the client clock and returns bars.
   - **AC-2** (guard): data host recorded exhausted, trading API host recorded `Remaining 150`; `ListAssets` is sent with no sleep. Red under a "key by credential only" mutant.
   - **AC-3**: state `200 / 4 / now+4 s`; four bars requests at the same clock instant (non-advancing sleep), each with a 30 s deadline: recorded waits are none, ≥ 1 s, ≥ 2 s, ≥ 3 s, each under 4 s.
   - **AC-4**: 429 with `Reset now+2 s`, then 200 with 3 bars: the second attempt's clock time is ≥ the reset; 3 bars, no error.
   - **AC-5**: three 429s with no reset header, then 200, 60 s deadline, a fixed non-zero jitter: waits before attempts 2, 3, 4 are ≥ 1, 2, 4 s and each equals backoff plus the jitter.
   - **AC-6**: real clock and sleep; every attempt 429 with `Reset now+10 s`; `GetLatestQuote("NVDA")` under a 2500 ms deadline returns within 3 s an error containing `rate limited` and `data.alpaca.markets`.
   - **AC-7** (guard): real limiter and clock, `RateLimitRPS 5`, every response reports `10000 / 10000 / now+60 s`; 15 concurrent bars requests: exactly 5 within the first 100 ms, the 10th ≥ 1.0 s and the 15th ≥ 2.0 s after the first (100 ms tolerance). Red under a "skip the static limiter when adaptive is on" mutant.
   - **AC-8** (guard): the four responses of the scenario in sequence; all four calls succeed and the recording sleep saw no call. Red under a "treat a missing header as `Remaining 0`" mutant.
   - **AC-9** (guard): `AdaptiveRateLimit: false`, a 429 with `Reset now+2 s`: exactly 1 attempt, error starts with `alpaca bars 429`, returned within 1 s. Red under an "ignore the switch" mutant.
   - **AC-14**: 429 with `Reset now+2 s`, then 200: one `alpaca/bars/http_429` point, one `alpaca/bars/ok` point, one WARN whose attributes name host `data.alpaca.markets` and a `wait_ms`; `assertNoAttrContains` for the API key, the symbol and the host.
   - **AC-19**: no deadline, fake clock, jitter 0, every attempt 429 with `Reset now+3600 s`: exactly 2 attempts, the second ≥ 60 s after the first; the error contains `rate limited` and `data.alpaca.markets` and is returned no later than 90 s on the client clock; 2 `http_429` points, 1 `throttle` point, and exactly 2 duration samples.
   - **AC-21** (two rows): state `200 / 0 / now+10 s`, real clock; `GetLatestQuote("NVDA")` with a 2500 ms deadline, once letting the deadline pass and once cancelling after 1 s: exactly one `alpaca/quotes_latest/ctx` point, no duration sample, no NVDA request reaches the transport, and the error contains both strings and satisfies `errors.Is` for `context.DeadlineExceeded` / `context.Canceled`.
   - **AC-22**: `RateLimitRPS 0` with state `200 / 0 / now+3 s`: the bars request is sent no earlier than the reset.
   - **AC-24** (guard): state `200 / 4 / now+4 s`; after one bars request with a 30 s deadline, `GetLatestQuote("NVDA")` with a 500 ms deadline is sent with no sleep and succeeds. Red under a "refuse a caller that cannot wait for its slot" mutant (R-9).
   - Also pin the static-ceiling refusal: with `RateLimitRPS 1`, adaptive on and an already-expired deadline on the second call, the error contains `rate limited` and the host and the point reads `ctx`.
4. **AC-11** in `fmp_client_test.go` (guard, named with the same `_F347_AC11` suffix): a local `RoundTripper` answers a 429 with `X-RateLimit-Reset` 2 s ahead; with `gatewayClient(rt, 0, 3, nil)` one `FetchSector` call returns an error, the transport saw exactly 1 request and `BudgetSnapshot()` reports `used == 0`. Red if a retry is ever added to the FMP client.
5. Config-key wiring, in `main_test.go`: add `TestAlpacaAdaptiveRateLimit_ReadsSeededKey_347`. Build `config.MustSnapshotWatcher("marketdata", …)` with `alpaca.adaptive_rate_limit_enabled` as a bool ConfigValue `true` and assert `alpacaAdaptiveRateLimit` returns true (this is the value migration 052 seeds). Repeat with `false`, which must return false, and with the key absent, which must return true (the code default).
6. RED: with Step 3's fields and seams present and `do` still a single attempt, every non-guard test fails on an assertion (attempt counts, wait times, points or error text). Record the guards as "red N/A — pins unchanged behavior" with their mutant.
7. Real-time cost of this step's tests: about 2.5 s (AC-6), 2 s (AC-7) and 3.5 s (AC-21); everything else runs on the fake clock.

**Verification**:
```bash
cd services/xstockstrat-marketdata && GOWORK=off golangci-lint run --modules-download-mode=mod
export GOWORK=off; COVERPKGS=$(go list ./... | grep -Ev '/(cmd|handler|repository|telemetry|service)(/|$)' | tr '\n' ',' | sed 's/,$//')
go test ./... -race -count=1 -coverprofile=coverage.out -covermode=atomic -coverpkg="${COVERPKGS}" && go tool cover -func=coverage.out | grep "^total:"   # >= 40%
GOWORK=off go test ./internal/alpaca/... ./internal/fmp/... -race -count=1 -run 'F347_AC(1|2|3|4|5|6|7|8|9|11|14|19|21|22|24)\b' -v | grep -c "^--- PASS"   # 15: one top-level test per scenario (subtests are indented and not counted)
GOWORK=off go test ./cmd/server/... -race -count=1 -run 'TestAlpacaAdaptiveRateLimit_ReadsSeededKey_347' -v | grep -c "^--- PASS"   # 1
grep -rn "func Set" internal/alpaca/export_test.go        # the four seams only
```

---

### Step 5 — service: marketdata loops bound their Alpaca calls by the loop interval

**Status**: `pending`
**Service**: `xstockstrat-marketdata`
**Files**:
- `services/xstockstrat-marketdata/internal/service/marketdata_service.go` — modify
- `services/xstockstrat-marketdata/docs/alpaca-integration.md` — modify

**Reviewers**: `xstockstrat-marketdata` owner — OHLCV ingestion integrity, Alpaca feed idempotency

**Codebase Evidence**:
- `StartWarmQuotePoller` `marketdata/internal/service/marketdata_service.go:1187-1223`: the live interval is re-read each tick (`:1201-1209`) and the cycle is `s.warmQuotesOnce(ctx, symbols)` (`:1220`).
- `warmQuotesOnce` `:1226-1277`: multi fetch `ms.GetLatestQuotesMulti(ctx, symbols)` `:1236`; cache writes `s.cacheQuote(ctx, q, since)` `:1238` and `:1262`; tick record `telemetry.LogTickOK` `:1244` and `:1275`; per-symbol fallback `src.GetLatestQuote(ctx, sym)` `:1252-1253` with `failed++` on error `:1255`.
- `StartBarIngestPoller` `:1292-1316`: interval re-read `:1305-1312`, cycle `s.ingestRecentBars(ctx)` `:1313`.
- `ingestRecentBars` `:1366-1389` loops the timeframes and calls `s.ingestRecentBarsForTimeframe(ctx, src, symbols, tf, …)` `:1387`.
- `ingestRecentBarsForTimeframe` `:1393-1435`: `ms.GetBarsMulti(ctx, plan.requested, …)` `:1401`; `s.barsStore.InsertBars(ctx, bars)` `:1408` and `:1428`; per-symbol `src.GetBars(ctx, sym, …)` `:1418` with `out.errored[sym] = true` on error `:1420`; `barOutcome` at `marketdata/internal/service/bar_hold.go:25`; `applyBarCycle` `bar_hold.go:83` treats an errored symbol as an error, never as "no bars" (291 @AC-5).
- Break radius: the three methods have 11 test call sites — `bar_hold_test.go:129`; `marketdata_service_test.go:1318`, `:1338`, `:1366`, `:5098`, `:5122`, `:5148`, `:5314`, `:5352`, `:5362`, `:5400` — and three production call sites (`:1220`, `:1313`, and `:1387` inside `ingestRecentBars`). `ingestRecentBars` has no test call site.
- Both loops are started from `marketdata/cmd/server/main.go:147` and `:149` on the main context, which has no deadline.
- Docs: the REST bullet at `marketdata/docs/alpaca-integration.md:3`.

**Lands with**: `Step 6`

**TDD**: `red-green required`

**Covers**: —

**Instructions**:
1. Change the signatures to `warmQuotesOnce(ctx, fetchCtx context.Context, symbols []string)`, `ingestRecentBars(ctx, fetchCtx context.Context)` and `ingestRecentBarsForTimeframe(ctx, fetchCtx context.Context, src source.DataSourceClient, symbols []string, tf string, start, end time.Time)`.
2. In each Start loop, per cycle, create `fetchCtx, cancel := context.WithTimeout(ctx, interval)` from the live interval already re-read on that tick, pass it with the loop context, and cancel it when the cycle returns.
3. Only the Alpaca calls use `fetchCtx`: `GetLatestQuotesMulti` (`:1236`), `GetLatestQuote` (`:1253`), `GetBarsMulti` (`:1401`) and `GetBars` (`:1418`). `cacheQuote`, `InsertBars`, every log line and `LogTickOK` keep the loop context `ctx` (D-26, R-15).
4. Guards: at the top of each per-symbol fallback loop iteration, when `fetchCtx.Err() != nil` start no fetch for that symbol and count it as an error (`failed++` in the warm poller; `out.errored[sym] = true` in the bar ingester). In `ingestRecentBarsForTimeframe`, when `fetchCtx` has already expired before the multi fetch of a later timeframe, start no fetch and mark every `plan.requested` symbol errored. A skipped symbol is never "no bars" and never counts toward a hold.
5. These bounds do not depend on the kill switch (D-28e).
6. `marketdata/docs/alpaca-integration.md`: (a) one bullet after the REST bullet (`:3`) describing the adaptive behavior of `do()` from Step 3 — the kill switch is `alpaca.adaptive_rate_limit_enabled`, and "marketdata waits to the request deadline; an exhausted window holds an interactive quote or price fetch for its request budget"; (b) add to the warm-poller and bar-ingester bullets that a cycle's Alpaca calls run under a deadline equal to the loop's live interval, that writes keep the loop context, and that a symbol not fetched in time is an error for that cycle.
7. No config key, env var, port or outbound gRPC call is added.

**Verification**:
```bash
cd services/xstockstrat-marketdata && GOWORK=off go build ./... && GOWORK=off go vet ./internal/service/...
grep -n "fetchCtx" internal/service/marketdata_service.go      # the four vendor calls, the two WithTimeout sites and the guards
grep -n "cacheQuote(ctx\|InsertBars(ctx\|LogTickOK(ctx" internal/service/marketdata_service.go   # writes and tick records still on ctx
```

---

### Step 6 — test: loop bounds

**Status**: `pending`
**Service**: `xstockstrat-marketdata`
**Files**:
- `services/xstockstrat-marketdata/internal/service/marketdata_service_test.go` — modify
- `services/xstockstrat-marketdata/internal/service/bar_hold_test.go` — modify

**Reviewers**: `xstockstrat-marketdata` owner — OHLCV ingestion integrity

**Codebase Evidence**:
- The Start loops read `s.cfg`, a `*config.Watcher` (`marketdata_service.go:41`); a test builds one with `config.MustSnapshotWatcher("marketdata", …)` (`marketdata/internal/config/config.go:136`). No existing test drives either Start loop (`grep -rn "StartWarmQuotePoller\|StartBarIngestPoller" marketdata/internal --include=*_test.go` → one comment at `marketdata_service_test.go:3766`).
- Reusable fakes in `marketdata_service_test.go`: `fakeMultiSource` `:1445`, `perSymbolQuoteSource` `:5069-5081`, `warmQuotes` `:5083`, `fakeQuoteStore` `:3521`, `failingInsertStore` `:5044`, `installWarmLogRecorder` `:5034`, `fakeCfg` `:289-316`.
- Bar-hold harness in `bar_hold_test.go`: `recordingBarsSource` `:44`, `newBarHoldService` `:115-119` (`budgetCfg` carries `barIngestBackoffKey`), `runCycles` `:122-131`, `holdEntry` `:133`.
- `ingestRecentBars` needs a registry and the warm set: `s.registry.Get("")` (`marketdata_service.go:1371`) and `s.warmSnapshot()` (`:1367`); the registry pattern is `source.NewRegistry()` + `reg.Register("alpaca", src)` (`marketdata_service_test.go:5118-5119`).
- `marketdata/internal/service` is excluded from the coverage threshold (`.github/workflows/ci.yml:374`).
- C-13: symbols `AAA`/`BBB`/`CCC` are scenario one-offs already used inline in this file; no new shared literal.

**Lands with**: `Step 5`

**TDD**: `red-green required`

**Covers**: `AC-32, AC-33`

**Instructions**:
1. Update the 11 existing call sites listed in Step 5 to pass `context.Background()` for both contexts. No assertion in those tests changes.
2. Tests are named `Test<Subject>_F347_AC32` and `Test<Subject>_F347_AC33` (the name ends with the scenario number). **AC-32** (`marketdata_service_test.go`): `svc.cfg` is a snapshot watcher with `stream.warm_interval_ms` 200; the quote store rejects a write whose context is done; the multi-quote fake returns all three quotes only once its context is done, with a 2 s safety timer so today's code fails on an assertion and does not hang. Its second and later calls block until their context is done. Run `StartWarmQuotePoller` in a goroutine, wait for the first cycle, cancel. Assert: three quotes cached; one `loop tick ok` record for `warm_quote`; no per-symbol quote request; the multi fetch's context carried a deadline 200 ms after the cycle began (50 ms tolerance). Count requests per fetch context so a second cycle cannot disturb the counts (O-42).
3. **AC-33** (`bar_hold_test.go`): `stream.bar_ingest_interval_ms` 200 on the snapshot watcher and `stream.bar_ingest_backoff_ms` 21600000 on `budgetCfg`; the multi-bars fetch fails at once; each per-symbol fetch returns an error only once its context is done or after 2 s. Run one cycle of `StartBarIngestPoller`. Assert: exactly 1 per-symbol bars request in that cycle; `holdEntry` shows that none of `AAA`, `BBB`, `CCC` started or extended a no-bars hold.
4. Add one direct case for the later-timeframe guard: `ingestRecentBarsForTimeframe` called with an already-expired `fetchCtx` makes no vendor call and marks every requested symbol errored.
5. RED: on today's loops the AC-32 fetch context has no deadline and AC-33 makes 3 per-symbol requests. RED is captured with the new signatures in place and the bodies still passing `ctx` everywhere.
6. New logic is in an excluded package — no coverage threshold applies; these tests are the verification.

**Verification**:
```bash
cd services/xstockstrat-marketdata && GOWORK=off golangci-lint run --modules-download-mode=mod
export GOWORK=off; COVERPKGS=$(go list ./... | grep -Ev '/(cmd|handler|repository|telemetry|service)(/|$)' | tr '\n' ',' | sed 's/,$//')
go test ./... -race -count=1 -coverprofile=coverage.out -covermode=atomic -coverpkg="${COVERPKGS}" && go tool cover -func=coverage.out | grep "^total:"   # >= 40%
GOWORK=off go test ./internal/service/... -race -count=1 -run 'F347_AC3[23]\b' -v | grep -c "^--- PASS"   # 2
grep -rn '"AAA", "BBB", "CCC"' --include="*_test.go" internal/service | wc -l                      # inline one-offs only (C-13)
```

---

### Step 7 — service: trading Alpaca client paces, retries within the budget and refuses with `ErrRateLimited`

**Status**: `pending`
**Service**: `xstockstrat-trading`
**Files**:
- `services/xstockstrat-trading/internal/broker/broker.go` — modify
- `services/xstockstrat-trading/internal/broker/alpaca.go` — modify
- `services/xstockstrat-trading/internal/service/order_intent.go` — modify
- `services/xstockstrat-trading/internal/service/trading.go` — modify
- `scripts/config-wiring.json` — modify (one temporary `read-unseeded` findings entry)

**Reviewers**: `xstockstrat-trading` owner — order execution correctness, broker API safety, fill detection, paper-only dev invariant

**Codebase Evidence**:
- Sentinels: `trading/internal/broker/broker.go:10` `ErrInvalidCredentials`, `:14` `ErrOutcomeUncertain`, `:18` `ErrOrderNotCancelable`.
- `trading/internal/broker/alpaca.go`: `ClientConfig` `:15-23` (`Timeout func() time.Duration` `:22`), `Client` `:29-32`, `NewClient` `:34-45` (`&http.Client{}` with no timeout), `timeout()` `:47-54`, `do` `:57-66` (one attempt under `context.WithTimeout(req.Context(), c.timeout())`), `cancelOnClose` `:68-77`, `baseURL()` `:79-84` (paper/live routing from `cfg.Paper`), `setAuthHeaders` `:541` (called by each method, not by `do`).
- Eight `c.do(` call sites, nothing bypasses `do`: `SubmitOrder` POST `:189` (error `"alpaca broker error (status %d)"` `:201`), `CancelOrder` DELETE `:242` (422 → `ErrOrderNotCancelable` `:249`), `ReplaceOrder` PATCH `:299`, `GetOrder` `:332`, `ListOrders` `:383`, `GetPositions` `:426`, `GetAccount` `:484` (error `"alpaca GetAccount: status %d"` `:491`), `ValidateCredentials` `:525` (401/403 → `ErrInvalidCredentials` `:534`).
- Request replay pattern: `retry := req.Clone(ctx)` with `GetBody` called only when non-nil (`trading/internal/broker/ibkr_session.go:412-414`).
- Classification: `isUncertainBrokerOutcome` `trading/internal/service/trading.go:2565-2569` (deadline exceeded, a `net.Error` timeout, or `ErrOutcomeUncertain`); a submit error that is not uncertain is REJECTED with `order.broker_rejected` (`:743-760`); `submitOutcome` maps it to `rejected` (`:3924-3935`), so no outcome value is added.
- Staleness: `computeStaleThreshold` `trading/internal/service/order_intent.go:91-96`, `staleThreshold` `:100-108`; `brokerCallTimeout` `trading.go:2539-2545`.
- Client construction: `instantiateBrokerLocked` `trading.go:3241-3273`; `broker.NewClient(broker.ClientConfig{…})` `:3264-3271` with `Paper: rec.IsPaper` and `Timeout: func() time.Duration { return brokerCallTimeout(s.cfgW) }` `:3270`; method-value precedent `Timing: s.ibkrTiming` `:3257`.
- Config-wiring receiver: `"services/xstockstrat-trading/internal/service/trading.go:s.cfgW": "trading"` (`scripts/config-wiring.json:138`). Baseline entries live in the `findings` array (`scripts/config-wiring.json:5-12`); CI runs `--final` on every PR (`.github/workflows/ci.yml:1239-1240`).
- `internal/broker` does not import `internal/service` and has no `log/slog` import in `alpaca.go` (`grep -ln "log/slog" trading/internal/broker/*.go` → `ibkr.go`, `ibkr_session.go`). Trading has no `golang.org/x/time` dependency and gains none (D-7).
- Trading-domain survey: paper/live is resolved from `broker.paper` / `TRADING_MODE` (`trading.go:2730`, `:3739-3743`; `trading/internal/config/config.go:46`) and reaches the client only as `Paper` (`alpaca.go:79-84`); `TRADING_MODE` is set in `docker-compose.yml:17`, `.do/app.dev.yaml:30`, `.do/app.yaml:30` and is not touched.
- Config-key contract (C-05): namespace `trading`; key `broker.adaptive_rate_limit_enabled`; `value_type` `bool`; code default `true`; reader `services/xstockstrat-trading/internal/service/trading.go:(*TradingService).alpacaRateLimitBudget` (passed to `broker.ClientConfig.RateLimitBudget` in `instantiateBrokerLocked`); seed: Step 11; live mechanism: the `WatchConfig`-backed `trading` watcher, read on every Alpaca request. The key's row and default are declared in `trading/CLAUDE.md` in Step 9.

**TDD**: `red-green required`

**Covers**: —

**Instructions**:
1. `broker.go`: add `var ErrRateLimited = errors.New("broker rate limited: request was not processed")` with a two-line comment stating the constraint: it is a definite outcome, never wrapped with a context error and never `ErrInvalidCredentials`.
2. `alpaca.go` `ClientConfig`: add `RateLimitBudget func() time.Duration` — nil or a non-positive result means the kill switch is off and `do` runs today's code exactly.
3. `Client` gains `pacer *alpacapace.Pacer` and the unexported seams `now`, `sleep(ctx, d) error` and `jitter`, defaulted in `NewClient`.
4. `do` with a positive budget `B`, per `design.md` § 4:
   - `T = c.timeout()`. Call end `C = min(caller deadline, start + B)`. `latest = C − T − jitter`. Key: `c.pacer.Key(req.URL.Host, c.cfg.APIKey)`.
   - A request whose method is not `GET` is a mutation: its whole loop, sleeps included, runs on `context.WithoutCancel(req.Context())` bounded by `C`. A read keeps the caller's context.
   - Each attempt runs under `context.WithTimeout(loopCtx, min(T, C − now()))`, durations measured on the `now` seam. A retry uses `req.Clone` and calls `GetBody` only when it is non-nil. A drained 429 body releases only that attempt; the returned body's `cancelOnClose` releases the attempt and the loop context.
   - Fail fast (D-14): a non-zero wait (a spread slot, a hold, a 429 wait) is started only when `now + wait + T <= C` (inclusive). Otherwise return at once. A zero wait is never fit-tested and is always sent, so a call bounded by one `T` makes exactly its first attempt.
   - `Observe` on every response whose three headers parse. Only a 429 is retried, with `RetryWait(attempt, now, reset, jitter)`.
   - Refusal, exhaustion or a wait cut short: `fmt.Errorf("alpaca broker rate limited by %s: %w", host, ErrRateLimited)`. It wraps only `ErrRateLimited`. An attempt that times out is returned unwrapped, as today, and stays "uncertain".
   - One WARN per throttled window per host, gated by `WarnOnce`: `slog.WarnContext(ctx, "alpaca broker rate limit: throttled", "host", host, "wait_ms", wait.Milliseconds())`. No metric. Never log the API key.
5. `order_intent.go`, next to `computeStaleThreshold`: add the pure `rateLimitBudget(enabled bool, t, stale time.Duration) time.Duration` — 0 when disabled, otherwise `max(t, stale − 2*t)`.
6. `trading.go`: add `func (s *TradingService) alpacaRateLimitBudget() time.Duration { return rateLimitBudget(s.cfgW.GetBool("broker.adaptive_rate_limit_enabled", true), brokerCallTimeout(s.cfgW), staleThreshold(s.cfgW)) }` after `brokerCallTimeout` (`:2539-2545`), and set `RateLimitBudget: s.alpacaRateLimitBudget` next to `Timeout` at `:3270`.
7. `scripts/config-wiring.json`: append one entry to the `findings` array — `{"namespace": "trading", "key": "broker.adaptive_rate_limit_enabled", "kind": "read-unseeded", "owner": "feature 347 alpaca-adaptive-rate-limit"}`. It is temporary: Step 11 removes it when the seed lands. (`trading/CLAUDE.md` is updated in Step 9.)
8. Trading-domain constraints for this step:
   - Broker coverage: Alpaca only. `IBKR`: other broker unaffected — no `internal/broker/ibkr*.go` file changes (FR-7).
   - Trading mode gate: no order-placing call is added. A retried `POST /v2/orders` is the same request with the same `client_order_id`. Paper/live routing is the existing `baseURL()` gate (`alpaca.go:79-84`) fed by `Paper: rec.IsPaper` (`trading.go:3269`); pacing state is kept per host, so paper and live never share a window (FR-10).
   - Order type handling is unaffected by this step (the request body is replayed unchanged for MARKET, LIMIT, STOP, STOP_LIMIT and TRAILING_STOP).
   - Fill handling is unaffected by this step.
   - No env var is added, so there is no Compose/DO value to keep in parity. No outbound gRPC call is added.

**Verification**:
```bash
cd services/xstockstrat-trading && GOWORK=off go build ./... && GOWORK=off go test ./internal/broker/... -race -count=1
grep -n "TRADING_MODE\|TradingMode\|paper\|PAPER\|Paper" internal/broker/alpaca.go | head     # baseURL() paper/live gate still present
grep -n "RateLimitBudget\|alpacaRateLimitBudget" internal/broker/alpaca.go internal/service/trading.go
git diff --stat -- internal/broker/ibkr.go internal/broker/ibkr_session.go                      # empty: IBKR untouched
! grep -q "golang.org/x/time" go.mod                                                             # absent
cd ../.. && node scripts/check-config-wiring.mjs --final      # exit 0: the read-unseeded finding is baselined
node scripts/check-config-wiring.mjs --doc-check              # exit 0
```

---

### Step 8 — test: trading client retry, budget, refusal and the budget table

**Status**: `pending`
**Service**: `xstockstrat-trading`
**Files**:
- `services/xstockstrat-trading/internal/broker/export_test.go` — create
- `services/xstockstrat-trading/internal/broker/alpaca_test.go` — modify
- `services/xstockstrat-trading/internal/service/trading_rate_limit_test.go` — create

**Reviewers**: `xstockstrat-trading` owner — order execution correctness, broker API safety

**Codebase Evidence**:
- `trading/internal/broker/alpaca_test.go` is the external package `broker_test` (`:1`); `makeTestServer` `:19-25` (handles `/v2/orders` and `/v2/orders/`); clients are pointed at a server through `PaperURL`/`LiveURL` (`:242-249`); real-time timeout test `TestSubmitOrder_TimeoutIsLive` `:227-264`; `TestCancelOrder_422ReturnsNotCancelable` `:671`.
- **Not found** — `trading/internal/broker/export_test.go` (`ls trading/internal/broker`). In-package test files do exist there (`ibkr_session_internal_test.go`), so a `package broker` test file is an accepted shape.
- **Not found** — `trading/internal/service/trading_rate_limit_test.go`. It is new.
- Service-test config seeding: `config.MustSnapshotWatcher("trading", map[string]*configv1.ConfigValue{…})` (`trading/internal/config/config.go:119`; used at `trading/internal/service/trading_order_state_audit_test.go:105-109`).
- `internal/broker` and `internal/alpacapace` are measured packages; `internal/service` is excluded (`.github/workflows/ci.yml:374`).
- Existing trading tests already carry `_AC<n>` names from other features, so this feature's tests use the `_F347_AC<N>` suffix to be selectable on their own.
- C-13: order ids, keys and header values are scenario one-offs; no literal gets a second consumer.

**TDD**: `red-green required`

**Covers**: `AC-10, AC-12, AC-13, AC-15, AC-16, AC-17, AC-18, AC-20, AC-23, AC-27`

**Instructions**:
1. `export_test.go` (`package broker`): setters for the `now`, `sleep` and `jitter` seams and for `httpClient.Transport`. Nothing else.
2. In `alpaca_test.go` add local helpers matching Step 4's (fake clock with a recording sleep, a scripted `RoundTripper` that keeps the URL host and records method, path, body and clock time per attempt, a WARN recorder). Clients use `Timeout` and `RateLimitBudget` funcs returning fixed values.
3. One test per scenario, named `Test<Subject>_F347_AC<N>` with the name ending in the scenario number (a Go name cannot hold the hyphen). AC-13 is one table test with one subtest per Examples row:
   - **AC-10** (guard): `RateLimitBudget` nil, `GET /v2/account` answers 429: exactly 1 attempt and an error containing `status 429`; repeat with a func returning 0. Red under an "ignore the budget" mutant.
   - **AC-12** (client side): `POST /v2/orders` 429 with `Reset now+1 s`, then 200 `b-1`; a MARKET order with `ClientOrderID "c-42"` and then a LIMIT order at 150.00: both attempts carry `client_order_id "c-42"` and byte-identical JSON bodies; the caller gets `b-1`.
   - **AC-13** (four rows, table test): budget and timeout from the Examples (`T`/`B` = 5 s/20 s, 5 s/5 s, 10 s/10 s, 1 s/28 s), jitter 0, the clock advancing only by sleeps, every POST 429 with no reset header, no caller deadline: attempts are 5, 1, 1, 6, the last starting 15, 0, 0, 23 s after the first; the error satisfies `errors.Is(err, broker.ErrRateLimited)`, contains `rate limited`, and is returned at that same clock time. Row 1 pins the inclusive fit rule (`7 + 8 + 5 = 20`).
   - **AC-15**: `DELETE /v2/orders/b-1` 429 with `Reset now+1 s`, then 204: exactly 2 DELETEs, no error.
   - **AC-16**: `PATCH /v2/orders/b-1` 429, then 200 `b-2`: both PATCH bodies identical with `qty "7"`; the caller gets `b-2`.
   - **AC-17**: a paper client holds state `200 / 0 / now+5 s` for `paper-api.alpaca.markets`; a separate live client's `GetAccount` to `api.alpaca.markets` answers 429 then 200: no wait for the paper reset, exactly 2 attempts.
   - **AC-18**: paper client, `GET /v2/positions` 429 with `Reset now+2 s`, then 200: one WARN whose attributes name host `paper-api.alpaca.markets` and a `wait_ms`.
   - **AC-20** (guard): client A (`KEY-A`) holds an exhausted window; client B (`KEY-B`) on the same host fetches the account with no wait. The keying itself is pinned in `pace_test.go`.
   - **AC-23**: paper client with state `200 / 0 / now+10 s`, `T` 5000 ms, `GetPositions` on a context with a 5 s deadline: no request reaches the transport; within 100 ms the error satisfies `errors.Is(err, broker.ErrRateLimited)` and contains `rate limited` and `paper-api.alpaca.markets`.
   - **AC-27** (client side): `T` 1000 ms, first POST 429 with no reset, the second attempt gets no response for 3 s (real clock): 2 attempts; the error is a timeout (`context.DeadlineExceeded` or a `net.Error` timeout) and is **not** `ErrRateLimited`.
4. Additional client cases the design's open risks require:
   - A read bounded by one `T` (caller deadline = `T`) that gets a 429 with `Reset now+10 s` sends exactly one attempt and returns `ErrRateLimited` without sleeping (the poller case).
   - FR-5 degradation: responses with no rate-limit headers never cause a sleep; a 429 with no headers still retries on backoff.
   - A mutation whose caller cancels during a wait still sends its retry (the loop is detached); a read whose caller cancels during a wait returns `ErrRateLimited`, not `context.Canceled`.
   - `ErrRateLimited` is never `ErrInvalidCredentials`, and a 401 on a retry still returns `ErrInvalidCredentials` (TRADING-3).
5. `trading_rate_limit_test.go` (`package service`): `TestRateLimitBudget` — table over `rateLimitBudget(enabled, t, stale)`: `(true, 5 s, 30 s) → 20 s`, `(true, 5 s, 15 s) → 5 s`, `(true, 10 s, 15 s) → 10 s`, `(true, 1 s, 30 s) → 28 s`, `(false, 5 s, 30 s) → 0`. `TestAlpacaRateLimitBudget_FollowsConfig` — with `MustSnapshotWatcher` values `broker.timeout_ms`/`order_intent.stale_multiplier` of 5000/3.0, 5000/1.5, 10000/1.5 and 1000/3.0 the method returns 20, 5, 10 and 28 s; with `broker.adaptive_rate_limit_enabled` false it returns 0; with the key absent it returns the enabled value; and with the key present as bool `true` (the value migration 052 seeds) it returns the enabled value (`20 s` at 5000/3.0).
6. RED: with Step 7's symbols present, `do` a single attempt and `rateLimitBudget` returning 0, every non-guard test fails on an assertion. Guards (AC-10, AC-20) are recorded with their mutant.
7. Real-time cost: about 2.5 s (AC-27); everything else runs on the fake clock.
8. Trading-domain: Alpaca only, IBKR unaffected (no `ibkr*.go` test changes). Order types: AC-12 exercises MARKET and LIMIT; STOP, STOP_LIMIT and TRAILING_STOP use the same replayed body and are unaffected. Fill handling is unaffected (`PARTIALLY_FILLED` and `FILLED` processing is not touched by the client).

**Verification**:
```bash
cd services/xstockstrat-trading && GOWORK=off golangci-lint run --modules-download-mode=mod
export GOWORK=off; COVERPKGS=$(go list ./... | grep -Ev '/(cmd|handler|repository|telemetry|service)(/|$)' | tr '\n' ',' | sed 's/,$//')
go test ./... -race -count=1 -coverprofile=coverage.out -covermode=atomic -coverpkg="${COVERPKGS}" && go tool cover -func=coverage.out | grep "^total:"   # >= 40%
GOWORK=off go test ./internal/broker/... -race -count=1 -run 'F347_AC(10|12|13|15|16|17|18|20|23|27)\b' -v | grep -c "^--- PASS"   # 10: one top-level test per scenario
GOWORK=off go test ./internal/service/... -race -count=1 -run 'RateLimitBudget' -v | grep -c "^--- PASS"   # 2: TestRateLimitBudget, TestAlpacaRateLimitBudget_FollowsConfig
grep -rn "func Set" internal/broker/export_test.go      # the four seams only
```

---

### Step 9 — service: trading handles the rate-limit outcome and bounds its Alpaca-only calls

**Status**: `pending`
**Service**: `xstockstrat-trading`
**Files**:
- `services/xstockstrat-trading/internal/repository/order_intent_repo.go` — modify
- `services/xstockstrat-trading/internal/service/trading.go` — modify
- `services/xstockstrat-trading/CLAUDE.md` — modify
- `services/xstockstrat-trading/docs/context-constitution.md` — modify
- `services/xstockstrat-trading/docs/reconciliation.md` — modify

**Reviewers**: `xstockstrat-trading` owner — order execution correctness, broker API safety, fill detection, paper-only dev invariant, position limit enforcement

**Codebase Evidence**:
- Repository: `OrderIntentRepository` `trading/internal/repository/order_intent_repo.go:36-52`; states `:14-20` (`IntentStatePending = 1`); the PENDING-guarded CAS shape with `RETURNING intent_id` is `finalizeIntentSQL` `:126-131`, and `pgx.ErrNoRows` → no-op in `FinalizeIntent` `:133-146`; `reclaimOrphanIntentSQL` `:105-109`. There is no delete path on `trading.order_intents` today (recon; D-25).
- Implementers of the interface: `pgOrderIntentRepo` (`:54`); `fakeReconciliationOrderIntentRepo`, which implements every method explicitly and asserts the interface (`trading/internal/service/trading_reconciliation_test.go:827-865`). The other fakes embed the interface and compile unchanged: `memIntentRepo` (`trading_flatten_rejection_test.go:39-43`), `fakeOrderIntentRepo` (`trading_bracket_test.go:500-515`), `staleIntentRepo` and `ctxCapturingIntentRepo` (`trading_order_state_audit_test.go:299`, `:625`).
- `CancelOrder` `trading/internal/service/trading.go:1300-1437`: intent id `deriveReplaceCancelIntentID(req)` `:1330`; `InsertIntent` `:1334`; the "outcome is unknown" reply `:1357-1359`; in-memory PENDING mark `:1368`; `entry.client.CancelOrder` `:1383`; the generic failure branch that sets `finalIntentState = IntentStateUnknown` `:1387-1391`; bracket-leg block `:1397-1416` (leg cancels `:1402`, `:1407`, their WARNs `:1403`, `:1408`, `order.bracket_updated` `:1414`); CANCELED write `:1418-1426`; `persistOrderBestEffort(ctx, order, "cancel_final")` `:1428`; `finalizeCancelIntent` `:1429`; `order.canceled` `:1431`; `broadcastOrder` `:1434`.
- `reconcileNotCancelable` `:1442-1459`: the re-read `entry.client.GetOrder(ctx, order.BrokerOrderId)` `:1443`; on failure `Unavailable` "…its status could not be read…" `:1448-1449`.
- `finalizeCancelIntent` `:1461-1469` already finalizes on `context.WithoutCancel(ctx)` (`:1466`).
- `ReplaceOrder` `:1473-1624`: `InsertIntent` `:1531`; PENDING mark `:1565`; `validateTIF` `:1575` (after the insert — the pre-existing defect, not fixed here); `entry.client.ReplaceOrder` `:1580`; the non-uncertain branch that finalizes Rejected `:1581-1587`; `codes.Internal` `:1589`.
- Fill poller: `pollFills` `:1772`; `entry.client.GetOrder(ctx, order.BrokerOrderId)` `:1822` on the loop context with no per-call timeout; `s.logTick(ctx, telemetry.LoopFillPoller, …)` `:1831`; `logTick` writes no record when every reached item failed (`:1836-1848`).
- Per-call timeout precedent: `reconcileTick` and `syncPositions` wrap each broker call in `WithTimeout(ctx, brokerCallTimeout(s.cfgW))` (`:2063`, `:2477`).
- `flattenAndHalt` `:2908`: retry loop `:2986-3011`; `s.submitOrder(…)` `:2990`; a rejection re-mints `flattenReq.ClientOrderId` and `flattenOrderID` `:2994-3000`; the halt after the loop `:3013`. `submitOrder` returns `&brokerRejectedError{err: err}` (`:760`), whose `Unwrap` keeps `errors.Is(err, broker.ErrRateLimited)` true (`order_intent.go:57-60`). `haltAccount` short-circuits when already halted (`:2872-2878`).
- `brokerPoolEntry` carries `brokerType int32` (`:75-81`); the client dispatch treats everything that is not IBKR as Alpaca (`instantiateBrokerLocked` `default:` branch `:3259`).
- Resize cancels (`:3603`, `:3608`) are IBKR-only (`:3539-3543`) and are not touched (D-23).
- Docs: `trading/CLAUDE.md:82` (`broker.timeout_ms` row, which still says "Read at account-client construction" although `timeout()` reads it before every request); `trading/docs/context-constitution.md` rows `TRADING-1..7`, `TRADING-N1..N3` (TRADING-3 `:17`, TRADING-6 `:20`); `trading/docs/reconciliation.md` § Order Status Reconciliation `:3`.

**Lands with**: `Step 10`

**TDD**: `red-green required`

**Covers**: —

**Instructions**:
1. `order_intent_repo.go`: add to the interface `ReleasePendingIntent(ctx context.Context, intentID string) (released bool, err error)` and implement it on `pgOrderIntentRepo` with `DELETE FROM trading.order_intents WHERE intent_id = $1 AND state = $2 RETURNING intent_id` (`$2 = IntentStatePending`); `pgx.ErrNoRows` → `(false, nil)`. Comment (two lines): a dedup row is deleted only while PENDING and only after a definite broker non-processing.
2. `trading.go`, new helper `alpacaCallContext(ctx context.Context, entry brokerPoolEntry) (context.Context, context.CancelFunc)`: returns `context.WithTimeout(ctx, brokerCallTimeout(s.cfgW))` unless `commonv1.BrokerType(entry.brokerType) == commonv1.BrokerType_BROKER_TYPE_IBKR`, in which case it returns `ctx` and a no-op cancel. The test is `!= IBKR`, never `== ALPACA` and never a type assertion (D-28d, R-17). It does not read the kill switch (D-28e).
3. Use `alpacaCallContext` at exactly three sites: the fill poller's `GetOrder` (`:1822`), the `reconcileNotCancelable` re-read (`:1443`), and each bracket-leg cancel in `CancelOrder` (`:1402`, `:1407`). A leg cancel that fails keeps its existing WARN.
4. New helper `refuseRateLimitedMutation(ctx, op string, order *tradingv1.Order, intentID string, prevIntent tradingv1.IntentState, cause error) error`:
   - calls `s.orderIntentRepo.ReleasePendingIntent(context.WithoutCancel(ctx), intentID)`;
   - released → restores the in-memory intent state to `prevIntent` and returns `codes.Unavailable` with "`<op>` on order `<id>` was refused by the broker rate limit; the order is unchanged";
   - not released (a DB error, or the row was already reclaimed) → sets the in-memory intent state to UNKNOWN and returns `codes.Unavailable` with "`<op>` on order `<id>` was refused by the broker rate limit and its `<op>` intent could not be released; verify with the broker before retrying";
   - logs one WARN with `order_id`, `broker_order_id`, `intent_id`, `released`, `error`; emits no ledger event; writes no order state to the DB.
5. `CancelOrder`: capture `prevIntent := order.IntentState` just before the PENDING mark (`:1368`). After `entry.client.CancelOrder` (`:1383`), add a branch ahead of the generic `else if err != nil`: `errors.Is(err, broker.ErrRateLimited)` → `return nil, s.refuseRateLimitedMutation(ctx, "cancel", order, intentID, prevIntent, err)`.
6. `CancelOrder` reorder (D-23): move the CANCELED write (`:1418-1426`), `persistOrderBestEffort` (`:1428`) and `finalizeCancelIntent` (`:1429`) ahead of the bracket-leg block (`:1397-1416`). `order.canceled` (`:1431`) and `broadcastOrder` (`:1434`) stay last. The reorder is unconditional.
7. `ReplaceOrder`: capture `prevIntent` just before the PENDING mark (`:1565`). After `entry.client.ReplaceOrder` (`:1580`), handle `errors.Is(replaceErr, broker.ErrRateLimited)` first by returning `refuseRateLimitedMutation(ctx, "replace", …)`; no Rejected intent is finalized on that path. The existing branches are unchanged.
8. `flattenAndHalt`: right after `s.submitOrder` (`:2990`), when `errors.Is(err, broker.ErrRateLimited)` call `s.haltAccount(context.Background(), bracket.AccountID, <reason naming the rate limit and the bracket order>, int32(tradingv1.HaltSource_HALT_SOURCE_BRACKET_PROTECTION))` and let the loop continue, re-minting ids as today. Do not return and do not skip the remaining retries (D-11, R-8).
9. `isUncertainBrokerOutcome` (`:2565-2569`) is **not** changed: `ErrRateLimited` is definite, a timeout stays uncertain. A rate-limited submit therefore stays REJECTED with `order.broker_rejected`.
10. Trading-domain constraints for this step:
    - Broker coverage: the three bounded sites apply to every non-IBKR account. `IBKR`: other broker unaffected — `alpacaCallContext` returns the context unchanged, and an IBKR client never returns `ErrRateLimited`.
    - Trading mode gate: no order-placing call is added; `flattenAndHalt` keeps resolving its mode through `resolveTradingMode` (`:2970`), and the cancel and replace changes only remove a local write. Paper and live behave the same (FR-10).
    - Order type handling is unaffected by this step.
    - Fill state: `applyBrokerOrderStatus` and the status mapping are unchanged, so `PARTIALLY_FILLED` and `FILLED` propagate as before; the poller only gains a per-call deadline. `CancelOrder` of a `PARTIALLY_FILLED` parent follows the same reordered path as a `NEW` one (Step 10 tests both).
    - No env var and no outbound gRPC call is added.
11. `trading/CLAUDE.md`, config table and client behavior (from Step 7): add the `broker.adaptive_rate_limit_enabled` row (bool, `true`, explicit-true default, read live per request, off = single unpaced attempt, seeded by the `alpaca_adaptive_rate_limit_keys` config migration, Alpaca only); correct the `broker.timeout_ms` row (`:82`) to "read live before every request"; add an "Adaptive rate limit (Alpaca)" paragraph with the budget `max(T, S − 2T)` and its four-row table from `design.md` § 4, "trading fails fast", "mutations run detached from caller cancellation", and the recorded consequence that every call bounded by one `broker.timeout_ms` skips spreading. In the same paragraph document (a) a rate-limited submit is REJECTED with `order.broker_rejected`, its error carries "rate limited", and a caller reusing the same `client_order_id` replays that REJECTED; (b) a caller whose own deadline is shorter than a retry wait plus one attempt gets that REJECTED; (c) a rate-limited cancel or replace returns `Unavailable`, leaves the order unchanged and releases its intent; (d) the emergency flatten halts the account on the first rate-limited submit and keeps retrying, and under a hold each watchdog tick still records REJECTED flatten orders; (e) the cancel intent is finalized before the bracket-leg cancels, and the fill poller's `GetOrder`, the not-cancelable re-read and each leg cancel are bounded by one `broker.timeout_ms` on non-IBKR accounts; (f) worst case at defaults: `CancelOrder` ≤ 35 s, cancel-intent lifetime ≤ 25 s; (g) the clamp row: at `broker.timeout_ms` 10 s with the multiplier at 1.5, mutation budget plus re-read is 20 s against a 15 s threshold.
12. `trading/docs/context-constitution.md`: add `TRADING-8` — "an `order_intents` row is deleted only by `ReleasePendingIntent`, only while PENDING, and only after `broker.ErrRateLimited`" with its failure mode (a deleted finalized row re-arms a duplicate mutation) and anchor. Add to TRADING-3 that `ErrRateLimited` is never `ErrInvalidCredentials` and never wraps a context error.
13. `trading/docs/reconciliation.md` § Order Status Reconciliation: one paragraph — a throttled `GetOrder` is a failed poll for that order, a tick whose every poll failed writes no `loop tick ok`, and each poll is bounded by one `broker.timeout_ms` on non-IBKR accounts.

**Verification**:
```bash
cd services/xstockstrat-trading && GOWORK=off go build ./... && GOWORK=off go vet ./internal/service/... ./internal/repository/...
grep -n "alpacaCallContext(" internal/service/trading.go | wc -l          # 5: the definition, GetOrder in pollFills, the re-read, two leg cancels
grep -n "TRADING_MODE\|TradingMode\|paper\|PAPER" internal/service/trading.go | grep -n "resolveTradingMode" | head -3   # mode gate still present
grep -n "func isUncertainBrokerOutcome" -A4 internal/service/trading.go   # unchanged: no ErrRateLimited
grep -n "DELETE FROM trading.order_intents" internal/repository/order_intent_repo.go   # exactly one, guarded on intent_id and state
grep -n "TRADING-8" docs/context-constitution.md
grep -n "broker.adaptive_rate_limit_enabled" CLAUDE.md                     # the key row and default are declared before Step 11 seeds
```

---

### Step 10 — test: trading service rate-limit outcomes and bounds

**Status**: `pending`
**Service**: `xstockstrat-trading`
**Files**:
- `services/xstockstrat-trading/internal/service/trading_rate_limit_test.go` — modify
- `services/xstockstrat-trading/internal/service/trading_flatten_rejection_test.go` — modify
- `services/xstockstrat-trading/internal/service/trading_cancel_not_cancelable_test.go` — modify
- `services/xstockstrat-trading/internal/service/trading_reconciliation_test.go` — modify

**Reviewers**: `xstockstrat-trading` owner — order execution correctness, broker API safety, fill detection

**Codebase Evidence**:
- `memIntentRepo` (`trading/internal/service/trading_flatten_rejection_test.go:39-71`): a stateful map-backed store with `InsertIntent`, `GetIntentByID` and `FinalizeIntent`; it embeds the interface, so it needs a real `ReleasePendingIntent`.
- `newFlattenHarness` `:88-112` builds the service with a `fakeBroker`, `memIntentRepo`, `halted` maps and a `SUBMITTING` bracket; `run` `:114-120` calls `flattenAndHalt`; existing cases `:124`, `:146`, `:166`, `:176`.
- `fakeReconciliationOrderIntentRepo` `trading_reconciliation_test.go:827-865`: every other method panics "not implemented"; the new method follows that convention.
- `auditSvc` `trading_order_state_audit_test.go:117-126` (snapshot watchers `activeSnapshot` `:105-109`, `activePlatformSnapshot` `:111-115`); `ctxCapturingDB` `:39-51` records each `Exec` with its context; `workingOrder` `:135`; `traceHarness.activeBracket` `:752-761` creates an ACTIVE bracket with legs `leg-stop` and `leg-tp`; `tracedCancelledCtx` `:75`; `waitForLedgerEvents` `:93`.
- `notCancelableSvc` `trading_cancel_not_cancelable_test.go:22-35` and `TestCancelOrder_NotCancelable_ReReadFails_LeavesOrderForPoller` `:95`.
- `fakeBroker` has `submitOrderFn`, `cancelOrderFn`, `getOrderFn` (`trading_bracket_test.go:26-34`) and no replace hook; wrappers that override `ReplaceOrder` exist (`replaceOKBroker` `trading_order_state_audit_test.go:68-72`, `replaceFailBroker` `:707-711`).
- Log capture: `captureLogs` (`trading_sync_test.go:16`).
- `trading_rate_limit_test.go` exists from Step 8.
- `trading/internal/service` and `internal/repository` are excluded from the coverage threshold (`.github/workflows/ci.yml:374`). `NewOrderIntentRepo` takes a concrete pool (`order_intent_repo.go:58`), so `ReleasePendingIntent`'s SQL has no repository-level test home; it is checked by review (design § 7).
- C-13: order ids `ord-1`, `b-1`, `acct-1`, `user-1` are already inline in these files' own harnesses; the new file builds its own orders as scenario one-offs.

**Lands with**: `Step 9`

**TDD**: `red-green required`

**Covers**: `AC-12, AC-25, AC-26, AC-27, AC-28, AC-29, AC-30, AC-31, AC-34, AC-35, AC-36`

**Instructions**:
1. Fakes: `memIntentRepo` gains a map-backed `ReleasePendingIntent` (delete the record and return true only when its state is PENDING; false otherwise). `fakeReconciliationOrderIntentRepo` gains the method in its panic convention.
2. Tests are named `Test<Subject>_F347_AC<N>` with the name ending in the scenario number; AC-35's `NEW`-parent run is a subtest of the AC-35 test. Add one helper in `trading_rate_limit_test.go` that builds a service for the real-client scenarios: `cfgW` from `config.MustSnapshotWatcher("trading", …)`, a real `broker.NewClient` with `PaperURL` set to an `httptest` server, `Paper: true`, `Timeout: func() time.Duration { return brokerCallTimeout(svc.cfgW) }` and `RateLimitBudget: svc.alpacaRateLimitBudget`, placed in `svc.brokers` with `BROKER_TYPE_ALPACA`; `memIntentRepo` for intents; `ctxCapturingDB` for stored writes. These tests use the real clock.
3. Real-client scenarios:
   - **AC-12**: first `POST /v2/orders` 429 with a reset 1 s ahead, then 200 `b-1`; a MARKET order for 10 `AAPL` with `client_order_id "c-42"`, then the same flow for a LIMIT order at 150.00: the caller gets `b-1`, and `memIntentRepo` holds exactly one intent for the order, finalized Completed.
   - **AC-25**: first POST 429 with no reset, then 200 `b-7`; the caller's context is cancelled 500 ms after the call starts: 2 POSTs with the same `client_order_id`; the order is persisted with `b-7` and is not REJECTED; the intent is Completed.
   - **AC-26**: `broker.timeout_ms` 5000; first POST 429 with a reset 2 s ahead; the call runs on a context with a 3 s deadline: exactly 1 POST; the error contains `rate limited`; the order is REJECTED, `order.broker_rejected` is emitted and the intent is Rejected.
   - **AC-27**: `broker.timeout_ms` 1000; first POST 429 with no reset; the second gets no response for 3 s: 2 POSTs; the order is not REJECTED, the intent stays PENDING and `order.broker_call_uncertain` is emitted.
   - **AC-34**: three open orders on the account; one `GetAccount` first records `200 / 0 / reset 10 s ahead`; `pollFills` runs once: no `GET /v2/orders/{id}` reaches the server, the tick ends within 100 ms with 3 logged `GetOrder` failures and no `loop tick ok` for `fill_poller`.
   - **AC-35**: a `PARTIALLY_FILLED` order with an ACTIVE bracket (`leg-stop`, `leg-tp`); `DELETE /v2/orders/b-1` answers 204; each leg DELETE answers 429 carrying only a reset 10 s ahead: exactly 1 DELETE per leg; inside the first leg handler, the stored writes already include CANCELED and the cancel intent is already Completed; the caller gets success within 1 s; one WARN per leg names its `leg_id`. Add the same assertion run for a `NEW` parent.
   - **AC-36** (guard until Step 7): `DELETE /v2/orders/b-1` answers 422; `GET /v2/orders/b-1` answers 429 carrying only a reset 10 s ahead: exactly 1 GET; within 1 s the caller gets `Unavailable` containing `could not be read`; the order has intent state UNKNOWN and is not CANCELED. It lives in `trading_cancel_not_cancelable_test.go`.
4. **AC-28** in `trading_flatten_rejection_test.go`: the harness uses the real client behind a wrapper that records each `SubmitOrder` request's `ClientOrderID` and whether the account was halted when it was called. `order.max_retries` 3. The first POST answers 429 with `200 / 0 / reset 50 s ahead`. Assert: the account is halted before the second flatten submit; 4 flatten orders are REJECTED; the 4 submits carried 4 distinct client order ids; exactly 1 POST reached the server; the account is still halted afterwards. About 1.5 s of real time (`order.retry_delay_ms` 500 × 3).
5. Fake-broker scenarios in `trading_rate_limit_test.go` (the broker returns `fmt.Errorf("…: %w", broker.ErrRateLimited)`):
   - **AC-29**: order `ord-1` NEW with intent state COMPLETED; the first cancel is refused, the second accepted. First call: `Unavailable` containing `refused by the broker rate limit; the order is unchanged`; the order is still NEW with intent state COMPLETED; no CANCELED write and no `order.canceled`; no cancel intent row remains; one WARN names `order_id`, `broker_order_id` and the intent id. The identical second call reaches the broker and the order is CANCELED.
   - **AC-30**: the fake's cancel hook first sets the stored cancel intent to UNKNOWN (as the sweeper does), then returns the rate-limit error: `Unavailable` containing `could not be released; verify with the broker before retrying`; the order is NEW with intent state UNKNOWN; an identical cancel returns `FailedPrecondition` containing `outcome is unknown` and makes no broker call.
   - **AC-31**: order NEW for 10 shares; a wrapper overriding `ReplaceOrder` refuses the first replace and accepts the second: first call `Unavailable` with the "unchanged" text, quantity still 10, no replace intent row; the identical second call reaches the broker and the quantity is 7.
6. Existing tests in the four files keep their assertions; run the whole package to confirm the cancel reorder changes no existing expectation (`TestTrace_CancelOrder`, the `NotCancelable` cases, the `FinalWriteFailureLogged` cases).
7. RED, captured on the tree that already holds Steps 7-8: AC-34, AC-35 and AC-36 fail on timing and request counts (the calls wait and retry); AC-28 fails on the halt order; AC-29, AC-30 and AC-31 fail on the status code and the local CANCELED / stored Rejected state; AC-25, AC-26 and AC-27 are expected to pass once Step 7 has landed — record them as "red captured at the Step 7+8 unit" if so, never silently.
8. New logic is in excluded packages — no coverage threshold applies; these tests are the verification.
9. Trading-domain: Alpaca only (`alpacaCallContext` returns the context unchanged for IBKR). Order types as in Step 8. Fill states: `PARTIALLY_FILLED` is exercised by AC-35 beside `NEW`; `FILLED` handling is unchanged (`applyBrokerOrderStatus` is not touched).

**Verification**:
```bash
cd services/xstockstrat-trading && GOWORK=off golangci-lint run --modules-download-mode=mod
export GOWORK=off; COVERPKGS=$(go list ./... | grep -Ev '/(cmd|handler|repository|telemetry|service)(/|$)' | tr '\n' ',' | sed 's/,$//')
go test ./... -race -count=1 -coverprofile=coverage.out -covermode=atomic -coverpkg="${COVERPKGS}" && go tool cover -func=coverage.out | grep "^total:"   # >= 40%
GOWORK=off go test ./internal/service/... -race -count=1 -run 'F347_AC(12|25|26|27|28|29|30|31|34|35|36)\b' -v | grep -c "^--- PASS"   # 11: one top-level test per scenario
grep -rn "func (m \*memIntentRepo) ReleasePendingIntent\|func (f \*fakeReconciliationOrderIntentRepo) ReleasePendingIntent" internal/service
grep -n "PARTIALLY_FILLED" internal/service/trading_rate_limit_test.go    # the partial-fill case exists beside the NEW case
```

---

### Step 11 — migration: seed the two kill switches, update the ceiling description, regenerate the stored set

**Status**: `pending`
**Service**: `xstockstrat-config`
**Files**:
- `services/xstockstrat-config/migrations/052_alpaca_adaptive_rate_limit_keys.up.sql` — create
- `services/xstockstrat-config/migrations/052_alpaca_adaptive_rate_limit_keys.down.sql` — create
- `scripts/config-wiring-stored.json` — modify (generated by `scripts/config-wiring-stored.py`)
- `scripts/config-wiring.json` — modify (remove the two Step 3 / Step 7 `read-unseeded` entries)
- `docs/patterns/config-governance.md` — modify
- `docs/roadmap/features/merge-order.md` — modify (only if the migration number moves)

**Reviewers**: DBA — migration NNN numbering, up+down pair present, run-order compliance with `scripts/db-migrate.sh`; `xstockstrat-config` owner — config key naming, environment / global-per-user scoping, WatchConfig stream stability

**Codebase Evidence**:
- Last config migration on this tree: `051_ingest_backfill_self_serve_keys` (`ls config/migrations | tail -2`). Next free is `052`. Claims on other branches: `docs/roadmap/features/merge-order.md` § "Config seed number and Alpaca client overlap: 347".
- Seed shape with the actor sentinel: `config/migrations/050_ui_chart_history_bars.up.sql` — columns `(namespace, key, value_type, value_data, description, default_value, consuming_service, updated_by, environment, user_id)`, one row per environment, `user_id` NULL, ending `ON CONFLICT (namespace, key, environment, COALESCE(user_id, '')) DO NOTHING`.
- A bool row stores `value_data` `'true'`: `config/migrations/001_config_tables.up.sql:65`; the server parses it as `row.value_data === 'true'` (`config/src/__tests__/configValueRoundtrip.test.ts:157`).
- Guarded down: `config/migrations/050_ui_chart_history_bars.down.sql` (sentinel actor, `user_id IS NULL`, key and seeded `value_data`); multi-key form with load-bearing outer parentheses: `049_notify_commsgun_channel_keys.down.sql:5-18`.
- Description-only UPDATE guarded on the exact old text: `config/migrations/032_analysis_zero_trap_descriptions.up.sql` (each `UPDATE … SET description = … WHERE namespace = … AND key = … AND description = '<old>'`).
- The current `backfill.rate_limit_rps` description, identical in both environments: `scripts/config-wiring-stored.json:2650` and `:2662`; it was written by `041_heal_config_keys_to_reader_catalog.up.sql:151`.
- The checker reads seeds only from `scripts/config-wiring-stored.json`; `--final` fails `STALE-STORED` when `inputs_sha256` no longer matches the migration set (`scripts/check-config-wiring.mjs:226-231`, `:714-717`). It also reports `metadata-missing`, `type-mismatch` and `default-mismatch` for a seeded, read key (`:645-652`), so each row needs a description, a `consuming_service`, `value_type` `bool` and `default_value` `'true'`.
- Both keys are absent today: `grep -c "adaptive_rate_limit_enabled" scripts/config-wiring-stored.json` → 0.
- Registered-keys log: `docs/patterns/config-governance.md:145`, newest first; the newest entry (feature 343) is at `:151` and the feature 341 entry at `:165`.
- Ledger: "a seed migration's down deletes only rows it can prove it wrote" (`fails.md:3841`); the insert-if-absent plus guarded-metadata pattern (`insights.md:4214`).
- Config-key contract (C-05), both keys: `value_type` `bool`, code default `true`, live per request. `marketdata` / `alpaca.adaptive_rate_limit_enabled`, reader `services/xstockstrat-marketdata/cmd/server/main.go:alpacaAdaptiveRateLimit` (Step 3). `trading` / `broker.adaptive_rate_limit_enabled`, reader `services/xstockstrat-trading/internal/service/trading.go:(*TradingService).alpacaRateLimitBudget` (Step 7). Seed: this step.
- The two temporary baseline entries added by Steps 3 and 7 are in the `findings` array of `scripts/config-wiring.json`; once the keys are seeded a left-over entry is `STALE` and fails `--final` (precedent: feature 341 Step 11 removes its Step 7 entry).
- Regeneration in CI: the migrator image is built from `scripts/Dockerfile.migrate` and runs `scripts/config-wiring-stored.py` (`.github/workflows/ci.yml:1274-1282`), then `scripts/config-heal-dryrun.py --fresh` with `git diff --exit-code scripts/config-heal/dryrun-fresh.tsv` (`:1284-1290`), then `git diff --exit-code scripts/config-wiring-stored.json` (`:1292-1293`).

**TDD**: `N/A (migration)`

**Covers**: —

**Instructions**:
1. Re-derive the number first (`ls services/xstockstrat-config/migrations | tail -2`). If `052` is taken, use the next free number, update `merge-order.md` § "Config seed number and Alpaca client overlap" and record the renumber in the Deviation Log. Step 12's lookup is number-free.
2. `…_alpaca_adaptive_rate_limit_keys.up.sql`, two-line header in the 050 style, then two statements.
   - Statement 1: one `INSERT INTO config.config_values` in the 050 column list with four rows — (`marketdata`, `alpaca.adaptive_rate_limit_enabled`) and (`trading`, `broker.adaptive_rate_limit_enabled`), each for `staging` and `production` — `value_type` `'bool'`, `value_data` `'true'`, `default_value` `'true'`, `consuming_service` `'xstockstrat-marketdata'` / `'xstockstrat-trading'`, `updated_by` `'system:config-migration-feature-alpaca-adaptive-rate-limit'`, `user_id` `NULL`, ending `ON CONFLICT (namespace, key, environment, COALESCE(user_id, '')) DO NOTHING`.
   - Description, marketdata key (same on both rows): `Kill switch for adaptive Alpaca REST pacing in marketdata. When true the client paces requests from the X-RateLimit-Limit, X-RateLimit-Remaining and X-RateLimit-Reset response headers and retries an HTTP 429 inside the call. When false it behaves as before feature 347: only the static backfill.rate_limit_rps limiter applies and a 429 is returned to the caller. Read live on every Alpaca request.`
   - Description, trading key (same on both rows): `Kill switch for adaptive Alpaca broker pacing in trading. When true the Alpaca client paces requests from the X-RateLimit-Limit, X-RateLimit-Remaining and X-RateLimit-Reset response headers and retries an HTTP 429 within a budget derived from broker.timeout_ms and order_intent.stale_multiplier. When false every broker call is one unpaced attempt, as before feature 347. Read live on every Alpaca request. IBKR is not affected.`
   - Statement 2: `UPDATE config.config_values SET description = '<NEW>' WHERE namespace = 'marketdata' AND key = 'backfill.rate_limit_rps' AND description = '<OLD>'`.
   - `<OLD>` (exact): ``Max outbound Alpaca REST calls per second. Read at startup into a token-bucket limiter the client waits on before every REST call; `0` disables rate limiting.``
   - `<NEW>` (exact; this is the text AC-37 names): ``Static ceiling on outbound Alpaca REST calls per second. The effective rate is the lower of this ceiling and what the X-RateLimit response headers allow (alpaca.adaptive_rate_limit_enabled). Read live per request into a token-bucket limiter the client waits on before every REST call; `0` disables only this ceiling.``
   - No description contains a single quote.
3. `…down.sql`, two statements: (a) one `DELETE FROM config.config_values` restricted to `environment IN ('staging', 'production')`, `user_id IS NULL`, the sentinel `updated_by`, `value_data = 'true'` and a parenthesized `OR` of the two (namespace, key) pairs; (b) the reverse `UPDATE`, setting `<OLD>` where the description still equals `<NEW>`. A row an operator has changed is never deleted or rewritten.
4. Regenerate the stored set against a scratch TimescaleDB/Postgres 16 on `:5432`, in the CI form: `docker build -f scripts/Dockerfile.migrate -t xstockstrat-migrate-ci .`, then `docker run --rm --network host -e DATABASE_URL="postgres://xstockstrat:ci-only@localhost:5432/xstockstrat?sslmode=disable" -v "$PWD:/repo" -w /repo --entrypoint python3 xstockstrat-migrate-ci scripts/config-wiring-stored.py`. On a host that has `migrate` and `psql`, `DATABASE_URL=<scratch postgres> python3 scripts/config-wiring-stored.py` is equivalent. Then, against the same database and in the same form, run `scripts/config-heal-dryrun.py --fresh` and confirm `git diff --exit-code scripts/config-heal/dryrun-fresh.tsv` (the second check of CI job `config-wiring-stored`). Commit the JSON unedited. If neither route is available the step is blocked (P-03).
4a. Remove the two temporary `findings` entries (namespace `marketdata` / key `alpaca.adaptive_rate_limit_enabled`, and namespace `trading` / key `broker.adaptive_rate_limit_enabled`) from `scripts/config-wiring.json` in this step; a left-over entry is `STALE` and fails `--final`.
5. `docs/patterns/config-governance.md`: add a "feature 347 — alpaca-adaptive-rate-limit (`xstockstrat-marketdata` / `xstockstrat-trading` / `xstockstrat-config`)" entry at the top of the log, above the 343 entry (`:151`), modelled on the 341 entry (`:165`): what the keys do, seeded `true` in staging and production (global, non-secret, insert-if-absent) by `alpaca_adaptive_rate_limit_keys` with the number-free sentinel, the guarded down, the `backfill.rate_limit_rps` description change, no `SCALAR_BOUNDS_REGISTRY` entry (bool), no remaining `scripts/config-wiring.json` baseline entry (the two temporary ones are removed here), approval owner + config team, and a two-row table (namespace, key, type, default, reader, notes).
6. No env var, deployment file or `.do/app*.yaml` changes.
7. Six files because the migration pair, the stored set generated from it, the baseline removal that the seed makes mandatory (else `STALE`) and the registry doc are one indivisible change; `merge-order.md` is touched only on a renumber.

**Verification**:
```bash
ls services/xstockstrat-config/migrations/*_alpaca_adaptive_rate_limit_keys.up.sql services/xstockstrat-config/migrations/*_alpaca_adaptive_rate_limit_keys.down.sql
ls services/xstockstrat-config/migrations | tail -2      # the new pair carries the highest number, no duplicate prefix
# read both: 4 rows, relative keys, sentinel actor, guarded UPDATE; the down deletes exactly what the up inserts and swaps the description back
node scripts/check-config-wiring.mjs --keys marketdata.alpaca.adaptive_rate_limit_enabled,trading.broker.adaptive_rate_limit_enabled   # silent, exit 0
node scripts/check-config-wiring.mjs --final        # exit 0: no STALE-STORED, no read-unseeded for the two keys, no type/default/metadata finding
node scripts/check-config-wiring.mjs --doc-check    # exit 0
node --test scripts/config-wiring.test.mjs
grep -c '"key": "[a-z_.]*adaptive_rate_limit_enabled"' scripts/config-wiring-stored.json   # 4
! grep -q "adaptive_rate_limit_enabled" scripts/config-wiring.json        # both temporary baseline entries are gone
git diff --exit-code scripts/config-heal/dryrun-fresh.tsv                 # after the fresh heal dry-run of Instruction 4: unchanged
```

---

### Step 12 — test: seed migration shape

**Status**: `pending`
**Service**: `xstockstrat-config`
**Files**:
- `services/xstockstrat-config/src/__tests__/alpacaAdaptiveRateLimitSeedMigration.test.ts` — create

**Reviewers**: `xstockstrat-config` owner — config key naming, environment / global-per-user scoping

**Codebase Evidence**:
- Static migration tests are an existing pattern: `config/src/__tests__/uiChartHistoryBarsSeedMigration.test.ts` (one `HEAD` constant, one row regex, `ON CONFLICT` suffix, guarded-down clauses) and `notifyCommsgunSeedMigration.test.ts`.
- Helper `config/src/__tests__/migrationSql.ts`: `findOne(suffix, 'up' | 'down')` `:8-16` (number-free lookup, asserts exactly one match); `splitStatements` `:19` (drops comments, splits outside literals — never a naive `;` split, ledger `fails.md` 2026-11-10, 291).
- The test glob is `dist/__tests__/*.test.js` and `tsc` compiles tests (`config/package.json:12-13`).
- The old description is in `041_heal_config_keys_to_reader_catalog.up.sql:151`, reachable with `findOne('_heal_config_keys_to_reader_catalog', 'up')`.
- C-13: the migration text is the only data; no fixture literal gets a second consumer.

**TDD**: `red-green required`

**Covers**: `AC-37`

**Instructions**:
Load the pair with `findOne('_alpaca_adaptive_rate_limit_keys', …)` and `splitStatements`. Assert:
1. The up is exactly two statements: one `INSERT INTO config.config_values` in the 050 column list ending `ON CONFLICT (namespace, key, environment, COALESCE(user_id, '')) DO NOTHING`, and one `UPDATE config.config_values`.
2. The INSERT has exactly four rows: (`marketdata`, `alpaca.adaptive_rate_limit_enabled`) and (`trading`, `broker.adaptive_rate_limit_enabled`), each once for `staging` and once for `production`, each with `value_type` `bool`, `value_data` = `default_value` = `'true'`, the matching `consuming_service`, `user_id` `NULL`, the sentinel actor and a non-empty description. Insert-if-absent plus one row per environment is the static form of "applied twice leaves exactly one global row per environment".
3. Neither stored key starts with its namespace (C-05).
4. The UPDATE sets the description to the `<NEW>` text of Step 11 exactly (the test holds it as a constant) and is restricted by `namespace = 'marketdata'`, `key = 'backfill.rate_limit_rps'` and `description = '<OLD>'`.
5. `<OLD>` occurs verbatim in the `041_heal_config_keys_to_reader_catalog` up migration, so the guard matches the row a fresh database really holds and an operator-edited description is left unchanged.
6. The down is two statements: a `DELETE` restricted to the sentinel actor, `user_id IS NULL`, `value_data = 'true'` and both (namespace, key) pairs; and an `UPDATE` back to `<OLD>` guarded on `description = '<NEW>'`.

RED: run the test with Step 11's files absent (`findOne` fails: "expected exactly one …").

The replay itself (the migration applied twice against a database) is proven by the CI `migration-rerun` job, not in this step.

**Verification**:
```bash
cd services/xstockstrat-config && pnpm run lint && pnpm run test:coverage && pnpm exec c8 check-coverage --lines 40
grep -n "migrationSql" src/__tests__/alpacaAdaptiveRateLimitSeedMigration.test.ts        # uses the shared helper
! grep -q "__tests__/fixtures" src/__tests__/alpacaAdaptiveRateLimitSeedMigration.test.ts   # no shared fixture needed (C-13)
```

---

## Deviation Log

_Populated by /sdd-execute as implementation proceeds._

### Deviation: Step 1 — pacing core `internal/alpacapace` (and Step 3's WARN)
**Spec said**: "`type Reservation struct{ Wait time.Duration; Fits bool }`" (Step 1) and "One WARN per throttled window per host, gated by `WarnOnce`" (Step 3).
**Actual**: `Reservation` gained a third field, `Hold bool`, true only for the wait of an exhausted window. The marketdata client logs the throttle WARN for a hold or a 429 wait and never for a spread slot.
**Reason**: the two-field result does not tell a spread slot from a hold, so the client could only log every non-zero wait (several WARNs a minute while quota is merely low). The design's situation tables mark WARN on the hold and 429 rows only. Operator decision at the Step 4 checkpoint (2026-11-16): "Holds and 429 waits only".
**Disposition**: operator-approved follow-up commit after Step 4; both `pace.go` copies and `pace_test.go` stay byte-identical. Step 7 (trading client) uses the same field.
