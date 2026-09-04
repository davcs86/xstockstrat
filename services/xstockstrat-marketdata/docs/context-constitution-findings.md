# xstockstrat-marketdata — Constitution Findings

Defects and drift surfaced by `/context-constitution` on 2026-07-24; refreshed 2026-09-02 (branch
`claude/loaded-plugins-list-d120nl` @ `82a0549`). For triage/fixing, not
governance. Repo-wide defects (Go 1.22 doc-lie, `getEnvBool` dead) live in the root findings log.

## Documentation that lies (docs claim behavior the code lacks)

| What the docs say | What the code does | Evidence | Suggested action |
|---|---|---|---|
| Migration 001 column comment `timeframe TEXT -- '1m','5m','1h','1d'` | Lists removed 1m/5m and omits the canonical 15m | `migrations/001_marketdata_hypertables.up.sql:11` vs `internal/timeframe` | Fix the comment |
| `handler.go` doc comment: "implements both Connect-RPC (HTTP) and gRPC" | Service is gRPC-only (HTTP/8053 removed) | `internal/handler/marketdata_handler.go:19-21` | Fix the stale comment |
| `newFundamentalsSource` comment: fmpAPIKey/finnhubAPIKey are the "FMP_API_KEY/FINNHUB_API_KEY secret env vars, never config values" | False since feature 147 — they are resolved via `GetSecret` from encrypted config | `cmd/server/main.go:183-183` vs `:81-82` | Fix the comment to reference `ResolveSecret` |
| Alpaca placeholder WARN tells the operator to "set the real ALPACA_API_KEY/ALPACA_API_SECRET **secrets**" | Those env vars were removed (feature 147); remediation is now to set the `marketdata.alpaca.api_key`/`api_secret` **config** secrets | `cmd/server/main.go:104-108` | Update the WARN text |
| `NewWatcher` comment: applicationEnv/tradingMode "passed on every WatchConfig request" | `trading_mode` is no longer sent (feature 147) | `internal/config/config.go:67-67` vs `:224` | Fix the comment |

## Dead / orphaned code

| What | Why it looks dead | Evidence |
|---|---|---|
| `marketdata.retention.quotes_days` / `retention.ohlcv_years` config keys | read by no code | `CLAUDE.md:81-82` (grep zero) |
| `AlpacaAsset` struct "kept for backward compatibility" | zero references in-repo | `internal/alpaca/client.go:449-457` |
| `Watcher.tradingMode` field + `resolveTradingMode` function | write-only — `tradingMode` assigned (`config.go:85`) but never read; `resolveTradingMode` exists only to feed it (still unit-tested at `config_test.go:299`); `stream()` no longer sends `trading_mode` (feature 147) | `internal/config/config.go:59,103` — action: remove, or document as test-only vestige |

## Open questions (unresolved *why* — needs a maintainer)

- `fmp.getJSON` deliberately omits the URL from every error because it carries the `apikey` query param — confirm this "never log the URL" rule is a hard security invariant to enshrine (it also strips path/status detail from FMP errors). `internal/fmp/fmp_client.go:138` — status: **open**
- gRPC keepalive magic values (`MaxConnectionIdle 60s / Time 30s / Timeout 10s`) — platform-standard (belongs in root governance) or marketdata-tuned? `cmd/server/main.go:146-150` — status: **open**

## Resolved

- **CLAUDE.md claimed a continuous aggregate `marketdata.ohlcv_1h` and compression policies the migrations never create** — RESOLVED 2026-08-27 (re-check): `CLAUDE.md` now states both as **planned, not yet applied/implemented** (`marketdata.ohlcv_1h` "no migration creates it today" at the Database §; ohlcv/quotes "compression policy planned, not yet applied by any migration"). The doc no longer lies. (The sibling rows — migration-001 timeframe comment and the `handler.go` dual-RPC comment — were re-checked and **remain valid**.)
- **`config.Watcher.environment`/`.tradingMode` fields declared and sent on every `WatchConfigRequest` but never assigned (always the zero enum)** — RESOLVED 2026-08-09 (fixed by commit `1413399`, 2026-08-07): `NewWatcher` now takes `applicationEnv, tradingMode string` params and calls `resolveEnvironment()`/`resolveTradingMode()` (`internal/config/config.go:88,103`, now enshrined as constitution MARKETDATA-7); `cmd/server/main.go` wires them from `cfg.ApplicationEnv`/`cfg.TradingMode`. Confirmed by reading current `config.go` and its `TestResolveEnvironment`/`TestResolveTradingMode` unit tests. This was a repo-wide SEV-1 (root PLAT-8/Gotchas), not marketdata-specific. (Feature 147 later removed the `trading_mode` request field entirely.)

---
_Surfaced by [context-forge](https://github.com/davcs86/agent-plugins). Defects to action, not rules. Re-run `/context-constitution` to refresh._
