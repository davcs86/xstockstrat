# Design: signal-time-decay

**Created**: 2026-08-14
**Rounds**: 4 (full mode; round 1 found a structurally-reachable negative-`age_hours` bug, round 2
found an `UnboundLocalError` risk + a deploy-ordering signal-blackout risk, round 3 fixed both and
was verified sound, round 4 finalized 4 remaining mechanical objections — including a proactively
self-found nested-loop amplification bug — with zero Floor breaches at any round); termination:
approved
**Approved by**: user @ 2026-08-14
**Grounded in**: recon.md

---

## Chosen Approach

**Proto.** Add `google.protobuf.Timestamp ingested_at = 10;` to `ingest.ExternalSignal`
(`packages/proto/ingest/v1/ingest.proto:106-116`, next free field number after `tags = 9`) —
additive, non-breaking.

**Ingest servicer.** `QuerySignals` (`services/xstockstrat-ingest/app/handlers/servicer.py:898-994`)
selects the already-existing `ingested_at` column (`services/xstockstrat-ingest/migrations/
001_newsletter_signals.up.sql:10`, `NOT NULL DEFAULT NOW()`) and sets it on the constructed message
via `.FromDatetime(...)`, mirroring the existing `SignalSource.last_seen_at.FromDatetime(...)`
pattern (`servicer.py:1039-1040`). `IngestSignal` is untouched — the DB default already populates
the column on every insert.

**Config.** New `analysis.scoring.signal_decay_half_life_hours` (float, default `24.0`). Read via a
new `get_float_present(key, default)` method added to `ConfigWatcher`
(`services/xstockstrat-analysis/app/config/watcher.py`), mirroring `get_int_present`
(`watcher.py:103-114`) exactly: `HasField("float_val")` on the stored `ConfigValue`'s `float_val`
oneof member (`packages/proto/config/v1/config.proto:48-52`) rather than plain `get_float`'s
`v.float_val or default`, which would silently swallow an operator-set `0` back to the `24.0`
default — defeating FR-3's "0 or negative disables decay for rollback" contract (the exact zero-trap
class recon.md flagged as Critical). **This is a required implementation-bound code change, not an
implied side effect of the pseudocode below** — `/sdd-spec` must include adding this method as an
explicit step; falling back to plain `get_float` reproduces the zero-trap this feature exists to
avoid.

**Analysis servicer — `_compute_opportunities` signals-merge section.** The current-trunk
signals-merge section (`servicer.py:2152-2168`) is a **two-level nested loop** —
`for sym, sigs in signals_by_symbol.items(): targets = [...]; for key in targets: for sig in
sigs: ...` — not a flat per-signal loop, because a symbol can be bound to more than one watchlist
strategy (`targets` can have >1 entry, `servicer.py:2103-2105,2135-2150`). The design computes each
signal's decayed contribution **once per signal**, hoisted above the `targets` loop into a
`sig_contribs` list, then reuses it across every `target` — computing/logging/counting inside the
inner `targets` loop instead would re-decay, re-log (DEBUG), and re-count (missing-`ingested_at`)
the same signal once per bound strategy, amplifying exactly the log-volume problem the aggregated
warning below exists to prevent. This was not part of the original mechanism; round 4 found it while
grounding the aggregation fix against the real code.

