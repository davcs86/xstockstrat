# Recon: strategy-reentry-cooldown

**Created**: 2026-07-24
**From**: product-spec.md
**Affected services**: `xstockstrat-analysis`, `packages/proto`, `xstockstrat-agent`, `xstockstrat-ui`

---

## Objective

Add a configurable per-strategy re-entry cooldown (`StrategyDefinition.cooldown_days`, calendar
days, default 31 via `analysis.strategy.default_cooldown_days`) so a rule-based strategy cannot
immediately whipsaw back into a symbol the bar after an exit. Enforced per `(strategy_id, symbol)`
identically in the backtest engine (ephemeral, per-run) and the live evaluation loop (durably
persisted, survives restart), and reachable end-to-end through the `manage_strategy` MCP tool and
the `StrategyWizard` UI form.

## Codebase Map

- **`xstockstrat-analysis`** (Python)
  - Entry point: `app/main.py:38` (`async def serve()`); `db_pool` created `app/main.py:47-49`
    (`asyncpg.create_pool(..., max_size=int(os.environ.get("DB_POOL_MAX", "2")))`); `live_loop`
    constructed `app/main.py:97-105`; `hydrate_scores()` boot call `app/main.py:89` (best-effort,
    gated on `db_pool is not None` at `main.py:84`).
  - Handler/servicer: `app/handlers/servicer.py`
    - `RunBacktest`: `servicer.py:171`; equity carry-forward `servicer.py:293-294`; per-symbol loop
      `servicer.py:306-401` calling `_backtest_symbol_evaluated` at `servicer.py:309`.
    - `_backtest_symbol_evaluated`: `servicer.py:770-915`. Locals `position`/`entry_price`/
      `entry_time` init at `servicer.py:834-836`. Entry gate `servicer.py:849`
      (`if position == 0.0 and decision.entry:`); exit gate `servicer.py:859`
      (`elif position > 0.0 and decision.exit:`).
    - `ManageStrategy`: `servicer.py:1265` (REGISTER/UPDATE/DEACTIVATE at 1277/1286/1314).
      Validation entry: `_validate_definition_proto` `servicer.py:158`, wraps
      `_validate_definition` (`app/services/evaluator.py:276`) in
      `try/except ValueError as e: await context.abort(INVALID_ARGUMENT, str(e))`
      (`servicer.py:168-169`).
    - `_definition_fingerprint`: `servicer.py:1681-1697`; exclusion set `servicer.py:1678`
      (`_FINGERPRINT_EXCLUDED_KEYS = frozenset({"display_name", "active", "live_enabled"})`).
    - `hydrate_scores()`: `servicer.py:1216-1227`.
  - Live loop: `app/engine/live_loop.py:36` (`class LiveEvaluationLoop`); `_last_state`
    `live_loop.py:54` (`dict[tuple[str, str], bool]`); `_eval_pair` `live_loop.py:109-144`
    (entry read `:123,128`; exit read `:130`; state write `:144`).
  - Last migration: `007_backtest_run_symbols.{up,down}.sql`
    (`services/xstockstrat-analysis/migrations/`).
  - Config-read pattern: `servicer.py:1082` (`self._cfg.get_int("analysis.scoring.shrinkage_days", 250)`).
  - Repositories: `app/repositories/strategy_scores.py:26-32` (upsert-on-PK, single row per key —
    closest analog for a new cooldown repo); `app/repositories/backtest_run_symbols.py:19-63`
    (bulk-insert analog, less relevant here).

- **`packages/proto`**
  - `StrategyDefinition`: `packages/proto/analysis/v1/analysis.proto:216-225`. Fields 1-8 in use
    (`strategy_id`…`live_enabled`); field `9` free. Only `signal_params` (field 6) is a
    `google.protobuf.Struct` — not the right shape for `cooldown_days` (a closed scalar), which
    should follow the plain-scalar style of `active = 7` / `live_enabled = 8`.

- **`xstockstrat-agent`** (Python)
  - Tool: `app/tools.py:289-347` (`manage_strategy`, signature `:290-298`, docstring `:299-334`,
    `definition` dict build `:335-341`, `signal_params` conditional-include pattern `:342-343`).
  - **Client**: `app/client.py:248-305` (`manage_strategy`). Builds `StrategyDefinition(...)` via
    **explicit named kwargs** (`client.py:283-290`) — `strategy_id`, `display_name`, `components`,
    `entry_rule`, `exit_rule`, `active` — then separately merges `signal_params` as a `Struct`
    (`:291-295`). This is NOT a generic dict pass-through.
  - Tests: `tests/test_tools.py:336-361` (`TestManageStrategyTool`); `tests/test_client.py:80-109`
    (`TestManageStrategyClient`).
  - Docs: `docs/runbooks/mcp-tools.md:308-336` (`### manage_strategy` — parameter table `:314-322`,
    return shape `:324-328`, errors table `:330-335`).

