# Recon: fix-ingest-poller-backfill

**Created**: 2026-10-22
**From**: product-spec.md
**Affected services**: xstockstrat-ingest (fix site), xstockstrat-config (`GetSecret` server, read-only)

---

## Objective

Fix four SEV-2 defects in `xstockstrat-ingest`, found by the 2026-10-20 debt-radar scan (D-09, D-34, D-42, D-59).
The `mcp_client` poller drops signals or stalls without recording an error, and backfill cancellation is not durable:
a job canceled while queued, or canceled before a restart, comes back as `RUNNING`, or is finalized as
`COMPLETED`/`PARTIAL`. The fix adds a guard around each item, an unambiguous rule for picking the result list, a
deadline on `GetSecret`, and cancel checks against the persisted job status. It needs no proto, migration or
config-key change.

## Codebase Map

- **`xstockstrat-ingest`** (Python 3.13, `grpc.aio`)
  - Entry point: `services/xstockstrat-ingest/app/main.py`. It runs the startup reconcile at `:66-78`, which calls
    `backfill_jobs.reconcile_interrupted`. Resume starts at `:117-119` with `servicer.resume_incomplete_jobs()`.
    The poll-loop task starts at `:124-127` with `run_mcp_client_loop`.
  - Poller (FR-1, FR-5, FR-6): `services/xstockstrat-ingest/app/engine/mcp_client_loop.py`
    - `log = logging.getLogger(__name__)` is at `:28`. `_DEFAULT_REQUEST_TIMEOUT_SECONDS = 30` is at `:31`.
    - `_extract_result_items` is at `:34-52`.
      - The first-list-wins bug is at `:41-44`.
      - A dict with no list value is wrapped as a single item at `:45`.
      - The text fallback at `:47-51` calls `json.loads` with no guard.
    - `_build_external_signal` is at `:68`. It reads `item["symbol"]`, `item["direction"]` and `item["conviction"]`
      by subscript (`:72-74`), so it raises `KeyError` when one is missing.
    - `poll_one_source` is at `:96-125`.
      - `config_json` keys are read at `:105-107`: `mcp_endpoint`, `mcp_tool`, `mcp_arguments`.
      - The bearer is resolved at `:116` with `await cfg_watcher.resolve_secret(key, user_id=owner)`.
      - The ingest loop at `:124-125` has no guard.
    - `run_one_cycle` is at `:128-152`.
      - The timeout is read at `:133-138`: `max(get_int("ingest.mcp_client.request_timeout_seconds", 30), 1)`.
      - The per-source `try/except Exception` is at `:143-152`. It logs and calls `mark_source_error(str(e))`, with
        a nested best-effort catch.
  - Config watcher (FR-5): `services/xstockstrat-ingest/app/config/watcher.py`
    - `get_int` is at `:112`. It returns `v.int_val or default`, so a stored 0 falls back to the default.
    - `get_int_present` is at `:120`.
    - `resolve_secret` is at `:146-164`. The `self._stub.GetSecret(...)` call at `:155-163` has no `timeout=`. Its
      metadata is `((HEADER_INTERNAL_CALLER, INGEST_INTERNAL_CALLER_ID),)`. It returns `(resp.value, resp.found)`.
    - Precedent for wrapping a timeout in the same file: `wait_for_snapshot` at `:95-102` uses `asyncio.wait_for`
      and re-raises `TimeoutError` as a `RuntimeError` with a message.
  - Servicer (FR-2, FR-3, FR-4): `services/xstockstrat-ingest/app/handlers/servicer.py`
    - `_backfill_sem` is at `:323`. It is read once at init from `self._cfg.backfill_max_concurrent_jobs`.
    - `_canceled_jobs: set[str]` is at `:326`. It is in-memory only.
    - `_run_backfill` is at `:488-524`.
      - `async with self._backfill_sem:` is at `:493`.
      - The `RUNNING` write at `:494-499` and the `ingest.backfill.running` emit at `:500-502` are unconditional.
      - The `data_kind` dispatch is at `:504-509`.
      - The `except Exception` at `:510-524` writes `FAILED` and emits failed plus an alert. It would overwrite
        `CANCELED` if anything raised after a cancel.
    - `_execute_fundamentals_backfill` is at `:526-560`.
      - It calls `self._marketdata.BackfillFundamentals(..., metadata=propagation_meta)` at `:532-539`.
      - The `COMPLETED`/`PARTIAL` `update_job` at `:544-551` is unconditional.
      - The `ingest.backfill.completed` emit is at `:552-560`.
    - `_finalize_backfill` is at `:649-659`. It returns early only when `job_id in self._canceled_jobs`, and
      discards the id from the set (`:657-659`).
    - `resume_incomplete_jobs` is at `:714-721`. It spawns one `asyncio.create_task(self._resume_job(job_id))` per
      job id and returns `len(job_ids)`.
    - `_resume_job` is at `:723-738`.
      - It fetches `row = backfill_jobs.get_job(...)` at `:724`, but never reads `row["status"]`.
      - The `RUNNING` write at `:734` is unconditional.
      - It passes `()` as `propagation_meta` at `:737-738`. Resume has no originating request.
    - `_run_chunks.run_one` is at `:755-760`. It skips a chunk only when the job id is in `_canceled_jobs`. This is
      the chunk-runner boundary for AC-3.
    - `CancelBackfill` is at `:869-909`.
      - It reads the persisted status with `get_job` (`:881`).
      - It allows only `QUEUED`/`RUNNING` (`:885-894`).
      - It runs `_canceled_jobs.add` (`:896`), then the `CANCELED` + `completed_at` write (`:897-902`), then the
        `ingest.backfill.canceled` emit with `self._propagation_meta(context)` (`:903-908`).
  - Repositories:
    - `app/repositories/backfill_jobs.py`
      - `update_job(db_pool, job_id, **fields)` is at `:59`. It is a column allow-list update.
      - `get_job` is at `:80-85` and returns a dict or `None`.
      - `reconcile_interrupted` is at `:123-144`. It flips every `RUNNING`/`QUEUED` job to `FAILED`. It leaves
        `CANCELED` alone.
    - `app/repositories/backfill_chunks.py`
      - `get_incomplete_chunks` is at `:101`.
      - `list_jobs_with_incomplete_chunks` is at `:143-150`. It selects distinct `job_id` from `backfill_chunks`
        where the status is PENDING or FAILED, with no join to `backfill_jobs`.
    - `app/repositories/signal_sources.py`: `mark_source_error(db_pool, user_id, slug, error)` is at `:107-114`.
  - Last migration: `014_contract_signal_ownership.up.sql` (`services/xstockstrat-ingest/migrations/`). Not needed.
  - Config-read pattern: `ConfigWatcher.get_int` / `get_int_present` (`watcher.py:112`, `:120`), plus `cfg`
    properties such as `backfill_max_concurrent_jobs` (`watcher.py:187`).
