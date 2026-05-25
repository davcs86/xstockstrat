# docs/runbooks/ — Operational Runbooks

Step-by-step procedures for recurring platform operations. Each file is self-contained with prerequisites, steps, and verification.

| File | Purpose | Key trigger |
|---|---|---|
| `add-data-source.md` | Add a new OHLCV market data provider (Part 1) or newsletter/signal feed (Part 2), then wire it into indicators and analysis (Part 3) | New data provider or signal source |
| `approval-flow.md` | Order approval flow — thresholds, approval mechanisms (API / n8n / UI), timeout policy, ledger events | Large order placed, approval required |
| `bug-triage.md` | Classify a bug by severity and route to Track A (hotfix), Track B (config-only), or Track C (SDD fix); process steps for each track | Any bug report |
| `config-rollout.md` | Safely roll out config key changes via SetConfig; rollback procedure; emergency maintenance mode | Any config value change |
| `db-seed-migration-state.md` | One-time: seed golang-migrate version state on a database bootstrapped before migration tracking was added | Database already exists, no schema_migrations table |
| `feature-workflow.md` | Full feature lifecycle: branch → develop → PR to main-dev → validate on dev → PR to main → production deploy; hotfix procedure | Starting any feature or deployment |
| `historical-backfill.md` | Trigger, monitor, and verify historical OHLCV bar backfills via TriggerBackfill RPC or n8n webhook | Need historical data for backtesting or analysis |
| `hotfix-log.md` | Append-only register of all production hotfixes (Track A); updated by `/sdd-triage` | After each hotfix is deployed |
| `indicator-builder.md` | Build, test, register, and deploy custom Python formula indicators; sandbox constraints and limits | New custom indicator needed |
| `mcp-tools.md` | MCP tool reference — all six agent tools with parameter tables, return shapes, error cases, transport modes, and x-mcp-secret enforcement | Using or troubleshooting the agent MCP server |
| `proto-versioning.md` | v1→v2 proto migration workflow; when to create v2; parallel-feature safety | Breaking proto change required |
