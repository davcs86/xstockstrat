# Design: fundamentals-blend-strategy-restrictions

**Created**: 2026-09-08
**Rounds**: 3 (quick; termination: approved)
**Approved by**: user @ 2026-09-08
**Grounded in**: recon.md

---

## Chosen Approach

Two enforcement layers — an execution-restriction guard in the live evaluation loop and lifecycle
guards in the servicer RPCs — both keyed on the runtime config value of
`analysis.engine.fundamentals_blend_strategy_id` (`recon.md` § Codebase Map, `app/engine/live_loop.py:262-264`).

### 1. Execution restriction (live_loop.py)

Replace the current two-way branch at `app/engine/live_loop.py:296-307` (`recon.md` § THE GAP) with
a strategy-identity-first branch:

```python
if definition.strategy_id == blend_id:
    # Blend strategy — fundamentals-only execution (FR-1, FR-4)
    if not blend_active or not fundamentals_universe:
        continue  # skip entirely — never resolve_universe
    denied = {_normalize_symbol(s) for s in definition.denied_symbols}
    deny_entry = held_cache[owner] & denied
    universe = (fundamentals_universe - denied) | deny_entry
else:
    # Normal strategy — owner-scoped universe
    resolved = resolve_universe(...)
    universe = resolved.universe
    deny_entry = resolved.deny_entry
```

The outer predicate is `strategy_id == blend_id` (identity), not `blend_active` (state). The blend
strategy **never** enters the `else` branch regardless of `blend_active` or `fundamentals_universe`
state — when either condition fails, it is `continue`d (AC-1, AC-2). The deny-list block
(`denied`, `deny_entry`, universe subtraction + held-denied reinsertion) is preserved in the
blend happy path so `deny_entry` remains defined for the downstream `_eval_pair` call at
`app/engine/live_loop.py:347` and the symbol check at `:316`.

`blend_id`, `blend_active`, and `fundamentals_universe` are already computed at
`app/engine/live_loop.py:262-265` and `:278-279` (`recon.md` § Codebase Map) — no new config reads
in the loop.

**Consumer surface (C-14):** internal-only execution change. The product spec marks Consumer
Surface as "None" for UI (Agent error-path only for the lifecycle guards below).

### 2. Servicer lifecycle guards (servicer.py)

**ManageStrategy DEACTIVATE guard** — insert before the ownership check at
`app/handlers/servicer.py:2524` (`recon.md` § DEACTIVATE branch):

```python
blend_strategy_id = self._cfg.get_str(
    "analysis.engine.fundamentals_blend_strategy_id",
    "fundamentals_macd_blend"
)
if request.definition.strategy_id == blend_strategy_id:
    await context.abort(
        grpc.StatusCode.FAILED_PRECONDITION,
        "the fundamentals blend strategy cannot be deactivated; "
        "it is a protected platform resource"
    )
```

**SetStrategyLive disable guard** — insert before the ownership check when
`request.live_enabled=false` at `app/handlers/servicer.py:2641` (`recon.md` § Disable path):

```python
if not request.live_enabled:
    blend_strategy_id = self._cfg.get_str(
        "analysis.engine.fundamentals_blend_strategy_id",
        "fundamentals_macd_blend"
    )
    if request.strategy_id == blend_strategy_id:
        await context.abort(
            grpc.StatusCode.FAILED_PRECONDITION,
            "the fundamentals blend strategy cannot be set non-live; "
            "it is a protected platform resource"
        )
```

Both guards use the `FAILED_PRECONDITION` pattern at `servicer.py:2636` (`recon.md` § Patterns to
REUSE). Placed **before** the ownership check to avoid leaking strategy existence (anti-IDOR
pattern from `recon.md` § Risks). Only DEACTIVATE and `live_enabled=false` are guarded — REGISTER,
UPDATE, REACTIVATE, and `live_enabled=true` remain open.

Error messages contain the exact substrings asserted in `acceptance.feature` AC-4 and AC-6.

