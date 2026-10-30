# Context Log: fix-template-update-metadata

Append-only. Each session appends a new ## Session entry. Never delete or edit prior entries.

---

## Session 2026-10-21 (/sdd-triage)

- Bug recorded as defect report `docs/reports/2026-10-21-template-update-metadata-defect.md` (Issues disabled).
- Source: repo-surveyor debt-radar scan `docs/repo-surveyor/debt-radar-findings.md` @ 4535695, finding D-41
  (including its RETIRE and empty-id CREATE divergences).
- Severity: SEV-2. Impact type: template-update-silently-ignored. Environment: dev (main-dev) @ a053b0e. Config-only: no.
- Routed to SDD path (Track C).
- Created: status.md, feature.md, product-spec.md, acceptance.feature (AC-1..3), context.md.
- Affected services: xstockstrat-indicators, xstockstrat-analysis, xstockstrat-ingest (fix sites); xstockstrat-ui
  read-only evidence.
- Root cause hypothesis: three per-service template repositories with no shared contract (debt-radar D-20 family).
- Re-verification on main-dev @ a053b0e: D-41 and both divergences reproduce in code. Line drift: indicators
  `ManageTemplate` update call `servicer.py:644-645` → `:652`; empty-id reject `:627` → `:633-635`; repository
  `formula_templates_repository.py:50-63` → `:50-62` (retire COALESCE `:68`); analysis `strategy_templates.py:54-66`
  unchanged (retire COALESCE `:72`; handler update `servicer.py:3581`, empty-id reject `:3544-3552`); ingest
  `source_templates.py:50-75` unchanged (update `:56`, retire overwrite `:71`), uuid mint `servicer.py:1540` unchanged.
  Extra divergence found during re-verification: indicators' retire does not set `updated_at`; analysis and ingest do.
- UI evidence: `/config-ui/templates` (`page.tsx:153-158`, `:382`) sends `name`/`description` on UPDATE.
- **Overlaps:** none in-flight among 240–253. Launched 224-private-by-default-templates and
  225-private-by-default-enforce-contract last touched these repositories/handlers (context only; no conflict).
  Sibling batch features 254–266/272–273 (created concurrently) claim no template finding; 266-fix-db-tls-fail-closed
  carries D-20 (shared-infra copies), the family this defect belongs to — coordinate only if design extracts a shared
  template repository.
