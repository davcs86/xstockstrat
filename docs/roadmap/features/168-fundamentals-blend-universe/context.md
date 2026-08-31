# Context: fundamentals-blend-universe

**Feature**: `docs/roadmap/features/168-fundamentals-blend-universe/feature.md`
**Product Spec**: `docs/roadmap/features/168-fundamentals-blend-universe/product-spec.md`
**Implementation Spec**: `docs/roadmap/features/168-fundamentals-blend-universe/implementation-spec.md`

---

## Session 2026-08-31 — sdd-story

- Created feature.md (status: draft), product-spec.md, acceptance.feature, context.md from user story.
- **Grounding (codebase-discovery digest):**
  - `fundamentals_macd_blend` is **agent-registered per-user** (via `manage_strategy`), stored in
    `analysis.strategies` (`migrations/001_strategies.up.sql`; composite `(user_id, strategy_id)` PK
    from `013_strategies_user_id`, feature 133) — **not** a seed migration. Reference:
    `docs/reports/2026-07-20-custom-indicators-strategies.md:38`,
    `docs/reports/2026-08-24-strategy-bakeoff.md`.
  - Strategy execution owned by `xstockstrat-analysis` live loop
    (`app/engine/live_loop.py`, feature 048). The `(strategy, symbol)` selection seam is
    `_run_cycle` (`live_loop.py:289-312`) calling `resolve_universe` (`live_loop.py:83-105`,
    feature 132: `union = allowlist or (watchlist | held | (signals if signal_eligible else set()))`).
    Only `live_enabled` strategies are iterated (`live_loop.py:275-278`).
  - "signal source == fundamentals" = `QuerySignals(source="fundamentals")`
    (`packages/proto/ingest/v1/ingest.proto:128`); producer default slug `fundamentals`
    (`analysis.fundsignal.source_slug`). "has actual fundamentals" = a symbol for which
    `GetFundamentalsMulti` returns a row (marketdata, the single FMP/Finnhub chokepoint, feature 059;
    pattern seen in `app/engine/fundsignal_loop.py:373-378`).
  - **Feature 154** (`fundsignal-watchlist-universe`, launched) is about the fundamentals **producer's**
    universe (which symbols get scored to emit signals), NOT running a strategy over a universe — this
    feature is adjacent but distinct and extends the live-loop universe logic (features 132/133), not 154.
  - **No existing "run strategy X on sub-universe Y, exclude elsewhere" logic** — net-new. Achievable
    without a proto change using existing fields + engine logic.
- **Prior features to respect:** 047 (evaluator), 048 (`live_enabled`, live loop, alerts only — never
  places orders; ledger: add proto/DB field + row mapper in lockstep), 132 (deny list / allowlist /
  `signal_eligible` universe knobs), 133 (per-user strategy ownership resolved from `x-user-id`), 059
  (fundamentals via marketdata chokepoint, `marketdata.fmp.enabled=false` default), 062 (`fundamentals`
  derived signal source).
- **Ledger traps folded in:** conviction ordinal-vs-probability confusion (signals) — noted for design;
  fundamentals-signal-producer fail-open validator — new config validated fail-closed; migration-number
  collisions — N/A (no migration).
- **Central design fork (Open Question):** the blend strategy is per-user/agent-registered, so "run it
  in addition to the user's selection" must decide per-user application vs promoting the strategy to a
  global/platform strategy. Surfaced in product-spec `## Open Questions`; to be resolved in `/sdd-design`.
- **Consumer surface (C-14):** None (internal engine rule); output reaches users via existing
  live-strategy alerts (feature 048) + opportunity attribution (feature 131). Operator visibility flagged
  as a possible follow-up, not silently deferred.

## Session 2026-08-31 — sdd-review product-spec

- Ran /sdd-review (not skipped). spec-reviewer + feature-overlap.
- Initial verdict: FAIL (criterion 9 — six unchecked Open Questions; OQ#1 per-user-vs-global load-bearing on
  FR-1/FR-2) + NOTE on imprecise proto line cites. Overlap: CLEAN (`analysis.engine.fundamentals_blend_*`
  keys unclaimed; no proto/migration collision; watch `resolve_universe`/`_run_cycle` same-function zone at impl-spec).
- Fixes: Open Questions → "Resolved Design Decisions" — committed to PER-USER reading (global promotion moved to
  Out of Scope as rejected alternative); enable flag `analysis.engine.fundamentals_blend_enabled` (default true);
  precedence vs feature-132 (denied_symbols subtracts, blend allowlist ignored); once-per-cycle universe reuse.
  Fixed proto cites (ingest.proto:129 source; analysis.proto:318 signal_params / :351 symbols key).
- Re-review verdict: PASS (0 blockers, 0 warnings).
- Status: draft → spec-ready. Next: /sdd-design fundamentals-blend-universe quick.
