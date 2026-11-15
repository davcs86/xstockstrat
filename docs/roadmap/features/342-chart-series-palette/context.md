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

## Session 2026-11-15 — sdd-review product-spec

- Product spec approved. Status: draft → spec-ready.
- Warnings (5):
  - Criterion 2 (FR-4 testability): FR-4 gave no color-blind threshold — **resolved**: the CIEDE2000 ≥ 10 bound from @AC-5 is now stated in FR-4.
  - Criterion 8 (@AC-2 wording): "palette entries 1 through 5" refers to the internal palette index — kept; FR-2 fixes the order, so it is checkable. Design may restate it once token names exist.
  - Criterion 8 (@AC-3 scope): only one swatch was checked — **resolved**: @AC-3 now also checks the "vts stop_line" swatch (guards the per-component index restart).
  - Criterion 8 (@AC-1): the 12 token names are not pinned — accepted, deferred to design (Open Questions).
  - Criterion 11: consumer surface is thin on what changes — accepted; FR-2 and FR-3 cover it, detail at design time.
- Overlap findings: none
- Recommended design depth: quick (single service `xstockstrat-ui`, no proto, no schema change, no overlap finding)

OPERATOR DECISIONS (binding, recorded 2026-11-15):
- Add a separate categorical series palette of 12 colors; do not change the frozen --chart-1..5 staging values.
- Colors are unique across the whole indicator chart, legend swatches match their lines.
- Each color meets at least 3:1 contrast against the chart surface and is color-blind-safe, in both themes.
