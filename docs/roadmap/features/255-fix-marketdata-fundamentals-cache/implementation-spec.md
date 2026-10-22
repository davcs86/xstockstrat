# Implementation Spec: fix-marketdata-fundamentals-cache

**Status**: `pending`
**Created**: 2026-10-22
**Feature**: `docs/roadmap/features/255-fix-marketdata-fundamentals-cache/feature.md`
**Total Steps**: 17
**Feature Branch**: `feature/fix-marketdata-fundamentals-cache`

All service paths are relative to `services/xstockstrat-marketdata/` unless they start with `services/`, `docs/` or
`packages/`. Line anchors were re-checked at the branch tip `818be318`. The marketdata tree there is identical to
`origin/main-dev` `111b4e25`: `git diff --stat origin/main-dev HEAD -- services/xstockstrat-marketdata` is empty.

---

## Execution Summary

The fix is Go-only, in `xstockstrat-marketdata`. It has no proto, migration or config-key change (design.md §Chosen
Approach). The steps follow the design order so that rebases against 215 and 254 stay small:

1. D-50: comment and doc corrections, plus cap-0 behaviour pins (Steps 1–2).
2. The source-id constants that later steps bind (S, Steps 3–4).
3. D-51: source-filtered quota counts and the boot-seed seam (Steps 5–6).
4. D-52: vendor-axis fresh check (Steps 7–8).
5. D-53a: one `decodeExtraMetrics` helper (Steps 9–10).
6. D-53b in two halves. The FMP client classifies enrichment failures and sets the flag (Steps 11–12). The repo and
   service store a flagged row already expired, with the same-source merge and a trace-carrying write ctx (Steps 13–14).
7. D-19: the Alpaca stream manager, isolated last (Steps 15–16).
8. A read-only consumer-surface check, C-14 (Step 17).

Every `service` step has its own `test` step after it. `/sdd-execute` writes each test first and records it failing
(compile failure or assertion) against the pre-implementation tree (P-06). Step 2 is the one exception, recorded
there: FR-1 changes no behaviour, so its pins are green on the first run.

**Consumer surfaces (C-14).** The served shape does not change: `missing_metrics = 18`
(`packages/proto/marketdata/v1/marketdata.proto:241`), and the status codes stay the same. Agent tools
`query_fundamentals` (`services/xstockstrat-agent/app/tools.py:402`) and `screen_symbols` (`:812`), and the UI BFFs
`services/xstockstrat-ui/src/lib/traderBff.ts:77` and `services/xstockstrat-ui/src/lib/insightsBff.ts:102`/`:113`,
get the read-only verification in Step 17. None of them needs a code change. FR-5 has no consumer surface, because no
subscriber of the stream manager is wired today.

### Scenario Coverage (C-15)

| Scenario | Covered by |
|---|---|
| @AC-1 cap 0 is a zero budget, single path | Step 2 |
| @AC-2 edgar rows do not consume the Finnhub quota | Step 6 |
| @AC-3 the FMP boot seed counts only FMP rows | Step 6 |
| @AC-4 the vendor path does not serve an edgar row as vendor data | Step 8 |
| @AC-5 a failed FMP enrichment is not cached as a fresh complete row | Step 12 (WARN, flag), Step 14 (missing_metrics, expiry, re-fetch) |
| @AC-6 an undecodable extra column is logged | Step 10 |
| @AC-7 the Alpaca reconnect budget resets after a healthy session | Step 16 |
| @AC-8 subscribers learn when the Alpaca stream gives up | Step 16 |
| @AC-9 cap 0 is a zero budget, multi path | Step 2 |
| @AC-10 a transient enrichment failure over an edgar row is stored already expired | Step 12 (503 → flag), Step 14 (expiry, stale at cap, re-fetch) |

`/sdd-spec` applied the acceptance-text changes that design.md assigned to it, under the operator's r3 (4) and r4
sign-off. AC-5's first Then now lists `"beta"` only. AC-6's input is refined to a jsonb value that really fails the
decode (design Step 4). @AC-10 is new, with its trigger pinned to an FMP HTTP 503 on profile. FR-4(b) in
product-spec.md is rewritten to match.

## Step Dependencies

- Step 2 [test] pins behaviour that Step 1 [docs] only describes. It is independent and may run first.
- Step 3 [service] adds `fmp.SourceName` and `finnhub.SourceName`. Steps 5 and 13 bind them, so they need Step 3.
- Step 4 [test] covers Step 3. Step 6 covers Step 5, Step 8 covers Step 7, Step 10 covers Step 9, Step 12 covers
  Step 11, Step 14 covers Step 13, and Step 16 covers Step 15.
- Step 5 changes the `fundamentalsRepo` interface (`internal/service/marketdata_service.go:157-158`), so
  `fakeFundRepo` must change in the same red/green pair (Step 6). The service test package does not compile between
  the two.
- Step 13 needs Step 11. It reads `source.Fundamentals.EnrichmentFailed`, which Step 11 adds.
- Step 13 needs Step 9 for the switch of `GetFundamentals` from `r.pool` to `r.db`. Both edit the same function, and
  Step 9 does the switch.
- Step 14 extends the `fakeFundRepo` that Step 6 reshaped (source maps), so it needs Step 6.
- Steps 15–16 (D-19) are isolated. They touch only `internal/alpaca/` and may land in any order after Step 1, but they
  stay last to limit rebase risk.
- Step 17 runs last. It checks the final served shape.
- **Cross-feature (rebase only, design §Housekeeping):** land 255 after 215-block-fundamentals-strategy-on-etf. Expect
  conflicts at `internal/fmp/fmp_client.go:243`/`:254-255`, `internal/service/marketdata_service.go:1704`/`:1760`, the
  `UpsertFundamentals` SQL and the seed WHERE. 254-fix-marketdata-secret-exposure is a soft WARN with the same overlap.
  The `docs/roadmap/features/merge-order.md` rows are **still pending an operator yes**. This spec does not add them.
- **Follow-up (design Open Risk):** after a manager give-up, StreamBars RPC clients still hang
  (`internal/handler/marketdata_handler.go:37-54`). AC-8 holds at the manager level only. A follow-up feature is
  needed, and this spec does not create it.

---

### Step 1 — docs: D-50 — cap `<= 0` is a zero budget (comments and docs only)

**Status**: `pending`
**Service**: `xstockstrat-marketdata`, `docs/patterns/`
**Files**:
- `services/xstockstrat-marketdata/internal/fmp/fmp_client.go` — modify (comment only)
- `services/xstockstrat-marketdata/internal/service/marketdata_service.go` — modify (comment only)
- `services/xstockstrat-marketdata/CLAUDE.md` — modify
- `docs/patterns/config-governance.md` — modify

**Reviewers**: none

**Codebase Evidence**:
- `grep -n "uncapped" internal/fmp/fmp_client.go` → `:97`
  `// BudgetSnapshot returns today's used count and the live cap (cap <= 0 = uncapped).`. `:36` (`nil = unthrottled
  and uncapped (tests only)`) describes a nil `Limits` func. It is correct and stays.
- `internal/service/marketdata_service.go:1958`
  `// atQuotaAlertThreshold is the single home of the 80%-of-cap threshold; cap <= 0 is never "at threshold".` The
  code at `:1959` is `cap > 0 && count >= (cap*8)/10`.
- The enforced zero budget, unchanged: `reserve()` refuses at `fmp_client.go:127` (`c.used >= dailyCap`). The
  `count >= cap` gates are at `marketdata_service.go:1688` and `:1742`. `enrichmentUnderCap` (`:2421-2427`) returns
  `used < dailyCap`.
- `services/xstockstrat-marketdata/CLAUDE.md:82`: the `marketdata.fmp.daily_request_cap` row has no `<= 0` semantics
  and says "boot-seeded from today's fetched-row count".
