# Context: fix-offline-book-consistency  (archived 2026-11-04)

**Feature**: ./feature.md
**Status**: launched — archived by /sdd-archiver; verbose specs pruned (recoverable via git history).

## Archive Synthesis — 2026-11-04 — /sdd-archiver

Cite convention: `old context.md@1ed63958:N` is the pre-archive `context.md` (rewritten by this block);
`<file>@1ed63958:N` is a deleted spec file (`git show 1ed63958:docs/roadmap/features/256-fix-offline-book-consistency/<file>`).
Bare `path:line` cites are code, re-opened in the archive-time tree (origin/main-dev lineage); anchors that drifted since the design are marked "drift".

**What**: Offline-account (`BROKER_TYPE_OFFLINE`, feature 240) books can no longer drift or misreport P&L on the four
best-effort paths from the debt-radar scan (D-47, D-48, D-49, D-63; SEV-2 group, Track C). Portfolio's offline sync and
deregistration consumers return errors behind a SQLSTATE-classifying `boundedRetry` instead of `ackAlways`
(`portfolio_service.go:1297`). A failed `GetOfflineStates` read (or one undecodable `recent_fills` row) marks only that
account via additive `Portfolio.offline_state_unavailable = 17` / `Position.offline_state_unavailable = 26`
(`portfolio.proto:70`, `:124`), with P&L zeroed and excluded from aggregates (`offline_valuation.go:29-36`, `:117-147`).
`ConfirmOrder` rejects non-finite or negative fills before the load (`isFinite`, `trading.go:890`) and returns
UNAVAILABLE "positions not published; re-confirm to retry" when the `account.positions.synced` append fails
(`trading.go:988`). Launched 2026-10-31 via PR #1387; 16 steps shipped as 12 commits (four step pairs merged).

**Why (irrecoverable rationale)**:
- Offline accounts have no broker poll to heal a missed write, so a swallowed failure is permanent. This is why the
  fix fails closed instead of copying feature 240's best-effort choices (old context.md@1ed63958:15-22).
- Operator steer at the 2026-10-21 design gate: "preserve as much as you can while having low rework"
  (rationale text of the r2 synthesis, old context.md@1ed63958:300). It selected the per-account additive marker over
  whole-call UNAVAILABLE: one extra proto field per message beats a C-16 CHANGE that would hide every broker card.
- The three r3 blocking objections were resolved by operator-binding "[r4 MUST]" items at the r3 gate
  (design.md@1ed63958:3-6, :340-343): Position marker 26 with non-failing position reads; per-row `GetOfflineStates`
  decode exposed as `readValuation.unavailable`; SQLSTATE-class park rule with the documented `lastSeq=0` self-heal.
- Park-rule reasoning (not recoverable from code): an error-blind "5 attempts AND 10 min" bound drops events during any
  DB outage over 10 min, `account.deregistered` included (the very orphan FR-2 exists to prevent), and also stalls the
  shared `account.positions.synced` stream (all users, broker syncs included) for 10 min on a deterministic poison
  event. Class 22/23 parks after 5 attempts (about 10 s at the 2 s reconnect sleep); transient never parks (head-of-line
  blocking costs nothing during an outage because every write fails anyway); only unclassified errors keep the
  count-AND-time bound, so a misclassification can never fast-park (design.md@1ed63958:86-96;
  old context.md@1ed63958:339-343, :481-482).
- Recovery for a parked event is the next deploy: `lastSeq` starts at 0 on every boot, so full history replays and the
  absolute recompute (AC-10 @feature-157) makes the replay idempotent (design.md@1ed63958:97-102). Code drift: the
  anchors cited then (`portfolio_service.go:186`, `:205-209`) are now `:192` (`var lastSeq`) and `:211` (comment on
  `streamEventsFrom`).
- Why the emit retry exists although r2 rejected it: r2 said "No in-lock retry. Duplicates are tolerated ... No
  idempotency_key" (old context.md@1ed63958:140, :266); the r3 objection reversed it because "a ledger deploy GOAWAY fails
  ConfirmOrder after UpsertOrder has committed" (old context.md@1ed63958:383). It was adopted as an "r4 SHOULD" at the r3
  gate (old context.md@1ed63958:344-346).
