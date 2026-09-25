# Product Spec: inter-service-mtls

**Created**: 2026-09-25

---

## Problem Statement

All inter-service gRPC in the platform is plaintext h2c with **no transport authentication** (Go
`insecure.NewCredentials`, and the Python-aio and Node equivalents) — audit design ticket **DT-3**
(Medium), `docs/reports/2026-09-16-trading-system-security-audit.md`. The header-propagation
convention treats `x-user-id` / `x-access-scope` / `x-trace-id` as **trusted platform-internal** once
the external edge (the `xstockstrat-ui` middleware) injects them. That trust currently rests on
network privacy alone: any workload that can reach a backend's gRPC port — a compromised pod, a
lateral foothold, a misrouted client — can open a plaintext channel and **forge** those headers,
impersonating any user or access scope, with no cryptographic proof of the caller's identity.

## User Story

As a platform operator, I want every inter-service gRPC connection mutually authenticated with
verified per-service identity and encrypted in transit, so that the trusted internal headers are
honored only for calls from an authenticated peer service — a workload that merely reaches the port
but cannot present a valid service credential is refused — and inter-service traffic is not readable
on the wire.

## Functional Requirements

FR-1. Every inter-service gRPC connection MUST use mutual TLS: the server presents a certificate the
client verifies against the platform CA, **and** the client presents a certificate the server
verifies against the platform CA. Plaintext/`insecure` gRPC MUST be refused in production.

FR-2. The peer's **service identity** (encoded in the certificate — e.g. SPIFFE ID or a per-service
CN/SAN) MUST be verified, so one service cannot impersonate another even with a valid-but-different
platform-issued cert. The header-trust boundary is re-anchored to this authenticated identity: the
propagated `x-*` trio is honored only on a mutually-authenticated channel.

FR-3. A certificate issuance and **rotation** mechanism MUST be defined — a platform CA plus
per-service leaf certs, rotatable without service downtime (expiry/rollover handled). The concrete
mechanism (statically mounted certs + rotation job, SPIRE/SPIFFE, or a cloud-managed CA) is a design
decision.

FR-4. Local development MUST remain workable: mTLS is enforced in the DO deployment, and a documented
relaxed/dev-cert mode keeps `docker-compose` and test runs functional (loopback network). The relaxed
mode MUST NOT be reachable in production configuration (fail-closed default: enforce).

FR-5. Header-propagation **semantics are unchanged** beneath the new transport — the Go interceptor,
Python per-method, and Node AsyncLocalStorage propagation of `x-user-id` / `x-access-scope` /
`x-trace-id` continue to work; mTLS is the transport-authentication layer beneath them, not a
replacement for them.

FR-6. Streaming RPCs (`WatchConfig`, `StreamEvents`, `StreamOrderUpdates`, notify streaming) MUST
continue to function under mTLS, including long-lived streams across a cert rotation.

## Out of Scope

- Authentication of the **external** edge (browser/user → `xstockstrat-ui`, and the agent's OAuth/JWT)
  — that is the existing frontend-auth boundary and is unchanged; this feature governs backend↔backend
  transport only.
- Application-layer authorization changes (ownership checks, access-scope logic) — those shipped in the
  audit's critical/high fixes and are orthogonal to transport auth.
- Replacing gRPC or the header-propagation trio with a different identity mechanism — mTLS augments the
  existing model (FR-5), it does not redesign it.
- DB / PgBouncer transport TLS — a separate concern from inter-service gRPC.

## Affected Services

Exact service names from CLAUDE.md Service Registry — **all gRPC servers and their gRPC clients**:
- Go: `xstockstrat-trading`, `xstockstrat-portfolio`, `xstockstrat-marketdata`
- Python: `xstockstrat-indicators`, `xstockstrat-ingest`, `xstockstrat-analysis`
- Node: `xstockstrat-ledger`, `xstockstrat-identity`, `xstockstrat-notify`, `xstockstrat-config`
- gRPC **clients**: `xstockstrat-ui` (BFF gRPC transport to backends) and `xstockstrat-agent` (native
  gRPC stubs) — both must present client certs.
- (Deployment) `docker-compose.yml`, `.do/app.yaml` / `.do/app.dev.yaml`, and cert material
  provisioning.

## Consumer Surface(s)

_Constitution **C-14**._

- [ ] **UI** — `xstockstrat-ui` is affected as a gRPC **client** (must present a client cert), but
  there is no new end-user-visible surface — behavior for the browser is unchanged.
- [ ] **Agent** — `xstockstrat-agent` is affected as a gRPC **client** (client cert), no new tool or
  user-visible behavior.
- [x] **None** — internal/platform transport-security change. No end-user-reachable capability is
  added; the observable effect is that unauthenticated inter-service calls are refused. UI and agent
  are touched only as gRPC clients, not as new user surfaces. No C-14 override needed.

## Proto Contract Changes

- [x] No proto changes required (transport/credentials layer, not the contract)

## Config Key Changes

- Likely env/config for cert paths, CA bundle, and the enforce/relaxed toggle (e.g. an mTLS-enabled
  flag and cert-material locations) per FR-3/FR-4 — **exact form pinned at /sdd-design/`/sdd-spec`**;
  note that inter-service **connection** vars must stay in the `<SERVICE>_ENDPOINT` form (no new
  suffix), so cert/CA config is separate from endpoint vars. Recorded as an open question.

## Database Changes

- [x] No schema changes

## Feature Workflow Notes

Branch to create: `feature/inter-service-mtls` (branch from `main-dev`)
Approval gates required (per docs/runbooks/feature-workflow.md):
- [x] Platform lead approval (cross-cutting change touching every backend, both gRPC clients, and the
  deployment topology) + Security review
- [x] Affected service-owner approvals (each language's gRPC server+client credential swap)
- [ ] 2 service owners + platform lead (breaking proto change) — N/A (no proto change)

## Acceptance Criteria

See `acceptance.feature` (scenarios `@AC-*`) — the single source of acceptance truth (Constitution
**C-15**). Each `FR-N` above is covered by ≥1 tagged scenario there.

## Open Questions

- [ ] Mechanism (FR-3): statically mounted per-service certs + a rotation job, SPIRE/SPIFFE, or a
  cloud-managed CA on the DO App Platform? Trade operational complexity vs identity strength and
  rotation ergonomics.
- [ ] Rollout ordering (FR-1): mTLS must be turned on without a flag-day outage across ~12 processes.
  Is there a "permissive" interim mode (accept both plaintext and mTLS) to sequence the cutover, and
  how is it guaranteed off in production (FR-4)?
- [ ] Config surface (Config Key Changes): the exact cert-path / CA-bundle / enforce-toggle env or
  config keys, kept distinct from the `<SERVICE>_ENDPOINT` connection vars.
- [ ] Does the DO App Platform inter-component networking permit presenting/verifying custom client
  certs on gRPC, or does it terminate/re-originate TLS in a way that constrains the mechanism?
- [ ] Long-lived streaming RPCs across cert rotation (FR-6): re-handshake behavior and max stream
  lifetime.
