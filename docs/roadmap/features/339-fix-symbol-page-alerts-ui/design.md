# Design: fix-symbol-page-alerts-ui

**Created**: 2026-11-15
**Rounds**: 4 (full; termination: approved)
**Approved by**: user @ 2026-11-15 (design gate, after round 4)
**Grounded in**: recon.md
**Debate register**: debate.md

---

## Chosen Approach

Five surgical changes in `services/xstockstrat-ui` only. No proto, migration, config key, env var or
BFF route change: the notify RPCs the drawer needs are already exposed on the trader BFF
(`src/lib/traderBff.ts:97,104,115`; recon.md:24). Paths below are relative to
`services/xstockstrat-ui/` unless they start with `services/` or `packages/`.

**Consumer surfaces (C-14).** Trader segment: the symbol page `/trader/positions/[symbol]`
(Fundamentals card, stat grids, opportunity chip row) and the header Alerts drawer and bell, which
the trader `AppShell` mounts (`src/components/trader/AppShell.tsx:24`; recon.md:22). `AlertStream`
remounts on each trader navigation; no cross-segment badge is claimed. The shared switch is
consumed by `/accounts/notifications`, `/config-ui/fundamentals-scan` and
`/insights/signal-sources` (recon.md:37).

**Build order.** 1 + 2, then 3, then 4, then 5. Step 5 lands before peer feature 344
(`alert-detail-page`). A textual conflict with peer `fix-fundamentals-roe-unit` at `page.tsx:1095`
is expected.

### 1. StatTile overflow guard (FR-1, FR-3; @AC-1, @AC-8) — D-1, D-10

- Root cause: unbreakable mono text in `minmax(0,1fr)` grid tracks. `StatTile` has no wrap guard
  (`src/components/shared/StatTile.tsx:19-24`; recon.md:35), and all three symbol-page grids render
  it (`page.tsx:842,901,1120`; recon.md:33-34), so the fix is made once in `StatTile`.
- Add `wrap-anywhere` to the value div. A helper private to `StatTile.tsx` inserts `<wbr/>` after
  each `,` in string values, so a wrap falls on a thousands separator first. The helper gets a
  render test. `min-w-0` is not added (it does nothing here).
- e2e asserts at tile level: the value's bounding box lies inside its tile and
  `scrollWidth <= clientWidth`, at 384px, in the same step as the fix (fails.md, feature 083).

### 2. Fundamentals card redesign (FR-2; @AC-1) — D-2, D-9, D-19

- `FundamentalsSection` (`page.tsx:1084-1129`; recon.md:33) becomes: a header with the `stale`
  badge, then two labelled four-tile groups on `sm:grid-cols-4`:
  - **Valuation** — Market cap, P/E, P/B, EPS.
  - **Quality & risk** — ROE, Debt/Equity, Beta, Div yield.
- Group headers are a `text-xs font-medium text-muted-foreground` line, distinct from the tile
  eyebrows. `sm:grid-cols-4` differs from the sibling `sm:grid-cols-3` grids; the operator's
  full-redesign decision sanctions that.
- Footer `as of <date> · <source>`, rendered only when present, built from existing fields. No
  `sub` lines.
- Market cap uses a new `fmtUsdCompact` in `src/lib/money.ts` beside `fmtUsd`, with a Vitest test.
  `fmtUsd` is unchanged because the trader Book screens share it (`src/lib/money.ts:4-28`;
  recon.md:36,82).
- The loading and error branches stay verbatim (`page.tsx:1112-1118`), which keeps the feature-220
  rule.

### 3. Opportunity chip label (FR-4; @AC-2) — D-3

- New `opportunityChipLabel(o)` in `src/lib/opportunityShared.tsx`, swapped in at `page.tsx:444`
  (recon.md:31). It returns `strategyId`; else the humanized `source`; else "No strategy". It never
  returns the symbol. No label map.
- Vitest case. The empty-strategy fixture is new, has an `INVENTORY.md` row, and is used per-spec
  through `page.route` only. Assertions scope to `getByRole('radio')`.
- Accepted gaps: the mobile `SignalRow` still shows the raw source
  (`src/components/mobile/SectionRenderer.tsx:187-188`), and same-source rows get identical chips.

