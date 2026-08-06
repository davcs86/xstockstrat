# Context: strategy-reentry-cooldown  (archived 2026-08-06)

**Feature**: ./feature.md
**Status**: launched — archived by /sdd-archiver; verbose specs pruned (recoverable via git history).

## Archive Synthesis — 2026-08-06 — /sdd-archiver

**What**: Shipped exactly as designed across all 13 steps in one sequential single-PR (deviation from default per-step PRs, by user directive) — analysis 277 tests/80% cov, agent 70 tests/66% cov, UI tsc+lint green with e2e authored but unrun in-session. Root motivation: a real whipsaw found via MCP shadow-strategy testing — a bounded-exit variant (`range_mean_reversion_v3`) improved the 10-symbol aggregate but degraded WSM specifically by re-firing entry 4x in ~a month on a still-declining stock (context.md:12-22).
**Why (irrecoverable rationale)**: 31-day default chosen specifically to sit outside the IRS 30-day wash-sale window (context.md:23-25) — a tax-compliance rationale invisible in code/proto. Trigger set to "any exit" (not losses-only) because the wash-sale rule motivates duration only, not trigger condition (context.md:32-33).
**Rejected alternatives**:
- `cooldown_days` snapshot column on `strategy_cooldowns` — lost because re-reading the live definition lets an operator's shortened cooldown take effect immediately (design.md:152-153)
- Post-construction attribute assignment in `client.py` — lost on a *false premise*; verified live that the protobuf constructor already omits `field=None` for optional fields (design.md:154-155)
- `cooldowns_repo` as required constructor param — lost, breaks the shared 7-kwarg test fixture / contradicts `main.py`'s `db_pool is not None` gate (design.md:156-157)

**Scars & gotchas**:
- Mid-design renumbering collision: a rebase revealed feature 068 had merged first, claiming both number `068` and migration `008` — renumbered to `069`/migration `009` via `git mv` (context.md:157-175)
- Playwright e2e unrunnable in-session (dev cold-start `ERR_ABORTED`; CI build >13min) — verified via `tsc --noEmit`+lint plus a manual dev-mode drive that caught a route-glob bug and a hyphenated-edit-id bug pre-merge (context.md:347-350)
- Migration verified against a throwaway local `initdb` cluster — no `migrate` binary/TimescaleDB container in-session (context.md:272-274)

**Permanent deviations**: none beyond the semantic reconciliation already in design.md/ledger.
**Scars & gotchas**: none
**Permanent deviations**: none
**Cross-feature signal**: confirms feature-workflow.md's renumbering rule fires under real concurrent `/sdd-design` sessions, not just in theory.
**Deferred follow-ons**: cross-restart durability on a failed best-effort cooldown write accepted for v1, mirrors `strategy_scores` (design.md:164-168); config default zero-trap (`default_cooldown_days=0` silently becomes 31 via `get_int`) documented, not fixed (context.md:150-151,219-220).
**Ledger entries written**: insights.md (2), fails.md (0) — see the 2026-08-06 entries.
**Runtime-invariant recommendations (→ /context-constitution)**: - none
**Pruned artifacts**: product-spec.md, recon.md, design.md, implementation-spec.md — last present at f871138.
