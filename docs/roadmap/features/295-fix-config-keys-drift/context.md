# Context Log: fix-config-keys-drift

Append-only. Each session appends a new ## Session entry. Never delete or edit prior entries.

---

## Session 2026-11-04 (/sdd-triage)

- Bug recorded as defect report `docs/reports/2026-11-04-config-key-drift-and-subscription-gaps-defect.md` (Issues disabled)
- Severity: SEV-2, environment staging → routed to SDD path (Track C)
- Created: feature.md, product-spec.md, acceptance.feature (regression scenarios AC-1..13), context.md
- Affected services: all 12 (config, trading, portfolio, marketdata, indicators, ingest, analysis, ledger, identity, notify, agent, ui)
- Root cause: C-05 vs CONFIG-9 contradiction + no seed↔reader parity gate + readers caching config at startup + watchers without liveness detection
- Recommended design depth: **full** → `/sdd-design fix-config-keys-drift` (rationale: ≥2 services, DB migrations, cross-service config contract)
- Development branch: feature/fix-config-keys-drift
- Feature number 295 reserved via `scripts/sdd-allocate-feature-number.sh` (sdd/feature-cursor)

### Evidence base (live staging + three per-language discovery passes)

- **Staging namespaces** (ListKeys/GetConfig via the agent MCP):
  - Bare and dead rows: `analysis` `fundsignal.*`, `backtest.max_duration_seconds`,
    `scoring.signal_decay_half_life_hours`; `ingest` `backfill.*`, `mcp_client.*`; `ledger`
    `stream.notify_enabled`; `marketdata` `fundamentals.history.enabled`.
  - Blank-metadata rows created ad hoc: `marketdata.alpaca.paper` (string), `marketdata.fmp.enabled`,
    `analysis.engine.*`, `analysis.backtest.default_*`.
- **Discarded staging intents** (stored on dead rows, differing from the effective code default);
  to list in the PR:
  - `fundsignal.enabled=true` (effective false)
  - `fundsignal.run_interval_hours=3` (24)
  - `fundsignal.min_conviction_to_emit=0.2` (0.0)
  - `fundsignal.scoring_formula_id=d1ff5e6b-6d9c-589d-b95e-defd862c702b` ("")
  - `backtest.max_duration_seconds=300` (live twin 60 wins)

  Production values are not visible from this session. The migration must emit them; a
  premigration snapshot is required.
- **Subscription:**
  - All Go/Python/Node services keep a long-lived WatchConfig stream, except the agent (one-shot
    GetConfig per call) and the UI (60s/30s browser polls, with no `environment`).
  - Go: 2s→32s backoff that never resets; no keepalive. Trading's SNAPSHOT drops keys by the
    `ns+"."` prefix, which is load-bearing under full-dotted keys (multi-namespace map) and must be
    redesigned under relative keys.
  - Python: fixed 2s retry; a clean EOF reconnects with no delay; no keepalive.
  - Node: 1s→30s jittered backoff that resets on data.
- **Startup-cached reads:**
  - marketdata `main.go:99-260` (Alpaca/EDGAR/FMP/Finnhub client cfg, `fundamentals.provider`).
  - analysis: semaphores and executor (`servicer.py:548-595`), `marketdata.fundamentals.provider`
    (`fundsignal_loop.py:105`).
  - ingest `backfill.max_concurrent_jobs` (`servicer.py:323`).
  - indicators `sandbox.max_concurrent` (`servicer.py:107`).
  - trading broker HTTP timeout (`trading.go:3201`).
  - The four marketdata secrets (rotation needs a restart).
- **Not seeded but read** (about 60): trading `reconciliation.*`, `broker.*`, `order.*`,
  `order_intent.*`, `ibkr.*`, `position_sync.*`, `credential_health.*`; identity `jwt.*`; portfolio
  `exposure.factor_map`, `marketdata.*`, `risk.*`; marketdata `alpaca.feed/adjustment`, `stream.*`,
  `edgar.base_url/user_agent/rate_limit_rps`, `price.*`, `quotes.*`, `retention.*`,
  `classification.*`, `fundamentals.history.backfill.*`; analysis `scoring.*`, `series.*`,
  `compute.*`, `strategy.*`, `screener.*`, `patterns.*`, `snapshot.*`, `readiness.*`; ingest
  `backfill.max_concurrent_jobs/retry_*`, `signals.dedup_window_hours`; indicators
  `sandbox.max_concurrent`; agent `oauth.*`, `extract.*`, `opportunities.read_timeout_seconds`.
  The authoritative list comes from the parity gate, not this note.
- **Operator symptom (2026-11-04):** indicators behaves read-once-at-startup. Getters are per-call
  (`servicer.py:282-286`), so the candidate causes are: (a) the pre-`031` bare sandbox seeds,
  (b) the startup-only semaphore, (c) a half-open stream freezing the snapshot. Design must cover (c).

### Operator decisions (explicit sign-off, 2026-11-04)

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

## Session 2026-11-04 (operator follow-up — indicators symptom)

- **Key the operator changed:** `indicators.sandbox.timeout_ms`. Staging stores `15000` (`int`) under
  the correct full-dotted key, and `IndicatorsServicer.ExecuteFormula` reads it on every call
  (`services/xstockstrat-indicators/app/handlers/servicer.py:282`). So naming is NOT the cause for
  this key in staging.
- **New cause (d): a caller-side gRPC deadline below the configurable server budget.**
  - The agent `test_formula` → `client.execute_formula` uses a fixed `timeout=_RPC_TIMEOUT_S` = 10 s
    (`services/xstockstrat-agent/app/client.py:38`, `:1102`).
  - The sandbox runs up to `timeout_ms + SANDBOX_STARTUP_GRACE_MS(5000)`
    (`services/xstockstrat-indicators/app/services/sandbox.py:205`, `:350`), i.e. 20 s at 15000.
  - Any formula running past 10 s fails `DEADLINE_EXCEEDED` at the agent regardless of the config.
  - The analysis callers (`evaluator.py:518`, `fundamentals_scoring.py:52`) set no deadline.
  - Design must cover this: a config value must not be silently capped by a hardcoded deadline in
    another service.
- Distinguishing the causes by symptom (asked of the operator): "deadline exceeded" at ~10 s → (d);
  "Formula execution timed out after 5000ms" → (c), a stale stream.
- `_clamp_override` (`servicer.py:66`) only tightens; the agent sends 0 unless the caller passes
  `timeout_ms`, so it is not a cap here.

## Session 2026-11-04 (sdd-review product-spec — prior-art findings)

- **A1b — demoted 277 `fix-ingest-seeded-config-keys`.** Its operator note says a revival "is
  re-created under a new NNN". 295 is that revival with a much wider scope (all namespaces,
  relative canonical form, live reload), so it runs a full review, not the duplicate fast path.
  277's archive synthesis (`docs/roadmap/features/277-*/context.md`) is **mandatory design input**.
  Notably:
  - a twin-aware rename (`config_values_scope_uniq` aborts a blind UPDATE);
  - a key-only UPDATE writes no audit row (the migration must write `config_audit` itself);
  - harness ordering (`scripts/migration-rerun.sh` runs `up` before the assertions, so a
    dedicated goto pass is needed);
  - db-migrator is PRE_DEPLOY, so staging heals on the main-dev merge;
  - verify per key per environment by read-back, never by row count (`fails.md:2335`).

  It was demoted because scope grew round by round. 295's design must fix the scope up front.
- **Launched 278 `enforce-config-key-wiring` already provides the parity gate:**
  `scripts/check-config-wiring.mjs` + `config-wiring-py-reads.py` + `scripts/config-wiring.json`,
  CI job `config-wiring` in `ci-gate`, with `/sdd-execute` step and `--final` gates, an
  `/sdd-review` B2 row and the `/sdd-story` declared-key format.
  - It shipped a **baseline of 124 accepted findings** (19 form-mismatch, 5 seeded-unread,
    100 read-unseeded) with no fixing owner. That baseline is exactly this defect.
  - Process root cause, refined: the guard rail exists, but (a) its baseline lets known drift
    persist with no owner; (b) its stored-form rule mirrors CONFIG-9's "no convention"; (c) it
    does not check `value_type` vs getter arm, live-vs-restart, or caller-deadline coupling.
  - **295 must extend 278's checker and drain its baseline to zero — not build a second gate**
    (DRY, C-18).

## Session 2026-11-04 — sdd-review product-spec

- **First pass: FAIL** (spec-reviewer). Blockers:
  - no enumerated FR-N (C-15);
  - no migration strategy;
  - no `## Consumer Surface(s)` (C-14);
  - AC-12 `Then` not concrete.

  Warnings:
  - prior art (278 checker, 277 lessons) missing from the spec, and the "nothing gates parity"
    claim inaccurate;
  - the proto approval gate not stated;
  - AC coverage gaps;
  - AC-10/AC-11 not numeric;
  - BrokerType/paper-safety not stated.
- Spec revised: FR-1..FR-15, Consumer Surface(s), Proto (additive-only else stop), Database Changes
  (035+, F-01, 277 lessons), Trading-Domain Notes. acceptance.feature AC-1..AC-20, every FR covered;
  AC-12 is a Scenario Outline; AC-10 (30 s deadline) and AC-11 (≤5 streams/10 s) are numeric.
- **Overlap (feature-overlap, re-verified with git):**
  - 243 `fix-sandbox-seed-keys` (in-progress): migration `031` is already on main-dev and its code
    steps are done; only the operator Step 5 staging gate is pending. The "031 collision" is not
    live: 295 uses 035+.
  - 281/282 (implementation-ready) add keys unseeded under the 227 waiver, with full-dotted
    `SCALAR_BOUNDS_REGISTRY` entries.
  - `fix-sandbox-memory-cap` and `agent-log-query` are docs-only drafts; `agent-grpc-migration` is
    stale. No collision with any of them.

### Operator decisions (explicit sign-off, 2026-11-04, continued)

6. **feature-227 unseeded waiver: retired.** No exceptions; every read key is seeded. 281/282
   seed their keys in relative form. Whichever lands second reconciles: 295 drains their keys if
   they land first; they rebase onto the convention if 295 lands first.
7. **Getter type rule: lossless widening.** int→float accepted; every other mismatch returns the
   code default + a rate-limited WARN naming the FQN. All languages.
8. **Merge order: 295 waits for 243.** Row added to `docs/roadmap/features/merge-order.md`.
   281/282 get no row (rebase work only).

## Session 2026-11-04 — sdd-review product-spec (second pass)

- Product spec approved. Status: draft → spec-ready.
- Warnings (advisory, carried into design):
  - FR-14 must amend C-05 in `docs/sdd/constitution.md` in the same PR.
  - AC-20 should be gate-assertable, not docs-reading only.
  - AC-13 is a process outcome.
  - Re-check migration NNN 035 at spec time (281/282/243 may take it).
  - Confirm AC-19's `--final` flag against `check-config-wiring.mjs`.
  - A rollback scenario for FR-4 was missing; **added as AC-21**.
- Overlap findings: 243 (merge-order row added, decision 8); 281/282 (waiver retired, rebase only,
  decision 6). No other live collision.
- Recommended design depth: **full**. Rationale: 12 services, config migrations, a possible
  additive proto change, and the cross-service config contract.

## Session 2026-11-04 — sdd-design Phase 0 (recon) + indicators symptom pinned

- Phase 0 recon written: `recon.md`. Six targeted passes (deviation recorded in the recon.md
  header): config server + harness, 278 checker, Go, Python/agent, Node/UI, scenario-recon (C-16).
- **Indicators symptom (operator, 2026-11-04):** the observed error text was
  `Formula execution timed out after 5000ms`.
  - That string is produced inside indicators from the `timeout_ms` it resolved
    (`services/xstockstrat-indicators/app/services/sandbox.py:394`). So indicators was running on
    5000 while the DB held 15000. This is **cause (c), a stale/missing snapshot value**, or the
    pre-031 bare-key era. It is not the agent's 10 s deadline, cause (d).
  - Migration 031 reached staging on 2026-10-29 (`0099647f`) and resets global sandbox rows to
    defaults (`031…up.sql:29-46`). So the stored 15000 was set after 2026-10-29.
    - If the error was seen after that edit, a live watcher stall is confirmed.
    - If it was seen before, the cause was naming. The question was put to the operator.
- **Staging probe (read-only `test_formula` dry runs):**
  - 2M iterations took 2784 ms; 5M took 4129 ms; 9M took 5490 ms, all success.
  - 20M (~25 s) failed with a bare `Error executing tool test_formula`: the agent's fixed 10 s
    deadline fired and the error message was lost.
  - Non-discriminating by construction: the sandbox kills at `timeout_ms + 5000` grace, so with
    `timeout_ms=5000` any run under 10 s succeeds, and runs over 10 s hit the agent deadline first.
    The MCP path **cannot observe** the configured sandbox timeout at all. This strengthens FR-12.
  - New minor defect: agent deadline errors on `test_formula` surface without a message
    (AGENT-5 `_grpc_error_message` is apparently not applied on this path). Folded into FR-12's
    scope at spec time.

### Operator decisions (explicit sign-off, 2026-11-04, continued)

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

## Session 2026-11-04 — sdd-design Phase 1, round 1 (in progress)

