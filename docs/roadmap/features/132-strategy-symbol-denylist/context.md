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

### Phase 1 round 2 (proposer + adversary) + user steer → round 3

- Round-2 adversary verdict NEEDS WORK (no Floor breach). Verified SOUND: all field numbers
  (denied_symbols=12, signal_eligible=14, Opportunity.muted=12; 133 owns user_id=13; 134's
  reliability_weight=12 is on ingest.SignalSource, a different message); the `_row_to_strategy_definition`
  "no explicit line needed" claim (JSONB fields flow via ParseDict; 048 lockstep only applies to
  column-backed fields like 133's live_enabled/user_id); plain-bool `signal_eligible` has no
  false-vs-absent defect. Folded correctness fixes:
  - **Resolver returns structured `(surviving_universe, deny_entry_set)`** — a single `union − denied`
    return cannot express "keep held-denied for EXIT but block ENTRY"; the live-loop universe must be
    `(union − denied) ∪ (held ∩ denied)` with `deny_entry = denied ∩ universe`.
  - **`deny_entry` must NOT reach `_replay_state`** (shared `_apply_transition` core also drives restart
    replay) — default false, passed only to the live `latest` path; else a held-denied symbol
    reconstructs flat-on-restart and its exit never fires.
  - **C-03 live-loop owner-fetch wiring** must be spec'd: `_run_cycle` fetches owner-scoped
    watchlist/held (+signals iff signal_eligible) and synthesizes `x-user-id` per strategy owner
    (reuse 133's synthetic-header mechanism).
  - **C-11 allowlist × signal_eligible**: an allowlist strategy that's also flagged silently gets no
    signals (allowlist-as-override wins) — document + wizard note (or reject the combo at write time).
- **USER STEER (Fork B refinement):** the `signal_eligible` flag does NOT fully bound starvation —
  even with zero flagged strategies, watchlist∪held balloons every strategy's universe and
  `max_strategies_per_cycle=50` truncates silently over an unordered SELECT. User chose **"Build
  fair-share now (round 3)"**: design per-strategy round-robin / fair scheduling into `_run_cycle`
  this feature (not just deterministic ORDER BY + a metric). Round 3 designs it.

### Phase 1 round 3 (proposer + adversary) — fair scheduler + fixes

- Round-3 proposer designed the fair scheduler (deterministic ORDER BY created_at,strategy_id +
  rotating cursor over a flattened pairs list, budget stays max_strategies_per_cycle, + truncation
  log/OTel counter) plus all folded round-2 fixes.
- Round-3 adversary verdict NEEDS WORK (no Floor breach). VERIFIED SOUND: allowlist×signal_eligible
  write-reject is NOT bypassable by a two-step masked update (`_validate_definition` runs on the
  MERGED def, `servicer.py:1705`/`:1682`); `deny_entry` threading correct (entry-only short-circuit
  `:67-70`, exit branch `:71-74` untouched, replay default False `:103`). Three defects to fix:
  1. **Held+denied double-row** — resolver keeps held-denied in `universe` AND it's in `.denied`, so
     without a `− held_norm` guard the muted emission creates a SECOND row (the exact bug 131 killed
     via its held_norm exclusion, 131 design.md:125,305-317). Fix: set `muted=True` on the EXISTING
     held row; standalone muted emission covers only `denied ∩ union − held_norm`.
  2. **entry_backfill → strategy_cooldowns narrows the pair-set** — `strategy_cooldowns` keys exclude
     exactly the never-persisted >365d-old open positions feature 116 targets (fails.md narrowed-subset
     trap). Fix: source the backfill pair-set from the resolved live universe (held ⊆ union via
     ListPositions), not strategy_cooldowns.
  3. **Scheduler window unclamped + integer cursor unstable under churn** — common case is
     len(pairs)<50 so unclamped wrap double-evaluates; and an integer cursor % a list rebuilt every
     cycle has no stable index→pair identity. Fix: clamp to min(max_pairs,len(pairs)) + dedupe on wrap;
     identity-keyed resume cursor (resume after last-processed (created_at,strategy_id,symbol)) which
     also survives restart.
  Minor: record the full-universe-resolution cost-shift (2×owners+1 RPCs/cycle) bounded by the `_lock`
  cycle-skip (`live_loop.py:176-178`).
- User chose **"Run round 4"** to pressure-test the three folded fixes before approval. Round 4 in
  progress (cap is 5).

### Phase 1 round 4 (proposer + adversary) — three fixes nailed

- Round-4 proposer specified the three round-3 fixes concretely; round-4 adversary confirmed FIX 3
  (clamped identity-keyed scheduler) correct and found 4 remaining defects, all with clear remedies
  (now folded, verified in round 5):
  1. **muted persistence** — `analysis.opportunities` has no `muted` column + fixed INSERT/SELECT, so
     a top-level `row["muted"]` is dropped at persist. Fix: `"denied"` provenance marker is the
     persisted carrier; derive `opp.muted = ("denied" in provenance)` in `_row_to_opportunity`.
  2. **bucket-predicate double-row** — a watchlist-denied `(X,A)` is is_watchlist AND muted, landing
     in both `curated` and `muted_only` → duplicate opportunity_key → PK collision. Fix: buckets
     disjoint — `muted_only = muted and not (is_watchlist or is_held or is_live)`; the trace-skip
     predicate `muted and not is_held` is a different test, not the bucket predicate.
  3. **entry_backfill boot-race** — `run_once` fires at t=0 concurrent; routing its pair-set through
     resolve_universe adds a portfolio dependency whose cold-boot empty-held result makes the one-shot
     pass miss the >365d held positions 116 anchors → permanent exit suppression. Fix: gate run_once on
     portfolio readiness (wait_for_ready/retry).
  4. **scheduler zero-guard** — only advance cursor when n>0 (avoid ZeroDivision on empty pairs).
- User chose **"Run round 5 (final, cap)"** to verify the four remedies. Round 5 in progress.

### Phase 1 round 5 (cap) — APPROVE-READY → design-approved

- Round-5 proposer locked the four round-4 remedies with cited code (+ caught `_primary_source` must
  skip `"denied"`, and budget must subtract `len(muted_only)`). Round-5 adversary verdict
  **APPROVE-READY**: all four remedies correct against real code; `TestOpportunityRowParity`
  (`test_analysis_servicer.py:4016-4019`) actively enforces the muted mapper; three buckets provably
  disjoint; R4 zero-guard sound; R3 residual bounded/logged/no-worse-than-116. No Floor breach across
  all 5 rounds. Two non-blocking impl notes carried to /sdd-spec: (a) capture the portfolio *channel*
  object (not the stub) for `channel_ready()`, apply the gate per allowlist-free pair with TimeoutError
  caught; (b) the backend `ListOpportunities` read query's conviction floor (`opportunities.py:105`)
  must also exempt muted rows (`OR provenance ? 'denied'`), not just the UI filter, or FR-5's "never
  vanish" fails at the DB layer.
- **User APPROVED the design.** Written: design.md (full approach + all round 1-5 fixes + Open Risks).
  Amended 131's design.md (FR-6 amendment block). Updated merge-order.md (132→133, 132→131 rows;
  cohort order 133→134→131→132). Amended product-spec.md: FR-1/AC-2 (entry-only deny), AC-5
  (allowlist-as-override), new FR-8 (signal_eligible), new FR-9 (fair-share scheduler), Proto Contract
  Changes (signal_eligible=14, Opportunity.muted=12).
- Status: spec-ready → **design-approved**. Next: `/sdd-spec strategy-symbol-denylist`.

## Session 2026-08-14 — sdd-spec

- Generated implementation-spec.md with 17 steps. Status `design-approved` → `implementation-ready`.
- Structure: proto (Step 1, 3 additive fields) → proto-gen (2) → analysis service+test pairs (3/4
  resolve_universe helper + maskability + allowlist×signal_eligible reject; 5/6 entry-only deny +
  fair-share scheduler + owner-scoped universe; 7/8 muted rows + read-filter exemption; 9/10 precondition
  removal + entry_backfill union sourcing + portfolio-readiness gate) → agent (11/12 manage_strategy
  fields + strat-lab skill same-PR) → UI (13 wizard, 14 symbol-page masked mute, 15 opportunities
  muted-row, 16 e2e) → docs (17). C-14 consumer surfaces both covered (UI /insights + agent
  manage_strategy).
- Key codebase findings (current trunk, features 131/133 NOT yet merged):
  - `analysis.proto`: `StrategyDefinition` highest field = `exit_cooldown_days = 11` (`:273`) → field 12
    free; `Opportunity` highest = `provenance = 11` (`:458`) → field 12 free. Confirms `denied_symbols=12`,
    `signal_eligible=14` (13 reserved for 133's `user_id`), `Opportunity.muted=12` all free. No
    `user_id`/`denied_symbols`/`signal_eligible`/`muted` on trunk today.
  - `strategy_symbols(definition)` at `live_loop.py:37-47`; callers `live_loop.py:210`,
    `entry_backfill.py:83` (import `:18`), `servicer.py:1838` (SetStrategyLive precondition, local import
    `:1824`). `_apply_transition` `:50-75` (entry `:67-70`, exit `:71-74`); `_run_cycle` truncate-at-cap
    `:185-206`; `_lock` cycle-skip `:176-178`.
  - `_compute_opportunities` `servicer.py:2083`; `_candidate` template `:2113-2127`; held loop `:2144-2150`;
    signals-merge `:2154-2168`; max_universe cut `:2170-2177`; `_row_to_opportunity` `:2590-2608`;
    `_primary_source` `:2580-2587`; `_normalize_symbol` `:2542`; `_MASKABLE_PATHS` `:2873-2883`;
    `_validate_definition` on merged def at `:1705`.
  - Agent: `manage_strategy` tool `tools.py:488` (supplied dict `:572-583`, mask `:581`); client
    `client.py:396` (`StrategyDefinition(...)` `:425-438`); strat-lab `SKILL.md:44-57`.
  - UI: `StrategyWizard.tsx:108` (cooldown state `:121-126`, submit `:172-197`); `useManageStrategy`
    `useStrategyDefinitions.ts:34-43` (no update_mask today — full-replace); `insightsBff.manageStrategy`
    `:42-54`; `market/[symbol]/page.tsx` loads no strategy-write path today (`:44,:97-109`).

## Decisions (durable)

- 132 executes/merges LAST (`133 → 134 → 131 → 132`). The impl-spec grounds every step in current-trunk
  `path:line` and flags each 131/133-dependent anchor; a conditional evidence-only re-spec pass runs
  immediately before /sdd-execute once 131 and 133 land (mirrors fails.md 019/041). Reviewer snapshot is
  the 4 step-reviewers (Proto, analysis, ui, agent); portfolio owner / Platform Lead own no step because
  the design adds no new portfolio RPC (reuses 133's owner-scoping mechanism).

## Open Threads

- Re-run `/sdd-spec` (evidence-only) after 131 + 133 merge to refresh shifted line numbers before execute.
- Accepted residual: entry_backfill cold-boot no-retry (Step 9/10, no worse than shipped 116).

## Session 2026-08-15 — sdd-execute (sequential, stacked on 131)

Stacked on `feature/live-strategy-opportunity-attribution` (131, PR #954 open). 131 + 133 have
landed (133 merged; 131 in this stack), so the spec's re-spec gate was satisfied inline: each
analysis anchor is re-grounded by name against the landed tree during execution (the pre-131 spec's
line numbers are stale, and it did not know 131 added a 5th `strategy_symbols` caller in
`_compute_opportunities` — the design anticipated this; Step 7 migrates it to `resolve_universe().union`).

### Step 1 — proto: denied_symbols/signal_eligible/muted [done]
- `analysis.proto`: `StrategyDefinition.denied_symbols=12` (entry-only deny), `signal_eligible=14`
  (13 taken by 133's user_id); `Opportunity.muted=12`; maskable-paths comment extended. buf lint +
  breaking clean (additive).
### Step 2 — proto-gen [done]
- `./scripts/buf-gen.sh`; only `analysis.v1` stubs changed; idempotent.
### Step 3 — service: resolve_universe + maskable paths + reject [done]
- `live_loop.py`: `resolve_universe(definition, watchlist, held, signals) -> ResolvedUniverse`
  (universe/deny_entry/union/denied). `strategy_symbols` retained as the allowlist extractor
  resolve_universe reuses — its 5 callers migrate in Steps 5/7/9, then it can be removed
  (**deviation**: spec said "replace" in Step 3; kept to keep intermediate commits importable).
- `servicer.py`: `_MASKABLE_PATHS += denied_symbols, signal_eligible`; **pulled forward** the
  one-line `Opportunity.muted` mapper in `_row_to_opportunity` (inert until Step 7) so the OR-F
  parity test stays green now the proto field exists (**deviation** — mapper line is Step 7's, but
  the parity test breaks at Step 2).
- `evaluator.py::_validate_definition`: reject merged allowlist × signal_eligible (INVALID_ARGUMENT).
### Step 4 — test: resolve_universe/masking/reject [done]
- `TestResolveUniverse` (4 branches), `TestDenyListMaskingAndValidation` (masked set+clear,
  register-reject, two-step-masked-flip reject, definition_json round-trip), parity `_MAPPED += muted`.
- TDD: reject/masking assertions target Step-3 behavior. Full suite 483 passed, 82.8%.

### REMAINING (Steps 5–17) — not yet executed
- **5-6** live loop: entry-only deny + fair-share scheduler + **owner-scoped universe** (the loop must
  fetch per-owner watchlist/held/signals to call resolve_universe) + tests. **Largest step.**
- **7-8** `_compute_opportunities`: migrate `live_by_symbol` to `resolve_universe(...).union`, emit
  muted rows, read-query conviction-floor exemption + tests.
- **9-10** remove SetStrategyLive empty-symbol precondition; migrate `entry_backfill` to the resolved
  union; then `strategy_symbols` has no external callers — remove or keep private + tests.
- **11-12** agent `manage_strategy` exposes denied_symbols/signal_eligible + `strat-lab` skill + tests.
- **13-16** UI: StrategyWizard deny-list chips + signal_eligible toggle; Symbol-page mute control;
  Opportunities muted-row treatment; e2e + fixtures (C-12).
- **17** docs: analysis CLAUDE.md + mcp-tools reference.

## Session 2026-08-15 (cont.) — Steps 3–17 executed (stacked on 131, then rebased onto main-dev)

131 merged mid-session (PR #954); rebased this branch onto the updated main-dev (drops 131's commits).
Each 131/133-dependent anchor was re-grounded inline against the landed tree (the pre-131 spec's line
numbers were stale, and it did not know 131 added a 5th `strategy_symbols` caller in
`_compute_opportunities` — the design anticipated it; Step 7 migrated `live_by_symbol` to
`resolve_universe(...).union`).

- **Steps 3–4** [done]: `resolve_universe` helper + `ResolvedUniverse`; `_MASKABLE_PATHS` += the two
  fields; `_validate_definition` allowlist×signal_eligible reject; unit tests. **D-1, D-2.**
- **Steps 5–6** [done]: live-loop rewrite — entry-only deny in `_apply_transition`; owner-scoped
  per-cycle universe (portfolio_stub added, wired in main.py); fair-share rotating scheduler
  (`_cursor_key`, OTel truncation counter); comprehensive tests. **D-4** (FR-6 guard narrowed).
- **Steps 7–8** [done]: muted rows in `_compute_opportunities` (held-denied flags exit row, non-held
  0/0 placeholder), three-bucket cut, read-query `OR provenance ? 'denied'` exemption, mapper +
  parity + tests.
- **Steps 9–10** [done]: SetStrategyLive empty-symbol precondition removed; `entry_backfill` sources
  `resolve_universe(...).union` via the loop's drains. **D-3** (readiness via best-effort drains, no
  channel_ready gate).
- **Steps 11–12** [done]: agent `manage_strategy` exposes `denied_symbols`/`signal_eligible`;
  strat-lab skill updated same-PR; tool/client/builder-parity tests.
- **Steps 13–16** [done]: StrategyWizard deny chips + toggle; `useManageStrategy` optional
  `updateMask`; Symbol-page masked mute control; Opportunities muted-row treatment (desktop + mobile);
  e2e fixtures + specs. tsc+lint clean; e2e is the CI gate (cold warmup times out locally).
- **Step 17** [done]: analysis `CLAUDE.md` § Decide-surface RPCs + `mcp-tools.md` `manage_strategy`
  params/errors updated.

Teardown: `/context-scrubber` plugin not installed this session — touched context docs
(`analysis/CLAUDE.md`, `mcp-tools.md`, strat-lab `SKILL.md`) reviewed by hand against the code.
