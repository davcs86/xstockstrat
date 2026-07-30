# Implementation Spec: fix-fmp-config-boot-only

**Status**: `in-progress`
**Created**: 2026-07-30
**Feature**: `docs/roadmap/features/082-fix-fmp-config-boot-only/feature.md`
**Total Steps**: 4
**Feature Branch**: `feature/fix-fmp-config-boot-only`

---

## Execution Summary

Step 1 extracts the FMP-client construction in `cmd/server/main.go` into an unconditionally-called
function (`newFundamentalsSource`), removing the boot-time `marketdata.fmp.enabled` gate, and
re-documents the now-defensive-only nil-guard comment in `marketdata_service.go` — no functional
change to `fundamentalsEnabled()`, which was already live-correct. Step 2 is the paired test proof,
composed of three parts per `design.md` § Chosen Approach point 5: a canary proving the extracted
function is always non-nil, a new live-toggle test proving the existing live gate reacts to a
config flip with no restart, and an updated comment on the pre-existing nil-source test recording
that it is now defensive-only. Step 3 corrects the two doc surfaces (`CLAUDE.md` config-key table +
`docs/context-constitution.md` invariant row) that currently describe the boot-time gate, so both
match shipped behavior in the same PR (Constitution **C-10**).

## Step Dependencies

- Step 2 [test] pairs Step 1 [service] — both carry `**TDD**: red-green required`; `/sdd-execute`
  must capture the canary + toggle tests failing (compile error / assertion failure) against the
  pre-Step-1 tree, then passing after.
- Step 3 [docs] has no code dependency on Steps 1–2 but is sequenced last so its prose accurately
  describes the shipped behavior rather than the pre-fix one.
- Per root `CLAUDE.md` § Teardown: this feature changes `services/xstockstrat-marketdata/CLAUDE.md`
  and `services/xstockstrat-marketdata/docs/context-constitution.md` (a context file + a
  constitution doc) in Step 3 — run `/context-scrubber scan` scoped to `xstockstrat-marketdata`
  as the last step before pushing the Step 3 PR, per Step 3's Verification.

---

### Step 1 — service: xstockstrat-marketdata: always construct the FMP fundamentals client at boot

**Status**: `done`
**Service**: `xstockstrat-marketdata`
**Files**:
- `services/xstockstrat-marketdata/cmd/server/main.go` — modify
- `services/xstockstrat-marketdata/internal/service/marketdata_service.go` — modify (comment only,
  no behavior change)

**Reviewers**: Service owner (xstockstrat-marketdata) — per `docs/runbooks/reviewer-registry.md`:
"OHLCV ingestion integrity, TimescaleDB hypertable partitioning, Alpaca feed idempotency"; this fix
specifically per `feature.md` § Reviewers: "FMP client wiring, config watcher usage, no
look-ahead/hot-path regression"

**Codebase Evidence**:
- Confirmed via Read `services/xstockstrat-marketdata/cmd/server/main.go:104-123`: the boot-only
  gate —
  ```go
  var fundamentalsSrc source.FundamentalsSource
  if cfgWatcher.GetBool("marketdata.fmp.enabled", false) {
      fundamentalsSrc = fmp.NewClient(fmp.ClientConfig{
          BaseURL: cfgWatcher.GetString("marketdata.fmp.base_url", "https://financialmodelingprep.com"),
          APIKey:  cfg.FMPAPIKey,
          Metrics: strings.Split(cfgWatcher.GetString("marketdata.fmp.metrics", "core,extended"), ","),
      })
      slog.Info("FMP fundamentals source enabled")
  }
  svc, err := service.NewMarketDataService(reg, repo, cfgWatcher, cfg.LedgerEndpoint, cfg.NotifyEndpoint, fundamentalsSrc)
  ```
- Confirmed via Read `services/xstockstrat-marketdata/cmd/server/main.go:173-184`: the existing
  established pattern for a boot-helper pulled into an unexported, unit-testable function —
  `func looksLikePlaceholderCred(v string) bool { ... }`, tested by
  `TestLooksLikePlaceholderCred` in `cmd/server/main_test.go:5-27`.
- Confirmed via Read `services/xstockstrat-marketdata/internal/service/marketdata_service.go:957-964`:
  `fundamentalsEnabled()` already reads `s.fundCfg.GetBool("marketdata.fmp.enabled", false)` live on
  every call — this method is **not** modified by this step.
