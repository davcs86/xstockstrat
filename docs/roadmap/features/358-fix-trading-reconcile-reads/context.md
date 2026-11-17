# Context Log: fix-trading-reconcile-reads

Append-only. Each session appends a new ## Session entry. Never delete or edit prior entries.

---

## Session 2026-11-17 (/sdd-triage)

- Bug recorded via defect report `docs/reports/2026-11-17-trading-reconcile-reads-first-500-positions-defect.md` (no GitHub issue — Issues disabled): trading reconcile reads only the first 500 platform positions per account
- Source: feature 353 (`fix-listpositions-nextpagetoken-skips`) design § Open Risks follow-up
- Severity: SEV-2
- Routed to SDD path (Track C)
- Created: feature.md, product-spec.md, acceptance.feature (regression scenario), context.md
- Affected services (from report): xstockstrat-trading (upstream, unchanged: xstockstrat-portfolio `ListPositions`)
- Root cause hypothesis: Reconcile assumed one page per account while the token was unreliable (fixed by feature 353). Fix: drain the cursor, failing closed per `docs/roadmap/ledger/fails.md:3311` (page error → skip the account for the tick), tested against a fake that ignores the token.
- Recommended design depth: quick → `/sdd-design fix-trading-reconcile-reads quick` (rationale: SEV-2, single service, no proto/migration/config)
- Development branch: feature/fix-trading-reconcile-reads
- Twin: feature 357 `fix-portfolio-internal-position` (portfolio internal readers), split by operator decision 2026-11-17.
- A false finding halts the account — the fail-safe direction is skip-the-tick, never a halt on an incomplete read.

## Session 2026-11-17 — sdd-review product-spec

- Product spec approved. Status: draft → spec-ready.
- Warnings (criteria verdict: PASS WITH WARNINGS, no fails, no floor breaches):
  1. C-2 (trading domain): FR-4 did not name broker types — **resolved** this session: FR-4 now states the change is broker-agnostic (portfolio read only) and covers every broker type `reconcileTick` covers today except `BROKER_TYPE_OFFLINE`, which `reconcileTick` already skips (`trading.go` offline-skip in the broker map build).
  2. Criterion 8: `@FR-4` attaches only to AC-1 with no named broker type; FR-4's "order-side reconcile and `GetPositions` unchanged" clause relies on the existing order-side tests — accepted for a bug fix, open for design.
  3. FR-2 also covers a deadline failure; AC-2 tests only `Unavailable` — advisory (same `ppErr`-style skip path); design may add a deadline case.
  4. The batch-supplied feature path was malformed (`docs/roadmap/features/docs/roadmap/features/358-…/`); the files live at `docs/roadmap/features/358-fix-trading-reconcile-reads/` — caller path issue, not a spec issue.
  5. Dependency on feature 353 (code-completed, must merge first) is stated in prose only — carry it into merge-order/status tracking so 358 cannot merge ahead of 353 (not edited here: this session may edit only this feature dir).
- Overlap findings: none (overlap verdict PASS, no collisions).
- Recommended design depth: quick (SEV-2 bug, single service xstockstrat-trading, no proto/migration/config/consumer-surface change).

OPERATOR DECISIONS (binding, recorded 2026-11-17):
- Operator 2026-11-17: split from feature 357 (portfolio internal readers); scope is only trading reconcileTick's platform-position read.
- Fail-safe direction is skip-the-account-for-the-tick on any incomplete read, never a halt; follow docs/roadmap/ledger/fails.md:3311 (fail closed, reject a repeated token, test against a fake that ignores the token).
- Do not touch features 351, 353 or 354.
- Red-before-green is mandatory.
