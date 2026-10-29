# Design: fix-template-update-metadata

**Created**: 2026-10-22
**Rounds**: 2 (full; termination: approved, with non-blocking open risks accepted)
**Approved by**: operator @ 2026-10-22 (design gate r2: "APPROVED as synthesized"; Floor clear)
**Grounded in**: recon.md

---

## Chosen Approach

The fix is three independent per-service steps. Each step lands its code, fakes and tests together. It needs no proto, migration, config key or new service edge (recon.md:133).

**1. Indicators (FR-1, FR-4).** File: `services/xstockstrat-indicators/app/services/formula_templates_repository.py`.
- `update(template_id, payload_json)` (recon.md:32) becomes `update(meta, payload_json)`. It now matches the sibling `create(meta, ...)`.
- New SQL: `SET name=$2, description=$3, payload=$4::jsonb, version=version+1, updated_at=NOW() WHERE template_id=$1 AND retired_at IS NULL`.
- It binds `meta.description or ""`, the same as this class's own `create`.
- `retire` (recon.md:33) adds `, updated_at = NOW()`. It keeps first-wins `COALESCE(retired_at, NOW())` and the unfiltered WHERE.
- Call site: `app/handlers/servicer.py:652` (recon.md:27) becomes `update(meta, payload)`.

**2. Analysis (FR-1).** File: `services/xstockstrat-analysis/app/repositories/strategy_templates.py:54-66` (recon.md:50).
- Same signature and SQL change as indicators.
- It binds `meta.description` raw, the same as its `create` at `:48`.
- `retire` (`:68-78`, recon.md:51) already meets FR-3 and FR-4, so it does not change.
- Call site: `app/handlers/servicer.py:3581` (recon.md:46).

**3. Ingest (FR-3, FR-5).**
- `app/repositories/source_templates.py` `retire` (recon.md:66) becomes `SET retired_at = COALESCE(retired_at, NOW()), updated_at = NOW()`, with the WHERE unfiltered. The SQL is copied from analysis `strategy_templates.py:72`.
- In `app/handlers/servicer.py` `ManageTemplate`, add a CREATE-only empty-`template_id` guard that returns INVALID_ARGUMENT. The step text must state the order:
  1. after the db gate (`:1513-1515`);
  2. after the ADMIN gate (`:1517-1519`, recon.md:57);
  3. after `meta =` (`:1521`);
  4. before `validate_config_json` (`:1527`).
- Drop `or str(uuid.uuid4())` at `:1540` (recon.md:61). `import uuid` stays because `:398` still uses it (recon.md:63).

**UPDATE semantics.** An empty name or description on UPDATE fully replaces the stored value in all three services. This matches ingest and the UI. For indicators and analysis it is a deliberate behavior change. It is recorded in context.md and pinned by a bind test (recon.md:153).

**Proof plan.**
- (a) **Repo tests, red first.** Each service gets repo tests that assert the SQL clauses and the bound args (`fetchrow.call_args.args`). For indicators and ingest these tests are the @AC-1/@AC-2/@AC-3 evidence.
- (b) **Required analysis real-PG test.** File: `services/xstockstrat-analysis/tests/test_strategy_templates_real_pg.py`, with `pytestmark = pytest.mark.real_pg`.
  - Fixtures: the session `local_pg` fixture (`tests/conftest.py:368-375`, which fails under `CI=true`; `ci.yml:393-397` installs PG) and the `_pool()` pattern from `tests/test_read_budget_real_pg.py:25-28`.
  - Schema: run `CREATE SCHEMA analysis`, then the DDL read from `migrations/026_owner_dimension_templates.up.sql:89-99`.
    - The regex anchors on `CREATE TABLE IF NOT EXISTS analysis.strategy_templates` and ends at the first `\n);`. It must not use a lazy `\)`, because `DEFAULT NOW()` sits at `:97-98`.
    - The test asserts the statement was found.
    - The test asserts that no other `migrations/*.up.sql` mentions `strategy_templates`. Verified today: only 026 does.
  - Each repo call is its own autocommit statement through the pool, never inside one `conn.transaction()`, because `NOW()` is the transaction start time.
  - What it proves:
    - UPDATE persists name/description, with version going from 1 to 2.
    - UPDATE of a retired row returns `None`.
    - A double RETIRE keeps the first `retired_at`. The second `updated_at` is strictly greater than the first `updated_at` and strictly greater than `retired_at`. Use `pg_sleep(0.01)` between calls and no wall-clock literals.
    - Bind order is correct, using distinct name, description and payload values.
  - The RETIRE leg is a **regression pin** for analysis. It is not FR-3 or FR-4 evidence.
