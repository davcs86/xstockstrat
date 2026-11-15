# Recon: fix-symbol-page-alerts-ui

**Created**: 2026-11-15
**From**: product-spec.md
**Tree**: feature/fix-symbol-page-alerts-ui@66b55f3b0 ⊇ origin/main-dev@67dcfc11a (discovery digests arrived `Checkout: UNSTAMPED`; every `path:line` below was re-grepped on this tree)
**Affected services**: `xstockstrat-ui`

---

## Objective

Fix four SEV-3 display defects in `xstockstrat-ui`: the Fundamentals card overflowing at mobile
width (FR-1..FR-3, with a full card redesign and the same guard on the page's other stat grids), a
strategy-less opportunity chip labelled with the ticker (FR-4), a header Alerts drawer that never
shows stored unread alerts and a badge that never refreshes (FR-5..FR-8), and the shared switch
rendering unchecked while checked (FR-9). No proto, migration or config change: the notify RPCs the
drawer needs already exist and are already exposed by the trader BFF.

## Codebase Map

- **`xstockstrat-ui`** (Next.js, Tailwind 4, shadcn style `radix-rhea` — `services/xstockstrat-ui/components.json`)
  - Entry point (drawer + badge): `AlertStream` — `services/xstockstrat-ui/src/components/trader/AlertStream.tsx:13`; mounted globally in the header at `services/xstockstrat-ui/src/components/trader/AppShell.tsx:5,24`
  - Entry point (symbol page): `services/xstockstrat-ui/src/app/trader/positions/[symbol]/page.tsx`
  - Handler/servicer (BFF): `NotifyService` on the trader BFF — `streamAlerts` `services/xstockstrat-ui/src/lib/traderBff.ts:97`, `listAlerts` `:104`, `markAlertRead` `:115`. **Settles the open C-14 item from the product-spec review: no BFF route registration is needed.**
  - Browser client: `notifyClient` on the `/trader/api` transport — `services/xstockstrat-ui/src/lib/browserClients/notifyClient.ts:5`
  - Last migration: none (UI owns no migrations for this change)
  - Config-read pattern: none used
  - Other key symbols:
    - Badge source: one-shot `listAlerts({ limit: 1 })` reading only `unreadCount` — `AlertStream.tsx:19-32`; `const unread = unreadCount;` — `:48`
    - Drawer list: `alerts` state fed only by `streamAlerts`, deduped on `alertId`, capped at 50 — `AlertStream.tsx:35-46`; `hasHighSeverity` from the streamed list only — `:49`; "Clear all" is `setAlerts([])` (local only) — `:83-92`; "No alerts" empty state — `:97-101`; disconnected indicator `data-testid="alert-stream-disconnected"` — `:53-60`
    - Chip label: `label: o.strategyId || o.symbol` — `page.tsx:444` (panels built `:442-446`, rendered by `SymbolPanelGroup` — `services/xstockstrat-ui/src/components/trader/SymbolPanelGroup.tsx:47-49`)
    - Row source field: `Opportunity.source = 8`, `strategy_id = 7`, `provenance = 11` — `packages/proto/analysis/v1/analysis.proto:610,611,614`; already read as `opportunity.source` at `page.tsx:1001`
    - `FundamentalsSection` — `page.tsx:1084-1129`: `Market cap` via `fmtUsd(f.marketCap)` `:1089`; loading text `:1113`; error/no-data text `:1114-1118`; grid `grid-cols-2 … sm:grid-cols-4` of `StatTile size="md"` `:1120-1124`
    - Other stat grids: position stats `page.tsx:842-846…` and position-risk `:901-…`, both `grid-cols-2 … sm:grid-cols-3` of `StatTile size="md"`
    - `StatTile` — `services/xstockstrat-ui/src/components/shared/StatTile.tsx:5-36`: tile `border-r border-border px-4 py-3 last:border-r-0` `:19`; value `font-mono font-semibold tabular-nums`, `text-2xl`/`text-xl` `:22-24`. No `min-w-0`, truncation or wrap guard.
    - `fmtUsd` (full precision, 2 decimals), `fmtSignedUsd`, `fmtPct`, `pnlClass` — `services/xstockstrat-ui/src/lib/money.ts:4-28`. No compact form exists.
    - Shared switch — `services/xstockstrat-ui/src/components/ui/switch.tsx`: Root class string `:20`, Thumb `:27`, both keyed on `data-checked:` / `data-unchecked:` / `data-disabled:`. Consumers: `src/app/accounts/notifications/PushToggle.tsx:4,147-149`, `src/app/config-ui/fundamentals-scan/page.tsx:8`, `src/app/insights/signal-sources/page.tsx:10`.
    - Notify server behavior the drawer relies on (read-only reference, not changed): `listAlerts` default limit 50, `unread_only` filter, `ORDER BY a.created_at DESC`, `unread_count` is the uncapped per-user total — `services/xstockstrat-notify/src/grpc/notifyServiceImpl.ts:231,240-241,245-253`; `streamAlerts` is live-only (registers a subscriber, no replay of stored alerts) — `:154-181`; the alert row is inserted before it is broadcast — `:83,121`.

## Patterns to REUSE

- Drawer mark-read + refresh → reuse the Notifications inbox pattern: `notifyClient.markAlertRead({ alertIds })` then `refetch()` — `services/xstockstrat-ui/src/app/accounts/notifications/AlertInbox.tsx:24-36,42-53`; it reads `res.alerts`, `res.unreadCount`, `a.read` (`:28-30,55`).
- Unread-only stored list → existing request field `ListAlertsRequest.unread_only = 5` and response `unread_count = 3` — `packages/proto/notify/v1/notify.proto:107,113`; `Alert.read = 13` — `:57`; `MarkAlertReadRequest` — `:116`. No `unreadOnly` caller exists in `src/` yet.
- Live stream + reconnect + disconnected indicator → keep `useReconnectingStream` exactly as wired at `AlertStream.tsx:35-46` (it carries two PRESERVE rules below).
- Severity rendering → `severityLabel` / `severityVariant` from `src/lib/alertShared.ts` (used at `AlertStream.tsx:110-111` and `AlertInbox.tsx:5`).
- Overflow guard for FR-1/FR-2/FR-3 → fix `StatTile` once (`StatTile.tsx:19-31`); all three symbol-page grids already render it, so no per-grid markup is needed. The Fundamentals card already uses the same label-above-value tile grid as the other stat grids (`page.tsx:1120-1124`), so the FR-2 "redesign" starts from an already-shared presentation.
- Compact USD (optional per operator decision) → add to `src/lib/money.ts` beside `fmtUsd`; do **not** copy the local `fmtUsd` at `src/components/insights/PerformanceDashboard.tsx:46` (DRY guard rail).
- Mobile overflow assertion → `services/xstockstrat-ui/e2e/mobile-overflow.spec.ts` already sweeps `/trader/positions/AAPL` (`:34`); `scrollWidth` checks also exist in `e2e/trader/positions.spec.ts`.
- Test data (C-12/C-13) → `e2e/fixtures/alerts.ts` (`ALERT_READ` `:76`, `ALERT_UNREAD` `:82`, `ALERT_LIST_WITH_READ_STATE` `:94`, `MOCK_UNREAD_COUNT = 2` `:95`, `ALERT_STREAM_ALL` `:35`), `e2e/fixtures/fundamentals.ts` (`FUNDAMENTALS_AAPL`, `marketCap: 3.02e12` `:13-15`), `e2e/fixtures/positions.ts`, `e2e/fixtures/opportunities.ts`; catalog `e2e/fixtures/INVENTORY.md`.
- Stateful mark-read in e2e → per-page `page.route()` stubs, as `e2e/accounts/notifications.spec.ts:93,117-120` does for `MarkAlertRead` (ledger insight: stateful mocks backing parallel specs must be request-scoped, not shared mock-backend state).
- Shadcn primitive tests → `src/components/ui/switch.test.ts` exists but is a presence-only test ("Switch has no app-specific variant"); the `// app-specific` re-apply convention and its mechanical guards are documented for `button`/`badge` cva variants and `sidebar.tsx` (`services/xstockstrat-ui/CLAUDE.md:51-54`).

## Existing Business Rules (preserve / extend)

- **PRESERVE** `@AC-6 @FR-5 @FR-6 @feature-203` "The notifications inbox shows level, module, body, and unread state" (`services/xstockstrat-ui/acceptance/alert-read-unread-persistence.feature`) — the /accounts/notifications inbox shows level, module, body, an unread indicator and an unread-count badge. The drawer and badge changes must keep the inbox format and agree with it (FR-8). Drawer mark-read must persist as read here (FR-6).
- **PRESERVE** `@AC-9 @FR-2 @regression @feature-270` "A dropped alert stream is shown to the user and reconnects" (`services/xstockstrat-ui/acceptance/fix-ui-trader-feedback.feature`) — the disconnected indicator and live delivery without reload must survive the drawer rework (FR-5/FR-7).
- **PRESERVE** `@AC-5 @FR-1 @regression @feature-271` "The alert stream is not cut off by the unary default deadline" (`services/xstockstrat-ui/acceptance/fix-ui-transport-hardening.feature:59-64`) — the streamAlerts connection stays open and delivers the next alert. Applies if the drawer changes how it opens the stream. (Tags read from the file; the digest had left them unverified.)
- **PRESERVE** `@AC-1 @regression @feature-220` "A stalled fundamentals request resolves to the error state instead of loading forever" (`services/xstockstrat-ui/acceptance/fix-trader-position-fundamentals.feature`) — the redesigned Fundamentals card (FR-2) must keep the error state "No fundamentals data for <SYM>" and never show an endless "Loading fundamentals…".
- **PRESERVE** `@AC-10 @FR-4 @feature-155` "Mobile Opportunities shows the strategy, source, and expiry tags" (`services/xstockstrat-ui/acceptance/watchlist-opportunity-signal-cues.feature`) — rows with a strategy id keep the strategy id as the label. FR-4 only changes the empty-strategy-id label on the symbol-page chip row.
- **PRESERVE** `@AC-9 @FR-4 @feature-155` "Mobile Opportunities groups signals by symbol" (`services/xstockstrat-ui/acceptance/watchlist-opportunity-signal-cues.feature`) — guard only. Re-grep shows the chip label is **not** shared with that path: `page.tsx:444` feeds `SymbolPanelGroup`, while `src/components/mobile/SectionRenderer.tsx:187-188` renders `s.strategyId` on its own.
- **PRESERVE** `@AC-3 @FR-2 @feature-110` and `@AC-8 @FR-5 @feature-110` (`docs/sdd/business-rules/platform.feature`) — the symbol-page OrderForm blank-quantity auto-sizing path. Page-level guard: the stat-grid, Fundamentals and chip edits must not disturb the OrderForm (`page.tsx:430-435`). The digest did not verify the first tag line; re-read before quoting in design.md.
- No CHANGE or EXTEND is proposed. No existing durable `@AC` asserts the Alerts drawer contents, the bell badge refresh, the market-cap formatting, the empty-strategy chip label or the shared switch rendering (a grep of all `services/*/acceptance/*.feature` and `platform.feature` for the bell, "Clear all" and stream-length wording found nothing). FR-1..FR-9 add new guarantees.

## Dependencies

- Proto/RPC: none changed. Existing and used as-is: `ListAlerts` / `StreamAlerts` / `MarkAlertRead` (`packages/proto/notify/v1/notify.proto:18,24,28`), fields `Alert.read = 13` (`:57`), `unread_only = 5` (`:107`), `unread_count = 3` (`:113`).
- Migration: none
- Config keys: none
- Inter-service edges: none new (existing ui → notify gRPC via the trader BFF)
- New env vars / ports: none

## Risks / Not-found

- **Switch root cause is wider than `switch.tsx` (design fork).** Radix sets `data-state="checked|unchecked"` and `data-disabled=""` (verified in `@radix-ui/react-switch@1.3.7` `dist/index.mjs:104-105,177-178,270-272`). The `data-checked:` / `data-unchecked:` variants that map onto `data-state` are `@custom-variant`s shipped in the `shadcn` package's `dist/tailwind.css` (`:28-86`), and `src/app/globals.css` imports only `tailwindcss` and `tw-animate-css` (`:1-2`) — it has no `shadcn/tailwind.css` import and no `@custom-variant` anywhere in `src/`, and `git log -S` shows it never did. So Tailwind compiles these as bare attribute-presence variants that never match. The same unmapped variants are used elsewhere: `data-checked` in `ui/checkbox.tsx:14`, `ui/field.tsx:100`, `ui/questionnaire.tsx:103-124`; `data-open` in 9 files, `data-closed` in 8, `data-disabled` in 6, `data-active` in 2, `data-horizontal` in 2, `data-vertical` in 3. Options for the debate: (a) import `shadcn/tailwind.css` (fixes the cause, changes rendering across all those primitives, and that file also brings `@theme`/`@utility` blocks whose interaction with the feature-307 theme check is unverified); (b) declare only the `data-checked`/`data-unchecked` custom variants in `globals.css` (also changes checkbox/field/questionnaire); (c) rewrite only `switch.tsx` to `data-[state=…]` with an `// app-specific` marker (smallest, but a `shadcn apply` overwrites it and the checkbox stays as-is). The operator decision binds only the switch; anything beyond it is scope the operator has not approved — ask, do not assume.
- **Not verified in a browser**: whether the checkbox is visibly wrong today (it also has `aria-checked` styling paths). Not run; read from code only.
- **Existing e2e tests encode the old drawer behavior and will need rewriting**, not just extending: `e2e/trader/alert-stream.spec.ts:31-45` asserts the badge stays at the server count (2) while the mock stream delivers 3 alerts — FR-7 now requires a streamed alert to increment the badge; `:69-82` asserts "Clear all" empties a local feed. Neither is a promoted durable rule, but the first cites feature 203 AC-2 in its title; design must say what replaces the "badge is per-user server truth, not stream length" intent (a streamed alert that is also in the stored unread list must count once — @AC-9).
- **Mock backend gaps**: `e2e/mock-backend.ts:685-688` returns the same list and `unreadCount` regardless of `unreadOnly`; `markAlertRead` (`:691-693`) is a no-op; `streamAlerts` always yields `ALERT_STREAM_ALL` (3 alerts) on every connect (`:677-679`), so every page that mounts the header gets three streamed alerts. AC-3/AC-4/AC-5/AC-9 need controlled stored and streamed sets — per-spec `page.route()` stubs are the ledger-preferred route; changing the shared mock's default stream would ripple into every spec that sees the bell.
- **FR-8 at scale**: `ListAlerts` caps the list at the request limit (default 50) while `unread_count` is uncapped (`notifyServiceImpl.ts:231,245-253`), so "badge number = rows the drawer lists" cannot hold past the limit; the badge also renders `9+` above nine (`AlertStream.tsx:74`). Design must state the bound (and whether `9+` stays).
- **Badge arithmetic**: there is no shared store between `AlertStream` and `AlertInbox` — they fetch independently. Marking read on the Notifications page will not update the header badge without a refetch trigger; FR-7 only names mark-read (in the drawer) and a streamed alert, so cross-component sync is a design question, not a given. Streamed `Alert`s carry no reliable per-user `read` value (broadcast object), and a reconnect can re-deliver — keep the `alertId` dedupe when merging stored + streamed.
- **`hasHighSeverity`** currently derives from the streamed list only (`AlertStream.tsx:49`); with a merged list the badge colour rule changes implicitly. `e2e/trader/alert-stream.spec.ts:58` tests it.
- **StatTile is shared**: besides the symbol page it is used by `src/components/insights/PerformanceDashboard.tsx`, `src/app/trader/portfolio/page.tsx`, `src/app/trader/positions/page.tsx`, `src/app/insights/backfills/page.tsx`, `src/app/insights/strategies/page.tsx`, `src/app/insights/signal-sources/page.tsx`. A guard added there changes all of them (C-10); none of those consumers was inspected for layouts that depend on the current unconstrained width.
- **`fmtUsd` is shared** by the trader Book screens; changing its output would alter every caller. A compact form must be a separate function or call-site choice.
- **Not found**: no source-to-label humanizer (`fundamentals` → `Fundamentals`) exists in `src/` (one inline CSS `capitalize` at `src/app/insights/strategies/[id]/page.tsx:258` only). The neutral placeholder wording for an empty source (FR-4) is still to be fixed in design. No e2e fixture has an opportunity with an empty `strategyId` (`e2e/fixtures/opportunities.ts`) — a new fixture + `INVENTORY.md` row is needed.
- **Not found**: no fixture with a 13-integer-digit market cap paired with the symbol used by the page specs beyond `FUNDAMENTALS_AAPL` (`3.02e12`); @AC-1 names `LYFT` and two specific values, and @AC-8 needs a position with cost basis `1234567890.12`.
- **Peer collision**: `344-alert-detail-page` edits the same drawer rows in `AlertStream.tsx` and owns read-on-open of the alert page; 339 lands first (context.md, sdd-review session). Keep the drawer row markup simple enough to take a link wrapper later, without building for it now.
- **fails.md traps that apply**: (1) feature 083 — a mobile-fidelity claim must be backed by an automated mobile-overflow assertion added in the same step, not a later sweep; (2) feature 126 — Tailwind v4 bare `translate-*` sets the standalone `translate` property, so the @AC-6/@AC-7 thumb-position assertion must read `getComputedStyle().translate` or a bounding box, not `transform` (the Thumb uses `translate-x-…`, `switch.tsx:27`); (3) feature 126 — a full Playwright red-before-green against `pnpm dev` is impractical in the execute sandbox (single-route compiles of ~90s); scope and pre-warm the run; (4) feature 121 — this app mixes Radix and Base UI primitives; do not infer one family's data attributes from the other.

## Recommended Scope

Advisory only — input to the grilling and `/sdd-spec`.

1. **Switch (FR-9)** — apply whichever of options (a)/(b)/(c) the design settles; replace the presence-only `switch.test.ts` with a guard on the chosen mechanism; e2e @AC-6/@AC-7 on the Push notifications card (thumb position via bounding box or `translate`).
2. **StatTile overflow guard (FR-1, FR-3)** — one change in `StatTile.tsx`; e2e @AC-8 at 384px plus the existing mobile-overflow sweep; check the six other consumers.
3. **Fundamentals card redesign (FR-2) + optional compact USD** — `FundamentalsSection` (`page.tsx:1084-1129`), a compact formatter in `money.ts` with a Vitest unit test if adopted; keep the loading/error branches (feature-220 rule); e2e @AC-1 for both example values.
4. **Chip label (FR-4)** — `page.tsx:444` plus a small source-label helper in `src/lib/` (unit-tested); new empty-strategy opportunity fixture; e2e @AC-2.
5. **Alerts drawer + badge (FR-5..FR-8)** — rework `AlertStream.tsx`: stored unread via `listAlerts({ unreadOnly: true })`, merge with the live stream on `alertId`, per-row mark-read, badge from the merged unread state; rewrite `e2e/trader/alert-stream.spec.ts` (@AC-3, @AC-4, @AC-5, @AC-9) with per-spec `page.route()` stubs; keep the feature-270 and feature-271 stream tests green.

Steps 1–4 are independent of each other; step 5 is independent of 1–4 and must land before peer feature 344.
