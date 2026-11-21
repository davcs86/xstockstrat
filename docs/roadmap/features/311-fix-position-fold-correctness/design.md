# Design: fix-position-fold-correctness

**Created**: 2026-11-20
**Rounds**: 11 (full; termination: approved)
**Approved by**: operator's standing authorisation of 2026-11-20, applied by the orchestrator @ 2026-11-20 after round 11 (adversary verdict SOUND, no Floor breach, no blocking objection, every C-16 CHANGE covered). The authorisation is recorded verbatim at `context.md:1522-1524` ("Override round cap until design is sound"). The operator did not approve this round in person.
**Grounded in**: recon.md
**Debate register**: debate.md (D-1..D-50, R-1..R-40, O-1..O-68, P-1..P-8)

---

## Chosen Approach

The design is the round-11 synthesis as written, including its section 3 items adopted from the adversary. Each paragraph names the settled decisions (`D-n`) it rests on. Citations of the form `recon.md:N` point at the dossier line that grounds the claim; code sites found after recon carry the evidence recorded on the `D-n` row in `debate.md`.

### 1. Portfolio: exactly-once fold of `order.filled`

- **Applied-event table, not a cursor (D-1, D-8).** Migration `019` adds `portfolio.consumer_applied_events` with primary key `(consumer, user_id, account_id, order_id)`, where `account_id` is the value after the `alpaca-default` fallback (`recon.md:25`). It replaces the in-memory `lastSeq` replay-from-0 for the fill consumer only (`recon.md:19-20`). The position-sync, deregistration, bracket and balance consumers keep boot replay from 0 (`recon.md:104-107`, `recon.md:153`).
- **One transaction per new fill (D-1, D-23, D-25, D-32).** The fill path is, in order:
  1. Below the floor: return `errFillAcked` with zero DB calls.
  2. Autocommit pre-check `FillApplied` by the applied primary key, with no transaction and no `positionsMu`. A hit re-emits any `pending_closed` and returns `errFillAcked`.
  3. Resolve side from the payload, falling back to `orderSide` (`recon.md:37`, `recon.md:84`). An unattributable fill is parked (below).
  4. `positionsMu.Lock()`, then `BEGIN`, the applied-row `INSERT`, `pg_advisory_xact_lock`, `SELECT … FOR UPDATE`, fold, `COMMIT`, `Unlock`.
  - The repo gains `FillApplied` and `ApplyFill` (one `pgx.Tx` with a pure fold callback). `ApplyFill` begins its transaction through a separate `txBeginner` interface; `queryRower` stays unchanged (`recon.md:39`, `recon.md:138-140`).
  - Only a transaction-scoped advisory lock is used, because PgBouncer transaction pooling forbids session locks (`recon.md:43`, `recon.md:87`).
  - Every value the fold reads comes from the single `FOR UPDATE` row. The separate `GetRealizedAccum` and `GetFeesAccum` pool reads are removed (`recon.md:42`).
- **Signed fold (D-1, D-10).** `fill.Qty` is signed from the side and folded with `pnl.FoldFrom` (`recon.md:72-77`, `recon.md:83`), replacing the unsigned add at `recon.md:23-24`. A flip through zero emits `portfolio.position.closed` for the long, then `portfolio.position.opened` for a fresh short row. The portfolio `CLAUDE.md` v1 scope-limitation paragraph is rewritten.
- **Close-emit outbox (D-2, D-9, D-13, D-21, D-24, D-33).** The dedup guard sits before the `position.*` emit, so a duplicate never re-emits (`recon.md:149`). `pending_closed` is one nullable column on the applied row, cleared only after `emitEventAs` returns nil. `emitEventAs` gains an error return and a key parameter (`recon.md:35-36`); `emitEvent` stays the fail-soft wrapper. A duplicate redelivery re-emits with ledger key `position.closed:<STORED event_id>`. On an applied fill the `position.*` emits, `checkRiskLimits` and `broadcastSnapshot` run after `positionsMu.Unlock()`.
- **Sentinels in `observed()` (D-12, D-31).** `errFillAcked` counts `acked` and returns nil. `ErrFillUnattributable` writes an autocommit parked row (`outcome`, `parked_reason`) with `ON CONFLICT DO NOTHING RETURNING`; ERROR "event parked" and the `parked` count fire only when the insert returns a row. Later boots ack a parked fill at DEBUG. A runbook step deletes the parked row to redeliver. `boundedRetry` semantics are otherwise unchanged (`recon.md:33`, `recon.md:85`).
- **Floor (D-34, D-35, D-45).** `portfolio.consumer_floors(consumer PK, floor_recorded_at)` holds one row for `order_fill`. The migration never writes it. Every boot runs `INSERT ('order_fill', date_trunc('milliseconds', clock_timestamp())) ON CONFLICT DO NOTHING`, then loads and caches the value before the fill consumer starts. A stamp or load error keeps the consumer from starting. There is no write fence, no trigger on `portfolio.positions` and no per-row floor. This answers the cutover hazard at `recon.md:152`.
- **Kept as is (D-5, D-6).** `positionsMu` and `instance_count: 1` stay (`recon.md:32`, `recon.md:46`). Repair of already-inflated accumulators (OQ-2, `recon.md:151`) is out of scope.
- **`GetPnL` (D-28).** The `filledOrderIDs`, `latest` and `partialOrder` maps key on `account_id` + `order_id`. This is an operator-approved scope extension (`context.md:1510-1514`).

