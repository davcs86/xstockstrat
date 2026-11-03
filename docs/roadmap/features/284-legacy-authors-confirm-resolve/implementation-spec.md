# Implementation Spec: legacy-authors-confirm-resolve

**Status**: `complete`
**Created**: 2026-11-02
**Feature**: `docs/roadmap/features/284-legacy-authors-confirm-resolve/feature.md`
**Total Steps**: 6
**Feature Branch**: `feature/legacy-authors-confirm-resolve`

---

## Execution Summary

Chosen approach (design.md, operator-approved 2026-11-02, 2 rounds): every code change lives in `services/xstockstrat-indicators/app/maintenance/legacy_authors_ops.py`; `legacy_authors.py` (`validate_for_apply`, `run_apply`, the SQL guards) is **not modified** (FR-7). Order: (1-2) the pure helpers (`_UNRESOLVED`, `_candidates`, `_parse_maps`) and the interactive `_pick`, each with its unit tests; (3-4) the `confirm` rewrite (validate all `--map` first, lazy strict `users.json`, picker, one combined prompt, a **single write site**) plus the `main()` wiring (`--map`, exit 2 on refusal) and the module docstring, with the flow-level and `main()`-level tests; (5-6) runbook and indicators `CLAUDE.md` with the root-`CLAUDE.md` teardown audit.

Each `service` step is followed by its `test` step. Every code-bearing test step is authored to fail on the pre-implementation tree (the helper or the `maps=` keyword does not exist yet; `/sdd-execute` captures the red run first, P-06). Tests that assert preserved behavior (`@AC-9`, the EOF exit code) are marked green-on-arrival in their step; the red gate for that step is carried by the sibling assertions named there.

No proto, migration, config key, env var, port, dependency or `uv.lock` change. No outbound gRPC call is added, so the header-propagation constraint (step-constraints §B) is not triggered. Run against staging or production is out of scope (product-spec).

**Consumer surface (C-14): `None`** — decision, not omission. The product spec marks the feature an operator-run CLI inside the indicators image / a workstation, not reachable from any UI segment or MCP tool, exactly as feature 276 was. No `xstockstrat-ui` or `xstockstrat-agent` step, and no `strat-lab` plugin change (it does not reference `legacy_authors_ops`).

### Scenario Coverage (C-15)

| Scenario | Step(s) |
|---|---|
| @AC-1 `--map` resolves every row of one author; sha256 printed | 4 |
| @AC-2 inactive target rejected before any write | 2 (reason text), 4 (exit 2 via `main()`, plan byte-identical) |
| @AC-3 map for an author with no unresolved row rejected | 2 (reason text), 4 (exit 2 via `main()`, plan byte-identical) |
| @AC-4 one invalid map aborts the whole batch | 2 (both reasons collected in order), 4 (exit 2, repeatable flag via `main()`) |
| @AC-5 picker resolves both rows of an author from the numbered list | 2 (picker leg), 4 (flow leg incl. the `y` prompt) |
| @AC-6 ambiguous picker lists only its candidates | 2 |
| @AC-7 EOF at the picker skips | 2 (picker leg), 4 (flow leg and `main()` exit 0) |
| @AC-8 declining the confirmation writes nothing | 4 |
| @AC-9 `--yes` without `--map` never resolves | 4 (green-on-arrival guard) |
| @AC-10 `confirm` proceeds with only unresolved rows | 4 |
| @AC-11 resolved plan passes the existing apply guards | 4 |
| @AC-12 runbook documents the new flow | 5 (doc check; also verified at impl-review per design.md) |
| @AC-13 ambiguous row needs one of its candidates | 2 (reason text), 4 (exit 2 via `main()`, plan byte-identical) |
| @AC-14 well-formed id not in `users.json` rejected | 2 (reason text), 4 (exit 2 via `main()`, plan byte-identical) |
| @AC-15 one author mapped to two users rejected | 2 (reason text), 4 (exit 2 via `main()`, plan byte-identical) |
| @AC-16 `--yes --map` still confirms `suggested` rows | 4 |
| @AC-17 one prompt covers suggested and resolved rows | 4 |
| @AC-18 unreadable `users.json` skips the picker, suggested-only flow | 4 |
| @AC-19 author with no eligible user skipped without a prompt | 2 |
| @AC-20 `--yes --map` prints the override targets | 4 |
| @AC-21 a declined confirmation says so | 4 |
| @AC-22 EOF stops the picker for every remaining author | 2 |

### Constitution / governance notes

- **C-08 / C-13**: the paired tests reuse `tests/conftest.py::USERS` (`:39-50`). Test-local helpers (`_seed`, `_Ask`, `_users_dict`) have exactly one consumer (`tests/test_legacy_authors_ops.py`), so they stay inline in that module; no second consumer exists, so no new fixture home or catalog row is created.
- **C-16**: no existing business rule changes (design.md § Business Rules Touched: PRESERVE `@AC-1/4/5/8/9`, EXTEND `@AC-2/3/7`, all of `fix-legacy-formula-authors.feature`, feature 276). Promotion of this feature's scenarios into `services/xstockstrat-indicators/acceptance/` happens in the `/sdd-execute` integration PR (SKILL.md step 2.5), not in a numbered step here. The "left unchanged" wording of 276 `@AC-3`/`@AC-7` is scoped as "the automatic fix never guesses"; Step 5 states this in the runbook.
- **C-18**: one file of code, no new layer or exception type (`la.ApplyRefused` is reused). The only mechanism beyond the spec is `_PICK_ATTEMPTS` (bounded re-ask under piped stdin). The candidate-rule duplication in `_candidates` is the recorded trade-off forced by FR-7, pinned by a parity test (Step 2).
- **Docs must not claim apply-time enforcement** of the ambiguous-candidate rule: `validate_for_apply` (`legacy_authors.py:162-190`) does not re-check it, so a hand-edited `plan.json` can still bypass it (design.md § Drift guard).
- **Teardown (root `CLAUDE.md`)**: Steps 5-6 change context/docs files, so the PR body must record the context-forge refresh scoped to them, or (plugin unavailable) that fact **and** the manual reconciliation performed (Step 6 Instructions).
- **Reviewers**: `docs/runbooks/reviewer-registry.md` maps `service` and `test` steps to the owner of `xstockstrat-indicators`; `docs` steps have none. No Proto Reviewer, DBA or Platform Lead (no proto/migration/port change). The DBA change record (runbook §2) still governs any real run, which is out of scope here.

## Step Dependencies

