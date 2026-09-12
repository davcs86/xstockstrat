# Context: screener-preset-criteria

**Feature**: `docs/roadmap/features/189-screener-preset-criteria/feature.md`
**Product Spec**: `docs/roadmap/features/189-screener-preset-criteria/product-spec.md`
**Implementation Spec**: `docs/roadmap/features/189-screener-preset-criteria/implementation-spec.md`

---

## Session 2026-09-12T00:00:00Z — sdd-story

- Created feature.md (status: draft), product-spec.md, acceptance.feature, context.md from user story.
- Fundamentals Signal preset mirrors `_BUILTIN_BANDS` from `fundsignal_loop.py:35-40` plus the EPS binary gate (`fundsignal_loop.py:395-397`). Thresholds use the "bad endpoint" values (the boundary beyond which the linear interpolation returns 0.0) to act as rank-only filters — the screener's own normalization handles the scoring.
- Ledger scan: fails.md:1399-1403 (feature 117, `_validate_fundamental_metrics` accepts superset) noted in Open Questions — not applicable to this preset's 5 closed-set metrics.
- UI-only feature: no proto, no config, no migration, no backend changes. The existing `useCriteriaList.setCriteria` is the sole integration point.

## Session 2026-09-12T00:00:00Z — sdd-design

- Phase 0 Recon: wrote recon.md (services: xstockstrat-ui; key reuse patterns: setCriteria mutator, shadcn Select component).
- Phase 1 Grilling: 2 rounds (quick). Chosen approach: new `screenPresets.ts` module with typed `ScreenPreset` + controlled Select dropdown above criteria builder, defensive shallow copy on apply. Rejected: factory function (unnecessary), separate PresetSelector component (overbuilt), uncontrolled Radix Select (won't reset placeholder).
- Constitution rules touched: C-08, C-10, C-14, C-15, C-16, F-04, P-01. Floor breaches: none.
- Status: draft → design-approved.

## Decisions

- Controlled Select with `useState<string>("")` — Radix uncontrolled Select won't reset to placeholder after selection, blocking re-selection of the same preset.
- Defensive shallow copy `preset.criteria.map(c => ({...c}))` at the call site instead of a factory function — simpler, same mutation safety.
- All 5 rows use fully-qualified enum values (`Comparator.LT`, `ScreenKind.FUNDAMENTAL`) — not string shorthands.
- `kind: ScreenKind.FUNDAMENTAL` explicit on every row in the data table — never rely on implicit defaults.
