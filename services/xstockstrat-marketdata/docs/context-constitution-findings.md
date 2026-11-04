# xstockstrat-marketdata — Constitution Findings

Defects and drift surfaced by `/context-constitution` on 2026-07-24; refreshed 2026-09-02 (branch
`claude/loaded-plugins-list-d120nl` @ `82a0549`); re-verified 2026-10-14 (branch `ccr-fe84109f-0lwin8` @ `09ec8d9`); refreshed 2026-10-19 (branch `ccr-c386317f-6vt6t6` @ `a914f69` — added `toGRPCError` code-collapse and ETF-filler wiring-order latent rows; line hints re-stamped, all open rows re-verified); refreshed 2026-11-04 (branch `ccr-d09db3b6-ao7ybn` @ `9892b61` — +1 latent bug (handler `CodeInternal` wrap demotes `InvalidArgument`), +1 (`emitEvent` discards the `NewValue` error), ETF-filler row mitigated, `Paper` row strengthened, +1 doc-lie, +3 open questions; no row resolved). For triage/fixing, not
governance. Repo-wide defects (Go 1.22 doc-lie) live in the root findings log.

## Documentation that lies (docs claim behavior the code lacks)

| What the docs say | What the code does | Evidence | Suggested action |
|---|---|---|---|
| Migration 001 column comment `timeframe TEXT -- '1m','5m','1h','1d'` | Lists removed 1m/5m and omits the canonical 15m | `migrations/001_marketdata_hypertables.up.sql` (~L11) vs `internal/timeframe` | Fix the comment |
| `handler.go` doc comment: "implements both Connect-RPC (HTTP) and gRPC" | Service is gRPC-only (HTTP/8053 removed) | `internal/handler/marketdata_handler.go#MarketDataHandler (~L19-20)` | Fix the stale comment |
| Alpaca placeholder WARN tells the operator to "set the real ALPACA_API_KEY/ALPACA_API_SECRET **secrets**" | Those env vars were removed (feature 147); remediation is now to set the `marketdata.alpaca.api_key`/`api_secret` **config** secrets | `cmd/server/main.go#looksLikePlaceholderCred` WARN (~L106-108) | Update the WARN text |
| `NewWatcher` comment: applicationEnv/tradingMode "scope every WatchConfig request" | `trading_mode` is no longer sent (feature 147) | `internal/config/config.go#NewWatcher (~L67-68)` vs `#stream` (~L217) | Fix the comment |
| `CLAUDE.md` says `TRADING_MODE` is no longer used for config scope | True for config scope, but `cmd/server/main.go` still derives `alpaca.ClientConfig.Paper` from `cfg.TradingMode == "paper"` (env `TRADING_MODE`, default `paper`), and `marketdata.alpaca.paper` is documented as a config key with no read found | `services/xstockstrat-marketdata/cmd/server/main.go`, `internal/config/config.go` | Decide which source of truth governs the Alpaca paper flag (2026-11-04: nothing in `internal/alpaca` reads `ClientConfig.Paper`, so both the env-derived value and the documented key are inert); part of the repo-wide `TRADING_MODE` finding in the root log |
| `CLAUDE.md` § Fundamentals Integration lists the ETF-filler skip reasons `fmp_disabled`/`no_cap`/`budget` and cites `fundamentalsEnabled()` at `marketdata_service.go:1143` (found 2026-11-04) | The filler also logs `not_wired` (nil `fmpBudget`, Info), and `fundamentalsEnabled` is now ~L1811 | `internal/service/etf_flags.go#etfFillGate`; `internal/service/marketdata_service.go#fundamentalsEnabled` | Add `not_wired`; cite by symbol |

## Latent bugs (looks broken, not merely non-obvious)