- Recommended design depth: full → `/sdd-design fix-template-update-metadata` (rationale: affected services ≥ 2 —
  three fix sites). First design decision (per the surveyor's routing note): is template metadata mutable? Then: does
  a metadata-only UPDATE bump `version`; which RETIRE and empty-id CREATE semantics win.
- Operator decisions (2026-10-21): grouped by service+theme from the debt-radar scan; Track C for all SEV-2 (precedent #1264); batch launched via /sdd-batch with designGate halt.
- Development branch: feature/fix-template-update-metadata

## Session 2026-10-21 — sdd-review product-spec

- Product spec approved. Status: draft → spec-ready. Criteria verdict: PASS WITH WARNINGS (no fails, no floor breaches).
- Warnings:
  - Criterion 8 / C-15: @AC-2 asserts an observable `updated_at`. **Resolved**: `TemplateMeta.updated_at` exists
    (`packages/proto/common/v1/common.proto` field 8), and FR-4 now cites it. Still open for `/sdd-design` and
    `/sdd-spec`: @AC-1/@AC-2 need controlled time (clock injection or a stubbed `NOW()`) so the
    2026-10-21T10:00:00Z/11:00:00Z assertions are deterministic.
  - FR-3/FR-4: does a second RETIRE reach the SQL? **Resolved**: none of the three retire `UPDATE`s filters on
    `retired_at` (`formula_templates_repository.py` retire, `strategy_templates.py:68-75`, `source_templates.py:67-75`).
    The handlers (indicators `servicer.py:653-660`, analysis `servicer.py:3554`, ingest `servicer.py:1522-1523`)
    return NOT_FOUND only when no row exists. FR-3 now says the second RETIRE succeeds and that no service may add a
    `retired_at IS NULL` filter.
  - Criterion 11 / C-14: the UI line cites `page.tsx:153-158`, `:382` and `:479` were not re-checked by the reviewer
    (description in the payload was confirmed at `page.tsx:157`, `:173`). Re-verify them in recon.
  - Criterion 8 (minor): "smoke-tested on dev" in Acceptance Criteria is boilerplate and not testable. Left as is.
- Overlap findings (WARN, file-level only; no config, proto or migration collisions):
  - `services/xstockstrat-indicators/app/handlers/servicer.py`: also modified by 244-fix-python-config-stored-zero
    (implementation-ready).
  - `services/xstockstrat-analysis/app/handlers/servicer.py`: also modified by 244-fix-python-config-stored-zero and
    245-fix-screener-symbol-isolation (both implementation-ready). This carries merge-conflict risk. The router
    decides the coordination line in `merge-order.md`; there is no entry for 244, 245, 268 or 269 today.
  - `services/xstockstrat-ingest/app/handlers/servicer.py`: 246-fix-fundsignal-neutral-score cites it as a reference
    only. This is a possible overlap, not a confirmed edit.
  - Thematic only: 268-fix-indicators-formula-correctness (indicators template surface), 259-fix-python-loop-supervision
    (`run_template_intent_sweep_forever` lives in analysis), and 241-fix-config-audit-author-spoof (agent and UI files
    this feature does not touch).
- OPERATOR DECISIONS (binding, recorded 2026-10-21):
  - Grouped by service+theme from the 2026-10-20 debt-radar scan; Track C.
  - Scope is D-41 including its RETIRE/CREATE divergences.
- Next: `/sdd-design fix-template-update-metadata` (full depth).

## Session 2026-10-22 — sdd-batch design state recovered (round 1)

- The batch run that produced round 1 was cut off by the session usage limit before its gate writer persisted the debate state. This block is the round-1 synthesis restored verbatim from the run journal (`synth:fix-template-update-metadata:r1`), so the next /sdd-batch run resumes from it instead of redoing the debate.

```sdd-batch-design-state
{
  "round": 1,
  "synth": {
    "approach": "Current best approach (r1 synthesis): three independent repository/call-site fixes with no proto, migration, config or new service edge. The adversary's proof-plan corrections are folded in.\n\n1. Indicators (FR-1, FR-4). Change `FormulaTemplatesRepository.update(template_id, payload_json)` to `update(meta, payload_json)` in services/xstockstrat-indicators/app/services/formula_templates_repository.py, mirroring the sibling `create(meta, ...)` at :34-48.\n   - SQL: `SET name = $2, description = $3, payload = $4::jsonb, version = version + 1, updated_at = NOW() WHERE template_id = $1 AND retired_at IS NULL`.\n   - Binds: `meta.template_id`, `meta.name`, `meta.description or \"\"` (the `or \"\"` copies this class's own `create`).\n   - `retire` (:68) adds `, updated_at = NOW()` and keeps `COALESCE(retired_at, NOW())` and the unfiltered WHERE.\n   - Call site: app/handlers/servicer.py:652 becomes `update(meta, payload)`.\n\n2. Analysis (FR-1). Same signature and SQL change in services/xstockstrat-analysis/app/repositories/strategy_templates.py:54-66.\n   - Bind `meta.description` RAW, as its own `create` does at :48. Do not copy indicators' `or \"\"` (C-18).\n   - `retire` (:68-78) is unchanged; it is already first-wins and stamps `updated_at`.\n   - Call site: app/handlers/servicer.py:3581. The mapper at :7138-7150 is verified to read name/description/updated_at from the row, so no mapper change.\n\n3. Ingest (FR-3, FR-5).\n   - services/xstockstrat-ingest/app/repositories/source_templates.py retire becomes `SET retired_at = COALESCE(retired_at, NOW()), updated_at = NOW()`, unfiltered WHERE (copied from analysis :72-73).\n   - In `ManageTemplate`, add a CREATE-only guard right after `meta = request.template.meta` (app/handlers/servicer.py:1521): `if op == CREATE and not meta.template_id: abort(INVALID_ARGUMENT, \"template_id required\"); return`.\n   - The guard comes AFTER the ADMIN gate (:1517-1519), which preserves @AC-13. It comes BEFORE `validate_config_json` (:1527), so an empty-id CREATE with a bad payload returns the id error, as indicators does at :634-636.\n   - At :1540, drop the `or str(uuid.uuid4())` fallback. `import uuid` stays for :398.\n\nEmpty name/description on UPDATE is full-replace in all three services (ingest's semantics, :54-63). For indicators and analysis this is a deliberate behavior change: a direct gRPC `name=\"\"` now blanks the name. Record it as a decision in context.md and pin it with one bind test showing `\"\"` is passed through unchanged.\n\nProof plan, rewritten per the adversary:\n- (a) Repo-level red-first tests in each service assert the SQL clauses AND the bound argument tuple (`fetchrow.call_args.args[1:]`). Each one fails on today's SQL. These tests are the @AC-1/@AC-2 evidence for indicators and ingest.\n- (b) REQUIRED analysis real_pg test. It uses the existing session `local_pg` fixture (services/xstockstrat-analysis/tests/conftest.py:368) in one new test file, with no new fixture home (C-13). Under CI=true it fails rather than skips. It proves:\n  - UPDATE persists name/description and keeps the version+1 bump;\n  - UPDATE of a retired row returns None;\n  - a double RETIRE keeps the first `retired_at` and advances `updated_at` (assert `updated_at > retired_at`, no wall-clock literals);\n  - bind order is right.\n- (c) Handler tests are wiring-only: right repo method, right args, response mapped. They spy at the repo boundary. No injectable clock, and no first-wins logic added to the fakes.\n- (d) Fakes updated in lockstep and listed in each step's Files (fails.md:2709):\n  - analysis `FakeTemplates.create` (tests/test_strategy_templates.py:99-103) gains `description`, and `.update` (:105) takes `(meta, payload_json)` and sets name/description;\n  - indicators `_FakeTemplates.update` (tests/test_formula_templates.py:83) gets the new signature;\n  - tests broken by design are rewritten in the same step: indicators :535 and the handler test `test_ac14_admin_update_bumps_version_and_bob_lists_it` (:241), analysis :686, and ingest :445 (`\"retired_at = NOW()\"`).\n- (e) Record the remaining runtime-proof gap for indicators and ingest (no real-PG harness) in context.md for C-15 traceability.\n\nStep order: three independent steps (indicators, analysis, ingest); each lands its code, fakes and tests together. Add a one-line merge-order.md entry for the overlap with features 244/245 on the indicators/analysis servicer.py files. Promote @AC-1..3 tagged @feature-269 so they don't collide with the feature-224 numbers (C-16).\n\nTrace-id standing decision: not engaged. No new outbound calls, emits or background contexts are added. The existing handler paths keep inbound metadata unchanged.",
    "open_objections": [
      {
        "text": "[C-15/P-06] The handler-level @AC-2 timestamp proof checked hand-edited fakes (injectable clock, first-wins logic in the fake), which is the vacuous-green trap at fails.md:2253. The indicators fake is already first-wins (tests/test_formula_templates.py:95), so a handler test there goes red only because of the missing updated_at. The synthesis adopts the fix: tie @AC-2 to the repo SQL-text plus bind-argument tests, keep handler tests wiring-only with a repo-boundary spy and no clock or first-wins logic in fakes, and record the indicators/ingest runtime gap in context.md. Stays open until the r2 proposer confirms.",
        "blocking": true
      },
      {
        "text": "[C-15] The analysis real_pg test must be required, not a runner-up. The harness exists (tests/conftest.py:368 `local_pg`) and real_pg fails under CI=true. The fails.md:2253 'no live-PG fixture' premise is stale for analysis. The synthesis requires one analysis real_pg file proving UPDATE persists name/description with version+1, UPDATE of a retired row returns None, double RETIRE is first-wins with updated_at > retired_at, and bind order is right. Stays open until the proposer confirms.",
        "blocking": true
      },
      {
        "text": "[C-13/fails.md:2709] The analysis `FakeTemplates.create` (tests/test_strategy_templates.py:99-103) drops `description` (verified: it sets only name/payload/created_by), so an @AC-1 test seeded with 'd1' is wrong or passes vacuously. Add it to the step Files along with update (:105) and retire (:112). Also list the indicators handler test at :241 (`test_ac14_admin_update_bumps_version_and_bob_lists_it`), which the `update` signature change breaks. Stays open until the proposer adds both to the step Files.",
        "blocking": true
      },
      {
        "text": "[C-18] Mirror each class's own `create` normalization: `meta.description or \"\"` in indicators only, and raw `meta.description` in analysis (strategy_templates.py:48). Adopted in the synthesis.",
        "blocking": false
      },
      {
        "text": "[P-03] Full-replace on an empty name is a deliberate behavior change for indicators and analysis (today `name=\"\"` leaves the name alone). Record it as a context.md decision and pin it with a bind test showing `\"\"` is passed through. Adopted in the synthesis.",
        "blocking": false
      },
      {
        "text": "[C-16] Ingest guard ordering: it must come after the ADMIN gate (:1517-1519) and before validate_config_json (:1527). Write that order into the step text. Adopted in the synthesis.",
        "blocking": false
      },
      {
        "text": "[process] Make the merge-order.md entry for the 244/245 overlap a spec deliverable, not a recommendation.",
        "blocking": false
      }
    ],
    "floor_breaches": [],
    "business_rule_changes": [
      {
        "ac_id": "@AC-1 (feature-269: UPDATE persists name/description)",
        "kind": "CHANGE",
        "covered_by_operator_decision": true
      },
      {
        "ac_id": "@AC-2 (feature-269: RETIRE first-wins retired_at + updated_at stamp)",
        "kind": "CHANGE",
        "covered_by_operator_decision": true
      },
      {
        "ac_id": "@AC-3 (feature-269: ingest CREATE requires template_id)",
        "kind": "CHANGE",
        "covered_by_operator_decision": true
      },
      {
        "ac_id": "@AC-13 (admin gate before template writes)",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "@AC-14 (UPDATE bumps version)",
        "kind": "EXTEND",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "@AC-17 (retire does not touch instance rows)",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "@AC-31 (retire WHERE unfiltered / repeat retire returns row)",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      }
    ],
    "rejected_alternatives": [
      "update(template_id, name, description, payload) signature: lost to update(meta, payload_json). meta matches the sibling create(meta, ...) and keeps each call-site diff to one line.",
      "Shared Python template-repository module (D-20): would end the drift for good, but needs a cross-service package and coordination with 266 for three ~10-line SQL edits. Speculative per C-18 and outside the spec.",
      "COALESCE(NULLIF($2,''), name) keep-prior semantics on UPDATE: would protect non-UI callers from blanking a name, but adds a second UPDATE rule that diverges from ingest, and the spec doesn't ask for it.",
      "Guard empty template_id for all ops in ingest: would match the siblings, but changes the UPDATE/RETIRE empty-id result from NOT_FOUND to INVALID_ARGUMENT with no @AC asking for it. Rejected per the low-rework instruction.",
      "Real-PG tests in all three services: indicators and ingest would each need a new harness, the per-feature rig fails.md:2253 warns against. Real-PG for analysis only, where the harness exists.",
      "Handler-level @AC-2 proof via injectable-clock fakes holding first-wins logic: proves only the fake, not the SQL (fails.md:2253 rule 2). Replaced by repo SQL/bind tests plus analysis real_pg."
    ],
    "open_risks": [
      "Indicators and ingest have only SQL-text plus bind-argument proof. A bind mistake mirrored in both the SQL and the assertion would pass. Runtime coverage exists for analysis only; record the gap in context.md and leave a real-PG harness to a platform follow-up (C-18).",
      "Direct gRPC or agent callers sending name=\"\" on UPDATE now blank the name in indicators and analysis, an intentional behavior change. The UI always sends both fields (page.tsx:153-158).",
      "Merge conflicts with features 244/245 on the indicators servicer.py (:652) and analysis servicer.py (:3581). Small (one-line call sites) but real until merge-order.md sequences them.",
      "Ingest CREATE callers that relied on the server-side uuid fallback (:1540) now get INVALID_ARGUMENT. Check the UI/agent callers that send no template_id during spec (the agent's instantiate/manage paths)."
    ],
    "constitution_rules_touched": [
      "C-11",
      "C-13",
      "C-15",
      "C-16",
      "C-18",
      "P-02",
      "P-03",
      "P-06",
      "F-01",
      "F-04",
      "F-06",
      "F-07",
      "C-03 (not engaged: no new outbound/emit contexts)"
    ],
    "rationale": "The adversary found no Floor breach and no @AC regression. The code repair is accepted as proposed except for one change: analysis binds raw `meta.description`, matching its own `create` at strategy_templates.py:48 (verified). All blocking issues concern proof. Verified in code:\n- The analysis FakeTemplates.create drops description (test_strategy_templates.py:99-103).\n- The analysis fake retire is not first-wins (:112-116, `retired_at = _T0` unconditionally).\n- The analysis `local_pg` real-PG fixture exists (conftest.py:368).\n- The ingest ordering is ADMIN gate :1517, meta :1521, validate_config_json at ~:1527, uuid fallback :1540.\n\nMaking the analysis real_pg test mandatory costs one file and gives real runtime proof where a harness already exists. That matches the user's 'preserve as much as you can while having low rework': no new harness, no shared module, CREATE-only guard. The three blocking objections are adopted in the current best approach but stay open because the r1 proposal did not answer them; they close on the r2 proposer's explicit confirmation.\n\nDurable @AC-13/17/31 are preserved and @AC-14 is extended (version bump kept alongside the metadata write). The feature-269 @AC-1..3 changes are sanctioned by the operator's D-41 scope decision."
  },
  "floor_breaches": []
}
```

## Session 2026-10-22 — sdd-batch design gate (round 2)

- The `/sdd-design fix-template-update-metadata` full debate is at its approval gate after round 2, and the gate policy is halt. Per the grilling protocol, design.md is not written and status.md stays `spec-ready`. The state block below lets the next /sdd-batch run pick up from here.

### Open Threads

- **Approach (r2 synthesis).** The r1 code repair is unchanged. It has three independent steps, and each lands its code, fakes and tests together. No proto, migration or config change and no new service edge.
  - **Indicators (FR-1, FR-4):** `update(meta, payload_json)` now writes name/description, binding `meta.description or ""`. `retire` adds `updated_at = NOW()` and keeps first-wins `COALESCE(retired_at, NOW())`. Call site: `servicer.py:652`.
  - **Analysis (FR-1):** same `update` change, binding raw `meta.description`. `retire` is unchanged. Call site: `servicer.py:3581`.
  - **Ingest (FR-3, FR-5):** `retire` becomes first-wins plus `updated_at`. CREATE gets an empty-`template_id` guard returning INVALID_ARGUMENT, placed after the db gate, the ADMIN gate and `meta =`, and before `validate_config_json`. The `uuid4()` fallback at `:1540` is dropped.
  - **UPDATE semantics:** an empty name or description fully replaces the stored value in all three services. This is a deliberate change for indicators and analysis, pinned by a bind test.
  - **Proof:**
    - Red-first repo tests on SQL text plus bound args. These are the @AC evidence for indicators and ingest.
    - A required analysis real-PG file:
      - DDL is read from migration 026 with an anchored regex, plus a guard that no other migration mentions the table.
      - Each repo call runs as its own autocommit statement.
      - RETIRE assertions are strict: second `updated_at` > first `updated_at` and > `retired_at`. This leg is a regression pin, not FR-3/FR-4 evidence.
    - Wiring-only handler tests.
    - Every fake and broken test is listed in the step Files.
  - **Agent assumption closed:** the agent has no ManageTemplate path.
  - **Trace-id:** not engaged.
- **Strongest open objection (non-blocking, [C-15]).** @AC-2 (`acceptance.feature:17-22`) binds the literal retire times 10:00Z and 11:00Z, and no planned test can bind to them. The spec must rewrite it in relative form: a second RETIRE leaves `retired_at` unchanged and moves `updated_at` past `retired_at`. It must also map each service to its evidence: SQL plus bound args for indicators and ingest, runtime for analysis.
  - **Other open spec-level items:**
    - strict `>` and autocommit-per-call for the real-PG check;
    - the 026 DDL anchor and the no-other-migration guard;
    - a C-16 launch promotion rule for the @AC-1..3 collision with feature 224 (keep `@feature-269` and dedupe on the (feature, AC) pair, or renumber, named explicitly);
    - a durable home for the indicators/ingest real-PG gap in `docs/context-constitution-findings.md` or the debt radar.
  - All three r1 blocking objections are closed by the r2 proposer's confirmation.
- **Floor status:** no breaches. The adversary returned SOUND.
- **@AC changes:**
  - Feature-269 @AC-1, @AC-2 and @AC-3 are CHANGE, covered by the operator's D-41 scope decision. @AC-2 is still to be relativized.
  - Durable @AC-13, @AC-17 and @AC-31 are PRESERVE.
  - @AC-14 is EXTEND: UPDATE still bumps the version and now also writes name/description.
  - No @AC change is left uncovered.

```sdd-batch-design-state
{
  "round": 2,
  "synth": {
    "approach": "Current best approach (r2 synthesis). The r1 code repair stands unchanged and the r2 proposer has confirmed all three r1 blocking objections. The r2 adversary's proof refinements are folded in. There are three independent per-service steps, and each lands its code, fakes and tests together. No proto, migration, config or new service edge is involved.\n\n1. Indicators (FR-1, FR-4) — services/xstockstrat-indicators/app/services/formula_templates_repository.py\n   - `update(template_id, payload_json)` becomes `update(meta, payload_json)`.\n   - SQL: `SET name=$2, description=$3, payload=$4::jsonb, version=version+1, updated_at=NOW() WHERE template_id=$1 AND retired_at IS NULL`.\n   - Binds `meta.description or \"\"`, mirroring this class's own `create`.\n   - `retire` adds `, updated_at = NOW()` and keeps `COALESCE(retired_at, NOW())` with the WHERE unfiltered.\n   - Call site: app/handlers/servicer.py:652 becomes `update(meta, payload)`.\n\n2. Analysis (FR-1) — services/xstockstrat-analysis/app/repositories/strategy_templates.py:54-66\n   - Same signature and SQL change. Binds `meta.description` raw, as its `create` does at :48.\n   - `retire` (:68-78) is unchanged.\n   - Call site: app/handlers/servicer.py:3581.\n\n3. Ingest (FR-3, FR-5)\n   - In app/repositories/source_templates.py, `retire` becomes `SET retired_at = COALESCE(retired_at, NOW()), updated_at = NOW()` with the WHERE unfiltered. The SQL is copied from analysis strategy_templates.py:72.\n   - In app/handlers/servicer.py `ManageTemplate`, add a CREATE-only empty-`template_id` guard that returns INVALID_ARGUMENT. Required order, written into the step text: after the db gate (:1513-1515), after the ADMIN gate (:1517-1519) and after `meta =` (:1521), and before `validate_config_json` (:1527).\n   - Drop `or str(uuid.uuid4())` at :1540. `import uuid` stays because :398 still uses it.\n\nEmpty name/description on UPDATE fully replaces the stored value in all three services. This is a deliberate behavior change for indicators and analysis. Record it in context.md and pin it with a bind test.\n\nProof plan (final form):\n- (a) Each service gets red-first repo tests that assert the SQL clauses and the bound args (`fetchrow.call_args.args`). For indicators and ingest these are the @AC-1/@AC-2/@AC-3 evidence.\n- (b) Required file services/xstockstrat-analysis/tests/test_strategy_templates_real_pg.py, with `pytestmark = pytest.mark.real_pg`:\n  - It uses the session `local_pg` fixture (tests/conftest.py:368-375, which fails under CI=true; ci.yml:393-397 installs PG) and the `_pool()` pattern of tests/test_read_budget_real_pg.py:25-28.\n  - It runs `CREATE SCHEMA analysis`, then the DDL read from migrations/026_owner_dimension_templates.up.sql:89-99. The regex is anchored on `CREATE TABLE IF NOT EXISTS analysis.strategy_templates` and ends at the first `\\n);`, not a lazy `\\)`, because `DEFAULT NOW()` sits at :97-98.\n  - It asserts the statement was found, and asserts that no other `migrations/*.up.sql` mentions `strategy_templates`. Verified today: only 026 does. This makes the test fail loudly when a later ALTER lands.\n  - Each repo call runs as its own autocommit statement through the pool, never inside one `conn.transaction()`, because `NOW()` is the transaction start time.\n  - It proves: UPDATE persists name/description with version 1 to 2; UPDATE of a retired row returns None; double RETIRE keeps the first `retired_at` and has second `updated_at` strictly greater than first `updated_at` and strictly greater than `retired_at` (`pg_sleep(0.01)` between calls, no wall-clock literals); bind order with distinct name/description/payload values.\n  - The RETIRE leg is a regression pin for analysis. It is not FR-3 or FR-4 evidence.\n- (c) Handler tests check wiring only: they spy at the repo boundary for method, args and response mapping. No clock and no first-wins logic go into the fakes.\n- (d) Fakes and broken tests are listed in the step Files:\n  - analysis tests/test_strategy_templates.py: `FakeTemplates.create` (:99-103) gains description; `.update` (:105-110) takes the new signature; `.retire` (:112-116) is listed; :686 is rewritten.\n  - indicators tests/test_formula_templates.py: `_FakeTemplates.update` (:83-89); SQL tests at :535 and :545; handler test :241.\n  - ingest tests/test_source_templates.py: :445 is rewritten, and @AC-2/@AC-3 tests are added.\n\nSpec deliverables:\n- Rewrite @AC-2 in relative form. Today acceptance.feature:20 binds the literal times 10:00Z/11:00Z. New Then-clauses: \"a second RETIRE leaves retired_at unchanged and moves updated_at past retired_at\". Then map each service to its evidence: indicators and ingest are SQL text plus bound args; analysis is runtime.\n- A merge-order.md entry for the overlap with features 244/245 on the indicators servicer.py (:652) and analysis servicer.py (:3581).\n- A launch-step promotion rule for the @AC-1..3 ID collision with the feature-224 scenarios in each private-by-default-templates.feature suite. Keep the `@feature-269` tag and dedupe on the (feature, AC) pair, or renumber. State which one explicitly.\n- File the indicators/ingest real-PG harness gap durably in docs/context-constitution-findings.md or the debt radar, not only in context.md.\n\nClosed assumption: the agent has no ManageTemplate path; only the three servicers and the UI call it. So FR-5 and empty-name full-replace have no agent consumer.\n\nTrace-id standing decision: not engaged. No new outbound calls, emits or contexts are added, and inbound metadata is untouched.",
    "open_objections": [
      {
        "text": "[C-15] @AC-2 (acceptance.feature:17-22) binds literal retire times 2026-10-21T10:00Z/11:00Z that no planned test can bind to. Rewrite it in relative form: second RETIRE leaves retired_at unchanged; updated_at advances past retired_at. In the spec, map each service to its evidence: indicators/ingest = SQL text plus bound args, analysis = runtime. Adopted in the synthesis; stays open until the spec makes the edit.",
        "blocking": false
      },
      {
        "text": "[C-18 / fails.md:2253] Real-PG check (c) must be strict: second updated_at > first updated_at AND > retired_at. The proposal's '>=' passes even when the fix is missing. The step text must state that each repo call is its own autocommit statement via the pool (test_read_budget_real_pg.py:25-28), never one conn.transaction(), because NOW() is the transaction start time. context.md must say the analysis RETIRE leg is a regression pin, not FR-3/FR-4 evidence. Adopted in the synthesis; the proposer has not yet confirmed.",
        "blocking": false
      },
      {
        "text": "[C-18 DRY] Reading the DDL from migration 026 drifts silently once a later migration alters the table. The regex must anchor on `CREATE TABLE IF NOT EXISTS analysis.strategy_templates` and end at the first `\\n);`, because DEFAULT NOW() sits at 026:97-98. The test must also assert that no other migrations/*.up.sql mentions strategy_templates; verified today that only 026 does. Adopted in the synthesis; the proposer has not yet confirmed.",
        "blocking": false
      },
      {
        "text": "[C-16] @AC-1..3 share numbers with the feature-224 scenarios in each private-by-default-templates.feature suite. The spec launch step must name the promotion rule: keep @feature-269 and dedupe on the (feature, AC) pair, or renumber. The r1 synthesis named tagging, but r2 did not carry it into a step.",
        "blocking": false
      },
      {
        "text": "[C-18 / fails.md:2716] The accepted runtime-proof gap for indicators and ingest (no real-PG harness) needs a durable home: an entry in docs/context-constitution-findings.md or the debt radar, not only context.md, which gets archived and pruned.",
        "blocking": false
      }
    ],
    "floor_breaches": [],
    "business_rule_changes": [
      {
        "ac_id": "@AC-1 (feature-269: UPDATE persists name/description, full-replace)",
        "kind": "CHANGE",
        "covered_by_operator_decision": true
      },
      {
        "ac_id": "@AC-2 (feature-269: RETIRE first-wins retired_at + updated_at stamp; scenario text to be relativized)",
        "kind": "CHANGE",
        "covered_by_operator_decision": true
      },
      {
        "ac_id": "@AC-3 (feature-269: ingest CREATE requires template_id, INVALID_ARGUMENT)",
        "kind": "CHANGE",
        "covered_by_operator_decision": true
      },
      {
        "ac_id": "@AC-13 (admin gate before template writes; ingest guard placed after it)",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "@AC-14 (UPDATE bumps version; now also writes name/description)",
        "kind": "EXTEND",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "@AC-17 (retire does not touch instance rows)",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "@AC-31 (retire WHERE unfiltered / repeat retire returns row)",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      }
    ],
    "rejected_alternatives": [
      "update(template_id, name, description, payload) signature: lost to update(meta, payload_json). meta matches the sibling create(meta, ...) and keeps each call-site diff to one line.",
      "Shared Python template-repo module (D-20): it would give one SQL source and one real-PG test for all three services, but it crosses service package boundaries, is out of spec scope, and would collide with 266-fix-db-tls-fail-closed.",
      "COALESCE(NULLIF($2,''), name) keep-prior UPDATE semantics: adds a second UPDATE rule that diverges from ingest, and nothing asks for it.",
      "Empty template_id guard for all ingest ops: changes UPDATE/RETIRE from NOT_FOUND to INVALID_ARGUMENT with no @AC asking for it.",
      "Copying local_pg into the indicators and ingest conftests for real-PG tests: would close the runtime gap, but copies about 50 lines of fixture per service, the per-feature rig fails.md:2253 rules out. Replaced by a durable findings/debt-radar follow-up.",
      "Inline DDL copy in the analysis real-PG test: it drifts from the real schema. Lost to reading migration 026 plus a no-other-migration-mentions-the-table assertion.",
      "Running every analysis migration in order for the real-PG test: not viable, because 026 depends on SEED_USER_ID and earlier tables.",
      "Handler-level @AC-2 proof through injectable-clock or first-wins fakes: it proves only the fake (fails.md:2253).",
      "SQL text plus bind-arg proof everywhere, with no analysis real-PG test: it repeats the vacuous-green pattern in the one service where a harness already exists."
    ],
    "open_risks": [
      "Indicators and ingest have only SQL text plus bound-arg proof. A column or bind-order mistake mirrored in both the SQL and its assertion would pass. Accepted, and to be filed durably (findings or debt radar) as a shared real-PG fixture follow-up.",
      "Analysis real-PG RETIRE timing depends on separate autocommit statements. A future refactor that wraps the calls in one transaction makes the strict assertion fail falsely; mitigated by the step text.",
      "Direct gRPC callers that send name=\"\" on UPDATE now blank the name in indicators and analysis. Intentional; the UI always sends both fields and the agent has no ManageTemplate path.",
      "Merge conflicts with features 244/245 on the indicators servicer.py:652 and analysis servicer.py:3581 until merge-order.md sequences them.",
      "Promoting @AC-1..3 could collide with the feature-224 IDs in the durable suites if the launch step does not name a dedupe or renumber rule."
    ],
    "constitution_rules_touched": [
      "C-11",
      "C-13",
      "C-15",
      "C-16",
      "C-18",
      "P-02",
      "P-03",
      "P-06",
      "F-01",
      "F-04",
      "F-06",
      "F-07",
      "C-03 (not engaged: no new outbound/emit contexts)"
    ],
    "rationale": "The r2 proposer explicitly confirmed all three r1 blocking objections:\n- @AC-2 proof comes from repo SQL text plus bound args, and handler tests check wiring only;\n- the analysis real-PG test is required;\n- the fakes and broken tests are listed in the step Files.\n\nThe process objection (merge-order.md as a deliverable) was also accepted, so all r1 objections close. The adversary returned SOUND with no Floor breaches and five non-blocking objections. I verified two of its claims:\n- `grep strategy_templates migrations/*.up.sql` hits only 026, so the drift guard passes today and is cheap.\n- acceptance.feature:20 binds literal 10:00Z/11:00Z retire times, so the @AC-2 text does need relativizing.\n\nThe `>=` comparison in check (c) is a real vacuous-pass hole, and the transaction-scoped NOW() trap is real. Both are folded into the approach as strict assertions and autocommit-per-call. The adversary also closed the proposer's agent assumption: no agent ManageTemplate path exists.\n\nThe remaining objections are spec-level edits: the @AC-2 rewrite, the C-16 promotion rule, and a durable home for the gap. None of them changes the code repair, so none blocks design approval. They stay open because the r2 proposal did not concretely answer them. The feature-269 @AC-1..3 changes are sanctioned by the operator's D-41 scope decision. Durable @AC-13/17/31 are preserved, and @AC-14 is extended."
  },
  "floor_breaches": []
}
```

## Session 2026-10-22 — sdd-design

- Phase 0 Recon: wrote recon.md for xstockstrat-indicators, xstockstrat-analysis and xstockstrat-ingest, with xstockstrat-ui as a read-only consumer. Key reuse patterns:
  - ingest's `update` SET name/description shape;
  - analysis's first-wins `retire` SQL (`strategy_templates.py:72`).
- Phase 1 Grilling: 2 rounds (full). The operator approved at the r2 gate on 2026-10-22 ("APPROVED as synthesized"). Wrote design.md.
- Chosen approach: three independent per-service steps.
  - Indicators and analysis: `update(meta, payload_json)` persists name/description with full-replace semantics.
  - Indicators: `retire` also stamps `updated_at`.
  - Ingest: `retire` becomes first-wins plus `updated_at`, and CREATE gets an empty-id INVALID_ARGUMENT guard after the db and ADMIN gates; the `uuid4()` fallback is dropped.
  - Proof: SQL text plus bound-arg repo tests, a required analysis real-PG test, and wiring-only handler tests.
- Rejected:
  - a shared template-repo module (D-20 scope, collides with 266);
  - keep-prior COALESCE UPDATE semantics;
  - an all-ops ingest guard;
  - per-service `local_pg` copies;
  - inline DDL;
  - fake-based @AC-2 proof.
- Deliberate behavior change: an empty name or description on UPDATE now blanks the stored value in indicators and analysis, matching ingest. A bind test pins it.
- The analysis real-PG RETIRE leg is a regression pin, not FR-3 or FR-4 evidence.
- Constitution rules touched: C-03 (not engaged), C-11, C-13, C-15, C-16, C-18, P-02, P-03, P-06, F-01, F-04, F-06, F-07. Floor breaches: none.
- C-16:
  - CHANGE feature-269 @AC-1..3, sanctioned by the operator's D-41 scope decision and the r2 gate approval.
  - PRESERVE @AC-13, @AC-17 and @AC-31.
  - EXTEND @AC-14.
- Status: spec-ready → design-approved.

### Open Threads

- [ ] Rewrite @AC-2 (`acceptance.feature:20`) in relative form, then map each service to its evidence. Target: /sdd-spec.
- [ ] Indicators and ingest have only SQL text plus bound-arg proof. File the shared real-PG fixture gap durably in `docs/context-constitution-findings.md` or the debt radar. Target: /sdd-spec deliverable.
- [ ] Analysis real-PG timing depends on autocommit-per-call, and the step text must say so. Target: the analysis step.
- [ ] An empty `name` on UPDATE now blanks the name in indicators and analysis. Pin it with a bind test. Target: the indicators and analysis steps.
- [ ] Merge-order entry for features 244 and 245 on indicators `servicer.py:652` and analysis `servicer.py:3581`. Target: /sdd-spec (merge-order.md).
- [ ] Name the promotion rule for the @AC-1..3 ID collision with feature 224: keep `@feature-269` and dedupe on (feature, AC), or renumber. Target: /sdd-spec launch step.

## Session 2026-10-22 — sdd-spec

- Generated implementation-spec.md with 9 steps. Status: design-approved → implementation-ready.
  - Steps 1–6 are three service/test pairs: indicators 1–2, analysis 3–4 (with the required real-PG file `tests/test_strategy_templates_real_pg.py`), and ingest 5–6.
  - Step 7 adds a soft entry to merge-order.md.
  - Step 8 records the D-41 residual proof gap in the debt radar.
  - Step 9 is the C-16 promotion at integration.
- Key codebase findings (re-verified on `feature/fix-template-update-metadata` @ 1276acf):
  - **Indicators:**
    - `update` is at `formula_templates_repository.py:50` (SQL at `:55`); `retire` is at `:64` (its SET at `:68` has no `updated_at`).
    - The only call site is `servicer.py:652`.
    - The fake `_FakeTemplates.update` is at `tests/test_formula_templates.py:83`.
    - There is no empty-id CREATE test, so Step 2 adds an @AC-3 pin.
  - **Analysis:**
    - `update` is at `strategy_templates.py:54` (SQL at `:59`); the call site is `servicer.py:3581`.
    - The mapper at `:7138-7150` reads name/description/updated_at, so it needs no change.
    - `local_pg` (`tests/conftest.py:367-368`) is session-scoped and shared, so the real-PG test uses distinct template_ids.
    - The migration 026 DDL is at `:89-99`, and only `026*.up.sql` mentions `strategy_templates`.
  - **Ingest:**
    - The `retire` SET is at `source_templates.py:71`.
    - In `ManageTemplate`: db gate `:1513-1515`, ADMIN gate `:1517-1519`, `meta =` at `:1521`, `validate_config_json` at `:1527`, uuid fallback at `:1540`. `uuid.uuid4` is also used at `:398`.
- Design spec deliverables resolved:
  - **@AC-2 is relativized** in acceptance.feature (this session). The literal 10:00Z/11:00Z became "keeps the retired_at set by the first RETIRE" and "updated_at later than that retired_at". The ID is unchanged (C-15). Per-service evidence is mapped in spec § Scenario Coverage: SQL text for indicators and ingest, runtime for analysis (regression pin only).
  - **The merge-order entry is Step 7**, a soft/rebase row following the merge-order.md:55 precedent. This writer's scope is limited to the feature directory, so the shared file is edited at execute time.
  - **The durable home for the gap is the debt radar D-41 entry (Step 8).** It was chosen over `docs/context-constitution-findings.md` because it is the finding's own home and does not trigger the context-forge teardown.
  - **The C-16 promotion rule is named:** keep `@feature-269`, with identity = (feature, AC). No renumbering. Promote into a new per-service `fix-template-update-metadata.feature`, following the feature-173 `fix-python-config-zero-trap.feature` precedent, and never into `private-by-default-templates.feature` (Step 9).
- C-14: there is no UI or agent step. Design decided that `/config-ui/templates` is reached by the backend fix with no UI edit (`page.tsx:153-158` re-read this session) and that the agent has no ManageTemplate path. Spec § Execution Summary restates this as a decision, not an omission.
- C-03: not engaged (operator standing trace-id decision, 2026-10-21). No step adds an outbound call, emit or context.

### Decisions

- Empty name/description on UPDATE is full-replace in indicators and analysis. This is a deliberate behavior change that matches ingest. Bind tests pin it: Step 2(b) and Step 4(b).
- The ingest empty-id guard is CREATE-only and sits after the ADMIN gate. Step 6(e) pins the @AC-13 ordering, and 6(c) pins that the guard runs before payload validation.

### Open Threads

- [x] Rewrite @AC-2 in relative form. Done in acceptance.feature (2026-10-22 sdd-spec).
- [ ] Record the indicators/ingest real-PG gap durably. Target: Step 8 (debt radar D-41).
- [x] State autocommit-per-call for the analysis real-PG test in the step text. Done: Step 4 instruction 7.
- [x] Pin the empty-name full-replace with a bind test. Specced in Steps 2(b) and 4(b).
- [ ] Add the merge-order entry for 244/245. Target: Step 7.
- [x] Name the promotion rule for the @AC-1..3 collision. Named in Step 9; it executes at integration.

## Session 2026-10-22 — sdd-review impl-spec

- `/sdd-review fix-template-update-metadata impl-spec` (MODE B, advisory). The lifecycle is unchanged (`implementation-ready`).
- Criteria verdict: **PASS WITH WARNINGS**, with 0 FAIL and 0 floor breaches. Overlap verdict: **WARN**. Every collision is file-level and rebase-only, with disjoint line ranges against 244, 245, 262, 268 and 272. There are no migration, proto or config collisions.

### Addressed

- Step 2 item 5 (d) was muddled: it applied a spy and then "restored the fake". It is now split into (d), which is the wiring spy only and is never undone, and a separate test (d′) `test_ac1_update_meta_visible_in_list`. (d′) builds a fresh `_servicer()` (re-verified at `tests/test_formula_templates.py:170-175`) so the lockstep fake is live, then runs UPDATE and checks the list. The Step 2 TDD line and red gate now include (d′).
- Step 6 Codebase Evidence now notes that ingest `source_templates.py` is a module of functions: `update` at `:50` and `retire` at `:67`, both re-verified.

### Still open (surface at the /sdd-execute checkpoint)

- [ ] Run Step 7 (the merge-order soft row for 244/245) before the integration PR. The overlap scan also found file-level, rebase-only overlap with 262, 268 and 272 on the indicators and analysis `servicer.py`. The executor should decide whether the Step 7 row names those features too. This review did not add them to the spec because the row text is a design deliverable.
- [ ] Indicators and ingest have SQL-text and bind proof only, with no real-DB proof. This trade-off was accepted (C-18). It is recorded durably by Step 8 (D-41).
- [ ] The analysis real-PG red proof (Step 4) runs only under `CI=true` and skips locally. Confirm it in CI and do not rely on a local run.
- Accepted as-is, no action: Steps 7-9 are docs steps with grep-only verification, so no coverage or lint gate applies to them.

## Session 2026-10-29 — re-spec (sdd-batch-execute branch setup)

- Branch setup: merged `origin/main-dev` into the feature branch (normal merge, no `-X`). One conflict in
  `docs/roadmap/ledger/fails.md` (append-only): kept both sides, base first; `ledger-guard --fix` reported clean.
- Re-spec, Steps 3, 4, 6, 7, 8 (bodies only, re-verified against the merged tree):
  - Step 3: analysis `servicer.py` drift. `meta = request.template.meta` :3542 → :3550, guard :3543-3552 → :3551-3559,
    UPDATE call :3581 → :3588, `_row_to_strategy_template` :7138-7150 → :7146-7158. `strategy_templates.py` evidence unchanged.
  - Step 4: `local_pg` `tests/conftest.py:367-368` → :402-403; its `CI=true` fail path is `_unavailable` :407-410;
    `ci.yml` postgresql install step :393-397 → :405-407. Other evidence unchanged.
  - Step 6: `_ctx` import :17 → :18.
  - Step 7: marked `done` with no edit. `merge-order.md:91` already holds a soft, non-blocking 269 row naming 244/245
    (and the 262/268/272 file-level overlap the impl-spec review asked about). Appending would duplicate it.
    The open thread "Add the merge-order entry for 244/245" is resolved by that row.
  - Step 8: stale `local_pg` citation :367-368 → :402-403. D-41 header (:407) unchanged.

## Session 2026-10-29 — sdd-execute sequential (sdd-batch-execute)

- Status: `implementation-ready` → `in-progress`. Mode: `sequential` (one commit per step on `feature/fix-template-update-metadata`, single integration PR at the end).
- Up-front confirmation: given by the operator's standing authorization in operator chat 2026-10-28/29
  (session_01NpS3HShZK6pSnogA7CFo2f): "Start executing features 241-276" via /sdd-batch-execute. Checkpoints run
  unattended (`report`). C-16 promotion is auto-confirmed unless it changes an existing @AC rule; Step 9 promotes into
  a new per-feature suite and leaves `private-by-default-templates.feature` untouched, so it qualifies. Merge-train is
  authorized. Operator-only DB/prod steps: open the PR and hold the merge. The operator recorded the per-feature blocker
  decisions on 2026-10-29 through the session's question tool.
- Severity: SEV-2. Remaining steps: 1–6, 8, 9 (Step 7 is already done, see the re-spec entry above).

## Session 2026-10-29 — sdd-execute sequential, Steps 1 + 2 (indicators)

- Steps 1 and 2 landed in one commit, as `## Step Dependencies` requires (Step 1 breaks the old fake and SQL test).
  Logged in the impl-spec `## Deviation Log`; no behavior deviation.
