# Recon: fix-config-keys-drift

**Created**: 2026-11-04
**From**: product-spec.md (FR-1..FR-15), context.md operator decisions 1–8
**Affected services**: xstockstrat-config, -trading, -portfolio, -marketdata, -indicators, -ingest, -analysis, -ledger, -identity, -notify, -agent, -ui; repo tooling (`scripts/check-config-wiring.mjs`), SDD skills/agents

> **Recon method (deviation, recorded):** the per-service getter inventory for all 12 services had
> already been produced this session by three per-language discovery passes (summarised in
> `context.md` § Evidence base). Phase 0 therefore ran **six targeted passes**:
> - the config server + migration harness;
> - the 278 checker;
> - Go live-reload sites;
> - Python/agent live-reload sites;
> - Node/UI;
> - `scenario-recon` (C-16).
>
> Rather than repeat twelve identical per-service surveys, each pass covered one decision this
> design must make.

---

## Objective

Make the stored config `key` canonical, namespace-relative and DB-enforced, so that:
- every reader resolves by `(namespace, relative key)`;
- every read key is seeded with a matching `value_type` and complete metadata;
- every config value takes effect live, through hardened watchers.

The heal must preserve every effective value, and it must never let an old image (during rollout or
after a rollback) fall back to a code default for a stored key. Feature 278's wiring gate is
extended to enforce all of this, and its baseline is drained to zero.

## Codebase Map

- **`xstockstrat-config`** (Node)
  - Snapshot keying: every value map is keyed by the raw `key` column, with no namespace handling:
    - `reloadAll` `services/xstockstrat-config/src/grpc/configServiceImpl.ts:264` (write `:276`);
    - `reloadNamespace` `:291` (write `:300`, `changedKeys` `:308`);
    - `resolveOverlayValues` `:317` (per-user overlay `:328`);
    - `snapshotForSubscriber` `:333` (`changedKeys` `:341`);
    - `toProtoSnapPayload` `:33`;
    - redaction choke point `buildConfigValue` `:706` (it does not take the key).
  - `setConfig` `:494-655`:
    - destructure `:532`;
    - hard-coded `key === 'platform.trading_state'` `:543`;
    - bounds `:557`;
    - exact-scope SELECT `:575-579`;
    - global fallback `:583-590`;
    - `create_key` NOT_FOUND `:597-604`;
    - upsert `:633-646` (does not touch `value_type`/`description`);
    - `pg_notify` `:647-649`.
  - `getSecret` `:458-492`: exact raw key `:468-472`.
  - `listKeys` `:657-703`: `DISTINCT ON (key)` `:662-668`, `key: r.key` `:678`.
  - `lookupScalarBounds` `:154-156` already probes `REGISTRY[key] ?? REGISTRY[ns.key]`.
  - Allowlists in `src/grpc/authz.ts`:
    - `INTERNAL_CALLER_ALLOWLIST` `:84-94` (`key:'platform.trading_state'` full-dotted, exact match
      `:112`);
    - `SECRET_CALLER_ALLOWLIST` `:132-145` (already relative: `alpaca.api_key`…, prefix
      `mcp_credential.`).
  - Last migration: `034_retire_portfolio_snapshot_interval.up.sql`, so the next is **035**.
  - DB constraints:
    - unique index `config_values_scope_uniq (namespace,key,environment,COALESCE(user_id,''))`
      (`migrations/017…up.sql:101-102`);
    - `value_type` CHECK `001…up.sql:10`;
    - no key-form CHECK exists.
  - Audit triggers:
    - BEFORE UPDATE `audit_config_change` (latest `017:66-79`) audits only a `value_data` change,
      so a **key-only rename writes no audit row**, but bumps `updated_at`;
    - AFTER INSERT audit (`010:26-29`, latest `017:81-91`).
  - Precedent heals:
    - `029` (bare→dotted, `UPDATE … key = namespace||'.'||key WHERE key NOT LIKE namespace||'.%'
      AND is_secret=false AND namespace IN (…)`, `029:24-28`; down forward-only `SELECT 1`
      `029.down:19`);
    - `031` (snapshot table `config_values_premigration_031` `031:6`; twin delete `:15-25`; rename
      `:29-46`; down forward-only).
  - Proto `packages/proto/config/v1/config.proto`:
    - `ConfigSnapshot.values` is `map<string, ConfigValue>` = 4 (`:49-58`);
    - `ConfigUpdateType` has UNSPECIFIED/SNAPSHOT=1/DELTA=2/RELOAD=3 (`:73-78`);
    - `ConfigKeyMeta` fields 1–10 (`:156-172`);
    - `GetSecretRequest` (`:110-115`).
    - **An alias needs no proto change** (the same value can sit under two map keys).
