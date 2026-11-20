# Implementation Spec: fix-retired-surface-proto-cleanup

**Status**: `pending`
**Created**: 2026-11-20
**Feature**: `docs/roadmap/features/322-fix-retired-surface-proto-cleanup/feature.md`
**Total Steps**: 34
**Feature Branch**: `feature/fix-retired-surface-proto-cleanup`

---

## Execution Summary

The work is three sweeps (design.md § Chosen Approach), ordered so every commit is green on its own.
Steps 1–3 land the single non-breaking proto PR-unit with its regenerated stubs and one descriptor
contract test. Steps 4–13 then clear, service by service, the Go SA1019 lint fallout the deprecations
create and migrate `BatchGetBars` (server first, then the three producers, D-1). Steps 14–16 remove the
sparkline residue. Steps 17–32 delete the `trading_mode` watcher plumbing in ten services, and steps
33–34 fix the docs.

There is **no migration step and no config step**: config migration `046_config_dead_rows_prune`
already prunes `analysis`/`opportunity.sparkline_bars` and `marketdata`/`alpaca.paper` (D-4, R-3), so
this feature claims no `NNN`. No new env var, port or outbound gRPC call is introduced, so
`docker-compose.yml` and `.do/app*.yaml` are untouched.

**Evidence stamp.** Every `path:line` below was re-grepped at `feature/fix-retired-surface-proto-cleanup`
@ `42300c5a`. That branch is 168 commits behind `origin/main-dev`, and `main-dev` has since changed
several cited files (for example `services/xstockstrat-trading/internal/service/trading.go`). Line
numbers are hints; the **symbol names are the anchor**. `/sdd-execute` re-greps each symbol after it
syncs the branch.

**Trading-domain scope (step-constraints §A).** No step touches order placement, `BrokerType`
dispatch, `OrderType` or fill handling — order type handling, fill handling and both brokers
(ALPACA, IBKR) are unaffected by every step. `TRADING_MODE` keeps its deployment values (`paper` in
`docker-compose.yml:17` and `.do/app.dev.yaml:30`, `live` in `.do/app.yaml:30`); no step edits them.
Trading's `Config.TradingMode` stays as the `trading.broker.paper` fallback (D-3, owned by feature 321).

### Scenario Coverage (C-15)

| Scenario | Covered by |
|---|---|
| `@AC-1` no service sends or documents the retired `trading_mode` axis | Steps 18, 20, 22 (Python watchers); 24, 26, 28 (Go watchers, marketdata `Paper`); 30, 32 (Node watchers); 33 (service `CLAUDE.md` env blocks). The "no unread `marketdata.alpaca.paper` key" clause is already true in the repo (migration `046`) and is confirmed on dev and prod by the D-4 launch gate below. |
| `@AC-2` opportunity contract and consumers reflect the client-side sparkline | Step 3 (field 17 deprecated, number kept); Step 15 (agent output carries no `sparkline` key); Step 16 (durable `@AC-8 @feature-191` clause dropped). |
| `@AC-3` proto contracts carry no stalled migrations or mislabelled caller identity | Step 3 (descriptor contract test; unit Verification runs `buf lint` and `buf breaking`); Step 5 (`BatchGetBars` accepts the enum); Step 13 (`SnapshotOfflinePositions` carrier). |

### Consumer Surfaces (C-14)

- **Agent** `list_opportunities` — Steps 14–15 (the `sparkline` key is gone; `live_price` and the
  omission of absent fields are preserved).
- **UI** opportunities OHLC strip — Steps 10–11 (`useOhlcBars` sends both timeframe fields; rendering
  is unchanged).
- Everything else is internal/platform-only (watchers, proto annotations, the trading carrier). That
  is a decision recorded in design.md, not an omission.

### Launch gate (D-4, not a step)

At launch, on dev and prod, the operator runs against the config database:

```sql
SELECT namespace, key, environment FROM config.config_keys_report_296
 WHERE action = 'unmatched-signed-tuple'
   AND (namespace, key) IN (('analysis','opportunity.sparkline_bars'), ('marketdata','alpaca.paper'));
SELECT count(*) FROM config.config_values
 WHERE user_id IS NULL
   AND (namespace, key) IN (('analysis','opportunity.sparkline_bars'), ('marketdata','alpaca.paper'));
```

Both must return no row / `0`. A hit means migration `046` kept-and-reported a row
(`046_config_dead_rows_prune.up.sql:42-47`); that is escalated to the operator, not fixed by a new
migration here (R-3).

## Step Dependencies

- Steps 1+2+3 land together: a `.proto` edit needs its `proto-gen` step, and Step 3's test references
  descriptor state only Steps 1–2 create (step-constraints §C rows 2 and 3). One backend unit, 3 steps.
- Steps 4–34 all require Step 2 (regenerated stubs).
- **Known lint-red window.** After the Steps 1–3 commit, `golangci-lint` (staticcheck SA1019) is red for
  `xstockstrat-marketdata`, `xstockstrat-portfolio` and `xstockstrat-trading` until Steps 5, 7 and 13
  land (D-6: directives are added only where the linter flags them after buf-gen). The unit's own
  Verification is buf + build + tests, so it passes; the three services cannot join the unit without
  breaking the 4-step cap. Run Steps 4–13 immediately after the unit. With per-step PRs, the Go lint
  jobs on those PRs are expected red until each service's step lands.
- Step 5 [test] covers Step 4 [service]. Lint runs in Step 5 because the existing
  `BatchGetBarsRequest` test literals are flagged until Step 5 annotates them.
- Steps 6, 8 and 10 (producers send both fields) require Step 4 on the branch first (R-1: the server
  read lands first or in the same PR). Step 7 covers Step 6; Step 9 covers Step 8; Step 11 covers Step 10.
- Step 13 [test] covers Step 12 [service]. Lint runs in Step 13 for the same reason as Step 5.
- Steps 14+15 land together: Step 14 changes the projection's return shape and turns the
  descriptor-parity guard red (§C rows 1 and 2). Agent surface, 2 steps.
- Step 16 requires nothing but is placed with the sparkline sweep.
- Steps 17+18, 19+20 and 21+22 land together (one unit per Python service): each `service` step
  removes `resolve_trading_mode`, which the service's test module imports (§C row 6).
- Steps 23+24, 25+26 and 27+28 land together (one unit per Go service): each `service` step deletes a
  function or changes a signature in a package whose `_test.go` references it (§C row 1).
- Step 30 [test] covers Step 29 [service]; Step 32 [test] covers Step 31 [service]. No unit is needed:
  the Node request is unchanged on the wire, so both tests pass before and after.
- Step 31 edits three byte-identical files in one step because `scripts/check-watcher-copies.sh`
  (CI) fails on drift between them.
- Steps 27–28 require Step 5 (both edit `xstockstrat-marketdata`; Step 5 leaves its lint green).
- Step 33 requires Steps 18–32 (the docs must describe the code as it then stands).
- Not in scope, by design: the agent's body `user_id` write on `SnapshotOfflinePositionsRequest`
  (`services/xstockstrat-agent/app/client.py`, `snapshot_offline_positions`) stays — design § 5 scopes
  the carrier work to trading, the server ignores the value, and Python has no deprecation lint. The
  six analysis `ComputeIndicatorRequest(timeframe=…)` writes stay (D-2, R-8). The per-module
  `context-constitution-findings.md` logs are refreshed by `/context-constitution`, not edited here.
  `scripts/config-wiring-stored.json` and the `live_enrich_ttl_seconds` rows belong to feature 330 (D-8).
- Merge order: field 7 on `ComputeIndicatorRequest` and `BatchGetBarsRequest` is free on
  `origin/main-dev` (checked 2026-11-20). Step 1 re-checks it against
  `origin/feature/fix-sandbox-result-contract` (310, `indicators.proto`) and
  `origin/feature/fix-read-path-owner-trust` (312, `trading.proto`).

---

### Step 1 — proto: non-breaking deprecation PR-unit

**Status**: `pending`
**Service**: `packages/proto`
**Files**:
- `packages/proto/analysis/v1/analysis.proto` — modify
- `packages/proto/marketdata/v1/marketdata.proto` — modify
- `packages/proto/indicators/v1/indicators.proto` — modify
- `packages/proto/trading/v1/trading.proto` — modify
- `packages/proto/common/v1/common.proto` — modify

**Reviewers**: Proto Reviewer — field number uniqueness per message, no breaking change without a deprecation comment, `buf lint` / `buf breaking` pass; `xstockstrat-analysis`, `xstockstrat-marketdata`, `xstockstrat-indicators`, `xstockstrat-trading`, `xstockstrat-portfolio`, `xstockstrat-agent`, `xstockstrat-ui` owners — consumers of the touched messages

**Codebase Evidence**:
- `grep -n "sparkline" packages/proto/analysis/v1/analysis.proto` → `:626` `repeated SparklinePoint sparkline = 17;`; the block comment at `:616-621` says "13/14/17 are READ-TIME live-market fields".
- `packages/proto/marketdata/v1/marketdata.proto:331-338` `message BatchGetBarsRequest` — fields 1–6 used (`allow_partial = 6`), `:333` `string timeframe = 2;`. Field **7** is free (also free on `origin/main-dev`).
- Wording precedent `marketdata.proto:89-92`: `// DEPRECATED: use timeframe_enum. Removed in a future release once all callers migrate.` / `string timeframe = 10 [deprecated = true];` / `xstockstrat.common.v1.Timeframe timeframe_enum = 12;`.
- `packages/proto/indicators/v1/indicators.proto:54-61` `message ComputeIndicatorRequest` — fields 1–6 used, `:60` `string timeframe = 6;`. Field **7** is free (also free on `origin/main-dev`).
- `packages/proto/trading/v1/trading.proto:334-340` — `:336` `string user_id = 2;              // caller identity (ownership + reconciliation payload)`. Wording precedent `:144` `string user_id = 2 [deprecated = true]; // DEPRECATED: caller identity resolved from the x-user-id header; body value ignored.`
- `packages/proto/common/v1/common.proto:21` `message Error`, `:28` `message Decimal`; `enum Timeframe` at `:85-92`. No message-level `option deprecated = true;` exists anywhere in `packages/proto` today (`grep -rn "deprecated = true;" --include=*.proto packages/proto` → no match), so this is the first use.
- `packages/proto/buf.yaml` sets no `breaking:` block (buf defaults apply) and lints with `STANDARD`.

**Lands with**: `Step 2, Step 3`

**TDD**: `N/A (proto)` — the unit's red→green is Step 3's test.

**Covers**: —

**Instructions**:
1. Collision re-check first (design Open Risk). Run
   `git fetch origin && git show origin/feature/fix-sandbox-result-contract:packages/proto/indicators/v1/indicators.proto | grep -n "message ComputeIndicatorRequest" -A10`
   and `git show origin/main-dev:packages/proto/marketdata/v1/marketdata.proto | grep -n "message BatchGetBarsRequest" -A9`.
   If either shows a field numbered 7 in the message, stop and escalate (P-03); do not pick another number.
2. `analysis.proto`: change `:626` to `repeated SparklinePoint sparkline = 17 [deprecated = true];` with
   a one-line comment `// DEPRECATED: never populated — the sparkline is fetched client-side.` In the
   block comment above, change "13/14/17 are READ-TIME" to "13/14 are READ-TIME". Keep the field
   number; add no `reserved`.
3. `marketdata.proto`, `BatchGetBarsRequest`: change `:333` to
   `string timeframe = 2 [deprecated = true];` under the comment
   `// DEPRECATED: use timeframe_enum. Removed in a future release once all callers migrate.`, and add
   `xstockstrat.common.v1.Timeframe timeframe_enum = 7;` as the last field.
4. `indicators.proto`, `ComputeIndicatorRequest`: change `:60` to
   `string timeframe = 6 [deprecated = true]; // DEPRECATED: ignored by the server.` and add
   `xstockstrat.common.v1.Timeframe timeframe_enum = 7; // accepted but ignored by the server; carried for contract parity with BatchGetBarsRequest`.
   Do **not** copy the marketdata "once all callers migrate" wording here (D-13, R-9).
5. `trading.proto`: change `:336` to
   `string user_id = 2 [deprecated = true]; // DEPRECATED: caller identity resolved from the x-user-id header; body value ignored.`
