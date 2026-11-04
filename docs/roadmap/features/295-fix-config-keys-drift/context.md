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