- **`xstockstrat-ui`** (Next.js/TypeScript)
  - `src/components/insights/StrategyWizard.tsx` (409 lines): props/state `:42-74`; `canAdvance`
    `:105-113`; `handleSubmit` `:115-136` (builds `definition` — no `cooldown_days` key);
    existing numeric-input pattern (Step 4, Signal Params grid) `:271-304`; `readNumber` helper
    `:32-35` (for `Struct`-nested fields — not the right pattern for a top-level scalar like
    `cooldownDays`); `stepForError` heuristic `:80-86` (no bucket yet for a cooldown validation
    error).
  - Invocation: create mode `src/app/insights/strategies/new/page.tsx:18-21` (no `initial`); edit
    mode `src/app/insights/strategies/[id]/edit/page.tsx:13,28-32` (`initial={data}` from
    `useGetStrategy`, a proto-typed message — confirms cooldown flows through automatically once
    the proto field exists).
  - `src/hooks/useStrategyDefinitions.ts:1-10,25-43` — `StrategyDefinitionInit` type is
    **proto-generated** (`MessageInitShape<typeof StrategyDefinitionSchema>`), not hand-written.
  - `src/lib/insightsBff.ts:40-51` — `manageStrategy` handler is a plain forward, generated types
    throughout — no BFF change expected.
  - e2e: `e2e/insights/strategy-authoring.spec.ts` (279 lines) — full wizard walkthrough
    `:171-212`; edit pre-population test `:243-252`. `e2e/mock-backend.ts` referenced but not yet
    inspected for `ManageStrategy`/`GetStrategy` cooldown echo support.

## Patterns to REUSE

- **Cooldown gate call sites** → the new shared helper slots into the existing state-machine
  branches at `servicer.py:849,859` and `live_loop.py:128,130` — reuse the branch structure, don't
  restructure it.
- **Boot hydration** → reuse `hydrate_scores()` (`servicer.py:1216-1227`) + its `main.py:89`
  best-effort/`db_pool`-gated call-site shape for hydrating cooldown state at boot.
- **Repository** → reuse `StrategyScoresRepository`'s upsert-on-PK shape (`strategy_scores.py:26-32`),
  not the bulk-insert `BacktestRunSymbolsRepository` shape. Reuse the **same** `db_pool`
  (`main.py:47-49`) — no new pool (Constitution **F-06**, pool budget capped at 2 for this service).
- **Migration SQL style** → mirror `007_backtest_run_symbols.{up,down}.sql` exactly: schema-prefixed
  table name, `IF NOT EXISTS`, composite `PRIMARY KEY`, `TIMESTAMPTZ NOT NULL DEFAULT NOW()`, named
  `CREATE INDEX IF NOT EXISTS idx_<short>_<purpose>`, symmetric `.down.sql`.
- **Config read** → reuse `servicer.py:1082`'s exact `self._cfg.get_int("<key>", <default>)` call
  shape for `analysis.strategy.default_cooldown_days`.
- **Validation** → reuse the generic `ValueError` → `context.abort(INVALID_ARGUMENT)` wrapper
  (`servicer.py:158-169`); no prior "reject negative scalar" precedent exists to copy — this will be
  a new `raise ValueError(...)` inside `_validate_definition`/`_validate_definition_proto`.
- **Proto field style** → plain scalar declaration like `active = 7`/`live_enabled = 8`, not a
  `Struct` like `signal_params = 6`.
- **Agent tool param** → reuse the `signal_params` conditional-include pattern (`tools.py:342-343`)
  for `cooldown_days` in `tools.py` — **but this alone is insufficient**; `client.py:283-290`'s
  explicit `StrategyDefinition(...)` kwargs must also gain a `cooldown_days=...` line, or the value
  is silently dropped before it ever reaches the RPC. Product-spec FR-10 does not currently name
  `client.py` — this is a gap the design/impl-spec must close.
- **Agent tests** → reuse `test_tools.py:336-351` (assert on `client.manage_strategy`'s
  `call_args.kwargs["definition"]`) and `test_client.py:80-104` (mock the gRPC stub, assert on the
  constructed message) patterns for new `cooldown_days` round-trip tests.
- **UI numeric input** → reuse the Step-4 Signal Params `Input type="number"` /
  `grid grid-cols-3 gap-3` pattern (`StrategyWizard.tsx:271-304`); read the initial value directly
  as `initial?.cooldownDays ?? 0` (a top-level scalar), not via the `readNumber` helper (which is
  for `Struct`-nested fields like `signalParams`).
- **UI e2e** → reuse `strategy-authoring.spec.ts`'s full-wizard-walkthrough (`:171-212`) and
  edit-prepopulation (`:243-252`) test shapes for a new cooldown case.

## Dependencies

- Proto/RPC: `StrategyDefinition.cooldown_days = 9` (`analysis.proto:216-225`); no RPC signature
  change (`ManageStrategy`/`GetStrategy` already carry the whole message).
- Migration: next number `009` for `services/xstockstrat-analysis/migrations/` (last is
  `008_backtest_details`, merged from main-dev via feature `068-backtest-results-visualization`;
  recon originally recorded `008` before that feature landed — see the collision-resolution note in
  context.md).
