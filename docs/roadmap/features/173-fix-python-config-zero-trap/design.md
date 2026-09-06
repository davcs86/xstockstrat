# Design: fix-python-config-zero-trap

**Created**: 2026-09-04
**Rounds**: 3 (full; termination: approved)
**Approved by**: user @ 2026-09-04
**Grounded in**: recon.md

---

## Chosen Approach

A **targeted add-not-replace** port of the `HasField`-based present-aware config accessors, scoped to
exactly the confirmed 0/empty-meaningful keys in two services, with per-service copies (no shared
package). Internal/platform-only — no consumer surface beyond the existing config round-trip (C-14).

**Ingest** (`services/xstockstrat-ingest/app/config/watcher.py`):
- Add `get_int_present` after `get_int` (`watcher.py:107-113`), **ported verbatim** from
  `services/xstockstrat-analysis/app/config/watcher.py:102-113`. Do **not** port `get_float_present` —
  no ingest float key consumes it (see Rejected Alternatives / Open Risks — the FR-1 narrowing).
- Re-point exactly two properties from `get_int` → `get_int_present`: `backfill_max_retry_attempts`
  (`watcher.py:174-176`) and `dedup_window_hours` (`watcher.py:192-194`). These are the only two
  confirmed 0-meaningful ingest keys, and both consumers pass the value through with **no downstream
  re-clamp** (`servicer.py:520-522` retry cap; `servicer.py:823` dedup SQL `$7`).
- Leave `backfill_max_concurrent_jobs` (`watcher.py:166-168`) and `backfill_max_concurrent_chunks`
  (`watcher.py:187-189`) on `get_int` with a per-key **intentional-zero-trap comment** citing its real
  `asyncio.Semaphore(...)` site — `servicer.py:191` (jobs) and `servicer.py:519` (chunks) — because a
  configured `0` reaching `Semaphore(0)` deadlocks; the default fallback is the correct behavior there.
- The clamped `ingest.mcp_client.poll_interval_seconds` / `request_timeout_seconds` keys stay on
  `get_int` untouched (intentionally clamped ≥1 at read — must not be un-clamped).

**Ingest servicer** (`services/xstockstrat-ingest/app/handlers/servicer.py`):
- Extract the inline retry-cap expression at `servicer.py:520-522` into a 3-line real seam
  `_effective_max_attempts()` (`= self._cfg.backfill_max_retry_attempts if self._cfg.backfill_retry_on_failure
  else 0`), making it the **sole** definition of `max_attempts` consumed by the loop guard at
  `servicer.py:568`. This gives the `@AC-1` consumer test a fast, deterministic, RED-provable seam
  without the real `2**attempt` backoff (`servicer.py:571`, ~14s). It is a legitimate sole-definition
  refactor, **not** a vacuous echo (fails-074/151): the inline expression is deleted, and the existing
  `make_servicer(max_retry=…)` loop tests (`test_ingest_servicer.py:31-63`) stay green to prove the
  seam→loop wiring.

**Indicators** (`services/xstockstrat-indicators/app/config/watcher.py`):
- Add a **net-new** `get_str_present` (absent in all three Python watchers) after `get_str`
  (`watcher.py:86-92`), mirroring `get_bool`'s `HasField("string_val")` idiom (`watcher.py:102-108`).
- Re-point `sandbox_allowed_imports` (`watcher.py:126-131`) from `get_str` → `get_str_present`, so a
  present `""` resolves to `[]` (deny all imports) instead of silently reverting to the permissive
  `numpy,pandas,math,statistics` default. Read consumer: `app/handlers/servicer.py:125-127`. No numeric
  port in indicators (its numeric keys are not 0-meaningful → would be dead code).

**Soundness**: the whole fix relies on `ConfigValue` being a proto `oneof`
(`packages/proto/config/v1/config.proto:60-71`), which makes `HasField("int_val"/"string_val")` legal
and 0-vs-unset distinguishable — the same mechanism `get_bool` already uses. No proto/migration/config-key
change.

**Tests** (two-layer, RED-before-green; config injected by setting `watcher._snapshot` to a built
`ConfigSnapshot`, never a dialing `ConfigWatcher` — fails-074):
- `@AC-1` — consumer (`test_ingest_servicer.py`): real watcher with `max_retry_attempts` `int_val=0`
  present + `retry_on_failure=True`; assert `servicer._effective_max_attempts() == 0`. RED on buggy = 3.
- `@AC-2` — consumer (`test_ingest_servicer.py`): `dedup_window_hours` `int_val=0`; assert
  `servicer._cfg.dedup_window_hours == 0` (pure read). RED = 24.
- `@AC-3` — accessor (`test_config_watcher.py`): parametrize present `int_val=0 → 0` (both keys),
  absent → coded default.
- `@AC-4` — accessor (`test_config_watcher.py`: `string_val="" → ""` / `[]`) **and** end-to-end consumer
  (`test_formulas.py`): drive `ExecuteFormula` with inline `formula_source` `import numpy` and a
  `_snapshot`-injected `allowed_imports=""`; RED on buggy = numpy allowed (property returns the 4-module
  default), GREEN on fixed = import rejected. Drives property→`servicer.py:127`→`sandbox.execute_formula`.
- FR-3 audit: grep both watchers confirming no remaining 0-meaningful key routes through a trapping
  accessor; the `max_concurrent_*` + indicators numeric keys are the intentional `get_int` retentions.

## Rejected Alternatives

