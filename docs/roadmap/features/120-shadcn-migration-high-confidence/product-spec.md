# Product Spec: shadcn-migration-high-confidence

**Created**: 2026-08-08

---

## Problem Statement

A full-codebase audit ("The Component Ledger" — every file under `services/xstockstrat-ui/src/components/{auth,copilot,insights,mobile,shared,trader,ui}/` and `src/app/**/*.tsx` read in full) found 27 occurrences, across 12 files, where a UI shape shadcn/ui already has an official primitive for was hand-rolled from raw `<div>`/`<button>`/`<span>` markup instead — several of them byte-for-byte duplicated across two or three call sites. The audit rated these 27 occurrences **high confidence**: either an exact-shape match to a still-missing primitive, or literal duplicate markup that a shared primitive would collapse to one implementation.

**Note on codebase state**: a separate, concurrently-landed feature, `119-shadcn-ui-migration`, merged to `main-dev` while this audit was being turned into backlog features. It migrated `src/components/ui/` from a hand-rolled Tailwind v3 setup to the official shadcn CLI (`components.json`, preset `bLTl5gh6`, Tailwind v4) and, as part of that infra swap, happened to add `ui/textarea.tsx` and touch three files this audit also flagged (`ChartPanel.tsx`, `RuleEditor.tsx`, `ComponentEditor.tsx`) for an unrelated reason (rewriting `Combobox` onto Base UI). This feature's scope is unchanged by that migration — it still needs to add the eight primitives below and wire the specific call sites listed — but two things are already true going in: `ui/textarea.tsx` exists (FR-6 only needs to *adopt* it, not add it), and the `ChartPanel.tsx`/`RuleEditor.tsx` line ranges below were re-verified against current `main-dev` after 119 landed.

## User Story

As an `xstockstrat-ui` developer, I want the high-confidence duplicated widgets replaced with shared `ui/*` primitives, so that segmented selectors, alert banners, destructive confirms, progress bars, and form controls have one canonical implementation each instead of five to nine independent hand-rolled copies that can silently drift from each other.

## Functional Requirements

FR-1. Add `src/components/ui/tabs.tsx` (`npx shadcn@latest add tabs` against the existing preset, or hand-authored Radix `@radix-ui/react-tabs` + cva + `cn()` if the CLI add is unavailable — matching the style of `ui/select.tsx`/`ui/sheet.tsx`) and replace all five high-confidence Tabs-shaped occurrences: `src/components/insights/FormulaReferencePanel.tsx:17-24,49-63`; `src/components/insights/RuleEditor.tsx:157-175` (re-verified post-119; was `:150-167` at audit time); `src/app/insights/market/[symbol]/page.tsx:184-196`; `src/app/trader/positions/[symbol]/page.tsx:302-316`; `src/components/trader/ChartPanel.tsx:118-132` (re-verified post-119; was `:104-119` at audit time).

FR-2. Add `src/components/ui/toggle-group.tsx` (`npx shadcn@latest add toggle-group`) and replace the two high-confidence Toggle-Group-shaped occurrences: `src/app/insights/screener/page.tsx:348-378` (hard/rank filter toggle); `src/components/trader/OrderForm.tsx:144-157` (Buy/Sell segmented toggle — check whether the CLI-added default variants need the same `buy`/`sell` app-specific reconciliation already applied to `ui/button.tsx`/`ui/badge.tsx` per `services/xstockstrat-ui/CLAUDE.md` § Styling).

FR-3. Add `src/components/ui/alert-dialog.tsx` (`npx shadcn@latest add alert-dialog`) and replace the two high-confidence inline two-step destructive-confirm occurrences: `src/components/trader/accountShared.tsx:213-245` (`AccountRow` remove-confirm); `src/components/trader/OrdersTable.tsx:58-66,140-149` (cancel arm/confirm). The five `window.confirm()` call sites the audit also flagged as Alert-Dialog-shaped are **out of scope** — they belong to the medium-confidence companion feature.

FR-4. Add `src/components/ui/alert.tsx` (`npx shadcn@latest add alert`) and replace the three high-confidence occurrences: `src/components/copilot/CopilotRail.tsx:149-165` (concentration-flag warning); `src/components/shared/CardNotice.tsx:4-22` (status/error line); `src/components/mobile/SectionRenderer.tsx:110-123` (`note` section kind).

