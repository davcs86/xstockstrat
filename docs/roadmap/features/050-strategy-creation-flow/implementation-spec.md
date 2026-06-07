# Implementation Spec: strategy-creation-flow

**Status**: `in-progress`
**Created**: 2026-06-06
**Feature**: `docs/roadmap/features/050-strategy-creation-flow/feature.md`
**Total Steps**: 11
**Feature Branch**: `feature/strategy-creation-flow`

---

## Execution Summary

This is a UI-only feature in `xstockstrat-ui` (Next.js). No proto, migration, or config-key
changes are required — all backend RPCs (`ManageStrategy`, `GetStrategy`,
`ListStrategyDefinitions`, `SetStrategyLive`, `ListFormulas`, `ListSignalSources`) already
exist in the generated stubs and backend services. The work is: (1) wire the four
strategy-authoring RPCs plus `ListSignalSources` through the **insights BFF** (they are not
yet proxied there); (2) add browser clients/hooks; (3) build the wizard, edit form, list
actions, deactivate dialog, and live toggle as React components/pages under
`src/app/insights/strategies/`; (4) add Playwright E2E coverage. Steps are ordered so BFF +
client plumbing (Steps 1–3) land before any page consumes them, and the wizard sub-components
(Steps 4–6) land before the pages that compose them (Steps 7–9).

## Step Dependencies

- Step 2 (hooks) requires Step 1 (BFF proxy methods) — the hooks call RPCs that only resolve once the insights BFF router proxies them.
- Step 3 (signal-sources client) requires Step 1 (insights BFF must proxy `IngestService.listSignalSources`).
- Steps 4, 5, 6 (rule editor, component editor, wizard scaffold) require Step 2 (mutation/query hooks).
- Step 6 (signal-params step) requires Step 3 (signal sources hook).
- Step 7 (new wizard page) requires Steps 4, 5, 6.
- Step 8 (edit page) requires Step 2 (`useGetStrategy`, `useManageStrategy`) and Steps 4–5.
- Step 9 (list actions + detail live toggle) requires Step 2 (`useManageStrategy`, `useSetStrategyLive`, `useStrategyDefinitions`).
- Step 10 [test] covers Steps 1–9 (the only non-frontend logic — the BFF router — has no coverage threshold; verification is via Playwright E2E + `pnpm run lint` + `next build`).
- Step 11 [docs] is independent; can land last.

---

### Step 1 — service: Proxy strategy-authoring RPCs and ListSignalSources through the insights BFF

