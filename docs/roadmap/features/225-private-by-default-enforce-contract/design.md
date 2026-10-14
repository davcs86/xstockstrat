# Design: private-by-default-enforce-contract

**Created**: 2026-10-10
**Rounds**: 3 (quick mode extended by the operator at each gate; termination: approved — round-3 adversary SOUND, no Floor breach)
**Approved by**: user @ 2026-10-10 (AskUserQuestion "Approve with fixes")
**Grounded in**: recon.md

Operator decisions binding this design (context.md): `UNAUTHENTICATED` for headerless owner-scoped calls;
indicators stops writing `is_public` (column drop deferred, no indicators migration); QueryPnLPatterns fixed in 225;
AC-11 proven by a real-schema check; `db-migrate.sh` dirty-recovery guard in 225.

---

## Chosen Approach

### 1. Identity gate (unchanged from round 2, with the spec notes folded in)

Each servicer module (analysis, indicators, ingest) gets a module-level async `owner_scoped` decorator:
- It calls the service's single classifier: analysis `_caller_user_id` (`servicer.py:563-576`), indicators `_reader` (`:105-107`), ingest `_resolve_owner` (`:330-342`).
- The classifier raises `_CallerRejected(code, msg)`:
  - no `x-user-id` → `UNAUTHENTICATED`;
  - `system` without a SAN-bound grant for this RPC → `PERMISSION_DENIED`.
- On `_CallerRejected` the decorator runs `await context.abort(...)` and then **`return`s**. Test contexts use a non-raising `AsyncMock` abort, so without the `return` the body would run and the gate would only appear to work (adv2 spec note).
- The decorator sets `wrapper.__owner_scoped__ = True`.
- **ingest:** the decorator passes `fn.__name__` as `rpc`. Bodies obtain the owner only through a `_owner(context)` accessor that reuses the same `fn.__name__`, captured via a contextvar the decorator sets. A body can therefore never re-resolve under a different grant key (adv2 note).

Coverage:
- **analysis:** 22 decorated RPCs. EXEMPT = {`RunFundamentalsScan`}: it is admin-scope-gated (`servicer.py:3478`), not owner-scoped, and the spec says so explicitly.
- **indicators:** 10 decorated. EXEMPT = {ComputeIndicator, ListIndicators, ListFundamentalMetrics}.
- **ingest:** 7 decorated. EXEMPT = {TriggerBackfill, CancelBackfill, GetBackfillStatus, ListBackfillJobs, NormalizeRawData}.

Every raw inbound `x-user-id` reader in analysis routes through `_caller_user_id`: `servicer.py:3463`, `:4198`, `:5804`, **and `:5686`** (SetOpportunityAction, missed in round 2). The bypass, fallbacks and orphans are deleted as listed in round 2.

### 2. One fail-closed owner-metadata builder (new: `services/xstockstrat-analysis/app/identity.py`)

The module contains:
- `SYSTEM_IDENTITY = "system"`, moved from `servicer.py:296`. servicer imports it back, so existing `from app.handlers.servicer import SYSTEM_IDENTITY` users still resolve. The two engine imports (`fundsignal_loop.py:31`, `live_loop.py:38-39`) switch to `app.identity`.
- `owner_metadata(owner: str) -> list[tuple[str, str]]`. It returns `[("x-user-id", owner)]` and raises `ValueError` when `owner` is empty or `== SYSTEM_IDENTITY`. A synthesized owner can never be blank or impersonate the grant-bound identity.
- The module imports nothing from `app`, so there is no import cycle.

All eight hand-built owner sites route through it:

| # | Site | Change | Failure handling |
|---|------|--------|------------------|
| 1 | `servicer.py:3261` `_saga_sweep_meta` | `[*owner_metadata(user_id), grant, trace]` | the sweep's per-intent `except` (`:5665`) catches `ValueError` |
| 2 | `servicer.py:5425` opportunity tick | moved inside the per-user `try` (`:5426-5431`) | a `""` uid is logged and skipped |
| 3 | `servicer.py:5474` materializer | `owner_metadata(owner)` | the caller's per-owner `except` (`:5606-5607`) catches it |
| 4 | `live_loop.py:464` `_drain_owner_signals` | `owner_metadata(owner)` | each sits under the per-pair `try` (`live_loop.py:438-445`, adv2-verified) |
| 5 | `live_loop.py:519` `_drain_held` | `owner_metadata(owner)` | same as #4 |
| 6 | `live_loop.py:546` `_drain_watchlist` | `owner_metadata(owner)` | same as #4 |
| 7 | `evaluator.py:224` `for_owner` | `owner_metadata(owner)` | callers `live_loop.py:582` and `:684` are inside the same per-pair `try` |
| 8 | `pnl_pattern_consumer.py:366` `_compose` | `if not owner:` log a warning and `return None, [], {}, [], True`; else `meta = owner_metadata(owner)` | no outbound call is made for an ownerless event |

The system metas are not owner metadata and keep their literal tuples bound to `SYSTEM_IDENTITY`: `fundsignal_loop.py:176` and `live_loop.py:65`. A static test (see the test plan) enforces that no other `("x-user-id", …)` tuple exists in `app/`. That makes the "single builder" claim checkable rather than a hand-maintained list (`fails.md:2659-2662`).

### 3. FR-7: QueryPnLPatterns is owner-scoped

- It carries the `owner_scoped` decorator.
- `PnLPatternSamplesRepository.query` (`pnl_pattern_samples.py:35-55`) gains a required `user_id` and the predicate:
  ```sql
  AND position_id IN (SELECT position_id FROM analysis.pnl_positions WHERE user_id = $N AND symbol = $1)
  ```
  The `symbol` filter inside the subquery keeps the semijoin small, because `idx_pnl_positions_user_closed (user_id, closed_at)` (`021:6-7`) does not cover `position_id`.
- This mirrors the `GetAttribution` precedent (`servicer.py:3966-3973`).
- Each `position_id` has exactly one owner: it is `user:account:symbol:mode` (`pnl_pattern_consumer.py:390-393`), and positions open only for a truthy `user_id` (`:225`). The semijoin therefore cannot duplicate samples. NULL or unowned positions are excluded.
- No migration.

### 4. Migrations: 027 and 014 (round 2, plus the `lock_timeout` reset)

The DO block is:
```sql
DECLARE prev_lt text := current_setting('lock_timeout');
...
PERFORM set_config('lock_timeout','2s',true);
FOR i IN 1..20 LOOP
  BEGIN
    LOCK TABLE … IN ACCESS EXCLUSIVE MODE;
    EXIT;
  EXCEPTION WHEN lock_not_available THEN
    IF i = 20 THEN RAISE; END IF;
    PERFORM pg_sleep(1);
  END;
END LOOP;
PERFORM set_config('lock_timeout', prev_lt, true);
```
- The 2s value is set **outside** the exception block. A `set_config` inside a subtransaction that errors is rolled back with it.
- The reset restores the session's prior value. Only the reader-blocking ACCESS EXCLUSIVE request is bounded; the later UPDATEs, `ALTER`, and `DROP`s queue normally.
- Everything else in 027 (D-1 re-backfill, child backfill `026:32-42`, `SET NOT NULL`, `DROP TABLE IF EXISTS analysis.strategy_scores`) and in 014 is as in round 2.
- Both down files raise the "irreversible contract" sentinel.

### 5. Indicators `is_public` and the AC-11 real-schema proof

As in round 2, plus one addition from adv2's notes. The harness derives each extracted statement's parameter count from its highest `$n` (`grep -oE '\$[0-9]+' | sort -n | tail -1`) and fails loudly, naming the constant, if the count differs from the supplied values.

### 6. The `db-migrate.sh` dirty-recovery guard (new, FR-8)

**New script `scripts/migration-dirty-guard.sh <migrations_dir> <schema> <version_output>`.** It is a separate script so it can be tested without a database, following the `render-migrations.sh` + `.test.sh` precedent.

