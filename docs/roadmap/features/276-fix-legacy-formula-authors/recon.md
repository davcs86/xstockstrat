# Recon: fix-legacy-formula-authors

**Created**: 2026-10-22
**From**: product-spec.md
**Affected services**: xstockstrat-indicators

---

## Objective

Rewrite every `indicators.formulas.author` that holds a legacy username (not a user id, not the reserved `system` author) to the owning user's id, so the owner can list, read and execute their formulas again and strategies that reference them evaluate. Production has not been checked, so the row count and the set of usernames are unknown; the six staging ids are a floor. The read guard, admin `author_filter` behavior and 275's reporting changes are out of scope.

## Codebase Map

- **`xstockstrat-indicators`** (Python 3.13, gRPC 50054)
  - Entry point: `services/xstockstrat-indicators/app/main.py:62` (`await seed_default_formulas(db_pool)` runs after the pool is created; non-fatal, idempotent startup hook — `app/services/seed_formulas.py`).
  - Handler/servicer: `services/xstockstrat-indicators/app/handlers/servicer.py`
    - `_reader` `:120` (x-user-id only; empty is UNAUTHENTICATED; `system` needs an internal grant `:126-128`).
    - `_internal_grant` `:133` (`x-internal-caller` AND mTLS peer SAN `xstockstrat-analysis`; the only grant constant is `_SYSTEM_IDENTITY_GRANT` `:29`).
    - `_can_read_formula` `:141` (owner or `SYSTEM_AUTHOR`; **do not edit**, FR-6). Callers: `ExecuteFormula` `:243`, `GetFormula` `:442`.
    - `ExecuteFormula` read failure: admin gets PERMISSION_DENIED `:245-250`, non-admin NOT_FOUND `:251-253`.
    - `ListFormulas` filter `:469` (`f.author == owner if admin_selector else f.author in (reader, SYSTEM_AUTHOR)`); the admin `author_filter` selector is documented at `:460-461`.
    - Write paths refuse system rows and require `user_id == author`: `UpdateFormula` `:496,:504`, `DeleteFormula` `:599,:607`.
    - `ManageTemplate` `:622-628` is the existing ADMIN-scope-gated RPC (`_has_admin_scope` `:110`) — the only precedent for an admin-gated mutation; admin audited-read pattern lives in `app/admin_audit.py` (fails closed `UNAVAILABLE`).
  - Repository: `services/xstockstrat-indicators/app/services/formulas_repository.py`, `FormulasRepository` `:117`.
    - `get_by_id` `:183` selects `*` with **no `deleted_at` filter** — soft-deleted rows are visible to a raw `UPDATE` (FR-2 requires covering them).
    - `_UPDATE_SQL` `:74` never sets `author`, so owner updates cannot clobber an author; the seed upsert `:64` does set `author = EXCLUDED.author` (system seed only).
    - `resolve_intent` `:137-149` is the existing `UPDATE ... WHERE author = $2 RETURNING formula_id` compare-and-set pattern; `create_pending_copies` `:127` shows the `async with self._db.acquire() as conn, conn.transaction():` pattern.
    - `list_visible` `:190-195` and `list_owned` `:198-201` filter `deleted_at IS NULL`.
  - Last migration: `007_private_formulas_templates.up.sql` (`services/xstockstrat-indicators/migrations/`). Next free number is `008`. Migrations `001`–`007` each have `.up.sql` + `.down.sql`.
  - Config-read pattern: none needed (no config key expected).
  - Other key symbols: `SYSTEM_AUTHOR = "system"` — `app/formulas/__init__.py:5`; schema: `author TEXT NOT NULL` + `CREATE INDEX ON indicators.formulas (author)` — `migrations/001_formulas.up.sql:8,15`; `deleted_at` + partial index `idx_formulas_author_live` — `migrations/005_add_formula_soft_delete.up.sql:5,9-11`; `pending_intent_id` + `idx_formulas_pending_intent` — `migrations/007_private_formulas_templates.up.sql:32-34`.
- **`xstockstrat-identity`** (Node, read-only consult — not modified): `User` message has `user_id`, `email`, `roles`, `is_active`, `created_at` and **no username** — `packages/proto/identity/v1/identity.proto:174-180`; `identity.users.email TEXT NOT NULL UNIQUE` — `services/xstockstrat-identity/migrations/001_identity_tables.up.sql:8`. RPCs: `ListUsers`/`GetUser` — `identity.proto:41-42`. A grep for `username|user_name` in `identity.proto` returns nothing.