- **`xstockstrat-config`** (Node.js). Read-only for this feature.
  - `GetSecret` RPC: `packages/proto/config/v1/config.proto:35`. Its messages are at `:110` and `:117`.
  - Handler `getSecret`: `services/xstockstrat-config/src/grpc/configServiceImpl.ts:335-369`.
    - It has no server-side deadline.
    - An unset secret returns `{ value: '', found: false }` (`:353`).
    - A decrypt failure returns `INTERNAL` (`:362`).
    - A denied caller gets `PERMISSION_DENIED` (`:339`).
  - Ingest grant: `services/xstockstrat-config/src/grpc/authz.ts:120-125`
    (`callerID 'ingest'`, `keyPrefixes ['mcp_credential.']`, `peerSan 'xstockstrat-ingest'`).
  - Seed: `services/xstockstrat-config/migrations/025_ingest_mcp_client_keys.up.sql:34-39`
    (`('ingest', 'mcp_client.request_timeout_seconds', 'int', '30', …)`). The key is stored namespace-relative. See
    Risks.
  - Next free config migration is `031`. Not needed.

## Patterns to REUSE

- **FR-1 per-item guard.** Reuse the per-source isolation style already in `mcp_client_loop.py:143-152`: a
  `try/except Exception` plus `log.warning("mcp_client loop: …", slug, e)`. Add one summary `log` record per source
  per poll, carrying the slug and the skipped count. A test can assert on it with pytest `caplog`. Items the extractor
  drops (`McpClientExtractor.extract`, `:123`) keep their existing warning and are not counted.
- **FR-2 / FR-3 / FR-4 cancel gating.** Reuse the `backfill_jobs.get_job(...)["status"] ==
  ingest_pb2.BACKFILL_STATUS_CANCELED` check that `CancelBackfill` uses (`servicer.py:881-890`), together with the
  in-memory `_canceled_jobs` fast path (`:326`, `:657`, `:759`). The check sits at three places:
  - right after `async with self._backfill_sem:` and before the `RUNNING` write (`:493-494`);
  - before the fundamentals `update_job` and emit (`:544`);
  - before the `RUNNING` write in `_resume_job` (`:724-734`).
  No new column is needed.
