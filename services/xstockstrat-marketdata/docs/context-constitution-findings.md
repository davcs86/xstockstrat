# xstockstrat-marketdata — Constitution Findings

Defects and drift surfaced by `/context-constitution` on 2026-07-24; refreshed 2026-09-02 (branch
`claude/loaded-plugins-list-d120nl` @ `82a0549`); re-verified 2026-10-14 (branch `ccr-fe84109f-0lwin8` @ `09ec8d9`); refreshed 2026-10-19 (branch `ccr-c386317f-6vt6t6` @ `a914f69` — added `toGRPCError` code-collapse and ETF-filler wiring-order latent rows; line hints re-stamped, all open rows re-verified). For triage/fixing, not
governance. Repo-wide defects (Go 1.22 doc-lie) live in the root findings log.

## Documentation that lies (docs claim behavior the code lacks)

| What the docs say | What the code does | Evidence | Suggested action |
|---|---|---|---|
| Migration 001 column comment `timeframe TEXT -- '1m','5m','1h','1d'` | Lists removed 1m/5m and omits the canonical 15m | `migrations/001_marketdata_hypertables.up.sql` (~L11) vs `internal/timeframe` | Fix the comment |
| `handler.go` doc comment: "implements both Connect-RPC (HTTP) and gRPC" | Service is gRPC-only (HTTP/8053 removed) | `internal/handler/marketdata_handler.go#MarketDataHandler (~L19-20)` | Fix the stale comment |
| Alpaca placeholder WARN tells the operator to "set the real ALPACA_API_KEY/ALPACA_API_SECRET **secrets**" | Those env vars were removed (feature 147); remediation is now to set the `marketdata.alpaca.api_key`/`api_secret` **config** secrets | `cmd/server/main.go#looksLikePlaceholderCred` WARN (~L106-108) | Update the WARN text |
| `NewWatcher` comment: applicationEnv/tradingMode "scope every WatchConfig request" | `trading_mode` is no longer sent (feature 147) | `internal/config/config.go#NewWatcher (~L67-68)` vs `#stream` (~L217) | Fix the comment |
| `CLAUDE.md` says `TRADING_MODE` is no longer used for config scope | True for config scope, but `cmd/server/main.go` still derives `alpaca.ClientConfig.Paper` from `cfg.TradingMode == "paper"` (env `TRADING_MODE`, default `paper`), and `marketdata.alpaca.paper` is documented as a config key with no read found | `services/xstockstrat-marketdata/cmd/server/main.go`, `internal/config/config.go` | Decide which source of truth governs the Alpaca paper flag; part of the repo-wide `TRADING_MODE` finding in the root log |

## Latent bugs (looks broken, not merely non-obvious)

| Issue | Impact | Evidence |
|---|---|---|
| **`toGRPCError` maps only six connect codes** (InvalidArgument/NotFound/PermissionDenied/FailedPrecondition/ResourceExhausted/Unavailable); every other code — `DeadlineExceeded`, `Canceled`, `AlreadyExists`, `Unimplemented` — collapses to `Internal` (found 2026-10-19) | A service-raised coded error outside the six reaches gRPC callers as an opaque `Internal`; a caller cannot tell a deadline/cancel from a server fault | `internal/handler/marketdata_handler.go#toGRPCError (~L496-515)` |
| **ETF-flag filler depends on unguarded wiring order** (low): `StartEtfFlagFiller` returns permanently if `SetEtfFlagSource` has not run (nil queue), and `etfFillAllowed` needs `fmpBudget`, set only by `SetClassification` — correct today (`cmd/server/main.go` ~L152-162 calls both before `go svc.StartEtfFlagFiller`), but nothing enforces it (found 2026-10-19) | A reorder silently disables the background fill: `GetEtfFlags` misses stay `is_etf` unset forever, with no error or log | `internal/service/etf_flags.go#StartEtfFlagFiller (~L98-104)`, `#etfFillAllowed (~L140-146)`, `#SetEtfFlagSource (~L44)`; `internal/service/classification_service.go#SetClassification (~L52-56)` |

