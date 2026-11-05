# Implementation Spec: fix-marketdata-dead-symbol-ingest

**Status**: `pending`
**Created**: 2026-11-04
**Feature**: `docs/roadmap/features/291-fix-marketdata-dead-symbol-ingest/feature.md`
**Total Steps**: 8
**Feature Branch**: `feature/fix-marketdata-dead-symbol-ingest`

---

## Execution Summary

Ingester-only fix. Order: seed the new key in `xstockstrat-config` (migration 035, then its `SetConfig` bounds and tests), give
`xstockstrat-marketdata` a snapshot-built `Watcher` seam so the reader can be proven against a real snapshot, land the hold
state and its wiring in a new `bar_hold.go` plus the three edit sites in `marketdata_service.go` (the struct field, `ingestRecentBarsForTimeframe`, `reportIngestCycle`; the `barsStore` field comment at `:109` is a fourth touch shared with feature 290), prove it with the RED tests from
`design.md`, then update the docs. Config comes first so the key is registered and bounded before any code reads it; the
marketdata seam precedes the ingester because the reader test needs it.

Consumer surface: **none** — the product spec marks this internal/platform-only (ingester behaviour and log volume), so no
UI/Agent step is required (C-14 is a stated decision, not an omission). No proto, no `.proto` regeneration, no new env var,
no new port (so no `docker-compose.yml` / `.do/app*.yaml` change).

### Scenario Coverage (C-15)

| Scenario | Covered by |
|---|---|
| AC-1 | Step 7 (tests 1, 2) |
| AC-2 | Step 7 (test 4) |
| AC-3 | Step 7 (test 5) |
| AC-4 | Step 7 (test 3) |
| AC-5 | Step 7 (test 6) |
| AC-6 | Step 7 (test 8, characterization) |
| AC-7 | Step 7 (test 9) |
| AC-8 | Step 7 (test 10, key `0`) |
| AC-9 | Step 7 (tests 1, 4) |
| AC-10 | Step 7 (test 10, lone symbol) |
| AC-11 | Step 3 (bounds half) + Step 5 and Step 7 (snapshot-built reader half) |
| AC-12 | Step 7 (test 13) |
| AC-13 | Step 7 (test 14) |
| AC-14 | Step 7 (test 15) |

### Corrections to `design.md` found while grounding (recorded, not silently applied)

1. **No `scripts/config-wiring.json` entry.** `design.md` lists a wiring entry. The file is a baseline of *findings*
   (`read-unseeded`, `seeded-unread`, `form-mismatch`) that "may only shrink; a new finding cannot be baselined"
   (`docs/patterns/config-governance.md` § Wiring check; `scripts/check-config-wiring.mjs` `ratchet`, STALE rule). Because this
   feature seeds the key (Step 1) *and* reads it under the identical full-dotted string (Step 6), the check produces no finding;
   adding an entry would itself fail as `STALE`. The wiring check is instead run in Steps 1, 6 and 8 as verification.
2. **`MARKETDATA-5` lives in the module file**, `services/xstockstrat-marketdata/docs/context-constitution.md:21`, not the
   root `docs/context-constitution.md` (no MARKETDATA-* rows there). Step 8 edits the module file.
3. **`CHANGELOG.md` is not edited.** It is generated per promotion by `/promote`. The "`missing`/`total` are now over
   non-held symbols" note goes in the PR body and the Step 8 CLAUDE.md text instead.
4. **A new exported seam is needed for the snapshot-built reader test.** `config.Watcher.snapshot` is unexported
   (`services/xstockstrat-marketdata/internal/config/config.go` `Watcher` struct) and no marketdata test can populate one.
   Trading solved the same need with `config.NewSnapshotWatcher` (`services/xstockstrat-trading/internal/config/config.go:249`);
   Step 4 adds the identical 4-line constructor to marketdata (reuse, not invention).
5. **Migration number is `035`** (last on both the working tree and `origin/main-dev` is `034`). Per ledger `fails.md`
   (2026-10-14, sector-classification-strategy-params, migration) it must be re-verified against `origin/main-dev` immediately
   before merge and renumbered if a sibling landed a higher one.

## Step Dependencies

- **Execution order (red-before-green, P-06): 1 → 3 → 2 → 5 → 4 → 7 → 6 → 8.** Each test step is numbered after the service step it covers but is EXECUTED first: write it, run it, record the RED result (compile failure or failing assertion), then implement the service step and re-run to green. Step 1 (migration, TDD N/A) runs first because Step 3 reads the migration file.
- Step 3 [test] covers Step 2 [service] and Step 1 [migration] (bounds + seed shape). Execute Step 3 before Step 2; only the bounds rows are RED (the seed-shape test is green on arrival, see Step 3 instruction 3).
- Step 5 [test] covers Step 4 [service] (execute Step 5 before Step 4; written to fail first: `NewSnapshotWatcher` does not exist, the test does not compile).
- Step 7 [test] covers Step 6 [service] (execute Step 7 before Step 6). Step 7's reader test requires Step 4 (`config.NewSnapshotWatcher`).
- Step 6 requires Step 1 for the *wiring* verification only (the seed leg); the Go code itself does not depend on it.
- Step 8 [docs] follows all code steps; it documents their final shape.
- Merge coordination: feature 282 (`filter-otc-symbols`) edits the `markWarm` sites and prune in the same file; 291 touches only
  `ingestRecentBarsForTimeframe`, `reportIngestCycle`, one struct field and a new file (`docs/roadmap/features/merge-order.md:93`
  — independent, rebase-only).
- Post-merge (operator, not a step): smoke-test marketdata and config on dev — one `bar ingest: holding symbols that returned no
  bars` WARN per dead symbol once an informative-cycle streak reaches 6 h, and `GetBars`/`BatchGetBars` unchanged.

---

### Step 1 — migration: seed `marketdata.stream.bar_ingest_backoff_ms`