6. `common.proto`: inside `message Error` and `message Decimal`, add `option deprecated = true;` as the
   first statement, and extend each leading comment with "DEPRECATED: unused — no message or service
   references it." Fallback, only if `buf lint` or `buf breaking` rejects the message-level option:
   remove the `option` lines, keep the comments, drop the two `Decimal`/`Error` assertions from Step 3's
   test, and record this in the `## Deviation Log`.

**Verification**:
```bash
cd packages/proto && buf lint \
  && buf breaking --against "$(git rev-parse --path-format=absolute --git-common-dir)#branch=feature/fix-retired-surface-proto-cleanup,subdir=packages/proto" \
  && buf breaking --against "$(git rev-parse --path-format=absolute --git-common-dir)#branch=main-dev,subdir=packages/proto"
grep -n "timeframe_enum = 7" indicators/v1/indicators.proto marketdata/v1/marketdata.proto   # two hits
grep -n "reserved" analysis/v1/analysis.proto indicators/v1/indicators.proto marketdata/v1/marketdata.proto trading/v1/trading.proto common/v1/common.proto   # no new hit
```
`--git-common-dir` resolves to `<repo-root>/.git` (and still works in a git worktree, where `.git` is a
file). `subdir=` is mandatory (PLAT-10). If the local branch does not exist, use
`#ref=refs/remotes/origin/feature/fix-retired-surface-proto-cleanup,subdir=packages/proto`
(insights.md:1876). Both `buf breaking` runs must report no breaking change.

---

### Step 2 — proto-gen: regenerate Go, Python and TypeScript stubs

**Status**: `pending`
**Service**: `packages/proto`
**Files** (generated by `./scripts/buf-gen.sh`; stage exactly what the script changes — the list is the expected set):
- `packages/proto/gen/go/analysis/v1/analysis.pb.go` — modify (generated)
- `packages/proto/gen/go/marketdata/v1/marketdata.pb.go` — modify (generated)
- `packages/proto/gen/go/indicators/v1/indicators.pb.go` — modify (generated)
- `packages/proto/gen/go/trading/v1/trading.pb.go` — modify (generated)
- `packages/proto/gen/go/common/v1/common.pb.go` — modify (generated)
- `packages/proto/gen/python/analysis/v1/analysis_pb2.py` — modify (generated)
- `packages/proto/gen/python/marketdata/v1/marketdata_pb2.py` — modify (generated)
- `packages/proto/gen/python/indicators/v1/indicators_pb2.py` — modify (generated)
- `packages/proto/gen/python/trading/v1/trading_pb2.py` — modify (generated)
- `packages/proto/gen/python/common/v1/common_pb2.py` — modify (generated)
- `packages/proto/gen/ts/analysis/v1/analysis.ts` — modify (generated)
- `packages/proto/gen/ts/analysis/v1/analysis_pb.ts` — modify (generated)
- `packages/proto/gen/ts/marketdata/v1/marketdata.ts` — modify (generated)
- `packages/proto/gen/ts/marketdata/v1/marketdata_pb.ts` — modify (generated)
- `packages/proto/gen/ts/indicators/v1/indicators.ts` — modify (generated)
- `packages/proto/gen/ts/indicators/v1/indicators_pb.ts` — modify (generated)
- `packages/proto/gen/ts/trading/v1/trading.ts` — modify (generated)
- `packages/proto/gen/ts/trading/v1/trading_pb.ts` — modify (generated)
- `packages/proto/gen/ts/common/v1/common.ts` — modify (generated)
- `packages/proto/gen/ts/common/v1/common_pb.ts` — modify (generated)
- `packages/proto/gen/ts/dist/analysis/v1/analysis.js` — modify (generated)
- `packages/proto/gen/ts/dist/analysis/v1/analysis.d.ts` — modify (generated)
- `packages/proto/gen/ts/dist/analysis/v1/analysis_pb.js` — modify (generated)
- `packages/proto/gen/ts/dist/analysis/v1/analysis_pb.d.ts` — modify (generated)
- `packages/proto/gen/ts/dist/marketdata/v1/marketdata.js` — modify (generated)
- `packages/proto/gen/ts/dist/marketdata/v1/marketdata.d.ts` — modify (generated)
- `packages/proto/gen/ts/dist/marketdata/v1/marketdata_pb.js` — modify (generated)
- `packages/proto/gen/ts/dist/marketdata/v1/marketdata_pb.d.ts` — modify (generated)
- `packages/proto/gen/ts/dist/indicators/v1/indicators.js` — modify (generated)
- `packages/proto/gen/ts/dist/indicators/v1/indicators.d.ts` — modify (generated)
- `packages/proto/gen/ts/dist/indicators/v1/indicators_pb.js` — modify (generated)
- `packages/proto/gen/ts/dist/indicators/v1/indicators_pb.d.ts` — modify (generated)
- `packages/proto/gen/ts/dist/trading/v1/trading.js` — modify (generated)
- `packages/proto/gen/ts/dist/trading/v1/trading.d.ts` — modify (generated)
- `packages/proto/gen/ts/dist/trading/v1/trading_pb.js` — modify (generated)
- `packages/proto/gen/ts/dist/trading/v1/trading_pb.d.ts` — modify (generated)
- `packages/proto/gen/ts/dist/common/v1/common.js` — modify (generated)
- `packages/proto/gen/ts/dist/common/v1/common.d.ts` — modify (generated)
- `packages/proto/gen/ts/dist/common/v1/common_pb.js` — modify (generated)
- `packages/proto/gen/ts/dist/common/v1/common_pb.d.ts` — modify (generated)

**Reviewers**: Proto Reviewer — field number uniqueness per message, no breaking change without a deprecation comment, `buf lint` / `buf breaking` pass; `xstockstrat-analysis`, `xstockstrat-marketdata`, `xstockstrat-indicators`, `xstockstrat-trading`, `xstockstrat-portfolio`, `xstockstrat-agent`, `xstockstrat-ui` owners — consumers of the touched messages (inherited from Step 1)

**Codebase Evidence**:
- `ls scripts/buf-gen.sh` → present; CI job `proto-freshness` (`.github/workflows/ci.yml:213`) fails when `packages/proto/gen/` differs from a fresh run.
- `packages/proto/buf.gen.yaml` — Go (`protoc-gen-go`, `-go-grpc`, `-connect-go`), TypeScript (`ts_proto` with `useOptionals=messages`, `stringEnums=true`; `protoc-gen-es`; `connect-es`); Python is generated by `buf-gen.sh` via `grpc_tools.protoc`.
- Generated files are never read or hand-edited (root `CLAUDE.md` § Key File Paths).

**Lands with**: `Step 1, Step 3`

**TDD**: `N/A (proto-gen)`

**Covers**: —

**Instructions**:
Run `./scripts/buf-gen.sh` from the repo root and stage only the regenerated files under
`packages/proto/gen/`. Do not hand-edit any generated file. The deprecations make staticcheck flag
existing Go readers (see `## Step Dependencies`, lint-red window); that is expected and is cleared by
Steps 5, 7 and 13 — do not add `//nolint` directives in this step.

**Verification**:
```bash
./scripts/buf-gen.sh && git status --short packages/proto/gen | head     # only gen/ files changed by the script
./scripts/buf-gen.sh && git diff --exit-code --stat packages/proto/gen   # second run is a no-op (proto-freshness)
for s in trading portfolio marketdata; do (cd services/xstockstrat-$s && GOWORK=off go build ./... && GOWORK=off go vet ./...) || exit 1; done
```

---

### Step 3 — test: descriptor contract test for the deprecations and enum fields

**Status**: `pending`
**Service**: `xstockstrat-indicators`
**Files**:
- `services/xstockstrat-indicators/tests/test_proto_deprecations.py` — create

**Reviewers**: `xstockstrat-indicators` owner — formula sandboxing and numeric precision unaffected; contract test only

**Codebase Evidence**:
- **Not found** — no descriptor-deprecation test exists in the repo (`grep -rnE "GetOptions\(\)\.deprecated|GetDeprecated\(\)" services scripts packages/proto` outside `gen/` → no match), and `packages/proto` has no test harness. This file is created from scratch.
- Home: `xstockstrat-indicators` owns `ComputeIndicatorRequest`, whose new field 7 has no reader or producer (design Open Risk, C-18), so this test is the only thing that anchors it.
- `services/xstockstrat-indicators/tests/conftest.py:142-154` puts `packages/proto/gen/python` on `sys.path` as the `gen` package, so every `gen.<pkg>.v1` module is importable (existing imports: `from gen.indicators.v1 import indicators_pb2`, `from gen.marketdata.v1 import marketdata_pb2`, `from gen.common.v1 import common_pb2`).
- Descriptor-read precedent: `services/xstockstrat-agent/tests/test_opportunity_projection.py:54-55` (`analysis_pb2.Opportunity.DESCRIPTOR.fields_by_name`).

**Lands with**: `Step 1, Step 2`

**TDD**: `red-green required` — write this test first; on the pre-Step-1 tree it fails on its assertions (fields not deprecated, `timeframe_enum` absent).

**Covers**: `AC-3, AC-2`

**Instructions**:
Create `tests/test_proto_deprecations.py` with plain `def test_…` functions that read descriptors only
(no domain data, so C-13 has nothing to centralise — record that verdict):
1. `ComputeIndicatorRequest`: `fields_by_name["timeframe"]` has number 6 and
   `GetOptions().deprecated` is true; `fields_by_name["timeframe_enum"]` has number 7 and
   `enum_type.full_name == "xstockstrat.common.v1.Timeframe"`.
2. `BatchGetBarsRequest` (`gen.marketdata.v1.marketdata_pb2`): the same two assertions with string
   field number 2 and enum field number 7.
3. `SnapshotOfflinePositionsRequest` (`gen.trading.v1.trading_pb2`): `user_id` has number 2 and is deprecated.
4. `Opportunity` (`gen.analysis.v1.analysis_pb2`): `sparkline` has number 17 and is deprecated.
5. `common_pb2.Decimal.DESCRIPTOR.GetOptions().deprecated` and the same for `Error` are true (dropped
   under the Step 1 fallback).
Keep a ≤2-line module docstring naming `@AC-3`/`@AC-2` of feature 322.

**Verification**:
```bash
cd services/xstockstrat-indicators && ruff check . && ruff format --check . \
  && pytest tests/test_proto_deprecations.py -q \
  && pytest --cov=app --cov-fail-under=50
grep -n "conftest\|def .*fixture" tests/test_proto_deprecations.py   # none expected: no domain literal (C-13 verdict: inline-compliant)
```
Unit Verification = Steps 1 + 2 + 3 commands together.

---

### Step 4 — service: marketdata `BatchGetBars` resolves `timeframe_enum` first

**Status**: `pending`
**Service**: `xstockstrat-marketdata`
**Files**:
- `services/xstockstrat-marketdata/internal/service/marketdata_service.go` — modify

**Reviewers**: `xstockstrat-marketdata` owner — OHLCV ingestion integrity, Alpaca feed idempotency

**Codebase Evidence**:
- `grep -n "func (s \*MarketDataService) BatchGetBars" internal/service/marketdata_service.go` → `:782`. `:787-788`: `canonicalTf := req.Timeframe` / `if resolved, rErr := timeframe.Resolve(commonv1.Timeframe_TIMEFRAME_UNSPECIFIED, req.Timeframe); rErr == nil {`. `:791-794` rejects anything but `"1d"` with `connect.CodeInvalidArgument`.
- Reuse precedent `GetBars` `:267-271`: `legacyTf := req.Timeframe //nolint:staticcheck // SA1019: string timeframe read during one-release deprecation window (053)` then `timeframe.Resolve(req.GetTimeframeEnum(), legacyTf)`. Same shape at `:1499-1501`.
- `internal/timeframe/timeframe.go:64` `func Resolve(enum commonv1.Timeframe, legacyStr string) (string, error)` — prefers the enum, falls back to the string.
- Handlers pass the request through unchanged: `internal/handler/marketdata_handler.go:270-274` and the gRPC adapter `:489-490`.

**TDD**: `red-green required`

**Covers**: —

