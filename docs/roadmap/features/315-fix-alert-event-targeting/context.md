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
