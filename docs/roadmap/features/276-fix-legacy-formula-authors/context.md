# Context Log: fix-legacy-formula-authors

Append-only. Each session appends a new ## Session entry. Never delete or edit prior entries.

---

## Session 2026-10-22 (/sdd-triage)

- Bug reported via defect report `docs/reports/2026-10-22-indicators-legacy-username-formula-authors-defect.md` (Issues disabled)
- Severity: SEV-2, environment dev (staging) → Track C
- Created: feature.md, product-spec.md, acceptance.feature (regression scenarios), context.md
- Affected services: xstockstrat-indicators
- Root cause hypothesis: pre-migration rows never backfilled from username to user id
- Recommended design depth: full → `/sdd-design fix-legacy-formula-authors` (rationale: a data rewrite on ownership rows is mentioned, and production has not been checked)
- Development branch: feature/fix-legacy-formula-authors
- Scope boundary with 275: 275 reports the failure instead of hiding it; this feature removes the cause.
- Open questions for design: are there production rows and other legacy-username authors; how the username maps to a user id (identity lookup vs a fixed mapping); delivery shape (migration vs script vs admin RPC) and rollback; whether the read guard should reject non-user-id authors at write time.

---

## Session 2026-10-22 — sdd-review product-spec

- Product spec approved. Status: draft → spec-ready.
- Criteria verdict: PASS WITH WARNINGS (no fails, no floor breaches).
- Warnings:
  - Criterion 9: OQ-1 to OQ-4 are plain bullets and still unresolved. OQ-1 (username-to-user-id mapping source) gates FR-1, FR-3, AC-1 to AC-3 and AC-7. They must be resolved at `/sdd-design` (C-11), before `/sdd-spec`. Kept as plain bullets deliberately (open checkboxes would fail criterion 9).
  - Criterion 7: DB strategy (migration, script or admin RPC), run order and down-migration meaning are unresolved; next migration number is 008 (tip 007), re-derive at spec time. A migration cannot call identity (OQ-1).
  - Criterion 8: AC-8 was non-deterministic. Resolved: rewritten as a concrete interleaving with concrete ids.
  - Criterion 8: FR-7 had no scenario for who-may-run or system-author rows. Resolved: added AC-9; the who-may-run mechanism is still a design decision.
  - Criterion 8: non-UUID ids (`f-orphan`, `f-ambiguous`, `f-live`, `f-gone`, `f-system`, `f-owned`) in AC-2 to AC-5 and AC-7, and AC-5 gives counts but no concrete rows. Left as-is; make concrete at `/sdd-spec`.
  - Criterion 8: AC-1 packs three outcomes in one `Then`; AC-5 presupposes a report-only mode (FR-5 allows dry-run or read-only report). Mechanism-agnostic by intent.
  - Cosmetic: FR-7 listed before FR-6. Resolved: reordered.
  - C-10(c): design must make FR-7 concrete (operator authority, concurrency protection, reserved system author never touched).
  - C-14: deferred checks to carry into `/sdd-spec`: confirm no UI code change, and check the `strat-lab` plugin `backtest` skill for any documented quirk this changes.
  - Code-grounded check: the read guard matches the spec (`_can_read_formula` at services/xstockstrat-indicators/app/handlers/servicer.py:141-148; `GetFormula` NOT_FOUND for a non-reader non-admin). The `list_formulas` author_filter behaviour and the 268/275 overlap content were not verified by the reviewer.
- Overlap findings (WARN, no FAIL):
  - File: services/xstockstrat-indicators/app/handlers/servicer.py read path and `_can_read_formula` vs `268-fix-indicators-formula-correctness` (product-spec.md:77-78, D-54). Rebase-level risk; 276 must not edit the read guard (FR-6).
  - File: servicer.py vs `269-fix-template-update-metadata` (implementation-spec.md:65, :77, ManageTemplate, disjoint handler). Rebase-only.
  - File: servicer.py vs `244-fix-python-config-stored-zero`. Rebase-only.
  - Handoff, not a collision: `275-fix-backtest-silent-symbol-skip` (product-spec.md:61-63, :159) defers the legacy-username author rewrite to this feature; 275 is read-only on indicators and expects this fix to remove the cause of the PERMISSION_DENIED/NOT_FOUND it reports.

### OPERATOR DECISIONS (binding, recorded 2026-10-22)

