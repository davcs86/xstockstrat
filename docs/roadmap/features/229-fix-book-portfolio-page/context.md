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

## Session 2026-10-16 (/sdd-review product-spec — round 2 PASS WITH WARNINGS)

- Product spec approved. Status: draft → spec-ready.
- Fixed in-review:
  - @AC-1 is now a Scenario Outline over ListPositions + ListPortfolios (C-10(b) parity).
  - Feature 040's `marketdata.quotes` row is marked superseded by 229.
- Warnings carried into design as **requirements**:
  - [ ] First retention run drops in bounded batches. The staging backlog is about 1,250 hourly chunks (about 3,750
        AccessExclusive locks), and a single call risks SQLSTATE 53200 (feature 153 class).
  - [ ] The recency predicate ships before or with the retention loop, so unbounded readers don't contend with the drops.
  - [ ] Confirm on staging that `drop_chunks` is available (`SHOW timescaledb.license`, `show_chunks` dry run) and that
        marketdata's pooled role owns `marketdata.quotes`. The loop WARN-logs on failure and never crashes.
  - [ ] Record the window lock arithmetic: about 3 locks per chunk, so 168h ≈ 504 and 720h ≈ 2,160 per scan against
        the ~25,600 lock budget. It relies on plan-time chunk exclusion (`now() - interval` or an inlined cutoff).
  - [ ] State the relationship between `marketdata.quotes.batch_timeout_ms` and `portfolio.marketdata.quote_timeout_ms`.
  - [ ] Seeding: seed the three new keys or record a waiver (config existence gate; 227 precedent).
  - [ ] Get DBA acknowledgement for automated, irreversible quote deletion. No migration means C-07 is not formally
        triggered.
- Overlap findings: none blocking (215 rebase-only on `marketdata_service.go`).

## Session 2026-10-16 (/sdd-design quick — Phase 0 + round 1)

- Phase 0: recon.md written; 3 codebase-discovery passes plus scenario-recon (20 relevant @AC rules, 0 CHANGE).
- Round 1 adversary: NEEDS WORK, 0 Floor breaches. Mechanism claims verified sound:
  - header propagation;
  - pgx per-query `QueryExecModeExec`;
  - unnamed-statement custom plan, so plan-time chunk exclusion;
  - `drop_chunks` and `timescaledb_information.chunks` are Apache-licensed.
- Synthesized resolutions:
  1. ListPortfolios makes ONE union `latestQuotesFor` call across accounts. Per-account calls meant N × deadline and
     cross-account valuation drift (C-10(b)).
  2. Portfolio ListPortfolios readers move to the `r.db` pgxmock seam.
  3. `latestQuotesFor` returns `ok`:
     - `broadcastSnapshot` skips persist/emit/broadcast on `!ok` (no zero-equity snapshots);
     - `GetPnL` returns Unavailable on `!ok`.
  4. Batch reader becomes `unnest($1) CROSS JOIN LATERAL (… LIMIT 1)`. That matches the singular shape, so
     @AC-1 @feature-178 parity holds by construction, and it reads about 1 tuple per symbol instead of every row in the
     window (no SkipScan on Apache).
  5. Retention:
     - first pass after 1h;
     - each step `BEGIN; SET LOCAL lock_timeout='2s'; drop_chunks; COMMIT`;
     - one 24h step per run (the backlog drains in about 52h);
     - WARN-only on failure;
     - TOAST makes it about 5 relations per chunk, about 120 locks per step.
  6. Pre-merge gates: staging EXPLAIN (chunk exclusion plus ordered append), a `pg_locks` count, and DBA
     acknowledgement before retention ships.
- **Operator decisions (2026-10-16):**
  - `portfolio.marketdata.quote_timeout_ms` default **4000** (was 2500), bounds [500, 8000]. That is above the
    marketdata cold budget (2500) plus warm-read headroom, and changes a product-spec default.
  - Retention cadence (1h), first-pass delay (1h), `lock_timeout` 2s, 24h step and 30s statement backstop are
    **documented fixed invariants** in marketdata CLAUDE.md (215 precedent). This explicitly narrows operator decision
    2 for these operational values; `marketdata.retention.quotes_days` stays the only retention key.
  - Run a second debate round before approval.
