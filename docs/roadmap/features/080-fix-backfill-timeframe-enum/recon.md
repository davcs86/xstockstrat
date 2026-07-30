# Recon: fix-backfill-timeframe-enum

**Created**: 2026-07-29
**From**: product-spec.md
**Affected services**: xstockstrat-ingest (Python), xstockstrat-marketdata (Go), xstockstrat-ui (Next.js/TS)

---

## Objective

Close a whole defect family in one pass: every place the platform **produces** a message carrying the
deprecated `timeframe` string next to its `timeframe_enum` replacement, only the string is populated.
The enum is derived from the string (never stored), so no proto, migration, or config change is
needed — only producers change, additively, with paired string+enum assertions so the gap cannot
reopen silently.

## Codebase Map

- **`xstockstrat-ingest`** (Python 3.12)
  - Servicer: `app/handlers/servicer.py`
  - Mapper under fix: `job_row_to_proto` — `servicer.py:70`; sets the string at `:75`, never the enum
  - Its **three** call sites: `GetBackfillStatus` `servicer.py:513`, `ListBackfillJobs` `:539`,
    `CancelBackfill` `:583` (matches AC-1)
  - Timeframe maps: `_STR_TO_ENUM` `:35`, `_ENUM_TO_STR` `:36`, `_TF_ALIASES` `:37-44`
  - Dead read (FR-4): `_resume_job` `:403`; `enum = row.get("timeframe_enum") or 0` `:407`;
    the `_ENUM_TO_STR` fallback chain `:408-410`. Sole caller `resume_incomplete_jobs` `:400`
  - Repo (read-only for this feature): `backfill_jobs.py` — `insert_job:28` inserts 6 columns
    (`:41`), `get_job:73` / `list_jobs:109` are `SELECT *` → mapper input keys **are** the DDL columns
  - Last migration: `007_signal_source_type_mediated.up.sql` (`services/xstockstrat-ingest/migrations/`)
  - Tests: `tests/test_ingest_servicer.py` — fixture `_job_row:66`, offending mutation `:506`
  - CI: `.github/workflows/ci.yml:337-339` — coverage threshold **40**, `cov_source: app`

- **`xstockstrat-marketdata`** (Go 1.25)
  - `Bar` construction — **exactly four** sites, repo-wide sweep confirmed:
    DB read `internal/repository/marketdata_repo.go:112` (string at `:115`, from scanned col `:109`);
    Alpaca single `internal/alpaca/client.go:199` (`:203`); Alpaca multi `client.go:305` (`:309`);
    WS stream `internal/alpaca/stream.go:255` (`:259`)
  - `client.go:270` (`map[string][]*marketdatav1.Bar{}`) is an empty map literal, **not** a site
  - Vocabulary package: `internal/timeframe/timeframe.go` — `ToCanonical:25`, `Interval:43`,
    `FromString:59`, `Resolve:76`, `ComputeGaps:99`. Deps: stdlib + `commonv1` only → no cycle risk
  - `streamBarTimeframe = "1m"` `stream.go:28` (rationale `:23-27`); **only** reader is `:259`
  - Only `TimeframeEnum` reference in the whole service: `internal/service/marketdata_service.go:120`
    (`timeframe.Resolve(req.GetTimeframeEnum(), legacyTf)` — request side)
  - Last migration: `002_fundamentals` — untouched
  - CI: `ci.yml:199-200` threshold **40**; `ci.yml:241` **excludes** `cmd|handler|repository|telemetry|service`
    from `COVERPKGS`; lint golangci-lint v2.5.0 with `staticcheck` enabled (`.golangci.yml:7`)

