# Implementation Spec: private-by-default-enforce-contract

**Status**: `in-progress`
**Created**: 2026-10-10
**Feature**: `docs/roadmap/features/225-private-by-default-enforce-contract/feature.md`
**Total Steps**: 19
**Feature Branch**: `feature/private-by-default-enforce-contract`

---

## Execution Summary

This spec implements release N+1 of feature 224, following the approved `design.md`. The work runs in five phases:

1. **Platform tooling (Steps 1–2).** The `db-migrate.sh` contract-floor dirty guard (FR-8) ships first. The rerun harness in Step 5 drives the guard end to end.
2. **Contract migrations (Steps 3–5).** Analysis `027` and ingest `014` land, together with their `migration-rerun.sh` replay, refused-down and dirty-guard proofs. They run in the same step PR, so the CI `migration-rerun` job stays green: removing the N-1 trigger probe in `ingest-013.sql` and the trigger-count check in `migration-rerun.sh` must travel with `014`.
3. **analysis (Steps 6–11).** analysis becomes fail-closed on the outbound side first (Steps 6–7: the single `owner_metadata` builder). Only then does its inbound gate land (Steps 8–9), followed by the QueryPnLPatterns owner filter (Steps 10–11). Doing the outbound side first means no analysis→indicators/ingest call can be headerless before Steps 12 and 17 make those services reject headerless calls.
4. **indicators and ingest (Steps 12–18).** indicators gets its gate and bypass removal (Steps 12–13), then stops writing `is_public` (Steps 14–15). The AC-11 real-schema harness follows in Step 16, because it extracts the SQL constants that Step 14 creates. ingest's gate comes last (Steps 17–18).
5. **Docs and teardown (Step 19).** This step also carries the C-16 business-rule promotion and the EXTEND edits.

**Consumer surfaces (C-14):** the product spec marks this feature **None (internal hardening)**. The UI BFF and the MCP agent already send `x-user-id` (feature 224), so no UI or Agent step is required. That is a recorded decision, not an omission (product-spec `## Consumer Surface(s)`).

### Scenario Coverage (C-15)

| Scenario | Covered by step(s) |
|---|---|
| AC-1 | 13 |
| AC-2 | 13 |
| AC-3 | 5 |
| AC-4 | 5 |
| AC-5 | 2 |
| AC-6 | 5 |
| AC-7 | 18 |
| AC-8 | 9 |
| AC-9 | 18 |
| AC-10 | 13 |
| AC-11 | 15, 16 |
| AC-12 | 5 |
| AC-13 | 5 |
| AC-14 | 11 |
| AC-15 | 11 |
| AC-16 | 9 |
| AC-17 | 7 |
| AC-18 | 2, 5 |
| AC-19 | 2 |

### Design "Tests MUST" → step map (fails.md `extract-tool-ssrf-hardening`)

| design.md test-plan clause | Step |
|---|---|
| analysis completeness: descriptor walk `{undecorated} == EXEMPT` both directions; headerless→UNAUTHENTICATED and ungranted `system`→PERMISSION_DENIED per method; non-raising abort and body not entered | 9 |
| `test_identity.py`: `owner_metadata` raises/returns; AST single-builder check | 7 |
| `test_owner_header_guard.py` additions: tick `["bob",""]`, sweep empty owner (+ next intent processed + `schedule.advance`), materializer `""`, three live-loop drains, `for_owner("")`, AC-17 | 7 |
| AC-14 repository predicate + `$N=user_id`, `$1=symbol` binding; servicer two-owner test | 11 |
| SetOpportunityAction headerless → UNAUTHENTICATED | 9 |
| indicators completeness (+ grant-without-SAN, positive control), AC-1/2/10, SQL routing, static `"is_public"` absence | 13, 15 |
| ingest completeness (+ grant-without-SAN, positive control on IngestSignal), `fn.__name__` grant pinning, AC-9, AC-7, dedup via `signal_dedup_claims` | 18 |
| `migration-dirty-guard.test.sh` cases (a)–(i) | 2 |
| CI: structural-test append, `migrations` paths filter, no-mount image smoke step | 1 |
| `migration-rerun.sh` goto 26 + post-224 fixture, replay list + 014/027, trigger count 0, refusal + guard flow, final up + assertions | 5 |
| AC-11 harness with per-constant param-count check | 16 |

## Step Dependencies

- **Branch freshness:** `origin/main-dev` is one commit ahead of this branch (`80d44449`, feature 196). That commit touches `services/xstockstrat-ingest/app/handlers/servicer.py:252-256`, so every ingest servicer line cited below that is past `:255` sits **1 line lower** on main-dev. Merge `origin/main-dev` into the feature branch before Step 17, and re-locate each cited symbol by name.
- Step 2 [test] pairs with Step 1 [service]. Step 1 must exist before Step 5, whose rerun drives `scripts/migration-dirty-guard.sh` through `db-migrate.sh up`.
- Steps 3 and 4 [migration] are proven by Step 5 [test]. Push Steps 3, 4 and 5 together, or merge their step PRs in order with Step 5 last. The `migration-rerun` CI job on a lone Step 4 PR fails until Step 5 removes the `ingest-013.sql` N-1 trigger probe.
- Step 7 [test] pairs with Step 6 [service]. Step 9 pairs with Step 8. Step 11 pairs with Step 10.
- Steps 6–7 must precede Steps 12 and 17. Once indicators and ingest reject headerless calls, every analysis outbound owner call must already go through `owner_metadata`.
- Step 8 requires Step 6, because the gate's `_caller_user_id` classifier and `owner_metadata` share `SYSTEM_IDENTITY` from `app/identity.py`.
- Step 10 requires Step 8, which already puts `owner_scoped` on `QueryPnLPatterns`. Step 10 adds the repository owner filter.
- Step 13 pairs with Step 12. Step 15 pairs with Step 14. Step 18 pairs with Step 17.
- Step 16 [test] requires Step 14 (the `_INSERT_SQL`/`_UPDATE_SQL`/`_UPSERT_SQL` module constants without `is_public`) and Step 5 (the rerun harness layout).
- Step 19 [docs] is last. It needs every behaviour change to be in place, and it runs the context-forge teardown required by the root `CLAUDE.md` § Teardown.
- **Spec-time correction to design.md §2 rows #4–#6 (P-03, recorded in context.md):** the design says the three live-loop drains "sit under the per-pair `try` (`live_loop.py:438-445`)". That `try` wraps only `_eval_pair`. The drains are called from the record-building loop (`live_loop.py:371-381`), which has no `try`. Only the cycle-level `except` at `live_loop.py:325-328` catches anything raised there, so one ownerless strategy would abort the **whole cycle**. Step 6 therefore adds a per-row `except ValueError` boundary around the owner drains. Without that boundary, design Open Risk 4 ("that unit is skipped") would not hold.
- **Spec-time refinement (design `/sdd-spec` note, AC-17):** design.md §2 row #8 shows `_compose` returning `None, [], {}, [], True` for an ownerless event. The later round-3 `/sdd-spec` note overrides this: keep the OHLCV and closes read, which is not owner-scoped, and skip only the indicators and ingest calls. Step 6 follows the note.
- **Accepted (recon Risks; design round 1):** after Steps 8, 12 and 17, an agent session with no bound caller context (stdio, the pre-token handshake) gets `UNAUTHENTICATED` from analysis, indicators and ingest. This is the intended fail-closed behaviour, and no consumer surface changes for an authenticated caller.
- **Deferred (design Open Risk 3):** `analysis.backtest_run_symbols.user_id` and `analysis.backtest_details.user_id` stay nullable. A later contract feature handles them.

---

### Step 1 — service: contract-floor dirty guard for `db-migrate.sh` (FR-8)

**Status**: `done`
**Service**: platform tooling (`scripts/`, `.github/workflows/`)
**Files**:
- `scripts/migration-dirty-guard.sh` — create
- `scripts/db-migrate.sh` — modify
- `scripts/Dockerfile.migrate` — modify
- `.github/workflows/ci.yml` — modify

**Reviewers**: DBA — run-order compliance with `scripts/db-migrate.sh`, up+down pair present

**Codebase Evidence**:
- Confirmed via: `cat -n scripts/db-migrate.sh`. The current dirty recovery is at `:66-72`:
  ```bash
  # If a previous run failed mid-migration the state table is marked dirty.
  # Force to version 0 (schema baseline) so migrate up re-runs from scratch.
  # All migrations use IF NOT EXISTS / if_not_exists => TRUE so re-running is safe.
  if migrate -path "$dir" -database "$url" version 2>&1 | grep -q "dirty"; then
    echo "  [dirty] force-resetting $svc to version 0"
    migrate -path "$dir" -database "$url" force 0
  fi
  ```
  `$dir` is still the original `$REPO_ROOT/services/$svc/migrations` here (`:52`). The scratch and render reassignment happens later (`:78-93`). `migrate_service` already has a local `schema` (`:51`). golang-migrate is pinned at v4.17.1 (`:5`, `Dockerfile.migrate:6`). There is no `down` command (`:112-115`). `force` forces to the **highest** version (`:101-110`).
- Header extraction to reuse verbatim: `scripts/check-migration-contract.sh:16` uses `head -n 5 "$f" | sed -n 's/^-- contract-of:[[:space:]]*//p' | head -n 1 | tr -d '[:space:]'`.
- Version-from-filename idiom: `scripts/db-migrate.sh:104` uses `sed 's/.*\/\([0-9]*\)_.*/\1/' … | sed 's/^0*//'`.
- `service_db_url` separator rule (`?` vs `&`): `scripts/db-migrate.sh:34-47`.
- Migrator image copies scripts file by file: `scripts/Dockerfile.migrate:11-12` (`COPY scripts/db-migrate.sh …`, `COPY scripts/render-migrations.sh …`).
- CI: the `migrations` paths filter is at `.github/workflows/ci.yml:70-76`. The structural-test step is at `:620-621` (`bash scripts/render-migrations.test.sh && bash scripts/check-migration-contract.test.sh`). The `migration-rerun` job builds the image at `:649-650` and bind-mounts the repo with `-v "$PWD:/repo"` at `:657`, which hides a missing `COPY` (design fix A; fails.md:1552 class). shellcheck and shfmt already cover `scripts/*.sh` (`:614-618`).
- Precedent for a separately testable script: `scripts/render-migrations.sh` + `scripts/render-migrations.test.sh`.

