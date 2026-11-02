# Runbook: Backfill Signal-Watchlist Entry Expiry

**When to use**: once per environment, after feature 281 is deployed, to clear the backlog of stale
`source = SIGNAL` entries on the per-user system-managed signals watchlists. Entries added before the
feature carry no expiry row, so the in-service prune never removes them. The backfill classifies
each one so that the prune can.

**Tool**: the operator subcommand `backfill-signal-expiry` of the portfolio binary
(`services/xstockstrat-portfolio/cmd/server`). It has two modes. REPORT (the default) reads only.
APPLY inserts rows into `portfolio.watchlist_signal_expiry`. **The CLI never deletes a binding.** The
in-service prune (`PruneExpiredSignalEntries`, portfolio constitution `PORTFOLIO-17`) is the only
deleter, and it acts on the rows APPLY writes.

---

## 1. Scope and known strictness

For each SIGNAL binding on a system-managed list that has **no** expiry row, the backfill reads the
owner's own `direction = 'watchlist'` rows in `ingest.newsletter_signals` for that symbol. Symbols are
matched with `upper(btrim(symbol))` and `lower(direction)`. It then puts the binding in one of three
classes:

| Owner's watchlist-direction rows for the symbol | Class | APPLY writes | Effect |
|---|---|---|---|
| any open-ended row (`valid_until IS NULL`) | open-ended | nothing | Never pruned (`open_ended_skipped` in TOTALS) |
| only dated rows | **SEED** | `valid_until = max(valid_until)` and `signal_id` = that row's id | Pruned when that instant passes. `seed_expired = Y` means it has already passed, so the entry is pruned on the next tick |
| none | **UNTRACKED** | a mark: `valid_until = now()`, `signal_id NULL` | **Pruned on the next tick** |

**Known strictness (signed off at design time):** UNTRACKED counts only rows under the **owner's own**
user id. Rows that ingest migration `013` reassigned to the legacy seed owner do not count. The strict
untracked removal therefore also deletes entries that were added from **live** pre-feature-224
signals, now held by the legacy owner. REPORT shows these entries as `legacy_live = Y` and the owner
as `NO_OWN_SIGNALS` (§6). The only way to restore one is a MANUAL re-add, built from the pasted REPORT
and the `portfolio.watchlist.signal_entry_removed_untracked` ledger events (§9).

The backfill seeds late, never early. It counts every watchlist-direction row the owner has,
including rows ingested outside the agent path.

## 2. Authority

Authority comes from **process, not code**. You need the database credential and a **DBA change
record** approved by the DBA and the `xstockstrat-portfolio` service owner.

- **Never APPLY without a REPORT.** The DBA reviews the REPORT of the same environment, pasted into
  the change record, before any APPLY.
- The code enforces bounds only. APPLY refuses before its first write unless it gets
  `--expect-untracked N` and `--expect-seed-expired M`, and it refuses if the live counts exceed
  them. The `--legacy-owner` value is echoed in both headers but cannot be compared across the two
  runs, so the pasted REPORT and APPLY outputs in the change record are the control.

## 3. Prerequisites and connection

- A workstation with Go 1.27 and a checkout of this repo at the deployed revision.
  **The portfolio image is distroless (no shell), so the subcommand cannot run inside the container.**
  Do not use DO-console sessions either.
- The DigitalOcean cluster's trusted sources must include your workstation (`doctl` and cluster
  access as in [`operator-db-access.md`](operator-db-access.md)).
- **`DATABASE_URL` is required, with no `.env` fallback.** When it is empty the command prints
  `backfill-signal-expiry: DATABASE_URL is required (pooled :25061 URL; no .env fallback)` and exits
  `2` before connecting.
- **Use the pooled `:25061` URL with `DB_PGBOUNCER=true`.** Take the direct URI from
  `doctl databases connection <cluster-id> --format URI`, then change the port to `25061` and the
  database path to the pool name (`staging` or `production`). See
  [`docs/patterns/database.md`](../patterns/database.md) § Connection pooling. `DB_PGBOUNCER=true`
  switches pgx to unnamed statements, which transaction pooling requires. Leave `DB_POOL_MAX` unset.
  REPORT is one read-only transaction and APPLY is one autocommit statement per row, so both fit the
  transaction pool and stay off the direct-connection budget.
