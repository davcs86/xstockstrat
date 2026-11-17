# docs/runbooks/ — Operational Runbooks

Step-by-step procedures for recurring platform operations. Each file is self-contained with prerequisites, steps, and verification. Runbooks already routed by the root `CLAUDE.md` Context Guide are listed only there.

| File | Purpose | Key trigger |
|---|---|---|
| `approval-flow.md` | Order approval flow — thresholds, approval mechanisms (API / n8n / UI), timeout policy, ledger events | Large order placed, approval required |
| `db-seed-migration-state.md` | One-time: seed golang-migrate version state on a database bootstrapped before migration tracking was added | Database already exists, no schema_migrations table |
| `delisting-rollout.md` | First rollout of delisted-symbol detection (feature 352): what happens at deploy, how to size the first-flag alert burst, how to defer it | Deploying feature 352; expecting or seeing a burst of `symbol_delisting` alerts |
| `hotfix-log.md` | Append-only register of all production hotfixes (Track A); updated by `/sdd-triage` | After each hotfix is deployed |
| `legacy-formula-authors.md` | Report and repair indicators formulas whose author is a legacy username (operator CLI or its `legacy_authors_ops` report/confirm/apply wrapper, runnable in the DO console; digest-confirmed apply, restart-and-verify) | Owner cannot see/execute their formulas; non-UUID authors in indicators.formulas |
| `ohlcv-lock-budget-tuning.md` | Diagnose + remediate TimescaleDB `out of shared memory` (SQLSTATE 53200) lock-table exhaustion on `marketdata.ohlcv` bars queries: the countable lock-budget invariant, the `max_locks_per_transaction` operator raise (Piece A), and its relationship to the chunk-interval migration (Piece B, `004`) | Recurring OHLCV `out of shared memory` / SQLSTATE 53200 on 400-day bars queries |
| `operator-db-access.md` | Sanctioned out-of-band admin/DB SQL access (direct `psql` via SSH / `doctl` / bastion) — no SQL-over-MCP surface exists (feature 214 removed postgres-mcp) | Operator needs to run admin SQL |
| `sops-secrets.md` | SOPS/age deploy secrets: key generation, environment setup, the one-shot bootstrap, local edit, rotation, adding a key, homelab enablement, the production reviewer gate and legacy-secret removal | Setting up, rotating or adding a deploy secret |
| `signal-watchlist-expiry-backfill.md` | One-shot DBA-reviewed backfill of expiry rows for legacy `source=SIGNAL` system-watchlist entries (portfolio `backfill-signal-expiry` REPORT → APPLY with `--expect-*` bounds; reading `NO_OWN_SIGNALS`/`legacy_live`; 3-day grace for untracked marks; seed_expired removed next tick, emergency stop within one prune interval for seeds and 72h for marks) | Stale `source=SIGNAL` watchlist entries after signal expiry / backlog cleanup |
