# Design: fix-legacy-formula-authors

**Created**: 2026-10-22
**Rounds**: 2 (full; termination: approved)
**Approved by**: operator @ 2026-10-22 (round-2 design gate; Floor clear)
**Grounded in**: recon.md

---

## Chosen Approach

An operator-run maintenance CLI inside `xstockstrat-indicators`: no migration, no RPC, no proto change, no startup hook, no config key. It is internal-only: no UI segment or Agent tool changes (the read guard `_can_read_formula`, `servicer.py:141`, is not edited, FR-6; recon.md:19). The owner regains access because the stored `author` becomes their user id, which the existing guard already accepts (recon.md:19-21).

**Files.** New: `services/xstockstrat-indicators/app/maintenance/__init__.py`, `app/maintenance/legacy_authors.py` (run `uv run python -m app.maintenance.legacy_authors` from the operator workstation), `tests/test_legacy_authors.py`, `docs/runbooks/legacy-formula-authors.md`. Edited: `scripts/manage-users.py` (additive `list-users --json`), `services/xstockstrat-indicators/CLAUDE.md` (Maintenance section), indicators `docs/context-constitution.md` (invariant: `author` is a user id or `SYSTEM_AUTHOR`).

**Why a CLI.** FR-5 needs a zero-write report mode, which a migration cannot give; a `requires-env` migration (recon.md:37) fails the whole migrator job when its variable is unset (recon.md:76, fails.md 2026-08-19); an admin RPC adds a write surface beside `@AC-28` and proto churn (recon.md:56, :68). The operator-CLI shape follows `scripts/manage-users.py` (recon.md:39).

**Connection.** One `asyncpg.connect` (no pool, `main.py` untouched), `statement_cache_size=0` when `DB_PGBOUNCER` is set (rule at `app/main.py:55-57`; recon.md:35, :43). `DATABASE_URL` is REQUIRED with no `.env`/localhost fallback (deliberately not copying `manage-users.py:62-78`). Both modes print target host and db; the result file records them. The runbook pins the pooled `:25061` URL plus `DB_PGBOUNCER=true` so the CLI stays off the direct `:25060` budget (F-06). Every write is one autocommit statement, safe under transaction pooling (recon.md:43).

**Step 1, users export.** `manage-users.py list-users --json` emits only `user_id`, email local part (not the full email) and `is_active`; no roles (C-18, PII minimisation). The query at `scripts/manage-users.py:283` omits `user_id` today and gains it. Identity has no username field (`identity.proto:174-180`, recon.md:29), so the map can only be heuristic or operator-supplied (OQ-1); indicators never reads `identity.users`; identity data enters only as an operator file.

**Step 2, REPORT (default, zero writes; FR-2, FR-5, AC-5).** `--users users.json --out plan.json`. Detection: `SELECT formula_id, author, deleted_at, updated_at FROM indicators.formulas WHERE author <> $SYSTEM_AUTHOR AND author !~* '<uuid-re>'` (`SYSTEM_AUTHOR` at `app/formulas/__init__.py:5`), with no `deleted_at` filter because soft-deleted rows must be covered (recon.md:23, :77) and the list queries cannot be reused. A separate `COUNT(*)` with the complementary predicate gives the clean bucket (soft-deleted included). Classification is per distinct legacy author, ACTIVE users only, matching `lower(author) == lower(email_local_part)` while `old_author` is stored byte-exact for the CAS: 1 candidate = `suggested` (never applied as-is, FR-3/P-03), 0 = `unmappable` (AC-3), 2+ = `ambiguous` (AC-7). An upper-case UUID is not legacy. The plan holds per row `formula_id`, `old_author`, `new_author|null`, `status`, `source (heuristic|override)`, plus counts and a `run_id`. The operator edits the plan: `suggested` to `confirmed`, and may set an explicit override user id on an unmappable/ambiguous entry and confirm it (OQ-3 disposition). The production row count and username set are unknown; the six staging ids are a floor only (recon.md:11, :75).

