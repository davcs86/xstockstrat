# Product Spec: fix-python-config-zero-trap

**Type**: bug
**GitHub Issue**: none. Defect report: `docs/reports/2026-10-19-python-config-zero-trap-defect.md`
**Severity**: SEV-2
**Created**: 2026-10-20

---

## Problem Statement

**Observed.** `ConfigWatcher.get_int` / `get_str` / `get_float` return `v.<x>_val or default` in all three Python
services (`services/xstockstrat-indicators/app/config/watcher.py:96,114,130`;
`services/xstockstrat-ingest/app/config/watcher.py:110,118,144`;
`services/xstockstrat-analysis/app/config/watcher.py:97,105,134`). A stored `0`, `0.0` or `""` resolves to the
in-code default, although `config.ConfigValue` is a `oneof` that distinguishes zero from unset and `get_bool`
already uses `HasField`. Analysis and ingest have per-key `get_int_present` (analysis also `get_float_present`);
indicators has only `get_str_present`. Swallowed analysis keys where 0 is legitimate:
- `analysis.backtest.default_commission_pct` 0 → 0.001 and `default_slippage_pct` 0 → 0.0005
  (`services/xstockstrat-analysis/app/handlers/servicer.py:787-788`);
- `analysis.opportunity.signal_rank_weight` 0 → 0.3 (`servicer.py:4615`), although config bounds allow 0 and the
  bounds comment claims "the getter honors a legitimate 0" (`services/xstockstrat-config/src/grpc/configServiceImpl.ts:115-116,120`);
- `analysis.engine.alert_throttle_seconds` 0 → 300 (`services/xstockstrat-analysis/app/engine/live_loop.py:351`).

**Expected.** Numeric and string getters honour a stored zero value via `HasField` (as `get_bool` and the Node
`??` getter do). Call sites where a stored 0 is unsafe or documented as trap-dependent keep today's result through
an explicit clamp (FR-3 inventory), e.g. ingest's backfill semaphores (`asyncio.Semaphore(0)` deadlock,
`services/xstockstrat-ingest/app/handlers/servicer.py:323,749`).

**Affected:**
- operators/admins who set config through `/config-ui` or the agent `set_config` tool: a deliberate `0`/`""` is
  silently replaced by the default;
- traders/analysts who read backtest P&L (`/insights` backtest view, agent `run_backtest`) and the agent
  `list_opportunities` default order: a zero-cost backtest or a conviction-only default order cannot be configured;
- alert recipients (`/trader` alert stream, `/accounts/notifications` inbox and push): live-loop alert throttling
  cannot be switched off with `alert_throttle_seconds = 0`.

## Reproduction Steps

1. `SetConfig analysis.opportunity.signal_rank_weight = 0` (accepted: bounds `[0,1]`).
2. Call `ListOpportunities`; ranking still blends signal rank at weight 0.3.
3. `SetConfig analysis.backtest.default_commission_pct = 0` with `create_key=true` (no migration seeds the key,
   existence gate `configServiceImpl.ts:466-469`) and run `RunBacktest`; commission 0.001 is applied.

## Root Cause Hypothesis

Truthiness `or default` was written for the unset case and conflates it with a zero value. The fix was applied per
key (`get_int_present` / `get_float_present`), leaving most keys trapped.

**Prior work: feature 173 (launched, same slug).** 173 fixed three keys per key and rejected a blanket accessor
swap because it would un-clamp the `ingest.mcp_client.*` keys and need new clamps
(`docs/roadmap/features/173-fix-python-config-zero-trap/context.md:10`). What changed: the trap now reaches the
report's analysis keys across three services, and the operator decision of 2026-10-20 directs a blanket `HasField`
switch with an explicit clamp at every trap-dependent site (FR-3). The decision is recorded verbatim in `context.md`
(Session 2026-10-20, sdd-review product-spec, "Operator decisions"). Design records the trade-off against 173's
rationale (C-18).

## Affected Services

- xstockstrat-analysis
- xstockstrat-indicators
- xstockstrat-ingest
- xstockstrat-config: `SCALAR_BOUNDS_REGISTRY` re-check and the bounds comments that describe the trap
  (`configServiceImpl.ts:111,115-117`), FR-6

## Consumer Surface(s)

No surface changes request or response shape. Each surface below is reached through an RPC whose behaviour this
feature changes, so `/sdd-spec` gives each a verification step.
- [x] **Agent**: `run_backtest` (`services/xstockstrat-agent/app/tools.py:715`). With zero-cost config, returned
  trades carry unslipped fill prices and cost-free `pnl` (FR-4). Pass-through, no code change.
