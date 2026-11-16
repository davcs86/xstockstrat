# Context: alert-detail-page

> Distilled 2026-11-15 by /sdd-distill. Full pre-distill session prose is in git history (before this commit).

**Feature**: `docs/roadmap/features/344-alert-detail-page/feature.md`
**Product Spec**: `docs/roadmap/features/344-alert-detail-page/product-spec.md`
**Implementation Spec**: `docs/roadmap/features/344-alert-detail-page/implementation-spec.md`

## Decisions

OPERATOR DECISIONS (binding, recorded 2026-11-15):
- A dedicated page per alert (not an expandable row) showing severity, category, source service, time, full body, context fields and correlation ID.
- Opening the alert's page marks it as read.
- Backfill-failure alert bodies are plain-language; the raw exception text stays only in the alert context.
- fix-symbol-page-alerts-ui changes the same Alerts drawer component; treat it as landing first.

Operator rulings after that block (all 2026-11-15; quotes verbatim):
- Original report (sdd-story): "there's no single view or page to see all the details for an alert/notification". Readable error text for backfill-failure alerts (FR-7) was folded in by routing agreed with the operator.
- Round-2 relay: "Opening the alert's page marks it as read." — matches D-7 (FR-5); it did not rule on the bell wording or the raw-text exposure.
- Round 3, O-1: option (a) — accept and record that GetAlert makes the raw exception text in `context["error"]` readable on demand by every authenticated user; no sanitising, no redaction (D-6 stands, D-16; signs off `344 @AC-8`). Options not chosen: (b) sanitise at ingest (would reverse the binding "raw exception text stays only in the alert context" decision; petition P-1 → `user declined`); (d) the UI BFF drops `error` for non-admin sessions.
- Round 3, O-2: the bell with its unread badge goes on every page, including `/accounts/*` (D-14, D-17; `344 @AC-6`, new `@AC-10`, FR-8). The "/trader page load" rewording of `@AC-6` is rejected. This steer reopened R-7.
- Round 4 steer: R-7, the D-10 clause "no unread-count cache or invalidation is invented in 344" and the two D-12 clauses ("names the AlertStream mount refetch as the badge refresh trigger"; "checks the bell after a full page.goto('/trader')") are reopened; D-20 and D-21 supersede exactly those clauses, the rest of D-10 and D-12 stands. P-2, P-3, P-4 → `user reopened` (not `user declined`).
- Design gate, round 4: "the round-4 design is APPROVED". Floor clear. Status spec-ready → design-approved.
- Relayed to both the sdd-spec and the impl-spec-review runs, verbatim: "1. Approved / 2. Confirmed / 3. Sign-off the change, amend it / 4. There are no production instances. Staging is enough." The questions they answer were not relayed. Applied: item 3 only, as the sign-off to amend the spec artifacts per D-17. Items 1, 2 and 4 are applied to nothing; "Confirmed" is **not** recorded as closing O-5.
- O-5 (Step 7 non-RPC fallback wording): "Sounds good" — accepted; Step 7 and Step 8 case 3 stand (see the orchestrator session below).

Design (settled; full text in `design.md` and `debate.md` — D-1..D-26, R-1..R-13, O-1..O-9, P-1..P-4):
- Chosen approach: additive `GetAlert` RPC with header-only identity; alert page at `/accounts/notifications/[alert_id]` that marks read after a successful load; the bell mounted once in `PlatformHeaderInner`; all alert read models under the `['alerts']` react-query prefix, invalidated by every mark-read path; plain-language backfill-failure body with the raw text kept in `context["error"]`. Rejected: R-1..R-6, R-8..R-13; R-7 was reopened by the operator and adopted as D-14.
- The URL shape `/accounts/notifications/<alert_id>` was proposed by the agent at sdd-story and never confirmed on its own; it is covered only by the round-4 design approval.
- Register closed out with State `approved`. No ledger line was written: the debate's traps (a stream reconnect re-delivers alerts; a layout-level header does not remount) are recorded in `debate.md` D-21 and D-24.
- No migration (notify stays at `005`, ingest at `016`), no config key, no env var.
- Implementation spec: 23 steps; Steps 17–22 are blocked on 339 merged; impl-spec review PASS WITH WARNINGS (0 failures, 8 warnings, 0 Floor breaches).

## Open Threads

- [x] O-5: the non-RPC fallback body `Backfill job {job_id} failed: unexpected error — see the alert details` — closed by the operator ("Sounds good", 2026-11-15); `debate.md`, `design.md` and `implementation-spec.md` still show it open.
- [ ] O-9 (open, blocks Steps 17–22): the 339 → 344 row in `docs/roadmap/features/merge-order.md` is missing — target: before Step 17; owner is the orchestrator (separate PR to main-dev).
- [ ] Steps 17–22 cite pre-339 anchors and 339 symbols not in this tree; do not run them as written before 339 merges — target: re-run `/sdd-spec alert-detail-page` after 339 merges, before Step 17; otherwise every gate adaptation goes in the Deviation Log (F-09).
- [ ] Badge value shape (339 merged-list length vs design.md §7 server count) — target: Step 19 decision rule, or the re-spec.
- [ ] Steps 18 and 20 leave the assertion path to the executor ("state which was used"); Step 21 has a `SheetClose` grep-else-stop — target: tighten in the re-spec after 339 lands.
- [ ] Step 13 `PlatformHeader.tsx:94` edit is a no-op in the rendered shell (C-18) — made as written in Step 13 (design.md §5); the keep/drop question was not put to the operator. Target: operator may drop it at the integration PR; Step 14's `aria-current` guard covers C-10(a) either way.
- [ ] Steps 5+6 fold has no §C trigger (design.md §2 requires it) — target: operator may waive at the execute checkpoint; advisory.
- [ ] Notify Reviewers focus text on Steps 1–6 is the registry's stream wording — cosmetic; target: none.
- [ ] 316 (`spec-ready`) shares `notifyServiceImpl.ts` and its test file with Steps 3–4; `merge-order.md` has no 316 vs 344 note and a stale 334 status at `:397` — target: orchestrator; whichever merges second re-greps.
- [ ] design.md §8 says "one step" blocked on 339; the spec splits it into Steps 17–22 — the review raised the stack of six blocked steps and no objection to the split itself.
- [ ] Inbox list on `useQuery` changes loading and error timing; the 203 inbox e2e could be disturbed — target: Step 19 verification.
- [ ] Bell refetch on window focus and single retry can perturb the delayed-first-response e2e — target: Step 20 (`--repeat-each=3`).
- [ ] `invalidateQueries` cancelling an in-flight first fetch is untested — target: Step 20 delayed-first-`ListAlerts` case.
- [x] Header width at 640–1024px with the bell in the insights and accounts headers — closed in Step 18: the six D-19 cases pass after the operator-approved icon-only Primary nav between 640px and 768px.
- [x] Every open tab holds a `StreamAlerts` stream and runs the count query — accepted; recorded in `services/xstockstrat-ui/docs/pwa-push.md` (Step 23).
- [x] Raw exception text on broadcast backfill alerts is readable on demand by every authenticated user — accepted by the operator (ruling (a)); recorded in the notify findings log (Step 23).
- [ ] No end-to-end test of `context` over the real notify → BFF → browser path — accepted gap; covered in halves by Steps 4, 10 and 12.
- [ ] The four relayed operator answers ("1. Approved / 2. Confirmed / …") have no recorded questions; items 1, 2 and 4 ("There are no production instances. Staging is enough.") are unapplied — target: orchestrator states what they answered before execute.
- [x] `origin/main-dev` was not merged into the feature branch at sdd-spec (4 commits ahead then, docs and `uv.lock` only); it adds NOTIFY-14..17 to the notify constitution — Step 23 re-grepped: NOTIFY-14..17 present, NOTIFY-7 amended in place.
- [ ] `165 @AC-9`, `165 @AC-4` and `271 @AC-5` EXTEND lines were recorded at the round-4 gate as not covered by an operator decision; the later design approval names none of them — target: operator confirms at the execute checkpoint of the steps that touch them (Steps 5–6 push `url`; Step 18 bell in every segment).

## Files Modified

Steps 1+2: `packages/proto/notify/v1/notify.proto` and the regenerated notify stubs under `packages/proto/gen/{go,python,ts}/notify/v1/` and `packages/proto/gen/ts/dist/notify/v1/`. Steps 3+4: `services/xstockstrat-notify/src/grpc/notifyServiceImpl.ts`, `services/xstockstrat-notify/src/__tests__/notifyServiceImpl.test.ts`. Steps 5+6: `services/xstockstrat-notify/src/fanout/webPush.ts`, `services/xstockstrat-notify/src/__tests__/webPush.test.ts`. Step 7: `services/xstockstrat-ingest/app/handlers/servicer.py`. Step 8: `services/xstockstrat-ingest/tests/test_ingest_servicer.py`. Step 9: `services/xstockstrat-ui/src/lib/traderBff.ts`. Step 10: `services/xstockstrat-ui/e2e/fixtures/{alerts.ts,INVENTORY.md}`, `services/xstockstrat-ui/e2e/mock-backend.ts`, `services/xstockstrat-ui/e2e/accounts/alert-detail.spec.ts`. Step 11: `services/xstockstrat-ui/src/lib/alertShared.ts`, `services/xstockstrat-ui/src/app/accounts/notifications/AlertInbox.tsx`. Step 12: `services/xstockstrat-ui/src/lib/alertShared.test.ts`, `services/xstockstrat-ui/src/lib/swHelpers.test.ts`. Step 13: `services/xstockstrat-ui/src/app/accounts/notifications/[alert_id]/{page.tsx,AlertDetail.tsx}`, `services/xstockstrat-ui/src/components/shared/PlatformHeader.tsx`. Step 14: `services/xstockstrat-ui/e2e/accounts/alert-detail.spec.ts`, `services/xstockstrat-ui/e2e/nav-reachability.spec.ts`, `services/xstockstrat-ui/e2e/fixtures/INVENTORY.md`. Step 15: `services/xstockstrat-ui/src/app/accounts/notifications/AlertInbox.tsx`. Step 16: `services/xstockstrat-ui/e2e/accounts/notifications.spec.ts`. Step 17: `services/xstockstrat-ui/src/components/shared/AlertStream.tsx` (moved from `src/components/trader/`), `services/xstockstrat-ui/src/components/shared/PlatformHeader.tsx`, `services/xstockstrat-ui/src/components/trader/AppShell.tsx`. Step 18: `services/xstockstrat-ui/e2e/{alert-bell.spec.ts,helpers/alertReadState.ts,trader/alert-stream.spec.ts,mobile-overflow.spec.ts,fixtures/INVENTORY.md}`, `services/xstockstrat-ui/src/components/shared/PlatformHeader.tsx` (operator-approved). Step 19: `services/xstockstrat-ui/src/lib/alertShared.ts`, `services/xstockstrat-ui/src/components/shared/AlertStream.tsx`, `services/xstockstrat-ui/src/app/accounts/notifications/AlertInbox.tsx`, `services/xstockstrat-ui/src/app/accounts/notifications/[alert_id]/AlertDetail.tsx`. Steps 20–22: see their session entries below. Step 23: `services/xstockstrat-ui/docs/{pwa-push.md,context-constitution.md,context-constitution-findings.md}`, `services/xstockstrat-notify/docs/{context-constitution.md,context-constitution-findings.md}`. Feature-directory artifacts:
- `feature.md`, `status.md` — draft → spec-ready → design-approved → implementation-ready.
- `product-spec.md` — review rewordings (nav highlight, `buf breaking` path, FR-7 bullet, bell badge in the consumer surface); FR-8 added and the Consumer Surface line amended per D-17 (sdd-spec).
- `acceptance.feature` — `@AC-1` tagged `@FR-5`; `@AC-6` now reads "the bell on that page shows no unread badge"; `@AC-10 @FR-8` added (D-17). `@AC-8` text unchanged.
- `recon.md`, `debate.md`, `design.md` — written by sdd-design.
- `implementation-spec.md` — 23 steps (sdd-spec); "Impl-spec review findings" block, a Step Dependencies sentence, and coverage notes on Steps 10, 14, 16, 18, 20, 22 (impl-spec review).

