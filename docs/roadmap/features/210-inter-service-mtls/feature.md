# Feature: inter-service-mtls

**Development Branch**: `feature/inter-service-mtls`
**Created**: 2026-09-25
**Last Updated**: 2026-09-25

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-09-25 | `idea` → `draft` | /sdd-story | Product spec generated (closes security-audit DT-3 — inter-service transport authentication / mTLS) |

---

## Artifacts

- [Product Spec](product-spec.md) — requirements and governance
- [Acceptance Scenarios](acceptance.feature) — Gherkin `@AC-*` scenarios (single source of acceptance truth, C-15)
- [Implementation Spec](implementation-spec.md) — _not yet generated — run `/sdd-spec inter-service-mtls`_
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

All inter-service gRPC is plaintext h2c (Go `insecure.NewCredentials`, and the Python/Node equivalents)
with no transport authentication, so the platform's trust in the propagated `x-user-id` /
`x-access-scope` / `x-trace-id` headers rests on **network privacy alone** — any workload that reaches
a backend port can forge them. This feature adds **mutual TLS with verified per-service identity**
between backends (or an equivalent signed short-lived service-identity token), anchoring the
header-trust boundary in cryptographic service identity rather than raw reachability, and encrypting
inter-service traffic in transit. Closes design ticket **DT-3** (Medium) in
`docs/reports/2026-09-16-trading-system-security-audit.md`.

## Reviewers

_(Auto-populated from docs/runbooks/reviewer-registry.md based on affected services and
change types. Override as needed for this feature. Snapshot finalized at /sdd-spec time —
re-run /sdd-spec if the registry changes.)_

| Role | Review Focus |
|---|---|
| Security | Mutual authentication is enforced (server AND client cert verified against the platform CA), peer service identity is verified so one service cannot impersonate another, plaintext gRPC is refused in production, and the header-trust model is re-anchored to authenticated identity; CA/key material handling and rotation are sound |
| Platform lead | Cross-cutting rollout across all gRPC servers/clients (10 backends + agent + UI clients), cert issuance/rotation mechanism and deployment topology (DO App Platform + docker-compose), no-downtime migration path, local-dev ergonomics |
| `xstockstrat-trading` / `xstockstrat-portfolio` / `xstockstrat-marketdata` | Go gRPC server+client credentials swap from `insecure` to mTLS; interceptor/header-propagation semantics unchanged beneath the new transport |
| `xstockstrat-indicators` / `xstockstrat-ingest` / `xstockstrat-analysis` | Python gRPC (aio) server+channel credentials swap; per-request propagation unchanged |
| `xstockstrat-ledger` / `xstockstrat-identity` / `xstockstrat-notify` / `xstockstrat-config` | Node gRPC server+client credentials swap; streaming RPCs (WatchConfig, StreamEvents, notify) continue under mTLS |

## Next Action

`/sdd-review inter-service-mtls product-spec` — AI review of product spec before running /sdd-spec
