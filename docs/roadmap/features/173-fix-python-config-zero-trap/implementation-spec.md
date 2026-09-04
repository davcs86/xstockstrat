# Implementation Spec: fix-python-config-zero-trap

**Status**: `pending`
**Created**: 2026-09-04
**Feature**: `docs/roadmap/features/173-fix-python-config-zero-trap/feature.md`
**Total Steps**: 6
**Feature Branch**: `feature/fix-python-config-zero-trap`

---

## Execution Summary

A targeted **add-not-replace** port of the `HasField`-based present-aware config accessors, scoped to
exactly the confirmed 0/empty-meaningful keys in two services (per `design.md` § Chosen Approach).
Ingest is done first (the real SEV-2 bug: `max_retry_attempts=0` and `dedup_window_hours=0` are
silently swallowed): Step 1 adds `get_int_present` to the ingest watcher and re-points the two keys,
Step 2 extracts the `_effective_max_attempts()` seam that makes the retry consumer RED-provable
without the 14s backoff, and Step 3 is their paired regression test. Indicators is second (a
security-relevant string trap: an empty `allowed_imports` reverts to the *permissive* 4-module
default): Step 4 adds the net-new `get_str_present` and re-points `sandbox_allowed_imports`, Step 5 is
its paired test. Step 6 documents the present-aware reads in both service `CLAUDE.md` config-key
tables (mirroring the `xstockstrat-analysis` convention) and runs the FR-3 trapping-accessor audit.

**Consumer surface — internal/platform-only (C-14).** The product spec's `## Consumer Surface(s)`
marks this `None`: no gRPC RPC, response field, or UI is added. The one operator-visible edge (a
`0` set via config-ui / the agent `set_config` tool now takes effect instead of reverting) is a
correctness change to a value that *already* round-trips through config, so no consumer-surface step
is required — this is a decision, not an omission.

### Scenario Coverage (C-15)

| Scenario | Covered by |
|---|---|
| `@AC-1` — stored `max_retry_attempts=0` → 0 effective attempts, not 3 | Step 3 |
| `@AC-2` — stored `dedup_window_hours=0` → 0, not 24 | Step 3 |
| `@AC-3` — present int `0` honored, absent → coded default (both ingest keys) | Step 3 |
| `@AC-4` — empty `allowed_imports` denies all imports, not the permissive default | Step 5 |

## Step Dependencies

- **Step 2 requires Step 1**: the `_effective_max_attempts()` seam consumes
  `self._cfg.backfill_max_retry_attempts`, which only honors a stored `0` once Step 1 re-points that
  property to `get_int_present`. Both must land before Step 3's `@AC-1` assertion can go green.
- **Step 3 [test] covers Step 1 + Step 2** (ingest watcher + servicer seam) — `@AC-1/@AC-2/@AC-3`.
  Both service steps and this test step carry `red-green required`; the test is authored to fail on
  the pre-implementation tree (`get_int` zero-trap returns 3 / 24; the seam method is absent).
- **Step 5 [test] covers Step 4** (indicators watcher) — `@AC-4`.
- **Step 6 [docs] requires Steps 1, 2, 4** — it audits and documents the finished watcher state.
- No deferred consumer surface (internal/platform-only, above). No proto / migration / config-key
  change (`ConfigValue` already distinguishes `0` from unset via its `oneof` —
  `packages/proto/config/v1/config.proto:60-71`).
- **FR-1 int-only narrowing (signed off, `design.md` Open Risks / `context.md`)**: `get_float_present`
  is **not** ported into ingest — no ingest float key consumes it, so it would be dead public API. Do
  not reintroduce it here.

---

### Step 1 — service: ingest watcher — add `get_int_present`, re-point the two 0-meaningful keys, annotate the semaphore-key retentions

**Status**: `done`
**Service**: `xstockstrat-ingest`
**Files**:
- `services/xstockstrat-ingest/app/config/watcher.py` — modify

**Reviewers**: xstockstrat-ingest — signal normalization correctness, idempotent ingestion, newsletter source schema stability

**Codebase Evidence**:
- Trapping accessor to mirror: `get_int` at `services/xstockstrat-ingest/app/config/watcher.py:107-113`
  (`return v.int_val or default`); the correct presence idiom already in this file is `get_bool`
  `:115-121` (`v.bool_val if v.HasField("bool_val") else default`).
