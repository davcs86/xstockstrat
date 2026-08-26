# Context: unified-symbol-page  (archived 2026-08-26)

**Feature**: ./feature.md
**Status**: launched — archived by /sdd-archiver; verbose specs pruned (recoverable via git history).

## Archive Synthesis — 2026-08-26 — /sdd-archiver

**What**: Shipped a single unified `/trader/positions/[symbol]` page consolidating three prior per-symbol surfaces (096's position/order pages + 083's `/insights/market/[symbol]`), reusing the position page *in place* as the base route. Every section (Opportunity/Readiness/Fundamentals/Screening/Backtests/Backfill + FR-6 indicator overlay panels) gates independently of position existence, so unheld symbols still render. Absorbed a mid-flight scope amendment (FR-6 strategy indicator charts) into the in-flight feature instead of a new NNN, growing 26→33 steps. Old `/insights/market/[symbol]` retired to a redirect; features 132 (Mute) and 083 (Edge BT) that landed *after* recon were ported forward, not dropped.

**Why (irrecoverable rationale)**:
- FR-6's dedicated `GetIndicatorSeries` RPC won over widening `EvaluateReadiness` because `evaluate_conditions_traced` is *shared* with launched feature 097's `ListOpportunities` exit trace (`servicer.py:2207`) — adding per-component fault isolation there would silently change held-position exit-signal semantics for a launched feature. This was the decisive round-2→3 reversal.
- The client supplies the candlestick's own closes+times to `GetIndicatorSeries` (no server re-fetch) because `_compute_component` provably needs only closes and the candlestick fetches by `pageSize` count, not a `TimeRange` — so the "server re-fetches from the range" option was *impossible*, not merely rejected.

**Rejected alternatives**:
- Widen `EvaluateReadiness` for FR-6 — lost: shared-method blast radius onto launched feature 097's exit trace.
- Server re-fetch from a `TimeRange` — lost on a false premise: the candlestick uses `pageSize`, no `TimeRange` exists to reuse.
- `RunBacktest` diagnostics reuse for the series — lost: side-effecting full simulation per page view.
- Dual-registering RPCs in `traderBff.ts` — lost to cross-segment client reuse (recorded 2026-08-10).

**Scars & gotchas**:
- **`repeated google.protobuf.DoubleValue` cannot encode null distinctly from `0.0`.** Empty `DoubleValue()` is byte-identical to `DoubleValue(0.0)`, `HasField('value')` *raises* on a repeated element, and Connect-JSON serializes both as `0` — a warm-up gap and a real 0.0 become indistinguishable, defeating AC-4a. The wrapper only gives presence for a *singular* optional field. Fixed with a per-point message `IndicatorValue { optional double value = 1; }` (proto3 `optional` gives real presence: gap→`{}`, real 0.0→`{"value":0}`).
- **`buf breaking` needs `--against ".git#...,subdir=packages/proto"`** — without `subdir=`, buf can't resolve `common/v1` imports in the snapshot and reports false compile errors; `buf-gen.sh` passes it but manual runs don't.
- **Cross-segment BFF reuse still requires a `forward()` in the *owning* segment's BFF for a net-new RPC.** Panels 501'd until `getIndicatorSeries` was registered in `insightsBff.ts` — the browser `analysisClient` routes through `/insights/api`, so Step 7's *trader*-BFF waiver did not cover it. Diagnosed only via a network trace (501). This is the load-bearing *limit* on the cross-segment-reuse lesson.
- The forked `/sdd-spec` skill refuses to re-run once a feature is `implementation-ready` ("nothing to do"), blocking a legitimate citation refresh after feature 124 merged; the sweep was done by hand.
- Playwright sandbox: `next dev` first-route compile exceeds the 10s timeout; must `NEXT_DISABLE_STANDALONE=1 pnpm build` + `E2E_PREBUILT=1` so routes are pre-compiled.