### 2. Trading: bracket-leg fills reach the ledger

- **Per-leg state table (D-7, D-14, D-19, D-39).** Migration `012_bracket_legs` is DDL only. It creates `trading.bracket_legs` with primary key `(account_id, leg_order_id)`, `symbol`, `side`, `filled_qty NOT NULL` (the emit cursor), `observed_filled_qty`, `status`, and `adopted BOOLEAN NOT NULL DEFAULT false`. `BracketRepository.ActivateBracket` replaces all three ACTIVE bracket writes (`recon.md:57-60`) and, in one transaction, updates `order_brackets` and inserts the leg rows with `filled_qty = 0`, skipping empty leg ids. On failure `emitBracketFailureAlert` fires.
- **Observer (D-3, D-11, D-22, D-41).** `pollBracketLegFills` is a `pollFills` callee that runs after `logTick`. It adds no hunk to `StartFillPoller` (`recon.md:114`, `recon.md:156`) and never feeds the parent polled/failed counts. It never calls `applyBrokerOrderStatus` or `maybeSubmitBracket` and never writes `s.orders` or `trading.orders` (`recon.md:51-55`). A read-only join to the parent's `trading.orders` row is allowed. Observation is one `Broker.ListOrders` per account per tick, with a per-account capped `GetOrder` fallback for legs missing from the list.
- **Events (D-4 as amended by D-28, D-15, D-16, D-38).** Leg events use `order_id` and stream key = the leg id, with `side` always set (`recon.md:146-148`) and the parent's account, mode and user (`recon.md:88-91`). `order.filled` carries the leg total and the cumulative average price; `order.partially_filled` carries the cumulative `filled_qty`. Payloads carry `fees = brokerOrder.Fees`. Emits are synchronous `appendLedgerEvent` calls with the key `bracket-leg:<account_id>:<legID>:<status>:<filledQty>`; the key is a parameter, where empty means a uuid (`recon.md:63`). The leg row advances only after a nil return. After the first leg-emit failure in a tick, leg emits stop for the rest of that tick.
- **Retirement (D-18, D-26).** IBKR `GetOrder` matches the requested id and never returns `Orders[0]` unmatched. Only an Alpaca 404 wraps `broker.ErrOrderNotFound`; a leg retires `UNKNOWN` after 3 consecutive not-found ticks. An IBKR miss is an ordinary error and never retires a leg.
- **Reconciliation (D-20, D-37).** `KnownBrokerOrderIDs` gains a UNION over `trading.bracket_legs.leg_order_id`. `NetFilledQtyBySymbol` sums the `trading.orders` subquery UNION ALL the account's `bracket_legs` rows using `observed_filled_qty`, which is written on every observation (`recon.md:68`, `recon.md:118`, `recon.md:154`). `side` is written through the helper `UpsertOrder` uses.

### 3. Trading: adoption of pre-existing open legs

