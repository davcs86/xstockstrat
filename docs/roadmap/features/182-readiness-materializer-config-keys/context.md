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

## Session 2026-09-06 — sdd-spec

- Generated implementation-spec.md with 5 steps. Status → implementation-ready.
- Key codebase findings:
  - Migration 027 confirmed next-free (last is `026_analysis_engine_blend_keys`); `024` is a permanent
    documented gap. Mirror 026's INSERT tuple + `ON CONFLICT (namespace,key,environment,COALESCE(user_id,'')) DO NOTHING`;
    down = explicit key-IN delete + `AND user_id IS NULL`.
  - **Full-dotted `key` column is mandatory.** analysis reads via exact-string lookup
    `watcher.py:90 values.get(key)` with the full-dotted key (servicer.py:4173/4075/3044/4092/454). 026
    (full-dotted) is the verified-correct precedent; **019 (`scoring.signal_decay_half_life_hours`,
    stripped) is a latent reader-orphan masked by default==seeded 24.0** — the migration-008 trap. Do not
    replicate stripped form.
  - **design.md Open Risk #1 RESOLVED + refined.** `SCALAR_BOUNDS_REGISTRY` int enforcement IS present
    (`configServiceImpl.ts:379-389` `Number(extractValueData(value))`, type-agnostic; `extractValueData`
    reads `int_val ?? intVal`, `:559-563`; existing `setConfigScalarBounds.test.ts:131-147` already tests
    the int path). But discovery found a NEW wrinkle the design missed: the registry/listKeys/setConfig
    lookup is `` `${namespace}.${key}` ``, keyed on the SetConfig **request** key (= DB `key` column).
    The two existing bounded keys use a **stripped** `key` column so it matches; 182's **full-dotted** key
    column makes config-ui's lookup `analysis.analysis.readiness_materializer.*` (double prefix) → miss →
    bounds silently wouldn't fire. **Chosen fix (Step 2): robust two-operand lookup** — bare `key` first,
    then `` `${namespace}.${key}` `` — at BOTH `:379` (setConfig) and `:495` (listKeys). Backward-compatible
    (stripped keys fall through), registers the 3 keys under natural full-dotted names, self-documenting.
    Alternatives (A double-prefix registry keys; B re-gate to seed-only-enabled) recorded, not chosen.
    **Flagged for /sdd-review impl-spec sign-off** (a spec-time refinement of the design's Open Risk #1).
  - Bounds: `refresh_hour_utc [0,23]`, `valid_window_hours [1,168]`, `max_concurrent_bars_fetches [1,5]`
    (ceiling = marketdata PgBouncer pool size 5, feature-141 SEV-2 guard). `enabled` bool → no bound.
  - Consumer surface C-14: `/config-ui` reached with **no UI code change** (generic NamespaceEditor +
    ListKeys ValidationRule render); visibility needs a config-service reload (raw INSERT → no pg_notify).
  - config test/lint: `pnpm run test:coverage` (c8 --lines 40) + `pnpm run lint` (eslint), confirmed in
    package.json.

## Open Threads (carry into /sdd-spec + /sdd-execute)

- [ ] **Bounds-registry double-prefix fix (Step 2, NEW at spec time)** — the robust two-operand lookup is
  a config-service code change beyond design's "migration + 3 registry entries"; get impl-spec review
  sign-off. If rejected, fall back to double-prefixed registry keys (Option A) or seed-only-enabled
  (Option B, re-gate).
- [ ] **019 decay-key reader orphan (out of scope, informational)** — migration 019 stores the stripped
  `key` column while the reader reads full-dotted; operator config-ui edits never reach the analysis
  reader (masked because default==seeded 24.0). NOT fixed by 182; noted for a future triage.

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
