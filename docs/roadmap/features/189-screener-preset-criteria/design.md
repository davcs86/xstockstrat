# Design: screener-preset-criteria

**Created**: 2026-09-12
**Rounds**: 2 (quick; termination: approved)
**Approved by**: user @ 2026-09-12T00:00:00Z
**Grounded in**: recon.md

---

## Chosen Approach

**New `src/lib/screenPresets.ts` module** containing a `ScreenPreset` type and a `SCREEN_PRESETS`
constant array. The type shape is `{ id: string; name: string; description: string; criteria:
CriterionRow[] }`, reusing the existing `CriterionRow` type (`recon.md` → `src/lib/screenCriteria.ts:17-25`)
— no new type invention needed. The "Fundamentals Signal" preset defines 5 `CriterionRow` entries
with all `kind` fields set to `ScreenKind.FUNDAMENTAL` and `op` fields using the fully-qualified
`Comparator.LT` / `Comparator.GT` enum values (`recon.md` → `packages/proto/analysis/v1/analysis.proto:422-438`):

| metricName | op | threshold | weight | hardFilter | kind |
|---|---|---|---|---|---|
| `pe_ratio` | `Comparator.LT` | 35 | 1 | false | `ScreenKind.FUNDAMENTAL` |
| `pb_ratio` | `Comparator.LT` | 5 | 1 | false | `ScreenKind.FUNDAMENTAL` |
| `roe` | `Comparator.GT` | 0.05 | 1 | false | `ScreenKind.FUNDAMENTAL` |
| `debt_to_equity` | `Comparator.LT` | 2 | 1 | false | `ScreenKind.FUNDAMENTAL` |
| `eps` | `Comparator.GT` | 0 | 1 | true | `ScreenKind.FUNDAMENTAL` |

**Screener page modification** (`recon.md` → `src/app/insights/screener/page.tsx:65`): add a
controlled `Select` dropdown (via `useState<string>("")`) above the criteria builder section
(`page.tsx:298`), using the existing shadcn `Select` component already imported on the page
(`recon.md` → `src/components/ui/select.tsx`). Each `SelectItem` renders preset `name` +
`description`. On selection, the handler finds the preset by `id`, applies a defensive shallow copy
— `setCriteria(preset.criteria.map(c => ({...c})))` — via the existing `setCriteria` mutator
(`recon.md` → `src/lib/screenCriteria.ts:59`), then resets the controlled value to `""` so the
placeholder re-renders. The `SelectTrigger` carries `aria-label="Load preset"` for accessibility.

**Consumer surface (C-14):** the preset selector is a new control on the existing Screener page
(`/insights/screener`) in `xstockstrat-ui`. No backend, agent, proto, config, or migration changes.

**Unit test** (`src/lib/screenPresets.test.ts`): vitest, following the pattern at
`recon.md` → `src/lib/screenWeights.test.ts`. Validates AC-5: every preset entry references a valid
`FUNDAMENTAL_METRICS` or `BUILTIN_INDICATORS` entry, non-empty criteria arrays, correct field types.

**E2e test extension** (`e2e/insights/screener.spec.ts`): one scenario covering AC-1/2/3/4 — load
the preset, assert 5 rows with correct values, verify editability (change threshold, remove row,
add row, assert count changes), load again to confirm replacement.

## Rejected Alternatives

- **Factory function per preset** — rejected because a static `CriterionRow[]` constant is simpler,
  tree-shakeable, and doesn't need parameterization; a shallow copy at the call site provides
  mutation safety without a factory layer.
- **Separate `PresetSelector` component** — rejected because it violates the "minimum that solves"
  principle; the Select dropdown is ~15 lines of JSX inline in `page.tsx`, tightly coupled to the
  page's `setCriteria` mutator, and extracting it adds a file + an import for no reuse gain (the
  `SymbolScreening` card is explicitly out of scope).
- **Uncontrolled Radix Select** — rejected because Radix maintains internal selection state; after
  choosing a preset the trigger would show the preset name instead of resetting to the "Load
  preset…" placeholder, preventing re-selection of the same preset.

## Open Risks

- [ ] No open risks — UI-only, no backend seam, no state persistence.

## Constitution Rules Touched

- `C-08` — honored by: reusing shadcn `Select` component already imported on the page; no new UI
  primitive introduced.
- `C-10` — honored by: screener page already registered in `PLATFORM_SUBNAV`
  (`recon.md` → `PlatformHeader.tsx:80` + `navGroups.tsx:50`); no new page/route.
- `C-14` — honored by: consumer surface is the existing `/insights/screener` page; the preset
  selector is a control on that page.
- `C-15` — honored by: `acceptance.feature` contains 5 `@AC-*` scenarios covering all FRs; unit
  test covers AC-5, e2e test covers AC-1/2/3/4.
- `C-16` — honored by: no existing `@AC-*` guarantees touched (net-new behavior only, per
  `recon.md` → Existing Business Rules).
- `F-04` — honored by: all `path:line` references sourced from `recon.md` codebase discovery digest.
- `P-01` — honored by: single orchestrator wrote all artifacts; subagents were advisory only.

## Business Rules Touched (C-16)

No existing `@AC-*` guarantees are affected. This feature introduces net-new behavior only — the
screener page's criteria builder has no prior acceptance scenarios in any service's durable suite
or in `platform.feature`.
