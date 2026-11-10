# Context: fix-config-keys-drift  (archived 2026-11-10)

**Feature**: ./feature.md
**Status**: launched — archived by /sdd-archiver; verbose specs pruned (recoverable via git history).

## Archive Synthesis — 2026-11-10 — /sdd-archiver

**What**: This feature shipped only Release A, the "expand" half of the config-key canonicalisation. Release B (rename + CHECK + dead-row deletion) was split out as feature 296. Release A delivered:
- **Config server writes.** Writes in either spelling are accepted; when both spellings exist, the server returns FAILED_PRECONDITION.
- **Alias.** A dormant alias, activated by a marker row.
- **Change feed.** A self-heartbeat on the LISTEN socket, a content-hash version, a 10 s full re-send, a 5-min backstop, and a stall watchdog.
- **Migrations.** `040_config_markers`, plus `041`, a latched, operator-signed heal that deletes twins only.
- **Watchers.** All 9 subscribing services plus the agent got hardened watcher cores: 10 byte-identical copies (Go ×3, Python ×4, Node ×3).
- **Live config.** Limits, the compute pool, vendor clients, the provider choice, secrets and the broker timeout now apply without a restart.
- **UI.** It now sends the environment.
- **Gate.** 278's gate was extended and its baseline drained.

In the staging DB, 041 deleted 34 signed twin rows (17 per environment), deliberately kept 5 unsigned twins and reported 1 per-user row. The kept twins return FAILED_PRECONDITION until 296. The confirmed indicators "read once at startup" symptom (repro 3) now changes live.

**Why (irrecoverable rationale)**:
- **The root cause was process, not code.**
  - C-05 and CONFIG-9 contradicted each other.
  - Feature 278's gate already saw the drift, but it shipped a baseline of 124 accepted findings with no fixing owner.
  - So 295 extended 278's checker and drained that baseline instead of building a second gate (C-18).
- **The indicators symptom was a live watcher stall, not the agent's 10 s deadline.** The error said "Formula execution timed out after 5000ms" while the DB held 15000, and it was seen after migration 031. The MCP path cannot observe the sandbox timeout at all: under 10 s succeeds, and over 10 s hits the agent deadline first.
- **Namespace-relative is canonical (decision 1).** This overrides CONFIG-9 and the full-dotted direction of features 189/243.
- **"The row the code reads wins" (decision 2).** Dead-row intents are discarded and listed for deliberate re-application, never auto-applied.
- **Release B became a separate feature 296 (decisions 12–13).**
  - DO runs the migrator PRE_DEPLOY, and a rollback restores images, not schema.
  - `/promote` moves all of main-dev at once, so the alias and the rename in one promotion would break rollback.
  - Lifecycle tooling has never been proven for two integration PRs in one feature.
- **The alias activates only after the rename marker (decision 12).** This reverses 277's no-NOTIFY choice, because a rename changes which spelling exists. Until then the output stays byte-identical, so unmodelled rows get zero exposure.
- **Dead-row deletes were deferred to 296 and gated on runtime read evidence (decision 15),** because the static extractor has blind spots.
  - `read_key` is re-emitted every 6 h, so silence means "unread".
  - A coverage heartbeat makes silence count only for services that were actually logging.
  - UI-read namespaces can never be proven dead.
- **There is no production database (decisions 19, 24).** The fresh-migrations inventory therefore stands in for production's first deploy, and the evidence is from staging Loki only.
- **The inventory is a Python tool run from the DO console (decision 11),** because the operator cannot run SQL there.
  - It commits hashes. Plaintext is committed only for rows whose heal decision depends on content (decision 16).
  - It prints its own source sha256, so the paste can be verified.
- **Readers-disagree keys are never seeded or default-synced.** The seeded value would fail open: `platform.trading_state` defaults to HALTED in trading (fail-closed) but has no default in the UI.
- **Per-user twins are reported, never deleted (P-01 ruling, round 3).** Hashed user_ids cannot be matched exactly in the dry-run, and a per-user unread twin cannot change the effective value.
- **The FR-12 deadline is derived, not a fixed 56 s (decision 14).**
  - The grace became a seeded key, so the agent does not duplicate indicators' private constant.
  - The cap is the 45 s long-RPC budget, leaving margin under feature 273's 57 s (decision 17).

**Rejected alternatives**:
- **Full-dotted canonical key.** The operator chose relative.
- **Alias always on from Release A.** It would expose unmodelled rows under a second name at the first deploy.
- **Prefix-tolerant readers.** Rejected by 277, and they break when consumers roll out before config.
- **Heal computed from the migration-only model.** Ad-hoc `create_key` rows are invisible to it.
- **Server re-send as the only liveness signal.** It masks a dead LISTEN feed.
- **Proto `HEARTBEAT` update type.** Old Python/Node watchers replace the whole snapshot on any message, so an empty heartbeat would wipe them.
- **Heartbeat on a shared pool slot.** It false-drops a healthy LISTEN under load.
- **Catalog-predicate DELETE over a namespace set.** Not replay-safe under config's dirty-recovery `force 0` replay, and not signed.
- **JS emulation of the heal.** A second implementation; replaced by running the real SQL on a scratch Postgres.
- **DB-backed gate on every run.** Cannot run in local SDD harnesses; replaced by a committed stored JSON plus a CI freshness job.
- **`policy.seededUnread=reported`.** It silently regresses `@feature-278 @AC-7`.
- **Schema-level `BASELINE_KINDS` narrowing.** It breaks the AC-7 fixture; done as a `--final` check instead.
- **Pool `connectionTimeoutMillis`.** It changes failure semantics for every waiter.
- **Swap-and-drain executor.** It runs the old and new pools at once and breaks the @feature-176 bound.
- **Shared watcher library.** Too much scope (10 Dockerfiles plus go.mod/pyproject/pnpm wiring); kept as guarded copies instead.
- **Heal numbered 035 with the marker at 036.** golang-migrate never applies a version below the current one, so a DB already past the marker would skip the heal. The heal would also sit below 296's floor.
- **Auto-recovery inside `db-migrate.sh`.** A new mechanism; 296's contract floor is the structural fix.
- **Zero-code latch veto.** No DB needs it, and a vetoed DB would lose every seed.
- **Standing CI signoff branch.** It would fire once or twice in its lifetime.
- **Descriptions parsed from service CLAUDE.md files.** Fragile, and frozen with stale wording.
- **Committing production values or user_ids.** Replaced by hashes.
- **Non-blocking agent boot.** Contradicts @feature-279 @AC-17.
- **Tolerating a non-numeric `time_remaining()` in production code.** The operator rejected it, and the test contexts were fixed instead.
- **Seeding `trading.broker.paper` per environment.** It would reopen G2, so it was kept as a defect-owned baseline entry.

