# Context: ui-revamp-opportunities-first

**Feature**: `docs/roadmap/features/083-ui-revamp-opportunities-first/feature.md`
**Product Spec**: `docs/roadmap/features/083-ui-revamp-opportunities-first/product-spec.md`
**Implementation Spec**: `docs/roadmap/features/083-ui-revamp-opportunities-first/implementation-spec.md` _(not yet generated)_

---

## Session 2026-07-31 — sdd-story

- Created `feature.md` (status: `draft`), `product-spec.md`, and this `context.md` from a UI-revamp
  request backed by an external design handoff (the "Nocturne" opportunities-first redesign).
- **Design assets committed with the feature** at `design-handoff/` (README token/screen spec,
  source-map, interactive HTML prototype, 12 screenshots) so the visual + behavioral spec travels with
  the SDD artifacts instead of living only in an upload. The HTML prototype is a **reference, not code
  to ship** — recreate with existing `components/ui/*` primitives.
- **Scope framing.** The request is a presentation-layer re-frame of `xstockstrat-ui` around a ranked
  opportunity queue (Decide / Discover / Engine / Book shell + optional MCP Copilot rail). Marked
  proto / DB / new-service as **no change**; the only possible backend touch is the FR-19 chrome
  config keys (deferred to `/sdd-design`). Any screen that needs data no existing RPC returns is
  explicitly split out as a **separate feature** — decided at design time.

### Grounding (codebase-discovery digest, `services/xstockstrat-ui`)

- **Segments today:** `trader`, `insights`, `config-ui`, **and `accounts`** (authorized-apps,
  mcp-tools) — a *fourth* segment the handoff's 4-tab model does not place. Logged as an Open Question
  (must not become unreachable — the C-10(a) failure mode).
- **Shared nav:** `src/components/shared/PlatformHeader.tsx` — `PLATFORM_NAV` + `PLATFORM_SUBNAV`. This
  is the surface FR-2's nav-reachability requirement targets.
- **Theme:** already **dark-only** (`globals.css` `:root`, `--background: 222 47% 4%`; no light theme,
  no `.dark` variant, no toggle). `tailwind.config.js` already has custom `buy` / `sell` / `paper`
  colors → Nocturne gain/loss/paper map cleanly. Tokens are **inline** (no separate token module).
- **Primitives:** `src/components/ui/` = badge, button, card, input, select, table, combobox, sheet,
  separator. No standalone Dialog/Tabs/Tooltip primitive (dialogs are per-feature).
- **Hooks:** ~40 TanStack Query hooks already exist, including `usePortfolio`/`usePositions`,
  `useOrders`/`useOrderUpdates`, `useBacktest`, `useBackfills` (+ cancel/delete), `useStrategies`/
  `useStrategyDefinitions`/`useLiveStrategies`, `useWatchlists` (full CRUD), `useScreenSymbols`,
  `useCandlestickChart`, `useInsightsSignalSources`. All handoff-named components confirmed present
  (`OrderForm`, `AlertStream`, `EquityCurveChart`, `BacktestDiagnostics`, `PortfolioPanel`,
  `OrderFilters`, `OrderBook`, and the screener/watchlists/strategies/backfills pages).
- **Admin gate:** `useIsAdmin()` at `src/hooks/useLiveStrategies.ts:42` (fetches `/api/auth/me`) —
  backs FR-12's Backfills admin gating.
- **Tests:** Playwright `e2e/` (+ `mock-backend.ts`, `fixtures/`, `fixtures/INVENTORY.md`), vitest
  `vitest.config.ts` (logic tests, coverage scoped to `src/lib/**`).

### Ledger traps surfaced (read at story boot)

- **`fails.md` 2026-07-01 060-screener-engine → C-10(a):** new UI pages must register in the shared
  nav with a nav-reachability test → captured as FR-2 + AC-1, and drives the `accounts`-segment Open
  Question.
- **`fails.md` 2026-07-01 056-open-positions-ui → C-10(b):** a broker-authoritative value must be the
  sole source across every read path → captured in FR-14 (Portfolio read-only broker mirror).
- **`fails.md` 2026-07-21 fix-custom-formula-allnone → C-10(a/d):** `BacktestDiagnostics.tsx` maps
  enums with an exhaustive `Record<Enum,…>`; a new proto enum value hard-couples to a UI edit in the
  same PR → noted in the Proto Contract Changes caveat (only relevant if design splits out backend
  enum work).
- **`fails.md` 2026-07-30 080 / 2026-07-30 082 → absence-claim + branch-lineage traps:** every
  "already served / only X / not affected" scope-narrowing claim must be grep-verified at the gate,
  and skills should confirm the checked-out branch matches `**Development Branch**` → flagged for
  `/sdd-design` in the scope-split Open Question.

### Decisions

- **Size:** this is large (12 screens + shell + Copilot + editors + mobile). Product spec recommends
  `/sdd-design` propose a **slicing** (shell/nav first, then one tab group per `/sdd-spec` +
  `/sdd-execute`), not one monolithic PR.
- **Reviewers:** `xstockstrat-ui` owner only, unless design splits out backend work (then add the
  relevant service owner + Proto/Config/DBA roles).

### Next