| Issue | Impact | Evidence |
|---|---|---|
| **`toGRPCError` maps only six connect codes** (InvalidArgument/NotFound/PermissionDenied/FailedPrecondition/ResourceExhausted/Unavailable); every other code — `DeadlineExceeded`, `Canceled`, `AlreadyExists`, `Unimplemented` — collapses to `Internal` (found 2026-10-19) | A service-raised coded error outside the six reaches gRPC callers as an opaque `Internal`; a caller cannot tell a deadline/cancel from a server fault | `internal/handler/marketdata_handler.go#toGRPCError (~L496-515)` |
| **ETF-flag filler depends on unguarded wiring order** (low): `StartEtfFlagFiller` returns permanently if `SetEtfFlagSource` has not run (nil queue), and the budget gate (`etfFillGate`, formerly `etfFillAllowed`) needs `fmpBudget`, set only by `SetClassification` (partly mitigated, 2026-11-04: a nil budget is now logged at Info as skip reason `not_wired` and is not permanent, so only the `SetEtfFlagSource` half is still silent) — correct today (`cmd/server/main.go` ~L152-162 calls both before `go svc.StartEtfFlagFiller`), but nothing enforces it (found 2026-10-19) | A reorder silently disables the background fill: `GetEtfFlags` misses stay `is_etf` unset forever, with no error or log | `internal/service/etf_flags.go#StartEtfFlagFiller (~L98-104)`, `#etfFillGate (~L186)`, `#SetEtfFlagSource (~L44)`; `internal/service/classification_service.go#SetClassification (~L52-56)` |
| **`GetBars`/`BackfillBars` non-`1d` rejection reaches gRPC callers as `Internal`, not `InvalidArgument`** (found 2026-11-04; MARKETDATA-N2 biting feature 143): the service raises `connect.CodeInvalidArgument`, but the handler blanket-wraps every error with `connect.NewError(CodeInternal, err)` and `toGRPCError` (via `errors.As`) matches the OUTER `Internal` first. `BatchGetBars` is unaffected (it uses `forwardConnectErr`). Handler tests cover only the empty-symbol case. | A caller sending a deprecated timeframe cannot tell a client error from a server fault; CLAUDE.md promises `InvalidArgument`. Action: forward connect-coded errors on these two RPCs, and add a handler test. | `internal/handler/marketdata_handler.go#GetBars` (`connect.CodeInternal` ~L90), `#BackfillBars` (~L126), `#toGRPCError` (~L496); service `internal/service/marketdata_service.go` (`CodeInvalidArgument` ~L258, ~L1399) |
| **`emitEvent` discards the `structpb.NewValue` error and has no retry or idempotency key** (found 2026-11-04): a payload value `structpb` cannot encode becomes a nil field silently (the class trading fixed), and a single `AppendEvent` call is made with no retry — unlike portfolio's and trading's emitters. | Silent field loss; a ledger bounce drops the event. | `internal/service/marketdata_service.go#emitEvent` (~L1584, `AppendEvent` ~L1590) |

## Dead / orphaned code

| What | Why it looks dead | Evidence |
|---|---|---|
| `marketdata.retention.ohlcv_years` config key | read by no code — `CLAUDE.md` labels it "Documented, not yet implemented"; still dead. (`retention.quotes_days` was **RESOLVED** by feature 229 — read by `resolveQuoteRetentionDays` / `StartQuoteRetention`.) | `CLAUDE.md` config table (grep zero in code) |
| `AlpacaAsset` struct "kept for backward compatibility" | zero references in-repo | `internal/alpaca/client.go#AlpacaAsset (~L560-568)` |
| `Watcher.tradingMode` field + `resolveTradingMode` function | write-only — `tradingMode` assigned (`config.go#NewWatcher` ~L84) but never read; `resolveTradingMode` exists only to feed it (still unit-tested at `config_test.go#TestResolveTradingMode` ~L275); `stream()` no longer sends `trading_mode` (feature 147) | `internal/config/config.go` (field ~L59, `#resolveTradingMode` ~L100) — action: remove, or document as test-only vestige |

## Open questions (unresolved *why* — needs a maintainer)

