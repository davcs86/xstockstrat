# Context Log: fix-alert-event-targeting

Append-only. Each session appends a new ## Session entry. Never delete or edit prior entries.

---

## Session 2026-11-10 (/sdd-triage)

- Bug reported via defect reports (clustered triage):
  - docs/reports/2026-10-21-trading-untargeted-per-account-alerts-defect.md (SEV-2)
  - docs/reports/2026-10-19-portfolio-concentration-logged-as-drawdown-defect.md (SEV-3)
- Cluster rationale: both are per-account risk signals emitted without owner attribution (alert targeting /
  ledger event kind + user), fixed at the alert/event emit sites.
- Severity: SEV-2 (highest of cluster)
- Routed to SDD path (Track C); prod-impacting SEV-2 routed to C by operator decision 2026-11-10
- Created: status.md, feature.md, product-spec.md, acceptance.feature (2 regression scenarios), context.md
- Affected services (from reports): xstockstrat-trading, xstockstrat-portfolio
- Root cause hypothesis: owner not resolved at trading emit time; portfolio reuses one drawdown-typed helper for
  both breach kinds (now passes userID to notify, ledger event still unattributed — portfolio_service.go:1320).
- Recommended design depth: full → `/sdd-design fix-alert-event-targeting` (rationale: SEV-2, 2 affected services,
  open audience question)
- Development branch: feature/fix-alert-event-targeting

## Session 2026-11-10 — sdd-review product-spec

- Product spec approved. Status: draft → spec-ready.
- Warnings: bug-template conventions (no FR-N/@FR tags; no Consumer Surface section); AC-1 bundles reconciliation assertion under a halt When (split); AC-2 lacks account_id and true-drawdown check; audience (owner vs owner+admins) deferred
- Overlap findings: WARN: trading/portfolio shared; ListAlerts untargeted-visibility coupling with 312
- Recommended design depth: full (trading + portfolio; alert audience coupling with 312)
- Tree: ccr-500a9eb9-nvk45x (origin/main-dev 0fecb24d + triage/docs commits; no feature branch yet)

## Session 2026-11-11 — sdd-batch design gate (round 2)

## Open Threads

`/sdd-design fix-alert-event-targeting` (full mode) is stopped at its approval gate after round 2. The gate policy is halt. design.md is not written and status.md is unchanged (spec-ready). The register is in `debate.md`: D-1 to D-7, R-1 to R-6, O-1 to O-4.

- **Approach.** Two independent, surgical edits. No proto, migration or config change.
  - **Trading (AC-1).** `haltAccount` and `emitReconciliationFinding` take an `ownerUserID` parameter, and both alerts set `TargetUserId`.
    - reconcileTick passes `entry.userID`. flattenAndHalt passes `accountEntry.userID` only. The `order.UserId` fallback was dropped (D-5).
    - If the owner is empty, the code logs a WARN and sends an untargeted alert. The halt, the ledger event and the alert are never blocked (D-2).
    - The systemic alert and the resume alert are not touched.
    - The bracket test callers at trading_bracket_test.go:602 and :628 must move to the new signature. One of them asserts TargetUserId on the HALT_SOURCE_BRACKET_PROTECTION halt.
  - **Portfolio (AC-2).** A new `emitRiskAlert(ctx, userID, eventType, extra, msg)` helper writes to the `portfolio:risk` stream through `emitEventAs`, attributed to the owner.
    - Concentration emits `portfolio.risk.concentration_breach` with {symbol}. Drawdown keeps `portfolio.risk.drawdown_breach` with {account_id}.
    - The helper's `user_id` and `message` keys override any colliding key in `extra` (D-6).
    - The notify alert stays byte-identical (D-4).
    - Tests and a new third Gherkin scenario cover both halves (D-7).
  - **Docs.** The portfolio CLAUDE.md ledger-events list, the portfolio findings :63 (mark resolved), the ledger stream-key row, and product-spec `## Consumer Surface(s)`. design.md must also record the owner-visibility change in QueryEvents/ExportEvents and the volume of re-emits that are not deduplicated.
  - **Build order.** Trading signatures, then trading tests, then the portfolio split, then portfolio tests, then docs.