**Instructions**:
In `BatchGetBars`, replace `:787-788` with the `GetBars` shape: hoist
`legacyTf := req.Timeframe //nolint:staticcheck // SA1019: …` (one directive), set
`canonicalTf := legacyTf`, and call `timeframe.Resolve(req.GetTimeframeEnum(), legacyTf)`. Leave the
`"1d"`-only rejection and everything after it unchanged. No new helper — reuse `timeframe.Resolve`.
No outbound gRPC call is added (header propagation unaffected). Broker, order type and fill handling
are unaffected by this step.

**Verification**:
```bash
cd services/xstockstrat-marketdata && GOWORK=off go build ./... && GOWORK=off go vet ./... \
  && GOWORK=off go test ./internal/service/ -run 'TestBatchGetBars' -count=1
grep -n "req.GetTimeframeEnum()" internal/service/marketdata_service.go   # three hits (GetBars, BatchGetBars, the :1499 site)
```
Lint for this file is asserted in Step 5 (the paired test step).

---

### Step 5 — test: `BatchGetBars` enum-first tests and SA1019 directives

**Status**: `pending`
**Service**: `xstockstrat-marketdata`
**Files**:
- `services/xstockstrat-marketdata/internal/service/marketdata_service_test.go` — modify

**Reviewers**: `xstockstrat-marketdata` owner — OHLCV ingestion integrity

**Codebase Evidence**:
- Existing `BatchGetBars` tests in the file: `TestBatchGetBars_MultipleSymbols` (`:1590`), `TestBatchGetBars_RejectsNonDailyTimeframe` (`:1670`, sends `Timeframe: "1h"`), `TestBatchGetBars_ColdPathOmitsDeprecatedTimeframe` (`:3322`), and the helper `batchReq` (`:4251-4257`, `Timeframe: "1d"`).
- Request literals setting the string: `:1606, :1645, :1674, :1699, :1730, :3330, :4252`.
- Directive precedent in the same file `:3324`: `//nolint:staticcheck // SA1019: source bars carry the deprecated string (feature 196 EXCLUDE edge)`.
- `commonv1` is already imported (`:29`).

**TDD**: `red-green required` — the two new enum cases fail on the pre-Step-4 tree (an enum-only request resolves the empty string and is rejected; `TIMEFRAME_1DAY` + `"1h"` is rejected instead of served).

**Covers**: `AC-3`

**Instructions**:
1. Add `TestBatchGetBars_PrefersTimeframeEnum`, modelled on `TestBatchGetBars_MultipleSymbols`, with two
   cases: (a) `TimeframeEnum: commonv1.Timeframe_TIMEFRAME_1DAY` and no string → no error; (b)
   `TimeframeEnum: commonv1.Timeframe_TIMEFRAME_1DAY` with `Timeframe: "1h"` → no error (enum wins).
2. Keep `TestBatchGetBars_RejectsNonDailyTimeframe` and add a case there: no enum and no string →
   `connect.CodeInvalidArgument` (string-only and empty requests behave as before).
3. Add `//nolint:staticcheck // SA1019: …` only on the lines `golangci-lint` flags (D-6) — expected at
   the seven literals listed above and any new literal that sets the string.
4. C-13: the request literals are scenario one-offs inside this one test file (single consumer) —
   inline is compliant; no `internal/testdata/` entry is created.

**Verification**:
```bash
cd services/xstockstrat-marketdata && GOWORK=off golangci-lint run --modules-download-mode=mod \
  && GOWORK=off COVERPKGS=$(go list ./... | grep -Ev '/(cmd|handler|repository|telemetry|service)(/|$)' | tr '\n' ',' | sed 's/,$//') \
  && go test ./... -race -count=1 -coverprofile=coverage.out -covermode=atomic -coverpkg="${COVERPKGS}" \
  && go tool cover -func=coverage.out | grep "^total:"   # confirm ≥ 40%
grep -rn "func batchReq" --include="*_test.go" .   # one declaration site (C-13)
```
New logic is in the excluded `service` package — no coverage threshold applies to it; the ≥ 40% total
must still hold.

---

### Step 6 — service: portfolio offline valuation sends both timeframe fields

**Status**: `pending`
**Service**: `xstockstrat-portfolio`
**Files**:
- `services/xstockstrat-portfolio/internal/service/offline_valuation.go` — modify

**Reviewers**: `xstockstrat-portfolio` owner — P&L calculation accuracy, position snapshot consistency

**Codebase Evidence**:
- `grep -n "BatchGetBarsRequest" internal/service/offline_valuation.go` → `:170`, inside `func (s *PortfolioService) fetchMarks` (`:155`): `Symbols: barSyms, Timeframe: "1d", Start: …, End: …, MaxBarsPerSymbol: int32(days + 1), AllowPartial: true`.
- The file imports `marketdatav1` (`:14`) but not `commonv1`; import path precedent `internal/service/offline_valuation_test.go:14`: `commonv1 "github.com/xstockstrat/contracts/gen/go/common/v1"`.
- The call reuses the existing `s.marketdata` client (already-propagating); no new outbound call.

**TDD**: `red-green required`

**Covers**: —

**Instructions**:
In `fetchMarks`, keep `Timeframe: "1d"` and add `TimeframeEnum: commonv1.Timeframe_TIMEFRAME_1DAY` to
the same literal (D-1: both fields during the deprecation window; never enum-only, R-1). Add the
`commonv1` import. Put `//nolint:staticcheck // SA1019: string timeframe sent during the deprecation window (322)`
on the `Timeframe:` line. P&L maths, broker handling, order types and fill handling are unaffected.

**Verification**:
```bash
cd services/xstockstrat-portfolio && GOWORK=off go build ./... && GOWORK=off go vet ./... \
  && GOWORK=off go test ./internal/service/ -run 'TestListPositions_BarsRequestShape' -count=1
grep -n "TimeframeEnum\|Timeframe:" internal/service/offline_valuation.go   # both present in fetchMarks
```
Lint is asserted in Step 7 (the paired test step).

---

### Step 7 — test: portfolio bars-request shape asserts both fields

**Status**: `pending`
**Service**: `xstockstrat-portfolio`
**Files**:
- `services/xstockstrat-portfolio/internal/service/offline_valuation_test.go` — modify

**Reviewers**: `xstockstrat-portfolio` owner — P&L calculation accuracy

**Codebase Evidence**:
- `TestListPositions_BarsRequestShape` (`:337`); `:358`: `if !req.AllowPartial || req.Timeframe != "1d" || req.MaxBarsPerSymbol != tc.wantMax || !req.Start.AsTime().Equal(wantStart) {`.
- The stub records requests: `internal/service/portfolio_service_test.go:32` (`barsReqs []*marketdatav1.BatchGetBarsRequest`) and `:65`.
- `commonv1` is imported at `:14`.

**TDD**: `red-green required` — on the pre-Step-6 tree the new `TimeframeEnum` condition fails.

**Covers**: `AC-3`

**Instructions**:
Extend the `:358` condition with `|| req.TimeframeEnum != commonv1.Timeframe_TIMEFRAME_1DAY`, and
update the `t.Errorf` text to say "1d (string + enum)". Add a `//nolint:staticcheck // SA1019: …`
directive on the `req.Timeframe` read only if `golangci-lint` flags it (D-6). C-13: no new domain
literal — the test reuses the existing stub and `testdata.Session`.

**Verification**:
```bash
cd services/xstockstrat-portfolio && GOWORK=off golangci-lint run --modules-download-mode=mod \
  && GOWORK=off COVERPKGS=$(go list ./... | grep -Ev '/(cmd|handler|repository|telemetry|service)(/|$)' | tr '\n' ',' | sed 's/,$//') \
  && go test ./... -race -count=1 -coverprofile=coverage.out -covermode=atomic -coverpkg="${COVERPKGS}" \
  && go tool cover -func=coverage.out | grep "^total:"   # confirm ≥ 40%
```
New logic is in the excluded `service` package — no coverage threshold applies to it.

---

### Step 8 — service: analysis `_compute_opportunities` sends both timeframe fields

**Status**: `pending`
**Service**: `xstockstrat-analysis`
**Files**:
- `services/xstockstrat-analysis/app/handlers/servicer.py` — modify

**Reviewers**: `xstockstrat-analysis` owner — strategy scoring determinism, no look-ahead bias

**Codebase Evidence**:
- `grep -n "BatchGetBarsRequest(" app/handlers/servicer.py` → `:5675`, inside `async def _compute_opportunities(self, user_id: str, propagation_meta)` (`:5331`): `symbols=unique_symbols, timeframe="1d", start=range_msg.start, end=range_msg.end, max_bars_per_symbol=_READINESS_LOOKBACK_DAYS`, sent with `metadata=propagation_meta` (`:5682`).
- `common_pb2` is imported (`:30`); enum spelling precedent `:1024` `common_pb2.Timeframe.TIMEFRAME_1DAY`.
- This is the only analysis `BatchGetBarsRequest` construction (`grep -rn "BatchGetBarsRequest" services/xstockstrat-analysis/app` → this site).

**TDD**: `red-green required`

**Covers**: —

**Instructions**:
Add `timeframe_enum=common_pb2.Timeframe.TIMEFRAME_1DAY,` directly after `timeframe="1d",` in the
`:5675` request. Keep the string (D-1, R-1). The call keeps `metadata=propagation_meta`, so
`x-user-id` / `x-access-scope` / `x-trace-id` forwarding is unchanged. Do not touch the six
`ComputeIndicatorRequest(timeframe=…)` writes (D-2, R-8).

**Verification**:
```bash
cd services/xstockstrat-analysis && ruff check . && ruff format --check . \
  && pytest tests/test_analysis_servicer.py -q -k "test_compute_fanout_uses_batch_and_background_sem_not_interactive"
grep -n "timeframe_enum=common_pb2.Timeframe.TIMEFRAME_1DAY" app/handlers/servicer.py   # includes the BatchGetBarsRequest site
```

---

### Step 9 — test: analysis `BatchGetBars` request carries string and enum

**Status**: `pending`
**Service**: `xstockstrat-analysis`
**Files**:
- `services/xstockstrat-analysis/tests/test_analysis_servicer.py` — modify

**Reviewers**: `xstockstrat-analysis` owner — strategy scoring determinism

**Codebase Evidence**:
- `test_compute_fanout_uses_batch_and_background_sem_not_interactive` (`:5681`) already captures the request: `req = svc._marketdata.BatchGetBars.await_args.args[0]` (`:5697`) and asserts `set(req.symbols) == {"AAPL", "MSFT"}` (`:5698`).
- Assertion precedent in the same file `:256-257`: `assert called_req.timeframe == "1d"` / `assert called_req.timeframe_enum == common_pb2.Timeframe.TIMEFRAME_1DAY`.

**TDD**: `red-green required` — on the pre-Step-8 tree `req.timeframe_enum` is `TIMEFRAME_UNSPECIFIED`, so the new assertion fails.

**Covers**: `AC-3`

**Instructions**:
After `:5698` add `assert req.timeframe == "1d"` and
`assert req.timeframe_enum == common_pb2.Timeframe.TIMEFRAME_1DAY`. C-13: no new domain literal — the
test reuses the existing `_materialized_svc`, `_wl` and `_FIRING_BARS` helpers.

**Verification**:
```bash
cd services/xstockstrat-analysis && ruff check . && ruff format --check . \
  && pytest --cov=app --cov-fail-under=40
```

---

### Step 10 — service: UI `useOhlcBars` sends both timeframe fields