## Patterns to REUSE

- **Operator-supplied username to user-id map applied at migration time** → reuse the generic `-- requires-env: VAR[,VAR]` header rendered by `scripts/render-migrations.sh` (envsubst restricted to the named vars, fails if unset or empty), wired into `scripts/db-migrate.sh` `up` (`render-migrations.sh` call after the analysis 013 special case, ~`:93-96`). Live precedent: `services/xstockstrat-ingest/migrations/013_signal_ownership_templates.up.sql:1` (`-- requires-env: SEED_USER_ID`, `UPDATE ... SET user_id = '${SEED_USER_ID}'` at `:28`). The env var must be wired at all run sites in the same change (fails.md 2026-08-19 strategy-user-ownership/config): `docker-compose.yml:103` (concrete default `80880990-2b79-4d85-8761-d8d9102c2efb`), `.do/app.dev.yaml:680`, `.do/app.yaml:678` (migrator job env).
- **Idempotent data-rewrite inside a migration** → `DO $$ ... UPDATE ... $$` guarded block, `services/xstockstrat-indicators/migrations/007_private_formulas_templates.up.sql:3-14` (comment `:3-4`: must stay idempotent because `db-migrate.sh` dirty recovery replays from `001`).
- **Per-row compare-and-set against concurrent writers** → `UPDATE indicators.formulas SET author = $new WHERE formula_id = $1 AND author = $legacy`, modeled on `resolve_intent` (`formulas_repository.py:137-149`). Row-level; no advisory locks or session state because indicators runs behind PgBouncer transaction pooling (`:25061`, `statement_cache_size=0`).
- **Admin-gated mutating RPC (only if design picks an RPC)** → mirror `ManageTemplate` ADMIN gate (`servicer.py:622-628`) as a **separate additive RPC**, never a path through `UpdateFormula`/`DeleteFormula`; admin-audit pattern `app/admin_audit.py`.
- **Operator CLI (if design picks a script)** → `scripts/manage-users.py` (Typer + `psycopg`, run via `uv run`), the repo's existing operator-tool shape.
- **Startup hook (alternative)** → `seed_default_formulas` call at `app/main.py:62`.
- **Test harness** → `tests/conftest.py:21` `ctx_with(metadata, peer_sans=())`; authz test model `tests/test_formula_read_authz.py:31` (`TestGetFormulaAuthz`) and `:102` (`TestExecuteFormulaAuthz`); other relevant files `test_private_formulas.py`, `test_formulas.py`, `test_owner_scoped_completeness.py`, `test_formula_templates.py`. Run: `uv run pytest --cov=app --cov-fail-under=50`.
- **Gherkin home** → `services/xstockstrat-indicators/acceptance/*.feature` (e.g. `private-by-default-templates.feature`), promoted at launch (C-16).

## Existing Business Rules (preserve / extend)

Suites read in full: `docs/sdd/business-rules/platform.feature`, `services/xstockstrat-indicators/acceptance/private-by-default-templates.feature`, `.../private-by-default-enforce-contract.feature`; the other 6 indicators suites scanned by grep (no author/ownership subject). No CHANGE flags: no existing `@AC-*` guarantees that a legacy-username author stays unreadable by its owner.

