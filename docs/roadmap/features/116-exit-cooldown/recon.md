# Recon: exit-cooldown

**Created**: 2026-08-07
**From**: product-spec.md
**Affected services**: xstockstrat-analysis, xstockstrat-agent, xstockstrat-ui, packages/proto

---

## Objective

Add a per-strategy exit cooldown — a minimum holding period in calendar days after entry, before
`StrategyDefinition.exit_rule` may fire a sell — mirroring feature 069's re-entry cooldown
(`cooldown_days`, which gates re-entry after an exit) but gating the opposite transition. Reachable
via the backtest engine, the live evaluation loop, the `manage_strategy`/`get_strategy` MCP tools,
and the `StrategyWizard` UI (Step 1 — Identity).

## Codebase Map

- **`xstockstrat-analysis`** (Python, gRPC `50056`)
  - Proto: `packages/proto/analysis/v1/analysis.proto:249-267` — `StrategyDefinition` fields 1–10 all
    in use (`cooldown_days` = field 9, `optional int32`; `warnings` = field 10) → **next free field
    number is 11**. `ManageStrategyRequest.update_mask` allowed-paths comment at `:291`.
  - Pure gate module: `services/xstockstrat-analysis/app/services/cooldown.py` (51 lines, full) —
    `effective_cooldown_days(cooldown_days, default_cooldown_days)` (`:18-27`), `_require_aware(dt)`
    (`:30-33`, raises on naive datetime), `is_cooldown_active(last_exit_at, current_ts, cooldown_days)`
    (`:36-50`, half-open `[last_exit_at, last_exit_at+N)`). No DB/proto/gRPC imports (pure).
  - Durable state: `services/xstockstrat-analysis/app/repositories/strategy_cooldowns.py:14-37`
    (`StrategyCooldownsRepository.upsert(strategy_id, symbol, last_exit_at)` / `.list_all()`, PK
    upsert) + `services/xstockstrat-analysis/migrations/009_strategy_cooldowns.up.sql:6-11`
    (`analysis.strategy_cooldowns(strategy_id, symbol, last_exit_at, PRIMARY KEY(strategy_id, symbol))`).
    **Last migration in this service is `011_opportunities` → next free NNN is `012`.**
  - Handler: `services/xstockstrat-analysis/app/handlers/servicer.py`
    - Backtest gate: `_backtest_symbol_evaluated`, `:969-1138`. `entry_price`/`entry_time` locals
      already tracked (set `None`/`0.0` at `:1038-1039`; assigned on entry fill at `:1076-1078`;
      cleared on exit fill at `:1102-1105`, where `last_exit_time` is also stamped). Cooldown resolved
      once per symbol-run at `:1046-1053`, gate applied at the entry-fill condition `:1065-1071`.
    - `_row_to_strategy_definition`, `:2965-2977` — builds the proto via
      `json_format.ParseDict(definition_json, StrategyDefinition(), ignore_unknown_fields=True)` then
      overlays `strategy_id`/`display_name`/`active`/`live_enabled` from DB columns. A field carried
      in `definition_json` (as `cooldown_days` already is) needs **no explicit line here** — it
      round-trips via the JSON blob automatically.
    - `_MASKABLE_PATHS`, `:2856-2858` — `frozenset({"display_name", "components", "entry_rule",
      "exit_rule", "signal_params", "cooldown_days"})`. Must gain the new field name.
    - `_definition_fingerprint` / `_FINGERPRINT_EXCLUDED_KEYS`, `:2925-2944` — excluded set is
      `{"display_name", "active", "live_enabled"}`. `cooldown_days` is **not** excluded — it
      participates in the fingerprint today (precedent for FR-9).
    - Write path: `ManageStrategy`, `:1580-1749` — REGISTER builds `definition_json =
      json_format.MessageToDict(definition, preserving_proto_field_name=True)` (`:1603-1609`); UPDATE
      merges via `_apply`/`update_locked` → `new_json = json_format.MessageToDict(...)` (`:1664-1696`).
    - Write-time validation precedent: `services/xstockstrat-analysis/app/services/evaluator.py:351-354`
      — `if definition.HasField("cooldown_days") and definition.cooldown_days < 0: raise ValueError(...)`.
  - Live loop: `services/xstockstrat-analysis/app/engine/live_loop.py` (244 lines, full)
    - `__init__` `:51-76` — state dicts `_last_state` (in-position bool), `_last_alert_ts`,
      `_last_exit_at`; `_cooldowns_repo` param (`:60`, default `None`).
    - `hydrate_cooldowns` `:78-83` — loads `_last_exit_at` from repo at boot.
    - `_eval_pair` `:133-187` — cooldown resolved `:157-160`; entry gate `:163-167`; on exit,
      `_last_exit_at[key]` set and `_write_cooldown` called `:173-174`.
    - `_write_cooldown` `:231-243` — best-effort upsert (swallows exceptions, mirrors `_emit_ledger`).
    - **Confirmed absent** (exhaustive case-insensitive grep for "entry" in this file): **no entry-
      timestamp tracking exists anywhere in `live_loop.py`** — only the boolean `_last_state`. An
      exit-cooldown gate (which needs "time since entry") requires **new** in-memory + durable state,
      not reuse of `_last_exit_at`.
  - Evaluator: `services/xstockstrat-analysis/app/services/evaluator.py:73-78,102-169` —
    `BarDecision(bar_index, entry: bool, exit: bool, conviction: float)`, confirms `.entry`/`.exit`
    booleans exactly as consumed by both call sites.
  - Config: `analysis.strategy.default_cooldown_days` documented at
    `services/xstockstrat-analysis/CLAUDE.md:166`, read at `servicer.py:1051` and `live_loop.py:159`
    via `self._cfg.get_int(key, 31)`.
  - Tests: `services/xstockstrat-analysis/tests/test_cooldown.py:1-65` — pure unit tests of the two
    gate functions only (no DB/gRPC), a direct template for a symmetric exit-side test module.
  - Wiring: `services/xstockstrat-analysis/app/main.py:102-116` constructs
    `LiveEvaluationLoop(..., cooldowns_repo=StrategyCooldownsRepository(db_pool))` (reuses existing
    pool, no new pool) and `:117-123` calls `hydrate_cooldowns()` best-effort at boot.