- **FR-5 deadline.** Reuse the clamped `timeout` that `run_one_cycle` already computes (`mcp_client_loop.py:133-138`).
  Feature 244 will rewrite this value to an `int_positive` read. Two candidate mechanisms:
  - A gRPC `timeout=` kwarg on `GetSecret`. Feature 247 picked this mechanism for the agent sibling and rejected
    `asyncio.wait_for` (`docs/roadmap/features/247-fix-agent-getconfig-deadline/design.md:22`, `:162`). It raises
    `grpc.aio.AioRpcError` with `DEADLINE_EXCEEDED`, and that error's `str()` is not empty.
  - `asyncio.wait_for` re-raised with a message. This mirrors `wait_for_snapshot` (`watcher.py:95-102`). A bare
    `str(TimeoutError())` is empty, so the error must be wrapped with a message.
  Either way, the error reaches the existing per-source catch (`mcp_client_loop.py:145-148`), so the other sources
  still poll.
- **FR-6 error channel.** Raise from `_extract_result_items` / `poll_one_source`. The existing `run_one_cycle` guard
  already turns any exception into `mark_source_error(str(e))` (`:145-148`), so no new error plumbing is needed.
- **Test harness** (C-13 fixture homes):
  - `services/xstockstrat-ingest/tests/test_mcp_client_loop.py`:
    - `_FakeResult` `:19`, `_FakeMcpClient` `:26`, `_SelectiveMcpClient` `:43`;
    - `_FakeCfgWatcher` `:56`, `_PerOwnerCfgWatcher` `:202`, `_mcp_source` `:70`;
    - `test_source_failure_records_health_and_continues` `:171`, `test_resolve_secret_sends_exact_user_scope` `:283`.
  - `tests/test_mcp_client.py`: `_FakeSecretStub.GetSecret(self, request, metadata=None)` is at `:27`. It does not
    accept `timeout`, so the stub must be widened if the `timeout=` kwarg is chosen. `_watcher_with` is at `:33`.
  - `tests/test_ingest_servicer.py`: `make_servicer` `:31`, `test_resume_incomplete_jobs_returns_count` `:624`,
    `test_resume_job_redrives_incomplete_chunks` `:639`.
  - `tests/test_cancel_backfill.py`: `_make_servicer` `:21`, `tests._helpers.job_row`, `tests.conftest._ctx`.

## Existing Business Rules (preserve / extend)

- **PRESERVE** `@AC-3 @feature-166`, "Ingest resolves the bearer token via GetSecret and sends it as an
  Authorization header" (`services/xstockstrat-ingest/acceptance/mcp-client-signal-source.feature`). FR-5 bounds the
  call. The request, the `x-internal-caller` metadata and the Bearer header stay unchanged.
- **PRESERVE** `@AC-4 @feature-166`, "MCP tool result is parsed into ExternalSignals and ingested" (same suite). The
  bare list, `[item]` and `{"signals": …}` shapes, the field mapping and the second-cycle dedup must keep working
  under the FR-1 and FR-6 changes.
- **PRESERVE** `@AC-5 @feature-166`, "Unreachable endpoint records health without crashing the service" (same suite).
  Source-level `last_error`, degraded health and continuing to the next source all stay. FR-5 and FR-6 add new
  `last_error` causes. Items skipped under FR-1 alone do not set `last_error`.
- **PRESERVE** `@AC-35 @feature-224 @feature-225`, "Two users with the same mcp_client slug use their own
  credentials" (`docs/sdd/business-rules/platform.feature`). The FR-5 wrapper keeps `GetSecret(user_id=<owner>)`
  with exact scope and no global fallback.
- **PRESERVE** `@AC-9 @feature-224`, "Ingested signals belong to the source owner and dedup per owner"
  (`services/xstockstrat-ingest/acceptance/private-by-default-templates.feature`). Items ingested under FR-1 and
  FR-6 still carry `owner=owner` (`mcp_client_loop.py:125`).
- **PRESERVE** `@AC-6 @feature-198`, "Fundamentals backfill is a distinct data kind, not a timeframe"
  (`services/xstockstrat-ingest/acceptance/historical-fundamentals-backtest.feature`). FR-2 and FR-3 change
  cancellation only. The `data_kind` routing at `servicer.py:504-509` is unchanged.
- **PRESERVE** `@AC-1`, `@AC-3 @feature-173` (present-aware config reads,
  `services/xstockstrat-ingest/acceptance/fix-python-config-zero-trap.feature`). Any config read this fix touches
  must not reintroduce a falsy-zero default.
