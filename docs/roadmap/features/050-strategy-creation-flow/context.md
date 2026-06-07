# Context: strategy-creation-flow

**Feature**: `docs/roadmap/features/050-strategy-creation-flow/feature.md`
**Product Spec**: `docs/roadmap/features/050-strategy-creation-flow/product-spec.md`
**Implementation Spec**: `docs/roadmap/features/050-strategy-creation-flow/implementation-spec.md`

---

## Session 2026-06-06 — sdd-execute (sequential mode)

Running `/sdd-execute strategy-creation-flow sequential`. Branch model: user authorized the SDD
stacked-PR model (feature/strategy-creation-flow + feature-steps/*-step-N branches). Re-spec gate:
all 11 steps' Files/evidence validated against the live codebase — no mismatch, no re-spec needed.

### Step 1 — Proxy strategy-authoring RPCs and ListSignalSources through the insights BFF [done]
- Added `manageStrategy` (admin gate on register/update/deactivate), `getStrategy`,
  `listStrategyDefinitions`, `setStrategyLive` (admin gate) to the AnalysisService block, plus a new
  `IngestService` block with `listSignalSources`, in `src/lib/insightsBff.ts`. All forward
  `backendHeaders` (x-user-id/x-access-scope/x-trace-id). Admin gate reuses the `ADMIN_BIT = 0x04` /
  `PermissionDenied` pattern from `traderBff.ts`.
- Files modified: `services/xstockstrat-ui/src/lib/insightsBff.ts`
- Deviations: `connectClients.ts` was NOT modified — the spec listed it as a conditional edit ("only
  if `ingestClient` is not already exported"); it is already exported at `connectClients.ts:36`, so no
  change was needed.

### Step 2 — Strategy-definition browser hooks [done]
- Created `src/hooks/useStrategyDefinitions.ts` exporting `useStrategyDefinitions`, `useGetStrategy`,
  `useManageStrategy`, `useSetStrategyLiveInsights`. Mutations invalidate the strategy-definition /
  strategies / strategy-def query keys. Used `MessageInitShape<typeof StrategyDefinitionSchema>` for
  the typed `definition` param.
- Files modified: `services/xstockstrat-ui/src/hooks/useStrategyDefinitions.ts`
- Deviations: none.

### Step 3 — Insights signal-sources browser client + hook [done]
- Created `src/lib/browserClients/insightsIngestClient.ts` (IngestService client at `/insights/api`,
  mirroring `traderAnalysisClient`) and `src/hooks/useInsightsSignalSources.ts` (useQuery keyed
  `['insights-signal-sources']`, `includeInactive: false`, returns `sources`).
- Files modified: `services/xstockstrat-ui/src/lib/browserClients/insightsIngestClient.ts`,
  `services/xstockstrat-ui/src/hooks/useInsightsSignalSources.ts`
- Deviations: none.

### Step 4 — Dual-mode RuleEditor [done]
- Created `src/components/insights/RuleEditor.tsx` — controlled `{ value, onChange, label }`. Visual
  builder edits a `{ op: and|or, conditions: [{lhs, cmp, rhs}] }` tree; JSON mode is a raw textarea.
  Both modes serialize to the identical string (AC-9). Switching JSON→visual parses best-effort; an
  unparseable/foreign-shape JSON keeps JSON mode and shows an inline parse error.
- Files modified: `services/xstockstrat-ui/src/components/insights/RuleEditor.tsx`
- Deviations: none.

### Step 5 — ComponentEditor [done]
- Created `src/components/insights/ComponentEditor.tsx` — controlled `{ value, onChange, onRemove }`
  editing one component (refName, kind Select, indicator free-text or searchable formula picker via
  `useFormulas` filtered by name/id substring per AC-7, and a key-value params editor). Exports
  `StrategyComponentDraft` + `emptyComponent()` for the wizard.
- Files modified: `services/xstockstrat-ui/src/components/insights/ComponentEditor.tsx`
- Deviations: none.

### Step 6 — StrategyWizard scaffold [done]
- Created `src/components/insights/StrategyWizard.tsx` — 5-step wizard with step indicator, free
  Back/Next, no submit until Step 5. Gates: Step 1 requires valid `strategy_id` (`^[a-z0-9_]+$`) +
  display name; Step 2 requires ≥1 component; Step 3 requires both rules non-empty; Step 4 skippable.
  `strategy_id` is read-only in edit mode. Submit calls `useManageStrategy` (REGISTER/UPDATE); server
  errors render inline with a heuristic "Go to Step N" link (rule→3, indicator/ref→2, id/display→1).
  Signal params assembled into the Struct as `signal_sources`/`signal_weight`/`technical_weight`/
  `min_conviction`; sources selected by `slug`.
- Files modified: `services/xstockstrat-ui/src/components/insights/StrategyWizard.tsx`
- Deviations: none. (SignalSource keyed by `slug`/`displayName`, not a `sourceId` — confirmed in
  generated stubs.)

### Step 7 — New-strategy wizard page [done]
- Created `src/app/insights/strategies/new/page.tsx` — AppShell + `<StrategyWizard mode="create">`,
  admin-gated via `useIsAdmin()` (non-admins see an access notice; BFF gate is authoritative).
- Files modified: `services/xstockstrat-ui/src/app/insights/strategies/new/page.tsx`
- Deviations: none.

### Step 8 — Edit-strategy page [done]
- Created `src/app/insights/strategies/[id]/edit/page.tsx` — `use(params)`, fetches via
  `useGetStrategy(id)` (GetStrategy returns a StrategyDefinition directly), renders
  `<StrategyWizard mode="edit" initial={data}>` (strategy_id read-only). Admin-gated + loading state.
- Files modified: `services/xstockstrat-ui/src/app/insights/strategies/[id]/edit/page.tsx`
- Deviations: none.

### Step 9 — List actions + detail live toggle [done]
- `strategies/page.tsx`: admin-only "New Strategy" button; per-card Edit (router.push to edit page) +
  Deactivate (window.confirm → `useManageStrategy` DEACTIVATE). Merges `useStrategyDefinitions(true)`
  by id to show an `inactive` badge and hide Deactivate on already-inactive strategies. Admin actions
  rendered as siblings outside the `<Link>` to avoid nested anchors.
- `strategies/[id]/page.tsx`: added a "Live Evaluation" card (state from `useGetStrategy(id)`) with an
  admin-only toggle via `useSetStrategyLiveInsights`; inline "admin scope required" on error.
- Files modified: `services/xstockstrat-ui/src/app/insights/strategies/page.tsx`,
  `services/xstockstrat-ui/src/app/insights/strategies/[id]/page.tsx`
- Deviations: none. Used `window.confirm` for the deactivate confirmation (spec sanctioned it — no
  AlertDialog primitive exists).

### Step 11 — Documentation [done]
- No `services/xstockstrat-ui/CLAUDE.md` exists, and this is a UI-only feature (no Dockerfile/proto/
  migration/config changes), so the only doc artifact is this `context.md` (kept current per step).
- **Feature summary** (what shipped):
  - **Insights BFF** (`src/lib/insightsBff.ts`): proxies `ManageStrategy` (admin-gated on
    register/update/deactivate), `GetStrategy`, `ListStrategyDefinitions`, `SetStrategyLive`
    (admin-gated), and `IngestService.ListSignalSources`; plus a `dispatchConnect` error-passthrough
    fix so downstream gRPC validation messages reach the browser.
  - **Hooks**: `useStrategyDefinitions` (`useStrategyDefinitions`/`useGetStrategy`/`useManageStrategy`/
    `useSetStrategyLiveInsights`), `useInsightsSignalSources` + `insightsIngestClient`.
  - **Components**: `RuleEditor` (dual-mode visual/JSON), `ComponentEditor` (kind + formula picker +
    params), `StrategyWizard` (5-step create/edit wizard).
  - **Pages**: `/insights/strategies/new`, `/insights/strategies/[id]/edit`; modified
    `/insights/strategies` (New/Edit/Deactivate, admin-gated) and `/insights/strategies/[id]` (live
    toggle).
  - **Tests**: `e2e/insights/strategy-authoring.spec.ts` (10 tests, green on chromium + firefox).
- Files modified: `docs/roadmap/features/050-strategy-creation-flow/context.md`
- Deviations: none.

### Step 10 — Playwright E2E + lint/build gate [done]
- Created `e2e/insights/strategy-authoring.spec.ts` (10 tests: BFF admin-gate/proxy + UI wizard
  gating, AC-13 inline error, edit read-only id, formula-picker filter). Extended `e2e/mock-backend.ts`
  (insights 9092 segment) with `manageStrategy` (errors on sentinel `invalid_ref`) + `getStrategy`.
  Signal sources already mocked on 9093 (insights BFF `ingestClient` dials `INGEST_ENDPOINT`);
  `ListFormulas` stubbed at browser level via `page.route` (IndicatorsService not on 9092), matching
  `formulas.spec.ts`.
- **Verification (full)**: `pnpm run lint` ✓; `pnpm run build` ✓; `pnpm exec playwright test
  insights/strategy-authoring.spec.ts` → 10/10 passed on **chromium** AND **firefox**.
- **Deviation (user-approved, Option A)**: also fixed `src/lib/insightsBff.ts` `dispatchConnect` so
  downstream gRPC error messages survive to the browser (was surfacing as generic "HTTP 400" due to a
  leaked `application/grpc+proto` content-type). See Deviation Log. This is why AC-13 now shows the
  real validation message ("…ref_name…") and routes "Go to Step 2".
- Files modified: `services/xstockstrat-ui/e2e/insights/strategy-authoring.spec.ts`,
  `services/xstockstrat-ui/e2e/mock-backend.ts`, `services/xstockstrat-ui/src/lib/insightsBff.ts`

## Session 2026-06-06T00:05:00Z — sdd-spec

- Generated implementation-spec.md with 11 steps. Status → implementation-ready.
- Key codebase findings:
  - **Insights BFF gap**: `services/xstockstrat-ui/src/lib/insightsBff.ts:34-54` proxies only 4 AnalysisService methods (listStrategies, scoreStrategy, runBacktest, getStrategyReport). The 4 RPCs this feature needs (manageStrategy, getStrategy, listStrategyDefinitions, setStrategyLive) are NOT proxied there yet — Step 1 adds them. The trader BFF (`traderBff.ts:115-129`) already proxies listStrategyDefinitions + setStrategyLive with an admin-scope gate (ADMIN_BIT = 0x04 / PermissionDenied) — reused verbatim.
  - **Generated stubs already present**: all new analysis types (ManageStrategyRequest, GetStrategyRequest, ListStrategyDefinitionsRequest/Response, SetStrategyLiveRequest/Response, StrategyDefinition, StrategyOperation, ComponentKind) exist in `packages/proto/gen/ts/analysis/v1/analysis_pb.ts`. No proto/proto-gen step needed.
  - **ListFormulas already proxied** by insights BFF (`insightsBff.ts:90-93`) and `useFormulas` hook exists — formula picker (FR-6) needs no BFF change.
  - **Signal sources**: `ingestClient` browser client points at `/config-ui/api` (`browserClients/ingestClient.ts:5`); insights pages call `/insights/api`. Step 3 adds a new `/insights/api`-scoped ingest client + the insights BFF proxies `IngestService.listSignalSources` (pattern from `configUiBff.ts:45-49`).
  - **Admin gating**: `useIsAdmin()` (`hooks/useLiveStrategies.ts:42-53`) hits the existing `/api/auth/me` route (`app/api/auth/me/route.ts`) returning `{ isAdmin }`. Reused for client-side render gating; BFF admin-scope gate is authoritative (defense-in-depth).
  - **No `services/xstockstrat-ui/CLAUDE.md`** exists — only the feature context.md is the doc artifact (Step 11).
  - **Next.js service** — no unit coverage threshold; verification is `pnpm run lint` + `pnpm run build` + `pnpm test:e2e` (new `e2e/insights/strategy-authoring.spec.ts`), reusing `e2e/mock-backend.ts` + `e2e/helpers/auth.ts` and the `e2e/trader/live-strategies.spec.ts` gating pattern.
  - All step reviewers resolve to `xstockstrat-ui` owner (UI-only; analysis/indicators are read-only consumers).

## Session 2026-06-06T00:00:00Z — sdd-story

- Created feature.md (status: draft), product-spec.md, context.md from user story.
- Scope: UI-only — no proto changes, no DB migrations, no new config keys.
- All required backend RPCs already exist (ManageStrategy, GetStrategy, ListStrategyDefinitions, SetStrategyLive, ListFormulas).
- Affected service: xstockstrat-ui (new pages + BFF routes); xstockstrat-analysis and xstockstrat-indicators read-only consumers, no code changes needed there.

## Session 2026-06-06T00:03:00Z — sdd-review product-spec

- Product spec approved. Status: draft → spec-ready.
- Warnings (advisory, no blockers):
  - Feature 003-formula-management-ui also modifies xstockstrat-ui and xstockstrat-indicators; 050 depends on ListFormulas RPC from 003.
  - Feature 047-strategy-engine also modifies xstockstrat-analysis; 050 consumes ManageStrategy, GetStrategy, ListStrategyDefinitions, SetStrategyLive RPCs from 047.
  - Feature 048-live-strategy-alert-engine also modifies xstockstrat-ui and xstockstrat-analysis; 050 depends on SetStrategyLive + live_enabled column from 048.
- Merge order added to merge-order.md: 003 → 047 → 048 → 050. All three blocking features confirmed launched by user; entries marked Resolved=Yes. No merge sequencing constraint remains.

## Session 2026-06-06T00:02:00Z — wizard UX requirement added

FR-2 changed from a single form to a 5-step wizard (/insights/strategies/new):
- Step 1: Identity (strategy_id, display_name)
- Step 2: Components (at least one required to advance)
- Step 3: Rules (dual-mode editor; both rules required to advance)
- Step 4: Signal Params (skippable)
- Step 5: Review & Submit (server errors shown inline with step link)
No-submit-until-final-step constraint. Back/Next navigation preserves state.
ACs 11–13 added to cover wizard-specific gate logic.

## Session 2026-06-06T00:01:00Z — open question resolution

Decisions recorded in product-spec.md §Decisions and reflected in FR-2 and acceptance criteria:
- Rule editor: dual-mode (visual tree builder + raw JSON fallback toggle).
- strategy_id: immutable after creation; rendered read-only on edit form.
- Component count: no client-side limit; backend validation only.
