# Recon: strategy-symbol-denylist

**Created**: 2026-08-14
**From**: product-spec.md
**Affected services**: xstockstrat-analysis, xstockstrat-ui, xstockstrat-agent, packages/proto (+ xstockstrat-portfolio only if a cross-user aggregation RPC were needed — see Risks: resolved by 133)

---

## Objective

Replace a live strategy's opt-in `signal_params.symbols` allowlist with a per-strategy **deny list**:
its evaluation universe becomes `union(watchlist-bound, held-position, active-signal symbols) − denied_symbols`,
editable from the Symbol detail and Strategy edit pages and via the `manage_strategy` agent tool, with
denied `(symbol, strategy)` pairs surfaced as explicit **skipped/muted** rows on the Opportunities page
rather than vanishing silently. Directly amends feature 131's live-strategy-attribution design (which
reuses the same `strategy_symbols()`/`live_by_symbol` construct) and depends on feature 133's strategy
user-ownership to owner-scope the union.

## Codebase Map

- **`xstockstrat-analysis`** (Python)
  - `strategy_symbols(definition)` — `app/engine/live_loop.py:37` (path is `app/engine/`, not `app/`); reads `signal_params.symbols`, empty-list short-circuit on unset presence at `:44-45`.
  - `strategy_symbols` callers: `live_loop.py:210` (`_symbols_for` → `_run_cycle`), `entry_backfill.py:83` (import `:18`), `servicer.py:1838` (SetStrategyLive precondition; local import `:1824` avoids cycle).
  - `_compute_opportunities` — `app/handlers/servicer.py:2083` (takes `user_id`); union indexes: `watchlist_by_symbol` `:2103`, `signals_by_symbol` `:2106`, `held_norm` `:2109` (drain `:2098-2100`); `_candidate()` template `:2113-2129`; `_normalize_symbol` `:2542`; `user_id` in scope at row assembly `:2220` (`_opportunity_key` `:2548`); max_universe cut / curated-above-cut `:2170-2177`; `_resolve_action_tag` (None → caller drops row `:2215-2216`) `:2555`.
  - ManageStrategy UPDATE mask handler — `servicer.py:1636-1651` (`has_mask`; `_COLUMN_AUTHORITATIVE_PATHS` reject; `_MASKABLE_PATHS` unknown-path reject); `_MASKABLE_PATHS` frozenset `:2873-2883`; `_COLUMN_AUTHORITATIVE_PATHS` `:2887`; AIP-161 merge `_merge_definition_json` `:2894`; `_apply` closure `:1679-1699`.
  - Repo JSONB persistence — `app/repositories/strategies.py`: `update_locked` (RMW under `FOR UPDATE`) `:70-107`, `update` `:54-68`, `create` `:33-45`; whole definition stored as one `definition_json` JSONB column.
  - Live loop `_run_cycle` — `live_loop.py:185`; row select `:188-190` (`WHERE live_enabled = TRUE AND active = TRUE`); truncation `max_pairs = self._cfg.get_int("analysis.engine.max_strategies_per_cycle", default=50)` `:186`, early-return-at-cap `:194-197`.
  - Config getters — `app/config/watcher.py`: `get_int` `:95` (zero-trap `v.int_val or default`), `get_int_present` `:103` (presence-aware), `get_bool` `:116`.
  - Last migration: `012_*` is the last existing analysis migration (133 claims `013/014/015`); **132 needs no migration** — `denied_symbols` persists inside `definition_json` JSONB (`migrations/001_strategies.up.sql:4`).
  - Tests — `tests/test_analysis_servicer.py`: `TestPartialStrategyUpdate` `:2656` (masked update, incl. masked-clear `:2691`, full-replace `:2745`, erasure-guard `:2765-2817`; `_update_req` `:2649`); `TestListOpportunitiesMaterialized` `:3683` (in-memory `OpportunitiesRepository` feeding real `_compute_opportunities` `:3517`); `TestOpportunityRowParity` (proto↔mapper) `:3996-4024`; cooldown/mask register-reject precedent `TestBacktestCooldown` `:2444`, exit-cooldown negative-reject `:2584`. Fixture home `tests/conftest.py`.

