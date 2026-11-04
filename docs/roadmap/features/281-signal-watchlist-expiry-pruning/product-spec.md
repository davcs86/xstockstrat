# Product Spec: signal-watchlist-expiry-pruning

**Created**: 2026-10-31
**Updated**: 2026-10-31 (post-design: FR-2/FR-3 narrowed, FR-5/FR-6/FR-7 reworded, scope closed — see `design.md`, `context.md`)

---

## Problem Statement

Ingested signals carry an optional `valid_until` expiry (`packages/proto/ingest/v1/ingest.proto` `ExternalSignal.valid_until`; omitted = open-ended). Feature 127 auto-adds a signal's symbol to the user's system-managed signal watchlist (entry `source = WATCHLIST_ENTRY_SOURCE_SIGNAL`). **Confirmed by recon (`recon.md` Premise Verdict):** no code removes those entries when the signal expires, and an entry has no link to its signal(s) at all (`watchlist_symbols` stores only `watchlist_id, symbol, strategy_id, source, added_at`; the agent's add never passes `valid_until`/`signal_id`), so the list accumulates stale symbols and the fundamentals producer's universe (`ListAllWatchlistSymbols`) keeps serving them. The same gap is **refuted** for analysis opportunities (`ListOpportunities` already excludes `valid_until <= now()`) and is by-design for ingest signal rows (filtered at query time) — both out of scope.

## User Story

As a trader using the signal watchlist, I want entries whose backing signals have all expired to be removed automatically, so that the signal watchlist only contains symbols with at least one live signal.

## Functional Requirements

FR-1. **Premise confirmation (gate, satisfied):** `/sdd-design` Phase 0 Recon recorded, with `path:line` evidence in `recon.md`, that expired signal-sourced entries are never removed today and that an entry carries no link to its signals.
FR-2. A `SIGNAL` entry on a user's system-managed signal watchlist is removed by the recurring prune once every agent-recorded `direction="watchlist"` signal for that `(user, symbol)` since the entry was last added has expired (`valid_until <= now`, database clock). Signals ingested outside the agent `ingest_signal` path, and buy/sell/hold signals, do not extend an entry's life.
FR-3. Such an entry is retained by the recurring prune while at least one of those signals is live. An entry recorded with an open-ended signal, or last added/renewed by a SIGNAL add carrying no provenance, is never removed by the recurring prune. (The one-time backfill in FR-7 may remove it.)
FR-4. `MANUAL` entries are never removed. A MANUAL add of an existing SIGNAL entry leaves it SIGNAL (feature 127 first-writer-wins) and does not protect it from pruning.
FR-5. Pruning is idempotent, never waits on concurrent watchlist writes (a locked list or row is retried on the next tick), and runs at startup and then every `portfolio.watchlist.signal_prune_interval_seconds` (default 300; write bounds `[60,86400]`; a stored `<=0` reads as 300 and `1..59` as 60; there is no pause switch).
FR-6. Each removal emits exactly one owner-visible ledger event, best-effort after commit: `portfolio.watchlist.signal_entry_expired` `{user_id, watchlist_id, symbol, strategy_id, signal_id, valid_until}` or, for a backfill-marked entry, `portfolio.watchlist.signal_entry_removed_untracked` `{user_id, watchlist_id, symbol, strategy_id}`.
FR-7. A one-shot, DBA-reviewed operator backfill (`portfolio backfill-signal-expiry`) with two modes: REPORT is read-only; APPLY seeds expiry for untracked SIGNAL entries from the maximum `valid_until` over all of the owner's watchlist-direction signal rows (symbol trimmed and uppercased; any open-ended row leaves the entry untracked) and **marks** every such entry that has no watchlist-direction row under the owner's own `user_id`; both are bounded by `--expect-seed-expired` / `--expect-untracked`. The next prune tick removes marked entries unless a live signal or a provenance-less SIGNAL add rescues them first. Accepted (context.md, round 3): pre-feature-224 rows reassigned to the seed owner mean some users' entries are removed while a legacy signal is still live; REPORT flags them.

## Out of Scope

- Deleting or archiving expired signal rows in `xstockstrat-ingest`; any change to `valid_until` semantics, dedup (feature 111), or how entries are added (feature 127) beyond carrying provenance.
- Analysis opportunities and ingest signal rows (premise refuted / by design).
- Tracking signals ingested outside the agent path, buy/sell/hold signals, and legacy-owner matching in the backfill.
- Pinning on manual add, an agent retry of a failed renewal add, a mark grace period, a pause switch, and a UI cue for removals.
- Changing `RemoveWatchlistSymbols`, replace-all, or `manage_watchlist` source handling.

## Affected Services

- `xstockstrat-portfolio` — migration `018` (side table), add path, prune loop + events, `portfolio backfill-signal-expiry` subcommand, config key.
- `xstockstrat-agent` — sends signal provenance on the `direction="watchlist"` auto-add; `ingest_signal`/`get_watchlist` docstrings and `docs/runbooks/mcp-tools.md`.
- `xstockstrat-config` — `SCALAR_BOUNDS_REGISTRY` entry for the new key only.
- `xstockstrat-ui` — no code change; one e2e assertion that an emptied system list renders and cannot be deleted.
- `xstockstrat-ingest` — no change (read by the operator backfill only). `xstockstrat-analysis` — no change (premise refuted).

## Consumer Surface(s)

- [x] **UI** — `xstockstrat-ui` `/insights/watchlists` (already in `PLATFORM_SUBNAV`, C-10(a)): the signal watchlist simply shows fewer, live entries and refreshes on refocus/remount/mutation; **no code change**; silent removal is signed off (ledger event is the audit).
- [x] **Agent** — `xstockstrat-agent` MCP tools `ingest_signal` (side effect: watchlist entries now expire; a provenance validation failure drops the auto-add) and `get_watchlist` (reflects the pruned set); no new tool, count stays 45.
- [ ] **None**

## Proto Contract Changes

- [ ] No proto changes required
- Additive: `message WatchlistSignalProvenance { int64 signal_id = 1; google.protobuf.Timestamp valid_until = 2; }` and `AddWatchlistSymbolsRequest.signal_provenance = 4` (`portfolio.proto:328-333`). `WatchlistBinding` is untouched.

## Config Key Changes

- [ ] No new config keys
- `portfolio.watchlist.signal_prune_interval_seconds` — int, default 300, write bounds `[60,86400]`; **unseeded** (227-D2 waiver, `docs/patterns/config-governance.md:144`) with a `SCALAR_BOUNDS_REGISTRY` entry (`configServiceImpl.ts:103`).

## Database Changes

- [ ] No schema changes
- `portfolio` migration `018_watchlist_signal_expiry`: table `portfolio.watchlist_signal_expiry (watchlist_id UUID FK→watchlists ON DELETE CASCADE, symbol TEXT, valid_until TIMESTAMPTZ NOT NULL, signal_id BIGINT NULL /*NULL = backfill-marked*/, PRIMARY KEY (watchlist_id, symbol))` + index on `valid_until`; idempotent; down = `DROP TABLE IF EXISTS`.

## Feature Workflow Notes

Branch to create: `feature/signal-watchlist-expiry-pruning` (branch from `main-dev`; this session is on harness branch `ccr-bba734e2-l1lr60`)
Approval gates required (per docs/runbooks/feature-workflow.md):
- [x] 1 service owner approval (non-breaking proto or config change)
- [ ] 2 service owners + platform lead (breaking proto change)
- [x] DBA review + service owner (schema migration `018`; also reviews the backfill REPORT before any APPLY)

## Acceptance Criteria

See `acceptance.feature` (scenarios `@AC-*`) — the single source of acceptance truth (Constitution
**C-15**). Each `FR-N` above is covered by ≥1 tagged scenario there.

## Open Questions

All closed at `/sdd-design` (resolutions in `design.md` / `context.md`):

- [x] Premise (FR-1): confirmed for the portfolio signal watchlist; refuted for opportunities; by design for ingest rows.
- [x] Link between entry and signals: side table `watchlist_signal_expiry` stamped by the agent's add; rule = "all agent-recorded watchlist signals since the entry was last added expired".
- [x] Which signals count (R3): agent-recorded `direction="watchlist"` only (user sign-off, round 1).
- [x] Trigger mechanism: in-process portfolio prune loop; no new service edge.
- [x] Manual claim: first-writer-wins kept; a MANUAL add neither pins nor untracks (user sign-off, round 3).
- [x] Strategy bindings: pruned like any other entry; `strategy_id` is in the event payload (user sign-off, round 1).
- [x] Surface: silent removal accepted; no UI code (user sign-off, round 1).
- [x] Already-expired signal: added then pruned on the next tick (user sign-off, round 1).
- [x] Backlog: one-shot backfill; untracked entries removed strictly as amended (user sign-off, rounds 2-3).
- [x] Known traps (`fails.md`): normalizers untouched (provenance is request-level); symbols normalized at the source and in the backfill SQL (`upper(btrim)`); DB `now()` for the cutoff.
