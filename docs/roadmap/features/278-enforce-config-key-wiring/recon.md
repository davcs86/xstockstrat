# Recon: enforce-config-key-wiring

**Created**: 2026-10-23
**From**: product-spec.md
**Affected services**: none at runtime. Repo tooling and process only: `scripts/`, `.github/workflows/ci.yml`, `.claude/skills/sdd-execute`, `.claude/skills/sdd-review`, `docs/patterns/config-governance.md`

---

## Objective

Build a static, offline wiring check that compares every config key's stored form (the `key` column the config migrations leave behind, which the config service serves verbatim) with the string each reader looks up, in Go, Python and TypeScript. Run it in CI against a tracked baseline (FR-4) and from `/sdd-execute` and `/sdd-review impl-spec` (FR-2, FR-3), so a key cannot ship seeded but inert, or read but unseeded. Feature 277's sweep supplies the baseline contents. 277 was demoted and its defect report closed `wont-fix`, so nothing else will fix those findings.

## Codebase Map

No runtime service changes. The "services" below are the tooling surfaces and the two data sources the check must join.

- **Seed side: `xstockstrat-config` migrations** (SQL)
  - Seeds are `INSERT INTO config.config_values` rows, columns `(namespace, key, value_type, value_data, description, default_value, consuming_service, environment, ...)`. Example: `services/xstockstrat-config/migrations/008_analysis_fundsignal_keys.up.sql:13`.
  - Last migration: `030_marketdata_edgar_snapshot_keys.up.sql` (`services/xstockstrat-config/migrations/`).
  - Stored form is the raw `key` column. `services/xstockstrat-config/src/grpc/configServiceImpl.ts:188` is `byKey[k].values[row.key] = buildConfigValue(row)`; the namespace is never prepended.
  - Rewrites after seeding: `029_heal_config_keys_full_dotted.up.sql:24-28` runs `SET key = namespace || '.' || key WHERE key NOT LIKE namespace || '.%' AND is_secret = false AND namespace IN ('platform','trading','portfolio','marketdata')`. A parser that reads only INSERTs mis-states those four namespaces. Feature 243's planned `031_heal_indicators_sandbox_keys_full_dotted` and 244/248's claimed `032` will add more rewrites (not on this branch).
  - Secret rows (`is_secret=true`) are read via `GetSecret` with namespace-relative bare keys (per 277 recon; `authz.ts:120-125` was not re-opened here).
- **Reader side: Python** (`get_*` wrapper methods over a raw `self._snapshot.values.get(key)`)
  - ingest `services/xstockstrat-ingest/app/config/watcher.py:104-144`: `get_str`, `get_int`, `get_int_present`, `get_bool`, `get_float`. analysis adds `get_float_present` (`services/xstockstrat-analysis/app/config/watcher.py:136`); indicators adds `get_str_present` (`services/xstockstrat-indicators/app/config/watcher.py:98`).
  - Call-site counts (`get_*(` calls): analysis `app/handlers/servicer.py` 60, `app/engine/fundsignal_loop.py` 18, `app/engine/live_loop.py` 10; ingest `app/config/watcher.py` 10, `app/engine/mcp_client_loop.py` 2; indicators `app/config/watcher.py` 3.
  - Examples: `fundsignal_loop.py:136` `self._cfg.get_bool("analysis.fundsignal.enabled", default=False)`; `fundsignal_loop.py:97` reads `marketdata.fundamentals.provider` through a different watcher (cross-namespace); `fundsignal_loop.py:148` is a multi-line call.
- **Reader side: Go** (`Watcher` methods `GetString`, `GetInt`, `GetFloat`, `GetBool`)
  - portfolio `services/xstockstrat-portfolio/internal/config/config.go:112,126,140,170`; trading `services/xstockstrat-trading/internal/config/config.go:205,215,225,235`; marketdata `services/xstockstrat-marketdata/internal/config/config.go:142,156`.
  - Call-site counts: trading `internal/service/trading.go` 30, marketdata `internal/service/marketdata_service.go` 23, portfolio `internal/service/portfolio_service.go` 6.
  - **Indirection already exists in Go**: `marketdata_service.go:982-987` `resolvePositiveInt(cfg intGetter, key string, def int64)` calls `cfg.GetInt(key, def)` with a parameter, so the literal lives at its callers. `portfolio/internal/config/config.go:160` reads through a constant, `w.GetString(FactorMapKey, "{}")`.