## Superseded Sessions

### 2026-11-15 — sdd-story
- Created feature.md (draft), product-spec.md, acceptance.feature, context.md from an operator report (staging, homelab, with screenshots) and same-day read-only recon; operator decisions and the unconfirmed URL shape are in the header.
- Recon facts (now in `recon.md`): notify proto has no get-by-id RPC (`notify.proto:14-39`); body built at ingest `servicer.py:519-544` from `str(e)` (`:574-593`).

### 2026-11-15 — sdd-review product-spec
- Approved, draft → spec-ready; 6 non-blocking warnings: nav match mode for `Notifications` (C-10; `PlatformHeader.tsx:94,103`, `navGroups.tsx:89`), additive `GetAlert` proto path, `@AC-1` tagged `@FR-5` and NOT_FOUND covered by `@AC-2`, FR-7 bullet reworded, push deep link (FR-6) left for design to confirm, 339 lands first with the `merge-order.md` row unwritten (review router's to record; this session could edit only the feature directory).
- Overlap WARN only: `notifyServiceImpl.ts` (`GetAlert` beside `listAlerts` :225 vs 316's :15, :87, :288 — disjoint, rebase-only); `AlertStream.tsx` drawer vs 339 (339 first). No proto, migration or config collision. Recommended design depth: full (proto change, 3 services, warning-level overlap).

### 2026-11-15 — sdd-batch design gate (round 2)
- Halted at the approval gate (policy: halt); design.md not written, status unchanged. Round-1 design D-1..D-9 unchanged; round 2 added spec requirements only (D-10..D-13). Code citations were as given by proposer and adversary, not re-read.
- Blocking then: O-1 (raw `context["error"]` readable on demand, indefinitely; proposer recommended (a), adversary judged (b) the better fix) and O-2 (`@AC-6` bell not observable on `/accounts/*`; proposed "/trader page load" rewording). Non-blocking: O-5, O-6.
- Uncovered `@AC` then: `344 @AC-6` CHANGE, `165 @AC-9` and `165 @AC-4` EXTEND; cross-feature ids as cited in the debate, not re-verified.

_(Superseded `sdd-batch-design-state` block for this round dropped by /sdd-distill under operator sanction, 2026-11-15; it is in git history before the distill commit.)_

### 2026-11-15 — sdd-batch design gate (round 3)
- Halted at the gate after round 3. Operator rulings applied: O-1 (a), bell on every page (header). New D-14..D-19: bell mounted once in `PlatformHeaderInner` and removed from the trader `AppShell`; move plus `git mv` to `components/shared/` blocked on 339; non-RPC fallback body worded; UI-2 exception extended.
- The proposer's window event for badge refresh lost (R-8): a `QueryClientProvider` already wraps header and page in every segment, so a shared react-query key through `useInvalidatingMutation` won. That contradicted one clause of D-10 and two of D-12 → O-7 (blocking), held as petitions P-3/P-4, not recorded as decisions.
- Closed: O-1, O-2, O-6. Non-blocking: O-5, O-8, O-9. Only 270 and the 203 badge scenario were re-read (by the adversary).

_(Superseded `sdd-batch-design-state` block for this round dropped by /sdd-distill under operator sanction, 2026-11-15; it is in git history before the distill commit.)_

### 2026-11-15 — sdd-batch design gate (round 4)
- Halted at the gate after round 4. Operator steer applied (header); D-10 and D-12 marked `reopened @ round 4`. The Verdict cells of P-2..P-4 still read `pending user` at this point because the run was not told to change them (closed out in the sdd-design session).
- New D-20..D-26: `ALERTS_QUERY_KEY = ['alerts']` / `ALERT_UNREAD_COUNT_KEY` in `src/lib/alertShared.ts`, cache shared within one segment's provider and not across segments; `meta: { errorHandled: true }` at both mark-read sites; inbox list on `useQuery(['alerts', 'list'])`; the 339 constraint written as a design input, not a dictated decision (stream `onMessage` invalidates the count key, never +1, because a reconnect re-delivers alerts); the post-339 step must not drop 339's streamed-alert badge raise.
- Closed: O-7, O-8; no blocking objection left. Open: O-9 (339 runs in the same batch and may design before its constraint line lands, hence the conditional post-339 step), O-5. Uncovered EXTENDs: `165 @AC-9`, `165 @AC-4`, `271 @AC-5`; this round only 339's streamed-alert scenario was re-read.

```sdd-batch-design-state
{
  "round": 4,
  "synth": {
    "approach": "Round-4 best approach. D-1..D-9, D-11 and D-13..D-19 are unchanged. The operator reopened R-7, the D-10 clause and the two D-12 clauses, so the shared-cache design is now legitimate. I adopt the proposer's key and the adversary's corrections to it. I checked the disputed facts in code; they support the adversary.\n\n**1. Alert read models share one react-query prefix (supersedes the reopened D-10 clause)**\n- `services/xstockstrat-ui/src/lib/alertShared.ts` exports `ALERTS_QUERY_KEY = ['alerts']` and `ALERT_UNREAD_COUNT_KEY = ['alerts', 'unread-count']`.\n- The bell count is `useQuery({ queryKey: ALERT_UNREAD_COUNT_KEY, queryFn: () => notifyClient.listAlerts({ limit: 1 }), select: r => r.unreadCount })`, replacing the mount effect at `AlertStream.tsx:19-32`.\n- Every mark-read path invalidates the prefix `ALERTS_QUERY_KEY` through `useInvalidatingMutation` (`src/hooks/useInvalidatingMutation.ts:15-32`):\n  - the alert page, after a successful GetAlert (D-7);\n  - the inbox \"Mark read\" (`AlertInbox.tsx:42-53`).\n- Both call sites pass `{ meta: { errorHandled: true } }`. Without it a failed mark-read reaches the global error fallback (`src/lib/queryClient.ts:15-20`, `mutationErrorStore.ts:36-38`), which breaks D-7's \"failure is non-blocking\" and reports the inbox error twice.\n- The cache is shared within one segment's provider, not across segments. A segment switch remounts and refetches.\n- The bell gains a refetch on window focus and one retry (`queryClient.ts:26`: `staleTime: 5_000, retry: 1`). The spec names this; tests assert values only.\n\n**2. Inbox list moves onto the same prefix (answers O-8 in both directions)**\n- `AlertInbox.tsx:19-40` loads its list with `useQuery(['alerts', 'list'])` in place of local state plus manual `refetch()`.\n- One invalidation then refreshes the bell count, the inbox rows and the inbox \"N unread\" badge (`AlertInbox.tsx:63-65`), whichever surface did the mark-read.\n- The inbox calls `mutateAsync` inside its existing try/catch and keeps its own error text.\n- The 203 inbox scenarios and existing testids must stay green.\n\n**3. Constraint on 339, written as a design input, not a dictated decision**\n- Checked: `docs/roadmap/features/339-fix-symbol-page-alerts-ui/` has no design.md, its context.md has no key constraint, and `merge-order.md` has no 339 → 344 row.\n- The orchestrator adds this line to 339's `context.md` now, and the 339 → 344 merge-order row points to it:\n  - badge count on `ALERT_UNREAD_COUNT_KEY`;\n  - the drawer's stored-unread list under the `['alerts']` prefix;\n  - drawer mark-read through `useInvalidatingMutation` on the prefix;\n  - the stream `onMessage` path invalidates the count key (invalidate, not +1, because a reconnect re-delivers alerts).\n- 339 runs in this same batch, so the line may arrive after its design. The post-339 step is therefore conditional: it re-greps what 339 shipped and adapts to it rather than assuming the shape.\n\n**4. Post-339 blocked step (D-10, D-15)**\n- Move the bell to `PlatformHeaderInner` and the file to `components/shared/` (D-14, D-15).\n- Add the key, the invalidations, the inbox query and the drawer title link.\n- The swap must not drop 339's streamed-alert badge raise (339 `acceptance.feature:33-36`).\n\n**5. Tests (supersedes the two reopened D-12 clauses; the rest of D-12 stands)**\n- Badge asserted on the alert page itself, on two paths: direct `page.goto` of the alert URL, and client navigation from the inbox row title. No `page.goto('/trader')` step.\n- A delayed-first-`ListAlerts` case proves a stale response does not overwrite the refreshed count.\n- On `/accounts/notifications`, one \"Mark read\" click drops the inbox badge and the bell badge together.\n- After opening an alert from the drawer, the drawer no longer lists it as unread.\n- 339's \"streamed alert raises the badge\" scenario is re-asserted after the swap.\n- A failed MarkAlertRead on the alert page shows no global error banner.\n\n**6. Unchanged from round 3**\n- O-1 ruling (a): `context[\"error\"]` keeps raw `str(e)` (D-16).\n- Spec amendments: @AC-6, FR-8, @AC-10, Consumer Surface line (D-17).\n- Docs: UI-2 exception extension and the `PlatformHeader.tsx:43-44` drift entry (D-18); D-13 findings entry.\n- 640–1024px overflow check (D-19).\n\n**Build order**\nproto → notify getAlert + round-trip test → push url → ingest body → UI BFF + mock + fixture → helpers + page + nav + e2e → inbox title link → [after 339] bell move + file move + keys + invalidations + inbox query + drawer link + read-state/stream/width e2e → docs.",
    "open_objections": [
      {
        "text": "O-5 (existing): the non-RPC fallback body 'Backfill job {job_id} failed: unexpected error — see the alert details' still needs operator confirmation. None of the relayed operator answers can be tied to it.",
        "blocking": false
      },
      {
        "text": "O-9 (existing): the 339 constraint is now fully worded (count key, drawer list under the ['alerts'] prefix, drawer mark-read on the prefix, stream onMessage invalidation), but it is not yet written. 339's context.md has no such line and merge-order.md has no 339 → 344 row. It stays open until the orchestrator writes both.",
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
        "ac_id": "339 @AC-5",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
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
      "Invalidate only ALERT_UNREAD_COUNT_KEY (proposal r4) — lost: the drawer's stored-unread list and the inbox list stay stale after a mark-read; the ['alerts'] prefix refreshes all three with one call.",
      "Keep the inbox on local state with invalidate plus manual refetch() (proposal r4) — lost: it syncs inbox → bell only; a drawer mark-read leaves the inbox rows and 'N unread' stale, and it keeps two refresh mechanisms.",
      "setQueryData +1 on a streamed alert — lost: a stream reconnect re-delivers alerts and the increment would double-count; invalidate instead.",
      "Derive the bell count from the drawer's stored-unread list query — deferred to 339's design: its fit depends on 339's query shape and it couples the count to list fetch size.",
      "Dictate the 339 mechanism as a settled 344 decision — lost: 339 designs in parallel in this batch; the line is a design input and 344's post-339 step adapts to what shipped.",
      "Record the drawer → inbox staleness as an accepted limitation — lost: the inbox query conversion is about 15 lines and removes the gap.",
      "R-1..R-6 and R-8..R-10 stand."
    ],
    "open_risks": [
      "339 may design or merge before its context.md line is written and ship a local-state badge. The post-339 step would then rework fresh code; the conditional wording limits this but does not remove it.",
      "Moving the inbox list to useQuery changes its loading and error timing; the 203 inbox e2e and testids could be disturbed.",
      "The bell now refetches on window focus and retries once; e2e with a delayed first response can be perturbed by focus events.",
      "invalidateQueries cancelling an in-flight first fetch is taken from the adversary's reading of TanStack v5; I confirmed the factory calls invalidateQueries with defaults but did not test the race.",
      "Every open tab in any segment holds a StreamAlerts stream and runs the count query.",
      "Header width at 640–1024px with the bell in insights and accounts headers (covered by the D-19 check, not yet run).",
      "Under ruling (a), raw exception text on broadcast backfill alerts is readable on demand by every authenticated user (accepted by the operator).",
      "Cross-feature AC ids (165, 203, 242, 270, 271, 334) are as cited in earlier rounds; this round I re-read only 339's streamed-alert scenario.",
      "No test covers the real notify (ts-proto) → BFF → browser (protobuf-es v2) path for context end to end."
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
    "rationale": "No Floor breach. The adversary's verdict was NEEDS WORK on the cache's coverage, not on the design.\n\n- **Register.** The operator steer reopens R-7, the D-10 clause and the two D-12 clauses. O-7 closes, and the replacement wording is recorded as new decisions that supersede exactly those clauses. Nothing else in the register is contradicted. R-8 (window event) is not reintroduced.\n- **Checked in code.**\n  - `useInvalidatingMutation.ts` takes `options.meta` and calls `invalidateQueries` per key.\n  - `queryClient.ts` reports every mutation error unless `meta.errorHandled` is true, and sets `staleTime: 5_000, retry: 1`.\n  - 339's `acceptance.feature:33-36` has \"A streamed alert raises the badge without a reload\".\n  - 339 has no design.md, no key constraint in context.md, and no merge-order row.\n- **Adversary points adopted.**\n  - Prefix invalidation, so the drawer list is not stale on the @AC-5 path.\n  - Stream-path invalidation plus a re-assert of 339's scenario, so the swap cannot drop it (fails.md 2026-10-07).\n  - Inbox list on `useQuery`, which answers O-8 in both directions with one mechanism.\n  - The `errorHandled` opt-out, which keeps D-7 true.\n  - \"Shared within a segment\" wording and the focus-refetch note.\n- **Proposer points kept.** The key name and home, the two badge paths, the race case, and 339's context.md as the home of the constraint.\n- **O-8 closes** on the inbox query conversion. The proposer's own runner-up was this design, so there is no unanswered counter.\n- **Still open, non-blocking.** O-5 wording, and O-9 until the 339 line and the merge-order row are written. No blocking objection remains.",
    "register_delta": {
      "new_decisions": [
        {
          "text": "Supersedes the reopened D-10 clause: 344 adds ALERTS_QUERY_KEY = ['alerts'] and ALERT_UNREAD_COUNT_KEY = ['alerts','unread-count'] in src/lib/alertShared.ts; the bell count is a useQuery on the count key; every mark-read path (alert page, inbox) invalidates the ['alerts'] prefix through useInvalidatingMutation. The cache is shared within one segment's provider.",
          "evidence": "Operator steer round 4 reopening the D-10 clause; src/hooks/useInvalidatingMutation.ts:15-32; trader/providers.tsx:10 and QueryProviders.tsx:13 (one client per segment); adversary r4 prefix objection."
        },
        {
          "text": "Supersedes the reopened D-12 clauses: the badge is asserted on the alert page itself on two paths (direct page.goto and client navigation from the inbox row title), with a delayed-first-ListAlerts race case and no page.goto('/trader') step; the refresh trigger is the prefix invalidation.",
          "evidence": "Operator steer round 4 reopening the D-12 clauses; accounts/layout.tsx:24-27 (header does not remount); proposal r4 item 4, accepted by the adversary."
        },
        {
          "text": "Both mark-read call sites pass meta { errorHandled: true }, and the inbox uses mutateAsync inside its existing try/catch; an e2e shows a failed page-open mark-read raises no global error banner.",
          "evidence": "src/lib/queryClient.ts:15-20; mutationErrorStore.ts:36-38; AlertInbox.tsx:48-49; D-7."
        },
        {
          "text": "The inbox list loads through useQuery(['alerts','list']) in place of local state and manual refetch, so a mark-read on any surface refreshes the bell, the inbox rows and the inbox 'N unread' badge; one e2e on /accounts/notifications asserts both badges drop together.",
          "evidence": "AlertInbox.tsx:19-40,63-65; adversary r4 (drawer → inbox direction); the proposer's own runner-up; C-18."
        },
        {
          "text": "The post-339 step keeps 339's streamed-alert badge raise: the stream onMessage path invalidates the count key (never +1), the step re-asserts 339's streamed-alert scenario and a drawer-list assertion after the swap, and it adapts to whatever refresh mechanism 339 actually shipped.",
          "evidence": "339 acceptance.feature:33-36; 339 context.md:18; AlertStream.tsx:34 (reconnect re-delivers); fails.md:2773-2776; fails.md:412."
        },
        {
          "text": "The 339 constraint is recorded in 339's context.md as a design input (count key, drawer list under the ['alerts'] prefix, drawer mark-read on the prefix, stream-path invalidation), and the 339 → 344 merge-order row points to it.",
          "evidence": "339 directory has no design.md and no key constraint in context.md (grep); merge-order.md has no 339/344 row (grep); root CLAUDE.md makes context.md mandatory reading."
        },
        {
          "text": "The spec names the bell's new refetch on window focus and its single retry as a behaviour change; badge tests assert values only.",
          "evidence": "src/lib/queryClient.ts:26 (staleTime 5_000, retry 1; refetchOnWindowFocus default); D-12 'no call counting' clause."
        }
      ],
      "new_rejected": [
        {
          "text": "Invalidate only ALERT_UNREAD_COUNT_KEY, leaving the drawer list and inbox list outside the shared prefix.",
          "why": "The drawer's stored-unread list and the inbox go stale after a mark-read; the prefix refreshes every alert read model with one call."
        },
        {
          "text": "Keep the inbox on local state with invalidate plus manual refetch().",
          "why": "Syncs inbox → bell only and keeps two refresh mechanisms; a drawer mark-read leaves the inbox count stale."
        },
        {
          "text": "Increment the cached count (setQueryData +1) on a streamed alert.",
          "why": "A stream reconnect re-delivers alerts, so the count would double."
        }
      ],
      "new_objections": [],
      "closed_objections": [
        {
          "id": "O-7",
          "how": "The operator steer (round 4) reopened the D-10 clause and the two D-12 clauses; the replacement wording is recorded as superseding decisions, using the ['alerts'] prefix."
        },
        {
          "id": "O-8",
          "how": "The inbox list moves to useQuery(['alerts','list']) and every mark-read path invalidates the ['alerts'] prefix, so the inbox count and the bell badge refresh on the same event in both directions; an e2e on /accounts/notifications asserts both drop together."
        }
      ],
      "reopen_petitions": [],
      "reopened": [
        "R-7",
        "D-10",
        "D-12"
      ]
    }
  },
  "floor_breaches": []
}
```

### 2026-11-15 — sdd-design
- Phase 0 wrote recon.md (notify, ui, ingest; reuse: the `listAlerts` read join and visibility predicate for `getAlert`, the existing `PushPayload.url`). Phase 1: 4 rounds (full); operator approval and the `@AC` CHANGE sign-offs are in the header. spec-ready → design-approved.
- Register close-out reasoning: P-1 → `user declined` (O-1 option (b) not chosen); P-2..P-4 → `user reopened`, not `user declined`, because the operator did reopen R-7, the D-10 clause and the D-12 clauses and those rows already read `reopened`.
- Constitution rules touched: C-01, C-10, C-11, C-13, C-15, C-16, C-18, P-02, P-03, F-04, NOTIFY-7, NOTIFY-8, PLAT-4, UI-2; no Floor breach. Checked this session: 270 `@AC-9`, 270 `@AC-12`, 271 `@AC-5` exist with the titles design.md gives.

### 2026-11-15 — sdd-spec
- Generated implementation-spec.md (23 steps: 1–2 proto, 3–4 notify `getAlert`, 5–6 notify push `url`, 7–8 ingest body, 9–16 UI BFF/helpers/page/nav/inbox link, 17–22 blocked on 339, 23 docs); design-approved → implementation-ready. Tree `detached@5c62d0174 ≡ origin/feature/alert-detail-page`; `origin/main-dev@d1c97273b` not merged.
- Findings: the rendered shell reads `NAV_GROUPS` (`PlatformHeader.tsx:107-110,194`), whose `Notifications` entry already matches by prefix (`navGroups.tsx:89`), and `PLATFORM_SUBNAV.accounts` (`:94`) is an ignored prop — so the design.md §5 edit is a visible no-op (Step 13 still makes it; Step 14's check is red only because the page is missing). 339's approved design (`origin/feature/fix-symbol-page-alerts-ui@0442d300d`) makes the badge a merged unread-list length from `listAlerts({ unreadOnly: true, limit: 50 })`, off react-query, with `refreshUnread()` — unlike design.md §7's `unreadCount` from `listAlerts({ limit: 1 })`; Step 19 carries a rule for both shapes and stops if neither fits. 339's `context.md` (lines 894, 918 on its branch) records the 344 constraint in its own words.
- Also: notify `tsc` compiles tests and the UI `tsc --noEmit` typechecks `e2e/`; no descriptor-parity guard covers `notify.v1` and Go fakes embed `notifyv1.NotifyServiceClient`, so the new RPC breaks no test double; the `getAlert` UUID check is a module-private regex (no existing validator in notify). Cross-feature `@AC` ids re-verified against their suites: 165 (`@AC-4`, `@AC-5`, `@AC-9`), 203 (`@AC-1..6`), 242 (`@AC-2`, `@AC-5`), 270 (`@AC-9`, `@AC-12`), 271 (`@AC-5`), 334 (`@AC-20`), 339 (`@AC-5`).

---

## Session 2026-11-15 — sdd-review impl-spec (advisory)

- Result: 0 failures, 8 warnings, 0 Floor breaches (PASS WITH WARNINGS; advisory — did not block). Lifecycle unchanged (`implementation-ready`).
- Re-checked this session on `origin/main-dev@d1c97273b`: 339 is not merged (no `fix-symbol-page-alerts-ui` commit in `git log`); `docs/roadmap/features/merge-order.md` has no 339 or 344 row; the notify Reviewers focus text is the registry's own wording (`docs/runbooks/reviewer-registry.md:21`); `frontend-e2e` has no coverage threshold (`docs/patterns/ci-overview.md:29`); 316 is `spec-ready` and names `notifyServiceImpl.ts:15` and `notifyServiceImpl.test.ts:634` (`316-fix-notify-stream-contract/product-spec.md:46,48`).
- Operator answers relayed to this run, verbatim: "1. Approved / 2. Confirmed / 3. Sign-off the change, amend it / 4. There are no production instances. Staging is enough." They are the same four answers the sdd-spec session received and predate this review, so none is applied to a review finding. "Confirmed" is still **not** recorded as closing O-5.
- Addressed in `implementation-spec.md`:
  - [x] Steps 17–22 (C-01, F-09): new "Impl-spec review findings" block and a Step Dependencies sentence. The steps must not run as written before 339 merges; the reviewed path is a `/sdd-spec` re-run after 339 merges and before Step 17; without it, each gate adaptation is a Deviation Log entry.
  - [x] Steps 10, 14, 16, 18, 20, 22 (B2/B3): each Verification now states that no coverage threshold applies to Playwright e2e and that the `src/lib/**` vitest gate (≥ 40%) is Step 12's.
  - [x] Overlap with 316 on `notifyServiceImpl.ts` and its test file: recorded in the spec as non-blocking (whichever merges second re-greps).
- Unresolved ⚠ carried into execution:
  - Steps 17–22: 339 symbols not in this tree; Step 19 Case A / Case B; Step 21 `SheetClose` fallback; Steps 18 and 20 "state which was used" alternatives (C-01, P-03) — [ ] unaddressed (needs 339 merged, then a re-spec)
  - Step 17 precondition: the 339 → 344 row in `merge-order.md` (O-9) — [ ] unaddressed (outside this feature directory; orchestrator)
  - Step 7 / Step 8 case 3: fallback wording has no operator confirmation (O-5, P-03) — [ ] unaddressed
  - Steps 5/6: `Lands with` fold with no §C trigger — [ ] unaddressed (design.md §2 requires it; recorded trade-off)
  - Step 13: `PlatformHeader.tsx:94` edit is a no-op in the rendered shell (C-18) — [ ] unaddressed (design.md §5 names it; dropping it is the operator's call)
  - Steps 1–6: notify Reviewers focus text does not describe a request/response RPC — [ ] unaddressed (cosmetic; registry wording, not changed here)
  - Step 11: no vitest coverage gate in its own Verification (optional per the review) — [ ] unaddressed (the gate runs in Step 12; whether Step 11 alone holds ≥ 40% was not measured)
- Overlap findings: WARN, file-level only. 316 (`notifyServiceImpl.ts`, `notifyServiceImpl.test.ts`); 339 (`PlatformHeader.tsx`, the header bell, and a different badge-value shape — already a blocking dependency of Steps 17–22); 334 (`notify.proto`, launched, no field-number clash). No migration, config-key or proto field-number collision. Recommended by the scan and not done here (outside this directory): a blocking `merge-order.md` row "344 blocked by 339 — Steps 17–22 wrap 339's bell and alert read models", and a non-blocking 316 vs 344 note; `merge-order.md:397` still calls 334 `implementation-ready` although its `status.md` is `launched`.
- This entry supersedes the `## Open Threads` block above.

## Session 2026-11-15 — operator answer after impl-spec review (orchestrator)

- **O-5 (Step 7 fallback wording) — "Sounds good"** (operator, verbatim, 2026-11-15), in answer to:
  accept "unexpected error — see the alert details" as the alert body when a backfill failure has
  no usable detail. Step 7 and Step 8 case 3 stand.
- Still open: the 339 -> 344 row in `docs/roadmap/features/merge-order.md` (orchestrator, separate
  PR to main-dev), and the re-spec of Steps 17-22 after 339 merges.

## Session 2026-11-15 — /sdd-distill
- Distilled 9 sessions → header + Superseded Sessions; kept 2 verbatim.
- context.md 863 → 355 lines. Original prose preserved in git history.
- **Operator sanction (2026-11-15), deviation from the skill's preserve-every-`sdd-batch-*`-block rule:** asked
  "How should I write them?" with the option "Keep only the last state block", the operator chose it. The 2
  superseded per-round `sdd-batch-design-state` block(s) are dropped; the last one is kept byte-for-byte (the only one
  any workflow reads, `.claude/workflows/sdd-batch.js:191`). Other `sdd-batch-*` blocks are untouched.
- The loss check was a self-check by the planning agent (no separate `context-distiller` verifier was available).

## Session 2026-11-15 — sdd-execute sequential (sdd-batch-execute)
- Up-front confirmation (operator-approved record; mismatch details abbreviated, verbatim copy in commit 2d2e7bcb8): `{"mainDev":"9f88562296464b43465d0376b40cefafe93f0743","dev":"19acdf6d4ccbeb75ae15fb0b8a68f61debcab0cb","specHash":"d8ad63a95b83894f57af5aab23a79de78a0f9f5f","directive":"conditional","pending":[1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23],"mismatches":[n=1,2,4,17,18,19,20,21,22 — full details in the body of commit 2d2e7bcb8]}`.
- Merged `origin/main-dev@9f8856229` into the branch (`56b1b1bdc`; resolver: nothing to resolve; ledger-guard clean).
- Tooling detection (steps 1–23): node v24.22.1 ✓ · pnpm 9.15.9 ✓ · uv 0.11.32 ✓ · python 3.13.18 ✓ · go1.27.0 ✓ · docker 29.9.2 ✓ · Playwright Chromium at `/opt/pw-browsers` ✓ · buf ✗ on host (Docker `Dockerfile.codegen` path via `scripts/localenv-setup.py` for Step 2).
- Re-spec (directive conditional): line drift fixed in Steps 1 (`ci.yml:240`), 2 (`buf-gen.sh` `:35`/`:48`/`:53-61`), 4 (`:825`), 17 (`providers.tsx:12`) and 19 (`providers.tsx:10`); Steps 17–22 record that the 339 gate still fails (339 not merged, `implementation-ready` on its branch) and stay blocked. The 339 → 344 row is now on main-dev (`merge-order.md:126`), which closes the merge-order half of O-9.
- respec(alert-detail-page) commits on this branch: `2d2e7bcb8` (implementation-spec.md), `317822030` (feature.md), `0014497b0` (status.md).
```sdd-batch-setup
{"mainDev":"9f88562296464b43465d0376b40cefafe93f0743","date":"2026-11-15"}
```

### Step 1 — proto: add `GetAlert` to `notify.v1.NotifyService` [done]
- Atomic unit Steps 1+2. Added `rpc GetAlert(GetAlertRequest) returns (Alert)` after `MarkAlertRead` and `message GetAlertRequest { string alert_id = 1; }` after `MarkAlertReadResponse`; `message Alert` untouched. TDD: N/A (proto). Verification `.sdd-logs/v-1.log` (empty log, `exit=0`): `buf lint` and `buf breaking` against `origin/feature/alert-detail-page` clean.
- Files modified: `packages/proto/notify/v1/notify.proto`
- Deviations: verification ran inside the pinned codegen image (buf not on host) — full detail in Deviation Log

### Step 2 — proto-gen: regenerate the notify stubs [done]
- Atomic unit Steps 1+2. `./scripts/buf-gen.sh` (run twice, in the `xstockstrat-codegen` image) changed only the notify Go/Python/TS stubs and TS dist (12 files, second-run `git diff --stat`); no non-notify path changed; notify `pnpm run build`, UI `tsc --noEmit` and trading `GOWORK=off go build ./...` printed no error; `exit=0` (`.sdd-logs/v-3.log`; run 2 failed only on an unpopulated Go module cache under `GOPROXY=off`). TDD: N/A (proto-gen).
- Files modified: `packages/proto/gen/go/notify/v1/{notify.pb.go,notify_grpc.pb.go,notifyv1connect/notify.connect.go}`, `packages/proto/gen/python/notify/v1/{notify_pb2.py,notify_pb2_grpc.py}`, `packages/proto/gen/ts/notify/v1/{notify.ts,notify_pb.ts,notify_connect.ts}`, `packages/proto/gen/ts/dist/notify/v1/{notify.js,notify.d.ts,notify_pb.js,notify_pb.d.ts}`
- Deviations: same codegen-image fallback as Step 1 — see Deviation Log

### Step 3 — service: notify `getAlert` handler [done]
- Atomic unit Steps 3+4. Added `ALERT_ID_RE` and `getAlert` after `listAlerts`: header-only identity (code 3), one code 5 `alert not found` for a malformed id (no query) or no visible row, one caller-scoped `LEFT JOIN notify.alert_reads` query without the `$1::text IS NULL` branch, `context` mapped only in this handler; `rowToAlert` unchanged. TDD (unit): red `.sdd-logs/v-1.log` with a code-12 stub — 7 of the 8 new cases failed (`actual: { code: 12, message: 'not implemented' }`, `ℹ fail 7`); green `.sdd-logs/v-2.log` `ℹ tests 414 / ℹ pass 414 / ℹ fail 0`, `All files … 90.7` lines, lint `0 errors`, `exit=0`.
- Files modified: `services/xstockstrat-notify/src/grpc/notifyServiceImpl.ts`
- Deviations: none for Step 3's own Verification.

### Step 4 — test: notify `getAlert` and the `context` round-trip [done]
- Atomic unit Steps 3+4. Added `describe('getAlert (feature 344)')` with the 8 cases: AC-9 targeted, AC-3 broadcast, AC-2 code 5 plus the SQL and params, malformed id, missing header, AC-1 read state, AC-1 `context` encode/decode round-trip (`{…}` and `{}`), and R-1 (`rowToAlert` has no `context`). The last one passed at red as a characterisation. AC-2/AC-1/AC-3/AC-9 red → green as in Step 3. Green `.sdd-logs/v-3.log`: 414 pass, 0 fail, `exit=1` from the closing `grep "__tests__/fixtures"` no-match only.
- Files modified: `services/xstockstrat-notify/src/__tests__/notifyServiceImpl.test.ts`
- Deviations: Step 4's fixtures grep cannot match the `./fixtures/` imports — full detail in Deviation Log. Verification resolves `@xstockstrat/proto` through the main checkout's linked `node_modules`, whose stubs lack `getAlert`; the tests call the impl directly and use the unchanged `Alert` codec, so the result does not depend on it.

### Step 5 — service: notify push payload carries the alert url [done]
- Atomic unit Steps 5+6. Added ``url: `/accounts/notifications/${alert.alertId}` `` to the `PushPayload` literal in `WebPushDispatcher.dispatch`; no other field, no audience change, no `sw.js` change. TDD (unit): AC-7 red `.sdd-logs/v-1.log` — both extended tests failed with `actual: undefined, expected: '/accounts/notifications/a1'` (`ℹ fail 2`); green `.sdd-logs/v-2.log` `ℹ tests 414 / ℹ pass 414 / ℹ fail 0`, `All files … 90.7` lines, lint `0 errors`, `exit=0`.
- Files modified: `services/xstockstrat-notify/src/fanout/webPush.ts`
- Deviations: none

### Step 6 — test: push payload url [done]
- Atomic unit Steps 5+6. Extended the targeted test (`AC-4 / @AC-2`) with the `url` assertion on the first payload and on every sent payload, and the untargeted admin test (`@AC-5`) with the same assertion; both reuse the `alert()` builder (`alertId: 'a1'`), no new literal fixture. AC-7 red → green as in Step 5.
- Files modified: `services/xstockstrat-notify/src/__tests__/webPush.test.ts`
- Deviations: none. The `165 @AC-4` EXTEND / `242 @AC-5` PRESERVE confirmation (Open Threads) is still the operator's at the checkpoint.

## Session 2026-11-15 — operator standing authorization and checkpoint answers (orchestrator)

- **Standing authorization for checkpoints — operator, verbatim (2026-11-15): "Proceed, do not stop at
  checkpoints unless it's necessary".** Given in answer to "Proceed past the checkpoints?". The run uses
  `checkpoints: 'report'` from here on; this entry is its `authorizationRef`. It does not waive blockers,
  failed verifications, Floor breaches, uncovered `@AC` CHANGE lines or any decision that is the
  operator's — those still halt.
- **Scratch Postgres for stored-set generation (orchestrator tooling, not an operator ruling):** a
  Postgres 16 the main session controls listens on 127.0.0.1:5432. `DATABASE_URL` is not exported into
  agent shells; prefix the generator: `DATABASE_URL='postgres://postgres@127.0.0.1:5432/postgres?sslmode=disable'
  python3 scripts/config-wiring-stored.py`. Do not start, stop or delete the server; if it is
  unreachable, stop and report.
- **`165 @AC-4` / `165 @AC-9` EXTEND and the PRESERVE lines (Steps 5-6 push `url`) — "Agreed".** Asked:
  the push-notification link extends two existing notify rules and leaves two others unchanged; the
  extension is that a push notification now carries a link to the alert's page — sign off? Signed off.
  `271 @AC-5` (Step 18, bell in every segment) was not part of that question and stays open.

### Step 7 — service: ingest plain-language backfill-failure body [done]
- Added `_BACKFILL_FAILURE_FALLBACK` and `_backfill_failure_detail(exc)` above `IngestServicer` (`<CODE> — <details>`, the code alone when details are empty, else the fallback); `_emit_backfill_alert` takes `detail=None` and uses it in the body; only the `_run_backfill` exception caller passes it. `context["error"]`, the job-row `error` and the ledger payload keep raw `str(e)`; the two fixed-string callers are unchanged. TDD (AC-8, Step 8's cases held uncommitted): red `.sdd-logs/v-1.log` `3 failed, 136 deselected` (body was `Backfill job 67276d1f failed: <AioRpcError of RPC that terminated with:` / `… failed: boom at /srv/x.py:12`), green `.sdd-logs/v-3.log` `3 passed`; Verification `.sdd-logs/v-2.log` `All checks passed!`, `57 files already formatted`, `506 passed`, `Total coverage: 86.63%`, `exit=0`; re-run on the committed tree `.sdd-logs/v-4.log` `503 passed`, `Total coverage: 86.53%`, `exit=0`. Config-key wiring gate: not applicable (no key).
- Files modified: `services/xstockstrat-ingest/app/handlers/servicer.py`
- Deviations: body expression reordered for E501; Step 8's test written and reverted for red→green; Verification run with the ingest venv on PATH — full detail in Deviation Log

### Step 8 — test: ingest backfill-failure body [done]
- Added `TestBackfillFailureAlertBody` after `TestWebhookWakeUp` (AC-8 RPC body plus raw `context["error"]`, job-row `error` and `ingest.backfill.failed` ledger payload; code-only body; non-RPC fallback), and body assertions on the PARTIAL and fixed-string FAILED tests (characterisation, green before and after). AC-8 red: `.sdd-logs/v-1.log`, run against the pre-Step-7 `servicer.py`, `3 failed, 503 passed` (body was `… failed: <AioRpcError of RPC that terminated with:` / `… failed: boom at /srv/x.py:12`). Green: `.sdd-logs/v-2.log` `All checks passed!`, `57 files already formatted`, `506 passed`, `Total coverage: 86.63%`, `exit=0`. Config-key wiring gate: not applicable (no key).
- Files modified: `services/xstockstrat-ingest/tests/test_ingest_servicer.py`
- Deviations: RED ran against the pre-Step-7 servicer; the block's `exit=` comes from its closing grep, so the result was judged from the log — full detail in Deviation Log

### Step 9 — service: UI BFF `getAlert` [done]
- Added `getAlert: forward((req, opts) => notifyClient.getAlert(req, opts))` after `markAlertRead` in the trader BFF `NotifyService` block (no REST route, no admin gate, no timeout). TDD (temporary vitest probe through `dispatchConnect`, deleted before commit; Step 10 owns the committed tests): red `.sdd-logs/v-2.log` `AssertionError: expected 501 to be 200`, `Tests 1 failed | 549 passed`, `exit=1`; green `.sdd-logs/v-3.log` `Tests 550 passed | 2 skipped`, `exit=0`; Verification on the committed tree `.sdd-logs/v-4.log` lint and `tsc --noEmit` clean, `Test Files 78 passed (78)`, `Tests 549 passed | 2 skipped`, grep `117:  getAlert: forward(…)`, `exit=0`. No coverage line: `test:unit` prints none and `src/lib/*Bff.ts` is excluded from the vitest coverage scope. Config-key wiring gate: not applicable (no key).
- Files modified: `services/xstockstrat-ui/src/lib/traderBff.ts`
- Deviations: Verification ran in the codegen container on this branch's TS stubs (the linked `node_modules` resolve the main checkout's stale stubs); RED answered 501, not the 404 Step 10 predicts — full detail in Deviation Log

### Step 10 — test: mock `getAlert`, alert-detail fixtures and the BFF contract [done]
- Appended `ALERT_DETAIL_ID`/`_BROADCAST_ID`/`_UNKNOWN_ID`, `ALERT_DETAIL`, `ALERT_DETAIL_BROADCAST` and `ALERT_DETAILS` to `e2e/fixtures/alerts.ts` (imports `TEST_USER_ID` from `./users`), added the "Alert detail (feature 344)" INVENTORY row, a `getAlert` mock that resolves `ALERT_DETAILS` and `ALERT_LIST_WITH_READ_STATE` by id or throws `Code.NotFound`, and `e2e/accounts/alert-detail.spec.ts` (two BFF cases). `CONNECT_HEADERS` stays a local one-off: `e2e/helpers/` has no helper for it. TDD (AC-2): red `.sdd-logs/v-4.log` — `Expected: 404 / Received: 501` and `expect(res.ok()).toBeTruthy()` `Received: false`, `2 failed`, `1 passed` (setup); green `.sdd-logs/v-5.log` — `3 passed (6.4s)` (setup + both cases), lint and `tsc --noEmit` clean ahead of it, both greps matched, `exit=0`. No coverage threshold applies to Playwright e2e. Config-key wiring gate: not applicable (no key).
- Files modified: `services/xstockstrat-ui/e2e/fixtures/alerts.ts`, `services/xstockstrat-ui/e2e/fixtures/INVENTORY.md`, `services/xstockstrat-ui/e2e/mock-backend.ts`, `services/xstockstrat-ui/e2e/accounts/alert-detail.spec.ts`
- Deviations: Verification run in a private mount+net namespace on this branch's TS stubs, under `CI=1` (production build) after the `pnpm dev` warm-up timed out; RED answered 501, not 404 — full detail in Deviation Log

### Step 11 — service: shared alert helpers (`formatWhen`, `contextEntries`) [done]
- Added `formatWhen(createdAt)` (via `timestampToDate`) and `contextEntries(context)` (string as is, else `JSON.stringify`) to `src/lib/alertShared.ts`; `AlertInbox.tsx` drops its local `formatWhen` and calls the shared one with `a.createdAt`; header comment unchanged. TDD (Step 12's `alertShared` cases held uncommitted): red `.sdd-logs/v-1.log` — `error TS2305: Module '"./alertShared"' has no exported member 'contextEntries'` (and `'formatWhen'`); green `.sdd-logs/v-2.log` — lint no error, `tsc` clean, `Test Files 79 passed (79)`, `Tests 556 passed | 2 skipped`, Playwright `8 passed`, `exit=0`; committed tree `.sdd-logs/v-3.log` — `Test Files 78 passed (78)`, `Tests 549 passed | 2 skipped`, Playwright `8 passed`, grep shows one definition (`alertShared.ts:22`) and the inbox import/call, `exit=0`. No coverage line: `test:unit` prints none (the ≥ 40% gate is Step 12's). Config-key wiring gate: not applicable (no key).
- Files modified: `services/xstockstrat-ui/src/lib/alertShared.ts`, `services/xstockstrat-ui/src/app/accounts/notifications/AlertInbox.tsx`
- Deviations: RED probe written and deleted (Step 12 owns the test); Verification in the private namespace under `CI=1` — full detail in Deviation Log

### Step 12 — test: vitest for the alert helpers and the push click target [done]
- Created `src/lib/alertShared.test.ts` (7 cases: `contextEntries` string `@AC-1`, list, number, `{}`/`undefined`, insertion order; `formatWhen` `undefined` and bigint seconds) and added two `@AC-7` cases to `src/lib/swHelpers.test.ts` (`parsePushPayload` keeps the alert url; `pickClientUrl` → `null` from `/trader`, the alert window when one is open). TDD: AC-1 red `.sdd-logs/v-1.log` against the pre-Step-11 `alertShared.ts` — `error TS2305: Module '"./alertShared"' has no exported member 'contextEntries'` (and `'formatWhen'`), `exit=2` → green `.sdd-logs/v-2.log` — `Test Files  79 passed (79)`, `Tests  558 passed | 2 skipped (560)` (+9 over Step 11's 549), `Lines : 79.69% ( 581/729 )`, `Functions : 80.88%`, `Statements : 78.44%` (all ≥ 40%), lcov `alertShared.ts` LH 4/4, FNH 3/3, `exit=0`. The two `swHelpers` cases: red N/A — no behavior change; characterization test added (D-5). Config-key wiring gate: not applicable (no key).
- Files modified: `services/xstockstrat-ui/src/lib/alertShared.test.ts`, `services/xstockstrat-ui/src/lib/swHelpers.test.ts`
- Deviations: RED against the pre-Step-11 helper; Verification in a private mount namespace on this branch's TS stubs — full detail in Deviation Log

### Step 13 — service: the alert page and the nav match [done]
- Created `/accounts/notifications/[alert_id]` (server `page.tsx` wrapping client `AlertDetail.tsx`): `getAlert` on load, then `markAlertRead` with the server-returned id (failure silent), `Code.NotFound` → "Alert not found", other errors → "Could not load alert"; one `Card` `data-testid="alert-detail"` with severity badge, category, title, full body, Source service / Created / Status (`alert-read-state`) / Correlation ID rows, and a Context list (`alert-context-row`, "No context fields" when empty). `PlatformHeader.tsx:94` Notifications `match: 'exact'` → `'prefix'`. TDD (temporary probe of Step 14's page cases, deleted before commit): AC-1/AC-2/AC-3 red `.sdd-logs/v-3.log` — `getByTestId('alert-detail')` `element(s) not found`, `3 failed`, `1 passed` (setup), `exit=1` → green `.sdd-logs/v-4.log` — `4 passed (1.5m)`, `exit=0`. Verification `.sdd-logs/v-5.log`: lint warnings only in untouched files, `tsc --noEmit` clean, `Test Files  79 passed (79)`, `Tests  558 passed | 2 skipped (560)`, Playwright nav-reachability + notifications `10 passed (12.9s)`, `exit=0`. No coverage line: `test:unit` prints none (the ≥ 40% gate is Step 12's; the page is not under `src/lib/**`). Config-key wiring gate: not applicable (no key).
- Files modified: `services/xstockstrat-ui/src/app/accounts/notifications/[alert_id]/page.tsx`, `services/xstockstrat-ui/src/app/accounts/notifications/[alert_id]/AlertDetail.tsx`, `services/xstockstrat-ui/src/components/shared/PlatformHeader.tsx`
- Deviations: RED probe written and deleted (Step 14 owns the tests); Verification in a private mount+net namespace under `CI=1`; the no-op nav edit made as written without the operator keep/drop question — full detail in Deviation Log

### Step 14 — test: alert page e2e and the child route in nav-reachability [done]
- Added `test.describe('alert page (feature 344)')` to `e2e/accounts/alert-detail.spec.ts` (9 cases: `@AC-1` every detail, 3 context rows and `Read`; `@AC-9` targeted; `@AC-3` broadcast and "No context fields"; `@AC-2` unknown id and a routed 404 with an unrelated message; malformed id; HTTP 500 → "Could not load alert" with no `MarkAlertRead`; `@AC-6` marks the server-returned id; a failed mark-read leaves the alert rendered and `Unread`), a nav-reachability case (alert page → Primary `Settings` and Section `Notifications` carry `aria-current="page"`), and `e2e/nav-reachability.spec.ts` as a consumer on the INVENTORY row. Routed bodies are built from `ALERT_DETAIL` with `createdAt` as RFC 3339 (C-12 one-off). TDD: AC-1/AC-2/AC-3/AC-6/AC-9 red `.sdd-logs/v-1.log` against the pre-Step-13 tree — 10 new cases `✘`, `element(s) not found` on `getByTestId('alert-detail')` / `empty-state` and `Received: undefined` for the mark-read capture, `10 failed`, `5 passed (6.9m)` (setup, two BFF cases, two existing nav cases), stopped at `maxFailures` → green `.sdd-logs/v-4.log` — lint warnings only in untouched files, `tsc --noEmit` clean, `15 passed (13.7s)` with no retry, closing grep lists the `../fixtures/alerts`, `./fixtures/alerts` and `helpers/auth` imports, `exit=0`. No coverage threshold applies to Playwright e2e. Config-key wiring gate: not applicable (no key).
- Files modified: `services/xstockstrat-ui/e2e/accounts/alert-detail.spec.ts`, `services/xstockstrat-ui/e2e/nav-reachability.spec.ts`, `services/xstockstrat-ui/e2e/fixtures/INVENTORY.md`
- Deviations: RED against the pre-Step-13 tree; Verification in a private namespace under `CI=1` (port 3000 held by another worktree for GREEN) — full detail in Deviation Log

### Step 15 — service: inbox row title links to the alert page [done]
- Imported `Link` from `next/link` in `AlertInbox.tsx` and wrapped the row title's text in `<Link href={`/accounts/notifications/${a.alertId}`} className="hover:underline">`, keeping the `<p>` and its classes; the `<li>`, testids, unread dot, badge, category, body and "Mark read" button are unchanged. TDD (Step 16's `@AC-4` case held uncommitted in `notifications.spec.ts`): AC-4 red `.sdd-logs/v-1.log` — `waiting for getByTestId('alert-inbox-list').getByRole('link', { name: 'Order rejected' })`, `Test timeout of 30000ms exceeded`, `1 failed`, `8 passed (1.2m)`, `exit=1` → green `.sdd-logs/v-2.log` — `@AC-4 PROBE the inbox row title opens the alert page (1.1s)` passed, `9 passed (8.3s)`, lint warnings only in untouched files, `tsc --noEmit` clean, `exit=0`; committed tree (probe reverted) `.sdd-logs/v-3.log` — `8 passed (7.6s)`, `exit=0`. No coverage threshold applies to Playwright e2e. Config-key wiring gate: not applicable (no key).
- Files modified: `services/xstockstrat-ui/src/app/accounts/notifications/AlertInbox.tsx`
- Deviations: RED probe written and reverted (Step 16 owns the test); Verification in a private namespace under `CI=1` on this branch's TS stubs — full detail in Deviation Log

### Step 16 — test: inbox row title navigation [done]
- Added two cases to `test.describe('alert inbox (feature 203)')` in `e2e/accounts/notifications.spec.ts`, importing `ALERT_LIST_WITH_READ_STATE` and `ALERT_UNREAD` from `../fixtures/alerts`: `@AC-4` clicks the "Order rejected" link inside `alert-inbox-list` and expects `/accounts/notifications/alert-002` and the title in `alert-detail`; `@AC-6 @feature-203` checks that every row keeps its module, body and (unread only) "Mark read" button, and that `a button` has count 0. TDD: AC-4 red `.sdd-logs/v-1.log` against the pre-Step-15 `AlertInbox.tsx` — `waiting for getByTestId('alert-inbox-list').getByRole('link', { name: 'Order rejected' })`, `Test timeout of 30000ms exceeded`, `1 failed`, `9 passed (1.2m)`, `exit=0` from the closing grep → green `.sdd-logs/v-2.log` — lint warnings only in untouched files, `tsc --noEmit` clean, `@AC-4 the inbox row title opens the alert page (1.1s)` passed, `10 passed (8.7s)`, grep lists the `../fixtures/alerts` and `helpers/auth` imports, `exit=0`. The EXTEND guard: red N/A — no behavior change; characterization test added. No coverage threshold applies to Playwright e2e. Config-key wiring gate: not applicable (no key).
- Files modified: `services/xstockstrat-ui/e2e/accounts/notifications.spec.ts`
- Deviations: RED against the pre-Step-15 inbox; Verification in a private mount namespace under `CI=1` on this branch's TS stubs — full detail in Deviation Log

## Session 2026-11-16 — 339 merged; main-dev merged; Steps 17–22 re-specified (orchestrator)

- 339-fix-symbol-page-alerts-ui merged into `main-dev` via PR #1550 (`573050534`, a merge commit). `main-dev` also carries 341 (`5fad24f9c`) and the formatting baseline (`44e14364d`).
- `origin/main-dev@573050534` merged into this branch at **`a900126ff`** (merge, no rebase). Four conflicts, both sides kept: `e2e/fixtures/alerts.ts` and `e2e/fixtures/INVENTORY.md` (344's alert-detail fixtures and row + 339's drawer fixtures and rows), `src/lib/alertShared.ts` (344's `formatWhen` / `contextEntries` + 339's unread helpers; one import line, `./protoTime`), `src/lib/alertShared.test.ts` (both suites, one merged import). No generated proto file conflicted (344 touched `notify`, main-dev touched `analysis`).
- Post-merge checks on the host: `tsc --noEmit`, `lint`, `format:check` clean; `test:coverage` 81 files / 605 tests passed; host-fallback Playwright (`e2e/accounts`, position-detail, alert-stream, stream-reconnect, symbol-page-display, nav-reachability) 103 passed; notify `pnpm test` 414 passed. Ingest tests not re-run: the merge changed no ingest file. Verification resolved `@xstockstrat/proto` to this worktree's stubs through a per-entry linked `node_modules`, not the main checkout's.
- Steps 17–22 re-specified in `implementation-spec.md` against `a900126ff`. No step was implemented. The "[blocked on 339]" markers and the Instruction 0 gates are gone; each step notes 339 merged at `573050534`. Steps 1–16 are untouched. Closes the header threads "O-9", "Steps 17–22 cite pre-339 anchors", "Badge value shape" and "Steps 18 and 20 leave the assertion path to the executor".

What changed per step, and why:
- **Step 17** — same move and mount. New: 339 added `import { CardNotice } from '../shared/CardNotice'` (`AlertStream.tsx:10`), which must become `'./CardNotice'` after the move; the trader shell aria snapshot (`e2e/theme/…/shell.aria.yml:38`) now names the bell, so the theme spec is in Verification and the snapshot is not to be re-recorded by hand.
- **Step 18** — 339 shipped the bell locators `bellOf` / `badgeOf` local to `e2e/trader/alert-stream.spec.ts:22-24`; the step moves them into `e2e/helpers/alertReadState.ts` (created here, not in Step 20) and both specs import them. The "one stream per page" check is fixed to the structural form (one bell, at least one `StreamAlerts` request): a request count is unstable under `pnpm dev` strict mode. The `@AC-9 @feature-270` case copies the reconnect stub at `stream-reconnect.spec.ts:77-86`.
- **Step 19** — Case A/Case B is settled: 339 shipped the merged-list badge (`mergeUnread(stored, streamed, readIds).length`), so the query under `ALERT_UNREAD_COUNT_KEY` holds the stored-unread list (with the fetch `seq` that `pruneStreamed` needs) and the count stays derived from the merged list — 339's recorded constraint. `refreshUnread()` becomes an invalidation. The drawer's per-row mark-read moves to `useInvalidatingMutation`; its catch still re-syncs the list (339 refreshes after a failure, the mutation invalidates on success only). Clear all keeps `drainUnread` and ends with one prefix invalidation. Inbox and alert page as before. Stream handler: see open decision 1.
- **Step 20** — 339 already shipped the stateful stub (`stubNotify`, `alert-stream.spec.ts:26-86`). The step moves it into the helper and adds `GetAlert`, `holdFirstList` and `failMarkRead` instead of writing `routeAlertReadState`. The seed is `DRAWER_ALERT_STORED_UNREAD` (Connect-JSON, usable as a route body), not `ALERT_DETAIL` (bigint `createdAt`). The streamed-raise and drawer-list re-assertions (D-24) are done by running 339's own `@AC-5` / `@AC-4` cases, not by copies.
- **Step 21** — the `Sheet` 339 shipped is uncontrolled and `SheetClose` is exported, so the old grep-else-stop is replaced by one instruction: the title link is wrapped in `SheetClose asChild` on every segment.
- **Step 22** — same cases on the 339 stub and fixture, plus a case that the drawer closes on `/accounts` (the header does not remount there) and the 339 "No alerts" text.
- Every Verification block now starts with `set -euo pipefail`, has one command per line, uses `if grep …; then exit 1; fi` for absence checks, and uses the host e2e fallback form; CI's `frontend-e2e` is the confirming run.

Open decisions for the operator:
1. **Stream handler vs D-24 (Step 19).** design.md §8 / D-24 says the stream `onMessage` path invalidates the count key. With 339's prune, that refetch drops a streamed alert the stored-unread list does not return; the shipped `271 @AC-5` test depends on such an alert (`ALERT_STREAM_HELD` is not in the mock's `unreadOnly` list). Specced conservatively: the handler stays as 339 shipped it (buffer, de-duplicated on `alertId`, no invalidation; no count is incremented, so R-13 holds). Alternative: invalidate on message and either add `ALERT_STREAM_HELD` to the mock list or stamp the entry so the refetch it triggers keeps it.
2. **339's e2e helpers move into a shared helper (Steps 18, 20).** `bellOf` / `badgeOf` and `stubNotify` leave `e2e/trader/alert-stream.spec.ts` for `e2e/helpers/alertReadState.ts` (import-only change to 339's spec). Chosen for the DRY guard rail; the alternative is a second, near-identical stub and locators in the new specs with 339's file untouched.
3. **The key name and its value (Step 19).** `ALERT_UNREAD_COUNT_KEY` holds the stored-unread list, not a number; design.md §7's "selecting `unreadCount` from `listAlerts({ limit: 1 })`" is superseded by 339's constraint and the old spec's Case A. Raised only because the name no longer describes the value; no rename is specced.
4. **Step 20 seeds a 339 fixture, not `ALERT_DETAIL`.** `@AC-6` is asserted on `alert-drawer-stored-unread`; no new fixture. Alternative: a Connect-JSON copy of `ALERT_DETAIL`.

Left as is, for the Step 23 executor: Step 23's anchors are pre-merge (for example the `PlatformHeader.tsx` comment is now at `:43`, and `pwa-push.md:21-23` still describes the pre-339 bell); it re-greps at execute. `design.md` and `debate.md` were not edited.

## Session 2026-11-16 — sdd-execute sequential (sdd-batch-execute), Step 17

### Step 17 — service: the bell in the shared header [done]
- Moved `AlertStream.tsx` from `components/trader/` to `components/shared/` with `git mv` (only content edit: `'../shared/CardNotice'` → `'./CardNotice'`); `AppShell.tsx` drops the import and the `<AlertStream />` element (`TradingModeBadge` and `AccountSelector` stay); `PlatformHeader.tsx` imports `./AlertStream` and renders `<AlertStream />` once in `PlatformHeaderInner` between `{actions}` and `<CopilotToggle />`. `shell.aria.yml` not touched; the theme spec passed on it. TDD (temporary probe of Step 18's `@AC-10` case, deleted before commit): AC-10 red `.sdd-logs/v-1.log` — `getByRole('banner').getByRole('button', { name: /^Alerts/, includeHidden: true })` `element(s) not found` on `/insights/opportunities`, `/config-ui`, `/accounts/notifications`, `3 failed`, `1 passed (1.2m)` (`/trader`), `exit=1` → green `.sdd-logs/v-2.log` — `4 passed (6.1s)`, `exit=0`. Verification `.sdd-logs/v-3.log`: lint warnings only in untouched files, `tsc --noEmit` clean, `All matched files use Prettier code style!`, `Test Files  81 passed (81)`, `Tests  605 passed | 2 skipped (607)`, the three greps passed, Playwright `79 passed (3.2m)` (alert-stream, stream-reconnect, mobile-overflow, nav-reachability, `e2e/accounts`, theme-bundle), `exit=0`. No coverage line: `test:unit` prints none and the component is outside `src/lib/**`. Config-key wiring gate: not applicable (no key).
- Files modified: `services/xstockstrat-ui/src/components/trader/AlertStream.tsx` → `services/xstockstrat-ui/src/components/shared/AlertStream.tsx`, `services/xstockstrat-ui/src/components/shared/PlatformHeader.tsx`, `services/xstockstrat-ui/src/components/trader/AppShell.tsx`
- Deviations: RED probe written and deleted (Step 18 owns the test); per-entry linked `node_modules` resolving `@xstockstrat/proto` to this worktree's stubs (operator note); probe runs on a separately built bundle — full detail in Deviation Log

## Session 2026-11-16 — sdd-execute sequential (sdd-batch-execute), Step 18

- **Operator decision on the Step 18 blocker (verbatim, 2026-11-16): "Fix the header now (Recommended)"** — Option A, as shown to the operator: between 640px and 768px, show the five main nav links as icons only, their labels kept for screen readers, so the row fits with the bell; changes the shared header for every page at that width; lands inside 344 as a logged scope expansion. Applied in `PlatformHeader.tsx` and committed with Step 18 (Deviation Log).

### Step 18 — test: the bell on every segment [done]
- Moved `bellOf`/`badgeOf` (with their Radix comment) into `e2e/helpers/alertReadState.ts`; `e2e/trader/alert-stream.spec.ts` imports them, no test body changed. New `e2e/alert-bell.spec.ts`: `@AC-10` on `/trader`, `/insights/opportunities`, `/config-ui`, `/accounts/notifications` (one visible bell, badge visible and equal to the settled `/trader` badge text); one stream consumer on `/accounts/notifications` (≥ 1 `StreamAlerts` request, one bell); `@AC-9 @feature-270` dropped-stream indicator and reconnect on `/accounts/notifications`; `@AC-12 @feature-270` mode badge (`getByText(/^(paper|live)$/i)`, from `order-form.spec.ts`) and account selector (`getByRole('combobox')`, from `account-selector.spec.ts`) in the `banner` on `/trader`. `e2e/mobile-overflow.spec.ts` gains the six D-19 cases; `INVENTORY.md` gains the helper row. Operator-approved: Primary nav labels `sr-only md:not-sr-only` in `PlatformHeader.tsx`.
- TDD: AC-10 red `.sdd-logs/v-1.log` (pre-Step-17 tree) — `getByRole('button', { name: /^Alerts/, includeHidden: true })` `element(s) not found` on the three non-trader pages and the stream-consumer case, `alert-stream-disconnected` not found for `@AC-9`, 640px overflow `Received: 43`, `7 failed`, `36 passed (4.2m)`, `exit=1`. Header red `.sdd-logs/v-2.log` (Step 17 tree, before the header edit) — `page body scrolls horizontally by 83px at 640px` on both pages, `2 failed`, `31 passed (3.0m)`, `exit=1`. Green `.sdd-logs/v-3.log` — lint warnings only in untouched files, `tsc --noEmit` clean, the three greps passed, targeted `43 passed (3.3m)`, whole suite `652 passed (9.9m)` (incl. the six D-19 cases, theme-bundle `@AC-7 the shell banner keeps its accessible structure` with `shell.aria.yml` untouched, nav-reachability), no retry, `exit=0`. No coverage threshold applies to Playwright e2e. Config-key wiring gate: not applicable (no key).
- Files modified: `services/xstockstrat-ui/e2e/helpers/alertReadState.ts`, `services/xstockstrat-ui/e2e/trader/alert-stream.spec.ts`, `services/xstockstrat-ui/e2e/alert-bell.spec.ts`, `services/xstockstrat-ui/e2e/mobile-overflow.spec.ts`, `services/xstockstrat-ui/e2e/fixtures/INVENTORY.md`, `services/xstockstrat-ui/src/components/shared/PlatformHeader.tsx` (operator-approved, outside **Files**)
- Deviations: header change outside **Files** (operator Option A); RED on the pre-Step-17 tree; 640px overflow is pre-existing without the bell (43px) — full detail in Deviation Log

## Session 2026-11-16 — sdd-execute sequential (sdd-batch-execute), Step 19

### Step 19 — service: shared alert read models [done]
- `alertShared.ts` exports `ALERTS_QUERY_KEY = ['alerts']` and `ALERT_UNREAD_COUNT_KEY = ['alerts', 'unread-count']`. Bell (`AlertStream.tsx`): the stored-unread fetch is a `useQuery` on `ALERT_UNREAD_COUNT_KEY` whose query function bumps `seqRef` and returns `{ alerts, seq }`; an effect prunes `streamed` with `pruneStreamed` on new data; `fetchFailed` is the query's `isError`; `refreshUnread()` is one `invalidateQueries` on the count key (drawer open, and the mark-read catch); the per-row mark-read is a `useInvalidatingMutation` on `[ALERTS_QUERY_KEY]` with `errorHandled`; Clear all keeps `drainUnread` and ends with one prefix invalidation; the badge stays `mergeUnread(stored, streamed, readIds).length`; the stream handler is unchanged (no invalidation on message — conservative reading, open decision 1 still the operator's). Inbox: `useQuery([...ALERTS_QUERY_KEY, 'list'])`, mark-read through the same mutation with `mutateAsync` in the existing `try/catch`, skeleton on `isLoading`. Alert page: `mutate([res.alertId], { onSuccess })` through the same mutation; failure silent. Mutation opt-out audit: the four `markAlertRead` sites in `src` are the three `errorHandled` mutations and the `drainUnread` `mark` callback.
- TDD (temporary probe of Step 20's badge-drop cases, deleted before commit): AC-6 red `.sdd-logs/v-1.log` — client navigation to the alert page and inbox "Mark read" both left the bell at `Received: 1` (`Expected: 0`), `2 failed`, `exit=1` → green `.sdd-logs/v-2.log` — `2 passed (1.2m)`, `exit=0`. Verification `.sdd-logs/v-3.log`: lint warnings only in untouched files, `tsc --noEmit` clean, `All matched files use Prettier code style!`, `Test Files  81 passed (81)`, `Tests  605 passed | 2 skipped (607)`, coverage `Lines : 80.92% ( 632/781 )` (≥ 40%), the key/`errorHandled`/`markAlertRead`/`unreadCount` checks passed, Playwright `41 passed (2.1m)` with no retry (339's `@AC-3/4/5/9/10` and `271 @AC-5` PRESERVE guard included), `exit=0`. The web-server log carries `ECONNRESET` lines from aborted held streams; no test failed on them. Config-key wiring gate: not applicable (no key).
- Behaviour changes for the PR body and Step 23: the bell refetches on window focus and retries once (D-26), so "Could not load alerts" appears after the retry; a focus refetch prunes streamed alerts the stored list does not return, as a drawer open does; the inbox no longer shows its skeleton on a refetch.
- Files modified: `services/xstockstrat-ui/src/lib/alertShared.ts`, `services/xstockstrat-ui/src/components/shared/AlertStream.tsx`, `services/xstockstrat-ui/src/app/accounts/notifications/AlertInbox.tsx`, `services/xstockstrat-ui/src/app/accounts/notifications/[alert_id]/AlertDetail.tsx`
- Deviations: RED/GREEN probe written and deleted (Step 20 owns the spec), run with its own Playwright command; per-entry linked `node_modules` on this branch's TS stubs — full detail in Deviation Log

## Session 2026-11-16 — sdd-execute sequential (sdd-batch-execute), Step 20

- **Step 20 blocker, re-dispatched.** The first attempt found that a delayed first stored-unread `ListAlerts` settles the bell at the stale count and stopped on a tooling fault; its uncommitted work was kept as a patch and applied here. Operator relaunch, verbatim (2026-11-16): "Try relaunching step 20 again". The orchestrator relayed the fix choice as the operator's Option A: cancel, then invalidate, in one shared helper, with `useInvalidatingMutation` unchanged. It also accepted the two test deviations (Deviation Log).
- Ledger: no `fails.md` line. The TanStack trap (`invalidateQueries` reuses an in-flight fetch that has no data yet) is recorded in the Deviation Log and the helper's comment; Step 23 may carry it into the docs.

### Step 20 — test: read-state e2e and the stateful fixture [done]
- Moved 339's `stubNotify` and `DrawerAlert` into `e2e/helpers/alertReadState.ts` (exported, same behaviour for 339's callers) and added a `GetAlert` route (404 `not_found` for an unknown id) plus the `holdFirstList` (`releaseList()`) and `failMarkRead` (HTTP 500, records nothing) options. `e2e/trader/alert-stream.spec.ts` now only changes its imports. New `e2e/accounts/alert-read-state.spec.ts` has 5 cases: `@AC-6` direct open (no badge, `markedIds` exactly the one id, `data-read="true"` after reload); `@AC-6` client navigation from the inbox title; delayed first `ListAlerts` (two alerts, badge `1`); inbox "Mark read" → "0 unread" and no bell badge; failed page-open mark-read (`Unread`, no non-empty `role="alert"`). INVENTORY rows extended. The fix (outside **Files**) is `invalidateAlertReadModels` in `src/lib/alertShared.ts`: `cancelQueries` then `invalidateQueries` on `['alerts']`, called by the three mark-read sites and Clear all, with a vitest case pinning the race.
- TDD: race red `.sdd-logs/v-1.log`: `FAIL … invalidateAlertReadModels > @AC-6 a first fetch still in flight cannot overwrite the post-mark refetch`, `Error: Test timed out in 5000ms.`, `Tests  1 failed | 19 passed (20)`, `exit=1`. Green `.sdd-logs/v-2.log`: `Tests  20 passed (20)`, `exit=0`. AC-6 e2e red `.sdd-logs/v-4.log` (helper without the cancel): `a delayed first ListAlerts does not leave a stale badge` `Expected: "1"` / `Received: "2"` (and on retry), `1 failed`, `4 passed (1.7m)`, `exit=1`. The client-navigation and inbox cases were green there; their pre-Step-19 RED is Step 19's probe (`Received: 1`). Verification `.sdd-logs/v-8.log` (final tree): lint warnings only in untouched files, `tsc --noEmit` clean, the four greps and the `stubNotify` single-definition test passed, `--repeat-each=3` `15 passed (1.2m)`, and the regression line `59 passed (2.1m)` with no retry, `exit=0`. The regression line covers alert-stream, stream-reconnect, `e2e/accounts` and alert-bell, including 339's `@AC-3/4/5/9/10` and `271 @AC-5`. An earlier identical run before a whitespace-only `prettier --write` of the new spec is `.sdd-logs/v-5.log` (`15 passed`, `59 passed`, `exit=0`). Supplementary `.sdd-logs/v-7.log`: `All matched files use Prettier code style!` (src and the three e2e files), `Test Files  81 passed (81)`, `Tests  606 passed | 2 skipped (608)`, `Lines        : 80.97% ( 634/783 )`, `exit=0`. No coverage threshold applies to Playwright e2e. Config-key wiring gate: not applicable (no key).
- D-24 re-assertion: 339's streamed-alert raise (`@AC-5`) and drawer list (`@AC-4`) were re-asserted by running 339's own cases in `e2e/trader/alert-stream.spec.ts` through the moved stub (Verification regression line). They were not copied.
- Files modified: `services/xstockstrat-ui/e2e/helpers/alertReadState.ts`, `services/xstockstrat-ui/e2e/trader/alert-stream.spec.ts`, `services/xstockstrat-ui/e2e/fixtures/INVENTORY.md`, `services/xstockstrat-ui/e2e/accounts/alert-read-state.spec.ts`. Outside **Files** (operator Option A, relayed): `services/xstockstrat-ui/src/lib/alertShared.ts`, `services/xstockstrat-ui/src/lib/alertShared.test.ts`, `services/xstockstrat-ui/src/components/shared/AlertStream.tsx`, `services/xstockstrat-ui/src/app/accounts/notifications/AlertInbox.tsx`, `services/xstockstrat-ui/src/app/accounts/notifications/[alert_id]/AlertDetail.tsx`.
- Deviations: scope expansion for the cancel-then-invalidate fix; the delayed case seeds two alerts and expects `1`; the banner assertion skips the empty Next route announcer; RED on the uncancelled helper rather than the pre-Step-19 commit — full detail in Deviation Log. Closes the header thread "`invalidateQueries` cancelling an in-flight first fetch is untested", and the focus-refetch thread too (`--repeat-each=3` green).

## Session 2026-11-16 — sdd-execute sequential (sdd-batch-execute), Step 21

### Step 21 — service: drawer row title links to the alert page [done]
- `AlertStream.tsx` imports `Link` from `next/link` and adds `SheetClose` to the `'../ui/sheet'` import; inside each drawer row's existing `<p className="text-sm font-medium">` the title is `<SheetClose asChild><Link href={`/accounts/notifications/${a.alertId}`} className="hover:underline">{a.title}</Link></SheetClose>`. The `Sheet` stays uncontrolled; the `<li>`, the "Mark read" button and its `Mark read: <title>` name, Clear all and the notices are unchanged.
- TDD (temporary probe of Step 22's cases 1, 3 and 4, deleted before commit): AC-5 red `.sdd-logs/v-1.log` — badge `1` and the `Mark read: Backfill 67276d1f failed` button passed, then `waiting for getByRole('dialog').getByRole('link', { name: 'Backfill 67276d1f failed' })` `Test timeout of 30000ms exceeded` on both cases and their retries, `2 failed`, `exit=1` → green `.sdd-logs/v-2.log` — `2 passed (1.2m)` (the `/trader` link opens `/accounts/notifications/alert-drawer-stored-unread`; on `/accounts/notifications` the dialog has count 0 after the click), `exit=0`. Verification `.sdd-logs/v-4.log`: lint warnings only in untouched files, `tsc --noEmit` clean, `All matched files use Prettier code style!`, both greps matched (`203: <SheetClose asChild>`, ``205: href={`/accounts/notifications/${a.alertId}`}``), Playwright `22 passed (2.3m)` with no retry (339's `@AC-3/4/5/9/10`, `271 @AC-5`, alert-bell and alert-read-state included), `exit=0`. The web-server log carries `ECONNRESET` lines from aborted held streams; no test failed on them. An earlier run `.sdd-logs/v-3.log` died at the Next build on `ENOSPC` (full host disk) with no `exit=` line. No coverage line: no vitest in the block and the component is outside `src/lib/**`. Config-key wiring gate: not applicable (no key).
- Files modified: `services/xstockstrat-ui/src/components/shared/AlertStream.tsx`
- Deviations: RED/GREEN probe written and deleted (Step 22 owns the spec); per-entry linked `node_modules` on this branch's TS stubs; one Verification run lost to a full disk — full detail in Deviation Log

## Session 2026-11-16 — sdd-execute sequential (sdd-batch-execute), Step 22

### Step 22 — test: drawer link e2e [done]
- `e2e/accounts/alert-read-state.spec.ts` imports `bellOf` and adds `test.describe('alert drawer link (feature 344)')` with 3 cases on `stubNotify(page, [DRAWER_ALERT_STORED_UNREAD], 'held')`: `@AC-5` on `/trader` (badge `1`, click the drawer title link, URL ends `/accounts/notifications/alert-drawer-stored-unread`, `alert-detail` has the title; then after `markedIds` holds the id, no bell badge and the drawer shows "No alerts"); the drawer closes on `/accounts/notifications` (dialog count 0 after the click); no `a button` in the open drawer and the row keeps `Mark read: <title>`.
- TDD: AC-5 red `.sdd-logs/v-2.log` (pre-Step-21 `AlertStream.tsx`) — lint and `tsc --noEmit` passed, then `waiting for getByRole('dialog').getByRole('link', { name: 'Backfill 67276d1f failed' })` on all three new cases and their retries, `3 failed`, `15 passed (3.2m)`, `exit=1` → green `.sdd-logs/v-3.log` — lint warnings only in untouched files, `tsc --noEmit` clean, grep `89:  test('@AC-5 …`, targeted `18 passed (1.8m)`, whole suite `660 passed (9.4m)`, no retry, `exit=0`. The web-server log carries `ECONNRESET` lines from aborted held streams; no test failed on them. No coverage threshold applies to Playwright e2e. Config-key wiring gate: not applicable (no key).
- Files modified: `services/xstockstrat-ui/e2e/accounts/alert-read-state.spec.ts`
- Deviations: RED against the pre-Step-21 component; cases 1+2 in one test; build output on tmpfs through a private mount namespace (host disk full) — full detail in Deviation Log

## Session 2026-11-16 — sdd-execute sequential (sdd-batch-execute), Step 23

### Step 23 — docs: alert page, bell on every page, findings [done]
- `pwa-push.md`: Notifications nav note (the shell reads `NAV_GROUPS`; `PLATFORM_SUBNAV` is legacy), inbox on `['alerts', 'list']`, a Bell bullet (shared `AlertStream` in `PlatformHeaderInner`, `ALERT_UNREAD_COUNT_KEY`, every mark-read path through `invalidateAlertReadModels` cancel-then-invalidate on `['alerts']`, per-segment cache, focus refetch + one retry, one stream and one unread query per tab — accepted) and an Alert page bullet (`/accounts/notifications/<alert_id>`, `GetAlert` via `traderBff`, mark-read after load, "Alert not found" on `Code.NotFound`, links from inbox title, drawer title and push `url`). UI constitution: second sanctioned UI-2 case for the header bell (D-18). UI findings: "Documentation that lies" row for the `PlatformHeader.tsx#useHeaderIsAdmin` comment (~L44-45). Notify constitution: NOTIFY-7 amended in place with `GetAlert` as the header-only counter-example. Notify findings ("Latent bugs"): D-13 stream exposure, O-1 ruling (a) on-demand exposure (accepted 2026-11-15), R-3 `markAlertRead` without a visibility check. TDD: N/A (docs). Verification `.sdd-logs/v-1.log`: all four greps matched (pwa-push `:24`, `:26`, `:32`; constitution `:21`; findings `:17`; notify `context-constitution.md:19`, findings `:26`, `:27`), `exit=0`; each touched doc re-read against the code it cites.
- Final gate (last step): `node scripts/check-config-wiring.mjs --final` `.sdd-logs/v-2.log` `exit=0`; two baseline `REPORTED:` lines unrelated to 344 (`analysis fundsignal_loop.py marketdata/fundamentals.provider:readers-disagree`, `trading trading.go platform/trading_state:readers-disagree`). All 23 steps done → `status.md` `code-completed`. No `insights.md` line: the reusable trap (TanStack `invalidateQueries` reusing an in-flight first fetch) is now in `pwa-push.md` and the helper comment.
- Files modified: `services/xstockstrat-ui/docs/pwa-push.md`, `services/xstockstrat-ui/docs/context-constitution.md`, `services/xstockstrat-ui/docs/context-constitution-findings.md`, `services/xstockstrat-notify/docs/context-constitution.md`, `services/xstockstrat-notify/docs/context-constitution-findings.md`
- Deviations: the R-3 entry is worded from the code (the response is `{}` either way, so not an existence probe); anchors re-grepped — full detail in Deviation Log

## Session 2026-11-16 — sdd-batch-execute promotion plan, built from the feature branch (awaiting operator confirm)

- Built by `scenario-promoter` on a checkout of this branch at `06db03339`; scenario bodies generated mechanically from `acceptance.feature` (only `@feature-344` added to each tag line). Merge-order: feature 339 merged into main-dev on 2026-11-16 (PR #1550) and main-dev is merged into this branch (a900126ff), so the 344-after-339 row is satisfied.

```sdd-batch-promotion-plan
## Promotion plan — alert-detail-page (feature 344)

Source: docs/roadmap/features/344-alert-detail-page/acceptance.feature at 06db03339 — 10 scenarios (@AC-1..@AC-10; @AC-10 is a Scenario Outline).

### Verdicts
- @AC-1, 2, 3, 4, 5, 6, 7, 9, 10 → services/xstockstrat-ui/acceptance/alert-detail-page.feature, CREATE, NEW (9).
- @AC-8 → services/xstockstrat-ingest/acceptance/alert-detail-page.feature, CREATE, NEW (1).
- No DUP, OVERLAP or CONFLICT. No existing durable scenario is edited by this plan.

### Ready-to-write blocks
--- services/xstockstrat-ui/acceptance/alert-detail-page.feature (CREATE) ---
# Promoted from docs/roadmap/features/344-alert-detail-page/acceptance.feature (Constitution C-16).
# Provenance: @feature-344.

Feature: alert-detail-page (ui)

  @AC-1 @FR-1 @FR-2 @FR-5 @feature-344
  Scenario: The alert page shows every detail of the alert
    Given an alert "a1f3" visible to the user with severity "ERROR", category "backfill", source service "xstockstrat-ingest", correlation id "c-77" and context field "job_id" = "67276d1f"
    When the page "/accounts/notifications/a1f3" is opened
    Then it shows "ERROR", "backfill", "xstockstrat-ingest", the created time, the title and the full body
    And it shows "c-77" and the context row "job_id" with "67276d1f"
    And it shows the alert as read

  @AC-2 @FR-3 @feature-344
  Scenario: Another user's alert cannot be opened
    Given an alert "b2e4" targeted at a different user
    When the page "/accounts/notifications/b2e4" is opened
    Then it shows "Alert not found"

  @AC-3 @FR-3 @feature-344
  Scenario: A broadcast alert can be opened by any user
    Given a broadcast alert "c9d0" with no target user
    When the page "/accounts/notifications/c9d0" is opened
    Then it shows the alert's title and body

  @AC-4 @FR-4 @feature-344
  Scenario: A Notifications list row links to the alert page
    Given the Notifications list shows the alert "a1f3"
    When its row is activated
    Then the page "/accounts/notifications/a1f3" is shown

  @AC-5 @FR-4 @feature-344
  Scenario: A drawer row links to the alert page
    Given the header Alerts drawer lists the alert "a1f3"
    When its row is activated
    Then the page "/accounts/notifications/a1f3" is shown

  @AC-6 @FR-5 @feature-344
  Scenario: Opening an unread alert marks it read
    Given the unread alert "a1f3" and a bell badge of "1"
    When the page "/accounts/notifications/a1f3" is opened
    Then the bell on that page shows no unread badge
    And after a reload the Notifications list shows the alert "a1f3" as read

  @AC-7 @FR-6 @feature-344
  Scenario: A push notification opens its alert page
    Given a delivered push notification for the alert "a1f3"
    When the notification is activated
    Then the app opens "/accounts/notifications/a1f3"

  @AC-9 @FR-3 @feature-344
  Scenario: An alert targeted at the user can be opened
    Given an alert "d4a7" targeted at the user
    When the page "/accounts/notifications/d4a7" is opened
    Then it shows the alert's title and body

  @AC-10 @FR-8 @feature-344
  Scenario Outline: The header bell is on every page of every segment
    Given a signed-in user with unread alerts
    When the page "<page>" is opened
    Then the header shows the Alerts bell
    And the bell shows the user's unread badge

    Examples:
      | page                    |
      | /trader                 |
      | /insights/opportunities |
      | /config-ui              |
      | /accounts/notifications |

--- services/xstockstrat-ingest/acceptance/alert-detail-page.feature (CREATE) ---
# Promoted from docs/roadmap/features/344-alert-detail-page/acceptance.feature (Constitution C-16).
# Provenance: @feature-344.

Feature: alert-detail-page (ingest backfill-failure alert body)

  @AC-8 @FR-7 @feature-344
  Scenario: A backfill failure alert reads in plain language
    Given a backfill job "67276d1f" that failed with gRPC status FAILED_PRECONDITION and details "marketdata.fundamentals.history.enabled is false"
    When the failure alert is emitted
    Then its body is "Backfill job 67276d1f failed: FAILED_PRECONDITION — marketdata.fundamentals.history.enabled is false"
    And its body does not contain "AioRpcError"
    And its context field "error" holds the raw exception text

### Notes
- Attribution: @AC-2, @AC-3 and @AC-9 assert the page's text, so they go to ui although notify's GetAlert enforces the visibility rule; @AC-8 asserts the alert body ingest writes.
- Existing rules checked and still literally true: 271 @AC-5, 270 @AC-9, 165 @AC-9 (ui), 165 @AC-4/@AC-5 (notify), 203 @AC-1..@AC-6, 242 @AC-2/@AC-5, 334 @AC-20/@AC-30, 339 @AC-3/4/5/9/10.
- design.md describes extra cases that have no scenario in acceptance.feature and are therefore NOT promoted: the code-only and non-RPC fallback bodies for @AC-8, the every-segment variants of 270 @AC-9 and 271 @AC-5, and the notify push payload url.

### Coverage check
- Source scenarios: 10. Planned: 10 NEW (ui 9, ingest 1), 0 DUP, 0 OVERLAP, 0 CONFLICT.
```

## Session 2026-11-16 — operator confirmations before the integration PR (orchestrator)

- Asked: confirm the promotion plan above (10 scenarios verbatim, tags kept: 9 in `services/xstockstrat-ui/acceptance/alert-detail-page.feature`, 1 in `services/xstockstrat-ingest/acceptance/alert-detail-page.feature`)? **Operator, verbatim: "Confirm (Recommended)".** This confirms the last `sdd-batch-promotion-plan` block (P-04).
- `271 @AC-5` EXTEND (the alert stream now runs in the header on every segment): **Operator, verbatim: "Reword it in 344's PR".** This closes the missing sign-off on the wider behaviour. The exact reworded line still needs the operator's sign-off before it is written; it is NOT part of the confirmed plan block and lands as a separate commit on this branch.
- Re-spec open decision 1 (stream `onMessage` does not invalidate the unread query; 339's buffer behaviour kept): **Operator, verbatim: "Keep as built (Recommended)".** D-24's invalidate-on-message is superseded for this handler.
- Merge-order gate: feature 339 merged into main-dev (PR #1550) and main-dev is merged into this branch (a900126ff).
- Orchestrator decisions made under the standing authorization and reported to the operator (not operator words): Step 18 header change was the operator's ("Fix the header now"); Step 20's cancel-before-invalidate helper and its two test deviations were the orchestrator's.

## Session 2026-11-16 — wording of feature 271 `@AC-5` (orchestrator)

- Shown to the operator: `Given a signed-in trader with the alert stream open` → `Given a signed-in user on any segment page with the alert stream open` (first line only; title, tags and the other steps unchanged). **Operator, verbatim: "Signoff".** File: `services/xstockstrat-ui/acceptance/fix-ui-transport-hardening.feature`. Wording only; no test or behaviour change.
