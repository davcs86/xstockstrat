# Implementation Spec: fix-migration-tooling-safety

**Status**: `pending`
**Created**: 2026-11-20
**Feature**: `docs/roadmap/features/318-fix-migration-tooling-safety/feature.md`
**Total Steps**: 13
**Feature Branch**: `feature/fix-migration-tooling-safety`
**Evidence tree**: `origin/main-dev@fb52065c2`. Every `path:line` below was read on that tree. The feature branch
is 168 commits behind it (merge-base `c4fd48b0a`) and still holds the pre-port `.sh` tooling, so
`scripts/tests/`, `scripts/check-migration-contract.py`, `scripts/migration-rerun.py` and
`scripts/shell-allowlist.txt` reach the branch only through `/sdd-execute` BRANCH SYNC (the `main-dev` merge
that runs before the first step). Re-grep a line number that has moved; the quoted text is the anchor.

---

## Execution Summary

The change is internal platform tooling only (C-14: product-spec names no UI segment and no Agent tool; design.md
"Consumer surface" confirms it), so every step sits on the backend/tooling surface. It adds no proto, no config
key and no migration (F-01).

Order: the migrator loses its `force 0` arm first (Steps 1–2, the AC-1 site), then the dirty guard becomes
refuse-all with a computed recovery and its tests move to pytest (Steps 3+4, one atomic unit), then the
ahead-check wording follows (Steps 5–6). The ordering gate is built and tested (Steps 7–8) before CI calls it
(Steps 9–10). Docs, findings and the two operator-signed durable-rule edits close the feature (Steps 11–13).

Three claims in this spec were executed, not inferred, on a scratch copy of the evidence tree: the Step 2 test
fails on the unmodified migrator (exit 0, `force 0` run) and passes after Step 1; the Step 4 recovery-line
assertion fails until the Step 3 guard exists; the Step 3 guard body below passes `shellcheck` and
`shfmt -d -i 2` and produces every row of the Step 4 case table.

## Scenario Coverage (C-15)

| Scenario | Covered by |
|---|---|
| `@AC-1` no `force` is executed, the run stops, the output names `force 4` | Step 2 (no force, exit 1, run stops), Step 4 (the exact `Recover:` line) |
| `@AC-2` CI rejects `024` under a base maximum of `025` | Step 8 (the check), Step 10 (the CI job that runs it) |
| `@AC-3` gap resolves to the previous existing version | Step 4 |
| `@AC-4` first file names `TRUNCATE` | Step 4 |
| `@AC-5` fails closed when no recovery is computable | Step 4 |

Durable rules (design.md "Business Rules Touched"): `@AC-19` (225) and the last clause of `@AC-28` (295) are
CHANGEd in Step 13 under operator sign-off O-3; `@AC-27` (279) is EXTENDed by the decimal cases in Steps 4 and 8;
`@AC-18`, `@AC-25`, `@AC-12`, `@AC-30` are PRESERVEd (the strings they pin are kept — see Steps 3, 5).

## Step Dependencies

- **Precondition for Step 1 (BRANCH SYNC done).** Every Verification command in Steps 1–13 needs files that
  reach this branch only through the `main-dev` merge. Before Step 1 run
  `test -d scripts/tests && test -f scripts/check-migration-contract.py && test -f scripts/migration-rerun.py && test -f scripts/shell-allowlist.txt`.
  If it fails, stop: BRANCH SYNC has not run, and no step may start on the unsynced branch.
- **Red order for the service-first pairs (C-08 / P-06).** Steps 1, 5 and 9 precede the test step that gives
  their red (Steps 2, 6, 10); Steps 3+4 and 7–8 name their own protocol. For each pair follow
  `.claude/skills/sdd-execute/reference/tdd-gate.md` "Write/confirm the failing test first": author the paired
  test step's test in the working tree **before** applying the service step's edit, run it, capture the red
  named in that step's TDD line, then apply the service edit and capture green. The test file is still
  committed under its own step number. Never produce the red by stashing the service edit.
- Step 2 [test] covers Step 1 [service]. Steps 1–2 leave a dirty service without a contract file refused with
  no recovery text (the old guard prints nothing for it); Steps 3+4 supply the text. Do not open the integration
  PR between Step 2 and Step 4.
- Steps 3+4 land together: `step-constraints.md` §C "changes a return shape" (the guard's exit contract loses
  exit 0, which turns legacy cases (a), (d), (f), (h), (i) of `scripts/migration-dirty-guard.test.sh` red) and
  §C "deletes a referenced resource" (that test file is referenced by `scripts/shell-allowlist.txt:18` and
  `.github/workflows/ci.yml:841`; `check-shell-freeze.py` fails an allowlist line whose file is gone).
- Step 4 requires Step 2: it adds one test to `scripts/tests/test_db_migrate.py`, which Step 2 creates.
- Step 6 [test] covers Step 5 [service] and requires Step 2 (same test module).
- Step 8 [test] covers Step 7 [service].
- Step 10 [test] covers Step 9 [service]; Step 9 requires Step 7 (the job runs the script) and Step 10 requires
  Step 8 (same test module).
