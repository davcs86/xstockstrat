# Design: strategy-reentry-cooldown

**Created**: 2026-07-24
**Rounds**: 5 (full; termination: approved — implementation-ready, one governance item recorded + gated)
**Approved by**: user @ 2026-07-24T10:19:57Z
**Grounded in**: recon.md

---

## Chosen Approach

A configurable per-strategy re-entry cooldown, enforced by a **single shared pure helper** used
identically by the backtest engine and the live evaluation loop, with durable per-`(strategy, symbol)`
last-exit state for the live path only.

### Proto (additive, non-breaking)

`optional int32 cooldown_days = 9;` on `StrategyDefinition`
(`packages/proto/analysis/v1/analysis.proto:216-225`, field 9 free per recon Codebase Map). **`optional`
is mandatory, not stylistic**: `HasField("cooldown_days")` is only legal on an explicit-presence field,
and presence is the only way to distinguish "author left it unset" (→ platform default) from "author
explicitly set 0" (→ genuine no-cooldown). Calling `HasField` on a plain scalar like `active = 7` raises
`ValueError` at the protobuf API level.

**Semantics (supersedes the product spec's original FR-1 literal "0/unset both → default"):**
- **unset** (no `HasField`) → apply the platform default (`analysis.strategy.default_cooldown_days`, 31).
- **explicit `0`** → genuine no-cooldown (immediate re-entry allowed).
- **negative** → rejected at write time with `INVALID_ARGUMENT`.

This behavior change was surfaced with its safety edge (a caller sending `0` expecting the documented
"0 → 31" now gets zero protection) and **approved by the user at the design gate** (2026-07-24). The
product spec's FR-1 / FR-2 / AC-2 / AC-11 are reconciled to these semantics in the same change.

### Shared helper — `services/xstockstrat-analysis/app/services/cooldown.py` (new module)

Pure functions, no DB/gRPC/proto imports:
- `effective_cooldown_days(cooldown_days: int | None, default_cooldown_days: int) -> int` — `None`
  (unset) → default; any int **including 0** returned as-is (never remaps 0 → default).
- `is_cooldown_active(last_exit_at: datetime | None, current_ts: datetime, cooldown_days: int) -> bool`:
  - `last_exit_at is None` → `False` (a never-exited pair is never gated; keeps the first entry ungated).
  - else `_require_aware(last_exit_at)` and `_require_aware(current_ts)` (raise `ValueError` on a naive
    datetime — the tz-awareness invariant is enforced **inside the helper**, the actual chokepoint, not
    by a comment at each call site), then `return current_ts < last_exit_at + timedelta(days=cooldown_days)`.
  - **Strict `<`, half-open window `[last_exit, last_exit + N days)`**: a re-entry exactly `N` days after
    the exit is allowed. Explicit `cooldown_days == 0` → `current < last_exit + 0` → always `False` →
    immediate re-entry.
  - **Calendar-day delta on aware-UTC timestamps**, not a trading-day/bar count — matches FR-3's literal
    text; a market-data gap makes the wait longer in real time, never shorter (the safe direction).

### Both call sites feed the helper the SAME time-source kind: bar time

- **Backtest** (`_backtest_symbol_evaluated`, `servicer.py:770-915`): `cooldown_days` computed once per
  symbol-run via `definition.cooldown_days if definition.HasField("cooldown_days") else None` →
  `effective_cooldown_days(...)`; a scalar local `last_exit_time: datetime | None = None` (alongside the
  existing `entry_time`, `servicer.py:836`); per-bar `current_dt = bar.time.ToDatetime(tzinfo=UTC)`; the
  entry gate at `servicer.py:849` gains `and not is_cooldown_active(last_exit_time, current_dt,
  cooldown_days)`; the exit branch (`servicer.py:859`) sets `last_exit_time = current_dt`. Ephemeral,
  per-`RunBacktest`, never touches the DB (FR-7).
- **Live loop** (`_eval_pair`, `live_loop.py:109-144`): `current_bar_dt = bars[-1].time.ToDatetime(
  tzinfo=UTC)` (bar time, **not** `datetime.now(UTC)` — durability comes from persisting the value, not
  from which clock produced it; bar time keeps the two call sites semantically identical and honors
  FR-3). New in-memory `self._last_exit_at: dict[tuple[str,str], datetime]` parallel to `_last_state`.
  The exit branch sets `self._last_exit_at[key] = current_bar_dt` and calls `await
  self._write_cooldown(...)`; the entry branch suppresses on `is_cooldown_active(...)`.

### `_write_cooldown` isolation (fixes the round-3 wedge bug)

`_write_cooldown` wraps its DB upsert in its **own** `try/except → log.warning` (mirroring `_emit_ledger`,
`live_loop.py:169-186`), so a DB failure can **never** propagate out of `_eval_pair` and can never prevent
`self._last_state[key] = new_state` from executing. This is complementary to — not redundant with — the
outer per-pair guard in `_run_cycle` (`live_loop.py:85-93`), which only prevents one pair from killing the
whole cycle. Without the inner guard, a failed write would leave the pair stuck "in position", freezing all
future entry/exit alerting for it until the DB recovered.

### Persistence — migration `009` + repository + boot hydration

- Migration `009_strategy_cooldowns.{up,down}.sql` (next free after `008_backtest_details`, which
  merged from main-dev via feature `068-backtest-results-visualization`), mirroring `007`'s style
  (schema-prefixed `analysis.strategy_cooldowns`, `IF NOT EXISTS`, composite PK, symmetric down):
  `(strategy_id TEXT NOT NULL, symbol TEXT NOT NULL, last_exit_at TIMESTAMPTZ NOT NULL, PRIMARY KEY
  (strategy_id, symbol))`. **No `cooldown_days` snapshot column** — the live definition is re-read at
  check time (a cooldown edit should take effect immediately, and FR-9 already treats it as a definition
  change). `asyncpg` returns `TIMESTAMPTZ` as aware datetimes, satisfying the helper's contract with no
  conversion at the hydration site.
- `StrategyCooldownsRepository` mirrors `StrategyScoresRepository`'s upsert-on-PK shape
  (`strategy_scores.py:26-32`): `upsert(strategy_id, symbol, last_exit_at)`, `list_all()`. Reuses the
  existing `db_pool` — no new pool (**F-06**, budget stays 2).
- `LiveEvaluationLoop.__init__` gains `cooldowns_repo: StrategyCooldownsRepository | None = None`
  (**default `None`**, no-op fallback). `main.py` wires `StrategyCooldownsRepository(db_pool) if db_pool
  is not None else None`, matching the existing `db_pool is not None` gate at `main.py:84`; whenever a DB
  exists in production the repo is wired, so there is no silent durability loss. `hydrate_cooldowns()` on
  `LiveEvaluationLoop` (mirrors `hydrate_scores()`, `servicer.py:1216-1227`) populates `_last_exit_at`
  from `list_all()` at boot, called from `main.py` best-effort alongside `hydrate_scores()`
  (`main.py:89`). The `None`-default keeps the existing 7-kwarg `_make_loop()` test fixture
  (`test_live_loop.py:24-32`, 5 call sites `:46,65,75,94,124`) working unchanged.

### Validation (FR-6)

In `_validate_definition` (`evaluator.py:276`, shared by write-time `_validate_definition_proto`,
`servicer.py:158-169`, and the runtime evaluate path, `evaluator.py:140`):
`if definition.HasField("cooldown_days") and definition.cooldown_days < 0: raise ValueError("cooldown_days
must be >= 0")`. Unset never triggers it (no `HasField`); explicit `0` passes. Reuses the existing
`ValueError → context.abort(INVALID_ARGUMENT)` wrapper.

### Agent reachability (FR-10)

- `tools.py:290-298`: add `cooldown_days: int | None = None`; forward with `if cooldown_days is not None:
  definition["cooldown_days"] = cooldown_days` (an **`is not None`** check, not the truthy
  `if signal_params:` pattern — `0` is falsy and must not be dropped).
- `client.py:283-290`: add `cooldown_days=definition.get("cooldown_days")` as an ordinary constructor
  kwarg (protobuf treats `field=None` as omitted — verified against the runtime; no special-case
  post-construction assignment needed). This is the FR-10 gap recon found (`client.py` builds the message
  field-by-field, not from a dict spread).
- `docs/runbooks/mcp-tools.md:308-336`: add a `cooldown_days` row to the `manage_strategy` parameter
  table (and a negative-value note to the errors table).

### UI reachability (FR-11) — presence handled honestly

Context7-confirmed protobuf-es contract: `optional int32` generates `cooldownDays?: number | undefined`
(`undefined` when unset, a number incl. `0` when set), and assigning `msg.cooldownDays = 0` sets presence
**true** — so `0` in an init object is NOT the same as omitting the key. In `StrategyWizard.tsx`:
- `parseCooldownDays(raw)` returns `{valid:true, value: number | undefined}` — blank → `value: undefined`
  (OMIT the key); `"0"` → `value: 0` (explicit); negative/non-integer → `{valid:false, error}`.
- Seed `initial?.cooldownDays !== undefined ? String(initial.cooldownDays) : ''` (**not `?? 0`** — that
  collapses unset and explicit-0 and would silently write `cooldown_days: 0` onto a pre-existing strategy
  the first time any unrelated field is edited).
- `handleSubmit` payload: `...(cd.value !== undefined ? { cooldownDays: cd.value } : {})` — blank omits
  the key (server applies default); `"0"` sends `cooldownDays: 0`.
- Cooldown numeric input in Step 1 (Identity — strategy-level, like `strategy_id`/`display_name`), with
  `placeholder="31 (default)"`; real-time inline validity folded into `canAdvance`'s step-1 branch (a user
  cannot advance past step 1 with an invalid value), plus a defensive re-check in `handleSubmit`;
  `stepForError` gains `if (m.includes('cooldown')) return 1;`.
