# xstockstrat-trading — Constitution Findings

Defects and drift surfaced by `/context-constitution` on 2026-07-24. For triage/fixing, not
governance. Repo-wide/repeated defects (Go 1.22 doc-lie, `getEnvBool` dead) live in the root
findings log; this file holds trading-specific defects.

## Documentation that lies (docs claim behavior the code lacks)

| What the docs say | What the code does | Evidence | Suggested action |
|---|---|---|---|
| `trading.risk.daily_loss_limit` — "Halt trading if day loss exceeds 2%" | No code reads it; no daily-loss halt exists | `CLAUDE.md:58` (zero call sites) | Implement or delete |
| `trading.maintenance_mode` — "reject all new orders" | Code reads only `platform.maintenance_mode` | `CLAUDE.md:59` vs `trading.go:244` | Resolved — CLAUDE.md:63 and trading.go:244 agree as of 2026-08-04 (feature 100); row kept for history, not an open action |
| `platform.ledger_endpoint` documented as a config key | Ledger address comes from `LEDGER_ENDPOINT` env | `CLAUDE.md:60` vs `config.go:36` | Remove the config key from docs |
| `order.approved` listed in the emitted-events table | No emit site and no Approve RPC exists; approval dead-ends at `PENDING_APPROVAL` + alert | `CLAUDE.md:99` vs `trading.go:320-328` | Remove the row or implement approval |

**Reframed (2026-08-09 refresh):**
- ~~`trading.order.max_retries` / `retry_delay_ms` documented as retry config; CLAUDE.md implies a general `SubmitOrder` retry loop~~ — **partially resolved, not a clean fix**: feature 030's `flattenAndHalt` (emergency bracket-protection flatten only) now reads both keys in a real retry loop (`internal/service/trading.go:2155-2156,2159`). Ordinary `PlaceOrder`→`submitOrder` (`:460`) still calls the broker exactly once, so CLAUDE.md's Config Keys table ("Max broker submission retries", "Delay between retries") still overstates scope — reword to "used by the emergency-flatten retry loop only," not deleted.

## Latent bugs (looks broken, not merely non-obvious)

| Issue | Impact | Evidence |
|---|---|---|
| **IBKR client hardcodes a 10s HTTP timeout, ignoring `trading.broker.timeout_ms`** (which Alpaca honors and CLAUDE.md documents as *the* broker timeout). *(Maintainer-confirmed: oversight, not intentional — an in-code comment now points back at this findings doc.)* | Fill-poller `SubmitOrder`/`GetOrder` on IBKR fall back to 10s regardless of the configured broker timeout | `internal/broker/ibkr.go:45` vs `alpaca.go:44-51` wired at `trading.go:1280` |
| `requires_approval` column is always written `false` even for approval-required orders; `approved_by`/`approved_at` never written | The approval audit trail is write-dead | `internal/repository/trading_repo.go:71`; migration 001 columns |
| **Config accessor mismatch: `trading.broker.timeout_ms` is read via `GetFloat` at one call site and `GetInt` at another, on the same key.** `Watcher.GetInt`/`GetFloat` each decode only their own `oneof` branch of `config.v1.ConfigValue`; if the key is ever set via a path that lands as the other branch, the mismatched accessor silently returns `0` (found-but-wrong-branch), not the coded fallback. Currently latent — the key has no seed migration (grep of `services/xstockstrat-config/migrations/*.sql` finds none), so both sites only ever hit the `def` fallback today. | A future `SetConfig` on this key could silently zero out the broker HTTP timeout for one of the two call sites | `internal/service/trading.go:1818` (`GetFloat`) vs `:2360` (`GetInt`) |
| **Same class of risk: `trading.order.max_retries`/`trading.order.retry_delay_ms` are documented as `int` (CLAUDE.md Config Keys table) but read via `GetFloat`** at the `flattenAndHalt` retry loop. Also currently latent (unseeded). | A `SetConfig` write landing as `int_val` would silently read as the fallback via `GetFloat` | `internal/service/trading.go:2155-2156` |

## Dead / orphaned code

_None currently open._ ~~`AlpacaAsset` struct "kept for backward compatibility"~~ — **resolved 2026-08-09 refresh**: grepped the full `internal/broker/alpaca.go` (543 lines) and the rest of `services/xstockstrat-trading` for `AlpacaAsset` — zero matches. The struct does not exist in this service (the original row was carried over speculatively from the marketdata scan and never independently verified here); dropped.

## Open questions (unresolved *why* — needs a maintainer)

- IBKR `signRequest` builds the OAuth 1.0a signature base over the bare `endpoint` **without** the query params that `resolveConid`/`GetOrder` append after signing — is IBKR auth actually working for these GETs, or a latent signature bug masked by the paper endpoint? Confirmed still reproducing: `internal/broker/ibkr.go:94-98` (`resolveConid`) and `:328-331` (`GetOrder`) both append `q.Encode()` to `RawQuery` **after** `c.signRequest(method, endpoint)` on the bare endpoint string — status: **open**
- PlaceOrder-family RPCs trust `req.UserId` from the message body while broker-account RPCs enforce `x-user-id` from headers (TRADING-N1) — is the body-supplied user id an intentional trust boundary or should mutations use the propagated identity? — status: **open**

---
_Surfaced by [context-forge](https://github.com/davcs86/agent-plugins). Defects to action, not rules. Re-run `/context-constitution` to refresh._
