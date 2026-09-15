# Implementation Spec: opportunities-server-side-filters

**Status**: `pending`
**Created**: 2026-09-15
**Feature**: `docs/roadmap/features/190-opportunities-server-side-filters/feature.md`
**Total Steps**: 9
**Feature Branch**: `feature/opportunities-server-side-filters`

---

## Execution Summary

The work flows backend→frontend in the order the data must exist before it can be consumed. First the
**proto** contract gains three additive request fields, a response facet, and the new `OpportunitySort`
enum (Step 1), regenerated and diff-verified (Step 2). Then the **analysis repo** learns to filter
(source, action), sort (three ORDER BY branches), and facet (`available_sources`) server-side (Step 3),
proven by SQL-text/bind + pure-function parity tests (Step 4). The **analysis handler** threads the three
request fields into both `read()` calls and attaches the facet only on page 0 with the served
`include_expired` (Step 5), proven by a servicer boundary spy + vanish-trap parity test (Step 6). Finally
the **UI** hook sends the four controls and exposes the facet (Step 7), and the page drops its in-memory
filter/sort, feeds a multi-select dropdown from the facet, and wires the slider to the server floor
(Step 8) — both proven by an extended Playwright e2e suite that also honors the new fields in the mock and
keeps the in-place-refetch RED mounted (Step 9).

The design phase (`design.md`) is authoritative: the chosen approach (additive proto, repo SQL branches +
a freshness-scoped floor-independent `available_sources()` sibling method gated to `offset==0`, UI
dropdown fed by the page-0 facet) is followed exactly; rejected alternatives (`UNSPECIFIED≡CONVICTION`,
Option-B CTE facet, transaction-snapshot facet, per-feature real-DB harness, interpolated marker list,
always-survive muted rows) are off the table. Open Risks O1–O10 are discharged across the steps named in
each risk's Target line.

**Consumer surface (C-14):** the product spec names exactly one — **UI `/insights`** (the
`insights/opportunities` page, Decide nav group). It is reached by Steps 7 (hook), 8 (page), and 9 (e2e).
The **Agent** MCP `list_opportunities` tool is explicitly out of scope (product spec § Consumer Surfaces —
it does not expose these UI controls; `UNSPECIFIED` sort deliberately preserves the agent's legacy default
order so no agent step is required). No new UI route → no `PLATFORM_SUBNAV` nav-registration step (C-10(a)
N/A; the `/insights/opportunities` route already exists).

**No migration** (product spec § Database; recon.md Dependencies): source/action/expiry all filter over
existing `analysis.opportunities` columns/JSONB. **No config keys** (`analysis.opportunity.signal_rank_weight`
reused). **No new env vars / ports / inter-service edges.**

### Scenario Coverage (Constitution C-15)

| Scenario | Covered by step(s) |
|---|---|
| `@AC-1` (server floor + wire carries value) | 4 (repo floor bind), 9 (e2e wire + include/exclude) |
| `@AC-2` (muted survives raised floor) | 4 (repo vanish-trap), 9 (e2e) |
| `@AC-3` (data-unavailable survives floor) | 4 (repo vanish-trap), 9 (e2e) |
| `@AC-4` (source filter returns matching) | 4 (repo source predicate), 9 (e2e) |
| `@AC-5` (empty source = all) | 4 (repo empty-array guard), 9 (e2e) |
| `@AC-6` (action filter selects one) | 4 (repo action predicate), 9 (e2e) |
| `@AC-7` (unspecified action = all) | 4 (repo action guard), 9 (e2e) |
| `@AC-8` (expiry sort + grouping) | 4 (repo EXPIRY ORDER BY branch), 9 (e2e) |
| `@AC-9` (contiguous under expiry) | 4 (repo group-partition key), 9 (e2e) |
| `@AC-10` (conviction sort default) | 4 (repo CONVICTION branch), 9 (e2e) |
| `@AC-11` (facet independent of filters) | 4 (facet param-independence), 6 (servicer offset==0), 9 (e2e) |
| `@AC-12` (facet excludes markers) | 4 (`_primary_source` parity + facet marker bind), 9 (e2e) |
| `@AC-13` (pagination traverses filtered/sorted) | 6 (servicer pagination spy), 9 (e2e) |
| `@AC-14` (in-place refetch, mounted) | 9 (e2e, no `page.reload()`) |
| `@AC-15` (client does not re-filter/re-sort) | 8 (page removes useMemo), 9 (e2e order-parity) |

Every `@AC-*` scenario is covered. Backend repo coverage (Step 4) is SQL-text/bind + pure-function
parity, matching the repo's existing fake/mock-verified bar (design.md § Verification strategy, O10 —
the residual "SQL-text ≠ runtime `LATERAL`/`ORDER BY` semantics" gap is logged to `fails.md` with a named
platform follow-up, not silently accepted; that ledger touch happened in the design phase per O10).

## Step Dependencies

- Step 2 (`proto-gen`) requires Step 1 (`proto`): stubs cannot regenerate before the `.proto` changes.
- Step 3 (analysis repo) requires Step 2: the handler/tests import regenerated `OpportunitySort` / the
  new fields.
- Step 4 (repo test) pairs Step 3 (red-before-green; C-08/P-06).
- Step 5 (analysis handler) requires Step 3: it calls the extended `read()` + new `available_sources()`.
- Step 6 (servicer test) pairs Step 5. Step 6 extends `_FakeOppRepo.read` to **accept** (not implement)
  the new kwargs and adds a stub `available_sources`, because Step 5 forwards them (design.md § Verification
  — do not teach the fake the new filter/sort logic; assert forwarding at the boundary).
- Step 7 (UI hook) requires Step 2: imports `OpportunitySort` and the new request/response fields from
  the regenerated TS stubs.
