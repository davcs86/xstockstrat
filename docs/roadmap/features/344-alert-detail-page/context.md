# Context: alert-detail-page

**Feature**: `docs/roadmap/features/344-alert-detail-page/feature.md`
**Product Spec**: `docs/roadmap/features/344-alert-detail-page/product-spec.md`
**Implementation Spec**: `docs/roadmap/features/344-alert-detail-page/implementation-spec.md`

---

## Session 2026-11-15 — sdd-story

- Created feature.md (status: draft), product-spec.md, acceptance.feature, context.md from an operator report (staging, homelab, with screenshots) and same-day read-only recon.
- Operator decisions (2026-11-15): a **dedicated page** per alert (not an expandable row), showing severity, category, source service, time, full body, context fields and correlation ID. Operator's original report: "there's no single view or page to see all the details for an alert/notification".
- Scope folded in by routing agreed with the operator: readable error text for backfill-failure alerts (FR-7).
- Operator decision (2026-11-15, follow-up): **opening the alert's page marks it read** (FR-5).
- Proposed by me, unconfirmed: the URL shape `/accounts/notifications/<alert_id>`.
- Recon facts: notify proto has no get-by-id RPC (`notify.proto:14-39`); `Alert` fields at `:42-58`; inbox at `src/app/accounts/notifications/AlertInbox.tsx`; drawer at `src/components/trader/AlertStream.tsx`; body built at ingest `servicer.py:519-544` from `str(e)` (`:574-593`).

## Session 2026-11-15 — sdd-review product-spec

- Product spec approved. Status: draft → spec-ready.
- Warnings (6, none blocking):
  - Nav (C-10): the `Notifications` entry matches its path exactly (`PlatformHeader.tsx:94,103`; same entry at `navGroups.tsx:89`), so it would not stay highlighted at `/accounts/notifications/<alert_id>`. Spec reworded to require it; **design must change the match mode** for this entry in both places.
  - Proto: `GetAlert` is additive; spec now names the `buf breaking` / 1-owner path. `Alert` fields `source_service=6`, `correlation_id=12`, `read_at=14` confirmed in `notify.proto`.
  - Scenarios: `@AC-1` asserts "shows the alert as read" (an FR-5 effect) — tagged `@FR-5` in this session. The NOT_FOUND → "Alert not found" BFF trap is covered by `@AC-2` (spec now cites it).
  - Open Questions: the garbled FR-7 bullet was reworded (job row and ledger event unchanged; design confirms no other reader depends on the old body).
  - Consumer surface: the bell unread-badge effect (`@AC-6`) is now named in the surface description. Push deep link (FR-6) depends on the service worker and notify's push payload — **design must confirm**.
  - Peer dependency: 339-fix-symbol-page-alerts-ui lands first. **Still open:** the `merge-order.md` row is the review router's to record; this session may edit only the feature directory, so it is not yet written.
- Overlap findings (WARN only, no FAIL):
  - [file] `services/xstockstrat-notify/src/grpc/notifyServiceImpl.ts` — `GetAlert` next to `listAlerts` (:225) vs 316-fix-notify-stream-contract (spec-ready; edits :15, :87, :288). Disjoint regions, rebase-only.
  - [file] `AlertStream.tsx` drawer — FR-4 links vs 339-fix-symbol-page-alerts-ui (draft), which changes the same drawer. Ordering dependency: 339 first.
  - Proto, migrations, config: no collision (344 adds only `rpc GetAlert`, no migration, no config key).
- Recommended design depth: full (proto change, 3 affected services, warning-level overlap)

OPERATOR DECISIONS (binding, recorded 2026-11-15):
- A dedicated page per alert (not an expandable row) showing severity, category, source service, time, full body, context fields and correlation ID.
- Opening the alert's page marks it as read.
- Backfill-failure alert bodies are plain-language; the raw exception text stays only in the alert context.
- fix-symbol-page-alerts-ui changes the same Alerts drawer component; treat it as landing first.