```python
# once per compute pass, immediately after servicer.py:2098's await resolves —
# before :2099/:2100 start, and before any per-signal age computation
now_utc = datetime.now(UTC)
half_life = self._cfg.get_float_present(
    "analysis.scoring.signal_decay_half_life_hours", 24.0
)
missing_ingested_at_count = 0
total_signal_count = len(signals)

# section 3: signals merge (servicer.py:2152-2168 current-trunk shape)
for sym, sigs in signals_by_symbol.items():
    targets = [k for k in candidates if k[0] == sym]
    if not targets:
        _candidate(sym, "")
        targets = [(sym, "")]

    # Precompute each signal's decayed contribution ONCE per signal, hoisted above
    # the `targets` loop — see nested-loop finding above.
    sig_contribs = []
    for sig in sigs:
        raw_conviction = sig.conviction
        source_weight = weight_for(sig.source)  # 134's landed term — see composition note below

        if sig.HasField("ingested_at"):
            ingested_dt = sig.ingested_at.ToDatetime(tzinfo=UTC)
            raw_age_hours = (now_utc - ingested_dt).total_seconds() / 3600
            age_hours = max(0.0, raw_age_hours)       # defensive clamp — round 1 fix
            age_clamped = raw_age_hours < 0.0          # diagnosable clock skew — round 2 item 3
            age_known = True
        else:
            raw_age_hours = None
            age_hours = None
            age_clamped = False
            age_known = False
            missing_ingested_at_count += 1

        # Age derivation (above) branches ONLY on HasField(ingested_at); decay
        # application (below) branches ONLY on half_life. Neither depends on the
        # other's outcome, so age_hours/decay_multiplier/effective_conviction are
        # always bound before the log call, in every one of the 4 combinations
        # (half_life<=0 or >0) x (ingested_at present or absent) — this is what
        # closes round 2's UnboundLocalError finding.
        decay_multiplier = (
            math.exp(-math.log(2) / half_life * age_hours)
            if (half_life > 0 and age_known)
            else 1.0
        )

        effective_conviction = raw_conviction * source_weight * decay_multiplier
        if not math.isfinite(effective_conviction):
            effective_conviction = 0.0   # explicit guard — see NaN note below

        log.debug(
            "signal_axis decay: symbol=%s source=%s raw_conviction=%s source_weight=%s "
            "age_hours=%s age_known=%s age_clamped=%s decay_multiplier=%s effective_conviction=%s",
            sym, sig.source, raw_conviction, source_weight,
            age_hours, age_known, age_clamped, decay_multiplier, effective_conviction,
        )
        sig_contribs.append((sig, effective_conviction))

    for key in targets:
        c = candidates[key]
        for sig, effective_conviction in sig_contribs:
            _add_provenance(c, sig.source)
            c["signal_axis"] = max(c["signal_axis"], effective_conviction)
            if sig.conviction > c["_best_sig_conv"]:   # unchanged: stays keyed on RAW conviction
                c["_best_sig_conv"] = sig.conviction     # — see scope note below
                c["best_direction"] = sig.direction
                if not c["thesis"]:
                    c["thesis"] = sig.headline

# after both loops complete, before the max_universe_size cut (servicer.py:2172)
if missing_ingested_at_count > 0:
    log.warning(
        "%d of %d signals missing ingested_at this compute pass; treated as fresh "
        "(decay_multiplier=1.0)",
        missing_ingested_at_count, total_signal_count,
    )
```

**Four finalized decisions (round 3 → round 4), each closing a specific adversary finding:**

1. **`age_hours` always bound before the log call.** Age derivation and decay application are two
   independent branches (presence-of-`ingested_at` vs. `half_life` sign) — neither's outcome gates
   the other, so all four log-referenced names are assigned in every branch combination. Closes
   round 2's `UnboundLocalError` finding (FR-3's disable path is an intentional, expected operator
   rollback action, not a rare edge case that could be allowed to crash).
2. **`sig.HasField("ingested_at")` guard.** `ingested_at` is a plain `google.protobuf.Timestamp`
   submessage field on `ExternalSignal` (not a oneof, not a scalar) — `HasField` is valid,
   confirmed usage. On absence (structurally reachable via an ingest/analysis independent-deploy
   ordering race, since the two services redeploy on separate merges per root `CLAUDE.md` § CI/CD),
   the signal is treated as "unknown/fresh" — `decay_multiplier = 1.0`, matching the neutral-default
   idiom already established for source weights (`scoring.py:23`) — instead of a zero-value
   `Timestamp` (epoch 1970) producing ~55 years of raw age and underflowing every signal's
   contribution to `0.0` platform-wide. Closes round 2's deploy-race blackout finding.
3. **Aggregated WARNING, not per-signal.** `missing_ingested_at_count`/`total_signal_count` are
   incremented **once per distinct signal** (hoisted above the `targets` loop, per the nested-loop
   finding above — incrementing inside the `targets` loop would multiply the count by
   `len(targets)`). One `log.warning(...)` fires after the full section-3 double loop completes,
   guarded by `if missing_ingested_at_count > 0`. `_compute_opportunities` runs per-user (lazy
   compute-on-read plus a configured daily refresh across the known-user set), so an unguarded
   per-signal `log.warning` would emit noise proportional to (active signals × active users) for
   the duration of a routine, self-resolving deploy-ordering race. Closes round 3's self-flagged
   log-volume risk.
4. **Explicit `isfinite()` guard, not a doc-only tripwire.** `if not math.isfinite(effective_conviction):
   effective_conviction = 0.0`, placed immediately after computing `effective_conviction` and before
   the `max()` call. Under today's guarded inputs (`source_weight` clamped `[0, 1]` per 134's design,
   `age_hours` clamped `≥0`, `half_life > 0` on the decay-active branch) `NaN` cannot actually occur —
   this guard is pure future-refactor insurance, adopted because `max(c["signal_axis"],
   effective_conviction)`'s existing NaN fail-safety is an emergent property of argument order
   (`c["signal_axis"]` must stay the first argument) with zero test coverage; a plausible-looking
   future refactor (reordering the `max()` call, or switching to `max(items)` over a list) would
   silently reintroduce NaN propagation with no signal at review time. One cheap branch per signal
   converts an implicit invariant into an explicit, test-verifiable one — consistent with "write the
   minimum" because the insurance itself is minimal, not because the guard is currently load-bearing.

