# Recon: fix-ingest-seeded-config-keys

**Created**: 2026-10-22
**From**: product-spec.md
**Affected services**: xstockstrat-ingest, xstockstrat-config

---

## Objective

Five seeded `ingest` config rows are stored with a namespace-stripped `key` (`backfill.*`, `mcp_client.*`), but the config service serves each snapshot entry under the raw `key` column and ingest reads all five under the `ingest.`-prefixed string, so every read misses and the code default applies. The fix makes the stored key and the read key agree (design picks re-key seeds vs change readers), preserves operator-edited rows, reconciles INGEST-9 and the 2026-09-03 findings entry with the real snapshot shape, and reports a platform-wide seeded-key sweep.

## Codebase Map

- **`xstockstrat-config`** (Node/TS)
  - Snapshot construction (unchanged by this fix): `byKey[k].values[row.key] = buildConfigValue(row)` — `services/xstockstrat-config/src/grpc/configServiceImpl.ts:188`; also `values[row.key]` at `:212`, `base[row.key]` at `:240`. No namespace prefix is prepended.
  - Last migration: `030_marketdata_edgar_snapshot_keys.{up,down}.sql` (`services/xstockstrat-config/migrations/`); 60 files in the directory, no `031`+ on this branch.
  - Bare ingest seeds (applied, never edit — F-01):
    - `005_ingest_backfill_chunking.up.sql:8-25` — `('ingest', 'backfill.chunk_max_bars'|'backfill.chunk_window_days'|'backfill.max_concurrent_chunks', 'int', ...)` for `dev` and `production`, `trading_mode='all'`; `ON CONFLICT (namespace, key, environment, trading_mode)` at `:26`.
    - `025_ingest_mcp_client_keys.up.sql:28-39` — `('ingest', 'mcp_client.poll_interval_seconds'|'mcp_client.request_timeout_seconds', 'int', ...)` for `staging` and `production`, `user_id` NULL; `ON CONFLICT (namespace, key, environment, COALESCE(user_id, '')) DO NOTHING` at `:40`. Its header comment (`:13-18`) asserts the bare form is correct (the root of the drift).
  - Scope schema: `017_config_secrets_and_scoping.up.sql` renamed `dev` to `staging` (`:38`), restricted environment via CHECK (`:41`), dropped `trading_mode`, and created `CREATE UNIQUE INDEX config_values_scope_uniq ON config.config_values (namespace, key, environment, COALESCE(user_id, ''))` (`:101-102`). So at re-key time the live ingest rows are `staging` and `production`, global (`user_id` NULL); there is no `dev` row (AC-3's `dev` example row is stale).
  - Secret gate: `src/grpc/authz.ts:120-125` — ingest allow-list entry `keyPrefixes: ['mcp_credential.']`, `peerSan: 'xstockstrat-ingest'`. `GetSecret` keys are namespace-relative; `ingest.mcp_credential.*` rows are `is_secret=true` and must stay bare.
  - Config-side TS watcher (not ingest): `src/services/configWatcher.ts:109` also does a raw `values[key]` lookup.
- **`xstockstrat-ingest`** (Python)
  - Reader primitives: `app/config/watcher.py:104-144` — `get_str`, `get_int`, `get_int_present`, `get_bool`, `get_float` each do a raw `self._snapshot.values.get(key)` (`get_int` at `:112`, `get_int_present` at `:120`, `get_bool` at `:130`). WatchConfig sends `namespace=self.namespace` (`:56-73`) but nothing prefixes the key.
  - Reader key strings (all `ingest.`-prefixed):
    - `watcher.py:187` `get_int("ingest.backfill.max_concurrent_jobs", default=3)` — unseeded; comment `:185-186` forbids `get_int_present` (Semaphore(0) deadlock).
    - `watcher.py:191` `get_bool("ingest.backfill.retry_on_failure", default=True)` — unseeded.
    - `watcher.py:195` `get_int_present("ingest.backfill.max_retry_attempts", default=3)` — unseeded; not named in FR-4.
    - `watcher.py:200` `ingest.backfill.chunk_max_bars` (200000), `:204` `ingest.backfill.chunk_window_days` (90), `:210` `ingest.backfill.max_concurrent_chunks` (3; zero-trap comment `:208-209`).
    - `watcher.py:215` `get_int_present("ingest.signals.dedup_window_hours", default=24)` — unseeded.
    - `app/engine/mcp_client_loop.py:135` `"ingest.mcp_client.request_timeout_seconds"` (default `_DEFAULT_REQUEST_TIMEOUT_SECONDS`), `:164` `"ingest.mcp_client.poll_interval_seconds"` (default `_DEFAULT_POLL_INTERVAL_SECONDS`).
  - Docs holding the stale rule: `services/xstockstrat-ingest/docs/context-constitution.md:28` (INGEST-9, also referenced at `:6`); `context-constitution-findings.md:41` ("RESOLVED 2026-09-03" entry); `services/xstockstrat-ingest/CLAUDE.md:124-133` (Config Keys Consumed table, dotted form, "Seed migration `025_...`").
  - Other docs naming the keys: `docs/patterns/config-governance.md:375-376`, `docs/runbooks/historical-backfill.md:259-261`, `services/xstockstrat-config/docs/context-constitution.md:26` (CONFIG-9, see Risks).

## Patterns to REUSE

- Re-key SQL → reuse migration 029's guarded `UPDATE ... SET key = namespace || '.' || key WHERE key NOT LIKE namespace || '.%' AND is_secret = false` — `services/xstockstrat-config/migrations/029_heal_config_keys_full_dotted.up.sql:24-28`. Differences required here: restrict to the five named keys (not a blanket `namespace = 'ingest'`, which would still be guarded by `is_secret = false` but is wider than the defect), and add a twin-row guard because `config_values_scope_uniq` (`017:101-102`) would reject a blind UPDATE when a dotted row already exists (029 has none; it only worked because no twins existed).
- Idempotent/reversible pair → model on feature 182's rule (suite `readiness-materializer-config-keys.feature` `@AC-4`): re-run is a no-op, down touches only its own rows. 029's down is a forward-only `SELECT 1;` (`029_...down.sql:19`); 277's down should be an exact enumerated inverse over the five keys (005's down deletes the bare names by key, so restoring the bare form keeps that down coherent), preserving values, per ledger insights.md:1217 ("merge/delete migrations default to a remediation log, not a bare no-op down").
- Snapshot-keyed read test → reuse the ingest test harness: `services/xstockstrat-ingest/tests/test_config_watcher.py` builds `w._snapshot = config_pb2.ConfigSnapshot()` (L56, L74); `tests/test_mcp_client_loop.py:122` uses `_FakeCfgWatcher(ints={...})`; `tests/test_ingest_servicer.py:77` sets `snap.values["ingest.backfill.retry_on_failure"].bool_val = True`. AC-2's "snapshot built from the seeds" should parse the 005/025 `INSERT` tuples (not hand-typed keys), per ledger fails.md:2360 (every getter needs a read-path test over a realistically-keyed populated snapshot).
- Post-apply verification → ledger fails.md:2335: read back the stored `key` against the reader's literal getter string, never only a row count.
- Doc-state edits (FR-5) → rewrite INGEST-9 in place in `services/xstockstrat-ingest/docs/context-constitution.md` and mark the findings entry reconciled; do not restate mechanism in code comments (root CLAUDE.md "How to Act" 5).
- Operator standing rule (x-trace-id): no new emit/write path is introduced by this fix, so no `context.WithoutCancel` or metadata-propagation change is expected; a migration and docs only (readers option would not alter propagation).

