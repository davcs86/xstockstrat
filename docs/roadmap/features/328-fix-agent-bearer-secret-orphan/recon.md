# Recon: fix-agent-bearer-secret-orphan

**Created**: 2026-11-11
**From**: product-spec.md
**Tree**: detached @ c4fd48b0a ≡ origin/main-dev (no `feature/fix-agent-bearer-secret-orphan` branch on origin yet). The discovery digests were UNSTAMPED; I re-grepped every cite below against this tree.
**Affected services**: xstockstrat-agent, xstockstrat-config, xstockstrat-ingest, xstockstrat-ui

---

## Objective

Two paths write the bearer as a per-user encrypted config secret `mcp_credential.<uuid>` under namespace `ingest` before they call ingest. The agent `manage_signal_source register` (mcp_client) / `instantiate_template` (signal_source) is one; the config-ui register/instantiate hooks are the other. If ingest then fails, the secret is left orphaned, and each retry mints another orphan.

The operator ruled **sweep** on 2026-11-10. The secret-first order stays. A sweep deletes the `ingest`/`mcp_credential.*` secret rows that no `ingest.signal_sources.credentials_ref` references. There is no new RPC and no proto change. Where and how the sweep runs (OQ2) is the design decision. AC-4 requires that the sweep never delete a referenced secret.

## Codebase Map

- **`xstockstrat-agent`** (Python)
  - Secret-first writer: `_write_source_bearer` — `services/xstockstrat-agent/app/tools.py:399`.
    - The docstring "a failed source write afterwards only orphans a redacted secret" is at `:402`.
    - The key `f"mcp_credential.{uuid.uuid4()}"` is built at `:404`.
  - Orphan site 1: `instantiate_template` calls `_write_source_bearer` at `tools.py:1393`. The ingest call follows in a `try` whose `except grpc.aio.AioRpcError` only raises `ToolError` (`:1396-1408`). There is no cleanup.
  - Orphan site 2: `manage_signal_source register` (mcp_client) calls it at `tools.py:1484`. The ingest call follows with the same re-raise-only `except` (`:1487-1503`).
  - Key-shape docs: `tools.py:1446` and `services/xstockstrat-agent/app/client.py:2311` (`set_config` helper docstring). Neither was re-read beyond the grep hit.
  - Last migration: none (the agent has no DB).
  - Open finding that names this exact gap: `services/xstockstrat-agent/docs/context-constitution-findings.md:44` (status **open**), with the report row at `:78`.
  - Tests:
    - `services/xstockstrat-agent/tests/test_tools.py:178` asserts the `mcp_credential.` key prefix.
    - `tests/test_template_tools.py:20` holds the uuid-key regex (digest cite, not re-read).
    - `tests/test_tool_deadlines.py:341,371` wraps `_write_source_bearer` → `set_config`.
