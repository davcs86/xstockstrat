# Product Spec: fix-python-config-zero-trap

**Type**: bug
**Defect Report**: `docs/reports/2026-09-04-comment-audit-triage.md` (item 3)
**Severity**: SEV-2
**Created**: 2026-09-04

---

## Problem Statement

**Observed**: the config-watcher accessors in indicators and ingest coalesce with `or default`:

- `services/xstockstrat-indicators/app/config/watcher.py` — `get_str` (`:92` `v.string_val or default`),
  `get_int` (`:100` `v.int_val or default`), `get_float` (`:116` `v.float_val or default`).
- `services/xstockstrat-ingest/app/config/watcher.py` — same shape: `get_str` (`:105`),
  `get_int` (`:113`), `get_float` (`:129`).

Because `0`, `0.0`, and `""` are falsy in Python, a value an operator deliberately stores as `0` /
`0.0` / `""` is indistinguishable from "unset" and silently reverts to the hardcoded default. Only
the `bool` accessor is safe (both watchers already use `v.HasField("bool_val")`).

**Expected**: a stored `0` / `0.0` / `""` for a key where zero/empty is a legitimate value must be
returned as-is, not overwritten by the coded default. The `ConfigValue` proto is a `oneof`, so
"present-but-zero" is distinguishable from "unset" via `HasField` — the same mechanism the bool
accessor already relies on.

**Precedent**: `xstockstrat-analysis`'s watcher already added `get_int_present` (`:102`, `HasField`
at `:113`) and `get_float_present` (`:131`, `:142`) for exactly this reason. Indicators and ingest
were never given the equivalent. **Note**: analysis added `_present` variants for **int and float
only** — there is no `get_str_present` anywhere, so the empty-string (`""`) trap is unsolved even in
analysis. The fix should decide whether a string escape hatch is also needed (any key where `""` is a
legitimate stored value) or whether only numeric keys require it.

## Reproduction Steps

1. Register an indicators/ingest int or float key (e.g. `indicators.sandbox.timeout_ms`) and set it to
   `0` via SetConfig.
2. Read the key through the service's config watcher accessor.
3. Observe the coded default (e.g. `5000`) returned instead of the stored `0`.

## Root Cause Hypothesis

Consumer defect: the `or default` idiom conflates falsy-zero with unset. The analysis service was
fixed with `HasField`-based `_present` accessors; that fix was never ported to the indicators and
ingest watchers, which still use the trapping idiom for every non-bool accessor.

## Affected Services

- `xstockstrat-indicators` (`app/config/watcher.py`)
- `xstockstrat-ingest` (`app/config/watcher.py`)

(Two services → full design depth per triage C-0. The fix pattern is already proven in
`xstockstrat-analysis`, which lowers actual debate risk — see context.md.)

## Fix Scope

- [x] No proto changes anticipated (`ConfigValue` already distinguishes 0-from-unset)
- [x] No database migrations anticipated
- [x] No config key changes anticipated
- [ ] Port analysis's `HasField`-based `get_int_present` / `get_float_present` accessors into the
      indicators and ingest watchers, and switch each **0-meaningful** key's read to the `_present`
      accessor. Decide, per DRY guard rail, whether these near-identical accessors should live in one
      shared home rather than a fourth copy across the Python watchers.
- [ ] Decide whether a string escape hatch (`get_str_present`) is in scope (any key where `""` is
      legitimate) — currently unsolved platform-wide.

## Acceptance Criteria

See `acceptance.feature` — a stored `0`/`0.0` for a 0-meaningful indicators/ingest key round-trips as
`0`/`0.0` (test fails on the current `or default` code, passes after the `_present` port). Plus:
existing indicators + ingest tests pass; both services smoke-tested on dev; a scan confirms no
0-meaningful key still routes through a trapping accessor.

## Out of Scope

- Changing the `ConfigValue` proto (already sufficient).
- The `bool` accessors (already `HasField`-safe).
- Non-config-watcher code in either service.