**Step 3, APPLY.** `--apply --plan plan.json --users users.json --confirm-digest <sha256>`. Order is edit, then hash, then record in the DBA change record, then apply. Pre-flight refusals, each with zero UPDATEs: digest missing or mismatched; any entry not in {confirmed, unmappable, ambiguous} (a leftover `suggested` aborts); any confirmed entry whose `old_author` equals `SYSTEM_AUTHOR` or matches the UUID regex; any `new_author` that is not a UUID, is absent from the users file, or is inactive. Targets are re-derived from the DB: apply re-runs the detection SELECT and writes only the intersection of {(formula_id, old_author) of confirmed entries} with the live detected set, so a hand edit can never widen the write set. Each write is `UPDATE indicators.formulas SET author=$new WHERE formula_id=$id::uuid AND author=$old AND author <> $system AND author !~* '<uuid-re>' RETURNING formula_id`, the compare-and-set shape of `resolve_intent` (`formulas_repository.py:137-149`, recon.md:24, :43); the system/UUID guard lives in the SQL itself (C-10(c), platform `@AC-6`). Zero rows returned = `skipped_concurrent` (AC-8). `updated_at` is left untouched (`_UPDATE_SQL` content stamp, `formulas_repository.py:74`, recon.md:23). The statement never references `is_public` (`@AC-11`) and never goes through `UpdateFormula`/`DeleteFormula`. The result file records `run_id`, target host/db, old and new author for every rewritten row, and counts of rewritten/skipped/unmappable/ambiguous; it is the undo record (reverse CAS from the same plan). Pending-intent rows are authored by the instantiating user's UUID and therefore never detected (platform `@AC-18`/`@AC-19`, recon.md:62).

**Restart and verify (required runbook steps).** `_load_formula` reads `self._formulas` first with no TTL (`servicer.py:100,153`) and admin `GetFormula` caches foreign rows (`servicer.py:448-452`). The runbook requires a redeploy/restart of EVERY indicators instance after apply, then a re-run of report mode (0 rewritable for the confirmed authors), then AC-1 verified as the owner through `GetFormula`/`ExecuteFormula`/`test_formula` on one rewritten id, NOT `ListFormulas` alone (it reads the DB, `servicer.py:472-474`, and would pass on a stale cache). Analysis formula caches are per-request (`xstockstrat-analysis` servicer `:912-914`), so no analysis restart. Plan and result files are attached to the DBA change record before the redeploy (no ledger client: overbuilt for a one-off); the runbook names a storage location and flags the PII.

**AC-9 (narrowed, operator-signed).** Authority to run the fix is the DB credential holder (infra) plus the DBA change record (process, not code). The code enforces only integrity: apply refuses without a digest-matched, fully-confirmed plan and never touches system or UUID rows. The digest is integrity, not authority; docs must not claim otherwise. Sign-off recorded 2026-10-22 in context.md.

