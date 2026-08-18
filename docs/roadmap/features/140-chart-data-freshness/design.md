# Design: chart-data-freshness

**Created**: 2026-08-18
**Rounds**: 2 (quick mode upgraded to a 2nd round at the user's request; termination: approved — round 2 surfaced the FR-7 root cause, folded in by user decision)
**Approved by**: user @ 2026-08-18
**Grounded in**: recon.md

---

## Chosen Approach

Five surgical changes across three services — **zero proto, zero migration, zero new config key**
(only config-default changes + additive logic). Build order: **FR-7 → FR-2 → FR-3 → FR-1 → FR-6**.

### FR-7 (marketdata, PRIMARY) — `GetBars` returns the newest page for implicit-window requests
The root cause (recon § ROOT CAUSE): `QueryBars` cursors from `start` and returns `ORDER BY time ASC
LIMIT pageSize` (`marketdata_repo.go:74-91`), i.e. the **oldest** page of a `pageSize × interval × 3`
window (`marketdata_service.go:228-238`). Fix: add a repo method
`QueryRecentBars(ctx, symbol, tf, end, pageSize)` = `SELECT … WHERE symbol=$1 AND timeframe=$2 AND
time <= $3 ORDER BY time DESC LIMIT $4`, then **reverse the rows to ascending** in Go (lightweight-
charts requires ascending). In `GetBars`, when the caller supplied **no explicit range start**
(`startImplicit := req.Range == nil || req.Range.Start == nil`, computed before the `:158-164`
default) **and** `pageToken == ""`, call `QueryRecentBars` instead of the windowed `QueryBars`; no
forward `nextToken` is needed (these are already the newest). Explicit-range / paginated callers
(backtest via `_fetch_bars_paged`) keep the existing `QueryBars` path byte-for-byte. **Consumer
surface (C-14):** reaches `/trader` charts through the existing `GetBars` RPC (no new surface); also
un-breaks the analysis screener (`screener.py:198-206`), which passes no range and today reads the
oldest ~500 bars.

### FR-2 (marketdata) — always-on ingester keeps `1d` fresh
Flip `const defaultBarIngestTimeframe "15m" → "1d"` (`marketdata_service.go:511`; the only value
`resolveIngestTimeframe` returns for an unset key, read at `:549`). Widen lookback default `900000 →
345600000` (4 days) at `:550` and its re-clamp; drop the ingest interval default `60000 → 300000` (5
min) at `:484`. Safe per recon's OQ-1 verdict: **no automated consumer reads stored `15m` bars** (all
programmatic `GetBars` callers hardcode `1d`), and the legacy `StreamBars` path persists nothing
(`stream.go:29`). **Config-store guard (ledger-080):** the code-default flip is effective only if no
explicit `marketdata.stream.bar_ingest_timeframe` row exists in the config store; verified no
migration seeds it, so verify per-environment with `SELECT key,environment,trading_mode,value_data
FROM config.config_values WHERE key LIKE 'marketdata.stream.bar_ingest%';` (expect zero rows) — if a
row exists, change it via config rollout, not the const. Update the marketdata CLAUDE.md config table
+ behavioral prose (defaults, "falls back to 15m", "smallest supported interval"). Update the two
`TestResolveIngestTimeframe` subtests pinning `"15m"` (`marketdata_service_test.go:718,:725`),
red-first.

