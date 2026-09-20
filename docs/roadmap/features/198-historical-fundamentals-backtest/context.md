# Context: historical-fundamentals-backtest

**Feature**: `docs/roadmap/features/198-historical-fundamentals-backtest/feature.md`
**Product Spec**: `docs/roadmap/features/198-historical-fundamentals-backtest/product-spec.md`
**Implementation Spec**: `docs/roadmap/features/198-historical-fundamentals-backtest/implementation-spec.md`

---

## Session 2026-09-20 — sdd-story

- Created feature.md (status: draft), product-spec.md, acceptance.feature, context.md from the user story.

### Grounding done before writing (recon summary — carried into design)
- **Current state:** fundamentals exist ONLY as a latest-snapshot cache (`marketdata.fundamentals`,
  PK `symbol`, one row per symbol, feature 059). Backtest (`xstockstrat-analysis.RunBacktest`) is
  technical-only — reads OHLCV bars + indicators (+ optional signals); no fundamental operand, no
  fundamentals read. Backfill (`ingest.TriggerBackfill` → `marketdata.BackfillBars`) is OHLCV-only
  and hard-restricted to `1d` (feature 143). This feature is greenfield on storage/backfill/
  backtest-read; additive on proto.
- **Wired vendors:** FMP + Finnhub credentials already exist as feature-147 encrypted config rows
  with a `marketdata` `GetSecret` grant; a `marketdata.fundamentals.provider` selector (`finnhub`|
  `fmp`) already picks the snapshot provider. Alpaca = bars only.

### Decisions (from user, this session — 4 AskUserQuestion rounds)
1. **Scope:** full end-to-end in one feature (storage + backfill + backtest fundamental operand).
2. **Point-in-time:** filing-date-aware — store `period_end` + `filed_date`/`accepted_date`; the
   backtest sees a value only from its `filed_date` forward. This is the look-ahead-bias guard.
3. **Periodicity:** quarterly + annual.
4. **Data source — REVISED after a user question.** Initial proposal was "FMP primary + Finnhub
   fallback" (both already wired → lowest rework). User then disclosed they hold **only FMP Free**.
   Verified FMP Free limits (web, 2026): **250 req/day**, **~5yr annual / ~5–8 quarters** history,
   US-only, as-reported/`acceptedDate` depth + bulk endpoints paid-gated. Free FMP is therefore
   **insufficient** for a universe-scale, deep-history, filing-date-aware backfill. User chose:
   **SEC EDGAR primary + FMP Free ratios** — EDGAR (XBRL `companyfacts`/`frames`, no API key, SEC
   `filed` date = gold-standard point-in-time, US-only) is the as-reported base of record; FMP Free
   enriches derived ratios opportunistically within its 250/day cap (graceful degradation).
   EDGAR needs only a fair-use `User-Agent` (non-secret config, no `GetSecret`); FMP reuses the
   feature-147 credential → **no new secret/credential row** (avoids the feature-129 deploy-wiring
   scope-creep by design).

### Known traps folded in from the Ledger (see product-spec Open Questions)
- Look-ahead bias is `xstockstrat-analysis`'s named reviewer focus → FR-5 as-of read + a RED test.
- Backfill data-kind vs timeframe (ledger `080`, feature 143) → new `BackfillDataKind` axis, default
  `BARS`, never a timeframe value.
- Vendor literal-string / credential wiring (ledger `129`) → EDGAR keyless + FMP reuse sidesteps it;
  still grep the provider-selection literals in `marketdata_service.go`.
- Agent descriptor-parity projections + strat-lab `backtest` skill (ledger `134`, root CLAUDE.md) →
  update in the same PR for any `run_backtest`/projected-message change.
- No fragile full-stack `grpcurl` smoke test (ledger `129`) → narrow direct-API check + fakes.
- `ls migrations/` before writing any migration NNN (ledger `durable-observable-backfills`).

### Cross-feature seams to hold (no collision)
- 032 regime-segmented backtest (draft) — keep the evaluator operand seam composable.
- 065 second OHLCV vendor (idea) — unrelated (OHLCV, not fundamentals).
- 189 screener presets (design-approved) — reads the snapshot, not this history store; additive.