- **`xstockstrat-ui`** (Next.js)
  - Symbol detail page — `src/app/insights/market/[symbol]/page.tsx`: client component; loads opportunity queue and derives a single `strategyId` `:94-103`; reads `?strategy=` param `:44`; two-column layout `:217-225`. Does **not** load the strategy list or call any strategy-write BFF today.
  - Strategy edit page — `src/app/insights/strategies/[id]/edit/page.tsx:13-39` (admin-gated wrapper → `<StrategyWizard mode="edit">`); form is `src/components/insights/StrategyWizard.tsx` (edits `displayName`/`cooldownDays`/`exitCooldownDays`/`components`/`entryRule`/`exitRule` `:117-137`; presence-honest merge `:175-197`; array editor precedent = `components` add/remove `:353-374` + `ComponentEditor.tsx`).
  - BFF — `src/lib/insightsBff.ts`: `manageStrategy` **still admin-gated** `:42-54` (133 not landed); `getStrategy` `:55`, `listStrategyDefinitions` `:56-58`, `listOpportunities` plain `forward` `:63-65`. Browser sends `{operation, definition}` via `useManageStrategy` (`src/hooks/useStrategyDefinitions.ts:34-50`) — **no `update_mask` is set anywhere; wizard always FULL-REPLACE**.
  - Opportunities page — `src/app/insights/opportunities/page.tsx`: `OpportunityCard` mapped `:294-304`, component `:311-385`; attributed-vs-`0/0` conditions ternary `:333-341`; `strategyId` mono tag when present `:354-356`; single card style, **no per-row classification branch** `:326-329`; review link degrades on empty `strategyId` `:138-141`.
  - Typed client — `src/lib/browserClients/analysisClient`; `StrategyDefinition`/`Opportunity` are Connect-JSON camelCase from `@xstockstrat/proto/analysis/v1/analysis_pb`; a `denied_symbols` field surfaces as `deniedSymbols`.
  - e2e — `e2e/fixtures/opportunities.ts:10-64` (`OPPORTUNITIES`, incl. `strategyId:''`/`0/0` rows `:38-63`); `e2e/fixtures/strategies.ts:52-67`; `e2e/fixtures/INVENTORY.md:17,21`; `e2e/mock-backend.ts` (`listOpportunities` filter `:547-550`, `manageStrategy` echo `:773-782`, `getStrategy` per-id overrides `:783-813` — deny-list override attaches here, `listStrategyDefinitions` `:757-762`); specs `opportunities.spec.ts:53,70`, `strategy-authoring.spec.ts:100-105,299-325`, `signal-detail.spec.ts` (the market/[symbol] tests).

- **`xstockstrat-agent`** (Python) + `plugins/strat-lab/`
  - `manage_strategy` tool — `app/tools.py:488-500` (already takes `ctx: Context`); field-map `supplied` dict `:571-583` (add `denied_symbols` here); `update_mask` derivation `:581-601`; delegates to client `:605-612`; returns **camelCase** `MessageToDict` `:563-565`.
  - Client — `app/client.py`: `_metadata()` returns `[]` `:29-30`; `manage_strategy` fn `:396-401`; `StrategyDefinition` pb construction `:425-438` (wire `denied_symbols=definition.get("denied_symbols", [])`); mask applied `:445-447`; returns camelCase `MessageToDict` `:455`.
  - Read-back (AC-4 round-trip): tool `list_strategies` snake_case `:936-944`; tool `get_strategy` docstring field list `:947-959`; client `get_strategy` snake_case `MessageToDict(..., preserving_proto_field_name=True, always_print_fields_with_no_presence=True)` `:458-480`; client `list_strategy_definitions` `:483-494`.
  - strat-lab skill — `plugins/strat-lab/skills/backtest/SKILL.md:44-57` (mutation-guard / merge-fields section; add `denied_symbols` semantics alongside `cooldown_days`); tool listed `:16,:41`; root same-PR rule `CLAUDE.md:82`.
  - Tests — `tests/test_tools.py:779-802,805-829` (`test_forwards_cooldown_days`/`exit_cooldown_days`), `:1218-1241` (partial-merge mask); `tests/test_client.py:109-159` (presence round-trip), `:80-107` (admin-scope); shared fixtures `tests/conftest.py` (`ADMIN`, `_ctx`, `credentialed_source`).

