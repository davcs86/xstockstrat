# Recon: signal-time-decay

**Created**: 2026-08-14
**From**: product-spec.md
**Affected services**: xstockstrat-analysis, xstockstrat-ingest, xstockstrat-config, packages/proto

---

## Objective

Apply exponential age-based decay to a signal's contribution to `_compute_opportunities`'s
`signal_axis` ranking value, so a stale signal loses ranking weight instead of counting equally with
a fresh one until its hard `valid_until` cutoff. Must compose correctly with `130-signal-source-
reliability-weight`'s `weight_for(sig.source)` multiplier and land after both 130 and 131 per the
existing `merge-order.md` same-expression/same-function coordination.

## Codebase Map

- **`xstockstrat-ingest`** (Python)
  - `ExternalSignal` message: `packages/proto/ingest/v1/ingest.proto:106-116` — fields 1-9 in use,
    `tags = 9` highest, field **10 free**.
  - `ingested_at` column: `services/xstockstrat-ingest/migrations/001_newsletter_signals.up.sql:10`
    (`TIMESTAMPTZ NOT NULL DEFAULT NOW()`, also the hypertable partition column at `:23`) — already
    populated automatically on every `IngestSignal` insert (the INSERT statement,
    `servicer.py:760-764`, doesn't list it — DB default fires). **No `IngestSignal` change needed.**
  - `QuerySignals` handler: `servicer.py:898-994` — SELECT list (`:958-959`) and `ExternalSignal(...)`
    construction (`:976-984`) both omit `ingested_at` today — this is the only code change needed in
    ingest.
  - Reusable conversion pattern: `SignalSource.last_seen_at.FromDatetime(last_seen)`
    (`servicer.py:1039-1040`) — direct field `.FromDatetime()` call, simplest analog; `ingested_at` is
    `NOT NULL` so the null-guard `SignalSource` uses isn't even needed.
  - Last migration: `009_signal_dedup_keys` — confirmed no new migration required.

- **`xstockstrat-analysis`** (Python)
  - `_compute_opportunities`: `servicer.py:2083-2242`
  - `signal_axis` init: `servicer.py:2121` (`"signal_axis": 0.0`)
  - Signals-merge loop (**current trunk shape** — 130/131 haven't landed yet):
    `servicer.py:2154-2168`, write site at `:2163`
    (`c["signal_axis"] = max(c["signal_axis"], sig.conviction)`)
  - Speculative-tail sort keyed on `signal_axis`: `servicer.py:2175`
  - Row-assembly persisted value: `servicer.py:2226`
  - `session_end_seconds`/`session_end`: declared `servicer.py:2184`, populated from
    `bars[-1].time.seconds` (marketdata bar timestamp) at `:2202-2204`, **not wall-clock** — confirmed
    bars-derived, not a substitute for a genuine `now_utc`.
  - No `now_utc` variable exists anywhere in the service (grep-confirmed) — FR-5 introduces a
    genuinely new local variable.
  - No exponential-decay/half-life code exists anywhere in the service (grep-confirmed) — net new.
  - `get_float` config-read shape: `servicer.py:286-287,2014` (closest sibling:
    `w = self._cfg.get_float("analysis.opportunity.signal_rank_weight", 0.3)`, same feature area).
  - No `log.debug` call exists anywhere in `servicer.py` (only `log.warning`/`log.info`) — no local
    precedent for FR-6's exact call shape; the mechanism itself (`logging.Logger.debug`) is always
    available regardless.

## Patterns to REUSE

- **Timestamp exposure** → `SignalSource.last_seen_at.FromDatetime(...)` pattern
  (`services/xstockstrat-ingest/app/handlers/servicer.py:1039-1040`) — reuse directly for
  `ExternalSignal.ingested_at`.
- **Config-read shape** → `self._cfg.get_float("analysis.opportunity.signal_rank_weight", 0.3)`
  (`servicer.py:2014`) — same sibling config namespace, same feature area.
- **`.get(key, 1.0)` neutral-default idiom** → already established at `scoring.py:23` for source
  weights; 130's design also adopts this shape for `weight_for(sig.source)` — decay's multiplier
  should compose into the same expression using the same idiom, not a parallel mechanism.

## Dependencies

- Proto/RPC: `ingest.ExternalSignal` gains `google.protobuf.Timestamp ingested_at = 10;` (additive,
  field 10 confirmed free).
- Migration: none — `ingested_at` already exists and is already populated.
- Config keys: new `analysis.scoring.signal_decay_half_life_hours` (float, default `24.0`).
- Inter-service edges: none new — `xstockstrat-analysis → xstockstrat-ingest` `QuerySignals` edge
  already exists and is already called inside `_compute_opportunities`'s signal-drain step; this
  feature only adds a field to the existing response message, no new call.
- New env vars / ports: none.

## Risks / Not-found

- **Critical — the config zero-trap, directly load-bearing for FR-3.** `get_float`
  (`services/xstockstrat-analysis/app/config/watcher.py:124-130`) does `v.float_val or default` — a
  *stored* `0.0` is falsy in Python and silently collapses back to the caller's default. FR-3
  requires "a half-life of 0 or negative must disable decay... to allow rollback without config key
  removal" — if the read uses plain `get_float`, setting the config to `0` would **not** disable
  decay; it would silently re-read as the default `24.0` half-life, the opposite of what an operator
  doing an emergency rollback would expect. This is the exact zero-trap class already documented for
  several other keys in this service's own `CLAUDE.md` (`analysis.scoring.shrinkage_days`,
  `analysis.strategy.default_cooldown_days`, `analysis.opportunity.refresh_hour_utc`) — all of which
  either accept the zero-trap explicitly (documented) or use `get_int_present`/presence-aware reads
  to avoid it. **No `get_float_present` equivalent exists yet** (`watcher.py:103-114` has only
  `get_int_present`). The design must resolve this explicitly: add `get_float_present`, read the
  value differently (e.g. a negative sentinel for "disabled" that a plain `get_float` handles
  correctly, since a negative number is truthy), or accept and document the zero-trap (which would
  mean FR-3 as literally written is not fully satisfiable with the obvious implementation).
- **Not found**: `now_utc`/any wall-clock read near the signals-merge loop — FR-5's single-read
  requirement is genuinely new code, not a rename of `session_end`/`session_end_seconds` (those are
  bars-derived and populated much later in the function, in a different loop).
- **Not found**: any age/emitted-at field on `ExternalSignal` beyond the unused `valid_from` — confirms
  FR-4's proto-change premise exactly (no existing field to repurpose).
- **Composition risk with 130 and 131 (not yet landed, but designed)**: 130's design adds a
  `weight_for(sig.source)` term to the same `servicer.py:2163` expression; 131's design restructures
  the surrounding loop (pre-seeding step for signal-only live-attributed candidates) and touches the
  same `servicer.py:2144-2168` block. This feature's own decay term must compose as a third
  multiplicative factor into the same final expression (`conviction × weight_for(source) ×
  decay_multiplier(age)`), landing last per `merge-order.md`'s 130 → 131 → 022 order — the design
  must state precisely how the three land in sequence without each rebase silently dropping a term.
- **fails.md 2026-08-05 (`023-position-sizing-engine`)**: `Opportunity.conviction` (ordinal) vs.
  `ExternalSignal.conviction` (cardinal) trap — this feature only touches `signal_axis`, built from
  `ExternalSignal.conviction`, never `Opportunity.conviction`; re-confirm explicitly per the ledger's
  own rule (already carried in product-spec.md's Open Questions).
- **insights.md 2026-08-13/14 (this session, 130 and 131)**: verify every claim against real
  code/DB/timing semantics, not prose responsiveness — directly the lesson that surfaced 022's own
  round-3 FR-1/FR-5 contradiction (a variable read before it was computed) and is exactly the shape
  of risk the config zero-trap finding above represents.

## Recommended Scope

1. **Proto**: add `google.protobuf.Timestamp ingested_at = 10;` to `ExternalSignal`.
2. **Ingest servicer**: select + set `ingested_at` in `QuerySignals` only (`IngestSignal` untouched,
   DB default already populates it).
3. **Analysis servicer**: read `now_utc` once at the top of `_compute_opportunities` (new local var);
   read `analysis.scoring.signal_decay_half_life_hours` via a zero-trap-safe path (resolve the Risk
   above first); compute `decay_multiplier = exp(-ln(2)/half_life × age_hours)` per signal in the
   signals-merge loop; compose into `signal_axis`'s existing expression as a third factor.
4. **Config**: register `analysis.scoring.signal_decay_half_life_hours` (float, default 24.0) —
   standard config-registration pattern, no new mechanism.
5. **Sequencing**: this feature's implementation must be spec'd/executed only after 130 and 131 land
   (merge-order.md), and its own `/sdd-spec` step must cite the *actual landed* `signal_axis`
   expression at that time, not this recon's current-trunk citation — flag this explicitly so
   `/sdd-spec` doesn't cite stale line numbers.