- Step 2 [test] covers Step 1 [service]. Step 4 [test] covers Step 3 [service].
- Step 3 requires Step 1: `confirm` calls `_UNRESOLVED`, `_parse_maps`, `_pick` and `_PICK_ATTEMPTS`.
- Step 4 reuses the helpers (`_seed`, `_Ask`, `_users_dict`) and constants (`GHOST_DELETED`, `SAM_FID`, `ZED`) that Step 2 adds to the test module, and the two existing confirm tests (`:62`, `:93`) must pass **unchanged** after Step 3.
- Step 5 requires Step 3: the flag name, message wording, exit code and prompt count it documents are final only then. Step 6 requires Step 5 (it links the runbook section it summarizes).
- Overlap (file-level, impl-review input): `243-fix-sandbox-seed-keys` (`in-progress`) also edits `services/xstockstrat-indicators/CLAUDE.md`, in different sections than `## Maintenance` (rebase-level; whichever merges second re-reads the file before Step 6). `281-signal-watchlist-expiry-pruning` only cites the runbook as a shape reference (`implementation-spec.md:629,848`), no edit. No migration, proto or config-key collision.

---

### Step 1 — service: `--map` validation and picker helpers

**Status**: `done`
**Service**: `xstockstrat-indicators`
**Files**:
- `services/xstockstrat-indicators/app/maintenance/legacy_authors_ops.py` — modify

**Reviewers**: Service owner `xstockstrat-indicators` — Formula sandboxing, numeric precision, timeout enforcement (`indicators.sandbox.timeout_ms`), no side-effects from formula execution

**Codebase Evidence**:
- Confirmed via: `grep -n "^from\|^import\|^def \|^async def " services/xstockstrat-indicators/app/maintenance/legacy_authors_ops.py` → `la` import at `:21` (`from app.maintenance import legacy_authors as la`); `report` ends `:87`, `confirm` starts `:90`.
- `APPLY_STATUSES = {"confirmed", "unmappable", "ambiguous"}` at `legacy_authors.py:151`; `is_uuid` at `:39-40`; strict `load_users(path)` at `:61-81` (raises `SystemExit` on an unreadable or malformed file; returns `{user_id: {"email_local", "is_active"}}` in file order, so `.items()` is `users.json` order).
- Candidate rule to mirror, `legacy_authors.py:99-104`: `uid for uid, u in users.items() if u["is_active"] and u["email_local"].lower() == author.lower()`.
- `class ApplyRefused(Exception): exit_code = 2` with `__init__(self, reasons: list[str])` and `.reasons`, `legacy_authors.py:154-159`.
- Plan entry shape, `legacy_authors.py:117-123`: `{formula_id, old_author, new_author, status, source}`; the plan stores no candidate list (so `_candidates` recomputes from `users.json`).
- Existing prompt style: the injected `ask=input` is called with one positional string (`legacy_authors_ops.py:100`), and the existing test passes `ask=lambda _p: "n"` (`tests/test_legacy_authors_ops.py:107`), so every prompt in this step must call `ask(prompt)` with exactly one positional argument.
- **Not found** (must be created from scratch, no pattern to copy): a numbered-choice picker and a `KEY=VALUE` parser anywhere in the repo (`scripts/manage-users.py` uses Typer, which this stdlib-only wrapper must not import).

**TDD**: `red-green required`

**Covers**: —

**Instructions**:
Constants go after `USERS_SQL` (`:25`); the functions go between `report` (ends `:87`) and `confirm` (`:90`). Stdlib and `la` only; no new import.
1. `_UNRESOLVED = la.APPLY_STATUSES - {"confirmed"}` and `_PICK_ATTEMPTS = 3`, as module constants right after `USERS_SQL` (`:25`).
2. `_candidates(author, users) -> list[str]`: `[uid for uid, u in users.items() if u["is_active"] and u["email_local"].lower() == author.lower()]`. Carry one comment, at most 2 lines, stating the constraint only: it must mirror `la.classify`'s candidate rule (`legacy_authors.py:99-104`), which FR-7 forbids importing or changing, and `test_candidates_match_classify_rule` pins the parity.
3. `_parse_maps(maps, unresolved, users) -> tuple[dict, list[str]]`, pure. For each `raw` in `maps`, in input order, split with `raw.rsplit("=", 1)` (the last `=`) and run these checks in this order, recording at most one reason per entry and moving to the next entry on the first failure. Reason wording is fixed because the acceptance scenarios assert on it:
   1. shape: not two non-empty parts → `f"--map {raw}: expected LEGACY_AUTHOR=USER_ID"`;
   2. `not la.is_uuid(uid)` → `f"--map {raw}: {uid!r} is not a user id (UUID)"`;
   3. `uid not in users` → `f'--map "{author}": user {uid} is not in users.json'`;
   4. `not users[uid]["is_active"]` → `f'--map "{author}": user {uid} is inactive'`;
   5. no entry in `unresolved` has `e["old_author"] == author` (exact, case-sensitive, OQ-3) → `f'no unresolved row has old_author "{author}"'`;
   6. some row of that author has `status == "ambiguous"` and `uid not in _candidates(author, users)` → `f'user {uid} is not a candidate for "{author}"'`;
   7. the author was already mapped to a different uid by an earlier valid entry → `f'"{author}" is mapped to two different users'`. The same author with the same uid twice is accepted.
   An entry with no reason is stored in the returned `mapping` (`{legacy_author: user_id}`). Return `(mapping, reasons)`; the caller decides to abort.
4. `_pick(unresolved, chosen, users, ask) -> dict` returning `{legacy_author: user_id}` for the authors the operator picked. Behavior, in this order:
   - Authors = the distinct `old_author` values of `unresolved` in first-appearance (plan) order, skipping any author already in `chosen`. One offer per author covers all its rows, soft-deleted included.
   - Options: if any of the author's rows has `status == "ambiguous"`, `_candidates(author, users)`; otherwise every active user in `users.json` order (`uid for uid, u in users.items() if u["is_active"]`).
   - No options → `print(f'Skipped: there is no eligible user for "{author}".')`, no prompt, next author.
   - Otherwise print a header line (`f'"{author}": {n} {kind} row(s) - choose its owner:'`, `kind` = `ambiguous` if any row is, else `unmappable`), then one line per option formatted exactly `f"  {i}) {email_local} ({uid})"` (`i` from 1), then ask up to `_PICK_ATTEMPTS` times with `ask(f'Owner for "{author}" [1-{len(options)}, s to skip]: ')`.
   - Answer handling (`.strip().lower()`): `""` or `"s"` → skip the author (no pick). `answer.isdecimal()` and `1 <= int(answer) <= len(options)` → record `picks[author] = options[int(answer) - 1]`. Anything else (`"0"`, `"-1"`, `"abc"`, out of range) consumes an attempt; after `_PICK_ATTEMPTS` invalid answers print `f'No valid answer for "{author}" after {_PICK_ATTEMPTS} attempts; skipped.'` and move on. Never index `options` before the range check.
   - `EOFError` from `ask`: return `picks` immediately. The first EOF skips the current author **and stops the picker for every remaining author** (design.md operator decision); picks already made are kept.
