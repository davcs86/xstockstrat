# Context: inter-service-mtls

**Feature**: `docs/roadmap/features/210-inter-service-mtls/feature.md`
**Product Spec**: `docs/roadmap/features/210-inter-service-mtls/product-spec.md`
**Implementation Spec**: `docs/roadmap/features/210-inter-service-mtls/implementation-spec.md`

---

## Session 2026-09-25 — sdd-story

- Created feature.md (status: draft), product-spec.md, acceptance.feature, context.md from user story.
- **Provenance**: audit design ticket **DT-3** (Medium) from the 2026-09-16 security audit
  (`docs/reports/2026-09-16-trading-system-security-audit.md`, §153): all inter-service gRPC is
  plaintext h2c with no mTLS (Go `insecure.NewCredentials`, Python/Node equivalents); the audit's
  recommendation is "mTLS (or a signed, short-lived service-identity token) between backends so the
  header-trust boundary is anchored in cryptographic service identity." Also referenced from the M-list
  "no mTLS/header-trust posture."
- **Why it matters**: the header-propagation convention (root CLAUDE.md) treats `x-user-id` /
  `x-access-scope` / `x-trace-id` as trusted platform-internal after the edge injects/strips them. That
  trust rests on network privacy alone — mTLS re-anchors it to authenticated service identity (FR-2/
  FR-5). This is the transport-auth layer beneath the existing propagation, not a replacement.
- **Largest-blast-radius of the Phase D set**: touches all 10 backend gRPC servers, both gRPC clients
  (UI BFF + agent), and the deployment topology (docker-compose + `.do/app*.yaml` + cert material).
  Expect a full (not `quick`) `/sdd-design` and a phased, no-flag-day rollout (see product-spec §
  Open Questions: permissive interim mode).
- **Standalone**: no dependency on features 193/207/208/209. Feature 193's Out-of-Scope explicitly
  lists "inter-service mTLS (DT-3)" as a separate design ticket.
- Created for pickup by another session per operator direction (Phase D security backlog).
