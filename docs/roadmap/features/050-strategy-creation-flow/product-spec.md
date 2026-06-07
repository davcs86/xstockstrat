# Product Spec: strategy-creation-flow

**Created**: 2026-06-06

---

## Problem Statement

Operators can already create and manage strategies via the MCP agent (`manage_strategy`, `manage_formula`, `set_strategy_live`), but the web UI only exposes listing and backtesting. Any operator who cannot run Claude must rely on a developer with MCP access to author strategies, creating a bottleneck and a gap in the product.

## User Story

As an operator using the Insights UI, I want to create, edit, deactivate, and enable live evaluation for strategies directly in the browser, so that I have full strategy authoring capability without requiring access to the MCP agent.

## Functional Requirements

FR-1. **Strategy list actions** — The `/insights/strategies` page must expose a "New Strategy" button and per-row "Edit" and "Deactivate" actions.

FR-2. **Strategy creation wizard** — `/insights/strategies/new` presents a **multi-step wizard** (one concept per step, linear progress, step indicator at the top) rather than a single long form. Operators can navigate Back/Next freely; no data is submitted until the final step. Steps:

  - **Step 1 — Identity**: `strategy_id` (lowercase/underscore, validated client-side; immutable after creation) and `display_name`.
  - **Step 2 — Components**: Add any number of components (no client-side limit), each with `ref_name`, kind (`BUILTIN_INDICATOR` or `CUSTOM_FORMULA`), indicator name or `formula_id` (searchable dropdown), and `params` (key-value editor). At least one component required to advance.
  - **Step 3 — Rules**: Define `entry_rule` and `exit_rule` using the **dual-mode rule editor** (visual condition-tree builder by default; raw JSON toggle for power users). Both rules required to advance.
  - **Step 4 — Signal Params** *(optional step)*: Configure `signal_sources` (multi-select from live source list), `signal_weight`, `technical_weight`, `min_conviction`. Operator may skip.
  - **Step 5 — Review & Submit**: Read-only summary of all fields. "Create Strategy" button calls `ManageStrategy(operation=register)` via the existing `analysisClient`. Validation errors returned by the server are shown inline on this step with a link back to the relevant step.

FR-3. **Strategy edit form** — `/insights/strategies/[id]/edit` pre-populates the form from `GetStrategy` and calls `ManageStrategy(operation=update)`.

FR-4. **Deactivate action** — Clicking "Deactivate" on a strategy shows a confirmation dialog, then calls `ManageStrategy(operation=deactivate)`.

FR-5. **Live evaluation toggle** — The strategy detail page (`/insights/strategies/[id]`) must display the current `live_enabled` state and expose a toggle that calls the existing `SetStrategyLive` RPC (`xstockstrat-analysis`).

FR-6. **Formula picker integration** — The component kind selector must let operators pick a `CUSTOM_FORMULA` from a searchable list backed by `ListFormulas` RPC (`xstockstrat-indicators`). The existing `/insights/formulas/new` flow remains the way to register new formulas.

FR-7. **Validation feedback** — All server-side validation errors returned by `ManageStrategy` (unknown indicator, missing ref, invalid JSON rule) must be surfaced as inline form field errors, not raw gRPC status messages.

FR-8. **Admin scope enforcement** — The "New Strategy", "Edit", "Deactivate", and live toggle controls must only render when the session's `x-access-scope` includes the admin bit (`0x04`); read-only users see no mutation controls.

## Out of Scope

- Visual formula code editor (already exists at `/insights/formulas/new`).
- Backtest triggering (already exists at `/insights/strategies/[id]`).
- Strategy scoring and signal ingestion (handled by separate services).
- Mobile-optimized layout.
- Bulk import / export of strategy definitions.

## Affected Services

Exact service names from CLAUDE.md Service Registry:
- `xstockstrat-ui` — new pages and API route handlers (BFF) for strategy authoring
- `xstockstrat-analysis` — already exposes `ManageStrategy`, `GetStrategy`, `ListStrategyDefinitions`, `SetStrategyLive` RPCs; no changes needed
- `xstockstrat-indicators` — already exposes `ListFormulas` RPC for the formula picker; no changes needed

## Proto Contract Changes

- [ ] No proto changes required

All required RPCs (`ManageStrategy`, `GetStrategy`, `ListStrategyDefinitions`, `SetStrategyLive`, `ListFormulas`) already exist in the generated stubs.

## Config Key Changes

- [ ] No new config keys

## Database Changes

- [ ] No schema changes

## Feature Workflow Notes

Branch to create: `feature/strategy-creation-flow` (branch from `main-dev`)
Approval gates required (per docs/runbooks/feature-workflow.md):
- [x] 1 service owner approval (UI-only change, no proto or migration)

## Acceptance Criteria

1. An admin operator can open `/insights/strategies/new` and is presented with a 5-step wizard; a step indicator shows current position and completed steps. The operator can navigate Back/Next freely without losing entered data. The strategy is not submitted until Step 5 "Create Strategy" is clicked.
2. An admin operator can open `/insights/strategies/[id]/edit`, change the `display_name` or add a component, submit, and see the updated values reflected in the detail view.
3. An admin operator can deactivate a strategy via the UI; the strategy no longer appears in the active list.
4. An admin operator can toggle `live_enabled` on/off from the strategy detail page; the toggle reflects the persisted state after re-load.
5. A read-only operator sees no "New Strategy", "Edit", "Deactivate", or live toggle controls.
6. Server-side validation errors (e.g., unknown indicator name, `ref_name` used in rule but not declared in components) are displayed as field-level error messages.
7. The formula picker in the component editor shows all formulas returned by `ListFormulas` and filters by substring as the operator types.
8. The `strategy_id` field is disabled (read-only) on the edit form; the operator cannot change it after creation.
9. The rule editor's "JSON" toggle switches between the visual tree builder and a raw JSON textarea; both modes produce the same `entry_rule`/`exit_rule` string sent to the backend.
10. Adding more than any given number of components (stress-test: 20+) works without UI error — only backend validation limits apply.
11. The "Next" button on Step 2 (Components) is disabled until at least one component is defined; "Next" on Step 3 (Rules) is disabled until both entry and exit rules are non-empty.
12. Step 4 (Signal Params) has a "Skip" option that advances to Step 5 without requiring any signal configuration.
13. Step 5 displays a read-only summary of all entered values; a server-side validation error on submit highlights the affected field and shows a "Go to Step N" link.

## Decisions

| # | Question | Decision |
|---|---|---|
| 1 | Raw JSON fallback in rule builder? | **Yes** — dual-mode editor: visual builder (default) + raw JSON toggle |
| 2 | `strategy_id` editable after creation? | **No** — locked after first save; rendered read-only on edit form |
| 3 | Client-side component count limit? | **No limit** — backend validation only |
