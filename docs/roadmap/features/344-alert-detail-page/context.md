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

## Session 2026-11-15 — sdd-batch design gate (round 3)

- `/sdd-design alert-detail-page` full debate halted at its approval gate after round 3 (gate policy: halt). `design.md` is not written and `status.md` is unchanged (`spec-ready`). Register: `debate.md` (D-1..D-19, R-1..R-10, O-1..O-9, P-1..P-4).
- Operator rulings applied this round (2026-11-15): O-1 option (a) — accept and record the raw `context["error"]` exposure; O-2 — the bell goes on every page, and the "/trader page load" rewording of `@AC-6` is rejected. R-7 is reopened by that steer.
- This entry supersedes the round-2 `## Open Threads` block above.

## Open Threads

- **Approach (round 3)**: D-1..D-9, D-11 and D-13 are unchanged. New this round:
  - The bell (`AlertStream`) is mounted once in `PlatformHeaderInner` beside `{actions}` and removed from the trader `AppShell`, so every page in every segment has exactly one `StreamAlerts` consumer (D-14). The move, and a `git mv` of the file to `components/shared/`, sit in a step blocked on 339 merged (D-15).
  - Badge refresh uses a shared react-query key (`ALERT_UNREAD_COUNT_KEY` in `src/lib/alertShared.ts`), invalidated through the existing `useInvalidatingMutation` at both mark-read sites (alert page and `AlertInbox.tsx:46`). The proposer's window event lost (R-8): a `QueryClientProvider` already wraps header and page in every segment. This part is **contingent** on the operator reopening one clause each of D-10 and D-12 (P-3, P-4).
  - Spec amendments (D-17): `@AC-6` asserts the badge on the alert page itself; new FR-8 and `@AC-10` (bell on `/trader`, `/insights`, `/config-ui`, `/accounts/profile`); the product-spec Consumer Surface line is amended to match.
  - Under ruling (a), `context["error"]` keeps the raw `str(e)` with no sanitising or redaction (D-16). Non-RPC fallback body: `Backfill job {job_id} failed: unexpected error — see the alert details`.
  - Tests: the badge is asserted on the alert page on a direct load and on a client navigation from the inbox, plus a delayed-first-`ListAlerts` case; the `page.goto('/trader')` step is removed; a 640–1024px overflow check is added for one insights route and one accounts route (D-19).
  - Docs: extend the UI-2 sanctioned exception to the PlatformHeader bell in all segments; findings-log entry for the `PlatformHeader.tsx:43-44` comment (D-18).
- **Strongest open objection — O-7 (blocking)**: the shared-key invalidation contradicts D-10's clause "no unread-count cache or invalidation is invented in 344", and asserting the badge on the alert page contradicts D-12's clauses "names the AlertStream mount refetch as the badge refresh trigger" and "checks the bell after a full page.goto('/trader')". The operator steer reopened R-7 but did not name D-10 or D-12. **Operator must rule on P-3 and P-4** (reopen those clauses only; the rest of both decisions stands). P-2 (R-7) is recorded for the steer already given.
- **Non-blocking**: O-5 (the fallback wording above still needs operator confirmation); O-8 (with the bell on `/accounts/notifications`, the inbox "N unread" and the bell badge come from separate `ListAlerts` calls — the spec must make both honour the same key); O-9 (339 has no design yet — the constraint that it builds its badge refresh on `ALERT_UNREAD_COUNT_KEY` must be written into 339's context or the merge-order note before 339's design runs).
- **Closed this round**: O-1 (ruling (a); P-1 is moot), O-2 (bell on every page), O-6 (the bell no longer depends on the trader shell).
- **Floor status**: no Floor breach. One register conflict, held as petitions P-3 and P-4 and not recorded as decisions.
- **Uncovered `@AC` changes**: `165 @AC-9`, `165 @AC-4` and `271 @AC-5` are EXTEND and not covered by an operator decision. Covered: `344 @AC-6` CHANGE, `344 @AC-8` CHANGE, `344 @AC-10` EXTEND, `270 @AC-9` EXTEND. All other cited scenarios (165 @AC-5, 203 @AC-1..5, 242 @AC-2/5, 270 @AC-12, 334 @AC-20) are PRESERVE. Cross-feature ids are as cited in the debate; only 270 and the 203 badge scenario were re-read (by the adversary).
- **Still outstanding before execute**: the 339 → 344 row in `docs/roadmap/features/merge-order.md` (D-10).

