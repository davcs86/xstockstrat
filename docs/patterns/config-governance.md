# Config Governance Rules

All runtime configuration is served by **xstockstrat-config** via `WatchConfig` streaming RPC (gRPC port 50060). config is gRPC-only.

## Rules (apply to every service)

1. **No hardcoded config values** in service source code. All env-specific values must be registered in the config service.
2. **Config key naming**: `<service-short-name>.<category>.<key>` — e.g., `indicators.sandbox.timeout_ms`
3. **All services subscribe to xstockstrat-config at startup** before accepting traffic, passing `environment` (and, where a per-user value is needed, an optional `user_id`) in the WatchConfig request. The `trading_mode` field is deprecated (feature 147) and ignored by the server.
4. **Config values are scoped** by two dimensions (feature 147): `environment` (`production`/`staging`) × `global`/per-user (`user_id`, NULL = global). A per-user value overrides the global value on both `GetConfig` and `WatchConfig`. Paper/live is **derived** from environment (production = live, staging = paper) — the former `trading_mode` (`paper`/`live`/`all`) axis was removed. The deprecated `ENVIRONMENT_DEV` maps to the `staging` scope. **Write authorization is scope-aware (PR #994):** a **global** write requires the ADMIN bit (or an authorized internal caller); a **per-user** write is **self-service** — only the owner (propagated `x-user-id` == target `user_id`) may write their own row, and an admin earns **no** override for another user's per-user row (admins reach globals + their own rows only). Secrets stay global-only.
5. **Config changes flow**: agent or webhook caller → config webhook handler → config service → WatchConfig stream → all subscribers.
6. **Secrets ARE stored in config now, encrypted at rest (feature 147 — reversing feature 076's
   ban, with explicit operator sign-off recorded in the feature's `context.md`).** Feature 076
   removed the earlier `secret.*` mechanism because it built no encryption, redaction, or resolver —
   values were plaintext, streamed to every `WatchConfig` subscriber, so a config-stored "secret"
   was never actually secret. Feature 147 built exactly those three guards and re-permitted secrets:
   a secret row (`is_secret=true`) stores AES-256-GCM ciphertext in a `value_encrypted BYTEA` column
   (master key: the `CONFIG_SECRETS_ENCRYPTION_KEY` env var, hex 32 bytes, same custody as
   `BROKER_ACCOUNTS_ENCRYPTION_KEY`; the config service fails to boot without it), `value_data`
   holds the literal `[redacted]` sentinel, and plaintext is **redacted at every read/broadcast
   edge** — `WatchConfig`/`GetConfig`/`ListKeys` and the config-ui/agent tools never expose it.
   Plaintext is returned only by the authenticated **`GetSecret`** RPC, which decrypts server-side
   and hands the value to an **allow-listed internal service caller** (the `x-internal-caller`
   metadata channel, mirroring feature 102). `is_secret` is **row-authoritative on write** (read
   from the stored row, never trusted from the request), so an admin update can never land
   plaintext. The `secret.*` **name prefix is retired** — secret-ness is the `is_secret` flag alone,
   not a name convention. The non-secret *knobs* around a credential (`<source>.enabled`,
   `.base_url`, cache/quota settings) remain ordinary config keys.
7. **Default values** must be declared in each service's `CLAUDE.md` under "Config Keys".
8. **Config UI** at `http://localhost:3002` — manage config values by environment (`production`/`staging`) and global/per-user scope.

## Global Config Keys

| Key | Type | Default | Description |
|---|---|---|---|
| `platform.maintenance_mode` | bool | false | Halts all trading operations |
| `platform.trading_state` | string | ACTIVE | Richer halt state (`ACTIVE`/`REDUCE_ONLY`/`HALTED`), independent of `platform.maintenance_mode`; seeded per environment (one global row per environment since feature 147 collapsed the `trading_mode` axis) |
| `platform.log_level` | string | info | Global log level override |

> **Not real config keys (2026-08-07 audit):** this table previously also listed
> `platform.ledger_endpoint`, `platform.config_endpoint`, `platform.otel.enabled`,
> `platform.otel.endpoint`, and `platform.otel.sample_rate`. None of the five is seeded in any
> `xstockstrat-config` DB migration, and no service reads any of them via `WatchConfig` — a repo-wide
> grep found zero call sites. Inter-service gRPC addresses use the `<SERVICE>_ENDPOINT` env var
> convention instead (`LEDGER_ENDPOINT`, `CONFIG_ENDPOINT` — see root CLAUDE.md § Environment
> Variable Naming Convention); a service also cannot fetch its own `config_endpoint` from the config
> service before it has connected to the config service, so that key was never buildable as
> described. OTel toggling is env-var-driven (`OTEL_ENABLED`, `OTEL_EXPORTER_OTLP_ENDPOINT`) per
> `docs/patterns/observability.md`. Rows removed rather than left aspirational; reintroduce only
> alongside the DB seed migration and the code that actually reads them.

## Registering a new config key

1. Add the key to the config service's seed data.
2. Declare it in the consuming service's `CLAUDE.md` under "Config Keys Consumed".
3. Approval: service owner + config team (see `docs/runbooks/approval-flow.md`).
4. Add a row to the "Per-Feature Registered Keys" log below.

## Registering a new vendor credential (an encrypted secret config row)

Since feature 147 a vendor API key/secret **is** a config key — a secret row (`is_secret=true`)
whose value is AES-256-GCM ciphertext in `value_encrypted`, redacted at every read edge and
resolvable only via the `GetSecret` RPC (Rule 6 above). The wiring path is now:

1. **Seed the secret row** in `xstockstrat-config` with **NULL ciphertext** (`is_secret=true`,
   scope: global, per environment). The row exists but carries no value until an operator sets it.
2. **Set the real value post-deploy** through the normal config **write path** (config-ui / the
   admin-gated `SetConfig`), which encrypts it under `CONFIG_SECRETS_ENCRYPTION_KEY`. Never commit
   the plaintext.
3. **Grant the consuming service read access** by adding an `x-internal-caller` allow-list entry to
   `SECRET_CALLER_ALLOWLIST` in `services/xstockstrat-config/src/grpc/authz.ts` (caller → the
   specific secret keys it may decrypt).
4. **Resolve it in the consuming service** at startup via `GetSecret` (sending
   `x-internal-caller: <service>`), not from an env var.

The one bootstrap env var this depends on is **`CONFIG_SECRETS_ENCRYPTION_KEY`** (hex 32 bytes) on
the config service — without it the config service will not boot. Approval: service owner + Security
(per `docs/runbooks/reviewer-registry.md`'s Security role — encryption at rest, redaction at every
edge, `GetSecret` allow-list, `is_secret` row-authoritative on write).

> **Historical:** before feature 147, a vendor credential was a DO App Platform `type: SECRET` env
> var wired through the deploy pipeline (an 8-file checklist in
> `docs/runbooks/add-data-source.md`). Feature 076 had banned config-stored secrets entirely because
> no encryption/redaction/resolver existed. That is no longer the current path — the four vendor
> credentials (`marketdata.alpaca.api_key`, `marketdata.alpaca.api_secret`, `marketdata.fmp.api_key`,
> `marketdata.finnhub.api_key`) moved into encrypted config in feature 147 and their env vars were
> removed.

## Author-sentinel conventions

A `SetConfigRequest.author` (or equivalent write-attribution field) written by an automated
process, not a human operator, uses a `system:<process>` sentinel so an investigator can
distinguish "an operator clicked Save" from "an automated process wrote this" in the audit log —
without this convention, both look identical (fails.md 2026-07-01).

| Sentinel | Service | Writer |
|---|---|---|
| `system` | `xstockstrat-indicators` | The seeded fundamentals-scoring formula (`app/formulas/fundamentals_value_quality.py`), documented here retroactively per feature 102 |
| `system:reconciliation-poller` | `xstockstrat-trading` → `xstockstrat-config` | The broker-state-reconciliation poller's rare systemic escalation of `platform.trading_state` (feature 102) — paired with the structural `x-internal-caller`/`caller_identity` mechanism (see `services/xstockstrat-config/CLAUDE.md`), not a free-text convention alone |

## Per-Feature Registered Keys

Append-only log — one entry per feature that registered new keys. Newest first. Don't edit past entries; superseding a key's behavior gets a new entry, not a rewrite of the old one.

### feature 168 — fundamentals-blend-universe (`xstockstrat-analysis` / `xstockstrat-config`)

**Registers** two `analysis.engine.*` keys, seeded by migration **`024_analysis_engine_blend_keys`**
for `staging` + `production` (global, `user_id` NULL), `consuming_service` `xstockstrat-analysis`.
Both use the **full-dotted-key form** in the `key` column (per migration `021`) — the live loop reads
them via the existing `analysis`-namespace `WatchConfig` stream (`get_str`/`get_bool`), which keys the
snapshot by the `key` column with no namespace prefix added, so the seeded key must equal the read
string; **no new cross-namespace subscription** (unlike feature 154's `marketdata` read):

- `analysis.engine.fundamentals_blend_strategy_id` (string, default `fundamentals_macd_blend`) — the
  strategy id the fundamentals-universe force-run rule governs. When that strategy is live, the live
  loop evaluates it over the fundamentals universe (signals from the fundamentals source ∩ symbols
  with fundamentals data), minus its deny list, instead of its ordinary owner-scoped universe.
- `analysis.engine.fundamentals_blend_enabled` (bool, default `true`) — the kill-switch. Read via
  `get_bool` (HasField-based), so an explicit operator `false` is honored and disables the override
  entirely (the governed strategy then resolves its own universe like any other), independent of
  whether that strategy is live.

Declared in `services/xstockstrat-analysis/CLAUDE.md` § Config Keys Consumed. No other new keys.

### feature 031 — strategy-performance-dashboard (`xstockstrat-ui`)

**Registers** two `ui.performance.*` keys, seeded by migration **`023_ui_performance_keys`** for
`staging` + `production` (global, `user_id` NULL), `consuming_service` `xstockstrat-ui`:

- `ui.performance.risk_free_rate_annual` (float, default `0.045`) — the annualized risk-free rate for
  the `/insights/performance` rolling-30d Sharpe (FR-3).
- `ui.performance.equity_curve_start_date` (string, default `''` = auto) — the ISO start date of the
  cumulative-P&L equity curve (FR-1); empty ⇒ the UI defaults to the earliest closed-position date.

Both are read **one-shot via `GetConfig(namespace='ui')`** in `insightsBff.ts` (the UI is a stateless
BFF — no `WatchConfig`), with an oneof-presence check so a stored `0` / empty string is honored (never
`value || default`). The `key` column stores the sub-key (`performance.…`) so the returned values map
is keyed as `values['performance.risk_free_rate_annual']` (the `platform`/`trading_state` GetConfig
precedent). Declared in `services/xstockstrat-ui/CLAUDE.md` § Config Keys Consumed.

### feature 095 — opportunity-live-market-enrichment (`xstockstrat-analysis`)

**Registers** `analysis.opportunity.sparkline_bars` (int, default `20`) — the number of most-recent
daily bar closes fetched per opportunity for the Decide-surface sparkline (AC-3). Read **live** at
read-time enrichment via `get_int` with a `max(1, …)` clamp. **No config-service seed migration** —
this follows the `analysis.opportunity.*` no-seed pattern (features 131/141): the key resolves to the
code default until an operator `SetConfig`s it, and is env-overridable per F-07. Declared in
`services/xstockstrat-analysis/CLAUDE.md` § Config Keys Consumed. No other new keys.

### feature 161 — surface-signal-weight-decay-config (`xstockstrat-config` / `xstockstrat-analysis`)

**Registers** `analysis.scoring.signal_decay_half_life_hours` (float, default `24.0`, migration 019)
— the decay half-life feature 022 read with a hardcoded default but never registered. It carries
**server-enforced scalar bounds `[0, 8760]`** (0 disables decay): the config service's
`SCALAR_BOUNDS_REGISTRY` (`configServiceImpl.ts`) rejects an out-of-range/NaN `SetConfig` write
`INVALID_ARGUMENT` (parsed via the all-oneof-shape `extractValueData`, so the agent's `float_val`
write is guarded — not a config-ui-only check), and `ListKeys` emits a `ValidationRule` of the new
`config.v1.ValueType.VALUE_TYPE_FLOAT_SCALAR` (proto enum value 2, additive/non-breaking) so config-ui
renders the bound.

**Removes** `analysis.signals.source_weights` (migration 020) — the FLOAT_MAP key superseded by
feature 134, read by no service. Its removal also retired the config-service FLOAT_MAP validation
machinery (`WEIGHT_KEY_REGISTRY` + the `ListKeys` FLOAT_MAP emit branch + config-ui `validateFloatMap`),
of which it was the sole consumer; `VALUE_TYPE_FLOAT_MAP` (enum value 1) is retained `[deprecated]` for
enum stability.

Also surfaces the per-source `reliability_weight` (feature 134) to the MCP agent
(`list_signal_sources` / `manage_signal_source`) and the config-ui source create/edit form — not a
config-key change, recorded here for cross-reference.

### feature 154 — fundsignal-watchlist-universe (`xstockstrat-analysis` reads `marketdata` namespace)

**No new keys.** Recorded here for a first-of-its-kind coupling: `xstockstrat-analysis` now holds a
**second, boot-frozen `WatchConfig` subscription to the `marketdata` namespace** — the platform's
**first cross-namespace stream subscription** (every other service subscribes only to its own
namespace; the agent reads foreign namespaces via one-shot `GetConfig`, not a live stream). The
fundamentals-signal producer branches its FMP-budget `max_symbols` cap on
`marketdata.fundamentals.provider`, which marketdata itself reads **once at boot** (never re-read
live). Analysis mirrors that freeze: it constructs a `ConfigWatcher(namespace="marketdata")` in
`app/main.py`, awaits its snapshot, reads the provider once, and passes the frozen result into
`FundamentalsSignalLoop`. Reading it **live** would re-introduce the exact producer/consumer
divergence marketdata froze against; a **mirror key** in the `analysis` namespace would duplicate
provider state and drift (see `docs/roadmap/ledger/insights.md`, 2026-08-24). A consumer that must
branch on a producer-owned, boot-frozen config value in another namespace should consume it with
matching freeze semantics, via its own namespace subscription — not a live read and not a duplicated
key.

### feature 150 — backtest-portfolio-sizing (`xstockstrat-analysis`)

Adds an opt-in portfolio sizing model to the backtest engine. Two new **code-default** keys in the
`analysis` namespace (no config seed migration — analysis keys fall through to their in-code defaults
until an operator `SetConfig`s them):

| Key | Type | Default | Notes |
|---|---|---|---|
| `analysis.backtest.portfolio_position_weight` | float | `0.10` | Fraction of **initial** capital per concurrent position in portfolio mode. `get_float` (zero-trap intended — a configured `0` disables the portfolio → default). |
| `analysis.backtest.portfolio_max_concurrent` | int | `9` | Max concurrent positions in portfolio mode. `get_int` + `max(1, …)` clamp (zero-trap intended; clamp guards a negative). |

A configured `0` for either is a no-op (zero-trap → default), matching the existing
`analysis.scoring.shrinkage_days` precedent.

### feature 147 — config-secrets-and-scoping (`xstockstrat-config`, `xstockstrat-marketdata`)

Re-permits secrets in config, encrypted at rest, and re-models the config scope axes. The four
vendor credentials below move from `type: SECRET` env vars (feature 076) into **encrypted secret
config rows** (`is_secret=true`, global scope, per environment): the row stores AES-256-GCM
ciphertext in `value_encrypted` under `CONFIG_SECRETS_ENCRYPTION_KEY`, `value_data` holds the
`[redacted]` sentinel, and each is seeded with **NULL ciphertext until an operator sets the real
value post-deploy** via the config write path. `xstockstrat-marketdata` resolves them at startup via
the new `GetSecret` RPC (metadata `x-internal-caller: marketdata`, seeded allow-list grant:
`marketdata` → these four keys). The `secret.*` name prefix is retired — secret-ness is `is_secret`
alone. **Scope re-model:** the `trading_mode` axis is removed (paper/live now derived from
environment); config is scoped by `environment` (`production`/`staging`) × global/per-user
(`user_id`, NULL = global), with per-user overriding global.

| Key | Type | Default | Description |
|---|---|---|---|
| `marketdata.alpaca.api_key` | secret | _(NULL until set)_ | Alpaca API key. `is_secret`, encrypted at rest; resolved by marketdata via `GetSecret`. |
| `marketdata.alpaca.api_secret` | secret | _(NULL until set)_ | Alpaca API secret. `is_secret`, encrypted at rest; resolved via `GetSecret`. |
| `marketdata.fmp.api_key` | secret | _(NULL until set)_ | FMP fundamentals API key. `is_secret`, encrypted at rest; resolved via `GetSecret`. |
| `marketdata.finnhub.api_key` | secret | _(NULL until set)_ | Finnhub fundamentals API key. `is_secret`, encrypted at rest; resolved via `GetSecret`. |

### feature 042 — order-snapshots-pnl-patterns (`xstockstrat-analysis`)

The snapshot-compose timeouts and the query-time bucketing knobs for the ledger-driven P&L pattern
attribution. These **replace** the product spec's original `trading.snapshot.*` and
`analysis.patterns.pnl_bucket_size` keys (the design moved capture into analysis and switched to
query-time quantile bucketing). No credential keys.

| Key | Type | Default | Description |
|---|---|---|---|
| `analysis.snapshot.indicator_timeout_ms` | int | `500` | Max ms to wait for indicator values composing a snapshot; timeout → empty indicators map (FR-6) |
| `analysis.snapshot.signal_timeout_ms` | int | `500` | Max ms to wait for active signals; timeout → empty signals list (FR-6) |
| `analysis.patterns.min_sample_count` | int | `5` | Minimum samples in a bucket before a factor appears in `QueryPnLPatterns` |
| `analysis.patterns.indicator_bucket_count` | int | `5` | Quantile-bucket count for indicator-value factor grouping at query time |

### feature 020 — notify-external-fanout (`xstockstrat-notify`)

Adds a best-effort external alert fanout (Slack incoming webhook + SendGrid v3) as a side-channel on
`EmitAlert`. The five keys below are the gate/dedup/email knobs, seeded by config migration `018` for
`staging`+`production` (global scope — the `trading_mode` axis was removed by feature 147). The two
credentials (`SLACK_WEBHOOK_URL`, `SENDGRID_API_KEY`) are **not** config keys — they are app-level
`type: SECRET` deploy-pipeline env vars (like `JWT_SECRET`), distinct from the data-source vendor
credentials feature 147 moved into encrypted config. `min_severity`'s default `2` (WARNING)
deliberately excludes INFO fill confirmations; an operator lowers it to `1` to fan those out.

| Key | Type | Default | Description |
|---|---|---|---|
| `notify.fanout.min_severity` | int | `2` | Minimum `AlertSeverity` ordinal (0–4, clamped) to fan out; default 2 (WARNING) excludes INFO fills |
| `notify.fanout.min_confidence_threshold` | float | `0.7` | Minimum `context.conviction` to fan out, applied only when conviction is present (else severity-only) |
| `notify.fanout.dedup_window_seconds` | int | `300` | Suppress a byte-identical alert within this content-hash window |
| `notify.fanout.sendgrid_from_email` | string | `''` | Fanout email sender; email disabled until from/to set and `SENDGRID_API_KEY` present |
| `notify.fanout.sendgrid_to_email` | string | `''` | Fanout email recipient; same enable condition |

### feature 165 — pwa-notifications (`xstockstrat-notify`)

Adds a best-effort **Web Push** channel (a third fanout channel) delivering OS notifications to
installed-PWA devices. The one key below is seeded by config migration `021` for `staging`+`production`
(global scope). The VAPID credentials (`VAPID_PRIVATE_KEY`, `VAPID_PUBLIC_KEY`, `VAPID_SUBJECT`) are
**not** config keys — they are deploy-pipeline env vars (private key `type: SECRET`), like the
feature-020 fanout credentials. Gating mirrors `notify.fanout.min_severity` but is applied
independently to the push channel.

| Key | Type | Default | Description |
|---|---|---|---|
| `notify.push.min_severity` | int | `2` | Minimum `AlertSeverity` ordinal (0–4, clamped) to send a Web Push; default 2 (WARNING) excludes INFO fills |

### feature 141 — fix-opportunities-bars-fetch-oom (`xstockstrat-analysis`)

Adds one process-lifetime singleton semaphore key bounding cross-request concurrency of
`_compute_opportunities`' bars-fetch calls — a SEV-2 fix for TimescaleDB "out of shared memory"
(SQLSTATE 53200) failures under multi-user load. Paired with a per-pass, symbol-keyed bars dedup
cache (no config key — a plain function-local dict) that collapses feature 131's live-strategy
fan-out and the uncapped watchlist-binding multiplier down to one bars-fetch per unique symbol
per compute pass. Read live via `self._cfg.get_int(...)` (F-07), no config-service seed
migration — mirrors `analysis.series.max_concurrent_components`'s no-seed pattern.

| Key | Type | Default | Description |
|---|---|---|---|
| `analysis.opportunity.max_concurrent_bars_fetches` | int | `2` | Bounds concurrent bars-fetch attempts across simultaneous `_compute_opportunities` passes (different users), so Postgres never sees more concurrent multi-chunk `GetBars` queries than this. `max(1, get_int(...))` clamp. Default `2` (not the sibling semaphore precedents' `4`) to match `xstockstrat-marketdata`'s own `DB_POOL_MAX` default. |

### feature 125 — unified-symbol-page (`xstockstrat-analysis`)

Adds one process-lifetime singleton semaphore key for the FR-6 indicator-overlay-panel RPC
`GetIndicatorSeries`. New `analysis.series.*` category (distinct from `analysis.readiness.*` — this
is not readiness — and from the `xstockstrat-indicators` service's own `indicators.sandbox.*`
namespace). Read once at servicer construction, not live.

| Key | Type | Default | Description |
|---|---|---|---|
| `analysis.series.max_concurrent_components` | int | `4` | Bounds concurrent per-component `ComputeIndicator`/`ExecuteFormula` execution across simultaneous `GetIndicatorSeries` calls, so a routinely-visited Symbol page can't starve the analysis live loop. `max(1, get_int(...))` clamp. |

### feature 131 — live-strategy-opportunity-attribution (`xstockstrat-analysis`)

Adds live-strategy symbol-coverage attribution to the Opportunities compute (`_compute_opportunities`):
a held/signal symbol inside a `live_enabled=TRUE AND active=TRUE` strategy's universe now surfaces
that strategy's readiness trace instead of falling through to unattributed. Three compute-fan-out caps
bound the new attribution. All three are read **live** via `self._cfg.get_int(...)` (F-07), with **no
config-service seed migration** — mirroring the existing `analysis.opportunity.*` no-seed pattern (the
keys resolve to the code defaults below until an operator sets them).

| Key | Type | Default | Description |
|---|---|---|---|
| `analysis.opportunity.max_live_strategies_per_symbol` | int | `5` | Per-symbol cap: how many live-enabled strategies may **newly** attribute to one symbol via live-coverage (candidate-creation sites only; tagging an existing curated row is uncapped). Tiebreak `created_at` ascending. AC-7. |
| `analysis.opportunity.max_live_only_symbols_per_compute` | int | `20` | Cap on distinct **non-held** signal+live-covered symbols that get a new candidate row per compute pass. Composes multiplicatively with the per-symbol cap. AC-8. |
| `analysis.opportunity.max_live_held_symbols_per_compute` | int | `20` | Cap on distinct **held** symbols that may receive a new live-only strategy attribution per compute pass (does not bound the held-row count itself). AC-9. |

Compound worst case at defaults: `5 × (20 + 20) = 200` newly-attributed live rows across the two
disjoint pools — no single key is *the* row ceiling.

### feature 129 — fundamentals-provider-alternative (`xstockstrat-marketdata`)

Adds Finnhub as a second `source.FundamentalsSource`, switchable-not-replacing FMP via
`marketdata.fundamentals.provider` (read once at boot). FMP's `marketdata.fmp.*` keys (feature
059, below) are unchanged and still fully functional; Finnhub's quota shape is a rolling
window (`symbols_per_minute` / `rate_window_seconds`) rather than FMP's fixed UTC-day cap,
since Finnhub's real limit is per-minute, not per-day.

| Key | Type | Default | Description |
|---|---|---|---|
| `marketdata.finnhub.enabled` | bool | `false` | Master gate for the Finnhub fundamentals source; off by default |
| `marketdata.finnhub.base_url` | string | `https://api.finnhub.io/api/v1` | Finnhub API base URL |
| `marketdata.finnhub.cache_ttl_hours` | int | `24` | Hours a cached fundamentals row stays fresh before a re-fetch is attempted |
| `marketdata.finnhub.symbols_per_minute` | int | `20` | Max distinct symbols fetched per rolling `rate_window_seconds` window (derived from Finnhub's ~60 calls/min free tier ÷ 3 calls/symbol) |
| `marketdata.finnhub.rate_window_seconds` | int | `60` | Rolling window (seconds) `symbols_per_minute` applies over |
| `marketdata.fundamentals.provider` | string | `finnhub` | Selects the active fundamentals source (`finnhub` \| `fmp`); read once at boot, not live |

### feature 102 — broker-state-reconciliation (`xstockstrat-trading`)

A lightweight periodic ticker (`StartReconciliationPoller`/`reconcileTick`) compares open orders/
positions against broker truth, self-heals benign propagation-delay drift, and halts on a genuine
mismatch (reusing feature 030's per-account halt mechanism, `HaltSource_HALT_SOURCE_RECONCILIATION`)
or escalates to feature 100's platform-wide `platform.trading_state=REDUCE_ONLY` on a rare systemic
finding. Both keys follow 101's own established "no config-service seed migration" pattern — read
live via `s.cfgW.GetFloat`/`GetInt` with the default supplied in Go code.

| Key | Type | Default | Description |
|---|---|---|---|
| `trading.reconciliation.interval_ms` | float | `60000` | Interval for the reconciliation poller (`reconcileTick`). Read live on every cycle. |
| `trading.reconciliation.grace_ticks` | int | `1` | Consecutive ticks a mismatch must persist before it's a real finding (not a benign propagation delay). |
| `trading.reconciliation.systemic_threshold_pct` | float | `0.5` | Share of accounts erroring/unprotected in one tick that escalates to `platform.trading_state=REDUCE_ONLY`. |

### feature 030 — stop-loss-bracket-orders (`xstockstrat-trading`, `xstockstrat-config`)

Automatic stop-loss/take-profit bracket orders on auto-sized entries (feature 023's `ComputePositionSize`
stop price becomes the bracket stop leg). `bracket_orders_enabled` seeds `false` in production (not the
product spec's literal `true` default) pending feature 103 or a documented manual paper-account
verification — see `docs/roadmap/features/030-stop-loss-bracket-orders/design.md` § Rejected
Alternatives. A protection-window watchdog (`StartBracketProtectionWatchdog`) flattens the position and
halts the account (persisted `broker_accounts.halted`) if a bracket is not confirmed `ACTIVE` within
`max_unprotected_seconds` of entry fill.

| Key | Type | Default (dev) | Default (production) | Description |
|---|---|---|---|---|
| `trading.risk.bracket_orders_enabled` | bool | `true` | `false` | Master gate for automatic stop-loss/take-profit bracket orders on auto-sized entries |
| `trading.risk.take_profit_rr_multiple` | float | `2.0` | `2.0` | Reward-to-risk multiple for the take-profit leg; `0` disables the take-profit leg |
| `trading.risk.max_unprotected_seconds` | int | `30` | `30` | Provisional default — max seconds an auto-sized position may remain without a confirmed bracket before automatic flatten+halt |

### feature 023 — position-sizing-engine (`xstockstrat-trading`)

`ComputePositionSize` computes order quantity from account equity, ATR(14)-based stop distance,
signal confidence, and a portfolio concentration cap, activated whenever `PlaceOrder` receives
`qty <= 0`. The pre-existing warn-only `trading.risk.max_position_pct` (5%, `checkPortfolioRisk`)
is unchanged and coexists — it covers override-mode (explicit-qty) orders, which never reach the new
enforcing cap below.

| Key | Type | Default | Description |
|---|---|---|---|
| `trading.risk.max_risk_per_trade_pct` | float | `0.02` | Fraction of equity to risk per trade (auto-sized orders only) |
| `trading.risk.atr_multiplier` | float | `1.5` | Stop distance as a multiple of ATR(14) |
| `trading.risk.max_concentration_pct` | float | `0.10` | Max fraction of equity in any single auto-sized position (enforcing) |
| `trading.risk.sizing_enabled` | bool | `true` | Master gate; `false` rejects orders submitted without an explicit `qty` |

### feature 101 — exactly-once-order-intent (`xstockstrat-trading`)

Durable order-intent dedup + `UNKNOWN` uncertainty tracking for `PlaceOrder`/`ReplaceOrder`/
`CancelOrder`. Both keys follow the established local precedent of every other `trading.*` key
today: read live via `s.cfgW.GetFloat`/`GetInt` with the default supplied in Go code, no
config-service seed migration.

| Key | Type | Default | Description |
|---|---|---|---|
| `trading.order_intent.stale_multiplier` | float | `3.0` | Multiplier applied to `max(live trading.broker.timeout_ms, IBKRRequestTimeout)` to derive the PENDING-intent staleness threshold; floor-clamped in code to ≥1.5. |
| `trading.order_intent.sweep_interval_ms` | int | `5000` | Interval for `StartOrderIntentSweeper`'s proactive orphaned-`PENDING`-intent reclaim loop. |

### feature 100 — account-trading-halt-and-kill-switch (`xstockstrat-trading`, `xstockstrat-config`)

A new parallel config key, independent of the existing `platform.maintenance_mode` boolean
(which stays untouched — widening it in place was rejected as a confirmed fail-open bug on a
proto oneof type mismatch). Seeded per `trading_mode` (paper/live independently), not `all`, so
an operator can halt live trading during an incident while paper testing continues unaffected.

| Key | Type | Default | Description |
|---|---|---|---|
| `platform.trading_state` | string | `ACTIVE` | `ACTIVE` \| `REDUCE_ONLY` \| `HALTED`. Enforced in `xstockstrat-trading`'s `PlaceOrder`/`ReplaceOrder`; `CancelOrder` deliberately ungated. Write-time validated to the three literals in `xstockstrat-config`'s `SetConfig`. |

### feature 097 — opportunity-universe-unification (`xstockstrat-analysis`)

Config surface for the materialized opportunity queue (lazy compute-on-read + stale-while-revalidate + a daily refresh). The queue's independent signal ranking axis is the new scalar `analysis.opportunity.signal_rank_weight`. (Feature 134 note: `analysis.signals.source_weights` was **superseded** — per-source reliability weight lives on `ingest.SignalSource.reliability_weight` and both analysis read paths, the queue and the screener, read it via `ListSignalSources`. The key was then **removed entirely by feature 161** (migration 020), along with the config-service FLOAT_MAP validation machinery it was the sole consumer of.)

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
| `analysis.fundsignal.startup_jitter_seconds` | int | `30` | One-shot `[0, N]`s jitter at producer loop entry to stagger concurrent redeploys (feature 156); presence-aware (`0` disables) |
| `analysis.fundsignal.retry_seconds` | int | `300` | Caught-cycle-error retry backoff for the durable schedule's `blocked_until_ms` (feature 156); presence-aware |

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
