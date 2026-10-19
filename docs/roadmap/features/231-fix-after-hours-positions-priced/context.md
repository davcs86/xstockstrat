# Context Log: fix-after-hours-positions-priced

Append-only. Each session appends a new ## Session entry. Never delete or edit prior entries.

---

## Session 2026-10-19 (/sdd-triage)

- Found during the feature 229 post-merge staging investigation, then recorded as defect report
  `docs/reports/2026-10-19-after-hours-one-sided-quote-half-price-defect.md`. Issues are disabled.
- Severity: SEV-2 (operator-confirmed). Routed to SDD path (Track C) by operator choice. Environment:
  staging; production runs the same code.
- Created: feature.md, product-spec.md, acceptance.feature (regression scenarios AC-1..4), context.md.
- Affected services: xstockstrat-portfolio, xstockstrat-marketdata.
- Root cause hypothesis: one-sided after-hours quote averaged as `(ask + bid) / 2` at 5 sites. This is not a
  regression from feature 229: the formula has been present since at least `6d06894`.
- Recommended design depth: full → `/sdd-design fix-after-hours-positions-priced` (rationale: 2 affected
  services; the fallback-price choice and a possible `Quote` proto field are design forks).
- NNN: 230 is claimed by two in-flight branches (`230-fix-etf-flag-fill`, `230-offline-account-full-pnl`),
  so this feature takes 231. That existing 230 collision is not this feature's to resolve.
- Branch: triage committed on harness-assigned `ccr-9f55a8ac-dtw4iv`, off `main-dev` (as feature 229 did).