**Status**: `done`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/src/lib/insightsBff.ts` — modify
- `services/xstockstrat-ui/src/lib/connectClients.ts` — modify (only if `ingestClient` is not already exported there — verify; see Codebase Evidence)

**Reviewers**: `xstockstrat-ui` owner — Connect-RPC call safety, environment scope correctness, no secret values rendered in UI

**Codebase Evidence**:
- The insights BFF router currently proxies only 4 `AnalysisService` methods — confirmed via Read `services/xstockstrat-ui/src/lib/insightsBff.ts:34-54` (`listStrategies`, `scoreStrategy`, `runBacktest`, `getStrategyReport`). The four new RPCs (`manageStrategy`, `getStrategy`, `listStrategyDefinitions`, `setStrategyLive`) are **absent** from this file.
- The trader BFF already proxies `listStrategyDefinitions` + `setStrategyLive` with an admin-scope gate — confirmed via Read `services/xstockstrat-ui/src/lib/traderBff.ts:115-129`. Reuse that exact gate pattern: `const ADMIN_BIT = 0x04; if ((rolesToAccessScope(claims.roles) & ADMIN_BIT) === 0) throw new ConnectError('Admin scope required', Code.PermissionDenied);`
- The config-ui BFF proxies `IngestService.listSignalSources` — confirmed via grep `services/xstockstrat-ui/src/lib/configUiBff.ts:45-49`. Reuse the same `router.service(IngestService, { async listSignalSources(...) })` shape.
- All BFF handlers call `requireSession(ctx)` then forward `backendHeaders(claims, ctx)` which sets `x-user-id`, `x-access-scope`, `x-trace-id` — confirmed `insightsBff.ts:24-30` and `:34-41`. New handlers MUST follow this same pattern (header propagation).
- Generated TS stubs include `ManageStrategyRequest`, `GetStrategyRequest`, `ListStrategyDefinitionsRequest/Response`, `SetStrategyLiveRequest/Response`, `StrategyDefinition`, `StrategyOperation`, `ComponentKind` — confirmed via grep on `packages/proto/gen/ts/analysis/v1/analysis_pb.ts` (lines 384, 440, 462, 479, 506, 528, 550, 567).
- `connectClients.ts` already imports `analysisClient` (used by `insightsBff.ts:8`). Verify whether it also exports an `ingestClient` (Node-side) — confirm via `grep -n "ingestClient\|IngestService" services/xstockstrat-ui/src/lib/connectClients.ts`. The config-ui BFF imports `ingestClient` from `@/lib/connectClients` per `configUiBff.ts` — confirm the same import resolves; if it does, no change to `connectClients.ts` is needed.

**Instructions**:
1. In `insightsBff.ts`, extend the existing `router.service(AnalysisService, { … })` block (currently ending at `:54`) with four new methods:
   - `manageStrategy(req, ctx)` — `requireSession`, forward `analysisClient.manageStrategy(req, { headers: backendHeaders(claims, ctx) })`. For `operation === STRATEGY_OPERATION_REGISTER | UPDATE | DEACTIVATE`, add the admin-scope gate (mutations are admin-only per FR-8) using the `ADMIN_BIT` pattern from `traderBff.ts:122-126`.
   - `getStrategy(req, ctx)` — `requireSession`, forward `analysisClient.getStrategy(req, { headers: … })`. No admin gate (read).
   - `listStrategyDefinitions(req, ctx)` — `requireSession`, forward `analysisClient.listStrategyDefinitions(req, { headers: … })`. No admin gate (read).
   - `setStrategyLive(req, ctx)` — `requireSession`, **admin-scope gate**, then forward `analysisClient.setStrategyLive(req, { headers: … })` — copy verbatim from `traderBff.ts:120-128`.
2. Add `import { IngestService } from '@xstockstrat/proto/ingest/v1/ingest_pb';` and add `ingestClient` to the `@/lib/connectClients` import line in `insightsBff.ts`. Add a new `router.service(IngestService, { async listSignalSources(req, ctx) { const claims = await requireSession(ctx); return ingestClient.listSignalSources(req, { headers: backendHeaders(claims, ctx) }); } });` block — copy from `configUiBff.ts:45-49`.
3. Do not change the `PREFIX = '/insights/api'` handler-map logic at `insightsBff.ts:125-126`; new handlers are auto-registered via `router.handlers`.

**Verification**:
- `grep -n "manageStrategy\|getStrategy\|listStrategyDefinitions\|setStrategyLive\|listSignalSources" services/xstockstrat-ui/src/lib/insightsBff.ts` — all five present.
- `grep -n "ADMIN_BIT\|PermissionDenied" services/xstockstrat-ui/src/lib/insightsBff.ts` — confirm admin gate present on `setStrategyLive` and on the mutating `manageStrategy` operations.
- `grep -n "backendHeaders" services/xstockstrat-ui/src/lib/insightsBff.ts` — confirm every new handler forwards headers (`x-user-id`/`x-access-scope`/`x-trace-id`).
- Lint + build verified in Step 10.

---

### Step 2 — service: Add strategy-definition browser hooks (manage / get / list / setLive)

**Status**: `done`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/src/hooks/useStrategyDefinitions.ts` — create

**Reviewers**: `xstockstrat-ui` owner — Connect-RPC call safety, environment scope correctness

**Codebase Evidence**:
- Browser `analysisClient` is `createClient(AnalysisService, transport)` with `baseUrl: '/insights/api'` — confirmed Read `services/xstockstrat-ui/src/lib/browserClients/analysisClient.ts:5-6`. Once Step 1 proxies the methods, `analysisClient.manageStrategy(...)`, `.getStrategy(...)`, `.listStrategyDefinitions(...)`, `.setStrategyLive(...)` are all callable through `/insights/api`.
- Existing hook pattern (TanStack Query `useQuery`/`useMutation`, `analysisClient`) — confirmed Read `services/xstockstrat-ui/src/hooks/useStrategies.ts:1-29` and the live-toggle mutation pattern in `services/xstockstrat-ui/src/hooks/useLiveStrategies.ts:13-20` (`useSetStrategyLive` with `queryClient.invalidateQueries`).
- `StrategyOperation` enum values: `STRATEGY_OPERATION_REGISTER = 1`, `STRATEGY_OPERATION_UPDATE = 2`, `STRATEGY_OPERATION_DEACTIVATE = 3` — confirmed `packages/proto/analysis/v1/analysis.proto:117-122`.
- `StrategyDefinition` shape: `strategy_id`, `display_name`, `components[]`, `entry_rule`, `exit_rule`, `signal_params` (Struct), `active`, `live_enabled` — confirmed `analysis.proto:106-115`.

