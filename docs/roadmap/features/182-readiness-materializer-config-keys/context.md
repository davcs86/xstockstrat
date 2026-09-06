# Context: readiness-materializer-config-keys

**Feature**: `docs/roadmap/features/182-readiness-materializer-config-keys/feature.md`
**Product Spec**: `docs/roadmap/features/182-readiness-materializer-config-keys/product-spec.md`
**Implementation Spec**: `docs/roadmap/features/182-readiness-materializer-config-keys/implementation-spec.md`

---

## Session 2026-09-06 — sdd-story

- Created feature.md (status: draft), product-spec.md, acceptance.feature, context.md from user story.
- Origin: follow-up to feature 181. Operator could not enable the feature-180 readiness materializer
  because `analysis.readiness_materializer.*` keys are unregistered (no-seed pattern) and config-ui
  only edits registered keys; global `SetConfig create_key=true` requires admin scope (the MCP session
  used lacked it). Chosen path (operator decision): register the keys via a seed migration so config-ui
  can show/toggle them.
- Scope decision: seed at CURRENT code defaults (enabled=false) → registration is a no-behavior-change
  governance change; enabling is a later operator config-ui toggle.
- Known trap carried in (migration 026 scar): the `key` column must be the FULL dotted reader string
  and `value_type` must match the getter, or the row is a silent orphan. Mirror
  `026_analysis_engine_blend_keys` exactly (columns, per-env global rows, ON CONFLICT DO NOTHING).
- Branch note: harness-designated branch is `claude/watchlist-stock-list-perf-o3qoqb` (its prior PR is
  merged); this follow-up will restart that branch from origin/main-dev and open a NEW PR to main-dev,
  rather than a `feature/<slug>` branch, per the standing harness branch constraint.

## Session 2026-09-06 — sdd-review product-spec

- Product spec approved. Status: draft → spec-ready.
- First pass FAILed on criterion 9 (unchecked Open Questions) + an advisory getter-typing warning;
  fixed both (commit 672747e): resolved all three Open Questions to [x]; corrected FR-1 to record the
  exact getter per key — notably `analysis.readiness_materializer.max_concurrent_bars_fetches` is read
  via `get_int` (zero-trap, servicer.py:454), NOT `get_int_present`; seed `int`/`2` is safe because it
  equals the code default. Re-review: PASS, 0 warnings.
- Overlap findings: none (migration 027 free; four keys only read — not seeded — by features 180/181;
  advisory 180→182 logical ordering, no blocking merge-order row).
- Warnings carried to design: when writing 027, a future operator setting
  `max_concurrent_bars_fetches=0` would have `get_int` collapse it back to `2` — do NOT seed `0`.

## Session 2026-09-06 — sdd-design (quick, 1 round)

- Phase 0 Recon: wrote recon.md (services: config [migration], analysis [docs-only], ui [render]).
  Key reuse patterns: mirror `026_analysis_engine_blend_keys` seed shape; feature-161 decay-key
  precedent for config-ui surfacing + bounds.
- Phase 1 Grilling: 1 round. Proposer said DEFER bounds; adversary refuted it (bounds are write-path
  only → NOT a behavior change; `max_concurrent_bars_fetches` is a live feature-141 SEV-2 lever once
  operator-editable, `refresh_hour_utc` has no reader clamp). No Floor breach.
- **Operator decision at the gate (P-04 sign-off):** key-scope = **all four keys + write-bounds**;
  `max_concurrent_bars_fetches` ceiling = **5** (marketdata PgBouncer pool size). This EXPANDS scope
  beyond the original "migration + docs only": now also a config-service code change (three
  `SCALAR_BOUNDS_REGISTRY` entries in `configServiceImpl.ts`). product-spec (FR-5 narrowed, FR-6 added,
  Affected Services updated) + acceptance (@AC-7/@AC-8 bounds, @AC-9 write-path-only) updated to match.
- Chosen approach: seed 4 keys at code defaults (enabled=false → no behavior change, PRESERVE
  @AC-2/@AC-3) + bounds refresh_hour_utc[0,23]/valid_window_hours[1,168]/max_concurrent_bars_fetches[1,5]
  (EXTEND @AC-6/@AC-7/@AC-11/@AC-12); surgical docs edit (only the 4 rows); scoped down-delete
  (`AND user_id IS NULL`).
- Constitution rules touched: C-05, C-07, C-16, P-03, F-01, F-04, F-06, F-07. Floor breaches: none.

## Open Threads (carry into /sdd-spec + /sdd-execute)

- [ ] **SCALAR_BOUNDS_REGISTRY int support** — registry holds only float keys today
  (`configServiceImpl.ts:98-103`); /sdd-spec MUST verify the enforcement path (~`:379-386`) applies to
  int values. If float-only, spec adds minimal int handling OR re-gates to seed-only-`enabled`.
- [ ] **Migration 027 bind-at-rebase** — reconfirm next-free vs main-dev right before execute; announce
  in merge-order.md; renumber on collision (feature-020 scar).
- [ ] **No migration CI gate** — execute self-verifies up/down/up on a local config DB if reachable,
  else read-back review + record the gap.
- [ ] **config-ui visibility needs a config-service reload** — raw INSERT fires no pg_notify; keys show
  only after config-service restart (deploy) or next analysis-namespace SetConfig; note in rollout.
- Status: spec-ready → design-approved.
