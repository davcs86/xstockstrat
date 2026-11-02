# Product Spec: legacy-authors-confirm-resolve

**Created**: 2026-11-02

---

## Problem Statement

`legacy_authors_ops confirm` only flips `suggested` rows to `confirmed`. A row whose legacy author matches no active user (`unmappable`) or several (`ambiguous`) can only be resolved by hand-editing `plan.json` (runbook `docs/runbooks/legacy-formula-authors.md` §5). The wrapper exists for the DO console, whose filesystem is ephemeral and has no editor workflow, so those rows cannot be repaired there. This is a follow-up to feature 276 (`launched`).

## User Story

As an operator repairing legacy-username formula authors, I want `confirm` to resolve `unmappable` and `ambiguous` rows by mapping a legacy author to an active user, so that I can finish the repair from a DO console without editing `plan.json`.

## Functional Requirements

FR-1. `confirm` accepts a repeatable `--map <legacy_author>=<user_id>`. One mapping resolves every `unmappable` or `ambiguous` row whose `old_author` equals `<legacy_author>` exactly.
FR-2. A mapping target must be a UUID present in `users.json` with `is_active=true`; for an `ambiguous` row it must also be one of that row's matched candidates. `--map` is split on the last `=`. Any invalid `--map` (malformed, unknown user, inactive user, a legacy author matching no unresolved row, or the same legacy author mapped to two different targets) aborts `confirm` before the plan is written with exit code 2 and the plan file byte-identical. Validation reads `users.json` with the strict `legacy_authors.load_users`, so a missing or malformed file aborts too.
FR-3. After `--map` is applied, rows still `unmappable` or `ambiguous` are offered one at a time in an interactive numbered picker with a skip option. For an `ambiguous` row the picker lists only its matched candidate users; for an `unmappable` row it lists all active users. EOF or empty input skips the row.
FR-4. Every row resolved by FR-1 or FR-3 gets `new_author=<user_id>`, `source="override"`, `status="confirmed"`. The resolved rows are listed together with any `suggested` rows in the one existing confirmation prompt, and nothing is written until it is answered `y`. Declining writes nothing and exits 0.
FR-5. With `--yes`, the prompt and the picker are skipped. `suggested` rows are confirmed exactly as today, rows named by `--map` are resolved, and every other unresolved row stays untouched.
FR-6. `confirm` also runs when there are no `suggested` rows but unresolved rows exist (today it exits early with "No suggested rows"). `suggested` handling and the printed digest are otherwise unchanged, and so are the exit codes for success (0), decline or EOF (0) and a plan with nothing to confirm (0). The picker lists active users in `users.json` order.
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
- OQ-2 (resolved). `--map` plus `--yes` is the non-interactive path; the explicit flag is the decision, so the confirmation is skipped. Without `--yes` the confirmation is always interactive, and it is the single prompt that also covers `suggested` rows.
- OQ-3 (resolved). `--map` matches the stored `old_author` exactly (case-sensitive). Classification stays case-insensitive.
- OQ-4 (resolved). The resolved-row listing reuses `format_plan` output; no new PII exposure.
