# Context: fundamentals-data-source  (archived 2026-08-06)

**Feature**: ./feature.md
**Status**: launched — archived by /sdd-archiver; verbose specs pruned (recoverable via git history).

## Archive Synthesis — 2026-08-06 — /sdd-archiver

**What**: Shipped as designed — an FMP-backed `FundamentalsSource` interface, additive `GetFundamentals(Multi)` RPCs, a plain `marketdata.fundamentals` cache table, and quota-guarded read-through logic, all disabled by default (`marketdata.fmp.enabled=false`). No recon.md/design.md exist for this feature (context.md:9-20 shows it went story → review → spec directly, no `/sdd-design` run).
**Why (irrecoverable rationale)**: FMP's free tier (250 req/day) made an uncached fetch infeasible for the coming screener/producer features, so this feature was deliberately built as the **single FMP chokepoint** — 060 and 062 must read fundamentals only through this cached RPC so the daily budget is enforced in exactly one place (context.md:12-13).
**Rejected alternatives**:
- Routing fundamentals through the existing `BackfillBarsRequest`/source-routing path — lost because that message has no `source` field (product-spec.md:77; context.md:14-15).
- Gated `profile-bulk` FMP endpoint for extended metrics — avoided in favor of hybrid batch `quote` + per-symbol `ratios-ttm`/`profile` (product-spec.md:45; context.md:20).
- A dedicated quota-counter table — rejected for `COUNT(*)` over `fetched_at` in the UTC-day window, resolved decision OQ-059-d (product-spec.md:39,132).
**Scars & gotchas**:
- Config seed `key` column must carry the **full dotted key** (`marketdata.fmp.enabled`, not a relative form), because the config WatchConfig snapshot map is keyed by the raw `key` column with no namespace prefix added — verified in `configServiceImpl.ts` during Step 5 execution; a relative key would silently never resolve at runtime (implementation-spec.md:449-458; context.md:73-77).
- The existing `emitAlert` helper (`marketdata_service.go:761`) hardcodes `ALERT_SEVERITY_ERROR` and takes only `(ctx, msg)` — FR-7's WARNING alert required a **new** `emitWarning` helper rather than reusing/parameterizing it (context.md:54-56, 85-86).
- Step 8: the service's fundamentals config/repo access was deliberately split into two small interfaces (`fundamentalsConfig`, `fundamentalsRepo`) rather than wired directly to the concrete `*config.Watcher`/`*repository.MarketDataRepo` — the `*config.Watcher` snapshot is unexported and cannot be populated/injected from the `service` test package, so without this seam Step 9's unit tests could not set cache/quota/gate state without a live config stream or real DB (implementation-spec.md:460-465; context.md:88-90).
- Shared `xstockstrat-config/migrations/` dir caused a three-way NNN collision among sibling features (058=006, 059=007, 062=008); resolved by user-approved manual renumbering, recorded in `merge-order.md` (context.md:57-58).
**Permanent deviations**: none — the deviations above (full dotted key, new emitWarning helper, split interfaces) were resolved during execute and match what shipped; the spec's described approach already reflects them post-deviation-log.
**Cross-feature signal**: - Config-key numbering in the shared `xstockstrat-config/migrations/` directory needs cross-feature coordination (via merge-order.md) whenever multiple in-flight features touch config seeds simultaneously — this collision pattern is likely to recur.
**Deferred follow-ons**:
- Commercial/multi-user use requires re-evaluating the FMP plan (product-spec.md:135) — noted, not yet actioned.
- Historical fundamentals time-series/backfill explicitly out of scope for v1 (snapshot-only) — revisit if a growth criterion is requested (product-spec.md:57,131).
**Ledger entries written**: insights.md (3), fails.md (1) — see the 2026-08-06 entries.
**Runtime-invariant recommendations (→ /context-constitution)**: - none (the config-snapshot-key behavior is arguably a `CONFIG-*` platform invariant worth a constitution/context-constitution entry, but that routing is outside this subagent's scope — flagging for the archiver to consider).
**Pruned artifacts**: product-spec.md, implementation-spec.md — last present at f871138.
