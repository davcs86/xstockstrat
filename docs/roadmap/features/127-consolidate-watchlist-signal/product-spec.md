# Product Spec: consolidate-watchlist-signal

**Created**: 2026-08-11

---

## Problem Statement

`ingest_signal` (an `xstockstrat-agent` MCP tool) accepts `direction="watchlist"` as one of four
allowed values (`buy`/`sell`/`hold`/`watchlist`, `packages/proto/ingest/v1/ingest.proto:109`). Today
that value is persisted verbatim in `xstockstrat-ingest`'s `ingest.newsletter_signals.direction`
column and is treated as **non-actionable** by `xstockstrat-analysis`'s scoring
(`services/xstockstrat-analysis/app/services/scoring.py:32-36`) — it drives no scoring math and is
never joined with, or written into, the platform's actual watchlist mechanism
(`xstockstrat-portfolio`'s `Watchlist`/`CreateWatchlist`/`AddWatchlistSymbols` RPCs, feature 058).
The two concepts share the English word "watchlist" and nothing else. A signal ingested with
`direction="watchlist"` is effectively write-only data today: queryable via `QuerySignals`, but
never surfaced to a user's actual watchlist.

## User Story

As a user of the MCP agent, when I (or any caller) invoke `ingest_signal` with
`direction="watchlist"` for a symbol, I want that symbol automatically added to my portfolio
watchlist, so that tagging a signal "watchlist" has a real, visible effect instead of being stored
as an inert label.

> **Premise note (corrected 2026-08-19):** the trigger is **any** caller that explicitly ingests a
> `direction="watchlist"` signal (an interactive agent session, or a future automated flow). The
> earlier draft cited the `form4-enhanced-ingest` skill as the driver, but that skill scores
> `direction="watchlist"` transactions at conviction 0.30 (below the 0.6 ingest threshold) and routes
> them to `skipped_signals` — it **never** calls `ingest_signal` for them
> (`.claude/skills/form4-enhanced-ingest/SKILL.md`). So form4 is **not** a producer of this feature's
> trigger; do not scope or test the feature around it.

## Functional Requirements

FR-1. When `ingest_signal` is called with `direction="watchlist"` and the ingest succeeds
(`IngestSignalResponse.deduplicated == false`), the agent (deriving the caller's own id via
`_caller_user_id(ctx, ...)`) automatically adds `symbol` to the caller's **system-managed signals
watchlist** via `xstockstrat-portfolio`'s `AddWatchlistSymbols` RPC, as an unbound `WatchlistBinding`
(`strategy_id=""`) tagged `source=SIGNAL` — mirroring the existing auto-alert side effect already in
`ingest_signal` (`services/xstockstrat-agent/app/tools.py:296-333`).

FR-2. The agent resolves the caller's system-managed signals watchlist via the new
`EnsureSignalWatchlist` RPC (find-by-`system_managed`-flag, atomic create-if-absent) before adding —
NOT by a reserved name (the list is identified by the flag and survives a user rename).

FR-3. The watchlist auto-add is **best-effort and non-blocking**: a failure (e.g.
`xstockstrat-portfolio` unavailable, `PERMISSION_DENIED`) must be logged but must **not** fail the
already-committed `ingest_signal` call — matching the existing auto-alert contract
(`app/tools.py:294-330`, `try/except` around the side effect).

FR-4. A `deduplicated=true` response (the submission matched an existing signal within the dedup
window) must **not** re-trigger the watchlist auto-add, mirroring the existing suppression of the
auto-alert on dedup (`app/tools.py:309-313`).

FR-5. `ingest_signal`'s docstring and `docs/runbooks/mcp-tools.md` must document the new side effect
in the same place the existing auto-alert side effect is documented, keeping the two tool-doc
surfaces in parity (ledger `fails.md` 2026-08-02 — `mcp-tools-alignment-triage` — a hand-maintained
tool doc that drifts from the code is a repeat failure mode on this exact tool).

FR-6. `direction` values other than `"watchlist"` (`buy`/`sell`/`hold`) are unaffected — no change
to their ingest, scoring, or alerting behavior.

FR-7. **System-managed watchlist (portfolio).** `xstockstrat-portfolio`'s `Watchlist` gains a
`system_managed` boolean (additive proto field + schema column), and a new `EnsureSignalWatchlist`
RPC that returns the caller's `system_managed=true` watchlist, atomically creating one (default
display name a module constant, e.g. "Signals"; user-renamable) if absent. One system-managed
watchlist per user (enforced by a partial unique index). The `system_managed=true` name is exempt
from the existing `UNIQUE(user_id, name)` (which becomes `WHERE NOT system_managed`), so it coexists
with a user's own same-named list.

