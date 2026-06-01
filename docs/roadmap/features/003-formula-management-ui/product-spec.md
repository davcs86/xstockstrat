# Product Spec: formula-management-ui

**Created**: 2026-05-10

---

## Problem Statement

Formulas registered with `xstockstrat-indicators` are held in-memory and are lost whenever the service restarts. Users have no durable way to store, retrieve, or manage their custom indicator formulas, and there is no UI to discover or edit them. This blocks iterative formula development and any multi-session or multi-user workflow.

## User Story

As a platform user, I want to create, view, edit, and delete my own indicator formulas through a management UI, so that my formulas survive service restarts, are private to me unless I mark them public, and are easily accessible to the strategy analysis workflows that depend on them.

## Functional Requirements

FR-1. Formulas must be persisted in TimescaleDB under the `indicators` schema and survive `xstockstrat-indicators` service restarts.
FR-2. Each formula must be scoped to an `author` (user identity string) set at creation time and immutable afterward.
FR-3. A formula is private by default (`is_public = false`); the owner may toggle it to public so all users can read (but not modify) it.
FR-4. The indicators service must expose `ListFormulas`, `UpdateFormula`, and `DeleteFormula` RPCs (in addition to the existing `RegisterFormula` and `GetFormula`).
FR-5. `UpdateFormula` must be rejected if the requesting `user_id` does not match the formula's `author`.
FR-6. `DeleteFormula` must be rejected if the requesting `user_id` does not match the formula's `author`.
FR-7. `ListFormulas` must support offset+limit pagination (`page_size` / `page_offset` in the request, `total_count` in the response).
FR-8. The `xstockstrat-insights` UI must provide a `/formulas` page listing the current user's formulas and all public formulas.
FR-9. The UI must support creating a new formula (name, description, source code with Monaco editor, is_public toggle).
FR-10. The UI must support editing an owned formula's name, description, source, and is_public flag.
FR-11. The UI must support deleting an owned formula with a confirmation step.
FR-12. The UI must support test-executing a formula inline (send JSON input, display output/stderr) on the formula detail page.
FR-13. All UI→backend calls must go through Next.js API route handlers (BFF) that call
`xstockstrat-indicators` via `@connectrpc/connect-node` gRPC transport on `INDICATORS_ENDPOINT`
(`host:port`, no HTTP 80xx port). After feature `044-client-api-pattern` lands, the client
layer uses typed `connect-query-es` + TanStack Query hooks; the BFF route handlers remain
server-side only. API route handlers read `user_id` from the `X-User-Id` request header; when
absent, a `'dev-user'` fallback is used in non-production environments.

## Out of Scope

- Full JWT integration — `author`/`user_id` is passed as a plain string in this phase; JWT-based identity enforcement is a follow-up feature.
- Formula versioning / history.
- Sharing or transferring formula ownership.
- Admin-level override of ownership checks.
- Formula import/export (file upload or download).

## Affected Services

Exact service names from CLAUDE.md Service Registry:
- `xstockstrat-indicators` — adds DB persistence, new CRUD RPCs, authorization checks
- `xstockstrat-insights` — adds formula management UI pages and API routes

_(Proto contract changes are tracked in the "Proto Contract Changes" section below — `packages/proto` is not a service and is not listed here.)_

## Proto Contract Changes

- New RPC `ListFormulas(ListFormulasRequest) returns (ListFormulasResponse)`
  - `ListFormulasRequest`: `string author_filter`, `bool include_public`, `int32 page_size`, `int32 page_offset`
  - `ListFormulasResponse`: `repeated FormulaDefinition formulas`, `int32 total_count`
- New RPC `UpdateFormula(UpdateFormulaRequest) returns (UpdateFormulaResponse)`
  - `UpdateFormulaRequest`: `string formula_id`, `string user_id`, `string name`, `string description`, `string source`, `bool is_public`
  - `UpdateFormulaResponse`: `FormulaDefinition formula`
- New RPC `DeleteFormula(DeleteFormulaRequest) returns (DeleteFormulaResponse)`
  - `DeleteFormulaRequest`: `string formula_id`, `string user_id`
  - `DeleteFormulaResponse`: `bool success`