- `docs/patterns/config-governance.md:183` (shared-budget prose) and `:773` (key-table row "Max FMP requests per UTC
  day (free Basic budget)") have no `<= 0` semantics.

**TDD**: `N/A (docs: comment and doc text only, no behaviour change; Step 2 pins the behaviour)`

**Covers**: —

**Instructions**:
1. `fmp_client.go:97`: change the parenthetical to `(cap <= 0 = zero budget: every reserve() is refused)`.
2. `marketdata_service.go:1958`: keep the single-home sentence. Replace the clause with `cap <= 0 is a zero budget
   (FMP disabled), never "at threshold" — no 80% alert`. Do not touch `:1959`, and do not duplicate the helper
   (C-18, @feature-215 @AC-14).
3. marketdata `CLAUDE.md:82`: append `` `<= 0` is a zero budget (FMP disabled on every path); a large cap is
   effectively uncapped. `` Also change "boot-seeded from today's fetched-row count" to "boot-seeded from today's
   `source='fmp'` row count (fetched or as-of today), a conservative floor: `edgar+fmp` rows and classification calls
   write no `fmp` row". The second change keeps the doc true after Step 5 (design Step 2).
4. `config-governance.md:773`: append `; <= 0 = zero budget (FMP disabled), large = effectively uncapped` to the
   description cell. At `:183`, add one clause saying a cap `<= 0` disables every FMP path.
5. Context-file teardown (root `CLAUDE.md` §Teardown): this step changes `services/xstockstrat-marketdata/CLAUDE.md`,
   so `/sdd-execute` runs `/context-forge:context-constitution refresh` scoped to that file before pushing. If the
   plugin is unavailable, reconcile by hand and record both facts in the PR body.

**Verification**:
```bash
grep -n "uncapped" services/xstockstrat-marketdata/internal/fmp/fmp_client.go   # only :36 (nil Limits) remains
grep -n "zero budget" services/xstockstrat-marketdata/internal/fmp/fmp_client.go services/xstockstrat-marketdata/internal/service/marketdata_service.go services/xstockstrat-marketdata/CLAUDE.md docs/patterns/config-governance.md
grep -c "func atQuotaAlertThreshold" services/xstockstrat-marketdata/internal/service/marketdata_service.go   # 1
cd services/xstockstrat-marketdata && GOWORK=off go build ./...
```
Checklist (FR-1, review warning 1): all four sites say `<= 0` = zero budget, and none says "uncapped" for cap `<= 0`.

---

### Step 2 — test: cap-0 zero-budget behavioural pins (AC-1, AC-9)

**Status**: `pending`
**Service**: `xstockstrat-marketdata`
**Files**:
- `services/xstockstrat-marketdata/internal/service/marketdata_service_test.go` — modify

**Reviewers**: xstockstrat-marketdata owner — OHLCV ingestion integrity, TimescaleDB hypertable partitioning, Alpaca feed idempotency

**Codebase Evidence**:
- Analogue: `TestGetFundamentals_AtCapNoCacheResourceExhausted` (`internal/service/marketdata_service_test.go:400`)
  sets `repo.todayCount = 250` and asserts `connect.CodeResourceExhausted`.
- Fakes: `fakeFundRepo` (`:180`), `fakeFundSource.calls` (`:220-224`), `fakeNotify.warnings` (`:275-285`),
  `enabledCfg("fmp")` (`:290`, which seeds `marketdata.fmp.daily_request_cap: 250`), `newFundSvc` (`:309`). The fixed
  budget is `fakeBudget{used, cap}` (`:2035-2037`). The service field `fmpBudget` (`marketdata_service.go:91`) has the
  interface type `fmpBudget` (`internal/service/classification_service.go:36`).
- Quota path: `fundamentalsQuota` returns `fmpBudget.BudgetSnapshot()` when the budget is wired
  (`marketdata_service.go:1938-1940`). The multi-path stale serve is at `:1688-1694`.

**TDD**: `N/A (regression pin of unchanged behaviour: FR-1 fixes comments only, so these tests are expected green on the first run; /sdd-execute records that run as the pin, not as a red)`

**Covers**: `AC-1, AC-9`

**Instructions**:
1. Add `TestGetFundamentals_CapZeroIsZeroBudget_AC1`. Use `enabledCfg("fmp")` with
   `ints["marketdata.fmp.daily_request_cap"]=0`, wire `svc.fmpBudget = fakeBudget{used: 0, cap: 0}`, and leave "AAPL"
   uncached. Assert `connect.CodeOf(err) == connect.CodeResourceExhausted`, `src.calls == 0` and
   `notify.warnings == 0`.
2. Add `TestGetFundamentalsMulti_CapZeroIsZeroBudget_AC9` with the same cfg and budget. Seed `repo.rows["AAPL"]` with
   `Source: "fmp"` and `repo.fetchedAt["AAPL"] = time.Now().Add(-48*time.Hour)`, and leave "MSFT" absent (use
   `testdata.Msft` from `internal/testdata/marks.go:14`). Call `svc.GetFundamentalsMulti(ctx, []string{"AAPL",
   testdata.Msft})`. Assert one result, AAPL with `Stale == true`; `src.calls == 0`; `notify.warnings == 0`.
3. C-13: the AAPL row literal has one consumer per test, so inline is compliant. The MSFT symbol reuses the existing
   `testdata` constant.

**Verification**:
```bash
cd services/xstockstrat-marketdata && GOWORK=off go test ./internal/service/ -run 'CapZeroIsZeroBudget' -count=1 -v
cd services/xstockstrat-marketdata && GOWORK=off COVERPKGS=$(GOWORK=off go list ./... | grep -Ev '/(cmd|handler|repository|telemetry|service)(/|$)' | tr '\n' ',' | sed 's/,$//') && GOWORK=off go test ./... -race -count=1 -coverprofile=coverage.out -covermode=atomic -coverpkg="${COVERPKGS}" && go tool cover -func=coverage.out | grep "^total:"   # confirm >= 40%
cd services/xstockstrat-marketdata && GOWORK=off golangci-lint run --modules-download-mode=mod
```
The new tests are in the excluded `service` package. The CI total must still be at least 40% (C-08).

---

### Step 3 — service: S — introduce `fmp.SourceName`/`finnhub.SourceName` and alias `classification.SourceFMP`

**Status**: `pending`
**Service**: `xstockstrat-marketdata`
**Files**:
- `services/xstockstrat-marketdata/internal/fmp/fmp_client.go` — modify
- `services/xstockstrat-marketdata/internal/finnhub/finnhub_client.go` — modify
- `services/xstockstrat-marketdata/internal/classification/sector.go` — modify

**Reviewers**: xstockstrat-marketdata owner — OHLCV ingestion integrity, TimescaleDB hypertable partitioning, Alpaca feed idempotency

**Codebase Evidence**:
- `internal/fmp/fmp_client.go:333-334`: `AsOf: now,` / `Source: "fmp",` in `fmpQuote.toFundamentals`.
  `grep -n "SourceName" -r internal/` → **Not found**. The constant is created here.
- `internal/finnhub/finnhub_client.go:94`: `Source: "finnhub",`.
- `internal/classification/sector.go:16-20`: `const ( SourceFMP = "fmp"; SourceSeed = "seed"; TaxonomyGICS = "GICS" )`.
  Its one production consumer is `internal/repository/classification_repo.go:149`.
- Import-cycle check (design Open Risk). `grep -n "github.com/xstockstrat/marketdata/internal"` over the non-test
  files gives:
  - `internal/classification/*.go`: no internal imports.
  - `internal/fmp/fmp_client.go:19`: imports only `internal/source`.
  - `internal/finnhub/finnhub_client.go:15`: imports only `internal/source`.
  - `internal/source/*.go`: no internal imports.
  
  So the new edge `classification → fmp → source` closes no cycle, and the primary alias direction is used.
  `internal/service/marketdata_service.go:26` already imports `fmp`. The service does not import `finnhub` today (its
  imports are `:25-31`); Step 5 adds that import, and `finnhub` imports only `source`, so it adds no cycle.

**TDD**: `red-green required`

**Covers**: —

**Instructions**:
1. In `fmp_client.go`, add `// SourceName is the fundamentals-row source id FMP writes; the quota seed filters on it.`
   and `const SourceName = "fmp"`. Replace `Source: "fmp"` at `:334` with `Source: SourceName`.
2. Above `AsOf: now` at `:333`, add the 2-line constraint comment from design 5.8: `// The boot quota seed counts
   as_of >= today: AsOf must stay the fetch instant,` / `// not a vendor-reported date.`
3. In `finnhub_client.go`, add `const SourceName = "finnhub"` with a one-line doc comment, and use it at `:94`.
4. In `classification/sector.go`, import `github.com/xstockstrat/marketdata/internal/fmp` and change the const entry
   to `SourceFMP = fmp.SourceName`. A const alias of an untyped const is legal Go. The Codebase Evidence
   cycle check shows no cycle, so there is no fallback branch. If `go build ./...` reports a cycle anyway, stop:
   the evidence is wrong, and this is a P-03 deviation to raise with the operator.
5. C-18 waivers, recorded and not edited (design §S): the fallback `"fmp"` at `internal/repository/marketdata_repo.go:587`,
   and the `"finnhub"` literals in the service provider switch at `marketdata_service.go:1931`/`:1951`.

**Verification**:
```bash
cd services/xstockstrat-marketdata && GOWORK=off go build ./... && GOWORK=off go vet ./internal/fmp/ ./internal/finnhub/ ./internal/classification/
grep -n 'Source: *"fmp"\|Source: *"finnhub"' services/xstockstrat-marketdata/internal/fmp/fmp_client.go services/xstockstrat-marketdata/internal/finnhub/finnhub_client.go   # no hits
```

---

### Step 4 — test: source-id constants and AsOf-is-fetch-instant

**Status**: `pending`
**Service**: `xstockstrat-marketdata`
**Files**:
- `services/xstockstrat-marketdata/internal/fmp/fmp_client_test.go` — modify
- `services/xstockstrat-marketdata/internal/finnhub/finnhub_client_test.go` — modify
- `services/xstockstrat-marketdata/internal/classification/sector_test.go` — modify

**Reviewers**: xstockstrat-marketdata owner — OHLCV ingestion integrity, TimescaleDB hypertable partitioning, Alpaca feed idempotency

**Codebase Evidence**:
- `internal/classification/sector_test.go:1` is `package classification`. It can import `fmp`, because after Step 3
  `classification` imports `fmp`. An in-package `fmp` test cannot import `classification`: Go rejects that as an
  import cycle in test.
- `internal/fmp/fmp_client_test.go:47` `newTestClient(metrics []string, rt *recordingRT)`, and `recordingRT`
  (`:16-45`), which maps a path to a body. Analogue: `TestGetFundamentals_MapsCoreAndExtended` (`:67`).
- `internal/finnhub/finnhub_client_test.go` exists and imports `internal/source` (`:12`).

**TDD**: `red-green required` (the test refers to `fmp.SourceName`/`finnhub.SourceName`, so it fails to compile before
Step 3)

**Covers**: —

**Instructions**:
1. Add `TestToFundamentals_SourceAndAsOfIsFetchInstant` (in package `fmp`). Run `GetFundamentals` against a
   `recordingRT` quote body. Assert `f.Source == SourceName` and `time.Since(f.AsOf) < 5*time.Second` (this pins the
   5.8 constraint).
2. Pin the alias in `internal/classification/sector_test.go`: add `TestSourceFMPAliasesFMPSourceName`, which asserts
   `SourceFMP == fmp.SourceName`. It is not in the `fmp` test, because importing `classification` from package `fmp`
   is an import cycle.
3. In the finnhub test file, assert that the produced row's `Source == SourceName`, reusing that file's existing stub
   setup.
4. C-13: no new domain literal.

**Verification**:
```bash
cd services/xstockstrat-marketdata && GOWORK=off go test ./internal/fmp/ ./internal/finnhub/ ./internal/classification/ -count=1
cd services/xstockstrat-marketdata && GOWORK=off COVERPKGS=$(GOWORK=off go list ./... | grep -Ev '/(cmd|handler|repository|telemetry|service)(/|$)' | tr '\n' ',' | sed 's/,$//') && GOWORK=off go test ./... -race -count=1 -coverprofile=coverage.out -covermode=atomic -coverpkg="${COVERPKGS}" && go tool cover -func=coverage.out | grep "^total:"   # confirm >= 40%
cd services/xstockstrat-marketdata && GOWORK=off golangci-lint run --modules-download-mode=mod
```
`fmp`, `finnhub` and `classification` are counted packages, so the total must stay at least 40% (C-08).

---

### Step 5 — service: D-51 — source-filtered quota counts, the parenthesised seed predicate and the `seedFMPBudget` seam

**Status**: `pending`
**Service**: `xstockstrat-marketdata`
**Files**:
- `services/xstockstrat-marketdata/internal/repository/marketdata_repo.go` — modify
- `services/xstockstrat-marketdata/internal/service/marketdata_service.go` — modify
- `services/xstockstrat-marketdata/cmd/server/main.go` — modify

**Reviewers**: xstockstrat-marketdata owner — OHLCV ingestion integrity, TimescaleDB hypertable partitioning, Alpaca feed idempotency

**Codebase Evidence**:
- `internal/repository/marketdata_repo.go:654-664`: `CountFundamentalsFetchedToday(ctx)` runs `r.pool.QueryRow(...
  WHERE fetched_at >= date_trunc('day', now() AT TIME ZONE 'UTC'))`. There is no source predicate.
- `:667-675`: `CountFundamentalsFetchedSince(ctx, since)` runs `r.pool.QueryRow(... WHERE fetched_at >= $1)`.
- `r.db` (`:34`, of type `classificationDB`) is the pgxmock-substitutable surface; the comment says it is "the query
  surface for fundamentals". Production sets `db: pool` (`:46`). `UpsertFundamentals` already uses `r.db.Exec`
  (`:605`).
- `internal/service/marketdata_service.go:157-158`: the interface methods
  `CountFundamentalsFetchedToday(ctx context.Context) (int, error)` and
  `CountFundamentalsFetchedSince(ctx context.Context, since time.Time) (int, error)`.
- `fundamentalsQuota` (`:1929-1947`): the Finnhub window calls `CountFundamentalsFetchedSince(ctx, since)` at `:1935`.
  The FMP repo fallback, used only when `fmpBudget == nil`, calls `CountFundamentalsFetchedToday(ctx)` at `:1943`.
- `cmd/server/main.go:125` `fundProvider := cfgWatcher.GetString("marketdata.fundamentals.provider", "finnhub")`;
  `:126` `fmpClient := newFMPClient(...)`; `:129-133`
  `if n, err := repo.CountFundamentalsFetchedToday(ctx); err == nil { fmpClient.SeedBudget(n) } else { slog.Warn(...) }`.
- `SeedBudget(used int)` is at `internal/fmp/fmp_client.go:88`.
- Index: `idx_fundamentals_fetched_at` (`migrations/002_fundamentals.up.sql:27-28`) is enough. No `010` migration
  (design §Step 2, F-01).

**TDD**: `red-green required`

**Covers**: —

**Instructions**:
1. Repo. Change the signatures to `CountFundamentalsFetchedToday(ctx context.Context, src string) (int, error)` and
   `CountFundamentalsFetchedSince(ctx context.Context, src string, since time.Time) (int, error)`. Switch both from
   `r.pool.QueryRow` to `r.db.QueryRow`, which is the same pool in production and lets pgxmock pin the SQL.
   - Today: `WHERE source = $1 AND (fetched_at >= date_trunc('day', now() AT TIME ZONE 'UTC') OR as_of >= date_trunc('day', now() AT TIME ZONE 'UTC'))`.
     This is design 5.8: the parenthesised form exactly, with the existing UTC-day expression unchanged. It lands here
     so the same SQL is not edited twice.
   - Since: `WHERE source = $1 AND fetched_at >= $2`, with no as_of clause.
   - Rewrite the two doc comments (`:654-655`, `:667-668`) to state the source filter. Make the "as_of keeps an
     epoch-expired fmp row counted" point in at most 2 lines.
   - The repo imports neither `fmp` nor `finnhub`. The source arrives as a parameter.
2. Service. Update the interface at `:157-158` to the new signatures. At `:1935` pass `finnhub.SourceName` (add the
   `internal/finnhub` import). At `:1943` pass `fmp.SourceName`.
3. `main.go`. Extract `:129-133` into an unexported
   `func seedFMPBudget(ctx context.Context, counter interface{ CountFundamentalsFetchedToday(context.Context, string) (int, error) }, b interface{ SeedBudget(int) })`.
   It calls `counter.CountFundamentalsFetchedToday(ctx, fmp.SourceName)`, seeds on success, and keeps the existing
   WARN on error. It always counts the FMP source, whatever `fundProvider` is: the `*fmp.Client` budget is shared and
   is seeded even under the `finnhub` default (`:125`). Replace the inline block with
   `seedFMPBudget(ctx, repo, fmpClient)`. Update the 2-line comment at `:127-128`, and keep the "conservative floor"
   wording.
4. Existing ctx: `main` has a boot `ctx`, which is not request-derived, so no C-03 change applies here.

**Verification**:
```bash
cd services/xstockstrat-marketdata && GOWORK=off go build ./... && GOWORK=off go vet ./internal/repository/ ./internal/service/ ./cmd/server/
grep -n "CountFundamentalsFetched" -r services/xstockstrat-marketdata --include=*.go | grep -v _test   # every call passes a source
```

---

### Step 6 — test: source-filtered counts and the boot seed (AC-2, AC-3)

**Status**: `pending`
**Service**: `xstockstrat-marketdata`
**Files**:
- `services/xstockstrat-marketdata/internal/service/marketdata_service_test.go` — modify
- `services/xstockstrat-marketdata/internal/repository/marketdata_repo_test.go` — modify
- `services/xstockstrat-marketdata/cmd/server/main_test.go` — modify

**Reviewers**: xstockstrat-marketdata owner — OHLCV ingestion integrity, TimescaleDB hypertable partitioning, Alpaca feed idempotency

**Codebase Evidence**:
- `fakeFundRepo` (`internal/service/marketdata_service_test.go:180-217`) has the fields `todayCount int` and
  `sinceCount int`. `UpsertFundamentals` increments `todayCount` (`:204`). The count methods ignore source (`:208`,
  `:216`). There are 17 `todayCount`/`sinceCount` references, all in this file (`grep -rn "todayCount\|sinceCount"
  --include=*_test.go`).
- Finnhub analogue: `TestGetFundamentals_Finnhub_AtCapStale` (`:541`). `enabledCfg("finnhub")` seeds
  `symbols_per_minute 20` and `rate_window_seconds 60` (`:293-300`).
- pgxmock analogue: `TestUpsertFundamentals_CastsExtraMetricsToJSONB` (`internal/repository/marketdata_repo_test.go:118`),
  which builds `repo := &MarketDataRepo{db: mock}`.
- `cmd/server/main_test.go` is `package main` (`:1`), so it reaches the unexported `seedFMPBudget`.
- `fmp.NewClient(fmp.ClientConfig{BaseURL, APIKey, HTTPClient, Limits})` is exported (`internal/fmp/fmp_client.go:27-41`, `:60`).

**TDD**: `red-green required` (the new signatures do not compile against the pre-Step-5 tree, and the per-source
assertions fail)

**Covers**: `AC-2, AC-3`

**Instructions**:
1. Reshape `fakeFundRepo`: replace `todayCount`/`sinceCount` with `todayBySource map[string]int` and
   `sinceBySource map[string]int`, initialised in `newFakeFundRepo`. Record each count call's `src` in
   `countSources []string`. `UpsertFundamentals` increments `todayBySource[f.Source]`. Migrate the 17 existing
   references: an FMP-provider test sets `todayBySource["fmp"]` and a Finnhub test sets `sinceBySource["finnhub"]`.
   The pre-existing tests keep passing with no assertion change (design Open Risk "Test fake").
2. AC-2: add `TestGetFundamentals_Finnhub_EdgarRowsDoNotConsumeQuota_AC2`. Use `enabledCfg("finnhub")`, set
   `sinceBySource["edgar"]=20` and `sinceBySource["finnhub"]=0`, and leave "MSFT" uncached. Assert `src.calls == 1`,
   a non-stale response, no error, `notify.warnings == 0`, and `countSources` containing `finnhub.SourceName`.
3. Add a fallback-path test: with `fmpBudget == nil` and provider "fmp", `todayBySource["edgar"]=250` and
   `["fmp"]=0`. Assert that the fetch happens and that the call passed `fmp.SourceName`.
4. AC-3 (seed seam), in `main_test.go`: add `TestSeedFMPBudget_CountsOnlyFMPRows_AC3`. Use a local fake counter
   holding `{"edgar": 30, "fmp": 5}` and returning `m[src]`. Build an `fmp.Client` with `Limits: func() (float64, int)
   { return 0, 7 }` and a recording `http.RoundTripper` (a local type: the `fmp` test helpers are package-private)
   that returns a one-element quote JSON. Call `seedFMPBudget(ctx, counter, client)`. Then assert:
   - `client.BudgetSnapshot()` returns `used == 5`;
   - `client.GetFundamentals(ctx, "MSFT")` succeeds with one HTTP call, which means it is not
     `ErrFMPDailyCapExceeded`;
   - the counter received `fmp.SourceName`.
   Add an error-path case: the counter returns an error, the seed stays 0, and nothing panics.
5. SQL pins, using pgxmock in `marketdata_repo_test.go`:
   - `TestCountFundamentalsFetchedToday_SourceAndAsOfPredicate`: `ExpectQuery` regex
     `source = \$1 AND \(fetched_at >= .+ OR as_of >= .+\)`, `WithArgs("fmp")`, and a returned row count.
   - `TestCountFundamentalsFetchedSince_SourcePredicate`: `source = \$1 AND fetched_at >= \$2`, with
     `WithArgs("finnhub", pgxmock.AnyArg())`.
   - Both pin that the predicate is parenthesised, which rules out the rejected unparenthesised OR (design §Rejected).
   - pgxmock cannot evaluate SQL. The semantic "30 edgar rows with as_of today → 0" and "epoch fmp rows with as_of
     today → counted" cases are in the env-gated live-Postgres test in Step 14.
6. C-13: the symbols are inline single-consumer literals, except MSFT, which reuses `testdata.Msft`. The fake counter
   in `main_test.go` is single-consumer, so it stays inline.

**Verification**:
```bash
cd services/xstockstrat-marketdata && GOWORK=off COVERPKGS=$(GOWORK=off go list ./... | grep -Ev '/(cmd|handler|repository|telemetry|service)(/|$)' | tr '\n' ',' | sed 's/,$//') && GOWORK=off go test ./... -race -count=1 -coverprofile=coverage.out -covermode=atomic -coverpkg="${COVERPKGS}" && go tool cover -func=coverage.out | grep "^total:"   # confirm >= 40%
cd services/xstockstrat-marketdata && GOWORK=off golangci-lint run --modules-download-mode=mod
grep -rn "todayCount\b\|sinceCount\b" services/xstockstrat-marketdata --include=*_test.go   # no hits left
```
The new logic is in excluded packages (`repository`, `service`, `cmd`), so no coverage threshold applies to it. The
total must still be at least 40%.

---

### Step 7 — service: D-52 — vendor-axis fresh check

**Status**: `pending`
**Service**: `xstockstrat-marketdata`
**Files**:
- `services/xstockstrat-marketdata/internal/service/marketdata_service.go` — modify

**Reviewers**: xstockstrat-marketdata owner — OHLCV ingestion integrity, TimescaleDB hypertable partitioning, Alpaca feed idempotency

**Codebase Evidence**:
- Multi path, source-blind accept: `:1676` `if found && time.Since(fetchedAt) <= ttl {`.
- Single path: `:1734`, the same predicate in `resolveFundamentals`.
- Pattern to REUSE: `cacheAxis(src string) string` (`:1805-1812`), and the edgar-axis mirror at `:1849-1850`
  `found && time.Since(fetchedAt) <= ttl && cacheAxis(cached.Source) == snapshotSourceEdgar`. The constant
  `snapshotSourceVendor` is at `:1784`.
- The stale serves stay unchanged: `:1690-1694`, `:1697-1702`, `:1743-1745`, `:1752`.
- Edgar fallback: `edgarResolve` → `s.resolveFundamentals` (`:1868`). The vendor path never re-enters `edgarResolve`,
  so the fallback cannot loop.

**TDD**: `red-green required`

**Covers**: —

**Instructions**:
1. At `:1676` the predicate becomes `found && time.Since(fetchedAt) <= ttl && cacheAxis(f.Source) == snapshotSourceVendor`.
   At `:1734` it becomes the same with `cached.Source`. Use `cacheAxis`, never a raw string compare (feature 211
   design point 5).
2. Leave the stale serves alone. At quota, an edgar row may still be served `stale=true`, labelled by its `Source`.
   This preserves @feature-215 @AC-7: no new ResourceExhausted.
3. No other change. Fold any explanation into a comment of at most 2 lines.

**Verification**:
```bash
grep -n "cacheAxis(f.Source) == snapshotSourceVendor\|cacheAxis(cached.Source) == snapshotSourceVendor" services/xstockstrat-marketdata/internal/service/marketdata_service.go   # 2 hits
cd services/xstockstrat-marketdata && GOWORK=off go build ./...
```

---

### Step 8 — test: the vendor path refuses an edgar cache row (AC-4)

**Status**: `pending`
**Service**: `xstockstrat-marketdata`
**Files**:
- `services/xstockstrat-marketdata/internal/service/marketdata_service_test.go` — modify

**Reviewers**: xstockstrat-marketdata owner — OHLCV ingestion integrity, TimescaleDB hypertable partitioning, Alpaca feed idempotency

**Codebase Evidence**:
- Analogue to mirror: `TestGetFundamentals_EdgarCacheSelfHeal_feature211` (`:2433`), which uses `fakeCfg.strings`
  `"marketdata.fundamentals.snapshot_source"`.
- `TestGetFundamentals_CacheHitNoFMP` (`:313`) is the vendor-row cache-hit guard, and it must stay green.

**TDD**: `red-green required`

**Covers**: `AC-4`

**Instructions**:
1. Add `TestGetFundamentals_VendorPathRefusesEdgarRow_AC4`. Use `enabledCfg("finnhub")` plus `strings`
   `snapshot_source: "vendor"`. Seed `repo.rows["AAPL"] = {Source: "edgar", Price: f64p(100)}`, fetched 1 minute ago.
   Make the fake source return `Price: f64p(200)` with `Source: "finnhub"`. Assert `src.calls == 1`,
   `f.Price == 200`, `f.Source == "finnhub"` and `!f.Stale`.
2. Add the multi-path sibling `TestGetFundamentalsMulti_VendorPathRefusesEdgarRow`. Also add an `"edgar+fmp"` row
   case, which is on the edgar axis.
3. Add a stale-serve preservation case: an at-cap request (`sinceBySource["finnhub"]=20`) over a fresh edgar row
   serves it with `stale=true` and `Source == "edgar"`, with no ResourceExhausted and `src.calls == 0`.
4. Make sure `TestGetFundamentals_CacheHitNoFMP` and the existing feature-211 edgar tests still pass.

**Verification**:
```bash
cd services/xstockstrat-marketdata && GOWORK=off go test ./internal/service/ -run 'VendorPathRefusesEdgarRow|CacheHitNoFMP|feature211' -count=1
cd services/xstockstrat-marketdata && GOWORK=off COVERPKGS=$(GOWORK=off go list ./... | grep -Ev '/(cmd|handler|repository|telemetry|service)(/|$)' | tr '\n' ',' | sed 's/,$//') && GOWORK=off go test ./... -race -count=1 -coverprofile=coverage.out -covermode=atomic -coverpkg="${COVERPKGS}" && go tool cover -func=coverage.out | grep "^total:"   # confirm >= 40%
cd services/xstockstrat-marketdata && GOWORK=off golangci-lint run --modules-download-mode=mod
```
The new logic is in the excluded `service` package. The CI total must still be at least 40% (C-08).

---

### Step 9 — service: D-53a — one shared `decodeExtraMetrics` helper

**Status**: `pending`
**Service**: `xstockstrat-marketdata`
**Files**:
- `services/xstockstrat-marketdata/internal/repository/marketdata_repo.go` — modify

**Reviewers**: xstockstrat-marketdata owner — OHLCV ingestion integrity, TimescaleDB hypertable partitioning, Alpaca feed idempotency

**Codebase Evidence**:
- Three silent decodes: `:546-549` (`GetFundamentals`), `:834-837` (`QueryHistoricalFundamentals`) and `:887-890`
  (`LatestHistoricalFundamental`). Each is `extra := map[string]float64{}; if len(extraJSON) > 0 { _ =
  json.Unmarshal(extraJSON, &extra) }`.
- The scanned symbol local is `sym` in all three functions: the `var (...)` blocks at `:534`, `:824` and `:873`, scanned
  as `&sym` at `:539`, `:830` and `:879`.
- `GetFundamentals` reads through `r.pool.QueryRow` (`:531`), so pgxmock cannot reach it. `r.db` is the mockable
  surface (`:32-34`).

**TDD**: `red-green required`

**Covers**: —

**Instructions**:
1. Add an unexported `func decodeExtraMetrics(ctx context.Context, symbol string, raw []byte) map[string]float64`. It
   returns an empty map for an empty `raw`. On a decode error it calls
   `slog.WarnContext(ctx, "fundamentals extra_metrics decode failed", "symbol", symbol, "error", err)` and returns
   the empty map. The `json.Unmarshal` error names a type mismatch and carries no secret. Add `log/slog` to the
   imports if it is absent.
2. Replace the three blocks with `extra := decodeExtraMetrics(ctx, sym, extraJSON)`. Use the scanned symbol variable
   `sym` at all three sites. Each function scans the row's symbol into a local `sym`: `GetFundamentals` declares it
   at `:534`, `QueryHistoricalFundamentals` at `:824` and `LatestHistoricalFundamental` at `:873`.
3. In `GetFundamentals` (`:531`), switch `r.pool.QueryRow` to `r.db.QueryRow`. It is the same pool in production, and
   the switch makes AC-6 testable through the RPC read (Step 10).
4. One helper, not three copies (C-18).

**Verification**:
```bash
grep -n "_ = json.Unmarshal(extraJSON" services/xstockstrat-marketdata/internal/repository/marketdata_repo.go   # no hits
grep -c "decodeExtraMetrics(" services/xstockstrat-marketdata/internal/repository/marketdata_repo.go           # 4 (1 def + 3 uses)
cd services/xstockstrat-marketdata && GOWORK=off go build ./...
```

---

### Step 10 — test: an undecodable extra column is logged (AC-6)

**Status**: `pending`
**Service**: `xstockstrat-marketdata`
**Files**:
- `services/xstockstrat-marketdata/internal/repository/marketdata_repo_test.go` — modify

**Reviewers**: xstockstrat-marketdata owner — OHLCV ingestion integrity, TimescaleDB hypertable partitioning, Alpaca feed idempotency

**Codebase Evidence**:
- pgxmock pattern: `repo := &MarketDataRepo{db: mock}` (`internal/repository/marketdata_repo_test.go:125`).
  `TestQueryHistoricalFundamentals_Pagination` (`:211`) shows row scans with `pgxmock.NewRows`.
- `fundamentalsColumns` (`marketdata_repo.go:526`) gives 17 columns. `extra_metrics` is the 14th.
- No WARN-capture helper exists in the `repository` package. `recordingWarnHandler`
  (`internal/service/marketdata_service_test.go:1547`) belongs to package `service`, so it cannot be imported.

**TDD**: `red-green required`

**Covers**: `AC-6`

**Instructions**:
1. Add `TestGetFundamentals_UndecodableExtraIsLogged_AC6`. Expect the `FROM marketdata.fundamentals WHERE symbol =
   \$1` query with `WithArgs("AAPL")`, and return one row whose `extra_metrics` is `[]byte(`{"total_debt":"n/a"}`)`.
   That is the refined AC-6 input: valid jsonb whose value does not decode into `map[string]float64`. Capture slog
   with `slog.SetDefault(slog.New(slog.NewTextHandler(&buf, nil)))` and restore it in `t.Cleanup`, without
   `t.Parallel()`. Assert:
   - `found == true`;
   - `len(f.ExtraMetrics) == 0`;
   - `buf` contains `fundamentals extra_metrics decode failed`, `symbol=AAPL` and an `error=` attribute.
2. Add `TestDecodeExtraMetrics`, a table test over valid, empty and type-mismatch inputs. The mismatch case covers
   the two historical-read call sites through the shared helper.
3. C-13: the row is a single-consumer inline literal. The stdlib `slog.NewTextHandler` capture adds no new shared
   helper.

**Verification**:
```bash
cd services/xstockstrat-marketdata && GOWORK=off go test ./internal/repository/ -run 'UndecodableExtra|DecodeExtraMetrics' -count=1 -v
cd services/xstockstrat-marketdata && GOWORK=off COVERPKGS=$(GOWORK=off go list ./... | grep -Ev '/(cmd|handler|repository|telemetry|service)(/|$)' | tr '\n' ',' | sed 's/,$//') && GOWORK=off go test ./... -race -count=1 -coverprofile=coverage.out -covermode=atomic -coverpkg="${COVERPKGS}" && go tool cover -func=coverage.out | grep "^total:"   # confirm >= 40%
cd services/xstockstrat-marketdata && GOWORK=off golangci-lint run --modules-download-mode=mod
```
The new logic is in the excluded `repository` package. The CI total must still be at least 40% (C-08).

---

### Step 11 — service: D-53b (client) — classify enrichment failures, set `EnrichmentFailed` and emit one aggregated WARN

**Status**: `pending`
**Service**: `xstockstrat-marketdata`
**Files**:
- `services/xstockstrat-marketdata/internal/source/source.go` — modify
- `services/xstockstrat-marketdata/internal/fmp/fmp_client.go` — modify

**Reviewers**: xstockstrat-marketdata owner — OHLCV ingestion integrity, TimescaleDB hypertable partitioning, Alpaca feed idempotency

**Codebase Evidence**:
- `internal/source/source.go:62-64`: the transient `Sector string` field with the comment "transient (not persisted)".
  The `FundamentalsSource` interface does not change.
- `internal/fmp/fmp_client.go:192-200`: the enrichment loop drops the errors.
  `if r, rErr := c.fetchRatios(ctx, sym); rErr == nil && r != nil { r.apply(f) }` and the same for `fetchProfile`.
- `getJSON` error sites:
  - `:229` `fmt.Errorf("fmp: rate limiter: %w", err)`, which can wrap ctx errors;
  - `:232-234` `reserve()` returns `ErrFMPDailyCapExceeded` unwrapped;
  - `:243` `fmt.Errorf("fmp: %s request failed: %w", path, err)` wraps the `*url.Error`, whose text **carries
    `apikey=`** (the URL is built at `:222-223`);
  - `:251` read failure;
  - `:254-255` non-200, `fmt.Errorf("fmp: %s returned HTTP %d", path, resp.StatusCode)`;
  - `:258` decode failure.
- `nil, nil` for an empty array is a success: `fetchRatios` `:280-282` and `fetchProfile` `:293-295`.
- The client has no `slog` import today (`grep -n slog internal/fmp/fmp_client.go` → none).
- The key-leak guard analogue is `TestHTTPError_DoesNotLeakAPIKey` (`internal/fmp/fmp_client_test.go:171`).

**TDD**: `red-green required`

**Covers**: —

**Instructions**:
1. `source.go`: next to `Sector`, add `EnrichmentFailed bool` with a ≤2-line comment: transient, not persisted;
   true means a transient enrichment failure, so the cache stores the row already expired.
2. `fmp_client.go`:
   - Add an unexported `type statusError struct{ path string; code int }`, with
     `Error() = fmt.Sprintf("fmp: %s returned HTTP %d", e.path, e.code)`. That text is byte-identical to `:255`, and
     it carries no URL and no apikey. Return `&statusError{path, resp.StatusCode}` at `:255`. The existing callers
     only `%w`-wrap the error or test it with `errors.Is`, so they are unaffected
     (`marketdata_service.go:1696`/`:1749`).
   - Add an unexported `func enrichmentExpires(err error) bool`. It checks, in this order (design 5.2):
     1. `nil` → false.
     2. `errors.Is(err, ErrFMPDailyCapExceeded)` → true.
     3. `errors.Is(err, context.Canceled) || errors.Is(err, context.DeadlineExceeded)` → true. This check must come
        before any transport classification, because `:229` and `:243` wrap ctx errors.
     4. `var se *statusError; errors.As(err, &se)`, then `switch se.code { case 402, 403, 404: return false }`. This
        is the only home of the exempt codes (C-18, F-07): no list and no tunable.
     5. Anything else → true.
   - Add an unexported `type stageError struct{ stage string; err error }`. `Error()` returns `e.err.Error()` and
     `Unwrap()` returns `e.err`. Wrap the existing `fmt.Errorf` values at `:243` (`stage: "transport"`), `:251`
     (`"read"`) and `:258` (`"decode"`), so each error text stays byte-identical and the `%w` chain to ctx errors
     is kept. This choice is pinned: `io.ReadAll` and `json.Unmarshal` errors share no type a classifier could
     match without string matching.
   - Add an unexported `func enrichmentClass(err error) string`, evaluated in the same order. It returns `cap`,
     `ctx`, `http_<code>`, or the `stage` of an `errors.As`-matched `*stageError` (`transport`, `read`, `decode`).
     It classifies by `errors.Is`/`errors.As` only, never by string matching. Errors with no stage (`:226` build
     request, and a non-ctx limiter error at `:229`) still expire under rule 5. Their class label is an open
     operator question (context.md Open Threads); the executor must not invent one silently.
   - Rewrite the loop at `:192-200`. Call `fetchRatios` and `fetchProfile`, and apply each on success with a non-nil
     result, as today. On a non-nil error, append `SYM:ratios:<class>` or `SYM:profile:<class>` to a local
     `failures []string`. Set `f.EnrichmentFailed = true` only when `enrichmentExpires(err)`.
   - After the loop, when `len(failures) > 0`, emit exactly one
     `slog.WarnContext(ctx, "fmp enrichment failed", "failures", failures, "count", len(failures))`. Deterministic
     4xx pairs are included. Never log `err.Error()`.
   - Context: the loop's `ctx` is the inbound request ctx, so the WARN carries the trace (operator standing C-03
     rule).
