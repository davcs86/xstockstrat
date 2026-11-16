# Context Log: fix-symbol-page-alerts-ui

> Distilled 2026-11-15 by /sdd-distill. Full pre-distill session prose is in git history (before this commit).

## Decisions

Feature 339, SEV-3 bug, Track C, single service `xstockstrat-ui`; no proto, migration or config change. Status `implementation-ready` (15 steps). Register: `debate.md` (D-1..D-25, R-1..R-15, O-1..O-25, P-1; State `approved`). All dates 2026-11-15.

**Operator rulings (binding; quoted as recorded)**

- Triage: "Fundamentals card gets a **full redesign** consistent with the rest of the symbol page (abbreviation acceptable, not mandated); strategy-less chip label defaults to the **row source**; drawer shows **unread only** (stored + live) with mark-read and a refreshing badge."   (source: Session /sdd-triage)
- OPERATOR DECISIONS (binding, recorded 2026-11-15), verbatim from the product-spec review session:
  - Fundamentals card gets a full redesign consistent with the rest of the symbol page; abbreviating large values is acceptable but not mandated; the page's other stat grids get the same overflow guard.
  - A strategy-less opportunity chip is labelled from the row's source by default, never the ticker.
  - The Alerts drawer shows unread alerts only (stored plus live), offers mark-read, and the badge refreshes on mark-read and on a streamed alert.
  - The shared switch must render checked when checked wherever it is used.
