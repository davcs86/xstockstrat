# Context: cross-stock-score-derivation  (archived 2026-08-06)

**Feature**: ./feature.md
**Status**: launched — archived by /sdd-archiver; verbose specs pruned (recoverable via git history).

## Archive Synthesis — 2026-08-06 — /sdd-archiver

**What**: Replaced last-run-wins strategy scoring with a fingerprint-stamped per-symbol evidence-cell model, traded-first dedup, and empirical-Bayes shrinkage aggregation. Shipped exactly as designed across 14 sequential steps in one integration PR (feature.md:22-24), with UI/agent caller parity and a vitest seed absorbed into scope mid-flight.
**Why (irrecoverable rationale)**: Origin was a live design discussion after PR #758 (feature 064) — user explicitly chose statistical robustness over single-run traceability "because the product is named after Cross Stock Strategies" (context.md:12-13). Weighting was constrained to evidence (trading days), never outcome (yield) — an explicit rejection of the user's own original suggestion (context.md:24-26). Score composition was kept at three components (no total_return) so only the derivation change could explain post-launch grade drift (product-spec.md:235; context.md:49-50).
**Rejected alternatives**:
- Timestamp eligibility — killed by round-1 B1: routine toggles bump `updated_at`, wiping evidence on no-ops (design.md:187-190).
- `definition_updated_at` column — closes only the toggle trap, not the rest of B1 (design.md:191-193).
- `definition_version` counter — reverting to a prior definition should resurrect its evidence; a counter can't express that (design.md:194-197).
- Zero-trade cells excluded from evidence — reversed mid-design; non-participation is itself evidence (design.md:198-200; context.md:108-111).
- Opt-in `return_weight=0.0` key — deferred as speculative config surface, named as the cheap retrofit if rankings mislead (product-spec.md:113-114,236,239-240).
**Scars & gotchas**:
- **SDD process scar (interactive-gate silent failure)**: during the design-phase gate, a "working steer" of excluding zero-trade cells was carried forward and acted on as if user-confirmed, but the original interactive gate had actually failed to deliver/record the real decision. It was caught only when a later round re-asked the user, who confirmed the opposite (zero-trade cells count). Not visible anywhere except context.md:105-111 — design.md records only the corrected final reasoning, so the failure mode (a gate silently not capturing a decision, letting an unconfirmed steer propagate as approved) is invisible to a future agent unless carried here.
- No `asyncio.Lock` precedent existed in servicer.py — net-new lock needed an explicit no-deadlock regression test (`asyncio.Lock` non-reentrant) (context.md:139-141).
- Toolchain missing on host (no buf/protoc/grpc_tools/migrate, Docker down) — installed CI-pinned codegen toolchain directly on host mid-execute (context.md:209-211).
- Migration reversibility verified on a throwaway Postgres 16 instance, not the real migrate/Docker pipeline (context.md:227-229).
**Permanent deviations**: none.
**Cross-feature signal**:
- Content-scoped validity needs a content hash, not a clock [DUP:docs/roadmap/ledger/insights.md:69].
- Vitest seeding via `coverage.all:false` [DUP:docs/roadmap/ledger/insights.md:85].
**Deferred follow-ons**:
- Correlated-symbol breadth inflation (OQ-6) — sector-capped weights via feature-059 is named successor (design.md:226-228).
- `backtest_run_symbols` retention gap — documented, not fixed (design.md:232-234).
- Fingerprint canonicalization sensitivity — mitigated by tests only, not structurally closed (design.md:221-225).
- Total-return 4th component — opt-in `return_weight=0.0` retrofit if needed (product-spec.md:113-114,236,239-240).
**Ledger entries written**: insights.md (0), fails.md (1) — see the 2026-08-06 entries.
**Runtime-invariant recommendations (→ /context-constitution)**: - none.
**Pruned artifacts**: product-spec.md, recon.md, design.md, implementation-spec.md — last present at f871138.