- **PRESERVE** `@AC-1` "Another user's formulas are invisible even if formerly public" (`services/xstockstrat-indicators/acceptance/private-by-default-templates.feature`) — non-owner `GetFormula`/`ExecuteFormula` stay NOT_FOUND after repair (feature AC-6).
- **PRESERVE** `@AC-2` "ListFormulas returns only the caller's own and system formulas" (same file) — repaired formulas appear in the owner's list only.
- **PRESERVE** `@AC-4` "Body author cannot impersonate another user or the system" (same file) — author comes from the `x-user-id` header only; the fix adds no caller-supplied author path.
- **PRESERVE** `@AC-22` "Migration preserves data and makes public formulas private" (same file) — scoped to migration 007 ("source and author unchanged"). If the fix ships as migration 008 the author rewrite is a deliberate, separate data change; design must state it does not violate `@AC-22` and give the `.down.sql` a defined meaning.
- **PRESERVE** `@AC-28` "Admins can read but not change another user's objects" (same file) — a rewrite mechanism must not be an admin write on the formula RPCs; admin `ExecuteFormula` stays PERMISSION_DENIED. Root cause of the staging symptom is consistent with this rule (the admin sees the legacy rows only via `author_filter`).
- **PRESERVE** `@AC-1` "A headerless owner-scoped call is rejected in indicators" (`.../private-by-default-enforce-contract.feature`) — any new RPC keeps the `x-user-id` identity gate.
- **PRESERVE** `@AC-2` "The analysis formula-read bypass is gone" (same file) — strategies must start evaluating because ownership is fixed, not through an `x-internal-caller` bypass.
- **PRESERVE** `@AC-10` "An identified non-owner keeps the non-owner result" (same file) — non-owner `GetFormula` stays NOT_FOUND.
- **PRESERVE** `@AC-11` "indicators no longer writes is_public, so the column can be dropped later" (same file) — the rewrite statement must not reference `is_public`.
- **PRESERVE** `@AC-6` "The fundamentals loop still runs the system scoring formula" (`docs/sdd/business-rules/platform.feature`) — rows with author `system` are never rewritten (FR-7).
- **PRESERVE** `@AC-23` "System special-cases are unchanged" (same file) — `UpdateFormula` on a system formula stays PERMISSION_DENIED.
- **PRESERVE** `@AC-18` "Strategy template instantiation deep-copies referenced formulas" and `@AC-19` "A failed deep copy leaves nothing behind" (same file) — pending-intent rows (`pending_intent_id` set) are authored by the instantiating user's id and must not be detected as legacy or disturbed; the abort hard-delete path is untouched.
- **EXTEND** (proposed, for design/spec): new scenarios for legacy-author rewrite, unmappable/ambiguous report-and-leave, idempotence and system-author exclusion are already drafted as feature 276 `@AC-1`..`@AC-9` in `docs/roadmap/features/276-fix-legacy-formula-authors/acceptance.feature`; they promote into the indicators suite at launch (C-16).
- Not impacted: `analysis-concurrency-offload`, `fix-python-config-zero-trap`, `indicators-sandbox-os-isolation`, `fix-indicators-sandbox-matrix` (sandbox/config subjects); `private-by-default-templates` `@AC-3`, `@AC-13`, `@AC-14`, `@AC-16`, `@AC-17`, `@AC-31` (is_public/template catalog); `fundamentals-formula-inputs` `@AC-6` and `formula-fundamental-inputs-authoring` `@AC-1` (write-time validation — relevant only if design reuses `UpdateFormula` for the rewrite, which it should not).
- Coverage gap: downstream consumer `xstockstrat-analysis` is not an affected service; its suites were not read.

## Dependencies

- Proto/RPC: none required. Identity `User` has no username (`identity.proto:174-180`), so an identity `ListUsers`/`GetUser` lookup cannot resolve a legacy username (OQ-1). A resolver would need an email-prefix heuristic (a guess; conflicts with FR-3), an operator-supplied map, or a new additive identity field/RPC. Indicators has 13 RPCs (`packages/proto/indicators/v1/indicators.proto:16-51`), none a rewrite/repair RPC; an admin RPC would be an additive indicators proto change (`buf lint` + `buf breaking`, `./scripts/buf-gen.sh`).
- Migration: next number `008` for `services/xstockstrat-indicators/migrations/` (re-derive at spec time; concurrent features 268/269/244 touch indicators, fails.md 2026-08-06 migration entries). Needs `008_*.up.sql` + `.down.sql`, DBA + service-owner gate; down needs a defined meaning (e.g. documented no-op, since the original username is lost unless the migration records it).
- Config keys: none expected.
- Inter-service edges: none today. Indicators has no identity client and no `IDENTITY_ENDPOINT` (only caller-identity and peer-SAN code); adding one would be a new edge and must propagate `x-user-id`/`x-access-scope`/`x-trace-id` (C-03, operator standing instruction 2026-10-21: request-derived work uses the inbound metadata, no fresh context; a startup/background task with no originating request may mint its own context and should carry a trace id when available).
- New env vars / ports: a mapping variable (name TBD by design) would be new. `SEED_USER_ID` already exists in `docker-compose.yml:103`, `.do/app.dev.yaml:680`, `.do/app.yaml:678` (migrator env, comment "Operator-supplied (not invented); may differ per environment"). Any new variable must be added to all three run sites plus `.env.example`/setup-env in the same change.