- e2e `mock-backend.ts`: `getStrategy` fixture gains `cooldownDays: 14` (non-zero, distinct from the 31
  default) so an edit-mode-prepopulation Playwright case can assert the input pre-fills `"14"`.

### Fingerprint (FR-9)

`cooldown_days` is a behavioral field, so it is **not** added to `_FINGERPRINT_EXCLUDED_KEYS`
(`servicer.py:1678`) — editing it changes the fingerprint and, per the existing `ManageStrategy` UPDATE
path (`servicer.py:1300-1312`), resets the strategy's accumulated cross-stock score evidence. Intentional,
identical to any entry/exit rule edit. No code change needed beyond leaving the exclusion set alone.

## Rejected Alternatives

- **Plain `int32 cooldown_days` + "`0` reads as default" (the original spec mechanism)** — rejected: cannot
  express an explicit no-cooldown strategy, and `HasField` is illegal on a plain scalar. (User weighed the
  safety trade-off at the gate and chose explicit-0-settable.)
- **Wall-clock (`datetime.now(UTC)`) for the live cooldown clock** — rejected: deviates from FR-3's literal
  "bar timestamps", drifts the effective cooldown with polling/detection latency, and feeds the shared
  helper a different time-source than the backtest side (reproducing the 056 divergence in spirit). Bar
  time is already fetched in `_eval_pair`.