- Verbatim port source: `services/xstockstrat-analysis/app/config/watcher.py:102-113` —
  `def get_int_present(self, key: str, default: int) -> int:` … `return v.int_val if v.HasField("int_val") else default`.
- Properties to re-point: `backfill_max_retry_attempts` at `watcher.py:174-176`
  (`return self.get_int("ingest.backfill.max_retry_attempts", default=3)`) and `dedup_window_hours`
  at `watcher.py:192-194` (`return self.get_int("ingest.signals.dedup_window_hours", default=24)`).
- Keep-on-`get_int` semaphore keys (must NOT switch): `backfill_max_concurrent_jobs` `:166-168`
  (default 3) → consumed by `asyncio.Semaphore(self._cfg.backfill_max_concurrent_jobs)` at
  `services/xstockstrat-ingest/app/handlers/servicer.py:191`; `backfill_max_concurrent_chunks`
  `:187-189` (default 3) → `asyncio.Semaphore(self._cfg.backfill_max_concurrent_chunks)` at
  `servicer.py:519`. A configured `0` reaching `Semaphore(0)` deadlocks, so the zero-trap default is
  the correct behavior there.

**TDD**: `red-green required` (paired test is Step 3)

**Covers**: `—`

**Instructions**:
1. Add `get_int_present` immediately after `get_int` (after `watcher.py:113`, before `get_bool` at
   `:115`), ported from `services/xstockstrat-analysis/app/config/watcher.py:102-113`:
   ```python
   def get_int_present(self, key: str, default: int) -> int:
       """Presence-aware int read: returns the stored ``int_val`` whenever the field is set —
       **including a legitimate 0** — else the default. Mirrors ``get_bool``'s ``HasField``
       pattern; use this (never ``get_int``) for keys where 0 is a meaningful value, e.g.
       ``ingest.backfill.max_retry_attempts`` (0 = no retries) and
       ``ingest.signals.dedup_window_hours`` (0 = disable the dedup window), which the
       ``get_int`` zero-trap would otherwise swallow into the default."""
       if self._snapshot is None:
           return default
       v = self._snapshot.values.get(key)
       if v is None:
           return default
       return v.int_val if v.HasField("int_val") else default
   ```
2. Re-point `backfill_max_retry_attempts` (`:174-176`): change `self.get_int(...)` →
   `self.get_int_present("ingest.backfill.max_retry_attempts", default=3)`.
3. Re-point `dedup_window_hours` (`:192-194`): change `self.get_int(...)` →
   `self.get_int_present("ingest.signals.dedup_window_hours", default=24)`.
4. Add a ≤2-line intentional-zero-trap comment above `backfill_max_concurrent_jobs` (`:166`) citing
   the real consumer, e.g.:
   ```python
   # get_int (zero-trap intentional): a configured 0 → default 3; 0 would reach
   # asyncio.Semaphore(0) at servicer.py:191 and deadlock. Do NOT switch to get_int_present.
   ```
   Add the equivalent above `backfill_max_concurrent_chunks` (`:187`) citing `servicer.py:519`.
5. Do **not** add `get_float_present` (FR-1 int-only narrowing) and do **not** touch `get_str` /
   `get_float` / `get_bool` or any other property (the clamped `ingest.mcp_client.*` keys are read
   elsewhere and stay clamped — out of scope).

**Verification**:
- `grep -n "get_int_present\|get_int(" services/xstockstrat-ingest/app/config/watcher.py` — confirm
  `max_retry_attempts` and `dedup_window_hours` now call `get_int_present`; `max_concurrent_jobs`
  and `max_concurrent_chunks` still call `get_int` and carry the trap comment.
- Lint (may run in the Step 3 paired test): `cd services/xstockstrat-ingest && ruff check . && ruff format --check .`

---

### Step 2 — service: ingest servicer — extract the `_effective_max_attempts()` seam

**Status**: `done`
**Service**: `xstockstrat-ingest`
**Files**:
- `services/xstockstrat-ingest/app/handlers/servicer.py` — modify

**Reviewers**: xstockstrat-ingest — signal normalization correctness, idempotent ingestion, newsletter source schema stability

**Codebase Evidence**:
- Inline retry-cap expression to extract: `services/xstockstrat-ingest/app/handlers/servicer.py:520-522`
  inside `_run_chunks` (`:513`):
  ```python
  max_attempts = (
      self._cfg.backfill_max_retry_attempts if self._cfg.backfill_retry_on_failure else 0
  )
  ```
