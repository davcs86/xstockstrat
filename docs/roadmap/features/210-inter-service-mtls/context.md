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
- **Standalone**: no dependency on features 207/208/209/214. The agent DB-tooling remediation (feature
  214 `remove-agent-postgres-mcp`, which superseded demoted feature 212 `sysadmin-db-write-role`,
  formerly 193) explicitly scoped "inter-service mTLS (DT-3)" out as a separate design ticket.
- Created for pickup by another session per operator direction (Phase D security backlog).

## Session 2026-09-30 — sdd-review product-spec

- Product spec approved. Status: draft → spec-ready.
- Verdict: PASS (0 warnings) on re-review. First pass PASSed 10/11 criteria + all trading-domain
  checks; sole blocker was criterion 9 (five unchecked `- [ ]` Open Questions).
- Fix applied pre-advance: reframed `## Open Questions` → `## Design-Phase Decisions (deferred to
  /sdd-design)` — all items `[x]` with resolution pointers. These are genuine architecture forks
  (FR-3 itself names its mechanism "a design decision"), surfaced not silently guessed (P-03).
  A sixth item folds in the feature-084 deployment-file coordination note.
- Code-checkable claims all verified: 12 service names vs Service Registry, `xstockstrat-trading:50051`,
  4 streaming RPCs (StreamOrderUpdates/StreamEvents/WatchConfig/StreamAlerts), audit report path,
  env-var `<SERVICE>_ENDPOINT` convention, no proto/DB changes.
- Overlap findings: no FAIL-level collision (no proto-field / migration-NNN / duplicate-config-key).
  Soft rebase-level same-file overlap with feature 084 (`droplet-compose-deploy`) on
  `docker-compose.yml` / `.do/app.yaml` / `.do/app.dev.yaml`, and with (already-merged) 214 on the
  agent block — disjoint regions, rebase-only. No blocking merge-order row required; recorded as a
  design-agenda coordination note.
- F-07 tension flagged for design: an mTLS enforce-toggle served over WatchConfig would read config
  over the very channel mTLS secures — design must source the enforce flag + cert material outside
  the config stream (env/mounted).
- Branch `feature/inter-service-mtls` created from `main-dev` for this and subsequent phases.