- [x] **Agent**: `list_opportunities` (`tools.py:1518`). It sends no sort, so the default sort
  (`app/repositories/opportunities.py:36-40`) follows the stored `signal_rank_weight`, including 0 (FR-4).
  Pass-through, no code change.
- [x] **Agent**: `set_config` (`tools.py:1642`). A `0`/`""` written to an FR-4 key or an unclassified key now takes
  effect; FR-3 keys keep today's result. No config migration seeds `default_commission_pct`, `default_slippage_pct`
  or `alert_throttle_seconds`, so the first write needs `create_key=true` with the matching `value_type`
  (`tools.py:1655-1662`). `/sdd-spec` verification steps include that write. Pass-through, no code change.
- [x] **UI**: `/insights` backtest view (`services/xstockstrat-ui/src/app/insights/strategies/[id]/page.tsx`).
  Pass-through, no code change. The `/insights` opportunities queue is not reached: it always sends an explicit
  sort (`src/hooks/useOpportunities.ts:29` defaults to CONVICTION; `src/app/insights/opportunities/page.tsx:101-106`
  maps only CONVICTION, SYMBOL_SCORE and EXPIRY), and `signal_rank_weight` feeds only sort 0.
- [x] **UI**: `/trader` alert stream (`src/components/trader/AlertStream.tsx`) and `/accounts/notifications` inbox and
  push (`src/app/accounts/notifications/AlertInbox.tsx`, `PushToggle.tsx`). With `alert_throttle_seconds = 0` a
  repeat live-loop transition alerts again (FR-4, @AC-9). Pass-through, no code change.
