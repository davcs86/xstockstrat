# Design: fundamentals-blend-universe

**Created**: 2026-08-31
**Rounds**: 2 (full; termination: converged — final human approval gate + `status.md` flip deferred to the orchestrator, see Note)
**Approved by**: _pending operator sign-off (this artifact was produced by an isolated `/sdd-design` subagent run without a live `AskUserQuestion` gate — ledger 2026-08-08 nested-subagent trap; the two operator-confirm items in Open Risks must be answered before `/sdd-spec`)_
**Grounded in**: recon.md

---

## Chosen Approach

A single **universe-override branch inside `_run_cycle`** (`live_loop.py:263-356`), gated by two new
`analysis.engine.*` config keys and fed by a **once-per-cycle fundamentals-universe resolver** that
fails closed to an empty set. No proto change, no migration, no new inter-service edge.

**1. Config reads at cycle start** (top of `_run_cycle`, alongside the existing `:273-274` reads):
- `blend_id = self._cfg.get_str("analysis.engine.fundamentals_blend_strategy_id", "fundamentals_macd_blend")`
  (recon: `watcher.py:87-93`).
- `blend_enabled = self._cfg.get_bool("analysis.engine.fundamentals_blend_enabled", True)` — safe against
  an explicit `false` because `get_bool` is `HasField`-based (recon: `watcher.py:116-122`).

**2. Gate + no-op (FR-5, AC-4):** compute a boolean `blend_active = blend_enabled and any(row.strategy_id
== blend_id for row in rows)` from the already-selected `live_enabled` rows (`:275-278`). If not
`blend_active`, the loop behaves byte-identically to today — **no** `QuerySignals`/`GetFundamentalsMulti`
call is issued (respects F-06 and the "no-op when not live" requirement).

**3. Once-per-cycle fundamentals-universe resolver (FR-1/FR-3/FR-4/FR-6):** when `blend_active`, resolve
the set **once** before the per-row loop (reusing the metadata already built for the cycle):
- `slug = self._cfg.get_str("analysis.fundsignal.source_slug", "fundamentals")` (F-07 — reuse, never
  hardcode; recon: `fundsignal_loop.py:389` uses the same key).
- `sigs = QuerySignals(source=slug, active_window=TimeRange(now, now))` → symbol set `S` (a **new** call —
  `_drain_signals` `:358-385` drops `source`, so it can't be reused; paginate like `_drain_signals`).
- `fetched = GetFundamentalsMulti(chunks of S)` keeping symbols present in `resp.fundamentals` (recon:
  `fundsignal_loop._paced_fetch:373-378`) → `F`. `fundamentals_universe = S ∩ F` (normalized upper).
- The whole block is wrapped `try/except → fundamentals_universe = set()` (FR-6/AC-6 fail-closed —
  mirrors `_drain_signals:378-380`); the rest of the cycle (other strategies) is untouched.

**4. Per-row override branch (FR-2, AC-1/AC-2/AC-3):** inside the existing `for row in rows` loop
(`:289-309`), after building `definition`:
- If `blend_active and definition.strategy_id == blend_id`: build the blend `ResolvedUniverse` from the
  fundamentals set instead of `resolve_universe`'s watchlist∪held∪signals — applying feature-132
  precedence: `denied = {normalize(s) for s in definition.denied_symbols}`; `deny_entry = held ∩ denied`;
  `universe = (fundamentals_universe − denied) | deny_entry`. The blend `signal_params.symbols` allowlist
  is **ignored** (FR-2 replaces the universe — the whole point of the rule).
- Else: unchanged `resolve_universe(definition, watch, held, signals)` (AC-3 — every other strategy's
  universe is byte-for-byte what it is today; the blend row is *added*, never substituted for another).

The blend row's `(created_at, strategy_id, symbol, definition, deny_entry)` tuples flow into the same
`records` list, global sort, rotation cursor, and per-pair `_eval_pair` path (`:300-345`) — so the forced
universe composes with the fair-share scheduler and `max_strategies_per_cycle` exactly like any other
strategy (no parallel loop, no second cursor).

**Consumer surface (C-14):** internal to the analysis live loop. User-visible output reaches users only
through the already-shipped live-strategy **alerts** (feature 048 → notify) and **opportunity
attribution** (feature 131) — no new UI/Agent surface. The operator control is the
`analysis.engine.fundamentals_blend_enabled` kill-switch via `set_config`/config-ui.

## Rejected Alternatives

- **Promote `fundamentals_macd_blend` to a global/platform strategy** — rejected: abandons the per-user
  `(user_id, strategy_id)` ownership model (feature 133) the whole service is built on; already moved to
  Out of Scope in the product spec.
- **A parallel selection path / second loop for the blend strategy** — rejected: duplicates the
  fair-share rotation + cursor + per-owner memoization and would drift from `resolve_universe` (DRY /
  the 048 "keep the one seam" lesson). The override is one branch on the existing row loop instead.
- **Per-strategy (per-user) `GetFundamentalsMulti` fan-out** — rejected: F-06 pacing; the fundamentals
  universe is platform-wide (signals are global), so it is identical across users in a cycle — resolve
  once and reuse.
- **Resolve the fundamentals universe unconditionally every cycle** — rejected: wastes a gRPC round trip
  when no blend strategy is live (FR-5 says no-op); gate on `blend_active` first.
- **Fall back to the broad watchlist/held universe on a resolution error** — rejected: FR-6/AC-6 forbid
  it; that would evaluate the blend strategy on symbols its premise doesn't cover (the exact regression
  FR-2 exists to prevent). Fail closed to empty instead.
