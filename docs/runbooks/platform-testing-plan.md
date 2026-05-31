# Platform Testing Plan — Signal Source + Strategies (Week 1)

A concrete, end-to-end plan to start exercising the platform this week: onboard two
newsletter signal sources, ingest signals through the agent, then define and backtest two
strategies (a technical baseline and a signal-weighted variant).

This plan uses **only capabilities that already exist** — the signal-source registry
(feature 008), source weighting (007), the agent MCP server (009), and the Phase-2/3
backtest engine are all `launched`. No new code is required to run it; it is an operating
procedure, not a feature.

---

## Decisions captured

| Decision | Choice | Why it matters |
|---|---|---|
| Signal source(s) | **Both** `unusual_whales` and `pure_power_picks` | Lets the signal-weighted backtest combine two sources via `signal_sources` + `analysis.signals.source_weights` (exercises feature 007). |
| Ingestion path | **Mediated email** (`mediated_simple_email`) | The agent/Claude reads the newsletter email body directly and calls `ingest_signal`. No programmatic extractor to write. |
| Strategies | **Two**: technical baseline + signal-weighted | Strategy A is a pure SMA-crossover control; Strategy B adds the signals so you can measure their lift over the baseline. |

> **What a "strategy" actually is here.** `xstockstrat-analysis` does **not** store pluggable
> strategy code. `RunBacktest` runs a single SMA-crossover engine parameterized by
> `strategy_params`. "Creating a strategy" = choosing a `strategy_id` label + a parameter set
> (`fast_period`, `slow_period`, and optional `signal_sources` / `signal_weight` /
> `technical_weight` / `min_conviction`). Both strategies below are the same engine with
> different params. (Reference: `services/xstockstrat-analysis/app/handlers/servicer.py:49`,
> `services/xstockstrat-analysis/CLAUDE.md` §Backtesting Strategy.)

---

## Prerequisites (Day 0)

1. **Bring the stack up locally.**
   ```bash
   ./scripts/localenv-setup.sh   # build proto-gen container, generate stubs (Docker-only)
   ./scripts/bootstrap.sh        # install deps, start TimescaleDB, run migrations
   docker compose up -d          # start all services
   docker compose ps             # confirm config(50060)/ingest/analysis/marketdata/agent are healthy
   ```
   The `ingest` registry table is created by `services/xstockstrat-ingest/migrations/002_add_signal_sources_registry.up.sql` — confirm it applied (it is part of `bootstrap.sh` / the `db-migrator` job).

2. **Alpaca paper keys (required for backtesting).** Backtests need OHLCV bars, which
   `xstockstrat-marketdata` pulls from Alpaca. Follow `docs/setup/alpaca.md` to create a paper
   account and set `ALPACA_API_KEY` / `ALPACA_API_SECRET` in `.env`. Paper data URL is
   `https://data.alpaca.markets`. **Without this, Part C and the backtests cannot run** — the
   engine will skip every symbol with no bars.

3. **Admin API key (required to register sources).** `ManageSignalSource` requires an
   admin-scoped key validated via identity's `ValidateApiKey`
   (`services/xstockstrat-ingest/app/handlers/servicer.py:46`). Mint one with
   `scripts/manage-users.sh` (also available at `/app/scripts/manage-users.sh` inside the
   identity container).

4. **Wire the agent (for mediated-email ingestion).** Configure the MCP agent per
   `docs/runbooks/mcp-tools.md` (`services/xstockstrat-agent/claude_mcp_config.json`). For a
   first pass, `stdio` transport against the local gRPC endpoints is simplest. Set
   `MCP_AGENT_SECRET` to the same value across agent/ingest/notify/analysis (or leave empty to
   disable `x-mcp-secret` enforcement while testing).

---

## Part A — Register the two signal sources (Day 1)

Both sources are registered as `mediated_simple_email`. For this type, `extractor_module` is
`app.extractors.noop` and `config_json` **must** contain non-empty `sender_patterns` and
`subject_patterns` (enforced by `validate_config_json` in
`services/xstockstrat-ingest/app/repositories/signal_sources.py:70`). `extractor_tool` comes
back `null` — meaning Claude reads the email body directly; no `extract_email_content` call is
needed for the simple-email type.

**Option 1 — Config-UI (recommended).** Open the Sources page at
`http://localhost:3002/config-ui/sources` (`services/xstockstrat-config-ui/app/sources/page.tsx`),
click **Register source**, and create:

| Field | `unusual_whales` | `pure_power_picks` |
|---|---|---|
| slug | `unusual_whales` | `pure_power_picks` |
| display_name | `Unusual Whales` | `Pure Power Picks` |
| source_type | `mediated_simple_email` | `mediated_simple_email` |
| sender_patterns | `*@unusualwhales.com` | `*@purepowerpicks.com` |
| subject_patterns | `*flow*`, `*sweep*` | `*pick*`, `*alert*` |
| active | ✅ | ✅ |

(Adjust the patterns to match the actual newsletter sender/subject lines once you see a real email.)

**Option 2 — gRPC directly** (`ManageSignalSource`, operation `register`), with the admin key in
`Authorization`. Use this if you prefer scripting; the field set is identical to the table above.

**Verify:** the agent tool `list_signal_sources` returns both slugs with
`source_type: "mediated_simple_email"` and `extractor_tool: null`
(`docs/runbooks/mcp-tools.md` §`list_signal_sources`).

### Per-source config keys (optional but recommended)

Register in the Config UI (`http://localhost:3002`) so defaults apply when a source omits a field:

| Key | Value | Effect |
|---|---|---|
| `ingest.signals.unusual_whales.enabled` | `true` | activate ingestion |
| `ingest.signals.unusual_whales.default_window_days` | `5` | `valid_until` fallback |
| `ingest.signals.unusual_whales.default_conviction` | `0.6` | conviction fallback |
| `ingest.signals.pure_power_picks.enabled` | `true` | activate ingestion |
| `ingest.signals.pure_power_picks.default_window_days` | `5` | `valid_until` fallback |
| `ingest.signals.pure_power_picks.default_conviction` | `0.6` | conviction fallback |
| `ingest.signals.dedup_window_hours` | `24` | skip duplicate symbol+source+direction |

---

## Part B — Ingest signals via the agent (Day 1–2)

For `mediated_simple_email`, the flow (from `docs/runbooks/mcp-tools.md` §Usage Patterns) is:

1. `list_signal_sources()` → confirm both slugs are active.
2. Claude reads the newsletter email body (forward the email into the agent session).
3. Parse out `symbol`, `direction`, `conviction`, `valid_from`/`valid_until` from the text.
4. `ingest_signal(source="unusual_whales", symbol="NVDA", direction="buy",
   valid_from="2026-05-31T00:00:00Z", conviction=0.85, tags=["unusual_options","call_sweep"])`.

If `conviction >= agent.signal.alert_threshold` (default `0.6`), an alert is auto-emitted via
`xstockstrat-notify` — good to watch in the notify stream as a side-effect test.

**Tip for repeatable testing:** you don't need a live inbox to validate the pipeline. Hand a few
representative signals straight to `ingest_signal` (agent tool or `grpcurl`) for each source.
That gives full end-to-end coverage of registry validation → persistence → query → backtest, and
you can layer in real email parsing once the path is proven.

**Verify:**
```sql
SELECT source, symbol, direction, conviction, valid_from, valid_until
FROM ingest.newsletter_signals
ORDER BY ingested_at DESC LIMIT 20;
```
Also confirm a `ingest.signal.ingested` event appears in the ledger stream.

---

## Part C — Load market data for backtesting (Day 2)

Pick a small symbol set and backfill ~1 year of daily bars so the SMA-crossover has history.

```bash
# via the backfill RPC (the integration harness uses the same path)
# symbols: a handful you also have signals for, e.g. NVDA, AAPL, MSFT
SKIP_BACKFILL=0 ./scripts/integration-test.sh   # exercises backfill + RunBacktest end-to-end
```
Or trigger a targeted backfill per `docs/runbooks/historical-backfill.md`.

**Verify:**
```sql
SELECT source, COUNT(*), MIN(time), MAX(time)
FROM marketdata.ohlcv
WHERE symbol = 'NVDA' AND timeframe = '1d'
GROUP BY source;
```

---

## Part D — Define and run the two strategies (Day 3)

Both strategies call `AnalysisService.RunBacktest` (agent tool `run_backtest`, or `grpcurl`).
`strategy_id` is just a label; the behavior comes from `strategy_params`.

### Strategy A — `sma_baseline` (control, pure technical)
```jsonc
{
  "strategy_id": "sma_baseline",
  "symbols": ["NVDA", "AAPL", "MSFT"],
  "initial_capital": 100000,
  "range": { "start": "2025-05-01T00:00:00Z", "end": "2026-05-01T00:00:00Z" },
  "strategy_params": { "fast_period": 20, "slow_period": 50 }
}
```

