# Context: alert-detail-page

**Feature**: `docs/roadmap/features/344-alert-detail-page/feature.md`
**Product Spec**: `docs/roadmap/features/344-alert-detail-page/product-spec.md`
**Implementation Spec**: `docs/roadmap/features/344-alert-detail-page/implementation-spec.md`

---

## Session 2026-11-15 — sdd-story

- Created feature.md (status: draft), product-spec.md, acceptance.feature, context.md from an operator report (staging, homelab, with screenshots) and same-day read-only recon.
- Operator decisions (2026-11-15): a **dedicated page** per alert (not an expandable row), showing severity, category, source service, time, full body, context fields and correlation ID. Operator's original report: "there's no single view or page to see all the details for an alert/notification".
- Scope folded in by routing agreed with the operator: readable error text for backfill-failure alerts (FR-7).
- Operator decision (2026-11-15, follow-up): **opening the alert's page marks it read** (FR-5).
- Proposed by me, unconfirmed: the URL shape `/accounts/notifications/<alert_id>`.
- Recon facts: notify proto has no get-by-id RPC (`notify.proto:14-39`); `Alert` fields at `:42-58`; inbox at `src/app/accounts/notifications/AlertInbox.tsx`; drawer at `src/components/trader/AlertStream.tsx`; body built at ingest `servicer.py:519-544` from `str(e)` (`:574-593`).

## Session 2026-11-15 — sdd-review product-spec

- Product spec approved. Status: draft → spec-ready.
- Warnings (6, none blocking):
  - Nav (C-10): the `Notifications` entry matches its path exactly (`PlatformHeader.tsx:94,103`; same entry at `navGroups.tsx:89`), so it would not stay highlighted at `/accounts/notifications/<alert_id>`. Spec reworded to require it; **design must change the match mode** for this entry in both places.
  - Proto: `GetAlert` is additive; spec now names the `buf breaking` / 1-owner path. `Alert` fields `source_service=6`, `correlation_id=12`, `read_at=14` confirmed in `notify.proto`.
  - Scenarios: `@AC-1` asserts "shows the alert as read" (an FR-5 effect) — tagged `@FR-5` in this session. The NOT_FOUND → "Alert not found" BFF trap is covered by `@AC-2` (spec now cites it).
  - Open Questions: the garbled FR-7 bullet was reworded (job row and ledger event unchanged; design confirms no other reader depends on the old body).
  - Consumer surface: the bell unread-badge effect (`@AC-6`) is now named in the surface description. Push deep link (FR-6) depends on the service worker and notify's push payload — **design must confirm**.
  - Peer dependency: 339-fix-symbol-page-alerts-ui lands first. **Still open:** the `merge-order.md` row is the review router's to record; this session may edit only the feature directory, so it is not yet written.
- Overlap findings (WARN only, no FAIL):
  - [file] `services/xstockstrat-notify/src/grpc/notifyServiceImpl.ts` — `GetAlert` next to `listAlerts` (:225) vs 316-fix-notify-stream-contract (spec-ready; edits :15, :87, :288). Disjoint regions, rebase-only.
  - [file] `AlertStream.tsx` drawer — FR-4 links vs 339-fix-symbol-page-alerts-ui (draft), which changes the same drawer. Ordering dependency: 339 first.
  - Proto, migrations, config: no collision (344 adds only `rpc GetAlert`, no migration, no config key).
- Recommended design depth: full (proto change, 3 affected services, warning-level overlap)

OPERATOR DECISIONS (binding, recorded 2026-11-15):
- A dedicated page per alert (not an expandable row) showing severity, category, source service, time, full body, context fields and correlation ID.
- Opening the alert's page marks it as read.
- Backfill-failure alert bodies are plain-language; the raw exception text stays only in the alert context.
- fix-symbol-page-alerts-ui changes the same Alerts drawer component; treat it as landing first.

## Session 2026-11-15 — sdd-batch design gate (round 2)

