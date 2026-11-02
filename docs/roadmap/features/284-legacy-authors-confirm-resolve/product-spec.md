# Product Spec: legacy-authors-confirm-resolve

**Created**: 2026-11-02

---

## Problem Statement

`legacy_authors_ops confirm` only flips `suggested` rows to `confirmed`. A row whose legacy author matches no active user (`unmappable`) or several (`ambiguous`) can only be resolved by hand-editing `plan.json` (runbook `docs/runbooks/legacy-formula-authors.md` §5). The wrapper exists for the DO console, whose filesystem is ephemeral and has no editor workflow, so those rows cannot be repaired there. This is a follow-up to feature 276 (`launched`).

## User Story

As an operator repairing legacy-username formula authors, I want `confirm` to resolve `unmappable` and `ambiguous` rows by mapping a legacy author to an active user, so that I can finish the repair from a DO console without editing `plan.json`.

## Functional Requirements

FR-1. `confirm` accepts a repeatable `--map <legacy_author>=<user_id>`. One mapping resolves every `unmappable` or `ambiguous` row whose `old_author` equals `<legacy_author>` exactly.
FR-2. A mapping target must be a UUID present in `users.json` with `is_active=true`; for an `ambiguous` row it must also be one of that row's matched candidates. Any invalid `--map` (malformed, inactive or unknown user, or a legacy author matching no unresolved row) aborts `confirm` before the plan is written, exit code non-zero, plan file byte-identical.
FR-3. After `--map` is applied, rows still `unmappable` or `ambiguous` are offered one at a time in an interactive numbered picker with a skip option. For an `ambiguous` row the picker lists only its matched candidate users; for an `unmappable` row it lists all active users. EOF or empty input skips the row.
FR-4. Every row resolved by FR-1 or FR-3 gets `new_author=<user_id>`, `source="override"`, `status="confirmed"`. Resolved rows are listed and need an explicit second `y/N` before the plan is written. Declining writes nothing.
FR-5. With `--yes`, the picker and the second confirmation are skipped: only rows resolved by explicit `--map` are written, and rows still unresolved stay untouched.
FR-6. `confirm` also runs when there are no `suggested` rows but unresolved rows exist (today it exits early with "No suggested rows"). `suggested` handling, the printed digest and the exit codes are otherwise unchanged.
FR-7. `legacy_authors.py` (`validate_for_apply`, `run_apply`, the SQL guards) is not modified; a plan written by FR-4 passes the existing apply-time checks unchanged.
FR-8. Runbook §5 and the module docstring document the new flow; hand-editing `plan.json` is retained only as a fallback note.

## Out of Scope

- Changing apply semantics or relaxing any apply-time guard in `legacy_authors.py`.
- Targeting inactive users.
- A `--mapping <file>` input (the console filesystem is ephemeral).
- Any change to `report`, `apply`, `manage-users.py` or the service process.
- Running the repair against staging or production.

## Affected Services

- `xstockstrat-indicators` — `app/maintenance/legacy_authors_ops.py`, `tests/test_legacy_authors_ops.py`, service `CLAUDE.md` § Maintenance.
- Docs only: `docs/runbooks/legacy-formula-authors.md`.

## Consumer Surface(s)

- [ ] **UI**
- [ ] **Agent**
- [x] **None** — operator-run CLI inside the indicators image / a workstation, not reachable from any UI segment or MCP tool. It is the interface of the feature-276 repair, as 276 itself was.

## Proto Contract Changes

- [x] No proto changes required

## Config Key Changes

- [x] No new config keys

## Database Changes

- [x] No schema changes (the write path stays the existing `legacy_authors.run_apply` compare-and-set).

## Feature Workflow Notes

Branch to create: `feature/legacy-authors-confirm-resolve` (branch from `main-dev`)
Approval gates required (per docs/runbooks/feature-workflow.md):
- [ ] 1 service owner approval (non-breaking proto or config change) — service owner review of `xstockstrat-indicators` only
- [ ] 2 service owners + platform lead (breaking proto change) — not applicable
- [ ] DBA review + service owner (schema migration) — not applicable; real runs still need the DBA change record (runbook §2)

## Acceptance Criteria

See `acceptance.feature` (scenarios `@AC-*`) — the single source of acceptance truth (Constitution
**C-15**). Each `FR-N` above is covered by ≥1 tagged scenario there.

## Open Questions

None open. Resolved 2026-11-02 by the operator ("go with your recommendations"):

- OQ-1 (resolved). An `ambiguous` row accepts only its matched candidates, from `--map` as well as from the picker: one rule for both paths. An `unmappable` row accepts any active user.
- OQ-2 (resolved). `--map` plus `--yes` is the non-interactive path; the explicit flag is the decision, so the second y/N is skipped. Without `--yes` the second y/N is always interactive.
- OQ-3 (resolved). `--map` matches the stored `old_author` exactly (case-sensitive). Classification stays case-insensitive.
- OQ-4 (resolved). The resolved-row listing reuses `format_plan` output; no new PII exposure.