**Instructions**:
1. Create `useStrategyDefinitions.ts` exporting:
   - `useStrategyDefinitions(includeInactive = false)` — `useQuery` keyed `['analysis-strategy-definitions', includeInactive]`, calls `analysisClient.listStrategyDefinitions({ includeInactive })`. Mirror `useStrategies.ts:12-17`.
   - `useGetStrategy(strategyId?: string)` — `useQuery` keyed `['analysis-strategy-def', strategyId]`, `enabled: !!strategyId`, calls `analysisClient.getStrategy({ strategyId: strategyId! })`. Mirror `useStrategies.ts:19-29`.
   - `useManageStrategy()` — `useMutation` whose `mutationFn` accepts `{ operation, definition }` and calls `analysisClient.manageStrategy({ operation, definition })`; `onSuccess` invalidates `['analysis-strategy-definitions']`, `['analysis-strategies']`, and `['analysis-strategy-def']`. Mirror `useLiveStrategies.ts:13-20` mutation structure.
   - `useSetStrategyLiveInsights()` — `useMutation` calling `analysisClient.setStrategyLive({ strategyId, liveEnabled })`, invalidating `['analysis-strategy-definitions']` and `['analysis-strategy-def', strategyId]` on success. (Distinct hook name from the trader `useSetStrategyLive` in `useLiveStrategies.ts` to avoid collision; this one routes through `/insights/api`.)
2. Import types from `@xstockstrat/proto/analysis/v1/analysis_pb` (`StrategyOperation`, `StrategyDefinition`, `ComponentKind`).

**Verification**:
- `grep -n "useStrategyDefinitions\|useGetStrategy\|useManageStrategy\|useSetStrategyLiveInsights" services/xstockstrat-ui/src/hooks/useStrategyDefinitions.ts` — all four exported.
- Type-check passes in Step 10 build.

---

### Step 3 — service: Add insights signal-sources browser client + hook

**Status**: `done`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/src/lib/browserClients/insightsIngestClient.ts` — create
- `services/xstockstrat-ui/src/hooks/useInsightsSignalSources.ts` — create

**Reviewers**: `xstockstrat-ui` owner — Connect-RPC call safety, environment scope correctness

**Codebase Evidence**:
- The existing `ingestClient` browser client points at `baseUrl: '/config-ui/api'` — confirmed Read `services/xstockstrat-ui/src/lib/browserClients/ingestClient.ts:5`. The insights pages live under `/insights/...` and call `/insights/api`, so a separate client pointed at `/insights/api` is required (matching the `traderAnalysisClient` precedent at `services/xstockstrat-ui/src/lib/browserClients/traderAnalysisClient.ts:5-7`, which creates a second `AnalysisService` client pointed at `/trader/api`).
- `useSignalSources` (config-ui) calls `ingestClient.listSignalSources({ includeInactive: true })` — confirmed Read `services/xstockstrat-ui/src/app/config-ui/hooks/useSignalSources.ts:16`. `SignalSource` type imported from `@xstockstrat/proto/ingest/v1/ingest_pb`.

**Instructions**:
1. Create `insightsIngestClient.ts`: `createClient(IngestService, createConnectTransport({ baseUrl: '/insights/api' }))` — copy `traderAnalysisClient.ts` shape, swapping `AnalysisService`→`IngestService` and import from `@xstockstrat/proto/ingest/v1/ingest_pb`.
2. Create `useInsightsSignalSources.ts`: `useQuery` keyed `['insights-signal-sources']`, calls `insightsIngestClient.listSignalSources({ includeInactive: false })`, returns `data.sources ?? []`. (Only live/active sources per FR-2 Step 4 "multi-select from live source list" — pass `includeInactive: false`.)

**Verification**:
- `grep -n "baseUrl: '/insights/api'" services/xstockstrat-ui/src/lib/browserClients/insightsIngestClient.ts` — confirms correct segment.
- `grep -n "listSignalSources" services/xstockstrat-ui/src/hooks/useInsightsSignalSources.ts` — present.

---

### Step 4 — service: Build the dual-mode rule editor component

**Status**: `done`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/src/components/insights/RuleEditor.tsx` — create

