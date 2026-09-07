# Design: opportunity-config-operability

**Created**: 2026-09-07
**Status when written**: spec-ready → design-approved
**Debate**: quick mode — 1 mandated round (proposer + adversary + synthesis), user-approved.

---

## Chosen Approach

A **config-only** feature. `xstockstrat-analysis` stays **docs-only** (readers already exist); no
proto change, no schema change, no analysis runtime-behavior change (PRESERVE `@AC-3`, and
`@AC-9 @feature-182` — bounds are write-path-only).

### 1. Seed migration `028_analysis_opportunity_keys.{up,down}.sql`
Mirror `027_analysis_readiness_materializer_keys.{up,down}.sql` verbatim (recon.md:60): same INSERT
column shape, per-environment fan-out (staging + production, `user_id NULL`),
`ON CONFLICT (namespace, key, environment, COALESCE(user_id,'')) DO NOTHING`, and an explicit
`key IN (...)` + `user_id IS NULL` down predicate. Seed **all 15** `analysis.opportunity.*` keys —
visibility for all 15 is committed by FR-1, independent of the bounds decision below. Each row:
- `key` column = the **full dotted** reader string (`analysis.opportunity.<name>`) — the WatchConfig
  snapshot is `values[row.key]` with no prefixing; a namespace-relative fragment is a silent orphan
  (recon.md:96, ledger insights 905/907).
- `value_type` = each getter's **storage** type, not a semantic type: `'float'` for
  `signal_rank_weight`, `'int'` for the other 14 (recon.md:65,98, ledger fails 409). A wrong
  `value_type` on a `get_int_present` key breaks `HasField('int_val')` → silent default.
- `value_data` = the current code default (recon.md:32-47), so seeding is a no-op on read (`@AC-3`).
- `028` is **provisional / bind-at-rebase**: reconfirm `max(NNN)+1` against `main-dev` at execute
  (C-07, ledger fails 1699/1702) — do not treat it as settled.

### 2. Bounds registry growth — the **justified set (~10 keys)** (user decision, this round)
Add data-only entries to the existing `SCALAR_BOUNDS_REGISTRY` (`configServiceImpl.ts:100`), keyed on
the **full dotted key**. No new code: the existing `lookupScalarBounds` two-operand probe (`:118-120`),
the SetConfig write edge (`:396`), and the ListKeys hint (`:513`) already consume the registry
(recon.md:61, ledger insights 3085-3101). Bounds are write-path-only — they touch no read path.

**Bounded (10) — every ceiling cites a real failure mode or precedent:**

| Key | Bound | Getter | Justification |
|---|---|---|---|
| `refresh_hour_utc` | `[0,23]` | `get_int_present` | hour-of-day; **lower 0 = midnight is a documented value** (PRESERVE `@AC-8 @feature-158`). |
| `max_concurrent_bars_fetches` | `[1,5]` | `get_int` | ceiling 5 = marketdata PgBouncer pool size (root CLAUDE.md § Connection Pool Budget); the feature-141 SEV-2 lever, copied from the materializer twin (`configServiceImpl.ts:109-112`). |
| `signal_rank_weight` | `[0,1]` | `get_float` | weight ∈ [0,1] (FR-2/`@AC-4`); lower 0 is a valid operator intent. **Zero-trap caveat — see §4.** |
| `max_universe_size` | `[1,1000]` | `get_int` | FR-2 compute-cost cap; high edge is the unguarded cost driver. |
| `max_live_strategies_per_symbol` | `[1,50]` | `get_int` | FR-2 compute-cost cap. |
| `max_live_only_symbols_per_compute` | `[1,500]` | `get_int` | FR-2 compute-cost cap. |
| `max_live_held_symbols_per_compute` | `[1,500]` | `get_int` | FR-2 compute-cost cap. |
| `max_concurrent_candidates` | `[1,50]` | `get_int` | FR-2 concurrency fan-out cost cap. |
| `sparkline_bars` | `[1,500]` | `get_int` | per-candidate bar-fetch count — a documented fetch-cost footgun. |
| `valid_window_hours` | `[1,168]` | `get_int` | mirrors the feature-182 materializer twin's identical bound `[1,168]` (`configServiceImpl.ts:108`) — precedent-grounded, not a guessed ceiling. |

