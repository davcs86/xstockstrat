# Design: delisted-symbol-handling

**Created**: 2026-11-17
**Rounds**: 6 (full, round cap of 5 overridden by the operator 2026-11-17; termination: DRAFT — under round-6 review, not approved)
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

The hook computes `d`, the New York calendar date of now; it is a trading day iff the shared calendar's
`IsTradingDay(d)` (§8). The existing `SessionDate` helper is **not** used: it shifts the time by +6 h
(`xstockstrat-portfolio/internal/marketsession/marketsession.go:20-25`) and would turn a Friday-evening
load into a Saturday. On a trading day it reads the candidates (`watched_symbol` ∪ profile rows with a first-unservable date),
classifies each against `next` (`classify`, `:46`), reads `N` (§9) and runs five statements in order,
stopping at the first error. Each is one autocommitted conditional statement that locks its rows in
symbol order (D-3, D-21):

| Step | Applies to | Effect |
|---|---|---|
| H1 reset (servable again) | unflagged started rows, servable now | first-unservable date and reason → NULL |
| H2 reset (left every watchlist) | unflagged started rows whose symbol is not in `watched_symbol`; runs only when `watched_symbol` is non-empty | same; count logged at INFO (D-13) |
| H3 start | symbols in `watched_symbol`, unservable now, with no row or a reset row | first-unservable date = `d`, reason set |
| H4 flag | unflagged started rows, unservable now, in `watched_symbol`, with `first_unservable_date ≤ c`, where `c` is the Nth trading day counting back from `d` inclusive (computed in Go, bound as date-only text); the window test is re-checked inside the statement | `delisted_at = now()` |
| H5 recover | flagged rows, servable now (the union is ignored) | all state columns → NULL; returns whether the flag alert had been claimed |

After the statements finish — completed, stopped at an error, or skipped on a closed day — the hook
rebuilds the in-memory flagged set from the database and deletes flagged symbols from `warmSymbols`
(D-5); only expiry of the 30 s context prevents the rebuild (WARN and counter). Only then does it send
one recovery alert per recovered row whose flag alert had been claimed (D-16, D-22), each send bounded
at 15 s within what remains of the 30 s context, so a notify stall cannot cost the rebuild; a send that
is cut off is lost (the accepted at-most-once residual) and logged at WARN. FR-12 keys the recovery
alert on the flag alert having been claimed for sending, not on the `REPORTED` alert state (operator
ruling 2026-11-17). Recovery alerts go through a new title- and
category-parameterised emitter beside `emitWarning`, which delegates to it
(`xstockstrat-marketdata/internal/service/marketdata_service.go:2160-2171`): WARNING, category
`symbol_delisting`, untargeted. One INFO per load names why a step did not run — closed day (no
transitions) or empty union (H2 skipped; H3 and H4 have no candidates) — and carries the per-step
counts. The same flagged-set read runs once at boot, independent of the
asset load (D-15). The stored reason is the one observed when the row started; H4 does not refresh it.

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
   and `{portfolio, AckDelistingAlerts}`. A grant requires both the `x-internal-caller` header and the
   mTLS peer identity of `xstockstrat-portfolio` (PLAT-9); the header alone is not enough. Marketdata has no inbound check today; the check applies to
   these two RPCs only and no existing marketdata RPC gains one.
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

All three servability uses in one call (the claim filter, `unservable_in_current_set`, and the
"servable now" case of `PENDING`) come from a single read of the asset-set pointer, so `CLAIMED` or
`REDELIVERY` always implies `unservable_in_current_set = true`; an unloaded asset set claims nothing.
The response is built from the claim's own returned rows, never from a re-read, so a symbol the hook
recovers mid-call cannot have a claim without a response entry.

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
2. Call `SyncWatchlistDelistings` under a fixed 15 s deadline with `x-internal-caller: portfolio`
   appended to the tick context, which already carries only `x-trace-id`
   (`xstockstrat-portfolio/internal/service/signal_prune.go:52`); no user headers are sent, as for the
   281 prune. On
   error or timeout: WARN, `RecordMarketdataFetch(op="delistings", …)`, keep the old cache, remove
   nothing (D-12).
