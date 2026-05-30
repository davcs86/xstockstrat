# Context: upgrade-nextjs15

**Feature**: `docs/roadmap/features/041-upgrade-nextjs15/feature.md`
**Product Spec**: `docs/roadmap/features/041-upgrade-nextjs15/product-spec.md`
**Implementation Spec**: `docs/roadmap/features/041-upgrade-nextjs15/implementation-spec.md`

---

## Session 2026-05-30T00:00:00Z — sdd-story

- Wrote product-spec.md from the existing `idea`-state feature.md backlog entry (created
  2026-05-27 after the DO deploy-failure investigation). Status: `idea` → `draft`.
- Part of a 4-feature spec batch (033, 041, 045, 044), each delivered as an independent PR off
  `main-dev`. Open questions deliberately left open for the `/sdd-review product-spec` gate.
- Grounded against current `main-dev`:
  - `xstockstrat-insights` and `xstockstrat-config-ui`: `next` `^14.2.3`, `react` `^18.3.1`,
    `eslint-config-next` `^14.2.35`, OTel `@opentelemetry/sdk-node` + `exporter-trace-otlp-http`
    at `^0.218.0`.
  - `xstockstrat-trader`: `next` `^15.5.15` (the realignment target).
- Open questions raised for review: exact v15 pin policy, React 18-vs-19 (and Radix/charting
  gating), whether the pnpm-workspace standalone-path workaround can be removed on v15, OTel
  package compatibility, and sequencing against features 045 (UI consolidation) and 044
  (client-api-pattern).
- Next action: `/sdd-review upgrade-nextjs15 product-spec`.
