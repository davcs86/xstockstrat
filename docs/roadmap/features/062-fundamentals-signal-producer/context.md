# Context: fundamentals-signal-producer

**Feature**: `docs/roadmap/features/062-fundamentals-signal-producer/feature.md`
**Product Spec**: `docs/roadmap/features/062-fundamentals-signal-producer/product-spec.md`
**Implementation Spec**: `docs/roadmap/features/062-fundamentals-signal-producer/implementation-spec.md`

---

## Session 2026-06-26 — sdd-story

- Created feature.md (status: draft), product-spec.md, context.md. Feature 5 of 6.
- Idea origin: a "fundamentals signal" — derive a buy/sell/hold from a fundamental score and ingest it
  as an `ExternalSignal` from a `fundamentals` source, so it flows through backtest signal-weighting,
  the screener, alerting, and source-weighting with no new consumers. Complementary to the direct
  screener criteria (060), not a replacement.
- **FMP free-tier discipline is the backbone**: the producer NEVER calls FMP directly — all reads go
  through marketdata's cached `GetFundamentalsMulti`. On top it adds universe dedup, paced/resumable
  fetching, a soft budget reservation (200 of 250, leaving 50 for the interactive screener), and
  idempotent emit (UNIQUE symbol+source+as_of_date) so re-runs spend nothing.
- Forward-test property: even without historical fundamentals (deferred in 059), running the producer
  daily accumulates a clean point-in-time signal history going forward — no look-ahead.

## Session 2026-06-26 — sdd-review product-spec

- Product spec reviewed (spec-reviewer + feature-overlap subagents). Status: draft → spec-ready.
- Verdict: PASS / overlap WARN-class only (no hard FAIL-level collision today). No blockers. Claims
  verified: analysis has a reusable config-driven interval loop (`app/engine/live_loop.py`), uses asyncpg
  (`app/main.py`), migrations dir at 001–002; ingest exposes `IngestSignal`/`QuerySignals`/`ManageSignalSource`;
  `analysis.signals.source_weights` exists; `RunFundamentalsScan` is additive to analysis.proto; DB pool stays
  at 2; analysis→ingest write edge is via RPC (gRPC-only rule honored). Budget design (200 of 250) coherent.
- Spec fixes applied:
  1. Pinned the new migrations as `003_fundsignal_runs` / `004_fundsignal_emitted` with up+down pairs
     (next free after 001/002).
  2. Cosmetic: "analysis pgxpool" → "analysis's existing asyncpg pool" (analysis is Python, not Go).
- Cross-feature items to RE-CHECK at /sdd-review impl-spec (advisory, not blocking now):
  * analysis.proto: 060 (`ScreenSymbols`) and 062 (`RunFundamentalsScan`) both extend the same file —
    coordinate new message field numbers + append order at impl-spec.
  * config namespace: 063 MAY add `analysis.fundsignal.value_weight`/`quality_weight` into 062's namespace.
    No duplicate key exists today (062 declares neither). Becomes a FAIL only if 063 materializes them as
    config keys rather than formula params — coordinate at 063's impl-spec so only one feature owns them.
- merge-order.md already sequences 059 + 063 ahead of 062 (lines 38–39).

## Session 2026-06-27 — sdd-spec

- Generated implementation-spec.md with 12 steps. Status → implementation-ready.
- Key codebase findings:
  - **Hard upstream deps are unimplemented in code**: 059 (`GetFundamentalsMulti`, `marketdata.fundamentals`
    table, `marketdata.fmp.*` keys incl. `daily_request_cap`=250) is `implementation-ready` with 0/11 steps
    done; the marketdata proto today has no fundamentals RPC (`packages/proto/marketdata/v1/marketdata.proto:12-35`).
    058 (watchlists) is spec-only — no `watchlist` token in `xstockstrat-portfolio` or `portfolio.proto`.
    The spec gates the producer on 059 (cite 059 spec lines, do not treat as existing code).
  - **Idempotency must live in analysis, not ingest**: ingest's `IngestSignal` has NO DB UNIQUE constraint
    (`services/xstockstrat-ingest/migrations/001_newsletter_signals.up.sql:20` PK is `(id, ingested_at)`;
    `servicer.py:658-665` is a straight INSERT). Hence the new `analysis.fundsignal_emitted` PK
    `(symbol, source, as_of_date)` is the FR-5 guard. `ExternalSignal` has NO `as_of_date` field
    (`ingest.proto:105-115`); `direction` is a **string** `"buy"|"sell"|"hold"|"watchlist"`, not an enum.
  - **`source_type` CHECK caveat (FR-7)**: ingest `signal_sources.source_type` CHECK allows only five
    email/website values (`002_add_signal_sources_registry.up.sql:8-10`) — no `fundamentals`. Registering the
    source via `ManageSignalSource` (admin-gated, `x-access-scope` bit 0x04, `ingest/servicer.py:858,118-131`)
    needs a coordinated `source_type` choice or CHECK relaxation. Flagged in Step 8 + Deviation Log.
  - **Watchlist global-union caveat (FR-3)**: 058's `ListWatchlists` is user-scoped, so it can't return the
    global union FR-3 needs. Step 8 resolves via a global RPC (if 058 adds one) or `explicit` fallback.
  - **`PORTFOLIO_ENDPOINT` is net-new**: absent from `main.py`, `docker-compose.yml:346-359`,
    `.do/app.dev.yaml:205-234`, `.do/app.yaml:205-234`. Step 6 adds it (port 50052) in all four places + a
    portfolio stub. DB pool stays at 2 (reuse existing asyncpg pool, `main.py:44-47`).
  - **Reuse patterns**: producer mirrors `app/engine/live_loop.py` (interval loop `:58-70`, lock guard,
    broad try/except, ledger/notify emit `:156-186`); typed config via `app/config/watcher.py`
    (`get_bool:76`/`get_int:68`/`get_float:84`/`get_str:60`); RPC + admin gate + header propagation in
    `app/handlers/servicer.py` (`_has_admin_scope:72-85`, propagation `:147-151`); analysis migrations stop
    at 002; config keys seeded via SQL INSERT migrations (config migrations stop at 005 → next 006).
  - **analysis.proto**: last RPC `SetStrategyLive` (`analysis.proto:19`), highest field number 13; new
    messages number from 1. Coordinate additive append order with 060 (`ScreenSymbols`).

