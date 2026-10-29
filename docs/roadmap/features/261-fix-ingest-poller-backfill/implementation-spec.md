# Implementation Spec: fix-ingest-poller-backfill

**Status**: `pending`
**Created**: 2026-10-22
**Feature**: `docs/roadmap/features/261-fix-ingest-poller-backfill/feature.md`
**Total Steps**: 9
**Feature Branch**: `feature/fix-ingest-poller-backfill`

---

## Execution Summary

The fix follows design.md's Chosen Approach and build order: FR-6 + FR-1 (poller parsing, `mcp_client_loop.py`) →
FR-5 (`GetSecret` deadline, `watcher.py` + its call site) → FR-2/FR-3/FR-4 (cancel guards, `servicer.py`) → teardown
docs. Everything lands in `xstockstrat-ingest`; `xstockstrat-config` is read-only. No proto, migration, config-key or
`config_json` change (design.md § Chosen Approach; recon.md § Dependencies). Each code step is a `service` step
followed by its paired `test` step; both carry `red-green required`. `/sdd-execute` writes the paired test first and
shows it failing against the pre-implementation tree before it lands the `service` change (P-06,
`.claude/skills/sdd-execute/reference/tdd-gate.md`).

**Consumer surfaces (C-14).** The product spec names two surfaces: the `/config-ui` signal-sources health list and
the agent `list_signal_sources` / `manage_signal_source` / `get_backfill_status` / `cancel_backfill` tools. Both read
the persisted `signal_sources.last_error` / `signals_fed` and `backfill_jobs.status` rows that Steps 1, 3, 5 and 7
write correctly. No tool schema or UI component changes, because design rejected the per-source `result_key`
(design.md § Rejected Alternatives). So there are no `services/xstockstrat-ui/` or `services/xstockstrat-agent/`
steps. This is a recorded decision, not an omission. The surfaces are reached through the data they already read and
are smoke-checked on dev (product-spec § Acceptance Criteria).

### Scenario Coverage (C-15)

| Scenario | Covered by |
|---|---|
| `@AC-1 @FR-1` one failing item does not drop the rest | Step 4 |
| `@AC-2 @FR-2` queued cancel stays CANCELED (bars + fundamentals outline) | Step 8 |
| `@AC-3 @FR-4` canceled job not resumed after restart | Step 8 |
| `@AC-4 @FR-5` hung GetSecret bounded and recorded | Step 6 |
| `@AC-5 @FR-6` signal list found alongside another list | Step 2 |
| `@AC-6 @FR-3` fundamentals canceled mid-run not finalized | Step 8 |
| `@AC-7 @FR-6` ambiguous result shape recorded as error | Step 2 |
| `@AC-8 @FR-1` all-fail batch recorded as source error | Step 4 |

Durable rules that must stay green (recon.md § Existing Business Rules; design.md § Business Rules Touched):
`@AC-3/@AC-4/@AC-5 @feature-166`, `@AC-35 @feature-224 @feature-225`, `@AC-9 @feature-224`, `@AC-6 @feature-198`,
and `@AC-1/@AC-3 @feature-173`. They are covered by the existing tests that each `test` step re-runs in full. The
`@AC-4 @feature-166` EXTEND (a single signal object with a `tags` list is wrapped as one item) is asserted in Step 2.

## Step Dependencies

- Step 2 [test] covers Step 1 [service]; Step 4 [test] covers Step 3; Step 6 [test] covers Step 5; Step 8 [test]
  covers Step 7.
- Step 3 requires Step 1: both edit `poll_one_source` / `_extract_result_items` in the same file. FR-6 changes
  which list becomes `parsed`, and FR-1 then guards its iteration. They are sequenced to avoid self-conflict.
- Step 5 requires Step 3: Step 5 edits the `resolve_secret` call at `mcp_client_loop.py:116`, inside the function
  Step 3 reshapes.
- **Step 5 is coupled to feature 244** (`fix-python-config-stored-zero`, `implementation-ready`). 244 rewrites the
  `request_timeout_seconds` read at `mcp_client_loop.py:133-138` to an `int_positive` read. `int_positive` is
  **Not found** in `services/xstockstrat-ingest/app/` today (grep, 2026-10-22). If 244 has merged to `main-dev`
  first, rebase and pass 244's clamped value. If not, keep today's `max(get_int(...), 1)`. Either way the
  `timeout` variable Step 5 consumes is the value `run_one_cycle` already computes (design.md § FR-5).
  **Proposed `docs/roadmap/features/merge-order.md` row (WARN, 244 → 261):** `fix-ingest-poller-backfill` (blocked) |
  `fix-python-config-stored-zero` | shared `mcp_client_loop.py` timeout read, `watcher.py`, ingest tests and INGEST
  docs; 244 merges first, 261 rebases | No. Still **not written** (grep of `merge-order.md` finds no 244/261 row,
  2026-10-22): `/sdd-review impl-spec` was scoped to the feature directory. Tracked as an Open Thread in
  context.md; `/sdd-execute` must confirm 244's merge state before Step 5.
