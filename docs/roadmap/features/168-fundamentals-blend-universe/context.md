# Context: fundamentals-blend-universe  (archived 2026-09-09)

**Feature**: ./feature.md
**Status**: launched — archived by /sdd-archiver; verbose specs pruned (recoverable via git history).

## Archive Synthesis — 2026-09-09 — /sdd-archiver

**What**: Shipped a config-gated universe-override branch inside `_run_cycle` that force-runs a configurable blend strategy on exactly the fundamentals universe (symbols with active source=="fundamentals" signal AND `GetFundamentalsMulti` row), while excluding that strategy from every other symbol. Additive (other strategies unchanged). No proto change, no analysis migration; only a config seed migration for two `analysis.engine.*` keys.

**Why (irrecoverable rationale)**: Blend strategy on broad watchlist is actively wrong (not just wasteful). Per-user ownership model preserved over promoting to global/platform strategy. Fundamentals universe resolved once per cycle (platform-global data makes per-user resolution wasteful and a pacing/F-06 violation).

**Rejected alternatives**: Global/platform strategy (abandons per-user ownership model); parallel loop (duplicates fair-share rotation, DRY violation); per-user `GetFundamentalsMulti` fan-out (F-06 pacing); unconditional resolution (wastes gRPC round trip); fall back to broad universe on error (FR-6/AC-6 forbid it); hardcode source string (F-07); union held symbols into blend universe for exit-tracing only (rejected: loop places no orders so blast radius is a missed exit alert, not a stranded position — bounded cost justifies stricter FR-2 rule for v1).

**Scars & gotchas**: Config migration 024→026 renumber on merge; `_drain_signals` drops source (can't reuse for source-filtered query); MagicMock `__eq__` identity is accidentally load-bearing for test isolation.

**Permanent deviations**: `f.symbol.upper()` → `_normalize_symbol(f.symbol)` — design said `f.symbol.upper()`, shipped `_normalize_symbol(f.symbol)` because symmetry with the signal side (`_normalize_symbol(s.symbol)`) — behavior-equivalent for uppercase tickers.

**Cross-feature signal**: Once-per-cycle resolver pattern reusable for future "run strategy X on derived sub-universe Y".

**Deferred follow-ons**: Cross-cycle TTL cache for fundamentals universe; operator visibility in config-ui/agent.

**Ledger entries written**: insights.md (2), fails.md (0) — see the 2026-09-09 entries.

**Runtime-invariant recommendations (→ /context-constitution)**: None.

**Pruned artifacts**: product-spec.md, recon.md, design.md, implementation-spec.md — last present at 6c53133e315c7978a97fa36aa05fcdf11aca00a9.