### FR-3 (marketdata) — staleness fallback beside the empty-check
Add an `else if` beside `marketdata_service.go:176-178`, inside `pageToken == ""`, gated on the
current window (`startImplicit`, same gate as FR-7 — an explicit historical range never triggers,
preserving FR-5). With FR-7 the returned bars are the newest, so `newest := bars[len(bars)-1]` is the
true global newest — **no `GetCoverage` needed**. Predicate: `interval := timeframe.Interval(tf)`
(`timeframe.go:45`); if `interval > 0 && time.Since(newest.time) > interval && staleCheckDue(sym,tf,
interval,now)` → refetch through the existing `fetchAndCacheBars` (`:191`, preserves
live→cache→re-read) and re-read via `QueryRecentBars`. `staleCheckDue` is a `map[string]time.Time` +
`staleMu` mutex (init beside `warmSymbols` `:46`) that **checks and marks atomically**, bounding both
the extra work and the Alpaca call to **1/(symbol,tf)/interval** — this is the weekend "refetch-
forever" guard. Reject the value-based guard (it deadlocks when the ingester is paused,
`bar_ingest_interval_ms <= 0`).

### FR-1 (ui) — daily auto-refresh, 5-min poll, both surfaces
`ChartPanel.tsx`: add `'1Day': 300_000` to `POLL_INTERVALS_MS` (`:23-26`); the generic interval
effect (`:77-82`) consumes it unchanged; fix the stale comments (`:22`, `:76`). Position-detail page
(`positions/[symbol]/page.tsx:149-206`): store the fetch body in a ref (`loadBarsRef`, assigned every
render to avoid a stale `avg`/`stop` closure) and add a sibling `useEffect` keyed on `[symbol]` only
with `const id = setInterval(() => loadBarsRef.current(), 300_000); return () => clearInterval(id)` —
so the timer doesn't reset on every position tick and doesn't leak on symbol change. Preserves the
`setBarSeries` indicator-overlay feed (`:165-168`) and price-line overlays (`:173-198`).

### FR-6 (analysis) — WARN on the silent empty branches (log-only, log at call sites)
Do **not** thread a `symbol` kwarg through the contract-frozen `evaluate_with_series`
(`evaluator.py:136-137`) or log inside `evaluate_conditions_traced` (`:197-198`) — the latter is also
called by the 100-symbol `_compute_opportunities` background loop (`servicer.py:2597`), so an
in-function WARN would flood + double-log. Instead:
- Live loop (`live_loop.py:440-441`): have `_eval_pair` return a **discriminated** result separating
  the no-bars branch (`:441`) from the no-decision branch (`:445`); accumulate no-bars `(strategy,
  symbol)` pairs and emit **one** summarized WARN per cycle in `_run_cycle` (`:326-334`) with a
  **bounded sample** (reuse the warm-poller aggregate shape: `n/total` + sample).
- `EvaluateReadiness` (`servicer.py:2112-2119`): WARN on the **fetch-succeeded-but-empty** path only
  (the fetch-failure WARN already exists at `:2115-2116`) — per-symbol, request-bounded.
- Screener (`screener.py:211-219`): summarized-per-scan WARN with a bounded sample, **excluding**
  symbols already logged at the `RpcError` site (`:208`).
- `_compute_opportunities` (`servicer.py:2588-2599`): documented deliberate exclusion (avoid the
  100-symbol flood); leave a comment at `evaluator.py:197` that empty-logging is the caller's
  responsibility. Backtest WARNs (`:497/:792/:1026`) unchanged. Reuse backtest `log.warning` phrasing.

## Rejected Alternatives

- **FR-3 newest via `bars[len-1]` without FR-7** — rejected: `QueryBars` is ASC-from-start, so the
  page-1 last bar is ~100 trading days stale for a backfilled symbol (round-1 adversary). FR-7 makes
  `bars[len-1]` correct; that dependency is why FR-7 lands first.
- **FR-3 newest via `GetCoverage` MAX(time)** — was the round-2 plan; superseded because FR-7 makes
  the returned bars already newest-first, so a second query is redundant.
- **Value-based staleness guard** ("skip while stored newest unchanged") — rejected: deadlocks and
  re-freezes charts when the ingester is paused; the time cooldown self-heals.
- **Change `QueryBars` to DESC globally** — rejected: breaks backtest's ascending forward pagination;
  gate the new behavior on `startImplicit` instead (isolated blast radius).
