# Implementation Spec: fix-legacy-formula-authors

**Status**: `pending`
**Created**: 2026-10-22
**Feature**: `docs/roadmap/features/276-fix-legacy-formula-authors/feature.md`
**Total Steps**: 9
**Feature Branch**: `feature/fix-legacy-formula-authors`

---

## Execution Summary

Chosen approach (design.md, operator-approved 2026-10-22): an operator-run maintenance CLI in `xstockstrat-indicators` (`python -m app.maintenance.legacy_authors`) with a zero-write REPORT mode and a digest-confirmed APPLY mode. No migration, RPC, proto change, startup hook or config key. Order: (1-2) the additive `manage-users.py list-users --json` users export; (3-4) the CLI core: constants, detection, classification, plan file, report mode; (5-6) apply mode: pre-flight refusals, DB re-derivation, SQL-guarded compare-and-set; (7) servicer read-path regression (AC-1 and AC-6, cold cache and stale-cache); (8-9) runbook and context docs.

Each `service` step is followed by its `test` step. Every test step is authored to fail on the pre-implementation tree (the module or flag does not exist yet; `/sdd-execute` captures the red run first, P-06).

Consumer surfaces (C-14): `None - internal/platform-only`. Decision, not omission: no UI code, Agent tool or `strat-lab` change. The owner regains access because the stored `author` becomes their user id, which the unchanged read guard (`_can_read_formula`, `servicer.py:141`, FR-6) already accepts. Deferred product-spec checks resolved: `grep -n -i "author" plugins/strat-lab/skills/backtest/SKILL.md` finds only the private-formula note at `:78` (formulas are private to the author), which this feature does not change, so no skill edit is required. The UI formula pickers read the same RPC; no change.

Out of scope: feature 275 reporting surfaces; `_can_read_formula`; `UpdateFormula`/`DeleteFormula`; any production or staging data change during speccing.

### Scenario Coverage (C-15)

| Scenario | Step(s) |
|---|---|
| @AC-1 owner regains access | 6 (data leg: rewrite sets the user id), 7 (servicer read path with cold cache, plus stale-cache negative) |
| @AC-2 beyond staging ids, soft-deleted included | 4 |
| @AC-3 unmappable left unchanged and reported | 4 |
| @AC-4 second run changes nothing; system/user-id rows untouched | 6 |
| @AC-5 report-only counts | 4 |
| @AC-6 repair does not widen read access | 7 |
| @AC-7 ambiguous left unchanged and reported | 4 |
| @AC-8 concurrent writes not lost | 6 |
| @AC-9 apply refuses without digest-matched, fully-confirmed plan; system/UUID never touched | 6 |

### Constitution / governance notes

- C-03: the CLI has no originating request, so no `x-trace-id` exists; a `run_id` is stamped on logs and artifacts (the minted-context case the 2026-10-21 operator decision allows). No outbound gRPC call is added, so the header-propagation constraint (step-constraints §B) is not triggered.
- C-10(c): the system/UUID guard is inside the apply UPDATE, plus pre-flight refusal and DB re-derivation. P-03: heuristic matches are `suggested` only. F-06: runbook pins the pooled `:25061` URL with `DB_PGBOUNCER=true`.
- C-13 (non-frontend test data): `FakeFormulasTable` and the user fixtures have a second consumer after Step 6 (Steps 4, 6, 7), so they live in `tests/conftest.py` from Step 4 on, never as inline copies.
- Approval flow: a DB data change needs DBA + service-owner sign-off, captured in the DBA change record (runbook, Step 8). No migration, so no `NNN` is allocated (indicators tip stays `007`, `ls services/xstockstrat-indicators/migrations/`).
- `uv.lock`: no dependency is added (argparse, json, hashlib, re, asyncpg already present), so `uv lock` is not needed.

## Step Dependencies

- Step 2 [test] covers Step 1 [service]. Step 4 [test] covers Step 3 [service]. Step 6 [test] covers Step 5 [service].
- Step 3 is independent of Steps 1-2 at code level, but the users-file shape (`user_id`, `email_local`, `is_active`) is fixed in Step 1 and consumed in Step 3.
- Step 5 requires Step 3: apply reuses `detect`, the plan format and the SQL constants.
- Step 4 creates `FakeFormulasTable` in `tests/conftest.py`; Steps 6 and 7 import it.
- Step 7 [test] depends on Step 6: it drives the real `apply` against the fake, then reads through `IndicatorsServicer`.
- Step 8 (runbook) requires Steps 3 and 5 (flag names, file formats, refusal messages). Step 9 requires Step 8 (runbook path).
- Feature 275 and features 268/269/244 touch `servicer.py`; this feature does not edit it (rebase-only overlap, none here).

