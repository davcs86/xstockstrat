# Context: ingest-signal-dedup

**Feature**: `docs/roadmap/features/111-ingest-signal-dedup/feature.md`
**Product Spec**: `docs/roadmap/features/111-ingest-signal-dedup/product-spec.md`
**Implementation Spec**: `docs/roadmap/features/111-ingest-signal-dedup/implementation-spec.md`

---

## Session 2026-08-07 — sdd-story

- Created feature.md (status: draft), product-spec.md, context.md from user story
  ("add dedup logic to the ingest_signal tool in the MCP agent (or the upstream service,
  depending on the best solution)").
- Recon (via codebase-discovery subagent) confirmed: `IngestSignal`
  (`services/xstockstrat-ingest/app/handlers/servicer.py:693-818`) unconditionally inserts into
  `ingest.newsletter_signals` with zero duplicate check today. This is a documented, unimplemented
  defect: `services/xstockstrat-ingest/docs/context-constitution-findings.md:12` records that the
  service's docs once claimed a dedup key ("skip re-ingesting same symbol+source+direction within
  this window") that was never wired — the `dedup_window_hours` config key was dead and has since
  been dropped from `CLAUDE.md` entirely. Table `ingest.newsletter_signals`
  (`migrations/001_newsletter_signals.up.sql`) has no unique constraint beyond the hypertable PK.
  The MCP agent's `ingest_signal` tool (`app/tools.py:227-296`) and gRPC client
  (`app/client.py:149-186`) make one call, no retry, no idempotency handling — agent is stateless,
  so it cannot be the sole dedup owner for other `IngestSignal` callers.
- Known trap surfaced from ledger: `insights.md` 2026-08-06 (fundamentals-signal-producer) —
  "when a callee RPC lacks a uniqueness constraint, the idempotency guard belongs in the caller's
  own state table keyed on its natural key" — here `xstockstrat-ingest` is the state-owning layer,
  which is why product-spec FR-5 places the dedup check there rather than solely in the agent.
- Decision: propose dedup logic live in `xstockstrat-ingest` (upstream service), with the MCP
  agent's tool surfacing the outcome and suppressing its own duplicate side effect (auto-alert).
  Final architecture (index vs. app-level check, exact config key name/default) deferred to
  `/sdd-design`.

## Session 2026-08-07 — sdd-design (quick mode + 2 user-requested extensions, 3 rounds total)

- **Phase 0 Recon**: two `codebase-discovery` subagents covered `xstockstrat-ingest` (config-watch
  pattern, `IngestSignal` transaction/pool analysis, precedent search) and `xstockstrat-agent`
  (auto-alert logic, client return shape, test coverage). Key finding: `ingest.newsletter_signals`
  is a hypertable partitioned on `ingested_at` — TimescaleDB requires a hypertable's unique index
  to include its partition column, so a unique constraint directly on the natural dedup key is
  impossible; every hypertable in this repo confirms this constraint with no exception. Two
  existing precedents for the identical problem: `ledger.idempotency_keys` and
  `analysis.fundsignal_emitted` (both side tables + `ON CONFLICT ... RETURNING`). Wrote
  `recon.md`.