- **`cooldown_days` snapshot column on `strategy_cooldowns`** — rejected: re-reading the live definition is
  simpler and avoids staleness when an operator shortens the cooldown after an exit.
- **Post-construction attribute assignment in `client.py`** (round 2) — rejected: rested on a false premise
  (protobuf omits `field=None` in the constructor already); a plain kwarg is correct and consistent.
- **`cooldowns_repo` as a required constructor param** — rejected: breaks the shared 7-kwarg `_make_loop`
  fixture and contradicts `main.py`'s existing `db_pool is not None` gate; `= None` default is cleaner.
- **Fix `ConfigWatcher.get_int`'s zero-trap in this feature** — rejected: it is a service-wide shared
  helper (every int config key) with its own regression surface; document the trap (matching the
  `analysis.scoring.shrinkage_days` precedent) instead.

## Open Risks

- [ ] **Cross-restart durability on a failed write (accepted, mirrors `strategy_scores`)** — the cooldown
  write is best-effort. If a live exit's DB upsert fails AND the process restarts before any later
  successful write for that pair, that exit's durable cooldown is lost (no retry queue), reverting the pair
  to "no cooldown" post-restart. In-memory enforcement stays correct until the restart; only cross-restart
  durability is at risk, and only on a failed write. Accepted for v1. — record in `context.md` Open Threads.
