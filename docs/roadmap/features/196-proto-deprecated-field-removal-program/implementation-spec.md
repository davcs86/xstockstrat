# Implementation Spec: proto-deprecated-field-removal-program

**Status**: `pending`
**Created**: 2026-09-19
**Feature**: `docs/roadmap/features/196-proto-deprecated-field-removal-program/feature.md`
**Total Steps**: 7
**Feature Branch**: `feature/proto-deprecated-field-removal-program`

---

## Execution Summary

The approved approach (`design.md`) is **response-edge omission**, not proto removal: every
`[deprecated = true]` field stays in the `.proto` (PROTO-2 intact — no `buf breaking`, no `reserved`,
no v1→v2, no BSR schema break) and only genuinely-dead fields stop being **populated** at pure
response edges, with the replacement `timeframe_enum` kept co-emitted. **All code-bearing steps are
GATED** on the per-field consumer-confirmation gate (Step 1), which cannot clear inside an execute
session because external BSR consumers exist and cannot be enumerated (`design.md` Open Risks;
`recon.md:76-78,108`). Step 1 is the blocking prerequisite; Steps 2–7 stay `blocked` until it is
recorded as cleared in `context.md`. **If the gate never clears, the shipped outcome is zero code
change** (equivalent to park) — that is an accepted design outcome, not a spec defect.

Ordering: the gate (Step 1) first; then the two omittable-field service changes with their paired
tests (marketdata Steps 2–3, ingest Steps 4–5); then the KEEP regression guard (Step 6) and the
proto-integrity / request-only-no-op verification (Step 7). Steps 6–7 ship in the same PR set as the
omissions so the guards land with the change they constrain — none ships ahead of the gate.

**Consumer surface (C-14):** the product spec marks this **None — internal/platform-only** (a
wire-contract change with no trader/analyst/operator-visible consequence). No UI/Agent implementation
step is required; the analysis GetBars reader, the `xstockstrat-ui` backfills page, and the agent
appear only as gate-audit **read** targets in Step 1 (confirm they read `timeframe_enum`, not the
string) — they are not modified. This is a decision, not an omission.

**Trading-domain note:** `is_paper` and the request-only `user_id` bodies are dead-field cleanup only
— **no paper-vs-live execution-behavior change** (feature 147 derives mode from environment; these
fields are request-only and server-ignored). No step touches order placement, `BrokerType`,
`OrderType`, or `OrderStatus`, so the trading-domain step constraints do not bind beyond Step 7's
no-op verification of `is_paper`.

## Scenario Coverage (Constitution C-15)

| Scenario | Covered by | Note |
|---|---|---|
| `@AC-1` @out-of-scope @rejected-removal | **no step (by design)** | Rejected removal+`reserved` path; retained append-only for provenance, maps to no FR (`product-spec.md:96-98,124-125`; `acceptance.feature:8-23`). |
| `@AC-4` @out-of-scope @rejected-removal | **no step (by design)** | Same — rejected enum removal path. |
| `@AC-2` (FR-1) | Step 6 | Watchlist.symbols KEEP — stays populated. |
| `@AC-3` (FR-6) | Step 7 | Deprecated enum values stay deprecated / out of scope. |
| `@AC-5` (FR-4) | Step 7 | Proto unchanged; `buf breaking` reports no change. |
| `@AC-6` (FR-3) | Step 5 | BackfillJob.timeframe omitted after gate; `timeframe_enum` kept. |
| `@AC-7` (FR-1) | Step 6 | AddWatchlistSymbols cap still reads `existing.Symbols`. |
| `@AC-8` (FR-2) | Step 3 | barFromAlpaca NOT an omission edge; GetBars/BatchGetBars still return rows. |
| `@AC-9` (FR-5) | Step 7 | Request-only dead fields need no change. |

`@AC-1`/`@AC-4` are the only uncovered scenarios and are deliberately so: they are tagged
`@out-of-scope @rejected-removal` in `acceptance.feature` and annotated in `product-spec.md` as the
provenance record of the rejected removal approach — not active requirements under the approved
omission design.

## Step Dependencies

