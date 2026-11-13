# Context: notify-commsgun-channel

**Feature**: `docs/roadmap/features/338-notify-commsgun-channel/feature.md`
**Product Spec**: `docs/roadmap/features/338-notify-commsgun-channel/product-spec.md`
**Implementation Spec**: `docs/roadmap/features/338-notify-commsgun-channel/implementation-spec.md`

---

## Session 2026-11-13 — sdd-story

- Created feature.md (status: draft), product-spec.md, acceptance.feature, context.md from user story.
- Operator decisions taken before the spec was written (asked, not assumed):
  - Provider selection: one config key, `auto` | `commsgun` | `sendgrid`, default `auto`; exactly one email per alert.
  - Failure handling: durable outbox with retries for commsgun; SendGrid fallback only after the outbox gives up, and only in `auto`.
  - Credential: commsgun app key is an encrypted config secret resolved via `GetSecret`; URL and app id are plain config keys. No env var.
  - Channels: email only. SMS is out of scope until commsgun has an SMS provider.
- Verified outside this repo (no change needed there): `davcs86/homelab-edge` already has commsgun apps
  `xstockstrat` and `xstockstrat-staging` with app keys in SOPS, and `policy/policy.hujson` grants
  `tag:xstockstrat` and `tag:xstockstrat-staging` → `tag:edge` tcp:443. Enqueue contract:
  `docs/runbooks/commsgun.md` there.
  - Recipient: new `notify.commsgun.to_email`; no sender key (`from` omitted, commsgun default sender).
  - Escalation: one in-process WARNING alert (category `commsgun`) per undelivered row, hard-excluded from email fanout, plus WARN log and counter.
  - Session scope: run the pipeline through implementation in this session, pausing only at the mandatory gates.

## Session 2026-11-13 — sdd-review product-spec

- Product spec approved. Status: draft → spec-ready. (First pass FAILED criteria 6 and 9; fixed and re-reviewed.)
- Tree: `ccr-2d98935d-na9x6j` = `origin/main-dev` + this feature's docs commits (artifacts are not on `main-dev` until PR #1537 merges, so the tree was not switched).
- Warnings: tailnet name resolution from the notify container and the value-less secret seed row under C-05 are unverified — recon tasks for `/sdd-design`.
- Overlap findings: WARN `services/xstockstrat-notify/src/telemetry.ts` also modified by in-progress 337-metrics-host-provider-label; low-risk `src/grpc/notifyServiceImpl.ts` vs spec-ready 312-fix-read-path-owner-trust. No config-key, migration-number or proto collision.
- Demoted-duplicate check: none of the demoted features concerns notify email delivery; not a re-attempt.
- Recommended design depth: full (two services, schema migration, new secret + GetSecret grant, two deferred design forks).
