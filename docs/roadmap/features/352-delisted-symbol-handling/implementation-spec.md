# Implementation Spec: delisted-symbol-handling

**Status**: `in-progress`
**Created**: 2026-11-17
**Feature**: `docs/roadmap/features/352-delisted-symbol-handling/feature.md`
**Total Steps**: 32
**Feature Branch**: `feature/delisted-symbol-handling`
**Tree**: `feature/delisted-symbol-handling` == `origin/main-dev@9a685196` (story PR #1563 merged 2026-11-17;
includes features 351, 353 and 354). Citations in Steps 20, 22–25, 28 and 32 were re-verified against this
tree by the sequential-mode re-spec gate.

---

## Execution Summary

The work follows the data flow of `design.md`: contracts first (Steps 1–2), then the shared NYSE calendar
(3–4), then marketdata — the only decider of the per-symbol state — as schema, repository, detection hook
with its config key, sync/acknowledge RPCs and backfill outcomes (5–16). Ingest stores and serves the
per-symbol outcomes (17–19). Portfolio then pulls on its existing prune tick, removes, alerts,
acknowledges and decorates (20–25), analysis skips flagged bindings (26–27), and the two consumer surfaces
named in the product spec land last: the Agent tools (28–29) and the `/insights` watchlist row (30–31,
**C-14**). Step 32 amends the three durable scenarios whose change the operator signed off (**C-16**).

Every step is green on a tree that holds only the steps before it; the four places where that is not
possible are declared as atomic units (`**Lands with**`). No new env var, port or deployment-file change:
portfolio already dials marketdata and notify (`services/xstockstrat-portfolio/internal/service/portfolio_service.go:138-153`),
marketdata already dials notify (`services/xstockstrat-marketdata/internal/service/marketdata_service.go:225-238`).

Trading-domain survey (`reference/step-constraints.md` §A): `TRADING_MODE`, `BrokerType`, `OrderType` and
`OrderStatus` have no match in the portfolio files this feature edits (`signal_prune.go`,
`signal_expiry_repo.go`, `watchlist_repo.go`, the watchlist handlers of `portfolio_service.go`). Order
placement, broker dispatch, order types and fill handling are unaffected by every step; detection reads
only the Alpaca asset set, which is the same in paper and live. IBKR has no marketdata integration, so
no counterpart step is needed.

## Scenario Coverage (C-15)

| AC | Steps | AC | Steps | AC | Steps |
|---|---|---|---|---|---|
| AC-1 | 7, 9 | AC-11 | 16, 19 | AC-21 | 7, 9 |
| AC-2 | 9 | AC-12 | 16 (guard) | AC-22 | 23 |
| AC-3 | 9 | AC-13 | 16, 19 | AC-23 | 16, 19 |
| AC-4 | 9, 25 | AC-14 | 19, 29 | AC-24 | 16, 19, 29 |
| AC-5 | 9, 23 | AC-15 | 31 | AC-25 | 9 |
| AC-6 | 21, 23 | AC-16 | 25, 29 | AC-26 | 16, 19 |
| AC-7 | 21, 25 | AC-17 | 14, 23 | AC-27 | 7, 9 |
| AC-8 | 9, 25, 27 | AC-18 | 23 | AC-28 | 9 |
| AC-9 | 7 (guard) | AC-19 | 9, 14, 25 | AC-29 | 9 |
| AC-10 | 9, 25 (guard) | AC-20 | 9 | | |

AC-9, AC-10 and AC-12 are **guards**: they pass on today's code (nothing deletes stored data; quote and
price readers are not filtered; a backfill attempts every symbol it is given) and stay green only if this
feature adds no such deletion or filter. Their tests are written as regression guards and are exempt from
the RED requirement, stated per `tdd-gate.md`.

## Assumptions made by this spec (not decided in `design.md`)

Each is a naming or shape choice the design left open. `/sdd-review impl-spec` should confirm or change them.

| # | Assumption | Basis |
|---|---|---|
| A-1 | Request/response shapes of the two new RPCs: `SyncWatchlistDelistingsRequest {repeated string symbols = 1}`, `SyncWatchlistDelistingsResponse {repeated FlaggedSymbol flagged = 1}`, `AckDelistingAlertsRequest {repeated string symbols = 1}`, `AckDelistingAlertsResponse {}` | design §9 names the RPCs and `FlaggedSymbol` only |
| A-2 | The hook counter is `marketdata.delisting.hook_failures{reason timeout\|error}` | design §3 says "increments a counter"; `reason` is an already-allowed label key (`services/xstockstrat-marketdata/internal/service/telemetry_allowlist_test.go:28-31`) |
| A-3 | `ingest.backfill_jobs.symbol_results` stores `{"<chunk key>": {"<SYMBOL>": {"outcome": <enum int>, "reason": "<text>"}}}` | design §6 fixes "keyed by chunk" and JSON text; statuses are already stored as enum ints (`services/xstockstrat-ingest/app/handlers/servicer.py:308`) |
| A-4 | A symbol in a marketdata response's `failed_symbols` with no entry in `symbol_results` (marketdata deployed behind ingest) is stored as `FAILED` with an empty reason | keeps the design §6 invariant during a rolling deploy; design §10 "every additive field means the non-destructive state when absent" |
| A-5 | The rollout note with the burst-count query is a new runbook, `docs/runbooks/delisting-rollout.md`, indexed in `docs/runbooks/CLAUDE.md`; `services/xstockstrat-marketdata/CLAUDE.md` carries a one-line pointer to it | follows design §10 ("a runbook note"); only the file name is this spec's choice |
| A-6 | Alert titles and bodies (Steps 8 and 22) | design §3/§5 fix severity, category, audience and what each alert names, not the wording |
| A-7 | A flagged symbol skipped by a backfill is logged at INFO, not with the existing `failed` WARN/ERROR line — confirmed by the operator 2026-11-17 | design §6 is silent; FR-9 moves the reason into the job status |
| A-8 | The UI marker uses the existing `Badge` variant `warning`, with the label text `Delisted` and an accessible name holding the symbol, the reason text and the date (Step 30) | design §7 says "a badge"; `services/xstockstrat-ui/src/components/ui/badge.tsx:25` |
| A-9 | Go/Python/TS symbol names introduced by this spec (`ProfileRepo`, `runDelistingHook`, `syncDelistings`, …) | **Not found** — created from scratch; no existing symbol |
| A-10 | Error codes of the two new RPCs (Step 13): `connect.CodeUnavailable` when no profile store is wired, `connect.CodeInternal` on a store error, `connect.CodePermissionDenied` without the grant | design §4 fixes only `InvalidArgument` above 20 000 symbols |
| A-11 | Step 28 makes no `plugin.json` version bump | feature 343 precedent; `docs/patterns/strat-lab-plugin.md:54` requires only that the two plugin manifests stay identical |

## Verification command blocks

Steps call these by name. Run from the repo root.

```bash
go_gate() {  # lint + whole-service race tests + the CI coverage total; fails below the CI threshold (40, .github/workflows/ci.yml:330-335)
  ( cd "services/$1" && GOWORK=off golangci-lint run --modules-download-mode=mod &&
    COVERPKGS=$(GOWORK=off go list ./... | grep -Ev '/(cmd|handler|repository|telemetry|service)(/|$)' | tr '\n' ',' | sed 's/,$//') &&
    GOWORK=off go test ./... -race -count=1 -coverprofile=coverage.out -covermode=atomic -coverpkg="${COVERPKGS}" &&
    GOWORK=off go tool cover -func=coverage.out | awk '/^total:/ {gsub("%","",$3); print; if ($3+0 < 40) exit 1}' )
}
py_gate() {  # lint + whole-service tests at the CI threshold (40)
  ( cd "services/$1" && ruff check . && ruff format --check . && pytest --cov=app --cov-fail-under=40 )
}
```

New Go logic of this feature is in packages excluded from CI measurement (`service/`, `repository/`,
`telemetry/`, `handler/`, `cmd/`) — no coverage threshold applies to it; the tests of each `test` step are
the verification. `go_gate` still runs so the service total cannot regress.

## Step Dependencies

- Steps 1+2 land together: a `.proto` edit and its generated stubs (§C row 2). No descriptor-parity guard
  covers `WatchlistBinding`, `BackfillJob`, `BackfillBarsResponse` or `BackfillFundamentalsResponse`
  (`grep -rn "fields_by_name" services --include=*.py` lists none of them), so the unit is two steps.
- Steps 3+4 land together: Step 3 deletes `services/xstockstrat-portfolio/internal/marketsession/`
  including its test; Step 4 re-homes that test (§C rows 4 and 6).
- Steps 8+9+10 land together: the config seed (10), its reader and the reader's first production caller
  (8) and the wiring test (9) are one commit (§C row 5; ledger `fails.md` 2026-11-10 281 "config" and
  282 "helper here, caller in a later step").
- Steps 22+23 land together: Step 22 adds a method to the `WatchlistStore` interface, which breaks the
  compile of `fakeWatchlistStore` (`services/xstockstrat-portfolio/internal/service/watchlist_service_test.go:32-51`, type at `:33`),
  repaired in Step 23 (§C row 1).
- Steps 6/7, 11/12, 13/14, 15/16, 18/19, 20/21, 24/25, 26/27, 28/29 and 30/31 are ordinary
  service/test pairs: each `service` step passes its own Verification alone. RED for each pair is
  captured per `tdd-gate.md` with the `service` step's new symbols present as signatures returning zero
  values (Go) or with the new assertions run against the unmodified module (Python, TypeScript).
- Step 5 → 6 → 8 → 13 → 15 in that order (table, repo, flagged set, sync, backfill). Step 15 requires
  Step 8 (the in-memory flagged set). Step 8 requires Step 3 (`contracts/marketsession`).
- Step 18 requires Steps 2 and 17. Step 22 requires Steps 2, 13 and 20. Step 24 requires Step 22 (the
  cache). Steps 26, 28 and 30 require Step 2 only and may run in any order after it.
- Step 32 requires Steps 9 and 25 (the behavior the amended scenarios describe).
- **Volatile at merge — migration numbers.** On this tree the last files are marketdata `009`, ingest
  `016`, config `052`; `git log --all` shows no `010`/`017`/`053`/`054` file on any visible ref. Feature
  345 (`implementation-ready`) claims config `053` (`docs/roadmap/features/345-authelia-sso/context.md:349`),
  so this spec uses `054`. Only `origin/main-dev` and the story branch are visible in the spec-time
  sandbox, so Steps 5, 10 and 17 re-derive their number from every `origin/*` ref before writing and again
  at the integration PR (ledger `fails.md` 2026-11-10, 281 and 291). The Step 12 lookup is number-free.
- Step 10 needs a reachable Postgres 16 plus `psql` and `migrate` to **generate**
  `scripts/config-wiring-stored.json` (`scripts/config-wiring-stored.py:1-6`). That is artifact
  generation, not verification; if it cannot be generated the unit is blocked (**P-03**) and the JSON is
  never edited by hand (precedent: feature 347 Step 11 and its Deviation Log).
- Before the Steps 8–10 unit merges: owner + config-team approval for the new key; before Steps 5 and 17
  merge: DBA + service owner (root `CLAUDE.md` § Approval Flow).
- Same-file overlaps to re-grep at execute time: `marketdata_service.go` (features 347, 348, both
  code-completed) and `services/xstockstrat-agent/app/tools.py` (feature 343).
- **Open risks carried from `design.md`, with their step:** recovery alert at-most-once → Step 8 (WARN on
  a cut-off send), tested in Step 9; hook timeout can miss a reset or the rebuild → Step 8 (WARN +
  counter), Step 9; re-sent flag alert names only its own tick's lists → Steps 22/23; recovery between a
  claim and a send → Step 14; weekend/holiday recovery lag → Step 9 (closed-day case); a sync spanning a
  load → documented in Step 13; marker timing before portfolio's tick → documented in Step 24; another
  instance's flag invisible until the next load → documented in Step 15; resumed job with `FAILED` results
  outside `failed_symbols` → Step 19; job-level fundamentals failure carries no per-symbol results → Step
  19; union depends on portfolio's tick and deploy-era first-unservable dates → rollout note in Step 8.
- C-16 promotion of this feature's scenarios into the durable suites happens at the integration PR; only
  the three signed-off CHANGE edits are made earlier, in Step 32.

---

### Step 1 — proto: per-symbol backfill results, delisted state, sync and acknowledge RPCs

**Status**: `done`
**Service**: `packages/proto`
**Files**:
- `packages/proto/common/v1/common.proto` — modify
- `packages/proto/marketdata/v1/marketdata.proto` — modify
- `packages/proto/ingest/v1/ingest.proto` — modify
- `packages/proto/portfolio/v1/portfolio.proto` — modify

**Reviewers**: Proto Reviewer — field number uniqueness per message, `buf lint` / `buf breaking` pass; `packages/proto` owner — backward compatibility, naming conventions; `xstockstrat-marketdata` owner — OHLCV ingestion integrity; `xstockstrat-ingest` owner — idempotent ingestion; `xstockstrat-portfolio` owner — concurrent write safety

**Codebase Evidence**:
- `UnservableReason` is the last declaration of `packages/proto/common/v1/common.proto` (`:150-154`); every enum there carries `_UNSPECIFIED = 0` and the type-name value prefix.
- `packages/proto/marketdata/v1/marketdata.proto`: service block `:12-77`, last RPC `GetSymbolServability` `:76`; `BackfillBarsResponse` `:161-165` uses fields 1–3; `BackfillFundamentalsResponse` `:316-319` uses 1–2; the file already imports `common/v1/common.proto` (`:8`).
- `packages/proto/ingest/v1/ingest.proto`: `BackfillJob` `:33-50`, highest field `data_kind = 15`; imports `common/v1/common.proto` (`:8`).
- `packages/proto/portfolio/v1/portfolio.proto`: `WatchlistBinding` `:243-249` uses 1–3; imports `common/v1/common.proto` (`:9`); `RefusedSymbol` `:252-255` already carries `xstockstrat.common.v1.UnservableReason`.
- Additive changes are non-breaking (`docs/runbooks/proto-versioning.md` § "Non-breaking changes"); C-04 (enums with `_UNSPECIFIED = 0`).

**Lands with**: `Step 2`

**TDD**: `N/A (proto)`

**Covers**: —

**Instructions**:
1. `common/v1/common.proto`, appended after `UnservableReason`:
   - `enum BackfillSymbolOutcome { BACKFILL_SYMBOL_OUTCOME_UNSPECIFIED = 0; BACKFILL_SYMBOL_OUTCOME_EMPTY = 1; BACKFILL_SYMBOL_OUTCOME_SKIPPED = 2; BACKFILL_SYMBOL_OUTCOME_FAILED = 3; }`
   - `message BackfillSymbolResult { string symbol = 1; BackfillSymbolOutcome outcome = 2; string reason = 3; }` — one comment line: lists non-written symbols only; `reason` is the source's error text, empty for `EMPTY`.
   - `message DelistedState { UnservableReason reason = 1; string first_unservable_date = 2; }` — one comment line: the date is `YYYY-MM-DD` (NYSE session date), never a timestamp.
2. `marketdata/v1/marketdata.proto`:
   - `BackfillBarsResponse`: add `repeated xstockstrat.common.v1.BackfillSymbolResult symbol_results = 4;`.
   - `BackfillFundamentalsResponse`: add `repeated xstockstrat.common.v1.BackfillSymbolResult symbol_results = 3;`.
   - After `GetSymbolServability` (`:76`) add `rpc SyncWatchlistDelistings(SyncWatchlistDelistingsRequest) returns (SyncWatchlistDelistingsResponse);` and `rpc AckDelistingAlerts(AckDelistingAlertsRequest) returns (AckDelistingAlertsResponse);`, each with a one-line comment "internal: `xstockstrat-portfolio` only".
   - `enum DelistingAlertState { DELISTING_ALERT_STATE_UNSPECIFIED = 0; DELISTING_ALERT_STATE_PENDING = 1; DELISTING_ALERT_STATE_CLAIMED = 2; DELISTING_ALERT_STATE_REDELIVERY = 3; DELISTING_ALERT_STATE_REPORTED = 4; }`
   - `message FlaggedSymbol { string symbol = 1; xstockstrat.common.v1.DelistedState state = 2; DelistingAlertState alert_state = 3; bool unservable_in_current_set = 4; }` — comment: `unservable_in_current_set` false means "do not remove".
   - `message SyncWatchlistDelistingsRequest { repeated string symbols = 1; }`, `message SyncWatchlistDelistingsResponse { repeated FlaggedSymbol flagged = 1; }`, `message AckDelistingAlertsRequest { repeated string symbols = 1; }`, `message AckDelistingAlertsResponse {}` (assumption A-1).
3. `ingest/v1/ingest.proto` `BackfillJob`: add `repeated xstockstrat.common.v1.BackfillSymbolResult symbol_results = 16;`.
4. `portfolio/v1/portfolio.proto` `WatchlistBinding`: add `xstockstrat.common.v1.DelistedState delisted = 4;` — comment: server-set, output only; presence means flagged delisted.
5. No field is removed, renumbered or retyped; no `reserved` statement is added.

**Verification**:
```bash
( cd packages/proto && buf lint && buf breaking --against "$(git rev-parse --path-format=absolute --git-common-dir)#branch=feature/delisted-symbol-handling,subdir=packages/proto" )   # the common-dir form also works inside a git worktree
grep -n "symbol_results = 4\|symbol_results = 3" packages/proto/marketdata/v1/marketdata.proto
grep -n "symbol_results = 16" packages/proto/ingest/v1/ingest.proto
grep -n "delisted = 4" packages/proto/portfolio/v1/portfolio.proto
```

---

### Step 2 — proto-gen: regenerate Go, Python and TypeScript stubs

**Status**: `done`
**Service**: `packages/proto`
**Files**:
- `packages/proto/gen/go/common/v1/common.pb.go` — modify (generated)
- `packages/proto/gen/go/marketdata/v1/marketdata.pb.go` — modify (generated)
- `packages/proto/gen/go/marketdata/v1/marketdata_grpc.pb.go` — modify (generated)
- `packages/proto/gen/go/marketdata/v1/marketdatav1connect/marketdata.connect.go` — modify (generated)
- `packages/proto/gen/go/ingest/v1/ingest.pb.go` — modify (generated)
- `packages/proto/gen/go/ingest/v1/ingest_grpc.pb.go` — modify (generated)
- `packages/proto/gen/go/ingest/v1/ingestv1connect/ingest.connect.go` — modify (generated)
- `packages/proto/gen/go/portfolio/v1/portfolio.pb.go` — modify (generated)
- `packages/proto/gen/go/portfolio/v1/portfolio_grpc.pb.go` — modify (generated)
- `packages/proto/gen/go/portfolio/v1/portfoliov1connect/portfolio.connect.go` — modify (generated)
- `packages/proto/gen/python/common/v1/common_pb2.py` — modify (generated)
- `packages/proto/gen/python/common/v1/common_pb2_grpc.py` — modify (generated)
- `packages/proto/gen/python/marketdata/v1/marketdata_pb2.py` — modify (generated)
- `packages/proto/gen/python/marketdata/v1/marketdata_pb2_grpc.py` — modify (generated)
- `packages/proto/gen/python/ingest/v1/ingest_pb2.py` — modify (generated)
- `packages/proto/gen/python/ingest/v1/ingest_pb2_grpc.py` — modify (generated)
- `packages/proto/gen/python/portfolio/v1/portfolio_pb2.py` — modify (generated)
- `packages/proto/gen/python/portfolio/v1/portfolio_pb2_grpc.py` — modify (generated)
- `packages/proto/gen/ts/common/v1/common.ts` — modify (generated)
- `packages/proto/gen/ts/common/v1/common_pb.ts` — modify (generated)
- `packages/proto/gen/ts/marketdata/v1/marketdata.ts` — modify (generated)
- `packages/proto/gen/ts/marketdata/v1/marketdata_connect.ts` — modify (generated)
- `packages/proto/gen/ts/marketdata/v1/marketdata_pb.ts` — modify (generated)
- `packages/proto/gen/ts/ingest/v1/ingest.ts` — modify (generated)
- `packages/proto/gen/ts/ingest/v1/ingest_connect.ts` — modify (generated)
- `packages/proto/gen/ts/ingest/v1/ingest_pb.ts` — modify (generated)
- `packages/proto/gen/ts/portfolio/v1/portfolio.ts` — modify (generated)
- `packages/proto/gen/ts/portfolio/v1/portfolio_connect.ts` — modify (generated)
- `packages/proto/gen/ts/portfolio/v1/portfolio_pb.ts` — modify (generated)
- `packages/proto/gen/ts/dist/common/v1/common.d.ts` — modify (generated)
- `packages/proto/gen/ts/dist/common/v1/common.js` — modify (generated)
- `packages/proto/gen/ts/dist/common/v1/common_pb.d.ts` — modify (generated)
- `packages/proto/gen/ts/dist/common/v1/common_pb.js` — modify (generated)
- `packages/proto/gen/ts/dist/marketdata/v1/marketdata.d.ts` — modify (generated)
- `packages/proto/gen/ts/dist/marketdata/v1/marketdata.js` — modify (generated)
- `packages/proto/gen/ts/dist/marketdata/v1/marketdata_pb.d.ts` — modify (generated)
- `packages/proto/gen/ts/dist/marketdata/v1/marketdata_pb.js` — modify (generated)
- `packages/proto/gen/ts/dist/ingest/v1/ingest.d.ts` — modify (generated)
- `packages/proto/gen/ts/dist/ingest/v1/ingest.js` — modify (generated)
- `packages/proto/gen/ts/dist/ingest/v1/ingest_pb.d.ts` — modify (generated)
- `packages/proto/gen/ts/dist/ingest/v1/ingest_pb.js` — modify (generated)
- `packages/proto/gen/ts/dist/portfolio/v1/portfolio.d.ts` — modify (generated)
- `packages/proto/gen/ts/dist/portfolio/v1/portfolio.js` — modify (generated)
- `packages/proto/gen/ts/dist/portfolio/v1/portfolio_pb.d.ts` — modify (generated)
- `packages/proto/gen/ts/dist/portfolio/v1/portfolio_pb.js` — modify (generated)