- `/sdd-review ui-revamp-opportunities-first product-spec` (product-spec gate), then
  `/sdd-design ui-revamp-opportunities-first` (recon should diff Nocturne vs the existing theme, map
  each screen's fields to a real data source, place the `accounts` segment, and propose the slicing).

## Session 2026-07-31 — sdd-review product-spec

- **Product spec approved. Status: draft → spec-ready.**
- **Criteria verdict (spec-reviewer): PASS WITH WARNINGS** — no blockers, no Floor (`F-*`) breaches.
  Every code-checkable claim verified against the tree: the single affected service matches the
  Registry; the handoff-named components/hooks/routes, `useIsAdmin` (`useLiveStrategies.ts:42`),
  `PLATFORM_SUBNAV`, the `design-handoff/` bundle, and the `BarAction`/`NoTradeReason`/
  `BACKTEST_STATUS_INSUFFICIENT_DATA=2` proto enums (`packages/proto/analysis/v1/analysis.proto:45,100,110`,
  each with `_UNSPECIFIED=0`) all exist; the proposed `ui.chrome.*` keys follow the naming rule.
- **Overlap verdict (feature-overlap): CLEAN** — no config-key, proto-field, migration-`NNN`, or
  source-file collision. Four live concurrent features (all `code-completed`: 033, 076, 077, 078)
  use disjoint namespaces; 077 names `xstockstrat-ui` but makes no edit. 083 will heavily rewrite
  launched UI files (055/056/057/060/068 …) but those are on trunk → rebase-against-trunk work, not
  cross-feature collisions. No `merge-order.md` entry required.
- **Warnings resolved in-spec before advancing:**
  - C-3 (paper-safety) / C-4 (order-type coverage) / C-5 (partial-vs-full fills) → added **FR-20**
    stating order execution is an unchanged, paper-safe re-presentation of `OrderForm`/`OrderBook`.
  - C-10(b) (broker-value parity) → extended **AC-8** with an explicit cross-read-path parity test
    between Portfolio (Mkt value / Unrealized) and Exposure (Risk at stop / weight).
- **Warning accepted (deferred):** criterion 9 — six unchecked Open Questions (scope split,
  config-vs-env, route/URL compatibility, Copilot data source, Nocturne-vs-theme, `accounts`
  placement). All are genuine design-phase decisions correctly routed to `/sdd-design` (honoring
  `P-03`, not breaching it); routing accepted at the gate rather than guessing answers now.
- **Next:** `/sdd-design ui-revamp-opportunities-first`.

## Session 2026-07-31 — sdd-design (Phase 0 recon + Round 1)

- **Phase 0 recon** (`recon.md` written): four `codebase-discovery` passes over `xstockstrat-ui`
  (shell/theme/routing, Decide/Discover data, Engine data, Book/Copilot/tests). Decisive finding —
  the ranked **Opportunities queue** and the differentiating framing (risk-based Exposure, readiness
  Watchlists, live condition evaluation, factor model, signal-source health, per-strategy analytics,
  Copilot invocation+persistence) are **backend GAPs** no current RPC returns; Backtest / Backfills /
  Portfolio / Orders are fully served, others partially. Every gap grep-verified against the producer
  (guards absence-claim traps 080/081). Theme = two-file token remap (app already dark-only).
- **Round 1 grilling.** Proposer: "shell + served-data + thin client-ranked queue over `QuerySignals`."
  Adversary: **NEEDS WORK, no Floor breach.** Verified `ingest.QuerySignals` is **unrouted end-to-end**
  (`insightsBff.ts:63-78` registers 5 IngestService methods, `querySignals` absent; no browser client;
  no mock handler) — the "served RPC" claim was advertised-proto, not exercised (trap 081). Client-side
  ranking + `direction→ENTER/ADD/TRIM/EXIT` action tags rejected: `direction` can't express TRIM/EXIT,
  so an invented action verb on an order-opening row is a correctness/safety issue, not cosmetics.
  F-07 ruled **not** breached for env-overridable chrome defaults (conditional on env-override, not a
  bare literal). accounts placement + AC-1 nav test surface + FR-20 per-surface parity flagged.

### DECISION — user scope override (recorded per C-11 / How-to-Act #1)

- **User directive (2026-07-31):** *"do all within 083, execute them in the right order — no phased
  migration."* The backend gaps are **no longer deferred to separate features** — the ranked
  Opportunity-queue RPC(s), live condition/readiness evaluation, position risk/factor engine,
  signal-source health, per-strategy analytics, screener enrichment, and the Copilot MCP-invocation +
  thread persistence are all **in scope for 083**, sequenced **backend → codegen/migration/config →
  frontend** so each screen ships with real data (no shell-now/data-later).
- **Governance consequence (must reconcile, surfaced to user, not papered over):** this overrides the
  product spec's `## Out of Scope` ("new backend RPCs … a separate feature"), `## Proto Contract
  Changes` ("No proto changes"), `## Database Changes` ("No schema changes"), and the `xstockstrat-ui`-
  only Reviewers snapshot. Now active: **breaking/additive proto gate** (2 owners + platform lead),
  **config-key gate** (config team) if any `<service>.<category>.<key>` added, **DB migration gate**
  (DBA + service owner) for Copilot-thread persistence, and expanded reviewers (ingest / analysis /
  portfolio / agent owners). **Follow-up:** refresh `product-spec.md` (scope/gates/reviewers) and
  re-run `/sdd-review product-spec` before `/sdd-execute` — captured as an Open Thread on `design.md`.

### Open Threads (carry to design.md / sdd-spec)

- [ ] Refresh product-spec.md scope + governance gates + Reviewers to match the in-scope backend work;
      re-review. (Before `/sdd-execute`.)
- [ ] Producer-service recon (ingest / analysis / portfolio / agent / indicators) to ground the
      backend ordering — running now in Phase 0b.

### Round 2 — full-scope backend design (proposer vs adversary)

- **Proposer:** analysis-owns-the-queue spine (zero new edges — analysis already reads ingest signals +
  portfolio positions + owns the evaluator); Copilot threads → ledger append-events (no new pool);
  client-side "read of queue" (no LLM); portfolio risk via new edges; per-strategy analytics + screener
  enrichment; 8-step backend→frontend ordering.
- **Adversary: NEEDS WORK, no Floor breach.** F-06 adjudicated **HELD** — verified `ledger.proto:14-15,33-61`
  supports `stream_key` + `Struct payload` + `idempotency_key` append/replay; ledger append-only fits a
  chat thread iff the UX never edits/deletes (bound as a product constraint). Objections resolved into the
  design: (1) conviction/readiness formula was undefined for a number that ranks an order queue → **bound
  to a deterministic ordinal** (passing-leaf ratio + normalized distance), not an invented %; (2) TRIM-vs-EXIT
  "conviction cut" is a fabricated trade-action boundary → **collapsed to a single `REDUCE` tag**; (3) the
  MCP-invocation "BFF mints an aud-bound JWT" is under-scoped — a UI-session token is UI-aud, agent needs
  `aud==AGENT_PUBLIC_URL` via the full OAuth flow → **bound to UI-BFF-as-OAuth-client (top open risk, read-only
  fallback)**; (4) `portfolio→trading` would create a trading↔portfolio gRPC cycle → **stop learned via a
  ledger order-event instead** (portfolio already consumes ledger); (5) the proposer's own "need a global
  positions RPC" worry is **overstated** — `ListPositions(user_id)` with unset `account_id` + `TradingMode
  UNSPECIFIED` already returns all held positions (`portfolio.proto:105-114`), so **no new RPC**; (6) the
  8-stacked-PR topology is the fails-082 silent-drop shape → **step PRs target the feature branch directly,
  not base-chained**. The 2026-07-21 exhaustive-map tsc-break does **not** fire (new enum types, not appended
  values), but the maps + nav test + AC-8 parity + C-12 fixtures must still be authored in-PR.

### Decisions (design-approved)

- **Chosen approach:** one feature, five additive backend subsystems on an analysis-owns-the-queue spine,
  then a Nocturne UI consuming each screen's now-real RPC; backend→frontend order; no new DB pool (F-06 held);
  no new synchronous inter-service cycle. Full detail in `design.md`.
- **Action tag** = `ENTER/ADD/REDUCE` (no synthesized EXIT-vs-TRIM). **Conviction** = deterministic ordinal,
  not a probability. **Copilot** = ledger-thread persistence + client-side summary + OAuth-client MCP
  invocation (read-only fallback). **Stop-distance** via ledger event (no portfolio→trading cycle). **Factor**
  from marketdata `sector` (config-map fallback). **Chrome** = env defaults + ChromeContext (**C-05 deviation
  recorded** — no config-service keys; not an F-07 breach since defaults are env-overridable).
- **Design gate:** presented twice via AskUserQuestion; user interrupted both without selecting, having already
  given the explicit substantive directive ("do all within 083 … right order … no phased migration") and a
  "continue" instruction. Proceeded to finalize the design with the recommended resolutions per that directive,
  subject to user redirection. Rounds: 2 (full). Status: spec-ready → design-approved.

### Open Threads (carry to /sdd-spec — full list in design.md § Open Risks)

- [ ] **Before Step 1:** refresh product-spec.md scope/gates/Reviewers (backend in-scope) + re-run
      `/sdd-review product-spec`.
- [ ] **Top design risk:** Copilot MCP-invocation auth (UI-BFF-as-OAuth-client vs identity mint-RPC vs
      read-only fallback) — resolve at Step 7 /sdd-spec.
- [ ] Pin the conviction/readiness formula with a unit test (Step 2); verify factor `sector` (Step 5);
      verify expectancy source / possible analysis schema add (Step 6); portfolio stop-state storage (Step 5);
      ledger query-conn capacity note (Step 7); branch-lineage reconcile (fails 082).

## Session 2026-07-31 — sdd-design

- Phase 0 Recon: wrote recon.md (services: xstockstrat-ui + Phase 0b producers ingest/analysis/portfolio/agent/
  indicators; key reuse patterns: analysis-owns-queue zero-new-edges, ledger append-store for Copilot threads,
  additive-evaluator-sibling for readiness).
- Phase 1 Grilling: 2 rounds (full). Chosen approach: five additive backend subsystems (analysis-owns-queue)
  + Nocturne UI, backend→frontend. Rejected: ingest-owned queue, new agent DB (F-06), LLM copilot,
  portfolio→trading edge, global-positions RPC, TRIM/EXIT split, base-chained step PRs.
- Constitution rules touched: F-06 (held), F-07 (held), C-04, C-05 (deviation), C-03, C-09, C-10(a/b/d),
  C-08/P-06, C-11, C-12/C-13. Floor breaches: none.
- Status: spec-ready → design-approved.

## Session 2026-07-31 — Copilot descope + product-spec refresh

- **User decision:** Copilot ships as a **shallow beta** in 083 (rail chrome + client-side "read of the
  queue"/concentration flag + ledger-persisted append-only thread, input in beta/read-only state — no live
  MCP tool call); **full functionality** (authenticated MCP tool invocation via UI-as-OAuth-client →
  agent-aud token, + any LLM generation) is a **separate future feature**. This retires the design's former
  top open risk (the aud-bound-token mint surface) from 083's critical path. Bound into design.md § 3,
  Open Risks (resolved), Ordering step 7; FR-4 + Out-of-Scope in product-spec.md.
- **Product-spec refresh (user-requested):** reconciled the spec to the in-scope backend —
  FR-4 (Copilot beta), Out of Scope (backend in-scope + full-Copilot deferred), Affected Services (added
  analysis/ingest/portfolio + ledger/trading FYI + proto pass), Proto Contract Changes (additive pass + 4
  enums), Config Key Changes (env-default chrome / C-05 deviation; conditional factor_map), Database Changes
  (ingest migration 008 + conditionals), approval gates (proto owners + DBA + expanded service owners), and
  marked all six Open Questions **RESOLVED**. feature.md Reviewers snapshot expanded (provisional; finalized
  at /sdd-spec).
- **Next:** re-run `/sdd-review ui-revamp-opportunities-first product-spec` on the refreshed spec, then
  `/sdd-spec`.

## Session 2026-07-31 — sdd-review impl-spec (advisory) + spec fixes

- **Criteria (spec-reviewer): PASS WITH WARNINGS** — 31 steps, 21 clean ✓ / 10 ⚠ / 0 ✗ / 0 Floor breaches.
  Every load-bearing code claim independently re-verified (proto field numbers additive, migration 008,
  four enums `_UNSPECIFIED=0`, action-tag/conviction/factor/expectancy all backed by real data, F-06/F-07
  held). **Overlap (feature-overlap): CLEAN** — no proto-field / migration / config-key / source-file
  collision; no merge-order entry.
- **Applied 4 fixes to implementation-spec.md** (still editable pre-execute; F-09 freezes bodies only at
  dispatch): (1) **Step 21** nav-reachability rescoped to nav/breadcrumb presence + **Step 20** adds
  placeholder route stubs so its red→green resolves within its own pairing (was spanning Steps 22–25 —
  P-06/F-05); (2) **swapped Steps 12↔13** so the `portfolio.exposure.factor_map` config step (now 12)
  precedes the portfolio service step that reads it (now 13) — fixed the Step-Dependencies section + the
  `25 needs 13` + docs-step cross-refs; (3) **Step 1** new standalone messages given explicit `= N` field
  numbers; (4) **Step 14** Go coverage command inlined. Remaining ⚠ (wildcard `**Files**` on broad UI/test
  steps) accepted as inherent.
- **Next:** `/sdd-execute ui-revamp-opportunities-first` (backend→frontend; step PRs target the feature
  branch directly, not base-chained — fails 082; reconcile branch lineage before first write).

## Session 2026-08-01 — resolve remaining impl-spec warnings (tighten `**Files**`)

- Addressed the deferred impl-spec review warnings (the wildcard/bare-directory `**Files**` entries that
  reduce auditability and weaken `/sdd-execute`'s F-08 per-step staging guard). Tightened Steps 10, 11, 18,
  20, 22, 23, 24, 25, 27, 28, 29, 30 from repo/segment-wide globs (`src/app/**`, `src/components/**`,
  `e2e/**`, bare `tests/`, `app/repositories/`) to concrete file lists / dir-scoped paths, each with an
  "exact file confirmed at execute discovery" note only where a new-file set is genuinely open. Remaining
  intentional wildcards: `packages/proto/gen/**` (codegen output), a single `src/lib/browserClients/` dir
  (one client file), and the conditional `internal/testdata/` C-13 home.
- The earlier PR (#830) was **merged**, so this follow-up restarts `claude/ui-revamp-opportunities-lwrinp`
  from `origin/main-dev` (which carries the merged work) and opens a **new** PR — a merged PR cannot track
  follow-up work.
- No lifecycle change (still `implementation-ready`); step **bodies/instructions/verification unchanged** —
  only `**Files**` precision. Ready for `/sdd-execute`.

## Session 2026-07-31 — sdd-review product-spec (re-validation of refreshed spec)

- **Verdict: PASS WITH WARNINGS** (0 blockers, no Floor breach). Lifecycle **unchanged** (already
  `design-approved` — this is a re-validation of the scope-expanded spec, not a `draft→spec-ready` gate).
- **spec-reviewer:** every code-checkable claim verified against the tree — service names vs Registry, the
  four new enums all new types with `_UNSPECIFIED=0` (C-04), `analysis.proto:340`/`portfolio.proto:43`/
  `trading.proto:47` anchors, ingest migration 008 correct next number, `factor_map` key format, and the
  tenancy claim (`portfolio.proto:105-114` `ListPositions(user_id)` returns all held positions). **F-06 HELD**
  (ledger append-store, no new pool — `ledger.proto:14-15,27-45`); **F-07 HELD** conditionally (env-overridable
  chrome defaults, not bare literals — enforce at execute). Spec consistent with design.md.
- **Advisory warnings (→ /sdd-spec):** (1) C-07 — make the `.up.sql`+`.down.sql` pairing explicit for
  migration 008; (2) C-1 trading-domain — enumerate FR-19 chrome env-default per-deployment values +
  note the compose/dev/prod file updates; (3) F-07 watch — keep chrome defaults env-overridable at
  implementation (no bare literals).
- **feature-overlap: CLEAN** — no config-key / proto-field / migration / shared-source collision with any
  in-flight feature. Two notes carried forward: pin the **conditional analysis** expectancy migration at
  **010** (trunk has analysis 008/009) — done in product-spec DB section; and a **feature-number
  duplication** — `083-droplet-compose-deploy` also occupied `083` (spec-ready, disjoint files → no merge
  conflict). **RESOLVED 2026-07-31 (user decision):** renumbered `083-droplet-compose-deploy` → `084`
  (next free NNN across local + remote refs); its branch is slug-only so unaffected. This 083 keeps its
  number.
- **Next:** `/sdd-spec ui-revamp-opportunities-first` (backend→frontend ordering; step PRs target the
  feature branch directly, not base-chained; reconcile branch lineage per fails 082).

## Session 2026-07-31 — sdd-spec

- Generated implementation-spec.md with 31 steps. Status `design-approved` → `implementation-ready`.
  Ordering backend→frontend per design.md § Ordering; step PRs target the feature branch directly
  (NOT base-chained — fails.md 082).
- Consumed recon.md + design.md as authoritative inputs; reused recon's grounded `path:line` Codebase
  Map directly and did targeted inline discovery only for the design's open `/sdd-spec` decisions.
- Key codebase findings (grep-resolved the design Open Risks):
  - **Factor grouping REQUIRES `portfolio.exposure.factor_map`** — marketdata exposes no `sector`:
    `Fundamentals` proto is fields 1–17 with no sector, and screener `_FUNDAMENTAL_FIELDS`
    (`screener.py:32`) has none either. Design's "reuse marketdata sector" path is unavailable →
    config key is the actual path (Step 13, C-05-governed). Resolves "Factor source unverified".
  - **Expectancy is derivable — no analysis migration:** `analysis.backtest_runs` (migration 006)
    stores `win_rate` + `profit_factor`; expectancy = closed form from those two columns. Resolves
    "Expectancy source" toward no new schema. **Analysis migration 010 is NOT needed.**
  - **Portfolio resting-stops held in-memory — no portfolio migration:** portfolio consumes ledger
    events via `ConsumeOrderFills/PositionSyncs/BalanceSyncs` (`cmd/server/main.go:63-65`); extend
    `ConsumeOrderFills` + boot-replay (matches existing position-state-from-events pattern). Resolves
    "Portfolio stop-state storage". **Only ingest migration 008 is needed** (last is 007).
  - **New `analysis→trading` edge is real:** `TRADING_ENDPOINT` is ABSENT from the analysis block in
    `docker-compose.yml` and both `.do` specs (the `@427` hit belongs to the `xstockstrat-ui` block);
    Step 15 adds it in all three. `Order.strategy_id = 15` / `ListOrders` confirmed in trading.proto.
  - **Proto field-number floors** (all additive): analysis `ScreenResult` 1–6 → new 7+;
    portfolio `Position` 1–13 → risk fields 14+; ingest `SignalSource` 1–7 → health 8+. Four new enums,
    each `_UNSPECIFIED=0`; four exhaustive TS `Record<Enum,…>` maps authored in the same codegen PR
    (Step 2, C-10(a/d) trap).
  - **Traced evaluator is feasible:** `evaluate_with_series` (`evaluator.py:118`) + `_eval_condition`
    (`:415`, bare bool, fns >/</>=/<=/crosses_above/crosses_below) → additive sibling
    `evaluate_conditions_traced` emits per-leaf lhs_value/threshold/state/distance; conviction stays a
    deterministic ordinal (passing/total), never a probability. Hot path (`:165` frozen conviction)
    untouched.
  - **Copilot shallow beta** uses the ledger append-store (`ledger.proto:14,33,37,45`), append-only,
    no edit/delete UX — no new pool/DB/LLM (F-06 held). Ledger unchanged.
  - **strat-lab plugin NOT affected** — 083 changes none of run_backtest/manage_strategy/
    trigger_backfill/get_backfill_status/set_strategy_live; noted in Step 31 for the PR body.
- Reviewers snapshot finalized (config team added because factor_map is used; ledger/trading FYI).

## Session 2026-08-01 — sdd-execute (backend Steps 1-18 + theme Step 19), one-PR partial

Branch `claude/ui-revamp-implementation-7ras2a` (off `origin/main-dev`), single PR #832 into
main-dev (user directive: one PR, not one-per-step; push progressively; Copilot+mobile required).

**Toolchain:** Docker daemon down + `buf` absent → provisioned buf + protoc plugins via the Go
module proxy per `docs/runbooks/codegen-toolchain-host-setup.md` (GitHub-releases 403'd, proxy
fallback works). Validated byte-for-byte gen reproduction before editing protos.

**Completed + verified + pushed:**
- **Step 1-2** — additive proto pass (analysis/portfolio/ingest, 4 enums each `_UNSPECIFIED=0`);
  `buf lint`/`buf breaking` clean; codegen fresh; four exhaustive TS `Record<Enum>` maps in
  `src/lib/opportunityShared.tsx` (tsc clean).
- **Step 3-8** — analysis `evaluate_conditions_traced` + deterministic conviction ordinal
  (pure, pinned helpers), `EvaluateReadiness`, `ListOpportunities`. Red-green tests; suite 380
  passed, cov 82%.
- **Step 9-11** — ingest migration 008 (health cols) + `derive_health_status` + source-health
  enrichment + IngestSignal bookkeeping. Suite 150 passed, cov 76%.
- **Step 12-14** — `portfolio.exposure.factor_map` config + `Watcher.FactorMap()`; Position
  risk/factor on-read enrichment from an in-memory resting-stop store; `ConsumeOrderFills` stop
  capture + `HydrateStops` ledger boot-replay. go test green, golangci-lint 0.
- **Step 15-18** — `GetStrategyAnalytics` (closed-form expectancy from backtest_runs; new
  analysis→trading `ListOrders` edge wired in main.py + docker-compose + both .do specs) +
  screener `ScreenResult` raw columns (pe/rsi/atr/rev_growth) + `held` cross-ref. Tests green.
- **Step 19** — Nocturne two-file token remap + Phosphor. tsc clean.

**Deviations (recorded per C-11):**
- `ListOpportunities` conviction = the signal source's real `ExternalSignal.conviction` (a defined,
  deterministic value — never a fabricated %). Per-condition readiness (passing/total) is surfaced
  via `EvaluateReadiness` on Signal-detail/Watchlist rather than synthesized onto every queue row,
  because an external signal carries no strategy binding to evaluate at the queue. `passing/total`
  on an Opportunity are 0/0. (design.md § 1 honored — action from real data only; conviction defined.)
- `GetStrategyAnalytics.queue_share` reserved (0.0): the queue is signal-sourced and carries no
  strategy attribution to divide by.
- Screener now issues 2 extra ComputeIndicator calls/symbol (RSI/ATR) per scan for FR-8 raw columns
  (best-effort; ATR close-only caveat). Updated `TestScreenSymbols._svc` to mock the new calls.

**Remaining (Steps 20-31) — backend fully ready to serve every screen:**
- Step 20 — Decide/Discover/Engine/Book **global sidebar shell** (presentation grouping over the
  unchanged /trader|/insights|/config-ui|/accounts routes) + breadcrumb + Copilot toggle + count
  badges + pinned `accounts` surface + new-route stubs. This cuts across all four physical
  segments' layouts/AppShells — a shell rework, not a contained edit.
- Step 21 — nav-reachability e2e (C-10(a), every screen incl. accounts).
- Step 22-25 — the 12 screens wired to the now-real RPCs (Opportunities+Signal detail; Watchlists+
  Screener; Strategies+Backtest+Sources+Backfills; Exposure+Portfolio+Orders) + C-12 fixtures.
- Step 26 — per-screen + FR-20 order-parity + AC-8 valuation-parity e2e.
- Step 27 — Copilot shallow-beta rail (ledger append-store thread + client-side summary).
- Step 28 — mobile companion (shared section renderer, ≥44px).
- Step 29 — non-happy states (loading/empty/error + destructive-confirm).
- Step 30 — mobile + states e2e + coverage gate.
- Step 31 — remaining CLAUDE.md/pattern-doc reconcile + context-scrubber teardown.

**fails-082 guard:** every commit targets `claude/ui-revamp-implementation-7ras2a` directly (no
base-chained step branches). context-forge/context-scrubber plugin availability unconfirmed in this
session — flagged in the PR body per the root CLAUDE.md Teardown rule.

### Session (2026-08-01) — Step 25 (Book: Exposure + Portfolio + Orders)

- **Exposure** (`trader/positions/page.tsx`): reframed the positions table with three additive
  risk columns — Factor (`p.factor || 'Unclassified'`), Stop dist (`fmtPct(p.stopDistancePct)`,
  em-dash when no stop), Flag (`EnumBadge` over `POSITION_RISK_FLAG`, em-dash when unset) —
  consuming the Step-13 `Position` risk fields. Columns hide progressively (lg/md) like the
  existing P/L columns; no execution-path change.
- **Portfolio** (`trader/portfolio/page.tsx`): replaced the stub with the read-only broker mirror —
  `<PortfolioPanel/>` (reuses `usePortfolios`, 10s poll) + AC-8 / C-10(b) `data-testid="ledger-disclaimer"`
  footer ("xstockstrat never writes to the ledger …"). No new fixture — reuses `PORTFOLIO_ALPACA`.
- **Orders** (`components/trader/OrdersTable.tsx`): added the Origin column (strategy-or-Manual) with a
  Why?-trace link to `/insights/strategies/<id>` when `order.strategyId` is set, else plain "Manual"
  (`data-testid="order-origin-<id>"`). Status/type still render via the reused `orderShared` maps
  (FR-20 parity unchanged); no order-submission gate touched.
- **Mock backend**: AAPL `listPositions` row now carries `stopPrice/riskAtStop/stopDistancePct/factor/flag/exitRule`
  (distinguishable values, insights.md 2026-07-27); MSFT carries none → exercises the fallbacks.
- **e2e** (Step-25 slice, red-green in the Step-26 sense folded here): `e2e/trader/positions.spec.ts`
  (asserts Tech factor + 6.20% stop dist + Stop-near flag on AAPL, Unclassified on MSFT) and
  `e2e/trader/portfolio.spec.ts` (Equity + ledger-disclaimer). Full trader suite + nav-reachability
  green (49 passed). The FR-20 order-parity + AC-8 valuation-parity dedicated specs remain Step 26.

### Session (2026-08-01) — Step 26 (parity e2e) + deferred FR-6 order ticket

- **FR-6 order ticket (deferred piece landed here)**: added `SignalOrderTicket.tsx` — a
  re-presentation of the trader `OrderForm` on the Decide → Signal-detail page
  (`insights/market/[symbol]/page.tsx`), pinned to the route symbol. Because the insights layout
  provides only React Query, the ticket wraps `AccountProvider` (broker accounts + trading
  environment sourced cross-segment via the /trader BFF). Added an optional `initialSymbol` prop to
  `OrderForm` (backward-compatible: `initialSymbol || ?symbol || ''`) so the ticket pre-fills the
  signal's symbol. Signal detail is now two-column from lg (why-it-fired left, ticket right).
  Execution semantics unchanged (FR-20) — same `usePlaceOrder` path, environment-fixed PAPER/LIVE.
- **FR-20 order parity** (`e2e/trader/order-parity.spec.ts`): asserts all 5 `OrderType` labels +
  both PARTIALLY_FILLED and FILLED render in the Orders table (shared `orderShared` maps), and the
  Signal-detail ticket offers the same 5-type selector + symbol pre-fill. Rich 5-order set supplied
  via `page.route` ListOrders (distinguishable fields, insights.md 2026-07-27).
- **AC-8 valuation parity** (`e2e/trader/valuation-parity.spec.ts`): AAPL's unrealized P&L is
  asserted identical (+$100.00) on Book → Portfolio (ListPortfolios / PortfolioPanel) and
  Book → Exposure (ListPositions). Aligned the mock backend's AAPL `listPositions` unrealizedPnl
  98.0 → 100.0 to match `PORTFOLIO_ALPACA` — the one broker-authoritative source (C-10(b) seam).
- **Verification**: trader + insights + nav e2e green (115 passed, 1 pre-existing chart-panel flake
  passed on retry); `pnpm run test:coverage` 100% on exercised `src/lib/**` (feature-065 ≥40% gate).
  Mock RPC handlers for ListOpportunities/EvaluateReadiness/GetStrategyAnalytics/enriched
  ScreenResult/source-health/risk-Position were already added with the Step 22-25 screens.

### Session (2026-08-01) — Step 27 (Copilot shallow-beta rail)

- **Rail** (`components/copilot/CopilotRail.tsx`): 310px, default off, global (mounted in
  PlatformHeader so all four segments get it via one seam). Two client-side templated reads
  (queue summary + concentration flag — pure helpers in `src/lib/copilot.ts`, no LLM), an
  append-only note thread replayed from the ledger, and the beta footer "MCP · N tools ·
  read-only unless you confirm". No edit/delete/clear affordance (append-only, F-06).
- **ChromeContext** (`context/ChromeContext.tsx`): `showCopilot` (default false) + toggle;
  provider mounted inside PlatformHeader; a Sparkle toggle button in the top bar (accent-filled
  when active, `aria-pressed`).
- **Ledger wiring (deviation from spec's insightsBff)**: LedgerService lives in `traderBff.ts`
  (browser `ledgerClient` → /trader/api), so the copilot thread routes went there, not insightsBff.
  `appendEvent` forces `stream_key=copilot:<user>:default` + `event_type=copilot.message` +
  `source=xstockstrat-ui` server-side from the verified session; `queryEvents` rewrites any
  `copilot:`-prefixed client key to the per-user thread (lineage `order:` keys pass through). The
  browser never learns the user id and can only read/write its own thread. Ledger proto UNCHANGED.
- **Summary source (beta simplification)**: reads `ListOpportunities` only; the design's "+ position
  weights" fold-in is deferred — concentration is a queue-concentration heuristic, noted in the copy.
- **Tests**: `src/lib/copilot.test.ts` (7 unit tests over the pure helpers — counts toward the 065
  coverage gate); `e2e/copilot.spec.ts` (default-off + toggle, queue/flag/footer, note persist+replay)
  with `e2e/fixtures/copilotThread.ts` (+ INVENTORY row) + mock-backend in-memory `copilotThreads`
  store (`appendEvent`/`queryEvents`). Full e2e suite green (168 passed); unit 36 passed.

### Session (2026-08-01) — Step 28 (mobile companion)

- **SectionRenderer** (`components/mobile/SectionRenderer.tsx` + `sections.ts`): the one shared
  mobile renderer for the 8 section kinds (head/stat/signal/chart/row/form/note/action). All
  interactive rows ≥44px (FR-16). Drawn behind `sm:hidden` next to the desktop layout so the two
  stay in lock-step (no divergent mobile tree).
- **BottomTabBar** (`components/mobile/BottomTabBar.tsx`): fixed mobile bottom nav over the four
  primary groups (Decide/Discover/Engine/Book), mobile-only, ≥56px targets, active-by-pathname.
  Mounted globally in PlatformHeader; content wrappers get `pb-20 sm:pb-0` clearance.
- **Nav model extraction (cycle fix)**: `NAV_GROUPS` + the nav interfaces moved to
  `components/shared/navGroups.tsx`. Before this, BottomTabBar importing `NAV_GROUPS` from
  PlatformHeader (which imports BottomTabBar) formed an import cycle → `ReferenceError: Cannot
  access 'F' before initialization` at prerender of `/config-ui/audit`. Both the header and the
  tab bar now import from the standalone module — one source of truth, no cycle.
- **First consumer**: the Opportunities queue renders 1:1 on mobile via SectionRenderer (one
  `signal` section per row) with the desktop table `hidden sm:block`. Broader per-screen adoption
  of the section model is incremental follow-up — the primitive, the nav, and the responsive
  screens already deliver phone parity + navigation.
- **Tests**: `e2e/mobile.spec.ts` (bottom bar + 4 ≥44px targets, section renderer vs table,
  cross-group nav). Full build green after the cycle fix; mobile+copilot+nav e2e 8 passed.

### Session (2026-08-01) — Steps 29+30 (non-happy states + states/mobile e2e + gate)

- **Primitives**: added `components/ui/skeleton.tsx` (Skeleton) + `components/shared/EmptyState.tsx`.
  Deviation: the spec listed a `CardError` too, but `CardNotice variant="error"` +
  `QueryStateMessages` already cover per-card errors — added a third near-duplicate would trip the
  DRY guard rail, so errors reuse the existing primitives (documented).
- **Applied to** the flagship Decide (Opportunities: skeleton rows desktop+mobile, EmptyState on
  no-match, error copy) and Book (positions/Exposure: skeleton rows + EmptyState) screens. The
  other Steps 22-25 screens already carried loading/empty/error states inline from those steps;
  the new primitives standardize the pattern. Backfills destructive-confirm (typed symbol +
  "DELETE ALL") is unchanged (FR-5) — verified by e2e.
- **e2e** `e2e/non-happy-states.spec.ts` (RED-green): Opportunities loading skeleton → data,
  empty-state on no-match, per-card error on a 500 (retry:1), and the Backfills whole-symbol
  delete staying gated until both typed confirmations match. Mobile e2e (Step 28) complete.
- **Gate (AC-11)**: full Playwright suite green — **174 passed** (1 pre-existing chart-panel
  timeframeEnum flake, passed on retry); `pnpm run test:coverage` 99% on exercised `src/lib/**`
  (≥40% floor, feature-065).

### Session (2026-08-01) — Step 31 (docs reconcile + teardown) + close-out

- **Service CLAUDE.md**: `analysis` (added a Decide-surface RPC subsection —
  ListOpportunities/EvaluateReadiness/GetStrategyAnalytics, the conviction/`taken`/`queue_share`
  quirks; env vars + dependency edges were already present from the backend steps); `ui`
  (new "Opportunities-first shell (feature 083)" section — nav grouping + navGroups cycle rule,
  Decide screens, opportunityShared maps, Copilot rail + ledger thread, mobile companion, state
  primitives — plus Key File Paths rows). `portfolio` / `ingest` CLAUDE.md and the
  config-governance `factor_map` registered-keys row were already reconciled during Steps 12/9/12.
- **Pattern docs**: `header-propagation.md` gains a "Request-scoped outbound edges" note recording
  the new non-cyclic **analysis → trading** (`ListOrders`) edge (headers already forwarded via the
  feature-049 analysis servicer path — no new wiring).
- **Spec/lifecycle**: flipped all 31 implementation-spec step statuses to `done`; feature.md
  Lifecycle Status → `code-completed`.
- **context-scrubber teardown**: the `/context-scrubber` skill is **not invocable in this session**
  (only the SDD + a few skills are listed; `.agents/context-forge.json` exists but the plugin
  isn't loaded). Per the root CLAUDE.md Teardown rule this is flagged in the PR body; I did a
  manual grounded-drift reconcile of every touched context file instead. README (a scrubber
  target) stays accurate — 083 didn't change the physical segments it describes.
- **fails-082 guard**: every commit (Steps 1–31) targeted `claude/ui-revamp-implementation-7ras2a`
  directly — no base-chained per-step branches. strat-lab plugin unaffected (083 changes none of
  its tracked RPCs). Feature is code-complete; full e2e (174) + unit coverage (99% on exercised
  `src/lib`) green.

### Session (2026-08-01) — Handoff-fidelity pass (user-requested): B Opportunities cards

User reviewed the deployed app vs `design-handoff/` and asked to close **B (Opportunities cards)**
and **E (per-screen fidelity)** (skipping A sidebar, C mobile-companion page, D copilot polish).

- **Opportunities queue rebuilt table → conviction cards** matching the handoff card grammar: a
  left edge/conviction number (+ N/M conditions), ticker + action tag + source chip + strategy,
  thesis, expiry, and **Review & add / Snooze** buttons. Snooze is a real client-side dismiss.
- **5-stat row reframed to the handoff**: Actionable now (of N evaluated · conv ≥ X) · Expiring
  <90m (+tickers) · Exit/trim flags (+tickers) · Fresh entries · **Deployable** (real broker
  buying power via `insightsPortfolioClient.listPortfolios`, best-effort → "—" on error).
- **Controls added**: Any-action filter + sort (Conviction / Soonest expiry) alongside the source
  chips + min-conviction slider.
- **No-fabrication constraint honored**: the handoff card also shows live price/change %, a
  sparkline, per-condition value chips (`close > sma_20 +1.4%`), and R:R + share sizing — **none
  of which `ListOpportunities` returns**. These are intentionally omitted (not faked); surfacing
  them is a backend-extension follow-up (new `Opportunity` fields + a marketdata quote/bars read).
- Mobile keeps the SectionRenderer 1:1 (Step 28). e2e updated (cards not table); full suite green
  (175 passed, 1 pre-existing chart-panel flake).

### Handoff-fidelity pass — E: Exposure (Book) risk reframe

- **Header reframed** "Positions" → **"Exposure"** with the risk description + a "N exit flags in
  queue →" button (count of REDUCE_SIGNAL/STOP_NEAR positions, links to Opportunities).
- **4-stat risk row added** (all from real Position risk fields): Total risk at stops (Σ riskAtStop),
  Largest factor (weight-share by factor + tickers), Positions past target (Open R ≥ 2), Stops
  within 2% (stopDistancePct ≤ 0.02).
- **Risk columns added**: Weight (share of loaded gross MV), **Open R** (unrealizedPnl / riskAtStop),
  Risk at stop ($), Exit rule — alongside the Factor/Stop-dist/Flag from Step 25. The existing P&L
  columns, filters, pagination, and fill-lineage detail sheet are kept (no regression).
- e2e extended (Exposure header + stat row + Open R/Risk-at-stop); full suite green (176 passed).

### Handoff-fidelity pass — E: Portfolio (Book) rebuild

- Rebuilt the Book → Portfolio page (was a thin PortfolioPanel wrapper) to the handoff: header +
  "See risk in Exposure →" link, a **combined 5-stat row** (equity/cash/buying-power/day-P&L/
  total-P&L summed across accounts via `usePortfolios(null)`), **one card per account** (Alpaca +
  IBKR), and the **broker-reported positions table** (`usePositions`, full columns) with the
  refreshed ledger disclaimer. PortfolioPanel is unchanged (still used by the trader dashboard).
- **Shared `src/lib/money.ts`** (fmtUsd/fmtSignedUsd/fmtPct/pnlClass) extracted and adopted by
  Portfolio + Exposure (was inlined per page — DRY guard rail).
- Mock `listPortfolios` widened to both accounts (PORTFOLIOS) so the combined view renders; e2e
  updated (combined stats + 2 cards + positions table). valuation-parity (AC-8) still green; full
  suite 177 passed.

### Handoff-fidelity pass — E screens 3–8 (Screener, Orders, Strategies, Signal detail, Watchlists, Backfills)

- **Screener**: "Candidates · N of M passed" summary + Score-column coloring (≥0.8 gain / ≥0.7 accent).
- **Orders**: signal-trace description, Origin→"From signal" label, Placed (HH:MM from createdAt) column.
- **Strategies**: aggregate stat row (active/registered/scored/blended score) + Active/Paused/Off state
  badge per card (from active + live_enabled — never Live/Paper). Per-row analytics table is a
  per-strategy-analytics follow-up.
- **Signal detail**: strategy track-record block (Signals 30d / Taken / Hit rate / Expectancy) via
  GetStrategyAnalytics on the selected strategy. Order-ticket sizing rows omitted (no per-signal
  sizing data).
- **Watchlists**: header reframed to the readiness-not-price framing (the readiness table + "N ready"
  landed in Step 23).
- **Backfills**: job stat row (jobs running/completed/symbols covered/bars stored/needs attention)
  from the polled BackfillJob list + ADMIN ONLY badge. Backtest (feature 068) already ships the
  coverage-gap notice + day-by-day debug table — left unchanged.
- Shared: `src/lib/money.ts` + `src/components/shared/StatTile.tsx` now back the Opportunities,
  Exposure, Portfolio, Signal-sources, Strategies and Backfills stat rows (DRY). Each screen's e2e
  extended; per-screen commits pushed to PR #832.

## Session 2026-08-01 (CI: feature status automation)

- Promotion PR #834 merged to main
- Feature promoted and committed: 37a7f5269454eadb810c4303d5100063e4f35eed
- Status updated: `code-completed` → `launched`
- Launched date: 2026-08-01

### Handoff-fidelity — second review pass (deployed-screenshot feedback)

User flagged the deployed Strategies + Watchlists as still low-fidelity:
- **Strategies**: the list still rendered the legacy 065 score cards (Overall Score / Drawdown /
  Sharpe / Win_rate + rating grade) instead of the handoff table, and "N active" double-counted
  paused strategies. Rebuilt into the handoff **analytics table** (Strategy / State / Signals 30d /
  Taken / Hit rate / Expectancy / Max DD / Score / Open) with **per-row GetStrategyAnalytics**;
  fixed the count so "Active" = active && live_enabled (paused counted separately) — header, stat
  tile and per-row State badges now agree.
- **Watchlists**: upgraded the flat state-dot + N/M list to per-symbol rows with a **readiness bar**
  (conviction) + **firing / N-away** state + the **blocking condition** (first not-yet-passing
  leaf), sorted by conviction — all from the EvaluateReadiness `conditions`. Live price/change
  columns remain omitted (no per-symbol quote in the readiness payload).
- Full suite 180 passed; specs updated for both rebuilds.

### Handoff-fidelity — Screener mobile responsiveness fix

- The Screener results table was a **raw `<table>`** (not the shared `<Table>` component, which
  wraps in `overflow-auto`), so its 10 columns overflowed the phone frame horizontally and clipped
  the Status column. Wrapped it in `overflow-x-auto` + `min-w-[640px]` so the wide table scrolls
  inside its own container and the page body never scrolls horizontally. Added a phone-viewport
  e2e guard asserting `scrollWidth <= clientWidth`. (The strategy-detail Past-Runs raw table was
  already `overflow-x-auto`-wrapped by feature 068 — no change.)