**Status**: `pending`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/src/hooks/useOhlcBars.ts` — modify

**Reviewers**: `xstockstrat-ui` owner — Connect-RPC call safety, analytics display accuracy

**Codebase Evidence**:
- `services/xstockstrat-ui/src/hooks/useOhlcBars.ts:23-30`: `insightsMarketDataClient.batchGetBars({ symbols: sorted, timeframe: '1d', start: …, end: …, maxBarsPerSymbol: OHLC_MAX_BARS, allowPartial: true })`.
- The insights BFF forwards the request object unchanged: `src/lib/insightsBff.ts:110` `batchGetBars: forward((req, opts) => marketDataClient.batchGetBars(req, opts))`.
- Enum import precedent: `src/app/insights/backfills/page.tsx:38` `import { Timeframe } from '@xstockstrat/proto/common/v1/common_pb';`.
- Generated camelCase name precedent for the sibling field: `e2e/mock-backend.ts:153-154` (`timeframe: '1d'`, `timeframeEnum: Timeframe.TIMEFRAME_1DAY` on `Bar`). The request field name `timeframeEnum` is confirmed by `tsc` in this step's Verification (design Open Risk).
- No TS deprecation lint rule exists in `xstockstrat-ui` (design round 3), so keeping the deprecated string causes no lint fallout.

**TDD**: `red-green required`

**Covers**: —

**Instructions**:
Import `Timeframe` from `@xstockstrat/proto/common/v1/common_pb` and add
`timeframeEnum: Timeframe.TIMEFRAME_1DAY,` directly after `timeframe: '1d',` in the `batchGetBars`
call. Keep the string (D-1, R-1). No rendering change, no new component, no colour or token change
(C-17 not engaged). `e2e/mock-backend.ts` is **not** edited: its `batchGetBars` handler (`:715`)
ignores the timeframe, so the existing OHLC e2e coverage keeps passing.

**Verification**:
```bash
cd services/xstockstrat-ui && pnpm run lint && pnpm exec tsc --noEmit
grep -n "timeframeEnum: Timeframe.TIMEFRAME_1DAY" src/hooks/useOhlcBars.ts
```
Existing Playwright coverage of the OHLC strip (`e2e/insights/opportunities.spec.ts:365-370`,
`:580-581`) applies unchanged; the new unit test is Step 11.

---

### Step 11 — test: vitest payload test for `useOhlcBars`

**Status**: `pending`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/src/hooks/useOhlcBars.test.ts` — create

**Reviewers**: `xstockstrat-ui` owner — Connect-RPC call safety

**Codebase Evidence**:
- **Not found** — no `src/hooks/useOhlcBars.test.ts` exists (`ls services/xstockstrat-ui/src/hooks/*.test.ts` → `useFormulas.test.ts` only). Created from scratch on the pattern below.
- Pattern: `src/hooks/useFormulas.test.ts:1-27` — node-env vitest, `vi.hoisted` state, `vi.mock('@tanstack/react-query', …)` that captures the function handed to the hook, and `vi.mock` of the browser client; then the test invokes the captured function and asserts the RPC payload.
- `vitest.config.ts` includes `src/**/*.test.ts` (node environment).
- Client module to mock: `@/lib/browserClients/insightsMarketDataClient` (`useOhlcBars.ts:2`).

**TDD**: `red-green required` — on the pre-Step-10 tree the payload has no `timeframeEnum`, so the assertion fails.

**Covers**: `AC-3`

**Instructions**:
Create the test on the `useFormulas.test.ts` pattern: mock `useQuery` to capture `opts.queryFn`, mock
`insightsMarketDataClient.batchGetBars` to resolve `{ results: [] }`, call `useOhlcBars(['MSFT', 'AAPL'])`,
await the captured `queryFn`, and assert the single `batchGetBars` call received
`timeframe: '1d'` and `timeframeEnum: Timeframe.TIMEFRAME_1DAY` (imported from
`@xstockstrat/proto/common/v1/common_pb`) and `symbols: ['AAPL', 'MSFT']`. C-12: the test declares no
domain object — the response is the empty-results one-off and the two ticker strings are request
inputs — so no inventory fixture is added and `e2e/fixtures/INVENTORY.md` is unchanged (exempt:
scenario one-off).

**Verification**:
```bash
cd services/xstockstrat-ui && pnpm run lint && pnpm exec vitest run src/hooks/useOhlcBars.test.ts && pnpm run test:unit
grep -n "from '../fixtures'\|from './fixtures'\|helpers/auth" src/hooks/useOhlcBars.test.ts   # none expected (C-12 exempt one-off)
```
No coverage threshold applies (`vitest.config.ts` scopes coverage to `src/lib/**`).

---

### Step 12 — service: trading `SnapshotOfflinePositions` hoists one `userID` carrier

**Status**: `pending`
**Service**: `xstockstrat-trading`
**Files**:
- `services/xstockstrat-trading/internal/service/trading.go` — modify
- `services/xstockstrat-trading/internal/handler/trading.go` — modify

**Reviewers**: `xstockstrat-trading` owner — order execution correctness, paper-only dev invariant; ownership gate on offline snapshots

**Codebase Evidence**:
- `grep -n "func (s \*TradingService) SnapshotOfflinePositions" internal/service/trading.go` → `:1174`. `req.UserId` reads inside it: `:1178` (empty check), `:1196` (`if rec.UserID != req.UserId {`), `:1274` and `:1276` (ledger event `account.positions.baseline_set`), `:1284` (`recomputeAndEmitOfflinePositions`).
- Ownership comment `:1193-1195`: "Ownership gate: req.UserId is the handler-injected caller (from the trusted x-user-id header, which overwrites any client-supplied value), so only the account's owner may snapshot it." / "Checked before the offline-type gate …".
- Handler write `internal/handler/trading.go:89-90`: `// Caller identity from the trusted x-user-id header the edge injects.` / `req.Msg.UserId = extractUserID(ctx)`.
- Do not touch: `ListOrders`/`GetOrder` reads at `:1646, :1652, :1730` (different, non-deprecated request fields) and the handler's `req.Msg.UserId` uses at `:118-119` (`SubscribeOrderUpdates`).
- Directive precedent: `services/xstockstrat-marketdata/internal/service/marketdata_service.go:267`.

**TDD**: `red-green required` — expected record: "red N/A — no behavior change; characterization tests kept green" (tdd-gate.md escape); the paired Step 13 adds no new behavior.

**Covers**: —

**Instructions**:
1. `internal/service/trading.go`, `SnapshotOfflinePositions`: as the first statement add exactly one
   `userID := req.UserId //nolint:staticcheck // SA1019: handler-injected from x-user-id; body value overwritten`.
   Replace the five reads at `:1178, :1196, :1274, :1276, :1284` with `userID`. The method signature does
   not change (D-9).
2. Rewrite the `:1193-1194` comment to name the local and keep the invariant, in ≤2 lines, for example:
   "Ownership gate: userID is the handler-injected caller (trusted x-user-id header, which overwrites any
   client-supplied body value), so only the account's owner may snapshot it." Keep the following
   "Checked before the offline-type gate …" line.
3. `internal/handler/trading.go:90`: append `//nolint:staticcheck // SA1019: carrier for the header-derived caller (322)` to the write.
4. Trading-domain: this step touches no order placement, `BrokerType` dispatch or `TRADING_MODE` gate;
   order type handling and fill handling (`PARTIALLY_FILLED` / `FILLED`) are unaffected; both brokers
   (ALPACA, IBKR) are unaffected — the RPC applies to OFFLINE accounts only. Header propagation is
   unchanged (PLAT-4): identity still comes from `x-user-id`.

**Verification**:
```bash
cd services/xstockstrat-trading && GOWORK=off go build ./... && GOWORK=off go vet ./... \
  && GOWORK=off go test ./internal/service/ -run 'Snapshot|Ownership' -count=1
sed -n '/func (s \*TradingService) SnapshotOfflinePositions/,/^}/p' internal/service/trading.go | grep -c "req.UserId"   # 1 (the hoisted line)
```
Lint is asserted in Step 13 (the paired test step).

---

### Step 13 — test: trading snapshot characterization and SA1019 directives

**Status**: `pending`
**Service**: `xstockstrat-trading`
**Files**:
- `services/xstockstrat-trading/internal/service/trading_offline_test.go` — modify
- `services/xstockstrat-trading/internal/service/trading_ownership_test.go` — modify (only if `golangci-lint` flags it)

**Reviewers**: `xstockstrat-trading` owner — ownership gate on offline snapshots

**Codebase Evidence**:
- Builder `snapshotReq` at `internal/service/trading_offline_test.go:676-679` sets `UserId: userID`; table cases at `:1395-1405` set `UserId:` directly on `SnapshotOfflinePositionsRequest` (`"empty user_id"` at `:1398-1399`).
- Cross-user guard: `internal/service/trading_ownership_test.go:104-109` calls `s.SnapshotOfflinePositions(ctxAsUser("attacker"), snapshotReq("acct-1", "attacker", …))` and expects `codes.PermissionDenied`.
- Other `UserId:` literals in these files (`:554`, `:1721`, ownership `:66, :83, :122`) belong to `Order`/other messages whose field is not newly deprecated — do not annotate them.

**TDD**: `red-green required` — record "red N/A — no behavior change; characterization tests kept green" (tdd-gate.md escape). The partial-fill / full-fill cases are not applicable: this RPC records baselines, not fills.

**Covers**: `AC-3`

**Instructions**:
Add `//nolint:staticcheck // SA1019: body user_id is the in-process carrier until field removal (322)`
only where `golangci-lint` flags a line (D-6) — expected at the `snapshotReq` helper (`:679`) and the
four table literals (`:1396-1405`); prefer the helper-level directive. Change no assertion: the
empty-`user_id` case and the cross-user `PermissionDenied` case are the characterization tests that
prove the hoisted local kept the ownership gate. C-13: `snapshotReq` has one declaration site and both
test files already share it within the package — no new literal is introduced.

**Verification**:
```bash
cd services/xstockstrat-trading && GOWORK=off golangci-lint run --modules-download-mode=mod \
  && GOWORK=off COVERPKGS=$(go list ./... | grep -Ev '/(cmd|handler|repository|telemetry|service)(/|$)' | tr '\n' ',' | sed 's/,$//') \
  && go test ./... -race -count=1 -coverprofile=coverage.out -covermode=atomic -coverpkg="${COVERPKGS}" \
  && go tool cover -func=coverage.out | grep "^total:"   # confirm ≥ 40%
grep -rn "func snapshotReq" --include="*_test.go" .   # one declaration site (C-13)
```
New logic is in the excluded `service`/`handler` packages — no coverage threshold applies to it.

---

### Step 14 — service: agent `list_opportunities` projection drops `sparkline`

**Status**: `pending`
**Service**: `xstockstrat-agent`
**Files**:
- `services/xstockstrat-agent/app/client.py` — modify

**Reviewers**: `xstockstrat-agent` owner — MCP tool contract stability (return shape) and `docs/runbooks/mcp-tools.md` parity

**Codebase Evidence**:
- `grep -n "sparkline" services/xstockstrat-agent/app/client.py` → `:869` (docstring of `_opportunity_to_dict`, defined at `:864`: "a sparkline gap is JSON ``null`` (never ``NaN``);") and `:899-900` (`if o.sparkline:` / `d["sparkline"] = [p.close if p.HasField("close") else None for p in o.sparkline]`).
- `grep -rn "sparkline" docs/runbooks/mcp-tools.md services/xstockstrat-agent/CLAUDE.md services/xstockstrat-agent/app/tools.py plugins` → no match, so no doc or tool-description names the key.
- The analysis server never populates the field (`grep -rn sparkline services/xstockstrat-analysis/app` → no match).

**Lands with**: `Step 15`

**TDD**: `red-green required`

**Covers**: —

**Instructions**:
In `_opportunity_to_dict`: delete the two lines at `:899-900`, and in the docstring replace the clause
"a sparkline gap is JSON ``null`` (never ``NaN``);" with a statement that deprecated proto fields
(`sparkline`, 17) are not projected. Keep `live_price` and the omit-not-fabricate handling exactly as
is (`@AC-15 @feature-095`). The tool count and tool names do not change.

**Verification**:
```bash
cd services/xstockstrat-agent && ruff check . && ruff format --check . \
  && pytest tests/test_opportunity_projection.py tests/test_client.py -q
grep -n "sparkline" app/client.py   # docstring mention only; no d["sparkline"]
```

---

### Step 15 — test: agent parity guard excludes deprecated fields

**Status**: `pending`
**Service**: `xstockstrat-agent`
**Files**:
- `services/xstockstrat-agent/tests/test_opportunity_projection.py` — modify
- `services/xstockstrat-agent/tests/test_client.py` — modify

**Reviewers**: `xstockstrat-agent` owner — MCP tool contract stability (return shape)

