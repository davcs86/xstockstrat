# Context Log: fix-vendor-key-in-url

Append-only. Each session appends a new ## Session entry. Never delete or edit prior entries.

---

## Session 2026-11-10 (/sdd-triage)

- Bug reported via defect report (Issues disabled): docs/reports/2026-10-29-marketdata-vendor-key-url-residuals-defect.md — "marketdata vendor API keys still ride in the request URL (redirect-parse residual + access logs)"
- Cluster rationale: single report (feature 254's accepted residuals); both paths close with one fix — the key leaves the query string.
- Severity: SEV-2 (secret-disclosure)
- Routed to SDD path (Track C); prod-impacting SEV-2 routed to C by operator decision 2026-11-10
- Created: feature.md, product-spec.md, acceptance.feature (regression scenarios @AC-1..2), context.md
- Affected services (from report): xstockstrat-marketdata
- Root cause hypothesis: key in query string; recommended class fix is header auth (vendor support unverified) + optional shared `redactURLError`
- Recommended design depth: full → `/sdd-design fix-vendor-key-in-url` (rationale: SEV-2 security / secret-disclosure escalation signal; vendor header-auth support is an unverified design fork)
- Development branch: feature/fix-vendor-key-in-url
