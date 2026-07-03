# Context: persist-strategy-scores

**Feature**: `docs/roadmap/features/064-persist-strategy-scores/feature.md`
**Product Spec**: `docs/roadmap/features/064-persist-strategy-scores/product-spec.md`
**Implementation Spec**: `docs/roadmap/features/064-persist-strategy-scores/implementation-spec.md`

---

## Session 2026-07-03 — sdd-story

- Created feature.md (status: draft), product-spec.md, context.md from user story.
- Origin: follow-up ("Option B") to the strategies UI-discrepancy fix (PR #739). That PR made the
  insights views merge definitions with scores and render a "not scored yet" state; it left a noted
  follow-up: scores in `xstockstrat-analysis` are in-memory only (`self._strategies`,
  `services/xstockstrat-analysis/app/handlers/servicer.py:86,708,733,737`) and vanish on restart.
  This feature persists them.
- Grounding read: `analysis.strategies` table (migration `001_strategies.up.sql`) and existing
  migrations `001–004`; next migration number is `005_`.
- Known trap noted in product-spec: Phase 3 chose in-memory analysis storage deliberately
  (`docs/roadmap/phase3-deviations.md`); this feature reverses it for scores only. `fails.md` empty.
- Open questions captured for /sdd-design: DB-direct reads vs. hydrate-at-boot; FK to
  `analysis.strategies`; score retention on strategy deactivation.

## Session 2026-07-03 — sdd-review product-spec

- Product spec approved. Status: draft → spec-ready.
- Criteria verdict: PASS WITH WARNINGS (spec-reviewer). No blockers; every code-checkable claim
  verified (in-memory dict at servicer.py:86/708, ListStrategies:732, GetStrategyReport:736; next
  migration = 005_; pool budget stays 2; FR-7 best-effort mirrors AppendEvent try/except at :717-728).
- Warnings: 3 unchecked Open Questions (hydrate-at-boot vs DB-direct reads; FK to analysis.strategies;
  score retention on deactivation) — correctly deferred to /sdd-design (P-03). Must be closed in design.
- Overlap findings: none (feature-overlap = CLEAN). Migration 005_ free; table name unique; no config
  or proto collisions; no merge-order entry warranted.

## Session 2026-07-03 — sdd-design

- Phase 0 Recon: wrote recon.md (service: xstockstrat-analysis). Key reuse patterns: StrategiesRepository
  shape (app/repositories/strategies.py:27) as the mirror target; best-effort ledger try/except
  (servicer.py:717-728) for FR-7; AsyncMock pool test harness (test_fundsignal_loop.py:44-56).
- Phase 1 Grilling: 1 round (quick). Proposer offered DB-direct reads + best-effort write. Adversary
  (NEEDS WORK, no Floor breach) flagged a false-success hazard: swallowed upsert + DB-direct read →
  ScoreStrategy acks success but the next read returns NOT_FOUND; also dead in-memory write, JSONB
  copy-trap (_to_dict wrong key), and AsyncMock echo test giving false serialization coverage.
- Chosen approach: **write-through in-memory serving + hydrate-at-boot** (DB = durability layer, reads
  stay in-memory). Resolves the false-success hazard, preserves read-your-writes under FR-7, keeps the
  read path unchanged. Loose key (no FK); retain score row on deactivation. created_at/updated_at (not
  scored_at). Rejected: DB-direct reads; pure DB-direct w/ fake repo; DB-then-memory precedence; FK CASCADE.
- Constitution rules touched: C-01/C-05/C-07/C-08/P-06/F-01/F-04/F-06/F-07/P-03 (all honored). Floor
  breaches: none.
- Status: spec-ready → design-approved.
- Note (P-05): this feature deliberately reverses the Phase-3 in-memory-storage deviation
  (phase3-deviations.md) for scores only — not for self._backtests or screener state.

## Open Threads (carried from design.md Open Risks)

- Partial durability: backtests not persisted → post-restart GetStrategyReport returns latest_backtest=null
  and re-score needs a fresh RunBacktest. Target: state explicitly in AC-2 at /sdd-spec.
- Unbounded table growth / orphan visibility: no retention/pagination; deactivated + ad-hoc-id scores
  persist & hydrate. Target: note in spec Out-of-Scope/Open Questions; candidate follow-up feature.
- NaN/Infinity JSONB rejection if a future 063 formula produces unclamped scores. Target: clamp/guard at
  the ScoreStrategy persist step.
