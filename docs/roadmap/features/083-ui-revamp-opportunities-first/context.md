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