**Status**: `pending`
**Service**: `xstockstrat-config`
**Files**:
- `services/xstockstrat-config/migrations/035_marketdata_bar_ingest_backoff.up.sql` — create
- `services/xstockstrat-config/migrations/035_marketdata_bar_ingest_backoff.down.sql` — create

**Reviewers**: DBA — migration numbering, up+down pair, run-order; xstockstrat-config owner — config key naming (`<service>.<category>.<key>`), environment scoping, WatchConfig stream stability

**Codebase Evidence**:
- Confirmed via: `ls services/xstockstrat-config/migrations | tail` → last pair is `034_retire_portfolio_snapshot_interval.{up,down}.sql`; `git ls-tree origin/main-dev services/xstockstrat-config/migrations/` tail is also `034` → next is `035` (C-07).
- Existing seed pattern to copy exactly: `services/xstockstrat-config/migrations/033_ledger_stream_resolve_timeout.up.sql` — `INSERT INTO config.config_values (namespace, key, value_type, value_data, description, default_value, consuming_service, environment, user_id) VALUES (...'staging', NULL), (...'production', NULL) ON CONFLICT (namespace, key, environment, COALESCE(user_id, '')) DO NOTHING;` — the `ON CONFLICT … DO NOTHING` is what makes it "seed without overwriting an existing runtime value".
- Its header states the two traps that apply here: `key` must equal the full dotted string the reader reads and `value_type` must be `'int'` (a `'string'` row makes `GetInt` silently return the default). Ledger `fails.md:2333` (seed with a namespace-stripped key = silent reader-orphan) and `insights.md:905` (snapshot is keyed by the raw `key` column).
- Down pattern: `033_ledger_stream_resolve_timeout.down.sql` — `DELETE FROM config.config_values WHERE namespace = 'ledger' AND key = 'ledger.stream.resolve_timeout_ms';`
- Reader sees stored ints as `ConfigValue_IntVal`: `services/xstockstrat-marketdata/internal/config/config.go` `Watcher.GetInt` (`v.Value.(*configv1.ConfigValue_IntVal)`); a stored `0` is returned as `0`.

**TDD**: `N/A (migration — non-code-bearing; shape proven by the Step 3 migration-file test)`

**Covers**: —

**Instructions**:
1. Create `035_marketdata_bar_ingest_backoff.up.sql` with the 033 header style (`-- Migration:`, `-- Service: xstockstrat-config`, feature 291, why full-dotted + `int`), then one `INSERT` of two rows:
   `('marketdata', 'marketdata.stream.bar_ingest_backoff_ms', 'int', '21600000', <description>, '21600000', 'xstockstrat-marketdata', 'staging', NULL)` and the same with `'production'`, ending `ON CONFLICT (namespace, key, environment, COALESCE(user_id, '')) DO NOTHING;`.
2. Description (same text in both rows): how long (ms) a warm symbol must return no bars across informative bar-ingest cycles before the ingester leaves it out of the vendor request, and the probe period; `<= 0` disables the hold and clears state; bounded `[0, 86400000]`; trade-off: a false-positive hold lags that symbol's stored daily bar by up to this value. Seeded at the code default, so applying the migration changes no runtime behaviour.
3. Create `035_…down.sql`: `DELETE FROM config.config_values WHERE namespace = 'marketdata' AND key = 'marketdata.stream.bar_ingest_backoff_ms';` (all environments and any per-user override), with a header comment naming the up it reverses.
4. Do not edit any existing migration (F-01). Approvals required before merge: DBA + service owner + config team (root `CLAUDE.md` § Approval Flow).
5. Re-verify the number against `origin/main-dev` immediately before merge (see Corrections, item 5).

**Verification**:
```
cd /home/user/xstockstrat && ls services/xstockstrat-config/migrations/035_*.up.sql services/xstockstrat-config/migrations/035_*.down.sql
# read both: the .down DELETE removes exactly the two rows the .up INSERT adds; key is the full dotted string; value_type is 'int'
node scripts/check-config-wiring.mjs --declared-migration services/xstockstrat-config/migrations/035_marketdata_bar_ingest_backoff.up.sql
# expected before Step 6: exit 0 with exactly one line like
#   PENDING: <seed-dir>/035_marketdata_bar_ingest_backoff.up.sql:marketdata/marketdata.stream.bar_ingest_backoff_ms:seeded-unread
# (verified against check-config-wiring.mjs stepTime/findingLine); any other finding such as form-mismatch means the key form is wrong (exit 1).
# After Step 6 the same command prints nothing and exits 0.
```

---

### Step 2 — service: `SetConfig` bounds for the new key

**Status**: `pending`
**Service**: `xstockstrat-config`
**Files**:
- `services/xstockstrat-config/src/grpc/configServiceImpl.ts` — modify

**Reviewers**: xstockstrat-config owner — config key naming, environment/global-per-user scoping, WatchConfig stream stability

**Codebase Evidence**:
- Confirmed via: `grep -n "SCALAR_BOUNDS_REGISTRY\|last_close_lookback_days" services/xstockstrat-config/src/grpc/configServiceImpl.ts` → registry declared at L103 (`Record<string, { minValue: number; maxValue: number }>`), last entry `'portfolio.marketdata.last_close_lookback_days': { minValue: 5, maxValue: 60 },` at L148, `};` closes it after.
- Existing pattern (feature-numbered comment above a group): `// feature 240: FR-5 last-close search window for offline marks (default 21 days).` then the entry (L147-148). Keys are registered by their **full dotted** name; `lookupScalarBounds(namespace, key)` (L154-155) tries the bare key then `${namespace}.${key}`, so the full-dotted entry is hit under either stored form (ledger `fails.md:2328`).
- Lower-bound rule (ledger `insights.md` 2026-09-07, feature 184): a reader that honours a stored `0` as a real value needs lower bound `0`. `resolveBarIngestBackoff` (Step 6) reads `0` as "disabled", so `minValue: 0`; an upper bound is required because an unbounded value could recreate the frozen-series scar (`fails.md:2719`). `design.md` fixes `[0, 86400000]`.
- Bounds are write-path only (`insights.md` 2026-09-06, feature 182): no read path or running service is affected.

