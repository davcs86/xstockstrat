# Context: readiness-materializer-config-keys  (archived 2026-09-16)

**Feature**: ./feature.md
**Status**: launched — archived by /sdd-archiver; verbose specs pruned (recoverable via git history).

## Archive Synthesis — 2026-09-16 — /sdd-archiver

**What**: Shipped as a config seed migration (027) registering the four `analysis.readiness_materializer.*` keys at code defaults (`enabled=false`) so config-ui can surface/toggle them — but it grew mid-flight into a config-service *code* change: three `SCALAR_BOUNDS_REGISTRY` write-bounds plus a refactor of the bounds-lookup itself. The bounds refactor was forced by a landmine discovered at spec time (two incompatible `key`-column conventions colliding with the registry's lookup key), not the original story. Net runtime behavior unchanged; the materializer stays OFF until an operator flips it.

**Why (irrecoverable rationale)**: Scope expanded from "migration + docs only" to "all four keys + write-bounds" by explicit **operator sign-off at the design gate**. Decisive reasoning: once `max_concurrent_bars_fetches` becomes operator-editable it re-arms the feature-141 SEV-2 ("out of shared memory") lever, and `refresh_hour_utc` has no reader-side clamp — so bounds are a genuine safety requirement, not gold-plating. Bounds live on the write path only, so adding them preserved the no-behavior-change contract. Ceiling `max_concurrent_bars_fetches=[1,5]` was chosen to equal marketdata's PgBouncer pool size; `[1,5]` deliberately makes `0`/"unlimited" unreachable because the key is read via the zero-trap `get_int` (which would collapse `0` → `2`).

**Rejected alternatives**:
- Defer bounds (seed four, no registry entries) — the "reader clamps absorb bad values" defense is false; `max(1,…)` guards only the low side and `refresh_hour_utc` has no clamp.
- Seed only `enabled` (or `enabled`+`valid_window_hours`) — safest but drops the schedule/concurrency tunability the operator wanted.
- Reader-side clamp (`hour % 24`, concurrency cap) in analysis — out-of-scope analysis change that still leaves config-ui with no validation hint; the registry is the right layer.
- Verbatim 026 down-delete (no `user_id IS NULL`) — deletes *all* rows for the key, destroying an operator per-user override on rollback; the scoped delete reverses only what `up` seeded.
- Double-prefix registry keys / re-gate to seed-only-`enabled` — lost to the robust two-operand lookup.

**Scars & gotchas**:
- **Double-prefix registry-lookup landmine (the central build scar).** `SCALAR_BOUNDS_REGISTRY` lookup keyed on `${namespace}.${key}` silently assumes the DB `key` column is namespace-stripped (as the existing decay/stale keys are). This feature's keys must use the full-dotted `key` column (the analysis reader does exact-string `values.get(key)`), which makes the lookup compute `analysis.analysis.readiness_materializer.*` — a miss, so bounds would have **silently not fired**. Fix: a two-operand lookup (bare `key` ?? `namespace.key`) at both the setConfig write edge and the listKeys render-hint. Discovered at spec time, not design.
- **Full-dotted `key` column is mandatory or the reader is a silent orphan** — a stripped `key` column stores fine and passes all offline checks but never reaches the analysis reader; masked whenever seeded value == code default.
- **config-ui visibility needs a config-service reload** — a raw migration `INSERT` fires no `pg_notify`, so seeded keys appear only after a config-service restart/deploy or the next analysis-namespace `SetConfig`. The @AC-6 "config-ui shows them" objective is NOT met at migration-apply time.
- No migration CI gate — execution was offline SQL read-back only; apply/rollback deferred to deploy.

**Permanent deviations**:
- design said inline two-operand lookup at both sites → shipped a shared `lookupScalarBounds(namespace, key)` helper (inlining the `??` probe twice tripped the DRY guard rail); same behavior.
- Executed on the harness-designated `claude/watchlist-stock-list-perf-o3qoqb` branch with one integration PR, NOT a `feature/<slug>` branch — the standing harness constraint overrode the SDD dev-branch model.

**Cross-feature signal**: The config `key`-column convention is inconsistent across migrations and the registry lookup silently baked in one side of it: 026/161 use full-dotted (correct), 019 uses stripped (latent orphan), 008 warned about it, and `SCALAR_BOUNDS_REGISTRY` assumed stripped. Any future config-key feature must resolve which convention its reader uses AND whether the bounds registry lookup handles it.

**Deferred follow-ons**: **Migration 019's decay-key (`scoring.signal_decay_half_life_hours`) is a latent reader-orphan** — it stores the stripped `key` column while the reader reads full-dotted, so operator config-ui edits never reach the analysis reader. Masked because default == seeded `24.0`. Explicitly out of scope for 182; noted for future triage. (The realized `fundsignal.*` staging dead-rows incident was the same bug class.)

**Ledger entries written**: insights.md (2), fails.md (2) — see the 2026-09-16 entries.

**Runtime-invariant recommendations (→ /context-constitution)**: CONFIG-* — the config `key` column must equal the exact full-dotted string the consuming service reads (WatchConfig snapshot is keyed by bare `row.key`; readers do `values.get(key)`); a stripped `key` column is a silent orphan (migration 019 is a live example). CONFIG-* — `SCALAR_BOUNDS_REGISTRY` (and any config-path-keyed lookup) must resolve both the bare `key` and the `namespace.key` form; a raw migration INSERT fires no `pg_notify`, so newly seeded keys are invisible in config-ui until a config-service reload.

**Pruned artifacts**: product-spec.md, recon.md, design.md, implementation-spec.md — last present at 5b193f2d.