- Config keys: `analysis.strategy.default_cooldown_days` (new, int, default `31`).
- Inter-service edges: none new — agent→analysis gRPC and UI→BFF→analysis gRPC shapes unchanged;
  a new in-process repo reuses the existing `db_pool`.
- New env vars / ports: none. Confirmed `ANALYSIS_ENDPOINT` already wired
  (`docker-compose.yml:463,510`, `.do/app.yaml:260,436`); no new env var required.

## Risks / Not-found

- **Spec gap (new finding, not in product-spec)**: FR-10 only names `tools.py` and
  `docs/runbooks/mcp-tools.md`, but `app/client.py:283-290` explicitly constructs `StrategyDefinition`
  field-by-field and would silently drop `cooldown_days` unless also updated. Must be added to FR-10
  or a new FR before `/sdd-spec`.
- No pre-existing "reject a negative scalar field" validation precedent anywhere in
  `xstockstrat-analysis` (`evaluator.py`/`servicer.py`) — only the generic abort-wrapper plumbing is
  reusable, not a copy-paste check.
- `e2e/mock-backend.ts` (UI) not yet inspected for whether it already echoes arbitrary
  `StrategyDefinition` scalar fields or needs an explicit `cooldown_days` fixture — needs a look
  before `/sdd-spec` authors the e2e step.
- `StrategyWizard.tsx`'s `stepForError` heuristic (`:80-86`) has no existing bucket for a
  cooldown-related server validation error — the design phase should decide which step a negative-
  `cooldown_days` `INVALID_ARGUMENT` attributes to (Identity step 1 is the closest existing analog,
  since `cooldown_days` — like `strategy_id`/`display_name` — is strategy-level, not rule-level).
- **Ledger — `fails.md` 2026-07-01 (056-open-positions-ui, duplication)**: directly the reason FR-4
  (shared cooldown-gate helper) is a hard requirement, not design-time discretion — two independent
  implementations of the same per-symbol state check is exactly the failure mode recorded there.
- **Ledger — `insights.md` 2026-07-03 (persist-strategy-scores, design)**: write-through + hydrate-
  at-boot is the exact pattern FR-8 reuses; confirmed `hydrate_scores()`/`main.py:89` is a faithful
  template.
- **Ledger — `insights.md` 2026-07-13 (cross-stock-score-derivation, design)**: "content-scoped
  validity gets a content hash, not a clock" — reinforces FR-9's fingerprint-inclusion default (no
  carve-out needed since `cooldown_days` isn't in the exclusion set).
- **Ledger — `insights.md` 2026-07-20 (trigger-backfill-mcp-tool, ordering)**: "a new MCP tool has
  five discovery surfaces" — correctly scoped down in FR-10 to the two surfaces relevant for a
  *parameter* addition (tool signature/docstring + `mcp-tools.md`), not a new-tool's full five;
  confirmed no agent `CLAUDE.md` tool-table change is needed for a parameter addition.

## Recommended Scope

Advisory step boundaries for `/sdd-spec` (not binding):

1. **proto** — add `cooldown_days = 9` to `StrategyDefinition`; `buf lint`/`buf breaking`/
   `buf-gen.sh` (Constitution **C-09**).
2. **migration** (DBA + service owner) — `009_strategy_cooldowns.{up,down}.sql`, mirroring `007`'s
   style; resolve the Open Question on column shape (`(strategy_id, symbol)` PK + `last_exit_at`,
   confirm no `cooldown_days`-snapshot column needed — re-reading the live definition at check time
   is simpler and avoids staleness).
3. **service** (`xstockstrat-analysis`) — shared cooldown-gate helper (FR-4); `StrategyCooldownsRepository`
   (upsert-on-PK, reusing `db_pool`); hydrate-at-boot wiring in `main.py`; wire the helper into both
   `_backtest_symbol_evaluated` (ephemeral, FR-7) and `live_loop._eval_pair` (durable, FR-8);
   `ManageStrategy` validation (reject negative, FR-6); config-key read (FR-2).
4. **test** (paired, **C-08**) — parity test (backtest vs. live agree given same inputs, FR-4);
   restart-durability test (FR-8/AC-7); backtest-reproducibility-isolation test (FR-7/AC-8);
   fingerprint-change test (FR-9/AC-9); negative-value rejection test (FR-6/AC-1).
5. **service** (`xstockstrat-agent`) — `tools.py` param + docstring; **`client.py` explicit kwarg**
   (the recon-discovered gap); `docs/runbooks/mcp-tools.md` parameter-table row (FR-10).
6. **test** — `test_tools.py`/`test_client.py` round-trip cases (AC-10).
7. **service** (`xstockstrat-ui`) — `StrategyWizard.tsx` numeric input + `handleSubmit` payload key +
   `stepForError` mapping decision (FR-11).
8. **test** — Playwright e2e case in `strategy-authoring.spec.ts` (+ `mock-backend.ts` fixture if
   needed, pending inspection) (AC-11).
9. **docs** — `docs/patterns/config-governance.md` + `services/xstockstrat-analysis/CLAUDE.md`
   config-key table entry (AC-6).
