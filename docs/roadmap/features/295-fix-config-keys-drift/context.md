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
