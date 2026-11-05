# Design: fix-config-keys-drift

**Created**: 2026-11-05
**Rounds**: 5 (full; termination: approved at the cap. The round-5 adversary verdict was SOUND/APPROVABLE.)
**Approved by**: user @ 2026-11-05 (context.md decision 25)
**Grounded in**: recon.md, plus code re-verified in each round (cites below)

Scope: **Release A (expand)** of the config-key canonicalisation. Release B (rename to relative,
CHECK, relative getter literals, prefixed-key rejection, alias activation, dead-row deletion) is
feature **296 `fix-config-keys-contract`**. Binding operator decisions 1–25 are in `context.md`.

---

## Chosen Approach

### 1. Migrations (config): `035_config_markers`, `036_heal_config_keys_to_reader_catalog`

Config migrations end at `034_retire_portfolio_snapshot_interval` today, so the next number is 035.
Re-check this at spec time, because features 281/282/243 may land first.

**035 (A4).** `CREATE TABLE IF NOT EXISTS config.config_markers(name text PRIMARY KEY, set_at
timestamptz NOT NULL DEFAULT now(), set_by text NOT NULL)`, created empty. Its down is
`DROP TABLE IF EXISTS`. No 295 code or migration writes it, and a test asserts that no 295 `.up.sql`
INSERTs into it. 035 is the floor that 296's rename anchors on.

**036 (A10).** A heal migration whose only statements outside a single latched `DO` block are two
`CREATE TABLE IF NOT EXISTS`:
- `config.config_heal_report_036(run_at, action, namespace, key, environment, user_id,
  stored_value, effective_value, reason)`. `user_id` is plaintext in the DB and hashed by the tool
  on output.
- `config.config_values_premigration_036`, the 031 shape without `value_encrypted`
  (`031…up.sql:6-11`).

golang-migrate runs the whole file as one implicit transaction (`scripts/db-migrate.sh:41`, no
x-multi-statement), so a failure rolls the whole file back.

**DO block.**
- **Latch:** if a report row `action='latch'` exists, RETURN.
- **Temp tables, `ON COMMIT DROP`:**
  - `catalog_036(namespace, key, match exact|prefix, value_type, code_default, description,
    consuming_service, is_secret, reader)`;
  - `allow_036(namespace, key, environment, value_sha256)`, global-only.

  Both are generated VALUES blocks.
- **Ordered steps:**
  1. **Snapshot** every row. Secret-class twin rows get NULL `value_data` (S-2).
  2. **Classify (secret-class first, S-1).** A row is secret-class when it, its alternate-spelling
     partner, or either spelling's catalog entry `is_secret`. Report `twin-secret-class`,
     `readers-disagree` and `secret-read-unseeded`. When grouping by (ns, key) for disagreement,
     int∪float are normalised: int only if every default is integral and some reader is int
     (decision 7).
  3. **Seed** every agreeing, non-secret catalog key × {staging, production}, global, `ON CONFLICT DO
     NOTHING`, with `updated_by='system:config-migration-036'`. The AFTER INSERT trigger audits each
     seed (`017:81-91`).
  4. **Twin delete.** A row b is deleted when all of these hold:
     - global, `is_secret=false`, not secret-class;
     - matches no catalog entry (prefix match uses `left(b.key,len)=c.key`, never LIKE);
     - a catalog-spelled partner t exists in the same `(ns, env, COALESCE(user_id,''))` scope;
     - `COALESCE(cat_alt.is_secret,false)=false` (M-4 NULL-safety);
     - `(ns, key, env, sha256(value_data))` is in `allow_036`.

     The delete runs as `WITH d AS (DELETE … RETURNING), a AS (INSERT INTO config.config_audit …)`,
     followed by a `twin-deleted` report row.
  5. **Report** `twin-kept-unsigned`, `per-user-unread`, `secret-unread`, and `unread-no-partner`
     for **every** dead row (M-8). Dead rows are deleted by 296.
     `stored_value` and `effective_value` are **NULL** whenever the row, its partner or either
     catalog spelling is secret, and for every per-user row (S-1, M-7).
  6. **Retype** non-secret read-spelling rows only where the canonical text equals the code default.
     Patterns: int `^-?(0|[1-9][0-9]*)$`; float by text equality (m8); bool `IN
     ('true','false')`; string by equality; json never. Each retype writes an explicit audit row,
     because the 017 trigger audits `value_data` only (`017:66-79`). Anything else is reported
     `signoff-type`.
  7. **Metadata.**
     - `description` and `consuming_service` are filled only where NULL or `''`, with `IS DISTINCT
       FROM` guards, skipping secrets.
     - **`default_value` is set to the agreed code default wherever it differs**, for non-secret
       catalog keys whose readers agree (MAJOR-2). Per CONFIG-2 it is documentation-only.
     - Each sync writes an explicit audit row with reason prefix `metadata:` (M-9), plus a
       `default-synced` report row.
     - Readers-disagree keys keep their `default_value`. Example: `platform.trading_state` stores
       `ACTIVE` (`011:12-23`) while trading's code default is `HALTED` (`trading.go:3589`).
  8. **Out-of-bounds report** for the new bounds (CASE-guarded numeric).
  9. **`pg_notify('config_changed', {namespace, environment})`** once per touched (ns, env). This
     matches `onNotification` (`configServiceImpl.ts:246-262`) and is delivered at commit.
  10. **Latch row.**

