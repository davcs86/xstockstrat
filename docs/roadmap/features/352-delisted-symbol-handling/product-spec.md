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
| D-8 | Confirmation-window default | 5 days (trading days, D-13) |
| D-9 | Where the delisted state lives | Platform-wide, per symbol, in a new symbol/company profile record. The profile is meant to hold further symbol metadata later; this feature stores only the delisted state in it |
| D-10 | Alert volume | One alert per symbol |
| D-11 | Change to feature 282's "only the first asset-set load prunes the warm set" rule | Signed off (C-16 CHANGE) |
| D-12 | Record of the automatic removal from "Signals" | The FR-12 alert is enough; no ledger event |
| D-13 | Unit of the confirmation window | Trading days |
| D-14 | Which symbols get a profile row | Written lazily: a row is created when the platform first has state to record for a symbol. No pre-population |
| D-15 | Owner of the symbol profile | `xstockstrat-marketdata` |

## Functional Requirements

In this spec a symbol is **flagged delisted** when the platform has confirmed it unservable under FR-1.
"Unservable" keeps its feature-282 meaning (`UNSERVABLE_REASON_NOT_TRADABLE` or `UNSERVABLE_REASON_OTC`).

FR-1. **Detection with a confirmation window.** A symbol that is on at least one watchlist and is
unservable in every successfully loaded asset set for a configurable confirmation window (default 5
trading days, D-8, D-13) becomes flagged delisted. Days on which the market is closed do not count
toward the window. The flag records the unservable reason and the date the symbol was first seen unservable. A
symbol unservable for less than the window is not flagged and nothing about it changes. Several loads on the same
trading day count as one day of observation. A refresh that
is rejected or has not loaded yet (feature 282's fail-open rules) counts as no observation: it neither
starts, extends nor confirms an absence.

FR-2. **Automatic recovery.** When a flagged symbol is servable again in a successfully loaded asset
set, the flag clears and the symbol behaves as a normal watchlist symbol. A symbol that was removed
from a "Signals" watchlist under FR-3 is not re-added by the recovery itself.

FR-3. **System-managed watchlists: remove.** When a symbol becomes flagged delisted it is removed from
every system-managed (`system_managed = true`) watchlist that holds it. The removal is reported by the
FR-12 alert only; no ledger event is written (D-12). Feature 282's add-time gate is
unchanged, so a later `ingest_signal` for the same symbol is still refused while it is unservable.

FR-4. **User-created watchlists: keep and mark.** On a watchlist that is not system-managed, a flagged
symbol stays on the list and carries the delisted state: flag, reason and first-unservable date. The
user can still remove it by hand. Every portfolio RPC that returns watchlist entries carries the state.

FR-5. **No watchlist-driven requests for a flagged symbol.** Work that derives its symbol set from
watchlists (keeping symbols warm, bar and quote ingestion, watchlist opportunity scans, and any
scheduled watchlist-driven backfill) does not request a flagged symbol. A backfill that names its
symbols explicitly is governed by FR-7, not by this rule. This closes feature 282's residual R2 without waiting for a restart.

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

FR-12. **Alert on transition.** One alert per symbol (D-10) is emitted through `xstockstrat-notify` when
a symbol becomes flagged delisted, naming the symbol, the reason, and the system-managed watchlists it
was removed from. The alert is emitted once per transition, not on every later refresh.

FR-13. **Symbol profile.** The delisted state (flag, reason, first-unservable date) is stored once per
symbol, platform-wide, in a persisted symbol/company profile record owned by `xstockstrat-marketdata`
(D-9, D-15), and survives a restart. A profile row is written lazily, the first time there is state to
record for the symbol; symbols are not pre-populated (D-14). Every
watchlist that holds the symbol, whoever owns it, and every backfill read the same state. This feature
stores only the delisted state in the profile.

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
- Any symbol/company profile metadata other than the delisted state (name, exchange, sector, CIK,
  successor). D-9 names the profile as the future home for it; none is added here.
- The bar ingester's dead-symbol hold (feature 291, `stream.bar_ingest_backoff_ms`) is not changed.

## Affected Services

Exact service names from CLAUDE.md Service Registry:
- `xstockstrat-marketdata` — owns the asset set, the warm set, detection and the symbol profile
  (D-15); backfill per-symbol outcome `skipped` and reason; metric outcome
- `xstockstrat-portfolio` — owns watchlists: returns the delisted state on entries (read from
  marketdata), removal from system-managed lists
- `xstockstrat-ingest` — owns `BackfillJob`: per-symbol outcome and reason, terminal status rule
- `xstockstrat-agent` — `get_watchlist`, `list_watchlists`, `get_backfill_status` response mapping
- `xstockstrat-ui` — `/insights` watchlist detail marker
- `xstockstrat-notify` — receives the transition alert through the existing alert path (no change
  expected in the service itself)
- `packages/proto` — contract additions below

How the flag transition reaches `xstockstrat-portfolio` (which must remove the symbol from
system-managed watchlists) is a design decision; it adds an inter-service dependency either way.

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
- `packages/proto/portfolio/v1/portfolio.proto` — delisted state on a watchlist entry as returned to
  callers (FR-4); the stored state is the symbol profile's (FR-13).
- `packages/proto/marketdata/v1/marketdata.proto` — a read contract for the symbol profile's delisted
  state (FR-13).
- The per-symbol outcome is a closed set and must be an enum with a `_UNSPECIFIED = 0` value; the reason
  reuses `xstockstrat.common.v1.UnservableReason` where it is the unservable reason, and is a string
  where it is a source error text.

## Config Key Changes

One new key is expected: the confirmation window of FR-1, in namespace `marketdata` (D-15), an int
count of trading days with code default 5. Its key name is not declared here yet; `/sdd-design` must
name it and state the full config-key contract (namespace, key, `value_type`, code default, reader `path:symbol`,
seed migration, live mechanism — C-05).

Fixed here: the stored key is namespace-relative `<category>.<key>` under namespace `marketdata` (the
FQN is display-only); `value_type` int; code default 5; read live, so a change applies without a
restart. The reader `path:symbol` and the seed migration number are stated in `design.md`, and design
does not close without them. The seed is a new migration in `services/xstockstrat-config/migrations/`.

## Database Changes

Expected, exact shape for design:

- A new symbol/company profile table, one row per symbol, holding the delisted state (flag, reason,
  first-unservable date) so it survives a restart — the asset set itself is in memory only (FR-13).
  It lives in the `marketdata` schema (D-15); rows are written lazily (D-14).
- Persisted per-symbol outcome and reason for backfill jobs, if `BackfillJob` rows do not already hold
  them.
- A config migration seeding the confirmation-window key.

Migration strategy: each schema change ships as a new `NNN_<name>.up.sql` and `.down.sql` pair in the
owning service's `migrations/` directory — `xstockstrat-marketdata` (profile table),
`xstockstrat-ingest` (per-symbol job outcome, only if needed), `xstockstrat-config` (key seed). `NNN`
is the next free number at spec time; on `main-dev` today the last applied are marketdata `009`, ingest
`016` and config `052`, and config `053` is claimed by feature 345. The three are independent of each
other and run through `scripts/db-migrate.sh` in its normal order. No applied migration is edited and
none reaches outside its own schema.

## Feature Workflow Notes

Branch to create: `feature/delisted-symbol-handling` (branch from `main-dev`)
Approval gates required (per docs/runbooks/feature-workflow.md):
- [x] 1 service owner approval (non-breaking proto or config change)
- [ ] 2 service owners + platform lead (breaking proto change)
- [x] DBA review + service owner (schema migration)

`get_backfill_status` and `trigger_backfill` behavior changes, so the `strat-lab` plugin's `backtest`
skill and `docs/runbooks/mcp-tools.md` must be updated in the same PR as the tool change
(`docs/patterns/strat-lab-plugin.md`).

Trading-domain notes: detection reads only the feature-282 Alpaca asset set, which is not specific to
paper or live, so the behavior is the same in both. IBKR accounts and order routing are unaffected.
Order types, order submission and fill handling are not touched.

## Acceptance Criteria

See `acceptance.feature` (scenarios `@AC-*`) — the single source of acceptance truth (Constitution
**C-15**). Each `FR-N` above is covered by ≥1 tagged scenario there.

## Open Questions

Decided by the operator:

- [x] **Confirmation-window default** — 5 days (D-8).
- [x] **Where the delisted state lives** — platform-wide symbol profile (D-9, FR-13).
- [x] **Alert volume** — one alert per symbol (D-10).
- [x] **Existing business rules (C-16)** — the change to feature 282's "only the first asset-set load
  prunes the warm set" guarantee is signed off by the operator (D-11).
- [x] **Unit of the confirmation window** — trading days (D-13).
- [x] **Which service owns the symbol profile** — `xstockstrat-marketdata` (D-15).
- [x] **Which symbols get a profile row** — lazy write (D-14).
- [x] **Record of the automatic removal** — alert only, no ledger event (D-12).

No story-level question is open. The items below are inputs for `/sdd-design` (see § Design Inputs).

## Design Inputs

Not story decisions; `/sdd-design` Phase 0 recon resolves each. Interim assumption where one exists.

- **Trading-day source** (FR-1, D-13). Which market calendar counts trading days. Interim: marketdata's
  existing market calendar if it has one.
- **Lazy write and symbols on no watchlist** (FR-1, FR-7, D-14). Whether a backfill that names an
  unservable symbol on no watchlist also starts its profile row. Interim: it does not; such a symbol
  reports `failed`.
- **How portfolio learns of a transition** (FR-3). Marketdata owns the state and portfolio owns the
  watchlists; today portfolio calls marketdata, not the reverse.
- **Watchlist-driven requesters** (FR-5). Recon lists every one (warm set, bar ingester, opportunity
  scans, any scheduled backfill) so none is missed.
- **"Signals" entries with an unexpired signal** (FR-3). Removal also drops the entry's
  `portfolio.watchlist_signal_expiry` row (`services/xstockstrat-portfolio/internal/repository/signal_expiry_repo.go`).
- **Existing symbol-metadata table.** `marketdata.symbol_classification` (feature 217, migration `009`)
  already holds per-symbol sector history. Design decides whether the profile extends it, sits beside
  it, or stays separate.
- **Ingest job status rule and webhook payload.** `services/xstockstrat-ingest/app/handlers/servicer.py`
  derives `PARTIAL` from `failed_symbols`, and
  `services/xstockstrat-ingest/acceptance/webhook-fanout-callback.feature` fixes the webhook payload's
  exact keys. FR-7 and FR-9 change the first and may change the second (C-16 CHANGE to classify).
- **Feature 282's durable scenarios** (D-11). `/sdd-design` lists the scenarios in the marketdata,
  portfolio and agent `filter-otc-symbols.feature` suites as CHANGE; the "Asset-set servability"
  section of `services/xstockstrat-marketdata/CLAUDE.md` changes in the same PR.
- **Docs that drift** (ledger `fails.md`). The implementation spec carries explicit steps for the
  `tools.py` docstrings, `docs/runbooks/mcp-tools.md` and the `strat-lab` `backtest` skill.
- **Rebase risk** (overlap scan 2026-11-16). Features 347 and 348 (code-completed) edit
  `services/xstockstrat-marketdata/internal/service/marketdata_service.go`; 343 edits
  `services/xstockstrat-agent/app/tools.py`; 317 (spec-ready) changes miss-path WARNs for delisted
  symbols.
