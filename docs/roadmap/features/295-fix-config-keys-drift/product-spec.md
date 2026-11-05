# Product Spec: fix-config-keys-drift

**Type**: bug
**GitHub Issue**: n/a — defect report `docs/reports/2026-11-04-config-key-drift-and-subscription-gaps-defect.md`
**Severity**: SEV-2
**Created**: 2026-11-04
**Re-scoped**: 2026-11-04 (operator decision 13) — this feature is **Release A (expand)**. Release B
(contract: rename to relative, DB CHECK, relative getter literals, prefixed-key rejection, alias
activation) is feature **296 `fix-config-keys-contract`**, which merges only after 295 is `launched`.

---

## Problem Statement

Config fails silently. In every case below, a reader quietly falls back to its code default.

1. **Naming drift.**
   - The stored `key` column sometimes embeds the namespace (`marketdata` /
     `marketdata.backfill.batch_size`) and sometimes not (`marketdata` / `alpaca.api_key`).
   - A reader resolves a value only when its getter string equals the raw stored key (CONFIG-9).
   - The bare seeds in `analysis`, `ingest` and `ledger` are read by **no** code. For example,
     staging `fundsignal.enabled=true` is ignored and the producer stays OFF.
   - Rows created ad hoc via `create_key` exist with blank metadata.
2. **Not live.**
   - The agent never subscribes.
   - The UI's `GetConfig` omits `environment`, so production shows staging values.
   - Several services cache values at startup.
   - **A confirmed live stall in staging indicators** kept serving `sandbox.timeout_ms=5000` after
     the row was set to 15000, with no error and no reconnect. Two halves can stall:
     - client: the Python/Go watchers have no keepalive or liveness detection;
     - server: config's pg `LISTEN` feed has no keepalive or heartbeat, so a half-open socket leaves
       the cache stale while `SetConfig` keeps persisting.
   - A caller-side hardcoded gRPC deadline (the agent `test_formula` 10 s) can also cap a configured
     server budget. That same 10 s cap makes the configured sandbox timeout unobservable via MCP.
3. **Missing and orphaned rows.** About 100 keys read by code have no row (some on purpose under
   the now-retired feature-227 waiver), and five seeded rows have no reader.

Adjacent defects, in scope:
- trading's untyped Go getters (a mismatch returns `0`/`""`);
- the Python fixed 2 s retry and the zero-delay reconnect on a clean EOF.

**Process root cause.** Feature 278's gate (`scripts/check-config-wiring.mjs`) exists, but:
- it shipped a **124-entry baseline** that accepts this drift;
- its form rule mirrors CONFIG-9's "no fixed convention", which contradicts C-05;
- it has no reader→namespace attribution;
- it ignores `value_type` and metadata;
- it models only migration files, never live rows.

## Functional Requirements

- **FR-1 — Form-tolerant config server, alias dormant.**
  - `SetConfig` resolves an existing row by `(namespace, key)` in either spelling at the request's
    scope, falling back to the global row. The found row selects **only the spelling**; scope and
    `user_id` always come from the request.
  - A first per-user override inserts a per-user row in the global row's spelling. It never updates
    the global row.
  - It returns `FAILED_PRECONDITION`, naming both spellings, when both spellings exist at the probed
    scope, or when the probed-scope row's spelling differs from the global row's spelling.
  - Allowlist grants, `SCALAR_BOUNDS_REGISTRY` and the `platform.trading_state` validation compare
    on canonical `(namespace, relative key)`.
  - The alias machinery (each value served under both spellings) ships **dormant**. It activates
    only when a DB marker written by feature 296's rename migration is observed.
  - Until then, `WatchConfig`/`GetConfig` output is byte-identical to today's.
  - A constraint violation maps to `INVALID_ARGUMENT`, never `INTERNAL`.
- **FR-2 — Config server change-feed liveness.**
  - The pg `LISTEN` feed gets its own liveness: a periodic self-`NOTIFY` heartbeat. A missed
    heartbeat triggers drop, reconnect and full resync.
  - A periodic full reload is a backstop, and broadcasts only on a content change.
  - The snapshot `version` is content-derived, so re-sends and no-op reloads are distinguishable from
    real changes.
