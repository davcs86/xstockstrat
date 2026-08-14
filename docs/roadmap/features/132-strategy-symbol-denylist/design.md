# Design: strategy-symbol-denylist

**Created**: 2026-08-14
**Rounds**: 5 (full; termination: approved APPROVE-READY at the round-5 cap)
**Approved by**: user @ 2026-08-14
**Grounded in**: recon.md

---

## Chosen Approach

Layer a per-strategy **deny list** on top of feature 131's live-attribution machinery, owner-scoped by
feature 133. Build/merge order is `133 → 134 → 131 → 132` (132 merges last); 132's *design phase*
amends 131's design.md so 131's later `/sdd-spec` reflects the deny-list universe (FR-6). No migration —
`denied_symbols`/`signal_eligible` ride `definition_json` JSONB; `Opportunity.muted` rides the existing
`provenance` JSONB column.

**1. Proto (132 owns three additive fields).** On `StrategyDefinition` (`analysis.proto:249-274`, highest
field `exit_cooldown_days = 11`): `repeated string denied_symbols = 12;` and `bool signal_eligible = 14;`
(field 13 reserved for 133's `user_id` — 133 merges first, leaving 12 a temporary gap until 132 lands;
proto tolerates gaps). On `Opportunity` (`analysis.proto:447-459`, highest field `provenance = 11`):
`bool muted = 12;` (131 adds no `Opportunity` proto field — its `is_live` is an internal `_candidate`
dict key, so 12 is free). 134's `reliability_weight = 12` is on `ingest.SignalSource`, a different
message — no collision. `denied_symbols` and `signal_eligible` are added to `ManageStrategyRequest`'s
allowed-masked-paths comment (`analysis.proto:298-300`). Additive, non-breaking; `./scripts/buf-gen.sh`.

**2. Shared universe resolver.** Replace the allowlist-only `strategy_symbols(definition)`
(`live_loop.py:37-47`) with a pure module-level `resolve_universe(definition, watchlist, held, signals)`
returning a `NamedTuple(universe, deny_entry, union, denied)`:
- `denied = {_normalize_symbol(s) for s in definition.denied_symbols}` (imports `_normalize_symbol` from
  `servicer.py:2542`, mirroring the existing `live_loop.py:29` cross-import seam).
- `union = norm(allowlist) if signal_params.symbols else (watchlist ∪ held ∪ (signals iff
  definition.signal_eligible))` — the pre-deny coverage set. **AC-5**: a non-empty `signal_params.symbols`
  is treated *as* the universe (an explicit override), not left inert — existing allowlist strategies
  keep their symbols (minus denied) on migration, and stay portfolio-independent.
- `universe = (union − denied) ∪ (held ∩ denied)` — the entry universe with **held-denied symbols
  retained for exit** (Fork A: entry-only deny).
- `deny_entry = held ∩ denied` — the held-denied members whose *entry* edge must be suppressed while
  their *exit* edge stays live.
Both callers share this one function (C-10b structural parity): the live loop uses `.universe`/
`.deny_entry`; `_compute_opportunities` uses `.union`/`.denied` (for muted rows). A 4-branch unit test
(allowlist / no-allowlist×signal_eligible / held∩denied / plain) covers it.

**3. Entry-only deny with held-exit preservation (Fork A).** Deny subtracts from the entry universe and
the live loop's *entry* evaluation only. A held position under the strategy keeps its exit-rule (REDUCE)
tracing and exit alerts even when its symbol is denied — a denied symbol must never blind a user to an
exit on capital they hold. In the live loop, `_apply_transition` (`live_loop.py:50-75`) gains
`deny_entry: bool = False`; when True it short-circuits **only** the entry branch (`:67-70`); the exit
branch (`:71-74`) is byte-for-byte untouched (it reads only `in_position`/`entry_time`/`last_exit_at`/
`decision.exit`, none of which `deny_entry` mutates). `_eval_pair`'s live `latest` call (`:273`) passes
the per-pair `deny_entry`; `_replay_state`'s historical fold (`:103`) passes nothing (default False), so
a held-denied symbol reconstructs a truthful `entry_time` on restart and its live exit fires (never
tripping the unresolved-entry-time skip, `:295-308`). **This amends FR-1/AC-2** — see § Spec Amendments.

