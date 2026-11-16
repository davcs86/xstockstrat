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

## Out of Scope

- A migration or operator job that seeds lists for existing users (rejected: portfolio has no users table; migrations stay inside their schema).
- Ensure on user creation (identity → portfolio dependency).
- Any proto, config, UI, or agent-tool code change.
- Counting the system list against `watchlist.max_per_user`.

## Affected Services

- `xstockstrat-portfolio` — `ListWatchlists` (`internal/service/portfolio_service.go`) calls the existing `EnsureSystemManaged` store method.

## Consumer Surface(s)

- [x] **UI** — `xstockstrat-ui` `/insights` watchlists page lists via `ListWatchlists`; no code change, the "Signals" list (with its feature-127 undeletable affordance) now appears for every user. Reachable per **C-10** already (feature 058).
- [x] **Agent** — `xstockstrat-agent` MCP `list_watchlists`: no code change; it now returns the system list for users who never ingested a signal. `docs/runbooks/mcp-tools.md` wording to be checked at design.
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

- [ ] Known trap (fails.md, feature 127): `CreateWatchlist` collapses a `UNIQUE(user_id,name)` collision to `CodeInternal`; the ensure must go through `EnsureSystemManaged` only, never create-by-name, and log the original error.
- [ ] A read RPC now performs a conditional write — confirm no portfolio caller of `ListWatchlists` runs on a read-only DB connection/role, and whether the agent `list_watchlists` read-only/idempotent annotation needs adjusting.
- [ ] Should the system list count toward `watchlist.max_per_user` (currently `EnsureSignalWatchlist` bypasses it)? Spec assumes no.
- [ ] Fail-open on ensure error (FR-4) vs surfacing the error: spec assumes fail-open so a transient write failure never breaks the watchlists page.