5. Do not touch `confirm`, `main` or `legacy_authors.py` in this step.

**Verification**:
```bash
cd services/xstockstrat-indicators && uv run --extra dev python -c "from app.maintenance import legacy_authors_ops as o; print(sorted(o._UNRESOLVED), o._PICK_ATTEMPTS, o._candidates('x', {}))"   # ['ambiguous', 'unmappable'] 3 []
cd services/xstockstrat-indicators && ruff check . && ruff format --check .
cd services/xstockstrat-indicators && uv run --extra dev pytest tests/test_legacy_authors_ops.py -q   # the 6 pre-existing tests and the Step 2 helper tests pass
git diff --stat -- services/xstockstrat-indicators/app/maintenance/legacy_authors.py   # empty: FR-7
```
C-13 verdict: no test data in this step.

---

### Step 2 — test: helper and picker unit tests

**Status**: `done`
**Service**: `xstockstrat-indicators`
**Files**:
- `services/xstockstrat-indicators/tests/test_legacy_authors_ops.py` — modify

**Reviewers**: Service owner `xstockstrat-indicators` — Formula sandboxing, numeric precision, timeout enforcement (`indicators.sandbox.timeout_ms`), no side-effects from formula execution

**Codebase Evidence**:
- Confirmed via: `cat -n services/xstockstrat-indicators/tests/test_legacy_authors_ops.py` → imports `:5-12` (`json`, `stat`, `pytest`, `la`, `ops`, `USERS, FakeFormulasTable, make_formula_row`); constants `OWNER_ID`, `F1`, `F2`, `GHOST` at `:14-17`; `_UsersAndFormulas` at `:20-30`; the two existing confirm tests at `:62` and `:93` (must stay byte-for-byte unchanged).
- `tests/conftest.py:39-50` `USERS` (users-file entry shape): `davcs86` (`80880990-2b79-4d85-8761-d8d9102c2efb`), `alice` (`1111…`), `bob` (`2222…`), `carol` (`3333…`), `sam` ×2 (`44444444-4444-4444-8444-444444444444`, `55555555-5555-4555-8555-555555555555`, the ambiguous pair) and inactive `olduser` (`66666666-6666-4666-8666-666666666666`).
- `pyproject.toml:34-36`: `testpaths = ["tests"]`, `asyncio_mode = "auto"`.
- `la.classify(rows, users, *, clean=0, run_id=None, target=None)` at `legacy_authors.py:97` takes rows with `formula_id` and `author`; used for the parity test with a one-user dict.
- The acceptance examples differ from `conftest.USERS` (the scenarios say `alice` ×2, inactive `bob`, unmapped `carol`; `USERS` has unique `alice`, `sam` ×2, inactive `olduser`, and `carol` is an active user). Tests use `USERS` and map the scenario roles as: AC "F1"=`GHOST` (`ghost`, unmappable), "F2"=`GHOST_DELETED` (`ghost`, unmappable, soft-deleted), "F3"=`SAM_FID` (`sam`, ambiguous), "F4"=`F1` (`davcs86`, suggested for `OWNER_ID`), "F5"=`ZED` (`zed`, unmappable), inactive target=`olduser`, ambiguous pair=the two `sam` ids. The scenarios stay example values (recon.md § Risks).

**TDD**: `red-green required`

**Covers**: `AC-2, AC-3, AC-4, AC-5, AC-6, AC-7, AC-13, AC-14, AC-15, AC-19, AC-22` — the reason-text and picker legs; the `confirm`/`main()` legs (exit code 2 and byte-identical plan for AC-2, 3, 4, 13, 14, 15; the flow legs of AC-5 and AC-7) are in Step 4.

**Instructions**:
Imports: add `io`, `re`, `sys` to the stdlib block at `:5-6` (alphabetical: `io`, `json`, `re`, `stat`, `sys`). Add constants `GHOST_DELETED = "aaaaaaaa-0000-4000-8000-000000000004"`, `SAM_FID = "aaaaaaaa-0000-4000-8000-000000000005"`, `ZED = "aaaaaaaa-0000-4000-8000-000000000006"` and the user ids `ALICE_ID = "11111111-1111-4111-8111-111111111111"`, `SAM_A = "44444444-4444-4444-8444-444444444444"`, `SAM_B = "55555555-5555-4555-8555-555555555555"`, `OLD_ID = "66666666-6666-4666-8666-666666666666"` (from `tests/conftest.py:42-48`) after `:17`. Do not redefine or edit `OWNER_ID`, `F1`, `F2`, `GHOST`. Append, after `:132`, these module-local helpers (single consumer, stay inline):
- `_users_dict(users=USERS)` → `{u["user_id"]: {"email_local": u["email_local"], "is_active": u["is_active"]} for u in users}` (the `la.load_users` shape).
- `_entry(formula_id, old_author, status, new_author=None)` → plan entry dict with `"source": "heuristic"`.
- `_Ask(*answers)`: callable with `.prompts` (every prompt string seen) that appends the prompt to `.prompts` **before** returning the next answer or raising `EOFError` (when none remain), so a test can assert `len(prompts)` for the call that hit EOF.
- `_listing(out)` → the stdout lines matching `re.compile(r"^\s+\d+\) ")`.