- [ ] **Product-spec AC reconciliation must land with the change** — FR-1 / FR-2 / AC-2 / AC-11 currently
  say "0/unset both → default 31"; they are being reconciled to "unset → default, explicit 0 → no-cooldown".
  `/sdd-spec` must not author a test asserting `0 → 31`, and the e2e must assert blank→omitted / `0`→present.
  — addressed at `/sdd-spec`.
- [ ] **Config default zero-trap documented, not fixed** — an operator setting
  `analysis.strategy.default_cooldown_days = 0` platform-wide silently gets 31 (`get_int` zero-trap).
  Per-strategy explicit-0 works fine (proto presence). Document in the CLAUDE.md config row. — at the config/docs step.
- [ ] **Two existing-test-fixture updates are same-step scope** — the `cooldowns_repo=None` param needs the
  new bar mock (`test_live_loop.py:33`, real `Timestamp`-backed `.time`) added in the same step that adds
  bar-time reading to `_eval_pair`, or `:46/:75/:124` break. — at the live-loop service+test step.
- [ ] **`mock-backend.ts` echo of an unset field unverified** — `/sdd-spec` must confirm `GetStrategy`
  round-trips presence faithfully (unset stays unset, not echoed as a resolved 31 or literal 0), else the
  edit-mode seed shifts. — at the UI/e2e step.

## Constitution Rules Touched

- **C-01** (evidence-cited) — honored: every design claim cites a recon `path:line`; the protobuf-es
  presence contract is Context7-grounded, to be pinned by an e2e round-trip assertion at `/sdd-spec`.
- **C-04** (enums over strings) — n/a: `cooldown_days` is a numeric scalar, not a closed value set.
- **C-05 / F-07** (config governance / no hardcoded values) — honored: `analysis.strategy.default_cooldown_days`
  follows `<service>.<category>.<key>` and is read via `get_int`, never hardcoded (the UI's `31` placeholder
  is an informational hint only, server stays authoritative).
- **C-07 / F-01** (migration naming / never edit applied migration) — honored: new `009_strategy_cooldowns.
  {up,down}.sql`, next free number, up+down pair, no existing migration edited.
- **C-08 / P-06** (test pairing / red-before-green) — honored: parity test (backtest vs live agree on the
  same inputs), restart-durability test, reproducibility-isolation test, fingerprint-change test,
  negative-value rejection test, naive-datetime-guard unit test, agent round-trip tests, UI e2e; the two
  existing `test_live_loop.py` fixture updates are explicit same-step scope.
- **C-10(b)** (duplicated-surface parity) — honored: one shared `is_cooldown_active` helper for both call
  sites, fed the same bar-time source, with a parity test; the tz-awareness invariant enforced inside the
  helper rather than by convention.
- **F-06** (20-connection pool budget) — honored: the new repo reuses the existing `db_pool`; no new pool.
- **P-03 / P-04** (no silent deviation / phase-gate approval) — honored: the FR-1 semantic supersession was
  surfaced with its safety edge and approved by the user at the design gate; the contradicting ACs are
  reconciled in the same change, not silently carried into `/sdd-spec`.
