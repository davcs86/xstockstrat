# Design: delisted-symbol-handling

**Created**: 2026-11-17
**Rounds**: 4 (full; termination: DRAFT — under round-4 adversarial review, not approved)
**Approved by**: _pending_
**Grounded in**: recon.md
**Debate register**: debate.md

---

## Chosen Approach

Decision IDs `D-n` / `R-n` / `O-n` refer to `debate.md`; "spec D-n" refers to the operator decisions in
`product-spec.md`. Paths are relative to `services/` unless they start with `packages/` or `docs/`.

### 1. Shape

`xstockstrat-marketdata` owns the per-symbol delisted state and is the only writer of it (D-2, D-19).
`xstockstrat-portfolio` pulls over the edge that already exists (D-1): on its existing prune tick it
sends the watchlist symbol union, reads back the flagged symbols, removes them from system-managed
lists, sends the flag alert and acknowledges it. There is no marketdata → portfolio edge, no new env
var and no portfolio migration (recon.md § Dependencies).

### 2. Marketdata schema — migration `010_symbol_profile`

```sql
CREATE TABLE marketdata.symbol_profile (
  symbol                TEXT PRIMARY KEY,
  first_unservable_date DATE,          -- NYSE session date; always a trading day
  unservable_reason     SMALLINT,      -- common.v1.UnservableReason number
  delisted_at           TIMESTAMPTZ,   -- NULL = not flagged
  alert_claimed_at      TIMESTAMPTZ,
  alert_acked_at        TIMESTAMPTZ,
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK ((first_unservable_date IS NULL) = (unservable_reason IS NULL)),
  CHECK (unservable_reason IS NULL OR unservable_reason > 0),
  CHECK (delisted_at IS NULL OR first_unservable_date IS NOT NULL),
  CHECK (alert_claimed_at IS NULL OR delisted_at IS NOT NULL),
  CHECK (alert_acked_at  IS NULL OR alert_claimed_at IS NOT NULL));
CREATE INDEX symbol_profile_flagged_idx ON marketdata.symbol_profile (symbol) WHERE delisted_at IS NOT NULL;
CREATE TABLE marketdata.watched_symbol (symbol TEXT PRIMARY KEY);
```

- `symbol_profile` is a sibling of `symbol_classification`, which is a Type-2 history table and does
  not fit (recon.md § Risks; `xstockstrat-marketdata/migrations/009_symbol_classification.up.sql:4-17`).
- A row is written on the first unservable observation (spec D-14). A reset or a recovery sets the
  state columns to NULL and keeps the row (R-8, spec D-9).
- `watched_symbol` is marketdata's copy of portfolio's watchlist symbol union (D-20). It holds no state.
- New repo `xstockstrat-marketdata/internal/repository/profile_repo.go`, copying
  `classification_repo.go` (shared pool, pgxmock test, `dbtest` real-DB test).
- DATE values are bound as date-only text and read back as text (D-17, D-24;
  `xstockstrat-marketdata/internal/repository/pool.go:31-33`).

### 3. Detection hook (marketdata, sole decider — D-5, D-14, D-19, D-20, D-21)

`refreshAssets` order (`xstockstrat-marketdata/internal/service/asset_servability.go:113-150`): shrink
guard → `snap.Store(next)` (`:135`) → on the first load only, the existing warm prune (`:136-148`; the
early return at `:136-138` is restructured) → `runDelistingHook` on every successful load, under a 30 s
context. A rejected or failed load never reaches the hook (`:124`, `:133`). A hook error or timeout logs
a WARN and increments a counter; it never fails the load.

The hook computes `d`, the NYSE session date of now (America/New_York), from the shared calendar (§8).
On a trading day it reads the candidates (`watched_symbol` ∪ profile rows with a first-unservable date),
classifies each against `next` (`classify`, `:46`), reads `N` (§9) and runs five statements in order,
stopping at the first error. Each is one autocommitted conditional statement that locks its rows in
symbol order (D-3, D-21):

| Step | Applies to | Effect |
|---|---|---|
| H1 reset (servable again) | unflagged started rows, servable now | first-unservable date and reason → NULL |
| H2 reset (left every watchlist) | unflagged started rows whose symbol is not in `watched_symbol`; runs only when `watched_symbol` is non-empty | same; count logged at INFO (D-13) |
| H3 start | symbols in `watched_symbol`, unservable now, with no row or a reset row | first-unservable date = `d`, reason set |
| H4 flag | unflagged started rows, unservable now, in `watched_symbol`, with `TradingDaysInclusive(first, d) ≥ N` | `delisted_at = now()` |
| H5 recover | flagged rows, servable now (the union is ignored) | all state columns → NULL; returns whether the flag alert had been claimed |

