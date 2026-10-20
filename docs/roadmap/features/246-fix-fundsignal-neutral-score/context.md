# Context Log: fix-fundsignal-neutral-score

Append-only. Each session appends a new ## Session entry. Never delete or edit prior entries.

---

## Session 2026-10-20 (/sdd-triage)

- Bug recorded as defect report `docs/reports/2026-10-19-analysis-fundsignal-neutral-score-fabricated-defect.md`
  (Issues disabled). Source: feature 144 Gotchas bullet, `services/xstockstrat-analysis/docs/context-constitution.md:42`.
- Severity: SEV-2. Environment: dev (main-dev) @ 1302e6d. Routed to SDD path (Track C).
- Created: feature.md, product-spec.md, acceptance.feature (AC-1, AC-2), context.md.
- Affected services (from report): xstockstrat-analysis, xstockstrat-ingest.
- Root cause hypothesis: `_builtin_score` neutral `0.5` fallback (`fundsignal_loop.py:432`) is indistinguishable
  from a computed score; truthiness metric checks drop real zeros.
- Confirmation evidence. The report's reproduction was not re-run at triage. A code read on main-dev @ 37b9a56
  confirms the following:
  - `:432` returns 0.5 when `parts` is empty.
  - `:240` filters only on `score < min_conv`, with a default of 0.0.
  - `_map_directions` includes every scored symbol in the quantile.
  - `_quantile` (`:631`) is nearest-rank. With [0.5×5, s_MSFT] and buy_q 0.80 → idx 4 → `buy_cut` 0.5,
    so all five ETFs are emitted as `buy`.
- Report inaccuracy. Repro step 2 says `RunFundamentalsScan(dry_run=true)`, but `run_once` returns at `:195`
  before `_score`, so a dry run never scores. AC-1 uses a non-dry-run cycle instead. Exposing dry-run scores
  is a separate capability and out of scope.
- AC-2 arithmetic: `_lin(20, 10, 35)` = 0.6; `_lin(0.0, 0.25, 0.05)` = 0.0; mean 0.30. Today the value is 0.6,
  because `if f.roe:` drops the 0.0.
- Presence signal: marketdata already sets `Fundamentals.missing_metrics` with canonical names
  (`marketdata_service.go:1976-1994`; the screener reads it at `screener.py:402`). No proto change is needed.
- Recommended design depth: quick → `/sdd-design fix-fundsignal-neutral-score quick`. Rationale: SEV-2 and
  no proto/migration/config. The report lists 2 services, but the code change is analysis-only; ingest only
  receives the signals and needs no change, so the C-0 "≥2 services" trigger for full design is
  nominal. Escalate to full if design decides on an ingest-side retraction of already-emitted 0.5 signals.
- Design forks:
  - skip versus flag-unavailable for a data-less symbol (it must not enter the quantile either way);
  - whether a partial row is scored from its present metrics only (today's behaviour, minus the zero bug);
  - logging and run accounting for skipped symbols (`symbols_done`).
- Development branch: feature/fix-fundsignal-neutral-score
