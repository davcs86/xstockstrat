# Context: fix-mcp-screener-correctness  (archived 2026-08-06)

**Feature**: ./feature.md
**Status**: launched — archived by /sdd-archiver; verbose specs pruned (recoverable via git history).

## Archive Synthesis — 2026-08-06 — /sdd-archiver

**What**: `screen_symbols` shipped with a thin agent wrapper that silently dropped technical criteria and gap detail, plus a screener that ignored `min_conviction`, silently skipped unknown fundamental metric names, and computed `coverage_gaps` after rank truncation (dropping any INSUFFICIENT_DATA symbol below the cut). The fix made all five behaviors honest rather than removing any surface (context.md Session 2026-08-02 execute).
**Why (irrecoverable rationale)**: `min_conviction` could not be a raw `score >= min_conviction` filter because `r.score` is min-max **normalized** relative conviction in [0,1], not an absolute probability — a raw floor would silently break on different universes and contradict the screener's FR-4 backtest-parity claim. The design instead reused the backtest's own `scoring.buy_threshold(mc)` transform so the field has one platform-wide meaning (design.md:23-30). The AC-2 illustration ("0.9/0.3 → only 0.9") isn't literally realizable by min-max normalization on a 2-symbol universe, so the paired test needed ≥3 symbols (design.md:29-30).
**Rejected alternatives**:
- `min_conviction` as a non-filtering `passed` flag — lost: AC-2 requires the low-score symbol absent from results (design.md:49-50).
- Removing `min_conviction` entirely — lost: cheap to honor correctly vs. a breaking proto removal (design.md:51-52).
- Validating `metric_name` only against the closed `_FUNDAMENTAL_FIELDS` set — lost: would reject legitimate open `extra_metrics`; union-with-fetched-keys check chosen instead (design.md:53-54).
- Computing `coverage_gaps` in the servicer after projection — lost: the screener owns the ranked list, fix belongs at the source (design.md:55-56).
**Scars & gotchas**:
- The extracted `_build_component` helper inherits `manage_strategy`'s `ValueError` on an unknown `kind`, surfacing as a client-side MCP tool error *before* the gRPC call is even made — an easy thing to miss when reusing the helper elsewhere (design.md:67-68, context.md execute session).
- Unknown-metric validation only fires when fundamentals are actually fetched — a typo against absent data is silently unvalidated, since there's no universe to check the name against (design.md:61-62).
- Reused the int64-as-JSON-string wire convention from `run_backtest`'s `bars_have`/`bars_need` for the new gap projection rather than inventing a new encoding (recon.md:27).
**Permanent deviations**: none — context.md's execute session (lines 33-52) tracks the chosen design point-for-point (shared `_build_component`, gaps-before-truncation, `buy_threshold(mc)` floor, unknown-metric `ValueError`→`INVALID_ARGUMENT`).
**Cross-feature signal**: - This bug and its sibling triage findings (F-1..F-N in the same report) were deliberately bundled into single-feature-per-shared-root-cause dirs rather than split 1:1 with findings, to keep the PR surface coherent (context.md Session 1, "Bundling rationale").
**Deferred follow-ons**: - Documented residual: an open `extra_metrics` name absent from every scanned symbol in a given scan raises `INVALID_ARGUMENT` indistinguishable from a genuine typo — accepted as "honest" rather than fixed further (design.md:34-37, 63-64).
**Ledger entries written**: insights.md (1), fails.md (1) — see the 2026-08-06 entries.
**Runtime-invariant recommendations (→ /context-constitution)**: - none
**Pruned artifacts**: product-spec.md, recon.md, design.md — last present at f871138.