- **`xstockstrat-trading`** (Go)
  - Watcher `internal/config/config.go`:
    - multi-namespace `NewWatcher(..., namespaces...)` `:80`;
    - per-namespace SNAPSHOT/RELOAD **prefix-delete** `strings.HasPrefix(k, ns+".")` `:157-173`
      (load-bearing under full-dotted keys, broken under relative keys);
    - **untyped getters** `:205-243`;
    - backoff 2→32 s, never reset `:126-138`;
    - `context.Background()`, no keepalive `:85`, `:148`.
  - Live-config precedents:
    - `ibkrTiming()` closure `internal/service/trading.go:2502-2516` injected as `func() IBKRTiming`;
    - `ticker.Reset` pollers `:1745`, `:1941`, `:2376`;
    - `order_intent.go:111-132`.
  - Broker timeout read three ways:
    - `GetFloat` `trading.go:2495`;
    - `GetInt` `:3201`, baked into `http.Client{Timeout}` at `broker/alpaca.go:48-50` per account
      in `instantiateBrokerLocked` `:3170-3204`;
    - `GetInt` `order_intent.go:100`.
  - Existing keepalive helper `clientKeepAlive` `trading.go:196-200` (30 s/10 s, PermitWithoutStream).
- **`xstockstrat-portfolio`** (Go): watcher `internal/config/config.go` (typed getters `:112-181`,
  wholesale replace `:217`); `clientKeepAlive` `internal/service/portfolio_service.go:114`.
- **`xstockstrat-marketdata`** (Go)
  - Watcher `internal/config/config.go`: typed getters `:141-195`; `ResolveSecret` `:113-126`.
  - Boot-frozen in `cmd/server/main.go`:
    - secrets `:87-90`;
    - Alpaca `ClientConfig` `:93-109`; the limiter is built once in `internal/alpaca/client.go:70-73`;
    - `fundProvider` `:131-138`, used as a key-builder string in
      `internal/service/marketdata_service.go:1698,1767,1812,1969-1983`;
    - EDGAR `:143-147`;
    - FMP `base_url`/`metrics` `:246-259`;
    - Finnhub `:227-242`.
  - Live precedent: FMP `Limits func()` with `limiter.SetLimit` `internal/fmp/fmp_client.go:39-41,149-158`.
  - `source.FundamentalsSource` is an interface (`internal/source/source.go:75`).
  - `*fmp.Client` is shared by four consumers and owns the day budget (`main.go:156-157`).
  - No `atomic.Pointer` anywhere.
- **`xstockstrat-indicators` / `-ingest` / `-analysis`** (Python)
  - `app/config/watcher.py`: near-identical copies, no shared package.
    - `_watch` with fixed `sleep(2)` and no sleep on clean EOF (indicators `:70-91`);
    - wholesale `_snapshot` replace;
    - no keepalive (`mtls.target_override` is the only option, `app/mtls.py:44-46`).
  - Startup-bound primitives:
    - indicators `servicer.py:107` Semaphore (used `:301`);
    - ingest `servicer.py:323` (used `:493`);
    - analysis `servicer.py:552/557/563/597` semaphores **passed into** the evaluator
      (`evaluator.py:242,446`), readiness (`readiness.py:64`) and screener (`screener.py:86,370`),
      plus `_compute_executor` ThreadPoolExecutor `:570-573` (used `:1797,2309,2480`).
  - analysis also has a second watcher `app/main.py:49-51` (ns `marketdata`), whose provider is
    frozen in `fundsignal_loop.py:104-110`.
- **`xstockstrat-agent`** (Python)
  - No watcher. `get_config_value` `app/client.py:1836-1871` opens an ephemeral channel and calls
    `GetConfig` with a 3.0 s timeout (`:35`).
  - Callers:
    - `oauth_server.py:84,104`;
    - `tools.py:671` (alert threshold);
    - `_agent_policy` `tools.py:2604-2617` (`:1713`, `:2631-2634`).
  - `execute_formula` `client.py:1101-1103` uses `timeout=_RPC_TIMEOUT_S`=10.0 (`:38`).
  - Lifespan hook `app/main.py:229-233`; stdio path `:86`.
  - **AGENT-1** (`docs/context-constitution.md:17`) mandates ephemeral per-call channels, so a
    long-lived config channel needs an explicit amendment.
