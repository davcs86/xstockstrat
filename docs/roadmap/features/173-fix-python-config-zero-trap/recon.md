# Recon: fix-python-config-zero-trap

**Created**: 2026-09-04
**From**: product-spec.md
**Affected services**: xstockstrat-ingest, xstockstrat-indicators

---

## Objective

The Python config-watcher accessors in `xstockstrat-ingest` and `xstockstrat-indicators` coalesce
scalar reads with `... or default`, so a config value an operator deliberately stores as `0` / `0.0`
/ `""` collapses to the coded default. Port the proven `HasField`-based present-aware accessors from
`xstockstrat-analysis` and route the confirmed 0-meaningful keys through them, so `0` is honored
end-to-end. This is a real SEV-2 bug in ingest (`max_retry_attempts=0` silently becomes 3);
indicators' numeric keys are hardening-only, its live case is the string `allowed_imports=""`.

## Codebase Map

- **`xstockstrat-ingest`** (Python 3.13)
  - Config watcher: `services/xstockstrat-ingest/app/config/watcher.py`
    - Zero-trap accessors: `get_str` `:99-105` (`return v.string_val or default`), `get_int`
      `:107-113` (`return v.int_val or default`), `get_float` `:123-129` (`return v.float_val or default`).
    - Correct accessor: `get_bool` `:115-121` (`v.bool_val if v.HasField("bool_val") else default`).
    - `@property backfill_max_retry_attempts` `:174-176` → `get_int("ingest.backfill.max_retry_attempts", 3)`.
    - `@property dedup_window_hours` `:192-194` → `get_int("ingest.signals.dedup_window_hours", 24)`.
    - `@property backfill_max_concurrent_jobs` `:166-168` (default 3); `backfill_max_concurrent_chunks`
      `:187-189` (default 3) — candidate 0=disable keys, design to confirm.
    - Clamped-at-read keys (**must stay clamped ≥1 — do NOT un-clamp**): `ingest.mcp_client.poll_interval_seconds`,
      `ingest.mcp_client.request_timeout_seconds` (`services/xstockstrat-ingest/CLAUDE.md` § Config Keys Consumed).
  - 0-meaningful consumers (no downstream re-clamp): `max_retry_attempts` at
    `app/handlers/servicer.py:519-523` (`... if backfill_retry_on_failure else 0`), used by the retry
    loop guard `:568` and INVALID_ARGUMENT short-circuit `:564`; `dedup_window_hours` at
    `app/handlers/servicer.py:823` (SQL param `$7` into `make_interval(hours => $7::int)`, claim at `:809-810`).
  - CI: threshold **40** (`.github/workflows/ci.yml:340-342`), run `uv run pytest --cov=app --cov-fail-under=40`.
- **`xstockstrat-indicators`** (Python 3.13)
  - Config watcher: `services/xstockstrat-indicators/app/config/watcher.py`
    - Zero-trap accessors: `get_str` `:86-92`, `get_int` `:94-100`, `get_float` `:110-116`; correct
      `get_bool` `:102-108`.
    - `@property sandbox_allowed_imports` `:126-131` → `get_str("indicators.sandbox.allowed_imports",
      "numpy,pandas,math,statistics")` then `[m.strip() for m in raw.split(",") if m.strip()]`.
    - `sandbox_timeout_ms` `:118-120`, `sandbox_memory_bytes` `:122-124` — numeric, NOT 0-meaningful.
  - Sole consumer of sandbox config: `app/handlers/servicer.py:125-127`.
  - CI: threshold **50** (`services/xstockstrat-indicators/CLAUDE.md`), run `uv run pytest --cov=app --cov-fail-under=50`.
- **Precedent (read-only, not modified)**: `xstockstrat-analysis` config watcher
  `services/xstockstrat-analysis/app/config/watcher.py` — `get_int_present` `:102-113`
  (`v.int_val if v.HasField("int_val") else default`), `get_float_present` `:131-142`. **No
  `get_str_present` exists in any of the three Python watchers** (grep-confirmed absent).

## Patterns to REUSE

- Present-aware numeric read → reuse `get_int_present` / `get_float_present` at
  `services/xstockstrat-analysis/app/config/watcher.py:102,131` (port verbatim; mirror docstring style).
- Presence check on a `oneof` scalar → reuse the existing `get_bool` idiom
  (`v.HasField("bool_val")`, ingest `watcher.py:121`) — the same `HasField` mechanism, extended to int/float/str.
- The `oneof` presence contract → **`ConfigValue`** message `packages/proto/config/v1/config.proto:60-71`
  wraps `string_val`/`int_val`/`float_val`/`bool_val` in `oneof value`, so `HasField("int_val")` is
  legal and 0-vs-unset is distinguishable. (Verifies the insights-069 "verify the codegen contract" rule.)
