# Context: fundamentals-signal-producer  (archived 2026-08-06)

**Feature**: ./feature.md
**Status**: launched — archived by /sdd-archiver; verbose specs pruned (recoverable via git history).

## Archive Synthesis — 2026-08-06 — /sdd-archiver

**What**: A scheduled `xstockstrat-analysis` loop that scores cached fundamentals, maps scores to buy/sell/hold, and emits them via `IngestSignal` under a new generic `derived` source type — with FMP-budget-first design (cache-only reads, paced/soft-reserved budget, idempotent emit) so the signal flows through existing backtest/screener machinery with zero new consumers.
**Why (irrecoverable rationale)**: FMP free-tier budget discipline was the design's backbone — producer never touches FMP directly, reserves 200/250 daily requests and leaves 50 for the interactive screener, and idempotent emit ensures re-runs cost nothing (context.md:16-19, 2026-06-26). Deliberately scoped as **complementary to, not a replacement for**, feature 060's direct screener criteria — 062 separately scores and persists a signal so it flows through backtest weighting/alerting/source-weighting too (context.md:12-15; absent from product-spec.md/feature.md).
**Rejected alternatives**:
- Reusing an existing email/website `source_type`, or a literal `fundamentals` value — lost because a generic `derived` bucket is reusable for future synthetic producers without repeated CHECK migrations (context.md:89-92, 2026-06-27).
- Global watchlist union via a new 058 RPC — deferred; 058's `ListWatchlists` is user-scoped with no global-union endpoint, so shipped code fell back to `explicit` universe (context.md:171-172; feature.md:20).
- Earnings-calendar-driven `valid_until` — deliberately deferred, gated on the FMP earnings endpoint reaching the active tier (product-spec.md:70,156-157); never in context.md, no code path to grep.
**Scars & gotchas**:
- `ExternalSignal` has no `as_of_date` and `direction` is a string, not enum — idempotency had to live in analysis's own `fundsignal_emitted` PK(symbol,source,as_of_date) (context.md:52-56).
- `validate_config_json` defaulted fail-open for unrecognized `source_type`; hardened to fail-closed after user flagged it (context.md:109-118, Step 13, context.md:154-156).
- The fail-closed fix erased the very justification used to greenlight the additive CHECK migration: at decision time (context.md:97-102, 2026-06-27) the CHECK was judged safe to extend specifically because it was "already behind the code" — `IngestSignal` ignored source_type, no extractor worker ran over the registry, and `validate_config_json` already referenced `mediated_*` types absent from the CHECK — so extending the allow-list read as routine, not a validation loosening. That comparison point (CHECK trailing a fail-open validator) no longer exists once Step 13 made validation fail-closed, so the "why this was low-risk" reasoning is unrecoverable from current code — only this log preserves it.
- `PORTFOLIO_ENDPOINT` was entirely absent from `main.py`/`docker-compose.yml`/both `.do/app*.yaml` — added in all four (context.md:63-65).
**Permanent deviations**: - design said global watchlist union (FR-3) via 058 `ListWatchlists` -> shipped `explicit` fallback -> because 058's RPC is user-scoped and never gained a global-union endpoint before 062 shipped (context.md:171-172).
**Cross-feature signal**: - Three concurrently in-flight features (058, 059, 062) collided on the "next" shared config-migration number, caught only at impl-spec review, requiring manual renumbering (context.md:84-85).
**Deferred follow-ons**:
- A true global-union watchlist RPC in 058 would let the producer drop its `explicit` fallback.
- Earnings-calendar-driven `valid_until` once the FMP earnings endpoint is on the active tier (product-spec.md:70).
**Ledger entries written**: insights.md (5), fails.md (3) — see the 2026-08-06 entries.
**Runtime-invariant recommendations (→ /context-constitution)**: - none (ExternalSignal/no-as_of_date and IngestSignal/no-UNIQUE facts are grep-recoverable from proto/migrations).
**Pruned artifacts**: product-spec.md, implementation-spec.md — last present at f871138.
