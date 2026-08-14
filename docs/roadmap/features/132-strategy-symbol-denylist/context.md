# Context: strategy-symbol-denylist

**Feature**: `docs/roadmap/features/132-strategy-symbol-denylist/feature.md`
**Product Spec**: `docs/roadmap/features/132-strategy-symbol-denylist/product-spec.md`
**Implementation Spec**: `docs/roadmap/features/132-strategy-symbol-denylist/implementation-spec.md`

---

## Session 2026-08-14T04:00:00Z — sdd-story

- Created feature.md (status: draft), product-spec.md, context.md from user story.
- **Origin**: raised mid-session while discussing 134/131/022 (signal source weights,
  live-strategy-opportunity-attribution, signal decay). User asked two things: (1) a conceptual
  question about how signal-conviction vs. readiness-conviction contradictions rank in the
  Opportunities queue (answered directly, no code change needed — the two axes are deliberately
  never blended per feature 097's Option 2; `conviction` stays purely rule-based/readiness-driven,
  `signal_axis` stays purely signal-driven, they only combine in the queue's *sort order*, never in
  the `action_tag`); (2) this feature — replace the opt-in `signal_params.symbols` allowlist with a
  deny list.
- Before storying, asked two clarifying questions via `AskUserQuestion` (per CLAUDE.md behavior #1 —
  a deny list implies an unstated "everything else" universe, and this directly collides with
  131-live-strategy-opportunity-attribution's design, which assumes the opt-in list):
  1. **Universe scope** — user chose "Union of Watchlists, Held positions and Active Signals" (not
     the broader marketdata-wide universe, not a new admin-curated list). This is elegant: it's
     exactly the same union `_compute_opportunities` already builds per-user
     (`watchlist_by_symbol`/`held_norm`/`signals_by_symbol`, `servicer.py:2102-2109`) — reuses an
     existing shape rather than inventing a second one.
  2. **131 interaction** — user chose "Amend 131's design before /sdd-spec" (not a competing
     feature that blocks/supersedes 131 as a separate artifact). 131 is `design-approved` but not
     yet implemented (still spec-ready in `merge-order.md`'s sequence, waiting on 134), so amending
     its design.md directly (rather than leaving it as dead weight) is the correct move — this will
     happen during `/sdd-design` for 132, not during this story pass.
- **Grounded FR-1's proto field** directly: `StrategyDefinition` (`analysis.proto:249-274`) next
  free field number is `12` (after `exit_cooldown_days = 11`); persists via `definition_json JSONB`
  (`migrations/001_strategies.up.sql:4`) — confirmed no migration needed, same as every other
  `StrategyDefinition` field.
- **Grounded FR-4's UI surfaces** directly (not assumed from the user's description): confirmed
  `/insights/market/[symbol]/page.tsx` (Symbol detail) and `/insights/strategies/[id]/edit/page.tsx`
  (Strategy edit) both exist on disk (`find` confirmed) — these are the two pages the user named.
- **Surfaced a critical, unresolved architecture question** in product-spec.md's Open Questions
  (not resolved in this story — deliberately deferred to `/sdd-design` Phase 0 Recon, per this
  session's own established pattern of not letting an SDD phase silently assume feasibility): FR-3's
  union requires aggregating watchlist + held positions **across all users**, but `live_loop.py`
  evaluates strategies platform-wide (no `user_id` on strategies — same fact
  `insights.md` 2026-08-13 already names), while `ListPositions`/`ListWatchlists`
  (`portfolio.proto:132-138,213-217`) are strictly single-user-scoped (by request field or
  `x-user-id` header respectively) — grep-confirmed no cross-user "list all" RPC exists on
  `portfolio.proto` today. Active signals (`QuerySignals`) are already platform-wide, so only the
  watchlist/held portions of the union are actually blocked on this gap. Three candidate resolutions
  named (new cross-user admin RPC; split live-loop's own alerting universe from Opportunities'
  read-side attribution universe; something else) — none chosen, this is explicitly `/sdd-design`'s
  job to resolve against real code, not this story's.
- Also surfaced (Open Questions): `analysis.engine.max_strategies_per_cycle`'s cap
  **truncates rather than round-robins** (`insights.md` 2026-08-13, `live_loop.py:102-110`) — if
  FR-3's union meaningfully grows average per-strategy symbol counts vs. today's small opt-in
  lists, some `(strategy, symbol)` pairs could permanently starve, not just occasionally miss a
  cycle; flagged as in-scope for `/sdd-design` to assess, not a separate follow-up.
- Ledger check (`fails.md`/`insights.md`): re-confirmed the `023-position-sizing-engine`
  ordinal/cardinal trap (`Opportunity.conviction`) applies to FR-5's skipped/muted row design — a
  skipped row's absent trace must not be represented as `conviction=0`, carried into Open Questions
  as an explicit guardrail for `/sdd-design`.
- Consumer surface (C-14): UI (`/insights` — Symbol page, Strategy edit page, Opportunities page) +
  Agent (`manage_strategy` MCP tool + `strat-lab` plugin skill, per root CLAUDE.md's same-PR rule
  for changes to that tool).
- Status: draft. Next: `/sdd-review strategy-symbol-denylist product-spec`.

## Session 2026-08-14T04:30:00Z — dependency created: 133-strategy-user-ownership

- User's resolution to this story's critical Open Question (cross-user aggregation for FR-3's
  universe): make strategies user-bound, closing the gap by construction. Storied as a new,
  separate feature — `133-strategy-user-ownership` — since it's a foundational, wide-blast-radius
  change (composite `(user_id, strategy_id)` uniqueness, full ownership gating including
  `RunBacktest`, touches every table/proto referencing a bare `strategy_id`) well beyond this
  feature's own scope.
- **133 is now a hard prerequisite for this feature's FR-3** (the union-universe mechanism needs a
  resolved owner to scope `ListPositions`/`ListWatchlists` against). FR-1/FR-2 (the
  `denied_symbols` proto field + `ManageStrategy` masking), FR-4 (UI edit surfaces), and FR-7 (agent
  tool) may not need to wait — `/sdd-design` for this feature should confirm exact sequencing once
  133 has its own design.
- **Field-number coordination**: this feature claims `StrategyDefinition` field `12`
  (`denied_symbols`); 133 claims field `13` (`user_id`). Whichever feature's `/sdd-spec` runs second
  must re-verify the number is still free against the other's actual landed state, not this
  session's snapshot.
- `merge-order.md` not yet updated — deferred until `/sdd-design` confirms the exact dependency
  shape between 132 and 133 (full block vs. partial-landing split).

## Session 2026-08-14T05:00:00Z — sdd-review product-spec (PASS WITH WARNINGS)

- Criteria verdict: PASS WITH WARNINGS. No Floor breach. One real defect found and fixed: the
  compute-cost Open Question cited `live_loop.py:102-110` for the truncate-vs-round-robin
  `max_strategies_per_cycle` claim — actually `_replay_state`, unrelated code. Corrected to the real
  location, `live_loop.py:188-196` (the `SELECT ... WHERE live_enabled = TRUE AND active = TRUE` +
  `if processed >= max_pairs: return` logic). Other warnings (FR-3/FR-5/AC-5 deferring exact
  mechanism to `/sdd-design`) accepted as legitimate per this pipeline's own established precedent
  (131's product-spec review treated the identical pattern as WARN, not FAIL — cited directly by the
  reviewer).
- Overlap verdict: file-level overlap found with `131-live-strategy-opportunity-attribution` on the
  exact code region this feature's FR-3 must rewrite (`_compute_opportunities`,
  `strategy_symbols()`) — but this is the *expected* overlap FR-6 already commits to resolving (amend
  131's design.md directly, not land as a competing change), not an accidental collision. No resource-
  number collisions: proto field `12` (`denied_symbols`) confirmed disjoint from 133's field `13`
  against real trunk (`analysis.proto:273` — last used field is `exit_cooldown_days=11`).
- Status: draft → spec-ready.
- Next: `/sdd-design strategy-symbol-denylist` — expected to depend on 133 reaching at least
  `design-approved` first (its identity contract determines how FR-3 gets built).

## Session 2026-08-14 — sdd-design (in progress)

- Phase 0 Recon: wrote recon.md via 3 parallel codebase-discovery agents (analysis, ui, agent).
  Key facts: `StrategyDefinition` field 12 free (`denied_symbols`), 133 claims 13 (`user_id`);
  `Opportunity` field 12 free (`provenance=11` is highest); no migration (JSONB). **Nothing is on
  trunk yet** — 131's `live_by_symbol`/`is_live`/caps, 133's ownership, and `denied_symbols` are all
  design-approved but unimplemented.
- **USER-LOCKED FORK 1 (decomposition/merge-order)** via AskUserQuestion: **Layer 132 on 131** →
  build/merge order `133 → 134 → 131 → 132`. 131 ships the live-attribution machinery first
  (`live_by_symbol` built by calling `strategy_symbols()`); 132 layers the deny-list on top by
  redefining `strategy_symbols()` from an allowlist to `union(watchlist, held, active-signal) −
  denied_symbols` (owner-scoped via 133), which 131's `live_by_symbol` picks up automatically. 132's
  spec is written *before* 131's (2nd in the spec order) so 132's design can amend 131's design.md
  first; execute order stays 133→134→131→132.
- **USER-LOCKED FORK 2 (FR-5 muted-row representation)** via AskUserQuestion, after user asked me to
  first research `Opportunity.provenance`'s existing uses: provenance = ordered de-duped **positive**
  contributing origins (`"watchlist"`/`"position"` structural markers + signal `sig.source`; 131 adds
  `"live_strategy"`), consumed by `_primary_source()` → `Opportunity.source` (field 8). A muted pair is
  the opposite (an exclusion, zero-compute, not even a materialized candidate today), so reusing
  provenance would repeat the fails.md-023 ordinal/cardinal conflation trap. **Decision: a DEDICATED
  backend flag** (e.g. `bool muted = 12` on `Opportunity`), a zero-compute row with empty readiness
  (NEVER `conviction=0`), parallel to 131's `is_live`, with a UI link back to the deny-list editor.
  Bool avoids the enum→TS-exhaustive-Record trap (fails.md 067).
- Phase 1 Grilling: in progress (full mode, ≥2 rounds) with both forks locked — debating the
  remaining decisions (AC-5 backward-compat, `strategy_symbols()` redefinition + owner-scoping,
  mask-vs-full-replace UI write, symbol-page plumbing, compute-cost/truncation fairness, FR-6
  amendment shape).

### Phase 1 round 1 (proposer + adversary) + user steers

- Round-1 adversary verdict NEEDS WORK (no Floor breach). Accepted fixes folded into round 2:
  C-14 muted-row UI surface (Opportunities card + mobile renderer; branch on `o.muted`; suppress
  action buttons; **exclude muted rows from the conviction filter/sort** so the min-conviction slider
  can't silently delete them); ONE shared owner-scoped union builder + parity guard (C-10b, not two
  divergent unions); AC-5 back-compat = **allowlist-as-universe-when-present** (a non-empty
  `signal_params.symbols` is treated AS the universe, deny still subtracts — union applies only to
  allowlist-free strategies, so a strategy scoped to `[AAPL]` doesn't suddenly fire platform-wide);
  add a real StrategyDefinition round-trip test for `denied_symbols` (plain+masked+masked-clear —
  the proposer's OR-F citation was a miscite, that test pins the Opportunity mapper); SetStrategyLive
  precondition edits must target 133's rewritten block and remove only the empty-symbol branch, with
  the feature-089 "stored-flag-never-fires" rationale recorded (P-03); symbol-page write should prefer
  server-side denied-set add/remove (or a version guard) over a client RMW of the whole array
  (lost-update hazard) — round 2 to nail the concrete mechanism.
- **USER-LOCKED FORK A (deny vs held):** **Entry-only deny (preserve exits).** Deny subtracts from
  the ENTRY universe + live-loop entry evaluation only; a held position keeps its exit-rule (REDUCE)
  tracing and exit alerts, annotated as muted rather than deleted. Deviates from FR-1's literal
  "regardless of held position" — amend product-spec FR-1 + AC-2 accordingly.
- **USER-LOCKED FORK B (live-loop universe scope):** **Keep active-signals in the firing universe,
  gated by a NEW per-strategy `signal_eligible` bool flag on `StrategyDefinition`.** Only flagged
  ("one or two screening") strategies pull the unbounded platform-wide active-signal term; default off
  → universe = `watchlist ∪ held ∪ allowlist − denied` (owner-scoped, bounded). New proto field
  (coordinate number: 12=denied_symbols, 13=user_id/133 → 14, verify vs 134), maskable path, wizard
  toggle, agent param. Folded in as a new FR (FR-8). Round 2 to also decide whether a secondary
  per-strategy cap / fair-schedule is still warranted on the live loop for the flagged set.