- **Strongest open objection: O-1 (blocking).** The alert audience for per-account halt and reconciliation alerts needs a recorded operator decision. The question must offer the full option set, not just the owner-only variants (R-6):
  - (a) owner-only now;
  - (b) owner-only now, plus a follow-on notify audience feature (the proposer's recommendation);
  - (c) owner plus admins in this fix, which brings notify proto and behavior changes into scope;
  - (d) ship AC-2 now and hold AC-1 until the notify audience lands.

  The same question carries a sub-question on the double push: accept both CRITICAL pushes, or suppress the halt alert when it is called from a finding. Suppression changes the feature-294 @AC-4 metric count. O-2 (blocking, C-16) is related: the loss of admin visibility in push, stream and inbox is an unclassified CHANGE and needs a CHANGE row with operator sign-off. It must also cite whether any feature-242 scenario asserts admin delivery. The answer to O-1 can close O-2 as well. Two objections are non-blocking:
  - O-3: check the prod Slack/SendGrid fanout configuration before asking the operator, or state that it is unknown.
  - O-4: record the ordering dependency on batch peer 312 in this file and in merge-order.md.

  The flip to design-approved must refuse to run unless the answer has been persisted (P-05).
- **Floor status.** No Floor breaches.
- **Uncovered @AC changes.** No operator decision exists yet, so none of these is covered:
  - @AC-1 (CHANGE);
  - @AC-2 (CHANGE);
  - new @AC-3, drawdown keeps drawdown_breach and is owner-attributed (EXTEND);
  - admin delivery of per-account halt and reconciliation alerts, the feature-242 untargeted admin audience (CHANGE).

  The PRESERVE rows are feature-206 @AC-2, feature-242 @AC-3/@AC-6, feature-231 @AC-3/@AC-9, @AC-45, feature-169 @AC-3, feature-172 @AC-1 and feature-294 @AC-4.

```sdd-batch-design-state
{
  "round": 2,
  "synth": {
    "approach": "Round 2 synthesis. The mechanics are unchanged from round 1 and rest on D-1 to D-4. This round adopts the adversary's tightening and widens the operator question. Two independent, surgical edits. No proto, migration or config change.\n\nTRADING (AC-1)\n- New signatures: `haltAccount(ctx, accountID, ownerUserID, reason string, haltSource int32)` (today trading.go:2872) and `emitReconciliationFinding(ctx, accountID, ownerUserID, mismatchClass, orderID string, expected, brokerReported float64)` (today trading.go:2014).\n- reconcileTick passes `entry.userID` at every emitReconciliationFinding site (:2116, :2126, :2160, :2239). flattenAndHalt (:2908) passes `accountEntry.userID` only.\n- The round-1 `order.UserId` secondary fallback is dropped. Every pool insert sets userID (:306, :320, :2614, :2652, :2706), and a second owner source would be an untested branch (C-18). The D-2 path covers the case where userID is empty anyway: WARN `alert owner unresolved` plus an untargeted alert. The halt, the `reconciliation.mismatch_found` event and the alert are never blocked.\n- Both alerts set `TargetUserId: ownerUserID`, the same pattern as the order alerts at :3509, :3948 and :3965. Owner handling sits after the already-halted early return (:2875-2878).\n- Not touched: the systemic alert (~:2284) and the resume alert (:3219).\n- Tests:\n  - Reconcile path: both the halt and reconciliation alerts carry TargetUserId.\n  - Callers verified this round: trading_bracket_test.go:602 and :628 call haltAccount with the 4-argument signature. Update both, and have one assert TargetUserId on the HALT_SOURCE_BRACKET_PROTECTION halt, which covers the flattenAndHalt path that AC-1 does not.\n  - Empty owner: the halt, the mismatch event and an untargeted alert all still fire.\n  - Existing tests that assert the full EmitAlertRequest gain `TargetUserId: \"u-1\"`.\n\nPORTFOLIO (AC-2)\n- `emitRiskAlert(ctx, userID, eventType string, extra map[string]interface{}, msg string)` replaces today's :1320-1321. It writes through `emitEventAs(ctx, userID, eventType, \"portfolio:risk\", payload)` (:1342).\n- Payload precedence is now explicit, per D-3: the payload is built from `extra` first, then the helper sets `user_id` and `message`. The helper's keys win on a collision, and a unit test pins this.\n- Concentration (:1307) emits `portfolio.risk.concentration_breach` with {symbol}. Drawdown (:1315) keeps `portfolio.risk.drawdown_breach` with {account_id}.\n- `evaluateDrawdowns` returns `[]drawdownBreach{AccountID, Message}` with unchanged message text.\n- The notify alert stays byte-identical (D-4).\n- The AC-2 test (fakeLedger.reqs, portfolio_quote_deadline_test.go:96) asserts both halves:\n  - concentration emits concentration_breach with {user_id, symbol, message} and UserId=owner;\n  - drawdown still emits drawdown_breach with {user_id, account_id, message} and UserId=owner.\n  - This guards the drawdown half of D-3. Add it as a third Gherkin scenario in acceptance.feature (C-15).\n- design.md states the owner-visibility change: risk events now appear in owner_only QueryEvents/ExportEvents (ledgerServiceImpl.ts:76-78). It also states the volume: checkRiskLimits re-emits each breaching symbol on every run (:1303-1308), with no dedup. Dedup is out of scope.\n\nAUDIENCE: O-1 is open and blocking. The operator gets the full option set, not two pre-narrowed branches.\n- (a) Owner-only now. Admins lose Web Push (webPush.ts:110-114), the live stream (matchesSubscriber, notifyServiceImpl.ts:282) and the inbox (ListAlerts, :210 and :218). Admins keep:\n  - the target-agnostic Slack/SendGrid fanout, whose prod configuration must be checked in .do/app.yaml and the config seeds before the question is asked, or stated as unknown;\n  - the `account halted` ERROR log;\n  - the mismatch ledger event;\n  - the trading.alert_emit metric.\n- (b) Owner-only now, plus a follow-on notify audience feature through its own /sdd-story. Recorded as a known regression window.\n- (c) Owner plus admins in this fix, adding a notify audience field. This brings a proto and a notify behavior change into scope.\n- (d) Ship AC-2 now, and hold AC-1 until the notify audience lands. Non-admin owners keep receiving no push in the meantime, which is the SEV-2 harm.\n- Proposer recommendation: (b).\n- The same prompt asks a sub-question on the double push. Today emitReconciliationFinding calls haltAccount (halt CRITICAL, :2892) and then sends the reconciliation CRITICAL (:2026). The fanout dedup does not collapse them because their title and body differ. Options:\n  - accept both pushes;\n  - suppress the halt alert when called from a finding. This changes the `trading.alert_emit{alert_kind=halt}` count, which feature-294 @AC-4 needs sign-off for.\n- Under (a) or (b) the code above ships as written. (c) adds notify scope. (d) defers the trading half.\n- Recon/design must add a C-16 CHANGE row: \"admins see per-account halt/reconciliation CRITICAL alerts in push, stream and inbox\" (current untargeted behavior → owner-targeted). It needs operator sign-off in context.md. A grep of docs/sdd/business-rules found no notify scenario asserting admin delivery of per-account CRITICAL alerts. Re-check the feature-242 acceptance.feature directly and cite the result.\n- The status flip to design-approved stays gated on the answer being persisted to context.md/debate.md. The flip must refuse to run if that write fails (P-05, fails.md:2963-2968).\n- Record the ordering dependency on batch peer 312 (fix-read-path-owner-trust / fix-notify-stream-contract) in context.md and merge-order.md. If it narrows `OR target_user_id IS NULL` for non-admins, the rationale for R-3 and options (a) to (d) shift.\n\nDOCS:\n- services/xstockstrat-portfolio/CLAUDE.md:149 (Ledger Events Emitted)\n- services/xstockstrat-portfolio/docs/context-constitution-findings.md:63 (mark resolved)\n- services/xstockstrat-ledger/CLAUDE.md § Stream Key Conventions (add the `portfolio:risk` row)\n- product-spec.md: add `## Consumer Surface(s)`\n- design.md: record the double-push decision, the owner-visibility change and the re-emit volume\n\nBUILD ORDER: (1) trading signatures and TargetUserId; (2) trading tests, including the bracket test callers; (3) portfolio split; (4) portfolio tests, both halves; (5) docs.",
    "open_objections": [
      {
        "text": "O-1 (still open): the alert audience for per-account halt/reconciliation alerts needs a recorded operator decision. The question must offer the full set (a) owner-only, (b) owner-only plus a follow-on notify audience feature, (c) owner plus admins in this fix with notify scope, (d) hold AC-1 and ship AC-2. It must also include the double-push sub-question (accept both, or suppress the halt alert when called from a finding). Design-approved stays gated on persisting the answer.",
        "blocking": true
      },
      {
        "text": "C-16: the admin-visibility loss (push, stream and inbox for per-account halt/reconciliation CRITICAL alerts) is an unclassified behavior CHANGE. recon.md:91-102 lists PRESERVE rows only. Add a CHANGE row, get operator sign-off in context.md, and cite whether any feature-242 scenario asserts admin delivery of these alerts.",
        "blocking": true
      },
      {
        "text": "Before asking the operator, check whether prod Slack/SendGrid fanout is configured (.do/app.yaml, notify fanout config seeds), or say plainly that it is unknown. Otherwise option (a) reads softer than it may be.",
        "blocking": false
      },
      {
        "text": "The ordering dependency on batch peer 312 (fix-read-path-owner-trust / fix-notify-stream-contract) must be recorded in context.md and merge-order.md. A change to untargeted ListAlerts visibility shifts the R-3 rationale and the operator's options.",
        "blocking": false
      }
    ],
    "floor_breaches": [],
    "business_rule_changes": [
      {
        "ac_id": "@AC-1",
        "kind": "CHANGE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "@AC-2",
        "kind": "CHANGE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "new @AC-3 (drawdown keeps drawdown_breach, owner-attributed)",
        "kind": "EXTEND",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "admin delivery of per-account halt/reconciliation alerts (feature-242 untargeted admin audience, as applied to these alerts)",
        "kind": "CHANGE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "feature-206 @AC-2",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "feature-242 @AC-3",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "feature-242 @AC-6",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "feature-231 @AC-3",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "feature-231 @AC-9",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "@AC-45 (systemic alert)",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "feature-169 @AC-3",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "feature-172 @AC-1",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "feature-294 @AC-4",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      }
    ],
    "rejected_alternatives": [
      "order.UserId as a secondary owner source in flattenAndHalt. Pool inserts always set userID (trading.go:306, :320, :2614, :2652, :2706), so the branch is untested and speculative (C-18). The D-2 empty-owner path already covers the impossible case.",
      "Framing the operator question as only (a) owner-only or (b) owner-only plus a follow-on. This pre-decides O-1's core fork (P-03/C-11). Options (c) and (d) must be offered.",
      "Building the payload at each call site instead of injecting it in the helper. This contradicts D-3. The helper's injected keys win, and that precedence is stated.",
      "Proposer's carry-forwards from round 1: the pool-lookup helper (R-1), the DB fallback (R-2), an untargeted admin copy (R-3) and a per-user stream key (R-4). All remain locked."
    ],
    "open_risks": [
      "If the operator chooses (c), notify proto and behavior changes enter a SEV-2 trading/portfolio bug fix. The scope and approval flow then grow (proto: 2 owners plus platform lead).",
      "Under (a) or (b), admin oversight of automatic per-account CRITICAL halts depends on Slack/SendGrid fanout, whose prod configuration is unverified.",
      "Under (d), non-admin owners keep receiving no push for halted accounts, which is the SEV-2 harm itself.",
      "The owner gets two CRITICAL pushes per reconciliation finding unless the operator sanctions suppressing the halt alert, and suppression changes the feature-294 metric count.",
      "Owner-attributed risk events, re-emitted on every checkRiskLimits run with no dedup, now land in owner_only QueryEvents/ExportEvents. Volume may surprise users.",
      "External ledger readers may depend on concentration arriving as drawdown_breach. Only in-repo consumers were checked.",
      "Batch peer 312 may change untargeted ListAlerts visibility, which shifts the audience calculus mid-batch."
    ],
    "constitution_rules_touched": [
      "P-03",
      "P-05",
      "C-11",
      "C-15",
      "C-16",
      "C-18",
      "C-08",
      "C-14",
      "C-10",
      "C-01",
      "F-04"
    ],
    "rationale": "The adversary confirmed that the mechanics match D-1 to D-4 in the code and found no Floor breach. I checked trading_bracket_test.go:602 and :628 myself; both still use the 4-argument haltAccount.\n\nThe proposal's claim that the design is the same under either answer held only because it offered two options that both ship owner-only. That pre-decides the O-1 fork, so the synthesis restores the full (a) to (d) option set and adds the double-push sub-question. The recommendation is kept, but labeled as a recommendation.\n\nThe proposal itself called the admin-visibility loss a regression window, and recon recorded no CHANGE row for it. Under C-16 that becomes a separate blocking objection, which the operator's answer can close together with O-1.\n\nThe non-blocking points are adopted into the approach, since the proposal offered no counter to any of them:\n- drop the order.UserId fallback;\n- make the helper's key precedence explicit, consistent with D-3;\n- add the drawdown-half assertion and scenario;\n- record the re-emit volume;\n- list the bracket test callers;\n- record the peer-312 ordering.\n\nNo operator decision exists, so no CHANGE row is marked covered.",
    "register_delta": {
      "new_decisions": [
        {
          "text": "flattenAndHalt passes accountEntry.userID only, with no order.UserId secondary source. An empty owner falls to the D-2 path (WARN plus untargeted).",
          "evidence": "Every pool insert sets userID (trading.go:306, :320, :2614, :2652, :2706). The adversary's C-18 objection got no counter."
        },
        {
          "text": "In emitRiskAlert, the helper-injected user_id and message override any colliding key in extra.",
          "evidence": "Refines D-3 (the helper injects user_id/message). The adversary's precedence objection got no counter."
        },
        {
          "text": "The AC-2 test and a new Gherkin scenario pin both halves: concentration emits concentration_breach, and drawdown still emits drawdown_breach with {user_id, account_id, message} and UserId=owner.",
          "evidence": "AC-2 only guarded concentration, and feature-172 @AC-1 covers the notify alert, not the ledger event (C-15/C-16)."
        }
      ],
      "new_rejected": [
        {
          "text": "order.UserId secondary owner source in flattenAndHalt",
          "why": "Pool userID is never empty (trading.go:306, :320, :2614, :2652, :2706). The branch is untested and speculative (C-18); D-2 covers the empty case."
        },
        {
          "text": "Operator audience question limited to owner-only-now variants",
          "why": "It pre-decides the O-1 fork on the operator's behalf (P-03/C-11). Options (c) owner+admins now and (d) hold AC-1 must be offered."
        }
      ],
      "new_objections": [
        {
          "text": "C-16: the admin-visibility loss (push, stream, inbox) for per-account halt/reconciliation alerts is an unclassified CHANGE. Add a CHANGE row, get operator sign-off in context.md, and cite whether any feature-242 scenario asserts admin delivery.",
          "blocking": true
        },
        {
          "text": "Check prod Slack/SendGrid fanout configuration before asking the operator, or state that it is unknown.",
          "blocking": false
        },
        {
          "text": "Record the ordering dependency on batch peer 312 (untargeted ListAlerts visibility) in context.md and merge-order.md.",
          "blocking": false
        }
      ],
      "closed_objections": [],
      "reopen_petitions": [],
      "reopened": []
    }
  },
  "floor_breaches": []
}
```

## Session 2026-11-13 — sdd-batch design gate (round 3)

## Open Threads

`/sdd-design fix-alert-event-targeting` (full mode) is stopped at its approval gate after round 3. The gate policy is halt. design.md is not written and status.md is unchanged (spec-ready). The register is in `debate.md`: D-1 to D-11, R-1 to R-7, O-1 to O-5 (O-3 and O-4 closed this round).

- **Approach.** The mechanics are unchanged (D-1 to D-7). There is no proto, migration or config change under options (a), (b), (b′) or (d).
  - **Trading (AC-1).** `haltAccount` and `emitReconciliationFinding` take an `ownerUserID` and set `TargetUserId`. reconcileTick passes `entry.userID` and flattenAndHalt passes `accountEntry.userID` only (D-5).
    - An empty owner logs a WARN and sends the alert untargeted (D-2). This path can happen, because `RegisterBrokerAccount` has no guard against an empty caller id (trading.go:2595). That is recorded as an assumption, not a reopen of D-5.
    - The systemic alert, the resume alert and the `reconciliation.mismatch_found` ledger owner (stays "" at trading.go:2018) are not touched. The last one is a **named deferral** (D-8).
    - The bracket test callers (trading_bracket_test.go:602, :628) move to the 5-argument call in the same step as the signature change.
  - **Portfolio (AC-2 plus a new drawdown scenario).** `emitRiskAlert` writes to `portfolio:risk` through `emitEventAs`, attributed to the owner. Concentration emits `portfolio.risk.concentration_breach`, and drawdown keeps `portfolio.risk.drawdown_breach`. The helper's keys win on collision (D-6). The notify alert does not change (D-4). Tests cover both halves (D-7).
  - **Docs.**
    - portfolio CLAUDE.md:149;
    - portfolio findings :63 (mark resolved);
    - ledger CLAUDE.md:113, where `portfolio:risk` is a fixed **global** key with the owner in `AppendEventRequest.user_id` and in the payload (D-9);
    - merge-order.md, a prose note for peer 312;
    - design.md: the double-push decision, owner visibility in owner_only QueryEvents, and the re-emit volume.
  - **Build order.**
    1. Trading signatures, with the bracket test callers.
    2. The rest of the trading tests.
    3. The portfolio split.
    4. The portfolio tests.
    5. The (b′) rule or the (c) notify work, only if chosen.
    6. Docs.
- **Strongest open objection: O-5 (blocking, new), raised together with O-1 and O-2.** The round-3 packet understated what owner-only costs. Only admins can resume a halt (`ResumeAccountSvc` calls `RequireAdminScope`, trading.go:3181; feature-179 @AC-5). Admins also have no in-product way to find another user's halted account:
  - `ListBrokerAccounts` filters by `user_id` (account_repo.go:90);
  - the agent's `manage_account resume` needs an account_id (tools.py:2456);
  - today the untargeted alert's title (trading.go:2895) is the only in-product source of that id.

  Under owner-only, the owner is told but cannot resume, and the admins who can resume get no push, stream entry, inbox entry or list row. The CHANGE row's "After" line must say this.

  One operator prompt must answer O-1, O-2 and O-5, with these options, unweighted:
  - (a) owner-only;
  - (b) owner-only plus a named follow-on /sdd-story, either a notify admin-audience field or an admin-scoped cross-user halted-accounts read;
  - (b′) owner-only plus a Grafana rule on `trading.alert_emit{alert_kind=halt|reconciliation}`, with admins getting the account_id from the Loki ERROR line;
  - (c) owner plus admins now, through an additive notify audience field. This brings in proto approval and notify scope, and it is the only option that gives the resumer an in-product id;
  - (d) ship AC-2 and hold AC-1.

  The earlier recommendation of (b) is **withdrawn as framed**. (b) is acceptable only if it is paired with a named follow-on or with (b′).

  The prompt also asks the double-push sub-question: accept both pushes (proposer leaning), or suppress the halt alert, which changes the feature-294 @AC-4 count.

  The packet must state the following and not present any of it as a mitigation:
  - prod Slack/SendGrid fanout is **unknown** from the repo;
  - `trading.alert_emit` exists, but no alert rule watches it and it has no account_id label (D-10).

  The flip to design-approved refuses to run until the answer is written to this file and to debate.md (P-05).
- **Closed this round.** O-3: fanout is declared unknown, with evidence. O-4: there is no file overlap with peer 312 and either merge order is code-safe. The semantic coupling (312 product-spec.md:94 may narrow `target_user_id IS NULL` visibility for non-admins) is recorded here and as a merge-order.md prose note (D-11).
- **Floor status.** No Floor breaches.
- **Uncovered @AC changes.** No operator decision exists yet, so none of these is covered:
  - @AC-1 (CHANGE);
  - @AC-2 (CHANGE);
  - new @AC-3, drawdown keeps drawdown_breach and is owner-attributed (EXTEND);
  - admin delivery **and remediation reachability** of per-account halt and reconciliation alerts (CHANGE).

  This changes operational reachability, not the text of any @AC. No feature-179 scenario breaks. On feature 242:
  - @AC-5 is generic;
  - @AC-2 limits option (c) to an additive field;
  - no 242 scenario names halt or reconciliation alerts.

  The PRESERVE rows are:
  - feature-242 @AC-2/@AC-3/@AC-5/@AC-6;
  - feature-179 @AC-1/@AC-2/@AC-5;
  - feature-206 @AC-2;
  - feature-231 @AC-3/@AC-9;
  - @AC-45;
  - feature-169 @AC-3;
  - feature-172 @AC-1;
  - feature-294 @AC-4, which becomes a CHANGE only if the operator picks suppression.

```sdd-batch-design-state
{
  "round": 3,
  "synth": {
    "approach": "Round 3 synthesis. The mechanics are unchanged and rest on D-1 to D-7. This round fixes the operator packet. It closes O-3 and O-4, and it adds the remediation-reachability fact that the adversary raised and I checked in the code. No proto, migration or config change under options (a), (b), (b′) or (d).\n\nTRADING (AC-1)\n- New signatures:\n  - `haltAccount(ctx, accountID, ownerUserID, reason string, haltSource int32)` (trading.go:2872)\n  - `emitReconciliationFinding(ctx, accountID, ownerUserID, mismatchClass, orderID string, expected, brokerReported float64)` (trading.go:2014)\n- Both set `TargetUserId: ownerUserID`, following the pattern at :3509.\n- Owner sources:\n  - reconcileTick passes `entry.userID` at :2116, :2126, :2160 and :2239.\n  - flattenAndHalt passes `accountEntry.userID` only (D-5; R-5 stays locked).\n- An empty owner logs a WARN `alert owner unresolved` and sends the alert untargeted. The halt, the mismatch event and the alert are never blocked (D-2). This path is reachable: `RegisterBrokerAccount` has no guard against an empty caller id (trading.go:2595). That is recorded as an assumption, not a reopen of D-5.\n- Not touched: the systemic alert (~:2282-2288), the resume alert (:3219), and the `reconciliation.mismatch_found` ledger owner, which stays \"\" at :2018. That last one is a named deferral in context.md (D-8).\n- Tests:\n  - reconcile templates: trading_reconciliation_test.go:539 and :576;\n  - the systemic alert stays untargeted: :762;\n  - trading_bracket_test.go:602 and :628 move to the 5-argument call in the same step as the signature change. One of them asserts TargetUserId on the HALT_SOURCE_BRACKET_PROTECTION halt;\n  - an empty-owner case.\n\nPORTFOLIO (AC-2 plus a new drawdown scenario)\n- `emitRiskAlert(ctx, userID, eventType, extra, msg)` writes through `emitEventAs` (portfolio_service.go:1342) to `portfolio:risk`. The helper's `user_id` and `message` win over any colliding key in `extra` (D-6).\n- Concentration (:1307) emits `portfolio.risk.concentration_breach` with {symbol}.\n- Drawdown (:1315) keeps `portfolio.risk.drawdown_breach` with {account_id}. `evaluateDrawdowns` returns `[]drawdownBreach{AccountID, Message}` and the message text does not change.\n- The notify alert stays byte-identical (D-4).\n- Tests use fakeLedger.reqs via newQuoteSvc (portfolio_quote_deadline_test.go:96-104) and cover both halves, with a third Gherkin scenario (D-7).\n\nOPERATOR GATE (O-1, O-2 and O-5 go in one prompt)\nThe status flip to design-approved refuses to run until the answer is written to context.md and debate.md (P-05, fails.md:2963-2968). The packet must state these facts, all checked against the code:\n1. Who sees these alerts today. An untargeted alert reaches every user in stream and inbox. StreamAlerts filters only when targetUserId is set (notifyServiceImpl.ts:355), and ListAlerts returns `target_user_id IS NULL` rows to everyone (:239, :247). Admins also get Web Push. Owner-targeting ends that cross-user broadcast, the same reason R-3 was locked.\n2. Who can act on a halt. Only admins can clear one: `ResumeAccountSvc` calls `RequireAdminScope` (trading.go:3181), and feature-179 @AC-5 gives non-admins no Resume control. Admins have no in-product way to discover another user's halted account:\n   - `ListBrokerAccounts` filters `WHERE user_id = $1` (account_repo.go:90);\n   - the agent's `manage_account resume` needs an account_id (agent tools.py:2456, :2507-2513);\n   - today the only in-product source of that id is the untargeted alert's title (trading.go:2895).\n   So under owner-only, the owner is told but cannot resume, and the admins who can resume get no push, no stream entry, no inbox entry and no list row.\n3. Out-of-band signals:\n   - Prod Slack/SendGrid fanout is UNKNOWN from the repo. Neither key is in secrets/production.enc.yaml:2-15; the renderer fills a missing key with \"\" (do-render-app-spec.py:98-102) unless a legacy GitHub secret supplies it; and the sendgrid from/to emails are seeded '' (018_notify_fanout.up.sql:45-55).\n   - `trading.alert_emit` exists, but no alert rule watches it (packages/otel/alerts/alert-rules.yaml has only the error-rate, P99 and heartbeat rules), and it carries no account_id label.\n   - The only signal that names the account is the ERROR log `account halted` (trading.go:2903), and nothing alerts on it.\n4. Feature-242:\n   - @AC-5 (acceptance.feature:39-46) is generic: untargeted alerts push to admins.\n   - @AC-2 (:16-24, :24) forbids pushing a targeted alert to the admin endpoint. So owner-plus-admins needs an additive audience field. Reusing targeting would CHANGE 242 @AC-2.\n   - No scenario names halt or reconciliation alerts.\n5. The C-16 CHANGE row:\n   - Before: \"per-account halt/reconciliation CRITICAL alerts are untargeted: Web Push to admins; stream and inbox to every user; admins learn the account_id from them.\"\n   - After: \"owner-targeted: push, stream and inbox to the owner only. The owner cannot resume. Admins, the only resumers, get no in-product signal or account id.\"\n   - State explicitly that this changes operational reachability, not any @AC text: no feature-179 scenario breaks, because @AC-1/@AC-2 assume the admin is already looking at the account.\n6. Options, offered in full and unweighted by the packet:\n   - (a) owner-only;\n   - (b) owner-only plus a follow-on /sdd-story. The packet names both candidate targets: a notify admin-audience field, and an admin-scoped cross-user halted-accounts read (the actual discoverability fix);\n   - (b′) owner-only plus a Grafana rule in packages/otel/alerts/alert-rules.yaml on any increase of `trading.alert_emit{alert_kind=halt|reconciliation}`. Admins then get the account_id from the Loki ERROR line. No notify or proto change, and not an R-3 variant;\n   - (c) owner plus admins now, via an additive notify audience field. This brings proto approval and notify scope into the fix. It is the only option that gives the resumer an in-product account id;\n   - (d) ship AC-2 and hold AC-1. Non-admin owners keep getting no push.\n   The proposer's earlier recommendation of (b) was framed as \"admins lose only Web Push\". It is withdrawn as framed. Any recommendation must be re-stated against point 2, and (b) is acceptable only if paired with a named follow-on or (b′).\n7. Double-push sub-question:\n   - accept both pushes: no metric change; or\n   - suppress the halt alert when called from a finding: this changes the `trading.alert_emit{alert_kind=halt}` count, so feature-294 @AC-4 would need sign-off.\n   Proposer leaning: accept both.\n\nCode impact per answer:\n- (a), (b), (b′), (d): the code above ships as written. (b′) adds one alert-rule entry. (d) defers the trading half.\n- (c): adds a notify proto field and filter logic, and the approval flow applies.\n\nPEER 312 (O-4, closed)\nNo file overlap; the coupling is semantic. 312 Open Question 2 (312 product-spec.md:94) may narrow `target_user_id IS NULL` visibility for non-admins. Either merge order is code-safe. Record this as a prose note in merge-order.md (styled like :389-399) and in context.md.\n\nDOCS\n- services/xstockstrat-portfolio/CLAUDE.md:149\n- services/xstockstrat-portfolio/docs/context-constitution-findings.md:63 (mark resolved)\n- services/xstockstrat-ledger/CLAUDE.md:113: add `portfolio:risk` as a fixed GLOBAL key, with the owner carried in AppendEventRequest.user_id and in the payload, so it is not read as `portfolio:{user_id}` with user \"risk\" (D-9)\n- merge-order.md: the 312 note\n- context.md: the operator answer, the mismatch_found deferral and the 312 note\n- design.md: the double-push decision, owner visibility in owner_only QueryEvents (ledgerServiceImpl.ts:76-78), and the re-emit volume\n\nBUILD ORDER\n1. Trading signatures and TargetUserId, together with the bracket test callers.\n2. The rest of the trading tests.\n3. The portfolio split.\n4. The portfolio tests, both halves.\n5. The (b′) rule or the (c) notify work, only if chosen.\n6. Docs.",
    "open_objections": [
      {
        "text": "O-1 (still open): the alert audience for per-account halt/reconciliation alerts needs a recorded operator answer to the full option set (a), (b), (b′), (c) and (d), plus the double-push sub-question. It must be written to context.md before design-approved (P-05).",
        "blocking": true
      },
      {
        "text": "O-2 (still open): the C-16 CHANGE row for losing admin delivery needs operator sign-off in context.md. The 242 check is done: @AC-5 is generic, @AC-2 limits option (c) to an additive field, and no scenario names halt or reconciliation alerts.",
        "blocking": true
      },
      {
        "text": "P-03/C-11/C-16: the operator packet and the CHANGE row must state that admins are the only people who can resume a halt (trading.go:3181; feature-179 @AC-5). They also have no in-product way to discover another user's halted account (account_repo.go:90; agent tools.py:2456 needs an account_id; the alert title at trading.go:2895 is today's only in-product source of that id). The CHANGE 'After' line must say: owner notified but cannot resume; admins get no signal or id. The 'admins lose only Web Push' framing and its recommendation (b) must be re-weighed, or (b) paired with a named follow-on (admin cross-user halted-accounts read, or notify audience) or with (b′).",
        "blocking": true
      }
    ],
    "floor_breaches": [],
    "business_rule_changes": [
      {
        "ac_id": "@AC-1",
        "kind": "CHANGE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "@AC-2",
        "kind": "CHANGE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "new @AC-3 (drawdown keeps drawdown_breach, owner-attributed)",
        "kind": "EXTEND",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "admin delivery and remediation reachability of per-account halt/reconciliation alerts (feature-242 untargeted admin audience as applied to these alerts; admins are the only resumers per trading.go:3181)",
        "kind": "CHANGE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "feature-242 @AC-2 (targeted alert not pushed to admins; preserved under a/b/b′/d; under c only via an additive audience field)",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "feature-242 @AC-5",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "feature-242 @AC-3",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "feature-242 @AC-6",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "feature-179 @AC-1",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "feature-179 @AC-2",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "feature-179 @AC-5",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "feature-206 @AC-2",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "feature-231 @AC-3",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "feature-231 @AC-9",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "@AC-45 (systemic alert)",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "feature-169 @AC-3",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "feature-172 @AC-1",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "feature-294 @AC-4 (CHANGE only if the operator picks halt-alert suppression)",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      }
    ],
    "rejected_alternatives": [
      "Framing the cost of owner-only as 'admins lose Web Push, and like every other non-owner lose stream and inbox'. It leaves out that admins are the only resumers and have no other in-product source of the halted account_id (trading.go:3181, account_repo.go:90, trading.go:2895). It tilts the operator toward (b).",
      "Presenting trading.alert_emit as a remaining admin signal. No rule in packages/otel/alerts/alert-rules.yaml watches it, and it carries no account_id label.",
      "Presenting Slack/SendGrid fanout as a safety net. Prod configuration is unknown from the repo (secrets/production.enc.yaml:2-15; do-render-app-spec.py:98-102; 018_notify_fanout seeds '').",
      "Threading ownerUserID into the reconciliation.mismatch_found ledger owner in this fix. It is out of the task's scope, so it is deferred by name instead (trading.go:2018).",
      "Carried forward and still locked: the pool-lookup helper (R-1), the DB fallback (R-2), an untargeted admin copy (R-3), a per-user stream key (R-4), order.UserId as a secondary owner (R-5), and the narrowed operator question (R-6)."
    ],
    "open_risks": [
      "Under (a) or (b) with no paired mitigation, an automatic CRITICAL halt on another user's account can stay halted indefinitely. The owner cannot resume, and admins get no in-product signal and no account id; only the un-alerted Loki ERROR line names the account.",
      "Prod Slack/SendGrid fanout configuration is unknown, so the operator decides without knowing whether an out-of-band admin channel exists.",
      "(c) brings a notify proto field and filter logic into a SEV-2 trading/portfolio fix. Proto approval then needs 2 owners plus the platform lead.",
      "(b′) depends on the Grafana contact points the existing rules use. Admins still need Loki to get the account_id.",
      "(d) leaves non-admin owners with no push for halted accounts, which is the SEV-2 harm itself.",
      "The owner gets two CRITICAL pushes per reconciliation finding unless suppression is sanctioned, and suppression changes the feature-294 @AC-4 metric count.",
      "An account with user_id='' is reachable (no empty-caller guard at trading.go:2595). Its halts take the D-2 untargeted path and still broadcast to every user.",
      "Owner-attributed risk events, re-emitted on every checkRiskLimits run with no dedup, now appear in owner_only QueryEvents/ExportEvents.",
      "External ledger readers of portfolio:risk may depend on concentration arriving as drawdown_breach. Only in-repo consumers were checked.",
      "Peer 312 may narrow untargeted ListAlerts visibility mid-batch, which shrinks the leak argument for targeting but does not reverse it."
    ],
    "constitution_rules_touched": [
      "P-03",
      "P-05",
      "C-11",
      "C-15",
      "C-16",
      "C-18",
      "C-08",
      "C-14",
      "C-10",
      "C-01",
      "F-04"
    ],
    "rationale": "I checked the adversary's new evidence in the code:\n- ResumeAccountSvc calls middleware.RequireAdminScope (trading.go:3181).\n- ListBrokerAccounts filters `WHERE user_id = $1` (account_repo.go:90).\n- emitReconciliationFinding writes mismatch_found with owner \"\" (trading.go:2018).\n- packages/otel/alerts/alert-rules.yaml has no halt or reconciliation rule.\n- ledger CLAUDE.md:113 lists only `portfolio:{user_id}`.\n\nThe evidence bears on O-1 and O-2, which are still open, so it is admissible without a reopen. It does not revive R-3, because an untargeted copy still broadcasts to every user.\n\nIt shows the round-3 packet understated the cost of owner-only. The people who must act on a halt lose the only in-product source of the account id. So a new blocking objection requires the packet and the CHANGE row to say so. The options gain (b′) and the admin halted-accounts read as a named follow-on target, and the earlier (b) recommendation is withdrawn as framed rather than replaced. That honours R-6 and P-03: the synthesis does not pre-decide the audience.\n\nThe proposer answered O-3 concretely (fanout unknown, with evidence), and the adversary agreed, so it closes. O-4 closes the same way: a prose note, with no file overlap.\n\nThe adversary's non-blocking points are adopted as decisions because they are uncontested and touch only docs or packet wording:\n- the metric framing;\n- the mismatch_found deferral;\n- the global-key wording in the ledger doc.\n\nThe D-5 evidence correction (trading.go:2595) stays an assumption. D-5 and R-5 are unchanged, and nobody filed a petition.\n\nNo operator decision is recorded, so no CHANGE row is marked covered, and O-1 and O-2 stay blocking.",
    "register_delta": {
      "new_decisions": [
        {
          "text": "The reconciliation.mismatch_found ledger owner stays \"\" in this fix (trading.go:2018). It is recorded in context.md as a named deferral even though ownerUserID will be in scope one line away.",
          "evidence": "Touch only what the task requires (C-18). trading.ledger_emit labels are event_type/outcome only, so feature-294 @AC-4 is unaffected either way. The adversary raised this as non-blocking and the proposer did not counter."
        },
        {
          "text": "The ledger CLAUDE.md Stream Key row describes portfolio:risk as a fixed global key, with the owner in AppendEventRequest.user_id and in the payload.",
          "evidence": "services/xstockstrat-ledger/CLAUDE.md:113 lists only portfolio:{user_id}, so a bare row would read as a user whose id is 'risk'."
        },
        {
          "text": "The operator packet states prod Slack/SendGrid fanout as unknown, and trading.alert_emit as 'exists, no alert rule watches it, no account_id label'. Neither is presented as a mitigation.",
          "evidence": "secrets/production.enc.yaml:2-15; do-render-app-spec.py:98-102; 018_notify_fanout.up.sql:45-55; packages/otel/alerts/alert-rules.yaml (only the error-rate, P99 and heartbeat rules)."
        },
        {
          "text": "The peer-312 coupling is recorded as a non-blocking prose note in merge-order.md and context.md. Either merge order is code-safe.",
          "evidence": "315 edits no notify files. The semantic coupling is 312 product-spec.md:94 (Open Question 2). merge-order.md:389-399 shows the prose-note pattern."
        }
      ],
      "new_rejected": [
        {
          "text": "Framing owner-only as costing admins only Web Push, plus stream and inbox like any non-owner",
          "why": "Admins are the only resumers (trading.go:3181; feature-179 @AC-5), and today's alert title (trading.go:2895) is their only in-product source of another user's halted account_id (account_repo.go:90; agent tools.py:2456). The framing understates the change and tilts the operator toward (b)."
        }
      ],
      "new_objections": [
        {
          "text": "P-03/C-11/C-16: the operator packet and the CHANGE row must state that admins are the only people who can resume a halt (trading.go:3181) and have no in-product way to discover another user's halted account or its id (account_repo.go:90; tools.py:2456; trading.go:2895). The CHANGE 'After' line must say: owner notified but cannot resume; admins get no signal or id. Offer (b′), a Grafana rule on trading.alert_emit halt/reconciliation, and name the admin cross-user halted-accounts read as a follow-on target. Re-weigh, or pair, the (b) recommendation.",
          "blocking": true
        }
      ],
      "closed_objections": [
        {
          "id": "O-3",
          "how": "Answered with evidence: prod Slack/SendGrid fanout is unknown from the repo (secrets/production.enc.yaml:2-15; do-render-app-spec.py:98-102; 018_notify_fanout seeds ''), and the packet declares it unknown, not as a mitigation. The adversary agreed."
        },
        {
          "id": "O-4",
          "how": "Answered: no file overlap with 312, and either merge order is code-safe. The semantic coupling (312 product-spec.md:94) is recorded as a prose note in merge-order.md and context.md. The adversary agreed."
        }
      ],
      "reopen_petitions": [],
      "reopened": []
    }
  },
  "floor_breaches": []
}
```
