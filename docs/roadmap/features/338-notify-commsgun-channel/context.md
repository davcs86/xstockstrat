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

## Session 2026-11-13 — operator steer (during sdd-design round 1)

- Operator: commsgun must use a **separate subscriber app per environment**. Recorded as FR-12 / AC-24: `production` → app `xstockstrat`, `staging` → `xstockstrat-staging`; `commsgun.app_id` is seeded per environment and `commsgun.app_key` is a per-environment secret row. Both apps already exist in `davcs86/homelab-edge` (`commsgun_apps`, `commsgun_app_key_xstockstrat`, `commsgun_app_key_xstockstrat_staging`).

## Session 2026-11-13 — sdd-design round 1 gate (operator steers)

- Mode pinned to `commsgun` while not fully configured: **queue and escalate**. With URL, app id and recipient set, the email is queued and a missing app key is a failed (retryable) attempt, so the row reaches undelivered and escalates. With any of those three unset, no row is queued and one rate-limited WARNING alert (category `commsgun`) is raised instead. Never treated as `auto`.
- Pending rows after a switch to `sendgrid`, or after `auto` loses its commsgun configuration: **reroute now** — end each due row with a distinct `rerouted` reason and send once through SendGrid if enabled. A deliberate switch to `sendgrid` raises no alert; a reroute caused by lost configuration under `auto` raises one WARNING alert per incident, not per row.
- Fallback guarantee: **at most one email**. Mark the row ended and raise the escalation alert first, then try SendGrid once.

## Session 2026-11-13 — sdd-design round 2 gate (operator steers)

- Deliberate switch to `sendgrid` while SendGrid is not enabled: pending rows end `rerouted` with no email and **one WARNING alert per incident** says pending emails were dropped.
- Incident alerts (pinned-unconfigured, lost-configuration reroute, the case above) **repeat every 24 hours** while the condition lasts.
- O-9 **waived**: the email exclusion keys on category `commsgun` alone; the category is documented as reserved.
- Gate outcome: **run another round** (not approved after round 2).