- **Blanket `get_int/get_str/get_float → HasField` swap + add `max(1,…)` clamps at the semaphore/mcp
  read sites** — rejected: un-clamps the intentionally-clamped `mcp_client.*` keys and forces new clamps
  at 4 read sites in one PR (much larger blast radius). The targeted per-key switch avoids touching
  clamped keys by construction.
- **Shared `_present` accessor package across the three Python services (OQ-2 DRY)** — rejected: the
  three services share no importable package (only generated `gen.*` stubs) and their watcher classes
  diverge (ingest carries `resolve_secret`/credential-split; indicators does not). A new package for
  ~12 lines adds cross-service coupling and touches out-of-scope analysis. Per-service copy matches the
  existing `get_bool` precedent. (Deferred DRY note for the `dry-reviewer` — see Open Risks.)
- **Porting `get_float_present` into ingest for accessor-set parity** — rejected: no ingest float key
  consumes it, so it is consumerless dead public API (How-to-Act #2). Trivial to add later when a float
  key appears. This **narrows FR-1's literal text** (which named both) to int-only for ingest — a
  deliberate, signed-off narrowing recorded here and in context.md, resolving OQ-3.
- **Loop-driving the `@AC-1` RED (assert `BackfillBars` awaited exactly once)** — rejected as the
  primary: hits the real `2**attempt` backoff (~14s) unless `asyncio.sleep` is patched, and needs the
  chunk-DB mock surface. The `_effective_max_attempts()` seam + the existing loop tests give equivalent
  coverage deterministically. (Retained as a sanctioned fallback with `asyncio.sleep` patched if a
  reviewer insists on a live-loop assertion.)
- **The "assert the inline `max_attempts` expression" fallback** — FORBIDDEN: it only re-echoes the
  accessor and re-opens the fails-074/151 vacuous-green trap. The seam replaces it.

## Open Risks

- [ ] **FR-1 int-only narrowing** — product-spec FR-1 names both `get_int_present` and
  `get_float_present` for ingest; this design ships int-only. Recorded here + context.md as a deliberate
  narrowing (resolves OQ-3). `/sdd-spec` must reflect int-only, not re-introduce the float port. — at `/sdd-spec`.
- [ ] **`@AC-1` seam integrity** — `_effective_max_attempts()` must be the SOLE definition of
  `max_attempts` (delete the inline expression, don't duplicate); the `make_servicer` loop tests must
  stay green to prove seam→loop wiring. — at the ingest-servicer step.
- [ ] **`ConfigWatcher._snapshot` injection** — assumes the constructor can have `_snapshot` set without
  dialing (dial lives in `wait_for_snapshot`, `watcher.py:95`); fallback is a minimal `_StubWatcher`
  subclass exposing the real accessors + routed properties over an injected `_snapshot`. — at the test steps.
- [ ] **`@AC-4` subprocess sandbox test cost** — the end-to-end run uses the real subprocess sandbox
  (established `test_formulas.py`/`test_sandbox.py` pattern; indicators threshold 50). If flaky, fall
  back to asserting the servicer's resolved `allowed_imports` (`servicer.py:127`) is `[]` via the
  injected `_cfg` (still property-driven). — at the indicators test step.
- [ ] **Deferred DRY (OQ-2)** — the ~11-line verbatim `get_int_present` copy across analysis+ingest may
  be flagged by jscpd; this is an accepted per-service duplication, waivable at execute time. — note for `dry-reviewer`.

## Constitution Rules Touched

- `C-08` / `P-06` — honored by: two-layer RED-before-green tests; every `@AC` has an accessor and/or
  consumer test with a real RED on the buggy code; the `_effective_max_attempts()` seam makes the retry
  consumer testable without the 14s backoff.
- `C-15` — honored by: `@AC-1..4` each map to a `test`/RED assertion; `@AC-4` was authored before this
  design cited it; every `FR-N` is covered.
- `C-16` — honored by: default-window dedup behavior is untouched, so the three PRESERVE guarantees
  (`platform.feature` @AC-1/@AC-3 auto-add; `mcp-client-signal-source.feature` @AC-4 dedup) hold; the
  `0`-honoring cases are net-new behavior with no existing guarantee to change (no sign-off owed).
- `C-05` / `F-07` — honored by: no new config keys; values still read via `WatchConfig`; no hardcoding.
- `C-13` — honored by: Python fixtures constructed via `config_pb2.ConfigSnapshot`/`ConfigValue`,
  snapshot-injected; no inline domain literals beyond scenario one-offs.
- How-to-Act #2 (minimalism) — honored by: dropping the consumerless `get_float_present`; no numeric
  port in indicators; the seam is a 3-line extraction, not a broader refactor.
- `F-04` — honored by: every path:line cited comes from recon/discovery; no invented symbols.
- No Floor (`F-*`) breach in any of the three rounds.

## Business Rules Touched (C-16)

- PRESERVE `@AC-4` "MCP tool result is parsed into ExternalSignals and ingested"
  (`services/xstockstrat-ingest/acceptance/mcp-client-signal-source.feature`) — not regressed: dedup runs
  at the default 24h window (unset → 24 via `get_int_present`); only an explicit `0` disables it.
- PRESERVE `@AC-1 @feature-127` "watchlist-direction signal adds to system-managed watchlist"
  (`docs/sdd/business-rules/platform.feature`) — not regressed: the `deduplicated` flag is unchanged at
  the default window.
- PRESERVE `@AC-3 @feature-127` "a deduplicated ingest does not re-trigger auto-add" — not regressed:
  same, default-window behavior intact.
- (indicators has no acceptance suite yet → no C-16 surface for `@AC-4`.)