**Scars & gotchas**:
- **Dirty-041 recovery.**
  - An automatic `force 0` replays 001, which fails (001:49-51). It rolls back fully only because golang-migrate runs each file as one implicit transaction.
  - After that the version reads `1 (dirty)`, so the recovery probe must be table-based: `to_regclass('config.config_markers')` → `force 40` or `39`.
  - Never use `db-migrate.sh force`.
  - The runbook `docs/runbooks/config-rollout.md` carries the recovery table.
- **SQL-matching test fakes.** Nine config test suites matched the literal `SELECT is_secret FROM config.config_values`. Changing the probe to `SELECT key, is_secret` broke 62 tests outside the step's Files.
- **Skip-unchanged broke feature-258 tests.** It broke 258's reconnect re-broadcast tests and `watchConfigWireZero`, which led to decision 32.
- **Limiter wake-up.** `asyncio.Condition` cannot be notified from a synchronous `on_change` hook, so the limiter uses a deque of waiter futures. `run_bounded` must `asyncio.shield` the executor future, or a cancelled caller frees a slot whose thread is still running.
- **Moving getters into a shared core changes what the gate extractor sees.** It reported a new `dynamic-read` at `WatchCore._lookup` / `configWatcher.ts:lookup`. `config-wiring.json` `registry.dynamic` entries had to be swapped, outside the step's Files.
- **Stored-JSON row attribution.** 017's environment rewrite stamped most rows with "017", so the generator applies migrations with `migrate up 1` to record each row's inserting migration.
- **Staging dry-run loader bug.** It read an empty catalog `code_default` as NULL, while 041 compares against `COALESCE(...,'')`. Six string rows falsely tripped the sentinel guard. This was found only at G2.
- **Integration-PR CI failures.**
  - AC-28 asserted "the latest run deleted nothing", but under a latched no-op the latest run IS the first run, which legitimately deletes the 38 signed twins.
  - A `-- fixture` tuple for the operator-unsigned staging `fundsignal.enabled` could never be signed. A fixture tuple inside a migration is live on every real DB. The AC-3 fixture moved to the signed production `backtest.max_duration_seconds=120` twin.
- **Production's bare `backtest.max_duration_seconds=120` is a migration seed.** Signing it means production reads 300 after its first deploy.
- **G2 blind spot.** `default-synced` decisions cannot be seen in the staging dry-run, because the loader takes defaults from the catalog. The staging report showed 15 extra `default-synced` rows, each with `value_data` unchanged.
- **The DO console cannot host a pasted file (no `cat`).** So the inventory tool shipped to main-dev early, as PR #1462.
- **The keepalive spike found no `too_many_pings`.** `@grpc/grpc-js` 1.14.5 has no ENHANCE_YOUR_CALM enforcement, so the fallback server options were never applied.
- **pg 8.20 `query_timeout` bounds query reads but not the `connect()` wait.**
- **Trading getter behaviour change.** On a type mismatch, trading getters used to return the proto zero value. They now return the code default with a WARN, and int→float widens.
- **The batch workflow could not run the DB-dependent steps.** `sdd-batch-execute` preflight halts on "no database running" and on F-08 out-of-Files blockers, so Steps 27 and 36 ran directly in the operator session. Every throwaway Postgres needed its own decision-29-style allowance (Steps 4, 13, 34, 35, 36).
- **Stale discovery digests.** Digests repeatedly described another worktree's uncommitted sketch (Steps 14, 15, 18, 19, 28).

**Permanent deviations**:
- **Migration numbers.**
  - Design: `035_config_markers` / `036` heal, recovery `force 35/34`.
  - Shipped: `040` / `041`, recovery `force 40/39`; 296 anchors `contract-of` on `040`.
  - Because: 035–039 were reserved by PR #1359, 281 and 282.
- **Skip-unchanged scope.**
  - Design: skip any broadcast whose version is unchanged.
  - Shipped: the skip applies only to NOTIFY-driven and backstop broadcasts. Reconnect `resyncAll`, marker resync and direct `broadcastToSubscribers` always deliver.
  - Because: this preserves the 258 tests and `@feature-258 @AC-1` (decision 32).
- **Limiter.**
  - Design: `ResizableLimiter` notifies an `asyncio.Condition`.
  - Shipped: a waiter-future deque, with `run_bounded` using a done-callback on a shielded future.
  - Because: see Scars.