- Step 8 (UI page) requires Step 7: consumes `useOpportunities(minConviction, sources, actionFilter, sort)`
  and `availableSources`.
- Step 9 (`test`, Playwright e2e) covers Steps 7 **and** 8 — `xstockstrat-ui` has no unit-coverage
  threshold; e2e is the paired verification for both frontend service steps (spec-template coverage table:
  `xstockstrat-ui` → `pnpm test:e2e`).

---

### Step 1 — proto: additive request/response fields + `OpportunitySort` enum

**Status**: `done`
**Service**: `packages/proto`
**Files**:
- `packages/proto/analysis/v1/analysis.proto` — modify

**Reviewers**: Proto Reviewer — field number uniqueness / no breaking change / `buf lint` + `buf breaking`;
`xstockstrat-analysis` owner — backtest/scoring determinism, no look-ahead bias; `xstockstrat-ui` owner —
Connect-RPC call safety, analytics display accuracy

**Codebase Evidence**:
- Confirmed via `sed -n '627,640p'`: `message ListOpportunitiesRequest { PageRequest page = 1;
  double min_conviction = 2; }` — **fields 3, 4, 5 free** (`analysis.proto:627-630`).
- Confirmed: `message ListOpportunitiesResponse` uses `opportunities = 1`, `page = 2`, `computing = 3`,
  `compute_failed = 4` (`analysis.proto:631-640`) — **field 5 free**.
- Confirmed: `enum OpportunityActionTag { …_UNSPECIFIED = 0; …_ENTER = 1; …_ADD = 2; …_REDUCE = 3; }`
  (`analysis.proto:531-536`) — reuse this enum for `action_filter`; do **not** mint a new action enum.
- Naming precedent for a closed-set enum with a `_UNSPECIFIED = 0` sentinel: `enum StrategyOperation`
  (`analysis.proto:365`); back-compat-default precedent (`UNSPECIFIED` treated as a named value, not an
  alias): `enum ReadinessRule { READINESS_RULE_UNSPECIFIED = 0; // server treats as ENTRY … }`
  (`analysis.proto:643-647`).

**TDD**: `N/A (proto)`

**Covers**: —

**Instructions**:
1. Add a new enum beside `OpportunityActionTag`, mirroring the `<NAME>_UNSPECIFIED = 0` closed-set
   convention (C-04):
   ```proto
   // Sort order for the opportunity queue read (feature 190). Closed set → enum (C-04).
   // UNSPECIFIED = the legacy feature-187 blended-rank default (1-w)·conviction + w·signal_axis —
   // NOT an alias of CONVICTION; non-UI callers (agent list_opportunities) keep the blended order (O6).
   enum OpportunitySort {
     OPPORTUNITY_SORT_UNSPECIFIED = 0;
     OPPORTUNITY_SORT_CONVICTION = 1;  // raw o.conviction ordering (the UI's explicit "Conviction")
     OPPORTUNITY_SORT_EXPIRY = 2;      // soonest valid_until first (NULLS last)
   }
   ```
2. Extend `ListOpportunitiesRequest` (keep `page = 1`, `min_conviction = 2`; do not renumber):
   ```proto
   repeated string sources = 3;              // empty = all sources (O2)
   OpportunityActionTag action_filter = 4;   // UNSPECIFIED(0) = any action
   OpportunitySort sort = 5;                 // UNSPECIFIED(0) = legacy blended rank
   ```
3. Extend `ListOpportunitiesResponse` (keep fields 1–4):
   ```proto
   repeated string available_sources = 5;    // distinct derived primary sources in the full valid queue
   ```
4. No field removals, renames, or type changes — additive only (`buf breaking` clean).

**Verification**:
```bash
cd packages/proto && buf lint && buf breaking --against ".git#branch=feature/opportunities-server-side-filters"
```
Both pass. (On the first commit the against-branch may not exist yet — then run
`buf breaking --against ".git#branch=main-dev"`, per recon.md Codebase Map.)

---

### Step 2 — proto-gen: regenerate stubs, verify empty gen diff

**Status**: `done`
**Service**: `packages/proto`
**Files**:
- `packages/proto/gen/**` — modify (generated; never hand-edited)

**Reviewers**: Proto Reviewer — field number uniqueness / no breaking change (inherited from Step 1);
`xstockstrat-analysis` owner; `xstockstrat-ui` owner

**Codebase Evidence**:
- Confirmed present: `scripts/buf-gen.sh` (repo root) — generates TS, Python, Go stubs and compiles the
  TS package (`ls scripts/buf-gen.sh` → exists; recon.md Codebase Map: `buf lint` → `buf breaking` →
  `buf generate` (Go+TS) → grpcio-tools (Python `gen/python`) → `pnpm --filter @xstockstrat/proto run build`).

**TDD**: `N/A (proto-gen)`

**Covers**: —

**Instructions**:
1. From repo root run `./scripts/buf-gen.sh`.
2. Stage the regenerated `packages/proto/gen/` output. Do not hand-edit generated files (they are
   checked-in codegen output).

**Verification**:
```bash
./scripts/buf-gen.sh && git status --porcelain packages/proto/gen/ | grep . && echo "regenerated"
# then confirm the ONLY changes are the additive OpportunitySort enum + new fields:
git diff --stat packages/proto/gen/
```
The diff is confined to the analysis stubs (the new enum + fields); no unrelated churn. A **second** run
of `./scripts/buf-gen.sh` leaves an empty `git diff packages/proto/gen/` (idempotent codegen — recon.md
Codebase Map).

---

### Step 3 — service: analysis repo — source/action filter, sort branches, `available_sources` facet

**Status**: `done`
**Service**: `xstockstrat-analysis`
**Files**:
- `services/xstockstrat-analysis/app/repositories/opportunities.py` — modify

