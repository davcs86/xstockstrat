# Product Spec: mcp-watchlist-tools

**Created**: 2026-08-21

---

## Problem Statement

The `xstockstrat-portfolio` service already implements a full user-owned watchlist surface
(create/get/list/update/delete lists, add/remove symbols — features 058/097/127), and the
`xstockstrat-ui` `/insights` segment consumes it, but the `xstockstrat-agent` MCP server exposes
**no** watchlist-management tools. An AI agent can ingest signals (which side-effect a symbol into
the system-managed signals list) but cannot curate a user's watchlists directly. This feature adds
the missing agent-tool surface over the already-shipped backend RPCs.

## User Story

As an AI agent operating on a user's behalf, I want MCP tools to list the user's watchlists, read a
list's stocks, create/update/delete a list, and add/remove stocks on a list, so that I can curate
watchlists conversationally without the user opening the `/insights` UI.

## Functional Requirements

FR-1. A read-only `list_watchlists` tool returns the **calling user's own** watchlists (name,
description, id, symbols/bindings, `system_managed`, timestamps), paginated via `limit` +
`page_token`, returning a `next_page_token`. It wraps `PortfolioService.ListWatchlists`.

FR-2. A read-only `get_watchlist` tool returns one watchlist by `watchlist_id` including its full
`bindings` (each `symbol` + `strategy_id` + `source`) and the deprecated flat `symbols` mirror. It
wraps `PortfolioService.GetWatchlist`. Fetching a list the caller does not own surfaces the
backend's `NOT_FOUND`/`PERMISSION_DENIED` as a tool error.

FR-3. A `manage_watchlist` write tool with an `operation` verb (`create` | `update` | `delete`)
wraps `CreateWatchlist` / `UpdateWatchlist` / `DeleteWatchlist`. `create` takes `name` (+ optional
`description`, `symbols`, and `(symbol, strategy_id)` bindings). `update` changes name/description
(and optionally the symbol set) of an existing `watchlist_id`; the tool must **not silently wipe**
the existing symbol set when the caller updates only name/description (see Open Questions — the
backend `UpdateWatchlist` is replace-semantics, so the tool sends only the fields the caller
supplied). `delete` removes a `watchlist_id`; a delete of the delete-protected system-managed
signals list surfaces the backend's refusal as a tool error.

FR-4. A `manage_watchlist_symbols` write tool with an `operation` verb (`add` | `remove`) wraps
`AddWatchlistSymbols` / `RemoveWatchlistSymbols`. `add` accepts bare `symbols` (unbound) and/or
`(symbol, strategy_id)` bindings and records them with `source = MANUAL` (agent-user-curated, not
SIGNAL). `remove` removes by `symbols`. Both return the updated watchlist.

FR-5. Every watchlist tool is **ownership-gated, not admin-gated**: it forwards the caller's own
`x-user-id` (via `_caller_user_id(ctx, …)` + `_metadata`), never an admin `x-access-scope`, matching
`get_strategy`/`manage_strategy` (feature 133). Ownership is enforced server-side by
`xstockstrat-portfolio` from the header; no `user_id` is ever taken from a tool argument.

FR-6. The tool inventory stays consistent: every tool's docstring documents its params/returns/errors
and matches its `docs/runbooks/mcp-tools.md` section (doc-parity), the tool-count statements are
updated across every inventory surface, and the dict→proto request builders cover every proto field
they map (guarded by a test) so a later proto field addition cannot silently drop — closing the
F-12/RC-1 drift class from the ledger.

## Out of Scope

- Any change to `xstockstrat-portfolio` (proto, service, DB) — the RPCs already exist and are stable.
- Exposing `EnsureSignalWatchlist` as a standalone tool — it is an internal find-or-create used by
  `ingest_signal`'s `direction='watchlist'` side effect, not part of the user-facing curation surface.
- Any `xstockstrat-ui` change — the `/insights` watchlist UI already exists.
- Strategy-binding validation beyond what `AddWatchlistSymbols`/`UpdateWatchlist` already enforce.

## Affected Services

Exact service names from CLAUDE.md Service Registry:
- `xstockstrat-agent` — **the only service changed.** Adds four MCP tools (`list_watchlists`,
  `get_watchlist`, `manage_watchlist`, `manage_watchlist_symbols`) plus their `app/client.py` gRPC
  wrappers, reusing the already-configured `PORTFOLIO_ENDPOINT`.
- `xstockstrat-portfolio` — dependency only (its watchlist RPCs are called; **no change**).

## Consumer Surface(s)

_Constitution **C-14**._

- [ ] **UI** — no change.
- [x] **Agent** — `xstockstrat-agent` MCP tools: **new tools** `list_watchlists`, `get_watchlist`,
  `manage_watchlist`, `manage_watchlist_symbols`. This IS the consumer surface — the capability is
  the agent tools themselves.
- [ ] **None**.

## Proto Contract Changes

- [x] No proto changes required — all eight watchlist RPCs already exist on `PortfolioService`
  (`packages/proto/portfolio/v1/portfolio.proto`, features 058/097/127).

## Config Key Changes

- [x] No new config keys. (The backend already enforces `portfolio.watchlist.max_per_user` and
  `portfolio.watchlist.max_symbols_per_list` caps; the tools surface those errors, they do not add keys.)

## Database Changes

- [x] No schema changes — `portfolio.watchlists` / `portfolio.watchlist_symbols` already exist.

## Feature Workflow Notes

Branch to create: `feature/mcp-watchlist-tools` (branch from `main-dev`)
Approval gates required (per docs/runbooks/feature-workflow.md):
- [x] 1 service owner approval (`xstockstrat-agent` — additive tools, no proto/config/DB change)
- [ ] 2 service owners + platform lead (breaking proto change) — N/A
- [ ] DBA review + service owner (schema migration) — N/A

## Acceptance Criteria

See `acceptance.feature` (scenarios `@AC-*`) — the single source of acceptance truth (Constitution
**C-15**). Each `FR-N` above is covered by ≥1 tagged scenario there.

## Open Questions

- [ ] **`manage_watchlist update` replace-semantics footgun (design-phase must ground).** The backend
  `UpdateWatchlistRequest` is documented replace-semantics for name/description/symbols (feature 058
  FR-1). This is the same shape as the `manage_strategy` pre-070 full-replace footgun (ledger F-12 /
  RC-1): if the tool ships every field unconditionally, an "update the name" call would wipe the
  list's symbols. `/sdd-design` must verify the portfolio `UpdateWatchlist` handler's actual behavior
  when `symbols`/`bindings` are omitted (does it replace-with-empty, or leave unchanged?) and choose
  the tool contract accordingly — likely: `manage_watchlist update` sends only caller-supplied fields
  and symbol mutation goes through `manage_watchlist_symbols`.
- [ ] **`add` provenance.** Agent-user-curated adds should be `source = MANUAL` (default), not
  `SIGNAL` (which the `ingest_signal` side-effect path uses). Confirm MANUAL is the right default and
  whether the tool should expose `source` at all.
- [ ] **Known trap (F-12 / RC-1).** Hand-written dict→proto builders + prose docs drift from the
  protos. Design must include a descriptor-parity-style guard and the `test_tools_endpoint.py` tool-set
  update so the four new tools cannot silently drift.