**Composition with 134 (`weight_for(sig.source)`) — verify at spec time, not design time.** As of
this design round (2026-08-14), `134-signal-source-reliability-weight` is **not** landed on
`main-dev`: `grep -rn "def weight_for" services/xstockstrat-analysis/` returns zero hits, and the
current-trunk write site (`servicer.py:2161-2168`) is still `c["signal_axis"] = max(c["signal_axis"],
sig.conviction)` — no `source_weight` term. This design assumes the landing order `134 → 131 → 022`
per `docs/roadmap/features/merge-order.md:59-60`. **`/sdd-spec` for this feature must re-grep and
re-read the actual landed `_compute_opportunities` body at spec time and cite what it actually finds
there — it must not treat this design.md's (or recon.md's) citation of `weight_for` as current
fact.** This is the same claim-vs-producer-contract failure family already named in `fails.md`
2026-08-05 (`023-position-sizing-engine`) and 2026-07-30 (`080-fix-backfill-timeframe-enum`), and the
`_compute_opportunities` loop shape itself (the two-level nested structure this design's own
hoisting depends on) may also shift once 134's and 131's changes land — the *behavioral* contract
(decay computed once per signal, aggregated warning, NaN guard, raw-conviction-keyed thesis
selection) is durable; the literal code shape is not guaranteed stable across two un-landed upstream
features, and `/sdd-spec` must re-derive it rather than copy this pseudocode verbatim. **No
defensive coding pattern (e.g. `getattr`/duck-typing around `weight_for`) is added at design time**:
`merge-order.md`'s hard `134 → 131 → 022` sequencing means `weight_for` is guaranteed to exist by
the time `/sdd-spec` runs against real code; if that ordering were ever violated, **F-04**
(`docs/sdd/constitution.md:76`, "Never invent a file path or symbol. If discovery does not find it,
block the step.") already blocks `/sdd-spec` from citing/inventing an absent symbol, rather than
requiring this design to guess at 134's not-yet-decided failure semantics (raise? return `None`?
— per the `.get(key, 1.0)` neutral-default idiom `scoring.py:23` already establishes for 134 itself).
A runtime guard here would be speculative scaffolding for a codepath that cannot exist in the
delivered artifact, per root `CLAUDE.md`'s "write the minimum" principle.

**Accepted V1 scope limit — thesis/direction selection stays decay-blind.** `_best_sig_conv`/
`best_direction`/`thesis` selection (`servicer.py:2164-2168`) stays keyed on **raw** `sig.conviction`,
unchanged from current code — FR-1 scopes decay to `signal_axis` only. This is a deliberate,
documented asymmetry, not an oversight: once this ships, the queue's *ranking* becomes decay-aware
while the *displayed thesis text and direction* stay decay-blind — a stale signal can still supply
the headline even after its ranking contribution has decayed toward zero. Consistent with the
product-spec's existing V1-minimalism (single global half-life, no per-source rates, no maximum-age
floor); a future feature could extend decay to thesis selection if this proves confusing in
practice.

---

## Rejected Alternatives

- **Sentinel-value zero-trap workaround (negative `half_life_hours` as the disable signal, read via
  plain `get_float`)** — recon's own alternative: since a negative number is truthy, `get_float`
  handles it correctly without a new config-watcher method. Rejected: overloads "half-life" with a
  non-obvious disable convention that diverges from FR-3's own literal wording ("0 or negative
  disables"), and diverges from the already-established `get_int_present` precedent used for this
  service's other zero-trap-prone keys (`refresh_hour_utc`, `default_exit_cooldown_days`).
  `get_float_present` is the more consistent, self-documenting choice.
- **Computing decay inline inside the original `for key in targets: for sig in sigs:` loop** (no
  `sig_contribs` hoist) — simpler diff, but confirmed (round 4 adversary, against the real code) to
  reintroduce the log-volume/counting amplification the aggregated-warning fix targets: any symbol
  bound to more than one watchlist strategy would re-decay, re-log at DEBUG, and re-increment
  `missing_ingested_at_count` once per bound strategy instead of once per signal. Rejected.
