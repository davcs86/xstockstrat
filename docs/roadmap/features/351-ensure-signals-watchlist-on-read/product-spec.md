# Product Spec: ensure-signals-watchlist-on-read

**Created**: 2026-11-16

---

## Problem Statement

Feature 127's system-managed "Signals" watchlist is created only by the agent's `ingest_signal(direction="watchlist")` post-commit side effect (`EnsureSignalWatchlist`). Migration `011` adds the `system_managed` column and indexes but inserts no rows, and portfolio's schema cannot enumerate users. A user who has never ingested a watchlist-direction signal — Homelab staging, which holds only "DB workload test" and "Test" — therefore has no system list, and operators read that as a missing-migration defect. Grafana (30 d) shows no agent/portfolio failure logs, so this is a design gap, not a failed side effect.

## User Story

As a platform user, I want my system "Signals" watchlist to exist whenever I list my watchlists, so that I can see and use it before the first signal is auto-added.

## Functional Requirements

FR-1. `ListWatchlists` for the caller ensures that user's single system-managed watchlist exists (default name "Signals") and returns it in the result, idempotently.
FR-2. The ensure uses the existing race-safe `EnsureSystemManaged` path (`ON CONFLICT (user_id) WHERE system_managed`), so concurrent list/ingest calls yield exactly one system list per user.
FR-3. The ensure runs only on the first page (empty `page_token`); continuation pages never write.
FR-4. An ensure failure never fails the read: `ListWatchlists` returns the user's existing lists and logs a WARN carrying the original error (fail-open).
FR-5. Existing behavior is unchanged: a user who already has a system list gets no new row, the delete guard (`FAILED_PRECONDITION`) still applies, and a same-named manual list coexists.
FR-6. Existence, not page placement, is guaranteed: `ListByUser` orders by `watchlist_id` (a random UUID), so with a `page_size` smaller than the user's list count the system list may be returned on a later page; the ensure still ran on the first-page call.
FR-7. Documentation that calls the agent `list_watchlists` tool "read-only" (`services/xstockstrat-agent/app/tools.py:33`, `docs/runbooks/mcp-tools.md:1382`) states that the call idempotently ensures the caller's system "Signals" list. No MCP tool contract (name, parameters, return shape) changes.

## Out of Scope

- A migration or operator job that seeds lists for existing users (rejected: portfolio has no users table; migrations stay inside their schema).
- Ensure on user creation (identity → portfolio dependency).
- Any proto, config, UI, or agent-tool code change.
- Counting the system list against `watchlist.max_per_user` (`EnsureSignalWatchlist` already bypasses it).
- Changing `ListWatchlists` pagination order or guaranteeing the system list lands on page 1 (FR-6).

## Affected Services

- `xstockstrat-portfolio` — `ListWatchlists` (`internal/service/portfolio_service.go`) calls the existing `EnsureSystemManaged` store method.
- `xstockstrat-agent` — docs/docstring wording only (FR-7); no tool-contract or code-path change.
- `xstockstrat-analysis` — **unchanged caller, behavioral side effect**: `app/engine/live_loop.py` `_drain_watchlist` (~603) calls `ListWatchlists` per live-strategy owner with that owner's synthetic `x-user-id` (`owner_metadata(owner)`, C-03 — never the `system` identity), memoized per cycle. Each such owner will now get an empty system "Signals" list as a one-time side effect. The empty list adds no symbols, so the symbol set the loop reads is unchanged.

## Consumer Surface(s)

- [x] **UI** — `xstockstrat-ui` `/insights` watchlists page lists via `ListWatchlists`; no code change, the "Signals" list (with its feature-127 undeletable affordance) now appears for every user. Reachable per **C-10** already (feature 058).
- [x] **Agent** — `xstockstrat-agent` MCP `list_watchlists`: no code change; it now returns the system list for users who never ingested a signal. Its "(read-only)" wording in `tools.py:33` and `docs/runbooks/mcp-tools.md:1382` is updated (FR-7). The tool is not annotated with an MCP `readOnlyHint` (grep of `app/` found none), so no annotation changes.
- [ ] **None**

## Proto Contract Changes

- [x] No proto changes required

## Config Key Changes

- [x] No new config keys

## Database Changes

- [x] No schema changes

## Feature Workflow Notes

Branch to create: `feature/ensure-signals-watchlist-on-read` (branch from `main-dev`)
Approval gates required (per docs/runbooks/feature-workflow.md):
- [x] 1 service owner approval (portfolio)
- [ ] 2 service owners + platform lead (breaking proto change)
- [ ] DBA review + service owner (schema migration)

## Acceptance Criteria

See `acceptance.feature` (scenarios `@AC-*`) — the single source of acceptance truth (Constitution
**C-15**). Each `FR-N` above is covered by ≥1 tagged scenario there.

## Open Questions

All items below are resolved for the spec gate. The two marked *assumption* are the author's calls, not operator decisions, and must be confirmed or reversed at the `/sdd-design` approval gate.

- [x] **Design constraint (fails.md, feature 127):** `CreateWatchlist` collapses a `UNIQUE(user_id,name)` collision to `CodeInternal`; the ensure goes through `EnsureSystemManaged` only (never create-by-name) and logs the original error — carried by FR-2/FR-4.
- [x] **Read-only DB connection:** no. `ListWatchlists` runs on the single shared pool; the only read-only transaction in portfolio is the `backfill-signal-expiry` subcommand (`internal/repository/signal_expiry_backfill.go:203`), a separate path. Tool annotation: none exists (see Consumer Surface).
- [x] **`watchlist.max_per_user`:** *assumption* — the system list is not counted, matching `EnsureSignalWatchlist`; recorded as Out of Scope.
- [x] **Fail-open on ensure error (FR-4):** *assumption* — a transient write failure must not break the watchlists page; the WARN carries the original gRPC/DB error.
- [x] **analysis callers (`live_loop.py`, `servicer.py`):** verified at `live_loop.py:598-610` — they forward the owner's `x-user-id`, so the ensure targets the real user; the side effect is documented under Affected Services. `ListWatchlists` without a user still returns `InvalidArgument "missing user identity"` via `requireUserID` before any ensure.