- Test config injection → existing tests hand the servicer a `MagicMock` with `@property` values set
  directly (`test_ingest_servicer.py:31-63` `make_servicer`; indicators `test_formulas.py:324-380`).
  A new **accessor-level** test must instead build a `config_pb2.ConfigValue`/`ConfigSnapshot` and set
  `watcher._snapshot` directly (or call the accessor on a constructed value) — never construct a live
  dialing `ConfigWatcher` (see Risks — fails-074).

## Existing Business Rules (preserve / extend)

- **PRESERVE** `@AC-4` "MCP tool result is parsed into ExternalSignals and ingested"
  (`services/xstockstrat-ingest/acceptance/mcp-client-signal-source.feature`) — the
  `(source,symbol,direction)` dedup guarantee is driven by `ingest.signals.dedup_window_hours`; the
  fix must keep dedup working at the default (non-zero, 24h) window.
- **PRESERVE** `@AC-1 @FR-1 @FR-2 @feature-127` "A watchlist-direction signal adds the symbol to the
  caller's system-managed watchlist" (`docs/sdd/business-rules/platform.feature`) — auto-add fires on
  `deduplicated=false`; the accessor change must not alter that flag under a normal window.
- **PRESERVE** `@AC-3 @FR-4 @feature-127` "A deduplicated ingest does not re-trigger the auto-add"
  (`docs/sdd/business-rules/platform.feature`) — `deduplicated=true` must still suppress auto-add.
- xstockstrat-indicators → **no existing acceptance suite yet** (Glob returned no files).
- **New behavior (EXTEND, not CHANGE)**: no existing `@AC-*` guarantees the old buggy revert-to-default
  for `max_retry_attempts` or `dedup_window_hours`, so **no CHANGE and no user sign-off is owed**. The
  0-honoring cases are net-new behavior this feature's own `acceptance.feature` (@AC-1..3) covers.

## Dependencies

- Proto/RPC: none changed. Relies on the **existing** `ConfigValue` `oneof` (`config.proto:60`, no edit).
- Migration: none (the 0-meaningful keys already exist/seeded).
- Config keys: no new keys. Behavior of existing reads only — `ingest.backfill.max_retry_attempts`,
  `ingest.signals.dedup_window_hours` (routed through present accessor); `indicators.sandbox.allowed_imports`
  (string case, subject to OQ-1).
- Inter-service edges: none new.
- New env vars / ports: none.

## Risks / Not-found

- **fails-074 (config-watcher test traps)**: `xstockstrat-config` watcher tests once passed with **zero
  assertions**, and a test that constructs a live `ConfigWatcher` **hangs** (it dials + retries). The
  FR-3 regression test MUST inject a synthetic `ConfigSnapshot`/`ConfigValue` (set `_snapshot` or call
  the accessor on a built value) and must demonstrate a real RED on the current `or default` code —
  never construct a dialing watcher, never trust a green runner without a non-zero assertion count.
- **insights-069 (3-layer zero-trap)**: the zero-vs-unset trap recurs at proto / Python `get_int` /
  TS `?? 0`. Here the proto layer is already correct (`oneof`), so only the Python read layer needs the fix.
- **Design guard (from scenario-recon, not a C-16 flag)**: `ingest.mcp_client.poll_interval_seconds`
  and `request_timeout_seconds` are intentionally **clamped ≥1 at read** — a "honor 0" fix must NOT
  un-clamp them. This argues for a **targeted** fix (route only the confirmed 0-meaningful keys through
  the present accessor), not a blanket `get_int → get_int_present` swap.
- **OQ-1 (string escape hatch)**: `get_str_present` exists nowhere. The indicators `allowed_imports=""`
  (deny-all-imports) case needs it. In scope for this fix, or a named follow-up? — open for the debate.
- **OQ-2 (DRY)**: porting `_present` into two more watchers makes a **fourth** near-identical copy across
  analysis/ingest/indicators. Shared home vs per-service copy — open for the debate (DRY guard rail).
- **OQ-3**: indicators has no current 0-meaningful numeric key — is the numeric port there in scope
  now (hardening) or deferred? Report CF-N10 names both services.
- `indicators.sandbox.max_concurrent` has no read site (documented-not-enforced) — out of scope.

## Recommended Scope

Advisory step boundaries (input to grilling / `/sdd-spec`, not binding):
1. Add `get_int_present`/`get_float_present` to the **ingest** watcher (port from analysis).
2. Route `backfill_max_retry_attempts` + `dedup_window_hours` (and any design-confirmed 0=disable keys)
   through the present accessor; leave the clamped mcp_client keys untouched.
3. Accessor-level + servicer-level regression tests (RED-before-green), snapshot-injected, no live watcher.
4. Resolve OQ-1/OQ-2/OQ-3 in the debate → this may add a `get_str_present` + the indicators string
   fix, and/or a shared-accessor home, and/or defer indicators.