- Files: `services/xstockstrat-indicators/app/services/formula_templates_repository.py` (`update(meta, payload_json)`
  writes name/description with `meta.description or ""`; `retire` adds `updated_at = NOW()`, WHERE stays unfiltered),
  `app/handlers/servicer.py:652` (`update(meta, payload)`), `tests/test_formula_templates.py` (fake lockstep + tests a–e).
- TDD red (pre-Step-1 tree, Step 2 tests in place): `uv run pytest tests/test_formula_templates.py -q` → 10 failed,
  27 passed. AC-1 red: (a) SQL `SET name = $2, description = $3, payload = $4::jsonb` assert failed; (b) empty-name bind
  failed; (d)/(d′) failed (`'str' object has no attribute 'template_id'` — handler passed the id, not meta). AC-2 red:
  (c) `updated_at = NOW()` missing from retire SQL. The lockstep fake also turned the existing handler tests that
  UPDATE (`test_ac14_...`, `test_update_of_missing_template_is_not_found`, three `TestInstantiation` tests) red for
  the same reason. AC-3 (e) passed on both trees (regression pin, as specced).
- TDD green: same command → 37 passed. Full suite `uv run pytest --cov=app --cov-fail-under=50` → 369 passed, 84.28%.
  `ruff check .` and `ruff format --check .` clean. Step 1 grep checks all match.