- **FR-3 — Signed, replay-safe heal that preserves effective behavior.**
  - The heal deletes **only twin rows**: a non-secret row in a spelling no reader uses, whose read
    spelling exists in the same `(namespace, environment, COALESCE(user_id,''))` scope after seeding.
    The effective value therefore cannot change.
  - A row is deleted only if it matches the predicate **and** appears in a literal allowlist of
    global-only `(namespace, key, environment, sha256(value_data))` tuples. The allowlist comes from
    the operator-signed dry-runs of the staging and fresh-migrations inventories (FR-4). Per-user
    twins are reported, never deleted.
  - A row that is new or has changed since the inventory survives, and gets a report row.
  - Every delete writes a snapshot row and its own `config_audit` row first. The heal is replay-safe:
    a run-once latch, plus guarded casts, so it cannot abort into the dirty-recovery replay
    (`scripts/db-migrate.sh` `force 0`).
  - Secret rows are never deleted. Rows outside the model, keys read by several readers with
    different code defaults, and every discarded stored value that differs from the effective value
    are written to a persistent **heal report table**, which is the operator channel, and listed for
    sign-off.
  - Deleting **dead** rows (no reader in any spelling) is out of scope here. It belongs to feature
    296, gated on runtime evidence (FR-6).
  - **Secret-class twins** are never deleted, revealed, snapshotted with their value, or reported in
    plaintext; they are handed to 296. A twin is secret-class when its partner or either spelling's
    catalog entry is secret. Report values are NULL for every per-user row.
  - The heal is migration `036`. A dirty 036 is recovered by the runbook: probe → `migrate force 35`
    (or `force 34` when `config.config_markers` is absent) → `scripts/db-migrate.sh up`.
  - Until 296's contract floor exists, the automatic `force 0` fails at migration 001 and changes
    nothing.