- Step 11 requires Steps 1–10 (it documents their behaviour). Step 13 requires Step 3 (the durable text quotes
  the guard's output).
- **Tooling for the shell steps (1, 3, 5).** CI runs `shellcheck` and `shfmt` from apt (`ci.yml:831-838`).
  Where they are missing: `uv tool install shellcheck-py` provides `shellcheck`, and
  `go install mvdan.cc/sh/v3/cmd/shfmt@v3.8.0` provides `shfmt` (both verified in the spec sandbox).
- **CI-only proof.** `scripts/migration-rerun.py` calls the guard and `db-migrate.sh up` against a real database
  (`:741-745`, `:797-800`, `:1066-1075`, `:1087`, `:1105`, `:1110`). It is out of scope and unedited; the
  strings it asserts were checked against the new guard by hand (config dirty 41 → `force 40`, 44 → `force 43`,
  43 → `force 42`; ingest 13 → `force 12`; analysis 26 → `force 25`; every named previous file exists). The
  `migration-rerun` CI job on the integration PR is the first real run — budget one CI cycle for it
  (fails.md 2026-11-10 fix-config-keys-contract).
- **Open risks carried from design.md.**
  - Refuse-all stops PRE_DEPLOY until an operator acts (accepted, O-1) → stated in Step 11.
  - A replayed DML file double-applies without error → Step 3 text and Step 11.
  - golang-migrate 4.17.1 behaviours → **verified by source read** during this spec
    (`database/postgres/postgres.go:391-396`: an empty tracking table reads as `NilVersion`; `:363` `SetVersion`
    itself starts with the same `TRUNCATE`; `source/iofs/iofs.go:70`: a duplicate version fails at source init
    with `ErrDuplicateMigration`). The TRUNCATE wording in Step 3 is final.
  - Promotion passes by construction → **verified**: `origin/main` holds no up-file that `origin/main-dev` lacks
    (165 on main; main-dev adds only config `055`).
  - Peer collisions in `ci.yml` (298 edits `migration-contract-gate`; other peers edit the `:841` chain; 324
    (`node-test` job, `scripts/` ruff gate) and 297 (`changes` filter, `ci-gate` needs) edit the same file) →
    Steps 4 and 9 touch separate lines; Step 10 fails if a merge drops the new job's wiring. Rebase-level only;
    resolve at the integration PR.
  - Once `migration-order-gate` is live, an in-flight feature whose new NNN is at or below the trunk maximum is
    refused at its own PR. Known case at review time: 345 (`authelia-sso`) plans config `053` while trunk
    already holds `054` and `055`. That renumber is 345's action at its merge; name it in this feature's
    integration PR description.
  - The modify ban and the insights.md:900 conflict → Step 11.
  - Branch protection "up to date before merge" on `main-dev` and `main` → operator action, outside the PR.
  - Debate objection O-7 (non-blocking) → the Step 4 case table was re-derived against D-5 and D-10; every row
    agrees with the prototype run.
- **Deviations from design.md found in discovery** (none changes the Chosen Approach):
  - design §9 lists four findings entries; the `database.md` run-order drift is already fixed on the evidence
    tree (`docs/patterns/database.md:35` lists indicators and analysis), so Step 12 writes three.
  - design §7 names only `database.md`; three other docs go stale with this change and are edited in Step 11
    (`script-tooling.md:54,62`, `config-rollout.md:248-250`, `context-constitution.md:82`).
  - design §4 says every guard case asserts the literal `$DATABASE_URL`; exit-2 cases print no recovery text,
    so Step 4 asserts the literal on exit-3 cases and "no `postgres://`" on all.
  - design §4 puts the exact `Recover:` assertion in the migrator test. It lands in Step 4, not Step 2, because
    the line does not exist until the Step 3 guard does.
  - One guard case beyond the design table: an up-file name with no numeric prefix exits 2 (mirrors
    `scripts/migration-ahead-check.sh:38-41`).

---

### Step 1 — service: remove the `force 0` arm from `db-migrate.sh up`

**Status**: `done`
**Service**: platform tooling (`scripts/`)
**Files**:
- `scripts/db-migrate.sh` — modify

**Reviewers**: DBA — run-order compliance with `scripts/db-migrate.sh`; Platform Lead — cross-service architecture

**Codebase Evidence**:
- Confirmed via: `grep -n "force 0\|dirty" scripts/db-migrate.sh` → `:66-67`, `:69`, `:77-82`.
- Existing pattern (`:77-82`):
  `case "$ver" in *dirty*)` / `if ! "$REPO_ROOT/scripts/migration-dirty-guard.sh" "$dir" "$schema" "$ver"; then exit 1; fi` /
  `echo "  [dirty] force-resetting $svc to version 0"` / `migrate -path "$dir" -database "$url" force 0`.
- Stale comments: `:66-67` "force 0 replays every up-file, and pre-contract files are not idempotent; the guard
  refuses it at or above a contract floor." and `:69` "... before force 0 can replay."
- The ahead-check block at `:70-76` runs before the dirty arm and is unchanged.

**TDD**: `red-green required` — RED is Step 2's test on the unmodified script: write and run it before
instruction 1 (Step Dependencies "Red order").

**Covers**: —

**Instructions**:
1. Replace the body of the dirty arm (`:78-80`) with exactly:
   ```bash
         "$REPO_ROOT/scripts/migration-dirty-guard.sh" "$dir" "$schema" "$ver" || true
         exit 1
   ```
   The guard is called for its text only; the run exits 1 whatever the guard returns (D-1).
2. Delete the comment at `:66-67`. Above `case "$ver" in *dirty*)` put one comment:
   `# A dirty service is never recovered automatically: the guard prints the recovery and the run stops.`
3. Rewrite `:69` to `# A newer release's version: skip when clean, refuse when dirty.`
4. Change nothing else — the `force` subcommand at `:111-121` and the header at `:13-14` stay.

**Verification**:
```bash
shellcheck scripts/*.sh .claude/hooks/*.sh && shfmt -d -i 2 scripts/*.sh .claude/hooks/*.sh
bash scripts/migration-dirty-guard.test.sh && bash scripts/migration-ahead-check.test.sh
! grep -n 'force 0' scripts/db-migrate.sh
```

---

### Step 2 — test: `db-migrate.sh up` never forces a dirty service

**Status**: `done`
**Service**: platform tooling (`scripts/`)
**Files**:
- `scripts/tests/test_db_migrate.py` — create

**Reviewers**: DBA — run-order compliance with `scripts/db-migrate.sh`; Platform Lead — cross-service architecture

**Codebase Evidence**:
- **Not found** — no test runs `db-migrate.sh` with a stubbed `migrate` today
  (`ls scripts/tests/ | grep db_migrate` → nothing; recon.md Risks). This file is new.
- Reuse `scripts/tests/stub_tools.py:9-24` — `class Stubs` (`add(name, body)`, `calls()`, `.bin`, `.log`); each
  stub logs `"<name> $*"` to `$STUB_LOG`. Do **not** use `Stubs.run` (`:26-36`): it runs a Python script on a
  PATH that holds only the stubs, and `db-migrate.sh` needs `bash`, `sed`, `dirname`.
- Reuse `scripts/tests/conftest.py:8` — `SCRIPTS_DIR`.
- Service order in `scripts/db-migrate.sh:152-177`: config, ledger, identity, marketdata, trading, portfolio,
  notify, ingest, indicators, analysis. `scripts/migration-ahead-check.sh:49-53` exits 10 (skip) for a clean
  version above the highest up-file, so a stub answer of `9999` skips a service without touching it.
- `services/xstockstrat-indicators/migrations` holds `001`…`008`; no file carries `-- contract-of:`
  (`grep -rn "contract-of" services/*/migrations/*.up.sql` → analysis 027, config 044, ingest 014 only).

**TDD**: `red-green required` — executed in the spec sandbox: on the unmodified script the test fails with
`assert 0 == 1` (the run forces to 0 and completes); after Step 1 it passes.

**Covers**: `AC-1`

**Instructions**:
1. Module docstring: `"""scripts/db-migrate.sh up against stub psql and migrate: a dirty service is refused, never forced."""`
2. Constants: `DB_URL = "postgres://u:hunter2@db.invalid:5432/x?sslmode=disable"`, `AHEAD = "9999"`.
3. Helper `run_up(tmp_path, versions)` — `versions` maps a schema to its `migrate version` output:
   - `stubs = Stubs(tmp_path)`; `stubs.add("psql")`.
   - `stubs.add("migrate", body)` where `body` is an `sh` `case "$*" in *" version")` block holding one arm per
     entry — `*x-migrations-table=<schema>_schema_migrations*) echo "<output>" ;;` — and a default arm
     `*) echo 9999 ;;`.
   - Run `["bash", str(SCRIPTS_DIR / "db-migrate.sh"), "up"]` with
     `env={"PATH": f"{stubs.bin}{os.pathsep}{os.environ['PATH']}", "STUB_LOG": str(stubs.log), "DATABASE_URL": DB_URL}`,
     `check=False, capture_output=True, text=True, stdin=subprocess.DEVNULL`.
   - Return `(proc, stubs.calls())`.
4. `test_ac1_dirty_service_is_refused_and_never_forced(tmp_path)` with `{"indicators": "5 (dirty)"}`:
   - `proc.returncode == 1`;
   - no logged call that starts with `migrate ` contains ` force `;
   - no logged `migrate` call names `analysis_schema_migrations` (the run stopped at indicators);
   - `"hunter2"` is in neither stdout nor stderr.
5. C-13: the only dummy data is `DB_URL` and the stub answers, with one consumer (this module) — inline is
   compliant.

**Verification**:
```bash
cd scripts && uv run --extra dev pytest tests/test_db_migrate.py -v \
  && uv run --extra dev ruff check . && uv run --extra dev ruff format --check .
```
Coverage threshold: none applies — `scripts/` has no coverage gate in CI (`ci.yml:893-894` runs plain
`uv run --no-sync pytest`); the gate is that the test executes and passes.

---

### Step 3 — service: the dirty guard refuses every dirty state and computes the recovery

**Status**: `done`
**Service**: platform tooling (`scripts/`)
**Files**:
- `scripts/migration-dirty-guard.sh` — modify

**Reviewers**: DBA — migration NNN numbering, run-order compliance with `scripts/db-migrate.sh`; Platform Lead — cross-service architecture

**Codebase Evidence**:
- Confirmed via: `grep -n "floor\|prev\|exit" scripts/migration-dirty-guard.sh`.
- Keep: usage check `:6-9`, version parse `:13-17`
  (`sed -n 's/^\([0-9][0-9]*\) (dirty).*/\1/p'`, exit 2 on no match).
- Delete: the contract-floor scan `:19-40` and both allow-paths `:42` `[ -n "$floor" ] || exit 0`, `:43`
  `[ "$n" -lt "$floor" ] && exit 0` (R-3).
- Replace: `:45` `prev=$((n - 1))` and the text block `:46-52`.
- Strings other code asserts and this step keeps: `"<schema> is dirty at version <n>"` and `"force <prev>"`
  (`scripts/migration-rerun.py:744-745`, `:800`, `:1072-1073`), exit 3 (`:742-743`, `:798-799`), the literal
  `$DATABASE_URL` and no `postgres://` (`@AC-25` style).
- Tracking table location: `public.<schema>_schema_migrations` (`scripts/db-migrate.sh:27-28`,
  `scripts/migration-rerun.py:100`).
- Filename version parse to mirror: `scripts/migration-ahead-check.sh:36-42`.
- The script stays bash and stays in the migrator image (`scripts/Dockerfile.migrate:14`,
  `scripts/shell-allowlist.txt:17` `r0`); no new `COPY` is needed (`@AC-30`).

**Lands with**: `Step 4`

**TDD**: `red-green required` — RED is Step 4's module against the pre-unit guard.

**Covers**: —

**Instructions**:
Replace the file with the body below. It was run in the spec sandbox against every row of the Step 4 table and
is `shellcheck`- and `shfmt -d -i 2`-clean. The `Recover:` lines are asserted byte-for-byte by Step 4 — do not
reword them.

```bash
#!/usr/bin/env bash
# scripts/migration-dirty-guard.sh <migrations_dir> <schema> <version_output>
# Never allows a recovery: exit 3 prints the operator's recovery, 2 fails closed (none computable), 1 is usage.
set -euo pipefail

if [ "$#" -ne 3 ]; then
  echo "usage: $0 <migrations_dir> <schema> <version_output>" >&2
  exit 1
fi
dir="${1%/}"
schema="$2"

n="$(printf '%s\n' "$3" | sed -n 's/^\([0-9][0-9]*\) (dirty).*/\1/p' | head -n 1)"
if [ -z "$n" ]; then
  echo "db-migrate: cannot parse dirty version from: <$3>" >&2
  exit 2
fi
n=$((10#$n))

prev=""
next=""
lowest=""
file=""
for f in "$dir"/*.up.sql; do
  [ -e "$f" ] || continue
  v="$(basename "$f" | sed 's/^\([0-9]*\)_.*/\1/')"
  case "$v" in '' | *[!0-9]*)
    echo "db-migrate: cannot compute recovery for $schema: cannot parse migration version from: $(basename "$f")" >&2
    exit 2
    ;;
  esac
  v=$((10#$v))
  if [ -z "$lowest" ] || [ "$v" -lt "$lowest" ]; then lowest="$v"; fi
  if [ "$v" -eq "$n" ]; then file="$(basename "$f")"; fi
  if [ "$v" -lt "$n" ] && { [ -z "$prev" ] || [ "$v" -gt "$prev" ]; }; then prev="$v"; fi
  if [ "$v" -gt "$n" ] && { [ -z "$next" ] || [ "$v" -lt "$next" ]; }; then next="$v"; fi
done
if [ -z "$file" ]; then
  echo "db-migrate: cannot compute recovery for $schema dirty at version $n: no up-file for that version in $dir" >&2
  exit 2
fi

mig="services/xstockstrat-$schema/migrations"
# shellcheck disable=SC2016 # $DATABASE_URL is printed as a literal so no credential is ever expanded
{
  echo "db-migrate: $schema is dirty at version $n; refusing to recover it automatically (docs/patterns/database.md § Contract migration recovery)."
  echo "  Read $mig/$file first: a data (DML) statement that already took effect applies twice, without any error, when the file is replayed."
  if [ "$n" -eq "$lowest" ]; then
    echo "  Recover: psql \""'$DATABASE_URL'"\" -c 'TRUNCATE public.${schema}_schema_migrations'"
    echo "  then re-run scripts/db-migrate.sh up (an empty tracking table means no version is applied; up starts at version $n)."
  else
    echo "  Recover: migrate -path $mig -database \""'$DATABASE_URL'"&x-migrations-table=${schema}_schema_migrations\" force $prev"
    echo "  (use '?x-migrations-table=' when DATABASE_URL has no query string), then re-run scripts/db-migrate.sh up."
  fi
  echo "  If that up fails with \"already exists\" in version $n: verify every effect of that file is present, then \`migrate ... force $n\` and re-run up."
  if [ -n "$next" ]; then
    echo "  If it then fails with \"already exists\" in version $next: verify that file the same way, then \`migrate ... force $next\` and re-run up."
  fi
  echo "  Never force forward on doubt: a forced version is skipped for good and nothing reports it. For a contract or prune file verify its effect, not that its objects exist."
  echo "  Use \`migrate force\`, never \`scripts/db-migrate.sh force\` (it forces every service to its highest version)."
} >&2
exit 3
```

Notes for the executor:
- "No up-file for version n" also covers an empty directory and an n above the local maximum (D-5).
- A `000`-based service dirty at 1 prints `force 0`; that is ordinary previous-version recovery (D-13).
- No `force -1` form is ever printed (D-5).

**Verification** (run as part of the Steps 3+4 unit):
```bash
shellcheck scripts/*.sh .claude/hooks/*.sh && shfmt -d -i 2 scripts/*.sh .claude/hooks/*.sh
test -x scripts/migration-dirty-guard.sh
! grep -n 'floor\|contract-of' scripts/migration-dirty-guard.sh
cd scripts && uv run --extra dev pytest tests/test_migration_dirty_guard.py tests/test_db_migrate.py -v
```

---

### Step 4 — test: port the guard tests to pytest and delete the legacy shell test

**Status**: `done`
**Service**: platform tooling (`scripts/`)
**Files**:
- `scripts/tests/test_migration_dirty_guard.py` — create
- `scripts/tests/test_db_migrate.py` — modify
- `scripts/migration-dirty-guard.test.sh` — delete
- `scripts/shell-allowlist.txt` — modify
- `.github/workflows/ci.yml` — modify

**Reviewers**: DBA — migration NNN numbering, run-order compliance with `scripts/db-migrate.sh`; Platform Lead — cross-service architecture

**Codebase Evidence**:
- Legacy test: `scripts/migration-dirty-guard.test.sh:38-88` — cases (a) `:41` and (d) `:59-60` assert exit 0
  (the defect), (f) `:71`, (h) `:77-78`, (i) `:83` exist only for contract headers, (g) `:86-88` is the
  credential check.
- References to it (`grep -rn "dirty-guard\.test" .` outside `docs/roadmap/`): `scripts/shell-allowlist.txt:18`
  (`scripts/migration-dirty-guard.test.sh legacy`) and `.github/workflows/ci.yml:841`
  (`... && bash scripts/migration-dirty-guard.test.sh && ...`). Nothing else.
- `scripts/check-shell-freeze.py` reports an allowlist entry whose file is gone
  (`scripts/tests/test_check_shell_freeze.py:51`), so the line and the file go together.
- **Not found** — no pytest module shells out to a bash script under test; the call shape is new:
  `subprocess.run(["bash", str(SCRIPTS_DIR / "migration-dirty-guard.sh"), dir, "x", version], ...)`.
- Fixture layout to keep from the legacy test (`:22-26`): `<tmp>/services/xstockstrat-x/migrations`, schema `x`.
- `docs/patterns/script-tooling.md` rule 5 (port the assertions) and rule 4 (hard cutover, same PR).

**Lands with**: `Step 3`

**TDD**: `red-green required` — against the pre-unit guard the port fails (e.g. up-files `027` with
`27 (dirty)` returns exit 0, expected 3) and the Step-2 module's new recovery-line test fails (verified in the
spec sandbox: stderr is empty).