**Reviewers**: `xstockstrat-ui` owner — analytics display accuracy, Connect-RPC call safety

**Codebase Evidence**:
- `entry_rule` / `exit_rule` are `string` fields holding "JSON-encoded condition tree" — confirmed `packages/proto/analysis/v1/analysis.proto:110-111`.
- No existing rule-editor component — confirmed via `find services/xstockstrat-ui/src -path "*strateg*" -o -path "*formula*"` (only strategy/formula pages, no RuleEditor). **Not found** — this must be created from scratch; the dual-mode toggle has no existing pattern. The closest reference for a controlled-value editor with a toggle is `FormulaEditor` (`src/components/insights/FormulaEditor.tsx`) and the checkbox/textarea idioms in `src/app/insights/formulas/new/page.tsx:54-71`.
- UI primitives available: `Button`, `Input`, `Card` under `src/components/ui/` — confirmed via the file inventory; `cn` helper at `src/components/ui/utils.ts` (used in `strategies/[id]/page.tsx:8`).

**Instructions**:
1. Create `RuleEditor.tsx` (`'use client'`) — controlled component `props: { value: string; onChange: (json: string) => void; label: string }`.
2. Internal `mode` state: `'visual' | 'json'`, defaulting to `'visual'`. Render a toggle (two `Button`s or a segmented control) per AC-9.
3. **Visual mode**: a minimal condition-tree builder — rows of `{ left, operator, right }` combined under an AND/OR root; serialize to the JSON string via `onChange`. Keep the schema simple and documented inline (e.g. `{ "op": "and", "conditions": [{ "lhs": "...", "cmp": ">", "rhs": "..." }] }`). On mode switch to JSON, emit the serialized tree; on switch back from JSON, parse and repopulate (best-effort; if JSON is unparseable, keep JSON mode and show an inline parse error).
4. **JSON mode**: a `textarea` bound to `value`; `onChange` passes raw text up. Both modes write the **same** `entry_rule`/`exit_rule` string (AC-9).
5. Do not call any backend — purely a controlled input. Validation of rule semantics is the server's job (FR-7).

**Verification**:
- `grep -n "mode\|visual\|json\|textarea\|onChange" services/xstockstrat-ui/src/components/insights/RuleEditor.tsx` — confirms both modes present.
- Behavioral check covered by Step 10 E2E (toggle JSON ↔ visual produces identical output string).

---

### Step 5 — service: Build the component editor (ref_name / kind / indicator|formula picker / params)

**Status**: `done`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/src/components/insights/ComponentEditor.tsx` — create

**Reviewers**: `xstockstrat-ui` owner — analytics display accuracy, Connect-RPC call safety

**Codebase Evidence**:
- `StrategyComponent` shape: `ref_name`, `kind` (`ComponentKind`), `indicator` (when BUILTIN), `formula_id` (when CUSTOM_FORMULA), `params` (`map<string,double>`) — confirmed `packages/proto/analysis/v1/analysis.proto:98-104`.
- `ComponentKind` enum: `COMPONENT_KIND_UNSPECIFIED=0`, `COMPONENT_KIND_BUILTIN_INDICATOR=1`, `COMPONENT_KIND_CUSTOM_FORMULA=2` — confirmed `analysis.proto:92-96`.
- Formula picker source: `useFormulas({ includePublic: true, pageSize: 50 })` returns `data.formulas[]` with `formulaId`, `name` — confirmed Read `services/xstockstrat-ui/src/hooks/useFormulas.ts:9-20` and the list shape in `services/xstockstrat-ui/src/app/insights/formulas/page.tsx:42-47`. `ListFormulas` is already proxied by the insights BFF — confirmed `insightsBff.ts:90-93`. No BFF change needed for the formula picker.
- Builtin indicator names source: `IndicatorsService.ListIndicators` is proxied by the insights BFF — confirmed `insightsBff.ts:117-120`. (Optional: use it to populate the BUILTIN indicator dropdown; otherwise a free-text `Input` is acceptable since the backend validates unknown indicators per FR-7.)
- `Select` primitive exists at `src/components/ui/select.tsx` — confirmed file inventory.

**Instructions**:
1. Create `ComponentEditor.tsx` (`'use client'`) — controlled component editing a single `StrategyComponent`: `props: { value: StrategyComponent; onChange: (c) => void; onRemove: () => void }`.
2. Fields: `ref_name` (`Input`), `kind` (`Select` with the two valid `ComponentKind` options), then conditionally:
   - kind = BUILTIN_INDICATOR → `indicator` field (free-text `Input`, or a `Select` populated from `ListIndicators`).
   - kind = CUSTOM_FORMULA → searchable `formula_id` dropdown backed by `useFormulas`; filter the returned `formulas[]` by substring on `name`/`formulaId` as the operator types (FR-6, AC-7). Store the selected `formula.formulaId`.
3. `params` key-value editor: rows of `{ key: string, value: number }`; serialize to `map<string,double>`. Allow add/remove rows.
4. Remove button calls `onRemove`.

**Verification**:
- `grep -n "ref_name\|refName\|ComponentKind\|useFormulas\|formulaId\|params" services/xstockstrat-ui/src/components/insights/ComponentEditor.tsx` — confirms fields + formula picker present.
- Substring filter + happy path covered by Step 10 E2E.

---

### Step 6 — service: Build the wizard scaffold + per-step components (Identity / Components / Rules / Signal Params / Review)

**Status**: `done`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/src/components/insights/StrategyWizard.tsx` — create

