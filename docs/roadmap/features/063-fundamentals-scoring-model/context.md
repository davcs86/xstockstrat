# Context: fundamentals-scoring-model

**Feature**: `docs/roadmap/features/063-fundamentals-scoring-model/feature.md`
**Product Spec**: `docs/roadmap/features/063-fundamentals-scoring-model/product-spec.md`
**Implementation Spec**: `docs/roadmap/features/063-fundamentals-scoring-model/implementation-spec.md`

---

## Session 2026-06-26 — sdd-story

- Created feature.md (status: draft), product-spec.md, context.md. Feature 6 of 6.
- The model is delivered AS A FORMULA (reuse indicators sandbox; fundamentals passed in `input_data`,
  which is an arbitrary Struct — no sandbox change, no new injected variable). Weights/bands are typed
  formula params (Feature 052), so retuning needs no deploy.
- **OQ-063-a resolved by research** this session: default bands anchored on Benjamin Graham (value:
  P/E 10→35, P/B 1.0→5.0), ROE/Piotroski conventions (quality: ROE 5%→25%, D/E 0.3→2.0, EPS sign 1/0),
  and dividend-trap convention (triangular yield band peaking ~4%, zero at 0% and ≥10%). value/quality
  weights 0.5/0.5. beta + market_cap excluded from the composite (reserved for risk/size factors).
- Cross-sectional peer normalization deliberately kept OUT of the formula (lives in 062's
  orchestration) so the formula stays a pure per-symbol function.

## Session 2026-06-26 — sdd-review product-spec

- Product spec reviewed (spec-reviewer + feature-overlap subagents). Status: draft → spec-ready.
- Verdict: PASS WITH WARNINGS / overlap CLEAN (no current duplicate key with 062). No blockers. Claims
  verified: `RegisterFormula`/`ExecuteFormula` RPCs + `FormulaParameter` exist (indicators.proto);
  `indicators.formulas` table with `is_public BOOLEAN` exists (migrations/001_formulas.up.sql); typed-params
  infra is real; `input_data` is a `google.protobuf.Struct` (fundamentals pass through with no sandbox change).
- 3 warnings fixed in product-spec:
  1. Config-key inconsistency: OQ-063-c resolves weights to formula `params`, but the Config section kept the
     config-key alternative open. Struck the two keys; Config Key Changes now states "None" — weights/bands
     are formula params. This definitively CLOSES the 062/063 `analysis.fundsignal.*` namespace risk (063 adds
     no keys; `scoring_formula_id` stays 062-owned).
  2/3. Wrong dependency feature number: typed formula-parameters infra is the launched `058-formula-parameters`
     feature, NOT 052 (`durable-observable-backfills`). Fixed FR-2, the Depends-on line, and OQ-063-c, using the
     slug `058-formula-parameters` to avoid the duplicate-058 number ambiguity.
- AC-5 ("match intuition on a small labeled sample") is qualitative — left as advisory (a concrete threshold can
  be set at /sdd-spec); not a gate blocker.
- Overlap findings: CLEAN. No proto/migration changes; formula lives in `indicators.formulas`. 063 consumes the
  composite in analysis but declares no analysis files/migrations.

## Session 2026-06-27 — sdd-spec

- Generated implementation-spec.md with 6 steps. Status: spec-ready → implementation-ready.
- Discovery (codebase-discovery subagents, indicators + analysis). Key codebase findings:
  - **Indicators sandbox contract**: formula source runs in a subprocess with exactly two injected
    namespaces — `data` (from `ExecuteFormulaRequest.input_data`, `app/services/sandbox.py:156`) and
    `params` (from validated `input_params`, `sandbox.py:159`); formula must assign a dict to `result`
    (`sandbox.py:166-168`). No sandbox change needed — fundamentals pass straight through as `data`.
  - **No seeding mechanism exists** (digest finding 6): formulas are created only via the
    `RegisterFormula` RPC, which mints a *random* UUID per call (`servicer.py:202`) and there is no
    name-uniqueness constraint (`001_formulas.up.sql:3-13`). So a naive re-register on restart would
    duplicate rows. DECISION: register via an **idempotent startup seeding hook** in
    `app/main.py` (after the asyncpg pool at `main.py:48-51`) using a **deterministic well-known
    `FORMULA_ID`** (UUIDv5) + a new `FormulasRepository.upsert` (`INSERT ... ON CONFLICT (formula_id)
    DO UPDATE`). This honors FR-1's RegisterFormula validation (reuse `validate_definitions` /
    `validate_outputs`, `servicer.py:222-223`) while being restart-safe and giving Feature 062 a
    stable `scoring_formula_id` to reference.
  - **Outputs**: declare `quality` and `composite` as `FormulaOutput`s; `value` is the implicit
    primary series and is reserved — must NOT be declared (`parameters.py:30-32`).
  - **Analysis already calls ExecuteFormula** (`app/services/evaluator.py:155-182`) with the
    Struct-build + `input_data`/`input_params` split + per-method header propagation
    (`servicer.py:147-151`, metadata forwarded). The 063 analysis work is a thin new helper
    `score_fundamentals(...)` that reuses this exact path and parses `{value, quality, composite}`
    from `resp.output` (a generic Struct, `indicators.proto:79`). No fundamentals handling exists in
    analysis today (digest finding 4 — entirely new).
  - **No proto / migration / config-key changes** confirmed both sides. `INDICATORS_ENDPOINT` already
    wired (`docker-compose.yml:351`, `.do/app.{dev.,}yaml:226-227`); no new env vars.
  - Last indicators migration is `003_formula_outputs` (063 adds none).