3. Do not change `reserve()`/`refund()` (@feature-217 @AC-4) or the empty-array success path.

**Verification**:
```bash
cd services/xstockstrat-marketdata && GOWORK=off go build ./... && GOWORK=off go vet ./internal/fmp/ ./internal/source/
grep -n "rErr == nil && r != nil\|pErr == nil && p != nil" services/xstockstrat-marketdata/internal/fmp/fmp_client.go   # no hits
grep -n "case 402, 403, 404" services/xstockstrat-marketdata/internal/fmp/fmp_client.go                                # exactly 1
grep -n "err.Error()\|\"error\", rErr\|\"error\", pErr" services/xstockstrat-marketdata/internal/fmp/fmp_client.go     # none in the WARN
```

---

### Step 12 — test: FMP enrichment classification, flag and WARN (AC-5, AC-10, client half)

**Status**: `pending`
**Service**: `xstockstrat-marketdata`
**Files**:
- `services/xstockstrat-marketdata/internal/fmp/fmp_client_test.go` — modify
- `services/xstockstrat-marketdata/internal/fmp/fmp_gateway_test.go` — modify

**Reviewers**: xstockstrat-marketdata owner — OHLCV ingestion integrity, TimescaleDB hypertable partitioning, Alpaca feed idempotency

**Codebase Evidence**:
- `recordingRT.respond func(path string) (int, string)` (`internal/fmp/fmp_client_test.go:16-33`) sets the status
  per path. `newTestClient` (`:47`) uses `APIKey: "SECRET-KEY"` and no `Limits`.
