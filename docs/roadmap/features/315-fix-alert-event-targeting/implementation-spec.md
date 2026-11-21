# Implementation Spec: fix-alert-event-targeting

**Status**: `pending`
**Created**: 2026-11-20
**Feature**: `docs/roadmap/features/315-fix-alert-event-targeting/feature.md`
**Total Steps**: 6
**Feature Branch**: `feature/fix-alert-event-targeting`
**Tree**: detached@`f7d12673` ≡ `origin/feature/fix-alert-event-targeting` (docs-only commits; 168 commits behind
`origin/main-dev`@`fb52065c`, which this docs-only writer did not merge). Every anchor below was read on **both** trees —
see § Anchor Table. `/sdd-execute` BRANCH SYNC merges `main-dev` before Step 1, so the **main-dev** column is what the
executor sees.

---

## Execution Summary

Six steps in three independent blocks, in the design's build order (design.md § Build order).

1. **Trading (Steps 1–2, one atomic unit).** `haltAccount` and `emitReconciliationFinding` take a caller-passed
   `ownerUserID` and set `TargetUserId` on their CRITICAL alerts; an empty owner logs a WARN and sends the alert untargeted.
2. **Portfolio (Steps 3–4, one atomic unit).** `emitRiskAlert` writes `portfolio.risk.concentration_breach` or
   `portfolio.risk.drawdown_breach` on the fixed `portfolio:risk` stream, owner-attributed; the notify alert is unchanged.
3. **Admin signal and docs (Steps 5–6).** One Grafana rule on `trading_alert_emit_total` (operator decision (b′)), then
   the service docs and the merge-order note.

No proto, migration or config-key change (design.md § Chosen Approach; recon.md § Dependencies), so there is no `proto`,
`proto-gen`, `migration` or config-seed step, and no `buf` verification applies.

**Consumer surfaces (C-14).** The product spec uses the bug template and has no `## Consumer Surface(s)` section; design.md
§ Consumer surfaces states them. The account owner receives the alerts through notify's existing targeting (Web Push, trader
alert stream, alert inbox), so no `xstockstrat-ui` or `xstockstrat-agent` step is needed — a decision, not an omission.
The admin surface is **deferred** to a named follow-on (§ Step Dependencies).

**Additions beyond design.md's lists, flagged for the reviewer.**

- Step 2 adds one assertion to `TestFlattenAndHalt_AlwaysRejected_HaltsAccount`. Without it no test proves that
  `flattenAndHalt` passes the pool owner (D-5).
- Step 5 also edits `packages/otel/produced-signals.tsv`, `packages/otel/alerts/README.md` and the guard's pytest module.
  The produced-signals guard fails without them (evidence in Step 5).
- Step 6 also edits the trading reconciliation doc, the only durable place the "owner notified, admins use Grafana" rule
  can live for that service.
- Spec decision **S-1**: the empty-owner WARN (D-2) is logged at **each** of the two emit sites with an `alert_kind`
  attribute, because design.md does not say where it is logged.

**Revised 2026-11-20 by `/sdd-review impl-spec`** (advisory; anchors re-read on `origin/main-dev`@`fb52065c`):

- `@AC-3` now exists in `acceptance.feature` (added by the review, text unchanged from this spec), so Step 4 traces to
  an existing scenario and no longer edits that file (C-15).
- Step 2 also pins the owner on the `unknown_broker_order` finding and on the position-side `quantity_discrepancy`
  finding, so every `emitReconciliationFinding` call site has an owner assertion.
- The coverage commands in Steps 2 and 4 now `export GOWORK=off`; the previous prefix form did not reach `go test`.
- § Step Dependencies lists the peer overlaps the review found (357, 321, 337, 311), and Step 6 records them.

## Scenario Coverage (C-15)

| Scenario | Covered by |
|---|---|
| `@AC-1` halt + reconciliation alerts target the owner; systemic stays untargeted | Step 2 (and the direct `haltAccount` assertion in Step 1) |
| `@AC-2` concentration breach is a concentration event with `user_id` + `symbol` | Step 4 |
| `@AC-3` drawdown breach keeps `portfolio.risk.drawdown_breach`, owner-attributed with `account_id` | Step 4 (the scenario is already in `acceptance.feature`; design.md D-7, C-16 EXTEND row) |

## Anchor Table

Line numbers on the two trees. Steps cite the symbol plus the feature-tree line; after BRANCH SYNC re-grep by symbol.