**Covers**: `AC-1, AC-3, AC-4, AC-5`

**Instructions**:
1. Create `scripts/tests/test_migration_dirty_guard.py`.
   - Helper `guard(tmp_path, versions, dirty, contract=None)`: build
     `tmp_path/"services/xstockstrat-x/migrations"`, write `<NNN>_f.up.sql` (`SELECT 1;`) for each entry of
     `versions`; when `contract=("027", "026")` prefix file 027 with
     `-- contract-of: services/xstockstrat-x/migrations/026_f.up.sql`. Run the guard with
     `env={**os.environ, "DATABASE_URL": "postgres://u:hunter2@db.invalid/x"}`, `capture_output=True, text=True`.
   - Constants for the two exact lines (schema `x`):
     - `FORCE = '  Recover: migrate -path services/xstockstrat-x/migrations -database "$DATABASE_URL&x-migrations-table=x_schema_migrations" force {}'`
     - `TRUNCATE = "  Recover: psql \"$DATABASE_URL\" -c 'TRUNCATE public.x_schema_migrations'"`
   - One parametrized test over this table. "Recover" is matched as a whole line of
     `stderr.splitlines()`, never as a substring (fails.md 2026-07-29).

     | Up-files | Dirty | Exit | Expected | Scenario |
     |---|---|---|---|---|
     | 027 | `27 (dirty)` | 3 | `TRUNCATE` | legacy (a) |
     | 026, 027 | `27 (dirty)` | 3 | `FORCE` 26; line 1 starts `db-migrate: x is dirty at version 27;`; no "If it then fails" line | legacy (b) |
     | 026, 027 | `26 (dirty)` | 3 | `TRUNCATE`; escalation names `force 27` | legacy (c) |
     | 026, 027 | `25 (dirty)` | 2 | "cannot compute recovery" | legacy (d) |
     | 026, 027 | `20 (dirty)` | 2 | "cannot compute recovery" | legacy (d) |
     | 026, 027 | `garbage dirty` | 2 | "cannot parse dirty version" | legacy (e) |
     | 001, 002, 003, 005, 006 | `5 (dirty)` | 3 | `FORCE` 3; a line names version 6 and `force 6` | AC-3 |
     | 001, 002, 003, 005, 006 | `1 (dirty)` | 3 | `TRUNCATE`; `force -1` absent | AC-4 |
     | 001, 002, 003, 005, 006 | `4 (dirty)` | 2 | "cannot compute recovery" | AC-5 |
     | 001, 002, 003, 005, 006 | `7 (dirty)` | 2 | "cannot compute recovery" | AC-5 |
     | 001, 002, 003, 005, 006 | `6 (dirty)` | 3 | `FORCE` 5; no "If it then fails" line | D-10 |
     | (none) | `5 (dirty)` | 2 | "cannot compute recovery" | AC-5 |
     | 019, 020, 026, 027 (027 contract-of 026) | `20 (dirty)` | 3 | `FORCE` 19 | durable AC-19 example |
     | 000, 001 | `1 (dirty)` | 3 | `FORCE` 0 | D-13 |
     | 008, 009, 010 | `009 (dirty)` | 3 | `FORCE` 8; names version 10 | extends durable AC-27 |
     | `abc_f.up.sql` | `3 (dirty)` | 2 | "cannot compute recovery" | fail closed |

   - Every case: `"postgres://"` and `"hunter2"` are absent from stderr. Every exit-3 case: the literal
     `$DATABASE_URL` is present. Every exit-2 case: no line starts with `  Recover:`.
   - One more test: wrong argument count exits 1 with `usage:` on stderr.
   - Legacy cases (f), (h), (i) are not ported (they tested the deleted floor scan — design §4).
   - No test asserts that `force 0` is absent from output (D-13).
