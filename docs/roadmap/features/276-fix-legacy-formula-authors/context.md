# Context Log: fix-legacy-formula-authors

Append-only. Each session appends a new ## Session entry. Never delete or edit prior entries.

---

## Session 2026-10-22 (/sdd-triage)

- Bug reported via defect report `docs/reports/2026-10-22-indicators-legacy-username-formula-authors-defect.md` (Issues disabled)
- Severity: SEV-2, environment dev (staging) → Track C
- Created: feature.md, product-spec.md, acceptance.feature (regression scenarios), context.md
- Affected services: xstockstrat-indicators
- Root cause hypothesis: pre-migration rows never backfilled from username to user id
- Recommended design depth: full → `/sdd-design fix-legacy-formula-authors` (rationale: a data rewrite on ownership rows is mentioned, and production has not been checked)
- Development branch: feature/fix-legacy-formula-authors
- Scope boundary with 275: 275 reports the failure instead of hiding it; this feature removes the cause.
- Open questions for design: are there production rows and other legacy-username authors; how the username maps to a user id (identity lookup vs a fixed mapping); delivery shape (migration vs script vs admin RPC) and rollback; whether the read guard should reject non-user-id authors at write time.
