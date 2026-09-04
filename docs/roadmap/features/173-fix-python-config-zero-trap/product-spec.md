# Product Spec: fix-python-config-zero-trap

**Type**: bug
**Defect Report**: `docs/reports/2026-09-04-comment-audit-triage.md` (item 3)
**Severity**: SEV-2
**Created**: 2026-09-04
**Last Updated**: 2026-09-04 (sdd-review: FRs + consumer-surface + concrete keys)

---

## Problem Statement

**Observed**: the config-watcher accessors in indicators and ingest coalesce with `or default`:

- `services/xstockstrat-indicators/app/config/watcher.py` — `get_str` (`:92` `v.string_val or default`),
  `get_int` (`:100` `v.int_val or default`), `get_float` (`:116` `v.float_val or default`).
- `services/xstockstrat-ingest/app/config/watcher.py` — same shape: `get_str` (`:105`),
  `get_int` (`:113`), `get_float` (`:129`).

Because `0`, `0.0`, and `""` are falsy in Python, a value an operator deliberately stores as `0` /
`0.0` / `""` is indistinguishable from "unset" and silently reverts to the hardcoded default. Only
the `bool` accessor is safe (both watchers already use `v.HasField("bool_val")` at `:108` / `:121`).

**Concrete impact — this is not defensive-only.** Two ingest keys are genuinely 0-meaningful today:

- **`ingest.backfill.max_retry_attempts`** (default 3): `0` means "make no retry attempts". It is
  consumed at `services/xstockstrat-ingest/app/handlers/servicer.py:521`
  (`self._cfg.backfill_max_retry_attempts if self._cfg.backfill_retry_on_failure else 0`) — passed
  straight through with **no re-clamp**, so an operator who sets it to `0` (leaving
  `retry_on_failure=true`) intends zero attempts but silently gets **3**.
- **`ingest.signals.dedup_window_hours`** (default 24): `0` means "no dedup window" (disable
  windowed dedup). Today a stored `0` silently reverts to `24`.

(Additional candidates whose `0`-semantics the design must confirm: `ingest.backfill.max_concurrent_jobs`
and `ingest.backfill.max_concurrent_chunks`, where `0` plausibly means "disable".)

**Indicators is different.** Its consumed numeric keys — `indicators.sandbox.timeout_ms`,
`indicators.sandbox.memory_bytes` — are **not** 0-meaningful (a `0`ms timeout / `0`-byte cap is
nonsensical), so the numeric port there is **hardening** (guards a future 0-meaningful key), not a
live bug. Indicators' only current 0/empty-meaningful key is the **string**
`indicators.sandbox.allowed_imports` — where `""` legitimately means "allow no imports" — and that
needs a `get_str_present` accessor that does **not exist in any service** today. See Open Questions.

**Expected**: a stored `0` / `0.0` / `""` for a key where zero/empty is a legitimate value is
returned as-is, not overwritten by the coded default. The `ConfigValue` proto is a `oneof`, so
"present-but-zero" is distinguishable from "unset" via `HasField` — the mechanism the bool accessor
already relies on.

**Precedent**: `xstockstrat-analysis`'s watcher already added `get_int_present`
(`services/xstockstrat-analysis/app/config/watcher.py:102`, `HasField` at `:113`) and
`get_float_present` (`:131`, `:142`) for exactly this reason. Indicators and ingest were never given
the equivalent. Analysis added `_present` variants for **int and float only** — there is no
`get_str_present` anywhere (grep-confirmed), so the empty-string trap is unsolved platform-wide.

## Functional Requirements

- **FR-1** — Add the `HasField`-based present-aware accessors needed by the confirmed 0-meaningful
  keys, porting the proven `xstockstrat-analysis` implementation rather than reinventing it.
  **Resolved in design (2026-09-04, signed off)**: `get_int_present` → **ingest** only (its two
  0-meaningful keys are int; `get_float_present` is dropped as consumerless dead API — OQ-3);
  a net-new `get_str_present` → **indicators** only (for `allowed_imports=""`). See `design.md`.
- **FR-2** — Route each confirmed **0-meaningful** ingest key through the present-aware accessor so a
  stored `0` is honored end-to-end. Confirmed set: `ingest.backfill.max_retry_attempts`,
  `ingest.signals.dedup_window_hours`. Design confirms whether `max_concurrent_jobs` /
  `max_concurrent_chunks` join the set.