- **Reader side: TypeScript**
  - Node watchers: `this.snapshot?.values[key]` in `services/xstockstrat-config/src/services/configWatcher.ts:109` and the notify/ledger/identity equivalents (per digest, 4 hits each).
  - UI and agent index the snapshot directly: `services/xstockstrat-ui/src/lib/performanceMetrics.ts:193` `values['performance.risk_free_rate_annual']`, `:202`; agent `services/xstockstrat-agent/app/tools.py:78` `_ALERT_THRESHOLD_CONFIG_KEY = "signal.alert_threshold"` (a constant, the indirection case).
- **Tooling surfaces to edit**
  - CI: `.github/workflows/ci.yml` `changes` filters `:39-91`, `shell-lint` `:612-632`, `migration-contract-gate` `:676-692`, `context-map` job `:719-724`, `ci-gate` `:776-818`.
  - `/sdd-execute`: `.claude/skills/sdd-execute/SKILL.md` Phase 3 (`:279-312`), step 3 = run `**Verification**` (`:289`), step 4 = flip `**Status**` to `done` (`:298-299`), offline-only migration rule (`:290-297`), HARD CONSTRAINTS (`:453+`). Config-key convention: `.claude/skills/sdd-execute/reference/repo-conventions.md:30`.
  - `/sdd-review impl-spec`: `.claude/skills/sdd-review/reference/impl-spec-criteria.md` B2 table `:12-31` (`C-10` row `:30`, `C-14` row `:31`, WARN list starts `:33`); Mode B advisory declaration at `:4`. Product-spec criterion 6 checks key format only (`product-spec-criteria.md:25`).
  - Rule doc: `docs/patterns/config-governance.md` (`## Registering a new config key` `:56`, `## Per-Feature Registered Keys` `:105`).
  - Product-spec `## Config Key Changes` heading is defined at `.claude/skills/sdd-story/SKILL.md:198`; nothing in sdd-review or sdd-execute reads it today.

## Patterns to REUSE

- Check script and exit-code convention → reuse `scripts/check-migration-contract.sh` (usage header, `set -euo pipefail`, prefixed stderr lines, exit 1 on a finding) and its sibling `scripts/check-migration-contract.test.sh`. Open design choice: bash 3.2 vs a Node `.mjs` script (`scripts/merge-train-resolve.mjs` and `scripts/workflow-tests/harness.mjs` are the precedent). A multi-line, multi-language parser is awkward in bash 3.2; root `CLAUDE.md` requires `.sh` files to be bash 3.2 compatible.
- Script lint gate → `shell-lint` already runs `shellcheck scripts/*.sh` and `shfmt -d -i 2` (`ci.yml:625-629`); any new `.sh` must pass both. A new `*.test.sh` must be appended to the explicit list at `ci.yml:632` (`gen-dev-certs.test.sh` exists but is not in that list, so a new test can be silently unrun).
- Node check tests → `node --test scripts/workflow-tests/*.test.mjs` already runs in the `context-map` job (`ci.yml:723-724`); an `.mjs` check could ride there but that job is gated on `context-map` path filters.
- CI job shape → model on `migration-contract-gate` (`ci.yml:676-692`): `needs: changes`, `if:` on `matched`, `actions/checkout@v7`, one script step. No fetch-depth is needed because the scan is whole-tree (`fails.md:1040`: scan everything, not the diff).
- Path filter → `changes` has `scripts`, `migrations`, per-service filters and `context-map`, but **no aggregate filter over service source**. Design adds a filter (config migrations, `services/*/app/**`, `internal/**`, `src/**`, the script, the baseline file) or runs unconditionally.
- Gate wiring → add the job to `ci-gate` `needs:` (`ci.yml:779-794`) and to the echo list (`:799-813`) or it is not enforced.
- Baseline with owner → `scripts/check-duplication.sh` plus `.jscpd.json` is the repo's only baseline-style precedent (existence confirmed, contents not read).
- Snapshot-built read test (FR-3, @AC-11) → `services/xstockstrat-ingest/tests/test_config_watcher.py:56,74` (`w._snapshot = config_pb2.ConfigSnapshot()`), `tests/test_mcp_client_loop.py:122` (`_FakeCfgWatcher`), `tests/test_ingest_servicer.py:77` (`snap.values["ingest.backfill.retry_on_failure"].bool_val = True`); analysis `tests/test_analysis_servicer.py:4724`.
- Negative-test fixtures (must classify as wired) → ui `performance.*` (023), agent `signal.alert_threshold` (004), 029-healed namespaces, fully dotted seeds from 018, 021, 022, 026, 027, 028, 030 (277 `recon.md:98-101`).