- **`xstockstrat-agent`** (Python MCP server)
  - `manage_strategy`, `services/xstockstrat-agent/app/tools.py:442-563` — signature includes
    `cooldown_days: int | None = None`, `clear_fields: list[str] | None = None` (`:449-452`).
    Docstring documents semantics (`:490-494`) and the partial-merge contract (`:496-505`).
    Implementation: `supplied` dict (`:521-529`) → `mask = [name for name, value in supplied.items()
    if value is not None]` (`:530`) → `clear_fields` joins mask without a value (`:534-539`,
    AIP-161 explicit-clear). A new field is added identically: to the parameter list, the `supplied`
    dict, and the docstring.
  - `get_strategy`, `:894-906` — thin passthrough (`return await client.get_strategy(...)`, `:904`);
    the field list at `:897-899` is docstring-only prose, no code change needed beyond updating text.
  - `client.py` gRPC wiring, `:396-454` — `pb_def = analysis_pb2.StrategyDefinition(...,
    cooldown_days=definition.get("cooldown_days"), ...)` (`:425-436`); comment explains
    `definition.get(...)` returning `None` correctly leaves `optional int32` presence unset.
    `get_strategy`, `:457-479` — uses `MessageToDict(resp, preserving_proto_field_name=True,
    always_print_fields_with_no_presence=True)`; comment `:465-467` explains why an unset `optional`
    field stays absent under this flag.
  - Tests (templates): `tests/test_tools.py:646-670` (`test_forwards_cooldown_days`),
    `tests/test_tools.py:1019-1043` (`TestManageStrategyUpdateMask` — mask-only-cooldown, explicit-
    zero-survives), `tests/test_client.py:108-132` (`test_cooldown_days_round_trips_presence`),
    `tests/test_client.py:556-585` (`TestManageStrategyUpdateMask.test_mask_is_attached_and_absent_
    when_not_given`), `tests/test_strategy_builders.py:67` (fixture literal).
  - Docs: `docs/runbooks/mcp-tools.md:448-460` (mutation-guard example), `:462-474` (parameter table
    row), `:487` (error table row), `:493-496` (scoring-relevance note), `:500-531` esp. `:530`
    (`get_strategy` presence-honest description). `plugins/strat-lab/skills/backtest/SKILL.md:44-54`
    esp. `:48` — the **only** `cooldown_days` mention in the strat-lab skill (root `CLAUDE.md`
    requires this skill updated in the same PR as any `manage_strategy` change). No `cooldown_days`
    mention in `plugins/strat-lab/README.md` (confirmed absent).