- `gatewayClient(rt, rps, dailyCap, now)` (`internal/fmp/fmp_gateway_test.go:27`) sets a live cap. Analogues:
  `TestGateway_CapExceededMakesNoCall` (`:86`) and `TestGateway_BudgetRefundOn503_AC4` (`:70`).
- The paths are `/stable/quote`, `/stable/ratios-ttm` and `/stable/profile` (`fmp_client.go:266`, `:277`, `:290`).

**TDD**: `red-green required`

**Covers**: `AC-5, AC-10`

**Instructions**:
1. AC-5 (client half): `TestEnrichment_ProfileCapExceeded_FlagsAndWarns_AC5`. Use `gatewayClient` with `Metrics
   []string{"core","extended"}` (or construct `NewClient` with `Limits` and `Metrics` directly, since
   `gatewayClient` takes no metrics) and `dailyCap = 2`. Then quote takes slot 1, ratios takes slot 2, and profile
   gets `ErrFMPDailyCapExceeded`. Assert:
   - `f.EnrichmentFailed == true` and `f.Beta == nil`;
   - zero HTTP calls to `/stable/profile`;
   - exactly one WARN with the message `fmp enrichment failed`, whose `failures` contains `AAPL:profile:cap`. Capture
     it with `slog.NewTextHandler` into a buffer and restore in `t.Cleanup`.
