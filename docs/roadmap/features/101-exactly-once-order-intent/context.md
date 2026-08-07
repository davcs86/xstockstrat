# Context: exactly-once-order-intent

**Feature**: `docs/roadmap/features/101-exactly-once-order-intent/feature.md`
**Product Spec**: `docs/roadmap/features/101-exactly-once-order-intent/product-spec.md`
**Implementation Spec**: `docs/roadmap/features/101-exactly-once-order-intent/implementation-spec.md`

---

## Session 2026-08-04T00:00:00Z — sdd-story

- Created feature.md (status: draft), product-spec.md, context.md from an external live-capital
  safety risk review. P0 item 4 ("idempotent order-command model").
- No upstream dependency — per the review's suggested execution order this can start alongside 100.
  It is itself a hard dependency for 102 (broker-state-reconciliation resolves `UNKNOWN` intents),
  105 (trading-crash-consistency tests this model's restart behavior), and 107 (canary promotion
  evidence requires "zero duplicate intents").

## Session 2026-08-04T01:00:00Z — feasibility re-check (rescoped, not demoted)

- Feasibility re-check confirmed the only real caller of `TradingService.PlaceOrder` is the trader UI
  (`services/xstockstrat-ui/src/lib/traderBff.ts:28`) — no scheduler, agent tool, or internal RPC
  places orders today. Kept this feature (unlike its downstream dependents 102/104/105/107, all
  demoted) because a redeploy mid-request is a real risk on this single-instance topology even for a
  human-initiated order — but rewrote `product-spec.md` to scope FR-1 to place/replace/cancel only
  (the commands with a real caller), dropped close/emergency-flatten as first-class command types, and
  replaced automated `UNKNOWN`-reconciliation (which depended on the now-demoted 102) with a manual
  "block further auto-retry, operator checks the broker dashboard" gate.

## Session 2026-08-05T00:00:00Z — sdd-review product-spec (3 rounds)

