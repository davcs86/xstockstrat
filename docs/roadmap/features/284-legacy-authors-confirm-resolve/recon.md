# Recon: legacy-authors-confirm-resolve

**Created**: 2026-11-02
**From**: product-spec.md
**Affected services**: `xstockstrat-indicators` (operator CLI only; docs: `docs/runbooks/legacy-formula-authors.md`)

---

## Objective

Extend `python -m app.maintenance.legacy_authors_ops confirm` so an operator can resolve `unmappable` and `ambiguous` plan rows without hand-editing `plan.json`: repeatable `--map LEGACY=USER_ID` flags, then an interactive numbered picker for what is left. Targets must be active users in `users.json`; resolved rows become `source="override"`, `status="confirmed"`. The apply-time guard in `legacy_authors.py` is not touched (FR-7).

## Codebase Map

- **`xstockstrat-indicators`** (Python 3.13, asyncpg + stdlib only — must keep running in the DO console)
  - Only code file to change: `services/xstockstrat-indicators/app/maintenance/legacy_authors_ops.py`
    - `confirm(work, *, yes, ask=input) -> tuple[int, str | None]` — `:90-108`; early exit "No suggested rows to confirm." at `:94-96` (FR-6 changes it); prompt `Confirm N suggested rewrite(s)? [y/N]` at `:98-104`; writes plan via `_write_private` and returns `(len(suggested), la.plan_digest(plan_path))` at `:105-108`
    - `main()` argparse — `:136-186`; `for name in ("confirm","apply")` adds `--yes/-y` at `:142-144`; per-subparser extras via `sub.choices["apply"].add_argument("--confirm-digest", …)` at `:145`; confirm branch `:149-154` maps `0 if digest or n == 0 else 1`
    - `format_plan` — `:53-60`; `_users_by_id` — `:46-50` (lenient: returns `{}` on any read error, no `is_active`); `_load_plan` — `:39-43`; `_write_private` — `:28`
    - Module docstring `:1-9` (FR-8)
  - Read-only reuse (`services/xstockstrat-indicators/app/maintenance/legacy_authors.py`):
    - `is_uuid` — `:39-40`; `load_users` — `:61-81` (strict: `SystemExit` on unreadable/malformed; dict preserves file order); `classify` — `:97-130` (candidate rule at `:99-104`: `u["is_active"] and u["email_local"].lower() == author.lower()`); `APPLY_STATUSES` — `:151`; `ApplyRefused.exit_code = 2` — `:154-155`; `validate_for_apply` — `:162-190` (does not read `source`, so `"override"` passes)
  - Plan entry shape (`legacy_authors.py:117-123`): `{formula_id, old_author, new_author, status, source}`; only value ever written for `source` is `"heuristic"` — `"override"` appears only in runbook §5 (`:121-124`)
  - Tests: `services/xstockstrat-indicators/tests/test_legacy_authors_ops.py` (132 lines); fixtures in `tests/conftest.py` — `USERS` `:39-50`, `make_formula_row` `:55`, `FakeFormulasTable` `:73`

## Patterns to REUSE

- Numbered/choice prompting → reuse the injected `ask=input` parameter of `confirm` (`legacy_authors_ops.py:90`) for every prompt, so tests drive it with `ask=lambda _p: …` exactly as `test_confirm_declined_leaves_plan_untouched` (`tests/test_legacy_authors_ops.py:93`) does. No picker/KEY=VALUE helper exists anywhere (`## Not found`); `scripts/manage-users.py:104,141` use Typer, which the stdlib-only wrapper must not import.
- `--map` parsing → `argparse` `action="append"` on the `confirm` subparser via `sub.choices["confirm"]` (mirrors `:145`) plus `rsplit("=", 1)`; no new parser.
- Target validation → `la.load_users` (strict) and `la.is_uuid`; **not** `_users_by_id` (swallows errors, no `is_active`).
- Candidate set for an ambiguous row → recompute from `users.json` with the same rule as `classify` (`legacy_authors.py:99-104`). The plan does not store candidates. `legacy_authors.py` must stay unmodified (FR-7), so the rule is either duplicated in the ops module or reached through `la.classify`.
- Abort exit code → `la.ApplyRefused.exit_code` (2) is the module's existing "refused" convention; reuse it for an invalid `--map`.
- Test data → `tests/conftest.py::USERS` already has the ambiguous (`sam` ×2, ids `44444444-…`/`55555555-…`), inactive (`olduser`) and unique-active cases; no new fixture is needed (C-13, one consumer).

## Existing Business Rules (preserve / extend)

Source: `services/xstockstrat-indicators/acceptance/fix-legacy-formula-authors.feature` (8 scenarios, feature 276). `docs/sdd/business-rules/platform.feature` holds nothing relevant. No rule is CHANGE.