**Reviewers**: `xstockstrat-analysis` owner — backtest reproducibility, strategy scoring determinism, no
look-ahead bias

**Codebase Evidence**:
- `OpportunitiesRepository.read(self, user_id, min_conviction, signal_rank_weight, *, include_expired)`
  at `opportunities.py:120-181`. Existing binds: `$1` user_id, `$2` min_conviction, `$3` w (clamped
  `min(max(signal_rank_weight,0.0),1.0)`), `$4` `_ACTION_DISMISS`, `$5` `_ACTION_SNOOZE`
  (`opportunities.py:174-179`).
- The SOLE floor + exemption is `AND (o.conviction >= $2 OR o.provenance ? 'denied'
  OR o.provenance ? 'unavailable')` (`opportunities.py:153`) — keep verbatim (O8; fails.md:1547 / :1552).
- Existing window-function grouping ORDER BY (the `UNSPECIFIED` branch) is the block at
  `opportunities.py:164-170` (`MAX(((1-$3)*o.conviction + $3*o.signal_axis)) OVER (PARTITION BY o.symbol)
  DESC, o.symbol ASC, ((1-$3)*o.conviction + $3*o.signal_axis) DESC, o.conviction DESC,
  o.opportunity_key ASC`).
- SELECT columns `opportunities.py:139-141` — no `source` column; source is derived. `valid_clause` is an
  f-string fragment (`"" | "AND o.valid_until > now()"`) at `opportunities.py:137` — the same
  interpolation-of-a-code-constant safety class the sort dict will use.
- `_primary_source(provenance)` at `servicer.py:4921-4926` skips the inline tuple
  `("watchlist", "position", "denied")` (docstring omits `"denied"`; `"unavailable"` is deliberately
  **not** skipped, so an `unavailable`-led row yields source `"unavailable"`).
- Module constants top-of-file: `_ACTION_SNOOZE = 1`, `_ACTION_DISMISS = 2`, `_ACTION_TAKE = 3`
  (`opportunities.py:18-20`); `_to_dict` JSONB decoder (`opportunities.py:23-32`).
- Sibling facet-shaped methods already present: `queue_share` (`opportunities.py:211`), `taken_count`
  (`opportunities.py:233`) — both plain `SELECT` over `analysis.opportunities WHERE user_id = $1 AND
  valid_until > now()`, reusing `self._db` (the shared asyncpg pool — F-06, no new pool).
- **Back-compat constraint (confirmed):** `read()` has a non-ListOpportunities caller —
  `_retry_unavailable_symbols` at `servicer.py:3645` (`read(user_id, 0.0, w, include_expired=True)`) —
  plus the two ListOpportunities calls (`servicer.py:3398`, `:3442`). The new params MUST default to a
  no-op (empty sources → no predicate, action_filter 0 → any, sort UNSPECIFIED → legacy blended) so this
  caller and every existing test keep passing unchanged.

**TDD**: `red-green required`

**Covers**: —

**Instructions**:
1. **Hoist the skip-list to a module constant** (O9, DRY/C-18). Add near the other module constants
   (`opportunities.py:18`):
   ```python
   # analysis.opportunities structural provenance markers — NOT signal sources. Single canonical
   # skip-set for both the primary-source derivation and the source facet. "unavailable" is
   # deliberately absent (parity with _primary_source: an unavailable-led row surfaces "unavailable").
   _PROVENANCE_STRUCTURAL_MARKERS = ["watchlist", "position", "denied"]
   ```
   In the same PR, refactor `servicer.py:_primary_source` to iterate over this constant instead of the
   inline tuple (import it from `app.repositories.opportunities`) so there is exactly one skip-set (O9).
2. **Extend `read()`** with three back-compatible keyword params:
   `sources: list[str] | None = None`, `action_filter: int = 0`, `sort: int = 0`. Normalize
   `srcs = sources or []`.
3. Add a `LEFT JOIN LATERAL` deriving the primary source once per row (never changes cardinality —
   `LIMIT 1`), binding the marker constant as a `text[]` param (a bind, **not** an interpolated `NOT IN`
   literal — O9, no injection surface):
   ```sql
   LEFT JOIN LATERAL (
     SELECT elem FROM jsonb_array_elements_text(o.provenance) WITH ORDINALITY t(elem, ord)
     WHERE elem <> ALL($6::text[]) ORDER BY ord LIMIT 1
   ) ps ON true
   ```
   Bind `$6 = _PROVENANCE_STRUCTURAL_MARKERS`.
4. **Source filter (empty-safe guard, O2):** add `AND (cardinality($7::text[]) = 0 OR ps.elem = ANY($7::text[]))`
   with `$7 = srcs`. An empty array applies **no** predicate — never `= ANY('{}')`.
5. **Action filter (O8 parity):** add `AND ($8::int = 0 OR o.action = $8::int)` with `$8 = int(action_filter)`.
   Compares `o.action` (the `OpportunityActionTag` SMALLINT), **not** the disposition
   `opportunity_actions.action`; muted placeholders carry `o.action = 0` so a specific filter drops them
   (parity with `page.tsx:143`).
6. **Do not change the floor** (`opportunities.py:153`) — it stays the sole min-conviction floor with the
   `denied`/`unavailable` exemption (O8).
7. **Sort branch (O6):** select the `ORDER BY` fragment from a **constant dict keyed by the sort enum int**
   (no interpolation of user input — same safety class as the existing `valid_clause` f-string), e.g.
   `_SORT_ORDER_BY = { 0: <today's blended block verbatim>, 1: "MAX(o.conviction) OVER (PARTITION BY
   o.symbol) DESC, o.symbol ASC, o.conviction DESC, o.opportunity_key ASC", 2: "MIN(o.valid_until) OVER
   (PARTITION BY o.symbol) ASC NULLS LAST, o.symbol ASC, o.opportunity_key ASC" }`, defaulting an unknown
   value to `0`. **All three branches keep the symbol-partition group key + the `o.opportunity_key ASC`
   paging tiebreak** (preserves @AC-9 grouping and feature-185 @AC-8 paging stability).
