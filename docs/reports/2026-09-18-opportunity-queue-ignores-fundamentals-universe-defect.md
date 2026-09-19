# Defect: the opportunity queue ignores the feature-168 fundamentals-universe restriction

**Date**: 2026-09-18
**Reporter**: davcs86@gmail.com (via Claude Code)
**Severity**: SEV-3
**Impact type**: behavior-correctness (advisory surface) / attribution-correctness
**Environment**: staging (observed); the defect is in shipped code, so production is affected identically
**Affected service(s)**: `xstockstrat-analysis` (`ListOpportunities` / `_compute_opportunities`, `entry_backfill`)
**Config-only fix possible**: no

> Severity rationale: the **live evaluation loop is correct** — alert- and order-triggering
> evaluation stays inside the fundamentals universe, so nothing mis-fires automatically and no
> money moves. What diverges is the Decide surface: the queue presents blend-attributed entry
> candidates the engine would never produce, so a human (or an agent reading `list_opportunities`)
> can act on an attribution the engine does not stand behind. Raise one level at design time if
> root-causing shows any automated consumer acting on queue rows without a human gate.

## Observed (staging)

`list_opportunities` returns 11 rows attributed to `fundamentals_macd_blend`. **6 of them carry no
`fundamentals` provenance at all:**

| Symbol | Action | Provenance | In fundamentals universe? |
|---|---|---|---|
| MSFT | REDUCE | position, live_strategy, sec_edgar_form4, sec_edgar_8k, **fundamentals** | yes |
| LYFT | REDUCE | position, live_strategy, **fundamentals** | yes |
| JPM | REDUCE | position, live_strategy, **fundamentals** | yes |
| NVDA | REDUCE | position, live_strategy, **fundamentals**, sec_edgar_form4 | yes |
| LRCX | REDUCE | position, live_strategy, **fundamentals** | yes |
| SBUX | REDUCE | position, live_strategy, sec_edgar_form4 | **no** |
| SMCI | REDUCE | position, live_strategy, sec_edgar_8k, robinhood_snacks | **no** |
| COIN | REDUCE | position, live_strategy, sec_edgar_8k | **no** |
| PLTR | REDUCE | position, live_strategy, sec_edgar_form4 | **no** |
| **BRK.B** | **ENTER** | live_strategy, sec_edgar_form4 | **no** |
| **RDDT** | **ENTER** | live_strategy, sec_edgar_form4, prnewswire_releases | **no** |

BRK.B and RDDT are the sharpest cases: `ENTER` rows with **no `position` provenance** — pure entry
candidates attributed to the blend on symbols the live loop would never evaluate it against.

## Expected

Feature 168's stated contract is that the blend strategy runs on the fundamentals universe
"and nowhere else". Its `acceptance.feature` **@AC-2** is explicit:

> Given user "u-1" has a watchlist containing GME and a held position in AMC
> And neither GME nor AMC has an active "fundamentals" signal
> Then fundamentals_macd_blend is not evaluated for GME or AMC

The opportunity queue should attribute the blend only to symbols in the fundamentals universe
(active `source == "fundamentals"` signal ∩ symbols with a `GetFundamentalsMulti` row), minus its
deny list — exactly the set the live loop computes.

## Reproduction

1. Ensure `analysis.engine.fundamentals_blend_enabled = true` and `fundamentals_macd_blend` is live
   (both currently true on staging).
2. Call `list_opportunities` (or open the Decide surface).
3. Filter rows to `strategy_id == "fundamentals_macd_blend"` and inspect `provenance`.
4. Observe rows whose provenance omits `fundamentals`.

## Root cause

The feature-168 universe substitution exists in **exactly one place** — `app/engine/live_loop.py:296-302`:

```python
if definition.strategy_id == blend_id:
    denied = {_normalize_symbol(s) for s in definition.denied_symbols}
    deny_entry = held_cache[owner] & denied
    universe = (fundamentals_universe - denied) | deny_entry
else:
    resolved = resolve_universe(definition, watch_cache[owner], held_cache[owner], signal_symbols)
```