- **Consumer surfaces (C-14) — no-change decision, smoke-checked.** No `services/xstockstrat-ui/` or
  `services/xstockstrat-agent/` step and no deferral feature: both surfaces only read rows this fix writes (see
  § Execution Summary). Dev smoke-check after the integration PR deploys: (a) `/config-ui` signal-sources view shows
  the new `last_error` markers (`all <N> items failed`, `ambiguous result`, `GetSecret deadline exceeded`) for a
  failing source; (b) agent `list_signal_sources` returns the same `last_error`, and `cancel_backfill` on a QUEUED job
  followed by `get_backfill_status` reports `CANCELED`.
- Step 7 is independent of Steps 1–6 (a different file, `servicer.py`). It follows them only to match design's build
  order. Features 242 (`servicer.py:473`) and 260 (`servicer.py:1039-1066`) touch disjoint regions, so they need a
  rebase only.
- Step 9 [docs] requires Steps 1–8, because it documents the landed behavior and the O-3 test name.
- Integration PR (handled by `/sdd-execute`, C-16): promote `@AC-1`..`@AC-8` into
  `services/xstockstrat-ingest/acceptance/` and record the `@AC-4 @feature-166` EXTEND in
  `mcp-client-signal-source.feature`. `/sdd-sync` reconciles the stale main-dev `acceptance.feature`, which lacks
  AC-6..AC-8 (design.md § Open Risks).

---

### Step 1 — service: FR-6 unambiguous signal-list selection (`_select_signal_list`)

**Status**: `done`
**Service**: `xstockstrat-ingest`
**Files**:
- `services/xstockstrat-ingest/app/engine/mcp_client_loop.py` — modify

**Reviewers**: `xstockstrat-ingest` owner — signal normalization correctness, idempotent ingestion

**Codebase Evidence**:
- `_extract_result_items` is at `mcp_client_loop.py:34-52`. The first-list-wins dict branch is at `:41-45`:
  `for value in sc.values(): if isinstance(value, list): return value` then `return [sc]`. The text fallback at
  `:46-51` does `decoded = json.loads(text)` and `return decoded if isinstance(decoded, list) else [decoded]`.
  Confirmed by `sed -n 34,52p` (recon.md:26-29).
- The error channel already exists: `run_one_cycle`'s per-source `try/except Exception` at `:140-150` (the
  `except` at `:142`) calls `mark_source_error(servicer._db, src["user_id"], slug, str(e))` at `:145`
  (re-grepped 2026-10-29; was `:143-152`/`:148` before the 244/259 merges).
- `_select_signal_list` and any well-known-key handling are **Not found** (recon.md:245). The function is new, and
  there is no existing helper to reuse.

**TDD**: `red-green required`

**Covers**: —

**Instructions**:
1. Add a module-level `def _select_signal_list(d: dict) -> list:` directly above `_extract_result_items`. Apply
   design.md § FR-6's rules in this exact order:
   1. If `isinstance(d.get("signals"), list)`, return `d["signals"]`, even when it is empty.
   2. `candidates = sorted(k for k, v in d.items() if isinstance(v, list) and v and all(isinstance(x, dict) for x in v))`.
      If `len(candidates) == 1`, return `d[candidates[0]]`.
   3. If `len(candidates) >= 2`, `raise ValueError(f"ambiguous result: multiple candidate lists {candidates}")`.
      The pinned `last_error` marker is `ambiguous result`.
   4. If there are no candidates: when `d` has at least one list value, every list value is empty, and
      `"symbol" not in d`, return `[]`. Otherwise return `[d]`.
2. In `_extract_result_items`, replace the dict branch body (`:42-45`) with `return _select_signal_list(sc)`.
3. In the text fallback (`:50-51`), keep `json.loads(text)` unguarded, so a `JSONDecodeError` stays a source error.
   Then:
   - if `decoded` is a list, return it;
   - if it is a dict, return `_select_signal_list(decoded)`;
   - otherwise return `[decoded]`.
4. Update the `_extract_result_items` docstring (`:35-37`), because it currently says "a dict wrapping the list" and
   that wording describes the old rule. Keep it to two lines. The new rule is in `_select_signal_list`'s own
   one-line docstring.
5. Do not add plumbing. The raise reaches the existing `run_one_cycle` catch at `:140-150`. Do not touch
   `McpClientExtractor` (INGEST-6: extractors stay pure parsers).

**Verification**:
```bash
cd services/xstockstrat-ingest && grep -n "_select_signal_list\|ambiguous result" app/engine/mcp_client_loop.py \
  && uv run ruff check . && uv run ruff format --check .
```

---

### Step 2 — test: FR-6 selection rule (AC-5, AC-7, `@AC-4 @feature-166` EXTEND)

**Status**: `done`
**Service**: `xstockstrat-ingest`
**Files**:
- `services/xstockstrat-ingest/tests/test_mcp_client_loop.py` — modify

**Reviewers**: `xstockstrat-ingest` owner — signal normalization correctness, idempotent ingestion

**Codebase Evidence**:
- Fakes: `_FakeResult(items)` (`test_mcp_client_loop.py:22`) sets `structured_content = items` and
  `content = []`, so passing a dict drives the dict branch. Others: `_FakeMcpClient` `:29`, `_FakeCfgWatcher` `:59`,
  `_mcp_source` `:73` (re-grepped 2026-10-29; +3 drift).
- Existing pattern: `test_source_failure_records_health_and_continues` (`:208`) captures
  `mark_source_error(db, user_id, slug, error)` with `monkeypatch.setattr(loop, "mark_source_error", AsyncMock(side_effect=fake_mark_error))`
  (`:220`).
