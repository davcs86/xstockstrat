# Context: pwa-notifications

**Feature**: `docs/roadmap/features/162-pwa-notifications/feature.md`
**Product Spec**: `docs/roadmap/features/162-pwa-notifications/product-spec.md`
**Implementation Spec**: `docs/roadmap/features/162-pwa-notifications/implementation-spec.md`

---

## Session 2026-08-29 — sdd-story

- Created feature.md (status: draft), product-spec.md, acceptance.feature, context.md from user story.
- Operator decisions (via AskUserQuestion):
  - **Scope = true Web Push (closed-app)**, not foreground-only. Full stack: PWA manifest + service
    worker + icons on the UI, new `notify/v1` RPCs, a `notify.push_subscriptions` table, a Web Push
    fanout channel in notify, and a config-service seed for `notify.push.min_severity`.
  - **VAPID keys generated & wired by this session.** Plan: generate a keypair, wire
    `VAPID_PRIVATE_KEY` as a `type: SECRET` env var, `VAPID_PUBLIC_KEY` + `VAPID_SUBJECT` as plain env
    vars into notify + UI, and document that the real values must be set in DigitalOcean before push
    works. Push is disabled until keys are present (Slack/SendGrid pattern).
- Harness branch note: development happens on `claude/pwa-notifications-2eggrc` (from/to `main-dev`),
  not `feature/pwa-notifications`.
- Ledger traps folded into product-spec Open Questions:
  - Secret env var must be wired through **all** deploy sites in the same PR (2026-08-19 finnhub-key).
  - Do not gate push on an alert `context` Struct key — target by `target_user_id`, gate on `severity`
    (2026-08-19 020-notify-external-fanout).
  - `notify.push.min_severity` seed goes in a **xstockstrat-config** migration; `push_subscriptions`
    goes in a **xstockstrat-notify** migration (2026-08-26 notify migration).
- Grounding read: notify `EmitAlert` best-effort `queueMicrotask` fanout isolation
  (`services/xstockstrat-notify/src/grpc/notifyServiceImpl.ts`), `FanoutDispatcher`
  (`src/fanout/fanout.ts`), notify proto (`packages/proto/notify/v1/notify.proto`), UI BFF pattern
  (`services/xstockstrat-ui/CLAUDE.md`).

## Session 2026-08-29 — sdd-design

- Phase 0 Recon: wrote recon.md (services: notify, ui, config, packages/proto; key reuse patterns:
  `FanoutDispatcher` structure + `queueMicrotask` best-effort deferral; `AgentUrlContext` server→browser
  env bridge; Settings-group NavItem). C-16 read: `notify-external-fanout.feature` isolation contract is
  the guarantee to preserve.
- Phase 1 Grilling: 2 rounds (quick, operator opted into round 2). **Chosen approach:** a disjoint
  `WebPushDispatcher` class mirroring `FanoutDispatcher`, wired via a second `queueMicrotask` in
  `emitAlert`; additive `RegisterPushSubscription`/`UnregisterPushSubscription` RPCs; notify migration
  `002_push_subscriptions` (endpoint UNIQUE, full upsert SET); config-service seed for
  `notify.push.min_severity`; PWA plumbing (manifest/sw.js/icons/headers/middleware/Dockerfile) + a
  Settings-group `/accounts/notifications` enable toggle; VAPID keys wired through every deploy site.
  **Rejected:** extending `FanoutDispatcher` (state entanglement risks C-16); user-scoped unregister
  (strands rows after endpoint reassignment); sharing the fanout dedup for v1; a dedicated `/accounts`
  BFF surface; `next-pwa`.
- **Key decisions:** unregister by endpoint only (`@AC-3`); full ON CONFLICT SET (rotated keys);
  VAPID subject validated `mailto:`/`https:` at startup, fail-loud/disable (avoids silent per-send
  black-hole); no push content-dedup in v1 (OS `tag`-coalesce only, named follow-up); push gates on
  severity + `target_user_id` only; register injects session `user_id` (IDOR guard, never `forward`);
  cross-segment `notifyClient` reuse recorded against the UI "Sanctioned exception" four facts.
- Constitution rules touched: C-04, C-08, C-09, C-10a, C-13, C-15, C-16, C-17, P-03, F-01, F-06, F-07.
  **Floor breaches: none** (both rounds).
- Business rules: all PRESERVE/EXTEND, **no CHANGE** — no sign-off required on business-rule grounds.
- Status: draft → design-approved.

## Session 2026-08-29 — sdd-spec

- Generated implementation-spec.md with 12 steps. Status → implementation-ready.
- Key codebase findings (resolved the design's Open Risks flagged "resolve at /sdd-spec"):
  - **Config seed NNN = `021`** (`services/xstockstrat-config/migrations/`, last is
    `020_remove_analysis_signal_source_weights`); notify table NNN = `002` (last is `001_notify_alerts`).
    Two different services' migration dirs (ledger 2026-08-26 trap) — Steps 3 (notify) and 4 (config).
  - **Cross-segment `notifyClient` reuse — all four "Sanctioned exception" facts re-verified:**
    (i) `.do/app.yaml:12-20` single `/` catch-all to `xstockstrat-ui`, only `/agent` split off;
    (ii) session cookies `path: '/'` (`src/lib/auth.ts:76,83`); (iii) `requireSession` per dispatch
    (`bffShared.ts:32,68`); (iv) `notifyClient` base root-relative `'/trader/api'` (`notifyClient.ts:5`).
    `/accounts/notifications` may reuse the existing guarded `notifyClient` (Step 9).
  - **Secret-wiring checklist grounded on the SLACK/SENDGRID precedent** — VAPID must land in eight
    files: `docker-compose.yml:225-226`, `.do/app.dev.yaml:398-405` + `.do/app.yaml:396-403`
    (`type: SECRET`, `YOUR_{DEV,PROD}_*` placeholders), `deploy.yml:37-44/62-63/72-73/84-92`,
    `deploy-dev.yml:52-53` / `deploy-prod.yml:51-52`, `scripts/do-inject-prod-secrets.py:43-44`,
    `.env.example`. Step 11 enumerates each (ledger 2026-08-19 finnhub-key trap).
  - **Nav registration is TWO surfaces** (C-10(a)): `PLATFORM_SUBNAV.accounts` (`PlatformHeader.tsx:91-95`)
    **and** the `NAV_GROUPS` Settings group (`navGroups.tsx:80-96`) — existing accounts pages appear in
    both, so Notifications must too (Step 9); nav-reachability spec updated (Step 10).
  - `web-push` is not yet a notify dependency (add in Step 5); notify tests are compile-first
    (`tsc && node --test`), coverage via `pnpm run test:coverage` (c8 `--lines 40`); no
    `src/__tests__/fixtures/` home yet (C-13 lazy — create only on a second consumer).
  - VAPID public key crosses server→browser via a `VapidKeyContext` copying `AgentUrlContext`
    (`accounts/layout.tsx` already `force-dynamic`), never `NEXT_PUBLIC_*`.
- Coverage: all 9 `@AC-*` mapped to steps (Scenario Coverage table); consumer surface = UI only
  (Steps 7–10), no Agent tool (product spec).