- **Steps 2, 3, 4, 5, 6, 7 all require Step 1** (the FR-3 consumer-confirmation gate). Step 1 is a
  governance/human gate whose clearance is recorded in `context.md`; until then every downstream step
  stays `blocked`. This is the design's central constraint (`design.md:54-65,82-86`).
- Step 3 [test] covers Step 2 [service] (marketdata Bar.timeframe omission).
- Step 5 [test] covers Step 4 [service] (ingest BackfillJob.timeframe omission).
- Steps 6 and 7 are standalone guard/verification steps (no paired `service` step): Step 6 guards the
  KEEP decision, Step 7 verifies the proto is unchanged and the request-only fields are no-ops.
- The stream edge in Step 2 co-emits the **deprecated** `TIMEFRAME_1MIN` enum member
  (`stream.go:255`); omitting the string there forces consumers onto a deprecated enum value. This is
  an accepted Open Risk (`design.md:87-88`), noted so it is not read as a contradiction of FR-6.

---

### Step 1 — docs: FR-3 per-field consumer-confirmation gate (BLOCKING prerequisite for Steps 2–7)

**Status**: `blocked`
**Service**: `docs/` (governance gate; recorded in `context.md`)
**Files**:
- `docs/roadmap/features/196-proto-deprecated-field-removal-program/context.md` — modify (record the audit result, the BSR-window-closure announcement, and sign-off)

**Reviewers**: Proto Reviewer — deprecation-window closure + BSR publication readiness; Platform Lead
— external-consumer risk sign-off.
(Deliberate deviation from the matrix `docs → none`: this step is the governance crux of the feature
— proving no external/BSR reader still depends on the deprecated strings — so it carries the
Proto/Platform sign-off the omission steps rely on.)

**Codebase Evidence**:
- BSR publishing is live, so external consumers are presumed: `buf push` on every deploy — `recon.md:76-78`
  cites `deploy-prod.yml:28-31` (published) / `deploy-dev.yml:28-32` (draft); runbook
  `proto-versioning.md:95-100`.
- The named in-repo/consumer surfaces to re-confirm read `timeframe_enum`, not the string:
  - analysis GetBars reader and the `xstockstrat-ui` backfills page — the `timeframeEnum` bind is
    `services/xstockstrat-ui/src/app/insights/backfills/page.tsx:138` (`timeframeEnum: Timeframe.TIMEFRAME_1DAY`).
  - agent MCP tools that surface backfill/bar timeframe.
- The exact silent-break class this gate exists to prevent: `fails.md:168` (empty timeframe silently
  defaults to `"1d"`) and `fails.md:667` (TS reading a proto field by wrong casing → `undefined`, no error).

**TDD**: `N/A (governance gate — no code)`

**Covers**: `—`

**Instructions**:
1. For each GATED field — `marketdata Bar.timeframe` and `ingest BackfillJob.timeframe` — grep-confirm
   that **every** named consumer surface reads the replacement `timeframe_enum` and **not** the
   deprecated string: the analysis GetBars reader, the `xstockstrat-ui` backfills page
   (`services/xstockstrat-ui/src/app/insights/backfills/page.tsx`), and the agent's backfill/bar tools.
   Any consumer still reading the string is a **hard block** — do not proceed to that field's omission.
2. Formally announce the deprecation window (features 053/080/143) **closed** to BSR consumers per
   `docs/runbooks/proto-versioning.md` — the external half of the gate.
3. Record all three in `context.md`: the per-consumer grep results, the BSR-window-closure
   announcement, and explicit Proto Reviewer + Platform Lead sign-off. Only when this is recorded may
   Steps 2–7 move off `blocked`.
4. If the gate does not clear this session (the expected outcome — external consumers cannot be
   enumerated), stop here: the feature ships zero code change, which is an accepted park-equivalent
   outcome (`design.md:84-86`).

**Verification**:
`grep -n "timeframeEnum\|timeframe_enum" services/xstockstrat-ui/src/app/insights/backfills/page.tsx`
— confirm the consumer binds the enum; then confirm `context.md` contains the recorded sign-off block
(gate cleared) before any downstream step runs. No database or service is started.

---

### Step 2 — service: Omit deprecated `Bar.timeframe` string at the two pure response edges (marketdata)

