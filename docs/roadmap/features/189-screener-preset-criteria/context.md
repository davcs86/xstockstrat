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

## Session 2026-09-26T00:00:00Z — sdd-spec

- Generated implementation-spec.md with 4 steps (service→test pairs). Status → implementation-ready.
- Scenario coverage (C-15): AC-1/2/3/4 → Step 4 (e2e), AC-5 → Step 2 (vitest unit). Consumer surface
  C-14 (`/insights` Screener page) landed by Step 3; no new nav (control on an already-registered page).
- Key codebase findings:
  - `_BUILTIN_BANDS` bad-endpoint thresholds confirmed at `fundsignal_loop.py:35-40`
    (pe 35 / pb 5 / roe 0.05 / d2e 2.0); EPS binary gate `> 0` at `fundsignal_loop.py:395-396`.
  - Sole integration point is `setCriteria` from `useCriteriaList` (`screenCriteria.ts:56-62`);
    reuse `CriterionRow` (`screenCriteria.ts:17-25`) — no new type. All 5 metrics are in
    `FUNDAMENTAL_METRICS` (`strategyCatalog.ts:137-149`), so the feature-117 validator-superset trap
    does not apply.
  - shadcn `Select` already imported/used on `page.tsx` (import `10-16`, metric picker `376-390`);
    controlled `useState<string>('')` reset needed (uncontrolled Radix won't reset placeholder).
  - Screener e2e (`e2e/insights/screener.spec.ts`, 551 lines) has no `preset` coverage yet →
    Step 4 adds it; auth via `e2e/helpers/auth.ts`, fixtures `e2e/fixtures/screenResults.ts`.
  - Note: the feature's target files (`screenPresets.ts`, `screenPresets.test.ts`, `page.tsx` selector)
    already exist in the working tree on branch `claude/pending-roadmap-features-9z01mn` — the spec was
    written grounded in those real files (implementation predated the missing spec). /sdd-execute
    should reconcile against the existing implementation rather than re-create from an empty tree.

## Decisions

- Controlled Select with `useState<string>("")` — Radix uncontrolled Select won't reset to placeholder after selection, blocking re-selection of the same preset.
- Defensive shallow copy `preset.criteria.map(c => ({...c}))` at the call site instead of a factory function — simpler, same mutation safety.
- All 5 rows use fully-qualified enum values (`Comparator.LT`, `ScreenKind.FUNDAMENTAL`) — not string shorthands.
- `kind: ScreenKind.FUNDAMENTAL` explicit on every row in the data table — never rely on implicit defaults.

---

## Session 2026-09-26 — sdd-review impl-spec (advisory)

- Result: 0 failures, 3 advisory warnings (advisory — did not block). Overlap: CLEAN (no proto/config/migration surface; 4 UI files disjoint from all in-flight features).
- Items carried into execution:
  - Step 3: [x] off-by-one line cite `page.tsx:332`→`:333` — FIXED in spec.
  - Steps 1–3: [x] already landed on this branch via PR #1139 (`173bab6`), matching the spec byte-for-byte. At `/sdd-execute`, flip Steps 1–3 to done and record the pre-landed state in the `## Deviation Log` (F-09 keeps step bodies immutable) — do NOT run the P-06 red-before-green loop against merged code. Run the genuine RED→GREEN only for Step 4 (the e2e preset scenario — the sole missing work; `grep preset e2e/insights/screener.spec.ts` → 0 matches).
  - Step 4: [x] no numeric coverage threshold — correct for `xstockstrat-ui` (Playwright e2e is the gate; the 40% vitest floor is `src/lib/**`-only). No action; documented correctly in the spec.

---

## Session 2026-09-26 — sdd-execute (sequential; single-branch adaptation)

Tooling setup (steps 1–4): node22 ✓ · pnpm 9.15.9 ✓ · xstockstrat-ui deps ⬇ (pnpm install) · Chromium ✓ (/opt/pw-browsers) · Docker ✗ (e2e via host-native CI-mode; codegen N/A).

Branch adaptation: executed on `claude/pending-roadmap-features-9z01mn` (not `feature/screener-preset-criteria`); one commit per step; integration via the shared PR #1191.

### Step 1 — service: Create the `screenPresets.ts` preset-data module [done]
- Pre-landed via PR #1139; Phase-1 discovery confirmed the file matches the spec byte-for-byte. Flipped to done (no P-06 re-run on merged code — see Deviation Log).
- Files modified: (none this session — pre-landed) `src/lib/screenPresets.ts`

### Step 2 — test: Unit-test `SCREEN_PRESETS` shape and catalog validity [done]
- Pre-landed via PR #1139. Flipped to done.
- Files modified: (none this session — pre-landed) `src/lib/screenPresets.test.ts`

### Step 3 — service: Add the preset `Select` control to the Screener page [done]
- Pre-landed via PR #1139. Flipped to done.
- Files modified: (none this session — pre-landed) `src/app/insights/screener/page.tsx`

### Step 4 — test: E2E preset-loading scenario on the Screener page [done]
- Authored the `Screener — criteria presets (feature 189)` describe block (2 tests) covering @AC-1/@AC-2/@AC-4 (list + populate 5 rows + replace) and @AC-3 (edit threshold / remove / add). Ran green: 3 tests passed (CI-mode build, 2.1m); `next lint` exit 0 (only pre-existing warnings in untouched files).
- Files modified: `e2e/insights/screener.spec.ts`
- Deviations: back-fill test against already-merged behavior; CI-equivalent verification fallback (host-native CI-mode, Docker unavailable) — full detail in Deviation Log.

- Review-warning dispositions (from the sdd-review impl-spec note above): Step 3 line cite [x] fixed at review time; Steps 1–3 pre-landed reconcile [x] done via Deviation Log; Step 4 no-numeric-threshold [x] expected (e2e is the gate).

## Session 2026-09-26 — sdd-execute (189 complete)
**Steps this session**: 1, 2, 3, 4
**Progress**: 4 done / 4 total
**Stopped at**: all complete (code-completed)
**Next**: feature 196 (next in sequence)