- **`xstockstrat-ui`** (Next.js / TS)
  - DRY home for the chart timeframe vocabulary: `src/lib/chart.ts` — `Timeframe` union `:9`,
    `TIMEFRAMES` `:11-15`, `mapBars` `:36`. **Zero import statements today** (`RawBar:26-33` is
    structural, not a generated type)
  - Its only two importers are the two senders: `ChartPanel.tsx:9`, `insights/market/[symbol]/page.tsx:11`
  - The two senders: `ChartPanel.tsx:56-60` (field goes at `:58`, beside `timeframe: tf`; `tf` is
    `fetchBars`'s param `:51`) and `insights/market/[symbol]/page.tsx:32`
  - Vitest: `vitest.config.ts` — `environment: 'node'` `:9`, `include: ['src/**/*.test.ts']` `:10`,
    coverage `include: ['src/lib/**']` `:15`, thresholds **40** `:24-28`. `chart.ts` is in scope
  - CI: `ci.yml:556-559` `node-test` threshold 40 (`pnpm run test:coverage`); `ci.yml:402,422-424` lint

## Patterns to REUSE

- **ingest string→enum** → reuse `_STR_TO_ENUM` `servicer.py:35` **after** `_TF_ALIASES` `:37-44`;
  the `.get(…, 0)` degradation idiom already exists at `servicer.py:257`. Do not add a third map.
- **marketdata string→enum** → reuse `timeframe.FromString` `internal/timeframe/timeframe.go:59`.
  It is the package built to fix exactly this "1Day vs 1d" class of bug (**MARKETDATA-1**).
- **One builder, not a copy per path** → ledger insight 2026-07-09 (`backtest-debug-info`): *"a
  cross-path per-item transform gets one builder, not a copy per path."* marketdata has four `Bar`
  sites; a repeated `TimeframeEnum:` line at each is the jscpd-visible shape that insight warns about.
  Weigh a shared constructor helper in the grilling round.
- **UI enum import aliasing** → `src/hooks/useOrders.ts:3` (`TradingMode as PbTradingMode`);
  also `usePortfolio.ts:3`, `components/trader/OrderForm.tsx:8`
- **UI unit test importing generated proto types under vitest** → `src/lib/equityCurve.test.ts:1-3`
  proves it works; `src/lib/protoTime.test.ts` is the simpler pure-logic shape
- **Deprecated-symbol suppression in Go** → `internal/timeframe/timeframe_test.go:67` and
  `internal/alpaca/client_test.go:359` already carry `//nolint:staticcheck // SA1019`

## Dependencies

- Proto/RPC: **no change.** Both fields exist on both messages — `ingest.proto:30,39`
  (highest `BackfillJob` field in use is 14 at `:41`); `marketdata.proto:55,57`. Enum values from
  `common.proto:77-83` (`1MIN=1 [deprecated]`, `1HOUR=3`, `1DAY=4`, `15MIN=5`)
- Migration: **none.** (Next free would be `008` for ingest, `003` for marketdata — neither is used.)
- Config keys: none. `ingest.backfill.default_timeframe` is documented but unwired
  (`services/xstockstrat-ingest/CLAUDE.md:68`) and is read by none of these paths
- Inter-service edges: unchanged
- New env vars / ports: none

## Risks / Not-found

1. **Go identifier shadowing — blocks compilation if written naively.** `timeframe` is already a
   parameter/local name at every target site: `client.go:161,268`, `marketdata_repo.go:73,143,166,187`,
   `internal/source/source.go:15,18,27`. Importing the package as `timeframe` inside those functions
   is shadowed. Needs an import alias (e.g. `tfpkg`) or a param rename.
   `internal/service/marketdata_service.go:642,711` has the same collision and survives only because
   those functions never call the package.
2. **`internal/repository` does not import `commonv1`** (imports at `marketdata_repo.go:3-16` are
   `marketdatav1` + `internal/source` only) — must be added. `internal/alpaca/client.go:18` already
   has it; `stream.go:3-15` does not.
3. **No in-package test file exists in `internal/alpaca`.** `client_test.go:1` is `package alpaca_test`
   (external), so it cannot reach `dispatch` or `streamBarTimeframe`. AC-7 needs a **new**
   `package alpaca` test file. There is no `stream_test.go` at all.
4. **The marketdata DB-site fix earns zero coverage.** `ci.yml:241` excludes `repository` (and
   `service`, `cmd`, `handler`) from `COVERPKGS`; `alpaca` and `timeframe` are inside the measured
   set. A repository-level test is still worth writing, but it cannot be justified by the coverage gate.
5. **A duplicated fixture the product spec does not name.** `tests/test_cancel_backfill.py:33` holds a
   byte-identical `_job_row` (minus docstring), used at `:75,76,99` to drive `CancelBackfill` — one of
   the three AC-1 read paths. AC-4 names only `test_ingest_servicer.py`. Two copies is also a DRY
   guard-rail talking point.
6. **Product-spec inaccuracy to correct in the impl spec (P-03).** FR-8 claims
   `insights/backfills/page.tsx:18` already aliases the enum import. It does not — `:18` is a bare
   `import { Timeframe } from '@xstockstrat/proto/common/v1/common_pb';`. The real precedent is
   `useOrders.ts:3`. The name clash is *introduced* by this feature, inside `chart.ts` itself.
7. **No read-path assertion exists anywhere today**, in either backend service. ingest: every
   `timeframe` hit under `tests/` is fixture/request *input*; `TestGetBackfillStatus.test_returns_job_when_found`
   (`test_ingest_servicer.py:138-145`) asserts only `job_id` and `status`. marketdata: `TimeframeEnum`
   appears in **zero** Go tests repo-wide. This is the concrete AC-5 red-before-green evidence, and it
   is *why* the family survived review.
8. **`MARKETDATA-2` is adjacent to FR-6 and must not be disturbed**
   (`services/xstockstrat-marketdata/docs/context-constitution.md`): streamed bars carry `1m` and must
   **not** be persisted. FR-6 changes only the label, never the persistence decision — but a reader who
   sees a real enum on a streamed bar may conclude it is now storable. The comment must say otherwise.
9. **`services/xstockstrat-ingest/docs/context-constitution.md:23`** records the deliberate 1m/5m
   omission from `_STR_TO_ENUM`, citing `servicer.py:32-35`. Any edit near those maps must keep that
   doc true.
10. **Applicable `fails.md` traps**: 2026-07-01 `056-open-positions-ui` (**C-10(b)** — one read path
    fixed, the sibling left behind: this feature *is* that shape, three times over) and 2026-07-21
    `fix-custom-formula-allnone` (**C-10(a/d)** — enum work is never "backend-only"; grep the TS
    consumers, which is how the UI half entered scope).
11. **e2e cannot observe FR-8.** `e2e/mock-backend.ts:306`'s `getBars` handler takes no request
    argument, so it cannot assert the new field. AC-8 is a vitest-level guarantee, not a Playwright one.
12. **Not centralized (C-12)**: OHLCV bars are inline in `e2e/mock-backend.ts` per
    `e2e/fixtures/INVENTORY.md:47`. A pure-vitest AC-8 test needs no fixture; only an e2e assertion
    would trigger the inventory rule.

## Recommended Scope

Advisory step boundaries — three service slices, each independently shippable, plus a docs touch:

1. **ingest — service**: `_row_timeframe`-style helper + `job_row_to_proto` enum + `_resume_job`
   dead-read deletion (FR-1–FR-4).
2. **ingest — test**: paired assertions over all three read paths; de-duplicate or reconcile the
   second `_job_row` (Risk 5); remove the impossible fixture key (AC-4).
3. **marketdata — service**: the four `Bar` sites, resolving the shadowing problem (Risk 1) and the
   one-builder-vs-four-lines question (FR-5–FR-7).
4. **marketdata — test**: extend `client_test.go:359` to a paired assertion (AC-6); new in-package
   `stream_test.go` for the streamed-bar label (AC-7, Risk 3).
5. **ui**: the map in `chart.ts` + both senders + `src/lib/chart.test.ts` (FR-8, AC-8).

Ordering is unconstrained — the three services share no artifact. `ui` is the only slice with a build
gate (`tsc`) that can fail on the others' behalf, and it does not depend on them because no proto
regeneration occurs.
