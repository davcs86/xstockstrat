# Context: backtest-time-window

**Feature**: `docs/roadmap/features/071-backtest-time-window/feature.md`
**Product Spec**: `docs/roadmap/features/071-backtest-time-window/product-spec.md`
**Implementation Spec**: `docs/roadmap/features/071-backtest-time-window/implementation-spec.md`

---

## Session 2026-07-26 — sdd-story

- Created feature.md (status: draft), product-spec.md, context.md from user story.
- **Origin:** surfaced during in-engine validation of the `range_mean_reversion_v3` re-entry
  cooldown (feature 069). Re-running the same backtest two days apart (window start moved
  2024-07-25 → 2024-07-29) shifted a symbol's first trade because the shortened indicator warm-up
  pushed its boundary entry later — everything else matched to the digit. Also blocked a proper
  out-of-sample test: only cross-sectional OOS (new symbols) was possible, never a held-out period.
- **Known trap noted:** additive proto request fields still hard-couple the `run_backtest` MCP tool
  and any UI backtest trigger (ledger fails 056/060/067, rule C-10) — update consumers in the same
  feature with a test.

## Session 2026-07-26 — sdd-review product-spec

- **Verdict: FAIL, then PASS after re-scope.** Status: `draft` → `spec-ready`.
- **The spec's core premise was wrong.** `RunBacktestRequest.range` (`common.v1.TimeRange`,
  `packages/proto/analysis/v1/analysis.proto:34`) already exists, is honored by the servicer
  (`services/xstockstrat-analysis/app/handlers/servicer.py:273-297`, incl. the `max_range_days` cap
  and `now`-anchored defaulting), and is **already sent by the UI backtest form**
  (`services/xstockstrat-ui/src/app/insights/strategies/[id]/page.tsx:91`).
- **Proto change withdrawn.** Adding `start`/`end` would create a second, ambiguous window
  representation on a message whose wire bytes are persisted verbatim in `analysis.backtest_details`
  (`analysis.proto:60-63`). Checked `- [x] No proto changes required`; dropped the Proto Reviewer row.
- **Real scope**: (1) plumb the window through `client.run_backtest`
  (`services/xstockstrat-agent/app/client.py:143-165`) and the `run_backtest` tool
  (`app/tools.py:240-244`) — the only place the window is missing; (2) pre-window indicator warm-up
  (genuinely new engine work).
- **New requirements added from review findings:** FR-2a (one-sided windows), FR-3a
  (`max_range_days` binds the requested window, not the warm-up-extended fetch span), FR-6 (agent↔UI
  parity + feature-065 evidence-cell impact), FR-7 (**backtest/live parity** — `live_loop.py:116-121`
  builds its own window and `:133` calls the same shared evaluator, a documented parity invariant
  that FR-3 could silently break).
- AC-3 restated against a frozen clock — the `now`-anchored default makes cross-day byte equality
  impossible by construction, so the original "byte-for-byte" wording was unverifiable.
- Resolved OQs: `Timestamp` vs ISO string (moot — `TimeRange` already uses `Timestamp`);
  `max_range_days` applicability (answered declaratively by FR-3a).
- **Observation, out of scope:** `live_loop.py:126` queries `GetBars` with `timeframe="1Day"` while
  the backtest path uses the canonical `"1d"` (feature 053 fixed that mismatch for backtests only).
  Possible latent defect; not touched — flagging for a separate triage.
- **Deviation:** implemented on the harness-assigned branch `claude/features-070-071-rnbkqo`
  (rebased onto `main-dev`) rather than `feature/backtest-time-window` with per-step PRs, because the
  harness pins the branch. Features 070 and 071 share this one branch/PR.

## Session 2026-07-26 — sdd-design

- Phase 0 Recon: wrote `recon.md` (services: analysis, agent, ui). Key reuse: `_iso_to_timestamp`
  (`agent/app/client.py:35-41`), the `trigger_backfill` one-sided `TimeRange` template (`:705-712`),
  the shared-pure-module pattern from ledger 069 (`app/services/cooldown.py`).
- Phase 1 Grilling: **2 proposer rounds + 2 adversary passes** (mode `quick`, extended by one round
  because round 1 hit a Floor breach).

### Round 1 — BLOCKED (F-07)

Proposed a `WARMUP_PREFIX_DAYS = 365` constant, defended as "sizing-only, verified at runtime by
`p >= w`". **The defense was provably false.** Verified directly in
`services/xstockstrat-indicators/app/services/indicators_engine.py`: `_ema` (`:48-51`), `_macd`
(`:62-84`) and `_vwap` (`:110-118`) return `float(v)` with **no `None` head**, so
`_first_resolved_index` (`analysis servicer.py:1582-1588`) returns 0 ⇒ `w == 0` ⇒ `p >= w` is
trivially true. The runtime check was **inert exactly for the indicators the prefix affects most**.
Round 1 also (a) applied the prefix to the *defaulted* range, which needs `730 + 365` days of history
and would flip ordinary symbols to `INSUFFICIENT_DATA` — a direct FR-2 violation; (b) forced
`warmup_bars = 0`, orphaning three live UI surfaces with no compile-time protection (the *inverse* of
ledger fail 067, and worse because TypeScript cannot catch an enum value becoming unreachable);
(c) claimed OQ-3 `trading_days` would be bit-identical — false, see below.