---

### Step 1 — service: `manage-users.py list-users --json` users export

**Status**: `pending`
**Service**: `scripts/` (operator tooling; identity data export)
**Files**:
- `scripts/manage-users.py` — modify

**Reviewers**: Security — PII minimisation (email local part only, no roles); no service owner (identity is not an affected service)

**Codebase Evidence**:
- Confirmed via: `grep -n 'list-users' scripts/manage-users.py` → `@app.command("list-users")` at `:270`; options `--active-only` at `:272-277`; query `"SELECT email, roles, is_active, created_at FROM identity.users "` at `:283-286`, `WHERE is_active = TRUE ` appended at `:288`, `ORDER BY created_at` at `:289`.
- `identity.users` has `user_id UUID PRIMARY KEY`, `email TEXT NOT NULL UNIQUE`, `is_active` — `services/xstockstrat-identity/migrations/001_identity_tables.up.sql:7-12`. Identity has no username field (`packages/proto/identity/v1/identity.proto:174-180`, recon.md), so the export carries the email local part only.
- Existing table path unpacks 4-tuples `(email, roles, is_active, created_at)` and is asserted by `scripts/tests/test_manage_users.py:371-411` (`TestListUsersCmd`). It must not change.
- `_load_db_url` fallback (`.env`/localhost) at `:62-78` is deliberately NOT reused by the new CLI (Step 3); `list-users` keeps its existing behavior.

**TDD**: `red-green required`

**Covers**: —

**Instructions**:
1. Add a `--json` flag (`json_out: bool`, `typer.Option(False, "--json", help=...)`) to `list_users` (`:271`). `import json` at the top of the file.
2. When `--json` is set, run a separate query `SELECT user_id, email, is_active FROM identity.users` (plus `WHERE is_active = TRUE ` when `--active-only`) `ORDER BY created_at`, so the existing 4-column table query and its tests are untouched.
3. Print to stdout a JSON array only (no rich table, no panel on success) of objects `{"user_id": str(user_id), "email_local": email.split("@", 1)[0], "is_active": bool}`. Never emit the full email or roles (C-18 / PII minimisation). Empty result prints `[]` and exits 0. Error panels keep going to `err` (stderr) so stdout stays valid JSON.

**Verification**:
`uv run scripts/manage-users.py list-users --help` shows `--json`; unit verification in Step 2.

---

### Step 2 — test: `list-users --json` output contract

**Status**: `pending`
**Service**: `scripts/tests/`
**Files**:
- `scripts/tests/test_manage_users.py` — modify (add a class `TestListUsersJson`)

**Reviewers**: none beyond Security — PII minimisation

**Codebase Evidence**:
- Existing pattern: `TestListUsersCmd` at `scripts/tests/test_manage_users.py:371` uses `@patch("psycopg.connect")`, `_mock_conn()` (`:60-73`), `conn.execute.return_value.fetchall.return_value = [...]` and `runner.invoke(mu.app, ["list-users", ...])`; the `FAKE_UUID`/`FAKE_NOW` constants at `:52-53`.
- Test-data (C-13): single consumer (this class); inline rows compliant.

**TDD**: `red-green required`

**Covers**: `AC-5` (partially: the users-file input that report mode classifies against; report behavior asserted in Step 4)

**Instructions**:
Add tests (RED against the tree where `--json` does not exist; exit code 2 from typer):
- `test_json_emits_only_id_local_part_and_active`: rows `(FAKE_UUID, "Alice@Example.com", True)`; `json.loads(result.stdout)` equals `[{"user_id": str(FAKE_UUID), "email_local": "Alice", "is_active": True}]`; assert `"@" not in result.stdout` and `"roles" not in result.stdout`.
- `test_json_active_only_filter`: `--json --active-only`; the executed query contains `WHERE is_active = TRUE` and selects `user_id`.
- `test_json_empty_prints_empty_array`: `[]`, exit 0.
- `test_table_path_unchanged`: existing `test_lists_users` still passes (no edit to it).

**Verification**:
`uv run --with pytest --with typer --with bcrypt --with "psycopg[binary]" --with questionary pytest scripts/tests/test_manage_users.py -v` (the file header declares the same inline deps); `ruff check scripts/ && ruff format --check scripts/manage-users.py scripts/tests/test_manage_users.py` (CI runs `ruff check .` and a format check, `.github/workflows/ci.yml:324-327`).

---

### Step 3 — service: legacy-author CLI core (detection, classification, plan, report mode)

**Status**: `pending`
**Service**: `xstockstrat-indicators`
**Files**:
- `services/xstockstrat-indicators/app/maintenance/__init__.py` — create (empty)
- `services/xstockstrat-indicators/app/maintenance/legacy_authors.py` — create