- **Alpaca.**
  - Design: `func() Cfg` closures.
  - Shipped: `alpaca.NewLiveClient(settings func())` alongside the kept `NewClient(ClientConfig)`, and `stream.go` made live as well.
  - Because: 25 test call sites use `ClientConfig`, and without the stream change the WebSocket would authenticate with boot credentials.
- **Trading broker timeout.**
  - Design: a new `func() time.Duration` accessor.
  - Shipped: the existing `brokerCallTimeout` reused as a package function, with every `httpClient.Do` routed through `(*Client).do` + `cancelOnClose` so the deadline also bounds the body read. `staleThreshold` gains the ≤0 fallback.
  - Because: the DRY guard rail.
- **Node change hook.**
  - Design: `OnChange(version)` in every core.
  - Shipped: none in the Node core; the existing `update` event is the hook.
- **Readers-disagree detection.**
  - Design: 036 groups catalog rows by (ns, key).
  - Shipped: an explicit `readers_disagree` column in `scripts/config-heal/catalog.tsv`.
  - Because: `catalog_041` holds one row per key, so grouping cannot find disagreement.
- **Baseline end state.**
  - Design: only 296-owned `seeded-unread` entries.
  - Shipped: 6 entries, namely 5 dead keys owned by 296 plus `trading.broker.paper`, owned by its open defect.
  - Because: its env-derived default cannot be seeded.
- **041 down.**
  - Design: re-insert the latest run's `twin-deleted` rows.
  - Shipped: restore each scope from that scope's latest `twin-deleted` row.
  - Because: after the AC-28 leg-(b) re-run, the latest run deletes nothing.
- **Allowlist.**
  - Design: the allowlist equals the emitted tuples.
  - Shipped: 38 of 43 signed. The operator kept 5 staging intents unsigned (`fundsignal.enabled=true`, `run_interval_hours=3`, `min_conviction_to_emit=0.2`, `scoring_formula_id`, marketdata `fundamentals.history.enabled=true`).
  - Because: they differ from the code default and need deliberate re-application.
- **Staging Loki tripwire.**
  - Design: a 1-day `read_key` tripwire on staging Loki after deploy.
  - Actual: the operator waived it as "evidence sufficient".
- **NOTIFY payload.** 041's payload is `{namespace, environment}`, while CONFIG-4 documents 4 fields. The handler reads only those two, so this is doc drift, not a behaviour change.

**Cross-feature signal**:
- 277's scope-creep lesson drove the halt and re-scope that created 296. The lesson worked.
- 295's multi-namespace trading watcher (`NewSnapshotWatcher` getters search every namespace map) is exactly the first-hit shadowing hazard that 304 later fixed with a separate required watcher.
- 296's empty-allowlist migrator refusal is the same hazard as 295's G2: an operator-gated sign-off that nothing mechanical enforces.
- The agent's `set_config` collapsed FAILED_PRECONDITION into a generic error (seen in Step 39). Feature 303 fixed this.
- 281/282's unseeded-waiver keys were retired by decision 6 and seeded by 041.

**Deferred follow-ons**:
- **296, 304, 305 and 306 have since launched.** Between them they completed:
  - the rename and CHECK;
  - relative getters;
  - prefixed-key rejection;
  - marker activation;
  - consumer rewrites;
  - the dead-key prune;
  - alias removal.
  
  The `remove-config-key-legacy-alias` follow-on is fulfilled by 306.
- **The 5 operator-kept staging intents** still await deliberate re-application.
- **Shared watcher-library refactor:** a named follow-up.
- **G3 at production's first deploy:** run `config_inventory --report` and diff it against `scripts/config-heal/dryrun-fresh.tsv`.
- **Open defects:**
  - `docs/reports/2026-11-06-trading-broker-paper-env-derived-default-unseedable-defect.md`;
  - `docs/reports/2026-10-07-db-migrate-dirty-recovery-replay-unsafe-defect.md`.
- **Small doc gaps:**
  - the `watch_core.py` docstring names 3 services, but there are 4 copies;
  - `services/xstockstrat-indicators/docs/context-constitution-findings.md` has a row that is resolved but not marked;
  - the ingest `watcher.py` comment still names `Semaphore(0)`.
- **Stale docs left by 295:**
  - `services/xstockstrat-marketdata/CLAUDE.md` and `services/xstockstrat-analysis/CLAUDE.md` call `marketdata.fundamentals.provider` "boot-frozen". It has been live since 295 (AC-7, AC-32).
  - `services/xstockstrat-trading/CLAUDE.md` describes `broker.timeout_ms` as the HTTP client's Timeout. It is now a per-request deadline.
  - The indicators CLAUDE.md row for `sandbox.max_concurrent` says "Read once in `IndicatorsServicer.__init__`". It is now a live `ResizableLimiter`.
  - `services/xstockstrat-config/CLAUDE.md` never mentions the LISTEN heartbeat, the serial-chain watchdog, the content-hash version, the 10 s re-send or the 5-min backstop.
  - PLAT-14 (`docs/context-constitution.md`) and `docs/patterns/config-governance.md` still describe the retired `rewriteAllow` / `unmodelled-rewrite` model.
  - Possibly: agent findings row 63 cites a stalled-config test that Step 29 retired.
  - The byte-identical `configWatcher.ts` fails `prettier --check` (pre-existing). Any reformat must touch all three Node copies, or `check-watcher-copies.sh` fails.