- C-13: no new fixtures; `TemplateMeta` literals stay inline (single consumer).
- Out of scope: none. Open items unchanged (real-PG gap for indicators → Step 8).

## Session 2026-10-29 — sdd-execute sequential, Steps 3 + 4 (analysis)

- Steps 3 and 4 landed in one commit, as `## Step Dependencies` requires. Logged in the impl-spec `## Deviation Log`.
- Files: `services/xstockstrat-analysis/app/repositories/strategy_templates.py` (`update(meta, payload_json)` writes
  name/description, `meta.description` bound raw like `create`; `retire` untouched), `app/handlers/servicer.py:3588`
  (`update(meta, payload_json)`), `tests/test_strategy_templates.py` (fake lockstep, `_manage` gains `description=`,
  tests a–d), new `tests/test_strategy_templates_real_pg.py` (three `real_pg` legs).
- TDD red (pre-Step-3 tree, Step 4 tests in place, `-m "not real_pg"`): 4 failed, 29 passed. (a) SQL
  `SET name = $2, description = $3, payload = $4::jsonb` missing; (b) empty-name bind failed; (c) wiring spy failed
  (`'str' object has no attribute 'template_id'`); the existing `test_manage_template_update_bumps_version_and_retire_hides`
  also went red through the lockstep fake. (d) AC-3 pin passed on both trees.