### Next
- `/sdd-review historical-fundamentals-backtest product-spec`, then `/sdd-design ... quick`
  (mandatory SDD grounding before any code — root CLAUDE.md entry point / Constitution C-11).

## Session 2026-09-20 — sdd-review product-spec

- Product spec approved. Status: draft → spec-ready (re-reviewed PASS 11/11 after fixes).
- Blocker fixed: criterion 9 (Open Questions) — reframed so no unresolved `- [ ]` remains; the
  genuine product-scope fork (v1 symbol universe) resolved.
- Warnings fixed: stale ingest migration NNN (006 → verified 012; marketdata 005 confirmed);
  explicit up/down pairing stated; FMP daily-cap overlap reconciled (single shared
  `marketdata.fmp.daily_request_cap`, no second cap).
- Decisions recorded in product-spec:
  - v1 universe = operator-supplied `TriggerBackfill.symbols`; default = feature-168 fundamentals
    universe. FMP-Free 250/day cap bounds only the optional ratio-enrichment pass, not the EDGAR base.
  - Design-deferred (for /sdd-design): D-1 partition key (`filed_date` vs `period_end`), D-2 EDGAR
    XBRL → metric mapping, D-3 032 evaluator/proto seam.
- Overlap findings: WARN-only — 198 & 032 both edit `analysis/v1/analysis.proto` (distinct messages,
  both draft; no field-number clash). Trunk 150/151 occupy `BacktestResult` 17–20 /
  `RunBacktestRequest` 8–9 → 198's additive fields start after those. No FAIL collision; no
  `merge-order.md` entry required now (revisit if 032 & 198 hit impl-spec concurrently).

## Session 2026-09-20 — sdd-design (quick)

- Phase 0 Recon: wrote recon.md (6 parallel agents: marketdata/ingest/analysis/agent/ui discovery +
  scenario-recon C-16 scan). Key reuse patterns: feature-152 `source_symbol` operand seam
  (`evaluator._assemble_component_series:368`); plain-table snapshot precedent; `GetSecret` for FMP key.
- Phase 1 Grilling: 1 round (quick). Proposer = separate-lane PIT design; adversary = NEEDS WORK (no
  Floor breach) with 3 HIGH holes. Synthesis + 3 user forks resolved → design.md approved.

### Chosen approach (design.md)
- **Storage:** plain table `marketdata.fundamentals_history`, PK `(symbol,fiscal_period,period_type)`,
  `filed_date`/`accepted_date`/`period_end` cols, `ON CONFLICT DO NOTHING` (keep earliest filing).
  NOT a hypertable (adversary C-18/ledger-153; read filters `period_end`, ~200k rows).
- **Source:** separate `HistoricalFundamentalsSource` + `internal/edgar` client (keyless, non-secret
  UA); EDGAR **never** in the `marketdata.fundamentals.provider` switch (preserves feature-154 FMP-cap gate).
- **Backfill:** `BackfillDataKind{UNSPECIFIED=0,BARS=1,FUNDAMENTALS=2}` (C-04 sentinel; servicer maps
  UNSPECIFIED→BARS), branch before the `1d` reject → new `marketdata.BackfillFundamentals` worker.
- **Operand:** `COMPONENT_KIND_FUNDAMENTAL=3` in the shared `_assemble_component_series`; carry-forward
  as-of join (distinct from feature-152 none-on-miss); resolves in backtest AND live.

### User decisions (this session — AskUserQuestion, the design forks)
1. **PIT price-join** for `pe_ratio`/`market_cap` = adjusted close at `filed_date` (from OHLCV) ÷ EPS /
   × shares (from filing). FMP `ratios-ttm` never used for historical rows (look-ahead).
2. **Full live parity** — operand threads through the shared evaluator (backtest + live/readiness/opportunities).
3. **T+1 availability** — `filed_date < bar_date` (filing usable the day AFTER filing; SEC post-close
   accepts). **Reworded @AC-3/@AC-4** in acceptance.feature (same-day → T+1). This is the user sign-off
   for the acceptance change; not yet promoted to a durable suite, so no C-16 amendment.

