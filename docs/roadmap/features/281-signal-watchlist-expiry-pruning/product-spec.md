# Product Spec: signal-watchlist-expiry-pruning

**Created**: 2026-10-31

---

## Problem Statement

Ingested signals carry an optional `valid_until` expiry (`packages/proto/ingest/v1/ingest.proto` `ExternalSignal.valid_until`; omitted = open-ended). Feature 127 auto-adds a signal's symbol to the user's system-managed signal watchlist (entry `source = WATCHLIST_ENTRY_SOURCE_SIGNAL`). The reported gap: when the signal expires, its watchlist entry is **not** removed, so the signal watchlist accumulates stale symbols and no longer reflects live signals. This is an observation from the requester, **not yet verified against code** — Phase 0 Recon of `/sdd-design` must confirm it first.

## User Story

As a trader using the signal watchlist, I want entries whose backing signals have all expired to be removed automatically, so that the signal watchlist only contains symbols with at least one live signal.

## Functional Requirements

FR-1. **Premise confirmation (gate, not a deliverable):** `/sdd-design` Phase 0 Recon records, with `path:line` evidence in `recon.md`, whether (a) signals expire (`valid_until` honored at query time), (b) any existing code path removes signal-sourced watchlist entries on expiry, and (c) how a signal-sourced entry is linked back to its originating signal(s). If recon finds expired entries are already pruned, the feature is closed/re-scoped, not designed.
FR-2. A signal-sourced (`source = SIGNAL`) watchlist entry is removed automatically once **every** signal for that `(user, symbol)` has expired (`valid_until <= now`).
FR-3. A signal-sourced entry is **retained** while at least one signal for that `(user, symbol)` is still live (including open-ended signals with no `valid_until`).
FR-4. Entries with `source = MANUAL` are never removed by this feature.
FR-5. Pruning is idempotent and safe under repeated or concurrent runs (a second pass over the same expired set is a no-op; no error if the entry is already gone).
FR-6. Each automatic removal is observable (audit trail / ledger event naming user, symbol, and the expiring signal) — exact sink decided at design.

## Out of Scope

- Deleting or archiving the expired signals themselves in `xstockstrat-ingest` (retention of signal rows is unchanged).
- Changing how signals are added to the watchlist (feature 127) or `valid_until` semantics / dedup (feature 111).
- Pruning non-signal (`MANUAL`) entries or user-created watchlists.
- Re-adding on signal renewal beyond what feature 127's ingest path already does.

## Affected Services

Provisional — **finalized by recon**:
- `xstockstrat-portfolio` — owns `Watchlist` entries / `source` (feature 127); likely the removal target.
- `xstockstrat-ingest` — owns signals and `valid_until`; likely the source of "which signals expired".
- `xstockstrat-agent` — wrote the signal-sourced entries in feature 127 (`ingest_signal`, `direction="watchlist"`); possibly the only caller linking signal → watchlist.
- `xstockstrat-analysis` — operator chose "both" targets: `ListOpportunities` (sorted by `valid_until`) is also in recon scope for expired-signal persistence.
- `xstockstrat-ui` — displays the system-managed signal watchlist (`/insights/watchlists`); only if a visible change is needed.

## Consumer Surface(s)

- [x] **UI** — `xstockstrat-ui` `/insights` (existing `/insights/watchlists`, already in `PLATFORM_SUBNAV`): the signal watchlist simply shows fewer, live entries; **no new page/route expected**. Confirm at design whether any "pruned" affordance is wanted (see Open Questions).
- [ ] **Agent** — no new tool expected; `get_watchlist` / `manage_watchlist_symbols` responses reflect the pruned set. Confirm at design.
- [ ] **None**

## Proto Contract Changes

- [ ] No proto changes required — **undecided**; depends on where the sweep runs and how an entry is tied to its signals. Decided at `/sdd-design`.

## Config Key Changes

- [ ] No new config keys — **undecided**. A sweep interval / enable flag (`<service>.<category>.<key>`) is likely if a periodic job is chosen. Decided at design.

## Database Changes

- [ ] No schema changes — **undecided**. A signal↔entry link may need a column/index. Decided at design (DBA gate applies if so).

## Feature Workflow Notes

Branch to create: `feature/signal-watchlist-expiry-pruning` (branch from `main-dev`; this session is on harness branch `ccr-bba734e2-l1lr60`)
Approval gates required (per docs/runbooks/feature-workflow.md):
- [x] 1 service owner approval (non-breaking proto or config change)
- [ ] 2 service owners + platform lead (breaking proto change)
- [ ] DBA review + service owner (schema migration) — only if design adds a migration

## Acceptance Criteria

See `acceptance.feature` (scenarios `@AC-*`) — the single source of acceptance truth (Constitution
**C-15**). Each `FR-N` above is covered by ≥1 tagged scenario there.

## Open Questions

- [ ] **Recon-confirmed premise (FR-1):** do expired signal-sourced entries truly persist today? Which code path, if any, was meant to remove them?
- [ ] **Link between entry and signals:** how does a `SIGNAL` entry map to its signal(s)? (Multiple signals/sources per symbol; one `valid_until` per signal.) FR-2/FR-3 assume "all expired" — confirm that is the intended rule vs "latest-ingested signal expired".
- [ ] **Trigger mechanism:** periodic sweep vs lazy prune on read vs event-driven at expiry — and which service owns it (ingest→portfolio calls are not in the current dependency graph; adding an edge is a Platform Lead gate).
- [ ] **Manual claim:** if a user manually adds a symbol already present as `SIGNAL` (or the reverse), what does `source` become, and is it then protected from pruning?
- [ ] **Strategy bindings:** does removing an entry also drop its `strategy_id` binding (feature 097 Universe candidate)? Any in-flight opportunities/orders depending on it?
- [ ] **Surface:** is silent removal acceptable in the UI, or should pruned symbols be surfaced (toast, history)?
- [ ] **Known traps (ledger):** `fails.md` 2026-08-26 `consolidate-watchlist-signal` — verify the producer flow actually reaches the code path (P-03) and extend every hand-rolled `normalizeBindings`-style normalizer on the write path if a field is added; `fails.md` symbol-key normalization — normalize symbol keys at construction, never per read site; `fails.md` 2026-08-16 `signal-time-decay` — capture `now` after awaits (time-boundary off-by-one).