- **`xstockstrat-ledger` / `-identity` / `-notify`** (Node)
  - `src/services/configWatcher.ts`: three copies.
    - Jittered 1→30 s backoff, reset on data `:15-16,57,80-93`;
    - reconnect on `error`/`end` `:69-77`;
    - no keepalive or deadline;
    - raw key getters `:107-125`.
  - 11 getter sites in total (ledger 3, identity 2, notify 6), all full-dotted.
- **`xstockstrat-ui`** (Next.js)
  - GetConfig calls with no `environment`:
    - `src/components/insights/PerformanceDashboard.tsx:75` (ns `ui`, bare keys
      `src/lib/performanceMetrics.ts:192-208`);
    - `src/app/trader/positions/page.tsx:126-131` (ns `platform`, full-dotted).
  - BFF pass-through:
    - `src/lib/traderBff.ts:167`, `src/lib/insightsBff.ts:171`;
    - `forward` factory `src/lib/bffShared.ts:61-74` has no request-mutation hook.
  - `nativeConfigEnvironment()` `src/lib/deploymentEnv.ts:13-15` is used only on setConfig
    (`configUiBff.ts:43`, `insightsBff.ts:187`).
  - config-ui `NamespaceEditor.tsx`:
    - shows the raw `k.key` `:66`, `getRowId` `:363`;
    - literal `platform.trading_state` `:264`;
    - no create-key flow.
  - The `mcp_credential` writer builds the FQN ref `ingest.${key}`
    (`src/app/config-ui/hooks/useSignalSourceMutations.ts:23-31`).
  - Mock backend `e2e/mock-backend.ts:1511-1536`.

## Patterns to REUSE

- **Expand/contract migration discipline.**
  - Reuse the `-- contract-of:` header plus `scripts/check-migration-contract.sh`, which refuses a
    contract migration unless its expand file is already on `origin/main`
    (`docs/patterns/database.md:41-58`, ci job `migration-contract-gate` `.github/workflows/ci.yml:717,733`).
  - "A rollback restores images, not schema" (`database.md:98-99`).
- **Heal SQL shape.** Reuse `031`:
  - snapshot table `CREATE TABLE IF NOT EXISTS … premigration_NNN`;
  - twin-aware delete before rename;
  - `updated_by='system:config-migration-NNN'`;
  - `ON CONFLICT … DO NOTHING` inserts;
  - forward-only down with rationale (`031…up.sql:6-72`, `031…down.sql:3-4`).
- **Migration assertion harness.** Reuse `scripts/migration-assertions/config-031.sql`: DO-block
  asserts, then `BEGIN`, fixture rows (twins, bare, per-user), a temp snapshot, `\ir` replay and
  `ROLLBACK`. It is picked up automatically by the `migration-rerun.sh` glob (`:183-190`).
- **Seed row shape.** Reuse `033_ledger_stream_resolve_timeout.up.sql:8-17`: all metadata columns,
  both environments, `ON CONFLICT DO NOTHING`.
- **Live-config injection (Go).**
  - Reuse the `ibkrTiming` closure pattern (`trading.go:2502-2516`): pass `func() T` into clients
    rather than values.
  - Reuse the FMP `Limits func()` + `SetLimit` pattern (`fmp_client.go:149-158`) for the Alpaca
    rate limiter.
  - Reuse `ticker.Reset` for intervals.
- **gRPC keepalive (Go).** Reuse `clientKeepAlive` (`trading.go:196-200`, portfolio `:114`) on the
  watcher dial.
- **Bounds lookup tolerance.** `lookupScalarBounds` already accepts both forms
  (`configServiceImpl.ts:154-156`). Re-key the registry by `(namespace,key)`; do not add a third path.
- **Wiring gate.** Extend 278's `scripts/check-config-wiring.mjs`:
  - capture `value_type`/`description`/`consuming_service` in `applyInsert` `:172-201`;
  - keep the getter name dropped today at `:552` and in `config-wiring-py-reads.py:81-93`;
  - add reader→namespace attribution (none today: `join` `:607` matches by key string only);
  - add new kinds via `BASELINE_KINDS` `:305`, `join`, `findingLine` `:646`;
  - add a no-growth rule to `ratchet` `:683-697`;
  - update `config-wiring.test.mjs` `baseline 2/3` and `skill 3`.
- **Watcher test fakes.** Reuse `ingest/tests/test_config_watcher.py:83-122` (`_FakeStub`, `_Done`,
  patched `asyncio.sleep`) and indicators `tests/conftest.py:163` (`snapshot_watcher`).
- **Native env.** Reuse `nativeConfigEnvironment()` (`deploymentEnv.ts:13-15`) for UI GetConfig, as
  `configUiBff.setConfig` does (`:43`).
- **Node backoff.** The Node watcher's jittered reset-on-data backoff is the model for the Go and
  Python backoff (`configWatcher.ts:80-93`).