- Triaged 2026-10-22 from docs/reports/2026-10-22-indicators-legacy-username-formula-authors-defect.md; Track C; same triage-to-spec workflow as the debt-radar batch (254-275). The feature dir lives on the base branch ccr-fac38b1f-6m24q2 (PR #1322, not yet merged to main-dev).
- Operator 2026-10-21 (standing, all features): x-trace-id must be propagated as much as possible; no C-03 waiver — request-derived emits/writes use context.WithoutCancel(ctx) (Go) / the inbound metadata (Python/Node), never a fresh background context; only work with no originating request (background sweepers/loops) may mint its own context, and it should still carry a trace id when one is available.
- Scope boundary with feature 275-fix-backtest-silent-symbol-skip: 275 makes the failure visible (EVALUATION_FAILED rows, INSUFFICIENT_DATA, and maps an admin's PERMISSION_DENIED to FORMULA_ERROR); this feature removes the cause by correcting the stored authors. Do not re-do 275's reporting changes.
- Operator instruction 2026-10-22: run the full speccing (review, recon, full design debate, spec, impl-spec review). Production has NOT been checked for legacy-username authors; the design must treat the prod row count as unknown and must not assume the six staging ids are the only ones. Do not run any production or staging data change during speccing.
- Review note 2026-10-22: the first two product-spec reviews failed on PERMISSION_DENIED vs NOT_FOUND. Indicators returns NOT_FOUND to a non-admin caller (servicer.py:251-253) and PERMISSION_DENIED only to an admin (servicer.py:245-250); the branch already carries the corrected FR-1 and AC-6 text, so review the CURRENT branch text.

---

## Session 2026-10-22 — sdd-batch design gate (round 2)

Status unchanged (spec-ready); design.md NOT written (gate policy: halt, grilling protocol).

### Open Threads

- **Approach.** Operator-run maintenance CLI in indicators (`python -m app.maintenance.legacy_authors`), no migration, RPC, proto, startup hook or config. Two modes: REPORT (default, zero writes; detects non-system, non-UUID authors, classifies each against an operator-supplied users file as suggested / unmappable / ambiguous, writes a plan) and APPLY (requires a digest-matched, fully-confirmed plan). Users file comes from an additive `manage-users.py list-users --json` (user_id, email local part, is_active; no roles). Order is edit plan, hash, record in the DBA change record, apply.
- **Write safety.** Every write is one autocommit CAS `UPDATE ... WHERE formula_id AND author=$old AND author <> SYSTEM_AUTHOR AND author !~* uuid-re`; apply re-derives targets from the DB (plan intersect live detection), refuses SYSTEM/UUID old_author and non-UUID, unknown or inactive new_author, and leaves updated_at untouched. The result file is the undo/audit record. Required DATABASE_URL, no fallback, pooled :25061 with DB_PGBOUNCER.
- **Restart and verify.** The formula cache has no TTL, so every indicators instance must be restarted after apply; verify AC-1 via GetFormula/ExecuteFormula/test_formula as the owner, not ListFormulas.
- **Strongest open objection (blocking).** AC-9 narrowing: the code can only enforce integrity (digest, confirmation, no system/UUID rows); authority is the DB credential plus the DBA change record. This needs explicit operator sign-off recorded here, or an AC-9 reword at /sdd-spec. Fallback if refused: an admin-gated additive RPC, which reopens proto churn and the indicators @AC-28 conflict. Two further blocking items are answered only if r3 carries them: SQL-level system/UUID guard plus DB re-derivation, and the edit-hash-record ordering with "digest is integrity, not authority" wording.
- **Floor status.** No Floor breaches.
- **@AC changes not covered by an operator decision.** EXTEND AC-1, AC-6; CHANGE AC-9; PRESERVE feature FR-4/AC-4, platform @AC-6, indicators @AC-28, indicators @AC-4, platform @AC-18/@AC-19.
- **Non-blocking.** Operator workstation must reach the managed DB; FakeFormulasTable is not a real-Postgres harness (mitigated by full-predicate fake plus a SQL-text guard test); the email-local-part heuristic is unverified on prod (OQ-2).

```sdd-batch-design-state
{
  "round": 2,
  "synth": {
    "approach": "Operator-run maintenance CLI in indicators, no migration/RPC/proto/startup hook/config. New: services/xstockstrat-indicators/app/maintenance/__init__.py, app/maintenance/legacy_authors.py (run as `uv run python -m app.maintenance.legacy_authors` from the workstation), tests/test_legacy_authors.py, docs/runbooks/legacy-formula-authors.md. Edit: scripts/manage-users.py (additive `list-users --json`), services/xstockstrat-indicators/CLAUDE.md (Maintenance section), indicators docs/context-constitution.md (invariant: author is a user id or SYSTEM_AUTHOR).\n\nConnection: one asyncpg.connect (no pool, main.py untouched); statement_cache_size=0 when DB_PGBOUNCER is set (rule at app/main.py:55-57). DATABASE_URL is REQUIRED with no .env/localhost fallback (deliberately NOT copying manage-users.py:62-78 fallback); both modes print target host+db and the result file records them. Runbook pins the pooled :25061 URL + DB_PGBOUNCER=true (F-06: stays off the direct :25060 budget of 8). Every write is one autocommit statement so transaction pooling is safe.\n\nStep 1 users export: `manage-users.py list-users --json` emits only user_id, email local part (not the full email), is_active. No roles (C-18/PII minimisation). The SELECT at scripts/manage-users.py:283 omits user_id today; add it. Indicators never reads identity.users; identity data enters only as an operator file.\n\nStep 2 REPORT (default, zero writes; FR-2/FR-5/AC-5): `--users users.json --out plan.json`. Detect with SELECT formula_id, author, deleted_at, updated_at FROM indicators.formulas WHERE author <> $SYSTEM_AUTHOR (app/formulas/__init__.py:5) AND author !~* '<uuid-re>', no deleted_at filter. Separate COUNT(*) with the complementary predicate for the clean bucket (soft-deleted included). Classify per distinct legacy author using ACTIVE users only, matching lower(author) == lower(email_local_part), while old_author is stored byte-exact for the CAS: 1 candidate = suggested (never applied as-is), 0 = unmappable (AC-3), 2+ = ambiguous (AC-7). The plan holds per row formula_id, old_author, new_author|null, status, source (heuristic|override) plus counts and a run_id. The operator edits the plan (suggested -> confirmed; may set an explicit override user id on unmappable/ambiguous and confirm = OQ-3 disposition).\n\nStep 3 APPLY: `--apply --plan plan.json --users users.json --confirm-digest <sha256>`. Order is edit -> hash -> record: the operator finishes editing the plan, THEN computes sha256, THEN records it in the DBA change record, THEN applies. Pre-flight refusals, each with zero UPDATEs: digest mismatch or missing; any entry not in {confirmed, unmappable, ambiguous} (leftover suggested aborts the run); any confirmed entry whose old_author equals SYSTEM_AUTHOR or matches the UUID regex; any new_author that is not a UUID, missing from the users file, or inactive. Targets are re-derived from the DB: apply re-runs the detection SELECT and writes only the intersection of {(formula_id, old_author) from confirmed plan entries} with the live detected set, so a hand edit can never widen the write set. Each write is `UPDATE indicators.formulas SET author=$new WHERE formula_id=$id::uuid AND author=$old AND author <> $system AND author !~* '<uuid-re>' RETURNING formula_id` (resolve_intent CAS pattern, formulas_repository.py:137-150); the predicate guard is in the SQL itself (C-10(c) / platform @AC-6). Zero rows = skipped_concurrent (AC-8). updated_at is untouched (content stamp, formulas_repository.py:74-80). The result file records run_id, target host/db, old and new author for every rewritten row, and counts of rewritten/skipped/unmappable/ambiguous; it is the undo record (reverse CAS from the same plan).\n\nRestart and verify (required design steps): `_load_formula` reads self._formulas first with no TTL (servicer.py:100,153), and admin GetFormula caches foreign rows (servicer.py:448-452; also filled at :255,:688). The runbook requires a redeploy/restart of EVERY indicators instance after apply (new process has an empty cache); then re-run report mode (0 rewritable for confirmed authors) and verify AC-1 as the owner through GetFormula/ExecuteFormula/test_formula on one rewritten id, NOT ListFormulas alone (it reads the DB, servicer.py:472-474, and would pass on a stale cache). Analysis formula caches are per-request (analysis servicer.py:912-914), so no analysis restart; the runbook says so. Runbook also requires plan + result files attached to the DBA change record before the redeploy (no ledger client: overbuild; files are the audit trail), names a storage location, and flags the PII.\n\nAC-9 wording: authority = the DB credential holder (infra) plus the DBA change record (process, not code). The code enforces only integrity: apply refuses without a digest-matched, fully-confirmed plan and never touches system or UUID rows. The digest is integrity, not authority; docs must not claim otherwise.\n\nTests (pytest, no real-Postgres harness exists; CI's only Postgres is migration-rerun, ci.yml:636-656): FakeFormulasTable evaluates EVERY predicate in the real SQL (formula_id, author=$old, system guard, UUID guard); one test parses the SQL text asserting the system and UUID guards are present. Tests: classify/plan-builder (AC-3/4/5/7, lower-case folding, inactive exclusion, upper-case UUID not legacy); test_apply_refused_* (missing digest, mismatched digest, leftover suggested, inactive target) plus test_apply_refuses_system_old_author and test_apply_refuses_uuid_old_author, all asserting zero UPDATEs and system rows keeping author and updated_at; hand-widened plan cannot extend the write set (intersection test); interleaving test that mutates the row between plan and apply (AC-8, owner-update leg modeled as a direct row change because UpdateFormula cannot run on a legacy row, servicer.py:502-506); AC-1/AC-6 through the servicer read path with a cold cache via ctx_with (tests/conftest.py:21, shape of tests/test_formula_read_authz.py) plus a stale-cache negative test documenting the restart requirement. Single-statement UPDATE atomicity in Postgres is taken as given. Trace: no originating request, so no x-trace-id; a run_id is stamped on logs and artifacts (minted-context case the operator decision allows). _can_read_formula (servicer.py:141-148) is not edited (FR-6); 275's reporting is not touched. No data change runs during speccing; prod row count is unknown.",
    "open_objections": [
      {
        "text": "AC-9 narrowing needs explicit operator sign-off recorded in context.md (or AC-9 is reworded at /sdd-spec to 'apply refuses without a digest-matched, fully-confirmed plan and never touches system/UUID rows; authority is the DB credential plus the DBA change record'). If the operator refuses the narrower meaning, the fallback is an admin-gated additive RPC, which reopens proto churn and the @AC-28 'no admin override for writes' conflict. Cannot be self-resolved by the design.",
        "blocking": true
      },
      {
        "text": "Adversary blocking #1 (hand-edited plan could rewrite a system row or move a user-owned formula) is answered only by the amendments in this synthesis: system/UUID predicate inside the apply UPDATE, pre-flight refusal for SYSTEM_AUTHOR/UUID old_author and non-UUID new_author, and re-deriving targets from the DB (plan x live detection intersection). r3 must carry all three; if it drops any, this stays open and blocking.",
        "blocking": true
      },
      {
        "text": "Adversary blocking #2 (digest is integrity not authority; step order must be edit -> hash -> record) is answered by the AC-9 rewording and the explicit ordering. The spec must make AC-9 text and the runbook say so; the 'DBA approved' check is process, not code.",
        "blocking": true
      },
      {
        "text": "Operator workstation must reach the managed DB (trusted-sources, same need as manage-users.py). Fallback (DO console with plan pasted via heredoc) loses file durability; the runbook must state which is used.",
        "blocking": false
      },
      {
        "text": "FakeFormulasTable stands in for a real-Postgres harness; atomicity of the single-statement UPDATE is assumed. Acceptable only if the fake applies the full WHERE and a SQL-text test pins the guards.",
        "blocking": false
      },
      {
        "text": "The email-local-part heuristic is unverified on prod (OQ-2); mitigated by suggested-only status, explicit override, and unmappable/ambiguous follow-ups, not by guessing.",
        "blocking": false
      }
    ],
    "floor_breaches": [],
    "business_rule_changes": [
      {
        "ac_id": "AC-1",
        "kind": "EXTEND",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "AC-6",
        "kind": "EXTEND",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "AC-9",
        "kind": "CHANGE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "feature FR-4 / AC-4 (user-id and system rows never modified)",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "platform @AC-6 (system rows never touched)",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "indicators @AC-28 (no admin override for writes)",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "indicators @AC-4 (RegisterFormula stamps x-user-id)",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "platform @AC-18/@AC-19 (pending-intent and template-saga rows)",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      }
    ],
    "rejected_alternatives": [
      "Migration 008 with -- requires-env: mapping (ingest 013 precedent): an unset var blocks the whole migrator (fails.md 2026-08-19), no report-only mode for FR-5, would put PII in deploy env vars, and the prod username set is unknown.",
      "Additive admin RPC RepairFormulaAuthors: makes AC-9 fully testable but needs proto churn, adds a write surface next to @AC-28, only evicts the cache on one instance, and is permanent code for a one-off repair. Kept as fallback only if the operator rejects the narrowed AC-9.",
      "Startup hook applying a committed plan at boot: needs the plan (PII) committed to git, re-runs detection every boot, reports only to logs.",
      "Running from a DO console session: no file upload and stdout lost, so plan/result artifacts are not durable.",
      "Cross-schema read of identity.users from indicators code: violates schema ownership; replaced by an operator-supplied users file.",
      "Pool via main.py extraction: unnecessary for a single-shot CLI; one asyncpg.connect plus the PgBouncer cache rule.",
      "Auto-applying unique heuristic matches without a confirmed plan: violates FR-3 / P-03.",
      "Trusting plan values with only a CAS on author=$old: lets a hand-edited plan rewrite system or user-owned rows; replaced by SQL guard plus DB re-derivation."
    ],
    "open_risks": [
      "Prod legacy-author set and count unknown; a wrong unique heuristic match misassigns formulas unless the human confirm step is honoured.",
      "Forgetting to restart every indicators instance after apply leaves AC-1 failing from the stale cache; verify must use GetFormula/ExecuteFormula, not ListFormulas.",
      "Plan and result files hold email local parts (PII) and are the only undo/audit record; loss removes rollback and ownership moves are not ledger-audited.",
      "Rows can change between plan and apply; skipped_concurrent rows need a re-run.",
      "An operator without DATABASE_URL discipline could target the wrong DB; mitigated by required URL, no fallback, and printed target in both modes.",
      "AC-9 narrowing without recorded sign-off leaves the AC unmet.",
      "Fake-table tests do not prove real Postgres behaviour of the WHERE clause.",
      "Scope creep into feature 275 reporting changes."
    ],
    "constitution_rules_touched": [
      "C-03 (no originating request; run_id only, minted-context case allowed)",
      "C-10(c) (system-sentinel rows must not be mutated by an unguarded path)",
      "C-11 (design gate)",
      "C-15 (AC-1..AC-9 testable as written; AC-9 reword)",
      "C-18 (YAGNI: no roles export, no ledger client, single plan format; schema ownership)",
      "P-03 (never assign to an unidentified user)",
      "F-04 (no false reuse claims; main.py pool is inline)",
      "F-06 (connection budget: pooled :25061 URL)",
      "PLAT-N1 (best-effort/verify norms)",
      "platform @AC-6 and @AC-18/@AC-19",
      "Approval flow: DB data change needs DBA and service owner sign-off"
    ],
    "rationale": "r2 survives the adversary with no Floor breach. The CLI-over-migration/RPC choice holds because of FR-5 report-only mode, the unknown prod set and the migrator trap (fails.md 2026-08-19). The adversary's two blocking objections are real and are adopted wholesale: the plan is hand-edited, so the digest proves only that the file did not change after hashing, not that its contents are safe. The write path must therefore carry the system/UUID guard in the SQL itself and re-derive targets from live detection, which removes the hole structurally and honours C-10(c) and platform @AC-6. The remaining blocker is process, not design: AC-9 can only be proven in pytest as tool-side integrity (digest, confirmation, no system/UUID rows), while authority is the DB credential plus the DBA change record. That narrowing needs the operator's explicit sign-off or a reword at /sdd-spec; it stays open and blocking. The non-blocking items are folded in: required DATABASE_URL with no fallback, pooled URL, restart-every-instance with a GetFormula verify, no roles in the export, case-folding spec, edit-then-hash-then-record ordering, a result file carrying old values as the audit trail, and a full-predicate fake table plus a SQL-text guard test."
  },
  "floor_breaches": []
}
```

---

## Session 2026-10-22 — sdd-design

- Phase 0 Recon: recon.md written earlier (service: xstockstrat-indicators; key reuse patterns: `resolve_intent` compare-and-set UPDATE, `manage-users.py` operator-CLI shape).
- Phase 1 Grilling: 2 rounds (full), approved at the operator gate. Chosen approach: operator-run maintenance CLI in indicators (report then digest-confirmed apply; no migration/RPC/proto/startup hook/config). Rejected: migration 008 with requires-env, admin RPC, startup hook, DO-console run, cross-schema identity read, trusting plan values with only an author CAS.
- Constitution rules touched: C-03, C-10(c), C-11, C-15, C-18, P-03, F-04, F-06, PLAT-N1. Floor breaches: none.
- OPERATOR SIGN-OFF 2026-10-22 (round-2 design gate): APPROVED the maintenance-CLI design and SIGNED OFF the narrowed AC-9 (authority = DB credential holder plus the DBA change record, process not code; code enforces only integrity: apply refuses without a digest-matched, fully-confirmed plan and never touches system or UUID rows). The admin-gated RPC alternative is rejected. Spec must reword AC-9 to this meaning and state edit -> hash -> record -> apply in the AC-9 text and the runbook. Binding amendments: system/UUID predicate inside the apply UPDATE; pre-flight refusal for SYSTEM_AUTHOR/UUID old_author and non-UUID new_author; targets re-derived from the DB (plan x live detection intersection).
- Status: spec-ready -> design-approved.

### Open Threads

- Prod legacy-author set and count unknown; heuristic match is suggested-only (runbook + first prod report run).
- Restart EVERY indicators instance after apply; verify via GetFormula/ExecuteFormula, not ListFormulas (runbook + stale-cache test).
- Plan/result files hold PII and are the only undo/audit record (runbook storage/retention step).
- skipped_concurrent rows need a re-run (runbook + AC-8 test).
- Wrong-DB targeting: required DATABASE_URL, no fallback, printed target (CLI step).
- Operator workstation must reach the managed DB; runbook states which route is used.
- Fake-table tests do not prove real Postgres WHERE behavior (full-predicate fake + SQL-text guard test).
- Email local-part heuristic unverified on prod (OQ-2).
- Do not touch feature 275 reporting surfaces or `_can_read_formula` (FR-6).

---

## Session 2026-10-22 — sdd-spec

- Generated implementation-spec.md with 9 steps. Status → implementation-ready.
- AC-9 reworded in acceptance.feature to the operator-signed-off integrity meaning (edit -> hash -> record -> apply; authority = DB credential plus DBA change record; digest is integrity, not authority).
- Key codebase findings:
  - No migration: indicators tip stays `007`; no proto, config or env var. New code is `app/maintenance/legacy_authors.py` (stdlib argparse; indicators has no typer dependency) plus tests; `main.py` and `servicer.py` untouched.
  - `scripts/manage-users.py` `list-users` (`:270-289`) is covered by 4-tuple tests (`scripts/tests/test_manage_users.py:371-411`), so `--json` uses its own `SELECT user_id, email, is_active` query rather than changing the table query.
  - `FakeFormulasTable` has three consumers (Steps 4, 6, 7), so it lives in `tests/conftest.py` (C-13). Apply refuses a UUID `old_author`, so undo is a DBA-reviewed manual UPDATE from the result file, not an apply run.
  - C-14 deferred checks resolved: no UI change; `strat-lab` backtest skill only mentions formula privacy (`SKILL.md:78`), unchanged.
  - Teardown: Step 9 changes context files; run the context-forge refresh (or the manual reconciliation) before the execute PR.

### Open Threads

- Execute: Steps 1-9 pending; run `/sdd-review fix-legacy-formula-authors impl-spec` first.
- Prod legacy-author set unknown; first prod run is report-only. Restart EVERY indicators instance after apply; verify via GetFormula/ExecuteFormula, not ListFormulas.

---

## Session 2026-10-22 — sdd-review impl-spec

Advisory (MODE B); lifecycle unchanged (`implementation-ready`).

### Addressed

- Reviewer FAIL "implementation-spec.md unreadable / status draft": a stale main-dev checkout, not a spec defect. On `origin/feature/fix-legacy-formula-authors` the spec exists (9 steps) and `status.md` reads `implementation-ready`. No edit.
- AC-9 vs `acceptance.feature` (C-15): the feature-branch AC-9 already carries the operator-signed-off integrity wording; spec Steps 5, 6, 8 agree. No edit.
- C-18 DRY on `list-users --json`: the separate `SELECT user_id, email, is_active` query is deliberate (the existing 4-tuple query is pinned by `TestListUsersCmd`); confirmed in Step 1. No edit.
- Overlap WARN (conftest.py with 244; indicators CLAUDE.md with 268/243/244): recorded in implementation-spec.md Step Dependencies as an append-only, rebase-only overlap.

### Still open

- Step 7 does not simulate the DB-backed `ListFormulas` (`list_visible`) path; FR-1 "ListFormulas includes it" is covered only by the in-memory branch plus the runbook verify step. Decide at the /sdd-execute checkpoint whether to add a fake-pool `list_visible` test.
- Reviewer could not run `git show` against the spec; the criteria checks (paths, symbols, thresholds) were not independently re-run by a second reviewer. Spot-checked here: `list-users` at `scripts/manage-users.py:270-289` and `_can_read_formula` at `servicer.py:141`.

### Open Threads

- Step 7 `ListFormulas` DB-path test gap (see above).
- Merge-order with 244/268/243 for `tests/conftest.py` and indicators `CLAUDE.md`.

---

## Session 2026-10-28 — re-spec (sdd-execute sequential, sdd-batch-execute)

- Branch setup: merged `origin/main-dev` into `feature/fix-legacy-formula-authors` (`-X ours`).
- Re-spec of Steps 1-9 against the current codebase (implementation-spec.md Deviation Log, 2026-10-28):
  - Line drift fixed: Step 1 (`manage-users.py` `WHERE is_active = TRUE` :287, `ORDER BY created_at` :288), Step 2 (`_mock_conn` :61, `FAKE_UUID`/`FAKE_NOW` :51-52), Step 4 (`OWNER_HEADERS`/`OTHER_HEADERS` :17-18), Step 9 (Migrations list :84-90).
  - Step 2: no CI job runs `scripts/tests/`; verified locally only.
  - Step 4: corrected the stale "no real-Postgres harness" claim (analysis `local_pg`, `ci.yml:400-404`). Decision: indicators keeps the `FakeFormulasTable` approach; reusing `local_pg` would add a CI install step and a cross-service fixture copy outside this bug fix's scope.
  - Step 7: `ctx_with` makes `abort` raise, so assertions expect `grpc.RpcError` rather than "abort not awaited".
  - Step 8: the runbook must state explicitly that the CLI's pooled `:25061` port deliberately deviates from `operator-db-access.md`'s direct-port guidance (F-06); index row goes in alphabetical position.
  - Steps 3, 5, 6: evidence held; no change.

---

## Session 2026-10-28 — sdd-execute sequential (sdd-batch-execute)

- Status: `implementation-ready` → `in-progress`.
- Up-front confirmation (mode entry): operator standing authorization, operator chat 2026-10-28 (session_01NpS3HShZK6pSnogA7CFo2f): "Start executing features 241-276" via batch-execute, and "start batch 2 in parallel too". Answers recorded: checkpoints unattended (`report`); C-16 promotion auto-confirmed unless it changes an existing `@AC` rule; merge-train authorized; 255 and 275 deferred; operator-only DB/prod steps: open the PR, hold the merge.
- This feature's apply against staging/prod data remains an operator-only DB step (runbook, Step 8); execution here writes code, tests and docs only and never touches a database.
- Plan: Steps 1-9 in order, one commit per step on `feature/fix-legacy-formula-authors`, single integration PR at the end.

### Step 1 — service: `manage-users.py list-users --json` users export [done]
- Added `--json` to `list-users`: a separate `SELECT user_id, email, is_active FROM identity.users` (plus `WHERE is_active = TRUE` with `--active-only`) `ORDER BY created_at`, printed via `typer.echo` as a JSON array of `{user_id, email_local, is_active}`; empty result prints `[]`, exit 0. The table query and its 4-tuple path are unchanged; DB errors still go to stderr.
- TDD (red → green, scratch test mirroring Step 2's cases, not committed; Step 2 owns the committed tests): red `list-users --json` → exit 2 "No such option: --json" (3 failed); green 3 passed + existing `scripts/tests/test_manage_users.py` 41 passed (44 total). Verification: `uv run scripts/manage-users.py list-users --help` lists `--json`.
- Files modified: `scripts/manage-users.py`
- Deviations: none. Lint note: `ruff check`/`ruff format --check` on `scripts/manage-users.py` still report pre-existing findings on untouched lines (unused `import sys`, five formatter diffs); the step's own lines are clean. Step 2's Verification runs `ruff format --check` on this file and will fail on those pre-existing lines.

---

## Session 2026-10-29 — sdd-execute sequential (sdd-batch-execute)

### Step 2 — test: `list-users --json` output contract [done]
- Added `TestListUsersJson` (3 tests) to `scripts/tests/test_manage_users.py` plus `import json`: only `{user_id, email_local, is_active}` emitted (no `@`, no `roles`); `--json --active-only` query selects `user_id` and filters `WHERE is_active = TRUE`; empty result prints `[]`, exit 0. The spec's 4th case (table path unchanged) is the unedited `test_lists_users`.
- TDD: AC-5 (partial) red: run against the pre-Step-1 `manage-users.py` (`91c25c3c~1`, scratch copy) → 3 failed, `assert 2 == 0` (typer "No such option: --json"); green: `uv run --with pytest ... pytest scripts/tests/test_manage_users.py -v` → 44 passed.
- Files modified: `scripts/tests/test_manage_users.py`
- Deviation (operator decision, Option C): the specced ruff gate over `scripts/` fails on pre-existing findings; narrowed to "clean on the added lines" (no `ruff check` finding or `ruff format --diff` hunk on them). Logged in implementation-spec.md Deviation Log; cleanup + CI ruff job for `scripts/` filed as `docs/reports/2026-10-29-scripts-ruff-lint-gap-defect.md`.

### Step 3 — service: legacy-author CLI core (detection, classification, plan, report mode) [done]
- Created `app/maintenance/__init__.py` (empty) and `app/maintenance/legacy_authors.py`:
  - Constants: `UUID_RE`, `DETECT_SQL` (no `deleted_at` filter), `CLEAN_COUNT_SQL`, and `REWRITE_SQL`. `REWRITE_SQL` carries the system/UUID guard in the SQL and touches neither `is_public` nor `updated_at`.
  - `connect`: `DATABASE_URL` is required, with no fallback. It sets `statement_cache_size=0` under `DB_PGBOUNCER` and prints the host and db, never the password.
  - `load_users`, `detect`, `plan_digest`, `run_report` (SELECTs only) and an argparse `main`.
  - `classify`: matches active users only, comparing `email_local` case-insensitively. One match is `suggested`, none is `unmappable`, two or more is `ambiguous`. `old_author` is kept byte-exact.
  - No dependency added, `uv.lock` untouched, `main.py` not edited.
- TDD (red → green): a scratch test covered Step 4's report, detect, SQL-guard and connect cases. It is not committed, because Step 4 owns the committed tests.
  - Red: `ModuleNotFoundError: No module named 'app.maintenance'` (collection error).
  - Green: 6 passed.
- Verification:
  - `uv run python -m app.maintenance.legacy_authors --help` lists `--users --out --apply --plan --confirm-digest` (exit 0).
  - A missing `DATABASE_URL` exits 1.
  - `ruff check .` and `ruff format --check .` are clean.
  - `uv run pytest --cov=app --cov-fail-under=50`: 294 passed at 69.49% total. The new module sits at 0% until Step 4.
- Files modified: `services/xstockstrat-indicators/app/maintenance/__init__.py`, `services/xstockstrat-indicators/app/maintenance/legacy_authors.py`
- Deviations: keyword-only signature additions (`run_id`, `target`, `clean`), and `--apply` is refused until Step 5. Both are logged in the implementation-spec.md Deviation Log.

### Step 4 — test: classification, plan builder, report mode, SQL guard text [done]
- `tests/conftest.py`: added `USERS` (users-file entries in the `list-users --json` shape: davcs86, alice, bob, carol, two `sam`, inactive `olduser`), `make_formula_row(formula_id, author, *, deleted=False, **fields)`, and `FakeFormulasTable`. The fake dispatches on `DETECT_SQL`/`CLEAN_COUNT_SQL`/`REWRITE_SQL` (imported lazily so conftest loads without the module), evaluates every predicate (system, case-insensitive UUID regex, byte-exact `old_author`, `formula_id`), raises on any other SQL, logs to `execute_log`, and exposes `update_count()` and `mutate(formula_id, **fields)` (update, or insert when absent) for Steps 6-7.
- `tests/test_legacy_authors.py`: the 8 specced tests (pgbouncer case parametrized over `true`/`1`/unset → 11 cases). Unmappable/ambiguous tests also assert the report's stdout line naming formula id and author.
- TDD: AC-2/AC-3/AC-5/AC-7 red: with `app/maintenance/` moved aside (pre-Step-3 tree) → collection error `ModuleNotFoundError: No module named 'app.maintenance'`; green: `uv run pytest tests/test_legacy_authors.py -v` → 11 passed.
- Verification: `uv run pytest --cov=app --cov-fail-under=50` → 305 passed, 83.62% total (`legacy_authors.py` 75%; apply/main land in Steps 5-6); `ruff check .` and `ruff format --check .` clean.
- Files modified: `services/xstockstrat-indicators/tests/conftest.py`, `services/xstockstrat-indicators/tests/test_legacy_authors.py`
- Deviations: none.

### Step 5 — service: apply mode (pre-flight refusals, DB re-derivation, guarded rewrite, result file) [done]
- `legacy_authors.py` additions:
  - `APPLY_STATUSES` and `ApplyRefused` (`exit_code = 2`).
  - `validate_for_apply`, which returns a list of refusal reasons. It refuses on a missing or mismatched digest, any status outside confirmed/unmappable/ambiguous (a leftover `suggested` aborts the run), a confirmed `old_author` that is `system`, a UUID or missing, and a confirmed `new_author` that is not a UUID, is not in the users file, or is inactive.
  - `run_apply`. It validates before any write, then re-derives the write set as confirmed ∩ live `detect`. Any other confirmed entry counts as `skipped_not_detected`. Each target gets one autocommit `REWRITE_SQL`, with no transaction and no lock; an empty `RETURNING` counts as `skipped_concurrent`.
  - The result file holds `run_id`, target, counts and the rewritten rows, and it is the undo record. Its default path is `<plan stem>.result.json`.
  - `main` is wired for `--apply --plan --users --confirm-digest`. A refusal logs each reason and exits 2.
  - Nothing touches `UpdateFormula`/`DeleteFormula`, `is_public` or `updated_at`.
- TDD (red → green): a scratch test mirrored Step 6's cases. It is not committed, because Step 6 owns the committed tests. The cases were rewrite plus result file plus idempotent second run, 8 refusals, concurrent skip, hand-widened entry, and `main` refusal exit 2.
  - Red: 12 failed (`AttributeError: module 'app.maintenance.legacy_authors' has no attribute 'run_apply'` / `'ApplyRefused'`, and `main` exited via the argparse error "--apply is not available in this build").
  - Green: 12 passed.
- Verification:
  - `uv run python -m app.maintenance.legacy_authors --help` shows `--apply` (exit 0).
  - `uv run pytest --cov=app --cov-fail-under=50`: 305 passed at 73.69% total. `legacy_authors.py` is at 45% until Step 6.
  - `ruff check .` and `ruff format --check .` are clean, and `uv lock --check` is OK (no dependency added).
- Files modified: `services/xstockstrat-indicators/app/maintenance/legacy_authors.py`
- Deviations: keyword-only `run_id`/`target` on `run_apply`, and the result-path naming. Both are logged in the implementation-spec.md Deviation Log. Open item for Step 8 (runbook): apply does not compare the plan's recorded `target` with the connected host/db. The write set is still bounded by live detection and the users file, so the runbook should tell the operator to check the printed target line.

### Step 6 — test: apply refusals, guarded rewrite, idempotence, concurrency [done]
- `tests/test_legacy_authors.py`: added the 14 specced apply tests. Shared helpers:
  - `_confirm` hand-edits the plan from suggested to confirmed (plus overrides and extra entries) and returns the digest.
  - `_entry` builds a confirmed entry.
  - `_assert_refused` checks `ApplyRefused`, `exit_code == 2`, zero UPDATEs and rows byte-equal.
  - The tests reuse `USERS`, `FakeFormulasTable` and `make_formula_row` from `conftest.py` (C-13, no inline copies).
- Idempotence (AC-4): a second report finds no entries, and its apply rewrites 0. Replaying the first, already-applied plan also rewrites 0 (`skipped_not_detected` 1), with no new UPDATE. Author and `updated_at` are unchanged for the system, user-id and rewritten rows.
- Hand-widened plan (AC-9): the user-id row is excluded by the confirmed ∩ live intersection, and `REWRITE_SQL` alone also returns no row for it.
- Concurrency (AC-8): a test-local `_InterleavedTable` mutates the rows right after apply's detection. The row comes back `skipped_concurrent` and both the owner's write and the new row survive. The interleaving placement is logged in the Deviation Log.
- TDD (red → green). AC-1/AC-4/AC-8/AC-9:
  - Red: the module was reverted to its Step 4 version (`67360c3f`, no apply). 14 failed and 11 passed, each failure `AttributeError: module 'app.maintenance.legacy_authors' has no attribute 'run_apply'`/`'ApplyRefused'`.
  - Green: `uv run pytest tests/test_legacy_authors.py -v`, 25 passed.
- Verification:
  - `uv run pytest --cov=app --cov-fail-under=50`: 319 passed at 83.17% total (`legacy_authors.py` 77%; what is left uncovered is the `main`/`_apply`/`_report` CLI wiring).
  - `ruff check .` and `ruff format --check .` are clean.
- Files modified: `services/xstockstrat-indicators/tests/test_legacy_authors.py`
- Deviations: the AC-8 interleaving point (Deviation Log).

### Step 7 — test: servicer read path after repair (cold cache) and stale-cache negative [done]
- `tests/test_legacy_authors_read_path.py` (new) drives the real `IndicatorsServicer` read path (`_load_formula` → `FormulasRepository.get_by_id`) over a test-local `_FakePool(FakeFormulasTable)` that serves `get_by_id`'s `fetchrow`. It reuses `USERS`, `make_formula_row`, `FakeFormulasTable` and `ctx_with` from `conftest.py` (C-13). The repair runs the real `run_report`, then the operator confirm, then `run_apply`.
  - `test_owner_reads_after_repair_cold_cache` (AC-1): before apply, the owner `GetFormula` gets NOT_FOUND. After apply, a fresh servicer returns `author == 80880990-…`, and the owner `ExecuteFormula` succeeds (sandbox stubbed).
  - `test_non_owner_still_not_found_after_repair` (AC-6): bob gets NOT_FOUND on `ExecuteFormula` and `GetFormula`. An admin (scope 4) `ExecuteFormula` gets PERMISSION_DENIED.
  - `test_stale_cache_requires_restart`: a servicer whose cache was filled by an admin `GetFormula` before apply still gives the owner NOT_FOUND after apply, and a new servicer serves the repaired author. This is the restart requirement Step 8's runbook must state.
- TDD (red → green). AC-1/AC-6:
  - Red: `legacy_authors.py` reverted to its Step 4 version (`67360c3f`). 3 failed, each `AttributeError: module 'app.maintenance.legacy_authors' has no attribute 'run_apply'`. The owner pre-apply NOT_FOUND assertion passed before the failure, which reproduces the defect.
  - Green: `uv run pytest tests/test_legacy_authors_read_path.py tests/test_formula_read_authz.py -v`, 15 passed.
- Verification: `uv run pytest --cov=app --cov-fail-under=50` gave 322 passed at 83.17%. `ruff check .` and `ruff format --check .` are clean. The suite ran on both the service's `.python-version` (CPython 3.12.3) and 3.13.17 (`uv run --python 3.13`), with the same results.
- Files modified: `services/xstockstrat-indicators/tests/test_legacy_authors_read_path.py`
- Deviations: test-local fake pool, sandbox stub, admin-filled warm cache and the RED reason (Deviation Log).

### Step 8 — docs: runbook `docs/runbooks/legacy-formula-authors.md` [done]
- `docs/runbooks/legacy-formula-authors.md` (new) covers these sections, in order:
  - Scope. The prod row count is unknown, and the six staging ids are a floor.
  - Authority. It comes from the DB credential plus the DBA change record; the digest is integrity, not authority.
  - Prerequisites and connection. The pooled `:25061` URL with `DB_PGBOUNCER=true`, with the stated deviation from `operator-db-access.md`.
  - Step A, the users export.
  - Step B, the report and plan editing (`suggested` → `confirmed`, and `override` entries).
  - Step C, in the order edit → hash (`shasum -a 256`) → record → apply, with the list of refusals.
  - Attaching the plan and result files to the change record (PII, storage location, retention, deleting local copies).
  - Restart every indicators instance, then re-run the report. Verify as the owner via `get_formula`/`test_formula`/`ExecuteFormula`, not `list_formulas` alone. Re-run for any `skipped_concurrent` rows.
  - Undo by a manual compare-and-set.
  - Staging first, then prod, recording the observed prod count.
- `docs/runbooks/CLAUDE.md`: index row added in alphabetical order, before `mcp-tools.md`.
- Flags, log lines, refusal reasons and the `plan.result.json` default were checked against the built `legacy_authors.py` and its `--help` output, not only the spec text. `list-users --json` exists (`scripts/manage-users.py:281`).
- TDD: N/A (docs).
- Verification:
  - Before the edit, the runbook grep failed (no such file) and the index grep found nothing.
  - After it, the ordered edit/hash/record/apply lines are present and the index row is at `docs/runbooks/CLAUDE.md:17`.
  - `grep -nE "grep -P|pip install"` returns nothing (macOS rule).
- Files modified: `docs/runbooks/legacy-formula-authors.md`, `docs/runbooks/CLAUDE.md`
- Deviations: the pooled-URL derivation, the named storage location and retention, and the restart command example (Deviation Log).
- Open item: the repo documents no change-record system, so the operator and DBA pick the concrete system when running the runbook.

### Step 9 — docs: indicators CLAUDE.md Maintenance section and context-constitution invariant [done]
- `services/xstockstrat-indicators/CLAUDE.md` gets a new `## Maintenance` section after `## Running Locally`. It is one paragraph plus the report and apply commands. It says the tool is operator-run and outside the service process, uses one `asyncpg` connection rather than the `main.py` pool, and needs `DATABASE_URL` with no fallback. It links `docs/runbooks/legacy-formula-authors.md`.
- `services/xstockstrat-indicators/docs/context-constitution.md` gets the `INDICATORS-12` row, using the spec's rule text. Its Evidence and Example cells anchor `REWRITE_SQL` at `legacy_authors.py:32-36`. A hand-refresh note is added to the header.
- TDD: N/A (docs). Verification grep before the edit: exit 1, no matches. After the edit: `INDICATORS-12` at `:29` and `## Maintenance` at `:224`, exit 0.
- Teardown (root CLAUDE.md): `/context-forge:context-constitution` is not available in this session. Manual reconciliation re-checked both touched files against the code: `servicer.py:141`, `REWRITE_SQL`, the CLI `--help` flags, and the runbook's pooled-port and restart text all match, and the Database migrations list is unchanged. The integration PR body must record both that the plugin was unavailable and this reconciliation.
- Files modified: `services/xstockstrat-indicators/CLAUDE.md`, `services/xstockstrat-indicators/docs/context-constitution.md`

## Session 2026-10-29 — sdd-batch-execute promotion plan (awaiting operator confirm)

```sdd-batch-promotion-plan
## Promotion plan — fix-legacy-formula-authors (feature 276)

### Verdicts
| @AC | target suite (path) | CREATE/APPEND | verdict | note |
|---|---|---|---|---|
| AC-1 | services/xstockstrat-indicators/acceptance/fix-legacy-formula-authors.feature | CREATE | NEW | legacy username author rewritten to user id; owner can Get/List/Execute |
| AC-2 | same | CREATE | NEW | legacy authors beyond known ids, incl. soft-deleted rows |
| AC-3 | same | CREATE | NEW | unmappable author left unchanged and reported |
| AC-4 | same | CREATE | NEW | idempotent re-run; system and user-id rows untouched |
| AC-5 | same | CREATE | NEW | report-only mode makes no mutation |
| AC-6 | (none, skipped) | - | OVERLAP | Same outcome as feature 224 @AC-1 in services/xstockstrat-indicators/acceptance/private-by-default-templates.feature (non-owner GetFormula/ExecuteFormula returns NOT_FOUND). Write skipped; see Notes |
| AC-7 | same as AC-1 | CREATE | NEW | ambiguous author (two users) left unchanged and reported |
| AC-8 | same | CREATE | NEW | concurrent-write safety between detection and rewrite |
| AC-9 | same | CREATE | NEW | apply refuses without digest-matched, fully-confirmed plan; system/UUID rows never touched |

### Ready-to-write blocks
--- /home/user/xstockstrat/services/xstockstrat-indicators/acceptance/fix-legacy-formula-authors.feature (CREATE) ---
# Promoted from docs/roadmap/features/276-fix-legacy-formula-authors/acceptance.feature
# (Constitution C-16). Source-feature provenance is carried on every scenario's `@feature-276` tag.
# Durable business rules xstockstrat-indicators already guarantees: a rule enters only by promotion
# from a reviewed feature acceptance.feature, never by hand-authoring.
# Source: @AC-1, @AC-2, @AC-3, @AC-4, @AC-5, @AC-7, @AC-8, @AC-9 (@AC-6 omitted: OVERLAP with feature 224 @AC-1).
Feature: fix-legacy-formula-authors (indicators)
  Regression guard for the defect report docs/reports/2026-10-22-indicators-legacy-username-formula-authors-defect.md:
  formulas stored under a legacy username author are unreadable by their owner.

  @AC-1 @FR-1 @regression @feature-276
  Scenario: A formula created before ownership moved to user id is owned by its user id
    Given the formula "31bb8ea6-0f3e-4cf7-8844-ec8294cebf85" is stored with author "davcs86"
    And the user "davcs86" has user id "80880990-2b79-4d85-8761-d8d9102c2efb"
    When the legacy-author fix runs
    Then GetFormula for "31bb8ea6-0f3e-4cf7-8844-ec8294cebf85" returns author "80880990-2b79-4d85-8761-d8d9102c2efb"
    And ListFormulas called as user "80880990-2b79-4d85-8761-d8d9102c2efb" includes it
    And GetFormula and ExecuteFormula called as that user succeed

  @AC-2 @FR-2 @regression @feature-276
  Scenario: Legacy authors beyond the known staging ids are found, including soft-deleted rows
    Given a formula "f-live" (id "aaaaaaaa-0000-4000-8000-000000000001") stored with author "alice" and a soft-deleted formula "f-gone" (id "aaaaaaaa-0000-4000-8000-000000000002") stored with author "alice"
    And the user "alice" has user id "11111111-1111-4111-8111-111111111111"
    When the legacy-author fix runs
    Then both "f-live" and "f-gone" have author "11111111-1111-4111-8111-111111111111"

  @AC-3 @FR-3 @feature-276
  Scenario: An author that maps to no user is left unchanged and reported
    Given the formula "f-orphan" is stored with author "ghost" and no user "ghost" exists
    When the legacy-author fix runs
    Then the formula "f-orphan" still has author "ghost"
    And the run report lists "f-orphan" with author "ghost" as unmappable
    And ListFormulas called as any user does not include "f-orphan"

  @AC-4 @FR-4 @feature-276
  Scenario: A second run changes nothing and non-legacy formulas are untouched
    Given the legacy-author fix has already run once
    And the formula "f-system" is stored with the system author and "f-owned" is stored with a user id author
    When the legacy-author fix runs again
    Then the run report shows 0 rewritten
    And "f-system" and "f-owned" keep their authors and their updated timestamps

  @AC-5 @FR-5 @feature-276
  Scenario: The operator can count legacy authors without mutating data
    Given 2 formulas with mappable legacy authors, 1 with an unmappable author and 3 with user id or system authors exist
    When the legacy-author fix runs in report-only mode
    Then the report shows 2 rewritable, 1 unmappable and 3 clean
    And no formula author has changed

  @AC-7 @FR-3 @feature-276
  Scenario: An author that maps to more than one user is left unchanged and reported
    Given the formula "f-ambiguous" is stored with author "sam" and two users match the username "sam"
    When the legacy-author fix runs
    Then the formula "f-ambiguous" still has author "sam"
    And the run report lists "f-ambiguous" with author "sam" as ambiguous

  @AC-8 @FR-7 @feature-276
  Scenario: A row written between detection and rewrite is not lost or overwritten
    Given the formula "bbbbbbbb-0000-4000-8000-000000000001" is stored with author "alice" and the user "alice" has user id "11111111-1111-4111-8111-111111111111"
    And the legacy-author fix has detected "bbbbbbbb-0000-4000-8000-000000000001" but not yet rewritten it
    When user "33333333-3333-4333-8333-333333333333" registers a new formula "bbbbbbbb-0000-4000-8000-000000000002" before the rewrite applies
    And the owner "alice" updates "bbbbbbbb-0000-4000-8000-000000000001" so its author is already "11111111-1111-4111-8111-111111111111"
    Then "bbbbbbbb-0000-4000-8000-000000000002" keeps author "33333333-3333-4333-8333-333333333333" and its content is unchanged
    And "bbbbbbbb-0000-4000-8000-000000000001" keeps the owner's update and author "11111111-1111-4111-8111-111111111111"

  @AC-9 @FR-7 @feature-276
  Scenario: Apply refuses without a digest-matched, fully-confirmed plan and never touches system or UUID rows
    # Authority to run the fix is the DB credential holder plus the DBA change record (process, not code);
    # operator sign-off 2026-10-22. The digest is integrity, not authority. Order: edit plan -> hash -> record -> apply.
    Given the formula "bbbbbbbb-0000-4000-8000-000000000003" is stored with the reserved system author and "bbbbbbbb-0000-4000-8000-000000000004" is stored with author "alice"
    When apply is run with a missing or mismatched digest, or a plan that still holds a "suggested" entry, or a confirmed entry whose old author is the system author or a user id, or a new author that is not an active user id
    Then the run is refused with zero UPDATEs and no formula author has changed
    And when apply is run with a digest-matched, fully-confirmed plan, "bbbbbbbb-0000-4000-8000-000000000003" keeps the system author and its updated timestamp

### Notes / ambiguities / conflicts
- Service attribution: every scenario's observable subject is indicators.formulas authorship and GetFormula/ListFormulas/ExecuteFormula, all xstockstrat-indicators (feature.md Reviewers: indicators owner, DBA, Security; no cross-service guarantee), so no platform.feature entry. The suite directory services/xstockstrat-indicators/acceptance/ already exists; only the new file is created.
- AC-6 OVERLAP: /home/user/xstockstrat/services/xstockstrat-indicators/acceptance/private-by-default-templates.feature @AC-1 (@feature-224) already asserts that another user's GetFormula and ExecuteFormula return NOT_FOUND. Write skipped per policy. Human option: consolidate, or promote AC-6 anyway as a repair-specific regression guard. The existing scenario was not touched.
- No CONFLICT: no existing promoted rule contradicts any scenario. Repair only changes the stored author to a user id, which matches the 224 header-only authorship rule.
- Grep of platform.feature and the indicators suites found no prior @feature-276 or legacy-author scenario, so there are no DUPs.
- AC-9 keeps its explanatory comment verbatim because it records the operator sign-off.

### Coverage check
- Source scenarios: 9. Planned (NEW+DUP+OVERLAP): 9 (8 NEW, 0 DUP, 1 OVERLAP). Written scenarios: 8. Skipped deliberately: @AC-6 (OVERLAP with 224 @AC-1). Every @AC-* is accounted for.
```