2. In `scripts/tests/test_db_migrate.py` (from Step 2) add `test_ac1_output_names_the_recovery(tmp_path)`: run
   `run_up(tmp_path, {"indicators": "5 (dirty)"})` and assert that
   `'  Recover: migrate -path services/xstockstrat-indicators/migrations -database "$DATABASE_URL&x-migrations-table=indicators_schema_migrations" force 4'`
   is an element of `proc.stderr.splitlines()`.
3. Delete `scripts/migration-dirty-guard.test.sh`.
4. Delete line 18 of `scripts/shell-allowlist.txt` (`scripts/migration-dirty-guard.test.sh legacy`).
5. In `.github/workflows/ci.yml:841` remove the single chain entry
   ` && bash scripts/migration-dirty-guard.test.sh`; the other five entries stay in order.
6. C-13: the fixture literals have one consumer each — inline is compliant; the indicators stub answer is reused
   through `run_up`, not copied.

**Verification** (union with Step 3):
```bash
cd scripts && uv run --extra dev pytest tests/test_migration_dirty_guard.py tests/test_db_migrate.py tests/test_check_shell_freeze.py -v \
  && uv run --extra dev ruff check . && uv run --extra dev ruff format --check . && cd ..
python3 scripts/check-shell-freeze.py
test ! -e scripts/migration-dirty-guard.test.sh
! grep -n 'migration-dirty-guard.test.sh' .github/workflows/ci.yml scripts/shell-allowlist.txt
bash scripts/render-migrations.test.sh && bash scripts/migration-ahead-check.test.sh
```
Coverage threshold: none applies (`scripts/` has no coverage gate — `ci.yml:893-894`).

---

### Step 5 — service: reword the ahead-check's dirty-ahead refusal

**Status**: `done`
**Service**: platform tooling (`scripts/`)
**Files**:
- `scripts/migration-ahead-check.sh` — modify

**Reviewers**: DBA — run-order compliance with `scripts/db-migrate.sh`; Platform Lead — cross-service architecture

**Codebase Evidence**:
- Confirmed via: `grep -n "prev\|refusing" scripts/migration-ahead-check.sh` → `:17` and `:46` (other refusals,
  unchanged), `:55` `prev=$((n - 1))`, `:58`
  "...; refusing \`force 0\` (a newer release's migration failed part-way; this image cannot see its files).",
  `:59` the `Recover with the newer release's files: migrate ... force $prev` line. `:60` (the
  `(use '?x-migrations-table=' ...` note) matches neither word; confirm it with `sed -n 60p`.
- Asserted strings that must survive: `force <n-1>` and `<schema> is dirty at version <n>`
  (`scripts/migration-ahead-check.test.sh:44-45`, `scripts/migration-rerun.py:1174-1175`), exit 4 (`:43`,
  `migration-rerun.py:1169-1170`), literal `$DATABASE_URL`, no `postgres://` (`:67-69`; durable `@AC-25`).
- D-8: the script keeps `n-1` because the older image cannot see the newer release's files.

**TDD**: `red-green required` — RED is Step 6's test against the current wording: write and run it before
instruction 1 (Step Dependencies "Red order").

**Covers**: —

**Instructions**:
1. `:58` — replace "refusing \`force 0\`" with "refusing to migrate it"; the rest of the line is unchanged.
2. `:59` — unchanged, byte for byte.
3. `:60` — replace with:
   `echo "  (force the previous version present in the newer release: $prev assumes it has no gap below $n; use '?x-migrations-table=' when DATABASE_URL has no query string), then fix forward and redeploy that release."`
4. Exit codes, `prev=$((n - 1))` and everything above `:55` are unchanged.

**Verification**:
```bash
shellcheck scripts/*.sh .claude/hooks/*.sh && shfmt -d -i 2 scripts/*.sh .claude/hooks/*.sh
bash scripts/migration-ahead-check.test.sh
```

---

### Step 6 — test: a dirty-ahead service is refused with the reworded recovery