## Dead / orphaned code

| What | Why it looks dead | Evidence |
|---|---|---|
| `marketdata.retention.ohlcv_years` config key | read by no code — `CLAUDE.md` labels it "Documented, not yet implemented"; still dead. (`retention.quotes_days` was **RESOLVED** by feature 229 — read by `resolveQuoteRetentionDays` / `StartQuoteRetention`.) | `CLAUDE.md` config table (grep zero in code) |
| `AlpacaAsset` struct "kept for backward compatibility" | zero references in-repo | `internal/alpaca/client.go#AlpacaAsset (~L560-568)` |
| `Watcher.tradingMode` field + `resolveTradingMode` function | write-only — `tradingMode` assigned (`config.go#NewWatcher` ~L84) but never read; `resolveTradingMode` exists only to feed it (still unit-tested at `config_test.go#TestResolveTradingMode` ~L275); `stream()` no longer sends `trading_mode` (feature 147) | `internal/config/config.go` (field ~L59, `#resolveTradingMode` ~L100) — action: remove, or document as test-only vestige |

## Open questions (unresolved *why* — needs a maintainer)

- `fmp.getJSON` deliberately omits the URL from every error because it carries the `apikey` query param — confirm this "never log the URL" rule is a hard security invariant to enshrine (it also strips path/status detail from FMP errors). `internal/fmp/fmp_client.go#getJSON` (~L254) — status: **open**
- Is `fmp.getJSON`'s "never include the URL in errors" a hard security invariant to enshrine? (carried above) — and `newFundamentalsSource` falls back to FMP on an unrecognized provider (comment: deliberate, feature 211 F-07) — confirm fail-open is intended — status: **open**
- gRPC keepalive magic values (`MaxConnectionIdle 60s / Time 30s / Timeout 10s`) — platform-standard (belongs in root governance) or marketdata-tuned? `cmd/server/main.go#KeepaliveParams` (~L181-185) — status: **open**

## Resolved

- **CLAUDE.md claimed a continuous aggregate `marketdata.ohlcv_1h` and compression policies the migrations never create** — RESOLVED 2026-08-27 (re-check): `CLAUDE.md` now states both as **planned, not yet applied/implemented** (`marketdata.ohlcv_1h` "no migration creates it today" at the Database §; ohlcv/quotes "compression policy planned, not yet applied by any migration"). The doc no longer lies. (The sibling rows — migration-001 timeframe comment and the `handler.go` dual-RPC comment — were re-checked and **remain valid**.)
- **`config.Watcher.environment`/`.tradingMode` fields declared and sent on every `WatchConfigRequest` but never assigned (always the zero enum)** — RESOLVED 2026-08-09 (fixed by commit `1413399`, 2026-08-07): `NewWatcher` now takes `applicationEnv, tradingMode string` params and calls `resolveEnvironment()`/`resolveTradingMode()` (`internal/config/config.go:88,103`, now enshrined as constitution MARKETDATA-7); `cmd/server/main.go` wires them from `cfg.ApplicationEnv`/`cfg.TradingMode`. Confirmed by reading current `config.go` and its `TestResolveEnvironment`/`TestResolveTradingMode` unit tests. This was a repo-wide SEV-1 (root PLAT-8/Gotchas), not marketdata-specific. (Feature 147 later removed the `trading_mode` request field entirely.)
- **RESOLVED 2026-10-14 — `newFundamentalsSource` comment naming `FMP_API_KEY`/`FINNHUB_API_KEY` env vars**: the comment now reads "selected by marketdata.fundamentals.provider (boot-only)…" and names no env vars (`cmd/server/main.go#newFundamentalsSource`).

---
_Surfaced by [context-forge](https://github.com/davcs86/agent-plugins). Defects to action, not rules. Re-run `/context-constitution` to refresh._
