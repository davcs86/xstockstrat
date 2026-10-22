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
