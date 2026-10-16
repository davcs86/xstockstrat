# Context Log: fix-book-portfolio-page

Append-only. Each session appends a new ## Session entry. Never delete or edit prior entries.

---

## Session 2026-10-16 (/sdd-triage)

- Bug recorded as defect report `docs/reports/2026-10-16-portfolio-page-stuck-loading-defect.md` (GitHub Issues disabled);
  the operator reported it with a staging screenshot of Book → Portfolio stuck on "Loading portfolio…".
- Severity: SEV-2 (dev/staging) → Track C.
- Created: feature.md, product-spec.md, acceptance.feature (AC-1..4 regression scenarios), context.md.
- Affected services: xstockstrat-portfolio, xstockstrat-marketdata, xstockstrat-config (bounds); ui surface only.
- Root cause (verified in code and staging logs, 2026-10-16):
  - Portfolio `latestQuotesFor` has no deadline.
  - Marketdata `GetLatestQuotesBatch` has no time predicate over the 1h-chunk, never-pruned `marketdata.quotes` hypertable.
  - Marketdata's 2-conn pool is starved.
  - Evidence and log excerpts are in the defect report.
- **Operator decisions (2026-10-16, AskUserQuestion):**
  1. Scope = portfolio deadline + bounded batch quote query + a `marketdata.quotes` retention-policy migration.
  2. Tunables are config keys (227 pattern: live read, code default, SetConfig bounds), not constants.
  3. Track C with **quick** design depth. C-0's signals (migration, ≥2 services) point to **full**. The operator
     explicitly chose quick, which overrides that recommendation.
- Development branch: the harness assigned `ccr-9f55a8ac-dtw4iv` (based on `origin/main-dev` @ a8a3cfd), and the session
  must push only there. This replaces the conventional `feature/fix-book-portfolio-page`, and the final PR targets
  `main-dev` from that branch.
