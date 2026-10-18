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

## Session 2026-10-17 (/sdd-design — round 2 synthesis + operator decisions)

- Round 2 adversary: NEEDS WORK, 0 Floor breaches, 0 C-16 regressions. Verified sound:
  - `drop_chunks(older_than => boundary)` drops exactly the chunks with `range_end <= boundary` and never the cutoff
    chunk;
  - `drop_chunks` works inside a tx with `SET LOCAL lock_timeout` under PgBouncer transaction mode;
  - the `classificationDB` retype compiles (pgxmock implements Begin);
  - the LATERAL query gets plan-time exclusion, and the PK gives batch == serial;
  - no snapshot consumer outside portfolio; drawdown HWM reads `account_balances.peak_equity`.
- **Operator decisions (2026-10-17):**
  - **Cache-age guard: ADD.** A `cacheQuote(ctx, q, since)` helper skips caching a quote with `q.Time < since` (outside
    the read window) or a zero time.
    - It is used at all 5 insert sites (`marketdata_service.go` :523, :582, :951, :972, :1339).
    - The quote is still returned to the caller.
    - This stops halted or delisted symbols recreating dropped chunks every 30s, and stops year-0001 chunks from
      `client.go:313/:501`'s ignored parse error.
  - **GetPnL: return Unavailable** when quotes are unavailable. This is an explicit operator sign-off of a scope
    addition.
    - It needs a `CodeUnavailable` mapping in `toGRPCError`/the handler wrap.
    - It must also cover symbols the batch *omits*, not just whole-RPC failure, so unrealized P&L is never a silent 0.
    - GetPnL has no caller in ui, agent or trading (grep-verified).
  - **Retention step: keep the 24h TIME step** (the original invariant). Each run drops
    `older_than => min(oldest_chunk_start + 24h, cutoff)`.
    - Progress is guaranteed, because the oldest chunk's `range_end` ≤ `start + 24h`.
    - The cache guard removes the re-creation pin.
    - The proposed "24 oldest chunks" refinement was **rejected**.
  - **31-day code floor: not adopted.** SetConfig bounds `[31, 3650]` stay. For values written directly to the DB, keep
    round 1's floor *guard*: skip the run with a WARN when `days*24 <= lookback_hours`. No silent clamp.
  - Run a third debate round.
- Minor fixes accepted:
  - the retention test pins the drop arg to the computed boundary, not the cutoff;
  - corrected lock math: about 4 relations per chunk on read (about 672 at 168h, 2,880 at 720h) and about 6 per drop
    (about 144 per 24h step), since chunks carry the PK, `quotes_time_idx`, `idx_quotes_symbol_time` and TOAST;
  - `balanceIDs` means "position load succeeded";
  - rename `watchlistConfig` to `intConfig`, with the `quoteTimeout()` nil guard;
  - record the snapshot-skip deviation;
  - step-7 doc drift: CLAUDE.md "DISTINCT ON" wording, the `marketdata_repo.go:309-312` comment, and the
    `quotes_days` row;
  - note that retention holds 1 PgBouncer slot for up to 30s each hour.
- Recorded follow-ups (out of scope):
  - share one quote fetch for checkRiskLimits + broadcastSnapshot per fill;
  - portfolio's other no-deadline calls (ledger QueryEvents :632, notify EmitAlert :892).

## Session 2026-10-18 (/sdd-design — round 3 synthesis + operator decisions)

- Round 3 adversary: NEEDS WORK, 0 Floor breaches, 0 hard C-16 regressions.
- Verified sound:
  - the cache guard covers every quotes write (5 sites);
  - GetPnL goes through `toGRPCError` (`portfolio_handler.go:276-279`), and no other RPC's code changes;
  - no existing GetPnL behaviour test breaks;
  - retention progress and the year-0001 sparse-chunk case are handled, with drain about 55h after the first pass;
  - the per-message config read cost is negligible.