**Reviewers**: `xstockstrat-ui` owner — analytics display accuracy, Connect-RPC call safety, environment scope correctness

**Codebase Evidence**:
- 5-step wizard with linear progress, free Back/Next, no submit until Step 5 — required by FR-2 and ACs 1, 11, 12, 13.
- Server validation errors must surface inline with a "Go to Step N" link on the Review step — FR-7, AC-13. `ConnectError.rawMessage` extraction pattern confirmed at `services/xstockstrat-ui/src/app/insights/formulas/new/page.tsx:21-24` and `strategies/[id]/page.tsx:33-35`.
- Signal sources for Step 4 come from `useInsightsSignalSources` (Step 3). `signal_params` is a `google.protobuf.Struct` field — confirmed `analysis.proto:112`; build it as a plain JS object (the `_pb` Struct field accepts a JSON-like object via the generated client).
- Submit path: `useManageStrategy()` (Step 2) with `operation = STRATEGY_OPERATION_REGISTER` and the assembled `StrategyDefinition`.

**Instructions**:
1. Create `StrategyWizard.tsx` (`'use client'`) — props: `{ mode: 'create' | 'edit'; initial?: StrategyDefinition; onSubmitDone?: (id: string) => void }`. Holds the full draft `StrategyDefinition` in state, plus `step` (1–5) state.
2. **Step indicator** at top showing current/completed steps (FR-2).
3. **Step 1 Identity**: `strategy_id` (`Input`, client-validated `^[a-z0-9_]+$`; disabled/read-only when `mode === 'edit'` per AC-8/Decision 2) and `display_name` (`Input`).
4. **Step 2 Components**: render a list of `ComponentEditor` (Step 5) with an "Add component" button (no client limit — Decision 3 / AC-10). "Next" disabled until ≥1 component (AC-11).
5. **Step 3 Rules**: two `RuleEditor` (Step 4) instances for `entry_rule` and `exit_rule`. "Next" disabled until both non-empty (AC-11).
6. **Step 4 Signal Params** (skippable, AC-12): multi-select of `signal_sources` from `useInsightsSignalSources`, plus numeric inputs `signal_weight`, `technical_weight`, `min_conviction`. Provide a "Skip" button that advances to Step 5. Assemble these into the `signal_params` Struct.
7. **Step 5 Review & Submit**: read-only summary of all fields (AC-13). "Create Strategy" (create mode) / "Save Changes" (edit mode) calls `useManageStrategy().mutate({ operation, definition })`. On error, extract `ConnectError.rawMessage` and render inline; if the message identifies a field/ref, show a "Go to Step N" link that sets `step` accordingly (AC-13). On success, call `onSubmitDone(definition.strategyId)`.
8. Back/Next must preserve all entered state (single state object held at wizard root).

**Verification**:
- `grep -n "step\|RuleEditor\|ComponentEditor\|useManageStrategy\|useInsightsSignalSources\|Skip\|rawMessage" services/xstockstrat-ui/src/components/insights/StrategyWizard.tsx` — confirms wiring.
- Full wizard flow covered by Step 10 E2E (ACs 1, 11, 12, 13).

