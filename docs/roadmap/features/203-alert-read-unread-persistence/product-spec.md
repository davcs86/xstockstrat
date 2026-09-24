# Product Spec: alert-read-unread-persistence

**Created**: 2026-09-24

---

## Problem Statement

`xstockstrat-notify` persists alerts (`notify.alerts`) and streams them to subscribers, but the
only per-alert state is a global `acknowledged` boolean (`acknowledged_by`/`acknowledged_at`).
There is no per-user **read/unread** state, so a user cannot tell which alerts they have already
seen — and for a broadcast alert (`target_user_id IS NULL`) a single global `acknowledged` flag
cannot represent that user A has read it while user B has not. The `/accounts/notifications` page
and the trader `AlertStream` therefore cannot show an unread count or mark-as-read behavior.

## User Story

As a platform user, I want my alerts to remember whether I have read them, so that my
notification inbox shows an accurate unread count and I can mark alerts read — independently of
whether another user has read the same broadcast alert, and independently of the operational
`acknowledged` flag.

## Functional Requirements

FR-1. A per-user read state exists for alerts: `(alert_id, user_id) → read_at`. Read state is
**per user**, so one broadcast alert can be unread for one user and read for another. Read state
is **distinct from** the existing `acknowledged` flag (ack is an operational state; read/unread is
a per-user inbox state) — neither implies the other.

FR-2. A new `MarkAlertRead` RPC (owner resolved from the propagated `x-user-id` header per C-03,
never the request body) sets the calling user's read state for one or more `alert_id`s to read;
it is idempotent (re-marking an already-read alert succeeds and does not move `read_at` backward).

FR-3. `ListAlerts` returns, per returned alert, the calling user's `read` boolean (and `read_at`),
and supports an `unread_only` filter and/or an `unread_count` so the inbox can render a badge.
(FR-2 and FR-3 must agree on the read model — see Known trap.)

FR-4. Alert read/unread applies to both **targeted** alerts (`target_user_id = me`) and
**broadcast** alerts (`target_user_id` empty) that the user is entitled to see; a user's read
state never leaks another user's read state.

FR-5. Each alert continues to carry its **level** (severity), **body**, and **module** —
where module is served by the existing `category` / `source_service` fields (no new module field;
this feature standardizes their meaning: `source_service` = emitting service, `category` =
functional module e.g. "trade"/"risk"/"system"/"indicator"). The inbox surfaces all three.

FR-6. The `/accounts/notifications` page (and, where it lists alerts, the trader `AlertStream`)
renders each alert's read/unread state, an unread count, and a mark-as-read control wired to
`MarkAlertRead`.

## Out of Scope

- Changing or removing the existing `acknowledged` / `AcknowledgeAlert` semantics (kept as-is).
- Adding a new `module` proto field or a `Module` enum (module maps to existing `category`/`source_service`).
- Changing `severity`/`body` (they already exist and satisfy "level" and "body").
- Per-user alert retention / auto-expiry / archival policy.
- A new agent MCP tool for reading/marking alerts (agent has the `emit_alert` producer only; add later if needed).
- Web Push (feature 165) delivery changes.

## Affected Services

Exact service names from CLAUDE.md Service Registry:
- `xstockstrat-notify` — owns `notify.alerts`, the alert RPCs, and the new per-user read state + `MarkAlertRead`.
- `xstockstrat-ui` — `/accounts/notifications` page + `trader/AlertStream.tsx` + `notifyClient.ts`/`traderBff.ts` render read/unread and call `MarkAlertRead`.
- `packages/proto` — `MarkAlertRead` RPC, `read`/`read_at` on `Alert`, and `unread_only`/`unread_count` on `ListAlerts*`.

## Consumer Surface(s)

_Constitution **C-14**._ The end-user-reachable surface(s) this capability is consumed through.

- [x] **UI** — `xstockstrat-ui` segment(s): `/trader` (the `AlertStream` alert list) and the
  `/accounts/notifications` page — unread badge, per-alert read/unread indicator, and a
  mark-as-read control. Reachable per **C-10** (surfaces already registered).
- [ ] **Agent** — no new tool this feature; `emit_alert` (producer) is unchanged. A read/mark
  tool is a named future follow-up, not deferred silently within this feature.
- [ ] **None**.

## Proto Contract Changes

- New `MarkAlertRead` RPC on `NotifyService` (request keyed by `alert_id`(s); owner from `x-user-id` header).
- `Alert` gains a per-caller `read` bool and `read_at` timestamp (populated relative to the requesting user).
- `ListAlertsRequest` gains `unread_only` (and `ListAlertsResponse` an `unread_count`, or an equivalent).
- All additive (new RPC + new fields) — **non-breaking**; 1 service owner approval expected.

## Config Key Changes

- [x] No new config keys.

## Database Changes

- New table (proposed) `notify.alert_reads (alert_id UUID, user_id TEXT, read_at TIMESTAMPTZ,
  PRIMARY KEY (alert_id, user_id))` — one row per (alert, user) that has read it; absence = unread.
  A join/left-join against `notify.alerts` yields per-user read state and unread counts.
- The existing `acknowledged*` columns on `notify.alerts` are untouched.
- Migration is additive (new table + index); no change to `notify.alerts` rows. Confirm the exact
  shape (join table vs a `read_at` on a per-user alert-delivery table) at `/sdd-design`.

## Feature Workflow Notes

Branch to create: `feature/alert-read-unread-persistence` (branch from `main-dev`)
Approval gates required (per docs/runbooks/feature-workflow.md):
- [ ] 1 service owner approval (non-breaking proto or config change) — additive RPC + fields.
- [ ] 2 service owners + platform lead (breaking proto change) — not expected (all additive).
- [ ] DBA review + service owner (schema migration) — required for the new `notify.alert_reads` table.

## Acceptance Criteria

See `acceptance.feature` (scenarios `@AC-*`) — the single source of acceptance truth (Constitution
**C-15**). Each `FR-N` above is covered by ≥1 tagged scenario there.

## Open Questions

- [ ] **Read model shape:** a `(alert_id, user_id)` read-marks join table (absence = unread) vs a
  per-user alert-delivery table carrying `read_at`. The join-table default keeps broadcast alerts
  single-row; confirm at design.
- [ ] **Broadcast entitlement:** what defines "a broadcast alert the user is entitled to see" for
  unread counting (all broadcasts? scoped by access-scope)? Needed for FR-4 and the unread count.
- [ ] **Unread count semantics:** total unread vs unread-per-category; does the badge include broadcasts?
- [ ] **Known trap (ledger fails.md:457):** notify's `list-alerts` behavior once disagreed between
  FR-1 and FR-2 with the real decision hidden in context.md. Keep FR-2 (`MarkAlertRead`) and FR-3
  (`ListAlerts` read fields/filter) describing exactly one read model; reconcile any divergence in
  the spec itself, not context.md.
- [ ] **Operator interpretation of "1+3" to confirm:** this spec reads the answer as *a durable
  per-user inbox realized by extending the existing `notify.alerts` store with per-user read/unread*
  (option 1's "extend existing" + option 3's "persistent inbox"), **not** a brand-new parallel alert
  store. Flag at review if a separate store was intended.