- **Operator decisions (2026-10-18):**
  - **Partial results on cold failure: return the warm map and omit the failed cold symbols**, never zero-priced. The
    closure error is logged as WARN "GetLatestQuotes: cold fetch failed".
    - This reverses feature 178's recorded all-or-nothing waiver (`marketdata_service.go:589-594`) and aligns with
      the 227 omit-never-fail pattern.
    - GetPnL is unaffected: an omitted needed symbol still gives Unavailable.
  - **GetPnL values broker-synced positions from broker `current_price`** (no quote fetch), through the shared
    `applyQuotes` valuation rule. This is the @AC-6 valuation-source change, and it was acknowledged.
  - Run a fourth debate round.
- Accepted fixes:
  - @AC-5 traces to a service-level `errors.Is(err, ErrQuotesUnavailable)` test, a `classifyGetPnLError` table, and a
    `toGRPCError` Unavailable case test. A direct handler-plus-stub test is impossible: `PortfolioHandler.svc` is
    concrete.
  - GetPnL reuses `unvaluedSymbols` → `latestQuotesFor` → `applyQuotes`. Any position left with `CurrentPrice <= 0`
    gives `ErrQuotesUnavailable` with its symbol, and unrealized is `Σ (CurrentPrice − avg) · qty`.
- Open Risks to record in design.md:
  - GetPnL and ListPortfolios compute unrealized differently. This predates 229; parity is a follow-up.
  - One un-quotable offline holding makes the user's whole GetPnL permanently Unavailable. This is accepted per "never a
    silent 0".
  - Stale held symbols go live to Alpaca on every read, bounded by singleflight and the shared rate limiter.

## Session 2026-10-18 — sdd-design (approved)

- Round 4: the adversary verdict was SOUND/APPROVABLE, with 0 Floor breaches and 0 C-16 regressions. Three minor notes
  were folded in:
  1. Snapshot guard: also skip when positions exist but none was priced. This restores round 1's "no zero-equity
     snapshots" for the all-cold partial-result case.
  2. The test-(e) fake honours ctx, and the budget is seeded via `marketdata.quotes.batch_timeout_ms`.
  3. The @AC-8 WARN assertion is "at least one" (coalesced waiters each log one).
- Phase 0 Recon: recon.md (portfolio, marketdata, config; reuse the 227 detached budget, the classificationDB
  seam, and the poller shape).
- Phase 1 Grilling: 4 rounds, quick mode extended by operator request.
  - **Chosen approach:**
    - portfolio deadline 4000ms, plus one union quote batch in ListPortfolios;
    - LATERAL `LIMIT 1` quote readers with a 168h window, in Exec mode;
    - a detached cold-fetch budget with a partial result;
    - a cache-age guard at all 5 insert sites;
    - an app-level `drop_chunks` retention loop (24h step, with `lock_timeout`);
    - GetPnL returns Unavailable and values broker positions from broker `current_price`;
    - a snapshot skip.
  - **Rejected:** `add_retention_policy`, quote→bar rollup, DISTINCT ON plus a window, per-account deadlines, a
    24-oldest-chunks step, a 31-day clamp, GetPnL→Internal or a silent 0, all-or-nothing cold failure. The full list
    is in design.md.
- Constitution rules touched: C-01..03, C-05..08, C-10, C-13..18, P-03/P-04, F-04, F-06, F-07. Floor breaches: none.
- product-spec.md is aligned with the design:
  - quote_timeout default 4000, bounds [500,8000];
  - Fix Scope items 5-8 (cache guard, partial result, GetPnL, snapshot guard).
- acceptance.feature gains @AC-5..8.
- **Open Threads** (carried from design.md Open Risks):
  - [ ] Staging gates G1 (EXPLAIN), G2 (pg_locks ≤ 700), G3 (license, show_chunks, owner as the pooled role) and G4
        (DBA ack). Required before the reader and retention steps merge. They need DB access the session does not
        have, so the operator must run or arrange them.
  - [ ] Follow-ups:
    - GetPnL↔ListPortfolios unrealized parity;
    - partial snapshot understatement;
    - no deadline on portfolio ledger QueryEvents/notify EmitAlert;
    - one shared quote fetch per fill.
  - [ ] Monitor live Alpaca load from stale held symbols after deploy.
- Status: spec-ready → design-approved.