**Status**: `blocked`
**Service**: `xstockstrat-marketdata`
**Files**:
- `services/xstockstrat-marketdata/internal/repository/marketdata_repo.go` — modify (`scanBars`, the DB→proto read edge)
- `services/xstockstrat-marketdata/internal/alpaca/stream.go` — modify (streamed-bar response edge)

**Reviewers**: `xstockstrat-marketdata` owner — OHLCV ingestion integrity, TimescaleDB hypertable
partitioning, Alpaca feed idempotency; Proto Reviewer — deprecated-field wire emission on the
BSR-published module (no field/type removal, deprecation-comment intact).

**Codebase Evidence**:
- Pure DB→proto read edge (omittable): `services/xstockstrat-marketdata/internal/repository/marketdata_repo.go:141`
  builds the `&marketdatav1.Bar{...}`; `:144` sets `Timeframe: tf` (with the SA1019 deprecation nolint);
  `:153` co-emits `TimeframeEnum: tfpkg.FromString(tf)`. Confirmed via
  `grep -n "bars = append\|Timeframe:\|TimeframeEnum:" .../marketdata_repo.go`.
- Streamed-bar response edge (omittable): `services/xstockstrat-marketdata/internal/alpaca/stream.go:247`
  sets `Timeframe: streamBarTimeframe` (const `"1m"` at `:26`); `:255` co-emits
  `TimeframeEnum: commonv1.Timeframe_TIMEFRAME_1MIN` (a **deprecated** enum member — accepted Open Risk).
- **EXCLUDE — do NOT touch** `services/xstockstrat-marketdata/internal/alpaca/client.go:142`
  (`barFromAlpaca`, `Timeframe: timeframe`, enum at `:143`): those `Bar`s flow into
  `InsertBars` (`marketdata_repo.go:48`), which reads `b.Timeframe` at `:71` to write the
  `marketdata.ohlcv.timeframe` column; `QueryBars` then filters `WHERE symbol=$1 AND timeframe=$2` at
  `:100`. Omitting here corrupts the store (`design.md:27-34`; `@AC-8`).

**TDD**: `red-green required`

**Covers**: `—` (paired test is Step 3)

**Instructions**:
1. At `marketdata_repo.go:144` (`scanBars`) stop populating the deprecated string field — leave the
   `Bar.Timeframe` assignment unset — while **keeping** the `TimeframeEnum: tfpkg.FromString(tf)`
   co-emission at `:153` unchanged. Keep or adjust the SA1019 nolint comment to reflect the omission.
2. At `stream.go:247` do the same — stop setting `Timeframe: streamBarTimeframe`, keep
   `TimeframeEnum: commonv1.Timeframe_TIMEFRAME_1MIN` at `:255`. Note in a ≤2-line comment that the
   string is intentionally omitted per feature 196 while the (deprecated) enum member is retained.
3. **Do not** modify `barFromAlpaca` (`client.go:142`) or `InsertBars` (`marketdata_repo.go:71`): that
   producer path feeds the `ohlcv.timeframe` DB column and is EXCLUDED. This is the C-10 "cover every
   producer path" completeness point — the two omittable edges change, the persistence edge stays.
4. `Timeframe` is a proto3 scalar `string`; leaving it unset serializes as empty — no proto change
   (FR-4). Do not add `reserved` or edit `packages/proto/marketdata/v1/marketdata.proto`.

**Verification**:
`cd services/xstockstrat-marketdata && GOWORK=off golangci-lint run --modules-download-mode=mod`
(lint/format gate) — and the behavioral assertions run in Step 3.

---

### Step 3 — test: marketdata Bar.timeframe omission + EXCLUDE / GetBars regression guard

**Status**: `blocked`
**Service**: `xstockstrat-marketdata`
**Files**:
- `services/xstockstrat-marketdata/internal/repository/marketdata_repo_test.go` — modify | create (assert `scanBars` output)
- `services/xstockstrat-marketdata/internal/alpaca/stream_test.go` — modify | create (assert streamed-bar output)

**Reviewers**: `xstockstrat-marketdata` owner — OHLCV ingestion integrity, Alpaca feed idempotency.