`set -euo pipefail`, bash 3.2 only: no arrays, `mapfile` or `${x,,}`; only `head`, `sed`, `tr`, `basename`, `[ -lt ]`.

1. **Parse.** `n="$(printf '%s\n' "$3" | sed -n 's/^\([0-9][0-9]*\) (dirty).*/\1/p' | head -n 1)"`. If `n` is empty → print "cannot parse dirty version" and exit 2 (fail closed).
2. **Floor.** For each `"$1"/*.up.sql`, read the header with the exact extraction from `check-migration-contract.sh:16`: `head -n 5 | sed -n 's/^-- contract-of:[[:space:]]*//p' | head -n 1 | tr -d '[:space:]'`. Map the target to its version with `basename | sed 's/^\([0-9]*\)_.*/\1/; s/^0*//'` (the `db-migrate.sh:104` idiom). `floor` = the minimum such version. If there is no contract file, exit 0.
3. **Below the floor.** If `n -lt floor`, exit 0 and the legacy force-0 path proceeds unchanged.
4. **Refuse.** Otherwise print the following to stderr and exit 3:
   ```
   db-migrate: <schema> is dirty at version <n>, at/above contract floor <floor>; refusing automatic `force 0` (it replays non-idempotent pre-contract up-files — docs/reports/2026-10-07-db-migrate-dirty-recovery-replay-unsafe-defect.md).
     Recover: migrate -path services/xstockstrat-<schema>/migrations -database "$DATABASE_URL&x-migrations-table=<schema>_schema_migrations" force <n-1>
     then re-run scripts/db-migrate.sh up.
   ```
   The `$DATABASE_URL` text is a single-quoted literal, so no credential is ever printed.

`force <n-1>` is correct in both reachable cases:
- **Failed contract up** (dirty 27/14): the file rolled back atomically as one implicit transaction, so `force 26` then `up` re-runs 027 from clean.
- **Refused down** (dirty 26/13): `force 25` then `up` replays 026→027 (or 013→014). AC-12 already proves those pairs replay-safe.

**`db-migrate.sh:66-72` becomes:**
```bash
ver="$(migrate -path "$dir" -database "$url" version 2>&1 || true)"
case "$ver" in *dirty*)
  if ! "$REPO_ROOT/scripts/migration-dirty-guard.sh" "$dir" "$schema" "$ver"; then exit 1; fi
  echo "  [dirty] force-resetting $svc to version 0"
  migrate -path "$dir" -database "$url" force 0 ;;
esac
```
- `$dir` is still the original migrations directory at this point; the scratch and render reassignment comes later (`:78-93`).
- Any non-zero exit from the guard, including the parse error (2), aborts the run.
- The false comment "All migrations use IF NOT EXISTS … re-running is safe" (`:66-68`) is replaced with a 2-line constraint comment: "force 0 replays every up-file, and pre-contract files are not idempotent; the guard refuses it at or above a contract floor."

**Relation to the defect report: partial mitigation, and the defect stays open.**
- The guard covers only services that have a `contract-of` file (analysis, ingest), and only when the dirty version is at or above the floor.
- Dirty states below the floor, and every other service, still take `force 0`.
- The `.status` sidecar stays **`open`**. Moving it to `triaged` is `/sdd-triage`'s transition, not this feature's.
- Append a dated "Partial mitigation (feature 225)" bullet under "Workaround in place" in the defect `.md`. It names the guard, the floor rule, and what remains exposed.
- `docs/patterns/database.md` gets a "Contract migration recovery" subsection (near `:51-57`) covering the guard, the floor rule, and the `force <n-1>` procedure.

## Rejected Alternatives

