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
