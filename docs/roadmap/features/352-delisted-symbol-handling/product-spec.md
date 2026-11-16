# Product Spec: delisted-symbol-handling

**Created**: 2026-11-16

---

## Problem Statement

The platform checks whether a symbol is servable (an active, tradable `us_equity` on Alpaca, not OTC)
only at the moment the symbol is added to a watchlist (feature 282). A symbol that delists afterwards
stays on its watchlists, stays warm until the next restart (282's accepted residual R2), and is requested
again by every watchlist-driven backfill. When the data source can no longer resolve it, the backfill
counts it as a failed symbol, the job ends `PARTIAL`, and the reason is visible only in a marketdata WARN
log. The operator has to find and remove such symbols by hand.

Observed on 2026-11-16 (DO staging, fundamentals backfill over the "Signals" watchlist, about 365
symbols; full record in `docs/roadmap/features/348-fix-edgar-historical-fundamentals/context.md`):

- **AXIA, EVTV, LRHC, LXP, PSKY, RAMP** failed with `no CIK for ticker "<SYM>"` (absent from SEC's
  ticker map) and are `UNSERVABLE_REASON_NOT_TRADABLE`. 3 of 8 chunk jobs ended `PARTIAL`. PSKY had
  failed the same way on 2026-10-21.
- **ROKU, NWE, KPTI, ATCH** are `UNSERVABLE_REASON_NOT_TRADABLE` after real corporate events (last
  stored daily bar 2026-11-06, 2026-11-13, 2026-11-10 and 2026-11-10), but their fundamentals backfill
  succeeded because SEC's ticker map lags delistings. They are still on "Signals".
- **SHPH** is absent from Alpaca's active set although it printed a bar on 2026-11-16 and no delisting
  was found.
- The only way to list the unservable symbols was to create a throwaway watchlist and read the
  `refused` list of the add call.

How the platform behaves today (verified in code on `main-dev` at `78ab5ca`):

- `services/xstockstrat-marketdata/internal/service/asset_servability.go` classifies a symbol against an
  in-memory snapshot of Alpaca's asset set; the gate applies at warm-add sites only (MARKETDATA-16).
- `xstockstrat-portfolio` calls `GetSymbolServability` only on its watchlist insert paths
  (`refuseUnservable` in `internal/service/portfolio_service.go`).
- `BackfillFundamentals` in `services/xstockstrat-marketdata/internal/service/marketdata_service.go`
  logs `fundamentals backfill: symbol failed (skipped)`, appends the symbol to `failed_symbols` and
  records `marketdata.backfill.symbols` with outcome `failed`. `BackfillJob` in
  `packages/proto/ingest/v1/ingest.proto` carries `failed_symbols` and a single `error` string, no
  per-symbol reason.

## User Story

As a platform operator, I want a symbol that delists after it was added to be detected, taken out of
watchlist-driven work and reported with its reason, so that backfill jobs stop ending `PARTIAL` because
of dead symbols and I no longer have to find and remove them by hand.

## Operator Decisions (2026-11-16)

Answers the operator gave when this story was filed; they bind the FRs below.

| # | Question | Decision |
|---|---|---|
| D-1 | Which failure is in scope | Both: the backfill outcome and the watchlist lifecycle after the add |
| D-2 | What happens to the symbol on watchlists | Removed from system-managed "Signals" watchlists; kept and marked on user-created watchlists. Stored bars and fundamentals are kept |
| D-3 | How a backfill job reports it | Per-symbol outcome and reason in the job status; a delisted symbol counts as `skipped`, not `failed` |
| D-4 | Absent from Alpaca's set with no delisting found (SHPH) | Same state as a real delisting, but only after a configurable confirmation window; the state clears if the symbol reappears |
| D-5 | A backfill that explicitly names a delisted symbol | Still attempted; `skipped` only when the source cannot serve it and the symbol is flagged delisted |
| D-6 | Ticker renamed or reused after a delisting | Out of scope; recorded as a follow-up |
| D-7 | Where the state is visible | Agent watchlist and backfill tools, the `/insights` watchlists page, and an alert on each transition. No separate servability-check tool |

## Functional Requirements

In this spec a symbol is **flagged delisted** when the platform has confirmed it unservable under FR-1.
"Unservable" keeps its feature-282 meaning (`UNSERVABLE_REASON_NOT_TRADABLE` or `UNSERVABLE_REASON_OTC`).

FR-1. **Detection with a confirmation window.** A symbol that is on at least one watchlist and is
unservable in every successfully loaded asset set for a configurable confirmation window becomes flagged
delisted. The flag records the unservable reason and the date the symbol was first seen unservable. A
symbol unservable for less than the window is not flagged and nothing about it changes. A refresh that
is rejected or has not loaded yet (feature 282's fail-open rules) counts as no observation: it neither
starts, extends nor confirms an absence.

FR-2. **Automatic recovery.** When a flagged symbol is servable again in a successfully loaded asset
set, the flag clears and the symbol behaves as a normal watchlist symbol. A symbol that was removed
from a "Signals" watchlist under FR-3 is not re-added by the recovery itself.

FR-3. **System-managed watchlists: remove.** When a symbol becomes flagged delisted it is removed from
every system-managed (`system_managed = true`) watchlist that holds it. Feature 282's add-time gate is
unchanged, so a later `ingest_signal` for the same symbol is still refused while it is unservable.

FR-4. **User-created watchlists: keep and mark.** On a watchlist that is not system-managed, a flagged
symbol stays on the list and carries the delisted state: flag, reason and first-unservable date. The
user can still remove it by hand.

FR-5. **No watchlist-driven requests for a flagged symbol.** Work that derives its symbol set from
watchlists (keeping symbols warm, bar and quote ingestion, watchlist-driven backfills and scans) does
not request a flagged symbol. This closes feature 282's residual R2 without waiting for a restart.

FR-6. **Stored data and held positions are untouched.** Flagging a symbol or removing it from a
watchlist deletes no stored bars and no stored fundamentals; both stay readable for backtests. A flagged
symbol held in a position is still valued as it is today (MARKETDATA-16, R11): quote and price readers
are not filtered.

FR-7. **Backfill outcome `skipped`.** A backfill that names a flagged symbol still attempts it. When the
attempt succeeds the symbol is reported as today (`written` or `empty`). When the source cannot serve it
(for example EDGAR `no CIK for ticker`), the symbol is reported `skipped`, not `failed`: it is not in
`failed_symbols`, it does not make the job `PARTIAL`, and `marketdata.backfill.symbols` records outcome
`skipped`. This applies to every backfill data kind.

FR-8. **Real failures unchanged.** A symbol that is not flagged delisted and fails is still `failed`,
is still in `failed_symbols`, and still makes the job `PARTIAL` (or `FAILED`) under today's rules.

FR-9. **Per-symbol outcome and reason in the job status.** The backfill job status carries, for every
symbol that was not written, its outcome (`empty`, `skipped`, `failed`) and the reason (for `skipped`
and `failed`, the source's error). The reason no longer has to be read from the marketdata log.

FR-10. **Visible in the UI.** The `/insights` watchlist detail page shows a delisted marker with the
reason and the first-unservable date on every flagged symbol.

FR-11. **Visible to the agent.** `get_watchlist` and `list_watchlists` return the delisted state of each
flagged symbol; `get_backfill_status` returns the per-symbol outcomes and reasons of FR-9.

FR-12. **Alert on transition.** One alert is emitted through `xstockstrat-notify` when a symbol becomes
flagged delisted, naming the symbol, the reason, and the system-managed watchlists it was removed from.
The alert is emitted once per transition, not on every later refresh.

## Out of Scope

- **Ticker rename, successor mapping and reuse** (D-6). NWE → HZN, KPTI → KPTIQ, and a delisted ticker
  later assigned to another company are not handled; FR-2 clears the flag on reappearance without
  checking that it is the same company. Follow-up feature to be filed: `ticker-rename-and-reuse`.
- A standalone servability-check agent tool or UI (D-7).
- Removing a flagged symbol from user-created watchlists automatically (D-2).
- Deleting or archiving stored bars or fundamentals of a delisted symbol.
- Corroborating a delisting from a second source (exchange notices, Alpaca's per-asset record, last-bar
  age). Detection uses only the feature-282 asset set plus the confirmation window (D-4).
- The ADBT / HONA failures of the same 2026-11-16 run (a false positive of feature 348's filer guard on
  version-1 rows). Separate bug.
- The bar ingester's dead-symbol hold (feature 291, `stream.bar_ingest_backoff_ms`) is not changed.

## Affected Services

Exact service names from CLAUDE.md Service Registry:
- `xstockstrat-marketdata` — owns the asset set and the warm set; backfill per-symbol outcome `skipped`
  and reason; metric outcome
- `xstockstrat-portfolio` — owns watchlists: delisted state on entries, removal from system-managed lists
- `xstockstrat-ingest` — owns `BackfillJob`: per-symbol outcome and reason, terminal status rule
- `xstockstrat-agent` — `get_watchlist`, `list_watchlists`, `get_backfill_status` response mapping
- `xstockstrat-ui` — `/insights` watchlist detail marker
- `xstockstrat-notify` — receives the transition alert through the existing alert path (no change
  expected in the service itself)
- `packages/proto` — contract additions below

Which service detects the transition and holds the delisted state is a design decision (Open Questions).

## Consumer Surface(s)

_Constitution **C-14**._ The end-user-reachable surface(s) this capability is consumed through.

- [x] **UI** — `xstockstrat-ui` segment `/insights`: the existing watchlist detail page gains a delisted
  marker (reason, first-unservable date) per flagged symbol. No new page or route, so no
  `PLATFORM_SUBNAV` change (**C-10**).
- [x] **Agent** — `xstockstrat-agent` MCP tools `get_watchlist`, `list_watchlists` (delisted state per
  symbol) and `get_backfill_status` (per-symbol outcome and reason). Changed response mapping only; no
  new tool and no new argument.
- [ ] **None**

## Proto Contract Changes

Additive only; exact messages and field numbers are for `/sdd-design` and `/sdd-spec`. Expected:

- `packages/proto/ingest/v1/ingest.proto` `BackfillJob` — per-symbol outcome and reason (FR-9).
- `packages/proto/marketdata/v1/marketdata.proto` `BackfillFundamentalsResponse` and
  `BackfillBarsResponse` — skipped symbols and per-symbol reasons (FR-7, FR-9).
- `packages/proto/portfolio/v1/portfolio.proto` — delisted state on a watchlist entry (FR-4).
- The per-symbol outcome is a closed set and must be an enum with a `_UNSPECIFIED = 0` value; the reason
  reuses `xstockstrat.common.v1.UnservableReason` where it is the unservable reason, and is a string
  where it is a source error text.

## Config Key Changes

One new key is expected: the confirmation window of FR-1. Its namespace follows the service that owns
detection, which is a design decision, so the key is not declared here yet. `/sdd-design` must name it
and state the full config-key contract (namespace, key, `value_type`, code default, reader `path:symbol`,
seed migration, live mechanism — C-05). The default value is an Open Question.

## Database Changes

Expected, exact shape for design:

- Persisted delisted state for watchlist entries (flag, reason, first-unservable date), so the state
  survives a restart — the asset set itself is in memory only.
- Persisted per-symbol outcome and reason for backfill jobs, if `BackfillJob` rows do not already hold
  them.
- A config migration seeding the confirmation-window key.

## Feature Workflow Notes

Branch to create: `feature/delisted-symbol-handling` (branch from `main-dev`)
Approval gates required (per docs/runbooks/feature-workflow.md):
- [x] 1 service owner approval (non-breaking proto or config change)
- [ ] 2 service owners + platform lead (breaking proto change)
- [x] DBA review + service owner (schema migration)

`get_backfill_status` and `trigger_backfill` behavior changes, so the `strat-lab` plugin's `backtest`
skill and `docs/runbooks/mcp-tools.md` must be updated in the same PR as the tool change
(`docs/patterns/strat-lab-plugin.md`).

## Acceptance Criteria

See `acceptance.feature` (scenarios `@AC-*`) — the single source of acceptance truth (Constitution
**C-15**). Each `FR-N` above is covered by ≥1 tagged scenario there.

## Open Questions

- [ ] **Confirmation-window default and unit** (FR-1). The operator chose a configurable window but no
  value. The acceptance scenarios use 3 days as an example value only. Operator to confirm the default.
- [ ] **Where the delisted state lives.** Per watchlist entry (portfolio) or per symbol platform-wide
  (marketdata). FR-7 needs the state for a symbol named in a backfill; whether a symbol that is on no
  watchlist can be flagged, and therefore `skipped`, is not settled.
- [ ] **Which components request watchlist symbols** (FR-5). Recon must list every watchlist-driven
  requester (warm set, bar ingester, scans, the agent's watchlist-driven backfills) so none is missed.
- [ ] **Record of the automatic removal** (FR-3). Whether removing a symbol from a "Signals" watchlist
  also writes a ledger event, beyond the FR-12 alert. Not decided by the operator.
- [ ] **Alert volume** (FR-12). One alert per symbol, or one per detection pass listing every symbol
  that transitioned. On first rollout several symbols (ROKU, NWE, KPTI, ATCH) transition at once.
- [ ] **Symbols on "Signals" with an unexpired signal** (FR-3). Removal also drops the entry's
  `portfolio.watchlist_signal_expiry` row; confirm nothing else depends on it.
- [ ] **Known trap (ledger `fails.md`, agent docs drift).** `tools.py` docstrings,
  `docs/runbooks/mcp-tools.md` and the `strat-lab` skill drift from the code unless updated in the same
  PR; the implementation spec needs an explicit step for all three.
- [ ] **Existing business rules (C-16).** Feature 282's durable suites
  (`services/xstockstrat-marketdata/acceptance/filter-otc-symbols.feature`, the portfolio and agent
  `filter-otc-symbols.feature`) state that only the first asset-set load prunes the warm set. FR-5
  changes that guarantee; `/sdd-design` must classify the affected scenarios as CHANGE and get sign-off.