The stale comment at `servicer.py:2622-2623` ("disabling is ALWAYS allowed") is updated to reflect
the blend-strategy exception.

### 3. Documentation co-changes

- **strat-lab plugin** (`plugins/strat-lab/`): update the `backtest` skill to document the new
  `FAILED_PRECONDITION` responses for ManageStrategy(DEACTIVATE) and SetStrategyLive(live_enabled=false)
  on the blend strategy (root CLAUDE.md mandates this co-change).
- **mcp-tools.md** (`docs/runbooks/mcp-tools.md`): add one row to `manage_strategy`'s error table
  for the DEACTIVATE rejection. `set_strategy_live` has no section in that file (pre-existing gap,
  outside this feature's scope).
- **C-10(c) UI waiver**: record sign-off in `context.md` — the product spec explicitly marks
  Consumer Surface as "None" for UI (Agent error-path only).

## Rejected Alternatives

- **Fold `fundamentals_universe` emptiness into `blend_active` variable** (`blend_active = blend_active and bool(fundamentals_universe)`) — rejected because when `blend_active=False`, the blend strategy still enters the `else` branch and calls `resolve_universe`, which is the exact bug FR-1 fixes. The fold makes AC-2 identical to AC-1: both broken the same way.
- **Three-way branch (Round 1)** (`if blend_active and strategy_id == blend_id / elif not blend_active and strategy_id == blend_id: continue / else: resolve_universe`) — rejected because the `elif` is order-sensitive: a reorder or injected clause between `if` and `elif` breaks the skip. The two-way branch co-locates all blend logic under a single identity check.
- **Smaller diff: add `elif strategy_id == blend_id: continue` to existing code** — keeps the `if blend_active and ...` predicate and adds one `elif`. Smaller diff but splits the blend identity check across two branches; the two-way restructure is architecturally cleaner now that the deny-list code is preserved.

## Open Risks

- [ ] **deny_entry exit edges dropped on skip** — when `blend_active=True` but `fundamentals_universe` is empty, `continue` drops held-denied exit edges. Accepted as intentional per spec "SKIPPED entirely" — exit-only evaluation deferred until universe resolves. No action needed unless the product spec changes.

## Constitution Rules Touched

- `C-08` — honored by: test coverage for every new code path (execution skip, servicer guards, deny-list preservation).
- `C-10(c)` — honored by: FR-4 — all guards use config-driven identity (`self._cfg.get_str`), no hardcoded IDs.
- `C-14` — honored by: Consumer Surface is "None" for UI / Agent error-path only — no UI segment or Agent tool change needed; waiver recorded in context.md.
- `C-15` — honored by: error messages contain the exact substrings asserted in `acceptance.feature` AC-4 and AC-6.
- `C-16` — honored by: existing business rules @AC-5/@feature-149 and @AC-7/@feature-152 preserved (see Business Rules Touched below).
- `P-01` — honored by: single orchestrator wrote all artifacts; subagents were advisory only.
- `P-02` — honored by: proposer and adversary never saw each other's raw output.
- `P-04` — honored by: user approved design at Round 3 gate via `AskUserQuestion`.
- `P-05` — honored by: context.md updated with session decisions.
- `F-04` — honored by: all path:line citations from codebase-discovery digests; no invented paths.

## Business Rules Touched (C-16)

- PRESERVE `@AC-5 @FR-4 @feature-149` "Every documentation surface reflects the widened manage_strategy input type" (`docs/sdd/business-rules/platform.feature`) — not regressed by: DEACTIVATE rejection is a verb-specific guard, not an input-type change; strat-lab plugin docs updated as a co-change.
- PRESERVE `@AC-7 @FR-6 @feature-152` "Live evaluation resolves the benchmark component on a benchmark-referencing strategy" (`services/xstockstrat-analysis/acceptance/market-regime-benchmark-operand.feature`) — not regressed by: deny-list logic preserved in blend happy path; benchmark date-join + gap=hold resolution still runs when blend strategy evaluates.
