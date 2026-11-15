# Context Log: fix-symbol-page-alerts-ui

Append-only. Each session appends a new ## Session entry. Never delete or edit prior entries.

---

## Session 2026-11-15 (/sdd-triage)

- Bug reported via defect report `docs/reports/2026-11-15-ui-symbol-page-and-alerts-drawer-defects-defect.md`: Symbol page and alerts drawer UI defects
- Source: operator report from staging (homelab) on 2026-11-15, with screenshots; root causes from read-only recon the same day
- Severity: SEV-3
- Routed to SDD path (Track C)
- Created: feature.md, product-spec.md, acceptance.feature (regression scenario), context.md
- Affected services (from report): `xstockstrat-ui`
- Root cause hypothesis: see product-spec.md § Root Cause Hypothesis
- Recommended design depth: quick → `/sdd-design fix-symbol-page-alerts-ui quick` (rationale: SEV-3, single service, no proto/migration/config, clear root causes — rubric says skip, raised to quick because the operator asked for a full redesign of the Fundamentals card (a layout fork to debate once))
- Development branch: feature/fix-symbol-page-alerts-ui
- Operator decisions (2026-11-15): Fundamentals card gets a **full redesign** consistent with the rest of the symbol page (abbreviation acceptable, not mandated); strategy-less chip label defaults to the **row source**; drawer shows **unread only** (stored + live) with mark-read and a refreshing badge.
- Related, tracked separately: 342-chart-series-palette, 343-backtest-inline-backfill, 344-alert-detail-page, 340-fix-fundamentals-roe-unit, 341-fix-indicator-pane-warmup.

## Session 2026-11-15 — sdd-review product-spec

- Product spec approved. Status: draft → spec-ready.
- Warnings (6; none blocking):
  - C-15, FR-1 bound not exercised (@AC-1 used a 10-integer-digit market cap) — **resolved**: @AC-1 is now a Scenario Outline covering `6726553623.93` (the reported value) and `3450000000000.00` (13 integer digits).
  - C-15, FR-5 "each alert once" had no scenario — **resolved**: added @AC-9 (an alert both streamed and stored appears once; badge `1`).
  - C-15, FR-8 never compared the Notifications page unread count with the badge — **resolved**: @AC-3 now also asserts the Notifications page shows 1 unread alert.
  - C-15, FR-9 scenarios cover only the Notifications page — **resolved**: FR-9 now states all three pages render the one shared component, so the scenarios exercise it on the Push notifications card only.
  - Code-ground drift, Root Cause line refs — **resolved**: re-grepped `services/xstockstrat-ui/src/app/trader/positions/[symbol]/page.tsx`; `:1089` is the `Market cap` `fmtUsd` value (not a grid), `:1120` the Fundamentals grid, `:842,901` the other stat grids, `:444` the chip label. Spec wording clarified; recon should still re-verify line numbers.
  - C-14, BFF route registration for `MarkAlertRead` is conditional ("if the drawer's segment does not already expose it") — **open, for /sdd-design**: recon must settle whether a route registration is needed.
- Overlap findings: WARN — one soft, rebase-only file collision with peer `344-alert-detail-page` (status draft): both edit the header Alerts drawer rows in `src/components/trader/AlertStream.tsx` (339 FR-5/FR-6 unread-only list + mark-read vs 344 FR-4 drawer-row links; 344 product-spec.md:79 already says "order 339 first or record it in merge-order.md"). No config, proto or migration collisions; peers 340–343 have no concrete file overlap. Land 339 before 344.
- Recommended design depth: quick (SEV-3, single service, no proto/migration/config; one layout fork — the Fundamentals card redesign — to debate once)

OPERATOR DECISIONS (binding, recorded 2026-11-15):
- Fundamentals card gets a full redesign consistent with the rest of the symbol page; abbreviating large values is acceptable but not mandated; the page's other stat grids get the same overflow guard.
- A strategy-less opportunity chip is labelled from the row's source by default, never the ticker.
- The Alerts drawer shows unread alerts only (stored plus live), offers mark-read, and the badge refreshes on mark-read and on a streamed alert.
- The shared switch must render checked when checked wherever it is used.

## Session 2026-11-15 — sdd-batch design gate (round 2)

`/sdd-design fix-symbol-page-alerts-ui` full debate is at its approval gate after round 2 (gate policy: halt). `design.md` is not written and `status.md` is unchanged. The register is `debate.md` (D-1..D-14, R-1..R-10, O-1..O-16).

### Open Threads

- **Approach (round-2 best).** Five surgical changes in `services/xstockstrat-ui` only; no proto, migration or config change.
  1. `StatTile` value gets `wrap-anywhere`, plus `<wbr/>` after each comma from a helper private to `StatTile.tsx`; `min-w-0` is not added.
  2. The Fundamentals card becomes two labelled four-tile groups (Valuation; Quality & risk) with an as-of/source footer; Market cap uses a new `fmtUsdCompact`.
  3. `opportunityChipLabel` returns the strategy id, else the humanized source, else "No strategy"; never the symbol.
  4. `switch.tsx` moves to `data-[state=checked]:` / `data-[state=unchecked]:`, including the `dark:` compounds, with a `renderToStaticMarkup` guard test.
  5. The Alerts drawer lists unread only (stored plus streamed, merged and de-duplicated); the badge is the merged length; per-row mark-read replaces "Clear all"; fetches are sequence-guarded and prune the streamed buffer.
- **Strongest open objection (O-2, blocking, C-16).** Prune-on-fetch breaks the PRESERVE test for @AC-9 @feature-270 (`e2e/trader/stream-reconnect.spec.ts:105-133`): the shared mock streams `ALERT_STREAM_ALL` but its `listAlerts` never returns those ids, so opening the drawer prunes every streamed row. The fix is folded into the approach and the next proposer must confirm it: with `unreadOnly` set, the shared mock returns the stored unread rows plus `ALERT_STREAM_ALL` (stateless), which makes the default e2e badge 5 before and after opening.
- **Also blocking (O-3).** Each per-spec stateful `ListAlerts` stub for @AC-3/@AC-4/@AC-5/@AC-9 must include every already-streamed alert in later responses, minus the ids marked read.
- **Open, non-blocking.** O-7 (the bigint `createdAt` comparator throws as described), O-13 (group-header style), O-14 (test the `<wbr/>` helper), O-15 (`AlertStream` is mounted by the trader `AppShell`, not globally), O-16 (the switch rationale: `dark:` is `prefers-color-scheme`).
- **Operator question (O-12).** Do checkbox, field and questionnaire get the same `data-state` fix? This design leaves them unchanged.
- **Floor status.** No Floor breach; the adversary's verdict is NEEDS WORK.
- **Uncovered @AC changes.** None is a CHANGE. Two PRESERVE rules are not covered by an operator decision and must stay green: @AC-9 @feature-270 (dropped alert stream is shown and reconnects) and @AC-5 @feature-271 (alert stream not cut off by the unary deadline). @AC-1..@AC-9 of this feature are covered by the recorded operator decisions.
- **Unlocked fallback.** No pruning (remove streamed alerts only through local `readIds`), if the operator accepts an alert read in another tab lingering until the next trader navigation.
- **Peer 344.** Per the operator (2026-11-15), opening an alert's page marks it read. That is peer `alert-detail-page`'s job; it shows here through refetch-on-open. Feature 339 lands first and keeps drawer rows a plain `<li>`.