**Codebase Evidence**:
- `tests/test_opportunity_projection.py:51-56` `test_opportunity_projection_covers_every_proto_field`: `assert emitted == set(analysis_pb2.Opportunity.DESCRIPTOR.fields_by_name)`; `:59-66` `test_guard_has_teeth` compares `(emitted - {"data_unavailable"})` against the same full set; `_full_opportunity` appends a sparkline point at `:45`; the module docstring (`:1-11`) says "EVERY ``Opportunity`` proto field is now projected — there is no silent allow-list".
- `tests/test_client.py:1284` `test_projection_omit_not_fabricate_and_caller_scoped`: appends two sparkline points (`:1311-1312`), comments at `:1287` and `:1333-1334`, and asserts `o0["sparkline"] == [pytest.approx(12.0), None]` (`:1337`).
- Ledger: a deprecated-field response-edge omission keeps the `.proto` field (insights.md:3332); a parity guard needs an explicit, stated opt-out (insights.md:443).

**Lands with**: `Step 14`

**TDD**: `red-green required` — write these edits first; on the pre-Step-14 tree the parity test fails because `emitted` still contains `sparkline`.

**Covers**: `AC-2`

**Instructions**:
1. `test_opportunity_projection.py`: add a module-level helper that returns the non-deprecated field
   names — `{name for name, f in analysis_pb2.Opportunity.DESCRIPTOR.fields_by_name.items() if not f.GetOptions().deprecated}` —
   with the `gen` import kept in-function (AGENT-2). Use it as the expected set in both
   `test_opportunity_projection_covers_every_proto_field` and `test_guard_has_teeth` (so the guard keeps
   its teeth). Keep the sparkline append in `_full_opportunity`.
2. Add `test_deprecated_sparkline_is_never_projected`: with a populated `sparkline`, the projected dict
   has no `sparkline` key, and `Opportunity.DESCRIPTOR.fields_by_name["sparkline"].GetOptions().deprecated`
   is true.
3. Update the module docstring to state the contract (D-7): every **non-deprecated** field is
   projected; a deprecated descriptor field is excluded from the projection and from the guard.
4. `test_client.py`: keep the two sparkline appends, replace the `:1337` assertion with
   `assert "sparkline" not in o0`, and reword the two comments (`:1287`, `:1333-1334`) so they no longer
   promise a projected sparkline.