- TDD green: same command → 33 passed. Full suite `uv run pytest -m "not real_pg" --cov=app --cov-fail-under=40`
  → 1438 passed, 89.82%. `ruff check .` / `ruff format --check .` clean; Step 3 greps match.
- Real-PG legs NOT run locally (never start a database); proof deferred to the integration PR's CI (Deviation Log).
- Tooling: `pnpm install --frozen-lockfile --ignore-scripts` in the worktree for the husky hook (main worktree had no
  `node_modules` to symlink).
- Out of scope: none.

## Session 2026-10-29 — sdd-execute sequential, Steps 5 + 6 (ingest)

- Steps 5 and 6 landed in one commit, as `## Step Dependencies` requires. Logged in the impl-spec `## Deviation Log`.
- Files: `services/xstockstrat-ingest/app/repositories/source_templates.py` (`retire` → `retired_at =
  COALESCE(retired_at, NOW())`, WHERE stays unfiltered, docstring wrapped for E501), `app/handlers/servicer.py`
  (`ManageTemplate`: CREATE-only `template_id required` INVALID_ARGUMENT guard after the ADMIN gate and `meta =`,
  before payload validation; CREATE binds `meta.template_id` with no uuid mint; `import uuid` kept for `job_id`),
  `tests/test_source_templates.py` (tests a–e).
