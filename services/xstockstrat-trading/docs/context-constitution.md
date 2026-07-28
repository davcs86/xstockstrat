# xstockstrat-trading — Constitution

Derived by `/context-constitution` (context-forge) on 2026-07-24. Captures the **non-obvious** local
invariants of the trading service (order execution, gRPC 50051) — patterns it follows but never wrote
down, and the places that break them. Does not restate documented/CI-enforced rules (see `## Pointers`).

> Inherits all rules of the root constitution (`../../../docs/context-constitution.md`). This file lists only
> what is specific to **xstockstrat-trading**.

## Rules (`TRADING-*`) — binding, easy-to-miss conventions

| ID | Rule | Why | Evidence | Example (canonical `path:line`) |
|---|---|---|---|---|
| **TRADING-1** | **Every RPC is implemented twice** — a Connect method *and* a `grpcTradingAdapter` twin — and only the adapter is registered (`grpcHdl.GRPCHandler()`). A new RPC must add both, or it is unreachable over the wire. | The served surface is the gRPC adapter; a Connect-only method compiles but is never registered. | `internal/handler/trading.go:31-176,178-209,280-318`; registration `cmd/server/main.go:129` | `internal/handler/trading.go:109-176` |
| **TRADING-2** | **Proto enums persist as hand-mapped lowercase strings; `0` floats persist as SQL NULL** (`sideStr`/`typeStr`/`statusStr`/`modeStr` on write, `parse*` on read; `nullableFloat` maps 0→NULL for price columns). | The `CHECK (side IN ('buy','sell'))` constraint and every read path assume the string/NULL contract; storing the enum int or a literal 0.0 diverges. (Root PLAT-F1 is the platform statement of this.) | `internal/repository/trading_repo.go:283-384,331` | `internal/repository/trading_repo.go:283-384` |
| **TRADING-3** | **Broker adapters return the sentinel `broker.ErrInvalidCredentials` only for HTTP 401/403; every other failure is a wrapped transient error.** Credential-health classification branches on `errors.Is(err, ErrInvalidCredentials)`. | A new adapter returning a plain error on 401 makes credential-health classify auth failure as UNKNOWN, so `syncPositions` never skips a dead account and hammers the broker every cycle. | authoritative `internal/broker/broker.go:12`; honored `internal/broker/alpaca.go:426`, `ibkr.go:407`; consumed `internal/service/trading.go:1190` | `internal/broker/broker.go:12` |
| **TRADING-4** | **DB persistence is best-effort; the in-memory `s.orders` map — not the DB — is the source of truth the fill poller iterates.** Write errors are logged, never returned. | Treating a DB write failure as fatal, or relying on the DB alone for fill polling, breaks cross-restart reconciliation (`LoadInflightOrders`). (Instance of root PLAT-N1.) | `internal/service/trading.go:311,349,373,419,496,724,169` | `internal/service/trading.go:311` |
| **TRADING-5** | **The `credStatus` cache gates DB writes and rolls back on persist failure** — `validateAndRecordCredential` skips the write when status is unchanged and restores the prior cached value if the write fails, so the next cycle retries. | Prevents redundant writes and a lost-update on a transient DB error. | `internal/service/trading.go:1072-1091` | `internal/service/trading.go:1072-1091` |

## Norms (`TRADING-*`) — defaults & asymmetry guidance

| ID | Norm | Why | Evidence | Example (canonical `path:line`) |
|---|---|---|---|---|
| **TRADING-N1** | **Identity for order-mutation RPCs comes from `req.UserId` (message body); broker-account RPCs read `x-user-id` from gRPC metadata.** Follow the pattern of the RPC family you're extending — don't mix the two identity sources. | The two families use different trust boundaries (see open question in findings); copying the wrong one changes who a call acts as. | body: `internal/handler/trading.go` order RPCs; metadata: `internal/handler/trading.go:211-221` (`extractUserID`) | `internal/handler/trading.go:211-221` |

## Gotchas & scars

- **Async emits are detached (`context.Background()`), never the request ctx** — passing the request ctx (canceled on return) silently drops the ledger/alert event. The one exception, `syncAccountPositions`, emits *synchronously* on purpose because the poller counts its return. Evidence: `internal/service/trading.go:315-346` vs `:898,914`. (Root PLAT-N1.)
- **`broker_type` SMALLINT must stay in lockstep with `common.v1.BrokerType`** (1=ALPACA, 2=IBKR) — cast without validation; documented only in migration comments. Renumbering the enum silently mis-maps brokers. Evidence: `internal/service/trading.go:1176,1256`; migrations 002/003.

## Candidate rules (unverified)

| Candidate | Why suspected | What would confirm it |
|---|---|---|
| Fill-poller mutates shared `*tradingv1.Order` pointers outside `s.mu` while `StreamOrderUpdates` reads them — possible data race | `trading.go:678-728` mutates `order.*` after releasing the lock at `:676` | the race detector / a concurrency review |

## Pointers (already documented or CI-enforced — not restated here)

| What | Where |
|---|---|
| `AccountRepo` reuses `TradingRepo.Pool()` (no second pool); cap=2 | `cmd/server/main.go:83`, `internal/repository/pool.go:15-28`; root pool budget |
| Header propagation via server+client interceptors | `internal/middleware/propagation.go`; `docs/patterns/header-propagation.md` (root PLAT-4) |
| Blocks on config `WatchConfig` snapshot (90s) before serving | `internal/config/config.go:131-140`; `docs/patterns/config-startup.md` |

---
_Forged by [context-forge](https://github.com/davcs86/agent-plugins). It captures the
non-obvious — nothing here is invented; re-run `/context-constitution` to refresh after the code changes._
