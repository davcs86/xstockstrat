# Product Spec: watchlist-management

**Created**: 2026-06-26
**Priority Bucket**: P1 — Foundation for the screener initiative (1 of 6)

---

## Problem Statement

There is no persisted notion of a user-defined symbol set on the platform (no watchlist/symbol-group
message exists in `portfolio.proto`; no watchlist table exists in the `portfolio` migrations 000–006).
Every list of symbols today is ad-hoc per request. The screener (060) and the fundamentals-signal
producer (062) need a durable, per-user universe to scan.

## User Story

As a **trader curating ideas**, I want to save and edit named lists of symbols, so that I can re-run a
screen or chart against the same universe without retyping tickers.

## Functional Requirements

FR-1. Add watchlist CRUD RPCs to `PortfolioService`: `CreateWatchlist`, `GetWatchlist`,
`ListWatchlists`, `UpdateWatchlist` (rename/description + replace symbols), `DeleteWatchlist`, plus
`AddWatchlistSymbols` / `RemoveWatchlistSymbols` for incremental edits.

FR-2. Every watchlist is **owned by `user_id`** (taken from the propagated `x-user-id` header per
`docs/patterns/header-propagation.md`) — a user may only read/mutate their own. No cross-user access.

FR-3. Symbols are stored uppercased and de-duplicated within a list; a list enforces a per-user count
cap and a per-list symbol cap (config, FR-7).

FR-4. `ListWatchlists` is paginated using `common.v1.PageRequest`/`PageResponse`.

FR-5. The `xstockstrat-ui` insights segment gains a **Watchlists** page
(`src/app/insights/watchlists/page.tsx`) to create/rename/delete lists and add/remove symbols, using
the existing React-Query + browser-`connect-web` client pattern (`src/lib/browserClients/`, BFF
`/insights/api`). Covered by a Playwright E2E.

FR-6. Watchlist mutations emit ledger events (`portfolio.watchlist.created` / `.updated` /
`.deleted`) for auditability, consistent with the service's existing ledger usage; ledger failure is
non-fatal.

FR-7. Behavior is bounded by config keys (below), not hardcoded.

## Out of Scope

- Screening/ranking logic (Feature 060).
- Sharing watchlists between users.
- Auto-population from signals.
- `trading_mode`/`account_id` scoping — watchlists are mode-agnostic (a deliberate departure from
  `portfolio.positions`; see Resolved Decisions).
- Real-time price decoration of the list (the trader chart already covers quotes).

## Affected Services

Exact service names from CLAUDE.md Service Registry:
- `xstockstrat-portfolio` — owns the watchlist RPCs + tables.
- `xstockstrat-ui` — insights `watchlists` page.
- `xstockstrat-config` — new `portfolio.watchlist.*` keys.
- `xstockstrat-ledger` — event writes (no contract change).

## Proto Contract Changes

- **Changes required (all additive → non-breaking):**
  - `packages/proto/portfolio/v1/portfolio.proto` — new `Watchlist` message (`watchlist_id`,
    `user_id`, `name`, `description`, `repeated string symbols`, `created_at`, `updated_at`) and the
    7 RPCs (FR-1) with their request/response messages. Reuse `common.v1.PageRequest`/`PageResponse`.
  - Regenerate stubs via `./scripts/buf-gen.sh` (Go, Python, Connect-ES browser, grpc-js TS, Python grpc).

## Config Key Changes

- `portfolio.watchlist.max_per_user` (int, default `50`)
- `portfolio.watchlist.max_symbols_per_list` (int, default `500`)

## Database Changes

New migrations `007_watchlists.up.sql` / `.down.sql` in `services/xstockstrat-portfolio/migrations/`
(next free number after the applied `006_positions_day_pnl`):
- `portfolio.watchlists(watchlist_id uuid PK default gen_random_uuid(), user_id text NOT NULL,
  name text NOT NULL, description text NOT NULL default '', created_at timestamptz default now(),
  updated_at timestamptz default now(), UNIQUE(user_id, name))`
- `portfolio.watchlist_symbols(watchlist_id uuid NOT NULL REFERENCES portfolio.watchlists ON DELETE
  CASCADE, symbol text NOT NULL, added_at timestamptz default now(), PRIMARY KEY(watchlist_id, symbol))`
- Index: `idx_watchlists_user (user_id)`.
- Follows the existing `user_id text NOT NULL` ownership convention. **No new DB pool** (reuses
  portfolio's pgxpool; connection budget unchanged at 2).

## Feature Workflow Notes

Branch to create: `feature/watchlist-management` (branch from `main-dev`)
Approval gates required (per docs/runbooks/feature-workflow.md):
- [x] 1 service owner approval (additive proto change)
- [ ] 2 service owners + platform lead (breaking proto change) — N/A, all additive
- [x] DBA review + service owner (schema migration)

## Acceptance Criteria

1. `CreateWatchlist`→`GetWatchlist` round-trips a named list; symbols stored uppercased/de-duped.
2. A user cannot read or mutate another user's watchlist (`PermissionDenied`); proven by a test with
   two `x-user-id`s.
3. Caps are enforced from config (exceeding `max_symbols_per_list` → `InvalidArgument`), and lowering
   the config cap is honored on the next mutation.
4. `migrate up` then `migrate down` cleanly creates/drops both tables (up+down pair).
5. UI Playwright E2E: create a list, add two symbols, remove one, delete the list.

## Resolved Decisions

- [x] **Mode-agnostic** (OQ-058-a): a screening universe is mode-independent; positions are
  mode-scoped because fills are. Add `trading_mode` later only if a concrete need appears.
- [x] **Hard delete + ledger event** (OQ-058-b): the append-only ledger is the audit trail; no
  tombstone. `ON DELETE CASCADE` cleans symbols.
- [x] **Owned by `xstockstrat-portfolio`** (OQ-058-c): it already scopes everything by `user_id` and
  is the screener's natural neighbor; identity stays auth-only.

## Open Questions

- [ ] None — all resolved during design (see Resolved Decisions).