- **The legacy owner.** Use the `SEED_USER_ID` value of the `db-migrator` job in `.do/app.yaml`
  (production) or `.do/app.dev.yaml` (staging). This is the id that ingest `013` assigned the legacy
  rows to.

```bash
export DATABASE_URL='postgresql://<user>:<password>@<host>:25061/staging?sslmode=require'
export DB_PGBOUNCER=true
export LEGACY_OWNER='<SEED_USER_ID value from the db-migrator job>'
```

**Preflight: the role must be able to read ingest.** The backfill reads `ingest.newsletter_signals`
across schemas, and no migration grants this. Run the check with the same credentials through
[`operator-db-access.md`](operator-db-access.md):

```sql
SELECT has_table_privilege(current_user, 'ingest.newsletter_signals', 'SELECT');  -- must be t
```

If it returns `f`, stop. REPORT would fail on its first query. Get the grant through the DBA change
record first.

## 4. Deploy order

Proto, then portfolio, then agent, then this backfill. The backfill comes last so that the prune
loop and the agent's provenance-stamped adds are already live. REPORT and APPLY both assume the
`018` table exists and that the prune loop is running.

## 5. Step A: REPORT (read-only)

From `services/xstockstrat-portfolio/`:

```bash
cd services/xstockstrat-portfolio
GOWORK=off go run ./cmd/server backfill-signal-expiry --mode=report --legacy-owner "$LEGACY_OWNER" \
  | tee "$HOME/signal-expiry-report-staging.txt"
```

The first line is `target host=<host> db=<db>`. **Check it every time.** REPORT runs in a single
read-only transaction: no locks, no writes. Paste the whole output into the change record.

## 6. Reading the REPORT

The output is tab-separated plain text with a fixed column order, so it can be pasted as is:

```text
backfill-signal-expiry mode=report legacy_owner=<id> (read-only)
SEED       owner watchlist_id symbol valid_until signal_id seed_expired
UNTRACKED  owner watchlist_id symbol strategy_id legacy_rows legacy_live
with_live_legacy_signal=<n>
PER-OWNER  owner signal_entries seed seed_expired untracked own_signal_rows_total flag
TOTALS seed=<n> seed_expired=<m> untracked=<n> open_ended_skipped=<n>
NEXT: portfolio backfill-signal-expiry --mode=apply --legacy-owner <id> --expect-untracked N --expect-seed-expired M
```

- **`seed_expired = Y`**: a SEED row whose `valid_until` has already passed. APPLY seeds it and the
  next tick removes the entry. `M` in the NEXT line is the total of these rows.
- **`legacy_live = Y`**: an UNTRACKED entry for which the legacy owner still holds a live (undated
  or future) watchlist row for the symbol. This value is informational only. The entry is **still
  marked and removed** (§1). Review each one; the owner may want it back as a MANUAL entry.
  `with_live_legacy_signal` is their count.
- **`NO_OWN_SIGNALS`** (PER-OWNER `flag`): the owner has zero watchlist-direction rows under their
  own id. Every SIGNAL entry they have is therefore UNTRACKED and is removed. Expect this for owners
  whose signals all predate feature 224.
- **`NEXT:`** is the exact APPLY command, with the same `--legacy-owner` and with the bounds
  `N = untracked` and `M = seed_expired`. Its `portfolio` prefix stands for
  `GOWORK=off go run ./cmd/server`.

## 7. Step B: APPLY

Run only after the DBA has approved the REPORT. Use the NEXT line's values:

```bash
GOWORK=off go run ./cmd/server backfill-signal-expiry --mode=apply --legacy-owner "$LEGACY_OWNER" \
  --expect-untracked N --expect-seed-expired M \
  | tee "$HOME/signal-expiry-apply-staging.txt"
```

