# Design: ingest-signal-dedup

**Created**: 2026-08-07
**Rounds**: 3 (quick mode; mandated 1 round completed via live proposer+adversary subagents, user
requested two further rounds. Round 2's adversary subagent and round 3's proposer subagent did not
return within a reasonable wait window in each case; the orchestrator performed those passes
directly from the settled prior-round findings, applying the same verification rigor (SQL
correctness, race-safety reasoning against the documented Postgres `INSERT ON CONFLICT` upsert
contract and the existing `analysis.fundsignal_emitted` precedent, C-10 completeness, migration-
number collision check across all 43 remote branches, direct inspection of existing test files and
mocking idioms). Round 2's *proposer* subagent did complete independently and its output was
cross-checked against the orchestrator's own synthesis — same architecture, same race-safety
conclusion, reached independently — with its cleaner sentinel-exception rollback pattern and
`make_interval()` refinement folded in. See `context.md` for the full disclosed deviation on each
fallback.)
**Approved by**: user @ 2026-08-07 (design-gate `AskUserQuestion`, rounds 1, 2, and 3 — final
approval given before round 3's proposer subagent returned; its output arrived independently
afterward, converged on the same architecture and the same `touch_source_last_seen` fix, and was
folded in as a fidelity refinement — most notably correcting the rollback-correctness test from a
non-achievable live-DB row-count assertion to an achievable mock-call-count assertion — without
reopening any already-approved decision. See `context.md`.)
**Grounded in**: recon.md

---

## Chosen Approach

Dedup lives entirely in `xstockstrat-ingest`'s `IngestSignal` handler
(`services/xstockstrat-ingest/app/handlers/servicer.py:693-818`) — the state-owning service for
any `IngestSignal` caller (recon.md § Patterns to REUSE; product-spec FR-5). No new inter-service
edge; the MCP agent's `ingest_signal` tool (the named Consumer Surface, C-14) reacts to the new
response field but does not itself perform the dedup logic.

**1. New side table, migration `009_signal_dedup_keys`** (`services/xstockstrat-ingest/migrations/`
— confirmed free of collision against all 43 remote branches):

```sql
CREATE TABLE IF NOT EXISTS ingest.signal_dedup_keys (
    source      TEXT        NOT NULL,
    symbol      TEXT        NOT NULL,
    direction   TEXT        NOT NULL,
    conviction  NUMERIC(4,3),
    valid_until TIMESTAMPTZ,
    signal_id   BIGINT      NOT NULL,
    claimed_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (source, symbol, direction)
);
CREATE INDEX idx_signal_dedup_keys_claimed_at ON ingest.signal_dedup_keys (claimed_at);
```

A plain (non-hypertable) table, not an index on `ingest.newsletter_signals` itself — confirmed via
recon that TimescaleDB requires a hypertable's unique index to include its partition column
(`ingested_at`), which isn't part of the natural dedup key, and every hypertable in this repo
follows that constraint with no exception (recon.md § Patterns to REUSE). This is the same
structural workaround already shipped twice: `ledger.idempotency_keys`
(`services/xstockstrat-ledger/migrations/002_idempotency_keys.up.sql`) and
`analysis.fundsignal_emitted` (`services/xstockstrat-analysis/migrations/004_fundsignal_emitted.up.sql`).
`conviction`/`valid_until` columns and the `claimed_at` index are additions beyond round 1's
schema, needed for the round-2 decisions below. No FK to `newsletter_signals.id`, matching both
precedents (neither carries one, for the same reason: the referenced table's PK includes a column
— `ingested_at`/`recorded_at` — outside the natural key).

**2. Dedup match, decided at the design gate:** a submission is a duplicate of the current claim
for `(source, symbol, direction)` only if **all** of the following hold: (a) `claimed_at` is
within the configurable window of `NOW()` (**ingestion-time anchor, not `valid_from`** — matches
the historical documented intent, "skip re-ingesting... within this window", and the User Story's
framing of resubmission-event proximity, not the signal's own business timestamp — recon.md §
Risks flagged this fork; user confirmed ingestion-time), **and** (b) `conviction` and
`valid_until` both match the currently-claimed values exactly (NULL-safe) — a materially different
conviction or validity window is a fresh signal even inside the time window (user-confirmed;
updates FR-1/AC-1 in `product-spec.md`).