- **Phase 1 Grilling — Round 1**: live `design-proposer` + `design-adversary` subagents ran (the
  proposer completed with an `INSERT ... ON CONFLICT ... DO UPDATE ... WHERE ... RETURNING`
  design; the orchestrator's own dispatched adversary critiqued a slightly different
  self-synthesized `SELECT ... FOR UPDATE` variant sent before the real proposer's output arrived
  — a P-02 mediation slip, disclosed here). The adversary's TOCTOU objection against the `SELECT
  FOR UPDATE` variant was verified NOT to apply to the proposer's actual `ON CONFLICT` idiom
  (Postgres's documented upsert semantics + the `fundsignal_emitted` precedent already trusted in
  this repo). Gate 1 (`AskUserQuestion`): user decided (a) dedup window anchored on **ingestion
  time** (`claimed_at`), not `valid_from`; (b) a conviction/`valid_until` change within the window
  is treated as a **fresh signal**, not swallowed as a duplicate — both decisions folded into
  `product-spec.md` FR-1/AC-1/AC-2/Open Questions. Then chose "Run another round."
- **Round 2**: orchestrator synthesized the round-2 design directly (widened claim SQL with
  `IS DISTINCT FROM` on conviction/valid_until, `009_signal_dedup_keys` schema, sentinel-exception
  rollback pattern) — the round-2 **adversary** subagent did not return within a reasonable wait
  window despite several extended waits, so the orchestrator performed that critique pass itself
  (constitution.md + fails.md read directly, migration-number collision checked against all 43
  remote branches via `git ls-remote`, C-10 completeness verified by grepping for other
  `IngestSignal` callers — found `xstockstrat-analysis`'s `fundsignal_loop.py`, reviewed and
  confirmed it needs no change). The round-2 **proposer** subagent *did* complete, independently,
  shortly after — its output converged on the same architecture and the same race-safety
  conclusion reached separately by the orchestrator; its cleaner sentinel-exception rollback code
  and `make_interval()` refinement were folded into `design.md`. Gate 2: user chose "Run another
  round" again.
- **Round 3**: scoped to hardening the four remaining Open Risks (rollback-path test coverage,
  write-amplification estimate, `mark_source_fed`/health-tracking gap, C-08 test-pairing list) —
  explicitly not re-litigating the settled architecture. Orchestrator answered all four directly
  from the live codebase (test file structure, source-registry seed data, `signal_sources.py`)
  after the round-3 proposer subagent again did not return in a reasonable window; added a new
  `touch_source_last_seen` sibling function (cheap fix for the STALE-health gap) and a concrete
  per-test-case plan. Gate 3 (`AskUserQuestion`): user **approved**. The round-3 proposer
  subagent then completed independently, *after* approval — its output converged on the identical
  `touch_source_last_seen` fix (strong triangulated validation) and corrected one detail: the
  proposed rollback-correctness test can't assert a live DB row count (no DB fixture exists in
  this service's test suite — confirmed via grep, `test_backfill_jobs.py:3`'s own comment on the
  pool-is-mocked house style), so it was replaced with an achievable mock-call-count assertion
  (`test_dedup_hit_does_not_reach_generic_error_handler`). Folded into `design.md` as a fidelity
  correction, not a new decision — no re-gate needed.
- **Disclosed deviation (P-03)**: three background subagent calls (round-1 adversary target
  mismatch — sent the orchestrator's own draft instead of the live proposer's; round-2 adversary;
  round-3 proposer) did not complete within the session's practical wait budget despite repeated
  extended waits (up to several minutes each). In each case the orchestrator performed the same
  analytical pass itself (reading the same source files, verifying the same SQL/race-safety/
  migration-collision claims against real evidence rather than asserting them) rather than
  silently skipping the check or waiting indefinitely. All three eventually-completed late
  subagent outputs (round-1 proposer, round-2 proposer, round-3 proposer) were checked against the
  orchestrator's inline work and found to converge independently — no contradiction surfaced.
- **Constitution rules touched**: C-01, C-05, C-07, C-09, C-10, C-14, F-06, F-07 (all honored —
  see `design.md` § Constitution Rules Touched). No Floor (`F-*`) breach at any round.
- **Ledger touch**: none written — no new cross-feature pattern or recurring mistake surfaced
  beyond what's already recorded (the fundamentals-signal-producer idempotency-guard-at-the-
  caller-layer insight and the hypertable-unique-index constraint were both already in
  `insights.md`/informed this design; nothing new to append).
- Status: `draft` → `design-approved`.

## Session 2026-08-07 — sdd-spec

- Generated implementation-spec.md with 14 steps. Status → implementation-ready.
- Key codebase findings:
  - `design.md`'s illustrative code snippet names the config-watcher attribute
    `self._config.dedup_window_hours`, but the real attribute set by
    `IngestServicer.__init__` (`servicer.py:171`) is `self._cfg` — Step 6 instructs the real
    attribute name, not the design snippet's placeholder.
  - `services/xstockstrat-ingest/tests/_helpers.py` (already the shared-fixture home for this
    service per its own docstring) gets a new `async with self._db.acquire()`-mock helper in
    Step 7, reusing the async-context-manager idiom already live at
    `services/xstockstrat-agent/tests/test_client.py:71-75` (`_channel_cm`).
  - Confirmed live precedent for the `async with self._db.acquire() as conn,
    conn.transaction():` idiom already exists in this repo —
    `services/xstockstrat-analysis/app/repositories/opportunities.py:48`
    (`OpportunitiesRepository.replace_for_user`) — so this is not a novel pattern for the
    codebase, only for `xstockstrat-ingest` specifically (confirmed zero prior use there).
  - Migration `009_signal_dedup_keys` confirmed as the next free number (last file
    `008_signal_source_health.{up,down}.sql`); schema `ingest` already exists
    (`migrations/000_schema.up.sql`), so no `CREATE SCHEMA` needed in the new migration.
  - `services/xstockstrat-ingest/CLAUDE.md`'s `## Config Keys Consumed` table currently has no
    `ingest.signals.*` namespace at all (the historical dead keys were fully removed) — Step 12
    reintroduces the namespace with exactly the one wired key, not the old 9-key placeholder set.