3. Replace the in-memory cache (symbol → delisted state) with every response entry, whatever its alert
   state. A symbol the hook recovered drops out of the next response and so out of the cache; a stale
   entry decorates and filters for at most one tick and never drives a removal.
4. Removal set = entries with `alert_state` in {`CLAIMED`, `REDELIVERY`, `REPORTED`} and
   `unservable_in_current_set`.
5. Remove them from system-managed lists with a new `removeDelistedListTx`, a sibling of `pruneListTx`
   (`xstockstrat-portfolio/internal/repository/signal_expiry_repo.go:61`), which is untouched. Per
   list: lock the parent `FOR NO KEY UPDATE SKIP LOCKED` (a locked list is skipped), re-check
   `system_managed`, lock the bindings of any source `FOR UPDATE SKIP LOCKED` and delete only the
   locked set, delete the removed symbols' expiry rows with a plain DELETE, touch `updated_at`, commit.
   Nothing in it ever waits: `UpdateBinding` locks the binding before the parent
   (`xstockstrat-portfolio/internal/repository/watchlist_repo.go:361-372`), so waiting on a binding
   while holding the parent would deadlock. A list whose bindings were skipped counts like a locked
   list. The lists holding the removal set are found with one set-based query per tick, driven from
   the `system_managed` watchlists into the `(watchlist_id, symbol)` primary key with
   `symbol = ANY($1)`; no new portfolio index or migration. No ledger event
   (spec D-12); a removal that carries no alert is logged at INFO.
6. For `CLAIMED` and `REDELIVERY` entries, send one alert each: WARNING, category `symbol_delisting`,
   untargeted, through a new portfolio emitter that writes no ledger event and returns its error. A
   `CLAIMED` alert names the symbol, the reason, the first-unservable date, and the count and names of
   the system-managed lists removed on this tick; lists locked on this tick are counted as "removed on a
   later refresh" and are removed silently later. A `REDELIVERY` alert says it may repeat an earlier
   alert and names the lists removed on this tick, if any. Each send is bounded at 15 s, and the alert
   phase stops at the first failed or timed-out send; the unsent claims stay unacknowledged.
7. Acknowledge the symbols whose alert was sent, through `AckDelistingAlerts` under a 15 s deadline. A
   failed send or a failed acknowledgement leaves the claim unacknowledged; it is re-claimed as
   `REDELIVERY` after the lease (D-18).