- TDD red (pre-Step-5 tree, Step 6 tests in place): `uv run pytest tests/test_source_templates.py -q` → 3 failed,
  30 passed. (a) retire SQL lacked `COALESCE(retired_at, NOW())`; (b) empty-id CREATE minted a uuid and reached the
  mocked `create` (no abort); (c) abort carried `mcp_client requires non-empty mcp_endpoint in config_json` instead of
  `template_id required`. (d) AC-1 wiring pin and (e) AC-13 ordering pin passed on both trees, as specced.
- TDD green: same command → 33 passed. Full suite `uv run pytest --cov=app --cov-fail-under=40` → 349 passed, 83.22%.
  `ruff check .` / `ruff format --check .` clean; Step 5 greps match (`uuid.uuid4` count 1).
- Tooling: `pnpm install --frozen-lockfile --ignore-scripts` in the worktree for the husky hook.
- Out of scope: none. Remaining: Step 8 (real-PG gap record), Step 9 (C-16 promotion at integration).

## Session 2026-10-29 — sdd-execute sequential, Step 8 (debt radar D-41)

- File: `docs/repo-surveyor/debt-radar-findings.md` — one **Status (feature 269)** bullet appended after D-41's
  **Routing** bullet, text verbatim from Step 8 **Instructions**; no other finding edited.