## Session 2026-06-27 — sdd-review impl-spec (advisory)

- Impl-spec reviewed. Verdict: PASS, 0 blockers. Risks verified correct: ExternalSignal has NO as_of_date and direction is
  a string → idempotency correctly lives in analysis.fundsignal_emitted PK(symbol,source,as_of_date); analysis interval-loop
  + asyncpg pool reused (no new pool); migrations 003/004 are next-free analysis NNN; PORTFOLIO_ENDPOINT net-new in main.py +
  docker-compose + both .do specs.
- BIGGEST OPEN ITEM for execute (in Deviation Log): ingest signal_sources.source_type CHECK allows only the five email/website
  values — registering a 'fundamentals' source needs either an existing allowed value OR a CHECK-relaxation migration in ingest
  (next-free ingest migration would be 006, uncontested). Coordinate with the ingest owner BEFORE execute; the producer cannot
  register its source until resolved.
- CONFIG-MIGRATION RENUMBER (user-approved): config seed migration renumbered 006 → `008_analysis_fundsignal_keys` (058=006,
  059=007, 062=008). Must merge AFTER 058's 006 and 059's 007 (golang-migrate numeric order). Recorded in merge-order.md.

## Session 2026-06-27 — resolve ingest source_type open item (user decision)

- DECISION (user): resolve the biggest open item — registering a fundamentals signal source — with an
  ADDITIVE ingest migration adding a new `source_type='derived'` (generic bucket for internally-produced,
  non-extraction signals), NOT a reused email/website value and NOT a literal `fundamentals` value
  (`derived` is reusable for future synthetic producers: momentum/sentiment/etc.).
- Added **Step 13** to implementation-spec.md (now 13 steps): ingest migration
  `006_signal_source_type_derived.{up,down}.sql` — DROP + re-ADD the `signal_sources_source_type_check`
  CHECK with `derived` appended. Purely additive (no value removed); down deletes derived rows first then
  restores the 5-value CHECK. `006` is next-free ingest migration (trunk at 005).
- Why low-risk (verified in code): `IngestSignal` checks only slug+active, never source_type
  (servicer.py:639); `validate_config_json` returns None/pass for any non-email/website type
  (signal_sources.py:103); no background worker runs extractors over the registry; the registration row
  reuses the existing `app/extractors/noop.py` no-op extractor. So no ingest app-code change is needed.
  The CHECK was already behind the code (validation references mediated_* types absent from the CHECK),
  so extending the allow-list is routine, not a loosening of validation.
- Step 8 updated: `_ensure_source_registered()` now registers source_type='derived',
  extractor_module='app.extractors.noop'; depends on Step 13 applying first. Deviation Log entry marked
  RESOLVED. Cross-service migration → needs ingest-service-owner + DBA sign-off at execute.
- NOTE: the migration SQL is DRAFTED IN THE SPEC (Step 13), not committed as live ingest files — keeps this
  PR spec-only; /sdd-execute writes the files verbatim.

## Session 2026-06-27 — TODO: make validate_config_json fail-closed (user-flagged)

- User flagged that relying on validate_config_json's fail-open default (returns None/pass for any
  unrecognized source_type, signal_sources.py:103) is wrong — it should be FAIL-CLOSED.
