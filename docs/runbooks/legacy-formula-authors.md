# Runbook: Repair Legacy-Username Formula Authors

**When to use**: an owner cannot see, read or execute their own formulas, or `indicators.formulas`
holds rows whose `author` is neither a user id (UUID) nor `system`. The read guard
(`_can_read_formula`) serves a formula only to its author or to everyone when it is `system`, so a
row that still stores a legacy username is invisible to the user who owns it (feature 276).

**Tool**: the operator-run CLI `python -m app.maintenance.legacy_authors` in
`services/xstockstrat-indicators/`. It is not part of the service process and opens one database
connection. It has two modes: REPORT (the default, which only runs SELECTs) and APPLY (which needs a
digest-matched, fully-confirmed plan).

**Workflow wrapper**: `python -m app.maintenance.legacy_authors_ops` runs §4–§6 as `report` →
`confirm` → `apply` (same guards; it adds no authority of its own). It needs only asyncpg + the
stdlib, so it also runs in the indicators image: from the component's DO console in `/app`
(`DATABASE_URL` and `DB_PGBOUNCER` are already set there), or locally with
`cd services/xstockstrat-indicators && uv run python -m app.maintenance.legacy_authors_ops …`.
`report` exports `identity.users` itself (or takes `--users <file>` if the DB role cannot read it),
`confirm` only marks `suggested` rows `confirmed` and prints the digest to record, and `apply` still
needs that digest passed explicitly. Files default to `/tmp/legacy-authors` (0600). Overrides for
`unmappable` / `ambiguous` rows (§5) are still a hand edit of `plan.json` before `confirm`.

```bash
python -m app.maintenance.legacy_authors_ops report
python -m app.maintenance.legacy_authors_ops confirm      # prints the sha256 for the DBA record
python -m app.maintenance.legacy_authors_ops apply --confirm-digest <sha256>
```

**In a DO console the filesystem is lost on the restart that §8 requires.** `apply` therefore prints
the whole `plan.result.json` (the only undo/audit record): copy it into the DBA change record
**before** restarting, and copy `plan.json` too.

---

## 1. Scope

- **The production row count and usernames are unknown.** Staging showed six formulas authored
  `davcs86`. Treat those six as a floor, not a bound: other usernames and other rows may exist in
  either environment, soft-deleted rows included.
- **Never run APPLY against production** until a production REPORT (§5) has been read and the DBA
  has approved the change record.
- The CLI never touches rows authored `system` or by a UUID, never changes `is_public` or
  `updated_at`, and never goes through `UpdateFormula`/`DeleteFormula`.

## 2. Authority

Authority to run the repair comes from **process, not code**. The operator must hold the
database credential, and the **DBA change record** must approve the change (approval flow: DBA plus
the indicators service owner).

The code enforces **integrity only**. APPLY refuses unless the plan file matches the recorded
sha256 digest and every entry is `confirmed`, `unmappable` or `ambiguous`. It never rewrites a
`system` or UUID-authored row. **The digest proves the plan was not changed after it was recorded.
It does not prove that anyone authorized the run.**

## 3. Prerequisites and connection

- `uv` (`brew install uv`) and a checkout of this repo. Run the CLI from
  `services/xstockstrat-indicators/` after `uv sync`.
- The DigitalOcean cluster's trusted sources must include your workstation (`doctl` and cluster
  access as in [`operator-db-access.md`](operator-db-access.md)). **A DO-console session does not keep
  files.** Use it only through the `legacy_authors_ops` wrapper above, which echoes the result to
  stdout; otherwise the plan and result files are lost.
- **`DATABASE_URL` is required.** The CLI has no `.env` or localhost fallback. If the variable is
  missing it exits non-zero before connecting.
- **Use the pooled `:25061` URL with `DB_PGBOUNCER=true`.** Take the direct URI from
  `doctl databases connection <cluster-id> --format URI`, then change the port to `25061` and the
  database path to the pool name (`staging` or `production`). See
  [`docs/patterns/database.md`](../patterns/database.md) § Connection pooling. `DB_PGBOUNCER=true`
  disables asyncpg's statement cache, which is not safe under transaction pooling.
  - **This deliberately differs from `operator-db-access.md`**, which says admin SQL uses the
    direct port `:25060`. The CLI holds no session state. Every statement is its own autocommit
    statement, with no transaction, advisory lock or `LISTEN`. It can therefore run through the
    transaction pool and stay off the direct-connection budget (root `CLAUDE.md` § Connection Pool
    Budget).
  - The manual undo `UPDATE` (§9) is ordinary admin SQL and may use either port.

```bash
# One work directory per environment run, outside the repo (these files hold PII, see §7)
export WORK="$HOME/legacy-authors-staging"
mkdir -p "$WORK"

export DATABASE_URL='postgresql://<user>:<password>@<host>:25061/staging?sslmode=require'
export DB_PGBOUNCER=true
```

Both modes print `target host=<host> db=<db>` before doing anything else. **Check that line
every time.** APPLY does not compare the target recorded in the plan with the database it is
connected to.

## 4. Step A: export users

From the repo root, with the same `DATABASE_URL` (`identity.users` is in the same database):

```bash
uv run scripts/manage-users.py list-users --json > "$WORK/users.json"
```

The file is a JSON array of `{"user_id", "email_local", "is_active"}`. It carries the email local
part only, with no full email and no roles. Only **active** users are eligible targets.

## 5. Step B: report, then edit the plan

```bash
cd services/xstockstrat-indicators
uv sync
uv run python -m app.maintenance.legacy_authors --users "$WORK/users.json" --out "$WORK/plan.json"
```

