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

## Session 2026-11-16 — sdd-design (round 2, approved)

- Round 2: O-1 resolved by option (b) (single text[] cursor arg every page; 3 exact pins change at offline_account_pnl_test.go:530,531,572). Adversary agreed; conditions folded into D-8 (mandatory Exec-mode dbtest subtests, special-char/NULL account_id row, matcher for non-nil empty slice, reuse testUserID cleanup).
- Chosen approach: composite (symbol, trading_mode, account_id) base64url(JSON) cursor from the last returned row; reject malformed/legacy tokens as InvalidArgument (deliberate departure from marketdata resume-page-1). Rejected: R-1..R-8 (see debate.md).
- Constitution rules touched: C-01, C-08, C-10, C-13, C-14, C-15, C-16, C-18, P-06; Floor breaches: none.
- Open Threads: exec-mode encoding risk -> test step; plan-shape note; deploy-straddle (confirm QueryStateMessages on /trader/positions) -> spec step; follow-up defect reports (analysis drain hardening, WatchlistRepo.ListByUser, internal 500-row truncation) to file after merge.
- Status: draft -> design-approved.