- TDD: N/A (docs). Verification: `grep -n "Residual proof gap (accepted, follow-up)"` → line 417. Cited files
  re-checked: both repositories exist, `tests/test_strategy_templates_real_pg.py` exists (Step 4), and indicators/ingest
  tests still have zero `real_pg`/`local_pg` matches.
- Line drift only (no deviation): `local_pg` is at analysis `tests/conftest.py:403`; the bullet cites no line numbers.
- Out of scope: none. Remaining: Step 9 (C-16 promotion at integration).

## Session 2026-10-29 — sdd-execute sequential, Step 9 (C-16 promotion)

- Files: `services/xstockstrat-{indicators,analysis,ingest}/acceptance/fix-template-update-metadata.feature` created.
  Each holds `@AC-1..3` verbatim from `acceptance.feature` with only that service's `Examples:` row, `@feature-269`
  appended to every tag line, and the feature-173 provenance header.
- Promotion rule applied: the (feature, AC) pair is the identity; no renumbering, and the indicators
  `private-by-default-templates.feature` `@AC-1..3` (`@feature-224`) are untouched in all three services.
- TDD: N/A (docs). Verification: `@feature-269` count is 4 per file (3 tag lines + the mandated header line);
  recorded in the Deviation Log. `git diff --stat` on `private-by-default-templates.feature` is empty.