- Confirmed via Read `services/xstockstrat-marketdata/internal/fmp/fmp_client.go:41-58`: `NewClient`
  builds a stateless struct (a plain `*http.Client`, no rate limiter, no persistent connection) — safe
  to always construct at boot.
- Confirmed via Read `services/xstockstrat-marketdata/internal/config/config.go:100-153`: `Watcher`'s
  `GetString`/`GetBool` touch only `w.mu` (a `sync.RWMutex`, safe zero-value) and `w.snapshot` (nil-map
  read returns `ok=false`, falls through to the default) — relevant to Step 2's canary test, not this
  step, but confirms the extraction introduces no new nil-map risk.

**TDD**: `red-green required`

**Instructions**:
1. In `services/xstockstrat-marketdata/cmd/server/main.go`, replace the `var fundamentalsSrc
   source.FundamentalsSource` + `if cfgWatcher.GetBool("marketdata.fmp.enabled", false) { ... }`
   block (lines 107–121) with a single unconditional call:
   ```go
   // FMP fundamentals source (feature 059) — always constructed; per-RPC enablement is
   // enforced live by fundamentalsEnabled() (marketdata_service.go:960), not at boot
   // (feature 082 fix — see CLAUDE.md marketdata.fmp.enabled).
   fundamentalsSrc := newFundamentalsSource(cfgWatcher, cfg.FMPAPIKey)
   ```
   The call site at line 123 (`svc, err := service.NewMarketDataService(reg, repo, cfgWatcher,
   cfg.LedgerEndpoint, cfg.NotifyEndpoint, fundamentalsSrc)`) is unchanged — `fundamentalsSrc` is
   now always non-nil.