- `test_cycle_parses_and_ingests_signal` (`:87`) is the `@AC-4 @feature-166` bare-list case and must stay green.

**TDD**: `red-green required`. AC-5 fails on today's tree (first list `warnings: []` → zero ingests). AC-7 fails (it
ingests `alerts`, with no error). The tags case fails (today it returns `["ai"]`, so the extractor drops it).

**Covers**: `AC-5, AC-7`

**Instructions**: Add these async tests (the module already runs under `asyncio_mode = "auto"`, `pyproject.toml:33`),
each driving `loop.run_one_cycle` with `servicer._ingest_external_signal = AsyncMock(return_value=(1, False))`:
1. `test_ac5_signals_key_selected_alongside_other_list`: structured content
   `{"warnings": [], "signals": [{"symbol": "AAPL", "direction": "buy", "conviction": 0.7}]}`. Assert one ingest with
   `symbol == "AAPL"`, and no `mark_source_error` call.
2. `test_ac7_two_candidate_lists_records_ambiguous_error`: `{"alerts": [<MSFT item>], "rows": [<TSLA item>]}`.
   Assert `_ingest_external_signal` was not awaited, and that the captured error for the slug contains
   `"ambiguous result"`.
3. `test_single_signal_object_with_tags_is_wrapped`: `{"symbol": "AAPL", "direction": "buy", "conviction": 0.7,
   "tags": ["ai"]}` → one ingest whose `signal.tags == ["ai"]`. This is the `@AC-4 @feature-166` EXTEND. Add a
   `tags: []` variant that also ingests once.
4. `test_all_empty_envelope_returns_no_items_silently`: `{"results": [], "count": 0}` → no ingest, no
   `mark_source_error`, and (with `caplog`) no `mcp_client: skipping` extractor warning (O-2).
5. `test_sole_dict_list_selected`: `{"items": [<valid item>], "meta": ["x"]}` → one ingest. Rule 2 counts only
   all-dict lists.
6. `test_text_fallback_signals_envelope`: a result with `structured_content = None` and
   `content = [SimpleNamespace(text=json.dumps({"signals": [<valid item>]}))]` → one ingest. Build it inline as a
   one-off.
C-13: these item dicts have a single consumer (this module), so they stay inline and no fixture home is created.

**Verification**:
```bash
cd services/xstockstrat-ingest && uv run pytest tests/test_mcp_client_loop.py -q \
  && uv run pytest --cov=app --cov-fail-under=40 \
  && uv run ruff check . && uv run ruff format --check .
```

---

### Step 3 — service: FR-1 per-item guard, summary log, all-fail raise

**Status**: `done`
**Service**: `xstockstrat-ingest`
**Files**:
- `services/xstockstrat-ingest/app/engine/mcp_client_loop.py` — modify

**Reviewers**: `xstockstrat-ingest` owner — signal normalization correctness, idempotent ingestion

**Codebase Evidence**:
- The unguarded loop is at `mcp_client_loop.py:124-125`:
  `for item in parsed: await servicer._ingest_external_signal(_build_external_signal(slug, item), owner=owner)`.
- `_build_external_signal` subscripts `item["symbol"]` / `["direction"]` / `["conviction"]` at `:72-74`.
- The per-source isolation style to reuse is at `:140-150`:
  `except Exception as e: log.warning("mcp_client loop: source %s failed: %s", slug, e)` (`:142-143`).
- `log = logging.getLogger(__name__)` is at `:28`.
- A skipped-count log record is **Not found** (recon.md:248).

**TDD**: `red-green required`

**Covers**: —

**Instructions**: Replace the loop at `:124-125` with the following:
1. Initialize `ingested = 0`, `skipped = 0`, `first_err: Exception | None = None`.
2. For each `item` in `parsed`, run
   `try: await servicer._ingest_external_signal(_build_external_signal(slug, item), owner=owner); ingested += 1`.
   On `except Exception as e:`, log
   `log.warning("mcp_client loop: source %s item skipped: %s", slug, e)`, increment `skipped`, and keep `first_err`
   if it is still `None`.
3. After the loop, always emit one record:
   `log.info("mcp_client loop: source %s polled ingested=%d skipped=%d", slug, ingested, skipped)`. It goes **before**
   any raise.
4. `if parsed and skipped == len(parsed): raise RuntimeError(f"all {len(parsed)} items failed: {first_err}")`. The
   existing catch at `:140-150` records it as `last_error`. The pinned marker is `all <N> items failed`.
5. A partial failure must not call `mark_source_error`. `owner=owner` stays on every ingest (`@AC-9 @feature-224`).
   Items the extractor drops keep its warning and are not counted.

**Verification**:
```bash
cd services/xstockstrat-ingest && grep -n "item skipped\|polled ingested=\|items failed" app/engine/mcp_client_loop.py \
  && uv run ruff check . && uv run ruff format --check .
```

---

### Step 4 — test: FR-1 isolation and all-fail (AC-1, AC-8)

**Status**: `done`
**Service**: `xstockstrat-ingest`
**Files**:
- `services/xstockstrat-ingest/tests/test_mcp_client_loop.py` — modify

**Reviewers**: `xstockstrat-ingest` owner — signal normalization correctness, idempotent ingestion

