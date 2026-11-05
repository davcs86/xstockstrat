# Defect: config keys drift from their readers, are missing from the DB, and some values never update live

**Recorded**: 2026-11-04
**Severity**: SEV-2
**Impact type**: config-silently-ignored
**Environment**: staging (main-dev) observed live; production inferred from the same migrations
**Affected service(s)**: xstockstrat-config, xstockstrat-trading, xstockstrat-portfolio, xstockstrat-marketdata, xstockstrat-indicators, xstockstrat-ingest, xstockstrat-analysis, xstockstrat-ledger, xstockstrat-identity, xstockstrat-notify, xstockstrat-agent, xstockstrat-ui
**Config-only fix possible**: no

## Observed

Three classes of drift, all failing silently (the reader returns its code default, no error):

1. **Inconsistent key naming in the stored `key` column.** Some rows embed the namespace
   (`namespace=marketdata, key=marketdata.backfill.batch_size`), others do not
   (`namespace=marketdata, key=alpaca.api_key`). Feature 189's heal (migration `029`) covered only
   `platform`/`trading`/`portfolio`/`marketdata`, so the bare seeds in `analysis`, `ingest` and
   `ledger` are now read by **no** code, because the readers use full-dotted getters:
   - staging `analysis`: `fundsignal.enabled=true`, `fundsignal.run_interval_hours=3`,
     `fundsignal.min_conviction_to_emit=0.2`, `fundsignal.scoring_formula_id=<uuid>` are set, but
     `fundsignal_loop.py` reads `analysis.fundsignal.*`, so the producer runs on code defaults (OFF).
   - staging `ingest`: every row (`backfill.*`, `mcp_client.*`) is dead; ingest reads `ingest.*`.
   - duplicate twins: `backtest.max_duration_seconds=300` (dead) next to
     `analysis.backtest.max_duration_seconds=60` (read); `fundamentals.history.enabled` next to
     `marketdata.fundamentals.history.enabled`; `scoring.signal_decay_half_life_hours` (dead).
   - the agent (`signal.alert_threshold`, `oauth.*`, `extract.*`, `opportunities.*`), the UI
     (`performance.*`) and every secret (`alpaca.api_key`, `mcp_credential.<uuid>`) use
     namespace-relative keys, while everything else is full-dotted.
2. **Values that are not live.** The config is either never subscribed to or read once at startup:
   - `xstockstrat-agent` has no `WatchConfig` subscription. Every read is a one-shot `GetConfig`
     on a fresh mTLS channel (`services/xstockstrat-agent/app/client.py:1788`).
   - `xstockstrat-ui` `GetConfig` calls omit `environment`, so production renders **staging**
     values, including the `platform.trading_state` banner
     (`services/xstockstrat-ui/src/app/trader/positions/page.tsx:126`,
     `src/lib/performanceMetrics.ts:193`).
   - Read once at startup:
     - marketdata: the Alpaca/EDGAR/FMP/Finnhub client knobs and `fundamentals.provider`
       (`services/xstockstrat-marketdata/cmd/server/main.go:99-260`).
     - analysis: its semaphores and executor (`app/handlers/servicer.py:548-595`) and
       `marketdata.fundamentals.provider` (`app/engine/fundsignal_loop.py:105`).
     - ingest: `ingest.backfill.max_concurrent_jobs` (`app/handlers/servicer.py:323`).
     - indicators: `indicators.sandbox.max_concurrent` (`app/handlers/servicer.py:107`).
     - trading: the broker HTTP timeout (`internal/service/trading.go:3201`).
   - The watcher can freeze without error:
     - The Python watchers have no gRPC keepalive. They retry on a fixed 2s delay, and after a clean
       EOF they reconnect with no delay at all (`services/xstockstrat-indicators/app/config/watcher.py:70-91`,
       identical in ingest/analysis).
     - The Go watchers have no keepalive, and their backoff never resets (`internal/config/config.go` ×3).
     - A half-open stream therefore blocks `async for` forever on the last snapshot, which looks
       exactly like "read once at startup" (reported by the operator for indicators).
3. **Keys read in code that do not exist in the DB.** About 60 getters have no seed row, so they
   are invisible in config-ui and cannot be tuned without `create_key`. Examples:
   `trading.reconciliation.*`, `trading.broker.*`, `trading.order.*`, `identity.jwt.*`,
   `portfolio.risk.*`, `portfolio.exposure.factor_map`, `marketdata.alpaca.feed`,
   `analysis.scoring.*`, `ingest.signals.dedup_window_hours`, `indicators.sandbox.max_concurrent`.
   The reverse also exists: rows that no code reads (`stream.notify_enabled`,
   `marketdata.alpaca.paper` stored as `string`, `trading.risk.daily_loss_limit`).

Adjacent defects found by the same audit:
- trading's Go getters do not check the stored type (`services/xstockstrat-trading/internal/config/config.go:205-243`),
  so a type-mismatched row returns `0`/`""` instead of the default.
  - `trading.broker.timeout_ms` is read both as int and as float (`trading.go:3201`, `:2495`).

## Expected

- One canonical convention for the stored `key`, enforced by the database.
- Every key a service reads has exactly one seed row, with a matching `value_type`, in both
  environments.
- Every config value takes effect live, without a restart.
- A stalled or closed stream is detected and recovered.
- A CI gate fails when a reader's key and the seed set drift apart.

## Reproduction

1. In staging config-ui, set `analysis` → `fundsignal.enabled=true`.
2. Observe that the fundamentals producer never runs. `FundSignalLoop._tick` reads
   `analysis.fundsignal.enabled` (default `False`).
3. In production, open `/trader/positions` with production `platform.trading_state=HALTED` and
   staging `ACTIVE`. No halt banner is shown.

## Evidence

`services/xstockstrat-analysis/app/engine/fundsignal_loop.py:144`
> `analysis.fundsignal.enabled` read via get_bool, default False

`services/xstockstrat-config/docs/context-constitution.md` CONFIG-9
> "there is NO fixed convention on whether that string embeds the namespace"

`docs/sdd/constitution.md` C-05 / `docs/patterns/config-governance.md` rule 2
> `<service-short-name>.<category>.<key>`, a format-only rule that the SDD review gate regex-checks
> in spec prose. Nothing checks seed↔getter parity, `value_type`, or live-vs-restart semantics.

## Root cause hypothesis

The process has no single key convention (C-05 and CONFIG-9 contradict each other). No gate ties a
reader's getter literal to a seed row. Readers are free to cache config into startup-time
structures, and watchers have no liveness detection.

## Confidence

high