**Reviewers**: Proto Reviewer — field number uniqueness per message, `buf lint` / `buf breaking` pass; `packages/proto` owner — backward compatibility, naming conventions; `xstockstrat-marketdata` owner — OHLCV ingestion integrity; `xstockstrat-ingest` owner — idempotent ingestion; `xstockstrat-portfolio` owner — concurrent write safety

**Codebase Evidence**:
- `./scripts/buf-gen.sh` generates all three languages and compiles the TS package (root `CLAUDE.md` § Generating Proto Stubs); CI `proto-freshness` diffs `packages/proto/gen/`.
- Test doubles embed the generated client interface, so two new marketdata RPCs break no fake: `services/xstockstrat-portfolio/internal/service/portfolio_service_test.go:19-21`, `services/xstockstrat-trading/internal/service/trading_sizing_test.go:33`; the marketdata server adapter embeds `UnimplementedMarketDataServiceServer` (`services/xstockstrat-marketdata/internal/handler/marketdata_handler.go:308-311`).
- Ledger: confirm the `gen/` diff is limited to the touched protos (`fails.md`, proto-plugin drift entry cited in `recon.md` § Risks).

**Lands with**: `Step 1`

**TDD**: `N/A (proto-gen)`

**Covers**: —

**Instructions**:
1. Run `./scripts/buf-gen.sh` (Docker codegen container; without Docker follow `docs/runbooks/codegen-toolchain-host-setup.md`). Never edit a generated file by hand.
2. Confirm the diff under `packages/proto/gen/` touches only the `common`, `marketdata`, `ingest` and `portfolio` packages. Any other changed file means a plugin-version drift: stop and report (**P-03**).
3. `**Files**` lists the generated outputs of those four packages as they exist on this tree (Go, Go connect, Python, TypeScript and the checked-in `gen/ts/dist` outputs). At execute time `git status --porcelain packages/proto/gen/` must show no path outside that list; a generated file that did not change is simply not staged, and a path outside the list blocks the step (**F-08**).

**Verification**:
```bash
./scripts/buf-gen.sh && ! git status --porcelain packages/proto/gen/ | grep -Ev "/(common|marketdata|ingest|portfolio)/"   # nothing outside the four packages; a buf-gen failure fails the line
( cd services/xstockstrat-marketdata && GOWORK=off go build ./... )
( cd services/xstockstrat-portfolio && GOWORK=off go build ./... && GOWORK=off go vet ./... )
( cd services/xstockstrat-trading && GOWORK=off go vet ./... )
( cd services/xstockstrat-ingest && pytest -q tests/test_backfill_jobs.py )   # the regenerated Python stubs import
( cd services/xstockstrat-ui && pnpm exec tsc --noEmit )
```

---

### Step 3 — service: move the NYSE calendar to `packages/proto/marketsession`

**Status**: `done`
**Service**: `xstockstrat-portfolio` (and `packages/proto`)
**Files**:
- `packages/proto/marketsession/marketsession.go` — create (moved)
- `services/xstockstrat-portfolio/internal/marketsession/marketsession.go` — delete
- `services/xstockstrat-portfolio/internal/marketsession/marketsession_test.go` — delete (re-homed by Step 4)
- `services/xstockstrat-portfolio/internal/service/offline_valuation.go` — modify (import path)
- `services/xstockstrat-portfolio/internal/testdata/offline_pnl.go` — modify (import path)
- `packages/proto/CLAUDE.md` — modify
- `services/xstockstrat-portfolio/CLAUDE.md` — modify (`:30` path)

**Reviewers**: `xstockstrat-portfolio` owner — P&L calculation accuracy, position snapshot consistency

**Codebase Evidence**:
- The package: `services/xstockstrat-portfolio/internal/marketsession/marketsession.go` (141 lines) — `SessionDate` `:22`, `DayStart` `:33`, `IsTradingDay` `:47`, `PrevTradingDay` `:56`, `Reference` `:66`; it imports only `time` and `time/tzdata`.
- Exactly two importers: `services/xstockstrat-portfolio/internal/service/offline_valuation.go:17` (uses at `:133-134,173,197,208-212`) and `services/xstockstrat-portfolio/internal/testdata/offline_pnl.go:9` (`:49`) — `grep -rn "internal/marketsession" --include=*.go services`.
- Precedent for a hand-written Go package in the contracts module: `packages/proto/pnl/pnl.go`, imported as `github.com/xstockstrat/contracts/pnl` (`services/xstockstrat-trading/internal/service/trading.go:35`); carve-out text `packages/proto/CLAUDE.md:7-13`.
- Both Go services resolve the module locally: `replace github.com/xstockstrat/contracts => ../../packages/proto` (`services/xstockstrat-portfolio/go.mod:47`, `services/xstockstrat-marketdata/go.mod:49`); both Dockerfiles copy `packages/proto/` whole (`Dockerfile:3` of each), so no Dockerfile change.
- Coverage: `internal/marketsession` is one of the four packages portfolio's CI gate measures. Measured at spec time on this tree: total `73.2%` with it, `79.1%` without it — the move cannot push portfolio under 40%.
- `services/xstockstrat-portfolio/CLAUDE.md:30` names `internal/marketsession`.

**Lands with**: `Step 4`

**TDD**: `red-green required` — red N/A: a relocation with no behavior change; Step 4's re-homed test is the characterization test (`tdd-gate.md` § Interaction, the one allowed escape, stated explicitly).

**Covers**: —

**Instructions**:
1. `git mv` `marketsession.go` to `packages/proto/marketsession/marketsession.go`. Package name, exported API and bodies are unchanged (design §8: "its API unchanged").
2. Re-point the two importers to `github.com/xstockstrat/contracts/marketsession`. No other portfolio file changes.
3. Delete the now-empty `services/xstockstrat-portfolio/internal/marketsession/` directory (its test is re-created by Step 4 in the same commit).
4. `packages/proto/CLAUDE.md`: extend the "Non-generated helper carve-out" paragraph with `marketsession/` (`github.com/xstockstrat/contracts/marketsession`), shared by `xstockstrat-portfolio` and `xstockstrat-marketdata`, tested from the consuming services because no CI job runs `go test` inside `packages/proto/`.
5. `services/xstockstrat-portfolio/CLAUDE.md:30`: replace `internal/marketsession` with `contracts/marketsession` (`packages/proto/marketsession`).
6. Trading-domain: broker coverage, order types, fill handling and `TRADING_MODE` are unaffected by this step.
7. Files count 7 (1 create, 2 deletes, 2 import re-points, 2 CLAUDE.md edits). Not split because the move is one atomic unit with Step 4.

**Verification**:
```bash
test ! -e services/xstockstrat-portfolio/internal/marketsession
! grep -rn "portfolio/internal/marketsession" --include=*.go services
grep -n "contracts/marketsession" services/xstockstrat-portfolio/internal/service/offline_valuation.go services/xstockstrat-portfolio/internal/testdata/offline_pnl.go
( cd services/xstockstrat-portfolio && GOWORK=off go build ./... )
python3 scripts/check-context-map.py
```

---

### Step 4 — test: re-home the calendar characterization test in portfolio

**Status**: `done`
**Service**: `xstockstrat-portfolio`
**Files**:
- `services/xstockstrat-portfolio/internal/service/marketsession_test.go` — create (moved from the deleted package)

**Reviewers**: `xstockstrat-portfolio` owner — P&L calculation accuracy

**Codebase Evidence**:
- The existing test is package-internal and uses the unexported `ny` location (`services/xstockstrat-portfolio/internal/marketsession/marketsession_test.go:1,8`); its five tests are `TestSessionDate_GoldenStagingBars` `:19`, `TestReference` `:35`, `TestPrevTradingDay` `:55`, `TestHolidays_2026_2028` `:67`, `TestDST` `:94`.
- Precedent for testing a contracts helper from a consuming service: `services/xstockstrat-portfolio/internal/service/pnl_fold_test.go:1-13` (package `service`, imports `github.com/xstockstrat/contracts/pnl`).
- C-13: the dates in the test are its own literals with one consumer; they stay inline.

**Lands with**: `Step 3`

**TDD**: `red-green required` — red N/A (characterization test of unchanged behavior); capture the green run.

**Covers**: —

**Instructions**:
1. Create `internal/service/marketsession_test.go`, package `service`, importing `github.com/xstockstrat/contracts/marketsession`. Move the five tests unchanged in assertions; every call becomes `marketsession.<Func>`.
2. Replace the unexported `ny` with a file-local location loaded by `time.LoadLocation("America/New_York")` (fatal on error) in the `nyDate` helper.
3. If any existing test name collides with a name already in package `service`, prefix it `TestMarketsession_`; assertions stay as they are.

**Verification**:
```bash
test "$( cd services/xstockstrat-portfolio && GOWORK=off go test ./internal/service/ -race -count=1 -run '^Test(SessionDate_GoldenStagingBars|Reference|PrevTradingDay|Holidays_2026_2028|DST|Marketsession_.*)$' -v | grep -c '^--- PASS' )" -ge 5   # the five moved tests; anchored so the existing TestValuation_AC50_WeekendFillAfterReference is not counted
go_gate xstockstrat-portfolio
```

---

### Step 5 — migration: marketdata `010_symbol_profile` (profile + watched-symbol tables)

**Status**: `pending`
**Service**: `xstockstrat-marketdata`
**Files**:
- `services/xstockstrat-marketdata/migrations/010_symbol_profile.up.sql` — create
- `services/xstockstrat-marketdata/migrations/010_symbol_profile.down.sql` — create

**Reviewers**: DBA — migration NNN numbering, up+down pair present, index correctness, run-order compliance with `scripts/db-migrate.sh`; `xstockstrat-marketdata` owner — OHLCV ingestion integrity

**Codebase Evidence**:
- Last marketdata migration: `009_symbol_classification` (`ls services/xstockstrat-marketdata/migrations | tail -2`); `007` is unused on purpose (`009_symbol_classification.up.sql:1`). `git log --all -- 'services/xstockstrat-marketdata/migrations/01*'` is empty.
- Shape precedent: `services/xstockstrat-marketdata/migrations/009_symbol_classification.up.sql:4-17` (`CREATE TABLE IF NOT EXISTS marketdata.…`, partial index `IF NOT EXISTS`) and its down (`DROP INDEX IF EXISTS`, `DROP TABLE IF EXISTS`).
- `symbol_classification` is a Type-2 history table with NOT NULL sector columns (`:4-13`), so the profile is a sibling table (design §2).
- Idempotent up-files are the repo norm (`docs/patterns/database.md:60-62`).
- The exact DDL is fixed by `design.md` §2.

**TDD**: `N/A (migration)`

**Covers**: —

**Instructions**:
1. Re-derive the number first: `ls services/xstockstrat-marketdata/migrations | tail -2` and `git log --remotes=origin --format= --name-only -- 'services/xstockstrat-marketdata/migrations/01*' | sort -u`. If `010` is taken on any ref, use the next free number and record the renumber in the Deviation Log.
2. `010_symbol_profile.up.sql`, one header comment line (feature 352), then the DDL of `design.md` §2 with `IF NOT EXISTS` on both tables and the index:
   - `marketdata.symbol_profile`: `symbol TEXT PRIMARY KEY`, `first_unservable_date DATE`, `unservable_reason SMALLINT`, `delisted_at TIMESTAMPTZ`, `alert_claimed_at TIMESTAMPTZ`, `alert_acked_at TIMESTAMPTZ`, `updated_at TIMESTAMPTZ NOT NULL DEFAULT now()`, and the five `CHECK` constraints exactly as in design §2.
   - `CREATE INDEX IF NOT EXISTS symbol_profile_flagged_idx ON marketdata.symbol_profile (symbol) WHERE delisted_at IS NOT NULL;`
   - `marketdata.watched_symbol (symbol TEXT PRIMARY KEY)`.
3. `010_symbol_profile.down.sql`: `DROP TABLE IF EXISTS marketdata.watched_symbol;`, `DROP INDEX IF EXISTS marketdata.symbol_profile_flagged_idx;`, `DROP TABLE IF EXISTS marketdata.symbol_profile;`.
4. Neither file touches another schema or an existing table (C-07, F-01).

**Verification**:
```bash
ls services/xstockstrat-marketdata/migrations/010_symbol_profile.up.sql services/xstockstrat-marketdata/migrations/010_symbol_profile.down.sql
ls services/xstockstrat-marketdata/migrations | tail -2      # the new pair carries the highest number, no duplicate prefix
grep -c "CHECK" services/xstockstrat-marketdata/migrations/010_symbol_profile.up.sql        # 5
# read both: every CREATE in the up has its DROP in the down; no statement names a schema other than marketdata
```

---

### Step 6 — service: `ProfileRepo` — the conditional statements over `symbol_profile` and `watched_symbol`

**Status**: `pending`
**Service**: `xstockstrat-marketdata`
**Files**:
- `services/xstockstrat-marketdata/internal/repository/profile_repo.go` — create

**Reviewers**: `xstockstrat-marketdata` owner — OHLCV ingestion integrity, Alpaca feed idempotency

**Codebase Evidence**:
- Pattern to copy: `services/xstockstrat-marketdata/internal/repository/classification_repo.go` — pool-subset interface `:14-18`, `NewClassificationRepo(r *MarketDataRepo)` sharing `r.pool` `:35-37`, `fmt.Errorf("…: %w")` wrapping `:47-49`.
- `execer` (`Exec`/`QueryRow`/`Query`): `services/xstockstrat-marketdata/internal/repository/marketdata_repo.go:27-31`.
- Production runs unnamed statements under PgBouncer: `services/xstockstrat-marketdata/internal/repository/pool.go:31-33` (`QueryExecModeExec`); no session state may be relied on (debate D-3).
- DATE binding precedent — date-only text with a `::date` cast: `services/xstockstrat-marketdata/internal/repository/marketdata_repo.go:817-822`.
- Ledger: a new typed bind needs an Exec-mode real-DB test (`insights.md`, 2026-11-17 feature 353 entry); a new background deleter copies the SKIP LOCKED shape of the existing one (`insights.md`, 2026-11-17 feature 352 entry).
- **Not found**: any reader or writer of `marketdata.symbol_profile` / `marketdata.watched_symbol` — created from scratch.
- Exported methods on an exported type carry no `unused` lint risk before their first caller (Step 8).

**TDD**: `red-green required`

**Covers**: —

**Instructions**:
Create `profile_repo.go` (package `repository`). `ProfileRepo` holds the shared pool through a `profileDB` interface embedding `execer`; `NewProfileRepo(r *MarketDataRepo) *ProfileRepo` returns `&ProfileRepo{db: r.pool}` (no new pool, **F-06**). Every statement is one autocommitted statement (no `Begin`), binds dates as `time.DateOnly` text cast `::date`, reads dates back as `::text`, and locks the rows it changes in symbol order (`WITH t AS (SELECT symbol … ORDER BY symbol FOR UPDATE) UPDATE … FROM t WHERE p.symbol = t.symbol AND <condition re-checked>`). Row types: `FlaggedRow{Symbol, FirstUnservableDate string, Reason int16, AlertClaimed, AlertAcked bool}`, `ClaimedRow{FlaggedRow; Reclaim bool}`, `RecoveredRow{Symbol string; AlertClaimed bool}`, `SymbolReason{Symbol string; Reason int16}`.

Detection (used by Step 8):
1. `Candidates(ctx) (symbols []string, watched int, err error)` — `watched_symbol` ∪ profile rows with `first_unservable_date IS NOT NULL`, sorted; `watched` is the row count of `watched_symbol`.
2. `ResetServable(ctx, servable []string) (int64, error)` — H1: rows with `delisted_at IS NULL AND first_unservable_date IS NOT NULL AND symbol = ANY($1)` → `first_unservable_date = NULL, unservable_reason = NULL, updated_at = now()`.
3. `ResetUnwatched(ctx) (int64, error)` — H2: the same reset for unflagged started rows whose symbol is not in `watched_symbol`, guarded in the statement by `EXISTS (SELECT 1 FROM marketdata.watched_symbol)` (an empty union resets nothing, debate D-13).
4. `Start(ctx, day string, unservable []SymbolReason) (int64, error)` — H3: for each given symbol that is in `watched_symbol`, insert `(symbol, first_unservable_date = $3::date, unservable_reason)` in symbol order, bound `(symbols, reasons, day)` with `day` as `time.DateOnly` text, `ON CONFLICT (symbol) DO UPDATE … WHERE symbol_profile.first_unservable_date IS NULL` (a started or flagged row is left as is). Symbols and reasons are bound as two parallel arrays (`text[]`, `smallint[]`).
5. `Flag(ctx, cutoff string, unservable []string) ([]string, error)` — H4: rows with `delisted_at IS NULL AND first_unservable_date <= $1::date AND symbol = ANY($2)`, bound `(cutoff, unservable)`, and present in `watched_symbol` → `delisted_at = now()`; `RETURNING symbol`. The window test is inside the statement (debate D-29).
6. `Recover(ctx, servable []string) ([]RecoveredRow, error)` — H5: rows with `delisted_at IS NOT NULL AND symbol = ANY($1)` → all five state columns NULL; returns the symbol and whether `alert_claimed_at` was set before the update (read in the locking CTE).
7. `FlaggedSymbols(ctx) ([]string, error)` — every symbol with `delisted_at IS NOT NULL`.

Sync and acknowledge (used by Step 13):
8. `ReplaceWatched(ctx, symbols []string) error` — two statements in this order: insert the request's symbols absent from the table (`ORDER BY` symbol, `ON CONFLICT DO NOTHING`), then delete the rows not in the request (anti-join on `$1`). An empty slice deletes every row.
9. `ClaimableSymbols(ctx, lease time.Duration) ([]string, error)` — flagged rows with `alert_acked_at IS NULL` and (`alert_claimed_at IS NULL` or `alert_claimed_at < now() - make_interval(secs => $1)`), bound `(lease.Seconds())` — the same form as `ClaimAlerts`; a `time.Duration` is never bound directly.
10. `ClaimAlerts(ctx, symbols []string, lease time.Duration, limit int) ([]ClaimedRow, error)` — the same predicate re-checked, restricted to `symbol = ANY($1)` with the lease as `make_interval(secs => $2)` and `ORDER BY symbol LIMIT $3 FOR UPDATE SKIP LOCKED` in the CTE, bound `(symbols, lease.Seconds(), limit)`; sets `alert_claimed_at = now()`; `Reclaim` is whether `alert_claimed_at` was non-NULL before.
11. `FlaggedIn(ctx, symbols []string) ([]FlaggedRow, error)` — flagged rows with `symbol = ANY($1)`.
12. `AckAlerts(ctx, symbols []string) (int64, error)` — rows with `delisted_at IS NOT NULL AND alert_claimed_at IS NOT NULL AND alert_acked_at IS NULL AND symbol = ANY($1)` → `alert_acked_at = now()`, same ordered-lock shape (debate D-24).