8. Thread `$6/$7/$8` into the `self._db.fetch(...)` positional arg list after the existing `$1-$5`.
9. **Add the `available_sources` sibling method** beside `queue_share`/`taken_count`
   (`opportunities.py:211,233`), same shared pool (F-06). It takes **no** `sources`/`action_filter`/
   `min_conviction` params (structural independence — O3), only `user_id` + keyword `include_expired`,
   and threads the same `{valid_clause}` and the same `_PROVENANCE_STRUCTURAL_MARKERS` bind:
   ```python
   async def available_sources(self, user_id: str, *, include_expired: bool) -> list[str]:
       valid_clause = "" if include_expired else "AND o.valid_until > now()"
       rows = await self._db.fetch(
           f"""
           SELECT DISTINCT ps.elem AS source
           FROM analysis.opportunities o
           LEFT JOIN analysis.opportunity_actions a
             ON a.user_id = o.user_id AND a.opportunity_key = o.opportunity_key
           CROSS JOIN LATERAL (
             SELECT elem FROM jsonb_array_elements_text(o.provenance) WITH ORDINALITY t(elem, ord)
             WHERE elem <> ALL($2::text[]) ORDER BY ord LIMIT 1
           ) ps
           WHERE o.user_id = $1 {valid_clause}
             AND COALESCE(a.action, 0) <> $3
             AND NOT (COALESCE(a.action, 0) = $4 AND a.snooze_until IS NOT NULL AND a.snooze_until > now())
           """,
           user_id, _PROVENANCE_STRUCTURAL_MARKERS, _ACTION_DISMISS, _ACTION_SNOOZE,
       )
       return sorted(r["source"] for r in rows if r["source"])
   ```
   `CROSS JOIN LATERAL` (not `LEFT JOIN`) drops empty-source rows so they never become chips; the DISMISS +
   active-SNOOZE disposition drop mirrors `read()` (`opportunities.py:154-159`). It applies **no**
   min-conviction floor — the facet reflects the full valid queue independent of the request filters (FR-5,
   @AC-11), which is what makes @AC-12's no-strand self-heal safe.

**Verification**: (covered by the paired test Step 4; the lint gate lives there.)

---

### Step 4 — test: analysis repo SQL-text/bind + `_primary_source` parity

**Status**: `done`
**Service**: `xstockstrat-analysis`
**Files**:
- `services/xstockstrat-analysis/tests/test_opportunities_repo.py` — modify

**Reviewers**: `xstockstrat-analysis` owner — backtest reproducibility, no look-ahead bias

**Codebase Evidence**:
- `test_opportunities_repo.py` (78 lines) uses an AsyncMock-pool pattern (`_mock_pool()`
  `test_opportunities_repo.py:19-34`) asserting SQL text + binds without a real DB (mirrors
  `test_backtest_runs_repo.py`). Existing tests assert `conn.executemany.await_args.args`; the `read()`
  and `available_sources()` paths call `self._db.fetch(...)`, so extend the mock so `pool.fetch` is an
  `AsyncMock` and assert `pool.fetch.await_args.args` (SQL string + positional binds).
- No real-Postgres harness exists in this service (conftest is proto-path only; no testcontainers;
  `integration-test.sh` dead) — the whole repo SQL surface is fake/mock-verified. This test matches that
  bar (design.md § Verification strategy; O10 residual gap logged in `fails.md`).
- `_primary_source` at `servicer.py:4921-4926` is a pure function importable for the parity test.

**TDD**: `red-green required` — written to fail against the pre-Step-3 tree (asserts the new predicates,
binds, ORDER BY branches, and the facet method, none of which exist yet), passing after Step 3.

**Covers**: `AC-1, AC-2, AC-3, AC-4, AC-5, AC-6, AC-7, AC-8, AC-9, AC-10, AC-11, AC-12`

**Instructions**:
1. **`read()` empty-sources guard (O2, @AC-5):** call `read(..., sources=[])`; assert the emitted SQL
   does **not** contain a `ps.elem = ANY` predicate active (the `cardinality($7::text[]) = 0` guard
   short-circuits) and that `$7` binds to `[]`.
2. **`read()` source predicate present (@AC-4):** call `read(..., sources=["live_strategy"])`; assert
   `$7` binds `["live_strategy"]` and the `cardinality(...) = 0 OR ps.elem = ANY($7::text[])` clause is in
   the SQL.
3. **`read()` action predicate (@AC-6/@AC-7):** call with `action_filter=OPPORTUNITY_ACTION_TAG_REDUCE (3)`
   → `$8` binds `3` and `($8::int = 0 OR o.action = $8::int)` is present; call with `action_filter=0` →
   `$8` binds `0` (guard makes it a no-op).
4. **`read()` sort branches (@AC-8/@AC-9/@AC-10):** call with `sort=0/1/2`; assert the emitted `ORDER BY`
   leads with, respectively, the blended `MAX((1-$3)*…) OVER (PARTITION BY o.symbol)`, `MAX(o.conviction)
   OVER (PARTITION BY o.symbol) DESC`, and `MIN(o.valid_until) OVER (PARTITION BY o.symbol) ASC NULLS LAST`;
   and that **all three** contain `o.opportunity_key ASC` (paging tiebreak) and a `PARTITION BY o.symbol`
   group key.