- All changes are additive (new messages + new RPCs) — non-breaking per `buf breaking`.

## Config Key Changes

- [ ] No new config keys

## Database Changes

New table `indicators.formulas` in `xstockstrat-indicators`:

```sql
CREATE SCHEMA IF NOT EXISTS indicators;

CREATE TABLE indicators.formulas (
    formula_id   UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    name         TEXT        NOT NULL,
    description  TEXT        NOT NULL DEFAULT '',
    source       TEXT        NOT NULL,
    author       TEXT        NOT NULL,
    is_public    BOOLEAN     NOT NULL DEFAULT FALSE,
    input_schema JSONB       NOT NULL DEFAULT '{}',
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX ON indicators.formulas (author);
CREATE INDEX ON indicators.formulas (is_public) WHERE is_public = TRUE;
```

Migration files:
- `services/xstockstrat-indicators/migrations/001_formulas.up.sql`
- `services/xstockstrat-indicators/migrations/001_formulas.down.sql`

`scripts/db-migrate.sh` run order must be updated to include `indicators` (appended after `ingest`).

## Feature Workflow Notes

Branch to create: `feature/formula-management-ui` (branch from `main-dev`)
Approval gates required (per docs/runbooks/feature-workflow.md):
- [x] 1 service owner approval (non-breaking proto change — new RPCs only)
- [ ] 2 service owners + platform lead (not required — no breaking proto changes)
- [x] DBA review + service owner (schema migration — new `indicators.formulas` table)

## Acceptance Criteria

1. `xstockstrat-indicators` restarts without losing any previously registered formula.
2. Calling `ListFormulas` with `author_filter="alice"` returns only Alice's formulas.
3. Calling `ListFormulas` with `include_public=true` and no `author_filter` returns all public formulas regardless of author.
4. `UpdateFormula` with a mismatched `user_id` returns a `PERMISSION_DENIED` gRPC status.
5. `DeleteFormula` with a mismatched `user_id` returns a `PERMISSION_DENIED` gRPC status.
6. The `/formulas` page in `xstockstrat-insights` renders the formula list within 2 seconds on a local stack.
7. Creating a formula via the UI persists it and shows it in the list on the next page load.
8. Editing a formula via the UI updates the record in the database.
9. Deleting a formula via the UI removes it from the database and the list.
10. Test-executing a formula from the detail page returns the formula output or a structured error within the sandbox timeout.

## Merge-order Dependencies

- **Must execute after `044-client-api-pattern`** is merged: the xstockstrat-insights API
  layer is being refactored by 044 (SWR → connect-query-es + TanStack Query hooks); 003's
  formula hooks and BFF route handlers must follow 044's established pattern.
- **Must execute before `045-ui-consolidation-nextjs`**: 003 targets `xstockstrat-insights`;
  after 045 consolidates insights into `xstockstrat-ui`, the target service no longer exists
  as a standalone directory. Execute 003 first, then 045 absorbs the completed formula UI.

## Open Questions

- [x] **OQ-1 — RESOLVED**: `user_id` is supplied via an `X-User-Id` HTTP request header. The insights Next.js API routes read this header and forward the value as `user_id` in the gRPC/Connect-RPC call. When the header is absent (local dev without auth middleware), a hardcoded fallback `'dev-user'` is used. Full JWT enforcement is deferred to the identity integration feature.
- [x] **OQ-2 — RESOLVED**: `ListFormulas` includes offset+limit pagination in this phase (`page_size` + `page_offset` in the request, `total_count` in the response). This avoids a proto breaking-change later when formula counts grow.
- [x] **OQ-3 — RESOLVED**: Use **Monaco Editor** (`@monaco-editor/react`) for the formula source textarea. Monaco is chosen over CodeMirror because it supports registering a custom `CompletionItemProvider` to suggest numpy/pandas/indicators API calls inline, which meaningfully reduces formula authoring errors. Bundle cost (~2 MB gzip) is acceptable for an analytics tool used by developers.