- **Candidates and classifier (D-40 as amended by D-48, D-42).** Each tick, candidates are `order_brackets` leg ids on ACTIVE or CANCELING brackets that are non-empty and not already in `bracket_legs`. Each is matched only against the account's `ListOrders` result, with no `GetOrder` call:
  - Listed open at fill 0: inserted tracked with `adopted = true`.
  - Listed open at fill > 0: inserted `BASELINE_RETIRED`, no emit, `observed_filled_qty = FilledQty`.
  - Listed terminal: a tombstone row with status `NOT_OPEN_AT_ADOPTION`, `filled_qty = 0`, `observed_filled_qty = 0`, `adopted = true`, no emit. One INFO log per tombstone.
  - `NOT_OPEN_AT_ADOPTION` is a retired status in every non-retired predicate, through one Go constant for the retired-status set.
  - History is forward-only: legs not open on the adoption tick are an accepted gap (`context.md:1546-1548`).
- **Complete-list gate (D-49).** A candidate absent from a successful list is tombstoned only when the list is non-empty, and for Alpaca also shorter than 500 rows. An empty IBKR 200, an Alpaca list of exactly 500 rows or a failed `ListOrders` inserts nothing; the candidate is re-evaluated on the account's next adoption list.
- **Trigger and throttle (D-46 as amended by D-50).** Each tick runs the candidate query and builds the union of tracked accounts and accounts with candidates.
  - A tracked account (at least one non-retired `bracket_legs` row) gets one `ListOrders` per fill-poller tick. Adoption shares that list.
  - An adoption-only account (candidates, no non-retired tracked leg) is listed only when its cooldown has elapsed. The cooldown is `trading.reconciliation.interval_ms` (default 60000, read live), or `haltedPollInterval()` when the account is halted. No config key is added.
  - The body of `shouldPollHaltedAccount` becomes one shared helper. `shouldPollHaltedAccount` keeps its signature and behaviour over `haltedLastPolled`. Adoption uses a separate in-memory `adoptionLastListed` map under `haltedMu`.
  - The stamp is taken when the call is allowed, so a failed list is throttled too. The map is empty at boot, so the first tick lists every adoption-only account.
  - The change sits inside `pollBracketLegFills`, with no `StartFillPoller` or `reconcileTick` hunk.
- **Adopted from adversary round 11, binding on the spec by the operator's approval ruling (O-67, O-68):**
  - **New-candidate bypass.** The candidate id set seen at the account's last allowed list is kept next to the stamp. An adoption-only account whose current set contains an id not in that set is listed on this tick, and the stamp and set are refreshed.
  - **`reconciliation.interval_ms <= 0`** is read as the 60000 default for adoption. "Always list" comes only from `halted_poll_interval_ms <= 0` on a halted account.
  - **Injected clock.** The shared helper takes `now time.Time`: `time.Now()` from `shouldPollHaltedAccount`, `s.clock()` from `pollBracketLegFills`.
  - **Known-invalid credentials.** Adoption-only accounts with `credentialsKnownInvalid` status are skipped before the list. A `broker.ErrInvalidCredentials` result is a WARN and a skip with no failure count, as in `reconcileTick`.

Steady-state `ListOrders` rate per account from `pollBracketLegFills`, at the defaults (tick 5 s, interval 60 s, halted poll 300 s):

| Account state | Calls per minute |
|---|---|
| Tracked legs | 12 (unchanged) |
| Adoption-only, not halted | 1, plus one on a tick where a new candidate id appears |
| Adoption-only, halted | 0.2 |
| Adoption-only, credentials known invalid | 0 |
| No candidates and no non-retired tracked legs | 0 |

### 4. Cutover and rollback

- **Staging (D-36, D-43).** The cutover is one numbered stop-then-start runbook step, run at the first deploy of a post-`019` portfolio image to DO `xstockstrat-staging` and to the homelab staging VM. It records one result per database: target, `T_stop`, the floor value, the boot log line, the `order.filled` count in `[T_stop, floor)`, the green deploy run, the `main-dev` SHA at `T_stop`, and an empty list of Deploy runs in between. "Portfolio stopped, `T_stop` recorded, `main-dev` frozen" is an unenforced checklist item in the integration PR body and `merge-order.md`.
- **Rollback (D-44).** If a pre-`019` portfolio image ran after the floor was stamped: stop portfolio, `DELETE FROM portfolio.consumer_floors WHERE consumer = 'order_fill'`, and repeat the cutover step.
- **Production (D-47).** Check-only. Before the first production promotion, record the counts of `portfolio.positions` rows and ledger `order.filled` rows on each production database, and stop for the operator if either is non-zero.

