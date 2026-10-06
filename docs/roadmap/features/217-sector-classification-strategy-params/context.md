# Context: sector-classification-strategy-params

**Feature**: `docs/roadmap/features/217-sector-classification-strategy-params/feature.md`
**Product Spec**: `docs/roadmap/features/217-sector-classification-strategy-params/product-spec.md`
**Implementation Spec**: `docs/roadmap/features/217-sector-classification-strategy-params/implementation-spec.md`

---

## Session 2026-09-27 — sdd-story

- Created feature.md (status: draft), product-spec.md, acceptance.feature, context.md from user story.

### Locked design decisions (user davcs86, pre-story conversation)

1. **Provider = FMP** (GICS-flavored sector). Chosen over EDGAR/Fama-French and Finnhub for smallest
   integration surface (FMP already wired). User additionally mandated: **centralize** all FMP access
   in `xstockstrat-marketdata` behind a **rate-limited token-bucket gateway** so the FMP rate limit is
   always honored under concurrency; ceiling config-tunable for the paid **starter tier** the user is
   considering.
2. **Storage = Type-2 SCD** cache in marketdata (`symbol_classification`). Rationale: the caching
   decision and the point-in-time decision are the *same* decision — a Type-1 overwrite cache silently
   destroys the reclassification history a PIT backtest needs and cannot be reconstructed. Type-2 costs
   marginally more now and accrues PIT history as a side effect. Never call FMP on the read path;
   scheduled refresh diffs and versions-on-change only. Cold local copy is also the fault-tolerance
   win (FMP outage → stale, never unavailable).
3. **Granularity = sector only** (~11 GICS). Modeled as a closed proto enum with
   `SECTOR_UNSPECIFIED = 0`. Unknown sector → mandatory default parameter bucket; engine never fails.
4. **Point-in-time = FULL PIT in v1.** analysis joins sector as-of each evaluated bar; no current-day
   sector for historical bars. Known constraint: Type-2 history accrues forward from go-live; pre-go-live
   bars resolve via the default bucket (external PIT seeding deferred).
5. **Per-sector params stored in the strategy definition** (per-strategy user data → strategy DB via
   `manage_strategy`/proto), NOT the config service. A declared subset of formula params is
   sector-overridable with a mandatory default fallback.

### Prior-context findings (why this feature exists)

- Alpaca `/v2/assets` returns only symbol/exchange/class — no sector. `ListAssets` maps only
  symbol/exchange/asset_class into `common.v1.Asset`.
- `common.v1.Asset` and the `Fundamentals` message carry no sector field. `portfolio.proto` comments
  "marketdata exposes no sector".
- FMP (`internal/fmp/`) and Finnhub (`internal/finnhub/`) clients exist but extract no sector field
  today.

### Known traps surfaced from the Ledger (design/spec must address)

- `fails.md:1852-1868` — look-ahead RED test on ragged calendars passes while a real mid-series
  look-ahead ships. → AC-7 tests a mid-series reclassification, not endpoints.
- `fails.md:81-82, 309-310, 1151` — new proto enum/field hard-couples to shared consumers in the same
  PR: UI exhaustive `Record<Enum,…>` maps + agent descriptor-parity projection tests.
- `fails.md:1038-1043, 1097, 1123` — FMP wiring scattered; `grep -rn` all FMP sites before
  centralizing or the gateway becomes a parallel path.
- `fails.md:1566-1568` (features 076/147) — FMP key is an encrypted config secret via `GetSecret`;
  never re-introduce `FMP_API_KEY` env var.
- `fails.md:726-728` — proto field is `Bar.time`, not `Bar.timestamp`; use real `Bar` fixtures, not
  `MagicMock`.

### Open forks (see product-spec Open Questions)