## Existing Business Rules (preserve / extend)

No existing `@AC-*` asserts the bare seed form or the INGEST-9 wording; no EXTEND or CHANGE found. Feature 277's own AC-1..AC-7 are new alongside these.

- **PRESERVE** `@AC-3 @FR-1 @FR-3 @regression @feature-173` "The present-aware accessor honors a present zero and still defaults when unset" (`services/xstockstrat-ingest/acceptance/fix-python-config-zero-trap.feature`) — ingest keeps reading `ingest.`-prefixed keys via `get_int_present`; a stored 0 is honored. The readers option must not regress this.
- **PRESERVE** `@AC-1 @FR-2 @regression @feature-173` "A stored max_retry_attempts of 0 makes zero retry attempts, not the default 3" (same file) — reads `ingest.backfill.max_retry_attempts` and `ingest.backfill.retry_on_failure`; the FR-4 seed decision must not change snapshot-present true/false behavior.
- **PRESERVE** `@AC-2 @FR-2 @regression @feature-173` "A stored dedup_window_hours of 0 disables the dedup window, not the default 24" (same file) — the prefixed form for a key outside the five; INGEST-9's rewrite must keep it correct.
- **PRESERVE** `@AC-3 @FR-2 @FR-3 @feature-166` "Ingest resolves the bearer token via GetSecret and sends it as an Authorization header" (`services/xstockstrat-ingest/acceptance/mcp-client-signal-source.feature`) — the re-key must not move `ingest.mcp_credential.*` secret rows or the `keyPrefixes: ['mcp_credential.']` grant.
- **PRESERVE** `@AC-2 @FR-2 @feature-166` "Bearer token is stored encrypted and never returned on a read edge" (same file) — the re-key must filter `is_secret = false`.
- **PRESERVE** `@AC-5 @FR-5 @feature-166` "Unreachable endpoint records health without crashing the service" (same file) — a now-honored shorter timeout/poll interval must still degrade health gracefully.
- **PRESERVE** `@AC-35 @FR-14 @feature-224 @feature-225` "Two users with the same mcp_client slug use their own credentials" (`docs/sdd/business-rules/platform.feature`) — per-user secret scope, no plaintext at config read edges.
- **PRESERVE** `@AC-1 @FR-1 @FR-3 @feature-182` "The seed migration registers all four materializer keys per environment" (`services/xstockstrat-config/acceptance/readiness-materializer-config-keys.feature`) — full dotted `key` column is the seed convention 277 moves ingest onto.
- **PRESERVE** `@AC-4 @FR-3 @feature-182` "The migration is idempotent and reversible" (same file) — model for 277's up/down pair; down touches only the five ingest rows.
- **PRESERVE** `@AC-2 @FR-1 @FR-2 @feature-182` "Keys are seeded at their current code defaults with getter-matching value_type" (same file) — if FR-4 seeds `ingest.backfill.max_concurrent_jobs` it must be int 3.
- **PRESERVE** `@AC-1 @FR-1 @FR-3 @feature-184` "The seed migration registers the opportunity keys per environment" and `@AC-3 @FR-1 @feature-184` "Applying the migration changes no runtime behavior on its own" (`services/xstockstrat-config/acceptance/opportunity-config-operability.feature`) — same convention; rows still at their seeded default stay behaviorally neutral. All five ingest seed values equal the code defaults (200000, 90, 3, 300, 30), so only operator-edited rows change behavior.
- **PRESERVE** `@AC-13 @FR-9 @feature-147`, `@AC-11 @FR-9 @feature-147`, `@AC-12 @FR-10 @feature-147`, `@AC-14 @FR-2 @FR-9 @feature-147` (`services/xstockstrat-config/acceptance/config-secrets-and-scoping.feature`) — snapshot serves stored `key` verbatim (construction unchanged); per-user overrides global, so the re-key must keep each row's `user_id`; no `trading_mode` column exists, so re-key SQL must not reference it; secrets stay redacted, so secret rows are untouched.
- **PRESERVE** `@AC-2 @FR-2 @regression @feature-174` "The ingest watcher identifies as an ingest subscriber" (`services/xstockstrat-ingest/acceptance/fix-config-watcher-client-id.feature`) — keep the `ingest-` client_id prefix if the watcher is touched.
- Peripheral, not impacted: `@AC-1 @FR-1 @feature-210` (`docs/sdd/business-rules/platform.feature`, mTLS WatchConfig channel unchanged).
- No promoted suite guards migration 029's behavior, so its guards (`is_secret=false`, `NOT LIKE`) are not C-16-protected; 277 needs explicit coverage of them (AC-3/AC-4). `platform.feature` has no rule on cross-namespace seeded-key correctness, so the FR-6 sweep is a finding, not a guarantee, until promoted.
- Both affected services have acceptance suites (ingest and config); both were read.