| Anchor | File | Feature tree `f7d12673` | `origin/main-dev` `fb52065c` |
|---|---|---|---|
| `type brokerPoolEntry` (`userID` field) | `services/xstockstrat-trading/internal/service/trading.go` | `:75-81` | `:75` |
| `emitReconciliationFinding` | same | `:2014` (halt call `:2025`, alert `:2026-2032`, `recordAlertEmit` `:2033`) | `:2060` (halt call `:2071`, alert `:2072-2078`) |
| `reconciliation.mismatch_found` emit, owner `""` | same | `:2018` | `:2063` |
| `reconcileTick` | same | `:2043`; loop `for accountID, entry := range brokerMap` `:2067` | `:2149`; loop `:2173` |
| `emitReconciliationFinding` callers | same | `:2116`, `:2126`, `:2160`, `:2239` | `:2222`, `:2232`, `:2266`, `:2334` |
| Systemic alert title | same | `:2285` | `:2380` |
| `RegisterBrokerAccount` | same | `:2595` | `:2696` |
| `haltAccount` | same | `:2872` (early return `:2875-2878`, alert `:2892-2898`, ERROR `account halted` `:2903`) | `:2973` (ERROR log `:3004`) |
| `flattenAndHalt` | same | `:2908`; `accountEntry` read `:2910` | `:3009`; `accountEntry` read `:3011` |
| `haltAccount` callers in `flattenAndHalt` | same | `:3013` (one) | `:3096` and `:3120` (**two** — a rate-limit halt was added on main-dev) |
| `ResumeAccountSvc` → `RequireAdminScope` | same | `:3180-3181` | `:3287-3288` |
| `TargetUserId: order.UserId` | same | `:3509` | `:3618` |
| `alertKindReconciliation` / `alertKindHalt` | same | `:3908-3909` | `:4017-4018` |
| `NewCounter("trading.alert_emit")` | `services/xstockstrat-trading/internal/telemetry/otel.go` | `:323` | `:336` |
| `haltAccount` test callers | `…/service/trading_bracket_test.go` | `:602`, `:628` | `:606`, `:632` |
| `TestHaltAccount_DBWriteFailureDoesNotRollBack` | same | `:620` | `:624` |
| `fakeNotifyClient` | same | `:176` | `:180` |
| Reconcile templates | `…/service/trading_reconciliation_test.go` | `:539`, `:576`; systemic `:762`; `noopAccountRepo` `:250` | `:547`, `:584`; systemic `:770`; `noopAccountRepo` `:258` |
| `TestReconcileTick_UnknownBrokerOrder_DetectedRegardlessOfFillState` / `TestReconcileTick_PositionQuantityDiscrepancy_CaughtViaPositionSide` | `…/service/trading_reconciliation_test.go` | `:258` / `:608` | `:266` / `:616` |
| `captureLogs` | `…/service/trading_sync_test.go` | `:16` | `:16` |
| `newFlattenHarness` / `TestFlattenAndHalt_AlwaysRejected_HaltsAccount` | `…/service/trading_flatten_rejection_test.go` | `:88` / `:124` | `:99` / `:135` |
| `evaluateDrawdowns` | `services/xstockstrat-portfolio/internal/service/portfolio_service.go` | `:1263` | `:1291` |
| `checkRiskLimits` | same | `:1279` | `:1307` |
| Concentration / drawdown `emitRiskAlert` calls | same | `:1307` / `:1315` | `:1336` / `:1344` |
| `emitRiskAlert` | same | `:1320-1335` | `:1349` |
| `emitEventAs` | same | `:1342` | `:1371` |
| `evaluateDrawdowns` test callers | `…/service/portfolio_risk_test.go` | `:33`, `:43`, `:49`, `:55` | same |
| `newQuoteSvc`, `recordingNotify`, risk templates | `…/service/portfolio_quote_deadline_test.go` | `:96`, `:349`, `:446`, `:517` | same |
| `fakeLedger` / `ctxWithUser` | `…/service/watchlist_service_test.go` | `:303` / `:334` | `:356` / `:387` |
| `## Ledger Events Emitted` drawdown row | `services/xstockstrat-portfolio/CLAUDE.md` | `:149` | `:117` |
| `portfolio:{user_id}` stream-key row | `services/xstockstrat-ledger/CLAUDE.md` | `:113` | `:97` |
| "A real finding emits … a CRITICAL alert" | trading reconciliation doc | `services/xstockstrat-trading/CLAUDE.md:215` | `services/xstockstrat-trading/docs/reconciliation.md:31` |
| Produced-signals guard | `scripts/` | `check-otel-produced-signals.sh` + `.test.sh` (`:240-241`, `:365`) | `check-otel-produced-signals.py` + `tests/test_check_otel_produced_signals.py` (`:487-488`, `:647`) — the `.sh` pair is deleted |
| Prose-note pattern | `docs/roadmap/features/merge-order.md` | `:355-364` (file ends at `:364`; design's `:389-399` is **Not found** here) | `:362-405` |

## Step Dependencies

- Steps 1+2 land together: Step 1 changes the `haltAccount` / `emitReconciliationFinding` signatures in a Go package whose
  build compiles `_test.go` (`step-constraints.md` §C row 1). Step 2 [test] covers Step 1 [service].
- Steps 3+4 land together: Step 3 changes the `evaluateDrawdowns` return shape and the `emitRiskAlert` signature in a Go
  package that compiles `_test.go`; `portfolio_risk_test.go` (edited in Step 4) does not compile without it (§C row 1).
  Step 4 [test] covers Step 3 [service].
- Step 5 stands alone. It requires the `main-dev`-merged tree, because the guard it must satisfy is the Python port that
  exists only on `main-dev`.
- Step 6 requires Steps 1, 3 and 5: it documents the event types, the targeting and the rule uid they create.
- The trading block (1–2) and the portfolio block (3–4) are independent of each other.
- **Deferred surface (C-14) — admin reachability.** Operator decision (b): a follow-on feature, proposed slug
  **`admin-halted-accounts-read`** (an admin cross-user halted-accounts read, or a notify admin-audience field). It has no
  `NNN` yet; the operator opens it with `/sdd-story admin-halted-accounts-read` **no later than this feature's integration
  PR**. Until it ships admins rely on the Step 5 rule plus the Loki ERROR line `account halted`.
- **Operator checks before the integration PR** (design.md § Open Risks; not executor steps). `/sdd-execute` copies
  these three into the integration PR description as an unchecked checklist (C-10):
  - import the Step 5 rule into Grafana Cloud and confirm it routes to a contact point (the YAML is not auto-provisioned);
  - confirm the prod Slack/SendGrid fanout configuration, which is unknown from the repo;
  - state in the PR description that concentration breaches stop arriving as `portfolio.risk.drawdown_breach`.
- **Peer overlap, non-blocking** (no migration, proto or config-key collision; statuses read on 2026-11-20). Step 6
  records all of these in `merge-order.md`:
  - `fix-read-path-owner-trust` (312, `spec-ready`) may narrow untargeted `ListAlerts` visibility; either merge order is
    code-safe (D-11).
  - `otel-env-provider-scoped-alerts` (333, `spec-ready`) edits the same `packages/otel/alerts/alert-rules.yaml`;
    whichever merges second re-greps and re-pins the rule count.
  - `fix-portfolio-internal-position` (357, `in-progress`) rewrites the position read inside `checkRiskLimits` and
    `broadcastSnapshot` in the same `portfolio_service.go` (357 `implementation-spec.md` Steps 6–7). Step 3 here edits
    the two `emitRiskAlert` call sites and `evaluateDrawdowns` in that function block, so this is a same-function
    overlap: whichever merges second resolves it by hand and re-runs both features' `TestCheckRiskLimits*` tests. 357
    Step 6 asserts the drawdown notify body, which Step 3 keeps byte-identical (D-4).
  - `fix-trading-config-plumbing` (321, `implementation-ready` on its branch) replaces the `maxRetries` value used by the
    `flattenAndHalt` retry loop (321 `implementation-spec.md:330-332`, `:358`). Step 1 here edits the two `haltAccount`
    calls in and after that loop. Adjacent lines, different statements; rebase-only.
  - `metrics-host-provider-label` (337, `in-progress`) edits `scripts/tests/test_check_otel_produced_signals.py` at
    other tests (337 `implementation-spec.md:509-514`); Step 5 here edits the two rule-count sites. Rebase-only.
  - `fix-position-fold-correctness` (311, `spec-ready`) is expected to touch `portfolio_service.go` near `:260` and
    `:419` (per 357 `implementation-spec.md:66`); 311 and 312 have no implementation spec yet, so this is a forecast.
- Line anchors drift when `main-dev` moves again; re-grep each symbol in § Anchor Table before editing.

---

### Step 1 — service: owner-targeted halt and reconciliation alerts

**Status**: `done`
**Service**: `xstockstrat-trading`
**Files**:
- `services/xstockstrat-trading/internal/service/trading.go` — modify
- `services/xstockstrat-trading/internal/service/trading_bracket_test.go` — modify (the two `haltAccount` call sites)

**Reviewers**: `xstockstrat-trading` owner — order execution correctness, broker API safety, fill detection, paper-only dev invariant, position limit enforcement

**Codebase Evidence**:
- `grep -n "haltAccount(\|emitReconciliationFinding(" services/xstockstrat-trading/internal/service/*.go` (merged tree,
  re-spec 2026-11-21) → definitions `trading.go:2973` and `:2060`; callers `:2071`, `:2222`, `:2232`, `:2266`, `:2334`,
  `:3096` (`errors.Is(err, broker.ErrRateLimited)` branch), `:3120`, `trading_bracket_test.go:606`, `:632`. No other
  caller.
- Current halt alert, `trading.go:2994-3000`: `Category: "halt"`, `Title: fmt.Sprintf("Account halted: %s", accountID)`,
  no `TargetUserId`. Current reconciliation alert, `trading.go:2072-2078`: `Category: "reconciliation"`, no `TargetUserId`.
- All four `emitReconciliationFinding` calls — the three order-level ones and the position-level one — sit inside the
  single `for accountID, entry := range brokerMap` loop body (`trading.go:2173-2342`; calls at `:2222`, `:2232`, `:2266`,
  `:2334`), so `entry.userID` is in scope at each; the position block already reads it at `:2291`.
- Owner source in `flattenAndHalt`: `accountEntry, ok := s.brokers[bracket.AccountID]` (`trading.go:3011`).
- Pattern to reuse: `TargetUserId:  order.UserId` (`trading.go:3618`).
- Empty owner is reachable: `RegisterBrokerAccount(ctx, req, userID string)` (`trading.go:2696`) stores `userID` into the
  pool without an empty check.
- `noopAccountRepo` (`trading_reconciliation_test.go:258`/`:262`) implements only `UpdateHaltStatus`; this step calls no
  other repo method, so it needs no change (design.md, R-2).
- Trading-domain survey (`step-constraints.md` §A), all from the greps above: no `TRADING_MODE` read, no `BrokerType`
  dispatch, no `OrderType` or `OrderStatus` handling sits in the edited lines.

**Lands with**: `Step 2`

**TDD**: `red-green required`

**Covers**: —

**Instructions**:
1. Change the signature to
   `haltAccount(ctx context.Context, accountID, ownerUserID, reason string, haltSource int32)`.
   - After the already-halted early return and `s.haltedMu.Unlock()`, and before `EmitAlert`, add: when
     `ownerUserID == ""`, `slog.WarnContext(ctx, "alert owner unresolved", "account_id", accountID, "alert_kind", string(alertKindHalt))`.
   - Add `TargetUserId: ownerUserID` to the `EmitAlertRequest`. An empty owner therefore sends the alert untargeted.
   - Do not move, guard or skip the halt flag, the `UpdateHaltStatus` write, the alert or the ERROR `account halted` log.
2. Change the signature to
   `emitReconciliationFinding(ctx context.Context, accountID, ownerUserID, mismatchClass, orderID string, expected, brokerReported float64)`.
   - Pass `ownerUserID` to `s.haltAccount(...)`.
   - Before its own `EmitAlert`, add the same WARN with `"alert_kind", string(alertKindReconciliation)` when
     `ownerUserID == ""` (spec decision S-1).
   - Add `TargetUserId: ownerUserID` to its `EmitAlertRequest`.
   - Leave the `reconciliation.mismatch_found` `emitLedgerEvent` owner argument `""` (named deferral D-8).
3. In `reconcileTick`, pass `entry.userID` as the new third argument at all four `emitReconciliationFinding` calls.
4. In `flattenAndHalt`, pass `accountEntry.userID` as the new third argument at **both** `haltAccount` calls (`:3096`
   and `:3120`). Do not add an `order.UserId` fallback (R-5).
5. In `trading_bracket_test.go`:
   - `TestHaltAccount_SetsInMemoryBeforeReleasingMutexThenWritesDB`: add `"user-owner"` as the third argument.
   - `TestHaltAccount_DBWriteFailureDoesNotRollBack`: hoist the inline `&fakeNotifyClient{}` into a variable, call
     `haltAccount` with `"user-owner"`, and assert exactly one recorded alert with `Category == "halt"`,
     `Severity == ALERT_SEVERITY_CRITICAL` and `TargetUserId == "user-owner"` (the `HALT_SOURCE_BRACKET_PROTECTION` halt
     named by design.md § Tests). This assertion cannot be written before the signature exists, so it lands on the GREEN side.
6. Do not edit the systemic alert (title "Systemic broker-reconciliation failure — trading reduced to REDUCE_ONLY") or the
   resume alert in `ResumeAccountSvc`. Do not add a lookup helper (R-1), a `GetBrokerAccount` call (R-2) or a second
   untargeted admin copy (R-3). Do not suppress the halt alert inside a finding (operator decision: both pushes are kept).
7. Trading-domain constraints: broker coverage — both `BrokerType` values take the same path, because the owner comes from
   `brokerPoolEntry` whatever the broker; offline accounts never reach these sites. Trading-mode gate, order-type handling
   and fill handling are unaffected by this step. No new outbound gRPC call is added; `s.notify.EmitAlert` is the existing
   client, so header propagation is unchanged.
8. Comments: none needed beyond the existing function comments (cap 2 lines; no history).

**Verification**:
```bash
cd services/xstockstrat-trading
GOWORK=off go build ./... && GOWORK=off go vet ./internal/service/
GOWORK=off go test ./internal/service/ -race -count=1 -run 'TestHaltAccount|TestReconcileTick|TestFlattenAndHalt|TestIsAccountHalted'
grep -c "TargetUserId: *ownerUserID" internal/service/trading.go          # 2
grep -n "alert owner unresolved" internal/service/trading.go              # 2 lines
grep -n "haltAccount(\|emitReconciliationFinding(" internal/service/*.go  # every call passes an owner argument
```

---

### Step 2 — test: AC-1 regression — both alerts reach the owner, systemic stays untargeted

**Status**: `done`
**Service**: `xstockstrat-trading`
**Files**:
- `services/xstockstrat-trading/internal/service/trading_reconciliation_test.go` — modify
- `services/xstockstrat-trading/internal/service/trading_flatten_rejection_test.go` — modify

**Reviewers**: `xstockstrat-trading` owner — order execution correctness, broker API safety, fill detection, paper-only dev invariant, position limit enforcement

**Codebase Evidence**:
- Templates: `TestReconcileTick_QuantityDiscrepancy_PastGraceWindow_HaltsAndEmits` (`trading_reconciliation_test.go:547`)
  and `TestReconcileTick_MissingBrokerOrder_HaltsAndEmits` (`:584`). Both build the pool entry with `userID: "u-1"` and
  pass `&fakeNotifyClient{}` inline to `newTestReconciliationService` (`:176`).
- Other finding sites: `TestReconcileTick_UnknownBrokerOrder_DetectedRegardlessOfFillState` (`:266`, sub-tests `filled`
  and `new`, class `unknown_broker_order`) and `TestReconcileTick_PositionQuantityDiscrepancy_CaughtViaPositionSide`
  (`:616`, the position-level call). Both build the pool entry with `userID: "u-1"`, pass `&fakeNotifyClient{}` inline
  and today assert only the `reconciliation.mismatch_found` event.
- Systemic home: `TestReconcileTick_SystemicThresholdCrossed_EscalatesToReduceOnly` (`:770`); both accounts fail
  `ListOrders`, so the systemic alert is the only alert that test emits.
- `fakeNotifyClient` records `calls []*notifyv1.EmitAlertRequest` under `mu` (`trading_bracket_test.go:180-187`).
- Two alerts per finding are already asserted by count near `trading_reconciliation_test.go:417` ("Account halted" plus
  "Broker state mismatch").
- `captureLogs(t)` returns `func() []map[string]any` of JSON slog records (`trading_sync_test.go:16`).
- Flatten harness: `newFlattenHarness` wires `notify: &fakeNotifyClient{}` and the pool entry `userID: "user-1"`
  (`trading_flatten_rejection_test.go:99-115`, literal at `:115`, also `:251`); `TestFlattenAndHalt_AlwaysRejected_HaltsAccount`
  (`:135`) already asserts the account is halted.
- C-13 (re-checked 2026-11-21 on the merged tree): `grep -c 'userID: "u-1"' trading_reconciliation_test.go` → 19 existing
  inline sites. `ls internal/testdata` → `caller_ids.go`, `ibkr/` (pem/vector files), `ibkr.go`, `offline_history.go`,
  `order_rows.go`. Two of these hold a user id: `offline_history.go:16` `S1UserID = "user-1"` (the feature-240 S1
  offline-history Background, account `acc-1`) and an `order_rows.go:25` row value `"user-1"`.

**Lands with**: `Step 1`

**TDD**: `red-green required`

**Covers**: `AC-1`

**Instructions**:
1. **RED first.** Every edit in this step compiles against the pre-Step-1 tree (none calls `haltAccount` directly), so
   write them before Step 1 and capture the failing run. Expected RED: `TargetUserId` is empty on both alerts, and no
   `alert owner unresolved` record exists.
2. Add one test helper in `trading_reconciliation_test.go` that returns the recorded alert for a `Category` (locking
   `notify.mu`) and fails the test when there is not exactly one.
3. In both templates (`:547`, `:584`): hoist the notify fake into a variable and assert, after the existing checks:
   exactly two alerts; the `halt` alert and the `reconciliation` alert are both `ALERT_SEVERITY_CRITICAL` with
   `TargetUserId == "u-1"`. This pins the accepted double push: both are targeted and neither is suppressed.
   Then, in the unknown-order test (`:266`, inside each sub-test) and the position-side test (`:616`): read
   `svc.notify.(*fakeNotifyClient)` and assert with the helper that the `halt` alert and the `reconciliation` alert both
   have `TargetUserId == "u-1"`. With the two templates this covers all three mismatch classes and all four call
   sites. If the helper's exactly-one check fails at RED for a reason other than an empty `TargetUserId`, stop and
   report it; do not loosen the helper.
4. In the systemic test (`:770`): hoist the notify fake and assert exactly one alert whose `Title` starts with
   `Systemic broker-reconciliation failure` and whose `TargetUserId == ""`. This is a guard: it is green before and after.
5. Add `TestReconcileTick_EmptyOwner_WarnsAndAlertsUntargeted`, modelled on the `:584` template with `userID: ""`:
   call `logs := captureLogs(t)` first; after `reconcileTick(ctx, 0, 1.1)` assert the account is halted, one
   `reconciliation.mismatch_found` event exists, both alerts have `TargetUserId == ""`, and the log holds a WARN
   `alert owner unresolved` with `account_id == "acct-1"` for `alert_kind` `halt` and for `alert_kind` `reconciliation`
   (feature-206 `@AC-2`: an empty owner blocks nothing).
6. In `TestFlattenAndHalt_AlwaysRejected_HaltsAccount`: read `h.svc.notify.(*fakeNotifyClient)` and assert the alert with
   `Category == "halt"` has `TargetUserId == "user-1"`. Filter by category; the flatten path may record other alerts.
7. Test data (C-13): `internal/testdata` exists and holds a user id (`S1UserID = "user-1"`), but that constant belongs to
   the feature-240 S1 offline-history scenario (account `acc-1`), not to these reconciliation or flatten tests. Each new
   assertion compares a `TargetUserId` against the owner literal that the same test's pool entry already sets (`"u-1"`,
   `""`, or the flatten harness's `"user-1"`). These are reserved sentinel ids, and C-12/C-13 keep scenario one-offs
   inline, so no domain object gains a new consumer. Keep them inline: do not repoint them at `testdata.S1UserID`, and
   do not extend `internal/testdata`.
8. Fill-state and broker constraints: fill handling and broker dispatch are unaffected; the templates cover the
   partial-fill (`:547`) and missing-order (`:584`) findings, and instruction 3 adds the unknown-order and
   position-side findings.
9. New logic is in the CI-excluded `service/` package — no coverage threshold applies to it; the run below still reports
   the service total.

**Verification**:
```bash
cd services/xstockstrat-trading
export GOWORK=off
COVERPKGS=$(go list ./... | grep -Ev '/(cmd|handler|repository|telemetry|service)(/|$)' | tr '\n' ',' | sed 's/,$//') \
  && go test ./... -race -count=1 -coverprofile=coverage.out -covermode=atomic -coverpkg="${COVERPKGS}" \
  && go tool cover -func=coverage.out | grep "^total:"        # confirm >= 40%
golangci-lint run --modules-download-mode=mod
git diff --exit-code go.mod go.sum                             # the lint run must not rewrite them (fails.md 2026-11-10)
grep -c 'userID: "u-1"' internal/service/trading_reconciliation_test.go   # C-13: inline ids; 19 before, 19 after (the new empty-owner test uses userID: "")
git diff --quiet HEAD -- internal/testdata; echo "rc=$?"                  # C-13: rc=0, internal/testdata unchanged
```

---

### Step 3 — service: risk ledger events split by kind, owner-attributed

**Status**: `done`
**Service**: `xstockstrat-portfolio`
**Files**:
- `services/xstockstrat-portfolio/internal/service/portfolio_service.go` — modify

**Reviewers**: `xstockstrat-portfolio` owner — P&L calculation accuracy, position snapshot consistency, concurrent write safety

**Codebase Evidence**:
- `grep -rn "evaluateDrawdowns\|emitRiskAlert" services/xstockstrat-portfolio --include=*.go` → definitions
  `portfolio_service.go:1291` and `:1349` (merged tree, re-spec 2026-11-21); callers `:1336`, `:1343-1344`; test callers
  `portfolio_risk_test.go:33`, `:43`, `:49`, `:55`. No other caller.
- Buggy site, `portfolio_service.go:1350`:
  `s.emitEvent(ctx, "portfolio.risk.drawdown_breach", "portfolio:risk", map[string]interface{}{"message": msg})`.
- `evaluateDrawdowns` returns `[]string`; `d.AccountID` appears only inside the message.
- Pattern to reuse: `emitEventAs(ctx, ownerUserID, eventType, streamKey, payload)` (`:1371`) sets
  `AppendEventRequest.UserId`; other emit sites already put `"user_id": userID` in a payload.
- The notify alert in the same helper already carries `Category: "risk"`, WARNING and `TargetUserId: userID`.
- Event types are inline string literals at every emit site; no constant block exists.
- Consumers: `grep -rn "drawdown_breach\|portfolio:risk"` outside this file finds only docs
  (`services/xstockstrat-portfolio/CLAUDE.md:117`, `docs/context-constitution-findings.md:63`) plus historical
  feature-172 and defect-report docs.
- Trading-domain survey: the edited lines hold no `TRADING_MODE` branch, broker dispatch, `OrderType` or `OrderStatus`.

**Lands with**: `Step 4`

**TDD**: `red-green required`

**Covers**: —

**Instructions**:
1. Add `type drawdownBreach struct { AccountID, Message string }` next to `evaluateDrawdowns` and change the function to
   return `[]drawdownBreach`. The message text stays byte-identical (feature-242 `@AC-6`).
2. Replace the helper with
   `emitRiskAlert(ctx context.Context, userID, eventType string, extra map[string]interface{}, msg string)`:
   - build the payload from `extra`, then set `"user_id": userID` and `"message": msg` **after** the copy, so the two
     helper keys win over a colliding key in `extra` (D-6);
   - emit with `s.emitEventAs(ctx, userID, eventType, "portfolio:risk", payload)`. The stream key stays the fixed global
     `portfolio:risk` (R-4);
   - leave the `EmitAlert` block exactly as it is (D-4).
3. Concentration call: event type `"portfolio.risk.concentration_breach"`, `extra` `{"symbol": sym}`, same message.
4. Drawdown call: range over the breaches; event type `"portfolio.risk.drawdown_breach"`, `extra`
   `{"account_id": b.AccountID}`, `msg` `b.Message`.
5. Keep the event types as inline literals, as every other emit site in this file does. Add no dedup: a persisting breach
   is re-emitted on every `checkRiskLimits` run (design.md § Open Risks; documented in Step 6).
6. Trading-domain constraints: broker coverage — other broker unaffected; trading-mode gate, order-type handling and fill
   handling are unaffected by this step. No new outbound gRPC call; `emitEventAs` and `s.notify.EmitAlert` are existing.

**Verification**:
```bash
cd services/xstockstrat-portfolio
GOWORK=off go build ./... && GOWORK=off go vet ./internal/service/
grep -c '"portfolio.risk.drawdown_breach"\|"portfolio.risk.concentration_breach"' internal/service/portfolio_service.go   # 2
grep -n 'emitEventAs(ctx, userID, eventType, "portfolio:risk"' internal/service/portfolio_service.go                     # 1 line
```
(`go vet` compiles the package's tests, so this passes only together with Step 4 — the reason for the unit.)

---

### Step 4 — test: AC-2 and AC-3 regression — one event type per breach kind

**Status**: `done`
**Service**: `xstockstrat-portfolio`
**Files**:
- `services/xstockstrat-portfolio/internal/service/portfolio_quote_deadline_test.go` — modify
- `services/xstockstrat-portfolio/internal/service/portfolio_risk_test.go` — modify

**Reviewers**: `xstockstrat-portfolio` owner — P&L calculation accuracy, position snapshot consistency, concurrent write safety

**Codebase Evidence**:
- `newQuoteSvc(t, stub, timeoutMs)` returns `(*PortfolioService, pgxmock.PgxPoolIface, *fakeLedger)` and wires the ledger
  fake (`portfolio_quote_deadline_test.go:96-104`); today's risk tests discard it (`svc, mock, _ :=`, `:446`, `:517`).
- `fakeLedger.reqs []*ledgerv1.AppendEventRequest` (`watchlist_service_test.go:356-366`); `emitRiskAlert` calls the ledger
  synchronously, so `reqs` is complete when `checkRiskLimits` returns.
- Templates: `TestCheckRiskLimits_AC3_SumsAcrossAccounts` (`:446`, broker-priced row via `posRow(..., current)`),
  `TestCheckRiskLimits_242_AC6_DrawdownTargetsOwner` (`:517`, inline `account_balances` rows for a named user),
  `TestCheckRiskLimits_304_AC2_DrawdownReadsRelativeKey` (`config.MustSnapshotWatcher("portfolio", …)`, `:501`).
- `posRow(rows, sym, account, qty, avg, current)` sets market value `current*qty` (`:87-90`); a row with `current > 0`
  needs no quote (`unvaluedSymbols`, `portfolio_service.go:605`; `latestQuotesFor` returns `ok` for no symbols, `:509`).
- `expectDrawdowns` hard-codes user `u1` (`:372-378`), so a `user-1` test writes its own `account_balances` expectation.
- `TestEvaluateDrawdowns` (`portfolio_risk_test.go:27`) treats the result as `[]string` at `:33-58`.
- Fixture home exists: `internal/testdata` — `Aapl` (`offline_pnl.go:15`), `Tsla` (`:23`), `Lyft` / `Msft` / `Elwt`
  (`marks.go:7`, `:15`, `:19`).
- `acceptance.feature` holds `@AC-1`, `@AC-2` and `@AC-3` (`grep -c "@AC-"` → 3); `@AC-3` was added by
  `/sdd-review impl-spec` on 2026-11-20. Its scenarios carry `@regression` and a `# guards:` comment, no `@FR-*` tag
  (bug template).

**Lands with**: `Step 3`

**TDD**: `red-green required`

**Covers**: `AC-2, AC-3`

**Instructions**:
1. Do not edit `acceptance.feature`: `@AC-3` is already there. Read it and confirm that test (b) below matches its
   values (limit `0.10`, user `user-1`, account `acct-1`, equity `8500.00`, peak `10000.00`).
2. **RED first.** Tests (a) and (b) below compile against the pre-Step-3 tree. Write them before Step 3 and capture the
   failing run. Expected RED: (a) the event type is `portfolio.risk.drawdown_breach` and the payload has no `user_id` or
   `symbol`; (b) the payload has no `user_id` or `account_id` and `UserId` is empty.
3. (a) `TestCheckRiskLimits_315_AC2_ConcentrationEventKindAndOwner` in `portfolio_quote_deadline_test.go`:
   - config: `risk.concentration_limit_pct` = `0.20` through `config.MustSnapshotWatcher("portfolio", …)`;
   - positions, all broker-priced at `1.0`: `testdata.Aapl` qty `35`, and `testdata.Lyft`, `testdata.Msft`,
     `testdata.Elwt`, `testdata.Tsla` qty `16.25` each (AAPL = 35.0%, every other symbol 16.25%);
   - an empty `account_balances` result for `("user-1", "TRADING_MODE_PAPER")` (no drawdown breach);
   - run `checkRiskLimits(ctxWithUser(t, "user-1"), "user-1", TRADING_MODE_PAPER)`;
   - assert: exactly one appended event; `EventType == "portfolio.risk.concentration_breach"` and no event typed
     `portfolio.risk.drawdown_breach`; `StreamKey == "portfolio:risk"`; `UserId == "user-1"`; payload `user_id` `"user-1"`,
     `symbol` `"AAPL"`, `message` `"concentration limit breach: AAPL at 35.0%"`; the notify alert is still one WARNING,
     category `risk`, `TargetUserId` `"user-1"`, same body.
4. (b) `TestCheckRiskLimits_315_AC3_DrawdownEventKeepsTypeWithOwnerAndAccount`, modelled on the `:517` template with user
   `user-1`, account `acct-1`, equity `8500.0`, peak `10000.0` and no positions. Assert: exactly one appended event;
   `EventType == "portfolio.risk.drawdown_breach"`; `StreamKey == "portfolio:risk"`; `UserId == "user-1"`; payload
   `user_id` `"user-1"`, `account_id` `"acct-1"`, `message`
   `"drawdown limit breach: account acct-1 at 15.0% (peak 10000.00, current 8500.00)"`, and no `symbol` key; the notify
   body equals the same message (D-4).
5. GREEN-side edits, written with Step 3 because they reference its new shapes:
   - `TestEvaluateDrawdowns`: read `.Message` where the test checks the text, and assert `AccountID == "acc-1"` on the
     breaching row;
   - one test for D-6: call `emitRiskAlert` with `extra` holding `user_id` and `message` keys that differ from the
     arguments, and assert the appended payload carries the arguments' values.
6. Test data (C-13): symbols come from the existing `internal/testdata` constants; the user and account ids are scenario
   one-offs and stay inline. No fixture is added.
7. Preserve checks: do not edit the existing `AC3`, `AC9`, `242_AC6` or `304_AC2` tests; they must still pass unchanged
   (feature-231 `@AC-3` / `@AC-9`, feature-242 `@AC-3` / `@AC-6`, feature-172 `@AC-1`).
8. New logic is in the CI-excluded `service/` package — no coverage threshold applies to it; the run below still reports
   the service total.

**Verification**:
```bash
cd services/xstockstrat-portfolio
GOWORK=off go test ./internal/service/ -race -count=1 -run 'TestCheckRiskLimits|TestEvaluateDrawdowns|TestEmitRiskAlert'
export GOWORK=off
COVERPKGS=$(go list ./... | grep -Ev '/(cmd|handler|repository|telemetry|service)(/|$)' | tr '\n' ',' | sed 's/,$//') \
  && go test ./... -race -count=1 -coverprofile=coverage.out -covermode=atomic -coverpkg="${COVERPKGS}" \
  && go tool cover -func=coverage.out | grep "^total:"        # confirm >= 40%
golangci-lint run --modules-download-mode=mod
git diff --exit-code go.mod go.sum
grep -n "testdata\.\(Aapl\|Lyft\|Msft\|Elwt\|Tsla\)" internal/service/portfolio_quote_deadline_test.go   # C-13: symbols from the fixture home
grep -c "@AC-" ../../docs/roadmap/features/315-fix-alert-event-targeting/acceptance.feature               # 3
```

---

### Step 5 — config: Grafana rule on halt and reconciliation alert emits (operator decision b′)

**Status**: `pending`
**Service**: `packages/otel` (provisioning asset; not a config key, so the C-05 config-key contract does not apply)
**Category note**: `config` is the nearest of the seven template categories for a provisioning file. The product spec
declares no config key, and this step adds no namespace, key, `value_type`, seed migration or reader.
**Files** (paths on the `main-dev`-merged tree):
- `packages/otel/alerts/alert-rules.yaml` — modify
- `packages/otel/produced-signals.tsv` — modify
- `packages/otel/alerts/README.md` — modify
- `scripts/tests/test_check_otel_produced_signals.py` — modify

**Reviewers**: `xstockstrat-trading` owner — order execution correctness, broker API safety (producer of the queried metric); Platform Lead — cross-service architecture (`packages/otel` has no row in the reviewer registry — **Not found**)

**Codebase Evidence**:
- The metric exists and is unwatched: `alertEmit = NewCounter("trading.alert_emit")` (`internal/telemetry/otel.go:336`),
  recorded with `KeyAlertKind = "alert_kind"` and `KeyOutcome = "outcome"` (`:312`/`:315`, `RecordAlertEmit` `:373`).
  `alert-rules.yaml` holds three rules: `xstk-error-rate-high`, `xstk-p99-latency-high`, `xstk-analysis-no-scoring`.
- Exported series name, checked read-only against the live Mimir datasource on 2026-11-20:
  `trading_alert_emit_total`, labels `alert_kind`, `outcome`, `service_name="trading"`, `deployment_environment`.
  The in-repo precedent for the `_total` suffix is the `analysis_opportunity_recompute_total` row in
  `produced-signals.tsv` on `main-dev`.
- The systemic alert records the same kind (`s.recordAlertEmit(ctx, alertKindReconciliation, alertErr)`,
  `trading.go:2384`), so the rule also fires on a systemic escalation.
- Guard, `main-dev`: `scripts/check-otel-produced-signals.py` — every PromQL metric identifier in an `expr:` must be a
  `metric` row in `produced-signals.tsv` (Part 1); a doc count such as "Three alert rules" must equal the real rule count
  (Part 3, `check_count` `:315`); every rule declares `noDataState` (`check_rules` `:424-437`). `or`, `unless` and `offset`
  are in `PROMQL_KEYWORDS` (`:86-88`).
- Count-dependent sites, `main-dev`: `packages/otel/alerts/README.md:9` ("Three alert rules");
  `scripts/tests/test_check_otel_produced_signals.py:487-488` (`test_the_real_tree_declares_three_rules`, `== 3`) and
  `:647` (`"Delete the four alert rules below"` must be a **wrong** count). No other doc states a rule count
  (`git grep -n -i -E "(three|four|[0-9]+) (v1 )?alert rules?" origin/main-dev -- docs/setup docs/patterns docs/launch-pdfs packages/otel`).
- CI job `otel-signals` runs the guard and its pytest module (`.github/workflows/ci.yml:1150-1168` on `main-dev`).
- The candidate expression below parses on the live datasource, returns no series now, and returned a `staging` series
  over the last 30 days.
- Known limitation: the checked-in rules are not auto-provisioned and aggregate across environments
  (`packages/otel/docs/context-constitution-findings.md:14` on `main-dev`, tracked by feature 333).

**TDD**: `N/A (provisioning YAML / TSV / README; the pytest edit only re-pins the rule count this step changes)`

**Covers**: —

**Instructions**:
1. `alert-rules.yaml`: append a group `xstockstrat-account-halts` (`orgId: 1`, `folder: xstockstrat`, `interval: 1m`) with
   one rule, shaped like the existing three (`data` = Prometheus query `A` → `reduce` `B` (`last`) → `threshold` `C`):
   - `uid: xstk-trading-account-halt`; `title: Trading account halt or reconciliation alert emitted`;
   - `condition: C`, `for: 0m`, `noDataState: OK`, `execErrState: Error`;
   - labels `severity: critical`, `platform: xstockstrat`;
   - query `A`: `datasourceUid: ${DS_PROMETHEUS_UID}`, `relativeTimeRange: { from: 900, to: 0 }`, `instant: true`, and
     ```
     sum by (deployment_environment) (increase(trading_alert_emit_total{alert_kind=~"halt|reconciliation"}[15m])) > 0
     or
     sum by (deployment_environment) (trading_alert_emit_total{alert_kind=~"halt|reconciliation"} unless trading_alert_emit_total{alert_kind=~"halt|reconciliation"} offset 15m) > 0
     ```
     The second arm is required: the counter series is created by the first emit after a process start, and `increase()`
     cannot see that first sample.
   - `C`: `evaluator: { type: gt, params: [0] }`;
   - annotations: a `summary` naming `{{ $labels.deployment_environment }}`, and a `description` saying the metric has no
     `account_id` label, the account id is in the Loki ERROR line `account halted` of `{service_name="trading"}`, and only
     an admin can resume. Keep the LogQL text out of any `expr:` key.
   - a comment of at most two lines above the rule: owner-targeted halt alerts leave admins no in-product signal (feature 315).
2. `produced-signals.tsv`: append one tab-separated row —
   `metric`, `trading_alert_emit_total`, `services/xstockstrat-trading/internal/telemetry/otel.go`, `trading.alert_emit`.
3. `packages/otel/alerts/README.md`: change "Three alert rules" to "Four alert rules"; add the rule's row to the
   `## Rules` table (escape the `|` in the matcher as `\|`); add a short paragraph: what it signals, that it also fires on
   the systemic escalation, that the account id comes from Loki, and that routing is per environment like the other rules.
4. `scripts/tests/test_check_otel_produced_signals.py`: rename `test_the_real_tree_declares_three_rules` to
   `…_four_rules` and expect `4`; change the removal-prose fixture to `"Delete the five alert rules below"` so it is still
   a wrong count.
5. Do not edit `scripts/check-otel-produced-signals.py`: the new uid is in neither `RPC_RULES` nor `STALL_RULE`, so only
   the `noDataState` requirement applies to it.
6. The merged tree holds only the Python guard; there is no `.sh` pair (re-checked 2026-11-21). If a `.sh` guard
   reappears, stop and report it as a blocker; do not edit it.

**Verification**:
```bash
python3 scripts/check-otel-produced-signals.py
(cd scripts && uv run --extra dev --frozen pytest tests/test_check_otel_produced_signals.py)
grep -c -E '^[[:space:]]+- uid:' packages/otel/alerts/alert-rules.yaml                              # 4
grep -n "xstk-trading-account-halt" packages/otel/alerts/alert-rules.yaml packages/otel/alerts/README.md
grep -n "trading_alert_emit_total" packages/otel/produced-signals.tsv
grep -n "Four alert rules" packages/otel/alerts/README.md
```

---

### Step 6 — docs: event catalogue, stream key, alert audience, merge-order note

**Status**: `pending`
**Service**: `xstockstrat-portfolio`, `xstockstrat-ledger`, `xstockstrat-trading`, `docs/roadmap/features/`
**Files**:
- `services/xstockstrat-portfolio/CLAUDE.md` — modify
- `services/xstockstrat-portfolio/docs/context-constitution-findings.md` — modify
- `services/xstockstrat-ledger/CLAUDE.md` — modify
- `services/xstockstrat-trading/docs/reconciliation.md` — modify (`main-dev` tree; on the feature tree the same paragraph is `services/xstockstrat-trading/CLAUDE.md:211-217`)
- `docs/roadmap/features/merge-order.md` — modify

**Reviewers**: none

**Codebase Evidence**:
- `services/xstockstrat-portfolio/CLAUDE.md` § Ledger Events Emitted: `| portfolio.risk.drawdown_breach | Max drawdown exceeded |`
  (feature tree `:149`, `main-dev` `:117`); the watchlist rows in the same table show the payload-and-owner wording.
- `services/xstockstrat-portfolio/docs/context-constitution-findings.md:63` lists report
  `2026-10-19-portfolio-concentration-logged-as-drawdown-defect`; the rows at `:65-66` show the
  `— **resolved (verified <date>):** …` wording.
- `services/xstockstrat-ledger/CLAUDE.md` § Stream Key Conventions lists `portfolio:{user_id}` only (feature tree `:113`,
  `main-dev` `:97`); the `account:{account_id}` row shows a parenthesised ownership note.
- Trading doc sentence: "A real finding emits `reconciliation.mismatch_found`, a CRITICAL alert, and routes to the
  **ordinary, per-account** halt" (`main-dev` `docs/reconciliation.md:31`).
- `merge-order.md`: non-blocking prose sections end the file, from `## Textual overlap: 300 ↔ 304 (2026-11-09, non-blocking)`
  through the 347 section ending at `:420` (merged tree, 2026-11-21); each closes with "Operator-approved as a prose note so it does not gate either integration PR."
- `grep -n "315\|alert-event" docs/roadmap/features/merge-order.md` → no match; the file has no entry for this feature.
- Peer 312: `docs/roadmap/features/312-fix-read-path-owner-trust/product-spec.md:94` (Open Question 2, untargeted
  `ListAlerts` visibility). Peer 333: `packages/otel/docs/context-constitution-findings.md:14` on `main-dev`.

**TDD**: `N/A (docs)`

**Covers**: —

**Instructions**:
1. Portfolio `CLAUDE.md`, § Ledger Events Emitted:
   - rewrite the drawdown row: per-account max drawdown exceeded; payload `{user_id, account_id, message}`;
   - add a `portfolio.risk.concentration_breach` row: a symbol exceeds `risk.concentration_limit_pct`; payload
     `{user_id, symbol, message}`;
   - state once, for both: stream key `portfolio:risk` (fixed, global); the owner also rides in
     `AppendEventRequest.user_id`; a persisting breach is re-emitted on every `checkRiskLimits` run (no dedup) and is
     visible in the owner's `owner_only` `QueryEvents` / `ExportEvents`; before feature 315 concentration breaches were
     recorded as `portfolio.risk.drawdown_breach`, which an external reader of that stream may still assume.
2. Portfolio findings `:63`: mark the row resolved by feature 315, in the wording of the rows below it.
3. Ledger `CLAUDE.md`, § Stream Key Conventions: add a row for `portfolio:risk` — a fixed global key (not a user id) used
   by portfolio `portfolio.risk.*` events, with the owner in `AppendEventRequest.user_id` and in the payload (D-9).
4. Trading reconciliation doc, after the "A real finding emits …" sentence, add: the `halt` and `reconciliation` CRITICAL
   alerts are targeted at the account owner (`TargetUserId` = the pool entry's owner; an empty owner logs WARN
   `alert owner unresolved` and sends the alert untargeted); the owner cannot resume, and admins get no in-product signal
   or account id — they use the Grafana rule `xstk-trading-account-halt` and the Loki ERROR line `account halted` until the
   follow-on `admin-halted-accounts-read` ships; the systemic alert stays untargeted; the `reconciliation.mismatch_found`
   ledger owner stays NULL.
5. `merge-order.md`: append one non-blocking prose section for feature 315, in the style of the existing ones:
   - 315 ↔ 312: no file overlap; either merge order is code-safe; 312 Open Question 2 may narrow untargeted `ListAlerts`
     visibility, which changes who sees 315's empty-owner fallback and the systemic alert;
   - 315 ↔ 333: both edit `packages/otel/alerts/alert-rules.yaml`, its README and the guard's rule-count test; whichever
     merges second re-greps and re-pins the count, and 333 scopes the new rule by environment with the others;
   - 315 ↔ 357, 321, 337 and 311: one line each, taken from § Step Dependencies (same-function overlap with 357 in
     `checkRiskLimits`, resolved by hand by whichever merges second; rebase-only for the rest). Re-read each peer's
     status first and drop a peer that has already merged.
   Add no table row: there is no hard ordering constraint.
6. Keep each edit to the named section; do not reformat neighbouring rows.

**Verification**:
```bash
grep -n "portfolio.risk.concentration_breach\|portfolio.risk.drawdown_breach" services/xstockstrat-portfolio/CLAUDE.md   # 2 rows
grep -n "portfolio:risk" services/xstockstrat-portfolio/CLAUDE.md services/xstockstrat-ledger/CLAUDE.md
grep -n "portfolio-concentration-logged-as-drawdown" services/xstockstrat-portfolio/docs/context-constitution-findings.md   # row says resolved, feature 315
grep -n "alert owner unresolved\|xstk-trading-account-halt\|admin-halted-accounts-read" services/xstockstrat-trading/docs/reconciliation.md
grep -n "315" docs/roadmap/features/merge-order.md
python3 scripts/check-otel-produced-signals.py     # the docs scan still passes
```

---

## Deviation Log

_Populated by /sdd-execute as implementation proceeds._

### Step 2 — second test helper (2026-11-21)
- **Spec said**: instruction 2 adds one test helper (the recorded alert for a `Category`, exactly-one check).
- **Actual**: that helper (`alertByCategory`) plus a second helper, `assertOwnerTargetedFindingAlerts`, in
  `trading_reconciliation_test.go`. The second helper holds the instruction-3 template assertions (exactly two alerts,
  `halt` + `reconciliation`, both CRITICAL and owner-targeted) so the two templates do not repeat the same block (DRY
  guard rail). It is built on `alertByCategory` and loosens no check.
- **Disposition**: within step scope; test structure only, assertions unchanged from the instructions.

### Steps 1+2 — pinned linter on PATH (2026-11-21)
- **Spec said**: Step 2 Verification runs `golangci-lint run --modules-download-mode=mod`.
- **Actual**: the host's `golangci-lint` is v2.5.0 (built with go1.25). The pinned v2.14.0 was installed with
  `GOTOOLCHAIN=go1.27.0 go install …@v2.14.0` into `/root/go/bin`, and the block ran unchanged with that directory first
  on `PATH`.
- **Disposition**: CI-equivalent fallback (same tool, CI-pinned version).

### Step 4 — shared event assertion helper (2026-11-21)
- **Spec said**: instructions 3–5 list the assertions for tests (a), (b) and the D-6 test; no helper is named.
- **Actual**: one helper, `assertOneRiskEvent`, in `portfolio_quote_deadline_test.go` holds the common ledger checks
  (exactly one event; type; `portfolio:risk`; `UserId`; payload equal to an exact key set). The three tests call it, so
  the block is not repeated (DRY guard rail). The exact key-set match is how (b) proves "no `symbol` key".
- **Disposition**: within step scope; test structure only, assertions unchanged from the instructions.

### Steps 3+4 — pinned linter on PATH (2026-11-21)
- **Spec said**: Step 4 Verification runs `golangci-lint run --modules-download-mode=mod`.
- **Actual**: the host's default `golangci-lint` is still v2.5.0; the block ran unchanged with `/root/go/bin`
  (v2.14.0 built with go1.27.0, installed for Steps 1+2) first on `PATH`.
- **Disposition**: CI-equivalent fallback (same tool, CI-pinned version).