- Round 1 FAIL: missing DB migration numbering/run-order detail (C-07), no explicit statement of how
  the new `UNKNOWN` intent state interacts with `ORDER_STATUS_PARTIALLY_FILLED`/`FILLED` (C-5), two
  unresolved Open Questions. Fixed: added migration `005_order_intents` (next after `004`), added an
  explicit "Interaction with the existing order-status lifecycle" section stating fill handling is
  unaffected, resolved the client-side-identifier Open Question by grep (no existing generator —
  this is the platform's first).
- Round 2 FAIL: the remaining two Open Questions were reframed with "Decide at /sdd-design" language
  but left as literal unchecked items; one (which `BrokerType` values are in scope) is a genuine C-2
  trading-domain gate, not an implementation detail. Fixed: resolved and checked both (both `ALPACA`
  and `IBKR` in scope; paper/live behavior identical since `is_paper` is account-level) — only the
  client-order-id derivation *algorithm* itself stays deferred to `/sdd-design`, in an un-checkboxed
  "implementation detail" list per the `055-orders-management-ui` precedent.
- Round 3: **PASS WITH WARNINGS** (2 advisory warnings: qualitative ACs, a minor phasing-precedent
  note on the `055` comparison). Status: `draft` → `spec-ready`.
- Warnings carried forward (advisory, not blocking): xstockstrat-ui/orders-view file-level overlap
  with feature 096 to re-check at impl-spec (from the overlap scan, non-blocking); AC-1..AC-4 are
  qualitative correctness statements rather than quantitative thresholds.

## Session 2026-08-06T00:00:00Z — sdd-design (full mode, in progress)

- Phase 0 Recon: wrote `recon.md` (services: trading, ui). Confirmed zero idempotency layer exists
  today (a retry mints a fresh UUID and resubmits); confirmed timeout and genuine rejection are
  currently conflated (`ORDER_STATUS_REJECTED` either way); confirmed IBKR's broker client sends no
  client-order-id at all (platform-side dedup is the *only* dedup mechanism for IBKR, not a backstop);
  confirmed no insert-or-return-existing persistence pattern and no `ErrNotFound`-style sentinel exist
  anywhere in this service. Found a real migration-number collision with feature 030 (both want `005`
  in the shared `xstockstrat-trading/migrations/` dir) and confirmed `merge-order.md` had no
  pre-assignment row for it.
- Fixed the migration collision directly (not deferred to the design debate): added a `merge-order.md`
  pre-assignment row following the existing 058/059/062 precedent — 030 → `005_broker_accounts_halted`,
  101 → `006_order_intents` (committed separately from the design debate).
- Round 1: proposer's approach — new `order_intents` table, unique-constraint + in-process keyed-mutex
  concurrency, orthogonal `IntentState` field (not `ORDER_STATUS_UNKNOWN`) on `Order`, migration `006`.
  Adversary found no Floor breach, but two severe objections: (1) **C-14** — FR-1/FR-2's core dedup
  guarantee for `PlaceOrder` has no defined mechanism without the trader UI generating and reusing a
  client-side nonce across retries, which was outside the original product-spec's Consumer Surface(s);
  (2) **P-03** — the in-process mutex's sole justification ("`instance_count: 1` → no cross-instance
  coordination needed") is unverified against DO App Platform's actual rolling-deploy mechanics, and is
  likely false exactly during a redeploy — the failure window this feature exists to protect. Also
  found the UI fix names only 1 of 5 real call sites needing updates, `isWorking()` never cross-checks
  the new orthogonal intent state, `CancelOrder`'s existing fail-open path doesn't specify a resulting
  intent state, no eviction on the mutex map, and no optimistic-concurrency guard on terminal-state
  writes.
- **User directive**: "expand UI scope" — resolves objection (1). `product-spec.md`'s Consumer
  Surface(s) (C-14) amended to add the Place Order flow's client-nonce generation/reuse as a named,
  user-approved scope expansion (not a silent one); FR-1 updated to state the per-command-type intent-ID
  derivation split (client-nonce-seeded for Place, server-derived for Replace/Cancel).
- Round 2: replaced the in-process mutex entirely with pure DB-only concurrency — `INSERT ... ON
  CONFLICT (intent_id) DO NOTHING RETURNING *`, staleness-gated reclaim (`UPDATE ... WHERE
  state='pending' AND updated_at < threshold`), optimistic-CAS terminal write. Verified: no fact in
  this repo confirms or refutes DO App Platform's rolling-deploy overlap behavior, so the design
  removes the dependency on that fact entirely rather than defending the mutex on an unverified claim.
  Adversary confirmed the Postgres row-lock mechanism is real (`EvalPlanQual` re-evaluation under READ
  COMMITTED) but found: `CancelOrder`'s `UNKNOWN` intent was recorded but never wired into the UI
  (reopening FR-4's hidden-ambiguity problem on the cancel path); no precedence rule existed for which
  intent's state wins when an order has multiple intents; the global `stale_pending_seconds` threshold
  was coupled to a *live*, operator-adjustable config key (`trading.broker.timeout_ms`) with no
  protection against drift; a 3rd un-specced "still processing" rejection code was added without
  updating Consumer Surface(s); mandatory `client_order_id` would break 2 test files (one silently,
  via a false-positive grep match on the maintenance-mode negative test); migration/config doc prose
  was stale.
- **User directive**: "run round 3" (default continuation after a NEEDS WORK verdict).
- Round 3: added an explicit no-transaction-spans-the-broker-call invariant; added `order_id` +
  `LEFT JOIN LATERAL` cross-intent precedence ("latest `updated_at` across all intents for this
  `order_id` wins") to `GetOrder`/`ListOrders`, structurally wiring `CancelOrder`'s `UNKNOWN` into the
  UI; derived the staleness threshold live from `trading.broker.timeout_ms` (floor-clamped multiplier
  ≥1.5) instead of a static default, closing the drift risk; collapsed the 3rd rejection code into the
  uniform `FailedPrecondition` path; fixed the 2 broken test files + `api-smoke.spec.ts` in the same
  PR; corrected the stale migration/config prose. Adversary found the staleness reclaim only fires as a
  *side effect of a retry* — an unretried crash leaves a `PENDING` intent stuck forever, silently
  defeating FR-4 for exactly the unattended-crash scenario product-spec's own Problem Statement names.
- Round 4: added `StartOrderIntentSweeper` (mirrors `StartFillPoller`'s ticker+`ctx.Done()` shape) to
  proactively reclaim stale `PENDING` intents independent of any retry; write-handlers now set
  `IntentState` on their own returned `Order` (not only via a later `GetOrder`); narrowed the
  transaction-boundary rule to "never spans the broker call" (not "never at all"), permitting the
  intent-insert + provisional order-row insert to share one short transaction, closing an orphaned-
  intent crash window; deduped the IBKR-timeout literal into one named constant; documented the
  stream/poll `IntentState` eventual-consistency caveat. Adversary found the `sweep_interval_ms`
  default (30000ms) was described as "well under" the threshold floor (15000ms) while actually being
  double it; the sweep's batch SQL was never concretely written out; sweep-driven transitions had no
  ledger audit trail unlike every other transition in this service; the bundled-transaction branch and
  a late-broker-response-vs-sweep race were left implicit.
- **User directive**: "run round 5 (final)" (5-round default cap).
- Round 5: fixed the interval-arithmetic error (default corrected to 5000ms, matching
  `trading.fill_poller.interval_ms`'s existing precedent); wrote the concrete select-then-loop sweep
  SQL (SELECT up to 100 stale ids, loop the reactive path's exact single-row reclaim statement);
  answered the late-broker-response race explicitly (accepted limitation — the real response lives only
  in the `order_intent.late_response_conflict` ledger event until demoted-102 lands, per FR-5's own
  deferral); stated the bundled-transaction branch explicitly (order-row insert only on the intent-
  insert's "row returned" branch); confirmed sweep visibility is poll-only, justified against the UI's
  existing 5s `refetchInterval`. Final adversary verdict: **APPROVE (with documented Open Risks)** — no
  Floor breach — but flagged 2 new gaps: no index/retention strategy for `order_intents`, and a ledger-
  audit asymmetry (only the sweep's reclaim was specified to emit an event, not the reactive path's own
  identical reclaim).
- **User directive**: "override gate to 7 rounds" — extends the debate past the default 5-round cap
  (permitted per the design skill's hard constraints: the user may always opt into more rounds).
- Round 6: added a partial index (`ON order_intents (updated_at) WHERE state=<PENDING>`, matching the
  sweep's exact query predicate) to migration `006`; stated a resolved no-retention-needed position
  (later reframed, see round 7); renamed the sweep's ledger event to an actor-neutral
  `order_intent.reclaimed_unknown` (trigger: reactive/sweep payload field) emitted from *both* the
  reactive and sweep reclaim paths, closing the audit asymmetry; confirmed `order_intents.state` is a
  `SMALLINT` mapped to a proto enum (not a raw string), per this service's `credential_status`
  convention. Adversary found this confirmation exposed a real bug: every SQL fragment across rounds
  1-6 used string literals (`'pending'`) against what's now confirmed to be a `SMALLINT` column — this
  would fail at migration-apply/query-parse time, not just be cosmetic shorthand. Also found the
  "no retention needed" position rested on an ungrounded volume estimate ("thousands-per-year") that
  appears nowhere in product-spec.md or recon.md.
- Round 7 (final, extended cap): restated every SQL fragment using named integer constants
  (`IntentStatePending=1` etc., mirroring migration `004`'s enum-mapping-comment convention) instead of
  string literals, with `state` set explicitly on every INSERT rather than relying on the column
  `DEFAULT`; reframed retention as an explicit bounded v1 decision with a stated revisit trigger
  (~500,000 rows) and a named remediation path (hypertable conversion, noting the composite-PK
  requirement). Final adversary pass found one more genuinely new, purely mechanical gap: `PlaceOrder`'s
  intent row would leave `order_id` `NULL` until the terminal write, but `PlaceOrder` already eagerly
  creates a visible `trading.orders` row *before* the broker call — so a crash-then-sweep-reclaimed
  `PlaceOrder` intent could never join back to its already-visible order via the LATERAL join, silently
  defeating FR-4 for the feature's own centermost scenario. The adversary explicitly characterized this
  as "a one-line, mechanical change" needing no further round; the orchestrator applied the fix directly
  in `design.md` (populate `order_id` at insert time for all command types, including `PlaceOrder`,
  reusing the `orderID` already minted before the broker call) rather than spawning an 8th round,
  consistent with the synthesizer's mediation role once no further genuine disagreement remained.
- Chosen approach: `trading.order_intents` table (migration `006_order_intents`), pure DB-only
  concurrency (`INSERT ... ON CONFLICT DO NOTHING RETURNING` + staleness-gated reclaim + optimistic-CAS
  terminal write, no in-process mutex), orthogonal `IntentState` field on `Order` (not
  `ORDER_STATUS_UNKNOWN`), `order_id`-keyed `LEFT JOIN LATERAL` cross-intent precedence, staleness
  threshold derived live from the broker timeout with a floor-clamped multiplier, a proactive sweep
  goroutine mirroring `StartFillPoller`'s shape for the unattended-crash case, a client-nonce-seeded
  `PlaceOrder` intent ID (Consumer Surface(s) expanded, user-approved) with server-derived
  Replace/Cancel intent IDs, uniform `codes.FailedPrecondition` rejection, and a two-event ledger
  audit taxonomy (`order_intent.reclaimed_unknown` / `order_intent.late_response_conflict`). Rejected:
  in-process mutex, `ORDER_STATUS_UNKNOWN` on the existing enum, content-hash Place intent IDs, a 3rd
  rejection code, a single unified ledger event, day-one hypertable conversion, and a blind-overwrite
  terminal write.
- Constitution rules touched: C-01, C-04, C-05, C-07, C-08, C-10(a), C-10(b), C-11, C-14, P-01, P-02,
  P-03, P-04, F-11 (all honored — see design.md § Constitution Rules Touched). No Floor breach across
  any of the 7 rounds.
- Status: `spec-ready` → `design-approved`.

## Session 2026-08-06T02:00:00Z — sdd-spec

- Generated implementation-spec.md with 20 steps. Status → implementation-ready.
- Key codebase findings (discovery beyond what recon.md/design.md already covered):
  - **New gap found and fixed in-spec**: `resolveAccount` (`internal/service/trading.go:188-209`)
    discards the resolved account ID on its single-registered-account fallback path (the
    `len(s.brokers) == 1` loop never captures the map key), so `order.AccountId` — and therefore this
    feature's `order_intents.broker_account_id` (`NOT NULL`) — could be empty on that path even though
    a real account was used. Step 11 changes `resolveAccount`'s signature to also return the resolved
    ID, mirroring `AccountRepository`'s existing interface-based DI shape for the new
    `OrderIntentRepository` (also introduced in Step 11/Step 7).
  - Confirmed via grep: **`internal/repository` has zero existing `*_test.go` files** and no DB-mocking
    library (`pgxmock`/`sqlmock`/`testcontainers`) exists anywhere in this Go monorepo — there is no
    in-repo precedent for a DB-backed unit test at the repository layer. Combined with the coverage
    formula's package exclusion (`cmd|handler|repository|telemetry|service` —
    `.claude/skills/sdd-spec/reference/spec-template.md`), the spec routes the real behavioral proof of
    the insert-or-return-existing dedup mechanism through a fully unit-tested pure decision function
    (`classifyIntentLookup`, Step 9/10, zero DB dependency, mirrors `alpacaStatusToProto`'s existing
    shape) plus a new `scripts/integration-test.sh` section (Step 16) exercising the real RPCs.
  - Confirmed via `TestSubmitOrder_TrailingStopAndClientOrderID` (`internal/broker/alpaca_test.go:137`):
    Alpaca's client-order-id plumbing already exists and needs no change; only IBKR
    (`internal/broker/ibkr.go:116-169`) needs new plumbing. The exact IBKR JSON field name (`cOID`,
    IBKR's Client Portal Web API field) is written into Step 5 as the best-available candidate but
    flagged explicitly as **unverified against this repo** — design.md's Open Risk #1 is carried
    forward as an execute-time verification requirement, not silently assumed.
  - Confirmed via full read of `PlaceOrder`'s broker-error branch (`trading.go:343-352`): the fix for
    FR-4's "timeout, never FAILED" is a genuine behavior change (detect `context.DeadlineExceeded`/
    `net.Error.Timeout()` and leave `order.Status` untouched + intent `PENDING` for reclaim, instead of
    the current unconditional `order.Status = ORDER_STATUS_REJECTED` on **any** broker-call error) —
    written out precisely in Step 12 Instruction 6 since design.md specified the architecture
    (orthogonal `IntentState`) but not this exact branch-level code change.
  - Confirmed via grep: zero hits for `clientOrderId`/`client_order_id` anywhere under
    `services/xstockstrat-ui/src` or `e2e` — Step 19's Place Order nonce is genuinely new code with no
    existing pattern to reuse, and `traderBff.ts`'s `placeOrder` (`:28-34`) already spreads `{ ...req
    }` unmodified, so no BFF change is required to carry it through.
  - `services/xstockstrat-trading/migrations/`: confirmed highest file on disk is still
    `004_broker_accounts_credential_status` — `005_broker_accounts_halted` (feature `030`) has not
    landed yet, so Step 3 is blocked until it does (per `merge-order.md`'s pre-assignment); Step 3's
    Instructions re-state the C-07 `ls`-before-write requirement explicitly.

## Session 2026-08-06T03:00:00Z — sdd-review impl-spec (advisory)

- Result: 2 FAIL-level findings, 3 warnings (advisory — did not block; no Floor `F-*` risk found).
  60+ `path:line` citations spot-checked, nearly all accurate.
- Overlap scan: **real same-function collision found** with `100-account-trading-halt-and-kill-switch`
  (both `implementation-ready`). Both specs insert new logic into the identical `PlaceOrder`,
  `ReplaceOrder`, `CancelOrder`, and `resolveAccount` bodies in
  `services/xstockstrat-trading/internal/service/trading.go` at overlapping/adjacent insertion
  points — a manual-merge risk, not a disjoint textual rebase. Recorded a new blocking row in
  `docs/roadmap/features/merge-order.md` (101 blocked on 100, consistent with this program's
  100→101 build order). No migration/proto/config-key collisions — `006_order_intents`,
  `Order.intent_state=21`, and both new config keys confirmed unique against trunk and all
  in-flight features. Also flagged (not this feature's to fix): `096-position-and-order-detail-pages`'s
  `feature.md` is stale (`implementation-ready`) — its code is already merged to trunk.
- Unresolved ✗ / ⚠ carried into execution:
  - Step 7: Evidence claims `GetOrder` returns `(nil, nil)` on not-found and that `GetIntentByID`
    "follows the same idiom" — actually `GetOrder` (`trading_repo.go:82-95`) returns
    `(nil, pgx.ErrNoRows)` on not-found, never special-cased. `GetIntentByID`'s actual not-found
    contract should be decided deliberately at execute time, not by this false analogy (**C-01**). — [ ] unaddressed
  - Step 11: `resolveAccount`'s single-account-fallback bug fix (a real behavior change, per the
    step's own TDD note) has no paired test step anywhere in the spec — Verification is only
    `go build` + lint, and no later step's Step Dependencies claims it. Add a test step or fold
    coverage into Step 15 (**C-08**/**P-06**). — [ ] unaddressed
  - Step 2: `**Files**` uses wildcards for generated proto stubs rather than exact paths — minor,
    defensible for codegen-output steps. — [ ] unaddressed
  - Step 11: minor param-position description ("6th, after `repo *repository.TradingRepo`") doesn't
    cleanly reconcile with the current 5-param signature — low-impact. — [ ] unaddressed
  - Step 16: `integration-test.sh` Verification is a `grep` sanity check, not an executed pass/fail
    — self-disclosed as never CI-wired, not overclaimed. — [ ] unaddressed
- Overlap findings: same-function collision with `100` (see above, now tracked in `merge-order.md`).

## Session 2026-08-07T00:00:00Z — sdd-execute (sequential mode)

**Multi-feature program note**: executing as part of the sequence `100 → 101 → 023 → 030 → 102`.
Per explicit user direction, using a **stacked-branch PR strategy**: `feature/exactly-once-order-intent`
branches from `feature/account-trading-halt-and-kill-switch` (feature 100's branch, not `main-dev`),
and this feature's integration PR will target `feature/account-trading-halt-and-kill-switch` instead
of `main-dev`. This satisfies the `merge-order.md` same-function-overlap dependency on 100 (101's
`PlaceOrder`/`ReplaceOrder`/`CancelOrder`/`resolveAccount` insertions must reconcile with 100's landed
`trading.go`) without waiting for 100's PR to actually merge — the code is present via the stack.

- Re-spec gate (§5.3): validated all 20 steps' Codebase Evidence via a `codebase-discovery` subagent
  against the live tree (feature 100 already merged into this branch's history). Findings:
  - Proto, migrations, broker, and repository layers: **CONFIRMED**, unaffected by feature 100.
  - Migration `006_order_intents`: confirmed `005_broker_accounts_halted` (feature 030) has **not**
    landed yet on this branch — Step 3 must wait (per the spec's own `## Step Dependencies` note and
    `merge-order.md`'s pre-assignment). Re-verify with a fresh `ls` immediately before Step 3.
  - `trading.go` **drifted substantially** from feature 100's insertions (line shifts +7 to +122
    throughout). Corrected line numbers captured per-step below as each step executes.
  - **Step 11's own "current" evidence for `resolveAccount` call sites was itself stale** for 2 of 3
    sites even before feature 100 (a pre-existing spec inaccuracy, not feature-100-caused) — the
    `CancelOrder`/`ReplaceOrder` call sites have shifted further due to feature 100's insertions.
  - **Real design ambiguity found and resolved** (not a mechanical drift): the spec's Step 12
    Instruction 4 says to insert the dedup `InsertIntent` "before building the provisional order
    struct" — but feature 100's `checkTradingStateForPlaceOrder`/`checkPortfolioRisk` gates now sit in
    that exact zone, and Step 12 Instruction 8 separately requires that an approval-required order
    (whose early-return happens **after** the struct build) gets **no** intent write at all. Taken
    literally, "insert before the struct build" would insert an intent for approval-required orders
    too, contradicting Instruction 8. **Resolution**: sequence execution as trailing-stop validation →
    mandatory `client_order_id` check → `resolveAccount` → feature-100's `trading_state` gate →
    `checkPortfolioRisk` → approval-threshold computation → `orderID` mint → **dedup `InsertIntent`,
    gated on `!requiresApproval`** → order-struct build → `UpsertOrder` → (if `requiresApproval`,
    return early with no intent touched; else proceed to the broker call using the already-owned
    intent). This satisfies both instructions: the insert still lands before the struct build, and the
    approval path never touches `order_intents`. Recorded here per the deviation-handling protocol
    (an in-scope-unresolvable gap resolved via Option A — fix now, no scope expansion needed, same
    step/file). Will apply when Step 12 executes.
  - Feature `096-position-and-order-detail-pages`'s code changes to `orderShared.tsx`/`orders.ts`/
    `mock-backend.ts` have **already landed** in this tree despite its own `feature.md` still reading
    `implementation-ready` — no rebase needed (code is present), but flagging the stale status field
    for a future `/sdd-sync` pass (not this feature's file to fix).
- **IBKR Open Risk #1 resolved via live web search** (design.md flagged the `cOID` field name as
  unconfirmed): confirmed via interactivebrokers.com's own IBKR Campus/Quant Blog docs that `cOID`
  (Customer Order ID) is indeed the correct Client Portal Web API field — an arbitrary string, unique
  per 24h. No definitive max-length found in public docs; `"xss-"+UUID` (~40 chars) proceeds as
  designed, flagged in the eventual PR as conservatively within typical limits but not exhaustively
  confirmed against an undocumented ceiling.
- Branch setup: `feature/exactly-once-order-intent` created fresh from
  `feature/account-trading-halt-and-kill-switch` (did not exist on origin before this session).
- Tooling setup: go1.25 ✓ · golangci-lint ✓ v2.5.0 · node ✓ v22.22.2 · pnpm ✓ 9.15.0 ·
  **buf ✗ → installed** (`v1.72.0`, GitHub release binary) · **protoc-gen-go ✗ → installed** `v1.36.11`
  · **protoc-gen-go-grpc ✗ → installed** `v1.6.2` · **protoc-gen-connect-go ✗ → installed** `v1.19.2`
  (all three via `go install`, pinned to `Dockerfile.codegen`) · **ts-proto/protoc-gen-es/
  protoc-gen-connect-es ✗ → installed** globally via npm, pinned versions · **grpcio-tools ✗ →
  installed** `1.80.0` via pip · `packages/proto/gen/ts` deps installed via `pnpm install`. Docker
  daemon unavailable in this sandbox (`docker ps` fails — socket not found), so used the host-toolchain
  fallback (`docs/runbooks/codegen-toolchain-host-setup.md`) instead of the normal Docker codegen
  container. Local `main-dev` ref created (`git branch -f main-dev origin/main-dev`) so `buf-gen.sh`'s
  `buf breaking` guard actually runs instead of silently no-op'ing.
- Steps 1+2 [done] — Added `IntentState` enum (5 values, `_UNSPECIFIED=0` sentinel) after
  `CredentialStatus`; added `Order.intent_state = 21`; updated `PlaceOrderRequest.client_order_id`'s
  doc comment to state it's now required. Ran `./scripts/buf-gen.sh`: `buf lint` clean, `buf breaking`
  clean (no consumer-breaking change — new enum, new optional-shaped field, doc-comment-only change to
  an existing field), diff scoped exactly to `trading/v1` stubs (Go/TS/Python + compiled `dist/`), no
  unrelated regeneration drift. TDD: N/A (proto/generated code). Deviations: none beyond the
  PlaceOrder-ordering resolution above (recorded for when Step 12 lands).
- Step 3 [done] — Re-verified per C-07: `004` still the highest landed migration on this branch;
  `005_broker_accounts_halted` (feature 030) has not landed. **Deviation**: created `006_order_intents`
  anyway rather than blocking, since this session is building the stacked-branch program in the
  established order (100→101→023→030→102) — 030 does not exist as a branch yet and will be built
  *on top of* this branch (via 023) later, at which point it will correctly claim `005` per its own
  pre-assignment with zero collision risk. The "wait for 005" instruction was written for the default
  parallel-branch sequential mode, where a live numbering collision is a real risk; that risk does not
  exist in a stacked-branch build order. Verified offline: 3 `CREATE` statements in `.up`, single
  matching `DROP TABLE` in `.down` (indexes drop implicitly).
- Step 4 [done] — Added both new keys to `xstockstrat-trading/CLAUDE.md` and a new `### feature 101`
  entry to `config-governance.md`'s Per-Feature Registered Keys log (above feature 100's entry, per
  newest-first). TDD: N/A (docs). Deviations: none.
- Steps 5+6 [done] (TDD pair) — Wrote `clientorderid_test.go` + extended `ibkr_test.go` first. RED:
  build failed (`undefined: broker.DeriveBrokerClientOrderID` — right reason). Implemented
  `DeriveBrokerClientOrderID` (`"xss-"+intentID`), named `IBKRRequestTimeout` constant replacing the
  bare `10*time.Second` literal, and `cOID` field wiring in `SubmitOrder`'s request body (only when
  `ClientOrderID != ""`). **IBKR field name confirmed via live web search** (see session header) —
  `cOID` is correct per IBKR's own Client Portal Web API docs, not just a "best-available candidate"
  as design.md's Open Risk #1 called it. GREEN: 6/6 pass (3 new clientorderid tests, 1 new IBKR
  forwarding test, 2 pre-existing IBKR tests unaffected). `golangci-lint`: 0 issues. Coverage: 62.7%
  (≥40% threshold; `internal/broker` is not coverage-excluded). Deviations: none beyond the IBKR
  length-limit caveat (no definitive ceiling found in public docs — flagged in the eventual PR, per
  the step's own instruction).
