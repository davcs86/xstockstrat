# Context: opportunity-config-operability  (archived 2026-09-16)

**Feature**: ./feature.md
**Status**: launched — archived by /sdd-archiver; verbose specs pruned (recoverable via git history).

## Archive Synthesis — 2026-09-16 — /sdd-archiver

**What**: A config-only operability layer for the opportunities queue: migration 028 seeds all 15 `analysis.opportunity.*` keys at code defaults (no runtime-behavior change), and `SCALAR_BOUNDS_REGISTRY` gained write-bounds on 10 of them (5 left deliberately unbounded). `xstockstrat-analysis` stayed docs-only; no proto/schema/read-path change. It is the direct feature-182 mechanism applied verbatim to a second key family.

**Why (irrecoverable rationale)**: Deliberately split from its twin, **feature 185 (opportunity-compute-robustness)**, so the config-only half could ship low-risk while the compute-correctness half got its own design debate — a conscious risk-isolation decision. The "justified set (~10)" was chosen over bound-all-15 because under-bounding is a one-line registry edit to reverse whereas an unjustified ceiling is a latent C-16 regression (a currently-settable value silently becomes unsettable) — the cheap-to-reverse direction wins. The kill-switch (`refresh_enabled`) was rejected not because ops-safety didn't matter but because it forces a `get_bool` gate in `run_opportunity_refresh_forever` — an analysis code change that breaks the docs-only boundary — and the design accepted a known live gap (no valve for a runaway refresh; only throttle is restart-frozen) as the price of shipping config-only, routing the fix to 185.

**Rejected alternatives**:
- Bound all 15 keys — ~5 would get speculative ceilings with no documented failure mode, and any guess below a legit value is a latent C-16 regression.
- Bound only FR-2's committed 8 — leaves `sparkline_bars` (per-candidate fetch-cost footgun) and `valid_window_hours` (feature-182-precedented `[1,168]`) unguarded despite concrete justifications.
- Switch `signal_rank_weight` to `get_float_present` here (so `0` is honored) — an analysis code change breaking the docs-only boundary → routed to 185.
- Include the refresh kill-switch now — analysis code change + new runtime path in a no-behavior-change feature → routed to 185.

**Scars & gotchas**:
- **`VALUE_TYPE_FLOAT_SCALAR` is emitted for ALL bounded keys, int or float** — there is no int-scalar enum member. The impl-spec review caught an executor about to set a fictitious "int-scalar enum" on a bounded-int fixture row; corrected to `valueType: 2` for both int and float bounded rows pre-execute.
- **Playwright sandbox e2e run recipe**: the pinned browser build (chromium-1234) was absent (env ships 1194); ran with `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=…/chromium-1194/…` AND `CI=1` — the CI path builds a prod server with a 30s per-test timeout, whereas dev-mode's 10s timeout times out on the cold SSR warmup compile.
- `retry_seconds`/`startup_jitter_seconds` are shared readers — consumed by BOTH the opportunity refresh loop and the feature-180 readiness-materializer loop; left unbounded so no single bound constrains the wrong loop.

**Permanent deviations**: None material — shipped behavior matches design (config-only, no read-path change). Process deviation only: executed on branch `claude/opportunity-queue-philosophy` (shared with feature 185, PR #1109) though feature.md/impl-spec declare `feature/opportunity-config-operability` — operator-granted, recorded.

**Cross-feature signal**: Third instance of the "seed + write-bounds a numeric config family" pattern (161 decay-key → 182 readiness-materializer → 184 opportunity), each reusing the prior's `lookupScalarBounds` + seed-migration template with zero new code — now a stable platform recipe. 184 + 185 are a deliberate two-feature split of one audit, sharing a branch/PR.

**Deferred follow-ons**:
- `signal_rank_weight` **zero-trap remains live**: config-ui accepts `0` ("no signal weight") but `get_float` reads it back as the `0.3` default — mitigated only by a description caveat; real reader fix routed to feature 185.
- **Refresh kill-switch** (`analysis.opportunity.refresh_enabled`) not shipped → feature 185; until then a runaway refresh needs a redeploy to stop.
- Restart-frozen sem keys (`max_concurrent_bars_fetches`, `max_concurrent_candidates`, read once at `AnalysisServicer.__init__`) surface live in config-ui but are ignored until restart — description caveat only.

**Ledger entries written**: insights.md (1), fails.md (0) — see the 2026-09-16 entries. (The lower-bound getter-semantics rule and the write-bounds-are-write-path-only rule were DUPs of insights.md:3103 and :3085; only the CI=1/chromium-1194 Playwright sandbox recipe was emitted NEW, once for the batch.)

**Runtime-invariant recommendations (→ /context-constitution)**: none new — the two live analysis quirks (`signal_rank_weight` `get_float` zero-trap; `max_concurrent_*` frozen at `__init__`) are already documented in surviving homes (migration 028 seed descriptions, `config-governance.md`, `analysis/CLAUDE.md`).

**Pruned artifacts**: product-spec.md, recon.md, design.md, implementation-spec.md — last present at 5b193f2d.