- **PRESERVE** `@AC-4`, `@AC-5`, `@AC-16 @feature-147` (`GetSecret` returns plaintext, `PERMISSION_DENIED` and
  `found=false`/`INTERNAL`; `services/xstockstrat-config/acceptance/config-secrets-and-scoping.feature`). The server
  contract is unchanged. A deadline error must stay distinct from "bearer not configured" (`found=false`,
  `mcp_client_loop.py:117-119`) and from `PERMISSION_DENIED`. Ingest never falls back to an unauthenticated call.
- **EXTEND (conditional)** `@AC-1 @feature-166` (REGISTER with `config_json {mcp_endpoint, mcp_tool}`, same
  mcp-client suite). This applies only if design adopts a per-source `result_key` in `config_json`. A source with no
  `result_key` must still register, and `@AC-6 @feature-166` (a missing `mcp_endpoint` is rejected
  `INVALID_ARGUMENT`) is preserved. `platform.feature` `@AC-32` (agent docs and strat-lab skill parity) then also
  applies as PRESERVE.
- No **CHANGE** was found. No existing suite guarantees that a backfill cancel is respected, that resume skips
  canceled jobs, or anything about `request_timeout_seconds`. This feature's `@AC-1`..`@AC-7` are net-new.

## Dependencies

- Proto/RPC: none changed. Ingest consumes `config.v1.GetSecret` (`packages/proto/config/v1/config.proto:35`) and
  `marketdata.BackfillFundamentals` (`servicer.py:532`) as they are.
- Migration: none. If design chose a status column instead (not recommended), the next number would be `015` in
  `services/xstockstrat-ingest/migrations/`, and `031` in config.
- Config keys: the existing `ingest.mcp_client.request_timeout_seconds`, seeded at
  `services/xstockstrat-config/migrations/025_ingest_mcp_client_keys.up.sql:34-39`. No new keys.
  - A FR-6 `result_key`, if adopted, is a `config_json` field. It is not a config-service key.
- Inter-service edges: ingest → config (`GetSecret`, gRPC 50060), already present; ingest → marketdata
  (`BackfillFundamentals` / `BackfillBars`), unchanged.
- Trace propagation (operator decision 2026-10-21, no C-03 waiver):
  - Request-derived backfill writes and emits keep using `propagation_meta`. This covers the new cancel-skip paths in
    `_run_backfill` and `_execute_fundamentals_backfill`, and any canceled/skipped emit there.
  - The poll loop and `_resume_job` have no originating request (`servicer.py:737-738` passes `()`), so they may
    mint their own context, carrying a trace id when one is available.
  - `resolve_secret` currently sends only `x-internal-caller` (`watcher.py:162`).
- New env vars / ports: none.

## Risks / Not-found

