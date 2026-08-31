# Design: ledger-event-export

**Created**: 2026-08-31
**Rounds**: 3 (full; termination: approved — no unresolved Floor breach)
**Approved by**: user @ 2026-08-31 (design-phase gate; recorded in context.md)
**Grounded in**: recon.md

---

## Chosen Approach

**One additive server-streaming RPC + dual-channel user attribution + a dedicated-connection cursor
stream, fronted by a `/trader` BFF `route.ts`.**

### Proto (additive; `packages/proto/ledger/v1/ledger.proto`)

- New RPC `ExportEvents(ExportEventsRequest) returns (stream ExportEventsResponse)` on `LedgerService`
  (`ledger.proto:13-18`).
- `ExportEventsRequest { google.protobuf.Timestamp start = 1; end = 2; string event_type = 3; }`
  (`event_type` = comma-joined subset of `fill,signal,pnl_snapshot,config_change,alert`, empty = all).
- `ExportEventsResponse { repeated LedgerEvent events = 1; }` — **batched** (one message per DB-cursor
  batch), not one message per row, so a 1M-row export (AC-7) is thousands of messages, not millions.
- `LedgerEvent.user_id = 11` and `AppendEventRequest.user_id = 9` (next free after current max 10 / 8,
  `ledger.proto:20-46`). All additive → `buf breaking` passes (C-09).

### Migration `003` (`services/xstockstrat-ledger/migrations/`)

- Add nullable `user_id TEXT` to `ledger.events`; add `CREATE INDEX … (user_id, sequence)` for the
  per-user, sequence-ordered window scan (FR-10 + global-sequence ordering). Existing rows keep
  `user_id = NULL`. Paired `.up.sql`/`.down.sql`, `NNN = 003` (C-07). The `(event_type, occurred_at)`
  window index named in the spec is **not** added: the export scans by `user_id`+`sequence`, and
  `event_type` is a post-filter on that bounded set — a `(user_id, sequence)` index is the one that
  matters, avoiding a speculative second index (behavior 2 / DRY).

### User attribution (the FR-7/FR-10 mechanism) — see Rejected Alternatives for what lost

- **Write path (ledger, dual-channel):** the `appendEvent` handler resolves
  `user_id = req.user_id (if non-empty) else md["x-user-id"] (if present) else NULL`. This needs a
  **new server-side inbound-metadata read** — the ledger has no gRPC interceptor today
  (`index.ts:64`) and `middleware/propagation.ts` is the dead HTTP helper — so add a minimal metadata
  read in `appendEvent` (`ledgerServiceImpl.ts:28`), reusing the `x-user-id` header name convention.
- **Producer scope in THIS feature = `xstockstrat-trading` only.** Thread the owning `user_id`
  (already in scope as `order.UserId` / the resolved account owner) into the `emitLedgerEvent`
  helper (`trading.go:3607-3620`) for its user-owned events (fills, order lifecycle,
  `account.*.synced`). Rationale: trading owns **fills** — the headline "my best trades"/tax use case
  and the only event class the acceptance suite attributes per-user (AC-8/AC-11) — and it emits them
  from **background pollers** on a ctx with no `x-user-id` (`trading.go:3611` via a background
  `emitCtx`), so pure server-side stamping would leave every fill `user_id=NULL`. This is the exact
  "silent placeholder `user_id` fails invisibly" trap `fails.md` already records (2026-08-05,
  add-ikbr `account.positions.synced`) — fix before launch, do not defer.
- **All other producers (portfolio, marketdata, ingest, analysis): unchanged.** Their request-scoped,
  user-owned emits are attributed automatically by the metadata fallback (they dial the ledger with
  the propagation interceptor per C-03); their background / genuinely platform-scoped emits
  (`config_change`, marketdata ingest, backfill) land `NULL`, which is correct — those have no single
  owning user. Any additional per-user event class they own is a **named follow-up feature**
  (`021b-ledger-producer-attribution`), recorded here per C-14 (a deferral is legal only when it
  names a follow-up).

### Export path (ledger `ExportEvents`)

1. Gate on `ledger.export.enabled` (`getBool('ledger.export.enabled', true)`, `configWatcher.ts:99`);
   `false` → gRPC `FailedPrecondition` → BFF 403 (AC-10).