**TDD**: `red-green required`

**Covers**: —

**Instructions**:
1. Insert after L148 (inside the registry, before `};`):
   ```
   // feature 291: bar-ingest dead-symbol back-off. 0 is the documented kill switch; the 24h ceiling bounds how long a
   // false-positive hold can freeze a warm symbol's daily bar.
   'marketdata.stream.bar_ingest_backoff_ms': { minValue: 0, maxValue: 86400000 },
   ```
2. No other change; do not touch `lookupScalarBounds`.

**Verification**:
```
cd /home/user/xstockstrat/services/xstockstrat-config && pnpm run lint && pnpm run test:coverage && pnpm exec c8 check-coverage --lines 40
```

---

### Step 3 — test: bounds and seed-shape tests for the new key

**Status**: `pending`
**Service**: `xstockstrat-config`
**Files**:
- `services/xstockstrat-config/src/__tests__/setConfigScalarBounds.test.ts` — modify
- `services/xstockstrat-config/src/__tests__/barIngestBackoffSeedMigration.test.ts` — create

**Reviewers**: xstockstrat-config owner — config key naming, scoping, WatchConfig stream stability

**Codebase Evidence**:
- Confirmed via: `grep -n "TIMEOUT_KEY_FORMS" services/xstockstrat-config/src/__tests__/setConfigScalarBounds.test.ts` → table at L~264-289 of `{ ns, key, field, min, max }` rows, each registered under **both** forms (bare and full-dotted), e.g. `{ ns: 'marketdata', key: 'quotes.mark_timeout_ms', field: 'intVal', min: 100, max: 2500 }` + `{ ns: 'marketdata', key: 'marketdata.quotes.mark_timeout_ms', … }`. The loop (L~291-312) asserts every value at `min`/`max` reaches the INSERT and `min-1`/`max+1` is `INVALID_ARGUMENT` with `/\[min, max\]/` and no INSERT.
- Lower-edge-0 acceptance precedent: `it('accepts a bounded key whose lower edge is a legitimate 0 — AC-8', …)` uses `setConfig({ intVal: 0 }, OPP_REFRESH)` and passes today (an `intVal: 0` write reaches the INSERT).
- Offline migration-file test precedent: `services/xstockstrat-config/src/__tests__/retiredPortfolioSnapshotInterval.test.ts` — reads `join(__dirname, '..', '..', 'migrations')` (compiled into `dist/__tests__/`), splits statements on `;`, normalises, asserts structure. No DB is started.

**TDD**: `red-green required`

**Covers**: `AC-11` (the `SetConfig` rejects-outside-0..86400000 half; the seed row shape)

**Instructions**:
1. In `setConfigScalarBounds.test.ts`, append two rows to `TIMEOUT_KEY_FORMS` (after the `portfolio.marketdata.last_close_lookback_days` pair):
   `{ ns: 'marketdata', key: 'stream.bar_ingest_backoff_ms', field: 'intVal', min: 0, max: 86400000 }` and `{ ns: 'marketdata', key: 'marketdata.stream.bar_ingest_backoff_ms', field: 'intVal', min: 0, max: 86400000 }`. The existing loop supplies: 0 and 86400000 accepted, -1 and 86400001 rejected with `[0, 86400000]`. Update the comment above the table to mention feature 291.
2. Create `barIngestBackoffSeedMigration.test.ts` modelled on `retiredPortfolioSnapshotInterval.test.ts`: load `035_marketdata_bar_ingest_backoff.up.sql`/`.down.sql` and assert (a) the up statement inserts into `config.config_values` exactly the full-dotted key `'marketdata.stream.bar_ingest_backoff_ms'` (not the bare form), `'int'`, `'21600000'` for both `'staging'` and `'production'` with `user_id` `NULL`; (b) it ends `on conflict (namespace, key, environment, coalesce(user_id, '')) do nothing` (no overwrite); (c) the down deletes that key in namespace `marketdata`. Inline helpers copy-adapted from the precedent are single-consumer; do not centralise (C-13: a second consumer does not yet exist).
3. RED expectation: the registry rows fail with "expected INVALID_ARGUMENT" for `-1`/`86400001` until Step 2 adds the bounds entry — that is the RED half. The migration-shape test is a **green-on-arrival guard**: Step 1 executes before Step 3 so the file already exists (Step 1 is TDD N/A; its shape is proven by this test). To make it RED, run it before Step 1 and record the missing-file failure.

**Verification**:
```
cd /home/user/xstockstrat/services/xstockstrat-config && pnpm run lint && pnpm run test:coverage && pnpm exec c8 check-coverage --lines 40
```

---

### Step 4 — service: snapshot-built `Watcher` seam for marketdata

**Status**: `pending`
**Service**: `xstockstrat-marketdata`
**Files**:
- `services/xstockstrat-marketdata/internal/config/config.go` — modify

**Reviewers**: xstockstrat-marketdata owner — OHLCV ingestion integrity, TimescaleDB hypertable partitioning, Alpaca feed idempotency

**Codebase Evidence**:
- Confirmed via: `grep -n "snapshot\|ready\|once" services/xstockstrat-marketdata/internal/config/config.go` → `Watcher` struct has unexported `mu sync.RWMutex`, `snapshot map[string]*configv1.ConfigValue`, `ready chan struct{}`, `once sync.Once`; `GetInt` reads `w.snapshot[key]` under `RLock` and type-asserts `*configv1.ConfigValue_IntVal`. The only existing constructor is `NewWatcher(endpoint, namespace, applicationEnv, tradingMode string)` (dials gRPC through `mtls.ClientConfig`, unusable in unit tests).
- Existing pattern to mirror verbatim: `services/xstockstrat-trading/internal/config/config.go:249` — `func NewSnapshotWatcher(snapshot map[string]*configv1.ConfigValue) *Watcher { ready := make(chan struct{}); close(ready); return &Watcher{snapshot: snapshot, ready: ready} }`, documented as the only way an external-package test can inject a config state.
- Marketdata's own unexported test helper `newTestWatcher` (`internal/config/config_test.go:132`) builds the same struct but is `_test.go`-only, so `internal/service` tests cannot call it.