5. **Floor unchanged (@AC-2/@AC-3 backend half — vanish-trap, O8):** assert the SQL still contains
   `o.conviction >= $2 OR o.provenance ? 'denied' OR o.provenance ? 'unavailable'` under every sort/filter
   combination (a muted/unavailable row is never dropped by the floor; the source/action predicates are
   orthogonal).
6. **Marker bind == constant (O9, @AC-12 backend half):** assert both the `read()` LATERAL and the
   `available_sources()` facet bind the marker array **equal to** `_PROVENANCE_STRUCTURAL_MARKERS`
   (import the constant and compare), not a re-typed literal.
7. **Facet independence (O3, @AC-11):** call `available_sources("u1", include_expired=False)`; assert the
   SQL carries **no** min_conviction / sources / action predicate, threads `AND o.valid_until > now()`
   (and drops it when `include_expired=True`), and returns the sorted distinct non-empty `source` values;
   assert the method signature takes no filter params.
8. **`_primary_source` pure-function parity (@AC-12):** parametrize over the provenance permutation matrix
   — empty `[]` → `""`; leading structural markers `["watchlist","position","live_strategy"]` →
   `"live_strategy"`; leading `["unavailable","x"]` → `"unavailable"` (not skipped); multi-source; all
   structural `["watchlist","position","denied"]` → `""` — and assert it skips exactly
   `_PROVENANCE_STRUCTURAL_MARKERS`.
9. **Test-data (C-13):** these are scalar/string SQL-assertion literals and provenance permutation
   one-offs local to this single test file — inline is compliant (one consumer; no second inline copy of a
   domain object introduced). Record that verdict; do not create a `conftest.py` fixture speculatively.

**Verification**:
```bash
cd services/xstockstrat-analysis && ruff check . && ruff format --check . && pytest tests/test_opportunities_repo.py -q && pytest --cov=app --cov-fail-under=40
```
The new tests pass; coverage stays ≥ 40%.

---

### Step 5 — service: analysis handler — thread filters into `read()`, attach facet on page 0

**Status**: `done`
**Service**: `xstockstrat-analysis`
**Files**:
- `services/xstockstrat-analysis/app/handlers/servicer.py` — modify

**Reviewers**: `xstockstrat-analysis` owner — backtest reproducibility, strategy scoring determinism, no
look-ahead bias

**Codebase Evidence**:
- `ListOpportunities` handler at `servicer.py:3368`. Fresh read `read(user_id, request.min_conviction, w,
  include_expired=False)` at `servicer.py:3397-3398`; stale read `include_expired=True` at
  `servicer.py:3441-3442`. `computing`/`compute_failed` init at `servicer.py:3403-3404`.
- Offset parse + pagination window at `servicer.py:3464-3470` (`offset = int(request.page.page_token)…`,
  `window = rows[offset:offset+page_size]`, `next_token`).
- Response assembly at `servicer.py:3475-3480` (`ListOpportunitiesResponse(opportunities=…, page=…,
  computing=…, compute_failed=…)`).
- No-DB test path returns early at `servicer.py:3394-3395` (`if self._opportunities_repo is None`).

**TDD**: `red-green required`

**Covers**: —

**Instructions**:
1. Thread the three request fields into **both** `read()` calls (`servicer.py:3398` and `:3442`):
   `read(user_id, request.min_conviction, w, include_expired=<False|True>, sources=list(request.sources),
   action_filter=request.action_filter, sort=request.sort)`. Do **not** touch the internal
   `_retry_unavailable_symbols` `read(...)` at `servicer.py:3645` (it must keep the no-op defaults).
2. **Track the served freshness:** add `served_include_expired = False` beside the `computing = False`
   init (`servicer.py:3403`); set it `True` inside the stale branch right where the stale `read()` runs
   (`servicer.py:3441-3442`) — so the facet uses exactly the `include_expired` that produced the served
   rows (fresh=`False`, stale=`True`; O7).
3. **Attach the facet only on page 0** (O1/O7): after the offset is known (reuse the parse at
   `servicer.py:3464-3466`), compute `available = await self._opportunities_repo.available_sources(user_id,
   include_expired=served_include_expired) if offset == 0 else []` and pass `available_sources=available`
   into the `ListOpportunitiesResponse(...)` at `servicer.py:3475-3480`. `offset > 0` pages return `[]`
   (the UI reads page 0 only). Guard the call behind the existing non-None repo (the no-DB early return at
   `servicer.py:3394-3395` already covers the `None` path — a facet response field on that branch may stay
   default-empty).
4. This is a **read-path** change only; do not alter `_compute_opportunities`, the freshness state machine,
   or `_enrich_opportunities_live` (product spec Out of Scope; fails.md:1780 — the read/return path,
   including pagination defaults + the facet + the ORDER BY, is what this feature touches).

**Verification**: (covered by the paired test Step 6; the lint gate lives there.)

---

### Step 6 — test: servicer boundary spy + vanish-trap parity

**Status**: `done`
**Service**: `xstockstrat-analysis`
**Files**:
- `services/xstockstrat-analysis/tests/test_analysis_servicer.py` — modify

**Reviewers**: `xstockstrat-analysis` owner — backtest reproducibility, no look-ahead bias

**Codebase Evidence**:
- `_FakeOppRepo` at `test_analysis_servicer.py:4030`; its `read(self, user_id, min_conviction, w, *,
  include_expired)` at `:4050`; `_materialized_svc(...)` wiring (`svc._opportunities_repo = _FakeOppRepo()`)
  at `:4256-4272`. Seed-and-assert opportunity tests run from `:4395` onward.
- Design.md § Verification: do **not** teach `_FakeOppRepo` the new filter/sort logic (avoids
  vacuous-green fake divergence) — assert forwarding at the servicer→repo boundary with a spy.

**TDD**: `red-green required` — the spy assertions fail against the pre-Step-5 handler (which passes none
of the new args and never calls the facet), pass after.

