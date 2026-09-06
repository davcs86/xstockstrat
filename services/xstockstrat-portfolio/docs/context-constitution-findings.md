# xstockstrat-portfolio — Constitution Findings

Defects and drift surfaced by `/context-constitution` on 2026-07-24; refreshed 2026-09-02 (branch
`claude/loaded-plugins-list-d120nl` @ `82a0549` — all open rows re-verified, still reproduce; re-anchored
2026-09-03 (branch `claude/watchlist-bulk-default-strategy-zxx6su` @ `d4cd327`) after feature-170
`portfolio_service.go` line shifts — all rows still reproduce, none resolved). For
triage/fixing, not governance. Repo-wide defects (Go 1.22 doc-lie) live in the root findings log.

## Latent bugs (looks broken, not merely non-obvious)

| Issue | Impact | Evidence |
|---|---|---|
| **P&L / snapshot-equity / risk value-parity break**: `GetPnL`, `broadcastSnapshot`, and `checkRiskLimits` recompute market value from mid-quotes instead of the broker-authoritative `enrichPositions` path (PORTFOLIO-1). Re-confirmed 2026-08-09: still reproduces — none of the three call `enrichPositions`. | For any broker-synced position (`CurrentPrice > 0`), P&L, snapshot equity, and risk-concentration numbers diverge from what the UI is shown via `ListPositions`/`GetPortfolio`. | `portfolio_service.go:561` (`GetPnL`), `:733` (`broadcastSnapshot`), `:768` (`checkRiskLimits`); contract asserted `portfolio_repo.go:244-246`, `migrations/005_positions_broker_valuation.up.sql:5-9` |
| **`CreateWatchlist` collapses a duplicate-name collision to `CodeInternal`** (surfaced 2026-08-26, feature 127 archive): a `UNIQUE(user_id,name)` violation returns `connect.CodeInternal`, indistinguishable from a DB outage — callers can't match `ALREADY_EXISTS`. Fix: map the unique-violation to `CodeAlreadyExists`; `EnsureSignalWatchlist`'s atomic find-or-create is the only race-safe path today. | A duplicate watchlist-name create is reported as an internal error, not a client error; callers cannot distinguish it from an outage and cannot branch/retry correctly. | `internal/service/portfolio_service.go:1304` (`CreateWatchlist`, `CodeInternal` returns `:1415,1423` — no `ALREADY_EXISTS` branch) |

## Dead / orphaned code

| What | Why it looks dead | Evidence |
|---|---|---|
| ~~`portfolio.risk.max_drawdown_pct` config key~~ **RESOLVED (feature 172)**: now enforced per-account — `checkRiskLimits` fetches `GetAccountDrawdowns` and `evaluateDrawdowns` emits a WARNING alert on breach (peak_equity HWM, migration 016) | ~~read then discarded~~ now enforced | `portfolio_service.go:740` (`GetFloat`), `:769-774` (`GetAccountDrawdowns`/`evaluateDrawdowns` enforcement — formerly the `_ = maxDrawdownPct` discard at `:750`) |

## Open questions (unresolved *why* — needs a maintainer)

- On process restart the first ledger connect replays `order.filled` from sequence 0 and `processOrderFill` applies **incremental** qty to the persisted row — does a restart double-count fills, or is it always corrected by the `account.positions.synced` broker snapshot? If some accounts never receive broker syncs, replay-from-0 is a latent double-count. `internal/service/portfolio_service.go:146` (`consumeEventStream`), `:180` (`streamEventsFrom`), `cmd/server/main.go` (`go svc.ConsumeOrderFills(ctx)`) — status: **open**
- `emitEvent` uses a fresh `uuid.NewString()` per call as the idempotency key, so dedup protects only in-flight retries, not event reprocessing — is retry-only dedup the intended scope? `portfolio_service.go:816` (`emitEvent`), `:831` (`uuid.NewString()`) — status: **open**

---
_Surfaced by [context-forge](https://github.com/davcs86/agent-plugins). Defects to action, not rules. Re-run `/context-constitution` to refresh._