After H5 commits, marketdata sends one recovery alert per recovered row whose flag alert had been
claimed (D-16, D-22). Then, on every load including closed days, it rebuilds the in-memory flagged set
from the database and deletes flagged symbols from `warmSymbols` (D-5). The same read runs once at boot,
independent of the asset load (D-15).

Truth table for a trading-day load:

| Row state | Servable now | In union | Not in union (union non-empty) | Union empty |
|---|---|---|---|---|
| absent or reset | no | H3 start (and H4 on the same load only if N = 1) | nothing | nothing |
| absent or reset | yes | nothing | nothing | nothing |
| unflagged, started | no | H4 flag if the window has elapsed | H2 reset | nothing |
| unflagged, started | yes | H1 reset | H1 reset | H1 reset |
| flagged | no | stays flagged | stays flagged | stays flagged |
| flagged | yes | H5 recover | H5 recover | H5 recover |

A closed-day load makes no transition. The union condition sits only on H3 and H4 (FR-1 "on at least
one watchlist"); H2 never touches a flagged row and H5 ignores the union, so a flag persists
off-watchlist and clears only on recovery (spec D-17).

`markWarm` stays ungated (R-7): quote and price paths are unchanged, a held flagged symbol is re-warmed
by the next quote read and leaves again at the next load (D-11).

### 4. Sync and acknowledge RPCs (marketdata — D-1, D-20, D-22, D-23)

`SyncWatchlistDelistings`, in order:

1. Inbound internal-caller check — a new marketdata allow-list modelled on
   `xstockstrat-portfolio/internal/service/authz.go:9-38`, grants `{portfolio, SyncWatchlistDelistings}`
   and `{portfolio, AckDelistingAlerts}`. Marketdata has no inbound check today.
2. More than 20 000 symbols → `InvalidArgument`. Normalize, dedupe, sort.
3. Union rewrite: an ordered insert of new symbols, then an anti-join delete of symbols no longer in the
   request. An empty request clears the table (D-20).
4. Claim: flagged rows whose alert is unacknowledged and either never claimed or claimed more than 10
   minutes ago, **and whose symbol is unservable in the handler's current asset set**, at most 100,
   `FOR UPDATE SKIP LOCKED`; sets `alert_claimed_at = now()` and returns whether it was a re-claim.
5. Read the flagged rows whose symbol is in the request, from the database (never from memory).
6. Respond with those rows plus any claimed row not in the request.

Each response entry carries the delisted state, `unservable_in_current_set` (true only when the asset
set is loaded and the symbol is unservable in it; the default false means "do not remove") and one
`alert_state`:

| Value | Rule |
|---|---|
| `REPORTED` | the alert is acknowledged |
| `CLAIMED` | claimed by this call for the first time |
| `REDELIVERY` | claimed by this call after a lease expired |
| `PENDING` | anything else: not yet claimed, leased to another caller, skipped by SKIP LOCKED, over the limit of 100, or servable now |

`AckDelistingAlerts` sets `alert_acked_at` on flagged, claimed, unacknowledged rows of the symbols it is
given, with the same ordered-lock shape (D-24).

A flagged symbol that is servable in the current asset set (recovery lags by a load, a weekend or a
holiday) is still decorated and filtered, but is never claimed, removed or alerted; when the hook later
recovers it, no claim exists, so no recovery alert is sent either (O-33, D-16).

### 5. Portfolio tick (D-8, D-10, D-12, D-18, D-22, D-23)

A new step after the existing expiry prune in `pruneOnce`
(`xstockstrat-portfolio/internal/service/signal_prune.go:51-79`), in a new
`internal/service/delisting_sync.go`:

1. Union from the unfiltered repo `ListAllSymbols`
   (`xstockstrat-portfolio/internal/repository/watchlist_repo.go:446`). On error, or above 20 000
   symbols: WARN, keep the old cache, stop.
2. Call `SyncWatchlistDelistings` under a fixed 15 s deadline with `x-internal-caller: portfolio`. On
   error or timeout: WARN, `RecordMarketdataFetch(op="delistings", …)`, keep the old cache, remove
   nothing (D-12).
3. Replace the in-memory cache (symbol → delisted state) with every response entry, whatever its alert
   state.
4. Removal set = entries with `alert_state` in {`CLAIMED`, `REDELIVERY`, `REPORTED`} and
   `unservable_in_current_set`.
5. Remove them from system-managed lists with a new `removeDelistedListTx`, a sibling of `pruneListTx`
   (`xstockstrat-portfolio/internal/repository/signal_expiry_repo.go:61`), which is untouched. Per
   list: lock the parent `FOR NO KEY UPDATE SKIP LOCKED` (a locked list is skipped), re-check
   `system_managed`, delete the bindings of any source, delete the removed symbols' expiry rows with a
   plain DELETE, touch `updated_at`, commit. No ledger event (spec D-12).
6. For `CLAIMED` and `REDELIVERY` entries, send one alert each: WARNING, category `symbol_delisting`,
   untargeted, through a new portfolio emitter that writes no ledger event and returns its error. A
   `CLAIMED` alert names the symbol, the reason, the first-unservable date, and the count and names of
   the system-managed lists removed on this tick; lists locked on this tick are counted as "removed on a
   later refresh" and are removed silently later. A `REDELIVERY` alert says it repeats an earlier alert
   and that the removal was done on an earlier refresh.
7. Acknowledge the symbols whose alert was sent, through `AckDelistingAlerts` under a 15 s deadline. A
   failed send or a failed acknowledgement leaves the claim unacknowledged; it is re-claimed as
   `REDELIVERY` after the lease (D-18).

One helper decorates `WatchlistBinding.delisted` from the cache on every watchlist-returning RPC
(`xstockstrat-portfolio/internal/service/portfolio_service.go:2233`, `:2246`, and the create, update,
add, remove and binding responses). `ListAllWatchlistSymbols` (`:2220`) drops cached symbols. An empty
cache decorates and filters nothing. A replace-all update still drops a flagged symbol (R-10, FR-4).

### 6. Backfill outcomes (D-6, D-9, D-17)

- Marketdata builds `symbol_results` for non-written symbols in both loops
  (`xstockstrat-marketdata/internal/service/marketdata_service.go:1549-1570`, `:2323-2337`). A source
  error on a symbol in the in-memory flagged set is `SKIPPED` with the error text as reason; on any
  other symbol it is `FAILED` and stays in `failed_symbols`. A failure writing to our own database is
  always `FAILED`. Zero rows is `EMPTY`. In the fundamentals path only the `FetchHistorical` error
  (`:2347-2349`) is wrapped as a source error. New metric outcome value `skipped`
  (`xstockstrat-marketdata/internal/telemetry/otel.go:360-366`), no new label key.
- Ingest migration `017` adds `ingest.backfill_jobs.symbol_results JSONB`, written per chunk as JSON
  text inside the locked `update_job` and parsed on read
  (`xstockstrat-ingest/app/handlers/servicer.py:980-1004`, `app/repositories/backfill_jobs.py:13-26`).
  Results merge per symbol (failed > skipped > written > empty); a whole-chunk RPC failure writes
  `FAILED` for every symbol of the chunk. Resume keeps the stored results of completed chunks and never
  seeds `failed_symbols` (R-9). The PARTIAL rules (`servicer.py:705-707`, `:827-833`) and the 8-key
  webhook payload are unchanged (R-6).

### 7. Consumer surfaces (C-14)

- **Proto**: `WatchlistBinding.delisted = 4`, a `common.v1.DelistedState {reason, first_unservable_date}`
  message; presence means flagged; the date is a `YYYY-MM-DD` string (D-24).
- **Agent**: `_watchlist_to_dict` (`xstockstrat-agent/app/client.py:377`) post-processes every binding
  to `delisted: bool` (always present) plus `delisted_reason` and `first_unservable_date` when flagged;
  `get_backfill_status` (`:2146`) maps outcomes to `empty|skipped|failed`. Docstrings, the agent
  CLAUDE.md, `docs/runbooks/mcp-tools.md` and the strat-lab `backfill.md` and `SKILL.md` change in the
  same PR.
- **UI**: a badge on the `WatchlistReadiness` row
  (`xstockstrat-ui/src/components/insights/WatchlistReadiness.tsx:303-368`, `:372-396`) with
  `UNSERVABLE_REASON[reason]` (`xstockstrat-ui/src/lib/opportunityShared.tsx:48-52`) and the date string
  as given; `mockWatchlists` and `e2e/fixtures/INVENTORY.md` are extended (C-12).
- **Analysis**: flagged bindings are skipped in `_drain_watchlist_bindings`
  (`xstockstrat-analysis/app/handlers/servicer.py:5995`) and `_drain_watchlist`
  (`xstockstrat-analysis/app/engine/live_loop.py:592`); the fundsignal union is covered by portfolio's
  filter.

### 8. Trading calendar (D-4)

The rule-based NYSE calendar moves from `xstockstrat-portfolio/internal/marketsession` to
`packages/proto/marketsession` (the `pnl/` precedent, `packages/proto/CLAUDE.md:7-13`), gaining a
trading-days-inclusive count and a session-date helper. Its test moves to a portfolio service test; two
portfolio callers are re-pointed. One-off closures are not modelled.

### 9. Config, proto, migrations, fixed values

- **Config key** (C-05): namespace `marketdata`, key `assets.delisting_confirmation_trading_days`, int,
  default 5; read nil or ≤ 0 → 5, > 30 → 30; SetConfig bounds [1, 30]; reader
  `resolveDelistingConfirmationDays` in `asset_servability.go` on the same watcher as
  `resolveAssetRefreshInterval` (`:169-181`), re-read at each load; seed config migration `054`
  (`052` is the last on `main-dev`, `053` is claimed by feature 345; re-checked at spec time), in the
  same commit as the reader.
- **Proto** (additive): `common/v1` `BackfillSymbolOutcome {UNSPECIFIED=0, EMPTY=1, SKIPPED=2,
  FAILED=3}`, `BackfillSymbolResult {symbol=1, outcome=2, reason=3}`, `DelistedState {reason=1,
  first_unservable_date=2}`; `marketdata/v1` `BackfillBarsResponse.symbol_results=4`,
  `BackfillFundamentalsResponse.symbol_results=3`, RPCs `SyncWatchlistDelistings` and
  `AckDelistingAlerts`, `DelistingAlertState {UNSPECIFIED=0, PENDING=1, CLAIMED=2, REDELIVERY=3,
  REPORTED=4}`, `FlaggedSymbol {symbol=1, state=2, alert_state=3, unservable_in_current_set=4}`;
  `ingest/v1` `BackfillJob.symbol_results=16`; `portfolio/v1` `WatchlistBinding.delisted=4`.
- **Migrations**: marketdata `010`, ingest `017`, config `054`.
- **Fixed values** (operator-approved 2026-11-17, not config keys): hook time limit 30 s; flag-alert
  lease 10 minutes; sync and acknowledge deadline 15 s; 20 000 symbols per sync; 100 claims per sync.

### 10. Rollout

Every additive field means the non-destructive state when absent. At deploy both tables are empty: the
boot load starts nothing; portfolio's first tick fills the union; the next load starts every currently
unservable watchlist symbol, dated that day; `N` trading days later one load flags them together and
portfolio alerts for at most 100 per tick. A runbook note gives the query that counts the coming burst.

## Rejected Alternatives

- `R-1` Marketdata pushing to portfolio — adds an edge against the graph direction, an env var in three deploy files and an authz grant.
- `R-2` Observing the warm set — an already-unservable symbol is never warmed.
- `R-3` Alpaca `/v2/calendar` — new client and failure modes for rare one-off closures.
- `R-4` Filtering flagged symbols out of portfolio's watchlist responses — hides the required marker.
- `R-5` A marketdata RPC on every watchlist read — one RPC per read; a cache is a map lookup.
- `R-6` Per-symbol outcomes in the webhook payload — changes 334 `@AC-30`.
- `R-7` Making `markWarm` skip flagged symbols — not needed for FR-5, contradicts FR-6, regresses 282 `@AC-16` and `@AC-26`.
- `R-8` Deleting the profile row on reset — same cost; the profile is to hold further metadata.
- `R-9` Seeding resumed jobs from stored `failed_symbols` — a successful re-run would still end PARTIAL.
- `R-10` Keeping a flagged symbol through a replace-all update — declined by the operator; 282 portfolio `@AC-19` stays.
- `R-11` Reading the flagged set from the database per backfill symbol — a query per symbol; the boot load covers the cold start.
- `R-12` Holding the union in memory only — lost on restart; one instance only.
- `R-13` Acknowledging on the next sync — the lease would have to exceed the prune interval.
- `R-14` Reusing the insert-path timeout key for the sync — wrong budget for a background write.

## Open Risks

- [ ] The recovery alert is at-most-once (accepted by the operator).
- [ ] A hook timeout on a load where a symbol was servable misses a reset; the symbol can flag earlier than the 5-day rule (accepted by the operator; WARN and counter).
- [ ] Another marketdata instance's flag is invisible to this instance's backfills until its next load.
- [ ] A quote read re-warms a flagged symbol until the next load (D-11).
- [ ] The union depends on portfolio's tick: observation lags a watchlist add by up to one prune interval, and a portfolio outage freezes the last union.
- [ ] `first_unservable_date` for symbols already dead at deploy is the deploy-era load date.
- [ ] The config seed number and the two portfolio callers of `marketsession` are re-verified at spec time.

## Constitution Rules Touched

- `C-04` — honored by: outcome and alert state are enums with `_UNSPECIFIED = 0`; the reason reuses `UnservableReason`.
- `C-05` / `F-07` — honored by: the confirmation window is a seeded, live-read, namespace-relative key; the five fixed values are operator-approved invariants.
- `C-07` / `F-01` — honored by: three new numbered migrations, none edited.
- `C-10` / `C-14` — honored by: the state is decorated on every watchlist-returning RPC and reaches the agent tools and the `/insights` row.
- `C-12` / `C-13` — honored by: UI fixtures through `watchlistMock` and `INVENTORY.md`; Go fixtures in `internal/testdata/`.
- `C-15` — honored by: every `@AC-n` maps to a mechanism; AC-29 amended with operator sign-off.
- `C-16` — see Business Rules Touched.
- `C-18` — honored by: one decider, one deleter per resource, no new edge, no portfolio storage.
- `F-06` — honored by: no new pool; the new queries use marketdata's and portfolio's existing pooled connections.
- `P-03` / `P-04` — honored by: every scope fork was put to the operator and recorded in context.md.

## Business Rules Touched (C-16)

- CHANGE `@AC-15 @FR-3 @feature-282` "The first successful load removes unservable symbols warmed while unloaded" (`services/xstockstrat-marketdata/acceptance/filter-otc-symbols.feature`) — a later load removes flagged symbols from the warm set; signed off by the operator 2026-11-16 (spec D-11, context.md).
- CHANGE `@AC-17 @FR-3 @feature-282` "A held offline unservable symbol stays valued and warm across later refreshes" (`docs/sdd/business-rules/platform.feature`) — for flagged symbols only, the symbol leaves the warm set at each load and is re-warmed by the next quote read; it stays valued; signed off by the operator 2026-11-16 (context.md, debate D-11).
- PRESERVE `@AC-16`, `@AC-26` `@feature-282` (marketdata `filter-otc-symbols.feature`) — `markWarm` stays ungated.
- PRESERVE `@AC-19 @feature-282` (`services/xstockstrat-portfolio/acceptance/filter-otc-symbols.feature`) — replace-all still drops a stored unservable symbol.
- PRESERVE `@AC-2`..`@AC-8`, `@AC-13` `@feature-281` (`services/xstockstrat-portfolio/acceptance/signal-watchlist-expiry-pruning.feature`) — `pruneListTx` untouched; the new removal emits neither 281 event and deletes the expiry rows of what it removes.
- PRESERVE `@AC-30 @feature-334` (`services/xstockstrat-ingest/acceptance/webhook-fanout-callback.feature`) — payload keeps its 8 keys.
- PRESERVE `@AC-6 @feature-261`, `@AC-9 @feature-343`, `@AC-41 @feature-294`, `@AC-1`/`@AC-6` `@feature-291`, `@feature-347` loop bounds, `@feature-242` untargeted push.
- EXTEND `@AC-1 @feature-154` (portfolio) and `@AC-3`, `@AC-4` `@feature-154`, `@AC-2 @feature-180` (analysis) — flagged symbols leave the union and the scan universe.
- EXTEND `@AC-14 @feature-294` — outcome value `skipped`.
- EXTEND `@AC-18 @feature-282`, `@AC-1`, `@AC-2`, `@AC-7`, `@AC-8` `@feature-148` (agent) and `@AC-8 @feature-127` (UI) — entries carry the delisted state and marker.
