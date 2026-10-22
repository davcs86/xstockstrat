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
