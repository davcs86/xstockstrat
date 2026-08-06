# Context: backtest-results-visualization  (archived 2026-08-06)

**Feature**: ./feature.md
**Status**: launched — archived by /sdd-archiver; verbose specs pruned (recoverable via git history).

## Archive Synthesis — 2026-08-06 — /sdd-archiver

**What**: Shipped as designed — Past Runs rows became clickable, backed by a new `analysis.backtest_details` BYTEA table (migration 008) and an additive `GetBacktest` RPC, with a DB-only read path and a per-symbol time-aligned equity chart replacing the old trade-ordinal chart. All 12 spec steps landed with green tests (analysis 252/79.6%, ui vitest 25, e2e 18/18 CI-mode) — no scope was cut (feature.md:21, context.md:126-137).
**Why (irrecoverable rationale)**: Store-what-you-serve BYTEA was chosen because this payload has exactly one consumer (the RPC that returns it verbatim) — no SQL ever queries inside it, so JSONB's structure and normalized rows' mapping code buy nothing (design.md:104-114). DB-only reads (not memory-first) were chosen specifically to kill three restart-dependent semantics at once: the in-memory dict stores INSUFFICIENT results unconditionally, collides on strategy_id keys, and never evicts (design.md:106-108, 50-54).
**Rejected alternatives**:
- Memory-first `GetBacktest` — lost: saves ~1ms but inherits 3 restart-dependent bugs (design.md:106-108)
- JSONB — lost: `MessageToDict` raises on NaN/Inf and `profit_factor` was *believed* legitimately `inf` (design.md:109-111) — belief later proven wrong by feature 072 (fails.md:61-79)
- Normalized rows (per-trade/per-bar tables) — lost: pure read-back payload no query inspects; row-mapping code both ways buys nothing given the double size bound (≤504 bars/symbol × ≤20 runs/strategy) (design.md:112-114)
- No-FK detail table — lost: orphaned detail row could silently occupy a retention slot (design.md:115-116)
- New route for run detail — lost: triggers C-10(a) nav-reachability burden for no FR benefit (design.md:117-118)
- Trades-cumulative equity fallback / run-level aggregate curve — lost: near-dead code path / mathematically impossible given sequential symbol compounding (design.md:119-123)
- Summary-sourced metrics grid for no-detail rows — lost: would create a second metrics render path; the Past Runs row already displays the summary metrics (design.md:124-125, 157-158; adversary objection 12c, context.md:55-56)
**Scars & gotchas**:
- No Docker/TimescaleDB locally; migration 008 verified via golang-migrate directly (up→down→re-up) since analysis migrations don't need the Timescale extension (implementation-spec.md:522-526, D-2)
- Local Playwright (`next dev`) timed out on the first two tests on first-compile latency — sandbox artifact, not a bug; authoritative signal was CI-mode (18/18) (implementation-spec.md:527-531, D-3)
- Per-step sub-branch PRs skipped (harness forbids pushing non-assigned branches); one PR carried all 12 step commits (implementation-spec.md:518-521, D-1)
**Permanent deviations**: design said per-bar equity is "wired through the single shared builder `_build_bar_diagnostic`" -> shipped as a stamp in the separate shared finalize pass `_finalize_symbol_diagnostics` -> because the builder runs before the simulation loop computes equity; finalize was the first point both engine paths have equity available (context.md:79-85).
**Cross-feature signal**: This feature's design-time claim "`profit_factor` is legitimately `inf` on no-loss runs" was false (producer clamps to 999.0) and was inherited unverified by feature 072 three rounds later, nearly shipping a wrong `"Infinity"` contract into shared docs (fails.md:61-83). Already captured there.
**Deferred follow-ons**: - `BacktestRunSummary` has no "has detail" flag; UI discovers legacy/evicted rows only on open (NOT_FOUND). Deferred post-launch only if users report confusion (design.md:135-137, context.md:67).
**Ledger entries written**: insights.md (1), fails.md (0) — see the 2026-08-06 entries.
**Runtime-invariant recommendations (→ /context-constitution)**: - none
**Pruned artifacts**: product-spec.md, recon.md, design.md, implementation-spec.md — last present at f871138.