**Codebase Evidence**:
- Same edges as Step 2 (`marketdata_repo.go:141-153`, `stream.go:247-255`, EXCLUDE `client.go:142` +
  `InsertBars` `marketdata_repo.go:71`, `QueryBars` `:100`).
- C-13 (non-frontend test data): the `Bar` literal these tests build has a single consumer per test
  file — inline is compliant; do not create a Go `internal/testdata/` home speculatively (none exists).

**TDD**: `red-green required` (asserts the new omission; fails against the pre-Step-2 tree where
`Timeframe` is still populated)

**Covers**: `AC-8`

**Instructions**:
1. Assert that after Step 2, a `Bar` returned from `scanBars` and from the stream fan-out edge has an
   **empty** `Timeframe` string but a **populated** `TimeframeEnum` (`FromString(tf)` for scanBars;
   `TIMEFRAME_1MIN` for the stream).
2. Assert the EXCLUDE guard: a `Bar` built by `barFromAlpaca` (`client.go:137`) **still** sets
   `Timeframe` (non-empty) — the persistence edge is unchanged.
3. Assert the persistence round-trip is intact: an `InsertBars` → `QueryBars`/`QueryBarsBatch`
   (`marketdata_repo.go:85,356`) daily-bar query still returns rows (a 400-day GetBars / BatchGetBars
   analogue), proving `@AC-8`'s "daily-bar query still returns rows" — the string that feeds the DB
   column was not dropped.
4. Author the assertions to **fail first** (red) against the current tree (where `scanBars`/stream
   still populate `Timeframe`), passing only after Step 2.

**Verification**:
`cd services/xstockstrat-marketdata && GOWORK=off COVERPKGS=$(go list ./... | grep -Ev '/(cmd|handler|repository|telemetry|service)(/|$)' | tr '\n' ',' | sed 's/,$//') && go test ./... -race -count=1 -coverprofile=coverage.out -covermode=atomic -coverpkg="${COVERPKGS}" && go tool cover -func=coverage.out | grep "^total:"`
— confirm ≥ 40%. Note: the changed edges live in `repository/` and `alpaca/` — `repository/` is
excluded from CI coverage measurement, so the `alpaca` package carries the measured logic; if the
omission logic lands only in excluded packages, integration-style assertions in this step are the
verification (a `test` step is still required). Also run
`cd services/xstockstrat-marketdata && GOWORK=off golangci-lint run --modules-download-mode=mod`.

---

### Step 4 — service: Omit deprecated `BackfillJob.timeframe` string at `job_row_to_proto` (ingest)

**Status**: `blocked`
**Service**: `xstockstrat-ingest`
**Files**:
- `services/xstockstrat-ingest/app/handlers/servicer.py` — modify (`job_row_to_proto`)

**Reviewers**: `xstockstrat-ingest` owner — signal normalization correctness, idempotent ingestion,
newsletter source schema stability; Proto Reviewer — deprecated-field wire emission on the
BSR-published module.

**Codebase Evidence**:
- `services/xstockstrat-ingest/app/handlers/servicer.py:144` `def job_row_to_proto(row: dict)` builds
  the `BackfillJob`; `:149` sets `timeframe=row["timeframe"] or ""` (the deprecated string); `:152`
  co-emits `timeframe_enum=_STR_TO_ENUM.get(_row_timeframe(row["timeframe"] or ""), 0)`. Confirmed via
  `grep -n "def job_row_to_proto\|timeframe=row\|timeframe_enum=" .../servicer.py`.
- This is a pure DB-row→proto response edge (no persistence downstream of it), so it is the omittable
  edge; the request-side `timeframe` string is a separate live fallback and is out of scope (FR-5).

**TDD**: `red-green required`

**Covers**: `—` (paired test is Step 5)

**Instructions**:
1. In `job_row_to_proto` stop populating the deprecated `timeframe=` argument at `:149` (drop the
   keyword so the field defaults to empty) while **keeping** `timeframe_enum=` at `:152` unchanged.
2. Leave the request-side `timeframe` string handling elsewhere in `servicer.py` untouched — only the
   response serialization edge is omitted (FR-2/FR-5).
3. No proto change: `BackfillJob.timeframe` stays defined and deprecated in
   `packages/proto/ingest/v1/ingest.proto` (FR-4). Do not add `reserved`.