## Session 2026-08-07 — manual execute (all 14 steps, on the harness branch)

- **Branch-topology deviation, disclosed up front (matches the ledger's 2026-07-30
  082-fix-fmp-config-boot-only entry — a harness-assigned session branch diverging from the SDD
  `**Development Branch**`)**: this session's harness task explicitly assigned
  `claude/ingest-signal-dedup-ehhgy6` as the branch to develop and push on, with instructions to
  never push to a different branch without explicit permission. `/sdd-execute`'s normal flow
  (per-step branches off `feature/ingest-signal-dedup`, step PRs, then a final integration PR)
  would require creating and pushing `feature/ingest-signal-dedup` and
  `feature/ingest-signal-dedup/step-N` branches — a conflict with that constraint. Root
  `CLAUDE.md` § Branch Strategy independently confirms `claude/*` branches are PR'd directly into
  `main-dev`, never used as a feature base. Resolution: implemented all 14 steps directly on
  `claude/ingest-signal-dedup-ehhgy6` in this single session, following `implementation-spec.md`'s
  instructions step-for-step (including each step's red-before-green verification where
  applicable), rather than running `/sdd-execute`'s per-step-branch automation. `feature.md`'s
  `**Development Branch**` field is left as `feature/ingest-signal-dedup` for SDD-doc consistency,
  but the actual code landed on the harness branch — the integration PR source is
  `claude/ingest-signal-dedup-ehhgy6`, not that field.
- Steps 1–2 (proto + codegen): added `IngestSignalResponse.deduplicated`. Toolchain unavailable
  via the normal Docker path in this sandbox (no docker daemon) — provisioned the host toolchain
  per `docs/runbooks/codegen-toolchain-host-setup.md` (buf 1.72.0, the three pinned Go plugins,
  the three pinned TS plugins, `grpcio-tools==1.80.0`), validated an **empty diff** against the
  committed stubs on the unmodified proto first (toolchain-drift check), then re-ran with the
  real change. `buf lint` and `buf breaking --against main-dev` both pass; generated-stub diff
  scoped to `ingest/v1/` only across Go/Python/TS, `deduplicated` field confirmed present and
  round-trippable in all three.
- Step 3 (migration `009_signal_dedup_keys`): written exactly per `implementation-spec.md`;
  confirmed collision-free against all 43 remote branches (already checked at design time).
- Steps 4–5 (config getter + test): `ConfigWatcher.dedup_window_hours` added; test passes.
- Steps 6–7 (the core handler rewrite + tests) — the largest step. Rewrote `IngestSignal`'s
  persist block per `design.md`'s sentinel-exception transaction pattern, using the real
  `self._cfg` attribute (not the design doc's `self._config` placeholder, per Step 6's own
  Codebase Evidence correction). Confirmed red-before-green: the 4 pre-existing tests failed
  against the rewritten handler (old `svc._db.fetchrow`-direct mocking shape incompatible with
  the new `acquire()`/`transaction()` call shape) before being rewritten. Added the
  `transaction_conn` helper to `tests/_helpers.py` per design.md's resolved mocking risk. All 10
  new test cases from `design.md` § Test Plan pass. **Wider blast radius than the spec's
  Codebase Evidence anticipated**: two more pre-existing tests outside `TestIngestSignal`
  (`TestIngestSignalRegistryValidation::test_proceeds_when_source_registered`,
  `TestIngestSignalConvictionValidation::_servicer_full_happy_path`) plus
  `test_source_health.py::test_ingest_signal_bumps_fed_count` also used the old mocking shape and
  needed the same rewrite — recorded in `implementation-spec.md`'s Deviation Log.