**Covers**: `AC-1, AC-2, AC-3, AC-11, AC-13`

**Instructions**:
1. **Widen `_FakeOppRepo` signatures (accept, do not implement):** change
   `_FakeOppRepo.read(...)` (`test_analysis_servicer.py:4050`) to accept `sources=None`,
   `action_filter=0`, `sort=0` (ignore them in the body — the existing filter/rank stays as-is), and add a
   stub `async def available_sources(self, user_id, *, include_expired): return sorted({…})` derived from
   the stored rows' provenance so `offset==0` calls resolve. These accept-and-ignore changes exist so the
   handler's new call args don't raise; the behavioral truth is asserted by the spy below, not the fake.
2. **Call-arg spy (O4, fails.md:577 — "accepted-but-ignored" guard):** in a materialized-servicer test,
   wrap `svc._opportunities_repo.read` with a `MagicMock`/`AsyncMock` (or a wrapper capturing calls) and
   invoke `ListOpportunities` with a request carrying `sources=["live_strategy"]`, `action_filter=REDUCE`,
   `sort=EXPIRY`, `min_conviction=0.5`; assert the fresh `read` call received exactly those four values
   (proving forwarding, not mere message presence).
3. **Facet gating (O7, @AC-11):** assert `available_sources` is called **once** on the page-0 request with
   `include_expired=False` (fresh path); and, on the **stale** path (all rows expired → the servicer serves
   `include_expired=True`), assert the facet call arg is `include_expired=True`. Assert a page-1 request
   (`page_token="50"`) does **not** call `available_sources` and returns `available_sources == []`.
4. **Pagination traverses the filtered/sorted set (@AC-13):** seed a queue (via the real
   `_compute_opportunities` fake path or direct `replace_for_user`) large enough to page; request page 0
   with `page_size=50` and a specific `action_filter`, assert the `next_page_token` is set and following it
   returns the remaining filtered rows (the fake's `read` applies the existing valid/action-disposition
   filter + rank; combined with the servicer's offset slicing this exercises the return path — fails.md:1780).
5. **Vanish-trap parity (O8, @AC-2/@AC-3):** seed a muted (`provenance` contains `"denied"`, conviction 0)
   and a data-unavailable (`"unavailable"`, conviction 0) row plus a normal 0.3 row; request
   `min_conviction=0.5`; assert the muted and unavailable rows are still returned (floor-exempt) while the
   0.3 row is dropped — proving the exemption survives and is not silently widened.

**Verification**:
```bash
cd services/xstockstrat-analysis && ruff check . && ruff format --check . && pytest tests/test_analysis_servicer.py -q && pytest --cov=app --cov-fail-under=40
```
New tests pass; coverage ≥ 40%.

---

### Step 7 — service: UI hook — send four controls, expose `availableSources`

**Status**: `pending`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/src/hooks/useOpportunities.ts` — modify

**Reviewers**: `xstockstrat-ui` owner — Trading UI correctness, analytics display accuracy, Connect-RPC call
safety

**Codebase Evidence**:
- `useOpportunities(minConviction = 0)` at `useOpportunities.ts:19-35`: `queryKey: ['opportunities',
  minConviction]` (`:21`), request `{ minConviction, page: { pageSize: 50, pageToken: pageParam ?? '' } }`
  (`:23-26`), `refetchInterval: 15_000` (`:33`), `getNextPageParam` stops on `computing`/`computeFailed`
  (`:28-32`).
- Import line `import type { OpportunityAction, ReadinessRule } from '@xstockstrat/proto/analysis/v1/analysis_pb'`
  (`useOpportunities.ts:5`) — extend to import `OpportunityActionTag`, `OpportunitySort` (regenerated in
  Step 2).

**TDD**: `red-green required` (frontend — the RED lives in the Step 9 e2e; see Step Dependencies).

**Covers**: —

**Instructions**:
1. Change the signature to
   `useOpportunities(minConviction = 0, sources: string[] = [], actionFilter: OpportunityActionTag =
   OpportunityActionTag.UNSPECIFIED, sort: OpportunitySort = OpportunitySort.UNSPECIFIED)`.
2. Fold all four into the `queryKey` — `['opportunities', minConviction, [...sources].sort(), actionFilter,
   sort]` — so an in-place `refetchInterval` refetch **and** a filter change both re-fetch (fails.md:1648).
3. Pass all four on the request: `analysisClient.listOpportunities({ minConviction, sources, actionFilter,
   sort, page: { pageSize: 50, pageToken: pageParam ?? '' } })`. Keep `refetchInterval`, `initialPageParam`,
   and the `getNextPageParam` computing/failed stop unchanged.
4. Do not add any client-side re-derivation of the facet — `availableSources` is read directly off
   `data.pages[0]` in the page (Step 8, O1); the hook just returns the infinite-query result as today.

**Verification**: (covered by Step 9 e2e; the `pnpm lint` gate lives there.)

---

### Step 8 — service: UI page — drop in-memory filter/sort, dropdown from facet, server floor

**Status**: `pending`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/src/app/insights/opportunities/page.tsx` — modify

**Reviewers**: `xstockstrat-ui` owner — Trading UI correctness, analytics display accuracy, no secret values
rendered

**Codebase Evidence**:
- `useOpportunities(0)` hard-codes the floor to `0` (`page.tsx:92-93`); state `minConviction`/
  `activeSources`/`actionFilter`/`sortKey` at `page.tsx:96-99`; `MIN_CONVICTION_KEY` localStorage
  hydrate/persist at `page.tsx:44,105-120`.
- Derived-from-loaded-rows `sources` useMemo at `page.tsx:122-125`; `effectiveSources = activeSources ∩
  sources` intersection at `page.tsx:129-132`; **in-memory filter+sort** `rows` useMemo at
  `page.tsx:134-154` (floor exemption for muted/unavailable at `:141`, source filter at `:142`, action
  filter at `:143`, conviction/expiry sort at `:146-152`); `symbolGroups` regroup at `page.tsx:165-173`.
- Source control: `All sources` button (`page.tsx:213-220`) + `ToggleGroup`/`ToggleGroupItem` fed by
  `sources` (`page.tsx:221-236`); action `Select` (`page.tsx:238-248`); sort `Select` (`page.tsx:249-257`);
  slider `input[type=range]` calling `updateMinConviction` (`page.tsx:260-274`).
- `DropdownMenu` + `DropdownMenuCheckboxItem` primitive present at
  `services/xstockstrat-ui/src/components/ui/dropdown-menu.tsx` (exports `DropdownMenuCheckboxItem` at
  `dropdown-menu.tsx:74,239`) — reuse it (C-17; no near-duplicate).
- State primitives `EmptyState`/`Skeleton`/`QueryStateMessages` imported at `page.tsx:37-40` — keep.

**TDD**: `red-green required` (frontend — the RED lives in the Step 9 e2e; see Step Dependencies).

**Covers**: `AC-15`

**Instructions**:
1. **Stop hard-coding the floor:** call `useOpportunities(minConviction, effectiveSources, actionFilterEnum,
   sortEnum)` (replace `useOpportunities(0)` at `page.tsx:92-93`). Keep `minConviction` state + its
   `MIN_CONVICTION_KEY` localStorage hydrate/persist (`page.tsx:44,105-120`) — it now drives the server
   floor.
2. **Delete the in-memory `rows` filter/sort useMemo** (`page.tsx:134-154`) and the derived-from-rows
   `sources` useMemo (`page.tsx:122-125`). Render server rows directly: build `symbolGroups` from
   `opportunities` (the flattened `data.pages` list) instead of `rows` (adjust `page.tsx:165-173` to map
   over `opportunities`). No client conviction floor, source filter, action filter, or sort transform
   remains (@AC-15; fails.md:1547 — the floor lives at exactly one layer, the DB).
3. **Feed chips from the facet (O1):** read `const availableSources = data?.pages?.[0]?.availableSources ??
   []` (page 0 only, never flat-mapped). Keep `effectiveSources = activeSources.filter(s =>
   availableSources.includes(s))` (the intersection at `page.tsx:129-132`, now against the facet not the
   loaded rows) so a vanished source can't strand the queue and the selection survives (@AC-12,
   feature-155 preserve).
