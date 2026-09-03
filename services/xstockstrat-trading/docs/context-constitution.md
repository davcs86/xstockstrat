# xstockstrat-trading — Constitution

Derived by `/context-constitution` (context-forge) on 2026-07-24; citations re-grounded 2026-08-27;
refreshed 2026-09-02 (branch `claude/loaded-plugins-list-d120nl` @ `82a0549` — features 169/101/163/029:
TRADING-N1 superseded (identity now header-based); added TRADING-6, TRADING-N2/N3 + the AdminScope
cross-module contract); refreshed 2026-09-03 (branch `claude/watchlist-bulk-default-strategy-zxx6su` @
`d4cd327` — re-grounded the AdminScope-parity gotcha's agent `tools.py` anchor `:1691` → `:1711`).
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
| **TRADING-6** | **Order-intent dedup IDs are content hashes with the client nonce EXCLUDED** — `placeOrderRequestHash` clones the request and clears `ClientOrderId` before sha256; Replace/Cancel derive a UUIDv5 content hash with no nonce at all. | Hashing the whole message (nonce included) makes two *distinct* logical orders that reuse a stale nonce collide, so the second silently returns the first's stored result. Both are authoritative single-site definitions of the intent-ID contract, so a new mutating RPC wired into `order_intents` must follow it. | `placeOrderRequestHash` `internal/service/order_intent.go:36-43`; `deriveReplaceCancelIntentID:49-57` | `internal/service/order_intent.go:36-43` |

## Norms (`TRADING-*`) — defaults & asymmetry guidance

| ID | Norm | Why | Evidence | Example (canonical `path:line`) |
|---|---|---|---|---|
| **TRADING-N1** | **SUPERSEDED (2026-09-02) — identity is now header-based, not body.** Order-mutation RPCs (`PlaceOrder`/`CancelOrder`/`ReplaceOrder`/`ConfirmOrder`) resolve the caller from the `x-user-id` metadata header (`middleware.FromContext(ctx).UserID`) and the order **owner** from the server-resolved `accountEntry.userID`; the body `user_id` is deprecated/ignored (`ListOrders`/`StreamOrderUpdates` keep it as a *filter*). This is root **PLAT-11** and is fully stated in the service `CLAUDE.md` ("Caller identity comes from the `x-user-id` header…"), so it is now a pointer, not a live Norm. | The old body-identity premise no longer holds; kept as a superseded marker so the ID is not reused. | `internal/service/trading.go:480,939,1332,1486,3135` (`middleware.FromContext(ctx).UserID`), owner `:639`; CLAUDE.md § "Caller identity comes from the `x-user-id` header" | `internal/service/trading.go:480` |
| **TRADING-N2** | **Halt is memory-first, resume is DB-first — a deliberate crash-safety inversion.** `ResumeAccountSvc` clears the persisted halt (`accountRepo.UpdateHaltStatus(...false...)`) *before* deleting the in-memory `s.halted`/`haltReasons`/`haltedLastPolled` entries (the reverse of `haltAccount`'s memory-first order), so a crash between the two leaves the account **still halted** (safe). | Clearing the in-memory halt map first (or in one lock block) lets a crash leave a previously-halted account trading with no persisted halt on the next boot-hydrate. Don't reorder. | `ResumeAccountSvc` `internal/service/trading.go:3046-3057` | `internal/service/trading.go:3046-3057` |
| **TRADING-N3** | **Privileged/operator RPCs gate on `middleware.RequireAdminScope(ctx)` in the SERVICE layer, not the handler** — `ResumeAccountSvc` calls it as step (a); the handler only extracts `callerUserID`. | An agent following the identity-extraction-in-handler pattern would put the scope check in the handler (or omit it), diverging from where this codebase enforces authz and bypassing it on the adapter twin path. | `RequireAdminScope` `internal/service/trading.go:3027`; handler extract `internal/handler/trading.go:328` | `internal/service/trading.go:3027` |

## Gotchas & scars

- **Async emits are detached (`context.Background()`), never the request ctx** — passing the request ctx (canceled on return) silently drops the ledger/alert event. This is not "one exception" anymore (`syncAccountPositions`) — any **poller-owned long-lived context** may emit synchronously on purpose, since it isn't a per-request ctx: feature 102's reconciliation poller (`emitReconciliationFinding`, `resolveUnknownIntents`) also does. The rule is per-request-ctx-never, poller-ctx-may. Evidence: detached call sites `internal/service/trading.go:631,647,745` (`emitLedgerEvent` def `:3400`); synchronous-on-poller-ctx `emitReconciliationFinding:1642`, `resolveUnknownIntents:1893`. (Root PLAT-N1.)
- **`broker_type` SMALLINT must stay in lockstep with `common.v1.BrokerType`** (1=ALPACA, 2=IBKR; OFFLINE is now a third value) — cast without validation; documented only in migration comments. Renumbering the enum silently mis-maps brokers. Evidence: casts `internal/service/trading.go:226,304,394,404,609,663,816,2779,2790`; migrations 002/003.
- **Cross-module contract: `AdminScope = 0x04` must stay bit-for-bit in parity across Go/Python/Node.** Producer/peers: Go `middleware.AdminScope` (`internal/middleware/authz.go:14`, self-documents the parity), Python `_ADMIN = 0x04` (`services/xstockstrat-agent/app/scopes.py:37`), Node `ADMIN_SCOPE` (`xstockstrat-config/src/grpc/authz.ts:22`). The agent tool pre-checks the same bit (`services/xstockstrat-agent/app/tools.py:1711`) before calling trading's `ResumeAccount`, which re-checks it at `internal/service/trading.go:3027`. Renumbering the admin bit in any one service silently makes an operator RPC callable by traders, or desyncs the agent pre-check from the server. (Validate against xstockstrat-identity's scope assignment as the owning producer.)
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