## Existing Business Rules (preserve / extend)

No existing acceptance suite for `scripts/`, `.github/workflows/ci.yml`, `.claude/skills/*` or `docs/patterns/config-governance.md`: they are tooling, not services. The suites below touch the same keys or doc surface. The check is read-only, adds no runtime enforcement, and must classify these as wired, not as findings.

- **PRESERVE** `@AC-1 @FR-1 @FR-3 @feature-182` "The seed migration registers all four materializer keys per environment" (`services/xstockstrat-config/acceptance/readiness-materializer-config-keys.feature`)
- **PRESERVE** `@AC-2 @FR-1 @FR-2 @feature-182` "Keys are seeded at their current code defaults with getter-matching value_type" (same file)
- **PRESERVE** `@AC-4 @FR-3 @feature-182` "The migration is idempotent and reversible" (same file) — the check requires no migration edits
- **PRESERVE** `@AC-1 @FR-1 @FR-3 @feature-184`, `@AC-2 @FR-1 @feature-184`, `@AC-3 @FR-1 @feature-184` (`services/xstockstrat-config/acceptance/opportunity-config-operability.feature`) — seed sources the check scans; applying them changes no runtime behavior
- **EXTEND** `@AC-6 @FR-5 @feature-182` "Docs no longer claim the readiness-materializer keys have no seed migration" (`docs/sdd/business-rules/platform.feature`) — 278 adds the wiring rule to `docs/patterns/config-governance.md`; it must not drop the 182 entries in the registered-keys log (PRESERVE-equivalent if design only appends)
- **PRESERVE** `@AC-1 @FR-2 @regression @feature-173`, `@AC-2 @FR-2 @regression @feature-173` (`services/xstockstrat-ingest/acceptance/fix-python-config-zero-trap.feature`) — reader discovery must recognize these getters and not change them
- **PRESERVE** `@AC-1 @FR-1 @regression @feature-174` "The analysis watcher identifies as an analysis subscriber" (`services/xstockstrat-analysis/acceptance/fix-config-watcher-client-id.feature`) — snapshot and watch behavior out of scope
- **PRESERVE** `@AC-6 @FR-3 @FR-1 @feature-224` (key `analysis.fundsignal.scoring_formula_id`) and `@AC-36 @FR-4 @feature-224` (key `analysis.fundsignal.source_slug`) in `docs/sdd/business-rules/platform.feature` — must be classed as wired
- **PRESERVE** `@AC-35 @FR-14 @feature-224 @feature-225` "Two users with the same mcp_client slug use their own credentials" (`platform.feature`) — the check must not read or print secret values; stored form is the `key` column only
- No CHANGE flags. No existing `@AC-*` asserts that a seeded key is read, so `@feature-173` and `@feature-182` scenarios are not proof of wiring for the baseline keys.
- Coverage caveat: the suite listing was truncated at 100 of 165 files; non-config service suites were not individually read (no config-wiring surface).

## Dependencies