### Adversary fixes folded in (accepted corrections)
- Plain table over hypertable; C-04 enum sentinel; **dedicated FMP-enrichment cap** (not the
  provider-dispatched `fundamentalsQuota()`, which returns the wrong cap under default `finnhub` and
  counts the snapshot table — AC-5 correctness); carry-forward documented as distinct from the 152
  join; bounded per-symbol fan-out; strat-lab skill same PR.

### Constitution: no Floor breach. C-16: PRESERVE/EXTEND only (operand added beside source_symbol) →
  no durable-rule CHANGE, no C-16 sign-off. Status: spec-ready → design-approved.

## Open Threads (from design.md Open Risks — resolve at /sdd-spec/execute)
- [ ] D-2 EDGAR XBRL tag → `_FUNDAMENTAL_FIELDS` mapping depth — marketdata step.
- [ ] EDGAR `filed_date` earliest-per-period determinism — validate in backfill tests.
- [ ] T-1 RED test must probe the T+1 boundary (filed D invisible on bar D, visible D+1) + between-filings gap.
- [ ] Price-join coverage: missing OHLCV at filed_date → null metric (fail-closed), not crash.
- [ ] 032 seam: keep operand in StrategyComponent/_assemble_component_series; pre-assign proto field #s if concurrent.

## Session 2026-09-20 — sdd-spec

- Generated implementation-spec.md with 17 steps. Status `design-approved` → `implementation-ready`.
- Slice order: proto (1) → proto-gen (2) → marketdata migration 005 + service + tests + config (3-6)
  → ingest migration 012 + service + tests (7-9) → analysis operand + tests + config (10-12) → agent
  + tests (13-14) → UI + e2e (15-16) → docs/teardown (17). All 8 `@AC-*` scenarios traced to steps
  (coverage table in Execution Summary); both named consumer surfaces (Agent + `/insights` UI) earn steps.
- Key codebase findings (verified `path:line`, load-bearing for the proto step):
  - `ingest.proto` `TriggerBackfillRequest` max field = 6 (`fill_mode`, `:69`) → `data_kind = 7`;
    `BackfillJob` max = 14 (`:42`) → `data_kind = 15`.
  - `analysis.proto` `ComponentKind` {0,1,2} (`:301-305`) → `COMPONENT_KIND_FUNDAMENTAL = 3`;
    `StrategyComponent` max = 6 (`source_symbol`, `:316`) → `fundamental_metric = 7`. `RunBacktestRequest`
    max = 9 and `BacktestResult` max = 20 are BOTH left untouched (design §5: @AC-8 reads existing shape).
  - `marketdata.proto` snapshot `Fundamentals` max = 18 (`:220`) untouched; no historical RPCs exist —
    new `HistoricalFundamentalsPeriod` + `GetHistoricalFundamentals` + `BackfillFundamentals` are greenfield.
  - Migration tips confirmed: marketdata `004` → next `005`; ingest `011` → next `012`.
  - Evaluator seams: `_compute_component` `evaluator.py:276`, `_assemble_component_series` `:368`,
    `_bar_date` `:34` (T+1 enforced here: `filed_date < bar_date`). Metric allow-list `_FUNDAMENTAL_FIELDS`
    `screener.py:40` + `_validate_fundamental_metrics` `:377`.
  - ingest 1d reject at `servicer.py:236-240` (branch point is BEFORE it); `_propagation_meta` `:213`;
    `_UPDATABLE_COLUMNS` `backfill_jobs.py:13`; shared `job_row` fixture `tests/_helpers.py:53` (15→16 cols).
  - marketdata provider selector is boot-only `newFundamentalsSource` `main.go:185` — EDGAR stays OUT of
    it (T-3; preserves @AC-6/@AC-9 feature-154). FMP cap `marketdata.fmp.daily_request_cap`
    `marketdata_service.go:1373` reused (no second cap); dedicated enrichment counter.
  - agent: `_build_component` `client.py:639` (kind_map `:645`, ValueError `:650`); `trigger_backfill`
    client `:1606`/tool `tools.py:1078`; `run_backtest` tool `tools.py:534`; `get_strategy` projects via
    `MessageToDict(always_print_fields_with_no_presence=True)` `:915-921` (new fields auto-project);
    strat-lab skill `plugins/strat-lab/skills/backtest/{SKILL.md,reference/backfill.md}` same-PR (ledger-134).
  - UI: backfills `page.tsx:135-141` hardcodes `TIMEFRAME_1DAY` (no selector today); `ComponentEditor.tsx`
    `ComponentKind` Select `:103-106`; `/insights/backfills` in `NAV_GROUPS` not `PLATFORM_SUBNAV` (no C-10(a)).
