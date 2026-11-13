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
