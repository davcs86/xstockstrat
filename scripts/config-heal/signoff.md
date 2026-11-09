# Feature 295 — G2 operator sign-off (migration 041)

The only veto (design § Operator gates). A re-sign may only remove tuples from the allowlist block.

- Tool: `services/xstockstrat-indicators/app/maintenance/config_inventory.py`
  sha256 `5515ed6eb80520cdfc0512f6e0304753f9fd32f8fedbf628c633dcaf0665d1e5`
- Allowlist block: `scripts/config-heal/allow-signed.sql` (38 tuples; Step 36 inserts it into 041
  verbatim between the `-- allow_041:begin` / `-- allow_041:end` markers)
  sha256 `755deaf5ea8c51b032ffa3a1035ebdb3de6943cdec54cb69ae4c57f7b4a22575`
- Reveal: `scripts/config-heal/reveal-request.json` sha256
  `8e084bcbc84e182aa1a7d44b944f0bee0c624e6c65623846030ee9b1d1756348`; output
  `scripts/config-heal/reveal-staging.jsonl` output_sha256
  `713922567490dae79f4d1436ab7bc242fc39c8a08acbb6220031727ba87e6ca3`

## Staging

- inventory: `scripts/config-heal/inventory-staging.jsonl` output_sha256
  `633f91d52d2aada7c96deeed2722152aa70dfcf85c4001fd9816dabf56ab701b`
- dry-run: `scripts/config-heal/dryrun-staging.tsv` sha256
  `0a7e72eea4f48d055a4c11fc375eb91818821e07772a825f1560836e44132e8b`
- reviewed: 34 twin-deleted; 5 twin-kept-unsigned (staging intents kept by decision:
  `analysis` `fundsignal.enabled`, `fundsignal.run_interval_hours`, `fundsignal.min_conviction_to_emit`,
  `fundsignal.scoring_formula_id`; `marketdata` `fundamentals.history.enabled`); 0 retyped,
  0 signoff-type, 0 twin-secret-class; default-synced not observable (loader takes defaults from the catalog)
- operator: davcs86 — date: 2026-11-07

## Fresh (CI, docker-compose, production first deploy)

- inventory: `scripts/config-heal/inventory-fresh.jsonl` output_sha256
  `0f6319097225878bc51298cc604dfdddd36c8fe2cb2830267d44f40fe15f97de`
- dry-run: `scripts/config-heal/dryrun-fresh.tsv` sha256
  `141e4cd56797e07fbb6013d3beeec8a551eddd58a91112f6207607f9590bb238`
- reviewed: 38 twin-deleted (incl. production's seeded `backtest.max_duration_seconds`=120 → reads
  300 unless set); 6 default-synced (`default_value` only); 0 retyped, 0 signoff-type,
  0 twin-secret-class
- operator: davcs86 — date: 2026-11-07

# Feature 296 — R sign-off

R is `services/xstockstrat-config/migrations/044_config_keys_relative.up.sql`. It reached `main-dev` with an
**empty** `allow_296` block and was **not edited afterwards** (F-01). The 5 staging twins were cleared by a
hand data repair instead, so no signed tuple is embedded in R. No value and no user id is recorded here.

- R file sha256: `1508c0833655d8c240c04de256b68b28b0bb2538d33255ffaad65dd7c17aff2a` (empty allow block; unchanged since merge `dec9064`)
- Merge deploy (2026-11-08): the `db-migrator` ran R and it refused with `feature 296: 5 violation(s); nothing changed`,
  five `uncovered-twin` lines on `staging`: `analysis` `fundsignal.enabled`, `fundsignal.min_conviction_to_emit`,
  `fundsignal.run_interval_hours`, `fundsignal.scoring_formula_id`; `marketdata` `fundamentals.history.enabled`.
  No other violation class. R is one transaction, so nothing changed; config stayed **dirty at 44**, marker absent,
  369 prefixed rows unrenamed, `config_keys_report_296` absent (operator probe).
- Decision (operator): for every twin the **relative** spelling wins; the prefixed member is deleted.
- Repair (operator, direct `psql` as DB owner, one guarded transaction): deleted the 5 global non-secret prefixed
  members, wrote 5 `config.config_audit` rows (`changed_by` `operator:davcs86`, `reason` `feature 296: uncovered twin
  repaired by hand, relative spelling wins`, deleted value in `old_value`), and set
  `config_schema_migrations` to version 43, not dirty (the SQL equivalent of `migrate force 43`).
- Rehearsal before the repair was committed (2026-11-08): `BEGIN`; the repair; R; R+1; report counts; `ROLLBACK`. No
  error; `config_keys_report_296` held `per-user-parked` 1 only; 0 prefixed rows; marker `relative_keys_v1` set by
  `system:config-migration-044`; `config_values_key_relative_check` present; rollback verified (44 dirty, marker 0,
  369 prefixed, report table absent).
- Apply: DO deployment `08c0534f` (`db-migrator` deploy log): `44/u config_keys_relative (169.878074ms)`,
  `45/u config_keys_relative_check (293.905454ms)`, `All migrations complete`; no ERROR, FATAL or refusal lines;
  deployment `ACTIVE`, 43/43 steps, 12/12 components healthy.
- State after (operator probe): `config_schema_migrations` 45, not dirty; marker `relative_keys_v1` 1; prefixed rows 0;
  report `per-user-parked` 1.
- DO production and both homelab databases are fresh by operator commitment (`context.md`, 2026-11-07 and
  2026-11-08); not re-verified here. They hold no twins, so R applies with its empty block.
- operator: davcs86 — date: 2026-11-08