- `/sdd-design alert-detail-page` full debate halted at its approval gate after round 2 (gate policy: halt). `design.md` is not written and `status.md` is unchanged (`spec-ready`). Register: `debate.md` (D-1..D-13, R-1..R-7, O-1..O-6, P-1).
- Operator answer relayed this run: "Opening the alert's page marks it as read." It matches D-7. It does not rule on the bell wording or the raw-text exposure.

## Open Threads

- **Approach (round 2)**: the round-1 design (D-1..D-9) is unchanged — additive `GetAlert` RPC, notify `getAlert` with header-only identity and code 5 for missing / not-visible / malformed ids, `context` mapped only in `getAlert`, push `url` in the existing `PushPayload.url`, plain ingest body with the raw text kept in `context["error"]`, UI page at `/accounts/notifications/[alert_id]` that marks read after a successful GetAlert. Round 2 added spec requirements only: the drawer-link and badge re-verify steps are blocked on 339 merged (D-10), three required tests (D-11), a stateful `page.route()` fixture for the read-state e2e (D-12), and a findings-log entry on the existing StreamAlerts exposure (D-13). Code citations are as given by the proposer and adversary; they were not re-read this round.
- **Strongest open objection — O-1 (blocking)**: GetAlert plus the page makes the raw exception text in `context["error"]` readable on demand, indefinitely, by every authenticated user on broadcast backfill alerts. Today it reaches only sessions connected when the alert fires and is held in memory. Operator must choose: (a) accept and record (current design); (b) sanitise at ingest — this reverses the binding decision "raw exception text stays only in the alert context" and D-6, so it needs an explicit reversal (petition P-1, pending user) with `@AC-8`, FR-7 and Open Questions amended together; (d) the UI BFF drops `error` for non-admin sessions, leaving the stream exposure. The proposer recommends (a); the adversary judges (b) the better fix.
- **O-2 (blocking)**: the `@AC-6` bell assertion is not observable on `/accounts/*` (no bell there; R-7 rejects adding one). Proposed wording: "Then on the next /trader page load the bell shows no unread badge / And after a reload the Notifications list shows the alert as read", with the product-spec Consumer Surface line amended in the same change. Needs operator sign-off recorded here.
- **Non-blocking**: O-5 (non-RPC fallback body and non-RPC `context["error"]` value depend on the O-1 ruling; wording needs operator confirmation); O-6 (AppShell mounting on the `/trader` page used by the bell assertion is unverified).
- **Floor status**: no Floor breach; no register violation.
- **Uncovered `@AC` changes**: `344 @AC-6` CHANGE — not covered by an operator decision (O-2). `165 @AC-9` and `165 @AC-4` EXTEND — not covered. `344 @AC-8` CHANGE is covered by the operator decision on plain-language bodies. All other cited scenarios (165 @AC-5, 203 @AC-1..5, 242 @AC-2/5, 270 @AC-9, 271 @AC-5, 334 @AC-20) are PRESERVE; cross-feature ids are as cited in the debate, not re-verified against the feature files.
- **Still outstanding before execute**: the 339 → 344 row in `docs/roadmap/features/merge-order.md` (D-10).