- Do IEX daily bars include extended-hours prints? Feature 231 uses the stored `1d` close as the after-hours mark, so an extended-hours-inclusive close would shift it. `internal/service/marketdata_service.go#GetLatestQuotes`, `internal/repository/marketdata_repo.go#GetLatestDailyClosesBatch` — status: **open**
- `fmp.getJSON` deliberately omits the URL from every error because it carries the `apikey` query param — confirm this "never log the URL" rule is a hard security invariant to enshrine (it also strips path/status detail from FMP errors). `internal/fmp/fmp_client.go#getJSON` (~L254) — status: **open**
- Is `fmp.getJSON`'s "never include the URL in errors" a hard security invariant to enshrine? (carried above) — and `newFundamentalsSource` falls back to FMP on an unrecognized provider (comment: deliberate, feature 211 F-07) — confirm fail-open is intended — status: **open**
- gRPC keepalive magic values (`MaxConnectionIdle 60s / Time 30s / Timeout 10s`) — platform-standard (belongs in root governance) or marketdata-tuned? `cmd/server/main.go#KeepaliveParams` (~L181-185) — status: **open**
- The `BatchGetBars` warm path (`QueryBarsBatch`) never applies the feature-140 staleness refetch that `GetBars` does — is a stale-but-present symbol in a batch read intentionally served stale until the next ingest cycle? `internal/service/marketdata_service.go#BatchGetBars` (~L757) — status: **open** (found 2026-11-04)
- The EDGAR client issues its own `http.NewRequestWithContext`/`c.hc.Do` calls, outside any shared budget (Alpaca routes through `do()`, MARKETDATA-4; FMP through `getJSON`, MARKETDATA-12) — deliberate? Its limiter is a separate rps key. `internal/edgar/edgar_client.go` (~L85) — status: **open** (found 2026-11-04)
- Migration numbering skips `007` (000-006, 008, 009 exist) — intentional (burned/renumbered)? The next migration must be `010`. — status: **open** (found 2026-11-04)

## Resolved

- **CLAUDE.md claimed a continuous aggregate `marketdata.ohlcv_1h` and compression policies the migrations never create** — RESOLVED 2026-08-27 (re-check): `CLAUDE.md` now states both as **planned, not yet applied/implemented** (`marketdata.ohlcv_1h` "no migration creates it today" at the Database §; ohlcv/quotes "compression policy planned, not yet applied by any migration"). The doc no longer lies. (The sibling rows — migration-001 timeframe comment and the `handler.go` dual-RPC comment — were re-checked and **remain valid**.)
- **`config.Watcher.environment`/`.tradingMode` fields declared and sent on every `WatchConfigRequest` but never assigned (always the zero enum)** — RESOLVED 2026-08-09 (fixed by commit `1413399`, 2026-08-07): `NewWatcher` now takes `applicationEnv, tradingMode string` params and calls `resolveEnvironment()`/`resolveTradingMode()` (`internal/config/config.go:88,103`, now enshrined as constitution MARKETDATA-7); `cmd/server/main.go` wires them from `cfg.ApplicationEnv`/`cfg.TradingMode`. Confirmed by reading current `config.go` and its `TestResolveEnvironment`/`TestResolveTradingMode` unit tests. This was a repo-wide SEV-1 (root PLAT-8/Gotchas), not marketdata-specific. (Feature 147 later removed the `trading_mode` request field entirely.)
- **RESOLVED 2026-10-14 — `newFundamentalsSource` comment naming `FMP_API_KEY`/`FINNHUB_API_KEY` env vars**: the comment now reads "selected by marketdata.fundamentals.provider (boot-only)…" and names no env vars (`cmd/server/main.go#newFundamentalsSource`).


## Filed as defect reports (2026-10-19)

The open rows above were re-verified against `1302e6d` and recorded as `docs/reports/` defects
(status sidecar `open`) for `/sdd-triage --from-report`. A row stays here until its report is resolved.

| Report | Title |
|---|---|
| [`2026-10-19-dead-config-keys-defect`](../../../docs/reports/2026-10-19-dead-config-keys-defect.md) | Documented config keys that no code reads (ledger, notify, trading, marketdata, ingest) |
| [`2026-10-19-marketdata-claude-md-drift-defect`](../../../docs/reports/2026-10-19-marketdata-claude-md-drift-defect.md) | marketdata doc drift (migration 001 timeframe comment, handler Connect-RPC comment, stale CLAUDE.md line cite) |
| [`2026-10-19-marketdata-togrpcerror-collapses-codes-defect`](../../../docs/reports/2026-10-19-marketdata-togrpcerror-collapses-codes-defect.md) | marketdata toGRPCError maps only six codes; everything else becomes INTERNAL |
| [`2026-10-19-orphaned-code-defect`](../../../docs/reports/2026-10-19-orphaned-code-defect.md) | Orphaned modules, scripts and dependencies across services |

---
_Surfaced by [context-forge](https://github.com/davcs86/agent-plugins). Defects to action, not rules. Re-run `/context-constitution` to refresh._