- **Doc-only NaN tripwire (a design.md comment, no code guard)** — round 2/3's original minimal-scope
  instinct. Rejected in round 3/4: the thing it protects against is a plausible, silent future
  refactor (reordering a `max()` call), not a pathological one-off input; a comment nobody re-reads
  mid-refactor is not equivalent to a guard, and the explicit `isfinite()` check costs one cheap
  branch per signal.
- **A companion `ingested_at_known` bool field on `ExternalSignal`** (round 2's "better alternative,"
  mirroring `ConfigValue.is_secret` as a sibling flag rather than inferring presence from message
  state) — rejected as overbuilt for a transient deploy-window condition; `sig.HasField("ingested_at")`
  (matching the codebase's own `get_int_present`/`get_bool` `HasField` idiom) is the minimum fix and
  needs no proto change beyond FR-4's already-planned field addition.
- **A code-level `min`-bound on `half_life_hours` at config-registration time** (guarding the
  theoretical `1e-300`-half-life NaN edge case) — rejected as unrequested scaffolding for an
  operator input this far outside FR-2's intended tuning range (default `24.0`); the explicit
  `isfinite()` guard (adopted) already closes the actual failure mode without adding a
  config-registration-time validation mechanism nothing else in this feature needs.

---

## Open Risks

- **Composition with 134/131's landed shape is unverified until `/sdd-spec` time** (see Chosen
  Approach's composition note). Not a blocker — `merge-order.md` already sequences 134 → 131 → 022,
  the fix is procedural (re-grep at spec time), and **F-04** structurally prevents `/sdd-spec` from
  inventing `weight_for` if that ordering were ever violated. Carried forward as an explicit
  `/sdd-spec` instruction, not left implicit. (Re-evaluated in a follow-up round, 2026-08-14: no
  defensive code was added — see the "No defensive coding pattern" note in Chosen Approach — since
  F-04 already backstops the only failure mode a runtime guard would protect against, and adding one
  would be speculative scaffolding for a codepath guaranteed to exist by spec time.)

## Scope Decisions (not risks)

- **Thesis/direction selection stays decay-blind.** Reclassified out of Open Risks in a follow-up
  round (2026-08-14) — this is not open technical uncertainty, it is a fully resolved product-spec
  scope boundary. FR-1 (`product-spec.md:39`) is the sole functional requirement defining where decay
  applies, and it names only `signal_axis`; no FR or AC covers `thesis`/`best_direction`/
  `_best_sig_conv` (confirmed by re-reading `servicer.py:2164-2168`'s actual write site — unaffected
  by this feature). Extending decay there would be user-visible scope expansion (which signal
  supplies the displayed headline/direction) beyond what the approved product-spec specified or
  wrote acceptance criteria for — that requires a product-spec amendment and re-approval via
  `/sdd-story`, not a design-time judgment call. Flagged here, not silently dropped, so a future
  reader asking "should thesis decay too?" finds the answer already reasoned through rather than
  re-opening it as if undecided.

---

## Constitution Rules Touched

- **C-01 (zero-assumption / evidence-cited)** — every mechanism decision above cites the exact
  file:line evidence it rests on (`servicer.py`, `watcher.py`, `config.proto`, `ingest.proto`,
  `merge-order.md`); round 4 explicitly re-verified the nested-loop structural claim against the
  real code rather than trusting the prior round's shorthand description.
- **P-03 (no silent deviation)** — the `age_hours`-unbound branch ambiguity (round 2) and the
  `ingested_at`-unset deploy-race gap (round 2) were both pinned down with concrete, explicit
  branch logic rather than left for `/sdd-spec` to improvise.
- **C-08 (test-step pairing)** — `product-spec.md` AC-5 amended and AC-7 added (this session, same
  pass as this design.md) specifically to cover the two regression surfaces round 2's defects
  represent (`age_known=False` branch; aggregated-vs-per-signal WARNING call count) — not left as
  untested behavior.
- **Known trap re-confirmed** (`fails.md` 2026-08-05, `023-position-sizing-engine`) — this design
  only ever touches `signal_axis`/`sig.conviction` (`ExternalSignal`'s cardinal field), never
  `Opportunity.conviction` (the ordinal readiness field). Re-confirmed clean at every round,
  including round 4's direct re-read of the thesis/direction selection block.
- **Ledger pattern re-applied** (`insights.md` 2026-08-13/14, this session's own 134/131 lesson —
  "verify every claim against real code/DB/timing semantics, not prose responsiveness") — this
  exact lesson recurred one layer deeper inside 022's own round 3 (the "134 already landed" claim
  was prose-plausible but code-false) and was caught and corrected before reaching `design-approved`.
