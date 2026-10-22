# Product Spec: fix-template-update-metadata

**Type**: bug
**GitHub Issue**: none. Defect report: `docs/reports/2026-10-21-template-update-metadata-defect.md`
**Severity**: SEV-2
**Created**: 2026-10-21

---

## Problem Statement

**Observed.**

- **UPDATE drops metadata.** Indicators `ManageTemplate` calls `self._templates_repo.update(meta.template_id,
  payload)` (`services/xstockstrat-indicators/app/handlers/servicer.py:652`); the repository SQL sets only
  `payload`, `version + 1`, `updated_at` (`app/services/formula_templates_repository.py:50-62`). Analysis is
  the same (`app/handlers/servicer.py:3581` → `app/repositories/strategy_templates.py:54-66`). Ingest writes
  `name`/`description` (`app/repositories/source_templates.py:50-65`). The config-ui templates page sends
  `name`/`description` on UPDATE (`services/xstockstrat-ui/src/app/config-ui/templates/page.tsx:153-158`, `:382`),
  so an admin rename "succeeds", bumps `version` (showing "update available" to every instance holder), and
  changes nothing.
- **RETIRE diverges.** Indicators (`formula_templates_repository.py:64-75`) and analysis
  (`strategy_templates.py:68-75`) keep the first `retired_at` via `COALESCE`; ingest
  (`source_templates.py:67-75`) overwrites it. Indicators' retire also skips `updated_at`.
- **Empty-id CREATE diverges.** Ingest mints a uuid (`ingest/app/handlers/servicer.py:1540`); indicators
  (`servicer.py:633-635`) and analysis (`servicer.py:3544-3552`) reject with `INVALID_ARGUMENT`.

**Expected.** One documented template-repository contract across the three services: UPDATE writes
`name`/`description` (or explicitly rejects metadata changes — design decides mutability); RETIRE uses one
`retired_at`/`updated_at` semantics; empty-id CREATE behaves the same everywhere.

## Reproduction Steps

1. Admin `ManageTemplate` CREATE `t-1` (name "Old", description "d1") on indicators.
2. UPDATE `t-1` with name "New", description "d2", same payload → response shows "Old"/"d1", `version: 2`.
3. Repeat on analysis (same) and ingest (name becomes "New").
4. RETIRE twice per service; CREATE with `template_id: ""` per service — compare.

## Root Cause Hypothesis

The three repositories were written per service with no shared contract (debt-radar D-20 family);
indicators and analysis treat UPDATE as a payload-only version bump, ingest as a full replace.

## Affected Services

- xstockstrat-indicators (fix site: formula-template repository, `ManageTemplate`)
- xstockstrat-analysis (fix site: strategy-template repository, `ManageTemplate`)
- xstockstrat-ingest (fix site for RETIRE/CREATE alignment, depending on the chosen contract)
- xstockstrat-ui (read-only evidence; changes only if metadata becomes immutable and the editor must stop offering rename)

## Fix Scope

- [x] No proto changes anticipated
- [x] No database migrations anticipated (`name`/`description` columns already exist in all three tables)
- [x] No config key changes anticipated

(Update after investigation — remove or replace each item as needed)

Open design question: should a metadata-only UPDATE (same payload) bump `version`? Bumping signals "update
available" to every instance holder for a cosmetic change.

## Acceptance Criteria

See `acceptance.feature` — the regression scenario(s) that must fail on the buggy behavior and pass
after the fix (Constitution **C-15**). Plus: existing tests pass; affected service(s) smoke-tested on
dev.

## Out of Scope

- Refactoring unrelated to the bug
- Performance improvements unrelated to the fix
- Extracting a shared Python template-repository package (debt-radar D-20) unless design chooses it as the fix vehicle