- **Hardcode the `"fundamentals"` source string** — rejected: F-07; read `analysis.fundsignal.source_slug`
  so the read side tracks the producer's slug.
- **Honor the blend strategy's `signal_params.symbols` allowlist** — rejected: FR-2 replaces the blend
  universe with the fundamentals universe; an allowlist would re-narrow it inconsistently. Ignored for
  the blend strategy only (all other strategies keep allowlist semantics).

## Open Risks

- [ ] **Held-but-left-universe exit alert (operator sign-off needed).** Strict FR-2 (chosen) means a
  blend position whose fundamentals signal has expired while still held fires **no exit alert** (it's out
  of the universe). Alternative: union `held` into the blend universe for exit-tracing only (feature-132
  spirit). Recommend strict FR-2 for v1 (matches AC-2; the loop places no orders, so the cost is a missed
  *alert*, not a stranded position) — confirm before `/sdd-spec`. → address at the `_run_cycle` override step.
- [ ] **Cross-cycle re-resolution cost.** The fundamentals universe changes ~daily but is resolved every
  ~60s cycle (only when a blend strategy is live). Bounded (cache-backed `GetFundamentalsMulti` over a
  small set) — ship as-is; a TTL cache is a flagged, **deferred** optimization, not built now. → note in
  context Open Threads; revisit only if load shows it matters.
- [ ] **Config registration completeness.** Both keys must land in the Per-Feature Registered Keys log
  (`docs/patterns/config-governance.md`) and this service's CLAUDE.md `## Config Keys Consumed` table in
  the same PR. → address at the config-keys step.

## Constitution Rules Touched

- `C-05` — honored: keys are `analysis.engine.fundamentals_blend_strategy_id` / `.fundamentals_blend_enabled`
  (`<service>.<category>.<key>`, existing `engine` category); defaults declared in the service CLAUDE.md.
- `C-08` / `P-06` — honored: each engine change pairs a Python `test_live_loop` step with RED-first
  assertions covering AC-1..AC-6 + the two precedence cases, meeting the analysis ≥40% threshold.
- `C-10` — honored: no shared/duplicated surface is touched — no proto field, no row→proto mapper edit
  (dodges the 048 lockstep trap), no UI exhaustive-map. The kill-switch is the only operator surface.
- `C-13` — honored: new Python test fixtures (StrategyDefinition / signal / fundamentals doubles) come
  from `tests/conftest.py` per the lazy-materialization rule.
- `C-14` — honored: internal-only surface, explicitly justified; output via existing alerts/opportunities;
  operator toggle named. No silent stale consumer.
- `C-16` — honored: **AC-3** (other strategies' universes unchanged) is preserved by branching the
  override strictly on `strategy_id == blend_id`; the feature-154/156 producer guarantees are untouched
  (read-only consumer). No existing `@AC-*` is changed.
- `F-06` — honored: resolve once per cycle, skip entirely when no blend strategy is live, reuse the single
  marketdata `GetFundamentalsMulti` chokepoint (24h cache), no new pool/edge.
- `F-07` — honored: strategy id, enable flag, and source slug are all WatchConfig reads — nothing hardcoded.
- `P-03` — honored: the held-exit edge and the cross-cycle-cost fork are surfaced as operator/deferred
  decisions, not silently guessed.

## Business Rules Touched (C-16)

- PRESERVE `@AC-3 @feature-154` "Producer scores the enumerated union when universe_source is watchlists"
  (`services/xstockstrat-analysis/acceptance/fundsignal-watchlist-universe.feature`) — not regressed:
  this feature only *reads* the emitted `source=="fundamentals"` signals; it does not alter production.
- PRESERVE `@AC-1 @feature-156` "The producer runs its first cycle promptly on a fresh deploy"
  (`services/xstockstrat-analysis/acceptance/fix-fundamentals-signal-producer.feature`) — not regressed:
  the read side reuses `analysis.fundsignal.source_slug`, never renaming/assuming the slug.
- Net-new behavior otherwise: this feature's own `@AC-1..@AC-6` become the regression guard (AC-3 asserts
  other strategies' universes are unchanged); no existing durable `@AC-*` is EXTENDed or CHANGEd.

## Note — deferred gate

This design was produced by an isolated `/sdd-design` subagent that does not hold `AskUserQuestion`
(ledger 2026-08-08 — a nested subagent cannot assume the live human gate). The two Open-Risk items marked
"operator sign-off" and the final Phase-1 approval + `spec-ready → design-approved` `status.md` flip are
therefore **deferred to the orchestrating session**, which must present them to the operator before
`/sdd-spec`. Nothing here is treated as a substitute for that live gate.
