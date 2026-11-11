# Context Log: fix-auth-trust-hardening

Append-only. Each session appends a new ## Session entry. Never delete or edit prior entries.

---

## Session 2026-11-10 (/sdd-triage)

- Bug reported via defect reports (clustered triage):
  - docs/reports/2026-10-20-config-setconfig-internal-caller-no-peersan-defect.md (SEV-2)
  - docs/reports/2026-10-19-identity-revoketoken-unverified-decode-defect.md (SEV-3)
  - docs/reports/2026-10-29-agent-dcr-fail-closed-defect.md (SEV-2, security posture)
- Cluster rationale: all three are auth edges that trust unverified input (header without peer SAN, unsigned JWT,
  unknown policy treated as permissive) — one security-hardening review.
- Severity: SEV-2 (highest of cluster)
- Routed to SDD path (Track C); prod-impacting SEV-2 routed to C by operator decision 2026-11-10
- Created: status.md, feature.md, product-spec.md, acceptance.feature (3 regression scenarios), context.md
- Affected services (from reports): xstockstrat-config, xstockstrat-trading, xstockstrat-identity, xstockstrat-agent
- Root cause hypothesis: feature-102 grant lacks peerSan; identity uses jwt.decode; agent DCR reads are best-effort
  fail-open (feature 247 FR-2/AC-4).
- **Open decision carried forward:** the operator earlier kept agent-dcr-fail-closed open pending a fail-closed
  security-posture decision. Recorded as product-spec Open Question 1; it overrides feature 247 FR-2/AC-4 and needs
  explicit operator sign-off recorded here before design concludes. AC-3 assumes fail-closed.
- Recommended design depth: full → `/sdd-design fix-auth-trust-hardening` (rationale: SEV-2, security posture, 4 affected services)
- Development branch: feature/fix-auth-trust-hardening

## Session 2026-11-10 — sdd-review product-spec

- Product spec approved. Status: draft → spec-ready.
- Warnings: bug-template conventions (no FR-N/@FR tags; no Consumer Surface section); OQ1 (fail-closed DCR) needs operator sign-off before design concludes — AC-3 provisional and supersedes feature 247 FR-2/AC-4; trading poller SAN needs an acceptance line
- Overlap findings: WARN: configServiceImpl.ts shared with 314; agent shared with 314/322/328/331
- Recommended design depth: full (security posture; config/trading/identity/agent)
- Tree: ccr-500a9eb9-nvk45x (origin/main-dev 0fecb24d + triage/docs commits; no feature branch yet)

## Session 2026-11-10 (operator decisions before /sdd-design)

- Operator signed off **fail-closed DCR**: `/oauth/register` returns 503 and issues no client_id when `oauth.registration_enabled` or `oauth.allowed_redirect_uris` cannot be read. Supersedes feature 247 FR-2/AC-4 (201 on a stall) — `/sdd-design` marks that promoted scenario superseded (C-16). Identity-side allowlist enforcement is not in scope.
- AC-3 precondition reworded: since feature 295 the policy is read from the WatchConfig snapshot, so a GetConfig stall no longer causes a read failure; the failing case is a missing/unreadable snapshot.