2. AC-10 (client half): `TestEnrichment_Profile503_FlagsTransient_AC10`. Quote and ratios return 200 and profile
   returns 503. Assert `EnrichmentFailed == true`, `Beta == nil`, the ratios fields set, and `failures` containing
   `AAPL:profile:http_503`.
3. 4xx exemption (operator r3 (2)): a table test over profile 404 and ratios 402. Also 403, which is the Open Risk
   case, so add a comment that it is operator-sanctioned. Assert `EnrichmentFailed == false`, the matching metric
   pointers nil, and the pair present in the WARN with class `http_<code>`.
4. One test per class: `cap`, `ctx` (cancel ctx inside `respond` for the profile path, or use an expired deadline),
   `http_500`, `transport` (a RoundTripper that returns an error), `read` (a body whose `Read` errors) and `decode`
   (`[{`). Every one except `http_4xx` sets the flag. Unassigned 400, 401 and 429 set the flag (Open Risk,
   acknowledged with r4).
5. No apikey in the log: on a transport-failure enrichment, assert that the captured WARN buffer does **not** contain
   `SECRET-KEY` or `apikey`.
6. Success is not a failure: an empty `[]` profile body gives `EnrichmentFailed == false` and no WARN.
7. Assert that `(&statusError{path: "/stable/profile", code: 503}).Error() == "fmp: /stable/profile returned HTTP 503"`,
   which keeps `TestHTTPError_DoesNotLeakAPIKey` (`:171`) true.