- **FR-3** — Lock the fix with a regression test asserting the present-aware accessor contract (a
  present `int_val=0` returns `0`; an absent field returns the coded default), and an audit
  confirming no 0-meaningful key still routes through a trapping (`or default`) accessor.

## Reproduction Steps

1. Register/seed `ingest.backfill.max_retry_attempts` and set it to `0` via SetConfig (leave
   `ingest.backfill.retry_on_failure` at its `true` default).
2. Trigger a backfill that hits a transient failure.
3. Observe the job retrying up to **3** times (the coded default) instead of making **0** attempts —
   the operator's `0` was silently discarded by `get_int`'s `or default`.

## Root Cause Hypothesis

Consumer defect: the `or default` idiom conflates falsy-zero with unset. The analysis service was
fixed with `HasField`-based `_present` accessors; that fix was never ported to the indicators and
ingest watchers, which still use the trapping idiom for every non-bool accessor. (Re-confirms CF-N10.)

## Affected Services

- `xstockstrat-ingest` (`app/config/watcher.py`, plus the read sites in `app/handlers/servicer.py`) —
  the service with confirmed 0-meaningful keys (primary).
- `xstockstrat-indicators` (`app/config/watcher.py`) — subject to OQ-3 (numeric port is hardening;
  string case is OQ-1).

(Two services → full design depth per triage C-0. The fix pattern is already proven in
`xstockstrat-analysis`, which narrows actual debate risk — see context.md.)

## Consumer Surface(s)

**None — internal/platform-only.** This changes the behavior of internal config-watcher accessors;
it adds no gRPC RPC, no response field, and no UI. There is one operator-visible *behavioral* edge,
not a new surface: after the fix, an operator who sets a 0-meaningful key to `0` via config-ui or the
agent `set_config` tool will see it take effect instead of silently reverting to the default. That is
a correctness change to an existing surface (the value already round-trips through config), so no
consumer-surface implementation step is required. (**C-14**)

## Fix Scope

- [x] No proto changes anticipated (`ConfigValue` already distinguishes 0-from-unset via the `oneof`)
- [x] No database migrations anticipated (the 0-meaningful keys already exist / are already seeded)
- [x] No config key changes anticipated (no new keys; behavior of existing reads only)
- [ ] FR-1/FR-2: port the `_present` accessors and switch the confirmed 0-meaningful key reads.
- [ ] FR-3: regression test + trapping-accessor audit.
- [ ] DRY guard rail (OQ-2): decide whether the near-identical `_present` accessors live in one shared
      home consumed by indicators/ingest/analysis rather than a fourth per-service copy.

## Open Questions

Resolved in `/sdd-design`:

- **OQ-1** — Is a `get_str_present` string escape hatch in scope? `indicators.sandbox.allowed_imports`
  = `""` (deny all imports) is the only current empty-meaningful string key; no service has
  `get_str_present` today. In scope for this fix, or a separate follow-up?
- **OQ-2** — DRY: single shared home for the present-aware accessors vs a per-service copy (a fourth
  copy otherwise). (DRY guard rail.)
- **OQ-3** — Does indicators stay in scope for the numeric port now (hardening, no current
  0-meaningful numeric key), or is it deferred until it has one? Report CF-N10 names both services.
- **OQ-4** — For `max_retry_attempts`, `retry_on_failure=false` already disables retries; confirm that
  honoring `0` attempts distinctly (with the bool `true`) is the intended semantics.

## Acceptance Criteria

See `acceptance.feature` — a stored `0` for a confirmed 0-meaningful ingest key (`max_retry_attempts`,
`dedup_window_hours`) round-trips as `0` (each scenario fails on the current `or default` code, passes
after the `_present` port). Plus: existing indicators + ingest tests pass; both services smoke-tested
on dev; the FR-3 audit confirms no 0-meaningful key still routes through a trapping accessor.

## Out of Scope

- Changing the `ConfigValue` proto (already sufficient).
- The `bool` accessors (already `HasField`-safe).
- Non-config-watcher code in either service, beyond the read sites that consume a re-routed key.
