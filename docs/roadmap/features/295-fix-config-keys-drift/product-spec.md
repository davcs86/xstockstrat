# Product Spec: fix-config-keys-drift

**Type**: bug
**GitHub Issue**: n/a — defect report `docs/reports/2026-11-04-config-key-drift-and-subscription-gaps-defect.md`
**Severity**: SEV-2
**Created**: 2026-11-04

---

## Problem Statement

Config fails silently. In every case below, a reader quietly falls back to its code default.

1. **Naming drift.**
   - The stored `key` column sometimes embeds the namespace (`marketdata` /
     `marketdata.backfill.batch_size`) and sometimes not (`marketdata` / `alpaca.api_key`).
   - A reader resolves a value only when its getter string equals the raw stored key (CONFIG-9).
   - The bare seeds in `analysis`, `ingest` and `ledger` are read by **no** code. For example,
     staging `fundsignal.enabled=true` is ignored and the producer stays OFF.
2. **Not live.**
   - The agent never subscribes; it does a one-shot `GetConfig` on a fresh channel per call.
   - The UI's `GetConfig` omits `environment`, so production shows staging values.
   - marketdata (vendor clients, provider, secrets), analysis (semaphores, executor,
     cross-namespace provider read), ingest, indicators and trading (broker HTTP timeout) cache
     values at startup.
   - The Python and Go watchers have no keepalive or stall detection. A half-open stream freezes the
     last snapshot.
   - A caller-side hardcoded gRPC deadline can silently cap a configured server budget: the agent
     `test_formula` uses a fixed 10 s deadline against `indicators.sandbox.timeout_ms=15000`. This is
     the operator-observed indicators symptom.
3. **Missing and orphaned rows.**
   - About 100 keys read by code have no row, so config-ui cannot show or tune them.
   - Some keys are left unseeded on purpose under the feature-227 waiver (in-flight 281/282 use it).
   - Five seeded rows have no reader.

Adjacent defects, in scope:
- trading's Go getters do not check the stored type (a mismatch returns `0`/`""`).
- The Python watchers retry on a fixed 2 s delay and reconnect with no delay after a clean EOF.

**Process root cause (refined).** The parity gate exists: launched feature 278 ships
`scripts/check-config-wiring.mjs` and the CI job `config-wiring`. But:
- (a) it shipped a **124-entry baseline** (19 `form-mismatch`, 5 `seeded-unread`,
  100 `read-unseeded`) that accepts this exact drift, with no owner to fix it;
- (b) its stored-form rule mirrors CONFIG-9's "no fixed convention", which contradicts C-05 /
  `config-governance.md`;
- (c) it checks neither `value_type` against the getter arm, nor live-vs-restart reads, nor
  caller-deadline coupling;
- (d) the feature-227 waiver lets keys go unseeded on purpose.

Demoted feature 277 tried a 5→18-key subset and was stopped because its scope grew round by round.
295 fixes the scope up front.

## Functional Requirements

- **FR-1 — Canonical namespace-relative key.** The stored `key` never begins with
  `<namespace>.`. The fully-qualified name (FQN) `<namespace>.<key>` exists only in docs, config-ui
  display and logs. Enforcement:
  - a DB `CHECK (key NOT LIKE namespace || '.%')`;
  - `SetConfig`, `GetSecret` and `create_key` reject a prefixed key with `INVALID_ARGUMENT`.

  Applies to secrets too: they are already relative (`alpaca.api_key`, `mcp_credential.<uuid>`)
  and stay unchanged.
- **FR-2 — Every consumer addresses keys relative to its subscribed namespace.**
  - All getter literals in all 11 consuming services are rewritten. A service that reads another
    namespace (analysis → `marketdata`) reads it through that namespace's own subscription.
  - `SCALAR_BOUNDS_REGISTRY`, `INTERNAL_CALLER_ALLOWLIST` and `SECRET_CALLER_ALLOWLIST` are keyed by
    `(namespace, key)`.
  - config-ui and the agent `set_config` / `get_config` tools display FQNs and write relative keys.
- **FR-3 — Heal migration preserves effective behavior.**
  - Where a stored row has a twin in the other spelling, the row the current code reads wins.
  - A dead row (no reader under the current code) with no live twin is dropped. Its canonical key is
    seeded with the reader's code default.
  - Every changed or removed row is copied to a premigration snapshot table first.
  - Every rename writes a `config_audit` row.
  - The migration output lists every discarded stored value that differs from the effective value,
    for the PR and the operator.
- **FR-4 — Zero-downtime rollout.** At no point during deploy or rollback does a running consumer
  (old or new image) resolve its code default for a key that has a stored value. This holds:
  - between the PRE_DEPLOY migration and the config pod rollout;
  - across mixed old/new consumer pods;
  - on rollback to the previous image.

  The transitional compatibility mechanism is temporary. Its removal is a **named follow-up
  feature**, created by this feature.
