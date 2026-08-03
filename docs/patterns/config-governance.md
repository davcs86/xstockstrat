# Config Governance Rules

All runtime configuration is served by **xstockstrat-config** via `WatchConfig` streaming RPC (gRPC port 50060). config is gRPC-only.

## Rules (apply to every service)

1. **No hardcoded config values** in service source code. All env-specific values must be registered in the config service.
2. **Config key naming**: `<service-short-name>.<category>.<key>` — e.g., `indicators.sandbox.timeout_ms`
3. **All services subscribe to xstockstrat-config at startup** before accepting traffic, passing `environment` and `trading_mode` in the WatchConfig request.
4. **Config values are scoped** by `environment` (`dev`/`production`) and `trading_mode` (`paper`/`live`/`all`). Rows with `trading_mode='all'` apply to all modes.
5. **Config changes flow**: agent or webhook caller → config webhook handler → config service → WatchConfig stream → all subscribers.
6. **Sensitive keys** use the `secret.*` prefix and are resolved from the secret store at runtime — never stored in config service state.
7. **Default values** must be declared in each service's `CLAUDE.md` under "Config Keys".
8. **Config UI** at `http://localhost:3002` — manage config values by environment and trading mode.

## Global Config Keys

| Key | Type | Default | Description |
|---|---|---|---|
| `platform.maintenance_mode` | bool | false | Halts all trading operations |
| `platform.log_level` | string | info | Global log level override |
| `platform.ledger_endpoint` | string | — | xstockstrat-ledger gRPC address |
| `platform.config_endpoint` | string | — | xstockstrat-config gRPC address |
| `platform.otel.enabled` | bool | false | Master OTel export switch |
| `platform.otel.endpoint` | string | — | OTLP endpoint (set via secret) |
| `platform.otel.sample_rate` | float | 1.0 | Trace sample rate (0.0–1.0) |

## Registering a new config key

1. Add the key to the config service's seed data.
2. Declare it in the consuming service's `CLAUDE.md` under "Config Keys Consumed".
3. Approval: service owner + config team (see `docs/runbooks/approval-flow.md`).
4. Add a row to the "Per-Feature Registered Keys" log below.

## Per-Feature Registered Keys

Append-only log — one entry per feature that registered new keys. Newest first. Don't edit past entries; superseding a key's behavior gets a new entry, not a rewrite of the old one.

### feature 097 — opportunity-universe-unification (`xstockstrat-analysis`)