2. Bound the window by `ledger.export.max_window_days` (`getInt(…, 365)`, `configWatcher.ts:89`);
   over-wide → gRPC `InvalidArgument` "window exceeds ledger.export.max_window_days" → BFF 400 (AC-5).
3. Open a **dedicated `pg` `Client` outside the write pool** (EventNotifier precedent, `index.ts:56`)
   and read via a server-side cursor (`pg-cursor`) in batches, `WHERE user_id = $caller AND occurred_at
   BETWEEN $start AND $end [AND event_type = ANY($types)] ORDER BY sequence ASC`, emitting one
   `ExportEventsResponse` per batch; close the client on stream end / `cancelled` / error. Never
   borrows the `DB_POOL_MAX=1` write slot → no `AppendEvent` starvation (F-06, the documented scar).
   `WHERE user_id = $caller` auto-excludes NULL rows (`NULL = $x` is never true) → FR-10 isolation and
   historical-row exclusion fall out of the same predicate.

### Consumer surface (C-14) — `/trader`

- A new **`src/app/trader/api/ledger/export/route.ts`** GET handler (NOT a Connect-router entry —
  it must return a raw NDJSON/CSV byte stream a browser can save): `requireSession` → 401/redirect
  (AC-6, no ledger call); `backendHeaders(claims, ctx)` forwards `x-user-id`; calls
  `ledgerClient.exportEvents(...)` (`connectClients.ts:40`, server-streaming async-iterable) and pipes
  each `LedgerEvent` to a `ReadableStream` as NDJSON (`application/x-ndjson`, default) or CSV
  (`text/csv`, `format=csv`, header row per AC-2). Maps gRPC `FailedPrecondition`→403,
  `InvalidArgument`→400 (`connectCodeToHttp`, `connectClients.ts:43`).
