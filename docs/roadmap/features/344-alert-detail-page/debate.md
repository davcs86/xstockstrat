# Debate Register: alert-detail-page

**State**: in-debate
**Mode**: full
**Rounds run**: 4 (round numbers continue across runs; the mode's 2–5 / 1 bounds count this run only)

## Rounds

| Round | Date | Run by | +D | +R | O closed | +O | Petitions | Progress |
|---|---|---|---|---|---|---|---|---|
| 1 | 2026-11-15 | /sdd-batch | 9 | 5 | 0 | 4 | 0 | yes |
| 2 | 2026-11-15 | /sdd-batch | 4 | 2 | 2 | 2 | 1 | yes |
| 3 | 2026-11-15 | /sdd-batch | 6 | 3 | 3 | 3 | 3 | yes |
| 4 | 2026-11-15 | /sdd-batch | 7 | 3 | 2 | 0 | 0 | yes |

## Settled Decisions

<!-- Status: settled → superseded by D-m (only after a user-approved REOPEN) -->
| ID | Round | Decision | Evidence | Status |
|---|---|---|---|---|
| D-1 | 1 | GetAlert is a new additive unary RPC (GetAlertRequest { alert_id = 1 }); no migration, no config keys. | packages/proto/notify/v1/notify.proto:51 (Alert.context already exists); unchallenged by the adversary. | settled |
| D-2 | 1 | GetAlert takes identity from the x-user-id header only; missing identity is code 3; missing, not-visible and malformed ids all return code 5, with a UUID shape check before the query. | notifyServiceImpl.ts:202-204,229,239; migrations/001_notify_alerts.up.sql:7; NOTIFY-7; fails.md 2026-10-07. | settled |
| D-3 | 1 | context is mapped only in getAlert via a one-line spread; rowToAlert and ListAlerts are unchanged. | notifyServiceImpl.ts:371-391; no ListAlerts consumer reads context (adversary grep); C-18. | settled |
| D-4 | 1 | The ts-proto Struct round-trip is proven by a notify Alert.encode/decode unit test (string, list, number, empty object); e2e covers UI rendering and the NOT_FOUND path only. | e2e/mock-backend.ts:663 is a connect-es router; notifyServiceImpl.ts:113,124 already sends plain-object context via ts-proto. | settled |
| D-5 | 1 | The push deep link rides the existing optional PushPayload.url; sw.js and the audience code are unchanged. | webPush.ts:51,110-136,143-148; public/sw.js:30,57,64. | settled |
| D-6 | 1 | Ingest body uses code name plus details (code name alone when details is empty) for AioRpcError and a fixed text otherwise, via an optional detail parameter passed only at servicer.py:591-593; context["error"] keeps the raw text. | servicer.py:489-495,519-544,574-593,601-608,762,774; 344 @AC-8; operator decision. | settled |
| D-7 | 1 | The page marks read only after a successful GetAlert, via the existing MarkAlertRead with the server-returned alert id; failure is non-blocking. | Operator decision; notifyServiceImpl.ts:211-217 (idempotent insert); AlertInbox.tsx:46. | settled |
| D-8 | 1 | UI reads context as a protobuf-es v2 JsonObject through a shared contextEntries helper; formatWhen moves to src/lib/alertShared.ts. | services/xstockstrat-ui/package.json:23; fails.md:541-543; AlertInbox.tsx:12-16. | settled |
| D-9 | 1 | Row links go on the title (inbox and, after 339, drawer); the Notifications nav entry matches by prefix and the child route is added to e2e/nav-reachability.spec.ts. | AlertInbox.tsx:92-96,116,122-131; PlatformHeader.tsx:93-96; e2e/nav-reachability.spec.ts:53; C-10. | settled |
| D-10 | 2 | The drawer-link step and a badge-source re-verify step are marked blocked-on 339 merged, with anchors re-grepped then; a 339 → 344 row in merge-order.md must exist before execute; no unread-count cache or invalidation is invented in 344. | AlertStream.tsx:19-32,104-117; operator decision that 339 lands first; proposal r2, unchallenged (adversary C-18 note). | reopened @ round 4 (operator steer) |
| D-11 | 2 | The impl-spec requires three tests: e2e getAlert NOT_FOUND → 'Alert not found' keyed on Code.NotFound; vitest contextEntries over a JsonObject (string, list, number, {}); notify Alert encode/decode round-trip. | Proposal r2 O-4 answer; D-4; D-8; unchallenged by the adversary. | settled |
| D-12 | 2 | The read-state e2e uses a stateful page.route() fixture that drops the unread count to 0 once MarkAlertRead is called, asserts the call carries the server-returned id without counting calls, names the AlertStream mount refetch as the badge refresh trigger, and checks the bell after a full page.goto('/trader'). | e2e/mock-backend.ts:685-693 (fixed MOCK_UNREAD_COUNT, markAlertRead stores nothing); AlertStream.tsx:19-32; fails.md 2026-10-07 lines 2773-2776; D-7. | reopened @ round 4 (operator steer) |
| D-13 | 2 | A findings-log entry records that StreamAlerts already sends context, including the raw error, to every connected subscriber of a broadcast alert, whatever the O-1 ruling. | notifyServiceImpl.ts:113,121-124,354-357; agreed by proposer and adversary. | settled |
| D-14 | 3 | The bell (AlertStream) is mounted once in PlatformHeaderInner beside {actions}, and its import and mount are removed from the trader AppShell, giving exactly one StreamAlerts consumer per page in every segment. | PlatformHeader.tsx:246-247; components/trader/AppShell.tsx:5,24 (only mount, grep); accounts/layout.tsx:25; config-ui/layout.tsx:13; operator steer reopening R-7; agreed by both sides. | settled |
| D-15 | 3 | The mount-move step is blocked on 339 merged, and the same step moves AlertStream.tsx to components/shared/. | 339 scenarios are written against the bell in trader AppShell actions (AppShell.tsx:20-26); adversary r3 sequencing and layering objections; fails.md l.412; D-10 pattern. | settled |
| D-16 | 3 | Under O-1 ruling (a), the non-RPC context["error"] value is str(e) with no sanitising or redaction; the exception type name is never used in the body. | Operator ruling 2026-11-15 (option a); D-6; R-5. | settled |
| D-17 | 3 | @AC-6 asserts the badge on the alert page itself; FR-8 and @AC-10 (bell on every segment including /accounts/*) are added; the product-spec Consumer Surface line is amended to match. | Operator decision 2026-11-15 rejecting the '/trader page load' rewording and requiring the bell on all pages. | settled |
| D-18 | 3 | A docs step extends the UI-2 sanctioned exception to the PlatformHeader bell in all segments, and a findings-log entry records the PlatformHeader.tsx:43-44 comment as doc drift. | services/xstockstrat-ui/docs/context-constitution.md:17,19; browserClients/notifyClient.ts:5; accounts/layout.tsx:24-27; QueryProviders.tsx:15. | settled |
| D-19 | 3 | The spec adds a 640–1024px overflow check for one insights route and one accounts route. | e2e/mobile-overflow.spec.ts:54,76-83; AlertStream.tsx:56; adversary r3, unanswered. | settled |
| D-20 | 4 | Supersedes the reopened D-10 clause: 344 adds ALERTS_QUERY_KEY = ['alerts'] and ALERT_UNREAD_COUNT_KEY = ['alerts','unread-count'] in src/lib/alertShared.ts; the bell count is a useQuery on the count key; every mark-read path (alert page, inbox) invalidates the ['alerts'] prefix through useInvalidatingMutation. The cache is shared within one segment's provider. | Operator steer round 4 reopening the D-10 clause; src/hooks/useInvalidatingMutation.ts:15-32; trader/providers.tsx:10 and QueryProviders.tsx:13 (one client per segment); adversary r4 prefix objection. | settled |
| D-21 | 4 | Supersedes the reopened D-12 clauses: the badge is asserted on the alert page itself on two paths (direct page.goto and client navigation from the inbox row title), with a delayed-first-ListAlerts race case and no page.goto('/trader') step; the refresh trigger is the prefix invalidation. | Operator steer round 4 reopening the D-12 clauses; accounts/layout.tsx:24-27 (header does not remount); proposal r4 item 4, accepted by the adversary. | settled |
| D-22 | 4 | Both mark-read call sites pass meta { errorHandled: true }, and the inbox uses mutateAsync inside its existing try/catch; an e2e shows a failed page-open mark-read raises no global error banner. | src/lib/queryClient.ts:15-20; mutationErrorStore.ts:36-38; AlertInbox.tsx:48-49; D-7. | settled |
| D-23 | 4 | The inbox list loads through useQuery(['alerts','list']) in place of local state and manual refetch, so a mark-read on any surface refreshes the bell, the inbox rows and the inbox 'N unread' badge; one e2e on /accounts/notifications asserts both badges drop together. | AlertInbox.tsx:19-40,63-65; adversary r4 (drawer → inbox direction); the proposer's own runner-up; C-18. | settled |
| D-24 | 4 | The post-339 step keeps 339's streamed-alert badge raise: the stream onMessage path invalidates the count key (never +1), the step re-asserts 339's streamed-alert scenario and a drawer-list assertion after the swap, and it adapts to whatever refresh mechanism 339 actually shipped. | 339 acceptance.feature:33-36; 339 context.md:18; AlertStream.tsx:34 (reconnect re-delivers); fails.md:2773-2776; fails.md:412. | settled |
| D-25 | 4 | The 339 constraint is recorded in 339's context.md as a design input (count key, drawer list under the ['alerts'] prefix, drawer mark-read on the prefix, stream-path invalidation), and the 339 → 344 merge-order row points to it. | 339 directory has no design.md and no key constraint in context.md (grep); merge-order.md has no 339/344 row (grep); root CLAUDE.md makes context.md mandatory reading. | settled |
| D-26 | 4 | The spec names the bell's new refetch on window focus and its single retry as a behaviour change; badge tests assert values only. | src/lib/queryClient.ts:26 (staleTime 5_000, retry 1; refetchOnWindowFocus default); D-12 'no call counting' clause. | settled |

## Rejected Alternatives (locked)

<!-- Status: locked → reopened @ round N (user, context.md <ISO>) -->
| ID | Round | Alternative | Why rejected | Status |
|---|---|---|---|---|
| R-1 | 1 | Add context to rowToAlert / ListAlerts responses. | No consumer, larger list payload, wider exposure of raw error text. | locked |
| R-2 | 1 | Target backfill alerts at the triggering admin. | Changes push and stream audiences; out of FR-7's scope and would need sign-off. | locked |
| R-3 | 1 | Tighten markAlertRead in this feature. | Out of scope; logged as a finding instead. | locked |
| R-4 | 1 | Wrap the whole inbox row in a link. | Nests a button in an anchor and disturbs existing testids. | locked |
| R-5 | 1 | Use the exception type name as the fallback body. | Leaks implementation names. | locked |
| R-6 | 2 | Strip the `error` key in notify getAlert for callers without admin scope (O-1 option c). | StreamAlerts still sends the same field, and notify has no x-access-scope parsing; new mechanism that does not close the exposure. | locked |
| R-7 | 2 | Mount the bell (AlertStream) in the /accounts/* header to satisfy @AC-6 as written. | Adds a second StreamAlerts consumer per accounts page and scope on the component 339 rewrites; both sides rejected it. | reopened @ round 3 (operator steer); reopened @ round 4 (operator steer) |
| R-8 | 3 | A window event (ALERTS_READ_EVENT / announceAlertsRead) as the badge refresh signal. | A QueryClientProvider already wraps header and page in every segment; the event has a stale-response race and duplicates useInvalidatingMutation. | locked |
| R-9 | 3 | Mount the bell in a persistent root layout. | app/layout.tsx has no providers and stream remount behaviour would change in every segment. | locked |
| R-10 | 3 | Leave AlertStream under components/trader/ and move it later. | Unnamed deferral; shared/PlatformHeader would import from a segment folder. | locked |
| R-11 | 4 | Invalidate only ALERT_UNREAD_COUNT_KEY, leaving the drawer list and inbox list outside the shared prefix. | The drawer's stored-unread list and the inbox go stale after a mark-read; the prefix refreshes every alert read model with one call. | locked |
| R-12 | 4 | Keep the inbox on local state with invalidate plus manual refetch(). | Syncs inbox → bell only and keeps two refresh mechanisms; a drawer mark-read leaves the inbox count stale. | locked |
| R-13 | 4 | Increment the cached count (setQueryData +1) on a streamed alert. | A stream reconnect re-delivers alerts, so the count would double. | locked |

## Objections

<!-- Status: open → closed @ round N (<how>) | waived @ round N (user) | reopened @ round N (user) -->
| ID | Round | Objection | Blocking | Status |
|---|---|---|---|---|
| O-1 | 1 | Raw exception text in context["error"] is readable by any user on broadcast backfill alerts via the new page; needs an operator ruling between accept, sanitise at ingest, or redact for non-admins in getAlert. | yes | closed @ round 3 (Operator ruling 2026-11-15, option (a): accept and record. context["error"] keeps the raw text, no redaction, D-6 stands, the D-13 findings entry is kept. P-1 is moot because option (b) was not chosen.) |
| O-2 | 1 | @AC-6 'the bell shows no unread badge' is not observable on /accounts/*; needs operator sign-off to amend the scenario or to add the bell to the accounts header, plus re-verification against 339's badge refresh. | yes | closed @ round 3 (Operator ruling 2026-11-15: the bell goes on every page. Answered by the single PlatformHeaderInner mount, the amended @AC-6, new FR-8 and @AC-10, and the amended Consumer Surface line. The refresh mechanism continues under the new blocking objection.) |
| O-3 | 1 | 339 → 344 ordering is ungated: the drawer-link step must be marked blocked on 339's merge and the merge-order.md row added before execute. | no | closed @ round 2 (Adopted into the spec contract: drawer-link step marked blocked-on 339 merged with anchors re-grepped then, and the merge-order.md 339 → 344 row is a precondition of execute.) |
| O-4 | 1 | createDispatch code pass-through and the browser JsonObject type of Alert.context are unverified; the spec must require the NOT_FOUND e2e and the context-row tests. | no | closed @ round 2 (Adopted into the spec contract: NOT_FOUND e2e keyed on Code.NotFound, contextEntries vitest over a JsonObject, and the notify encode/decode round-trip test are required. The fallback-text wording moves to a new non-blocking objection.) |
| O-5 | 2 | The non-RPC fallback body 'unexpected error — see the alert details' and the non-RPC context["error"] value are undefined until O-1 is ruled; the impl-spec must define both for the ruling that lands, and the wording needs operator confirmation. | no | open |
| O-6 | 2 | AppShell mounting on the /trader page used by the bell assertion is unverified; the spec must grep the trader layout chain and name the exact page loaded. | no | closed @ round 3 (The bell moves to PlatformHeader and the page.goto('/trader') assertion is dropped, so the trader AppShell mount no longer matters; the adversary also accepted app/trader/page.tsx:3,22.) |
| O-7 | 3 | The shared-key invalidation and the alert-page badge assertion contradict one clause each of settled D-10 and D-12; the operator must reopen those clauses before approval. | yes | closed @ round 4 (The operator steer (round 4) reopened the D-10 clause and the two D-12 clauses; the replacement wording is recorded as superseding decisions, using the ['alerts'] prefix.) |
| O-8 | 3 | With the bell on /accounts/notifications, the inbox 'N unread' and the bell badge come from separate ListAlerts calls; the spec must make both read the shared key or honour the same invalidation. | no | closed @ round 4 (The inbox list moves to useQuery(['alerts','list']) and every mark-read path invalidates the ['alerts'] prefix, so the inbox count and the bell badge refresh on the same event in both directions; an e2e on /accounts/notifications asserts both drop together.) |
| O-9 | 3 | 339 has no design yet; the constraint that it builds its badge refresh on ALERT_UNREAD_COUNT_KEY must be recorded in 339's context or the merge-order note before 339's design runs. | no | open |

## Reopen Petitions

<!-- Verdict: dropped (evidence not new — already on record at <ID>) | pending user | user reopened | user declined -->
| ID | Round | Target | New evidence | Verdict |
|---|---|---|---|---|
| P-1 | 2 | D-6 | Conditional, raised by the adversary and applicable only if the operator rules O-1 option (b): GetAlert turns a short-lived, connected-session-only exposure of context["error"] (AlertStream.tsx:35-46,87; ListAlerts never returns context) into durable on-demand read access for every authenticated user, and push already limits untargeted alerts to admins (NOTIFY-8, feature 242 @AC-5). Option (b) would move the raw text out of context, reversing D-6 and the operator decision 'raw exception text stays only in the alert context'. | pending user |
| P-2 | 3 | R-7 | Operator ruling 2026-11-15 requires the bell on every page including /accounts/*. Moving the mount into PlatformHeaderInner removes trader's copy (AppShell.tsx:24), so the 'second consumer per accounts page' premise no longer holds. | pending user |
| P-3 | 3 | D-10 | Clause 'no unread-count cache or invalidation is invented in 344' only. The accounts header is rendered at layout level and persists across list → detail navigation (accounts/layout.tsx:24-27), so the mount refetch never fires where the operator requires the badge to drop. Narrowed per the adversary: 344 adds a react-query invalidation of a shared unread-count key through the existing useInvalidatingMutation. | pending user |
| P-4 | 3 | D-12 | Clauses 'names the AlertStream mount refetch as the badge refresh trigger' and 'checks the bell after a full page.goto("/trader")' only. The operator ruling 2026-11-15 requires the badge drop to be observable on the page where the alert is opened; the layout-level accounts header does not remount. The rest of D-12 stands. | pending user |