- (c) **Handler tests check wiring only.** They spy at the repo boundary for method, args and response mapping. No clock and no first-wins logic go into the fakes (recon.md:139; fails.md:2253).
- (d) **Fakes and broken tests go in the step Files** (recon.md:149).
  - Analysis `tests/test_strategy_templates.py`:
    - `FakeTemplates.create` (`:99-103`) gains description.
    - `.update` (`:105-110`) takes the new signature.
    - `.retire` (`:112-116`) is listed.
    - `:686` is rewritten.
  - Indicators `tests/test_formula_templates.py`:
    - `_FakeTemplates.update` (`:83-89`).
    - The SQL tests at `:535` and `:545`.
    - The handler test at `:241`.
  - Ingest `tests/test_source_templates.py`: `:445` is rewritten, and @AC-2/@AC-3 tests are added.

**Consumer surface (C-14).** The change reaches `/config-ui/templates` in xstockstrat-ui with no UI edit. That page already sends `templateId`, `name` and `description` on UPDATE (`page.tsx:153-158`, `:382`, recon.md:71), so admin renames now take effect. The agent has no ManageTemplate path; `list_templates` and `instantiate_template` only read these fields (recon.md:133). So FR-5 and empty-name full-replace have no agent consumer.

**Trace-id standing decision (operator 2026-10-21): not engaged.** The fix adds no new outbound calls, emits or contexts, and leaves inbound metadata untouched.

**Spec deliverables carried to /sdd-spec:**
- Rewrite @AC-2 in relative form. Today `acceptance.feature:20` binds the literal times 10:00Z/11:00Z.
  - New Then-clause: "a second RETIRE leaves retired_at unchanged and moves updated_at past retired_at".
  - Map each service to its evidence: indicators and ingest use SQL text plus bound args; analysis uses the runtime test.
- Add a `merge-order.md` entry for the overlap with features 244/245 on indicators `servicer.py:652` and analysis `servicer.py:3581`.
- Name a launch-step promotion rule for the @AC-1..3 ID collision with the feature-224 scenarios in each `private-by-default-templates.feature` suite (recon.md:126). Either keep the `@feature-269` tag and dedupe on the (feature, AC) pair, or renumber. The spec must say which.
- File the indicators/ingest real-PG harness gap durably, in `docs/context-constitution-findings.md` or the debt radar, not only in context.md.

## Rejected Alternatives

- `update(template_id, name, description, payload)` signature — rejected because `update(meta, payload_json)` matches the sibling `create(meta, ...)` and keeps each call-site diff to one line.
- Shared Python template-repo module (D-20) — rejected because it crosses service package boundaries, is out of spec scope, and would collide with 266-fix-db-tls-fail-closed. It would have given one SQL source and one real-PG test.
- `COALESCE(NULLIF($2,''), name)` keep-prior UPDATE semantics — rejected because it adds a second UPDATE rule that diverges from ingest, and nothing asks for it.
- Empty-`template_id` guard on every ingest op — rejected because it changes UPDATE/RETIRE from NOT_FOUND to INVALID_ARGUMENT, and no @AC asks for that.
- Copying `local_pg` into the indicators and ingest conftests — rejected because it copies about 50 lines of fixture per service, the per-feature rig that fails.md:2253 rules out. A durable findings/debt-radar follow-up replaces it.
- Inline DDL copy in the analysis real-PG test — rejected because it drifts from the real schema. Reading migration 026 plus a no-other-migration guard won.
- Running every analysis migration in order for the real-PG test — rejected because it is not viable: 026 depends on `SEED_USER_ID` and earlier tables.
- Handler-level @AC-2 proof through injectable-clock or first-wins fakes — rejected because it proves only the fake (fails.md:2253).
- SQL text plus bind-arg proof everywhere, with no analysis real-PG test — rejected because it repeats the vacuous-green pattern in the one service where a harness already exists.

## Open Risks

- [ ] Indicators and ingest have only SQL text plus bound-arg proof, so a column or bind-order mistake mirrored in both the SQL and its assertion would pass. Accepted. To be addressed at the /sdd-spec findings/debt-radar deliverable: file a shared real-PG fixture follow-up.
- [ ] The analysis real-PG RETIRE timing depends on separate autocommit statements. A future refactor that wraps the calls in one transaction would make the strict assertion fail falsely. To be addressed at the analysis step text, which states autocommit-per-call.
- [ ] Direct gRPC callers that send `name=""` on UPDATE now blank the name in indicators and analysis. This is intentional: the UI always sends both fields and the agent has no ManageTemplate path. To be addressed at the indicators and analysis steps with a pinned bind test.
- [ ] Features 244/245 also touch indicators `servicer.py:652` and analysis `servicer.py:3581`, so merges can conflict until `merge-order.md` sequences them. To be addressed at /sdd-spec with a merge-order.md entry.
- [ ] Promoting @AC-1..3 could collide with the feature-224 IDs in the durable suites. To be addressed at the /sdd-spec launch step, which must name a dedupe or renumber rule.
- [ ] The @AC-2 text still binds literal retire times. To be addressed at /sdd-spec: rewrite it relatively in acceptance.feature.

