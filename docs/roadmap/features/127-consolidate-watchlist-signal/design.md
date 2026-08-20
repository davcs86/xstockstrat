# Design: consolidate-watchlist-signal

**Created**: 2026-08-19
**Rounds**: 2 (full; termination: approved after a scope expansion + a product-spec re-review)
**Approved by**: user @ 2026-08-19
**Grounded in**: recon.md

---

## Chosen Approach

When `ingest_signal` is called with `direction="watchlist"` and the ingest is not deduplicated, the
agent auto-adds the symbol to the **calling user's system-managed signals watchlist** — a per-user
watchlist identified by a new `system_managed` flag (not a name), delete-protected, with agent-added
entries badged in the UI. Four coordinated surfaces (agent + portfolio proto/migration/handler + UI).

### Agent (`xstockstrat-agent`)
Add `ctx: Context` as `ingest_signal`'s first param (MCP-injected, excluded from the client schema —
non-breaking, exactly as `emit_alert`/`manage_formula` take it) and derive the caller's own id via
`_caller_user_id(ctx, "ingest_signal")` (`app/tools.py:109-124`). A **second best-effort post-commit
side effect**, structurally identical to the existing auto-alert (`app/tools.py:296-333`), gated on
`direction=="watchlist" and not result.get("deduplicated")` (mirrors the auto-alert dedup gate at
`:312`), wrapped in `try/except → log.warning`, **never raises** (FR-3). Two new `app/client.py`
methods on the ephemeral-channel/lazy-stub pattern (`client.py:182-188`), forwarding
`[*_metadata(), ("x-user-id", user_id)]`: `ensure_signal_watchlist(user_id)` (calls
`EnsureSignalWatchlist`) then `add_watchlist_symbol(user_id, wl_id, symbol)` (`AddWatchlistSymbols`
with `WatchlistBinding{symbol, strategy_id="", source=WATCHLIST_ENTRY_SOURCE_SIGNAL}`). On failure,
`log.warning` with the **original gRPC code/details** (portfolio collapses a `UNIQUE` violation to
`INTERNAL`, indistinguishable from an outage — so log the real code for diagnosability).
**Fallback:** `_caller_user_id` raises only on the unauthenticated stdio-local transport (every
authenticated Streamable-HTTP call carries verified claims — `app/main.py` `_authorized`); there the
add is skipped best-effort, the signal still ingested. `PORTFOLIO_ENDPOINT=xstockstrat-portfolio:50052`
added to the agent block in `docker-compose.yml`, `.do/app.yaml`, `.do/app.dev.yaml`, + agent CLAUDE.md.

### Portfolio (`xstockstrat-portfolio`) — proto + migration + guard
- **Proto (additive, non-breaking; `buf breaking` passes):** `Watchlist.system_managed` (field 9 —
  fields 1-8 used); `WatchlistBinding.source` (field 3) + a `WatchlistEntrySource` enum
  (`WATCHLIST_ENTRY_SOURCE_UNSPECIFIED=0/MANUAL=1/SIGNAL=2` — full-enum-name value prefix per buf
  `ENUM_VALUE_PREFIX`, C-04 sentinel); new RPC `EnsureSignalWatchlist` (no request body — ownership
  from `x-user-id`).
- **`EnsureSignalWatchlist` handler:** find the caller's `system_managed=true` row (survives a user
  rename — found by flag, not name), else create one atomically:
  `INSERT ... ON CONFLICT (user_id) WHERE system_managed DO NOTHING RETURNING *`, then SELECT on empty
  return (no TOCTOU — the round-2 fix). Default display name = a module constant ("Signals"),
  user-renamable.
- **Migration (NNN re-derived at `/sdd-spec` across ALL remote branches — likely `011`, since 042
  holds `010`; ledger 081):** add `watchlists.system_managed BOOLEAN NOT NULL DEFAULT false`; **replace**
  `UNIQUE (user_id, name)` with `UNIQUE (user_id, name) WHERE NOT system_managed` (drop+recreate — the
  system list's name is cosmetic, so it coexists with a user's own same-named list — the round-2
  name-collision fix) + a partial unique index `(user_id) WHERE system_managed` (one system list per
  user, race-safe); add `watchlist_symbols.source SMALLINT NOT NULL DEFAULT 0`. `scanWatchlist`/
  `listBindings`/`insertBindingsTx` (`watchlist_repo.go:266-284`) carry the new columns.
- **Delete guard (C-10(c), the 063/115 pattern):** `DeleteWatchlist` (`portfolio_service.go:1310-1326`)
  captures the currently-discarded `loadOwned` result; if `system_managed`, return
  `connect.CodeFailedPrecondition` (the caller **owns** it — refused on resource state, not authz).
  `RemoveWatchlistSymbols`/`UpdateWatchlist` may still empty/rename it — **deliberate** ("anything but
  delete"); an empty system list is fine (re-populated on the next signal; a full delete is even
  self-healing via `EnsureSignalWatchlist`).