**Verification**:
`cd services/xstockstrat-ingest && ruff check . && ruff format --check .` (lint/format gate) — and the
behavioral assertion runs in Step 5.

---

### Step 5 — test: ingest BackfillJob.timeframe omission

**Status**: `blocked`
**Service**: `xstockstrat-ingest`
**Files**:
- `services/xstockstrat-ingest/tests/test_backfill_jobs.py` — modify (add a `job_row_to_proto` case asserting `timeframe` unset while `timeframe_enum` stays populated)

**Reviewers**: `xstockstrat-ingest` owner — signal normalization correctness, idempotent ingestion.

**Codebase Evidence**:
- Edge under test: `servicer.py:144,149,152` (as in Step 4).
- C-13: the row `dict` / expected-proto literal has one consumer in this test — inline is compliant;
  centralize into `tests/conftest.py` only if a second consumer appears (do not pre-build a home).

**TDD**: `red-green required` (fails against the pre-Step-4 tree where `timeframe` is still populated)

**Covers**: `AC-6`

**Instructions**:
1. Build a representative `ingest.backfill_jobs` row dict (e.g. `timeframe="15m"`) and call
   `job_row_to_proto(row)`.
2. Assert the returned `BackfillJob` has an **unset/empty** `timeframe` string **and** a **populated**
   `timeframe_enum` (the `_STR_TO_ENUM` mapping of `"15m"`), exactly as `@AC-6` requires.
3. Author the assertion to **fail first** (red) against the current tree (where `timeframe` is
   populated), passing only after Step 4.

**Verification**:
`cd services/xstockstrat-ingest && pytest --cov=app --cov-fail-under=40` — confirm the threshold
passes. Also run `cd services/xstockstrat-ingest && ruff check . && ruff format --check .`.

---

### Step 6 — test: KEEP-field regression guard (portfolio Watchlist.symbols)

**Status**: `blocked`
**Service**: `xstockstrat-portfolio`
**Files**:
- `services/xstockstrat-portfolio/internal/service/portfolio_service_test.go` — modify | create

**Reviewers**: `xstockstrat-portfolio` owner — P&L calculation accuracy, position snapshot
consistency, concurrent write safety.

**Codebase Evidence**:
- Live in-repo reader (KEEP): `services/xstockstrat-portfolio/internal/service/portfolio_service.go:1691`
  — `AddWatchlistSymbols` (`:1678`) derives the per-list cap from `existing.Symbols` (with the SA1019
  nolint noting the deprecated mirror is intentionally retained for old clients, feature 097).
  Confirmed via `grep -n "existing.Symbols\|func.*AddWatchlistSymbols" .../portfolio_service.go`.
- Second live reader (cross-service): `services/xstockstrat-analysis/app/engine/live_loop.py:525`
  (`out.update(_normalize_symbol(s) for s in wl.symbols)` legacy-row fallback). Confirmed via
  `grep -n "wl.symbols" .../live_loop.py`.
- C-13: inline test literal, single consumer — compliant; no `internal/testdata/` home needed.

**TDD**: `red-green required` (a guard that would fail if a future change omitted `Watchlist.symbols`)

**Covers**: `AC-2, AC-7`

**Instructions**:
1. Assert `Watchlist.symbols` **stays populated** in the responses that carry it — i.e. it is a KEEP
   field, never omitted (`@AC-2`).
2. Assert `AddWatchlistSymbols`' per-list cap still enforces from `existing.Symbols`
   (`portfolio_service.go:1691`), proving the reader is unaffected (`@AC-7`).
3. This guard exists to prevent the omission work in Steps 2/4 from over-reaching to a load-bearing
   field; it ships with the omission PR set, not ahead of the gate.

**Verification**:
`cd services/xstockstrat-portfolio && GOWORK=off COVERPKGS=$(go list ./... | grep -Ev '/(cmd|handler|repository|telemetry|service)(/|$)' | tr '\n' ',' | sed 's/,$//') && go test ./... -race -count=1 -coverprofile=coverage.out -covermode=atomic -coverpkg="${COVERPKGS}" && go tool cover -func=coverage.out | grep "^total:"`
— confirm ≥ 40% (the reader is in `service/`, a CI-excluded package, so this is an integration-style
guard; a `test` step is still required). Also run
`cd services/xstockstrat-portfolio && GOWORK=off golangci-lint run --modules-download-mode=mod`.

