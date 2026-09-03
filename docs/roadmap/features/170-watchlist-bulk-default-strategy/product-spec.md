# Product Spec: watchlist-bulk-default-strategy

**Created**: 2026-09-03

---

## Problem Statement

Managing a watchlist's symbol→strategy bindings today is strictly one-symbol-at-a-time (per-row
`UpdateWatchlistBinding`, single-row remove), which is tedious for lists of dozens of symbols. There
is also no way to declare a watchlist's intended strategy once, so every newly-added symbol lands
**unbound** and must be rebound by hand. Traders curating watchlists want to (a) act on many symbols
at once and (b) set a sensible default strategy for the list.

## User Story

As a trader curating an Insights watchlist, I want to multi-select symbols to remove or re-strategy
them in one action, and to set a default strategy for the watchlist, so that I can keep a large list's
strategy bindings correct without repetitive per-row edits.

## Functional Requirements

FR-1. **Bulk symbol removal (UI).** In the watchlist detail view the user can select multiple symbols
via row checkboxes and remove the whole selection in one action, backed by the existing
`RemoveWatchlistSymbols` RPC (already accepts a repeated `symbols` list). After removal the selection
is cleared and the list reflects the remaining symbols.

FR-2. **Bulk strategy assignment (new atomic RPC).** The user can select multiple symbols, pick one
strategy (including the "unbound"/`""` sentinel), and apply it to the entire selection in a single
**atomic** call. A new `UpdateWatchlistBindings` (plural) RPC on `xstockstrat-portfolio` rebinds the
selected `(watchlist_id, symbol[])` to the chosen `strategy_id` in one transaction with a single
`updated_at` bump — no partial-failure state is observable. Symbols in the request that are not
present in the watchlist are rejected (`NOT_FOUND` / `INVALID_ARGUMENT`, mirroring single-row
`UpdateWatchlistBinding`), and the write is scoped to the caller's `x-user-id`-owned watchlist.

FR-3. **Default strategy setting (data model + UI + agent).** A watchlist carries an optional
watchlist-level `default_strategy_id` (`""` = none). It is set/cleared through `CreateWatchlist` /
`UpdateWatchlist` and the agent `manage_watchlist` tool, persisted on the `portfolio.watchlists` row,
and shown as a control in the watchlist detail view.

FR-4. **Add-time default binding (add-time only).** When a symbol is added to a watchlist **without an
explicit strategy binding** (bare symbol / binding with `strategy_id == ""`) and the watchlist has a
non-empty `default_strategy_id`, the symbol is bound to the default strategy at insert time. An
explicit per-symbol `strategy_id` on the add request always wins over the default. This is **add-time
only**: setting or changing `default_strategy_id` does **not** retroactively rebind any existing
symbol, and the default is **never** a dynamic read-time fallback for unbound rows. This rule is
applied consistently across every symbol-insert path — `CreateWatchlist` (initial symbols/bindings),
`AddWatchlistSymbols`, and the agent `manage_watchlist_symbols` add path.

FR-5. **Agent parity.** The agent MCP tools expose the new capability at parity with the UI:
`manage_watchlist` accepts/returns `default_strategy_id`, and bulk strategy assignment is reachable
from the agent (via `manage_watchlist_symbols` or an equivalent tool operation). `docs/runbooks/mcp-tools.md`
is updated in the same PR (C-10 tool-doc parity).

## Out of Scope

- Bulk delete of **entire watchlists** from the list view (this feature's "bulk delete" is
  symbols-within-a-watchlist only — confirmed with requester).
- Any dynamic / read-time application of the default strategy to already-unbound symbols, and any
  retroactive rebind of existing symbols when the default changes (explicitly excluded per FR-4).
- A global (config-service) default strategy — `default_strategy_id` is per-watchlist data, not a
  `xstockstrat-config` key.
- Cross-service validation that `default_strategy_id` / the bulk-assign `strategy_id` names an
  existing analysis `StrategyDefinition` (the binding is a bare string with no FK today; unchanged).

## Affected Services

Exact service names from CLAUDE.md Service Registry:
- `xstockstrat-portfolio` — owns watchlists (feature 058); new `default_strategy_id` column + read/write,
  new `UpdateWatchlistBindings` RPC, add-time default applied in all insert paths.
- `packages/proto` — additive `Watchlist` / `CreateWatchlistRequest` / `UpdateWatchlistRequest` field +
  new `UpdateWatchlistBindings` RPC and request/response messages in `portfolio/v1/portfolio.proto`.