- `max_attempts` is consumed only by the retry-loop guard at `servicer.py:568`
  (`if not failed or attempt >= max_attempts:`) and the permanent-`INVALID_ARGUMENT` short-circuit
  at `:564` (`attempt = max_attempts`); the real backoff is `await asyncio.sleep(2**attempt)` at
  `:571` (~14s over 3 attempts — the reason the design routes the `@AC-1` RED through this seam
  instead of driving the live loop).

**TDD**: `red-green required` (paired test is Step 3)

**Covers**: `—`

**Instructions**:
1. Add a 3-line method on `IngestServicer` (place it near the other private helpers, e.g. just above
   `_run_chunks` at `:513`):
   ```python
   def _effective_max_attempts(self) -> int:
       return self._cfg.backfill_max_retry_attempts if self._cfg.backfill_retry_on_failure else 0
   ```
2. Replace the inline expression at `servicer.py:520-522` with a single call, making the method the
   **sole** definition of `max_attempts`:
   ```python
   max_attempts = self._effective_max_attempts()
   ```
   Delete the inline conditional — do not leave a duplicate copy (`design.md` Open Risk: seam
   integrity; fails-074/151 vacuous-green trap). The loop guard at `:568` and the short-circuit at
   `:564` are unchanged and continue to read the local `max_attempts`.

**Verification**:
- `grep -n "_effective_max_attempts\|max_attempts =" services/xstockstrat-ingest/app/handlers/servicer.py`
  — confirm exactly one method definition, one assignment (`max_attempts = self._effective_max_attempts()`),
  and no remaining inline `if self._cfg.backfill_retry_on_failure else 0` expression.
- Lint (may run in the Step 3 paired test): `cd services/xstockstrat-ingest && ruff check . && ruff format --check .`

---

### Step 3 — test: ingest — accessor + consumer regression tests (`@AC-1`, `@AC-2`, `@AC-3`)

**Status**: `pending`
**Service**: `xstockstrat-ingest`
**Files**:
- `services/xstockstrat-ingest/tests/test_config_watcher.py` — modify
- `services/xstockstrat-ingest/tests/test_ingest_servicer.py` — modify

**Reviewers**: xstockstrat-ingest — signal normalization correctness, idempotent ingestion, newsletter source schema stability

**Codebase Evidence**:
- Existing accessor-test module: `services/xstockstrat-ingest/tests/test_config_watcher.py` (currently
  only `resolve_environment`/`resolve_trading_mode` cases — no accessor tests yet).
- Existing servicer-test scaffold: `services/xstockstrat-ingest/tests/test_ingest_servicer.py:31-63`
  `make_servicer(...)` returns an `IngestServicer` with fully mocked channels/db; it already imports
  `config_pb2` (`:18`) and `ConfigWatcher` (`:24`).
- Proto shape: `ConfigSnapshot.values` is a `map<string, ConfigValue>` and `ConfigValue.value` is a
  `oneof` — confirmed by the watcher's own reads (`self._snapshot.values.get(key)`, `v.int_val`,
  `v.HasField("bool_val")`). Setting `int_val`/`bool_val` on a map-constructed `ConfigValue` sets the
  oneof case, so `HasField("int_val")` is **True even for a stored 0** — the basis of the fix.
- Ledger: insights-069 line 1060-1062 — "when adding `HasField`/presence-gated branching, replace
  `MagicMock`/`AsyncMock` request fakes with **real proto instances** in the same step"; fails-074 —
  never construct a live dialing `ConfigWatcher` in a test (it hangs), and never trust a green run
  with zero assertions. Both are honored below (real `ConfigSnapshot`/`ConfigValue`; dial-free watcher
  via `ConfigWatcher.__new__`).

**TDD**: `red-green required`

**Covers**: `AC-1, AC-2, AC-3`

**Instructions**:
Author these so they **fail against the pre-Step-1/2 tree** (`get_int` returns 3 / 24; the seam
method is absent → `AttributeError`) and pass after.