### 5. Tests and build order

- **AC-2 proof (D-27, D-33).** Real-Postgres `dbtest` cases in the existing `portfolio-db-test` CI job, with no CI change (`recon.md:96`, `recon.md:155`): repo-level `apply_fill_dbtest_test.go`; two `PortfolioService` instances folding one event to qty 15; the INSERT-conflict case in default and `DB_PGBOUNCER` exec mode; sync-versus-fill with no `40P01`.
- **Trading tests.** The round-10 tests 1-10 plus the round-11 tests 11-20, each asserting the `ListOrders` call count over N ticks. They are listed in `context.md` under the round-10 and round-11 sessions.
- **Spec Files list.** `fakeBroker` `listOrdersFn` and call counter; `fakeBracketRepo` candidate query, tombstone insert and retired-status filter; settable `reconciliation.interval_ms` and `reconciliation.halted_poll_interval_ms` in the test config fake, wired through `GetFloat`; every existing ACTIVE-bracket test (`recon.md:95`); `portfolio_fill_sync_race_test.go` re-pointed (`recon.md:94`).
- **Build order.**
  1. Migrations `019` and `012`, after re-checking both numbers against `main-dev` and feature 318 (`recon.md:126-128`).
  2. Floor stamp and load; `observed()` branches; `FillApplied`, `ApplyFill`, `txBeginner`.
  3. Fold rewrite with in-transaction reads and the flip; persisted park.
  4. dbtests.
  5. Broker `ErrOrderNotFound` and the IBKR id match.
  6. `ActivateBracket`, both UNIONs, keyed append, observer, adoption, `GetPnL` composite key.
  7. Runbook (per-target cutover step, rollback rule, production check, parked-row and tombstone redelivery) and the portfolio and trading `CLAUDE.md` updates.

### 6. Consumer surfaces (C-14)

The fix reaches users through the surfaces that already read the folded rows: the `xstockstrat-ui` `/trader` positions and P&L views and the `xstockstrat-agent` `get_positions` tool (`recon.md:6`). No UI or agent code change is designed. No proto, RPC, config key, env var or inter-service edge is added (`recon.md:124-134`). `/sdd-spec` re-reads the ui and agent acceptance suites, which recon only name-scanned (`recon.md:120`, `recon.md:158`).

## Rejected Alternatives

