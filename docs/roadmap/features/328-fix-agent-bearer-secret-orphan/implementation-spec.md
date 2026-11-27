# Implementation Spec: fix-agent-bearer-secret-orphan

**Status**: `pending`
**Created**: 2026-11-20
**Feature**: `docs/roadmap/features/328-fix-agent-bearer-secret-orphan/feature.md`
**Total Steps**: 9
**Feature Branch**: `feature/fix-agent-bearer-secret-orphan`

**Evidence tree**: every `path:line` below was read on `origin/main-dev@fb52065c` (2026-11-20). The
feature branch (`70221104`) is 168 commits behind `main-dev` and holds docs only; `/sdd-execute`'s
BRANCH SYNC merges `main-dev` before Step 1, so that merged tree is what the steps run on. Line
numbers in `design.md` / `recon.md` that drifted are corrected here (see § Spec-time corrections).

---

## Execution Summary

The approved design (design.md § Chosen Approach) ships **no migration, no proto change and no new
config key**: an operator-run SQL sweep reclaims `ingest` / `mcp_credential.*` per-user secrets that
no signal source of the same owner references. Steps 1–3 land the sweep, its read-only preview and
both tests as one backend unit. Step 4 documents the operator procedure. Steps 5–6 (agent) and 7–8
(UI) add the C-10 text edits and the writer-side regression pins on each consumer surface. Step 9
finishes the remaining shared docs. The order is backend → runbook → agent → UI → docs because the
agent and docs text link to the runbook section, and the runbook cites the scripts.

**Consumer surface (C-14).** The product spec has no `## Consumer Surface(s)` section (bug template,
recorded as a review warning). The design marks the fix internal-only plus an operator runbook: the
agent tools `manage_signal_source` / `instantiate_template` and the `/insights` signal-source hooks
keep their behavior. They are still reached here — Steps 5–6 (agent) and 7–8 (UI) — with text edits
and pins only. That is a decision, not an omission.

**Operator decision on the migration number (2026-11-20).** "The next free config migration above
the main-dev tip" has nothing to number: this spec ships no migration (D-1), and discovery found no
reason for one. Config's tip on `main-dev` is `055_analysis_live_enrich_ttl_reseed`; it is untouched.

### Scenario Coverage (C-15)

| Scenario | Covered by | Role |
|---|---|---|
| `@AC-1` | Step 2, Step 6 | Step 2 block 1 is the RED coverage of the Then-clause (post-sweep state); Step 6 is the agent writer pin |
| `@AC-2` | Step 2, Step 6 | as AC-1, for `instantiate_template` |
| `@AC-3` | Step 2, Step 8 | Step 2 block 1 is the RED coverage; Step 8 is the config-ui/insights writer pin |
| `@AC-4` | Step 1, Step 2 | Step 2 block 1 (referenced keys of U and V2 survive, orphans deleted); Step 1 pins the predicate text |

The writer pins (Steps 6 and 8) are **green on the pre-fix tree** by design (O-19): the writers do
not change. They pin the two facts the sweep depends on — one secret per attempt, and the
`credentials_ref == "ingest." + key` form the owner-exact join strips.

### Debate objections O-17..O-25 → steps

| Objection | Step | How |
|---|---|---|
| O-17 survivor seeds per conjunct | 2 | every must-survive seed is 25h old and matches every other conjunct |
| O-18 audit count filtered by actor | 2 | `changed_by = 'system:config-heal-mcp-credential-sweep'` |
| O-19 Covers / RED source, SetConfig row shape, ref form | 2, 6, 8 | Covers lines; seeds in the SetConfig shape; `credentials_ref == f"ingest.{key}"` |
| O-20 author-sentinel row | 9 | `docs/patterns/config-governance.md` sentinel table |
| O-21 single statement + `nt` reference | 1 | `splitStatements` count and the final-SELECT check |
| O-22 target databases, runbook home | 4 | operator gate in Step 4; section in `config-rollout.md` |
| O-23 no `rep` write | 1, 3 | sweep has no `config_keys_report_296`; Step 1 forbids the token |
| O-24 symbol-named `tools.py` sites | 5 | `_write_source_bearer`, `manage_signal_source` `credentials_ref:` |
| O-25 UI instantiate writer pin | 8 | recorded intentional skip |

### Spec-time corrections to design.md / recon.md (citations only, no change of substance)

- The agent `tools.py` sites moved: `_write_source_bearer` is at `:479-498` (docstring `:480-483`),
  the `instantiate_template` write at `:1492-1511`, the `manage_signal_source` `credentials_ref:`
  param doc at `:1541-1544`, the register write at `:1602-1623`. Steps name symbols, not lines (O-24).
- The Playwright seam is the `@AC-6` test at `e2e/insights/signal-sources.spec.ts:112-126`, which
  fulfills **503 / `unavailable`**, not 409 / `already_exists`. Step 8 reuses its shape with a 409
  body. The feature-224 block starts at `:201`.
- The register error on the insights page is a plain paragraph
  (`src/app/insights/signal-sources/page.tsx:822`, `<p className="text-xs text-destructive">`), not a
  `role="alert"` element. Step 8 asserts the visible error **text**, not an alert role.
- The agent `CLAUDE.md` note is at `:103-104` and the ingest `CLAUDE.md` note at `:167-175`; neither
  contains the word "orphan" today. `docs/patterns/config-governance.md` sites are `:440-447`
  (feature 224) and `:650-654` (feature 166); the author-sentinel table is at `:138-144`.
- Agent finding to resolve: `services/xstockstrat-agent/docs/context-constitution-findings.md:46`
  (report row `:81`).
- **Cross-owner seeds.** The binding decision names one user V for three cases, but case (i) needs V
  to have **no source** while cases (ii)/(iii) need V to **have** sources. Step 2 honors every clause
  literally with two seed users: `sweep328-v1` (case i: holds U's referenced key A, has no source at
  all) and `sweep328-v2` (cases ii and iii). Flag for `/sdd-review impl-spec`.

### Not confirmed at spec time (P-03 — operator gates, not guesses)

- **Target database list** (design Open Risk; fails.md "config-dead-rows-prune — assumption"). The
  operator has not confirmed it. Candidates on record: DO dev and DO prod (`.do/app.dev.yaml`,
  `.do/app.yaml`), homelab `xstockstrat-staging` (`docs/runbooks/operator-db-access.md:56-63`).
  Evidence that narrows it but is not a confirmation for this feature: feature 305 found only DO dev
  running, and `docs/runbooks/config-rollout.md:303-304` says the homelab has no production
  instance. **Step 4 is gated on the operator's answer.**
- **Sweep cadence** (design Open Risk 1 says "state the cadence" and names none). Step 4 proposes
  "on demand, and before each `main-dev` → `main` promotion"; the operator confirms or replaces it.

## Step Dependencies

- Steps 1+2+3 land together: `step-constraints.md` §C "adds a test that references a symbol a later
  step creates" — Steps 1 and 2 read / `\ir` the two SQL files Step 3 creates. One backend surface,
  adjacent, 3 members.
- Step 1 [test] and Step 2 [test] cover Step 3 [service].
- Step 4 requires Step 3: the runbook cites the two script paths.
- Step 5 requires Step 4: the docstring and `mcp-tools.md` text point at the runbook section.
- Steps 5+6 land together (P-06, red before green): Step 6's parity test
  (`test_bearer_docs_name_the_orphan_sweep`) is the only red for Step 5's text edits, and it is green
  only once those edits exist. Committed alone, Step 5 has no failing test and Step 6 fails its own
  Verification (F-05). One agent surface, adjacent, 2 members. Order inside the unit: write Step 6's
  tests, capture the parity red, apply Step 5's edits, one commit.
- Step 6 [test] covers Step 5 [service].
- Step 8 [test] covers Step 7 [service].
- Step 9 requires Step 4: the docs link to the runbook section.
- **Operator gate reach (P-03).** Step 4 is blocked until the operator confirms the target database
  list and the cadence (§ Not confirmed at spec time). Steps 5+6 and Step 9 link to Step 4's runbook
  anchor, so they are blocked with it. Steps 1–3 and Steps 7–8 do not depend on Step 4 (Step 7 names
  the runbook file only, not the section) and can land while the gate is open.
