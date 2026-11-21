# Context Log: fix-position-fold-correctness

> Distilled 2026-11-21 by /sdd-distill. Full pre-distill session prose is in git history (before this commit).
> Line citations of the form `context.md:N` in `design.md`, `debate.md` and `implementation-spec.md` point at the pre-distill file (the parent of the distill commit). The passages they cite (operator rulings, the round-cap override, the production-scope ruling, the D-40 reopen) are reproduced verbatim in the four "recorded by the orchestrator (verbatim)" sessions below.

Each session appends a new ## Session entry. The three sections below are the live-state view; the Superseded Sessions section holds compressed history.

---

## Decisions

- **Operator rulings (verbatim in the four "recorded by the orchestrator (verbatim)" sessions below; operator consent under C-11/C-16, later rounds treat them as fixed).**
  - REOPEN D-4 granted: leg ledger key is account-scoped, `bracket-leg:<account_id>:<legID>:<status>:<filledQty>`; `GetPnL`'s three dedup maps key on `account_id` + `order_id` (D-28, scope extension approved; two-account same-leg-id test required). Why: `ledger.idempotency_keys.idempotency_key` is a bare global PK and IBKR leg ids may repeat across accounts, so an unscoped key silently drops a second account's exit fill.
  - AC-2 two-writer proof runs as a real-Postgres test in CI (no downgrade). REOPEN D-17 granted narrowly ("Do your best to prevent the race condition and fix the bug report"): the fill path takes `positionsMu` before `BEGIN`; only a cross-process duplicate (INSERT conflict) may take the mutex (D-23).
  - `@AC-5` C-16 sign-off GIVEN: the leg's full-fill event carries qty 10 at cumulative average price 110 after an `order.partially_filled` qty 4 (D-38); `acceptance.feature` carries it, `@AC` ID kept (C-15).
  - Cutover: stop-then-start on staging as one numbered runbook step (REVERSES "None — fix in scope" for the overlap residual only): no `portfolio.positions` trigger, no `fill_fence`/`fill_cutover`, no application_name fence (D-29/D-30 withdrawn; R-25 reopened and now the chosen floor, D-34/D-35). Why: writer identification through PgBouncer was unproven and two pre-cutover cases stayed undecidable. Production has never launched ("And leave production out. It's never been out/launched"): production is check-only (D-47).
  - Bracket-leg fills reach reconciliation via `trading.bracket_legs` (D-37), D-3 stands (no leg rows in `trading.orders`); historical legs forward-only (D-42, accepted gap); a parked fill must not re-park with an ERROR on every boot (D-31, in scope).
  - REOPEN D-40 granted: tombstone a candidate a successful `ListOrders` shows not open (closed-out `bracket_legs` row, no emit, `observed_filled_qty = 0`, D-48) to stop a permanent per-tick broker load. "Override round cap until design is sound": debates run past 5 rounds until the adversary rates the design sound, then a sound design with every C-16 change covered is approved on the operator's behalf.
- **Approval provenance.** Design approved after round 11 under that standing authorisation (adversary SOUND, no Floor breach, no blocking objection, every C-16 CHANGE covered); the operator did not approve in person. Petition verdicts recorded at approval: P-1, P-2, P-5, P-6, P-7, P-8 "user reopened"; P-4 "user declined" (R-2 not reopened; the register has no "withdrawn" verdict). Only P-4 was marked declined because marking every pending petition "declined" would contradict the recorded grants for D-4, D-29, D-30, R-25 and D-40.
- **Chosen design** (full text `design.md`; register `debate.md` D-1..D-50, R-1..R-40, O-1..O-68, P-1..P-8; binding = the round-11 synthesis in the `sdd-batch-design-state` fence below): portfolio applied-event table `consumer_applied_events` + boot-stamped `consumer_floors` and one signed `pnl.FoldFrom` tx per fill (not a sequence cursor: ledger sequences have gaps and cannot replay late commits; PgBouncer forbids session locks, so only `pg_advisory_xact_lock`); trading `trading.bracket_legs` (not columns on `order_brackets`, D-7) with synchronous keyed leg emits that never touch `trading.orders` (D-3), Alpaca-404-only not-found (an IBKR miss never retires a leg, R-10), and adoption of pre-existing open legs behind a complete-list gate (D-49) and an adoption-only throttle (D-50, orchestrator assumption). Rejected: baseline-offset for baselined partially filled legs (R-12; they retire `BASELINE_RETIRED` without emit), production stop-then-start (R-34), the round-6 write-fence trigger (reversed by the operator).
- **Spec choices (A-1..A-13 in `implementation-spec.md`, not operator rulings)** are recorded in the verbatim `sdd-spec` and `sdd-review impl-spec` sessions below.

## Open Threads

- [ ] **ORCHESTRATOR ASSUMPTION, not an operator ruling.** The adoption-only throttle (D-50: adoption `ListOrders` at the reconciler cadence for accounts with candidates but no live tracked legs, no new config key) was chosen by the orchestrator to meet the operator's stated reason for the D-40 reopen where a tombstone is unsafe. The operator was told and has neither objected nor confirmed and can overturn it. Spec Steps 23-25 implement it. Target: operator confirmation before `/sdd-execute` (gates Steps 23-25).
- [x] `context.md` over the 65536-byte `/sdd-execute` limit: resolved by this distill (2026-11-21).
- [ ] Re-check migration numbers portfolio `019` / trading `012` after BRANCH SYNC (free on `main-dev@fb52065c`; feature 318 adds no migration; unmerged branches not inspected).
- [ ] The unchecked impl-spec review items (Step 20 pgxmock-only proof, Step 21 IBKR lower-casing, A-10 analysis-consumer window, overlap with 312/315/317/321/326) are kept verbatim in the `sdd-review impl-spec` session below; `/sdd-execute` announces each until ticked.
- [ ] Housekeeping: O-67/O-68 stay "open" in `debate.md` (their four items are binding and settled in Steps 23-25); O-56 stays "open" though its verdicts are recorded; O-30: analysis AC ids in `order-snapshots-pnl-patterns.feature` and `fix-python-loop-supervision.feature` not enumerated, D-10 flip-short window residual stays named (analysis 042 `@AC-1`, `@AC-2`, `@AC-7`; 259 `@AC-6`, `@AC-7`, `@AC-9`).
- [ ] **Operator confirmations before the integration/cutover step (O-61).**
  - DO accepts a spec with the portfolio service removed: `.do/app.dev.yaml:78` and `:319` reference `${xstockstrat-portfolio.PRIVATE_DOMAIN}`; `doctl apps spec get` must also round-trip the encrypted secret values. If either fails there is no verified DO stop and scoping DO staging as disposable needs its own ruling.
  - Homelab `gate deploy` recreates portfolio stop-then-start (or the operator can stop it on the VM); an unattended rollback of the integration deploy restores the pre-019 portfolio after the floor is stamped, and noticing it depends on `gate deploy` exiting non-zero (unconfirmed).
  - Adoption depends on Alpaca listing bracket legs as top-level orders in every open state (unverified).
  - While portfolio is stopped on staging, trading's portfolio calls fail (risk check warns only, reconciliation skips, `flattenAndHalt` cannot flatten); acceptable on paper staging?
  - If a production count (`portfolio.positions` rows, ledger `order.filled` rows) is non-zero the promotion stops with no designed procedure (adversary candidate: set `platform.trading_state=HALTED` before the stop, restore after the boot log line, record both config changes); waits on an operator ruling.
  - The merge precondition and the `main-dev` freeze are not enforced; an overlap double-applies fills and only the recorded evidence shows it.
