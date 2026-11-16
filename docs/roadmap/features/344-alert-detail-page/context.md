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
- [ ] Header width at 640–1024px with the bell in the insights and accounts headers — target: Step 18.
- [ ] Every open tab holds a `StreamAlerts` stream and runs the count query — accepted; target: Step 23.
- [ ] Raw exception text on broadcast backfill alerts is readable on demand by every authenticated user — accepted by the operator (ruling (a)); target: Step 23 findings entry.
- [ ] No end-to-end test of `context` over the real notify → BFF → browser path — accepted gap; covered in halves by Steps 4, 10 and 12.
- [ ] The four relayed operator answers ("1. Approved / 2. Confirmed / …") have no recorded questions; items 1, 2 and 4 ("There are no production instances. Staging is enough.") are unapplied — target: orchestrator states what they answered before execute.
- [ ] `origin/main-dev` was not merged into the feature branch at sdd-spec (4 commits ahead then, docs and `uv.lock` only); it adds NOTIFY-14..17 to the notify constitution — target: Step 23 re-greps the ids.
- [ ] `165 @AC-9`, `165 @AC-4` and `271 @AC-5` EXTEND lines were recorded at the round-4 gate as not covered by an operator decision; the later design approval names none of them — target: operator confirms at the execute checkpoint of the steps that touch them (Steps 5–6 push `url`; Step 18 bell in every segment).

## Files Modified

Steps 1+2: `packages/proto/notify/v1/notify.proto` and the regenerated notify stubs under `packages/proto/gen/{go,python,ts}/notify/v1/` and `packages/proto/gen/ts/dist/notify/v1/`. Steps 3+4: `services/xstockstrat-notify/src/grpc/notifyServiceImpl.ts`, `services/xstockstrat-notify/src/__tests__/notifyServiceImpl.test.ts`. Steps 5+6: `services/xstockstrat-notify/src/fanout/webPush.ts`, `services/xstockstrat-notify/src/__tests__/webPush.test.ts`. Step 7: `services/xstockstrat-ingest/app/handlers/servicer.py`. Step 8: `services/xstockstrat-ingest/tests/test_ingest_servicer.py`. Step 9: `services/xstockstrat-ui/src/lib/traderBff.ts`. Step 10: `services/xstockstrat-ui/e2e/fixtures/{alerts.ts,INVENTORY.md}`, `services/xstockstrat-ui/e2e/mock-backend.ts`, `services/xstockstrat-ui/e2e/accounts/alert-detail.spec.ts`. Step 11: `services/xstockstrat-ui/src/lib/alertShared.ts`, `services/xstockstrat-ui/src/app/accounts/notifications/AlertInbox.tsx`. Step 12: `services/xstockstrat-ui/src/lib/alertShared.test.ts`, `services/xstockstrat-ui/src/lib/swHelpers.test.ts`. Step 13: `services/xstockstrat-ui/src/app/accounts/notifications/[alert_id]/{page.tsx,AlertDetail.tsx}`, `services/xstockstrat-ui/src/components/shared/PlatformHeader.tsx`. Step 14: `services/xstockstrat-ui/e2e/accounts/alert-detail.spec.ts`, `services/xstockstrat-ui/e2e/nav-reachability.spec.ts`, `services/xstockstrat-ui/e2e/fixtures/INVENTORY.md`. Step 15: `services/xstockstrat-ui/src/app/accounts/notifications/AlertInbox.tsx`. Step 16: `services/xstockstrat-ui/e2e/accounts/notifications.spec.ts`. Feature-directory artifacts:
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
