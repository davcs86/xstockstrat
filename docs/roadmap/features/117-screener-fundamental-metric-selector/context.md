# Context: screener-fundamental-metric-selector  (archived 2026-08-16)

**Feature**: ./feature.md
**Status**: launched — archived by /sdd-archiver; verbose specs pruned (recoverable via git history).

## Archive Synthesis — 2026-08-16 — /sdd-archiver

**What**: UI-only, catalog-driven Radix `Select` for fundamental metric selection in the Screener page. Replaced the free-text `<Input>` with a `FUNDAMENTAL_METRICS` catalog in `strategyCatalog.ts` and a Radix `Select` in `page.tsx`; added 2 new e2e tests in `screener.spec.ts`. 3 steps. No backend change — the backend already validates against a closed set; this feature only narrows what the UI allows the user to submit.

**Why (irrecoverable rationale)**: `_validate_fundamental_metrics` accepts 11 fields (`_FUNDAMENTAL_FIELDS`) PLUS any keys present in `extra_metrics` observed in the fetched batch — broader than its name implies; the UI select gates only the statically known 11, not the runtime-observed extras. `DEFAULT_FUNDAMENTAL_METRIC` is a named constant (not `FUNDAMENTAL_METRICS[0].name`) because the default is load-bearing: FR-3 correctness requires it to stay `pe_ratio`; if the array is reordered, a position-derived default breaks silently. Contrast with the untouched Technical-indicator sibling's `BUILTIN_INDICATORS[0].name` — that index-0 derivation is non-load-bearing (SMA as default is incidental). The `strategyCatalog.ts` "keep in sync" doc comment was extended to name `services/xstockstrat-analysis/app/services/screener.py` (`_FUNDAMENTAL_FIELDS`) as a second backend source.

**Rejected alternatives**:
- Native `<select>` for Fundamental field (to match the sibling Technical field) — rejected: FR-1 already mandated Radix for the Fundamental field; the Technical field's `<select>` predates that decision and was not in scope (context.md sdd-design session; design.md §Rejected Alternatives).

**Scars & gotchas**:
- `screener.spec.ts` uses `aria-label="metric"` for both Technical and Fundamental rows — scope assertions to the row's `data-testid` wrapper, not bare `getByLabel`; see Ledger insight for the multi-row scoping pattern.
- `BUILTIN_INDICATORS` catalog uses a `description` field, not `label` — the new `FUNDAMENTAL_METRICS` catalog follows the same `{name, description}` shape.
- Executed on the harness-assigned branch `claude/fundamentals-selector-audit-egeez2` (single-branch mandate, no per-step PRs), matching feature 112's precedent.

**Permanent deviations**: none — all 3 steps landed byte-for-byte as specced.

**Cross-feature signal**: `strategyCatalog.ts` "keep in sync" doc comment now names three sources — update it if future features extend the catalog with a new backend source.

**Deferred follow-ons**: `extra_metrics` dynamic values (runtime-observed fundamental metrics not in the 11 `_FUNDAMENTAL_FIELDS`) are not exposed in the UI — any future feature exposing them will need a new RPC.

**Ledger entries written**: insights.md 3 NEW (load-bearing default constant pattern; "keep in sync" doc comment rule; Playwright multi-row criterion scoping); fails.md 1 NEW (_validate_fundamental_metrics accepts broader set than name implies). No DUPs.

**Runtime-invariant recommendations (→ /context-constitution)**: none beyond what's captured in the Ledger entries.

**Pruned artifacts**: product-spec.md, recon.md, design.md, implementation-spec.md — last present at this commit; recoverable via `git show <pre-archive-SHA>:<path>`.