- **Floor = lowest contract version (the operator's literal wording).** It misses the refused-down dirty state at the expand version, which is the path 225 itself creates.
- **Floor = the version immediately before the lowest contract.** It is equivalent here, since 026→027 and 013→014 are adjacent, but it needs a directory-listing sort. Using the `contract-of` target is simpler and never narrower.
- **Guard logic inline in `db-migrate.sh`.** It could not be tested without a database, because the script runs `psql` at top level (`:120`).
- **Fix the defect fully** (`force <n-1>` for every service). The product spec puts that out of scope. It would also change recovery for the pre-224 files, which nobody has audited, so it belongs to `/sdd-triage`.
- **A server interceptor instead of the decorator.** Servicer tests call methods directly (`analysis tests/conftest.py:33-38`), so they would bypass it.
- **A validating outbound stub wrapper instead of `owner_metadata`.** The static single-builder test plus server-side fail-closed already makes a missed site loud.
- **`app/services/evaluator.py` as the home for `owner_metadata`.** Wrong cohesion: the pnl consumer and the servicer are not evaluator concerns.

## Open Risks

1. **Guard parse coupling.** The guard depends on golang-migrate's `"<n> (dirty)"` stderr format at the pinned v4.17.1 (`db-migrate.sh:5`). An unparseable dirty output fails closed (exit 2 → abort), so a format change surfaces as a blocked deploy, not a wedge.
2. **A future contract that is not adjacent to its expand.** A refused down would then land dirty at a non-expand version, and `force <n-1>` would replay a file nobody has proven replay-safe. Mitigation: the `database.md` subsection states the adjacency convention. Both 225 contracts satisfy it.
3. **Parentless NULL-owner child rows.** A headerless release-N `RunBacktest` in the window between the 027 commit and the 225 rollout runs `_persist_symbol_cells` before the parent insert (`servicer.py:1145-1153` vs `:1165`). It could leave NULL-owner, parentless `backtest_run_symbols` rows that no backfill reaches. Round 1 found no headerless external caller, so this is recorded and accepted. The child tables' `user_id` **stays nullable after 225**, as an explicit deferral to a later contract.
4. **`owner_metadata` refuses `system`.** If any background enumerator ever yields a `system`-owned strategy or opportunity, that unit is skipped with a warning instead of being served. This is fail-closed by intent.

## Constitution rules touched

- **F-01:** no applied up-file is edited. Removing the `ingest-013.sql` probe edits an assertion, not a migration.
- **F-04 / C-01:** all paths cited.
- **F-06:** no new pool.
- **F-07:** the `lock_timeout` and retry literals live in one-shot DDL that cannot read `WatchConfig` (the 026 precedent). The guard has no config.
- **C-03:** owner headers are synthesized only through `owner_metadata`.
- **C-07:** naming is 027 and 014.
- **C-08 / P-06:** paired tests, red before green.
- **C-11:** the guard refinement and the EXTEND reclassification are recorded.
- **C-13:** `OWNER_HEADERS` and `OTHER_HEADERS` constants.
- **C-15 / C-16:** scenarios below; EXTEND recorded.
- **C-18:** one builder, one guard script, no new abstraction beyond them.
- **P-03:** fail closed, no silent guessing.

## Business rules touched

- **EXTEND** `@AC-3 @FR-4 @feature-042` (`services/xstockstrat-analysis/acceptance/order-snapshots-pnl-patterns.feature:25-31`):
  - reclassify it in `recon.md`;
  - at launch promotion, its Given/When become the amended scenario below.
- **PRESERVE** `@AC-4 @FR-5 @feature-042`, the UI mirror (`services/xstockstrat-ui/acceptance/order-snapshots-pnl-patterns.feature:10-15`). The BFF already forwards `x-user-id` (`insightsBff.ts:70`), and the Given ("QueryPnLPatterns returns … for AAPL") still holds for the signed-in owner.
- **PRESERVE** `@AC-1 @feature-042`: owned events still fetch ind/sig as their owner. Only ownerless events degrade, and those are malformed.
- The **39 PRESERVE + 1 EXTEND (`@AC-35 @feature-224`)** in `recon.md:101-142` are otherwise unchanged.

Amended rule, applied at promotion:
```gherkin
  @AC-3 @FR-4 @feature-042 @feature-225
  Scenario: QueryPnLPatterns returns the caller's ranked positive and negative factors
    Given user "u-1" owns positions on AAPL with at least 5 completed trades whose snapshots have been analyzed
    And analysis.patterns.min_sample_count is 5
    When QueryPnLPatterns is called with "x-user-id: u-1", symbol "AAPL" and limit 10
    Then the response contains at least one factor in positive_factors and at least one in negative_factors
    And each returned factor carries factor_name, factor_type (INDICATOR or SIGNAL), sample_count, and avg_pnl_impact
```

## Test plan, by surface

**analysis (pytest)**
- `tests/test_owner_scoped_completeness.py`:
  - descriptor walk asserting `{undecorated} == EXEMPT` in both directions;
  - each non-exempt method × {headerless → `UNAUTHENTICATED`, ungranted `system` → `PERMISSION_DENIED`};
  - the abort mock is non-raising, and the test asserts the body was **not** entered, which guards the `return`.
- `tests/test_identity.py`:
  - `owner_metadata("")` and `owner_metadata("system")` raise `ValueError`; `owner_metadata("bob")` returns `[("x-user-id", "bob")]`.
  - Single-builder static check: walk the `app/**/*.py` AST for 2-tuples whose first element is `"x-user-id"`. Allowed only in `app/identity.py`, or where the second element is `Name("SYSTEM_IDENTITY")`. This covers `fundsignal_loop.py:176` and `live_loop.py:65`.
- `test_owner_header_guard.py` additions:
  - the tick with uids `["bob", ""]` (calls go out only as bob);
  - the sweep with an empty intent owner (skipped, no indicators call);
  - the materializer with `""` (skipped);
  - `_drain_owner_signals`, `_drain_held` and `_drain_watchlist` raise for `""`, and the per-pair boundary contains the error;
  - `for_owner("")` raises;
  - AC-17 (zero ingest and indicators calls, degraded).
- AC tests:
  - AC-8, AC-16, AC-15;
  - AC-14: a repository test with a recording DB that asserts the predicate and the `$N=user_id, $1=symbol` binding; plus a servicer test with two owners' samples;
  - SetOpportunityAction headerless → `UNAUTHENTICATED`, classified under churn rule (i).

**indicators (pytest):** completeness (as analysis plus the grant-without-SAN case and a positive control), AC-1/2/10, SQL routing (`_INSERT_SQL`, `_UPDATE_SQL`, `_UPSERT_SQL`), and a static check that `"is_public"` appears in none of the three constants.

**ingest (pytest):** completeness (with the grant-without-SAN case and a positive control on IngestSignal), the `fn.__name__` grant pinning, AC-9, AC-7 (per-user `GetSecret`), and dedup through `signal_dedup_claims` after the 014 drop.

**Churn rule (all three services):** applied as in round 2, recording the red-run count before the bulk fix. Constants follow C-13 (`OWNER_HEADERS` / `OTHER_HEADERS`; ingest `_ctx`).

**`scripts/migration-dirty-guard.test.sh`** (new, structural, no database, temp dirs, following the `check-migration-contract.test.sh:1-56` style):
- (a) no contract file + `"27 (dirty)"` → exit 0;
- (b) contract 027→026 + `"27 (dirty)"` → exit 3, stderr contains `force 26`;
- (c) `"26 (dirty)"` → exit 3, `force 25`;
- (d) `"25 (dirty)"` → exit 0;
- (e) `"garbage dirty"` → exit 2;
- (f) a `contract-of` header on line 6 is ignored → exit 0 (5-line rule);
- (g) stderr never contains `postgres://`;
- (h) two contract files (→013, →020) give floor 13.

**CI:**
- `ci.yml:621` step: append `&& bash scripts/migration-dirty-guard.test.sh`.
- `migrations` paths filter (`ci.yml:70-76`): add `scripts/migration-dirty-guard.sh` and `services/xstockstrat-indicators/app/services/formulas_repository.py`.
- shellcheck and shfmt already cover `scripts/*.sh` (`ci.yml:615-618`).

**`scripts/migration-rerun.sh`** (CI `migration-rerun`): round-2 steps 1-5 (goto 26 + post-224 analysis fixture, the replay list adds 014 and 027, trigger counts must be 0, AC-11 harness with the param-count check). Step 6 is replaced:
1. **ingest:** `migrate goto 13` fails, output contains `irreversible contract`, state is dirty, `signal_dedup_keys` is absent (AC-13). Then `db-migrate.sh up` **must fail**, its output contains `force 12`, and `version` is still dirty, which proves no `force 0` ran (AC-18 for ingest). Then `migrate force 12`.
2. **analysis:** the same with goto 26, NOT NULL still set (AC-6), `force 25` (AC-18).
3. Finally `db-migrate.sh up` exits 0; analysis is clean at 27 and ingest at 14; `assertions/*.sql` re-run, including `analysis-027.sql` and `ingest-014.sql` (AC-3, AC-4).

**Docs (same PR, then the context-forge teardown):**
- the round-2 doc list;
- the `database.md` "Contract migration recovery" subsection (guard, floor rule, `force <n-1>`, adjacency convention);
- the defect report's appended mitigation bullet (`.status` stays `open`);
- the corrected comment in `db-migrate.sh`.

## Strongest remaining risk

The guard's recovery text assumes every contract file directly follows its expand file. A future contract with migrations in between would make `force <n-1>` after a refused down replay a file nobody has proven replay-safe. Within 225 this cannot happen: both contracts are adjacent, and the rerun job proves the recovery end to end. Future contracts depend on the convention written in `database.md`.

## Round-3 adversary fixes (folded at approval, operator 2026-10-10)

- **A. Ship the guard in the migrator image.** `scripts/Dockerfile.migrate` copies scripts file-by-file
  (`:11-12`), so add `COPY scripts/migration-dirty-guard.sh /repo/scripts/migration-dirty-guard.sh`. CI's
  `migration-rerun` bind-mounts the repo over `/repo` (`.github/workflows/ci.yml:657`) and would hide the omission, so
  add a no-mount smoke step: `docker run --rm --entrypoint test xstockstrat-migrate-ci -x /repo/scripts/migration-dirty-guard.sh`.
  Note the image change in `docs/patterns/database.md` / `docs/patterns/docker-build.md` (Dockerfile Update Workflow).
  (Same class as fails.md:1552.)
- **B. Template sweep stays alive.** `meta = self._saga_sweep_meta(intent["user_id"])` sits before the per-intent `try`
  (`services/xstockstrat-analysis/app/handlers/servicer.py:5657-5658`); move it inside so an `owner_metadata`
  ValueError skips that intent only and `schedule.advance` (`:5667`) still runs. Test: empty-owner intent skipped,
  a following valid intent processed, `schedule.advance` called.

### /sdd-spec notes (round-3 adversary, non-blocking)
- Recovery text: show the `?`/`&` separator rule from `service_db_url` (`db-migrate.sh:34-47`) as a single-quoted literal
  (`$DATABASE_URL` never expanded); also say "use `migrate force <n-1>`, never `db-migrate.sh force`" (`:101-110` forces
  to the highest version → silent drift after a failed up).
- Guard robustness (bash 3.2): `[ -e "$f" ] || continue` after the glob; validate the parsed floor (non-digits → parse
  error exit code distinct from usage error); require the contract-of target to be in the same `services/<svc>/migrations/`.
- `db-migrate.sh` has no `down` command (`:112-115`); document that refused downs are reachable only via raw `migrate`.
- `migration-rerun.sh` runs under `set -e`: wrap expected-failure commands (`if migrate …; then exit 1; fi`) and capture
  output for the greps.
- AC-17 / `_compose`: skip only the indicators + ingest calls when ownerless; keep OHLCV/closes with trace-only metadata.
- AC-19: replace the ellipsis path with a concrete one. Guard test (g): also assert the literal `$DATABASE_URL` text.