- The **"Export events" button** (last 90 days, all types; AC-9) is added to an **existing `/trader`
  page** (the Book / portfolio area) — not a new route — so no `PLATFORM_SUBNAV`/`NAV_GROUPS`
  registration is required (sidesteps C-10(a); the route handler is not a nav surface). It triggers
  the download via `fetch` → `Blob` → object-URL anchor (a plain `<a href>` GET would bypass the
  session-cookie'd `fetch` refresh interceptor).

## Rejected Alternatives

- **Host on `/insights`** — rejected: `/insights` BFF registers no ledger service (`insightsBff.ts`),
  while `/trader` already proxies ledger reads (`traderBff.ts:112`); fills / P&L snapshots are
  account-record (Book) data, not strategy-analytics data; and the tax/audit export is an
  account-owner operation. `/insights` would need net-new ledger wiring for weaker semantic fit.
- **Attribution via server-side `x-user-id` stamping ONLY (touch no producer)** — rejected: trading's
  fills are emitted from background pollers with no inbound `x-user-id` (`trading.go:3607-3620`), so
  every fill would be `user_id=NULL` and excluded from the per-user export — the feature's own
  headline case (AC-8/AC-11) fails silently. This is the recurring "placeholder user fails invisibly"
  fail (`fails.md` 2026-08-05, add-ikbr).
- **Attribution by updating ALL five producers now** — rejected: large blast radius across Go + Python
  for many genuinely platform-scoped event types (`config_change`, marketdata ingest, backfill) that
  have no owning user; over-builds beyond what the acceptance suite requires (behavior 2). Trading is
  the only producer whose omission breaks an `@AC-*`; the rest ride the metadata fallback or a named
  follow-up.
- **Backfill `user_id` onto historical rows** — rejected by construction: `ledger.events` `deny_mutation`
  triggers block UPDATE (`001…up.sql:46-60`); backfill would violate the append-only invariant. NULL
  historical rows are excluded from per-user export (a user simply sees no pre-feature events —
  acceptable for a new capability). An admin-sees-all scope is out of scope (not in the acceptance
  suite; would need its own authz) → named follow-up if ever wanted.
- **`ExportEventsResponse` = one event per message** — rejected: 1M gRPC messages for AC-7; batching
  per cursor page is cheaper with identical streaming semantics.
- **Reuse `queryEvents` pagination for the export** — rejected: it orders by `recorded_at`
  (`ledgerServiceImpl.ts:162`), not the global `sequence` (non-deterministic tie order under
  same-timestamp inserts), buffers a full page in the write pool, and has no per-user filter.
- **Order by `recorded_at`** — rejected: `sequence` is the only globally-monotonic order
  (`ledger.proto:29`; `insights.md` 2026-08-26 §042) → required for a deterministic export (AC-1).

## Open Risks

- [ ] **Export DB-connection concurrency bound (F-06).** Dedicated-connection cursor exports each add
  one *direct* backend slot; N concurrent large exports = +N. No config key is defined for a cap.
  Resolve at `/sdd-spec`: a small fixed in-process cap (reject beyond it with `ResourceExhausted`→429)
  + a budget-table row for the ledger export connection. — to be addressed at the ExportEvents step.
- [ ] **Config seed native type (fail-open).** `ledger.export.enabled`/`max_window_days` must be
  seeded under `boolVal`/`intVal`, never `stringVal` (`fails.md:1230`, `:341`). Verify the seed +
  add a red-path test that a `false` disables (AC-10). — to be addressed at the config-key + test step.
- [ ] **`pg-cursor` (or `pg-query-stream`) dependency** must be added to `xstockstrat-ledger`; confirm
  it composes with the SSL/`Client` construction in `index.ts:26-49`. — to be addressed at the
  ExportEvents step.
- [ ] **Named follow-up `021b-ledger-producer-attribution`** for any additional per-user event class
  owned by portfolio/analysis/ingest that a later export view needs non-NULL (C-14 deferral record).

## Constitution Rules Touched

- `C-01`/`F-04` — honored: every design claim cites a `recon.md` `path:line`; no invented symbols.
- `C-03` — honored/leveraged: producers already propagate `x-user-id` on outbound `AppendEvent`
  (`trading.go:184`, `propagation.go:37-43`); the ledger reads it server-side. No producer loses
  propagation.
- `C-04` — considered: `event_type` filter stays a `string` (open, comma-joined subset), matching the
  existing `LedgerEvent.event_type` free-string (`ledger.proto:22`); not converted to an enum (out of
  scope, and event types are runtime-open).
- `C-05`/`F-07` — honored: two new `ledger.export.*` keys, `<service>.<category>.<key>`, read via
  `WatchConfig`/`ConfigWatcher`; defaults declared in the ledger CLAUDE.md; no hardcoded values.
- `C-07` — honored: migration `003_*` paired up/down, next NNN.
- `C-09` — honored: additive proto only; `buf lint`/`buf breaking` + `buf-gen` on the proto step.
- `C-10(a)` — honored by avoidance: the button lives on an existing `/trader` page, adding no new nav
  route; the export `route.ts` is not a nav surface.
- `C-14` — honored: named consumer surface = `/trader` download button + BFF route, each its own
  step; producer-attribution deferral points at a **named** follow-up, not a vague "later".
- `C-17` — honored: the button + any state reuse `ui/*` primitives and design tokens (no hardcoded
  color; `Button`, `EmptyState`/`CardNotice` for disabled/error).
- `F-01` — honored: read-only export; no edit to an applied migration; historical rows never mutated
  (immutability trigger preserved — and is why backfill is rejected).
- `F-06` — honored: export uses a dedicated connection **outside** the `DB_POOL_MAX=1` write pool;
  the ledger is direct, so the added slot(s) are re-checked against the budget table (Open Risk 1).
- `P-03` — honored: the background-emit NULL gap, the missing ledger interceptor, and the config
  fail-open are surfaced as Risks/decisions, not papered over.

## Business Rules Touched (C-16)

- Net-new: no existing `xstockstrat-ledger` acceptance suite and no ledger/export guarantee in
  `platform.feature`. This feature's `@AC-1…@AC-11` become the first ledger durable suite promoted at
  launch (`services/xstockstrat-ledger/acceptance/`).
- PRESERVE — ledger append-only immutability (Invariant #1, `001…up.sql:46-60`): not regressed — the
  export is read-only and the design rejects historical backfill precisely because UPDATE is denied.
- PRESERVE — global-sequence ordering (Invariant #4, `ledger.proto:29`): honored — export orders by
  `sequence`.