- Why `ackAlways` stays on the bracket/balance consumers: the product spec scoped them out as broker-only, "A broker poll
  heals those" (product-spec.md@1ed63958:132). That is the only written rationale for the asymmetry with the offline
  consumers, which have no poll.
- `errors.Join` precedence "transient > deterministic > unclassified" (old context.md@1ed63958:624-625). Inference for the
  reason: a try-all failure with any transient leaf must never park.
- Snapshot gets a Warnings line, not an error: its only consumer is the agent through `MessageToDict`; the UI has no
  Snapshot caller (design.md@1ed63958:54-55; old context.md@1ed63958:102-103). A frozen-window confirm (AC-46 @feature-240)
  still recomputes and emits, so it fails only when the ledger append fails (design.md@1ed63958:65-66;
  recon.md@1ed63958:279-281).

**Rejected alternatives**:
- UNAVAILABLE on `GetPosition`/`ListPositions` under an offline-state fault (r1-r3) — lost because an unscoped
  ListPositions would hide every broker row (`positions/page.tsx`), de facto CHANGE @AC-14/@AC-3 @feature-157, an
  account-vs-position read-path asymmetry (fails.md "read-path parity"), and it fails trading REDUCE_ONLY
  (`trading.go` GetPosition caller maps any non-NotFound error to Unavailable) though Qty is valid. Replaced by Position
  marker 26 (design.md@1ed63958:200-203; old context.md@1ed63958:477).