- **PRESERVE** `@AC-9 @FR-7 @feature-276` apply refuses without a digest-matched, fully-confirmed plan and never touches system/UUID rows — a plan written by `confirm` must pass these unchanged; `confirm` must leave no `suggested` row in a plan it writes
- **PRESERVE** `@AC-8 @FR-7 @feature-276` compare-and-set; write set = confirmed ∩ live detection — `confirm` writes `plan.json` only and never widens the write set; override rows keep `old_author` exact
- **PRESERVE** `@AC-4 @FR-4 @feature-276` idempotent re-run; non-legacy rows untouched — `--map` and the picker act only on unresolved rows from detection
- **PRESERVE** `@AC-5 @FR-5 @feature-276` `report` is read-only — 284 changes only `confirm`
- **PRESERVE** `@AC-1 @FR-1 @regression @feature-276` end state is an owner-readable row — targets must be active ids in `users.json`
- **EXTEND** `@AC-3 @FR-3 @feature-276` unmappable stays unchanged — still the default; 284 adds an explicit operator override
- **EXTEND** `@AC-7 @FR-3 @feature-276` ambiguous stays unchanged — still the default; the override is limited to matched candidates
- **EXTEND** `@AC-2 @FR-2 @regression @feature-276` soft-deleted rows are detected — `--map` resolves them with their live siblings
- Wording note: 276 `@AC-3`/`@AC-7` say "left unchanged". 284 reads them as "the automatic fix never guesses"; if read as absolute they become a CHANGE needing sign-off. Design must state this scoping.
- Unwritten behavior changed by FR-6: `confirm` early-exiting when no `suggested` row exists is in no suite.
- Apply-side gap: `validate_for_apply` does not check that an ambiguous row's target is a matched candidate. The candidate rule is enforced only at `confirm`; a hand-edited `plan.json` can still bypass it. Design must not claim apply-time enforcement.

## Dependencies

- Proto/RPC: none
- Migration: none
- Config keys: none
- Inter-service edges: none (single `asyncpg` connection to `indicators.formulas` / `identity.users` in `report` and `apply` only; `confirm` is file-only)
- New env vars / ports: none

## Risks / Not-found

- **Existing tests constrain the signature.** `test_confirm_marks_only_suggested_and_returns_digest_of_written_file` (`:62`) and `test_confirm_declined_leaves_plan_untouched` (`:93`) call `confirm()` with **no `users.json` in the work dir**, assert the `(int, str|None)` return and `n == 1` / `(0, None)`. `users.json` must therefore be loaded lazily (only when `--map` is given or unresolved rows need a picker), and an exit-2 abort needs a separate channel (raise / `SystemExit(2)`), not a changed return.
- **Test fixtures differ from the AC example values.** `acceptance.feature` uses `alice` ×2 and inactive `bob`; `conftest.USERS` uses `sam` ×2 and inactive `olduser`. Tests should use `USERS`; scenarios stay example values.
- **No test exercises `main()` with argv**, so the exit-code mapping (`:154`) is untested today; the new exit-2 path needs a `main()`-level test.
- **Docs to update (FR-8):** runbook intro `:13-27` (line 19-21 says overrides are "still a hand edit of `plan.json`") and §5 `:102-126`; module docstring `:1-9`; `services/xstockstrat-indicators/CLAUDE.md` § Maintenance; `services/xstockstrat-indicators/docs/context-constitution.md:29` (mentions `legacy_authors`, needs a re-read); `docs/runbooks/CLAUDE.md` index row probably unchanged.
- **Teardown (root CLAUDE.md):** touching the indicators `CLAUDE.md` / runbook requires the context-forge refresh or a recorded manual reconciliation in the PR body.
- **Overlap:** `243-fix-sandbox-seed-keys` also edits `services/xstockstrat-indicators/CLAUDE.md` in disjoint hunks (rebase-level).
- **Coverage:** CI gate for indicators is 50% (`.github/workflows/ci.yml:380-382`); `app/maintenance/*` is not omitted from coverage (`pyproject.toml:41-47`). Ruff: line-length 100, `E,F,I,UP`.
- **Ledger:** no `fails.md`/`insights.md` entry concerns operator maintenance CLIs.
- **Not found:** numbered-choice or KEY=VALUE helper; any stdin/`builtins.input` mocking in the legacy-author tests; any code writing `source:"override"`; any stored candidate list on plan entries; full text of `docs/context-constitution.md:29`.

## Recommended Scope

Advisory, for grilling and `/sdd-spec`:

1. `legacy_authors_ops.py`: `--map` parsing + validation, candidate recompute, picker, single combined confirmation, FR-6 early-exit change, exit 2 on invalid map. Pure helpers kept separate from I/O so they are unit-testable.
2. `tests/test_legacy_authors_ops.py`: scenarios `@AC-1`–`@AC-17`, using `USERS` and `ask=`; one `main()`-level test for exit codes.
3. Docs: runbook §5 + intro, module docstring, indicators `CLAUDE.md` § Maintenance, context-constitution line 29; teardown audit.