- **`packages/proto`** — `analysis/v1/analysis.proto`: `StrategyDefinition` `:249-274` (highest field `exit_cooldown_days = 11` `:273`; **field 12 free**); `ManageStrategyRequest` `:284`, `update_mask` field 3 `:301`, allowed-masked-paths comment `:298-300`; `Opportunity` `:447-459` (highest field `provenance = 11` (`repeated string`); **field 12 free**).

## Patterns to REUSE

- `denied_symbols` proto field → add `repeated string denied_symbols = 12;` on `StrategyDefinition` (`analysis.proto:273`), mirroring `signal_params`/`cooldown_days`; **no migration** (JSONB, `migrations/001_strategies.up.sql:4`).
- FR-2 maskability → add `denied_symbols` to `_MASKABLE_PATHS` (`servicer.py:2873-2883`) and to the allowed-paths proto comment (`analysis.proto:298-300`); the `cooldown_days`/`exit_cooldown_days` masking path (`TestPartialStrategyUpdate`, ledger insight 2026-07-26 / 070) is the exact precedent.
- Row→proto mapper → `denied_symbols` must be threaded into `_row_to_strategy_definition` in lockstep (fails.md 2026-08-05 / 048: a proto/DB field added without updating this mapper is only caught by tests).
- FR-3 union universe → reuse `_compute_opportunities`'s existing `watchlist_by_symbol`/`held_norm`/`signals_by_symbol` shape (`servicer.py:2102-2109`); do not invent a second union.
- FR-5 skipped/muted row → reuse the existing `Opportunity.provenance` (`repeated string`, field 11) as an origin/classification tag rather than a numeric field, and honor the ordinal/cardinal trap (fails.md 2026-08-05 / 023): a skipped row is a distinct state, never `conviction=0`.
- FR-7 agent field-map → mirror `test_forwards_cooldown_days`/`test_cooldown_days_round_trips_presence` for `denied_symbols`; update `strat-lab` SKILL.md same-PR (fails.md 2026-08-01 mcp-tools drift).
- UI deny-list editor → mirror the wizard's `components` array add/remove (`StrategyWizard.tsx:353-374`) for a string-chips editor; masked write via the existing `manageStrategy` BFF.
- Owner-scoping (FR-3) → reuse feature 133's `ListPositions(user_id=owner)` + synthetic-header `ListWatchlists` mechanism (133 design.md decision 6) rather than a new cross-user RPC.
- Config (if a new cap is needed) → `self._cfg.get_int(...)` via `ConfigWatcher`, sibling to `analysis.opportunity.*` keys; never hardcode (F-07).

## Dependencies

- Proto/RPC: `StrategyDefinition.denied_symbols = 12` (additive, non-breaking; 133 claims `13` for `user_id` — coordinate); `ManageStrategyRequest.update_mask` allowed-paths comment; possibly a new `Opportunity` classification (prefer reusing `provenance` field 11 over a new field 12).
- Migration: **none** (JSONB-persisted).
- Config keys: none required by story; `/sdd-design` may add an `analysis.opportunity.*` or `analysis.engine.*` cap if the union grows per-strategy symbol counts (Open Question: `max_strategies_per_cycle` truncation fairness).
- Inter-service edges: analysis → portfolio (`ListPositions`/`ListWatchlists`, existing); analysis → ingest (`QuerySignals`, existing, already platform-wide). No new edge if 133's owner-scoping is used.
- New env vars / ports: none.

## Risks / Not-found

