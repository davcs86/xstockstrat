# Context: opportunity-universe-unification  (archived 2026-08-06)

**Feature**: ./feature.md
**Status**: launched — archived by /sdd-archiver; verbose specs pruned (recoverable via git history).

## Archive Synthesis — 2026-08-06 — /sdd-archiver

**What**: The Decide queue became a materialized `analysis.opportunities` table (mig 011) fed by a single signal-free readiness kernel, with `ListOpportunities` reduced to a pure read plus lazy compute-on-read/stale-while-revalidate/daily refresh — no standing producer loop. Signals became a universe+ranking axis only for the legacy backtest score path; watchlists became `(symbol, strategy_id)` bindings via a deprecate-in-place proto field.
**Why (irrecoverable rationale)**: Analysis has no way to enumerate its own users (`strategies` table has no owner column, no global user-list RPC), so any standing background producer would only ever refresh users who already read — making a "warm" loop's benefit invisible and its cost unbounded (design.md §Rejected Alternatives, dup'd below). Separately, the product-spec's original plan to deprecate `signal_weight`/`signal_sources` off the *strategy definition* was overridden mid-design once the adversary round proved `StrategyDefinition.signal_params` is the live-loop symbol universe and lives inside the 065 definition fingerprint (`context.md:60`, `design.md:51-60`, ANALYSIS-3) — deprecating it would have silently orphaned live strategies and cleared grades.
**Rejected alternatives**:
- Standing 60s all-user producer loop — can't enumerate users; `live_loop`'s cap truncates rather than round-robins (design.md:79-82).
- Event-push via ledger `StreamEvents` — analysis is currently write-only to ledger; new gated inbound edge for latency a daily platform doesn't need (design.md:83-85).
- In-memory process memo — restart-fragile, analysis deliberately holds no in-memory state (design.md:86-87).
- Deprecating `StrategyDefinition.signal_params` — would break `SetStrategyLive`/live loop/065 fingerprint (design.md:92-93).
- Wall-clock TTL — expires over weekends or fires mid-session vs. a bar-date key (design.md:90-91).
**Scars & gotchas**:
- Connect-JSON request encoding traps hit while wiring UI e2e mocks: request enums serialize as the NAME string, `Timestamp` as an RFC3339 string, not numeric/epoch (context.md:305).
- Playwright `fullyParallel` pollutes a shared in-memory mock server's action-state set — persistence had to be proven via per-page `page.route()` isolation (context.md:305).
- `opportunities.py` raw-SQL repo coverage sat at 29% in unit tests (only covered end-to-end via `_FakeOppRepo`) — accepted as CI-equivalent, not a real gap (context.md:235-238).
- Action model for non-signal (curated) candidates deliberately narrower than signals (ENTER/ADD only, no speculative sell-only) — a P-03 documented scope choice, not an oversight (context.md:238).
**Permanent deviations**: none — design.md's chosen approach (narrowed signal-blend retirement, lazy-materialize) is exactly what shipped.
**Cross-feature signal**: Feature 095 (draft) plans to append fields to `analysis.Opportunity`; once 097's fields 10/11 land, 095 must number 12+ — needs a `095 → 097` merge-order row when 095 reaches `/sdd-spec` (context.md:118).
**Deferred follow-ons**: Calendar-aligned refresh (holiday/DST/early-close-aware) was explicitly deferred as a future feature, current `refresh_hour_utc` is a plain daily timer (design.md:107-109, OR-C).
**Ledger entries written**: insights.md (1), fails.md (1) — see the 2026-08-06 entries.
**Runtime-invariant recommendations (→ /context-constitution)**: - none (ANALYSIS-3 already exists as a documented module invariant; this feature confirmed rather than discovered it).
**Pruned artifacts**: product-spec.md, recon.md, design.md, implementation-spec.md — last present at f871138.
