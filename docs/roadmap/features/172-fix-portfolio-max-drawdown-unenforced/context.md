# Context: fix-portfolio-max-drawdown-unenforced  (archived 2026-09-09)

**Feature**: ./feature.md
**Status**: launched — archived by /sdd-archiver; verbose specs pruned (recoverable via git history).

## Archive Synthesis — 2026-09-09 — /sdd-archiver

**What**: Shipped per-account drawdown enforcement for `portfolio.risk.max_drawdown_pct`, which was previously read then silently discarded (`_ = maxDrawdownPct`). The fix adds a `peak_equity` HWM column (migration 016) to `account_balances`, updates it via `GREATEST` at each broker balance sync, and evaluates drawdown through a pure `evaluateDrawdowns` seam wired into `checkRiskLimits`, emitting WARNING alerts via the existing `emitRiskAlert`. What started as a trivial SEV-3 became a medium-scope change once the recon-advertised "cheap" basis (`snapshots.equity`) was disproven as cashless mark-to-market.

**Why (irrecoverable rationale)**: The decisive cost-recalibration came in design round 1 when the adversary proved `portfolio.snapshots.equity` is cashless position value (`portfolio_service.go:706`, `cash=0` hardcoded) — using it would fire false alerts when a user de-risks to cash. The correct basis, `account_balances.equity` (broker-synced cash+positions), required a persisted HWM column (new migration). Per-account grain chosen (user decision, R2 gate) because cross-account SUM inflates drawdown via peak-timing skew. Cash-flow contamination accepted (R3) because the platform models zero funding events; cheap heuristics (e.g. "reset HWM on large equity jump") rejected as strictly worse than the false positive — a masking heuristic in a risk alert is worse than the false alert itself.

**Rejected alternatives**: Path B (document as not-implemented); drawdown over `snapshots.equity` (cashless, fires false alerts on de-risking); cross-account SUM aggregate (peak-timing skew inflates drawdown); cash-flow-aware basis (nothing to net against); cheap "reset HWM on large equity jump" heuristic (needs arbitrary threshold, masks real drawdown); `evalDrawdown(peak,current) -> bool` test seam (vacuous-green, fails-074 family); repo-interface refactor to test full emit path (out of scope).

**Scars & gotchas**: `golangci-lint` 2.5.0 refused go 1.27 modules (required building repo-pinned v2.13.1 from source); `queryRower` interface too narrow for testing (declared only `QueryRow`, had to widen with `Query`+`Exec` for pgxmock); shared event-type name `portfolio.risk.drawdown_breach` used by both concentration AND drawdown (misnomer, out of scope to rename); all new Go code lands in coverage-excluded packages.

**Permanent deviations**: Design (recon.md:29-34) said drawdown could be computed from existing `portfolio.snapshots` with no migration ("Path A is cheap"). Shipped with migration 016 (`peak_equity` column on `account_balances`) because the recon premise was disproven in R1 — `snapshots.equity` is cashless.

**Cross-feature signal**: `queryRower` interface-widening pattern (third instance: 140, 178, 172). `trading_mode` cross-service string contract remains unguarded.

**Deferred follow-ons**: Model funding events for cash-flow-aware HWM; cross-service `trading_mode` string contract test; rename/split shared event type `portfolio.risk.drawdown_breach`.

**Ledger entries written**: insights.md (2), fails.md (0) — see the 2026-09-09 entries.

**Runtime-invariant recommendations (→ /context-constitution)**: PORTFOLIO-N1 candidate: shared `portfolio.risk.drawdown_breach` event-type name ambiguity. PORTFOLIO-N2 candidate: `trading_mode` cross-service string contract unguarded.

**Pruned artifacts**: product-spec.md, recon.md, design.md, implementation-spec.md — last present at 6c53133e315c7978a97fa36aa05fcdf11aca00a9.