---

### Step 7 — service: New-strategy wizard page

**Status**: `done`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/src/app/insights/strategies/new/page.tsx` — create

**Reviewers**: `xstockstrat-ui` owner — Connect-RPC call safety, environment scope correctness, no secret values rendered in UI

**Codebase Evidence**:
- Page conventions: `'use client'`, wrapped in `<AppShell>`, `useRouter().push` on success — confirmed Read `services/xstockstrat-ui/src/app/insights/formulas/new/page.tsx:1-34` and `:79`.
- Admin gating signal: `useIsAdmin()` (TanStack hook hitting `/api/auth/me`) — confirmed Read `services/xstockstrat-ui/src/hooks/useLiveStrategies.ts:42-53`; the `/api/auth/me` route exists and returns `{ isAdmin }` — confirmed Read `services/xstockstrat-ui/src/app/api/auth/me/route.ts:6-12`. Defense-in-depth: the BFF also enforces admin scope (Step 1).

**Instructions**:
1. Create `new/page.tsx` (`'use client'`): render `<AppShell>` + `<StrategyWizard mode="create" onSubmitDone={(id) => router.push('/insights/strategies/' + id)} />`.
2. Gate with `useIsAdmin()`: if not admin, render a "You need admin access" notice instead of the wizard (FR-8, AC-5). Server-side BFF gate (Step 1) is the authoritative enforcement.

**Verification**:
- `grep -n "StrategyWizard\|useIsAdmin\|AppShell\|mode=\"create\"" services/xstockstrat-ui/src/app/insights/strategies/new/page.tsx` — present.
- Route renders the wizard for admins; covered by Step 10 E2E.

---

### Step 8 — service: Edit-strategy page (pre-populated from GetStrategy)

**Status**: `done`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/src/app/insights/strategies/[id]/edit/page.tsx` — create

**Reviewers**: `xstockstrat-ui` owner — Connect-RPC call safety, environment scope correctness, no secret values rendered in UI

**Codebase Evidence**:
- Dynamic-route param access pattern `const { id } = use(params)` with `params: Promise<{ id: string }>` — confirmed Read `services/xstockstrat-ui/src/app/insights/strategies/[id]/page.tsx:21-22`.
- `useGetStrategy` + `useManageStrategy` from Step 2; `GetStrategy` returns a `StrategyDefinition` — confirmed `analysis.proto:17`. `strategy_id` is immutable on edit (AC-8, Decision 2).

**Instructions**:
1. Create `[id]/edit/page.tsx` (`'use client'`): `const { id } = use(params)`; fetch with `useGetStrategy(id)`.
2. While loading, show a spinner/placeholder (mirror `strategies/[id]/page.tsx:230-235`).
3. Once loaded, render `<StrategyWizard mode="edit" initial={data} onSubmitDone={() => router.push('/insights/strategies/' + id)} />`. The wizard's Step-1 `strategy_id` field is read-only in edit mode (Step 6 / AC-8). Submit uses `operation = STRATEGY_OPERATION_UPDATE`.
4. Gate with `useIsAdmin()` as in Step 7 (FR-8).

**Verification**:
- `grep -n "useGetStrategy\|StrategyWizard\|mode=\"edit\"\|use(params)" services/xstockstrat-ui/src/app/insights/strategies/[id]/edit/page.tsx` — present.
- Edit→submit→reflected-in-detail flow covered by Step 10 E2E (AC-2, AC-8).

---

### Step 9 — service: List actions (New/Edit/Deactivate) + detail-page live toggle