FR-8. **Delete guard (C-10(c)).** `DeleteWatchlist` must reject deleting a `system_managed` watchlist
with `FAILED_PRECONDITION` (the caller owns it; it is refused on resource state, not authorization).
`RemoveWatchlistSymbols`/`UpdateWatchlist` may still empty/rename it — deliberate ("anything but
delete"); an empty system-managed list is fine (re-populated on the next signal).

FR-9. **UI — undeletable (C-10(c) read-only-UI half).** `/insights/watchlists` hides/disables the
delete affordance for a `system_managed` watchlist; rename/add/remove stay enabled.

FR-10. **UI — per-entry provenance.** `WatchlistBinding` gains a `source` (`WatchlistEntrySource`
enum: `SOURCE_UNSPECIFIED=0`, `MANUAL=1`, `SIGNAL=2`; consumers default unspecified→manual), and the
UI badges `source=SIGNAL` entries. **Known limitation:** because `AddWatchlistSymbols` is
`ON CONFLICT (watchlist_id, symbol) DO NOTHING`, `source` is first-writer-wins — a symbol added
manually first then re-signaled stays `MANUAL` (and vice-versa); acceptable for a provenance hint.

## Out of Scope

- No `ingest`-side proto changes (`ExternalSignal`/`IngestSignalRequest`/`IngestSignalResponse`) — the
  agent-tool orchestration is unchanged there. (Portfolio proto DOES change — see Proto Contract Changes.)
- No change to `xstockstrat-analysis`'s treatment of `direction="watchlist"` as non-actionable for
  scoring — this feature only wires the *storage* side, not backtesting/scoring semantics.
- No **new** `xstockstrat-ui` page or route — the changes are to the **existing** `/insights/watchlists`
  page (feature 058): the `system_managed` undeletable affordance (FR-9) and the per-entry `source`
  badge (FR-10). No new nav entry (the page already exists → C-10(a) already satisfied).
- No retroactive backfill of existing `direction="watchlist"` rows already in
  `ingest.newsletter_signals` into a portfolio watchlist.
- No manual UI affordance to add symbols specifically to the system-managed signals list (a user may
  still add via the normal add-symbol control; the list is not read-only except for delete).

## Affected Services

- `xstockstrat-agent` — `ingest_signal` tool gains the auto-add side effect (and the caller's own
  identity via `_caller_user_id(ctx, ...)`, resolved from the authenticated tool call's verified
  claims — the same mechanism `emit_alert`/`manage_formula` already use); `app/client.py` gains a
  portfolio gRPC call (new `PORTFOLIO_ENDPOINT`-backed client method, mirroring the existing
  ingest/notify client methods, forwarding `x-user-id`).
  - **Deploy parity (C-1):** the agent gains the env var `PORTFOLIO_ENDPOINT=xstockstrat-portfolio:50052`,
    which is **absent from the agent block today**. It must be added to the `xstockstrat-agent` block in
    **all three** of `docker-compose.yml`, `.do/app.yaml`, `.do/app.dev.yaml`, plus the agent's
    `CLAUDE.md` Environment Variables list. The value is the fixed, well-known internal endpoint —
    identical across every environment (no per-target divergence).
- `xstockstrat-portfolio` — **proto + schema + handler changes**: new `Watchlist.system_managed` field,
  `WatchlistBinding.source` + `WatchlistEntrySource` enum, new `EnsureSignalWatchlist` RPC, a migration
  (system_managed column + name-constraint rework + source column), and a `DeleteWatchlist` guard
  (FR-8). Ownership stays header-derived (`x-user-id`, never the request body); a call with no verified
  user id is hard-rejected (`INVALID_ARGUMENT`), so the agent skips the auto-add best-effort then.
- `xstockstrat-ui` — **existing** `/insights/watchlists` page: the `system_managed` undeletable
  affordance (FR-9) and the per-entry `source` badge (FR-10); `Watchlist.systemManaged` / `Binding.source`
  flow through the existing `listWatchlists`/`getWatchlist` BFF forwards via regen (no new BFF route).

## Consumer Surface(s)

- [x] **Agent** — `xstockstrat-agent` MCP tool(s): `ingest_signal` (changed side-effect/behavior —
  same tool name, params, and return shape; the new auto-add is a documented side effect, not a
  contract change, per FR-5). Earns its own step(s).
- [x] **UI** — `xstockstrat-ui` `/insights/watchlists` (existing page): the `system_managed`
  undeletable affordance (FR-9) and the per-entry `source=SIGNAL` badge (FR-10). Earns its own
  step(s) + e2e coverage (C-12 fixtures). No new page/route/nav.

## Proto Contract Changes

- [x] **Additive, non-breaking** (`packages/proto/portfolio/v1/portfolio.proto`; run `./scripts/buf-gen.sh`,
  `buf lint` + `buf breaking` must pass):
  - `Watchlist.system_managed` (new bool field — next free number confirmed at `/sdd-spec`).
  - `WatchlistBinding.source` (new field) + a `WatchlistEntrySource` enum
    (`WATCHLIST_ENTRY_SOURCE_UNSPECIFIED=0`, `WATCHLIST_ENTRY_SOURCE_MANUAL=1`,
    `WATCHLIST_ENTRY_SOURCE_SIGNAL=2` — full-enum-name value prefix per buf `ENUM_VALUE_PREFIX`, and
    the mandatory zero-value sentinel; consumers default unspecified→manual).
  - New RPC `EnsureSignalWatchlist` (+ request/response messages) on `PortfolioService`.
  - Still **reuses** `AddWatchlistSymbols`/`DeleteWatchlist` (the delete-guard is handler-side, no
    proto change).

## Config Key Changes

- [x] **No new config keys.** The system-managed watchlist is identified by the `system_managed` flag,
  not a name — so the default display name is a plain **module constant** (a config key would add
  governance surface for no benefit; the "renaming orphans" concern is moot under find-by-flag).

## Database Changes

- [x] **One new `xstockstrat-portfolio` migration** (NNN re-derived across ALL remote branches at
  `/sdd-spec` — do NOT hardcode; feature 042 (design-approved) also claims portfolio migration `010`,
  so 127 likely lands on `011` — first to merge keeps `010`, ledger 081):
  - `ALTER TABLE portfolio.watchlists ADD COLUMN system_managed BOOLEAN NOT NULL DEFAULT false`.
  - Replace `UNIQUE (user_id, name)` with `UNIQUE (user_id, name) WHERE NOT system_managed` (system
    list's name is cosmetic — coexists with a user's same-named list) + a partial unique index
    `(user_id) WHERE system_managed` (one system list per user, race-safe).
  - `ALTER TABLE portfolio.watchlist_symbols ADD COLUMN source SMALLINT NOT NULL DEFAULT 0` (the
    `WatchlistEntrySource` enum value; `0`=unspecified→manual).
  - `.down.sql` reverses all (restore the plain `UNIQUE(user_id,name)`, drop the columns/indexes).

## Feature Workflow Notes

Branch to create: `feature/consolidate-watchlist-signal` (branch from `main-dev`)
Approval gates required (per docs/runbooks/feature-workflow.md) — **expanded by the design**:
- [x] `xstockstrat-portfolio` service owner (new RPC + fields + handler guard)
- [x] Proto reviewer (additive `Watchlist.system_managed`, `WatchlistBinding.source`, `WatchlistEntrySource`
  enum, `EnsureSignalWatchlist` RPC — `buf breaking` passes; additive = non-breaking, 1-owner)
- [x] DBA + service owner (portfolio migration — new columns + name-constraint rework)
- [x] `xstockstrat-agent` reviewer (MCP tool side-effect + new portfolio client edge)
- [x] `xstockstrat-ui` reviewer (the `/insights/watchlists` affordance + badge)

## Acceptance Criteria

The acceptance scenarios are the single source of acceptance truth and live as Gherkin in
[`acceptance.feature`](acceptance.feature) (Constitution **C-15**): `@AC-1..@AC-8`, each tagged with
the `@FR-*` it exercises and traced to a test step at `/sdd-spec`. They cover the watchlist auto-add
on a non-deduplicated `direction="watchlist"` signal (tagged `source=SIGNAL`), no mutation for other
directions or a deduplicated response, best-effort non-blocking behavior on a portfolio failure, the
docstring↔`mcp-tools.md` parity assertion, `EnsureSignalWatchlist` idempotency (one `system_managed`
row per user, coexisting with a same-named manual list), the `DeleteWatchlist` `FAILED_PRECONDITION`
guard plus the undeletable UI affordance, and the per-entry `source=SIGNAL` provenance badge.

## Open Questions

- [x] **Whose watchlist? — RESOLVED (2026-08-19, user intent + recon):** a special, system-managed,
  **per-user** watchlist owned by the **calling user**. The agent derives the caller's own id via
  `_caller_user_id(ctx, "ingest_signal")` (adding the MCP-injected `ctx` param, non-breaking — same as
  `emit_alert`/`manage_formula`) and forwards it as `x-user-id`; ownership is header-derived
  server-side (`portfolio.proto:193-194`). **Fallback:** `_caller_user_id` raises only on the
  unauthenticated stdio-local transport (every authenticated Streamable-HTTP tool call carries verified
  claims — `app/main.py` `_authorized`), so the auto-add is skipped best-effort with a `log.warning`
  in that case (the signal is still ingested). No system/owner-less watchlist concept is introduced
  (none exists; not needed — the list is user-owned, so no C-10(c) ownership sentinel is required).
- [x] **Which watchlist? — RESOLVED (user, 2026-08-19):** a dedicated **`system_managed` watchlist**
  identified by a new flag on the `Watchlist` (NOT by name), found/created via `EnsureSignalWatchlist`.
  It is delete-protected (FR-8), so it persists; the display name is a cosmetic module-constant default
  (user-renamable). This dissolves the name-collision footgun — a user's own same-named list is never
  co-opted (the system name is exempt from `UNIQUE(user_id, name)`).
- [x] **UI distinction — RESOLVED (user, 2026-08-19): IN SCOPE.** The `/insights/watchlists` view marks
  the system-managed watchlist (undeletable affordance, FR-9) AND badges per-entry `source=SIGNAL`
  provenance (FR-10). No longer deferred.
- [x] **Idempotency — RESOLVED (recon):** `AddWatchlistSymbols` is natively idempotent —
  `INSERT ... ON CONFLICT (watchlist_id, symbol) DO NOTHING` (`watchlist_repo.go:266-275`), so a
  repeated non-deduplicated signal on the same symbol is a silent no-op (no error, no duplicate). No
  extra guard needed.
