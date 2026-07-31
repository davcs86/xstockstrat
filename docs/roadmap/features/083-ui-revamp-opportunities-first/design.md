# Design: ui-revamp-opportunities-first

**Created**: 2026-07-31
**Rounds**: 2 (full; termination: approved — user directive "do all within 083, execute in the right order", all Round-2 objections resolved, no Floor breach)
**Approved by**: user @ 2026-07-31 (scope steer + "continue" directive; design gate presented, user opted to proceed)
**Grounded in**: recon.md (incl. Phase 0b producer-service recon)

---

## Scope note (user override of the product spec)

The product spec scoped this **UI-only** ("new backend RPCs → a separate feature"; no proto/DB/config
change). The user directed that **all backend gaps ship inside feature 083, sequenced backend→frontend,
with no phased split**. This design honors that. It therefore activates governance gates the product
spec marked N/A — see **Open Risks** for the mandatory product-spec refresh + re-review before
`/sdd-execute`.

## Chosen Approach

**One feature, five additive backend subsystems on an "analysis-owns-the-queue" spine, then a Nocturne
UI that consumes each screen's now-real RPC. No new DB pool (F-06 held). No new synchronous inter-service
cycle.**

### Backend

1. **Opportunity queue — owned by `xstockstrat-analysis` (zero new edges).** A new
   `analysis.ListOpportunities` RPC aggregates the three inputs analysis **already** terminates: signals
   (ingest `QuerySignals`, `ingest.proto:120-131`), held positions (portfolio `ListPositions`, edge
   wired by feature 062), and the conviction/readiness evaluator it owns (`evaluator.py:81`). Ranking/
   dedup is **compute-on-read** — no ingest ranking table, no migration for the queue. **Tenancy is
   per-user**: `ListPositions(user_id)` with `account_id` **unset** and `TradingMode UNSPECIFIED` already
   returns all of a user's held positions across accounts/modes (`portfolio.proto:105-114`, verified
   Round 2) — **no new global-positions RPC is needed** (the residual is pagination drain, handled via
   `PageRequest`).
   - **Action tag = `OpportunityActionTag{UNSPECIFIED, ENTER, ADD, REDUCE}`** derived from real data
     only: `ExternalSignal.direction` (`buy|sell|hold|watchlist`, `ingest.proto:108`) × held-position —
     `buy & !held → ENTER`, `buy & held → ADD`, `sell & held → REDUCE`. **The prototype's TRIM-vs-EXIT
     split is deliberately collapsed to a single non-prescriptive `REDUCE`** — the platform must not
     synthesize a "fully exit vs trim" boundary from an undefined number on a row that opens a real order
     ticket (Round-1/Round-2 correctness ruling); the human chooses trim vs exit at the ticket.

