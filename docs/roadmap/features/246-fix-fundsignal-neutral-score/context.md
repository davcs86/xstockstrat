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

## Session 2026-10-20 — sdd-review product-spec

- Product spec approved. Status: draft → spec-ready. Criteria: PASS WITH WARNINGS (0 fails, 0 Floor breaches).
- Warnings (spec-reviewer), with disposition:
  - [C-15] No `@FR-N` tags or numbered FRs (Track C template, `track-c-sdd.md:158`). Resolved: added FR-1
    (built-in scorer: all-missing row gets no score, no quantile slot, no emitted row, no `IngestSignal`) and
    FR-2 (absence read from `missing_metrics`, never a zero; partial row scored from present metrics); AC-1
    tagged `@FR-1`, AC-2 `@FR-2`.
  - [C-15] AC-1 Then "quantile cuts computed over MSFT only" checked internal state. Resolved: replaced by
    "exactly one `analysis.fundsignal_emitted` row exists, for MSFT, with direction buy" (single scored
    symbol → `buy_cut` = its score, `s >= buy_cut` at `fundsignal_loop.py:479`).
  - AC-1 MSFT fixture non-deterministic. Resolved: MSFT lists `pb_ratio`, `debt_to_equity` in
    `missing_metrics`, not `pe_ratio`/`roe`/`eps` → score (0.6+1.0+1.0)/3 ≈ 0.867.
  - Shared givens in Feature description. Resolved: moved to a Gherkin `Background:`.
  - [C-10/C-16] Formula-path exclusion rationale wrong: `fundsignal_loop.py:452-459` passes raw wire values,
    ignoring `missing_metrics` (`marketdata.proto:218`), so a data-less ETF is scored from zeros under a
    configured formula. Resolved in spec: bullet removed from Out of Scope; new "Open for Design" entry —
    design extends the all-missing skip to this path or names a follow-up. Durable `@feature-201 @AC-8`
    (`services/xstockstrat-analysis/acceptance/fundamentals-formula-inputs.feature:47-53`) is PRESERVE; an
    all-missing skip does not change it. Blast radius limited: config `008_analysis_fundsignal_keys.up.sql:34-35`
    seeds `scoring_formula_id` empty.
  - Persona missing. Resolved: "Who is affected" line added.
  - No numbered FRs; AC-2 settles the partial-row fork (Session 2026-10-20 /sdd-triage, design forks bullet 2).
    Resolved: FR-2 states partial row scored from present metrics only. Design treats that fork as decided
    (`@AC-*` IDs are append-only).
  - [C-14] Consumer Surface omitted UI `/insights/opportunities`
    (`services/xstockstrat-ui/src/app/insights/opportunities/page.tsx`) and the per-surface change. Resolved:
    added, plus blend-universe effect (`live_loop.py:149-192`: data-less symbols drop out).
- Notes:
  - "Following the feature 144 `score_unavailable` pattern" mismatched (144 still ranks the flagged row
    last). Resolved: Expected now says stricter than 144; "never scored, ranked or emitted" is binding.
  - Stale anchor correction (prior entry left unedited, append-only): the `missing_metrics` producer is
    `toProtoFundamentals`, `services/xstockstrat-marketdata/internal/service/marketdata_service.go:2020-2056`,
    used by `GetFundamentalsMulti` at `:1677-1711`, not `:1976-1994`.
  - Reviewer confirmed all other citations (`:432`, `:240`, `:479`, `:195`, proto field 18), C-05 key names,
    unique AC IDs, AC-2 arithmetic, AC-1 red on current code (nearest-rank idx 4 → `buy_cut` 0.5).
- Overlap findings: none (feature-overlap PASS, no collisions).
- Operator decisions (binding, recorded 2026-10-20):
  - Standing authorization: designs run in FULL mode only (no quick designs for automated fixes); the orchestrator auto-approves the design gate once rounds >= 2, no unresolved Floor (F-*) breach remains, no blocking objection remains, and every CHANGE to an existing @AC business rule is covered by an operator decision below.
  - Full design depth (operator overrode the triage 'quick' recommendation).
- Next: `/sdd-design fix-fundsignal-neutral-score` (full).
