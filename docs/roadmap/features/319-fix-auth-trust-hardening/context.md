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