### UI (`xstockstrat-ui`, existing `/insights/watchlists`)
`Watchlist.systemManaged` disables/omits the delete `AlertDialog`/`Button` (`WatchlistDetail.tsx:187-207`)
— read-only-UI half of C-10(c); rename/add/remove stay enabled. `Binding.source` renders an existing
`Badge` on `WATCHLIST_ENTRY_SOURCE_SIGNAL` entries. Both flow through the existing `listWatchlists`/
`getWatchlist` BFF forwards (`insightsBff.ts:91-92`) via regen — no new BFF route, no new page/nav
(C-10(a) already satisfied, feature 058). C-12 fixtures + `watchlists.spec.ts` gain a system-managed
list with a signal-sourced entry (undeletable + badge coverage).

### Docs / tests
FR-5 tool-doc parity: the `ingest_signal` docstring `SIDE EFFECT:` block (`app/tools.py:278-284`) +
`docs/runbooks/mcp-tools.md:195-227`, pinned by a **descriptor/parity-style test** asserting BOTH
surfaces mention the side effect (the mcp-tools-alignment lesson), paired with the behavior test.

## Rejected Alternatives

- Reserved *name* to identify the signals watchlist — rejected: `UNIQUE(user_id, name)` means the agent would co-opt a user's own same-named list; the `system_managed` flag identifies it instead (name-collision dissolved).
- `CreateWatchlistRequest.system_managed` flag instead of a new RPC — rejected: portfolio can't distinguish the agent from the UI BFF (both forward the user's own `x-user-id`), and a general create path can't do atomic race-safe find-or-create-by-flag; the dedicated RPC wins on atomicity + rename-survivable lookup (not on the weaker "forgeable flag" argument).
- Server-side name disambiguation on collision — rejected: no existing pattern + leaks a mangled name to the UI; the partial-unique name constraint (`WHERE NOT system_managed`) is cleaner.
- Watchlist-level distinction only (no per-entry `source`) — considered; **user chose per-entry `source`** (badge individual entries even in a mixed list), accepting the first-writer-wins caveat.
- A config key for the reserved name — rejected: identified by flag, so the name is a cosmetic constant; a key adds governance surface for no benefit (and "renaming orphans lists" is moot under find-by-flag).
- `PERMISSION_DENIED` for the delete guard — rejected: the caller owns the row; `FAILED_PRECONDITION` (resource-state refusal) is correct.
- Deferring the UI distinction (C-14) — rejected by the user (included in scope).

## Open Risks

- [ ] **Migration NNN** is re-derived across all remote branches at `/sdd-spec` (042 holds portfolio `010`; 127 → `011`; merge-order.md row added; ledger 081) — do not hardcode.
- [ ] **Per-entry `source` is first-writer-wins** (`ON CONFLICT (watchlist_id, symbol) DO NOTHING`): a symbol added manually then re-signaled stays `MANUAL` (and vice-versa). Accepted as a provenance hint, not authoritative — state in the UI/test.
- [ ] **Agent MCP-cohort rebase** (soft): `ingest_signal`/`app/client.py`/`mcp-tools.md` are co-edited by the code-completed 085/094 cohort — 127 rebases onto whichever landed, reconciling the `ingest_signal` docstring + mcp-tools entry (merge-order.md MCP-alignment note).
- [ ] **Name-constraint rework is a drop+recreate migration** — verify no existing data violates the new `WHERE NOT system_managed` unique on up-migration (existing rows are all `system_managed=false` by the DEFAULT, so the constraint is equivalent for them) — address at the migration step.
- [ ] **Empty-but-undeletable system list** after `RemoveWatchlistSymbols`/`UpdateWatchlist` — deliberate; documented so it's not read as a defect.

## Constitution Rules Touched

- `C-01`/`P-03` — honored: the identity/premise/name-collision forks were grounded and escalated (the false form4-producer premise corrected; identity confirmed via `_authorized`); nothing guessed.
- `C-03` — honored: the agent forwards the caller's own `x-user-id` on the new portfolio edge (ownership is header-derived); no cycle (portfolio never dials the agent).
- `C-04` — honored: `WatchlistEntrySource` has the zero-value sentinel + the full-enum-name value prefix.
- `C-05`/`F-07` — honored: no new config key; the display name is a cosmetic module constant (not a WatchConfig tunable).
- `C-07`/`F-01` — honored: one new numbered up+down portfolio migration, NNN re-derived at spec time; no applied migration edited.
- `C-09` — honored: the additive proto change runs `buf lint`/`buf breaking` + `./scripts/buf-gen.sh`.
- `C-10(a)` — honored: no new UI page/route (existing `/insights/watchlists`), so nav is already registered.
- `C-10(c)` — honored: the agent-managed system watchlist is protected from mutation by BOTH an RPC guard (`DeleteWatchlist` → `FAILED_PRECONDITION`) AND the read-only UI (hidden delete); no owner-less sentinel introduced (list stays user-owned).
- `C-14` — honored: both consumer surfaces named (Agent `ingest_signal` + UI `/insights/watchlists`), each earning its own steps; the UI distinction is in scope (not deferred).
- `C-08`/`P-06` — honored: paired tests incl. the descriptor-parity doc test, the best-effort/dedup/fallback behavior tests, the delete-guard test, and the e2e undeletable+badge coverage.