Tests (names indicative; one behavior each, no tautologies):
1. `test_candidates_match_classify_rule` parametrized over the author **strings** `"sam"`, `"SAM"`, `"davcs86"`, `"olduser"`, `"ghost"` (the uppercase `"SAM"` is a string literal, not the formula-id constant `SAM_FID`): `ops._candidates(author, users)` equals the ids for which `la.classify([{"formula_id": GHOST, "author": author}], {uid: u})["entries"][0]["status"] == "suggested"`, evaluated per single-user dict over `_users_dict()`. This is the drift guard.
2. `_parse_maps` (call it with `unresolved = [_entry(GHOST,"ghost","unmappable"), _entry(GHOST_DELETED,"ghost","unmappable"), _entry(SAM_FID,"sam","ambiguous")]` and `_users_dict()`):
   - valid `ghost=<OWNER_ID>` → `({"ghost": OWNER_ID}, [])`; same author twice with the same uid → accepted; `Ghost=<OWNER_ID>` (case differs) → the `no unresolved row has old_author "Ghost"` reason (OQ-3); a legacy author containing `=` (an `unresolved` row `we=ird`, flag `we=ird=<OWNER_ID>`) maps to author `we=ird` (split on the last `=`).
   - rejects, each asserting a substring of the exact reason and an empty mapping: `ghost=<OLD_ID>` → `user 6666… is inactive` (AC-2); `nobody=<OWNER_ID>` → `no unresolved row has old_author "nobody"` (AC-3); `sam=<OWNER_ID>` → `is not a candidate for "sam"` (AC-13); `ghost=99999999-9999-4999-8999-999999999999` (well-formed, absent from the file) → `is not in users.json` (AC-14); `ghost=<OWNER_ID>` plus `ghost=<ALICE_ID>` → `"ghost" is mapped to two different users` (AC-15); malformed `ghost`, `=<OWNER_ID>`, `ghost=` → shape reason; `sam=not-a-uuid` → `is not a user id (UUID)`.
   - `sam=<SAM_A>` and `sam=<SAM_B>` each accepted (the two candidates).
   - `test_parse_maps_collects_every_reason_in_order`: two bad maps (`ghost=<OLD_ID>`, `nobody=<OWNER_ID>`) → `len(reasons) == 2`, in input order (AC-4 batch leg).
3. `_pick` (pass `ask=_Ask(...)`, read stdout with `capsys`):
   - `test_pick_asks_once_per_author_for_all_rows`: `ghost` has two rows (live + soft-deleted), answer `"1"` → `{"ghost": OWNER_ID}` and exactly 1 prompt (AC-5 picker leg; option 1 is `davcs86`, `users.json` order).
   - `test_pick_ambiguous_lists_only_candidates`: unresolved `[SAM_FID]` only, answer `"s"` → `_listing(out)` has exactly 2 lines containing `SAM_A` and `SAM_B`, and neither `OWNER_ID` nor `OLD_ID` appears in `out` (AC-6).
   - `test_pick_unmappable_lists_active_users_in_file_order`: unresolved `[GHOST]`, answer `"s"` → the listed ids equal the active ids of `USERS` in order, `OLD_ID` absent.
   - skip: answers `""`, `"s"`, `"S"` each → `{}`; `chosen={"ghost": OWNER_ID}` → `ghost` not offered (0 prompts).
   - invalid answers `"0"`, `"-1"`, `"abc"`, `"99"` consume attempts: for a single-author plan, three invalid answers → `{}`, `len(ask.prompts) == ops._PICK_ATTEMPTS`, and `"3 attempts"` in `out`; `["abc", "2"]` → the second active user (`alice`, `ALICE_ID`).
   - `test_pick_eof_stops_every_remaining_author` (AC-7 picker leg, AC-22): unresolved `[GHOST, ZED]` with `_Ask()` → `{}`, 1 prompt, and `len(_listing(out)) == len(active users)` i.e. the list is printed once, not per author; with `_Ask("1")` the first pick is kept and the EOF at the second author returns `{"ghost": OWNER_ID}`.
   - `test_pick_skips_author_with_no_eligible_user` (AC-19): users dict without the `sam` entries, unresolved `[SAM_FID]` → `{}`, 0 prompts, `out` contains `there is no eligible user for "sam"`.

**Verification**:
```bash
cd services/xstockstrat-indicators && uv run --extra dev pytest tests/test_legacy_authors_ops.py -q
cd services/xstockstrat-indicators && uv run --extra dev pytest --cov=app --cov-fail-under=50 -q
cd services/xstockstrat-indicators && ruff check . && ruff format --check .
test "$(git diff -U0 -- services/xstockstrat-indicators/tests/test_legacy_authors_ops.py | grep '^+' | grep -c 'email_local": "')" = 0   # C-13: no new inline users literal (run before committing the step)
```
Red run (captured by `/sdd-execute` before Step 1): the new tests fail with `AttributeError: module 'app.maintenance.legacy_authors_ops' has no attribute '_candidates'` (or `_parse_maps` / `_pick`). Green: all pass after Step 1. C-13 verdict: `_users_dict`, `_entry`, `_Ask`, `_listing` have one consumer (this module), so inline is compliant; domain users are imported from `conftest.USERS`.

---

### Step 3 — service: `confirm` resolves unmappable/ambiguous rows; `--map` flag; docstring

**Status**: `done`
**Service**: `xstockstrat-indicators`
**Files**:
- `services/xstockstrat-indicators/app/maintenance/legacy_authors_ops.py` — modify

**Reviewers**: Service owner `xstockstrat-indicators` — Formula sandboxing, numeric precision, timeout enforcement (`indicators.sandbox.timeout_ms`), no side-effects from formula execution

**Codebase Evidence**:
- Confirmed via: `sed -n 90,108p services/xstockstrat-indicators/app/maintenance/legacy_authors_ops.py` → today's `confirm(work: Path, *, yes: bool, ask=input) -> tuple[int, str | None]`: loads the plan with `_load_plan` (`:39`, called at `:92`), `suggested = [e for e in plan["entries"] if e["status"] == "suggested"]` (`:93`), early exit `print("No suggested rows to confirm.")` / `return 0, None` (`:94-96`), `print(format_plan(plan, _users_by_id(work / "users.json")))` (`:97`), prompt `ask(f"Confirm {len(suggested)} suggested rewrite(s)? [y/N] ")` with `EOFError` → `""` (`:98-102`), decline → `return 0, None` (`:103-104`), in-place `e["status"] = "confirmed"` on the same dict objects as `plan["entries"]` (`:105-106`), the **only** write `_write_private(plan_path, json.dumps(plan, indent=2) + "\n")` (`:107`), `return len(suggested), la.plan_digest(plan_path)` (`:108`).
- `main()` at `:136-186`: `for name in ("confirm", "apply"):` adds `--yes/-y` (`:142-144`); `sub.choices["apply"].add_argument("--confirm-digest", required=True)` (`:145`, the per-subparser pattern to mirror); confirm branch `:149-154` (`n, digest = confirm(work, yes=args.yes)`; prints `Confirmed {n} row(s)…` and the digest when truthy; `return 0 if digest or n == 0 else 1`); `run_id` is defined at `:147` before the branch; the apply branch handles refusal at `:181-184`: `except la.ApplyRefused as exc: for reason in exc.reasons: la.log(run_id, f"refused: {reason}"); return la.ApplyRefused.exit_code` (`la.log` prints `[run_id=…] msg` to stdout, `legacy_authors.py:43-44`).
- `_users_by_id` (`:46-50`) is lenient (returns `{}` on any error) and carries no `is_active`, so it is **not** used for validation; `format_plan(plan, users)` (`:53-60`) renders `old -> name (new_author)  [status]` per entry from a `{user_id: email_local}` map.
- Existing tests constrain the signature: `test_confirm_marks_only_suggested_and_returns_digest_of_written_file` (`tests/test_legacy_authors_ops.py:62`) and `test_confirm_declined_leaves_plan_untouched` (`:93`) call `confirm()` with **no `users.json`** in the work dir and assert the `(int, str | None)` return (`n == 1`, `(0, None)`), so `users.json` must be loaded lazily and the return shape must not change.
- Module docstring `:1-9` shows the three usage lines (`:4-6`).