**Status**: `done`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/src/app/insights/strategies/page.tsx` — modify
- `services/xstockstrat-ui/src/app/insights/strategies/[id]/page.tsx` — modify

**Reviewers**: `xstockstrat-ui` owner — Connect-RPC call safety, environment scope correctness, no secret values rendered in UI

**Codebase Evidence**:
- The list page currently renders only score cards from `useStrategies()` (`ListStrategies`) — confirmed Read `services/xstockstrat-ui/src/app/insights/strategies/page.tsx:22-84`. There is no "New Strategy" button, no per-row Edit/Deactivate. The "New <X>" button + `router.push` idiom is in `formulas/page.tsx:31-34` (the `Plus` icon from `lucide-react`).
- The detail page (`strategies/[id]/page.tsx`) currently shows score + backtest runner only — confirmed Read `:61-251`. It has no `live_enabled` display or toggle.
- Confirmation-dialog primitive: `sheet.tsx` exists under `src/components/ui/`; there is no dedicated AlertDialog in the inventory — a simple `window.confirm` or a `Sheet`-based confirm is acceptable. **No existing confirm-dialog component** — choose the lightest existing primitive.
- Live-toggle button pattern (label, disabled-while-pending, stopPropagation) — confirmed Read `services/xstockstrat-ui/src/components/trader/LiveStrategiesPanel.tsx:62-79`.
- Mutations: `useManageStrategy` (deactivate via `STRATEGY_OPERATION_DEACTIVATE`) and `useSetStrategyLiveInsights` from Step 2; `useStrategyDefinitions` for the `live_enabled`/`active` state (the `ListStrategies` score list does not carry `live_enabled`; `ListStrategyDefinitions` does — confirmed `analysis.proto:106-115` vs `:64-69`).

**Instructions**:
1. **List page** (`strategies/page.tsx`):
   - Add a "New Strategy" button (top-right, mirroring `formulas/page.tsx:31-34`) linking to `/insights/strategies/new`. Render only when `useIsAdmin()` is true (FR-8, AC-5).
   - Add per-row "Edit" (link to `/insights/strategies/[id]/edit`) and "Deactivate" actions, admin-only. "Deactivate" opens a confirmation, then calls `useManageStrategy().mutate({ operation: STRATEGY_OPERATION_DEACTIVATE, definition: { strategyId } })` (FR-4, AC-3). After success, the strategy drops out of the active list (the query invalidation in Step 2 refetches).
   - To know each strategy's `active` state for the Deactivate affordance, you may additionally consume `useStrategyDefinitions()` and merge by `strategyId`, or keep the action unconditional and rely on backend behavior. Prefer merging so deactivated strategies can be visually distinguished.
2. **Detail page** (`strategies/[id]/page.tsx`):
   - Add a card showing current `live_enabled` (read via `useGetStrategy(id)` or `useStrategyDefinitions()` filtered by id) and an admin-only toggle calling `useSetStrategyLiveInsights().mutate({ strategyId: id, liveEnabled: !current })` (FR-5, AC-4). Reuse the button pattern from `LiveStrategiesPanel.tsx:62-79`.
   - On error from the toggle (e.g. non-admin hitting the BFF gate), show an inline "admin scope required" message (mirror `LiveStrategiesPanel.tsx:85-89`).

**Verification**:
- `grep -n "New Strategy\|/insights/strategies/new\|Deactivate\|STRATEGY_OPERATION_DEACTIVATE\|useIsAdmin" services/xstockstrat-ui/src/app/insights/strategies/page.tsx` — present.
- `grep -n "live_enabled\|liveEnabled\|useSetStrategyLiveInsights\|useGetStrategy" services/xstockstrat-ui/src/app/insights/strategies/[id]/page.tsx` — present.
- All flows covered by Step 10 E2E (ACs 3, 4, 5).

---

### Step 10 — test: Playwright E2E coverage for the strategy creation flow + lint/build gate

**Status**: `done`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/e2e/insights/strategy-authoring.spec.ts` — create
- `services/xstockstrat-ui/e2e/mock-backend.ts` — modify (add `AnalysisService.ManageStrategy/GetStrategy/ListStrategyDefinitions/SetStrategyLive` and `IngestService.ListSignalSources` mock responses if not already present)

**Reviewers**: `xstockstrat-ui` owner — Trading UI correctness, Connect-RPC call safety, environment scope correctness

**Codebase Evidence**:
- `xstockstrat-ui` is a Next.js service with **no unit-test coverage threshold** — per the SDD test-step table, frontends use `pnpm test:e2e` (Playwright). The only non-frontend logic added is the BFF router proxy methods (Step 1), which is a thin forwarding layer with no coverage threshold; E2E exercises it end-to-end.
- Existing Playwright specs + mock backend: confirmed via file inventory — `services/xstockstrat-ui/e2e/insights/formulas.spec.ts`, `e2e/trader/live-strategies.spec.ts`, `e2e/mock-backend.ts`, `e2e/helpers/auth.ts`. `live-strategies.spec.ts` already tests the trader-side `SetStrategyLive` toggle and the admin/non-admin gating — reuse its mock + auth-helper patterns.
- `package.json` scripts: `"lint": "next lint"`, `"test:e2e": "playwright test"`, `"build": "next build"` — confirmed `services/xstockstrat-ui/package.json:8,10,14`.