**Codebase Evidence**:
- The same fakes as Step 2 (`test_mcp_client_loop.py:22-84`).
- The `mark_source_error` capture pattern is inside `test_source_failure_records_health_and_continues` (`:208`,
  `monkeypatch.setattr` at `:220`).
- `_mcp_source(slug=..., **over)` is at `:73-84`. Its default is `"user_id": "seed-user"` (`:75`), so pass
  `user_id="u-1"` through `over`.

**TDD**: `red-green required`. AC-1 fails today (item 3 is never ingested, and the source is marked errored). AC-8's
`all 1 items failed` marker and its summary record do not exist yet.

**Covers**: `AC-1, AC-8`

**Instructions**:
1. `test_ac1_one_failing_item_does_not_drop_batch(monkeypatch, caplog)`: three valid items (AAPL, MSFT, TSLA), and
   `servicer._ingest_external_signal = AsyncMock(side_effect=[(1, False), RuntimeError("boom"), (3, False)])`.
   Assert:
   - 3 awaits, and items 1 and 3 were ingested with `owner == "u-1"`;
   - no `mark_source_error` call;
   - `caplog` (level INFO, logger `app.engine.mcp_client_loop`) has a record whose message contains `src-a` and
     `skipped=1`.
2. `test_ac8_all_items_failed_records_last_error(monkeypatch, caplog)`: one valid item, and the ingest raises
   `RuntimeError("boom")`. Assert:
   - the captured error for `src-a` contains `"all 1 items failed"`;
   - the `skipped=1` summary record appears in `caplog.records` **before** the `"source %s failed"` warning that
     `run_one_cycle` logs (compare record indices).
3. Re-run the whole module, so `test_source_failure_records_health_and_continues` (`@AC-5 @feature-166`) and
   `test_second_identical_cycle_deduplicates` (`:166`) stay green.
C-13: single consumer, so the data stays inline.

**Verification**:
```bash
cd services/xstockstrat-ingest && uv run pytest tests/test_mcp_client_loop.py -q \
  && uv run pytest --cov=app --cov-fail-under=40 \
  && uv run ruff check . && uv run ruff format --check .
```

---

### Step 5 — service: FR-5 GetSecret deadline with DEADLINE_EXCEEDED translation

**Status**: `pending`
**Service**: `xstockstrat-ingest`
**Files**:
- `services/xstockstrat-ingest/app/config/watcher.py` — modify
- `services/xstockstrat-ingest/app/engine/mcp_client_loop.py` — modify

**Reviewers**: `xstockstrat-ingest` owner — signal normalization correctness; Security — `GetSecret` gated by
`x-internal-caller`, and a deadline error must not log the bearer or key material (feature.md triage snapshot)

**Codebase Evidence**:
- `async def resolve_secret(self, key: str, user_id: str = "") -> tuple[str, bool]:` is at `watcher.py:150`. The
  call `resp = await self._stub.GetSecret(config_pb2.GetSecretRequest(...), metadata=((HEADER_INTERNAL_CALLER, INGEST_INTERNAL_CALLER_ID),))`
  is at `:159-167`, with no `timeout=`. It returns `resp.value, resp.found` at `:168` (re-grepped 2026-10-29).
- `import grpc` is at `watcher.py:10`. `grpc.aio.AioRpcError` is **no longer referenced anywhere in `watcher.py`**:
  feature 259 replaced the `_watch` catch with a generic `except Exception` (`:103`). The `except
  grpc.aio.AioRpcError` this step adds is therefore the file's only one; `import grpc` already covers it.
- Call site: `bearer, found = await cfg_watcher.resolve_secret(key, user_id=owner)` at `mcp_client_loop.py:116`.
  `timeout_seconds` is already a `poll_one_source` parameter (`:97`). **Feature 244 has merged** into main-dev
  (`code-completed`): `run_one_cycle` now computes `timeout = int_positive(cfg_watcher,
  "ingest.mcp_client.request_timeout_seconds", _DEFAULT_REQUEST_TIMEOUT_SECONDS)` at `:133-135`, so this step takes
  the "pass 244's clamped value" branch of § Step Dependencies. The 244 -> 261 row now exists at
  `docs/roadmap/features/merge-order.md:82`.
- Precedent: feature 247 chose the gRPC `timeout=` kwarg over `asyncio.wait_for`
  (`docs/roadmap/features/247-fix-agent-getconfig-deadline/design.md:22`, `:162`; design.md § Rejected
  Alternatives).
- Header propagation: this step adds **no new outbound call**. It bounds the existing one. Its metadata stays
  `x-internal-caller` only, which is the O-5 cost decision recorded in context.md § sdd-design Decisions (C-03
  argued, no waiver).

**TDD**: `red-green required`

**Covers**: —

**Instructions**:
1. `watcher.py`:
   - change the signature to `async def resolve_secret(self, key: str, user_id: str = "", timeout: float | None = None)`;
   - pass `timeout=timeout` to `self._stub.GetSecret(...)`, keeping the request and metadata byte-for-byte;
   - wrap the call in `try/except grpc.aio.AioRpcError as e:`. If `e.code() == grpc.StatusCode.DEADLINE_EXCEEDED`,
     `raise RuntimeError(f"GetSecret deadline exceeded after {timeout}s") from e`. Otherwise `raise` unchanged, so
     `PERMISSION_DENIED`, `INTERNAL` and `found=false` behave as before (`@AC-4/@AC-5/@AC-16 @feature-147`).
   The message must not include `key` or any value (Security). The pinned marker is `GetSecret deadline exceeded`.
   Add one docstring line stating the timeout bound.