2. **Conviction / readiness — additive evaluator sibling (hot path frozen).** A new
   `evaluate_conditions_traced` beside the existing `_eval_condition` (which stays a bare `bool`,
   `evaluator.py:415`) and the frozen `1.0/0.0` backtest conviction (`evaluator.py:165`) — the
   additive-sibling pattern (insights.md 2026-07-08). It returns, per condition leaf,
   `{lhs_value, threshold, fn, state ∈ ConditionState{UNSPECIFIED,PASS,SOFT,FAIL}, distance_to_threshold}`.
   A new `analysis.EvaluateReadiness(strategy_id, symbols[])` RPC surfaces it and feeds three consumers:
   Signal-detail conditions (FR-6), Watchlist readiness (FR-7), and the queue's conviction (FR-5).
   - **Conviction is rendered as a deterministic ordinal, not an invented probability %** — the surfaced
     value is `passing_leaves / total_leaves` plus a normalized worst-distance-to-threshold, both computed
     from the trace. No probabilistic/opaque "conviction model" is fabricated (C-01 — a number that ranks
     an order-opening queue must be defined, not estimated). The UI labels it accordingly (e.g. "4/5
     conditions" + strength bars), not a fake percentage.

3. **Copilot rail — ledger-backed threads, client-side summary, OAuth-client MCP invocation (F-06 held).**
   - **Thread persistence → the ledger append-only store**, verified Round 2: `stream_key =
     "copilot:{user_id}:{thread_id}"`, `event_type = "copilot.message"`, `payload = Struct{role, text}`,
     `idempotency_key` for retry-safety (`ledger.proto:14-15,33-61`; `sequence` monotonic per stream).
     Replay a thread via `QueryEvents(stream_key)`. **No new agent DB, no new pool, no migration** — F-06
     stays at the 20-connection cap. **Constraint (bound as product rule):** the thread is **append-only**
     — no edit/delete of a prior turn (ledger events are immutable, `ledger.proto:12`); the Copilot UX
     must not offer message edit/clear-with-history-loss.
   - **"Read of the queue" + concentration flag = client-side templated summaries** over the already-
     fetched `ListOpportunities` + position weights. **No Anthropic/LLM client, agent stays stateless** —
     the recon confirmed the agent has none and adding one is out of proportion.
   - **Authenticated MCP tool invocation** reuses the agent's existing **OAuth 2.1** surface
     (`oauth_server.py:122-237`): the UI BFF acts as a registered OAuth client, obtaining a per-session
     **agent-aud** token (`aud == AGENT_PUBLIC_URL`, `auth.py:43`) via the existing DCR→authorize→token
     flow, then speaks MCP JSON-RPC to the agent `/` endpoint (`main.py:244`), **confirm-gated** per FR-4
     ("read-only unless you confirm"). This is the design's **highest open risk** (see Open Risks) — a UI
     session token is UI-aud, not agent-aud, so the mint path is a real OAuth sub-surface, not "a BFF
     route", and needs approval-flow sign-off for the new client registration.

4. **Position risk / factor engine — `xstockstrat-portfolio`, no synchronous cycle.** New `Position`
   risk fields + `PositionRiskFlag{UNSPECIFIED, ADD_SIGNAL, REDUCE_SIGNAL, STOP_NEAR}`, plus a risk
   stat/summary read. **Resting-STOP price arrives via a ledger event, not a new `portfolio→trading`
   synchronous edge** — trading→portfolio already exists (root graph), so a reverse edge would create a
   gRPC/`WAIT_FOR` cycle (Round-2 objection). Portfolio already consumes ledger events for position
   state (3 consumers, `main.go:64-66`); it extends that to learn resting stops from trading's order
   events. Stop-distance `= (current_price − stop) / current_price` off portfolio's existing
   broker-authoritative `current_price` (C-10(b) seam confirmed healed, `portfolio_repo.go:225`).
   **Factor grouping** reuses the existing `portfolio→marketdata` edge (fundamentals `sector`), with a
   `portfolio.exposure.factor_map` config-key fallback if `sector` is absent.

5. **Per-strategy analytics + screener enrichment — `xstockstrat-analysis`.** New
   `analysis.GetStrategyAnalytics`: expectancy/hit-rate/max-DD from persisted `analysis.backtest_runs`
   (migration 006), signals-30d from ingest `QuerySignals`, "taken" from a **new `analysis→trading
   ListOrders` edge** (non-cyclic — trading does not dial analysis; `Order.strategy_id` field 15 confirmed
   present), queue-share from the queue join. Extend `ScreenResult` (`analysis.proto:340`) with raw
   `pe/rsi/atr/rev_growth/held` + widen the `screener.py:32` whitelist; RSI/ATR via the existing
   `analysis→indicators` edge — **the close-only ATR/VWAP approximation** (`indicators_engine.py:103,112`)
   is surfaced as a known accuracy caveat, not silently shipped as exact.

6. **Signal-source health — `xstockstrat-ingest`, migration 008.** New `SignalSource` health fields +
   `SourceHealthStatus{UNSPECIFIED, LIVE, STALE, DOWN}` + freshness/last-seen/last-error columns
   (`migrations/008` on `ingest.signal_sources`; next number confirmed 008). "Strategies that read this
   source" is a reverse index over `StrategyDefinition.signal_params`.

### Proto / migration / config / edges (summary)

- **Proto:** one additive pass (analysis: `ListOpportunities`, `EvaluateReadiness`, `GetStrategyAnalytics`,
  `ScreenResult` fields; portfolio: `Position` risk fields; ingest: `SignalSource` health fields) with the
  four new enums, each `_UNSPECIFIED=0` (C-04). All **additive/non-breaking** — but still gate on
  `buf lint`/`buf breaking` (C-09) + `./scripts/buf-gen.sh` freshness. **Author the exhaustive TS
  `Record<Enum,…>` maps in the same PR** (C-10(a/d); these are *new* enums so no existing
  `BacktestDiagnostics.tsx` map breaks `tsc`, but the maps must exist).
- **Migrations:** ingest **008** (source-health) confirmed. Portfolio stop-tracking storage vs in-memory
  and any analytics/expectancy column are **/sdd-spec decisions** (see Open Risks — not asserted as
  "ingest 008 only").
- **Config:** `portfolio.exposure.factor_map` (only if `sector` unavailable); FR-19 chrome via
  env-overridable defaults + `ChromeContext` (reuse `AccountContext` for `accountMode`) — **records a
  C-05 deviation**, no config-service keys, no F-07 breach (defaults are env-overridable, not bare literals).
- **New edges:** `analysis→trading` (`ListOrders`, non-cyclic), UI→agent (OAuth-gated MCP). **No
  `portfolio→trading` synchronous edge** (ledger event instead).
- **C-03:** every new request-scoped RPC (`ListOpportunities`, `EvaluateReadiness`, `GetStrategyAnalytics`,
  the portfolio risk read) propagates `x-user-id`/`x-access-scope`/`x-trace-id`.

### Frontend (settled Round 1, layered on the real RPCs)

- Nocturne = **two-file token remap** of `globals.css:6-27` + `tailwind.config.js:40-42` (app already
  dark-only; add mono `fontFamily` + `tabular-nums`, blurple accent, gain/loss/paper). **Additive
  Phosphor**, per-screen lucide retirement (no big-bang). Build the missing `components/ui/*`
  (Dialog/Tabs/Tooltip/Slider/Skeleton/Chip) as screens need them.
- **Physical routes unchanged** (`/trader|/insights|/config-ui|/accounts`); the four-tab
  Decide/Discover/Engine/Book nav is a **presentation grouping**, breadcrumb driven by the grouping.
  New Decide routes live under `/insights`.
- **`accounts` (authorized-apps + mcp-tools)** hosted on a pinned, rendered shell surface (top-bar
  account/settings menu) that the **C-10(a) nav-reachability test walks** — the test asserts *every*
  screen incl. these two is reachable from the actually-rendered shell (fails 060).
- **FR-20 order parity** test on **every** order surface (Orders table, Signal-detail ticket, order
  editor), added in each surface's slice; reuse `orderShared.tsx:10,23` enum maps.
- **AC-8 valuation parity** asserted against fixtures/mock-backend (producer agreement not verifiable
  from the UI; seam confirmed healed).
- **C-12 fixtures** for every new message (`Opportunity`, `SymbolReadiness`, risk-`Position`,
  source-health, `StrategyAnalytics`) + `INVENTORY.md` rows, in the same slice.
- Mobile companion = **one shared section renderer** across responsive routes (≥44px targets);
  loading/empty/error states on every data screen.

### Ordering (dependency-first; step PRs target the feature branch directly — NOT base-chained)

1. Proto pass + `buf-gen`/codegen + the four exhaustive TS maps.
2. analysis readiness/conviction (traced evaluator + `EvaluateReadiness`).
3. analysis `ListOpportunities` (joins #2 + positions + signals).
4. ingest source-health (migration 008).
5. portfolio risk/factor (ledger-event stop ingestion + marketdata sector).
6. analysis analytics + screener enrichment (`analysis→trading` edge).
7. Copilot (ledger-thread events + OAuth-client MCP BFF + client-side summary).
8. Frontend: Nocturne shell/theme/nav + C-10(a) test + `accounts` surface **first**; then per-tab
   screens consuming #2–7; then mobile; then residual non-happy states. Each screen ships with real data.

> **082-trap guard:** do **not** use base-chained step branches (they failed to auto-retarget in fails
> 082, silently dropping steps). Each step PR targets `<Development Branch>` directly, and landed content
> is diffed against the spec before the integration PR.

## Rejected Alternatives

- **Queue owned by ingest** — rejected: ingest terminates neither positions nor the evaluator, so it would
  add ≥2 new edges; analysis already reads all three inputs (zero new edges).
- **New agent DB for Copilot threads** — rejected: **F-06 breach** (pool at 20, agent has no pool). Ledger
  append-events give schemaless per-`stream_key` persistence with no new pool.
- **LLM "Read of the queue"** (new Anthropic client in the agent) — rejected: disproportionate; agent has
  no LLM today; a client-side template over the fetched queue satisfies FR-4.
- **`portfolio→trading` synchronous edge for resting stops** — rejected: creates a trading↔portfolio gRPC
  cycle + boot-order hazard; a ledger order-event (portfolio already consumes ledger) avoids the cycle at
  the cost of eventual consistency on stop-distance.
- **New global-positions RPC** (proposer's Round-2 worry) — rejected as unnecessary: `ListPositions(user_id)`
  with unset `account_id` + `TradingMode UNSPECIFIED` already returns all held positions.
- **TRIM vs EXIT action tags** (prototype) — rejected: manufactures a fully-exit-vs-reduce boundary from an
  undefined number on an order-opening surface; collapsed to non-prescriptive `REDUCE`.
- **"conviction %" as a probability** — rejected: no graded model exists; use a deterministic ordinal
  (passing-leaf ratio + normalized distance).
- **UI-only 083 with backend deferred to 084+** (recon's own recommendation) — overridden by explicit user
  directive to build everything in 083.
- **Base-chained stacked step PRs** — rejected: the fails-082 silent-step-drop topology.
- **`ui.chrome.*` config-service keys + new UI WatchConfig client** — rejected: overbuild for three
  presentation toggles; env-overridable defaults + `ChromeContext` (C-05 deviation recorded).

## Open Risks

- [ ] **Governance reconciliation (mandatory before `/sdd-execute`).** Refresh `product-spec.md`
      §Out-of-Scope / §Proto / §Database / §Config / Reviewers to match the now-in-scope backend work,
      then re-run `/sdd-review product-spec`. New active gates: proto (2 owners + platform lead),
      DBA (ingest 008 + any portfolio/analytics migration), config team (`factor_map` if used), expanded
      reviewers (ingest/analysis/portfolio/agent/trading owners). — before Step 1.
- [ ] **Copilot MCP-invocation auth is the top design risk.** The UI-BFF-as-OAuth-client mint path
      (agent-aud token via the existing OAuth 2.1 flow) is a real security sub-surface, not "a BFF route",
      and needs approval-flow sign-off for the new client registration. Confirm feasibility (reuse of
      `accounts/oauth-login` vs a new identity mint-RPC) at Step 7 `/sdd-spec`; if infeasible in scope,
      Copilot ships read-only (client-side summary + ledger thread, no live tool call) as the documented
      fallback. — Step 7.
- [ ] **Conviction/readiness formula** — the passing-leaf-ratio + normalized-distance definition must be
      pinned with a unit test at spec time (C-01); confirm the traced evaluator can emit `lhs_value`/
      `threshold` for every supported leaf `fn` (`crosses_above/below`, comparators). — Step 2.
- [ ] **Factor source unverified** — confirm marketdata fundamentals exposes `sector`; else the
      `portfolio.exposure.factor_map` config key path. — Step 5.
- [ ] **Expectancy source** — confirm expectancy is computable from `backtest_runs` summary metrics; if it
      needs per-trade data (not persisted), a small analysis schema add is required (then not "ingest 008
      only"). — Step 6.
- [ ] **Portfolio stop-state storage** — persisted column vs in-memory for ledger-derived resting stops
      (may add a portfolio migration). — Step 5.
- [ ] **Ledger query-conn capacity** — Copilot read/write shares ledger's single query connection
      (`DB_POOL_MAX=1` + 1 LISTEN/NOTIFY); note load, no pool raise. — Step 7.
- [ ] **Branch lineage** — session on `claude/ui-revamp-opportunities-lwrinp` vs `feature.md`
      `**Development Branch**` `feature/ui-revamp-opportunities-first`; `/sdd-spec`/`/sdd-execute` reconcile
      (fails 082). — before Step 1.

## Constitution Rules Touched

- **F-06** (Floor) — honored: no new DB pool; Copilot threads use the ledger append store; ingest 008 adds
  columns, not a pool. Verified against `ledger.proto:14-15,33-61`.
- **F-07** (Floor) — honored: FR-19 chrome defaults are env-overridable (not bare source literals); no
  config value is hardcoded.
- **C-04** — honored: four new enums each carry `_UNSPECIFIED=0`; closed value sets modeled as enums.
- **C-05** — deviation recorded (env-default chrome over config-service keys; rationale in context.md).
- **C-03** — honored: all new request-scoped RPCs propagate the header tuple.
- **C-09** — honored: proto pass runs `buf lint`/`buf breaking` + `buf-gen.sh` freshness.
- **C-10(a)** — honored: every screen (incl. `accounts`) registered on the rendered shell with a
  nav-reachability test.
- **C-10(a/d)** — honored: each new enum ships its exhaustive TS `Record<Enum,…>` map in the same PR.
- **C-10(b)** — honored: valuation parity seam confirmed healed; AC-8 parity test asserted against
  fixtures.
- **C-08 / P-06** — honored: each backend step pairs a red-before-green test meeting the service threshold.
- **C-12/C-13** — honored: new-message fixtures + `INVENTORY.md` rows in-slice.
- **C-11** — honored: user scope override recorded in context.md; SDD grounding (story→review→design) done.
- **fails-082 guard** — step PRs target the feature branch directly (no base-chained retarget assumption).