### 4. Shared switch (FR-9; @AC-6, @AC-7) — D-4, D-11

- Root cause: Radix sets `data-state="checked|unchecked"`, while `switch.tsx` keys on
  `data-checked:` / `data-unchecked:`. Those are `@custom-variant`s shipped in `shadcn/tailwind.css`,
  which `src/app/globals.css` never imports, so Tailwind compiles them as attribute-presence
  variants that never match (recon.md:74).
- Rewrite every `data-checked:` / `data-unchecked:` in `src/components/ui/switch.tsx:20,27` to
  `data-[state=checked]:` / `data-[state=unchecked]:`, including the `dark:` compounds, with an
  `// app-specific` marker.
- The guard test replaces the presence-only `switch.test.ts`. It uses `renderToStaticMarkup` and
  adds no new export. e2e is geometry-only (bounding boxes), because Tailwind 4 `translate-*` sets
  the standalone `translate` property (fails.md, feature 126).
- `dark:` is `prefers-color-scheme` here, so the checked thumb colour stays OS-dependent.
- Checkbox, field and questionnaire are unchanged (R-4). O-12 is still open; see Open Risks.

### 5. Alerts drawer and badge (FR-5..FR-8, new FR-10; @AC-3, @AC-4, @AC-5, @AC-9, new @AC-10) — D-5, D-6, D-8, D-12..D-18, D-20..D-25

All in `src/components/trader/AlertStream.tsx` (today: badge from a one-shot
`listAlerts({limit:1})`, list fed only by the stream, local-only "Clear all" at `:83-92`;
recon.md:29-30), with pure helpers in `src/lib/alertShared.ts`.

**Unread list and badge.**

- Stored unread comes from `listAlerts({unreadOnly:true, limit:50})` on mount, on each open and
  after a mark. No caller uses `unreadOnly` today (recon.md:43).
- `mergeUnread` and `pruneStreamed` live in `alertShared.ts`. Fetches are sequence-guarded,
  latest-wins. A fetch prunes the streamed buffer instead of clearing it, and a local `readIds`
  set filters marked ids.
- The badge is `merged.length`, with the `9+` display kept. FR-8 therefore holds up to 50 unread
  alerts (recon.md:78).
- One `refreshUnread()` function is the single entry point for every fetch trigger.
- A failed fetch keeps the previous list and badge and shows `<CardNotice variant="error">`.
- The `useReconnectingStream` wiring (`AlertStream.tsx:35-46`) is untouched.
- There is no shared store and no cross-page event; the Notifications page and the drawer agree
  through refetch-on-open.

**Per-row mark-read.** A ghost button with `aria-label="Mark read: <title>"`, following the inbox
pattern (`src/app/accounts/notifications/AlertInbox.tsx:42-53`; recon.md:42). A mark error shows
the same error notice and the row stays. Rows stay a plain `<li>` so feature 344 can wrap them
later.

**Clear all — capped drain.** It replaces the local `setAlerts([])`. The pure helper
`drainUnread({ list, mark, cutoff, maxBatches })` goes in `alertShared.ts`; `list` and `mark` are
injected wrappers over `notifyClient.listAlerts` / `markAlertRead`, so Vitest needs no network.

- **Loop.** Each pass calls `list({unreadOnly:true, limit:50})`, takes the ids with
  `createdAt <= cutoff` that are not already in `markedIds`, and calls `mark({alertIds})` if there
  are any. This works because the server returns unread rows `created_at DESC LIMIT $2`
  (`services/xstockstrat-notify/src/grpc/notifyServiceImpl.ts:236-242`) and the mark is one
  idempotent set INSERT (`:211-218`).
- **Stop rule.**
  - `done` only when the page holds fewer rows than `limit`, after marking its eligible ids.
  - `capped` when a full page yields no eligible id. That covers 50 or more newer-than-cutoff
    alerts on top, and phantom ids the JOIN at `:215` drops.
  - `capped` also when `maxBatches` is reached. `markedIds` stays as the no-spin backstop.
  - The common one-page case needs no second `list` call.
- **Cap.** `maxBatches = 20`, so up to 1000 alerts per click. It is an unexported module constant,
  tested through the `maxBatches` parameter. It is not a config key.