**TDD**: `red-green required`

**Covers**: —

**Instructions**:
1. Add a module constant `_NOTHING_TO_CONFIRM = "No suggested rows to confirm."` (the string is used at two exits below; today's literal at `:95`).
2. Change the signature to `confirm(work: Path, *, yes: bool, maps=(), ask=input) -> tuple[int, str | None]` (return shape unchanged) and rewrite the body in exactly this order:
   1. `plan = _load_plan(plan_path)`; `suggested` as today; `unresolved = [e for e in plan["entries"] if e["status"] in _UNRESOLVED]`.
   2. `need_users = bool(maps) or (bool(unresolved) and not yes)`. If `not suggested and not need_users`: `print(_NOTHING_TO_CONFIRM)`, `return 0, None` (today's string and exit for the true nothing-to-do cases, FR-6).
   3. `users = None`; if `need_users`, `users = la.load_users(work / "users.json")` inside `try/except SystemExit as exc`. On failure: if `maps`, `raise la.ApplyRefused([str(exc)]) from exc` (exit 2, nothing written); otherwise `print(f"WARNING: users.json could not be read; the picker was skipped. ({exc})")` and leave `users = None` (the suggested-only flow continues, `@AC-18`).
   4. `mapping = {}`; if `maps`: `mapping, reasons = _parse_maps(maps, unresolved, users)`; `if reasons: raise la.ApplyRefused(reasons)`. Nothing has been printed or written yet.
   5. `names = {uid: u["email_local"] for uid, u in users.items()} if users is not None else _users_by_id(work / "users.json")`; `print(format_plan(plan, names))`.
   6. `if users is not None and not yes and unresolved: mapping.update(_pick(unresolved, mapping, users, ask))`. With `--yes` the picker is skipped and only `--map` rows resolve (FR-5).
   7. `overrides = [e for e in unresolved if e["old_author"] in mapping]`; in memory, for each: `e.update(new_author=mapping[e["old_author"]], source="override", status="confirmed")`. No write yet.
   8. `if not suggested and not overrides:` `print(_NOTHING_TO_CONFIRM)`, `return 0, None` (everything skipped, or the picker was unavailable and no row is suggested).
   9. `if overrides: print(format_plan(plan, names))` so the written targets are on stdout (FR-5, `@AC-20`); with no overrides the output is identical to today's single listing. This second listing shows the **proposed** final state (`[confirmed]`) before the operator answers the prompt; nothing is written until the answer is `y`.
   10. `if not yes`: ask the **one** combined prompt through `ask` — `f"Confirm {len(suggested)} suggested rewrite(s)? [y/N] "` when `overrides` is empty (today's exact text), `f"Confirm {len(suggested)} suggested and {len(overrides)} override rewrite(s)? [y/N] "` otherwise; `EOFError` → `""`. If the stripped, lowercased answer is not `y`/`yes`: `print("Not confirmed; plan.json unchanged.")`, `return 0, None`.
   11. `for e in suggested: e["status"] = "confirmed"`; `_write_private(plan_path, json.dumps(plan, indent=2) + "\n")` as the **single write site** (every refusal, decline, EOF and skip path above returned or raised before it, so `plan.json` stays byte-identical); `return len(suggested) + len(overrides), la.plan_digest(plan_path)`.
   Do not add other comments than constraints worth keeping (≤ 2 lines each).
3. In `main()`: after `sub.choices["apply"].add_argument(...)` (`:145`) add `sub.choices["confirm"].add_argument("--map", action="append", default=[], metavar="LEGACY=USER_ID", help="resolve every unmappable/ambiguous row of LEGACY to USER_ID (repeatable)")`. Replace the confirm call at `:150` with a `try: n, digest = confirm(work, yes=args.yes, maps=args.map) except la.ApplyRefused as exc: for reason in exc.reasons: la.log(run_id, f"refused: {reason}"); return la.ApplyRefused.exit_code`. Keep the digest printing and `return 0 if digest or n == 0 else 1` unchanged. Do **not** refactor the apply branch (`:181-184`) into a shared helper (rejected in design.md).
4. Module docstring (`:1-9`): extend the `confirm` usage line to `python -m app.maintenance.legacy_authors_ops confirm [--map LEGACY=USER_ID ...] [--yes]` and add one sentence that `confirm` also resolves `unmappable`/`ambiguous` rows (`--map`, then a numbered picker), keeping the existing runbook pointer.
5. Do not modify `legacy_authors.py` (FR-7). The comment budget is unchanged apart from the one in Step 1.

**Verification**:
```bash
cd services/xstockstrat-indicators && ruff check . && ruff format --check .
cd services/xstockstrat-indicators && uv run --extra dev pytest tests/test_legacy_authors_ops.py -q   # Step 2 tests green; the two pre-existing confirm tests (:62, :93) still pass unchanged
cd services/xstockstrat-indicators && uv run --extra dev python -m app.maintenance.legacy_authors_ops confirm --help | grep -- "--map"
git diff --stat -- services/xstockstrat-indicators/app/maintenance/legacy_authors.py   # empty: FR-7
grep -n "_write_private(plan_path" services/xstockstrat-indicators/app/maintenance/legacy_authors_ops.py   # exactly one hit inside confirm
```

---

### Step 4 — test: `confirm` flow and `main()` exit codes

**Status**: `done`
**Service**: `xstockstrat-indicators`
**Files**:
- `services/xstockstrat-indicators/tests/test_legacy_authors_ops.py` — modify

**Reviewers**: Service owner `xstockstrat-indicators` — Formula sandboxing, numeric precision, timeout enforcement (`indicators.sandbox.timeout_ms`), no side-effects from formula execution

**Codebase Evidence**:
- Confirmed via: `grep -n "^def test_\|^async def test_" services/xstockstrat-indicators/tests/test_legacy_authors_ops.py` → `test_confirm_marks_only_suggested_and_returns_digest_of_written_file` (`:62`), `test_confirm_declined_leaves_plan_untouched` (`:93`), `test_apply_rewrites_and_echoes_result_before_restart` (`:111`) drives `report` → `confirm(tmp_path, yes=True)` → `apply` against `FakeFormulasTable`, the pattern for the apply-guard test.
- No test calls `main()` with argv today (recon.md § Risks), so the exit-code mapping at `legacy_authors_ops.py:154` is untested.
- `_UsersAndFormulas.fetch` answers `ops.USERS_SQL` with the **active** users only (`tests/test_legacy_authors_ops.py:23-30`), so `report` writes a `users.json` without `olduser`.
- `main(argv=None) -> int` accepts an argv list; `--work-dir` is a top-level option placed before the subcommand (`:138`); `_work_dir` creates the directory with `exist_ok=True` (`:33-36`).
- The default `ask=input` is bound when `confirm` is defined, so patching `builtins.input` would not reach it; a `main()` test must replace `sys.stdin` (`monkeypatch.setattr(sys, "stdin", io.StringIO(""))`, whose `readline()` returns `""`, so the builtin `input` raises `EOFError`).
- Output lines to assert on come from `format_plan` (`:58`): `f"  {formula_id}  {old_author} -> {who}  [{status}]"` with `who` = `davcs86 (<OWNER_ID>)` for a resolved row.

**TDD**: `red-green required`

**Covers**: `AC-1, AC-2, AC-3, AC-4, AC-5, AC-7, AC-8, AC-9, AC-10, AC-11, AC-13, AC-14, AC-15, AC-16, AC-17, AC-18, AC-20, AC-21`

**Instructions**:
Add `_seed(tmp_path, entries, users=USERS)` (writes `plan.json` as `json.dumps({"entries": entries})` and, when `users is not None`, `users.json` as `json.dumps(users)`; returns the plan bytes for byte-identity assertions; reuse `_entry`/`_Ask` from Step 2). A standard unresolved plan is `[GHOST ghost unmappable, GHOST_DELETED ghost unmappable, SAM_FID sam ambiguous]`. Tests, with the scenario role mapping from Step 2:
1. `@AC-1`: `confirm(tmp_path, yes=True, maps=[f"ghost={OWNER_ID}"])` → `n == 2`; `GHOST` and `GHOST_DELETED` have `new_author == OWNER_ID`, `source == "override"`, `status == "confirmed"`; `SAM_FID` is still `ambiguous`; the digest equals `la.plan_digest(plan.json)`; `plan.json` mode is `0o600`.
2. `@AC-5`: `ask=_Ask("1", "s", "y")` (`yes=False`) → the same two rows resolved to `OWNER_ID` (`davcs86` is option 1), `SAM_FID` ambiguous, exactly 3 prompts (picker `ghost`, picker `sam`, confirmation), `n == 2`.
3. `@AC-7` (flow leg): `ask=_Ask()` (EOF at the first prompt), unresolved plan → `(0, None)`, plan byte-identical, and `len(ask.prompts) == 1` (this is the assertion that is red before Step 3).
4. `@AC-8` + `@AC-21`: `maps=[f"ghost={OWNER_ID}"]`, `ask=_Ask("s", "n")` → `(0, None)`, plan byte-identical, stdout contains `Not confirmed; plan.json unchanged.`; also an `EOF` at the confirmation (`_Ask("s")`) prints the same line and writes nothing.
5. `@AC-9` (green-on-arrival guard, preserved behavior): `confirm(tmp_path, yes=True)` on the unresolved plan → `(0, None)`, plan byte-identical, `ask` never called (`_Ask().prompts == []`). Passes on both trees; the step's red gate is carried by tests 1-4 and 6-12.
6. `@AC-10`: plan with only `GHOST`, `GHOST_DELETED`; `maps=[f"ghost={OWNER_ID}"]`, `yes=True` → stdout does not contain `No suggested rows to confirm`; both rows `confirmed`.
7. `@AC-16`: plan adds `_entry(F1, "davcs86", "suggested", OWNER_ID)`; `maps=[f"ghost={ALICE_ID}"]`, `yes=True` → `F1` `confirmed`; `GHOST`/`GHOST_DELETED` `confirmed` with `source == "override"` and `new_author == ALICE_ID`; `SAM_FID` ambiguous; `n == 3`.
8. `@AC-17`: same plan, `maps=[f"ghost={OWNER_ID}"]`, `ask=_Ask("s", "y")` → `F1`, `GHOST`, `GHOST_DELETED` confirmed; exactly one prompt contains `Confirm`, and it reads `Confirm 1 suggested and 2 override rewrite(s)? [y/N] `.
9. `@AC-18`: `_seed(..., users=None)` (no `users.json`), plan `[F1 suggested, GHOST unmappable]`, `ask=_Ask("y")` → stdout contains `users.json could not be read` and `picker was skipped`; `F1` `confirmed`, `GHOST` `unmappable`; only the confirmation prompt was asked; digest not `None`.
10. `@AC-20`: covered inside the `main()` test (13) because "before the digest" needs the printed digest; at flow level assert stdout contains `f"  {GHOST}  ghost -> davcs86 ({OWNER_ID})  [confirmed]"` and the same for `GHOST_DELETED`.
11. FR-2 (no `@AC`): `confirm(..., maps=[f"ghost={OWNER_ID}"])` with `users.json` missing, and again malformed (`"{"`), → `pytest.raises(la.ApplyRefused)` with a reason starting `cannot read users file`, plan byte-identical.
12. `@AC-11`: `table = _UsersAndFormulas([make_formula_row(GHOST, "ghost"), make_formula_row(GHOST_DELETED, "ghost", deleted=True), make_formula_row(SAM_FID, "sam")])`; `await ops.report(table, ("h", "d"), tmp_path, run_id="r1")`; `n, digest = ops.confirm(tmp_path, yes=True, maps=[f"ghost={OWNER_ID}", f"sam={SAM_A}"])` → `n == 3`; `result = await ops.apply(table, ("h", "d"), tmp_path, digest, run_id="r2")` raises nothing, `result["counts"]["rewritten"] == 3`, `skipped_concurrent == 0`, the three rows' authors equal `OWNER_ID`, `OWNER_ID`, `SAM_A`, and captured stdout has no `refused:`.
13. `main()`-level, using `ops.main(["--work-dir", str(tmp_path), "confirm", ...])` and `capsys`:
    - success (`@AC-1` printed digest, `@AC-20` ordering): `["--map", f"ghost={OWNER_ID}", "--yes"]` → returns `0`; stdout contains `Confirmed 2 row(s)` and `la.plan_digest(plan.json)`, and the line `ghost -> davcs86 ({OWNER_ID})  [confirmed]` occurs at an index before the digest.
    - refusal, parametrized over the maps below, each passed as repeated `--map` flags with `--yes` → `main` returns `2`; stdout has at least one `[run_id=…] refused: <reason>` line containing the listed substring; `plan.json` byte-identical; `GHOST` and `GHOST_DELETED` still `unmappable` and `SAM_FID` still `ambiguous`:
      - `@AC-2`: `ghost={OLD_ID}` → `inactive`
      - `@AC-3`: `nobody={OWNER_ID}` → `no unresolved row has old_author "nobody"`
      - `@AC-4`: `ghost={OWNER_ID}` + `sam=not-a-uuid` → `is not a user id` (also proves `--map` is repeatable and that the valid map is not applied)
      - `@AC-13`: `sam={OWNER_ID}` → `is not a candidate for "sam"`
      - `@AC-14`: `ghost=99999999-9999-4999-8999-999999999999` → `is not in users.json`
      - `@AC-15`: `ghost={OWNER_ID}` + `ghost={ALICE_ID}` → `"ghost" is mapped to two different users`
    - EOF (`@AC-7` exit code): `monkeypatch.setattr(sys, "stdin", io.StringIO(""))`, argv `["confirm"]` → returns `0`, plan byte-identical, stdout contains `f"1) davcs86 ({OWNER_ID})"` (the picker ran; red before Step 3 since there is no picker). The `0` return alone is also true on the old tree.
Do not edit the two pre-existing confirm tests.

**Verification**:
```bash
cd services/xstockstrat-indicators && uv run --extra dev pytest tests/test_legacy_authors_ops.py -q
cd services/xstockstrat-indicators && uv run --extra dev pytest --cov=app --cov-fail-under=50 -q
cd services/xstockstrat-indicators && ruff check . && ruff format --check .
grep -n "from tests.conftest import" services/xstockstrat-indicators/tests/test_legacy_authors_ops.py   # C-13: USERS/make_formula_row/FakeFormulasTable still imported from conftest
test "$(git diff -U0 -- services/xstockstrat-indicators/tests/test_legacy_authors_ops.py | grep '^+' | grep -c 'email_local": "')" = 0   # C-13: no new inline users literal (run before committing the step)
```
Red run (before Step 3): `TypeError: confirm() got an unexpected keyword argument 'maps'` for tests that pass `maps=`, `SystemExit` (argparse: unrecognized `--map`) for the `main()` tests, and failed prompt-count / listing assertions for the picker tests. Green after Step 3. C-13 verdict: `_seed` and the scenario constants are single-consumer, inline in this module; no duplicate `USERS`-style literal is introduced.

---

### Step 5 — docs: runbook intro and §5 describe `confirm --map` and the picker

**Status**: `done`
**Service**: `docs/runbooks/`
**Files**:
- `docs/runbooks/legacy-formula-authors.md` — modify

**Reviewers**: none

**Codebase Evidence**:
- Confirmed via: `cat -n docs/runbooks/legacy-formula-authors.md` → wrapper paragraph `:13-21` (`:18-21` says `confirm` "only marks `suggested` rows `confirmed`" and that overrides "are still a hand edit of `plan.json` before `confirm`"); command block `:23-27`; §5 `## 5. Step B: report, then edit the plan` at `:102-126`, whose bullets at `:117-126` describe `suggested` → `confirmed`, the `unmappable`/`ambiguous` override by hand edit (`:121-124`), and "Do not change `formula_id` or `old_author`" (`:125-126`); §6 apply pre-flight refusals `:150-157` (that list is apply's, not confirm's).
- Behavior to document is in Step 3: exit codes (`0` success/decline/EOF/nothing to confirm, `2` invalid `--map`), refusal line shape `[run_id=…] refused: <reason>` (same as apply, `legacy_authors_ops.py:181-184`), the single combined prompt, `Not confirmed; plan.json unchanged.`
- Design.md § Docs (FR-8) lists the required runbook content; `docs/runbooks/CLAUDE.md:17` index row for this runbook stays accurate (it already names the wrapper and "report/confirm/apply"), so no index edit.
- `docs/sdd/constitution.md` C-10(c)/design.md: the candidate rule is enforced at `confirm` only; `validate_for_apply` (`legacy_authors.py:162-190`) does not re-check it, so the runbook must not claim apply-time enforcement.

**TDD**: `N/A (docs)`

**Covers**: `AC-12` — doc check (also verified at impl-review per design.md).

**Instructions**:
1. Intro (`:18-21`): replace the sentence that `confirm` only marks `suggested` rows and that overrides are "still a hand edit" with: `confirm` marks `suggested` rows `confirmed` and can resolve `unmappable`/`ambiguous` rows (`--map`, then a numbered picker); `apply` still needs the printed digest passed explicitly. Add the `confirm --map LEGACY=USER_ID --yes` example to the command block (`:23-27`).
2. §5: add the wrapper flow (keep the direct-CLI report commands), covering:
   - `confirm --map <legacy_author>=<user_id>`, repeatable; split on the **last** `=`; matches the stored `old_author` **exactly** (case-sensitive) and resolves every `unmappable`/`ambiguous` row of that author, soft-deleted included; the target must be an **active** user in `users.json`, and for an `ambiguous` author one of its matched candidates.
   - Any invalid `--map` (malformed, unknown, inactive, no matching unresolved row, not a candidate, one author mapped to two users, or a missing/malformed `users.json`) aborts with **exit 2**, one `[run_id=…] refused: <reason>` line per reason, and `plan.json` byte-identical.
   - What is left is offered once per legacy author in a numbered picker (`s` or Enter skips; the first EOF stops the picker for all remaining authors; three invalid answers skip the author). An `ambiguous` author lists only its candidates, an `unmappable` author lists all active users in `users.json` order. If `users.json` is unreadable and no `--map` was given, the picker is skipped with a warning and the `suggested` rows still run.
   - There is **one** confirmation prompt covering `suggested` and resolved rows; declining or EOF prints `Not confirmed; plan.json unchanged.` and exits 0. **`--yes --map` is the only scripted path**; `--yes` alone confirms `suggested` rows and never resolves another row. A piped `y` against a plan with unresolved rows lands on the picker, not the confirmation, and writes nothing.
   - PII: the picker prints every active user's email local part and id and the plan listing prints legacy usernames, so use `--map` when the console session is recorded or shared. A malformed `users.json` entry's message echoes that entry once (`legacy_authors.py:76` is out of scope for this feature).
   - The counts line shown is the report's and is not recomputed; resolved rows are listed by `format_plan`, and the second listing shows the proposed final state (`[confirmed]`) before the prompt is answered.
   - Scope of 276's "left unchanged": the automatic fix never guesses; an override is an explicit operator action. The ambiguous-candidate rule is enforced by `confirm` only, **not** by `apply` (`validate_for_apply` does not re-check it), so a hand-edited `plan.json` can still bypass it.
   - Hand-editing `plan.json` is retained only as a **fallback** (for example to override a wrong `suggested` match, which `--map` does not touch), with the existing `new_author` / `"source": "override"` / `"status": "confirmed"` recipe and the "Do not change `formula_id` or `old_author`" rule kept.
3. Leave §§1-4 and 6-10 unchanged, except that no sentence elsewhere may still say overrides need a hand edit (grep below).

**Verification**:
```bash
grep -n -e "--map" -e "picker" docs/runbooks/legacy-formula-authors.md        # intro and §5 both hit
grep -n -i "hand.edit" docs/runbooks/legacy-formula-authors.md               # every hit is the fallback note; none may say overrides need a hand edit
grep -n -i "fallback" docs/runbooks/legacy-formula-authors.md                  # hand edit named only as a fallback
grep -n -i "apply" docs/runbooks/legacy-formula-authors.md | grep -i "candidate"   # any hit must say apply does NOT enforce the rule
./scripts/check-context-map.sh                                                 # all doc references resolve
```

---

### Step 6 — docs: indicators `CLAUDE.md` § Maintenance and teardown audit

**Status**: `done`
**Service**: `xstockstrat-indicators`
**Files**:
- `services/xstockstrat-indicators/CLAUDE.md` — modify
- `docs/runbooks/legacy-formula-authors.md` — modify, **conditional**: edit only if the teardown audit finds drift against the final code
- `services/xstockstrat-indicators/docs/context-constitution.md` — modify, **conditional**: edit only if the `INDICATORS-12` re-read finds drift (expected: no edit)
- `docs/roadmap/features/284-legacy-authors-confirm-resolve/context.md` — append-only log entry (Instruction 3)

**Reviewers**: none

**Codebase Evidence**:
- Confirmed via: `grep -n -i "maintenance\|legacy_authors" services/xstockstrat-indicators/CLAUDE.md` → `## Maintenance` at `:232`; the single paragraph at `:234` already says `app.maintenance.legacy_authors_ops` "wraps it as `report` → `confirm` → `apply`"; the two-line code block `:236-239` lists the direct CLI (`--users … --out`, `--apply …`), not the wrapper.
- `services/xstockstrat-indicators/docs/context-constitution.md:29` (`INDICATORS-12`): "Repair only through `app.maintenance.legacy_authors`, whose rewrite UPDATE carries the system/UUID guard in the SQL", citing `legacy_authors.py:32-36` and the runbook. That file and rule are not modified by this feature, so the row is expected to stay accurate (recon.md: "needs a re-read").
- Root `CLAUDE.md` § Teardown: a changed `CLAUDE.md` or a change to behavior the context files describe requires `/context-forge:context-constitution refresh` scoped to what was touched; when the plugin is unavailable the PR body must say so **and** record the manual reconciliation. `.agents/context-forge.json` → `scrubberExtraTargets` is `["README.md", "docs/patterns/ui-ux-governance.md"]` (neither is touched).
- CI `markdownlint` runs on `**/CLAUDE.md` with `.markdownlint.yaml` (MD013, MD033, MD041, MD060 disabled).

**TDD**: `N/A (docs)`

**Covers**: —

**Instructions**:
1. In the `## Maintenance` paragraph (`:234`) extend the sentence about the wrapper in place: state that `confirm` also resolves `unmappable`/`ambiguous` rows through repeatable `--map LEGACY=USER_ID` and a numbered picker (targets must be active users in `users.json`; an ambiguous author accepts only its candidates; an invalid `--map` exits 2 with `plan.json` untouched), and that the candidate rule is enforced at `confirm` only. Keep it one paragraph (the file's existing style) and point at the runbook §5 rather than restating it. Do not touch the code block unless adding the one-line wrapper example `uv run python -m app.maintenance.legacy_authors_ops confirm --map LEGACY=USER_ID --yes`.
2. Teardown audit: run `/context-forge:context-constitution refresh` scoped to `docs/runbooks/legacy-formula-authors.md`, `services/xstockstrat-indicators/CLAUDE.md` and `services/xstockstrat-indicators/docs/context-constitution.md:29`, and fix the grounded drift it reports. If the plugin is unavailable, do the equivalent by hand: re-read those three against the final `legacy_authors_ops.py` (flag name, exit codes, prompt text, EOF behavior, lazy `users.json`) and `legacy_authors.py` (frozen), reconcile any drift, and record in the PR body **both** that the plugin was unavailable **and** the reconciliation performed. `INDICATORS-12` is expected to need no edit (the sole repair entry point and the SQL guard are unchanged); if the re-read finds otherwise, record a Deviation Log entry and edit that row in this step's follow-up, never silently.
3. Append the outcome (plugin run or manual reconciliation, and the `INDICATORS-12` verdict) to this feature's `context.md` so the PR body can quote it.

**Verification**:
```bash
grep -n -e "--map" -e "picker" services/xstockstrat-indicators/CLAUDE.md          # § Maintenance mentions the new flow
grep -c "legacy_authors_ops" services/xstockstrat-indicators/CLAUDE.md             # wrapper still described
./scripts/check-context-map.sh                                                     # references resolve
# CI markdownlint (`**/CLAUDE.md`, .markdownlint.yaml) runs on the PR; if `npx markdownlint-cli2` is available locally:
# npx markdownlint-cli2 --config .markdownlint.yaml services/xstockstrat-indicators/CLAUDE.md
```

---

## Deviation Log

### D-1 — Step 2: `io` and `sys` imports deferred to Step 4
- **Spec said**: Step 2 adds `io`, `re`, `sys` to the test module's stdlib imports.
- **Actual**: Step 2 adds only `re`; `io` and `sys` arrive in Step 4.
- **Why**: nothing in Step 2 uses `io` or `sys` (they serve the `main()` EOF test in Step 4), so adding them now fails `ruff check` with F401 — the step's own lint gate.
- **Disposition**: in-scope lint correctness for the step's own lines; no behavior or coverage change.