- **Accepted residuals (full list mirrored in `design.md` § Open Risks).**
  - Cutover (record in the cutover result/runbook): fills appended between `T_stop` and the first new boot are acked (qty heals at next sync, their realized P&L lost); late-commit appends with `recorded_at` below the floor are acked (operator-accepted); the floor assumes ledger and portfolio share one Postgres server clock (DO staging: same cluster, `.do/app.dev.yaml:439,701-707`; homelab DSNs unchecked).
  - Portfolio fold: a parked fill is retried only after a manual delete of its parked row (runbook); a fill tx can wait on the applied-row conflict or `FOR UPDATE`, holding 1 of 2 client connections and `positionsMu`; the pre-check TOCTOU window is covered only by the INSERT-conflict dbtest; a `position.updated` can follow a same-process sync overwrite; boot replay re-walks every post-floor fill and `consumer_applied_events` has no retention (follow-up: rolling floor); with the composite `GetPnL` key a historical order whose partial and full fills carried different `account_id` values stops being deduplicated (`/sdd-spec` payload-history grep); OQ-2 (repair of inflated accumulators) out of scope and `instance_count` must stay 1 (separate data-repair change).
  - Bracket legs and adoption: an idle IBKR account with an empty list, or an Alpaca account pinned at 500 rows, never tombstones its candidates (one adoption `ListOrders` per `interval_ms`, 1/min, indefinitely); without the binding new-candidate bypass a bracket activated by an old trading instance could fill inside the 60 s cooldown, be tombstoned with no emit and false-halt the account via `NetFilledQtyBySymbol` (206 trading `@AC-1`; test 19); cooldown and candidate-set memory are in process (each restart lists every adoption-only account once); the candidate anti-join still runs every tick (`005_broker_accounts_halted.up.sql:29-31`, `/sdd-spec` states the scan cost); `interval_ms <= 0` means "keep previous interval" in code while trading `CLAUDE.md` (now `:95`) implies "every tick" (logged in trading findings, not fixed); a genuinely open leg absent from a complete list is tombstoned permanently and a tombstone is undone only by deleting its `bracket_legs` row (runbook); existing trading tests with an ACTIVE bracket and leg ids panic on `fakeBroker.ListOrders` until the fakes are extended; reconciliation covers only tracked legs (D-42 gap uncounted); a `BASELINE_RETIRED` leg's post-cutover remainder is neither emitted nor observed; adopted IBKR legs that vanish are polled indefinitely (D-26); a leg id is lost if the `ActivateBracket` tx fails (alerted, exit fill never folds); neither broker adapter populates `BrokerOrder.Fees`, so fee totals understate (trading findings).

## Files Modified

- Planning artifacts only; no service code written yet (status `implementation-ready`).
- `docs/roadmap/features/311-fix-position-fold-correctness/`: `feature.md`, `status.md`, `product-spec.md`, `acceptance.feature` (4 regression scenarios; `@AC-5` reworded per D-38), `recon.md`, `debate.md`, `design.md`, `implementation-spec.md` (27 steps), `context.md` (this file).
- `docs/reports/` sidecars for the three clustered defect reports stamped `triaged` (2026-11-10).
- Planned code surfaces (from the spec; not yet touched): portfolio migration `019_fill_applied_events`, `portfolio_service.go`, `portfolio_repo.go`; trading migration `012_bracket_legs`, `trading.go`, broker adapters, `trading_repo.go`, bracket repository; runbook and docs (Steps 26-27).

## Superseded Sessions

- 2026-11-10 — /sdd-triage: clustered three SEV-2 defect reports (`docs/reports/2026-10-06-portfolio-fill-fold-not-exactly-once-defect.md`, `2026-10-21-portfolio-live-fold-sell-sign-loss-defect.md`, `2026-10-21-trading-bracket-leg-fills-missing-from-realized-pnl-defect.md`; Issues disabled): all three corrupt the portfolio live fold of `order.filled` (which fills arrive, how often, what sign), and separate fixes would re-touch `processOrderFill` three times. Track C by operator decision (report 1 is prod-impacting).
  Root-cause hypotheses: in-memory-cursor fold with no idempotency key or DB locking; fold ignores side (trading emits `side` since 251); no poller for bracket-leg fills. Depth full (DB migration, 2 services, data-repair question).