- **Cutoff.** The newest `createdAt` in the merged list at click time; ties are eligible. An alert
  that arrives mid-drain is newer, so it stays unread and listed. The button is hidden when the
  merged list is empty, so there is no drain without a cutoff.
- **One comparator.** A private `compareCreatedAt` in `alertShared.ts` serves both `mergeUnread`
  and `drainUnread`. It maps `createdAt.seconds` through `Number()`; a missing timestamp sorts
  first as a fixture tolerance only.
- **Result.** `{ markedIds, outcome: 'done' | 'capped' | 'error', error? }`.
- **End states.** Every outcome adds `markedIds` to `readIds`, clears the shared `pending` flag
  and runs `refreshUnread()`.
  - `done`: "No alerts" and no badge.
  - `capped`: `<CardNotice variant="muted">` "Some alerts are still unread — Clear all again", and
    the refetch lists what is left. It is `muted` because the error variant sets `role="alert"`
    (`src/components/shared/CardNotice.tsx:10-16`) and a partial success is not a failure.
  - `error`: the `<CardNotice variant="error">` and the remaining rows stay. A partial result is
    accepted and visible.
- **No confirm, no undo.** This follows the operator's "choose the one with less friction" and
  matches the unconfirmed inbox "Mark all read" (`AlertInbox.tsx:66-74`). No unmark-read RPC
  exists.
- **Button.** Visible text "Clear all" with no `aria-label` (WCAG 2.5.3), shown when
  `merged.length > 0`. One shared `pending` flag disables Clear all and every per-row button while
  any mark call, per-row or drain, is in flight.
- **Inbox untouched.** `AlertInbox` "Mark all read" stays bounded to its loaded rows.

**Load note.** A worst-case drain is about 60 sequential queries on notify's single direct DB
connection (root `CLAUDE.md` § Connection Pool Budget): two per `listAlerts`, one of them an
uncapped `COUNT(*)` (`notifyServiceImpl.ts:234-253`), and one per mark. That is acceptable at this
cap. The cap must not be raised without revisiting it.

**e2e plan.**

- (a) With `unreadOnly` set, the shared mock returns the stored unread rows plus `ALERT_STREAM_ALL`
  as unread, statelessly (`e2e/mock-backend.ts:677-693`). The default bell badge is then 5 before
  and after opening the drawer, on every trader `AppShell` page.
- (b) Retitle `ALERT_LIST_002` so stored and streamed alerts have distinct titles.
- (c) Timestamped fixtures, with `INVENTORY.md` rows.
- (d) Move the Connect stream framing helpers from `e2e/trader/stream-reconnect.spec.ts:14-44` to
  `e2e/helpers/connectStream.ts`.
- (e) Rewrite `e2e/trader/alert-stream.spec.ts`; `:31-45` and `:69-82` encode the old behaviour
  (recon.md:76).
- (f) Every per-spec scenario registers both stubs, with state in the test closure:
  - **ListAlerts:** the stored unread set plus every already-streamed alert, minus the ids received
    in `MarkAlertRead` bodies.
  - **StreamAlerts:** a `**/NotifyService/StreamAlerts` route built on the (d) helpers. No branch
    calls `route.continue()`, because the default mock streams `ALERT_STREAM_ALL` on each connect
    (`e2e/mock-backend.ts:677-679`).
    - @AC-3, @AC-4, @AC-10: every attempt is held on a never-released promise, so the starting
      badge equals the stored count.
    - @AC-5, @AC-9: attempt 1 awaits a test gate, then `fulfillStream(route, [alert])`; later
      attempts are held. In @AC-9 the ListAlerts stub adds the streamed alert only after release.
  - **Disconnected indicator.** A fulfilled body ends cleanly, so `useReconnectingStream` sets
    `disconnected` (`src/hooks/useReconnectingStream.ts:61-63`) and clears it once the held
    reconnect has been open for `STREAM_STABLE_MS` (`:41-44`). These scenarios never assert its
    absence. They locate the bell with `getByRole('button',{name:/^Alerts/})` and use
    `expect.poll` or auto-wait. A poll that waits for the indicator to clear needs a timeout above
    3 s plus the backoff.
- (g) `stream-reconnect.spec.ts:105-133` is unchanged in intent.
- **FR-8 under the default mock.** The bell shows 5 while the inbox shows 2 unread, so FR-8
  agreement is asserted only under per-spec stubs.
