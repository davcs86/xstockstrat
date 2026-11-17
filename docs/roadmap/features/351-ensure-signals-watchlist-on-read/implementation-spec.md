# Implementation Spec: ensure-signals-watchlist-on-read

**Status**: `complete`
**Created**: 2026-11-17
**Feature**: `docs/roadmap/features/351-ensure-signals-watchlist-on-read/feature.md`
**Total Steps**: 6
**Feature Branch**: `feature/ensure-signals-watchlist-on-read`

---

Paths: `portfolio/` abbreviates `services/xstockstrat-portfolio/`, `agent/` abbreviates
`services/xstockstrat-agent/`. Every `path:line` below was read on the tree
`ccr-1305a9de-7x1t7v@34c34ed` (`origin/main-dev@ccbe424` merged in; no `origin/feature/ensure-signals-watchlist-on-read`
exists yet, so the session branch was the freshness target; re-verified at `4cc3d41` during
`/sdd-review impl-spec` — only `docs/` differs, so every code reference below is unchanged). Symbols marked **new** do not exist today and are
created by the step that names them. This session had no Go toolchain (`go version` tried to download
1.27.0), so no Go command below was executed here; the commands are the repo's own CI forms.

## Execution Summary

Backend only in `xstockstrat-portfolio` (Go) plus text edits in `xstockstrat-agent`; no proto, migration,
config key, env var, port, UI or Agent-contract change. The order is the design's build order
(design.md § Chosen Approach, D-11): Steps 1-4 do not depend on the `ListByUser` token fix and can run in
parallel with its session; Step 5 is the landing gate and Step 6 the integration PR content, and both
wait for the fix.

1. **Step 1** `service` — `ListWatchlists` ensures the caller's system list on a first page that lacks it
   (D-1, D-2, D-3, D-8).
2. **Step 2** `test` — the first `ListWatchlists` unit tests, with the fake-store hooks (D-9).
3. **Step 3** `test` — real-Postgres tests: concurrent ensure and the id-order proof D-2 relies on (D-9, D-12).
4. **Step 4** `docs` — the agent's "(read-only)" wording for `list_watchlists` (FR-7, AC-9).
5. **Step 5** `test` — the landing gate that proves the token fix is on `origin/main-dev` (D-10, D-11).
6. **Step 6** `docs` — promote the scenarios (C-16) and write the merge-order row (D-10(a)).

**Scenario coverage (C-15).** Every scenario in `acceptance.feature` is covered:

| Scenario | Step(s) | How |
|---|---|---|
| `@AC-1` | 2 | unit: first list creates and returns Signals |
| `@AC-2` | 2, 3 | unit: 5 sequential calls, one row, same id; dbtest: 5 concurrent `EnsureSystemManaged`, one row |
| `@AC-3` | 2 | unit: continuation token never ensures; mutation-red recorded |
| `@AC-4` | 2 | unit: ensure error is fail-open with the original error in the WARN |
| `@AC-5` | 2 | unit: existing system list is not re-ensured (`ensureCalls == 0`); mutation-red recorded |
| `@AC-6` | 2 | unit: same-named manual list coexists; delete stays `FailedPrecondition` |
| `@AC-7` | 2 | unit: `page_size 1`, exactly one system row, no second row on a repeat call |
| `@AC-8` | 2 | unit: no identity → `InvalidArgument`, no write; mutation-red recorded |
| `@AC-9` | 4 | `docs`: grep of the three wording sites plus the existing agent guard tests (D-9: "checked at review plus the agent guard test") |
| `@AC-10` | 2 | unit: pure characterization of the cap (no code change) |

**Consumer surfaces (C-14).** Named in the product spec: UI `/insights` watchlists (no code change —
operator decision recorded in `context.md`; effects accepted in design.md Open Risks), Agent
`list_watchlists` (text only, Step 4), analysis callers (unchanged). Step 4 touches the tool-definition
file `agent/app/tools.py`, so the Agent surface is reached; it is categorised `docs` because FR-7 changes
wording only and no executable line changes. No `PLATFORM_SUBNAV` change (no new page, C-10(a)).

**Trading domain (step-constraints §A).** Not trading-domain: no order, broker, fill or `TRADING_MODE`
code is touched.

**Header propagation (C-03).** No step adds an outbound gRPC call. Step 1's ensure reuses the inbound
`userID` from `requireUserID` (`portfolio/internal/service/portfolio_service.go:2143-2149`) against the
database only.

**Assumptions made by this spec** (each is a choice the design left to `/sdd-spec`):

- The fake gets one hook beyond D-9's list, `ensureID` (an optional id for the ensured row). Basis: the
  fake's ids are `wl-<n>` (`watchlist_service_test.go:84,253`), which sort after every hex uuid, so
  without it D-2's skip and re-list branches cannot both be exercised.
- The re-list-failure WARN text is `"ListWatchlists: re-list after ensure failed; returning first page"`.
  Basis: D-8 requires a WARN and the original page but fixes no text; the ensure-failure text is D-3's.
- `@AC-9` is covered by a `docs` step, not a `test` step. Basis: design.md § Chosen Approach, Tests
  (`AC-9 is checked at review plus the agent guard test`).
- No wire test is added. Basis: design.md § Tests lists unit and dbtest only; the recon's optional wire
  test (`recon.md` Recommended Scope item 2) was not adopted.
- Step 5 is a `test`-category gate step with `**Covers**: —`. Basis: D-11(a) numbers it as a build step,
  and the registry has no gate category.

## Step Dependencies

- Step 2 [test] covers Step 1 [service] (C-08). `/sdd-execute` writes Step 2's tests first and captures
  RED (AC-1, 2, 4, 6, 7 fail on the pre-change tree) before applying Step 1.
- No atomic unit (`**Lands with**`): Step 1 changes no signature (`ListWatchlists` and `WatchlistStore`
  are unchanged; the helper is new and private), and Step 2 references no symbol a later step creates, so
  each step passes its own `**Verification**` on the tree that holds only the steps before it.
- Step 3 is independent of Steps 1-2 (different package) and of the token fix.
- Step 4 is independent of Steps 1-3.
- Step 5 requires Steps 1-3 and the `ListByUser` token fix on `origin/main-dev` (D-10(a), D-11(a)). It is
  expected to **fail today**: `portfolio/internal/repository/watchlist_repo.go:139` still reads
  `nextToken = wls[pageSize].WatchlistId`, and the defect report's `.status` is `open`.