- `R-1` Per-consumer sequence cursor for the fill consumer — rejected because ledger sequences can gap and late commits below the walk are not replayed.
- `R-2` Floor stamped by the migration — rejected because the migration runs while the old binary still folds, so the window up to the first boot would be re-folded.
- `R-3` Fail-soft delivery for bracket-leg fill events — rejected because a ledger outage on that tick loses the fill for good once the leg is retired.
- `R-4` Bracket-level terminal status to stop leg observation — rejected because it drops sibling-leg fills and fills on CANCELED or flattened brackets.
- `R-5` A second keyed variant of `appendLedgerEvent` — rejected because it duplicates the function (C-18); the key becomes a parameter.
- `R-6` Early return from `resizeBracket` when leg tracking fails — rejected because it skips `ReArmProtection` and the resubmit, leaving the added fill qty unprotected.
- `R-7` Emitting the full cumulative `order.filled` for a leg baselined at cutover with `filled_qty > 0` — rejected because it over-reduces a position sync already set to broker truth and false-halts reconciliation.
- `R-8` Re-emitting `pending_closed` with a key derived from the incoming `event_id` — rejected because a producer duplicate carries a fresh uuid, so `position.closed` would be emitted twice.
- `R-9` Running risk checks, snapshots or `position.*` emits on a duplicate or below-floor redelivery — rejected because every boot would re-run them for each post-floor fill.
- `R-10` Retiring a leg on any `GetOrder` error or on absence from `ListOrders` — rejected because no broker sentinel separates not-found from a transient error, and Alpaca lists only the newest 500.
- `R-11` Using IBKR `GetOrder`'s first returned order without matching the id — rejected because a keyed emit could permanently write another order's fill to the ledger.
- `R-12` Baseline-offset emission for legs partially filled at cutover — rejected because an `order.filled` whose qty is not the order total breaks 251 `@AC-17`.
- `R-13` Writing `filled_qty` NULL on legs inserted at activation — rejected because a leg that fills before the first tick would be retired with no emit.
- `R-14` An autocommit applied-row INSERT outside the fold transaction — rejected because a crash between the two commits marks a fill applied without folding it.
- `R-15` A new untagged real-Postgres test with its own CI install step — rejected because it duplicates the `portfolio-db-test` job and would fatal in the coverage job.
- `R-16` A wall-clock retirement threshold in place of the 3-tick not-found count — rejected because once only a definitive not-found counts, the timestamp column is unneeded.
- `R-17` Leg `order_id = <account_id>:<legID>` — rejected because leg ids would no longer match `order_brackets` ids, and it changes more of D-4 than the key amendment.
- `R-18` Opening the fill transaction before taking `positionsMu` — rejected because a fill would wait idle in transaction on 1 of portfolio's 2 client connections.
- `R-19` Taking `positionsMu` and a transaction for every fill with no pre-check — rejected because boot replay would take the mutex and a 4-round-trip transaction per fill.
- `R-20` `TryLock` on `positionsMu` inside the transaction with rollback and retry — rejected because the busy-retry churns the applied INSERT and inflates the counters.
- `R-21` An advisory lock in its own short transaction ahead of the fold — rejected because it splits the D-1 transaction.
- `R-22` Adding `Begin` to the `queryRower` interface — rejected because about 10 test sites break; a separate `txBeginner` is the smaller diff.
- `R-23` Arming the cutover fence inside the PRE_DEPLOY migration — rejected because a failed or rolled-back deploy would leave the old binary unable to write positions.
- `R-24` An equality match on `application_name` as the fence test — rejected because PgBouncer appends a host suffix.
- `R-25` A single boot-time floor timestamp for all rows — this entry is **reopened** (round 7, operator ruling at `context.md:1535-1541`) and is now the chosen floor (D-35). It is listed to keep the ID.
- `R-26` A two-release cutover — rejected because it adds a deploy-ordering dependency and doubles the deploy.
- `R-27` Using `filled_qty`, the emit cursor, in the `NetFilledQtyBySymbol` UNION — rejected because a ledger outage would make reconciliation lag broker truth and could halt the account.
- `R-28` Seeding an applied row for every historical `order.filled` in place of a floor — rejected because a crash mid-seed can mark fills applied that were never folded.
- `R-29` The `@AC-5` "qty 6" variant with a CHANGE to 251 `@AC-17` — rejected because the operator signed off the amended wording and dropped this variant.
- `R-30` Bracket-leg rows in `trading.orders` — rejected because the operator chose the `bracket_legs` UNION and declined to reopen D-3.
- `R-31` A `012` migration seed with its own `GetOrder` budget — rejected because it inserts every historically exited bracket and forgotten IBKR legs would be polled forever.
- `R-32` Lowering the fill floor to `T_stop` — rejected because window fills a sync already applied would fold a second time.
- `R-33` Taking an adopted leg's symbol and side from in-memory `s.orders` — rejected because parents of open legs are FILLED and not hydrated, so most adoptees would be skipped.
- `R-34` A stop-then-start or HALTED-during-stop procedure on production — rejected because the operator ruled production out of scope.
- `R-35` Reusing the `UNKNOWN` status for the adoption tombstone — rejected because one status for two retirement reasons would muddle triage.
- `R-36` A listed-terminal tombstone that records the listed `FilledQty` — rejected because it contradicts the operator ruling's `observed_filled_qty = 0`.
- `R-37` Tombstoning a candidate on absence from any successful `ListOrders` — rejected because an empty IBKR 200 or a full 500-row Alpaca list would permanently tombstone open legs.
- `R-38` Sharing `reconcileTick`'s own `ListOrders` result with adoption — rejected because it couples adoption to the 206 `@AC-1..3` path and makes adoption latency 60 s for every account.
- `R-39` A new config key for the adoption `ListOrders` cadence — rejected because the operator steer directs reuse of `reconciliation.interval_ms` and the halted throttle.
- `R-40` Throttling adoption through the existing `haltedLastPolled` map — rejected because an adoption list would consume reconcile's halted re-observation slot.

