# Context Log: fix-ohlcv-chunk-lock-oom

Append-only. Each session appends a new ## Session entry. Never delete or edit prior entries.

---

## Session 2026-08-24 (/sdd-triage)

- Bug reported via defect report `docs/reports/2026-08-24-ohlcv-lock-table-exhaustion-recurrence-defect.md`
  (GitHub Issues disabled on this repo — `--from-report` path).
- Severity: SEV-2. Environment: staging (= dev deploy, not production/main) → **Track C (SDD path)**.
- Config-only: **partial** — a `max_locks_per_transaction` cluster bump is immediate relief, but the
  durable fix is a marketdata schema migration; it is NOT a WatchConfig key, so this is not Track B.
- Created: feature.md, product-spec.md, acceptance.feature (2 regression scenarios), context.md.
- Affected services: xstockstrat-marketdata (root cause / query target), xstockstrat-analysis
  (caller), DO managed PostgreSQL cluster `xstockstrat` — 2 services + cluster.
- Root cause: **confirmed high-confidence** (upgraded from 141's low). ohlcv chunked at 1 day
  (`migrations/001:23-28`) × 400-day lookback (`servicer.py:250`) → ~400 chunk locks per QueryBars,
  exhausting the ~1,600-slot lock table on `db-s-1vcpu-1gb` (`max_locks_per_transaction=64`,
  `max_prepared_transactions=0`). Live evidence: staging deploy `8027bc2c...`, analysis RUN log
  2026-08-24T19:51:06Z, `EvaluateReadiness: bars fetch failed for AMD ... SQLSTATE 53200`.
- **Relationship to feature 141** (`fix-opportunities-bars-fetch-oom`, launched 2026-08-19): this is
  the recurrence 141's design.md Open Risk 1 explicitly named. 141's dedup + `_bars_fetch_sem`
  covered only `_compute_opportunities`; the current failure is from the unguarded `EvaluateReadiness`
  path (`servicer.py:2791`), and each individual 400-day query still locks ~400 chunks regardless of
  141's concurrency bound. Do NOT re-guess app-level dedup as the sole fix — 141 already told us to
  escalate to the chunk-interval / Postgres-tuning alternatives it deferred.
- **Operator decision (AskUserQuestion, 2026-08-24):** pursue BOTH remediations —
  (1) raise `max_locks_per_transaction` on the cluster (immediate relief) and
  (2) widen the ohlcv chunk interval via a new marketdata migration (durable root-cause fix).
  Extending 141's guard to `EvaluateReadiness` was surfaced as optional blast-radius reduction, to be
  decided at design.
- **Slug deviation (noted, P-03):** the triage rule's literal "first-3-words-of-title" would produce
  the meaningless `fix-out-of-shared`; chose the descriptive `fix-ohlcv-chunk-lock-oom` instead, kept
  in the 141 `fix-...-oom` family.
- **Numbering note:** used NNN = **153** = `max(existing NNN 152) + 1`. The skill's C-2 `count+1`
  formula produced 156 (155 numbered dirs exist but the max is 152, i.e. gaps exist); the root
  CLAUDE.md rule is `max + 1`, so 153 is correct and 153–155 were confirmed free.
- Recommended design depth: **full** (DB migration + affected services ≥ 2, and an open question on
  whether `max_locks_per_transaction` is settable via `db-cluster-update-psql-config`) →
  `/sdd-design fix-ohlcv-chunk-lock-oom`.
- Development branch: `feature/fix-ohlcv-chunk-lock-oom` (harness session branch is
  `claude/do-logs-shared-memory-0o994w`; a design/execute session should confirm the effective branch
  per the 141 boot-correction precedent).

### Open questions for design
- Re-chunk existing ohlcv chunks to the new interval, or apply future-only and let 1-day chunks age
  out? Re-chunking a populated production hypertable is heavier and needs a DBA call.
- Chunk-interval target (30 days ⇒ ~14 chunks/400-day query; other values on the table).
- Is `max_locks_per_transaction` settable on this DO plan via `db-cluster-update-psql-config` (it was
  absent from the current `get-postgresql-config` response), and does the bump require a restart /
  brief downtime?
- Should the `EvaluateReadiness` (and live-loop) 400-day paths get 141's dedup/semaphore guard in the
  same fix, or is the migration + lock bump sufficient on its own?

## Session 2026-08-24 — sdd-review product-spec

- Product spec approved. Status: draft → spec-ready. Verdict: PASS WITH WARNINGS (no blockers); overlap CLEAN.
- Criteria pass (spec-reviewer): every cited file:line verified; both service names match the registry;
  `max_locks_per_transaction` correctly characterized as a Postgres server parameter (not a WatchConfig
  app key — no C-05/F-07 breach); new-migration-not-editing-001 respects F-01.
- Overlap pass (feature-overlap): CLEAN — no in-flight collisions. marketdata migration **004** is the free
  next number (trunk tops out at 003). Features 141 (`_bars_fetch_sem` guard) and 143 (daily-bars-only) are
  **launched** reuse targets, not concurrent collisions; backtest 150/151 touch a disjoint servicer.py region.
  No merge-order entry required. Re-derive the migration NNN from the merged tree at /sdd-spec time (ledger practice).
- Warnings and disposition:
  - [x] C-14 consumer surface — **FIXED**: added `## Consumer Surface(s): None — internal/platform-only` to product-spec.
  - [ ] Criterion 9 — two unchecked Fix-Scope items + two open questions (re-chunk existing vs. future-only;
        is `max_locks_per_transaction` settable via `db-cluster-update-psql-config`). **Deferred to /sdd-design (full)**
        by design — the product→spec-ready gate precedes design; design MUST close both before /sdd-spec.
  - [ ] C-15 — acceptance scenarios use qualitative phrasing (chunk counts / interval values) because the exact
        target interval is a design decision; **/sdd-spec pins the concrete values** once design picks the interval.

## Session 2026-08-24 — sdd-design (full, 3 rounds)

- Phase 0 Recon: wrote recon.md from parallel codebase-discovery (marketdata + analysis) + scenario-recon.
  Key facts: next marketdata migration = 004; 003 is the only prior ohlcv-touching migration (remediation-log
  pattern, for a DATA-MOVING migration); no Timescale-admin-migration precedent; `set_chunk_time_interval`
  affects only FUTURE chunks; full guarded-vs-unguarded map of the 400-day bars-fetch call sites; no promoted
  @AC-* covers the bars path.
- Phase 1 Grilling: 3 full rounds.
  - R1: proposer = 3 pieces (future-only migration + max_locks runbook + app guard on EvaluateReadiness).
    Adversary = NEEDS-WORK: deferred-relief gap; max_locks settability unproven (P-03 "exercise the producer");
    app guard is a partial fix of 1 of 5 identical paths (C-10); proposed **client-side time-windowed fetch**
    as the in-repo immediate lever.
  - Between rounds: **confirmed `max_locks_per_transaction` IS settable** — it appears in the DO
    `db-cluster-update-psql-config` accepted-config schema (absent from the `get` response only because it sits
    at its default). This dissolved the adversary's core P-03 objection.
  - R2: proposer = 2 pieces A+B (max_locks bump + migration 004), app guard DROPPED as over-build; interval 30d.
    Adversary = NEEDS-WORK (no Floor breach): surfaced the out-of-repo/deferred-relief FORK (P-03/C-11) as a
    user decision; AC-1 must name 2 assumptions (plan-time chunk exclusion; unbounded concurrency residual);
    the DO$$ preflight is cargo-culted for a metadata-only call; the "30d preserves QueryRecentBars granularity"
    rationale is FALSE (LIMIT query opens ~1 chunk regardless).
  - **User gate after R2**: chose "run another round" to press re-chunk-existing + the concurrency residual.
  - R3: proposer held A+B; REJECTED out-of-band re-chunk (additive to A, unverifiable pre-deploy, races the
    live ingester, F-05); ACCEPTED the residual; fixed the 30d rationale to the sound one (finer pruning for
    the BOUNDED-range QueryBars). Adversary = **APPROVE-READY**, converged, no Floor breach; must-land-in-design
    items: 004-alone-doesn't-resolve-SEV-2 + acceptance gated on "Piece A applied & holding in staging"; the
    max_connections≈25 basis for the lock arithmetic.
- **User approval (2026-08-24)**: approved A+B **with max_locks = 1024** (over the debate's 512) to eliminate
  the transition-window concurrency residual outright (~16 concurrent worst-case scans, ~7MB on the 1GB box).
- Chosen approach: (A) raise cluster `max_locks_per_transaction` 64→1024 (immediate, global, user-gated
  rolling restart, documented in a runbook); (B) marketdata migration 004 `set_chunk_time_interval('marketdata.ohlcv','30 days')`
  — metadata-only, future-only, faithful down to 1 day, NO remediation-log/DO$$ preflight. No app-code change.
- Rejected: out-of-band re-chunk; app-side time-windowing; extending 141's guard; max_locks 256/512; 90d interval;
  quotes-hypertable widening.
- Constitution rules touched: F-01/F-05/F-06/F-07 (honored), C-01/C-08/C-10/C-11/C-14/P-03, F-11 (no breach).
- Status: spec-ready → design-approved.

### Open Threads (carried from design.md Open Risks)
- Immediate relief is 100% out-of-repo (Piece A restart); CI can't gate it → acceptance gates on "Piece A
  applied + holding in staging". Target: /sdd-spec verification step + operator/infra step.
- Transition concurrency residual largely eliminated at 1024 but not provably zero (EvaluateReadiness unguarded)
  → accepted; re-add app guard only if telemetry shows sustained high concurrency.
- `max_connections≈25` is an assumed constant → confirm the DO plan value at /sdd-spec or /sdd-execute.
- Re-derive migration NNN 004 against the merged tree at /sdd-spec time (stale-NNN trap).

## Session 2026-08-24 — Piece A applied (operator action, user-authorized)

- User authorized applying the immediate fix now. Raised DO cluster `xstockstrat`
  (`1b5ad082-8145-4e09-bdcf-936adfc21f2a`) `max_locks_per_transaction` **64 → 1024** via
  `db-cluster-update-psql-config`. Confirmed via `get-postgresql-config`: `max_locks_per_transaction: 1024`
  (now shows as an explicit override).
- Single-node cluster → the parameter change triggered a brief DB restart affecting both
  `xstockstrat-staging` and `xstockstrat-production` DBs. Observed the expected transient ripple in
  analysis RUN logs ~21:25 UTC (pnl-consumer/live-loop `StreamEvents` to ledger :50057 refused while
  the directly-connected Node services reconnected to the restarted DB); self-healed by 21:25:37.
  Post-change: all 12 app components HEALTHY 1/1; **0 `SQLSTATE 53200`** in the post-restart window.
- Acceptance impact: the design's "Piece A applied + holding in staging" checkpoint is now **partially
  met** — parameter set + cluster healthy. Full confirmation (a 400-day EvaluateReadiness/opportunity
  scan completing with no 53200) will show on the next readiness cycle; last 53200 was 19:51 UTC,
  pre-change.
- **/sdd-execute impact:** the operator/infra step is now "verify max_locks=1024 is live," not "apply
  it." Piece B (migration 004) still to be built via /sdd-spec → /sdd-execute.

## Session 2026-08-24 — sdd-spec

- Generated implementation-spec.md with **3 steps**. Status → implementation-ready.
- Shape: **no application-code change** (per design). Steps are 1× `migration` + 2× `docs`; there is
  no `service` step, so no paired unit-`test` step (C-08 pairing is predicated on a service step).
- Scenario coverage (C-15): **AC-2** → Step 1 (offline migration up/down inspection; real apply +
  dimension assert at `db-migrator` PRE_DEPLOY); **AC-1** → Step 2 (countable lock-budget arithmetic
  invariant documented in the runbook, per design's F-05-respecting plan — deliberately NOT a live
  53200 reproduction). Both stated explicitly in the spec's `## Scenario Coverage` so /sdd-review
  sees the non-code coverage was a design decision, not an omission.
- Key codebase findings:
  - **Migration NNN re-derived = 004** (stale-NNN trap, design Open Risk 4): `git ls-tree
    origin/main-dev services/xstockstrat-marketdata/migrations/` tops out at `003_canonicalize_
    ohlcv_timeframe`; every existing `004_*` file is in a **different** service (analysis/config/
    identity/indicators/ingest), not marketdata. Confirmed on origin/main and the working tree too.
  - `001_marketdata_hypertables.up.sql:23-28` sets `chunk_time_interval => INTERVAL '1 day'`; PK
    `(symbol,timeframe,time)` `:20`, indexes `:31,:33` → 4 relations/chunk (the ×4 in the lock math).
  - `003` pattern reuse-with-subtraction: its `DO $$` compressed-chunk pre-flight and
    `ohlcv_remediation_003` audit table exist only because `003` moved rows — **both omitted** for the
    metadata-only `set_chunk_time_interval` call (no rows move; no compression on this table).
  - Piece A (max_locks 64→1024) is **already applied** (prior context session) — Step 2 documents +
    verifies it (runbook `docs/runbooks/ohlcv-lock-budget-tuning.md` + index row in
    `docs/runbooks/CLAUDE.md`), it does not re-apply it.
  - Doc-drift caught for Teardown: `services/xstockstrat-marketdata/CLAUDE.md` § Database and
    `docs/patterns/database.md:9` both say ohlcv "chunk = 1 day" → Step 3 updates them for the 30-day
    future-chunk interval.
- Reviewers snapshot written to feature.md: DBA + xstockstrat-marketdata (from the one migration
  step); the two docs steps have none.
- `max_connections ≈ 25` for `db-s-1vcpu-1gb` remains a **named assumption** for the AC-1 arithmetic
  (design Open Risk 3) — flagged in Step 2 to confirm at execute time; conclusion insensitive ~22–25.

### Decisions
- No `service`/`test` code step: the fix is a hypertable chunk-interval metadata change (migration
  004) + an out-of-repo Postgres server-parameter bump (Piece A, documented only). Acceptance is
  arithmetic invariant (AC-1) + offline migration up/down (AC-2), never a live-53200 reproduction.

### Open Threads (carried)
- Acceptance not met until "Piece A applied + holding in staging" is verified (design Open Risk 1) —
  Step 2 owns the verification/gate; Piece A already applied and holding per prior context session.
- Confirm the DO plan's `max_connections` at /sdd-execute (Open Risk 3); conclusion unchanged ~22–25.

## Session 2026-08-24 — sdd-review impl-spec (advisory)

- Result: 0 failures, 0 warnings (advisory — did not block). Verdict: PASS. Overlap: CLEAN.
- Criteria pass (spec-reviewer): all cited path:line verified against the merged tree; migration NNN=004
  correct (marketdata tops out at 003); F-01/F-05 honored; C-08 N/A (no service step, stated explicitly);
  C-14 internal-only; C-15 both AC covered (AC-1→Step2 arithmetic, AC-2→Step1 offline up/down + PRE_DEPLOY).
  Two benign informational NOTEs, no action: (1) Step 2 incidentally matches the B2b "live" keyword but fires
  none of the trading-domain checks (it documents a DO cluster param, not a service env var); (2) N/A test-step
  pairing is correct.
- Overlap pass (feature-overlap): CLEAN — no collision. marketdata migration 004 next-free; feature 142
  (implementation-ready) shares the marketdata dir but edits disjoint Go files (no migration/doc overlap).
  No merge-order entry required.
- Unresolved ✗ / ⚠ carried into execution: none.

## Session 2026-08-24 — sdd-execute (sequential)

- Branch boot-correction (141 precedent): this harness session develops on `claude/do-logs-shared-memory-0o994w`
  (task directive), NOT `feature/fix-ohlcv-chunk-lock-oom`. Steps commit directly to the claude branch; the
  existing PR #1008 (claude/do-logs-shared-memory-0o994w → main-dev) is the integration PR.
- Tooling setup: none required (migration verified offline; docs steps need no toolchain).

### Step 1 — migration 004 widen ohlcv chunk interval to 30d [done]
- Created 004_widen_ohlcv_chunk_interval.{up,down}.sql: up `set_chunk_time_interval('marketdata.ohlcv','30 days')`,
  down resets to `'1 day'`. Metadata-only/future-only; no DO-block pre-flight, no remediation-log table (003 carried
  those only because it moved rows). Mirrors 003's no-explicit-BEGIN/COMMIT convention.
- Verified OFFLINE (HARD CONSTRAINT — never starts a DB): both files exist with correct next NNN=004; up sets 30d,
  down reverses to 1d; neither file contains a real DO-block / CREATE TABLE / explicit BEGIN|COMMIT. Live
  apply+rollback + dimension assert runs at the db-migrator PRE_DEPLOY job (.do/app.yaml) / CI.
- Minor in-scope tidy: reworded an up.sql comment so it no longer contains the literal dollar-quote token in prose
  (avoids a naive grep/parser false-positive) — no SQL/logic change.
- Files modified: services/xstockstrat-marketdata/migrations/004_widen_ohlcv_chunk_interval.{up,down}.sql
- Deviations: none. (Offline migration verification is the repo's F-05 bar, not a deviation.)

### Step 2 — docs: Piece A runbook + lock-budget invariant [done]
- Created docs/runbooks/ohlcv-lock-budget-tuning.md (root cause; the countable lock-budget invariant AC-1 with
  both named assumptions; the max_locks 64→1024 operator procedure incl. the single-node restart/downtime warning;
  the "Piece A applied + holding in staging" acceptance gate, recording the 2026-08-24 apply; the future-only
  relationship to migration 004). Added the alphabetical index row to docs/runbooks/CLAUDE.md.
- Verified: runbook present; max_locks 64→1024 documented; AC-1 markers (1,600 / 25,600 / 53200) present; index row
  added; bash is macOS-safe (no grep -P / bare pip).
- Files modified: docs/runbooks/ohlcv-lock-budget-tuning.md, docs/runbooks/CLAUDE.md
- Deviations: none.

### Step 3 — docs: chunk-interval consistency [done]
- Updated services/xstockstrat-marketdata/CLAUDE.md § Database (ohlcv now "new chunks 30d as of feature 153 /
  migration 004; pre-existing 1-day chunks age out", + why + runbook pointer; kept compression note) and
  docs/patterns/database.md § Schema & Hypertable Map (ohlcv row → 30-day, + an authoritative pointer paragraph
  mirroring the ohlcv_remediation_003 style).
- Verified: "30 day" present in both; feature 153 / 004 cross-ref present; no bare "chunk = 1 day" ohlcv assertion remains.
- Files modified: services/xstockstrat-marketdata/CLAUDE.md, docs/patterns/database.md
- Deviations: none.

All 3 steps done. Status: in-progress → code-completed.