One helper decorates `WatchlistBinding.delisted` from the cache on every watchlist-returning RPC
(`xstockstrat-portfolio/internal/service/portfolio_service.go:2233`, `:2246`, and the create, update,
add, remove and binding responses). `ListAllWatchlistSymbols` (`:2220`) drops cached symbols in the handler, after the
repo call at `:2225`; the repo `ListAllSymbols` itself stays unfiltered, because the tick's union depends
on it. An empty cache decorates and filters nothing. The acceptance Background ("runs after every
watchlist change and after every asset-set load") is a test precondition: step tests call the delisting
step directly after the change or load; at runtime it runs only on the prune tick. A replace-all update still drops a flagged symbol (R-10, FR-4).

### 6. Backfill outcomes (D-6, D-9, D-17)

- Marketdata builds `symbol_results` for non-written symbols in both loops
  (`xstockstrat-marketdata/internal/service/marketdata_service.go:1549-1570`, `:2323-2337`). A source
  error on a symbol in the in-memory flagged set is `SKIPPED` with the error text as reason; on any
  other symbol it is `FAILED` and stays in `failed_symbols`. A failure writing to our own database is
  always `FAILED`. Zero rows is `EMPTY`. In the fundamentals path only the `FetchHistorical` error
  (`:2347-2349`) is wrapped as a source error; in the bars loop only the `src.GetBars` error (`:1550`)
  is a source error and the `InsertBars` error (`:1561`) stays `FAILED`. New metric outcome value `skipped`
  (`xstockstrat-marketdata/internal/telemetry/otel.go:360-366`), no new label key.
- Ingest migration `017` adds `ingest.backfill_jobs.symbol_results JSONB`, written per chunk as JSON
  text inside the locked `update_job` and parsed on read
  (`xstockstrat-ingest/app/handlers/servicer.py:980-1004`, `app/repositories/backfill_jobs.py:13-26`).
  `symbol_results` is stored keyed by chunk (the chunk id, or `"fundamentals"`). Within a chunk, each
  attempt's results replace the entries of every symbol that attempt was sent, and a sent symbol absent
  from the results is dropped as written, so a symbol that fails and is then written on a retry leaves
  no `FAILED` entry. A resumed chunk replaces its own entry. The job view merges across chunks at read
  with failed > skipped > empty. A whole-chunk RPC failure writes `FAILED` for every symbol of the
  chunk. Resume keeps the stored entries of completed chunks and never seeds `failed_symbols` (R-9). Invariant, with a test per loop exit arm in both marketdata loops and in
  ingest's chunk, retry and resume paths: every symbol in `failed_symbols` has exactly one `FAILED`
  result; no `SKIPPED` or `EMPTY` symbol is in `failed_symbols`; results merge per symbol and are never
  replaced across chunks; a whole-chunk `FAILED` may override an earlier `SKIPPED`; a symbol has a
  `FAILED` result only if it is in `failed_symbols`, except the symbols of chunks completed before a
  restart (Open Risks). The PARTIAL rules (`servicer.py:705-707`, `:827-833`) and the 8-key
  webhook payload are unchanged (R-6).

### 7. Consumer surfaces (C-14)

- **Proto**: `WatchlistBinding.delisted = 4`, a `common.v1.DelistedState {reason, first_unservable_date}`
  message; presence means flagged; the date is a `YYYY-MM-DD` string (D-24), validated by the agent and
  the UI — a malformed date is omitted, never reformatted through a time zone.
- **Agent**: `_watchlist_to_dict` (`xstockstrat-agent/app/client.py:377`) post-processes every binding
  to `delisted: bool` (always present) plus `delisted_reason` and `first_unservable_date` when flagged;
  `get_backfill_status` (`:2146`) maps outcomes to `empty|skipped|failed`. Docstrings, the agent
  CLAUDE.md, `docs/runbooks/mcp-tools.md` and the strat-lab `backfill.md` and `SKILL.md` change in the
  same PR.
- **UI**: a badge on the `WatchlistReadiness` row
  (`xstockstrat-ui/src/components/insights/WatchlistReadiness.tsx:303-368`, `:372-396`) with
  `UNSERVABLE_REASON[reason]` (`xstockstrat-ui/src/lib/opportunityShared.tsx:48-52`) and the date string
  as given; `mockWatchlists` and `e2e/fixtures/INVENTORY.md` are extended (C-12). A flagged binding
  renders the badge in the verdict cell in place of the readiness skeleton, because analysis never
  resolves readiness for it (`WatchlistReadiness.tsx:296-297,333-340`).
- **Analysis**: flagged bindings are skipped in `_drain_watchlist_bindings`
  (`xstockstrat-analysis/app/handlers/servicer.py:5995`) and `_drain_watchlist`
  (`xstockstrat-analysis/app/engine/live_loop.py:592`); the fundsignal union is covered by portfolio's
  filter.

### 7a. Documents changed in the same PR

`services/xstockstrat-marketdata/CLAUDE.md` (the "only the first successful load prunes" sentence and
residual R2, the config row, the fixed values, the two RPCs and the inbound allow-list, the backfill
outcome bullet, the two tables); MARKETDATA-16; `services/xstockstrat-portfolio/CLAUDE.md` (dependency
row, the tick step, the `symbol_delisting` alert, the cross-user union wording); PORTFOLIO-18;
`packages/proto/CLAUDE.md`; the agent CLAUDE.md, `docs/runbooks/mcp-tools.md`, the strat-lab
`backfill.md` and `SKILL.md`; the durable scenarios listed under Business Rules Touched as CHANGE; a
rollout note for the burst; the Observability bullets (`marketdata.backfill.symbols` outcome `skipped`
and the hook timeout/error counter in marketdata; `portfolio.marketdata_fetch` op `delistings` in
portfolio).

### 8. Trading calendar (D-4)

The rule-based NYSE calendar moves from `xstockstrat-portfolio/internal/marketsession` to
`packages/proto/marketsession` (the `pnl/` precedent, `packages/proto/CLAUDE.md:7-13`), gaining a
trading-days-inclusive count and a New-York-calendar-date helper with its own name, tested at 17:59 and
18:01 New York time. Its test moves to a portfolio service test; two
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
  lease 10 minutes; sync, acknowledge and per-alert-send deadline 15 s; 20 000 symbols per sync; 100
  claims per sync.

### 10. Rollout

Every additive field means the non-destructive state when absent. At deploy both tables are empty: the
boot load starts nothing; portfolio's first tick fills the union; the next load starts every currently
unservable watchlist symbol, dated that day; `N` trading days later one load flags them together and
portfolio alerts and removes for at most 100 per tick — `PENDING` symbols are not removed, so a burst of
K drains from system-managed lists over ⌈K/100⌉ prune ticks. Portfolio deployed ahead of marketdata gets
`Unimplemented` and takes the WARN path, removing nothing. A runbook note gives the query that counts the coming burst.

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
- [ ] If a flag alert is lost and re-sent, the names of lists removed on the earlier tick are not repeated; the re-sent alert names only what was removed on its own tick.
- [ ] A hook timeout on a load where a symbol was servable misses a reset; the symbol can flag earlier than the 5-day rule (accepted by the operator; WARN and counter).
- [ ] Another marketdata instance's flag is invisible to this instance's backfills until its next load.
- [ ] A quote read re-warms a flagged symbol until the next load (D-11).
- [ ] A recovery between a claim and a successful send yields a recovery alert for an undelivered flag alert, and possibly a flag alert after it (accepted by the operator: FR-12 keys on "claimed").
- [ ] A flagged symbol that becomes servable over a weekend or holiday stays marked and filtered, but is never removed or alerted, until the first trading-day load (operator ruling: recovery on trading days only; FR-2 amended).
- [ ] A sync spanning an asset-set load can remove a symbol that was relisted and re-added to a system-managed list within the same 15 s; the next signal re-adds it.
- [ ] A flagged symbol on a system-managed list shows no marker until portfolio's next tick, and shows the marker while its alert is `PENDING` until a later tick removes it.
- [ ] A hook that times out before the rebuild leaves a newly flagged symbol out of the in-memory flagged set until the next successful hook (up to one refresh interval); it backfills as `FAILED`, not `SKIPPED`, in that window.
- [ ] A job resumed after a restart can show `FAILED` results for symbols of chunks completed before the restart that are not in `failed_symbols` (existing resume behavior, R-9).
- [ ] The union depends on portfolio's tick: observation lags a watchlist add by up to one prune interval, and a portfolio outage freezes the last union.
- [ ] `first_unservable_date` for symbols already dead at deploy is the deploy-era load date.
- [ ] The config seed number and the two portfolio callers of `marketsession` are re-verified at spec time.

## Constitution Rules Touched

- `C-03` — honored by: the tick's outbound calls carry `x-trace-id` and `x-internal-caller`; no user identity exists on a background tick, as for the 281 prune.
- `C-09` — honored by: every proto change runs `buf lint`, `buf breaking` and `./scripts/buf-gen.sh`.
- `C-04` — honored by: outcome and alert state are enums with `_UNSPECIFIED = 0`; the reason reuses `UnservableReason`.
- `C-05` / `F-07` — honored by: the confirmation window is a seeded, live-read, namespace-relative key; the five fixed values are operator-approved invariants.
- `C-07` / `F-01` — honored by: three new numbered migrations, none edited.
- `C-10` / `C-14` — honored by: the state is decorated on every watchlist-returning RPC and reaches the agent tools and the `/insights` row.
- `C-12` / `C-13` — honored by: UI fixtures through `watchlistMock` and `INVENTORY.md`; Go fixtures in `internal/testdata/`.
- `C-15` — honored by: every `@AC-n` maps to a mechanism; AC-29, AC-8 and the Background amended with operator sign-off.
- `C-16` — see Business Rules Touched.
- `C-18` — honored by: one decider, one deleter per resource, no new edge, no portfolio storage.
- `F-06` — honored by: no new pool; the new queries use marketdata's and portfolio's existing pooled connections.
- `P-03` / `P-04` — honored by: every scope fork was put to the operator and recorded in context.md.

## Business Rules Touched (C-16)

- CHANGE `@AC-15 @FR-3 @feature-282` "The first successful load removes unservable symbols warmed while unloaded" (`services/xstockstrat-marketdata/acceptance/filter-otc-symbols.feature`) — a later load removes flagged symbols from the warm set; signed off by the operator 2026-11-16 (spec D-11, context.md).
- CHANGE `@AC-17 @FR-3 @feature-282` "A held offline unservable symbol stays valued and warm across later refreshes" (`docs/sdd/business-rules/platform.feature`) — for flagged symbols only, the symbol leaves the warm set at each load and is re-warmed by the next quote read; it stays valued; signed off by the operator 2026-11-16 (context.md, debate D-11).
- PRESERVE `@AC-16`, `@AC-26` `@feature-282` (marketdata `filter-otc-symbols.feature`) — `markWarm` stays ungated.
- PRESERVE `@AC-19 @feature-282` (`services/xstockstrat-portfolio/acceptance/filter-otc-symbols.feature`) — replace-all still drops a stored unservable symbol.
- PRESERVE `@AC-2`..`@AC-8`, `@AC-12`, `@AC-13` `@feature-281` (`services/xstockstrat-portfolio/acceptance/signal-watchlist-expiry-pruning.feature`) — `pruneListTx` untouched; the new removal never waits, emits neither 281 event and deletes the expiry rows of what it removes. `@AC-4` and `@AC-5` ("never removed by the recurring prune", "manual entries are never pruned") are read as rules of the expiry prune; the delisting removal is a different mechanism in the same tick and, under spec D-2, removes a flagged symbol from a system-managed list whatever the entry's source (reading signed off by the operator 2026-11-17).
- PRESERVE `@AC-30 @feature-334` (`services/xstockstrat-ingest/acceptance/webhook-fanout-callback.feature`) — payload keeps its 8 keys.
- PRESERVE `@AC-6 @feature-261`, `@AC-9 @feature-343`, `@AC-41 @feature-294`, `@AC-1`/`@AC-6` `@feature-291`, `@feature-347` loop bounds, `@feature-242` untargeted push.
- CHANGE `@AC-1 @FR-1 @feature-154` "Portfolio enumerates the distinct cross-user union of watchlist symbols" (`services/xstockstrat-portfolio/acceptance/fundsignal-watchlist-universe.feature`) — the response is no longer exactly the distinct set: flagged symbols are left out (FR-5); signed off by the operator 2026-11-17 (context.md, round-4 gate).
- PRESERVE `@AC-3`, `@AC-4` `@feature-154` (`services/xstockstrat-analysis/acceptance/fundsignal-watchlist-universe.feature`) — written over the enumeration output.
- EXTEND `@AC-2 @feature-180` (`services/xstockstrat-analysis/acceptance/watchlist-readiness-precompute.feature`) — flagged bindings are skipped.
- EXTEND `@AC-14 @feature-294` — outcome value `skipped`.
- EXTEND `@AC-18 @feature-282`, `@AC-1`, `@AC-2`, `@AC-7`, `@AC-8` `@feature-148` (agent) and `@AC-8 @feature-127` (UI) — entries carry the delisted state and marker.