- **@AC-10 fixtures.** Two stored unread alerts titled "Backfill 9f8e7d6c failed" and "Daily loss
  limit reached", with `INVENTORY.md` rows. Flow: stream held, Clear all, "No alerts", no badge,
  both read on the Notifications page.
- **Vitest on `drainUnread`.** More than 50 alerts, cap, error, cutoff, phantom ids, and 50
  newer-than-cutoff rows on top of eligible rows giving `capped`.

**Feature 344 coordination — recorded, not built.**

- The unread fetch does not move onto a shared react-query key in 339 (R-13).
- What costs nothing is in place: pure helpers in `alertShared.ts` and the single
  `refreshUnread()`, which 344 can swap for a `useQuery` / `invalidateQueries` pair.
- Constraint for 344: the value under `ALERT_UNREAD_COUNT_KEY` is derived from the merged,
  de-duplicated unread list (D-5), never the server `unreadCount` plus a streamed delta (R-5).
  Mark-read and Clear all must invalidate it.

**Spec amendments owed before `/sdd-spec` (D-25).**

- Remove the "mark all read" exclusion from `product-spec.md` § Out of Scope (`product-spec.md:123`).
- Add FR-10: "Clear all marks every unread alert created at or before the newest listed alert as
  read (persisted), up to 1000 per click; on cap or error the drawer shows a notice and lists what
  remains."
- Add @AC-10 to `acceptance.feature`.

**Operator text behind the Clear all scope.** Verbatim: "8. Choose the one with less friction".
It is read as answering the round-3 gate questions on Clear all scope and confirm behaviour:
one click marks every unread alert read on the server, with no confirm dialog and no undo. The
operator approved the round-4 design on that reading (context.md, 2026-11-15).

## Rejected Alternatives

- `R-1` Truncating or ellipsizing StatTile values — rejected because FR-1 needs the whole value drawn inside its tile.
- `R-2` Compact formatting for all large-USD symbol-page tiles — rejected because it is out of scope beyond the FR-3 overflow guard.
- `R-3` Switch option (a), `@theme`/`@utility` blocks — rejected because of a possible collision with the feature-307 theme check.
- `R-4` Switch option (b), global `@custom-variant`, without an operator ruling — rejected because it changes checkbox, field and questionnaire rendering, which the operator decision does not sanction.
- `R-5` Badge driven by the server `unreadCount` plus a streamed delta — rejected because FR-8 would not hold by construction; list length is simpler.
- `R-6` Window `CustomEvent` for cross-page alert sync — rejected as YAGNI; FR-7 is met by refetch-on-open.
- `R-7` Exporting a class constant from `switch.tsx` for the guard test — rejected because it changes the shadcn file shape.
- `R-8` A stateful shared mock that records which alerts it has streamed — rejected because module-level mock state leaks across parallel specs (fails.md:1304); a stateless union with `ALERT_STREAM_ALL` is cheaper.
- `R-9` Break hints returned from `money.ts` (`fmtUsdParts`) instead of `<wbr/>` inside StatTile — rejected because every call site would carry the break logic.
- `R-10` A full-value sub line under the compact Market cap — rejected because it brings the overflow back.
- `R-11` A Clear all that only hides rows locally, beside per-row mark-read — rejected because hidden rows stay unread on the server, so refetch-on-open brings them back and the badge, drawer and inbox disagree (FR-8).
- `R-12` A new notify RPC to mark all unread alerts read — rejected because the notify contract is out of scope and a client loop over the existing `ListAlerts` and `MarkAlertRead` achieves the same.
- `R-13` Moving the unread fetch onto a shared react-query key inside feature 339 — rejected because it would replace the seq-guard and prune mechanics and fix the key's value shape before feature 344 defines it; the `refreshUnread()` seam costs nothing instead.
- `R-14` A config key for the drain batch cap — rejected because the operator did not ask for a knob (C-18); an unexported code constant is enough.
- `R-15` Any per-spec `StreamAlerts` stub branch that calls `route.continue()` — rejected because the default mock streams `ALERT_STREAM_ALL` on each connect, which breaks the scenario starting badge counts.

## Open Risks