- Out of scope: none. Remaining: integration PR (§5.6).


## Session 2026-10-29 — sdd-batch-execute promotion plan (awaiting operator confirm)

- Operator note: Step 9 (commit `10f4d61d`) already created `services/xstockstrat-{indicators,analysis,ingest}/acceptance/fix-template-update-metadata.feature`
  carrying `@feature-269`, so the plan's "no @feature-269 tag exists anywhere yet" dedup claim and its `platform.feature` routing conflict with that tree; resolve before writing.

```sdd-batch-promotion-plan
## Promotion plan - fix-template-update-metadata (feature 269)

### Verdicts
| @AC | target suite (path) | CREATE/APPEND | verdict | note |
|---|---|---|---|---|
| AC-1 | docs/sdd/business-rules/platform.feature | APPEND | NEW | Outline spans indicators/analysis/ingest via Examples |
| AC-2 | docs/sdd/business-rules/platform.feature | APPEND | NEW | same |
| AC-3 | docs/sdd/business-rules/platform.feature | APPEND | NEW | same |

### Ready-to-write blocks
--- /home/user/xstockstrat/docs/sdd/business-rules/platform.feature (APPEND) ---
  @AC-1 @FR-1 @FR-2 @regression @feature-269
  Scenario Outline: An admin rename of a template is persisted and bumps the version once
    Given an admin and a <kind> template "t-1" named "Old" with description "d1" at version 1 in <service>
    When the admin calls ManageTemplate UPDATE on "t-1" with name "New", description "d2" and the same payload
    Then the UPDATE response returns "t-1" with name "New", description "d2" and version 2
    And ListTemplates on <service> returns "t-1" with name "New", description "d2" and version 2

    Examples:
      | kind          | service                |
      | FORMULA       | xstockstrat-indicators |
      | STRATEGY      | xstockstrat-analysis   |
      | SIGNAL_SOURCE | xstockstrat-ingest     |

  @AC-2 @FR-3 @FR-4 @regression @feature-269
  Scenario Outline: Retiring a template twice keeps the first retired_at and sets updated_at each time
    Given an admin and a <kind> template "t-1" in <service>
    When the admin retires "t-1"
    And the admin retires "t-1" again
    Then the second RETIRE succeeds and returns "t-1" as retired
    And "t-1" in <service> keeps the retired_at set by the first RETIRE
    And "t-1" in <service> has an updated_at later than that retired_at

    Examples:
      | kind          | service                |
      | FORMULA       | xstockstrat-indicators |
      | STRATEGY      | xstockstrat-analysis   |
      | SIGNAL_SOURCE | xstockstrat-ingest     |

  @AC-3 @FR-5 @regression @feature-269
  Scenario Outline: CREATE with an empty template_id is rejected
    Given an admin
    When the admin calls ManageTemplate CREATE on <service> with a <kind> template, template_id "" and a valid payload
    Then the call fails with INVALID_ARGUMENT
    And ListTemplates on <service> returns no new <kind> template

    Examples:
      | kind          | service                |
      | FORMULA       | xstockstrat-indicators |
      | STRATEGY      | xstockstrat-analysis   |
      | SIGNAL_SOURCE | xstockstrat-ingest     |

### Notes / ambiguities / conflicts
- Routing call: each scenario is a single Scenario Outline whose Examples span three services (indicators, analysis, ingest). Splitting per service would break the verbatim rule, and no single service owns the guarantee, so all three go to platform.feature (cross-service contract: the same ManageTemplate UPDATE/RETIRE/CREATE behavior on every template-owning service). Alternative if a human prefers per-service suites: split by Examples row into services/xstockstrat-{indicators,analysis,ingest}/acceptance/fix-template-update-metadata.feature (not recommended, it alters the scenario text).
- Dedup: grep for ManageTemplate, retired_at and template_id in all services/*/acceptance/*.feature found only services/xstockstrat-indicators/acceptance/private-by-default-templates.feature lines 38, 51 and 81. These are the private-by-default CREATE and origin-template rules, not UPDATE metadata, double-RETIRE or empty-id behavior, so there is no OVERLAP or CONFLICT. No @feature-269 tag exists anywhere yet, so this is not a re-run.
- Ingest has no ManageTemplate scenarios in its suite for these behaviors. Only the platform.feature append is needed.
- Affected services per feature.md Reviewers: indicators, analysis, ingest.

### Coverage check
- Source scenarios: 3 (AC-1, AC-2, AC-3). Planned (NEW+DUP+OVERLAP): 3 (3 NEW). All accounted for, none skipped. @AC numbers unchanged, @feature-269 added.
```

## Session 2026-10-29 — sdd-execute ALL-DONE PATH (C-16 promotion + integration PR)

- Status: `in-progress` → `code-completed`.
- C-16 resolution: the `sdd-batch-promotion-plan` above was **not** applied. Its `platform.feature` APPEND rests on a
  false premise ("no @feature-269 tag exists anywhere yet"): Step 9 (`10f4d61d`) already promoted `@AC-1..3` verbatim
  into `services/xstockstrat-{indicators,analysis,ingest}/acceptance/fix-template-update-metadata.feature` under the
  design/spec-named rule (identity = (feature, AC)). Appending would hold the same identity twice, so every row is DUP
  under the plan's own dedup rule and nothing new is written. `docs/sdd/business-rules/platform.feature` is unchanged.
- Open for the operator: if the cross-service `platform.feature` home is preferred, move (not copy) the three blocks
  there and delete the per-service files; flagged in the integration PR body.

## Session 2026-10-30 (CI: feature status automation)

- Promotion PR #1368 merged to main
- Feature promoted and committed: df521ff51091a86e813950b34afff09ac4e8821b
- Status updated: `code-completed` → `launched`
- Launched date: 2026-10-30