- **`xstockstrat-config`** (Node.js)
  - The RPCs are `WatchConfig`, `GetConfig`, `ListKeys`, `SetConfig` and `GetSecret`. There is **no delete RPC** (`services/xstockstrat-config/CLAUDE.md`, invariants list).
    - Per-user writes are owner-only. The ADMIN bit gives no override on another user's per-user row (digest; `CLAUDE.md:37` covers the global-write rule).
  - Ingest `GetSecret` grant: `keyPrefixes: ['mcp_credential.']` at `services/xstockstrat-config/src/grpc/authz.ts:146`. It is bound to the peerSan `xstockstrat-ingest`, with exact `user_id` scope.
  - Timers: the only ones are listener `setInterval`s, `livenessTick` and `backstop`, at `src/grpc/configServiceImpl.ts:245-246`. Config has **no periodic job**, and it cannot watch itself (CLAUDE.md invariant #1).
  - Last migration: `047_config_alias_removal_rows.up.sql` (`services/xstockstrat-config/migrations/`). Next is **048**.
  - Catalog row for the key family: `migrations/041_heal_config_keys_to_reader_catalog.up.sql:138` (`('ingest', 'mcp_credential.', 'prefix', ...)`). The bearer itself is not seeded (`025_ingest_mcp_client_keys.up.sql:20`, digest cite).
  - pg_notify contract: **CONFIG-4** (`services/xstockstrat-config/docs/context-constitution.md:21`). The `config_changed` payload must carry `{namespace, key, environment, user_id}`, and a missing `environment` defaults to `'staging'`.
- **`xstockstrat-ingest`** (Python)
  - Reference column: `credentials_ref TEXT` on `ingest.signal_sources` — `services/xstockstrat-ingest/migrations/002_add_signal_sources_registry.up.sql:12`.
    - `user_id` was added in `013_*.up.sql:22-28`, with `system` for derived sources and the seed user otherwise.
    - The PK became `(user_id, slug)` (ingest CLAUDE.md, per digest).
  - Stored ref form: `ingest.mcp_credential.<uuid>`. `split_credentials_ref` (`app/config/watcher.py:22-24`) splits it on the first dot into `('ingest', 'mcp_credential.<uuid>')`.
  - Consumer: `poll_one_source` (`app/engine/mcp_client_loop.py:134-140`) **discards the namespace half** (`_namespace, key = split_credentials_ref(...)`). This is the open finding at `services/xstockstrat-ingest/docs/context-constitution-findings.md:36`.
  - Repo reads: `app/repositories/signal_sources.py:52` (column list incl. `credentials_ref`), `:58` `list_all_sources`, `:127` `get_source`. Ingest has no config write or delete path.
  - Handlers (digest cites, not re-read): `app/handlers/servicer.py:1377` (credential-required check), `:1433` (ManageSignalSource register), `:1515` (`_register_source`) and `:1639` (instantiate).
  - Last migration: `014_contract_signal_ownership.up.sql`. Next is **015** (not expected to be needed).
- **`xstockstrat-ui`** (Next.js)
  - Secret-first hook: `writeOwnBearerSecret` at `services/xstockstrat-ui/src/app/config-ui/hooks/useSignalSourceMutations.ts:22-32`. It builds the key `` `mcp_credential.${crypto.randomUUID()}` `` at `:23` and returns `` `ingest.${key}` ``.
    - The note "A failed register leaves a redacted orphan" is at `:35-36`.
    - Consumers (digest cites): `useRegisterMcpClientSource` (`:38`), `useInstantiateMcpSourceTemplate` (`:60`), `src/app/insights/signal-sources/page.tsx:190` and `src/app/insights/templates/page.tsx:40`.
  - BFF gate: `src/lib/insightsBff.ts:180-182`. Only ingest `mcp_credential.*` per-user secrets may be written there, and there is no delete path.
  - Tests:
    - `src/lib/insightsBff.test.ts:25,80`.
    - e2e `e2e/insights/signal-sources.spec.ts:203,227` (key regex `^mcp_credential\.[0-9a-f-]{36}$`).
    - Mock config backend `e2e/mock-backend.ts:1514`.
- **Cross-service knower of the prefix** (not an affected service): `services/xstockstrat-indicators/app/maintenance/config_inventory.py:42`, `SECRET_KEY_PREFIXES = {("ingest", "mcp_credential.")}`.

## Patterns to REUSE

- **Destructive config row delete** → reuse the single latched, data-modifying CTE in `services/xstockstrat-config/migrations/046_config_dead_rows_prune.up.sql:5-30`. Its steps:
  - a `latch` CTE on `config.config_markers`;
  - `DELETE FROM config.config_values ... RETURNING`;
  - a snapshot into `config.config_values_premigration_296`;
  - a `config.config_audit` row with a number-free actor `system:config-migration-feature-<slug>`;
  - a `config.config_keys_report_296` row;
  - `pg_notify('config_changed', ...)`.

  The ledger rule says to use one latched statement, with no `LOCK TABLE` and no data-dependent RAISE (insights.md 2026-11-10 config-dead-rows-prune — design, ~L4528-4536). The predicate must be **inverted** from 046 (`user_id IS NULL AND NOT is_secret`): it needs `is_secret AND user_id IS NOT NULL AND namespace='ingest' AND key LIKE 'mcp_credential.%'`.
- **Cross-schema read precedent** → the portfolio `backfill-signal-expiry` subcommand reads `ingest.newsletter_signals` read-only, cross-schema (`docs/patterns/database.md:20`). All services share one TimescaleDB with per-service schemas (`database.md:3`), and docker-compose uses one `xstockstrat` DB user (`docker-compose.yml:27`).
- **Orphan predicate join** → match `config.config_values.user_id = signal_sources.user_id` **and** `'ingest.' || key = credentials_ref`. Matching on the namespace-relative key is the feature-296 rule.
  - Because `poll_one_source` drops the ref's namespace, a hypothetical non-`ingest.`-prefixed ref would still resolve under `ingest`. A strict full-string match could therefore delete a secret that is live in practice.
  - The design must pick between a full-string match and a stripped-key match (`split_credentials_ref` semantics).
- **Migration SQL tests** → `services/xstockstrat-config/src/__tests__/migrationSql.ts` (`findOne`), plus the pinned-sha/signoff pattern in `deadRowsMigration.test.ts:9-24` (`scripts/config-heal/signoff.md`).
- **Offline SQL verification** → `scripts/migration-rerun.sh` pass 2d (pglast parse) and `scripts/migration-assertions/config-046.sql` (insights.md 2026-11-10, ~L4547-4551).
- **Agent test seam** → `AsyncMock` on `client.set_config` in `tests/test_tools.py:147-178`.

## Existing Business Rules (preserve / extend)

- **PRESERVE** `@AC-1` "Register an MCP client signal source with endpoint and tool" (`services/xstockstrat-ingest/acceptance/mcp-client-signal-source.feature`). A successful secret-first register is unchanged.
- **PRESERVE** `@AC-2` "Bearer token is stored encrypted and never returned on a read edge" (same file). The sweep must not leak the secret or alter it.
- **PRESERVE** `@AC-3` "Ingest resolves the bearer token via GetSecret and sends it as an Authorization header" (same file). A referenced credential must still authenticate after the sweep; the new AC-4 restates this.
- **PRESERVE** `@AC-6` "Registration without an MCP endpoint is rejected fail-closed" (same file). The failure result is unchanged. The orphan it leaves is what the sweep removes.
- **PRESERVE** `@AC-35` "Two users with the same mcp_client slug use their own credentials" (`docs/sdd/business-rules/platform.feature`). The sweep must be exact per-user scope and never touch another owner's row or a global row.
- **PRESERVE** `@AC-36` "System slugs are reserved in both directions" (`docs/sdd/business-rules/platform.feature`). The ALREADY_EXISTS mapping is unchanged.
- **PRESERVE** `@AC-4` "An agent tool's SetConfig carries no free-text author and forwards the caller as x-user-id" (`services/xstockstrat-agent/acceptance/fix-config-audit-author-spoof.feature`).
- **PRESERVE** the following rules in `services/xstockstrat-config/acceptance/config-secrets-and-scoping.feature`:
  - `@AC-1`, `@AC-1b`: encrypted at rest; `is_secret` is row-authoritative.
  - `@AC-2`, `@AC-3`, `@AC-14`: redaction at every edge. A delete DELTA must not leak plaintext.
  - `@AC-4`, `@AC-5`: the GetSecret allow-list and peer SAN. The sweep must not widen secret-read authority.
  - `@AC-16`: GetSecret `found=false` vs INTERNAL. A swept credential reads as not-configured.
  - `@AC-11`, `@AC-13`: per-user override and the per-user overlay.
- **PRESERVE** the feature 295/296 key rules (`services/xstockstrat-config/acceptance/fix-config-keys-drift.feature`, `config-keys-alias-removal.feature`). Keys are namespace-relative, and a prefixed key is INVALID_ARGUMENT. These are cited at file level only; the individual @AC lines were not read.
- **PRESERVE** `@AC-4`, `@AC-5`, `@AC-6`, `@AC-8` (`services/xstockstrat-config/acceptance/fix-edge-owner-scope.feature`). Non-admin `list_config_keys` is caller-bound, and feature AC-1..3 observe through it.
- **EXTEND (if the sweep lives in config)**: a new delete path would sit alongside config-secrets-and-scoping @AC-2/3/4/5. It needs adversary checks; it does not need CHANGE sign-off.
- xstockstrat-ui has no existing acceptance scenario for the signal-source hook or the secret flow.
- No CHANGE flags. No existing scenario encodes "orphans accepted", so no sign-off is needed.

## Dependencies

- Proto/RPC: none (operator ruling 2026-11-10; no delete RPC).
- Migration:
  - Config next is `048` (`services/xstockstrat-config/migrations/`), if the sweep ships as a data migration.
  - Ingest next is `015`, but it is not expected to be needed.
- Config keys: none new. A recurring sweep could need an interval/grace key, which would be a new key (governance gate). That gap is open for design.
- Inter-service edges: none new for a SQL sweep. An ingest-driven sweep would need a config delete capability that does not exist.
- New env vars / ports: none.

## Risks / Not-found

- **One-shot vs recurring.** A latched 048 migration clears only the orphans that exist when it runs; orphans minted afterwards survive. Config has no scheduler (`configServiceImpl.ts:245-246` only has listener timers), and ingest has loops but no right to delete config rows. OQ2 has to choose among three options, or a combination of them:
  - a one-off migration;
  - an operator runbook or script, which can re-run;
  - a new periodic job, which would be new mechanism (weigh against C-18 YAGNI).
- **In-flight race.** A secret is unreferenced between the `SetConfig` and the ingest register. Any sweep that can run while traffic flows needs an age grace on `config_values.created_at`/`updated_at` (both columns exist, per the 046 `RETURNING` list). Otherwise it can delete a secret whose source registers a moment later, and that breaks AC-4 / ingest @AC-3.
- **Cross-schema read rights in prod: NOT verified.** Locally there is one DB and one user. On DO, migrations run via the `db-migrator` job (direct `:25060`). Whether its role can `SELECT ingest.signal_sources` from a config migration is unconfirmed, so check `scripts/db-migrate.sh` and the role setup. This is the fails.md 2026-11 "role existence was environment state" trap (~L2819).
- **Migration run order.** If a config migration reads `ingest.signal_sources`, it depends on ingest migrations 002/013 having been applied first. Check the run order in `docs/patterns/database.md` and `scripts/db-migrate.sh`; this was not checked.
- **pg_notify scope (CONFIG-4).** Deleting per-user rows must notify with `{namespace, key, environment, user_id}`, or the reload hits the wrong scope (a missing `environment` falls back to `'staging'`). 046 notified only `{namespace, environment}` for global rows, so a per-user delete needs the full payload.
- **Snapshotting a secret row.** The 046 snapshot copies columns into `config.config_values_premigration_296`, and the copied column list has **no `value_encrypted`**. A snapshot of a swept secret therefore loses its ciphertext (harmless, possibly desirable). If a ciphertext column were added to the snapshot, the encrypted bearer would persist in a second table. The design should rule on whether to snapshot secrets at all.
- **`config_markers` single-writer test.** `services/xstockstrat-config/src/__tests__/dormantAlias.test.ts:123-126` scans `readdirSync(MIGRATIONS_DIR)` for marker inserts. Only `relative_keys_v1` must be unique there now, but the 048 step's Files must still list every test that scans migrations (fails.md 2026-11-10 config-dead-rows-prune — test-blast-radius, ~L3719-3721).
- **Which databases actually run.** Before naming per-DB operator gates (rehearsal or re-probe), confirm with the operator which databases and deployments exist (fails.md 2026-11-10 config-dead-rows-prune — assumption, ~L3940-3946).
- **Ref-namespace looseness** (ingest findings `:36`): match semantics, as noted under Patterns.
- **Overlap.** The product-spec review warned that agent `tools.py` overlaps feature 314 and `config.proto` overlaps feature 322. With no proto change, only the 314 overlap remains relevant.
- **Doc and comment spots to update** (digest cites, not re-read):
  - `docs/runbooks/mcp-tools.md:820,866`
  - `docs/patterns/config-governance.md:318,525`
  - `services/xstockstrat-agent/CLAUDE.md:175`
  - `services/xstockstrat-ingest/CLAUDE.md:129`
  - `docs/patterns/inter-service-mtls.md:58`

  Re-read and update as needed: the `_write_source_bearer` docstring (`tools.py:402`), the hook comment (`useSignalSourceMutations.ts:35-36`), and agent finding `:44`, which should move to resolved. The 166 ledger pattern (insights.md ~L2836-2842) should also gain a "+ sweep" note.
- Not found:
  - any existing orphan-sweep code, job, runbook or test;
  - the report's scratch pytest;
  - any acceptance suite for this feature under `services/*/acceptance/`;
  - any `-- requires-env` hint for config.

## Recommended Scope

Advisory only:

1. **Sweep mechanism.** The leading candidate is config migration `048`, a single latched CTE modelled on 046. Its delete predicate:
   - matches `is_secret`, namespace `ingest`, `mcp_credential.%` and per-user rows;
   - has `NOT EXISTS` on `ingest.signal_sources` matching on `(user_id, ref)`;
   - applies an age grace;
   - fires per-row `pg_notify` with the full CONFIG-4 payload;
   - writes an audit row with no plaintext.

   It is paired with a re-runnable operator script or runbook (or an un-latched variant) for orphans minted later. A periodic job runs only if the debate justifies it.
2. **Tests.** Config SQL tests for 048 (predicate, latch, notify payload, no referenced-row delete for AC-4), a pglast parse, and an assertion file for the migration rerun.
3. **Agent and UI regression guards (AC-1..3).** A failed register still returns the mapped error and still writes exactly one secret per attempt; the sweep handles the cleanup. Update the docstring and comment text.
4. **Docs.** The runbook entry for the sweep, the closure of the agent finding, and the doc spots listed above.