- Position marker at proto tag 20 (the adversary's suggestion) — tag 20 is `stop_order_id`; highest tag was
  `mark_as_of = 25`, no `reserved` (old context.md@1ed63958:478; design.md@1ed63958:22-23, :204).
- Whole-call UNAVAILABLE on all-accounts reads with an operator C-16 CHANGE sign-off (r1 approach) — hides every broker
  card, breaks @AC-14/@AC-3 @feature-157 and @AC-3 @feature-159. Kept only as the fallback had the proto gate refused
  fields 17/26 (design.md@1ed63958:217-218, :152-154). The "@AC-3 @feature-159" cite is from old context.md@1ed63958:257
  and recon.md@1ed63958:253.
- Inferring `degraded` as `errors.Is(valErr, sentinel) && bal == nil` at each caller (r3) — C-18 (one concept at three
  sites) and it marked broker accounts whose balance read failed (two accepted broker side effects: the
  ListPortfolios single-account path at `:1405-1416` and the GetPortfolio region at `:598-626`; old context.md@1ed63958:116,
  :336, :479). Replaced by `readValuation.unavailable[acctID]`, so only ids passed to `GetOfflineStates` can be
  marked (design.md@1ed63958:205-207, :119-121).
- Whole-batch failure on one undecodable `recent_fills` row (status quo; r2 rejected per-row decode as YAGNI) —
  reversed in r3 because a corrupt row is persistent, so every offline account of that user would stay degraded until
  rewritten, and retry does not heal it (design.md@1ed63958:208-209; old context.md@1ed63958:261, :278).
- Presence-only marker (absent `realized_pnl`) — ambiguous with a brand-new offline account that has no state row
  (AC-52 @feature-240) (design.md@1ed63958:219-220).
- Omitting degraded offline accounts from all-accounts ListPortfolios — the combined total would look complete,
  violating @AC-30 @feature-240 (design.md@1ed63958:221-222).
- Recomputing Day P&L without fills and keeping it as the degraded value — wrong but complete-looking: offline Day P&L is
  built from `RecentFills`, so symbols traded today are valued as held all session and sold-out symbols vanish. Hence the
  degraded account zeroes DayPnl/DayPnlPct (account and embedded positions) and the aggregate excludes them
  (old context.md@1ed63958:147-148, :260).
- A pure count bound (about 20 s at 2 s sleep) — parks during ordinary DB failovers and recreates D-47
  (old context.md@1ed63958:262).
- Parking only on deterministic errors and retrying everything else unboundedly (adversary's pure form) — pgx error
  classification is fragile; the variant that keeps the count-AND-time bound as the unclassified fallback means a
  misclassification never fast-parks and never stalls forever (design.md@1ed63958:212-213;
  old context.md@1ed63958:263, :482).
- Per-account / per-stream_key park with a later sweep — new durable state outside an in-memory wrapper (YAGNI)
  (design.md@1ed63958:214).
- Retry bound inside `consumeEventStream` — edits feature 248's `:185-202` region and pulls `order.filled` into scope;
  wrapper keyed by `event.Sequence` instead (design.md@1ed63958:223-224).
- Transactional outbox for `account.positions.synced` — the root fix for D-63 but needs a migration plus relay worker,
  outside "no migrations" Fix Scope. Kept as the long-term option (design.md@1ed63958:215-216, :67-68).
- Changing `emitLedgerEvent`'s signature — 26 other callers (fails.md "shared helper signature" entry); sibling
  `appendLedgerEvent` plus a void wrapper won (design.md@1ed63958:225).
- In-lock emit retry that re-takes `confirmLock` — `confirmLock` is non-reentrant (fails.md "163 confirmLock"); the retry
  lives inside `appendLedgerEvent` under the lock already held (design.md@1ed63958:63-64, :226). The history (r2 rejected
  the whole retry, r3 adopted a helper-internal one as an "r4 SHOULD") is in old context.md@1ed63958:140, :266, :345.
- A fresh `context.Background()` for request-derived emits and recompute writes — standing operator rule (C-03, 2026-10-21):
  request-derived emits use `context.WithoutCancel(ctx)` to keep trace propagation, "never a fresh background context.
  No C-03 waiver" (design.md@1ed63958:24-25; old context.md@1ed63958:140, r2 item 2).
- Deregistration option (b), an offline-set lookup before retrying `account.deregistered` — it "would add an offline-set
  query that can itself fail" (old context.md@1ed63958:615-616).
- Early return on the first offline upsert error — worse than today if the event is parked (skips
  `DeletePositionsNotInSync` and `UpsertOfflineRealized`); try-all plus `errors.Join` instead. Safe because
  `DeletePositionsNotInSync` keys on the sync's symbol set, not on rows written (design.md@1ed63958:227;
  old context.md@1ed63958:155, :267).
- Bare `context.WithoutCancel` for the recompute — leaves queries under `confirmLock` unbounded; wrapped in
  `WithTimeout` (design.md@1ed63958:228-229).
- A reason enum for the marker — one reason exists (YAGNI, C-04); bool plus field comment (design.md@1ed63958:230).
- A combined "finite and non-negative" helper — Snapshot legitimately accepts qty 0 and negative qty
  (@AC-8/@AC-15 @feature-163) (design.md@1ed63958:231-232).

**Scars & gotchas**:
- The product spec cited the swallow at `trading.go:951-954` but recon found a deeper one: `emitLedgerEvent` is void and
  drops both the `structpb.NewStruct` error and the `AppendEvent` error, and `recomputeAndEmitOfflinePositions` ended
  in an unconditional `return nil`. Fixing only the call site would have left D-63 open whenever the ledger is down
  (recon.md@1ed63958:270-275).
- The surveyor scan's wording said the fill consumer's retry is "bounded-retry/park". It is not: `consumeEventStream`
  retries forever with a 2 s sleep and no counter (recon.md@1ed63958:241-242). The product spec was right ("The fill path
  has no such bound today, so design must add one", product-spec.md@1ed63958:22-23); the wrong wording was the scan's and
  was caught at triage (old context.md@1ed63958:42-45), so it never steered design. FR-3 was net-new design.
- Making `emitLedgerEvent` a void wrapper over a retrying `appendLedgerEvent` silently changes the 26 other callers
  (one `Unavailable` retry, worst case 10 s to 20.1 s per emit) and made `NewStruct` failures skip the append instead
  of appending an empty payload. Spotted at impl-spec review; operator accepted "retry for all callers" 2026-10-22 and
  Option A on 2026-10-29, which also rewrote feature 210's one-shot test
  `TestEmitLedgerEventFailSoftOneShot` to `TestEmitLedgerEventFailSoftBoundedRetry` (old context.md@1ed63958:691-693,
  :702-703, :794-797; implementation-spec.md@1ed63958:1060-1063, :1090-1094).
- `NewStruct` rejection exposed `order_intent.reclaimed_unknown` (a `time.Time` in the payload) — it had been appended
  with an empty payload and was now skipped with a Warn (old context.md@1ed63958:810-812). Feature 267 independently
  found the same defect and fixed it (`order_intent.go:137-141`, RFC3339Nano string); resolved in the archive-time tree, nothing to do.
- `DeleteOfflineRealized` used `r.pool.Exec` (not `r.db`), so a pgxmock-backed repo nil-panics; Step 7 moved it onto
  `r.db` (same pool in prod) so the AC-2 retry is testable (old context.md@1ed63958:601-602, :861).
- `recordingLedger` could not fail; a `failFn` hook plus a mutex-guarded `setFailFn` was added. `warnRecorder` had to
  record Error as well as Warn to see the `"event parked"` log (old context.md@1ed63958:605, :828-829, :865).
- `TestAccountPnL_OfflineStatesErrorIsNonFatal` asserted the superseded 240 behavior and was rewritten as the AC-3
  marker test (old context.md@1ed63958:603-604, :912).
- `ConfirmOrder` bad-value ordering: the new pre-load guard returns INVALID_ARGUMENT for a bad value on a broker order
  where FailedPrecondition came before (AC-9 @feature-157); the order is unchanged either way (design.md@1ed63958:37-38).
- `filled_qty 0` skips the price check (un-confirm / bare re-confirm, AC-48 @feature-240); promoted as `@AC-10`
  (old context.md@1ed63958:64-66, :596-597).
- The proto-gen host trap: host `protoc-gen-go` built with go1.24.7 produced comment-only drift in
  `gen/go/analysis/v1/analysis.pb.go`; rebuilding the pinned plugins under go1.27.0 removed it. Host `golangci-lint`
  v2.14.0 (go1.26) refused the `go 1.27.0` module and was rebuilt under `GOTOOLCHAIN=go1.27.0`
  (implementation-spec.md@1ed63958:1075-1082; :1071-1074 is the separate gap that `buf-gen.sh` also regenerated unlisted
  ts-proto `portfolio/v1` outputs).
- `buf breaking --against .git#branch=...` cannot resolve from an isolated worktree, so Step 1 used `git archive`
  snapshots of `origin/feature/...` and `origin/main-dev`; the main-dev check also passed without CI's
  `--exclude-path trading/v1/trading.proto` (implementation-spec.md@1ed63958:1067-1070; old context.md@1ed63958:737).
- Steps 13+14: the host `pnpm dev` Playwright harness timed out in the 10 s warmup project; the run used `CI=1` with
  `--retries=0` (implementation-spec.md@1ed63958:1178-1180).
- UI: `OrderBook.tsx` `PortfolioSummary` is gated but mounted by no route (still true in the archive-time tree: only its definition
  matches `grep PortfolioSummary`), so it is covered by `tsc`/lint only — its e2e case was dropped by operator
  decision "A: Gate it, drop e2e" (old context.md@1ed63958:935-937). The design.md@1ed63958:159-169 C-14 rule of one
  Playwright assertion per gated surface therefore has this one exception.
- `AccountPortfolioSelector.tsx` (insights segment) was a latent marker consumer outside `/trader`, found only by the
  spec-time consumer grep (old context.md@1ed63958:609-610).
- Total P/L cells on `/trader/positions` still show `unrealizedPnl` and are deliberately not gated: the backend does not
  zero it (implementation-spec.md@1ed63958:1175-1176).
- A pre-existing `tsc --noEmit` error pair at `e2e/insights/backfills.spec.ts:135-136` was reported as outside this
  feature (old context.md@1ed63958:949); not re-verified in the archive-time tree.
- Teardown note: the context-forge refresh plugin was not available to the execute subagent; manual reconciliation of the
  three touched CLAUDE.md/constitution files was done instead (old context.md@1ed63958:974-975). Unverified whether the
  PR body recorded it.

**Spec-time resolutions** (open fork or deferred value filled in, not a reversal of the design):
- Broker-deregistration scope was left open at design — (a) record as extension or (b) offline-set lookup
  (design.md@1ed63958:103-106) — and resolved to (a): the `account.deregistered` retry covers broker accounts too, because
  the payload carries no account type and both deletes are idempotent; operator sign-off 2026-10-22
  (old context.md@1ed63958:613-617, :700-701).
- `recomputeTimeout` was deferred to /sdd-spec (design.md@1ed63958:57-59) and fixed there:
  `offlineRecomputeTimeout = 30s`, `offlineRecomputeQueryBudget = 5s`; rule 30 s > 2 x 10 s + 0.1 s + 5 s, asserted by
  `TestOfflineRecomputeTimeout_CoversRetryBudget` (`trading.go:3752-3757`; old context.md@1ed63958:618-619).

**Permanent deviations**:
- Product spec said UNAVAILABLE "is preferred" and needs no proto change (product-spec.md@1ed63958:113-117) -> shipped
  wire-visible per-entity markers on Portfolio (17) and Position (26), reads succeed -> because whole-call UNAVAILABLE
  hides broker cards and breaks standing @AC-14/@AC-3 @feature-157 (operator gate r3, 2026-10-22).
- Design said the other 26 `emitLedgerEvent` callers are "untouched" (design.md@1ed63958:47-48) and the retry lives
  "only" in `appendLedgerEvent` (design.md@1ed63958:60-61) -> shipped: because the wrapper calls the helper, all 27
  callers get one `Unavailable` retry (constants `appendMaxAttempts=2`, `appendRetryBackoff=100ms`,
  `trading.go:3752-3753`) and a payload `NewStruct` rejects is now skipped with a Warn -> because the operator chose
  retry for all callers over a no-retry path (old context.md@1ed63958:702-703, :794-797). Supersedes feature 210's
  one-shot note for `emitLedgerEvent`.
- Implementation spec / sequential mode said one commit per step (not a design.md claim); shipped four merged commits: Steps 7+8, 9+10, 11+12, 13+14, because the service
  step could not compile or lint green without the next step's call-site/test updates. Operator decisions "B: merge
  Steps 7+8" then the standing rule "Merge pairs + standing rule" (old context.md@1ed63958:848-850, :875-876, :897-898,
  :935-936; implementation-spec.md@1ed63958:1114-1119, :1130-1136).
- Product spec FR-4/AC-3 was a disjunction ("UNAVAILABLE or degraded marker"; design.md@1ed63958:273-274 promised the
  tightening); tightened at /sdd-spec to
  the marker outcome, and `@AC-8`, `@AC-9`, `@AC-10` were added (IDs append-only) (old context.md@1ed63958:594-597).
  `acceptance.feature` is kept; its scenarios are already promoted verbatim (C-16).
- Debate r2 (design-state JSON, not final design.md) said `useConfirmOrder` should invalidate `['orders']`/`['order', id]`
  on settle so the list is not stale after an FR-6 UNAVAILABLE (old context.md@1ed63958:140) -> shipped
  unchanged: invalidation is success-only (`useConfirmOrder.ts`, comment "invalidates ... on success") -> because
  `useInvalidatingMutation` has no `onSettled` option and adding one was rejected under C-18 YAGNI
  (old context.md@1ed63958:626-627; design.md@1ed63958:258-259 recorded it as an accepted UX gap). Gap still open in the archive-time tree.
- Debate r2 (old context.md@1ed63958:140) listed `positions/[symbol]/page.tsx` as "no change" (reads only
  equity/buyingPower); final design.md §5 did not mention it. Shipped gates its header and both Day P&L tiles
  (old context.md@1ed63958:943). Inference for the reason: the Position marker added in r3 reaches that page.

**Cross-feature signal**:
- Feature 240 is the origin of every site; its "a `GetOfflineStates` error is non-fatal (WARN, empty map)" decision
  (`240-offline-account-full-pnl/context.md:399`, `:771`) is explicitly superseded here (old context.md@1ed63958:550-552). Not a C-16 CHANGE: the 240 rule was a recorded context decision, not a durable `@AC-*` (old context.md@1ed63958:665-667; recon.md@1ed63958:219-221).
- 256's promoted rules extend @AC-9/@AC-14/@AC-15/@AC-30 @feature-240, @AC-14 @feature-163 and preserve @AC-14/@AC-3/@AC-10
  @feature-157 (design.md@1ed63958:283-321).
- Feature 267 (same triage batch, `trading.go` order-state audit) found and fixed the `reclaimed_unknown`
  `time.Time` / `structpb.NewStruct` defect at its r3 design gate on 2026-10-21 (267 context.md:256, :403; fails.md
  2026-10-21 entry, `:3064-3065`). 256 hit the same payload independently at Step 5 on 2026-10-29
  (old context.md@1ed63958:810-812), where its change turned a nil-payload append into a skipped append. 267 had rejected
  "fix serialization generically inside emitLedgerEvent (log the NewStruct error)" as touching a shared hot helper (267
  context.md:404); 256 then made exactly that change: a `NewStruct` failure now Warns and skips the append.
- Feature 259 independently reached the same SQLSTATE 22/23 positive-poison park rule for a Python stream consumer
  (fails.md:3059-3062).
- Four of eight service-then-test step pairs in this feature had to be merged (see Permanent deviations): a signature or
  return-shape change in a service step breaks existing tests that only the next step touches. Written to the Ledger.
- Feature 248 owns `consumeEventStream` (`portfolio_service.go:185-202` at design time); the park wrapper was designed
  to stay out of it. 242/248 (`portfolio_service.go`), 241/249/267 (`trading.go`), 250 (`portfolio.proto` line cite only)
  were rebase-only overlaps (old context.md@1ed63958:676-680).

**Deferred follow-ons**:
- Dev-smoke gate in the implementation spec was not recorded as run: (1) the read-only NaN detection over confirmed
  offline orders (`broker_type = 3 AND (filled_qty = 'NaN'::numeric OR filled_avg_price = 'NaN'::numeric)`, via
  `docs/runbooks/operator-db-access.md`) with re-confirm of any hits, and (2) a count of `"event parked"` lines after the
  first deploy's boot replay (implementation-spec.md@1ed63958:1044-1052). The recorded staging smoke
  (old context.md@1ed63958:1126-1139) covered D-49 INVALID_ARGUMENT, healthy reads and absence of ERROR lines only.
  Pre-existing NaN/Inf confirmed rows would keep emitting NaN positions until re-confirmed. A NaN fill cannot be sent
  through MCP (JSON number) or the UI (`type="number" min="0"` inputs), so D-49 NaN is reachable only through direct gRPC
  and stays covered by Step 4 unit tests (old context.md@1ed63958:1133; recon.md@1ed63958:107, :268-269). Written to the
  Ledger as a fails entry (see below).
- Open follow-on: the staging smoke showed the agent error mapping does not surface the status text. `manage_offline_account
  confirm_order` returned a bare `Error executing tool`; `INVALID_ARGUMENT` appeared only in the agent run logs
  (old context.md@1ed63958:1129-1133). This contradicts Step 15's unit-tested claim that details "surface verbatim through
  the real client wrapper and the tool's error mapping" (old context.md@1ed63958:958-960). Unit-tested pass-through versus
  live tool behaviour is unreconciled.
- Deferred by the product spec: the first offline snapshot's `FOR UPDATE` locking and instance-count question
  (debt-radar NC-H, unconfirmed; product-spec.md@1ed63958:133).
- D-48 degraded path was not exercised on staging (no way to make `GetOfflineStates` fail); covered only by unit tests
  (old context.md@1ed63958:1138-1139).
- A park is an Error log only, with no metric or alert (accepted for SEV-2); documented in portfolio PORTFOLIO-3 / -11
  and the `ConsumePositionSyncs` row of `services/xstockstrat-portfolio/CLAUDE.md`.
- Each restart replays the stream from seq 0, re-attempting every historically parked deterministic event (up to 5 x 2 s
  each) and, for unclassified errors, up to 10 min of head-of-line blocking of broker syncs (design.md@1ed63958:244-247; the 10 min figure is from old context.md@1ed63958:275-276, fallback bound design.md@1ed63958:92).
- Transient DB outage head-of-line blocking is accepted (all writes fail anyway). SQLSTATE misclassification boundary
  (a class wrongly treated as transient never parks) is limited only by table tests (design.md@1ed63958:241-243).
- Latent marker consumers: any future Portfolio/Position reader that ignores `offline_state_unavailable` shows zeroed
  P&L as real $0; mitigated only by the proto field comments.
- Transactional outbox for `account.positions.synced` (root fix for D-63); needs a migration and relay worker.
- `useInvalidatingMutation` `onSettled` forwarding (orders list may be stale after an FR-6 UNAVAILABLE).
- Unscoped `ListPositions` was the case no @AC covered when UNAVAILABLE was considered; moot after Position marker 26.
- Defect report `docs/reports/2026-10-21-offline-book-consistency-defect.md` (pruned 2026-11-04; git show 9892b610:docs/reports/2026-10-21-offline-book-consistency-defect.md) has sidecar `triaged`
  (`ref: feature:256-fix-offline-book-consistency`); the feature is now `launched`, so `/sdd-archiver reports` can prune
  it. Its source scan `docs/repo-surveyor/debt-radar-findings.md` still lists D-47/D-48/D-49/D-63 and the
  `256-fix-offline-book-consistency` row (lines 62, 74, 136, 290, 583); not edited here.
- Stale `feature.md` "Next Action" still points at `/sdd-review ... impl-spec` (a pre-execute value); its Status History
  rows are out of date order around the `code-completed` row (2026-10-29 listed after 2026-10-30). Inference: cosmetic.

**Ledger entries written**: insights.md (2), fails.md (1) — see the 2026-11-04 entries. One further candidate was
already present as DUP (insights.md:3711, SQLSTATE-class-aware park). The unrecorded dev-smoke gate is a new fails entry,
not a DUP of fails.md:641 (that entry is SEV-1 auto-promotion with an unrun smoke AC; here the item was a design Open Risk
with a "re-confirm before launch" data-remediation gate in the implementation spec, SEV-2).

**Runtime-invariant recommendations (→ /context-constitution)**:
- TRADING-*: `emitLedgerEvent` is a void wrapper over `appendLedgerEvent` and retries once on `codes.Unavailable` under
  one idempotency key for all 27 callers (worst case about 20.1 s per emit); only the offline `recomputeAndEmitOfflinePositions`
  propagates the append error. Not found in `services/xstockstrat-trading/CLAUDE.md` or its `docs/` in the archive-time tree
  (grep for `appendLedgerEvent`/`bounded retry`).
- TRADING-*: `ConfirmOrder` offline recompute runs under `WithTimeout(WithoutCancel(ctx), offlineRecomputeTimeout)` and the
  constant must exceed `appendMaxAttempts*ledgerEmitTimeout + appendRetryBackoff + offlineRecomputeQueryBudget`
  (comment at `trading.go:3754-3756`; test-enforced).
- PORTFOLIO-*: marker semantics (a degraded offline account keeps market-value equity but zero P&L, aggregate forces
  `allOffline=false`) are already folded into PORTFOLIO-3/-11 in Step 16; no new candidate.

**Pruned artifacts**: product-spec.md, recon.md, design.md, implementation-spec.md — last present at 1ed63958.
