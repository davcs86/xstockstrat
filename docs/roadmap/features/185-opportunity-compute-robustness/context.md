# Context: opportunity-compute-robustness  (archived 2026-09-16)

**Feature**: ./feature.md
**Status**: launched — archived by /sdd-archiver; verbose specs pruned (recoverable via git history).

## Archive Synthesis — 2026-09-16 — /sdd-archiver

**What**: Ported the feature-181/176 "watchlist correctness" philosophy onto the opportunities compute across analysis + proto + ui + agent. Four robustness properties: (1) a data-unavailable sentinel riding the existing `provenance` JSONB, derived at read, so a per-symbol bars/indicator fetch failure surfaces distinctly instead of collapsing to a misleading `0/0` row; (2) semaphore isolation of the compute fan-out from the interactive read path; (3) a non-blocking cold read with `computing`/`compute_failed` response flags; (4) read-time per-symbol surgical recovery via a new heal-only `replace_symbols`. NO migration — everything rode existing columns, an existing config key, and in-memory/code constants.

**Why (irrecoverable rationale)**:
- Deliberately split from sibling 184 (config-only, low risk) because 185 is a compute change touching proto + C-16 semantics needing a full design debate; shared branch `claude/opportunity-queue-philosophy`.
- Every "no new config key / no new sem / bounded per-symbol" choice traces to one constraint: **three independent `[1,5]` bars-fetch semaphores would sum to 15 = 3× the marketdata PgBouncer pool ceiling (5), re-opening the feature-141 SEV-2.** This is the single load-bearing reason behind both FR-3 (reuse the materializer sem) and FR-5 (per-symbol recovery, not full recompute), and is not visible from shipped code.
- `FormulaExecutionError` is intentionally NOT caught as "unavailable" — only `grpc.RpcError`/transport is — because a formula bug is not a data outage (the fails-313 meaning-vs-convenience trap). The shipped `try/except grpc.RpcError` looks arbitrarily narrow without this.

**Rejected alternatives**:
- New `Opportunity` enum (`ReadinessState.UNKNOWN`-style) — heavier (enum-map entry, zero-value sentinel, render contract) for a binary state; an additive bool mirrors `muted`, needs no migration.
- Dedicated `analysis.opportunity.compute_max_concurrent_bars_fetches` config key — the third `[1,5]` sem → aggregate 15, re-opens 141 SEV-2 + adds a 185→184 config dependency.
- Retry = read-time kick → full `_compute_opportunities` — retry-amplification/thundering-herd during an outage (N users × full-universe fetch every 300s) = the 141 SEV-2 multi-user pressure.
- Overload `_replace_and_stamp_compute_state` for retry state — one per-user compute-state row with two meanings collides with @AC-4.
- Heal-at-24h-`valid_until` (no active retry) — too weak for a robustness feature; a blip shows "unavailable" for a day.
- Re-scope 185 platform-wide (opps + readiness materializer + fundsignal) — needs C-16 sign-off + balloons blast radius; instead built a generic helper wired to opps only, fundsignal deferred to feature 186.
- Keep the cold read synchronous, surface `computing` on the stale path only — rejected: it walks back the operator-committed non-blocking cold read. The decisive coupling: BECAUSE the cold read became non-blocking (empty + `computing`), a one-shot, non-polling agent would otherwise report a cold/failed queue as silently-empty — which is WHY FR-6 surfaces `computing`/`compute_failed` to the agent, not merely descriptor-parity back-fill; and FR-4 is non-blocking because a cold user has no cached rows, so a synchronous wait buys nothing. Unrecoverable from shipped code (the agent just returns the flags) and not in the retained acceptance.feature.

**Scars & gotchas**:
- **Cold-read test blast radius (the big one)**: making the cold `ListOpportunities` read non-blocking silently broke many `TestListOpportunitiesMaterialized` tests that drove the compute through the cold `_list_opps` path then asserted on served rows — they returned empty after the change. Fixed: `_list_opps` now drains the guarded background kick via a new `_drain_opportunity_recompute` with **budget 20000** (the 240-candidate compute needs >200 loop turns — a non-obvious magic number).
- FR-3's sem move broke feature-141's `test_cross_user_concurrency_bounded_by_semaphore` (asserted `peak == 2` counting all GetBars); once compute + enrichment stopped sharing permits, cross-user peak can reach 4. Migrated to count only range-bearing (compute) fetches via `HasField("range")`.
- e2e ran under `CI=1` prod build + Chromium-1194 fallback (`PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH`) because `buf` + a pinned Playwright build were absent — the same recipe feature 184 recorded. Proto lint/breaking/codegen likewise ran via the `Dockerfile.codegen` image.
- A pre-existing tsc error in `src/middleware.test.ts` on `origin/main-dev`, unrelated — left untouched.

**Permanent deviations**:
- Spec specified `replace_symbols(user_id, symbols, rows)` (3-arg) → shipped 2-arg `replace_symbols(user_id, rows)` because `symbols` is redundant (each heal row is keyed by `opportunity_key`, which encodes the symbol, and the WHERE matches on it).
- Design said stamp-`unavailable`+zero-axes in a post-assembly pass → shipped at the row-dict build inside `_row_for` (single pass), guarded by an `evaluated` flag so a muted-non-held candidate sharing a symbol with a failed eligible candidate is never spuriously marked.
- Design left `_materialize_opportunities` conditional on other callers → shipped deleted (grep confirmed the cold branch was its only caller).
- Shipped extracted `_signal_decay` to a shared module-level helper (compute + recovery both need it; jscpd/DRY would flag it).
- Feature-177's @AC-4 "not repeatedly *synchronously* recomputed" was strengthened to "never synchronously recomputed" (delegated to the guarded background kick). Documented as PRESERVE-strengthened, explicitly NOT a C-16 CHANGE, so no sign-off.

**Cross-feature signal**: The **aggregate bars-fetch semaphore budget** (background + interactive sems must sum ≤ marketdata pool ceiling 5) now spans features 141/176/180/181/185 — a runtime invariant unrecoverable from any single service's code. The `muted` (feature-131) provenance-marker → derived-at-read additive bool is now a proven, migration-free template reused a second time. Agent descriptor-parity drift: `Opportunity` had no parity test and the projection silently omitted `valid_until` + `signal_confidence` (would not have failed CI); recon flagged it, this feature back-filled both fields + added the missing parity test.

**Deferred follow-ons**:
- **Feature 186** — fundsignal adoption of the generic recovery helper (`_kick_opportunity_retry`/`replace_symbols` were built generic FOR this reuse; 185 wired them into opportunities only).
- Universe-membership staleness on a healed row persists until the next daily full compute (heal-only never resurrects a dropped key) — accepted, bounded.

**Ledger entries written**: insights.md (3), fails.md (2) — see the 2026-09-16 entries.

**Runtime-invariant recommendations (→ /context-constitution)**: ANALYSIS-* — aggregate bars-fetch semaphore budget (background materializer sem + interactive `_bars_fetch_sem` + any future sem must sum ≤ marketdata pool ceiling 5; three `[1,5]` sems = 15 re-opens the feature-141 SEV-2). Cross-module (analysis ↔ marketdata pool). ANALYSIS-* — `replace_symbols` is heal-only (UPDATE-in-place, never INSERT) and must not resurrect a key the whole-user-replace authoritative-drop intended to drop; membership reconciles only at the daily full compute.

**Pruned artifacts**: product-spec.md, recon.md, design.md, implementation-spec.md — last present at 5b193f2d.
