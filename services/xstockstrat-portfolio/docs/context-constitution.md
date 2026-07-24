# xstockstrat-portfolio — Constitution

Derived by `/context-constitution` (context-forge) on 2026-07-24. Captures the **non-obvious** local
invariants of the portfolio service (position tracking, P&L, gRPC 50052). Does not restate
documented/CI-enforced rules (see `## Pointers`).

> Inherits all rules of the root constitution (`../../../docs/context-constitution.md`). This file lists only
> what is specific to **xstockstrat-portfolio**.

## Rules (`PORTFOLIO-*`) — binding, easy-to-miss conventions

| ID | Rule | Why | Evidence | Example (canonical `path:line`) |
|---|---|---|---|---|
| **PORTFOLIO-1** | **Broker valuation is authoritative: `enrichPositions` skips any position the broker already valued (`CurrentPrice > 0`) and only falls back to a marketdata mid-quote for un-valued rows.** All read paths must enrich this way. | Recomputing `mid*Qty` for a broker-valued position overwrites the broker's mark, so the figure stops reconciling with broker equity — the exact bug migration 005 fixed. | `internal/service/portfolio_service.go:261,280-288`; called `:308,330,351,820` | `internal/service/portfolio_service.go:280-288` |
| **PORTFOLIO-2** | **`cost_basis` is stored as *total signed cost* (qty × avg), never per-share** — sells scale `CostBasis` proportionally while holding `AvgEntry`; sync writes `costBasis = qty * avgCost`. | The P&L math `MarketValue − CostBasis` and the winners/losers filter depend on it; storing per-share or recomputing at read time breaks unrealized P&L. | `portfolio_service.go:213-217`; `internal/repository/portfolio_repo.go:248` | `internal/repository/portfolio_repo.go:248` |
| **PORTFOLIO-3** | **All ledger consumers go through one reconnect/resume helper that resumes from `lastSeq+1` in memory and treats `codes.Unavailable` as a benign close.** | Logging every close at ERROR trips alerting on routine GOAWAYs; resuming from 0 double-counts incremental order fills. (Instance of root PLAT-N3.) | `portfolio_service.go:112-129,135-160,165-170`; wired `:100,716,777` | `internal/service/portfolio_service.go:112-129` |
| **PORTFOLIO-4** | **Ledger/balance sync payloads are parsed by hand-written JSON structs, not the proto type** — a producer field rename silently zeroes the field here. Match the emitter's JSON tags exactly. | `unrealized_pl`/`day_pnl` etc. and the `trading_mode` string form `"TRADING_MODE_LIVE"` are matched by tag/value; the producer is xstockstrat-trading. | `portfolio_service.go:173-182,691-711,764-772,199,440,485` | `internal/service/portfolio_service.go:691-711` |

## Gotchas & scars

- **Three compute paths never got migrated to broker-authoritative valuation** (PORTFOLIO-1) — `GetPnL`, `broadcastSnapshot` equity, and `checkRiskLimits` still recompute from mid-quotes, so for broker-synced positions their numbers diverge from what `ListPositions`/`GetPortfolio` show. Recorded as a latent bug in findings; noted here so an agent doesn't copy the deviant loops. Evidence: `portfolio_service.go:366-371,564-571,602-612`.

## Candidate rules (unverified)

| Candidate | Why suspected | What would confirm it |
|---|---|---|
| `buildAccountPortfolio` passes empty `trading_mode`, mixing PAPER+LIVE rows for one account | `portfolio_service.go:811` single site | confirmation that an account_id never spans modes |

## Pointers (already documented or CI-enforced — not restated here)

| What | Where |
|---|---|
| pgxpool cap=2 / `DB_POOL_MAX` | `internal/repository/pool.go:15-28`; root pool budget |
| Header propagation interceptor; `x-user-id` read from header for ownership | `internal/middleware/propagation.go:27-35`; `portfolio_service.go:869,951` (root PLAT-4/PLAT-5) |
| gRPC keepalive on inter-service dials | `portfolio_service.go:57-61` (root PLAT-N3) |

---
_Forged by [context-forge](https://github.com/davcs86/agent-plugins). It captures the
non-obvious — nothing here is invented; re-run `/context-constitution` to refresh after the code changes._