No comment narrates mechanism; at most one two-line constraint comment per statement where a caller relies on it (root `CLAUDE.md` § How to Act #5).

**Verification**:
```bash
( cd services/xstockstrat-marketdata && GOWORK=off go build ./... && GOWORK=off golangci-lint run --modules-download-mode=mod )
grep -c "func (r \*ProfileRepo)" services/xstockstrat-marketdata/internal/repository/profile_repo.go   # >= 12
! grep -n "Begin(" services/xstockstrat-marketdata/internal/repository/profile_repo.go                 # no multi-statement transaction
```

---

### Step 7 — test: `ProfileRepo` against pgxmock and a real database (`dbtest`, Exec mode)

**Status**: `pending`
**Service**: `xstockstrat-marketdata`
**Files**:
- `services/xstockstrat-marketdata/internal/repository/profile_repo_test.go` — create
- `services/xstockstrat-marketdata/internal/repository/profile_repo_dbtest_test.go` — create

**Reviewers**: `xstockstrat-marketdata` owner — OHLCV ingestion integrity

**Codebase Evidence**:
- pgxmock precedent: `services/xstockstrat-marketdata/internal/repository/classification_repo_test.go:14-24` (`newClassMock` builds the repo over `pgxmock.NewPool()`), expectations `:28-36`.
- Real-DB precedent: `services/xstockstrat-marketdata/internal/repository/fundamentals_replace_dbtest_test.go:1` (`//go:build dbtest`), `dbtestRepo` `:21-31` (reads `MARKETDATA_DB_TEST_URL`, Exec mode, fatal when unset under `CI=true`), row-scoping prefix `dbtestSymbolPrefix` `:17`.
- CI runs them: job `marketdata-db-test`, `go test -tags dbtest -race -count=1 ./internal/repository/...` (`.github/workflows/ci.yml:1068-1116`), against a database migrated by the migrator image — so Step 5's tables exist there.
- Local verification form for a `dbtest` file: feature 348 Step 12 (`docs/roadmap/features/348-fix-edgar-historical-fundamentals/implementation-spec.md:1169-1172`).
- C-13: the symbols are prefixed scratch literals used by this file only — inline is compliant.

**TDD**: `red-green required`

**Covers**: `AC-1, AC-9, AC-21, AC-27`

**Instructions**:
1. `profile_repo_test.go` (pgxmock): one test per method, each named `TestProfileRepo_<Method>…`, asserting the statement is issued once with the expected argument shapes (date-only strings, arrays), that `RETURNING` rows are mapped to the row types, and that a driver error is wrapped and returned. `ReplaceWatched` asserts insert-then-delete order and that an empty slice issues the delete.
2. `profile_repo_dbtest_test.go` (`//go:build dbtest`, package `repository`), using `dbtestRepo` and a new file-local const `profileDBSymbolPrefix = "ZZ352_"` (not `dbtestSymbolPrefix`, which this package already declares as `"ZZ348_"` under the same build tag) with cleanup of exactly the rows it creates in both tables:
   - **@AC-21** `Start` creates a row with the given date and reason and `delisted_at` NULL for a watched symbol, and creates none for a symbol not in `watched_symbol`.
   - **@AC-1** `Flag` with a cutoff equal to the row's date flags it; with a cutoff one day earlier it does not; an unwatched started row is not flagged.
   - **@AC-27** `ResetUnwatched` leaves a flagged row untouched and resets an unflagged started row that left the union; with an empty `watched_symbol` it resets nothing. `Recover` clears a flagged row whatever the union holds and reports `AlertClaimed` correctly for a claimed and an unclaimed row.
   - `ResetServable` resets only unflagged started rows.
   - Claim lifecycle: first `ClaimAlerts` returns `Reclaim=false`; a second call inside the lease returns nothing; after the lease (pass a zero lease) it returns `Reclaim=true`; `AckAlerts` then makes the row unclaimable; the limit is honoured; `FlaggedIn` reads the acknowledged state.
   - The five `CHECK` constraints reject a row that violates them (one insert per constraint).
   - **@AC-9 (guard)** after `Start` and `Flag` for a symbol, a bar row and a `fundamentals_history` row seeded for that symbol are still returned by `QueryBars` and `ListHistoricalRows`. This passes on today's code by construction; it fails only if a later change makes a profile statement touch stored data.
3. Name every real-database test `TestProfileDB_…` so the CI job and the local check below select them.
4. RED: with `profile_repo.go` present as method signatures returning zero values, the pgxmock tests fail on unmet expectations.

**Verification**:
```bash
test "$( cd services/xstockstrat-marketdata && GOWORK=off go test ./internal/repository/ -race -count=1 -run 'TestProfileRepo_' -v | grep -c '^--- PASS' )" -ge 12   # one top-level test per method
GOWORK=off go -C services/xstockstrat-marketdata vet -tags dbtest ./internal/repository/...
GOWORK=off go -C services/xstockstrat-marketdata test -tags dbtest ./internal/repository/... -count=1 -run 'ProfileDB' -v | grep -c '^--- SKIP'   # >= 1 locally (no URL); CI job marketdata-db-test runs them
! CI=true GOWORK=off go -C services/xstockstrat-marketdata test -tags dbtest ./internal/repository/... -count=1 -run 'ProfileDB'   # fails closed without the URL
go_gate xstockstrat-marketdata
grep -rn "ZZ352_" --include="*_test.go" services/xstockstrat-marketdata | cut -d: -f1 | sort -u | wc -l   # 1 file (C-13: single consumer)
```

---

### Step 8 — service: delisting detection hook, confirmation-window reader, flagged set, recovery alert

**Status**: `pending`
**Service**: `xstockstrat-marketdata`
**Files**:
- `services/xstockstrat-marketdata/internal/service/delisting.go` — create
- `services/xstockstrat-marketdata/internal/service/asset_servability.go` — modify
- `services/xstockstrat-marketdata/internal/service/marketdata_service.go` — modify
- `services/xstockstrat-marketdata/internal/telemetry/otel.go` — modify
- `services/xstockstrat-marketdata/cmd/server/main.go` — modify
- `services/xstockstrat-marketdata/CLAUDE.md` — modify
- `services/xstockstrat-marketdata/docs/context-constitution.md` — modify (MARKETDATA-16)
- `docs/runbooks/delisting-rollout.md` — create
- `docs/runbooks/CLAUDE.md` — modify (index row)

**Reviewers**: `xstockstrat-marketdata` owner — OHLCV ingestion integrity, Alpaca feed idempotency

**Codebase Evidence**:
- `refreshAssets`: `services/xstockstrat-marketdata/internal/service/asset_servability.go:113-150` — failed load returns at `:124`, rejected load at `:133`, single commit point `s.assets.snap.Store(next)` `:135`, early return for a non-first load `:136-138`, first-load warm prune `:139-148`.
- `classify` `:46-58` (nil receiver fails open); `assetServabilityState` `:74-77`; `resolveAssetRefreshInterval` `:169-181` reads `cfg.GetInt(assetRefreshHoursKey, …)` on `intGetter`; the refresher passes `s.budgetCfg` `:205`; `StartAssetSetRefresher` `:185`, first attempt `:197`. The refresher runs on the long-lived main ctx with no propagation headers by design (`:184`).
- `intGetter`: `marketdata_service.go:133-136`; `budgetCfg` is assigned only when the watcher is non-nil (`:253-255`).
- Clock seam to copy: `etfFlagState.now` and `clock()` — `services/xstockstrat-marketdata/internal/service/etf_flags.go:47,68-73`.
- Warm set: `warmMu`/`warmSymbols` `marketdata_service.go:53-55`; ungated `markWarm` `:1167-1174`; `warmSnapshot` `:1178-1186` is the bar ingester's only symbol source (`:1378-1379`); the warm-quote poller copies the set inline `:1213-1218`.
- Alert emitters: `emitWarning` `:2160-2171` (WARNING, category `system`, title built from a provider); its only caller is `maybeAlertQuota` `:2154`. Notify client field `:44`.
- Setter precedent taking an unexported interface: `SetClassification` `services/xstockstrat-marketdata/internal/service/classification_service.go:52`; wiring `cmd/server/main.go:144-145`.
- Counter pattern: `NewCounter` `services/xstockstrat-marketdata/internal/telemetry/otel.go:191`, declarations `:372-379`, label keys `:314-316`, recorder shape `RecordBackfillSymbol` `:419-421`.
- Calendar: `github.com/xstockstrat/contracts/marketsession` (Step 3) — `DayStart`, `IsTradingDay`, `PrevTradingDay`. `SessionDate` shifts by +6 h and must not be used (design §3).
- Existing asset tests build `&MarketDataService{registry: reg, warmSymbols: …}` with no store (`asset_servability_test.go:50-55`), so the hook must be a no-op when no store is wired.
- Config-key contract (**C-05**): namespace `marketdata`, key `assets.delisting_confirmation_trading_days`, `value_type` `int`, code default `5`, reader `services/xstockstrat-marketdata/internal/service/asset_servability.go:resolveDelistingConfirmationDays`, seed migration Step 10 (`054`), live mechanism: marketdata's `WatchConfig` watcher (`s.budgetCfg`), re-read at each successful asset-set load. `grep -rn "delisting_confirmation" services scripts` → no match today.
- Runbook index: `docs/runbooks/CLAUDE.md:5-6` (table `| File | Purpose | Key trigger |`, one row per runbook; the order is not strictly alphabetical, and the new row goes between `db-seed-migration-state.md` `:8` and `hotfix-log.md` `:9`); the sanctioned way to run operator SQL is `docs/runbooks/operator-db-access.md` (indexed at `:12`). `ls docs/runbooks | grep -i delist` → no match today.
- MARKETDATA-16 text: `services/xstockstrat-marketdata/docs/context-constitution.md:29`. CLAUDE.md anchors: config row `:71`, § Asset-set servability `:126-143` ("only the **first** successful load prunes" `:139`, residual R2 `:141-142`), § Database `:95-106`.

**Lands with**: `Step 9, Step 10`

**TDD**: `red-green required`

**Covers**: —

**Instructions**:
1. **Constants.** In the const block of `asset_servability.go` (`:18-28`) add `delistingConfirmationDaysKey = "assets.delisting_confirmation_trading_days"`, `defaultDelistingConfirmationDays = 5`, `maxDelistingConfirmationDays = 30`. In `delisting.go` add the operator-approved fixed values `delistingHookTimeout = 30 * time.Second`, `delistingAlertSendTimeout = 15 * time.Second` and `delistingAlertCategory = "symbol_delisting"`.
2. **Reader.** After `resolveAssetRefreshInterval` add `resolveDelistingConfirmationDays(cfg intGetter) int`: nil `cfg` → 5; `v := cfg.GetInt(delistingConfirmationDaysKey, defaultDelistingConfirmationDays)`; `v <= 0` → 5; `v > 30` → 30; else `v`.
3. **Clock seam.** Add `now func() time.Time` to `assetServabilityState` and a `clock()` method (nil → `time.Now`), copied from `etfFlagState`.
4. **State and store seam** (`delisting.go`). Declare `profileStore`, an interface with the twelve `ProfileRepo` methods of Step 6, and a `delistingState{ store profileStore; flagged atomic.Pointer[map[string]struct{}] }` held as a new field `delisting` on `MarketDataService` (zero value = feature off). Add `SetSymbolProfiles(store profileStore)`.
5. **Flagged-set rebuild** `loadFlaggedSet(ctx) error`: read `FlaggedSymbols`, store the new set, then delete every flagged symbol from `warmSymbols` under `warmMu` (held for the deletion only, never across the database call).
6. **Parameterised emitter** `emitNotice(ctx, title, category, body string) error`: one `s.notify.EmitAlert` with severity WARNING, `SourceService: "marketdata"`, no `TargetUserId`; it returns the error. Rewrite `emitWarning` to build its existing title and call `emitNotice(ctx, title, "system", msg)`, logging the error with its existing WARN text — behavior of `maybeAlertQuota` is unchanged.
7. **Hook** `runDelistingHook(ctx context.Context, next *assetSet)`:
   - Return at once when `s.delisting.store == nil`.
   - Run everything under `context.WithTimeout(ctx, delistingHookTimeout)`.
   - `d := marketsession.DayStart(s.assets.clock())`. Transitions run only when `marketsession.IsTradingDay(d)`.
   - On a trading day: `Candidates`; classify each candidate against `next` (`classify`) into a servable list and an unservable list with reasons; `n := resolveDelistingConfirmationDays(s.budgetCfg)`; cutoff `c` = `d` stepped back `n-1` times with `PrevTradingDay`, formatted `time.DateOnly`; then, in order and stopping at the first error: `ResetServable(servable)` (H1), `ResetUnwatched()` (H2), `Start(d, unservable)` (H3), `Flag(c, unservable symbols)` (H4), `Recover(servable)` (H5).
   - After the statements — completed, stopped at an error, or skipped on a closed day — call `loadFlaggedSet`. Only expiry of the hook context prevents it.
   - Then send one recovery alert per `RecoveredRow` whose `AlertClaimed` is true, each under `context.WithTimeout(hookCtx, delistingAlertSendTimeout)`, through `emitNotice` with category `delistingAlertCategory`, title `symbol servable again` and a body naming the symbol and stating that the delisted flag was cleared and that the symbol is not re-added to system-managed watchlists. A failed or cut-off send is logged at WARN and not retried (accepted at-most-once residual).
   - A statement error, or an expired hook context, logs one WARN `delisting hook failed` and records `telemetry.RecordDelistingHookFailure` with reason `error` or `timeout`. The hook returns nothing: it can never fail the asset load.
   - One INFO `delisting hook` per run with the per-step counts, the watched count, and `skipped` = `closed_day`, `empty_union` (watched count 0: H2 skipped, H3 and H4 have no candidates) or empty.
   - The stored reason is the one passed to `Start`; H4 does not refresh it.
8. **`refreshAssets` restructure** (`:135-149`): keep `snap.Store(next)`; run the existing warm prune and its INFO only when `prev == nil` (as today); then call `s.runDelistingHook(ctx, next)` on both the first-load and later-load paths; return nil. The shrink guard and the two early error returns are untouched, so a rejected or failed load never reaches the hook. `markWarm` and `markWarmIfServable` are not changed (design R-7).
9. **Boot load.** At the top of `StartAssetSetRefresher`, before `attempt()` (`:197`), when a store is wired call `loadFlaggedSet` under a `delistingHookTimeout` context; an error is a WARN, never fatal. This load does not depend on the asset load succeeding (debate D-15).
10. **Telemetry.** Add `delistingHookFailures = NewCounter("marketdata.delisting.hook_failures")`, constants `DelistingHookTimeout = "timeout"` / `DelistingHookError = "error"` and `RecordDelistingHookFailure(ctx, reason)` using `KeyReason`. No new label key.
11. **Wiring.** `cmd/server/main.go`, after `svc.SetEtfFlagSource(fmpClient)` (`:145`): `svc.SetSymbolProfiles(repository.NewProfileRepo(repo))`. No new goroutine, pool, env var or endpoint.
12. **`services/xstockstrat-marketdata/CLAUDE.md`:**
    - Config table: add the `assets.delisting_confirmation_trading_days` row after `assets.refresh_interval_hours` (`:71`) — int, `5`, read clamp nil/`<= 0` → 5 and `> 30` → 30, re-read at each asset-set load, seeded by config migration `<NNN>_marketdata_delisting_confirmation_days` (`<NNN>` = the number Step 10 landed — `054` expected; see Step 10's Deviation Log entry if renumbered), SetConfig-bounded `[1,30]`.
    - § Database: add `marketdata.symbol_profile` (one row per symbol, written lazily, state columns nulled — never deleted — on reset or recovery) and `marketdata.watched_symbol` (marketdata's copy of portfolio's watchlist symbol union; holds no state).
    - § Asset-set servability: replace "only the **first** successful load prunes the warm set of unservable symbols" with: the first successful load prunes unservable symbols, and every successful load removes flagged-delisted symbols; replace residual R2 with: a symbol that becomes unservable after it was warmed stays warm until it is flagged delisted (feature 352).
    - New section "Delisted-symbol detection (feature 352)": the hook order and truth table by reference to the five statements, the single-decider rule (the hook is the only writer of profile state), the fixed values (hook limit 30 s, per-alert send 15 s), the rule that a quote read re-warms a flagged symbol until the next load, and a one-line pointer "Rollout and the first-flag burst → `docs/runbooks/delisting-rollout.md`".
    - § Observability: add the counter `marketdata.delisting.hook_failures{reason timeout|error}` and the INFO `delisting hook`.
13. **Rollout runbook** (design §10, assumption A-5). Create `docs/runbooks/delisting-rollout.md` — prerequisites, steps, verification, like its siblings: at deploy both tables are empty; the boot load starts nothing; portfolio's first tick fills `marketdata.watched_symbol`; the first asset-set load after that starts every currently unservable watchlist symbol, dated that day; `N` trading days later (`N` = `marketdata` / `assets.delisting_confirmation_trading_days`) one load flags them together, and portfolio removes and alerts for at most 100 per prune tick, so a burst of K drains over ⌈K/100⌉ ticks. The size of the coming burst is `SELECT count(*) FROM marketdata.symbol_profile WHERE delisted_at IS NULL AND first_unservable_date IS NOT NULL;`, run per `docs/runbooks/operator-db-access.md` — the runbook's only command is this SQL query, so the macOS-compatibility rule for shell commands in docs has nothing to check. State that first-unservable dates of symbols already dead at deploy are deploy-era dates, that the burst is deferred by raising `marketdata` / `assets.delisting_confirmation_trading_days` (SetConfig, bounds [1,30]) through the config UI before day `N` — no command is run by this runbook —, that portfolio deployed ahead of marketdata gets `Unimplemented` and removes nothing, and that detection depends on portfolio's tick (a portfolio outage freezes the last union). Add its row to the table in `docs/runbooks/CLAUDE.md` between the `db-seed-migration-state.md` row (`:8`) and the `hotfix-log.md` row (`:9`): file `delisting-rollout.md`, purpose "First rollout of delisted-symbol detection (feature 352): what happens at deploy, how to size the first-flag alert burst, how to defer it", key trigger "Deploying feature 352; expecting or seeing a burst of `symbol_delisting` alerts".
14. **MARKETDATA-16** (`docs/context-constitution.md:29`): keep "the gate applies at warm-add sites only"; add that the feature-352 hook is the one remover besides the first-load prune, that it removes flagged-delisted symbols at every successful load, and that `markWarm` stays ungated so a held flagged symbol is re-warmed by the next quote read.
15. No header-propagation change: the hook's `EmitAlert` reuses the existing notify client and interceptor (`marketdata_service.go:229`), on the same header-less background context the refresher already uses.
16. Files count 9 (seven code and service-doc files, plus the runbook and its index row). Not split because the hook, reader, telemetry, wiring and documents land as the Step 8–10 atomic unit, and the marketdata CLAUDE.md pointer to `docs/runbooks/delisting-rollout.md` must resolve under `check-context-map.py` in the same commit.
17. Broker symmetry: marketdata is the only Alpaca market-data integration and detection reads only the Alpaca asset set; IBKR has no marketdata path, so no IBKR counterpart exists. `TRADING_MODE`, order types and fills are unaffected.

**Verification** (run as the Steps 8–10 unit):
```bash
( cd services/xstockstrat-marketdata && GOWORK=off go build ./... && GOWORK=off golangci-lint run --modules-download-mode=mod )
grep -n "runDelistingHook" services/xstockstrat-marketdata/internal/service/asset_servability.go     # one call, after snap.Store
grep -n "SetSymbolProfiles" services/xstockstrat-marketdata/cmd/server/main.go
! grep -n "SessionDate" services/xstockstrat-marketdata/internal/service/delisting.go
grep -n "assets.delisting_confirmation_trading_days" services/xstockstrat-marketdata/CLAUDE.md services/xstockstrat-marketdata/internal/service/asset_servability.go
grep -c "symbol_profile" docs/runbooks/delisting-rollout.md                 # >= 1 (the burst-count query)
grep -n "delisting-rollout.md" docs/runbooks/CLAUDE.md services/xstockstrat-marketdata/CLAUDE.md   # index row + pointer
python3 scripts/check-context-map.py
```

---

### Step 9 — test: detection hook, window counting, warm-set removal, recovery alert

**Status**: `pending`
**Service**: `xstockstrat-marketdata`
**Files**:
- `services/xstockstrat-marketdata/internal/service/delisting_test.go` — create
- `services/xstockstrat-marketdata/internal/service/telemetry_allowlist_test.go` — modify
- `services/xstockstrat-marketdata/internal/testdata/assets.go` — modify

**Reviewers**: `xstockstrat-marketdata` owner — OHLCV ingestion integrity

**Codebase Evidence**:
- Harness to reuse **unchanged** (`asset_servability_test.go` is not edited; the new helper in `delisting_test.go` sets `assets.now` on the service it builds): `fakeAssetSource`, `assetReply`, `newAssetSvc`, `withoutSymbol`, `mustRefresh`, `isWarm` — `services/xstockstrat-marketdata/internal/service/asset_servability_test.go:26-91`; `fakeIntGetter` `marketdata_service_test.go:2070`; `fakeNotify` `:325-335` (counts WARNING alerts); `recordingBarsSource` `bar_hold_test.go:45`.
- `TestAssetSet_FirstLoadPrunesWarmSet` (`asset_servability_test.go:270-289`) asserts an **unflagged** symbol stays warm on a later refresh; with no store wired it must keep passing unchanged.
- Reader-test precedent incl. the literal-key wiring test: `TestResolveAssetRefreshInterval` `:292-310`, `TestResolveAssetRefreshInterval_ReadsSeededKey` `:313-318`.
- Allow-list test: `minInstruments` `telemetry_allowlist_test.go:38-42`, `driveAllInstruments` `:46-55`.
- Fixture home (C-13): `services/xstockstrat-marketdata/internal/testdata/assets.go` already holds the feature-282 symbols and `ServableAssets()`.
- Ledger: recording fakes snapshot arguments at call entry (`fails.md` 2026-11-10, 290); every new scenario states which package drives it and whether it fails on today's code (`fails.md` 2026-11-16, 347).

**Lands with**: `Step 8, Step 10`

**TDD**: `red-green required`

**Covers**: `AC-1, AC-2, AC-3, AC-4, AC-5, AC-8, AC-10, AC-19, AC-20, AC-21, AC-25, AC-27, AC-28, AC-29`

**Instructions**:
1. **Fixtures.** Add to `internal/testdata/assets.go` the symbols this feature's scenarios name and that Steps 14 and 16 also use (`Roku`, `Atch`, `Shph`, `Psky`, `Nwe`, `Kpti`, `Axia`) and one helper returning `ServableAssets()` plus a given symbol on NASDAQ. Dates stay inline in the test (one consumer).
2. **Fake store.** In `delisting_test.go` declare `fakeProfileStore`, an in-memory model of the two tables that implements all twelve `profileStore` methods with the semantics of Step 6 (it is reused by Steps 14 and 16), records the method call order, snapshots slice arguments at call entry, and can be scripted to return an error or to block until its context ends for one named method. A helper builds a service from `newAssetSvc(replies…)` with the fake store, a `fakeNotify`, a `fakeIntGetter` and `assets.now` fixed to a given New York wall-clock time.
3. **Scenario tests** (each scenario test is named `TestDelisting_AC<n>_…` and carries a `// @AC-<n>` comment — the `grep -c "@AC-"` below counts those comments; every one drives `refreshAssets` through `mustRefresh`, never the hook directly). Name every scenario and mechanism test of this file `TestDelisting_…` (scenario tests `TestDelisting_AC<n>_…`), so the `-run` filter of the Verification selects them:
   - **@AC-1** absent Mon 2026-11-09 through Fri 2026-11-13, one load per trading day → flagged on the Friday load with reason `UNSERVABLE_REASON_NOT_TRADABLE` and first-unservable date `2026-11-09`.
   - **@AC-2** first absent 2026-11-16, load on 2026-11-17 → started, not flagged, and still in the warm set after the load.
   - **@AC-3** a refresh rejected by the shrink guard (use `testdata.SyntheticAssets`) → the fake store records zero calls. Paired control in the same test: a following accepted 13 500-asset refresh without `AAPL` on a later trading day records one `Start` call naming `AAPL`; RED fails on this assertion.
   - **@AC-4** and **@AC-5**: two tests, `TestDelisting_AC4_…` and `TestDelisting_AC5_…`, each with its own `// @AC-<n>` line. **@AC-4**: a flagged symbol that is in `watched_symbol` and servable in the next trading-day load → H5 clears it. **@AC-5**: a flagged symbol that is absent from `watched_symbol` and servable in the next trading-day load → H5 clears it, and the hook writes nothing to `watched_symbol`.
   - **@AC-8** `AAPL` and `ROKU` warm; after the load that flags `ROKU`, `isWarm(ROKU)` is false with the same service instance, `warmSnapshot()` holds `AAPL` only, and one `ingestRecentBars` pass over a `recordingBarsSource` requests `AAPL` and not `ROKU`.
   - **@AC-10 (guard)** after `NWE` is flagged, `svc.markWarm("NWE")` (the quote/price path) warms it again and the next load removes it again. Passes on today's code for the first half; it guards that `markWarm` gains no flagged check.
   - **@AC-19** a second service instance built over the same fake store reports the symbol in its flagged set after `StartAssetSetRefresher`'s boot load alone, with the asset source scripted to fail.
   - **@AC-20** first absent Fri 2026-11-13: not flagged by the Wed 2026-11-18 load, flagged by the Thu 2026-11-19 load with date `2026-11-13`.
   - **@AC-21** a load with `AAPL` and without `ROKU` → a row for `ROKU` (date, reason, not flagged) and no row for `AAPL`.
   - **@AC-25** absent 2026-11-16 and -17, servable 2026-11-18, absent from 2026-11-19 → not flagged on 2026-11-24, flagged on Wed 2026-11-25 with date `2026-11-19`.
   - **@AC-27** a flagged symbol absent from `watched_symbol` stays flagged on the next trading-day load and is cleared by a later load that lists it.
   - **@AC-28** first absent 2026-11-09, no load on 2026-11-10 and -11, load on 2026-11-13 → flagged with date `2026-11-09`.
   - **@AC-29** recovery of a row whose alert was claimed emits exactly one WARNING with category `symbol_delisting` naming the symbol; the next load emits none; recovery of an unclaimed row emits none.
4. **Mechanism tests:**
   - The truth table of `design.md` §3, one sub-test per cell (row state × servable now × union membership, including the empty-union column).
   - Statement order H1→H5, and the rebuild runs after them and before any recovery alert.
   - Closed day (Saturday): no statement H1–H5 is called, the rebuild still runs, the INFO carries `closed_day`.
   - The New York date: a load at Friday 17:59 and one at Friday 18:01 New York time both use Friday as `d`.
   - Window config: the reader table (nil, `0`, `-1` → 5; `31` → 30; `7` → 7); `N = 1` starts and flags on the same load; a changed value applies on the next load without a restart.
   - Wiring (b): `resolveDelistingConfirmationDays(fakeIntGetter{"assets.delisting_confirmation_trading_days": 7}) == 7`, with the key written as a literal, not the constant.
   - Error: a scripted error at H3 → H4 and H5 are not called, the rebuild is, `marketdata.delisting.hook_failures{reason=error}` is 1, and `refreshAssets` returns nil.
   - Timeout: a store that blocks, driven with a parent context that expires in tens of milliseconds → reason `timeout`, `refreshAssets` returns nil. Assert the deadline relative to the time recorded at call entry.
   - A notify stub that blocks on the recovery alert does not prevent the flagged-set rebuild.
   - No store wired → the hook is a no-op (the existing asset tests are this case).
5. `telemetry_allowlist_test.go`: add `marketdata.delisting.hook_failures` to `minInstruments` and one `telemetry.RecordDelistingHookFailure` call to `driveAllInstruments`.
6. RED (per `tdd-gate.md`): with Step 8's symbols present as signatures and `runDelistingHook` an empty body, the `@AC-1` test fails on "not flagged". AC-10 is the declared guard.

**Verification** (run as the Steps 8–10 unit):
```bash
test "$( cd services/xstockstrat-marketdata && GOWORK=off go test ./internal/service/ -race -count=1 -run 'TestDelisting_' -v | grep -c '^--- PASS' )" -ge 20   # 14 scenario tests + the mechanism tests (top-level only; sub-tests are not counted)
( cd services/xstockstrat-marketdata && GOWORK=off go test ./internal/service/ -race -count=1 -run 'AssetSet|ResolveDelisting|Allowlist' )   # the existing asset-set and allow-list tests stay green
go_gate xstockstrat-marketdata
test "$(grep -c "@AC-" services/xstockstrat-marketdata/internal/service/delisting_test.go)" -ge 14
grep -rn "Psky *=" --include="*.go" services/xstockstrat-marketdata | wc -l   # 1 declaration site (C-13)
```

---

### Step 10 — migration: config `054` seeds `assets.delisting_confirmation_trading_days`

**Status**: `pending`
**Service**: `xstockstrat-config`
**Files**:
- `services/xstockstrat-config/migrations/054_marketdata_delisting_confirmation_days.up.sql` — create
- `services/xstockstrat-config/migrations/054_marketdata_delisting_confirmation_days.down.sql` — create
- `scripts/config-wiring-stored.json` — modify (generated by `scripts/config-wiring-stored.py`)
- `docs/patterns/config-governance.md` — modify

**Reviewers**: DBA — migration NNN numbering, up+down pair present, run-order compliance with `scripts/db-migrate.sh`; `xstockstrat-config` owner — config key naming, environment / global-per-user scoping, WatchConfig stream stability

**Codebase Evidence**:
- Last config migration on this tree: `052_alpaca_adaptive_rate_limit_keys` (`ls services/xstockstrat-config/migrations | tail -2`); `053` is claimed by feature 345 (`docs/roadmap/features/345-authelia-sso/context.md:349`) and is on no visible ref.
- Seed shape (namespace-relative key, one global row per environment, sentinel actor, insert-if-absent): `services/xstockstrat-config/migrations/052_alpaca_adaptive_rate_limit_keys.up.sql:4-19`; guarded down `052_…down.sql:4-10` (sentinel actor, `user_id IS NULL`, seeded `value_data`).
- The checker reads seeds only from `scripts/config-wiring-stored.json`; a seeded, read key also needs a description, a `consuming_service`, a matching `value_type` and `default_value` (`docs/patterns/config-governance.md:64-96`; feature 347 Step 11 evidence).
- Regeneration in CI: job `config-wiring-stored` builds `scripts/Dockerfile.migrate`, runs `scripts/config-wiring-stored.py`, then the fresh heal dry-run diff (`.github/workflows/ci.yml:1301`, feature 347 Step 11 Instruction 4).
- Registered-keys log: `docs/patterns/config-governance.md:145`, newest first, newest entry feature 347 at `:151`; sibling key row for the format `:278`.
- Ledger: a key is registered by its seed plus its reader, never by a `scripts/config-wiring.json` entry (`fails.md` 2026-11-10, 291 "config"); a seed migration's down deletes only rows it can prove it wrote.
- No `scripts/config-wiring.json` baseline entry is added or removed: the seed and the reader land in one commit.

**Lands with**: `Step 8, Step 9`

**TDD**: `N/A (migration)`

**Covers**: —

**Instructions**:
1. Re-derive the number first (`ls services/xstockstrat-config/migrations | tail -2`, and `git log --remotes=origin --format= --name-only -- 'services/xstockstrat-config/migrations/05*' | sort -u`). If `054` is taken, or `053` is still free on every ref and feature 345 has been renumbered, use the next free number above every claimed one and record it in the Deviation Log. Step 12's lookup is number-free.
2. `…up.sql`: a two-line header in the `052` style, then one `INSERT INTO config.config_values (namespace, key, value_type, value_data, description, default_value, consuming_service, updated_by, environment, user_id)` with two rows — `('marketdata', 'assets.delisting_confirmation_trading_days', 'int', '5', '<description>', '5', 'xstockstrat-marketdata', 'system:config-migration-feature-delisted-symbol-handling', '<env>', NULL)` for `staging` and `production` — ending `ON CONFLICT (namespace, key, environment, COALESCE(user_id, '')) DO NOTHING`.
   - Description (same on both rows, no single quote, no semicolon): `Marketdata delisting detection: trading days a watchlist symbol must stay unservable in every successful asset-set load before it is flagged delisted. The first unservable day counts as day 1. Read at each asset-set load. A value above 30 reads as 30 and a value of 0 or less reads as 5.`
3. `…down.sql`: one `DELETE FROM config.config_values` restricted to `namespace = 'marketdata'`, the key, `environment IN ('staging', 'production')`, `user_id IS NULL`, the sentinel `updated_by` and `value_data = '5'`. A row an operator changed is never deleted.
4. Regenerate the stored set in the CI form: `docker build -f scripts/Dockerfile.migrate -t xstockstrat-migrate-ci .`, then `docker run --rm --network host -e DATABASE_URL="<scratch Postgres 16>" -v "$PWD:/repo" -w /repo --entrypoint python3 xstockstrat-migrate-ci scripts/config-wiring-stored.py`; on a host with `migrate` and `psql`, `DATABASE_URL=<scratch postgres> python3 scripts/config-wiring-stored.py` is equivalent. Then run `scripts/config-heal-dryrun.py --fresh` against the same database and confirm `git diff --exit-code scripts/config-heal/dryrun-fresh.tsv`. Commit the JSON unedited. If neither route is available the unit is blocked (**P-03**).
5. `docs/patterns/config-governance.md`: add a "feature 352 — delisted-symbol-handling (`xstockstrat-marketdata` / `xstockstrat-config`)" entry at the top of § Per-Feature Registered Keys (above `:151`), modelled on the feature 282 entry (`:267-283`): what the key does, the row (namespace, key, int, default 5, bounds `[1,30]`, read clamp, reader `resolveDelistingConfirmationDays`), seeded in staging and production by `marketdata_delisting_confirmation_days` with the number-free sentinel, the guarded down, approval owner + config team.
6. No env var or deployment file changes.

**Verification** (run as the Steps 8–10 unit):
```bash
ls services/xstockstrat-config/migrations/*_marketdata_delisting_confirmation_days.up.sql services/xstockstrat-config/migrations/*_marketdata_delisting_confirmation_days.down.sql
ls services/xstockstrat-config/migrations | tail -2      # the new pair carries the highest number, no duplicate prefix
# read both: 2 rows, relative key, sentinel actor; the down deletes exactly what the up inserts
node scripts/check-config-wiring.mjs --keys marketdata.assets.delisting_confirmation_trading_days   # silent, exit 0
node scripts/check-config-wiring.mjs --final        # exit 0: no STALE-STORED, no read-unseeded, no type/default/metadata finding
node scripts/check-config-wiring.mjs --doc-check    # exit 0
node --test scripts/config-wiring.test.mjs
grep -c '"key": "assets.delisting_confirmation_trading_days"' scripts/config-wiring-stored.json   # 2
! grep -q "delisting_confirmation" scripts/config-wiring.json                                     # no baseline entry
git diff --exit-code scripts/config-heal/dryrun-fresh.tsv
```

---

### Step 11 — service: SetConfig bounds `[1, 30]` for the confirmation window

**Status**: `pending`
**Service**: `xstockstrat-config`
**Files**:
- `services/xstockstrat-config/src/grpc/configServiceImpl.ts` — modify

**Reviewers**: `xstockstrat-config` owner — config key naming, environment / global-per-user scoping

**Codebase Evidence**:
- `SCALAR_BOUNDS_REGISTRY`: `services/xstockstrat-config/src/grpc/configServiceImpl.ts:114`, keyed by the display FQN; sibling row `'marketdata.assets.refresh_interval_hours': { minValue: 1, maxValue: 24 }` at `:170`; lookup `SCALAR_BOUNDS_REGISTRY[`${namespace}.${key}`]` at `:185`.
- Design §9: SetConfig bounds `[1, 30]`, matching the reader clamp so no writable value is silently re-clamped (the rule stated for the 281 key at `:166`).

**TDD**: `red-green required`

**Covers**: —

**Instructions**:
Add `'marketdata.assets.delisting_confirmation_trading_days': { minValue: 1, maxValue: 30 }` directly below the `assets.refresh_interval_hours` row, with one comment line: feature 352, mirrors the marketdata reader clamp. No other change.

**Verification**:
```bash
cd services/xstockstrat-config && pnpm run lint && pnpm run test
grep -n "delisting_confirmation_trading_days" src/grpc/configServiceImpl.ts   # one row
```

---

### Step 12 — test: bounds and seed-migration shape

**Status**: `pending`
**Service**: `xstockstrat-config`
**Files**:
- `services/xstockstrat-config/src/__tests__/setConfigScalarBounds.test.ts` — modify
- `services/xstockstrat-config/src/__tests__/delistingConfirmationSeedMigration.test.ts` — create

**Reviewers**: `xstockstrat-config` owner — config key naming, environment / global-per-user scoping

**Codebase Evidence**:
- Bounds table: `TIMEOUT_KEY_FORMS` in `services/xstockstrat-config/src/__tests__/setConfigScalarBounds.test.ts:270-289` (row `{ ns: 'marketdata', key: 'assets.refresh_interval_hours', field: 'intVal', min: 1, max: 24 }` at `:286`); the loop at `:291-300` asserts accept-at-bounds and reject-just-outside per row.
- Seed-shape test to model on (sentinel-actor form): `services/xstockstrat-config/src/__tests__/uiChartHistoryBarsSeedMigration.test.ts:1-60` — `findOne(suffix, 'up' | 'down')` and `splitStatements` from `./migrationSql` (number-free lookup, quote-aware split; ledger `fails.md` 2026-11-10, 291).
- The test glob is `dist/__tests__/*.test.js` and `tsc` compiles tests (`services/xstockstrat-config/package.json:12-13`).
- C-13: the migration text is the only data; no fixture literal gains a second consumer.

**TDD**: `red-green required`

**Covers**: —

**Instructions**:
1. Add `{ ns: 'marketdata', key: 'assets.delisting_confirmation_trading_days', field: 'intVal', min: 1, max: 30 }` to `TIMEOUT_KEY_FORMS`.
2. `delistingConfirmationSeedMigration.test.ts`, loading the pair with `findOne('_marketdata_delisting_confirmation_days', …)`: the up is exactly one `INSERT … ON CONFLICT (namespace, key, environment, COALESCE(user_id, '')) DO NOTHING`; exactly two rows, `staging` and `production`, `value_type` `int`, `value_data` = `default_value` = `'5'`, `consuming_service` `xstockstrat-marketdata`, the sentinel actor, `user_id` `NULL`, a non-empty description; the stored key does not start with `marketdata.`; the seeded value lies inside the Step 11 bounds; the down is one `DELETE` restricted to the sentinel actor, `user_id IS NULL`, the key and `value_data = '5'`.
3. RED: the bounds rows fail before Step 11's registry row exists (a value of 31 is accepted); the seed-shape assertions are captured with the Step 10 files absent (`findOne` fails), as in feature 347 Step 12.

**Verification**:
```bash
cd services/xstockstrat-config && pnpm run lint && pnpm run test:coverage && pnpm exec c8 check-coverage --lines 40
grep -n "migrationSql" src/__tests__/delistingConfirmationSeedMigration.test.ts
! grep -q "__tests__/fixtures" src/__tests__/delistingConfirmationSeedMigration.test.ts   # no shared fixture needed (C-13)
```

---

### Step 13 — service: `SyncWatchlistDelistings` / `AckDelistingAlerts` and marketdata's inbound caller check

**Status**: `pending`
**Service**: `xstockstrat-marketdata`
**Files**:
- `services/xstockstrat-marketdata/internal/service/authz.go` — create
- `services/xstockstrat-marketdata/internal/service/delisting_sync.go` — create
- `services/xstockstrat-marketdata/internal/handler/marketdata_handler.go` — modify
- `services/xstockstrat-marketdata/CLAUDE.md` — modify
- `docs/patterns/inter-service-mtls.md` — modify

**Reviewers**: `xstockstrat-marketdata` owner — OHLCV ingestion integrity, Alpaca feed idempotency

**Codebase Evidence**:
- Allow-list to model on: `services/xstockstrat-portfolio/internal/service/authz.go:9-38` (`HeaderInternalCaller`, `internalCallerGrant{callerID, rpc}`, `hasInternalCallerAuthority` reading `metadata.FromIncomingContext`, fail closed).
- **Not found**: any Go code reading the peer certificate — `grep -rn "VerifiedChains\|peer.FromContext\|TLSInfo" --include=*.go services` is empty. The helper is new; precedents are Node (`services/xstockstrat-config/src/grpc/authz.ts:163-166`) and the SAN rule in `docs/patterns/inter-service-mtls.md:52-71` (exact match against `xstockstrat-<svc>`, no prefix or wildcard).
- Marketdata already requires and verifies client certificates: `mtls.ServerConfig()` and `grpc.Creds(serverCreds)` — `services/xstockstrat-marketdata/cmd/server/main.go:166-173`.
- Handler shape — a Connect method plus a gRPC adapter method per RPC, the adapter passing the gRPC `ctx` through: `GetSymbolServability` `services/xstockstrat-marketdata/internal/handler/marketdata_handler.go:169-175` and `:377-383`; error mapping `toGRPCError` `:513`.
- Request-bound and normalization precedent: `servabilityMaxSymbols` and `normalizeSymbols` — `asset_servability.go:24,96-99`, `classification_service.go:97`.
- One snapshot read per call: `s.assets.snap.Load()` `asset_servability.go:100`; `classify` on a nil snapshot reports servable (`:46-49`).
- Marketdata has no inbound caller check today (`grep -rn "x-internal-caller" services/xstockstrat-marketdata/internal` → only the outbound config identity, `internal/config/config.go:110-119`).
- PLAT-9 / debate D-30: the grant requires both the header and the verified peer SAN.

**TDD**: `red-green required`

**Covers**: —

**Instructions**:
1. **`authz.go`.** `HeaderInternalCaller = "x-internal-caller"`; `internalCallerGrant{callerID, rpc, peerSAN string}`; the allow-list with exactly two grants: `{portfolio, SyncWatchlistDelistings, xstockstrat-portfolio}` and `{portfolio, AckDelistingAlerts, xstockstrat-portfolio}`. `verifiedPeerDNSNames(ctx) []string` reads `peer.FromContext` → `credentials.TLSInfo` → `State.VerifiedChains[0][0].DNSNames` and returns nil when any link is missing. `hasInternalCallerAuthority(ctx, rpc) bool` is true only when an incoming `x-internal-caller` value and an exactly equal peer DNS SAN both match one grant for that RPC; everything else is false (fail closed). No existing marketdata RPC gains a check.
2. **`delisting_sync.go`.** Fixed values: `syncMaxSymbols = 20000`, `delistingAlertLease = 10 * time.Minute`, `delistingClaimLimit = 100`.
   `SyncWatchlistDelistings(ctx, req)`:
   1. No grant → `connect.CodePermissionDenied`. No store wired → `connect.CodeUnavailable`.
   2. More than `syncMaxSymbols` symbols → `connect.CodeInvalidArgument`. Then `normalizeSymbols` and sort.
   3. `ReplaceWatched(symbols)` (an empty request clears the table).
   4. Read the asset-set pointer **once** (`snap := s.assets.snap.Load()`); every servability decision of the call uses this value.
   5. Claim: when `snap` is non-nil, `ClaimableSymbols(delistingAlertLease)`, keep those unservable in `snap`, and `ClaimAlerts(thatList, delistingAlertLease, delistingClaimLimit)`. A nil `snap` claims nothing.
   6. `FlaggedIn(symbols)` — always from the store, never from the in-memory flagged set.
   7. Response: one `FlaggedSymbol` per row of step 6 plus every claimed row not among them, sorted by symbol. `state` carries the reason and the date string as stored. `unservable_in_current_set` = `snap != nil && !snap.servable(symbol)`. `alert_state`: a row claimed by this call is `CLAIMED` (`Reclaim` false) or `REDELIVERY` (`Reclaim` true), taken from the claim's own returned rows; otherwise `REPORTED` when acknowledged; otherwise `PENDING`.
   Any store error → `connect.CodeInternal`.
   `AckDelistingAlerts(ctx, req)`: the same grant check for its own RPC name, the same symbol bound and normalization, then `AckAlerts(symbols)`.
3. **Handler.** Add the two Connect methods and the two `grpcMarketDataAdapter` methods, copying the `GetSymbolServability` pair.
4. **`services/xstockstrat-marketdata/CLAUDE.md`**, in the "Delisted-symbol detection" section of Step 8: the two RPCs, that they are the only marketdata RPCs with an inbound check (header `x-internal-caller: portfolio` **and** peer SAN `xstockstrat-portfolio`), the fixed values (20 000 symbols per sync, 100 claims per sync, 10-minute lease), the alert-state table, and the residual that a sync spanning an asset-set load can report a just-relisted symbol as unservable for one tick.
5. **`docs/patterns/inter-service-mtls.md`** § Peer-SAN authorization: add the bullet "marketdata `SyncWatchlistDelistings` / `AckDelistingAlerts` ← `xstockstrat-portfolio` (feature 352, `internalCallerAllowlist` in `services/xstockstrat-marketdata/internal/service/authz.go`). The `x-internal-caller` header is still required as well."
6. No new outbound call is added by this step, so header propagation is unaffected.

**Verification**:
```bash
( cd services/xstockstrat-marketdata && GOWORK=off go build ./... && GOWORK=off golangci-lint run --modules-download-mode=mod )
grep -c "SyncWatchlistDelistings\|AckDelistingAlerts" services/xstockstrat-marketdata/internal/handler/marketdata_handler.go   # >= 4
grep -n "xstockstrat-portfolio" services/xstockstrat-marketdata/internal/service/authz.go                                       # the two grants
python3 scripts/check-context-map.py
```

---

### Step 14 — test: caller check, claim states, single-snapshot rule

**Status**: `pending`
**Service**: `xstockstrat-marketdata`
**Files**:
- `services/xstockstrat-marketdata/internal/service/authz_test.go` — create
- `services/xstockstrat-marketdata/internal/service/delisting_sync_test.go` — create
- `services/xstockstrat-marketdata/internal/handler/marketdata_handler_test.go` — modify

**Reviewers**: `xstockstrat-marketdata` owner — OHLCV ingestion integrity

**Codebase Evidence**:
- `fakeProfileStore` and the service helper from Step 9 (`delisting_test.go`); the feature-352 symbols in `internal/testdata/assets.go` (Step 9).
- `grpc/peer` and `grpc/credentials` are part of the `google.golang.org/grpc` module marketdata already requires; a peer is injected with `peer.NewContext` and a `credentials.TLSInfo` whose `State.VerifiedChains` holds one `*x509.Certificate{DNSNames: …}` (design §4).
- Handler tests exist beside the handler: `services/xstockstrat-marketdata/internal/handler/marketdata_handler_test.go`.
- C-13: the caller identities and SANs are scenario one-offs of `authz_test.go`; inline.

**TDD**: `red-green required`

**Covers**: `AC-17, AC-19`

**Instructions**:
1. `authz_test.go` — table over (header, peer SANs, rpc): no metadata; header without a peer; peer without the header; wrong caller id; SAN `xstockstrat-portfolio-evil` and SAN `xstockstrat-portfoli` (no prefix/suffix match); unverified chain (empty `VerifiedChains`); the right pair on each of the two RPCs → allowed; the right pair on any other RPC name → denied.
2. `delisting_sync_test.go`, each case building its context with the allowed header and peer:
   - denied caller → `PermissionDenied` and the store records no call.
   - 20 001 symbols → `InvalidArgument`; input is normalized, de-duplicated and sorted before `ReplaceWatched`; an empty request clears the union.
   - unloaded asset set → nothing is claimed, every entry has `unservable_in_current_set = false` and `PENDING` (or `REPORTED`).
   - first sync of a flagged, unservable symbol → `CLAIMED` and `unservable_in_current_set = true`; a second sync inside the lease → `PENDING`; with the claim older than the lease → `REDELIVERY`.
   - **@AC-17** after `AckDelistingAlerts`, every later sync returns `REPORTED` for the symbol and never `CLAIMED` or `REDELIVERY` again.
   - a flagged symbol that is servable in the current set → `PENDING`, `unservable_in_current_set = false`, not claimed.
   - a claimed symbol that is not in the request is still in the response.
   - 101 claimable symbols → 100 claimed, one `PENDING`.
   - **@AC-19** with the service's in-memory flagged set empty (a fresh instance), the response still carries the flagged rows the store holds.
   - the asset-set pointer swapped between the claim and the read (script the fake store to swap it inside `ClaimAlerts`) does not change any entry of that response.
   - a store error → `Internal`.
   - `AckDelistingAlerts`: denied without the grant; acknowledges only the given symbols.
3. `marketdata_handler_test.go`: one round trip per new RPC through `GRPCHandler()` proving the adapter forwards the request and maps `PermissionDenied` to the gRPC code.
   Name the tests of this step `TestInternalCaller_…`, `TestSyncWatchlistDelistings_…` and `TestAckDelistingAlerts_…`, so the `-run` filter of the Verification selects them.
4. RED: with Step 13's methods present returning `Unimplemented`/zero values, the `CLAIMED` case fails.

**Verification**:
```bash
test "$( cd services/xstockstrat-marketdata && GOWORK=off go test ./internal/service/ ./internal/handler/ -race -count=1 -run 'TestInternalCaller_|TestSyncWatchlistDelistings_|TestAckDelistingAlerts_' -v | grep -c '^--- PASS' )" -ge 14   # top-level tests only; the authz table is one test
go_gate xstockstrat-marketdata
grep -rn "type fakeProfileStore" --include="*_test.go" services/xstockstrat-marketdata | wc -l   # 1 declaration site (C-13)
```

---

### Step 15 — service: per-symbol backfill results and the `skipped` outcome

**Status**: `pending`
**Service**: `xstockstrat-marketdata`
**Files**:
- `services/xstockstrat-marketdata/internal/service/marketdata_service.go` — modify
- `services/xstockstrat-marketdata/internal/service/delisting.go` — modify
- `services/xstockstrat-marketdata/internal/telemetry/otel.go` — modify
- `services/xstockstrat-marketdata/CLAUDE.md` — modify

**Reviewers**: `xstockstrat-marketdata` owner — OHLCV ingestion integrity, Alpaca feed idempotency

**Codebase Evidence**:
- Bars loop: `BackfillBars` `services/xstockstrat-marketdata/internal/service/marketdata_service.go:1501`, loop `:1549-1570` — exit arms: `src.GetBars` error `:1550-1555`, zero bars `:1556-1559`, `InsertBars` error `:1560-1565`, written `:1566-1568`; ledger event choice on `len(failedSymbols)` `:1572-1580`; response `:1582-1586`.
- Fundamentals loop: `BackfillFundamentals` `:2292`, loop `:2323-2337` — exit arms: error `:2325-2330` (WARN `fundamentals backfill: symbol failed (skipped)` `:2326`), written/empty `:2331-2335`; response `:2338`. `backfillOneSymbol` `:2344`; its first error return is the source call `FetchHistorical` `:2347-2350`; the later returns (`ListHistoricalRows` `:2353-2356`, `reconcile.Build` `:2357-2360`, the replace) are not source errors.
- EDGAR errors are untyped strings: `fmt.Errorf("no CIK for ticker %q")` — `services/xstockstrat-marketdata/internal/edgar/edgar_client.go:180`.
- Metric constants `BackfillWritten|Empty|Failed`: `services/xstockstrat-marketdata/internal/telemetry/otel.go:360-366`; recorder `:419-421`.
- The flagged set and its normalization: Step 8 (`delisting.flagged`, upper-cased symbols as stored by `Start`).
- Existing literals build the service without a store (`marketdata_service_test.go:5701-5702`), so the flagged lookup must be false on the zero value.
- Ledger: every `continue` in a per-symbol loop records an outcome when an aggregate status gate changes (`fails.md` entry cited at `recon.md` § Risks, 3573).
- CLAUDE.md § Observability names `marketdata.backfill.symbols{kind bars|fundamentals, outcome written|empty|failed}` (`:152`).

**TDD**: `red-green required`

**Covers**: —

**Instructions**:
1. `delisting.go`: add `isFlaggedDelisted(sym string) bool` — a lookup of the upper-cased, trimmed symbol in the current flagged set; false when no set is loaded.
2. `telemetry/otel.go`: add `BackfillSkipped = "skipped"` to the constant block at `:360-366`. No new label key.
3. `marketdata_service.go`: add an unexported `sourceError` wrapper (`struct{ error }` with `Unwrap`) and in `backfillOneSymbol` return `sourceError{err}` for the `FetchHistorical` error only (`:2347-2350`). Every other return is unchanged.
4. Add one helper used by both loops that, given the symbol, the error and whether it is a source error, returns the `BackfillSymbolResult` and whether the symbol counts as failed: source error **and** `isFlaggedDelisted(sym)` → `SKIPPED`, reason = the error text, not failed; any other error → `FAILED`, reason = the error text, failed.
5. `BackfillBars` loop — each exit arm records exactly one outcome:
   - `src.GetBars` error (a source error): helper result; `failedSymbols` and the `failed` metric only when failed, else the `skipped` metric and an INFO `backfill: flagged-delisted symbol skipped` instead of the ERROR line.
   - zero bars: `EMPTY` result with no reason; `empty` metric (as today).
   - `InsertBars` error: always `FAILED` (not a source error), as today plus the result.
   - written: no result.
   Set `SymbolResults` on the response. The ledger event choice at `:1572-1580` is untouched: a run with skipped symbols and no failed symbol emits `marketdata.backfill.completed`.
6. `BackfillFundamentals` loop: on error, `errors.As` into a `sourceError` variable decides the source-error flag; apply the helper (skipped → INFO instead of the WARN at `:2326`, `skipped` metric, not appended to `failed`); `n == 0` → `EMPTY` result; `n > 0` → no result. Set `SymbolResults` on the response.
7. Results are appended in request order. `failed_symbols` keeps today's meaning: it never holds a skipped or an empty symbol.
8. `services/xstockstrat-marketdata/CLAUDE.md`: § Observability → `outcome written|empty|skipped|failed`; in the "Delisted-symbol detection" section add: a backfill still attempts a flagged symbol; any error from the data source on a flagged symbol is `skipped` with the error text; a failure writing to our own database is always `failed`; the flagged test reads this instance's in-memory set, so a flag set by another instance is invisible until this instance's next load.

**Verification**:
```bash
( cd services/xstockstrat-marketdata && GOWORK=off go build ./... && GOWORK=off golangci-lint run --modules-download-mode=mod )
grep -n "BackfillSkipped" services/xstockstrat-marketdata/internal/telemetry/otel.go services/xstockstrat-marketdata/internal/service/marketdata_service.go
grep -c "SymbolResults" services/xstockstrat-marketdata/internal/service/marketdata_service.go   # >= 2 (both responses)
```

---

### Step 16 — test: one test per loop exit arm, the invariant, the metric

**Status**: `pending`
**Service**: `xstockstrat-marketdata`
**Files**:
- `services/xstockstrat-marketdata/internal/service/backfill_outcome_test.go` — create

**Reviewers**: `xstockstrat-marketdata` owner — OHLCV ingestion integrity

**Codebase Evidence**:
- Bars harness: `backfillOutcomeSource`, `failingBarInserter`, `serviceMetricReader`, `backfillSymbolCounts` — used by `TestBackfillBars_SymbolOutcomeCounts_AC14`, `services/xstockstrat-marketdata/internal/service/marketdata_service_test.go:5693-5720`. That test stays unchanged (EXTEND `@AC-14 @feature-294`: the three existing outcome values keep their counts).
- Fundamentals harness: `fakeHistSource` `:2405`, the `TestBackfillFundamentals_*` family from `:2514`, a filer-mismatch failure case `:3560`.
- `fakeProfileStore` (Step 9) seeds the flagged set through the hook or `loadFlaggedSet`.
- C-13: the symbols come from `internal/testdata/assets.go` (Step 9); error texts are scenario one-offs.

**TDD**: `red-green required`

**Covers**: `AC-11, AC-12, AC-13, AC-23, AC-24, AC-26`

**Instructions**:
Name every test of this file `TestBackfillOutcome_…` (scenario tests `TestBackfillOutcome_AC<n>_…`, each carrying a `// @AC-<n>` comment). Create `backfill_outcome_test.go` with a file-local assertion helper for the design §6 invariant, applied to every response in the file: every symbol in `failed_symbols` has exactly one `FAILED` result; no `SKIPPED` or `EMPTY` symbol is in `failed_symbols`; no symbol has two results.
1. **@AC-11** fundamentals, `AAPL` written and flagged `PSKY` failing in `FetchHistorical` with `no CIK for ticker "PSKY"` → `PSKY` is `SKIPPED` with that reason, `failed_symbols` is empty, `marketdata.backfill.symbols{kind=fundamentals}` gains 1 `skipped` and 0 `failed`.
2. **@AC-12 (guard)** flagged `ROKU` that the source serves → no result for `ROKU`, periods written, `written` metric. It passes before and after; it fails only if a flag-based filter is later added to the backfill path (FR-7, R-7). Exempt from RED per `tdd-gate.md`.
3. **@AC-13** unflagged `AXIA` failing the same way → `FAILED` with the reason, in `failed_symbols`, `failed` metric.
4. **@AC-23** bars: flagged `PSKY` with a `GetBars` error → `SKIPPED`, not in `failed_symbols`, `bars/skipped` 1 and `bars/failed` 0, and the ledger event is `marketdata.backfill.completed`.
5. **@AC-24** fundamentals writing 0 periods → `EMPTY` with an empty reason, not in `failed_symbols`.
6. **@AC-26** flagged `PSKY` with a source error whose text contains `429` → `SKIPPED` and the reason contains `429`.
7. Remaining exit arms: bars `InsertBars` error on a **flagged** symbol → `FAILED` (our own database); bars zero bars → `EMPTY`; fundamentals error after the fetch (a `ListHistoricalRows` error) on a flagged symbol → `FAILED`; a service with no store wired treats every symbol as unflagged.
8. Results come back in request order.
9. RED: against Step 15's signatures with the helper returning `FAILED` for every error, the `@AC-11` test fails on "PSKY in failed_symbols".

**Verification**:
```bash
test "$( cd services/xstockstrat-marketdata && GOWORK=off go test ./internal/service/ -race -count=1 -run 'TestBackfillOutcome_' -v | grep -c '^--- PASS' )" -ge 8   # the six scenario tests + exit-arm and order tests (new file only)
( cd services/xstockstrat-marketdata && GOWORK=off go test ./internal/service/ -race -count=1 -run 'BackfillBars_SymbolOutcomeCounts|BackfillFundamentals' )   # the pre-existing backfill tests stay green
go_gate xstockstrat-marketdata
test "$(grep -c "@AC-" services/xstockstrat-marketdata/internal/service/backfill_outcome_test.go)" -ge 6
```

---

### Step 17 — migration: ingest `017_backfill_symbol_results`

**Status**: `pending`
**Service**: `xstockstrat-ingest`
**Files**:
- `services/xstockstrat-ingest/migrations/017_backfill_symbol_results.up.sql` — create
- `services/xstockstrat-ingest/migrations/017_backfill_symbol_results.down.sql` — create

**Reviewers**: DBA — migration NNN numbering, up+down pair present, run-order compliance with `scripts/db-migrate.sh`; `xstockstrat-ingest` owner — idempotent ingestion

**Codebase Evidence**:
- Last ingest migration: `016_seed_source_templates` (`ls services/xstockstrat-ingest/migrations | tail -2`); `git log --all -- 'services/xstockstrat-ingest/migrations/01[7-9]*'` is empty.
- Column-add precedent on the same table: `services/xstockstrat-ingest/migrations/015_backfill_webhook_callback.up.sql:2-5` (`ALTER TABLE ingest.backfill_jobs ADD COLUMN IF NOT EXISTS …`) and its down (`DROP COLUMN IF EXISTS`).
- `ingest.backfill_jobs` is a plain table (`003_backfill_jobs.up.sql:6`); `get_job` / `list_jobs` are `SELECT *` (`services/xstockstrat-ingest/app/repositories/backfill_jobs.py:82-90`), so a new nullable column reaches the row dict with no query change.

**TDD**: `N/A (migration)`

**Covers**: —

**Instructions**:
1. Re-derive the number first (`ls services/xstockstrat-ingest/migrations | tail -2`, and `git log --remotes=origin --format= --name-only -- 'services/xstockstrat-ingest/migrations/01*' | sort -u`); renumber and log a deviation if `017` is taken.
2. Up: one header comment line (feature 352), then `ALTER TABLE ingest.backfill_jobs ADD COLUMN IF NOT EXISTS symbol_results jsonb;` — nullable, no default (NULL = no per-symbol results, the state of every existing row).
3. Down: `ALTER TABLE ingest.backfill_jobs DROP COLUMN IF EXISTS symbol_results;`.

**Verification**:
```bash
ls services/xstockstrat-ingest/migrations/017_backfill_symbol_results.up.sql services/xstockstrat-ingest/migrations/017_backfill_symbol_results.down.sql
ls services/xstockstrat-ingest/migrations | tail -2      # highest number, no duplicate prefix
# read both: the down drops exactly the column the up adds
```

---

### Step 18 — service: ingest stores per-symbol results per chunk and serves them merged

**Status**: `pending`
**Service**: `xstockstrat-ingest`
**Files**:
- `services/xstockstrat-ingest/app/handlers/servicer.py` — modify
- `services/xstockstrat-ingest/app/repositories/backfill_jobs.py` — modify
- `services/xstockstrat-ingest/CLAUDE.md` — modify

**Reviewers**: `xstockstrat-ingest` owner — idempotent ingestion, signal normalization correctness

**Codebase Evidence**:
- `job_row_to_proto`: `services/xstockstrat-ingest/app/handlers/servicer.py:300-324` (reads row keys with `row[...]` and optional ones with `row.get(...)`).
- Fundamentals path: `_execute_fundamentals_backfill` `:686-731` — the one `BackfillFundamentals` call `:692-699`, `failed = list(resp.failed_symbols)` `:700`, status rule `:705-707`, the single terminal `update_job` `:709-716`.
- Bars path: `_run_chunks` `:921` — state dict `:930`, `run_one` `:933`, attempt loop `:949-978` (success arm `:950-963`, `AioRpcError` arm `:964-970`, generic arm `:971-973`, retry `:974-978`), locked section `:980-1004` (whole-chunk failure arm `:981-990`, completed arm `:991-998`, the per-chunk `update_job` `:999-1004`). Callers: `_execute_backfill` `:812`, `_resume_job` `:911`.
- `_resume_job` `:890-916` already reads the job row (`:892`) and does not seed `failed_symbols` (design R-9).
- Job-level failure arm of `_run_backfill`: `:660-672`. Terminal rule of `_finalize_backfill`: `:827-833`. Both stay as they are.
- `_UPDATABLE_COLUMNS`: `services/xstockstrat-ingest/app/repositories/backfill_jobs.py:13-26`; `update_job` builds `col = $n` for each kwarg `:61-79`; `get_job` `:82-87`.
- The pool has no JSONB codec — JSONB parameters are passed as JSON text: `services/xstockstrat-ingest/app/repositories/signal_sources.py:154-155`; `json` is already imported in the servicer (`servicer.py:9`).
- Webhook payload built from eight row columns only: `services/xstockstrat-ingest/app/engine/webhook_handoff_loop.py:41-62` (PRESERVE `@AC-30 @feature-334`).
- No new outbound call: the two marketdata RPCs are already called with `metadata=propagation_meta` (`:698`, `:959`).
- CLAUDE.md table notes: `services/xstockstrat-ingest/CLAUDE.md:116-125`.

**TDD**: `red-green required`

**Covers**: —

**Instructions**:
1. `backfill_jobs.py`: add `"symbol_results"` to `_UPDATABLE_COLUMNS`. The caller passes JSON text.
2. `servicer.py`, two module-level helpers next to `job_row_to_proto`:
   - a parser/merger that takes the stored column value (JSON text or `None`), and returns `BackfillSymbolResult` messages sorted by symbol, merging a symbol that appears under several chunk keys with the precedence `FAILED` > `SKIPPED` > `EMPTY` (the reason of the winning entry is kept);
   - an attempt recorder that updates one chunk's `{symbol: {"outcome", "reason"}}` dict from one attempt: first drop the entry of every symbol the attempt was **sent**; then, on a response, store each `resp.symbol_results` entry and — assumption A-4 — a `FAILED` entry with an empty reason for any symbol in `resp.failed_symbols` that has none; on an exception, store `FAILED` with `str(exc)` for every symbol sent.
3. `job_row_to_proto`: `job.symbol_results.extend(<merger>(row.get("symbol_results")))`.
4. `_run_chunks`: add a keyword parameter `symbol_results: dict | None = None` and seed `state["symbol_results"]` with a copy of it. In `run_one`, keep a chunk-local results dict, call the attempt recorder once per attempt in all three arms (`:950-973`), and inside the locked section: in the whole-chunk failure arm (`:981-990`) replace the chunk dict with `FAILED` / `str(last_exc)` for every symbol of the chunk; then set `state["symbol_results"][chunk_id]` to the chunk dict and add `symbol_results=json.dumps(state["symbol_results"])` to the existing `update_job` call at `:999-1004`. The `failed_symbols` accumulation (`:987`, `:997-998`) is unchanged.
5. `_resume_job`: parse the row's stored `symbol_results` (`None` → `{}`) and pass it as the seed, so entries of chunks completed before the restart are kept and a resumed chunk replaces its own entry. `failed_symbols` is still not seeded.
6. `_execute_fundamentals_backfill`: build the chunk dict for the single key `"fundamentals"` with the attempt recorder from `resp` and add `symbol_results=json.dumps({"fundamentals": …})` to the `update_job` at `:709-716`. The status rule at `:705-707` is untouched: a skipped or empty symbol is not in `resp.failed_symbols`, so the job is `COMPLETED`.
7. Not changed: the job-level failure arm (`:660-672`) writes no `symbol_results`; `_finalize_backfill`'s rule; the webhook payload; the alert texts; `CANCELED` handling.
8. `services/xstockstrat-ingest/CLAUDE.md` (`:116-125`): add `symbol_results` (migration `017`) — per-symbol outcome and reason for non-written symbols, stored keyed by chunk, merged at read into `BackfillJob.symbol_results`; never part of the webhook payload; absent for a job-level failure; after a restart a job can hold `FAILED` results for symbols of earlier chunks that are not in `failed_symbols`.

**Verification**:
```bash
cd services/xstockstrat-ingest && ruff check . && ruff format --check . && pytest -q     # the whole existing suite still passes
grep -n '"symbol_results"' app/repositories/backfill_jobs.py
grep -c "symbol_results" app/handlers/servicer.py     # >= 5
! grep -n "symbol_results" app/engine/webhook_handoff_loop.py
```

---

### Step 19 — test: ingest chunk, retry, resume and read paths

**Status**: `pending`
**Service**: `xstockstrat-ingest`
**Files**:
- `services/xstockstrat-ingest/tests/test_ingest_servicer.py` — modify
- `services/xstockstrat-ingest/tests/test_backfill_jobs.py` — modify
- `services/xstockstrat-ingest/tests/test_webhook_handoff_loop.py` — modify
- `services/xstockstrat-ingest/tests/_helpers.py` — modify

**Reviewers**: `xstockstrat-ingest` owner — idempotent ingestion

**Codebase Evidence**:
- Chunk harness: `patch_chunk_repo` `services/xstockstrat-ingest/tests/test_ingest_servicer.py:930-946` (yields the `update_job` mock), `_chunk`, `_mk_backfill_resp`, `_make_backfill_req`, `TestRunBackfill` `:949`; resume cases around `:1150` and `:1274`; job-failure case `_fail_job` `:1299-1320`.
- Row fixture mirroring the DDL: `job_row` `services/xstockstrat-ingest/tests/_helpers.py:62-90` ("The 19 keys are exactly the DDL columns").
- Repo tests: `test_update_job_builds_set_clause` `tests/test_backfill_jobs.py:33`, `test_webhook_columns_are_not_dynamically_updatable` `:199-203`.
- Payload key guard: `_PAYLOAD_KEYS` `tests/test_webhook_handoff_loop.py:37-46`.
- C-13: `job_row` is the canonical row fixture (several consumers); the new column is added there, not as an inline dict.
- Ledger: pair each "never written" assertion with a positive call-count or row check (`fails.md` 2026-11-10, 289).

**TDD**: `red-green required`

**Covers**: `AC-11, AC-13, AC-14, AC-23, AC-24, AC-26`

**Instructions**:
1. `_helpers.py`: add `"symbol_results": None` to `job_row` and update its docstring to 20 keys (migration `017`, feature 352).
2. `test_backfill_jobs.py`: `update_job(pool, "j1", symbol_results='{"c1": {}}')` is accepted and bound as the text given.
3. `test_ingest_servicer.py`, with a file-local helper asserting the design §6 invariant on (stored results, `failed_symbols`):
   - **@AC-11** fundamentals response with `PSKY` `SKIPPED` and no failed symbol → the terminal `update_job` has status `COMPLETED`, empty `failed_symbols`, and stored results holding `PSKY` under `"fundamentals"`.
   - **@AC-23** the same for a bars chunk → `COMPLETED`, `PSKY` stored under the chunk id.
   - **@AC-13** a response with `AXIA` `FAILED` and in `failed_symbols` → `PARTIAL`, unchanged from today, plus the stored `FAILED` reason.
   - **@AC-14** `job_row_to_proto` of a row storing `PSKY` skipped (reason containing `no CIK for ticker "PSKY"`) and `AXIA` failed returns both in `symbol_results` with their outcomes and reasons, sorted by symbol.
   - **@AC-24** a response with `AAPL` `EMPTY` → `COMPLETED`; the read model lists `AAPL` with outcome `EMPTY` and an empty reason.
   - **@AC-26** `PSKY` skipped with a reason containing `429` → `COMPLETED`.
   - Retry: a symbol `FAILED` on the first attempt and written on the retry leaves no entry; a symbol `SKIPPED` on the first attempt and not re-sent keeps its entry.
   - Whole-chunk RPC failure → every symbol of the chunk is `FAILED` with the RPC error text, including one that an earlier attempt reported `SKIPPED`.
   - Resume: a row whose stored results hold a completed chunk keeps that chunk's entries; the resumed chunk replaces its own; `failed_symbols` is not seeded (assert the documented residual explicitly: a stored `FAILED` result with the symbol absent from the final `failed_symbols`).
   - Merge at read: one symbol under two chunk keys resolves `FAILED` > `SKIPPED` > `EMPTY`.
   - Job-level failure (the fundamentals RPC raises): no `symbol_results` kwarg in any `update_job` call, while the `FAILED` status write is present.
   - Assumption A-4: a response with a failed symbol and no `symbol_results` stores `FAILED` with an empty reason.
4. `test_webhook_handoff_loop.py`: a row carrying `symbol_results` still produces exactly `_PAYLOAD_KEYS` (PRESERVE `@AC-30 @feature-334`). This is a guard and passes before and after.
5. RED: run the new `@AC-11` and `@AC-14` tests against the unmodified servicer (no stored results; `symbol_results` empty).

**Verification**:
```bash
py_gate xstockstrat-ingest
( cd services/xstockstrat-ingest && pytest -q tests/test_ingest_servicer.py tests/test_backfill_jobs.py tests/test_webhook_handoff_loop.py -k "symbol_results or AC_11 or AC_13 or AC_14 or AC_23 or AC_24 or AC_26 or payload" )
grep -n "symbol_results" services/xstockstrat-ingest/tests/_helpers.py     # the fixture carries the column (C-13)
```

---

### Step 20 — service: portfolio's never-waiting removal of flagged symbols from system-managed lists

**Status**: `pending`
**Service**: `xstockstrat-portfolio`
**Files**:
- `services/xstockstrat-portfolio/internal/repository/delisted_removal_repo.go` — create

**Reviewers**: `xstockstrat-portfolio` owner — concurrent write safety, position snapshot consistency

**Codebase Evidence**:
- The deleter to mirror, which stays untouched: `PruneExpiredSignalEntries` and `pruneListTx` — `services/xstockstrat-portfolio/internal/repository/signal_expiry_repo.go:35-146`: parent lock `FOR NO KEY UPDATE SKIP LOCKED` `:68-71` (no row → skipped `:72-74`), binding lock `FOR UPDATE SKIP LOCKED` `:87-91`, delete of only the locked set `:100-103`, expiry-row cleanup `:126-134`, `updated_at` touch `:135-142`, removals of committed lists returned with the first error `:32-34,44-57`.
- Lock order that forces "never wait": `UpdateBinding` locks the binding row before touching the parent (`services/xstockstrat-portfolio/internal/repository/watchlist_repo.go:360-371` — the `UPDATE` that takes the binding lock starts at `:360`, the parent touch is at `:371`), the reverse of the prune; waiting on a binding while holding the parent would deadlock (debate D-25).
- Schema: `portfolio.watchlists.system_managed` (`migrations/011_watchlist_system_managed_source.up.sql:12`), `portfolio.watchlist_symbols.source` (`:32`), `portfolio.watchlist_signal_expiry (watchlist_id, symbol)` primary key with the FK on the watchlist, not the binding (`migrations/018_watchlist_signal_expiry.up.sql:4-11`), so a removed binding's expiry row must be deleted explicitly.
- `symbol = ANY($n)` with a Go string slice is an existing bind on this pool (`signal_expiry_repo.go:86-91`).
- Mock seam: `WatchlistRepo` holds `pool *pgxpool.Pool` and the mockable `db queryRower` (`watchlist_repo.go:25-29`); pgxmock tests build `&WatchlistRepo{db: mock}` with a nil pool (`watchlist_repo_test.go:24`), reads go through `r.db.Query` (`:110`, `:166`) and transactions through `r.pool.Begin` (`:39`, `:194`), which a nil pool cannot serve. The pinned `github.com/pashagolub/pgxmock/v4 v4.9.0` (`services/xstockstrat-portfolio/go.mod:9`) pool mock does serve `ExpectBegin()` / `Begin(ctx)` and returns a `pgx.Tx`, so the per-list statements are testable locally once they take a `pgx.Tx` argument.
- Trading-domain survey: no `TRADING_MODE`, `BrokerType`, `OrderType` or `OrderStatus` reference in the repository's watchlist files.
- No portfolio migration and no new index (design §5): the lookup is driven from the `system_managed` watchlists into the `(watchlist_id, symbol)` primary key.

**TDD**: `red-green required`

**Covers**: —

**Instructions**:
Create `delisted_removal_repo.go` (package `repository`).
1. `DelistedRemoval{WatchlistID, UserID, Name string; Removed, Left []string; Skipped bool}` — one entry per system-managed list that held at least one of the given symbols. `Removed` is the symbols deleted from it; `Left` is the held symbols that were **not** removed (all of them when the parent row was locked; the locked bindings otherwise); `Skipped` is true when the parent row was locked, or when any held binding was locked and so left in place. `Name` and the held symbols come from the list query, so a parent-locked list still reports what it held.
2. `func (r *WatchlistRepo) RemoveDelistedFromSystemLists(ctx context.Context, symbols []string) ([]DelistedRemoval, error)`:
   - empty `symbols` → no query, empty result;
   - one set-based query, issued through `r.db.Query` (the mockable surface), lists the `system_managed` watchlists holding any of the symbols (watchlist id, user id, name, held symbols), driven from `portfolio.watchlists WHERE system_managed` joined to `portfolio.watchlist_symbols` on the primary key with `symbol = ANY($1)`, ordered by watchlist id;
   - per list: begin one short transaction with `r.pool.Begin` (like `pruneListTx`), call `removeDelistedInTx`, commit on success and roll back on error; every list is attempted; the removals of committed lists are returned even when the first per-list error is returned with them (the `PruneExpiredSignalEntries` contract).
3. `removeDelistedInTx(ctx context.Context, tx pgx.Tx, l delistedList) (DelistedRemoval, error)` holds **all** per-list statements and takes the transaction as an argument (`delistedList` is the list-query row: watchlist id, user id, name, held symbols). It neither begins nor commits; `pruneListTx` stays untouched. It never waits on a row lock:
   - `SELECT user_id, name, system_managed FROM portfolio.watchlists WHERE watchlist_id = $1 FOR NO KEY UPDATE SKIP LOCKED`; no row → `Skipped`; `system_managed` false on the re-check → report nothing removed;
   - lock the held bindings of **any** source: `SELECT symbol FROM portfolio.watchlist_symbols WHERE watchlist_id = $1 AND symbol = ANY($2) FOR UPDATE SKIP LOCKED`;
   - delete only the locked set, `DELETE FROM portfolio.watchlist_symbols WHERE watchlist_id = $1 AND symbol = ANY($2) RETURNING symbol`, bound `(watchlistID, lockedSymbols)`;
   - delete the removed symbols' expiry rows with a plain `DELETE FROM portfolio.watchlist_signal_expiry WHERE watchlist_id = $1 AND symbol = ANY($2)`, bound `(watchlistID, removedSymbols)` (under the parent lock, debate D-17);
   - touch `updated_at` when something was removed (the caller commits);
   - fewer bindings locked than held → `Skipped = true`, with the unlocked-and-removed symbols in `Removed` and the rest in `Left`; a locked parent → `Skipped = true`, empty `Removed`, every held symbol in `Left`.
4. It emits nothing and writes no ledger row; `pruneListTx` and `PruneExpiredSignalEntries` are not edited.
5. Broker coverage, order types, fill handling and `TRADING_MODE` are unaffected by this step.

**Verification**:
```bash
( cd services/xstockstrat-portfolio && GOWORK=off go build ./... && GOWORK=off golangci-lint run --modules-download-mode=mod )
git diff --exit-code HEAD -- services/xstockstrat-portfolio/internal/repository/signal_expiry_repo.go                     # this step leaves the 281 deleter untouched
git log --oneline origin/main-dev..HEAD -- services/xstockstrat-portfolio/internal/repository/signal_expiry_repo.go | wc -l   # 0 — no earlier step touched it either
grep -c "FOR [A-Z ]*SKIP LOCKED" services/xstockstrat-portfolio/internal/repository/delisted_removal_repo.go   # 2 — the two lock statements; comments do not match
```

---

### Step 21 — test: removal repository (pgxmock and real database)

**Status**: `pending`
**Service**: `xstockstrat-portfolio`
**Files**:
- `services/xstockstrat-portfolio/internal/repository/delisted_removal_repo_test.go` — create
- `services/xstockstrat-portfolio/internal/repository/delisted_removal_dbtest_test.go` — create

**Reviewers**: `xstockstrat-portfolio` owner — concurrent write safety

**Codebase Evidence**:
- pgxmock precedent in this package: `services/xstockstrat-portfolio/internal/repository/watchlist_repo_test.go:16-20`.
- Real-DB helpers: `testPool` `services/xstockstrat-portfolio/internal/repository/dbtest_helpers_test.go:22`, `testUserID` `:61`, `seedWatchlist(…, systemManaged bool)` `:75`, `seedNamedWatchlist(…, name, systemManaged)` `:80` (feature 354; suits the two-list cases), `seedBinding(…, source)` `:93`, `seedExpiry` `:110`, `expiryRow` `:139`; `assertBindingGone` `signal_expiry_prune_dbtest_test.go:89`.
- Never-wait proof to copy: `TestPrune_ConcurrencyNeverWaits` `signal_expiry_prune_dbtest_test.go:270`, with `waitForParentLockWait` `:432`.
- CI runs them: job `portfolio-db-test` (`.github/workflows/ci.yml:1017-1065`, `PORTFOLIO_DB_TEST_URL`).
- C-13: every row is seeded through the existing helpers; no new fixture literal.

**TDD**: `red-green required`

**Covers**: `AC-6, AC-7`

**Instructions**:
1. `delisted_removal_repo_test.go` (pgxmock), every test named `TestDelistedRemoval_…`:
   - Through `&WatchlistRepo{db: mock}` (no pool, so these cases must not reach a per-list transaction): empty input issues no query; a list-query error is wrapped and returned; called with `[KPTI]`, the list query is issued exactly once with `$1 = [KPTI]` — never `AAPL` — and, returning no rows, yields an empty result (`ExpectationsWereMet`).
   - **@AC-6 (local RED)** — `removeDelistedInTx` driven directly: `mock.ExpectBegin(); tx, _ := mock.Begin(ctx)`, then expect, in order, the parent-lock query (`FOR NO KEY UPDATE SKIP LOCKED`) returning the system-managed row; the binding-lock query with args `("wl-1", []string{"KPTI"})` returning `KPTI`; the `DELETE … RETURNING symbol` with the same args returning `KPTI`; the expiry-row `ExpectExec` with args `("wl-1", []string{"KPTI"})`; the `updated_at` `ExpectExec` with arg `"wl-1"`. Call `removeDelistedInTx(ctx, tx, list)` for a list holding `KPTI` (the list also holds `AAPL` in the watchlist, but `AAPL` is not in the removal set and appears in no bind). Assert `Removed == [KPTI]`, `Left` empty, `Skipped` false and `ExpectationsWereMet`.
   - A parent-lock query returning no row → `Skipped`, every held symbol in `Left`, and no later statement is issued.
   - A binding-lock query returning fewer symbols than held → the returned ones in `Removed`, the rest in `Left`, `Skipped` true.
2. `delisted_removal_dbtest_test.go` (`//go:build dbtest`), tests named `TestDelistedRemoval_…`:
   - **@AC-6** a system-managed list holding `KPTI` and `AAPL`: removing `[KPTI]` deletes the `KPTI` binding, keeps `AAPL`, bumps `updated_at`, and reports the list's name.
   - **@AC-7** a user-created list and a system-managed list (seeded with `seedNamedWatchlist`) both hold `ROKU`: removing `[ROKU]` changes only the system-managed one; the user-created list is untouched and not reported.
   - A `source = MANUAL` entry on a system-managed list is removed like a `SIGNAL` one (operator reading of 281 `@AC-4`/`@AC-5`).
   - The expiry row of a removed symbol is deleted, due or not; the expiry row of a symbol that stays is kept.
   - Never waits: with the parent row locked by another transaction the call returns at once with `Skipped`, an empty `Removed` and `Left` equal to the held symbols; with one binding row locked (an in-flight `UpdateBinding`) the call returns at once, removes the other bindings, reports `Skipped` and names the locked symbol in `Left`. Bound each call with a short context and fail on a wait, as `TestPrune_ConcurrencyNeverWaits` does.
   - Partial result: two system-managed lists hold the symbol and the second one's parent row is locked → the first list's removal is committed and returned, the second is reported `Skipped` with its `Left`; every list is attempted.
   - A list whose `system_managed` flag is false at lock time is not modified.
   - A second call for the same symbols is a no-op.
   - PRESERVE 281: after a removal, `PruneExpiredSignalEntries` on the same list still behaves as before for the remaining entries.
3. RED: with `RemoveDelistedFromSystemLists` and `removeDelistedInTx` present as stubs returning zero values, the pgxmock `@AC-6` case fails locally on the unmet statement expectations and on `Removed`, and (in CI, job `portfolio-db-test`) the `@AC-6` and `@AC-7` database cases fail on the binding still present.

**Verification**:
```bash
test "$( cd services/xstockstrat-portfolio && GOWORK=off go test ./internal/repository/ -race -count=1 -run 'TestDelistedRemoval_' -v | grep -c '^--- PASS' )" -ge 4   # pgxmock tests (the dbtest file is not compiled without the tag)
GOWORK=off go -C services/xstockstrat-portfolio vet -tags dbtest ./internal/repository/...
GOWORK=off go -C services/xstockstrat-portfolio test -tags dbtest ./internal/repository/... -count=1 -run 'DelistedRemoval' -v | grep -c '^--- SKIP'   # >= 1 locally; CI job portfolio-db-test runs them
go_gate xstockstrat-portfolio
```

---

### Step 22 — service: portfolio's delisting tick — sync, remove, alert, acknowledge

**Status**: `pending`
**Service**: `xstockstrat-portfolio`
**Files**:
- `services/xstockstrat-portfolio/internal/service/delisting_sync.go` — create
- `services/xstockstrat-portfolio/internal/service/signal_prune.go` — modify
- `services/xstockstrat-portfolio/internal/service/portfolio_service.go` — modify
- `services/xstockstrat-portfolio/CLAUDE.md` — modify
- `services/xstockstrat-portfolio/docs/context-constitution.md` — modify (PORTFOLIO-18)

**Reviewers**: `xstockstrat-portfolio` owner — concurrent write safety, position snapshot consistency

**Codebase Evidence**:
- `pruneOnce`: `services/xstockstrat-portfolio/internal/service/signal_prune.go:51-79` — the tick context carries only `x-trace-id` (`:52`), a prune error is logged and the function continues (`:53-56`), closing INFO `:77-78`. Started by `go svc.PruneExpiredSignalEntries(ctx)` (`cmd/server/main.go:81`); interval key `watchlist.signal_prune_interval_seconds` (`signal_prune.go:12,33`).
- `WatchlistStore`: `services/xstockstrat-portfolio/internal/service/portfolio_service.go:1988-2013` (last method `:2012`); unfiltered union `ListAllSymbols` `:2009` → repo `watchlist_repo.go:445-461`.
- Marketdata client with the propagating interceptor: field `:48`, dial `:138-145` (`middleware.UnaryClientInterceptor`); notify client `:49`, dial `:146-153`. Outgoing metadata appended to a context reaches the wire: the existing prune test asserts `x-trace-id` on the ledger call (`signal_prune_test.go:38-40`).
- Pull-with-deadline, fail-open precedent: `refuseUnservable` `:569-582` (nil client → no-op `:570-572`); metric `telemetry.RecordMarketdataFetch(ctx, op, outcome)` with timeout detection `:515-521` (ok-record `:527`).
- Alert precedent (which also writes a ledger event and swallows the error, so it is not reused): `emitRiskAlert` `:1321-1336`.
- `HeaderInternalCaller` constant: `services/xstockstrat-portfolio/internal/service/authz.go:11`.
- Existing prune tests build the service with a nil marketdata client (`watchlist_service_test.go:359-361`), so the new step must return at once when `s.marketdata == nil`.
- PORTFOLIO-18 text: `services/xstockstrat-portfolio/docs/context-constitution.md:30`. CLAUDE.md anchors: dependency row `:60`, instruments `:123`.
- Header propagation (**C-03**): both new outbound calls reuse the marketdata client and its interceptor; a background tick has no user identity (as the 281 prune), so the calls carry `x-trace-id` and `x-internal-caller` only.

**Lands with**: `Step 23`

**TDD**: `red-green required`

**Covers**: —

**Instructions**:
1. `portfolio_service.go`: add `RemoveDelistedFromSystemLists(ctx context.Context, symbols []string) ([]repository.DelistedRemoval, error)` to `WatchlistStore`, and a field `delisted delistedCache` on `PortfolioService` (zero value usable).
2. `delisting_sync.go`:
   - Fixed values: `delistingRPCTimeout = 15 * time.Second`, `delistingCallerID = "portfolio"`, `delistingAlertCategory = "symbol_delisting"`.
   - `delistedCache`: a mutex-guarded `map[string]*commonv1.DelistedState` with a `replace` method that swaps the whole map.
   - `emitDelistingAlert(ctx, title, body string) error`: one `s.notify.EmitAlert` — WARNING, category `symbol_delisting`, `SourceService: "portfolio"`, no `TargetUserId`; it writes **no** ledger event and returns the error.
   - `syncDelistings(ctx context.Context)`:
     1. Return when `s.marketdata == nil`. When `s.notify == nil`, run sub-steps 2–6 and return after the removal, before sub-steps 7–8, so a service built without a notify client (the test pattern of `newSvc`) never dereferences it.
     2. `ListAllSymbols` (the unfiltered repo method). Error → WARN, stop; the cache is kept.
     3. Call `SyncWatchlistDelistings` with the union, on `metadata.AppendToOutgoingContext(ctx, HeaderInternalCaller, delistingCallerID)` under `delistingRPCTimeout`. Error or timeout → WARN, `RecordMarketdataFetch(ctx, "delistings", "error"|"timeout")`, stop: the cache is kept and nothing is removed. Success → `RecordMarketdataFetch(ctx, "delistings", "ok")`.
     4. Replace the cache with every response entry, whatever its alert state.
     5. Removal set: entries whose `alert_state` is `CLAIMED`, `REDELIVERY` or `REPORTED` **and** whose `unservable_in_current_set` is true. `PENDING` and `UNSPECIFIED` are never removed.
     6. `RemoveDelistedFromSystemLists(removal set)`. An error is a WARN; the removals it returned are still used.
     7. For each `CLAIMED` or `REDELIVERY` entry, in symbol order, send one alert under `delistingRPCTimeout`. Title `symbol delisted`. A `CLAIMED` body names the symbol, the reason enum name, the first-unservable date, the number and names of the system-managed lists removed on this tick (the `DelistedRemoval` entries whose `Removed` holds the symbol), and — when some lists still hold it — how many will be removed on a later refresh (the entries whose `Left` holds the symbol; count `Left`, not `Skipped`, because a skipped list may have left a different symbol); when the symbol was on no system-managed list it says so. A `REDELIVERY` body starts by saying it may repeat an earlier alert and names only the lists removed on this tick, if any. Stop at the first failed or timed-out send.
     8. `AckDelistingAlerts` for the symbols whose alert was sent, with the same caller header and deadline. A failure is a WARN; the claim is re-delivered after the lease.
     9. A removal that carried no alert (a `REPORTED` entry) is logged at INFO. One INFO `delisting sync tick` closes the step with the flagged, removed, alerted and acknowledged counts.
3. `signal_prune.go`: call `s.syncDelistings(tickCtx)` as the last statement of `pruneOnce`, after the INFO at `:77-78`. `pruneOnce` keeps its signature and every existing line.
4. `services/xstockstrat-portfolio/CLAUDE.md`: dependency row (`:60`) gains `SyncWatchlistDelistings` / `AckDelistingAlerts` on the prune tick; a paragraph "Delisted symbols (feature 352)" — the tick step and its order, that marketdata is the only decider and portfolio only supplies the union, removes, alerts and acknowledges, the fixed 15 s deadline, the `symbol_delisting` WARNING (untargeted, no ledger event), the cache and its one-tick staleness; instruments (`:123`): `portfolio.marketdata_fetch{op=quotes|delistings, …}`.
5. **PORTFOLIO-18** (`docs/context-constitution.md:30`): keep the 281 rule; add that the feature-352 delisting removal is a second automatic deleter in the same tick, for flagged-delisted symbols on system-managed lists whatever the entry's source, that it copies the never-wait shape, deletes the expiry rows of what it removes and emits neither 281 ledger event.
6. Broker coverage, order types, fill handling and `TRADING_MODE` are unaffected by this step.

**Verification** (run as the Steps 22–23 unit):
```bash
( cd services/xstockstrat-portfolio && GOWORK=off go build ./... && GOWORK=off golangci-lint run --modules-download-mode=mod )
grep -n "syncDelistings" services/xstockstrat-portfolio/internal/service/signal_prune.go            # one call, last in pruneOnce
grep -n "HeaderInternalCaller" services/xstockstrat-portfolio/internal/service/delisting_sync.go    # both outbound calls carry it
! grep -n "emitEvent" services/xstockstrat-portfolio/internal/service/delisting_sync.go             # no ledger event (spec D-12)
python3 scripts/check-context-map.py
```

---

### Step 23 — test: the delisting tick

**Status**: `pending`
**Service**: `xstockstrat-portfolio`
**Files**:
- `services/xstockstrat-portfolio/internal/service/delisting_sync_test.go` — create
- `services/xstockstrat-portfolio/internal/service/watchlist_service_test.go` — modify

**Reviewers**: `xstockstrat-portfolio` owner — concurrent write safety

**Codebase Evidence**:
- `fakeWatchlistStore` `services/xstockstrat-portfolio/internal/service/watchlist_service_test.go:32-51` (fields `allSymbols`, `allSymbolsErr`, `pruneResult`), `newSvc` `:359-361`, `fakeLedger` `:333` (records `reqs` and outgoing metadata `outMD`).
- `stubMarketData` embeds the client interface; a method not overridden panics when called (`portfolio_service_test.go:16-39`) — the two new RPCs get overrides.
- Notify recorder: `recordingNotify` `portfolio_quote_deadline_test.go:349-360` (records every `EmitAlertRequest`).
- Existing prune tests that must stay green unchanged: `signal_prune_test.go:69-140` (`pruneSvc` `:20-24`).
- C-13: watchlist and symbol literals follow the existing in-file pattern of the service tests; the delisted-state proto values are built per case (scenario one-offs).
- Ledger: recording fakes snapshot the context deadline and metadata at call entry (`fails.md` 2026-11-10, 290).

**Lands with**: `Step 22`

**TDD**: `red-green required`

**Covers**: `AC-5, AC-6, AC-17, AC-18, AC-22`

**Instructions**:
1. `watchlist_service_test.go`: `fakeWatchlistStore` implements `RemoveDelistedFromSystemLists` (records the symbols it was given, returns a scripted result and error) and gains a `pruneErr` so `PruneExpiredSignalEntries` can fail.
2. `delisting_sync_test.go`: add `SyncWatchlistDelistings` / `AckDelistingAlerts` overrides on `stubMarketData` that record the request, the outgoing metadata and the context deadline at call entry and return a scripted response or error. Build the service with `newSvc(store, cfg, ledger)` (`watchlist_service_test.go:359-361`), then set `svc.marketdata = stub` and `svc.notify = &recordingNotify{}`. Name the tests `TestDelisting_…`. Every case calls `pruneOnce` (the runtime entry point).
   - **@AC-6** a `CLAIMED`, unservable `KPTI` → the store is asked to remove `[KPTI]`; servable `AAPL` is never passed.
   - **@AC-17** exactly one alert: WARNING, category `symbol_delisting`, no `TargetUserId`, body naming `KPTI`, `UNSERVABLE_REASON_NOT_TRADABLE` and `Signals`; `AckDelistingAlerts` is then called with `[KPTI]`. A second tick whose response reports `KPTI` as `REPORTED` sends no alert and no acknowledgement.
   - **@AC-18** two `CLAIMED` entries → two alerts, one naming each symbol, and one acknowledgement with both.
   - **@AC-22** the removal appends no ledger event (`fakeLedger.reqs` is empty) while the alert count is 1.
   - **@AC-5** tick 1 returns `ATCH` as `CLAIMED` and unservable, and the store is asked to remove `[ATCH]` (RED fails here). Tick 2 returns no `ATCH` entry: the store records no further removal and no `AddSymbols` call, and the cache no longer holds `ATCH`.
   - `PENDING` → not removed, no alert. `REPORTED` with `unservable_in_current_set = false` → not removed. `REPORTED` and unservable → removed, no alert, INFO only.
   - A `REDELIVERY` body says it may repeat an earlier alert and names only this tick's lists; a list whose `Left` holds the symbol is counted as removed on a later refresh, and a skipped list that left only a different symbol is not; a symbol on no system-managed list says so.
   - Sync error, sync timeout and gRPC `Unimplemented` → nothing removed, no alert, the cache from the previous tick is kept, `portfolio.marketdata_fetch{op=delistings}` records `error` or `timeout`.
   - `ListAllSymbols` error → no RPC.
   - The first alert send fails → no later alert is sent and nothing is acknowledged; the second of three fails → only the first is acknowledged.
   - An acknowledgement error is a WARN and does not panic.
   - Both RPCs carry `x-internal-caller: portfolio` and an `x-trace-id`, and no `x-user-id`; each context has a deadline at most 15 s after call entry; so does each alert send.
   - The step runs when the expiry prune failed (`pruneErr` set).
   - A nil marketdata client → the step is a no-op (the existing `TestSignalPrune_*` cases).
   - A nil notify client with a `CLAIMED` entry → the removal still runs, no alert and no acknowledgement are attempted, and nothing panics.
3. Name every test of `delisting_sync_test.go` `TestDelisting_…`; scenario tests are `TestDelisting_AC<n>_…` and carry a `// @AC-<n>` comment.
4. RED: with Step 22's `syncDelistings` present as an empty body, the `@AC-6` case fails on "store not asked to remove".

**Verification** (run as the Steps 22–23 unit):
```bash
test "$( cd services/xstockstrat-portfolio && GOWORK=off go test ./internal/service/ -race -count=1 -run 'TestDelisting_' -v | grep -c '^--- PASS' )" -ge 12   # the five scenario tests + the mechanism cases
( cd services/xstockstrat-portfolio && GOWORK=off go test ./internal/service/ -race -count=1 -run 'SignalPrune' )   # the existing prune tests stay green unchanged
go_gate xstockstrat-portfolio
test "$(grep -c "@AC-" services/xstockstrat-portfolio/internal/service/delisting_sync_test.go)" -ge 5
```

---

### Step 24 — service: decorate every watchlist response; filter the cross-user enumeration

**Status**: `pending`
**Service**: `xstockstrat-portfolio`
**Files**:
- `services/xstockstrat-portfolio/internal/service/delisting_sync.go` — modify
- `services/xstockstrat-portfolio/internal/service/portfolio_service.go` — modify
- `services/xstockstrat-portfolio/CLAUDE.md` — modify

**Reviewers**: `xstockstrat-portfolio` owner — position snapshot consistency, concurrent write safety

**Codebase Evidence**:
- Every watchlist-returning response is built in `services/xstockstrat-portfolio/internal/service/portfolio_service.go` (`grep -n "Watchlist: \|Watchlists: \|Binding: \|Bindings: "`): `CreateWatchlist` `:2202`, `EnsureSignalWatchlist` `:2216`, `GetWatchlist` `:2243`, `ListWatchlists` `:2266-2269` (`Watchlists:` at `:2267`, after the feature-351 ensure block `:2263-2265`), `UpdateWatchlist` `:2349` and `:2374`, `AddWatchlistSymbols` `:2483` and `:2502`, `RemoveWatchlistSymbols` `:2521`, `UpdateWatchlistBinding` `:2402-2405`, `UpdateWatchlistBindings` `:2433-2436`. `DeleteWatchlist` (`:2440`) returns no watchlist.
- `ListAllWatchlistSymbols` `:2221-2231`: caller gate `:2222-2225`, repo call `:2226`, response `:2230`.
- The cache: Step 22 (`s.delisted`).
- C-10(b): a displayed value must be surfaced by every read path that exposes it, with a parity test.
- CLAUDE.md cross-user paragraph: `services/xstockstrat-portfolio/CLAUDE.md:43`.

**TDD**: `red-green required`

**Covers**: —

**Instructions**:
1. `delisting_sync.go`: add to `delistedCache` a `lookup(symbol) *commonv1.DelistedState`, and two service helpers — `decorateWatchlists(wls ...*portfoliov1.Watchlist)` and `decorateBindings(bs ...*portfoliov1.WatchlistBinding)` — that assign `Delisted` from the cache for **every** binding, `nil` when the symbol is absent, so a value supplied by a caller is never echoed. An empty cache therefore decorates nothing.
2. `portfolio_service.go`: call the helper immediately before each of the eleven returns listed in the evidence. Nil watchlists and nil bindings are skipped. In `ListWatchlists` the call goes after the feature-351 ensure block (`:2263-2265`), immediately before the return at `:2266`, so the re-listed page and the fail-open page are both decorated. `ensureSignalListOnFirstPage` (`:2274-2295`) returns slices, not a response, and is not edited.
3. `ListAllWatchlistSymbols`: after the repo call at `:2226`, drop the symbols the cache holds. The repo `ListAllSymbols` stays unfiltered, because the tick's union (Step 22) depends on it.
4. No write path consults the cache: add, update and replace-all keep their feature-282 behavior, so a replace-all update still drops a flagged symbol through `refuseUnservable` (design R-10).
5. `services/xstockstrat-portfolio/CLAUDE.md` (`:43`): the enumeration returns the distinct set minus flagged-delisted symbols; every watchlist response carries `WatchlistBinding.delisted` from the cache; a flagged symbol on a system-managed list shows the marker from the tick that learns of it until a later tick removes it.
6. Broker coverage, order types, fill handling and `TRADING_MODE` are unaffected; position valuation paths are not edited (FR-6).

**Verification**:
```bash
( cd services/xstockstrat-portfolio && GOWORK=off go build ./... && GOWORK=off golangci-lint run --modules-download-mode=mod )
grep -c "decorateWatchlists\|decorateBindings" services/xstockstrat-portfolio/internal/service/portfolio_service.go   # >= 11
( cd services/xstockstrat-portfolio && GOWORK=off go test ./internal/service/ -race -count=1 -run 'TestListWatchlists351_' )   # the feature-351 durable scenarios stay green
git diff --exit-code HEAD -- services/xstockstrat-portfolio/internal/service/offline_valuation.go   # valuation is not edited by this step (FR-6)
```

---

### Step 25 — test: decoration parity across every watchlist RPC; enumeration filter

**Status**: `pending`
**Service**: `xstockstrat-portfolio`
**Files**:
- `services/xstockstrat-portfolio/internal/service/delisting_decorate_test.go` — create

**Reviewers**: `xstockstrat-portfolio` owner — position snapshot consistency

**Codebase Evidence**:
- Service-test harness: `newSvc`, `ctxWithUser`, `fakeWatchlistStore` (`watchlist_service_test.go:32-62,359-374`); internal-caller context for the enumeration test: existing `ListAllWatchlistSymbols` cases set `fakeWatchlistStore.allSymbols` (`:38-39`).
- The Step 23 `stubMarketData` overrides drive the cache through a real tick.
- Offline-valuation harness in the same package: `offline_valuation_test.go`, fixtures `internal/testdata/offline_pnl.go`.
- C-13: reuses the Step 23 doubles and `internal/testdata`; no second inline copy of a domain literal.

**TDD**: `red-green required`

**Covers**: `AC-4, AC-7, AC-8, AC-10, AC-16, AC-19`

**Instructions**:
Fill the cache by running a tick (`pruneOnce`) against a scripted sync response; never write the cache field directly. Name the tests `TestDelistedDecoration_…` (the enumeration cases `TestDelistedDecoration_ListAllWatchlistSymbols_…`); scenario tests are `TestDelistedDecoration_AC<n>_…` and carry a `// @AC-<n>` comment.
1. **Parity (C-10)** — one table-driven test over the eleven response sites of Step 24: with `ROKU` flagged (reason `UNSERVABLE_REASON_NOT_TRADABLE`, date `2026-11-09`), the `ROKU` binding of each response carries exactly that state and the `AAPL` binding carries none. The table is keyed by RPC name so a twelfth watchlist-returning RPC without a row fails review.
1a. Feature 351: a first-page `ListWatchlists` on a user with no system-managed list ensures an empty `Signals` list (`portfolio_service.go:2263-2265`; fake `EnsureSystemManaged` `watchlist_service_test.go:269-287`). Every case that calls `ListWatchlists` (the parity row, `@AC-19`, `@AC-4`) locates its list by `watchlist_id` and never asserts the response length or an index. Lists are created through `CreateWatchlist`, or seeded with uuid-shaped ids as the 351 tests do (`wl351A`, `:776-779`) — never with a `wl-<n>` id, which the fake's ensure can overwrite. The `ListWatchlists` parity row runs for a user with no system-managed list, so the decorated page is the one returned by the ensure-and-re-list path; a second sub-case sets `store.ensureErr` and asserts the fail-open page is decorated too.
2. **@AC-7** `ROKU` stays in `GetWatchlist` of a user-created list, marked; `RemoveWatchlistSymbols([ROKU])` removes it.
3. **@AC-19** lists `Tech` (user A) and `Media` (user B) both carry the same state for `ROKU` from the single cache entry.
4. **@AC-16** the watchlist returned by `AddWatchlistSymbols` when `MSFT` is added to `Tech` carries the state for `ROKU`.
5. **@AC-8** `ListAllWatchlistSymbols` omits flagged `ROKU` and keeps `AAPL`, while the symbols sent in the next tick's `SyncWatchlistDelistings` request still include `ROKU`.
6. **@AC-4** after a first tick that flags `ROKU` (every response carries `delisted` for it; the enumeration omits it), a second tick whose response no longer lists `ROKU` leaves no response with `delisted` for it and the enumeration returns `ROKU` again.
7. An input binding that arrives with `delisted` set is not echoed for an unflagged symbol; an empty cache decorates nothing.
8. **@AC-10 (guard)** with the cache holding `NWE`, the offline valuation of a 10-share `NWE` position returns the same mark as with an empty cache (reuse the `offline_valuation_test.go` harness). It passes on today's code; it fails only if a valuation path starts consulting the cache.
9. RED: with Step 24's helpers present as empty bodies, the parity test fails on every row.

**Verification**:
```bash
test "$( cd services/xstockstrat-portfolio && GOWORK=off go test ./internal/service/ -race -count=1 -run 'TestDelistedDecoration_' -v | grep -c '^--- PASS' )" -ge 7   # parity table (one test) + six scenario tests + the input-binding case
( cd services/xstockstrat-portfolio && GOWORK=off go test ./internal/service/ -race -count=1 -run 'ListAllWatchlistSymbols' )   # the existing enumeration tests stay green
( cd services/xstockstrat-portfolio && GOWORK=off go test ./internal/service/ -race -count=1 -run 'TestListWatchlists351_' )   # the feature-351 durable scenarios stay green
go_gate xstockstrat-portfolio
test "$(grep -c "@AC-" services/xstockstrat-portfolio/internal/service/delisting_decorate_test.go)" -ge 6
```

---

### Step 26 — service: analysis skips flagged bindings in its two watchlist drains

**Status**: `pending`
**Service**: `xstockstrat-analysis`
**Files**:
- `services/xstockstrat-analysis/app/handlers/servicer.py` — modify
- `services/xstockstrat-analysis/app/engine/live_loop.py` — modify

**Reviewers**: `xstockstrat-analysis` owner — strategy scoring determinism, backtest reproducibility

**Codebase Evidence**:
- `_drain_watchlist_bindings`: `services/xstockstrat-analysis/app/handlers/servicer.py:5995-6027` — the binding branch `out.extend((b.symbol, b.strategy_id) for b in wl.bindings)` at `:6020-6021`, the legacy flat-`symbols` branch `:6022-6023`. Callers `:5368`, `:6109`.
- `_drain_watchlist`: `services/xstockstrat-analysis/app/engine/live_loop.py:592-622` — binding branch `:616-617`, legacy branch `:618-619`. Callers `live_loop.py:403`, `app/engine/entry_backfill.py:149`.
- `GetWatchlistReadiness` (`servicer.py:4153-4164`) also reads bindings and is intentionally left unchanged: the UI replaces the readiness cell for a flagged binding (Step 30), so its verdict is never shown. The design authorises only the two drains.
- The third watchlist-symbol source, `_enumerate_watchlist_union` (`app/engine/fundsignal_loop.py:394`), reads `ListAllWatchlistSymbols`, which portfolio filters in Step 24 — no analysis change there (design §7).
- No new outbound call; both drains already send their propagation metadata (`servicer.py:6014`, `live_loop.py:609`).

**TDD**: `red-green required`

**Covers**: —

**Instructions**:
1. In both binding branches, skip a binding for which `b.HasField("delisted")` is true. Keep the `if wl.bindings:` test on the unfiltered list, so a list whose bindings are all flagged yields nothing and never falls through to the legacy `symbols` branch.
2. The legacy branch, the error paths, pagination and the returned types are unchanged.

**Verification**:
```bash
cd services/xstockstrat-analysis && ruff check . && ruff format --check .
grep -n 'HasField("delisted")' app/handlers/servicer.py app/engine/live_loop.py     # one hit in each file
```

---

### Step 27 — test: flagged bindings leave the opportunity scan and the live loop

**Status**: `pending`
**Service**: `xstockstrat-analysis`
**Files**:
- `services/xstockstrat-analysis/tests/test_analysis_servicer.py` — modify
- `services/xstockstrat-analysis/tests/test_live_loop_telemetry.py` — modify

**Reviewers**: `xstockstrat-analysis` owner — strategy scoring determinism

**Codebase Evidence**:
- Servicer harness: `make_servicer` `services/xstockstrat-analysis/tests/test_analysis_servicer.py:43`; an existing `ListWatchlists` mock on `svc._portfolio` `:4818`; the C-03 metadata assertion on that call `:5174-5177`.
- Live-loop harness already imported in one module: `_make_loop` and `_wire_drains` (`tests/test_live_loop_telemetry.py:16-24,53`), with an existing `_drain_watchlist` call `:136`. Adding the cases to these two files introduces no new cross-test import (ledger `fails.md` 2026-11-10, 289: pick a cycle-free home).
- C-13: the watchlist responses are built per case from generated messages; the `Tech` list with `AAPL` and `ROKU` has one consumer per file — inline is compliant.

**TDD**: `red-green required`

**Covers**: `AC-8`

**Instructions**:
1. `test_analysis_servicer.py`: **@AC-8** `_drain_watchlist_bindings` over a `ListWatchlists` response holding `AAPL` and a `ROKU` binding with `delisted` set returns `AAPL` only; a list whose only binding is flagged returns nothing even when its legacy `symbols` mirror names the symbol; a binding without `delisted` is unchanged. Assert `ListWatchlists.await_count == 1` beside the "not returned" assertion.
2. `test_live_loop_telemetry.py`: **@AC-8** `_drain_watchlist("o-1")` returns `{"AAPL"}` for the same response.
3. RED: both cases fail against the unmodified drains (`ROKU` is returned).

**Verification**:
```bash
py_gate xstockstrat-analysis
( cd services/xstockstrat-analysis && pytest -q tests/test_analysis_servicer.py tests/test_live_loop_telemetry.py -k "delisted" )
```

---

### Step 28 — service: agent tools return the delisted state and the per-symbol backfill outcomes

**Status**: `done`
**Service**: `xstockstrat-agent`
**Files**:
- `services/xstockstrat-agent/app/client.py` — modify
- `services/xstockstrat-agent/app/tools.py` — modify (docstrings)
- `services/xstockstrat-agent/CLAUDE.md` — modify
- `docs/runbooks/mcp-tools.md` — modify
- `plugins/strat-lab/skills/backtest/reference/backfill.md` — modify
- `plugins/strat-lab/skills/backtest/SKILL.md` — modify

**Reviewers**: `xstockstrat-agent` owner — MCP tool contract stability (name, parameters, return shape) and `docs/runbooks/mcp-tools.md` parity

**Codebase Evidence**:
- `_watchlist_to_dict`: `services/xstockstrat-agent/app/client.py:377-379` — plain `MessageToDict`, so proto3 defaults are omitted; it is the single projection behind all four watchlist tools (8 call sites: `:430`, `:446`, `:477`, `:532`, `:554`, `:594`, `:609`, `:634`).
- Enum-name projection precedent: `_refused_to_list` `:382-389` (`common_pb2.UnservableReason.Name(r.reason)`).
- `get_backfill_status`: `:2146` — single-job return `:2173-2179`, list return `:2199-2207`, both `MessageToDict(…, always_print_fields_with_no_presence=True)`.
- Tool docstrings: `get_backfill_status` `services/xstockstrat-agent/app/tools.py:1642-1661`, `list_watchlists` `:2153`, `get_watchlist` `:2171`, `manage_watchlist` `:2192`, `manage_watchlist_symbols` `:2283`.
- Docs that must change with the tools (C-10, ledger `fails.md` entry cited at `recon.md` § Risks, 306): `docs/runbooks/mcp-tools.md` `### get_backfill_status` `:1052`, `### list_watchlists` `:1380`, `### get_watchlist` `:1401`, `### manage_watchlist` `:1422`, `### manage_watchlist_symbols` `:1473`; `services/xstockstrat-agent/CLAUDE.md:71-86`; `plugins/strat-lab/skills/backtest/reference/backfill.md:50-58`; `plugins/strat-lab/skills/backtest/SKILL.md:205-221`.
- Plugin guard rail: a change to `get_backfill_status` / `trigger_backfill` behavior updates the skill in the same PR; `python3 plugins/strat-lab/scripts/validate.py` must pass (`docs/patterns/strat-lab-plugin.md`). Feature 343 changed the skill without a plugin version bump, so none is made here.
- No new tool and no new argument: the tool-count statements stay as they are.
- No new outbound call.

**TDD**: `red-green required`

**Covers**: —

**Instructions**:
1. `client.py`, watchlists: `_watchlist_to_dict` post-processes every entry of `bindings`, reading the state from the proto binding (not from the dict): `delisted` is always present as a bool; when the binding has `delisted` set it also gets `delisted_reason` (the `UnservableReason` enum **name**) and `first_unservable_date` — the string as given when it matches `YYYY-MM-DD`, otherwise the key is omitted; the date is never parsed through a time zone. The nested proto `delisted` object is not returned. A watchlist with no bindings is returned as today.
2. `client.py`, backfill: add one job post-processor applied in **both** returns of `get_backfill_status` (`:2173-2179` and `:2199-2207`): each `symbol_results` entry becomes `{"symbol", "outcome", "reason"}` with `outcome` one of `empty`, `skipped`, `failed` (the enum name without its prefix, lower-cased) and `reason` omitted when empty. `symbol_results` is always present (an empty list when there is none).
3. `tools.py` docstrings: `get_backfill_status` — add `symbol_results` to the listed fields with the three outcomes, that `skipped` is a symbol flagged delisted that the data source could not serve, that it is not in `failed_symbols` and does not make the job `PARTIAL`, and that `empty` means nothing to write. The four watchlist tools — each binding carries `delisted` (bool) and, when true, `delisted_reason` and `first_unservable_date`; `manage_watchlist` — a replace-all update still drops a flagged symbol and reports it in `refused`. The `list_watchlists` docstring keeps the feature-351 sentence at `:2154-2156` (a first-page call idempotently ensures the caller's "Signals" list) and is not described as read-only again; the header line `tools.py:33` is not edited.
4. `services/xstockstrat-agent/CLAUDE.md`: the watchlist statement in the paragraph at `:71-86`, and a new one-sentence `get_backfill_status` bullet under `## MCP Tools` (`:26`) stating `symbol_results` and the three outcomes (the file has no `get_backfill_status` description today).
5. `docs/runbooks/mcp-tools.md`: update the five tool sections' return shapes and examples (`:1052-1083`, `:1380-1506`) with the new keys; the feature-351 sentence at `:1384-1385` is kept; state under `trigger_backfill` (`:964`) that a flagged-delisted symbol the source cannot serve ends `skipped`, not `failed`.
6. `plugins/strat-lab/skills/backtest/reference/backfill.md` (`:50-58`): after "No error text in the body", add that `get_backfill_status` now lists per-symbol `symbol_results`; a `skipped` symbol is delisted and has no new data — do not re-trigger it and do not treat the job as failed; `failed_symbols` still lists only real failures; the webhook body is unchanged. `SKILL.md` Phase 1 (`:205-221`): one bullet with the same rule.
7. No header or deployment change.
8. Files count 6 (two source, four docs that must change with the tool contract per C-10); not split.

**Verification**:
```bash
cd services/xstockstrat-agent && ruff check . && ruff format --check . && pytest -q
cd ../.. && python3 plugins/strat-lab/scripts/validate.py --self-test && python3 plugins/strat-lab/scripts/validate.py
grep -c "symbol_results" docs/runbooks/mcp-tools.md plugins/strat-lab/skills/backtest/reference/backfill.md services/xstockstrat-agent/app/tools.py   # each >= 1
grep -c "delisted" docs/runbooks/mcp-tools.md services/xstockstrat-agent/app/tools.py services/xstockstrat-agent/CLAUDE.md                              # each >= 1
grep -c symbol_results services/xstockstrat-agent/CLAUDE.md   # >= 1
python3 scripts/check-context-map.py
```

---

### Step 29 — test: agent projections

**Status**: `done`
**Service**: `xstockstrat-agent`
**Files**:
- `services/xstockstrat-agent/tests/test_watchlist_client.py` — modify
- `services/xstockstrat-agent/tests/test_client.py` — modify

**Reviewers**: `xstockstrat-agent` owner — MCP tool contract stability (name, parameters, return shape)

**Codebase Evidence**:
- Watchlist client tests: `services/xstockstrat-agent/tests/test_watchlist_client.py` — `test_list_watchlists_paginates_and_forwards_user` `:47`, `test_get_watchlist_returns_bindings` `:80`, `test_add_symbols_returns_watchlist_and_refused` `:477`, the proto-field guard `test_refused_symbol_projection_matches_proto_fields` `:579-593`.
- Backfill-status tests: `services/xstockstrat-agent/tests/test_client.py:670-752` (single job `:688`, list mode `:729`).
- C-13 (Python): the watchlist and job messages are built per test from generated classes, as the neighbouring tests do; a fixture is extracted to `tests/conftest.py` only if the same literal is needed by both files.

**TDD**: `red-green required`

**Covers**: `AC-14, AC-16, AC-24`

**Instructions**:
1. `test_watchlist_client.py`:
   - **@AC-16** `get_watchlist` for a list holding `AAPL` and flagged `ROKU` returns `delisted: true`, `delisted_reason: "UNSERVABLE_REASON_NOT_TRADABLE"` and `first_unservable_date: "2026-11-09"` on `ROKU`, and `delisted: false` with neither extra key on `AAPL`; `list_watchlists` reports the same state; the watchlist returned by `manage_watchlist_symbols` (add `MSFT`) carries it too.
   - A malformed date (`"2026-11-9"`, `"09/11/2026"`) is omitted while `delisted` stays true.
   - A guard in the style of `:579-593`: the projection reads exactly the fields of `common_pb2.DelistedState` (`reason`, `first_unservable_date`), so a new proto field turns the test red.
2. `test_client.py`:
   - **@AC-14** `get_backfill_status(job_id=…)` for a job with `PSKY` skipped and `AXIA` failed returns `symbol_results` entries with outcomes `skipped` and `failed` and their reasons.
   - **@AC-24** an `EMPTY` entry has outcome `empty` and no `reason` key.
   - List mode applies the same post-processing; a job with no results returns `symbol_results: []`.
3. RED: run the `@AC-16` and `@AC-14` tests against the unmodified client (no `delisted` key; enum names not mapped).

**Verification**:
```bash
py_gate xstockstrat-agent
( cd services/xstockstrat-agent && pytest -q tests/test_watchlist_client.py tests/test_client.py -k "delisted or symbol_results or backfill_status" )
```

---

### Step 30 — service: `/insights` watchlist row shows the delisted marker

**Status**: `pending`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/src/lib/opportunityShared.tsx` — modify
- `services/xstockstrat-ui/src/components/insights/WatchlistReadiness.tsx` — modify
- `services/xstockstrat-ui/src/components/insights/WatchlistDetail.tsx` — modify
- `services/xstockstrat-ui/src/hooks/useWatchlistReadiness.ts` — modify

**Reviewers**: `xstockstrat-ui` owner — analytics display accuracy, Connect-RPC call safety

**Codebase Evidence**:
- Row markup: bound rows `services/xstockstrat-ui/src/components/insights/WatchlistReadiness.tsx:295-370` (verdict cell `:311-343`, the loading `Skeleton` branch `:334-342`), unbound rows `:372-396`; the row badge precedent `SignalSourceBadge` `:41-48`.
- Hand-written binding type declared twice: `WatchlistReadiness.tsx:34` and `WatchlistDetail.tsx:38`.
- Reason text map: `UNSERVABLE_REASON` `services/xstockstrat-ui/src/lib/opportunityShared.tsx:48-52` (`NOT_TRADABLE` → "not an active, tradable US equity", the text AC-15 names); it is unit-tested (`src/lib/opportunityShared.test.ts:47-63`).
- `Badge` variants: `services/xstockstrat-ui/src/components/ui/badge.tsx:11-27`; `warning` at `:25` (**C-17**: reuse an existing primitive and variant; no new color literal).
- No BFF change: the generated message passes through `src/lib/insightsBff.ts:137-147`.
- Analysis no longer scans a flagged binding (Step 26), so its readiness would stay unresolved or stale; the UI therefore never shows a flagged binding's readiness, whatever analysis returns, and the component passes only unflagged bound pairs to `useWatchlistReadiness`, so a flagged pair never keeps the poll alive and, when the list's only bound bindings are flagged, the request is not issued at all.
- Poll-alive rule: `useWatchlistReadiness` refetches every 30 s while any `pagePairs` entry is missing, `PENDING` or `UNKNOWN` (`services/xstockstrat-ui/src/hooks/useWatchlistReadiness.ts:42-49`) and is disabled when `pagePairs` is empty (`:40`). The request itself carries only the watchlist id and the page (`:35-39`), never the pairs. The component builds the pairs from the page's bound bindings (`WatchlistReadiness.tsx:215-229`; the hook call `:225-229`, its pairs argument `:228`).
- Paging: the page token comes only from the server — `nextToken = data?.page?.nextPageToken` (`WatchlistReadiness.tsx:231`); `goNext` returns without it (`:252-256`) and the Next control is disabled without it (`:419`). The component slices its own page from the full local bound list with the same keyset cursor (`bound` `:215`, `afterCursor` `:220-222`, `pageBound` `:223`, page size `WATCHLIST_READINESS_PAGE_SIZE` = 25, `useWatchlistReadiness.ts:12`), so it knows locally whether more bound bindings follow the page (`afterCursor.length > pageBound.length`). A page whose bound rows are all flagged would pass no pairs, disable the hook (`useWatchlistReadiness.ts:40`), leave `nextToken` empty and make the later pages unreachable — instruction 5 closes that.
- `useWatchlistReadiness` has one caller: `WatchlistReadiness.tsx:225`.
- No new page or route — no `PLATFORM_SUBNAV` change (**C-10(a)** not triggered).

**TDD**: `red-green required`

**Covers**: —

**Instructions**:
1. `opportunityShared.tsx`: add a pure helper next to `UNSERVABLE_REASON` that takes a binding's optional `delisted` state and returns `null` when absent, else `{ text, date }` where `text` is `UNSERVABLE_REASON[reason]` and `date` is the `firstUnservableDate` string **as given** when it matches `^\d{4}-\d{2}-\d{2}$`, else `undefined`. The date is never passed through `Date`.
2. `WatchlistReadiness.tsx`:
   - Export the `Binding` type and add the optional `delisted` field typed from the generated `DelistedState`.
   - Add a `DelistedBadge` next to `SignalSourceBadge`: `<Badge variant="warning" data-testid={`delisted-badge-${symbol}`}>` with the label `Delisted`, followed by the reason text and, when present, the date; its accessible name contains the symbol, the reason text and the date.
   - Bound rows: when the binding is flagged, render `DelistedBadge` in the verdict cell **in place of** the three readiness branches (resolved / unknown / loading), and render no `Review` link. Unbound rows: render `DelistedBadge` in place of the "not evaluated — bind a strategy" text.
   - Derive `readable = pageBound.filter((b) => !b.delisted)`. Use `readable` for the `useWatchlistReadiness` pairs (`:228`), for `resolved` (`:233-237`), for the `rollupReadiness` requested-symbol list (`:238-241`) and for the `readable.length > 0` test that shows the roll-up (`:280`), so a flagged row neither polls nor counts as "no-data" (`src/lib/readinessRollup.ts:58-61` counts any requested symbol without a resolved row). `pageBound` itself (`bound`, `afterCursor`, `pageBound`, `:215-222`) still drives the page slice and the rows, because the server's keyset cursor covers flagged ones too.
   - Row checkbox and `BindingRowControls` stay, so the owner can still remove the symbol.
3. `WatchlistDetail.tsx`: delete its local `Binding` declaration (`:38`) and import the exported one.
4. No hardcoded color, no new `ui/*` primitive, no BFF or route change.
5. Paging past an all-flagged page — one hook change. `useWatchlistReadiness.ts`: add an optional fourth parameter `morePages = false` and change `enabled` (`:40`) to `Boolean(watchlistId) && (pagePairs.length > 0 || morePages)`. Nothing else in the hook changes: the query key, the request and the poll-alive test (`:42-49`) still use `pagePairs` only, so with no pairs the request is issued once, never polls, and returns the server's `nextPageToken`. `WatchlistReadiness.tsx` passes `readable`'s pairs and `afterCursor.length > pageBound.length` as `morePages`. Results: a page with at least one unflagged bound row behaves as today; a page whose bound rows are all flagged and that is followed by more bound bindings issues one request, so Next is enabled; a list whose only bound bindings are flagged and fit one page issues no request. The default keeps the hook's behavior for a caller that passes three arguments. Update the hook's doc comment in at most two lines to state the constraint (`morePages` enables the fetch for paging only; it never keeps the poll alive).

**Verification**:
```bash
cd services/xstockstrat-ui && pnpm run lint && pnpm exec tsc --noEmit && pnpm run lint:dup
grep -c "^type Binding" src/components/insights/WatchlistDetail.tsx    # 0 — single declaration
grep -n "delisted-badge" src/components/insights/WatchlistReadiness.tsx
```

---

### Step 31 — test: marker unit test, fixtures and e2e

**Status**: `pending`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/src/lib/opportunityShared.test.ts` — modify
- `services/xstockstrat-ui/e2e/helpers/watchlistMock.ts` — modify
- `services/xstockstrat-ui/e2e/fixtures/INVENTORY.md` — modify
- `services/xstockstrat-ui/e2e/insights/watchlists.spec.ts` — modify

**Reviewers**: `xstockstrat-ui` owner — analytics display accuracy

**Codebase Evidence**:
- Inventory (C-12): row "Watchlists (stateful mock)" — `mockWatchlists`, `MockWatchlist`, `MockBinding` in `services/xstockstrat-ui/e2e/helpers/watchlistMock.ts` (`MockBinding` `:23`, `MockWatchlist` `:24-36`, `MOCK_UNSERVABLE` `:43-45`, readiness overrides `:52`), catalogued at `e2e/fixtures/INVENTORY.md:47`; consumers `e2e/insights/watchlists.spec.ts` and `e2e/insights/screener.spec.ts`.
- protojson enum-name convention in the mock: `UnservableReasonName` `watchlistMock.ts:39`.
- Existing spec to extend: `services/xstockstrat-ui/e2e/insights/watchlists.spec.ts` — seeded-list cases `:331` and `:376`, the feature-282 cases `:767` and `:784`; auth through the spec's existing `e2e/helpers/auth.ts` helper.
- Vitest covers `src/lib/**` (root `CLAUDE.md` § Language Versions); `UNSERVABLE_REASON` tests `src/lib/opportunityShared.test.ts:47-63`.
- E2E run form used by recent specs: `pnpm exec playwright test <file> --project=chromium` (`docs/roadmap/features/350-fix-row-menu-stays-open/implementation-spec.md:130-132`).

**TDD**: `red-green required`

**Covers**: `AC-15`

**Instructions**:
1. `opportunityShared.test.ts`: the helper returns `null` without a state; the text for `NOT_TRADABLE` and for `OTC`; the date as given for `2026-11-09`; `undefined` for a malformed date; never a shifted day.
2. `watchlistMock.ts`: add an optional `delisted?: { reason: UnservableReasonName; firstUnservableDate: string }` to `MockBinding`; the mock returns it unchanged on every watchlist response. Its readiness route is unchanged (a flagged binding's readiness is not shown by the UI whatever analysis returns; a case that needs a `PENDING` row for it uses the existing `readinessOverrides` argument, `:52`). No new fixture module: this extends the existing inventory fixture.
3. `INVENTORY.md` (`:47`): append "feature 352 — optional `MockBinding.delisted` (protojson `{ reason, firstUnservableDate }`)".
4. `watchlists.spec.ts`: **@AC-15** seed `Tech` with `AAPL` and a `ROKU` binding flagged `UNSERVABLE_REASON_NOT_TRADABLE` / `2026-11-09`; open it on `/insights/watchlists`; the `ROKU` row shows the delisted badge with the text "not an active, tradable US equity" and `2026-11-09`, shows no readiness skeleton and no `Review` link; the `AAPL` row has no delisted badge; `ROKU` can still be removed with its row control. In the same case force `ROKU`'s readiness row to `PENDING` through `readinessOverrides` and assert the `ROKU` row still shows the badge and no skeleton. The roll-up text (`data-testid="readiness-rollup"`) does not count `ROKU`: with `AAPL` resolved and `ROKU` flagged it shows no "no-data" count. Add a second case for a flagged **unbound** symbol. Add a third case — a list whose only bound binding is the flagged `ROKU`: the page issues **no** `GetWatchlistReadiness` request (count them with `page.on('request')` filtered on the route's URL suffix; the request carries no pairs, so the absence of the request is the observable proof that a flagged pair is not passed to the hook). Add a fourth case — a list with 26 bound bindings whose first 25 in keyset order are all flagged and whose 26th is unflagged (seeded through `mockWatchlists`; the mock's readiness route already pages at 25 and issues `nextPageToken`, `watchlistMock.ts:257-284`): the first page shows 25 delisted badges and no readiness roll-up, the "Next page of watchlist rows" control is enabled, clicking it renders the 26th row with its readiness, and the page issued exactly one `GetWatchlistReadiness` request before the click (no poll for the flagged page).
5. Test data comes only from `mockWatchlists` (seed argument) — no inline watchlist literal outside the seed, which is a `{ ...override }` scenario one-off of the inventory fixture.
6. RED: the vitest case fails without the helper; the e2e case fails on the missing badge; the fourth case fails on a disabled Next control without instruction 5 of Step 30.

**Verification**:
```bash
cd services/xstockstrat-ui && pnpm run lint && pnpm exec tsc --noEmit
pnpm run test:coverage   # vitest thresholds lines/functions/statements 40 over src/lib/** (services/xstockstrat-ui/vitest.config.ts:29-33)
pnpm exec playwright test e2e/insights/watchlists.spec.ts e2e/insights/screener.spec.ts --project=chromium
grep -n "helpers/watchlistMock\|helpers/auth" e2e/insights/watchlists.spec.ts      # inventory + auth helpers imported (C-12)
grep -n "feature 352" e2e/fixtures/INVENTORY.md
```

---

### Step 32 — docs: amend the three durable scenarios whose change was signed off (C-16)

**Status**: `pending`
**Service**: `docs/sdd/business-rules/`, `services/xstockstrat-marketdata/acceptance/`, `services/xstockstrat-portfolio/acceptance/`
**Files**:
- `services/xstockstrat-marketdata/acceptance/filter-otc-symbols.feature` — modify
- `docs/sdd/business-rules/platform.feature` — modify
- `services/xstockstrat-portfolio/acceptance/fundsignal-watchlist-universe.feature` — modify

**Reviewers**: none

**Codebase Evidence**:
- `@AC-15 @FR-3 @feature-282` "The first successful load removes unservable symbols warmed while unloaded": `services/xstockstrat-marketdata/acceptance/filter-otc-symbols.feature:74-79`; the clause that changes is `:79`.
- `@AC-17 @FR-3 @feature-282` "A held offline unservable symbol stays valued and warm across later refreshes": `docs/sdd/business-rules/platform.feature:1314-1319`; the clause that changes is `:1319`.
- `@AC-1 @FR-1 @feature-154` "Portfolio enumerates the distinct cross-user union of watchlist symbols": `services/xstockstrat-portfolio/acceptance/fundsignal-watchlist-universe.feature:11-17`; the clause that changes is `:16`.
- Operator sign-offs: `context.md` — 2026-11-16 (282 marketdata `@AC-15`; platform `@AC-17` for flagged symbols only) and 2026-11-17 round-4 gate (154 `@AC-1`). `design.md` § Business Rules Touched lists exactly these three as CHANGE.
- Scenario IDs are append-only and never renumbered (**C-15**); promoted scenarios are curated, not deleted (`docs/sdd/business-rules/CLAUDE.md`).

**TDD**: `N/A (docs)`

**Covers**: —

**Instructions**:
1. Marketdata `@AC-15` (`:79`): keep the line's meaning for an unflagged symbol and add the flagged case — "And a later refresh that stops listing AAPL does not remove it from the warm set until AAPL is flagged delisted (feature 352)". Add `@feature-352` to the tag line; keep `@AC-15 @FR-3 @feature-282`.
2. Platform `@AC-17` (`:1319`): "And FORL stays in the warm set after the later refresh, or, once FORL is flagged delisted (feature 352), leaves it at each load and is re-warmed by the next quote read". Add `@feature-352` to the tag line.
3. Portfolio `@AC-1` (`:16`): "Then the response contains exactly the distinct set {"AAPL", "MSFT", "NVDA"} minus any symbol flagged delisted (feature 352)". Add `@feature-352` to the tag line.
4. No other scenario is edited. The feature-351 durable scenarios — portfolio `ensure-signals-watchlist-on-read.feature` `@AC-1…@AC-8, @AC-10` and agent `mcp-watchlist-tools.feature` `@AC-1 @feature-351` — are PRESERVE: Steps 24 and 28 only add an output field, and the `TestListWatchlists351_` run in Steps 24/25 guards them. The EXTEND and PRESERVE rows of `design.md` need no text change here; this feature's own scenarios are promoted at the integration PR.

**Verification**:
```bash
grep -n "feature-352" services/xstockstrat-marketdata/acceptance/filter-otc-symbols.feature docs/sdd/business-rules/platform.feature services/xstockstrat-portfolio/acceptance/fundsignal-watchlist-universe.feature   # 3 tag lines
git diff --stat HEAD -- services/*/acceptance docs/sdd/business-rules | tail -1   # 3 files changed
grep -c "@AC-15 @FR-3 @feature-282" services/xstockstrat-marketdata/acceptance/filter-otc-symbols.feature     # 1 — the ID and its tags are kept
```

---

## Deviation Log

_Populated by /sdd-execute as implementation proceeds._
