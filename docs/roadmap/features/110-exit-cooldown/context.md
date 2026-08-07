# Context: exit-cooldown

**Feature**: `docs/roadmap/features/110-exit-cooldown/feature.md`
**Product Spec**: `docs/roadmap/features/110-exit-cooldown/product-spec.md`
**Implementation Spec**: `docs/roadmap/features/110-exit-cooldown/implementation-spec.md`

---

## Session 2026-08-07T00:00:00Z — sdd-story

- Created feature.md (status: draft), product-spec.md, context.md from user story.
- User explicitly requested "run full design cycle" — `/sdd-design exit-cooldown` should run in
  **full** (multi-round) mode, not `quick`.
- Strong precedent identified: feature 069 (`strategy-reentry-cooldown`, archived) shipped the
  symmetric entry-side gate (`cooldown_days` on `StrategyDefinition`, `app/services/cooldown.py`
  pure gate functions, `analysis.strategy_cooldowns` durable table, `manage_strategy` MCP param,
  `StrategyWizard` UI field). This feature mirrors that shape for the exit side. Read during story:
  - `services/xstockstrat-analysis/app/services/cooldown.py` (pure `effective_cooldown_days` /
    `is_cooldown_active` gate, tz-aware, no DB/proto imports)
  - `services/xstockstrat-analysis/app/repositories/strategy_cooldowns.py` +
    `migrations/009_strategy_cooldowns.up.sql` (durable `(strategy_id, symbol) → last_exit_at`)
  - `services/xstockstrat-analysis/app/handlers/servicer.py:1046-1105` (backtest gate call sites),
    `:2854-2858` (`_MASKABLE_PATHS`)
  - `services/xstockstrat-analysis/app/engine/live_loop.py:60-83,151-243` (live-loop gate,
    `hydrate_cooldowns`, `_write_cooldown`)
  - `services/xstockstrat-agent/app/tools.py:449-537` (`manage_strategy` partial-update pattern,
    feature 070 "send only what's supplied" fix — must not regress)
  - `services/xstockstrat-ui/src/components/insights/StrategyWizard.tsx:27-206`
    (`parseCooldownDays`, presence-honest blank/`"0"` handling)
  - Confirmed via grep: the live loop currently tracks only a boolean `_last_state` (in-position),
    **no entry timestamp** — durable entry-time tracking for the exit-cooldown gate is new, not a
    reuse of an existing field.
- Ledger `fails.md` reviewed for relevant traps: 056 (C-10(b), every read/mapper path must carry a
  field forward), 070 (partial-update regression risk), 069's own archive synthesis (mid-design
  renumbering collision — this feature is 110, no adjacent in-flight numbering conflict observed at
  story time). Flagged as an Open Question / known trap in product-spec.md.
- Consumer surface (C-14): **UI** `/insights` (`StrategyWizard.tsx` Step 1, no new nav registration
  needed — reuses the existing wizard route) + **Agent** (`manage_strategy` tool).

Next: `/sdd-review exit-cooldown product-spec`, then `/sdd-design exit-cooldown` (full mode, per
explicit user request).

## Session 2026-08-07T00:15:00Z — sdd-review product-spec

- Product spec approved. Status: draft → spec-ready.
- Warnings:
  - Open Questions section has 4 unresolved `- [ ]` items — all appropriately scoped to
    `/sdd-design`, not story-time ambiguities. `/sdd-design` must resolve all four before
    `implementation-ready`.
  - Ledger citation imprecision fixed in product-spec.md: the "mapper-lockstep" trap is correctly
    in `fails.md` (2026-08-05, live-strategy-alert-engine); the `manage_strategy` partial-update
    pattern actually lives in `insights.md` (2026-07-26, 2026-08-06), not `fails.md` — corrected.
- Overlap findings: CLEAN. Next migration NNN = `012` (last is `011_opportunities`), next proto
  field number = `11` (fields 1-10 in use, `cooldown_days`=9, `warnings`=10) — both currently
  unclaimed. Low-risk shared-file note: `xstockstrat-agent/app/tools.py` is also touched by
  `085-mcp-python-sdk-v2-upgrade` (code-completed) — no key/field/migration overlap, re-check at
  impl-spec time if 085 hasn't landed. `analysis.strategy_cooldowns` table (069/070 precedent) is
  trunk context only, not a live collision.
- Additional design-phase note from review: `_definition_fingerprint` (servicer.py:2928-2944) is
  opt-OUT (`_FINGERPRINT_EXCLUDED_KEYS`), so FR-9 is likely satisfied automatically once the new
  field round-trips through `definition_json` — design should confirm the new field is never added
  to that exclusion set.

Next: `/sdd-design exit-cooldown` (full mode, per explicit user request).
