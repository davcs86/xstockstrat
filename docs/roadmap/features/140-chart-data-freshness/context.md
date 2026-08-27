# Context: chart-data-freshness  (archived 2026-08-26)

**Feature**: ./feature.md
**Status**: launched — archived by /sdd-archiver; verbose specs pruned (recoverable via git history).

## Archive Synthesis — 2026-08-26 — /sdd-archiver

**What**: What shipped as "chart data freshness" turned out to be primarily a **read-path** fix, not the ingestion fix the story assumed. The decisive change (FR-7) made `GetBars` return the *newest* page for implicit-window requests; the ingester-flip (15m→1d), UI auto-refresh, and staleness-fallback were secondary. The work also folded in an observability half (FR-6: WARN logging on analysis's silently-empty steady-state paths) and a follow-up regression-guard step (Step 6) that locks a previously-implicit cross-service "autonomous freshness" contract. Zero proto, zero migration, zero new config key.

**Why (irrecoverable rationale)**: The user's framing ("is OHLCV pulled every 24h?") and the first two Explore traces pointed at three *ingestion* gaps; the real root cause only surfaced in design **round 2** and reframed the whole feature. The 1d-only constraint was an explicit user guardrail, which forced OQ-1 (flip vs. keep 15m) and was only safe because a cross-service GetBars-timeframe audit proved no automated consumer reads stored `15m`.

**Rejected alternatives**:
- Value-based staleness guard ("skip while stored newest unchanged") — lost: it **deadlocks and re-freezes** charts when the ingester is paused (`bar_ingest_interval_ms<=0`); the time-cooldown self-heals.
- `QueryBars` → DESC globally — lost: breaks backtest's ascending forward pagination; gated new behavior on `startImplicit` to isolate blast radius.
- Shrink the `slack` window multiplier 3→~1.4 — lost as fragile: re-breaks the instant a symbol's history exceeds one page.
- Thread `symbol` kwarg through the parity-frozen `evaluate_with_series` / log inside `evaluate_conditions_traced` — lost: that function is also driven by the 100-symbol `_compute_opportunities` background loop, so an in-function WARN floods + double-logs.
- Notify alert on data gap (FR-6) — lost: steady-state gaps are low-severity; notify is reserved for feed-disconnect. Log-only.
- 7-day lookback / keep 60s ingest interval — lost as heavy write-amplification for once-a-day data.
- A second `GetCoverage` MAX(time) query to source the newest bar (round-2 plan) — **superseded** once FR-7 made the returned page already newest-first (`bars[len-1]` is the true global newest). This is **why FR-7 must land before FR-3**: `bars[len-1]` *without* FR-7 is ~100 days stale (the last row of an ASC-from-start window), so reading the newest bar was unsafe until FR-7 flipped implicit-window reads to newest-page.

**Scars & gotchas**:
- **CI status automation silently skipped this feature.** `ci-validate-feature-status.yml` only flips a feature to `launched` when a commit in the promotion delta matches the feature *slug* via `git log --grep`; the merge commit (PR #981) didn't contain the slug, so the feature sat at `code-completed` while its code was live in prod, requiring manual reconciliation.
- **`QueryRecentBars` DESC-ordering is not unit-testable** in the existing marketdata harness (repo tests are pure-function only) — SQL correctness was covered only by review + the pure-function `TestTruncateBars`/`TestStaleCheckDue`.
- Config-default flip (FR-2) is a **no-op if an explicit `marketdata.stream.bar_ingest*` config row exists**; effectiveness depends on an operator SELECT-check in *both* dev and prod — this remains an open operator TODO at archival.

**Permanent deviations**:
- Design specified 5 surgical changes (FR-7/2/3/1/6); shipped added **Step 6 — autonomous-freshness regression guards** as a follow-up → to lock the invariant that indicator/strategy calc stays fresh **without any chart/portal view** (querying a symbol warms it, the ingester refreshes exactly the warm set, the live loop queries every symbol it evaluates). Extracted `warmSnapshot()` + Go/analysis guards so a future batching/caching refactor can't silently stop warming.

**Cross-feature signal**: The read-path root-cause class ("latest ≠ page 1 of an ASC-from-start query") already mis-fed the analysis **screener** as well as charts (fails.md:1454). Related to the chart-library unification work (146) that follows in the same UI area.

**Deferred follow-ons**: The operator must verify no explicit `marketdata.stream.bar_ingest*` row exists in dev + prod before relying on the 1d default. FR-3 is intentionally **dead for the live loop** (it passes an explicit `end` so `startImplicit` is false); freshness there rides on `markWarm` + the FR-2 ingester — recorded so a later reader doesn't "fix" it. The `_compute_opportunities` empty-bar branch stays deliberately silent (flood avoidance). FR-3 `staleCheck` runs per screened symbol (the screener passes no range → implicit window → hits FR-3); a first-scan-of-day latency concern against the 120s `analysis.screener.max_duration_seconds` budget was flagged as an open risk but never confirmed.

**Accepted tradeoffs (design-time, would otherwise read as bugs)**:
- DST 24h-approximation: `timeframe.Interval("1d")=24h` is DST-naive, causing at most one spurious (upsert-idempotent, cooldown-bounded) refetch on a 23h/25h boundary — accepted, not a bug. Shipped code only shows `24h`.
- The manual `15Min` chart tab is left **better off, not worse**, by the 1d flip: the flip stops background 15m refresh, but FR-3's staleness fallback fires for **all** timeframes (not just 1d), so the human 15m tab still self-heals. (OQ-1 only covered "no *automated* consumer reads 15m".)
- Unbounded `lastStaleCheck` / `warmSymbols` map growth (~10k symbols × few tfs) — accepted, "not introduced here", matches the existing `warmSymbols` precedent. Noticed and accepted, not overlooked.

**Ledger entries written**: insights.md (2), fails.md (1) — see the 2026-08-26 entries. (The read-path root-cause reframing was already recorded at fails.md:1454.)
**Runtime-invariant recommendations (→ /context-constitution)**: (1) MARKETDATA-/ANALYSIS- autonomous-freshness contract — querying a symbol via `GetBars` marks it warm → the always-on ingester refreshes exactly the warm set (`warmSnapshot()`) → the analysis live loop issues `GetBars` for every symbol it evaluates; now protected by `TestMarkWarmFeedsIngestSet`/`TestGetBarsMarksSymbolWarm`/`test_cycle_queries_getbars_for_every_universe_symbol`. (2) MARKETDATA- implicit-window read semantics — `GetBars` with no explicit range start returns the newest page (DESC+reverse via `QueryRecentBars`), gated on `startImplicit && pageToken==""`; explicit-range/paginated callers keep the ASC windowed `QueryBars`; a future reader must not "unify" these paths.
**Scenario promotion (C-16)**: none — this feature has no `acceptance.feature` file.
**Pruned artifacts**: product-spec.md, recon.md, design.md, implementation-spec.md — last present at 996210e4.
