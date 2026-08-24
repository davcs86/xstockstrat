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