**Status**: `pending`
**Service**: platform tooling (`scripts/`)
**Files**:
- `scripts/tests/test_db_migrate.py` — modify

**Reviewers**: DBA — run-order compliance with `scripts/db-migrate.sh`; Platform Lead — cross-service architecture

**Codebase Evidence**:
- `run_up` from Step 2. marketdata is the fourth service (`scripts/db-migrate.sh:161`); its highest up-file is
  `010_symbol_profile.up.sql`, so `9999 (dirty)` is dirty-ahead and `scripts/migration-ahead-check.sh:55-62`
  exits 4, which `scripts/db-migrate.sh:72-76` turns into exit 1.
- The legacy `scripts/migration-ahead-check.test.sh` is frozen (`scripts/shell-allowlist.txt:16` `legacy`;
  `docs/patterns/script-tooling.md` rule 0), so the new assertion goes in pytest.

**TDD**: `red-green required` — against the pre-Step-5 script the exact-line assertion fails (the third line
still reads "(use '?x-migrations-table=' ...").

**Covers**: — (regression guard for durable `@AC-25`, feature 279; no scenario of this feature)

**Instructions**:
Add `test_dirty_ahead_service_is_refused_with_the_newer_release_recovery(tmp_path)`: run
`run_up(tmp_path, {"marketdata": "9999 (dirty)"})` and assert
- `proc.returncode == 1` and no logged `migrate` call contains ` force `;
- `stderr.splitlines()` contains exactly
  `  Recover with the newer release's files: migrate -path services/xstockstrat-marketdata/migrations -database "$DATABASE_URL&x-migrations-table=marketdata_schema_migrations" force 9998`
  and
  `  (force the previous version present in the newer release: 9998 assumes it has no gap below 9999; use '?x-migrations-table=' when DATABASE_URL has no query string), then fix forward and redeploy that release.`;
- `"hunter2"` and `"postgres://"` are absent from stdout and stderr.

**Verification**:
```bash
cd scripts && uv run --extra dev pytest tests/test_db_migrate.py -v \
  && uv run --extra dev ruff check . && uv run --extra dev ruff format --check .
```
Coverage threshold: none applies (`scripts/` has no coverage gate — `ci.yml:893-894`).

---

### Step 7 — service: add the ordering gate `scripts/check-migration-order.py`

**Status**: `pending`
**Service**: platform tooling (`scripts/`)
**Files**:
- `scripts/check-migration-order.py` — create

**Reviewers**: DBA — migration NNN numbering (no conflicts); Platform Lead — cross-service architecture

**Codebase Evidence**:
- **Not found** — no NNN-ordering check exists (`grep -rn "check-migration-order\|order-gate" scripts .github`
  → nothing). Created from scratch, shaped like `scripts/check-migration-contract.py`:
  - `:1-8` docstring with usage and exit codes; `:18-19` `def git(*args, check=True)` wrapping
    `subprocess.run(["git", *args], capture_output=True, text=True, check=check)`;
  - `:36-40` `def main(argv=None)` returning 2 with `usage:` on stderr;
  - `:41-43` the added-files idiom `git diff --name-only --diff-filter=A f"{base}...HEAD" -- "services/*/migrations/*.up.sql"`;
  - `:45-65` one stderr line per refusal with a gate prefix, `status = 1`; `:68-69` `sys.exit(main())`.
- `docs/patterns/script-tooling.md` rules 1–2: stdlib-only Python, one file, work in functions, `main()` behind
  `if __name__ == "__main__"`.
- It runs in CI only, so `scripts/Dockerfile.migrate` gets no `COPY` (`@AC-30`).

**TDD**: `red-green required` — RED protocol, since the script is new: first land argument handling only
(`main` returns 2 on bad usage, else 0), run Step 8's module and see every refusal case fail on its exit-code
assertion (AC-2: `mo.main(["main"]) == 1` gets 0), then implement the checks.

**Covers**: —

**Instructions**:
1. Usage: `check-migration-order.py <base_ref> [--forbid-new]`. Exit 0 = ok, 1 = refused, 2 = usage (any other
   argument count or flag). No `argparse` exit-code surprises: an unknown flag must return 2.
2. One diff call:
   `git diff --name-status --no-renames --diff-filter=ADM f"{base}...HEAD" -- "services/*/migrations/*.up.sql"`.
   `--no-renames` makes a renumber show as a delete plus an add (D-3). Only `*.up.sql` is examined.
3. Base maximum per service: `git ls-tree --name-only <base> services/<svc>/migrations/`, keep names matching
   `^(\d+)_.*\.up\.sql$`, take `max(int(...))`. `int()` reads `008` as decimal (durable `@AC-27`). A service
   with no directory on base has no maximum and accepts any number.
4. Refusals — one stderr line each, all prefixed `order-gate: `; every violation is reported, then exit 1:
   - status `D` or `M`:
     `order-gate: <path>: an applied migration was <deleted|modified> (F-01); add a new numbered migration instead`
   - added file whose name has no numeric prefix:
     `order-gate: <path>: cannot parse a migration version from the file name`
   - added version at or below the base maximum (the message carries the file's own digits and the zero-padded
     maximum):
     `order-gate: <path>: version <NNN> is not above <base>'s maximum <MAX> for <svc>; renumber it to <MAX+1> or higher before merge`
   - two added files in one service with the same version:
     `order-gate: <svc>: <path_a> and <path_b> share version <NNN>`
   - `--forbid-new` and any added up-file:
     `order-gate: <path>: a pull request into main may not add a migration; ship it through main-dev and a promotion`
5. Success: print `order-gate: ok — <n> new migration(s), each above the base maximum` to stdout.
6. Existing gaps below the maximum are tolerated because only the maximum is compared; a file added into a gap
   is refused.

**Verification**:
```bash
python3 scripts/check-migration-order.py; test $? -eq 2
git fetch --no-tags origin main-dev   # the remote ref may be absent in a fresh sandbox
python3 scripts/check-migration-order.py origin/main-dev   # exit 0: this branch adds no migration
cd scripts && uv run --extra dev ruff check . && uv run --extra dev ruff format --check .
```

---

### Step 8 — test: the ordering gate against a throwaway repository

**Status**: `pending`
**Service**: platform tooling (`scripts/`)
**Files**:
- `scripts/tests/test_check_migration_order.py` — create

**Reviewers**: DBA — migration NNN numbering (no conflicts); Platform Lead — cross-service architecture

**Codebase Evidence**:
- Model: `scripts/tests/test_check_migration_contract.py:8` (`mc = load_script("check-migration-contract.py")`),
  `:13-28` helpers `git(repo, *args)`, `add(repo, rel, text)`, `commit(repo, msg)`, `:31-46` the `repo` fixture
  (`git init -q -b main`, identity config, base commit, `checkout -q -b work`, `monkeypatch.chdir`).
- Each script test module carries its own `git` helper and `repo` fixture today
  (`test_check_shell_freeze.py:78-83`, `test_ledger_guard.py:16-37`, `test_sdd_allocate_feature_number.py:24`).
  This module follows that convention with a fixture of its own (its base tree differs: a config dir whose
  maximum is `025`). Centralising five copies is out of scope, and `test_check_migration_contract.py` is in peer
  298's blast radius — recorded trade-off (C-18).
- `scripts/tests/conftest.py:12` `load_script`.

**TDD**: `red-green required` — see Step 7's RED protocol; AC-2's RED is `mo.main(["main"]) == 1` returning 0.

**Covers**: `AC-2`

**Instructions**:
1. `mo = load_script("check-migration-order.py")`; `CFG = "services/xstockstrat-config/migrations"`.
2. `repo` fixture: base branch `main` holding `CFG/023_a.up.sql`, `CFG/025_b.up.sql` (a gap at 024) and their
   `.down.sql` files; then `checkout -q -b work`; `monkeypatch.chdir(tmp_path)`.
