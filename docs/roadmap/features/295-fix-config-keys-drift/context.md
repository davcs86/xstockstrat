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