**Lower-bound rule (recon.md:94,99):**
- `get_int`/`get_float` **zero-trap** keys → lower bound `1`: a stored `0` already collapses to the
  code default on read, so `min ≥ 1` documents that `0` is intentionally unreachable. Read-path
  `max(1,…)` clamps stay untouched (PRESERVE compute behavior). `signal_rank_weight` is the one
  exception — FR-2/`@AC-4` mandate lower `0`.
- `get_int_present` bounded key (`refresh_hour_utc` only, in this set) → lower bound `0`: `0` is a
  documented settable value, so `min ≥ 1` would be a C-16 regression.

**Seeded but UNBOUNDED (5):** `live_enrich_ttl_seconds`, `empty_recompute_ttl_seconds`,
`retry_seconds`, `startup_jitter_seconds`, `snooze_default_hours`. These have no documented failure
mode; per Behavior #2 ("write the minimum") they surface + are editable in config-ui without a
speculative ceiling. Loosening/adding a bound later is a one-line registry edit; an unjustified
ceiling is a latent C-16 regression, so under-bounding is the cheap-to-reverse direction. This also
sidesteps the shared-reader coupling (recon.md:95): `retry_seconds`/`startup_jitter_seconds` are read
by **both** the opportunity refresh loop and the feature-180 readiness-materializer loop
(`servicer.py:4181`,`:4218`) — leaving them unbounded constrains neither.

### 3. Tests (C-08/C-15/P-06)
- **Bounds (`@AC-4`, `@AC-5`, `@AC-8`):** extend `setConfigScalarBounds.test.ts` (in-process loopback
  gRPC harness) with in/out-of-range blocks per bounded key: reject `max_concurrent_bars_fetches=10000`,
  `refresh_hour_utc=99`, `signal_rank_weight=1.5` (`@AC-4`); accept `max_universe_size=50` without
  `create_key` (`@AC-5`); **accept `refresh_hour_utc=0` and `signal_rank_weight=0`** — the min-0
  settability guard (`@AC-8`, the C-16 proof the whole lower-bound split rests on).
- **Migration (`@AC-1`/`@AC-2`/`@AC-3`):** offline SQL verification only (no DB brought up) — row-shape,
  full-dotted `key`, `value_type`, and seeded-default==code-default assertions by inspection.
- **config-ui (`@AC-6`):** extend `CONFIG_KEY_FIXTURES` (`configKeys.ts`) with `analysis.opportunity.*`
  rows mirroring the `signal_decay_half_life_hours` bounded fixture (C-12, no inline literals); extend
  `api-smoke.spec.ts` bound-hint coverage. **Zero component code** — the generic `NamespaceEditor`
  (`NamespaceEditor.tsx:69`) renders `ListKeys` rows (value + bounds hint + description column
  `:181-183`, visible `md:`+) automatically.
- **Docs (`@AC-7`):** doc-state assertion, verified in review.

### 4. Consumer-surface honesty folded in (C-14)
- **Restart-only sem keys:** `max_concurrent_bars_fetches` and `max_concurrent_candidates` are read
  once at `AnalysisServicer.__init__` (`servicer.py:413`/`:419`) — a config-ui edit broadcasts live but
  the running service ignores it until restart. Their seed `description` states **"takes effect at
  service restart."** Verified the `NamespaceEditor` renders the `description` column
  (`NamespaceEditor.tsx:181-183`), so the caveat is visible (feature-182 precedent — its
  `readiness_materializer.max_concurrent_bars_fetches` twin is also `__init__`-frozen).
- **`signal_rank_weight` zero-trap:** read via `get_float` (no `_present`), so a stored `0` reads back
  as the default `0.3` — config-ui accepts `0` ("no signal weight") while the queue silently keeps
  weighting at `0.3`. Its seed `description` states **"0 is not honored — reads as the 0.3 default
  (get_float)."** A true fix (switch the reader to `get_float_present`, as feature 161 did for the
  decay key) is an analysis code change that breaks this feature's docs-only boundary → **routed to
  feature 185** (opportunity-compute-robustness), which already touches the compute readers.