Weighed in round 11 and not locked in the register: a fixed post-boot full-rate window as a code constant; tombstone only on a listed terminal status; tombstone on absence across N consecutive lists; a partial index in `012` for the candidate query (`/sdd-spec` states the scan cost first).

## Open Risks

Each item is mirrored in `context.md` under the 2026-11-20 sdd-design session's Open Threads.

**Orchestrator assumption, not an operator ruling**

- [ ] The adoption-only throttle (D-50) was chosen by the orchestrator, not ruled by the operator. It meets the operator's stated reason for the D-40 reopen (remove the permanent per-tick broker load) where a tombstone is unsafe. The operator was told and has neither objected nor confirmed, and can overturn it — to be confirmed by the operator before `/sdd-execute`.

**Register and artifact housekeeping**

- [ ] `acceptance.feature` `@AC-5` still reads "qty 6"; the signed-off wording (D-38, `context.md:1530-1534`) is not yet applied — to be applied at `/sdd-spec`, keeping the `@AC` ID (C-15).
- [ ] O-67 and O-68 stay "open" in `debate.md` because the proposer never confirmed them; the operator's approval ruling makes all four items binding — `/sdd-spec` treats them as settled.
- [ ] O-56 stays "open" in `debate.md` although the petition verdicts it asks for were recorded at approval; P-4 is recorded "user declined", not "withdrawn", because the register has no such verdict — no further action.
- [ ] O-30: the analysis AC ids in `order-snapshots-pnl-patterns.feature` and `fix-python-loop-supervision.feature` are not enumerated, and the D-10 flip-short window residual stays named — at `/sdd-spec`.
- [ ] `context.md` is far over the 65536-byte `/sdd-execute` limit — `/sdd-distill` must run before `/sdd-execute`.
- [ ] Migration numbers `019` (portfolio) and `012` (trading) may collide with `main-dev` or feature 318 — re-check at `/sdd-spec`.

**Operator confirmations before the integration step (O-61)**

- [ ] The DO stop is unverified: `.do/app.dev.yaml:78` and `:319` reference `${xstockstrat-portfolio.PRIVATE_DOMAIN}`, so a spec with the portfolio service removed may be rejected — operator confirmation before the cutover step.
- [ ] On the homelab VM an unattended rollback of the integration deploy restores the pre-`019` portfolio after the floor is stamped; noticing it depends on `gate deploy` exiting non-zero, which is unconfirmed — operator confirmation before the cutover step.
- [ ] Adoption depends on Alpaca listing bracket legs as top-level orders in every open state; this is unverified — operator confirmation before the cutover step.
- [ ] While portfolio is stopped on staging, trading's portfolio calls fail: the risk check warns only, reconciliation skips, and `flattenAndHalt` cannot flatten — operator confirmation before the cutover step.
- [ ] If a production count is non-zero, the promotion stops with no designed procedure — waits on an operator ruling at the first production promotion.
- [ ] The merge precondition and the `main-dev` freeze are not enforced; an overlap double-applies fills and only the recorded evidence shows it — cutover runbook step.

**Accepted residuals: cutover**

- [ ] Fills appended between `T_stop` and the first new boot are acked: qty heals at the next sync, realized P&L for them is lost — recorded in the cutover result.
- [ ] Late-commit appends whose `recorded_at` is below the floor are acked (operator-accepted) — accepted.
- [ ] The floor assumes ledger and portfolio share one Postgres server clock — accepted; named in the runbook.

**Accepted residuals: portfolio fold**

- [ ] A parked fill is retried only after a manual delete of its parked row — runbook step.
- [ ] A fill transaction can wait server-side on the applied-row conflict or `FOR UPDATE`, holding 1 of 2 client connections and `positionsMu` — accepted.
- [ ] The pre-check has a TOCTOU window covered only by the in-transaction INSERT conflict path — covered by the INSERT-conflict dbtest.
- [ ] A `position.updated` can be emitted after a same-process sync has overwritten the row — accepted.
- [ ] Boot replay re-walks every post-floor fill, and `consumer_applied_events` has no retention — follow-up (rolling floor), not in this feature.
- [ ] With the composite `GetPnL` key, a historical order whose partial and full fills carried different `account_id` values stops being deduplicated — the `/sdd-spec` payload-history grep is the only check.
- [ ] OQ-2 (repair of already-inflated accumulators) is out of scope, and `instance_count` must stay 1 — separate operator-approved data-repair change.