**3. Atomic claim, in the service's first-ever explicit asyncpg transaction** (recon confirmed zero
prior explicit-transaction usage in `app/`):

```python
symbol_upper = signal.symbol.upper()

class _DuplicateSignal(Exception):
    """Internal control-flow signal only: the dedup claim's WHERE evaluated false — force
    the `async with conn.transaction():` block below to ROLLBACK the speculative
    newsletter_signals insert. Never crosses the RPC boundary."""

deduplicated = False
try:
    async with self._db.acquire() as conn, conn.transaction():
        row = await conn.fetchrow(
            """INSERT INTO ingest.newsletter_signals
                   (source, symbol, direction, conviction, valid_from,
                    valid_until, headline, raw_url, tags)
               VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id""",
            signal.source, symbol_upper, signal.direction, conviction,
            valid_from, valid_until, signal.headline or None,
            signal.raw_url or None, list(signal.tags) if signal.tags else [],
        )
        candidate_id = row["id"]

        claim = await conn.fetchrow(
            """INSERT INTO ingest.signal_dedup_keys
                   (source, symbol, direction, signal_id, conviction, valid_until, claimed_at)
               VALUES ($1,$2,$3,$4,$5,$6,NOW())
               ON CONFLICT (source, symbol, direction) DO UPDATE
                   SET signal_id = EXCLUDED.signal_id,
                       conviction = EXCLUDED.conviction,
                       valid_until = EXCLUDED.valid_until,
                       claimed_at = EXCLUDED.claimed_at
                   WHERE ingest.signal_dedup_keys.claimed_at
                             < NOW() - make_interval(hours => $7::int)
                      OR ingest.signal_dedup_keys.conviction
                             IS DISTINCT FROM EXCLUDED.conviction
                      OR ingest.signal_dedup_keys.valid_until
                             IS DISTINCT FROM EXCLUDED.valid_until
               RETURNING signal_id""",
            signal.source, symbol_upper, signal.direction,
            candidate_id, conviction, valid_until,
            self._config.dedup_window_hours,
        )
        if claim is None:
            # Raising here — still inside `async with conn.transaction():` — is what forces
            # the ROLLBACK. A refactor that catches this sentinel INSIDE the `async with`
            # block, or reorders `except _DuplicateSignal` after a generic `except Exception`,
            # would silently defeat FR-1's "MUST NOT insert a second row" guarantee while
            # still reporting deduplicated=true — see Open Risks.
            raise _DuplicateSignal()
        signal_id = candidate_id
except _DuplicateSignal:
    deduplicated = True
    existing = await self._db.fetchrow(
        "SELECT signal_id FROM ingest.signal_dedup_keys "
        "WHERE source=$1 AND symbol=$2 AND direction=$3",
        signal.source, symbol_upper, signal.direction,
    )
    if existing is None:
        # Unreachable in normal operation — nothing deletes signal_dedup_keys rows.
        await context.abort(grpc.StatusCode.INTERNAL, "dedup claim lost")
        return
    signal_id = existing["signal_id"]
except Exception as e:
    # PRESERVED from the original servicer.py:768-777 — now covers both statements in the
    # transaction, since a failure in either is equally a "failed to insert signal" event.
    log.error("failed to insert signal: %s", e)
    try:
        await mark_source_error(self._db, signal.source, str(e))
    except Exception as bookkeeping_err:
        log.warning("failed to record source error for %s: %s", signal.source, bookkeeping_err)
    await context.abort(grpc.StatusCode.INTERNAL, f"database error: {e}")
    return

if not deduplicated:
    # existing side effects (mark_source_fed, `ingest.signal.ingested` AppendEvent) run
    # only here, unchanged from today — a dedup hit performed no new ingest.
    ...
else:
    # Round 3: a dedup hit still means the source is alive — bump last_seen_at (but NOT
    # signals_fed, which counts genuinely new signals) so a source that legitimately keeps
    # resending the same still-current recommendation doesn't read as STALE/DOWN in
    # ListSignalSources health derivation. New, narrower sibling of mark_source_fed.
    try:
        await touch_source_last_seen(self._db, signal.source)
    except Exception as e:
        log.warning("failed to touch last_seen for %s: %s", signal.source, e)

return ingest_pb2.IngestSignalResponse(signal_id=signal_id, deduplicated=deduplicated)
```