- **`xstockstrat-ui`** (Next.js)
  - `services/xstockstrat-ui/src/components/insights/StrategyWizard.tsx` — `parseCooldownDays`
    (`:27-39`, blank→`undefined`/non-negative int/else-error); state seed presence-honest, not `?? 0`
    (`:54-58`); `canAdvance` gate wiring (`:102-110`); `stepForError` routing (`:80`, `if
    (m.includes('cooldown')) return 1`); `handleSubmit` request-building — spreads
    `...(cd.valid && cd.value !== undefined ? { cooldownDays: cd.value } : {})` (`:112-135`); Step-1
    JSX field "Re-entry cooldown (days)" (`:192-206`).
  - No hand-written TS interface carries `cooldownDays` — the wizard's `definition` object is typed
    via `StrategyDefinitionInit = MessageInitShape<typeof StrategyDefinitionSchema>`
    (`services/xstockstrat-ui/src/hooks/useStrategyDefinitions.ts:1-10`), auto-derived from the proto
    schema. Adding the proto field + `./scripts/buf-gen.sh` is what surfaces the new field in TS — no
    separate interface edit needed. Mutation hook `useManageStrategy` (`:34-49`) forwards `{
    operation, definition }` straight to `analysisClient.manageStrategy(...)` — no manual field
    mapping in the BFF layer.
  - E2E: `services/xstockstrat-ui/e2e/insights/strategy-authoring.spec.ts:250-358` — full `describe`
    block (feature 069, AC-11): `captureManageStrategy` helper (`:258-269`), `fillToReview(page, id,
    display, cooldown)` (`:271-293`, fills the `'31 (default)'` placeholder), 4 cases: blank-omits
    (`:295-305`), explicit-0-sends-0 (`:307-317`), negative-blocks-step-1 (`:319-329`),
    edit-prepopulates-non-default (`:331-337`, fixture id `strat-cooldown-14`), unrelated-edit-
    preserves-unset (`:339-358`).
  - Mock: `services/xstockstrat-ui/e2e/mock-backend.ts:724-734` — `manageStrategy` handler echoes
    `req.definition` verbatim (no per-field cooldown mapping needed); `:735-761` — `getStrategy`
    handler, cooldown conditional at `:752-754` (`req.strategyId === 'strat-cooldown-14' ? {
    cooldownDays: 14 } : {}`).
  - Fixtures: `services/xstockstrat-ui/e2e/fixtures/INVENTORY.md:17` — "Strategy definitions" row
    (`STRATEGY_DEF_LIVE`, `STRATEGY_DEF_INACTIVE`, `STRATEGY_DEFINITIONS` in
    `e2e/fixtures/strategies.ts:53,67`). `strategyCatalog.ts` (235 lines, full) has no cooldown-
    related content (indicator/rule catalog only) — not a relevant edit site.

## Patterns to REUSE