4. **Convert the source control to a multi-select dropdown (C-17):** replace the `All sources` button +
   `ToggleGroup`/`ToggleGroupItem` (`page.tsx:213-236`) with a `DropdownMenu` whose trigger has a
   **unique accessible name** (O5 — e.g. `aria-label="source filter"`) and a label of `"All sources"` when
   `effectiveSources.length === 0` else `"N sources"`, and a `DropdownMenuCheckboxItem` per
   `availableSources` entry toggling membership in `activeSources` (multi-select preserved). Drop the
   `ToggleGroup` import and the `sourceFilterPillClass` helper (`page.tsx:8,65-73`) if now unused.
5. **Wire the action + sort `Select`s to enum request inputs:** map the action `Select` value to
   `OpportunityActionTag` (`any`→`UNSPECIFIED`, else `ENTER`/`ADD`/`REDUCE`) and the sort `Select` value to
   `OpportunitySort` (`conviction`→`CONVICTION`, `expiry`→`EXPIRY`), passing the enums into
   `useOpportunities`. The `Select`s' existing `aria-label`s (`page.tsx:239,250`) stay.
6. Keep the `computing`/`compute_failed`/loading/`EmptyState` branches (`page.tsx:277-348`) — they read
   `data.pages[0]` and stay correct. The empty state now means "server returned no rows for these filters"
   (the filtering moved server-side; the copy "Loosen the min-conviction slider or clear the source chips"
   still applies).
7. **Test-data / C-12:** no fixture change in this step (page-only); the mock + fixture updates are Step 9.

**Verification**: (covered by Step 9 e2e; the `pnpm lint` gate lives there.)

---

### Step 9 — test: Playwright e2e — mock honors new fields, specs re-pointed, in-place RED