2. `mcp_client_loop.py:116`: change to
   `await cfg_watcher.resolve_secret(key, user_id=owner, timeout=float(timeout_seconds))`. Do not change 244's
   `int_positive` timeout read at `:133-135`; `timeout_seconds` already carries its clamped value. Do not fall back
   to an unauthenticated fetch.

**Verification**:
```bash
cd services/xstockstrat-ingest && grep -n "timeout=timeout\|GetSecret deadline exceeded\|DEADLINE_EXCEEDED" app/config/watcher.py \
  && grep -n "resolve_secret(key, user_id=owner, timeout=" app/engine/mcp_client_loop.py \
  && grep -n "HEADER_INTERNAL_CALLER, INGEST_INTERNAL_CALLER_ID" app/config/watcher.py \
  && uv run ruff check . && uv run ruff format --check .
```

---

### Step 6 — test: FR-5 deadline bounded and recorded (AC-4)

**Status**: `pending`
**Service**: `xstockstrat-ingest`
**Files**:
- `services/xstockstrat-ingest/tests/test_mcp_client.py` — modify
- `services/xstockstrat-ingest/tests/test_mcp_client_loop.py` — modify

**Reviewers**: `xstockstrat-ingest` owner — signal normalization correctness; Security — no secret material in the
deadline error

**Codebase Evidence**:
- `_FakeSecretStub.GetSecret(self, request, metadata=None)` is at `test_mcp_client.py:27`. It does not accept
  `timeout`, so it must be widened. `_watcher_with(stub)` is at `:33`. Both are imported by
  `test_mcp_client_loop.py:19` (re-grepped 2026-10-29).
- These fakes override `resolve_secret(self, key, user_id="")`: `_FakeCfgWatcher` at `test_mcp_client_loop.py:68`
  and `_PerOwnerCfgWatcher` at `:247`. Both must accept `timeout=None`, or the Step 5 call site raises `TypeError`.
- An inline `AioRpcError` builder already exists:
  `grpc.aio.AioRpcError(grpc.StatusCode.INVALID_ARGUMENT, grpc.aio.Metadata(), grpc.aio.Metadata(), details=...)`
  (`tests/test_ingest_servicer.py:552`).
- `test_resolve_secret_sends_exact_user_scope` (`test_mcp_client_loop.py:320`) is `@AC-35 @feature-224` and must stay
  green.

**TDD**: `red-green required`. On today's tree the AC-4 test fails. The hanging stub is never bounded (the outer
`asyncio.wait_for` hang guard trips), and no `GetSecret deadline exceeded` error is recorded.

**Covers**: `AC-4`

**Instructions**:
1. Widen `_FakeSecretStub.GetSecret(self, request, metadata=None, timeout=None)` and record `self.last_timeout`.
   Widen `_FakeCfgWatcher.resolve_secret` and `_PerOwnerCfgWatcher.resolve_secret` with `timeout=None`.
2. `test_mcp_client.py`: add `test_resolve_secret_passes_timeout_and_translates_deadline`.
   - A `_FakeSecretStub` subclass raises `grpc.aio.AioRpcError(grpc.StatusCode.DEADLINE_EXCEEDED, ...)`.
   - Assert that `pytest.raises(RuntimeError, match="GetSecret deadline exceeded")` fires, that `__cause__` is the
     `AioRpcError`, and that the message does not contain the key.
   - Add a `PERMISSION_DENIED` variant that still raises `AioRpcError` (untranslated).