- **Gate function shape** → reuse `cooldown.py`'s `effective_cooldown_days`/`is_cooldown_active`/
  `_require_aware` shape (`services/xstockstrat-analysis/app/services/cooldown.py:18-50`) — pure,
  no DB/proto/gRPC imports, tz-awareness enforced *inside* the helper (insights.md 2026-07-24: "a
  shared helper reused across paths owns its input-contract enforcement", reinforces C-10(b)).
- **Explicit-presence proto field** → reuse `optional int32 cooldown_days = 9` shape exactly
  (`packages/proto/analysis/v1/analysis.proto:261`) — insights.md 2026-07-24: a scalar whose zero is
  a meaningful distinct choice from "unset" MUST be `optional`.
- **Backtest ephemeral state** → reuse the `entry_time`/`last_exit_time` local-variable pattern in
  `_backtest_symbol_evaluated` (`servicer.py:1038-1039,1076-1078,1102-1105`) — per-run, never touches
  a repo (FR-5/FR-7 ephemerality).
- **Live-loop durable state** → reuse the `_last_exit_at` dict + `StrategyCooldownsRepository` +
  `hydrate_*` + best-effort `_write_*` shape (`live_loop.py:69-83,231-243`;
  `strategy_cooldowns.py:14-37`) as the template for a new entry-timestamp store — **but note the
  table itself needs a new column or a new table** (see Dependencies/Risks — no `last_entry_at`
  column exists).
- **`manage_strategy` partial-update** → reuse the `supplied`-dict → `is not None` mask →
  `clear_fields`-joins-mask shape verbatim (`app/tools.py:521-539`) — do NOT regress the feature-070
  "send only what's supplied" fix (fails.md/insights.md 2026-08-06 "strategy-partial-update").
- **`client.py` presence-honest gRPC construction** → reuse `definition.get("cooldown_days")` (bare
  dict `.get`, returns `None` when absent → proto presence stays unset) (`client.py:425-436`).
- **UI presence-honest parsing** → reuse `parseCooldownDays` verbatim shape
  (`StrategyWizard.tsx:27-39`) and the `?? 0`-avoidance state-seed pattern (`:54-58`).
- **Test-data inventory (C-12)** → reuse `STRATEGY_DEF_LIVE`/`STRATEGY_DEFINITIONS`
  (`e2e/fixtures/strategies.ts:53,67`, cataloged `INVENTORY.md:17`); extend with a new sentinel id
  (mirroring `strat-cooldown-14`) rather than inventing a new fixture module.
- **Pure-function test template (C-13, Python)** → reuse `tests/test_cooldown.py`'s structure
  (unset-uses-default / explicit-zero / passthrough / never-triggered-false / inside-window-true /
  boundary-false / naive-datetime-rejected) for a symmetric exit-side test module — no DB/gRPC mocks
  needed for the pure gate.

## Dependencies

- Proto/RPC: `StrategyDefinition` (`packages/proto/analysis/v1/analysis.proto:249-267`) — next free
  field number **11**. `ManageStrategyRequest.update_mask` allowed-paths comment at `:291` needs the
  new field name appended.
- Migration: next number **`012`** for `services/xstockstrat-analysis/migrations/` (last is
  `011_opportunities`).
- Config keys: new `analysis.strategy.*` key (exact name — design decision), pattern:
  `self._cfg.get_int("analysis.strategy.default_cooldown_days", 31)` at `servicer.py:1051` /
  `live_loop.py:159` is the template; document in `services/xstockstrat-analysis/CLAUDE.md`'s Config
  Keys table (currently `:166`) per C-05.
- Inter-service edges: none new — the feature is entirely internal to `xstockstrat-analysis`'s own
  strategy engine plus its two existing consumer surfaces (agent, UI). No new gRPC edges.
- New env vars / ports: none.

## Risks / Not-found

- **No entry-timestamp tracking exists anywhere in `live_loop.py`** (confirmed via exhaustive grep) —
  the exit-cooldown gate needs genuinely new in-memory state (`_last_entry_at` or equivalent) AND a
  new durable store, unlike the entry-side gate which could reuse existing `_last_exit_at`
  end-to-end. This is more implementation surface than feature 069's entry-side gate, not a
  symmetric drop-in.
- **No `UpdateStrategyRequest` proto message exists** — partial update travels via
  `ManageStrategyRequest.update_mask` (confirmed via full proto read, not a search miss).
- **`fails.md` 2026-07-01 "056-open-positions-ui" (C-10(b))**: a value with an authoritative
  computation must be surfaced consistently by every read/mapper path — applies here to
  `_row_to_strategy_definition` / `_MASKABLE_PATHS` / `_definition_fingerprint` all needing the new
  field name added in the same step, not just the proto.
- **`fails.md` 2026-08-05 "live-strategy-alert-engine"**: adding a proto/DB field without updating
  the row-to-proto mapper in lockstep was only caught by tests — directly on point; the exit-cooldown
  field's *definition* round-trips automatically via `definition_json` (unlike `live_enabled`, which
  is a real DB column), but the **durable entry-timestamp state is a genuinely new column/table**,
  which is exactly the shape of field this ledger entry warns about.