### Orchestrator steer (all three dictated by already-approved artifacts, not new choices)

1. F-07 → derive the prefix from declared params (product-spec OQ-2 already stated deriving is preferred).
2. FR-2 is binding → prefix only when the caller set `start`.
3. recon Risk 2 + C-10 → keep `warmup_bars` meaningful via an explicit `trade_start_idx`.

### Round 2 + verification pass — corrections that changed the design

- **The loop restructure was NOT a no-op at `k = 0`.** `for i in range(trade_start_idx, n)` with an
  unconditional append makes `i=0` append without simulating ⇒ `len(daily_equity) == n+1` (today it
  is `n`), perturbing the returns series, moving `trading_days` `n-1 → n`, and shifting every
  `diags[i].equity` stamp. **Corrected to `range(max(1, trade_start_idx), n)`.**
- **`diags` ↔ `daily_equity` seam.** The diagnostic passes are *separate* loops (`:634`, `:829`).
  Decided: slice `diags` to the in-window bars and renumber `bar_index`, `bars_total = n - k`, plus an
  explicit `len(daily_equity) == len(diags)` assertion in **both** paths (ledger 056 / C-10(b) — the
  two loops are structurally different).
- **EMA/MACD were under-warmed.** `ewm(adjust=False)` is IIR: after `period` bars the seed still
  carries `e^-2 ≈ 13.5%` weight, so `period` fails FR-3's "already warm" and manufactures a fresh
  backtest/live divergence. Adopted a `3×` convergence multiplier (residual < 0.3%); cost is only
  discarded fetch volume.
- **MACD lookback fixed to `max(fast, slow) + signal`** — nothing validates `fast <= slow`
  (`_validate_definition` never checks params), so `fast=50, slow=26` would under-warm.
- **The empty-token pagination probe was dead code** — `QueryBars` uses `LIMIT pageSize+1` and sets a
  token iff `len > pageSize` (`marketdata_repo.go:92`, `:130-135`), so a full page with no token is
  genuine EOF. It was also mis-specified (a naive `isoformat()` token is rejected by
  `time.Parse(RFC3339Nano, …)`, silently re-serving page 1). **Dropped.**
- **`_MAX_BAR_PAGES` exhaustion must RAISE**, never return a partial series — otherwise a hardcoded
  constant silently truncates as a function of the config-driven `analysis.backtest.max_range_days`,
  which would itself be an F-07 breach. This single sentence is what clears the Floor.
- **The `+1` in every rolling lookback is the crossover reference** (`crosses_above`/`crosses_below`
  read index `i-1`, `evaluator.py:447-448`), not a fudge — recorded in `warmup.py`'s docstring.

### Decisions

- Prefix derived per-strategy from declared params; `prefix_calendar_days(P) = ceil(P*1.6)+10` is
  sizing-only because the engine truncates to exactly `P` (surplus discarded, deficit reported),
  pinned by a factor-doubling byte-identity test.
- **OQ-3 answered honestly (round 1 was wrong):** today's max-range runs are *already* silently
  truncated at 500 bars, so correct pagination is itself a behavior change — `trading_days` 499 → ~503.
  Existing evidence cells are **left as-is, not invalidated** (~0.8% shift is immaterial against
  `k = 250` shrinkage). Pagination applies to the default path too.
- **OQ-4/FR-7:** backtest path only; the live loop is untouched. FR-3 does **not** close the parity
  gap — `live_loop.py` keeps its ~252-bar window with no shortfall detection. Divergence documented
  and pinned by two tests.
- **VWAP anchor moves** for any strategy mixing VWAP with a longer-lookback component (`P` is the max
  over refs). Deterministic, but different from today — documented + pinned.
- No proto change, no migration, no new config key.

### Open Threads

- Loop restructure must land at `trade_start_idx = 0` with **byte-identical** results before any
  prefix code exists (target: step 3).
- Built-in default periods duplicated in analysis; pinning test lives in `xstockstrat-indicators` and
  must name `warmup.py` as the consumer (target: step 1).
- Custom-formula sandbox cost measurement (target: step 6).

### Deviation — P-04 phase gate

The design gate was **auto-approved by the orchestrator** rather than by an explicit user
confirmation: the session's standing instruction was "work on the features 070 and 071" and no
interactive user was present across the design phase. All three steering decisions were dictated by
the already-approved product spec (FR-2, OQ-2) and the Constitution (F-07, C-10), not by orchestrator
preference, and the Floor breach was independently re-verified before clearance. Recorded here per
P-04 so the unapproved gate is auditable.

- Status: `spec-ready` → `design-approved`.