```sdd-batch-design-state
{
  "round": 2,
  "synth": {
    "approach": "Round-2 best approach: the round-1 design (D-1..D-9) is unchanged. This round adds test and spec requirements, corrects the evidence behind the two operator questions, and still leaves both to the operator. I did not re-read the code this round; path:line citations are as given by the proposer and adversary.\n\nUNCHANGED FROM ROUND 1 (D-1..D-9)\n- Proto: additive `GetAlert(GetAlertRequest { alert_id = 1 }) returns (Alert)` in packages/proto/notify/v1/notify.proto. No migration, no config keys.\n- Notify (services/xstockstrat-notify/src/grpc/notifyServiceImpl.ts):\n  - `getAlert` takes identity from the x-user-id header only; code 3 without it.\n  - UUID shape check; missing, not-visible and malformed ids all return code 5.\n  - Reuses the join and predicate at :236-239.\n  - `context` is mapped only in getAlert via a spread over `rowToAlert` (:371-391 unchanged).\n  - Alert.encode/decode round-trip unit test.\n  - Push payload gains `url` in the existing PushPayload.url (src/fanout/webPush.ts:51,143-148).\n- Ingest (services/xstockstrat-ingest/app/handlers/servicer.py):\n  - Plain detail body via an optional `detail` passed only at :591-593.\n  - `context[\"error\"]` keeps the raw str(e) (D-6 and the operator decision). This stays the design unless the operator reverses it.\n- UI (services/xstockstrat-ui):\n  - BFF `getAlert` in src/lib/traderBff.ts.\n  - Page at src/app/accounts/notifications/[alert_id]/page.tsx plus AlertDetail.tsx.\n  - `formatWhen` and `contextEntries` in src/lib/alertShared.ts.\n  - Mark read after a successful GetAlert, using the server-returned id.\n  - `Code.NotFound` shows \"Alert not found\".\n  - Title link in AlertInbox.tsx:116.\n  - PlatformHeader.tsx:94 matches by prefix; child route added to e2e/nav-reachability.spec.ts:53.\n\nADDED THIS ROUND (spec contract)\n1. 339 gating:\n   - The drawer-link step (@AC-5) carries `blocked-on: 339 merged`. Anchors are re-grepped then (today the title is at components/trader/AlertStream.tsx:104-117 and will change).\n   - A 339 → 344 row in docs/roadmap/features/merge-order.md must exist before execute.\n   - A second step, also blocked on 339, re-greps the badge source and either reuses 339's invalidation or confirms the mount refetch still runs. No cache or invalidation is invented now.\n2. Required tests:\n   - e2e: getAlert NOT_FOUND renders \"Alert not found\", keyed on Code.NotFound.\n   - vitest: `contextEntries` over a JsonObject (string, list, number, `{}`).\n   - notify: encode/decode round-trip (D-4).\n3. Read-state e2e (applies whatever @AC-6 finally says):\n   - The shared mock cannot prove it: e2e/mock-backend.ts:685-693 returns a fixed MOCK_UNREAD_COUNT and `markAlertRead` stores nothing.\n   - The spec must require a stateful `page.route()` fixture that drops the unread count to 0 once the page calls MarkAlertRead.\n   - It must assert MarkAlertRead was called with the server-returned id (D-7), without counting calls.\n   - The badge refresh trigger is named: the AlertStream mount refetch `listAlerts({limit:1})` (AlertStream.tsx:19-32).\n   - The bell check runs after a full `page.goto('/trader')`.\n   - Before writing that step, the spec greps the trader layout chain to confirm that page mounts AppShell (components/trader/AppShell.tsx:20-24).\n   - Fixture and INVENTORY.md row per C-13.\n4. No bell on /accounts/*: app/accounts/layout.tsx:25 renders PlatformHeader without actions. Mounting AlertStream there would add a second StreamAlerts consumer on the component 339 rewrites.\n5. No scope-based redaction in notify getAlert: it leaves the same field on StreamAlerts, and notify parses no x-access-scope (services/adminDirectory.ts:11 is outbound only).\n6. Findings-log entry, whatever the O-1 ruling: StreamAlerts already sends `context`, including the raw error, to every connected subscriber of a broadcast alert (notifyServiceImpl.ts:113,121-124,354-357).\n\nOPERATOR QUESTIONS (both block approval)\nQ-A (O-1), with the evidence corrected:\n- Today the raw exception text reaches only users with a /trader AlertStream open when the alert fires. It is held in React state (cap 50) and lost on remount or Clear all (AlertStream.tsx:35-46,87). No UI renders it, and ListAlerts never returns it.\n- GetAlert plus the page makes it readable on demand, indefinitely, by every authenticated user, including users who were offline at emit time. This is a real widening, not the same exposure.\n- The platform already limits untargeted alerts to admins on push (NOTIFY-8, feature 242 @AC-5).\n- Options:\n  - (a) Accept and record. This is the current design; it follows the two operator decisions literally.\n  - (b) Ingest writes the plain detail into `context[\"error\"]`; the raw text stays only in the job row and ledger (servicer.py:584,589).\n    - This reverses the operator decision \"raw exception text stays only in the alert context\" and settled D-6, so it needs an explicit operator reversal and a D-6 reopen.\n    - It also needs @AC-8, product-spec FR-7 and Open Questions amended together.\n    - The sanitised value is passed only from :591-593, because `ctx.update` at :529 is shared with other callers.\n  - (d) The UI BFF getAlert handler drops `error` for non-admin sessions (session claims at traderBff.ts:97-101). The stream exposure stays.\n- The proposer recommends (a); the adversary judges (b) the better fix. The design cannot choose.\n\nQ-B (O-2): amend @AC-6.\n- Proposed wording: \"Then on the next /trader page load the bell shows no unread badge / And after a reload the Notifications list shows the alert as read\".\n- Amend in the same change the product-spec Consumer Surface line \"The header bell's unread badge drops when an unread alert's page is opened\".\n- Sign-off is recorded in context.md. The relayed operator answer confirms mark-read on open but does not address the bell wording.\n\nBUILD ORDER (unchanged): proto → notify getAlert + round-trip test → notify push url → ingest body → UI BFF + mock + fixture → shared helpers + page + nav + e2e → inbox link → [after 339] drawer link + badge re-verify → docs.",
    "open_objections": [
      {
        "text": "O-1 (existing, evidence corrected): raw exception text in context[\"error\"]. Today it reaches only sessions connected at emit time and is held in memory (AlertStream.tsx:35-46,87). GetAlert makes it durably readable on demand by every authenticated user on broadcast backfill alerts. Push already limits untargeted alerts to admins (NOTIFY-8). Needs an operator ruling between (a) accept and record, (b) sanitise at ingest, (d) BFF redaction for non-admins. Option (b) reverses a binding operator decision and settled D-6; it needs an explicit reversal plus a D-6 reopen, with @AC-8 and product-spec FR-7 / Open Questions amended together.",
        "blocking": true
      },
      {
        "text": "O-2 (existing): the @AC-6 bell assertion is not observable on /accounts/*. The proposed rewording ('on the next /trader page load the bell shows no unread badge') and the matching product-spec Consumer Surface line need operator sign-off recorded in context.md. The 339 badge-refresh re-verify step stays required.",
        "blocking": true
      },
      {
        "text": "The non-RPC fallback body 'unexpected error — see the alert details' depends on the O-1 ruling. Under (a) it points users at the raw str(e). Under (b) no sanitised context[\"error\"] is defined for non-RPC exceptions. The impl-spec must define the fallback wording and the non-RPC context[\"error\"] value for whichever ruling lands. The wording is a proposer choice still unconfirmed by the operator.",
        "blocking": false
      },
      {
        "text": "Unverified: that AppShell (and so AlertStream) mounts on the /trader page the e2e loads. Only AppShell.tsx:24 was read. The spec must grep the trader layout chain and name the exact page (page.goto('/trader')) before writing the bell assertion.",
        "blocking": false
      }
    ],
    "floor_breaches": [],
    "business_rule_changes": [
      {
        "ac_id": "344 @AC-6",
        "kind": "CHANGE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "344 @AC-8",
        "kind": "CHANGE",
        "covered_by_operator_decision": true
      },
      {
        "ac_id": "165 @AC-9",
        "kind": "EXTEND",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "165 @AC-4",
        "kind": "EXTEND",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "165 @AC-5",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "203 @AC-1",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "203 @AC-2",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "203 @AC-3",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "203 @AC-4",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "203 @AC-5",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "242 @AC-2",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "242 @AC-5",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "270 @AC-9",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "271 @AC-5",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "334 @AC-20",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      }
    ],
    "rejected_alternatives": [
      "O-1 option (c), strip `error` in notify getAlert for callers without admin scope — lost: StreamAlerts still sends the same field (notifyServiceImpl.ts:113,124), and notify has no x-access-scope parsing, so it is new mechanism that does not close the exposure.",
      "Mount the bell (AlertStream) in the /accounts/* header so @AC-6 is observable as written — lost: opens a second StreamAlerts consumer per accounts page and adds scope on the component 339 rewrites (app/accounts/layout.tsx:25).",
      "Invent a shared unread-count cache or invalidation hook now — lost: 339's mechanism is unknown; reuse the existing AlertStream mount refetch and re-verify after 339 merges.",
      "Assert the bell badge against the shared e2e mock — lost: mock-backend.ts:685-693 returns a fixed unread count and stores nothing on markAlertRead, so the test would fail or prove nothing; use a stateful page.route() fixture.",
      "Treat O-1 option (b) as only a rewording of @AC-8 — lost: it reverses a binding operator decision and settled D-6, so it needs an explicit operator reversal and a D-6 reopen.",
      "O-1 option (d), BFF-side redaction of `error` for non-admins — not chosen by the design: it adds a field filter and leaves the stream exposure; kept as an option for the operator, not locked.",
      "All round-1 rejections stand (R-1..R-5)."
    ],
    "open_risks": [
      "Both blocking items depend on operator rulings. If the operator picks (b) for O-1, D-6, @AC-8 and FR-7 are reworked together and the fallback text must be redefined.",
      "339's badge mechanism is unknown. If it lands a cached unread count that survives client navigation and has no invalidation hook, the amended @AC-6 could fail and force a change to 339's code after it merges.",
      "Under option (a), internal peer address and grpc-core text on broadcast backfill alerts are readable by every authenticated user indefinitely.",
      "No test exercises the real notify (ts-proto) → BFF → browser (protobuf-es v2) wire path for context end to end.",
      "createDispatch code pass-through is still unread; the NOT_FOUND e2e is the only check.",
      "The OS can merge pushes sharing a tag (webPush.ts:147), so a click opens the latest alert's URL in that group (existing behaviour, accepted).",
      "Cross-feature AC ids (165, 203, 242, 270, 271, 334) are as cited in the debate; I did not re-verify them against the feature files."
    ],
    "constitution_rules_touched": [
      "C-01",
      "C-10",
      "C-11",
      "C-13",
      "C-15",
      "C-16",
      "C-18",
      "P-02",
      "P-03",
      "F-04",
      "NOTIFY-7",
      "NOTIFY-8",
      "PLAT-4"
    ],
    "rationale": "There is no Floor breach and no register violation: the approach rests on D-1..D-9 and honours R-1..R-5. The adversary's verdict was NEEDS WORK on three blocking points.\n\n- **O-1 evidence.** The proposer's case for (a) rested on \"the same data already reaches browsers\". The adversary showed that exposure is short-lived and limited to sessions connected at emit time, while GetAlert makes it durable and on demand. I adopted the corrected framing. The question stays with the operator because it is a security trade-off.\n- **Option (b) and the register.** Option (b) contradicts the operator decision and settled D-6. The approach therefore keeps D-6 as the design and records (b) as a conditional reopen petition, not as a new decision.\n- **@AC-6 test.** The amended scenario cannot be proven with the current mock. The fix (stateful `page.route()` fixture, named refetch trigger, assertion on the server-returned id) is cheap and unchallenged, so it is adopted as a spec requirement that holds whatever the final wording is.\n\nO-3 and O-4 are closed: the proposal answered them concretely with the blocked-on marker, the merge-order row precondition and three named tests. Two smaller points stay open as non-blocking: the fallback body wording depends on the O-1 ruling, and the AppShell mount on /trader is unverified.\n\nThe relayed operator answer (\"Opening the alert's page marks it as read\") matches D-7. It does not rule on the bell wording or the raw-text exposure, so @AC-6 remains an unsanctioned CHANGE and O-1 and O-2 stay blocking.",
    "register_delta": {
      "new_decisions": [
        {
          "text": "The drawer-link step and a badge-source re-verify step are marked blocked-on 339 merged, with anchors re-grepped then; a 339 → 344 row in merge-order.md must exist before execute; no unread-count cache or invalidation is invented in 344.",
          "evidence": "AlertStream.tsx:19-32,104-117; operator decision that 339 lands first; proposal r2, unchallenged (adversary C-18 note)."
        },
        {
          "text": "The impl-spec requires three tests: e2e getAlert NOT_FOUND → 'Alert not found' keyed on Code.NotFound; vitest contextEntries over a JsonObject (string, list, number, {}); notify Alert encode/decode round-trip.",
          "evidence": "Proposal r2 O-4 answer; D-4; D-8; unchallenged by the adversary."
        },
        {
          "text": "The read-state e2e uses a stateful page.route() fixture that drops the unread count to 0 once MarkAlertRead is called, asserts the call carries the server-returned id without counting calls, names the AlertStream mount refetch as the badge refresh trigger, and checks the bell after a full page.goto('/trader').",
          "evidence": "e2e/mock-backend.ts:685-693 (fixed MOCK_UNREAD_COUNT, markAlertRead stores nothing); AlertStream.tsx:19-32; fails.md 2026-10-07 lines 2773-2776; D-7."
        },
        {
          "text": "A findings-log entry records that StreamAlerts already sends context, including the raw error, to every connected subscriber of a broadcast alert, whatever the O-1 ruling.",
          "evidence": "notifyServiceImpl.ts:113,121-124,354-357; agreed by proposer and adversary."
        }
      ],
      "new_rejected": [
        {
          "text": "Strip the `error` key in notify getAlert for callers without admin scope (O-1 option c).",
          "why": "StreamAlerts still sends the same field, and notify has no x-access-scope parsing; new mechanism that does not close the exposure."
        },
        {
          "text": "Mount the bell (AlertStream) in the /accounts/* header to satisfy @AC-6 as written.",
          "why": "Adds a second StreamAlerts consumer per accounts page and scope on the component 339 rewrites; both sides rejected it."
        }
      ],
      "new_objections": [
        {
          "text": "The non-RPC fallback body 'unexpected error — see the alert details' and the non-RPC context[\"error\"] value are undefined until O-1 is ruled; the impl-spec must define both for the ruling that lands, and the wording needs operator confirmation.",
          "blocking": false
        },
        {
          "text": "AppShell mounting on the /trader page used by the bell assertion is unverified; the spec must grep the trader layout chain and name the exact page loaded.",
          "blocking": false
        }
      ],
      "closed_objections": [
        {
          "id": "O-3",
          "how": "Adopted into the spec contract: drawer-link step marked blocked-on 339 merged with anchors re-grepped then, and the merge-order.md 339 → 344 row is a precondition of execute."
        },
        {
          "id": "O-4",
          "how": "Adopted into the spec contract: NOT_FOUND e2e keyed on Code.NotFound, contextEntries vitest over a JsonObject, and the notify encode/decode round-trip test are required. The fallback-text wording moves to a new non-blocking objection."
        }
      ],
      "reopen_petitions": [
        {
          "target": "D-6",
          "evidence": "Conditional, raised by the adversary and applicable only if the operator rules O-1 option (b): GetAlert turns a short-lived, connected-session-only exposure of context[\"error\"] (AlertStream.tsx:35-46,87; ListAlerts never returns context) into durable on-demand read access for every authenticated user, and push already limits untargeted alerts to admins (NOTIFY-8, feature 242 @AC-5). Option (b) would move the raw text out of context, reversing D-6 and the operator decision 'raw exception text stays only in the alert context'.",
          "is_new": true
        }
      ],
      "reopened": []
    }
  },
  "floor_breaches": []
}
```