3. `test_mcp_client_loop.py`: add `test_ac4_hung_getsecret_is_bounded_and_recorded`.
   - Set `request_timeout_seconds` to 2, but build the watcher with `_watcher_with(stub)`, where the stub's
     `GetSecret` asserts `timeout == 2.0`, runs `await asyncio.sleep(timeout)`, then raises `DEADLINE_EXCEEDED`
     (O-7). The read now goes through 244's `int_positive(cfg_watcher, key, default)`, which calls
     `cfg_watcher.get_int`; monkeypatch `get_int` on the watcher instance (`_watcher_with` bypasses `__init__`).
   - Use two sources, `src-a` (hangs) and `src-b` (resolves). Key the stub on `request.key` or `request.user_id`.
   - Wrap `run_one_cycle` in `asyncio.wait_for(..., timeout=10)` (feature 247's outer hang guard).
   - Assert that the captured error for `src-a` contains `"GetSecret deadline exceeded"`, and that `src-b` was
     fetched by `_FakeMcpClient`.
4. C-13 (O-6): if the `DEADLINE_EXCEEDED` builder is used by **both** test modules, move it to
   `tests/_helpers.py` next to `job_row` (add that file to this step's commit) and record the new home in context.md.
   Otherwise keep it inline in the single consumer.

**Verification**:
```bash
cd services/xstockstrat-ingest && uv run pytest tests/test_mcp_client.py tests/test_mcp_client_loop.py -q \
  && uv run pytest --cov=app --cov-fail-under=40 \
  && uv run ruff check . && uv run ruff format --check . \
  && grep -rn "DEADLINE_EXCEEDED" tests/
```

---

### Step 7 — service: FR-2/FR-3/FR-4 cancel guards and resumed-job trace id

**Status**: `pending`
**Service**: `xstockstrat-ingest`
**Files**:
- `services/xstockstrat-ingest/app/handlers/servicer.py` — modify

**Reviewers**: `xstockstrat-ingest` owner — idempotent ingestion, backfill lifecycle correctness

**Codebase Evidence**:
- `self._canceled_jobs: set[str] = set()` is at `servicer.py:326`.
- `_run_backfill`:
  - `async with self._backfill_sem:` is at `:493`;
  - the unconditional RUNNING `update_job` is at `:494-499`, and the `ingest.backfill.running` emit at `:500-502`;
  - the blanket `except Exception as e:` at `:510-524` writes FAILED at `:512-518`.
- `_execute_fundamentals_backfill`: `resp = await self._marketdata.BackfillFundamentals(...)` is at `:532-539`, and
  the unconditional COMPLETED/PARTIAL `update_job` is at `:544-551`.
- `_finalize_backfill`'s existing guard is at `:657-659`:
  `if job_id in self._canceled_jobs: self._canceled_jobs.discard(job_id); return`. This is the discard-and-return
  pattern to mirror.
- `_resume_job` (`:723-738`):
  - `row = await backfill_jobs.get_job(self._db, job_id)` is at `:724`;
  - the unconditional RUNNING write is at `:734`;
  - `()` metadata is passed at `:737-738`.
- `import uuid` is at `:11`.
- `CancelBackfill` runs `self._canceled_jobs.add(request.job_id)` at `:896` before the only
  `BACKFILL_STATUS_CANCELED` write in `app/` (`:900`; `grep -rn BACKFILL_STATUS_CANCELED app` → one hit).
- `instance_count: 1` is set for ingest (`.do/app.yaml:238`, design.md).

**TDD**: `red-green required`

**Covers**: —

If execution of this step grows large, split item 5 (resumed-job trace-id minting, C-03) into its own step; it is a
distinct behavior covered by `test_resume_job_sends_minted_trace_id` (Step 8). Record any split in the Deviation Log.

**Instructions**: Each check is synchronous. Put no `await` between a check and the write it guards (design.md
§ FR-2/3/4).
1. **FR-2.** Make this the first statement inside `async with self._backfill_sem:` (before `:494`):
   `if job_id in self._canceled_jobs:` → `self._canceled_jobs.discard(job_id)`;
   `log.info("backfill job %s canceled while queued; not starting", job_id)`; `return`.
   **Do NOT add a DB read before the RUNNING write.** This is the accepted FR-2 window (design.md § Accepted FR-2
   window).
2. **FR-3.** In `_execute_fundamentals_backfill`, between `failed = list(resp.failed_symbols)` (`:540`) and
   `update_job` (`:544`), add the same check:
   `if job_id in self._canceled_jobs:` → discard; log `"fundamentals backfill job %s canceled mid-run; not finalizing"`;
   `return`. This means no COMPLETED/PARTIAL write and no `.completed` emit.
3. **Blanket except.** Make this the first statement in `except Exception as e:` (`:510`), before the FAILED write:
   `if job_id in self._canceled_jobs:` → discard; log; `return`.
4. **FR-4.** In `_resume_job`, after the `row is None` return (`:725-726`) and before the RUNNING write (`:734`):
   `if row["status"] == ingest_pb2.BACKFILL_STATUS_CANCELED:` →
   `log.info("skipping resume of canceled job %s", job_id)`; `return`. This is the only persisted-status check. Do
   not change `resume_incomplete_jobs` or its count (`test_ingest_servicer.py:640` stays green; design.md § Rejected
   Alternatives: join filter).
5. **Trace (C-03, operator 2026-10-21).** In `_resume_job`, mint `meta = (("x-trace-id", str(uuid.uuid4())),)` once
   per resumed job, after the FR-4 check, and pass `meta` instead of `()` to `_run_chunks` and `_finalize_backfill`
   (`:737-738`). Request-derived paths keep their captured `propagation_meta`. Add no new events.
6. Leave `_finalize_backfill`, `run_one` (`:755-760`) and the `data_kind` dispatch at `:504-509`
   (`@AC-6 @feature-198`) untouched.
7. Add a ≤2-line comment at the FR-2 guard stating the constraint: the guards rely on single-instance ingest and on
   `CancelBackfill` adding to `_canceled_jobs` before its CANCELED write.

**Verification**:
```bash
cd services/xstockstrat-ingest && grep -n "_canceled_jobs" app/handlers/servicer.py \
  && grep -n "skipping resume of canceled job\|x-trace-id\", str(uuid.uuid4())" app/handlers/servicer.py \
  && uv run ruff check . && uv run ruff format --check .
```

---

### Step 8 — test: cancel durability (AC-2 outline, AC-3, AC-6) + O-3 ordering guard

**Status**: `pending`
**Service**: `xstockstrat-ingest`
**Files**:
- `services/xstockstrat-ingest/tests/test_ingest_servicer.py` — modify

**Reviewers**: `xstockstrat-ingest` owner — idempotent ingestion, backfill lifecycle correctness

**Codebase Evidence**:
- `make_servicer(db=None, *, max_concurrent=5, ...)` is at `test_ingest_servicer.py:34`. It builds the real
  `asyncio.Semaphore` from `max_concurrent` (re-grepped 2026-10-29).
- Helpers:
  - `_REPO = "app.repositories.backfill_jobs"` `:104` and `_CHUNKS` `:424`;
  - `_mk_backfill_resp` `:107`, `_make_backfill_req` `:427`, `_chunk` `:438`, `patch_chunk_repo` `:448`;
  - `_mk_fund_resp` `:1726`, `_make_fund_req` `:1733`.
- `tests._helpers.job_row(job_id, status, **over)` is at `tests/_helpers.py:60` and is **already imported** into
  `test_ingest_servicer.py` as the alias `_job_row` (`:26`); reuse that alias and add no second import.
  `tests.conftest._ctx` is imported at `test_cancel_backfill.py:16`. `_ctx("4")` is an admin context.
- Existing resume tests: `test_resume_incomplete_jobs_returns_count` `:640`, `test_resume_job_redrives_incomplete_chunks` `:655`.
- Ledger trap: drive through `CancelBackfill` plus repo fakes, not by mutating `_canceled_jobs`. Do not copy the
  private-set assertion at `test_cancel_backfill.py:52` (`fails.md` 2026-08-06; design.md § Tests).

**TDD**: `red-green required`. On today's tree job-B is written RUNNING and its RPC is called (AC-2), the canceled
job is resumed (AC-3), and job-D is written COMPLETED (AC-6). The O-3 test passes today. It is a regression guard,
and its RED is shown by temporarily reordering `:896` (set-add) after the `:897-902` CANCELED `update_job` during the
TDD gate. `/sdd-execute` must capture that red run's output in context.md, then restore the order (P-06).

**Covers**: `AC-2, AC-3, AC-6`

**Instructions**: Add a `class TestCancelDurability` with these tests:
1. `test_ac2_queued_cancel_never_runs[bars|fundamentals]` (`pytest.mark.parametrize` over the outline's two
   Examples).
   - `svc = make_servicer(db=MagicMock(), max_concurrent=1)`.
   - job-A is a bars job whose `BackfillBars` awaits an `asyncio.Event` before returning `_mk_backfill_resp`.
   - Start `asyncio.create_task(svc._run_backfill("job-A", ...))` and then `svc._run_backfill("job-B", <bars req | _make_fund_req>)`,
     and yield until job-B is blocked on the semaphore.
   - Call `await svc.CancelBackfill(ingest_pb2.CancelBackfillRequest(job_id="job-B"), _ctx("4"))`, with `get_job`
     returning `_job_row("job-B", BACKFILL_STATUS_QUEUED)` and then the CANCELED row.
   - Set the event, and await both tasks.
   - Assert:
     - no `update_job` call for `job-B` with `status=BACKFILL_STATUS_RUNNING`, and the last job-B status write is
       CANCELED;
     - no `AppendEvent` whose payload is `ingest.backfill.running` for `job-B`;
     - `BackfillBars` was never called with job-B's symbols, and `BackfillFundamentals.assert_not_called()` holds.
2. `test_ac3_canceled_job_not_resumed_after_restart`.
   - Patch `list_jobs_with_incomplete_chunks` → `["job-C"]` and `get_job` → `_job_row("job-C", BACKFILL_STATUS_CANCELED)`.
   - Run with `_canceled_jobs` empty (fresh servicer = restart), and `await svc._resume_job("job-C")` directly. Also
     run `resume_incomplete_jobs()` and drain the created task.
   - Assert that `update_job` is never awaited, that `get_incomplete_chunks` / `mark_chunk_running` /
     `BackfillBars` are never awaited, and that `resume_incomplete_jobs()` still returns 1 (count unchanged).
3. `test_ac6_fundamentals_canceled_mid_run_stays_canceled`.
   - `BackfillFundamentals` awaits an event.
   - While it is in flight, call `CancelBackfill("job-D")` (`get_job` → RUNNING then CANCELED). Then release the
     event, which returns `_mk_fund_resp(11, [])`.
   - Assert there is no `update_job` with COMPLETED/PARTIAL for job-D and no `ingest.backfill.completed` emit.
   - Assert the `GetBackfillStatus` read (CANCELED `get_job` row) reports `BACKFILL_STATUS_CANCELED`.
4. `test_o3_cancel_registers_set_before_canceled_write` (the O-3 guard).
   - Patch `update_job` with a fake that asserts `"j1" in svc._canceled_jobs` whenever `status == BACKFILL_STATUS_CANCELED`
     arrives.
   - Call `CancelBackfill`. A future reorder or a second CANCELED writer then fails CI. The test name is cited by the
     Step 9 invariant.
5. `test_resume_job_sends_minted_trace_id`.
   - Extend the `test_resume_job_redrives_incomplete_chunks` setup (RUNNING row).
   - Assert that `BackfillBars.await_args.kwargs["metadata"]` contains an `x-trace-id` entry with a non-empty value.
6. Keep `test_resume_incomplete_jobs_returns_count` (`:640`) and `test_resume_job_redrives_incomplete_chunks` (`:655`)
   unchanged and green.
C-13: `job_row` is reused from `tests/_helpers.py` via the existing `_job_row` alias. The event-gated marketdata fakes are scenario one-offs and stay
inline.

**Verification**:
```bash
cd services/xstockstrat-ingest && uv run pytest tests/test_ingest_servicer.py tests/test_cancel_backfill.py -q \
  && uv run pytest --cov=app --cov-fail-under=40 \
  && uv run ruff check . && uv run ruff format --check . \
  && grep -n "from tests._helpers import job_row as _job_row" tests/test_ingest_servicer.py
```

---

### Step 9 — docs: teardown (resume drift, single-instance invariant, findings)

**Status**: `pending`
**Service**: `docs` (`services/xstockstrat-ingest/` docs + `docs/reports/`)
**Files**:
- `services/xstockstrat-ingest/CLAUDE.md` — modify
- `services/xstockstrat-ingest/docs/context-constitution.md` — modify
- `services/xstockstrat-ingest/docs/context-constitution-findings.md` — modify

**Reviewers**: none

**Codebase Evidence**:
- `services/xstockstrat-ingest/CLAUDE.md:104-107` says "On startup the servicer reconciles any job left
  `RUNNING`/`QUEUED` … to `FAILED` (… FR-3 — no automatic resume)". But `resume_incomplete_jobs` is wired at
  `app/main.py:117-119` and defined at `servicer.py:714-721` (recon.md:224-229).
- Comment drift (logged in findings, `main.py` itself untouched):
  - `app/main.py:66` says "no automatic resume";
  - `app/main.py:117-118` says reconcile "only flips chunk-less jobs", while `reconcile_interrupted`
    (`backfill_jobs.py:123-144`) flips every RUNNING/QUEUED job.
- `docs/context-constitution.md`: the Rules table ends at `INGEST-9` (`:28`), and `## Gotchas & scars` is at `:30`.
- Key-form mismatch:
  - the seed rows `('ingest', 'mcp_client.request_timeout_seconds', …)` are at
    `services/xstockstrat-config/migrations/025_ingest_mcp_client_keys.up.sql:34-36` (staging) and `:37-39`
    (production), both with the bare key;
  - config's `reloadNamespace` keys the snapshot by the raw `row.key`
    (`services/xstockstrat-config/src/grpc/configServiceImpl.ts:203-213`), and ingest's `get_int` does
    `self._snapshot.values.get(key)` (`app/config/watcher.py:112-118`), so the dotted read misses both rows;
  - the dotted read is at `mcp_client_loop.py:134` (now via 244's `int_positive`);
  - migration 029 excludes the `ingest` namespace (`029_heal_config_keys_full_dotted.up.sql:28`);
  - it is out of scope here (recon.md:194-207; design.md § Open Risks).
- **The key-form defect is already filed**: `docs/reports/2026-10-22-ingest-seeded-config-keys-never-read-defect.md`
  covers `mcp_client.request_timeout_seconds` plus four other ingest keys. Its `.status` sidecar reads `wont-fix`,
  `ref: feature:277-fix-ingest-seeded-config-keys`, and 277 is `demoted/canceled` (operator, 2026-10-23). A new
  report would duplicate it, so this step files none (re-spec 2026-10-29).

**TDD**: `N/A (docs)`

**Covers**: —

**Instructions**:
1. `CLAUDE.md`: rewrite the backfill-jobs sentence at `:104-107`. Startup reconciles RUNNING/QUEUED jobs to FAILED,
   and then `resume_incomplete_jobs` re-drives jobs that still have PENDING/FAILED chunks, skipping a persisted
   `CANCELED` job (FR-4). Also note that a job canceled while `QUEUED` never starts.
2. `context-constitution.md`: add **INGEST-10**, stating that backfill cancel guards rely on the in-memory
   `_canceled_jobs` set. That holds only with single-instance ingest (`.do/app.yaml` `instance_count: 1`) and with
   `CancelBackfill` as the sole CANCELED writer, adding to the set before its write. Evidence: `servicer.py#CancelBackfill`,
   with the guard test `tests/test_ingest_servicer.py#test_o3_cancel_registers_set_before_canceled_write`. Scaling
   ingest past one instance re-opens D-34.
3. `context-constitution-findings.md`: add a "Documentation that lies" row for the `main.py:66` and `:117-118`
   comment drift, with the suggested action "fix when `main.py` is next touched".
4. Do **not** file a new key-form defect report. In the findings entry, cite the existing
   `docs/reports/2026-10-22-ingest-seeded-config-keys-never-read-defect.md` (`wont-fix`; feature 277
   demoted/canceled 2026-10-23) as the record that the seeded bare `mcp_client.request_timeout_seconds` rows are
   never read, so the timeout FR-5 passes to `GetSecret` is effectively the 30 s code default.
5. Run `/context-forge:context-constitution refresh` scoped to the touched ingest docs. If the plugin is
   unavailable, do the manual reconciliation and record it in the PR body (root CLAUDE.md § Teardown).

**Verification**:
```bash
grep -n "resume_incomplete_jobs\|CANCELED" services/xstockstrat-ingest/CLAUDE.md \
  && grep -n "INGEST-10" services/xstockstrat-ingest/docs/context-constitution.md \
  && grep -n "main.py" services/xstockstrat-ingest/docs/context-constitution-findings.md \
  && grep -n "ingest-seeded-config-keys-never-read-defect" services/xstockstrat-ingest/docs/context-constitution-findings.md \
  && ! ls docs/reports/2026-10-22-ingest-mcp-client-timeout-seed-key-form-defect.md 2>/dev/null
```

---

## Deviation Log

_Populated by /sdd-execute as implementation proceeds._