**Status**: `pending`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/e2e/mock-backend.ts` — modify
- `services/xstockstrat-ui/e2e/insights/opportunities.spec.ts` — modify
- `services/xstockstrat-ui/e2e/fixtures/opportunities.ts` — modify (only if a new source-permutation row is
  needed; else unchanged)
- `services/xstockstrat-ui/e2e/fixtures/INVENTORY.md` — modify (only if a fixture row is added/changed)

**Reviewers**: `xstockstrat-ui` owner — Trading UI correctness, analytics display accuracy

**Codebase Evidence**:
- Shared-mock `listOpportunities(req)` at `mock-backend.ts:828-843` reads only `req.minConviction`; muted +
  data-unavailable rows exempt from the floor (`mock-backend.ts:833-842`); returns `computing`/
  `computeFailed` false. Must be extended to honor `sources`/`actionFilter`/`sort` and emit
  `available_sources`.
- Per-page stateful mock `mockOpportunities(page)` at `opportunities.spec.ts:28-49` (its
  `page.route(...ListOpportunities...)` at `:30-38` returns `opportunities` filtered by a `hidden` Set) —
  extend its response body to include `availableSources` and (where a spec drives filters) honor the
  request fields.
- Specs to re-point: source-chip narrows `opportunities.spec.ts:83-87` and `:156-160` (currently
  `getByRole('button', { name: 'watchlist'|'marketwatch' }).click()` on `ToggleGroup` pills → re-point to
  the `DropdownMenuCheckboxItem`, O5); the in-place-refetch/vanished-source RED `:165-185` (Snooze-driven
  `['opportunities']` invalidation, **no `page.reload()`** — keep mounted, fails.md:1648); slider floor
  `:75-81` and `:102-108`, `:224-233`.
- Fixtures `OPPORTUNITIES` at `opportunities.ts:54-226` carry sources `unusual_whales`, `marketwatch`,
  `dividendology`, `watchlist`, plus empty-source muted/live rows and a `dataUnavailable` PLTR row;
  INVENTORY row at `INVENTORY.md:28`. `toJson` marshaller used by the per-page mock (`opportunities.spec.ts`).

**TDD**: `red-green required` — the re-pointed/added specs fail against the pre-Step-7/8 UI (which filters
client-side, has no dropdown, hard-codes `minConviction:0`, and ignores `availableSources`) and pass after.

**Covers**: `AC-1, AC-2, AC-3, AC-4, AC-5, AC-6, AC-7, AC-8, AC-9, AC-10, AC-11, AC-12, AC-13, AC-14, AC-15`

**Instructions**:
1. **Extend the shared mock `listOpportunities`** (`mock-backend.ts:828-843`) to honor the request: apply
   the min_conviction floor with the muted/unavailable exemption (already present), then filter by
   `req.sources` (empty → all; else keep rows whose derived primary source ∈ `sources`, deriving source by
   skipping `watchlist`/`position`/`denied` — mirror `_PROVENANCE_STRUCTURAL_MARKERS`), filter by
   `req.actionFilter` (0/UNSPECIFIED → any; else `o.action === actionFilter`, excluding muted `action=0`),
   sort by `req.sort` (CONVICTION → conviction desc; EXPIRY → soonest `validUntil` first, NULLS last;
   UNSPECIFIED → today's order), then paginate via `page.pageToken`/`pageSize`. Emit
   `availableSources` = sorted distinct derived primary sources over the **full** fixture queue
   (independent of the request filters), on page 0.
2. **Extend the per-page stateful mock** (`opportunities.spec.ts:30-38`) to include `availableSources` in
   its response body and, for the filter specs, honor `sources`/`actionFilter`/`sort` from the parsed
   request (mirror the shared mock's logic) — so a filter change round-trips server-side.
3. **@AC-1 (server floor + wire value):** assert raising the slider issues a `ListOpportunities` request
   whose body carries the non-zero `minConviction` (intercept the request), and that a low-conviction
   symbol disappears because the **server** (mock) dropped it — not a client re-filter. Keep the
   component **mounted** (no `page.reload()`).
4. **@AC-4/@AC-5 (source filter):** open the source dropdown, check one source → assert only that source's
   rows remain and the request carried `sources: [that]`; clear it → assert all sources return and the
   request carried `sources: []`.
5. **@AC-6/@AC-7 (action filter):** select an action → only that action's rows; `Any action` → both.
6. **@AC-8/@AC-9/@AC-10 (sort):** select `Soonest expiry` → assert the soonest-expiring symbol group is
   first and a multi-row symbol stays contiguous; `Conviction`/default → the existing rank order.
7. **@AC-11 (facet independence):** with a source filter + high floor active, assert the source dropdown
   still lists **all** queue sources (chips come from `availableSources`, not the filtered rows).
8. **@AC-12 (facet excludes markers):** assert the dropdown never lists `position`/`watchlist` as a
   selectable source (marker tokens excluded).
9. **@AC-13 (pagination):** seed >50 rows of one action in the per-page mock; filter by that action;
   `Load more` → assert the second page returns the remaining rows and no other-action rows.
10. **@AC-14 (in-place refetch, mounted):** re-use the existing vanished-source RED shape
    (`opportunities.spec.ts:165-185`) — drive the refetch by the Snooze mutation's `['opportunities']`
    invalidation (in place), **never** `page.reload()`; assert the list updates to the server response for
    the new params (fails.md:1648).
11. **@AC-15 (no client re-filter/re-sort):** assert the rendered symbol-group order matches the mock's
    response order exactly (no client reordering) and that toggling a filter changes the request (not just
    a local list transform).
12. **Test-data (C-12):** reuse the `OPPORTUNITIES` inventory fixture (`e2e/fixtures/opportunities.ts`,
    INVENTORY row 28). Only if a scenario needs a source permutation the fixture lacks (e.g. a `fundamentals`
    or `sec_edgar_8k` source for @AC-11's three-source assertion), add it to `OPPORTUNITIES` and update the
    INVENTORY row in the same step — never an inline literal in the spec. Confirm `import` from
    `'../fixtures'` and `helpers/auth` remain.

**Verification**:
```bash
cd services/xstockstrat-ui && pnpm run lint && pnpm test:e2e -- e2e/insights/opportunities.spec.ts
grep -n "page.reload()" e2e/insights/opportunities.spec.ts   # the @AC-14 in-place test must NOT use reload
grep -n "from '../fixtures'\|helpers/auth" e2e/insights/opportunities.spec.ts   # confirm fixture/auth imports
```
The opportunities e2e suite passes; the @AC-14 in-place-refetch test contains no `page.reload()`
(fails.md:1648); `xstockstrat-ui` has no unit-coverage threshold — e2e is the paired verification for the
frontend service Steps 7 + 8 (spec-template coverage table).

---

## Deviation Log

### Step 2 — proto codegen via Docker (not host-native buf)
- **What**: `buf`/plugins are not installed on the host; regenerated stubs via the pinned
  `Dockerfile.codegen` image (`./scripts/localenv-setup.sh`) instead of a host `./scripts/buf-gen.sh`.
- **Disposition**: CI-equivalent fallback (`reference/tooling-setup.md` — Docker is the *preferred*
  codegen path; same pinned plugin versions as the image; no behavioral divergence).