- One feature vs. split into classification-store + per-sector-params (B depends on A's FR-5).
- UI strategy-editor authoring surface existence (C-14).
- Strategy-storage owning service (for FR-6 migration).

## Session 2026-09-27 — sdd-review product-spec

- Product spec approved. Status: draft → spec-ready.
- Verdict: PASS WITH WARNINGS (spec-reviewer) + overlap CLEAN (feature-overlap). No blockers, no Floor breaches.
- Warnings (all deferred to design/spec, none blocking):
  - Migration mechanics detail (C-07) — firmed at /sdd-spec; SCD migration is next-free `007` in marketdata/migrations.
  - Open-Questions checkbox structure — resolved: known-traps moved under a non-checkbox "Design Guidance / Known Traps" heading; storage-owner marked deferred-to-recon.
  - Config reuse (C-18) — reconcile new `marketdata.fmp.rate_limit_rps` (per-second) with existing `marketdata.fmp.daily_request_cap` (per-day) at design so the FMP gateway has one coherent throttle.
- Overlap findings: none. Confirmed next-free slots — StrategyDefinition per-sector map field = 15; marketdata SCD migration = 007. Soft shared-surface overlap with feature 215 (analysis.proto, agent manage_strategy/run_backtest, UI /insights) is rebase-only, not a resource clash.
- Naming note: `marketdata.<source>.rate_limit_rps` pattern already used by `marketdata.backfill.*` and `marketdata.edgar.*` — the new FMP key fits the established convention.

## Session 2026-09-27 — sdd-design (Phase 0 recon + Phase 1 grilling, in progress)

- Phase 0 recon.md written (services: marketdata, analysis, indicators, agent, ui; C-16 business-rule digest folded in).
- Phase 1 round 1 (quick): proposer approach + adversary NEEDS WORK (no Floor breach). Core architecture affirmed; 7 fold-in amendments (UI surface C-14, shared FMP UTC-day cap, limiter burst=1, override write-validation, profile write-through, same-PR strat-lab/UI-Record coupling, interval-not-cron key).
- **User decision (PIT seeding): HYBRID — seed each symbol's current FMP sector at valid_from=epoch (immediate historical-backtest value) AND run forward Type-2 refresh (PIT-correct reclassifications from go-live).**
- **C-16 SIGN-OFF (user, davcs86): the epoch-seeded pre-go-live span applies today's sector to historical bars — a deliberate, bounded, documented look-ahead for that span only. Post-go-live is strict PIT. This is an explicit, user-signed-off relaxation of the strict no-look-ahead posture for the pre-seed span; a real reclassification before go-live is invisible. Recorded per C-16 (change/relax an existing @AC guarantee requires recorded sign-off).**
- User directed: run the debate DEEPER (beyond the single quick round) before approval. Round 2 focus: hybrid-seeding's interaction with feature-151/152 no-look-ahead @AC guarantees, the seeding mechanism (one-time job vs migration), and clean transition when the first post-seed reclassification closes an epoch-seeded open row.

## Session 2026-09-27 — sdd-design COMPLETE (4 deep rounds, approved)

- Phase 1 grilling: 4 rounds (deep), no Floor breach. Adversary round-4 verdict: APPROVABLE with one one-line must-fix.
- **Chosen approach**: plain-table SCD-2 `symbol_classification` (007) + single-snapshot `GetSectorHistory` per symbol per backtest + compute-K-distinct-param-variants over full-window closes (no per-bar RPC, no chunk-lock re-exposure, byte-identical when no overrides). FMP gateway = one throttle authority at `getJSON` (burst=1 rps limiter + one shared reserve/commit/refund UTC-day budget, boot-seeded from DB). Per-sector overrides = `StrategyDefinition` field 15 on JSONB (no analysis migration). Hybrid seed = the refresh job's uniform no-open-row `INSERT valid_from=EPOCH_SENTINEL ON CONFLICT DO NOTHING` branch.
- **MUST-FIX folded in**: epoch sentinel = `1900-01-01T00:00:00Z` (NOT 1970 — 1970 collides with the protobuf/unix-0 wire-default of an unset `as_of` Timestamp).
- Seed-span look-ahead made visible via the EXISTING `BacktestResult.warnings` channel (no new proto field) + `source='seed'` column; product-spec FR-8 amended + FR-10 added; acceptance.feature +AC-10..AC-13.
- **Rejected** (durable): Type-1 cache, hypertable, EDGAR/Finnhub, per-bar as-of RPC, segment-and-recompute, per-component field-7, child table, 3 independent FMP counters, pure in-memory budget, post-hoc increment, 1970 sentinel, new BacktestResult field, pure forward-accrual.
- **Open risks carried to /sdd-spec** (in design.md): single shared `fmp.Client` instance (+ counter test), `maybeAlertQuota` reads BudgetSnapshot fresh, boot-seed row-vs-call drift (accepted floor), single-replica budget invariant (instance_count:1), 2xx-count precision, `Sector` enum→UI Record maps + agent parity same PR.
- C-16: promote AC-4 + a budget-refund scenario into a new `services/xstockstrat-marketdata/acceptance/sector-classification.feature` in the impl PR.
- Status: spec-ready → design-approved. Next: /sdd-spec.

## Session 2026-09-27 — sdd-spec

- Generated implementation-spec.md with 18 steps. Status → implementation-ready.
- Consumed recon.md + design.md as authoritative inputs; reused recon's Codebase Map as grounded
  path:line evidence and verified the load-bearing seams directly (FMP `getJSON` chokepoint, proto
  field numbers, analysis compute seam, agent client mapping).
- Step order: proto (Sector enum in common/v1 + marketdata classification RPCs + StrategyDefinition
  field 15) → proto-gen → Group A marketdata (migration 007 → single-throttle FMP gateway →
  ClassificationRepo + refresh/seed job → RPC wiring → config keys) → Group B analysis (batched
  GetSectorHistory + compute-K-variants + ManageStrategy validation + seed-span warning) → consumer
  surfaces (agent manage_strategy + strat-lab skill; UI /insights authoring + Sector Record fan-out)
  → C-16 acceptance promotion → teardown audit.
- Key codebase findings:
  - marketdata next migration = **007** (tip `006_dividend_actions`); `symbol_classification` is a
    **plain table** (design.md:14) — no hypertable, neutralizes the feature-153 SQLSTATE 53200 regression.
  - FMP single chokepoint = `internal/fmp/fmp_client.go:118` `getJSON` (`c.http.Do` at :128, non-200 at
    :137); reuse the Alpaca `golang.org/x/time/rate` limiter (`alpaca/client.go:70-72,86-88`). Two
    per-path day-counters to retire onto one shared budget: `fundamentalsQuota` (`marketdata_service.go:1550-1562`,
    DB count via `CountFundamentalsFetchedToday` `marketdata_repo.go:565`) + `enrichmentUnderCap`
    (`:1881-1885`). Fetch sites mapping the cap error: `:1342,1364,1389,1407`.
  - `Sector` enum belongs in `common/v1/common.proto` (shared cross-import; joins TradingMode/
    Environment/BrokerType/Timeframe). Enum-name text = the SCD `sector` column; **acceptance.feature
    uses `TECHNOLOGY` (not `INFORMATION_TECHNOLOGY`)** — chose `SECTOR_TECHNOLOGY` and flagged the
    naming fork to the proto reviewer (C-11, do-not-silently-guess).
  - `StrategyDefinition` next field = **15** (`signal_eligible=14`, analysis.proto:367); `BacktestResult.warnings=16`
    (analysis.proto:138) reused for the seed-span marker → **no new proto field**, no agent
    descriptor-parity break. Per-sector overrides ride `analysis.strategies.definition_json` JSONB
    (`strategies.py:41-54`) → **no analysis migration**.
  - analysis compute seam = `evaluator.py:398` `_compute_component(comp, closes)` (`dict(comp.params)`)
    behind `_assemble_component_series:587` (single unit, takes pre-fetched closes → compute-K-variants
    with no extra GetBars, no chunk-lock re-exposure). New `GetSectorHistory` call mirrors
    `_fetch_bars_paged` header propagation (`servicer.py:1155`, `metadata=propagation_meta`). Key on
    `bar.time` (marketdata.proto:67), never `bar.timestamp` (fails.md:726).
  - agent `manage_strategy` client mapping precedent = `client.py:879-899` (denied_symbols :892 /
    signal_params Struct :895-899); merge-mask `tools.py:994`; descriptor-parity guard
    `test_backtest_view.py:189`. Same-PR strat-lab skill update required (`plugins/strat-lab/skills/backtest/SKILL.md`).
  - UI strategy editor already in `/insights` (StrategyWizard.tsx:104, ComponentEditor.tsx:41
    `params: Record<string,number>`) → **no new page/route → no PLATFORM_SUBNAV / C-10(a) nav test**.
    Exhaustive `Record<Enum,…>` maps to extend same-PR: BacktestDiagnostics.tsx:17,25,31,40 +
    formulaReference.ts:177 (fails.md:81-82,1151).
  - No new env vars/ports (config keys only) → no docker-compose / .do/app*.yaml changes.
- Reviewers snapshot finalized: dropped `xstockstrat-indicators` owner (design rides the existing
  flat-param channel as a drop-in; no indicators code step), added `packages/proto` + `xstockstrat-ui` owners.

## Session 2026-10-06 — scope extension (operator decision, AXP opportunity review)

- **Decision (operator):** sector-aware fundamentals scoring (financials: card issuers/banks are
  balance-sheet funded, so generic `de_bad`=2.0 zeroes their D/E sub-score) is delivered **through this
  feature's per-sector param overrides**, not a separate story — avoids a second sector-override mechanism.
- Added `@AC-14`: overrides must reach a **fundamentals-input custom formula's** params (e.g. `fscore`
  `de_bad`/`roe_bad`), on both backtest (PIT) and live-snapshot surfaces.