**Reviewers**: xstockstrat-indicators owner — no side-effects from formula execution; DB data-change safety (service owner, reviewer-registry `service` row)

**Codebase Evidence**:
- Confirmed via: `grep -n "SYSTEM_AUTHOR" services/xstockstrat-indicators/app/formulas/__init__.py` → `:5` `SYSTEM_AUTHOR = "system"`.
- Confirmed via: `services/xstockstrat-indicators/app/main.py:50-58` — `asyncpg.create_pool(DATABASE_URL, ..., statement_cache_size=0 if os.environ.get("DB_PGBOUNCER") in ("true", "1") else 100)`. The CLI uses ONE `asyncpg.connect` with the same cache rule; `main.py` is not edited and no pool is extracted (design: F-04, no false reuse).
- Column facts: `formula_id UUID PRIMARY KEY`, `author TEXT NOT NULL`, `updated_at` — `migrations/001_formulas.up.sql:4-11`; `deleted_at` — `migrations/005_add_formula_soft_delete.up.sql:5` (detection must not filter on it: `get_by_id` has no `deleted_at` filter, `formulas_repository.py:183-188`, whereas `list_visible`/`list_owned` filter `deleted_at IS NULL` at `:190-201`).
- Operator-CLI shape reference: `scripts/manage-users.py` (typer there; indicators has no typer dependency — `pyproject.toml:6-18` — so this module uses stdlib `argparse`).
- Run-site: `services/xstockstrat-indicators/CLAUDE.md` "Running Locally" uses `uv run python -m app.main`; the CLI mirrors it as `uv run python -m app.maintenance.legacy_authors`.
- Coverage omit list (`pyproject.toml` `[tool.coverage.run] omit`) lists `app/main.py`, `servicer.py` etc.; the new module is NOT added to it (it is tested).
- **Not found**: any existing detection/report code for non-user-id authors (recon.md "No existing detection/report code").

**TDD**: `red-green required`

**Covers**: —

**Instructions**:
Create `legacy_authors.py` with these pieces (names are the contract the tests in Steps 4/6/7 import):

1. Constants. `UUID_RE = r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$"` (used both as a Python `re` pattern with `re.IGNORECASE` and as the Postgres `!~*` pattern). SQL text constants, each a module-level string so a test can parse them:
   - `DETECT_SQL = "SELECT formula_id, author, deleted_at, updated_at FROM indicators.formulas WHERE author <> $1 AND author !~* $2 ORDER BY formula_id"` with args `(SYSTEM_AUTHOR, UUID_RE)`; no `deleted_at` filter.
   - `CLEAN_COUNT_SQL = "SELECT count(*) FROM indicators.formulas WHERE author = $1 OR author ~* $2"` (complementary predicate, soft-deleted included).
   - `REWRITE_SQL = "UPDATE indicators.formulas SET author = $1 WHERE formula_id = $2::uuid AND author = $3 AND author <> $4 AND author !~* $5 RETURNING formula_id"` with args `(new, formula_id, old, SYSTEM_AUTHOR, UUID_RE)`. It never references `is_public` and never sets `updated_at` (content stamp, `_UPDATE_SQL` `formulas_repository.py:74-80`). The guard lives in the SQL itself (C-10(c)). Shape follows the compare-and-set of `resolve_intent` (`formulas_repository.py:137-149`).
2. `async def connect(env=os.environ)`: `DATABASE_URL` REQUIRED; missing or empty raises/exits non-zero with a message, with NO `.env` or localhost fallback. `asyncpg.connect(url, statement_cache_size=0 if env.get("DB_PGBOUNCER") in ("true", "1") else 100)`. Returns the connection and `(host, dbname)` parsed with `urllib.parse.urlsplit` (never log the password). Both modes print the target host and db before doing anything.
3. `load_users(path) -> dict`: reads the Step 1 JSON array; each entry must have `user_id` (a UUID per `UUID_RE`), `email_local`, `is_active`; malformed file exits non-zero.
4. `async def detect(conn) -> list[dict]`: runs `DETECT_SQL`; rows normalised to `{"formula_id": str, "author": str, "deleted": bool, "updated_at": iso}`.
5. `classify(rows, users) -> dict`: per DISTINCT legacy author (byte-exact `old_author` kept for the compare-and-set), candidates = ACTIVE users whose `email_local.lower() == author.lower()`. Exactly 1 → `status: "suggested"`, `new_author: user_id`, `source: "heuristic"`; 0 → `"unmappable"`, `new_author: null`; 2+ → `"ambiguous"`, `new_author: null`. An upper-case UUID is not legacy (the detection regex is case-insensitive). The plan: `{"run_id": uuid4 str, "target": {"host", "db"}, "counts": {"rewritable": n, "unmappable": n, "ambiguous": n, "clean": n}, "entries": [{"formula_id", "old_author", "new_author", "status", "source"}]}`, one entry per formula row (soft-deleted included). `suggested` is never applied as-is (FR-3/P-03).
6. `plan_digest(path) -> str`: sha256 hex of the plan file's exact bytes.
7. `async def run_report(conn, users, out_path) -> dict`: runs `detect` and `CLEAN_COUNT_SQL`, writes the plan JSON to `out_path`, prints counts and the sha256 digest. Executes only SELECTs (zero writes; FR-5, AC-5).
8. `main(argv=None)` with `argparse`: `--users PATH` (required), `--out PATH` (report mode), `--apply`, `--plan PATH`, `--confirm-digest HEX` (apply mode is Step 5). Default mode is REPORT; `asyncio.run`. A `run_id` is stamped on every log line (C-03: no inbound request, so no `x-trace-id`).
9. `if __name__ == "__main__": raise SystemExit(main())`.