- Proto/RPC: none
- Migration: none (278 changes no schema). For the baseline's sake: tip is `030`; `031` claimed by 243 (`243-fix-sandbox-seed-keys`), `032` claimed by 244 (`244-fix-python-config-stored-zero`) and 248 (`248-fix-ledger-trimmed-notify-payload`), `033` unclaimed on `origin/main-dev` docs as of 277's recon.
- Config keys: none new. The check reads existing keys only.
- Inter-service edges: none
- New env vars / ports: none
- Cross-feature seams: 243 owns the `indicators.sandbox.*` heal (migration 031); 244 moves reader literals into helpers (it adds an `int_positive` getter over `ingest.`-prefixed keys); 261 (`261-fix-ingest-poller-backfill`) depends on `ingest.mcp_client.request_timeout_seconds` whose seed is bare. 264 also edits `docs/patterns/config-governance.md` (rebase-only overlap, keep 278's edit to the rule section).

## Baseline source (feature 277 sweep, `docs/roadmap/features/277-fix-ingest-seeded-config-keys/recon.md:86-103`)

Static-grep sweep, not yet a real check run; the exact final count is recorded by design after the first run.

| Group | Count | Kind | Owner to record |
|---|---|---|---|
| ingest bare-seeded, dotted-read: 005 `backfill.chunk_max_bars`, `chunk_window_days`, `max_concurrent_chunks`; 025 `mcp_client.poll_interval_seconds`, `request_timeout_seconds` | 5 | form-mismatch | 277 / 278 |
| analysis bare-seeded, dotted-read: 008 `fundsignal.*` x12; 019 `scoring.signal_decay_half_life_hours` | 13 | form-mismatch | 277 / 278 |
| indicators `sandbox.*` (001/002) | not enumerated | form-mismatch | 243 (until migration 031 lands) |
| dead seeds: analysis `backtest.max_duration_seconds` (001/002), ledger `stream.notify_enabled` (001) | 2 | seeded-unread | 277 / 278 |
| read, never seeded: ingest `backfill.max_concurrent_jobs` (`watcher.py:187`), `backfill.retry_on_failure` (`:191`) | 2 | read-unseeded | 277 / 278 |
| read, never seeded, **not in the product spec's baseline list**: ingest `backfill.max_retry_attempts` (`watcher.py:195`), `signals.dedup_window_hours` (`:215`) | 2 | read-unseeded | decide at design |
| unseeded analysis `fundsignal.retry_seconds`, `startup_jitter_seconds` (277 round-3 state, from the digest; not re-grepped) | 2 | read-unseeded | decide at design |

The 18 form mismatches = 5 ingest + 13 analysis, excluding indicators. The two ingest keys in the sixth row and the two analysis keys in the last row are outside the spec's stated list, so either the baseline grows or the first run shows them as unbaselined findings; design decides.

## Risks / Not-found

- **No existing wiring tooling**: no config-key check, baseline file or annotation convention exists under `scripts/`, `ci.yml` or the skills. Everything is built new.
- **Stored form must model post-migration state**: INSERTs plus `UPDATE ... SET key` heals (029; 031/032 pending). Row shapes and `ON CONFLICT` targets differ by era (005 uses `trading_mode`, 025 uses `COALESCE(user_id,'')`). The parser must handle multi-row VALUES and duplicate rows per environment.
- **Secrets**: `is_secret=true` rows are read with namespace-relative keys via `GetSecret`; treat as a separate class or exclude, or they produce false `form-mismatch` and `read-unseeded` findings. The check must never read or print values.
- **Reader indirection (244 refactor)**: literals moving into helpers, constants (`FactorMapKey`, `_ALERT_THRESHOLD_CONFIG_KEY`) and parameterized helpers (`resolvePositiveInt(cfg, key, def)`) mean the key string is not always at the getter call. Design must decide between literal extraction plus constant resolution, an explicit per-service registry, or an annotation, and define when a non-literal argument is `dynamic-read` (@AC-9). The product spec forbids silently skipping.
- **Cross-namespace and cross-watcher reads** (`fundsignal_loop.py:97` reads `marketdata.*` through another watcher), so a reader's key cannot be matched to a seed by the consuming service's namespace.
- **Multi-line calls** (`fundsignal_loop.py:148`) require a multiline-aware extractor; TS uses index syntax (`values['key']`) rather than getter calls.
- **Dynamic reads**: the digest found no runtime f-string getter in analysis `app/`, but only helper-parameter forms in Go and a constant-based form in portfolio; the regex used may miss other shapes. Not exhaustively confirmed.
- **Go and TS reader literals were counted, not enumerated**; trading and marketdata getters were not individually traced. The first real run supplies the true inventory.
- **FR-2 hook limits**: step bodies are immutable (`SKILL.md:487`), so the check must be an execute-time gate (Phase 3, before the `done` flip) rather than patched into a step's `**Verification**`. `config` and `migration` steps skip the TDD gate (`SKILL.md:285`), so for them the wiring check would be the only gate. It must be static and offline (`SKILL.md:290-297`); sequential mode (`reference/sequential-mode.md:112`) must mirror it. @AC-10 needs detection of a migration that inserts into `config.config_values`, not step category alone. `tooling-setup.md:34` says `config`/`docs` steps need no tooling unless the Verification names one.
- **FR-3 severity**: Mode B is advisory (`impl-spec-criteria.md:4`); the `C-14` row (`:31`) is the precedent for a prominent FAIL row in an advisory mode. @AC-6 and @AC-11 want "failing finding" wording. Design decides hard FAIL vs prominent WARN. Today no sdd-review text mentions config readers or `config.config_values`.
- **Declared-key source** (FR-2): the product spec for 278 says "No new config keys" and `Config Key Changes` is a free-form section, so extracting declared keys needs a format rule; the overlap-check regex `` `[a-z][a-z-]+\.[a-z]+\.[a-z_]+` `` (`overlap-check.md:25,53`) matches only three-segment dotted keys.
- **Applicable ledger traps**: `fails.md:2335` (readiness-materializer-config-keys, migration: seeded `key` must equal the reader string, verify by read-back, not a row count); `fails.md:2360` (every getter needs a read-path test over a realistically keyed populated snapshot; a defaulted read is silent); `fails.md:1040` (scan the whole tree, not the diff); `fails.md:2970-2978` (fix-sandbox-seed-keys: copying the 029 heal shape is unsafe when a dotted twin exists; not applicable because the check is read-only).
- **Not read**: `.claude/skills/sdd-design/reference/recon-checklist.md`, `scripts/setup-branch-protection.sh` (whether a required-check list exists beyond `ci-gate`), `scripts/check-duplication.sh` and `.jscpd.json` contents.
- **Standing operator rules**: x-trace-id propagation (2026-10-21) has no surface here; the check makes no requests and runs no staging or production reads or writes.

## Recommended Scope

Advisory, input to grilling and `/sdd-spec`:

1. Check script plus baseline file under `scripts/` (language and reader-discovery mechanism per design), with a test suite whose fixtures reproduce @AC-1 to @AC-3, @AC-9 and the negative matches above, including a 029-style rename heal and a secret row.
2. First real run on the current tree to fix the exact baseline contents and count; each entry names 277, 278 or 243 as owner (@AC-7, @AC-8).
3. CI: new path filter, job, `ci-gate` `needs:` and echo entries, and the new test appended to the structural-test line (or run by the job itself).
4. `/sdd-execute` gate in Phase 3 plus `reference/repo-conventions.md` detail and sequential-mode mirror (FR-2, @AC-4, @AC-5, @AC-10).
5. `/sdd-review impl-spec` B2 row (FR-3, @AC-6, @AC-11) and a pointer in sdd-story's `Config Key Changes` template if the declared-key format needs pinning.
6. `docs/patterns/config-governance.md` rule section (append-only, keep 182's entries); run `scripts/check-context-map.sh` after the doc and skill edits.
7. Ordering vs 243/244/261 is design's call: the check tolerates 244's refactor and keeps 243's `indicators.sandbox.*` baselined until its migration 031 lands.