8. C-13: the response bodies are per-test inline literals with one consumer each.

**Verification**:
```bash
cd services/xstockstrat-marketdata && GOWORK=off COVERPKGS=$(GOWORK=off go list ./... | grep -Ev '/(cmd|handler|repository|telemetry|service)(/|$)' | tr '\n' ',' | sed 's/,$//') && GOWORK=off go test ./... -race -count=1 -coverprofile=coverage.out -covermode=atomic -coverpkg="${COVERPKGS}" && go tool cover -func=coverage.out | grep "^total:"   # confirm >= 40%
cd services/xstockstrat-marketdata && GOWORK=off golangci-lint run --modules-download-mode=mod
```

---

### Step 13 — service: D-53b (store) — expire on write, same-source merge and the trace-carrying write ctx

**Status**: `pending`
**Service**: `xstockstrat-marketdata`
**Files**:
- `services/xstockstrat-marketdata/internal/repository/marketdata_repo.go` — modify
- `services/xstockstrat-marketdata/internal/service/marketdata_service.go` — modify

**Reviewers**: xstockstrat-marketdata owner — OHLCV ingestion integrity, TimescaleDB hypertable partitioning, Alpaca feed idempotency

**Codebase Evidence**:
- `UpsertFundamentals` (`internal/repository/marketdata_repo.go:574-612`). The doc comment at `:572-573` says
  "bumping fetched_at to now()". VALUES ends `$16, now())` (`:593`). The enrichment columns in the conflict branch
  are at `:595-597`: `pb_ratio`, `dividend_yield`, `roe`, `debt_to_equity`, `beta`. `fetched_at=now()` is at `:600`.
  Exec binds 16 args (`:605-607`). The `::jsonb` string-bind lesson is at `:582-584` (ledger
  `fails.md` 2026-09-01 feature 142).
- `fetched_at` readers. `grep -rn "fetched_at"` over services gives only `marketdata_repo.go` (`:526` scan columns,
  `:592`/`:600` upsert, `:660`/`:672` counts). `Fundamentals` on the wire has no fetched_at field
  (`packages/proto/marketdata/v1/marketdata.proto:221-242`), so no C-14 consumer can display a 1970 value. This
  closes the design's pre-Step-5 reader grep.
- Service write blocks:
  - multi (`internal/service/marketdata_service.go:1706-1713`): `UpsertFundamentals(ctx, f)`; `slog.Warn(...)` at
    `:1708`; `s.seedFromProfile(ctx, ...)` at `:1710`; `s.maybeAlertQuota(ctx, s.quotaCountAfterFetch(ctx, ...))` at
    `:1713`;
  - single (`:1762-1766`): the same, with `slog.Warn` at `:1763`.
- `edgarFinish` (`:1876-1885`) builds the snapshot through `edgarSnapshotFromPeriod`, which never sets the flag.

**TDD**: `red-green required`

**Covers**: —

**Instructions**:
1. Repo SQL (design 5.4 and 5.5):
   - VALUES: replace `now()` with `CASE WHEN $17::boolean THEN 'epoch'::timestamptz ELSE now() END`.
   - Conflict branch: `fetched_at=EXCLUDED.fetched_at`.
   - Each of `pb_ratio`, `dividend_yield`, `roe`, `debt_to_equity` and `beta` becomes
     `<col>=CASE WHEN $17::boolean AND fundamentals.source = EXCLUDED.source THEN COALESCE(EXCLUDED.<col>, fundamentals.<col>) ELSE EXCLUDED.<col> END`.
     `fundamentals` is the target table's name, which Postgres uses for the conflicting row.
   - Every other column, including `as_of` and `source`, is still overwritten.
   - Append `f.EnrichmentFailed` as the 17th Exec arg. The `::boolean` cast is mandatory: under `QueryExecModeExec`
     the wire OID is inferred, per the ledger rule above. There is no signature change and no tunable (F-07).
   - Rewrite the `:572-573` comment in ≤2 lines: a flagged row is stored already expired, and a same-source overwrite
     keeps last-known-good enrichment.
2. Service (design 5.6): in each write block, create `wctx := context.WithoutCancel(ctx)` once and use it for
   `UpsertFundamentals`, `seedFromProfile`, `maybeAlertQuota` and `quotaCountAfterFetch`. Change `slog.Warn` at
   `:1708`/`:1763` to `slog.WarnContext(wctx, ...)`. `WithoutCancel` keeps the inbound values (trace and propagated
   metadata), as the operator standing C-03 rule requires. Never use `context.Background()`. Do not edit
   `classification_service.go` (C-18).
3. Do not change the read paths. A flagged row fails the TTL check at `:1676`/`:1734` on the next call, and at the
   cap it is served stale (`:1690-1702`, `:1743-1752`). This preserves @feature-215 @AC-7 (design 5.7).