**TDD**: `red-green required` (Step 2's `migration-dirty-guard.test.sh` fails before this file exists)

**Covers**: —

**Instructions**:
1. Create `scripts/migration-dirty-guard.sh <migrations_dir> <schema> <version_output>`. Use `#!/usr/bin/env bash` and `set -euo pipefail`. Keep it bash 3.2 only: no arrays, `mapfile` or `${x,,}`; only `head`, `sed`, `tr`, `basename`, `dirname` and `[ … -lt … ]`. Exit codes:
   - wrong argument count → print usage to stderr and exit `1`;
   - parse error → exit `2` (fail closed);
   - refuse → exit `3`;
   - allow → exit `0`.
   Steps:
   - **Parse:** `n="$(printf '%s\n' "$3" | sed -n 's/^\([0-9][0-9]*\) (dirty).*/\1/p' | head -n 1)"`. If `n` is empty, print `db-migrate: cannot parse dirty version from: <$3>` and exit 2.
   - **Floor:** loop `for f in "$1"/*.up.sql; do [ -e "$f" ] || continue; …`. Read `target` with the exact `check-migration-contract.sh:16` extraction and skip the file if it is empty.
     - Require `target` to name a file in the same `services/<svc>/migrations/` as `$1`. Compare `dirname "$target"` against the last three path components of `$1` (`services/<svc>/migrations`); on a mismatch, print `contract-of target <target> is outside <dir>` and exit 2.
     - Compute `v="$(basename "$target" | sed 's/^\([0-9]*\)_.*/\1/; s/^0*//')"`. Validate it with `case "$v" in ''|*[!0-9]*) …exit 2;; esac`.
     - Keep the minimum as `floor`.
     - If no contract file exists, exit 0.
   - **Below the floor:** `[ "$n" -lt "$floor" ]` → exit 0.
   - **Refuse:** otherwise print to stderr, then exit 3. The `$DATABASE_URL` text below is a **single-quoted literal** in the script, so no credential is ever expanded. Show both separator forms:
     ```
     db-migrate: <schema> is dirty at version <n>, at/above contract floor <floor>; refusing automatic `force 0` (it replays non-idempotent pre-contract up-files — docs/reports/2026-10-07-db-migrate-dirty-recovery-replay-unsafe-defect.md).
       Recover: migrate -path services/xstockstrat-<schema>/migrations -database "$DATABASE_URL&x-migrations-table=<schema>_schema_migrations" force <n-1>
       (use '?x-migrations-table=' when DATABASE_URL has no query string), then re-run scripts/db-migrate.sh up.
       Use `migrate force <n-1>`, never `scripts/db-migrate.sh force` (it forces every service to its highest version).
     ```
2. In `scripts/db-migrate.sh`, replace `:66-72` with the design §6 block. Two comment lines (CLAUDE.md "How to Act" #5) replace the false 3-line comment:
   ```bash
   # force 0 replays every up-file, and pre-contract files are not idempotent;
   # the guard refuses it at or above a contract floor.
   ver="$(migrate -path "$dir" -database "$url" version 2>&1 || true)"
   case "$ver" in *dirty*)
     if ! "$REPO_ROOT/scripts/migration-dirty-guard.sh" "$dir" "$schema" "$ver"; then exit 1; fi
     echo "  [dirty] force-resetting $svc to version 0"
     migrate -path "$dir" -database "$url" force 0 ;;
   esac
   ```
3. In `scripts/Dockerfile.migrate`, after `:12`, add `COPY scripts/migration-dirty-guard.sh /repo/scripts/migration-dirty-guard.sh`.
4. In `.github/workflows/ci.yml`:
   - **(a)** Add `- 'scripts/migration-dirty-guard.sh'` and `- 'services/xstockstrat-indicators/app/services/formulas_repository.py'` to the `migrations:` filter (`:70-76`). The second path is there because the Step 16 harness executes that file's SQL.
   - **(b)** Change `:621` to `run: bash scripts/render-migrations.test.sh && bash scripts/check-migration-contract.test.sh && bash scripts/migration-dirty-guard.test.sh`.
   - **(c)** After the "Build migrator image" step (`:649-650`), add a no-mount smoke step:
     ```yaml
     - name: Migrator image ships the dirty guard (no bind mount)
       run: docker run --rm --entrypoint test xstockstrat-migrate-ci -x /repo/scripts/migration-dirty-guard.sh
     ```

**Verification**:
```bash
chmod +x scripts/migration-dirty-guard.sh
shellcheck scripts/migration-dirty-guard.sh scripts/db-migrate.sh
shfmt -d -i 2 scripts/migration-dirty-guard.sh scripts/db-migrate.sh
grep -n "migration-dirty-guard.sh" scripts/db-migrate.sh scripts/Dockerfile.migrate .github/workflows/ci.yml
grep -n "All migrations use IF NOT EXISTS" scripts/db-migrate.sh && exit 1 || true   # false comment gone
python3 -c "import yaml; yaml.safe_load(open('.github/workflows/ci.yml'))"
```

---

### Step 2 — test: dirty-guard structural tests + AC-5 contract-gate case

**Status**: `done`
**Service**: platform tooling (`scripts/`)
**Files**:
- `scripts/migration-dirty-guard.test.sh` — create
- `scripts/check-migration-contract.test.sh` — modify

**Reviewers**: DBA — run-order compliance with `scripts/db-migrate.sh`

**Codebase Evidence**:
- Style precedent: `scripts/check-migration-contract.test.sh:1-56`. It uses `set -uo pipefail`, a `fail()` helper, `mktemp -d` with `trap 'rm -rf …' EXIT`, and cases (a)–(c). Case (c) at `:49-54` already proves the generic "expand not on origin/main" failure.
- The contract gate prints `contract-gate: $f contracts $target, which is not on origin/main` to stderr (`scripts/check-migration-contract.sh:22`).

**TDD**: `red-green required`. Cases (a)–(i) fail before Step 1. Case (d) of the contract test is a **characterization** of the existing 224 gate and is green on its first run by design (AC-5 guards a gate that already exists); record that in the TDD evidence.

**Covers**: `AC-5, AC-18, AC-19` (AC-18: the refusal text and exit code; Step 5 covers the end-to-end state proof)

**Instructions**:
1. Create `scripts/migration-dirty-guard.test.sh` with no database. Build each case in a temp tree laid out as `<tmp>/services/xstockstrat-x/migrations/`. Assert exit code and stderr:
   - (a) No contract file, plus `"27 (dirty)"` → exit 0.
   - (b) `027_x.up.sql`, line 1 `-- contract-of: services/xstockstrat-x/migrations/026_y.up.sql`, plus `"27 (dirty)"` → exit 3; stderr contains `force 26` and the schema name.
   - (c) Same directory, `"26 (dirty)"` → exit 3; stderr contains `force 25`.
   - (d) Same directory, `"25 (dirty)"` → exit 0, **and** `"20 (dirty)"` → exit 0. The `"20 (dirty)"` half is AC-19's below-floor case.
   - (e) `"garbage dirty"` → exit 2.
   - (f) A `contract-of` header on line 6 is ignored (the 5-line rule) → exit 0.
   - (g) No case's stderr contains `postgres://`, and stderr **does** contain the literal `$DATABASE_URL`.
   - (h) Two contract files, `→013` and `→020` → floor 13: `"13 (dirty)"` → exit 3, `"12 (dirty)"` → exit 0.
   - (i) A contract-of target in another service's directory → exit 2.
   AC-19's no-contract-file `"27 (dirty)"` half is case (a).
2. In `scripts/check-migration-contract.test.sh`, add case (d) after `:54`. On a fresh branch, add `services/xstockstrat-analysis/migrations/027_contract_owner_dimension.up.sql` whose line 1 is `-- contract-of: services/xstockstrat-analysis/migrations/026_owner_dimension_templates.up.sql`, with that 026 file **not** on the fake `origin/main`. Assert a non-zero exit **and** stderr containing `027_contract_owner_dimension.up.sql` (AC-5). `run_check` currently discards stderr (`:30`), so add a variant that captures it to a temp file.

**Verification**:
```bash
shellcheck scripts/migration-dirty-guard.test.sh scripts/check-migration-contract.test.sh
shfmt -d -i 2 scripts/migration-dirty-guard.test.sh scripts/check-migration-contract.test.sh
bash scripts/migration-dirty-guard.test.sh && bash scripts/check-migration-contract.test.sh
```
Coverage: N/A (`scripts/` has no CI coverage gate).

---

### Step 3 — migration: analysis `027_contract_owner_dimension` (FR-3, FR-4, FR-5)

**Status**: `done`
**Service**: `xstockstrat-analysis`
**Files**:
- `services/xstockstrat-analysis/migrations/027_contract_owner_dimension.up.sql` — create
- `services/xstockstrat-analysis/migrations/027_contract_owner_dimension.down.sql` — create

**Reviewers**: DBA — migration NNN numbering, up+down pair present, index correctness; Service owner — xstockstrat-analysis — backtest reproducibility (owner-keyed run history)

**Codebase Evidence**:
- The last analysis migration is `026_owner_dimension_templates.{up,down}.sql` (`ls services/xstockstrat-analysis/migrations | tail`), so the next is **027** (C-07). Re-verified at /sdd-spec: no `02[7-9]_` analysis file exists on any of the 54 `origin/*` refs.
- Copy these from 026 verbatim:
  - the `-- requires-env: SEED_USER_ID` header (`026:1`);
  - the unrendered-seed guard `DO` block (`026:7-14`);
  - the D-1 unique-owner backfill (`026:16-24`);
  - the seed fallback (`026:26-28`);
  - the child-row backfills for `backtest_run_symbols` (`026:32-35`) and `backtest_details` (`026:39-42`).
- `analysis.strategy_scores` was created by `005_strategy_scores.up.sql:1`. `026:66-69` reads it only under a `to_regclass` guard. No FK references it: `grep -n REFERENCES services/xstockstrat-analysis/migrations/*.sql` shows only `008:8 → backtest_runs`. The app uses only `strategy_scores_v2` (`app/repositories/strategy_scores.py`).
- `backtest_details.backtest_id REFERENCES analysis.backtest_runs` (`008_backtest_details.up.sql:8`). The `SET NOT NULL` on the parent does not affect that FK.
- The `contract-of` header is read from the first 5 lines (`scripts/check-migration-contract.sh:16`). `render-migrations.sh:23` also reads `requires-env` from the first 5 lines, so both headers coexist.

**TDD**: `N/A (migration — proven by Step 5's CI rerun)`

**Covers**: —

**Instructions**:
1. Create `027_contract_owner_dimension.up.sql`:
   - line 1: `-- contract-of: services/xstockstrat-analysis/migrations/026_owner_dimension_templates.up.sql` (AC-5 requires it on line 1);
   - line 2: `-- requires-env: SEED_USER_ID`;
   - lines 3–4: `-- Migration: 027_contract_owner_dimension.up.sql` and a one-line purpose comment (feature 225 contract of 224's 026; replay-safe).
2. Body:
   - **(a)** The 026 seed guard `DO` block, with the message reading `migration 027`.
   - **(b)** One `DO $$ … $$` block that takes `ACCESS EXCLUSIVE` on `analysis.backtest_runs` with a bounded wait and restores the prior `lock_timeout` (design §4). `set_config('lock_timeout','2s',true)` stays **outside** the inner `BEGIN … EXCEPTION` block:
      ```sql
      DO $$
      DECLARE prev_lt text := current_setting('lock_timeout');
      BEGIN
        PERFORM set_config('lock_timeout', '2s', true);
        FOR i IN 1..20 LOOP
          BEGIN
            LOCK TABLE analysis.backtest_runs IN ACCESS EXCLUSIVE MODE;
            EXIT;
          EXCEPTION WHEN lock_not_available THEN
            IF i = 20 THEN RAISE; END IF;
            PERFORM pg_sleep(1);
          END;
        END LOOP;
        PERFORM set_config('lock_timeout', prev_lt, true);
      END $$;
      ```
   - **(c)** The D-1 `UPDATE … WHERE r.user_id IS NULL` (copy of `026:16-24`), then the seed fallback (copy of `026:26-28`).
   - **(d)** The child-row backfills (copy of `026:32-35` and `026:39-42`). They are guarded by `user_id IS NULL`. The child columns stay nullable (Open Risk 3).
   - **(e)** `ALTER TABLE analysis.backtest_runs ALTER COLUMN user_id SET NOT NULL;` This is a no-op on replay.
   - **(f)** `DROP TABLE IF EXISTS analysis.strategy_scores;`
   - No trigger work: analysis has no N-1 trigger (FR-4).
3. Create `027_contract_owner_dimension.down.sql`. It refuses unconditionally instead of recreating dropped objects (FR-5):
   ```sql
   -- Migration: 027_contract_owner_dimension.down.sql
   DO $$ BEGIN
     RAISE EXCEPTION 'irreversible contract: analysis 027 dropped analysis.strategy_scores and set backtest_runs.user_id NOT NULL; recover with migrate force 25 then db-migrate.sh up';
   END $$;
   ```

**Verification**:
```bash
ls services/xstockstrat-analysis/migrations/027_contract_owner_dimension.up.sql services/xstockstrat-analysis/migrations/027_contract_owner_dimension.down.sql
head -n 1 services/xstockstrat-analysis/migrations/027_contract_owner_dimension.up.sql | grep -qx -- "-- contract-of: services/xstockstrat-analysis/migrations/026_owner_dimension_templates.up.sql"
head -n 5 services/xstockstrat-analysis/migrations/027_contract_owner_dimension.up.sql | grep -q -- "-- requires-env: SEED_USER_ID"
grep -n "SET NOT NULL\|DROP TABLE IF EXISTS analysis.strategy_scores;\|lock_timeout" services/xstockstrat-analysis/migrations/027_contract_owner_dimension.up.sql
grep -n "irreversible contract" services/xstockstrat-analysis/migrations/027_contract_owner_dimension.down.sql
# by inspection: the down file raises (refused by design, FR-5) instead of inverting the drops
```

---

### Step 4 — migration: ingest `014_contract_signal_ownership` (FR-4, FR-5)

**Status**: `done`
**Service**: `xstockstrat-ingest`
**Files**:
- `services/xstockstrat-ingest/migrations/014_contract_signal_ownership.up.sql` — create
- `services/xstockstrat-ingest/migrations/014_contract_signal_ownership.down.sql` — create

**Reviewers**: DBA — migration NNN numbering, up+down pair present; Service owner — xstockstrat-ingest — idempotent ingestion (dedup on `signal_dedup_claims`)

**Codebase Evidence**:
- The last ingest migration is `013_signal_ownership_templates.{up,down}.sql`, so the next is **014**. No `01[4-9]_` ingest file exists on any `origin/*` ref.
- Objects to drop:
  - the function `ingest.n1_owner_fill_signals()` (`013:35-52`);
  - the trigger `newsletter_signals_n1_owner_fill` on `ingest.newsletter_signals` (`013:54-56`);
  - the table `ingest.signal_dedup_keys` (`009_signal_dedup_keys.up.sql:10`, index `:20`).
- 013's down file already drops the trigger and then the function in that order (`013.down:21-22`).
- 013 replays safely after 014: trigger creation is one-shot on `signal_sources.user_id` absence (`013:17-57`), and the `signal_dedup_keys` read is `to_regclass`-guarded (`013:101-112`).
- The app has no reference to either object (`grep -rn "signal_dedup_keys\|n1_owner_fill" services/xstockstrat-ingest/app` → none). Dedup claims go through `ingest.signal_dedup_claims` (`app/handlers/servicer.py:1038-1080`).
- ingest 013 has `-- requires-env`; 014 needs no env.

**TDD**: `N/A (migration — proven by Step 5's CI rerun)`

**Covers**: —

**Instructions**:
1. Create `014_contract_signal_ownership.up.sql`:
   - line 1: `-- contract-of: services/xstockstrat-ingest/migrations/013_signal_ownership_templates.up.sql`;
   - line 2: `-- Migration: 014_contract_signal_ownership.up.sql` (feature 225 contract of 013; replay-safe).
   Body:
   ```sql
   DROP TRIGGER IF EXISTS newsletter_signals_n1_owner_fill ON ingest.newsletter_signals;
   DROP FUNCTION IF EXISTS ingest.n1_owner_fill_signals();
   DROP TABLE IF EXISTS ingest.signal_dedup_keys;
   ```
   The `DROP TRIGGER` takes a `SHARE ROW EXCLUSIVE` lock on the `newsletter_signals` hypertable. No bounded-wait block is needed here: unlike 027, it is not a reader-blocking `ACCESS EXCLUSIVE`.
2. Create `014_contract_signal_ownership.down.sql`. It raises `'irreversible contract: ingest 014 dropped the N-1 owner-fill trigger/function and ingest.signal_dedup_keys; recover with migrate force 12 then db-migrate.sh up'` from a `DO` block, in the same shape as Step 3.

**Verification**:
```bash
ls services/xstockstrat-ingest/migrations/014_contract_signal_ownership.up.sql services/xstockstrat-ingest/migrations/014_contract_signal_ownership.down.sql
head -n 1 services/xstockstrat-ingest/migrations/014_contract_signal_ownership.up.sql | grep -qx -- "-- contract-of: services/xstockstrat-ingest/migrations/013_signal_ownership_templates.up.sql"
grep -c "IF EXISTS" services/xstockstrat-ingest/migrations/014_contract_signal_ownership.up.sql   # expect 3
grep -n "irreversible contract" services/xstockstrat-ingest/migrations/014_contract_signal_ownership.down.sql
```

---

### Step 5 — test: `migration-rerun.sh` contract replay, refused downs, dirty-guard e2e + assertions

**Status**: `done`
**Service**: platform tooling (`scripts/`)
**Files**:
- `scripts/migration-rerun.sh` — modify
- `scripts/migration-assertions/fixtures-post-224.sql` — create
- `scripts/migration-assertions/analysis-027.sql` — create
- `scripts/migration-assertions/ingest-014.sql` — create
- `scripts/migration-assertions/ingest-013.sql` — modify (remove the N-1 trigger probe)

**Reviewers**: DBA — run-order compliance with `scripts/db-migrate.sh`, up+down pair present; Service owner — xstockstrat-analysis; Service owner — xstockstrat-ingest

**Codebase Evidence**:
- `scripts/migration-rerun.sh` (all line numbers below are from `cat -n`):
  - `count_n1_triggers` at `:14-16`; `service_db_url` at `:20-25`;
  - in the pass-0 loop (`:36-58`), analysis is pre-rendered at `:40-49` and the case goes `goto 25` at `:55`;
  - `fixtures-pre-224.sql` is loaded at `:59`; pass 1 runs `db-migrate.sh up` at `:62`;
  - replay list at `:69-70`; replay with `psql -1 -f` at `:77`;
  - trigger-stability check at `:79-84`; assertion loop at `:86-93`, which skips `fixtures-*`;
  - runs under `set -euo pipefail` (`:5`).
- `scripts/migration-assertions/ingest-013.sql`: the N-1 trigger probe is the `BEGIN; … ROLLBACK;` block at the file's tail. It inserts with no `user_id` and expects `n1_owner_fill:`. After 014 that insert fails with NOT NULL, so the probe must go (an assertion edit, not an applied migration — design F-01 note). The AC-27, PK, dedup-claims and templates blocks above it stay.
- `scripts/migration-assertions/analysis-026.sql` asserts D-1 over the `fixture-run-*` rows. Those rows stay valid after 027.
- Fixture idiom: `fixtures-pre-224.sql` inserts `analysis.strategies (user_id, strategy_id, display_name, definition_json)` and `analysis.backtest_runs (backtest_id, strategy_id, status, user_id)`. `fixture_unique` is owned only by `user-a@example.test`.
- Child tables: `backtest_run_symbols` has `NOT NULL` columns `backtest_id, strategy_id, symbol, trading_days` (`007:8-23`). `backtest_details` has `backtest_id, strategy_id, completed_at, result_pb` (`008:7-12`). 026 added `user_id` to both (`026:30,37`).

**TDD**: `red-green required`. Run against the tree before Steps 3–4, the new `analysis-027.sql`/`ingest-014.sql` assertions and the refusal block fail (the objects still exist and there is no down sentinel).

**Covers**: `AC-3, AC-4, AC-6, AC-12, AC-13, AC-18`

**Instructions**:
1. **Pass 0b (post-224 fixture, AC-3).**
   - In the pass-0 `case` (`:52-57`), capture the analysis render with `analysis) migrate -path "$rendered" -database "$url" goto 25; analysis_rendered="$rendered" ;;`.
   - After `:59` (`fixtures-pre-224.sql`), add `migrate -path "$analysis_rendered" -database "$(service_db_url analysis)" goto 26`, then `psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f "$assertions/fixtures-post-224.sql"`.
2. **Create `fixtures-post-224.sql`.** It is loaded at analysis 26, where `user_id` is still nullable, and inserts:
   - `analysis.backtest_runs` `('fixture-post-r1','fixture_unique','COMPLETED',NULL)` (unique owner `user-a@example.test`);
   - `('fixture-post-r2','fixture_post_gone','COMPLETED',NULL)` (no owner → seed);
   - a `backtest_run_symbols` row `('fixture-post-r1','fixture_unique','AAPL', trading_days=>1, user_id NULL)`;
   - a `backtest_details` row `('fixture-post-r1','fixture_unique',NOW(),'\x00'::bytea, user_id NULL)`.
   - A header comment noting that it is not an assertion file.
3. **Replay list (AC-12).** Change `:69-70` to `indicators:007_private_formulas_templates ingest:013_signal_ownership_templates ingest:014_contract_signal_ownership analysis:026_owner_dimension_templates analysis:027_contract_owner_dimension`. Update the comment at `:65-66` to say it replays the 224 expand and 225 contract files.
4. **Trigger count.** Replace `:79-84`. Both `triggers_1` and `triggers_2` must equal `0`; otherwise fail with `migration-rerun: expected 0 N-1 owner-fill triggers after the contract (got $triggers_1 -> $triggers_2)`.
5. **Refused downs plus the dirty guard end to end (AC-6, AC-13, AC-18).** Add this after the replay. Every expected failure is wrapped as `if cmd >"$out" 2>&1; then echo "… unexpectedly succeeded"; exit 1; fi`, then followed by greps on `$out`, because the script runs under `set -e`. Use the raw `services/xstockstrat-<svc>/migrations` path and `service_db_url`. In order:
   - **(a) ingest.**
     1. `migrate … goto 13` must fail, and its output must contain `irreversible contract`.
     2. `migrate … version` must contain `dirty`.
     3. `to_regclass('ingest.signal_dedup_keys')` must still be NULL (AC-13).
     4. `scripts/db-migrate.sh up` **must fail** with output containing `ingest` and `force 12`.
     5. `version` must still report dirty (no `force 0` ran).
     6. Then run `migrate … force 12`.
   - **(b) analysis.**
     1. `goto 26` must fail with `irreversible contract`; the state must be dirty; `analysis.backtest_runs.user_id` must still be NOT NULL (`SELECT is_nullable FROM information_schema.columns … = 'NO'`) (AC-6).
     2. `db-migrate.sh up` **must fail** with output containing `analysis` and `force 25`; the state must still be dirty at 26 (AC-18).
     3. Then run `migrate … force 25`.
   - **(c)** `scripts/db-migrate.sh up` exits 0. analysis `version` is `27` and ingest is `14`, both clean (no `dirty`).
6. **Assertions.** The existing loop (`:86-93`) now runs after step 5(c), so move it below the refusal block. It picks up the new files:
   - `analysis-027.sql` (AC-3, AC-4):
     - `fixture-post-r1.user_id = 'user-a@example.test'` and `fixture-post-r2.user_id = :'seed_user_id'`;
     - the `fixture-post-r1` child rows carry `user-a@example.test`;
     - `to_regclass('analysis.strategy_scores') IS NULL`;
     - inside a sub-block, `INSERT INTO analysis.backtest_runs (backtest_id, strategy_id, status, user_id) VALUES ('fixture-post-null','x','COMPLETED',NULL)` raises `not_null_violation` (catch it and fail if nothing is raised).
   - `ingest-014.sql` (AC-4): `pg_trigger` has 0 rows `WHERE tgname = 'newsletter_signals_n1_owner_fill'`; `to_regprocedure('ingest.n1_owner_fill_signals()') IS NULL`; `to_regclass('ingest.signal_dedup_keys') IS NULL`.
7. Delete the trailing `BEGIN; … ROLLBACK;` N-1 trigger probe from `ingest-013.sql` and update its header comment (`:1-2`) to drop "N-1 trigger".
8. Update the script header comment (`:2-4`) to state that the job also proves contract replay, refused downs and the dirty guard. Keep it to 2 lines (How to Act #5).

**Verification**:
```bash
shellcheck scripts/migration-rerun.sh && shfmt -d -i 2 scripts/migration-rerun.sh && bash -n scripts/migration-rerun.sh
grep -n "014_contract_signal_ownership\|027_contract_owner_dimension\|goto 26\|force 12\|force 25\|irreversible contract\|fixtures-post-224" scripts/migration-rerun.sh
grep -n "n1_owner_fill:" scripts/migration-assertions/ingest-013.sql && exit 1 || true
ls scripts/migration-assertions/{fixtures-post-224,analysis-027,ingest-014}.sql
# Authoritative run (needs a database, so not run locally): the CI `migration-rerun` job on this step's PR must be green.
```
Coverage: N/A (`scripts/` has no CI coverage gate).

---

### Step 6 — service: analysis `app/identity.py` — one fail-closed owner-metadata builder (FR-1 addendum)

**Status**: `done`
**Service**: `xstockstrat-analysis`
**Files**:
- `services/xstockstrat-analysis/app/identity.py` — create
- `services/xstockstrat-analysis/app/handlers/servicer.py` — modify
- `services/xstockstrat-analysis/app/engine/live_loop.py` — modify
- `services/xstockstrat-analysis/app/engine/fundsignal_loop.py` — modify
- `services/xstockstrat-analysis/app/engine/pnl_pattern_consumer.py` — modify
- `services/xstockstrat-analysis/app/services/evaluator.py` — modify

**Reviewers**: Service owner — xstockstrat-analysis — backtest reproducibility, strategy scoring determinism, no look-ahead bias

**Codebase Evidence**:
- `SYSTEM_IDENTITY = "system"` is defined at `app/handlers/servicer.py:296`. It is imported by `app/engine/fundsignal_loop.py:31` (`from app.handlers.servicer import SYSTEM_IDENTITY`) and by `app/engine/live_loop.py:38-39` (in the `from app.handlers.servicer import (SYSTEM_IDENTITY, …)` group).
- `grep -rn '("x-user-id",' services/xstockstrat-analysis/app` finds every hand-built owner 2-tuple (design §2 table):
  1. `servicer.py:3256-3263` — `_saga_sweep_meta` returns `[("x-user-id", user_id), ("x-internal-caller", _TEMPLATE_SAGA_CALLER), ("x-trace-id", uuid.uuid4().hex)]`. Caller: `servicer.py:5656-5665`. Here `meta = self._saga_sweep_meta(intent["user_id"])` sits **before** the per-intent `try:` at `:5658`; the `except` is at `:5665` and `schedule.advance` at `:5667`.
  2. `servicer.py:5425` — `meta = [("x-user-id", uid)]`, before the per-user `try:` at `:5426`; the `except Exception` is at `:5430-5431`.
  3. `servicer.py:5474` — `meta = [("x-user-id", owner)]` in `_materialize_readiness_for_owner`. Its caller's per-owner `try/except` is at `:5605-5608`.
  4. `live_loop.py:464` — `_drain_owner_signals` builds `[("x-user-id", owner)]` outside `_drain_signals_with`'s `try`.
  5. `live_loop.py:519` and 6. `live_loop.py:546` — `metadata=[("x-user-id", owner)]` inside each pagination `try` of `_drain_held` (`:503`) and `_drain_watchlist` (`:530`).
  7. `app/services/evaluator.py:220-226` — `for_owner` returns `StrategyEvaluator(self._indicators, [("x-user-id", owner)] if owner else (), …)`. Callers: `live_loop.py:582` (in `_load_benchmark_bars`, reached from `_eval_pair`) and `:684` (in `_eval_pair`). Both run inside the per-pair `try` at `live_loop.py:438-445`.
  8. `pnl_pattern_consumer.py:366` — `meta = [("x-user-id", owner)] if owner else ()` in `_compose` (`:359-387`). `composer.indicators(…)` (indicators `ComputeIndicator`, `:91-104`) and `composer.signals(…)` (ingest `QuerySignals`, `:107-111`) are the owner-scoped calls. `ohlcv_and_closes` goes to marketdata. The caller `_handle…` at `:200-252` stores the snapshot and emits `analysis.snapshot.degraded` when `degraded`.
  - System metas that stay literal: `fundsignal_loop.py:174-177` (`("x-user-id", SYSTEM_IDENTITY)`) and `live_loop.py:65` (`_SYSTEM_READ_META`).
- **The live-loop drains are not under the per-pair `try`.** `live_loop.py:371-381` (the record-building `for row in rows:` loop) calls `_drain_held`, `_drain_watchlist` and `_drain_owner_signals` without a `try`. The only boundary is the cycle-level `except` at `:325-328`.
- Header propagation (C-03): no new outbound call is added. Every changed site already carries its call. This step only changes how the owner tuple is built.

**TDD**: `red-green required` (paired with Step 7)

**Covers**: —

**Instructions**:
1. Create `app/identity.py`. It imports nothing from `app`, which avoids an import cycle. Contents:
   - `SYSTEM_IDENTITY = "system"`.
   - `def owner_metadata(owner: str) -> list[tuple[str, str]]`. It raises `ValueError` when `not owner or owner == SYSTEM_IDENTITY` and returns `[("x-user-id", owner)]` otherwise. Give it a one-line docstring stating the constraint.
2. `servicer.py:295-296`: replace the definition with `from app.identity import SYSTEM_IDENTITY, owner_metadata`, placed in the import block near `:41`. `SYSTEM_IDENTITY` stays importable from `app.handlers.servicer`, so existing `from app.handlers.servicer import SYSTEM_IDENTITY` users still resolve.
3. In `fundsignal_loop.py:31`, import `SYSTEM_IDENTITY` from `app.identity`. In `live_loop.py:38-39`, move `SYSTEM_IDENTITY` out of the `app.handlers.servicer` import and into `from app.identity import SYSTEM_IDENTITY, owner_metadata`.
4. Route the 8 sites:
   - **#1:** `_saga_sweep_meta` returns `[*owner_metadata(user_id), ("x-internal-caller", _TEMPLATE_SAGA_CALLER), ("x-trace-id", uuid.uuid4().hex)]`. **Move** `meta = self._saga_sweep_meta(intent["user_id"])` (`:5657`) inside the `try:` (`:5658`), so a `ValueError` skips that intent only and `schedule.advance` (`:5667`) still runs (design fix B).
   - **#2:** move `meta = owner_metadata(uid)` (`:5425`) inside the per-user `try:` (`:5426`). The existing `except Exception` logs the bad `uid` and the loop continues. Delete the now-stale 2-line comment at `:5423-5424`.
   - **#3:** `meta = owner_metadata(owner)` at `:5474`.
   - **#4:** `_drain_owner_signals` → `self._drain_signals_with(owner_metadata(owner), ingest_pb2.SIGNAL_SCOPE_OWN)`.
   - **#5, #6:** in `_drain_held` and `_drain_watchlist`, compute `meta = owner_metadata(owner)` **before** the pagination loop, outside its `try`, so the error propagates instead of being swallowed as "ListPositions failed". Pass `metadata=meta`.
   - **Per-row boundary (spec-time correction):** in `_run_cycle`, wrap the per-owner drain block (`live_loop.py:374-381`) in `try: … except ValueError as e: log.warning("live_loop: strategy %s skipped — %s", definition.strategy_id, e); continue`. One ownerless row is then skipped, and the cycle keeps going for every other owner.
   - **#7:** `for_owner` passes `owner_metadata(owner)` instead of the `if owner else ()` conditional. Update its docstring to say that it raises for an empty or `system` owner.
   - **#8:** in `_compose`, when `not owner`:
     - log `log.warning("snapshot for %s has no owner — indicators/signals skipped", symbol)`;
     - keep the OHLCV read with `meta=()` (marketdata, not owner-scoped);
     - set `indicators, signals, degraded = {}, [], True` **without** calling `self._composer.indicators` or `self._composer.signals`.
     Otherwise use `meta = owner_metadata(owner)` with the existing three `try` blocks.
5. Do not touch the system metas (`fundsignal_loop.py:174-177`, `live_loop.py:65`).

**Verification**:
```bash
cd services/xstockstrat-analysis
grep -rnE '\("x-user-id", [A-Za-z_][A-Za-z_.\[\]"]*\)' app | grep -v "app/identity.py\|SYSTEM_IDENTITY"   # 2-tuples only; expect no output (3-tuple header lists and `k in (...)` filters are not matches)
grep -n "owner_metadata" app/handlers/servicer.py app/engine/live_loop.py app/engine/pnl_pattern_consumer.py app/services/evaluator.py
ruff check . && ruff format --check .
```

---

### Step 7 — test: `owner_metadata`, the single-builder static check, background-path containment, AC-17

**Status**: `done`
**Service**: `xstockstrat-analysis`
**Files**:
- `services/xstockstrat-analysis/tests/test_identity.py` — create
- `services/xstockstrat-analysis/tests/test_owner_header_guard.py` — modify

**Reviewers**: Service owner — xstockstrat-analysis — backtest reproducibility, strategy scoring determinism

**Codebase Evidence**:
- `tests/test_owner_header_guard.py:1-110` already provides:
  - `RecordingStub` ingest and indicators stubs (from `tests/conftest.py:41-60`);
  - `_assert_owner_headers` (`:82-92`), which fails on a vacuous path and on an empty `x-user-id`;
  - `_row(strategy_id, user_id)` (`:62-71`);
  - `make_servicer` (imported from `tests/test_analysis_servicer.py`);
  - `make_consumer`, `make_event` and `ORDER_PAYLOAD` (from `tests/test_pnl_pattern_consumer.py`);
  - `test_live_loop_cycle_system_and_owner_drains_and_evaluator` (`:157`), `test_pnl_handle_order_event` (`:183`) and `test_readiness_materializer` (`:313`) to extend.
- `DurableSchedule`-driven ticks: `_template_intent_sweep_tick(schedule)` (`servicer.py:5641`) and `_opportunity_refresh_tick(schedule)` (`servicer.py:5403`).

**TDD**: `red-green required`. On the pre-Step-6 tree: `app.identity` does not exist; `for_owner("")` returns an empty metadata evaluator; the tick sends a `("x-user-id","")` call; `_compose("")` calls ingest headerless.

**Covers**: `AC-17`

**Instructions**:
1. `tests/test_identity.py`:
   - **(a)** `owner_metadata("")` and `owner_metadata("system")` raise `ValueError`. `owner_metadata("bob") == [("x-user-id", "bob")]`.
   - **(b)** Single-builder static check. Parse every `app/**/*.py` with `ast`. For every `ast.Tuple` with exactly 2 elements whose first element is `ast.Constant("x-user-id")`, assert that one of these holds:
     - the file is `app/identity.py`; or
     - the second element is `ast.Name(id="SYSTEM_IDENTITY")`.
     This allows `fundsignal_loop.py` and `live_loop.py:65`. 3-tuples such as `_PROPAGATED_HEADERS` are out of scope by construction.
   - **(c)** Assert that `app.identity` imports nothing from `app`: an AST check of its `ImportFrom` nodes.
2. `tests/test_owner_header_guard.py` additions. Each one also asserts that no recorded call has an empty or absent `x-user-id` (reuse `_assert_owner_headers` where at least one call is expected):
   - **Opportunity tick** with `distinct_user_ids` returning `["bob", ""]`: outbound calls go out only as `bob`, and `schedule.advance` is called.
   - **Template sweep:** intents `[{user_id:"", state:"COMMITTED", …}, {user_id:"bob", state:"COMMITTED", …}]`. The first is skipped with no indicators call, the second is finalized as `bob`, and `schedule.advance(_INTENT_SWEEP_SECONDS)` is called (design fix B).
   - **`_materialize_readiness_for_owner("", …)`** raises `ValueError`, and the materializer tick with owners `{"": …, "bob": …}` still warms `bob`.
   - **The three drains:** `_drain_owner_signals("")`, `_drain_held("")` and `_drain_watchlist("")` each raise `ValueError` with **zero** stub calls. A `_run_cycle` over `[_row("s-x", ""), _row("s-bob", "bob")]` still evaluates `s-bob`, every call carries `bob`, and the cycle does not raise.
   - **`StrategyEvaluator(stub).for_owner("")`** raises `ValueError`.
   - **AC-17:** `make_consumer()` handling an `order.filled` `make_event(…)` whose payload has `user_id=""` produces zero ingest and indicators stub calls, inserts the snapshot (`FakeSnapshots` records it), and emits `analysis.snapshot.degraded`. Name the test `test_ac17_ownerless_order_event_issues_no_owner_scoped_call`.
3. Fixture data (C-13): `_row`, `ORDER_PAYLOAD` and `make_event` are reused from their existing homes. The new literals (`["bob", ""]`, the intent dicts) are single-consumer scenario one-offs, so they stay inline.

**Verification**:
```bash
cd services/xstockstrat-analysis
uv run pytest tests/test_identity.py tests/test_owner_header_guard.py -q
uv run pytest --cov=app --cov-fail-under=40
ruff check . && ruff format --check .
grep -n "from tests.conftest\|from tests.test_" tests/test_identity.py tests/test_owner_header_guard.py
```

---

### Step 8 — service: analysis inbound identity gate (`owner_scoped`) on 22 RPCs (FR-1)

**Status**: `done`
**Service**: `xstockstrat-analysis`
**Files**:
- `services/xstockstrat-analysis/app/handlers/servicer.py` — modify
- `services/xstockstrat-analysis/app/repositories/backtest_runs.py` — modify (stale nullable comment only)

**Reviewers**: Service owner — xstockstrat-analysis — backtest reproducibility, strategy scoring determinism, no look-ahead bias

**Codebase Evidence**:
- The 23 RPC methods are listed by `grep -n "    async def [A-Z]" app/handlers/servicer.py`; `analysis.proto` declares 23 `rpc`s. The design §1 exemption is `RunFundamentalsScan` (`:3472`, admin gate at `:3478-3480`). The 22 to decorate are:
  - RunBacktest `:696`, ScoreStrategy `:2307`, ListStrategies `:2656`, GetStrategyReport `:2675`;
  - ListBacktests `:2703`, GetBacktest `:2737`, ManageStrategy `:2771`, GetStrategy `:2986`;
  - ListStrategyDefinitions `:3023`, SetStrategyLive `:3050`, ListTemplates `:3181`, ManageTemplate `:3192`;
  - InstantiateTemplate `:3298`, ScreenSymbols `:3418`, EvaluateReadiness `:3501`, GetWatchlistReadiness `:3663`;
  - QueryPnLPatterns `:3909`, GetAttribution `:3962`, GetIndicatorSeries `:4049`, ListOpportunities `:4175`;
  - SetOpportunityAction `:5679`, GetStrategyAnalytics `:5790`.
- Classifier: `_caller_user_id` (`servicer.py:562-576`, a `@staticmethod`) currently returns `"" if caller == SYSTEM_IDENTITY else caller` and has no inbound grant check.
- Raw `x-user-id` readers that bypass it: ScreenSymbols `:3463`, ListOpportunities `:4198`, SetOpportunityAction `:5685-5688` (`INVALID_ARGUMENT "missing user identity"`), GetStrategyAnalytics `:5804`.
- Headerless branches that become unreachable once the gate runs first (orphans to delete):
  - RunBacktest: `:763-768` (`… if caller_user_id else None`); `user_id=caller_user_id or None` at `:1152`, `:1174` and `:1179`.
  - ScoreStrategy `:2328-2332`; GetStrategyReport `:2679-2683`; ListBacktests `:2716-2720`.
  - ManageStrategy `:2775-2777` (`if not caller_user_id: abort PERMISSION_DENIED`).
  - GetStrategy `:2994-2998` (`… if owner else None`).
  - SetStrategyLive `:3054-3056`.
  - ListTemplates `:3182-3184`.
  - ManageTemplate `:3194`: the `not caller_user_id or` disjunct; keep the admin-scope check.
  - InstantiateTemplate `:3300-3302`.
  - EvaluateReadiness `:3521-3525`; GetWatchlistReadiness `:3680-3682`.
  - GetAttribution `:3967`: the `not caller or` disjunct.
  - GetIndicatorSeries `:4067-4071`; GetStrategyAnalytics `:5810-5814`.
- Keep GetBacktest's `if not owner or owner != caller_user_id` (`:2762`). `backtest_details.user_id` stays nullable (design Open Risk 3).
- `backtest_runs.py:43-44` comment: "user_id, … are all NULLABLE: an inline/legacy run has no owner" — this becomes false for `user_id` once 027 runs.
- Stale docstring at `servicer.py:6630`: "Convert an analysis.strategy_scores row" (the table 027 drops; the row is `strategy_scores_v2`).
- Existing UNAUTHENTICATED precedent: indicators `ListTemplates` (`services/xstockstrat-indicators/app/handlers/servicer.py:618-619`).

**TDD**: `red-green required` (paired with Step 9)

**Covers**: —

**Instructions**:
1. Above the servicer class, add:
   - a module-level `class _CallerRejected(Exception)` that carries `code` and `message`;
   - a module-level `owner_scoped` decorator:
     ```python
     def owner_scoped(fn):
         @functools.wraps(fn)
         async def wrapper(self, request, context):
             try:
                 self._caller_user_id(context)
             except _CallerRejected as e:
                 await context.abort(e.code, e.message)
                 return None
             return await fn(self, request, context)
         wrapper.__owner_scoped__ = True
         return wrapper
     ```
   The explicit `return None` after `abort` is required: test contexts may use a non-raising abort (design §1, adv2 note). Add `import functools`.
2. Rewrite `_caller_user_id(context) -> str`:
   - no or empty `x-user-id` → `raise _CallerRejected(grpc.StatusCode.UNAUTHENTICATED, "x-user-id required")`;
   - `== SYSTEM_IDENTITY` → `raise _CallerRejected(grpc.StatusCode.PERMISSION_DENIED, "the system identity is not granted on analysis")`;
   - otherwise return the id.
   Replace the docstring at `:564-574` with a ≤2-line constraint statement: analysis has no inbound `system` grant, and the decorator guarantees that a body never sees a raise.
3. Apply `@owner_scoped` to the 22 RPCs above. **Do not** decorate `RunFundamentalsScan`.
4. Route the raw readers through `self._caller_user_id(context)`:
   - ScreenSymbols `:3463` and GetStrategyAnalytics `:5804`;
   - ListOpportunities `:4198`;
   - SetOpportunityAction: replace `:5685-5688` with `user_id = self._caller_user_id(context)` and delete the `INVALID_ARGUMENT "missing user identity"` branch.
5. Delete the orphan headerless branches listed in the evidence. Simplify `x if caller_user_id else None` to `x`, and `user_id=caller_user_id or None` to `user_id=caller_user_id` at `:1152`, `:1174` and `:1179`. That makes every `backtest_runs` insert carry a non-empty owner, which is required by FR-3's NOT NULL.
6. In `backtest_runs.py:43-44`, reword the comment so that only `sizing_mode`/`position_weight`/`max_concurrent`/`fill_model` are described as nullable, and change the `user_id: str | None = None` annotation to `user_id: str`. Do not change the SQL.
7. Fix the `servicer.py:6630` docstring to name `analysis.strategy_scores_v2`.

**Verification**:
```bash
cd services/xstockstrat-analysis
python3 - <<'PY'
import ast,sys
src=open("app/handlers/servicer.py").read(); t=ast.parse(src)
cls=[n for n in t.body if isinstance(n,ast.ClassDef) and n.name.endswith("Servicer")][0]
rpcs=[f for f in cls.body if isinstance(f,ast.AsyncFunctionDef) and f.name[0].isupper()]
undec={f.name for f in rpcs if not any(getattr(d,"id",None)=="owner_scoped" for d in f.decorator_list)}
assert undec=={"RunFundamentalsScan"}, undec; print("22 decorated, exempt:",undec)
PY
grep -n 'invocation_metadata()).get("x-user-id"' app/handlers/servicer.py   # expect only inside _caller_user_id
ruff check . && ruff format --check .
```

---

### Step 9 — test: analysis gate completeness + AC-8, AC-16, SetOpportunityAction, test churn

**Status**: `done`
**Service**: `xstockstrat-analysis`
**Files**:
- `services/xstockstrat-analysis/tests/conftest.py` — modify (add `OWNER_HEADERS`, `OTHER_HEADERS`)
- `services/xstockstrat-analysis/tests/test_owner_scoped_completeness.py` — create
- `services/xstockstrat-analysis/tests/test_analysis_servicer.py` — modify (churn; `test_unauthenticated_caller_denied` at `:954`)
- `services/xstockstrat-analysis/tests/test_query_pnl_patterns.py` — modify (churn rule (ii): the `None` contexts at `:86-88,:106-108` become `ctx_with(OWNER_HEADERS)`, else the Step-8 decorator crashes them)
- `services/xstockstrat-analysis/tests/*.py` — modify only the suites that the red run shows calling an RPC headerless (churn rule below; list each touched file in the step commit)

**Reviewers**: Service owner — xstockstrat-analysis — backtest reproducibility, strategy scoring determinism

**Codebase Evidence**:
- `tests/conftest.py:33-38` — `ctx_with(headers)` replays headers, and its `abort` **raises** (`AsyncMock(side_effect=Exception("aborted"))`).
- Descriptor: `gen.analysis.v1.analysis_pb2.DESCRIPTOR.services_by_name["AnalysisService"].methods` (`packages/proto/analysis/v1/analysis.proto:12`, 23 rpcs).
- `tests/test_analysis_servicer.py:954-967` `test_unauthenticated_caller_denied` currently asserts `PERMISSION_DENIED` for a headerless `SetStrategyLive`. That is a churn-rule (i) test.
- `tests/test_query_pnl_patterns.py:73-108` calls `QueryPnLPatterns(…, None)` with no context. That is churn rule (ii), fixed **in this step** (Step 8's decorator would otherwise crash it and fail this step's full-suite run); Step 11 only adds the owner-filter fake + new tests.
- `_BOB` in `tests/test_owner_header_guard.py:41` is a single-file constant. The new `OWNER_HEADERS` gets a second consumer here, so it moves into `conftest.py` (C-13).

**TDD**: `red-green required`. Before Step 8, headerless calls get `PERMISSION_DENIED`, `INVALID_ARGUMENT` or an empty response, and `system` gets "owns nothing" rather than `PERMISSION_DENIED`.

**Covers**: `AC-8, AC-16`

**Instructions**:
1. `tests/conftest.py`: add `OWNER_HEADERS = [("x-user-id", "u-1"), ("x-access-scope", "1"), ("x-trace-id", "t-1")]` and `OTHER_HEADERS` (the same shape for `u-2`) next to `ctx_with`.
2. `tests/test_owner_scoped_completeness.py`:
   - **(a)** **Descriptor walk.** `EXEMPT = {"RunFundamentalsScan"}`. Assert `{m for m in descriptor methods if not getattr(getattr(AnalysisServicer, m), "__owner_scoped__", False)} == EXEMPT`, which checks both directions.
   - **(b)** For each non-exempt method, parametrized: build a context whose `abort` is a **non-raising** `AsyncMock()` and whose metadata is either:
     - headerless `[("x-trace-id","t")]` → assert `abort` was awaited once with `UNAUTHENTICATED`; or
     - `[("x-user-id","system")]` → `PERMISSION_DENIED`.
     In both cases, patch the method's body to a sentinel `AsyncMock` before decoration-time binding, or assert through `make_servicer()` mocks that no repository or stub was touched. Either way the test asserts the body was **not** entered, which guards the `return`.
   - **(c)** **AC-8:** `ListStrategies` headerless via `ctx_with` → `UNAUTHENTICATED`. Name it `test_ac8_headerless_list_strategies_unauthenticated`.
   - **(d)** **AC-16:** `ListStrategies` with `[("x-user-id","system")]` and no grant → `PERMISSION_DENIED`. Name it `test_ac16_ungranted_system_permission_denied`.
   - **(e)** **SetOpportunityAction** headerless → `UNAUTHENTICATED`, not `INVALID_ARGUMENT`.
3. **Churn rule.** Run the full suite once against the Step 8 tree **before** fixing tests, and record the failure count in context.md (the RED evidence). Then classify each failure:
   - **(i)** The test's purpose is the old headerless or `system` behaviour, e.g. `test_unauthenticated_caller_denied` at `:954`. Rewrite it to the new code: `UNAUTHENTICATED`, or `PERMISSION_DENIED` for `system`.
   - **(ii)** The test was incidentally headerless: a `None` context, or metadata with no `x-user-id` while it asserts something unrelated. Give it `OWNER_HEADERS` (or `OTHER_HEADERS` for non-owner cases) **without weakening any assertion**.
   Never delete a test under (ii). A test deleted under (i) must be named in the commit message together with the removed behaviour it covered.

**Verification**:
```bash
cd services/xstockstrat-analysis
uv run pytest tests/test_owner_scoped_completeness.py -q
uv run pytest --cov=app --cov-fail-under=40
ruff check . && ruff format --check .
grep -rn "OWNER_HEADERS\|OTHER_HEADERS" tests | grep -v "^tests/conftest.py" | head   # consumers import from conftest
```

---

### Step 10 — service: QueryPnLPatterns owner filter (FR-7)

**Status**: `done`
**Service**: `xstockstrat-analysis`
**Files**:
- `services/xstockstrat-analysis/app/repositories/pnl_pattern_samples.py` — modify
- `services/xstockstrat-analysis/app/handlers/servicer.py` — modify

**Reviewers**: Service owner — xstockstrat-analysis — backtest reproducibility, strategy scoring determinism

**Codebase Evidence**:
- `PnLPatternSamplesRepository.query(self, *, symbol, strategy_id="", from_ts=None, to_ts=None)` (`app/repositories/pnl_pattern_samples.py:35-55`) builds `conds = ["symbol=$1"]` and appends `$N` predicates by `len(args)`. It has **no** user filter.
- `QueryPnLPatterns` (`servicer.py:3909-3945`) calls `self._pnl_samples_repo.query(symbol=…, strategy_id=…, from_ts=…, to_ts=…)` at `:3920-3925`.
- Precedent: `GetAttribution` (`servicer.py:3962-3973`) scopes through `pnl_positions.list_closed_for_attribution(user_id=caller, …)`.
- `analysis.pnl_positions` has `user_id TEXT NOT NULL` (`migrations/016_order_snapshots_pnl_patterns.up.sql:39`). The index `idx_pnl_positions_user_closed (user_id, closed_at)` (`021:6-7`) does not cover `position_id`, hence the `symbol` filter inside the subquery (design §3).
- `position_id` = `user:account:symbol:mode` (`pnl_pattern_consumer.py:390-393`). Positions open only for a truthy `user_id` (`:225`).

**TDD**: `red-green required` (paired with Step 11)

**Covers**: —

**Instructions**:
1. Change `query` to `query(self, *, user_id: str, symbol: str, strategy_id: str = "", from_ts=None, to_ts=None)`. `user_id` is required and keyword-only. After the existing conditions, append `args.append(user_id)` and `conds.append(f"position_id IN (SELECT position_id FROM analysis.pnl_positions WHERE user_id = ${len(args)} AND symbol = $1)")`. Update the docstring to "The caller's samples for a symbol …".
2. In `QueryPnLPatterns`, pass `user_id=self._caller_user_id(context)`. Step 8's decorator guarantees it is non-empty. Update the docstring line "DB-only read" to "Owner-scoped DB-only read (FR-7)".

**Verification**:
```bash
cd services/xstockstrat-analysis
grep -n "pnl_positions WHERE user_id" app/repositories/pnl_pattern_samples.py
grep -n "_pnl_samples_repo.query(" -A6 app/handlers/servicer.py | grep -n "user_id="
ruff check . && ruff format --check .
```

---

### Step 11 — test: QueryPnLPatterns AC-14, AC-15

**Status**: `pending`
**Service**: `xstockstrat-analysis`
**Files**:
- `services/xstockstrat-analysis/tests/test_query_pnl_patterns.py` — modify

**Reviewers**: Service owner — xstockstrat-analysis — backtest reproducibility, strategy scoring determinism

**Codebase Evidence**:
- `tests/test_query_pnl_patterns.py:63-70` has `_FakeSamplesRepo.query(self, *, symbol, strategy_id="", from_ts=None, to_ts=None)`. This in-memory fake must take `user_id` (fails.md `200-symbol-opportunity-ranking` scope-creep rule).
- `:73-108` passed a `None` context; Step 9 already converted them to `ctx_with(OWNER_HEADERS)`.
- `_ind` and `_sig` are the row builders already in this file.
- Config key `analysis.patterns.min_sample_count` default 5 (`servicer.py:3927`).

**TDD**: `red-green required`. The fake ignores `user_id` before Step 10, and the repository SQL lacks the predicate.

**Covers**: `AC-14, AC-15`

**Instructions**:
1. Update `_FakeSamplesRepo` to store `(owner, row)` pairs and filter by `user_id` in `query(*, user_id, symbol, …)` (the existing tests already pass `ctx_with(OWNER_HEADERS)` since Step 9).
2. **AC-14, repository level.** Add a recording-DB test. A fake whose `fetch(sql, *args)` records `sql` and `args`. Call `PnLPatternSamplesRepository(db).query(user_id="u-1", symbol="AAPL")`. Assert:
   - `sql` contains `position_id IN (SELECT position_id FROM analysis.pnl_positions WHERE user_id = $2 AND symbol = $1)`;
   - `args == ("AAPL", "u-1")` (recorded `*args` tuple).
   Add one more case with `strategy_id` and both timestamps, so the `$N` index follows `len(args)` (`$5`).
3. **AC-14, servicer level.** Seed the fake with u-1 samples on AAPL and u-2 samples on AAPL. Each set has ≥ `min_sample_count`, and `sig:newsletter-b` appears only in u-2's samples. Call as `OWNER_HEADERS` (u-1). Assert:
   - no returned factor is `sig:newsletter-b`;
   - each `sample_count` equals the u-1-only count.
   Name the test `test_ac14_query_pnl_patterns_returns_only_callers_samples`.
4. **AC-15:** headerless `ctx_with([("x-trace-id","t")])` → `UNAUTHENTICATED`, and the fake's `query` is never awaited. Name the test `test_ac15_headerless_query_pnl_patterns_unauthenticated`.
5. Fixture data (C-13): `OWNER_HEADERS`/`OTHER_HEADERS` come from conftest. The sample rows use this file's existing `_ind`/`_sig` builders, which have one consumer, so they stay inline.

**Verification**:
```bash
cd services/xstockstrat-analysis
uv run pytest tests/test_query_pnl_patterns.py -q
uv run pytest --cov=app --cov-fail-under=40
ruff check . && ruff format --check .
grep -n "from tests.conftest" tests/test_query_pnl_patterns.py
```

---

### Step 12 — service: indicators identity gate + `analysis` reader-bypass removal (FR-1, FR-2)

**Status**: `pending`
**Service**: `xstockstrat-indicators`
**Files**:
- `services/xstockstrat-indicators/app/handlers/servicer.py` — modify

**Reviewers**: Service owner — xstockstrat-indicators — formula sandboxing, no side-effects from formula execution

**Codebase Evidence**:
- `app/handlers/servicer.py`:
  - **Bypass:** `_INTERNAL_FORMULA_READERS = frozenset({"analysis"})` at `:27-29`, with the comment "Release-N bypass … '224 enforce' removes it". The bypass arm is in `_can_read_formula` (`:129-136`): `return any(self._internal_grant(context, c) for c in _INTERNAL_FORMULA_READERS)`.
  - **Body-`user_id` fallback:** `_caller_user_id(context, request)` (`:96-102`), used by UpdateFormula `:500` and DeleteFormula `:605`.
  - **Classifier:** `_reader(context)` (`:104-107`).
  - **`_reject_ungranted_system`** (`:118-127`) is called first in ExecuteFormula `:222`, RegisterFormula `:378`, GetFormula `:435`, ListFormulas `:457`, UpdateFormula `:483`, DeleteFormula `:588`, ListTemplates `:616` and ManageTemplate `:628`.
  - **Headerless branches:**
    - RegisterFormula `:388-393` (`INVALID_ARGUMENT "authenticated user required to register a formula"`);
    - ListTemplates `:618-620` (`UNAUTHENTICATED`, which becomes an orphan);
    - InstantiateTemplate and ResolveTemplateIntent go through `_template_owner` (`:160-168`), which aborts `PERMISSION_DENIED` on an empty or `system` owner. Keep it for the `system` refusal.
  - SAN-bound grant helper: `_internal_grant` (`:109-116`) via `app/peer_identity.py:6 peer_san_matches`. `_SYSTEM_IDENTITY_GRANT = "analysis-fundsignal"` (`:31`), `_TEMPLATE_SAGA_GRANT` (`:33`).
- RPCs (`grep -n "    async def [A-Z]"`; `indicators.proto` declares 13):
  - 10 decorated: ExecuteFormula `:221`, RegisterFormula `:377`, GetFormula `:434`, ListFormulas `:454`, UpdateFormula `:482`, DeleteFormula `:587`, ListTemplates `:614`, ManageTemplate `:626`, InstantiateTemplate `:668`, ResolveTemplateIntent `:726`.
  - EXEMPT = {ComputeIndicator `:192`, ListIndicators `:342`, ListFundamentalMetrics `:353`}.
- The saga grant `analysis-template-saga` is separate from the removed reader id (`:32-33`). The PRESERVE rules `@AC-18/@AC-19 @feature-224` depend on it.

**TDD**: `red-green required` (paired with Step 13)

**Covers**: —

**Instructions**:
1. Add a module-level `class _CallerRejected(Exception)` (`code`, `message`) and an `owner_scoped` decorator with the same shape as Step 8 (`functools.wraps`, `await context.abort(…)`, `return None`, `wrapper.__owner_scoped__ = True`). The decorator calls `self._reader(context)`. Add `import functools`.
2. Rewrite `_reader(context) -> str`:
   - empty `x-user-id` → `raise _CallerRejected(UNAUTHENTICATED, "x-user-id required")`;
   - `== SYSTEM_AUTHOR` and `not self._internal_grant(context, _SYSTEM_IDENTITY_GRANT)` → `raise _CallerRejected(PERMISSION_DENIED, "the system identity requires an internal grant")`;
   - otherwise return the id.
   It must become an instance method or take the grant check inline, because `_internal_grant` is a `@staticmethod`, so it is callable either way.
3. Apply `@owner_scoped` to the 10 RPCs. Delete `_reject_ungranted_system` and its 8 call sites.
4. **Delete the bypass (FR-2):** remove `_INTERNAL_FORMULA_READERS` and its comment (`:27-29`), and the final `return any(…)` arm of `_can_read_formula` (`:136`), so it ends with `return False`. Update the docstring to "Owner or SYSTEM_AUTHOR."
5. **Delete the body fallback:** remove `_caller_user_id` (`:96-102`). UpdateFormula `:500` and DeleteFormula `:605` compare `row["author"] != self._reader(context)`.
6. Delete the orphans: the RegisterFormula `if not author:` block (`:388-393`) and the ListTemplates `if not self._reader(context):` block (`:618-620`).

**Verification**:
```bash
cd services/xstockstrat-indicators
grep -n "_INTERNAL_FORMULA_READERS\|_reject_ungranted_system\|def _caller_user_id" app/handlers/servicer.py && exit 1 || true
grep -c "@owner_scoped" app/handlers/servicer.py   # expect 10
ruff check . && ruff format --check .
```

---

### Step 13 — test: indicators gate completeness + AC-1, AC-2, AC-10, test churn

**Status**: `pending`
**Service**: `xstockstrat-indicators`
**Files**:
- `services/xstockstrat-indicators/tests/conftest.py` — modify (add `OWNER_HEADERS`, `OTHER_HEADERS`)
- `services/xstockstrat-indicators/tests/test_owner_scoped_completeness.py` — create
- `services/xstockstrat-indicators/tests/test_formula_read_authz.py` — modify
- `services/xstockstrat-indicators/tests/*.py` — modify only the suites the red run shows as headerless (churn rule as in Step 9; list each in the commit)

**Reviewers**: Service owner — xstockstrat-indicators — formula sandboxing, no side-effects from formula execution

**Codebase Evidence**:
- `tests/conftest.py:17-29` — `ctx_with(metadata, peer_sans=())`, whose `abort` raises `grpc.RpcError`.
- `tests/test_formula_read_authz.py:53-69` — `test_allowed_readers[internal-analysis-san-bound]` asserts that the SAN-bound `analysis` reader **can** read `user-a`'s formula. This is churn rule (i): it inverts to AC-2.
- `:71-90` — the header-without-SAN, other-SAN and unlisted-caller cases stay `NOT_FOUND`.
- `:93-98` — `test_other_user_cannot_execute_private_formula` asserts `NOT_FOUND` for an identified non-owner.
- `tests/test_formula_templates.py:457` — the comment "N-only formula-reader bypass id" is stale after Step 12. The case itself (`PERMISSION_DENIED`) is unchanged.
- Descriptor: `indicators_pb2.DESCRIPTOR.services_by_name["IndicatorsService"]` (`indicators.proto:14`, 13 rpcs).

**TDD**: `red-green required`. Before Step 12, a headerless `ListFormulas` returns system rows, and the SAN-bound `analysis` reader reads another user's formula.

**Covers**: `AC-1, AC-2, AC-10`

**Instructions**:
1. `tests/conftest.py`: add `OWNER_HEADERS = [("x-user-id","user-a"), ("x-access-scope","1"), ("x-trace-id","t-1")]` and `OTHER_HEADERS` (`user-b`).
2. `tests/test_owner_scoped_completeness.py`:
   - **(a)** Descriptor walk `{undecorated} == {"ComputeIndicator","ListIndicators","ListFundamentalMetrics"}`.
   - **(b)** Per non-exempt method, with a **non-raising** `abort`:
     - headerless → `UNAUTHENTICATED`;
     - `system` without a grant → `PERMISSION_DENIED`;
     - `system` + `x-internal-caller: analysis-fundsignal` **without** the SAN → `PERMISSION_DENIED` (the grant-without-SAN case).
     Each case asserts the body was not entered.
   - **(c)** Positive control: `system` + the fundsignal grant + SAN `xstockstrat-analysis` passes the gate on `GetFormula` for a `SYSTEM_AUTHOR` formula.
3. **AC-1:** headerless `ListFormulas` → `UNAUTHENTICATED`, and the repository list is never awaited (no rows). Name it `test_ac1_headerless_list_formulas_unauthenticated`.
4. **AC-2:** in `test_formula_read_authz.py`, move the `internal-analysis-san-bound` row out of `test_allowed_readers` into `test_ac2_san_bound_analysis_reader_bypass_removed`. A call as `user-b` + `x-internal-caller: analysis` + SAN `xstockstrat-analysis` on `GetFormula("f-1")` (owner `user-a`) → `NOT_FOUND`.
5. **AC-10:** `test_ac10_identified_non_owner_get_formula_not_found`. `GetFormula` as `user-b` → `NOT_FOUND`. This is a characterization test, green before Step 12; record that.
6. Apply the churn rule as defined in Step 9. Fix the stale comment at `test_formula_templates.py:457`.

**Verification**:
```bash
cd services/xstockstrat-indicators
uv run pytest tests/test_owner_scoped_completeness.py tests/test_formula_read_authz.py -q
uv run pytest --cov=app --cov-fail-under=50
ruff check . && ruff format --check .
grep -rn "OWNER_HEADERS\|OTHER_HEADERS" tests | grep -v "^tests/conftest.py" | head
```

---

### Step 14 — service: indicators stops writing `is_public` on every write path (FR-4)

**Status**: `pending`
**Service**: `xstockstrat-indicators`
**Files**:
- `services/xstockstrat-indicators/app/services/formulas_repository.py` — modify
- `services/xstockstrat-indicators/app/handlers/servicer.py` — modify
- `services/xstockstrat-indicators/app/services/seed_formulas.py` — modify
- `services/xstockstrat-indicators/app/formulas/fundamentals_value_quality.py` — modify

**Reviewers**: Service owner — xstockstrat-indicators — no side-effects from formula execution

**Codebase Evidence**:
- `app/services/formulas_repository.py`:
  - `_INSERT_SQL` (`:45-53`) lists `is_public` as column 6 / `$6`.
  - `_insert_args(… is_public, …)` (`:56-90`, positional at `:62` and `:78`).
  - `create` (`:96-98`) and `create_pending_copies` (`:100-108`) both use `_INSERT_SQL`. Those are the Register and template-instantiate paths.
  - `upsert(… is_public, …)` (`:125-174`): inline SQL with `is_public` in the column list (`:145`), the `ON CONFLICT … is_public = EXCLUDED.is_public` clause (`:153`) and the args (`:167`).
  - `update(… is_public, …)` (`:213-245`): inline SQL `SET … is_public = $5` (`:228`) and the arg (`:239`).
  - Reads are `SELECT *` (`:178`, `:203`). `_row_to_formula` (`app/handlers/servicer.py:804-826`) does not map `is_public`.
- `is_public=` callers:
  - servicer RegisterFormula `:425`, UpdateFormula `:578`, `_template_copy` `:766` (plus the docstring at `:756-757`);
  - `seed_formulas.py:40` (`is_public=fvq.IS_PUBLIC`);
  - `fundamentals_value_quality.py:28` (`IS_PUBLIC = False`, imported by `tests/test_fundamentals_formula.py:14`).
- The column keeps `NOT NULL DEFAULT FALSE` (`migrations/001_formulas.up.sql:9`), so omitting it on INSERT is valid. Dropping it is deferred to a later contract (FR-4).

**TDD**: `red-green required` (paired with Step 15)

**Covers**: —

**Instructions**:
1. `_INSERT_SQL`: remove `is_public` from the column list and renumber the placeholders to `$1..$13`: `$1::uuid, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8::jsonb, $9, $10::jsonb, $11, $12, $13::uuid`. Remove `is_public` from `_insert_args`' signature and from its returned tuple.
2. Hoist the inline `upsert` SQL into a module constant `_UPSERT_SQL`, and the inline `update` SQL into `_UPDATE_SQL`. They are needed for Step 16's extraction and Step 15's routing test. Put them next to `_INSERT_SQL`, with the closing `"""` on its own line at column 0, matching `_INSERT_SQL`.
   - In `_UPSERT_SQL`, remove `is_public` from the column list, the `VALUES` (renumber to `$1..$10`) and the `ON CONFLICT` set list.
   - In `_UPDATE_SQL`, remove `is_public = $5` and renumber to `$1..$8`.
   - Drop the `is_public` parameter from `upsert` and `update`, and pass the constants.
3. Servicer: delete `is_public=False` at `:425` and `:578`, and `"is_public": False` at `:766`. Change the `_template_copy` docstring (`:756-757`) to "the payload's deprecated author is ignored".
4. `seed_formulas.py:40`: delete `is_public=fvq.IS_PUBLIC,`. `fundamentals_value_quality.py:28`: delete `IS_PUBLIC = False`.

**Verification**:
```bash
cd services/xstockstrat-indicators
grep -rn "is_public\|IS_PUBLIC" app && exit 1 || true
grep -n "^_INSERT_SQL = \|^_UPDATE_SQL = \|^_UPSERT_SQL = " app/services/formulas_repository.py   # expect 3
ruff check . && ruff format --check .
```

---

### Step 15 — test: indicators `is_public` routing + static absence (AC-11 unit half), test churn

**Status**: `pending`
**Service**: `xstockstrat-indicators`
**Files**:
- `services/xstockstrat-indicators/tests/test_formulas.py` — modify
- `services/xstockstrat-indicators/tests/test_private_formulas.py` — modify
- `services/xstockstrat-indicators/tests/test_formula_read_authz.py` — modify
- `services/xstockstrat-indicators/tests/test_fundamentals_formula.py` — modify
- `services/xstockstrat-indicators/tests/test_formula_templates.py` — modify

**Reviewers**: Service owner — xstockstrat-indicators — no side-effects from formula execution

**Codebase Evidence**:
- `grep -c "is_public\|IS_PUBLIC" tests/*.py` gives:
  - `test_formulas.py` 13, `test_private_formulas.py` 11;
  - `test_formula_read_authz.py` 4, `test_formula_templates.py` 4, `test_fundamentals_formula.py` 4.
- Most of these assert `kw["is_public"] is False` on repository-call kwargs. `test_fundamentals_formula.py:14` imports `IS_PUBLIC`, and `:144` asserts `IS_PUBLIC is False`.
- PRESERVE `@AC-3 @FR-1 @feature-224` ("Setting is_public has no effect", `services/xstockstrat-indicators/acceptance/private-by-default-templates.feature`): the read-back `FormulaDefinition.is_public` must still be false.

**TDD**: `red-green required`. The new assertions that no repository call passes `is_public`, and that the three SQL constants lack it, fail before Step 14.

**Covers**: `AC-11` (unit half; Step 16 is the real-schema half)

**Instructions**:
1. **Static check:** add a test in `test_formulas.py` that imports `_INSERT_SQL`, `_UPDATE_SQL` and `_UPSERT_SQL` from `app.services.formulas_repository` and asserts `"is_public" not in` each.
2. **Routing tests:** with a recording fake pool, assert:
   - `FormulasRepository.create` and `create_pending_copies` execute `_INSERT_SQL` with 13 args;
   - `update` executes `_UPDATE_SQL` with 8 args;
   - `upsert` executes `_UPSERT_SQL` with 10 args.
3. **Churn:**
   - Replace every `kw["is_public"] is False` assertion with `"is_public" not in kw`, so each still asserts something about the write.
   - In `test_fundamentals_formula.py`, drop the `IS_PUBLIC` import and its clause at `:144`. Keep the `FORMULA_ID` and `AUTHOR == "system"` assertions.
   - Keep any assertion that the **read-back** proto has `is_public == False` (PRESERVE `@AC-3 @feature-224`).

**Verification**:
```bash
cd services/xstockstrat-indicators
grep -rn 'kw\["is_public"\]\|IS_PUBLIC' tests && exit 1 || true
uv run pytest --cov=app --cov-fail-under=50
ruff check . && ruff format --check .
```

---

### Step 16 — test: AC-11 real-schema harness in `migration-rerun.sh`

**Status**: `pending`
**Service**: platform tooling (`scripts/`)
**Files**:
- `scripts/migration-rerun.sh` — modify

**Reviewers**: DBA — run-order compliance with `scripts/db-migrate.sh`; Service owner — xstockstrat-indicators

**Codebase Evidence**:
- After Step 14, `services/xstockstrat-indicators/app/services/formulas_repository.py` holds the module constants `_INSERT_SQL` (13 params), `_UPDATE_SQL` (8) and `_UPSERT_SQL` (10). Each is a `NAME = """` line … `"""` line at column 0.
- `scripts/migration-rerun.sh` runs under `set -euo pipefail` with `psql "$DATABASE_URL" -v ON_ERROR_STOP=1`. Its assertion loop is at `:86-93` (moved below the refusal block by Step 5).
- `indicators.formulas.is_public` is `NOT NULL DEFAULT FALSE` (`indicators/migrations/001_formulas.up.sql:9`). The test drops it inside a rolled-back transaction (operator decision 2026-10-09, context.md).
- The CI `migrations` filter covers this file after Step 1 (4a).

**TDD**: `red-green required`. Against the pre-Step-14 constants, `_INSERT_SQL` still names `is_public` and the harness fails.

**Covers**: `AC-11`

**Instructions**:
1. Add `FORMULAS_REPO="$REPO_ROOT/services/xstockstrat-indicators/app/services/formulas_repository.py"` and `repo_sql() { awk -v n="$1" '$0 ~ "^" n " = \"\"\"" {f=1; next} f && /^"""/ {exit} f' "$FORMULAS_REPO"; }`.
2. Add `max_param() { printf '%s' "$1" | grep -oE '\$[0-9]+' | tr -d '$' | sort -n | tail -1; }`.
3. Add `check_params <NAME> <expected>`. It fails loudly with `AC-11: <NAME> has N params, harness supplies M` when the counts differ, so a silently mismatched value list cannot pass (design §5, adv2 note).
4. After the final assertions, build a temp SQL file and run it with `psql -v ON_ERROR_STOP=1 -f`:
   ```
   BEGIN;
   ALTER TABLE indicators.formulas DROP COLUMN is_public;
   PREPARE ins AS <_INSERT_SQL>;
   EXECUTE ins('00000000-0000-4000-8225-000000000011', 'ac11', '', 'result = close', 'u-ac11', '{}', '[]', '[]', 0, '[]', NULL, NULL, NULL);             -- RegisterFormula
   EXECUTE ins('00000000-0000-4000-8225-000000000012', 'ac11-tpl', '', 'result = close', 'u-ac11', '{}', '[]', '[]', 0, '[]', 'tpl-ac11', 1, '00000000-0000-4000-8225-0000000000a1');   -- template instantiate
   PREPARE upd AS <_UPDATE_SQL>;
   EXECUTE upd('00000000-0000-4000-8225-000000000011', 'ac11b', '', 'result = open', '[]', '[]', 0, '[]');                                       -- UpdateFormula
   PREPARE ups AS <_UPSERT_SQL>;
   EXECUTE ups('00000000-0000-4000-8225-000000000013', 'ac11-seed', '', 'result = close', 'system', '{}', '[]', '[]', 0, '[]');               -- seed upsert
   EXECUTE ups('00000000-0000-4000-8225-000000000013', 'ac11-seed2', '', 'result = close', 'system', '{}', '[]', '[]', 0, '[]');              -- seed upsert (conflict path)
   ROLLBACK;
   ```
   Call `check_params _INSERT_SQL 13`, `check_params _UPDATE_SQL 8` and `check_params _UPSERT_SQL 10` before writing the file. Each extracted constant must be non-empty, or the script fails naming it. Echo `==> AC-11: indicators write SQL runs without is_public`.

**Verification**:
```bash
shellcheck scripts/migration-rerun.sh && shfmt -d -i 2 scripts/migration-rerun.sh && bash -n scripts/migration-rerun.sh
# offline extraction smoke (no DB):
bash -c 'source <(sed -n "/^repo_sql()/p;/^max_param()/p" scripts/migration-rerun.sh); FORMULAS_REPO=services/xstockstrat-indicators/app/services/formulas_repository.py; for n in _INSERT_SQL _UPDATE_SQL _UPSERT_SQL; do s="$(repo_sql $n)"; [ -n "$s" ] && echo "$n $(max_param "$s")"; done'   # expect 13 / 8 / 10
# Authoritative: the CI `migration-rerun` job on this step's PR is green.
```
Coverage: N/A (`scripts/` has no CI coverage gate).

---

### Step 17 — service: ingest identity gate, owner accessor, headerless fallbacks removed (FR-1, FR-6)

**Status**: `pending`
**Service**: `xstockstrat-ingest`
**Files**:
- `services/xstockstrat-ingest/app/handlers/servicer.py` — modify
- `services/xstockstrat-ingest/app/config/watcher.py` — modify (docstring drift only)

**Reviewers**: Service owner — xstockstrat-ingest — signal normalization correctness, idempotent ingestion, newsletter source schema stability

**Codebase Evidence**:
- Line numbers below are as on this branch. After merging `origin/main-dev`, lines past `:255` are −1 (see Step Dependencies).
- `app/handlers/servicer.py`:
  - `_SystemIdentityDenied` (`:80-82`); `_SYSTEM_GRANTS` (`:86-91`), which is per-RPC; `_SYSTEM_GRANT_SAN` (`:92`).
  - `_resolve_owner(context, rpc) -> str | None` (`:329-342`) returns `None` when headerless.
  - `_owner_or_abort` (`:344-349`) is called in IngestSignal `:928`, QuerySignals `:1155`, ListSignalSources `:1280`, ManageSignalSource `:1364`, ListTemplates `:1530`, ManageTemplate `:1540` and InstantiateTemplate `:1595`.
- Headerless fallbacks:
  - `_ingest_external_signal(…, owner: str | None = None)` (`:949-988`): the slug-holder branch `if owner is None:` at `:977-988`, plus `_SignalSourceAmbiguous` (`:78`) caught at `:941-943`.
  - QuerySignals `elif owner is not None:` (`:1169`), with the comment "Headerless (release N only) stays unscoped" at `:1164`.
  - ListSignalSources `else: … list_all_sources` (`:1296-1297`).
  - ManageSignalSource `:1369-1372` (headerless admin gate) and `:1381-1392` (slug-holder target).
  - `_register_conflict` `owner is None` branch (`:1340-1343`) and `owner: str | None` signature (`:1334`).
  - `_abort_missing_source` `owner not in (None, SYSTEM_OWNER)` (`:1353`).
  - InstantiateTemplate `if owner is None:` (`:1598-1602`).
  - `_admin_foreign_owner` `owner is None or` (`:351-354`).
- Imports: `list_all_sources` (`:33`) is used in the servicer only at `:1297`. `app/engine/mcp_client_loop.py:26,132` imports it independently, so the repository function stays. `slug_holders` (`:39`) stays, because `:1353` and `:1500` still use it.
- The in-process caller `mcp_client_loop.poll_one_source` (`app/engine/mcp_client_loop.py:101-125`) always passes `owner=src["user_id"]` and resolves `cfg_watcher.resolve_secret(key, user_id=owner)` (`:115`). That is the per-user resolution with no global fallback that FR-6 guards.
- Watcher docstring drift: `app/config/watcher.py:25-27` gives the `credentials_ref` example as `'ingest.mcp_credential.<slug>'` (recon flagged this).
- RPCs (`ingest.proto` declares 12):
  - 7 decorated: IngestSignal `:918`, QuerySignals `:1150`, ListSignalSources `:1276`, ManageSignalSource `:1360`, ListTemplates `:1526`, ManageTemplate `:1536`, InstantiateTemplate `:1591`.
  - EXEMPT = {TriggerBackfill `:368`, CancelBackfill `:848`, GetBackfillStatus `:810`, ListBackfillJobs `:820`, NormalizeRawData `:890`}.

**TDD**: `red-green required` (paired with Step 18)

**Covers**: —

**Instructions**:
1. Replace `_SystemIdentityDenied` with `class _CallerRejected(Exception)` (`code`, `message`).
2. Add a module-level `_CURRENT_RPC: contextvars.ContextVar[str]`. Add an `owner_scoped` decorator with the Step 8 shape that:
   - sets `token = _CURRENT_RPC.set(fn.__name__)`;
   - resolves `self._resolve_owner(context, fn.__name__)`;
   - on `_CallerRejected`, awaits `context.abort` and **returns `None`**;
   - otherwise awaits `fn` inside `try/finally: _CURRENT_RPC.reset(token)`;
   - sets `wrapper.__owner_scoped__ = True`.
   Add `import contextvars, functools`.
3. Rewrite `_resolve_owner(context, rpc) -> str`:
   - missing `x-user-id` → `raise _CallerRejected(UNAUTHENTICATED, "x-user-id required")`;
   - `system` without a grant covering `rpc` + SAN → `raise _CallerRejected(PERMISSION_DENIED, …)`, keeping the existing message.
   Add `def _owner(self, context) -> str: return self._resolve_owner(context, _CURRENT_RPC.get())`. A body can then only resolve under its own RPC's grant key (design §1, adv2 note).
4. Apply `@owner_scoped` to the 7 RPCs. Replace each `ok, owner = await self._owner_or_abort(context, "<Rpc>")` / `if not ok: return` pair with `owner = self._owner(context)`; in ListTemplates the pair is simply dropped. Delete `_owner_or_abort`.
5. Remove the headerless fallbacks:
   - `_ingest_external_signal(…, owner: str)` becomes required. Delete the `if owner is None:` block (`:977-988`). `missing` is always `_SignalSourceNotFound`, so simplify the comment above it to the headered rule.
   - Delete `_SignalSourceAmbiguous` and its `except` (`:941-943`).
   - QuerySignals: `elif owner is not None:` → `else:`, and delete the `:1164` comment.
   - ListSignalSources: delete the `else` (`:1296-1297`), turn `elif owner is not None:` into `else:`, and drop `list_all_sources` from the servicer import.
   - ManageSignalSource: delete `:1369-1372`; delete `:1381-1392` and keep `target = owner`.
   - `_register_conflict(owner: str, …)`: delete `:1340-1343`.
   - `_abort_missing_source`: `owner != SYSTEM_OWNER`.
   - InstantiateTemplate: delete `:1598-1602`.
   - `_admin_foreign_owner(owner: str, …)`: drop `owner is None or`.
   - Update the docstrings/comments that mention "release N"/"headerless" at `:330-333`, `:956-957`, the `_register_conflict` docstring (`:1337`) and the comment above the deleted ManageSignalSource block (`:1367-1368`).
6. `watcher.py:25-27`: change the example to `'ingest.mcp_credential.<uuid>'` / `('ingest', 'mcp_credential.<uuid>')`. This is the shape AC-7 uses.

**Verification**:
```bash
cd services/xstockstrat-ingest
grep -n "_owner_or_abort\|_SystemIdentityDenied\|_SignalSourceAmbiguous\|owner is None\|release N\|headerless" app/handlers/servicer.py && exit 1 || true
grep -c "@owner_scoped" app/handlers/servicer.py   # expect 7
ruff check . && ruff format --check .
```

---

### Step 18 — test: ingest gate completeness + AC-9, AC-7, grant pinning, dedup after 014, test churn

**Status**: `pending`
**Service**: `xstockstrat-ingest`
**Files**:
- `services/xstockstrat-ingest/tests/test_owner_scoped_completeness.py` — create
- `services/xstockstrat-ingest/tests/test_signal_ownership.py` — modify
- `services/xstockstrat-ingest/tests/test_mcp_client_loop.py` — modify
- `services/xstockstrat-ingest/tests/test_ingest_servicer.py` — modify (churn; headerless register at `:1359-1372`)
- `services/xstockstrat-ingest/tests/conftest.py` — modify (`_ctx` docstring "headerless N caller" wording only)

**Reviewers**: Service owner — xstockstrat-ingest — idempotent ingestion, signal normalization correctness

**Codebase Evidence**:
- `tests/conftest.py:15-42` — `_ctx(access_scope="4", user_id="u1", peer_sans=(), internal_caller="")`. `user_id=""` omits the header, and `abort` raises.
- `tests/test_signal_ownership.py` headerless tests to classify under churn rule (i):
  - `:195` `test_headerless_ingest_zero_holders_invalid_argument`;
  - `:204` `test_headerless_ingest_ambiguous_holders_failed_precondition`;
  - `:213` `test_headerless_ingest_unique_holder_files_into_that_owner`;
  - `:294` `test_headerless_query_keeps_unscoped_behaviour`;
  - the headerless ListSignalSources case near `:338`.
- `:135` already asserts `"signal_dedup_keys" not in claim_sql`.
- `tests/_helpers.py transaction_conn(…, slug_holders=…)` is the IngestSignal transaction mock.
- `tests/test_mcp_client_loop.py:202-213` — a scoped GetSecret fake keyed `(key, user_id)` that records `scoped_calls`. `:266-274` — `test_resolve_secret_sends_exact_user_scope`.
- Descriptor: `ingest_pb2.DESCRIPTOR.services_by_name["IngestService"]` (`ingest.proto:12`, 12 rpcs).

**TDD**: `red-green required`. Before Step 17, headerless IngestSignal resolves the slug holder and writes. AC-7 is a **characterization** of FR-6 (no code change) and is green on its first run; record that.

**Covers**: `AC-7, AC-9`

**Instructions**:
1. `tests/test_owner_scoped_completeness.py`:
   - **(a)** Descriptor walk `{undecorated} == {"TriggerBackfill","CancelBackfill","GetBackfillStatus","ListBackfillJobs","NormalizeRawData"}`.
   - **(b)** Per non-exempt method, with a non-raising abort, assert that the body was not entered and that the DB mock was not touched:
     - headerless (`_ctx(user_id="")`) → `UNAUTHENTICATED`;
     - `system` without a grant → `PERMISSION_DENIED`;
     - `system` + `internal_caller="analysis-fundsignal"` without SAN → `PERMISSION_DENIED`.
   - **(c)** Positive control: `system` + `analysis-fundsignal` + SAN `xstockstrat-analysis` on `IngestSignal` passes the gate.
   - **(d)** **Grant pinning.** `system` + `analysis-system-read` + SAN (granted only for QuerySignals and ListSignalSources) on `IngestSignal` → `PERMISSION_DENIED`. Also, inside a decorated `QuerySignals` body, `_owner(context)` resolves under `"QuerySignals"`: patch `_resolve_owner` to record its `rpc` argument.
2. **AC-9:** source `newsletter-a` owned only by `u-1`. Call IngestSignal with `_ctx(user_id="")` and assert:
   - the result is `UNAUTHENTICATED`;
   - no `INSERT INTO ingest.newsletter_signals` was executed on the `transaction_conn` mock.
   Name the test `test_ac9_headerless_ingest_signal_unauthenticated`.
3. **AC-7:** in `test_mcp_client_loop.py`, seed the scoped fake with both `("mcp_credential.6f1c2a9e-3b7d-4e21-9a55-0c8d1e2f4b10", "")` (global) and `(…, "u-1")` (per-user). Poll one `mcp_client` source owned by `u-1`, then assert:
   - `scoped_calls == [("mcp_credential.6f1c2a9e-3b7d-4e21-9a55-0c8d1e2f4b10", "u-1")]`;
   - the bearer passed to the fake MCP client is u-1's value.
   Name the test `test_ac7_mcp_client_bearer_resolves_per_user_only`.
4. **Dedup after the 014 drop:** add a static test asserting that no file under `app/` contains `signal_dedup_keys` or `n1_owner_fill`. It walks `app/**/*.py`.
5. **Churn:**
   - Under rule (i), delete the three headerless-IngestSignal tests (`:195`, `:204`, `:213`) and the headerless-unscoped QuerySignals and ListSignalSources tests. Their removed behaviour is FR-1's slug-holder and unscoped fallbacks. Replace them with one parametrized `UNAUTHENTICATED` test per RPC, which completeness (b) already covers; name each deleted test in the commit.
   - `test_ingest_servicer.py:1359-1372` (headerless register) → `UNAUTHENTICATED`.
   - Rule (ii): use `_ctx()` defaults. Update the `conftest.py` `_ctx` docstring so `user_id=""` reads "headerless caller (rejected UNAUTHENTICATED since feature 225)".

**Verification**:
```bash
cd services/xstockstrat-ingest
uv run pytest tests/test_owner_scoped_completeness.py tests/test_signal_ownership.py tests/test_mcp_client_loop.py -q
uv run pytest --cov=app --cov-fail-under=40
ruff check . && ruff format --check .
grep -n "from tests.conftest\|from tests._helpers\|import _ctx" tests/test_owner_scoped_completeness.py
```

---

### Step 19 — docs: service CLAUDE.md drift, database recovery subsection, defect mitigation, business-rule promotion, teardown

**Status**: `pending`
**Service**: `docs/`, service `CLAUDE.md`s, acceptance suites
**Files**:
- `services/xstockstrat-indicators/CLAUDE.md` — modify
- `services/xstockstrat-analysis/CLAUDE.md` — modify
- `services/xstockstrat-ingest/CLAUDE.md` — modify
- `docs/patterns/database.md` — modify
- `docs/reports/2026-10-07-db-migrate-dirty-recovery-replay-unsafe-defect.md` — modify (append mitigation bullet; `.status` stays `open`)
- `services/xstockstrat-analysis/acceptance/order-snapshots-pnl-patterns.feature` — modify (EXTEND `@AC-3 @feature-042`)
- `docs/sdd/business-rules/platform.feature` — modify (EXTEND `@AC-35 @feature-224`; promote cross-service 225 scenarios)
- `services/xstockstrat-analysis/acceptance/private-by-default-enforce-contract.feature` — create (promoted analysis scenarios)
- `services/xstockstrat-indicators/acceptance/private-by-default-enforce-contract.feature` — create
- `services/xstockstrat-ingest/acceptance/private-by-default-enforce-contract.feature` — create

**Reviewers**: none

**Codebase Evidence**:
- **Drift sites** (`grep -rn "_INTERNAL_FORMULA_READERS\|headerless\|n1_owner_fill\|signal_dedup_keys\|224 enforce"`):
  - **indicators CLAUDE.md:**
    - `:14-15` "every write stores `is_public=false`";
    - `:17-21` "`_caller_user_id` (header, falling back to the deprecated body `user_id` … release N only)", and "no header → `INVALID_ARGUMENT`";
    - `:29-33` "`_INTERNAL_FORMULA_READERS` … release-N-only bypass … '224 enforce + contract' removes it".
  - **analysis CLAUDE.md:**
    - `:27-28` "the old bare-id `strategy_scores` table is retained only for N-1 and dropped by the follow-up";
    - `:62` "outlives the release-N `analysis` reader bypass";
    - `:71` and `:75-77` `analysis.strategy_scores` (migration `005`).
  - **ingest CLAUDE.md:**
    - `:34-35` "only the headerless release-N path keeps the ADMIN-bit check";
    - `:64-67` "Headerless tolerance (release N only…)";
    - `:92-101` the `signal_dedup_keys` table description and "kept only for N-1";
    - `:105-107` "An N-1 BEFORE INSERT trigger … fills a missing `user_id`".
- **`docs/patterns/database.md`:**
  - `:40-57` "Migration header directives (feature 224)", including "dirty-state recovery replays from version 0";
  - `:59-67` the `migration-rerun` CI bullet, which lists only the 224 expand files and an "N-1 trigger count is unchanged" check.
- **Defect report:** `docs/reports/2026-10-07-db-migrate-dirty-recovery-replay-unsafe-defect.md:60-64` "## Workaround in place". The `.status` sidecar reads `open`.
- **Business rules (design § Business rules touched):**
  - EXTEND `@AC-3 @FR-4 @feature-042` (`services/xstockstrat-analysis/acceptance/order-snapshots-pnl-patterns.feature:25-31`): replace it with the amended Gherkin in design.md.
  - EXTEND `@AC-35 @FR-14 @feature-224` (`docs/sdd/business-rules/platform.feature:306-311`): the 225 `@AC-7` case.
  - Precedent for per-service promoted suites: `services/xstockstrat-*/acceptance/private-by-default-templates.feature`.
- **Teardown:** the root `CLAUDE.md` § Teardown requires `/context-forge:context-constitution refresh` scoped to the touched context files. `.agents/context-forge.json` `scrubberExtraTargets` = `README.md`, `docs/patterns/ui-ux-governance.md`; neither is touched.

**TDD**: `N/A (docs)`

**Covers**: —

**Instructions**:
1. **indicators CLAUDE.md:**
   - `:14-15` → "No write path writes `is_public`; the column keeps `DEFAULT FALSE` and is dropped by a later contract."
   - `:17-21` → "UpdateFormula/DeleteFormula check ownership against the `x-user-id` header only."
   - Add: "Every owner-scoped RPC (all but ComputeIndicator/ListIndicators/ListFundamentalMetrics) rejects a call with no `x-user-id` `UNAUTHENTICATED` (feature 225 `owner_scoped`)."
   - Delete the `_INTERNAL_FORMULA_READERS` sentence (`:31-33`).
2. **analysis CLAUDE.md:**
   - `:27-28`: `strategy_scores` was dropped by migration `027`.
   - `:62`: drop "release-N".
   - `:71`, `:75-77`: name `strategy_scores_v2` only.
   - Add one bullet:
     - 22 RPCs reject a headerless call `UNAUTHENTICATED` and an inbound `x-user-id: system` `PERMISSION_DENIED`; `RunFundamentalsScan` is exempt because it is admin-gated.
     - Background owner metadata is built only by `app/identity.owner_metadata`, which refuses an empty or `system` owner.
     - `QueryPnLPatterns` returns only the caller's samples.
     - `backtest_runs.user_id` is NOT NULL.
3. **ingest CLAUDE.md:**
   - `:34-35`: `ManageSignalSource` is owner-gated, full stop.
   - Replace the "Headerless tolerance" bullet (`:64-67`) with: "A call with no `x-user-id` to an owner-scoped RPC (all but the backfill RPCs and NormalizeRawData) → `UNAUTHENTICATED` (feature 225)."
   - Rewrite `:92-101` to describe `signal_dedup_claims` only, noting that `signal_dedup_keys` was dropped by migration `014`.
   - Replace the N-1 trigger sentence at `:105-107` with "its N-1 trigger/function were dropped by `014`".
4. **`docs/patterns/database.md`:**
   - Amend `:51-53`: expand files must be idempotent because the 225 rerun job replays them, and the dirty recovery is guarded at or above a contract floor.
   - Update the `migration-rerun` bullet (`:61-66`): it replays the 224 expand **and 225 contract** files, the N-1 trigger count must be 0, and it proves the refused downs, the dirty guard and AC-11.
   - Add a `### Contract migration recovery` subsection after `:57`, covering:
     - the guard (`scripts/migration-dirty-guard.sh`, shipped in `scripts/Dockerfile.migrate`);
     - the floor rule: the lowest `contract-of` target version in the service; refuse at or above it;
     - the `migrate force <n-1>` then `db-migrate.sh up` procedure. `db-migrate.sh` has no `down`, so a refused down is reachable only via raw `migrate goto`. Use `migrate force <n-1>`, never `db-migrate.sh force`;
     - the **adjacency convention**: a contract migration directly follows its expand file (design Open Risk 2).
5. **Defect report:** under "## Workaround in place", append a dated bullet:
   - "**Partial mitigation (feature 225, 2026-10-10):** `db-migrate.sh up` refuses `force 0` for a service whose dirty version is ≥ its lowest `contract-of` floor and prints `migrate force <n-1>` recovery text."
   - "Still exposed: dirty states below the floor and every service with no contract file."
   Leave `.status` as `open`; moving it is `/sdd-triage`'s transition.
6. **Business-rule promotion (C-16):**
   - In `order-snapshots-pnl-patterns.feature:25-31`, replace `@AC-3 @FR-4 @feature-042` with the amended scenario from design.md, tagged `@AC-3 @FR-4 @feature-042 @feature-225`.
   - Add a `@feature-225` And-step to `platform.feature` `@AC-35`, carrying the 225 `@AC-7` global-secret-alongside case.
   - Create the three per-service `private-by-default-enforce-contract.feature` files by copying the 225 scenarios **verbatim** from `acceptance.feature` and tagging each `@feature-225`:
     - analysis gets AC-3, AC-8, AC-14, AC-15, AC-16, AC-17;
     - indicators gets AC-1, AC-2, AC-10, AC-11;
     - ingest gets AC-4, AC-9, AC-13.
   - Put the platform-tooling scenarios (AC-5, AC-6, AC-12, AC-18, AC-19) in `platform.feature`.
   - Before promoting, diff each `Then` against the shipped test (fails.md `formula-fundamental-inputs-authoring`). A scenario whose test asserts less must be logged as a deviation, not promoted as is.
7. **Teardown:** run `/context-forge:context-constitution refresh`, scoped to the three service `CLAUDE.md`s and `docs/patterns/database.md`, and fix any grounded drift it reports. If the plugin is unavailable, re-read each touched context file against the code by hand. In that case the PR body must state both that the plugin was unavailable **and** what reconciliation was done (root CLAUDE.md § Teardown).

**Verification**:
```bash
grep -rn "_INTERNAL_FORMULA_READERS\|224 enforce\|Headerless tolerance\|release-N-only\|kept only for N-1" services/xstockstrat-{indicators,analysis,ingest}/CLAUDE.md && exit 1 || true
grep -n "Contract migration recovery\|migration-dirty-guard" docs/patterns/database.md
grep -n "Partial mitigation (feature 225" docs/reports/2026-10-07-db-migrate-dirty-recovery-replay-unsafe-defect.md
cat docs/reports/2026-10-07-db-migrate-dirty-recovery-replay-unsafe-defect.status   # still: open
grep -n "@feature-225" services/xstockstrat-analysis/acceptance/order-snapshots-pnl-patterns.feature docs/sdd/business-rules/platform.feature services/xstockstrat-*/acceptance/private-by-default-enforce-contract.feature
```

---

## Deviation Log

_Populated by /sdd-execute as implementation proceeds._

### Deviation: Step 3 — analysis `027_contract_owner_dimension` (verification substitution)
**Spec said**: replay-safety and the live apply are "proven by Step 5's CI rerun".
**Actual**: verified offline only — up/down pair present, `027` next-free on every `origin/*` ref, `contract-of` on
line 1 and `requires-env` within the first 5 lines, 026 present on `origin/main`, down refuses by design (FR-5),
replay-safety by inspection (every UPDATE is `IS NULL`-guarded, `SET NOT NULL` and `DROP TABLE IF EXISTS` are no-ops on replay).
`envsubst` is absent on this host, so the `render-migrations.sh` render was not exercised locally.
**Reason**: HARD CONSTRAINT — no database is started to verify a step.
**Disposition**: offline migration check — live apply deferred to CI (`migration-rerun` job).

### Deviation: Step 4 — ingest `014_contract_signal_ownership` (verification substitution)
**Spec said**: "proven by Step 5's CI rerun".
**Actual**: verified offline only — up/down pair present, `014` next-free on every `origin/*` ref, `contract-of` on
line 1, 013 present on `origin/main`, 3 `IF EXISTS` drops (no-ops on replay), down refuses by design (FR-5).
**Reason**: HARD CONSTRAINT — no database is started to verify a step.
**Disposition**: offline migration check — live apply deferred to CI (`migration-rerun` job).

### Deviation: Step 5 — `migration-rerun.sh` contract replay (TDD red/green + authoritative run)
**Spec said**: "`red-green required`. Run against the tree before Steps 3–4, the new `analysis-027.sql`/`ingest-014.sql`
assertions and the refusal block fail." and "the CI `migration-rerun` job on this step's PR must be green".
**Actual**: no database was started, so neither the red nor the green run of the harness happened locally. Offline
substitutes: `shellcheck` + `shfmt -d -i 2` + `bash -n` clean; every new/edited SQL file (027/014 up+down, the three new
assertion/fixture files, edited `ingest-013.sql`) parses with libpg_query (`pglast.parse_sql`, plus `parse_plpgsql` on
each `DO` body); the dirty guard run against the real migrations dirs refuses ingest 13/14 (`force 12`/`force 13`) and
analysis 26/27 (`force 25`/`force 26`) and allows ingest 12 / analysis 25. Red by inspection: before Steps 3–4 the
replay's `cp …/014_contract_signal_ownership.up.sql` fails, `refuse_down` finds no raising down, and
`analysis-027.sql`/`ingest-014.sql` raise (objects still present). No PR exists yet (sequential mode), so the
`migration-rerun` job first runs on the integration PR.
**Reason**: HARD CONSTRAINT — no database is started to verify a step; sequential mode opens no per-step PR.
**Disposition**: offline migration check — live red/green deferred to CI (`migration-rerun` on the integration PR).

### Deviation: Step 9 — analysis gate completeness + test churn (churned files)
**Spec said**: "`services/xstockstrat-analysis/tests/*.py` — modify only the suites that the red run shows calling an RPC
headerless (churn rule below; list each touched file in the step commit)".
**Actual**: the Step-8 red run had 19 failures in 4 files. Churned: `tests/test_analysis_servicer.py` (rule (ii): 3
TestBacktestTechnicalOnly, 2 TestFormulaErrorSurfacing, 3 TestBacktestRangeCap, 3 TestGetBacktest contexts gain
`OWNER_HEADERS`; rule (i): `test_unauthenticated_caller_denied` now asserts UNAUTHENTICATED and that the repo was not
touched, `test_set_opportunity_action_missing_user_invalid` renamed `..._missing_user_unauthenticated` and asserts
UNAUTHENTICATED), `tests/test_get_attribution.py` (rule (i): `test_inbound_system_identity_owns_nothing` →
`test_inbound_system_identity_permission_denied`, asserts PERMISSION_DENIED), `tests/test_query_pnl_patterns.py` (rule
(ii), as the spec lists), and `tests/test_backtest_runs_repo.py` (4 `insert` calls gain `user_id="u-1"`).
**Reason**: the `test_backtest_runs_repo.py` churn is not a headerless RPC: Step 8 instruction 6 makes
`BacktestRunsRepository.insert(user_id: str)` required, so the 4 direct repository calls failed with `TypeError`. It is
the same rule-(ii) shape (incidental, no assertion weakened). No test was deleted.
**Disposition**: accepted trade-off (the `tests/*.py` Files entry, per the impl-spec review); each file named in the
step commit.