The opportunity queue is a **separate enumeration path with no such branch** —
`app/handlers/servicer.py:3909-3913`:

```python
for row in await self._strategies_repo.list_live_enabled(user_id):
    definition = _row_to_strategy_definition(row)
    resolved = resolve_universe(definition, wl_set, held_norm, sig_set)   # no blend branch
    for sym in resolved.union:
        live_by_symbol.setdefault(sym, set()).add(row["strategy_id"])
```

A repo-wide grep for `fundamentals_blend_strategy_id` finds only two hits outside `live_loop.py`,
and both are feature-186 **write guards** (`servicer.py:2529` DEACTIVATE, `:2657` set-non-live).
Nothing on any read path.

### Compounding factor — `signal_eligible: true`

`fundamentals_macd_blend` carries `signal_eligible: true`. In `resolve_universe`
(`live_loop.py:103`) that makes:

```python
union = allowlist or (watchlist | held | (signals if definition.signal_eligible else set()))
```

…where `signals` is the **platform-wide, cross-user, source-unfiltered** active-signal pool from
`_drain_signals` (`live_loop.py:366-393`). So on the queue surface the blend receives the *widest*
universe of any strategy — precisely inverted from feature 168's intent. The flag is harmless in
the live loop (the blend branch fires before `resolve_universe` is reached) and load-bearing only
here, which is why it went unnoticed. This is exactly why the ❌ rows above entered via
Form-4 / 8-K / PR Newswire / Robinhood signals.

## Why it shipped

All six scenarios in `docs/roadmap/features/168-fundamentals-blend-universe/acceptance.feature` are
scoped `When the live evaluation loop runs a cycle`. The feature narrative says "nowhere else", but
no scenario binds any surface other than the loop, so the queue path was never in the acceptance net.

## Sibling leak site

`resolve_universe` has three callers; only the live loop branches on the blend:

| Site | Blend branch? | Impact |
|---|---|---|
| `app/engine/live_loop.py:305` | yes | correct |
| `app/handlers/servicer.py:3911` (`_compute_opportunities`) | **no** | this defect |
| `app/engine/entry_backfill.py:95` (boot-time entry backfill) | **no** | backfills entry times for blend pairs outside the fundamentals universe |

Separately, `servicer.py:4546` (the feature-180 readiness materializer) enumerates
`list_live_enabled()` and pre-warms readiness per owner. It does not call `resolve_universe`
directly, so whether it can cache blend readiness rows off-universe is **unverified** — worth
checking during design rather than assumed either way.

## Questions for design

1. **Hoist or patch?** Two options, and they differ materially:
   - **A — hoist into `resolve_universe`**: pass `blend_id` + `fundamentals_universe` in so all
     three callers inherit the restriction from one place and a future caller #4 cannot miss it.
     Costs a signature change and makes the queue path resolve the fundamentals universe per
     compute (an extra `QuerySignals` + `GetFundamentalsMulti`, cacheable — note the live loop
     deliberately resolves it lazily for pacing, `live_loop.py:276-280`).
   - **B — patch `_compute_opportunities` only**: smaller diff, leaves `entry_backfill` divergent
     and re-commits to the duplication that caused this defect.

   The defect *is* a duplicated-contract failure, which argues for A; B needs an explicit decision
   to accept the remaining divergence.
2. Should `signal_eligible` remain `true` on the blend strategy at all? It is inert in the loop and
   actively harmful on the queue. If it is set false, note that retargeting
   `analysis.engine.fundamentals_blend_strategy_id` elsewhere would otherwise silently hand the old
   blend the full cross-user signal pool.
3. Add acceptance coverage binding the **queue** surface, not only the loop — the missing @AC is the
   reason this shipped (Constitution **C-15**/**C-16**).

## Related

Surfaced while investigating why `fundamentals_macd_blend` appeared to have no entry/exit rules.
That investigation produced a separate UI-gap report
(`2026-09-18-strategy-detail-definition-not-rendered-defect.md`), which is **not** part of this one.
