# Implementation Spec: fix-opportunity-composite-score

**Status**: `done`
**Created**: 2026-10-06
**Feature**: `docs/roadmap/features/221-fix-opportunity-composite-score/feature.md`
**Total Steps**: 2
**Feature Branch**: `feature/fix-opportunity-composite-score`

### Scenario Coverage (Constitution C-15)

| Scenario | Covered by step(s) |
|---|---|
| `@AC-1` neutral composite renders muted | Steps 1–2 (vitest + e2e MSFT 0.512) |
| `@AC-2` tails coloured by direction | Steps 1–2 (vitest 0.72/0.30; e2e AAPL 0.732) |
| `@AC-3` strategy-grade colouring unchanged | Step 1 (vitest `scoreColor(0.65)`) |

### Step 1 — service: `compositeColor` bands + render sites

**Status**: `done` — **Service**: `xstockstrat-ui` — **TDD**: `red-green required`
**Files**: `src/lib/scoreDisplay.ts` (+ `.test.ts`), `src/app/insights/opportunities/page.tsx`,
`src/app/trader/positions/[symbol]/page.tsx`, `src/components/mobile/SectionRenderer.tsx`

`compositeColor(score)` with `COMPOSITE_NEUTRAL = 0.5`, `COMPOSITE_NEUTRAL_BAND = 0.08` replaces
`scoreColor` at the three composite render sites (`scoreColor` untouched for grades/screener).

### Step 2 — test: e2e composite render (supersedes 199 @AC-8 colour assertion)

**Status**: `done` — **Service**: `xstockstrat-ui`
**Files**: `e2e/insights/opportunities.spec.ts`, `e2e/fixtures/opportunities.ts`, `e2e/fixtures/INVENTORY.md`

**Verification**: `pnpm exec vitest run src/lib/scoreDisplay.test.ts`; `playwright test e2e/insights/opportunities.spec.ts -g "feature 221|feature 199"` (3 passed).

## Deviation Log

1. Negative tail uses `text-sell` (directional loss token), not `text-destructive` — the AC only
   requires "negative colour" and forbids destructive for neutral.