- Step 6 requires Step 5's recorded output in `context.md` (design.md § Build order item 5).
- Merge order: this feature's final integration PR waits for the fix (D-10(a)); the fix has no feature
  slug or number yet (the fix session sits at `/sdd-triage`'s feature-number gate, `context.md` Open
  Threads), so the row's `<fix-slug> (<NNN>)` is filled in at Step 6. The row text in Step 6 follows
  design.md § Merge-order row, which is authoritative; D-11(b)'s register wording ("Merge order only —
  `<fix-slug>` need not be launched") is the same meaning in short form and matches rows 29-30 of
  `merge-order.md` once written as "**Hard — merge order only; … need not be launched**".
- Numbering note: design.md labels the landing gate "step 4" and the integration PR "step 5" (its own
  build order, where agent docs is step 3); this spec's Steps 1-4 are design steps 1-3 (service, tests
  split into unit and dbtest, docs) and its Step 5 / Step 6 are the design's step 4 / step 5.
- Step 5 halts, it does not fail: see the execute handoff in Step 5 (F-05).
- Overlap, rebase-only: `portfolio/internal/service/portfolio_service.go` is also named by 311, 312, 315,
  317, 323 and 326, all `spec-ready` today (`status.md` read for each). Re-check at Step 1 time that 323
  has not removed `EnsureSystemManaged` or `signalWatchlistDefaultName` and that 312 has not changed how
  `requireUserID` resolves the id. Behavioral coupling (not a file collision): feature 348 (`code-completed`)
  builds its lane symbol list by calling `list_watchlists` then `get_watchlist` over all lists
  (`348-fix-edgar-historical-fundamentals/implementation-spec.md:81,1347-1348`); the new empty Signals list
  adds no symbols, so the union is unchanged, but a recorded watchlist count can read one higher.
- AC-2's concurrency is proven at repository level (Step 3a) and sequentially at service level (Step 2):
  the fake store is a mutex-less map, so a concurrent unit test would fail under `-race` (D-9, accepted).

---

### Step 1 — service: ensure the caller's system list on a first page that lacks it

**Status**: `done`
**Service**: `xstockstrat-portfolio`
**Files**:
- `services/xstockstrat-portfolio/internal/service/portfolio_service.go` — modify

**Reviewers**: Service owner `xstockstrat-portfolio` — P&L calculation accuracy, position snapshot consistency, concurrent write safety

**Codebase Evidence**:
- Confirmed via: `sed -n 2245,2265p portfolio/internal/service/portfolio_service.go` → `ListWatchlists` is
  `requireUserID` (`:2247-2250`), page args read at `:2251-2256`, `s.watchlists.ListByUser(ctx, userID, pageSize, pageToken)`
  at `:2257`, `CodeInternal` on error at `:2258-2260`, return at `:2261-2264`.
- Confirmed via: `grep -n 'EnsureSystemManaged' portfolio/internal/service/portfolio_service.go` → the store
  interface method at `:2005` and its only caller `EnsureSignalWatchlist` at `:2211`, which passes
  `signalWatchlistDefaultName` (const at `:1982`, value `"Signals"`).
- Confirmed via: `sed -n 2143,2149p …` → `requireUserID` returns `InvalidArgument "missing user identity"`
  on an empty `middleware.FromContext(ctx).UserID`, before any store call (AC-8).
- Confirmed via: `sed -n 568,581p …` → fail-open WARN pattern to copy:
  `slog.WarnContext(ctx, "symbol servability unavailable; allowing write", "count", len(bindings), "error", err)`
  then `return bindings, nil` (`refuseUnservable`).
- Confirmed via: `sed -n 65,84p portfolio/internal/repository/watchlist_repo.go` → `EnsureSystemManaged` is
  `INSERT … ON CONFLICT (user_id) WHERE system_managed DO NOTHING RETURNING watchlist_id`, then a fallback
  `SELECT`, then `GetByID` (which also loads bindings). The conflict target is the partial unique index
  `watchlists_user_system_uidx` (`portfolio/migrations/011_watchlist_system_managed_source.up.sql:26-28`),
  so concurrent calls yield one row without a transaction (D-4).
- Confirmed via: `sed -n 107,156p …watchlist_repo.go` → `ListByUser` orders `watchlist_id ASC`, clamps
  `pageSize` ≤ 0 or > 500 to 100, and returns `nextToken = wls[pageSize].WatchlistId` (`:139`) — the token
  defect that is **not** fixed here (D-6).
- Confirmed via: `grep -n '"slices"' portfolio/internal/service/*.go` → imported only by
  `portfolio_telemetry_test.go:8`; **not** imported by `portfolio_service.go` (its import block has `"net"`
  at `:11` and `"sort"` at `:12`). `portfolio/go.mod:3` is `go 1.27.0`, so `slices.ContainsFunc` is available.
- Confirmed via: `grep -rn 'ListWatchlists\|ListByUser' --include='*.go' portfolio` → the only non-test
  caller of `ListByUser` is `ListWatchlists`; the handlers `portfolio_handler.go:182-188` (connect) and
  `:339-345` (gRPC adapter) only forward, so they stay unchanged.
- Existing pattern: `EnsureSignalWatchlist` (`portfolio_service.go:2206-2216`) calls
  `s.watchlists.EnsureSystemManaged(ctx, userID, signalWatchlistDefaultName)` and maps an error to
  `connect.NewError(connect.CodeInternal, err)`; this step does the same call but never returns the error.
- `.golangci.yml` enables `sloglint` with `context: scope`, so the WARN must be `slog.WarnContext(ctx, …)`.