- **`insights.md`/`fails.md` 2026-08-06 "strategy-partial-update"**: audit every payload-building
  caller (not just the server merge) for silent-default fabrication before declaring a partial-update
  field "done" — applies to `client.py`'s `pb_def = analysis_pb2.StrategyDefinition(...)`
  construction, which must use `.get(...)` (returns `None`, presence-safe) for the new field exactly
  as it does for `cooldown_days`.
- **Open design question**: does the exit-cooldown gate belong in `cooldown.py` (whose docstring
  currently says "Shared **re-entry** cooldown gate") — extend/rename that module, or add a new
  sibling module? Both are viable; not resolved by recon, carried to Phase 1 for the debate (see
  product-spec Open Questions).
- **Open design question**: does durable entry-timestamp state extend `analysis.strategy_cooldowns`
  (new `last_entry_at` column, migration `012`) or become a new table? Recon confirms today's table
  has only `(strategy_id, symbol, last_exit_at)` — no existing column to reuse either way.
- **Open design question**: whether `_FINGERPRINT_EXCLUDED_KEYS` should gain the new field (recon
  shows `cooldown_days` is currently *included*, i.e. changing it clears the derived grade — FR-9
  says the new field should behave the same way, i.e. stay out of the exclusion set — this is a
  low-risk default, not a genuine fork, but the adversary should confirm).

## Recommended Scope

**Superseded by `design.md` (rounds 1–6) — kept here only as the story-time starting point.**
`design.md`'s Chosen Approach is the authoritative source for `/sdd-spec`; steps 3 and 5 below are
stale relative to it (design.md adds the shared `_apply_transition`/`_replay_state` core, the
boot-time `entry_backfill.py` module + `main.py` wiring, a second config key
(`analysis.strategy.max_concurrent_entry_backfill`), and the skip-until-known guard + required
diagnostic log + 3 paired tests — none of which existed when this list was first drafted in Phase 0).
Advisory step boundaries for `/sdd-spec` (not binding), updated to reflect the approved design:
1. Proto: add `optional int32 exit_cooldown_days = 11` to `StrategyDefinition`; update
   `ManageStrategyRequest.update_mask` comment; regen stubs.
2. Analysis: extend the pure gate module with the renamed, direction-neutral gate parameter +
   dedicated unit tests (mirrors `test_cooldown.py`).
3. Analysis: migration `012` — `analysis.strategy_cooldowns` gains `last_entry_at`; repository gains
   `upsert_entry`; migration/repo docstrings updated for the table's now-dual purpose.
4. Analysis: backtest engine gate (`_backtest_symbol_evaluated`) — reuse existing ephemeral
   `entry_time` local.
5. Analysis: live-loop gate — factor `_apply_transition` out of `_eval_pair`'s gating block; add the
   module-level `_replay_state` (bar-replay, lazy, first-cycle-since-restart); new `_last_entry_at`
   dict + `_write_entry_cooldown`; the skip-until-known combined guard (design.md's finalized
   snippet) + required throttled diagnostic log + the 3 required paired tests
   (suppression/resolution/isolation).
6. Analysis: new `app/engine/entry_backfill.py` (boot-time-only, imported by `main.py` alone, never
   by `live_loop.py`) — `_infer_open_entry_time` (unfiltered `ListOrders`, `filled_qty`-based signed
   balance, `updated_at` anchor), semaphore-bounded fan-out, `main.py` wiring as its own
   `asyncio.create_task` (not blocking `run_forever()`); new config key
   `analysis.strategy.max_concurrent_entry_backfill`.
7. Analysis: `_MASKABLE_PATHS` + config key (`analysis.strategy.default_exit_cooldown_days` via
   `get_int_present`) + `CLAUDE.md` doc + write-time validation (mirrors `evaluator.py:351-354`).
8. Agent: `manage_strategy` parameter + `client.py` gRPC construction + docstrings + tests.
9. Agent: `docs/runbooks/mcp-tools.md` + `plugins/strat-lab/skills/backtest/SKILL.md` updates.
10. UI: `StrategyWizard.tsx` field + `handleSubmit` wiring + e2e tests + `mock-backend.ts` sentinel.
11. Cross-cutting: fingerprint participation confirmation (no exclusion-set change), backtest/live/
    replay parity test (FR-4, fold-equivalence between `_replay_state` and sequential
    `_apply_transition` calls).
