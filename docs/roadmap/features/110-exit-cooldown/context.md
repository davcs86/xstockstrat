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

## Session 2026-08-07T00:30:00Z — sdd-design

- Phase 0 Recon: wrote `recon.md` (services: xstockstrat-analysis, xstockstrat-agent,
  xstockstrat-ui, packages/proto; key reuse patterns: `cooldown.py`'s pure gate functions reused
  verbatim for the exit side; `StrategyCooldownsRepository`/`analysis.strategy_cooldowns` extended
  rather than duplicated). Three `codebase-discovery` subagents ran in parallel per affected
  service. Key finding: the live loop tracks no entry timestamp at all today (only a boolean
  `_last_state`) — more implementation surface than feature 069's symmetric entry-side gate needed.

- Phase 1 Grilling: **6 rounds** (full mode; the user explicitly overrode the standard 5-round cap
  for a 6th completeness-audit round). Chosen approach: reuse `cooldown.py` (renamed
  direction-neutral parameter), extend `analysis.strategy_cooldowns` with `last_entry_at` (migration
  `012`), a shared `_apply_transition`/`_replay_state` free-function core so live-loop and
  restart-replay parity is structural (not test-maintained), a bounded 365-day bar-replay for the
  common restart case, and — per explicit user steering — a boot-time-only `entry_backfill.py`
  module that reconstructs entry time for positions older than the replay window from
  `xstockstrat-trading`'s `ListOrders` (real `strategy_id` attribution), never `xstockstrat-portfolio`
  (`Position` has no `strategy_id` — would have repeated the exact fabrication feature 083 already
  declined). A "skip-until-known" guard in `_eval_pair` closes the one remaining async-backfill race
  the user required closed, backed by a required throttled diagnostic log and 3 required paired
  tests (suppression/resolution/isolation).

  **Rejected**: inferring `_last_state` from last-entry/last-exit timestamp recency (undecidable for
  the deploy-day cohort); a new `entry_cooldown.py` sibling module (unnecessary — `cooldown.py`'s
  gate math is direction-agnostic); backfilling from `portfolio.Position` (no strategy attribution,
  would fabricate a link); widening `_LOOKBACK_DAYS` instead of an Order-based backfill (doesn't
  eliminate the gap, just shrinks it); accepting the >365-day-position gap as documented (user
  explicitly overrode this after round 2); making the boot backfill fully blocking (reintroduces the
  startup-latency problem the async design solves).

  **Key mid-debate steer**: after round 2 left a documented gap for positions held >365 days at
  deploy time, the user explicitly required a real fix ("do not accept the gap") rather than a
  narrowed acceptance criterion — this drove rounds 3-4's Order-based backfill design and round 4's
  discovery of the async-backfill race, which round 5 closed with the skip-until-known guard.

  **Round 6** (user-directed, beyond the standard cap): a completeness/consistency audit of the
  final document — re-verified 8+ citations fresh against live files (all held), then closed 3
  copy-edit-level gaps: `recon.md`'s Recommended Scope was stale relative to rounds 3-6 (amended to
  11 steps covering `entry_backfill.py`/`main.py` wiring, the second config key, and the guard/tests);
  a citation overstated `metadata=()` as "explicit" when the actual precedent relies on an implicit
  default (corrected); product-spec Open Question 4 (does the gate suppress the alert too?) was
  resolved by the control flow but never stated explicitly (added to design.md — yes, both,
  unconditionally, symmetric with the existing entry-side gate).

- Constitution rules touched: C-01, C-05, C-07, C-08, C-09 (at spec/execute time), C-10(b), C-13,
  C-14, F-01, F-06. No Floor breach in any round.

- Ledger: wrote 2 `insights.md` entries (2026-08-07, `exit-cooldown`) — (1) the asymmetry between an
  entry-side gate (naturally reachable regardless of a restart-state default) and an exit-side gate
  (unreachable if the restart-state default is wrong), a generalizable lesson for any future feature
  gating a *later* transition in an edge-triggered state machine; (2) when P-03 blocks fabricating an
  attribution from one domain object (`portfolio.Position` has no `strategy_id`), check one layer
  upstream in the data flow (`trading.Order` does) before accepting the gap.

- All 4 product-spec Open Questions closed by the design: field name `exit_cooldown_days` (settled
  round 1); durable-state shape = extend `analysis.strategy_cooldowns`, not a new table (round 1);
  known trap (C-10(b) mapper lockstep) — enumerated explicitly in design.md's Chosen Approach, not
  left to "mirrors `cooldown_days`" assertion; alert-suppression symmetry — closed round 6 (both
  transition and alert suppressed together, unconditionally).

- Status: `spec-ready` → `design-approved`. User approved design.md explicitly.

Next: `/sdd-spec exit-cooldown` — generate the implementation spec from the approved design.

## Session 2026-08-07T02:00:00Z — sdd-review impl-spec (advisory)

- Result: 1 failure (Blocker), 6 warnings (advisory — did not block). Overlap scan: CLEAN (no other
  in-flight feature touches `StrategyDefinition`'s proto fields, this service's migrations dir, or
  the two new config keys; `096-position-and-order-detail-pages` is the only other
  `implementation-ready` feature and is frontend-only, no file/resource overlap).
- All 6 design.md decisions named for verification are present as concrete steps — no dropped
  design decision (proto field 11, `cooldown.py` reuse, migration 012, shared
  `_apply_transition`/`_replay_state` core, `entry_backfill.py`, skip-until-known guard + required
  diagnostic + 3 required paired tests).
