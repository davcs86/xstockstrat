# Runbook: Position-Fold Cutover (feature 311)

**When to use**: once per staging target, at the first deploy of a portfolio image that contains
migration `019_fill_applied_events` (feature 311, `fix-position-fold-correctness`). Use it again for
the rollback rule (§4), the production check (§5), and the two manual repairs (§6, §7).

The cutover is **stop-then-start**. There is no write fence. If an old and a new portfolio instance run
at the same time, a fill can be applied twice, and only the recorded result (§2) would show it. The
procedure covers staging only, because production has never launched. Production gets a check and no
cutover (§5).

All SQL below runs out of band with `psql` on the **direct** port (`docs/runbooks/operator-db-access.md`).
No command here edits a file in this repository.

---

## 1. Preconditions

The operator answers each line before the first target is cut over (design `O-61`). Any "no" or
"unknown" stops the runbook until the operator rules on it.

| # | Confirmation | Answer (yes / no) |
|---|---|---|
| 1 | **DO stop method.** Removing the `xstockstrat-portfolio` component from the `xstockstrat-staging` app spec and redeploying is accepted by DO. Other components still reference `${xstockstrat-portfolio.PRIVATE_DOMAIN}:50052` (`.do/app.dev.yaml:80`, `:321`, `:377`, `:635`), so the spec may be rejected until those references are handled too. | |
| 2 | **Homelab stop method.** `docker compose stop xstockstrat-portfolio` on the homelab staging VM stops portfolio, and nothing restarts it before the deploy. | |
| 3 | **Homelab `gate deploy` exit code.** `gate deploy` (`.github/workflows/deploy-homelab.yml`, step "Ship the release and deploy it") exits non-zero when the VM rolls the release back. If it does not, an unattended rollback can bring back the pre-`019` portfolio after the floor is stamped, and the job still looks green (see §4). | |
| 4 | **Alpaca bracket legs.** Alpaca's order list returns bracket legs as top-level orders in every open state. Leg adoption depends on this. | |
| 5 | **Trading while portfolio is stopped.** The operator accepts trading's behaviour during the stop: the risk check only warns, reconciliation skips, and `flattenAndHalt` cannot flatten. | |
| 6 | **Freeze is manual.** The merge precondition and the `main-dev` freeze are not enforced by any tool. Only the recorded evidence in §2 shows an overlap. | |

## 2. Cutover step (D-36, D-43), once per staging target

The targets are DO `xstockstrat-staging` and, while `vars.HOMELAB_STAGING_ENABLED == 'true'`, the homelab
staging VM. Both deploy from the same `main-dev` push (`.github/workflows/deploy-dev.yml`: "Deploy to dev"
and "Deploy to homelab staging"), so stop portfolio on **every** enabled target before you merge.

1. **Stop portfolio** on each target (the methods confirmed in §1, lines 1-2).
2. **Record `T_stop`** on each target's database, from the server clock and not from a laptop clock:

   ```sql
   SELECT now() AS t_stop;
   ```

3. **Freeze `main-dev`.** Announce the freeze and record the `main-dev` SHA:

   ```bash
   git fetch origin && git rev-parse origin/main-dev
   ```

4. **Merge the integration PR** (feature 311 → `main-dev`).
5. **Wait for the green Deploy run.** The deploy is also the start: it brings portfolio back on the new
   image (DO: the spec with the component restored; homelab: the new release). Migration `019` is
   applied first, by the `PRE_DEPLOY` migrator job on DO (`.do/app.dev.yaml:683`) and the
   `db-migrator` service on the homelab VM (`deploy/homelab/compose.yml:41`).
6. **Check the boot log line.** Portfolio logs this INFO line once its fill floor is loaded:

   ```text
   order fill floor loaded  floor=<timestamp>  stamped_now=true
   ```

   `stamped_now=true` means this boot wrote the floor. `stamped_now=false` at the first boot means a
   floor already existed. Stop and use §4 if you did not expect that.
7. **Read the floor and count the fills in `[T_stop, floor)`** on the same database:

   ```sql
   SELECT floor_recorded_at FROM portfolio.consumer_floors WHERE consumer = 'order_fill';

   SELECT count(*) AS fills_in_gap
   FROM ledger.events
   WHERE event_type = 'order.filled'
     AND recorded_at >= '<T_stop>'
     AND recorded_at <  '<floor_recorded_at>';
   ```