**TDD**: `red-green required`

**Covers**: —

**Instructions**:
1. Add `NewSnapshotWatcher(snapshot map[string]*configv1.ConfigValue) *Watcher` to `config.go` directly after `NewWatcher`, same body as trading's. Doc comment (≤2 lines, constraint not mechanism): test seam only — keys must be the full-dotted form the config server streams; no network I/O.
2. Do not change `newTestWatcher` or any production call site.

**Verification**:
```
cd /home/user/xstockstrat/services/xstockstrat-marketdata && GOWORK=off golangci-lint run --modules-download-mode=mod && GOWORK=off go build ./...
```

---

### Step 5 — test: `NewSnapshotWatcher` serves the stored int

**Status**: `pending`
**Service**: `xstockstrat-marketdata`
**Files**:
- `services/xstockstrat-marketdata/internal/config/config_test.go` — modify

**Reviewers**: xstockstrat-marketdata owner — OHLCV ingestion integrity, TimescaleDB hypertable partitioning, Alpaca feed idempotency

**Codebase Evidence**:
- Confirmed via: `grep -n "^func Test" services/xstockstrat-marketdata/internal/config/config_test.go` → `TestWatcher_GetInt` at L160 (uses `newTestWatcher`), `TestWatcher_WaitForSnapshot_AlreadyReady` at L214.
- `internal/config` is **not** an excluded package in the CI coverage filter (`.github/workflows/ci.yml:298` excludes `cmd|handler|repository|telemetry|service`), so this test counts toward the 40% threshold.

**TDD**: `red-green required`

**Covers**: `AC-11` (supporting: the seam the reader test uses)

**Instructions**:
1. Add `TestNewSnapshotWatcher_ServesSnapshotAndIsReady`: build `NewSnapshotWatcher(map[string]*configv1.ConfigValue{"marketdata.stream.bar_ingest_backoff_ms": {Value: &configv1.ConfigValue_IntVal{IntVal: 0}}})`; assert `GetInt(key, 7)` returns `0` (a stored zero is honoured, not replaced by the default — the kill-switch precondition), `GetInt("absent", 7)` returns `7`, and `WaitForSnapshot` with a 1 s context returns nil (ready closed). Inline in this file next to `TestWatcher_GetInt`.
2. RED: before Step 4 the file does not compile (`undefined: NewSnapshotWatcher`).

**Verification**:
```
cd /home/user/xstockstrat/services/xstockstrat-marketdata && GOWORK=off go test ./internal/config/ -race -count=1 -run TestNewSnapshotWatcher   # RED before Step 4 (compile failure: NewSnapshotWatcher undefined), green after
cd /home/user/xstockstrat/services/xstockstrat-marketdata && GOWORK=off golangci-lint run --modules-download-mode=mod && COVERPKGS=$(GOWORK=off go list ./... | grep -Ev '/(cmd|handler|repository|telemetry|service)(/|$)' | tr '\n' ',' | sed 's/,$//') && GOWORK=off go test ./... -race -count=1 -coverprofile=coverage.out -covermode=atomic -coverpkg="${COVERPKGS}" && GOWORK=off go tool cover -func=coverage.out | grep "^total:"
# confirm total >= 40%
```

---

### Step 6 — service: per-symbol hold state in the bar ingester

**Status**: `pending`
**Service**: `xstockstrat-marketdata`
**Files**:
- `services/xstockstrat-marketdata/internal/service/bar_hold.go` — create
- `services/xstockstrat-marketdata/internal/service/marketdata_service.go` — modify

**Reviewers**: xstockstrat-marketdata owner — OHLCV ingestion integrity, TimescaleDB hypertable partitioning, Alpaca feed idempotency

**Codebase Evidence** (all confirmed by Read on the working tree, line numbers current):
- Service struct: `warmMu sync.Mutex` / `warmSymbols map[string]struct{}` at `marketdata_service.go:50-51`; `lastStaleCheck map[string]time.Time` at `:56` (closest per-key-state precedent, keyed `symbol|tf`); `budgetCfg intGetter` at `:103` (nil-safe live int seam, set to the real `*config.Watcher` at `:233`); `barsStore barsBatchStore` at `:110`, wired `svc.barsStore = repo` at `:238` when `repo != nil`; `barsBatchStore` already declares `InsertBars(ctx, []*marketdatav1.Bar) error` at `:127-130`. Test literals `&MarketDataService{}` leave all of these nil → **new state must be lazily created**.
- Ingester: `ingestRecentBarsForTimeframe(ctx, src, symbols, tf, start, end)` at `:1289`; multi path `:1292-1312` (`ms.GetBarsMulti(ctx, symbols, tf, start, end)`; absent key and empty slice both count as missing; inserts `s.repo.InsertBars` at `:1304`); on multi error WARN then per-symbol path `:1314-1328` (`src.GetBars`; fetch error → WARN `bar ingest: live fetch failed` + `continue`, **not** counted missing; `len(bars)==0` → missing; insert `s.repo.InsertBars` at `:1325`); both end in `reportIngestCycle(ctx, tf, missing, len(symbols), start, end, began)` (`:1337`, free function; INFO `bar ingest: cycle complete` with `timeframe, symbols, no_bars, elapsed_ms`, then WARN `bar ingest: symbols returned no bars` with `timeframe, missing, total, sample, window_start, window_end`, sample capped by `barIngestNoBarsSample = 10` at `:1333`). `ingestRecentBars` (`:1262`) computes `end := time.Now().UTC()` (`:1277`) and passes the same `symbols` snapshot to every timeframe.
- The only callers of `ingestRecentBarsForTimeframe`/`reportIngestCycle` are `ingestRecentBars` and three test call sites (`marketdata_service_test.go:1171, 1191, 1219`); `reportIngestCycle` has no other caller (grep).
- Resolver precedent: `resolvePositiveInt` (`:986-994`) maps `<= 0` to the default — **unusable here** (would defeat the kill switch); siblings `resolveQuoteRetentionDays` (`:1023`, "never clamped here") and `resolveBatchPriceBudget` (`:998`) wrap it. The new reader is a custom one with the documented asymmetry.
- New-file-in-package precedent: `internal/service/etf_flags.go` (+ `etf_flags_test.go`) — keeps `marketdata_service.go` edits small (merge-order row 93).
- Lock discipline: `warmMu` guards `warmSymbols` (`markWarm` `:1089-1096`, `warmSnapshot` `:1100-1108`); nothing holds it across a vendor call. Eviction from the warm set is impossible (`GetBars` re-warms on every call, `:263`) and `markWarm` must not consult the hold state (it would starve the quote path, 282 AC-16/17/26).
- Not found: any existing negative cache / back-off in the ingester — created from scratch; `reportIngestCycle` has no state today.