- 2026-11-10 — sdd-review product-spec: approved (draft → spec-ready); first review FAILed crit 7 + trading C-5 (fixed: migration strategy, AC-5 partial leg fill); five open questions deferred to design incl. repair of inflated `realized_accum` (OQ-2); overlap WARN with 312/315/321/326 and portfolio migrations vs 318.
- 2026-11-11 to 2026-11-13 — design gate rounds 2-3: applied-event table (no sequence column), `errFillAcked`/`ErrFillUnattributable` in `observed()`, `bracket_legs` table, retire-without-emit for baselined partially filled legs, duplicate-returns-before-every-side-effect (R-9), `ErrOrderNotFound` with 3-tick UNKNOWN retirement. P-1 (D-4 leg key collides across accounts through the global ledger PK) and P-2 (`GetPnL` maps key on bare order id) needed an operator ruling.
- 2026-11-20 — design gate rounds 4-5: pinned tx and lock order (`positionsMu` before any advisory/row lock; a duplicate takes no lock); AC-2 proof on the existing `portfolio-db-test` harness; R-10 (`GetOrder`/`ListOrders` share one IBKR endpoint, so a miss never retires a leg); D-17 reopened on the operator's relayed words and replaced by D-23 (D-24..D-27). Blocking throughout: D-4 reopen and @AC-5 sign-off existed only in the workflow's computed steer.
- 2026-11-20 — design gate rounds 6-7: D-28 (account-scoped key + composite GetPnL key); round 6 designed a write-fence trigger on `portfolio.positions` (D-29/D-30; blocked by O-43 unrecorded rulings, O-44 writer identification unproven under PgBouncer, O-45..O-47); the operator rulings below removed it. Round 7: `consumer_floors` boot-stamped floor (D-34/D-35), stop-then-start runbook (D-36), legs via `bracket_legs` (D-37), @AC-5 wording (D-38). Blocking: seed predicate named a non-existent "exited" bracket state (O-46: status is SMALLINT 0-6 and nothing moves a bracket off ACTIVE), cutover not executable as written because a `main-dev` push auto-deploys DO staging and the homelab VM (O-52), production fold history (O-55).
- 2026-11-20 — design gate rounds 8-9: leg adoption replaces the seed (`012` DDL-only, `adopted` flag, D-39..D-42), per-target cutover with one recorded result per database (D-43), rollback = delete the `order_fill` floor row and repeat cutover (D-44), floor stamped only at boot (D-45), one `ListOrders` per tracked-or-candidate account with no `GetOrder` in adoption (D-46), production check-only (D-47, R-34); introduced the O-61 operator gate. Blocking then closed: adoption could never fire with zero `bracket_legs` rows (O-58), production stop-then-start exceeded the staging-only ruling (O-59). O-63: nothing moves a bracket off ACTIVE, so every account with bracket history paid a `ListOrders` per 5 s tick forever; the tombstone fix contradicted D-40 (P-8, then the operator's reopen). O-64: `fakeBroker.ListOrders` panics on purpose (`trading_bracket_test.go:85-87`).
- 2026-11-20 — design gate round 10: D-48 tombstone row `NOT_OPEN_AT_ADOPTION` (no emit, no `GetOrder`, retired in every non-retired predicate, one INFO log per tombstone, one Go constant for the retired-status set, a failed insert is one WARN and retried next tick). Tests: listed-terminal, 499-row Alpaca list, exactly-500 no insert, empty IBKR 200, `ListOrders` error, tombstone INSERT error, mixed account one `ListOrders`, repo dbtests for `NetFilledQtyBySymbol`/`KnownBrokerOrderIDs`. Blocking O-65: IBKR `ListOrders` returns an empty slice with nil error on any empty 200 (`ibkr.go:448-482`) and Alpaca caps at 500 rows with no paging (`alpaca.go:373-376`), so absence cannot prove a leg is not open.
- 2026-11-20 — design gate round 11 (adversary SOUND, no Floor breach, no blocking objection): D-49 complete-list gate, D-50 adoption-only throttle; adopted from the adversary (O-67/O-68, binding by the approval ruling): new-candidate bypass, `interval_ms <= 0` read as 60000, injected clock, known-invalid-credentials skip. Tests 11-20 each assert the `ListOrders` call count over N ticks (500-row Alpaca list, idle IBKR empty 200, `interval_ms = 0` vs `halted_poll_interval_ms = 0`, tracked account with a candidate, halted adoption-only, error on tick 1, adopted-then-listed, map independence, new-candidate bypass, known-invalid credentials). Design state of record (the only and last `sdd-batch-design-state` fence; earlier rounds' fences are superseded by it and by `debate.md`):
```sdd-batch-design-state
{
  "round": 11,
  "synth": {
    "approach": "Round-11 synthesis. The round-10 synthesis stands as written (D-1..D-3, D-5..D-16, D-18..D-28, D-31..D-39, D-41..D-48, build order, cutover, production check-only, tombstone row, tests 1-10). This round only closes O-65. All paths are under `/home/user/xstockstrat/.claude/worktrees/orch-311`; `trading.go` means `services/xstockstrat-trading/internal/service/trading.go`.\n\nVerified this round\n- `reconciliation.interval_ms` is read live and a value `<= 0` keeps the reconciler's previous interval; it does not mean \"every tick\" (`trading.go:1977-1983`).\n- `shouldPollHaltedAccount` uses `time.Now()`, stamps when it returns true, and treats `intervalMs <= 0` as \"always poll\" (`trading.go:2848-2859`).\n- `reconcileTick` skips known-invalid-credential accounts before `ListOrders` and applies the halted throttle (`trading.go:2068,2075`); on `broker.ErrInvalidCredentials` it logs a WARN and skips without counting a failure (`trading.go:2083-2086`).\n- `haltAccount` pre-stamps `haltedLastPolled` (`trading.go:2883`); `haltedPollInterval()` defaults to 300000 (`trading.go:2573`).\n\n1. COMPLETE-LIST GATE (confirmed by both sides, as round 10 wrote it; runs after a successful `Broker.ListOrders`)\n- Listed in a terminal state: `NOT_OPEN_AT_ADOPTION` tombstone on any successful list (D-48).\n- Absent from the list: tombstone only when the list is non-empty, and for Alpaca also shorter than 500 rows.\n- Empty IBKR 200, Alpaca list of exactly 500 rows, or a failed `ListOrders`: nothing is inserted; the candidate is re-evaluated on the account's next adoption list.\n- Listed open: unchanged (fill 0 tracked with `adopted = true`; fill > 0 `BASELINE_RETIRED`, no emit).\n\n2. ADOPTION-ONLY THROTTLE (inside `pollBracketLegFills`, after `logTick`; no `StartFillPoller` or `reconcileTick` hunk)\n- Each tick still runs the D-40 candidate query and builds the D-46 union, then splits it per account.\n- Tracked account (at least one non-retired `bracket_legs` row): one `ListOrders` per fill-poller tick, unchanged (D-11, D-46). Adoption shares that list.\n- Adoption-only account (candidates, no non-retired tracked leg): listed only when its cooldown has elapsed.\n  - Cooldown = `trading.reconciliation.interval_ms` (default 60000, live read). If the account is halted, cooldown = `haltedPollInterval()`.\n  - No new config key.\n  - The body of `shouldPollHaltedAccount` becomes one shared helper taking the last-polled map and the interval. `shouldPollHaltedAccount` keeps its signature and behaviour and delegates over `haltedLastPolled`. Adoption calls the helper over a separate `adoptionLastListed` map under `haltedMu`, so neither path consumes the other's slot.\n  - The stamp is taken when the call is allowed, not when it succeeds: a broker that stays down costs one failed call and one WARN per interval.\n  - The map is in memory and empty at boot, so the first tick lists every adoption-only account.\n  - An account that gains a tracked leg is listed every tick from the next tick, whatever its stamp. An account whose last tracked leg retires becomes adoption-only at its next allowed list.\n\n3. ADOPTED FROM ADVERSARY r11, awaiting proposer confirmation (non-blocking)\n- New-candidate bypass: keep the candidate id set seen at the account's last allowed list next to the stamp (under `haltedMu`). An adoption-only account whose current candidate set contains an id not in that set is listed on this tick, and the stamp and set are refreshed. An unchanged or shrunken set stays throttled. This keeps the round-10 latency of about 5 s for a bracket activated by an old trading instance.\n- `reconciliation.interval_ms <= 0` is read as the 60000 default for adoption, matching what the reconciler does from a fresh boot. \"Always list\" comes only from `halted_poll_interval_ms <= 0` on a halted account, which is that key's documented meaning.\n- The shared helper takes `now time.Time`. `shouldPollHaltedAccount` passes `time.Now()`; `pollBracketLegFills` passes `s.clock()`. Tests advance the injected clock and do not touch the map.\n- Adoption-only accounts with `credentialsKnownInvalid` status are skipped before the list, as `reconcileTick` does. A `broker.ErrInvalidCredentials` result is handled as `reconcileTick` handles it: WARN and skip, no failure count. (The adversary called this a \"non-WARN skip\"; the code WARNs.)\n\n4. STEADY-STATE `ListOrders` RATE PER ACCOUNT from `pollBracketLegFills` (defaults: tick 5 s, interval 60 s, halted poll 300 s)\n- Tracked legs: 12/min (17,280/day), unchanged.\n- Adoption-only, not halted (idle IBKR with an empty list; Alpaca pinned at 500 rows): 1/min (1,440/day), down from 12/min. Plus one extra call on a tick where a new candidate id appears.\n- Adoption-only, halted: 0.2/min (288/day).\n- Adoption-only, credentials known invalid: 0.\n- No candidates and no non-retired tracked legs: 0.\n- `reconcileTick`'s own list (1/min, 0.2/min halted) is separate and unchanged, so an idle IBKR account totals about 2/min instead of 13/min.\n\nTESTS (trading; added to round-10 tests 1-10; each asserts the call count over N ticks)\n11. Adoption-only Alpaca, 500-row list without the candidate, interval 60000, three ticks: 1 `ListOrders`, no insert, candidate still present.\n12. Idle IBKR, empty 200, interval 60000, three ticks: 1 call, no tombstone; after the injected clock passes the interval the next tick lists again.\n13. `interval_ms = 0`, not halted, three ticks: 1 call (default applies). `halted_poll_interval_ms = 0` on a halted adoption-only account: 3 calls.\n14. Tracked account with one candidate, interval 60000: 3 calls over 3 ticks, adoption runs on each.\n15. Halted adoption-only, `halted_poll_interval_ms = 300000`: 1 call over 3 ticks.\n16. `ListOrders` errors on tick 1: no call on ticks 2-3, one WARN, nothing inserted.\n17. Candidate listed open on tick 1 and adopted: the account is listed on tick 2 inside the window.\n18. The two maps are independent in both directions; `trading_reconciliation_test.go:486-503` passes unchanged.\n19. Adoption-only account inside its cooldown gains a new candidate id: listed on the next tick; a third tick with the same set makes no call.\n20. Adoption-only account with known-invalid credentials: no `ListOrders`, no WARN.\n\nSPEC FILES (O-64 and O-66 as confirmed): `fakeBroker` `listOrdersFn` and call counter; `fakeBracketRepo` candidate query, tombstone insert and retired-status filter; settable `reconciliation.interval_ms` and `reconciliation.halted_poll_interval_ms` in the test config fake, wired through `GetFloat` (ledger `fails.md:1392`); every existing ACTIVE-bracket test (e.g. `trading_bracket_test.go:416`). /sdd-spec also logs the doc drift at `services/xstockstrat-trading/CLAUDE.md:119` (\"matching `interval_ms`'s own convention\") in the trading findings.",
    "open_objections": [
      {
        "text": "Proposer to confirm the new-candidate bypass adopted from adversary r11: an adoption-only account whose candidate set contains an id not seen at its last allowed list is listed on the next tick (candidate id set kept next to adoptionLastListed under haltedMu), with test 19. Without it the 60 s cooldown widens an existing path from about 5 s to about 60 s: a bracket activated by an old trading instance fills inside the window, is tombstoned with observed_filled_qty = 0 (D-48, R-36), its exit never reaches the ledger or the fold, and NetFilledQtyBySymbol keeps the entry quantity against a flat broker position, which can halt the account (206 trading @AC-1). If the proposer declines the bypass, the residual must name the false halt, not only the lost fill.",
        "blocking": false
      },
      {
        "text": "Proposer to confirm the other items adopted from adversary r11: adoption reads reconciliation.interval_ms <= 0 as the 60000 default (trading.go:1977-1983 keeps the previous interval on <= 0; it does not mean every tick) with test 13 rewritten; the shared throttle helper takes now as a parameter (time.Now() from shouldPollHaltedAccount, s.clock() from pollBracketLegFills) so tests 11-17 advance the injected clock; adoption-only accounts with credentialsKnownInvalid status are skipped before ListOrders and broker.ErrInvalidCredentials is handled as reconcileTick handles it (trading.go:2068,2083-2086), with test 20. /sdd-spec wires the test config fake through GetFloat (fails.md:1392) and logs the trading CLAUDE.md:119 doc drift in the trading findings.",
        "blocking": false
      },
      {
        "text": "O-61: operator-confirmation gate item, recorded in context.md and answered before /sdd-execute reaches the integration step (DO spec with portfolio removed versus the PRIVATE_DOMAIN references; doctl spec round-trip of secrets; homelab stop method; gate deploy exit code on rollback; trading's failed portfolio calls on paper staging; Alpaca listing bracket legs as top-level orders). It also carries the question to ask if a production count is non-zero.",
        "blocking": false
      },
      {
        "text": "O-30: the analysis AC ids in order-snapshots-pnl-patterns.feature and fix-python-loop-supervision.feature are still to be enumerated at /sdd-spec, and the D-10 flip-short window residual stays named.",
        "blocking": false
      },
      {
        "text": "O-56: the orchestrator still has to record P-5, P-6 and P-7 as 'user reopened' citing context.md:1535-1541, P-4 as withdrawn, and P-8 as 'user reopened' citing context.md:2372-2383.",
        "blocking": false
      }
    ],
    "floor_breaches": [],
    "business_rule_changes": [
      {
        "ac_id": "@AC-1",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "@AC-2",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "@AC-3",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "@AC-4",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "@AC-5",
        "kind": "CHANGE",
        "covered_by_operator_decision": true
      },
      {
        "ac_id": "251 @AC-17",
        "kind": "EXTEND",
        "covered_by_operator_decision": true
      },
      {
        "ac_id": "251 @AC-14",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "206 trading @AC-1",
        "kind": "EXTEND",
        "covered_by_operator_decision": true
      },
      {
        "ac_id": "206 trading @AC-2",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "206 trading @AC-3",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "294 @AC-56",
        "kind": "EXTEND",
        "covered_by_operator_decision": true
      },
      {
        "ac_id": "294 @AC-6",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "290 @AC-3",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      }
    ],
    "rejected_alternatives": [
      "Tombstone on absence from any successful list, whatever its completeness (proposal r10). Lost: an empty IBKR 200 or a full 500-row Alpaca list would permanently tombstone open legs (ibkr.go:448-482; alpaca.go:376). The proposer withdrew it in r11 by confirming the gate. Locked this round.",
      "Sharing reconcileTick's own ListOrders result with adoption (proposer r11 runner-up). Lost: it needs a reconcileTick hunk that couples adoption to the 206 @AC-1..3 path, and it makes adoption latency 60 s for every account. Both sides rejected it. Locked this round.",
      "A new config key for the adoption cadence. Lost: the operator steer for round 11 says to reuse reconciliation.interval_ms and the halted throttle rather than add a key. Locked this round.",
      "Throttling adoption through the existing haltedLastPolled map. Lost: an adoption list would consume reconcile's halted re-observation slot, and haltAccount pre-stamps that map (trading.go:2883). The adversary did not contest. Locked this round.",
      "A fixed post-boot full-rate window as a code constant (adversary r11, self-rejected). Lost: a hardcoded duration breaks config governance and misses brackets an old instance activates after the window. Not locked; only one side weighed it.",
      "Tombstone only on a listed terminal status, never on absence (adversary r10). Not needed now that the empty-list case is bounded by the throttle. Not locked.",
      "Tombstone on absence across N consecutive successful lists (adversary r10). Lost: it still fails on a truncated Alpaca list and needs a counter column. Not locked.",
      "A partial index in 012 for the candidate query. Not chosen: /sdd-spec states the scan cost first. Not locked."
    ],
    "open_risks": [
      "An idle IBKR account with an empty list, or an Alpaca account pinned at 500 rows, never tombstones its candidates; it keeps one adoption ListOrders per reconciliation interval (1/min by default) indefinitely.",
      "If the new-candidate bypass is not confirmed, a bracket activated by an old trading instance on an adoption-only account can fill within the 60 s cooldown, be tombstoned with no emit, and false-halt the account through NetFilledQtyBySymbol.",
      "The cooldown and candidate-set memory are in process; every restart lists each adoption-only account once.",
      "The candidate anti-join still runs every tick; only the broker call is throttled (005_broker_accounts_halted.up.sql:29-31).",
      "reconciliation.interval_ms <= 0 means 'keep the previous interval' in the code but the trading CLAUDE.md:119 row implies 'every tick'; the doc drift is only logged, not fixed, in this feature.",
      "A genuinely open leg absent from a complete list on its evaluation tick is tombstoned permanently; its exit fill never reaches the ledger, the fold or reconciliation.",
      "A tombstone is undone only by a manual delete of its bracket_legs row.",
      "Existing trading tests that hold an ACTIVE bracket with leg ids panic on fakeBroker.ListOrders until the fakes are extended.",
      "If a production count is non-zero, the promotion stops with no designed procedure; it waits on an operator ruling.",
      "The DO stop is unverified: .do/app.dev.yaml:78 and :319 reference ${xstockstrat-portfolio.PRIVATE_DOMAIN}, so a spec with the portfolio service removed may be rejected.",
      "The merge precondition and the main-dev freeze are not enforced; an overlap double-applies fills and only the recorded evidence shows it.",
      "On the homelab VM an unattended rollback of the integration deploy restores the pre-019 portfolio after the floor is stamped; noticing it depends on gate deploy exiting non-zero, which is unconfirmed.",
      "Fills appended between T_stop and the first new boot are acked: qty heals at the next sync, realized P&L for them is lost.",
      "While portfolio is stopped on staging, trading's portfolio calls fail: the risk check warns only, reconciliation skips, and flattenAndHalt cannot flatten.",
      "Adoption depends on Alpaca listing bracket legs as top-level orders in every open state; this is unverified.",
      "Reconciliation covers only tracked legs; the D-42 forward-only gap stays uncounted.",
      "A BASELINE_RETIRED leg's post-cutover remainder is neither emitted nor observed.",
      "Adopted IBKR legs that later vanish from the gateway are polled indefinitely (D-26).",
      "Late-commit appends whose recorded_at is below the floor are acked (operator-accepted).",
      "The floor assumes ledger and portfolio share one Postgres server clock.",
      "With the composite GetPnL key, a historical order whose partial and full fills carried different account_id values stops being deduplicated; the /sdd-spec history grep is the only check.",
      "A parked fill is retried only after a manual delete of its parked row.",
      "A fill transaction can wait server-side on the applied-row conflict or FOR UPDATE, holding 1 of 2 client connections and positionsMu.",
      "The pre-check has a TOCTOU window covered only by the in-tx INSERT conflict path.",
      "A position.updated can be emitted after a same-process sync has overwritten the row.",
      "Boot replay re-walks every post-floor fill and consumer_applied_events has no retention.",
      "A leg id is lost from tracking if the ActivateBracket tx fails; it is alerted, but its exit fill never folds.",
      "Neither broker adapter populates BrokerOrder.Fees, so fee totals understate.",
      "Migration numbers 019 and 012 may collide with feature 318.",
      "OQ-2 (repair of already-inflated accumulators) is out of scope, and instance_count must stay 1."
    ],
    "constitution_rules_touched": [
      "C-01",
      "C-05",
      "C-08",
      "C-10",
      "C-11",
      "C-13",
      "C-15",
      "C-16",
      "C-18",
      "F-01",
      "F-02",
      "F-04",
      "F-06",
      "F-07",
      "F-08",
      "P-02",
      "P-03",
      "P-04",
      "PLAT-N1"
    ],
    "rationale": "The design has no blocking objection left. The adversary rates it SOUND with no Floor breach, and O-65 is closed.\n\n**What closed O-65.** The proposer confirmed the complete-list gate exactly as round 10 wrote it, and bounded the two cases where a tombstone is unsafe. An adoption-only account is now listed once per `reconciliation.interval_ms` (once per halted interval when halted) instead of every 5 s tick. That is 1 call/min by default, down from 12, with no new config key. This is what the operator steer asked for, so the \"evaluated exactly once\" reading does not need to go back to the operator.\n\n**What I adopted from the adversary, unconfirmed.** I checked each of the four objections against the code and put the fixes into the approach as non-blocking confirm items:\n- **New-candidate bypass.** The 60 s cooldown widens an existing lost-fill and false-halt path about 12x for brackets an old trading instance activates. The bypass restores the 5 s latency for that population and leaves idle accounts at 1/min. It lives inside the throttle this round adds, so it stays within the steer.\n- **`interval_ms <= 0`.** The proposer's claim that it means \"every tick\" is wrong; `trading.go:1977-1983` keeps the previous interval. Adoption reads it as the 60000 default.\n- **Injected clock.** The helper takes `now`, so tests do not reach into the map.\n- **Invalid credentials.** Adoption-only accounts are skipped as `reconcileTick` skips them. I corrected one adversary detail: `reconcileTick` does log a WARN on `ErrInvalidCredentials` (`trading.go:2083-2086`).\n\nThe two new decisions record only what both sides agree. The four adversary items are left out of them until the proposer confirms.\n\n**Housekeeping.** O-64 and O-66 are closed on the proposer's confirmations, which match their register text. O-30, O-56 and O-61 stay open and non-blocking. No settled D-n is contradicted, no locked R-n returns (R-10 and R-36 are honoured), and nothing is reopened this round. Business rules are unchanged from round 10.",
    "register_delta": {
      "new_decisions": [
        {
          "text": "Complete-list gate, filling the gap D-48 left open: after a successful ListOrders, a candidate absent from the list gets the NOT_OPEN_AT_ADOPTION tombstone only when the list is non-empty, and for Alpaca also shorter than 500 rows. An empty IBKR 200, an Alpaca list of exactly 500 rows or a failed ListOrders inserts nothing, and the candidate is re-evaluated on the account's next adoption list. Listed-terminal candidates are tombstoned on any successful list (D-48). Required tests: Alpaca 499 rows tombstones; Alpaca 500 rows does not; empty IBKR 200 does not.",
          "evidence": "operator steer r11 ('confirm the complete-list gate as the synthesis wrote it'); ibkr.go:448-482; alpaca.go:373-376; R-10; D-48; proposal r11 item 1; adversary r11 rated it sound"
        },
        {
          "text": "Adoption-only throttle, amending D-46's 'adoption runs every tick' for accounts with candidates but no non-retired bracket_legs row: such an account gets its adoption ListOrders only when a per-account cooldown has elapsed. The cooldown is trading.reconciliation.interval_ms (default 60000, live read), or haltedPollInterval() when the account is halted; no config key is added. The body of shouldPollHaltedAccount becomes one shared helper; shouldPollHaltedAccount keeps its signature and behaviour over haltedLastPolled, and adoption uses a separate in-memory adoptionLastListed map under haltedMu. The stamp is taken when the call is allowed, so a failed list is throttled too. The map is empty at boot, so the first tick lists every adoption-only account. Tracked accounts keep one ListOrders per tick (D-11, D-46), and an account that gains a tracked leg is listed every tick from the next tick. The throttle sits inside pollBracketLegFills with no StartFillPoller or reconcileTick hunk. Steady-state calls per account from pollBracketLegFills at defaults: tracked 12/min; adoption-only 1/min; adoption-only halted 0.2/min; no candidates and no tracked legs 0. Tests assert the call count over N ticks for each state. The meaning of interval_ms <= 0, the clock source, a new-candidate bypass and a credential gate are not part of this decision.",
          "evidence": "operator steer r11 (reuse reconciliation.interval_ms and shouldPollHaltedAccount, no new key); trading.go:1977,2075,2573,2848-2859,2883; D-11; D-22; D-46; 294 @AC-6; trading_reconciliation_test.go:486-503; proposal r11 items 2-3 and tests 11-18; adversary r11 rated it sound and contested only the four excluded points"
        }
      ],
      "new_rejected": [
        {
          "text": "Tombstoning a candidate on absence from any successful ListOrders, whatever the list's completeness",
          "why": "An empty IBKR 200 (ibkr.go:448-482) or a full 500-row Alpaca list (alpaca.go:376) would permanently tombstone open legs. The proposer withdrew it in round 11 by confirming the complete-list gate."
        },
        {
          "text": "Sharing reconcileTick's own ListOrders result with adoption",
          "why": "It needs a reconcileTick hunk that couples adoption to the 206 @AC-1..3 path and makes adoption latency 60 s for every account. Proposer r11 did not choose it and adversary r11 agreed."
        },
        {
          "text": "A new config key for the adoption ListOrders cadence",
          "why": "The operator steer for round 11 directs reuse of reconciliation.interval_ms and the halted-account throttle rather than a new key."
        },
        {
          "text": "Throttling adoption through the existing haltedLastPolled map",
          "why": "An adoption list would consume reconcile's halted re-observation slot, and haltAccount pre-stamps that map (trading.go:2883). Proposal r11 rejected it and adversary r11 did not contest."
        }
      ],
      "new_objections": [
        {
          "text": "Proposer to confirm the new-candidate bypass adopted from adversary r11: an adoption-only account whose candidate set contains an id not seen at its last allowed list is listed on the next tick, with the candidate id set kept next to adoptionLastListed under haltedMu and a test. Without it the 60 s cooldown widens the path where a bracket activated by an old trading instance fills unobserved, is tombstoned with no emit, and can false-halt the account through NetFilledQtyBySymbol (206 trading @AC-1). If declined, the residual must name the false halt as well as the lost fill.",
          "blocking": false
        },
        {
          "text": "Proposer to confirm the other items adopted from adversary r11: adoption reads reconciliation.interval_ms <= 0 as the 60000 default (trading.go:1977-1983), with the throttle-disabled test driven through halted_poll_interval_ms <= 0; the shared helper takes now as a parameter (time.Now() from shouldPollHaltedAccount, s.clock() from pollBracketLegFills) and the throttle tests advance the injected clock; adoption-only accounts with credentialsKnownInvalid status are skipped before ListOrders and broker.ErrInvalidCredentials is handled as in reconcileTick (trading.go:2068,2083-2086), with a test. /sdd-spec wires the test config fake through GetFloat (fails.md:1392) and logs the trading CLAUDE.md:119 doc drift in the trading findings.",
          "blocking": false
        }
      ],
      "closed_objections": [
        {
          "id": "O-65",
          "how": "The proposer confirmed the complete-list gate as written, with the empty-IBKR, 500-row and 499-row tests, and bounded the idle-IBKR and pinned-at-500 cases at one adoption ListOrders per reconciliation.interval_ms (one per halted interval when halted) through the reused throttle, with call-count tests. Adversary r11 rated it sound. The cooldown's latency for newly activated brackets is tracked as a new objection."
        },
        {
          "id": "O-66",
          "how": "The proposer confirmed every item: the INFO log per tombstone, the runbook delete-the-row path, the single retired-status constant read by the fakes, the corrected KnownBrokerOrderIDs statement with the resize-blanked test, the /sdd-spec scan-cost statement against the 005 indexes, and the 012 DDL comment for the adopted column."
        },
        {
          "id": "O-64",
          "how": "The proposer confirmed the spec's Files list: the fakeBroker listOrdersFn and call counter, the fakeBracketRepo candidate query with tombstone insert and retired filter, settable reconciliation interval keys in the test config fake, and every existing ACTIVE-bracket test (e.g. trading_bracket_test.go:416)."
        }
      ],
      "reopen_petitions": [],
      "reopened": []
    }
  },
  "floor_breaches": []
}
```

- 2026-11-20 — sdd-design (approved): Phase 0 wrote `recon.md` (consumer surfaces xstockstrat-ui `/trader` and agent `get_positions` read the folded rows, no code change designed; reuse `pnl.FoldFrom` and `orderSide`); Phase 1 ran 11 full rounds, rejected R-1..R-40 (R-25 reopened and now the chosen floor); status spec-ready → design-approved; constitution rules touched C-01, C-05, C-08, C-10, C-11, C-13, C-15, C-16, C-18, F-01, F-02, F-04, F-06, F-07, F-08, P-02, P-03, P-04, PLAT-N1, no Floor breach. Binding on the spec: the round-11 synthesis including its adopted adversary items. Approval provenance and register changes are in Decisions; its Open Threads are hoisted into the header.
  No ledger line written: the debate's reusable lesson (an empty or capped broker list cannot prove absence) is covered by R-10's evidence and belongs to `/sdd-execute` once proven in code.

## Session 2026-11-20 — operator rulings recorded by the orchestrator (verbatim)

Written by the orchestrating session itself, not by a workflow step. Each entry quotes the question put to the
operator and the operator's own answer. These are operator consent (C-11, C-16); later rounds treat them as fixed.

- **Decision packet (round 3 gate).** Packet item, as shown to the operator: "311 (Rec steer): reopen D-4 and scope
  the leg key by account, `bracket-leg:<account_id>:<legID>:…`. The new evidence is that GetPnL also suppresses other
  accounts' partial fills. Bind the synthesis's other 5 fixes. Also choose: run the real-Postgres test in CI (Rec), or
  downgrade it." Operator: "Let's go with the recommendations in the decision packet". Effect: REOPEN D-4 granted;
  the AC-2 two-writer proof runs as a real-Postgres test in CI, no downgrade.
- **D-17.** Question: reopen D-17 for the cross-process race-conflict case only, or accept the idle-in-transaction
  cost. Operator: "Do your best to prevent the race condition and fix the bug report", then, to the orchestrator's
  reading (fill path takes `positionsMu` before BEGIN; a cross-process duplicate may take the mutex): "Yes, that's
  what I meant for 311". Effect: REOPEN D-17 granted, narrowly.
- **D-4 scope extension (O-17, O-35).** Question: "the account-scoped bracket-leg key (the D-4 reopen you accepted in
  the decision packet) also requires GetPnL's three de-duplication maps to key on account_id + order_id instead of the
  bare order id. That edits GetPnL, which the bug's product spec did not list in scope. … Do you approve this scope
  extension?" Operator selected: "Approve both (Recommended)". Effect: P-1/P-2 'user reopened'; composite GetPnL key
  approved as a scope extension; two-account same-leg-id test required.
- **Residuals (O-3, O-8, O-13).** Question: "Feature 311 carries three residuals the design does not fix and wants
  accepted: (a) first-deploy cutover must be stop-then-start, as a runbook step, because old and new instances
  overlapping could double-apply a fill; (b) a parked post-cutover fill re-parks with an ERROR log on every boot until
  handled; (c) bracket-leg fills stay absent from trading.orders and NetFilledQtyBySymbol. Accept these as recorded
  residuals?" Operator selected: "None — fix in scope". Effect: all three are design requirements.
- **@AC-5 amendment — NOT signed off.** Question put; operator answered "Show me the full examples". The examples
  were shown; no sign-off has been given. `@AC-5` stays `covered_by_operator_decision = false` (O-11 open).
- **Round cap.** Operator: "Override round cap until design is sound" — debates may run past 5 rounds until the
  adversary rates the design sound; a sound design with every C-16 change covered is approved on the operator's
  behalf. Round 6 ran under this authorisation.

## Session 2026-11-20 — operator rulings after round 6, recorded by the orchestrator (verbatim)

Written by the orchestrating session itself. Each entry quotes the question and the operator's own selection.

- **@AC-5 — C-16 sign-off GIVEN.** Question: "311 AC-5 (examples shown above): sign off the amended wording, where
  the bracket leg's full-fill event carries qty 10 at the cumulative average price instead of qty 6?" Operator
  selected: "Sign off (Recommended)". `@AC-5` is covered by an operator decision; O-11 closes. Amended Then: "the
  ledger holds an order.partially_filled event with qty 4 and an order.filled event with qty 10 at average fill price
  110 for that leg".
- **Cutover (former residual (a), O-3) — stop-then-start on staging.** Question: the write-fence trigger's writer
  identification is unproven through PgBouncer and two pre-cutover cases stay undecidable; production has never
  launched, so the cutover happens once, on staging; how should the first deploy be made safe? Operator selected:
  "Stop-then-start on staging (Recommended)". This REVERSES "None — fix in scope" for item (a) only: no
  `portfolio.positions` trigger, no `fill_fence`/`fill_cutover`, no application_name fence. The cutover is one
  numbered runbook step with a recorded result (stop portfolio, deploy, start); the overlap case cannot occur. The
  remaining O-3 pre-cutover cases are accepted as the consequence of this choice.
- **Bracket-leg fills in reconciliation (former residual (c), O-13) — via `trading.bracket_legs`.** Question: D-3
  forbids leg rows in `trading.orders`; the design makes `NetFilledQtyBySymbol` include legs from
  `trading.bracket_legs`; is that what "fix in scope" meant? Operator selected: "Via bracket_legs (Recommended)".
  D-3 stands; no REOPEN D-3.
- **Historical legs — forward-only.** Question: legs of brackets exited/canceled before cutover, ids blanked by a
  resize and old IBKR legs cannot all be recovered; how should history be handled? Operator selected: "Forward-only
  (Recommended)". Track legs from cutover on; the unrecoverable historical set is a recorded, accepted gap.
- **Former residual (b), O-8** stays in scope as ruled ("None — fix in scope"): a parked fill must not re-park with
  an ERROR on every boot.

## Session 2026-11-20 — production scope, recorded by the orchestrator (verbatim)

Written by the orchestrating session itself.

- **Production is out of scope.** Operator, earlier the same day, on a pre-deploy action that named both environments:
  "And leave production out. It's never been out/launched". The post-round-6 cutover question was put on that premise
  ("Production has never launched, so the cutover happens once, on staging") and the operator selected
  "Stop-then-start on staging (Recommended)". Effect for this design: no production stop-then-start procedure and no
  production branch in the cutover. At most a check-only note that the first production promotion verifies the
  production database holds no `portfolio.positions` rows and no `order.filled` ledger rows, and stops for the
  operator if it does. How portfolio is stopped on each staging target is confirmed by the operator at execution
  time (the runbook step), not at design time.

## Session 2026-11-20 — D-40 reopen, recorded by the orchestrator (verbatim)

Written by the orchestrating session itself.

- **REOPEN D-40 granted.** Question: "round 9 is rated sound with no blocking objection. One cost is left for you.
  Because nothing ever moves a bracket off ACTIVE, every account with any bracket history gets one broker ListOrders
  call on every 5-second fill-poller tick, forever, even when nothing is left to adopt … The adversary's fix is a
  'tombstone': once a successful ListOrders shows a candidate leg is not open, write a closed-out row for it so it is
  evaluated only once. That changes settled decision D-40 and costs one more debate round. Which do you want?"
  Operator selected: "Reopen D-40, add tombstone (Recommended)". Effect: after a successful `ListOrders` that does not
  show a candidate open, insert a closed-out `trading.bracket_legs` row for it (no emit, `observed_filled_qty = 0`),
  so each candidate is evaluated once. A failed `ListOrders` still inserts nothing (R-10).

## Session 2026-11-20 — sdd-spec

- Generated implementation-spec.md with 27 steps. Status → implementation-ready. `acceptance.feature` `@AC-5` now carries the operator-signed wording (D-38); the `@AC` ID is kept (C-15).
- **Written from the workflow's computed task, not by the operator.** The operator's own words are only in the sessions titled "recorded by the orchestrator (verbatim)" above. Nothing here is an operator ruling.
- **Tree.** Service evidence was read from `origin/main-dev@fb52065c`. `origin/feature/fix-position-fold-correctness` was 168 commits behind `main-dev` and differed from the merge base `c4fd48b0` only inside this directory. This run did not merge `main-dev` (its task allowed edits only inside this directory); `/sdd-execute` BRANCH SYNC does. `recon.md`, `debate.md` and `design.md` cite `c4fd48b0` line numbers; the spec's numbers are the current ones.
- Key codebase findings:
  - Migration numbers: portfolio `019` and trading `012` are free on `main-dev@fb52065c` (max `018_watchlist_signal_expiry`, `011_offline_fees_snapshot_headers`). Feature 318 (`spec-ready`) adds no migration file. Unmerged branches of other features were not checked; `/sdd-execute` re-checks after BRANCH SYNC.
  - Portfolio sites: `processOrderFill` `portfolio_service.go:376-490`; `observed` `:234-245`; `emitEventAs` `:1371` (callers `:1367`, `signal_prune.go:60,70`); `GetPnL` dedup maps `:993-1020`; `queryRower` `portfolio_repo.go:23-27`. The service dbtests build the repo with `NewPortfolioRepoWithDB(pool)`, so `ApplyFill` begins its transaction from `r.db` through `txBeginner`, not from `Pool()`.
  - Trading sites: `pollFills` `trading.go:1816-1878` (`logTick` at `:1877`); the three ACTIVE bracket writes `:3680`, `:3697`, `:3739`; `appendLedgerEvent` `:3945` (callers `:1123`, `:3989`, `trading_offline_test.go:2215,2228`); `shouldPollHaltedAccount` `:2949-2960`; `reconcileTick` credential and halted gates `:2174-2193`; `KnownBrokerOrderIDs` `trading_repo.go:130`, `NetFilledQtyBySymbol` `:171`.
  - The v1 scope-limitation paragraph D-10 rewrites is now in `services/xstockstrat-portfolio/docs/position-closed-contract.md`, not in the portfolio `CLAUDE.md`.
  - The `reconciliation.interval_ms` doc row the design cites at trading `CLAUDE.md:119` is now at `:95` (halted row `:98`). `TestShouldPollHaltedAccount_ThrottlesAndRecovers` is at `trading_reconciliation_test.go:491-513`.
  - `.do/app.dev.yaml:439` and `:701-707`: on DO staging, ledger (direct) and portfolio (PgBouncer pool) use the same `xstockstrat` cluster, so they share one server clock. The homelab DSNs are not in this repository and were not checked.
- **Spec assumptions (A-1..A-12 in implementation-spec.md).** These are spec choices, not operator rulings:
  - A fill payload with `qty` 0 or an empty `order_id`, `user_id` or `symbol` is skipped before the applied key is taken. Without this the 294 `@AC-56` fixture's partial-shaped event would take `ord-56`'s key and the test's "4 ok" would break.
  - The D-11 `GetOrder` fallback cap has no number in the register; the spec uses a constant of 5 per account per tick.
  - The leg observer lower-cases the broker status before mapping it, because `alpacaStatusToProto` does not match IBKR's capitalised statuses and IBKR passes them through raw. Without it `@AC-4` and `@AC-5` would hold for Alpaca only.
  - Round-10 trading tests 8-9 are specified as pgxmock SQL-shape tests: trading has no `dbtest` harness and CI has no trading DB job.
  - A floor stamp or load failure is retried every `streamRetryDelay`; the fill stream never opens without a floor.
  - `trading.bracket_legs` also carries `order_id`, `user_id`, `trading_mode` and `not_found_ticks` (round-4 and round-8 syntheses); `design.md` § 2 lists the columns in short form.
  - `PortfolioRepo.GetRealizedAccum`, `GetFeesAccum`, `ClosePosition` and `UpsertPosition` lose their last production caller and are deleted with the fill-path rewrite.

## Open Threads

- **ORCHESTRATOR ASSUMPTION, not an operator ruling (carried forward unchanged).** The adoption-only throttle (D-50: adoption `ListOrders` at the reconciler cadence for accounts with candidates but no live tracked legs, no new config key) was chosen by the orchestrator to meet the operator's stated reason for the D-40 reopen (remove the permanent per-tick broker load) where a tombstone is unsafe. The operator was told and has not objected or confirmed. The operator can overturn it. Steps 23-25 of the spec implement it. It is also listed in `design.md` § Open Risks. Target: operator confirmation before `/sdd-execute`.
- **Before `/sdd-execute`.** This file is far over the 65536-byte `/sdd-execute` limit. `/sdd-distill fix-position-fold-correctness` must run first.
- **Found after the design was approved (the design debated the `c4fd48b0` tree).** Target: `/sdd-review fix-position-fold-correctness impl-spec`, then the operator if a change is wanted.
  - Feature 347 (Alpaca adaptive rate limit) is on `main-dev`. Its trading `@AC-34` ("The fill poller does not stall on a throttled Alpaca account") is a PRESERVE the design did not list. The spec bounds leg `ListOrders` and `GetOrder` calls with `alpacaCallContext`, as the parent poll does.
  - `services/xstockstrat-analysis/app/engine/pnl_pattern_consumer.py:48-49` consumes `order.filled` and `order.partially_filled`. Bracket-leg events will reach it with a broker leg id as `order_id`. No step changes analysis; Step 27 logs it in the trading findings. O-30's list: analysis 042 `@AC-1` (snapshot on fill), `@AC-2` (close triggers pattern analysis), `@AC-7`, and 259 `@AC-6`, `@AC-7`, `@AC-9` (consumer retry and park).
  - The parent `pollFills` path maps IBKR statuses through `alpacaStatusToProto` without lower-casing. That defect is outside this feature; Step 27 logs it.
- **Housekeeping closed by this session.** `@AC-5` wording applied. Migration numbers re-checked. O-67 and O-68 are treated as settled: Steps 23-25 carry the new-candidate bypass, `interval_ms <= 0` read as 60000, the injected clock and the known-invalid-credentials skip.
- **Unchanged from the sdd-design (approved) session's Open Threads.** The O-61 operator confirmations before the cutover step, and every accepted residual listed there, still stand. Step 26 writes them into the runbook.

## Session 2026-11-20 — sdd-review impl-spec

- Result: 1 failure, 11 warnings; overlap WARN (advisory, did not block). Lifecycle unchanged (`implementation-ready`).
- **Written from the workflow's computed task, not by the operator.** Nothing here is an operator ruling. The task told this run to edit `implementation-spec.md` for every FAIL and clearly-correct WARN; the skill's MODE B on its own only records findings.
- Every claim was re-checked on `origin/main-dev@fb52065c` (still the tip of `main-dev`) before the spec was changed.
- **Addressed in `implementation-spec.md`:**
  - [x] FAIL, Step 7 (B3b, F-05, C-08): the A-2 skip class made Step 7 fail its own whole-package run. Confirmed: `fillEvent` (`portfolio_fill_errors_test.go:24-34`) has no `order_id`, and the three tests at `:67-109` expect `errDBBlip`. Fix: the skip class moved from Step 7 to Step 9, where the applied key it protects first exists; its tests moved from Step 8 to Step 10. Step 7 now says not to add it. No step was renumbered and no `Lands with` chain changed.
  - [x] WARN, Steps 18-19 side type: `BracketLegParent.Side` is now stated as a `tradingv1.OrderSide` holding the leg side, flipped by the caller with `oppositeSide`'s rule and written through `sideStr`. `oppositeSide` itself returns the broker wire string and is left alone. Recorded as spec assumption A-13.
  - [x] WARN, C-14: a `## Step Dependencies` line now records that ui `/trader` and agent `get_positions` get no step (read-only consumers, verified by the acceptance-suite scan). No follow-up feature is named because no change is planned.
  - [x] WARN, line hints: a hard `/sdd-execute` step now says to locate every cited site by symbol after BRANCH SYNC; the symbol wins over the number. The reviewer's tree predated feature 347; the spec's numbers were spot-checked on `fb52065c` (`processOrderFill` `:376`, `oppositeSide` `:3572`, `sideStr` `:436`) and match.
  - [x] WARN, Steps 7 and 9 both edit the head of `processOrderFill`: a Step Dependencies note says Step 9 re-reads Step 7's result and where the skip class goes.
  - [x] WARN, A-10 analysis consumer: checked. `_handle_order_event` (`pnl_pattern_consumer.py:348-404`) only stores `order_id`; the column has no foreign key or unique constraint (analysis migration `016`, lines 12 and 25-26). An unknown `order_id` is stored, not rejected. A-10 now carries this evidence.
  - [x] WARN, D-50 and the `context.md` size: both are now listed in the spec as gating preconditions; D-50 gates Steps 23-25 only.
  - [x] Overlap: the same-file findings (312, 315, 317, 321, 326) are recorded in Step Dependencies. No migration, proto or config collision.
- **Not changed, with the reason:**
  - Spec header `**Status**: pending`. The spec template (`.claude/skills/sdd-spec/reference/spec-template.md:8`) sets this value; it is step progress, not lifecycle. `status.md` reads `implementation-ready` and is the only lifecycle source. No mismatch.
  - Step 10 touches 8 files. It is not split: Step 9 deletes the repo methods that `portfolio_repo_test.go` and `position_drain_dbtest_test.go` call, so those two files do not compile outside the Step 9+10 unit. The reason is now in Step Dependencies.

## Open Threads

- **Unresolved impl-spec review items carried into execution.** `/sdd-execute` announces each one at every checkpoint until its box is ticked.
  - [ ] unaddressed — Steps 23-25 (D-50): the adoption-only throttle is an orchestrator assumption, not an operator ruling. Target: the operator confirms or overturns it before Step 23 starts.
  - [ ] unaddressed — `context.md` is far over the 65536-byte limit. Target: `/sdd-distill fix-position-fold-correctness` before the first step.
  - [ ] unaddressed — Steps 1-2 migration numbers (portfolio `019`, trading `012`) are free on `fb52065c`; unmerged branches of other features were not inspected. Target: the re-check after BRANCH SYNC.
  - [ ] unaddressed — Step 20 (A-5): the `KnownBrokerOrderIDs` and `NetFilledQtyBySymbol` changes are proven only by pgxmock SQL-shape tests. A wrong `UNION`, `DISTINCT ON` or sign would pass. Trading has no real-Postgres test job. Target: operator decision on a follow-up CI job; none is designed.
  - [ ] unaddressed — Step 21 (A-4, C-2): only the leg observer lower-cases IBKR statuses. The parent `pollFills` path still mismatches them. Step 27 logs it as a finding; it is not fixed here. Target: separate fix.
  - [ ] unaddressed — A-10 residual: a bracket-leg fill that reaches the analysis consumer when no P&L window is open would open one. Whether a leg fill can arrive after its position's close event was not checked. Target: check at Step 22, when the leg emit order is in code.
  - [ ] unaddressed — Overlap: 312 edits the same `alpaca-default` lines of `portfolio_service.go` that Step 9 builds on (`:434-437`); 315, 317, 321 and 326 edit other ranges of files this feature changes. All from product-spec evidence only. Target: whichever merges second rebases; re-run the overlap scan when a peer becomes implementation-ready.
- **Carried forward unchanged.** The O-61 operator confirmations before the cutover step and every accepted residual in the "sdd-design (approved)" and "sdd-spec" Open Threads above still stand.

## Session 2026-11-21 — /sdd-distill

- Distilled 19 sessions → header + Superseded Sessions; kept 2 verbatim (`sdd-spec`, `sdd-review impl-spec`) plus 4 operator-ruling sessions verbatim (operator quotes). Kept only the last `sdd-batch-design-state` fence (round 11, byte-for-byte); the nine earlier round fences (rounds 2-10) are superseded by it and by `debate.md` / `design.md` / `implementation-spec.md`.
- context.md 2991 lines / 361096 bytes → see the commit message for the after size. Original prose preserved in git history (parent of this commit).