8. **List the Deploy runs between `T_stop` and the green run.** This list must be empty: no other
   `main-dev` push deployed while portfolio was stopped.

**Record one result per database** (copy the block into the integration PR or the feature's `context.md`):

```text
target:                      <DO xstockstrat-staging | homelab staging VM>
T_stop:                      <SELECT now() result>
floor_recorded_at:           <portfolio.consumer_floors value>
boot log line:               order fill floor loaded floor=<…> stamped_now=true
order.filled in [T_stop, floor): <count>
green deploy run:            <run URL>
main-dev SHA at T_stop:      <sha>
Deploy runs in between:      (none)
```

## 3. Accepted consequences

- **Fills in `[T_stop, floor)` are acked.** Their quantity heals at the next broker position sync, but
  their realized P&L is lost. The count from §2 step 7 is the size of that loss.
- **Late appends below the floor are acked.** If an append commits after the floor but its
  `recorded_at` (set when its transaction began) is before the floor, it is acked and not folded.
- **One server clock.** The floor compares ledger `recorded_at` with a portfolio-stamped time, so it
  assumes ledger and portfolio use the same Postgres server. On DO staging both use the `xstockstrat`
  cluster (`.do/app.dev.yaml:439` ledger direct, `:133-135` portfolio through PgBouncer, `:701-707`). On
  the homelab VM both DSNs use the same `DB_HOST` and `DB_NAME` (`deploy/homelab/compose.yml:15`
  direct `:5432`, `:21` pooled `:6432`). Confirm that the pooler forwards to that same server.

## 4. Rollback rule (D-44)

If a pre-`019` portfolio image ran **after** the floor was stamped (an unattended homelab rollback, or a
manual redeploy of an older image), the floor no longer describes what was folded. Then:

1. Stop portfolio on that target.
2. Delete the floor:

   ```sql
   DELETE FROM portfolio.consumer_floors WHERE consumer = 'order_fill';
   ```

3. Repeat §2 for that target.

## 5. Production check (D-47)

Production has no cutover. Before the **first** production promotion, record these two counts on each
production database:

```sql
SELECT count(*) AS positions FROM portfolio.positions;

SELECT count(*) AS order_fills FROM ledger.events WHERE event_type = 'order.filled';
```

If either count is non-zero, **stop the promotion** and wait for an operator ruling. No production
stop procedure is designed.

## 6. Redeliver a parked fill

A fill that could not be attributed (no usable side) is parked once, in
`portfolio.consumer_applied_events` with `outcome = 'parked'`, and every later boot acks it with no
ERROR. To retry it after the cause is fixed:

```sql
SELECT user_id, account_id, order_id, event_id, parked_reason, applied_at
FROM portfolio.consumer_applied_events
WHERE consumer = 'order_fill' AND outcome = 'parked';

DELETE FROM portfolio.consumer_applied_events
WHERE consumer = 'order_fill' AND outcome = 'parked'
  AND user_id = '<user_id>' AND account_id = '<account_id>' AND order_id = '<order_id>';
```

Then restart portfolio. The fill consumer replays from the start at boot, and the floor is not
re-stamped, so the fill is evaluated again.

## 7. Undo a tombstone

When an adoption list does not show a candidate leg as open, trading writes a closed-out row for it in
`trading.bracket_legs` with `status = 'NOT_OPEN_AT_ADOPTION'`. Trading logs it at INFO as
`bracket leg poll: adoption tombstone`, with `reason`, `account_id`, `leg_order_id` and `order_id`. The
leg is not evaluated again. If the tombstone was wrong (the leg was still open), delete the row:

```sql
DELETE FROM trading.bracket_legs
WHERE account_id = '<account_id>' AND leg_order_id = '<leg_order_id>'
  AND status = 'NOT_OPEN_AT_ADOPTION';
```

The next adoption list evaluates the leg again. No restart is needed.

## 8. Not in scope

- Repairing `realized_accum` / `fees_accum` values that are already inflated (product spec OQ-2). That
  needs a separate data-repair change.
- `instance_count` above 1 for portfolio. Sync and deregistration still rely on the in-process
  `positionsMu`, so it must stay 1.
