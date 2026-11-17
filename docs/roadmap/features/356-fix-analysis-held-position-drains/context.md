# Context Log: fix-analysis-held-position-drains

Append-only. Each session appends a new ## Session entry. Never delete or edit prior entries.

---

## Session 2026-11-17 (/sdd-triage)

- Bug recorded via defect report `docs/reports/2026-11-17-analysis-held-position-drains-trust-page-token-defect.md` (no GitHub issue — Issues disabled): analysis held-position drains trust next_page_token and return partial results as success
- Source: feature 353 (`fix-listpositions-nextpagetoken-skips`) design § Open Risks follow-up
- Severity: SEV-3
- Routed to SDD path (Track C)
- Created: feature.md, product-spec.md, acceptance.feature (regression scenario), context.md
- Affected services (from report): xstockstrat-analysis (upstream, unchanged: xstockstrat-portfolio `ListPositions`)
- Root cause hypothesis: Both loops predate the token-looping consumer rule (feature 257) and copy the best-effort pattern: the exit trusts the server token and the error path returns accumulated state. Shared helper vs in-place hardening is an open design question (operator decision 2026-11-17: decide in design).
- Recommended design depth: quick → `/sdd-design fix-analysis-held-position-drains quick` (rationale: SEV-3, single service, no proto/migration/config — rubric says skip; operator chose quick so the helper-vs-in-place fork is debated)
- Development branch: feature/fix-analysis-held-position-drains
- Operator decision (2026-11-17): whether both drains share one helper or are hardened in place is decided in `/sdd-design` (not pre-constrained).
- Must PRESERVE `@AC-16 @feature-294` (`services/xstockstrat-analysis/acceptance/signal-map-instrumentation.feature`: a failed held drain is still counted) and `@AC-8 @feature-262` (`fix-analysis-owner-scope.feature`: drains stay owner-scoped).
- Sibling loops with the same shape (`live_loop.py:535` watchlists, `:601` signals, `:178` fundamentals universe) are out of scope unless design argues otherwise.