1. In `test_config_watcher.py`, add a dial-free watcher builder and the `@AC-3` accessor cases:
   ```python
   from gen.config.v1 import config_pb2
   from app.config.watcher import ConfigWatcher

   def _int_watcher(**int_values) -> ConfigWatcher:
       # __new__ bypasses __init__'s channel + watch-task dial (fails-074: never a live watcher).
       w = ConfigWatcher.__new__(ConfigWatcher)
       snap = config_pb2.ConfigSnapshot()
       for key, iv in int_values.items():
           snap.values[key].int_val = iv  # sets the oneof case → HasField True even for 0
       w._snapshot = snap
       return w

   @pytest.mark.parametrize("key,default", [
       ("ingest.backfill.max_retry_attempts", 3),
       ("ingest.signals.dedup_window_hours", 24),
   ])
   def test_get_int_present_honors_stored_zero(key, default):
       w = _int_watcher(**{key: 0})
       assert w.get_int_present(key, default) == 0

   def test_get_int_present_defaults_when_absent():
       w = ConfigWatcher.__new__(ConfigWatcher)
       w._snapshot = config_pb2.ConfigSnapshot()  # key absent
       assert w.get_int_present("ingest.backfill.max_retry_attempts", 3) == 3
   ```
   (Parametrize keys use scenario one-off literals — C-13 exempt; no shared fixture home needed.)
2. Add the `@AC-2` property read (dedup) in the same module:
   ```python
   def test_dedup_window_hours_property_honors_zero():
       w = _int_watcher(**{"ingest.signals.dedup_window_hours": 0})
       assert w.dedup_window_hours == 0  # RED on buggy: 24
   ```
3. In `test_ingest_servicer.py`, add the `@AC-1` consumer test driving the full
   watcher → property → seam chain against a **real** watcher (not the `MagicMock` cfg):
   ```python
   def test_effective_max_attempts_honors_stored_zero():
       w = ConfigWatcher.__new__(ConfigWatcher)
       snap = config_pb2.ConfigSnapshot()
       snap.values["ingest.backfill.max_retry_attempts"].int_val = 0
       snap.values["ingest.backfill.retry_on_failure"].bool_val = True
       w._snapshot = snap
       svc = make_servicer()          # channels/db mocked
       svc._cfg = w                   # exercise get_int_present + property + seam
       assert svc._effective_max_attempts() == 0  # RED: 3 (get_int trap) or AttributeError (no seam)
   ```
4. Keep the existing `make_servicer(max_retry=…)` loop tests (`test_ingest_servicer.py`) untouched and
   green — they prove the seam→loop wiring (`design.md` Open Risk: seam integrity).

**Verification**:
- Red-before-green: `/sdd-execute` captures a failing run on the pre-implementation tree, then a
  passing run after Steps 1-2 (`reference/tdd-gate.md`).
- Coverage + lint (C-08): `cd services/xstockstrat-ingest && ruff check . && ruff format --check . && uv run pytest --cov=app --cov-fail-under=40` — confirm ≥ 40% and all new cases pass.

---

### Step 4 — service: indicators watcher — add net-new `get_str_present`, re-point `sandbox_allowed_imports`

**Status**: `pending`
**Service**: `xstockstrat-indicators`
**Files**:
- `services/xstockstrat-indicators/app/config/watcher.py` — modify

**Reviewers**: xstockstrat-indicators — formula sandboxing, numeric precision, timeout enforcement, no side-effects from formula execution

**Codebase Evidence**:
- Trapping accessor to fix: `get_str` at `services/xstockstrat-indicators/app/config/watcher.py:86-92`
  (`return v.string_val or default`). No `get_str_present` exists in **any** of the three Python
  watchers (grep-confirmed in recon) — this is net-new.
- Idiom to mirror: `get_bool` at `watcher.py:102-108` (`v.bool_val if v.HasField("bool_val") else default`).
- Property to re-point: `sandbox_allowed_imports` at `watcher.py:126-131`:
  ```python
  raw = self.get_str(
      "indicators.sandbox.allowed_imports", default="numpy,pandas,math,statistics"
  )
  return [m.strip() for m in raw.split(",") if m.strip()]
  ```
  Read consumer: `services/xstockstrat-indicators/app/handlers/servicer.py:127`
  (`allowed_imports = self._cfg.sandbox_allowed_imports`). Today a stored `""` reverts to the
  permissive 4-module default — a security-relevant trap (the sandbox becomes *more* permissive than
  configured), not mere defensiveness.
- Not 0-meaningful, leave on `get_int`: `sandbox_timeout_ms` `:118-120`, `sandbox_memory_bytes`
  `:122-124` (a `0`ms / `0`-byte cap is nonsensical) — no numeric port in indicators (OQ-3 resolved).

**TDD**: `red-green required` (paired test is Step 5)

**Covers**: `—`

