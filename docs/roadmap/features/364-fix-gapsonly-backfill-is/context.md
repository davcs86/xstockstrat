# Context Log: fix-gapsonly-backfill-is

Append-only. Each session appends a new ## Session entry. Never delete or edit prior entries.

---

## Session 2026-11-25 (/sdd-triage)

- Bug reported via defect report `docs/reports/2026-11-25-gaps-only-backfill-blind-to-interior-holes-defect.md` (GitHub Issues disabled): GAPS_ONLY backfill is blind to interior holes and reports COMPLETED
- Severity: SEV-2
- Routed to SDD path (Track C) — operator chose SEV-2 / dev over a production hotfix (strategies fail closed on a missing SMA200; FULL backfill is a working manual remediation)
- Created: feature.md, product-spec.md, acceptance.feature (regression scenario), context.md
- Affected services (from report): xstockstrat-marketdata, xstockstrat-ingest
- Root cause hypothesis: GetCoverage returns only (earliest, latest, count); ComputeGaps derives head/tail gaps only (timeframe.go:82-99)
- Recommended design depth: full → `/sdd-design fix-gapsonly-backfill-is` (rationale: ≥2 affected services plus GAPS_ONLY consumer surfaces in ui/agent — escalate-to-full signal)
- Development branch: feature/fix-gapsonly-backfill-is
- Remediation already applied out-of-band on homelab staging (2026-11-25): FULL + overwrite backfill of all 381 watchlist symbols, 2025-11-20..2026-11-25; sma200-UNSPECIFIED queue rows fell 27 → 8 (the remaining 8 have no vendor data).

## Session 2026-11-26 — sdd-review product-spec

- Product spec approved. Status: draft → spec-ready. Criteria verdict PASS WITH WARNINGS (0 fails, 0 floor breaches).
- Warnings:
  - Criterion 2/8 (FR-2 vs AC-2): FR-2 is disjunctive (non-COMPLETED terminal state OR reports still-missing sessions), and AC-2's first Then is hedged and never names the terminal status; the second Then does not say where the missing range appears (`get_backfill_status` field vs job result). **Deferred to design** — that choice decides whether the strat-lab `backtest` skill must change.
  - Criterion 8 (AC-3): "requested 0 bars from the vendor" was not observable through a named surface. **Resolved here**: AC-3 now asserts `get_backfill_status reports bars_processed 0 for the job` (`BackfillJob.bars_processed`, ingest proto).
  - Criterion 8: no scenario covers the FR-2 carve-out for sessions the vendor legitimately has no bar for (halted / not-yet-listed). **Deferred to design**: add a scenario once the decision is recorded in design.md so the exception cannot mask a false COMPLETED.
  - Criterion 11: UI/agent behavior for a non-COMPLETED or partial-missing status is "no code change expected". **Deferred to design**: confirm the UI renders the chosen status (strat-lab skill update already conditioned in the spec).
  - C-14/C-15: AC-1/AC-2 use fixed 2025/2026 windows and real tickers; AC-1 depends on an unpinned trading-session calendar. Acceptable for a regression guard; **design must pin the holiday-calendar source** so "every trading session" is deterministic.
- Overlap findings: none (overlap verdict PASS, no collisions).
- Recommended design depth: full (2 code-changing services, marketdata + ingest, plus GAPS_ONLY consumer surfaces in ui/agent; possible additive proto change to `GetDataCoverage`).

### OPERATOR DECISIONS (binding, recorded 2026-11-26)

- Operator 2026-11-25: SEV-2, environment dev (main-dev) -> Track C (not a production hotfix); strategies fail closed on a missing SMA200 and a FULL backfill is a working manual remediation.
- Root cause evidence: services/xstockstrat-marketdata/internal/timeframe/timeframe.go ComputeGaps derives only head/tail gaps from (earliest, latest, count) — 'interior holes out of scope'; ingest GAPS_ONLY planner (services/xstockstrat-ingest/app/handlers/servicer.py _plan_work_ranges) consumes cov.gaps. Consumers relying on GAPS_ONLY: xstockstrat-ui 'Backfill missing data' (feature 343, non-admin), agent-scheduled backfills (feature 054 default).
- Observed on homelab staging: SCHW/IDXX/~19 symbols missing 2026-04-01..2026-09-25; remediated out-of-band 2026-11-25 with FULL+overwrite backfill (8 jobs, ~96k bars).
