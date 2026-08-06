# Context: trading-safety-dashboard-slos  (archived 2026-08-06)

**Feature**: ./feature.md
**Status**: demoted/canceled — archived by /sdd-archiver; verbose specs pruned (recoverable via git history).

## Archive Synthesis — 2026-08-06 — /sdd-archiver

**What**: A product spec for an `xstockstrat-ui` "Trading Safety" dashboard visualizing unprotected-position age, order-intent `UNKNOWN` state, reconciliation mismatches, and other P0 safety SLOs — never reached `/sdd-design`. It was canceled one hour after story creation, before recon or a design debate occurred (context.md:9-25; no recon.md/design.md/implementation-spec.md were ever written).
**Why (irrecoverable rationale)**: Two independent facts surfaced only at a manual feasibility re-check: (1) the underlying instrumentation features it depended on (100 as originally scoped, 101 as originally scoped, 102, 106) were themselves demoted or substantially rescoped, so most of the telemetry this dashboard would visualize would not exist as specced; (2) the platform already ships a Grafana Cloud/OTel dashboard mechanism from `033-phase7-observability` (`packages/otel/dashboards/`), making a few new panels there far cheaper than a new `xstockstrat-ui` page (context.md:19-23).
**Rejected alternatives**: n/a — canceled before any design-phase alternatives were debated.
**Scars & gotchas**: none — no execute session ever ran.
**Permanent deviations**: none — nothing shipped.
**Cross-feature signal**:
- A dashboard/UI feature whose FRs cite specific upstream features (100–107) by number can look fully grounded at story time, but that grounding silently rots if those upstream features get demoted/rescoped later — the dependency check has to be re-run at feasibility time, not just at story time (context.md:19-21).
- The existing Grafana/OTel dashboard set (feature 033) is the default home for new operator-facing metrics panels; a new `xstockstrat-ui` page is the more expensive alternative and should be justified against it, not assumed (context.md:22-23).
**Deferred follow-ons**: - If/when rescoped 100/101 emit real metrics worth watching, the cheaper move is new Grafana panels in the existing `packages/otel/dashboards/` set, not a new UI surface (context.md:25).
**Failure post-mortem**: - Root cause: speccing built on the *planned* existence of instrumentation from features 100-107 rather than their *actual* current lifecycle status; those dependencies degraded between story creation and feasibility check. Missed signal: the product spec's own Open Questions flagged "hard-depends on features 100–107 already emitting the underlying instrumentation... confirm which metrics are actually available before scoping" (product-spec.md:98-100) — the risk was named but not verified before story creation, only after.
**Ledger entries written**: insights.md (1), fails.md (1) — see the 2026-08-06 entries.
**Runtime-invariant recommendations (→ /context-constitution)**: - none
**Pruned artifacts**: product-spec.md — last present at f871138.
