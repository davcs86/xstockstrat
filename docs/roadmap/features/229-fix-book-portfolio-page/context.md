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

## Session 2026-10-16 (/sdd-review product-spec — round 1 FAIL, spec revised)

- spec-reviewer returned FAIL with 3 blockers:
  1. `add_retention_policy` is TSL and unavailable on DO's Apache-edition TimescaleDB (backlog feature 040).
  2. Migration strategy unstated.
  3. Scenarios lacked concrete values, and @AC-4 was not observable.
- feature-overlap returned CLEAN:
  - No config/migration/proto collisions.
  - 215 shares `marketdata_service.go`, but in different functions (rebase-only).
  - It flagged feature 040's TSL constraint.
- **Operator decisions (2026-10-16):**
  - Retention is implemented as a marketdata background `drop_chunks` loop driven by the existing
    `marketdata.retention.quotes_days`. **No migration.** It supersedes feature 040's `marketdata.quotes` row.
  - Recency window: 7 days (`marketdata.quotes.latest_lookback_hours` default 168).
  - The operator asked whether old quotes could be "promoted to bars" instead of dropped. Answered no:
    - `marketdata.ohlcv` already holds Alpaca's authoritative, adjusted trade bars for the same warm-symbol set.
    - Mid-quote roll-ups (30s sampling, no volume) would be a lower-fidelity, conflicting second bar source (the
      feature 056 dual-source class).
    - It doesn't change the newest-quote window question.
  - The operator then chose the 7-day window.
- Spec revised:
  - Named 3 new keys plus the newly implemented retention key, with defaults and bounds. The retention floor is 31
    days, above the 30-day maximum window.
  - Added a detached singleflight budget (the 227 pattern) and a Consumer Surface section.
  - Rewrote @AC-1..4 with concrete values and observable outcomes.
