# xstockstrat-trading — Constitution

Derived by `/context-constitution` (context-forge) on 2026-07-24; citations re-grounded 2026-08-27.
Captures the **non-obvious** local invariants of the trading service (order execution, gRPC 50051) —
patterns it follows but never wrote down, and the places that break them. Does not restate
documented/CI-enforced rules (see `## Pointers`).

> Inherits all rules of the root constitution (`../../../docs/context-constitution.md`). This file lists only
> what is specific to **xstockstrat-trading**.

## Rules (`TRADING-*`) — binding, easy-to-miss conventions

| ID | Rule | Why | Evidence | Example (canonical `path:line`) |
|---|---|---|---|---|
| **TRADING-1** | **Every RPC is implemented twice** — a Connect method *and* a `grpcTradingAdapter` twin — and only the adapter is registered (`grpcHdl.GRPCHandler()`). A new RPC must add both, or it is unreachable over the wire. | The served surface is the gRPC adapter; a Connect-only method compiles but is never registered. | Connect order RPCs `internal/handler/trading.go:31-121`, adapter twin `:134-243`, broker-account Connect `:246-303`/adapter `:303-341`; registration `cmd/server/main.go:143` | `internal/handler/trading.go:134-243` |
| **TRADING-2** | **Proto enums persist as hand-mapped lowercase strings; `0` floats persist as SQL NULL** (`sideStr`/`typeStr`/`statusStr`/`modeStr` on write, `parse*` on read; `nullableFloat` maps 0→NULL for price columns). | The `CHECK (side IN ('buy','sell'))` constraint and every read path assume the string/NULL contract; storing the enum int or a literal 0.0 diverges. (Root PLAT-F1 is the platform statement of this.) | write uses helpers at `internal/repository/trading_repo.go:83-86`; helper defs `sideStr:350`, `typeStr:357`, `statusStr:372`, `modeStr:391`, `nullableFloat:398`; `parse*:414-455` | `internal/repository/trading_repo.go:350-460` |
| **TRADING-3** | **Broker adapters return the sentinel `broker.ErrInvalidCredentials` only for HTTP 401/403; every other failure is a wrapped transient error.** Credential-health classification branches on `errors.Is(err, ErrInvalidCredentials)`. | A new adapter returning a plain error on 401 makes credential-health classify auth failure as UNKNOWN, so `syncPositions` never skips a dead account and hammers the broker every cycle. | authoritative `internal/broker/broker.go:12`; honored `internal/broker/alpaca.go:524`, `ibkr.go:525`; consumed `internal/service/trading.go:2697` | `internal/broker/broker.go:12` |
| **TRADING-4** | **DB persistence is best-effort; the in-memory `s.orders` map — not the DB — is the source of truth the fill poller iterates.** Write errors are logged (`slog.Warn`), never returned. | Treating a DB write failure as fatal, or relying on the DB alone for fill polling, breaks cross-restart reconciliation (`LoadInflightOrders`, `:263`). (Instance of root PLAT-N1.) | `s.orders` writes `internal/service/trading.go:623,823,931,999,1145`; best-effort persist warns `:628,735` | `internal/service/trading.go:623` |
| **TRADING-5** | **The `credStatus` cache gates DB writes and rolls back on persist failure** — `validateAndRecordCredential` skips the write when status is unchanged and restores the prior cached value if the write fails, so the next cycle retries. | Prevents redundant writes and a lost-update on a transient DB error. | `internal/service/trading.go:2326` (`validateAndRecordCredential`) | `internal/service/trading.go:2326` |

## Norms (`TRADING-*`) — defaults & asymmetry guidance

| ID | Norm | Why | Evidence | Example (canonical `path:line`) |
|---|---|---|---|---|
| **TRADING-N1** | **Identity for order-mutation RPCs comes from `req.UserId` (message body); broker-account RPCs read `x-user-id` from gRPC metadata.** Follow the pattern of the RPC family you're extending — don't mix the two identity sources. **Exception (feature 157):** `ConfirmOrder` overwrites `req.Msg.UserId = extractUserID(ctx)` from metadata (`internal/handler/trading.go:69-75`); `PlaceOrder`/`CancelOrder`/`ReplaceOrder` still pass the body identity through. | The two families use different trust boundaries (see open question in findings); copying the wrong one changes who a call acts as. | body: order RPCs in `internal/handler/trading.go`; metadata: `extractUserID` `:234`; ConfirmOrder override `:69-75` | `internal/handler/trading.go:234` |

## Gotchas & scars

- **Async emits are detached (`context.Background()`), never the request ctx** — passing the request ctx (canceled on return) silently drops the ledger/alert event. This is not "one exception" anymore (`syncAccountPositions`) — any **poller-owned long-lived context** may emit synchronously on purpose, since it isn't a per-request ctx: feature 102's reconciliation poller (`emitReconciliationFinding`, `resolveUnknownIntents`) also does. The rule is per-request-ctx-never, poller-ctx-may. Evidence: detached call sites `internal/service/trading.go:631,647,745` (`emitLedgerEvent` def `:3400`); synchronous-on-poller-ctx `emitReconciliationFinding:1642`, `resolveUnknownIntents:1893`. (Root PLAT-N1.)
- **`broker_type` SMALLINT must stay in lockstep with `common.v1.BrokerType`** (1=ALPACA, 2=IBKR) — cast without validation; documented only in migration comments. Renumbering the enum silently mis-maps brokers. Evidence: casts `internal/service/trading.go:226,304,394,404,609,663,816,2779,2790`; migrations 002/003.
- **SEV-1 scar (root PLAT-8): `WatchConfig` silently subscribed at dev/all scope for the service's entire lifetime until 2026-08-07.** `config.Watcher` declared `environment`/`tradingMode` fields and sent them on every request, but `NewWatcher` never populated them — so every environment-tagged config row (e.g. `trading.risk.bracket_orders_enabled=false` seeded for production by `config` migration 013) was silently unreachable. Fixed by commit `1413399`'s `resolveEnvironment`/`resolveTradingMode` helpers (`NewWatcher:85`, `resolveEnvironment:105`, `resolveTradingMode:114`). Any new per-env config key is at risk of the same silent no-op unless the service's `NewWatcher` call site is checked. (Feature 147 later dropped the `trading_mode` request half entirely — `resolveTradingMode` lingers but is no longer sent.)

## Candidate rules (unverified)

| Candidate | Why suspected | What would confirm it |
|---|---|---|
| Fill-poller mutates shared `*tradingv1.Order` pointers outside `s.mu` while `StreamOrderUpdates` reads them — possible data race | `submitOrder` mutates `order.*` (`trading.go:684,707,713-716,724-727`) after releasing the lock at `:624` | the race detector / a concurrency review |

## Pointers (already documented or CI-enforced — not restated here)

| What | Where |
|---|---|
| `AccountRepo` reuses `TradingRepo.Pool()` (no second pool); cap=2; PgBouncer exec-mode (root PLAT-7) | `cmd/server/main.go:83`, `internal/repository/pool.go:16-41` (`defaultMaxConns:16`, `QueryExecModeExec:37`); root pool budget |
| Header propagation via server+client interceptors | `internal/middleware/propagation.go`; `docs/patterns/header-propagation.md` (root PLAT-4) |
| Blocks on config `WatchConfig` snapshot (90s) before serving | `internal/config/config.go:167` (`WaitForSnapshot`); `docs/patterns/config-startup.md` |

---
_Forged by [context-forge](https://github.com/davcs86/agent-plugins). It captures the
non-obvious — nothing here is invented; re-run `/context-constitution` to refresh after the code changes._