## Risks / Not-found

- **OQ-1 blocker**: no username to user-id source exists anywhere in identity (proto or migrations). The mapping must be operator-supplied, or identity must gain an additive field. Not decidable from code; design must resolve (C-11, P-03).
- **Production unknown (OQ-2)**: no read-only count has been taken; the design must treat the prod row count and usernames as unknown and must not assume the six staging ids are complete. No data change during speccing.
- A pure-SQL migration cannot call identity; a map embedded in the migration file would be static and committed. Env-templated (`requires-env`) migrations fail the whole migrator job when the variable is unset, so an unset variable in prod blocks every indicators migration (fails.md 2026-08-19: give local dev a concrete default and wire all three run sites).
- **Soft-deleted rows**: `get_by_id` has no `deleted_at` filter and FR-2 requires them covered; list paths filter `deleted_at IS NULL`, so detection must not reuse the list queries.
- **Concurrency (FR-7)**: owner `UpdateFormula` does not set `author` (`_UPDATE_SQL` `:74`) so it cannot clobber, but a compare-and-set `WHERE author = $legacy` is still needed so a row an owner changed is a no-op (AC-8). Whether to touch `updated_at` is a design choice (AC-4 only requires untouched rows keep theirs). PgBouncer transaction pooling rules out advisory locks and session state.
- **Down migration** for a data rewrite loses the original username unless recorded; design must decide (documented no-op vs a one-column audit/backup).
- **Delivery-shape tradeoff**: migration (versioned, runs once per env, no new authorization surface, cannot call identity) vs startup hook (`seed_formulas` pattern, reruns each boot) vs admin RPC (new authorization surface, conflicts with the "no admin override for writes" rule in `services/xstockstrat-indicators/CLAUDE.md` unless kept a separate additive RPC) vs operator script (`manage-users.py` shape). Read-only report mode (FR-5) fits a script or RPC better than a migration; a migration can still `RAISE NOTICE` counts as `ingest 013` does (`:80`).
- **No existing detection/report code** for non-user-id authors; **no existing admin/operator repair RPC or script** in indicators.
- OQ-4: a write-time guard so new rows cannot carry a non-user-id author. Write paths take the author from the `x-user-id` header (`@AC-4`), so no live non-user-id write path was found; confirm at design. `x-user-id` is not validated as a UUID today (not verified beyond `_reader` `:120-131`).
- Applicable `fails.md` traps: 2026-08-06 migration "always `ls migrations/` before writing a number into any spec" and "reserve next-free shared migration numbers at design time"; 2026-08-19 strategy-user-ownership/config (wire a new migration env var into compose default, `.do/app*.yaml` and setup-env together; never bare `envsubst` on `$$` blocks); 2026-08-14 strategy-user-ownership/assumption ("already handles this" claims were disproved by code read each round — re-grep before asserting).
- Overlap (rebase-only): `servicer.py` with 268, 269, 244, 275; 276 must not edit `_can_read_formula` (FR-6). Not verified here: `strat-lab` `backtest` skill quirks (carried deferred check, C-14) and that no UI code changes.
- Digest 1 did not read `servicer.py` bodies beyond cited lines; `seed_formulas.py` and `admin_audit.py` bodies were not read here.

## Recommended Scope

Advisory, not binding:
1. Indicators-only data fix; no read-guard, proto-for-identity, UI or agent change.
2. Decide at design: mapping source (operator-supplied map vs additive identity change; leaning operator-supplied because identity has no username), delivery shape (migration `008` with `requires-env` vs operator script/RPC), report-only mode for FR-5, handling and down-migration meaning.
3. Detection predicate: `author <> 'system'` and not a user id (including soft-deleted rows), compare-and-set `WHERE formula_id = $1 AND author = $legacy`, per-run counts (rewritten / unmappable / already clean), unmappable and ambiguous left unchanged and listed.
4. Tests: pytest in `tests/` modeled on `test_formula_read_authz.py`, covering AC-1..AC-9; promote scenarios to `acceptance/` at launch; update `services/xstockstrat-indicators/CLAUDE.md` migration list and `docs/context-constitution.md` if a new invariant lands.
