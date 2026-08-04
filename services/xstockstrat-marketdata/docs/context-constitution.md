# xstockstrat-marketdata — Constitution

Derived by `/context-constitution` (context-forge) on 2026-07-24. Captures the **non-obvious** local
invariants of the marketdata service (Alpaca feed + FMP fundamentals, OHLCV storage, gRPC 50053).
Does not restate documented/CI-enforced rules (see `## Pointers`).

> Inherits all rules of the root constitution (`../../../docs/context-constitution.md`). This file lists only
> what is specific to **xstockstrat-marketdata**.

## Rules (`MARKETDATA-*`) — binding, easy-to-miss conventions

| ID | Rule | Why | Evidence | Example (canonical `path:line`) |
|---|---|---|---|---|
| **MARKETDATA-1** | **`Bar.Timeframe` is stored/queried as the canonical DB string (`15m`/`1h`/`1d`), never the Alpaca spelling.** The Alpaca wire spelling (`15Min`/`1Hour`/`1Day`) is used only on the outbound request, then the canonical string is written back onto the Bar. Since feature 080, `Bar.TimeframeEnum` is set alongside the string at every producer site via `internal/timeframe.FromString`. | Reads filter `WHERE timeframe=$2` on the canonical string; a writer that stores the Alpaca spelling makes bars invisible to reads — the "1Day vs 1d" bug `internal/timeframe` was created to fix. | canonical `internal/timeframe/timeframe.go:78`; wire map `internal/alpaca/client.go:112`; shared builder `internal/alpaca/client.go:143-154` (write-back `:151`); read `internal/repository/marketdata_repo.go:89,149` | `internal/timeframe/timeframe.go:78` |
| **MARKETDATA-2** | **Streamed bars carry `1m` and must NOT be persisted** — the stream path deliberately does not `InsertBars`; 15m/1h/1d storage is owned by `StartBarIngestPoller`. Since feature 080, streamed bars also carry the explicit `TimeframeEnum: TIMEFRAME_1MIN` label — this is a label only, not a storability signal; the persistence rule is unchanged. | "Fixing" the stream path to persist pollutes the 15m ohlcv table with 1m bars. | producer `internal/alpaca/stream.go:29,260` (enum label `:268`); consumer `internal/service/marketdata_service.go:744-773` | `internal/service/marketdata_service.go:744-773` |
| **MARKETDATA-3** | **Cache-miss idiom is live-fallback → persist → re-read, and failures log + return empty, never error.** | Returning an error on DB miss breaks charts for never-backfilled symbols; returning live data without caching defeats the warm-poller design. | `marketdata_service.go:163,178,355` | `internal/service/marketdata_service.go:163-178` |
| **MARKETDATA-4** | **All Alpaca REST calls go through `do()` — the only place auth headers (`APCA-API-KEY-ID`/`SECRET`) and the rate limiter are applied.** Never build an `http.Request` and call `httpClient.Do` directly. | Bypassing `do()` drops auth + throttle; the `x/time/rate` limiter is nil when `RateLimitRPS<=0` (burst == rps). | `internal/alpaca/client.go:86-95,73` | `internal/alpaca/client.go:86-95` |
| **MARKETDATA-5** | **Pollers re-read their interval from config every tick and treat `<=0` as "pause, keep last".** | Reading the interval once at startup means config changes never take effect live; `<=0` is the documented pause sentinel. | `marketdata_service.go:402,483` | `internal/service/marketdata_service.go:402` |
| **MARKETDATA-6** | **`DeleteBars` always constrains on the symbol predicate (`$1`) — never an unbounded delete — and is gated on `scope & 0x04`.** `buildDeleteBarsQuery` is extracted as a pure function precisely to unit-test this. | An empty symbol or a changed bitmask turns a targeted delete into a table wipe (DBA gate, FR-5). | `internal/repository/marketdata_repo.go:168`; gate `marketdata_service.go:293` | `internal/repository/marketdata_repo.go:168` |

## Norms (`MARKETDATA-*`) — defaults & asymmetry guidance

| ID | Norm | Why | Evidence | Example (canonical `path:line`) |
|---|---|---|---|---|
| **MARKETDATA-N1** | **Subscriber fan-out uses non-blocking `select{ case ch<-x: default: }` (drop on slow consumer), never a blocking send.** | A blocking send stalls the single shared WS read loop for *all* subscribers. | `internal/alpaca/stream.go:294,308`; `marketdata_service.go:767,797` | `internal/alpaca/stream.go:294` |

## Gotchas & scars

- **Belt-and-suspenders param defaulting**: Alpaca params (`Adjustment="all"`, `feed="iex"`) are re-defaulted in `adjustmentParam()`/`feedParam()`/`connectAndRead` in addition to `NewClient`, so a Client built without `NewClient` still behaves. Adding a new configured param only in `NewClient` leaves a path that 403s on the free plan. Evidence: `internal/alpaca/client.go:69,98,145`, `stream.go:191`.
- **Pollers/stream run on the long-lived `main` ctx, so their ledger/notify emits carry no propagation headers** (intentional — background work has no inbound request). An agent copying `emitEvent` from a poller into a request-path method drops the headers. Evidence: `cmd/server/main.go:129,133`.

## Candidate rules (unverified)

| Candidate | Why suspected | What would confirm it |
|---|---|---|
| `streamReadLimit = 4<<20` lifts `coder/websocket`'s 32 KiB default frame cap — a deliberate deviation worth a rule | `internal/alpaca/stream.go:23` | confirm the lib's `SetReadLimit` default (Context7) before enshrining (CF-N7) |
| `*float64`-nullable scan + `deref` helper is the repo-wide NULL-numeric pattern | `marketdata_repo.go:259,272` single site | a 2nd/3rd repo to induce |

## Pointers (already documented or CI-enforced — not restated here)

| What | Where |
|---|---|
| pgxpool cap=2 / `DB_POOL_MAX`; PgBouncer exec-mode (root PLAT-7) | `internal/repository/pool.go:16,24` (`QueryExecModeExec:37`); root pool budget |
| Header propagation interceptor | `internal/middleware/propagation.go` (root PLAT-4) |
| Config Watcher 90s snapshot gate + reconnect | `internal/config/config.go:82-91,149-160` |
| FMP gated live per-RPC by `marketdata.fmp.enabled` (re-read on every call, no restart needed since feature 082), held off the OHLCV `Registry` (FR-2) | `internal/service/marketdata_service.go:966`, `internal/source/source.go:57` |

---
_Forged by [context-forge](https://github.com/davcs86/agent-plugins). It captures the
non-obvious — nothing here is invented; re-run `/context-constitution` to refresh after the code changes._