- **Unowned open risks:**
  - The config serial chain can wedge on a connection acquire or a non-query step. The watchdog makes this visible but does not heal it; clients only redial and get cached data.
  - A single PR editing both `config-wiring.json` and `dryrun-fresh.tsv` passes the gate's new-entry check. Only review catches it.
- **Stale durable suite (fix needed).** In `services/xstockstrat-config/acceptance/fix-config-keys-drift.feature`, AC-28 still says `migrate force 35` / `dirty 036`. The feature's own `acceptance.feature` correctly says `force 40` / `dirty 041`; promotion copied the pre-reword text.
  - The only record that 035 → 040 and 036 → 041 is this synthesis.
  - The promoted AC-3 also calls `fundsignal.enabled=true` signed, but that real tuple is unsigned. The harness fixture moved to `backtest.max_duration_seconds=120`.

**Ledger entries written**: insights.md (4), fails.md (3) — see the 2026-11-10 entries. Existing entries for the signed-heal pattern, throwaway-sketch blast-radius, the stream-liveness and test-blast-radius fails, and stale digests were skipped.

**Runtime-invariant recommendations (→ /context-constitution)**:
- **PLAT: config watcher cores are byte-identical** and hash-guarded in CI by `scripts/check-watcher-copies.sh`. Editing one copy requires editing every copy. No constitution states this today. The groups are:
  - `go`: trading/portfolio/marketdata `watchcore.go`;
  - `py`: indicators/ingest/analysis/agent `watch_core.py`;
  - `py-limits`: `live_limits.py` ×3;
  - `node`: ledger/identity/notify `configWatcher.ts`.
- **CONFIG (watch stream):**
  - every server-sent WatchConfig message must carry the full namespace, because old clients replace their snapshot wholesale;
  - skip-unchanged applies only to NOTIFY and backstop broadcasts;
  - heartbeat tokens carry an instance prefix, because config instances share the channel.
- **CONFIG-4 doc drift:** NOTIFY payload fields (see Permanent deviations).
- **ANALYSIS:** every compute call goes through `ComputePool`, enforced by a grep test. `max_worker_threads` above 16 is capped by `_COMPUTE_THREADS`.
- **INDICATORS:** `ExecuteFormula` clamps to `time_remaining()`. Test gRPC contexts must return `None` from it, not a MagicMock.

**Pruned artifacts**: product-spec.md, recon.md, design.md, implementation-spec.md — last present at 2d91b5671335fcce267679b50caa494440205f51. Defect report `docs/reports/2026-11-04-config-key-drift-and-subscription-gaps-defect.md` (+ `.status`) was pruned in the same run.

## Retained verbatim records

Operator decisions and C-16 sign-offs copied verbatim from the pre-archive session log, because durable suites and later features cite "<NNN> context.md" as their provenance. Headings are demoted one level.

#### Operator decisions (explicit sign-off, 2026-11-04)

1. **Canonical stored key = namespace-relative.** This overrides CONFIG-9 ("no fixed convention")
   and the full-dotted direction of features 189/243 (migrations `029`/`031`). Requirements: a DB
   CHECK; every getter literal rewritten; a zero-downtime transitional compatibility path for old
   pods, removed in a named follow-up.
2. **Stale values: keep effective behavior.** The row the code reads wins. Dead rows are dropped
   (with snapshot) and canonical keys seeded with the code default. Discarded intents are listed
   for deliberate re-application. Precedent: feature 189 preserved bracket protection.
3. **Everything live.** This includes resizable semaphores and executors, not only the vendor
   clients, the provider selection and the agent watcher.
4. **Scope additions:** the UI env bug, watcher resilience, Go getter type-safety, deleting orphan
   rows (with snapshot).
5. **Skills/guard rails** (from the original request): fix the SDD skills that allowed the drift.

#### Operator decisions (explicit sign-off, 2026-11-04, continued)

6. **feature-227 unseeded waiver: retired.** No exceptions; every read key is seeded. 281/282
   seed their keys in relative form. Whichever lands second reconciles: 295 drains their keys if
   they land first; they rebase onto the convention if 295 lands first.
7. **Getter type rule: lossless widening.** int→float accepted; every other mismatch returns the
   code default + a rate-limited WARN naming the FQN. All languages.
8. **Merge order: 295 waits for 243.** Row added to `docs/roadmap/features/merge-order.md`.
   281/282 get no row (rebase work only).

#### Operator decisions (explicit sign-off, 2026-11-04, continued)

9. **Indicators symptom timing:** the error was seen **after** `indicators.sandbox.timeout_ms=15000`
   was set (post-031). This confirms a **live watcher stall**: the indicators process kept serving
   5000 from a stale snapshot. FR-10 is the root fix, and AC-10 must include an indicators-specific
   stall case. Suggested mitigation, not performed: restart staging indicators to resync.
10. **C-16 CHANGE sign-off: all approved.**
    - C1: 243 @AC-1/4/5.
    - C2: 182 @AC-1.
    - C3: 184 @AC-1.
    - C4: platform 278 @AC-1 (the form-mismatch definition inverts).
    - C5: 147 secret scenarios (key literal becomes ns + relative).
    - C6: platform 182 @AC-6 (its "no seed migration" clause is retired).
    - N2: 247 @AC-1..5 (agent policy reads move to the watcher snapshot; the `get_config` tool stays
      a bounded GetConfig).

    The underlying guarantees (values, types, encryption, redaction, bounds) are PRESERVE. The
    promoted suites are updated at launch (C-16 promotion).

### Session 2026-11-04 — sdd-design round 2 synthesis + operator decisions 15–18