- **FR-4 — Live inventory tool.**
  - A read-only Python operator tool, run from the **staging** indicators DO console in `/app`
    (`legacy_authors_ops` precedent: stdlib plus the image's existing DB driver). There is no
    production inventory: production does not exist yet and its first deploy runs fresh migrations
    (decision 24).
  - The fresh-migrations inventory is generated by a script, with no operator involved.
  - The tool **never** selects `value_encrypted`.
  - The committed output is per-row metadata, `sha256(user_id)`, `sha256(value_data)` and
    `sha256(default_value)`.
  - Plaintext `value_data` is printed only for global, non-secret, non-secret-class rows whose heal
    decision depends on content. A reveal request naming a per-user, secret or secret-class row exits
    2.
  - It prints an output digest and a sha256 of its own source.
- **FR-5 — Seed parity, no waiver.**
  - Every key read by any service has a global seed row per environment, in the **spelling its
    current reader uses**, with the reader's `value_type`, `value_data` = `default_value` = the code
    default, and non-empty `description` / `consuming_service`.
  - A key is never seeded when it is read as a secret (`GetSecret` readers) or when its readers
    disagree on the code default. Both cases are listed for sign-off.
  - The heal never UPDATEs an existing `value_data`.
  - It sets `default_value` to the agreed code default where it differs (documentation-only per
    CONFIG-2), with its own `metadata:` audit row. Keys whose readers disagree keep theirs.
  - An existing row is retyped only where its stored value equals the code default. Every other type
    or default divergence is listed for operator sign-off.
  - The feature-227 waiver is retired.
- **FR-6 — Runtime read-key evidence, used to gate dead-row deletion in 296.**
  - Every watcher records each distinct `(namespace, key)` its process actually reads, logging each
    once per key per process at INFO.
  - This lets feature 296 delete a dead row only when static analysis **and** a release of runtime
    read logs both show no reader.
  - Each watcher also logs `config.read_coverage` at the first snapshot and every 6 h. At each tick
    it re-emits `config.read_key` for every key it has read, so silence in a window where the service
    logged coverage means unread.
  - Evidence is staging Loki only.
  - 295 deletes no dead rows.
- **FR-7 — Every config value is live.** A change takes effect within one `WatchConfig` delivery,
  with no restart:
  - concurrency primitives resized in place: shrinking lets in-flight work finish, and a timed-out
    or cancelled call holds its slot until its thread actually finishes;
  - marketdata vendor clients (rate limits, base URLs, metrics, EDGAR user agent, stream reconnect
    parameters);
  - `fundamentals.provider` and its derived key selection, without resetting the shared FMP budget;
  - marketdata secrets, re-resolved with bounded retry;
  - trading's broker HTTP timeout;
  - analysis's read of `marketdata` `fundamentals.provider`.
- **FR-8 — Agent subscribes.**
  - A lifespan-owned `WatchConfig` subscription (the scoped AGENT-1 amendment) serves the agent's
    policy reads.
  - The user-facing `get_config` tool stays a bounded `GetConfig`.
  - Startup blocks on the first snapshot of both lifespan subscriptions (`agent`, `indicators`), as
    every other service does. Only these two channels are long-lived (scoped AGENT-1 amendment).
- **FR-9 — UI reads its own environment.** Every UI `GetConfig` sends the deployment's native
  `environment`.
- **FR-10 — Watcher resilience (Go, Python, Node, agent).**
  - Keepalive compatible with the servers' enforcement policy.
  - Exponential backoff with jitter. It resets only after a stream has stayed healthy for **at
    least half the liveness deadline** (15 s of a 30 s deadline), so a snapshot-then-EOF server never
    resets it. The backoff also applies after a clean EOF.
  - A client liveness deadline, satisfied by the server's periodic re-send of the current payload.
  - The last snapshot keeps serving reads while reconnecting.
  - trading keeps a separate map per namespace.
- **FR-11 — Uniform getter rule (all languages).**
  - int→float is widened losslessly. Every other type mismatch returns the code default with a
    rate-limited WARN naming the FQN.
  - A read of a key absent from a received snapshot also WARNs (rate-limited), because under FR-5
    every read key is seeded.
  - trading's untyped getters are brought to this rule.
- **FR-12 — Derived deadline, no hidden cap.**
  - The agent `test_formula` deadline is derived from indicators' configured
    `sandbox.timeout_ms` + `sandbox.startup_grace_ms` (the grace becomes a seeded config key,
    replacing the private constant) + 2 s slack, clamped to the agent's **45 s long-RPC budget**. That
    budget leaves room inside the feature-273 57 s whole-tool ceiling.
  - Write bounds `indicators.sandbox.timeout_ms` [100, 33000] and `indicators.sandbox.startup_grace_ms`
    [1000, 10000] keep timeout + grace + slack ≤ 45 s. The heal report lists any stored value outside
    the bounds.
  - Indicators clamps the sandbox timeout to the request's remaining deadline, so time spent queued
    cannot hide a cap.
  - Clamping logs a WARN. Deadline errors surface their message.
- **FR-13 — Extend feature 278's gate, drain its baseline.** `scripts/check-config-wiring.mjs`
  joins readers to rows by `(namespace, key)` in the exact current spelling, and adds:
  - reader→namespace attribution with no default (an unattributable read blocks);
  - `value_type`↔getter-arm, metadata-missing and `default_value`↔code-default checks;
  - a doc check asserting that C-05, CONFIG-9 and `config-governance.md` state the FR-14 rule;
  - a baseline that holds only `seeded-unread` entries owned by feature 296 (dead rows kept for its
    evidence-gated deletion). Any other finding, and any entry not in the signed fresh dry-run, fails
    CI (decision 22).

  No second gate is built.
- **FR-14 — Documented convention.**
  - C-05, CONFIG-9, `docs/patterns/config-governance.md`, `docs/runbooks/config-rollout.md`, the
    root `CLAUDE.md` § Config Governance and every service `CLAUDE.md` config table state one rule:
    the stored key equals the reader's exact spelling, and every read key is seeded.
  - They declare the namespace-relative target form and point to feature 296 for the cutover.
  - `config-rollout.md` adds the post-deploy read-back and inventory procedure.
- **FR-15 — SDD skills require a full config-key contract.**
  - The contract: namespace, key, `value_type`, code default, reader `path:symbol`, seed migration,
    live mechanism.
  - Required in `/sdd-story`, `/sdd-spec` (a config-key step pairs a seed migration), `/sdd-review`
    (product-spec criterion 6, impl-spec B2), `/sdd-execute` (repo-conventions), and the
    `spec-reviewer` / `codebase-discovery` agents.
  - A key listed without the full contract fails review.

## Reproduction Steps

1. Staging config-ui: set `analysis` / `fundsignal.enabled=true`. The fundamentals producer never
   runs, because `fundsignal_loop.py` reads `analysis.fundsignal.enabled`.
2. Set production `platform.trading_state=HALTED` while staging is `ACTIVE`. Production
   `/trader/positions` shows no halt banner.
3. Set staging `indicators.sandbox.timeout_ms=15000`. A long formula still fails with
   `Formula execution timed out after 5000ms` (stale indicators snapshot; operator-observed
   2026-11-04).
4. Set any marketdata vendor-client knob. Nothing changes until restart.

## Root Cause Hypothesis

See Problem Statement and the defect report for `path:line` evidence per service.

## Affected Services

xstockstrat-config, xstockstrat-trading, xstockstrat-portfolio, xstockstrat-marketdata,
xstockstrat-indicators, xstockstrat-ingest, xstockstrat-analysis, xstockstrat-ledger,
xstockstrat-identity, xstockstrat-notify, xstockstrat-agent, xstockstrat-ui. Also repo tooling:
`scripts/check-config-wiring.mjs`, `scripts/config-wiring.json`, the SDD skills and agents.

## Consumer Surface(s)

- **`/config-ui`.**
  - About 100 previously invisible keys appear with type, default and description.
  - Twin rows in a spelling nobody reads disappear.
  - Edits update the row the service actually reads.
- **`/trader`.** The `platform.trading_state` banner on `/trader/positions` reflects the
  deployment's own environment.
- **`/insights`.** The performance dashboard's risk-free rate and equity-curve start date reflect
  the deployment's own environment.
- **Agent MCP tools.**
  - `test_formula` honours the configured sandbox timeout, and its deadline errors carry a message.
  - `ingest_signal`, `list_opportunities`, the `extract_*` tools and OAuth registration react to
    `agent` config changes live.
- **Operators.**
  - Every config change takes effect without restart (a documented platform guarantee).
  - A DO-console inventory tool shows exactly what is stored.

## Proto Contract Changes

- None expected. The liveness re-send rides the existing DELTA, and `version` is an opaque string.
- If design needs one, it must be **additive** (one owner approval). A breaking change stops for
  2 owners + platform lead.

## Config Key Changes

- Every key in every namespace is affected: seeded (FR-5), twin-deleted (FR-3) or retyped where
  stored == default (FR-5).
- **No key's spelling changes in this feature.** That is feature 296.
- New seeded keys: `indicators.sandbox.startup_grace_ms` (FR-12).
- New write bounds: `indicators.sandbox.timeout_ms`, `analysis.compute.max_worker_threads`.
- The per-key contract table is generated from the extended gate and lands in
  `implementation-spec.md` and `docs/patterns/config-governance.md`.

## Database Changes

- New `xstockstrat-config` migrations only: `035_config_markers` (DDL) and
  `036_heal_config_keys_to_reader_catalog`. Re-check the numbers at spec time. Each has `.up.sql` and
  `.down.sql`.
- **No applied migration is edited** (F-01).
- Run order: db-migrator PRE_DEPLOY. Staging heals on the `main-dev` merge. Production's first
  deploy runs fresh migrations (decision 24).
- Migration rules:
  - snapshot table first;
  - own `config_audit` rows;
  - twin predicates scoped by `COALESCE(user_id,'')`;
  - a heal report table, never `RAISE EXCEPTION`, for out-of-model rows;
  - a run-once latch and guarded casts, so the heal is replay-safe;
  - downs restore with `ON CONFLICT DO NOTHING`;
  - assertions in `scripts/migration-assertions/` (031 harness shape) plus a dedicated config `goto`
    pass;
  - verification by per-key per-environment read-back on staging, and at production's first deploy
    a read-back diffed against `heal/dryrun-fresh.tsv` (G3), never row counts.
- No CHECK constraint here (feature 296).

## Trading-Domain Notes

- Config reads for `BrokerType` ALPACA and IBKR are in scope. Order routing, order types and fills
  are unaffected.
- **Paper-safe.** Testable on staging. FR-3/FR-5 guarantee no effective value changes at deploy,
  except items listed for operator sign-off.

## Fix Scope (operator decisions, 2026-11-04 — see `context.md` decisions 1–18)

- The relative canonical key is the **target**, delivered by 296.
- Keep effective behavior.
- Everything live.
- UI env, watcher resilience, Go getter types.
- Twin-only signed heal; dead-row deletion deferred to 296, gated on runtime read evidence.
- feature-227 waiver retired.
- Lossless int→float widening.
- Live inventory via a DO-console Python tool.
- Alias activates only after the rename.
- Release B split into feature 296.
- Derived `test_formula` deadline.

## Acceptance Criteria

See `acceptance.feature`. Every scenario except `@preserve` ones must fail on the current code (red)
and pass after the fix (Constitution **C-15**). `@preserve` scenarios are green by design and must
stay green. In addition, existing tests pass and the affected services are
smoke-tested on dev.

## Out of Scope

- Any key-spelling change, the DB CHECK, relative getter literals, prefixed-key rejection, alias
  activation, FQN display in config-ui, and dead-row deletion. These are feature **296**.
- Removing the alias / form tolerance. That is the follow-up after 296.
- Changing any key's *effective* runtime value. The exceptions are restart→live semantics, the
  defects above, and items the operator signs off.
- Re-applying operator intents stored on dead rows. That is an operator action using the FR-3 list.
- A shared watcher library across services. Named follow-up refactor; 295 uses guarded per-service
  copies.
- Feature 243's remaining Step 5. 295 merges after 243 closes.
