# Design: alert-detail-page

**Created**: 2026-11-15
**Rounds**: 4 (full; termination: approved)
**Approved by**: user @ 2026-11-15
**Grounded in**: recon.md
**Debate register**: debate.md

---

## Chosen Approach

Every alert gets a page at `/accounts/notifications/<alert_id>` in `xstockstrat-ui`, backed by a new
`GetAlert` RPC on `xstockstrat-notify`. Opening the page marks the alert read. The header bell moves into
the shared header so the badge drop is visible on that page. Backfill-failure alerts from
`xstockstrat-ingest` get a plain-language body. No migration, no config key, no new inter-service edge
(recon.md:103-107).

Citations are `recon.md:<line>`. Where recon has no line for a claim, the `D-n` in `debate.md` carries the
code evidence.

### 1. Proto (D-1)

- Add `rpc GetAlert(GetAlertRequest) returns (Alert)` and `GetAlertRequest { string alert_id = 1; }` to
  `packages/proto/notify/v1/notify.proto` (recon.md:32, recon.md:103).
- `message Alert` is unchanged; `context` already exists on it (D-1).
- The request has no user field, mirroring `MarkAlertReadRequest` (recon.md:67).

### 2. notify — `getAlert` (D-2, D-3, D-4)

- New `getAlert` method on the impl object in `notifyServiceImpl.ts`. The object is registered whole, so no
  handler-map entry is needed (recon.md:19).
- Identity comes from the `x-user-id` header only. A missing identity returns code 3. The body-`userId`
  fallback and the unscoped branch of `listAlerts` are not copied (recon.md:65, recon.md:114).
- A UUID shape check runs before the query. A missing alert, an alert not visible to the caller and a
  malformed id all return code 5, so the three cases are indistinguishable (recon.md:66, recon.md:113).
- The SQL reuses the `listAlerts` read join and visibility predicate, adding `a.alert_id = $2`
  (recon.md:63).
- `context` is mapped only in `getAlert`, by a spread over the `rowToAlert` result. `rowToAlert` and
  `ListAlerts` responses are unchanged (recon.md:23, recon.md:111).
- A notify unit test proves the `Alert.encode`/`decode` round-trip of `context` for a string, a list, a
  number and an empty object (D-4, D-11).
- Each notify change lands with its tests in one step, because the notify build compiles tests
  (recon.md:126).

### 3. notify — push deep link (D-5)

- The push payload built in `webPush.ts` sets the existing optional `PushPayload.url` to
  `/accounts/notifications/<alertId>` (recon.md:28-29, recon.md:73).
- `sw.js`, `swHelpers.ts` and the push audience code are unchanged. The service worker already reads `url`
  (recon.md:48, recon.md:120-121).

### 4. ingest — backfill-failure body (D-6, D-16)

- `_emit_backfill_alert` gains an optional detail parameter, passed only by the FAILED caller that holds
  the raw exception (recon.md:54-55).
- For a `grpc.aio.AioRpcError` the body is `Backfill job <job_id> failed: <CODE> — <details>`, or the code
  name alone when details is empty (recon.md:59, recon.md:75).
- For any other exception the body is a fixed text. The exception type name is never used (D-16, R-5).
- `context["error"]` keeps the raw `str(e)`, with no sanitising and no redaction (O-1 ruling (a), D-16).
- The two fixed-string callers and the PARTIAL body are unchanged (recon.md:56, recon.md:124).
- The job row and the ledger event are unchanged. No reader of the old body was found (recon.md:125).

### 5. UI — BFF, page and links (D-7, D-8, D-9)

- BFF: `getAlert: forward(...)` beside `listAlerts` and `markAlertRead` in `traderBff.ts`
  (recon.md:37, recon.md:69).
- Page: `src/app/accounts/notifications/[alert_id]/page.tsx`, using the root-relative `notifyClient`
  (recon.md:36, recon.md:70). No REST route is added.
- The page shows severity, category, source service, created time, title, full body, read state,
  correlation ID and one row per context field.
- Context is read as a protobuf-es v2 `JsonObject` through a shared `contextEntries` helper. `formatWhen`
  and the helper live in `src/lib/alertShared.ts` (D-8, recon.md:47, recon.md:112).
- Severity uses `severityLabel` / `severityVariant`; loading, not-found and error states use `EmptyState`
  (recon.md:71-72).