- **Nothing is on trunk yet — three-way net-new coordination.** `denied_symbols` (net-new), **feature 131's `live_by_symbol`/`is_live`/`_capped_live`/the three `max_live_*` caps are NOT on trunk** (131 design-approved, unmerged — `_compute_opportunities` has no `live_by_symbol`, `Opportunity` has no `is_live`), and **feature 133's `user_id`/composite-PK/owner-scoping are NOT on trunk** (unmerged). 132 must not cite any of these as existing code.
- **PIVOTAL ORDERING FORK (must resolve before Phase 1 debate proceeds).** 132's FR-3 redefines `strategy_symbols()`/`live_by_symbol` and FR-5 builds on 131's live-attribution row machinery, while FR-6 says 132's design must *amend* 131's design. But 131 introduces `live_by_symbol`/`is_live`/the caps, and 132 depends on 133 for owner-scoping. So the engineering build order is `133 → 131 → 132`, yet the requested *spec-writing* order is `133 → 132 → 134 → 131`. This is coherent only if 132's **design phase** amends 131's design.md first (so 131's later spec reflects the deny-list universe), while the **execute/merge** order stays `133 → 134 → 131 → 132`. Which feature owns the `denied_symbols` field vs. the `strategy_symbols()`→union rewrite, and the exact 131↔132 merge order, is a user-steerable decision — surfaced before the debate.
- **`update_mask` is defined in proto but never exercised by the UI** (`useStrategyDefinitions.ts:34-50` always FULL-REPLACE). FR-2's masked-update path from the UI is net-new plumbing; alternatively the deny-list edit sends a full definition like every other wizard edit. Design decision.
- **Symbol detail page has no strategy-write path today** (`market/[symbol]/page.tsx` loads no strategy list, calls no manage BFF). FR-4 surface 1 ("mute this symbol for a chosen strategy") is real new plumbing (needs the strategy list + a masked write), not a trivial control addition.
- **No plain list-of-strings editor exists in the wizard**; `signal_params.symbols` isn't even surfaced (feature 097 removed the blend step). The deny-list chips editor is net-new.
- **`max_strategies_per_cycle` truncates rather than round-robins** (`live_loop.py:186,194-197`) — if the union universe grows average per-strategy symbol counts vs. today's small opt-in lists, some `(strategy, symbol)` pairs could permanently starve. `/sdd-design` must assess.
- **Trap (fails.md 2026-08-05 / 023 — ordinal/cardinal):** FR-5's skipped/muted row must be a distinct classification, never `conviction=0`.
- **Trap (fails.md 067 — proto-enum→TS exhaustive `Record`):** if FR-5 introduces a new enum/classification value the UI maps exhaustively, regenerating the TS stub breaks `tsc`/`pnpm build` until the map gains the key — same-PR UI edit. (Reusing `provenance` string avoids this.)
- **Trap (fails.md 048 — mapper lockstep) and (fails.md mcp-tools — doc drift):** covered in Patterns to REUSE.
- AC-5 backward-compat for existing `signal_params.symbols`-configured strategies — translate once vs. accept the allowlist becomes inert — `/sdd-design` decision.
- No dedicated `strategy_symbols()` test exists today (covered only indirectly).

## Recommended Scope

Advisory, pending the ordering-fork resolution:
1. Proto: `StrategyDefinition.denied_symbols = 12` + `update_mask` allowed-paths comment; codegen.
2. Analysis: `_MASKABLE_PATHS` + `_row_to_strategy_definition` + `strategy_symbols()`→union−denied redefinition (owner-scoped via 133); the `live_by_symbol` construction in `_compute_opportunities` consumes it (this is the 131-amendment seam).
3. Analysis: FR-5 skipped/muted classification via `provenance` + the compute-cost/truncation-fairness assessment; paired tests.
4. Agent: `manage_strategy`/`client.py` field-map + read-back round-trip; `strat-lab` SKILL.md (same PR); paired tests.
5. UI: deny-list chips editor in `StrategyWizard`; "mute for strategy" control on the Symbol page; skipped/muted row treatment on Opportunities; e2e + fixtures/INVENTORY.
6. Docs: amend 131's design.md (FR-6); update `merge-order.md`; `context-constitution-findings.md` if the synthetic-header owner-scoping is extended.