Config surface for the materialized opportunity queue (lazy compute-on-read + stale-while-revalidate + a daily refresh). `analysis.signals.source_weights` is **unchanged** (stays the screener's); the queue's independent signal ranking axis is the new scalar `analysis.opportunity.signal_rank_weight`.

| Key | Type | Default | Description |
|---|---|---|---|
| `analysis.opportunity.max_universe_size` | int | `100` | Max candidates traced per compute; watchlist/held rank **above the cut** so a curated symbol is never truncated (FR-1). |
| `analysis.opportunity.valid_window_hours` | int | `24` | `valid_until` = the compute's session date + this window. |
| `analysis.opportunity.snooze_default_hours` | int | `24` | Default bounded "snooze until" when a SNOOZE carries no explicit timestamp. |
| `analysis.opportunity.signal_rank_weight` | float | `0.3` | Weight `w ∈ [0,1]` of the signal axis in the queue ORDER BY (OR-G); `rank = (1−w)·conviction + w·signal_axis`. |
| `analysis.opportunity.refresh_hour_utc` | int | `0` | Hour (UTC) of the configured **daily refresh** pass — a wall-clock refresh, **not** market close (holiday/DST/early-close drift expected). Read **presence-aware** (mirror `get_bool`'s `HasField`), never `get_int`, since `0` = midnight is legitimate and the zero-trap would swallow it. |

### feature 083 — opportunities-first UI revamp (`xstockstrat-portfolio`)

The Exposure surface groups positions by factor. marketdata exposes no `sector`, so factor is
sourced from an operator-defined symbol→factor map read via `WatchConfig` (`Watcher.FactorMap()`).

| Key | Type | Default | Description |
|---|---|---|---|
| `portfolio.exposure.factor_map` | string (JSON) | `"{}"` | JSON object mapping symbol → factor name for the Exposure screen's factor grouping. Unmapped symbols group as "Unclassified"; invalid JSON reads as an empty map. |

### feature 069 — strategy re-entry cooldown (`xstockstrat-analysis`)

Per-strategy re-entry cooldown so a rule-based strategy's `entry_rule` can't immediately refire on a symbol right after an exit. The per-strategy duration travels via the proto field `StrategyDefinition.cooldown_days` (explicit presence: unset → this default, explicit `0` → no cooldown, negative → rejected); this config key is only the platform-wide default applied when the field is unset.

| Key | Type | Default | Description |
|---|---|---|---|
| `analysis.strategy.default_cooldown_days` | int | `31` | Per-strategy default re-entry cooldown in calendar days when `StrategyDefinition.cooldown_days` is unset; `31` sits outside the IRS 30-day-each-side wash-sale window. `get_int` zero-trap: a platform-wide value of `0` reads back as the default `31` — a per-strategy explicit-`0` (no cooldown) is unaffected because it travels via proto explicit presence, not this config read. |

### feature 068 — backtest results visualization (`xstockstrat-analysis`)

Every OK `RunBacktest` persists its full serialized result (`analysis.backtest_details`, migration `008`) so past runs stay visualizable via the `GetBacktest` RPC; eviction keeps the newest N detailed runs per strategy (summary rows in `backtest_runs` are never trimmed).

| Key | Type | Default | Description |
|---|---|---|---|
| `analysis.backtest.detail_retention_per_strategy` | int | `20` | Max persisted detailed runs per strategy; count-based eviction at insert, clamped ≥1. `get_int` zero-trap: `0` reads as the default. |

### feature 065 — cross-stock score derivation (`xstockstrat-analysis`)

The headline strategy grade is derived from per-symbol (symbol × window) evidence cells (`analysis.backtest_run_symbols`, migration `007`) via trading-day evidence weighting + empirical-Bayes shrinkage toward a neutral 0.5 prior — so high grades are earnable only through breadth + duration across stocks, and a throwaway single-symbol run can never overwrite a well-evidenced grade. (Design-level narrative: `services/xstockstrat-analysis/docs/scoring.md`; binding invariants ANALYSIS-2/3.)

| Key | Type | Default | Description |
|---|---|---|---|
| `analysis.scoring.shrinkage_days` | int | `250` | Empirical-Bayes shrinkage pseudo-count `k` (trading days) toward the 0.5 prior; perfect evidence earns an A once total evidence `W ≥ 1.5·k`. `get_int` zero-trap: `0` reads as the default. |
| `analysis.scoring.min_evidence_symbols` | int | `3` | Below this many distinct evidence symbols the grade is flagged `provisional`. |
| `analysis.scoring.min_evidence_days` | int | `500` | Below this many total evidence trading-days the grade is flagged `provisional`. |

### feature 064 — backtest debug diagnostics (`xstockstrat-analysis`)

| Key | Type | Default | Description |
|---|---|---|---|
| `analysis.backtest.max_range_days` | int | `730` | Max backtest range span in days (≈2 years). A `RunBacktest` whose `range` exceeds it is rejected with `INVALID_ARGUMENT`; an unset bound is defaulted to the last `max_range_days`. Applies to all callers. Bounds the always-included per-bar diagnostics to ~504 rows/symbol. |

### Alpaca API compliance audit — PR #699 (`xstockstrat-marketdata`)

| Key | Type | Default | Description |
|---|---|---|---|
| `marketdata.alpaca.adjustment` | string | `all` | Corporate-action adjustment for historical bars (`raw`/`split`/`dividend`/`all`); sent as `adjustment=` on every Alpaca bars request so splits/dividends do not distort backtest OHLCV. |

### feature 057 — backfill management UI (`xstockstrat-marketdata`)

| Key | Type | Default | Description |
|---|---|---|---|
| `marketdata.backfill.max_delete_days` | int | `0` | Max date-range span (days) a single scoped `DeleteBackfilledData` may cover; `0` = no window cap (current behavior). Whole-symbol deletes (no range) are exempt and double-confirmed in the UI (FR-5). |

### feature 062 — fundamentals signal producer (`xstockstrat-analysis`)

A daily background loop reads cached fundamentals via marketdata `GetFundamentalsMulti` (never FMP), scores, and emits `buy`/`sell`/`hold` `ExternalSignal`s through ingest. Analysis also gains a `PORTFOLIO_ENDPOINT` (gRPC `xstockstrat-portfolio:50052`) for the watchlist universe, and ingest migration `006_signal_source_type_derived` adds the `derived` source type.

| Key | Type | Default | Description |
|---|---|---|---|
| `analysis.fundsignal.enabled` | bool | `false` | Master gate for the producer loop; off by default |
| `analysis.fundsignal.run_interval_hours` | int | `24` | Hours between scheduled cycles |
| `analysis.fundsignal.universe_source` | string | `watchlists` | `watchlists` \| `explicit` \| `both` (watchlists union pends a global portfolio RPC; falls back to `explicit`) |
| `analysis.fundsignal.explicit_symbols` | string | `""` | Comma-separated symbols for the explicit universe |
| `analysis.fundsignal.max_symbols_per_run` | int | `200` | Cap on symbols scanned per cycle |
| `analysis.fundsignal.daily_call_budget` | int | `200` | Max cached `GetFundamentalsMulti` calls per cycle; ≤ `marketdata.fmp.daily_request_cap` (250) |
| `analysis.fundsignal.source_slug` | string | `fundamentals` | Slug of the registered `derived` signal source |
| `analysis.fundsignal.scoring_formula_id` | string | `""` | Optional 063 scoring formula id; empty → built-in default score |
| `analysis.fundsignal.buy_quantile` | float | `0.80` | Cross-sectional quantile ≥ → `buy` |
| `analysis.fundsignal.sell_quantile` | float | `0.20` | Cross-sectional quantile ≤ → `sell` |
| `analysis.fundsignal.min_conviction_to_emit` | float | `0.0` | Drop symbols below this score before emitting |
| `analysis.fundsignal.valid_days` | int | `90` | Emitted signal validity window in days |

### feature 059 — fundamentals data source (`xstockstrat-marketdata`)

Establishes the `marketdata.<source>.enabled` convention (a source is off until its `enabled` key is flipped).

| Key | Type | Default | Description |
|---|---|---|---|
| `marketdata.fmp.enabled` | bool | `false` | Master gate for the FMP fundamentals source; off by default |
| ~~`secret.marketdata.fmp.api_key`~~ | — | — | **Removed by feature 076** (migration `009`). The FMP credential is now the `FMP_API_KEY` secret env var, matching Alpaca/JWT/MCP-agent. Credentials do not belong in config: values are plaintext and stream to every `WatchConfig` subscriber. No `secret://` resolver was ever built |
| `marketdata.fmp.cache_ttl_hours` | int | `24` | Hours a cached fundamentals row stays fresh before re-fetch |
| `marketdata.fmp.daily_request_cap` | int | `250` | Max FMP requests per UTC day (free Basic budget) |
| `marketdata.fmp.base_url` | string | `https://financialmodelingprep.com` | FMP API base URL |
| `marketdata.fmp.metrics` | string | `core,extended` | Metric tiers to fetch (`core`, `extended`) |

### feature 060 — screener engine (`xstockstrat-analysis`)

| Key | Type | Default | Description |
|---|---|---|---|
| `analysis.screener.max_universe_size` | int | `100` | Max symbols a single `ScreenSymbols` scan may cover |
| `analysis.screener.max_duration_seconds` | int | `120` | Overall deadline for one screener scan |
| `analysis.screener.default_rank_limit` | int | `50` | Default ranked results returned when `rank_limit` is omitted |
| `analysis.screener.max_concurrent_formula_evals` | int | `4` | Max concurrent `ExecuteFormula` evals during a scan |

### feature 058 — watchlist management (`xstockstrat-portfolio`)

| Key | Type | Default | Description |
|---|---|---|---|
| `portfolio.watchlist.max_per_user` | int | `50` | Max watchlists a single user may own |
| `portfolio.watchlist.max_symbols_per_list` | int | `500` | Max symbols allowed in one watchlist |

### feature 049 Part B — MCP OAuth 2.1 edge auth (`xstockstrat-agent`)

| Key | Type | Default | Description |
|---|---|---|---|
| `agent.oauth.registration_enabled` | bool | `true` | Allow RFC 7591 Dynamic Client Registration at `/oauth/register` |
| `agent.oauth.allowed_redirect_uris` | string | `""` | Comma-separated exact redirect URIs; empty = require `https://` at registration only (no allow-any) |
