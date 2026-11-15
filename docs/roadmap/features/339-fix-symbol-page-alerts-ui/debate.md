# Debate Register: fix-symbol-page-alerts-ui

**State**: in-debate
**Mode**: full
**Rounds run**: 4 (round numbers continue across runs; the mode's 2–5 / 1 bounds count this run only)

## Rounds

| Round | Date | Run by | +D | +R | O closed | +O | Petitions | Progress |
|---|---|---|---|---|---|---|---|---|
| 1 | 2026-11-15 | /sdd-batch | 8 | 7 | 0 | 12 | 0 | yes |
| 2 | 2026-11-15 | /sdd-batch | 6 | 3 | 8 | 4 | 0 | yes |
| 3 | 2026-11-15 | /sdd-batch | 5 | 2 | 6 | 7 | 1 | yes |
| 4 | 2026-11-15 | /sdd-batch | 6 | 3 | 8 | 2 | 0 | yes |

## Settled Decisions

<!-- Status: settled → superseded by D-m (only after a user-approved REOPEN) -->
| ID | Round | Decision | Evidence | Status |
|---|---|---|---|---|
| D-1 | 1 | The overflow guard is fixed once in StatTile with a wrap guard on the value div; no per-grid markup change. | StatTile.tsx:19-31; page.tsx:842,901,1120; all consumers use grid-cols-N (minmax(0,1fr)), confirmed by the adversary | settled |
| D-2 | 1 | Compact USD is a new fmtUsdCompact beside fmtUsd, used only for Market cap; fmtUsd is unchanged. | money.ts:4-28; page.tsx:1089; operator decision allows abbreviation | settled |
| D-3 | 1 | The chip label is a single function opportunityChipLabel in opportunityShared.tsx: strategyId, else humanized source, else a fixed placeholder; never the symbol; no label map. | page.tsx:444; operator decision on strategy-less chips; adversary concurs (C-18) | settled |
| D-4 | 1 | The switch fix is option (c): data-[state=checked]/data-[state=unchecked] in switch.tsx only, with an // app-specific marker and a regression-guard test. | switch.tsx:20,27; the operator decision binds only the switch; adversary concurs | settled |
| D-5 | 1 | The drawer badge is the length of the merged, de-duplicated unread list (stored plus streamed), with the 9+ display kept and the 50-alert bound accepted. | AlertStream.tsx:48,74; FR-8; adversary concurs after weighing the unreadCount alternative | settled |
| D-6 | 1 | The drawer refetches unread alerts on mount and on each open; there is no shared store or cross-page event. | No shared store exists between AlertStream and AlertInbox (recon); adversary rejects the CustomEvent as YAGNI | settled |
| D-7 | 1 | The local-only "Clear all" is removed; per-row mark-read follows the AlertInbox pattern. | AlertStream.tsx:83-92; AlertInbox.tsx:42-53; operator decision (drawer offers mark-read) | reopened @ round 3 (operator steer) |
| D-8 | 1 | The useReconnectingStream wiring is unchanged. | AlertStream.tsx:35-46; PRESERVE rules @AC-9 @feature-270 and @AC-5 @feature-271 | settled |
| D-9 | 2 | The Fundamentals card is two labelled four-tile groups (Valuation: Market cap, P/E, P/B, EPS; Quality & risk: ROE, Debt/Equity, Beta, Div yield) plus an as-of/source provenance footer, built only from existing fields, with no sub lines. | page.tsx:1099-1128,1074-1076; marketdata.proto:240,242; operator decision (full redesign); adversary confirms the footer is grounded and raises only header style | settled |
| D-10 | 2 | The mid-digit mitigation is <wbr/> after each comma for string values, in a helper private to StatTile.tsx, with wrap-anywhere as the last resort; min-w-0 is not added. | StatTile.tsx:21-31; package.json:80 (Tailwind 4.3.3); adversary accepts once tested | settled |
| D-11 | 2 | The dark: compounds in switch.tsx:27 are rewritten along with the bare forms; e2e for @AC-6/@AC-7 is geometry-only (bounding boxes). | switch.tsx:20,27; layout.tsx:26 (dark: is prefers-color-scheme); adversary: rewriting is right and harmless | settled |
| D-12 | 2 | The stored fixture ALERT_LIST_002 is retitled so stored and streamed alerts have distinct titles; assertions are not id-scoped. | e2e/fixtures/alerts.ts:19-26,56-63; stream-reconnect.spec.ts:131; alert-stream.spec.ts:55 | settled |
| D-13 | 2 | A failed unread fetch keeps the previous list and badge and shows CardNotice variant=error; mark-read errors use the same notice and the row stays; mark-read buttons carry aria-label "Mark read: <title>". | CardNotice.tsx:5-17; AlertInbox.tsx:42-53; C-17; adversary raised no objection | settled |
| D-14 | 2 | The Connect stream framing helpers move from stream-reconnect.spec.ts to e2e/helpers/connectStream.ts for reuse by alert-stream.spec.ts. | e2e/trader/stream-reconnect.spec.ts:14-44; DRY guard rail; second consumer exists | settled |
| D-15 | 3 | Supersedes D-7: the drawer keeps per-row mark-read and has a Clear all that marks alerts read server-side through the existing MarkAlertRead RPC, with no new RPC or contract change; its scope (drain or listed-only) and confirm behaviour are settled by the operator at the gate. | Operator decision (design gate, 2026-11-15): both per-row and clear-all; notify.proto:116-119; notifyServiceImpl.ts:211-218; AlertStream.tsx:83-92; adversary concurs that persisting is the right reading | settled |
| D-16 | 3 | With unreadOnly set, the shared e2e mock returns the stored unread rows plus ALERT_STREAM_ALL as unread, statelessly; the default bell badge is 5 before and after opening the drawer, and FR-8 agreement is asserted only under per-spec stubs. | e2e/mock-backend.ts:677-693; alert-stream.spec.ts:31-45,84-99; stream-reconnect.spec.ts:105-133; notifications.spec.ts:114; operator steer; adversary accepts | settled |
| D-17 | 3 | Each per-spec stateful ListAlerts stub returns the stored unread set plus every already-streamed alert, minus the ids received in MarkAlertRead bodies, with state held in the test closure. | notifyServiceImpl.ts:82-124 (insert before broadcast); e2e/accounts/notifications.spec.ts:93,117-120; operator steer; adversary: closure state does not violate fails.md:1304 | settled |
| D-18 | 3 | The mergeUnread comparator maps createdAt.seconds through Number(); a missing timestamp sorts first as a fixture tolerance only, with a Vitest case mixing missing and present timestamps. | notifyServiceImpl.ts:116; protobuf-es bigint Timestamp; adversary accepts O-7 as addressed | settled |
| D-19 | 3 | Fundamentals group headers use a text-xs font-medium text-muted-foreground line, and sm:grid-cols-4 is recorded as sanctioned by the operator's full-redesign decision. | page.tsx:842,1099-1128; operator decision (full redesign); adversary accepts O-13 as addressed | settled |
| D-20 | 4 | Clear all scope is the capped drain: drainUnread in alertShared.ts loops listAlerts({unreadOnly:true, limit:50}) and markAlertRead(ids) with injected list/mark, capped at 20 batches (1000 alerts) by an unexported code constant, eligible only at or before the newest createdAt listed at click (ties included), returning done, capped or error; done only on a page shorter than the limit, and a full page with no eligible id is capped. | Operator design-gate answer "choose the one with less friction" (relayed reading); notifyServiceImpl.ts:211-218,236-257,82-124; adversary r4 short-page correction | settled |
| D-21 | 4 | Clear all has no confirm and no undo; the button's accessible name is its visible text "Clear all" with no aria-label; one shared pending flag disables Clear all and every per-row button while any mark call is in flight; every drain outcome adds markedIds to readIds and refetches; capped shows a muted CardNotice and error shows the D-13 error notice. | Operator "less friction"; AlertInbox.tsx:66-74; alert-stream.spec.ts:79 (WCAG 2.5.3); CardNotice.tsx:10-16; adversary r4 | settled |
| D-22 | 4 | Every per-spec alert scenario stubs StreamAlerts with the D-14 helpers and never calls route.continue(): @AC-3/@AC-4/@AC-10 hold every attempt; @AC-5/@AC-9 gate, deliver once, then hold; the disconnected indicator may show briefly after delivery, its absence is never asserted, and the bell is located by /^Alerts/. | mock-backend.ts:677-679; stream-reconnect.spec.ts:14-44; useReconnectingStream.ts:41-44,61-63; AlertStream.tsx:66; operator steer; adversary r4 C-16 check | settled |
| D-23 | 4 | One private compareCreatedAt in alertShared.ts serves both mergeUnread and drainUnread. | Adversary r4 (C-18 DRY); notifyServiceImpl.ts:80,100,116 (single millisecond now for stored and streamed createdAt) | settled |
| D-24 | 4 | Feature 339 does not move the unread fetch onto react-query; it keeps pure helpers and a single refreshUnread() entry point, and records for feature 344 that the ALERT_UNREAD_COUNT_KEY value is derived from the merged de-duplicated unread list and is invalidated by mark-read and Clear all. | providers.tsx:12; trader/layout.tsx:10; useBackfills.ts:50; D-5, R-5; operator steer ("if it costs nothing extra"); adversary raised no objection | settled |
| D-25 | 4 | Before /sdd-spec: the mark-all-read exclusion leaves product-spec Out of Scope, FR-10 is added with the capped-drain wording, and @AC-10 is added with two distinctly titled stored fixtures ("Backfill 9f8e7d6c failed", "Daily loss limit reached"); design.md records the default-mock bell (5) versus inbox (2) disagreement and the notify 1-connection drain load. | P-03/C-15; C-12; D-12, D-16; root CLAUDE.md Connection Pool Budget; notifyServiceImpl.ts:234-253; adversary r4 | settled |

## Rejected Alternatives (locked)

<!-- Status: locked → reopened @ round N (user, context.md <ISO>) -->
| ID | Round | Alternative | Why rejected | Status |
|---|---|---|---|---|
| R-1 | 1 | Truncating or ellipsizing StatTile values | FR-1 needs the whole value drawn inside its tile | locked |
| R-2 | 1 | Compact formatting for all large-USD symbol-page tiles | Out of scope beyond the FR-3 overflow guard | locked |
| R-3 | 1 | Switch option (a), @theme/@utility blocks | Possible collision with the feature-307 theme check | locked |
| R-4 | 1 | Switch option (b), global @custom-variant, without an operator ruling | It changes checkbox, field and questionnaire rendering, which the operator decision does not sanction | locked |
| R-5 | 1 | Badge driven by the server unreadCount plus a streamed delta | FR-8 would not hold by construction; list length is simpler | locked |
| R-6 | 1 | Window CustomEvent for cross-page alert sync | YAGNI; FR-7 is met by refetch-on-open | locked |
| R-7 | 1 | Exporting a class constant from switch.tsx for the guard test | It changes the shadcn file shape | locked |
| R-8 | 2 | A stateful shared mock that records which alerts it has streamed | Module-level mock state leaks across parallel specs (fails.md:1304); a stateless union with ALERT_STREAM_ALL is cheaper | locked |
| R-9 | 2 | Break hints returned from money.ts (fmtUsdParts) instead of <wbr/> inside StatTile | Every call site would carry the break logic | locked |
| R-10 | 2 | A full-value sub line under the compact Market cap | It brings the overflow back | locked |
| R-11 | 3 | A Clear all that only hides rows locally, beside per-row mark-read | Hidden rows stay unread on the server, so refetch-on-open (D-6) brings them back and the badge, drawer and inbox disagree (FR-8) | locked |
| R-12 | 3 | A new notify RPC to mark all unread alerts read | The notify contract is out of scope, and a client loop over the existing ListAlerts and MarkAlertRead achieves the same | locked |
| R-13 | 4 | Moving the unread fetch onto a shared react-query key inside feature 339 | It would replace the closed O-3 seq-guard and prune mechanics and fix the key's value shape before feature 344 defines it; the refreshUnread() seam costs nothing instead | locked |
| R-14 | 4 | A config key for the drain batch cap | The operator did not ask for a knob (C-18); an unexported code constant is enough | locked |
| R-15 | 4 | Any per-spec StreamAlerts stub branch that calls route.continue() | The default mock streams ALERT_STREAM_ALL on each connect, which breaks the scenario starting badge counts | locked |

## Objections

<!-- Status: open → closed @ round N (<how>) | waived @ round N (user) | reopened @ round N (user) -->
| ID | Round | Objection | Blocking | Status |
|---|---|---|---|---|
| O-1 | 1 | Fundamentals "full redesign" is narrowed to compact market cap plus guarded tiles (P-03); a concrete redesign or an operator ruling is required. | yes | closed @ round 2 (The proposal names a concrete redesign of page.tsx:1099-1128: header with stale badge, two labelled four-tile groups, provenance footer, no sub lines, eight tiles. The residual header-style point is a new non-blocking objection.) |
| O-2 | 1 | The e2e plan breaks the feature-270 reconnect test (C-16): duplicate "Order rejected" titles, incomplete spec rewrite list, and the mock unreadOnly filter must be a stated step. | yes | closed @ round 4 (StreamAlerts stubs are stated per scenario (hold every attempt for @AC-3/@AC-4/@AC-10; gate, deliver once, then hold for @AC-5/@AC-9; never route.continue()); a brief disconnected indicator is allowed and never asserted absent; stream-reconnect.spec.ts:105-133 is preserved. The adversary found no C-16 regression.) |
| O-3 | 1 | The merge rule has a fetch-ordering race; it needs sequence-guarded latest-wins, a buffer that is not blindly cleared, a marked-read id filter and a test. | yes | closed @ round 3 (Latest-wins sequence, prune instead of clear, readIds and Vitest stand from round 2; the ListAlerts stub rule (every later response includes already-streamed alerts minus marked-read ids) is now a stated step. The StreamAlerts stub gap is tracked under O-2.) |
| O-4 | 1 | The overflow root cause is misstated; min-w-0 does nothing. | no | closed @ round 2 (Root cause corrected to unbreakable mono text in minmax(0,1fr) tracks; min-w-0 dropped.) |
| O-5 | 1 | Mid-digit wrapping of money values needs a recorded mitigation inside StatTile. | no | closed @ round 2 (Mitigation recorded: <wbr/> after commas inside StatTile, wrap-anywhere as last resort.) |
| O-6 | 1 | Failed-fetch behaviour for the list and badge is unspecified; keep the previous list and use CardNotice. | no | closed @ round 2 (A failed fetch keeps the previous list and badge and shows a CardNotice error.) |
| O-7 | 1 | The createdAt sort must tolerate undefined; timestamped fixtures are needed (C-12). | no | closed @ round 3 (The comparator maps createdAt.seconds through Number(), the missing-timestamp rule is worded as a fixture tolerance, and a mixed-timestamp Vitest case is added.) |
| O-8 | 1 | Mark-read buttons need distinct accessible names; errors go through CardNotice (C-17). | no | closed @ round 2 (Per-row aria-label "Mark read: <title>"; errors go through CardNotice.) |
| O-9 | 1 | Switch: the dark: compounds decision, the renderToStaticMarkup guard, and the bounding-box/translate assertion. | no | closed @ round 2 (dark: compounds are rewritten; the guard uses renderToStaticMarkup with a regex that catches dark:-prefixed bare forms and no new export; e2e uses bounding boxes. The wrong dark-only rationale is tracked as a new non-blocking objection.) |
| O-10 | 1 | The empty-strategy fixture stays per-spec; @AC-2 assertions scope to role radio (C-12). | no | closed @ round 2 (The empty-strategy fixture is used per-spec through page.route only; @AC-2 assertions scope to getByRole('radio').) |
| O-11 | 1 | Record the accepted chip gaps: raw source on mobile SignalRow, and identical chips for same-source rows. | no | closed @ round 2 (Both chip gaps are recorded as accepted (SectionRenderer.tsx:187-188; page.tsx:443).) |
| O-12 | 1 | Operator question: do checkbox, field and questionnaire get the data-state fix? | no | open |
| O-13 | 2 | Fundamentals group headers: bare Eyebrow headers read flat against tile labels, and sm:grid-cols-4 diverges from sibling grids; pick a distinct header style and record that the operator's full-redesign decision sanctions the divergence (P-03). | no | closed @ round 3 (Group headers use a text-xs font-medium muted line distinct from tile Eyebrows; sm:grid-cols-4 is recorded as sanctioned by the operator's full-redesign decision.) |
| O-14 | 2 | The <wbr/> helper makes StatTile format-aware for 7+ consumers; keep it private and add a unit or render test (C-10/C-18). | no | closed @ round 3 (The <wbr/> helper stays private to StatTile.tsx and gets a render test.) |
| O-15 | 2 | design.md must describe AlertStream as mounted by the trader AppShell (AppShell.tsx:24), remounting per trader navigation, with no cross-segment badge claim. | no | closed @ round 3 (AlertStream is described as mounted by the trader AppShell (AppShell.tsx:24), remounting per trader navigation, with no cross-segment badge claim.) |
| O-16 | 2 | Correct the switch rationale: the app is not dark-only in Tailwind terms; dark: is prefers-color-scheme and the thumb colour stays OS-dependent (P-03). | no | closed @ round 3 (Switch rationale corrected: dark: is prefers-color-scheme (layout.tsx:26) and the thumb colour stays OS-dependent.) |
| O-17 | 3 | Clear-all scope: the listed-only limit rests on a false claim that draining needs a contract change, and repeats fails.md:2774; confirm the capped drain (cap, createdAt cutoff, end state) or keep listed-only with a "showing 50 of N" line, and put the choice to the operator (P-03). | yes | closed @ round 4 (The capped drain is confirmed: 20 batches of 50, createdAt cutoff at click with ties eligible, done/capped/error end states. The stop-rule correction is tracked as a new non-blocking objection.) |
| O-18 | 3 | Persisting Clear all with no confirm and no undo is a gate question for the operator, not an assumption (P-03). | no | closed @ round 4 (No confirm and no undo is adopted on the operator's "less friction" answer plus the inbox precedent (AlertInbox.tsx:66-74). Recording the item-8 mapping is tracked as a new non-blocking objection.) |
| O-19 | 3 | The Clear all accessible name must contain the visible text (WCAG 2.5.3, C-17); drop the aria-label or start it with "Clear all". | no | closed @ round 4 (Clear all has no aria-label; the accessible name is the visible text.) |
| O-20 | 3 | The in-flight guard must be one shared pending flag covering per-row and Clear all calls alike. | no | closed @ round 4 (One shared pending flag disables Clear all and every per-row button during any mark call.) |
| O-21 | 3 | The @AC-10 stored-unread fixtures need titles of their own, not a second "Order rejected" (D-12 spirit, C-12). | no | closed @ round 4 (The @AC-10 stored fixtures are titled "Backfill 9f8e7d6c failed" and "Daily loss limit reached", with INVENTORY.md rows.) |
| O-22 | 3 | Amend product-spec.md Out of Scope, add FR-10 worded with the chosen scope, and add @AC-10, all before /sdd-spec (P-03/C-15). | no | closed @ round 4 (The Out of Scope edit, the FR-10 wording and @AC-10 are stated and land before /sdd-spec.) |
| O-23 | 3 | Record in design.md that under the default mock the bell (5) and the inbox (2 unread) disagree, so FR-8 agreement is asserted only under per-spec stubs. | no | closed @ round 4 (design.md records that under the default mock the bell shows 5 and the inbox 2 unread, so FR-8 agreement is asserted only under per-spec stubs.) |
| O-24 | 4 | Record in context.md which gate question the operator's item 8 ("Choose the one with less friction") answered, with the verbatim text and the reading (capped drain, no confirm, no undo), and confirm once at the gate; the fallback is listed-only with "showing 50 of N" (P-03). | no | open |
| O-25 | 4 | The proposer must confirm the adversary's four drain corrections folded into the synthesis: short-page termination with the 50-newer Vitest case, variant="muted" for the capped notice, a single compareCreatedAt, and an unexported cap with the notify pool-load note in design.md (P-03/C-17/C-18). | no | open |

## Reopen Petitions

<!-- Verdict: dropped (evidence not new — already on record at <ID>) | pending user | user reopened | user declined -->
| ID | Round | Target | New evidence | Verdict |
|---|---|---|---|---|
| P-1 | 3 | D-7 | Proposer: the operator ruled at the design gate (2026-11-15), after D-7 was settled in round 1, that the drawer offers both a per-row mark-read and a clear-all action and that removing Clear all outright is not accepted. MarkAlertReadRequest.alert_ids is repeated (notify.proto:118), so a persisting clear-all needs no contract change. The adversary assessed the evidence as new. | pending user |
