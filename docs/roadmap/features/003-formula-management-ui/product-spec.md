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
FR-7. The `xstockstrat-insights` UI must provide a `/formulas` page listing the current user's formulas and all public formulas.
FR-8. The UI must support creating a new formula (name, description, source code, is_public toggle).
FR-9. The UI must support editing an owned formula's name, description, source, and is_public flag.
FR-10. The UI must support deleting an owned formula with a confirmation step.
FR-11. The UI must support test-executing a formula inline (send JSON input, display output/stderr) on the formula detail page.
FR-12. All UI→backend calls must go through Next.js API routes that proxy to the indicators Connect-RPC HTTP endpoint (port 8054).

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
- `packages/proto` — new RPCs and request/response messages in `indicators/v1/indicators.proto`

## Proto Contract Changes

- New RPC `ListFormulas(ListFormulasRequest) returns (ListFormulasResponse)`
  - `ListFormulasRequest`: `string author_filter`, `bool include_public`
  - `ListFormulasResponse`: `repeated FormulaDefinition formulas`
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

## Open Questions

- [ ] How should `user_id` be supplied from the insights frontend in the absence of JWT — query param, header, or hardcoded dev value?
- [ ] Should `ListFormulas` support pagination (cursor or offset) in this phase, or is a full list acceptable given expected formula counts?
- [ ] Is a code editor widget (e.g., CodeMirror) desired for the source textarea, or is a plain `<textarea>` sufficient for the initial version?