- APPLY re-reads the live counts and prints `live untracked=… seed_expired=…`. If either exceeds its
  bound, it prints `REFUSED: live counts exceed the approved bounds; nothing written` and exits
  non-zero. The binary returns `3`; `go run` reports any child failure as `1`. When that happens,
  re-run REPORT and get a fresh approval. **N and M are at-most bounds**: lower live counts are
  accepted.
- APPLY then writes one autocommit `INSERT … ON CONFLICT DO NOTHING` per row, in
  `(watchlist_id, symbol)` order. Each statement **recomputes the class from ingest at statement
  time**, so a row whose class changed since REPORT (for example, a new live signal arrived) writes
  nothing and is printed as `changed since REPORT`. Output: `RESULT watchlist_id symbol outcome`
  lines (`seeded` / `marked` / `changed since REPORT`), then
  `DONE seeded=… marked=… changed_since_report=…`.
- If APPLY aborts part-way, it prints `ABORTED seeded=… marked=… changed_since_report=…
  (re-run is idempotent)`. Re-running the same command is safe: rows already written are skipped.
- Paste the APPLY output into the change record next to the REPORT.

## 8. No grace period — the clock starts at APPLY

**Marks and `seed_expired` seeds are due on the very next prune tick.** The tick interval is
`portfolio.watchlist.signal_prune_interval_seconds` (default `300` s), and **every portfolio restart
runs a tick at startup**. Once APPLY finishes, you have at most one interval to stop the removals.

Each removal emits an owner-visible ledger event. The owner rides in `AppendEventRequest.user_id`
and the stream key is `watchlist:<watchlist_id>`:

- `portfolio.watchlist.signal_entry_expired`: a SEED entry whose `valid_until` passed. The payload
  includes `signal_id` and `valid_until`.
- `portfolio.watchlist.signal_entry_removed_untracked`: a marked (`signal_id NULL`) entry. The
  payload is `{user_id, watchlist_id, symbol, strategy_id}`.

Events are emitted after the commit, so a crash between the two loses the event but never the
removal. **The pasted REPORT is the authoritative record of what the backfill marked.**

## 9. Emergency stop and undo

Act **within one interval of APPLY**. Run the SQL through
[`operator-db-access.md`](operator-db-access.md) and record each statement and its row count in the
change record.

1. **Stop the untracked removals only (marks):**

   ```sql
   DELETE FROM portfolio.watchlist_signal_expiry WHERE signal_id IS NULL;
   ```

2. **Stop everything** (every remaining entry becomes untracked, so nothing is pruned):

   ```sql
   TRUNCATE portfolio.watchlist_signal_expiry;
   ```

   This also drops the expiry rows that the agent's adds wrote. To re-seed, re-run the idempotent
   backfill (REPORT, approval, APPLY).
3. **Raising the interval is not a pause.** A new
   `portfolio.watchlist.signal_prune_interval_seconds` value takes effect only after the current
   sleep ends. There is no pause switch.
4. **Rolling portfolio back** to the pre-281 image is the second line of defense. It stops the prune
   loop, and the `018` table stays in place, unread.

**Entries already removed** are not restored by any of the above. Rebuild each one as a MANUAL
re-add for its owner, using the pasted REPORT (owner, watchlist, symbol, strategy) and the
`signal_entry_removed_untracked` / `signal_entry_expired` events.

## 10. Accepted residuals

These behaviors were signed off at design time. They are not defects:

- Only **agent-recorded `direction = 'watchlist'`** signals keep an entry alive after the backfill.
  Signals ingested outside the agent path, and buy/sell signals, never renew it.
- A MANUAL add does not pin a SIGNAL entry. A replace-all update that re-stamps the entry as MANUAL
  makes it permanently immune to the prune.
- A failed or deduplicated renewal add does not extend the expiry, so the entry is pruned early, at
  its old `valid_until`.
- Adding an already-expired signal adds the entry, and the next tick prunes it.
- A ledger event lost to a crash after the commit (§8). The pasted REPORT is the authoritative
  backfill record.

## 11. Order of environments

1. **Staging first.** Complete §3–§8 against the `staging` pool and watch the next tick's events.
2. **Then production**, with its own REPORT, approval and APPLY. A staging REPORT or its bounds are
   never reused.
