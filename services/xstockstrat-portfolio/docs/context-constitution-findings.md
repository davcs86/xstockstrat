# xstockstrat-portfolio — Constitution Findings

Defects and drift surfaced by `/context-constitution` on 2026-07-24. For triage/fixing, not
governance. Repo-wide defects (Go 1.22 doc-lie, `getEnvBool` dead) live in the root findings log.

## Latent bugs (looks broken, not merely non-obvious)

| Issue | Impact | Evidence |
|---|---|---|
| **P&L / snapshot-equity / risk value-parity break**: `GetPnL`, `broadcastSnapshot`, and `checkRiskLimits` recompute market value from mid-quotes instead of the broker-authoritative `enrichPositions` path (PORTFOLIO-1). | For any broker-synced position (`CurrentPrice > 0`), P&L, snapshot equity, and risk-concentration numbers diverge from what the UI is shown via `ListPositions`/`GetPortfolio`. | `portfolio_service.go:366-371,564-571,602-612`; contract asserted `portfolio_repo.go:244-246`, `migrations/005_positions_broker_valuation.up.sql:5-9` |

## Dead / orphaned code

| What | Why it looks dead | Evidence |
|---|---|---|
| `portfolio.risk.max_drawdown_pct` config key | read then discarded (`_ = maxDrawdownPct`, comment "handled by snapshots over time"); no drawdown logic | `portfolio_service.go:595,623` |

## Open questions (unresolved *why* — needs a maintainer)

- On process restart the first ledger connect replays `order.filled` from sequence 0 and `processOrderFill` applies **incremental** qty to the persisted row — does a restart double-count fills, or is it always corrected by the `account.positions.synced` broker snapshot? If some accounts never receive broker syncs, replay-from-0 is a latent double-count. `portfolio_service.go:108-110,211,753-758` — status: **open**
- `emitEvent` uses a fresh `uuid.NewString()` per call as the idempotency key, so dedup protects only in-flight retries, not event reprocessing — is retry-only dedup the intended scope? `portfolio_service.go:657` — status: **open**

---
_Surfaced by [context-forge](https://github.com/davcs86/agent-plugins). Defects to action, not rules. Re-run `/context-constitution` to refresh._
