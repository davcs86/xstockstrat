# Design: legacy-authors-confirm-resolve

**Created**: 2026-11-02
**Rounds**: 2 (quick mandated 1; operator ran a second round; termination: approved)
**Approved by**: user @ 2026-11-02 (AskUserQuestion design gate, round 2)
**Grounded in**: recon.md

---

## Chosen Approach

All code lives in `services/xstockstrat-indicators/app/maintenance/legacy_authors_ops.py` (recon.md → Codebase Map); `legacy_authors.py` is unmodified (FR-7). The apply-time guard, `REWRITE_SQL`, `run_apply` and `report` are untouched. Consumer surface: none (operator CLI, C-14 n/a, same as 276).

**Units.** `_UNRESOLVED = la.APPLY_STATUSES - {"confirmed"}`; `_candidates(author, users)` (twin of the `classify` predicate at `legacy_authors.py:99-104`, one comment naming the twin); `_parse_maps(maps, unresolved, users) -> (mapping, reasons)` (pure, collects every reason, checks in order: shape → UUID → in `users.json` → active → matches an unresolved `old_author` exactly → ambiguous author needs a matched candidate → no conflicting duplicate target); `_pick(unresolved, chosen, users, ask) -> dict` (stdlib prompts via the injected `ask`); `confirm(work, *, yes, maps=(), ask=input) -> (int, str | None)` — return shape unchanged.

**Flow of `confirm`.** Load plan → derive `suggested` / `unresolved` → `need_users = bool(maps) or (unresolved and not yes)` → if nothing to do, print today's `No suggested rows to confirm.` and return `(0, None)` → lazily load `users.json` strictly with `la.load_users` (unreadable: with `--map` raise `la.ApplyRefused` → exit 2, nothing written; without `--map` print a warning, skip the picker, run the suggested-only flow) → validate all `--map` before any print or write → print `format_plan` → picker (not `--yes`) → apply overrides **in memory** (`new_author`, `source="override"`, `status="confirmed"`) → one combined prompt (today's exact `Confirm N suggested rewrite(s)? [y/N]` text when nothing is overridden, `Confirm N suggested and M override rewrite(s)? [y/N]` otherwise) → **single write site** `_write_private`, so every abort, decline, EOF or refusal leaves `plan.json` byte-identical → return `(suggested + overrides, plan_digest)`.

**Operator decisions bound into the design (context.md):** picker asks once per legacy author (all its rows, soft-deleted included); unreadable `users.json` without `--map` skips the picker with a warning; the first EOF stops the picker for all remaining authors (a deliberate superset of "EOF skips the author": a closed stdin otherwise re-prints the whole user directory per author).

**Round-2 fold-ins:** override targets are printed (second `format_plan`) on the `--yes --map` path too, since stdout is the change record in a DO console; a decline or EOF at the final prompt prints `Not confirmed; plan.json unchanged.` (exit stays 0; a piped `y` that lands on the picker no longer fails silently; no TTY switch is added); the refusal lines are printed inline in the confirm branch of `main()` through `la.log` (`[run_id=…] refused: <reason>`, same shape as apply) and the apply branch is not refactored; the picker cap is `_PICK_ATTEMPTS = 3` and the notice interpolates it; an author with no eligible user is skipped with a notice and no prompt; `main()` gets `sub.choices["confirm"].add_argument("--map", action="append", default=[], metavar="LEGACY=USER_ID")` mirroring `legacy_authors_ops.py:145`.

**Drift guard.** `test_candidates_match_classify_rule` parametrized over `sam`, `SAM`, `davcs86`, `olduser`, `ghost` asserts `_candidates` equals the users for which `la.classify` (called with a one-user dict) returns `suggested`. The candidate rule is enforced at `confirm` only; `validate_for_apply` does not re-check it, so a hand-edited `plan.json` can still bypass it — docs must not claim apply-time enforcement.

**Tests** (`tests/test_legacy_authors_ops.py`, conftest `USERS`: `sam` ×2 ambiguous, `olduser` inactive; the two existing confirm tests stay unchanged and pass because `users.json` is loaded lazily): one test per `@AC-1`…`@AC-22` (AC-12 is a doc check at impl-review), an `ask` recorder that raises `EOFError` when exhausted, two `main()`-argv tests for the exit-2 and EOF paths. Weak-RED fixes: invalid picker answers `"0"`, `"-1"`, `"abc"` (catches an unbounded `options[int(a)-1]`); a two-bad-maps case asserting both reasons are collected in order; the capped-attempts test uses a single-author plan.

**Docs (FR-8):** runbook intro `:18-27` and §5 `:102-126` (the `--map` / picker flow; exit 2 and the `refused:` line shape; `--yes --map` is the only scripted path; a piped answer lands on the picker; the picker lists every active user's email local part and id, so use `--map` when the session is recorded; counts shown are the report's; overriding a wrong `suggested` match remains the hand-edit fallback; the 276 scoping below; the malformed-`users.json` message echoes one entry because FR-7 forbids changing it); module docstring `:1-9`; `services/xstockstrat-indicators/CLAUDE.md` § Maintenance; `docs/context-constitution.md:29` re-read, no edit expected. Teardown: context-forge refresh scoped to those docs, or a recorded manual reconciliation in the PR body (root CLAUDE.md).