- `xstockstrat-ui` — Insights watchlist detail: multi-select, bulk-remove, bulk-assign, default-strategy control.
- `xstockstrat-agent` — `manage_watchlist` (default_strategy_id) + bulk strategy assignment parity;
  `mcp-tools.md` update.

## Consumer Surface(s)

_Constitution **C-14**._

- [x] **UI** — `xstockstrat-ui` segment `/insights` (watchlist detail page
  `src/app/insights/watchlists` / `WatchlistDetail.tsx` / `WatchlistReadiness.tsx`): row checkboxes +
  bulk action bar (remove, assign strategy), plus a watchlist-level default-strategy `Select`. The
  route is already registered in `PLATFORM_SUBNAV` (C-10 satisfied — this extends an existing
  reachable page; fails.md 058/060 nav-reachability trap does not recur).
- [x] **Agent** — `xstockstrat-agent` MCP tools `manage_watchlist` (adds `default_strategy_id` arg +
  return field) and `manage_watchlist_symbols` (bulk strategy-assignment operation).
- [ ] **None**

## Proto Contract Changes

- [ ] No proto changes required
- **New (all additive, non-breaking) in `packages/proto/portfolio/v1/portfolio.proto`:**
  - `Watchlist.default_strategy_id` — new field (next free number on the message; `""` = none).
  - `CreateWatchlistRequest.default_strategy_id` and `UpdateWatchlistRequest.default_strategy_id` —
    new fields (next free numbers). Update keeps replace semantics for the field.
  - New RPC `UpdateWatchlistBindings(UpdateWatchlistBindingsRequest) returns (UpdateWatchlistBindingsResponse)`
    — `{ watchlist_id, repeated string symbols, string strategy_id }` in, updated bindings + list-level
    `updated_at` out (mirroring the single-row `UpdateWatchlistBinding` shape).

## Config Key Changes

- [x] No new config keys (default strategy is per-watchlist data, not global config).

## Database Changes

- [ ] No schema changes
- **Migration `015` in `services/xstockstrat-portfolio/migrations/`** (next free number; `014` is
  highest): `ALTER TABLE portfolio.watchlists ADD COLUMN default_strategy_id TEXT NOT NULL DEFAULT ''`
  (additive, backfill-safe; matches the `watchlist_symbols.strategy_id TEXT NOT NULL DEFAULT ''`
  precedent from migration `008`). Paired `.down.sql` drops the column.

## Feature Workflow Notes

Branch to create: `feature/watchlist-bulk-default-strategy` (branch from `main-dev`)
Approval gates required (per docs/runbooks/feature-workflow.md):
- [x] 1 service owner approval (non-breaking proto — additive fields + new RPC; `buf breaking` must stay green)
- [ ] 2 service owners + platform lead (breaking proto change) — not applicable (additive only)
- [x] DBA review + service owner (schema migration 015)

## Acceptance Criteria

See `acceptance.feature` (scenarios `@AC-*`) — the single source of acceptance truth (Constitution
**C-15**). Each `FR-N` above is covered by ≥1 tagged scenario there.

## Design Must Address (resolved directives — not open questions)

These are settled behaviors carried forward from the Ledger; `/sdd-design` and `/sdd-spec` must
honor them, and they are already covered by the acceptance scenarios noted:

- **Known trap (fails.md:1147)** — the new `UpdateWatchlistBindings` write MUST scope by watchlist
  ownership (`user_id` from `x-user-id`), never a bare `WHERE watchlist_id/symbol`. Mirror the
  single-row `UpdateWatchlistBinding` ownership guard. (Covered by `@AC-5`.)
- **Known trap (fails.md:37/056)** — the add-time default (FR-4) must be applied in **every** insert
  path (`CreateWatchlist`, `AddWatchlistSymbols`, agent `manage_watchlist_symbols` add). Design must
  name each path so none is silently left out and the paths diverge. (Covered by `@AC-7`, `@AC-10`.)
- **Known trap (fails.md:1372/112)** — bulk-selection UI state must reset/clear when the user switches
  the active watchlist (instance-local state was lost on unmount in feature 112). (Covered by `@AC-13`.)

## Open Questions

- [ ] Should the bulk strategy-assignment agent surface be a new `operation` on
  `manage_watchlist_symbols`, or a dedicated tool? (Resolve in `/sdd-design` — leaning toward an
  operation to avoid tool-count churn across the six MCP inventory surfaces.)