### 5. Refresh kill-switch — deferred, with a named home (C-14 defer rule)
The `analysis.opportunity.refresh_enabled` kill-switch is **not** in this feature: it forces a
`get_bool` gate in `run_opportunity_refresh_forever` (`servicer.py:4043`), breaking the docs-only
boundary, and needs its own `@AC`. Deferral points at a **named** home: **feature 185
(opportunity-compute-robustness)**, which already touches the refresh loop; if 185's scope rejects it,
a new named feature. Recorded as an Open Risk (the ops gap it leaves is real — see below).

---

## Rejected Alternatives

1. **Bound all 15 keys (proposer's original).** Uniform min/max hint in config-ui + blanket high-edge
   protection. **Rejected:** ~5 keys would get ceilings (3600/168/500/300) with no documented failure
   mode — speculative constraint beyond FR-2 (Behavior #2), and any guess below a legitimately-usable
   value is its own latent C-16 regression (a currently-settable value turns unsettable). Under-bounding
   is the cheap-to-reverse direction.
2. **Bound only FR-2's committed 8.** Strictest minimum. **Rejected:** leaves `sparkline_bars` (a
   documented per-candidate fetch-cost footgun) and `valid_window_hours` (a feature-182-precedented
   bound) unguarded despite each having a concrete justification — thinner protection for no gain.
3. **Switch `signal_rank_weight` to `get_float_present` here** (so `0` is honored). **Rejected for this
   feature:** an analysis code change that breaks the docs-only boundary → routed to feature 185.
4. **Include the refresh kill-switch now.** **Rejected:** analysis code change + new runtime path in a
   no-behavior-change feature + needs its own `@AC` → deferred to feature 185 (§5).

---

## Open Risks (→ context.md Open Threads)

- **Migration `028` collision** (→ execute): bind-at-rebase; reconfirm `max(NNN)+1` vs `main-dev`
  (C-07, ledger fails 1699/1702). Feature 185's own config work, if it lands first, shifts this.
- **`signal_rank_weight` zero-trap remains live** until feature 185 switches the reader to
  `get_float_present`; mitigated here only by the description caveat (§4).
- **No live valve for a runaway opportunity refresh** — `run_opportunity_refresh_forever` has no
  `enabled` gate (recon.md:49) and its only throttle (`max_concurrent_bars_fetches`) is restart-frozen;
  a feature-141-class runaway needs a redeploy to stop. The kill-switch (§5) closes this in feature 185.
- **Restart-only sem-key semantics** rely on the operator reading the description caveat; there is no
  mechanism to apply an `__init__`-frozen value live (out of scope; feature-182 precedent).

---

## Constitution Rules Touched

| ID | How honored |
|---|---|
| **C-05** | All 15 keys are `analysis.opportunity.<key>` — 3-segment `<service>.<category>.<key>`. |
| **C-07** | Migration `NNN` = last (`027`) + 1 = `028`, bind-at-rebase; up + down; no edit to an applied migration. |
| **C-08 / P-06** | Every config code-bearing step (migration, bounds registry) has a paired test meeting the config CI threshold; RED-before-green in `setConfigScalarBounds.test.ts`. |
| **C-10(c)** | The seeded keys are a shared resource analysis depends on; FR-2 write-bounds are the mutation guard, layered on the existing admin-scope `SetConfig` gate. |
| **C-12 / C-13** | config-ui test data from `CONFIG_KEY_FIXTURES` (`e2e/fixtures/configKeys.ts`), not inline literals. |
| **C-14** | Consumer surface = `/config-ui` analysis namespace editor (existing, generic); restart-only + zero-trap caveats surfaced in descriptions; deferred kill-switch + `get_float_present` fix routed to named feature 185. |
| **C-15** | Every FR-1..FR-5 covered by ≥1 `@AC`; new `@AC-8` covers the min-0 settability guard the design rests on. |
| **C-16** | PRESERVE `@AC-3`, `@AC-9@182` (write-path-only), `@AC-8@158` (`refresh_hour_utc`=0), `@AC-7@158` (jitter/retry defaults admitted — left unbounded), `@AC-4/5@177`, `@AC-14@095`; EXTEND the feature-182/161 seed+bounds precedents. No existing rule CHANGED. |
| **F-01** | New migration `028`, not an edit to an applied one. |
| **F-07** | No hardcoded config in source — keys read via WatchConfig; bounds registry is validation metadata, not a config value. |

**Floor breaches:** none (adversary confirmed — new migration, no proto/pool change, write-path-only bounds).