- Peer 344: "Per the operator (2026-11-15), opening an alert's page marks it read." That is peer `alert-detail-page`'s job; it shows in 339 only through refetch-on-open. 339 lands first and keeps drawer rows a plain `<li>`.   (source: design gate round 2)
- Design gate (round 3 steer): "The drawer offers both a per-row mark-read and a clear-all action; removing "Clear all" outright is not accepted." This is the reopen of D-7 (petition P-1 reads `user reopened`; D-15 supersedes D-7). The batch step asked to mark pending petitions `user declined`; that would contradict the register and was not applied.   (source: rounds 3-4, Session sdd-design)
- Clear all scope — operator text, verbatim: "8. Choose the one with less friction" (also recorded as "choose the one with less friction"). Read by the orchestrator, not the operator, as answering round-3 gate questions 1 and 2: capped drain, no confirm, no undo. The numbered list covered the whole batch and did not say which question item 8 answers. **Now confirmed directly** — O-24 "Confirmed" (see the kept operator-answers session).   (source: round 4, Session sdd-design, operator answers)
- Design approval: recorded decision "the round-4 design is APPROVED." Operator reply as relayed, verbatim: 1. "Approved" 2. "Confirmed" 3. "Sign-off the change, amend it" 4. "There are no production instances. Staging is enough." The reply does not say which question each item answers and may cover the whole batch. Only item 1 (approval) was acted on. Readings, each an assumption: item 3 fits the D-25 amendments (which were made on D-25's own strength); item 2 was never mapped (it could have been O-24 or O-12; both were later asked directly); item 4 is read as a staging-only post-merge smoke test, and no step depends on it.   (source: Sessions sdd-design, sdd-spec, sdd-review impl-spec)
- An earlier numbered gate answer, "update all pages", may or may not have been given to O-12; it was never mapped. O-12 is now answered directly.   (source: round 3)
- O-24 — "Confirmed": one tap marks every unread alert read on the server, up to 1,000 including ones beyond the 50 shown, no confirm, no undo. Steps 11-12 need no re-spec.   (source: operator answers)
- O-12 — "Yes, fix the primitives. Use the switch component from Shadcn." Supersedes D-4 and reopens R-4; Steps 9-10 MUST be re-specified before execute. Orchestrator interpretation (not operator words): keep the stock shadcn components and make their variants work, not replace the file.   (source: operator answers)

**Design state (chosen approach; detail in `design.md` / `debate.md`)**

- Five surgical changes: (1) `StatTile` wrap guard (`wrap-anywhere` + `<wbr/>` after commas, helper private to `StatTile.tsx`, no `min-w-0`), shared by all three symbol-page grids; (2) Fundamentals card as two labelled four-tile groups (Valuation; Quality & risk) with an as-of/source footer and `fmtUsdCompact` for Market cap; (3) `opportunityChipLabel` = strategy id, else humanized source, else "No strategy", never the symbol; (4) switch checked-state fix — **the D-4 mechanism is superseded by the O-12 ruling**; (5) Alerts drawer lists merged, de-duplicated unread alerts (stored + streamed), badge = merged length, per-row mark-read plus a persisting Clear all (D-15), sequence-guarded fetches that prune the streamed buffer.
- Clear all = `drainUnread({ list, mark, cutoff, maxBatches })` in `src/lib/alertShared.ts` over the existing `ListAlerts`/`MarkAlertRead` RPCs (D-20, D-21): 20 batches of 50, result `done`/`capped`/`error`; `done` only on a short page. Rejected: local-only Clear all (R-11), a new notify RPC (R-12), listed-only (O-17: the proposer's "needs a contract change" claim was false, `notifyServiceImpl.ts:211-218,231-257`, and listed-only repeats `fails.md:2774`).
- The drain cap is an unexported constant, not a config key (R-14). It must not be raised without revisiting notify's single direct DB connection (about 60 sequential queries worst case, alongside `EmitAlert` inserts for all users).
- The unread fetch does not move onto react-query in 339 (R-13). Constraint recorded for feature 344 (D-24): the `ALERT_UNREAD_COUNT_KEY` value is derived from the merged, de-duplicated unread list and is invalidated by mark-read and Clear all; 339 leaves only pure helpers and the `refreshUnread()` seam.
- e2e (D-22, R-15): every per-spec alert scenario stubs `StreamAlerts` as well as `ListAlerts` with the D-14 helpers and never calls `route.continue()`; @AC-3/@AC-4/@AC-10 hold every attempt, @AC-5/@AC-9 gate, deliver once, then hold; the disconnected indicator's absence is never asserted. Per-spec stateful `ListAlerts` stubs include every already-streamed alert minus ids marked read (O-3). The shared mock with `unreadOnly` returns stored unread rows plus `ALERT_STREAM_ALL`, so the default e2e badge is 5 on every trader `AppShell` page; the inbox shows 2, so FR-8 agreement is asserted only under per-spec stubs.
- Unlocked fallback (not rejected): no pruning — remove streamed alerts only through local `readIds` — if the mock coupling proves fragile, at the cost of an alert read in another tab lingering until the next trader navigation.
- PRESERVE rules with no operator decision behind them that must stay green: @AC-9 @feature-270 (dropped stream shown and reconnects, `e2e/trader/stream-reconnect.spec.ts:105-133`), @AC-5 @feature-271 (stream not cut by the unary deadline), @AC-6 @feature-203 (inbox mark-read). No existing durable `@AC` rule is changed; the CHANGE rows in design.md § Business Rules Touched (@AC-1, -2, -3, -5, -6, -9 of this feature) are signed off by the rulings above.
- The inbox "Mark all read" stays bounded to its loaded rows (`fails.md:2774`), so the drawer and the inbox differ on purpose.
- Constitution rules touched: P-02, P-03, C-10, C-12, C-13, C-15, C-16, C-17, C-18. Floor breaches: none.

**Spec state**

- D-25 amendments are done (by the sdd-spec session, on the strength of D-25 and C-15): `product-spec.md` gained FR-10, names Clear all under the header surface and lost the "mark all read" exclusion (the inbox's own "Mark all read" stays out of scope); `acceptance.feature` gained `@AC-10 @FR-10` with the fixtures "Backfill 9f8e7d6c failed" and "Daily loss limit reached".
- Code and test steps are atomic pairs (`Lands with`): 1+2, 3+4, 5+6, 7+8, 9+10, 11+12, 14+15; Step 13 (e2e groundwork) stands alone and precedes Step 14.
- `@AC-1`'s geometry assertions land with the `StatTile` guard (Step 2), not the redesign: once the guard is in, a later test could not go red on it. Step 6 asserts the redesign itself.
- `drainUnread` takes the newest listed alert as `cutoff` and uses a private `compareCreatedAt` (no export). `UNREAD_PAGE_SIZE = 50` is exported from `alertShared.ts` (list limit, streamed-buffer cap, drain page size); the batch cap (20) stays unexported.
- Names chosen by the sdd-spec session, not by the design or the operator: `fmtUsdCompact` output form (`$6.73B`, `$3.45T`, `Intl` compact notation), footer date through the existing `fmtNyDate`, source humanizer rule (`_`/`-` to a space, first letter upper-cased), fixtures `FUNDAMENTALS_LYFT`, `POSITION_LYFT_WIDE`, `LYFT_SOURCE_LABEL_OPPORTUNITIES`, `DRAWER_ALERT_*`, new spec file `e2e/trader/symbol-page-display.spec.ts`, and the `ALERT_LIST_002` retitle "Buying power check failed".
- Codebase findings behind the spec: Vitest collects only `src/**/*.test.ts` in node (`vitest.config.ts:19-20`), so the `StatTile` and switch render tests are `.test.ts` built with `createElement`, and no test used `renderToStaticMarkup` before; `OPPORTUNITIES` already has empty-`strategyId` rows with a source (`e2e/fixtures/opportunities.ts:134-135,147-148`; recon.md wrongly said none), but none for LYFT/`fundamentals`, and their `BigInt` `validUntil` cannot pass `JSON.stringify`, so Step 8 still adds a fixture; no `page.route` stub for `GetFundamentals`/`GetPosition` exists and LYFT needs both (mock serves fundamentals for AAPL only, positions for AAPL and MSFT); `PushToggle` derives `checked` from `navigator.serviceWorker.ready` → `pushManager.getSubscription()` (`PushToggle.tsx:50-58`), so `@AC-6` needs an init-script override of permission and subscription; the Position panel is the first Trade panel (active mobile tab at 384px without a click); `alert-stream.spec.ts:31-45` and `:69-82` encode the old drawer and three more tests locate the bell via the `^2$` badge and move to the role locator.
- Line refs re-verified at product-spec review in `src/app/trader/positions/[symbol]/page.tsx`: `:1089` Market cap `fmtUsd` value (not a grid), `:1120` Fundamentals grid, `:842,901` the other stat grids, `:444` the chip label. The C-14 warning (conditional BFF route registration for `MarkAlertRead`) is settled: none is needed, the trader BFF already exposes the RPCs (`recon.md:24`).
- Merge order: 339 lands before 344 (`alert-detail-page`); both edit `src/components/trader/AlertStream.tsx` (soft, rebase-only; 344 `product-spec.md:79` already says so). No config, proto or migration collision with peers 340-344.

## Open Threads

- [ ] **Before `/sdd-execute` — re-spec Steps 9-10 (O-12 ruling).** Fix the primitives (switch, checkbox, field, questionnaire) by making the stock shadcn `data-checked:` / `data-unchecked:` variants resolve — likely one `shadcn/tailwind.css` import in `src/app/globals.css`. The re-spec must grep every use of `data-open`, `data-closed`, `data-selected`, `data-disabled`, `data-active`, `data-horizontal`, `data-vertical`, state what changes visually, and check the feature-307 theme bundle check. The finding was read in the tree, not run in a browser. D-4 superseded, R-4 reopened; `debate.md`, `design.md` and `implementation-spec.md` still carry the old switch design.   (source: operator answers)
- [ ] **Register drift.** `debate.md` still lists O-12, O-24 and O-25 as `open`, and `implementation-spec.md` § "Operator questions `/sdd-execute` must ask" still asks O-12 and O-24; both are answered.   (source: Session sdd-design, operator answers)
- [ ] **Step 11-15 — O-25.** The proposer never confirmed the four adversary drain corrections (short-page stop rule with the 50-newer Vitest case, `muted` capped notice, one `compareCreatedAt`, unexported cap with the load note). The approved design includes them.
- [ ] **Step 14 — size (C-18).** One step changes the badge, the drawer list, per-row mark-read and Clear all, with seven pieces of state; left as one step (D-8, D-13, D-21, D-23; atomic with Step 15). Watch for surface beyond the instructions.
- [ ] **Steps 11-15 — accepted drain risks.** A drain can stop partway on a cap or error (some read, some unread; shown through a notice); with 50 or more alerts arriving after the click it returns `capped` and the user must click again; about 60 queries worst case on notify's single connection; FR-8 holds only up to 50 unread in the drawer list (D-5); pruning can wrongly drop an unread alert if notify ever runs with read replicas or replication lag.
- [ ] **Not run, each a deviation to record if it fails at execute.** Step 2: whether the `GetPosition` stub alone renders the Position panel for LYFT. Step 10: the `navigator.serviceWorker.ready` override in headless Chromium and the app `Switch` wrapper render under Vitest (plain-node Radix render does emit `data-state`). Step 15: a route handler that never settles, and the brief disconnected indicator after a fulfilled stream; polls in @AC-5/@AC-9 need timeouts above `STREAM_STABLE_MS` (3 s) plus the backoff.
- [ ] **All e2e steps (2, 6, 8, 10, 13, 15).** A full Playwright run in the execute sandbox is impractical; scope and pre-warm it. If it cannot run, record the "unverified AC" Deviation Log row; do not report a pass.
- [ ] **Step 1.** The six other `StatTile` consumers were not run; a wrapped value may change tile height there.
- [ ] **Step 9-10.** The checked switch thumb colour depends on the OS colour scheme (`dark:` is `prefers-color-scheme`).
- [ ] **Wording and names not operator-confirmed — raise at the first execute checkpoint.** "No strategy", "Valuation", "Quality & risk", "Clear all" (round-3 gate question 3, label "Clear all" vs "Mark all read", has no recorded operator answer; the design keeps "Clear all"), the capped notice ("Some alerts are still unread — Clear all again"), the two error notices, the `fmtUsdCompact` form (`$6.73B`), the source humanizer rule and the fixture names.
- [ ] **Step 5.** Peer feature 340 (`fix-fundamentals-roe-unit`) edits `page.tsx:1095`; a textual merge conflict is expected.
- [ ] **Feature 344.** Must adopt the `ALERT_UNREAD_COUNT_KEY` constraint and land after Step 15. `docs/roadmap/features/merge-order.md` has no row for the 339/344 pair; it is still to be added.

## Files Modified

No service source file is modified yet (execute has not started). SDD artifacts only, all under `docs/roadmap/features/339-fix-symbol-page-alerts-ui/`:

- `feature.md`, `product-spec.md`, `acceptance.feature`, `context.md` — created by /sdd-triage
- `product-spec.md`, `acceptance.feature` — review warnings resolved (@AC-1 Scenario Outline, @AC-9 added, @AC-3 and FR-9 reworded); later FR-10, `@AC-10` and the Out of Scope change (D-25, sdd-spec session)
- `recon.md`, `debate.md`, `design.md` — written by /sdd-design
- `implementation-spec.md` — written by /sdd-spec (15 steps); edited by /sdd-review impl-spec (Coverage lines, unverified-AC fallback rule, Step 10 notes, Operator gate lines)
- `status.md` — draft → spec-ready → design-approved → implementation-ready

---

## Superseded Sessions

### 2026-11-15 — /sdd-triage
- Defect report `docs/reports/2026-11-15-ui-symbol-page-and-alerts-drawer-defects-defect.md` (operator report from homelab staging with screenshots; root causes from same-day read-only recon). SEV-3, Track C, service `xstockstrat-ui`, branch `feature/fix-symbol-page-alerts-ui`.
- Design depth recommended `quick`: the rubric said skip, raised because the operator asked for a full Fundamentals card redesign (a layout fork to debate once). A full debate was run in the end.
- Tracked separately: 342-chart-series-palette, 343-backtest-inline-backfill, 344-alert-detail-page, 340-fix-fundamentals-roe-unit, 341-fix-indicator-pane-warmup. Operator decisions: see header.

### 2026-11-15 — sdd-review product-spec
- Approved, draft → spec-ready; 6 non-blocking warnings. Five resolved in the spec: @AC-1 became a Scenario Outline over `6726553623.93` (the reported value) and `3450000000000.00` (13 integer digits); @AC-9 added (an alert both streamed and stored appears once, badge `1`); @AC-3 also asserts the Notifications page shows 1 unread; FR-9 states all three pages render the one shared component, so scenarios exercise the Push notifications card only; Root Cause line refs re-grepped (header).
- Sixth (C-14): BFF route registration for `MarkAlertRead` was conditional in the spec; handed to /sdd-design recon to settle.
- Overlap WARN: soft rebase-only collision with 344 on `AlertStream.tsx` (339 FR-5/FR-6 vs 344 FR-4); land 339 first. Binding OPERATOR DECISIONS block: verbatim in header.

### 2026-11-15 — sdd-batch design gate (round 2)
- Halted at the gate, adversary NEEDS WORK, no Floor breach; register D-1..D-14, R-1..R-10, O-1..O-16. Round-2 Clear-all position: per-row mark-read *replaces* "Clear all" (D-7) — reversed in round 3.
- Blocking: O-2 (C-16) prune-on-fetch breaks PRESERVE @AC-9 @feature-270 because the shared mock streams `ALERT_STREAM_ALL` but `listAlerts` never returns those ids; fix = shared mock returns stored unread plus `ALERT_STREAM_ALL` when `unreadOnly` (default badge 5). O-3: per-spec stateful `ListAlerts` stubs must include already-streamed alerts minus read ids.
- Non-blocking then: O-7 (bigint `createdAt` comparator throws as described), O-13, O-14, O-15 (`AlertStream` is mounted by the trader `AppShell`, not globally), O-16; operator question O-12 raised. Peer-344 operator ruling: header.

_(Superseded `sdd-batch-design-state` block for this round dropped by /sdd-distill under operator sanction, 2026-11-15; it is in git history before the distill commit.)_

### 2026-11-15 — sdd-batch design gate (round 3)
- Halted at the gate, NEEDS WORK, no Floor breach; register D-1..D-19, R-1..R-12, O-1..O-23, P-1. D-7 reopened on the operator's steer: drawer keeps per-row mark-read and gains a Clear all persisting through the existing `MarkAlertRead` RPC (D-15); one shared `pending` flag; visible label "Clear all" is the accessible name.
- Blocking: O-17 (P-03) the proposer's listed-only Clear all rested on a false "needs a contract change" claim (`notifyServiceImpl.ts:211-218,231-257`) and repeats `fails.md:2774`; synthesis adopted the capped drain with a `createdAt` cutoff. O-2 narrowed: per-spec scenarios must stub `StreamAlerts` too. Closed: O-3, O-7, O-13, O-14, O-15, O-16.
- Gate questions put to the operator: (1) drain-with-cap (recommended) vs listed-only with "showing 50 of N"; (2) no confirm/no undo (recommended, matches the inbox "Mark all read") vs a confirm dialog (O-18); (3) label stays "Clear all"; (4) P-1 pending; (5) O-12, with the unmapped "update all pages" answer. Spec amendments owed (later D-25).

_(Superseded `sdd-batch-design-state` block for this round dropped by /sdd-distill under operator sanction, 2026-11-15; it is in git history before the distill commit.)_

### 2026-11-15 — sdd-batch design gate (round 4)
- Halted at the gate, adversary SOUND, no Floor breach, no blocking objection; register D-1..D-25, R-1..R-15, O-1..O-25, P-1. Fixed the Clear all scope (D-20, D-21: `capped` shows a `muted` `CardNotice`, `error` the D-13 notice; every outcome adds marked ids to `readIds` and refetches through the single `refreshUnread()`; a full page with no eligible id is `capped`; ties at the cutoff are eligible), the `StreamAlerts` stubs (D-22) and the 344 coordination (D-24).
- O-24 opened: the scope rested on a relayed reading of item 8 and there is no unmark-read RPC, so it needed one direct confirmation (since given). O-25 opened. Closed: O-2, O-17, O-18, O-19, O-20, O-21, O-22, O-23.
- Gate questions: (1) confirm item 8 chose the capped drain; (2) O-12; (3) P-1 still read "pending user" because the round's register delta carried no row for it. Verbatim item-8 evidence and its limits: header.

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

### 2026-11-15 — sdd-design
- Phase 0 wrote recon.md (reuse: the inbox mark-read + refetch pattern, `AlertInbox.tsx:42-53`; one `StatTile` fix for all three grids). Phase 1: 4 rounds (full); approved by the operator at the gate after round 4; spec-ready → design-approved; artifacts recon.md, debate.md (State `approved`), design.md.
- Register changes: P-1 set to `user reopened` (not `user declined`, see header); O-12, O-24, O-25 left `open` because the step carried no status change for them. Items 2-4 of the numbered reply were not mapped to gate questions.
- Opened the pre-spec threads (D-25 amendments, located at `product-spec.md:123`; O-12; O-24) and the step-level risk list; all are carried in the header (D-25 done, O-12 and O-24 answered).

### 2026-11-15 — sdd-spec
- Wrote implementation-spec.md, 15 steps; design-approved → implementation-ready. Tree `feature/fix-symbol-page-alerts-ui@0442d300d`; `origin/main-dev@d1c97273b` was 4 commits ahead with no change under `services/xstockstrat-ui/` (two `docs/` files), so recon.md line numbers were re-read and still held.
- Made the owed D-25 amendments itself (they had not been made). The ledger (about 8,600 lines) was read by targeted search for the entries design.md cites and the UI test-harness traps, not end to end.
- Spec decisions, chosen names and codebase findings: header § Spec state. The relayed four-item reply was recorded again with its readings (header).

---

## Session 2026-11-15 — sdd-review impl-spec

- Mode B, advisory. Lifecycle unchanged (`implementation-ready`). Run by the sdd-batch workflow; the criteria and overlap verdicts were handed to this session, which edited `implementation-spec.md` and wrote this entry.
- Result: 0 failures, 7 warnings, no Floor breach (PASS WITH WARNINGS). Overlap: WARN, soft file-level only.
- Tree: `feature/fix-symbol-page-alerts-ui@ce8265cd0`.

### Operator reply relayed to this session

Verbatim, the same four items the sdd-design and sdd-spec sessions recorded:

1. "Approved"
2. "Confirmed"
3. "Sign-off the change, amend it"
4. "There are no production instances. Staging is enough."

It still does not say which question each item answers, and it may cover the whole batch. This session did not map item 2 to O-12 or O-24 and treats neither as answered. Item 4 is read, as before, as a staging-only smoke test; no step depends on it.

### Addressed (edits to `implementation-spec.md`)

- [x] **Coverage threshold on every test step (warning 1).** Steps 2, 4, 6, 8, 10, 12, 13 and 15 each gained a Coverage line in Verification. Re-read: `vitest.config.ts:29-33` sets lines, functions and statements to 40 for `src/lib/**`; there is no branches threshold. Steps 4, 8 and 12 run `test:coverage`; the others add no `src/lib/**` code and say so.
- [x] **e2e fallback is not a pass (warning 3).** "Running e2e in the execute sandbox" now requires a Deviation Log row headed "unverified AC" that names each unproven scenario: `@AC-3`, `@AC-4`, `@AC-7`, `@AC-8` have e2e as their only proof; `@AC-1`, `@AC-2`, `@AC-6` lose their layout or DOM half; `@AC-5`, `@AC-9`, `@AC-10` lose their end-to-end half. The row closes only on a green real Playwright run (local, or the `frontend-e2e` CI job).
- [x] **Step 10, `renderToStaticMarkup` (part of warning 2).** Run in plain node against the installed `radix-ui`: the Radix `Switch.Root` with a `Switch.Thumb` emits `data-state="checked"` / `"unchecked"` on root and thumb. Recorded in Step 10. Not run: the same render through the app's `Switch` wrapper under Vitest.
- [x] **Step 10, service-worker override (part of warning 2).** Step 10 now names it as the higher-risk part (`ready` is a prototype accessor) and says to stop and record a deviation, not weaken `@AC-6`.
- [x] **Step 7 wiring is e2e-only (warning 5).** Stated in Step 8's Verification and in the fallback rule.
- [x] **Operator questions made explicit (warning 7, and the O-24 part of warning 4).** New block "Operator questions `/sdd-execute` must ask" in the Execution Summary, with an `Operator gate` line in Steps 9, 11 and 14. A "yes" on O-12 or a listed-only answer on O-24 needs a re-spec first.

### Open Threads

Unresolved items carried into execution. `/sdd-execute` announces each one still unchecked at every checkpoint and at session end.

- [ ] **Steps 9-10 — O-12 (operator, C-11).** Ask before the unit: do checkbox, field and questionnaire get the `data-state` fix? Unanswered; R-4 leaves them unchanged.
- [ ] **Steps 11-15 — O-24 (operator, C-11, C-18).** Ask before the Steps 11-12 unit: confirm the capped drain (up to 1000 marks per click, no confirm, no undo), or choose listed-only. Unanswered. Listed-only needs a re-spec of Steps 11, 12, 14 and 15.
- [ ] **Step 14 — size (C-18, warning 4).** One step changes the badge, the drawer list, per-row mark-read and Clear all, with seven pieces of state. Left as one step: the design settles it (D-8, D-13, D-21, D-23) and it is atomic with Step 15. Watch for surface beyond the instructions; the capped-drain surface depends on O-24.
- [ ] **Step 2 — not run.** Whether the `GetPosition` stub alone renders the Position panel for LYFT.
- [ ] **Step 10 — not run.** The `navigator.serviceWorker.ready` override in headless Chromium, and the wrapper render under Vitest. Real risk of a red step.
- [ ] **Step 15 — not run.** A route handler that never settles, and the brief disconnected indicator after a fulfilled stream. Real risk of a red step.
- [ ] **All e2e steps (2, 6, 8, 10, 13, 15).** If the scoped Playwright run is impractical in the sandbox, the fallback leaves the named scenarios unverified; record the unverified-AC row, do not report a pass.
- [ ] **Steps 3, 7, 12 — names not operator-confirmed (warning 6).** The `fmtUsdCompact` output form (`$6.73B`), the source humanizer rule and the fixture names are this spec's choices. Left as they are; raise them with the operator at the first checkpoint.
- [ ] **Overlap — feature 344 (`alert-detail-page`, `draft`).** Both features modify `src/components/trader/AlertStream.tsx` (Step 14). Soft, rebase-only: 339 lands first. `docs/roadmap/features/merge-order.md` has no row for this pair; this session may not edit that file, so the row is still to be added. No migration, proto field or config key collision.

---

## Session 2026-11-15 — operator answers after impl-spec review (orchestrator)

Asked directly, answered verbatim by the operator (2026-11-15):

- **O-24 (Clear all scope) — "Confirmed".** Question: one tap marks every unread alert read on the
  server, up to 1,000 including ones beyond the 50 shown, no confirm, no undo. The capped drain
  stands; Steps 11-12 need no re-spec.
- **O-12 (checkbox, field, questionnaire) — "Yes, fix the primitives. Use the switch component from
  Shadcn."** This supersedes D-4 (hand-rewriting `data-checked:` to `data-[state=checked]:` in
  `switch.tsx`) and reopens R-4 (the global variant). Steps 9-10 MUST be re-specified before execute.
- **Finding (orchestrator, read in the tree, not run in a browser):** `switch.tsx`, `checkbox.tsx`,
  `field.tsx` and `questionnaire.tsx` are stock shadcn (`components.json` style `radix-rhea`). Their
  `data-checked:` / `data-unchecked:` variants are defined by `shadcn/tailwind.css`
  (`node_modules/shadcn/dist/tailwind.css`, `@custom-variant data-checked` matching
  `[data-state="checked"]`). `src/app/globals.css` imports only `tailwindcss` and `tw-animate-css`,
  so the variants never resolve. The likely fix is that one import, leaving the shadcn files
  unmodified. That file also defines `data-open`, `data-closed`, `data-selected`, `data-disabled`,
  `data-active`, `data-horizontal`, `data-vertical`: the re-spec must grep every use of those
  variants and state what changes visually, and check the feature-307 theme bundle check.
- **Orchestrator interpretation (not operator words):** "use the switch component from Shadcn" is
  read as "keep the stock shadcn components and make their variants work", not "replace the file".

## Session 2026-11-15 — /sdd-distill
- Distilled 9 sessions → header + Superseded Sessions; kept 2 verbatim.
- context.md 1044 → 435 lines. Original prose preserved in git history.
- **Operator sanction (2026-11-15), deviation from the skill's preserve-every-`sdd-batch-*`-block rule:** asked
  "How should I write them?" with the option "Keep only the last state block", the operator chose it. The 2
  superseded per-round `sdd-batch-design-state` block(s) are dropped; the last one is kept byte-for-byte (the only one
  any workflow reads, `.claude/workflows/sdd-batch.js:191`). Other `sdd-batch-*` blocks are untouched.
- The loss check was a self-check by the planning agent (no separate `context-distiller` verifier was available).

## Session 2026-11-15 — re-spec of Steps 9-10 (orchestrator)

- **Steps 9-10 re-specified** for the operator's O-12 ruling ("Yes, fix the primitives. Use the switch
  component from Shadcn."). Step 9 adds only the `data-checked` / `data-unchecked` `@custom-variant`
  blocks (copied from `shadcn/tailwind.css:42-54`) to `src/app/globals.css`; no component file is
  edited. Step 10 adds a compiled-CSS Vitest file and e2e checks for the switch and the login checkbox.
- **Why not the whole stylesheet (orchestrator decision, C-11 — not operator words):** a PostCSS compile
  showed `@import 'shadcn/tailwind.css'` rewrites seven more variants in use (`data-open`, `data-closed`,
  `data-active`, `data-horizontal`, `data-vertical`, `data-disabled`) and adds utilities and keyframes,
  visibly changing about ten components (open/close animations, active tab styling, slider track,
  toggle-group corners, combobox scrollbar). The operator was not asked about those. Open question to
  the operator: adopt the full import as a separate change?
- **Corrections to the earlier finding:** the questionnaire is not broken today (its primitive sets a
  bare `data-checked`); `FieldLabel` and `QuestionnaireChoice` render nowhere in the app, so their
  proof is the compiled-CSS test only.
- **Evidence limits:** the compile proof ran (scoped diff touches only the two variants; feature-307
  theme check 0 failures on both themes); no browser run; `pnpm run lint` timed out, so lint on the
  new test file is unconfirmed.
- **Open:** should `acceptance.feature` / FR-9 gain a checkbox scenario (the checkbox assertion
  traces only to the O-12 ruling).

## Session 2026-11-15 — re-spec of Steps 9-10, full stylesheet (orchestrator)

- **Operator answers (verbatim, 2026-11-15).** Asked "Adopt the full Shadcn stylesheet later? ... I'd
  treat it as a separate feature; this run does not include it. Do you want that opened as a new
  story?" — **"No, add it to the scope"**. Asked "Add a checkbox acceptance scenario to 339?" —
  **"Yes"**. The operator had been shown: open/close animations on dialogs, menus, selects, sheets
  and tooltips; the active tab background; slider track and toggle-group corners; the hidden
  combobox scrollbar. This supersedes the scoped two-variant Step 9 of the previous session.
- **Step 9 now:** `@import 'shadcn/tailwind.css';` as line 3 of `src/app/globals.css`, nothing else.
  Left as they are: the `accordion-*` keyframes in `globals.css` (already a duplicate of
  `tw-animate-css`, and still the pair in effect), the `// app-specific` rewrites in `tabs.tsx` and
  `sidebar.tsx` (compiled rules identical, no conflict), the already-stale comment at
  `FormulaReferencePanel.tsx:50-52`.
- **Step 10 now:** `checkedVariants.test.ts` (13 compiled-CSS cases, one per variant family plus
  `no-scrollbar`), and e2e for the switch (`@AC-6`/`@AC-7`), the login checkbox (`@AC-11`) and the
  selected "Strategy" tab on `/config-ui/templates` (`@AC-12`). Amendments made under the operator's
  sanction: FR-9 names the checkbox; new FR-11; new `@AC-11`, `@AC-12`.
- **Evidence:** PostCSS compile with the import; feature-307 `checkBundle` 0 failures on both themes;
  Vitest 12 red / 1 green before, 13 green after; theme tests green; prettier, tsc and lint clean.
  **No browser run:** every e2e assertion, the on-screen effect, and whether existing specs survive
  the new 100-200 ms animations (nothing disables them) are unverified; Step 10 lists the specs.
- **Correction:** sidebar, separator and navigation-menu do have consumers (`PlatformHeader`,
  `BottomTabBar`, `AlertStream`); the earlier count missed relative imports.
- **Not on the list the operator saw — announce at the first execute checkpoint:** separator lines
  appear (header, Alerts drawer, sidebar); the open navigation-menu trigger gains a background and
  its chevron turns; the open accordion item gains a background; the sidebar scrollbar is hidden.
- **Assumptions (orchestrator, not operator words):** "add it to the scope" covers the whole
  stylesheet, including those changes; the FR-11 and `@AC-12` wording; one e2e (tabs) for FR-11 with
  the rest proven by compiled CSS only; no pre-emptive waits added to existing specs.

## Session 2026-11-15 — sdd-execute sequential (sdd-batch-execute)

- **Up-front confirmation (operator-approved record, verbatim):**
  `{"mainDev":"9f88562296464b43465d0376b40cefafe93f0743","dev":"4a5639d416037de9a680efd24d43aab4af1e43c2","specHash":"21574d5e01f37ca8c26adbe73f057bdf287c7cea","directive":"conditional","pending":[1,2,3,4,5,6,7,8,9,10,11,12,13,14,15],"mismatches":[{"n":2,...},{"n":7,...},{"n":9,...},{"n":10,...}]}`
  — the full mismatch details are in the body of the re-spec commit below.
- **Merge:** `origin/main-dev@9f8856229` merged into the feature branch (`53dc63844`); resolver and
  `ledger-guard` clean.
- **Re-spec commits** (`git log --first-parent origin/main-dev..HEAD`):
  - `e2535497f7d5fda1a37bdfb5c74e59240a7545d7` — respec(fix-symbol-page-alerts-ui): align steps
    2,7,9,10 with current codebase. Step 2 cites the existing `GetPosition` / `GetFundamentals`
    stubs and pairs a `ListAccounts` stub before any `@AC-8` deviation; Step 7 corrects the
    `SectionRenderer` gap wording; Step 9 count and line drift; Step 10 adds
    `e2e/theme/theme-bundle.spec.ts` (aria snapshots) to the specs at risk and to Verification, and
    records that Chromium is provisioned at `/opt/pw-browsers`.
- **Tooling setup (steps 1-15):** node v24 ✓ · pnpm ✓ 9.15.9 · Playwright Chromium ✓
  (`/opt/pw-browsers`, chromium-1243) · vitest/tsc/next ✓ (linked main-checkout `node_modules`).
- Status `implementation-ready` → `in-progress`.

```sdd-batch-setup
{"mainDev":"9f88562296464b43465d0376b40cefafe93f0743","date":"2026-11-15"}
```

## Session 2026-11-15 — sdd-execute sequential, Steps 1+2 (atomic unit)

### Step 1 — service: `StatTile` value wrap guard [done]
- Unit 1+2. `StatTile`'s value div gains `wrap-anywhere`; a private `withCommaBreaks` renders a `<wbr />` after each comma of a string value (numbers unchanged). No `min-w-0`, no truncation, no new prop.
- Files modified: `services/xstockstrat-ui/src/components/shared/StatTile.tsx`
- TDD: red/green recorded under Step 2 (one cycle for the unit).
- Deviations: none for this step (see Step 2).

### Step 2 — test: `StatTile` render test and tile-fit e2e at 384px [done]
- Unit 1+2. Vitest render test (`renderToStaticMarkup`), fixtures `FUNDAMENTALS_LYFT` / `POSITION_LYFT_WIDE` with `INVENTORY.md` rows, and `e2e/trader/symbol-page-display.spec.ts` (`@AC-1` x2, `@AC-8`).
- Files modified: `services/xstockstrat-ui/src/components/shared/StatTile.test.ts`, `services/xstockstrat-ui/e2e/fixtures/{fundamentals.ts,positions.ts,INVENTORY.md}`, `services/xstockstrat-ui/e2e/trader/symbol-page-display.spec.ts`
- TDD: AC-1/AC-8 red: Vitest `<wbr/>` and `wrap-anywhere` assertions failed (2 failed, 1 passed); e2e `scrollWidth <= clientWidth` failed in all 3 tests (122 vs 253/205/205) → green: Vitest 3 passed, e2e 3 passed, lint and `tsc --noEmit` clean, `mobile-overflow` `/trader/positions` 2 passed (with `--timeout=90000`).
- Deviations: global `React` for the render test; Position tab clicked (not active by default); value located by `.tabular-nums`; spec-level warmup + 30 s timeout; `mobile-overflow` needed `--timeout=90000` in the sandbox — full detail in Deviation Log. The `GetPosition` stub alone renders the Position panel (Step 2 "not run" item closed).
- Not run: the six other `StatTile` consumers (open thread unchanged).

## Session 2026-11-15 — sdd-execute sequential, Steps 3+4 (atomic unit)

### Step 3 — service: `fmtUsdCompact` [done]
- Unit 3+4. New `fmtUsdCompact` below `fmtUsd` in `money.ts`: same null/NaN guard (`—`), else `$` + `en-US` compact notation with two fraction digits (`$6.73B`, `$3.45T`, `$0.00`). `fmtUsd` unchanged.
- Files modified: `services/xstockstrat-ui/src/lib/money.ts`
- TDD: red/green recorded under Step 4 (one cycle for the unit).
- Deviations: none.

### Step 4 — test: `fmtUsdCompact` [done]
- Unit 3+4. `describe('fmtUsdCompact')` in `money.test.ts`: `6726553623.93` → `$6.73B`, `3.45e12` → `$3.45T`, `3.02e12` → `$3.02T`, `0` → `$0.00`; `—` for `undefined`, `null`, `NaN`.
- Files modified: `services/xstockstrat-ui/src/lib/money.test.ts`
- TDD: AC-1 (unit half) red: against a stub returning `''`, `expected '' to be '$6.73B'` and `expected '' to be '—'` (2 failed, 2 passed) → green: `money.test.ts` 4 passed; `test:coverage` 79 files, 554 passed / 2 skipped, Lines 79.42%, Functions 80.71%, Statements 78.21% (≥ 40%); lint (pre-existing warnings only, none in `money*`) and `tsc --noEmit` clean.
- Deviations: none. Config-key wiring gate N/A (no key touched).
- Open (unchanged): the `$6.73B` output form is not operator-confirmed — raise at the first checkpoint.

## Session 2026-11-15 — sdd-execute sequential, Steps 5+6 (atomic unit)

### Step 5 — service: Fundamentals card redesign [done]
- Unit 5+6. `FundamentalsSection` renders two labelled groups of four `StatTile size="md"` tiles, each on the old grid classes: Valuation (Market cap via `fmtUsdCompact`, P/E, P/B, EPS) and Quality & risk (ROE, Debt/Equity, Beta, Div yield). Below them is an `as of <fmtNyDate> · <source>` footer, built only from the parts present. The header, loading and error branches are verbatim; other value expressions are unchanged; no `sub` lines.
- Files modified: `services/xstockstrat-ui/src/app/trader/positions/[symbol]/page.tsx`
- TDD: red/green recorded under Step 6 (one cycle for the unit).
- Deviations: none for this step (see Step 6).

### Step 6 — test: redesigned Fundamentals card e2e [done]
- Unit 5+6. Both `@AC-1` tests in `e2e/trader/symbol-page-display.spec.ts` now also assert the "Valuation" and "Quality & risk" headers, the compact Market cap (`$6.73B` / `$3.45T`), P/E `41.20`, exactly eight tile labels each above its value, and the footer `as of 2026-11-13 · fmp`. No new fixture.
- Files modified: `services/xstockstrat-ui/e2e/trader/symbol-page-display.spec.ts`
- TDD: AC-1 red: lint and `tsc` clean, then both `@AC-1` tests failed at `getByText('Valuation')` (`element(s) not found`; 2 failed, 1 passed) → green: `symbol-page-display.spec.ts` 3 passed (38.2s), lint (pre-existing warnings only) and `tsc --noEmit` clean.
- `position-detail.spec.ts -g "Fundamentals"`: FR-7 (`:164`) fails as the first cold test, at the 5 s expect on `P/E` while the card still says "Loading fundamentals…". It fails the same way on the base `page.tsx`. With the redesign, `--workers=1 --repeat-each=2 --timeout=90000` passed 9 of 10, including the FR-7 repeat; no-data, feature 220, feature 145 and `@AC-15` passed. The `frontend-e2e` CI job is the confirming run (Deviation Log).
- Deviations: CI-equivalent fallback for the `position-detail` command — full detail in Deviation Log. Config-key wiring gate N/A (no key touched).
- Open (unchanged): "Valuation" / "Quality & risk" wording is not operator-confirmed; peer 340 conflict at the old `page.tsx:1095` ROE line is expected.

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
- **Checkpoint 5 — "Yes"** (proceed), and **wording — "Confirm"**: asked "The group labels 'Valuation' and
  'Quality & risk' and the `$6.73B` format were chosen by the spec, not by you. Confirm or give
  replacements." The labels and the compact format are operator-confirmed.

## Session 2026-11-15 — sdd-execute sequential, Steps 7+8 (atomic unit)

### Step 7 — service: `opportunityChipLabel` [done]
- Unit 7+8. New `opportunityChipLabel({ strategyId, source })` in `opportunityShared.tsx`: the strategy id, else the source with `_`/`-` turned into spaces and the first letter upper-cased, else `No strategy`; it never reads the symbol. `page.tsx` `opportunityPanels` uses it for `label` (was `o.strategyId || o.symbol`). No runtime client-only import added.
- Files modified: `services/xstockstrat-ui/src/lib/opportunityShared.tsx`, `services/xstockstrat-ui/src/app/trader/positions/[symbol]/page.tsx`
- TDD: red/green recorded under Step 8 (one cycle for the unit).
- Deviations: none for this step (see Step 8).

### Step 8 — test: chip label unit test and `@AC-2` e2e [done]
- Unit 7+8. `describe('opportunityChipLabel')` in `opportunityShared.test.ts` (strategy id wins; `fundamentals` → `Fundamentals`; `unusual_whales` → `Unusual whales`; both empty → `No strategy`). New fixture `LYFT_SOURCE_LABEL_OPPORTUNITIES` (two LYFT rows, no `validUntil`, not in `OPPORTUNITIES`) with its `INVENTORY.md` row. `@AC-2` e2e in `symbol-page-display.spec.ts` stubs `ListOpportunities`, and within the `Opportunities` radiogroup asserts radios `dip_buyer_vol_stop` and `Fundamentals` visible and none named `LYFT`.
- Files modified: `services/xstockstrat-ui/src/lib/opportunityShared.test.ts`, `services/xstockstrat-ui/e2e/fixtures/{opportunities.ts,INVENTORY.md}`, `services/xstockstrat-ui/e2e/trader/symbol-page-display.spec.ts`
- TDD: AC-2 red: Vitest 3 failed / 7 passed (`opportunityChipLabel is not a function`); e2e `@AC-2` failed at the `Fundamentals` radio, snapshot `radio "LYFT"` (1 failed, 3 passed) → green: Vitest 10 passed; `test:coverage` 79 files, 557 passed / 2 skipped, Lines 79.56%, Functions 80.8%, Statements 78.36% (≥ 40%); lint (pre-existing warnings only, none in the touched files) and `tsc --noEmit` clean; `symbol-page-display.spec.ts` 4 passed; `position-detail.spec.ts -g "feature 145"` 4 passed with `--timeout=90000` (2 cold `page.goto` timeouts at 10 s without it).
- Deviations: CI-equivalent fallback for the feature-145 command; the block's exit status is the trailing grep's — full detail in Deviation Log. Config-key wiring gate N/A (no key touched).
- Open (unchanged): the "No strategy" wording and the source humanizer rule are not operator-confirmed; same-source strategy-less rows get identical chips (accepted gap, design.md § 3).

## Session 2026-11-15 — sdd-execute sequential, Steps 9+10 (atomic unit)

### Step 9 — service: import the stock `shadcn/tailwind.css` so the primitives' state variants resolve [done]
- Unit 9+10. `@import 'shadcn/tailwind.css';` is line 3 of `src/app/globals.css`, after `tw-animate-css`. Nothing else changed: no hand-written `@custom-variant`, the `accordion-*` keyframes stay, and no component file was edited.
- Files modified: `services/xstockstrat-ui/src/app/globals.css`
- TDD: red/green recorded under Step 10 (one cycle for the unit). Step 9 Verification: `sed` printed `@import 'shadcn/tailwind.css';`, prettier clean, `src/styles/themes` 131 passed, lint (pre-existing warnings only, none in touched files) and `tsc --noEmit` clean, `git diff --stat -- src/components` empty.
- Deviations: the empty `git diff --stat` (an untracked file is not listed) — see Deviation Log. Config-key wiring gate N/A (no key touched).
- Announce at the checkpoint, not on the list the operator saw: separator lines appear (header, Alerts drawer, sidebar); an open navigation-menu trigger gains a background and its chevron turns; an open accordion item gains a background; the sidebar scrollbar is hidden.

### Step 10 — test: compiled-CSS guard, switch `@AC-6`/`@AC-7`, checkbox `@AC-11` and tab `@AC-12` e2e [done]
- Unit 9+10. New `src/components/ui/checkedVariants.test.ts` compiles `globals.css` with `@tailwindcss/postcss` and checks 12 selector rows plus `.no-scrollbar`. In `notifications.spec.ts`, `@AC-6` overrides `Notification.permission` and `ServiceWorkerContainer.prototype.ready` (subscription `https://push.example/e2e`) and asserts the thumb centre is right of the track centre; `@AC-7` overrides only the permission and asserts the thumb is left of centre. `auth.spec.ts` gains `@AC-11`: the Remember me fill changes when checked. In `templates.spec.ts`, after the "Strategy" click, the selected tab's background differs from "Formula"'s (`@AC-12`). No colour literals and no new fixture.
- Files modified: `services/xstockstrat-ui/src/components/ui/checkedVariants.test.ts`, `services/xstockstrat-ui/e2e/accounts/notifications.spec.ts`, `services/xstockstrat-ui/e2e/auth.spec.ts`, `services/xstockstrat-ui/e2e/config-ui/templates.spec.ts`
- TDD: AC-6/AC-11/AC-12 red: Vitest 12 failed / 132 passed (e.g. `expected '.data-checked\:bg-primary[data-checke…' to contain '[data-state="checked"]'`; the questionnaire row passes). e2e: `@AC-11` failed on `not.toHaveCSS` (`oklab(1 0 0 / 0.135)` both ways); with `--timeout=90000`, `@AC-6` failed at the thumb-position poll (`aria-checked="true"` held), the `@AC-12` tab failed on `not.toHaveCSS` (`rgba(0, 0, 0, 0)` both ways), and `@AC-7` passed ("red N/A — no behaviour change; characterization test added", as for the questionnaire row). Green: Vitest 144 passed (5 files), prettier, lint and `tsc --noEmit` clean. The Playwright command with `--timeout=90000` passed 85 of 86, including all four new or extended tests and every `theme-bundle` aria snapshot. Coverage: no `src/lib/**` code was added, so the 40% gate is unaffected.
- Deviations: CI-equivalent fallback (`--timeout=90000`; the unchanged command had 22 harness timeouts, none an assertion). `mobile-sidebar.spec.ts:77` is a pre-existing cold-start flake: it fails the same way on the base `globals.css`. Full detail in Deviation Log. Config-key wiring gate N/A.
- Closed: the Step 10 "not run" item. The `navigator.serviceWorker.ready` override works in headless Chromium. The open thread on the OS colour scheme deciding the thumb colour is unchanged (no colour is asserted).

## Session 2026-11-15 — sdd-execute sequential, Steps 11+12 (atomic unit)

- O-24 operator gate: already answered "Confirmed" (operator-answers session above); no re-spec, the capped drain stands.

### Step 11 — service: unread-alert helpers in `alertShared.ts` [done]
- Unit 11+12. `alertShared.ts` gains the `UnreadLike` type, exported `UNREAD_PAGE_SIZE = 50`, a private newest-first `compareCreatedAt` (missing timestamp first), `mergeUnread` (de-dup on `alertId`, stored copy kept, `readIds` dropped, sorted), `pruneStreamed` (keep if in the result or `seq >= fetchSeq`) and `drainUnread` (injected `list`/`mark`, cutoff ties eligible, unexported cap `MAX_DRAIN_BATCHES = 20` with its load-note constraint comment; `done` on a short page, `capped` on a full page with no eligible id or at the cap, `error` with the ids marked so far). No React or client import.
- Files modified: `services/xstockstrat-ui/src/lib/alertShared.ts`
- TDD: red/green recorded under Step 12 (one cycle for the unit). Step 11 Verification (`pnpm run lint && pnpm exec tsc --noEmit`): exit=0, pre-existing lint warnings only, none in touched files.
- Deviations: none for this step (see Step 12).

### Step 12 — test: unread-alert helpers [done]
- Unit 11+12. Fixtures `DRAWER_ALERT_BASE_SECONDS`, `DRAWER_ALERT_STORED_UNREAD`, `DRAWER_ALERT_STORED_READ`, `DRAWER_ALERT_STREAMED`, `DRAWER_ALERT_CLEAR_A`, `DRAWER_ALERT_CLEAR_B` (Connect-JSON `createdAt`, not in the shared mock lists) with one `INVENTORY.md` row; `src/lib/alertShared.test.ts` with 4 `mergeUnread`, 1 `pruneStreamed` and 7 `drainUnread` cases against an in-memory notify.
- Files modified: `services/xstockstrat-ui/src/lib/alertShared.test.ts`, `services/xstockstrat-ui/e2e/fixtures/{alerts.ts,INVENTORY.md}`
- TDD: AC-5/AC-9/AC-10 red against signature-only helpers: 12 failed / 12 (e.g. `expected [] to deeply equal [ 'alert-drawer-streamed', …(1) ]`, `expected 'done' to be 'capped'`) → green: 12 passed; `test:coverage` 81 files, 582 passed / 2 skipped, Statements 79.29%, Functions 81.38%, Lines 80.44% (≥ 40%; `alertShared.ts` 97.22% statements); lint (pre-existing warnings only) and `tsc --noEmit` clean; `grep` lists the `DRAWER_ALERT_` row.
- Deviations: block exit status is the trailing `grep`'s; INVENTORY row line drift; fixture details the spec left open — full detail in Deviation Log. Config-key wiring gate N/A (no key touched).

## Session 2026-11-15 — sdd-execute sequential, Step 13

### Step 13 — test: e2e groundwork for the unread-only drawer (no behaviour change) [done]
- `connectStreamBody`, `fulfillStream` and `gate` moved unchanged into the new `e2e/helpers/connectStream.ts` as exports; `stream-reconnect.spec.ts` imports `fulfillStream` and `gate` and is otherwise unchanged. The shared mock's `listAlerts(req)` returns, when `req.unreadOnly`, the stored unread rows followed by `ALERT_STREAM_ALL` with `unreadCount` = 5, and otherwise what it returned before (stateless). `ALERT_LIST_002` is retitled "Buying power check failed" and the `INVENTORY.md` alerts row says so. Both changes are inert until Step 14: nothing in `src/` sends `unreadOnly` yet.
- Files modified: `services/xstockstrat-ui/e2e/helpers/connectStream.ts` (new), `services/xstockstrat-ui/e2e/trader/stream-reconnect.spec.ts`, `services/xstockstrat-ui/e2e/mock-backend.ts`, `services/xstockstrat-ui/e2e/fixtures/{alerts.ts,INVENTORY.md}`
- TDD: red N/A — no behaviour change; the four existing specs are the characterization. Green: lint (pre-existing warnings only) and `tsc --noEmit` clean; Playwright `stream-reconnect`, `alert-stream`, `notifications`, `live-strategies` 24 passed with `--timeout=90000`; the `grep` prints the `../helpers/connectStream` import. Coverage: no `src/lib/**` code added, so the 40% gate is unaffected.
- Deviations: CI-equivalent fallback (the unchanged command had 6 failures, all at the 10 s harness test timeout during cold compiles); the block's exit status is the trailing `grep`'s; the `connectStreamBody` signature is wrapped by Prettier and `type Route` left the spec's import; `INVENTORY.md` fails `prettier --check` before and after (pre-existing). Full detail in the Deviation Log. Config-key wiring gate N/A (no key touched).

## Session 2026-11-15 — sdd-execute sequential, Steps 14+15 (atomic unit)

- O-24 operator gate: already answered "Confirmed" (operator-answers session above). The capped-drain parts of Step 14 are built as specified.

### Step 14 — service: Alerts drawer lists merged unread alerts, with mark-read and Clear all [done]
- Unit 14+15. `AlertStream` now holds `stored`, a `streamed` buffer of `{ alert, seq }`, `readIds`, `seqRef`, one `pending` flag, `fetchFailed` and `markNotice`. A single `refreshUnread()` calls `listAlerts({ unreadOnly: true, limit: UNREAD_PAGE_SIZE })` with a latest-wins guard and prunes the buffer through `pruneStreamed`. It runs on mount, when the drawer opens (`Sheet onOpenChange`) and after every mark action. The `useReconnectingStream('alerts', …)` key and `streamAlerts` request are unchanged; only the item callback changed. The badge (with `9+`) and `hasHighSeverity` read `mergeUnread(...)`. Each row is still a plain `<li>`, now with a ghost "Mark read" button (`aria-label="Mark read: <title>"`). Clear all keeps its slot, classes and text and runs `drainUnread` with `cutoff: merged[0]`. Notices: error `CardNotice` ("Could not load alerts" / "Could not mark alerts read") and muted capped notice. No shared store, window event or react-query key; `AlertInbox` untouched.
- Files modified: `services/xstockstrat-ui/src/components/trader/AlertStream.tsx`
- TDD: red/green recorded under Step 15 (one cycle for the unit). Step 14 Verification: lint and `tsc --noEmit` clean (pre-existing warnings only, none in touched files); `grep -n "useReconnectingStream" -A 7` shows the `'alerts'` key and the unchanged `streamAlerts` request.
- Deviations: error-notice wording and the notice spacing are executor choices — see Deviation Log. Config-key wiring gate N/A (no key touched).

### Step 15 — test: Alerts drawer scenarios [done]
- Unit 14+15. `e2e/trader/alert-stream.spec.ts` rewritten. Default-mock tests: the bell is visible; the badge shows `5` before and after the drawer opens (replaces `:31-45`); "opening the sheet", the high-severity test and the feature-271 hold test now locate the bell by role (`/^Alerts/`) and keep their other assertions; the old local Clear all test is deleted. A local `stubNotify` helper keeps its state in the test closure. It stubs `ListAlerts` (unread set = stored unread + streamed − marked, newest first; inbox form with `read` flags; `unreadCount` = unread set size), `MarkAlertRead` (records ids) and `StreamAlerts` (held, or gated once then held; never `route.continue()`). Scenarios `@AC-3`, `@AC-4`, `@AC-5`, `@AC-9` and `@AC-10` use the `DRAWER_ALERT_*` fixtures and the `fulfillStream` / `gate` helpers.
- Files modified: `services/xstockstrat-ui/e2e/trader/alert-stream.spec.ts`
- TDD: AC-3/AC-4/AC-5/AC-9/AC-10 red (`.sdd-logs/v-1.log`, 12 failed / 9 passed). `@AC-3`: `getByRole('dialog').getByText('Backfill 67276d1f failed')` not found. `@AC-4`: no `Mark read: Backfill 67276d1f failed` button. `@AC-5`: `Expected: "2"`, `Received: "1"`. `@AC-10`: no `Clear all` button. `@AC-9`: 10 s test timeout inside its badge poll. Green: the unchanged command passed all five scenarios (17 passed / 4 failed, every failure at the 10 s harness timeout). With `--timeout=90000`: 20 passed / 1 failed (the cold-load inbox `@AC-1`, untouched), then 21 passed / 0 failed. `route.continue` grep: no match. Coverage: no `src/lib/**` code added, so the 40% gate is unaffected.
- Deviations: CI-equivalent fallback (`--timeout=90000`); bell locator `includeHidden: true` (Radix hides the page while the drawer is open); hydration guard on the badge inside the bell; a second RED run did not start because another worktree held port 9091; parallel worktrees share the Playwright ports — full detail in the Deviation Log.
- Closed: the Step 15 "not run" item. A route handler that never settles works, and the brief disconnected indicator after a fulfilled stream did not break `@AC-5` / `@AC-9`; neither asserts it absent.

### Feature code-completed
- All 15 steps are done. `node scripts/check-config-wiring.mjs --final`: `exit=0`. It printed two `REPORTED:` lines outside this feature (`services/xstockstrat-analysis/app/engine/fundsignal_loop.py:marketdata/fundamentals.provider:readers-disagree` and `services/xstockstrat-trading/internal/service/trading.go:platform/trading_state:readers-disagree`). Status `in-progress` → `code-completed`. No insights ledger entry: nothing here generalizes beyond the Deviation Log.
- Still open for the integration PR: the `frontend-e2e` CI job confirms the `--timeout=90000` fallbacks; `merge-order.md` still has no 339/344 row; feature 344 must adopt the `ALERT_UNREAD_COUNT_KEY` constraint; the header `## Files Modified` block still describes the pre-execute state.

## Session 2026-11-15 — sdd-batch-execute promotion plan (awaiting operator confirm)

```sdd-batch-promotion-plan
## Promotion plan — fix-symbol-page-alerts-ui (feature 339)

Source: docs/roadmap/features/339-fix-symbol-page-alerts-ui/acceptance.feature, read from the working tree at /home/user/xstockstrat. I did not read it on origin/feature/fix-symbol-page-alerts-ui, because the environment is not a git repo. The affected service is xstockstrat-ui only, since all six scenarios assert on UI-rendered output.

### Verdicts
| @AC | target suite (path) | CREATE/APPEND | verdict | note |
|---|---|---|---|---|
| AC-1 | services/xstockstrat-ui/acceptance/fix-symbol-page-alerts-ui.feature | CREATE | NEW | Market-cap tile at mobile width. No existing suite covers it. |
| AC-2 | same | CREATE | NEW | Strategy-less opportunity chip is labelled by its source. Nearest existing suite is watchlist-opportunity-signal-cues.feature:68 (a source chip on a watchlist signal), which is a different subject. |
| AC-3 | same | CREATE | NEW | Header Alerts drawer lists a stored unread alert. alert-read-unread-persistence.feature (@AC-6 @feature-203) covers the /accounts/notifications inbox page, not the drawer. |
| AC-4 | same | CREATE | NEW | Marking an alert read in the drawer clears it and the badge. |
| AC-5 | same | CREATE | NEW | A streamed alert raises the badge without a reload. |
| AC-6 | same | CREATE | NEW | A checked switch renders in the checked position. aria-checked and switch thumb position are not covered anywhere. |

### Ready-to-write blocks
--- /home/user/xstockstrat/services/xstockstrat-ui/acceptance/fix-symbol-page-alerts-ui.feature (CREATE) ---
Feature: fix-symbol-page-alerts-ui (ui)
  Promoted from feature 339 (@AC-1..@AC-6). Regression guard for the trader symbol page Fundamentals
  tile and opportunity chips, the header Alerts drawer (stored unread, mark-read, streamed), and the
  checked Switch rendering.

  @AC-1 @regression @feature-339
  Scenario: A multi-billion market cap fits its Fundamentals tile at mobile width
    Given the symbol page for "LYFT" at a 384px-wide viewport
    And fundamentals with a market cap of 6726553623.93
    When the Research tab is shown
    Then the market cap tile shows "$6.73B"
    And the market cap value does not overlap the P/E value

  @AC-2 @regression @feature-339
  Scenario: A strategy-less opportunity chip is labelled by its source
    Given opportunities for "LYFT" from strategy "dip_buyer_vol_stop" and one with an empty strategy id and source "fundamentals"
    When the Research tab is shown at mobile width
    Then the chip row shows "dip_buyer_vol_stop" and "Fundamentals"
    And no chip is labelled "LYFT"

  @AC-3 @regression @feature-339
  Scenario: The Alerts drawer shows a stored unread alert that was not streamed
    Given one stored unread alert titled "Backfill 67276d1f failed" and no alert streamed since page load
    When the header bell showing badge "1" is opened
    Then the drawer lists "Backfill 67276d1f failed"

  @AC-4 @regression @feature-339
  Scenario: Marking an alert read in the drawer clears it and the badge
    Given the drawer lists one unread alert and the badge shows "1"
    When the alert is marked read in the drawer
    Then the drawer shows "No alerts"
    And the bell shows no unread badge

  @AC-5 @regression @feature-339
  Scenario: A streamed alert raises the badge without a reload
    Given the badge shows "1" and the drawer is closed
    When an alert titled "Order rejected" is streamed
    Then the badge shows "2"
    And the drawer lists "Order rejected" above the stored alert

  @AC-6 @regression @feature-339
  Scenario: A checked switch renders in the checked position
    Given push notifications are enabled on this device
    When the Notifications page is shown
    Then the push switch has aria-checked "true"
    And its thumb is rendered at the checked (right) position with the primary fill

### Notes / ambiguities / conflicts
- The services/xstockstrat-ui/acceptance/ directory already exists, so no lazy directory creation is needed. The file is new and named after the source slug.
- The source scenarios carry no @FR-* tags, because this is a bug fix. Per the verbatim and no-invention rules I did not add any. Each scenario keeps its @AC-n and @regression tags and gains @feature-339.
- AC-6 (Switch primitive on the Notifications page) could arguably be a shared-component rule. I attributed it to xstockstrat-ui because the Then asserts on rendered DOM there and no other service owns it.
- I found no OVERLAP or CONFLICT. docs/sdd/business-rules/platform.feature was not read directly. A grep over docs/sdd/business-rules for @feature-339, drawer and aria-checked returned nothing.
- alert-read-unread-persistence.feature (@AC-6 @feature-203) is a related but distinct guarantee: the inbox page shows level, module, body and an unread count badge. It is a possible later consolidation reference only.

### Coverage check
- Source scenarios: 6. Planned: 6 NEW, 0 DUP, 0 OVERLAP, 0 CONFLICT. Nothing was skipped.
```

## Session 2026-11-16 — sdd-batch-execute promotion plan, regenerated from the feature branch (awaiting operator confirm)

- **Supersedes the earlier `sdd-batch-promotion-plan` block.** That plan was built from the `main-dev` working-tree copy of `acceptance.feature` (6 scenarios, no `@FR-*` tags), not from this branch (12 scenarios). The integration step refused to apply it. The operator's "Confirm both" of 2026-11-16 was given on that stale plan and does not cover this one.
- This plan was built by `scenario-promoter` from a checkout of `origin/feature/fix-symbol-page-alerts-ui` at `ea65f6985`. The scenario bodies below were generated mechanically from the source file (only `@feature-339` added to each tag line).

```sdd-batch-promotion-plan
## Promotion plan — fix-symbol-page-alerts-ui (feature 339)

Source: docs/roadmap/features/339-fix-symbol-page-alerts-ui/acceptance.feature at ea65f6985 — 12 scenarios (@AC-1..@AC-12).

### Verdicts
All 12 (@AC-1..@AC-12): target services/xstockstrat-ui/acceptance/fix-symbol-page-alerts-ui.feature, CREATE, verdict NEW. @AC-1 and @AC-12 are Scenario Outlines; their Examples tables are kept.

### Ready-to-write blocks
--- services/xstockstrat-ui/acceptance/fix-symbol-page-alerts-ui.feature (CREATE) ---
# Promoted from docs/roadmap/features/339-fix-symbol-page-alerts-ui/acceptance.feature (Constitution C-16).
# Provenance: @feature-339.

Feature: fix-symbol-page-alerts-ui (bug fix)
  Regression guard for docs/reports/2026-11-15-ui-symbol-page-and-alerts-drawer-defects-defect.md.

  @AC-1 @FR-1 @FR-2 @regression @feature-339
  Scenario Outline: A large market cap fits its Fundamentals tile at mobile width
    Given the symbol page for "LYFT" at a 384px-wide viewport
    And fundamentals with a market cap of <market_cap> and a P/E of 41.2
    When the Research tab is shown
    Then the market cap value is displayed wholly inside the "Market cap" tile
    And the market cap value does not overlap the P/E value
    And each Fundamentals tile shows its label above its value

    Examples:
      | market_cap       |
      | 6726553623.93    |
      | 3450000000000.00 |

  @AC-2 @FR-4 @regression @feature-339
  Scenario: A strategy-less opportunity chip is labelled by its source
    Given opportunities for "LYFT" from strategy "dip_buyer_vol_stop" and one with an empty strategy id and source "fundamentals"
    When the Research tab is shown at mobile width
    Then the chip row shows "dip_buyer_vol_stop" and "Fundamentals"
    And no chip is labelled "LYFT"

  @AC-3 @FR-5 @FR-8 @regression @feature-339
  Scenario: The Alerts drawer shows a stored unread alert that was not streamed
    Given one stored unread alert titled "Backfill 67276d1f failed" and one stored read alert titled "Backfill 11aa22bb done"
    And no alert streamed since page load
    When the header bell showing badge "1" is opened
    Then the drawer lists "Backfill 67276d1f failed"
    And the drawer does not list "Backfill 11aa22bb done"
    And the Notifications page shows 1 unread alert

  @AC-4 @FR-6 @FR-7 @regression @feature-339
  Scenario: Marking an alert read in the drawer clears it and the badge
    Given the drawer lists one unread alert titled "Backfill 67276d1f failed" and the badge shows "1"
    When the alert is marked read in the drawer
    Then the drawer shows "No alerts"
    And the bell shows no unread badge
    And the Notifications page shows "Backfill 67276d1f failed" as read

  @AC-5 @FR-5 @FR-7 @regression @feature-339
  Scenario: A streamed alert raises the badge without a reload
    Given one stored unread alert titled "Backfill 67276d1f failed", the badge shows "1" and the drawer is closed
    When an alert titled "Order rejected" is streamed
    Then the badge shows "2"
    And the opened drawer lists "Order rejected" above "Backfill 67276d1f failed"

  @AC-6 @FR-9 @regression @feature-339
  Scenario: A checked switch is displayed on
    Given push notifications are enabled on this device
    When the Notifications page is shown
    Then the push switch reports checked "true"
    And the push switch is displayed in its on position, with the thumb at the trailing end of the track

  @AC-7 @FR-9 @regression @feature-339
  Scenario: An unchecked switch is displayed off
    Given push notifications are not enabled on this device
    When the Notifications page is shown
    Then the push switch reports checked "false"
    And the push switch is displayed in its off position, with the thumb at the leading end of the track

  @AC-8 @FR-3 @regression @feature-339
  Scenario: A long value fits its tile in the symbol page's other stat grids
    Given the symbol page for "LYFT" at a 384px-wide viewport
    And an open position with a cost basis of 1234567890.12 and a last price of 16.42
    When the position stat grid is shown
    Then the cost basis value is displayed wholly inside the "Cost basis" tile
    And the cost basis value does not overlap any neighbouring tile's value

  @AC-9 @FR-5 @FR-8 @regression @feature-339
  Scenario: An alert that is both stored and streamed appears once
    Given no stored unread alert and the drawer is closed
    When an alert titled "Order rejected" is streamed and is then also returned as a stored unread alert
    Then the opened drawer lists "Order rejected" exactly once
    And the badge shows "1"

  @AC-10 @FR-10 @regression @feature-339
  Scenario: Clear all marks every unread alert read, persists, and empties the drawer and badge
    Given two stored unread alerts titled "Backfill 9f8e7d6c failed" and "Daily loss limit reached" and the badge shows "2"
    And no alert streamed since page load
    When "Clear all" is pressed in the opened drawer
    Then the drawer shows "No alerts"
    And the bell shows no unread badge
    And the Notifications page shows "Backfill 9f8e7d6c failed" and "Daily loss limit reached" as read

  @AC-11 @FR-9 @regression @feature-339
  Scenario: A checked checkbox is displayed filled
    Given the sign-in page with "Remember me for 14 days" unchecked
    When "Remember me for 14 days" is checked
    Then the checkbox reports checked "true"
    And the checkbox is displayed with a fill that differs from its unchecked fill

  @AC-12 @FR-11 @regression @feature-339
  Scenario Outline: A shared component is displayed with its state styling
    Given a page that shows a <component> that is <state>
    When the page is displayed
    Then the <component> is displayed with <styling>

    Examples:
      | component                          | state      | styling                                                 |
      | "Strategy" tab on Config templates | selected   | a background the unselected "Formula" tab does not have |
      | dialog, menu, sheet or tooltip     | opening    | its opening animation                                   |
      | dialog, menu, sheet or tooltip     | closing    | its closing animation                                   |
      | separator                          | horizontal | a line 1 pixel high across its container                |
      | separator                          | vertical   | a line 1 pixel wide down its container                  |
      | option list of a combobox          | scrollable | no visible scrollbar                                    |

### Notes
- Every Then asserts on UI rendering or behaviour in xstockstrat-ui; nothing goes to platform.feature.
- No suite carries @feature-339. alert-read-unread-persistence.feature (feature 203, @AC-6) covers the inbox page, not the drawer, bell, mark-read, Clear all or streamed alerts; ui-auth-improvements.feature covers the Remember-me default and cookies, not the checked fill. No OVERLAP, no CONFLICT.

### Coverage check
- Source scenarios: 12. Planned: 12 NEW, 0 DUP, 0 OVERLAP, 0 CONFLICT.
```

## Session 2026-11-16 — operator confirmation of the regenerated promotion plan (orchestrator)

- Asked: confirm the corrected plan above (12 scenarios, verbatim, tags kept, new file under `services/xstockstrat-ui/acceptance/`)? **Operator, verbatim: "Confirm both (Recommended)".** This confirms the last `sdd-batch-promotion-plan` block (P-04).

## Session 2026-11-16 — integration PR e2e failures

- PR #1550 "Frontend E2E (shard 2/2)": 3 failed / 307 passed. All three reproduced locally on the branch tip (`b41b96bc4`); none is a product defect; fixed in the specs only, no animation disable.
- `trader/orders.spec.ts` `@AC-10` and `trader/account-resume.spec.ts` `@AC-3` — one root cause. Both flows keep the row menu open (`onSelect` `preventDefault`) under a confirm `AlertDialog`, and the spec pressed Escape right after Confirm to close the menu. Since Step 9 the dialog plays a 100 ms exit animation and stays in the Radix dismissable-layer stack until it ends, so that Escape went to the closing dialog and the modal menu stayed open: `body` kept `pointer-events: none` (`<html> intercepts pointer events`) and the page stayed `aria-hidden` (the trigger was not found by role).
  - Measured: after Confirm the overlay is `data-state="closed"`, `animation-name: exit`, `0.1s`, and is unmounted within about 200 ms, so the overlay is not stuck and `animationend` fires. With Escape sent early: 1.5 s later menu `open`, body `pointer-events: none`, no dialog. With Escape sent after the dialog detached: menu closes and body pointer-events clear at once.
  - Not a user-facing lock: one raw mouse click outside closes the menu and restores pointer events; the next click reaches the target. The menu staying open after Confirm predates this feature (both specs already said so).
  - Fix: `await expect(page.getByRole('alertdialog')).toHaveCount(0)` before the Escape (the form `account-selector.spec.ts` already uses).
- `theme/theme-bundle.spec.ts` `@AC-7` shell banner — stale ARIA snapshot. Steps 14+15 made the default-mock bell badge `5` by design (design.md, "default badge 5"); `shell.aria.yml` still held `"2"`. Snapshot updated to `"5"`; no other line needed to change.
- Observation, not changed: after a confirmed row action the row menu stays open and absorbs the user's next click (`RowActionsMenu`, `OrdersTable`).
