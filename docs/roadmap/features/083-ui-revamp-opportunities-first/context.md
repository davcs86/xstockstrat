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