**Accepted residuals: bracket legs and adoption**

- [ ] An idle IBKR account with an empty list, or an Alpaca account pinned at 500 rows, never tombstones its candidates; it keeps one adoption `ListOrders` per reconciliation interval (1/min by default) indefinitely — accepted.
- [ ] Without the new-candidate bypass, a bracket activated by an old trading instance on an adoption-only account can fill within the 60 s cooldown, be tombstoned with no emit, and false-halt the account through `NetFilledQtyBySymbol`. The bypass is binding, so this applies only if the spec drops it — test 19 at `/sdd-spec`.
- [ ] The cooldown and candidate-set memory are in process; every restart lists each adoption-only account once — accepted.
- [ ] The candidate anti-join still runs every tick; only the broker call is throttled (`005_broker_accounts_halted.up.sql:29-31`) — `/sdd-spec` states the scan cost.
- [ ] `reconciliation.interval_ms <= 0` means "keep the previous interval" in the code, but `services/xstockstrat-trading/CLAUDE.md:119` implies "every tick"; the drift is only logged in the trading findings, not fixed — at `/sdd-spec`.
- [ ] A genuinely open leg absent from a complete list on its evaluation tick is tombstoned permanently; its exit fill never reaches the ledger, the fold or reconciliation — accepted.
- [ ] A tombstone is undone only by a manual delete of its `bracket_legs` row — runbook step.
- [ ] Existing trading tests that hold an ACTIVE bracket with leg ids panic on `fakeBroker.ListOrders` until the fakes are extended — first trading test step.
- [ ] Reconciliation covers only tracked legs; the D-42 forward-only gap stays uncounted — accepted (operator ruling, `context.md:1546-1548`).
- [ ] A `BASELINE_RETIRED` leg's post-cutover remainder is neither emitted nor observed — accepted.
- [ ] Adopted IBKR legs that later vanish from the gateway are polled indefinitely (D-26) — accepted.
- [ ] A leg id is lost from tracking if the `ActivateBracket` transaction fails; it is alerted, but its exit fill never folds — accepted.
- [ ] Neither broker adapter populates `BrokerOrder.Fees`, so fee totals understate — accepted; logged in the trading findings.

## Constitution Rules Touched

- `C-01` — honored by: every architectural claim cites `recon.md` or the evidence on a `D-n` row; `/sdd-spec` re-greps each site.
- `C-05` — honored by: no config key is added; the throttle reuses `trading.reconciliation.interval_ms` and the halted poll interval (R-39).
- `C-08` — honored by: each service change has named tests (portfolio pgxmock and dbtest cases; trading tests 1-20).
- `C-10` — honored by: `ActivateBracket` replaces all three ACTIVE write sites; both reconciliation queries gain the `bracket_legs` UNION; one retired-status constant is bound into every predicate.
- `C-11` — honored by: the feature went through triage, review and an 11-round full debate; every operator ruling is recorded verbatim in `context.md`.
- `C-13` — honored by: test fakes are extended in the services' existing test homes; `/sdd-spec` names the fixture files.
- `C-15` — honored by: the `@AC-5` amendment keeps its ID and is applied append-only, with the reason logged.
- `C-16` — honored by: the Business Rules section below; the one CHANGE carries the operator's sign-off.
- `C-18` — honored by: reuse of `pnl.FoldFrom`, `orderSide`, `signedQty` and the `shouldPollHaltedAccount` body; one key parameter in place of a second append function (R-5); no generic floor API.
- `F-01` — honored: only new migrations `019` and `012` are added; no applied migration is edited.
- `F-02` — honored: all changes land through PRs into `feature/fix-position-fold-correctness`, then `main-dev`.
- `F-04` — honored: no path or symbol is invented; unverified items are listed under Open Risks.
- `F-06` — honored: no pool size changes; the fill path uses the existing portfolio client pool, and no session-level lock is taken.
- `F-07` — honored: the cooldown comes from live config reads; the 60000 default is the key's existing default, not a new constant.
- `F-08` — honored: the test files that change are named for the spec's Files lists (O-39, O-64).
- `P-02` — honored: proposer and adversary saw only the orchestrator's synthesized state in every round.
- `P-03` — honored: ambiguities went to the operator (D-4, D-17, `@AC-5`, cutover, production, D-40); the one orchestrator assumption is flagged above.
- `P-04` — honored: approval is recorded in the `feature.md` history row and the `context.md` session entry, with its provenance.
- `PLAT-N1` — honored with a recorded exception: leg fill emits are synchronous and keyed, not best-effort (R-3), but they run in the poller, not on an RPC path, and a failure never fails an RPC. Portfolio `emitEvent` stays fail-soft.