## Existing Business Rules (preserve / extend)

From `scenario-recon` (C-16). Full table in the session record; the material items:

- **CHANGE** (deliberate; needs operator sign-off in `context.md`):
  - C1: `@AC-1`, `@AC-4`, `@AC-5` @feature-243
    (`services/xstockstrat-config/acceptance/fix-sandbox-seed-keys.feature`). Stored form
    full-dotted becomes relative; values, types and descriptions preserved; on collision the
    pre-existing value still wins.
  - C2: `@AC-1` @feature-182 (`…/readiness-materializer-config-keys.feature`): full dotted becomes
    relative.
  - C3: `@AC-1` @feature-184 (`…/opportunity-config-operability.feature`): full dotted becomes
    relative.
  - C4: platform `@AC-1` @feature-278 ("seeded bare but read dotted is a form-mismatch"): the
    definition inverts to "a prefixed seed or a prefixed read is the defect".
  - C5: `@AC-1/1b/2/3/4/5/16/14` @feature-147 (`…/config-secrets-and-scoping.feature`): the key
    literal `marketdata.fmp.api_key` becomes ns `marketdata` + `fmp.api_key`. Guarantees unchanged;
    @feature-254 already uses the target form.
  - C6: platform `@AC-6` @feature-182: its "~5 analysis rows keep 'No seed migration'" clause is
    retired by seed parity.
  - N2: `@AC-1..5` @feature-247 (`services/xstockstrat-agent/acceptance/fix-agent-getconfig-deadline.feature`):
    agent policy reads move from per-call `GetConfig` to the watcher snapshot. The user-facing
    `get_config` tool stays a bounded `GetConfig`.
- **PRESERVE** (must not regress):
  - @feature-244 zero-trap family: platform `@AC-1`, `@AC-6` (about 40 `int_positive` clamp sites
    keep "stored ≤ 0 → default" when made live); analysis/config suites `@AC-2..12`.
  - @feature-173 present-vs-absent; empty `allowed_imports` denies all.
  - @feature-184/182 "seeds equal code defaults with getter value_type", "migration changes no
    runtime behavior"; bounds `@AC-4/5/8`, `@AC-7/8/9`.
  - @feature-264 `@AC-5`: `portfolio.snapshot.interval_minutes` is never re-seeded in any form.
  - @feature-147/254/166/224 secret encryption, redaction, allow-list + SAN, exact-scope `GetSecret`.
  - @feature-241 attribution.
  - @feature-258 server stream resilience.
  - @feature-259 `@AC-8` (watch-task exit logged).
  - @feature-279 `@AC-17` (not healthy before the first snapshot).
  - @feature-210 `@AC-6` (stream survives cert rotation).
  - @feature-273 (every agent tool ≤ 57 s, every stub call has a timeout; this caps FR-12).
  - @feature-176 (the concurrency bound holds, including across a resize).
  - @feature-209 `@AC-6`, @feature-020 `@AC-3` (already live).
  - @feature-219/161 config-ui shows the FQN.
  - @feature-192 trading resolves live values.
- **EXTEND:**
  - platform `@AC-4` @feature-244: add the int→float widening row and the WARN; keep the
    `float 2.5 → get_int → default` and `"5" → get_float → default` rows.
  - platform `@AC-5` @feature-259: add keepalive, backoff and liveness for all watchers.
  - platform `@AC-2/3/7/8` @feature-278: namespace-aware join, parity strictness, baseline drained.
- No suite asserts any "takes effect at restart" rule or the 227 waiver. Making things live and
  retiring the waiver regresses no `@AC-*`.

## Dependencies

- **Proto/RPC.** `ConfigSnapshot.values` map (field 4) and `ConfigUpdateType` (`config.proto:49-78`).
  The alias needs no change. A possible additive `CONFIG_UPDATE_TYPE_HEARTBEAT = 4` is a design
  option, but old Python/Node watchers replace the whole snapshot on **any** message
  (`watcher.py` `self._snapshot = snapshot`; `configWatcher.ts:58`). So a heartbeat with empty
  `values` would **wipe** old clients' snapshots. Any heartbeat must carry the full namespace
  (= a DELTA re-send, as CONFIG-1 already requires) or be rejected.
- **Migration.** Config `035`+ (re-check at spec time; 281/282/243 may claim numbers). The contract
  migration needs `-- contract-of: <expand>` and the expand migration already on `origin/main`.
- **Config keys.** All namespaces (rename, seed, delete). Authoritative list: the extended gate.
- **Inter-service edges.** Agent → config gets a long-lived WatchConfig. Agent → indicators
  `ExecuteFormula` gets a derived deadline. analysis → config keeps its two watchers (analysis,
  marketdata).
