# Context Log: fix-listpositions-nextpagetoken-skips

Append-only. Each session appends a new ## Session entry. Never delete or edit prior entries.

---

## Session 2026-11-16 (/sdd-triage)

- Bug reported via defect report `docs/reports/2026-11-16-portfolio-listpositions-page-token-skips-boundary-row-defect.md` (sidecar stamped triaged)
- Severity: SEV-2, environment dev (main-dev) -> Track C (SDD path)
- Affected services: xstockstrat-portfolio; callers analysis, agent
- Root cause hypothesis: look-ahead token + non-unique symbol keyset
- Design depth: full (user choice; rubric default was quick) -> `/sdd-design fix-listpositions-nextpagetoken-skips`
- Open question for design: handling of legacy bare-symbol tokens from in-flight clients (user: decide in design)
- Out of bounds: sibling ListWatchlists report, feature 351
- Development branch: feature/fix-listpositions-nextpagetoken-skips

---

## Session 2026-11-16 — sdd-design (round 1 of full debate)

- Phase 0 Recon: recon.md written (portfolio, analysis, agent, scenario-recon). No existing @AC pins ListPositions pagination; all PRESERVE.
- Round 1: proposer = composite (symbol, trading_mode, account_id) base64(JSON) cursor from the last returned row, reject malformed tokens (InvalidArgument). Adversary: no Floor breach; one blocking-for-approval objection (O-1: test-pin arg-shape blast radius); missed consumer `/trader/positions` added to product-spec. See debate.md.
- Pending user steer: O-1 arg shape (a/b/c).