- Added a tracked TODO to Step 13 (Instruction 4) + a Deviation Log entry: convert validate_config_json to
  explicitly allow-list known source_types (incl. `derived`) and return an error for unknown ones; the
  allow-list must be a superset of the DB CHECK so no CHECK-valid type is wrongly rejected. Add a unit test
  for the unknown-type rejection. Land with Step 13 or file as a follow-up — do not leave `derived`
  depending on the permissive fall-through.
- Reconciled the Step 8 evidence note (previously "no validation change needed") to point at this hardening.

---

## Session 2026-06-29 — /sdd-execute (all 13 steps)

Executed on `feature/fundamentals-signal-producer`, stacked on `feature/fundamentals-scoring-model`
(which is stacked on `feature/fundamentals-data-source` → `feature/watchlist-management` → `main-dev`).
PR targets the parent `feature/fundamentals-scoring-model`.

**Steps 1–2 (proto + gen)**: Added `RunFundamentalsScan(RunFundamentalsScanRequest)` →
`FundamentalsScanSummary` to `analysis.proto` after `SetStrategyLive` (new messages number from 1;
no collision with 060's additive `ScreenSymbols`). Regenerated Go/Python/TS stubs with the
CI-pinned plugin versions so the diff stays minimal.

**Steps 3–4 (analysis migrations)**: `003_fundsignal_runs` (run-state + budget accounting),
`004_fundsignal_emitted` (PK `(symbol, source, as_of_date)` idempotency guard, FK → runs). Validated
against a local Postgres cluster (schema created upstream, per the 001/002 convention).

**Step 5 (config seed)**: `008_analysis_fundsignal_keys` seeds the 12 `analysis.fundsignal.*` keys ×
{dev, production} = 24 rows, stored split (namespace `analysis`, key `fundsignal.<rest>`) matching
`003_analysis_signal_source_weights`. Numbered 008 to sit after 058's 006 and 059's 007 in the shared
config migrations dir.

**Steps 6/8/9 (producer + RPC)**: `app/engine/fundsignal_loop.py` `FundamentalsSignalLoop` mirrors
`LiveEvaluationLoop`: `run_forever` (interval/enabled-gated, lock skip-if-running, broad try/except) and
the shared `run_once(force, dry_run, override_symbols, metadata)` path. Helpers: `_resolve_universe`
(explicit fallback — see deviation), `_paced_fetch` (budget-bounded `GetFundamentalsMulti` chunks, never
FMP), `_score` (built-in `_BUILTIN_BANDS`/`_lin` default OR 063 `score_fundamentals` when
`scoring_formula_id` set), `_map_directions` (cross-sectional quantile), `_ensure_source_registered`
(`ManageSignalSource` `source_type='derived'`, admin bit injected on the loop path), `_emit_signal`
(`IngestSignal` `ExternalSignal`), `_finish` (returns `FundamentalsScanSummary`). `servicer.py` adds the
portfolio stub + admin-gated `RunFundamentalsScan` (PERMISSION_DENIED non-admin, UNAVAILABLE if loop
unset, forwards propagation metadata). `main.py` wires `PORTFOLIO_ENDPOINT` + constructs the loop and
`create_task(run_forever())`, reusing the existing asyncpg pool (no new pool).

**Step 13 (ingest `derived`)**: `006_signal_source_type_derived` DROP/ADD CHECK adds `derived`; down
deletes derived rows first. `validate_config_json` made **fail-closed** (explicit `derived` branch +
`else` rejecting unknown types).

**Steps 7/10 (tests)**: `test_fundsignal_loop.py` (13 tests — cache-only forbidden-import guard,
idempotency via already-emitted + ON CONFLICT claim, dedup, budget defer + notify warning,
score→direction, min-conviction drop, dry-run). `test_analysis_servicer.py` +4 `RunFundamentalsScan`
cases (admin gate, unavailable, summary mapping + metadata propagation, dry-run pass-through).
`test_signal_sources.py` +2 (derived no-config, unknown-type rejection). Analysis: 125 pass, 65% cov
(fundsignal_loop 79%). Ingest signal_sources: 29 pass. `ruff check`/`ruff format --check` clean.

**Step 12 (docs)**: analysis CLAUDE.md (12 keys, 2 ledger events, "Fundamentals Signal Producer"
subsection, new dependency edges, `PORTFOLIO_ENDPOINT`), root CLAUDE.md (feature 062 keys block).

**Deployment**: `PORTFOLIO_ENDPOINT` added to the analysis block in docker-compose.yml + .do/app.dev.yaml
+ .do/app.yaml.

**Deviation**: universe used the `explicit` fallback (058 `ListWatchlists` is user-scoped, no global
union RPC). See Deviation Log.

## Session 2026-06-29 (CI: feature status automation)

- Promotion PR #729 merged to main
- Feature promoted and committed: e8742e4e4f4dd88cbbc6ed85151784c4434d4885
- Status updated: `code-completed` → `launched`
- Launched date: 2026-06-29