**Verification**:
`cd services/xstockstrat-indicators && uv run python -m app.maintenance.legacy_authors --help` lists the flags (needs no DB); lint in Step 4.

---

### Step 4 — test: classification, plan builder, report mode, SQL guard text

**Status**: `pending`
**Service**: `xstockstrat-indicators`
**Files**:
- `services/xstockstrat-indicators/tests/conftest.py` — modify (add `FakeFormulasTable`, `make_formula_row`, `USERS`)
- `services/xstockstrat-indicators/tests/test_legacy_authors.py` — create

**Reviewers**: xstockstrat-indicators owner — no side-effects from formula execution; DB data-change safety

**Codebase Evidence**:
- Existing pattern: `tests/conftest.py:21` `ctx_with(metadata, peer_sans=())`, constants `OWNER_HEADERS`/`OTHER_HEADERS` at `:14-15`; `asyncio_mode = "auto"` (`pyproject.toml` `[tool.pytest.ini_options]`), so `async def test_*` needs no marker.
- Existing pattern: `tests/test_formula_read_authz.py:1-30` (module docstring citing the defect report, `_servicer()` helper, `IndicatorsServicer(config_watcher=_cfg())`).
- No real-Postgres harness exists (CI's only Postgres is the migration rerun, `.github/workflows/ci.yml:636-656`, recon/design): the fake must therefore evaluate every predicate of the real SQL.
- Test data (C-13): `FakeFormulasTable` and the user list have consumers in Steps 4, 6 and 7 → canonical home `tests/conftest.py` (created here, not inline per file).

**TDD**: `red-green required`

**Covers**: `AC-2, AC-3, AC-5, AC-7`

**Instructions**:
1. In `tests/conftest.py` add `class FakeFormulasTable`: holds rows `{formula_id, author, deleted_at, updated_at, ...}`; implements `async fetch(sql, *args)`, `async fetchrow(sql, *args)`, `async fetchval(sql, *args)` by dispatching on the module constants `DETECT_SQL`, `CLEAN_COUNT_SQL`, `REWRITE_SQL` and applying EVERY predicate in Python (`formula_id`, `author = $old`, `author <> system`, `!~*`/`~*` UUID regex via `re.IGNORECASE`). It records every statement so tests can count UPDATEs, and exposes `execute_log`. Any unrecognised SQL raises (a drifted statement fails loudly rather than silently passing). It also exposes `mutate(formula_id, **fields)` for interleaving tests.
2. In `tests/test_legacy_authors.py` (module docstring cites the defect report, as `test_formula_read_authz.py` does):
   - `test_detection_includes_soft_deleted_and_skips_system_and_uuid` (AC-2): rows alice live + alice soft-deleted + `system` + a user-id author + an UPPER-CASE UUID author; `detect` returns only the two alice rows.
   - `test_unique_match_is_suggested_with_exact_old_author` (AC-2): `author="Alice"` with user `email_local="alice"` → one entry per row, `status="suggested"`, `new_author` the user id, `old_author` byte-exact `"Alice"`.
   - `test_no_match_is_unmappable` (AC-3) and `test_two_matches_is_ambiguous` (AC-7): `new_author is None`; the report lists formula id and author.
   - `test_inactive_user_is_excluded` (an inactive match → unmappable).
   - `test_report_counts_and_zero_writes` (AC-5): 2 mappable, 1 unmappable, 3 clean (system + user-id + upper-case UUID); `counts == {rewritable: 2, unmappable: 1, ambiguous: 0, clean: 3}`; the fake's log contains no UPDATE and no row changed.
   - `test_sql_text_carries_both_guards`: parse `REWRITE_SQL` text: contains `author <> $4`, `author !~* $5`, `author = $3`, `formula_id = $2::uuid`; contains neither `is_public` nor `updated_at`.
   - `test_connect_requires_database_url_and_prints_target`: no `DATABASE_URL` → non-zero exit and no `.env`/localhost fallback; the target host/db printed never includes the password.
   - `test_pgbouncer_disables_statement_cache`: `DB_PGBOUNCER=true` → `asyncpg.connect` called with `statement_cache_size=0` (monkeypatch `asyncpg.connect`).
3. These fail on the pre-implementation tree (the module does not exist).

**Verification**:
`cd services/xstockstrat-indicators && uv run pytest tests/test_legacy_authors.py -v && uv run pytest --cov=app --cov-fail-under=50 && ruff check . && ruff format --check .`

---

### Step 5 — service: apply mode (pre-flight refusals, DB re-derivation, guarded rewrite, result file)

**Status**: `pending`
**Service**: `xstockstrat-indicators`
**Files**:
- `services/xstockstrat-indicators/app/maintenance/legacy_authors.py` — modify

**Reviewers**: xstockstrat-indicators owner — DB data-change safety; DBA — data rewrite correctness (no migration, but the approval flow requires DBA sign-off on the DB change; reviewer-registry DBA role)

**Codebase Evidence**:
- Confirmed via: `services/xstockstrat-indicators/app/services/formulas_repository.py:137-149` `resolve_intent`: `UPDATE ... WHERE pending_intent_id = $1::uuid AND author = $2 RETURNING formula_id` — the compare-and-set shape `REWRITE_SQL` follows; rows returned = succeeded.
- Confirmed via: write paths refuse system rows and require `user_id == author` — `UpdateFormula` `servicer.py:496,504`, `DeleteFormula` `:599,607` (recon.md). `UpdateFormula` cannot run on a legacy row, so the rewrite is outside the servicer; the RPCs are not touched (`@AC-28` preserved).
- Pending-intent rows are authored by the instantiating user's UUID (`create_pending_copies`, `formulas_repository.py:127-135`), so they are never detected (platform `@AC-18`/`@AC-19`).

**TDD**: `red-green required`

**Covers**: —

**Instructions**:
Add to `legacy_authors.py`:
1. `validate_for_apply(plan, users, plan_path, digest) -> list[str]` (returns refusal reasons; empty = OK). Pre-flight refusals, each leading to exit non-zero with ZERO UPDATEs:
   - `--confirm-digest` missing, or `plan_digest(plan_path) != digest`.
   - any entry whose `status` is not in `{"confirmed", "unmappable", "ambiguous"}` (a leftover `suggested` aborts the whole run).
   - any `confirmed` entry whose `old_author == SYSTEM_AUTHOR` or matches `UUID_RE` (case-insensitive).
   - any `confirmed` entry whose `new_author` is not a UUID, is absent from the users file, or maps to an inactive user.
2. `async def run_apply(conn, users, plan_path, digest, result_path) -> dict`:
   - Run `validate_for_apply` first; on any reason raise `ApplyRefused` (exit code 2) before touching the DB with a write.
   - Re-derive targets from the DB: run `detect(conn)`; the write set is the intersection of `{(formula_id, old_author)}` from `confirmed` plan entries with the live detected `{(formula_id, author)}` set, so a hand edit can never widen it. Confirmed entries missing from the live set are counted `skipped_not_detected`.
   - For each target run `REWRITE_SQL` as one autocommit statement (no transaction, no advisory lock: PgBouncer transaction pooling, recon.md). `RETURNING` empty = `skipped_concurrent` (AC-8); otherwise record `rewritten`.
   - Write `result_path` (default `<plan>.result.json`): `run_id`, target host/db, per rewritten row `{formula_id, old_author, new_author}`, and counts `{rewritten, skipped_concurrent, skipped_not_detected, unmappable, ambiguous}`. The result file is the undo record (undo is a DBA-reviewed manual compare-and-set `UPDATE` built from it, documented in the runbook; apply refuses a UUID `old_author`, so it cannot undo).
   - Never `UpdateFormula`/`DeleteFormula`, never `is_public`, never `updated_at`.
3. Wire `main` for `--apply --plan PATH --users PATH --confirm-digest HEX`; refusal prints reasons and exits 2; success prints counts and the result path.

**Verification**:
`cd services/xstockstrat-indicators && uv run python -m app.maintenance.legacy_authors --help` shows `--apply`; behavior verified in Step 6.

---

### Step 6 — test: apply refusals, guarded rewrite, idempotence, concurrency

**Status**: `pending`
**Service**: `xstockstrat-indicators`
**Files**:
- `services/xstockstrat-indicators/tests/test_legacy_authors.py` — modify

**Reviewers**: xstockstrat-indicators owner — DB data-change safety

**Codebase Evidence**:
- Existing pattern: Step 4's `FakeFormulasTable` (`tests/conftest.py`) and the `ctx_with` helper (`tests/conftest.py:21`).
- `UpdateFormula` refuses non-owner and system rows (`servicer.py:496,504`), so the owner-update leg of AC-8 cannot run through the servicer on a legacy row; it is modelled as a direct row change via `FakeFormulasTable.mutate` (design.md Tests).
- Test data (C-13): reuses the `conftest.py` fake and users from Step 4 (second consumer, no inline copy).

**TDD**: `red-green required`

**Covers**: `AC-1, AC-4, AC-8, AC-9`

**Instructions**:
Add tests (red against the Step 5-less tree: `run_apply` is absent):
- `test_apply_rewrites_confirmed_entries` (AC-1 data leg): `davcs86` → `80880990-2b79-4d85-8761-d8d9102c2efb` for id `31bb8ea6-0f3e-4cf7-8844-ec8294cebf85`; the row now carries the user id; the result file lists old and new author.
- `test_second_run_changes_nothing` (AC-4): re-run `run_report` then `run_apply`: `rewritten == 0`; system and user-id rows keep author and `updated_at` (assert `updated_at` byte-equal before/after for every row, including the rewritten ones).
- `test_apply_refused_missing_digest`, `test_apply_refused_mismatched_digest`, `test_apply_refused_leftover_suggested`, `test_apply_refused_inactive_target`, `test_apply_refused_unknown_target`, `test_apply_refuses_non_uuid_new_author` (AC-9): each asserts `ApplyRefused`, ZERO UPDATEs in the fake's log and no author changed.
- `test_apply_refuses_system_old_author` and `test_apply_refuses_uuid_old_author` (AC-9): a hand-edited plan marks the `system` row (`bbbbbbbb-0000-4000-8000-000000000003`) `confirmed` → refused; the system row keeps author and `updated_at`.
- `test_hand_widened_plan_cannot_extend_write_set` (AC-9): a plan adds a confirmed entry for a user-id-authored row with a made-up `old_author`; the intersection with live detection excludes it, and the SQL guard independently rejects it; row unchanged.
- `test_digest_is_hash_of_edited_file`: editing the plan after hashing changes the digest and apply is refused (documents edit → hash → record → apply order; "digest is integrity, not authority" asserted in the Step 8 runbook text, not in code).
- `test_row_changed_between_plan_and_apply_is_not_lost` (AC-8): detect `bbbbbbbb-0000-4000-8000-000000000001` (author `alice`), then via `mutate` set it to the owner id (the owner's update) and add a new row `bbbbbbbb-0000-4000-8000-000000000002` authored by `33333333-3333-4333-8333-333333333333`; apply: the first row is `skipped_concurrent` and keeps the owner's author and fields; the new row keeps its author and content.
- `test_unmappable_and_ambiguous_untouched_by_apply` (FR-3): `ghost`/`sam` rows keep their authors after apply.

**Verification**:
`cd services/xstockstrat-indicators && uv run pytest tests/test_legacy_authors.py -v && uv run pytest --cov=app --cov-fail-under=50 && ruff check . && ruff format --check .`

---

### Step 7 — test: servicer read path after repair (cold cache) and stale-cache negative

**Status**: `pending`
**Service**: `xstockstrat-indicators`
**Files**:
- `services/xstockstrat-indicators/tests/test_legacy_authors_read_path.py` — create

**Reviewers**: xstockstrat-indicators owner — formula read authorization unchanged

**Codebase Evidence**:
- Confirmed via: `grep -n "_can_read_formula" services/xstockstrat-indicators/app/handlers/servicer.py` → `:141` (owner or `SYSTEM_AUTHOR`), used by `GetFormula` `:442-444` and `ExecuteFormula` `:243`. `GetFormula` non-reader non-admin → NOT_FOUND (`:436-448`).
- Confirmed via: `_load_formula` (`servicer.py:150`) reads `self._formulas` FIRST with no TTL, then `self._repo.get_by_id` (`formulas_repository.py:183-188`, a single `fetchrow`); `GetFormula` caches after authz (`self._formulas[request.formula_id] = formula`, `servicer.py:452`). `IndicatorsServicer(config_watcher, db_pool=...)` builds `FormulasRepository(db_pool)` (`servicer.py:93-102`), so a fake pool exposing `fetchrow` drives the real read path.
- Existing pattern: `tests/test_formula_read_authz.py:31` (`TestGetFormulaAuthz`) and `:102` (`TestExecuteFormulaAuthz`) for request shapes and the NOT_FOUND assertions; `_cfg()` helper at `:15-19`.
- `ListFormulas` DB path (`list_visible`) is covered by the runbook verify step and by the in-memory branch (`servicer.py:465`, `if self._repo is None:`); the DB-backed list is not simulated here (stated, not claimed).

**TDD**: `red-green required` (red because the module under test, `app.maintenance.legacy_authors`, does not yet exist on the pre-implementation tree)

**Covers**: `AC-1, AC-6`

**Instructions**:
- Build `FakeFormulasTable` row for `31bb8ea6-0f3e-4cf7-8844-ec8294cebf85` with `author="davcs86"`; wrap it in a minimal fake pool that adds `fetchrow` for `SELECT * FROM indicators.formulas WHERE formula_id = $1::uuid` (returns the full row dict incl. `name`, `source`, `description`, `input_schema`, `pending_intent_id=None`).
- `test_owner_reads_after_repair_cold_cache` (AC-1): before apply `GetFormula` as `80880990-2b79-4d85-8761-d8d9102c2efb` aborts NOT_FOUND (the defect); run the Step 5 `run_apply`; with a FRESH `IndicatorsServicer` (cold cache) `GetFormula` returns `author == "80880990-…"`, and `ExecuteFormula` as the owner passes the read guard (assert `abort` not awaited with NOT_FOUND; follow `TestExecuteFormulaAuthz` at `test_formula_read_authz.py:102`).
- `test_non_owner_still_not_found_after_repair` (AC-6): after repair, `ExecuteFormula` and `GetFormula` as `22222222-2222-4222-8222-222222222222` abort `NOT_FOUND`; an admin (`x-access-scope: 4`) `ExecuteFormula` still gets `PERMISSION_DENIED` (read guard not loosened, FR-6).
- `test_stale_cache_requires_restart` (documents the runbook requirement): a servicer whose `_formulas` already cached the legacy-author row before apply (admin `GetFormula` caches foreign rows, `servicer.py:448-452`) still returns the old author to the owner as NOT_FOUND after apply; a new `IndicatorsServicer` instance returns it. Asserts both.

**Verification**:
`cd services/xstockstrat-indicators && uv run pytest tests/test_legacy_authors_read_path.py tests/test_formula_read_authz.py -v && uv run pytest --cov=app --cov-fail-under=50 && ruff check . && ruff format --check .`

---

### Step 8 — docs: runbook `docs/runbooks/legacy-formula-authors.md`

**Status**: `pending`
**Service**: `docs/runbooks/`
**Files**:
- `docs/runbooks/legacy-formula-authors.md` — create
- `docs/runbooks/CLAUDE.md` — modify (add an index row)

**Reviewers**: none

**Codebase Evidence**:
- Confirmed via: `docs/runbooks/CLAUDE.md` table (`| File | Purpose | Key trigger |`), last rows `operator-db-access.md`, `proto-versioning.md`.
- `docs/runbooks/operator-db-access.md:25-30` names `:25060` direct and `:25061` PgBouncer pool; macOS-first install instructions (`brew install libpq`) — the runbook follows the macOS-first rule from the root `CLAUDE.md`.
- Cache/restart facts: `_load_formula` reads `self._formulas` first with no TTL; admin `GetFormula` caches foreign rows (`servicer.py:448-452`); `ListFormulas` DB path does not read the cache — so `ListFormulas` alone would pass on a stale cache. Analysis formula caches are per-request (`xstockstrat-analysis` servicer, design.md), so no analysis restart.

**TDD**: `N/A (docs)`

**Covers**: —

**Instructions**:
The runbook must contain, in order (macOS/Homebrew-compatible commands, `uv run`, no GNU-only flags; `shasum -a 256` on macOS):
1. Purpose, scope, and the statement that prod row count and usernames are UNKNOWN; the six staging ids are a floor, not a bound. Never run against prod before step 3 (report) and DBA approval.
2. Authority statement (AC-9, operator sign-off 2026-10-22): authority to run is the DB credential holder plus the DBA change record (process, not code). The digest is integrity, not authority; the code enforces only a digest-matched, fully-confirmed plan and never touches `system` or UUID rows.
3. Prerequisites and connection: required `DATABASE_URL`, no fallback; use the pooled `:25061` URL with `DB_PGBOUNCER=true` (F-06, off the direct `:25060` budget); workstation must be in the cluster's trusted sources; a DO-console session is NOT used (no file durability).
4. Step A, users export: `uv run scripts/manage-users.py list-users --json > users.json`.
5. Step B, report: `uv run python -m app.maintenance.legacy_authors --users users.json --out plan.json`; read counts; edit the plan: `suggested` → `confirmed`, set an explicit override `new_author` (a user id) on an `unmappable`/`ambiguous` entry and confirm it (OQ-3 disposition), set `source: "override"`; leave the rest.
6. Step C, order is strictly edit → hash → record → apply: finish editing; `shasum -a 256 plan.json`; record the digest, `plan.json` and `users.json` in the DBA change record; then `... --apply --plan plan.json --users users.json --confirm-digest <sha256>`. Any later edit invalidates the digest.
7. After apply: attach `plan.json` and the `*.result.json` to the DBA change record BEFORE the redeploy; they are the only undo/audit record and contain email local parts (PII): name the storage location and retention, and delete the local `users.json`.
8. Restart and verify: redeploy/restart EVERY indicators instance (cache has no TTL); re-run report mode (0 rewritable for the confirmed authors); verify AC-1 as the owner through `get_formula`/`test_formula` (or `ExecuteFormula`) on one rewritten id, NOT `list_formulas` alone; analysis needs no restart; `skipped_concurrent` rows need a re-run.
9. Undo: apply cannot undo (it refuses a UUID `old_author`). Use the result file to build a DBA-reviewed manual `UPDATE indicators.formulas SET author=<old> WHERE formula_id=<id> AND author=<new>` per row via `docs/runbooks/operator-db-access.md`, recorded in the change record, followed by the restart-and-verify step.
10. Staging first, then prod; record the observed prod row count in the change record.

Add to `docs/runbooks/CLAUDE.md` a row: `legacy-formula-authors.md | Report and repair indicators formulas whose author is a legacy username (operator CLI, digest-confirmed apply, restart-and-verify) | Owner cannot see/execute their formulas; non-UUID authors in indicators.formulas`.

**Verification**:
`grep -n "edit\|hash\|record\|apply" docs/runbooks/legacy-formula-authors.md` shows the ordered steps; `grep -n "legacy-formula-authors" docs/runbooks/CLAUDE.md`; `grep -nE "grep -P|pip install" docs/runbooks/legacy-formula-authors.md` returns nothing (macOS rule).

---

### Step 9 — docs: indicators CLAUDE.md Maintenance section and context-constitution invariant

**Status**: `pending`
**Service**: `xstockstrat-indicators` (docs)
**Files**:
- `services/xstockstrat-indicators/CLAUDE.md` — modify (new "## Maintenance" section after "## Running Locally")
- `services/xstockstrat-indicators/docs/context-constitution.md` — modify (new rule `INDICATORS-12`)

**Reviewers**: none

**Codebase Evidence**:
- Confirmed via: `grep -n "^## " services/xstockstrat-indicators/CLAUDE.md` → "## Database" `:68`, "## Environment Variables" `:196`, "## Running Tests" `:209`, "## Running Locally" `:217` (last section).
- Confirmed via: `grep -n "INDICATORS-" services/xstockstrat-indicators/docs/context-constitution.md` → last rule is `INDICATORS-11` (`:28`); rules table header `| ID | Rule | Why | Evidence | Example (canonical path:line) |` at `:16`.
- Migrations list in indicators `CLAUDE.md` § Database (`:80-88`) is NOT changed: no migration is added.

**TDD**: `N/A (docs)`

**Covers**: —

**Instructions**:
1. Add "## Maintenance" to `services/xstockstrat-indicators/CLAUDE.md`: one paragraph and the commands `uv run python -m app.maintenance.legacy_authors --users users.json --out plan.json` (report) and `--apply ...`; link to `docs/runbooks/legacy-formula-authors.md`; state that it is operator-run, not part of the service process, and uses a single connection (not the `main.py` pool).
2. Add row `INDICATORS-12` to the context constitution: **`indicators.formulas.author` is a user id (UUID) or `SYSTEM_AUTHOR`; a non-UUID author is a legacy row that the owner cannot read (`_can_read_formula`, `servicer.py:141`). Repair only through `app.maintenance.legacy_authors`, whose rewrite UPDATE carries the system/UUID guard in the SQL.** Why: the read guard is owner-or-system only, so a username author is invisible to its owner (staging 2026-10-22). Evidence: `app/maintenance/legacy_authors.py` `REWRITE_SQL`.
3 (teardown, root CLAUDE.md): since context files changed, run `/context-forge:context-constitution refresh` scoped to the touched files as the last step before pushing; if the plugin is unavailable, re-read the touched context files against the code and record both facts in the PR body.

**Verification**:
`grep -n "INDICATORS-12" services/xstockstrat-indicators/docs/context-constitution.md && grep -n "## Maintenance" services/xstockstrat-indicators/CLAUDE.md`

---

## Deviation Log

_Populated by /sdd-execute as implementation proceeds._
