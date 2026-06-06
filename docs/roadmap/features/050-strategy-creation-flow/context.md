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