## Business Rules Touched (C-16)

- PRESERVE `@AC-1` "A portfolio restart does not re-apply already-folded fills" (this feature's `acceptance.feature`) — not regressed by: the applied-event table and the boot floor.
- PRESERVE `@AC-2` "Two concurrently running portfolio processes apply one fill once" — not regressed by: the applied INSERT inside the fold transaction, proven by the real-Postgres dbtest.
- PRESERVE `@AC-3` "A sell fill closes the position and seals realized P&L" — not regressed by: the signed fold through `pnl.FoldFrom`.
- PRESERVE `@AC-4` "A bracket take-profit leg fill reaches the ledger and realized P&L" — not regressed by: the leg observer and keyed emit.
- CHANGE `@AC-5` "A bracket leg that fills in two parts reaches the ledger as a partial then a full fill" — altered guarantee: the Then reads "an order.partially_filled event with qty 4 and an order.filled event with qty 10 at average fill price 110 for that leg". Signed off by the operator @ 2026-11-20 ("Sign off (Recommended)", `context.md:1530-1534`).
- EXTEND `@AC-17 @feature-251` (`services/xstockstrat-portfolio/acceptance/fix-getpnl-source-service.feature`) — new case added: the `GetPnL` dedup maps key on `account_id` + `order_id`, with a two-account same-leg-id test. Operator ruling @ 2026-11-20 ("Approve both (Recommended)", `context.md:1510-1514`).
- PRESERVE `@AC-14 @feature-251` (same file) — not regressed by: the mixed `account_id` group refusal is untouched.
- EXTEND `@AC-1 @feature-206` (`services/xstockstrat-trading/acceptance/fix-reconciliation-false-halt.feature`) — new case added: bracket-leg fills count in `NetFilledQtyBySymbol` through `trading.bracket_legs`. Operator ruling @ 2026-11-20 ("Via bracket_legs (Recommended)", `context.md:1542-1545`).
- PRESERVE `@AC-2 @feature-206` and `@AC-3 @feature-206` (same file) — not regressed by: no `reconcileTick` hunk; a tombstone adds 0 to the sum.
- EXTEND `@AC-56 @feature-294` (`docs/sdd/business-rules/platform.feature`) — new case added: a parked fill is counted `parked` once and acked at DEBUG on later boots. Operator ruling @ 2026-11-20 ("None — fix in scope", `context.md:1515-1518`, restated at `context.md:1549-1550`).
- PRESERVE `@AC-6 @feature-294` (`services/xstockstrat-trading/acceptance/signal-map-instrumentation.feature`) — not regressed by: no diff hunk inside `StartFillPoller`; the leg poll runs after `logTick` and never feeds the parent counts.
- PRESERVE `@AC-3 @feature-290` (`services/xstockstrat-portfolio/acceptance/fix-ctx-cancel-warn-flood.feature`) — not regressed by: persistence is scoped to the `order_fill` consumer; the other consumers keep boot replay from 0.
- EXTEND `@AC-10 @feature-251` (`services/xstockstrat-trading/acceptance/fix-getpnl-source-service.feature`) — new case added: bracket-leg fill events carry the same side, source service and fee shape. Flagged EXTEND by recon (`recon.md:111`); it is covered by this feature's own `@AC-4` and `@AC-5` and needed no separate ruling.
- All other rules recon lists as PRESERVE (`recon.md:100-119`) are not touched by this design.