```sdd-batch-design-state
{
  "round": 3,
  "synth": {
    "approach": "Round-3 best approach. D-1..D-9, D-11 and D-13 are unchanged. This round applies the operator's O-1 and O-2 rulings and replaces the proposer's window-event refresh with the adversary's react-query design. I checked the disputed layout facts in the code; they favour the adversary.\n\n**Contingent on two operator reopens.** The badge-refresh and e2e parts below contradict one clause each of settled D-10 and D-12. They stand only if the operator reopens those clauses (petitions below). The mount itself rests on R-7, which the operator steer reopened.\n\n**1. Bell on every page, one stream consumer per page**\n- Render `<AlertStream />` once in `PlatformHeaderInner`, in the right-side cluster beside `{actions}` (services/xstockstrat-ui/src/components/shared/PlatformHeader.tsx:246-247).\n- Remove the import and the mount from the trader shell (src/components/trader/AppShell.tsx:5,24). That is the only mount today (grep), so every page ends with exactly one `StreamAlerts` consumer.\n- Header hosts: trader `AppShell`, insights `AppShell`, src/app/config-ui/layout.tsx:13, src/app/accounts/layout.tsx:25.\n- This step is blocked on 339 merged (D-10 pattern), because 339's scenarios are written against the bell inside the trader `AppShell` actions.\n- In that same blocked step, `git mv` the file to `components/shared/` so `shared/PlatformHeader` does not import from `components/trader/`.\n\n**2. Badge refresh: shared react-query key, no window event**\n- Every segment wraps header and page in one `QueryClientProvider`:\n  - accounts: src/app/accounts/layout.tsx:24-27, via src/components/shared/QueryProviders.tsx:15\n  - config-ui: src/app/config-ui/layout.tsx:12-15\n  - trader and insights: src/app/trader/layout.tsx:10, src/app/insights/layout.tsx:10\n- Export `ALERT_UNREAD_COUNT_KEY` from src/lib/alertShared.ts.\n- The bell's count becomes `useQuery({ queryKey: ALERT_UNREAD_COUNT_KEY, queryFn: () => notifyClient.listAlerts({ limit: 1 }) })`, replacing the mount effect at AlertStream.tsx:19-32.\n- Both mark-read sites go through `useInvalidatingMutation(markAlertRead, [ALERT_UNREAD_COUNT_KEY])` (src/hooks/useInvalidatingMutation.ts:15-32): the alert page (D-7) and AlertInbox.tsx:46.\n- This step is also blocked on 339 merged. A constraint is recorded for 339's design (merge-order.md / feature-overlap note): 339 implements its badge refresh on this same key, so only one mechanism exists.\n\n**3. Spec amendments (operator ruling)**\n- @AC-6 Then: \"the bell on that page shows no unread badge / And after a reload the Notifications list shows the alert as read\".\n- New FR-8: the header bell, with unread badge and Alerts drawer, is shown on every page in every segment, including /accounts/*.\n- New @AC-10 @FR-8: the bell is visible on /trader, /insights, /config-ui and /accounts/profile.\n- Product-spec Consumer Surface line: the bell moves into the shared PlatformHeader; opening an unread alert's page drops the badge on that page.\n\n**4. Tests**\n- Read-state e2e keeps the stateful `page.route()` fixture and the server-returned-id assertion without call counting (D-12, other clauses).\n- The badge is asserted on the alert page itself, on two paths: a direct `page.goto` of the alert URL, and a client navigation from /accounts/notifications by clicking the row title.\n- One extra case delays the first `ListAlerts` response past the `MarkAlertRead` call, to prove the stale response does not overwrite the refreshed count.\n- The `page.goto('/trader')` step is removed.\n- Width: add a 640–1024px overflow check for one insights route and one accounts route. e2e/mobile-overflow.spec.ts covers only 390px on all routes and 1280px on /trader/orders.\n- Existing suites must stay green: e2e/trader/alert-stream.spec.ts, stream-reconnect.spec.ts, live-strategies.spec.ts.\n\n**5. O-1 ruling (a) applied**\n- `context[\"error\"]` keeps the raw `str(e)`. No sanitising, no redaction. D-6 stands and the D-13 findings entry is kept.\n- Non-RPC fallback body: `Backfill job {job_id} failed: unexpected error — see the alert details`. The exception type name is never used (R-5). The wording still awaits operator confirmation.\n\n**6. Docs steps**\n- Extend the UI-2 sanctioned exception (services/xstockstrat-ui/docs/context-constitution.md:17,19) to \"PlatformHeader bell, all segments\", and re-verify its four facts.\n- Findings-log entry: the PlatformHeader.tsx:43-44 comment says react-query is unavailable in /accounts and /config-ui; the layouts contradict it.\n- The 339 → 344 row is still absent from docs/roadmap/features/merge-order.md (grep). It remains an execute precondition (D-10).\n\n**Build order**\nproto → notify getAlert + round-trip test → push url → ingest body → UI BFF + mock + fixture → helpers + page + nav + e2e → inbox link → [after 339] bell move to PlatformHeader + file move + shared key + invalidation + drawer link + read-state/width e2e → docs.",
    "open_objections": [
      {
        "text": "Register: the shared-key invalidation contradicts D-10's clause 'no unread-count cache or invalidation is invented in 344', and asserting the badge on the alert page contradicts D-12's clause 'checks the bell after a full page.goto(\"/trader\")'. Both need an operator reopen of those clauses only. The operator steer reopened R-7 but did not name D-10 or D-12.",
        "blocking": true
      },
      {
        "text": "O-5 (existing): the non-RPC fallback wording 'Backfill job {job_id} failed: unexpected error — see the alert details' still needs operator confirmation. The non-RPC context[\"error\"] value is now defined as str(e) under ruling (a).",
        "blocking": false
      },
      {
        "text": "Two unread counts on one screen: with the bell on /accounts/notifications, the inbox's 'N unread' (AlertInbox.tsx:28) and the bell badge come from separate ListAlerts calls. The spec must either have both read the shared key or show that the inbox count honours the same invalidation (fails.md 2026-10-07; fails.md l.741).",
        "blocking": false
      },
      {
        "text": "339 has no design yet. The constraint that 339 builds its badge refresh on ALERT_UNREAD_COUNT_KEY must be written into 339's context or the merge-order note before 339's design runs; otherwise two mechanisms can land.",
        "blocking": false
      }
    ],
    "floor_breaches": [],
    "business_rule_changes": [
      {
        "ac_id": "344 @AC-6",
        "kind": "CHANGE",
        "covered_by_operator_decision": true
      },
      {
        "ac_id": "344 @AC-10",
        "kind": "EXTEND",
        "covered_by_operator_decision": true
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
        "kind": "EXTEND",
        "covered_by_operator_decision": true
      },
      {
        "ac_id": "270 @AC-12",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "271 @AC-5",
        "kind": "EXTEND",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "334 @AC-20",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      }
    ],
    "rejected_alternatives": [
      "Window event (ALERTS_READ_EVENT / announceAlertsRead) to refresh the badge — lost: its premise is wrong, since a QueryClientProvider already wraps header and page in every segment (accounts/layout.tsx:24-27, config-ui/layout.tsx:12-15). It also has a stale-response race on direct load and adds a second signalling idiom beside useInvalidatingMutation.",
      "Bell in a persistent root layout — lost: app/layout.tsx has no providers, and it changes stream remount behaviour in every segment.",
      "Per-segment bell mounts (one in each layout or AppShell) — lost: four copies; a single mount in PlatformHeaderInner gives one consumer per page.",
      "Keeping the trader AppShell mount alongside the header mount — lost: two StreamAlerts consumers on every trader page.",
      "Reworded @AC-6 'on the next /trader page load' — rejected by the operator.",
      "O-1 options (b) sanitise at ingest and (d) BFF redaction — not chosen: the operator ruled (a).",
      "Leaving AlertStream under components/trader/ with a 'move later' note — lost: unnamed deferral; the move goes in the already-blocked post-339 step.",
      "Round-1 and round-2 rejections R-1..R-6 stand."
    ],
    "open_risks": [
      "339 rewrites AlertStream and has no design yet. If it lands local-state badge refresh instead of the shared key, the blocked step must rework 339's freshly merged code.",
      "Every open tab in any segment now holds a StreamAlerts stream and runs the count query. Subscribers are an in-memory map with no DB cost, per the adversary; I did not re-read notify.",
      "I did not read createQueryClient's staleTime. Trader and insights remount AppShell on navigation, so how often the count refetches there is unknown.",
      "Header width: the trader actions slot already overflows at 1024px (mobile-overflow.spec.ts note). Insights has its own actions, and the 'Live alerts disconnected' text adds width at sm+.",
      "Under ruling (a), raw exception text on broadcast backfill alerts is readable on demand by every authenticated user (accepted by the operator).",
      "Not every route was enumerated; pages without PlatformHeader (/auth/*) stay bell-less.",
      "Cross-feature AC ids (165, 203, 242, 271, 334) are as cited in the debate. The adversary re-read 270 and the 203 badge scenario; I did not re-verify the rest.",
      "No test covers the real notify (ts-proto) → BFF → browser (protobuf-es v2) path for context end to end.",
      "The OS can merge pushes sharing a tag, so a click opens the latest alert's URL in that group (existing behaviour, accepted)."
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
      "PLAT-4",
      "UI-2"
    ],
    "rationale": "No Floor breach. The adversary's verdict was NEEDS WORK on the refresh mechanism only; both sides agree on mounting the bell once in `PlatformHeaderInner`.\n\n- **The disputed fact, checked in code.** `Providers` in accounts/layout.tsx:24-27 and config-ui/layout.tsx:12-15 wraps both `PlatformHeader` and `<main>`, and it is a `QueryClientProvider` (QueryProviders.tsx:15). The proposer's claim that no shared context reaches bell and page is wrong. The comment at PlatformHeader.tsx:43-44 is doc drift.\n- **Mechanism chosen.** The react-query key plus `useInvalidatingMutation` reuses the repo's canonical factory, removes the stale-response race, and gives 339 one seam. The window event loses on all three.\n- **Other adversary points adopted** (proposer gave no counter): mount move blocked on 339, file move in that step, UI-2 exception extension, 640–1024px width check.\n- **Register.**\n  - R-7 is reopened by the operator steer, so the header mount is legitimate.\n  - O-1 closes on ruling (a); P-1 falls away because (b) was not chosen.\n  - O-2 closes on the operator's ruling plus the amended @AC-6, FR-8 and @AC-10.\n  - O-6 closes: the bell no longer depends on the trader shell.\n  - The D-10 and D-12 clause changes are not recorded as new decisions. They go to the operator as petitions, and approval is blocked until they are ruled.\n- **Still open, non-blocking:** O-5 wording, the two-counts drift on the inbox page, and the 339 constraint.",
    "register_delta": {
      "new_decisions": [
        {
          "text": "The bell (AlertStream) is mounted once in PlatformHeaderInner beside {actions}, and its import and mount are removed from the trader AppShell, giving exactly one StreamAlerts consumer per page in every segment.",
          "evidence": "PlatformHeader.tsx:246-247; components/trader/AppShell.tsx:5,24 (only mount, grep); accounts/layout.tsx:25; config-ui/layout.tsx:13; operator steer reopening R-7; agreed by both sides."
        },
        {
          "text": "The mount-move step is blocked on 339 merged, and the same step moves AlertStream.tsx to components/shared/.",
          "evidence": "339 scenarios are written against the bell in trader AppShell actions (AppShell.tsx:20-26); adversary r3 sequencing and layering objections; fails.md l.412; D-10 pattern."
        },
        {
          "text": "Under O-1 ruling (a), the non-RPC context[\"error\"] value is str(e) with no sanitising or redaction; the exception type name is never used in the body.",
          "evidence": "Operator ruling 2026-11-15 (option a); D-6; R-5."
        },
        {
          "text": "@AC-6 asserts the badge on the alert page itself; FR-8 and @AC-10 (bell on every segment including /accounts/*) are added; the product-spec Consumer Surface line is amended to match.",
          "evidence": "Operator decision 2026-11-15 rejecting the '/trader page load' rewording and requiring the bell on all pages."
        },
        {
          "text": "A docs step extends the UI-2 sanctioned exception to the PlatformHeader bell in all segments, and a findings-log entry records the PlatformHeader.tsx:43-44 comment as doc drift.",
          "evidence": "services/xstockstrat-ui/docs/context-constitution.md:17,19; browserClients/notifyClient.ts:5; accounts/layout.tsx:24-27; QueryProviders.tsx:15."
        },
        {
          "text": "The spec adds a 640–1024px overflow check for one insights route and one accounts route.",
          "evidence": "e2e/mobile-overflow.spec.ts:54,76-83; AlertStream.tsx:56; adversary r3, unanswered."
        }
      ],
      "new_rejected": [
        {
          "text": "A window event (ALERTS_READ_EVENT / announceAlertsRead) as the badge refresh signal.",
          "why": "A QueryClientProvider already wraps header and page in every segment; the event has a stale-response race and duplicates useInvalidatingMutation."
        },
        {
          "text": "Mount the bell in a persistent root layout.",
          "why": "app/layout.tsx has no providers and stream remount behaviour would change in every segment."
        },
        {
          "text": "Leave AlertStream under components/trader/ and move it later.",
          "why": "Unnamed deferral; shared/PlatformHeader would import from a segment folder."
        }
      ],
      "new_objections": [
        {
          "text": "The shared-key invalidation and the alert-page badge assertion contradict one clause each of settled D-10 and D-12; the operator must reopen those clauses before approval.",
          "blocking": true
        },
        {
          "text": "With the bell on /accounts/notifications, the inbox 'N unread' and the bell badge come from separate ListAlerts calls; the spec must make both read the shared key or honour the same invalidation.",
          "blocking": false
        },
        {
          "text": "339 has no design yet; the constraint that it builds its badge refresh on ALERT_UNREAD_COUNT_KEY must be recorded in 339's context or the merge-order note before 339's design runs.",
          "blocking": false
        }
      ],
      "closed_objections": [
        {
          "id": "O-1",
          "how": "Operator ruling 2026-11-15, option (a): accept and record. context[\"error\"] keeps the raw text, no redaction, D-6 stands, the D-13 findings entry is kept. P-1 is moot because option (b) was not chosen."
        },
        {
          "id": "O-2",
          "how": "Operator ruling 2026-11-15: the bell goes on every page. Answered by the single PlatformHeaderInner mount, the amended @AC-6, new FR-8 and @AC-10, and the amended Consumer Surface line. The refresh mechanism continues under the new blocking objection."
        },
        {
          "id": "O-6",
          "how": "The bell moves to PlatformHeader and the page.goto('/trader') assertion is dropped, so the trader AppShell mount no longer matters; the adversary also accepted app/trader/page.tsx:3,22."
        }
      ],
      "reopen_petitions": [
        {
          "target": "R-7",
          "evidence": "Operator ruling 2026-11-15 requires the bell on every page including /accounts/*. Moving the mount into PlatformHeaderInner removes trader's copy (AppShell.tsx:24), so the 'second consumer per accounts page' premise no longer holds.",
          "is_new": true
        },
        {
          "target": "D-10",
          "evidence": "Clause 'no unread-count cache or invalidation is invented in 344' only. The accounts header is rendered at layout level and persists across list → detail navigation (accounts/layout.tsx:24-27), so the mount refetch never fires where the operator requires the badge to drop. Narrowed per the adversary: 344 adds a react-query invalidation of a shared unread-count key through the existing useInvalidatingMutation.",
          "is_new": true
        },
        {
          "target": "D-12",
          "evidence": "Clauses 'names the AlertStream mount refetch as the badge refresh trigger' and 'checks the bell after a full page.goto(\"/trader\")' only. The operator ruling 2026-11-15 requires the badge drop to be observable on the page where the alert is opened; the layout-level accounts header does not remount. The rest of D-12 stands.",
          "is_new": true
        }
      ],
      "reopened": [
        "R-7"
      ]
    }
  },
  "floor_breaches": []
}
```