FR-5. Add `src/components/ui/checkbox.tsx` (`npx shadcn@latest add checkbox`) and replace the two high-confidence raw `<input type="checkbox">` occurrences: `src/components/insights/FormulaWorkspace.tsx:278-284` (Public flag); `src/components/insights/ParameterEditor.tsx:236-244` (Required flag).

FR-6. **Adopt** the existing `src/components/ui/textarea.tsx` (already added by `119-shadcn-ui-migration` — no new primitive needed) and replace the three occurrences of one duplicated hand-written class string, which `119` did not touch and are still hand-rolled: `src/components/insights/FormulaWorkspace.tsx:254-259` and `:351-356`; `src/components/insights/RuleEditor.tsx:327-335` (re-verified post-119; was `:274-283` at audit time).

FR-7. Add `src/components/ui/breadcrumb.tsx` (`npx shadcn@latest add breadcrumb`) and replace the three occurrences (two of which are byte-for-byte identical markup): `src/components/shared/PlatformHeader.tsx:260-269`; `src/app/config-ui/audit/page.tsx:15-22`; `src/app/config-ui/[namespace]/NamespaceEditor.tsx:124-144`.

FR-8. Add `src/components/ui/accordion.tsx` (`npx shadcn@latest add accordion`) and replace the one high-confidence occurrence: `src/components/shared/PlatformHeader.tsx:209-253` (mobile expandable nav groups — `aria-expanded` button + rotating chevron).

FR-9. Add `src/components/ui/progress.tsx` (`npx shadcn@latest add progress`) and replace the three occurrences of identical hand-rolled percentage-bar markup: `src/components/insights/SignalReadiness.tsx:71-82`; `src/components/insights/WatchlistReadiness.tsx:200-220`; `src/components/mobile/SectionRenderer.tsx:64-71`.

FR-10. Switch `src/components/copilot/CopilotRail.tsx:124-126` (the "beta" pill, a raw `<span>`) to import and use the existing `src/components/ui/badge.tsx` `Badge` component — no new primitive needed.

FR-11. Switch `src/app/insights/page.tsx:24-53` (`DashboardSkeleton`) and `src/app/auth/login/page.tsx:33-43` (`LoginSkeleton`) to compose the existing `src/components/ui/skeleton.tsx` `Skeleton` component instead of raw `animate-pulse` divs — no new primitive needed.

FR-12. Every primitive added under this feature (FR-1 through FR-4, FR-7 through FR-9) follows the CLI-managed workflow documented in `services/xstockstrat-ui/CLAUDE.md` § Styling: `npx shadcn@latest add <name>` against the existing `components.json` preset (`bLTl5gh6`), then reconcile — if the primitive needs an app-specific variant (a `buy`/`sell`/`paper`/`live`/`warning`/`info` tone, mirroring the pattern already on `ui/button.tsx`/`ui/badge.tsx`), hand-add it back into the regenerated file's `cva()` `variants` object marked `// app-specific`, and add a mechanical regression test (`<name>.test.ts`, mirroring `button.test.ts`/`badge.test.ts`) asserting it survives a future `apply --preset` re-run. If the CLI is unavailable in the execution environment, hand-author the file matching the existing primitives' output shape (`cva` + the underlying `@radix-ui/react-*` primitive + `cn()` from `ui/utils.ts` + `React.forwardRef` + `displayName`) and note the fallback in `context.md`.

## Out of Scope

- The 22 medium-confidence and 4 low-confidence occurrences from the same audit — each has its own companion backlog feature (`shadcn-migration-medium-confidence`, `shadcn-migration-low-confidence`).
- The 12 "no close match" bespoke widgets the audit explicitly found correctly-not-reinvented (candlestick chart, equity-curve chart, Monaco formula editor, sparkline, list-editors, rule-condition builder, wizard stepper, stat tiles, inline-edit watchlist name, copilot note thread, empty state, mobile section dispatcher) — nothing to change there.
- `src/components/ui/combobox.tsx` and the absence of a centered-modal `Dialog` primitive — both noted by the audit as deliberate architectural choices (self-built lightweight combobox with no `cmdk`/Popover dependency; every modal-shaped need currently goes through `Sheet`), not migration targets.
- Any visual/behavioral redesign beyond swapping the underlying markup — this is a like-for-like primitive substitution, not a UX change.

## Affected Services