## Dependencies

- Proto/RPC: none (snapshot construction `configServiceImpl.ts:188/212/240` unchanged; `GetSecret` unchanged).
- Migration: `services/xstockstrat-config/migrations/` tip is `030`. Claimed on `origin/main-dev` implementation specs: `031_heal_indicators_sandbox_keys_full_dotted` (feature 243), `032_analysis_zero_trap_descriptions` (244) and `032_ledger_stream_resolve_timeout` (a peer; 248 per the product spec). 277 therefore needs `033` or the next free number; no `033_*` is claimed anywhere on `origin/main-dev` docs. Re-derive across all remote branches at spec time (ledger fails.md:227-228). Files: `NNN_<slug>.up.sql` and `.down.sql`, no explicit BEGIN/COMMIT (029 convention).
- Config keys: the five existing keys change from bare to `ingest.<category>.<key>` (FR-1); `ingest.backfill.max_concurrent_jobs` and `ingest.backfill.retry_on_failure` are existing reads with no seed (FR-4 decision); `ingest.backfill.max_retry_attempts` and `ingest.signals.dedup_window_hours` are likewise read-only-unseeded (the config governance audit says "unseeded except the 3 chunk keys", `docs/reports/2026-08-07-config-governance-audit.md:210`).
- Inter-service edges: none new (ingest to config WatchConfig/GetSecret unchanged).
- New env vars / ports: none.
- Cross-feature seams: 244 rewrites the same reader lines (`watcher.py`, `mcp_client_loop.py:133-138,162-167`) to `int_positive` over the `ingest.`-prefixed keys, so the seeds option avoids a file collision; 261 reuses `ingest.mcp_client.request_timeout_seconds` and references the bare 025 row, so its step needs a re-check against the final key form; INGEST rules table is also edited by 244 and 261 (`docs/roadmap/features/merge-order.md:82`); 243 owns the `indicators.sandbox.*` heal (031).