---

### Step 7 — test: proto-integrity, enum-retention, and request-only no-op verification

**Status**: `blocked`
**Service**: `packages/proto` (+ cross-service verification)
**Files**:
- (verification only — no source file modified)

**Reviewers**: Proto Reviewer — field number uniqueness, no breaking change, no field/enum removal, no
`reserved`, `buf breaking` clean; `xstockstrat-marketdata`, `xstockstrat-ingest`,
`xstockstrat-portfolio` owners — confirm no wire field they own was removed.

**Codebase Evidence**:
- No `.proto` file is edited by this feature (FR-4): the omissions in Steps 2/4 leave scalar fields
  unset at serialization; the `.proto` definitions are unchanged. Recon confirms no `reserved` is used
  anywhere in the repo (`recon.md:49-51`) and PROTO-2 is deprecate-don't-delete
  (`packages/proto/docs/context-constitution.md:20`).
- Request-only dead fields already server-ignored (FR-5 / `@AC-9`), header-authoritative identity:
  trading `user_id`×4 + `is_paper` — `recon.md:19` (`trading/internal/middleware/propagation.go:36`;
  `internal/service/trading.go:390,444,857,1125,1264`; `is_paper` `:2248,2258`); portfolio `user_id`×5
  (`recon.md:23`, `internal/service/portfolio_service.go:478` — no body-`user_id` reader); analysis
  `ListStrategiesRequest.user_id` (`recon.md:30`, `app/handlers/servicer.py:533`); ingest deprecated
  `operation` string is a live fallback and stays (out of scope, `recon.md:34-36`).
- Deprecated enum members stay deprecated (FR-6 / `@AC-3`): `TIMEFRAME_*` (`common.proto`;
  `TIMEFRAME_1MIN` actively written `stream.go:255`), `ENVIRONMENT_DEV` (wire value 1,
  `configServiceImpl.ts:28-29`), `VALUE_TYPE_FLOAT_MAP` — none removed or per-message unset.

**TDD**: `N/A (verification only — no code change; enforces the proto stays untouched)`

**Covers**: `AC-3, AC-5, AC-9`

**Instructions**:
1. **Proto unchanged (`@AC-5`, FR-4):** confirm no `packages/proto/**/*.proto` field or enum value was
   removed and no `reserved` statement added; confirm `packages/proto/gen/` is unchanged (no codegen
   diff). This is the guard that the omission approach touched **no** schema.
2. **Enum retention (`@AC-3`, FR-6):** confirm the deprecated enum members
   (`TIMEFRAME_1MIN/_15MIN/_1HOUR`, `ENVIRONMENT_DEV`, `VALUE_TYPE_FLOAT_MAP`) remain defined and
   `[deprecated = true]` — neither removed nor per-message unset.
3. **Request-only no-op (`@AC-9`, FR-5):** confirm the request-only dead fields (the 10 `user_id`
   bodies, `is_paper`, the deprecated `operation` string) are resolved header/env-authoritatively and
   never appear in any response — so "omit from responses" is a literal no-op requiring no code change.
   This includes the trading-domain confirmation that `is_paper` drives **no** paper-vs-live behavior
   (feature 147 env-derived).

**Verification** (all offline — no database, no service started):
- `cd packages/proto && buf lint && buf breaking --against ".git#branch=feature/proto-deprecated-field-removal-program"`
  — confirm **no** breaking change reported.
- `git diff --exit-code packages/proto/marketdata/v1/marketdata.proto packages/proto/ingest/v1/ingest.proto packages/proto/common/v1/common.proto packages/proto/portfolio/v1/portfolio.proto`
  and `git diff --exit-code packages/proto/gen/` — both empty (no `.proto` or generated-stub change).
- `grep -n "x-user-id\|UserID: first" services/xstockstrat-trading/internal/middleware/propagation.go`
  — confirm header-authoritative identity (request-body `user_id` unread), evidencing `@AC-9`.

---

## Deviation Log

_Populated by /sdd-execute as implementation proceeds._
