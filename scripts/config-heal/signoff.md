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

# Feature 305 — dead-row sign-off

The dead-row migration (slug `config_dead_rows_prune`) deletes four global, non-secret rows: `analysis` `opportunity.sparkline_bars` and `marketdata` `alpaca.paper`, each in the `staging` and `production` environment rows (parity between the two environments). `ledger` `stream.notify_enabled` is kept (baseline entry re-owned to feature 306). No value and no user id is recorded here, only keys and sha256.

- Evidence file sha256: `daf034070fbb1bc66d7bd834ac4306b240e355ff5fb1401b112015935624cae6`
- Signed block sha256: `fbdf4714617e6225f947f8cccdfed9f52e5c4e5c857ff255f9e896c9369ea481` (the lines strictly between `-- dead_rows_305:begin` and `-- dead_rows_305:end` in `scripts/config-heal/dead-rows-signed.sql`, each ending in LF)
- Window: W0 `2026-11-07T06:00:00Z`, W1 `2026-11-10T00:00:00Z` (66 h, 11 six-hour bins; coverage logging began 2026-11-07 ~03:13Z when feature 295's cores reached staging). Datasource Grafana Cloud `grafanacloud-logs`, selector `{deployment_environment="staging", service_name=~"analysis|marketdata"}`. Bins are Loki left-open `(t-6h, t]`.
- Pinned queries as run (the Python/Node text family and the Go attribute family are disjoint; `service_name` is the short-name stream label):
  - Q1 coverage, text (range, step 21600 s, start W0+6h, end W1): `sum by (service_name, ns) (count_over_time({deployment_environment="staging", service_name=~"analysis|marketdata"} |= "config.read_coverage ns=" | regexp \`config\.read_coverage ns=(?P<ns>\S+) keys=\` [6h]))`
  - Q2 coverage, Go (same range): `sum by (service_name, ns) (count_over_time({deployment_environment="staging", service_name=~"analysis|marketdata"} |= "config.read_coverage" != "config.read_coverage ns=" | ns != "" [6h]))`
  - Q3 read hits, text (instant at W1): `sum by (service_name, ns, key) (count_over_time({deployment_environment="staging", service_name=~"analysis|marketdata"} |= "config.read_key ns=" | regexp \`config\.read_key ns=(?P<ns>\S+) key=(?P<key>\S+)\` | ns=~"analysis|marketdata" [66h]))`
  - Q4 read hits, Go (instant at W1): `sum by (service_name, ns, key) (count_over_time({deployment_environment="staging", service_name=~"analysis|marketdata"} |= "config.read_key" != "config.read_key ns=" | ns=~"analysis|marketdata" [66h]))`
  - keys= control: `max by (service_name, ns) (last_over_time|max_over_time(... | unwrap n|keys [66h]))` for each family; last equals max in the window (analysis/analysis 41, analysis/marketdata 1, marketdata/marketdata 28).
- Result: all three subscriber pairs logged coverage in all 11 bins; no `config.read_key` line in either spelling for either signed key; a free-text search of all analysis and marketdata lines in the window finds neither key; distinct canonical read-hit keys per pair (45, 1, 29) are at least the `keys=N` control. The committed evaluator judges both signed keys `dead`.
- Subscriber-equality proof (`subscribersOf(registry.receivers)` limited to the signed namespaces equals the evidence file's `subscriber` rows): `[{"service":"analysis","ns":"analysis","class":"single"},{"service":"analysis","ns":"marketdata","class":"single"},{"service":"marketdata","ns":"marketdata","class":"single"}]`. No other service logs coverage for the `analysis` or `marketdata` namespaces in the window.
- Signed shas come from the committed inventories, not from a fresh read of the live database: each of the four equals its row in both `scripts/config-heal/inventory-fresh.jsonl` (CI fresh DB) and `scripts/config-heal/inventory-staging.jsonl` (DO dev database). The operator accepts these values; a drifted value is reported as an `unmatched-signed-tuple` and the row is left in place (safe direction), and the Step 13 rolled-back rehearsal is the live check.
- Accepted assumption: the evidence covers `deployment_environment="staging"` only. The `production`-environment rows are rows inside the same DO dev and CI databases that no service reads either, so they rest on the same code and the static no-reader evidence. The logs carry no label separating DO dev from any other staging deployment; the operator confirms `staging` is one deployment.
- Scope (operator, 2026-11-10): DO production and both homelab databases have no running instance and are out of scope; the rehearsal and verification run on DO dev only.
- Authorship: signed off by the operator in the working session on 2026-11-10 ("You have my sign off"); the section and the draft block were written by the agent at that instruction.
- Migration file sha256: `ddf407ae880a4e5187c9b48918076388d03d409a5395ac9acb44ec374924392c` (`services/xstockstrat-config/migrations/*_config_dead_rows_prune.up.sql` at commit a3dcf1b)
- Rehearsal (P2, DO dev only): database `xstockstrat-staging`, direct `:25060`, operator DB-owner `psql`; `BEGIN`, `\i` of the exact final up file, `ROLLBACK`, run twice. Result: 4 `dead-row-deleted`, 0 `unmatched-signed-tuple`, 0 per-user rows for the two keys. Pre-run state: config migrations at version 45 (clean), `relative_keys_v1` marker present, no `dead_rows_305` marker, 4 signed rows present, 398 `config_values` rows. Post-rollback: 398 rows and no `dead_rows_305` marker. No value or user id recorded.
- operator: davcs86 — date: 2026-11-10