- **R2 adversary verdict: NEEDS WORK, no Floor breach.**
  - Blockers:
    - **BLOCKER-1:** the 035 catalog DELETE is not replay-safe under config's dirty-recovery
      `force 0` replay (no contract floor: `migration-dirty-guard.sh:42`, `db-migrate.sh:77-80`).
      It would delete later features' rows unrecoverably.
    - **BLOCKER-2:** the delete set is bounded only by hand-written gate registry entries
      (`config-wiring.json` 19 `dynamic: []`), and production cannot veto it once 035 is immutable.
  - Majors:
    - MAJOR-1: dual-read keys with different code defaults (`platform.trading_state` HALTED in
      trading vs none in the UI) would fail open.
    - MAJOR-2: the catalog lacks `is_secret`, so a secret-read key could be seeded plaintext-capable.
    - MAJOR-3: the heartbeat on the shared pool slot drops a healthy LISTEN under load; uncaught
      timer rejection; keepAlive initial delay.
    - MAJOR-4: 57 s has zero margin vs feature 273, and sandbox queueing remains a hidden cap.
    - MAJOR-5: the screener bypasses ComputePool; AC-23 is green on today's code.
    - MAJOR-6: the inventory would commit production values and user_ids to git.
    - MAJOR-7: the marker contract misses the per-user overlay SELECT; contract-of should anchor
      on 036.
    - MAJOR-8: `applyCatalogHeal` re-implements the heal in JS.
    - MAJOR-9: A0 "real defect" category is open-ended (scope creep).
  - Minors: all adopted.
- **Adopted without operator input** (round 3 state):
  - signed literal allowlist ∩ predicate for deletes;
  - a run-once latch and guarded casts;
  - per-reader defaults (seed only when all agree);
  - an `is_secret` catalog column (never seed secret-read keys);
  - the heartbeat on the listener's own socket (alternative A4);
  - the screener uses the pool; AC-23 `@preserve`;
  - the marker read inside the overlay statement; 296 contract-of anchored on 036;
  - the gate stored set built by applying migrations to a scratch Postgres in CI (alternative A3)
    instead of a JS emulation;
  - a closed A0 taxonomy.
- **Operator decisions (explicit sign-off, 2026-11-04, continued):**
  15. **Dead rows deferred to 296, gated on runtime evidence.** 295 deletes only signed twin rows.
      295's watchers log each distinct key read (once per key per process). 296 deletes a dead row
      only when static analysis **and** a release of runtime read logs both show no reader.
      FR-6/AC-15 re-scoped accordingly.
  16. **Inventory commits hashes, plus plaintext only for sign-off rows:** metadata +
      sha256(value_data) + sha256(user_id). The tool prints its own source hash for paste
      verification.
  17. **FR-12 cap = the 45 s long-RPC budget.** Bounds timeout ≤ 33000, grace ≤ 10000; indicators
      clamps to the request's remaining time.
  18. **Run round 3** before the approval gate.
- Spec updated:
  - FR-3 (signed, replay-safe, twin-only, report table);
  - FR-4 (hash commit);
  - FR-5 (no secret/disagreeing-default seeds);
  - FR-6 (runtime read evidence);
  - FR-12 (45 s);
  - AC-15 rewritten; AC-23 `@preserve`; new AC-28 (replay-safe) and AC-29 (disagreeing defaults
    not seeded).

### Session 2026-11-05 — sdd-design round 3 synthesis + operator decisions 19–20

- **R3 adversary verdict: NEEDS WORK, no Floor breach.** Round-2 BLOCKER-1/2 are verified resolved
  in SQL/code:
  - golang-migrate runs the file as one implicit transaction (`db-migrate.sh:41`, no
    x-multi-statement);
  - the latch is correct;
  - self-NOTIFY works and the tick-based staleness check is independent of the hung promise;
  - old clients only log `version`.
- **New majors, fixes adopted:**
  - **M1:** fresh/CI/dev DBs keep migration-seeded twins, so AC-19 "zero findings" is unreachable.
    Fix: sign the fresh-migrations DB as a third inventory (its plaintext is public in the
    migrations).
  - **M3:** the 10 s re-send hides a wedged query slot. Fix: restore `query_timeout`, plus a
    serial-chain watchdog that stops re-sends when the head task is older than 30 s.
  - **M4:** a DB-backed gate is unrunnable in local SDD harnesses. Fix: commit a generated
    `scripts/config-wiring-stored.json`, regenerated and diffed in CI only on migration PRs.
  - **M5:** reveal only rows whose 035 decision depends on their content; never per-user plaintext.
  - **M6:** a config `force 0` replay never reaches 035 (dies at `001:49-51`, existing defect
    `docs/reports/2026-10-07-db-migrate-dirty-recovery-replay-unsafe-defect.md`). The real path is
    `force 34` + `up`. AC-28 and the runbook are to be reworded.
  - **M2:** see decision 19.
- **Minors adopted:**
  - m1: monotone-shrink re-sign.
  - m2: no standing CI signoff branch; use an A10 verification command instead.
  - m3: descriptions authored in the A2 catalog freeze, not parsed from CLAUDE.md.
  - m4: indicators limiter released on thread completion.
  - m5: agent deadline mirrors the `int_positive` zero-trap.
  - m6: `updated_by='system:config-migration-035'`.
  - m7: `IS DISTINCT FROM` guards, secrets skipped in metadata fill.
  - m8: float retype by text equality.
  - m9: SetConfig with both spellings present returns FAILED_PRECONDITION naming both.
  - m10: normalise int∪float before the disagreement check.
  - m11: a pre-stated fallback for the keepalive spike.
  - m12: split A5 per language.
  - Also: the fixed-invariant constants are documented (F-07).
