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

**Expected.** One template-repository contract across the three services, stated as FR-1..FR-5 below.

## Functional Requirements

Each FR applies to `ManageTemplate` in xstockstrat-indicators (FORMULA), xstockstrat-analysis (STRATEGY) and
xstockstrat-ingest (SIGNAL_SOURCE). The decisions behind them are listed under Open Questions.

- **FR-1 (metadata is mutable on UPDATE).** A successful UPDATE persists the request's `name` and `description`.
  The UPDATE response and later `ListTemplates` reads return the new values. Ingest already does this; indicators
  and analysis must change.
- **FR-2 (version on UPDATE).** Every successful UPDATE, including a metadata-only one with an unchanged payload,
  increments `version` by exactly 1 and sets `updated_at`. All three services already do this today. The FR pins
  the behavior so the FR-1 fix does not change it.
- **FR-3 (RETIRE is first-wins).** The first RETIRE sets `retired_at`, and a later RETIRE of an already-retired
  template leaves `retired_at` unchanged. Indicators and analysis already do this; ingest must change.
- **FR-4 (RETIRE sets updated_at).** A RETIRE call sets `updated_at` in every service. Analysis and ingest already
  do this; indicators must change.
- **FR-5 (empty-id CREATE is rejected).** CREATE with an empty `template_id` returns
  `INVALID_ARGUMENT` and writes no row in every service. Indicators and analysis already do this; ingest must
  change.

## Open Questions

- [x] **Is template metadata mutable?** Resolved: yes (FR-1). The config-ui editor already sends
  `name`/`description` on UPDATE (`page.tsx:153-158`), and ingest already persists them. Making metadata
  immutable would require a UI change and a reject path that nothing asks for.
- [x] **Should a metadata-only UPDATE bump `version`?** Resolved: yes (FR-2). Keeping the bump preserves the
  current behavior of all three services. Suppressing "update available" for cosmetic edits would be a new
  capability (a payload-diff rule), not this bug fix.
- [x] **RETIRE `retired_at`: first-wins or last-wins?** Resolved: first-wins (FR-3). Two of the three services
  already behave this way, and first-wins keeps the original retirement time for audit.
- [x] **Empty-id CREATE: mint or reject?** Resolved: reject with `INVALID_ARGUMENT` (FR-5). Two of the three
  services already reject. The config-ui disables save when Template ID is empty (`page.tsx:479`), so no UI flow
  relies on ingest minting an id.

Design (`/sdd-design`) may overturn any of these decisions. If it does, the same change must update the matching
FR and `@AC-*` scenario.

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
- xstockstrat-ingest (fix site: RETIRE first-wins (FR-3) and empty-id CREATE rejection (FR-5))
- xstockstrat-ui (consumer surface only; no code change expected because metadata stays mutable, FR-1)

## Consumer Surface(s)

_Constitution **C-14**._

- [x] **UI**: `xstockstrat-ui` `/config-ui/templates` (`src/app/config-ui/templates/page.tsx`). After the fix, an
  operator's rename or description edit actually persists for FORMULA and STRATEGY templates (FR-1). Re-retiring
  a SIGNAL_SOURCE template no longer moves its retired date (FR-3). No editor change is expected: the page already
  sends `name`/`description` and blocks an empty Template ID.
- [x] **Agent**: `xstockstrat-agent` `list_templates` / `instantiate_template` read the corrected `name`,
  `description` and `version`. No tool code change is expected. FR-5 matters only if a caller sends an empty
  SIGNAL_SOURCE `template_id`, which now returns `INVALID_ARGUMENT` instead of minting an id.
- [ ] **None**

## Fix Scope

- [x] No proto changes anticipated
- [x] No database migrations anticipated (`name`/`description` columns already exist in all three tables)
- [x] No config key changes anticipated

(Update after investigation — remove or replace each item as needed)

## Acceptance Criteria

See `acceptance.feature` — the regression scenario(s) that must fail on the buggy behavior and pass
after the fix (Constitution **C-15**). Plus: existing tests pass; affected service(s) smoke-tested on
dev.

## Out of Scope

- Proto changes: `ManageTemplate` and `TemplateMeta` stay as they are, and no immutability flag is added
- The config-ui templates editor (`page.tsx`) and the agent template tools: no behavior change
- Suppressing the `version` bump on metadata-only UPDATE (see FR-2)
- Instance rows: UPDATE and RETIRE still never touch existing template instances
- Refactoring or performance work unrelated to the bug
- Extracting a shared Python template-repository package (debt-radar D-20) unless design chooses it as the fix vehicle
