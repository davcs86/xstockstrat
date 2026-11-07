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