- **Operator decisions (explicit sign-off, 2026-11-05):**
  19. **Production is not running.** Treat dead rows as staging-only. Verified: staging
      `OTEL_ENABLED: "true"` (`.do/app.dev.yaml:32-33`); production `"false"` and undeployed (278's
      2026-10-23 ruling).
      - FR-6 evidence uses Loki in **staging**, plus a per-service coverage heartbeat so silence
        counts as evidence only for services that were logging.
      - **No production console inventory.** Production's first deploy starts from migration seeds,
        so the fresh-migrations inventory (M1) covers it.
      - G3 becomes the first-production-deploy read-back (informational).
  20. **Run round 4**, then the approval gate.

### Session 2026-11-05 — sdd-design round 4 synthesis + operator decisions 21–24

- **R4 adversary verdict: APPROVABLE (no Floor breach).**
  - Confirmed: the renumbering is sound; pg 8.11 `query_timeout` releases and destroys the client;
    the committed stored-JSON gate works; M3/M4/M5 are closed.
  - **Binding amendments for spec time:**
    - **MAJOR-1:** drop `policy.seededUnread`. It regresses platform `@AC-7 @feature-278`
      (`platform.feature:840-845`). Baseline each surviving dead row as `seeded-unread` with owner
      feature 296; the shrink-only ratchet blocks any new entry.
    - **MAJOR-2:** 036 overwrites a non-blank mismatching `default_value` (documentation-only per
      CONFIG-2) with the agreed code default for non-secret catalog keys, with an audit row
      (`011…:14-23` ACTIVE vs trading `HALTED` `trading.go:3589`). The gate exempts
      readers-disagree keys from default-mismatch and scopes metadata/type checks to catalog-read
      rows. A2 proves the fresh residual is empty.
    - **MAJOR-3:** re-emit `config.read_key` at every 6 h coverage tick, so silence means unread.
    - **MAJOR-4:** a twin whose partner or catalog entry `is_secret` is secret-class: never
      revealed, never in a TSV/report plaintext column, not deleted in 295.
    - **MAJOR-5:** the runbook probes `to_regclass('config.config_markers')` plus the latch before
      forcing (35 vs 34). The migration-rerun leg reproduces the real auto `force 0` → 001 failure,
      then probe → force → up converges, asserting no data/function change.
  - **Security precision:** in FR-1 the found row only selects the spelling. Scope and `user_id`
    always come from the request, so a first per-user override INSERTs per-user and never UPDATEs
    the global row (PR #994 owner-only).
  - **Minors m1–m11:**
    - path filter additions;
    - a patch artifact for the stored JSON;
    - a synthesized non-default value for unrevealed bounded keys;
    - AC-28 assertions scoped to the latest `run_at`;
    - the merge-order row (decision 23);
    - G3 non-fresh handling (decision 24 makes it moot);
    - a `to_regclass` guard on the marker subquery, plus the marker resync through `serial()`;
    - `statement_timeout=15000` on the config pool;
    - the AGENT-1 amendment limited to the two lifespan WatchConfig channels, with agent boot now
      blocking on the snapshot;
    - the `time_remaining()` None branch;
    - `--emit-heal-data` fails on a catalog key with no description.
  - **Process:** re-run `/sdd-review product-spec` after the AC/FR wording changes, before
    `/sdd-spec`.
- **Operator decisions (explicit sign-off, 2026-11-05, continued):**
  21. **Run round 5** (the final capped round) to integrate the round-4 amendments.
  22. **AC-19 weakening accepted.** The end-state baseline holds only `seeded-unread` entries for the
      staging dead rows, each owned by feature 296. Any other finding, and any new entry, fails CI.
      `@feature-278 @AC-7` is preserved.
  23. **296 gate = 295 merged to main-dev + one full staging release** (the evidence window), not
      "295 launched". Production, when it first starts, deploys fresh with both features, so there
      are no pre-295 images to roll back to. The merge-order row has been reworded.
  24. **No production DB or deploy target exists anywhere** (neither DO production nor homelab
      production). Production's first deploy starts from fresh migrations, so the design assumption
      holds, and G3 = the first-deploy read-back against `dryrun-fresh.tsv`.

#### Operator decisions (explicit sign-off, 2026-11-05, continued)

26. **Config migration numbering is bound at execution time.**
    - 295 takes the first free `xstockstrat-config` migration numbers when Steps 9/33 actually run
      (currently 038/039, since 035/036 are PR #1359's and 037 is 281's).
    - The numbers are re-checked before the integration PR.
    - Recovery commands (`force <marker>` / `force <marker−1>`), the AC-28 text and 296's
      `contract-of` anchor all follow the final marker number.
    - 295 merges only after every lower-numbered config migration already on main-dev. No other
      feature renumbers.
    - Supersedes the spec's provisional 040/041.
27. **Pause at implementation-ready.** Resume with `/sdd-execute fix-config-keys-drift`. Before
    Step 1, fix the mechanical impl-spec warnings recorded above. G1 (Step 5) needs the operator
    to run the staging inventory from the indicators DO console.
28. **Config migration numbers pinned (supersedes decision 26; operator, 2026-11-05).**
    - Fixed merge order across features: 282 (`038`/`039`) → **295 (`040_config_markers` / `041_heal_config_keys_to_reader_catalog`)** → 291 (`042`) → 293 (`043`). Recorded in `merge-order.md` (PR davcs86/xstockstrat#1455).
    - 295 does **not** take "first free" numbers at execution time: it keeps `040`/`041` and merges only after 282's `038`/`039` are on main-dev. Re-check before the integration PR; if the base differs, take max+1 exactly and log it in the Deviation Log.
    - 296's `-- contract-of:` anchor stays on `040_config_markers`.
29. **Step 11 keepalive spike: throwaway local Postgres allowed (operator override of the no-database rule, this spike only, 2026-11-05).**
    - The executor may start `dockerd` and a disposable `timescale/timescaledb:latest-pg16` container (the docker-compose image) to boot a local xstockstrat-config server for Step 11 instruction 8, run the Step 12/14/16 watcher against it, then `docker rm -f` the container.
    - No other step may start a database; no shared or remote database is touched; record the run and teardown in the Deviation Log.

#### Operator decisions (explicit sign-off, 2026-11-06, continued)

30. **Steps 4/13/19/29/38 stay unsplit** (decision-27 item d; operator, 2026-11-06). The C-18 split
    warning is waived. With items (a), (b), (c) and (e) closed by the 2026-11-06 re-spec, **the
    decision-27 gate is cleared** and Step 1 may run.

#### Operator decisions (explicit sign-off, 2026-11-06, continued)

31. **Steps 3+4 run as one atomic unit** (operator, 2026-11-06, two rounds on the Step 3 blocker).
    - **Round 1 (Option B):** Step 3 stays as specced, and Steps 3 and 4 run as ONE unit per
      `atomic-units.md`, with one commit after the combined Verification passes. The unit's staged
      Files are `config-wiring.test.mjs`, every `config-wiring-fixtures/**` file and
      `config-wiring-stored.json`.
      - The existing 278 tests and fixtures move to the new model:
        - the seed tests are recast onto the retained SQL helpers, or deleted with their fixtures;
        - each join and ratchet root gets a stored JSON plus a receivers entry per reader, and keeps
          its expected lines;
        - baseline 4 reads secrets from the stored JSON.
      - Contract:
        - `registry.receivers` is keyed `"<service file>:<receiver expr>"`;
        - `storedInputsSha256(root)` is exported;
        - attributed `read-unseeded` findings carry the reader's namespace;
        - skill 3 asserts that clauses (a) and (b) are present.
    - **Round 2 (Option A):**
      1. One throwaway local `timescale/timescaledb:latest-pg16` container is allowed, on
         decision-29 terms, only to generate the initial `config-wiring-stored.json`, and is then
         removed with `docker rm -f`.
      2. A receivers value is a namespace or a list of namespaces. For a list, the key's `<ns>.`
         prefix chooses the namespace, with no default. `trading.go s.cfgW` maps to
         `["trading","platform"]`.
      3. Interpretations:
         - catalog-read = stored rows read by an attributed reader, until `catalog.tsv` exists;
         - the `--final` `dryrun-fresh.tsv` check goes by header columns, and is vacuous today;
         - `--emit-heal-data` uses Step 6's `catalog.tsv` column order.

#### Operator decisions (explicit sign-off, 2026-11-06, continued)

32. **Step 11 blocker: skip semantics and keepalive-spike ordering** (operator, 2026-11-06). This
    closes the open spike-ordering question (recorded at the re-spec gates of 2026-11-05 and
    2026-11-06).
    - **Skip semantics, Option B.** Implement instructions 1–7 and 9. The unchanged-version skip in
      `broadcastToSubscribers` applies only to NOTIFY-driven and backstop broadcasts. The reconnect
      `resyncAll` and direct `broadcastToSubscribers` calls are exempt and always deliver. This
      leaves the following untouched:
      - the feature-258 tests `configServiceImpl.test.ts:284` and `:337`;
      - `watchConfigWireZero.test.ts:64`;
      - the promoted `@feature-258 @AC-1` rule.

      Add a test showing that a NOTIFY or backstop broadcast with an unchanged version is skipped,
      and a reconnect resync is not. This is recorded as an operator-approved deviation of
      instruction 3.
    - **Keepalive spike, option (A).** Instruction 8 moves to the end of Step 13 (the first client
      watcher core) and becomes its instruction 6. It keeps its decision-29 allowance: one disposable
      local timescale container, removed afterwards.

### Session 2026-11-06 — Step 21 re-spec (operator decision)

- Step 21 halted (blocker:21): its Verification needs two files outside **Files** (F-08).
- Operator decision: re-spec first with both files — `internal/service/classification_service_test.go`
  (`fundProvider: staticProvider("fmp")`, required to build) and `internal/alpaca/stream.go` (live
  `func() ClientConfig` re-read per reconnect so rotated Alpaca secrets and live feed/reconnect
  settings reach the WebSocket). Both added to Step 21 **Files**; recorded in the Deviation Log.

### Session 2026-11-06 — Step 27 re-spec (operator decision)

- Step 27 halted (blocker:27): `context.time_remaining()` returns a MagicMock on the test contexts of
  ~18 existing ExecuteFormula tests, and the new reader trips `test_rule2_key_sets_match_classification`.
- Operator decision: re-spec first. Added `tests/conftest.py` (`ctx_with`), `tests/test_formulas.py`,
  `tests/test_execute_formula_concurrency.py`, `tests/test_private_formulas.py` (contexts return
  `time_remaining` → `None`) and `tests/test_config_read_classification.py` (`FR3_KEYS`) to Step 27
  **Files**. Rejected: tolerating non-numeric `time_remaining()` in production code.

### Session 2026-11-06 — Step 33 re-spec (operator decision, Option B: `readers_disagree` column)

- **Blocker:** 041 must skip seeding and the default sync for readers-disagree keys (AC-29), but the
  frozen catalog carried no such flag, and `catalog_041` holds one row per key, so grouping by (ns, key)
  cannot find a disagreement.
- **Decision (operator, 2026-11-06):** add a `readers_disagree` boolean as the last column of
  `scripts/config-heal/catalog.tsv` and `CATALOG_COLS`. It is `true` for exactly
  `marketdata.fundamentals.provider` and `platform.trading_state` (the Step 6 triage) and `false`
  elsewhere. Carry it through `emitHealData`, `config-wiring.test.mjs` and the generated Config Key
  Contract table. 041 reads the flag from `catalog_041`: no seed, no default sync, and one
  `readers-disagree` report row per flagged key × environment.
- **Sequence:** the spec amendment (Steps 3/4/6 and 33, Deviation Log) is commit `cdb8b787`. The
  catalog/emitter/test/contract-table change follows as its own commit, with Steps 3/4/6's Verification
  re-run green. Step 33 then lands against the revised spec. The production-file edits are authorized
  for this purpose only.

#### Operator decisions (explicit sign-off, 2026-11-07, continued)

- **Step 34 blocker, Option A (operator, 2026-11-07).**
  1. Exactly one disposable local `timescale/timescaledb:latest-pg16` container is allowed, on
     decision-29 terms, to generate `dryrun-fresh.tsv`. It is removed with `docker rm -f` afterwards.
  2. The TSV columns are `action`, `namespace`, `key`, `environment`, `user_sha256`, `reason`, in
     that order, `LC_ALL=C`-sorted, with `run_at` dropped and no values or secret material.
  3. `--fresh` writes the inventory with the `config_inventory.py` column list via psql.
  4. `--staging` takes `description`, `consuming_service` and `default_value` from `catalog.tsv`.

### Session 2026-11-07 — Step 35 (G2: reveal, dry-runs, operator sign-off)

- **Reveal.** `reveal-request.json` (bc8fe4d9) = the 39 staging allow tuples from the Step 6 emit, each
  with its partner's catalog default. The operator ran it on the staging indicators console: exit 0,
  request sha256 and `tool_sha256` verified, output_sha256 `713922…7e6ca3` verified locally.
- **Step 34 defect (fixed in 1a7c4a1b, operator sign-off).** The staging loader read an empty catalog
  `code_default` as NULL; 6 string rows with value and default `''` falsely tripped the sentinel guard.
- **Fresh inventory.** Real `config_inventory` over a scratch DB migrated to 040: 194 rows,
  output_sha256 `0f6319…5f97de` → `inventory-fresh.jsonl`.
- **Operator decisions (davcs86):**
  - Sign 38 of the 43 emitted tuples. Kept unsigned (staging intents that differ from the code
    default): `analysis` `fundsignal.enabled=true`, `fundsignal.run_interval_hours=3`,
    `fundsignal.min_conviction_to_emit=0.2`, `fundsignal.scoring_formula_id=d1ff5e6b-…`; `marketdata`
    `fundamentals.history.enabled=true`. These stay `twin-kept-unsigned` and return
    FAILED_PRECONDITION in staging until feature 296.
  - Production's bare `backtest.max_duration_seconds=120` is a migration seed (same hash in the fresh
    inventory), so it is signed: production reads 300 after the first deploy unless set (PR note).
  - The dry-runs ran with the signed block spliced into a scratch copy of 041.
- **Results (deterministic, two runs each):** staging 34 twin-deleted, 5 twin-kept-unsigned,
  1 per-user-unread, 4 readers-disagree, 9 unread-no-partner. Fresh 38 twin-deleted, 6 default-synced,
  4 readers-disagree, 9 unread-no-partner. 0 retyped / signoff-type / twin-secret-class in both.
  Caveat: staging default-synced is not observable (the loader takes defaults from the catalog).
- **Sign-off (mirror of `scripts/config-heal/signoff.md`):** tool `5515ed6e…65d1e5`; allowlist block
  `allow-signed.sql` `755deaf5…a22575`; staging inventory `633f91d5…ab701b`, dry-run `0a7e72ee…132e8b`;
  fresh inventory `0f631909…5f97de`, dry-run `141e4cd5…90bb238`; operator davcs86, 2026-11-07.
- **Container lifecycle:** `dockerd` started three times (01:18, 01:22, 01:29 UTC; the worker restarted
  between); containers `step35-tsdb`, `step35b-tsdb` (lost in the restart) and `step35c-tsdb`, each
  removed (`docker rm -f`, or gone with the restart); `dockerd` stopped. No shared database touched.
- **For Step 36:** insert `allow-signed.sql` verbatim (not the raw 43-tuple emit). The CI fresh
  dry-run diff is red until then.

### Session 2026-11-07 — Step 39 deferred (operator decision)

- **Operator decision (2026-11-07):** Step 39 is post-integration. Status stays `pending`; no staging
  read-back or G3 evidence is committed now.
- **Deferred to post-merge:** staging read-back via the xstockstrat_staging MCP against
  dryrun-staging.tsv, config_inventory --report, repro 1-4, 1-day Loki tripwire; G3 at /promote.
- **Instruction 1 evidence:** CI-green on the integration PR, recorded after that PR's CI completes.
- **Next:** feature-end checkpoint (`--final`, merge-order gate, C-16 scenario promotion plan), then
  the integration PR gate.