### Strategy B — `sma_signal_weighted` (SMA + both newsletter sources)
```jsonc
{
  "strategy_id": "sma_signal_weighted",
  "symbols": ["NVDA", "AAPL", "MSFT"],
  "initial_capital": 100000,
  "range": { "start": "2025-05-01T00:00:00Z", "end": "2026-05-01T00:00:00Z" },
  "strategy_params": {
    "fast_period": 20,
    "slow_period": 50,
    "signal_sources": ["unusual_whales", "pure_power_picks"],
    "signal_weight": 0.4,
    "technical_weight": 0.6,
    "min_conviction": 0.6
  }
}
```

**Source reliability weighting (feature 007).** Set `analysis.signals.source_weights` in config
to weight the two providers relative to each other, e.g.:
```json
{ "unusual_whales": 1.0, "pure_power_picks": 0.7 }
```
Values are clamped to `[0,1]` at read time (`servicer.py:53`). Empty/absent ⇒ all sources weight 1.0.

---

## Part E — Compare and verify (Day 3–4)

Each `BacktestResult` returns `total_return`, `annualized_return`, `sharpe_ratio`,
`max_drawdown`, `win_rate`, `total_trades`, `profit_factor`. Tabulate A vs B:

| Metric | `sma_baseline` | `sma_signal_weighted` | Read as |
|---|---|---|---|
| total_return | … | … | did signals add return? |
| sharpe_ratio | … | … | risk-adjusted improvement? |
| max_drawdown | … | … | did signals reduce drawdown? |
| total_trades | … | … | signal-gating changes trade count |

**Checklist:**
- [ ] Both sources visible via `list_signal_sources` (`active`, `mediated_simple_email`).
- [ ] At least a few signals per source land in `ingest.newsletter_signals`.
- [ ] High-conviction signal auto-emits an alert via notify.
- [ ] `marketdata.ohlcv` has bars for every backtested symbol.
- [ ] `RunBacktest` returns metrics for both `sma_baseline` and `sma_signal_weighted`.
- [ ] `analysis.backtest.completed` ledger events present for both runs.
- [ ] B's `total_trades` differs from A (confirms `min_conviction` gating took effect).

---

## Suggested timeline

| Day | Focus |
|---|---|
| Day 0 | Prereqs: stack up, Alpaca paper keys, admin key, agent wired. |
| Day 1 | Part A (register both sources) + Part B (first ingested signals). |
| Day 2 | Finish Part B; Part C (backfill OHLCV). |
| Day 3 | Part D (run A + B) + start Part E comparison. |
| Day 4 | Finish Part E; record findings; decide next iteration (tune weights/periods). |

---

## Known gotchas / doc drift to watch

- **`docs/runbooks/add-data-source.md` Part 2 is design-era.** It still shows free-form `source`
  strings and `POST /webhooks/ingest-signal` HTTP. The platform is now **gRPC-only** and the
  `source` slug is validated against the registry. Use the registry + agent flow in this plan,
  not the raw webhook.
- **Root `CLAUDE.md` roadmap table marks Phase 2 (marketdata) "Pending".** That's stale —
  feature `013-phase-2-data-layer` is `launched` and `GetBars`/`BackfillBars` exist. Market data
  is available once Alpaca keys are set.
- **Backtest is SMA-only.** `RunBacktest` does not accept a `formula_id`; custom indicator
  formulas (`indicators` `RegisterFormula`/`ExecuteFormula`) are not wired into the backtest
  engine. Treat custom-formula strategies as a future enhancement, not part of this test.
- **`min_conviction` interacts with both signals and technicals.** With `signal_weight` > 0 and a
  symbol that has no active signals in-window, the combined score is technical-only — so set
  `min_conviction` carefully or B may simply mirror A.

---

## Related runbooks

| Runbook | Use for |
|---|---|
| `docs/runbooks/mcp-tools.md` | Agent tool reference (`list_signal_sources`, `ingest_signal`, `run_backtest`). |
| `docs/runbooks/add-data-source.md` | Background on the signal data model (Part 2/3). |
| `docs/runbooks/historical-backfill.md` | Backfilling OHLCV bars. |
| `docs/setup/alpaca.md` | Alpaca paper keys for market data. |
| `docs/runbooks/config-rollout.md` | Registering the `ingest.signals.*` / `analysis.signals.source_weights` keys. |
| `docs/runbooks/indicator-builder.md` | (Future) custom formula indicators. |