**Instructions**:
1. Create `strategy-authoring.spec.ts` covering: (a) admin sees "New Strategy"; read-only user does not (AC-5); (b) wizard Back/Next preserves data and does not submit until Step 5 (ACs 1, 11); (c) Step 2 Next disabled until ≥1 component, Step 3 Next disabled until both rules non-empty (AC-11); (d) Step 4 Skip advances to Step 5 (AC-12); (e) rule editor JSON↔visual toggle yields the same string (AC-9); (f) submit → ManageStrategy(register); server validation error shows inline + "Go to Step N" link (AC-13); (g) edit page pre-populates and `strategy_id` is read-only (ACs 2, 8); (h) deactivate confirmation → ManageStrategy(deactivate) (AC-3); (i) detail-page live toggle → SetStrategyLive and reflects persisted state (AC-4); (j) formula picker substring filter (AC-7).
2. Extend `mock-backend.ts` with mock handlers/responses for the new RPCs as needed, following the existing per-service mock structure.

**Verification**:
- `cd services/xstockstrat-ui && pnpm run lint` — passes (satisfies the §5c lint gate).
- `cd services/xstockstrat-ui && pnpm run build` — Next.js production build succeeds (type-check gate).
- `cd services/xstockstrat-ui && pnpm test:e2e` — the new `strategy-authoring.spec.ts` passes (no coverage threshold applies to this Next.js service; E2E is the coverage mechanism per the SDD test-step table).

---

### Step 11 — docs: Document the strategy authoring UI in the insights segment

**Status**: `pending`
**Service**: `docs/`
**Files**:
- `docs/roadmap/features/050-strategy-creation-flow/context.md` — modify (append implementation notes during execution)

**Reviewers**: none

**Codebase Evidence**:
- There is **no** `services/xstockstrat-ui/CLAUDE.md` — confirmed via `find services/xstockstrat-ui -name CLAUDE.md` (no result). So there is no per-service CLAUDE.md to update for this feature; the only documentation artifact is the feature's own `context.md` (append-only session log).
- This is a UI-only feature with no Dockerfile, proto, migration, or config changes, so the root CLAUDE.md Dockerfile/proto/config workflows do not apply.

**Instructions**:
1. During `/sdd-execute`, append a session entry to `context.md` summarizing the BFF methods added, the new components/pages, and any deviations.
2. No other documentation file requires changes (no service CLAUDE.md exists; no governance docs are affected by a UI-only change).

**Verification**:
- Manual: `context.md` contains a session entry describing the new files and the insights-BFF proxy additions.

---

## Deviation Log

### Deviation: Step 1 — connectClients.ts not modified
**Spec said**: `services/xstockstrat-ui/src/lib/connectClients.ts` — modify (only if `ingestClient` is not already exported there — verify; see Codebase Evidence)
**Actual**: Left unchanged. `ingestClient` is already exported at `connectClients.ts:36`.
**Reason**: The step itself made the edit conditional. Discovery confirmed the export already exists, so the conditional did not apply. `**Disposition**: planned-conditional, condition not met.`

### Deviation: Step 10 — BFF error-passthrough fix (insightsBff.ts)
**Spec said**: Step 10 Files = `e2e/insights/strategy-authoring.spec.ts` (create) + `e2e/mock-backend.ts` (modify).
**Actual**: Also modified `services/xstockstrat-ui/src/lib/insightsBff.ts` (the Step 1 file) to normalise the error-response `content-type` in `dispatchConnect`.
**Reason**: Writing the AC-13 E2E test surfaced that server validation errors reached the browser as a generic "HTTP 400" instead of the real message. Root cause (confirmed by a diagnostic E2E that dumped the raw BFF response): a `ConnectError` forwarded from the downstream gRPC service carries the gRPC response's `content-type` (`application/grpc+proto`) and `content-encoding` in its metadata; `createConnectRouter` copies those onto the error response, so the browser's Connect client cannot parse the (valid) JSON error body. Fix: on the error path (`status >= 400`), set `content-type: application/json` and drop `content-encoding`/`grpc-encoding`/`content-length`. The user explicitly chose this fix over accepting the limitation. Scope limited to the insights BFF. `**Disposition**: user-approved scope expansion (Option A).`