- `Code.NotFound` renders "Alert not found", keyed on the Connect code and not the message text
  (recon.md:122).
- Mark read: after a successful `GetAlert`, the page calls the existing `MarkAlertRead` with the
  server-returned alert id. A failure is non-blocking (D-7, recon.md:68, recon.md:115).
- Inbox row: the link goes on the title, not the whole row, so the "Mark read" button is not nested in an
  anchor and the row testids stay (D-9, recon.md:43, recon.md:118).
- Nav: the `Notifications` entry in `PlatformHeader.tsx` changes from exact to prefix match. The child
  route is added to `e2e/nav-reachability.spec.ts` (recon.md:46, recon.md:119). The alert page gets no nav
  entry of its own (C-10).

### 6. UI — bell on every page (D-14, D-15, D-17, D-18, D-19)

- `AlertStream` is mounted once in `PlatformHeaderInner` beside `{actions}`. Its import and mount are
  removed from the trader `AppShell`. Every page in every segment then has exactly one `StreamAlerts`
  consumer (D-14; today's single mount is at recon.md:45).
- The same step moves `AlertStream.tsx` to `components/shared/` (D-15).
- A docs step extends the UI-2 sanctioned exception to the header bell in all segments and records the
  `PlatformHeader.tsx:43-44` comment as doc drift (D-18).
- The spec adds a 640–1024px overflow check for one insights route and one accounts route (D-19).
- Spec amendments: `@AC-6` asserts the badge on the alert page itself; FR-8 and `@AC-10` (bell on every
  segment, including `/accounts/*`) are added; the product-spec Consumer Surface line is amended to match
  (D-17).

### 7. UI — shared alert read models (D-20, D-22, D-23, D-26)

- `src/lib/alertShared.ts` exports `ALERTS_QUERY_KEY = ['alerts']` and
  `ALERT_UNREAD_COUNT_KEY = ['alerts', 'unread-count']`.
- The bell count is a `useQuery` on the count key, selecting `unreadCount` from
  `listAlerts({ limit: 1 })`. It replaces the one-shot mount fetch (recon.md:44, recon.md:116).
- The inbox list loads through `useQuery(['alerts', 'list'])` in place of local state and a manual
  `refetch()` (recon.md:43).
- Every mark-read path invalidates the `['alerts']` prefix through the existing `useInvalidatingMutation`:
  the alert page after a successful `GetAlert`, and the inbox "Mark read". One invalidation refreshes the
  bell count, the inbox rows and the inbox "N unread" badge, whichever surface did the mark-read.
- Both call sites pass `meta: { errorHandled: true }`, so a failed mark-read does not reach the global
  error fallback. The inbox calls `mutateAsync` inside its existing try/catch and keeps its own error text.
- The cache is shared within one segment's provider, not across segments. A segment switch remounts and
  refetches.
- Behaviour change to name in the spec: the bell now refetches on window focus and retries once.

### 8. Dependency on 339 (D-10 as amended, D-24, D-25)

- 339-fix-symbol-page-alerts-ui rewrites the same drawer and lands first (recon.md:117).
- One step is marked blocked on 339 merged. It holds the bell move and file move (section 6), the keys,
  invalidations and inbox query (section 7), and the drawer title link for `@AC-5`.
- That step re-greps what 339 shipped and adapts to it. It does not assume 339's shape.
- The step must keep 339's streamed-alert badge raise. The stream `onMessage` path invalidates the count
  key and never increments it, because a stream reconnect re-delivers alerts.
- The constraint on 339 is a design input, not a decision made for 339. It goes into 339's `context.md`,
  and the 339 → 344 row in `merge-order.md` points to it:
  - badge count on `ALERT_UNREAD_COUNT_KEY`;
  - the drawer's stored-unread list under the `['alerts']` prefix;
  - drawer mark-read through `useInvalidatingMutation` on the prefix;
  - the stream `onMessage` path invalidates the count key.
- Neither the 339 `context.md` line nor the merge-order row exists yet. Both are outside this feature
  directory and are a precondition of execute (O-9, open).

### 9. Tests the spec must require (D-11, D-12 as amended, D-21..D-24)

- notify: `getAlert` for a targeted alert, a broadcast alert, another user's alert, a malformed id and a
  missing identity; per-caller read state; the `context` round-trip; the push `url` assertion
  (recon.md:33, recon.md:77).
- ingest: the `AioRpcError` body, the code-only body, the non-RPC fallback body, raw text in
  `context["error"]`, unchanged PARTIAL and fixed-string bodies (recon.md:59, recon.md:79).
- UI vitest: `contextEntries` over a `JsonObject` (string, list, number, `{}`).
- UI e2e, with a stateful `page.route()` fixture that drops the unread count to 0 once `MarkAlertRead` is
  called, plus the fixture and `INVENTORY.md` row (recon.md:49, recon.md:78):
  - every field and context row renders; `NOT_FOUND` renders "Alert not found";
  - `MarkAlertRead` carries the server-returned id, with no call counting;
  - the badge drops on the alert page itself on two paths: a direct `page.goto` of the alert URL, and a
    client navigation from the inbox row title. There is no `page.goto('/trader')` step;
  - a delayed first `ListAlerts` response does not overwrite the refreshed count;
  - on `/accounts/notifications`, one "Mark read" click drops the inbox badge and the bell badge together;
  - after opening an alert from the drawer, the drawer no longer lists it as unread;
  - 339's "A streamed alert raises the badge without a reload" scenario is re-asserted after the swap;
  - a failed `MarkAlertRead` on the alert page shows no global error banner;
  - the `Notifications` nav entry is active on the child path;
  - the 640–1024px overflow check.
- Badge tests assert values only.

### Consumer surface (C-14)

- **UI** (`xstockstrat-ui`): the new page, reached from the Notifications list row title, the header
  Alerts drawer row title and a push notification; the bell with its unread badge on every page of every
  segment.
- **Agent**: none. No MCP tool changes.

### Build order

proto → notify `getAlert` + round-trip test → notify push `url` → ingest body → UI BFF + mock + fixture →
helpers + page + nav + e2e → inbox title link → [after 339] bell move + file move + keys + invalidations +
inbox query + drawer link + read-state / stream / width e2e → docs.

## Rejected Alternatives

One line per locked `R-n` in `debate.md`. `R-7` (mount the bell in the `/accounts/*` header) is not listed:
the operator reopened it and the bell mount was adopted as D-14.

- `R-1` Add `context` to `rowToAlert` / `ListAlerts` responses — rejected because no consumer reads it, the
  list payload grows and the raw error text is exposed more widely.
- `R-2` Target backfill alerts at the triggering admin — rejected because it changes push and stream
  audiences, is outside FR-7 and would need sign-off.
- `R-3` Tighten `markAlertRead` in this feature — rejected as out of scope; logged as a finding instead.
- `R-4` Wrap the whole inbox row in a link — rejected because it nests a button in an anchor and disturbs
  existing testids.
- `R-5` Use the exception type name as the fallback body — rejected because it leaks implementation names.
- `R-6` Strip the `error` key in notify `getAlert` for callers without admin scope — rejected because
  `StreamAlerts` still sends the same field and notify has no `x-access-scope` parsing.
- `R-8` A window event as the badge refresh signal — rejected because a `QueryClientProvider` already
  wraps header and page in every segment, and the event has a stale-response race and duplicates
  `useInvalidatingMutation`.
- `R-9` Mount the bell in a persistent root layout — rejected because `app/layout.tsx` has no providers and
  stream remount behaviour would change in every segment.
- `R-10` Leave `AlertStream` under `components/trader/` and move it later — rejected as an unnamed
  deferral; the shared header would import from a segment folder.
- `R-11` Invalidate only `ALERT_UNREAD_COUNT_KEY` — rejected because the drawer's stored-unread list and
  the inbox go stale after a mark-read; the prefix refreshes every alert read model with one call.
- `R-12` Keep the inbox on local state with invalidate plus manual `refetch()` — rejected because it syncs
  inbox → bell only, keeps two refresh mechanisms and leaves the inbox count stale after a drawer
  mark-read.
- `R-13` Increment the cached count on a streamed alert — rejected because a stream reconnect re-delivers
  alerts, so the count would double.

## Open Risks

- [ ] O-5 (open, non-blocking): the non-RPC fallback body `Backfill job {job_id} failed: unexpected error —
  see the alert details` has no operator confirmation on record — to be confirmed before the ingest step;
  `/sdd-spec` carries the wording as proposed.
- [ ] O-9 (open, non-blocking): the 339 constraint line in 339's `context.md` and the 339 → 344 row in
  `merge-order.md` are not written — precondition of execute; owner is the orchestrator.
- [ ] 339 may design or merge before its `context.md` line is written and ship a local-state badge; the
  post-339 step would then rework fresh code — handled at the post-339 step (re-grep and adapt).
- [ ] Moving the inbox list to `useQuery` changes its loading and error timing; the 203 inbox e2e and
  testids could be disturbed — verified at the post-339 step.
- [ ] The bell refetches on window focus and retries once; an e2e with a delayed first response can be
  perturbed by focus events — handled in the read-state e2e at the post-339 step.
- [ ] `invalidateQueries` cancelling an in-flight first fetch is taken from a reading of TanStack v5 and
  was not tested — proven by the delayed-first-`ListAlerts` e2e.
- [ ] Every open tab in any segment holds a `StreamAlerts` stream and runs the count query — accepted;
  noted in the docs step.
- [ ] Header width at 640–1024px with the bell in the insights and accounts headers — the D-19 check, not
  yet run; post-339 step.
- [ ] Under ruling (a), raw exception text on broadcast backfill alerts is readable on demand by every
  authenticated user — accepted by the operator; recorded in the findings log at the docs step (D-13).
- [ ] Cross-feature `@AC` ids (165, 203, 242, 270, 271, 334) are as cited in earlier rounds; only 339's
  streamed-alert scenario was re-read in round 4 — `/sdd-spec` re-verifies each id against its suite.
- [ ] No test covers the real notify (ts-proto) → BFF → browser (protobuf-es v2) path for `context` end to
  end — accepted gap; the notify round-trip test and the `contextEntries` vitest cover the two halves.

## Constitution Rules Touched

- `C-01` — honored by: every claim cites `recon.md` or `debate.md` evidence; `/sdd-spec` re-greps each
  anchor, and the post-339 anchors are re-grepped after 339 merges.
- `C-10` — honored by: no new nav entry; the `Notifications` entry matches child paths and the child route
  is in `e2e/nav-reachability.spec.ts`.
- `C-11` — honored by: full-mode design (recon + 4 rounds) before any code.
- `C-13` — honored by: the alert-detail and read-state fixtures live in the canonical fixture home with an
  `INVENTORY.md` row.
- `C-15` — honored by: `acceptance.feature` stays the single source; `@AC-6` is amended and `@AC-10` added
  there, each FR covered by a scenario.
- `C-16` — honored by: the Business Rules section below; each CHANGE names its operator decision.
- `C-18` — honored by: no speculative surface — `context` only in `getAlert`, one refresh mechanism, the
  inbox conversion justified by the drawer → inbox staleness it removes.
- `P-02` — honored by: proposer and adversary saw only the synthesized state each round.
- `P-03` — honored by: unverified items are listed under Open Risks, not asserted.
- `F-04` — honored: every path and symbol is cited to `recon.md` or to `debate.md` evidence; nothing
  invented. No Floor breach in any round.
- `NOTIFY-7` — honored by: `getAlert` requires `x-user-id` and has no unscoped branch.
- `NOTIFY-8` — honored by: push audience code is unchanged; only the payload gains `url`.
- `PLAT-4` — honored by: identity reaches notify through the existing BFF `forward`; no new outbound call
  site.
- `UI-2` — honored by: the sanctioned exception is extended in the docs step to cover the header bell in
  all segments (D-18).

## Business Rules Touched (C-16)

Operator decisions are recorded in `context.md` under "OPERATOR DECISIONS (binding, recorded 2026-11-15)"
and the 2026-11-15 design-gate sessions.

- CHANGE `344 @AC-6` "Opening an unread alert marks it read" (`acceptance.feature`) — the badge is asserted
  on the alert page itself; signed off by the operator @ 2026-11-15 (design gate: the bell with its unread
  badge is on every page, including `/accounts/*`, so the drop is observable where the alert is opened;
  D-17).
- CHANGE `344 @AC-8` "A backfill failure alert reads in plain language" (`acceptance.feature`) — the body
  rule gains the code-only and non-RPC fallback cases; signed off by the operator @ 2026-11-15
  (plain-language bodies, raw text only in context; O-1 ruling (a)). The fallback wording itself is still
  open as O-5.
- EXTEND `344 @AC-10` (new, `acceptance.feature`) — new case added: the bell is present on every segment,
  including `/accounts/*` (operator @ 2026-11-15, design gate; FR-8).
- EXTEND `@AC-9 @feature-270` "A dropped alert stream is shown to the user and reconnects"
  (`services/xstockstrat-ui/acceptance/fix-ui-trader-feedback.feature`) — new case added: the same
  indicator and reconnect hold for the bell in every segment's header (operator @ 2026-11-15, design gate).
- EXTEND `@AC-5 @feature-271` "The alert stream is not cut off by the unary default deadline"
  (`services/xstockstrat-ui/acceptance/fix-ui-transport-hardening.feature`) — new case added: the stream
  now runs in every segment; the unary `GetAlert` does not alter the stream deadline handling.
- EXTEND `@AC-9 @feature-165` "Clicking a push notification opens the app"
  (`services/xstockstrat-ui/acceptance/pwa-notifications.feature`) — new case added: the click opens the
  alert page url; focus-existing-window-else-open stays.
- EXTEND `@AC-4 @feature-165` "An emitted alert is pushed to the target user's devices"
  (`services/xstockstrat-notify/acceptance/pwa-notifications.feature`) — new case added: the payload
  carries the alert url; title, body and per-endpoint sends stay.
- EXTEND `@AC-6 @feature-203` "The notifications inbox shows level, module, body, and unread state"
  (`services/xstockstrat-ui/acceptance/alert-read-unread-persistence.feature`) — new case added: the row
  title links to the alert page; row content, unread indicator and testids stay (recon.md:88).
- PRESERVE `@AC-5 @feature-339` "A streamed alert raises the badge without a reload"
  (`docs/roadmap/features/339-fix-symbol-page-alerts-ui/acceptance.feature`) — not regressed by: the
  stream path invalidates the count key, and the scenario is re-asserted after the swap (D-24).
- PRESERVE `@AC-5 @feature-165` "Push dispatch never fails or delays the primary emit"
  (`services/xstockstrat-notify/acceptance/pwa-notifications.feature`) — not regressed by: the payload
  change adds no `EmitAlert` failure path.
- PRESERVE `@AC-1 @feature-203` "Marking a targeted alert read flips it to read for that user"
  (`services/xstockstrat-notify/acceptance/alert-read-unread-persistence.feature`) — not regressed by: the
  page-open mark-read uses the existing `MarkAlertRead`.
- PRESERVE `@AC-2 @feature-203` "A broadcast alert is unread for one user and read for another" (same
  suite) — not regressed by: `GetAlert` read state and the mark-read are per caller.
- PRESERVE `@AC-3 @feature-203` "MarkAlertRead is idempotent" (same suite) — not regressed by: repeat opens
  hit the existing `ON CONFLICT DO NOTHING`.
- PRESERVE `@AC-4 @feature-203` "unread_only filter returns only the caller's unread alerts" (same suite) —
  not regressed by: the list query and filter are untouched.
- PRESERVE `@AC-5 @feature-203` "Read state and acknowledged state are independent" (same suite) — not
  regressed by: opening the page changes read only.
- PRESERVE `@AC-2 @feature-242` "A targeted alert reaches only the target user's devices"
  (`services/xstockstrat-notify/acceptance/fix-push-untargeted-broadcast.feature`) — not regressed by: push
  audience unchanged.
- PRESERVE `@AC-5 @feature-242` "An untargeted alert is Web-Pushed only to admin-role users' devices" (same
  suite) — not regressed by: push audience unchanged.
- PRESERVE `@AC-12 @feature-270` "No trader page labels the account as Paper while the environment is
  unknown" (`services/xstockstrat-ui/acceptance/fix-ui-trader-feedback.feature`) — not regressed by: the
  bell is added beside `{actions}` in the shared header; the header's environment label is not touched.
- PRESERVE `@AC-20 @feature-334` "a hand-off notify rejects as INVALID_ARGUMENT is not retried forever"
  (`services/xstockstrat-ingest/acceptance/webhook-fanout-callback.feature`) — not regressed by: only the
  `_run_backfill` FAILED alert body changes.
