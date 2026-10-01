# Feature: inter-service-mtls

**Development Branch**: `feature/inter-service-mtls`
**Created**: 2026-09-25
**Last Updated**: 2026-09-25

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-09-25 | `idea` → `draft` | /sdd-story | Product spec generated (closes security-audit DT-3 — inter-service transport authentication / mTLS) |
| 2026-09-30 | `draft` → `spec-ready` | /sdd-review | Product spec approved (PASS, 0 warnings). Sole first-pass blocker (criterion 9 — five unchecked Open Questions) fixed pre-advance by reframing `## Open Questions` → `## Design-Phase Decisions (deferred to /sdd-design)` — all items checked `[x]` with resolution pointers; these are genuine design forks (FR-3 names its mechanism "a design decision"), not spec defects. Overlap scan: no FAIL-level collision (no proto-field / migration-NNN / duplicate-config-key). Soft rebase-level same-file overlap with feature 084 (`droplet-compose-deploy`) on `docker-compose.yml` / `.do/app*.yaml` — recorded as a coordination note (folded into the design agenda), not a blocking merge-order row; if 084 lands first, 210's dev cert wiring re-targets its dev orchestration model. |
| 2026-10-01 | `design-approved` → `implementation-ready` | /sdd-spec | Implementation spec generated with 14 steps (Model B: cert foundation → per-language mutual-TLS wiring Go/Python/Node → UI BFF + agent clients → deployment env → rolling-cutover runbook + Teardown). Every step cites grep-confirmed `path:line` evidence. Discovery beyond recon: the agent has **69 inline `insecure_channel` sites** (67 in `client.py` + 2 in `auth.py`), not the 2 recon summarized — its factory refactor sweeps all 69. AC coverage: @AC-1/2/4/5 across the Go/Python/Node test steps, @AC-6 (rotation) in the Node ledger/config test, @AC-3 `@descoped` (no covering step, exempt). |
| 2026-10-01 | `spec-ready` → `design-approved` | /sdd-design | Design debated (4 rounds, full) + approved; recon.md + design.md written. Chosen: **Model B** — flag-day per-service mutual TLS, no permissive/toggle mode; static per-service leaf from one self-signed platform CA, env-PEM boot-time (`MTLS_CERT`/`MTLS_KEY`/`MTLS_CA_CERT`, never WatchConfig — config-bootstrap circularity, F-07 honored); fail-closed on absent material; native chain+SAN verification with the client authority **pinned to the service name uniformly** (env-independent — DO dials `PRIVATE_DOMAIN` ≠ SAN, verified against `.do/app*.yaml:56-67`); single leaf both-EKU; header-only gates preserved (features 147/154 byte-identical — **@AC-3 descoped / FR-2 narrowed, operator sign-off**, no C-16 cross-feature change); leaf→root rolling cutover with the trading↔ledger wave gated on a **mandatory flat-book + HALTED** precondition (bounded ledger-emit transition-event loss accepted by operator sign-off, same-class-as-restart, blast radius feature-042). DO re-origination resolved (internal_ports = L4 raw TCP, no TLS termination). Adversary caught across rounds: the `x-internal-caller` forgery hole (→ narrow-scope operator decision), the Go `InsecureSkipVerify` fail-open footgun (→ `ServerName` native verify), and the **DO `PRIVATE_DOMAIN`≠SAN show-stopper** (→ uniform authority pinning). No Floor breach. Open risks → `design.md` §Open Risks. |

---

## Artifacts

- [Product Spec](product-spec.md) — requirements and governance (FR-2 narrowed at design)
- [Acceptance Scenarios](acceptance.feature) — Gherkin `@AC-*` scenarios (single source of acceptance truth, C-15; `@AC-3 @descoped`, `@AC-4` rewritten for Model B)
- [Recon Dossier](recon.md) — grounded codebase map across all 10 backends + UI/agent clients + deployment; DO env-only + config-bootstrap constraints (Phase 0)
- [Design](design.md) — Model B chosen approach, 6 rejected alternatives, open risks, C-16 preserve/narrow record (Phase 1, 4 rounds)
- [Implementation Spec](implementation-spec.md) — 14 steps, Model B; every step evidence-cited (C-01)
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
| Security | Mutual authentication is enforced (server AND client cert verified against the platform CA via native chain+SAN matching, authority pinned to the service name), plaintext gRPC is refused in every environment (fail-closed on absent cert material), and the header-trust model is re-anchored to the mutually-authenticated channel; CA/key material handling and rotation are sound. **Scope note (design-approved, operator sign-off):** per-RPC identity ACL bound to the peer cert SAN is descoped (`@AC-3 @descoped`) — the app-layer `x-internal-caller`/access-scope gates (features 147/154) stay header-only, so a compromised service holding any platform leaf can still forge `x-internal-caller` (documented follow-up) |
| Platform lead | Cross-cutting rollout across all gRPC servers/clients (10 backends + agent + UI clients), cert issuance/rotation mechanism and deployment topology (DO App Platform + docker-compose), no-downtime migration path, local-dev ergonomics |
| `xstockstrat-trading` / `xstockstrat-portfolio` / `xstockstrat-marketdata` | Go gRPC server+client credentials swap from `insecure` to mTLS; interceptor/header-propagation semantics unchanged beneath the new transport |
| `xstockstrat-indicators` / `xstockstrat-ingest` / `xstockstrat-analysis` | Python gRPC (aio) server+channel credentials swap; per-request propagation unchanged |
| `xstockstrat-ledger` / `xstockstrat-identity` / `xstockstrat-notify` / `xstockstrat-config` | Node gRPC server+client credentials swap; streaming RPCs (WatchConfig, StreamEvents, notify) continue under mTLS |
| `xstockstrat-ui` | BFF gRPC client-cert presentation through the single `makeTransport` choke point; e2e mock-backend moved to TLS; no browser-visible behavior change |
| `xstockstrat-agent` | Shared secure-channel factory replacing all 69 inline `insecure_channel` sites; authority pinned to target service name; MCP tool contract unaffected (transport-only) |

## Next Action

`/sdd-review inter-service-mtls impl-spec` — validate the 14-step implementation spec, then `/sdd-execute inter-service-mtls`.