## Risks / Not-found

- **Twin-row collision**: a blind `UPDATE ... SET key = 'ingest.' || key` violates `config_values_scope_uniq` if a dotted twin exists (Open Question 2). Needs `WHERE NOT EXISTS (dotted twin with same environment and COALESCE(user_id,''))` plus a conflict rule for the leftover bare twin (delete, or keep the more recently edited value). Not found: any live evidence on whether twins exist on staging/production (`list_config_keys` showed only the bare five).
- **Key rename is not audited**: the `config_value_audit` trigger fires on value change only (digest 2); a rename leaves no audit trail, so the migration or PR should log the old to new mapping. Not verified against the trigger SQL in this recon.
- **Operator-edited vs default**: re-keying makes edits that were previously ignored suddenly take effect (029 precedent step 2, `029_...up.sql:30-40`, preserved production behavior by bumping a seed). Here all five seeds equal the code defaults, so only rows an operator edited change behavior; the design must decide whether to apply those edits silently or flag them (they were set expecting effect).
- **`dev` row in AC-3**: after 017 no `dev` environment exists (CHECK at `017:41`); AC-3's `dev` example and the spec's "dev, staging and production" wording are stale and need revising to staging and production.
- **Down-migration restoring bare form**: must keep `is_secret=false` and the five names, and must not collide with the 005/025 down files, which delete bare names by key.
- **Doc drift** (FR-5): INGEST-9 (`context-constitution.md:28`) requires the FULL prefixed key and cites `tests/test_mcp_client_loop.py#test_cycle_reads_namespace_prefixed_request_timeout_key` (~L111); the 2026-09-03 findings entry (`context-constitution-findings.md:41`) says the prefix "gives seed migration 025 effective readers", which is false for the stored bare keys. CONFIG-9 (`services/xstockstrat-config/docs/context-constitution.md:26`) also claims namespace-relative keys "survive only in 023 and 025"; that is incomplete (see sweep). `docs/patterns/config-governance.md:375-376` describes the `mcp_client` keys as stored in the `key` column.
- **Behavioural effect unobserved**: staging `get_config(namespace='ingest')` shows bare keys with no `ingest.`-prefixed entries (context.md, 2026-10-22), but no log or metric exposes the effective timeout/poll interval. Prove it with a unit test over a snapshot built from the seeds; no staging write (operator decision).
- **No migration-level test harness in xstockstrat-config**: `services/xstockstrat-config/src/__tests__/` has 21 files (e.g. `configServiceImpl.test.ts`, `listKeysWire.test.ts`, `secretsAndScope.test.ts`, `secretCallerAuthz.test.ts`) and none executes `.sql` migrations. AC-3/AC-4 need either a new DB-backed harness or an SQL text/PGlite-style check; this is a spec-time decision. `secretCallerAuthz.test.ts:38` uses `'ingest', 'backfill.max_concurrent_jobs'` in an authz test; confirm it is unaffected by a key-form change (it exercises the secret gate, not the snapshot).
- **fails.md traps applied**: 2257 (grep every consumer in all languages, incl. UI/e2e fixtures/mocks, for both the old and new key string before calling the edit set atomic) — grep for `mcp_client.(poll|request)`, `backfill.chunk*`, `max_concurrent_chunks` under `services/xstockstrat-ui`, `services/xstockstrat-agent` and docs found only the docs listed above and the ingest tests; the config-ui reads keys from `ListKeys` generically, so no hard-coded bare consumer was found, but e2e fixtures (`services/xstockstrat-ui/e2e/fixtures/configKeys.ts`) were not re-read. 2328/insights 3272 (bounds registry tolerates both key forms; no ingest entry in `SCALAR_BOUNDS_REGISTRY` was found, `configServiceImpl.ts:101` holds the analysis decay key only). 2333 (seeded `key` must be the exact full-dotted reader string; verify by post-apply read-back). 2358 (read-path test over a populated snapshot; defaulted read silent). 343-345 (never change a key's `value_type` in place; the re-key keeps `value_type`).
- **FR-6 sweep** (seed-side `key` form vs reader literal; verified by grep on this branch). Result: the same inert-seed defect exists beyond ingest.

| Namespace | Seeded key (migration) | Stored form | Reader literal | Verdict |
|---|---|---|---|---|
| ingest | backfill.chunk_max_bars / chunk_window_days / max_concurrent_chunks (005) | bare | `ingest.backfill.*` (`watcher.py:200/204/210`) | MISMATCH, 277 scope |
| ingest | mcp_client.poll_interval_seconds / request_timeout_seconds (025) | bare | `ingest.mcp_client.*` (`mcp_client_loop.py:164/135`) | MISMATCH, 277 scope |
| ingest | backfill.max_concurrent_jobs, retry_on_failure, max_retry_attempts; signals.dedup_window_hours | not seeded | dotted (`watcher.py:187/191/195/215`) | read-only, code default always applies (FR-4) |
| analysis | fundsignal.* x12 (008) | bare | `analysis.fundsignal.enabled` etc. (`fundsignal_loop.py:136,137,149,171`; `live_loop.py:162`) | MISMATCH (inert) |
| analysis | scoring.signal_decay_half_life_hours (019) | bare | `analysis.scoring.signal_decay_half_life_hours` (`servicer.py:4879,5213`); bounds registry keys dotted (`configServiceImpl.ts:101`) | MISMATCH (inert; ledger fails.md:2333 already names it "still unfixed") |
| analysis | backtest.max_duration_seconds (001/002) | bare | no reader found; screener reads `analysis.screener.max_duration_seconds` (`servicer.py:3786`) | dead seed |
| indicators | sandbox.timeout_ms and siblings (001/002) | bare | `indicators.sandbox.timeout_ms` in indicators/analysis/ingest `watcher.py` (`:134`, `:151`, `:169`) | MISMATCH; feature 243 (migration 031) owns the heal |
| ledger | stream.notify_enabled (001) | bare | no reader found | dead seed |
| ui | performance.* (023) | bare | `values['performance.risk_free_rate_annual']` etc. (`services/xstockstrat-ui/src/lib/performanceMetrics.ts:193,202`) | MATCH (bare on both sides) |
| agent | signal.alert_threshold (004) | bare | `_ALERT_THRESHOLD_CONFIG_KEY = "signal.alert_threshold"` (`app/tools.py:78`) | MATCH (bare on both sides) |
| platform / trading / portfolio / marketdata (non-secret) | various | healed to dotted by 029 | dotted | MATCH; marketdata vendor secrets stay bare by design (`GetSecret` takes namespace-relative keys, `authz.ts`) |
| notify / ledger.export / analysis.engine, readiness_materializer, opportunity / marketdata 030 | 018, 021, 022, 026, 027, 028, 030 | full dotted | dotted | MATCH |

  Residual: the sweep is by static grep; readers keyed through helper indirection and any `get_float`/`get_str` use of fundsignal float keys were not individually traced, and live key registries for other namespaces were not queried. Fixing non-ingest namespaces is out of scope unless the operator extends it at the design gate (analysis fundsignal and decay keys are the candidates; 243 already covers indicators).

## Recommended Scope

Advisory, input to grilling and `/sdd-spec`:

1. Config migration `NNN` (033 or next free) with up/down: re-key the five named ingest rows to `ingest.<key>`, `is_secret=false`, `NOT LIKE 'ingest.%'`, twin-row guard, `value`, `value_type`, environment, `user_id` untouched; enumerated-inverse down. Applied 005 and 025 stay unedited.
2. Tests: ingest unit test building the snapshot from the migration seeds and asserting each of the five readers sees the seeded value, not the default (AC-1, AC-2); a migration test for the operator-edited, twin-row, secret-row and re-run cases (AC-3, AC-4) once the harness choice is made.
3. FR-4 decision recorded in context.md (seed `max_concurrent_jobs` as int 3 and `retry_on_failure` as bool true per the feature-182 rule, or leave code-default-only), coordinated with 244's zero-trap test.
4. Docs: rewrite INGEST-9 and mark the 2026-09-03 findings entry reconciled (AC-6); update `services/xstockstrat-ingest/CLAUDE.md` Config Keys note, `docs/patterns/config-governance.md:375-376`, and CONFIG-9's "survive only in 023 and 025" claim.
5. Sweep section in design.md (AC-7) carrying the table above; operator decision on extending scope to analysis `fundsignal.*` and `scoring.signal_decay_half_life_hours`.
6. Prefer the seeds option (touches no reader lines, avoids the 244 collision and the 261 key-string seam); the readers option would change five reader strings plus `@feature-173` surfaces and invalidate 261's and 244's key strings.