2. Add the new unexported function to the same file, next to `looksLikePlaceholderCred`
   (after line 184, following that function's established extraction pattern):
   ```go
   // newFundamentalsSource constructs the FMP fundamentals client (feature 059). It is
   // always built, unconditionally — marketdata.fmp.enabled is a live per-RPC gate read
   // fresh on every call by fundamentalsEnabled() (internal/service/marketdata_service.go:960),
   // not a boot-time construction gate (feature 082 fix). apiKey is the FMP_API_KEY secret
   // env var, never a config value (see internal/config/config.go).
   func newFundamentalsSource(cfgWatcher *config.Watcher, apiKey string) source.FundamentalsSource {
       baseURL := cfgWatcher.GetString("marketdata.fmp.base_url", "https://financialmodelingprep.com")
       metrics := strings.Split(cfgWatcher.GetString("marketdata.fmp.metrics", "core,extended"), ",")
       slog.Info("FMP fundamentals client constructed", "base_url", baseURL, "metrics", metrics)
       return fmp.NewClient(fmp.ClientConfig{
           BaseURL: baseURL,
           APIKey:  apiKey,
           Metrics: metrics,
       })
   }
   ```
   This drops the `GetBool("marketdata.fmp.enabled", ...)` read entirely — there is no `enabled`
   parameter, so there is structurally no gate left to bypass at construction time.
   `internal/config` is already imported at `main.go:21`, so no new import is needed here.
3. In `services/xstockstrat-marketdata/internal/service/marketdata_service.go`, update the
   `fundamentalsEnabled()` doc comment at line 957–958 (no logic change) to record that the
   `s.fundamentals == nil` half of the guard is now defensive-only:
   ```go
   // fundamentalsEnabled returns FailedPrecondition when FMP is disabled (or unbuilt),
   // making NO external call (FR-6). Since feature 082, s.fundamentals is always non-nil
   // via the sole construction path (cmd/server/main.go's newFundamentalsSource) — the
   // "|| s.fundamentals == nil" half of this guard is defensive-only and not reachable
   // through that path today; kept in case a future caller constructs the service directly
   // with a nil source.
   func (s *MarketDataService) fundamentalsEnabled() error {
   ```
   The `if` condition on line 960 itself is unchanged, byte-for-byte.
4. In the same file, this feature's own doc-consistency purpose extends to two more comments in
   this already-touched file that describe the now-obsolete boot-gated semantics (caught by
   `/sdd-review impl-spec` — same file, same step, cheap to fix alongside):
   - Line 48–49 (the `fundamentals` field doc comment):
     ```go
     // fundamentals is the FMP source (feature 059), held separately from the OHLCV
     // registry (FR-2). Always non-nil since feature 082 — marketdata.fmp.enabled gates
     // use (fundamentalsEnabled()), not construction.
     fundamentals source.FundamentalsSource
     ```
   - Line 74–75 (the `NewMarketDataService` doc comment):
     ```go
     // NewMarketDataService creates the service and dials ledger + notify. fundamentals is
     // the FMP source (feature 059), always non-nil via the sole boot-time construction
     // path since feature 082 (cmd/server/main.go's newFundamentalsSource).
     func NewMarketDataService(
     ```

**Verification**:
```bash
cd services/xstockstrat-marketdata && GOWORK=off go build ./...
cd services/xstockstrat-marketdata && GOWORK=off golangci-lint run --modules-download-mode=mod
grep -n "GetBool(\"marketdata.fmp.enabled\"" services/xstockstrat-marketdata/cmd/server/main.go
grep -n "nil when marketdata.fmp.enabled is false" services/xstockstrat-marketdata/internal/service/marketdata_service.go
```
Confirm: the build succeeds; lint passes; the `GetBool("marketdata.fmp.enabled"...)` grep now
returns **zero** hits in `main.go` (the only remaining hit for that key in the whole service is
`internal/service/marketdata_service.go:960`, `fundamentalsEnabled()` — confirm with
`grep -rn "marketdata.fmp.enabled" services/xstockstrat-marketdata --include="*.go"`); the
stale-comment grep also returns **zero** hits (both occurrences updated per instruction 4).

---

### Step 2 — test: xstockstrat-marketdata: canary + live-toggle-no-restart proof

**Status**: `pending`
**Service**: `xstockstrat-marketdata`
**Files**:
- `services/xstockstrat-marketdata/cmd/server/main_test.go` — modify
- `services/xstockstrat-marketdata/internal/service/marketdata_service_test.go` — modify

**Reviewers**: Service owner (xstockstrat-marketdata) — same focus as Step 1 (this step tests
Step 1's change)

**Codebase Evidence**:
- Confirmed via Read `services/xstockstrat-marketdata/cmd/server/main_test.go:1-27`: package
  `main`, single existing test `TestLooksLikePlaceholderCred` using a table-driven `t.Run` pattern —
  reuse the same package and style; `internal/config` is not yet imported here (must be added).
- Confirmed via Read `services/xstockstrat-marketdata/internal/service/marketdata_service_test.go:
  168-269`: existing doubles to reuse — `fakeFundRepo`/`newFakeFundRepo()` (:168-197),
  `fakeFundSource` (:199-227), `fakeCfg` (:229-246), `enabledCfg()` (:260-265), `newFundSvc(cfg,
  repo, src, notify) *MarketDataService` (:267-269, a bare-struct constructor bypassing
  `NewMarketDataService`'s gRPC dials).
- Confirmed via Read `:326-339`: `TestGetFundamentals_DisabledFailedPrecondition` — the
  call-count-assertion shape to reuse (`connect.CodeOf(err) != connect.CodeFailedPrecondition`,
  `src.calls != 0`).
- Confirmed via Read `:379-385`: `TestGetFundamentals_NilSourceFailedPrecondition` — the test whose
  comment must be updated (body stays unchanged per `design.md` § Chosen Approach point 5).
- Confirmed via Read `services/xstockstrat-marketdata/internal/config/config.go:56-68,100-153`:
  `Watcher{ mu sync.RWMutex; snapshot map[...]; ready chan struct{}; once sync.Once }` —
  `GetString`/`GetBool` (`:100-111`, `:142-153`) touch only `w.mu` (zero-value `sync.RWMutex` is
  usable) and `w.snapshot` (nil-map read returns `ok=false`, falls through to the default); neither
  touches `w.ready`/`w.once`. A zero-value `*config.Watcher{}` is therefore safe for the canary test
  — verified by direct read, not assumed (per `fails.md` 2026-07-29/081 "exercise the producer, not
  its advertised state").
- Per this feature's own ledger entry (`insights.md` 2026-07-30 — 082, design): the acceptance
  criteria are proven by composing three narrower facts rather than one network-dependent
  integration test — this step is that composition (canary + toggle test); the third leg (the
  one-line, branch-free struct-literal field `fundamentals: fundamentals,` inside
  `&MarketDataService{...}` at `marketdata_service.go:101`) is verified by inspection, already
  re-confirmed in Step 1's Codebase Evidence, and needs no test of its own.

**TDD**: `red-green required`

**Instructions**:
1. In `services/xstockstrat-marketdata/cmd/server/main_test.go`, add the import
   `"github.com/xstockstrat/marketdata/internal/config"` and a new test:
   ```go
   // TestNewFundamentalsSource_AlwaysNonNil is a regression canary (feature 082): the
   // extracted constructor must return non-nil regardless of apiKey/config state — there
   // is no "enabled" axis left to vary at this call site. A zero-value *config.Watcher is
   // safe here: GetString touches only w.mu (usable zero-value sync.RWMutex) and
   // w.snapshot (nil-map read returns ok=false) — see internal/config/config.go:100-153.
   func TestNewFundamentalsSource_AlwaysNonNil(t *testing.T) {
       cfgWatcher := &config.Watcher{}
       for _, apiKey := range []string{"", "real-fmp-key"} {
           src := newFundamentalsSource(cfgWatcher, apiKey)
           if src == nil {
               t.Fatalf("newFundamentalsSource(%q) returned nil; must always be non-nil", apiKey)
           }
       }
   }
   ```
2. In `services/xstockstrat-marketdata/internal/service/marketdata_service_test.go`, add a new test
   after `TestGetFundamentals_DisabledFailedPrecondition` (:326-339), reusing `newFakeFundRepo`,
   `fakeFundSource`, `fakeCfg`, `newFundSvc`:
   ```go
   // TestGetFundamentals_LiveToggle_NoRestart proves the acceptance criteria (feature 082):
   // flipping marketdata.fmp.enabled live, on the SAME svc/cfg object — no restart — takes
   // effect on the very next call, in both directions.
   func TestGetFundamentals_LiveToggle_NoRestart(t *testing.T) {
       repo := newFakeFundRepo()
       src := &fakeFundSource{resp: &source.Fundamentals{Price: 200}}
       cfg := &fakeCfg{bools: map[string]bool{"marketdata.fmp.enabled": false}}
       svc := newFundSvc(cfg, repo, src, &fakeNotify{})

       // starts disabled: FailedPrecondition, zero FMP calls
       if _, err := svc.GetFundamentals(context.Background(), "AAPL"); connect.CodeOf(err) != connect.CodeFailedPrecondition {
           t.Fatalf("expected FailedPrecondition while disabled, got %v", err)
       }
       if src.calls != 0 {
           t.Fatalf("disabled must not call FMP, got %d", src.calls)
       }

       // flip live, same cfg/svc, no restart: next call attempts a fetch
       cfg.bools["marketdata.fmp.enabled"] = true
       if _, err := svc.GetFundamentals(context.Background(), "AAPL"); err != nil {
           t.Fatalf("expected live-enabled fetch to succeed, got %v", err)
       }
       if src.calls != 1 {
           t.Fatalf("expected exactly 1 FMP call after live-enable, got %d", src.calls)
       }

       // flip back, same cfg/svc, no restart: short-circuits again, no further call
       cfg.bools["marketdata.fmp.enabled"] = false
       if _, err := svc.GetFundamentals(context.Background(), "AAPL"); connect.CodeOf(err) != connect.CodeFailedPrecondition {
           t.Fatalf("expected FailedPrecondition after live-disable, got %v", err)
       }
       if src.calls != 1 {
           t.Fatalf("disabled again must not call FMP, got %d", src.calls)
       }
   }
   ```
3. Update the comment on `TestGetFundamentals_NilSourceFailedPrecondition` (:378-379, body
   unchanged) to record it is now defensive-only:
   ```go
   // FR-6 / feature-082: enabled but nil source — defensive-only guard. Since feature 082,
   // fundamentalsSrc is always non-nil via newFundamentalsSource (cmd/server/main.go), so
   // this path is unreachable through the current sole construction call site; kept as a
   // guard against a future direct NewMarketDataService caller passing a nil source.
   func TestGetFundamentals_NilSourceFailedPrecondition(t *testing.T) {
   ```

**C-13 (test data, non-frontend)**: no new domain literal/fixture is introduced — this step reuses
the existing `fakeFundRepo`/`fakeFundSource`/`fakeCfg`/`newFundSvc`/`fakeNotify` doubles already
declared once in `marketdata_service_test.go:168-269`; no second inline copy is created.

**Verification**:
```bash
cd services/xstockstrat-marketdata && GOWORK=off go test ./cmd/... -run TestNewFundamentalsSource_AlwaysNonNil -v
cd services/xstockstrat-marketdata && GOWORK=off go test ./internal/service/... -run 'TestGetFundamentals_LiveToggle_NoRestart|TestGetFundamentals_NilSourceFailedPrecondition|TestGetFundamentals_DisabledFailedPrecondition' -race -v
cd services/xstockstrat-marketdata && GOWORK=off golangci-lint run --modules-download-mode=mod
```
All three new/updated tests pass. New logic in this feature lands only in `cmd/` and
`internal/service/` — both excluded from the CI `COVERPKGS` measurement
(`go list ./... | grep -Ev '/(cmd|handler|repository|telemetry|service)(/|$)'`,
`.claude/skills/sdd-spec/reference/spec-template.md` coverage table) — so no coverage-percentage
threshold applies to this step; the above test-pass verification is sufficient. Still run the full
suite once to confirm no regression:
```bash
cd services/xstockstrat-marketdata && GOWORK=off go test ./... -race -count=1
```

---

### Step 3 — docs: correct both doc surfaces describing the FMP boot-time gate

**Status**: `pending`
**Service**: `xstockstrat-marketdata`
**Files**:
- `services/xstockstrat-marketdata/CLAUDE.md` — modify
- `services/xstockstrat-marketdata/docs/context-constitution.md` — modify

**Reviewers**: none (per `docs/runbooks/reviewer-registry.md` § Step Category → Reviewer Roles,
`docs` → "None")

**Codebase Evidence**:
- Confirmed via Read `services/xstockstrat-marketdata/CLAUDE.md` § Config Keys Consumed, the
  `marketdata.fmp.enabled` row: `"Master gate for the FMP fundamentals source (feature 059). Off by
  default; establishes the marketdata.<source>.enabled convention. When false, GetFundamentals(Multi)
  returns FailedPrecondition and no FMP client is built."` — the clause "no FMP client is built" is
  now false after Step 1 (the client is always built at boot).
- Confirmed via `grep -n "FMP gated" services/xstockstrat-marketdata/docs/context-constitution.md`
  → line 46: `"| FMP gated by \`marketdata.fmp.enabled\`, held off the OHLCV \`Registry\` (FR-2) |
  \`cmd/server/main.go:110\`, \`internal/source/source.go:57\` |"` — cites `main.go:110` (the
  boot-time `if` line) as "the gate"; after Step 1 that line no longer exists as a gate (it's an
  unconditional call).

**TDD**: `N/A (docs — no behavioral test applies)`

**Instructions**:
1. In `services/xstockstrat-marketdata/CLAUDE.md`'s § Config Keys Consumed table, replace the
   `marketdata.fmp.enabled` row's description with:
   ```
   Master gate for the FMP fundamentals source (feature 059). Off by default; establishes the
   `marketdata.<source>.enabled` convention. Read live on every `GetFundamentals`/`GetFundamentalsMulti`
   call (`fundamentalsEnabled()`, `internal/service/marketdata_service.go:960`) — flipping it takes
   effect on the very next call, no service restart required (feature 082). The FMP client itself is
   always constructed at boot (`cmd/server/main.go`'s `newFundamentalsSource`); this flag gates *use*,
   not construction.
   ```
2. In `services/xstockstrat-marketdata/docs/context-constitution.md`, replace line 46's row with:
   ```
   | FMP gated live per-RPC by `marketdata.fmp.enabled` (re-read on every call, no restart needed
   since feature 082), held off the OHLCV `Registry` (FR-2) | `internal/service/marketdata_service.go:960`,
   `internal/source/source.go:57` |
   ```

**Verification**:
```bash
grep -n "no service restart required (feature 082)" services/xstockstrat-marketdata/CLAUDE.md
grep -n "marketdata_service.go:960" services/xstockstrat-marketdata/docs/context-constitution.md
grep -n "no FMP client is built" services/xstockstrat-marketdata/CLAUDE.md   # expect zero hits
```
Confirm all three: the first two greps each return exactly one hit; the third returns zero. Per
root `CLAUDE.md` § Teardown, this step changes a service `CLAUDE.md` and a `docs/context-
constitution.md` — run `/context-scrubber scan` scoped to `xstockstrat-marketdata` as the last step
before pushing this step's PR, and fix any grounded findings it reports. If the context-forge plugin
is unavailable in the session, say so in the PR body rather than skipping silently.

---

## Deviation Log

_Populated by /sdd-execute as implementation proceeds._