- **FR-5 — Seed parity, no waiver.**
  - Every key read by any service has exactly one global seed row per environment (`staging`,
    `production`).
  - The row's `value_type` matches the reader's getter arm, and `value_data` / `default_value`
    equal the code default.
  - `description` and `consuming_service` are non-empty.
  - The feature-227 unseeded waiver is retired.
- **FR-6 — Orphan deletion.** Rows with no reader are deleted after a snapshot. Today these are
  `ledger stream.notify_enabled`, `marketdata alpaca.paper`, `platform log_level`,
  `trading risk.daily_loss_limit` and `analysis opportunity.sparkline_bars`; the authoritative list
  comes from the gate at spec time.
- **FR-7 — Every config value is live.** A change takes effect within one `WatchConfig` delivery,
  with no restart. In particular:
  - concurrency primitives are resized without cancelling in-flight work: indicators
    `sandbox.max_concurrent`, ingest `backfill.max_concurrent_jobs`, and analysis' semaphores and
    compute executor;
  - marketdata Alpaca/EDGAR/FMP/Finnhub clients, `fundamentals.provider` and its derived key
    selection;
  - marketdata secrets (re-resolved via `GetSecret` when their row changes);
  - trading's broker HTTP timeout;
  - analysis' read of `marketdata` `fundamentals.provider`.
- **FR-8 — Agent subscribes.** The agent holds a `WatchConfig` subscription to `agent`. It no
  longer opens a config channel per read.
- **FR-9 — UI reads its own environment.** Every UI `GetConfig` sends the deployment's native
  `environment`.
- **FR-10 — Watcher resilience** in the Go, Python and Node watchers:
  - gRPC keepalive;
  - exponential backoff with jitter, reset after a healthy stream;
  - backoff on a clean EOF;
  - a liveness deadline. A stream silent for longer than it is abandoned and redialled.

  The last snapshot keeps serving while reconnecting.
- **FR-11 — Uniform getter type rule (all languages).**
  - A stored `int` read by a float getter is widened losslessly.
  - Every other mismatch returns the code default and logs a rate-limited WARN naming the FQN.
  - trading's untyped getters are brought to this rule.
- **FR-12 — No hidden caps.** A caller's deadline on an RPC whose server budget is configurable
  derives from that budget. It is never a hardcoded value below it. Known instance: agent
  `test_formula` → indicators `ExecuteFormula`.
- **FR-13 — Extend feature 278's gate, drain its baseline.**
  - `scripts/check-config-wiring.mjs` enforces the FR-1 relative form.
  - It adds `value_type`↔getter-arm checking (FR-11) and a check that seeded metadata is
    non-empty.
  - It ends with an **empty** baseline. Adding a new baseline entry fails CI.
  - No second gate is built.
- **FR-14 — One documented convention.** C-05 (`docs/sdd/constitution.md`), CONFIG-9
  (`services/xstockstrat-config/docs/context-constitution.md`), `docs/patterns/config-governance.md`
  (incl. the 227 waiver entry), `docs/runbooks/config-rollout.md`, the root `CLAUDE.md` § Config
  Governance and every service `CLAUDE.md` config table all state the FR-1 convention, in FQN
  display form.
- **FR-15 — SDD skills require a full config-key contract.**
  - The contract: namespace, relative key, `value_type`, code default, reader `path:symbol`, seed
    migration, live mechanism.
  - Required in `/sdd-story` (`## Config Key Changes`), `/sdd-spec` (a config key step must pair a
    seed migration), `/sdd-review` (product-spec criterion 6, impl-spec), `/sdd-execute`
    (repo-conventions), and the `spec-reviewer` / `codebase-discovery` agents.
  - A spec that lists a key without the full contract fails review.

## Reproduction Steps

1. Staging config-ui: set `analysis` / `fundsignal.enabled=true`. The fundamentals producer never
   runs, because `fundsignal_loop.py` reads `analysis.fundsignal.enabled`.
2. Set production `platform.trading_state=HALTED` while staging is `ACTIVE`. Production
   `/trader/positions` shows no halt banner.
3. Set staging `indicators.sandbox.timeout_ms=15000`. An MCP `test_formula` whose formula runs for
   12 s fails with `DEADLINE_EXCEEDED` at about 10 s.
4. Set any marketdata vendor-client knob. Nothing changes until restart.

## Root Cause Hypothesis

See Problem Statement § Process root cause, and the defect report for `path:line` evidence per
service.

## Affected Services

