# xstockstrat-trading — Constitution Findings

Defects and drift surfaced by `/context-constitution` on 2026-07-24. For triage/fixing, not
governance. Repo-wide/repeated defects (Go 1.22 doc-lie, `getEnvBool` dead) live in the root
findings log; this file holds trading-specific defects.

## Documentation that lies (docs claim behavior the code lacks)

| What the docs say | What the code does | Evidence | Suggested action |
|---|---|---|---|
| `trading.order.max_retries` / `retry_delay_ms` documented as retry config; CLAUDE.md implies a retry loop | `SubmitOrder` is called exactly once — no retry loop; keys read by nobody | `CLAUDE.md:13,55-56` vs `internal/service/trading.go:342` (zero `GetInt` sites) | Implement retry or delete the keys + doc |
| `trading.risk.daily_loss_limit` — "Halt trading if day loss exceeds 2%" | No code reads it; no daily-loss halt exists | `CLAUDE.md:58` (zero call sites) | Implement or delete |
| `trading.maintenance_mode` — "reject all new orders" | Code reads only `platform.maintenance_mode` | `CLAUDE.md:59` vs `trading.go:244` | Fix the doc/key name |
| `platform.ledger_endpoint` documented as a config key | Ledger address comes from `LEDGER_ENDPOINT` env | `CLAUDE.md:60` vs `config.go:36` | Remove the config key from docs |
| `order.approved` listed in the emitted-events table | No emit site and no Approve RPC exists; approval dead-ends at `PENDING_APPROVAL` + alert | `CLAUDE.md:99` vs `trading.go:320-328` | Remove the row or implement approval |

## Latent bugs (looks broken, not merely non-obvious)

| Issue | Impact | Evidence |
|---|---|---|
| **IBKR client hardcodes a 10s HTTP timeout, ignoring `trading.broker.timeout_ms`** (which Alpaca honors and CLAUDE.md documents as *the* broker timeout). *(Maintainer-confirmed: oversight, not intentional.)* | Fill-poller `SubmitOrder`/`GetOrder` on IBKR fall back to 10s regardless of the configured broker timeout | `internal/broker/ibkr.go:55` vs `alpaca.go:44-52` wired at `trading.go:1280` |
| `requires_approval` column is always written `false` even for approval-required orders; `approved_by`/`approved_at` never written | The approval audit trail is write-dead | `internal/repository/trading_repo.go:75`; migration 001 columns |

## Dead / orphaned code

| What | Why it looks dead | Evidence |
|---|---|---|
| `AlpacaAsset` struct "kept for backward compatibility" | zero references in-repo | `internal/broker/alpaca.go` (per marketdata scan; verify in trading too) |

## Open questions (unresolved *why* — needs a maintainer)

- IBKR `signRequest` builds the OAuth 1.0a signature base over the bare `endpoint` **without** the query params that `resolveConid`/`GetOrder` append after signing — is IBKR auth actually working for these GETs, or a latent signature bug masked by the paper endpoint? `internal/broker/ibkr.go:416-464,89-93,261-263` — status: **open**
- PlaceOrder-family RPCs trust `req.UserId` from the message body while broker-account RPCs enforce `x-user-id` from headers (TRADING-N1) — is the body-supplied user id an intentional trust boundary or should mutations use the propagated identity? — status: **open**

---
_Surfaced by [context-forge](https://github.com/davcs86/agent-plugins). Defects to action, not rules. Re-run `/context-constitution` to refresh._