**TDD**: `red-green required`

**Covers**: —

**Instructions**:

*A. `bar_hold.go` (create).* Constants `barIngestBackoffKey = "marketdata.stream.bar_ingest_backoff_ms"` and `defaultBarIngestBackoffMs = 21600000`, declared as **plain string-literal `const`s** and the identifier passed directly to `cfg.GetInt(...)` — no forwarder, no concatenation: `scripts/check-config-wiring.mjs` `goConsts` resolves only `const name [string] = "literal"` (same file, then package, then service), otherwise the read becomes a keyless `dynamic-read` finding that gates. (`marketdata_service.go` already uses `resolvePositiveInt` as a registered forwarder in `config-wiring.json`; the new reader deliberately does not.) Small unexported types keep the cycle functions readable: `barPlan{requested []string; probes map[string]bool}`, `barOutcome{got, errored map[string]bool}`, `barCycleResult{missing, newlyHeld, recovered []string; active, held int}`.
1. `type barHoldEntry struct{ emptySince, lastEmpty, nextProbe time.Time }`; `nextProbe.IsZero()` ⇔ streak not yet held.
2. `resolveBarIngestBackoff(cfg intGetter) time.Duration`: nil cfg → default 6 h; else `v := cfg.GetInt(barIngestBackoffKey, defaultBarIngestBackoffMs)`; `v <= 0` → `0` (disabled); never clamped (bounds are the `SetConfig` registry's job, Step 2). Comment: not `resolvePositiveInt` because `<= 0` here means *disabled*, not *default*.
3. Plan (called with `D` already read, before taking `warmMu`): `(s *MarketDataService) planBarRequest(symbols []string, tf string, end time.Time, d time.Duration) barPlan`. `d <= 0` → `s.warmMu.Lock(); s.barHold = nil; unlock` and return `barPlan{requested: symbols}` (every symbol requested, nil probes, no state kept — MARKETDATA-5 kill switch). Else under `warmMu`: reconcile — delete `(sym, tf)` entries for symbols not in `symbols` (drop an empty inner map); then request every symbol that has no held entry, plus held symbols with `!end.Before(nextProbe)` (these go in `probes`). Held symbols not due are omitted.
4. Update: `(s *MarketDataService) applyBarCycle(tf string, symbols []string, plan barPlan, out barOutcome, start, end time.Time, d time.Duration) barCycleResult` (callers read the result's fields; `reportIngestCycle` takes the `barCycleResult` instead of seven positional arguments). Under `warmMu`, lazily `make` `s.barHold` and the inner map:
   - `active` = requested, non-probe, non-errored symbols; `hits` = active symbols in `got`; `informative := hits*2 > len(active)` (strict majority; exactly half is **not** informative; an empty `active` is not informative).
   - Probes (any cycle, informative or not): in `got` → delete entry, add to `recovered`; not in `got` and not in `errored` → `nextProbe = end.Add(d)` (fixed period, never doubled); `errored` → untouched (retried next cycle).
   - Non-informative cycle: delete **every** non-held entry for `tf` (a streak needs uninterrupted evidence); `missing` still lists the active symbols without bars.
   - Informative cycle, per active symbol: in `got` → delete entry; else if no entry or `end.Sub(e.lastEmpty) > end.Sub(start)` (streak-continuity gap = the actual window width) → new entry `{emptySince: end, lastEmpty: end}`, otherwise `lastEmpty = end`; then if `end.Sub(e.emptySince) >= d` → `e.nextProbe = end.Add(d)` and add to `newlyHeld`. Add every active symbol without bars to `missing`.
   - Errored symbols never create, advance or reset an entry in an informative cycle.
   - `held` = count of `symbols` with a held entry after the update. Return `missing`, `newlyHeld`, `recovered` sorted.
5. Field comment (≤2 lines) on the struct field: guarded by `warmMu`, never held across a vendor call.

*B. `marketdata_service.go` (modify, three edit sites only).*
6. Add next to `warmSymbols` (`:50-51`): `barHold map[string]map[string]*barHoldEntry // symbol → tf; guarded by warmMu, never held across a vendor call`. Do **not** initialise it in `NewMarketDataService` (`:221-222` area) — lazily created, so zero-value literals stay safe. Do not touch `markWarm`/`warmSnapshot`.
7. Rewrite the body of `ingestRecentBarsForTimeframe` (`:1289-1330`): `d := resolveBarIngestBackoff(s.budgetCfg)` first (before any `warmMu`), then `plan := s.planBarRequest(symbols, tf, end, d)`. Fetch **outside** the lock using `plan.requested` only: if `len(plan.requested) == 0` skip the vendor call entirely; multi path as today (`got` = symbols whose slice is non-empty); per-symbol path as today but record `out.errored[sym]` on a fetch error (still WARN + continue) and `out.got[sym]` on bars (building `out := barOutcome{got, errored}`); then `res := s.applyBarCycle(tf, symbols, plan, out, start, end, d)` and `reportIngestCycle(ctx, tf, res, len(symbols), d, start, end, began)`. Replace both `s.repo.InsertBars` (`:1304`, `:1325`) with `s.barsStore.InsertBars` (production wires `barsStore = repo`); one-line field-comment on `barsStore` that the ingester requires it non-nil when bars are returned — **no nil guard** (a nil store must panic, never silently drop bars). Leave `fetchAndCacheBars`' `s.repo.InsertBars` (`:370`) and `:1426` untouched. Then `applyBarCycle(...)` and `reportIngestCycle(...)`.
8. Change `reportIngestCycle` (`:1337`) to the single signature `reportIngestCycle(ctx context.Context, tf string, res barCycleResult, symbolsTotal int, probeEvery time.Duration, start, end, began time.Time)` — `res` already carries `missing`, `newlyHeld`, `recovered`, `active` and `held`, so none of those is a separate parameter: INFO heartbeat `bar ingest: cycle complete` **every** cycle (also with an empty request list) with `symbols = symbolsTotal` (the full argument count, so `:1156/:1204` stay green), `no_bars = len(res.missing)`, new `held = res.held`; WARN `bar ingest: symbols returned no bars` keeps its message and attrs with `total = res.active` (was `len(symbols)`; held symbols never appear; empty probes are not re-reported); new once-per-transition lines, sample capped by `barIngestNoBarsSample`: WARN `bar ingest: holding symbols that returned no bars` (`timeframe, held (count newly held), sample, probe_every_ms`) and INFO `bar ingest: held symbols returned bars` (`timeframe, recovered, sample`).
9. Trading-domain constraints (§A): not trading-domain-relevant (no order, broker, fill or `TRADING_MODE` path).

**Verification**:
```
cd /home/user/xstockstrat/services/xstockstrat-marketdata && GOWORK=off golangci-lint run --modules-download-mode=mod && GOWORK=off go build ./... && GOWORK=off go vet ./internal/service/ && GOWORK=off go test ./internal/service/ -race -count=1 -run 'TestIngestRecentBars'   # existing tests must stay green unchanged; the new TestBarHold*/TestResolveBarIngestBackoff exist only after Step 7 (run first there)
cd /home/user/xstockstrat && node scripts/check-config-wiring.mjs --keys marketdata.stream.bar_ingest_backoff_ms
# expected: no output, exit 0 (seeded by 035 and read under the identical full-dotted string; no baseline entry is needed or allowed)
grep -n "barsStore.InsertBars" services/xstockstrat-marketdata/internal/service/marketdata_service.go   # expect 3 matches: the two ingester inserts plus the pre-existing BatchGetBars call
```

---

### Step 7 — test: RED tests for the hold (positive controls on every "no hold")

**Status**: `pending`
**Service**: `xstockstrat-marketdata`
**Files**:
- `services/xstockstrat-marketdata/internal/service/bar_hold_test.go` — create

**Reviewers**: xstockstrat-marketdata owner — OHLCV ingestion integrity, TimescaleDB hypertable partitioning, Alpaca feed idempotency

**Codebase Evidence**:
- Reusable fakes already in the package (shared by `_test.go` files): `fakeCfg{ints, bools, strings}` with `GetInt` (`marketdata_service_test.go:281-298`, satisfies `intGetter`); `fakeBatchBarsSource` (`:1603`, `GetBarsMulti` returns only seeded symbols, absent otherwise; per-symbol `GetBars` returns `nil, nil`); `fakeBackfillSource` (`:900`); `installWarnRecorder(t)` / `installLogRecorder(t, level)` (`:1907-1918`) with `find(msg)` and `count(msg)`; `fakeIntGetter` (`:1925`); `fakeBarsStore` (`:4060`) — its `InsertBars` is a **no-op**, so it cannot prove "bars stored" (design.md § RED tests).
- Existing tests that must stay green **unchanged**: `TestIngestRecentBars_WarnsOncePerCycleForSymbolsWithoutBars` (`:1156`) and `TestIngestRecentBars_LogsHeartbeatEveryCycle` (`:1204`) — they build `&MarketDataService{}` (nil `budgetCfg` → default 6 h, a single all-empty cycle is non-informative so nothing holds).
- `slog.SetDefault` is process-global: tests using the recorders must not call `t.Parallel()` (comment at `:1852`).
- C-13: the new fakes (`recordingBarsSource`, `recordingBarsStore`) have exactly **one** consumer (this file) → inline is compliant; no `internal/testdata/` home is created. Verify `grep -rn "recordingBarsSource\|recordingBarsStore" --include="*_test.go" services/xstockstrat-marketdata` shows one declaration site each.
- Not found: any test running `ingestRecentBars` end-to-end or the poller loops — tests drive `ingestRecentBarsForTimeframe` directly with a fixed `end` (as `:1171` does).

**TDD**: `red-green required`

**Covers**: `AC-1, AC-2, AC-3, AC-4, AC-5, AC-6, AC-7, AC-8, AC-9, AC-10, AC-11, AC-12, AC-13, AC-14`

**Instructions**: Create `bar_hold_test.go` (package `service`). Fixtures: `end0 = 2026-11-04 15:00 UTC` (a Wednesday session); cycle `k` runs at `end0 + k*5m` with window `[end-48h, end]`; service `&MarketDataService{budgetCfg: &fakeCfg{ints: {"marketdata.stream.bar_ingest_backoff_ms": 3600000}}, barsStore: &recordingBarsStore{}}` (D = 1 h = 12 cycles). Inline fakes: `recordingBarsSource` embeds `*fakeBatchBarsSource`, adds `requested [][]string`, `multiErr error` (forces the per-symbol path), `errs map[string]error`, and a per-symbol `GetBars` that returns the seeded bars; `recordingBarsStore` records inserted bars (implements `barsBatchStore`). Helper `runCycles(s, src, symbols, from, n)`. Symbols: `LIVE1..3` (return bars) and `DEAD` (never). **Every "no hold" test carries a positive control in the same test** (the same setup with an informative cycle must hold `DEAD`), so a never-holds implementation cannot pass. Tests:
1. `TestBarHold_HoldsAfterWallClockSpan` — `DEAD` is in every request for cycles 0..12, absent 13..23, requested again at cycle 24 (probe at hold time + 1 h); an empty probe reschedules exactly `end + D` and the gap stays 1 h on the next period (no doubling). **@AC-1, @AC-9**
2. `TestBarHold_ReportsOnce` — over 40 cycles exactly one `bar ingest: holding symbols that returned no bars` WARN naming `DEAD`, the `bar ingest: symbols returned no bars` WARN no longer names `DEAD` after the hold, and the INFO heartbeat is logged every cycle with `symbols` = argument count and `held` = 1 once held. **@AC-1**
3. `TestBarHold_RecoveryClearsAndStoresBars` — held `DEAD` whose probe returns bars: the recording store holds those bars, exactly one `bar ingest: held symbols returned bars` INFO, `DEAD` is requested in the next cycle. **@AC-4**
4. `TestBarHold_WholeEmptyCyclesNeutral` — every symbol empty (weekend) for hours → no hold; positive control with a live majority holds `DEAD`; a held `DEAD` probed in a whole-empty cycle stays held with `nextProbe == end + D` (read `s.barHold` under `warmMu`). **@AC-2, @AC-9**
5. `TestBarHold_PartialOutageNeverHolds` — four symbols, ≤ half return bars for hours → no hold; positive control (3 of 4 return) holds; the exactly-half case (2 of 4) is non-informative. **@AC-3**
6. `TestBarHold_FetchErrorsNotCounted` — `multiErr` forces the per-symbol path; a symbol whose fetch errors for hours is never held and creates no entry (positive control: the same symbol empty-not-errored gets held); a held probe that errors is retried the next cycle and stays held. **@AC-5**
7. `TestBarHold_ZeroValueServiceReachesHoldAndRecovery` — `&MarketDataService{}` (nil `budgetCfg`, default 6 h, nil maps, store set) run **at least 150 cycles** with a live peer reaches hold (with the 6 h default, hold at cycle 72) and then recovery (first probe at cycle 144). A shorter run never reaches recovery and would pass vacuously. Guards lazy init. **@AC-1, @AC-4**
8. `TestBarHold_HeldSymbolStaysWarm` — characterization (labelled, not RED): a held symbol is still in `warmSnapshot()` and `markWarm` is unchanged; no `GetBars`/`BatchGetBars` code is touched (existing `@AC-3 @feature-191` / `@AC-53 @feature-240` tests stay green unchanged — the response contracts are guarded by those suites, not re-asserted here). **@AC-6**
9. `TestBarHold_EntryDroppedWhenSymbolLeavesList` — held `DEAD` absent from the `symbols` argument for one cycle loses its entry; re-adding it is requested the next cycle. **@AC-7**
10. `TestBarHold_DisabledAndLoneSymbol` — key `0` (and `-5`): every symbol requested every cycle and `s.barHold` is nil/empty; a warm set containing only `DEAD` is requested every cycle and never held. **@AC-8, @AC-10**
11. `TestBarHold_PositiveFeedbackLiftsRatio` — once `DEAD` is held it leaves `active`, lifting the informative ratio for the remaining symbols (documents the accepted behaviour). **@AC-1**
12. `TestResolveBarIngestBackoff` — table: nil cfg → 6 h; stored `0` → 0 (disabled); negative → 0; stored `1800000` → 30 m (via `fakeCfg`). **Snapshot-built reader test (@AC-11):** `config.NewSnapshotWatcher` over `map[string]*configv1.ConfigValue{"marketdata.stream.bar_ingest_backoff_ms": {Value: &configv1.ConfigValue_IntVal{IntVal: 1800000}}}` → `resolveBarIngestBackoff(w) == 30*time.Minute`, and a stored `0` → `0` through the real `Watcher` (`fakeCfg` alone does not satisfy this). **@AC-11**
13. `TestBarHold_ProbesOnlyRequestKeepsHold` — a held `DEAD` whose due probe is the ONLY requested symbol (the symbol list passed to the ingester contains only `DEAD` — reachable only by a direct call or a future warm-set prune, since the warm set is add-only today): the cycle is non-informative, creates no entry and does not wipe the held symbol; an empty probe reschedules `nextProbe = end + D`. Positive control: the same setup with live peers present behaves per `AC-9`. **@AC-12**
14. `TestBarHold_NonInformativeCycleResetsStreak` — `DEAD` empty in informative cycles 0-7, cycle 8 is whole-empty (every symbol returns none), `DEAD` empty again in cycles 9-22 with live peers returning bars: `DEAD` is NOT held at cycle 12 (the non-informative cycle discarded the in-progress streak), the new streak starts at cycle 9 and `DEAD` is first held at cycle 21 (absent from cycle 22). Positive control: without cycle 8 it is held at cycle 12. **@AC-13**
15. `TestBarHold_StreakGapRestartsStreak` — `DEAD` empty in informative cycles 0-5, then no cycle runs for 49 h (window width 48 h), then cycles resume: the stale `emptySince` is NOT used — `DEAD` is held only 12 cycles after the resume, not immediately. Positive control: a 30 h pause (< window width) continues the streak, so `DEAD` is held at the first resumed cycle. **@AC-14**

RED expectation (an unnumbered note, not a test): before Step 6, `ingestRecentBarsForTimeframe` requests every symbol every cycle, so tests 1-6, 9, 13, 14 and 15 fail by assertion and `resolveBarIngestBackoff` is undefined (compile failure).

Note: `internal/service` is an **excluded** package in the CI coverage filter (`ci.yml:298`), so this step adds no measured coverage; the threshold is still verified so nothing regresses ("New logic is in an excluded package — no coverage threshold applies; integration test verification is sufficient").

**Verification**:
```
cd /home/user/xstockstrat/services/xstockstrat-marketdata && GOWORK=off go test ./internal/service/ -race -count=1 -run 'TestBarHold|TestResolveBarIngestBackoff|TestIngestRecentBars'   # first: record RED before Step 6, then green after
cd /home/user/xstockstrat/services/xstockstrat-marketdata && GOWORK=off golangci-lint run --modules-download-mode=mod && COVERPKGS=$(GOWORK=off go list ./... | grep -Ev '/(cmd|handler|repository|telemetry|service)(/|$)' | tr '\n' ',' | sed 's/,$//') && GOWORK=off go test ./... -race -count=1 -coverprofile=coverage.out -covermode=atomic -coverpkg="${COVERPKGS}" && GOWORK=off go tool cover -func=coverage.out | grep "^total:"
# confirm total >= 40%; TestIngestRecentBars_* pass unchanged
grep -rn "recordingBarsSource\|recordingBarsStore" --include="*_test.go" services/xstockstrat-marketdata   # one declaration site each (C-13)
```

---

### Step 8 — docs: marketdata CLAUDE.md, config-governance log, module invariant

**Status**: `pending`
**Service**: `docs`
**Files**:
- `services/xstockstrat-marketdata/CLAUDE.md` — modify
- `docs/patterns/config-governance.md` — modify
- `services/xstockstrat-marketdata/docs/context-constitution.md` — modify

**Reviewers**: none

**Codebase Evidence**:
- Confirmed via: `grep -n "bar_ingest" services/xstockstrat-marketdata/CLAUDE.md` → config rows at L69-71 (`bar_ingest_interval_ms`, `bar_ingest_timeframe`, `bar_ingest_lookback_ms`) inside `## Config Keys Consumed` (L48); ingester bullet `StartBarIngestPoller is an **always-on** bar ingester…` at L227.
- `docs/patterns/config-governance.md`: `## Per-Feature Registered Keys` at L140 ("Append-only log … Newest first"); newest entry is `### feature 249 …` at L146, then 264 and 248 — insert the new entry above 249. Entry schema example: feature 248 (`Key | Type | Default | Bounds | Notes` table + a one-line "Seeded … by config migration `033_…`").
- `services/xstockstrat-marketdata/docs/context-constitution.md:21` — row **MARKETDATA-5** ("Pollers re-read their interval from config every tick and treat `<=0` as pause").
- Root `CLAUDE.md` § Teardown: this step changes a `CLAUDE.md` and a constitution doc, so `/context-forge:context-constitution refresh` scoped to these files is the last step before pushing; if the plugin is unavailable, re-read each touched file against the final code and record **both** the unavailability and the manual reconciliation in the PR body.

**TDD**: `N/A (docs-only)`

**Covers**: —

**Instructions**:
1. `services/xstockstrat-marketdata/CLAUDE.md`: add a `marketdata.stream.bar_ingest_backoff_ms` row after L71 — int, `21600000`, seeded by config migration `035`, `SetConfig` bounds `[0, 86400000]`, `<= 0` disables the hold and clears state, read live each cycle; and state the **asymmetry**: unlike `resolvePositiveInt`, a `<= 0` here means *off*, not *default*. Extend the L227 ingester bullet (≤ 3 sentences): a warm symbol that returns no bars across informative cycles for the back-off period is left out of the vendor request except one probe per period; the warm set, quote/price paths and `GetBars`/`BatchGetBars` are untouched; the existing no-bars WARN's `missing`/`total` are now over non-held symbols. Record the two **operator-approved fixed invariants** (not config values): the strict-majority informative-cycle rule (`hits*2 > active`) and the streak-continuity gap = the cycle's window width. State the honest value (zero vendor calls saved on the multi-symbol path; calls saved only on the per-symbol fallback) and the freshness trade-off (a false-positive hold lags the stored daily bar up to the key's value).
2. `docs/patterns/config-governance.md`: insert `### feature 291 — fix-marketdata-dead-symbol-ingest (xstockstrat-marketdata / xstockstrat-config)` above the feature 249 entry: one key, **seeded** (staging + production) by migration `035_marketdata_bar_ingest_backoff`, stored `int`, `SCALAR_BOUNDS_REGISTRY` `[0, 86400000]`, `<= 0` = disabled, and the note that no `scripts/config-wiring.json` entry exists because seed and reader agree.
3. `services/xstockstrat-marketdata/docs/context-constitution.md`: add a short note to **MARKETDATA-5** that `marketdata.stream.bar_ingest_backoff_ms` is a deliberate exception to "`<= 0` pauses, keep last": `<= 0` disables the hold (every symbol requested every cycle), and it is read live per cycle before `warmMu` is taken.
4. Run the teardown (`/context-forge:context-constitution refresh`, scoped to the three files) and fix grounded drift; PR body carries the CHANGELOG-style note and the teardown result.

**Verification**:
```
cd /home/user/xstockstrat && grep -n "bar_ingest_backoff_ms" services/xstockstrat-marketdata/CLAUDE.md docs/patterns/config-governance.md services/xstockstrat-marketdata/docs/context-constitution.md
node scripts/check-config-wiring.mjs --final   # exit 0: no new finding, no STALE baseline entry
```

---

## Deviation Log

_Populated by /sdd-execute as implementation proceeds._