- [x] **UI**: `/config-ui` key editor (`src/app/config-ui/[namespace]/NamespaceEditor.tsx:71-76` renders each row's
  seeded description). The seeded descriptions at
  `services/xstockstrat-config/migrations/028_analysis_opportunity_keys.up.sql:46,49` ("0 is not honored - reads as
  the 0.3 default (get_float)") become inaccurate. `027_analysis_readiness_materializer_keys.up.sql:50,53` stay
  behaviourally true under the FR-3 clamp and only name the wrong mechanism.
  `/sdd-design` decides whether a new config migration corrects them (this adds the DB-migration gate) or they stay,
  and records the outcome in `design.md`.
- [ ] **None**

## Functional Requirements

- **FR-1**: In all three Python `ConfigWatcher`s, `get_int`, `get_float` and `get_str` return the stored value
  whenever the `ConfigValue` oneof holds that member (`HasField`), including `0`, `0.0` and `""`.
- **FR-2**: A missing snapshot, a key absent from the snapshot, or a value holding a different oneof member still
  resolves to the caller's default.
- **FR-3**: Every trap-dependent call site resolves a stored `0`/`""` to the coded default, as today, through an
  explicit clamp at the read (no clamp is needed where the coded default is itself 0, e.g. `default_fill_model`).
  Existing `max(1, …)` negative guards stay. Recon checks the inventory below against every
  `get_int`/`get_float`/`get_str` call in the three services. A site joins FR-3 when a stored 0/`""` would deadlock
  or busy-loop, drop a resource guardrail, degenerate a computation or halt a loop, or when a service `CLAUDE.md`
  documents it as trap-dependent. Every other site honours the stored value.
- **FR-4**: The report's swallowed keys take effect at 0: `analysis.backtest.default_commission_pct` and
  `default_slippage_pct` (`servicer.py:787-788`, applied at `:196-214`); `analysis.opportunity.signal_rank_weight`
  (`servicer.py:4615` `_read_opportunity_queue` → default-sort blend `app/repositories/opportunities.py:37-38`, clamp
  `:224`; the `:4859` `_retry_unavailable_symbols` heal read takes the same value and has no ordering effect);
  `analysis.engine.alert_throttle_seconds` (`live_loop.py:351`, check `:815`; 0 = no throttle).
- **FR-5**: No seeded row changes its effective value, and no clamp floors a key whose coded default is 0. Audited
  fact at review (recon re-runs it): every seeded `0`/`''` analysis row equals its call-site default
  (`027_…:37,40` and `028_…:51,54`, `refresh_hour_utc` = 0, read via `get_int_present` at `servicer.py:5872,5938`).
  The `008_analysis_fundsignal_keys.up.sql:22-23,34-35,43-44` rows are stored namespace-relative
  (`fundsignal.*`), and 029 heals only `platform`/`trading`/`portfolio`/`marketdata`
  (`029_heal_config_keys_full_dotted.up.sql:28`), so they never reach the `analysis.fundsignal.*` reads. Indicators
  and ingest have no seeded `0`/`''` rows.
- **FR-6**: `SCALAR_BOUNDS_REGISTRY` (`configServiceImpl.ts:100-146`) is re-checked against FR-1. No `minValue` on a
  Python-read key is lowered: a `minValue: 1` row still rejects 0, which the getter would now honour. The comments
  at `:111` and `:115-117` are corrected. No new bounds rows are required because FR-3 guards at the read.
  Ownership split with 243-fix-sandbox-seed-keys: 244 owns the FR-3 read clamp for all three `indicators.sandbox.*`
  int keys, including `max_concurrent`, which 243 excludes (`243-fix-sandbox-seed-keys/product-spec.md:61`). Any
  bounds rows for `indicators.sandbox.timeout_ms`/`memory_bytes` are 243's design decision; `max_concurrent` gets
  none (guarded at the read).

### FR-3 inventory (known minimum; recon completes it)

| Service | Key(s) | Read site | Stored 0 / `""` after a bare `HasField` switch |
|---|---|---|---|
| ingest | `ingest.backfill.max_concurrent_jobs`, `max_concurrent_chunks` | `app/config/watcher.py:184-187,207-210` → `handlers/servicer.py:323,749` | `asyncio.Semaphore(0)` deadlock |
| ingest | `ingest.backfill.chunk_max_bars`, `chunk_window_days` | `watcher.py:199-204` → `repositories/backfill_chunks.py:51-52` | 1-bar / 1-day chunks |
| ingest | `ingest.mcp_client.request_timeout_seconds`, `poll_interval_seconds` | `app/engine/mcp_client_loop.py:133-138,162-167` | 1 s instead of 30 s / 300 s |
| indicators | `indicators.sandbox.timeout_ms`, `memory_bytes`, `max_concurrent` | `app/config/watcher.py:133-148` → `handlers/servicer.py:102,277-278,303`; `services/sandbox.py:282,345-346` | immediate timeout; no `RLIMIT_DATA` cap (`if memory_bytes > 0`); `Semaphore(max(1, 0))` = 1 and `RLIMIT_NPROC` 0 instead of 4 / 64 |
| analysis | `analysis.engine.eval_interval_seconds` | `app/engine/live_loop.py:329-330` | `asyncio.sleep(0)`: live-loop busy loop; no bounds row, so SetConfig accepts 0 |
| analysis | `analysis.strategy.max_concurrent_entry_backfill` | `app/engine/entry_backfill.py:56-57` | `max(1, 0)` = 1 instead of 4 |
| analysis | `analysis.fundsignal.run_interval_hours` | `app/engine/fundsignal_loop.py:137-138,148-151` | `max(1, 0) * 3600`: 1 h instead of 24 h |
| analysis | `analysis.engine.fundamentals_blend_strategy_id` (string) | `handlers/servicer.py:353-355` (`blend_strategy_id`, sole reader) | blend force-run and admin guard key on `""`; analysis `CLAUDE.md:494` documents empty ⇒ code default |
| analysis | `analysis.fundsignal.source_slug` (string) | `live_loop.py:162`; `fundsignal_loop.py:171` | producer emits under, and the live loop filters on, an empty source slug |
| analysis | `analysis.backtest.portfolio_position_weight` | `handlers/servicer.py:1154` | zero-size positions (analysis `CLAUDE.md:472`) |
| analysis | `analysis.backtest.portfolio_max_concurrent`, `analysis.series.max_concurrent_components`, `analysis.opportunity.max_concurrent_bars_fetches`, `analysis.opportunity.max_concurrent_candidates`, `analysis.compute.max_worker_threads`, `analysis.readiness_materializer.max_concurrent_bars_fetches`, `analysis.screener.max_concurrent_formula_evals` | `servicer.py:1157,538,543,549,556,585`; `services/screener.py:85` | `max(1, 0)` = 1 instead of the default |
| analysis | `analysis.backtest.detail_retention_per_strategy` | `servicer.py:2914` | retention 1 instead of 20 |
| analysis | `analysis.screener.max_duration_seconds` | `servicer.py:3786` | `wait_for(timeout=0)`: every `ScreenSymbols` returns DEADLINE_EXCEEDED |
| analysis | `analysis.engine.max_strategies_per_cycle` | `app/engine/live_loop.py:350,430-432` | live loop evaluates nothing |
| analysis | `analysis.strategy.default_cooldown_days` | `live_loop.py:748`; `servicer.py:1167,2130` | no platform cooldown instead of 31 (analysis `CLAUDE.md:488`) |
| analysis | `analysis.scoring.shrinkage_days` | `servicer.py:2672` | no shrinkage instead of 250 (analysis `CLAUDE.md:479`) |
| analysis | `analysis.backtest.default_fill_model` | `servicer.py:789-795` | unchanged: the default is 0 (legacy), so only the comment changes |

Recon classifies these reads against the FR-3 join rule (not yet in the inventory): `analysis.fundsignal.daily_call_budget`,
`max_symbols_per_run`, `valid_days` (`fundsignal_loop.py:222,181,232`); `analysis.screener.max_universe_size`,
`default_rank_limit` (`app/services/screener.py:92,177-178`); `analysis.snapshot.indicator_timeout_ms`,
`signal_timeout_ms` (`app/engine/pnl_pattern_consumer.py:364-365`); `analysis.backtest.max_range_days`
(`servicer.py:874`); `analysis.patterns.min_sample_count`, `indicator_bucket_count` (`servicer.py:4265-4266`).

Dead sandbox-helper copies in the analysis and ingest watchers (`analysis watcher.py:150-162`,
`ingest watcher.py:168-180`) follow FR-3 or are removed. Design decides which.

## Fix Scope

- [x] No proto changes anticipated (`ConfigValue` oneof already distinguishes zero from unset)
- [x] No database migrations anticipated, unless design corrects the seeded descriptions (Consumer Surface,
  `/config-ui`). If it does, the config NNN is pre-assigned with 243-fix-sandbox-seed-keys, which claims 031
  (`243-fix-sandbox-seed-keys/product-spec.md:44`), through a `docs/roadmap/features/merge-order.md` row (C-07, F-01).
- [x] Config bounds re-checked per FR-6; no new keys
- [x] Trap-dependent sites keep today's result through explicit clamps (FR-3 inventory)
- [x] Pre-deploy audit (rollout): `SCALAR_BOUNDS_REGISTRY` checks writes only (`configServiceImpl.ts:99`), so a `0`/`''`
  already stored while the trap hid it takes effect on deploy. Before each deploy (dev, then prod), list stored
  `0`/`''` rows in `config.config_values` for the `analysis`, `indicators` and `ingest` namespaces, classify each
  against FR-3/FR-4, and record the result in `context.md`.
- [x] Doc updates for the new semantics: config-key rows in
  `services/xstockstrat-analysis/CLAUDE.md:472-474,479,482-483,486,488-489,500,519,529,537`;
  `services/xstockstrat-ingest/CLAUDE.md:124,127,130-133`;
  `services/xstockstrat-indicators/CLAUDE.md:100-103` (243 rewrites the same rows; the second to land rebases);
  `docs/patterns/config-governance.md:252-259,458-461,705,713,721`; `docs/context-constitution.md:59`;
  `docs/context-constitution-findings.md:32` (CF-N10); `services/xstockstrat-analysis/docs/context-constitution.md:37`;
  the call-site comments at `servicer.py:789-790,1152-1153,2912-2913` and ingest `watcher.py:185-186,208-209`. Close
  with the context-forge teardown.
- [x] Durable C-16 suites preserved: `services/xstockstrat-ingest/acceptance/fix-python-config-zero-trap.feature` and
  `services/xstockstrat-indicators/acceptance/fix-python-config-zero-trap.feature` (feature 173) name
  `get_int_present`/`get_str_present`; `services/xstockstrat-config/acceptance/opportunity-config-operability.feature`
  @AC-8 accepts `signal_rank_weight = 0`. Their rules hold under this fix. Design records that, and rewords the 173
  suites if it removes the `*_present` accessors.

## Acceptance Criteria

See `acceptance.feature` (Constitution **C-15**). The FR-1/FR-4 scenarios (@AC-1, @AC-2, @AC-3, @AC-9) fail on the buggy
behaviour and pass after the fix. The FR-2/FR-3/FR-6 scenarios (@AC-4, @AC-5, @AC-6, @AC-8) pass before and after,
and fail if the fix is too broad (a site left unclamped). The FR-5 scenario (@AC-7) passes before and after, and
fails if clamping is too broad (a floor applied to a zero-default key). In addition, existing tests pass, except
assertions that pin the trap (e.g. `services/xstockstrat-analysis/tests/test_analysis_servicer.py:594`), which are
updated to the new semantics.
Affected services are smoke-tested on dev.

## Out of Scope

- Go and Node config getters (not reported as trapped)
- Request-field `or` fallbacks such as `request.timeout_ms_override or …` (indicators `servicer.py:277-278`)
- Refactoring unrelated to the bug
- Performance improvements unrelated to the fix