**Instructions**:
1. Add `get_str_present` immediately after `get_str` (after `watcher.py:92`, before `get_int` at
   `:94`), mirroring `get_bool`'s `HasField` idiom and the analysis `get_int_present` signature shape
   (required `default`):
   ```python
   def get_str_present(self, key: str, default: str) -> str:
       """Presence-aware string read: returns the stored ``string_val`` whenever the field is set —
       **including a legitimate ""** — else the default. Mirrors ``get_bool``'s ``HasField``
       pattern; use this (never ``get_str``) for keys where an empty string is meaningful, e.g.
       ``indicators.sandbox.allowed_imports`` ("" = allow no imports), which the ``get_str``
       zero-trap would otherwise swallow into the permissive default."""
       if self._snapshot is None:
           return default
       v = self._snapshot.values.get(key)
       if v is None:
           return default
       return v.string_val if v.HasField("string_val") else default
   ```
2. Re-point `sandbox_allowed_imports` (`:126-131`): change `self.get_str(...)` →
   `self.get_str_present("indicators.sandbox.allowed_imports", default="numpy,pandas,math,statistics")`.
   Leave the `[m.strip() for m in raw.split(",") if m.strip()]` split unchanged — a `""` resolves to
   `[]` (deny all imports).
3. Do **not** add a numeric present accessor to this watcher (dead code — OQ-3) and do not touch
   `sandbox_timeout_ms` / `sandbox_memory_bytes`.

**Verification**:
- `grep -n "get_str_present\|get_str(" services/xstockstrat-indicators/app/config/watcher.py` —
  confirm `sandbox_allowed_imports` now calls `get_str_present` and no other property regressed.
- Lint (may run in the Step 5 paired test): `cd services/xstockstrat-indicators && ruff check . && ruff format --check .`

---

### Step 5 — test: indicators — `get_str_present` accessor + deny-all `allowed_imports` (`@AC-4`)

**Status**: `pending`
**Service**: `xstockstrat-indicators`
**Files**:
- `services/xstockstrat-indicators/tests/test_config_watcher.py` — modify

**Reviewers**: xstockstrat-indicators — formula sandboxing, numeric precision, timeout enforcement, no side-effects from formula execution

**Codebase Evidence**:
- Existing accessor-test module: `services/xstockstrat-indicators/tests/test_config_watcher.py`
  (currently only `resolve_environment`/`resolve_trading_mode` cases).
- Deterministic property assertion is the primary `@AC-4` check (`design.md` Open Risk: the real
  subprocess-sandbox end-to-end run is flaky/costly; the property-level `allowed_imports == []`
  assertion is the sanctioned fallback and is used here as primary). The subprocess consumer pattern,
  if a reviewer insists on it, lives at `services/xstockstrat-indicators/tests/test_formulas.py`
  (`IndicatorsServicer(config_watcher=…)`, `ExecuteFormula` with inline `formula_source`).
- Same real-proto discipline as Step 3 (insights-069/1060, fails-074): build a `ConfigValue` with
  `string_val=""`; `HasField("string_val")` is True for the empty string.

**TDD**: `red-green required`

**Covers**: `AC-4`

**Instructions**:
Author to fail against the pre-Step-4 tree (`get_str` traps `""` → the 4-module default) and pass after.

1. In `test_config_watcher.py`, add a dial-free string-watcher builder and cases:
   ```python
   from gen.config.v1 import config_pb2
   from app.config.watcher import ConfigWatcher

   def _str_watcher(key: str, val: str) -> ConfigWatcher:
       w = ConfigWatcher.__new__(ConfigWatcher)  # dial-free (fails-074)
       snap = config_pb2.ConfigSnapshot()
       snap.values[key].string_val = val  # sets the oneof case → HasField True even for ""
       w._snapshot = snap
       return w

   def test_get_str_present_honors_empty():
       w = _str_watcher("indicators.sandbox.allowed_imports", "")
       assert w.get_str_present(
           "indicators.sandbox.allowed_imports", "numpy,pandas,math,statistics"
       ) == ""

   def test_get_str_present_defaults_when_absent():
       w = ConfigWatcher.__new__(ConfigWatcher)
       w._snapshot = config_pb2.ConfigSnapshot()  # key absent
       assert w.get_str_present("indicators.sandbox.allowed_imports", "x") == "x"

   def test_sandbox_allowed_imports_empty_denies_all():
       w = _str_watcher("indicators.sandbox.allowed_imports", "")
       # RED on buggy: ["numpy", "pandas", "math", "statistics"]
       assert w.sandbox_allowed_imports == []
   ```