- Reviewers snapshot finalized in feature.md (8 distinct roles: Proto Reviewer, DBA, marketdata/ingest/
  analysis/agent/ui/config owners). Next: `/sdd-review historical-fundamentals-backtest impl-spec`.

## Session 2026-09-20 — sdd-review impl-spec (advisory)

- Result: 0 failures, 2 warnings, 1 note (advisory — did not block). Overall PASS WITH WARNINGS.
  Overlap scan: CLEAN — no FAIL-level collision (marketdata migration 005, ingest 012, all proto
  field numbers, and all new config keys verified free/unclaimed).
- Unresolved ⚠ carried into execution (address at the cited step):
  - Step 14 (C-08): agent test uses bare `pytest -q` and claims "no coverage threshold", but
    `services/xstockstrat-agent/CLAUDE.md` documents a CI-enforced `pytest --cov=app --cov-fail-under=40`
    (feature 065). Use `pytest --cov=app --cov-fail-under=40` to match the real gate. — [x] resolved
    (pre-execution spec edit 2026-09-20: Step 14 verification now uses `--cov-fail-under=40`).
  - Step 1 (C-09): the new `HistoricalFundamentalsPeriod` proto message leaves its reused metric
    fields (numbers ≥7) without explicit field numbers ("mirroring Fundamentals"). Assign explicit
    numbers at execution rather than inferring. — [x] resolved (pre-execution spec edit 2026-09-20:
    Step 1 instruction 3 now assigns explicit numbers 7–21).
  - Step 2 (NOTE, non-blocking): `Files: packages/proto/gen/**` wildcard is acceptable for mechanical
    codegen; no action.
- Overlap findings (WARN-level shared files — rebase/reconcile only, no merge-order row required):
  ingest `servicer.py` + marketdata `marketdata_repo.go` with feature 196; agent `client.py`/`tools.py`
  + `e2e/mock-backend.ts` + `e2e/fixtures/INVENTORY.md` with features 187/188. Later-landing feature reconciles.

## Session 2026-09-20 — sdd-execute (sequential)

- Mode-entry confirmed; user directive: run through checkpoints, **stop only at blockers**, one
  integration PR (#1158) at end. Branch reconciliation: dev-branch = claude/historical-fundamentals-backtest-tj92kd
  (harness-assigned; holds authoritative spec). Tooling: dockerd started (29.3.1); buf 1.72.0 installed
  on PATH; go 1.27, ruff, uv, node 22, pnpm 9.15.9, golangci 2.5 present. Python host is 3.11 (CI target 3.13).

### Step 1 — proto: additive fundamentals contracts [done]
- Added (additive-only): ingest `BackfillDataKind{UNSPECIFIED=0,BARS=1,FUNDAMENTALS=2}` enum +
  `TriggerBackfillRequest.data_kind=7` + `BackfillJob.data_kind=15`; analysis
  `ComponentKind.COMPONENT_KIND_FUNDAMENTAL=3` + `StrategyComponent.fundamental_metric=7`; marketdata
  `HistoricalFundamentalsPeriod` (fields 1-21) + `GetHistoricalFundamentals` + `BackfillFundamentals`
  RPCs and their request/response messages. Snapshot `Fundamentals`, `RunBacktestRequest`,
  `BacktestResult` untouched.
- Verification: `buf lint` clean; `buf breaking packages/proto --against .git#branch=main-dev,subdir=packages/proto`
  clean (exit 0 — additive only). TDD: N/A (proto contract).
- Files modified: `packages/proto/{ingest,analysis,marketdata}/v1/*.proto`.
- Deviations: none.