Target steps are named by build-order step (1-5) until `/sdd-spec` numbers them.

- [ ] Clear all bulk-writes up to 1000 read marks with one tap and no undo, including alerts beyond the 50 shown. The scope rests on a relayed reading of the operator's "less friction" (O-24). The unlocked fallback is listed-only with a "showing 50 of N" line — to be addressed at `/sdd-spec` (FR-10 wording) and step 5.
- [ ] O-12 is open: no operator answer is mapped with confidence to whether checkbox, field and questionnaire get the same `data-state` fix. This design leaves them unchanged (R-4) — to be confirmed with the operator before `/sdd-spec`.
- [ ] O-25 is open: the proposer never confirmed the four adversary drain corrections folded in here (short-page stop rule, `muted` capped notice, one `compareCreatedAt`, unexported cap with the load note). The operator approved the design with them — to be addressed at step 5.
- [ ] A drain can stop partway on a cap or an error, leaving some alerts read and some unread. Accepted, and shown through a notice — step 5.
- [ ] A worst-case drain queues about 60 queries on notify's single DB connection, alongside `EmitAlert` inserts for all users — step 5; do not raise the cap without revisiting.
- [ ] With 50 or more alerts arriving after the click, the drain returns `capped` and the user must click again — step 5.
- [ ] The inbox "Mark all read" stays bounded to its loaded rows (fails.md:2774), so the drawer and the inbox differ on purpose — step 5.
- [ ] The brief disconnected indicator after a fulfilled stub stream has not been run. Polls in @AC-5/@AC-9 need timeouts above `STREAM_STABLE_MS` (3 s) plus the backoff — step 5 e2e.
- [ ] Pruning can wrongly drop an unread alert if notify ever runs with read replicas or replication lag — step 5.
- [ ] The default e2e badge becomes 5 on every trader `AppShell` page, and a full Playwright run in the execute sandbox is impractical — step 5 e2e; scope and pre-warm the run.
- [ ] `renderToStaticMarkup` of the Radix Switch in the Vitest node environment is assumed to emit `data-state`; it has not been run — step 4.
- [ ] FR-8 holds only up to 50 unread alerts in the drawer list (D-5) — step 5.
- [ ] The checked switch thumb colour depends on the OS colour scheme — step 4.
- [ ] The six other StatTile consumers were not run; a wrapped value may change tile height there — step 1.
- [ ] The wording "No strategy", "Valuation", "Quality & risk", "Clear all" and the cap notice text is not operator-confirmed — steps 2, 3 and 5.
- [ ] Peer `fix-fundamentals-roe-unit` edits `page.tsx:1095`; a textual merge conflict is expected — step 2.
- [ ] Feature 344 must adopt the recorded `ALERT_UNREAD_COUNT_KEY` constraint. Feature 339 lands first and only leaves the `refreshUnread()` seam — feature 344 design.
- [ ] The spec amendments (Out of Scope line, FR-10, @AC-10) are not yet made — before `/sdd-spec`.

## Constitution Rules Touched

No Floor (`F-*`) item is touched; the round-4 adversary verdict was SOUND with no Floor breach.

- `P-02` — honored by: every proposer/adversary exchange was mediated through the synthesized state; the four adversary corrections the proposer never saw confirmed are recorded as O-25.
- `P-03` — honored by: nothing invented. The Clear all scope, the O-12 question and the unconfirmed wording are stated as open risks, and the operator text is quoted verbatim.
- `C-10` — honored by: the `StatTile` change affects seven consumers, so the helper stays private and gets a render test; `fmtUsd` is left unchanged for its other callers.
- `C-12` — honored by: new fixtures (empty-strategy opportunity, timestamped alerts, the two @AC-10 alerts) live in `e2e/fixtures/` with `INVENTORY.md` rows; stateful stubs are per-spec with closure state.
- `C-13` — honored by: no inline mock data; unit tests take injected `list` / `mark` functions.
- `C-15` — honored by: FR-10 is added with @AC-10 in `acceptance.feature` before `/sdd-spec`; every FR keeps at least one scenario.
- `C-16` — honored by: the three durable alert rules and the feature-220, feature-155 and feature-110 rules are preserved (next section).
- `C-17` — honored by: per-row buttons have distinct accessible names, Clear all's name is its visible text, errors use `CardNotice variant="error"`, and the partial-success notice uses `muted` so it is not announced as an alert.
- `C-18` — honored by: one `compareCreatedAt`, the stream helpers moved to one shared file, no config key for the cap, no shared mark-read hook, no react-query move.

