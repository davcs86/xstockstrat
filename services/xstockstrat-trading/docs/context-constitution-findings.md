# xstockstrat-trading — Constitution Findings

Defects and drift surfaced by `/context-constitution` on 2026-07-24; refreshed 2026-09-02 (branch
`claude/loaded-plugins-list-d120nl` @ `82a0549`); re-verified 2026-10-14 (branch `ccr-fe84109f-0lwin8` @ `09ec8d9`); refreshed 2026-10-19 (branch `ccr-c386317f-6vt6t6` @ `a914f69` — resolved 3 doc-lie rows (`daily_loss_limit`, `order.approved`, `platform.ledger_endpoint`); added the `daily_loss_limit` dead-key row; IBKR signing question reworded; line hints re-stamped). For triage/fixing, not
governance. Repo-wide/repeated defects (Go 1.22 doc-lie) live in the root
findings log; this file holds trading-specific defects.

## Documentation that lies (docs claim behavior the code lacks)

| What the docs say | What the code does | Evidence | Suggested action |
|---|---|---|---|
| CLAUDE.md "Ledger Events Emitted" table omits `account.halt.resumed` | It IS emitted (feature 169) | `internal/service/trading.go#ResumeAccountSvc` (~L2973) | Add the `account.halt.resumed` row |
| CLAUDE.md "Ledger Events Emitted" table omits `order_intent.reclaimed_unknown` | It IS emitted (feature 101 sweeper) | `internal/service/order_intent.go#reclaimedUnknownEventType` | Resolved — feature 267 added the row (sweep + reactive triggers, payload); row kept for history, not an open action |
| `trading.order.max_retries` / `retry_delay_ms` documented as if `PlaceOrder`'s broker submission retries | **Updated 2026-08-07**: the keys *are* read (`internal/service/trading.go#flattenAndHalt` ~L2748-2749, via `GetFloat`, not `GetInt` — the original "zero `GetInt` sites" claim was checking the wrong getter) but only inside `flattenAndHalt`'s retry loop (feature 030's protection-window flatten-and-halt), not `submitOrder`/`PlaceOrder`. `SubmitOrder` itself is still called exactly once with no retry loop. | `internal/service/trading.go#flattenAndHalt` (~L2748-2749) vs `trading.go#submitOrder` (~L550, no retry) | Not dead — but CLAUDE.md's "a retried submission" framing overstates scope; reword to scope the keys to the flatten-and-halt retry path, or extend them to `PlaceOrder` if that was the original intent |
| `trading.maintenance_mode` — "reject all new orders" | Code reads only `platform.maintenance_mode` | `CLAUDE.md#Config Keys Consumed` (~L102) vs `trading.go#PlaceOrder` `platform.maintenance_mode` (~L401) | Resolved — CLAUDE.md (~L102) and trading.go (~L401) agree as of 2026-08-04 (feature 100); row kept for history, not an open action |
| `CLAUDE.md` § Broker State Reconciliation: "nothing in this service ever clears a halt (resuming is a manual DB edit)"; the RPC prose has no `ResumeAccount` entry | `ResumeAccountSvc` / the `ResumeAccount` RPC (admin-gated, DB-first then in-memory) clears a halt | `internal/service/trading.go#ResumeAccountSvc`, `internal/handler/trading.go` | Document `ResumeAccount` and drop the "manual DB edit" claim |
| `CLAUDE.md` § Idempotency ties the broker de-dup of a retried submission to `trading.order.max_retries` | `submitOrder` has no retry loop; only `flattenAndHalt` reads those keys | `internal/service/trading.go#submitOrder`, `#flattenAndHalt` | Reword |
| The constitution header / TRADING-N1 and this log cite `trading.go:422,939,2779` etc. | `trading.go` grew ~400 lines; those line cites are far off | `internal/service/trading.go` (anchor by symbol) | Cite by symbol on the next edit |
| CLAUDE.md "Ledger Events Emitted" lists the `order.*` lifecycle events on stream `order:{order_id}` | Lifecycle events emit on the bare `orderID` stream key, while the reclaim/reconciliation events use `order:{order_id}`; per-order queries must read both streams until reconciled (found by feature 267, out of its scope per its design.md Rejected Alternatives) | `internal/service/trading.go#PlaceOrder` (`"order.created"`, `orderID`), `#CancelOrder` (`"order.canceled"`, `req.OrderId`) vs `internal/service/order_intent.go#reclaimStaleIntent` (`"order:"+OrderID`) | Reconcile the stream key (code or doc) in a dedicated feature |

**Reframed (2026-08-09 refresh):**
- ~~`trading.order.max_retries` / `retry_delay_ms` documented as retry config; CLAUDE.md implies a general `SubmitOrder` retry loop~~ — **partially resolved, not a clean fix**: feature 030's `flattenAndHalt` (emergency bracket-protection flatten only) now reads both keys in a real retry loop (`internal/service/trading.go#flattenAndHalt` ~L2748-2749). Ordinary `PlaceOrder`→`submitOrder` (~L550) still calls the broker exactly once, so CLAUDE.md's Config Keys table ("Max broker submission retries", "Delay between retries") still overstates scope — reword to "used by the emergency-flatten retry loop only," not deleted.

## Latent bugs (looks broken, not merely non-obvious)

| Issue | Impact | Evidence |
|---|---|---|
| **`TradingService.StreamOrderUpdates` is dead code with an unmasked snapshot** (found 2026-10-20, feature 240): no handler routes to it (live streaming uses `SubscribeOrderUpdates`); its initial snapshot loop sends the shared `s.orders` pointers without `hideUnconfirmedFill`. Action: delete it, or clone + mask before sending if revived. | If wired, a NEW offline order's `fees`/`filled_at` would leak and the sender could mutate the shared cache | `internal/service/trading.go#StreamOrderUpdates` |
| **IBKR client hardcodes a 10s HTTP timeout, ignoring `trading.broker.timeout_ms`** (which Alpaca honors and CLAUDE.md documents as *the* broker timeout). *(Maintainer-confirmed: oversight, not intentional — an in-code comment now points back at this findings doc.)* | Fill-poller `SubmitOrder`/`GetOrder` on IBKR fall back to 10s regardless of the configured broker timeout | `internal/broker/ibkr.go#IBKRRequestTimeout` (const ~L68, applied ~L83) vs `alpaca.go#NewClient` `TimeoutMs` (~L42-49) wired at `trading.go#instantiateBrokerLocked` (~L3153; `IBKRConfig` has no `TimeoutMs` field, and only the Alpaca branch reads the key, ~L3182) |
| `requires_approval` column is always written `false` even for approval-required orders; `approved_by`/`approved_at` never written | The approval audit trail is write-dead | `internal/repository/trading_repo.go#UpsertOrder` (literal `false` in INSERT values ~L92, col list ~L68); migration 001 columns |
| **Config accessor mismatch: `trading.broker.timeout_ms` is read via `GetFloat` at one call site and `GetInt` at another, on the same key.** `Watcher.GetInt`/`GetFloat` each decode only their own `oneof` branch of `config.v1.ConfigValue`; if the key is ever set via a path that lands as the other branch, the mismatched accessor silently returns `0` (found-but-wrong-branch), not the coded fallback. Currently latent — the key has no seed migration (grep of `services/xstockstrat-config/migrations/*.sql` finds none), so all sites only ever hit the `def` fallback today. **Widened 2026-09-02:** a THIRD reader `staleThreshold` uses `GetInt` (`order_intent.go#staleThreshold` ~L100), joining `instantiateBrokerLocked`'s `GetInt` (`trading.go` ~L3182) against the lone `GetFloat` site. | A future `SetConfig` on this key could silently zero out the broker HTTP timeout for the `GetFloat` call site | `internal/service/trading.go#brokerCallTimeout` (`GetFloat` ~L2476) vs `#instantiateBrokerLocked` (~L3182) + `internal/service/order_intent.go#staleThreshold` (~L100) (`GetInt`) |
| **Same class of risk: `trading.order.max_retries`/`trading.order.retry_delay_ms` are documented as `int` (CLAUDE.md Config Keys table) but read via `GetFloat`** at the `flattenAndHalt` retry loop. Also currently latent (unseeded). | A `SetConfig` write landing as `int_val` would silently read as the fallback via `GetFloat` | `internal/service/trading.go#flattenAndHalt` (~L2748-2749) |
| `tifToWireString` (service) and `tifStr` (repository) are near-identical mappings (differ only for UNSPECIFIED: `tifStr` returns "day") — adding a TIF means editing both plus `allowedTIFs` and `parseTif` | Drift risk | `internal/service/tif_validation.go#tifToWireString` vs `internal/repository/tif.go#tifStr` |
| **`emitLedgerEvent` discards the `structpb.NewStruct` error** (`p, _ :=`; found by feature 267, which fixed only the reclaim payload). Candidate hardening: log the error. | Any payload holding a non-structpb type (e.g. `time.Time`) reaches the ledger as a nil payload, silently | `internal/service/trading.go#emitLedgerEvent` |

## Dead / orphaned code

| What | Why it looks dead | Evidence |
|---|---|---|
| `trading.risk.daily_loss_limit` config key (found 2026-10-19) | Read by no code; no daily-loss halt exists. CLAUDE.md now self-labels it "Documented, not yet implemented" (honest, but still dead) | `CLAUDE.md#Config Keys Consumed` (~L97) vs `services/xstockstrat-trading` (rg `daily_loss_limit` outside docs/CLAUDE.md: zero) — action: implement or delete |

~~`AlpacaAsset` struct "kept for backward compatibility"~~ — **resolved 2026-08-09 refresh**: grepped the full `internal/broker/alpaca.go` (543 lines) and the rest of `services/xstockstrat-trading` for `AlpacaAsset` — zero matches. The struct does not exist in this service (the original row was carried over speculatively from the marketdata scan and never independently verified here); dropped.

## Open questions (unresolved *why* — needs a maintainer)

- ~~PlaceOrder-family RPCs trust `req.UserId` from the message body while broker-account RPCs enforce `x-user-id` from headers (TRADING-N1) — is the body-supplied user id an intentional trust boundary?~~ ✓ **RESOLVED (2026-09-02)** — the service `CLAUDE.md` now declares header identity canonical and the body `user_id` deprecated/ignored for `PlaceOrder`/`CancelOrder`/`ReplaceOrder`/`ConfirmOrder` (resolved via `middleware.FromContext(ctx).UserID`, `internal/service/trading.go:422,939,1332,1486,3135`); `ListOrders`/`StreamOrderUpdates` keep it as a filter. Enshrined as root PLAT-11; TRADING-N1 superseded.
- `ReplaceOrder` validates TIF only when supplied, and the bracket/flatten paths hard-code DAY — is bypassing `validateTIF` there intentional? `tifStr` maps UNSPECIFIED to "day" on write — purely a never-reached belt? — status: **open**
- `NewWatcher`'s `tradingMode` parameter and `resolveTradingMode` are retained though nothing sends them (feature 147) — part of the repo-wide disagreement in the root findings log — status: **open**

## Resolved

- **Resolved 2026-10-29 (feature 249, `fix-ibkr-request-signing`)** — IBKR `signRequest` signed the bare `endpoint` without the query params of `resolveConid`/`GetOrder`, with no Live Session Token and no `realm`. `signRequest` is deleted. Every regular call now goes through `c.do` (`internal/broker/ibkr_session.go#do` ~L362; call sites `ibkr.go` ~L187-575, e.g. `#resolveConid` ~L225, `#GetOrder` ~L423), which signs with `authorize` (`ibkr.go` ~L644): HMAC-SHA256 keyed by the LST, plus `realm="limited_poa"`. `buildBaseString` (`ibkr.go` ~L600) adds the URL's query params to the base string. Signing query params deviates from the ibind reference, per the operator ruling on 2026-10-29 ("Include params (FR-3)"). The remaining risk is unverified IBKR acceptance, which needs a paper smoke (`docs/ibkr.md` § OAuth 1.0a + Live Session Token).

- **Resolved 2026-10-19** — `trading.risk.daily_loss_limit` "Halt trading if day loss exceeds 2%" doc-lie: `CLAUDE.md#Config Keys Consumed` (~L97) now reads "Documented, not yet implemented — no code reads this key". The underlying dead key is tracked under Dead / orphaned code.
- **Resolved 2026-10-19** — `order.approved` listed as emitted: `CLAUDE.md#Ledger Events Emitted` (~L148) now reads "Documented, not yet implemented — no emit site / Approve RPC exists yet". Code unchanged (rg `"order.approved"`/`ApproveOrder` in `services/xstockstrat-trading` outside docs: zero; approval still dead-ends at `PENDING_APPROVAL` + `order.approval_requested`, `trading.go#submitOrder` ~L566,655).
- **Resolved 2026-10-19** — `platform.ledger_endpoint` documented as a config key: rg `ledger_endpoint` in `services/xstockstrat-trading/CLAUDE.md` = 0; the address comes only from `LEDGER_ENDPOINT` env (`internal/config/config.go#LedgerEndpoint` ~L41).


## Filed as defect reports (2026-10-19)

The open rows above were re-verified against `1302e6d` and recorded as `docs/reports/` defects
(status sidecar `open`) for `/sdd-triage --from-report`. A row stays here until its report is resolved.

| Report | Title |
|---|---|
| [`2026-10-19-dead-config-keys-defect`](../../../docs/reports/2026-10-19-dead-config-keys-defect.md) | Documented config keys that no code reads (ledger, notify, trading, marketdata, ingest) |
| [`2026-10-19-trading-claude-md-drift-defect`](../../../docs/reports/2026-10-19-trading-claude-md-drift-defect.md) | trading CLAUDE.md drift (approval runbook, ledger events, halt resume, retry scope) plus a portfolio cross-cite |
| [`2026-10-19-trading-config-accessor-type-mismatch-defect`](../../../docs/reports/2026-10-19-trading-config-accessor-type-mismatch-defect.md) | trading reads int-documented config keys with GetFloat (and the same key with both accessors) |
| [`2026-10-19-trading-ibkr-oauth-signature-omits-query-defect`](../../../docs/reports/2026-10-19-trading-ibkr-oauth-signature-omits-query-defect.md) | IBKR OAuth signature base omits query parameters on GET requests |
| [`2026-10-19-trading-ibkr-timeout-hardcoded-defect`](../../../docs/reports/2026-10-19-trading-ibkr-timeout-hardcoded-defect.md) | IBKR broker client ignores trading.broker.timeout_ms (hardcoded 10s) |
| [`2026-10-19-trading-requires-approval-always-false-defect`](../../../docs/reports/2026-10-19-trading-requires-approval-always-false-defect.md) | trading.orders.requires_approval is always persisted false |

---
_Surfaced by [context-forge](https://github.com/davcs86/agent-plugins). Defects to action, not rules. Re-run `/context-constitution` to refresh._
