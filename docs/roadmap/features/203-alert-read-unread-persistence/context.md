# Context: alert-read-unread-persistence

**Feature**: `docs/roadmap/features/203-alert-read-unread-persistence/feature.md`
**Product Spec**: `docs/roadmap/features/203-alert-read-unread-persistence/product-spec.md`
**Implementation Spec**: `docs/roadmap/features/203-alert-read-unread-persistence/implementation-spec.md`

---

## Session 2026-09-24 — sdd-story

- Created feature.md (status: draft), product-spec.md, acceptance.feature, context.md from the
  user request "add to the roadmap: alarm persistence to support read/unread status; also upgrade
  them to support level/severance, module, and body."
- **Terminology:** the operator's "alarms" = `xstockstrat-notify` alerts (the word "alarm" is not a
  first-class concept in the codebase; confirmed by grep this session).
- **Scope clarified with the operator** (AskUserQuestion, this session):
  - Alarm model = **"1+3"** → interpreted as *a durable per-user notification inbox realized by
    extending the existing `notify.alerts` store with per-user read/unread* (not a new parallel store).
    Recorded as a to-confirm item in `## Open Questions` so review can catch a mis-read.
  - read/unread is **distinct from** the existing `acknowledged` flag (FR-1/AC-5).
  - "level/severance, module, body" → **level = existing `severity`**, **body = existing `body`**,
    **module = existing `category`/`source_service`** (operator chose "map module to existing
    category/source_service"); **no new proto field** for module. Net-new work is the per-user
    read/unread persistence.
- Grounding facts from recon this session:
  - `notify.alerts` already has `severity` (AlertSeverity enum INFO/WARNING/ERROR/CRITICAL), `body`,
    `category`, `source_service`, and `acknowledged`/`acknowledged_by`/`acknowledged_at`
    (`services/xstockstrat-notify/migrations/001_notify_alerts.up.sql`,
    `packages/proto/notify/v1/notify.proto`).
  - Consumer surface is the UI: `services/xstockstrat-ui/src/app/accounts/notifications/page.tsx`,
    `src/components/trader/AlertStream.tsx`, `src/lib/browserClients/notifyClient.ts`. Agent has
    `emit_alert` producer only (`services/xstockstrat-agent/app/tools.py`) — no read/mark tool (out of scope).
  - Broadcast alerts (`target_user_id` empty) are why a single global flag cannot model per-user read —
    drives the `(alert_id, user_id)` join-table proposal.
- **Known traps flagged (ledger):**
  - fails.md:457 — notify `list-alerts` FRs once disagreed; the shipped decision lived only in
    context.md. Kept FR-2/FR-3 on one read model and reconciled in the spec (Open Questions).
  - fails.md:597 / :308 (F-10/F-12) — alert helpers/agent-tool docs have drifted before; if the
    notify surface changes, keep `emit_alert` docs and the notify client aligned in the same PR.
- Depth this session: **story only** (operator chose it) — stops at `spec-ready`; `/sdd-design quick`
  not run yet. All proto changes anticipated additive (non-breaking); a DB migration (new
  `notify.alert_reads` table) is anticipated → DBA gate.

## Session 2026-09-24T00:00:00Z — sdd-review product-spec

- Product spec approved. Status: draft → spec-ready (criteria: PASS WITH WARNINGS, no blockers; overlap: CLEAN).
- Warnings (all advisory — none block the gate):
  - C-07 (criterion 7): migration described additive but the `003_*.up.sql`/`.down.sql` naming +
    run order not stated. Next free notify migration is **003** (existing: 000/001/002). Firm up at /sdd-spec.
  - P-03/C-11 (criterion 9): two *material* Open Questions to close at /sdd-design before /sdd-spec —
    (1) broadcast entitlement (gates FR-4 + unread count), (2) unread-count semantics (total vs
    per-category; does the badge include broadcasts — gates FR-3/FR-6). The other OQs (F-trap,
    "1+3" confirmation) are guardrails, not blocking unknowns.
  - C-10 NOTE: `read`/`read_at` are on the shared `Alert` message emitted by both `ListAlerts` and
    `StreamAlerts`; only ListAlerts is described as populating them. Confirm at design that
    StreamAlerts sets `read=false` at stream time (trivially correct) rather than leaving it defaulted-ambiguous.
## Session 2026-09-24 — sdd-design

- Phase 0 Recon: wrote recon.md (services: xstockstrat-notify, xstockstrat-ui, packages/proto; key reuse patterns: AcknowledgeAlert handler pattern, forward() BFF helper, capturingPool() test mock).
- Phase 1 Grilling: 3 rounds (quick). Chosen approach: `notify.alert_reads` join table with `MarkAlertRead` RPC, `ListAlerts` LEFT JOIN + unread_count, owner from `x-user-id` header. Rejected: read_at column on alerts table (can't model per-user broadcast state), sequential await (less forward-compatible), window function single query (unnecessary complexity at 50-row cap).
- Key adversary catches incorporated: R1 — `|| 50` falsy trap; R2 — `?? 50` proto3 zero-default trap (corrected to `> 0 ? : 50`), `ON CONFLICT DO NOTHING` doesn't suppress FK violations (added `WHERE EXISTS`), `Promise.all` serialization at pool-max-1 (documented, not harmful); R3 — `ListAlerts` user-scoping change documented as intentional security tightening, `Promise.all` comment recommended.
- Constitution rules touched: C-03, C-04, C-10, C-14, C-16, F-04, F-11. Floor breaches: none.
- Status: spec-ready → design-approved.

- Code-checkable claims verified: `notify.alerts` has only `acknowledged*` (no per-user read column) —
  001_notify_alerts.up.sql:17-19; `category`/`source_service` exist (:9,:12) and are on `Alert`
  (notify.proto:37,40), so "module = existing fields, no new field" holds; FR-2 owner-from-header
  matches Register/UnregisterPushSubscription (notify.proto:27,104-105) and diverges from the older
  AcknowledgeAlertRequest.user_id body field (:83); all 203 additions land on free field numbers
  (Alert 13+, ListAlertsRequest 5, ListAlertsResponse 3, new MarkAlertRead RPC) → non-breaking.
- Overlap: CLEAN. No in-flight feature touches notify / notify.proto / notify migrations; next-free
  migration 003 uncontested; 165 (pwa-notifications, launched) already owns 002 + the push RPCs and
  203 correctly builds on top. UI features 187/188/199/200 touch disjoint /insights + positions regions.

## Session 2026-09-24 — sdd-spec

- Generated implementation-spec.md (10 steps) from the approved design.md and recon.md.
- Step order: proto contract (1) → codegen (2) → migration (3) → notify MarkAlertRead + ListAlerts
  handler (4) → notify unit tests (5) → UI alertShared.ts extraction (6) → AlertInbox + notifications
  page (7) → AlertStream badge refactor + BFF markAlertRead route (8) → E2E fixtures + mock-backend
  update (9) → E2E specs (10).
- Scenario coverage: AC-1 (Steps 5,10), AC-2 (Steps 5,10), AC-3 (Step 5), AC-4 (Steps 5,10),
  AC-5 (Step 5), AC-6 (Step 10). All 6 scenarios covered (C-15).
- Consumer surface (C-14): /trader AlertStream badge (Step 8), /accounts/notifications inbox (Step 7).
- Reviewers mapped per step from docs/runbooks/reviewer-registry.md: Proto Reviewer + notify owner
  (Steps 1-2), DBA + notify owner (Step 3), notify owner (Steps 4-5), UI owner (Steps 6-10).
- Key design decisions carried forward from design.md: `> 0 ? : 50` limit guard (proto3 zero trap),
  `WHERE EXISTS` on MarkAlertRead SQL (ON CONFLICT doesn't suppress FK phantoms), `Promise.all` for
  two-query ListAlerts (serializes at pool-max-1, commented), identity from `x-user-id` header not
  body (security tightening), `alertShared.ts` extraction for DRY severity maps.
- Status: design-approved → implementation-ready.