- Live SQL gate (D-9): `scripts/migration-assertions/**` is already in the `migrations` CI filter
  (`.github/workflows/ci.yml:95`), so the `migration-rerun` job (`ci.yml:898-934`) runs Step 2's
  assertion on the integration PR. A red there reopens the Steps 1–3 unit.
- Shared files with batch peers: `services/xstockstrat-agent/app/tools.py` and `tests/test_tools.py`
  (`fix-mcp-deadline-budget`, `fix-agent-mcp-transport-fallthrough`; `merge-order.md:404-405`), and
  possibly `.github/workflows/ci.yml` (`fix-ci-enforcement-gaps`). Disjoint anchors; the second
  merger rebases and re-greps them.
- Shared files with live features outside the batch (impl-spec overlap scan, 2026-11-20; file-level
  only — no migration number, proto field or config key collides). Whichever merges second rebases
  and re-greps its anchors:
  - `345-authelia-sso`: `services/xstockstrat-agent/app/tools.py` (its spec `:985`),
    `docs/runbooks/mcp-tools.md` (`:2319`, the DCR connector section, not `manage_signal_source`),
    `.github/workflows/ci.yml` (`:603`, `:752`, `:1210`) and `docs/patterns/config-governance.md`
    (`:2370`, § Per-Feature Registered Keys).
  - `357-fix-portfolio-internal-position`: `.github/workflows/ci.yml:1065` only (its spec `:156`).
  - `321-fix-trading-config-plumbing` and `330-fix-live-enrich-ttl-seed`:
    `docs/patterns/config-governance.md`. 330's author-sentinel row is already on `main-dev` (`:144`);
    Step 9 adds its row after the table's last row, wherever that is after the merge.
  - `318-fix-migration-tooling-safety` and `324-fix-ci-enforcement-gaps` (batch peers, no
    implementation spec on trunk yet, so unverified): `.github/workflows/ci.yml`, most likely at the
    `migrations:` list Step 2 appends to (`merge-order.md:388-389`).
  - The root `docs/context-constitution-findings.md` is **not** edited by this feature
    (`git grep -c -i mcp_credential origin/main-dev -- docs/context-constitution-findings.md` → no
    hit); only the agent-local findings file is (Step 5).
- No deferred consumer surface. Follow-up option only (not planned): a read-only orphan-count signal
  (design § Rejected Alternatives, round 3).

---

### Step 1 — test: config SQL-text suite for the sweep and preview

**Status**: `pending`
**Service**: `xstockstrat-config`
**Files**:
- `services/xstockstrat-config/src/__tests__/mcpCredentialSweep.test.ts` — create

**Reviewers**: `xstockstrat-config` owner — secret encryption + redaction, global/per-user scoping

**Codebase Evidence**:
- Runner and layout: `services/xstockstrat-config/src/__tests__/deadRowsMigration.test.ts:2-7`
  (`import { describe, it } from 'node:test'`, `node:assert/strict`, `fs`, `path`); script path
  resolved from `dist/__tests__/` at `:9`
  (`path.resolve(__dirname, '../../../../scripts/config-heal/signoff.md')`).
- `splitStatements(sql: string): string[]` — `src/__tests__/migrationSql.ts:19-53`. It drops `--`
  comments, splits on `;` outside single-quoted literals, and asserts no unterminated literal and no
  trailing statement.
- Anchored transaction regex: `deadRowsMigration.test.ts:29`
  (`/^\s*(BEGIN|COMMIT|ROLLBACK)\s*;/im`).
- Test command: `package.json:12` (`"test": "tsc && node --test dist/__tests__/*.test.js"`), `:13`
  (`test:coverage`), `:14` (`lint`). `tsconfig.json` includes `src/**/*`, so the suite is compiled.
- No existing `mcpCredentialSweep*` file (`ls src/__tests__/`): **Not found** — created from scratch.

**Lands with**: `Step 2, Step 3`

**TDD**: `red-green required` — one cycle for the Steps 1–3 unit. Skeleton (insights.md, feature 360
"brand-new module" pattern): before capturing red, create both SQL files of Step 3 as behavior-free
placeholders (`SELECT 0 AS deleted, 0 AS notified;` and `SELECT 1 WHERE false;`), uncommitted, so
this suite fails on its assertions (no marker block, no `nt`, …) rather than on `ENOENT`. Replace
them with Step 3's content before the unit's single commit.

**Covers**: `AC-4` — text pin of the owner-exact, stripped-key `NOT EXISTS` that keeps a referenced
secret. The behavioral RED for AC-1..4 is Step 2 block 1.

**Instructions**:
Create `mcpCredentialSweep.test.ts` in the `deadRowsMigration.test.ts` style. Resolve
`SWEEP = path.resolve(__dirname, '../../../../scripts/config-heal/mcp-credential-orphan-sweep.sql')`
and `PREVIEW = …/mcp-credential-orphan-sweep-preview.sql`. Import `splitStatements` from
`./migrationSql`. One `describe('feature 328 mcp_credential orphan sweep', …)` with these cases:

1. **Single statement (O-21).** For each file, drop every line that starts with `\` (psql
   meta-commands), then `splitStatements(...)` returns exactly 1 statement; it starts with `WITH`
   for the sweep and `SELECT` for the preview.
2. **No transaction statement.** Neither file matches `/^\s*(BEGIN|COMMIT|ROLLBACK)\b/im` after
   meta-command lines are dropped.
3. **`nt` is referenced.** The sweep's text after the last `)` that closes the CTE list contains
   `FROM nt` (assert on the final `SELECT … ;` slice, i.e. the text from the last line that starts
   with `SELECT` at column 0).
4. **Byte-identical predicate (D-6).** Extract the lines strictly between `-- mcp_orphan:begin` and
   `-- mcp_orphan:end` from each file; each file has exactly one such block; the two blocks are
   `===` equal and non-empty.
5. **Predicate content.** The block contains `v.updated_at` and not `created_at`; contains
   `GREATEST(:'grace_hours'::int, 1)`; contains `starts_with(v.key, 'mcp_credential.')` and no
   `LIKE` (case-insensitive); contains `v.is_secret`, `v.user_id IS NOT NULL`, `v.namespace = 'ingest'`;
   contains `NOT EXISTS`, `s.user_id = v.user_id` and
   `substring(s.credentials_ref from position('.' in s.credentials_ref) + 1) = v.key`.
6. **Notify shape (D-7, CONFIG-4).** The sweep contains `GROUP BY namespace, environment, user_id`,
   the four payload keys `'namespace'`, `'key'`, `'environment'`, `'user_id'` inside
   `json_build_object`, and no `DISTINCT ON`.
7. **Audit actor (D-4).** The sweep contains `'system:config-heal-mcp-credential-sweep'`.
8. **Forbidden tokens (D-3, O-23).** Neither file contains `value_encrypted`, `premigration`,
   `config_markers` or `config_keys_report_296`.
9. **Header.** Both files contain a line starting `\if :{?grace_hours}` and a line `\set grace_hours 24`.

C-13: the suite uses no mocked domain data (it reads repository files) — nothing to centralize.
Comments: at most a 2-line header (root `CLAUDE.md` § How to Act #5).

**Verification**:
```bash
cd services/xstockstrat-config && pnpm run test:coverage && pnpm exec c8 check-coverage --lines 40 && pnpm run lint
node --test dist/__tests__/mcpCredentialSweep.test.js   # from services/xstockstrat-config; 9 cases executed, 0 skipped
```
Coverage threshold: ≥ 40% lines (C-08).

---

### Step 2 — test: migration-rerun assertion for the sweep, and its CI path filters

**Status**: `pending`
**Service**: `scripts/migration-assertions` (config + ingest schemas), `.github/workflows`
**Files**:
- `scripts/migration-assertions/config-mcp-credential-sweep.sql` — create
- `.github/workflows/ci.yml` — modify

**Reviewers**: `xstockstrat-config` owner — secret encryption + redaction, scoping; DBA — run-order
compliance with `scripts/db-migrate.sh`; Security — secrets redacted at every edge, no plaintext or
ciphertext read

**Codebase Evidence**:
- Block template: `scripts/migration-assertions/ingest-016.sql:19-35`
  (`BEGIN; … \ir ../../services/…up.sql … DO $$ … RAISE EXCEPTION … $$; ROLLBACK;`), and its
  `ingest.signal_sources` insert column list at `:40-42`
  (`user_id, slug, display_name, source_type, extractor_module, active, reliability_weight`).
- Runner: `scripts/migration-rerun.py:562-572` (`split_assertions`: a name that is neither
  `fixtures-*` nor `config-[0-9]*` below R goes to `post`), `:575-576` (`assertion_names` globs
  `*.sql`), `:579-593` (`run_assertion`: `psql -v ON_ERROR_STOP=1 … -f <file>`, one psql process per
  file), `:1112-1120` (after `db-migrate.sh up`, ingest at 18 and config at top, every `post` file
  runs). `config-mcp-credential-sweep.sql` does not match `config-[0-9]*`, so no harness edit (D-8,
  R-7). `scripts/tests/test_migration_rerun.py:170-182` already pins that a non-numeric
  `config-heal.sql` lands in `post`.
- `config.config_values` columns and constraints: `001_config_tables.up.sql:6-20`;
  `value_encrypted BYTEA`, `user_id TEXT` (`017_config_secrets_and_scoping.up.sql:24-26`);
  environment CHECK `('staging','production')` (`017:40-41`); unique index
  `(namespace, key, environment, COALESCE(user_id, ''))` (`017` § 6, `config_values_scope_uniq`);
  relative-key CHECK `left(key, length(namespace) + 1) <> namespace || '.'` (`045:128-129`).
- Triggers: `config_value_audit` BEFORE UPDATE (`001:49-51`) whose function sets
  `NEW.updated_at = NOW()` (`017` § 5, `config.audit_config_change`) — so seeds are backdated by
  INSERT, never UPDATE (D-10, R-11); `config_value_audit_insert` AFTER INSERT (`010:27-28`) writes
  one audit row per seed (O-18). No DELETE trigger exists (`grep -n "CREATE TRIGGER" migrations/*.up.sql`
  → only those two).
- SetConfig's secret row shape: `services/xstockstrat-config/src/grpc/configServiceImpl.ts:832`
  (`valueData = REDACTED`, `REDACTED = '[redacted]'` at `:34`) and the insert column list at
  `:840-841` (`namespace, key, value_type, value_data, value_encrypted, is_secret, updated_by,
  update_reason, environment, user_id, caller_identity`).
- `ingest.signal_sources`: `credentials_ref TEXT` nullable (`002:12`), `user_id TEXT NOT NULL` and PK
  `(user_id, slug)` (`013:24-32`), `mcp_client` allowed in the `source_type` CHECK (`011:9-10`).
- CI filters: `.github/workflows/ci.yml:60` (`xstockstrat-config: ['services/xstockstrat-config/**']`),
  `:88-98` (`migrations:` list, entries indented 14 spaces as `- '<glob>'`), job trigger `:898-903`.
- **Executed at spec time (2026-11-20)** on PostgreSQL 16.15 against a stand-in schema (the three
  tables, the two audit triggers, both CHECKs and the unique index above): the file below exits 0;
  the sweep prints `deleted 4, notified 2`, the replay `0, 0`; nine single-conjunct mutations of the
  sweep (key-only join, `LIKE`, `created_at`, no floor, no `is_secret`, no namespace, no
  `user_id IS NOT NULL`, unstripped ref, no `NOT EXISTS`) each make it exit 3; no row survives the
  ROLLBACKs. It has **not** run against the real migration chain — the `migration-rerun` job is the
  first real execution.

**Lands with**: `Step 1, Step 3`

**TDD**: `red-green required` — same cycle as Step 1. Offline red is Step 1's suite against the
skeleton. The SQL red (block 1 raising `sweep survivors differ` against the skeleton sweep) is
captured only when a disposable, already-migrated database is reachable through `DATABASE_URL`;
never start one. Otherwise record "SQL red not captured locally" and the CI `migration-rerun` result
is the live green.

**Covers**: `AC-1, AC-2, AC-3, AC-4` — block 1 is the RED coverage of the AC-1..3 Then-clauses
("after the sweep runs … no unreferenced `mcp_credential.<uuid>` key") and of AC-4 (referenced keys
survive, the orphan is deleted).

**Instructions**:
1. Create `scripts/migration-assertions/config-mcp-credential-sweep.sql` with exactly this content
   (seed users `sweep328-u`, `sweep328-v1`, `sweep328-v2`; every count scoped to them; sort orders
   use `COLLATE "C"` because the database collation orders `X` and `_` differently):

```sql
-- Feature 328 (AC-1..AC-4): the operator sweep scripts/config-heal/mcp-credential-orphan-sweep.sql, run by
-- migration-rerun.py after pass 3. Every block is BEGIN ... ROLLBACK; every count is scoped to the sweep328-* seed users.

-- Block 1 (default grace, 24h): one conjunct protects each survivor; the owner join is exact.
BEGIN;
INSERT INTO ingest.signal_sources
  (user_id, slug, display_name, source_type, extractor_module, active, reliability_weight, credentials_ref)
VALUES
  ('sweep328-u',  'u-ref-a',  'U A',     'mcp_client', 'app.extractors.noop', TRUE, 1.0, 'ingest.mcp_credential.a'),
  ('sweep328-u',  'u-nodot',  'U nodot', 'mcp_client', 'app.extractors.noop', TRUE, 1.0, 'nodot'),
  ('sweep328-u',  'u-null',   'U null',  'mcp_client', 'app.extractors.noop', TRUE, 1.0, NULL),
  ('sweep328-u',  'u-empty',  'U empty', 'mcp_client', 'app.extractors.noop', TRUE, 1.0, ''),
  ('sweep328-v2', 'v2-ref-k', 'V2 K',    'mcp_client', 'app.extractors.noop', TRUE, 1.0, 'ingest.mcp_credential.k'),
  ('sweep328-v2', 'v2-ref-m', 'V2 M',    'mcp_client', 'app.extractors.noop', TRUE, 1.0, 'ingest.mcp_credential.m');
INSERT INTO config.config_values
  (namespace, key, value_type, value_data, value_encrypted, is_secret, environment, user_id, updated_at)
VALUES
  ('ingest', 'mcp_credential.a',      'string', '[redacted]', '\x00', TRUE,  'staging', 'sweep328-u',  now() - interval '25 hours'),
  ('ingest', 'mcp_credential.b',      'string', '[redacted]', '\x00', TRUE,  'staging', 'sweep328-u',  now() - interval '25 hours'),
  ('ingest', 'mcp_credential.c',      'string', '[redacted]', '\x00', TRUE,  'staging', 'sweep328-u',  now()),
  ('ingest', 'mcp_credential.g328',   'string', '[redacted]', '\x00', TRUE,  'staging', NULL,          now() - interval '25 hours'),
  ('ingest', 'mcp_credential.x',      'string', 'plain',      NULL,   FALSE, 'staging', 'sweep328-u',  now() - interval '25 hours'),
  ('notify', 'mcp_credential.y',      'string', '[redacted]', '\x00', TRUE,  'staging', 'sweep328-u',  now() - interval '25 hours'),
  ('ingest', 'mcpXcredential.z',      'string', '[redacted]', '\x00', TRUE,  'staging', 'sweep328-u',  now() - interval '25 hours'),
  ('ingest', 'mcp_credential.staged', 'string', '[redacted]', '\x00', TRUE,  'staging', 'sweep328-u',  now() - interval '25 hours'),
  ('ingest', 'mcp_credential.k',      'string', '[redacted]', '\x00', TRUE,  'staging', 'sweep328-u',  now() - interval '25 hours'),
  ('ingest', 'mcp_credential.a',      'string', '[redacted]', '\x00', TRUE,  'staging', 'sweep328-v1', now() - interval '25 hours'),
  ('ingest', 'mcp_credential.m',      'string', '[redacted]', '\x00', TRUE,  'staging', 'sweep328-v2', now() - interval '25 hours');
\ir ../config-heal/mcp-credential-orphan-sweep.sql
\ir ../config-heal/mcp-credential-orphan-sweep.sql
DO $$
DECLARE
  survivors TEXT[];
  n_audit   INTEGER;
BEGIN
  SELECT array_agg(t.id ORDER BY t.id COLLATE "C") INTO survivors
    FROM (SELECT COALESCE(user_id, 'global') || '/' || namespace || '/' || key AS id
            FROM config.config_values
           WHERE user_id LIKE 'sweep328-%' OR (user_id IS NULL AND key = 'mcp_credential.g328')) t;
  IF survivors IS DISTINCT FROM ARRAY[
       'global/ingest/mcp_credential.g328',
       'sweep328-u/ingest/mcpXcredential.z',
       'sweep328-u/ingest/mcp_credential.a',
       'sweep328-u/ingest/mcp_credential.c',
       'sweep328-u/ingest/mcp_credential.x',
       'sweep328-u/notify/mcp_credential.y',
       'sweep328-v2/ingest/mcp_credential.m'] THEN
    RAISE EXCEPTION 'AC-1..AC-4: sweep survivors differ: %', survivors;
  END IF;
  SELECT count(*) INTO n_audit FROM config.config_audit
   WHERE changed_by = 'system:config-heal-mcp-credential-sweep' AND user_id LIKE 'sweep328-%'
     AND old_value = '[redacted]' AND new_value IS NULL;
  IF n_audit <> 4 THEN
    RAISE EXCEPTION 'AC-1: expected 4 sweep audit rows (one per delete, none from the second run), got %', n_audit;
  END IF;
END $$;
ROLLBACK;

-- Block 2: grace_hours=0 is floored to 1h.
BEGIN;
INSERT INTO config.config_values
  (namespace, key, value_type, value_data, value_encrypted, is_secret, environment, user_id, updated_at)
VALUES
  ('ingest', 'mcp_credential.m30', 'string', '[redacted]', '\x00', TRUE, 'staging', 'sweep328-u', now() - interval '30 minutes'),
  ('ingest', 'mcp_credential.h2',  'string', '[redacted]', '\x00', TRUE, 'staging', 'sweep328-u', now() - interval '2 hours');
\set grace_hours 0
\ir ../config-heal/mcp-credential-orphan-sweep.sql
DO $$
DECLARE survivors TEXT[];
BEGIN
  SELECT array_agg(key ORDER BY key COLLATE "C") INTO survivors FROM config.config_values WHERE user_id LIKE 'sweep328-%';
  IF survivors IS DISTINCT FROM ARRAY['mcp_credential.m30'] THEN
    RAISE EXCEPTION 'grace floor: expected only the 30-minute orphan to survive grace_hours=0, got %', survivors;
  END IF;
END $$;
ROLLBACK;
```

   What each seed pins (design.md § 4b; the three cross-owner seeds are the operator's binding
   decision of 2026-11-20):

   | Seed | Expected | Pins |
   |---|---|---|
   | `sweep328-u` `mcp_credential.a`, referenced by `u-ref-a` | survives | referenced case (AC-4) |
   | `sweep328-u` `mcp_credential.b` | deleted | basic orphan (AC-1..4) |
   | `sweep328-u` `mcp_credential.c`, fresh | survives | grace window |
   | global `mcp_credential.g328` | survives | `user_id IS NOT NULL` |
   | `sweep328-u` `mcp_credential.x`, `is_secret = false` | survives | `is_secret` |
   | `sweep328-u` `notify` / `mcp_credential.y` | survives | `namespace` |
   | `sweep328-u` `mcpXcredential.z` | survives | `starts_with`, not `LIKE` |
   | sources `u-nodot`, `u-null`, `u-empty` | no error | stripped-key edge cases |
   | `sweep328-u` `mcp_credential.staged` | deleted | documented reclaim rule for a pre-staged key |
   | (i) `sweep328-v1` holds `mcp_credential.a`, has no source | **deleted** | a key-only join would keep it |
   | (ii) `sweep328-v2` source references `…k`; `sweep328-u` holds `mcp_credential.k` | U's K **deleted** | owner-exact join |
   | (iii) `sweep328-v2` `mcp_credential.m`, referenced by `v2-ref-m` | survives | referenced case for a second owner |

   The second `\ir` in block 1 is the replay: the audit count staying at 4 proves it changed nothing.
   Block 2's `\set grace_hours 0` must precede its `\ir` because block 1's header already set the
   variable to 24 in the same psql process (O-12).
2. In `.github/workflows/ci.yml`:
   - change the `xstockstrat-config` filter line (`:60`) to
     `xstockstrat-config:     ['services/xstockstrat-config/**', 'scripts/config-heal/mcp-credential-orphan-sweep*.sql']`
     (keep the existing column alignment);
   - append `              - 'scripts/config-heal/mcp-credential-orphan-sweep*.sql'` to the
     `migrations:` list (`:88-98`), after `- 'scripts/migration-assertions/**'`.

C-13: the seed literals have one consumer (this file) — inline is compliant.

**Verification**:
```bash
grep -c '^BEGIN;$' scripts/migration-assertions/config-mcp-credential-sweep.sql      # 2
grep -c '^ROLLBACK;$' scripts/migration-assertions/config-mcp-credential-sweep.sql   # 2
grep -c "mcp-credential-orphan-sweep\*.sql" .github/workflows/ci.yml                 # 2
node --test scripts/config-wiring.test.mjs                                          # ci.yml filter parser still green
uv run --no-project --with pglast python3 - <<'EOF'
import pathlib, pglast
want = {"scripts/config-heal/mcp-credential-orphan-sweep.sql": 1,
        "scripts/config-heal/mcp-credential-orphan-sweep-preview.sql": 1,
        "scripts/migration-assertions/config-mcp-credential-sweep.sql": 9}
for f, n in want.items():
    sql = "\n".join(l for l in pathlib.Path(f).read_text().splitlines() if not l.startswith("\\"))
    got = len(pglast.parse_sql(sql.replace(":'grace_hours'", "'24'")))
    assert got == n, (f, got, n)
print("pglast ok")
EOF
# Live run, ONLY if DATABASE_URL already points at a disposable database migrated by scripts/db-migrate.sh up (never start one):
#   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f scripts/migration-assertions/config-mcp-credential-sweep.sql   # exit 0
```
The binding live gate is the CI `migration-rerun` job on the integration PR (D-9). If `uv` cannot
fetch `pglast` (no egress), that is a deviation to report, not a check to skip.
No coverage threshold applies to this step (a SQL assertion and a CI filter edit, outside any
service package); the unit's threshold is Step 1's `c8 check-coverage --lines 40`.

---

### Step 3 — service: operator sweep and read-only preview SQL

**Status**: `pending`
**Service**: `scripts/config-heal` (data owned by `xstockstrat-config`; reads `xstockstrat-ingest`'s `ingest.signal_sources`)
**Files**:
- `scripts/config-heal/mcp-credential-orphan-sweep.sql` — create
- `scripts/config-heal/mcp-credential-orphan-sweep-preview.sql` — create

**Reviewers**: `xstockstrat-config` owner — secret encryption + redaction, per-user scoping,
WatchConfig stream stability; `xstockstrat-ingest` owner — signal-source registry semantics; DBA —
cross-schema read, run-order; Security — no ciphertext read, no widened secret-read authority

**Codebase Evidence**:
- Pattern to REUSE (recon.md): the single data-modifying CTE in
  `services/xstockstrat-config/migrations/046_config_dead_rows_prune.up.sql:5-61` — `d AS (DELETE …
  RETURNING …)`, `aud AS (INSERT INTO config.config_audit (namespace, key, old_value, new_value,
  changed_by, reason, changed_at, environment, user_id, caller_identity) …)`,
  `nt AS (SELECT pg_notify('config_changed', json_build_object(…)::text) AS sent …)`, and the final
  `SELECT (SELECT count(*) FROM d) AS deleted, (SELECT count(*) FROM nt) AS notified;`. Dropped from
  that shape here: `latch`, `signed`, `snap`, `rep`, `mk` (D-1, D-3, O-23).
- Ref semantics: `split_credentials_ref` splits on the first dot —
  `services/xstockstrat-ingest/app/config/watcher.py:21-26`; the consumer discards the namespace
  half — `app/engine/mcp_client_loop.py:140` (`_namespace, key = split_credentials_ref(credentials_ref)`).
- Literal-prefix grant: `services/xstockstrat-config/src/grpc/authz.ts:153`
  (`keyPrefixes: ['mcp_credential.']`), matched with `key.startsWith(prefix)` at `:199`.
- Notify contract CONFIG-4: `services/xstockstrat-config/docs/context-constitution.md:17`; the
  service's own producer is at `src/grpc/configServiceImpl.ts:853`.
- Migration order: `scripts/db-migrate.sh:152` (config) runs before `:173` (ingest) — why this is a
  script and not a config migration (D-1, R-1).
- `scripts/config-heal/` holds no `mcp-credential*` file (`ls scripts/config-heal/`): **Not found** —
  both files are created from scratch. Nothing enumerates the directory
  (`grep -rn "config-heal"` → only named-file readers).
- Executed at spec time on a stand-in schema — see Step 2 § Codebase Evidence. Unexecuted against
  the real databases; the runbook's first action is the read-only preview (insights.md 2026-11-13
  "operator SQL … dry-run read-only first").

**Lands with**: `Step 1, Step 2`

**TDD**: `red-green required` — the Steps 1–3 cycle; this step replaces the uncommitted skeleton
files named in Step 1.

**Covers**: —

**Instructions**:
1. Create `scripts/config-heal/mcp-credential-orphan-sweep.sql` with exactly this content:

```sql
-- Operator sweep (feature 328): deletes per-user ingest mcp_credential.* secrets no signal source of the same owner references.
-- Must stay ONE statement with no transaction control: the rerun assertion \ir's it inside BEGIN ... ROLLBACK.
\if :{?grace_hours}
\else
\set grace_hours 24
\endif
WITH d AS (
  DELETE FROM config.config_values v
  WHERE
-- mcp_orphan:begin
    v.is_secret AND v.user_id IS NOT NULL AND v.namespace = 'ingest' AND starts_with(v.key, 'mcp_credential.')
    AND v.updated_at < now() - make_interval(hours => GREATEST(:'grace_hours'::int, 1))
    AND NOT EXISTS (
      SELECT 1 FROM ingest.signal_sources s
       WHERE s.user_id = v.user_id
         AND substring(s.credentials_ref from position('.' in s.credentials_ref) + 1) = v.key)
-- mcp_orphan:end
  RETURNING v.namespace, v.key, v.value_data, v.environment, v.user_id
), aud AS (
  INSERT INTO config.config_audit
    (namespace, key, old_value, new_value, changed_by, reason, changed_at, environment, user_id, caller_identity)
  SELECT d.namespace, d.key, d.value_data, NULL, 'system:config-heal-mcp-credential-sweep',
         'feature 328: unreferenced mcp_credential secret reclaimed', clock_timestamp(), d.environment, d.user_id, NULL
  FROM d
), nt AS (
  SELECT pg_notify('config_changed', json_build_object('namespace', namespace, 'key', min(key),
                                                       'environment', environment, 'user_id', user_id)::text) AS sent
  FROM d
  GROUP BY namespace, environment, user_id
)
SELECT (SELECT count(*) FROM d) AS deleted, (SELECT count(*) FROM nt) AS notified;
```

2. Create `scripts/config-heal/mcp-credential-orphan-sweep-preview.sql` with exactly this content
   (the lines between the two markers are byte-identical to the sweep's, including indentation):

```sql
-- Read-only preview of mcp-credential-orphan-sweep.sql: the marker block below must stay byte-identical to the sweep's.
\if :{?grace_hours}
\else
\set grace_hours 24
\endif
SELECT v.user_id, v.key, v.environment, now() - v.updated_at AS age, count(*) OVER () AS total
  FROM config.config_values v
  WHERE
-- mcp_orphan:begin
    v.is_secret AND v.user_id IS NOT NULL AND v.namespace = 'ingest' AND starts_with(v.key, 'mcp_credential.')
    AND v.updated_at < now() - make_interval(hours => GREATEST(:'grace_hours'::int, 1))
    AND NOT EXISTS (
      SELECT 1 FROM ingest.signal_sources s
       WHERE s.user_id = v.user_id
         AND substring(s.credentials_ref from position('.' in s.credentials_ref) + 1) = v.key)
-- mcp_orphan:end
;
```

Constraints the content already honors — do not "improve" them away: no latch, snapshot, report-table
write or transaction statement (D-1, D-3, O-23, O-10); `starts_with`, never `LIKE` (D-11, R-10);
`updated_at`, never `created_at`; the final SELECT references `nt` (otherwise the notify CTE never
runs); `GROUP BY`, never `DISTINCT ON` (R-6); the audit `old_value` is `value_data`, the `[redacted]`
sentinel — neither file names `value_encrypted`. The multi-line `\if … \endif` header is the
design's one-line header, one meta-command per line. No header propagation applies (no gRPC call).
F-07 does not apply: `grace_hours` is a psql variable of an operator script no service reads (D-5).

**Verification**:
```bash
ls scripts/config-heal/mcp-credential-orphan-sweep.sql scripts/config-heal/mcp-credential-orphan-sweep-preview.sql
diff <(sed -n '/-- mcp_orphan:begin/,/-- mcp_orphan:end/p' scripts/config-heal/mcp-credential-orphan-sweep.sql) \
     <(sed -n '/-- mcp_orphan:begin/,/-- mcp_orphan:end/p' scripts/config-heal/mcp-credential-orphan-sweep-preview.sql)   # no output
grep -c "value_encrypted\|premigration\|config_markers\|config_keys_report_296" scripts/config-heal/mcp-credential-orphan-sweep*.sql   # 0 for both
# plus Step 1's suite and Step 2's pglast block (the unit's union): both green
cd services/xstockstrat-config && pnpm run lint
```
New logic is SQL outside any service package; the coverage threshold is enforced by Step 1's command.

---

### Step 4 — docs: operator runbook section for the sweep

**Status**: `pending`
**Service**: `docs/runbooks/`
**Files**:
- `docs/runbooks/config-rollout.md` — modify

**Reviewers**: none

**Codebase Evidence**:
- Home: `docs/runbooks/config-rollout.md` — `## Config Inventory (DO console, read-only)` at `:230`
  and `## Recovery: dirty \`041_heal_config_keys_to_reader_catalog\`` at `:243`; the new section goes
  between them, beside the other operator procedures (O-22).
- Access path: `docs/runbooks/operator-db-access.md:28-42` (DO: direct `:25060`, not PgBouncer
  `:25061`; `doctl databases connection <cluster-id> --format URI`), `:45-50`
  (`psql "<uri>?sslmode=require" -v ON_ERROR_STOP=1 …`), `:56-66` (homelab: tailnet only, direct
  `:5432`, pool `:6432`).
- Privilege pre-check precedent: `docs/runbooks/signal-watchlist-expiry-backfill.md:84`
  (`SELECT has_table_privilege(current_user, 'ingest.newsletter_signals', 'SELECT');`).
- Platform rows: `docs/runbooks/config-rollout.md:292-293` (DigitalOcean, homelab compose); `:303-304`
  ("the homelab has no production instance").
- Banned-phrase scan covers this file: `scripts/check-config-wiring.mjs:862-864` (`DOC_BANNED`,
  `docWide`), run by `node --test scripts/config-wiring.test.mjs`.
- macOS rule: root `CLAUDE.md` § Language Versions & Tooling (commands must be BSD/Homebrew-safe).

**TDD**: `N/A (docs)`

**Covers**: —

**Instructions**:
**Operator gate first (P-03; fails.md "config-dead-rows-prune — assumption").** Before writing, ask
the operator and record both answers in `context.md`:
(a) which databases the sweep targets — candidates: DO dev, DO prod, homelab `xstockstrat-staging`
(and whether a homelab production database exists);
(b) the cadence — proposed: on demand, and before each `main-dev` → `main` promotion.
Write only the confirmed list and cadence. If the operator is unavailable, the step is **blocked**;
do not write a guessed list.

Add `## Operator sweep: orphaned \`mcp_credential\` secrets (feature 328)` between the two sections
cited above, containing, in this order:

1. **What and why** (3–4 lines): the secret-first write leaves an unreferenced per-user
   `ingest` / `mcp_credential.<uuid>` secret when a register or instantiate fails; nothing deletes it
   automatically (no config delete RPC, no scheduler); this sweep is the only reclaim. State the
   confirmed cadence, and that orphans accumulate between runs.
2. **Reclaim rule**: a key unreferenced by any source **of the same owner** for longer than
   `grace_hours` (default 24, floor 1) is deleted — including a key staged with `set_config` and
   meant to be attached later through an explicit `credentials_ref`; a source later pointed at a
   swept key reads "bearer not configured" (GetSecret `found=false`). Deletion is not reversible (no
   snapshot); the owner re-enters the bearer.
3. **Prerequisites**: psql 10 or later (`\if` and `:{?var}`); a checkout at the deployed commit; the
   DB-owner connection from `operator-db-access.md` over the **direct** port (DO `:25060`, homelab
   `:5432`) — never the pooler (`:25061` / `:6432`), never an app-console `DATABASE_URL`.
4. **Target databases**: the operator-confirmed table (database, environment, how to connect).
5. **Procedure**, every command carrying `-v ON_ERROR_STOP=1`:
   1. privilege pre-check — one query returning three `t`:
      `SELECT has_table_privilege(current_user, 'ingest.signal_sources', 'SELECT'), has_table_privilege(current_user, 'config.config_values', 'DELETE'), has_table_privilege(current_user, 'config.config_audit', 'INSERT');`
   2. confirm the database is one in the table above (`SELECT current_database();`);
   3. preview: `psql "<uri>?sslmode=require" -v ON_ERROR_STOP=1 [-v grace_hours=N] -f scripts/config-heal/mcp-credential-orphan-sweep-preview.sql`
      — read the rows and `total`;
   4. sweep: the same command with `mcp-credential-orphan-sweep.sql` — `deleted` must equal the
      preview's `total` (or be lower if a source registered in between);
   5. re-preview with the same `grace_hours` — expect 0 rows (PLAT-N1).
6. **Audit query**: `SELECT changed_at, user_id, key, environment FROM config.config_audit WHERE changed_by = 'system:config-heal-mcp-credential-sweep' ORDER BY changed_at DESC;`
7. **If the pre-check returns `f`**: stop; the role lacks cross-schema rights (design Open Risk 3) —
   record it in the feature's `context.md` and escalate; do not grant ad hoc.

Use fenced `bash` / `sql` blocks; no GNU-only flags. Do not use any phrase in `DOC_BANNED`.

**Verification**:
```bash
grep -n "^## Operator sweep: orphaned" docs/runbooks/config-rollout.md                      # 1 line, between :230 and the 041 recovery heading
grep -c "mcp-credential-orphan-sweep" docs/runbooks/config-rollout.md                       # >= 2 (preview + sweep)
grep -n "has_table_privilege\|psql 10\|system:config-heal-mcp-credential-sweep\|grace_hours" docs/runbooks/config-rollout.md
node --test scripts/config-wiring.test.mjs                                                  # banned-phrase scan green
grep -n "Step 4" docs/roadmap/features/328-fix-agent-bearer-secret-orphan/context.md        # the operator's database list and cadence are recorded
```

---

### Step 5 — service: agent bearer-write text names the orphan sweep

**Status**: `pending`
**Service**: `xstockstrat-agent`
**Files**:
- `services/xstockstrat-agent/app/tools.py` — modify
- `docs/runbooks/mcp-tools.md` — modify
- `services/xstockstrat-agent/CLAUDE.md` — modify
- `services/xstockstrat-agent/docs/context-constitution-findings.md` — modify

**Reviewers**: `xstockstrat-agent` owner — MCP tool contract stability and `docs/runbooks/mcp-tools.md`
parity; no secret values in tool output

**Codebase Evidence**:
- `_write_source_bearer` — `services/xstockstrat-agent/app/tools.py:479`; docstring `:480-483`
  ("Secret-first: a failed source write afterwards only orphans a redacted secret. The key is opaque
  (never the slug), so it cannot collide across owners or leak the source name."); key built at `:484`.
- `manage_signal_source` docstring: `credentials_ref:` param doc at `:1541-1544`; `bearer_token:`
  doc at `:1549-1553`. Call sites of the helper: `:1494-1496` (`instantiate_template`), `:1603-1605`
  (`manage_signal_source`). Neither call site changes.
- `docs/runbooks/mcp-tools.md` `### \`manage_signal_source\`` (`:867`): `credentials_ref` row `:896`,
  `bearer_token` row `:897`. The file is in the agent CI filter (`.github/workflows/ci.yml:59`).
- `services/xstockstrat-agent/CLAUDE.md:103-104` ("`manage_signal_source`/`instantiate_template`
  write a source bearer as the caller's own per-user secret under an opaque
  `ingest.mcp_credential.<uuid>` key.").
- Open finding: `services/xstockstrat-agent/docs/context-constitution-findings.md:46` (status
  **open**), report row `:81`. Closing format precedent on `:48` ("status: **closed 2026-11-19 by
  feature 360**: …").
- No test pins these docstrings verbatim (`grep -rn "only orphans a redacted\|NEVER echoed back"`
  → `tools.py` and docs only); the catalog tests read descriptions by substring
  (`tests/test_tools_endpoint.py:123`, `:166`).
- Shared file: `tools.py` is also edited by `fix-mcp-deadline-budget` and
  `fix-agent-mcp-transport-fallthrough` (`merge-order.md:404-405`) — locate the two sites by symbol.

**Lands with**: `Step 6`

**TDD**: `red-green required` — one cycle for the Steps 5–6 unit. Step 6's parity test
(`manage_signal_source` description and the runbook section both name the orphan sweep) is written
first and captured red on the tree without these edits; these edits turn it green; one commit.

**Covers**: —

**Instructions**:
Text only; no behavior, signature or return-shape change. Keep each code comment/docstring addition
to one sentence (root `CLAUDE.md` § How to Act #5).
1. `tools.py`, `_write_source_bearer` docstring: after "only orphans a redacted secret" add that the
   orphan is reclaimed by the operator orphan sweep (`docs/runbooks/config-rollout.md`). Suggested:
   "Secret-first: a failed source write afterwards only orphans a redacted secret, reclaimed by the
   operator orphan sweep (docs/runbooks/config-rollout.md)."
2. `tools.py`, `manage_signal_source` docstring, `credentials_ref:` param: append one sentence — a
   `mcp_credential.*` secret that no source of yours references for longer than the sweep's grace
   window (24h by default) is deleted by the operator orphan sweep, so attach a staged credential
   within that window. The words `orphan sweep` must appear (Step 6 asserts them).
3. `docs/runbooks/mcp-tools.md`, `manage_signal_source` table: append the same rule to the
   `credentials_ref` row, and to the `bearer_token` row add that a bearer left behind by a failed
   register is reclaimed by the orphan sweep, linking
   `[config-rollout.md](config-rollout.md#operator-sweep-orphaned-mcp_credential-secrets-feature-328)`.
   The `instantiate_template` rows (`:846`) stay as they are: they never stated the orphan trade-off,
   and the sweep is keyed on key shape, so it covers that writer too.
4. `services/xstockstrat-agent/CLAUDE.md:103-104`: append one sentence — a failed register leaves the
   secret unreferenced; the operator orphan sweep (`docs/runbooks/config-rollout.md`) reclaims it.
5. `context-constitution-findings.md:46`: change the status to
   `**closed <date> by feature 328**: accepted trade-off; the operator orphan sweep
   (`scripts/config-heal/mcp-credential-orphan-sweep.sql`, runbook `docs/runbooks/config-rollout.md`)
   reclaims unreferenced secrets`. Leave the report row at `:81` to `/sdd-archiver`.

**Verification**:
```bash
cd services/xstockstrat-agent && uv run --extra dev ruff check . && uv run --extra dev ruff format --check .
uv run --extra dev pytest -q                                   # from services/xstockstrat-agent; existing suite still green
grep -n "orphan sweep" app/tools.py CLAUDE.md docs/context-constitution-findings.md ../../docs/runbooks/mcp-tools.md
```

---

### Step 6 — test: agent writer pins (AC-1, AC-2) and docstring ↔ runbook parity

**Status**: `pending`
**Service**: `xstockstrat-agent`
**Files**:
- `services/xstockstrat-agent/tests/test_tools.py` — modify

**Reviewers**: `xstockstrat-agent` owner — MCP tool contract stability and `mcp-tools.md` parity

**Codebase Evidence**:
- Seam to extend: `tests/test_tools.py:150-197`
  (`test_manage_signal_source_mcp_client_secret_first_two_write`): `AsyncMock` on
  `client.set_config` and `client.manage_signal_source` via `patch.object` (`:165-168`), the tool
  reached with `_tool_fn(server, "manage_signal_source")(_ctx(ADMIN), …)` (`:169-178`), and the ref
  assertion `manage_mock.await_args.kwargs["credentials_ref"] == f"ingest.{sc_kwargs['key']}"` (`:192`).
- Helpers already imported: `ADMIN`, `_ctx`, `_rpc_error` from `tests.conftest` (`test_tools.py:23-29`;
  `_rpc_error(code, details="")` at `tests/conftest.py:69-73`); `_make_server` (`:33`), `_tool_fn`
  (`:39`); `ToolError` (`:19`); `grpc` is used at `:638`.
- Error mapping: `grpc.StatusCode.ALREADY_EXISTS` is in `_PASS_THROUGH_CODES` (`app/tools.py:228-239`),
  so `_grpc_error_message` (`:250`) yields a message starting `ALREADY_EXISTS:`. Both tools wrap
  `grpc.aio.AioRpcError` in `ToolError` (`:1505-1510`, `:1614-1622`).
- `instantiate_template` tool body calls `client.instantiate_template(kind, template_id,
  strategy_id=…, slug=…, credentials_ref=…)` (`app/tools.py:1498-1504`; client function at
  `app/client.py:1510`).
- Parity precedent: `tests/test_template_tools.py:261-268` (`_catalog()` from
  `tests.test_tools_endpoint` — defined at `tests/test_tools_endpoint.py:78` — plus a section split
  of `docs/runbooks/mcp-tools.md`).
- C-13: the Python fixture home `tests/conftest.py` exists; `_rpc_error`, `ADMIN`, `_ctx` come from
  it. The slug `"dup-src"` and the token literal have one consumer each (these tests) — inline.

**Lands with**: `Step 5`

**TDD**: `red-green required` — same cycle as Step 5: write these tests first and capture the parity
test red before Step 5's edits are applied (uncommitted), then apply them. The two writer pins
use the allowed escape: "red N/A — no behavior change; characterization test added" (they are green
on the pre-fix tree by design, O-19; the behavioral RED for AC-1/AC-2 is Step 2 block 1). State this
in the red→green record.

**Covers**: `AC-1, AC-2` — writer-side pins; the Then-clause RED is Step 2.

**Instructions**:
Add three tests after `test_manage_signal_source_mcp_client_secret_first_two_write`:

1. `test_failed_mcp_client_register_mints_one_secret_per_attempt` (`@AC-1`). Patch
   `client.set_config` with `AsyncMock(return_value={"version": "1", "updated_at": "…"})` and
   `client.manage_signal_source` with
   `AsyncMock(side_effect=_rpc_error(grpc.StatusCode.ALREADY_EXISTS, "signal source dup-src already exists"))`.
   Call the `manage_signal_source` tool three times with `operation="register"`, `slug="dup-src"`,
   `source_type="mcp_client"`, a `config_json` like the existing test's, and a `bearer_token`; each
   call is inside `pytest.raises(ToolError, match="ALREADY_EXISTS")`. Then assert:
   `set_config_mock.await_count == 3`; the three `kwargs["key"]` values are distinct and each
   matches `^mcp_credential\.[0-9a-f-]{36}$`; and
   `[c.kwargs["credentials_ref"] for c in manage_mock.await_args_list] == [f"ingest.{k}" for k in keys]`
   — the ref form the sweep's owner-exact stripped-key join depends on.
2. `test_failed_signal_source_instantiate_mints_one_secret` (`@AC-2`). Same shape with
   `patch.object(client, "instantiate_template", AsyncMock(side_effect=_rpc_error(ALREADY_EXISTS, …)))`;
   call the `instantiate_template` tool once with `kind="signal_source"`, `template_id="t-mcp"`,
   `slug="dup-src"`, a `bearer_token`; assert the `ToolError` (`match="ALREADY_EXISTS"`),
   `set_config_mock.assert_awaited_once()`, and
   `instantiate_mock.await_args.kwargs["credentials_ref"] == f"ingest.{key}"`.
3. `test_bearer_docs_name_the_orphan_sweep` (sync). `_catalog()["manage_signal_source"]["description"]`
   contains `orphan sweep`; the `### \`manage_signal_source\`` section of
   `docs/runbooks/mcp-tools.md` (split as at `test_template_tools.py:266`) contains `orphan sweep`
   and `config-rollout.md`.

Name the scenario in each pin's docstring (`@AC-1` / `@AC-2`, feature 328). Before accepting green,
confirm all three cases executed (tdd-gate: a green suite is not automatically coverage).

**Verification**:
```bash
cd services/xstockstrat-agent && uv run --extra dev pytest --cov=app --cov-fail-under=40
uv run --extra dev pytest -q tests/test_tools.py -k "mints_one_secret or orphan_sweep"   # 3 passed
uv run --extra dev ruff check . && uv run --extra dev ruff format --check .
grep -n "conftest" tests/test_tools.py                                                    # helpers come from the fixture home (C-13)
```
Coverage threshold: `--cov-fail-under=40` (C-08).

---

### Step 7 — service: UI secret-first hook comment names the orphan sweep

**Status**: `pending`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/src/app/config-ui/hooks/useSignalSourceMutations.ts` — modify

**Reviewers**: `xstockstrat-ui` owner — config mutation safety, no secret values rendered in UI

**Codebase Evidence**:
- `writeOwnBearerSecret` — `src/app/config-ui/hooks/useSignalSourceMutations.ts:22-32` (key
  `` `mcp_credential.${crypto.randomUUID()}` `` at `:23`, returns `` `ingest.${key}` `` at `:31`).
- The comment to edit: `:34-37`, line `:36` ends "A failed register leaves a redacted orphan."
- Consumers, unchanged: `useRegisterMcpClientSource` (`:38`, call at `:50`),
  `useInstantiateMcpSourceTemplate` (`:60`, call at `:63`).
- Pre-commit: a staged change under `services/xstockstrat-ui/` runs `pnpm --filter xstockstrat-ui run lint`
  and `scripts/check-duplication.py` (`.husky/pre-commit`).

**TDD**: `red-green required` — allowed escape: comment-only edit, no behavior change; Step 8's
Playwright pin is the characterization test.

**Covers**: —

**Instructions**:
Comment only. Replace the last sentence of the JSDoc at `:35-36` so it reads, within the existing two
lines: "A failed register leaves a redacted orphan, reclaimed by the operator sweep
(docs/runbooks/config-rollout.md)." Do not touch `writeOwnBearerSecret` or either hook. No new UI,
so C-17 and C-10(a) do not apply.

**Verification**:
```bash
cd services/xstockstrat-ui && pnpm run lint && pnpm exec tsc --noEmit
grep -n "operator sweep" src/app/config-ui/hooks/useSignalSourceMutations.ts     # 1 line
git diff --stat -- src/app/config-ui/hooks/useSignalSourceMutations.ts            # comment lines only
```

---

### Step 8 — test: Playwright pin for a failed config-ui register (AC-3)

**Status**: `pending`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/e2e/insights/signal-sources.spec.ts` — modify

**Reviewers**: `xstockstrat-ui` owner — config mutation safety, no secret values rendered in UI

**Codebase Evidence**:
- Block to extend: `test.describe('mcp_client bearer — per-user secret (feature 224)', …)` at
  `e2e/insights/signal-sources.spec.ts:201`, `const TOKEN = 'sk-live-abc123'` at `:202`; the
  register form steps at `:207-215` and the submit at `:220`
  (`page.getByRole('button', { name: 'Register', exact: true }).click()`).
- Route-fulfill seam: the `@AC-6` test at `:112-126` —
  `page.route(\`**${MANAGE_SOURCE_BFF}\`, (route) => route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ code: 'unavailable', message: '…' }) }))`.
  `MANAGE_SOURCE_BFF` at `:23`, `SET_CONFIG_BFF` at `:22`, `openPage` at `:44-50` (uses
  `addAuthCookie` from `e2e/helpers/auth.ts`).
- Error rendering: `src/app/insights/signal-sources/page.tsx:343`
  (`onError: (e) => setSaveError(errMessage(e))`) and `:822`
  (`{saveError && <p className="text-xs text-destructive">{saveError}</p>}`) — a paragraph, not an
  alert role. `errMessage` returns `ConnectError.rawMessage` (`src/lib/errMessage.ts:4`).
- Fixtures already imported from the inventory (`:4-7`, `SIGNAL_SOURCE_*`); C-12: the inline 409
  body is a scenario one-off (error payload) and stays inline; no new domain object.
- UI instantiate writer: `src/app/insights/templates/page.tsx:40` (`useInstantiateMcpSourceTemplate`)
  — **recorded intentional skip** (O-25): no pin; the sweep is keyed on key shape and covers all four
  writers.
- Playwright: `package.json:15` (`"test:e2e": "playwright test"`); project `chromium`
  (`playwright.config.ts:104-112`).

**TDD**: `red-green required` — allowed escape: "red N/A — no behavior change; characterization test
added" (green on the pre-fix tree by design, O-19; the Then-clause RED for AC-3 is Step 2 block 1).

**Covers**: `AC-3` — writer-side pin; the Then-clause RED is Step 2.

**Instructions**:
Inside the feature-224 `describe` block add
`test('@feature-328 @AC-3 a failed mcp_client register shows the error and writes exactly one secret', …)`:
1. Count `/SetConfig` requests: `let setConfigCalls = 0; page.on('request', (r) => { if (r.url().endsWith('/SetConfig')) setConfigCalls += 1; });`
2. `await page.route(\`**${MANAGE_SOURCE_BFF}\`, (route) => route.fulfill({ status: 409, contentType: 'application/json', body: JSON.stringify({ code: 'already_exists', message: 'signal source dup-src already exists' }) }));`
3. `await openPage(page);` then fill the register form exactly as `:207-215` does, with slug
   `dup-src`, and click `Register`.
4. Assert `await expect(page.getByText('signal source dup-src already exists')).toBeVisible();`
   (text, not `getByRole('alert')` — see evidence), the form is still open
   (`page.getByLabel('Bearer token')` has count 1), `expect(setConfigCalls).toBe(1)`, and the page
   body does not contain `TOKEN`.

Do not add a second `SetConfig` route; the real BFF answers it as in the existing test at `:217-218`.
No `mock-backend.ts` change.

**Verification**:
```bash
cd services/xstockstrat-ui && pnpm exec playwright test e2e/insights/signal-sources.spec.ts --project=chromium --grep "@feature-328"   # 1 passed
pnpm exec playwright test e2e/insights/signal-sources.spec.ts --project=chromium                                                      # whole file green
pnpm run lint
grep -n "from '../fixtures'\|helpers/auth" e2e/insights/signal-sources.spec.ts                                                        # inventory + auth helper imports (C-12)
```
No coverage threshold applies to the UI e2e suite; `INVENTORY.md` is unchanged (no fixture added).

---

### Step 9 — docs: remaining "orphan accepted" text, author sentinel, ledger note

**Status**: `pending`
**Service**: `docs/patterns/`, `services/xstockstrat-ingest/CLAUDE.md`, `docs/roadmap/ledger/`
**Files**:
- `docs/patterns/config-governance.md` — modify
- `docs/patterns/inter-service-mtls.md` — modify
- `services/xstockstrat-ingest/CLAUDE.md` — modify
- `docs/roadmap/ledger/insights.md` — modify

**Reviewers**: none

**Codebase Evidence**:
- `docs/patterns/config-governance.md`: author-sentinel table header `:138`, rows `:140-144` (last
  row `system:config-migration-feature-330`); feature-224 block `:461-467` (heading `:461`; "written
  secret-first by the owner via `SetConfig(is_secret=true, create_key=true, user_id=<owner>)`" at
  `:466-467`); feature-166 dynamic-secret-family sentence `:672-676` (section heading `:663`).
- `docs/patterns/inter-service-mtls.md:58` ("config `GetSecret` ← `xstockstrat-ingest`, for the
  `ingest` caller's `mcp_credential.*` keys").
- `services/xstockstrat-ingest/CLAUDE.md:178-186` (the "`mcp_client` bearer secret" note; "written
  secret-first as the caller's own row" at `:181`).
- `docs/roadmap/ledger/insights.md:2836-2843` (2026-09-02 — 166-mcp-client-signal-source — design:
  "skip the compensating saga because a failed register leaves only a harmless *redacted* orphan
  secret").
- `config-governance.md` is scanned by `scripts/check-config-wiring.mjs:856-864` (`DOC_RULES`,
  `DOC_RULE_SENTENCES`, `DOC_BANNED`).
- Site list checked repo-wide on `origin/main-dev@fb52065c` (`git grep -n -i -E "orphan|secret-first"`,
  excluding feature directories, reports and generated code). The design's citations
  (`config-governance.md:318,525`, agent `CLAUDE.md:175`) do not mention `mcp_credential`; the sites
  above do. Hits that state the accepted orphan are all owned by a step: `tools.py:482` (Step 5),
  `useSignalSourceMutations.ts:35-36` (Step 7), `insights.md:2837-2842` (item 6), agent findings
  `:46` (Step 5). Hits that say only "secret-first" and make no orphan claim are left unchanged:
  `docs/runbooks/mcp-tools.md:902`, `src/app/insights/signal-sources/page.tsx:322`,
  `services/xstockstrat-agent/tests/test_template_tools.py:4`, `.gitleaks.toml:20`.
  `docs/repo-surveyor/debt-radar-findings.md:553` (an open question about the UI docstring) is a
  surveyor log, outside this feature's file set; it is carried as an Open Thread in `context.md`.

**TDD**: `N/A (docs)`

**Covers**: —

**Instructions**:
1. `config-governance.md` author-sentinel table: add a row after `:144` —
   `| \`system:config-heal-mcp-credential-sweep\` | operator SQL (\`scripts/config-heal/mcp-credential-orphan-sweep.sql\`) | Not a SetConfig write: the operator orphan sweep's \`config_audit.changed_by\` for each deleted per-user \`ingest\` / \`mcp_credential.*\` secret (\`new_value\` NULL, \`old_value\` the \`[redacted]\` sentinel, \`caller_identity\` NULL); feature 328 |`
   (O-20, C-10(c)).
2. `config-governance.md:461-467` (feature 224): append one sentence — a secret left unreferenced by
   a failed register is reclaimed by the operator orphan sweep (runbook `docs/runbooks/config-rollout.md`).
3. `config-governance.md:672-676` (feature 166): append "+ reclaimed by the orphan sweep (runbook)"
   to the dynamic-secret-family sentence.
4. `inter-service-mtls.md:58`: append that unreferenced `mcp_credential.*` rows are reclaimed by the
   operator orphan sweep (runbook), which changes no grant.
5. `services/xstockstrat-ingest/CLAUDE.md:178-186`: append one sentence to the bearer note — a
   secret no source of the same owner references is reclaimed by the operator orphan sweep after its
   grace window (`docs/runbooks/config-rollout.md`).
6. `docs/roadmap/ledger/insights.md:2836-2843`: append one bullet to the feature-166 entry —
   "**Update (feature 328)**: the accepted orphan is reclaimed by the operator orphan sweep
   (`scripts/config-heal/mcp-credential-orphan-sweep.sql`); secret-first still stands." Edit the
   existing entry only; any new lesson from execution is a separate ledger line.

`acceptance.feature` is not edited (O-9). Do not use any `DOC_BANNED` phrase.

**Verification**:
```bash
grep -c "orphan sweep" docs/patterns/config-governance.md                    # >= 2
grep -n "system:config-heal-mcp-credential-sweep" docs/patterns/config-governance.md
grep -n "orphan sweep" docs/patterns/inter-service-mtls.md services/xstockstrat-ingest/CLAUDE.md docs/roadmap/ledger/insights.md
node --test scripts/config-wiring.test.mjs                                    # doc-rule and banned-phrase scans green
# No missed site: every hit is a file edited by Steps 5, 7 or 9, or one of the four "secret-first only" sites in Codebase Evidence
git grep -n -i -E "orphan|secret-first" -- . ':!docs/roadmap/features' ':!docs/reports' ':!packages/proto/gen' | grep -i -E "mcp_credential|secret-first|bearer|redacted"
```

---

## Deviation Log

_Populated by /sdd-execute as implementation proceeds._