- **Shrink the `slack` multiplier 3 → ~1.4** — rejected: fragile, re-breaks the moment a symbol's
  history exceeds `pageSize` again.
- **Thread `symbol` kwarg through `evaluate_with_series` / log inside `evaluate_conditions_traced`** —
  rejected: contract churn on a parity-frozen function + floods/double-logs via `_compute_opportunities`.
- **7-day ingest lookback / keep 60s interval** — rejected: heavy write-amplification for once-a-day
  data; 4-day/5-min covers the worst-case closure with margin.
- **Notify alert on data gap (FR-6)** — rejected: steady-state gaps are low-severity; notify is
  reserved for feed-disconnect. Log-only.

## Open Risks

- [ ] **Config-store verification (FR-2)** — run the `SELECT … LIKE 'marketdata.stream.bar_ingest%'`
  against **both** dev and prod config stores; if a row exists, change via config rollout. — at FR-2 step.
- [ ] **Screener first-scan latency (FR-3)** — the screener passes no range, so FR-3's staleCheck runs
  per screened symbol; cooldown + FR-2 freshness bound it, but confirm the first-scan-of-day latency
  stays within `analysis.screener.max_duration_seconds` (120s). — at FR-3 step.
- [ ] **FR-3 intentionally dead for the live loop** — `_recent_range` sets an explicit `end`
  (`live_loop.py:423-428`) so `startImplicit` is false and FR-3 never fires there; freshness rides on
  `markWarm` + the FR-2 ingester. Record so a later reader doesn't assume otherwise. — documented at FR-3 step.
- [ ] **DST 24h approximation** — `Interval("1d")=24h` is DST-naive; at most one spurious (upsert-
  idempotent, cooldown-bounded) refetch on a 23h/25h boundary. Accepted. — noted at FR-3 step.
- [ ] **`_compute_opportunities` empty branch stays silent (FR-6)** — deliberate (flood avoidance);
  documented, not fixed. — at FR-6 step.
- [ ] **`lastStaleCheck` / `warmSymbols` unbounded growth** — matches existing `warmSymbols`
  precedent (~10k symbols × few tfs). Accepted, not introduced here. — noted at FR-3 step.

## Constitution Rules Touched

- `F-01` (no migration without gate) — honored: no schema change; `marketdata.ohlcv` exists, writes are upserts.
- `F-06` (no new DB pool) — honored: no new pool/connection; FR-3's map is in-memory.
- `F-07` (no hardcoded values) — honored: FR-2 changes existing `cfg.GetInt/GetString(key, default)`
  defaults (the sanctioned WatchConfig pattern), not new hardcoded config; FR-1's 5-min poll is a UI constant.
- `C-05` (config governance / defaults in service CLAUDE.md) — honored: FR-2 updates the marketdata
  CLAUDE.md config table + prose in the same PR; no new key.
- `C-08` / `P-06` (tests updated with behavior, red-first) — honored: update the two
  `TestResolveIngestTimeframe` subtests + net-new FR-7/FR-3/cooldown tests, red-before-green.
- `C-10(b)` (parity across read paths) — honored: `GetBars` is the single daily-bar read path;
  FR-7/FR-3 keep the newest-bar source consistent across chart + screener consumers.
- `C-14` (consumer surface named) — honored: `/trader` charts via existing `GetBars`; screener via
  existing scan; no new surface.
- `P-03` (no silent deviation / verify contracts) — honored: config-store absence verified, not
  assumed; FR-6 branch discrimination avoids over-reporting; open risks recorded.
- `P-05` (write context as it happens) — honored: context.md updated at each phase.

## Rounds

2 rounds (quick mode, upgraded on user request). Round 1 corrected the FR-3 newest-bar source, the
cooldown-vs-value-guard choice, the FR-6 call-site placement, and the ingest lookback/interval. Round
2 surfaced the **FR-7 read-path root cause** (and its screener blast radius); the user chose to fold
FR-7 in as the primary fix. No Floor breach in either round.
