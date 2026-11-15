# Context: chart-series-palette

**Feature**: `docs/roadmap/features/342-chart-series-palette/feature.md`
**Product Spec**: `docs/roadmap/features/342-chart-series-palette/product-spec.md`
**Implementation Spec**: `docs/roadmap/features/342-chart-series-palette/implementation-spec.md`

---

## Session 2026-11-15 — sdd-story

- Created feature.md (status: draft), product-spec.md, acceptance.feature, context.md from an operator report (staging, homelab, with screenshots) and same-day read-only recon.
- Operator decisions (2026-11-15): add a **separate series palette** (do not unfreeze `--chart-1..5`), sized **12**; colors unique across the whole chart; contrast ≥3:1 and color-blind-safe in both themes.
- Interpretation (mine): the operator's "Yes, extend it to 12 colors" answered a question offering replace-frozen vs. separate-set with separate-set recommended; read as accepting the separate set at 12 entries.
- The CIEDE2000 ≥10 threshold in @AC-5 is my proposed measurable form of "color-blind safe"; confirm or adjust in design.
- Recon facts: `IndicatorPanels.tsx:16-17,95` (per-component `si % 5` index), `staging.css:21-25` (grayscale), `ui-ux-governance.md:44,263` (freeze).