xstockstrat-config, xstockstrat-trading, xstockstrat-portfolio, xstockstrat-marketdata,
xstockstrat-indicators, xstockstrat-ingest, xstockstrat-analysis, xstockstrat-ledger,
xstockstrat-identity, xstockstrat-notify, xstockstrat-agent, xstockstrat-ui. Also repo tooling:
`scripts/check-config-wiring.mjs`, `scripts/config-wiring.json`, the SDD skills and agents.

## Consumer Surface(s)

- **`/config-ui`.**
  - About 100 previously invisible keys appear, with type, default and description.
  - Orphan rows disappear.
  - Keys display as FQNs.
  - A prefixed key typed into create/edit is refused with a clear message.
- **`/trader`.** The `platform.trading_state` halt/reduce-only banner on `/trader/positions`
  reflects the deployment's own environment.
- **`/insights`.** The performance dashboard's risk-free rate and equity-curve start date reflect
  the deployment's own environment.
- **Agent MCP tools.**
  - `get_config` / `list_config_keys` / `set_config` display FQNs and accept relative keys under a
    namespace.
  - `test_formula` honours the configured sandbox timeout.
  - `ingest_signal`, `list_opportunities`, the `extract_*` tools and OAuth registration react to
    `agent` config changes live.
- **Operators.** Every config change takes effect without restart. This is now a documented
  platform guarantee.

## Proto Contract Changes

- To be decided in `/sdd-design`. Any change must be **additive and non-breaking**: a new enum
  value with an `_UNSPECIFIED = 0` sentinel already present, or a new field. One owner approval.
- If design needs a breaking change, it stops for 2 owners + platform lead approval
  (`docs/runbooks/approval-flow.md`).
- Candidates: a heartbeat update type for FR-10 liveness, or none if gRPC keepalive suffices.

## Config Key Changes

All keys in all namespaces are affected: renamed (FR-1/FR-3), seeded (FR-5) or deleted (FR-6). Each
key keeps its current namespace, `value_type` and code default; no key's effective value changes
(FR-3). The per-key contract table (namespace, relative key, type, default, reader, live mechanism)
is generated from the extended gate and lands in `implementation-spec.md` and
`docs/patterns/config-governance.md`.

## Database Changes

- New `xstockstrat-config` migrations only. The next free NNN is **035** (main-dev ends at
  `034_retire_portfolio_snapshot_interval`); re-check at spec time.
- Each has `.up.sql` and `.down.sql`.
- **No applied migration is edited** (F-01). `029`/`031` stay as they are, and the heal is a new
  migration.
- Run order: db-migrator PRE_DEPLOY (`.do/app*.yaml`), so staging heals on the `main-dev` merge and
  production on promotion.
- Carried from feature 277's synthesis (mandatory design input):
  - twin-aware rename (`config_values_scope_uniq` aborts a blind UPDATE);
  - the migration writes its own `config_audit` rows (a key-only UPDATE fires no audit trigger);
  - a premigration snapshot table;
  - a dedicated `goto` pass in `scripts/migration-rerun.sh`, because pass 0 migrates to head before
    the assertions;
  - per-key per-environment read-back verification, never row counts;
  - a `RAISE` inside PRE_DEPLOY leaves golang-migrate dirty and blocks every deploy, so preflight
    conditions must be checked in CI fixtures.
- The CHECK constraint (FR-1) lands only once no writer can produce a prefixed key (ordering per
  FR-4). Its down drops the constraint.

## Trading-Domain Notes

- Config reads for `BrokerType` ALPACA and IBKR are in scope (`trading.broker.*`, `trading.ibkr.*`
  seeds; live broker HTTP timeout). Order routing, order types and fill handling are unaffected.
- **Paper-safe.** Every behavior is testable on staging (paper). FR-3 guarantees no effective value
  changes at deploy in either environment.

## Fix Scope (operator decisions, 2026-11-04 — see `context.md`)

- Relative canonical key (overrides CONFIG-9 and the full-dotted direction of features 189/243).
- Heal: keep effective behavior.
- Everything live.
- In scope: UI env bug, watcher resilience, Go getter type-safety, orphan deletion.
- feature-227 waiver retired.
- Lossless int→float widening.

## Acceptance Criteria

See `acceptance.feature`. Every scenario must fail on the current code (red) and pass after the fix
(Constitution **C-15**). In addition, existing tests pass and the affected services are
smoke-tested on dev.

## Out of Scope

- Changing any key's *effective* runtime value. The exceptions are restart→live semantics and the
  defects listed above.
- Re-applying operator intents stored on dead rows. That is an operator action after deploy, using
  the FR-3 discarded-values list.
- Removing the FR-4 transitional compatibility mechanism. That is the named follow-up feature.
- Feature 243's remaining Step 5 (operator staging read-back gate). 295 merges after 243 closes.