- Reviewers snapshot finalized: indicators + analysis service owners. `xstockstrat-config` dropped
  (063 adds no config keys; weights/bands are formula params, `scoring_formula_id` is 062-owned).
- AC-5 ("match intuition on a small labeled sample") concretized into a deterministic labeled-sample
  threshold test (Step 5) rather than left qualitative.

## Session 2026-06-27 — sdd-review impl-spec (advisory)

- Impl-spec reviewed. Verdict: PASS, 0 blockers. Overlap CLEAN. SEEDING HOOK VALIDATED SOUND: ON CONFLICT (formula_id)
  uses the existing formulas PK (no new migration needed); deterministic UUIDv5 well-known FORMULA_ID gives 062 a stable
  scoring_formula_id. FormulasRepository.upsert confirmed absent (spec adds it). 063's analysis-side code is a NEW file
  (app/services/fundamentals_scoring.py) — disjoint from 062's servicer edits.
- Advisory: Step 5 doesn't restate --cov-fail-under=50 on its command (covered by Step 2 on the same file); Step 1 touches
  5 files (at the split-consideration boundary, cohesive). Confirmed 063 adds NO proto/config/migration.

## Session 2026-06-29 — sdd-execute (all 6 steps)

Executed all 6 steps on `feature/fundamentals-scoring-model` (stacked on
`feature/fundamentals-data-source`, 059). Python-only — no proto/migration/config (confirmed). One
integration PR per feature.

- **Step 1 (indicators formula + seed)**: `app/formulas/fundamentals_value_quality.py` (SOURCE for
  the sandbox, 12 tunable FLOAT `PARAMETERS`, `OUTPUTS=[quality, composite]`, well-known
  `FORMULA_ID=d1ff5e6b-6d9c-589d-b95e-defd862c702b`). Added `FormulasRepository.upsert`
  (`ON CONFLICT (formula_id) DO UPDATE`). `app/services/seed_formulas.py` validates with the same
  gate RegisterFormula uses, then upserts; non-fatal. Wired into `app/main.py` after the pool, before
  serving. The formula honors FR-4 specials (P/E≤0→0, neg book→0, neg equity→0, EPS sign binary,
  triangular dividend) and FR-5 missing-metric neutrality (drop-out, 0.5 if a sub-score is empty).
- **Step 2/5 (indicators tests)**: `tests/test_fundamentals_formula.py` runs SOURCE through the real
  sandbox — AC-1 range, AC-2 high/low, AC-3 missing-data, FR-4 special cases, definition validation,
  upsert ON CONFLICT idempotency, and a labeled-sample ordering + yield-trap check (Step 5).
  ruff clean, 89 passed, coverage 79% (≥50%).
- **Step 3 (analysis helper)**: `app/services/fundamentals_scoring.py` — `score_fundamentals(stub,
  formula_id, fundamentals, metadata, params=None)` builds `input_data`/`input_params` (split),
  forwards propagation metadata verbatim, raises `FundamentalsScoringError` on `success=False`, and
  parses `{value, quality, composite}`. Pure helper; no handler/config/migration.
- **Step 4 (analysis test)**: `tests/test_fundamentals_scoring.py` — parse + metadata forward +
  data/params split, default-to-zero on missing keys, raise on failure. ruff clean, 108 passed,
  coverage 62% (≥40%).
- **Step 6 (docs)**: indicator-builder.md "Default fundamentals Value+Quality formula" section
  (well-known id, FR-4 band table, tunable params, retune-without-deploy); indicators CLAUDE.md
  "Seeded Formulas" note. No `analysis.fundsignal.*` key added (062-owned).

**Stopped at**: all complete → integration PR → `feature/fundamentals-data-source` (059).
