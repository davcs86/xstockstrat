# Context: trading-safety-dashboard-slos

**Feature**: `docs/roadmap/features/108-trading-safety-dashboard-slos/feature.md`
**Product Spec**: `docs/roadmap/features/108-trading-safety-dashboard-slos/product-spec.md`
**Implementation Spec**: `docs/roadmap/features/108-trading-safety-dashboard-slos/implementation-spec.md`

---

## Session 2026-08-04T00:00:00Z — sdd-story

- Created feature.md (status: draft), product-spec.md, context.md from an external live-capital
  safety risk review. P2 item 11 ("trading safety dashboard and SLOs").
- Depends on features 100–107 already emitting the instrumentation this dashboard visualizes; it adds
  no new measurement logic of its own. Deliberately deferred from 102's minimal reconciliation-status
  indicator (a named follow-up per Constitution C-14).

## Session 2026-08-04T01:00:00Z — feasibility re-check (demoted)

- Its dependencies (100 as originally scoped, 101 as originally scoped, 102, 106) are either demoted
  or substantially rescoped (see each feature's own feasibility note), so most of the telemetry this
  dashboard was meant to visualize will not exist as specced. Separately: the platform already has a
  Grafana Cloud/OTel dashboard mechanism shipped by `033-phase7-observability`
  (`packages/otel/dashboards/`) — a new `xstockstrat-ui` page duplicates that rather than reusing it.
- Demoted to `demoted/canceled`. If/when the rescoped 100/101 emit real metrics worth watching, the
  cheaper move is a couple of new Grafana panels in the existing dashboard set, not a new UI surface.