**TDD**: `red-green required` (paired with Step 2; RED is Step 2's AC-1, 2, 4, 6, 7).

**Covers**: —

**Instructions**:
1. Add `"slices"` to the import block of `portfolio_service.go` between `"net"` (`:11`) and `"sort"` (`:12`).
2. In `ListWatchlists` (`:2246`), keep `requireUserID`, the page-argument reads and the `ListByUser` call and
   its `CodeInternal` error return exactly as they are. Between the error check (`:2258-2260`) and the
   `return` (`:2261`), insert:
   ```go
   if pageToken == "" && !slices.ContainsFunc(wls, (*portfoliov1.Watchlist).GetSystemManaged) {
       wls, next = s.ensureSignalListOnFirstPage(ctx, userID, pageSize, wls, next)
   }
   ```
   A non-empty `pageToken` never reaches the helper (FR-3); a first page that already holds a
   `system_managed` row never reaches it either (steady state stays at today's two round trips, D-1/R-1).
   Extend the doc comment at `:2245` by one line stating that the first page idempotently ensures the
   caller's system list (a constraint a reader would otherwise miss on a read RPC).
3. **New** private method directly after `ListWatchlists`, signature
   `func (s *PortfolioService) ensureSignalListOnFirstPage(ctx context.Context, userID string, pageSize int, wls []*portfoliov1.Watchlist, next string) ([]*portfoliov1.Watchlist, string)`.
   It never returns an error. Body, in order:
   - `ensured, err := s.watchlists.EnsureSystemManaged(ctx, userID, signalWatchlistDefaultName)`. On `err`:
     when `ctx.Err() == nil` log
     `slog.WarnContext(ctx, "ListWatchlists: ensure system watchlist failed; returning existing lists", "error", err)`,
     then `return wls, next` (fail-open, D-3; no WARN for a cancelled request).
   - Skip the re-list when the ensured row sorts after the last row on this page:
     `if next != "" && len(wls) > 0 && ensured.GetWatchlistId() > wls[len(wls)-1].GetWatchlistId() { return wls, next }`.
     Compare ids, never the token value, so the skip survives the token fix (D-2, D-8). Add a ≤ 2-line
     comment on this line: it relies on Go string order equalling Postgres uuid order, which holds because
     pgx renders canonical lowercase text (`watchlist_repo.go:585-596`, proven by Step 3(b)).
   - Otherwise re-list exactly once: `relisted, relistNext, err := s.watchlists.ListByUser(ctx, userID, pageSize, "")`.
     On `err`, WARN (when `ctx.Err() == nil`) with message
     `"ListWatchlists: re-list after ensure failed; returning first page"` and `"error", err`, and
     `return wls, next`. On success `return relisted, relistNext`.
4. Do **not** add a store method, interface change, proto/config/migration change, ledger event or
   telemetry counter (D-4, D-8, R-4). Do not touch `ListByUser`, `CountByUser` or `CreateWatchlist`
   (the cap stays as is, D-7/FR-8). Keep comments to constraints, ≤ 2 lines each (root `CLAUDE.md` § How to Act #5).

**Verification**:
```bash
cd services/xstockstrat-portfolio && GOWORK=off go build ./... && GOWORK=off go vet ./internal/service/ \
  && GOWORK=off golangci-lint run --modules-download-mode=mod && GOWORK=off go test ./internal/service/ -count=1
grep -n 'ensureSignalListOnFirstPage\|slices.ContainsFunc\|"slices"' internal/service/portfolio_service.go   # helper, call, import present
grep -n 'EnsureSystemManaged' internal/service/portfolio_service.go   # exactly: interface line, EnsureSignalWatchlist, the new helper
git diff --stat   # only portfolio_service.go (plus the spec/status files /sdd-execute stages)
```
The existing suite stays green (no existing test calls `ListWatchlists`, `grep` above); the behavior
proof is Step 2's tests going RED → GREEN.

---

### Step 2 — test: first `ListWatchlists` unit tests and fake-store hooks

**Status**: `done`
**Service**: `xstockstrat-portfolio`
**Files**:
- `services/xstockstrat-portfolio/internal/service/watchlist_service_test.go` — modify
- `docs/roadmap/features/351-ensure-signals-watchlist-on-read/context.md` — modify (record the mutation-red evidence, D-9)

**Reviewers**: Service owner `xstockstrat-portfolio` — P&L calculation accuracy, position snapshot consistency, concurrent write safety

**Codebase Evidence**:
- Confirmed via: `grep -rn 'ListWatchlists' --include='*_test.go' portfolio` → **no** existing `ListWatchlists`
  test. The only `ListByUser` in a test file is the fake's at `watchlist_service_test.go:146`.
- Confirmed via: `sed -n 32,48p watchlist_service_test.go` → `fakeWatchlistStore` fields (`byID`, `seq`,
  `allSymbols`, `allSymbolsErr`, `lastIntent`, `addSymbolsCnt`, `pruneResult`); `newFakeStore` at `:46`.
- Confirmed via: `sed -n 146,154p …` → the fake `ListByUser` ignores size and token (`_ int, _ string`),
  iterates the `byID` map (unordered) and returns an empty token — it must be replaced, and no current test
  depends on it (only `ListWatchlists` calls `ListByUser`).
- Confirmed via: `sed -n 246,257p …` → fake `EnsureSystemManaged` finds an existing system row or creates
  `wl-<seq>`; it has no error hook or counter. Fake `Create` also mints `wl-<seq>` (`:84`).
- Confirmed via: `sed -n 746,750p …` → `seedWatchlist(store, id, userID, systemManaged, binds)` stores a list
  with **no `Name`**; the tests set `store.byID[id].Name` after seeding instead of adding a near-duplicate helper.
- Confirmed via: `sed -n 329,345p …` → `newSvc(store, cfg, ledger)` and `ctxWithUser(t, userID)` (real
  interceptor); `wideCaps()` at `:416` (`max_per_user` 1000); a `fakeConfig` literal for a custom cap at
  `:518-522` (`TestPerUserCap_InvalidArgument`: `max_per_user` 1, `max_symbols_per_list` 1000).
- Confirmed via: `sed -n 671,745p …` → `TestEnsureSignalWatchlist_Idempotent` (`:671`) and
  `TestDeleteWatchlist_SystemManagedGuard` (`:710`) are the patterns for AC-6.
- Confirmed via: `portfolio_quote_deadline_test.go:63` `recordWarns(t) *warnRecorder` and `:52`
  `find(msg) map[string]string` (attrs keyed by name, e.g. `rec["error"]`); the recorder swaps
  `slog.SetDefault`, so these tests never call `t.Parallel()` (`:29-30`).
- C-13: the user ids and list names used here are single-consumer test literals in one file; the existing
  `seedWatchlist` is reused. Verdict: inline is compliant, no fixture home is created.
- Not found: any telemetry counter for watchlist fail-open outcomes (`recon.md` § Risks) — none is asserted.

**TDD**: `red-green required`

**Covers**: `AC-1, AC-2, AC-3, AC-4, AC-5, AC-6, AC-7, AC-8, AC-10`

**Instructions**:
1. **Fake-store hooks** on `fakeWatchlistStore` (struct at `:32`, new fields): `ensureErr error`,
   `ensureID string` (when non-empty, the id given to a newly created system row), `ensureCalls int`,
   `listCalls int`, `listErrAt int` (1 = the first `ListByUser` call fails, 2 = the second fails; error
   `errors.New("list boom")`). `EnsureSystemManaged` (`:246`) increments `ensureCalls`, returns `ensureErr`
   when set, and uses `ensureID` for a new row.
2. **Replace the fake `ListByUser`** (`:146-154`) with a keyset version over **uuid-shaped ids**: collect the
   user's rows, sort ascending by `WatchlistId`, drop rows with `id <= pageToken` when the token is non-empty,
   clamp `pageSize` (≤ 0 or > 500 → 100), and when rows remain beyond the page return the **last returned
   row's id** as the token (the fixed contract of the fake — it is not production's and is never followed by
   a 351 test). Increment `listCalls` on every call; honor `listErrAt`.
3. Seed ids are uuid-shaped, e.g. `00000000-0000-4000-8000-000000000001`; seed with the existing
   `seedWatchlist` and set `.Name` on the stored value. **No 351 test asserts or follows a returned
   `next_page_token` value** (D-9); AC-3 uses only its fixed zero-uuid token.
4. Add `recordWarns(t)` (reuse, `portfolio_quote_deadline_test.go:63`); no `t.Parallel()`.
5. Tests, one per scenario, named `TestListWatchlists351_AC<N>_<behavior>`, each asserting the scenario's
   `Then` with its concrete values:
   - **AC-1**: user "user-42" owns "DB workload test" and "Test", no system row; `ListWatchlists` with an
     empty token → 3 lists; exactly one is named "Signals", `system_managed` true, 0 symbols.
   - **AC-2** (unit half): "user-42", no system row; 5 sequential `ListWatchlists` calls → every response
     contains the same system `watchlist_id`, the store holds exactly 1 system row, `ensureCalls == 1`. The
     concurrent clause is Step 3(a): the fake's plain map is not goroutine-safe.
   - **AC-3**: "user-42", no system row, page token `"00000000-0000-0000-0000-000000000000"` → `ensureCalls == 0`,
     no row inserted, the response holds no `system_managed` list.
   - **AC-4**: "user-42" owns "Test"; `ensureErr = errors.New("connection reset")` → the call succeeds with
     1 list named "Test"; the `recordWarns` record for
     `"ListWatchlists: ensure system watchlist failed; returning existing lists"` has `rec["error"]` containing
     `connection reset`. Sub-cases: (i) a cancelled context (`context.WithCancel` over `ctxWithUser`) with
     the same `ensureErr` logs no WARN and still succeeds (D-3); (ii) ensure succeeds but `listErrAt = 2`
     → the call succeeds with the original page and a WARN for the re-list message.
   - **AC-5**: "user-42" has a system-managed "Signals" holding `AAPL` with source `SIGNAL` → the response
     contains it with `AAPL`, exactly one system row, `ensureCalls == 0`.
   - **AC-6**: "user-42" owns a manual "Signals" (created via `CreateWatchlist`, as `:671` does) → the
     response has two lists named "Signals", one `system_managed`; `DeleteWatchlist` on the system one
     returns `connect.CodeFailedPrecondition` (guard at `portfolio_service.go:2421-2423`).
   - **AC-7**: "user-42" owns two manual lists (ids …01, …02), no system row, `ensureID` set to a uuid that
     sorts **after** …01; `page_size 1`, empty token → 1 list, non-empty `next_page_token`, exactly 1 system
     row afterwards, `listCalls == 1` (D-2 skip); a second identical call leaves the store with 1 system row.
     Second case: `ensureID` sorts **before** …01 → `listCalls == 2` and the response contains the system list.
   - **AC-8**: `context.Background()` (no `x-user-id`) → `connect.CodeInvalidArgument`, message
     `missing user identity`, `ensureCalls == 0`, `len(store.byID) == 0`.
   - **AC-10**: `fakeConfig` with `watchlist.max_per_user` 50 and `watchlist.max_symbols_per_list` 1000;
     seed 49 manual lists and 1 system list for "user-42"; `CreateWatchlist` "Breakouts" →
     `connect.CodeInvalidArgument` with `watchlist limit reached: 50`, and `CountByUser` still 50
     (`portfolio_service.go:2186-2192`, `watchlist_repo.go:438-441`).
   - Also assert the unchanged error path: `listErrAt = 1` → `connect.CodeInternal` and `ensureCalls == 0`.
6. **Mutation-red (D-9), executed once and recorded in `context.md`** for the three characterization tests:
   (a) delete the `pageToken == ""` condition in Step 1's call → AC-3 must fail; (b) move the ensure ahead of
   `requireUserID` → AC-8 must fail; (c) make the ensure unconditional (drop the `ContainsFunc` guard) →
   AC-5 must fail. Revert each mutation; record "AC-N mutated → FAIL → restored → PASS" lines. AC-10 touches
   no code: record `red N/A — characterization test` (tdd-gate.md § Interaction).
7. The `service/` package is excluded from CI coverage (`docs/patterns/ci-overview.md:19,87` (the `go-test` row and the Go exclusion note); file header
   `watchlist_service_test.go:24-25`): "New logic is in an excluded package — no coverage threshold applies;
   unit tests are the verification."

**Verification**:
```bash
cd services/xstockstrat-portfolio && GOWORK=off go test ./internal/service/ -run 'TestListWatchlists351' -race -count=1 -v
cd services/xstockstrat-portfolio && export GOWORK=off && COVERPKGS=$(go list ./... | grep -Ev '/(cmd|handler|repository|telemetry|service)(/|$)' | tr '\n' ',' | sed 's/,$//') && go test ./... -race -count=1 -coverprofile=coverage.out -covermode=atomic -coverpkg="${COVERPKGS}" && go tool cover -func=coverage.out | awk '/^total:/ {gsub("%","",$3); print "total " $3 "%"; exit ($3+0 < 40)}'   # exits non-zero below 40%
cd services/xstockstrat-portfolio && GOWORK=off golangci-lint run --modules-download-mode=mod
grep -c 'TestListWatchlists351_AC' internal/service/watchlist_service_test.go   # >= 9 (one per AC-1,2,3,4,5,6,7,8,10)
```
Confirm the `-v` output lists a PASS line for each of AC-1, 2, 3, 4, 5, 6, 7, 8, 10 (a green run that
executes none of them proves nothing, `tdd-gate.md` last bullet). RED on the pre-Step-1 tree: AC-1, 2, 4
(WARN assertion), 6 and 7 fail; AC-3, 5, 8, 10 pass by design and carry the mutation-red record.

---

### Step 3 — test: real-Postgres tests for the concurrent ensure and the id order

**Status**: `done`
**Service**: `xstockstrat-portfolio`
**Files**:
- `services/xstockstrat-portfolio/internal/repository/dbtest_helpers_test.go` — modify
- `services/xstockstrat-portfolio/internal/repository/watchlist_ensure_dbtest_test.go` — create

**Reviewers**: Service owner `xstockstrat-portfolio` — P&L calculation accuracy, position snapshot consistency, concurrent write safety

**Codebase Evidence**:
- Confirmed via: `sed -n 1,50p portfolio/internal/repository/dbtest_helpers_test.go` → `//go:build dbtest`;
  `testPool(t)` at `:22` reads `PORTFOLIO_DB_TEST_URL`, **skips** when unset unless `CI=true`, in which case it
  `t.Fatal`s (`:25-29`); it sets `cfg.ConnConfig.RuntimeParams["lock_timeout"] = "500ms"` at `:35`; cleanup
  deletes `portfolio.watchlists` rows whose `user_id LIKE 'it-281-%'` (`dbtestUserPrefix`, `:19`);
  `testUserID(t)` yields a cleanup-scoped user id.
- Confirmed via: `grep -rn 'testPool(' portfolio/internal/repository/*.go` → many call sites across the
  other dbtest files; `testPool`'s signature must not change.
- Confirmed via: `grep -n 'func NewWatchlistRepo' portfolio/internal/repository/watchlist_repo.go` → `:33`
  `NewWatchlistRepo(pool *pgxpool.Pool) *WatchlistRepo`; dbtests already build it (`signal_expiry_backfill_dbtest_test.go:219`).
- Confirmed via: `sed -n 1,15p portfolio/migrations/007_watchlists.up.sql` → `watchlist_id UUID PRIMARY KEY
  DEFAULT gen_random_uuid()`, `user_id TEXT NOT NULL`, `name TEXT NOT NULL`; explicit ids can be inserted.
  `011_watchlist_system_managed_source.up.sql:19-28` → `watchlists_user_name_not_system_uidx` (manual rows
  need distinct names per user) and `watchlists_user_system_uidx` (one system row per user).
- Confirmed via: `grep -n 'sync.WaitGroup' portfolio/internal/repository/*dbtest*_test.go` → concurrency in
  dbtests uses `sync.WaitGroup` (`signal_expiry_prune_dbtest_test.go:347,406`).
- Confirmed via: `sed -n 1017,1060p .github/workflows/ci.yml` → job `portfolio-db-test` applies migrations
  to TimescaleDB and runs `go test -tags dbtest -race ./internal/repository/...`.
- `.golangci.yml` sets `run.build-tags: [dbtest]`, so the new file is linted in `go-lint`.
- C-13: seeds are inline `INSERT … RETURNING` in the new file only (single consumer, D-9); `seedWatchlist`
  (`dbtest_helpers_test.go:57-68`) is **not** used because it fixes the name `"wl-"+userID` and its signature
  must not change (four feature-281 dbtests call it, D-5).

**TDD**: `red-green required` — the tests are new and assert existing repository behavior (no production
change in this step): record `red N/A — characterization of existing repository behavior; new dbtests added`
in the PR body and `context.md`, and capture the green run (tdd-gate.md § Interaction).

**Covers**: `AC-2`

**Instructions**:
1. In `dbtest_helpers_test.go` refactor `testPool` (`:22-49`) into **new**
   `testPoolWithLockTimeout(t *testing.T, lockTimeout string) *pgxpool.Pool` holding the current body with
   `RuntimeParams["lock_timeout"] = lockTimeout`; keep `func testPool(t *testing.T) *pgxpool.Pool` as a
   one-line wrapper returning `testPoolWithLockTimeout(t, "500ms")`, so every existing caller is unchanged.
2. Create `watchlist_ensure_dbtest_test.go` (`//go:build dbtest`, `package repository`) with two tests:
   - **(a)** `TestEnsureSystemManaged_ConcurrentSingleRow`: `pool := testPoolWithLockTimeout(t, "5s")`,
     `repo := NewWatchlistRepo(pool)`, `uid := testUserID(t)`; start 5 goroutines (`sync.WaitGroup`) each
     calling `repo.EnsureSystemManaged(ctx, uid, "Signals")`; collect ids and errors under a mutex (use
     `t.Errorf` in goroutines, never `t.Fatalf`); assert no error, all 5 ids equal, and
     `SELECT count(*) FROM portfolio.watchlists WHERE user_id = $1 AND system_managed` is 1. This is the
     real-index proof of AC-2's concurrency clause (D-4).
   - **(b)** `TestListByUser_OrdersByWatchlistIDAfterEnsure`: `pool := testPool(t)`; insert three manual rows
     for one `testUserID` with **explicit ids in non-ascending insertion order** and distinct names —
     `ffffffff-ffff-4fff-bfff-fffffffffffe` first, then `00000000-0000-4000-8000-000000000001`, then
     `00000000-0000-4000-8000-000000000002` — via inline
     `INSERT INTO portfolio.watchlists (watchlist_id, user_id, name) VALUES ($1::uuid, $2, $3)`; call
     `repo.EnsureSystemManaged`; one `repo.ListByUser(ctx, uid, 100, "")`; assert 4 rows, exactly one
     `GetSystemManaged()`, and ids strictly ascending under Go `<`. This proves D-2's Go string compare
     equals Postgres uuid order without following any token (D-9(b), D-12(a)); any `ORDER BY` regression
     (system-first, `created_at`) fails it every time.
3. Add no helper that duplicates one the token fix may land (D-11(c)); Step 5 reconciles.

**Verification**:
```bash
cd services/xstockstrat-portfolio && GOWORK=off go vet -tags dbtest ./internal/repository/ \
  && GOWORK=off golangci-lint run --modules-download-mode=mod \
  && GOWORK=off go test -tags dbtest -race -count=1 ./internal/repository/ -run 'TestEnsureSystemManaged_ConcurrentSingleRow|TestListByUser_OrdersByWatchlistIDAfterEnsure' -v
grep -n 'testPool(t)' internal/repository/signal_expiry_prune_dbtest_test.go | head -3   # existing callers unchanged
```
**Coverage threshold: none applies to this step.** `repository/` is excluded from the Go coverage gate
(`docs/patterns/ci-overview.md:19,87`); the CI job `portfolio-db-test` (`.github/workflows/ci.yml:1017`) is
the gate for these tests.

Run offline (no `PORTFOLIO_DB_TEST_URL`) the two tests report SKIP, which is **not** evidence
(`fails.md:3055`). The proof is the CI job `portfolio-db-test` (`ci.yml:1017`) on the step PR, where
`CI=true` makes an unset URL fatal (`dbtest_helpers_test.go:25-29`); record that job's result in the PR
body and `context.md`. Do not start a database inside `/sdd-execute`.

---

### Step 4 — docs: agent wording for `list_watchlists` no longer says "(read-only)"

**Status**: `done`
**Service**: `xstockstrat-agent`
**Files**:
- `services/xstockstrat-agent/app/tools.py` — modify
- `docs/runbooks/mcp-tools.md` — modify

**Reviewers**: none

**Codebase Evidence**:
- Confirmed via: `grep -n 'list_watchlists' agent/app/tools.py` → module header line `:33`
  (`list_watchlists     — lists the caller's own watchlists from portfolio, paginated (read-only)`);
  the tool at `:2153` (`async def list_watchlists(ctx: Context, limit: int = 0, page_token: str = "")`).
- Confirmed via: `sed -n 2153,2161p agent/app/tools.py` → docstring opens
  `List the calling user's OWN watchlists from xstockstrat-portfolio (read-only).` (`:2154`) and contains
  `Pagination is stable across pages.` (`:2155`).
- Confirmed via: `sed -n 1380,1396p docs/runbooks/mcp-tools.md` → `### \`list_watchlists\`` at `:1380`; the
  text `(read-only, paginated)` at `:1382`; the section ends with `**Errors:**` at `:1394`.
- Confirmed via: `agent/tests/test_tools_endpoint.py:141-144` → `test_every_catalog_tool_has_a_runbook_section`
  needs the exact heading `### \`list_watchlists\`` (regex `^### \`([a-z_]+)\`$`); no test asserts the
  docstring wording (recon: "No test asserts the docstring text").
- Confirmed via: `grep -n 'list_watchlists' agent/CLAUDE.md docs/runbooks/historical-backfill.md` →
  `agent/CLAUDE.md:71` (ownership wording, no "read-only") and `historical-backfill.md:213` (a usage
  sentence); neither claims `list_watchlists` is read-only, so neither changes.
- Confirmed via: `grep -n 'readOnlyHint' agent/app` → none (product spec § Consumer Surface): no annotation
  to change.
- Sibling `get_watchlist` also says "(read-only)" (`tools.py:34,2171`, runbook `:1402`) and stays: it is
  truly read-only (design.md Open Risks, "Read-only wording").

**TDD**: `N/A (docs — wording only, no executable change)`

**Covers**: `AC-9` (per D-9 this scenario is checked by the grep below plus the existing agent guard tests,
not by a new test; flagged as an assumption above)

**Instructions**:
1. `tools.py:33` — replace the whole `list_watchlists` header line with exactly (98 columns, inside the
   100-column limit at `agent/pyproject.toml:37`; single line, so the Verification grep still matches it):
   `  list_watchlists     — lists the caller's own watchlists, paginated; idempotently ensures Signals`
   (two leading spaces, five spaces before the em dash, as the sibling lines at `:31-36`).
2. `tools.py` docstring (`:2154`) — replace `(read-only)` with a sentence stating that the call
   idempotently ensures the caller's system-managed "Signals" list on a first-page call (empty `page_token`),
   so the list is returned even for a user who never ingested a signal. Keep `Pagination is stable across
   pages.` (`:2155`, D-6), the parameters, the return shape and `Only the caller's own lists are ever returned.`
   The new sentence must not contain the text `user_id = _caller_user_id` (the Verification `sed` range ends
   at that line, `tools.py:2162`).
   Name, parameters and return shape do not change; no tool-count surface changes.
3. `docs/runbooks/mcp-tools.md:1382` — replace `(read-only, paginated)` with `(paginated)` and add one
   sentence to that paragraph stating the same idempotent ensure of the caller's system "Signals" list on a
   first-page call. Keep the heading `### \`list_watchlists\`` (`:1380`), the parameter table and the
   `**Errors:**` line. No other tool's wording changes (`list_opportunities`, `get_watchlist`).

**Verification**:
```bash
cd /home/user/xstockstrat
sed -n '/^### `list_watchlists`$/,/^### `get_watchlist`$/p' docs/runbooks/mcp-tools.md | grep -c '(read-only'   # expect 0
sed -n '/^### `list_watchlists`$/,/^### `get_watchlist`$/p' docs/runbooks/mcp-tools.md | grep -c 'idempotent'   # expect >= 1
grep -n 'list_watchlists     —' services/xstockstrat-agent/app/tools.py | grep -c '(read-only)'    # header line: expect 0
grep -n 'list_watchlists     —' services/xstockstrat-agent/app/tools.py | grep -c 'idempotent'     # header line names the ensure: expect 1
sed -n '/async def list_watchlists/,/user_id = _caller_user_id/p' services/xstockstrat-agent/app/tools.py | grep -c '(read-only)'   # expect 0
sed -n '/async def list_watchlists/,/user_id = _caller_user_id/p' services/xstockstrat-agent/app/tools.py | grep -c 'idempotent'    # expect >= 1
cd services/xstockstrat-agent && ruff check . && ruff format --check . && pytest tests/test_tools_endpoint.py tests/test_watchlist_tools.py -q
```

---

### Step 5 — test: landing gate — the `ListByUser` token fix is on `origin/main-dev`

**Status**: `done`
**Service**: `xstockstrat-portfolio`
**Files**:
- `services/xstockstrat-portfolio/internal/repository/dbtest_helpers_test.go` — modify (only if the fix lands an equivalent lock-timeout or seeding helper)
- `services/xstockstrat-portfolio/internal/repository/watchlist_ensure_dbtest_test.go` — modify (only to switch to the fix's helper)
- `docs/roadmap/features/351-ensure-signals-watchlist-on-read/context.md` — modify (the recorded gate output)

**Reviewers**: Service owner `xstockstrat-portfolio` — P&L calculation accuracy, position snapshot consistency, concurrent write safety

**Codebase Evidence**:
- Confirmed via: `grep -n 'wls\[pageSize\]' portfolio/internal/repository/watchlist_repo.go` → `:139`
  `nextToken = wls[pageSize].WatchlistId` is **still present** on this tree; gate (i) fails today.
- Confirmed via: `cat docs/reports/2026-11-16-portfolio-listwatchlists-page-token-skips-boundary-row-defect.status`
  → `open`; gate (iii) fails today. The sibling `…listpositions-…-defect.status` is not part of this gate.
- Confirmed via: `grep -rn 'listwatchlists\|ListByUser' docs/roadmap/features/*/feature.md` and
  `ls docs/roadmap/features | tail` → **Not found**: no feature directory for the token fix exists yet, so
  its slug, number and commit are unknown; its real-backend traversal test therefore has **no name yet**
  (**Not found** — identify it by `grep -ln 'next_page_token\|nextToken' portfolio/internal/repository/*dbtest*_test.go`
  at step time).
- Confirmed via: `sed -n 22,30p portfolio/internal/repository/dbtest_helpers_test.go` → with `CI=true` an
  unset `PORTFOLIO_DB_TEST_URL` is fatal; offline it skips. The CI job is `portfolio-db-test`
  (`.github/workflows/ci.yml:1017`).
- Confirmed via: `ls .claude/agents/dry-reviewer.md` → the `dry-reviewer` subagent exists (D-11(c)).
- `docs/roadmap/ledger/fails.md:3055` — a SKIP or a claim that "CI will prove it" is not a run record; the
  gate records the CI job result (named run) or a local run with its command, DB and date.

**TDD**: `N/A (landing gate — verification only; any helper de-duplication is a refactor with no behavior change)`

**Covers**: — (a gate, not a scenario; it proves the precondition under AC-7's note and the merge-order row)

**Instructions**:
This step **fails by design until the token fix is merged to `origin/main-dev`**; do not mark it `done`
on a partial result, and do not start Step 6 without it (D-11(a)).
1. Rebase / merge `origin/main-dev` into the feature branch per `/sdd-execute` BRANCH SYNC.
2. Prove all three, and write the raw output of each command into this feature's `context.md`:
   (i) `watchlist_repo.go` no longer contains `wls[pageSize].WatchlistId`;
   (ii) the fix's real-backend dbtest that follows `next_page_token` across a full traversal exists, and the
   `portfolio-db-test` CI job is green on the rebased branch (or a local run with `PORTFOLIO_DB_TEST_URL`
   set, recording command, database and date);
   (iii) the defect report's `.status` reads `resolved`, **or** the fix's commit is an ancestor of
   `origin/main-dev` (`git merge-base --is-ancestor <fix-sha> origin/main-dev`).
3. If the fix landed a seeding or lock-timeout helper that duplicates Step 3's `testPoolWithLockTimeout` or
   inline seeds, delete 351's copy and use the fix's (C-18, D-11(c)); then run the `dry-reviewer` subagent
   on the diff and record its verdict.
4. If the gate cannot pass because the fix session stays stalled, stop and escalate: waiving it is a
   `REOPEN D-10(a)` petition (P-2), which the operator declined at approval; it needs explicit sign-off
   recorded in `context.md` naming the two guarantees at risk (`@AC-2 @FR-2 @feature-180`, agent
   `@AC-1 @feature-148`) — see design.md Open Risks.

**Verification**:
```bash
cd /home/user/xstockstrat && git fetch origin main-dev && git merge-base --is-ancestor origin/main-dev HEAD && echo "main-dev merged"
! grep -n 'wls\[pageSize\]\.WatchlistId' services/xstockstrat-portfolio/internal/repository/watchlist_repo.go && echo "(i) token derives from last returned row"
grep -ln 'next_page_token\|nextToken' services/xstockstrat-portfolio/internal/repository/*dbtest*_test.go   # (ii) names the fix's traversal test
cat docs/reports/2026-11-16-portfolio-listwatchlists-page-token-skips-boundary-row-defect.status          # (iii) expect: resolved
cd services/xstockstrat-portfolio && GOWORK=off go vet -tags dbtest ./internal/repository/ \
  && GOWORK=off golangci-lint run --modules-download-mode=mod
```
Plus the recorded run of `go test -tags dbtest -race ./internal/repository/...` (CI job `portfolio-db-test`
result or a named local run). A SKIP does not satisfy (ii).

**Coverage threshold: none applies to this step.** It adds no test code of its own (at most the removal of
351's duplicate seeding helper); `repository/` is excluded from the Go coverage gate
(`docs/patterns/ci-overview.md:19,87`) and the CI job `portfolio-db-test` is the gate.

**Execute handoff (F-05).** This step cannot pass its own Verification until the external `ListByUser`
fix is merged to `origin/main-dev`. `/sdd-execute` must report it as a **HALT waiting on an external
dependency** (named: the fix session / defect report), not as a step failure to repair inside this feature,
and must not mark the step `done` or open the integration PR until (i)-(iii) are recorded in `context.md`.
Any divergence goes in the `## Deviation Log` (F-09), never into an edit of this step's body.

---

### Step 6 — docs: promote the scenarios and write the merge-order row

**Status**: `done`
**Service**: `docs/` (with `services/xstockstrat-portfolio/acceptance/` and `services/xstockstrat-agent/acceptance/`)
**Files**:
- `services/xstockstrat-portfolio/acceptance/ensure-signals-watchlist-on-read.feature` — create
- `services/xstockstrat-agent/acceptance/mcp-watchlist-tools.feature` — modify
- `docs/roadmap/features/merge-order.md` — modify

**Reviewers**: none

**Codebase Evidence**:
- Confirmed via: `ls portfolio/acceptance` → the durable portfolio suites, e.g. `consolidate-watchlist-signal.feature`
  (provenance header and `@feature-127` tags, `:1-12`); the new file follows that convention. No file for 351 exists.
- Confirmed via: `sed -n 11,19p agent/acceptance/mcp-watchlist-tools.feature` → the scenario to extend is
  `@AC-1 @FR-1 @FR-5 @feature-148` "list_watchlists returns only the caller's own lists, paginated"; line
  `:41` of that file is the precedent for a signed `#` note recording an operator-approved extension
  (`# Feature 282 (operator-signed C-16 CHANGE, … 282 context.md) …`).
- Confirmed via: `docs/sdd/business-rules/CLAUDE.md` § Scenario conventions → promoted scenarios keep their
  `@AC-<n> @FR-<n>` and gain `@feature-<NNN>`; a rule enters only by promotion from a reviewed
  `acceptance.feature`; **concrete values only**.
- Confirmed via: `sed -n 21,25p docs/roadmap/features/merge-order.md` → `## Blocking Dependencies` table
  with columns `| Feature | Must wait for | Reason | Resolved |`; a recent row's wording pattern
  `Hard — merge order only; … need not be launched.`
- Confirmed via: `.claude/agents/scenario-promoter.md` exists; `/sdd-execute` plans promotion with it at
  integration (`docs/sdd/business-rules/CLAUDE.md` lifecycle item 2).
- **Not found**: the token fix's feature slug and number — fill `<fix-slug> (<NNN>)` from Step 5's evidence.

**TDD**: `N/A (docs — acceptance suites and a merge-order row; no executable change)`

**Covers**: —

**Instructions**:
1. Create `ensure-signals-watchlist-on-read.feature` in `portfolio/acceptance/` with a provenance header like
   `consolidate-watchlist-signal.feature:1-5`, and promote `@AC-1`, `@AC-2`, `@AC-3`, `@AC-4`, `@AC-5`,
   `@AC-6`, `@AC-7`, `@AC-8`, `@AC-10` from `acceptance.feature` with `@feature-351` appended to each tag
   line. Do **not** promote `@AC-9` (a documentation-wording check, the same rationale as the note on
   source `@AC-10` in `agent/acceptance/mcp-watchlist-tools.feature:6-7`). Let `scenario-promoter` dedupe
   against `@AC-6 @FR-2 @FR-7 @feature-127` (`consolidate-watchlist-signal.feature`), which AC-6 overlaps.
2. In `agent/acceptance/mcp-watchlist-tools.feature` add, after `@AC-1 @FR-1 @FR-5 @feature-148`, one new
   scenario tagged `@AC-1 @FR-1 @feature-351` with a `#` note recording the extension as operator-approved
   (design approved 2026-11-16, `351 design.md`). Its `Then` states that the first-page call ensures the
   caller's system "Signals" list exists and that the RPC arguments, response shape and caller-only scope are
   unchanged. It must **not** say a `limit 1` caller "sees" Signals (FR-6; design.md Business Rules Touched).
   Do not edit the text of any 148 scenario.
3. In `merge-order.md` Blocking Dependencies add the row from design.md § Merge-order row, with the fix's
   real slug and number: `| ensure-signals-watchlist-on-read (351) | <fix-slug> (<NNN>) | **Hard — merge order
   only; <fix-slug> need not be launched.** 351's first-page ensure adds a system row for every user, creating
   page boundaries where ListByUser's look-ahead token (watchlist_repo.go:139) drops the boundary row (agent
   limit-1 traversals; owners ≥100 rows). Gate verified by 351 step 4 (context.md). | No |`. Replace
   "step 4" with "Step 5" (this spec's numbering) and set Resolved to `Yes` only once the fix is merged to
   `main-dev`.
4. Record in `context.md` the accepted UI effects for the promotion notes (design.md Open Risks): Signals
   auto-selected for a user with no other list, the unreachable "No watchlists yet" state, and the screener
   picker's MANUAL writes into the system list.

**Verification**:
```bash
cd /home/user/xstockstrat
grep -c '@feature-351' services/xstockstrat-portfolio/acceptance/ensure-signals-watchlist-on-read.feature   # expect 9 (AC-1..8, AC-10)
grep -n '@feature-351' services/xstockstrat-agent/acceptance/mcp-watchlist-tools.feature                    # expect the one new scenario
grep -n 'ensure-signals-watchlist-on-read (351)' docs/roadmap/features/merge-order.md                       # expect the new row
grep -n 'fix-slug\|<NNN>' docs/roadmap/features/merge-order.md services/xstockstrat-*/acceptance/*.feature   # expect none (placeholders replaced)
grep -n 'Gate verified by 351 step 4' docs/roadmap/features/merge-order.md                                    # expect none (rewritten to "Step 5")
```

---

## Deviation Log

_Populated by /sdd-execute as implementation proceeds._

### Step 5 — the equivalent helper came from 353, not the gated fix 354
- **Planned**: Instruction 3 — "If the fix landed a seeding or lock-timeout helper that duplicates Step 3's `testPoolWithLockTimeout` or inline seeds, delete 351's copy and use the fix's".
- **Actual**: the gated fix (354) landed `seedNamedWatchlist`, which cannot set explicit ids, so 351's explicit-id inline INSERT stays (dry-reviewer: KEEP). The lock-timeout duplicate was created by **353** (`fix-listpositions-nextpagetoken-skips`, merged alongside 354), whose `testPool(t, opts ...func(*pgxpool.Config))` makes `testPoolWithLockTimeout` a second way to set the same `lock_timeout` field (dry-reviewer: REPLACE). 351's helper was deleted and the ensure dbtest now passes a `lock_timeout` option to `testPool`; `dbtest_helpers_test.go` is byte-identical to origin/main-dev afterwards.
- **Disposition**: in scope (same intent as Instruction 3, C-18/D-11(c)); no operator decision needed.

### Step 6 — the merge-order row already existed, so it was updated in place
- **Planned**: Instruction 3 — "add the row from design.md § Merge-order row" with the fix's slug and number, written as `| ensure-signals-watchlist-on-read (351) | <fix-slug> (<NNN>) | … | No |`; Verification greps `ensure-signals-watchlist-on-read (351)`.
- **Actual**: feature 354 had already written that row (`` `ensure-signals-watchlist-on-read` (351) `` → `` `fix-listwatchlists-page-token` (354) ``), and its text says "351's Step 6 updates this row rather than adding a second". The row was updated in place: the design's wording was appended ("Merge order only — `fix-listwatchlists-page-token` need not be `launched`", the boundary-row rationale, "gate verified by 351 Step 5") and Resolved set to `Yes` (354 merged to main-dev, `149351de`). The table's backtick convention is kept, so the spec's literal grep `ensure-signals-watchlist-on-read (351)` returns 0; the backtick-tolerant grep returns exactly 1 row.
- **Also**: the spec's placeholder grep over `services/xstockstrat-*/acceptance/*.feature` matches one pre-existing line outside 351's diff — `services/xstockstrat-ui/acceptance/strategy-performance-dashboard.feature:2` documents the `@feature-<NNN>` convention in prose. Not a 351 placeholder; left untouched (out of scope).
- **Disposition**: in scope (the row's own text and D-10(a)'s intent call for one row); no operator decision needed.