## Constitution Rules Touched

- `C-03` — not engaged: the fix adds no new outbound, emit or context-creation paths, and inbound metadata is untouched (operator standing trace-id decision 2026-10-21).
- `C-11` — honored by: full-mode debate of 2 rounds, operator approval at the gate, and design-phase ledger review.
- `C-13` — honored by: changes to the existing fakes and fixtures are listed in each step's Files. No new fixture home is created.
- `C-15` — honored by: @AC-1..3 stay the acceptance source of truth. The @AC-2 literal-time text is rewritten in relative form at /sdd-spec.
- `C-16` — honored by: durable @AC-13/@AC-17/@AC-31 are preserved and @AC-14 is extended. The feature-269 @AC-1..3 CHANGEs are operator-sanctioned (D-41 scope). The promotion collision rule is named at /sdd-spec.
- `C-18` — honored by: no per-feature PG rig. The analysis real-PG test reuses the existing `local_pg`, the DDL guards against drift, assertions are strict (`>`), and the indicators/ingest gap gets a durable home.
- `P-02` — honored by: subagents (proposer, adversary, recon) reported up only. The orchestrator synthesized the result, and this single writer recorded it.
- `P-03` — honored by: open design forks were surfaced and resolved at the operator gate, not guessed. The residual spec-level edits are carried explicitly as Open Risks and spec deliverables. These forks were empty-name semantics, guard scope and the proof source.
- `P-06` — honored by: the proof plan makes the repo SQL/bind tests and the analysis real-PG test fail first (red) before the fix.
- `F-01` — honored by: no migration is edited. The real-PG test only reads migration 026's DDL and does not modify it.
- `F-04` — honored by: every path and symbol is grounded in recon.md. Line numbers are re-verified at /sdd-spec.
- `F-06` — honored by: no new pool. The real-PG test uses the local test PG via the existing `local_pg` fixture, not the shared cluster.
- `F-07` — honored by: no config values introduced or hardcoded.

Floor breaches: none.

## Business Rules Touched (C-16)

- CHANGE `@AC-1` (feature-269) "UPDATE persists name/description, full-replace" — altered guarantee; signed off by operator @ 2026-10-22 (context.md: D-41 scope decision + design gate r2 "APPROVED as synthesized").
- CHANGE `@AC-2` (feature-269) "RETIRE keeps first-wins retired_at and stamps updated_at"; the scenario text gets relativized — altered guarantee; signed off by operator @ 2026-10-22 (context.md: D-41 scope decision + design gate r2).
- CHANGE `@AC-3` (feature-269) "ingest CREATE requires template_id, INVALID_ARGUMENT" — altered guarantee; signed off by operator @ 2026-10-22 (context.md: D-41 scope decision incl. RETIRE/CREATE divergences + design gate r2).
- PRESERVE `@AC-13` "Only admins can author templates" (`services/xstockstrat-indicators/acceptance/private-by-default-templates.feature`) — not regressed by: the ingest FR-5 guard sits after the ADMIN gate (`:1517-1519`).
- EXTEND `@AC-14` "Any user can browse the catalog and updates bump the version" (same suite) — new case added: UPDATE also writes name/description, and a metadata-only UPDATE bumps the version by exactly 1 (FR-2).
- PRESERVE `@AC-17` "Template updates never mutate existing instances" (same suite) — not regressed by: UPDATE and RETIRE write only the template row.
- PRESERVE `@AC-31` "Retiring a template hides it but leaves instances intact" (same suite) — not regressed by: the retire WHERE stays unfiltered, a repeat retire still returns the row, and only the `retired_at`/`updated_at` writes change.

## Rounds

- **Round 1** — The proposer gave the per-service code repair. The adversary raised three blocking objections:
  - the @AC-2 proof source (it must be repo SQL plus bound args, not handler fakes);
  - a required analysis real-PG test;
  - fakes and broken tests listed in the step Files.

  It also raised a process objection: merge-order.md as a deliverable.
- **Round 2** — The proposer confirmed all r1 objections. The adversary returned SOUND, with no Floor breaches and five non-blocking objections:
  - relativize the @AC-2 text;
  - strict `>` assertions with autocommit-per-call;
  - an anchored DDL regex plus a no-other-migration guard;
  - a C-16 promotion rule;
  - a durable home for the harness gap.

  All five are folded into the approach or carried as spec deliverables.
- **Termination**: approved by the operator at the r2 gate ("APPROVED as synthesized", 2026-10-22). The remaining objections are spec-level edits and do not change the code repair.