- Unresolved ✗ / ⚠ carried into execution:
  - Step 11: `**Files**` lists only `tests/test_live_loop.py`, but `**Verification**` instructs
    adding a code comment to `live_loop.py` (the guard site) — an **F-08** risk if executed
    literally (staging a file outside the step's declared Files section). Fix: move the comment
    instruction into Step 10 (where the guard is actually written), or add `live_loop.py` to Step
    11's Files. — [ ] unaddressed
  - Step 10: the skip-until-known guard is spec'd inside the pure `_apply_transition` function
    rather than literally inside `_eval_pair`'s `elif in_position and latest.exit:` block as
    design.md's round-5 "finalized" snippet shows. Functionally equivalent (isolation from the
    entry/re-entry branch holds structurally either way, and the 3 required tests catch a
    regression), but a literal deviation from a decision marked "finalized" — record a
    `## Deviation Log` note at execute time rather than silently diverging. — [ ] unaddressed
  - Step 10: the replacement code block doesn't explicitly show `latest = decisions[-1]` being
    retained even though `latest` is used later in the same snippet — minor ambiguity, likely
    resolves at discovery time. — [ ] unaddressed
  - Steps 17/18: neither includes `pnpm run lint` in its own or paired Verification (only present
    later, in the non-paired Step 21) — a strict per-step B2 lint-gate gap, caught before the final
    gate but not per-step compliant. — [ ] unaddressed
  - Step 2: `**Files**` lists three generated-output directories rather than exact files — standard
    practice for codegen steps, not a real defect. — [x] not applicable (accepted as idiomatic)
  - Step 12: own `ruff check` scoped to `entry_backfill.py` only, not the full service — functionally
    fine, full lint runs in paired Step 13. — [x] not applicable (no functional gap)
  - Step 13 (B2b, advisory): no test explicitly named against `ORDER_STATUS_PARTIALLY_FILLED`; the
    canceled-with-partial-fill test substitutes for it under the deliberately-unfiltered-status
    design. — [x] not applicable (design is intentionally unfiltered)
- Overlap findings: none (CLEAN).

Next: resolve the Step 11 Files/Verification mismatch (and ideally the Step 17/18 lint gap) before
`/sdd-execute exit-cooldown`, or proceed and let `/sdd-execute` surface them per C-02.

## Session 2026-08-07T01:00:00Z — sdd-spec

- Generated implementation-spec.md with 21 steps. Status → implementation-ready. `recon.md` +
  `design.md` were both present, so discovery reused recon's Codebase Map directly and only
  supplemented it with fresh Read/Grep evidence for detail below the dossier's altitude
  (exact code bodies of `cooldown.py`, `strategy_cooldowns.py`, `live_loop.py` (full,
  244 lines), `evaluator.py`'s validation precedent, `screener.py`'s semaphore pattern,
  `fundsignal_loop.py`'s boot-task/no-metadata pattern, `main.py`'s boot-task wiring,
  `config/watcher.py`'s `get_int_present`, the `trading.proto`/`trading.go` fields the
  boot-time backfill reads, `test_live_loop.py`/`test_analysis_servicer.py`'s existing test
  templates, the agent's `tools.py`/`client.py`/three test files, and the UI's
  `StrategyWizard.tsx`/`mock-backend.ts`/e2e spec/`INVENTORY.md`).
- Key codebase findings beyond recon.md/design.md:
  - `services/xstockstrat-agent/tests/test_strategy_builders.py:96-102` — a **descriptor-
    parity test** (`test_manage_strategy_definition_covers_every_proto_field`) will go RED the
    moment Step 2's regenerated `StrategyDefinition` proto lands `exit_cooldown_days`, until
    both `client.py`'s builder (Step 14) AND the test's own fixture (Step 15) carry the new
    field — this is the RC-1 antidote `insights.md` 2026-08-02 documents, confirmed live in
    this repo rather than assumed by analogy.
  - No dedicated `StrategyCooldownsRepository` unit test file exists today (confirmed via
    `Glob`/`Grep`) despite sibling repos (`strategy_scores`, `backtest_runs`,
    `backtest_details`, `backtest_run_symbols`) each having one — Step 5 creates
    `test_strategy_cooldowns_repo.py` for the first time, closing this pre-existing gap as a
    side effect of touching the file (not scope creep — C-08 requires the new
    `upsert_entry`/renamed `upsert_exit` methods to be tested regardless).
  - Confirmed `ListOrdersRequest` carries a `symbol` field (proto field 7) in addition to
    `strategy_id` — `app/engine/entry_backfill.py` can call `ListOrders(strategy_id=...,
    symbol=...)` per pair (one RPC per live pair, semaphore-bounded), not one unfiltered call
    per strategy requiring local grouping.
  - Interpreted one design.md ambiguity explicitly in the spec (Step 12): the boot-time
    backfill, upon finding a pair currently non-flat via real Order history, must set BOTH
    `live_loop._last_state[key] = True` AND `_last_entry_at[key] = <inferred>` together — not
    `_last_entry_at` alone — because `_last_state` for a position held longer than the 365-day
    bar-replay window can never otherwise become `True` (replay only detects an entry
    *crossing* within its fetched window; it cannot infer "already in position at the window's
    start"). Without this, the exit branch would stay permanently unreachable for exactly the
    >365-day-position cohort the design's round-2 user steering required covered. Flagged
    explicitly in the step's Instructions (not silently assumed) since design.md's prose
    describes the race-condition fix but not this specific write-back detail in code form.
- No new feature-number/proto-field/migration-NNN collisions found at spec time (re-confirmed
  `011_opportunities` is still the last migration and field 11 is still free).

Next: `/sdd-review exit-cooldown impl-spec` — validate implementation spec, then
`/sdd-execute exit-cooldown`.