## Rejected Alternatives

- Reach the candidate list through `la.classify` — rejected: it discards the candidates for ambiguous rows, and exposing them means editing `legacy_authors.py` (FR-7).
- Store candidates on plan entries at `report` time — rejected: changes the plan and its digest, and `report` is out of scope.
- `SystemExit(2)` raised inside `confirm` — rejected for a structured `la.ApplyRefused` (assertable reasons, one exit-2 convention); accepted naming misfit.
- Extract a shared `_refused` helper touching the apply branch — rejected: apply is out of scope; three inline lines are cheaper than a diff in apply.
- TTY-gated picker — rejected: blocks legitimate scripted answers, adds a second interactive switch next to `--yes`, over-built (C-18).
- Picker per row — rejected: soft-deleted siblings could end half-resolved and `@AC-5`'s answer sequence breaks.
- Eager `users.json` load — rejected: breaks the two existing tests that run without it.
- Refusals to stderr — rejected: breaks the `refused:` stdout contract in runbook §6.
- Uncapped re-ask loop — rejected: never terminates under a piped stdin; an immediate skip on the first invalid answer was rejected because one typo would lose the author.

## Open Risks

- [ ] A scripted `printf 'y\n' | confirm` against a plan with unresolved rows now lands its `y` on the picker and writes nothing — mitigated by the `Not confirmed` line and the runbook's "`--yes --map` is the only scripted path"; verify in the runbook step.
- [ ] The copied candidate predicate can drift from `classify` — pinned by the parity test, which samples five authors; a future `casefold`/`strip` change would need a new sample.
- [ ] `load_users`'s malformed-entry message echoes one user's `email_local` into the refusal/warning line — unavoidable under FR-7; documented in the runbook PII note.
- [ ] Doc teardown (context-forge refresh or manual reconciliation) must be recorded in the PR body — target: docs step and PR.
- [ ] Overlap: `243-fix-sandbox-seed-keys` edits other hunks of `services/xstockstrat-indicators/CLAUDE.md` — rebase-level.

## Constitution Rules Touched

- `C-11` — honored by: this story → review → design (quick, extended to 2 rounds) chain before any code.
- `C-08` / `C-15` — honored by: every `@AC-1`…`@AC-22` maps to a test (AC-12 a doc check); existing `:62`/`:93` tests unchanged.
- `C-13` — honored by: tests reuse `tests/conftest.py::USERS`; helpers stay inline (single consumer).
- `C-14` — honored by: consumer surface explicitly "None" (operator CLI).
- `C-16` — honored by: see Business Rules Touched.
- `C-18` — honored by: one file changed, no new layer or exception type; `_PICK_ATTEMPTS` is the single mechanism beyond the spec and is justified (bounded piped input); candidate-rule duplication is the recorded trade-off forced by FR-7.
- `P-03` — honored by: every ambiguity (picker unit, unreadable `users.json`, EOF reading) resolved by an operator decision recorded in context.md.
- `F-04` — honored by: every cited symbol was verified at its path:line by discovery and by the adversary.
- `F-01`/`F-06`/`F-07` — not engaged: no migration, no pool change, no config key.

## Business Rules Touched (C-16)

Source suite: `services/xstockstrat-indicators/acceptance/fix-legacy-formula-authors.feature` (feature 276). No CHANGE; no extra sign-off needed.

- PRESERVE `@AC-9` "Apply refuses without a digest-matched, fully-confirmed plan and never touches system or UUID rows" — not regressed by: `confirm` confirms every `suggested` row before its single write, never edits `legacy_authors.py`, and writes only `new_author`/`source`/`status`.
- PRESERVE `@AC-8` "A row written between detection and rewrite is not lost" — `confirm` writes `plan.json` only; `old_author` is never mutated, so the write set (confirmed ∩ live detection) is unchanged.
- PRESERVE `@AC-4` "A second run changes nothing; non-legacy rows untouched" — `--map` and the picker act only on `unmappable`/`ambiguous` rows derived from detection.
- PRESERVE `@AC-5` "`report` is read-only" — `report` untouched.
- PRESERVE `@AC-1` "A pre-ownership formula ends up owned by its user id" — targets must be active ids in `users.json`.
- EXTEND `@AC-3` "An author that maps to no user is left unchanged and reported" — still the default without an operator decision; `--map` or the picker is an explicit override. Scoping: "left unchanged" means the automatic fix never guesses; an override is an explicit operator action.
- EXTEND `@AC-7` "An author that maps to more than one user is left unchanged and reported" — same scoping; the override is restricted to the matched candidates.
- EXTEND `@AC-2` "Legacy authors including soft-deleted rows are found" — `--map`/picker resolve soft-deleted siblings together with live rows.
- Unwritten behavior changed on purpose (FR-6): `confirm` no longer exits early when no `suggested` row exists but resolvable rows do; today's string and exit code are kept when there is nothing to do.