- **Spec gap to close before execute:** Step 11 threads overrides only through
  `_assemble_component_series` → `_compute_component`; a fundamentals-input formula returns early into
  `evaluator.py` `_fundamentals_formula_series` (`:632-642`), which builds `params_struct` from
  `comp.params` (`:481-482`) — that branch must also receive the resolved per-sector params, and the
  live-snapshot path (`_load_fundamentals_snapshot`) too. Also noted: `@AC-6`/`@AC-7` phrase the override
  as an "RSI oversold threshold", which in the rule grammar is a rule `rhs` literal, not a component
  param — re-check they test the field-15 design.
- Related open data defects (inputs this override calibrates against): `docs/reports/2026-10-06-edgar-quarterly-roe-not-annualized-defect.md`
  (→ 222), `docs/reports/2026-10-06-edgar-stored-de-predates-financial-debt-defect.md` (→ 223). Calibrate
  sector `de_bad`/`roe_bad` values only after both land.
- Next: re-run `/sdd-spec sector-classification-strategy-params` to fold `@AC-14` into the steps, then
  `/sdd-review … impl-spec`.

## Session 2026-10-06 — /sdd-execute sequential (217 > 220–223)

- Operator decisions (AskUserQuestion, this session): feature branch + one integration PR per
  feature; @AC-6/7/8/10/13 reworded to a component param (C-15 amendment, no rule-rhs overrides);
  enum name `SECTOR_TECHNOLOGY`; defaults `marketdata.fmp.rate_limit_rps=5`,
  `marketdata.classification.refresh_interval_hours=24` (job ships gated off).
- Executed all 18 steps; deviations (AC-14 seam, batched RPCs, natural-PK migration, single shared
  FMP client, validation scope, codegen/e2e fallbacks) recorded in implementation-spec.md
  § Deviation Log.
- C-16: promoted @AC-1/@AC-2/@AC-4(+budget refund)/@AC-12 into
  `services/xstockstrat-marketdata/acceptance/sector-classification.feature`.
- Rollout notes: classification starts empty — enable `marketdata.classification.enabled` and the
  refresh universe (warm set ∪ symbols read via the sector RPCs) seeds within one cycle; the FMP
  profile write-through also seeds whenever extended fundamentals are fetched.
- Status → code-completed.

- 2026-10-06 (post-merge of 223): 223 landed `008` before 217, so 217's migration renumbered
  `007_symbol_classification` → `009_symbol_classification` (007 unused); merge-order row marked resolved.