3. Tests (each commits on `work`, then calls `mo.main([...])` and reads `capsys`):
   - usage: `[]`, `["a", "b", "c"]`, `["main", "--nope"]` → 2, `usage:` on stderr;
   - **AC-2**: add `CFG/024_late_seed.up.sql` → 1; stderr names `024` and `025`;
   - add `CFG/025_dup.up.sql` (equal to the maximum) → 1;
   - add `CFG/026_next.up.sql` → 0, stdout `order-gate: ok`;
   - a stale branch: after branching, commit `CFG/026_x.up.sql` on `main`, then add `CFG/026_y.up.sql` on `work`
     → 1 (the comparison uses the tip of base);
   - renumber: `git mv CFG/025_b.up.sql CFG/022_b.up.sql` → 1, stderr names the deleted path;
   - delete `CFG/023_a.up.sql` → 1 naming "deleted"; modify it → 1 naming "modified";
   - add `CFG/026_a.up.sql` and `CFG/026_b.up.sql` → 1 naming "share version 026";
   - change only `CFG/025_b.down.sql`, and add `CFG/026_n.down.sql` alone → 0 (down-files are ignored);
   - a new service dir `services/xstockstrat-new/migrations/000_schema.up.sql` → 0;
   - decimal compare (extends durable `@AC-27`): a second service whose base holds `008_a` and `009_b`; adding
     `010_c` → 0, adding `009_c` → 1;
   - `add CFG/abc.up.sql` → 1 naming "cannot parse";
   - `--forbid-new`: with `CFG/026_next.up.sql` added → 1 naming "may not add a migration"; with no migration
     added → 0.
4. C-13: fixture file names have one consumer (this module) — inline is compliant.

**Verification**:
```bash
cd scripts && uv run --extra dev pytest tests/test_check_migration_order.py tests/test_check_migration_contract.py -v \
  && uv run --extra dev ruff check . && uv run --extra dev ruff format --check .
```
Coverage threshold: none applies (`scripts/` has no coverage gate — `ci.yml:893-894`).

---

### Step 9 — service: CI job `migration-order-gate`

**Status**: `pending`
**Service**: platform tooling (`.github/workflows/`)
**Files**:
- `.github/workflows/ci.yml` — modify

**Reviewers**: Platform Lead — cross-service architecture; DBA — migration NNN numbering (no conflicts)

**Codebase Evidence**:
- Job to clone: `migration-contract-gate` at `.github/workflows/ci.yml:936-954` — comment `:936-937`, job key
  `:938`, `needs: changes`, `if:` `:941-944` (`github.event_name == 'pull_request' && (` `migrations` or `ci` filter
  `)`), `actions/checkout@v7` with `fetch-depth: 0` `:947-949`, run block `:952-954`
  (`git fetch --no-tags origin main "${{ github.base_ref }}"`).
- Env-passing precedent for PR context: `shell-freeze` `:850-852` (`env: BASE_REF: ${{ github.base_ref }}`).
- `migrations:` path filter `:88-97`; `- 'scripts/migration-rerun.py'` is `:94`.
- `ci-gate` `needs:` — `- migration-contract-gate` at `:1394`; result echo at `:1427`
  (`echo "migration-contract-gate: ${{ needs.migration-contract-gate.result }}"`). The gate fails only on
  `failure`/`cancelled` (`:1444-1447`), so a skipped PR-only job passes on push.
