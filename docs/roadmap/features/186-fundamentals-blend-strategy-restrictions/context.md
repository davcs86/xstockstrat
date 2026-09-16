# Context: fundamentals-blend-strategy-restrictions  (archived 2026-09-16)

**Feature**: ./feature.md
**Status**: launched — archived by /sdd-archiver; verbose specs pruned (recoverable via git history).

## Archive Synthesis — 2026-09-16 — /sdd-archiver

**What**: Hardened the fundamentals blend strategy so it can only ever run against the fundamentals signal universe and can never be deactivated or set non-live via `ManageStrategy(DEACTIVATE)`/`SetStrategyLive(live_enabled=false)`. The pre-existing bug: the blend strategy fell through to the normal owner-scoped `resolve_universe` path whenever its kill-switch was off or the fundamentals universe came back empty. Shipped clean and unattended — 6 steps, zero deviations, ~84% analysis coverage. Platform's FIRST protected-resource (cannot-modify) guard on the strategy lifecycle RPCs.

**Why (irrecoverable rationale)**: The loop was restructured to branch on strategy **identity** (`strategy_id == blend_id`), not on mutable state (`blend_active`), specifically so the blend strategy can *never* enter the `else`/`resolve_universe` branch under any config state. The shipped `if/else` shape looks arbitrary in isolation — the reason it must be identity-first (not a smaller state-based `elif`) is the whole point and is gone once design.md is deleted.

**Rejected alternatives**:
- Fold universe-emptiness into `blend_active` (`blend_active = blend_active and bool(fundamentals_universe)`) — when `blend_active=False` the strategy still enters `else` and calls `resolve_universe` (the exact bug FR-1 fixes); makes AC-2 fail identically to AC-1.
- Three-way branch (`if blend_active and id==blend / elif not blend_active and id==blend: continue / else`) — the `elif` is order-sensitive; a reorder or injected clause between `if` and `elif` silently breaks the skip.
- Smaller-diff `elif id==blend_id: continue` bolted onto the existing predicate — splits the blend identity check across two branches; the two-way restructure co-locates all blend logic under one predicate.

**Scars & gotchas**:
- Restructuring the branch nearly dropped `deny_entry`: a Round-3 adversary caught a `deny_entry` NameError on the blend happy path — the deny-list block had to be preserved inside the blend branch because downstream `_eval_pair` and the symbol check consume `deny_entry`. Lesson: when hoisting a protected case out of a shared path, re-verify every variable a later line depends on is still defined.
- FR-1's fix intentionally changed a previously-passing test: `test_kill_switch_disables_override` flipped from expecting `{"AAPL","GME"}` to `set()`. The old assertion encoded the *buggy* fall-through behavior; a future agent seeing that assertion edit in git history could mistake the fix for a regression.

**Permanent deviations**: none — deviation log empty; shipped exactly as designed.

**Cross-feature signal**:
- First protected-strategy guard in the strategy lifecycle RPCs — no prior "cannot modify" precedent existed. The pattern (config-driven protected identity + guard-before-ownership) is the reusable template for future protected-resource guards.
- Successfully applied the known trap from feature 063-fundamentals-scoring-model (protect seeded/shared resources by config-driven identity, not hardcoded IDs, C-10(c)) — a prior ledger *fail* consumed as a design constraint rather than re-learned.
- Shares `servicer.py` / `test_analysis_servicer.py` / `mcp-tools.md` (and the strat-lab plugin `backtest` SKILL.md, per the strat-lab co-change rule) with feature 185 at disjoint function ranges — rebase-only, no real overlap.

**Deferred follow-ons**:
- **deny_entry exit edges dropped on skip** — when `blend_active=True` but `fundamentals_universe` is empty, the `continue` drops held-denied *exit* edges (positions can't be exited while the universe is empty). Accepted per spec's "SKIPPED entirely"; revisit only if the product requires exit-only evaluation when the universe is empty.
- `set_strategy_live` has no section in `mcp-tools.md` (pre-existing gap, out of scope) — its new `FAILED_PRECONDITION` rejection is undocumented in that runbook.

**Ledger entries written**: insights.md (2), fails.md (0) — see the 2026-09-16 entries. (The "protect seeded/shared resources by config-driven identity" lesson was a DUP of the feature-063 C-10(c) fail; the sole near-miss, the `deny_entry` NameError, was caught in the design debate before any code and is recorded as a scar/insight, not a shipped fail.)

**Runtime-invariant recommendations (→ /context-constitution)**: ANALYSIS-* — the fundamentals blend strategy (config `analysis.engine.fundamentals_blend_strategy_id`) must NEVER reach `resolve_universe`; it executes only on the fundamentals universe and is `continue`d when disabled or the universe is empty, and is immune to `ManageStrategy(DEACTIVATE)`/`SetStrategyLive(live_enabled=false)` via guards placed before the ownership check.

**Pruned artifacts**: product-spec.md, recon.md, design.md, implementation-spec.md — last present at 5b193f2d.