- Steps 8–9 (agent `client.ingest_signal`): `deduplicated` surfaced in the returned dict; new
  `TestIngestSignalClient` test added (first-ever unit test of this function, confirmed absent
  beforehand).
- Steps 10–11 (agent `ingest_signal` tool): alert guard now reads `result.get("deduplicated")`;
  docstring updated; 3 tests added/updated (suppression, non-suppression regression guard,
  payload shape).
- Steps 12–14 (docs): `services/xstockstrat-ingest/CLAUDE.md` (config key + new table row, plus a
  one-sentence correction to the adjacent `signal_sources` bullet describing the new
  `touch_source_last_seen` path), `docs/runbooks/mcp-tools.md` (return shape + intro sentence +
  errors row), and `context-constitution-findings.md`'s stale "Dedup key" row removed (the
  adjacent "9 dead config keys" row, a different already-resolved claim, left untouched).
- **Verification (all steps)**: `xstockstrat-ingest` 179/179 tests pass (`pytest --cov=app
  --cov-fail-under=40`, 76.5% actual, was 169/169 at 76.8% baseline before this session — the
  ingest test *count* grew by 10 net-new + 3 renamed-not-net-new); `xstockstrat-agent` 201/201
  tests pass (77.1% actual, was ~198 before — net +3 new tests); `ruff check`/`ruff format
  --check` clean on both services; `buf lint`/`buf breaking` clean.
- Constitution rules honored: C-01 (every instruction cited real path:line), C-05 (config key
  naming), C-07 (migration numbering, collision-checked), C-08 (every service step paired with a
  test step), C-09 (buf lint/breaking run), C-10 (deduplicated surfaced consistently — agent tool
  response, docstring, mcp-tools.md; the second real IngestSignal caller,
  `xstockstrat-analysis`'s `fundsignal_loop.py`, reviewed at design time and confirmed to need no
  change), C-14 (Agent consumer surface reached in this feature, not deferred), F-05 (verification
  passed before each logical commit unit), F-07 (no hardcoded config value), F-08/F-09 (stayed
  within the spec's Files sections; only step Status fields flipped, Instructions/Evidence
  untouched).
- Status: `implementation-ready` → `code-completed`.
- **Next**: open the integration PR from `claude/ingest-signal-dedup-ehhgy6` to `main-dev`.
- PR #887 opened against `main-dev`. `Secret scan (trufflehog)` reported a false positive
  (case-insensitive `lob` substring matches inside `globalThis`/`_globals` protobuf-codegen
  boilerplate, not an actual credential — confirmed via direct diff inspection, no Lob-key-shaped
  string anywhere in the diff, and the same job passes cleanly on other recent PRs untouched by a
  proto regen). Posted findings as a PR comment rather than silently ignoring or unilaterally
  changing the shared secret-scan CI config. All other 31 checks green.

## Session 2026-08-07 — merge-conflict resolution

- `main-dev` advanced two commits after this PR opened (#888 screener-criteria fix, #886
  MCP-tool-authz fix) and both touched `services/xstockstrat-agent/app/tools.py`; GitHub reported
  `mergeable_state: behind`. Fetched `origin/main-dev` and ran `git merge origin/main-dev
  --no-edit` on the branch — resolved automatically via git's `ort` strategy with **no textual
  conflicts** (`tools.py`, `tests/test_tools.py`, `docs/runbooks/mcp-tools.md` all auto-merged
  cleanly; the two PRs touched disjoint regions of each shared file). Confirmed the dedup
  auto-alert-suppression logic and the `deduplicated` doc content both survived intact post-merge.
- Re-ran full verification after the merge: `xstockstrat-agent` 211/211 tests pass (up from
  201 — main-dev's #886 added its own tests), `xstockstrat-ingest` 179/179 unaffected, `ruff
  check`/`format --check` clean on both, `buf lint`/`buf breaking` clean with an empty generated-
  stub diff (proto untouched by the merge), `jscpd` clean. Pushed the merge commit
  (`0530ae7..1d54cc5`).