- Stale comment `:896-897`: "Applies every migration, then replays the chain from version 0 (the db-migrate.sh
  dirty-state recovery path) and runs scripts/migration-assertions/*.sql — every up-file must be idempotent."
- The promotion PR is opened with `--base main --head main-dev` from this repository
  (`.github/workflows/promote.yml:233-234`).
- It is a separate job, not a step of `migration-contract-gate`, because peer 298 edits that job (design §6).

**TDD**: `red-green required` — RED is Step 10's wiring test against the pre-step workflow (job absent): write
and run it before instruction 1 (Step Dependencies "Red order").

**Covers**: —

**Instructions**:
1. Path filter: after `:94` add `              - 'scripts/check-migration-order.py'`.
2. Rewrite the comment at `:896-897` (two lines):
   `# Applies every migration, replays the feature-224/225 expand and contract up-files, proves the dirty guard`
   `# refuses, and runs scripts/migration-assertions/*.sql. Older up-files are not replayed.`
3. After the `migration-contract-gate` job (`:954`) add:
   ```yaml
     # A new migration is numbered above the base branch's maximum; a PR into main adds none unless it is the promotion.
     # PR-only: github.base_ref is empty on push events.
     migration-order-gate:
       name: Migration order gate
       needs: changes
       if: >-
         github.event_name == 'pull_request' && (
         contains(fromJson(needs.changes.outputs.matched), 'migrations') ||
         contains(fromJson(needs.changes.outputs.matched), 'ci'))
       runs-on: ubuntu-latest
       steps:
         - uses: actions/checkout@v7
           with:
             fetch-depth: 0

         - name: Check new migrations are numbered above the base branch maximum
           env:
             BASE_REF: ${{ github.base_ref }}
             FORBID_NEW: ${{ (github.base_ref == 'main' && !(github.head_ref == 'main-dev' && github.event.pull_request.head.repo.full_name == github.repository)) && '--forbid-new' || '' }}
           run: |
             git fetch --no-tags origin "$BASE_REF"
             # shellcheck disable=SC2086 # FORBID_NEW is empty or exactly one flag
             python3 scripts/check-migration-order.py "origin/$BASE_REF" $FORBID_NEW
   ```
   - The expression is D-11 written in its positive form. Do **not** write it as
     `<exempt> && '' || '--forbid-new'`: in a workflow expression `''` is falsy, so that form always yields
     `--forbid-new`.
   - `github.head_ref` is attacker-controlled; it appears only inside the expression, never in `run:`.
4. `ci-gate`: add `      - migration-order-gate` after `:1394`, and
   `          echo "migration-order-gate: ${{ needs.migration-order-gate.result }}"` after `:1427`.
5. The expression cannot be executed locally. Its first real runs are this feature's integration PR (base
   `main-dev` → no flag) and the next promotion PR (base `main`, head `main-dev` → no flag); note both outcomes
   in the integration PR description. Expected value of `FORBID_NEW` per case, to check the job log against:

   | `base_ref` | `head_ref` | head repo | `FORBID_NEW` |
   |---|---|---|---|
   | `main-dev` | any | any | empty |
   | `main` | `main-dev` | this repository | empty |
   | `main` | `main-dev` | a fork | `--forbid-new` |
   | `main` | anything else (e.g. `hotfix/<slug>`) | any | `--forbid-new` |

   A wrong flag on a base-`main` PR blocks every hotfix or promotion PR that touches the `migrations` or `ci`
   filter; if the promotion PR's log shows `--forbid-new`, fix the expression before merging that PR.

**Verification**:
```bash
grep -n "^  migration-order-gate:" .github/workflows/ci.yml
test "$(grep -c "migration-order-gate" .github/workflows/ci.yml)" -eq 3   # job key, needs entry, echo line
test "$(grep -c "scripts/check-migration-order.py" .github/workflows/ci.yml)" -eq 2   # path filter, run line
! grep -n "replays the chain from version 0" .github/workflows/ci.yml
python3 -c "import yaml" 2>/dev/null && python3 -c "import yaml; yaml.safe_load(open('.github/workflows/ci.yml'))"
```

---

### Step 10 — test: the CI wiring of the ordering gate

**Status**: `pending`
**Service**: platform tooling (`scripts/`)
**Files**:
- `scripts/tests/test_check_migration_order.py` — modify

**Reviewers**: Platform Lead — cross-service architecture; DBA — migration NNN numbering (no conflicts)

**Codebase Evidence**:
- **Not found** — no pytest module asserts workflow wiring; the existing static checks are legacy shell
  (`scripts/backmerge-no-ff.test.sh:41-64` greps `.github/workflows/`), which may not grow
  (`docs/patterns/script-tooling.md` rule 0). PyYAML is not a `scripts/` dev dependency
  (`scripts/pyproject.toml`), so the test reads the workflow as text.
- `scripts/tests/conftest.py:8` `SCRIPTS_DIR` → the workflow is `SCRIPTS_DIR.parent / ".github/workflows/ci.yml"`.

**TDD**: `red-green required` — against the pre-Step-9 workflow every assertion fails (the job is absent).

**Covers**: `AC-2`

**Instructions**:
Add `test_ci_runs_the_order_gate_and_the_ci_gate_requires_it()` that reads the workflow text and asserts each of
these is present as a whole line:
- `  migration-order-gate:`
- `      - migration-order-gate`
- `          echo "migration-order-gate: ${{ needs.migration-order-gate.result }}"`
- `              - 'scripts/check-migration-order.py'`
- `            FORBID_NEW: ${{ (github.base_ref == 'main' && !(github.head_ref == 'main-dev' && github.event.pull_request.head.repo.full_name == github.repository)) && '--forbid-new' || '' }}`
- `            python3 scripts/check-migration-order.py "origin/$BASE_REF" $FORBID_NEW`

This is the guard for the peer-collision risk: a merge that drops the job, its `needs` entry or the flag
expression turns the `scripts-python` job red.

**Verification**:
```bash
cd scripts && uv run --extra dev pytest tests/test_check_migration_order.py -v \
  && uv run --extra dev ruff check . && uv run --extra dev ruff format --check .
```
Coverage threshold: none applies (`scripts/` has no coverage gate — `ci.yml:893-894`).

---

### Step 11 — docs: forward-only rule, refuse-all recovery and the gate verdicts

**Status**: `pending`
**Service**: `docs/patterns/`, `docs/runbooks/`
**Files**:
- `docs/patterns/database.md` — modify
- `docs/patterns/script-tooling.md` — modify
- `docs/runbooks/config-rollout.md` — modify
- `docs/context-constitution.md` — modify

**Reviewers**: none

**Codebase Evidence**:
- `docs/patterns/database.md:41` — "NNN is the next integer after `ls ... | sort | tail -1`"; `:43` the F-01
  line; `:60-63` "...`db-migrate.sh`'s dirty-state recovery (`force 0`, a replay from version 0) is refused at
  or above a contract floor"; `:65-79` the CI job list (`:71-72` "the dirty guard blocks `db-migrate.sh up`
  until `migrate force <n-1>`", `:78-79` the `migration-contract-gate` bullet); `:81-107`
  "### Contract migration recovery" — Guard `:83-84`, Floor rule `:85-88`, Recovery `:89-95`, Ahead rule
  `:96-104` (`:100` "refused before any `force 0`"), Adjacency `:105-107`.
- `docs/patterns/database.md:35` already lists the full run order — nothing to fix there.
- `docs/patterns/script-tooling.md:54` — the R0 row says tests are "`.test.sh` ×3"; `:62` lists the ported
  Python scripts (includes `check-migration-contract.py`).
- `docs/runbooks/config-rollout.md:248-250` — "config has a contract floor of 40 ... exits 3 instead of running
  `force 0`: **dirty at a version ≥ 40 means `force <n-1>`, never `force 0`.**"
- `docs/context-constitution.md:82` — pointer row "... CI `migration-rerun`, `migration-contract-gate`".
- Ledger text to reconcile: `docs/roadmap/ledger/insights.md:900` (pre-assign ascending migration numbers in
  merge-order.md); precedent wording `docs/patterns/config-governance.md:634`
  ("**Migration renumbered `024` → `026`:** `merge-order.md` pre-assigned `024`, but feature 166's ...").
- The section heading "Contract migration recovery" is kept: the Step 3 guard text and three references
  (`database.md:63`, `:75`, `context-constitution.md:82`) name it.

**TDD**: `N/A (docs)`

**Covers**: —

**Instructions**:
1. `database.md:41` — add the forward-only rule: golang-migrate applies only versions above the stored one, so
   a number at or below the target branch's maximum is skipped on every persistent database. Take the next free
   NNN **at merge**; numbers written in `merge-order.md` are advisory; renumber before merge, never after. CI
   enforces it (`migration-order-gate`). State that this narrows insights.md:900: pre-assigned numbers are a
   plan, re-checked against the base maximum at merge.
2. `database.md:43` — add that the gate also refuses a modified or deleted merged `.up.sql`, comment and typo
   fixes included; the escape is a new numbered file.
3. `database.md:60-63` — replace the `force 0` sentence: `db-migrate.sh up` never recovers a dirty service; it
   prints the recovery and exits 1 (§ Contract migration recovery).
4. `database.md:71-72` — "until `migrate force <n-1>`" becomes "until the printed `migrate force <prev>`".
5. `database.md` CI list — after `:78-79` add the `migration-order-gate` bullet: PR-only; runs
   `scripts/check-migration-order.py` against the base branch; refuses a new NNN at or below the base maximum, a
   duplicate NNN, and a modified or deleted merged up-file. Verdicts (operator decision O-4): a promotion PR
   (`main-dev` → `main`, same repository) passes by construction; every other PR into `main` runs with
   `--forbid-new`, so a hotfix carries no migration and a schema fix ships through `main-dev` and a promotion.
   State the cost: an urgent production schema fix forces promotion of all unpromoted `main-dev` work. Add that
   two PRs can still each take the same next number against a stale base; branch protection "require branches
   to be up to date" on `main-dev` and `main` closes that, and golang-migrate fails loudly on a duplicate
   version if it slips through.
6. `database.md:83-95` — rewrite Guard and Recovery, delete the Floor rule bullet:
   - **Guard**: `db-migrate.sh up` calls `scripts/migration-dirty-guard.sh` for a dirty service and then exits 1.
     There is no automatic recovery for any service. Exit 3 prints a recovery; exit 2 means none can be computed
     (unparsable version, no up-file for the dirty version, an unparsable file name).
   - **Recovery (a ratchet)**: read the dirty file first — a data (DML) file that already took effect applies
     twice, without error, when replayed. Then run the printed command: `migrate ... force <prev>`, where
     `<prev>` is the highest existing version below the dirty one (gaps are skipped), or
     `TRUNCATE public.<schema>_schema_migrations` when the dirty file is the service's first; then
     `scripts/db-migrate.sh up`. Only if that `up` fails with "already exists" in version K (the dirty version,
     then the next one) and every effect of K is verified present: `force K` and `up` again. Never force forward
     on doubt — a forced version is skipped for good, which is how seed files get lost. For a contract or prune
     file verify the effect, not that objects exist. Keep the "never `db-migrate.sh force`" sentence and the
     `db-migrate.sh` has no `down` sentence.
   - New paragraph: `force 0` printed for a `000`-based service dirty at version 1 is ordinary previous-version
     recovery, not the removed replay-from-zero path (D-13).
   - New paragraph (accepted cost, operator decision O-1): a dirty row stops every later migrator run — the
     PRE_DEPLOY job and DigitalOcean's automated rollback deploy included — until an operator runs the printed
     command.
7. `database.md:96-104` (Ahead rule) — "refused before any `force 0`" becomes "refused"; "(the printed
   `force <n-1>`)" gains "— `n-1` assumes the newer release has no gap below `n`".
8. `script-tooling.md:54` — tests cell becomes "`.test.sh` ×2, pytest (`test_migration_dirty_guard.py`,
   `test_db_migrate.py`)"; `:62` — add `check-migration-order.py` to the ported list.
9. `config-rollout.md:248-250` — replace the floor sentence with: `scripts/db-migrate.sh up` on a dirty config
   database exits 1 and prints the recovery; **dirty means the printed `force <prev>`, never `force 0`.**
10. `context-constitution.md:82` — append `, `migration-order-gate`` to the CI list in that row.

**Verification**:
```bash
grep -n "migration-order-gate\|forward-only\|force <prev>" docs/patterns/database.md
! grep -n "Floor rule\|allows \`force 0\`" docs/patterns/database.md
grep -n "check-migration-order.py" docs/patterns/script-tooling.md
! grep -n "contract floor of 40" docs/runbooks/config-rollout.md
npx --yes markdownlint-cli2 --config .markdownlint.yaml docs/patterns/database.md docs/patterns/script-tooling.md docs/runbooks/config-rollout.md docs/context-constitution.md
```

---

### Step 12 — docs: record the gaps this feature leaves open

**Status**: `pending`
**Service**: `docs/`
**Files**:
- `docs/context-constitution-findings.md` — modify

**Reviewers**: none

**Codebase Evidence**:
- Tables to append to: "## Documentation that lies" (`docs/context-constitution-findings.md:13`, columns
  What the docs say | What the code does | Evidence | Suggested action) and "## Latent bugs" (`:44`, columns
  Issue | Impact | Evidence).
- `scripts/migration-ahead-check.sh:55` — `prev=$((n - 1))` (kept by D-8).
- `scripts/check-migration-contract.py:46-64` — checks only that the target is not added by the same diff and
  is on `origin/main`; nothing checks that it is in the contract file's own service directory. The only check
  of that was the guard scan deleted in Step 3 (`scripts/migration-dirty-guard.sh:27-30`).
- `scripts/migration-rerun.py:7` ("blocks `force 0` above the contract floor"), `:735` ("the dirty guard
  refuses the automatic force 0 (contract floor 40)"), `:1067-1068` ("refuses force 0").
- **Not found** — the `database.md` run-order drift named in design §9: `docs/patterns/database.md:35` already
  lists `... → ingest → indicators → analysis`. No entry is written for it.

**TDD**: `N/A (docs)`

**Covers**: —

**Instructions**:
Add three rows, each dated "found 2026-11-20, feature 318":
1. Latent bugs — ahead-check names a missing version: for a dirty-ahead service the refusal prints
   `force <n-1>`, which names a version with no file when the newer release has a gap below `n` (marketdata has
   no 007; config has no 024, 035, 036, 053). The older image cannot see the newer files, so it cannot compute
   the previous existing version. Evidence `scripts/migration-ahead-check.sh#prev`.
2. Latent bugs — a `-- contract-of:` header that names another service's directory is accepted by every check.
   Evidence `scripts/check-migration-contract.py#main`; the guard no longer scans headers.
3. Documentation that lies — `scripts/migration-rerun.py` docstring and two log lines still describe a
   contract floor and an automatic `force 0`; the guard now refuses every dirty state. Suggested action: reword
   when that script is next edited (it is out of scope for 318).

**Verification**:
```bash
test "$(grep -c "found 2026-11-20, feature 318" docs/context-constitution-findings.md)" -eq 3
npx --yes markdownlint-cli2 --config .markdownlint.yaml docs/context-constitution-findings.md
```

---

### Step 13 — docs: operator-signed changes to two durable business rules (C-16)

**Status**: `pending`
**Service**: `docs/sdd/business-rules/`, `services/xstockstrat-config/acceptance/`
**Files**:
- `docs/sdd/business-rules/platform.feature` — modify
- `services/xstockstrat-config/acceptance/fix-config-keys-drift.feature` — modify

**Reviewers**: none

**Codebase Evidence**:
- `docs/sdd/business-rules/platform.feature:386-390` — `@AC-19 @FR-8 @feature-225` "Dirty recovery below the
  contract floor is unchanged" ... "Then both evaluations allow the automatic force-0 recovery".
- `services/xstockstrat-config/acceptance/fix-config-keys-drift.feature:102-109` — `@AC-28 @FR-3 @regression
  @feature-295`; `:109` "And an automatic force 0 from a dirty 041 fails at migration 001 leaving row counts and
  audit functions unchanged, after which the probe-and-force runbook converges".
- Change-comment precedent: `platform.feature:1168` "# Changed by @feature-307 (ui-env-themed-bundles),
  operator-signed 2026-11-10".
- Sign-off: context.md "Operator Decisions (binding, recorded 2026-11-20)" O-3; design.md "Business Rules
  Touched (C-16)".
- config has `040_config_markers.up.sql` and `041_heal_config_keys_to_reader_catalog.up.sql`, so the Step 3
  guard prints `force 40` for `41 (dirty)`; `scripts/migration-rerun.py:741-745` already asserts exit 3,
  "config is dirty at version 41" and "force 40".

**TDD**: `N/A (docs)`

**Covers**: —

**Instructions**:
0. Before editing either suite, confirm the sign-off is on record:
   `grep -n '^- \*\*O-3: C-16 sign-off\*\*' docs/roadmap/features/318-fix-migration-tooling-safety/context.md`
   must match (block "Operator Decisions (binding, recorded 2026-11-20)"). If it does not, stop — `business-rules/CLAUDE.md`
   lets a rule enter a durable suite by promotion only, and this hand edit is valid solely as that signed C-16
   CHANGE.
1. `platform.feature:386-390` — keep the tags; replace the scenario with:
   ```gherkin
     # Changed by @feature-318 (fix-migration-tooling-safety), operator-signed 2026-11-20 (C-16 CHANGE, 318 context.md O-3):
     # the guard no longer allows a force-0 recovery for any dirty state.
     @AC-19 @FR-8 @feature-225
     Scenario Outline: The dirty guard refuses every dirty state and names a recovery it can compute
       Given a migrations directory for schema "x" holding up-files <files>
       When the dirty guard evaluates "<version>"
       Then it exits <exit> and its output names "<names>"

       Examples:
         | files                                             | version    | exit | names                               |
         | 001, 002, 003, 005, 006                           | 5 (dirty)  | 3    | force 3                             |
         | 001, 002, 003, 005, 006                           | 1 (dirty)  | 3    | TRUNCATE public.x_schema_migrations |
         | 001, 002, 003, 005, 006                           | 4 (dirty)  | 2    | cannot compute recovery             |
         | (none)                                            | 5 (dirty)  | 2    | cannot compute recovery             |
         | 019, 020, 026, 027 (027 declares contract-of 026) | 20 (dirty) | 3    | force 19                            |
   ```
2. `fix-config-keys-drift.feature` — above `:102` add
   `  # Changed by @feature-318 (fix-migration-tooling-safety), operator-signed 2026-11-20 (C-16 CHANGE, last clause only).`
   and replace `:109` with
   `    And the dirty guard refuses a dirty 041 with exit 3 naming force 40, leaving row counts and audit functions unchanged, after which migrate force 40 and up converge`.
   Lines `:103-108` are unchanged.
3. Edit nothing else in either suite. `@AC-18`, `@AC-25`, `@AC-27` and `@AC-30` keep their text. At
   integration the scenario-promoter promotes this feature's `@AC-1`…`@AC-5` from the branch-tip
   `acceptance.feature` and dedups `@AC-3`…`@AC-5` against the rewritten `@AC-19` (fails.md 2026-11-10
   fix-config-keys-drift: promote from the branch tip, never from this block).

**Verification**:
```bash
grep -n "feature-318" docs/sdd/business-rules/platform.feature services/xstockstrat-config/acceptance/fix-config-keys-drift.feature
! grep -n "allow the automatic force-0 recovery" docs/sdd/business-rules/platform.feature
! grep -n "an automatic force 0 from a dirty 041" services/xstockstrat-config/acceptance/fix-config-keys-drift.feature
test "$(grep -c "@AC-19 @FR-8 @feature-225" docs/sdd/business-rules/platform.feature)" -eq 1
```

---

## Deviation Log

_Populated by /sdd-execute as implementation proceeds._