- **Key-form mismatch on `request_timeout_seconds`.** This is pre-existing, out of scope, and the cause is
  unconfirmed.
  - The reader asks for the full-dotted key `ingest.mcp_client.request_timeout_seconds` (`mcp_client_loop.py:135`).
    A test pins that choice: `test_cycle_reads_namespace_prefixed_request_timeout_key`, `test_mcp_client_loop.py:111`.
  - The snapshot is keyed by the raw `row.key` (`configServiceImpl.ts:188`, `:212`, `:240`).
  - The seed row is namespace-relative, `mcp_client.request_timeout_seconds` (`025_…up.sql:34`).
  - Migration 029, which heals bare keys to full-dotted, excludes the `ingest` namespace
    (`029_heal_config_keys_full_dotted.up.sql:28`).
  - The same split shows on the backfill keys: `005_ingest_backfill_chunking.up.sql:8` seeds them bare, while
    `watcher.py:187-210` reads them full-dotted.
  - The likely result is that the seeded value is never read, so the loop always uses the code default (30, which
    happens to equal the seed). FR-5 should bound `GetSecret` by the same `timeout` variable either way.
  - Flag for design or the operator, as a candidate for a separate defect report or for feature 244. Do not widen
    scope (How-to-Act #3).
- **Feature 244 overlap** (`implementation-ready`). It rewrites the `mcp_client_loop.py:133-138` read to
  `int_positive`, which does not yet exist in `app/`. Merge order is 244 first, then 261 rebases FR-5. Add the
  `merge-order.md` row at `/sdd-spec`. Feature 259 (`watcher.py` `_watch`) and the config-stream-resilience peer
  overlap with disjoint regions, so they need a rebase only.
- **`_run_backfill` blanket except** (`servicer.py:510-518`). It would write `FAILED` over `CANCELED` if any
  post-cancel code raised. Design must order the cancel checks so a canceled job never reaches it, or guard it.
- **`resume_incomplete_jobs` return count** (`:721`) includes canceled jobs today, and `test_ingest_servicer.py:624`
  asserts that count.
  - Option one: filter in `resume_incomplete_jobs`, or join in `list_jobs_with_incomplete_chunks`. This changes the
    count.
  - Option two: check in `_resume_job`. This keeps the count.
  Design picks one.
- **`_finalize_backfill`** relies only on the in-memory set (`:657`). After a restart, a canceled job that reached
  finalize would be overwritten. FR-4's early return in `_resume_job` prevents finalize from being reached.
- **`CancelBackfill` ordering race.** It does the in-memory add (`:896`) before the persisted write (`:897`). A runner
  that checks only the persisted status can briefly read `QUEUED`/`RUNNING`, so the check must consult both.
- **Doc drift (teardown).**
  - `services/xstockstrat-ingest/CLAUDE.md:106-107` and the comment at `app/main.py:66` both say "no automatic
    resume". But `resume_incomplete_jobs` is wired at `main.py:117-119`.
  - The comment at `main.py:117-118` says reconcile "only flips chunk-less jobs". But
    `reconcile_interrupted` (`backfill_jobs.py:136-143`) flips every `RUNNING`/`QUEUED` job regardless of chunks.
  - Reconcile both at landing (CLAUDE.md Teardown). Code comments are fixed only if this feature touches those lines.
- **FR-6 rule fork** (deferred to design):
  - a well-known key (`signals`/`items`);
  - the sole non-empty list;
  - a per-source `result_key` in `config_json`, which is a schema change for `manage_signal_source` and the
    `/config-ui` form.
  AC-7 (`{alerts, rows}`, two non-empty lists, no well-known key) must stay unselected under the chosen rule. The
  `json.loads` fallback (`:50`) can raise `JSONDecodeError`, which today becomes a source error.
- **`last_error` markers.** No stable substring exists yet for the FR-5 deadline error or the FR-6 ambiguous-shape
  error. Design pins both (AC-4, AC-7).
- **Ledger traps that apply:**
  - `fails.md` 2026-08-06 durable-observable-backfills: drive tests through the public or repo interface, not private
    attributes. Prefer `CancelBackfill` plus repo fakes over mutating `_canceled_jobs` directly.
  - `insights.md` (012 wire-fe-auth): capture request-scoped metadata before `asyncio.create_task`. This is relevant
    to any `propagation_meta` threading in `_run_backfill`.
- **Not found:**
  - No `result_key` or well-known-key handling.
  - No `int_positive` helper (pending feature 244).
  - No `timeout`/`wait_for` on `resolve_secret`.
  - No skipped-count log record.
  - No tests for AC-2, AC-3 or AC-6: queued-cancel, resume-of-canceled and fundamentals cancel-mid-run.

## Recommended Scope

These boundaries are advisory, as input to the grilling and to `/sdd-spec`. Each step is paired with its tests (C-08)
and red-before-green (P-06).

1. **FR-1 + FR-6 (poller parsing).** Edit `mcp_client_loop.py` only:
   - add the per-item guard and the skipped-count log record in `poll_one_source`;
   - add the selection rule and the ambiguous-shape raise in `_extract_result_items`, with a pinned marker.
   Tests go in `test_mcp_client_loop.py` (AC-1, AC-5, AC-7) and keep the existing `@AC-4 @feature-166` cases green.
2. **FR-5 (GetSecret deadline).** Change `watcher.py` `resolve_secret` to take a timeout and bound the call. Pass the
   clamped `timeout` from the `:116` call site. Widen `_FakeSecretStub` if the `timeout=` kwarg is chosen. Tests:
   AC-4, plus the existing `test_resolve_secret_sends_exact_user_scope`. Rebase onto feature 244.
3. **FR-2 + FR-3 + FR-4 (cancel durability).** Edit `servicer.py` only:
   - add a cancel check after the semaphore in `_run_backfill`;
   - add a pre-finalize check in `_execute_fundamentals_backfill`;
   - add a persisted-status early return in `_resume_job`.
   Tests go in `test_ingest_servicer.py` and `test_cancel_backfill.py` (AC-2 outline for bars and fundamentals, AC-3,
   AC-6).
4. **Teardown docs.** Reconcile the resume/reconcile wording in `services/xstockstrat-ingest/CLAUDE.md`, and record
   the key-form mismatch as a follow-up. Do not fix it here.