- `xstockstrat-ui` — all twelve touched files live in this service (`src/components/{copilot,insights,mobile,shared,trader}/*` and `src/app/{insights,trader,config-ui,auth}/**`); eight new primitives added to `src/components/ui/` (Tabs, Toggle Group, Alert Dialog, Alert, Checkbox, Breadcrumb, Accordion, Progress) plus reuse of three that already exist (Badge, Skeleton, and — as of `119-shadcn-ui-migration` — Textarea).

## Consumer Surface(s)

_Constitution **C-14**._

- [x] **UI** — `xstockstrat-ui` segments `/insights` (FormulaReferencePanel, RuleEditor, market/[symbol], screener, FormulaWorkspace, ParameterEditor, SignalReadiness, WatchlistReadiness, insights/page.tsx dashboard skeleton), `/trader` (ChartPanel, OrderForm, accountShared, OrdersTable, positions/[symbol]), `/config-ui` (audit, [namespace]/NamespaceEditor), plus the shared header/mobile-rail/copilot-rail components used across all segments (`PlatformHeader`, `SectionRenderer`, `CopilotRail`, `CardNotice`) and the root `/auth/login` page. Every change is a like-for-like markup swap inside an already-shipped, already-reachable page — no new routes, no nav registration needed (C-10(a) does not apply; nothing new becomes reachable).
- [ ] **Agent** — not applicable.
- [ ] **None**.

## Proto Contract Changes

- [x] No proto changes required

## Config Key Changes

- [x] No new config keys

## Database Changes

- [x] No schema changes

## Feature Workflow Notes

Branch to create: `feature/shadcn-migration-high-confidence` (branch from `main-dev`)
Approval gates required (per docs/runbooks/feature-workflow.md):
- [x] 1 service owner approval (non-breaking, UI-only change — `xstockstrat-ui` owner)
- [ ] 2 service owners + platform lead (breaking proto change) — not applicable
- [ ] DBA review + service owner (schema migration) — not applicable

## Acceptance Criteria

1. `src/components/ui/{tabs,toggle-group,alert-dialog,alert,checkbox,breadcrumb,accordion,progress}.tsx` exist (via the shadcn CLI against the existing preset, or hand-authored to the same shape as a fallback), follow the conventions documented in `services/xstockstrat-ui/CLAUDE.md` § Styling, and are exported the same way `ui/select.tsx`/`ui/sheet.tsx` are. `ui/textarea.tsx` already exists (`119-shadcn-ui-migration`) and needs no new file.
2. Every file:line occurrence listed in FR-1 through FR-11 imports and renders the corresponding `ui/*` primitive; the raw hand-rolled markup it replaced is deleted, not left dead alongside it.
3. No two of the touched files still contain independent copies of the same widget's markup after migration (the duplicate timeframe tab-bar, the duplicate breadcrumb, the triplicated progress bar, and the triplicated textarea class string are each reduced to one shared implementation).
4. `pnpm lint` and `pnpm build` (`services/xstockstrat-ui`) pass with no new errors.
5. The existing Playwright e2e suite (`pnpm test:e2e`) passes for every spec covering a touched page/component, with no test rewritten to assert on the *old* hand-rolled DOM shape — assertions that keyed off ad hoc classNames/roles must move to whatever accessible role/label the new Radix-based primitive exposes.
6. `docs/roadmap/features/120-shadcn-migration-high-confidence/context.md` records, per primitive, which call sites were migrated and confirms no visual regression (manual screenshot compare or existing e2e visual coverage, whichever the touched page already has).

## Open Questions

- [ ] None of the touched call sites carry a `data-testid` the audit surfaced as e2e-load-bearing, but no exhaustive Playwright-selector inventory was run as part of the audit itself — `/sdd-design` should grep each touched file's corresponding `e2e/**/*.spec.ts` for selectors keyed to the markup being replaced (button text, `role=`, raw class names) before committing to a per-step migration order, per the general DRY/consumer-parity lesson in `docs/roadmap/ledger/fails.md` (e.g. 2026-08-05 — align-frontend-e2e-bff-mocks — duplication: shape drift between a component and its test double is only caught by full-suite runs, not inspection).
- [ ] `PlatformHeader.tsx` is touched by three separate FRs (FR-7 Breadcrumb, FR-8 Accordion, and it appears in the medium-confidence companion feature's Navigation Menu note) — `/sdd-spec` should sequence its steps so the same file isn't edited by two half-finished FRs in parallel.