**Verification**:
```bash
grep -n "\$17::boolean" services/xstockstrat-marketdata/internal/repository/marketdata_repo.go     # VALUES + 5 merge columns
grep -n "fetched_at=EXCLUDED.fetched_at" services/xstockstrat-marketdata/internal/repository/marketdata_repo.go
grep -n "context.WithoutCancel(ctx)" services/xstockstrat-marketdata/internal/service/marketdata_service.go   # 2 new (multi + single)
grep -n 'slog.Warn("GetFundamentals' services/xstockstrat-marketdata/internal/service/marketdata_service.go   # no hits
cd services/xstockstrat-marketdata && GOWORK=off go build ./...
```

---

### Step 14 — test: expired storage, re-fetch, stale at the cap, 4xx kept fresh, cancel survival and SQL pins (AC-5, AC-10, store half)

**Status**: `pending`
**Service**: `xstockstrat-marketdata`
**Files**:
- `services/xstockstrat-marketdata/internal/service/marketdata_service_test.go` — modify
- `services/xstockstrat-marketdata/internal/repository/marketdata_repo_test.go` — modify
- `services/xstockstrat-marketdata/internal/repository/fundamentals_livedb_test.go` — create

**Reviewers**: xstockstrat-marketdata owner — OHLCV ingestion integrity, TimescaleDB hypertable partitioning, Alpaca feed idempotency

**Codebase Evidence**:
- `fakeFundRepo.UpsertFundamentals` (`internal/service/marketdata_service_test.go:201-207`) stores `time.Now()` and
  ignores ctx.
- `fakeFundSource` (`:220-249`) returns a copy of `resp` per symbol, so `EnrichmentFailed` set on `resp` propagates.
- Budget: `fakeBudget{used, cap}` (`:2035-2037`). It is fixed, so a test switches `svc.fmpBudget` between calls to
  model "cap reached" and "quota reset".
- `isStringArg` matcher (`internal/repository/marketdata_repo_test.go:105-110`). Arg-index pattern: `anyArgs :=
  make([]any, 16)` (`:127`).
- Live DB: **Not found**. marketdata has no real-Postgres test harness.
  - `grep -rn "t.Skip" --include=*_test.go` over the Go services finds no DB-gated skip.
  - `DB_PGBOUNCER` is read only at `internal/repository/pool.go:31`.
  - The DB URL env is `DATABASE_URL` (`internal/config/config.go:43`).
  - The test is created from scratch and env-gated.

**TDD**: `red-green required`

**Covers**: `AC-5, AC-10`

**Instructions**:
1. Make the fake flag-, merge- and ctx-aware:
   - `UpsertFundamentals(ctx, f)` returns `ctx.Err()` when ctx is done.
   - When `f.EnrichmentFailed`, it stores `fetchedAt = time.Unix(0, 0)`, and if the prior row has the same `Source`,
     it COALESCEs `PBRatio`, `DividendYield`, `ROE`, `DebtToEquity` and `Beta` from the prior row.
   - Otherwise it stores `time.Now()`.
2. AC-5 (store half): `TestGetFundamentals_EnrichmentFailedStoredExpired_AC5`.
   - Use provider "fmp", `fmpBudget = fakeBudget{0, 250}`, and a source `resp` with
     `{Source: "fmp", Price: f64p(1), EnrichmentFailed: true}` and `Beta` nil.
   - Call 1: `missing_metrics` contains `"beta"`, `!Stale`, and the stored `fetchedAt` is the epoch.
   - Call 2, still within `cache_ttl_hours`: `src.calls == 2`. The source is called again, which shows the row is not
     fresh. This models "after the quota resets, the profile fetch is made again".
3. A 503 sibling with the same assertions: `TestGetFundamentals_TransientEnrichment503StoredExpired`.
4. AC-10: `TestGetFundamentals_TransientOverEdgarRow_AC10`.
   - Use `snapshot_source "vendor"` and provider "fmp". Seed `repo.rows["AAPL"]` with `{Source: "edgar"}`, fetched 1
     minute ago. Set source `resp` to `{Source: "fmp", PBRatio: f64p(3), EnrichmentFailed: true}` with `Beta` nil.
   - Call 1: `!Stale`, `PbRatio == 3`, `missing_metrics ∋ "beta"`, the stored row `Source == "fmp"` with an epoch
     `fetchedAt`, and no edgar values carried over, because the merge needs the same source.
   - Set `svc.fmpBudget = fakeBudget{250, 250}`. Call 2: `src.calls == 1` (no HTTP), `Stale`, `Source == "fmp"`.
   - Set `svc.fmpBudget = fakeBudget{0, 250}`. Call 3: `src.calls == 2`.
5. Same-source merge: a prior fmp row with `Beta: f64p(1.2)` plus a flagged fetch with `Beta` nil leaves the stored
   `Beta == 1.2`. The response built from the in-memory struct still lists `beta` in `missing_metrics` (design 5.5:
   honest current response). An unflagged overwrite stores nil.
6. 4xx kept fresh (operator r3 (2)): a flag-false fetch with `Beta` nil stores a non-epoch `fetchedAt`. The next call
   within the TTL makes no source call, and `missing_metrics ∋ "beta"`.
7. Cancel survival (design 5.6): a fake source whose `GetFundamentals` cancels the request ctx before returning.
   Assert that the row was upserted, `repo.upserts == 1`, which proves `wctx`.
8. SQL pins, in `marketdata_repo_test.go`:
   - Widen the existing `TestUpsertFundamentals_CastsExtraMetricsToJSONB` arg list to 17. It stays a string-bind pin
     on `$14`.
   - `TestUpsertFundamentals_ExpireAndSameSourceMerge` matches regexes for
     `CASE WHEN \$17::boolean THEN 'epoch'::timestamptz ELSE now\(\) END`, `fetched_at=EXCLUDED.fetched_at` and
     `beta=CASE WHEN \$17::boolean AND fundamentals.source = EXCLUDED.source THEN COALESCE\(EXCLUDED.beta, fundamentals.beta\)`,
     with the 17th arg `true`.
9. Live-DB test (design 5.9; ledger `fails.md` 2026-09-01, where pgxmock cannot prove wire OIDs). Create
   `internal/repository/fundamentals_livedb_test.go` with `TestUpsertFundamentals_LiveDB_EpochAndSeed`.
   - It runs `t.Skip` unless `DATABASE_URL` is set and points at a migrated schema. It sets
     `t.Setenv("DB_PGBOUNCER", "true")` before `NewMarketDataRepo`, so `QueryExecModeExec` is exercised.
   - Upsert a flagged `fmp` row: `fetched_at` reads back as `1970-01-01T00:00:00Z`.
   - Seed 30 `edgar` rows with `as_of` today: `CountFundamentalsFetchedToday(ctx, "fmp") == 0`.
   - With an epoch-stamped `fmp` row whose `as_of` is today, it is counted (`== 1`).
   - Delete the test symbols in `t.Cleanup`. Use a unique symbol prefix such as `ZZ255_`.
   - CI has no DB, so it skips there. `/sdd-execute` never starts a DB (spec-template §Migration step verification,
     same rule).
   - **Mandatory:** the step PR body records whether this test ran against a real Postgres, on which environment,
     and its PASS/SKIP output. A Step 14 PR without that record fails this step's verification. If no DB was
     available, record it as an unproven-in-CI Open Thread in context.md.
10. C-13: each row literal has one consumer, so it stays inline. No second copy of a domain literal.

**Verification**:
```bash
cd services/xstockstrat-marketdata && GOWORK=off COVERPKGS=$(GOWORK=off go list ./... | grep -Ev '/(cmd|handler|repository|telemetry|service)(/|$)' | tr '\n' ',' | sed 's/,$//') && GOWORK=off go test ./... -race -count=1 -coverprofile=coverage.out -covermode=atomic -coverpkg="${COVERPKGS}" && go tool cover -func=coverage.out | grep "^total:"   # confirm >= 40%
cd services/xstockstrat-marketdata && GOWORK=off go test ./internal/repository/ -run LiveDB -count=1 -v   # SKIP without DATABASE_URL
cd services/xstockstrat-marketdata && GOWORK=off golangci-lint run --modules-download-mode=mod
```
The new logic is in the excluded `repository` and `service` packages, so no coverage threshold applies to it. The
total must still be at least 40%.

---

### Step 15 — service: D-19 — stream manager ctx, URL seam, healthy-session reset, cancellable backoff and give-up close

**Status**: `pending`
**Service**: `xstockstrat-marketdata`
**Files**:
- `services/xstockstrat-marketdata/internal/alpaca/stream.go` — modify

**Reviewers**: xstockstrat-marketdata owner — OHLCV ingestion integrity, TimescaleDB hypertable partitioning, Alpaca feed idempotency

**Codebase Evidence**:
- `streamManager` struct (`internal/alpaca/stream.go:60-67`): `cfg`, `mu`, `subs`, `nextID`, `running`. It has no ctx
  and no URL field. It is constructed in `streamMgr()` (`:70-75`).
- `add()` (`:107-133`): the per-sub goroutine at `:121-132` deletes from `subs` under `m.mu`, then closes `barCh` and
  `quoteCh` **outside the lock and without an ownership check**.
- `run()` (`:137-174`):
  - `attempts := 0` at `:147` is never reset;
  - `attempts++` at `:163`;
  - the give-up at `:165-170` logs `slog.Error("alpaca stream giving up after max reconnects", "max", ...)` and only
    sets `running=false`;
  - `time.Sleep` at `:172`.