5. C-13: the `Opportunity` literals stay where they are (`_full_opportunity` is the single shared
   builder in its file; the `test_client.py` rows are that test's one-offs) — no second copy is added.

**Verification**:
```bash
cd services/xstockstrat-agent && ruff check . && ruff format --check . \
  && pytest --cov=app --cov-fail-under=40
grep -n "def .*fixture\|from .conftest\|conftest" tests/test_opportunity_projection.py   # none: single-consumer inline (C-13 verdict)
```
Unit Verification = Steps 14 + 15 commands together.

---

### Step 16 — docs: durable `@AC-8 @feature-191` drops the `BatchGetBars` sparkline clause

**Status**: `pending`
**Service**: `xstockstrat-analysis` (durable business-rule suite)
**Files**:
- `services/xstockstrat-analysis/acceptance/opportunities-latency-fix.feature` — modify

**Reviewers**: none

**Codebase Evidence**:
- `services/xstockstrat-analysis/acceptance/opportunities-latency-fix.feature:19-25`: `@AC-8 @FR-6 @feature-191` "Live enrichment uses batch RPCs instead of per-symbol calls"; `:23` `Then it calls BatchGetLatestPrice once for all 30 symbols`; `:24` `And it calls BatchGetBars once for all 30 symbols (sparkline)`; `:25` `And it does not acquire _bars_fetch_sem per-symbol for enrichment`.
- C-16 sign-off: context.md "Session 2026-11-10 (operator decisions before /sdd-design)".
- No script parses the suite's steps (`grep -rn "\.feature" scripts .github/workflows/ci.yml` → only `platform.feature` copies in `scripts/check-otel-produced-signals.test.sh`).

**TDD**: `N/A (docs)`

**Covers**: `AC-2`

**Instructions**:
Delete line `:24` only. Keep the tags, the scenario title, and the `BatchGetLatestPrice` and
`_bars_fetch_sem` clauses. Change no other scenario (`@AC-7` and `@AC-9 @feature-191` are PRESERVE).

**Verification**:
```bash
grep -n "BatchGetBars once for all 30 symbols" services/xstockstrat-analysis/acceptance/opportunities-latency-fix.feature   # no match
grep -n "@AC-8 @FR-6 @feature-191" -A6 services/xstockstrat-analysis/acceptance/opportunities-latency-fix.feature   # BatchGetLatestPrice + _bars_fetch_sem clauses remain
```

---

### Step 17 — service: analysis config watcher stops sending `trading_mode`

**Status**: `pending`
**Service**: `xstockstrat-analysis`
**Files**:
- `services/xstockstrat-analysis/app/config/watcher.py` — modify

**Reviewers**: `xstockstrat-analysis` owner — config subscription scope only; scoring unaffected

**Codebase Evidence**:
- `grep -n "trading_mode\|TRADING_MODE" app/config/watcher.py` → `:28` `def resolve_trading_mode(trading_mode: str) -> int:` (body to `:32`), `:47` `self._trading_mode = resolve_trading_mode(os.environ.get("TRADING_MODE", "paper"))`, `:63` `trading_mode=self._trading_mode,` inside `_build_watch_request` (`:58-64`).
- Keep: `resolve_environment` (`:17`) and `self._environment` (`:46`); `os` and `common_pb2` stay imported for them.
- Target request shape: the Go watchers already omit the field (`services/xstockstrat-trading/internal/config/config.go:87-93`).
- Only importers of the resolver: `tests/test_config_watcher.py:21`.

**Lands with**: `Step 18`

**TDD**: `red-green required`

**Covers**: —

**Instructions**:
Delete `resolve_trading_mode` (`:28-32`), the `self._trading_mode = …` assignment (`:47`) and the
`trading_mode=self._trading_mode,` argument (`:63`). Do not touch `app/config/watch_core.py` (a
CI-checked shared copy, `scripts/check-watcher-copies.sh`).

**Verification**:
```bash
cd services/xstockstrat-analysis && ruff check . && ruff format --check . \
  && pytest tests/test_config_watcher.py tests/test_analysis_servicer.py -q -k "watch or Watcher or resolve"
grep -n "trading_mode\|TRADING_MODE" app/config/watcher.py   # no match
bash ../../scripts/check-watcher-copies.sh
```

---

### Step 18 — test: analysis watcher request carries no `trading_mode`

**Status**: `pending`
**Service**: `xstockstrat-analysis`
**Files**:
- `services/xstockstrat-analysis/tests/test_config_watcher.py` — modify
- `services/xstockstrat-analysis/tests/test_analysis_servicer.py` — modify

**Reviewers**: `xstockstrat-analysis` owner — config subscription scope

**Codebase Evidence**:
- `tests/test_config_watcher.py:21` `from app.config.watcher import ConfigWatcher, resolve_environment, resolve_trading_mode`; `:41-50` three `test_resolve_trading_mode_*` tests; `import app.config.watcher as watcher_mod` at `:19`.
- `tests/test_analysis_servicer.py:494-499` `class _StubWatcher(ConfigWatcher)` (bypasses `__init__`); `:503-514` `test_build_watch_request_client_id_and_scope` sets `w._trading_mode = common_pb2.TRADING_MODE_PAPER` (`:508`) and asserts `req.trading_mode == common_pb2.TRADING_MODE_PAPER` (`:513`).
- `trading_mode` is a non-optional proto3 enum, so `HasField` raises `ValueError` — compare to the zero value instead (D-5, R-4).

**Lands with**: `Step 17`

**TDD**: `red-green required` — write these edits first; on the pre-Step-17 tree the request carries `TRADING_MODE_LIVE` and the module still exports the resolver, so both assertions fail.

**Covers**: `AC-1`

**Instructions**:
1. `test_config_watcher.py`: drop `resolve_trading_mode` from the `:21` import and delete the three
   `test_resolve_trading_mode_*` tests. Add `test_watch_request_never_carries_trading_mode(monkeypatch)`:
   `monkeypatch.setenv("TRADING_MODE", "live")`;
   `monkeypatch.setattr(ConfigWatcher, "_trading_mode", common_pb2.TRADING_MODE_LIVE, raising=False)`
   (stands in for the value the old `__init__` resolved, without dialling); build
   `w = ConfigWatcher.__new__(ConfigWatcher)`, set `w.namespace = "analysis"` and
   `w._environment = common_pb2.ENVIRONMENT_STAGING`; assert
   `w._build_watch_request().trading_mode == common_pb2.TRADING_MODE_UNSPECIFIED` and
   `not hasattr(watcher_mod, "resolve_trading_mode")`. Do not use `HasField`.
2. `test_analysis_servicer.py`, `test_build_watch_request_client_id_and_scope`: delete the
   `w._trading_mode = …` line (`:508`), change `:513` to
   `assert req.trading_mode == common_pb2.TRADING_MODE_UNSPECIFIED`, and reword the `:505` comment to
   "keeping environment on the wire".
3. C-13: no domain literal — the tests reuse `ConfigWatcher.__new__` and the existing `_StubWatcher`.

**Verification**:
```bash
cd services/xstockstrat-analysis && ruff check . && ruff format --check . \
  && pytest --cov=app --cov-fail-under=40
grep -rn "resolve_trading_mode\|\._trading_mode" tests app   # one hit: the hasattr(watcher_mod, "resolve_trading_mode") assertion
```
Unit Verification = Steps 17 + 18 commands together.

---

### Step 19 — service: indicators config watcher stops sending `trading_mode`

**Status**: `pending`
**Service**: `xstockstrat-indicators`
**Files**:
- `services/xstockstrat-indicators/app/config/watcher.py` — modify

**Reviewers**: `xstockstrat-indicators` owner — config subscription scope only; sandbox unaffected

**Codebase Evidence**:
- `grep -n "trading_mode\|TRADING_MODE" app/config/watcher.py` → `:30` `def resolve_trading_mode(trading_mode: str) -> int:` (body to `:34`), `:52` `self._trading_mode = resolve_trading_mode(os.environ.get("TRADING_MODE", "paper"))`, `:69` `trading_mode=self._trading_mode,` inside `_build_watch_request` (`:64-70`).
- Keep `resolve_environment` (`:19`) and `self._environment` (`:51`).
- Only importer of the resolver: `tests/test_config_watcher.py:23`.

**Lands with**: `Step 20`

**TDD**: `red-green required`

**Covers**: —

**Instructions**:
Delete `resolve_trading_mode` (`:30-34`), the `self._trading_mode = …` assignment (`:52`) and the
`trading_mode=self._trading_mode,` argument (`:69`). Do not touch `app/config/watch_core.py` or
`app/config/live_limits.py` (CI-checked shared copies).

**Verification**:
```bash
cd services/xstockstrat-indicators && ruff check . && ruff format --check . \
  && pytest tests/test_config_watcher.py -q
grep -n "trading_mode\|TRADING_MODE" app/config/watcher.py   # no match
bash ../../scripts/check-watcher-copies.sh
```

---

### Step 20 — test: indicators watcher request carries no `trading_mode`

**Status**: `pending`
**Service**: `xstockstrat-indicators`
**Files**:
- `services/xstockstrat-indicators/tests/test_config_watcher.py` — modify

**Reviewers**: `xstockstrat-indicators` owner — config subscription scope

**Codebase Evidence**:
- `tests/test_config_watcher.py:23` `from app.config.watcher import ConfigWatcher, resolve_environment, resolve_trading_mode`; `:48-57` three `test_resolve_trading_mode_*` tests; the module docstring (`:1-7`) names `APPLICATION_ENV/TRADING_MODE`; `import app.config.watcher as watcher_mod` at `:19`.
- No existing test calls `_build_watch_request` in this service (`grep -rn "_build_watch_request" tests` → no match); the no-network pattern is `ConfigWatcher.__new__` as used by `snapshot_watcher` (`tests/conftest.py:164-171`).
- Negative OTel tests that set `TRADING_MODE` (`tests/test_telemetry.py:10-15,186`) stay untouched (`@AC-1 @feature-171`).

**Lands with**: `Step 19`

**TDD**: `red-green required` — on the pre-Step-19 tree the request carries `TRADING_MODE_LIVE`, so the new test fails on its assertion.

**Covers**: `AC-1`

**Instructions**:
Drop `resolve_trading_mode` from the `:23` import, delete the three `test_resolve_trading_mode_*`
tests, and change the module docstring's "APPLICATION_ENV/TRADING_MODE" to "APPLICATION_ENV". Add
`test_watch_request_never_carries_trading_mode(monkeypatch)` exactly as specified in Step 18 item 1,
with `w.namespace = "indicators"`. Do not use `HasField` (R-4). C-13: no domain literal.

**Verification**:
```bash
cd services/xstockstrat-indicators && ruff check . && ruff format --check . \
  && pytest --cov=app --cov-fail-under=50
grep -rn "resolve_trading_mode\|\._trading_mode" tests app   # one hit: the hasattr(watcher_mod, "resolve_trading_mode") assertion
```
Unit Verification = Steps 19 + 20 commands together.

---

### Step 21 — service: ingest config watcher stops sending `trading_mode`

**Status**: `pending`
**Service**: `xstockstrat-ingest`
**Files**:
- `services/xstockstrat-ingest/app/config/watcher.py` — modify

**Reviewers**: `xstockstrat-ingest` owner — config subscription scope only; signal normalization unaffected

**Codebase Evidence**:
- `grep -n "trading_mode\|TRADING_MODE" app/config/watcher.py` → `:40` `def resolve_trading_mode(trading_mode: str) -> int:` (body to `:44`), `:59` `self._trading_mode = resolve_trading_mode(os.environ.get("TRADING_MODE", "paper"))`, `:75` `trading_mode=self._trading_mode,` inside `_build_watch_request` (`:70-76`).
- Keep `resolve_environment` (`:29`), `self._environment` (`:58`) and `resolve_secret` (`:80`).
- Only importer of the resolver: `tests/test_config_watcher.py:21`.

**Lands with**: `Step 22`

**TDD**: `red-green required`

**Covers**: —

**Instructions**:
Delete `resolve_trading_mode` (`:40-44`), the `self._trading_mode = …` assignment (`:59`) and the
`trading_mode=self._trading_mode,` argument (`:75`). Do not touch `app/config/watch_core.py` or
`app/config/live_limits.py`.

**Verification**:
```bash
cd services/xstockstrat-ingest && ruff check . && ruff format --check . \
  && pytest tests/test_config_watcher.py tests/test_ingest_servicer.py -q -k "watch or Watcher or resolve"
grep -n "trading_mode\|TRADING_MODE" app/config/watcher.py   # no match
bash ../../scripts/check-watcher-copies.sh
```

---

### Step 22 — test: ingest watcher request carries no `trading_mode`

**Status**: `pending`
**Service**: `xstockstrat-ingest`
**Files**:
- `services/xstockstrat-ingest/tests/test_config_watcher.py` — modify
- `services/xstockstrat-ingest/tests/test_ingest_servicer.py` — modify

**Reviewers**: `xstockstrat-ingest` owner — config subscription scope

**Codebase Evidence**:
- `tests/test_config_watcher.py:21` imports `resolve_trading_mode`; `:41-50` three `test_resolve_trading_mode_*` tests.
- `tests/test_ingest_servicer.py:1266-1274` `class _StubWatcher(ConfigWatcher)`; `:1278-1289` `test_build_watch_request_client_id_and_scope` sets `w._trading_mode = common_pb2.TRADING_MODE_PAPER` (`:1283`) and asserts `req.trading_mode == common_pb2.TRADING_MODE_PAPER` (`:1288`).
- Negative OTel tests (`tests/test_telemetry.py:10-15,186`) stay untouched.

**Lands with**: `Step 21`

**TDD**: `red-green required` — on the pre-Step-21 tree both the new test and the flipped assertion fail.

**Covers**: `AC-1`

**Instructions**:
1. `test_config_watcher.py`: drop `resolve_trading_mode` from the `:21` import, delete the three
   `test_resolve_trading_mode_*` tests, and add `test_watch_request_never_carries_trading_mode(monkeypatch)`
   as specified in Step 18 item 1, with `w.namespace = "ingest"`.
2. `test_ingest_servicer.py`, `test_build_watch_request_client_id_and_scope`: delete the
   `w._trading_mode = …` line (`:1283`), change `:1288` to
   `assert req.trading_mode == common_pb2.TRADING_MODE_UNSPECIFIED`, and reword the `:1280` comment to
   "keeping environment on the wire".
3. C-13: no domain literal.

**Verification**:
```bash
cd services/xstockstrat-ingest && ruff check . && ruff format --check . \
  && pytest --cov=app --cov-fail-under=40
grep -rn "resolve_trading_mode\|\._trading_mode" tests app   # one hit: the hasattr(watcher_mod, "resolve_trading_mode") assertion
```
Unit Verification = Steps 21 + 22 commands together.

---

### Step 23 — service: trading `NewWatcher` drops the `tradingMode` parameter

**Status**: `pending`
**Service**: `xstockstrat-trading`
**Files**:
- `services/xstockstrat-trading/internal/config/config.go` — modify
- `services/xstockstrat-trading/cmd/server/main.go` — modify

**Reviewers**: `xstockstrat-trading` owner — paper-only dev invariant (the `broker.paper` fallback must be untouched)

**Codebase Evidence**:
- `internal/config/config.go`: `Watcher` field `tradingMode commonv1.TradingMode` (`:64`); doc comment `:68` "applicationEnv/tradingMode scope every WatchConfig request…"; `func NewWatcher(endpoint, applicationEnv, tradingMode string, namespaces ...string) (*Watcher, error)` (`:69`); `w.tradingMode = resolveTradingMode(tradingMode)` (`:79`); `resolveTradingMode` (`:107-114`). The request built in `newWatcher` (`:87-93`) already omits `trading_mode`.
- Callers: `cmd/server/main.go:70` `config.NewWatcher(cfg.ConfigEndpoint, cfg.ApplicationEnv, cfg.TradingMode, "trading")` and `:75` (same with `"platform"`). No `_test.go` calls `NewWatcher` (`grep -rn "NewWatcher(" --include=*_test.go services/xstockstrat-trading` → no match).
- **Keep** (live consumer, D-3, feature 321): `Config.TradingMode` (`:30`, `:46` `getEnv("TRADING_MODE", "paper")`), read by `func (s *TradingService) environmentIsPaper()` (`internal/service/trading.go:2729-2730`) and `func (s *TradingService) resolveTradingMode(…)` (`:3739-3743`) as `s.cfgW.GetBool("broker.paper", s.cfg.TradingMode == "paper")`; test fixtures `config.Config{TradingMode: "paper"}` and `internal/config/config_test.go:522-541`.

**Lands with**: `Step 24`

**TDD**: `red-green required` — see Step 24 for the D-10 record.

**Covers**: —

**Instructions**:
1. `config.go`: delete the `tradingMode` field, the `w.tradingMode = …` assignment and the
   package-level `resolveTradingMode` function; change the signature to
   `NewWatcher(endpoint, applicationEnv string, namespaces ...string)`; reword the `:68` comment to name
   `applicationEnv` only. `commonv1` stays imported (`resolveEnvironment`).
2. `cmd/server/main.go:70,75`: remove the `cfg.TradingMode` argument from **both** calls.
   **Trap**: because `namespaces` is variadic, a call left as
   `NewWatcher(endpoint, env, cfg.TradingMode, "trading")` still compiles and would subscribe to a
   namespace named `paper`. The compiler will not catch a missed call — the grep below is the guard.
3. Trading-mode gate: order placement is not touched; the existing gate (`environmentIsPaper`,
   `TradingService.resolveTradingMode`) and `Config.TradingMode` are reused unchanged, so paper mode
   still never submits live orders. Deployment values stay `TRADING_MODE: paper` in
   `docker-compose.yml` and `.do/app.dev.yaml`, `live` in `.do/app.yaml` (no edit). Both brokers
   (ALPACA, IBKR), order type handling and fill handling are unaffected by this step.

**Verification**:
```bash
cd services/xstockstrat-trading && GOWORK=off go build ./... && GOWORK=off go vet ./...
grep -n "NewWatcher(" cmd/server/main.go                      # two calls, neither passes cfg.TradingMode
grep -n "tradingMode\|func resolveTradingMode" internal/config/config.go   # no match
grep -n "TradingMode" internal/config/config.go               # Config.TradingMode field + TRADING_MODE env read remain
grep -n "TRADING_MODE" ../../docker-compose.yml ../../.do/app.dev.yaml ../../.do/app.yaml   # paper / paper / live, unchanged
grep -n 'GetBool("broker.paper"' internal/service/trading.go   # two hits: the fallback gate is present and unchanged
```

---

### Step 24 — test: trading config tests drop the dead resolver

**Status**: `pending`
**Service**: `xstockstrat-trading`
**Files**:
- `services/xstockstrat-trading/internal/config/config_test.go` — modify

**Reviewers**: `xstockstrat-trading` owner — paper-only dev invariant

**Codebase Evidence**:
- `internal/config/config_test.go:627-629` comment "TestResolveEnvironment / TestResolveTradingMode guard the WatchConfig scope-omission fix: NewWatcher must resolve this deployment's own APPLICATION_ENV/TRADING_MODE…"; `:647-661` `func TestResolveTradingMode` (the only reference to `resolveTradingMode` in tests).
- `:522-523, :540-541` assert `cfg.TradingMode` default/override — **keep** (the live fallback input).
- Design premise check (P-03): D-10 expects `config_test.go` call sites of `NewWatcher` to update first. The tree has none; the only test tie is `TestResolveTradingMode`.

**Lands with**: `Step 23`

**TDD**: `red-green required` — compile-only RED per D-10: with Step 23's `config.go` edit applied and this file untouched, `go vet ./internal/config/` fails to compile the test package (`undefined: resolveTradingMode`); capture that, then apply this step for GREEN. Record it as "compile-only RED; no assertion-level RED because trading_mode is already omitted". If the tdd-gate rejects a compile RED, record a P-06 deviation with that text. Never record "no RED possible".

**Covers**: `AC-1`

**Instructions**:
Delete `TestResolveTradingMode` (`:647-661`) and reword the `:627-629` comment to name
`TestResolveEnvironment` / `APPLICATION_ENV` only. Keep `TestResolveEnvironment` and the
`cfg.TradingMode` default/override assertions. `commonv1` stays imported. C-13: no domain literal.
The partial-fill / full-fill test-case requirement does not apply (no fill code is touched).

**Verification**:
```bash
cd services/xstockstrat-trading && GOWORK=off golangci-lint run --modules-download-mode=mod \
  && GOWORK=off COVERPKGS=$(go list ./... | grep -Ev '/(cmd|handler|repository|telemetry|service)(/|$)' | tr '\n' ',' | sed 's/,$//') \
  && go test ./... -race -count=1 -coverprofile=coverage.out -covermode=atomic -coverpkg="${COVERPKGS}" \
  && go tool cover -func=coverage.out | grep "^total:"   # confirm ≥ 40%
grep -rn "resolveTradingMode(" internal/config   # no match (the TradingService method lives in internal/service)
```
Unit Verification = Steps 23 + 24 commands together.

---

### Step 25 — service: portfolio `NewWatcher` drops `tradingMode`; unread `Config.TradingMode` removed

**Status**: `pending`
**Service**: `xstockstrat-portfolio`
**Files**:
- `services/xstockstrat-portfolio/internal/config/config.go` — modify
- `services/xstockstrat-portfolio/cmd/server/main.go` — modify

**Reviewers**: `xstockstrat-portfolio` owner — position snapshot consistency (the per-position `TradingMode` data dimension must be untouched)

**Codebase Evidence**:
- `internal/config/config.go`: `Config.TradingMode string` (`:27`), `TradingMode: getEnv("TRADING_MODE", "paper")` (`:40`), `Watcher.tradingMode commonv1.TradingMode` (`:51`), doc comment `:54-55`, `func NewWatcher(endpoint, namespace, applicationEnv, tradingMode string) (*Watcher, error)` (`:56`), `w.tradingMode = resolveTradingMode(tradingMode)` (`:66`), `resolveTradingMode` (`:93-99`).
- Only reader of `cfg.TradingMode` outside the config package: `cmd/server/main.go:58` `config.NewWatcher(cfg.ConfigEndpoint, "portfolio", cfg.ApplicationEnv, cfg.TradingMode)` (`grep -rn "cfg\.TradingMode" --include=*.go services/xstockstrat-portfolio` → this line only).
- **Not residue — do not touch**: `commonv1.TradingMode` as the per-position dimension in `internal/repository/portfolio_repo.go`, `internal/service/portfolio_service.go` and `internal/handler/portfolio_handler.go`.

**Lands with**: `Step 26`

**TDD**: `red-green required` — see Step 26 for the D-10 record.

**Covers**: —

**Instructions**:
1. `config.go`: delete the `Watcher.tradingMode` field, the assignment and `resolveTradingMode`; change
   the signature to `NewWatcher(endpoint, namespace, applicationEnv string)`; reword the `:54-55` comment
   to name `applicationEnv` only.
2. Delete `Config.TradingMode` and its `getEnv("TRADING_MODE", "paper")` read: after item 1 nothing reads
   it (an orphan this step creates). Fixed-arity signature here, so a missed caller is a compile error.
3. `cmd/server/main.go:58`: drop the `cfg.TradingMode` argument.
4. Broker handling, order types, fill handling and the `TRADING_MODE` deployment values are unaffected;
   no `docker-compose.yml` or `.do/app*.yaml` edit.

**Verification**:
```bash
cd services/xstockstrat-portfolio && GOWORK=off go build ./... && GOWORK=off go vet ./...
grep -n "tradingMode\|TRADING_MODE\|resolveTradingMode" internal/config/config.go cmd/server/main.go   # no match
grep -n "TRADING_MODE" ../../docker-compose.yml ../../.do/app.dev.yaml ../../.do/app.yaml   # unchanged
```

---

### Step 26 — test: portfolio config tests drop the dead resolver and env assertions

**Status**: `pending`
**Service**: `xstockstrat-portfolio`
**Files**:
- `services/xstockstrat-portfolio/internal/config/config_test.go` — modify

**Reviewers**: `xstockstrat-portfolio` owner — config loading

**Codebase Evidence**:
- `internal/config/config_test.go:34-35` (`cfg.TradingMode` default assertion), `:42` `t.Setenv("TRADING_MODE", "live")`, `:53-54` (override assertion), `:193-195` comment naming `TestResolveTradingMode` / `TRADING_MODE`, `:213-226` `func TestResolveTradingMode`.
- No `_test.go` in the service calls `NewWatcher` (`grep -rn "NewWatcher(" --include=*_test.go services/xstockstrat-portfolio` → no match).

**Lands with**: `Step 25`

**TDD**: `red-green required` — compile-only RED per D-10: with Step 25's edits applied and this file untouched, `go vet ./internal/config/` fails to compile the test package (`undefined: resolveTradingMode`, `cfg.TradingMode undefined`); capture it, then apply this step. Record "compile-only RED; no assertion-level RED because trading_mode is already omitted", or a P-06 deviation if the tdd-gate rejects a compile RED.

**Covers**: `AC-1`

**Instructions**:
Delete the two `cfg.TradingMode` assertions (`:34-35`, `:53-54`), the `t.Setenv("TRADING_MODE", "live")`
line (`:42`) and `TestResolveTradingMode` (`:213-226`); reword the `:193-195` comment to name
`TestResolveEnvironment` / `APPLICATION_ENV` only. C-13: no domain literal.

**Verification**:
```bash
cd services/xstockstrat-portfolio && GOWORK=off golangci-lint run --modules-download-mode=mod \
  && GOWORK=off COVERPKGS=$(go list ./... | grep -Ev '/(cmd|handler|repository|telemetry|service)(/|$)' | tr '\n' ',' | sed 's/,$//') \
  && go test ./... -race -count=1 -coverprofile=coverage.out -covermode=atomic -coverpkg="${COVERPKGS}" \
  && go tool cover -func=coverage.out | grep "^total:"   # confirm ≥ 40%
grep -rn "TRADING_MODE\|resolveTradingMode" internal/config   # no match
```
Unit Verification = Steps 25 + 26 commands together.

---

### Step 27 — service: marketdata drops the watcher `tradingMode` and the Alpaca `Paper` vestige

**Status**: `pending`
**Service**: `xstockstrat-marketdata`
**Files**:
- `services/xstockstrat-marketdata/internal/config/config.go` — modify
- `services/xstockstrat-marketdata/internal/alpaca/client.go` — modify
- `services/xstockstrat-marketdata/cmd/server/main.go` — modify

**Reviewers**: `xstockstrat-marketdata` owner — Alpaca feed idempotency (client construction must stay behavior-identical)

**Codebase Evidence**:
- `internal/config/config.go`: `Config.TradingMode string` (`:32`), `TradingMode: getEnv("TRADING_MODE", "paper")` (`:48`), `Watcher.tradingMode` (`:59`), doc comment `:62-63`, `func NewWatcher(endpoint, namespace, applicationEnv, tradingMode string)` (`:64`), assignment `:74`, `resolveTradingMode` (`:102-108`).
- `cmd/server/main.go:64` `config.NewWatcher(cfg.ConfigEndpoint, "marketdata", cfg.ApplicationEnv, cfg.TradingMode)`; `:82-99` `alpaca.NewLiveClient(func() alpaca.Settings { … }, cfg.TradingMode == "paper")`. These are the only non-test readers of `cfg.TradingMode` (`grep -rn "cfg\.TradingMode" --include=*.go services/xstockstrat-marketdata`).
- `internal/alpaca/client.go`: `ClientConfig.Paper bool` (`:50`); comment `:94-95` "…paper is fixed for the client's lifetime."; `func NewLiveClient(settings func() Settings, paper bool) *Client` (`:96`); `cfg: ClientConfig{Paper: paper},` (`:98`); `conf()` copies `Paper: c.cfg.Paper` (`:113`). Nothing reads `Paper` (`grep -rn "Paper\b" --include=*.go services/xstockstrat-marketdata/internal/alpaca` → these lines only).
- Test caller: `internal/alpaca/client_test.go:759-763` `alpaca.NewLiveClient(func() alpaca.Settings { … }, true)`.
- Signature precedent: `internal/edgar/edgar_client.go:56` `func NewLiveClient(settings func() Settings) *Client`.

**Lands with**: `Step 28`

**TDD**: `red-green required` — see Step 28 for the D-10 record.

**Covers**: —

**Instructions**:
1. `internal/alpaca/client.go`: delete `ClientConfig.Paper`; change the constructor to
   `NewLiveClient(settings func() Settings) *Client` with `cfg: ClientConfig{}` removed or left as the
   zero value; drop `Paper: c.cfg.Paper` from `conf()`; drop the "paper is fixed…" sentence from the
   doc comment.
2. `internal/config/config.go`: delete the `Watcher.tradingMode` field, the assignment and
   `resolveTradingMode`; change the signature to `NewWatcher(endpoint, namespace, applicationEnv string)`;
   reword the `:62-63` comment to name `applicationEnv` only; delete `Config.TradingMode` and its env
   read (nothing reads it after items 1 and 3).
3. `cmd/server/main.go`: drop `cfg.TradingMode` from the `NewWatcher` call (`:64`) and the trailing
   `, cfg.TradingMode == "paper"` argument from `alpaca.NewLiveClient` (`:99`).
4. Broker coverage: this is Alpaca **market-data** client construction only — the trading broker
   clients (ALPACA=1, IBKR=2) are unaffected. No order placement, order type or fill handling is
   touched. `TRADING_MODE` deployment values are unchanged (no `docker-compose.yml` / `.do/app*.yaml` edit).

**Verification**:
```bash
cd services/xstockstrat-marketdata && GOWORK=off go build ./... && GOWORK=off go vet ./...
grep -rn "Paper\b" --include=*.go internal/alpaca cmd | grep -v "_test.go"            # no match
grep -n "tradingMode\|TRADING_MODE\|resolveTradingMode\|TradingMode" internal/config/config.go cmd/server/main.go   # no match
grep -n "TRADING_MODE" ../../docker-compose.yml ../../.do/app.dev.yaml ../../.do/app.yaml   # unchanged
```

---

### Step 28 — test: marketdata test call sites follow the new signatures

**Status**: `pending`
**Service**: `xstockstrat-marketdata`
**Files**:
- `services/xstockstrat-marketdata/internal/alpaca/client_test.go` — modify
- `services/xstockstrat-marketdata/internal/config/config_test.go` — modify

**Reviewers**: `xstockstrat-marketdata` owner — Alpaca feed idempotency

**Codebase Evidence**:
- `internal/alpaca/client_test.go:750` `TestLiveClient_RateLimitFollowsSettings_AC32`; `:759-763` passes `, true` as the second `NewLiveClient` argument (external test package `alpaca_test`).
- `internal/config/config_test.go:108-109` and `:126-127` (`cfg.TradingMode` assertions), `:116` `t.Setenv("TRADING_MODE", "live")`, `:270-272` comment, `:291-304` `func TestResolveTradingMode`.
- Keep: `internal/telemetry/otel_test.go:47` `Setenv("TRADING_MODE", …)` — a negative OTel test (`@AC-1 @feature-171`).

**Lands with**: `Step 27`

**TDD**: `red-green required` — D-10 RED: first change `client_test.go:763` to the one-argument call; `go vet ./internal/alpaca/` then fails to compile against the old `NewLiveClient(settings, paper)` (too few arguments) — capture that as the RED, then apply Step 27 and the `config_test.go` edits for GREEN. Record "compile-only RED; no assertion-level RED because trading_mode is already omitted", or a P-06 deviation if the tdd-gate rejects a compile RED.

**Covers**: `AC-1`

**Instructions**:
1. `client_test.go:759-763`: call `alpaca.NewLiveClient(func() alpaca.Settings { … })` with no second
   argument. Change nothing else in `TestLiveClient_RateLimitFollowsSettings_AC32`.
2. `config_test.go`: delete the two `cfg.TradingMode` assertions (`:108-109`, `:126-127`), the
   `t.Setenv("TRADING_MODE", "live")` line (`:116`) and `TestResolveTradingMode` (`:291-304`); reword the
   `:270-272` comment to name `TestResolveEnvironment` / `APPLICATION_ENV` only.
3. C-13: no domain literal is added.

**Verification**:
```bash
cd services/xstockstrat-marketdata && GOWORK=off golangci-lint run --modules-download-mode=mod \
  && GOWORK=off COVERPKGS=$(go list ./... | grep -Ev '/(cmd|handler|repository|telemetry|service)(/|$)' | tr '\n' ',' | sed 's/,$//') \
  && go test ./... -race -count=1 -coverprofile=coverage.out -covermode=atomic -coverpkg="${COVERPKGS}" \
  && go tool cover -func=coverage.out | grep "^total:"   # confirm ≥ 40%
grep -rn "resolveTradingMode\|TRADING_MODE" internal/config internal/alpaca   # no match
```
Unit Verification = Steps 27 + 28 commands together.

---

### Step 29 — service: config-service watcher stops setting `tradingMode`

**Status**: `pending`
**Service**: `xstockstrat-config`
**Files**:
- `services/xstockstrat-config/src/services/configWatcher.ts` — modify

**Reviewers**: `xstockstrat-config` owner — WatchConfig stream stability, environment scoping

**Codebase Evidence**:
- `services/xstockstrat-config/src/services/configWatcher.ts:7-8`: `import { ConfigServiceClient, ConfigSnapshot, ConfigValue } from '@xstockstrat/proto/config/v1/config';` / `import { Environment, TradingMode } from '@xstockstrat/proto/common/v1/common';`.
- `:40-53` `startWatch()`: comment `:41-42` "…paper/live is derived from environment; trading_mode is deprecated and ignored by the server."; `this.stub.watchConfig({ namespace: this.namespace, clientId: …, version: '', environment, tradingMode: TradingMode.TRADING_MODE_UNSPECIFIED, userId: '' })` (`:46-53`).
- The literal spells out `version: ''` and `userId: ''`, and `packages/proto/buf.gen.yaml` generates ts-proto with `useOptionals=messages` (only message-typed fields optional), so a bare literal without `tradingMode` does not satisfy the request type. `fromPartial` is available on the same generated module (precedent `services/xstockstrat-identity/src/__tests__/configWatcher.test.ts:86-87`, `configProto.ConfigSnapshot.fromPartial(…)`).
- This copy is **not** in `scripts/check-watcher-copies.sh` (its `node` group lists ledger, identity, notify only).

**TDD**: `red-green required` — expected record: "red N/A — no behavior change; characterization test added" (tdd-gate.md escape). The request is byte-identical on the wire: `TRADING_MODE_UNSPECIFIED` is the proto3 default.

**Covers**: —

**Instructions**:
Add `WatchConfigRequest` to the `:7` import, remove `TradingMode` from the `:8` import, and build the
request as `this.stub.watchConfig(WatchConfigRequest.fromPartial({ namespace: this.namespace, clientId: …, version: '', environment, userId: '' }))`
— the `tradingMode:` property is deleted. Reword the `:41-42` comment to drop the `trading_mode`
clause (keep the environment scoping sentence, ≤2 lines). No outbound call is added.

**Verification**:
```bash
cd services/xstockstrat-config && pnpm run build && pnpm run lint
grep -n "tradingMode\|TradingMode\|trading_mode" src/services/configWatcher.ts   # no match
```

---

### Step 30 — test: config-service watcher request characterization

**Status**: `pending`
**Service**: `xstockstrat-config`
**Files**:
- `services/xstockstrat-config/src/__tests__/configWatcher.test.ts` — modify

**Reviewers**: `xstockstrat-config` owner — WatchConfig stream stability

**Codebase Evidence**:
- `src/__tests__/configWatcher.test.ts:120-136` `describe('ConfigWatcher reconnect', …)` → `fakeStubWatcher()` replaces `(w as any).stub` with `{ watchConfig: () => { … } }` and drives `(w as any).startWatch()` (`:141`). The stub ignores its argument today.
- Design premise check (P-03): design.md lists Node as "RED-first". The Node watchers already send `TRADING_MODE_UNSPECIFIED`, so no assertion can fail first; this is recorded as the tdd-gate "no behavior change" escape instead.

**TDD**: `red-green required` — record "red N/A — no behavior change; characterization test added"; the test passes before and after Step 29.

**Covers**: `AC-1`

**Instructions**:
Add one `it(...)` in the `ConfigWatcher reconnect` block (or a sibling `describe`) that installs a stub
whose `watchConfig(req)` records `req`, calls `(w as any).startWatch()`, and asserts
`req.namespace === 'test'`, `req.environment` is the staging member, and
`req.tradingMode === TradingMode.TRADING_MODE_UNSPECIFIED` (import `Environment` and `TradingMode` from
`@xstockstrat/proto/common/v1/common` in the test). C-13: no domain literal — the request fields are
this test's one-offs.

**Verification**:
```bash
cd services/xstockstrat-config && pnpm run lint && pnpm run test:coverage && pnpm exec c8 check-coverage --lines 40
grep -n "__tests__/fixtures" src/__tests__/configWatcher.test.ts   # none: single-consumer inline (C-13 verdict)
```

---

### Step 31 — service: shared Node watcher copies stop setting `tradingMode`

**Status**: `pending`
**Service**: `xstockstrat-identity`, `xstockstrat-ledger`, `xstockstrat-notify`
**Files**:
- `services/xstockstrat-identity/src/services/configWatcher.ts` — modify
- `services/xstockstrat-ledger/src/services/configWatcher.ts` — modify
- `services/xstockstrat-notify/src/services/configWatcher.ts` — modify

**Reviewers**: `xstockstrat-identity` owner — config subscription only, no auth path change; `xstockstrat-ledger` owner — append-only invariant unaffected; `xstockstrat-notify` owner — stream delivery unaffected

**Codebase Evidence**:
- The three files are byte-identical and CI-enforced: header comment `:1-4` ("byte-identical in xstockstrat-{ledger,identity,notify}; edit all three together"), `scripts/check-watcher-copies.sh:24-26`, CI step `.github/workflows/ci.yml:1056`.
- In each: `:7` config-module import; `:8` `import { Environment, TradingMode } from '@xstockstrat/proto/common/v1/common';`; `:79-91` `startWatch()` with comment `:80` "Config is scoped by environment; trading_mode is deprecated (server ignores it)." and `tradingMode: TradingMode.TRADING_MODE_UNSPECIFIED,` at `:89`.
- Same ts-proto typing constraint and `fromPartial` precedent as Step 29.

**TDD**: `red-green required` — expected record: "red N/A — no behavior change; characterization test added" (tdd-gate.md escape).

**Covers**: —

**Instructions**:
Apply the Step 29 edit **identically** to all three files: add `WatchConfigRequest` to the `:7` import,
remove `TradingMode` from the `:8` import, wrap the request in `WatchConfigRequest.fromPartial({ … })`
without the `tradingMode:` property, and reword the `:80` comment to "Config is scoped by environment."
Edit one file and copy it over the other two so they stay byte-identical. No outbound call is added.

**Verification**:
```bash
bash scripts/check-watcher-copies.sh
for s in identity ledger notify; do (cd services/xstockstrat-$s && pnpm run build && pnpm run lint) || exit 1; done
grep -n "tradingMode\|TradingMode\|trading_mode" services/xstockstrat-{identity,ledger,notify}/src/services/configWatcher.ts   # no match
```

---

### Step 32 — test: shared Node watcher request characterization

**Status**: `pending`
**Service**: `xstockstrat-identity`, `xstockstrat-ledger`, `xstockstrat-notify`
**Files**:
- `services/xstockstrat-identity/src/__tests__/configWatcher.test.ts` — modify
- `services/xstockstrat-ledger/src/__tests__/configWatcher.test.ts` — modify
- `services/xstockstrat-notify/src/__tests__/configWatcher.test.ts` — modify

**Reviewers**: `xstockstrat-identity`, `xstockstrat-ledger`, `xstockstrat-notify` owners — config subscription only

**Codebase Evidence**:
- `services/xstockstrat-identity/src/__tests__/configWatcher.test.ts:48-58` `class FakeConfigServiceClient` with `watchConfig(): FakeStream` that pushes to `opens` and takes no argument; the ledger and notify test files carry the same seam (they are not byte-identical to each other and are not in the copies check: `cmp` differs at line 1).
- None of the three files asserts on the request today (`grep -n "TradingMode" services/xstockstrat-*/src/__tests__/configWatcher*.ts` → no match).

**TDD**: `red-green required` — record "red N/A — no behavior change; characterization test added"; the tests pass before and after Step 31.

**Covers**: `AC-1`

**Instructions**:
In each of the three test files: let `FakeConfigServiceClient.watchConfig` accept the request and
record it alongside the stream in `opens`, then add one test that constructs the watcher through the
file's existing setup helper and asserts the first recorded request has the file's `NS` namespace and
`tradingMode === TradingMode.TRADING_MODE_UNSPECIFIED` (import from
`@xstockstrat/proto/common/v1/common`). Keep each file's existing structure; do not try to make the
three test files identical. C-13: no domain literal in any of the three (single-consumer one-offs).

**Verification**:
```bash
for s in identity ledger notify; do (cd services/xstockstrat-$s && pnpm run lint && pnpm run test:coverage && pnpm exec c8 check-coverage --lines 40) || exit 1; done
grep -n "__tests__/fixtures" services/xstockstrat-{identity,ledger,notify}/src/__tests__/configWatcher.test.ts   # none (C-13 verdict: inline-compliant)
```

---

### Step 33 — docs: service `CLAUDE.md` env blocks stop listing `TRADING_MODE=paper`

**Status**: `pending`
**Service**: service docs (`xstockstrat-analysis`, `-identity`, `-indicators`, `-ingest`, `-ledger`, `-notify`, `-portfolio`, `-trading`)
**Files**:
- `services/xstockstrat-analysis/CLAUDE.md` — modify
- `services/xstockstrat-identity/CLAUDE.md` — modify
- `services/xstockstrat-indicators/CLAUDE.md` — modify
- `services/xstockstrat-ingest/CLAUDE.md` — modify
- `services/xstockstrat-ledger/CLAUDE.md` — modify
- `services/xstockstrat-notify/CLAUDE.md` — modify
- `services/xstockstrat-portfolio/CLAUDE.md` — modify
- `services/xstockstrat-trading/CLAUDE.md` — modify

**Reviewers**: none

**Codebase Evidence**:
- `grep -n "TRADING_MODE" services/*/CLAUDE.md` → env-block lines `TRADING_MODE=paper                     # paper | live` at analysis `:679`, identity `:106`, indicators `:250`, ingest `:176`, ledger `:138`, notify `:127`, portfolio `:214`, trading `:298`.
- Already correct, no edit: config `:134` and marketdata `:277` ("TRADING_MODE is no longer used for config scope…"); agent and ui list no `TRADING_MODE`.
- Trading's consumer: `services/xstockstrat-trading/CLAUDE.md:13` ("…falling back to the `TRADING_MODE` env var") and `:21` already describe the fallback in prose; the code readers are `environmentIsPaper` and `TradingService.resolveTradingMode` in `internal/service/trading.go`, via `Config.TradingMode` in `internal/config/config.go`.
- Portfolio `:165` (`trading_mode` as `mode.String()`, the per-position dimension) is not residue — leave it.

**TDD**: `N/A (docs)`

**Covers**: `AC-1`

**Instructions**:
1. In the seven non-trading files, delete the `TRADING_MODE=paper   # paper | live` env-block line.
2. In `services/xstockstrat-trading/CLAUDE.md:298`, keep the variable and replace the trailing comment
   so the line names its consumer, for example:
   `TRADING_MODE=paper   # paper | live — read only as the fallback for trading.broker.paper (Config.TradingMode → environmentIsPaper / resolveTradingMode)`.
3. Do not edit `docker-compose.yml` or `.do/app*.yaml` (the env stays injected; values `paper` /
   `paper` / `live`), and do not edit the root `CLAUDE.md`.

**Verification**:
```bash
grep -n "TRADING_MODE=paper" services/*/CLAUDE.md   # exactly one hit: services/xstockstrat-trading/CLAUDE.md, naming trading.broker.paper
grep -n "TRADING_MODE" docker-compose.yml .do/app.dev.yaml .do/app.yaml   # unchanged: paper / paper / live
```

---

### Step 34 — docs: `config-governance.md` marks the two retired keys

**Status**: `pending`
**Service**: `docs/patterns/`
**Files**:
- `docs/patterns/config-governance.md` — modify

**Reviewers**: none

**Codebase Evidence**:
- `grep -n "sparkline\|alpaca\.paper" docs/patterns/config-governance.md` → `:153-154` (feature 305 entry: both keys deleted, "no service reads"), `:311` ("`analysis.opportunity.sparkline_bars` is **inert** (no reader …)"), `:416` (feature-184 table row `| analysis.opportunity.sparkline_bars | int | 20 | [1,500] | Daily bar closes fetched per opportunity for the sparkline. get_int. |`), `:549-550` (feature 095 entry: "**Registers** `analysis.opportunity.sparkline_bars` … Read **live** at read-time enrichment via `get_int`").
- Out of bounds (feature 330, D-8): the `live_enrich_ttl_seconds` rows at `:422` and `:473`, and `scripts/config-wiring-stored.json`.
- Deleting migration: `services/xstockstrat-config/migrations/046_config_dead_rows_prune.up.sql:11-14`.

**TDD**: `N/A (docs)`

**Covers**: —

**Instructions**:
Edit only the four cited places (D-8):
1. `:416` — replace the row's description with "**Retired** — no reader; rows deleted by config
   migration `046` (feature 305)." and its bounds cell with `—`.
2. `:549-550` — prefix the feature 095 entry with "**Retired** (no reader since feature 227; rows
   deleted by config migration `046`, feature 305):" and put its "Read live…" sentence in the past tense.
3. `:311` — append "; its rows are deleted by config migration `046` (feature 305)" to the
   `sparkline_bars` clause, leaving the `live_enrich_ttl_seconds` half of the sentence untouched.
4. `:153-154` — re-read; it already says both keys are unread and deleted. Change it only if it names
   a remaining code reader that Steps 14 and 27 removed; otherwise leave it as is.
Do not touch `:422`, `:473` or any other row.

**Verification**:
```bash
grep -n "sparkline_bars" docs/patterns/config-governance.md   # every hit says inert / Retired / deleted; none says "Read live" or "get_int" in the present tense
git diff --stat -- docs/patterns/config-governance.md           # one file; the :422 and :473 rows are not in the diff
```

---

## Deviation Log

_Populated by /sdd-execute as implementation proceeds._