## Business Rules Touched (C-16)

Existing durable rules (recon.md:55-62). None is changed.

- PRESERVE `@AC-9 @feature-270` "A dropped alert stream is shown to the user and reconnects" (`services/xstockstrat-ui/acceptance/fix-ui-trader-feedback.feature`) — not regressed by: the `useReconnectingStream` wiring is untouched (D-8), the shared mock returns the streamed alerts as unread so prune-on-fetch keeps them (D-16), and `stream-reconnect.spec.ts:105-133` is unchanged in intent. Not covered by an operator decision; it must stay green.
- PRESERVE `@AC-5 @feature-271` "The alert stream is not cut off by the unary default deadline" (`services/xstockstrat-ui/acceptance/fix-ui-transport-hardening.feature`) — not regressed by: the drawer does not change how it opens the stream. Not covered by an operator decision; it must stay green.
- PRESERVE `@AC-6 @feature-203` "The notifications inbox shows level, module, body, and unread state" (`services/xstockstrat-ui/acceptance/alert-read-unread-persistence.feature`) — not regressed by: `AlertInbox` is untouched; drawer marks persist through the same `MarkAlertRead` RPC. Not covered by an operator decision; it must stay green.
- PRESERVE `@AC-1 @feature-220` "A stalled fundamentals request resolves to the error state instead of loading forever" (`services/xstockstrat-ui/acceptance/fix-trader-position-fundamentals.feature`) — not regressed by: the loading and error branches stay verbatim.
- PRESERVE `@AC-10 @feature-155` and `@AC-9 @feature-155` (`services/xstockstrat-ui/acceptance/watchlist-opportunity-signal-cues.feature`) — not regressed by: a row with a strategy id keeps it as the label, and the mobile `SectionRenderer` path is not shared with the chip label.
- PRESERVE `@AC-3 @feature-110` and `@AC-8 @feature-110` (`docs/sdd/business-rules/platform.feature`) — not regressed by: the OrderForm (`page.tsx:430-435`) is not edited.

This feature's own scenarios (`acceptance.feature`), as classified in the round-4 synthesis. Every
CHANGE is signed off by the operator decisions recorded in context.md on 2026-11-15.

- CHANGE `@AC-1` "A large market cap fits its Fundamentals tile at mobile width" — signed off by user @ 2026-11-15 (context.md: Fundamentals full redesign; abbreviation acceptable).
- CHANGE `@AC-2` "A strategy-less opportunity chip is labelled by its source" — signed off by user @ 2026-11-15 (context.md: chip labelled from the row's source, never the ticker).
- CHANGE `@AC-3` "The Alerts drawer shows a stored unread alert that was not streamed" — signed off by user @ 2026-11-15 (context.md: drawer shows unread only, stored plus live).
- EXTEND `@AC-4` "Marking an alert read in the drawer clears it and the badge" — new case added: per-row mark-read beside Clear all (context.md: design-gate decision, both actions).
- CHANGE `@AC-5` "A streamed alert raises the badge without a reload" — signed off by user @ 2026-11-15 (context.md: badge refreshes on mark-read and on a streamed alert).
- CHANGE `@AC-6` "A checked switch is displayed on" — signed off by user @ 2026-11-15 (context.md: the shared switch renders checked when checked).
- PRESERVE `@AC-7` "An unchecked switch is displayed off" — not regressed by: the unchecked variants are rewritten together with the checked ones.
- EXTEND `@AC-8` "A long value fits its tile in the symbol page's other stat grids" — new case added: the same guard on the position and position-risk grids (context.md: other stat grids get the same overflow guard).
- CHANGE `@AC-9` "An alert that is both stored and streamed appears once" — signed off by user @ 2026-11-15 (context.md: unread only, stored plus live; badge is the merged list).
- EXTEND `@AC-10` (new) "Clear all marks every unread alert read, persists, and empties the drawer and badge" — new case added: the capped drain (context.md: design-gate decisions on both actions and "less friction", round-4 approval).