- **R1 proposal (design-proposer), summary.**
  - **Two production releases inside 295.**
    - **A (expand):**
      - config server emits a bidirectional alias (relative ↔ `<ns>.`, exact stored name wins) at
        the single point `resolveOverlayValues` (after the per-user overlay);
      - form-tolerant SetConfig, with authz and bounds compared on canonical `(ns, rel)`;
      - a 10 s server full-namespace DELTA re-send as the liveness signal (no proto change);
      - migrations `035` (delete dead/twin/orphan rows, snapshot + own audit) and `036` (seed
        parity in each reader's current spelling);
      - hardened watchers in all languages (keepalive, 30 s liveness, 1→30 s jittered backoff that
        resets only after 30 s up, typed FR-11 getters, `OnChange` on version change);
      - `ResizableLimiter` (Python, in place) plus a fixed 32-thread pool behind a limiter;
      - marketdata `func() Cfg` closures, a provider map, and secret cells re-resolved on `OnChange`;
      - trading per-namespace maps and a per-request broker timeout;
      - agent watcher (AGENT-1 scoped amendment), FR-12 derived deadline + bounds
        `sandbox.timeout_ms [1,49000]`;
      - UI explicit BFF getConfig handlers;
      - gate extended (namespace attribution registry, type/metadata/default kinds, empty baseline,
        no growth).
    - **B (contract), integration PR #2, gated by `-- contract-of: 036`:**
      - `037` rename to relative; `038` CHECK;
      - every getter literal rewritten;
      - prefixed keys rejected, with an internal-caller canonicalising exception.
    - **Follow-up feature:** `remove-config-key-legacy-alias`.
  - Per-service byte-identical watcher copies plus a hash guard (266 precedent), not a shared
    package.
  - Step A0 is the gate triage table, which **freezes scope**.
- The adversary pass is running.

## Session 2026-11-04 — sdd-design round 1 synthesis + operator re-scope

- **R1 adversary verdict: NEEDS WORK, no Floor breach.**
  - Blocker-weight:
    - **B1:** the heal/alias are computed from the migration-only model (278 gate), not live rows;
      ad-hoc rows exist and production is unseen.
    - **B2:** the server re-send masks a dead config-server LISTEN feed (no keepalive/heartbeat on
      the pg LISTEN client). The confirmed indicators stall may be this server half.
  - Major:
    - M1: ComputePool leaks the @feature-176 bound on cancellation. Release the slot on thread
      completion.
    - M2: per-user rows must get the same read-spelling heal.
    - M3: never UPDATE `value_data`. Retype only where stored == default; list the rest for
      sign-off. `default-mismatch` compares `default_value` vs the code default only.
    - M4: no default namespace attribution in the gate, plus a runtime WARN for an absent seeded key.
    - M5: 037/038 race. Strip again inside the CHECK migration, guard replay, and extend the
      migration-rerun lists.
    - M6: client keepalive vs server enforcement policy; spike it.
    - M7: the derived deadline duplicates the indicators grace constant and can be capped by stored
      values > bound.
  - Minor: m1–m14. All adopted into round 2 state.
- **Operator decisions (explicit sign-off, 2026-11-04, continued):**
  11. **Live inventory.** The operator can run **a Python script from the DO console**, not SQL.
      A0 ships a read-only Python inventory tool following the `legacy_authors_ops` precedent
      (`services/xstockstrat-indicators/app/maintenance/legacy_authors_ops.py`, run in `/app` with
      the component's `DATABASE_URL`). All components share one DB/user (`.do/app.yaml`
      `${xstockstrat.USERNAME}`), so it can read `config.config_values`.
      - It must never print secret material: never select `value_encrypted`; for `is_secret` rows
        print only metadata.
      - The operator runs it on staging and production, and the redacted output is committed.
      - Heal migrations become data-driven from it.
  12. **Alias activation: only after the rename.**
      - The rename migration writes a marker and `pg_notify`. Servers alias only once they observe
        the marker, with a periodic reload backstop for a lost NOTIFY.
      - Release A reads are byte-identical to today, so unmodelled rows get zero exposure.
      - This reverses 277's no-NOTIFY choice. 277's rationale ("boot reloadAll + reconnect cover
        it") does not hold for a rename that changes which spelling exists.
  13. **Release B is a separate feature.**
      - 295 = Release A (expand). It launches normally at its promotion.
      - A new feature owns Release B (contract): rename migration with `-- contract-of:`, CHECK,
        relative getter literals, rejection of prefixed keys, marker activation. It gets a
        merge-order row "waits for 295 launched".
      - AC-1, AC-2, AC-5, AC-21 and the relative half of AC-19/AC-20 move to it.
      - **Requires a 295 product-spec re-scope + re-review before round 2** (277 scope-creep rule,
        fails.md:3437-3441).
  14. **FR-12: derived deadline** (the operator chose it over the recommended fixed 56 s).
      - Resolution of M7: make the sandbox startup grace a seeded indicators config key instead of
        the private constant `SANDBOX_STARTUP_GRACE_MS` (`sandbox.py:205`). This also removes an
        F-07 hardcode.
      - The agent subscribes to `indicators` and derives
        `min(cap, timeout + grace + slack)`.
      - Bounds plus a migration assertion keep stored values under the cap.
      - When the derived value would exceed the cap: clamp + WARN, never silent.

## Session 2026-11-04 — sdd-review product-spec (re-scope re-review)

- 295 re-scoped to Release A. Feature 296 `fix-config-keys-contract` was created on its own branch
  and integration PR (davcs86/xstockstrat#1441), with a merge-order row (296 waits for 295 launched).
- Re-review: FAIL on one blocker. FR-10 said the backoff resets after "less time than the liveness
  deadline". Fixed: it now resets after **at least half the deadline** (15 s of 30 s); a threshold
  equal to the deadline may never reset (R1 adversary m5).
- Third pass: **PASS WITH WARNINGS.**
  - AC-2 re-tagged `@preserve` (green by design), and the C-15 sentence amended.
  - Added AC-25 (canonical grant/bounds), AC-26 (content-derived version, no-op reload),
    AC-27 (uniform getter rule in Python/Node/Go).
  - Remaining warnings carried into spec time:
    - the full key contract for `indicators.sandbox.startup_grace_ms` and the new bounds;
    - re-check migration NNN against 296;
    - FR-14 must amend C-05 in `docs/sdd/constitution.md` in the same PR;
    - FR-11 coverage is per-language, not per-service.
- Status stays spec-ready. Next: design round 2 with the R1 synthesis + decisions 11–14 as state.

## Session 2026-11-04 — sdd-design Phase 1, round 2 (in progress)

- **R2 proposal, summary.**
  - **Heal.** One catalog-driven heal migration, `035`. It embeds only the env-invariant reader
    catalog emitted by the extended gate (`--emit-catalog`). Every action is a predicate over each
    DB's actual rows, in the order:
    1. snapshot (no `value_encrypted`);
    2. delete non-secret rows in N (fully attributed namespaces) whose spelling is not in the
       catalog: `twin-unread` / `dead`, with audit and report rows;
    3. retype only where stored == default;
    4. fill blank metadata;
    5. seed with ON CONFLICT DO NOTHING;
    6. NOTICE + report for everything else;
    7. `pg_notify` per touched ns/env.
  - **Marker.** `036` = `config.config_markers` DDL, created empty.
  - **Marker contract for 296.** Row `relative_keys_v1`, written in the rename's transaction, plus
    `pg_notify`. The server reads marker and rows in one statement, and the 5-min reload backstop
    covers a lost NOTIFY.
  - **Config server.**
    - content-hash `version` (secret `updated_at` hashed, never emitted);
    - 10 s re-send;
    - LISTEN self-heartbeat every 10 s, 30 s deadline, on the existing pool slot (F-06);
    - 5-min diff-only reload backstop;
    - pg keepAlive;
    - grpc-js server ping-policy options.
  - **Clients.** keepalive 30/10; liveness 30 s; backoff 1→30 s, reset after ≥15 s.
  - **Compute.**
    - ComputePool: done-callback slot release, fixed 16 threads, bound `[1,16]`;
    - NPROC = max(limit, in_use)×16.
  - **FR-12.** `indicators.sandbox.startup_grace_ms` key; bounds timeout `[100,45000]`, grace
    `[1000,10000]`; deadline min(57 s, t+g+2 s).
  - **Inventory tool.** `services/xstockstrat-indicators/app/maintenance/config_inventory.py`,
    reusing `legacy_authors.connect`.
  - **Operator gates.** G1 inventory → A0 fixpoint/freeze; G2 before the main-dev merge
    (digest + dry-run + staging read-back); G3 before promotion.
  - **Steps:** A0–A12.
- The adversary pass is running.

## Session 2026-11-04 — sdd-design round 2 synthesis + operator decisions 15–18

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

## Session 2026-11-04 — sdd-design Phase 1, round 3 (in progress)

- **R3 proposal, integrated design.**
  - **Heal.** 035 = one latched DO block: snapshot → report disagree/secret → seed (agreeing,
    non-secret, global) → twin ∩ signed allowlist DELETE with audit → report → guarded retype →
    metadata fill → bounds report → `pg_notify` → latch row. Outside the block are only
    `CREATE … IF NOT EXISTS`. No contract-of on 035.
  - **Marker.** 036 = marker DDL.
  - **Allowlist.** Global-only `(ns, key, env, value_sha256)`, generated through
    G1 hash inventory → A2 triage → G2 `--reveal` → exact scratch-PG dry-run of the real 035 →
    `heal/signoff.md`. CI re-verifies the hashes.
  - **Gate.** The stored set comes from a scratch Postgres (`scripts/config-wiring-stored.sh`), and
    the tokenizer stored-set model is removed.
  - **Liveness.**
    - LISTEN self-heartbeat on the listener socket (10 s / 30 s);
    - `keepAliveInitialDelayMillis`;
    - a content-hash `version` with skip-on-unchanged;
    - 10 s re-send;
    - a 5-min backstop that includes per-user subscribers.
  - **FR-6.** A `config.read_key ns=… key=…` INFO literal per first read, aggregated in Loki.
  - **FR-12.** Deadline min(45 s, t+g+2 s); indicators clamps to `time_remaining()`.
  - **Compute.** ComputePool with a private executor, used by the screener too.
  - **Steps.** A0–A12 with operator gates G1/G2/G3.
- **Orchestrator ruling (P-01, consistent with AC-5):** in 295, per-user twins are reported and never
  deleted, and the allowlist is global-only. A per-user unread twin cannot change the effective value,
  and hashed user_ids cannot be matched exactly in the dry-run.
- The adversary pass is running.

## Session 2026-11-05 — sdd-design round 3 synthesis + operator decisions 19–20

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

## Session 2026-11-05 — sdd-design Phase 1, round 4 (in progress)

- **R4 proposal: the FINAL integrated design.** All round-3 majors M1–M6 and minors m1–m12, plus
  decisions 19–20, are folded in.
  - **Renumbering:** 035 = config_markers DDL (A4), 036 = heal (A10).
  - **Inventories:** staging (operator, G1 hashes / G2 reveal) plus fresh-migrations (scripted;
    exact; covers CI, docker-compose and production's first deploy). No production inventory.
  - **Gate:** reads a committed generated `scripts/config-wiring-stored.json`. A CI freshness job
    runs only on migration PRs. `policy.seededUnread='reported'`, which 296 flips to blocking.
  - **Pool:** `query_timeout` 15 s, plus a serial-chain watchdog (> 30 s head → ERROR + suspended
    re-sends).
  - **Evidence:** `config.read_key` plus a `config.read_coverage` heartbeat every 6 h (staging
    Loki).
  - **SetConfig:** FAILED_PRECONDITION when both spellings are present.
  - **Agent deadline:** honours `int_positive`.
  - **Steps:** A0–A12, with A5 split by language. G3 = first-production-deploy read-back.
- **Orchestrator ruling (P-01): renumbering ACCEPTED.**
  - golang-migrate never applies a version below the current one (`db-migrate.sh:104`), so a
    dev/compose DB that migrated past a 036 marker would skip a 035 heal.
  - A heal at 36 sits above 296's `contract-of: 035` floor and gets the `force 35` recovery hint
    (`migration-dirty-guard.sh:42-49`).
  - **The M6 recovery path is now `migrate force 35` + `scripts/db-migrate.sh up`.**
  - Feature 296 must anchor `contract-of` on 035.
- The adversary pass is running.

## Session 2026-11-05 — sdd-design round 4 synthesis + operator decisions 21–24

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

## Session 2026-11-05 — sdd-design Phase 1, round 5 (FINAL, in progress)

- **R5 proposal = round-4 design + the binding round-4 amendments only.**
  - Verified: OWNER_RE already admits `feature 296` (`check-config-wiring.mjs:306,329`), so no regex
    change is needed.
  - Verified: 001 re-creates the audit function (`001:37-47`) before its failing CREATE TRIGGER
    (`:49-51`). Only the single implicit transaction keeps an auto `force 0` replay harmless. The
    rerun leg (c) asserts `pg_get_functiondef` is unchanged.
- **Amendments integrated:**
  - **Gate:** the baseline is 296-owned `seeded-unread` entries only. `validateState` checks owner
    plus membership in the signed `heal/dryrun-fresh.tsv`, and `envReadUnseeded=blocking` at A10.
  - **Heal:**
    - `default_value` synced to the code default, with its own audit row;
    - secret-class twins are never deleted or revealed;
    - per-user FR-1 inserts never update the global row.
  - **Watchers:** cumulative `read_key` re-emit every 6 h.
  - **Agent:** boot blocks on both lifespan snapshots.
  - **Recovery:** probe → `force 35` / `force 34` → up.
  - **Pool:** `statement_timeout`.
  - **Exact wording edits** for product-spec, acceptance and 296 are listed in the proposal; they are
    applied once the design is approved.
- The final adversary pass is running.

## Session 2026-11-05 — sdd-design COMPLETE

- **R5 adversary verdict: SOUND, APPROVABLE.**
  - No Floor breach, no C-16 regression, no data-loss defect.
  - Confirmed:
    - the auto `force 0` → 001 failure rolls back fully, so `pg_get_functiondef` is unchanged
      (single implicit transaction);
    - the table-based probe still picks `force 35`;
    - the ratchet preserves @feature-278 @AC-7.
- **Binding spec-time amendments** (all written into design.md):
  - **S-1:** classify secret-class first; report values are NULL for secret/secret-class/per-user
    rows.
  - **S-2:** the snapshot holds NULL `value_data` for secret-class twins.
  - **M-1:** the baseline end state is a `--final` check, not schema narrowing; membership covers
    dead rows; A2 proves the fresh twin residuals are empty.
  - **M-2:** every readers-disagree key is seeded fresh (A2 assertion).
  - **M-3:** secret and prefix catalog entries are excluded from `read-unseeded`.
  - **M-4:** NULL-safe `cat_alt` predicate, plus a `__secret_class__` sentinel.
  - **M-5:** a probed-scope spelling that differs from the global row's spelling →
    FAILED_PRECONDITION.
  - **M-6:** the runbook applies only while 036 is config's highest migration.
  - **M-7:** no per-user plaintext in `--report`.
  - **M-8:** `unread-no-partner` report rows for every dead row.
  - **M-9:** a `metadata:` audit-reason prefix, plus a served-values-unchanged assertion.
- **Operator decision 25 (2026-11-05):** design **APPROVED** at the round-5 gate, with the
  amendments binding.
- **Phase 0 Recon:** recon.md (services: all 12 plus repo tooling). Key reuse patterns:
  - the 031 heal shape plus the `config-031.sql` harness;
  - 278's gate ratchet/policy;
  - the `ibkrTiming` closure and FMP `SetLimit`;
  - `legacy_authors.connect`;
  - the listener reconnect/resync path.
- **Phase 1 Grilling:** 5 rounds (full).
  - **Chosen approach:**
    - a dormant marker-gated alias plus a form-tolerant server;
    - a twin-only, signed, latched heal (036) with a marker table (035);
    - staging and fresh inventories with a scratch-PG exact dry-run;
    - a DB-free gate over a committed stored JSON;
    - LISTEN self-heartbeat, a watchdog and content versions;
    - hardened byte-identical watcher cores with read-key evidence;
    - live limiters, ComputePool and vendor closures;
    - an agent watcher with a derived 45 s-capped deadline.
  - **Rejected** (full list in design.md): full-dotted canonical; always-on alias; Release B in 295;
    catalog-predicate deletes; dead-row deletes in 295; a JS heal model; a pool-slot heartbeat;
    `policy.seededUnread`; a shared watcher library.
- **Constitution rules touched:** C-01, C-05 (amended), C-07, C-08, C-10, C-11, C-12, C-13, C-14,
  C-15, C-16, C-18, F-01, F-04, F-06, F-07, P-01..P-06. Floor breaches: none in any round.
- **Status:** spec-ready → design-approved.
- The round-5 wording edits have been applied to product-spec.md/acceptance.feature (AC-1, AC-15,
  AC-19, AC-28, AC-29, AC-30 edited; AC-33 added), and FR-1/3/4/5/6/8/13 and Database Changes have
  been updated. **Product-spec re-review is pending** before `/sdd-spec` (fails.md:3440).

## Open Threads (from design.md Open Risks)

- [ ] Missed reader of an "unread" spelling → A2 / G2 / A12 tripwire.
- [ ] Staging dry-run sentinel fidelity → A10.
- [ ] Serial-chain wedge is visible but does not self-heal → A4.
- [ ] grpc-js keepalive policy spike → A4.
- [ ] An unsigned twin gives FAILED_PRECONDITION until 296 → A3/A10, with the PR listing the keys.
- [ ] A dirty 036 needs manual recovery until 296's floor exists → A11 runbook.
- [ ] Trading untyped→typed getter divergences → A5a/G2.
- [ ] Migration NNN collision with 281/282/243 → spec time.
- [ ] Byte-identical copies drift → A5 hash guard.
- [ ] One PR editing both baseline files → review.
- [ ] Agent boot readiness depends on config → A8.
- [ ] Unverified library behaviours (node-postgres timeouts, `time_remaining`, produced-signals
  multi-path) → the first step that uses each.

## Session 2026-11-05 — sdd-review product-spec (post-design re-review)

- **Result:** PASS WITH WARNINGS, no blockers. Spec, acceptance and design.md are consistent.
- **Warnings resolved in the same session:**
  - Config Key Changes now carries the full FR-15 contract table for
    `indicators.sandbox.startup_grace_ms` (new), `indicators.sandbox.timeout_ms` (new bounds) and
    `analysis.compute.max_worker_threads` (new bounds, live limiter). The reader `max_workers=int_positive(self._cfg,
    "analysis.compute.max_worker_threads", 4)` was verified in the analysis servicer.
  - AC-5 Given/When reordered.
  - Added:
    - AC-34 (FR-1 FAILED_PRECONDITION, both cases);
    - AC-35 (constraint → INVALID_ARGUMENT);
    - AC-36 (FR-4 reveal exit 2);
    - AC-37 (FR-8 agent startup blocks);
    - AC-38 (FR-12 remaining-deadline clamp: 8 s − 5000 − 500 = 2500 ms; < 100 ms → no spawn).
- 295 is design-approved with AC-1..AC-38.
- **Next:** `/sdd-spec fix-config-keys-drift`, which gates on operator approval.

## Session 2026-11-05 — sdd-spec

- Generated implementation-spec.md with 39 steps (A0–A12 of design.md, test-first numbering per
  fails.md 2026-11-04 enforce-config-key-wiring). Status: design-approved → implementation-ready.
- Key codebase findings:
  - **Migration NNN collision (design re-check).** `origin/main-dev` still tops out at `034`, but
    035/036 are held by open PR #1359 (`origin/claude/smoke-test-deployment-0f1z5j`, `035_smoke_rpc_user_id`,
    `036_smoke_writes_enabled`), 037 by feature 281 (committed on `origin/feature/signal-watchlist-expiry-pruning`)
    and 038/039 by feature 282's spec. The operator set this chain on 2026-11-02 (281 context.md). The
    spec renumbers 295 to **`040_config_markers` / `041_heal_config_keys_to_reader_catalog`**
    (recovery `force 40` / `force 39`; 296 anchors `contract-of` on 040). 295 must merge after
    035–039 land on main-dev (golang-migrate has no out-of-order guard).
    **Operator confirmation required before Step 9** — open below.
  - Merge-order row 25 (295 after 243) is satisfied: 243 Step 5 closed on main-dev (`3aedb964`, #1446).
    The feature branch is behind main-dev (doc-only plus `sandbox_keys_check.py` and its test, plus 6
    lines of `ci.yml`), so rebase before Step 1. `sandbox_keys_check.py` is the closest precedent for
    the Step 2 inventory tool.
  - Config server anchors re-verified at the design cites (`configServiceImpl.ts` setConfig
    `:494-655`, probes `:575-590`, catch-all 13 `:652-654`, Date.now version `:281/:304/:650`, serial
    `:179-186`; `authz.ts:84-112`; pool `index.ts:29-34`).
  - The Go/Python/Node watcher copies are not identical today (md5 differ; trading is multi-namespace,
    marketdata has ResolveSecret, portfolio FactorMap). So the byte-identical unit is a new core file
    (`watchcore.go` / `watch_core.py`) plus the rewritten Node `configWatcher.ts`, guarded by a new
    `scripts/check-watcher-copies.sh` run in the `config-wiring` CI job (feature-266 exemption precedent,
    `dry-guard-rail.md:80-86`).
  - Agent `test_formula` already passes `deadline_s` to `_grpc_error_message` (`tools.py:1659`); only
    the deadline value changes.
  - UI: `forward()` hands `req` to the lambda, so the FR-9 fix is a spread at `traderBff.ts:167` /
    `insightsBff.ts:171`, with no new handler body. AC-9 is tested in vitest (Playwright runs with
    `APPLICATION_ENV=development`).
- Spec-time resolutions (recorded in Execution Summary):
  1. 040/041 renumbering;
  2. heal artifacts live in `scripts/config-heal/` (not the archivable feature dir);
  3. UI lambda spread;
  4. AC-28 `force 35` reads as `force 40`.
- DB-backed verifications are assigned to named actors: the CI `migration-rerun` and
  `config-wiring-stored` jobs on the draft integration PR, and the operator for G1/G2/staging
  read-back.

### Open Threads (added by sdd-spec)

- [ ] **Operator: confirm the 040/041 renumbering and "295 merges after 035–039"** (alternative: 295
  takes 035/036 and 280/281/282 renumber) before Step 9.
- [ ] `/sdd-review product-spec`: reword AC-28 `force 35` → `force 40`, and Database Changes `035`/`036`
  → `040`/`041`.
- [ ] Feature 296 (`feature/fix-config-keys-contract`): re-anchor `-- contract-of:` on `040_config_markers`.

## Session 2026-11-05 — sdd-review impl-spec (advisory)

- **Result:** 0 hard failures, 0 Floor breaches, 9 warning themes (advisory; did not block). Every
  AC-1..AC-38 is traced to a step. N→N+1 test-first pairing holds. S-1/S-2, the `--final`
  membership check, FR-1 per-user precision and F-01/F-06 are honoured.
- **Unresolved ✗ / ⚠ carried into execution:**
  - Steps 9, 33, 34, 4: migration numbering. **Correction from verification:** config's migration
    folder is claimed 035/036 by open PR #1359 (`035_smoke_rpc_user_id`,
    `036_smoke_writes_enabled`) and 037 by feature 281 (`037_portfolio_signal_prune_interval`).
    Feature 282 adds **no** config migration (its 038/039 premise in the spec was wrong). The next
    free config numbers are therefore **038/039**, not 040/041. Pending operator ruling (C-07/F-01).
    Steps 4/34 hardcode `goto 40`/041 without the gate. — [ ] unaddressed
  - AC-28 text still reads `force 35`; sync it to the final marker number (C-15). — [ ] unaddressed
  - Step 21 Files lists the directory `internal/finnhub/`; name the exact file (C-01/F-04). Steps
    15/17/19 use brace shorthand in Files. — [ ] unaddressed
  - Step 21: the `ResolveSecret` re-resolve is an outbound GetSecret. State that
    `x-internal-caller` / `x-trace-id` are propagated (C-03). — [ ] unaddressed
  - Steps 18/19: no test builds a snapshot from the seeded `analysis.compute.max_worker_threads` and
    asserts the real ComputePool limit follows it (B2 config-key wiring (b)). — [ ] unaddressed
  - Steps 26/27: no test reads the seeded `indicators.sandbox.startup_grace_ms` = 5000 through the
    real reader (B2 (b)). — [ ] unaddressed
  - Test steps 1, 3, 10, 14, 16, 18, 20, 22, 24, 26, 28, 30, 37 carry no coverage threshold in their
    own Verification (the paired service steps do) (C-08). — [ ] unaddressed
  - Steps 4, 13, 19, 29, 38 are oversized; consider splitting (C-18). — [ ] unaddressed
  - Step 23: enumerate unaffected order types and fill states per B2b. — [ ] unaddressed
  - Step 36: "re-sign may only remove tuples" is not machine-checked; add a check. — [ ] unaddressed
  - Steps 9/33: add an explicit "041 must not merge or apply anywhere before Step 36" note
    (F-01). — [ ] unaddressed
- **Overlap findings** (no confirmed FAIL):
  - WARN: shared-file edits with 282 (`configServiceImpl.ts` `SCALAR_BOUNDS_REGISTRY`; its
    bare-spelling bound tests must be re-checked after 295's canonical re-key), with 281
    (`ci.yml` ci-gate block), with 294 (indicators servicer/watcher, agent main/tools), and with
    282 (agent client/tools).
  - WARN: `indicators.sandbox.timeout_ms` rows were last written by 243's 031. 041 must not
    re-INSERT them (ON CONFLICT DO NOTHING covers it); settle at Step 33.
  - Note for 281/282 owners under decision 6: their deliberately unseeded keys (227 waiver) must
    now be seeded.
- **Docs sync:** PRs davcs86/xstockstrat#1436 (295 docs) and #1441 (296 docs) were squash-merged to
  main-dev on the operator's instruction ("merge them if green"). The two feature branches were then
  brought level with main-dev by a merge commit; a force-reset was denied by the auto-mode
  classifier, so the non-destructive path was used. Implementation will go through new PRs.

### Operator decisions (explicit sign-off, 2026-11-05, continued)

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

## Session 2026-11-05 — sdd-execute sequential: re-spec gate (§5.3)

- **Branch setup:** `origin/main-dev` merged into `feature/fix-config-keys-drift` with a normal merge
  (`19c03df4`). The only conflict was this file, resolved to the branch side (operator decisions 28–29
  kept). The ledger files merged cleanly, and `scripts/ledger-guard.py --fix` reported `clean`.
- **Tooling note:** the main worktree has no `node_modules`, so there was nothing to symlink.
  `core.hooksPath` points at `/home/user/xstockstrat/.husky/_`, which does not exist, so no pre-commit
  hook ran on these doc commits. `--no-verify` was not used. §5.4b tooling setup must install pnpm deps
  before the first code step.
- **Re-spec (conditional directive).** Changes are limited to step bodies.
  - **Step 1:** evidence re-verified; coverage threshold added; decision-27 gate status recorded.
  - **Step 3:** cites `ci.yml:133` and test cases `:477`/`:502`/`:577`; coverage note added.
  - **Step 4:** ci.yml cites re-stamped (`:678-714`, `:1001-1019`, `:1021`, `:123-133`).
    - The existing `config-wiring` CI job already runs `--final` (`ci.yml:1019` → `ratchet`, mjs `:741`).
    - So Step 4 now also runs `--final`, and any reader-before-seed finding gets a `feature 295`
      baseline entry.
  - **Steps 7, 8, 10, 11:** `configServiceImpl.ts` cites +2.
    - Step 8 keeps 281's `portfolio.watchlist.signal_prune_interval_seconds` bound (`:150`) through
      the single probe, and appends at the registry tail per `merge-order.md:102`.
    - Step 11 instruction 8 cites decision 29 (throwaway local Postgres, spike only).
  - **Step 9:** evidence rewritten to decision 28 / `merge-order.md:100-103`.
    - Origin scan 2026-11-05: config migrations above 034 are 035/036 (PR #1359 only), 037 (on
      main-dev) and 282's `038_marketdata_asset_refresh_interval` (on `origin/feature/filter-otc-symbols`
      only). There is no 039/040/041 anywhere.
    - The operator gate is answered by decision 28.
  - **Step 12:** no mismatch, body unchanged.
  - **Step 13:** produced-signals comma-list claim corrected (rows 2 and 5 are comma lists, rows 3 and
    4 single paths). Marketdata gains `NewSnapshotWatcher` (trading `config.go:249` signature) plus
    the core's exported `ApplyUpdate`, so Step 20 has a harness.
  - **Steps 19, 21, 25, 27:** Files completed.
    - 19: lists the 5 existing analysis/indicators/ingest tests that touch `_compute_executor` or a
      semaphore's `._value`/`.locked()`, beyond the two the directive named. Brace shorthand expanded.
      A ComputePool-follows-seeded-key test was added (B2 (b)).
    - 21: names `finnhub_client.go`, covers all 11 `s.fundProvider` sites, and adds the C-03 headers
      on the secret re-resolve. Adds `internal/config/config.go` and `go.mod`, because uuid becomes a
      direct dependency.
    - 25: adds analysis `app/main.py`.
    - 27: adds `test_sandbox_isolation.py`, `test_sandbox.py` and `config-wiring.json`. Adds a
      seeded-grace-key test through the real reader (B2 (b)).
  - **Steps 20, 28, 29:** cites re-stamped (agent `client.py` +22, `tools.py` +6). Coverage notes
    added to 20 and 28.
  - **Step 33:** cite `:248-264`; explicit F-01 note that 041 stays unapplied to shared DBs until
    Step 36.
  - **Step 36:** precondition is now "282's 038/039 on main-dev, max = 039". Added a machine-checked
    monotone re-sign (`allow_041:begin/end` markers, `comm -13` subset check, tested locally on a
    sample).
  - **Step 37:** CONFIG-9 no longer contains "NO fixed convention", so RED comes from the
    positive-phrase legs and the 227 waiver text (`config-governance.md:186/197/211/228`).
  - **Step 38:** instruction 5 rewritten.
    - Row 26 already anchors on `040_config_markers`.
    - The new row is 295 waits for 282's 038/039.
    - The "NO fixed convention" grep is scoped to convention docs, so it can pass.
- **Impl-spec review warnings (context.md 2026-11-05 review), status after this re-spec:**
  - [x] Steps 4/34 `goto 40`/041 hardcode: answered by decision 28 (040/041 pinned).
  - [ ] AC-28 `force 35` text in `acceptance.feature`: not a step body, out of this re-spec's scope.
    Still open for `/sdd-review product-spec`.
  - [x] Step 21 Files directory. [x] Step 19 brace shorthand. [ ] Steps 15/17 brace shorthand (not in
    directive).
  - [x] Step 21 C-03 propagation.
  - [x] Steps 18/19 ComputePool B2 (b): covered in Step 19's `test_config_zero_clamps.py` change.
  - [x] Steps 26/27 grace-key B2 (b): covered in Step 27.
  - [x] Coverage thresholds in test Steps 1, 3, 10, 20, 28, 37. [ ] Steps 14, 16, 18, 22, 24, 26, 30
    (not in directive).
  - [ ] Split oversized Steps 4/13/19/29/38: not done. Renumbering steps exceeds a re-spec; operator
    call.
  - [ ] Step 23 order-type/fill-state enumeration (not in directive).
  - [x] Step 36 monotone re-sign check.
  - [x] Steps 9/33 F-01 note.
  - Decision 27's "before Step 1" precondition is therefore **not fully met**. The open items above
    need an operator ruling (waive, or re-spec Steps 14–18/22–24/26/30 plus the AC-28 reword) before
    Step 1 executes.
- **Observations outside step bodies (not edited; non-step sections):**
  - `## Step Dependencies` still says "`--final` is run only at Step 36" and has the stale 035–039
    operator gate. The Execution Summary resolution 1 also says "merges after 035–039". Decision 28
    supersedes both.
  - Step 11 instruction 8 (keepalive spike) needs the Step 12/14/16 client watchers. Those land
    after Step 11, so the spike cannot run inside Step 11 as ordered. **Open question for the
    operator:** move the spike to the end of Step 13 (first client core), or keep it in Step 11 with
    a throwaway client.
  - Step 13's marketdata `NewSnapshotWatcher` + `ApplyUpdate` export is a re-spec-time choice made to
    give Step 20 a harness. The operator may veto it in favour of another harness.

## Session 2026-11-05 — sdd-execute sequential (sdd-batch-execute)

- **Up-front confirmation (§5.4):** the operator approved the up-front plan through the
  `sdd-batch-execute` workflow (mode-entry confirmation given). It covers the branch setup, the
  re-spec above (conditional directive over Steps 1,3,4,7–13,19–21,25,27–29,33,36–38) and the
  pending step list 1–39. That single confirmation replaces per-step Phase-2 prompts for this feature.
- **Status:** `implementation-ready` → `in-progress` (status.md, feature.md history row).
- **Step loop not started in this session.** Two items need operator attention before Step 1:
  - **Decision 27's precondition is not fully met.** See the re-spec note above for the open
    mechanical warnings, the AC-28 text and the step-split suggestion. They need a waiver or a
    follow-up re-spec.
  - **Step 11 keepalive-spike ordering:** an open question (see above).
- **Next:** `/sdd-execute fix-config-keys-drift sequential`, resuming at Step 1 once those are ruled on.
  First run §5.4b tooling setup: pnpm deps are absent, so the husky hook cannot run.

## Session 2026-11-05 — sdd-execute sequential (sdd-batch-execute): second re-spec gate (§5.3)

- **Up-front confirmation (§5.4):** the operator approved the up-front plan through the
  `sdd-batch-execute` workflow. Status was already `in-progress`, so status.md was not changed.
- **Branch setup:** `git merge --no-edit origin/main-dev` reported "Already up to date"
  (`origin/main-dev` `94908ce6` is an ancestor of the branch), so there was no merge commit and no
  conflicts. `scripts/ledger-guard.py --own-slug fix-config-keys-drift --base origin/main-dev --fix`
  reported `clean`.
- **Tooling note (unchanged):** the main worktree has no `node_modules`, so there was nothing to
  symlink. `core.hooksPath` (`/home/user/xstockstrat/.husky/_`) does not exist, so no pre-commit hook
  ran. lint-staged only targets `services/xstockstrat-ui/**`, so these doc commits would not have been
  formatted anyway. `--no-verify` was not used.
- **Re-spec (conditional directive; step bodies only):**
  - **Step 1:** its own evidence holds. The decision-27 gate is still **not met**, and the gate bullet
    now lists what is open: (a) no coverage line in test Steps 14, 16, 18, 22, 24, 26; (b) brace
    shorthand in Steps 15/17 Files; (c) Step 23's B2b enumeration; (d) the Steps 4/13/19/29/38 split;
    (e) AC-28 at `acceptance.feature:153` still says `force 35`.
  - **Step 3:** cite corrected to `declaredFromMigration` `:664-673`, with the CLI option at `:720`/`:730`.
  - **Step 9:** evidence holds (origin scan: config migrations ≥035 are 035/036 on PR #1359, 037 on
    main-dev, and 038 on `origin/feature/filter-otc-symbols` only; there is no 039–041). A note was
    added saying that `## Step Dependencies` and Execution Summary resolution 1 ("after 035–039",
    "`--final` only at Step 36") are superseded by decision 28 and by `ci.yml:1019`. Those non-step
    sections were not edited.
  - **Step 11:** cites hold; `pg` `^8.11.5` was recorded. Instruction 8 (keepalive spike) is now
    explicitly gated on the open operator ruling: (A) move it to the end of Step 13, or (B) use a
    throwaway client in Step 11.
  - **Step 30:** the `insightsBff.test.ts` `configClient` stub (`:17`) is only `{ setConfig }`.
    Instruction 1 now extends it with a `getConfig` `vi.fn()`. A coverage line was added (vitest 40%
    over `src/lib/**`; `*Bff.ts` is excluded). This closes item (a) for Step 30.
  - **Step 36:** the precondition state was re-checked (highest on main-dev is 037; there is no 039
    anywhere). It is not met yet, which is expected at Step 36.
- **Step loop not started.** Before Step 1 the operator still needs to rule on: the decision-27 items
  (a)–(e) (waive, or re-spec Steps 4/13–19/22–24/26/29/38 and reword AC-28), and the Step 11 spike
  ordering.

## Session 2026-11-06 — sdd-execute sequential (sdd-batch-execute): targeted re-spec for decision 27

- **Operator ruling (Option A, 2026-11-06)** on the Step 1 blocker: run a targeted re-spec that
  closes decision-27 items (a), (b), (c) and (e), then execute Step 1 as specced.
- **Re-spec (step bodies plus AC-28; one artifact per commit):**
  - (a) Coverage-threshold lines added to test Steps 14, 16, 18, 22, 24 and 26. Each names the
    threshold that the paired service step enforces.
  - (b) Steps 15/17 **Files** brace shorthand expanded to one path per line.
  - (c) Step 23 instruction 3 now lists the five order types (`trading.proto:82-89`), the seven
    non-zero order statuses (`trading.proto:91-100`) and OFFLINE (`common.proto:72-74`) as unaffected.
  - (e) AC-28 in `acceptance.feature` reads `migrate force 40`. The `@AC-28` ID is unchanged (C-15).
    The same scenario's `dirty 036` was also changed to `dirty 041`, matching Step 32's
    "dirty at 41" leg. That second change was not named in the ruling.
  - Step 1's gate bullet now says the gate is cleared.
- **Impl-spec review warnings closed by this re-spec:** [x] Steps 15/17 brace shorthand; [x] coverage
  lines in Steps 14, 16, 18, 22, 24, 26; [x] Step 23 order-type/fill-state enumeration;
  [x] AC-28 `force 35` text.

### Operator decisions (explicit sign-off, 2026-11-06, continued)

30. **Steps 4/13/19/29/38 stay unsplit** (decision-27 item d; operator, 2026-11-06). The C-18 split
    warning is waived. With items (a), (b), (c) and (e) closed by the 2026-11-06 re-spec, **the
    decision-27 gate is cleared** and Step 1 may run.

### Step 1 — test: config inventory tool (redaction, hashes, reveal refusal) [done]
- Created `tests/test_config_inventory.py`: 8 cases over a fake asyncpg connection, with
  `legacy_authors.connect` patched. Row literals stay inline (C-13). Covers AC-22, AC-30, AC-33 and
  AC-36. Every issued SQL lacks `value_encrypted`. No plaintext or ciphertext probe, and no sha256 of
  either, appears in any output. `value_sha256` is `sha256("100")`. The trailer is `output_sha256=` +
  `tool_sha256=`. The twin `marketdata.fmp.api_key` is secret-class (null hash, reveal exits 2).
  Per-user and secret reveals exit 2. `user_id` appears only as `user_sha256`.
- **Contract this suite fixes for Step 2:**
  - the reveal request is a JSON list of `{namespace, key, environment[, user_id]}`. `user_id` is
    how a per-user row is named (AC-36);
  - revealed records carry a `value` field;
  - exit codes come from `main(argv)` as a return value or `SystemExit`;
  - the fake returns every row for each `config_values` SELECT, so the tool filters in Python;
  - record field names `namespace`/`ns` and `environment`/`env` are both accepted.
- **TDD:** AC-22/30/33/36 red: `uv run pytest tests/test_config_inventory.py -q` →
  `ModuleNotFoundError: No module named 'app.maintenance.config_inventory'` (1 error during
  collection). Green is due at Step 2.
  - A throwaway sketch of the tool (deleted, never staged) made all 8 cases pass. So the suite can be
    satisfied, and it does not hold contradictory assertions.
- `ruff check` and `ruff format --check` are clean on the new file.
- Until Step 2 lands, the full indicators `pytest` fails to collect this module. That is expected
  test-first state on the feature branch; no PR is open.
- Files modified: `services/xstockstrat-indicators/tests/test_config_inventory.py`
- Deviations: none

## Session 2026-11-06 — sdd-execute sequential (sdd-batch-execute): third re-spec gate (§5.3)

- **Up-front confirmation (§5.4):** the operator approved the up-front plan through the
  `sdd-batch-execute` workflow. Status was already `in-progress`, so status.md was not changed.
- **Branch setup:** `git merge --no-edit origin/main-dev` merged cleanly as `4c9b9928`, with no
  conflicts. It brought in feature 282 (`0ea9b5c5`) and #1458 (`6652cd44`).
  `scripts/ledger-guard.py --own-slug fix-config-keys-drift --base origin/main-dev --fix` reported
  `clean`. The merge commit has git's default message, so it has no session trailer.
- **Tooling note (unchanged):** the main worktree has no `node_modules`, so there was nothing to
  symlink. `core.hooksPath` (`/home/user/xstockstrat/.husky/_`) does not exist, so no pre-commit hook
  ran. `--no-verify` was not used.
- **Re-spec (conditional directive; step bodies only):**
  - **Steps 7, 8, 10, 11, 33:** `configServiceImpl.ts` is 760 lines. 282 added three
    `SCALAR_BOUNDS_REGISTRY` entries at `:151-157`, so every anchor after `:150` moved +7. All
    anchors were re-checked. The registry tail is now 282's `portfolio.watchlist.max_symbols_per_list`
    `:157`. Step 8 appends after it. The `authz.ts` anchors hold. Step 11 instruction 8 (keepalive
    spike ordering, option A or B) is **still an open operator question**; no ruling is recorded.
  - **Steps 9, 36:** 282's `038`/`039` are on `origin/main-dev`, and `039` is the highest config
    migration there. A `git log --remotes` scan finds no `040`/`041` config migration on any origin
    ref, only `042`/`043` (291, 293). The merge-order precondition is met. Step 36 still re-checks it.
  - **Steps 20, 21:** these anchors moved: the `marketdata_service.go` `s.fundProvider` sites (now
    `:1705` … `:2064`, set at `:226`) and the `main.go` Finnhub/FMP anchors. The directive gave
    `newFundamentalsSource` as `:228-261` and `newFMPClient` as `:249`. The file shows the doc comment
    at `:227-228`, the function at `:229-244`, the Finnhub branch at `:231-234`, and `newFMPClient` at
    `:248-261` (`Limits` `:256`), and the spec cites those values.
  - **Steps 28, 29:** the agent `client.py`/`tools.py` anchors were re-cited (for example
    `get_config_value` `:1870`, `tools.py:679`, `_agent_policy` `:2628-2641`, `test_formula` error
    path `:1670`). The `oauth_server.py`/`main.py` anchors and AGENT-1 `:17` hold.
  - **Step 37:** the `config-governance.md` waiver phrases moved +18, to `:204`, `:215`, `:229`, `:246`.
  - **Step 38:** #1458 removed root `CLAUDE.md` § Teardown, so instruction 6 (Teardown) was dropped.
    282 has merged, so the planned "295 waits for 282" `merge-order.md` row would record a dependency
    that is already satisfied. Instruction 5 now says "no edit", `merge-order.md` was removed from
    **Files**, and the new-row grep was removed from **Verification**. The step **title** still says
    "merge order, teardown" because re-spec edits bodies only.
- **Not edited (outside step bodies):** the `## Step Dependencies` / Execution Summary wording noted
  in the 2026-11-05 session is still superseded by decision 28.
- **Step loop:** continues at Step 2 once the operator rules on the Step 11 spike ordering. That
  ruling is needed before Step 11, not before Step 2.

## Session 2026-11-06 — sdd-execute sequential (sdd-batch-execute): Step 2

- **Step 2 — service: `config_inventory.py` read-only DO-console tool: done.**
  - Created `services/xstockstrat-indicators/app/maintenance/config_inventory.py`:
    `python -m app.maintenance.config_inventory [--reveal <request.json> | --report]`. It runs one
    `READ ONLY` transaction with SELECTs only and connects via `la.connect`. It uses asyncpg plus the
    stdlib only.
  - The secret-class classifier uses `is_secret`, the `k` ↔ `ns.k` partner in the same
    `(ns, env, COALESCE(user_id,''))` scope, or the static `SECRET_KEYS` /
    `SECRET_KEY_PREFIXES` (`ingest`/`mcp_credential.`) copied from `authz.ts`
    `SECRET_CALLER_ALLOWLIST`.
- **Blocker resolved by operator (Option A, 2026-11-06):** once the module existed, `ruff check .`
  flagged I001 in Step 1's test file. The operator expanded Step 2's scope by one lint-only change,
  `ruff check --fix tests/test_config_inventory.py`, which moves the `ci` import below
  `import pytest`. That change is committed with this step and recorded in the Deviation Log.
- **Interpretations (spec silent, not deviations):**
  - `--reveal` and `--report` are mutually exclusive, and each replaces the inventory listing. Every
    mode ends with the `output_sha256=` and `tool_sha256=` trailer.
  - A reveal request with any refused entry prints refusal lines only and exits 2, so no entry's
    value is printed.
  - A reveal entry that has no global row prints `found: false` and exits 1.
  - `--report` with no `config_heal_report_041` table prints `{"present": false}` and exits 0. On
    per-user report rows, `stored_value` and `effective_value` are printed as null, and `user_id` is
    printed only as `user_sha256` (M-7).
  - `in_bounds` matches the three Config Key Contract keys in either spelling (bare or
    namespace-prefixed).
  - Tool diagnostics never go to stdout (no `la.log`), so the last two lines are always the trailer.
- **Deviation:** secret rows' `value_data`/`default_value` are nulled in SQL, and `default_sha256`
  is null for secret-class rows (Deviation Log).
- **TDD:**
  - RED: `uv run pytest tests/test_config_inventory.py -q` failed with
    `ModuleNotFoundError: No module named 'app.maintenance.config_inventory'` (1 error during
    collection).
  - GREEN: the same command gives `8 passed`.
- **Verification (all pass):**
  - `ruff check .` → `All checks passed!`
  - `ruff format --check .` → `51 files already formatted`
  - `pytest --cov=app --cov-fail-under=50` → `464 passed`, total 84.54%, `config_inventory.py` 78%
  - `grep -n value_encrypted app/maintenance/config_inventory.py` → no output
  - `node scripts/check-config-wiring.mjs` → exit 0
- **Tooling:** `node_modules` was symlinked from the main worktree. `uv sync --extra dev --frozen` was
  run in indicators. No manifest changed.
- Files modified:
  - `services/xstockstrat-indicators/app/maintenance/config_inventory.py`
  - `services/xstockstrat-indicators/tests/test_config_inventory.py` (lint-only, operator Option A)

## Session 2026-11-06 — sdd-execute sequential (sdd-batch-execute): Steps 3+4 (atomic unit)

### Operator decisions (explicit sign-off, 2026-11-06, continued)

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

### Step 3 — test: config-wiring gate extensions (fixtures + 278 test rewrites) [done, unit 3+4]

- Seven new cases, `gate 1`–`gate 7`, with fixtures under `scripts/config-wiring-fixtures/gate/`. The
  tests stamp each fixture fresh through `storedInputsSha256`. The cases cover:
  1. `seeded-unread` (AC-19);
  2. `type-mismatch`, where int→float is allowed (AC-19);
  3. `unattributed` in both modes (AC-19);
  4. `metadata-missing` and `default-mismatch`, with readers-disagree suppression and reporting;
  5. a stale `inputs_sha256` under `--final`;
  6. `--emit-heal-data`, which exits 2 on an empty description; the positive leg checks both
     VALUES blocks and the allow-tuple rule;
  7. `--final` membership against `dryrun-fresh.tsv`, plus an `--inventory` reporting leg.
- Rewrites:
  - `baseline 2` covers the new kinds, the `feature 295` owner on new kinds, namespaced
    `read-unseeded`, and stored-JSON freshness;
  - `baseline 3` covers the `SWEEP_277` read-unseeded ids as `read-unseeded:<ns>/<key>`;
  - `baseline 4` reads secrets from the stored JSON and asserts their `default_value` is null;
  - `skill 3` asserts that clauses (a) and (b) are present;
  - the seed tests: 1 and 6 were recast, and 2/3/4/5/7/8/9 were deleted with their fixtures.
- `ratchet 1` (@feature-278 @AC-7, an unbaselined seeded-unread fails `--final`) is preserved unchanged.
- **TDD RED** (new test file and fixtures against the pre-unit gate, in a scratch export of `HEAD`):
  `node --test scripts/config-wiring.test.mjs` → `tests 47, pass 28, fail 19`. The failures were:
  - `TypeError: cw.storedInputsSha256 is not a function` (×15);
  - `cw.loadStored is not a function`;
  - `Unknown option '--emit-heal-data'`;
  - `unattributed read-unseeded: read-unseeded:/oauth.allowed_redirect_uris`.
- **GREEN:** `tests 47, pass 47, fail 0`.
- Files modified: `scripts/config-wiring.test.mjs`, plus these fixtures under
  `scripts/config-wiring-fixtures/`:
  - `gate/**` (new);
  - `join/*/scripts/*` (new);
  - `ratchet/*/scripts/config-wiring-stored.json` (new);
  - `ratchet/*/config-wiring.json` (`rewriteAllow` dropped, namespaced entries);
  - `seed/*` (7 fixtures deleted).
- Deviations: the fold, the seed-test retirement and the fixture migration (Deviation Log).

### Step 4 — service: extend `check-config-wiring.mjs` (stored JSON, attribution, kinds, modes, CI job) [done, unit 3+4]

- **Gate:**
  - It reads `scripts/config-wiring-stored.json` (`loadStored`, `storedSets`) and exports
    `storedInputsSha256`. The tokenizer stored-set model is retired.
  - It attributes reads through `registry.receivers` and joins readers to rows by `(ns, key)`.
  - New kinds: `unattributed`, `type-mismatch`, `metadata-missing`, `default-mismatch` and
    `readers-disagree`.
  - New modes: `--inventory` and `--emit-heal-data`.
  - `--final` adds the `STALE-STORED` and `NOT-IN-DRYRUN` checks.
- **Extractors:** the Python extractor and `extractRegexReads` now emit `receiver`, `getter` and the
  literal `default` for each read.
- **Generator:** `scripts/config-wiring-stored.sh` is bash 3.2, and passes shellcheck and shfmt. It
  creates a scratch DB, renders the config migrations, applies them one at a time to record each
  row's inserting migration, dumps the rows with `jsonb_pretty`, computes `inputs_sha256`, drops the
  DB, and never prints the URL.
- **Stored JSON source:** the initial `config-wiring-stored.json` (194 rows, the same count as the
  retired tokenizer) was generated **locally with Docker** (instruction 9), in a throwaway container
  under decision 31 / decision-29 terms. The container was removed afterwards. Run details are in the
  Deviation Log.
- **Tooling installed on the host:**
  - golang-migrate 4.17.1 at `/usr/local/bin/migrate`, the same pin as `Dockerfile.migrate`. The
    image build itself could not reach Alpine's apk mirror through the proxy.
  - shfmt 3.8.0 from apt, the same source as the CI `shell-lint` job.
- **Baseline:** 130 entries. 100 `read-unseeded` entries were namespaced, and 6 `default-mismatch`
  entries were added with owner `feature 295`, to be drained at Step 36. `policy.envReadUnseeded` is
  unchanged (`reported`).
- **CI:**
  - New job `config-wiring-stored` (timescaledb service, migrator image): it runs the generator, fails
    on `git diff --exit-code`, and uploads the JSON with `if: always()`.
  - New `changes` filter `config-wiring-stored`, and the job is added to `ci-gate` `needs`.
  - The `config-wiring` filter gains `scripts/config-heal/**`, `config-wiring-stored.json` and
    `config-wiring-stored.sh`.
- **Verification (all pass):**
  - `node --test scripts/config-wiring.test.mjs` → 47/47;
  - `node scripts/check-config-wiring.mjs` → exit 0;
  - `node scripts/check-config-wiring.mjs --final` → exit 0. Two REPORTED lines:
    `marketdata.fundamentals.provider` readers-disagree, and `trading.fill_poller.interval_ms`
    read-unseeded:production;
  - `shellcheck scripts/config-wiring-stored.sh` → clean;
  - `grep -n "config-wiring-stored" .github/workflows/ci.yml` → the job, the filter and the `ci-gate`
    needs entry are present.
- **The CI job has not run yet.** The `config-wiring-stored` job's first run happens on the
  integration PR. The executor records the run URL there (actor: CI).
- **Doc drift, not fixed here (out of this unit's Files; Step 38 owns docs):**
  - `docs/context-constitution.md` PLAT-14 (`:52`, `:93`) still describes the tokenizer model
    (`buildStoredSet`/`applyUpdate`/`applyDelete`, `rewriteAllow`, `unmodelled-rewrite`).
  - `docs/patterns/config-governance.md:78-79` still describes `unmodelled-rewrite`/`rewriteAllow`.
- **Hooks:** the main worktree has no `node_modules`, so there was nothing to symlink. `core.hooksPath`
  (`/home/user/xstockstrat/.husky/_`) does not exist, so no pre-commit hook ran. `--no-verify` was not
  used.
- Files modified:
  - `scripts/check-config-wiring.mjs`
  - `scripts/config-wiring-py-reads.py`
  - `scripts/config-wiring.json`
  - `scripts/config-wiring-stored.sh` (new)
  - `scripts/config-wiring-stored.json` (new, generated)
  - `.github/workflows/ci.yml`
- Deviations: see the Deviation Log entries dated 2026-11-06 for Steps 3+4 and Step 4.

## Session 2026-11-06 — Step 5 (G1 staging inventory, operator gate)

- **G1 staging**
  - `output_sha256=633f91d52d2aada7c96deeed2722152aa70dfcf85c4001fd9816dabf56ab701b`
  - `tool_sha256=5515ed6eb80520cdfc0512f6e0304753f9fd32f8fedbf628c633dcaf0665d1e5`, equal to
    `shasum -a 256 services/xstockstrat-indicators/app/maintenance/config_inventory.py` on this branch.
  - 204 records (`grep -c '"value_sha256"'`). The body re-hashes to `output_sha256`, so the paste is
    byte-exact. The tool's stdout log line `[run_id=-] target host=… db=staging` is not part of the
    hashed body and was not committed.
- **Deviation (operator-approved, 2026-11-06):** the DO console cannot host a pasted file (no `cat`),
  so Steps 1–2 (`config_inventory.py` + its test, byte-identical to `26641c8d`) shipped early to
  main-dev as intermediate PR #1462 (squash `d868c039`). The operator then ran the deployed module
  `python -m app.maintenance.config_inventory`. The integration PR will carry those two paths
  unchanged versus main-dev.
- **Observed in the inventory (input to Step 6 A2 triage, not acted on here):** staging-only rows
  with `has_description=false` (e.g. `analysis.analysis.backtest.*`, `analysis.engine.*`,
  `marketdata.fundamentals.history.enabled` under both key forms, `marketdata.alpaca.paper` as
  `string`), two per-user staging rows (`analysis.opportunity.live_enrich_ttl_seconds`,
  `fundsignal.min_conviction_to_emit` typed `string`), and `ledger.stream.notify_enabled` /
  `trading.fill_poller.interval_ms` present for staging only.
- Files modified: `scripts/config-heal/inventory-staging.jsonl` (new), implementation-spec.md
  (Step 5 → done), feature.md, context.md.

## Session 2026-11-06 — sdd-execute sequential (sdd-batch-execute): re-spec gate

- Branch setup: merged `origin/main-dev` into the feature branch (normal merge, no conflicts;
  merge commit `dda2f9b4`). `scripts/ledger-guard.py --own-slug fix-config-keys-drift --fix`
  reported clean, so no repair.
- Status was already `in-progress`; no status flip. The operator approved the up-front plan.
- Re-spec, Codebase Evidence only (Instructions, Files and Verification unchanged):
  - Step 9: `--final` runs at `ci.yml:1029` (`config-wiring` job `:1011-1029`); the
    `values.final` → `ratchet` selection is `check-config-wiring.mjs:803-804` (`:741` is catalog
    code). Step 4's old `ci.yml:1021` is now `config-wiring-stored` at `:1033`, `ci-gate` at
    `:1077`. The `040_config_markers` files are still absent, so they are created.
  - Step 27: the `--final` anchor moves `ci.yml:1019` → `:1029`. The sandbox, servicer, watcher and
    test anchors still resolve.
  - Step 36: `envReadUnseeded` default `:316` → `:179`, `OWNER_RE` `:306` → `:169`, ratchet
    `:683-708` → `:691-705` (with `isReported` at `:686`). The baseline is 130 entries (124 × `feature 278`,
    6 × `feature 295`), and the policy is still `reported`.
- Facts unchanged: the highest config migration on main-dev is `039`. No origin ref has `040`/`041`.
  `042` (291) and `043` (293) are as pinned in `merge-order.md:100-103`.

## Session 2026-11-06 — sdd-execute sequential (sdd-batch-execute): Step 6 (A2 triage + catalog freeze)

- Input: `node scripts/check-config-wiring.mjs --json --inventory scripts/config-heal/inventory-staging.jsonl`.
  The gate produced 132 findings on the fresh stored model, and the staging inventory produced 135.
  Both counts are the same before and after `catalog.tsv` existed.
- **Triage (closed taxonomy, `design.md` § Step outline):**
  - **seed** (101 `read-unseeded`): every read key with no row in some environment. 036 step 3
    seeds them from `catalog.tsv`. This includes `trading.fill_poller.interval_ms`, which is
    missing in production only.
  - **twin** (19 `form-mismatch` in the fresh model; 20 in staging): the bare-spelled rows
    `analysis` `backtest.max_duration_seconds`, `fundsignal.*` (×12) and
    `scoring.signal_decay_half_life_hours`, and `ingest` `backfill.chunk_*` / `max_concurrent_chunks`
    and `mcp_client.*`. Staging adds `marketdata` `fundamentals.history.enabled`. Each is a
    candidate for `twin-deleted` under a signed allow tuple. `--emit-heal-data --inventory
    <staging>` emits 39 staging tuples, which is all 20 twins × their environments.
  - **per-user-unread** (1): the staging per-user `analysis` `fundsignal.min_conviction_to_emit`,
    `value_type=string`. It is reported and never deleted. Its user hash is
    `73833c35…`.
  - **dead→296** (5 `seeded-unread`): `ledger` `stream.notify_enabled`, `marketdata.alpaca.paper`,
    `platform.log_level`, `trading.risk.daily_loss_limit` and
    `analysis.opportunity.sparkline_bars`. No reader exists for any of them; a grep of services
    found only a `SCALAR_BOUNDS_REGISTRY` entry for sparkline_bars.
  - **default-synced/mismatch** (5 `default-mismatch` + 8 staging `metadata-missing`):
    - `analysis.opportunity.live_enrich_ttl_seconds` (20 vs 10),
      `trading.approval.require_above_notional` (50000 vs 10000),
      `trading.approval.require_above_qty` (500 vs 100), `trading.risk.bracket_orders_enabled`
      (true vs false) and `trading.risk.max_position_pct` (0.05 vs 0.02). Each pair is code
      default vs stored `default_value`. 036 step 7 syncs `default_value` only. The served value
      stays as stored (decision 2).
    - Staging-only blank metadata: `analysis.backtest.{default_commission_pct,
      default_slippage_pct, fundamentals.enabled, max_duration_seconds}`,
      `analysis.engine.{alert_throttle_seconds, max_strategies_per_cycle}`,
      `marketdata.fmp.enabled` and `marketdata.fundamentals.history.enabled`.
  - **readers-disagree** (2):
    - `marketdata.fundamentals.provider`: analysis reads `""`, marketdata reads `finnhub`.
    - `platform.trading_state`: trading reads `HALTED` (fail-closed), the UI has no literal, and
      the stored value is `ACTIVE`. Per design § 036 step 7 it keeps `ACTIVE`. The gate still
      lists it as `default-mismatch` (baseline owner feature 295, drained at Step 36).
  - **extractor fix** (0): a scan of every literal `<ns>.<a>.<b>` string in service code outside
    tests found no unextracted config read; every hit was a ledger event type. So there is no
    fixture case and no registry change. `config-wiring.json`, `check-config-wiring.mjs`,
    `config-wiring-py-reads.py` and `config-wiring.test.mjs` are untouched.
  - **retype / signoff-type / out-of-bounds / secret-class / code-default change** (0 at freeze).
    These are decided by 036's dry-run (Steps 34/35) from inventory hashes. A2 made no
    code-default change.
  - **Outside the taxonomy, recorded as a defect (1):** `trading.broker.paper`, whose default is
    `TRADING_MODE == "paper"` (`trading.go:2685`, `:3669`). It goes to
    `docs/reports/2026-11-06-trading-broker-paper-env-derived-default-unseedable-defect.md`
    (status `open`). Its catalog `code_default` is empty.
- **Catalog:** `scripts/config-heal/catalog.tsv` has 195 rows in the Step 4 column order (see the
  Deviation Log). The rendered table is appended under `## Config Key Contract`.
- **Fresh residuals proof (instruction 3; static, see the Deviation Log):**
  - Over `config-wiring-stored.json` (194 fresh rows) with the frozen catalog:
    - 38 twin rows (19 keys × 2 environments) are all global and non-secret, and their partner is
      an exact catalog key. `emitHealData` therefore emits an allow tuple for each one from the
      fresh inventory.
    - **`twin-kept-unsigned` = 0** and **`twin-secret-class` = 0**.
    - `unread-no-partner` = the 9 rows of the 5 dead→296 keys.
  - Every readers-disagree key is seeded fresh in both environments (M-2):
    `marketdata.fundamentals.provider` and `platform.trading_state`. No `form-mismatch`/feature
    296 exception is needed.
  - Step 34's real `--fresh` dry-run must confirm this.
- **Keys that can return FAILED_PRECONDITION after Step 8 (Open Risk 5, for the PR body):**
  - **Certain (per-user twin, never deleted):** `analysis` `fundsignal.min_conviction_to_emit` at
    the staging per-user scope `73833c35…`, once 036 seeds the global
    `analysis.fundsignal.min_conviction_to_emit`.
  - **Conditional (staging, only if the operator does not sign the tuple at G2):**
    - `analysis` `backtest.max_duration_seconds`, plus `fundsignal.{buy_quantile, daily_call_budget,
      enabled, explicit_symbols, max_symbols_per_run, min_conviction_to_emit, run_interval_hours,
      scoring_formula_id, sell_quantile, source_slug, universe_source, valid_days}` and
      `scoring.signal_decay_half_life_hours`;
    - `ingest` `backfill.{chunk_max_bars, chunk_window_days, max_concurrent_chunks}` and
      `mcp_client.{poll_interval_seconds, request_timeout_seconds}`;
    - `marketdata` `fundamentals.history.enabled`.
  - **Fresh / production:** none, by the proof above.
- **Open item for Step 33 (041 seed):** the seed must skip `trading.broker.paper`, or any catalog row
  whose `code_default` is empty for a non-string type, rather than write a value. The defect report
  holds the question.
- **TDD:** N/A. No extractor fix was needed, so this step has catalog rows only (Step 6 TDD rule).
- **Verification:**
  - `node --test scripts/config-wiring.test.mjs` → 47/47 pass;
  - `awk -F'\t' 'NR>1 && $6==""' scripts/config-heal/catalog.tsv | wc -l` → 0;
  - `node scripts/check-config-wiring.mjs` → exit 0;
  - `--final` also exits 0, with the same two REPORTED lines as at Step 4.
- Files modified: `scripts/config-heal/catalog.tsv` (new), implementation-spec.md (Step 6 → done,
  the generated contract table, Deviation Log), feature.md, context.md. The defect report and its
  `.status` sidecar went in a separate earlier commit (`e48c356b`).

## Session 2026-11-06 — sdd-execute sequential (sdd-batch-execute): Step 7

- **Tooling:** the main worktree has no `node_modules`, so there was nothing to symlink. I ran
  `pnpm install --frozen-lockfile --filter xstockstrat-config...` (pnpm 9.15.9, Node 24) in this
  worktree. Its `prepare` step installed husky, so the pre-commit hook ran.

### Step 7 — test: form-tolerant SetConfig, canonical grants/bounds, error mapping [done]
- Created `src/__tests__/setConfigSpelling.test.ts`. It runs 15 cases over the real loopback gRPC
  harness (`setConfigScalarBounds.test.ts` pattern). The in-memory pool:
  - evaluates `key = $n` and `key IN ($n, $m)` probes at the exact (`COALESCE(user_id,'')`) and
    global (`user_id IS NULL`) scopes, and honours `LIMIT`;
  - applies the upsert by its own column list;
  - can be made to reject the upsert with a pg error code.

  Row literals are inline (C-13).
- **Contract this suite fixes for Step 8:**
  - the found row's `key` decides the upsert spelling (`params[1]`);
  - the ambiguity error is code 9 and names both spellings;
  - pg codes `23514` and `23505` map to code 3, and any other upsert error stays 13;
  - the three AC-31 bounds hold under both key spellings;
  - the fake returns whole rows (`key`, `is_secret`) for any `SELECT … FROM config.config_values`.
- **TDD:**
  - **RED** (`node --test dist/__tests__/setConfigSpelling.test.js`): tests 15, pass 2, fail 13.
    - AC-1 returns NOT_FOUND (5) on the bare spelling.
    - The AC-25 grant returns `7 PERMISSION_DENIED: admin scope required`.
    - AC-31 has none of the three bounds registered.
    - Both AC-34 cases write instead of returning 9.
    - AC-35 `23514`/`23505` return code 13.
  - Two cases are already green. They are preserve legs that hold today: the AC-25
    `opportunity.max_universe_size` `[1, 1000]` bound, and AC-35 "any other error stays 13".
  - Full `pnpm run test`: tests 309, pass 296, fail 13. The 13 failures are exactly the new red cases.
  - **GREEN** is due at Step 8. A throwaway sketch of Step 8 instructions 1–5 made all 15 cases pass,
    so the suite holds no contradictory assertions. The sketch was reverted with `git checkout` and
    never staged.
- `pnpm run lint` reports 0 errors. `prettier --check` is clean on the new file.
- **Open items for Step 8.** These are pre-existing tests outside Step 8's **Files** (`authz.ts`,
  `configServiceImpl.ts`) that the sketch broke. Raise them as a blocker at Step 8 unless the
  implementation avoids them.
  1. `internalCallerAuthz.test.ts` "no longer authorizes the pre-189 bare `trading_state` key
     (feature 189 rename)" asserts the opposite of AC-25 and Step 8 instruction 1. It must be
     rewritten.
  2. Eight more suites failed under the sketch. Their fake pools return rows only for the literal
     substring `SELECT is_secret FROM config.config_values`, so a probe that selects `key, is_secret`
     gets no rows and returns NOT_FOUND. The suites are:
     - `configServiceImpl` (unary DB failures);
     - `configValueRoundtrip`;
     - `internalCallerSetConfig`;
     - `scopeResolution`;
     - `secretsAndScope`;
     - `setConfigAuthz`;
     - `setConfigScalarBounds`;
     - `tradingStateValidation`.

     A probe that must return `key` cannot keep that literal. Step 8 most likely needs to update
     those fakes, which is a scope expansion.
- Files modified: `services/xstockstrat-config/src/__tests__/setConfigSpelling.test.ts`
- Deviations: none

## Session 2026-11-06 — sdd-execute sequential (sdd-batch-execute): Step 8

- **Tooling:** the main worktree has no `node_modules`. I ran
  `pnpm install --frozen-lockfile --filter xstockstrat-config...` (pnpm 9.15.9, Node 24) in this
  worktree. Husky was installed, so the pre-commit hook ran. No manifest changed.
- **Blocker and operator decision:** the Step 7 open items held. The operator chose **Option A**
  (2026-11-06): fold the test fixes for the nine affected config test files into Step 8, as test-only
  edits, and keep the production code exactly as specced. This is recorded in the spec's Deviation
  Log as an operator-approved out-of-scope change.

### Step 8 — service: form-tolerant SetConfig (FR-1) [done]
- `authz.ts`:
  - New exports `canonical(ns, key)` (strips a leading `${ns}.`) and `altSpelling(ns, key)`.
  - The internal-caller grant now matches `canonical` on both sides.
- `configServiceImpl.ts`:
  - The `trading_state` guard compares `canonical(...) === 'trading_state'`.
  - `lookupScalarBounds` makes a single probe, `REGISTRY[`${ns}.${canonical}`]`. The registry
    literals stay full-dotted. Three bounds were appended after 282's tail entry:
    - `indicators.sandbox.timeout_ms` [100, 33000]
    - `indicators.sandbox.startup_grace_ms` [1000, 10000]
    - `analysis.compute.max_worker_threads` [1, 16]
  - Spelling resolution:
    - The exact probe is `SELECT key, is_secret … key IN ($2,$3) … COALESCE($5,'')`, with no LIMIT.
    - A per-user request always runs the global probe.
    - Code 9 (`ambiguous config key spelling: <a> and <b> … (feature 296)`) is returned when there
      are two rows at one scope, or when the exact row's spelling differs from the global row's.
    - The found row's `key` is the upsert `$2` (`writeKey`). `env` and `userIdParam` come from the
      request.
  - The upsert catch maps pg `23514` and `23505` to code 3. Any other error stays 13.
  - `getConfig`, `listKeys`, `watchConfig` and `getSecret` are untouched. `listKeys` keeps calling
    `lookupScalarBounds`, which now uses the single probe.
- **Test-only edits (operator Option A):**
  - Eight fakes now match `SELECT key, is_secret FROM config.config_values`, and their rows carry
    `key: params[1]`. In `configServiceImpl.test.ts` that is the `GATE` regex plus the gate row.
  - `internalCallerAuthz.test.ts`: the bare `trading_state` case is now `@AC-25` and expects `true`.
- **TDD:**
  - **RED** (before implementing; full `pnpm run test`): tests 309, pass 296, fail 13. The 13 are
    exactly the `setConfigSpelling` cases, as Step 7 recorded.
  - After the production change alone: 62 fail across the nine named suites, as predicted. The
    `setConfigSpelling` suite is green.
  - **GREEN** (after the fake updates): tests 309, pass 309, fail 0. `setConfigSpelling` is 15/15.
- **Verification:**
  - `pnpm run test` exits 0.
  - `pnpm run lint` reports 0 errors (warnings only, as before).
  - `pnpm run test:coverage` passes, with 90.85% of lines covered.
  - `c8 check-coverage --lines 40` exits 0.
- Files modified:
  - `services/xstockstrat-config/src/grpc/authz.ts`
  - `services/xstockstrat-config/src/grpc/configServiceImpl.ts`
  - Under `services/xstockstrat-config/src/__tests__/`:
    - `configServiceImpl.test.ts`
    - `configValueRoundtrip.test.ts`
    - `internalCallerAuthz.test.ts`
    - `internalCallerSetConfig.test.ts`
    - `scopeResolution.test.ts`
    - `secretsAndScope.test.ts`
    - `setConfigAuthz.test.ts`
    - `setConfigScalarBounds.test.ts`
    - `tradingStateValidation.test.ts`
- Deviations: the operator-approved scope expansion above. The spec left three details open, and the
  Deviation Log records how each was settled: no `LIMIT` on either probe, `writeKey` in the
  `pg_notify` payload, and the per-user request always running the global probe.

## Session 2026-11-06 — sdd-execute sequential (sdd-batch-execute): Step 9 (040_config_markers)

- Gate: the 040/041 operator confirmation is answered by decision 28 (pinned 282 `038`/`039` → 295
  `040`/`041`). `origin/main-dev` still ends at `039`, so `040` is max+1.
- Created `040_config_markers.up.sql` (`CREATE TABLE IF NOT EXISTS config.config_markers`, empty, with
  a 1-line header) and `.down.sql` (`DROP TABLE IF EXISTS`). TDD: N/A (migration).
- **Verification:**
  - Both `ls` targets exist.
  - The `INSERT` grep prints nothing.
  - The collision check ran as `log --remotes` over the `04[01]_*` paths, because the sandbox
    refused the per-ref loop (Deviation Log). It printed nothing.
- No database was started. No pre-commit hook ran: there is no `node_modules` in any worktree, and
  `core.hooksPath` (`/home/user/xstockstrat/.husky/_`) is absent. `--no-verify` was not used.
- Files modified: `services/xstockstrat-config/migrations/040_config_markers.up.sql`,
  `services/xstockstrat-config/migrations/040_config_markers.down.sql`, implementation-spec.md (Step 9
  → done, Deviation Log), feature.md, context.md.

## Session 2026-11-06 — sdd-execute sequential (sdd-batch-execute): Step 10

- **Tooling:** the main worktree has no `node_modules`. I ran
  `pnpm install --frozen-lockfile --filter xstockstrat-config...` (pnpm 9.15.9, Node 24) in this
  worktree. Husky was installed, so the pre-commit hook ran. No manifest changed.

### Step 10 — test: change-feed liveness, content version, dormant alias [done]
- `changeFeedLiveness.test.ts`:
  - **@AC-21.** The fake listener acknowledges every query but never delivers a notification. Timers
    and `Date` are mocked. The test advances 45 s, then asserts five things:
    - the heartbeat ran on the listener client;
    - the dead client was released once, with an `Error`;
    - a new client re-ran `LISTEN config_changed`;
    - a DELTA carries `indicators.sandbox.timeout_ms`=15000, a value the fake DB took with no NOTIFY;
    - no `pool.query` mentioned `config_heartbeat` (F-06).
  - **Healthy-feed control.** A listener that echoes its heartbeat is never dropped over 95 s.
  - **Pool options.** `dist/index.js` runs in a child process with a `-r` preload that replaces
    `pg.Pool`. The test asserts `query_timeout`/`statement_timeout` 15000, `keepAlive` true,
    `keepAliveInitialDelayMillis` 10000 and `max` 2. Installed `pg` is 8.20.0.
- `contentVersion.test.ts`, **@AC-26** (`ledger`):
  - The version is 16 hex characters, and `GetConfig` reports the same one.
  - The 10 s re-send writes to the subscriber, and the 5-min backstop `reloadAll` runs. Neither adds a
    version.
  - Two calls, and a second instance over identical rows, return the identical version.
  - Setting `ledger.export.max_window_days` to 180 plus a NOTIFY adds exactly one version.
- `dormantAlias.test.ts`, **@AC-2**:
  - The inactive legs (the `to_regclass` probe is null, or the marker row is absent) assert that the
    snapshot keys equal the stored keys exactly.
  - The active leg asserts two things: the reload SELECT carries the `to_regclass` guard, and every
    `altSpelling` alias is added with the stored value.
  - A guard asserts that no `04*.up.sql` contains `INSERT INTO config.config_markers`.
- **TDD:**
  - **RED** (before Step 11; `node --test` on the three suites): tests 8, pass 4, fail 4. Each fails
    on its assertion, not on an import or harness error:
    - AC-21 fails on "the heartbeat ran on the listener client".
    - Pool options fail on `query_timeout` (got `undefined`, expected 15000).
    - AC-26 fails on the version format: it got `'0'`, which is `Date.now()` under the mocked clock.
    - The AC-2 active leg fails on the `to_regclass` guard.
  - The four green cases are the two AC-2 inactive legs (`@preserve`, green by design), the
    healthy-feed control, and the no-INSERT guard.
  - Full `pnpm run test`: tests 317, pass 313, fail 4. The 4 failures are exactly the new red cases.
  - **GREEN is due at Step 11.** A throwaway sketch of Step 11 instructions 1 and 3–7 made all 8 cases
    pass, so the suites hold no contradictory assertions. It was reverted with `git checkout` and
    never staged.
- `pnpm run lint` reports 0 errors (warnings only). `prettier --check` is clean on the three files.
- **Open item for Step 11.** Under the sketch, three existing tests outside Step 11's **Files** failed.
  The cause is the instruction-3 rule that a subscriber whose version is unchanged gets no broadcast:
  - In `configServiceImpl.test.ts` (feature 258), "reconnect pool.connect() rejects twice…" expects a
    reconnect re-broadcast with unchanged content.
  - In the same file, "a notification during a reconnect reloadAll…" expects the deltas `[300, 600]`,
    including the unchanged 300.
  - In `watchConfigWireZero.test.ts`, a direct `broadcastToSubscribers` call with no change expects a
    second write.

  Unless the implementation avoids it, raise this as a blocker at Step 11. The options are to update
  those tests (a scope expansion) or to exempt the reconnect resync and direct broadcasts from the skip.
- Files modified:
  - Under `services/xstockstrat-config/src/__tests__/`: `changeFeedLiveness.test.ts`,
    `contentVersion.test.ts` and `dormantAlias.test.ts`
  - implementation-spec.md (Step 10 → done, Deviation Log), feature.md, context.md
- Deviations: none. The Deviation Log records the details the spec leaves open: where the pool test
  lives, the preload approach, and the fake contract.

## Session 2026-11-06 — sdd-execute sequential (sdd-batch-execute): Step 11

- **Tooling:** the main worktree has no `node_modules`. I ran
  `pnpm install --frozen-lockfile --filter xstockstrat-config...` (pnpm 9.15.9, Node 24) in this
  worktree. Husky was installed, so the pre-commit hook ran. No manifest changed.

### Operator decisions (explicit sign-off, 2026-11-06, continued)

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

### Step 11 — service: LISTEN heartbeat, watchdog, content version, re-send, backstop, dormant alias [done]
- `configServiceImpl.ts`:
  - **Heartbeat.** `connectListener` also runs `LISTEN config_heartbeat` and resets `lastBeatAt`.
    - An unref'd 10 s `livenessTick` (body in try/catch) sends
      `SELECT pg_notify('config_heartbeat',$1)` on the listener client when no beat is in flight.
    - `onNotification` routes on `msg.channel`. A token with this instance's prefix sets `lastBeatAt`.
    - When `now - lastBeatAt > 30000`, it calls `dropListener(c, 'change feed heartbeat missed')`,
      which leads to the reconnect and `resyncAll`.
  - **Watchdog.** `serial()` records `headStartedAt` and counts queued work. A head older than 30 s
    logs one ERROR `config serial chain stalled` and suspends re-sends until the queue drains.
  - **Content version.**
    - The three overlay SELECTs add `updated_at` and `marker_active`.
    - `contentVersion` is the first 16 hex characters of sha256 over the sorted (key, typed value,
      isSecret) plus the secret rows' `updated_at`.
    - It replaces `Date.now()` in `reloadAll` and `reloadNamespace` (through `buildGlobalSnapshot`).
      It is also computed in `snapshotForSubscriber` and `getConfig` (through `resolveOverlayValues`).
    - Each subscriber keeps `lastVersion` and `lastPayload`.
  - **Re-send.** Every 10 s, each non-pending, non-backpressured subscriber's `lastPayload` is
    re-written as a DELTA with no DB access. Each run is logged at DEBUG.
  - **Backstop.** Every 5 min, `reloadAll` runs on `serial()`. An (ns, env) is re-broadcast (with
    the skip) only when its global version changed or it has a per-user subscriber.
  - **Dormant alias.** `MARKER_ACTIVE_SQL` uses the `to_regclass` guard. `withLegacyAliases` runs
    after the overlay, only when the marker is active. A `{"marker":…}` payload enqueues `resyncAll`
    on `serial()`.
- `index.ts`: the Pool options are `query_timeout: 15000, statement_timeout: 15000, keepAlive: true,
  keepAliveInitialDelayMillis: 10000`. `max` is unchanged (F-06).
- **Instruction 9 (Open Risk 12):** the installed `pg` is **8.20.0**. Each option is read where the
  library consumes it:
  - `connection-parameters.js:109` reads `statement_timeout`, and `:112` reads `query_timeout`;
  - `:120-127` reads `keepAlive` and `keepAliveInitialDelayMillis`;
  - `client.js:81-82` passes `keepAlive` and `keepAliveInitialDelayMillis` to the socket;
  - `client.js:525-526` sends `statement_timeout` as a startup parameter;
  - `client.js:613`/`:623` applies `query_timeout` as the read timeout.

  All four are valid Pool/Client options in this version.
- **Test added (operator decision 32):** one case in `contentVersion.test.ts`, outside **Files**.
- **TDD:**
  - **RED** (before implementing; full `pnpm run test`): tests 317, pass 313, fail 4. The 4 failures
    are exactly Step 10's red cases: AC-21, the pool options, AC-26 and the AC-2 active leg.
  - The added skip-semantics case was then RED on its own: "an unchanged NOTIFY broadcast is
    skipped" got 2 writes, expected 1.
  - **GREEN:** tests 318, pass 318, fail 0. The feature-258 suites and `watchConfigWireZero` pass
    unmodified.
- **Verification:**
  - `pnpm run test` exits 0.
  - `pnpm run lint` reports 0 errors (270 warnings, all pre-existing `no-explicit-any` style).
  - `pnpm run test:coverage` passes, with 90.92% of lines covered.
  - `c8 check-coverage --lines 40` exits 0.
  - The `pool.query(.*config_heartbeat` grep prints nothing.
- No container or database was started.
- **Open item (doc drift, for the Step 38 teardown):** `services/xstockstrat-config/CLAUDE.md`
  invariant #4, the WatchConfig flow and "Known limitations (feature 258)" do not yet describe this
  step's behavior. That covers:
  - the heartbeat, watchdog, re-send and backstop;
  - the content version;
  - the bounded pool waits. These change the "pg-pool's `connect()` wait is unbounded" limitation:
    `query_timeout` bounds query reads, but not the `connect()` wait.

  Those lines are outside Step 11's **Files**.
- Files modified:
  - `services/xstockstrat-config/src/grpc/configServiceImpl.ts`
  - `services/xstockstrat-config/src/index.ts`
  - `services/xstockstrat-config/src/__tests__/contentVersion.test.ts` (operator-ordered test)
  - implementation-spec.md:
    - Step 11 → done, with instruction 8 marked moved;
    - Step 13 gains instruction 6 (the spike);
    - Deviation Log.
  - feature.md, context.md
- Deviations: the operator-approved instruction-3 skip scope (Option B), the added test, and the
  moved instruction 8. The Deviation Log records these and the details the spec leaves open.

## Session 2026-11-06 — sdd-execute sequential (sdd-batch-execute): Step 12

- **Tooling:** Go 1.27.0 and golangci-lint were already installed, so nothing new was installed.
  `node_modules` is symlinked from the main worktree, so the husky pre-commit hook runs. No manifest
  changed.

### Step 12 — test: Go watcher core (trading, portfolio, marketdata) [done]
- **Trading** (`services/xstockstrat-trading/internal/config/config_test.go`):
  - New fakes:
    - `fakeClock` (`Now`, `Sleep`, `NewTimer`, `Advance`, and `parkAt` to stop the AC-11 loop);
    - `stallClient`, whose streams are scripted per namespace and per open, block `Recv` until ctx
      is cancelled, can gate an open, and can end in EOF;
    - `logCapture`, an slog handler.
  - **@AC-10.** The stream delivers a SNAPSHOT and then stalls.
    - 29 s of fake time pass with no cancel and no redial.
    - At 30 s, the first stream's ctx is cancelled and a second open happens.
    - While that open is gated, `trading.broker.timeout_ms` still reads 7000.
    - After the open is released, it reads 9000.
  - **@AC-11.** Every stream ends with EOF after its snapshot.
    - In 10 s of fake time there are 2 to 5 opens.
    - Every backoff `Sleep` is greater than 0, and the delays never decrease.
  - **@AC-12.** The 4-row table for `trading.broker.timeout_ms` with default 5000. Rows that should
    WARN must log a WARN naming the FQN. The int→float row must log no WARN at all.
  - **Instruction 6.** An `ApplyUpdate` of a platform SNAPSHOT keeps the trading key's 7000 and
    applies `REDUCE_ONLY`.
  - **Instruction 7.** There is one `config.read_coverage ns=trading` line at the first snapshot.
    Two reads produce one `config.read_key ns=trading key=trading.broker.timeout_ms`. After the 6 h
    tick there are 2 coverage lines and 2 `read_key` lines.
- **Portfolio**, **@AC-27.** `portfolio.risk.max_drawdown_pct` is stored as int 7. Read with the
  float getter and default 1.5, it returns 7.0 with no WARN. `newTestWatcher` now runs through
  `newWatcher` on an idle client plus `ApplyUpdate`, and the existing getter tests are unchanged.
- **Marketdata.** `newTestWatcher` now calls `NewSnapshotWatcher`. `TestWatcher_GetFloat` gains an
  int-stored row that must widen to 7.0. The cancelled-ctx case now uses a zero-value `&Watcher{}`.
- The Deviation Log records two things:
  - the API contract Step 13 must implement (`Clock`, `Timer`, `Option`, `WithClock`, `WithLogger`,
    the per-service `newWatcher`, `ApplyUpdate`, and the log record shapes);
  - the trading test rewrites and removals.
- **TDD:**
  - **RED** (Verification, `GOWORK=off go test ./internal/config/... -count=1`; portfolio and
    marketdata were run the same way). All three packages fail to build because the core API is
    missing, not because of a typo:
    - trading: `undefined: Timer`, `newWatcher`, `WithClock`, `WithLogger`, and
      `w.ApplyUpdate undefined`;
    - portfolio: `undefined: Option`, `newWatcher`, `WithLogger`;
    - marketdata: `undefined: NewSnapshotWatcher`.

    Before the edits, all three packages passed (baseline `ok`). `go build ./...` for trading still
    passes.
  - **GREEN is due at Step 13.** I wrote a throwaway sketch of Step 13 instructions 1–2: one
    `watchcore.go` copied into all three services, plus delegating `config.go` changes.
    - Under it, every case passed with `-race`: trading 5 times, portfolio and marketdata 3 times
      each.
    - `go vet` was clean, and golangci-lint found nothing in the test files.
    - Three mutations failed the matching tests:
      - liveness timer ×100 failed AC-10;
      - a backoff that always resets failed AC-11;
      - no int→float widening failed AC-12.
    - The sketch was reverted (`rm watchcore.go`, `git checkout` on the three `config.go`) and never
      staged.
- **Open items for Step 13:**
  - The tests that stayed unchanged depend on three behaviours:
    - trading's `&Watcher{client: fake}`;
    - marketdata's `&Watcher{namespace, client, environment}`;
    - a zero-value `Watcher` that returns defaults and honours ctx in `WaitForSnapshot`.

    `internal/service` and `cmd/server` tests already rely on the zero-value behaviour.
  - Trading's `NewSnapshotWatcher` must still resolve full-dotted keys from mixed namespaces, which
    `internal/service` tests depend on.
  - Until Step 13 lands, these three `internal/config` test packages do not build on the feature
    branch.
- Files modified:
  - `services/xstockstrat-trading/internal/config/config_test.go`
  - `services/xstockstrat-portfolio/internal/config/config_test.go`
  - `services/xstockstrat-marketdata/internal/config/config_test.go`
  - implementation-spec.md (Step 12 → done, Deviation Log), feature.md, context.md
- Deviations: none against the step's assertions. The Deviation Log records the details the spec
  leaves open: the option names and API, where each test lives, and the rewrites of existing tests.

## Session 2026-11-06 — sdd-execute sequential (sdd-batch-execute): Step 13

- **Tooling:**
  - Go 1.27.0 and golangci-lint 2.14.0 were already installed.
  - The main worktree has no `node_modules`, so the symlink would dangle. I ran
    `pnpm install --frozen-lockfile --ignore-scripts --filter xstockstrat --filter "xstockstrat-config..."`
    (pnpm 9.15.9) in this worktree instead. It covers the root hook tooling and the config server
    for the spike.
  - No manifest or lockfile changed.
- **Hook:** git's `core.hooksPath` points at `/home/user/xstockstrat/.husky/_`, which does not
  exist, so git cannot invoke the husky hook. I ran `.husky/pre-commit` by hand on the staged files
  before committing. `--no-verify` was never used.

### Step 13 — service: Go watcher core (byte-identical `watchcore.go` ×3) + copy guard [done]
- **`watchcore.go`**, byte-identical in trading, portfolio and marketdata `internal/config/`.
  Every constant carries an F-07 fixed-invariant comment. It contains:
  - the `watchKeepalive` dial option (30 s / 10 s, PermitWithoutStream);
  - a per-stream `context.WithCancel`, cancelled by a 30 s liveness timer that each message resets;
  - equal-jitter backoff `[base/2, base]`. The base doubles from 1 s to 30 s and resets only after
    ≥15 s of healthy delivery. The backoff also applies after a clean EOF;
  - one value map per namespace;
  - the FR-11 typed getters. int→float widens. Any other mismatch, or an absent key, returns the
    default with a rate-limited WARN naming the FQN;
  - `OnChange(func(ns, version string))` and `ApplyUpdate`;
  - the read-key evidence. `config.read_key` is logged once per key. `config.read_coverage` is
    logged at the first snapshot and on the 21600 s tick, which also re-emits every read key.
- **`config.go` ×3:** each embeds the core and keeps its signatures: `NewWatcher`,
  `WaitForSnapshot`, `Get*`, `SetConfig`, `ResolveSecret`, `FactorMap` and `NewSnapshotWatcher`.
  - Each service gains the unexported `newWatcher` that Step 12 fixed.
  - Trading loses the prefix-delete and its untyped getters.
  - Marketdata gains `NewSnapshotWatcher`.
- **Copy guard:** `scripts/check-watcher-copies.sh` (bash 3.2) compares `shasum -a 256` hashes
  within group `go`.
  - A drift fixture in the scratchpad made it exit 1, naming the differing file. The real tree
    exits 0.
  - It runs in the CI `config-wiring` job. The script and the three copies are added to that job's
    filter.
- **Exemptions:** a `docs/patterns/dry-guard-rail.md` entry and three `.jscpd.json` ignore paths.
- **Registry:** two `loki-literal` rows, `config.read_key` and `config.read_coverage`, in
  `produced-signals.tsv`. Their producer-path is a comma list of the three cores.
  - Open Risk 12: the checker's registry loop splits producer paths on `,` and accepts the literal
    if any one path holds it.
  - `check-otel-produced-signals.sh` exits 0.
- **TDD (the Step 12 pair):**
  - **RED** before implementing: `GOWORK=off go test ./internal/config/... -count=1` failed to
    build in all three packages:
    - trading: `undefined: Timer`, `newWatcher`, `WithClock`, `WithLogger`, and
      `w.ApplyUpdate undefined`;
    - portfolio: `undefined: Option`, `newWatcher`, `WithLogger`;
    - marketdata: `undefined: NewSnapshotWatcher`.
  - **GREEN:** all three `internal/config` packages are `ok` with `-race`. Trading was run 10 times
    in a row. AC-10, AC-11, AC-12, AC-27, the per-namespace maps and the read-key evidence all
    pass.
- **Verification:**
  - golangci-lint reports 0 issues in each service.
  - `go test ./... -race` is `ok` in every package.
  - Coverage is trading 82.0%, portfolio 79.8% and marketdata 79.9%, each ≥ 40%.
  - `check-watcher-copies.sh` exits 0, and so does `check-otel-produced-signals.sh`.
- **Keepalive spike (instruction 6, decision 29):** no `too_many_pings`, so `index.ts` is
  unchanged.
  - The disposable container was removed with `docker rm -f`, and `dockerd` was stopped.
  - The full run and teardown are in the Deviation Log.
- **Behaviour change (intended, FR-11):** on a type mismatch, trading's getters used to return the
  proto zero value. They now return the code default and WARN, and int→float now widens. All
  trading `internal/service` tests pass unchanged.
- **Open item (doc drift, for the Step 38 teardown):** these docs are outside Step 13's **Files**,
  and none of them yet describes the core:
  - `services/xstockstrat-trading/CLAUDE.md` § Config Keys Consumed, which still says the
    namespaces are "merged";
  - the portfolio and marketdata `CLAUDE.md` config sections.

  The missing behaviour: the per-namespace maps, liveness, backoff, the FR-11 getters and the
  read-key evidence.
- Files modified:
  - `services/xstockstrat-{trading,portfolio,marketdata}/internal/config/watchcore.go` (new)
  - `services/xstockstrat-{trading,portfolio,marketdata}/internal/config/config.go`
  - `scripts/check-watcher-copies.sh` (new)
  - `.github/workflows/ci.yml`, `.jscpd.json`, `docs/patterns/dry-guard-rail.md`,
    `packages/otel/produced-signals.tsv`
  - implementation-spec.md (Step 13 → done, Deviation Log), feature.md, context.md
- Deviations: none against the step's assertions. The Deviation Log records the spike and the
  details the spec leaves open:
  - the core's shape;
  - how healthy time is measured;
  - the WARN rate limit and FQN form;
  - how `NewSnapshotWatcher` seeds its map.

## Session 2026-11-06 — sdd-execute sequential (sdd-batch-execute): main-dev merge + re-spec

- **Up-front confirmation:** the operator approved the up-front plan for this run. `status.md` was
  already `in-progress`, so it is unchanged.
- **Branch setup:** `git merge --no-edit origin/main-dev` into the detached checkout. The merge had
  no conflicts. `scripts/ledger-guard.py --own-slug fix-config-keys-drift --base origin/main-dev --fix`
  reported clean, so no repair was needed.
- **Re-spec (Steps 18, 19, 20, 21, 27, 28, 29, 33).** Only line anchors in Codebase Evidence and
  Instructions moved. Symbols, files and instructions are unchanged. Each anchor was re-grepped.
  - analysis `servicer.py`: semaphores `:553/:558/:564/:598`, executor `:571-572`, executor call sites
    `:1798/:2310/:2481`, screener kwarg `:3876`. Step 19 now replaces `:571-574`.
  - Step 19 also notes `tests/test_config_zero_clamps.py:144`. It asserts the screener's own `_sem`
    (`screener.py:86`), which is not one of the four converted semaphores. It is expected to stay
    unchanged and must be confirmed at execution.
  - marketdata `marketdata_service.go`: `fundProvider` field `:79`, set `:231`, and 11 read sites
    `:1740 … :2099`. `ResolveSecret` is at `config.go:114-127`, with `x-internal-caller` at `:115-117`.
    The trading `uuid.NewString()` trace-id precedent is at trading `config.go:132`. Step 20's harness
    note now records that Step 13 added marketdata's `NewSnapshotWatcher` (`config.go:131`).
  - `ci.yml` `config-wiring` job `:1015-1033`, with `--final` at `:1033`.
  - agent: `client.py` `get_config_value` `:1871`, `execute_formula` `:1108`, timeout `:1138`;
    `tools.py` `_agent_policy` `:2632-2645`, used at `:1729` and `:2659-2662`.
  - config: the `onNotification` handler is at `configServiceImpl.ts:382` (moved by Step 11) and
    parses namespace/environment at `:400-403`. `041` is still absent; the highest migration is 040.
- **Hook note:** `core.hooksPath` points at `/home/user/xstockstrat/.husky/_`, and the main worktree
  has no `node_modules` to symlink, so the pre-commit hook could not run here. These commits are
  docs-only. No commit used `--no-verify`.
- Files modified: implementation-spec.md, feature.md, context.md.

## Session 2026-11-06 — sdd-execute sequential (sdd-batch-execute): Step 14

- **Tooling:** uv 0.11.32 was already installed. I ran `uv sync --extra dev --frozen` in indicators,
  ingest and analysis. No manifest or lockfile changed. `node_modules` is symlinked from the main
  worktree for the husky hook.
- **Discovery note:** the discovery digest reported `watch_core.py` as already present. That was
  wrong for this checkout: it read another worktree's uncommitted sketch. On
  `origin/feature/fix-config-keys-drift` (`f3040b92`) no `watch_core.py` exists, `_watch` is the
  fixed-2 s loop, and none of the Step 14 tests existed. The step therefore ran as specified.

### Step 14 — test: Python watcher core (indicators, ingest, analysis) [done]
- **Fakes**, inline in each test file (C-13; `tests/**` is jscpd-ignored):
  - `_FakeClock`, a virtual clock with `monotonic`, `sleep`, `wait_for` and `advance`. Timers fire
    only when `advance` reaches them. It is injected as `ConfigWatcher._clock` through
    `monkeypatch`;
  - `_FakeCall`, a `WatchConfig` call that yields its snapshots and then stalls, ends with EOF or
    raises. It records `cancel()`;
  - `_ScriptedStub`, with scripted calls per open and a 2000-open runaway cap;
  - `_dial_free`, which patches `grpc.aio.secure_channel`, `app.mtls.channel_credentials` and
    `ConfigServiceStub`, then builds a real `ConfigWatcher`.
- **@AC-10 (indicators).** The stream delivers 7000 and then stalls. At 29 s there is no cancel and
  no redial. At 30 s the call is cancelled, and the key still reads 7000 during the backoff. After
  the redial it reads 9000.
- **@AC-11 (analysis).** Every stream ends with EOF after its snapshot. In 10 s there are 2 to 5
  opens, and every backoff sleep is greater than 0 and non-decreasing.
- **@AC-27 (analysis).** `analysis.opportunity.signal_rank_weight` is stored as int 7. Read with
  `get_float(..., 1.5)`, it returns the float 7.0 with no WARN.
- **Item 4 (ingest).** A float read through `get_int`, and an absent key, each return the default 3
  and log a WARN naming `ingest.backfill.max_retry_attempts`.
- **Item 5 (indicators).** Two reads give one `config.read_key ns=indicators key=…` line. The
  21600 s tick adds one `config.read_coverage ns=indicators` line and re-emits the key.
- **Item 6 (all three).** The `secure_channel` options carry `grpc.keepalive_time_ms=30000`,
  `grpc.keepalive_timeout_ms=10000`, `grpc.keepalive_permit_without_calls=1`, and the
  `xstockstrat-config` target override.
- **AC-5 rewrite (all three).** The feature-259 reconnect test now expects the first equal-jitter
  backoff (0.5–1.0 s) instead of a fixed `asyncio.sleep(2)`.
- **TDD:**
  - **RED** (Verification, `uv run pytest tests/test_config_watcher.py -q` per service). Each fails
    on the missing behaviour, not on an import error:
    - indicators: 4 failed, 24 passed. AC-5 `assert 1 == 2` (no reconnect on the clock); keepalive
      `grpc.keepalive_time_ms` absent; AC-10 `stub.calls[0].cancelled` is False at 30 s; read-key
      `assert 0 == 1`.
    - ingest: 4 failed, 22 passed. AC-5; keepalive; both FR-11 rows log no WARN.
    - analysis: 4 failed, 8 passed. AC-5; keepalive; AC-11 `assert 50 <= 5`; AC-27
      `assert 1.5 == 7.0`.

    Before the edits all three files passed (25, 23 and 9 tests).
  - **GREEN is due at Step 15.** I wrote a throwaway sketch of Step 15: one `watch_core.py`
    copied into each service, plus a `ConfigWatcher(WatchCore)` delegation.
    - Under it every case passed, 3 runs per service. The full suites also passed: indicators 467,
      ingest 387, analysis 1590.
    - Three mutations failed the matching tests:
      - liveness 30 → 3000 s failed AC-10;
      - a backoff that always resets failed AC-11;
      - no int→float widening failed AC-27.
    - The sketch was reverted (`rm` the three `watch_core.py`, `git checkout` the three
      `watcher.py`) and never staged.
- **Lint:** `ruff check` and `ruff format --check` are clean on the three test files. ruff removed
  analysis's unused `pytest` import.
- **Open items for Step 15:**
  - Implement the seam recorded in the Deviation Log: the `_clock` attribute, `__anext__` under
    `wait_for`, `call.cancel()`, module-attribute dialing, and the log-line shapes.
  - The unchanged `test_watch_task_retained_and_exit_logged` patches `watcher_mod.mtls`, so
    `watcher.py` must keep `from app import mtls`. It also patches `ConfigWatcher._watch`, so the
    watch loop must be looked up on the instance.
  - Until Step 15 lands, these three test files are red on the feature branch.
- Files modified:
  - `services/xstockstrat-{indicators,ingest,analysis}/tests/test_config_watcher.py`
  - implementation-spec.md (Step 14 → done, Deviation Log), feature.md, context.md
- Deviations: none against the step's assertions. The Deviation Log records the test seam and
  where each item lives. Step 15 inherits both.

## Session 2026-11-06 — sdd-execute sequential (sdd-batch-execute): Step 15

- **Tooling:** uv was already installed; `uv sync --extra dev --frozen` in indicators, ingest and
  analysis. No manifest or lockfile changed.
- **Discovery note:** the discovery digest again described another worktree's uncommitted sketch
  (`watch_core.py` present, `on_change` missing). On `origin/feature/fix-config-keys-drift`
  (`cc064f0c`) no `watch_core.py` existed, so the core was written from the Step 13 Go core and the
  Step 14 seam contract (Deviation Log).
- **Hook:** `core.hooksPath` points at `/home/user/xstockstrat/.husky/_`, which does not exist, and
  the main worktree has no `node_modules` to symlink, so the husky hook cannot run here. No commit
  used `--no-verify`.

### Step 15 — service: Python watcher core (byte-identical `watch_core.py` ×3) [done]
- **`watch_core.py`**, byte-identical in indicators, ingest and analysis `app/config/` (sha256
  `331b247f…`). Every constant carries an F-07 fixed-invariant comment. `WatchCore` holds:
  - `KEEPALIVE_OPTIONS` (30000 / 10000 / permit-without-calls 1);
  - the stream loop: `clock.wait_for(call.__anext__(), 30)` per message, `call.cancel()` on exit,
    equal-jitter backoff `[base/2, base]` doubling 1→30 s, reset only after ≥15 s healthy (open to
    last message), applied after a clean EOF too;
  - FR-11 typed getters: int→float widens; any other mismatch, or an absent key once a snapshot has
    arrived, returns the default with a WARN naming the FQN, rate-limited per FQN and reason (300 s);
  - `on_change(callback)`, called with the version after a received snapshot changes it;
  - the read-key evidence: `config.read_key` once per key, `config.read_coverage` at the first
    snapshot and on the 21600 s tick, which re-emits every read key;
  - `wait_for_snapshot` and the task done-callback (both were identical in the three services).
- **`watcher.py` ×3** subclass the core and keep `ConfigWatcher(endpoint, namespace)`, the scope
  resolvers, `_build_watch_request`, the `get_*_present` aliases and the service helpers
  (indicators `sandbox_*`/`int_positive`; ingest `resolve_secret`/`backfill_*`/`dedup_window_hours`;
  analysis `int_positive`/`float_positive`/`str_nonempty`). The channel options are
  `mtls.target_override("xstockstrat-config") + KEEPALIVE_OPTIONS`.
- **Copy guard / registries:** group `py` in `scripts/check-watcher-copies.sh` (a scratchpad drift
  fixture made it exit 1 naming the ingest copy; the real tree exits 0); the three paths in
  `.jscpd.json` `ignore`; the `dry-guard-rail.md` entry; the `config.read_key` and
  `config.read_coverage` producer-path lists in `produced-signals.tsv`.
- **Out of Files:** `scripts/config-wiring.json` `registry.dynamic`. The move turned the 12
  `watcher.py:ConfigWatcher.get_*` definition sites into one `watch_core.py:WatchCore._lookup` site
  per service, which the extractor reported as a new `dynamic-read`. The 12 orphaned entries were
  replaced by 3 `_lookup` entries, so `check-config-wiring.mjs --final` and
  `config-wiring.test.mjs` print exactly their pre-step output (their pre-existing failures,
  config `contentVersion` dynamic-read and STALE-STORED, are unchanged and owned by later steps).
- **TDD (the Step 14 pair):**
  - **RED** before implementing (`uv run pytest tests/test_config_watcher.py -q`): indicators 4
    failed / 24 passed (AC-5, keepalive, AC-10, read-key); ingest 4 failed / 22 passed (AC-5,
    keepalive, both FR-11 rows); analysis 4 failed / 8 passed (AC-5, keepalive, AC-11, AC-27).
  - **GREEN:** indicators 28 passed, ingest 26 passed, analysis 12 passed.
  - `on_change` has no Step 14 test; a throwaway, unstaged test confirmed `v1, v1, v2` fires
    `["v1", "v2"]` and that a raising sibling hook is contained.
- **Verification:** `ruff check` and `ruff format --check` clean in all three services. Full
  suites with coverage: indicators 467 passed, 85.01% (≥ 50); ingest 387 passed, 84.37% (≥ 40);
  analysis 1590 passed, 91.03% (≥ 40). `check-watcher-copies.sh` and
  `check-otel-produced-signals.sh` exit 0.
- **Open items:**
  - `on_change` is untested in-tree; Step 18/19 (resizable limiters) are its first consumers and
    should assert it.
  - Doc drift for the Step 38 teardown: the indicators/ingest/analysis `CLAUDE.md` config sections
    do not yet describe the core (liveness, backoff, FR-11 WARNs, read-key evidence).
- Files modified:
  - `services/xstockstrat-{indicators,ingest,analysis}/app/config/watch_core.py` (new)
  - `services/xstockstrat-{indicators,ingest,analysis}/app/config/watcher.py`
  - `scripts/check-watcher-copies.sh`, `.jscpd.json`, `docs/patterns/dry-guard-rail.md`,
    `packages/otel/produced-signals.tsv`, `scripts/config-wiring.json` (out of Files)
  - implementation-spec.md (Step 15 → done, Deviation Log), feature.md, context.md
- Deviations: none against the step's assertions; the Deviation Log records the core's shape, the
  `on_change` semantics and the `config-wiring.json` registry move.

## Session 2026-11-06 — sdd-execute sequential (sdd-batch-execute): Step 16

- **Tooling:** pnpm 9.15.9 and Node 24.22.1 were already installed. I ran `pnpm install
  --frozen-lockfile` filtered to the root, ledger, identity and notify. No manifest or lockfile
  changed.
- **Baseline:** before the edits all tests passed: ledger 142, identity 139, notify 125.

### Step 16 — test: Node watcher core (ledger, identity, notify) [done]
- **Fakes**, inline in each test file (C-13; `**/__tests__/**` is jscpd-ignored):
  - `FakeConfigServiceClient` records its endpoint and channel options. Its `watchConfig()`
    returns a `FakeStream`, an EventEmitter that counts `cancel()` calls, and records the open
    time.
  - The tests replace three module exports before they import the watcher:
    `ConfigServiceClient`, `mtls.clientCredentials` (insecure credentials) and
    `logger.getLogger` (a logger that records each level and message).
  - `node:test` mock timers cover `setTimeout`, `setInterval` and `Date`. `advance()` ticks in
    small steps and flushes with the real `setImmediate`.
- **@AC-10 (ledger).** The stream delivers `ledger.export.enabled=false` and then goes silent. At
  29 s there is no cancel and no redial. At 30 s the stream is cancelled and the key still reads
  false. Within 1 s a second stream opens, and its `true` is applied.
- **@AC-11 (ledger).** Every stream ends right after its snapshot. In 10 s there are 2 to 5 opens,
  and the delays between opens never decrease. `Math.random` is not stubbed: equal jitter with a
  doubling base keeps both bounds for any draw.
- **@AC-15 (ledger).** Two `getBool` reads give one `config.read_key ns=ledger
  key=ledger.export.enabled` INFO line. After the 21600 s tick there is one `config.read_coverage
  ns=ledger` line and one re-emitted read-key line.
- **@AC-27 (notify).** `notify.fanout.min_confidence_threshold` is stored as int 7. `getFloat(…,
  1.5)` returns 7 with no WARN.
- **Item 6.** In notify, a string read through `getFloat` (read twice: one WARN, rate-limited) and
  an absent key each return the default with a WARN naming the FQN. In identity, `getInt` on a
  string, `getBool` on an int and `getString` on a bool each return the default with a WARN.
  An absent key WARNs too, and a bare key is named `identity.<key>`. A read before any snapshot
  stays silent.
- **Item 7 (all three).** The channel options carry `grpc.keepalive_time_ms=30000`,
  `grpc.keepalive_timeout_ms=10000`, `grpc.keepalive_permit_without_calls=1` and the
  `xstockstrat-config` target override.
- **TDD:**
  - **RED** (Verification, `pnpm run test` per service). Each test fails on the missing
    behaviour, not on a compile or import error:
    - ledger: 4 failed, 142 passed. AC-10 "the stalled stream is cancelled at 30 s"; AC-11 "opened
      12 streams in 10 s"; AC-15 read-key `0 !== 1`; keepalive `undefined !== 30000`.
    - identity: 3 failed, 141 passed. Both WARN cases and keepalive. The matching-type and
      pre-snapshot cases already pass.
    - notify: 4 failed, 125 passed. AC-27 `1.5 !== 7`, both WARN cases, keepalive.
  - **GREEN is due at Step 17.** I wrote a throwaway sketch of the core and copied it over the three
    `configWatcher.ts` files.
    - Under it every suite passed: ledger 146, identity 144, notify 129.
    - Two mutations failed the matching tests: liveness 30 → 3000 s failed AC-10, and a backoff
      that resets on data failed AC-11.
    - The sketch was reverted (`git checkout` of the three `configWatcher.ts`) and never staged.
- **Lint:** `eslint` is clean on the three new files (no errors, no warnings), and prettier has
  formatted them. `pnpm run lint` reports only existing warnings and no errors.
- **Open items for Step 17:**
  - Implement the seam recorded in the Deviation Log: module-property dialing, one channel-options
    object, `setTimeout`/`setInterval` with `Date.now()`, `getLogger` at module load, and the
    log-line shapes.
  - Until Step 17 lands, these three test files are red on the feature branch.
- Files modified:
  - `services/xstockstrat-{ledger,identity,notify}/src/__tests__/configWatcher.test.ts` (new)
  - implementation-spec.md (Step 16 → done, Deviation Log), feature.md, context.md
- Deviations: none against the step's assertions. The Deviation Log records the test seam and
  where each item lives. Step 17 inherits both.

## Session 2026-11-06 — sdd-execute sequential (sdd-batch-execute): Step 17

- **Tooling:** pnpm 9.15.9 and Node 24.22.1 were already installed. I ran `pnpm install
  --frozen-lockfile` filtered to the root, `@xstockstrat/proto`, ledger, identity and notify. No
  manifest or lockfile changed.

### Step 17 — service: Node watcher core (byte-identical `configWatcher.ts` ×3) [done]
- **Per-service differences in the pre-step copies (instruction 2).** There were only two, and both
  were comments:
  - The file header: ledger and identity had a 2-line JSDoc each, worded differently; notify had a
    4-line one naming the file.
  - The comment above the `APPLICATION_ENV` lookup: ledger had 1 line; identity and notify had 2,
    and notify's cited feature 147.
  - The code was the same in all three, so no constructor option was needed. The new copy has one
    header and keeps ledger's environment comment.
- **Core.** The constants are `KEEPALIVE_OPTIONS`, `LIVENESS_DEADLINE_MS` (30 s),
  `RECONNECT_BASE_MS`/`RECONNECT_MAX_MS` (1 s / 30 s), `BACKOFF_RESET_AFTER_MS` (15 s),
  `READ_COVERAGE_INTERVAL_MS` (21600 s) and `WARN_INTERVAL_MS` (5 min). Each carries a fixed-invariant
  (F-07) comment.
  - Liveness: a `setTimeout` re-armed on each message. On expiry it calls `scheduleReconnect`, which
    cancels the call.
  - Backoff: equal jitter `[ceiling/2, ceiling]`. The attempt counter resets only when the stream
    delivered for at least 15 s (open to last message). Nothing resets it on data.
  - Getters go through `lookup`. It logs `config.read_key` once per key and WARNs on an absent key
    only after a snapshot has arrived. `getFloat` widens an int.
  - The public API is unchanged: the constructor, `waitForSnapshot`, `update`, `get*` and
    `getSnapshot`. The three `index.ts` callers are untouched.
- **TDD:**
  - **RED** (`pnpm run test`, before the edit) matched Step 16. Ledger had 4 of 146 failing (AC-10,
    AC-11, AC-15, keepalive). Identity had 3 of 144 failing (two WARN cases, keepalive). Notify had
    4 of 129 failing (AC-27, two WARN cases, keepalive).
  - **GREEN:** ledger 146/146, identity 144/144, notify 129/129.
- **Verification:**
  - Lint: `pnpm run lint` gives 0 errors in each leaf, with existing warnings only. `eslint` on the
    new file is clean.
  - Coverage (`test:coverage`, then `c8 check-coverage --lines 40`) passes in each leaf. All files:
    ledger 83.2%, identity 80.9%, notify 83.5%. `configWatcher`: 71.4%, 73.8%, 67.5%.
  - `check-watcher-copies.sh` reports all groups byte-identical. An appended byte in notify's copy
    made it exit 1 naming group `node`, and the copy was then restored.
  - `check-otel-produced-signals.sh` exits 0 with the comma-list producer paths extended.
- **Out of Files:** `scripts/config-wiring.json` `registry.dynamic`. The Node extractor reported
  `configWatcher.ts:lookup:dynamic-read` for each leaf. As in Step 15, the 12 getter entries became 3
  `lookup` entries.
  - `check-config-wiring.mjs --final` now prints what it printed before the step.
  - `config-wiring.test.mjs` has 2 failures (baseline 1 and baseline 2), both from the existing
    config `contentVersion` dynamic-read and STALE-STORED. This step did not cause them.
- **Not done:** prettier. `prettier --check` flags the new file, but it also flagged the pre-step
  file, and `format:check` is not in this step's Verification. Neither file was reformatted.
- Files modified:
  - `services/xstockstrat-{ledger,identity,notify}/src/services/configWatcher.ts`
  - `scripts/check-watcher-copies.sh`, `.jscpd.json`, `docs/patterns/dry-guard-rail.md`,
    `packages/otel/produced-signals.tsv`
  - `scripts/config-wiring.json` (out of Files, see above)
  - implementation-spec.md (Step 17 → done, Deviation Log), feature.md, context.md

## Session 2026-11-06 — sdd-execute sequential (sdd-batch-execute): Step 18

- **Tooling:** uv 0.11.32 was already installed. I ran `uv sync --extra dev --frozen` in indicators,
  ingest and analysis, and `pnpm install --frozen-lockfile --filter .` at the root for the husky
  hook (the main worktree's `node_modules` was absent). No manifest or lockfile changed.
- **Discovery note:** the digest reported no `on_change` hook. That was stale: Step 15's
  `WatchCore.on_change(callback)` (`app/config/watch_core.py:92`, byte-identical ×3) fires each hook
  from `_apply` when a snapshot changes the version. The step therefore ran as specified.

### Step 18 — test: resizable limiters and ComputePool (indicators, ingest, analysis) [done]
- **Fakes**, inline in each test file (C-13; `tests/**` is jscpd-ignored):
  - `_flip` builds a new-version `ConfigSnapshot` and passes it to the dial-free watcher's real
    `_apply`, which fires `on_change`. The watcher comes from `tests.conftest.snapshot_watcher` plus
    an `asyncio.Event` for `_snapshot_event`.
  - Indicators `_Tracker` replaces `sandbox.execute_formula`: each call blocks on a
    `threading.Event` gate, sleeps 0.15 s and counts in-flight calls. After the flip it records
    the in-flight count as each later call starts.
- **@AC-6 (indicators).** Limit 4, 4 calls running. The limit flips to 2 and 4 more calls queue.
  Nothing new starts while 4 run; all 8 succeed; the queued calls start with exactly 2 in flight
  (exact, not an upper bound). A grow case (1 → 3) admits the two waiting calls on `on_change`.
- **@AC-23 (analysis, `test_compute_pool.py`).** `ComputePool(limit_fn=lambda: 4, threads=16)`;
  4 thread functions block on Events. `asyncio.wait_for(task, 0.05)` times one out. A fifth task
  has not started 0.2 s later, and starts once that thread's Event is set.
- **Item 3.** A grep over `app/**/*.py` for `run_in_executor(\s*self._compute_executor` (the
  screener call is split over two lines). Today it lists `app/handlers/servicer.py` and
  `app/services/screener.py`.
- **Item 4 (ingest).** `_backfill_sem` with limit 1: a second acquire waits, and is admitted when
  the limit flips to 2. With limit 3 and 2 held, a flip to 1 keeps a third acquire waiting until
  both holders release.
- **Additive (analysis `test_live_limits.py`):** `ResizableLimiter` shrink and grow-on-`wake` unit
  cases, `run_bounded` keeping the slot after a caller timeout, and a grow case for each of the four
  servicer limiters. The Deviation Log records the seam and why these were added.
- **TDD:**
  - **RED** (Verification, per service; each fails on the missing behaviour):
    - indicators: 2 failed. Shrink `assert 4 == 2` (peak); grow "condition not reached".
    - ingest: 2 failed. Grow `TimeoutError`; shrink `assert not True` (the waiter got a slot).
    - analysis `test_live_limits.py`: 7 failed. The 3 unit cases fail on `ModuleNotFoundError:
      app.config.live_limits` (the module is Step 19's to create); the 4 servicer cases time out.
    - analysis `test_compute_pool.py`: 2 failed. AC-23 on `ModuleNotFoundError:
      app.services.compute_pool`; the grep lists the two files.
  - **GREEN is due at Step 19.** I wrote a throwaway sketch: one `live_limits.py` copied into each
    service, `compute_pool.py`, and the servicer/screener wiring.
    - Under it every case passed (indicators 2, ingest 2, analysis 7 + 2), 3 runs each.
    - Two mutations failed the matching tests: a no-op `wake()` failed every grow case, and a
      `run_bounded` that releases when its caller exits failed AC-23 and the `run_bounded` case.
    - The sketch was reverted (`rm` of the four new modules, `git checkout` of the three `app/`
      trees) and never staged. Existing tests that read `._value` were not run under it; Step 19
      instruction 7 moves them.
- **Lint:** `ruff check` and `ruff format --check` are clean on the four files.
- **Open items for Step 19:**
  - Implement the seam recorded in the Deviation Log: the names, `in_use`, release on thread
    completion, and `wake` registered on `on_change` in each servicer constructor.
  - Until Step 19 lands, these four test files are red on the feature branch.
- Files modified:
  - `services/xstockstrat-{indicators,ingest,analysis}/tests/test_live_limits.py` (new)
  - `services/xstockstrat-analysis/tests/test_compute_pool.py` (new)
  - implementation-spec.md (Step 18 → done, Deviation Log), feature.md, context.md
- Deviations: none against the step's assertions. The additive cases and the test seam are in the
  Deviation Log; Step 19 inherits both.

## Session 2026-11-06 — sdd-execute sequential (sdd-batch-execute): Step 19

- **Tooling:** uv 0.11.32, pnpm 9.15.9 and Node 24.22.1 were already installed. I ran
  `uv sync --extra dev --frozen` in indicators, ingest and analysis, and
  `pnpm install --frozen-lockfile --filter .` at the root for the husky hook (the main worktree's
  `node_modules` was absent). No manifest or lockfile changed.
- **Discovery note:** the digest reported Step 15 (`on_change`) and Step 18 (the test files) as
  missing. That was stale: both are on `origin/feature/fix-config-keys-drift` (`982a5693`,
  `a1add073`), so the step ran as specified against the Step 18 seam in the Deviation Log.

### Step 19 — service: `ResizableLimiter`, `ComputePool`, RLIMIT_NPROC [done]
- **`app/config/live_limits.py`**, byte-identical in indicators, ingest and analysis:
  - `ResizableLimiter(limit_fn)` keeps a deque of waiter futures and exposes `limit`, `in_use`,
    `acquire`, `release`, `wake` and `async with`.
  - `run_bounded(lim, executor, fn)` shields the executor future. Its done-callback frees the slot
    when the thread ends.
- **indicators:**
  - `_sandbox_sem` is a limiter over `sandbox_max_concurrent`, woken by `on_change`.
  - `ExecuteFormula` runs the sandbox through `run_bounded(lim, None, …)`, on the default executor
    as `asyncio.to_thread` did.
  - It passes `max(limit, in_use)` as `max_concurrent`, so NPROC is that × 16. The `sandbox.py`
    docstring now states this contract.
- **ingest:** `_backfill_sem` is a limiter over `backfill_max_concurrent_jobs`, woken by `on_change`.
  The per-job chunk semaphore is untouched.
- **analysis:**
  - The four semaphores are limiters built by `_live_limit`, each registered on `on_change`. Every
    call site already used only `async with`, so evaluator, readiness and screener need no change.
  - `ComputePool(limit_fn=…max_worker_threads…, threads=_COMPUTE_THREADS)` replaces
    `_compute_executor`. The three simulator cores call `self._compute.run(_core)`, and the screener
    takes `compute_pool=`. The unused `ThreadPoolExecutor` import is removed.
  - The screener's own formula semaphore (`screener.py:86`) is unchanged, so
    `test_config_zero_clamps.py:144` (`engine._sem._value == 4`) stays as it was.
- **Existing tests moved:**
  - `._value` → `.limit`.
  - `_compute_executor._max_workers` → `_compute.limit`, and `_compute_executor.shutdown` →
    `_compute.shutdown`.
  - `run_in_executor(svc._compute_executor, …)` → `svc._compute.run(…)`.
  - The fake screener takes `compute_pool=None`.
  - `.locked()` → `in_use >= limit`.
  - Added `test_compute_pool_limit_follows_seeded_key_and_on_change` (instruction 7).
- **Guard:**
  - Group `py-limits` in `scripts/check-watcher-copies.sh`. In a scratchpad copy with one line
    appended to the ingest file, it exits 1 and names that copy; on the real tree it exits 0.
  - The three paths are in `.jscpd.json` `ignore`, and `dry-guard-rail.md` lists the exemption.
- **TDD (the Step 18 pair):**
  - **RED** before implementing:
    - indicators: 2 failed (AC-6 shrink and grow, "condition not reached");
    - ingest: 2 failed (grow `TimeoutError`, shrink `assert not True`);
    - analysis: `test_live_limits.py` 7 failed, `test_compute_pool.py` 2 failed (AC-23 and the grep).
  - **GREEN:** all of those pass in the full suites below.
- **Verification:**
  - `ruff check` and `ruff format --check` are clean in all three services.
  - Full suites with coverage: indicators 469 passed, 85.41% (≥ 50); ingest 389 passed, 84.23%
    (≥ 40); analysis 1601 passed, 91.13% (≥ 40).
  - The `run_in_executor(self._compute_executor` grep prints nothing, and `check-watcher-copies.sh`
    exits 0.
  - `check-config-wiring.mjs` in step-time mode prints nothing and exits 0. `--final` prints only
    the failures that were there before: config `contentVersion` dynamic-read, STALE-STORED and two
    REPORTED lines.
- **Open items:**
  - Doc drift for the Step 38 teardown:
    - the analysis `CLAUDE.md` config table still says the four limiter keys and
      `analysis.compute.max_worker_threads` are "read once in `__init__`";
    - the ingest `watcher.py:112` comment still names `Semaphore(0)`;
    - `services/xstockstrat-indicators/docs/context-constitution-findings.md:31` (semaphore fixed
      at init while NPROC is recomputed per call) is now resolved but not yet marked.
  - A configured `analysis.compute.max_worker_threads` above 16 is capped by the fixed thread
    ceiling.
- Files modified:
  - `services/xstockstrat-{indicators,ingest,analysis}/app/config/live_limits.py` (new)
  - `services/xstockstrat-analysis/app/services/compute_pool.py` (new)
  - indicators `app/handlers/servicer.py`, `app/services/sandbox.py`,
    `tests/test_execute_formula_concurrency.py`
  - ingest `app/handlers/servicer.py`, `tests/test_ingest_servicer.py`
  - analysis `app/handlers/servicer.py`, `app/services/screener.py`,
    `tests/test_config_zero_clamps.py`, `tests/test_backtest_bounds.py`,
    `tests/test_analysis_servicer.py`
  - `scripts/check-watcher-copies.sh`, `.jscpd.json`, `docs/patterns/dry-guard-rail.md`
  - implementation-spec.md (Step 19 → done, Deviation Log), feature.md, context.md
- Deviations: none against the step's assertions. The Deviation Log records five things: the
  waiter-future limiter used instead of a Condition, the shielded `run_bounded`, the literal-key
  read sites, the 16-thread ceiling and the additive test.

## Session 2026-11-06 — sdd-execute sequential (sdd-batch-execute): Step 20

- **Tooling:** Go 1.27.0 and golangci-lint 2.14.0 were already installed. For the husky hook I ran
  `pnpm install --frozen-lockfile --filter .` at the root, because the main worktree's
  `node_modules` was absent. No manifest or lockfile changed.

### Step 20 — test: marketdata live vendor clients, provider switch, secret rotation [done]
- **@AC-7, main package** (`TestFundamentalsSource_ProviderSwitchIsLive_AC7`).
  - Setup: a `NewSnapshotWatcher` with `provider=finnhub`, plus `httptest` fakes for FMP and Finnhub
    (base URLs from config). `newFMPClient` is seeded to 5, and the source comes from
    `newFundamentalsSource(w, fundamentalsProvider(w), …)`.
  - Under finnhub, only the Finnhub fake is hit.
  - After an `ApplyUpdate` DELTA to `fmp`, the FMP fake gets exactly 1 request carrying the FMP key
    and the Finnhub fake gets none. The shared budget reads 6, so the boot client served the call
    and its budget was not reset.
- **@AC-7, service** (`TestFundamentals_ProviderFollowsLiveConfig_AC7`). The service uses the real
  watcher as `fundCfg` and a provider closure.
  - Under finnhub: `FailedPrecondition` naming finnhub (the `.enabled` read).
  - After the flip: a 1 h-old row is served from cache under `marketdata.fmp.cache_ttl_hours`.
  - A stale row fetches once. The FMP budget 249/250 raises 1 quota WARNING, and no
    `finnhub` window count is taken.
- **@AC-16** (`TestLiveSecrets_RotationReachesNextFMPRequest_AC16`).
  - A fake resolver returns k1, and the first FMP request carries k1.
  - The resolver switches to k2. After an `ApplyUpdate`, the accessor reads k2 (polled, because
    the re-resolve runs off the hook), and the next request carries k2.
  - The resolver then fails for `fmp.api_key`. After another `ApplyUpdate`:
    - the sleeps are exactly `[1s 2s 4s]`, with 4 resolve attempts;
    - a WARN naming `fmp.api_key` is logged;
    - the key stays k2, and the next request carries k2;
    - no log line contains any of the three key values.
- **@AC-32 row 1** (`TestLiveClient_RateLimitFollowsSettings_AC32`). This uses `alpaca.NewLiveClient`
  over a mutable `Settings` closure. `Limit()` is 200 after the first `GetBars`; after the closure
  changes to 50, it is 50 after the next `GetBars`.
- **@AC-32 row 2** (`TestEDGARClient_UserAgentIsLive_AC32`). `newEDGARClient(w)` and
  `FetchHistorical` run against an `httptest` server, with `http.DefaultTransport` redirecting the
  fixed `www.sec.gov` ticker host to it. Every request carries `a/1`. After the DELTA, the next
  companyfacts request carries `b/2`.
- **Existing tests moved to the new signatures:**
  - the `TestNewFundamentalsSource_AlwaysNonNil` canary now passes closures;
  - the five service struct literals now use `staticProvider(…)`.
- **TDD:**
  - **RED** (Verification `GOWORK=off go test ./... -count=1`). Before the edits all 15 packages
    passed. After them, three packages fail to build because the Step 21 API is missing, not
    because of a typo:
    - `cmd/server`: `undefined: fundamentalsProvider`, `newLiveSecrets` and `newEDGARClient`, plus
      `func() string` passed where `string` is expected to `newFMPClient` and
      `newFundamentalsSource`;
    - `internal/alpaca`: `undefined: alpaca.Settings` and `alpaca.NewLiveClient`;
    - `internal/service`: `cannot use staticProvider(…) (func() string) as string` in the
      `fundProvider` literals.

    The other 12 packages still pass.
  - **GREEN is due at Step 21.** I wrote a throwaway sketch: `Settings`/`NewLiveClient`/`Limit`,
    `APIKeyFunc` on FMP and Finnhub, `UserAgentFunc` on EDGAR, the provider closure at the 11
    service sites, the main helpers and `liveSecrets`, plus the classification test literal.
    - Under it the full suite passed with `-race`, and the five new tests passed 3 times each with
      `-race`.
    - golangci-lint found nothing in the three test files.
    - Six mutations each failed the matching test:
      - no `SetLimit` failed AC-32 row 1;
      - `OnChange` not bound failed AC-16 on the k2 wait;
      - no retries failed AC-16 on the delays;
      - a static User-Agent failed AC-32 row 2;
      - a provider frozen at construction failed main AC-7;
      - a frozen service provider failed service AC-7.
    - The sketch was reverted (`git checkout` of the seven non-step files) and never staged.
- **Open items for Step 21:**
  - Implement the contract in the Deviation Log.
  - Change the `classification_service_test.go:161` literal, which is outside Step 21's Files.
    Without it the `service` test package does not build.
  - Use `slog.WarnContext` for the re-resolve WARN (sloglint), and keep the EDGAR client on the
    default `Transport`.
  - Until Step 21 lands, these three test packages do not build on the feature branch.
- Files modified:
  - `services/xstockstrat-marketdata/cmd/server/main_test.go`
  - `services/xstockstrat-marketdata/internal/alpaca/client_test.go`
  - `services/xstockstrat-marketdata/internal/service/marketdata_service_test.go`
  - implementation-spec.md (Step 20 → done, Deviation Log), feature.md, context.md
- Deviations: none against the step's assertions. The Deviation Log records the details the spec
  leaves open:
  - the API contract, including that `NewClient(ClientConfig)` is kept beside `NewLiveClient`;
  - the reading of the retry count;
  - the EDGAR transport redirect;
  - the classification-test literal that Step 21 must also change.

## Session 2026-11-06 — Step 21 re-spec (operator decision)

- Step 21 halted (blocker:21): its Verification needs two files outside **Files** (F-08).
- Operator decision: re-spec first with both files — `internal/service/classification_service_test.go`
  (`fundProvider: staticProvider("fmp")`, required to build) and `internal/alpaca/stream.go` (live
  `func() ClientConfig` re-read per reconnect so rotated Alpaca secrets and live feed/reconnect
  settings reach the WebSocket). Both added to Step 21 **Files**; recorded in the Deviation Log.

## Session 2026-11-06 — Step 21 (marketdata live closures)

- Implementation reused from the verified workflow diff (patch sha256 a7278b2a…), applied on the
  re-spec commit fda0d1ee. 10 service files, all within the revised **Files** list.
- RED: at fda0d1ee `go vet` on `cmd/server`, `internal/alpaca`, `internal/service` fails (Step 20 API
  missing). GREEN: `golangci-lint` 0 issues; `go test ./... -race` 15/15 ok; coverage total 81.7%.
- Open item: Step 18's Verification still carries the stale `# RED before Step 19` comment.

## Session 2026-11-06 — sdd-execute sequential (sdd-batch-execute): re-spec of Steps 23, 27, 36, 30, 32

- Up-front plan confirmed by the operator (sdd-batch-execute). Status was already `in-progress`, so it
  is unchanged.
- Branch setup: `git merge --no-edit origin/main-dev` → already up to date (no conflicts).
  `scripts/ledger-guard.py --own-slug fix-config-keys-drift --base origin/main-dev --fix` → clean.
- Re-spec commit a28bc51f (implementation-spec.md):
  - Step 23: `brokerCallTimeout()` (`trading.go:2494`) already reads `trading.broker.timeout_ms`, and
    `:2495` is its body, not a call site. The step now reuses it as the package function
    `brokerCallTimeout(cfgW)` for `:2020`, `:2431`, `:3201` and `order_intent.go:100` (`staleThreshold`
    is a free function), so there is one accessor for the key. `alpaca_test.go` is added to Step 23's
    **Files** because `TestNewClient_TimeoutFromConfig` (`:214-224`) uses the removed `TimeoutMs`.
    `HTTPTimeout()` is kept and returns the per-request deadline.
  - Step 27: anchors refreshed (`watcher.py:69`/`:87`, `sandbox.py:351`/`:395`, `servicer.py:283`).
    The clamp goes at the top of `_run` (`servicer.py:303`), which `run_bounded` calls once the slot is
    held. The reader is a method, like `sandbox_max_concurrent()`.
  - Step 36: the baseline has 130 entries (124 `feature 278`, 6 `feature 295`). All 6 feature-295 rows
    are Step 4 `default-mismatch` rows, and Step 27's `read-unseeded` row is not there yet (131 / 7
    once it lands). Highest config migration on `origin/main-dev` is still `039`; `042` and `043` are on
    other branches, and no ref holds a `041`.
  - Step 30: mock `getConfig` at `mock-backend.ts:1521`. Step 32: pass 3 is `migration-rerun.sh:111-181`
    (the directive's `:109` is the closing `fi` of pass 2; the `echo "==> pass 3"` is at `:111`).
- Open item (outside this re-spec's scope): Step 26's evidence still cites `sandbox.py:350/:394` and
  `servicer.py:282`; the current lines are `:351/:395` and `:283`.

## Session 2026-11-06 — Step 22 (trading broker HTTP timeout is live)

- `TestSubmitOrder_TimeoutIsLive` added to `services/xstockstrat-trading/internal/broker/alpaca_test.go`.
  It uses the `ClientConfig.Timeout func() time.Duration` field that Step 23 Instructions 1 names, and the
  handler returns early on `r.Context().Done()` so the timed-out first request does not hold the server.
- AC-17 red: `go test ./internal/broker/... -count=1` → `unknown field Timeout in struct literal of type
  broker.ClientConfig` (build failed), as the Verification expects before Step 23.
- Behavioural red, checked with a reverted throwaway field on `alpaca.go`: the baked 5000 ms
  `http.Client.Timeout` fails the second request (`Client.Timeout exceeded while awaiting headers`).
  Reverted throwaway per-request deadline → PASS (11.0 s). `alpaca.go` is unchanged in this commit.
- The test takes about 11 s (5 s + 6 s), as the step's 5000/8000 ms and 6 s values require.

## Session 2026-11-06 — Step 23 (per-request broker timeout from one accessor)

- `alpaca.go`: `ClientConfig.TimeoutMs int` → `Timeout func() time.Duration`. `c.timeout()` falls back
  to `defaultTimeoutMs` on nil or ≤0. The eight `c.httpClient.Do` sites go through `(*Client).do`,
  which wraps each request's ctx in `context.WithTimeout(ctx, c.timeout())` and cancels on
  `resp.Body.Close()` (`cancelOnClose`), so the body read stays inside the deadline. `http.Client` has
  no `Timeout`; `HTTPTimeout()` returns `c.timeout()`.
- `brokerCallTimeout(cfgW *config.Watcher)` is a package function with its body unchanged (GetFloat,
  5000, ≤0 → 5000). Callers: the two pollers (`brokerCallTimeout(s.cfgW)`), `instantiateBrokerLocked`
  (`Timeout: func() time.Duration { return brokerCallTimeout(s.cfgW) }`) and `staleThreshold`
  (`brokerCallTimeout(cfgW).Milliseconds()`). It is the only non-test reader of the key.
  `staleThreshold` now gets the ≤0 fallback too; with default config the floor is unchanged.
- RED: `go test ./internal/broker/... -count=1` → `unknown field Timeout in struct literal of type
  broker.ClientConfig` (build failed). GREEN: `golangci-lint` 0 issues; `go test ./... -race` all pass
  (including `TestSubmitOrder_TimeoutIsLive` and `TestStaleThreshold_UsesLiveConfigDefaults`); total
  coverage 82.3% (≥40%).
- Verification grep 3 matches only `defaultTimeoutMs` (kept by Instruction 1); see the Deviation Log.
- Open: the `services/xstockstrat-trading/CLAUDE.md` row for `trading.broker.timeout_ms` still says
  the value is "Read at account-client construction and applied as the broker HTTP client's `Timeout`".
  That file is not in Step 23's Files; it must be reconciled in the feature's doc/teardown pass.

## Session 2026-11-06 — Step 24 (analysis reads the fundamentals provider each cycle)

- `test_provider_flip_applies_on_next_cycle` added to `TestWatchlistUniverse` in
  `services/xstockstrat-analysis/tests/test_fundsignal_loop.py`. It asserts `symbols_total` from the
  `fundsignal_runs` INSERT across two `run_once(dry_run=True)` cycles, so it holds whether Step 25
  reads the provider at cycle start or inside `_apply_symbol_cap`. `_make_loop` gained an optional
  `md_config_watcher` parameter (see the Deviation Log).
- RED: `uv run pytest tests/test_fundsignal_loop.py -q` → 1 failed, 74 passed (`assert 3 == 2` on the
  post-flip cycle), as the Verification expects before Step 25.
- A reverted throwaway per-cycle provider read on `fundsignal_loop.py` → 75 passed. That file is
  unchanged in this commit.
- Note for Step 25: the test does not reach into a stored-watcher attribute, so Step 25 may name it freely.

## Session 2026-11-06 — Step 25 (per-cycle provider read in `fundsignal_loop.py`)

- `FundamentalsSignalLoop.__init__` stores `self._md_cfg = md_config_watcher`. `_provider()` returns
  `get_str("marketdata.fundamentals.provider", "")`, or `""` with no watcher. `_apply_symbol_cap` reads
  it once per call, which is once per cycle: `apply_cap = self._provider() in ("fmp", "")`.
  `_fmp_active`/`_provider_known` are removed (no other reader). See the Deviation Log for the read point.
- Comments rewritten to the live rule: `_provider()` (2 lines) and `app/main.py` above the marketdata
  `ConfigWatcher` (2 lines). The watcher and its construction are unchanged.
- RED: `uv run pytest tests/test_fundsignal_loop.py -q` → 1 failed, 74 passed
  (`test_provider_flip_applies_on_next_cycle`, `assert 3 == 2`). GREEN: `ruff check` clean,
  `ruff format --check` clean (127 files), `pytest --cov=app --cov-fail-under=40` → 1602 passed, 91.13%.
- Open: `services/xstockstrat-analysis/CLAUDE.md` (Fundamentals Signal Producer, Universe bullet) still
  says the provider is read **boot-frozen**. That file is not in Step 25's Files; reconcile it in the
  feature's doc/teardown pass.

## Session 2026-11-06 — Step 26 (indicators sandbox grace key and remaining-deadline clamp)

- `services/xstockstrat-indicators/tests/test_sandbox_deadline.py` created (AC-38): 4 tests, 5 cases.
  The servicer uses a real `snapshot_watcher` reader; `sandbox.execute_formula` is replaced by a recorder;
  the context is `ctx_with(OWNER_HEADERS)` with `time_remaining` set to a `MagicMock`.
- AC-38 red: `uv run pytest tests/test_sandbox_deadline.py -q` → 4 failed, 1 passed. The clamp case
  fails on `assert 15000 <= 2500`, the short-deadline case on `assert True is False` (the sandbox ran),
  and both grace cases on `AttributeError: … sandbox_startup_grace_ms`. The `None`-deadline case already
  passes, as expected. `ruff check` and `ruff format --check` on the file are clean.
- A reverted throwaway sketch of Step 27's watcher method and clamp → 5 passed. `app/` is unchanged in
  this commit.
- Note for Step 27: the short-deadline test expects the error to contain the remaining ms (`5550`), not
  `eff` (see the Deviation Log).
- Open for Step 27: `ctx_with` is a `MagicMock`, so in every existing `ExecuteFormula` test
  `context.time_remaining()` returns a `MagicMock`, not a number or `None`. The clamp has to handle that,
  or those tests must set `time_remaining`. `tests/conftest.py` is not in Step 27's Files.


## Session 2026-11-06 — Step 27 re-spec (operator decision)

- Step 27 halted (blocker:27): `context.time_remaining()` returns a MagicMock on the test contexts of
  ~18 existing ExecuteFormula tests, and the new reader trips `test_rule2_key_sets_match_classification`.
- Operator decision: re-spec first. Added `tests/conftest.py` (`ctx_with`), `tests/test_formulas.py`,
  `tests/test_execute_formula_concurrency.py`, `tests/test_private_formulas.py` (contexts return
  `time_remaining` → `None`) and `tests/test_config_read_classification.py` (`FR3_KEYS`) to Step 27
  **Files**. Rejected: tolerating non-numeric `time_remaining()` in production code.

## Session 2026-11-06 — Step 27 (sandbox grace key + deadline clamp)

- Implemented directly in the operator session (the batch workflow kept halting on F-08 blockers).
- `ExecuteFormula`: clamp computed at the top of `_run` (post-acquire); `eff < 100` → `success=false`
  "request deadline leaves <N>ms …" with no spawn; `eff < timeout_ms` → WARN.
- RED at 6da1d61f: `tests/test_sandbox_deadline.py` 4 failed. GREEN: ruff clean, 476 passed, 85.4%.
- Open items: (1) `check-config-wiring.mjs --final` exits 1 on STALE-STORED (pre-existing since at least
  `0f559b85`; needs `config-wiring-stored.sh` against a scratch Postgres) and a STALE
  `trading.broker.timeout_ms` baseline entry left by Steps 22–23 — operator decision pending.
  (2) `services/xstockstrat-indicators/CLAUDE.md` still describes `SANDBOX_STARTUP_GRACE_MS` as a
  fixed constant (the `timeout_ms` row and the rlimits bullet) — reconcile in the doc/teardown pass.

## Session 2026-11-06 — sdd-execute sequential (sdd-batch-execute): re-spec of Steps 34, 32

- Branch setup: the merge of `origin/main-dev` was already up to date, and `ledger-guard.py --fix`
  reported clean. Status was already `in-progress`, so no transition was made.
- Re-spec 2208ce45 (Instructions/Codebase Evidence/Files/Verification only):
  - Step 34: the `config-wiring-stored` dorny filter (`ci.yml:141-147`) lists neither
    `scripts/config-heal-dryrun.sh` nor `scripts/config-heal/**`, so a PR touching only those would skip
    the `--fresh` gate. Added both paths to Files, added Instruction 5 and a Verification grep.
  - Step 32: line cites only. Pass 0 is `:46-83`, `guard_blocks` is `:145-156` and the dirty guard is
    `migration-dirty-guard.sh:45-53`. The `config) goto 40` arm in the `:71-79` case is net-new, because
    config takes the `*) up` default today. The `migrations` filter already covers the harness.

## Session 2026-11-06 — Step 28 (agent watchers, snapshot policy reads, derived deadline, blocking boot)

- The discovery digest called Steps 14/15 absent. Re-checked on `origin/feature/fix-config-keys-drift`:
  both are `done`, and `watch_core.py` exists in indicators, ingest and analysis. Only Step 29 (the agent
  copy) is pending, which is what this test step precedes. Not a blocker.
- Created three files (15 cases):
  - `tests/test_config_watcher.py`: AC-8, `_agent_policy` snapshot reads, and AC-10 agent.
  - `tests/test_formula_deadline.py`: AC-18, AC-31 and the derived `deadline_s` in the error message.
  - `tests/test_startup_snapshot.py`: AC-37.
- Contract these tests fix for Step 29 (`app/config/watcher.py`):
  - `ConfigWatcher(endpoint, namespace)` subclasses `WatchCore` and honours a class-level `_clock`.
  - The process-wide registry is the module dict `_WATCHERS`, keyed by namespace and read through
    `get_watcher(ns)`. Tests install snapshot watchers with `monkeypatch.setitem`.
  - The dial goes through `grpc.aio.secure_channel` with `mtls.channel_credentials()` and
    `config_pb2_grpc.ConfigServiceStub`.
  - The lifespan builds watchers for `agent` and `indicators`, then awaits `wait_for_snapshot(90)`.
  - Reader spellings: `signal.alert_threshold` (agent), `indicators.sandbox.timeout_ms` and
    `indicators.sandbox.startup_grace_ms` (indicators).
  - The clamp WARN is logged on `app.client`. No other WARN may come from `app.client` on the unclamped
    rows.
- Shared helpers (`install_watcher`, `patch_dial`, `FakeCall`, `shutdown_tasks`, `_tool`) live in
  `test_config_watcher.py`, and the other two files import them. `conftest.py` is not in Files, and all
  three consumers belong to this one feature.
- AC-8/AC-10/AC-18/AC-31/AC-37 red: `uv run pytest tests/test_config_watcher.py tests/test_formula_deadline.py
  tests/test_startup_snapshot.py -q` → 15 failed, every one on `ModuleNotFoundError: No module named
  'app.config.watcher'` (the behavior is missing). `ruff check` and `ruff format --check` are clean on all
  three files. The rest of the agent suite passes: 664 passed.
- A reverted throwaway sketch passed all 15 cases. It had a `watch_core.py` copy, a `watcher.py` with
  `_WATCHERS`, `get_watcher` and `int_positive`, snapshot reads in `ingest_signal` and `_agent_policy`, a
  `formula_deadline_s` helper used by `execute_formula` and `test_formula`, and the lifespan waits.
  `app/` is unchanged in this commit.
- Open for Step 29: existing tests patch `client.get_config_value` for the threshold and OAuth reads, and
  will need the snapshot registry once those reads move. Those tests are `tests/test_tools.py` (ingest_signal
  :352-459), `tests/test_ingest_signal_watchlist.py` and `tests/test_oauth.py:139-182`. Any test that
  enters the HTTP lifespan also needs a dial-free watcher. None of these files are in Step 29's Files, so
  Step 29 must re-spec them or log the change as a deviation.
- The husky hook did not run: neither the main worktree nor this one has `node_modules`, and
  `core.hooksPath` (`/home/user/xstockstrat/.husky/_`) is absent. `--no-verify` was not used.

## Session 2026-11-06 — Step 29 (agent lifespan watchers, policy reads from snapshot, derived deadline)

- **Operator decision (blocker:29):** re-spec first, then implement. Re-spec commit 88d1492d adds the
  agent test files to Step 29's Files and retires `test_ac4_register_does_not_hang_on_stalled_config`.
  DCR no longer calls GetConfig, so that test has no stalled read to bound. The full run also hit the
  AST guard in `test_client_deadlines.py`, so that file was added as well; see the Deviation Log.
- **Created:**
  - `app/config/watch_core.py`, a byte-identical copy of the Python core. It joins guard group `py`, and
    the `config.read_key` and `config.read_coverage` registry rows list it.
  - `app/config/watcher.py`, holding `ConfigWatcher` (WatchCore, lazy `gen.*` imports), the
    `_WATCHERS` registry with `get_watcher`, `read_value`, `int_positive`, and the
    `start_watchers`/`stop_watchers` pair.
- **Startup:** the HTTP `lifespan` and `_run_stdio` call `start_watchers(client.CONFIG_ENDPOINT)`
  before `session_manager.run()` and `run_stdio_async()` respectively. A missing snapshot raises
  `RuntimeError` naming the namespace. Shutdown closes only the watchers that call started.
- **Reads moved to the snapshot:** the threshold in `ingest_signal`, `_agent_policy`, and the DCR
  `oauth.registration_enabled` and `oauth.allowed_redirect_uris` reads. Keys, defaults and casts are
  unchanged. `get_config_value` now serves only the user-facing `get_config` path. The Verification
  grep finds no `get_config_value` in `tools.py` or `oauth_server.py`: the `get_config` tool calls
  `client.get_config`.
- **Derived deadline:** `client.formula_deadline_s(override)` takes `t` and `g` from the `indicators`
  watcher through `int_positive`, applies the override only when it is positive and below `t`, and
  WARNs on `app.client` when it clamps to `_LONG_RPC_TIMEOUT_S`. `test_formula` passes that value to both
  `execute_formula` and `_grpc_error_message`. Tool names, parameters and return shapes are unchanged,
  so `docs/runbooks/mcp-tools.md` needs no edit (confirmed).
- **RED/GREEN:**
  - RED at 09147d2d: `uv run pytest tests/test_config_watcher.py tests/test_formula_deadline.py
    tests/test_startup_snapshot.py -q` gave 15 failed (`ModuleNotFoundError: app.config.watcher`).
  - GREEN: `ruff check` and `ruff format --check` are clean (70 files), and
    `pytest --cov=app --cov-fail-under=40` gave 678 passed at 84.67%.
  - `check-watcher-copies.sh` reports every group byte-identical, and
    `check-otel-produced-signals.sh` exits 0.
- **Open items for the doc/teardown pass:**
  - `services/xstockstrat-agent/CLAUDE.md` § Config Keys Consumed still says the `agent.*` keys are
    resolved through `client.get_config_value()` with the 3 s read deadline.
  - `context-constitution-findings.md:63` cites the stalled-config tests as proof of the 247 deadline.
  - The `watch_core.py` docstring names three services, not four. It is byte-identical across them, so
    the fix edits all four copies.
- The husky hook did not run, because no `node_modules` exists in either worktree. `--no-verify` was
  not used.

## Session 2026-11-06 — Step 30 (test: UI GetConfig carries the native environment)

- **Tests (AC-9):**
  - `src/lib/traderBff.test.ts` (new) mocks every client `traderBff.ts` imports from
    `@/lib/connectClients` (trading, portfolio, marketData, notify, analysis, ledger, config). Only
    `configClient.getConfig` is a stub. It returns `platform.trading_state`=`HALTED` for
    `Environment.PRODUCTION` and `ACTIVE` otherwise. The test dispatches on `/trader/api/…`.
  - `insightsBff.test.ts` gains `getConfig` beside `setConfig` (reset in `beforeEach`) and a namespace
    `ui` case with the same PRODUCTION-only value.
  - Both set `APPLICATION_ENV=production` and restore it in `afterEach`. Both assert that the
    stub received `environment === PRODUCTION` and that the response carries the production value.
- **E2E mock:** `e2e/mock-backend.ts` `getConfig` throws Connect `InvalidArgument` when
  `req.environment` is UNSPECIFIED. `Environment` is now imported from `common_pb`. The positions and
  performance e2e suites therefore fail until Step 31 lands; Step 31's Verification runs them.
- **C-12 verdict:** the session cookie follows the in-file `SignJWT` pattern (a scenario one-off), and
  the config values are inline one-offs. No new domain fixture was added.
- **RED/GREEN:**
  - RED: `pnpm run test:unit` gave 2 failed and 376 passed. Both failures are `expected +0 to be 2`:
    the BFFs forward an UNSPECIFIED environment.
  - A throwaway Step 31 sketch (spread `nativeConfigEnvironment()` into both `getConfig` forwards)
    passed both files (6/6). It was reverted, so `traderBff.ts` and `insightsBff.ts` are unchanged here.
  - `pnpm run lint` passes (warnings only), and prettier is clean on the three files. `tsc --noEmit`
    reports only the existing `e2e/insights/backfills.spec.ts:135-136` errors, which are outside this
    step.
- **Tooling:** `pnpm install --frozen-lockfile` was run in this worktree. The main worktree has no
  `node_modules` to symlink. No manifest changed.