2. (Optional, reviewer-gated) add the end-to-end `test_formulas.py` assertion — drive `ExecuteFormula`
   with an inline `formula_source` `import numpy` and a `_snapshot`-injected `allowed_imports=""`,
   asserting the import is rejected. Include only if the subprocess run is not flaky in CI; otherwise
   the property assertion above is the accepted `@AC-4` coverage (`design.md` Open Risk).

**Verification**:
- Red-before-green: `/sdd-execute` captures a failing run on the pre-Step-4 tree, then passing after.
- Coverage + lint (C-08): `cd services/xstockstrat-indicators && ruff check . && ruff format --check . && uv run pytest --cov=app --cov-fail-under=50` — confirm ≥ 50% and the new cases pass.

---

### Step 6 — docs: document the present-aware reads + FR-3 trapping-accessor audit

**Status**: `pending`
**Service**: `docs/` (service `CLAUDE.md` config-key tables)
**Files**:
- `services/xstockstrat-ingest/CLAUDE.md` — modify
- `services/xstockstrat-indicators/CLAUDE.md` — modify

**Reviewers**: none

**Codebase Evidence**:
- Convention to mirror: `services/xstockstrat-analysis/CLAUDE.md` documents 0-meaningful keys as
  "Read via `get_int_present` / `get_float_present` (**not** `get_int`/`get_float`)" (e.g.
  `analysis.strategy.default_exit_cooldown_days`, `analysis.scoring.signal_decay_half_life_hours`).
- Ingest table rows to annotate: `| ingest.backfill.max_retry_attempts | int | 3 | … |` and
  `| ingest.signals.dedup_window_hours | int | 24 | … |` (§ Config Keys Consumed).
- Indicators table row to annotate: `| indicators.sandbox.allowed_imports | string | numpy,pandas,math,statistics | … |` (§ Config Keys Consumed).

**TDD**: `N/A (docs)`

**Covers**: `—`

**Instructions**:
1. In `services/xstockstrat-ingest/CLAUDE.md` § Config Keys Consumed, append to the two rows'
   Description cells: for `max_retry_attempts` — "Read via `get_int_present` (never `get_int`): a
   configured `0` = no retries is honored (feature 173)."; for `dedup_window_hours` — "Read via
   `get_int_present` (never `get_int`): a configured `0` disables the dedup window (feature 173)."
   Leave `max_concurrent_jobs` / `max_concurrent_chunks` as-is (their `get_int` zero-trap is
   intentional — the in-code comment from Step 1 is the durable record).
2. In `services/xstockstrat-indicators/CLAUDE.md` § Config Keys Consumed, append to the
   `allowed_imports` row: "Read via `get_str_present` (never `get_str`): a configured `""` denies all
   imports rather than reverting to this permissive default (feature 173)."
3. Run the FR-3 audit (verification below) and, if it reports any remaining 0-meaningful key on a
   trapping accessor, stop and reconcile before completing this step.
4. **Teardown (How-to-Act):** this step changes context files (`CLAUDE.md`). Before the final PR, run
   `/context-forge:context-constitution refresh` scoped to the two edited `CLAUDE.md` files (or, if the
   plugin is unavailable, perform the manual reconciliation and record both facts in the PR body).

**Verification**:
- FR-3 audit — `grep -n "get_str(\|get_int(\|get_float(\|get_int_present\|get_str_present" services/xstockstrat-ingest/app/config/watcher.py services/xstockstrat-indicators/app/config/watcher.py`
  — confirm: `ingest.backfill.max_retry_attempts` and `ingest.signals.dedup_window_hours` →
  `get_int_present`; `indicators.sandbox.allowed_imports` → `get_str_present`; the only remaining
  `get_int` reads on 0-meaningful-looking keys are `max_concurrent_jobs` / `max_concurrent_chunks`
  (intentional, comment-annotated) and the not-0-meaningful `sandbox_timeout_ms` /
  `sandbox_memory_bytes`.
- `grep -n "get_int_present\|get_str_present" services/xstockstrat-ingest/CLAUDE.md services/xstockstrat-indicators/CLAUDE.md`
  — confirm the three rows now document the present-aware read.

---

## Deviation Log

_Populated by /sdd-execute as implementation proceeds._