**4. Signal-eligibility flag (new FR-8, Fork B).** `signal_eligible` (default false) gates whether the
platform-wide active-signal term joins a strategy's universe. Default-false bounds the universe to
`watchlist ∪ held ∪ allowlist − denied` (owner-scoped, bounded by one owner's real coverage); only
explicitly-flagged strategies (intended: 1-2 screening strategies) pull the unbounded `QuerySignals`
set. A strategy that sets **both** a non-empty allowlist and `signal_eligible=true` is rejected at write
time with `INVALID_ARGUMENT` in `_validate_definition` (which runs on the *merged* definition,
`servicer.py:1705`/`:1682`, so a two-step masked update cannot bypass it — allowlist-as-override would
otherwise silently swallow the flag). Plain-bool (no proto presence) is correct here — absent ≡ false ≡
explicit-false all resolve identically; `signal_eligible` is added to `_MASKABLE_PATHS`
(`servicer.py:2873-2883`), a wizard toggle, and the agent `manage_strategy` param.

**5. Fair-share live-loop scheduling (Fork B, user-directed round 3).** Replace `_run_cycle`'s
truncate-at-`max_strategies_per_cycle`-over-an-unordered-`SELECT` (`live_loop.py:186,188-197`) with a
deterministic-order + identity-keyed rotating cursor so no strategy is permanently starved once the
per-strategy universe balloons from a tiny allowlist to the owner union:
- Select live rows `ORDER BY created_at, strategy_id` (appended to 131's `LIVE_ENABLED_PREDICATE_SQL`).
- Resolve each strategy's owner-scoped universe (per-owner memoized), flatten to
  `pairs = [(created_at, strategy_id, symbol) for row in rows for symbol in sorted(universe(row))]`,
  `pairs.sort()` — `(created_at, strategy_id, symbol)` is a strict total order (two distinct pairs never
  tie; equal `created_at` broken by `strategy_id` then `symbol`).
- `n = min(max_pairs, len(pairs))`; **if `len(pairs)==0`/`n==0` return early without touching the cursor**
  (zero-guard). Evaluate the `n` distinct indices `(start + i) % len(pairs)` where
  `start = bisect_right(pairs, self._cursor_key)` (in-memory tuple, `None` initially); on wrap-past-end
  reset `start=0`. Advance `self._cursor_key` to the last-processed tuple **only when `n>0`**.
- Budget stays `analysis.engine.max_strategies_per_cycle` (no new config key); rotation changes *which*
  pairs, not *how many*. Identity-keyed resume gives real bounded revisit (every pair within
  `⌈len/max_pairs⌉` cycles) that survives universe churn (list rebuilt each cycle) *and* restart — the
  integer cursor only approximated it and reset to 0 on restart.
- **Observability**: when `len(pairs) > max_pairs`, emit one bounded `log.warning` (once per
  `eval_interval_seconds`) + an OTel truncation counter, so residual cap-hits are measurable.

**6. Owner wiring (C-03).** `_run_cycle` reads `owner = definition.user_id` (133 field 13) and fetches
owner-scoped sets, **memoized per owner within the cycle**: `ListPositions(user_id=owner)` + a synthetic
outbound `x-user-id` metadata entry on `ListWatchlists` (reuse 133 design decision 6 /
`fundsignal_loop.py:338-346`); `QuerySignals` (platform-wide) fetched once per cycle, joined per-strategy
only when `signal_eligible`. Added per-cycle RPC cost = `2 × distinct_owners + 1`, bounded by
memoization and by the existing `_lock` cycle-skip (`live_loop.py:176-178`): an overrunning cycle is
skipped, not stacked.

**7. FR-5 muted rows — dedicated `bool muted`, persisted via provenance, exactly one row per pair.**
In `_compute_opportunities`:
- Add `"muted": False` to the `_candidate()` dict (`servicer.py:2117-2127`), sibling to
  `is_watchlist`/`is_held`/131's `is_live`.
- **Held+denied = ONE row**: in the held loop after `c["is_held"]=True` (`:2149`), if `(sym,strat) ∈
  denied`, set `c["muted"]=True` and `_add_provenance(c,"denied")` — flags the *existing* exit-traced
  held row; no second row.
- **Standalone muted emission** (before the `max_universe` cut, after 131's signals-merge): for each
  `(sym,strat) ∈ denied` with `sym ∈ union` and `sym ∉ held_norm`, `_candidate(sym,strat)` (idempotent —
  a watchlist-denied `(X,A)` is flagged, not duplicated), `c["muted"]=True`, `_add_provenance(c,
  "denied")`. The `sym ∉ held_norm` guard mirrors 131's `− held_norm` domain restriction
  (`131/design.md:125,305-317`) that eliminated the double-row-per-held-symbol bug.
- Set `c["muted"] = ("denied" in c["provenance"])` right after the denylist step so the in-memory bucket
  flag and the read-side derivation share one source.
- **Persistence carrier = provenance** (no migration; `analysis.opportunities` has no `muted` column and
  fixed INSERT/SELECT column lists, so a top-level `row["muted"]` would be dropped). `provenance` is a
  real JSONB column that round-trips (`opportunities.py:57,69,98`, `_to_dict:26-31`). `_row_to_opportunity`
  derives `opp.muted = ("denied" in provenance)` (`servicer.py:2596,2607`) — pinned by
  `TestOpportunityRowParity` (`test_analysis_servicer.py:4016-4019`), which fails until `_MAPPED` gains
  `muted` *and* the mapper sets it. `_primary_source` gains `"denied"` to its structural-marker skip
  tuple (`servicer.py:2585`) so it never leaks into `Opportunity.source`.
- **Never truncated, never mis-classified as conviction=0** (fails.md 023): three disjoint buckets at the
  cut (`servicer.py:2173-2177`) with `_sel(c) = is_watchlist or is_held or c.get("is_live",False)`:
  `curated=[_sel]`, `muted_only=[muted and not _sel]`, `speculative=[not(_sel or muted)]`,
  `budget=max(0, max_universe − len(curated) − len(muted_only))`, `selected = curated + muted_only +
  speculative[:budget]`. A watchlist-denied `(X,A)` lands in `curated` only (never also `muted_only`) →
  single `opportunity_key` → no PK collision at `replace_for_user`. The **separate** trace-skip test
  `c["muted"] and not c["is_held"]` (row-assembly loop) skips bars-fetch/trace for muted non-held rows
  and must not be dropped by the `action is None` guard (`:2215-2216`) — it emits a `0/0` placeholder;
  `muted` is the classifier, never `conviction=0`.

**8. FR-5 read-layer fidelity.** The round-1 C-14 fix exempted muted rows from the UI conviction filter
(`opportunities/page.tsx:104-106`) and the conviction sort; the backend `ListOpportunities` read query
also applies a conviction floor (`opportunities.py:105` `o.conviction >= $2`), so it must likewise exempt
muted rows (`WHERE conviction >= $2 OR provenance ? 'denied'`) — otherwise a user with `min_conviction>0`
never sees a muted entry row (a muted non-held row has conviction 0), silently re-introducing FR-5's
"vanish" failure at the DB layer.

**9. entry_backfill from the resolved universe, portfolio-readiness gated.** `entry_backfill.run_once`
(`entry_backfill.py:47-86`) migrates off the deleted `strategy_symbols` (`:83`): its pair-set derives
from `resolve_universe(...).union` (**not** `.universe` — a held-denied position still needs its
`_last_entry_at` anchor so the exit-cooldown gate can fire; deny is entry-only and never applied on this
replay/hydration path), and the existing per-pair `_last_entry_at.get(key) is not None` skip (`:63-64`)
does feature 116's original narrowing. Sourcing from `strategy_cooldowns` keys was rejected — a strict
subset that omits exactly the >365-day-old open positions with no persisted cooldown row that 116 exists
to anchor (fails.md narrowed-subset trap). Because the union now comes from portfolio (Position carries
no `strategy_id`), `run_once` gains a **per-allowlist-free-pair portfolio-readiness gate**
(`await asyncio.wait_for(portfolio_channel.channel_ready(), timeout)` + a bounded RpcError-retry around
the owner-fetch, TimeoutError caught so allowlist-bearing = portfolio-free = 116-equivalent pairs still
proceed) — else a cold-boot swallowed `RpcError` → empty held → the one-shot pass silently misses held
pairs → permanent exit suppression (graceful-skip-becomes-permanent trap). The channel *object* (not the
stub) must be captured at `main.py:67`/passed at `main.py:132`, and the "ListOrders is the only RPC"
docstring (`entry_backfill.py:5-9`) + import (`:18`) amended in the same PR (P-03).

**10. SetStrategyLive precondition.** Delete **only** the `if not strategy_symbols(...)` empty-symbol
branch (`servicer.py:1838-1843`) inside 133's rewritten `get_by_owner_and_id` block, leaving the
existence and active guards intact. Under the deny model an empty deny + empty allowlist now fires the
whole union (AC-1), so the feature-089 precondition would wrongly block a now-valid config; the 089
"stored-flag-never-fires" rationale is recorded as a deliberate, inverted acceptance (P-03).

**11. UI (C-14).** `StrategyWizard.tsx`: a `deniedSymbols` string-chips editor mirroring the `components`
add/remove editor (`:353-374`) + a `signal_eligible` toggle, both in the presence-honest full-replace
merge (`:175-197`). Symbol detail page (`market/[symbol]/page.tsx`): a "mute this symbol for a chosen
strategy" control — loads `listStrategyDefinitions` (owner-scoped post-133) for a strategy picker + each
strategy's current `denied_symbols`, appends, and sends a **masked** `ManageStrategy` update
(`update_mask=["denied_symbols"]`) — the first UI exercise of the mask path; `useManageStrategy`/the
browser client gain an optional `updateMask` param. Opportunities page: `OpportunityCard` + its mobile
`SectionRenderer` branch on `o.muted` — distinct styling, **suppress** the Snooze/Dismiss/Review action
buttons, a link back to the deny-list editor, and muted rows excluded from the min-conviction filter/sort.

**12. Agent (FR-7).** Add `denied_symbols` + `signal_eligible` to `manage_strategy`'s `supplied`
field-map + mask derivation (`tools.py:571-601`) and `client.py`'s `StrategyDefinition` construction
(`:425-438`); read-back (AC-4) is automatic (`MessageToDict(preserving_proto_field_name=True)`). Update
`plugins/strat-lab/skills/backtest/SKILL.md:44-57` in the **same PR** (root CLAUDE.md same-PR rule).

**13. Mapper lockstep.** `denied_symbols`/`signal_eligible` need **no** `_row_to_strategy_definition`
line — they ride `definition_json` via `ParseDict`; fails.md-048 lockstep applies only to column-backed
fields (133's `user_id`/`live_enabled`). Add a real `StrategyDefinition` round-trip test (plain + masked
+ masked-clear) — the OR-F/`TestOpportunityRowParity` test pins the *Opportunity* mapper, not
`StrategyDefinition`.

## Spec Amendments (recorded; applied to product-spec.md this PR)

- **FR-1 / AC-2 (entry-only deny):** deny means "never evaluate for **entry**," not "regardless of held
  position." A held position under the strategy keeps exit-rule (REDUCE) evaluation, exit tracing, and
  exit alerts even when denied; the muted flag is set on that existing held/exit row. A muted *standalone*
  row replaces the entry candidate only for a denied symbol the owner does **not** hold.
- **AC-5 (allowlist-as-explicit-universe-override):** a non-empty `signal_params.symbols` is the universe
  (deny still subtracts); the watchlist∪held∪signals union applies only to allowlist-free strategies. The
  allowlist is not inert — existing allowlist strategies keep their symbols (minus denied) on migration.
- **New FR-8 (`signal_eligible`):** a per-strategy `bool signal_eligible = 14` (default false) gates the
  platform-wide active-signal term; maskable + proto comment + wizard toggle + agent param; a strategy
  setting both an allowlist and `signal_eligible` is rejected `INVALID_ARGUMENT`.

## Rejected Alternatives

- **Reusing `Opportunity.provenance` as the muted marker's *classifier*** (vs. a dedicated `bool muted`)
  — rejected: provenance is the list of *positive* contributing origins consumed by `_primary_source`→
  `source`; a muted pair is an exclusion. The dedicated bool is the distinct state (fails.md 023). (The
  `"denied"` provenance entry is used only as the *persistence carrier* for the bool, not the classifier,
  with `_primary_source` taught to skip it.)
- **Client-derived muted rows** (UI cross-references loaded `denied_symbols`) — rejected: the Opportunities
  page loads no strategy defs, pushes real logic to the client, and can't show muted pairs for strategies
  outside the loaded set.
- **Absolute deny (FR-1 literal, deny wins over held)** — rejected by user (Fork A): would delete a held
  symbol's exit/REDUCE trace and stop the live loop exit-monitoring a position the user owns.
- **Single `union − denied` resolver return** — rejected: cannot express "keep held-denied for exit but
  block entry"; the structured `(universe, deny_entry, union, denied)` return is required.
- **Making the whole live-loop universe unbounded / no signal gate** — rejected by user (Fork B): a new
  `signal_eligible` flag makes the platform-wide signal term opt-in, bounding the fan-out.
- **Deferring fair scheduling (document + config lever only)** — rejected by user (round 3): even with
  zero signal_eligible strategies, watchlist∪held balloons every strategy's universe and the cap starves
  arbitrary strategies silently; fair-share scheduling is built now.
- **Integer rotation cursor** (`_cycle_cursor % len(pairs)`) — rejected: no stable index→pair identity
  under a per-cycle-rebuilt list; identity-keyed `bisect_right` resume is churn/restart-safe.
- **entry_backfill pair-set from `strategy_cooldowns` keys** — rejected: a strict subset omitting exactly
  the never-persisted old open positions 116 targets (narrowed-subset trap).
- **Persisted rotation cursor / durable column** — rejected: 132 forbids a migration; in-memory
  identity-keyed cursor with clean restart-to-oldest is sufficient (mirrors 131's no-hysteresis choice).
- **entry_backfill kept portfolio-free on the raw allowlist** — rejected: the allowlist is gone under 132;
  held→strategy pairing fundamentally needs portfolio, so the readiness gate is the robust remedy.
- **allowlist × signal_eligible left as silent precedence** — rejected: a silent no-op of a user-set
  toggle; rejected at write-time with `INVALID_ARGUMENT` instead.

## Open Risks

- [ ] **entry_backfill cold-boot residual (accepted).** The one-shot backfill has no retry pass after the
  bounded portfolio-readiness gate; a prolonged cold-boot portfolio outage still misses allowlist-free
  held pairs. Bounded, self-healing on next boot, logged once per key (`live_loop.py:301`), and no worse
  than shipped 116 (which was portfolio-free) — but not eliminated. Target: the entry_backfill
  implementation step; revisit if observed.
- [ ] **Live-loop full-universe resolution cost-shift.** Resolving all owners' universes before slicing
  costs `2×distinct_owners + 1` RPCs/cycle vs. today's zero-RPC early-return; bounded by the `_lock`
  cycle-skip. Target: the `_run_cycle` implementation step; record the memoization budget, don't assume
  it free.
- [ ] **FR-5 backend read-filter exemption.** The `ListOpportunities` read query's conviction floor must
  exempt muted (provenance-`denied`) rows, not just the UI filter, or a `min_conviction>0` request hides
  them. Target: the `_compute_opportunities`/read-query implementation step.
- [ ] **R3 channel-object wiring.** `channel_ready()` is a `Channel` method, not a stub method — the
  portfolio channel object (`main.py:67`) must be captured and passed, per allowlist-free pair, with the
  `wait_for` TimeoutError caught. Target: the entry_backfill step.
- [ ] **Field-number re-verification at `/sdd-spec`.** `denied_symbols=12`/`signal_eligible=14` on
  `StrategyDefinition` and `Opportunity.muted=12` must be re-verified free against 133's and 134's landed
  state at spec time (12/13/14 coordination).

## Constitution Rules Touched

- **C-01** (evidence-cited) — honored: every claim traces to a `recon.md`/verified `path:line`; two
  proposer miscites (mapper "no line," provenance persistence) were caught by adversarial verification.
- **C-03** (header propagation) — honored: the live loop synthesizes `x-user-id` per strategy owner
  (reusing 133's mechanism) for its owner-scoped `ListPositions`/`ListWatchlists`.
- **C-04** (enums over strings) — N/A: `muted`/`signal_eligible` are genuinely boolean (a `bool` avoids
  the fails.md-067 proto-enum→TS-exhaustive-`Record` break).
- **C-05 / F-07** (config naming / never hardcode) — honored: fair-share reuses
  `analysis.engine.max_strategies_per_cycle`; no new key; caps read via `self._cfg.get_int(...)`.
- **C-08 / P-06** (test pairing / red-before-green) — honored: `resolve_universe` 4-branch test,
  `StrategyDefinition` round-trip test, muted-row + fair-share tests are named as paired steps.
- **C-09** (proto verification) — honored: `buf lint`/`buf breaking` + `./scripts/buf-gen.sh` on the
  three additive fields.
- **C-10(b)** (parity across duplicated surfaces) — honored: one shared `resolve_universe` consumed by the
  live loop and `_compute_opportunities`; `TestOpportunityRowParity` pins the `muted` mapper.
- **C-14** (name + reach the consumer surface) — honored: UI (`/insights` wizard, symbol page,
  Opportunities card + mobile) and Agent (`manage_strategy` + strat-lab skill) named with per-file changes.
- **P-03** (no silent deviation) — honored: entry-only deny amends FR-1 explicitly; the 089 precondition
  removal, the entry_backfill portfolio edge + docstring amendment, and the cold-boot residual are all
  surfaced, not silently taken.
- **F-01 / F-06** (no applied-migration edit / DB budget) — honored: no migration; reuses the already-wired
  portfolio channel, no new pool.
- **F-11** (Floor halts) — no Floor breach flagged at any of the 5 rounds.
