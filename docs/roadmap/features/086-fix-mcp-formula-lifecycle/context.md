# Context: fix-mcp-formula-lifecycle  (archived 2026-08-06)

**Feature**: ./feature.md
**Status**: launched — archived by /sdd-archiver; verbose specs pruned (recoverable via git history).

## Archive Synthesis — 2026-08-06 — /sdd-archiver

**What**: `manage_formula` shipped as an AIP-161 partial-merge update (update_mask) plus an honest, run-flagged soft-delete, mirroring feature 070's `ManageStrategy` mechanism across four services (indicators, analysis, agent, ui) in one PR. It closed three bundled triage findings (F-2 wipe, F-3 multi-series, F-10 missing reads) as a single root-caused change rather than three separate fixes.
**Why (irrecoverable rationale)**: User steer at the design gate ("soft delete acceptable only if strategy runs detect and flag it") pulled analysis and ui into scope beyond the original indicators+agent bundle — without that steer the fix would have shipped a "deleted" flag nobody surfaced, failing AC-4 (context.md:29; design.md:104-105).
**Rejected alternatives**:
- Derive update_mask from tool dict keys — re-creates the F-2 wipe since the dict always has every key present (design.md:96-97). [DUP:docs/roadmap/ledger/insights.md:518]
- Explicit `update_mask: list[str]` tool param — silent lost-edit if caller sets a value but forgets to name it, same class feature 070 fixed (design.md:98-100).
- Hard reference-checked delete via new indicators→analysis edge — would create a boot/WAIT_FOR cycle (analysis already dials indicators; ledger 2026-07-31 083) (design.md:101-103). [DUP:docs/roadmap/ledger/insights.md:520]
- `deleted` on `ExecuteFormulaResponse` checked at every RUN path — rejected for 3-site blast radius vs. the single backtest-warmup detection point (design.md:106-108).
**Scars & gotchas**: - None beyond what's already captured in the codegen-toolchain-host-setup runbook (context.md:40) — recoverable from that doc, excluded here.
**Permanent deviations**: - design said add a `clear_fields` param to `manage_formula` (design.md:46) -> shipped WITHOUT it -> because every field's "clear" is already expressible via a falsy value under the None-sentinel mechanism, and `source` stays protected by the erasure guard regardless — the param was redundant scaffolding (context.md:47).
**Cross-feature signal**: none beyond the already-ledgered soft-delete/reverse-edge pattern (insights.md:518-521).
**Deferred follow-ons**:
- Continuous live-strategy push alerting (notify) on a referenced formula's deletion transition — deferred; current fix only surfaces on read (`GetStrategy`/UI/agent `get_strategy`) (design.md:117-118).
- Maskless (non-UI) `UpdateFormula` path can still blank parameters/outputs/warmup/is_public — erasure guard intentionally scoped to `source` only; documented in the tool docstring, not fixed (design.md:119-121).
**Ledger entries written**: insights.md (1), fails.md (0) — see the 2026-08-06 entries.
**Runtime-invariant recommendations (→ /context-constitution)**: - none
**Pruned artifacts**: product-spec.md, recon.md, design.md, implementation-spec.md — last present at f871138.