- **New env vars / ports.** None.

## Risks / Not-found

- **R1 — Rollback window (FR-4/AC-21).**
  - DO runs `db-migrator` as PRE_DEPLOY (`.do/app.yaml:668-671`) before any new image. A rollback
    restores images, not schema.
  - So if the rename ships in the same production release as the server alias, rolling back
    restores a config server with no alias, and old consumers miss every renamed key. The alias
    must already be in production **before** the rename migration runs there. That is a two-release
    sequence, enforceable with `contract-of`.
  - `/promote` moves all of `main-dev` to `main` at once, so both halves in one promotion breaks
    FR-4.
- **R2 — Trading's prefix-delete.** SNAPSHOT/RELOAD deletes `ns+"."`-prefixed keys
  (`config.go:157-173`). Under relative keys from two namespaces in one map, this deletes nothing
  and collides keys across `trading` and `platform`. The trading watcher must key its map per
  namespace.
- **R3 — Per-user overlay alias.** `resolveOverlayValues` overlays `base[row.key]` (`:328`). An
  alias added only in the global cache makes a per-user override lose on the alias key. The alias
  must be applied after the overlay.
- **R4 — `changedKeys` growth.** It equals `Object.keys(values)` (`:308,341`), so the alias doubles
  it. Harmless to every current consumer (none reads `changedKeys` to diff, CONFIG-1), but verify.
- **R5 — Audit gap.** A key-only rename writes no `config_audit` row (017 trigger). The migration
  must write it (277 lesson).
- **R6 — Unique index on twins.** A blind strip aborts on `config_values_scope_uniq` when both forms
  exist. Delete the losing twin first, the one the code does **not** read (031 shape inverted).
- **R7 — Shared limiter references.** analysis semaphores are passed into other objects. A resize
  must mutate the limiter in place. A new `ThreadPoolExecutor` cannot be resized; it needs either a
  gate in front of a fixed pool or swap-and-drain.
- **R8 — Shared FMP budget.** Rebuilding `*fmp.Client` would reset or split the day budget. A live
  change must swap only the transport/config, not the budget owner.
- **R9 — Secrets are redacted in WatchConfig.** A client cannot see that a secret changed: the
  value is always `[redacted]`, and `changedKeys` is the full namespace. FR-7 secret rotation needs
  either re-resolve on every DELTA or a non-secret change signal.
- **R10 — AGENT-1 conflict.** A long-lived config channel contradicts AGENT-1. It needs a scoped
  amendment.
- **R11 — 273 cap.** A `test_formula` deadline derived from the sandbox timeout must stay ≤ 57 s
  (MCP 60 s). At 15000 + 5000 grace it is 20 s, but an operator could set `sandbox.timeout_ms` above
  52 s.
- **R12 — 277/278 ledger traps.**
  - Scope creep: halt for re-scope if a round needs a spec widening (`fails.md:3437-3441`).
  - Triage every gate finding as extractor gap vs real defect before draining (`fails.md:3443-3446`).
  - Server-half resilience (`fails.md:3622-3626`).
  - The recurrence rule demands a binding rule plus a mechanical guard (`fails.md:2515-2532`).
- **R13 — Fixture blast radius.** `config-wiring.test.mjs` `baseline 2/3`, `skill 3`; UI
  `e2e/mock-backend.ts` and `e2e/fixtures/configKeys.ts`; every service's tests that build
  snapshots with full-dotted keys.
- **Not found:**
  - any shared config-client package in Go, Python or Node;
  - any OnChange hook on any watcher;
  - any resizable semaphore helper;
  - any `atomic.Pointer` swap;
  - any keepalive on a config dial;
  - any doc on rollback without a down-migration beyond `database.md:98-99`;
  - DO per-component rollout ordering or overlap (not verified).

## Recommended Scope (advisory)

Two production releases, mechanically ordered:

1. **Release A (expand).**
   - Config server is form-agnostic: it reads both, writes relative, and aliases on emit.
   - Consumers rewritten to relative.
   - Watcher hardening, the live-reload work, the agent watcher, the UI env fix, getter type rules,
     the FR-12 deadline.
   - The seed-parity INSERT migration, written relative.
   - Gate extension and skills/docs.
2. **Release B (contract).**
   - Heal/rename migration with `-- contract-of:`.
   - CHECK constraint.
   - Orphan deletes.
3. **Follow-up feature.** Remove the alias once no pre-A image can run.

The debate decides the exact split, and whether B is a second integration PR of 295 or a separate
feature.