**Tests (pytest; no real-Postgres harness, CI's only Postgres is the migration rerun, `ci.yml:636-656`).** A `FakeFormulasTable` evaluates EVERY predicate of the real SQL (formula_id, `author=$old`, system guard, UUID guard), plus one test parsing the SQL text to assert both guards are present. Cases: classify/plan-builder (AC-3/4/5/7, case folding, inactive exclusion, upper-case UUID not legacy); `test_apply_refused_*` (missing digest, mismatched digest, leftover `suggested`, inactive target), `test_apply_refuses_system_old_author`, `test_apply_refuses_uuid_old_author`, all asserting zero UPDATEs and system rows keeping author and `updated_at`; a hand-widened plan cannot extend the write set; an interleaving test mutating the row between plan and apply (AC-8; the owner-update leg is a direct row change because `UpdateFormula` cannot run on a legacy row, `servicer.py:502-506`); AC-1/AC-6 through the servicer read path with a cold cache via `ctx_with` (`tests/conftest.py:21`, shape of `tests/test_formula_read_authz.py:31`) and a stale-cache negative test documenting the restart requirement. Single-statement UPDATE atomicity in Postgres is taken as given.

**Trace (C-03).** The CLI has no originating request, so no `x-trace-id` exists; a `run_id` is stamped on logs and artifacts (the minted-context case the 2026-10-21 operator decision allows). Feature 275's reporting changes are not touched.

## Rejected Alternatives

- Migration 008 with `-- requires-env: mapping` (ingest 013 precedent, recon.md:37) — rejected: an unset variable blocks the whole migrator (fails.md 2026-08-19), no report-only mode for FR-5, PII in deploy env vars, prod username set unknown.
- Additive admin RPC `RepairFormulaAuthors` — rejected: proto churn, a write surface beside `@AC-28`, evicts the cache on one instance only, permanent code for a one-off repair. Was the fallback only if the operator rejected the narrowed AC-9; the operator signed off, so it is closed.
- Startup hook applying a committed plan at boot (`main.py:62`, recon.md:40) — rejected: plan (PII) would be committed to git, detection reruns every boot, reports only to logs.
- Running from a DO console session — rejected: no file upload and stdout is lost, so plan/result artifacts are not durable.
- Cross-schema read of `identity.users` from indicators code — rejected: violates schema ownership (C-18); replaced by an operator-supplied users file.
- Extracting a pool from `main.py` — rejected: unnecessary for a single-shot CLI; one `asyncpg.connect` plus the PgBouncer cache rule.
- Auto-applying unique heuristic matches without a confirmed plan — rejected: violates FR-3 / P-03.
- Trusting plan values with only a CAS on `author=$old` — rejected: a hand-edited plan could rewrite a system or user-owned row; replaced by the SQL guard plus DB re-derivation.

## Open Risks

- [ ] Prod legacy-author set and count unknown; a wrong unique heuristic match misassigns formulas unless the human confirm step is honoured — to be addressed at the runbook (report-first, suggested-only) and the first prod report run.
- [ ] Forgetting to restart every indicators instance after apply leaves AC-1 failing from the stale cache; verify must use `GetFormula`/`ExecuteFormula`, not `ListFormulas` — runbook and stale-cache test.
- [ ] Plan and result files hold email local parts (PII) and are the only undo/audit record; loss removes rollback and ownership moves are not ledger-audited — runbook storage and retention step.
- [ ] Rows can change between plan and apply; `skipped_concurrent` rows need a re-run — runbook and AC-8 test.
- [ ] Wrong-DB targeting by an operator — mitigated by required `DATABASE_URL`, no fallback, printed target in both modes.
- [ ] Operator workstation must reach the managed DB (trusted sources, same need as `manage-users.py`); the DO-console fallback loses file durability — runbook states which is used.
- [ ] Fake-table tests do not prove real Postgres behaviour of the WHERE clause — mitigated by full-predicate fake plus SQL-text guard test.
- [ ] The email-local-part heuristic is unverified on prod (OQ-2) — mitigated by suggested-only status, explicit override, unmappable/ambiguous follow-ups.
- [ ] Scope creep into feature 275 reporting — spec steps must not touch 275's surfaces.

## Constitution Rules Touched

- `C-03` — honored by: no originating request, so no trace id; `run_id` on logs/artifacts (minted-context case allowed).
- `C-10(c)` — honored by: the system/UUID guard is inside the apply UPDATE, plus pre-flight refusal and DB re-derivation.
- `C-11` — honored by: this design gate (full mode, 2 rounds, operator approval).
- `C-15` — honored by: AC-1..AC-9 testable as written; AC-9 reworded to the signed-off meaning.
- `C-18` — honored by: no roles export, no ledger client, single plan format, no cross-schema read.
- `P-03` — honored by: never assign to an unidentified user; heuristic matches are suggested only and need confirmation.
- `F-04` — honored by: no false reuse claims; the `main.py` pool is inline and not reused.
- `F-06` — honored by: pooled `:25061` URL, off the direct budget.
- `PLAT-N1` — honored by: verify step (report re-run plus owner-side read) before declaring success.
- Approval flow — DB data change needs DBA and service-owner sign-off, captured in the DBA change record.
- No Floor (`F-*`) breaches.

## Business Rules Touched (C-16)

- EXTEND feature `@AC-1` (owner can list/read/execute a repaired formula) — new case added: verified through the servicer read path with a cold cache, plus a stale-cache negative test.
- EXTEND feature `@AC-6` (non-owner stays NOT_FOUND, admin PERMISSION_DENIED) — new case added: unchanged after repair, asserted through the servicer.
- CHANGE feature `@AC-9` "Only an authorized operator can run the rewrite and system-author rows are never touched" — altered to "apply refuses without a digest-matched, fully-confirmed plan and never touches system or UUID rows; authority is the DB credential plus the DBA change record"; signed off by operator @ 2026-10-22 (context.md, `covered_by_operator_decision`).
- PRESERVE feature FR-4 / `@AC-4` (user-id and system rows never modified) — not regressed by: SQL-level UUID/system guard and an untouched-row test.
- PRESERVE platform `@AC-6` (fundamentals loop runs the system formula) — not regressed by: system rows are refused pre-flight and excluded in the UPDATE.
- PRESERVE indicators `@AC-28` (no admin override for writes) — not regressed by: no RPC added; the repair is outside the servicer.
- PRESERVE indicators `@AC-4` (RegisterFormula stamps `x-user-id`) — not regressed by: no caller-supplied author path added.
- PRESERVE platform `@AC-18`/`@AC-19` (pending-intent and template-saga rows) — not regressed by: those rows carry user UUIDs and are not detected.
- PRESERVE indicators `@AC-1`, `@AC-2`, `@AC-10`, `@AC-11`, `@AC-22` — non-owner results unchanged, no `is_public` reference, no migration touched.
