# xstockstrat-marketdata — Constitution Findings

Defects and drift surfaced by `/context-constitution` on 2026-07-24. For triage/fixing, not
governance. Repo-wide defects (Go 1.22 doc-lie, `getEnvBool` dead) live in the root findings log.

## Documentation that lies (docs claim behavior the code lacks)

| What the docs say | What the code does | Evidence | Suggested action |
|---|---|---|---|
| CLAUDE.md claims a continuous aggregate `marketdata.ohlcv_1h` auto-computed from 15m bars | No migration creates it (only two `create_hypertable` calls); grep for `ohlcv_1h`/`continuous` = nothing | `CLAUDE.md:77` vs `migrations/*.sql` | Implement the CAGG or delete the claim |
| CLAUDE.md claims compression policies ("compress after 7 days" / "after 24h") | No `add_compression_policy`/`add_retention_policy` in any migration | `CLAUDE.md:75-76` | Add policies or correct the doc |
| Migration 001 column comment `timeframe TEXT -- '1m','5m','1h','1d'` | Lists removed 1m/5m and omits the canonical 15m | `migrations/001_marketdata_hypertables.up.sql:11` vs `internal/timeframe` | Fix the comment |
| `handler.go` doc comment: "implements both Connect-RPC (HTTP) and gRPC" | Service is gRPC-only (HTTP/8053 removed) | `internal/handler/marketdata_handler.go:20-22` | Fix the stale comment |

## Dead / orphaned code

| What | Why it looks dead | Evidence |
|---|---|---|
| `marketdata.retention.quotes_days` / `retention.ohlcv_years` config keys | read by no code | `CLAUDE.md:68-69` (grep zero) |
| `AlpacaAsset` struct "kept for backward compatibility" | zero references in-repo | `internal/alpaca/client.go:426` |

## Open questions (unresolved *why* — needs a maintainer)

- `fmp.getJSON` deliberately omits the URL from every error because it carries the `apikey` query param — confirm this "never log the URL" rule is a hard security invariant to enshrine (it also strips path/status detail from FMP errors). `internal/fmp/fmp_client.go:141` — status: **open**
- gRPC keepalive magic values (`MaxConnectionIdle 60s / Time 30s / Timeout 10s`) — platform-standard (belongs in root governance) or marketdata-tuned? `cmd/server/main.go:136-140` — status: **open**

## Resolved

- **`config.Watcher.environment`/`.tradingMode` fields declared and sent on every `WatchConfigRequest` but never assigned (always the zero enum)** — RESOLVED 2026-08-09 (fixed by commit `1413399`, 2026-08-07): `NewWatcher` now takes `applicationEnv, tradingMode string` params and calls `resolveEnvironment()`/`resolveTradingMode()` (`internal/config/config.go:84-85,94-108`, now enshrined as constitution MARKETDATA-7); `cmd/server/main.go` wires them from `cfg.ApplicationEnv`/`cfg.TradingMode`. Confirmed by reading current `config.go` and its `TestResolveEnvironment`/`TestResolveTradingMode` unit tests. This was a repo-wide SEV-1 (root PLAT-8/Gotchas), not marketdata-specific.

---
_Surfaced by [context-forge](https://github.com/davcs86/agent-plugins). Defects to action, not rules. Re-run `/context-constitution` to refresh._