**036.down.** Re-inserts the latest run's `twin-deleted` rows from the snapshot with `ON CONFLICT DO
NOTHING`. Deletes the latch row. Keeps both tables. Seeds and retypes stay: they equal the code
defaults. There is no `-- contract-of` on 036.

**Recovery runbook** (`docs/runbooks/config-rollout.md`, A11).
- **Precondition:** valid only while config's highest up-file is 036; assert this with `ls` (M-6).
- **Steps:**
  1. Probe `to_regclass('config.config_markers')`, plus the latch row (guarded the same way).
  2. Run `migrate … force 35` if the table is present, or `force 34` if it is absent. Never use
     `db-migrate.sh force` (`migration-dirty-guard.sh:51`).
  3. Run `scripts/db-migrate.sh up`. A present latch makes this a no-op.
- **Background:** until 296 gives config a contract floor, a dirty 036 makes the automatic
  `force 0` (`db-migrate.sh:77-80`) replay 001.
  - That replay fails at `001:49-51` and rolls back in full. Rollback also restores the `001:37-47`
    `CREATE OR REPLACE FUNCTION`, so no data or function changes.
  - The version then reads `1 (dirty)`, which is why the probe is table-based.
  - The existing defect `docs/reports/2026-10-07-db-migrate-dirty-recovery-replay-unsafe-defect.md`
    stays open.

### 2. Inventories, allowlist and signing

There are three sources. Allowlist tuples are global-only `(ns, key, env, value_sha256)`.
Per-user twins are reported, never deleted.

**(i) Staging, read by the operator via a DO-console tool**
(`services/xstockstrat-indicators/app/maintenance/config_inventory.py`).
- Reuses `legacy_authors.connect` (`legacy_authors.py:47`): stdlib plus the image's asyncpg.
- **Never selects `value_encrypted`.**
- Each JSONL row carries: ns, key, env, `sha256(user_id)` or null, value_type, is_secret,
  has_description, has_consuming_service, `value_sha256`, `default_sha256`, updated_at.
  - `value_sha256` is null for secret and secret-class rows (MAJOR-4).
- The trailer holds the output digest and the tool's own source sha256, so the paste can be
  verified (decision 16). The operator pastes via a quoted `<<'PY'` heredoc.
- `--reveal heal/reveal-request.json` prints plaintext only for global, non-secret, non-secret-class
  rows whose heal decision depends on content (twin candidates, signoff-type).
  - Bounded keys get an `in_bounds` boolean; equality checks get `equals_code_default`.
  - A request naming a per-user, secret or secret-class row exits 2.
- `--report` prints the 036 report with user_id hashed and per-user values null.

**(ii) Fresh migrations (no operator).** `scripts/config-heal-dryrun.sh --fresh`:
1. Creates a scratch DB.
2. Runs `migrate goto 35`.
3. Writes the inventory.
4. Runs the **real 036 on that real DB**, which is exact because the migration plaintext is public.

This covers CI, docker-compose and **production's first deploy**. No production DB exists anywhere
(decision 24).

**(iii) Production:** none.

**Staging dry-run** (the same script):
1. Build a scratch DB at 35, then delete all `config_values` rows.
2. Load the staging inventory. Each value is:
   - the revealed plaintext; else
   - the code default when the hash matches; else
   - `__sha256:<h>` (`__secret_class__` for null hashes); or
   - for an unrevealed bounded key, a synthesized in-bounds value ≠ default, or max+1.
3. Run the real 036 and dump `heal/dryrun-{staging,fresh}.tsv`.
4. **FAIL if any `twin-deleted`, `retyped` or `default-synced` decision touched a sentinel or
   synthesized row.**

**Emit and sign.**
- `check-config-wiring.mjs --emit-heal-data --inventory <staging> --inventory <fresh>` prints both
  VALUES blocks. It fails on a catalog key with an empty description.
- Catalog descriptions are authored once in A2 in `heal/catalog.tsv`.
- `heal/signoff.md` records, per inventory: tool sha256, inventory digest, dry-run sha256,
  allowlist-block sha256, operator and date. It is mirrored in context.md.
- A re-sign may only remove tuples (monotone shrink).
- Drift after G2 misses its hash and survives as `twin-kept-unsigned` (fail-safe).

### 3. Gate (FR-13): extend feature 278, DB-free by default

- **Stored set.** `check-config-wiring.mjs` reads a committed, generated
  `scripts/config-wiring-stored.json`.
- **Generator.** `scripts/config-wiring-stored.sh`: throwaway DB → render + `migrate up` (config
  migrations only) → dump `(ns, key, env, user_id IS NULL, is_secret, value_type, description,
  consuming_service, default_value)` plus `inputs_sha256` → drop the DB.
- **Staleness.** `--final` fails when `inputs_sha256` is stale. Step mode tolerates staleness
  (missing-side findings are PENDING, `mjs:706`).
- **CI freshness job.** A new `config-wiring-stored` job uses the timescaledb service plus the
  `Dockerfile.migrate` image (`ci.yml:684-713` shape). It regenerates the JSON, fails on any
  `git diff`, uploads the regenerated JSON as a patch artifact, and is part of `ci-gate`.
  - Its path filter covers: config `migrations/**`, the generator, `config-wiring-stored.json`,
    `render-migrations.sh`, `db-migrate.sh` and `Dockerfile.migrate`.
- **Tokenizer retirement.** The tokenizer stored-set model is retired: `buildStoredSet`
  `mjs:352-375`, `applyUpdate`, `applyDelete`, `rewriteAllow` and `unmodelled-rewrite`.
  `splitStatements` and `applyInsert` stay only for `--declared-migration` (`mjs:664-673`).
- **New finding kinds.**
  - `unattributed`: a receiver→namespace registry with **no default namespace**; blocking.
  - `type-mismatch`: getter arm vs `value_type`, int→float allowed; scoped to catalog-read rows;
    blocking.
  - `metadata-missing`: scoped to catalog-read rows; blocking.
  - `default-mismatch`: literal defaults only; skips readers-disagree keys; blocking.
  - `readers-disagree`: derived and reported.
  - Secret and prefix catalog entries are excluded from `read-unseeded` (M-3).
- **A10 end state** (decision 22). The baseline holds only `seeded-unread` entries with owner
  `feature 296` (`OWNER_RE` `mjs:306` already admits it). Each entry's (ns, key) must appear as an
  `unread-no-partner` row in the committed `heal/dryrun-fresh.tsv`.
  - The rule is enforced as a `--final` check over the committed baseline, **not** in schema
    validation, so the `@feature-278 @AC-7` fixture stays valid (M-1).
  - A2 proves that the fresh `twin-kept-unsigned` / `twin-secret-class` residuals are empty, and
    that every readers-disagree key is seeded fresh (M-2). Any exception is baselined as
    `form-mismatch`, owner feature 296.
  - `policy.envReadUnseeded` becomes `blocking`.
  - The ratchet (`mjs:692,695`) fails any new finding, and the membership check fails any new entry.
- **Other gate additions.** Modes `--inventory` and `--emit-heal-data`; an AC-20 doc check.
- **Owned test rewrites:** 278's `baseline 2/3` and `skill 3`.

### 4. Config server

**FR-1, form-tolerant writes.** `canonical(ns, key)` is exported from `src/grpc/authz.ts`. It is used:
- in the grant match (`:112`);
- in the `platform.trading_state` check (`configServiceImpl.ts:543`);
- in a single-probe `lookupScalarBounds` (`:154-156`).

**Spelling resolution:**
- The exact-scope probe (`:575-579`) becomes `key IN ($k, alt($k))` at the **request's**
  `(env, COALESCE(user_id,''))`.
- Only when that finds nothing does the global probe (`:583-590`) run with the same `IN`.
- The found row selects **only the spelling**. Scope and `user_id` always come from the request.
- So a first per-user override INSERTs a per-user row in the global row's spelling, via the
  existing upsert (`:632-646`). It **never updates the global row** (PR #994 owner-only).
- The write returns `FAILED_PRECONDITION` naming both spellings (M-5) when either:
  - two spellings are hit at the probed scope; or
  - an exact-scope hit's spelling differs from the global row's spelling.

**Errors and bounds.** SQLSTATE 23514/23505 map to `INVALID_ARGUMENT` (`:652-654`). New bounds:
- `indicators.sandbox.timeout_ms` [100, 33000];
- `indicators.sandbox.startup_grace_ms` [1000, 10000];
- `analysis.compute.max_worker_threads` [1, 16].

**FR-2, change-feed liveness.**
- **LISTEN heartbeat.**
  - The listener also LISTENs `config_heartbeat` (`:198`).
  - An unref'd 10 s tick, its whole body in try/catch, sends
    `listener.query("SELECT pg_notify('config_heartbeat',$1)",[token]).catch(…)` when none is in
    flight. This runs on the **listener's own socket** (self-delivery), so it uses no pool slot
    (F-06).
  - The handler (`:195`) routes by channel. A matching token sets `lastBeatAt`, which is reset on
    connect.
  - When `now - lastBeatAt > 30 s`, the server calls `dropListener → scheduleReconnect → resyncAll`
    (`:210-244`).
- **Pool** (`src/index.ts:29-34`): `query_timeout 15000`, `statement_timeout 15000`,
  `keepAlive true`, `keepAliveInitialDelayMillis 10000`. `max` stays 2.
- **Serial-chain watchdog.** `serial` (`:179-186`) records `headStartedAt`. When the head is older
  than 30 s, the server logs one ERROR `config serial chain stalled` and suspends re-sends until the
  chain drains, so a wedged server becomes visible to clients.
- **Content version.**
  - A 16-hex sha256 over the sorted `(key, typed value, isSecret)` of the subscriber's final
    overlaid values, plus the secret rows' `updated_at` (hashed, never emitted; `:50` copies only
    `stringVal`/`isSecret`).
  - The SELECTs at `:266/:292/:321` add `updated_at`.
  - It replaces `Date.now()` at `:281/:304`, and is computed in `snapshotForSubscriber` and
    `getConfig`.
  - Each subscriber keeps `lastVersion` and `lastPayload`. A broadcast is skipped when the version is
    unchanged (AC-26).
- **Re-send:** every 10 s, `lastPayload` is re-sent as a DELTA with no DB access. Pending and
  backpressured subscribers are skipped. Logged at DEBUG.
- **Backstop:** `reloadAll` every 5 min on the serial chain. A (ns, env) is re-broadcast when its
  global version changed or it has a per-user subscriber.

**Old clients.** They replace the whole snapshot on each message and only log `version` (indicators
`watcher.py:84-88`, Node `configWatcher.ts:65`, Go `config.go:190`). The full-namespace re-send
therefore never wipes them, and no proto change is needed.

**Dormant alias + marker.**
- `CASE WHEN to_regclass('config.config_markers') IS NULL THEN false ELSE EXISTS(… name =
  'relative_keys_v1') END` is read in the same statement as the rows in `reloadAll`,
  `reloadNamespace` and the overlay SELECT (`:266`, `:292`, `:321-326`).
- `withLegacyAliases` runs after the overlay **only** when the marker is active. While inactive the
  output is byte-identical (AC-2).
- A `{"marker":…}` NOTIFY payload enqueues `resyncAll` through `serial()`.

### 5. Watchers (FR-6/10/11)

**Per-language byte-identical cores plus a hash guard:**
- Go: `internal/config/` in trading, portfolio and marketdata;
- Python: `app/config/` in indicators, ingest, analysis and agent;
- Node: `src/services/configWatcher.ts` in ledger, identity and notify.

The exemption entry goes in `docs/patterns/dry-guard-rail.md` and `.jscpd.json`, and the guard runs
in CI.

**Behaviour:**
- **Keepalive:** 30 s / 10 s, permit-without-stream (`clientKeepAlive`, `trading.go:196-200`).
- **Liveness:** 30 s.
- **Backoff:**
  - equal-jitter `[base/2, base]`, base doubling 1→30 s, so at most 5 streams per 10 s (AC-11);
  - reset only after ≥ 15 s of healthy delivery;
  - also applied after a clean EOF.
- The last snapshot keeps serving while reconnecting.
- **trading:** a map per namespace (replaces the prefix-delete `config.go:157-173`).
- **Getters:** typed per FR-11, with int→float widened and every other mismatch or an absent key
  returning the code default plus a rate-limited WARN naming the FQN.
- An `OnChange(version)` hook.

**Keepalive spike fallback.** If the A4 spike sees `too_many_pings`, add the grpc-js server options
`grpc.keepalive_permit_without_calls=1` and `grpc.http2.min_ping_interval_without_data_ms=20000`,
then re-verify.

**FR-6 evidence:**
- INFO `config.read_key ns=<ns> key=<stored key>` on the first read.
- INFO `config.read_coverage ns=<ns> keys=<n>` at the first snapshot and every 6 h
  (`READ_COVERAGE_INTERVAL_S=21600`). At that tick the watcher **re-emits `read_key` for every key
  in its cumulative read-set** (MAJOR-3).
- Both literals are registered as `loki-literal` rows in `packages/otel/produced-signals.tsv`.
- The sink is staging Loki (`.do/app.dev.yaml:32-33` true; production is off and undeployed).
- **296 rule:** a key is dead-eligible only with zero `read_key` hits in either spelling across the
  whole staging release window **and** every `(service, ns)` subscriber logging coverage in every
  window. UI-read namespaces are never proven dead.

### 6. Live primitives (FR-7)

**`app/config/live_limits.py` `ResizableLimiter(limit_fn)`** (byte-identical in indicators, ingest
and analysis):
- shrink lets in-flight work finish; new acquires wait while `in_use ≥ limit`;
- `OnChange` calls `wake()`;
- `run_bounded(lim, executor, fn)` releases from the future's done-callback
  (`loop.is_closed() or call_soon_threadsafe(release)`), so a cancelled or timed-out caller never
  frees a still-running slot.

**Indicators.**
- Replaces `servicer.py:107/301`. The slot is released on thread completion.
- `RLIMIT_NPROC = max(limit, in_use) × 16` (`sandbox.py:352`).

**Ingest.** Replaces `servicer.py:323`.

**Analysis.**
- The semaphores at `:552/557/563/597` become limiters, mutated in place, because they are passed
  into evaluator, readiness and screener.
- `ComputePool(limit_fn, threads=16)` (`app/services/compute_pool.py`) wraps a private
  `ThreadPoolExecutor(16)` and replaces `:570-573`.
- `:1797/:2309/:2480` call `compute.run`. The screener takes `compute_pool=`
  (`servicer.py:3871` → `screener.py:91,177-179`).
- A grep test forbids `run_in_executor(self._compute_executor`.
- `fundsignal_loop.py:104-110` reads `marketdata` `fundamentals.provider` each cycle, through the
  existing second watcher (`main.py:49-51`).

**marketdata.**
- `func() Cfg` closures replace the boot copies (`cmd/server/main.go:93-260`), following the
  `ibkrTiming` pattern (`trading.go:2502-2516`).
- The Alpaca limiter uses `SetLimit` (FMP `fmp_client.go:149-158` pattern).
- The provider is read per call, along with its derived keys (`marketdata_service.go:1698,1767,1812,
  1969-1983`), keeping the single `*fmp.Client` as budget owner.
- The four secrets are re-resolved on `OnChange` (`ResolveSecret` `config.go:113-126`, 3 tries at
  1/2/4 s; on failure the old value is kept with a WARN) into mutex cells.

**trading.** A per-request `context.WithTimeout` from one `func() time.Duration` replaces the baked
`http.Client{Timeout}` (`broker/alpaca.go:48-50`). The same accessor is used at `trading.go:2495`,
`:3201` and `order_intent.go:100`.

### 7. Agent and FR-12

**Agent.**
- Two lifespan-owned watchers, `agent` and `indicators` (`app/main.py:229-233`; stdio `:86`).
- Boot **blocks** on both `wait_for_snapshot(90)`, as every other service does (@feature-279
  @AC-17).
- **AGENT-1 scoped amendment:** only these two WatchConfig channels are long-lived. Every unary RPC,
  including the `get_config` tool, stays ephemeral and deadline-bound.
- Policy reads move to the snapshot: `oauth_server.py:84,104`, `tools.py:671`, and `_agent_policy`
  `tools.py:2604-2617`.

**FR-12 deadline.**
- `deadline_s = min(45.0 (_LONG_RPC_TIMEOUT_S client.py:39), (t + g + 2000)/1000)`.
- t and g use `int_positive` semantics: a stored value ≤ 0 means 5000.
- The override is used only when 0 < override < cfg.
- It replaces `client.py:1103`, and `tools.py:1658` passes it to `_grpc_error_message`.
- A clamp logs a WARN.

**Indicators.**
- `SANDBOX_STARTUP_GRACE_MS` (`sandbox.py:205`) is removed. Grace is a parameter (`:350`) read from
  the new seeded key `indicators.sandbox.startup_grace_ms` (int 5000).
- After the limiter acquire: `eff = min(timeout_ms, time_remaining()*1000 − grace − 500)` when a
  deadline exists, otherwise `timeout_ms`.
- `eff < 100` → `success=false` "request deadline leaves Nms…", nothing spawned.
- `eff < timeout_ms` → WARN.

### 8. UI (FR-9)

Explicit BFF getConfig handlers at `traderBff.ts:167` and `insightsBff.ts:171` add `environment:
nativeConfigEnvironment()` (`deploymentEnv.ts:13-15`). The `forward` factory (`bffShared.ts:61-74`)
has no mutation hook. The mock backend asserts the environment.

### Consumer surfaces (C-14)

- `/config-ui` (A3, A10): newly seeded keys appear, twins disappear, writes update the read row, and
  a FAILED_PRECONDITION message names both spellings.
- `/trader` and `/insights` (A9).
- Agent tools (A8): `test_formula`, `ingest_signal`, `list_opportunities`, `extract_*`, and OAuth
  registration.

### Operator gates

- **G1** (after A0 + A1): the staging hash inventory, run from the staging indicators console.
  Commit `heal/inventory-staging.jsonl` and verify the tool sha256.
- **G2** (after A9, before A10 merges): reveal → fresh and staging dry-runs → operator review of
  `twin-deleted`, `retyped`, `default-synced`, `signoff-type` and `twin-secret-class` → sign
  `heal/signoff.md`. **This is the only veto**, because 036 is immutable once on `main-dev` (F-01).
- **G3** (informational): at production's first deploy, run `config_inventory --report`, diff it
  against `heal/dryrun-fresh.tsv`, and read back the touched keys via the agent MCP.

### Step outline (for /sdd-spec)

| Step | Content | ACs |
|---|---|---|
| A0 | Inventory tool | AC-22, AC-30 |
| A1 | Gate extension (stored JSON, generator, CI job, kinds, attribution, emit/inventory, 278 test rewrites) | AC-19 fixture legs |
| G1 | Staging hash inventory | — |
| A2 | Fixpoint triage + freeze | — |
| A3 | FR-1 | AC-1, AC-25, AC-31 bound |
| A4 | FR-2, 035, dormant alias, keepalive spike | AC-2, AC-21, AC-26 |
| A5a | Go watcher cores | AC-10, AC-11, AC-12, AC-15, AC-27 |
| A5b | Python watcher cores | AC-10, AC-11, AC-12, AC-15, AC-27 |
| A5c | Node watcher cores | AC-10, AC-11, AC-12, AC-15, AC-27 |
| A6 | Limiter / ComputePool / NPROC / ingest | AC-6, AC-23 |
| A7 | marketdata, trading, analysis provider read | AC-7, AC-16, AC-17, AC-32 |
| A8 | Agent + FR-12 | AC-8, AC-10, AC-18, AC-31 |
| A9 | UI | AC-9 |
| G2 | Sign-off | — |
| A10 | 036, assertions, migration-rerun legs, regenerated JSON, baseline end state | AC-3, AC-4, AC-5, AC-14, AC-15, AC-19, AC-24, AC-28, AC-29 |
| A11 | FR-14 docs, FR-15 skills, runbook, context-constitution refresh | AC-13, AC-20 |
| A12 | Integration → staging verification → G3 | — |

A2's closed taxonomy:
- twin, seed, retype, signoff-type, default-synced/mismatch, out-of-bounds, per-user-unread,
  secret-class, dead→296, readers-disagree;
- extractor fix;
- a code-default change to match the effective stored value.

Anything else becomes a `docs/reports/` defect, not a 295 step.

**A10 changes to `migration-rerun.sh`.**
- **Pass 0:** config `goto 35`, plus `fixtures-pre-036.sql` containing: allowlisted tuples, a
  per-user twin, an unsigned twin, a secret-class twin, trading_state with the production row
  deleted, a string `"7"` retype, and a mismatching `default_value`.
- **Pass 2:** insert `backtest.extra_knob`, then run three legs. All three assert `extra_knob`
  survives.
  - (a) Latch present: `force 35` + up → no-op.
  - (b) Latch deleted: `force 35` + up → full re-run.
  - (c) `public.config_schema_migrations` dirty at 36 → `db-migrate.sh up`:
    - it FAILS at 001;
    - counts and `pg_get_functiondef` are unchanged;
    - probe → force 35 → up converges.
  - Report and audit assertions are scoped to the latest `run_at`.
- **`config-036.sql`** asserts that `portfolio.snapshot.interval_minutes` is never seeded
  (@feature-264 @AC-5), and that served values are unchanged by `default-synced`.

## Rejected Alternatives

- **Full-dotted canonical key.** Rejected by the operator (decision 1): it keeps the redundancy, the
  normalised model is relative, and Release B delivers it.
- **Alias always-on from Release A.** Unmodelled rows would be exposed under a second name at the
  first deploy. Replaced by a dormant, marker-gated alias (decision 12).
- **Release B inside 295 (two integration PRs).** Promote/lifecycle tooling has not been proven for
  that. Replaced by feature 296 (decision 13).
- **Prefix-tolerant readers (fallback lookup in each reader).** 277 rejected it, and it breaks when
  consumers roll out before config.
- **Heal from the migration-only model.** Ad-hoc `create_key` rows are invisible to it (round 1 B1).
- **Server re-send as the only liveness signal.** It masks a dead LISTEN feed (round 1 B2). Replaced
  by a heartbeat on the listener socket plus a watchdog.
- **Proto HEARTBEAT update type.** Old Python/Node watchers replace the whole snapshot on any
  message, so an empty heartbeat would wipe them.
- **Heartbeat on a shared pool slot.** It false-drops a healthy LISTEN under load (round 2 MAJOR-3).
- **Catalog-predicate DELETE over a namespace set N.** Not replay-safe, and not signed (round 2
  BLOCKER-1/2).
- **Dead-row deletes in 295.** The static extractor has known blind spots. Moved to 296 behind
  runtime evidence (decision 15).
- **JS emulation of the heal (`applyCatalogHeal`).** It would be a second implementation of the
  heal. Replaced by the real SQL on scratch Postgres.
- **A DB-backed gate on every run.** It cannot run in local SDD harnesses (round 3 M4). Replaced by
  the committed stored JSON plus a freshness job.
- **A standing CI signoff branch.** It would fire once or twice in its lifetime. Replaced by A10
  verification evidence.
- **Descriptions parsed from service CLAUDE.md tables.** Fragile, and frozen with stale wording.
  Authored in A2 instead.
- **Committing production values and user_ids.** Decision 16: hashes plus plaintext only where a
  decision depends on content.
- **Production console inventory.** No production DB exists (decision 24). The fresh inventory
  covers the first deploy.
- **Per-user twin deletes, and SQL user_id hashing.** Hashed ids cannot be matched exactly in the
  dry-run, and a per-user unread twin cannot change the effective value.
- **`policy.seededUnread=reported`.** It regresses @feature-278 @AC-7 (round 4 MAJOR-1). Replaced by
  a 296-owned ratchet baseline plus a membership check.
- **Schema-level `BASELINE_KINDS` narrowing.** It breaks the @AC-7 fixture (round 5 M-1). Done as a
  `--final` check instead.
- **Pool `connectionTimeoutMillis`.** It changes failure semantics for every waiter.
  `query_timeout` + `statement_timeout` are used instead.
- **Fixed 56 s agent deadline, and a 57 s cap.** The operator chose a derived deadline (decision 14)
  within the 45 s budget (decision 17).
- **Swap-and-drain executor.** It would run old and new pools transiently and break the
  @feature-176 bound. Replaced by a gate in front of a fixed pool.
- **Shared watcher library.** Scope (10 Dockerfiles, go.mod/pyproject/pnpm wiring). Named follow-up
  refactor; guarded copies for now.
- **Zero-code latch veto.** No DB needs it, and a vetoed DB would lose every seed.
- **Heal numbered 035, marker numbered 036.** A local DB would skip the heal, and the heal would sit
  below 296's floor.
- **Auto-recovery inside `db-migrate.sh`.** A new mechanism; 296's contract floor is the structural
  fix.
- **A non-blocking agent boot.** Contradicts @feature-279 @AC-17.

## Open Risks

- [ ] **A reader of an "unread" spelling that the catalog missed** (a dynamic key, or a UI/BFF/script
  read) gets its signed twin deleted and silently falls back to its default.
  - Mitigations: candidates only from zero-unknown namespaces, operator-signed plaintext at G2,
    snapshot + `036.down`, and a zero-hit `config.read_key` tripwire after the staging deploy.
  - To be addressed at A2/G2/A12.
- [ ] **Staging dry-run fidelity relies on sentinel and synthesized loading.** The guard FAILs on any
  touched sentinel. To be addressed at A10.
- [ ] **A wedged connection acquire or non-query step on the serial chain is visible but does not
  self-heal.** The watchdog logs ERROR and suspends re-sends; clients redial and are served from the
  cache (`:417-420`). To be addressed at A4.
- [ ] **The keepalive policy against grpc-js ^1.14.5 is unverified.** Spike plus a pre-stated
  fallback. To be addressed at A4.
- [ ] **An unsigned twin makes SetConfig return FAILED_PRECONDITION for that key until 296 renames
  it.** This is visible in config-ui. To be addressed at A3/A10 (the PR lists the affected keys).
- [ ] **A dirty 036 needs manual recovery until 296's floor exists.** The probe runbook covers it,
  and the 2026-10-07 defect stays open. To be addressed at A11.
- [ ] **Retypes or seeds change an old trading untyped getter's zero-value to the code default.**
  These rows are listed in the dry-run. To be addressed at A5a/G2.
- [ ] **Migration NNN collision with 281/282/243.** To be addressed at spec time.
- [ ] **Byte-identical copies drift.** The hash guard catches it. To be addressed at A5.
- [ ] **One PR editing both `config-wiring.json` and `dryrun-fresh.tsv` bypasses the new-entry
  check.** Review only. To be addressed in review.
- [ ] **Agent boot fails readiness when config is down for more than 90 s.** This is the platform
  norm. To be addressed at A8.
- [ ] **Unverified library behaviours:** node-postgres `query_timeout`/`statement_timeout`/
  `keepAliveInitialDelayMillis` Pool options, `grpc.aio` `time_remaining()` returning None with no
  deadline, and `check-otel-produced-signals.sh` multi-file producer paths. To be verified in the
  first step that uses each.

## Constitution Rules Touched

- `C-01`/`F-04`: honored. Every touchpoint is cited, and unverified behaviours are listed as open
  risks.
- `C-05`: amended in A11 under operator decision 1. CONFIG-9 is rewritten to state that the stored
  key equals the reader's exact spelling, with relative as the target (296).
- `C-07`: honored (`035`/`036`).
- `C-08`/`P-06`: honored. Every code-bearing step pairs red-first tests.
- `C-10`: honored. Every watcher copy, every UI GetConfig site and every compute call site (grep
  guard).
- `C-11`: honored. Track C, full design.
- `C-12`/`C-13`: honored. Fixtures come from canonical homes (UI mock backend, `config-036.sql`).
- `C-14`: honored. See Consumer surfaces.
- `C-15`: honored. The ACs are updated per the round-5 wording list, and the product spec is
  re-reviewed.
- `C-16`: see below.
- `C-18`: honored. CUT list in context.md; byte-identical copies over a shared library is a recorded
  trade-off.
- `F-01`: honored. G2 sign-off happens before `main-dev`; no applied migration is edited.
- `F-06`: honored. The heartbeat runs on the listener socket, pool `max` stays 2, and the agent
  watcher opens no DB connection.
- `F-07`: honored. `startup_grace_ms` becomes a key. Watcher, heartbeat, coverage and slack
  constants are documented as fixed invariants (config cannot configure its own channel).
- `F-11`: no Floor breach in any round.
- `P-01`/`P-02`/`P-03`/`P-04`/`P-05`: honored. The orchestrator mediated every round, gates were
  approved by the user, and decisions were checkpointed to context.md.
- `C-04`/`C-09`: no proto change.

## Business Rules Touched (C-16)

- **CHANGE.** Signed off by user @ 2026-11-04 (context.md decision 10).
  - C6, platform `@AC-6 @feature-182`: its "no seed migration" clause is retired by seed parity.
  - N2, `@AC-1..5 @feature-247`: agent policy reads move to the watcher snapshot, and the `get_config`
    tool stays a bounded GetConfig.
- **EXTEND.**
  - `@feature-278 @AC-2/3/8`: the join is namespace-attributed, with kind scoping and the 296-owned
    baseline.
  - `@feature-244 @AC-4`: adds the int→float widening row and the WARN.
  - `@feature-259 @AC-5`: keepalive, backoff and liveness for every watcher.
  - `@feature-258`: server change-feed liveness.
- **PRESERVE.**
  - `@feature-278 @AC-7` (a PR seeding an unread key fails CI): not regressed, thanks to the ratchet,
    the membership check and the `--final` placement.
  - C1 `@feature-243 @AC-1/4/5`, C2 `@feature-182 @AC-1`, C3 `@feature-184 @AC-1`, C4
    `@feature-278 @AC-1`, C5 `@feature-147` secrets: no key spelling changes in 295 (they CHANGE in
    296).
  - `@feature-244` zero-trap: the agent and indicators use `int_positive` semantics.
  - `@feature-173`.
  - `@feature-184`/`@feature-182`: seeds equal code defaults.
  - `@feature-264 @AC-5`: asserted in `config-036.sql`.
  - `@feature-147/254/166/224`: secrets are never seeded, deleted, revealed or reported in plaintext.
  - `@feature-241`: `updated_by` is set.
  - `@feature-279 @AC-17`: agent boot blocks on the snapshot.
  - `@feature-210 @AC-6`.
  - `@feature-273`: 45 s ≤ 57 s.
  - `@feature-176`: done-callback release; AC-23 `@preserve`.
  - `@feature-219`/`@feature-161`, `@feature-192`, `@feature-209 @AC-6`, `@feature-020 @AC-3`.