**Design decision — C-10(b) parity proven at evaluator/unit layer, NOT cross-RPC**: parity for `GetIndicatorSeries` is deliberately proven at the evaluator/unit layer with a fixed-`closes` fixture; a cross-RPC assertion against `EvaluateReadiness.lhsValue` was **rejected as flaky by construction** — because `EvaluateReadiness` fetches its *own* differently-windowed bars via `_recent_range`/`_fetch_bars_paged` (`servicer.py:1979,1983`) while `GetIndicatorSeries` receives the client's `pageSize:200` closes, so for a path-dependent indicator (EMA/RSI/MACD/ATR, recursive/Wilder seeding) the last-bar value *legitimately differs* and a cross-RPC test would measure bar-fetch equivalence, not computation parity. Without this note a future engineer sees a unit-level parity test, assumes a "more honest" cross-RPC one is missing, adds it, and hits flakes.

**Permanent deviations**:
- design/Step 27 said `NamedSeries.values = repeated google.protobuf.DoubleValue` → shipped `repeated IndicatorValue { optional double }` → repeated wrapper elements have no presence (scar above). The shipped proto is grep-able; the *reason it isn't `DoubleValue`* is not.
- design/spec cited a non-owner-scoped `EvaluateReadiness` skeleton → shipped `GetIndicatorSeries` owner-scoped (`get_by_owner_and_id` → PERMISSION_DENIED) → feature 133 added owner-scoping between recon and execute; the executor mirrored live code, not the stale quoted skeleton.

**Cross-feature signal**:
- Retiring/redirecting a page silently drops features that landed on it after recon. 132 (`MuteForStrategy`) and 083's Edge(BT) stat were added to `/insights/market/[symbol]` *after* recon; the redirect would have dropped them (user chose to port). The spec's grep-only inbound sweep also missed 4 later-added e2e specs still navigating to the retired route.
- `GetPosition`'s account-scoping read-path bug had a write-path twin (`portfolio_service.go:257`, order-fill avg-entry) computing avg-entry from the wrong account for a multi-account user — fixed in-scope under user sign-off.
- Status-automation drift recurred (096 then 125): a harness-pinned `claude/*` branch (the `feature/<slug>` branch never existed on origin) + a squash-merge leaving no branch to reconcile + not flipping `status.md`/step statuses during execute → `status.md` stuck at Step 1 despite all 33 steps done; corrected by hand post-merge.

**Deferred follow-ons**: Uncapped `StrategyDefinition.components` panel fan-out (concurrency is semaphore-bounded via `analysis.series.max_concurrent_components` default 4, but panel *count* is uncapped). The always-fully-rendered composite page fires 7+ RPCs on every visit — named as a perf/UX risk, flagged for a pre-launch QA check, but never stress-tested; no evidence it was closed.

**Ledger entries written**: insights.md (3), fails.md (3) — see the 2026-08-26 entries. (The BFF cross-segment-reuse, "Page vs redirect" all-or-nothing gate, and rejected-alternatives lessons were already recorded at insights.md:1397 / fails.md:890 / fails.md:916.)
**Runtime-invariant recommendations (→ /context-constitution)**: (1) PLAT-* proto wire — nullable scalars in a *repeated* field need a per-element message with a proto3 `optional` scalar; `google.protobuf.*Value` gives presence only for singular optionals, and over Connect-JSON a repeated empty wrapper is indistinguishable from `0.0`. (2) PLAT-* codegen — `buf breaking` must run with `--against ".git#...,subdir=packages/proto"`. (3) UI-* — cross-segment browser-client reuse forwards through the owning segment's BFF (`/insights/api`); any net-new RPC needs a `forward()` there, and a 501-from-BFF is the diagnostic.
**Scenario promotion (C-16)**: none — this feature has no `acceptance.feature` file.
**Pruned artifacts**: product-spec.md, recon.md, design.md, implementation-spec.md — last present at 996210e4.