**Round 3 addition — `touch_source_last_seen`** in
`services/xstockstrat-ingest/app/repositories/signal_sources.py`, alongside `mark_source_fed`
(`:59-67`) and `mark_source_error` (`:70-76`):
```python
async def touch_source_last_seen(db_pool, slug: str) -> None:
    """Record that a source is alive (heard from it) without counting a new signal fed —
    used on a dedup hit, where mark_source_fed's signals_fed bump would be wrong."""
    await db_pool.execute(
        "UPDATE ingest.signal_sources SET last_seen_at = NOW() WHERE slug = $1", slug,
    )
```
This resolves what round 1/2 had accepted as an open risk (a repeatedly-deduped-but-alive source
reading as STALE) at negligible cost — a two-line sibling function, not a refactor of
`mark_source_fed` itself.

`INSERT ... ON CONFLICT ... DO UPDATE ... WHERE ... RETURNING` is race-safe **by construction**,
including the very first concurrent pair for a brand-new key — this is Postgres's documented
`INSERT ON CONFLICT` (upsert) contract: a second transaction targeting the same conflict key blocks
on the first's row lock until it commits or rolls back, then correctly re-evaluates the `ON
CONFLICT` clause against the now-current row (or proceeds as a plain insert if the first rolled
back). This is not a novel claim about this codebase — it's the same idiom already shipped and
trusted here for the identical guarantee: `analysis.fundsignal_emitted`'s
`"ON CONFLICT (symbol, source, as_of_date) DO NOTHING RETURNING symbol"`
(`services/xstockstrat-analysis/app/engine/fundsignal_loop.py:158-162`). Adding `OR` clauses to the
`WHERE` (for the conviction/valid_until widening) does not change this — the `WHERE` condition is
still evaluated as part of the same atomic conflict resolution, only the *outcome* of that
evaluation changes.

Insert-first ordering (not claim-first) is required because `newsletter_signals.id` is a
`BIGSERIAL` (`services/xstockstrat-ingest/migrations/001_newsletter_signals.up.sql:9`) — unlike
`ledger.idempotency_keys`, which claims with a **client-pregenerated UUID**
(`services/xstockstrat-ledger/src/grpc/ledgerServiceImpl.ts:31`) before any DB round-trip, there is
no id to claim with before the candidate row exists. The accepted cost: every duplicate
submission still performs one real (transactionally rolled-back) `newsletter_signals` insert before
being discarded — bounded write amplification under sustained duplicate traffic, not fixed by this
feature (see Open Risks).

**4. Config**: `ingest.signals.dedup_window_hours` (int, default `24`) — new `ConfigWatcher` typed
property mirroring `backfill_chunk_window_days`
(`services/xstockstrat-ingest/app/config/watcher.py:126-128`); falls back to the hardcoded default
if the config service is unreachable (existing `get_int` behavior, `watcher.py:68-74`).

**5. Proto**: `bool deduplicated = 2;` added to `IngestSignalResponse`
(`packages/proto/ingest/v1/ingest.proto:119`) — additive, non-breaking (proto3 default `false` for
old clients); `./scripts/buf-gen.sh` regenerates stubs.

**6. Consumer surface (C-14) — `xstockstrat-agent`'s `ingest_signal` tool:**
`client.ingest_signal` (`services/xstockstrat-agent/app/client.py:186`) returns
`{"signal_id": resp.signal_id, "deduplicated": resp.deduplicated}`. `tools.py`'s auto-alert block
(`app/tools.py:263-294`) is guarded: the alert only fires `if not result.get("deduplicated") and
conviction is not None and conviction >= alert_threshold` (FR-4). The tool's own docstring
(`tools.py:250-251`, currently `"Returns {"signal_id": <int>} on success"`) is updated in the same
step — flagged by round 1's adversary as a real C-10/ledger-pattern gap (`fails.md` 2026-08-02,
mcp-tools-alignment-triage: a tool's docstring is a surface that mirrors its RPC contract and drifts
silently if not updated alongside it).

**7. Docs**: `services/xstockstrat-ingest/CLAUDE.md` (new config key row + `signal_dedup_keys`
table row), `docs/runbooks/mcp-tools.md`'s `ingest_signal` return-shape example (`{ "signal_id":
42, "deduplicated": false }`) and errors table, and
`services/xstockstrat-ingest/docs/context-constitution-findings.md`'s stale **"Dedup key" row
only** (line 12 — corrected now that the behavior exists, per the root CLAUDE.md Teardown rule and
AC-6). The adjacent line 11 ("9 dead `ingest.signals.*` config keys") is a *different*,
already-resolved claim (those keys are no longer even present in the current `CLAUDE.md` —
recon.md § Dependencies) — do not conflate the two rows or over-edit line 11.

**Reviewed, no change needed:** `xstockstrat-analysis`'s `fundsignal_loop.py` is a second real
`IngestSignal` caller (`services/xstockstrat-analysis/app/engine/fundsignal_loop.py:378-391`) with
its own pre-existing, complementary dedup at a different layer — `analysis.fundsignal_emitted`
(`(symbol, source, as_of_date)`) prevents same-day re-emission before `IngestSignal` is even
called, specifically because "ingest's `IngestSignal` does not dedup" (`fundsignal_loop.py:8-9`,
now stale prose worth a follow-up doc fix but out of scope for this feature — see Open Risks). It
only reads `resp.signal_id` (`fundsignal_loop.py:391`), so the additive `deduplicated` field is
fully backward compatible with no code change required. It is not named as a Consumer Surface
(C-14) — it's an internal batch job, not an end-user-reachable UI/tool — so it has no auto-alert
side effect analogous to the agent's that would need `deduplicated`-guarding.

## Rejected Alternatives

- **`SELECT ... FOR UPDATE` pre-check, then conditional `INSERT`** (round 1's initial variant) —
  rejected: a `SELECT ... FOR UPDATE` on a not-yet-existing row acquires no lock, so the first
  concurrent pair of submissions for a brand-new natural key would both pass the "no existing row"
  check — a genuine TOCTOU race the round-1 adversary correctly caught. The atomic `INSERT ...
  ON CONFLICT ... RETURNING` idiom closes this gap without an extra round-trip.
- **Time-bucketed dedup key** (e.g. truncating `claimed_at`/`valid_from` into the key itself) —
  rejected: two near-identical submissions straddling a bucket boundary would both be inserted
  (recon.md § Risks). A rolling `claimed_at < NOW() - window` comparison against an exact-match key
  has no boundary to straddle.
- **`valid_from`-anchored window** — rejected at the design gate: a source resending an old signal
  (`valid_from` far in the past) sharing a natural key with something recently claimed would be
  wrongly deduped under a `valid_from` reading, and duplicate `valid_from` values across genuinely
  distinct submissions are plausible (e.g. daily EOD signals at the same market-open placeholder
  time). Ingestion-time framing matches the feature's actual purpose (catching resubmission
  events) better than the signal's own business timestamp.
- **Narrow the dedup match to `(source, symbol, direction)` only, ignoring conviction/valid_until
  changes** (round 1's original proposal) — rejected at the design gate in favor of also requiring
  an exact match on `conviction`/`valid_until`: an operator updating an ongoing recommendation's
  confidence shouldn't have that update silently swallowed as a duplicate for up to 24h. Trade-off
  accepted: the dedup table carries two more columns and the claim SQL's `WHERE` clause is wider —
  judged worth it since a swallowed conviction update would suppress the very auto-alert this
  feature exists to make correct (FR-4).
- **Sequence-pregeneration claim-first** (round 1 adversary's suggested alternative — `nextval()`
  the `newsletter_signals` id sequence, claim before inserting the real row) — considered and not
  adopted: it would close the write-amplification cost of insert-then-rollback, but has no
  precedent anywhere in this codebase (recon confirmed), and the chosen `INSERT ... ON CONFLICT`
  approach is already fully race-safe without it — added complexity with no correctness payoff.
  Revisit only if duplicate-submission volume in practice makes the write amplification a real
  problem (see Open Risks).
- **Fuzzy/`raw_url`-based matching** — rejected per product-spec Out of Scope; exact-match only.

## Open Risks

- [ ] **Rollback-path correctness is subtle and must be unit-tested by row count, not just
  response fields.** The `_DuplicateSignal` sentinel must be raised *inside* the combined
  `async with self._db.acquire() as conn, conn.transaction():` block and caught *before* the
  generic `except Exception`. A refactor that moves the catch after the generic handler, or
  catches it inside the `async with` block "to keep it tidy," would silently defeat FR-1's "MUST
  NOT insert a second row" guarantee while still reporting `deduplicated=true` — the implementation
  step's test must assert `SELECT count(*) FROM ingest.newsletter_signals WHERE ...` stays at 1
  after a duplicate submission, not just check the response.
- [x] **RESOLVED (round 3 verdict)**: Write amplification is negligible at realistic scale.
  `ingest.signal_sources` ships with no seed data (`migrations/002_add_signal_sources_registry.up.sql`
  — sources are registered one-by-one at runtime via `ManageSignalSource`), so the actual live
  source count isn't grounded in a fixed number; the proto's source-name comment
  (`packages/proto/ingest/v1/ingest.proto:107`: `unusual_whales | marketwatch | dividendology |
  pure_power_picks | simply_wall_st`) names the known ones as an order-of-magnitude reference, not
  a hard count. What *is* grounded: the documented canonical ingestion pattern
  (`docs/runbooks/add-data-source.md:404-410`, "poll every 15 minutes → filter: new items only →
  ... → IngestSignal") already dedupes at the caller *before* `IngestSignal` is even reached for at
  least the RSS-sourced path, so resubmission of an identical natural key is the exception
  (retry-after-timeout, manual resend), not steady-state traffic. No action needed; the
  sequence-pregeneration alternative stays rejected (see Rejected Alternatives) unless production
  data later shows otherwise.
- [x] **RESOLVED (round 3)**: no test in this repo currently exercises an asyncpg
  `self._db.acquire() as conn, conn.transaction():` code path (confirmed — `xstockstrat-analysis`'s
  only other user of this exact idiom, `app/repositories/opportunities.py:48`, has no matching
  test either), and `xstockstrat-ingest`'s existing `IngestSignal` tests mock `svc._db.fetchrow`
  directly at the pool level (`tests/test_ingest_servicer.py:671-672` etc., house style confirmed
  by `test_backfill_jobs.py:3`'s "the asyncpg pool is mocked... without a DB" comment) — that
  pattern must be extended, not just reused as-is. **Also corrected**: an earlier draft of this
  risk proposed a literal `SELECT count(*) FROM ingest.newsletter_signals` row-count assertion as
  the rollback-correctness pin — not achievable given this repo's pure-mock test style (no DB
  fixture exists anywhere in `services/xstockstrat-ingest/tests/`, and `scripts/integration-test.sh`
  is confirmed unwired into CI and targets removed ports). The achievable, equally-strong pin is
  `test_dedup_hit_does_not_reach_generic_error_handler` in the Test Plan below — since
  `_DuplicateSignal` is itself an `Exception` subclass, a regression that reorders `except
  _DuplicateSignal` after a generic `except Exception` is caught precisely by asserting
  `context.abort`/`mark_source_error` are never called on a dedup hit, without needing a live DB.
  A reusable async-context-manager mock idiom already exists to build the `acquire()`/
  `transaction()` mocks from: `services/xstockstrat-agent/tests/test_client.py:71-75` (`cm =
  MagicMock(); cm.__aenter__ = AsyncMock(return_value=...); cm.__aexit__ = AsyncMock(return_value=False)`);
  house it in `services/xstockstrat-ingest/tests/_helpers.py` (already the shared-fixture home in
  this service, per its own docstring) rather than duplicating it across the four existing tests
  that need rewriting for the new call shape.

## Test Plan (rounds 2/3 — for `/sdd-spec`'s C-08 pairing; round 3 corrected the mocking approach)

**`services/xstockstrat-ingest/tests/test_ingest_servicer.py`** (extend `TestIngestSignal`,
`:603-719`; mock `svc._db.acquire()` as an async-context-manager stub yielding a `conn` mock with
`conn.fetchrow` `side_effect=[...]` for the two transaction statements, and `conn.transaction()`
as a no-op async context manager — see the resolved mocking risk above for the reusable idiom):

1. `test_dedup_hit_returns_existing_id_and_deduplicated_flag` — claim `fetchrow` returns `None`;
   the post-rollback `SELECT signal_id FROM ingest.signal_dedup_keys` (on `svc._db`, not `conn`)
   returns the existing id. Assert `resp.deduplicated is True` and `resp.signal_id` equals the
   *existing* id, not the fresh candidate id (AC-1).
2. `test_dedup_hit_does_not_reach_generic_error_handler` — **the rollback-correctness pin**
   (replaces the non-achievable live-row-count assertion): assert `context.abort` is never called
   and `mark_source_error` is never called on a dedup hit. Since `_DuplicateSignal` is itself an
   `Exception` subclass, this test fails loudly if a future refactor reorders `except
   _DuplicateSignal` after `except Exception` (that reordering would call `mark_source_error` +
   `context.abort(INTERNAL, ...)` instead of returning `deduplicated=True`).
3. `test_dedup_hit_skips_mark_source_fed_and_ledger_event` — `mark_source_fed` and
   `svc._ledger.AppendEvent` are not called on a dedup hit.
4. `test_dedup_hit_touches_last_seen_only` — `touch_source_last_seen` is called on the dedup path;
   `mark_source_fed`'s `signals_fed` bump is not.
5. `test_fresh_submission_outside_window_inserts_and_refreshes_claim` — mocked `claimed_at` older
   than `dedup_window_hours`; `deduplicated=False`, new `signal_id`, claim row refreshed (AC-2).
6. `test_fresh_submission_different_conviction_inserts_new_row` /
   `test_fresh_submission_different_valid_until_inserts_new_row` — same shape, varying
   conviction/valid_until instead of the window (AC-2, the `IS DISTINCT FROM` branches).
7. `test_fresh_submission_different_direction_inserts_new_row` — natural key itself differs
   (AC-2's "different direction" clause).
8. `test_dedup_window_hours_read_from_config` — `self._config.dedup_window_hours` flows into the
   claim statement's `$7` (FR-2).
9. `test_dedup_window_hours_falls_back_to_default_when_config_unreachable` — no config snapshot →
   falls back to `24` (mirrors the existing `test_backfill_max_concurrent_jobs_default`-style
   tests at `:835-841`) (AC-4).
10. Rewrite `test_success_inserts_and_returns_id` / `test_success_with_valid_until` /
    `test_db_error_aborts` / `test_ledger_error_is_swallowed` (`:668-719`) for the new
    `acquire()`/`transaction()` mock shape — regression coverage, not new behavior; extend
    `test_db_error_aborts`'s scenario to also cover a failure in the *claim* statement, not just
    the primary insert.

**`services/xstockstrat-agent/tests/test_tools.py`** (extend the existing `ingest_signal` test
block, `:220-297`):

11. `test_ingest_signal_suppresses_alert_when_deduplicated` — mock `client.ingest_signal` to
    return `{"signal_id": 7, "deduplicated": True}` with conviction above the alert threshold;
    assert `client.emit_alert` is **not** called (FR-4/AC-3; extends the existing
    `test_ingest_signal_auto_alert_above_threshold` pattern at `:248-273`).
12. Update `test_ingest_signal_auto_alert_above_threshold` (`:248`) so the mocked
    `client.ingest_signal` return explicitly includes `"deduplicated": False` — proves the new
    guard reads the key rather than accidentally passing via `.get()` truthiness on a missing key
    (regression guard so the new guard doesn't over-suppress).
13. `test_ingest_signal_returns_deduplicated_field_in_payload` — the tool's returned dict includes
    the new key end-to-end.

**`services/xstockstrat-agent/tests/test_client.py`**: no existing test covers
`client.ingest_signal` at all (confirmed absent both by recon.md § Codebase Map and independently
by round 3) — add `test_ingest_signal_maps_deduplicated_field`, the first-ever unit test of
`client.ingest_signal`, asserting a mocked stub's `resp.deduplicated` round-trips into the
returned dict.

Proto/config changes need no separate test step beyond `buf-gen.sh` (C-09); doc updates
(`CLAUDE.md`, `mcp-tools.md`, the tool docstring) are doc steps, not test-paired steps.
- [x] **RESOLVED (round 3)**: `mark_source_fed`'s STALE-health gap on repeated dedup hits is fixed
  by the new `touch_source_last_seen` sibling function (see Chosen Approach) — cheap (a two-line
  function + one call site), so adopted rather than left as an accepted risk.
- [ ] **`fundsignal_loop.py:8-9`'s docstring** ("ingest's `IngestSignal` does not dedup") goes stale
  the moment this feature ships — noted as a nice-to-have follow-up doc fix, not required by this
  feature's scope (that module's own dedup serves a different purpose — same-day re-emission
  avoidance for cache-call cost, not `IngestSignal`-level duplicate suppression) — to be addressed
  at an implementation step if trivial, otherwise a follow-up.
- [ ] Round 2 of the design debate ran without a live proposer/adversary subagent pair (both
  round-2 background agents did not return within a reasonable wait window); the orchestrator
  performed the round-2 synthesis and verification directly, including independently confirming
  the `INSERT ... ON CONFLICT` race-safety claim against the existing `fundsignal_emitted`
  precedent rather than asserting it unverified. Documented per **P-03** (no silent deviation) in
  `context.md`.

## Constitution Rules Touched

- `C-01` — honored by: every architectural claim above cites `recon.md`/`product-spec.md`
  `path:line`; no invented paths or symbols.
- `C-05` — honored by: new config key `ingest.signals.dedup_window_hours` follows
  `<service>.<category>.<key>`.
- `C-07` — honored by: migration numbered `009`, confirmed the next free number both locally and
  across all 43 remote branches (avoiding the numbering-race class of mistake recorded in
  `fails.md` 2026-07-29, `081-qa-capability`).
- `C-09` — to be honored at `/sdd-spec`/`/sdd-execute`: `buf lint` + `buf breaking` +
  `./scripts/buf-gen.sh` required for the `IngestSignalResponse` field addition.
- `C-10` — honored by: the `deduplicated` field is surfaced consistently everywhere
  `IngestSignalResponse` is consumed by an end-user-reachable surface — the agent tool's return
  value, its docstring, and `mcp-tools.md` all updated together (closing the exact gap the
  2026-08-02 `mcp-tools-alignment-triage` ledger entry warns about); the second real caller
  (`fundsignal_loop.py`) was explicitly checked and confirmed to need no change (not silently
  skipped).
- `C-14` — honored by: the Agent consumer surface (`ingest_signal` tool) is named and reached in
  the same feature, not deferred.
- `F-06` — honored by: no new DB pool; the transaction runs on `xstockstrat-ingest`'s existing
  pooled connection (`DB_POOL_MAX` unset, PgBouncer-pooled per root CLAUDE.md's Connection Pool
  Budget table) — an explicit multi-statement transaction on one acquired connection is compatible
  with PgBouncer transaction-mode pooling (the mode already assumed by this pool's config comment
  disabling asyncpg's prepared-statement cache, `app/main.py`).
- `F-07` — honored by: the dedup window is read via `ConfigWatcher`, never hardcoded.
- No Floor (`F-*`) breach identified by round 1's adversary or the orchestrator's round-2 review.