- `connectAndRead()` (`:178-235`):
  - the URL is hardcoded at `:183`, `wss://stream.data.alpaca.markets/v2/%s`;
  - `context.WithCancel(context.Background())` at `:185`;
  - the read loop at `:217-234` calls `m.dispatch`.
  
  `dispatch` handles `"success", "subscription"` as a no-op (`:270-271`).
- Consumers observe the channel close: `StartBarStream`/`StartQuoteStream` range over the feed and then emit
  `marketdata.feed.disconnected` (`internal/service/marketdata_service.go:1493-1517`, `:1528`).
- `github.com/coder/websocket v1.8.14` is in `go.mod:7`.
- Background loop with no originating request: under the operator standing rule it may mint its own ctx.

**TDD**: `red-green required`

**Covers**: —

**Instructions**:
1. Add the fields `ctx context.Context`, `stop context.CancelFunc` and `streamURL string` to `streamManager`. In
   `streamMgr()`, set `ctx, stop = context.WithCancel(context.Background())`, which is the manager-owned ctx. Add an
   unexported `func (m *streamManager) baseCtx() context.Context` that returns `context.Background()` when `m.ctx` is
   nil, so the literal in `TestDispatchBarCarries1MinEnum` (`stream_test.go:20`) stays valid.
2. `connectAndRead`:
   - Build the URL from `m.streamURL` when it is non-empty, otherwise from the existing `wss://…/v2/%s` default.
   - Derive its ctx from `m.baseCtx()` instead of `context.Background()` (`:185`).
   - Change the return to `(healthy bool, err error)`. `healthy` becomes true once a decoded frame contains
     `T == "subscription"`, which is the subscribe ack. This is the design's healthy-session definition and its
     Open Risk assumption.
3. `run()`:
   - When `connectAndRead` returns an error after a healthy session, reset `attempts = 0` before `attempts++`, so the
     counter counts **consecutive** failures only.
   - Replace `time.Sleep` with
     `select { case <-m.baseCtx().Done(): <set running=false>; return; case <-time.After(delay): }`.
   - On give-up, keep the ERROR log with the `"max"` attribute, name the budget in the message, and call
     `m.closeAllLocked()` under `m.mu` before `running=false`.
4. Add `closeAllLocked()`. Under `m.mu`, for each `id, sub` it does `delete(m.subs, id)` and then closes the sub's
   non-nil channel.
5. Change the `add()` goroutine to take `m.mu`, check `if _, ok := m.subs[id]; ok`, and only then delete and close the
   channels while it still holds the lock. A sub already closed by `closeAllLocked` is skipped, so no channel is
   closed twice (recon §Risks).
6. Leave `TIMEFRAME_1MIN` in `dispatch` untouched (@feature-196 @AC-3). This is broker-agnostic market-data stream
   code: `BrokerType` routing and order paths are unaffected.

**Verification**:
```bash
grep -n "time.Sleep" services/xstockstrat-marketdata/internal/alpaca/stream.go     # no hits
grep -n "closeAllLocked\|streamURL\|attempts = 0" services/xstockstrat-marketdata/internal/alpaca/stream.go
cd services/xstockstrat-marketdata && GOWORK=off go build ./... && GOWORK=off go vet ./internal/alpaca/
```

---

### Step 16 — test: Alpaca reconnect budget reset and give-up close (AC-7, AC-8)

**Status**: `pending`
**Service**: `xstockstrat-marketdata`
**Files**:
- `services/xstockstrat-marketdata/internal/alpaca/stream_test.go` — modify

**Reviewers**: xstockstrat-marketdata owner — OHLCV ingestion integrity, TimescaleDB hypertable partitioning, Alpaca feed idempotency

**Codebase Evidence**:
- `internal/alpaca/stream_test.go` is in-package (`package alpaca`, `:1`) and has only `TestDispatchBarCarries1MinEnum`
  (`:20`).
- No websocket test server exists in the repo: **Not found**. Build one from `net/http/httptest` plus
  `websocket.Accept` (`github.com/coder/websocket`, `go.mod:7`).
- `ClientConfig.ReconnectDelayMs` and `MaxReconnects` (`internal/alpaca/client.go:47-48`).

**TDD**: `red-green required`

**Covers**: `AC-7, AC-8`

**Instructions**:
1. Add a local helper `newStreamTestServer(t, behave func(conn *websocket.Conn) )`, an `httptest.NewServer` whose
   handler calls `websocket.Accept` and then `behave`. It has one consumer file, so it stays a local helper (C-13
   applies to domain data, not harness code). Build the `streamManager` with `cfg{MaxReconnects: 3,
   ReconnectDelayMs: 1}`, `streamURL = "ws" + strings.TrimPrefix(srv.URL, "http")`, a manager ctx, and `subs`.
2. AC-7: `TestStreamManager_BudgetResetsAfterHealthySession_AC7`. The server reads the auth and subscribe frames,
   writes `[{"T":"subscription"}]`, then closes. It does this 4 times, counted with an atomic. Subscribe one bar
   subscriber. Assert that the server sees a 5th connection, which is the reconnect after the fourth drop, and that
   the subscriber channel is still open. Cancel the manager ctx in `t.Cleanup`.
3. AC-8: `TestStreamManager_GiveUpClosesSubscribers_AC8`. The server accepts and immediately closes before any
   `subscription` ack. That is three consecutive unhealthy failures with `MaxReconnects 3`. Assert that `<-barCh`
   returns `ok == false` within a timeout. Also assert that the ERROR log names the exhausted budget: capture it with
   `slog.NewTextHandler` at `LevelError` into a buffer, look for `giving up` plus `max=3`, and restore in
   `t.Cleanup`.
4. No double close: after the give-up, cancel the subscriber's own ctx and wait briefly. The test must not panic, and
   it must be run under `-race`.
5. Cancellable backoff: with a large `ReconnectDelayMs`, cancel the manager ctx during the backoff. `run` returns
   promptly and sets `running == false`.
6. `TestDispatchBarCarries1MinEnum` stays green, unchanged.

**Verification**:
```bash
cd services/xstockstrat-marketdata && GOWORK=off COVERPKGS=$(GOWORK=off go list ./... | grep -Ev '/(cmd|handler|repository|telemetry|service)(/|$)' | tr '\n' ',' | sed 's/,$//') && GOWORK=off go test ./... -race -count=1 -coverprofile=coverage.out -covermode=atomic -coverpkg="${COVERPKGS}" && go tool cover -func=coverage.out | grep "^total:"   # confirm >= 40%
cd services/xstockstrat-marketdata && GOWORK=off go test ./internal/alpaca/ -race -count=3 -run 'StreamManager|DispatchBar' -v
cd services/xstockstrat-marketdata && GOWORK=off golangci-lint run --modules-download-mode=mod
```

---

### Step 17 — test: consumer-surface read-only verification (C-14)

**Status**: `pending`
**Service**: `xstockstrat-agent`, `xstockstrat-ui` (read-only, no file changes)
**Files**:
- none (verification only)

**Reviewers**: xstockstrat-agent owner — MCP tool contract stability (name, parameters, return shape); xstockstrat-ui owner — analytics display accuracy, Connect-RPC call safety

**Codebase Evidence**:
- `services/xstockstrat-agent/app/tools.py`:
  - `query_fundamentals` at `:401-402`; `screen_symbols` at `:811-812`;
  - `missing_metrics` is read as authoritative at `:302-304` (MARKETDATA-11) and passed through at `:438`.
- `services/xstockstrat-ui/src/lib/traderBff.ts:77` `getFundamentals: forward(...)`, and
  `services/xstockstrat-ui/src/lib/insightsBff.ts:102` (`getFundamentals`) and `:113` (`getFundamentalsMulti`).
  These are pass-through forwards with no field mapping.
- Existing agent tests: `services/xstockstrat-agent/tests/test_fundamental_metrics_tool.py`.
- No proto change: `packages/proto/marketdata/v1/marketdata.proto:221-242` is unchanged.

**TDD**: `N/A (no code change: the served shape and status codes are unchanged; read-only verification of the consumers)`

**Covers**: —

**Instructions**:
1. Confirm `git diff origin/main-dev -- packages/proto/ services/xstockstrat-agent/ services/xstockstrat-ui/` is
   empty.
2. Run the agent's existing tool tests. They still pass because the tools read `missing_metrics` as authoritative,
   and more entries in it are a valid shape.
3. Confirm by grep that both BFFs only forward and do not remap `missing_metrics`, `stale` or `source`.
4. Note in the PR that analysis fundsignal (feature 246) benefits from the honest `missing_metrics`. Include the
   provenance note from FR-4(b): a merged stale row shows today's `as_of` with prior enrichment values.

**Verification**:
```bash
git diff --stat origin/main-dev -- packages/proto/ services/xstockstrat-agent/ services/xstockstrat-ui/   # empty
cd services/xstockstrat-agent && uv run pytest tests/test_fundamental_metrics_tool.py -q
grep -n "missing_metrics\|missingMetrics" services/xstockstrat-ui/src/lib/traderBff.ts services/xstockstrat-ui/src/lib/insightsBff.ts   # no remapping
```

---

## Deviation Log

_Populated by /sdd-execute as implementation proceeds._
