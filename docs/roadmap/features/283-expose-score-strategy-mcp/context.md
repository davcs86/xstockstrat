# Context: expose-score-strategy-mcp

**Feature**: `docs/roadmap/features/283-expose-score-strategy-mcp/feature.md`
**Product Spec**: `docs/roadmap/features/283-expose-score-strategy-mcp/product-spec.md`
**Implementation Spec**: `docs/roadmap/features/283-expose-score-strategy-mcp/implementation-spec.md`

---

## Session 2026-11-01 — sdd-story

- Created feature.md (status: draft), product-spec.md, acceptance.feature, context.md from the operator's request to close the 215 Step 26 (e) gap.
- Number 283 = max(282)+1 on `origin/main-dev` `0fc13c41`, so no renumbering.
- Origin: `docs/roadmap/features/215-block-fundamentals-strategy-on-etf/implementation-spec.md` § Deviation "Step 26 (e) — `ScoreStrategy` not reachable via MCP" (blocks 215 `launched`).
- Facts grounded: `ScoreStrategy` at `services/xstockstrat-analysis/app/handlers/servicer.py:2566` (owner-scoped, `range` ignored, persists grade, emits `analysis.strategy.scored`); `StrategyScore` at `packages/proto/analysis/v1/analysis.proto:249-258` (`evidence_symbols` is an `int32` count); agent registers 45 tools today.
- Unresolved: FR-5 fork (how to name excluded symbols) — raised in product-spec Open Questions, not guessed.

## Session 2026-11-01 — sdd-review product-spec

- First pass FAILED (criterion 9: four unresolved open questions). Operator resolved: tool shape = `manage_strategy operation='score'` (count stays 45); FR-5 = option C (no proto field); owner-scoped auth; `merge-order.md` row added for 215/283. Spec + acceptance revised (AC-6/7 concrete, AC-8..10 added).
- Re-review: PASS WITH WARNINGS. Status: draft → spec-ready.
- Warnings applied: `excluded_symbols` named in FR-5; remaining question reformatted as "Deferred to /sdd-design"; AC-10 reworded as an outcome.
- Warnings carried to design: preserve NOT_FOUND detail via `_grpc_error_message` for `score`; AC-7 re-opens to operator if no no-proto channel; AC-9 must also reject `clear_fields`.
- Overlap: no FAIL-level collisions. Same-function overlap with 215 on `manage_strategy` (`tools.py`/`client.py`); `score` calls a different RPC than the `STRATEGY_OPERATION_*` dispatch.
- **Unresolved, needs operator ruling:** `merge-order.md` row for 215/283 reads as a PR-level deadlock (283 needs 215's servicer code on trunk; row makes 215's integration PR wait for 283). Intended sequence: 215 integration PR → 283 → 215 `launched`.
- Recommended design depth: full (overlap finding; possible analysis change).

## Session 2026-11-01 — merge-order split + warning fixes

- `merge-order.md` row 100 split into two (283 waits for 215's *merge*; 215's `launched` waits for 283). Row 2 is not machine-enforced (the file gates only integration PRs) — enforced by 215's Step 26 (e).
- Spec warnings addressed: `excluded_symbols` in FR-1; server detail text preserved in FR-3; AC-9 also covers `clear_fields`; feature.md reviewer table updated for option C. Re-review requested.

## Session 2026-11-01 — sdd-review product-spec (pass 3)

- Result: PASS WITH WARNINGS, no blockers; status remains spec-ready. All pass-2 warnings verified fixed.
- Addressed: AC-6 reworded (count stated as words or digits); merge-order row A set Resolved=Yes (215's code verified on origin/main-dev); row B now states its real enforcement (CI promotes only `code-completed`; keep 215 `in-progress` until Step 26 (e) runs).
- Carried to design: `_grpc_error_message` (`tools.py:244-245`) discards the server detail on NOT_FOUND — `score` must pass it through; AC-4 needs a way to force `_GradeInputsUnknown`; update the `operation` docstring and the parity guard together.
- Open for operator: whether row B stays in the table or moves to a prose note (scan 3 flagged `/sdd-execute` would still prompt on it).