REPORT runs only SELECTs. It prints one line per `unmappable` or `ambiguous` row
(`formula_id`, `author`), the counts `{rewritable, unmappable, ambiguous, clean}`, and the plan's
sha256. Every log line carries the run's `[run_id=<uuid>]`.

Each plan entry is `{formula_id, old_author, new_author, status, source}`, one per formula row,
soft-deleted rows included. Edit `plan.json` by hand:

- **`suggested` → `confirmed`** once you have verified the match. A `suggested` entry is a heuristic
  match: its `old_author` equals exactly one active user's email local part, ignoring case. It is
  never applied as it stands. **A single `suggested` entry left in the plan makes APPLY refuse the
  whole run.**
- **`unmappable` (no active match) or `ambiguous` (two or more matches):** either leave the entry
  as it is (APPLY never touches it), or set an explicit override. To override, set `new_author` to
  the owner's `user_id` from `users.json`, set `"source": "override"` and set
  `"status": "confirmed"`. Record why in the change record.
- Do not change `formula_id` or `old_author`. APPLY rewrites only plan entries that still match a
  live detected `(formula_id, author)` pair, so an edited or added entry cannot widen the write set.

## 6. Step C: hash, record, apply (strictly in this order)

The order is **edit → hash → record → apply**:

1. Finish every edit to `plan.json` (§5).
2. Hash the final file:

   ```bash
   shasum -a 256 "$WORK/plan.json"
   ```

3. Record the digest and attach `plan.json` and `users.json` to the DBA change record. Get DBA
   approval.
4. Apply with the recorded digest:

   ```bash
   uv run python -m app.maintenance.legacy_authors --apply \
     --plan "$WORK/plan.json" --users "$WORK/users.json" --confirm-digest <sha256>
   ```

**Any edit after step 2 invalidates the digest.** APPLY then refuses, so re-hash and re-record.

**Pre-flight refusals.** APPLY exits `2` with zero UPDATEs and prints one
`[run_id=…] refused: <reason>` line per reason, in any of these cases:

- the digest is missing or does not match;
- an entry is still `suggested`, or has an unknown status;
- a confirmed `old_author` is `system` or a UUID;
- a confirmed `new_author` is not a UUID, is not in `users.json`, or belongs to an inactive user;
- the plan file is unreadable.

**On success.** APPLY re-derives the write set from the database. Each target row gets one
compare-and-set `UPDATE`, which only matches while the row still has the same `formula_id` and
`old_author` and is not `system` or UUID-authored. APPLY prints the counts
`{rewritten, skipped_concurrent, skipped_not_detected, unmappable, ambiguous}` and the result
path, which is `plan.result.json` next to the plan.

## 7. After apply: attach the audit record

Do this **before** the redeploy in §8:

- Attach `plan.json` and `plan.result.json` to the DBA change record. The result file lists
  `run_id`, the target, the counts and `{formula_id, old_author, new_author}` for every rewritten row.
  **It is the only undo and audit record.** Ownership moves are not ledger-audited.
- **Storage location:** the DBA change record's attachments, and nowhere else. Never commit these
  files to git, never put them under `docs/`, and never paste them into a shared channel, an issue
  or an agent prompt. They contain email local parts and legacy usernames, which are PII.
- **Retention:** keep the attachments for as long as the change record itself is kept. At minimum,
  keep them until owner access has been verified (§8) in both environments.
- Then delete the local copies: `rm "$WORK/users.json" "$WORK/plan.json" "$WORK/plan.result.json"`.

## 8. Restart and verify

1. **Restart every indicators instance**, for example by redeploying the app with
   `doctl apps create-deployment <app-id>`. The in-process formula cache has no TTL, so it reads the
   cache before the database. An instance that cached a repaired row before APPLY (for example
   after an admin `GetFormula` of that foreign formula) keeps serving the old author until it
   restarts. xstockstrat-analysis caches formulas per request and does **not** need a restart.
2. Re-run REPORT (§5) to a new `--out` file. The confirmed authors must no longer appear, with 0
   rewritable for them. Only the `unmappable` and `ambiguous` rows you left should remain.
3. **Verify as the owner** on at least one rewritten `formula_id`. Use the agent's `get_formula` and
   `test_formula` tools (`docs/runbooks/mcp-tools.md`), or `ExecuteFormula`. The formula must be
   returned or executed, not `NOT_FOUND`.
   - **`list_formulas` alone is not proof.** It reads the database, not the cache, so it passes even
     on an instance that is still stale.
4. **If `skipped_concurrent` > 0:** those rows changed between detection and the rewrite, and the
   concurrent write was kept. Re-run REPORT and repeat §5–§8 for them.

## 9. Undo

APPLY cannot undo a rewrite, because it refuses a UUID `old_author`. To revert, build one
DBA-reviewed manual compare-and-set from `plan.result.json` per rewritten row. Run it through
[`operator-db-access.md`](operator-db-access.md); either port may be used:

```sql
UPDATE indicators.formulas
   SET author = '<old_author>'
 WHERE formula_id = '<formula_id>'::uuid
   AND author = '<new_author>';
```

Record the statements and their row counts in the change record, then repeat the restart-and-verify
step (§8).

## 10. Order of environments

1. **Staging first.** Complete §4–§8 against the `staging` pool.
2. **Then production**, with a new work directory, a new users export and a new plan. A staging
   plan is never reused.
3. Record the **observed production row count** (the REPORT counts) in the change record.