```sdd-batch-design-state
{
  "round": 2,
  "synth": {
    "approach": "Round-2 best approach: five surgical changes in `services/xstockstrat-ui` only (D-1..D-8), with no proto, migration or config change. One blocking gap remains: the shared e2e mock must model insert-before-broadcast, otherwise prune-on-fetch breaks the feature-270 reconnect test. The adversary's fix is folded in below as steps 5(e2e-a) and 5(e2e-f); the next proposer must confirm them explicitly.\n\n1. **StatTile guard (FR-1, FR-3, @AC-1, @AC-8)** — `src/components/shared/StatTile.tsx:21-24`.\n   - **Root cause (corrected).** All grids are `grid-cols-N`, so tracks are `minmax(0,1fr)`. Unbreakable mono text spills out of a fixed-width tile; the grid's `overflow-hidden` (`page.tsx:842,901,1120`) only clips at the outer edge. `min-w-0` is not added.\n   - **Fix.** `wrap-anywhere` on the value div (Tailwind 4.3.3, `package.json:80`).\n   - **Mid-digit mitigation.** When `value` is a string, a tiny helper private to `StatTile.tsx` inserts `<wbr/>` after each `,`. `wrap-anywhere` is the last resort. The helper gets a unit or render test, because it makes a tile with 7+ consumers format-aware.\n   - **e2e.** @AC-1/@AC-8 assert at tile level, in the same step: the value's bounding box lies inside its tile's box and `scrollWidth <= clientWidth`, with the tile located through its Eyebrow label. `mobile-overflow.spec.ts:45` cannot see an in-tile overprint.\n\n2. **Fundamentals redesign (FR-2)** — `page.tsx:1099-1128`.\n   - **Header.** `CardTitle className=\"text-base\"` with the `stale` badge on the right (`:1101-1109`), matching `OpportunitySection` (`:1006-1008`).\n   - **Body.** Two labelled groups of four tiles each, using the bordered tile-grid class string from `:842` with `sm:grid-cols-4`. No metric is added or dropped.\n     - Valuation: Market cap (`fmtUsdCompact`), P/E, P/B, EPS.\n     - Quality & risk: ROE, Debt/Equity, Beta, Div yield.\n   - **Group headers.** They must be visually distinct from the tile Eyebrow labels (for example a `text-xs` muted line); a bare `Eyebrow` reads flat. The proposer picks and records the style.\n   - **Footer.** `as of <date> · <source>` from `Fundamentals.as_of` and `source` (`marketdata.proto:240,242`), styled like the Opportunity `metaBits` line (`page.tsx:1074-1076`), rendered only when present.\n   - **No `sub` lines.** Loading and error branches stay verbatim (`:1112-1118`, feature 220).\n   - `fmtUsdCompact` goes in `src/lib/money.ts` with a Vitest test (D-2).\n\n3. **Chip (FR-4, @AC-2)** — `opportunityChipLabel(o)` in `src/lib/opportunityShared.tsx`, swapped in at `page.tsx:444`.\n   - Returns `strategyId`; else `source` with `_`/`-` as spaces and the first letter capitalized; else \"No strategy\". Never the symbol.\n   - Vitest goes in `opportunityShared.test.ts`.\n   - The empty-strategy fixture goes in `e2e/fixtures/opportunities.ts` with an `INVENTORY.md` row, used per-spec through `page.route` only.\n   - @AC-2 assertions scope to `getByRole('radio')`.\n   - Accepted gaps: the mobile `SignalRow` chip shows the raw source (`SectionRenderer.tsx:187-188`); same-source strategy-less rows get identical chips, distinct by `opportunityKey` (`page.tsx:443`).\n\n4. **Switch (FR-9, @AC-6, @AC-7)** — `src/components/ui/switch.tsx:20,27`.\n   - Rewrite every `data-checked:` / `data-unchecked:` to `data-[state=checked]:` / `data-[state=unchecked]:`, including the `dark:` compounds at `:27`, with an `// app-specific` marker. `data-disabled:` stays.\n   - **Rationale (corrected).** The app is not dark-only in Tailwind terms. `src/app/layout.tsx:26` sets no `dark` class and there is no `@custom-variant dark`, so `dark:` means `prefers-color-scheme: dark`. The compounds are rewritten for consistency; the checked thumb colour still depends on the OS setting, and fixing that is out-of-scope restyling.\n   - **Guard test.** `switch.test.ts` uses `React.createElement` with `renderToStaticMarkup`. It asserts `data-state=\"checked\"` and the `data-[state=checked]:` classes on root and thumb. The negative regex `/(^|[\\s:])data-(un)?checked:/` also catches the `dark:` forms. No new export (R-7).\n   - **e2e.** Geometry only: thumb and track bounding boxes, right edges for checked, left edges for unchecked.\n\n5. **Drawer and badge (FR-5..FR-8, @AC-3, @AC-4, @AC-5, @AC-9)** — `src/components/trader/AlertStream.tsx`, mounted by the trader `AppShell` (`components/trader/AppShell.tsx:24`). It remounts and refetches on every trader navigation; `/accounts/notifications` has no bell, so the design makes no cross-segment claim.\n   - **Pure helpers** in `src/lib/alertShared.ts`, covered by Vitest:\n     - `mergeUnread(stored, streamed, readIds)`: de-duplicates on `alertId`, drops `readIds`, sorts newest first. `createdAt.seconds` is a protobuf-es `bigint`, so the comparator must compare or map through `Number()`; it must not subtract a bigint from `Infinity`. A missing timestamp sorts first. This is a fixture tolerance, not a semantic rule: real broadcasts carry `createdAt` (`notifyServiceImpl.ts:116`). A Vitest case mixes missing and present timestamps.\n     - `pruneStreamed(streamed, resultIds, fetchSeq)`: keeps an entry whose id is in the applied result or whose `seq >= fetchSeq`.\n   - **State.** `stored`; `streamed` as `{alert, seq}[]`, capped at 50 and never blindly cleared; `readIds`; `seqRef`.\n   - **Fetches.** `listAlerts({unreadOnly:true, limit:50})` on mount, on `Sheet onOpenChange(true)` and after a successful mark-read. Each takes `seq = ++seqRef.current` and is applied only if it is still the latest. Applying sets `stored` and runs `pruneStreamed`.\n   - **Why pruning is sound in production.** Notify inserts the row before broadcasting (`notifyServiceImpl.ts:82-124`).\n   - **Stream.** The callback tags each alert with `seqRef.current`. `useReconnectingStream` wiring is unchanged (D-8).\n   - **Badge.** `merged.length` with `9+` kept (D-5). `hasHighSeverity` reads the merged list.\n   - **Mark read.** A per-row ghost button with `aria-label` \"Mark read: <title>\". It awaits `markAlertRead({alertIds:[id]})`, adds the id to `readIds`, then refetches.\n   - **Errors.** A failed fetch keeps the previous list and badge and shows `<CardNotice variant=\"error\">` above the list. A mark-read error uses the same notice and the row stays.\n   - **Rows** stay a plain `<li>` for peer 344. Per the relayed user request, opening an alert's page marks it read; that is peer 344's job, and it shows here through refetch-on-open. \"Clear all\" is removed (D-7).\n   - **e2e plan (each a stated step):**\n     - (a) Shared mock `listAlerts` (`e2e/mock-backend.ts:685-688`): when `unreadOnly` is set it returns the stored unread rows plus `ALERT_STREAM_ALL` as unread. This is stateless and models insert-before-broadcast. `AlertInbox` calls `listAlerts({})` (`AlertInbox.tsx:28`), so inbox specs and `MOCK_UNREAD_COUNT` are untouched.\n     - (b) Retitle `ALERT_LIST_002` from \"Order rejected\" to \"Buying power exceeded\" (`e2e/fixtures/alerts.ts:56-63`).\n     - (c) Add timestamped fixtures with `INVENTORY.md` rows: `ALERT_UNREAD_BACKFILL_FAILED`, `ALERT_READ_BACKFILL_DONE`, `ALERT_STREAM_ORDER_REJECTED_NEWER`.\n     - (d) Move `connectStreamBody`, `fulfillStream` and `gate` from `e2e/trader/stream-reconnect.spec.ts:14-44` to `e2e/helpers/connectStream.ts`.\n     - (e) Rewrite `e2e/trader/alert-stream.spec.ts`. `:31-45`: the default badge is 5 (2 stored unread plus 3 streamed, de-duplicated), before and after opening the drawer. `:47-56` and `:84-99`: locate the bell with `getByRole('button',{name:/^Alerts/})`; the feature-271 test expects the same 5. `:58-67` is kept. `:69-82` becomes a mark-read test.\n     - (f) The per-spec stateful `ListAlerts` stubs for @AC-3, @AC-4, @AC-5 and @AC-9 must include every already-streamed alert in each later response, minus the ids marked read. Otherwise opening the drawer prunes the streamed row.\n     - (g) `stream-reconnect.spec.ts:105-133` must pass unchanged in intent (PRESERVE @AC-9 @feature-270).\n\n**Build order:** 1 + 2, then 3, then 4, then 5. Step 5 lands before peer 344. A textual conflict with peer `fix-fundamentals-roe-unit` at `page.tsx:1095` is expected.",
    "open_objections": [
      {
        "text": "O-2 (C-16), still open: prune-on-fetch breaks the PRESERVE test for @AC-9 @feature-270 (e2e/trader/stream-reconnect.spec.ts:105-133) under the e2e plan as proposed. The shared mock streams ALERT_STREAM_ALL (mock-backend.ts:677-679) but its listAlerts never returns those ids, so the fetch on bell.click() at :130 prunes every streamed row and the assertions at :131-132 pass only by racing the response. The same cause breaks the rewritten alert-stream.spec.ts:47-56 and drops the default badge from 5 to 2 on first open. The proposal must state: with unreadOnly set, the shared mock returns the stored unread rows plus ALERT_STREAM_ALL as unread (stateless); and the knock-on that the default badge is 5 before and after opening, including in the feature-271 test (alert-stream.spec.ts:84-99).",
        "blocking": true
      },
      {
        "text": "O-3, still open: the race mechanics are answered (latest-wins sequence, prune instead of clear, readIds, Vitest). What is not stated is the stub rule the prune depends on: each per-spec stateful ListAlerts stub for @AC-3/@AC-4/@AC-5/@AC-9 must include every already-streamed alert in later responses. Without it, the @AC-5 opened-drawer ordering assertion is pruned on open.",
        "blocking": true
      },
      {
        "text": "O-7, still open: the mergeUnread comparator as described throws. createdAt.seconds is a protobuf-es bigint, and subtracting it from +Infinity is a TypeError. Compare, or map through Number() before using the sentinel, and add a Vitest case mixing missing and present timestamps. Also reword \"missing timestamp = just-arrived live alert\" as a fixture tolerance: real broadcasts carry createdAt (notifyServiceImpl.ts:116).",
        "blocking": false
      },
      {
        "text": "O-12, still open (operator question): do checkbox, field and questionnaire get the same data-state fix? This design leaves them unchanged and nobody has run them in a browser. New evidence for the operator: the dark: variant is media-query based (layout.tsx:26 has no dark class, no @custom-variant dark), so the unmapped-variant family reaches further than the switch.",
        "blocking": false
      },
      {
        "text": "New (P-03): the Fundamentals group headers. FR-2 says \"same stat-tile presentation\"; two grids under bare Eyebrow headers add a heading level at the same visual weight as the tile labels, and sm:grid-cols-4 differs from the sibling sm:grid-cols-3 grids. Pick a distinct group-header style, and record that the operator's \"full redesign\" decision sanctions the divergence.",
        "blocking": false
      },
      {
        "text": "New (C-10/C-18): the <wbr/>-after-comma logic makes the generic StatTile format-aware for 7+ consumers. Keep it a tiny helper private to StatTile.tsx with a unit or render test.",
        "blocking": false
      },
      {
        "text": "New (recon accuracy): design.md must not say AlertStream is mounted globally in the header. It lives in the trader AppShell (components/trader/AppShell.tsx:24) and remounts on every trader navigation; /accounts/notifications has no bell. Make no cross-segment badge claim.",
        "blocking": false
      },
      {
        "text": "New (P-03): correct the switch rationale. \"The app is dark-only\" is false in Tailwind terms; dark: is prefers-color-scheme. Rewriting the compounds stays, the thumb colour stays OS-dependent (out-of-scope restyling), and @AC-6/@AC-7 stay geometry-only.",
        "blocking": false
      }
    ],
    "floor_breaches": [],
    "business_rule_changes": [
      {
        "ac_id": "@AC-1",
        "kind": "CHANGE",
        "covered_by_operator_decision": true
      },
      {
        "ac_id": "@AC-2",
        "kind": "CHANGE",
        "covered_by_operator_decision": true
      },
      {
        "ac_id": "@AC-3",
        "kind": "CHANGE",
        "covered_by_operator_decision": true
      },
      {
        "ac_id": "@AC-4",
        "kind": "EXTEND",
        "covered_by_operator_decision": true
      },
      {
        "ac_id": "@AC-5",
        "kind": "CHANGE",
        "covered_by_operator_decision": true
      },
      {
        "ac_id": "@AC-6",
        "kind": "CHANGE",
        "covered_by_operator_decision": true
      },
      {
        "ac_id": "@AC-7",
        "kind": "PRESERVE",
        "covered_by_operator_decision": true
      },
      {
        "ac_id": "@AC-8",
        "kind": "EXTEND",
        "covered_by_operator_decision": true
      },
      {
        "ac_id": "@AC-9",
        "kind": "CHANGE",
        "covered_by_operator_decision": true
      },
      {
        "ac_id": "@AC-9 @feature-270 (fix-ui-trader-feedback.feature: dropped alert stream is shown and reconnects)",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "@AC-5 @feature-271 (fix-ui-transport-hardening.feature: alert stream not cut off by unary deadline)",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      }
    ],
    "rejected_alternatives": [
      "Fix each stat grid separately — lost to a single StatTile fix, because all three symbol-page grids render it.",
      "Truncate or ellipsize long values — lost because FR-1 needs the whole value drawn inside its tile (R-1).",
      "Compact formatting for every large-USD tile — lost as out of scope beyond the FR-3 overflow guard (R-2).",
      "Change fmtUsd itself to compact — lost because the Book screens share it; fmtUsdCompact is separate.",
      "Break hints returned from money.ts (an fmtUsdParts) instead of <wbr/> inside StatTile — lost because every call site would then carry the break logic.",
      "Full market cap as a StatTile sub line — lost because it brings the overflow back.",
      "Switch option (a), @theme/@utility blocks — lost on a possible collision with the feature-307 theme check (R-3).",
      "Switch option (b), global @custom-variant — lost because it changes checkbox, field and questionnaire rendering without an operator ruling (R-4); it stays an operator question.",
      "Export a class constant from switch.tsx for the guard test — lost because it changes the shadcn file shape (R-7).",
      "Badge = server unreadCount plus a streamed delta — lost because FR-8 would not hold by construction (R-5).",
      "Window CustomEvent for cross-page alert sync — lost as YAGNI (R-6).",
      "Keep the local-only \"Clear all\" — lost because it breaks FR-8.",
      "A source-to-label map for chip labels — lost as YAGNI; one humanizer function is enough.",
      "Scope every drawer assertion by row id instead of retitling the stored fixture — lost because one fixture edit fixes all three strict-mode collisions.",
      "A stateful shared mock that records which alerts it has streamed — lost because module-level mock state leaks across parallel specs (fails.md:1304); the stateless union of stored unread rows and ALERT_STREAM_ALL is used.",
      "No pruning: remove streamed alerts only through local readIds and let the per-navigation remount reconcile — lost for now on FR-8 strictness, since an alert read in another tab would linger until the next trader navigation. Not locked: it is the fallback if the operator accepts that window or the mock coupling proves fragile."
    ],
    "open_risks": [
      "Pruning can wrongly drop an unread alert if notify ever runs with read replicas or replication lag. Insert-before-broadcast (notifyServiceImpl.ts:82-124) holds within one instance only. The badge would undercount until the next open.",
      "Default e2e badge becomes 5 on every trader page that mounts AppShell. Specs that count span[data-slot=\"badge\"] page-wide were not checked exhaustively, and a full Playwright run in the execute sandbox is impractical (fails.md, feature 126).",
      "renderToStaticMarkup of the Radix Switch in the Vitest node environment is assumed to emit data-state; it has not been run.",
      "FR-8 holds only up to 50 unread alerts. pruneStreamed can also drop a streamed alert older than the 50 newest unread. Accepted under D-5.",
      "The checked switch thumb colour depends on the OS colour scheme, because dark: is prefers-color-scheme. Playwright defaults to light, so e2e sees only the light variant.",
      "The six other StatTile consumers were not run. A wrapped value, or a <wbr/> break in a comma-bearing string, may change tile height there.",
      "The wording \"No strategy\", \"Valuation\" and \"Quality & risk\" is the proposer's choice, not operator-confirmed.",
      "Peer fix-fundamentals-roe-unit edits the ROE row (page.tsx:1095), which this redesign moves; a textual merge conflict is expected.",
      "Peer 344 (alert-detail-page) builds on the drawer rows and marks an alert read when its page opens. Feature 339 must land first and keep rows as a plain <li>.",
      "Whether a durable @AC in services/xstockstrat-ui/acceptance encodes the old \"badge is server truth, not stream length\" intent is still unchecked. If one does, it is a CHANGE that needs C-16 handling."
    ],
    "constitution_rules_touched": [
      "P-02",
      "P-03",
      "C-10",
      "C-12",
      "C-13",
      "C-16",
      "C-17",
      "C-18"
    ],
    "rationale": "The adversary's verdict is NEEDS WORK with no Floor breach, and I agree. The proposal honours D-1..D-8 and reintroduces no locked R-n, so there is no register conflict to correct.\n\nEight round-1 objections are concretely answered and closed: O-1 (a real two-group layout with header and provenance footer), O-4, O-5, O-6, O-8, O-9, O-10 and O-11.\n\nThree stay open because the proposal does not answer them as written:\n- **O-2 (blocking).** The new prune rule relies on insert-before-broadcast, which the shared mock does not model. That breaks the feature-270 PRESERVE test.\n- **O-3 (blocking).** The race mechanics are sound, but the stub rule that every later ListAlerts response includes already-streamed alerts is unstated.\n- **O-7 (non-blocking).** The bigint comparator throws as described.\n\nO-12 remains an operator question. I folded the adversary's stateless mock fix and the stub rule into the approach so the next proposer only has to confirm them. The no-pruning alternative is kept as an unlocked fallback, because the adversary leans towards pruning but the operator could accept the brief FR-8 window.\n\nThe relayed user request that opening an alert's page marks it read belongs to peer 344 and is compatible here through refetch-on-open. The request to merge the current PR and start the batch is outside this synthesis step.",
    "register_delta": {
      "new_decisions": [
        {
          "text": "The Fundamentals card is two labelled four-tile groups (Valuation: Market cap, P/E, P/B, EPS; Quality & risk: ROE, Debt/Equity, Beta, Div yield) plus an as-of/source provenance footer, built only from existing fields, with no sub lines.",
          "evidence": "page.tsx:1099-1128,1074-1076; marketdata.proto:240,242; operator decision (full redesign); adversary confirms the footer is grounded and raises only header style"
        },
        {
          "text": "The mid-digit mitigation is <wbr/> after each comma for string values, in a helper private to StatTile.tsx, with wrap-anywhere as the last resort; min-w-0 is not added.",
          "evidence": "StatTile.tsx:21-31; package.json:80 (Tailwind 4.3.3); adversary accepts once tested"
        },
        {
          "text": "The dark: compounds in switch.tsx:27 are rewritten along with the bare forms; e2e for @AC-6/@AC-7 is geometry-only (bounding boxes).",
          "evidence": "switch.tsx:20,27; layout.tsx:26 (dark: is prefers-color-scheme); adversary: rewriting is right and harmless"
        },
        {
          "text": "The stored fixture ALERT_LIST_002 is retitled so stored and streamed alerts have distinct titles; assertions are not id-scoped.",
          "evidence": "e2e/fixtures/alerts.ts:19-26,56-63; stream-reconnect.spec.ts:131; alert-stream.spec.ts:55"
        },
        {
          "text": "A failed unread fetch keeps the previous list and badge and shows CardNotice variant=error; mark-read errors use the same notice and the row stays; mark-read buttons carry aria-label \"Mark read: <title>\".",
          "evidence": "CardNotice.tsx:5-17; AlertInbox.tsx:42-53; C-17; adversary raised no objection"
        },
        {
          "text": "The Connect stream framing helpers move from stream-reconnect.spec.ts to e2e/helpers/connectStream.ts for reuse by alert-stream.spec.ts.",
          "evidence": "e2e/trader/stream-reconnect.spec.ts:14-44; DRY guard rail; second consumer exists"
        }
      ],
      "new_rejected": [
        {
          "text": "A stateful shared mock that records which alerts it has streamed",
          "why": "Module-level mock state leaks across parallel specs (fails.md:1304); a stateless union with ALERT_STREAM_ALL is cheaper"
        },
        {
          "text": "Break hints returned from money.ts (fmtUsdParts) instead of <wbr/> inside StatTile",
          "why": "Every call site would carry the break logic"
        },
        {
          "text": "A full-value sub line under the compact Market cap",
          "why": "It brings the overflow back"
        }
      ],
      "new_objections": [
        {
          "text": "Fundamentals group headers: bare Eyebrow headers read flat against tile labels, and sm:grid-cols-4 diverges from sibling grids; pick a distinct header style and record that the operator's full-redesign decision sanctions the divergence (P-03).",
          "blocking": false
        },
        {
          "text": "The <wbr/> helper makes StatTile format-aware for 7+ consumers; keep it private and add a unit or render test (C-10/C-18).",
          "blocking": false
        },
        {
          "text": "design.md must describe AlertStream as mounted by the trader AppShell (AppShell.tsx:24), remounting per trader navigation, with no cross-segment badge claim.",
          "blocking": false
        },
        {
          "text": "Correct the switch rationale: the app is not dark-only in Tailwind terms; dark: is prefers-color-scheme and the thumb colour stays OS-dependent (P-03).",
          "blocking": false
        }
      ],
      "closed_objections": [
        {
          "id": "O-1",
          "how": "The proposal names a concrete redesign of page.tsx:1099-1128: header with stale badge, two labelled four-tile groups, provenance footer, no sub lines, eight tiles. The residual header-style point is a new non-blocking objection."
        },
        {
          "id": "O-4",
          "how": "Root cause corrected to unbreakable mono text in minmax(0,1fr) tracks; min-w-0 dropped."
        },
        {
          "id": "O-5",
          "how": "Mitigation recorded: <wbr/> after commas inside StatTile, wrap-anywhere as last resort."
        },
        {
          "id": "O-6",
          "how": "A failed fetch keeps the previous list and badge and shows a CardNotice error."
        },
        {
          "id": "O-8",
          "how": "Per-row aria-label \"Mark read: <title>\"; errors go through CardNotice."
        },
        {
          "id": "O-9",
          "how": "dark: compounds are rewritten; the guard uses renderToStaticMarkup with a regex that catches dark:-prefixed bare forms and no new export; e2e uses bounding boxes. The wrong dark-only rationale is tracked as a new non-blocking objection."
        },
        {
          "id": "O-10",
          "how": "The empty-strategy fixture is used per-spec through page.route only; @AC-2 assertions scope to getByRole('radio')."
        },
        {
          "id": "O-11",
          "how": "Both chip gaps are recorded as accepted (SectionRenderer.tsx:187-188; page.tsx:443)."
        }
      ],
      "reopen_petitions": [],
      "reopened": []
    }
  },
  "floor_breaches": []
}
```

## Session 2026-11-15 — sdd-batch design gate (round 3)

`/sdd-design fix-symbol-page-alerts-ui` full debate is at its approval gate after round 3 (gate policy: halt). `design.md` is not written and `status.md` is unchanged. The register is `debate.md` (D-1..D-19, R-1..R-12, O-1..O-23, P-1).

### Open Threads

- **Approach (round-3 best).** Five surgical changes in `services/xstockstrat-ui` only; no proto, migration or config change. Steps 1-4 are unchanged from round 2 (StatTile wrap guard, Fundamentals two-group redesign, `opportunityChipLabel`, switch `data-[state=…]` rewrite). Step 5 changes: D-7 is reopened on the operator's steer, so the Alerts drawer keeps per-row mark-read and gains a Clear all that persists through the existing `MarkAlertRead` RPC (D-15).
- **Clear all, as recommended.** A unit-tested `drainUnread` helper loops over `listAlerts({unreadOnly:true, limit:50})` and `markAlertRead(ids)` until no eligible id is left or a fixed iteration cap is hit. Only alerts created at or before the newest alert listed at click time are eligible. A cap hit or an error shows `<CardNotice variant="error">` and leaves the remaining rows. One shared `pending` flag disables Clear all and every per-row button while any mark-read call is in flight. The visible label "Clear all" is the accessible name.
- **Strongest open objection (O-17, blocking, P-03).** The proposer limited Clear all to the alerts listed at click (up to 50), on the claim that draining needs a contract change. That claim is false (`notifyServiceImpl.ts:211-218,231-257`), and listed-only repeats `fails.md:2774`. The synthesis adopts the capped drain; the proposer has not confirmed it, the `createdAt` cutoff, or the end state on a cap or error.
- **Also blocking (O-2, C-16, narrowed).** Each per-spec scenario must stub `StreamAlerts` as well as `ListAlerts`; otherwise the default mock streams `ALERT_STREAM_ALL` on every connect and the starting badge counts are wrong. The rule is folded into e2e step (f) for the proposer to confirm: hold every attempt for @AC-3/@AC-4/@AC-10; gate, deliver once, then hold for @AC-5/@AC-9; never `route.continue()`. A brief `alert-stream-disconnected` indicator after delivery is allowed.
- **Gate questions for the operator.**
  1. Clear-all scope: drain all unread with a cap (recommended), or listed-only with a "showing 50 of N" line?
  2. Clear all persists with no confirm and no undo (recommended; matches the inbox's "Mark all read"), or a confirm dialog? (O-18)
  3. Does the label stay "Clear all", not "Mark all read"?
  4. Reopen petition P-1 (D-7) is recorded as pending user; D-15 supersedes D-7 once confirmed.
  5. O-12: do checkbox, field and questionnaire get the same `data-state` fix? This design leaves them unchanged. It is not clear whether one of the operator's numbered gate answers ("update all pages") was given to this question.
- **Open, non-blocking.** O-19 (accessible name contains "Clear all"), O-20 (one shared in-flight flag), O-21 (@AC-10 fixtures get titles of their own), O-22 (spec amendments before `/sdd-spec`), O-23 (record the default-mock bell/inbox disagreement in `design.md`).
- **Closed this round.** O-3, O-7, O-13, O-14, O-15, O-16.
- **Floor status.** No Floor breach; the adversary's verdict is NEEDS WORK.
- **Uncovered @AC changes.** None is a CHANGE. Two PRESERVE rules are not covered by an operator decision and must stay green: @AC-9 @feature-270 (dropped alert stream is shown and reconnects) and @AC-5 @feature-271 (alert stream not cut off by the unary deadline). @AC-1..@AC-9 and the new @AC-10 (Clear all marks alerts read, persists, empties drawer and badge) are covered by the recorded operator decisions.
- **Spec amendments owed before `/sdd-spec`.** Remove the "mark all read" exclusion from `product-spec.md` § Out of Scope (the exact line was not located by grep), add FR-10 worded with the scope chosen at the gate, and add @AC-10 to `acceptance.feature`.
- **Unlocked fallback.** No pruning (remove streamed alerts only through local `readIds`), if the mock coupling proves fragile.
- **Peer 344.** Feature 339 lands first and keeps drawer rows a plain `<li>`; an alert marked read by peer `alert-detail-page` shows here through refetch-on-open.

```sdd-batch-design-state
{
  "round": 3,
  "synth": {
    "approach": "Round-3 best approach: five surgical changes in `services/xstockstrat-ui` only, with no proto, migration or config change. Steps 1-4 are unchanged from round 2 (D-1..D-4, D-9..D-11). Step 5 changes: D-7 is reopened, so the drawer keeps per-row mark-read and gains a persisting Clear all.\n\nTwo things are corrected against the proposal and need the next proposer's explicit confirmation:\n- Clear all drains every unread alert through the existing RPCs (step 5, \"Clear all\"). The proposal's listed-only scope rested on a false constraint.\n- Every per-spec scenario also stubs StreamAlerts (step 5, e2e-f).\n\n1. **StatTile guard (FR-1, FR-3, @AC-1, @AC-8)** — `src/components/shared/StatTile.tsx:21-24`.\n   - **Root cause.** All grids are `grid-cols-N`, so tracks are `minmax(0,1fr)`. Unbreakable mono text spills out of a fixed-width tile; the grid's `overflow-hidden` (`page.tsx:842,901,1120`) only clips at the outer edge. `min-w-0` is not added.\n   - **Fix.** `wrap-anywhere` on the value div (Tailwind 4.3.3, `package.json:80`).\n   - **Mid-digit mitigation.** When `value` is a string, a helper private to `StatTile.tsx` inserts `<wbr/>` after each `,`; `wrap-anywhere` is the last resort. The helper gets a render test.\n   - **e2e.** @AC-1/@AC-8 assert at tile level, in the same step: the value's bounding box lies inside its tile's box and `scrollWidth <= clientWidth`, with the tile located through its Eyebrow label. `mobile-overflow.spec.ts:45` cannot see an in-tile overprint.\n\n2. **Fundamentals redesign (FR-2)** — `page.tsx:1099-1128`.\n   - **Header.** `CardTitle className=\"text-base\"` with the `stale` badge on the right (`:1101-1109`), matching `OpportunitySection` (`:1006-1008`).\n   - **Body.** Two labelled groups of four tiles, using the bordered tile-grid class string from `:842` with `sm:grid-cols-4`. No metric is added or dropped.\n     - Valuation: Market cap (`fmtUsdCompact`), P/E, P/B, EPS.\n     - Quality & risk: ROE, Debt/Equity, Beta, Div yield.\n   - **Group headers.** A `text-xs font-medium text-muted-foreground` line, distinct from the tile Eyebrow labels. `sm:grid-cols-4` differs from the sibling `sm:grid-cols-3` grids; the operator's full-redesign decision sanctions that.\n   - **Footer.** `as of <date> · <source>` from `Fundamentals.as_of` and `source` (`marketdata.proto:240,242`), styled like the Opportunity `metaBits` line (`page.tsx:1074-1076`), rendered only when present.\n   - **No `sub` lines.** Loading and error branches stay verbatim (`:1112-1118`, feature 220).\n   - `fmtUsdCompact` goes in `src/lib/money.ts` with a Vitest test (D-2).\n\n3. **Chip (FR-4, @AC-2)** — `opportunityChipLabel(o)` in `src/lib/opportunityShared.tsx`, swapped in at `page.tsx:444`.\n   - Returns `strategyId`; else `source` with `_`/`-` as spaces and the first letter capitalized; else \"No strategy\". Never the symbol.\n   - Vitest goes in `opportunityShared.test.ts`.\n   - The empty-strategy fixture goes in `e2e/fixtures/opportunities.ts` with an `INVENTORY.md` row, used per-spec through `page.route` only. @AC-2 assertions scope to `getByRole('radio')`.\n   - Accepted gaps: the mobile `SignalRow` chip shows the raw source (`SectionRenderer.tsx:187-188`); same-source strategy-less rows get identical chips (`page.tsx:443`).\n\n4. **Switch (FR-9, @AC-6, @AC-7)** — `src/components/ui/switch.tsx:20,27`.\n   - Rewrite every `data-checked:` / `data-unchecked:` to `data-[state=checked]:` / `data-[state=unchecked]:`, including the `dark:` compounds at `:27`, with an `// app-specific` marker. `data-disabled:` stays.\n   - **Rationale.** `src/app/layout.tsx:26` sets no `dark` class and there is no `@custom-variant dark`, so `dark:` means `prefers-color-scheme: dark`. The compounds are rewritten for consistency; the checked thumb colour stays OS-dependent, and fixing that is out-of-scope restyling.\n   - **Guard test.** `switch.test.ts` uses `React.createElement` with `renderToStaticMarkup`. It asserts `data-state=\"checked\"` and the `data-[state=checked]:` classes on root and thumb. The negative regex `/(^|[\\s:])data-(un)?checked:/` also catches the `dark:` forms. No new export (R-7).\n   - **e2e.** Geometry only: thumb and track bounding boxes.\n\n5. **Drawer and badge (FR-5..FR-8 plus a new FR-10; @AC-3, @AC-4, @AC-5, @AC-9, new @AC-10)** — `src/components/trader/AlertStream.tsx`, mounted by the trader `AppShell` (`components/trader/AppShell.tsx:24`). It remounts and refetches on every trader navigation; `/accounts/notifications` has no bell, so the design makes no cross-segment badge claim.\n   - **Pure helpers** in `src/lib/alertShared.ts`, covered by Vitest:\n     - `mergeUnread(stored, streamed, readIds)`: de-duplicates on `alertId`, drops `readIds`, sorts newest first. `createdAt.seconds` is a protobuf-es `bigint`, mapped through `Number()`. A missing timestamp sorts first, as a fixture tolerance only (real broadcasts set `createdAt`, `notifyServiceImpl.ts:116`). A Vitest case mixes missing and present timestamps.\n     - `pruneStreamed(streamed, resultIds, fetchSeq)`: keeps an entry whose id is in the applied result or whose `seq >= fetchSeq`.\n   - **State.** `stored`; `streamed` as `{alert, seq}[]`, capped at 50 and never blindly cleared; `readIds`; `seqRef`; one shared `pending` flag.\n   - **Fetches.** `listAlerts({unreadOnly:true, limit:50})` on mount, on `Sheet onOpenChange(true)` and after a successful mark-read. Each takes `seq = ++seqRef.current` and is applied only if still the latest. Applying sets `stored` and runs `pruneStreamed`. Pruning is sound in production because notify inserts the row before broadcasting (`notifyServiceImpl.ts:82-124`).\n   - **Stream.** The callback tags each alert with `seqRef.current`. `useReconnectingStream` wiring is unchanged (D-8).\n   - **Badge.** `merged.length` with `9+` kept (D-5). `hasHighSeverity` reads the merged list.\n   - **Per-row mark-read.** A ghost button with `aria-label=\"Mark read: <title>\"`. It awaits `markAlertRead({alertIds:[id]})`, adds the id to `readIds`, then refetches.\n   - **Clear all (replaces the local `setAlerts([])` at `AlertStream.tsx:83-92`).** Same header slot, visible label \"Clear all\", shown when `merged.length > 0`. No `aria-label` that drops the visible text: the accessible name is \"Clear all\", or starts with it (WCAG 2.5.3; keeps the `getByRole('button',{name:'Clear all'})` locator at `alert-stream.spec.ts:79`).\n     - **It persists.** It marks alerts read server-side through the existing `MarkAlertRead(repeated alert_ids)` (`notify.proto:116-119`), written as one set-based, idempotent INSERT (`notifyServiceImpl.ts:211-218`). Cleared alerts show as read on `/accounts/notifications` and do not return on the next fetch.\n     - **Recommended scope: drain all unread, with a cap.** A helper `drainUnread` in `src/lib/alertShared.ts`, unit-tested, loops: mark the current page's ids, then `listAlerts({unreadOnly:true, limit:50})` again, until a page yields no eligible id or a fixed iteration cap is hit. No new RPC and no contract change is needed; each batch marks the 50 newest unread, so the next page holds the next 50 (`notifyServiceImpl.ts:231-257`).\n     - **Cutoff.** Only alerts with `createdAt` at or before the newest `createdAt` listed at click time are eligible. An alert that arrives mid-drain stays unread and listed.\n     - **End states.** Success: all marked ids go into `readIds`, then the seq-guarded refetch. Cap hit or error mid-loop: `<CardNotice variant=\"error\">`, the remaining rows stay, and the refetch shows what is left.\n     - **Runner-up scope: listed-only** (the proposal). One call for the alerts listed at click (up to 50), plus a \"showing 50 of N\" line from `unreadCount` when N > 50. This repeats `docs/roadmap/ledger/fails.md:2774` unless that line is shown.\n     - **No confirm, no undo (recommended).** The inbox's \"Mark all read\" already persists with no confirm (`AlertInbox.tsx:66-74`), so a drawer-only confirm dialog would be inconsistent (C-17). No unmark-read RPC exists.\n     - **Inbox untouched.** `AlertInbox` \"Mark all read\" stays bounded to its loaded rows; changing it is out of this feature's scope unless the operator asks.\n   - **In-flight guard.** While any mark-read call is pending (per-row or Clear all), Clear all and every per-row button are `disabled`, through the one shared `pending` flag.\n   - **Errors.** A failed fetch keeps the previous list and badge and shows `<CardNotice variant=\"error\">` above the list. A mark-read or Clear all error uses the same notice and the rows stay (D-13).\n   - **Rows** stay a plain `<li>` for peer 344, which marks an alert read when its page opens; that shows here through refetch-on-open.\n   - **Gate questions for the operator** (state them, do not assume them):\n     1. Scope: drain all unread (recommended) or listed-only with \"showing 50 of N\"?\n     2. Persisting with no confirm and no undo (recommended, matches the inbox), or a confirm dialog?\n     3. Label stays \"Clear all\" (the operator's word), not \"Mark all read\"?\n   - **Spec amendments, before `/sdd-spec`:**\n     - `product-spec.md` § Out of Scope (`:58` onward): remove the \"mark all read\" exclusion.\n     - Add FR-10, worded with the scope chosen at the gate.\n     - Add @AC-10 to `acceptance.feature`. Its two stored-unread fixtures get titles of their own, not \"Order rejected\", and the scenario text matches. If drain is chosen, add a case above 50 at Vitest level on `drainUnread`.\n   - **e2e plan (each a stated step):**\n     - (a) Shared mock `listAlerts` (`e2e/mock-backend.ts:685-688`): with `unreadOnly` set it returns the stored unread rows of `ALERT_LIST_WITH_READ_STATE` plus `ALERT_STREAM_ALL` (`:677-679`) as `read:false`, with `unreadCount` equal to that length. Stateless (R-8). The `unreadOnly`-false path (`AlertInbox.tsx:28`), `MOCK_UNREAD_COUNT` and the no-op `markAlertRead` (`:691-693`) are unchanged.\n     - (a-knock-on) The default bell badge on every trader AppShell page is 5 (2 stored unread plus 3 streamed, de-duplicated), before and after opening the drawer. Under the default mock the inbox still says \"2 unread\", so FR-8 agreement is asserted only under per-spec stubs; record that in design.md so nobody writes a cross-page agreement test against the default mock.\n     - (b) Retitle `ALERT_LIST_002` to \"Buying power exceeded\" (`e2e/fixtures/alerts.ts:56-63`, D-12).\n     - (c) Timestamped fixtures with `INVENTORY.md` rows: `ALERT_UNREAD_BACKFILL_FAILED`, `ALERT_READ_BACKFILL_DONE`, `ALERT_STREAM_ORDER_REJECTED_NEWER`, plus the two distinctly titled @AC-10 stored-unread fixtures (C-12).\n     - (d) Move `connectStreamBody`, `fulfillStream` and `gate` from `e2e/trader/stream-reconnect.spec.ts:14-44` to `e2e/helpers/connectStream.ts` (D-14).\n     - (e) Rewrite `e2e/trader/alert-stream.spec.ts`: `:31-45` asserts 5; `:47-56` and `:84-99` locate the bell with `getByRole('button',{name:/^Alerts/})`; `:58-67` is kept; `:69-82` becomes the per-row mark-read test; a new @AC-10 test uses its own stubs. These are the only page-wide badge-text counters in `e2e/` (adversary grep).\n     - (f) Per-spec stubs for @AC-3, @AC-4, @AC-5, @AC-9 and @AC-10, with state held in the test closure, never module state:\n       - **ListAlerts:** the stored unread set, plus every alert the spec has already streamed, minus every id received in a `MarkAlertRead` request body. For @AC-10 the ids arrive in one request, or several under drain. The `unreadOnly`-false branch reads the same state for the Notifications-page half of @AC-4/@AC-10.\n       - **StreamAlerts:** stubbed in every one of these scenarios, using the D-14 helpers. Otherwise the default mock streams `ALERT_STREAM_ALL` on each connect and breaks the starting badge counts. @AC-3, @AC-4, @AC-10: hold every attempt unfulfilled. @AC-5, @AC-9: the first attempt waits on a gate and then delivers the one alert; later attempts are held, never `route.continue()`d.\n       - A fulfilled route cannot stay open (`stream-reconnect.spec.ts:9-10`), so delivery ends the stream and AlertStream reconnects. These scenarios therefore allow `alert-stream-disconnected` to show briefly and must not assert its absence.\n     - (g) `stream-reconnect.spec.ts:105-133` must pass unchanged in intent (PRESERVE @AC-9 @feature-270).\n\n**Build order:** 1 + 2, then 3, then 4, then 5. Step 5 lands before peer 344. A textual conflict with peer `fix-fundamentals-roe-unit` at `page.tsx:1095` is expected.",
    "open_objections": [
      {
        "text": "New (P-03, ledger repeat), blocking: the proposal limits Clear all to the alerts listed at click (up to 50) on the claim that marking all unread needs a new RPC or a paging loop the contract forbids. That claim is false. A client loop over the existing listAlerts({unreadOnly:true}) and markAlertRead(ids) needs no contract change (notifyServiceImpl.ts:211-218,231-257). Listed-only repeats fails.md:2774 (bulk mark-read bounded to the loaded 50 rows). The synthesis adopts the capped drain as the recommended scope; the proposer must either confirm it (cap, createdAt cutoff, end state on cap or error) or keep listed-only with a \"showing 50 of N\" line. The operator chooses at the gate.",
        "blocking": true
      },
      {
        "text": "O-2 (C-16), still open, narrowed: the shared-mock union and the default-badge knock-on are now stated, but the spec rewrite list is still incomplete on the stream side. Step (f) stubs only ListAlerts. Without a per-scenario StreamAlerts stub, the default mock streams ALERT_STREAM_ALL on every connect (mock-backend.ts:677-680), so the starting states \"badge shows 1\" (@AC-3/@AC-4/@AC-5), \"badge shows 2\" (@AC-10), \"no alert streamed since page load\" (@AC-3) and \"no stored unread alert\" (@AC-9) are all wrong. The proposer must state the StreamAlerts stub per scenario (hold every attempt for @AC-3/@AC-4/@AC-10; gate, deliver once, then hold for @AC-5/@AC-9; never route.continue()), and say whether a brief alert-stream-disconnected indicator after delivery is allowed.",
        "blocking": true
      },
      {
        "text": "O-12, still open (operator question): do checkbox, field and questionnaire get the same data-state fix? This design leaves them unchanged (R-4 stands). The orchestrator should check whether one of the operator's numbered gate answers was given to this question.",
        "blocking": false
      },
      {
        "text": "New (P-03): persisting with no confirm and no undo is a gate question, not an assumption. The operator's ruling fixes that both buttons exist, not these semantics. Supporting evidence for no confirm: the inbox's \"Mark all read\" already persists unconfirmed (AlertInbox.tsx:66-74), so a drawer-only confirm would be inconsistent (C-17).",
        "blocking": false
      },
      {
        "text": "New (C-17): visible \"Clear all\" with aria-label \"Mark all listed alerts read\" fails WCAG 2.5.3 (Label in Name) and breaks the getByRole('button',{name:'Clear all'}) locator (alert-stream.spec.ts:79). Drop the aria-label or start it with the visible text.",
        "blocking": false
      },
      {
        "text": "New: the in-flight guard must be symmetric. One shared pending flag disables Clear all and every per-row button while any mark-read call, per-row or Clear all, is in flight.",
        "blocking": false
      },
      {
        "text": "New (D-12 spirit, C-12): the proposed second stored-unread \"Order rejected\" fixture for @AC-10 brings back duplicate titles (fixtures/alerts.ts:23). Give the @AC-10 stored fixtures titles of their own and amend the scenario text.",
        "blocking": false
      },
      {
        "text": "New (P-03/C-15): spec amendments must land before /sdd-spec: remove the \"mark all read\" exclusion from product-spec.md Out of Scope, add FR-10 worded with the chosen scope (drain or listed-only), and add @AC-10. Otherwise @AC-10 passes with two alerts while behaviour above 50 is unspecified.",
        "blocking": false
      },
      {
        "text": "New: under the stateless shared mock the bell shows 5 unread while the inbox says \"2 unread\" (MOCK_UNREAD_COUNT, notifications.spec.ts:114). Record in design.md that FR-8 agreement is asserted only under per-spec stubs.",
        "blocking": false
      }
    ],
    "floor_breaches": [],
    "business_rule_changes": [
      {
        "ac_id": "@AC-1",
        "kind": "CHANGE",
        "covered_by_operator_decision": true
      },
      {
        "ac_id": "@AC-2",
        "kind": "CHANGE",
        "covered_by_operator_decision": true
      },
      {
        "ac_id": "@AC-3",
        "kind": "CHANGE",
        "covered_by_operator_decision": true
      },
      {
        "ac_id": "@AC-4",
        "kind": "EXTEND",
        "covered_by_operator_decision": true
      },
      {
        "ac_id": "@AC-5",
        "kind": "CHANGE",
        "covered_by_operator_decision": true
      },
      {
        "ac_id": "@AC-6",
        "kind": "CHANGE",
        "covered_by_operator_decision": true
      },
      {
        "ac_id": "@AC-7",
        "kind": "PRESERVE",
        "covered_by_operator_decision": true
      },
      {
        "ac_id": "@AC-8",
        "kind": "EXTEND",
        "covered_by_operator_decision": true
      },
      {
        "ac_id": "@AC-9",
        "kind": "CHANGE",
        "covered_by_operator_decision": true
      },
      {
        "ac_id": "@AC-10 (new: Clear all marks alerts read, persists, empties drawer and badge)",
        "kind": "EXTEND",
        "covered_by_operator_decision": true
      },
      {
        "ac_id": "@AC-9 @feature-270 (fix-ui-trader-feedback.feature: dropped alert stream is shown and reconnects)",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "@AC-5 @feature-271 (fix-ui-transport-hardening.feature: alert stream not cut off by unary deadline)",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      }
    ],
    "rejected_alternatives": [
      "Fix each stat grid separately — lost to a single StatTile fix, because all three symbol-page grids render it.",
      "Truncate or ellipsize long values — lost because FR-1 needs the whole value drawn inside its tile (R-1).",
      "Compact formatting for every large-USD tile — lost as out of scope beyond the FR-3 overflow guard (R-2).",
      "Change fmtUsd itself to compact — lost because the Book screens share it; fmtUsdCompact is separate.",
      "Break hints returned from money.ts instead of <wbr/> inside StatTile — lost because every call site would carry the break logic (R-9).",
      "Full market cap as a StatTile sub line — lost because it brings the overflow back (R-10).",
      "Switch option (a), @theme/@utility blocks — lost on a possible collision with the feature-307 theme check (R-3).",
      "Switch option (b), global @custom-variant — lost because it changes checkbox, field and questionnaire rendering without an operator ruling (R-4).",
      "Export a class constant from switch.tsx for the guard test — lost because it changes the shadcn file shape (R-7).",
      "Badge = server unreadCount plus a streamed delta — lost because FR-8 would not hold by construction (R-5).",
      "Window CustomEvent for cross-page alert sync — lost as YAGNI (R-6).",
      "Remove Clear all outright and keep only per-row mark-read (old D-7) — lost because the operator requires both actions.",
      "Clear all that only hides rows locally, beside per-row mark-read — lost because hidden rows stay unread on the server, so refetch-on-open (D-6) brings them back and the badge, drawer and inbox disagree (FR-8).",
      "A new notify RPC to mark all unread — lost because the notify contract is out of scope and a client loop over the existing ListAlerts and MarkAlertRead does the same.",
      "Clear all limited to the alerts listed at click, with no \"N of M\" explanation — lost because it repeats fails.md:2774; listed-only with a \"showing 50 of N\" line stays as the runner-up for the operator.",
      "A confirm dialog before Clear all — runner-up, not locked: it is inconsistent with the inbox's unconfirmed \"Mark all read\" (C-17) and adds a dialog and its tests; the operator decides at the gate.",
      "Rename the drawer button to \"Mark all read\" to match the inbox — lost because the operator asked for a clear-all button; it changes only if the operator says so.",
      "Extract a shared mark-read hook for the drawer and the inbox — lost as overbuilt for two call sites; the inbox is left alone.",
      "A source-to-label map for chip labels — lost as YAGNI; one humanizer function is enough.",
      "Scope every drawer assertion by row id instead of retitling the stored fixture — lost because one fixture edit fixes the collisions (D-12).",
      "A stateful shared mock that records which alerts it has streamed — lost because module-level mock state leaks across parallel specs (R-8).",
      "No pruning: drop streamed alerts only through local readIds — lost on FR-8 strictness; not locked, it is the fallback if the mock coupling proves fragile."
    ],
    "open_risks": [
      "Clear all is an irreversible bulk write behind one tap; no unmark-read RPC exists. The operator has not yet confirmed persistence, no confirm, or the scope.",
      "The drain loop makes several round-trips and can stop partway on a cap or an error, leaving some alerts read and some unread. The createdAt cutoff relies on server timestamps being comparable across pages.",
      "If the operator picks listed-only, a user with more than 50 unread sees the drawer refill after Clear all.",
      "The inbox's \"Mark all read\" stays bounded to its loaded rows (fails.md:2774), so the two surfaces differ if the drawer drains.",
      "After a gated delivery the stub stream ends and AlertStream reconnects into a held request. Whether the disconnected indicator shows, and for how long, has not been run.",
      "Pruning can wrongly drop an unread alert if notify ever runs with read replicas or replication lag; insert-before-broadcast holds within one instance only.",
      "The default e2e badge becomes 5 on every trader AppShell page. The adversary's grep found page-wide badge counters only in alert-stream.spec.ts, but a full Playwright run in the execute sandbox is impractical.",
      "renderToStaticMarkup of the Radix Switch in the Vitest node environment is assumed to emit data-state; it has not been run.",
      "FR-8 holds only up to 50 unread alerts in the drawer list (D-5).",
      "The checked switch thumb colour depends on the OS colour scheme; Playwright sees only the light variant.",
      "The six other StatTile consumers were not run; a wrapped value or a <wbr/> break may change tile height there.",
      "The wording \"No strategy\", \"Valuation\", \"Quality & risk\" and \"Clear all\" is not operator-confirmed.",
      "Peer fix-fundamentals-roe-unit edits the ROE row (page.tsx:1095); a textual merge conflict is expected.",
      "Peer 344 (alert-detail-page) builds on the drawer rows; feature 339 must land first and keep rows as a plain <li>.",
      "Whether a durable @AC in services/xstockstrat-ui/acceptance (the adversary cites @AC-6 @feature-203) encodes the old badge or Clear-all behaviour is unchecked; if so it needs C-16 handling.",
      "The exact product-spec.md Out of Scope wording for the mark-all-read exclusion was not located by grep; the orchestrator must find the line before amending."
    ],
    "constitution_rules_touched": [
      "P-02",
      "P-03",
      "C-10",
      "C-12",
      "C-13",
      "C-15",
      "C-16",
      "C-17",
      "C-18"
    ],
    "rationale": "The adversary's verdict is NEEDS WORK with no Floor breach, and I agree. Two blocking points remain, so the design is not ready for approval this round.\n\n**Register.** D-7 is reopened: the operator asked for both a per-row and a clear-all button, which D-7 (Clear all removed) contradicts. The proposal honours D-1..D-6 and D-8..D-14 and reintroduces no locked R-n.\n\n**What I verified in the code.**\n- `MarkAlertRead` takes an id array and writes one idempotent INSERT (`notifyServiceImpl.ts:201-223`).\n- `ListAlerts` with `unread_only` returns the newest unread up to the limit, with a full `unreadCount` (`:225-260`). So a client drain loop needs no contract change, and the proposal's \"needs a new RPC\" claim is false.\n- `fails.md:2774` does record \"Mark all read is bounded to the loaded 50 rows\".\n- The inbox's \"Mark all read\" persists with no confirm (`AlertInbox.tsx:42-74`).\n\n**Blocking.**\n- **Clear-all scope.** I corrected the approach to the capped drain as the recommended scope, with listed-only plus \"showing 50 of N\" as the runner-up. The proposer did not propose the drain, so this stays open until confirmed; the operator makes the final choice.\n- **O-2.** The shared-mock union and badge knock-on are now stated, but the per-scenario StreamAlerts stubs are not, and without them the scenario starting states are wrong. I folded the adversary's stub rule into step (f) for the proposer to confirm.\n\n**Closed this round.** O-3 (race mechanics plus the ListAlerts stub rule are stated), O-7, O-13, O-14, O-15 and O-16, all of which the adversary accepts as answered.\n\n**Decision for the orchestrator.** I added a `createdAt` cutoff to the drain so an alert arriving mid-loop is not marked read unseen. Neither side raised it; the proposer should confirm or replace it.\n\nO-12 remains an operator question. I could not tell whether one of the numbered answers in the relayed request (\"update all pages\") was given to it, so I left it open.",
    "register_delta": {
      "new_decisions": [
        {
          "text": "Supersedes D-7: the drawer keeps per-row mark-read and has a Clear all that marks alerts read server-side through the existing MarkAlertRead RPC, with no new RPC or contract change; its scope (drain or listed-only) and confirm behaviour are settled by the operator at the gate.",
          "evidence": "Operator decision (design gate, 2026-11-15): both per-row and clear-all; notify.proto:116-119; notifyServiceImpl.ts:211-218; AlertStream.tsx:83-92; adversary concurs that persisting is the right reading"
        },
        {
          "text": "With unreadOnly set, the shared e2e mock returns the stored unread rows plus ALERT_STREAM_ALL as unread, statelessly; the default bell badge is 5 before and after opening the drawer, and FR-8 agreement is asserted only under per-spec stubs.",
          "evidence": "e2e/mock-backend.ts:677-693; alert-stream.spec.ts:31-45,84-99; stream-reconnect.spec.ts:105-133; notifications.spec.ts:114; operator steer; adversary accepts"
        },
        {
          "text": "Each per-spec stateful ListAlerts stub returns the stored unread set plus every already-streamed alert, minus the ids received in MarkAlertRead bodies, with state held in the test closure.",
          "evidence": "notifyServiceImpl.ts:82-124 (insert before broadcast); e2e/accounts/notifications.spec.ts:93,117-120; operator steer; adversary: closure state does not violate fails.md:1304"
        },
        {
          "text": "The mergeUnread comparator maps createdAt.seconds through Number(); a missing timestamp sorts first as a fixture tolerance only, with a Vitest case mixing missing and present timestamps.",
          "evidence": "notifyServiceImpl.ts:116; protobuf-es bigint Timestamp; adversary accepts O-7 as addressed"
        },
        {
          "text": "Fundamentals group headers use a text-xs font-medium text-muted-foreground line, and sm:grid-cols-4 is recorded as sanctioned by the operator's full-redesign decision.",
          "evidence": "page.tsx:842,1099-1128; operator decision (full redesign); adversary accepts O-13 as addressed"
        }
      ],
      "new_rejected": [
        {
          "text": "A Clear all that only hides rows locally, beside per-row mark-read",
          "why": "Hidden rows stay unread on the server, so refetch-on-open (D-6) brings them back and the badge, drawer and inbox disagree (FR-8)"
        },
        {
          "text": "A new notify RPC to mark all unread alerts read",
          "why": "The notify contract is out of scope, and a client loop over the existing ListAlerts and MarkAlertRead achieves the same"
        }
      ],
      "new_objections": [
        {
          "text": "Clear-all scope: the listed-only limit rests on a false claim that draining needs a contract change, and repeats fails.md:2774; confirm the capped drain (cap, createdAt cutoff, end state) or keep listed-only with a \"showing 50 of N\" line, and put the choice to the operator (P-03).",
          "blocking": true
        },
        {
          "text": "Persisting Clear all with no confirm and no undo is a gate question for the operator, not an assumption (P-03).",
          "blocking": false
        },
        {
          "text": "The Clear all accessible name must contain the visible text (WCAG 2.5.3, C-17); drop the aria-label or start it with \"Clear all\".",
          "blocking": false
        },
        {
          "text": "The in-flight guard must be one shared pending flag covering per-row and Clear all calls alike.",
          "blocking": false
        },
        {
          "text": "The @AC-10 stored-unread fixtures need titles of their own, not a second \"Order rejected\" (D-12 spirit, C-12).",
          "blocking": false
        },
        {
          "text": "Amend product-spec.md Out of Scope, add FR-10 worded with the chosen scope, and add @AC-10, all before /sdd-spec (P-03/C-15).",
          "blocking": false
        },
        {
          "text": "Record in design.md that under the default mock the bell (5) and the inbox (2 unread) disagree, so FR-8 agreement is asserted only under per-spec stubs.",
          "blocking": false
        }
      ],
      "closed_objections": [
        {
          "id": "O-3",
          "how": "Latest-wins sequence, prune instead of clear, readIds and Vitest stand from round 2; the ListAlerts stub rule (every later response includes already-streamed alerts minus marked-read ids) is now a stated step. The StreamAlerts stub gap is tracked under O-2."
        },
        {
          "id": "O-7",
          "how": "The comparator maps createdAt.seconds through Number(), the missing-timestamp rule is worded as a fixture tolerance, and a mixed-timestamp Vitest case is added."
        },
        {
          "id": "O-13",
          "how": "Group headers use a text-xs font-medium muted line distinct from tile Eyebrows; sm:grid-cols-4 is recorded as sanctioned by the operator's full-redesign decision."
        },
        {
          "id": "O-14",
          "how": "The <wbr/> helper stays private to StatTile.tsx and gets a render test."
        },
        {
          "id": "O-15",
          "how": "AlertStream is described as mounted by the trader AppShell (AppShell.tsx:24), remounting per trader navigation, with no cross-segment badge claim."
        },
        {
          "id": "O-16",
          "how": "Switch rationale corrected: dark: is prefers-color-scheme (layout.tsx:26) and the thumb colour stays OS-dependent."
        }
      ],
      "reopen_petitions": [
        {
          "target": "D-7",
          "evidence": "Proposer: the operator ruled at the design gate (2026-11-15), after D-7 was settled in round 1, that the drawer offers both a per-row mark-read and a clear-all action and that removing Clear all outright is not accepted. MarkAlertReadRequest.alert_ids is repeated (notify.proto:118), so a persisting clear-all needs no contract change. The adversary assessed the evidence as new.",
          "is_new": true
        }
      ],
      "reopened": [
        "D-7"
      ]
    }
  },
  "floor_breaches": []
}
```

## Session 2026-11-15 — sdd-batch design gate (round 4)

`/sdd-design fix-symbol-page-alerts-ui` full debate is at its approval gate after round 4 (gate policy: halt). `design.md` is not written and `status.md` is unchanged. The register is `debate.md` (D-1..D-25, R-1..R-15, O-1..O-25, P-1).

### Open Threads

- **Approach (round-4 best).** Five surgical changes in `services/xstockstrat-ui` only; no proto, migration or config change. Steps 1-4 are unchanged from round 3 (StatTile wrap guard, Fundamentals two-group redesign, `opportunityChipLabel`, switch `data-[state=…]` rewrite). Step 5 keeps the round-3 drawer mechanics and now fixes the Clear all scope, the `StreamAlerts` stubs and the feature-344 coordination.
- **Clear all (D-20, D-21).** `drainUnread({ list, mark, cutoff, maxBatches })` in `src/lib/alertShared.ts` loops `listAlerts({unreadOnly:true, limit:50})` and `markAlertRead(ids)` through injected wrappers. The cap is 20 batches (1000 alerts per click), an unexported constant, not a config key (R-14). Only alerts created at or before the newest listed alert at click are eligible, ties included. The result is `done`, `capped` or `error`:
  - `done` only when a page is shorter than the limit; a full page with no eligible id is `capped`.
  - `capped` shows a `muted` `CardNotice` ("Some alerts are still unread — Clear all again"); `error` shows the D-13 error notice. Every outcome adds the marked ids to `readIds` and refetches through the single `refreshUnread()`.
  - No confirm and no undo. The button's accessible name is its visible text "Clear all". One shared `pending` flag disables Clear all and every per-row button while any mark call is in flight.
- **e2e stream stubs (D-22).** Every per-spec alert scenario stubs `StreamAlerts` with the D-14 helpers and never calls `route.continue()` (R-15). @AC-3/@AC-4/@AC-10 hold every attempt; @AC-5/@AC-9 gate, deliver once, then hold. The disconnected indicator may show briefly after delivery and its absence is never asserted.
- **Feature 344 (D-24).** The unread fetch does not move onto react-query in 339 (R-13). 339 leaves pure helpers and the `refreshUnread()` seam, and records the constraint for 344: the `ALERT_UNREAD_COUNT_KEY` value is derived from the merged, de-duplicated unread list and is invalidated by mark-read and Clear all.
- **Strongest open objection (O-24, non-blocking, P-03).** The Clear all scope (capped drain, no confirm, no undo) rests on a relayed reading of the operator's item 8. The drain marks read alerts beyond the 50 the user saw, and there is no unmark-read RPC, so it must be confirmed once at the gate. The fallback is listed-only with a "showing 50 of N" line; it is not locked as rejected.
  - **Operator text, verbatim:** "8. Choose the one with less friction".
  - **Question it is read as answering:** round-3 gate questions 1 and 2 (Clear-all scope: capped drain or listed-only; and no confirm/no undo or a confirm dialog).
  - **Reading:** capped drain, no confirm, no undo.
  - **Limit of the evidence:** the operator's numbered list covers the whole batch and does not itself say which question item 8 answers. The mapping is the orchestrator's, not the operator's.
- **Also open, non-blocking.**
  - O-25: the proposer has not yet confirmed the adversary's four drain corrections that the synthesis folded in (short-page termination with the 50-newer Vitest case, `variant="muted"` for `capped`, one `compareCreatedAt`, an unexported cap with the notify pool-load note in `design.md`).
  - O-12: do checkbox, field and questionnaire get the same `data-state` fix? No numbered operator answer maps to it with confidence; the design leaves them unchanged (R-4).
- **Closed this round.** O-2, O-17, O-18, O-19, O-20, O-21, O-22, O-23. No blocking objection remains.
- **Floor status.** No Floor breach; the adversary's verdict is SOUND.
- **Uncovered @AC changes.** None is a CHANGE. Three PRESERVE rules are not covered by an operator decision and must stay green: @AC-9 @feature-270 (dropped alert stream is shown and reconnects), @AC-5 @feature-271 (alert stream not cut off by the unary deadline) and @AC-6 @feature-203 (notifications inbox mark-read). @AC-1..@AC-9 and the new @AC-10 are covered by the recorded operator decisions; @AC-10's coverage depends on the item-8 reading above.
- **Gate questions for the operator.**
  1. Confirm that item 8 ("Choose the one with less friction") chose the capped drain with no confirm and no undo, up to 1000 alerts per click (O-24).
  2. O-12: do checkbox, field and questionnaire get the `data-state` fix?
  3. Reopen petition P-1 (D-7) still reads "pending user" in `debate.md`. The synthesis says it should read "user reopened"; this round's register delta carried no row for it, so it was not changed.
- **Spec amendments owed before `/sdd-spec` (D-25).** Remove the "mark all read" exclusion from `product-spec.md` § Out of Scope (the exact line is still to be located), add FR-10 with the capped-drain wording, and add @AC-10 to `acceptance.feature` with the fixtures "Backfill 9f8e7d6c failed" and "Daily loss limit reached".
- **For `design.md`.** A worst-case drain is about 60 sequential queries on notify's single direct DB connection, so the cap must not be raised without revisiting it. Under the default mock the bell shows 5 and the inbox 2 unread, so FR-8 agreement is asserted only under per-spec stubs.

```sdd-batch-design-state
{
  "round": 4,
  "synth": {
    "approach": "Round-4 best approach: five surgical changes in `services/xstockstrat-ui` only, with no proto, migration or config change. Steps 1-4 are unchanged from round 3 (D-1..D-4, D-9..D-11, D-19). Step 5 keeps the round-3 mechanics (D-5, D-6, D-8, D-12..D-18) and now fixes the Clear all scope, the StreamAlerts stubs and the 344 coordination. Four adversary corrections are folded into the drain; the proposer has not yet confirmed them, and all are non-blocking.\n\n1. **StatTile guard (FR-1, FR-3, @AC-1, @AC-8)** — `src/components/shared/StatTile.tsx:21-24`.\n   - `wrap-anywhere` on the value div. A helper private to `StatTile.tsx` inserts `<wbr/>` after each `,` in string values and gets a render test. `min-w-0` is not added.\n   - e2e asserts at tile level: the value's bounding box lies inside its tile and `scrollWidth <= clientWidth`.\n\n2. **Fundamentals redesign (FR-2)** — `page.tsx:1099-1128`.\n   - Header with the `stale` badge. Two labelled four-tile groups on `sm:grid-cols-4`: Valuation (Market cap via `fmtUsdCompact`, P/E, P/B, EPS) and Quality & risk (ROE, Debt/Equity, Beta, Div yield).\n   - Group headers are a `text-xs font-medium text-muted-foreground` line. Footer is `as of <date> · <source>`, rendered only when present. No `sub` lines.\n   - Loading and error branches stay verbatim (`:1112-1118`). `fmtUsdCompact` goes in `src/lib/money.ts` with a Vitest test.\n\n3. **Chip (FR-4, @AC-2)** — `opportunityChipLabel(o)` in `src/lib/opportunityShared.tsx`, swapped in at `page.tsx:444`.\n   - Returns `strategyId`; else the humanized `source`; else \"No strategy\". Never the symbol.\n   - Vitest case; the empty-strategy fixture is used per-spec through `page.route`; assertions scope to `getByRole('radio')`.\n\n4. **Switch (FR-9, @AC-6, @AC-7)** — `src/components/ui/switch.tsx:20,27`.\n   - Rewrite every `data-checked:` / `data-unchecked:` to `data-[state=checked]:` / `data-[state=unchecked]:`, including the `dark:` compounds, with an `// app-specific` marker.\n   - Guard test uses `renderToStaticMarkup` with no new export. e2e is geometry-only.\n   - Checkbox, field and questionnaire are unchanged (R-4; O-12 is still an operator question).\n\n5. **Drawer and badge (FR-5..FR-8, new FR-10; @AC-3, @AC-4, @AC-5, @AC-9, new @AC-10)** — `src/components/trader/AlertStream.tsx`, mounted by the trader `AppShell` (`components/trader/AppShell.tsx:24`).\n   - **Unchanged from round 3.**\n     - Stored unread comes from `listAlerts({unreadOnly:true, limit:50})` on mount, on open and after a mark.\n     - `mergeUnread` and `pruneStreamed` live in `src/lib/alertShared.ts`; fetches are seq-guarded latest-wins.\n     - Badge is `merged.length` with `9+`.\n     - Per-row ghost button has `aria-label=\"Mark read: <title>\"`.\n     - Errors follow D-13; `useReconnectingStream` wiring is untouched.\n   - **Single refresh entry point.** `AlertStream` has one `refreshUnread()` function that every fetch trigger calls.\n   - **Clear all drains every unread alert, capped.** It replaces the local `setAlerts([])` at `AlertStream.tsx:83-92`. The pure helper `drainUnread({ list, mark, cutoff, maxBatches })` goes in `src/lib/alertShared.ts`; `list` and `mark` are injected wrappers over `notifyClient.listAlerts` / `markAlertRead`, so Vitest needs no network.\n     - **Loop.** Each pass calls `list({unreadOnly:true, limit:50})`, takes the ids with `createdAt <= cutoff` not already in `markedIds`, and marks them with `mark({alertIds})` if there are any.\n       - This works because the server orders unread rows `created_at DESC LIMIT $2` (`services/xstockstrat-notify/src/grpc/notifyServiceImpl.ts:236-242`) and the mark is one idempotent set INSERT (`:211-218`).\n     - **Stop rule (adversary correction).**\n       - `done` only when the page holds fewer rows than `limit`, after marking its eligible ids.\n       - `capped` when a full page yields no eligible id. That covers 50 or more newer-than-cutoff alerts sitting on top, and phantom ids the JOIN at `:215` drops.\n       - `capped` also when `maxBatches` is reached. `markedIds` stays as the no-spin backstop.\n       - In the common one-page case this needs no second `list` call.\n     - **Cap.** `maxBatches = 20`, so up to 1000 alerts per click. It is an unexported module constant, tested through the `maxBatches` parameter; it is not a config key.\n     - **Cutoff.** The newest `createdAt` in the merged list at click time, ties eligible. An alert that arrives mid-drain is newer and stays unread and listed. The button is hidden when the merged list is empty, so there is no cutoff-less drain.\n     - **One comparator (adversary correction).** A private `compareCreatedAt` in `alertShared.ts` is used by both `mergeUnread` (D-18) and `drainUnread`.\n     - **Result.** `{ markedIds, outcome: 'done' | 'capped' | 'error', error? }`.\n     - **End states.** Every outcome adds `markedIds` to `readIds`, clears the shared `pending` flag and runs `refreshUnread()`.\n       - `done`: \"No alerts\" and no badge.\n       - `capped`: `<CardNotice variant=\"muted\">` \"Some alerts are still unread — Clear all again\", and the refetch lists what is left. `muted`, not `error`, because the error variant sets `role=\"alert\"` (`src/components/shared/CardNotice.tsx:10-16`) and a partial success is not a failure (adversary correction).\n       - `error`: the D-13 `<CardNotice variant=\"error\">`, and the remaining rows stay. A partial result is accepted and visible.\n     - **No confirm, no undo.** This follows the relayed reading of the operator's \"less friction\" and matches the unconfirmed inbox \"Mark all read\" (`src/app/accounts/notifications/AlertInbox.tsx:66-74`). No unmark-read RPC exists.\n     - **Button.** Visible text \"Clear all\" with no `aria-label`, shown when `merged.length > 0`. One shared `pending` flag disables Clear all and every per-row button while any mark call, per-row or drain, is in flight.\n     - **Load note for design.md.** A worst-case drain is about 60 sequential queries on notify's single direct DB connection: two per `listAlerts`, one of them an uncapped `COUNT(*)` (`notifyServiceImpl.ts:234-253`), and one per mark. That is acceptable at this cap; the cap must not be raised without revisiting it.\n     - **Inbox untouched.** `AlertInbox` \"Mark all read\" stays bounded to its loaded rows.\n   - **e2e plan.** Steps (a)-(e) and (g) are as in round 3:\n     - (a) the stateless shared-mock union with default badge 5 (D-16);\n     - (b) retitle `ALERT_LIST_002` (D-12);\n     - (c) timestamped fixtures with `INVENTORY.md` rows;\n     - (d) move the stream helpers to `e2e/helpers/connectStream.ts` (D-14);\n     - (e) rewrite `e2e/trader/alert-stream.spec.ts`;\n     - (g) `stream-reconnect.spec.ts:105-133` is unchanged in intent.\n   - **e2e step (f), now complete.** Every per-spec scenario registers both stubs, with state in the test closure.\n     - **ListAlerts (D-17):** the stored unread set plus every already-streamed alert, minus ids received in `MarkAlertRead` bodies.\n     - **StreamAlerts:** a `**/NotifyService/StreamAlerts` route built on the D-14 helpers. No branch ever calls `route.continue()`, because the default mock streams `ALERT_STREAM_ALL` on each connect (`e2e/mock-backend.ts:677-679`).\n       - @AC-3, @AC-4, @AC-10: every attempt is held on a never-released promise, so the starting badge equals the stored count.\n       - @AC-5, @AC-9: attempt 1 awaits a test gate, then `fulfillStream(route, [alert])`; attempts 2 and later are held. In @AC-9 the ListAlerts stub adds the streamed alert only after release.\n     - **Disconnected indicator.** It is allowed briefly after delivery. A fulfilled body ends cleanly, so `useReconnectingStream` sets `disconnected` (`src/hooks/useReconnectingStream.ts:61-63`) and clears it once the held reconnect has been open for `STREAM_STABLE_MS` (`:41-44`).\n       - These scenarios never assert its absence.\n       - They locate the bell with `getByRole('button',{name:/^Alerts/})` and use `expect.poll` or auto-wait.\n       - Any poll that waits for the indicator to clear needs a timeout above 3 s plus the backoff.\n   - **@AC-10 fixtures.** Two stored unread alerts titled \"Backfill 9f8e7d6c failed\" and \"Daily loss limit reached\", with `INVENTORY.md` rows. Flow: stream held, Clear all, \"No alerts\", no badge, both read on the Notifications page.\n   - **Vitest on `drainUnread`.** Above 50, cap, error, cutoff, phantom ids, and 50 newer-than-cutoff rows on top of eligible rows giving `capped`.\n   - **Feature 344 coordination: recorded, not built.**\n     - The unread fetch does not move onto a shared react-query key in 339. That would replace the closed O-3 mechanics and fix the key's value shape before 344 defines it.\n     - What costs nothing is in place: pure helpers in `alertShared.ts` and the single `refreshUnread()`, which 344 can swap for a `useQuery` / `invalidateQueries` pair.\n     - Constraint recorded for 344: the value under `ALERT_UNREAD_COUNT_KEY` is derived from the merged, de-duplicated unread list (D-5), never the server `unreadCount` plus a streamed delta (R-5). Mark-read and Clear all must invalidate it.\n   - **Spec amendments before `/sdd-spec`.**\n     - Remove the \"mark all read\" exclusion from `product-spec.md` Out of Scope.\n     - Add FR-10: \"Clear all marks every unread alert created at or before the newest listed alert as read (persisted), up to 1000 per click; on cap or error the drawer shows a notice and lists what remains.\"\n     - Add @AC-10 to `acceptance.feature`.\n   - **design.md records.**\n     - Under the default mock the bell shows 5 while the inbox shows 2 unread, so FR-8 agreement is asserted only under per-spec stubs.\n     - Which gate question the operator's item 8 answered, with the relayed text verbatim.\n\n**Build order:** 1 + 2, then 3, then 4, then 5. Step 5 lands before peer 344. A textual conflict with peer `fix-fundamentals-roe-unit` at `page.tsx:1095` is expected.",
    "open_objections": [
      {
        "text": "O-12, still open (operator question): do checkbox, field and questionnaire get the same data-state fix? No numbered operator answer can be mapped to it with confidence, so the design leaves them unchanged and R-4 stands. Ask at the gate.",
        "blocking": false
      },
      {
        "text": "New (P-03): the Clear all scope (capped drain, no confirm, no undo) rests on a relayed reading of the operator's item 8, \"Choose the one with less friction\". The numbered list does not itself show which question item 8 answered, and the drain marks read alerts beyond the 50 the user saw, irreversibly. Record the question, the verbatim text and the reading in context.md, and confirm once at the gate. The fallback is listed-only with a \"showing 50 of N\" line.",
        "blocking": false
      },
      {
        "text": "New (P-03/C-17): the proposal's stop rule can report `done` while eligible alerts are still unread, when 50 or more newer-than-cutoff alerts fill the page (notifyServiceImpl.ts:236-242). The synthesis adopts short-page termination (`done` only on a page shorter than the limit; a full page with no eligible id is `capped`) plus a Vitest case. The proposer has not confirmed it.",
        "blocking": false
      },
      {
        "text": "New (C-17): the `capped` notice must not use CardNotice variant=\"error\" (role=\"alert\", text-destructive; CardNotice.tsx:10-16). The synthesis uses variant=\"muted\" for `capped` and keeps `error` for the error outcome. The proposer has not confirmed it.",
        "blocking": false
      },
      {
        "text": "New (C-18 DRY): two timestamp comparators in alertShared.ts (Number(seconds) in mergeUnread, bigint (seconds, nanos) in the drain cutoff) can drift. The synthesis uses one private compareCreatedAt for both and keeps the batch cap unexported. The proposer has not confirmed it.",
        "blocking": false
      },
      {
        "text": "New (C-18/performance): a worst-case drain is about 60 sequential queries on notify's 1-connection direct pool, including an uncapped COUNT(*) per list call (notifyServiceImpl.ts:234-253). Record this in design.md, and do not raise the cap without revisiting it.",
        "blocking": false
      }
    ],
    "floor_breaches": [],
    "business_rule_changes": [
      {
        "ac_id": "@AC-1",
        "kind": "CHANGE",
        "covered_by_operator_decision": true
      },
      {
        "ac_id": "@AC-2",
        "kind": "CHANGE",
        "covered_by_operator_decision": true
      },
      {
        "ac_id": "@AC-3",
        "kind": "CHANGE",
        "covered_by_operator_decision": true
      },
      {
        "ac_id": "@AC-4",
        "kind": "EXTEND",
        "covered_by_operator_decision": true
      },
      {
        "ac_id": "@AC-5",
        "kind": "CHANGE",
        "covered_by_operator_decision": true
      },
      {
        "ac_id": "@AC-6",
        "kind": "CHANGE",
        "covered_by_operator_decision": true
      },
      {
        "ac_id": "@AC-7",
        "kind": "PRESERVE",
        "covered_by_operator_decision": true
      },
      {
        "ac_id": "@AC-8",
        "kind": "EXTEND",
        "covered_by_operator_decision": true
      },
      {
        "ac_id": "@AC-9",
        "kind": "CHANGE",
        "covered_by_operator_decision": true
      },
      {
        "ac_id": "@AC-10 (new: Clear all marks every unread alert read, persists, empties drawer and badge)",
        "kind": "EXTEND",
        "covered_by_operator_decision": true
      },
      {
        "ac_id": "@AC-9 @feature-270 (fix-ui-trader-feedback.feature: dropped alert stream is shown and reconnects)",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "@AC-5 @feature-271 (fix-ui-transport-hardening.feature: alert stream not cut off by unary deadline)",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "@AC-6 @feature-203 (notifications inbox mark-read)",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      }
    ],
    "rejected_alternatives": [
      "Fix each stat grid separately — lost to a single StatTile fix (D-1).",
      "Truncate or ellipsize long values — lost because FR-1 needs the whole value inside its tile (R-1).",
      "Compact formatting for every large-USD tile — lost as out of scope (R-2).",
      "Break hints returned from money.ts — lost because every call site would carry the break logic (R-9).",
      "Full market cap as a StatTile sub line — lost because it brings the overflow back (R-10).",
      "Switch option (a), @theme/@utility blocks — lost on a possible collision with the feature-307 theme check (R-3).",
      "Switch option (b), global @custom-variant — lost because it changes checkbox, field and questionnaire without an operator ruling (R-4).",
      "Export a class constant from switch.tsx — lost because it changes the shadcn file shape (R-7).",
      "Badge = server unreadCount plus a streamed delta — lost because FR-8 would not hold by construction (R-5).",
      "Window CustomEvent for cross-page alert sync — lost as YAGNI (R-6).",
      "Remove Clear all outright (old D-7) — lost because the operator requires both actions.",
      "Clear all that only hides rows locally — lost because the rows return on refetch and the surfaces disagree (R-11).",
      "A new notify RPC to mark all unread — lost because the contract is out of scope and a client loop does the same (R-12).",
      "Listed-only Clear all with a \"showing 50 of N\" line — lost on friction above 50 unread, the operator's stated criterion. Not locked: it is the fallback if the item-8 reading is not confirmed at the gate.",
      "A confirm dialog or undo for Clear all — lost to the operator's \"less friction\" and the unconfirmed inbox \"Mark all read\"; no unmark-read RPC exists.",
      "Move the unread fetch onto a shared react-query key (ALERT_UNREAD_COUNT_KEY) in feature 339 — lost because it would replace the closed O-3 seq-guard and prune mechanics and fix the key's value shape before 344 defines it; 339 leaves a single refreshUnread() seam instead.",
      "Drain cap as a config key — lost because the operator did not ask for a knob (C-18); it is an unexported code constant.",
      "A no-progress id set as the drain's main stop rule — lost to short-page termination, which gives an honest done/capped result and one fewer round trip; markedIds stays as a backstop.",
      "CardNotice variant=\"error\" for the capped outcome — lost because role=\"alert\" announces a partial success as a failure.",
      "A stateful shared mock — lost because module-level mock state leaks across parallel specs (R-8).",
      "route.continue() in any per-spec StreamAlerts stub — lost because the default mock streams ALERT_STREAM_ALL on each connect and breaks the starting badge counts.",
      "Extract a shared mark-read hook for the drawer and the inbox — lost as overbuilt for two call sites."
    ],
    "open_risks": [
      "Clear all bulk-writes up to 1000 read marks with one tap and no undo, including alerts beyond the 50 shown. If the operator's \"less friction\" was meant only for the listed rows, the design over-reaches irreversibly; confirm at the gate.",
      "A drain can stop partway on a cap or an error, leaving some alerts read and some unread. This is accepted and shown through a notice.",
      "A worst-case drain queues about 60 queries on notify's single DB connection, alongside EmitAlert inserts for all users.",
      "With 50 or more alerts arriving after the click, the drain returns `capped` and the user must click again.",
      "The inbox \"Mark all read\" stays bounded to its loaded rows (fails.md:2774), so the drawer and inbox differ on purpose.",
      "The brief disconnected indicator after a fulfilled stub stream has not been run. Polls in @AC-5/@AC-9 need timeouts above STREAM_STABLE_MS (3 s) plus the backoff.",
      "Pruning can wrongly drop an unread alert if notify ever runs with read replicas or replication lag.",
      "The default e2e badge becomes 5 on every trader AppShell page. A full Playwright run in the execute sandbox is impractical.",
      "renderToStaticMarkup of the Radix Switch in the Vitest node environment is assumed to emit data-state; it has not been run.",
      "FR-8 holds only up to 50 unread alerts in the drawer list (D-5).",
      "The checked switch thumb colour depends on the OS colour scheme.",
      "The six other StatTile consumers were not run; a wrapped value may change tile height there.",
      "The wording \"No strategy\", \"Valuation\", \"Quality & risk\", \"Clear all\" and the cap notice text is not operator-confirmed.",
      "Peer fix-fundamentals-roe-unit edits page.tsx:1095; a textual merge conflict is expected.",
      "Feature 344 must adopt the recorded ALERT_UNREAD_COUNT_KEY constraint (merged-list value, invalidated on mark-read and Clear all). Feature 339 lands first and only leaves the refreshUnread() seam.",
      "The exact product-spec.md Out of Scope line for the mark-all-read exclusion must be located before amending."
    ],
    "constitution_rules_touched": [
      "P-02",
      "P-03",
      "C-10",
      "C-12",
      "C-13",
      "C-15",
      "C-16",
      "C-17",
      "C-18"
    ],
    "rationale": "The adversary's verdict is SOUND with no Floor breach, and I agree. Both blocking objections from round 3 are answered, so no blocking objection remains.\n\n**Register.** The proposal rests on D-1..D-6 and D-8..D-19. It reintroduces no locked R-n (R-11 and R-12 are honoured) and re-raises no closed O-n.\n- D-7 was already marked reopened at round 3 and is superseded by D-15, so `reopened` is empty this round.\n- P-1's verdict should move from \"pending user\" to \"user reopened\"; its evidence is already on record, so I list no petition.\n\n**Closed this round.**\n- O-17: the capped drain is confirmed with cap, cutoff and end states.\n- O-2: StreamAlerts stubs are stated per scenario, never `route.continue()`, and the indicator is allowed briefly.\n- O-18 to O-23: each is answered concretely by the proposal.\n\n**Corrections I folded in.** The adversary raised four non-blocking fixes that the proposal does not yet contain. I adopted all four in the approach and kept them as open non-blocking objections until the proposer confirms:\n- short-page termination, so `done` is honest;\n- `variant=\"muted\"` for the capped notice;\n- one `compareCreatedAt` comparator;\n- an unexported cap, with the pool-load note in design.md.\n\n**Item 8 mapping.** The user's only words on this are \"Choose the one with less friction\". That it answers the Clear all scope question is the orchestrator's relayed reading.\n- The round-3 `context.md` on `origin/feature/fix-symbol-page-alerts-ui` lists scope and confirm as gate questions. That makes the reading plausible but does not prove it.\n- I kept @AC-10 as covered, because the operator's both-buttons decision sanctions a persisting Clear all.\n- I left a non-blocking objection to record the mapping and confirm it at the gate.\n- For that reason listed-only is not locked as rejected.\n\n**344 coordination.** Declining the react-query move is right: it is not free, because it would reopen the O-3 mechanics. The `refreshUnread()` seam and the recorded key constraint meet the steer's \"if it costs nothing extra\" condition.\n\n**O-12** stays open. None of the numbered answers maps to it with confidence.",
    "register_delta": {
      "new_decisions": [
        {
          "text": "Clear all scope is the capped drain: drainUnread in alertShared.ts loops listAlerts({unreadOnly:true, limit:50}) and markAlertRead(ids) with injected list/mark, capped at 20 batches (1000 alerts) by an unexported code constant, eligible only at or before the newest createdAt listed at click (ties included), returning done, capped or error; done only on a page shorter than the limit, and a full page with no eligible id is capped.",
          "evidence": "Operator design-gate answer \"choose the one with less friction\" (relayed reading); notifyServiceImpl.ts:211-218,236-257,82-124; adversary r4 short-page correction"
        },
        {
          "text": "Clear all has no confirm and no undo; the button's accessible name is its visible text \"Clear all\" with no aria-label; one shared pending flag disables Clear all and every per-row button while any mark call is in flight; every drain outcome adds markedIds to readIds and refetches; capped shows a muted CardNotice and error shows the D-13 error notice.",
          "evidence": "Operator \"less friction\"; AlertInbox.tsx:66-74; alert-stream.spec.ts:79 (WCAG 2.5.3); CardNotice.tsx:10-16; adversary r4"
        },
        {
          "text": "Every per-spec alert scenario stubs StreamAlerts with the D-14 helpers and never calls route.continue(): @AC-3/@AC-4/@AC-10 hold every attempt; @AC-5/@AC-9 gate, deliver once, then hold; the disconnected indicator may show briefly after delivery, its absence is never asserted, and the bell is located by /^Alerts/.",
          "evidence": "mock-backend.ts:677-679; stream-reconnect.spec.ts:14-44; useReconnectingStream.ts:41-44,61-63; AlertStream.tsx:66; operator steer; adversary r4 C-16 check"
        },
        {
          "text": "One private compareCreatedAt in alertShared.ts serves both mergeUnread and drainUnread.",
          "evidence": "Adversary r4 (C-18 DRY); notifyServiceImpl.ts:80,100,116 (single millisecond now for stored and streamed createdAt)"
        },
        {
          "text": "Feature 339 does not move the unread fetch onto react-query; it keeps pure helpers and a single refreshUnread() entry point, and records for feature 344 that the ALERT_UNREAD_COUNT_KEY value is derived from the merged de-duplicated unread list and is invalidated by mark-read and Clear all.",
          "evidence": "providers.tsx:12; trader/layout.tsx:10; useBackfills.ts:50; D-5, R-5; operator steer (\"if it costs nothing extra\"); adversary raised no objection"
        },
        {
          "text": "Before /sdd-spec: the mark-all-read exclusion leaves product-spec Out of Scope, FR-10 is added with the capped-drain wording, and @AC-10 is added with two distinctly titled stored fixtures (\"Backfill 9f8e7d6c failed\", \"Daily loss limit reached\"); design.md records the default-mock bell (5) versus inbox (2) disagreement and the notify 1-connection drain load.",
          "evidence": "P-03/C-15; C-12; D-12, D-16; root CLAUDE.md Connection Pool Budget; notifyServiceImpl.ts:234-253; adversary r4"
        }
      ],
      "new_rejected": [
        {
          "text": "Moving the unread fetch onto a shared react-query key inside feature 339",
          "why": "It would replace the closed O-3 seq-guard and prune mechanics and fix the key's value shape before feature 344 defines it; the refreshUnread() seam costs nothing instead"
        },
        {
          "text": "A config key for the drain batch cap",
          "why": "The operator did not ask for a knob (C-18); an unexported code constant is enough"
        },
        {
          "text": "Any per-spec StreamAlerts stub branch that calls route.continue()",
          "why": "The default mock streams ALERT_STREAM_ALL on each connect, which breaks the scenario starting badge counts"
        }
      ],
      "new_objections": [
        {
          "text": "Record in context.md which gate question the operator's item 8 (\"Choose the one with less friction\") answered, with the verbatim text and the reading (capped drain, no confirm, no undo), and confirm once at the gate; the fallback is listed-only with \"showing 50 of N\" (P-03).",
          "blocking": false
        },
        {
          "text": "The proposer must confirm the adversary's four drain corrections folded into the synthesis: short-page termination with the 50-newer Vitest case, variant=\"muted\" for the capped notice, a single compareCreatedAt, and an unexported cap with the notify pool-load note in design.md (P-03/C-17/C-18).",
          "blocking": false
        }
      ],
      "closed_objections": [
        {
          "id": "O-2",
          "how": "StreamAlerts stubs are stated per scenario (hold every attempt for @AC-3/@AC-4/@AC-10; gate, deliver once, then hold for @AC-5/@AC-9; never route.continue()); a brief disconnected indicator is allowed and never asserted absent; stream-reconnect.spec.ts:105-133 is preserved. The adversary found no C-16 regression."
        },
        {
          "id": "O-17",
          "how": "The capped drain is confirmed: 20 batches of 50, createdAt cutoff at click with ties eligible, done/capped/error end states. The stop-rule correction is tracked as a new non-blocking objection."
        },
        {
          "id": "O-18",
          "how": "No confirm and no undo is adopted on the operator's \"less friction\" answer plus the inbox precedent (AlertInbox.tsx:66-74). Recording the item-8 mapping is tracked as a new non-blocking objection."
        },
        {
          "id": "O-19",
          "how": "Clear all has no aria-label; the accessible name is the visible text."
        },
        {
          "id": "O-20",
          "how": "One shared pending flag disables Clear all and every per-row button during any mark call."
        },
        {
          "id": "O-21",
          "how": "The @AC-10 stored fixtures are titled \"Backfill 9f8e7d6c failed\" and \"Daily loss limit reached\", with INVENTORY.md rows."
        },
        {
          "id": "O-22",
          "how": "The Out of Scope edit, the FR-10 wording and @AC-10 are stated and land before /sdd-spec."
        },
        {
          "id": "O-23",
          "how": "design.md records that under the default mock the bell shows 5 and the inbox 2 unread, so FR-8 agreement is asserted only under per-spec stubs."
        }
      ],
      "reopen_petitions": [],
      "reopened": []
    }
  },
  "floor_breaches": []
}
```

## Session 2026-11-15 — sdd-design

- Phase 0 Recon: wrote recon.md (services: `xstockstrat-ui`; key reuse patterns: the Notifications inbox mark-read + refetch pattern, `AlertInbox.tsx:42-53`; one `StatTile` fix shared by all three symbol-page grids).
- Phase 1 Grilling: 4 rounds (full). Chosen approach: five surgical changes in `xstockstrat-ui` only (StatTile wrap guard; Fundamentals two-group redesign with `fmtUsdCompact`; `opportunityChipLabel`; switch `data-[state=…]` rewrite; Alerts drawer listing merged unread alerts with per-row mark-read and a capped-drain Clear all). Rejected: R-1..R-15 in debate.md, among them a local-only Clear all (R-11), a new notify RPC (R-12), a react-query move inside 339 (R-13) and a config key for the drain cap (R-14).
- Constitution rules touched: P-02, P-03, C-10, C-12, C-13, C-15, C-16, C-17, C-18. Floor breaches: none.
- Status: spec-ready → design-approved.
- Termination: approved by the operator at the design gate after round 4. Artifacts: recon.md, debate.md (State approved), design.md.

### Operator sign-off (2026-11-15, design gate, round 4)

- Recorded decision: "the round-4 design is APPROVED."
- Operator reply as relayed to this session, verbatim:
  1. "Approved"
  2. "Confirmed"
  3. "Sign-off the change, amend it"
  4. "There are no production instances. Staging is enough."
- Earlier design-gate decisions, also binding:
  - The drawer offers both a per-row mark-read and a clear-all action; removing "Clear all" outright is not accepted.
  - Clear all scope: "choose the one with less friction". Relayed reading: one click marks every unread alert read on the server (the capped drain over the existing RPCs), with no confirm dialog and no undo.
- Limit of the evidence: the numbered reply does not say which question each item answers, and it may cover the whole batch. This session did not map items 2-4 to this feature's gate questions. The approval itself (item 1 and the recorded decision) is the only item acted on.
- Register changes made this session:
  - `debate.md` State is `approved`.
  - Petition P-1 (reopen D-7) reads `user reopened`, not `user declined`. The operator's both-actions decision is the reopen: D-7 already reads "reopened @ round 3 (operator steer)" and D-15 supersedes it. The batch step asked for `user declined` on any pending petition; that would contradict the register, so it was not applied.
  - O-12, O-24 and O-25 stay `open` (non-blocking); the step carried no status change for them. They are open threads below.

### Decisions

- All CHANGE rows in design.md § Business Rules Touched (@AC-1, @AC-2, @AC-3, @AC-5, @AC-6, @AC-9 of this feature) are signed off by the operator decisions above and those recorded in the sdd-review session (2026-11-15). No existing durable `@AC` rule is changed.
- Feature 344 constraint: the `ALERT_UNREAD_COUNT_KEY` value is derived from the merged, de-duplicated unread list and is invalidated by mark-read and Clear all. Feature 339 lands first and leaves only the `refreshUnread()` seam.
- The drain cap (20 batches of 50) is an unexported constant. It must not be raised without revisiting the notify single-connection load (about 60 sequential queries worst case).

### Open Threads

Target steps use the design's build-order steps (1-5) until `/sdd-spec` numbers them.

- [ ] **Before `/sdd-spec` — spec amendments (D-25).** Remove the "mark all read" exclusion from `product-spec.md` § Out of Scope (`product-spec.md:123`), add FR-10 with the capped-drain wording, and add @AC-10 to `acceptance.feature` with the fixtures "Backfill 9f8e7d6c failed" and "Daily loss limit reached".
- [ ] **Before `/sdd-spec` — O-12.** Ask the operator whether checkbox, field and questionnaire get the same `data-state` fix. The design leaves them unchanged (R-4). If item 2 of the reply ("Confirmed") was the answer to this question, R-4 needs a reopen first.
- [ ] **Before `/sdd-spec` — O-24.** Clear all bulk-writes up to 1000 read marks with one tap and no undo, including alerts beyond the 50 shown. The scope rests on the relayed reading of "less friction". The unlocked fallback is listed-only with a "showing 50 of N" line.
- [ ] **Step 5 — O-25.** The proposer never confirmed the four adversary drain corrections (short-page stop rule with the 50-newer Vitest case, `muted` capped notice, one `compareCreatedAt`, unexported cap with the load note). The approved design includes them.
- [ ] **Step 5.** A drain can stop partway on a cap or an error, leaving some alerts read and some unread; this is accepted and shown through a notice.
- [ ] **Step 5.** A worst-case drain queues about 60 queries on notify's single DB connection, alongside `EmitAlert` inserts for all users.
- [ ] **Step 5.** With 50 or more alerts arriving after the click, the drain returns `capped` and the user must click again.
- [ ] **Step 5.** The inbox "Mark all read" stays bounded to its loaded rows (fails.md:2774), so the drawer and the inbox differ on purpose.
- [ ] **Step 5 e2e.** The brief disconnected indicator after a fulfilled stub stream has not been run. Polls in @AC-5/@AC-9 need timeouts above `STREAM_STABLE_MS` (3 s) plus the backoff.
- [ ] **Step 5.** Pruning can wrongly drop an unread alert if notify ever runs with read replicas or replication lag.
- [ ] **Step 5 e2e.** The default e2e badge becomes 5 on every trader `AppShell` page. A full Playwright run in the execute sandbox is impractical; scope and pre-warm the run.
- [ ] **Step 5.** FR-8 holds only up to 50 unread alerts in the drawer list (D-5).
- [ ] **Step 4.** `renderToStaticMarkup` of the Radix Switch in the Vitest node environment is assumed to emit `data-state`; it has not been run.
- [ ] **Step 4.** The checked switch thumb colour depends on the OS colour scheme.
- [ ] **Step 1.** The six other `StatTile` consumers were not run; a wrapped value may change tile height there.
- [ ] **Steps 2, 3, 5.** The wording "No strategy", "Valuation", "Quality & risk", "Clear all" and the cap notice text is not operator-confirmed.
- [ ] **Step 2.** Peer `fix-fundamentals-roe-unit` edits `page.tsx:1095`; a textual merge conflict is expected.
- [ ] **Feature 344 design.** Feature 344 must adopt the recorded `ALERT_UNREAD_COUNT_KEY` constraint.
