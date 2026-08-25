# xstockstrat-portfolio — Constitution

Derived by `/context-constitution` (context-forge) on 2026-07-24. Captures the **non-obvious** local
invariants of the portfolio service (position tracking, P&L, gRPC 50052). Does not restate
documented/CI-enforced rules (see `## Pointers`).

> Inherits all rules of the root constitution (`../../../docs/context-constitution.md`). This file lists only
> what is specific to **xstockstrat-portfolio**.

## Rules (`PORTFOLIO-*`) — binding, easy-to-miss conventions

| ID | Rule | Why | Evidence | Example (canonical `path:line`) |
|---|---|---|---|---|
| **PORTFOLIO-1** | **Broker valuation is authoritative: `enrichPositions` skips any position the broker already valued (`CurrentPrice > 0`) and only falls back to a marketdata mid-quote for un-valued rows.** All read paths must enrich this way. | Recomputing `mid*Qty` for a broker-valued position overwrites the broker's mark, so the figure stops reconciling with broker equity — the exact bug migration 005 fixed. | `internal/service/portfolio_service.go:312-314` (`enrichPositions`, `CurrentPrice > 0` skip `:314`, comment `:308-311`); called `:445,467,488,1011` | `internal/service/portfolio_service.go:312-314` |
| **PORTFOLIO-2** | **`cost_basis` is stored as *total signed cost* (qty × avg), never per-share** — sells scale `CostBasis` proportionally while holding `AvgEntry`; sync writes `costBasis = qty * avgCost`. | The P&L math `MarketValue − CostBasis` and the winners/losers filter depend on it; storing per-share or recomputing at read time breaks unrealized P&L. | `portfolio_service.go:266-269` (`newCost = existing.CostBasis * (newQty / existing.Qty)`); `internal/repository/portfolio_repo.go:263` | `internal/repository/portfolio_repo.go:263` |
| **PORTFOLIO-3** | **All ledger consumers go through one reconnect/resume helper that resumes from `lastSeq+1` in memory and treats `codes.Unavailable` as a benign close.** | Logging every close at ERROR trips alerting on routine GOAWAYs; resuming from 0 double-counts incremental order fills. (Instance of root PLAT-N3.) | `portfolio_service.go:156` (`consumeEventStream`), `:179` (`streamEventsFrom`), resume `lastSeq+1` `:159-166,181-182`, benign-close `isGracefulStreamClose` `:208-212` | `internal/service/portfolio_service.go:156-182` |
| **PORTFOLIO-4** | **Ledger/balance sync payloads are parsed by hand-written JSON structs, not the proto type** — a producer field rename silently zeroes the field here. Match the emitter's JSON tags exactly. | `unrealized_pl`/`day_pnl` etc. and the `trading_mode` string form `"TRADING_MODE_LIVE"` are matched by tag/value; the producer is xstockstrat-trading. | `portfolio_service.go:217-230` (`orderFillPayload` struct + json tags, grew one field — `StopPrice` — for feature 083's resting-stop learning), `TRADING_MODE_LIVE` match `:247,406` | `internal/service/portfolio_service.go:217-230` |
| **PORTFOLIO-5** | **Resting-stop risk is learned by replaying trading's `order.filled` ledger events at boot — never a synchronous portfolio→trading call — and the risk fields compute on read off the broker-authoritative `CurrentPrice`.** | A direct portfolio→trading stop lookup would create a trading↔portfolio dependency cycle; stops therefore live in an in-memory `stopStore` (no portfolio migration) rebuilt from the ledger via the same full-history replay as positions. Extends PORTFOLIO-1's broker-valuation seam (feature 083). | `stopStore` `:55,70-89`; learned on fill `:252-253` via full-history replay `:177-178`; `enrichRisk:335` → `enrichPositionRisk:349` → `applyStopRisk:364`; risk fields `:368-370`; `portfolio_risk_test.go` | `internal/service/portfolio_service.go:349-370` |
| **PORTFOLIO-6** | **`GetPosition`'s error classification is a load-bearing cross-service contract**: `classifyGetPositionError` maps only `repository.ErrPositionNotFound` to `NotFound`; every other error (DB failure, timeout) returns `Internal`. | `xstockstrat-trading`'s REDUCE_ONLY kill-switch fails **closed** on *any* `GetPosition` error, not just `NotFound` (`internal/service/trading.go:2818-2828`, feature 100). Changing this mapping back to a blanket `NotFound` would silently defeat trading's fail-closed halt behavior. Not documented in either service's CLAUDE.md. | `internal/handler/portfolio_handler.go:330-338`; `repository.ErrPositionNotFound` `internal/repository/portfolio_repo.go:191-195,214` | `internal/handler/portfolio_handler.go:330-338` |
| **PORTFOLIO-7** | **Watchlist writes carry `(symbol, strategy_id)` bindings with `bindings` taking precedence over the legacy flat `symbols` field, and `AddSymbols`/`AddWatchlistSymbols` can never rebind an existing symbol's `strategy_id`** (`ON CONFLICT (watchlist_id, symbol) DO NOTHING`) — only a full `Update` (delete+reinsert) can change a symbol's bound strategy. | Fixes a "fails-080" trap where an `AddSymbols` call silently no-oped a strategy rebind attempt. | `requestBindings` `internal/service/portfolio_service.go` (precedence, ~15 lines after `normalizeBindings`); `insertBindingsTx` `internal/repository/watchlist_repo.go` (`ON CONFLICT ... DO NOTHING`) | `internal/repository/watchlist_repo.go` (`insertBindingsTx`) |
| **PORTFOLIO-8** | **`ListAllWatchlistSymbols` is the platform's FIRST cross-user enumeration of per-user data, and is gated by the `x-internal-caller` allow-list — NEVER the admin `x-access-scope` bit.** Every other watchlist/portfolio RPC is `x-user-id`-scoped self-service; this one deliberately returns *all* users' distinct watchlist symbols to one internal caller (grant `analysis-fundsignal`), read from incoming gRPC metadata, fail-closed. The admin bit is explicitly ignored (an admin-only caller is denied). | The admin bit authorizes a human's own scope + globals, **never another user's per-user rows** (PR #994); using it for a cross-user read would revive the feature-092-removed self-asserted-admin pattern. This is portfolio's first authz gate — there was none before — so the mechanism (direct incoming-metadata read, `{callerID, rpc}` least-privilege grant mirroring config's `authz.ts`) is a new convention future gated RPCs must follow. | `internal/service/authz.go` (`hasInternalCallerAuthority`, `internalCallerAllowlist`, `HeaderInternalCaller`); `ListAllWatchlistSymbols` `internal/service/portfolio_service.go`; repo `ListAllSymbols` `internal/repository/watchlist_repo.go` (`SELECT DISTINCT symbol`) | `internal/service/authz.go` |

## Gotchas & scars

- **Three compute paths never got migrated to broker-authoritative valuation** (PORTFOLIO-1) — `GetPnL`, `broadcastSnapshot` equity, and `checkRiskLimits` still recompute from mid-quotes, so for broker-synced positions their numbers diverge from what `ListPositions`/`GetPortfolio` show. Recorded as a latent bug in findings; noted here so an agent doesn't copy the deviant loops. Evidence: `portfolio_service.go` `GetPnL:~496-506`, `broadcastSnapshot:~696-707`, `checkRiskLimits:~731-747` (none call `enrichPositions`).
- **SEV-1 scar (root PLAT-8): `WatchConfig` silently subscribed at zero-value scope until 2026-08-07.** `config.Watcher` declared `environment`/`tradingMode` fields but `NewWatcher` never populated them (identical bug fixed identically in marketdata/trading in the same commit, `1413399`). Fixed via `resolveEnvironment`/`resolveTradingMode` (`internal/config/config.go:64-97`, wired `cmd/server/main.go:46`).

## Candidate rules (unverified)

| Candidate | Why suspected | What would confirm it |
|---|---|---|
| `buildAccountPortfolio` passes empty `trading_mode`, mixing PAPER+LIVE rows for one account | `portfolio_service.go:1001-1002` (`buildAccountPortfolio`) single site | confirmation that an account_id never spans modes |

## Pointers (already documented or CI-enforced — not restated here)

| What | Where |
|---|---|
| pgxpool cap=2 / `DB_POOL_MAX`; PgBouncer exec-mode (root PLAT-7) | `internal/repository/pool.go:16-41` (`defaultMaxConns:16`, `QueryExecModeExec:37`); root pool budget |
| Header propagation interceptor; `x-user-id` read from header for ownership | `internal/middleware/propagation.go:27-35` (root PLAT-4/PLAT-5) |
| gRPC keepalive on inter-service dials | `portfolio_service.go:100` (`clientKeepAlive`, dials `:112-120`) (root PLAT-N3) |

---
_Forged by [context-forge](https://github.com/davcs86/agent-plugins). It captures the
non-obvious — nothing here is invented; re-run `/context-constitution` to refresh after the code changes._
