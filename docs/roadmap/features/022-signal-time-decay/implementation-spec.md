# Implementation Spec: signal-time-decay

**Status**: `pending`
**Created**: 2026-08-14
**Feature**: `docs/roadmap/features/022-signal-time-decay/feature.md`
**Total Steps**: 7
**Feature Branch**: `feature/signal-time-decay`

---

## Execution Summary

Exponential age decay is applied to a signal's contribution to the Opportunities queue's
`signal_axis` ranking in `_compute_opportunities` (`services/xstockstrat-analysis/app/handlers/servicer.py`).
Delivery order: (1) expose the already-stored `ingested_at` timestamp end-to-end — add the proto field
(step 1), regenerate stubs (step 2), select+populate it in ingest's `QuerySignals` (steps 3–4); then
(2) add a zero-trap-safe config read and the decay math in analysis (steps 5–6); finally (3) declare
the new config key's default in the analysis service `CLAUDE.md` (step 7).

**Consumer surface (C-14) — no UI/Agent step, by decision, not omission.** The product spec's
`## Consumer Surface(s)` names the `/insights` Opportunities page but explicitly states *"no new page
or control — the existing queue ordering (`signal_axis`-driven ranking, already rendered via
`ListOpportunities`) reflects decayed contributions once this ships."* `ListOpportunities` is a pure
read of the materialized `signal_axis` (analysis `CLAUDE.md` § Decide-surface RPCs); decaying that
value at compute time changes the existing ranking with no frontend change. The Agent surface is
marked `None` (no MCP tool exposes `signal_axis` computation). Therefore no `xstockstrat-ui` or
`xstockstrat-agent` step is required.

**Config key is runtime-registered — no config-service seed migration (deliberate, precedent-backed).**
`analysis.scoring.signal_decay_half_life_hours` is read with a default via the new `get_float_present`
(step 5); when no config row exists the default `24.0` applies, and an operator can `SetConfig` a row
later (including `0` to disable, per FR-3). This matches the exact sibling precedent: the other
`analysis.scoring.*` keys (`shrinkage_days`/`min_evidence_symbols`/`min_evidence_days`, feature 065) are
**not** seeded by any `services/xstockstrat-config/migrations/` file (confirmed:
`services/xstockstrat-config/docs/context-constitution-findings.md:13` records they are runtime-registered;
`grep -rln "analysis\." services/xstockstrat-config/migrations/` returns only `003`/`008`, neither
touching `analysis.scoring`). The design (`design.md` § Chosen Approach — Config) commits only to the
watcher method + `CLAUDE.md` default, no migration. *Tradeoff surfaced:* if an operator wants the row
pre-loaded so it appears in config-ui without a manual `SetConfig`, a `016_analysis_scoring_decay`
seed migration (mirroring `003_analysis_signal_source_weights`) could be added — it is **not** required
for correctness and is intentionally out of scope here.

## Step Dependencies

- Step 2 (`proto-gen`) requires Step 1 (`proto`): stubs regenerate the new `ingested_at` field.
- Step 3 (ingest `QuerySignals`) requires Step 2: the constructed `ExternalSignal` message must have
  the `ingested_at` field present in the regenerated `ingest_pb2`.
- Step 4 (`test`, ingest) covers Step 3.
- Step 5 (analysis decay) requires Step 2: reads `sig.HasField("ingested_at")` / `sig.ingested_at` on
  the regenerated stub. It does **not** require Step 3 at compile time — the `HasField` guard handles a
  signal whose `ingested_at` is unset — but the end-to-end acceptance (AC-1, AC-6) requires Steps 1–4
  so a real `QuerySignals` response carries a populated `ingested_at`.
- Step 6 (`test`, analysis) covers Step 5.
- Step 7 (`config` doc) declares the key default read in Step 5; independent of ingest steps.

- **MERGE-ORDER / REBASE CONSTRAINT (hard) — `merge-order.md` rows for 022.** This feature's final
  integration PR must land **after** `134-signal-source-reliability-weight` and
  `131-live-strategy-opportunity-attribution` (landing order **134 → 131 → 022**;
  `docs/roadmap/features/merge-order.md:59-60`). **As of this spec (2026-08-14) neither has landed** —
  both are `implementation-ready`, and the current-trunk write site is verified to be
  `c["signal_axis"] = max(c["signal_axis"], sig.conviction)` (`servicer.py:2163`) with **no**
  `source_weight` term (`grep -rn "weight_for" services/xstockstrat-analysis/` → zero hits;
  `live_by_symbol` → zero hits). Per Constitution **F-04** this spec cites **only** the real current
  code and does **not** invent `weight_for`/`source_weight` in `_compute_opportunities`. **At execute
  time `/sdd-execute` MUST re-grep the actual landed `_compute_opportunities` body** and rebase Step 5
  onto it: (a) if 134 has landed, the composed expression gains a `× source_weight` factor
  (`effective_conviction = sig.conviction * source_weight * decay_multiplier`) and the DEBUG log adds
  `source_weight` — but only if `weight_for`/the source-weight lookup actually exists in the landed
  code, never invented; (b) if 131 has landed, the signals-merge loop shape (candidate pre-seeding /
  `live_by_symbol`) may differ — re-confirm the two-level `for key in targets: for sig in sigs:`
  nesting still holds before applying the `sig_contribs` hoist, and re-derive the exact line anchors.
  The **behavioral** contract in Step 5 (decay computed once per signal, hoisted above the `targets`
  loop; `now_utc` captured once after the `_drain_active_signals` await; `HasField` presence guard;
  one aggregated WARNING per compute pass; explicit `isfinite` guard; DEBUG log per signal;
  thesis/`best_direction`/`_best_sig_conv` stay keyed on **raw** conviction) is durable regardless of
  loop shape; only the literal code anchors and the presence/absence of the `source_weight` factor
  depend on 134/131's landed state.

---

### Step 1 — proto: add `ingested_at` to `ExternalSignal`

**Status**: `pending`
**Service**: `packages/proto`
**Files**:
- `packages/proto/ingest/v1/ingest.proto` — modify

**Reviewers**: Proto Reviewer — field number uniqueness / no breaking change without deprecation / `buf lint` + `buf breaking`; `xstockstrat-ingest` owner — newsletter source schema stability; `xstockstrat-analysis` owner — consumes the regenerated stub

**Codebase Evidence**:
- `ExternalSignal` message: `packages/proto/ingest/v1/ingest.proto:106-116` — fields 1–9 in use, highest
  is `repeated string tags = 9;` (`:115`); **field 10 is free**.
- `google.protobuf.Timestamp` is already imported and used in this message
  (`valid_from = 5`/`valid_until = 6`, `:111-112`) — no new import needed.

**TDD**: `N/A (proto — additive field; buf lint/breaking is the gate)`

**Instructions**:
1. In `message ExternalSignal` (`ingest.proto:106-116`), after `repeated string tags = 9;` (`:115`),
   add:
   ```proto
   google.protobuf.Timestamp ingested_at = 10;  // platform ingestion time (server-set, immune to source timestamp manipulation) — feature 022
   ```
2. Do not renumber or reserve any existing field (additive, non-breaking).

**Verification**:
```bash
cd packages/proto && buf lint && buf breaking --against ".git#branch=feature/signal-time-decay"
```
Both pass (additive field is non-breaking).

---

### Step 2 — proto-gen: regenerate stubs

**Status**: `pending`
**Service**: `packages/proto`
**Files**:
- `packages/proto/gen/**` — modify (regenerated TS/Python/Go stubs — do not hand-edit)

**Reviewers**: Proto Reviewer — field number uniqueness / `buf lint` + `buf breaking`; `xstockstrat-ingest` owner; `xstockstrat-analysis` owner (inherited from Step 1)

**Codebase Evidence**:
- Codegen entry point: `scripts/buf-gen.sh` (root `CLAUDE.md` § Generating Proto Stubs — "generates
  TypeScript, Python, and Go stubs and compiles the TS package"). CI `proto-freshness` job enforces an
  empty `git diff packages/proto/gen/` after regeneration.

**TDD**: `N/A (proto-gen — deterministic codegen; freshness diff is the gate)`

**Instructions**:
1. Run `./scripts/buf-gen.sh` from the repo root.
2. Stage the regenerated stubs under `packages/proto/gen/` (Python `ingest_pb2`, TS, Go all pick up the
   new `ingested_at` field). Do not hand-edit generated output.

**Verification**:
```bash
./scripts/buf-gen.sh && git diff --exit-code packages/proto/gen/ || echo "expected: only ingested_at additions staged"
```
After staging, `git status` shows the new field in the generated `ingest` stubs and nothing unrelated.

---

### Step 3 — service: expose `ingested_at` in ingest `QuerySignals`

**Status**: `pending`
**Service**: `xstockstrat-ingest`
**Files**:
- `services/xstockstrat-ingest/app/handlers/servicer.py` — modify

**Reviewers**: `xstockstrat-ingest` owner — signal normalization correctness, newsletter source schema stability

**Codebase Evidence**:
- `QuerySignals` handler: `services/xstockstrat-ingest/app/handlers/servicer.py:898-994`.
- SELECT list omits `ingested_at` today: `:958-960`
  (`SELECT source, symbol, direction, conviction, valid_from, valid_until,` / `headline, raw_url, tags`
  / `FROM ingest.newsletter_signals`). The query already `ORDER BY ingested_at DESC` (`:962`), so the
  column is valid and selectable.
- `ExternalSignal(...)` construction omits it: `:976-983`; message appended at `:994`.
- Column exists and is `NOT NULL`: `services/xstockstrat-ingest/migrations/001_newsletter_signals.up.sql:10`
  (`ingested_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`) — already populated on every insert by the DB
  default; **no migration and no `IngestSignal` change needed** (`IngestSignal`'s INSERT does not list
  the column; the default fires).
- Reuse pattern (direct field `.FromDatetime`): `SignalSource.last_seen_at.FromDatetime(last_seen)`
  (`servicer.py:1039-1040`). `ingested_at` is `NOT NULL` so the null-guard `last_seen_at` uses is not
  needed.
- `from google.protobuf.timestamp_pb2 import Timestamp` already imported (`servicer.py:20`).

**TDD**: `red-green required`

**Instructions**:
1. Add `ingested_at` to the SELECT column list (`servicer.py:958-960`) — e.g. change the trailing
   `headline, raw_url, tags` line to include `ingested_at`:
   ```sql
   SELECT source, symbol, direction, conviction, valid_from, valid_until,
          headline, raw_url, tags, ingested_at
   FROM ingest.newsletter_signals
   ```
2. In the row loop (`servicer.py:976-994`), after `sig` is constructed and before
   `signals.append(sig)` (`:994`), set the timestamp with the direct-field pattern (mirroring
   `last_seen_at.FromDatetime`, `servicer.py:1039-1040`; no null guard — column is `NOT NULL`):
   ```python
   sig.ingested_at.FromDatetime(row["ingested_at"])
   ```
3. No new outbound gRPC call is added (read-only DB query change) — header-propagation constraint N/A.

**Verification**:
```bash
cd services/xstockstrat-ingest && ruff check . && ruff format --check .
```
Plus the paired test in Step 4. Behavioral: a `QuerySignals` response's every `ExternalSignal` has a
non-zero `ingested_at` (`sig.HasField("ingested_at")` true; `sig.ingested_at.seconds > 0`).

---

### Step 4 — test: ingest `QuerySignals` populates `ingested_at`

**Status**: `pending`
**Service**: `xstockstrat-ingest`
**Files**:
- `services/xstockstrat-ingest/tests/test_ingest_servicer.py` — modify

**Reviewers**: `xstockstrat-ingest` owner — idempotent ingestion, newsletter source schema stability

**Codebase Evidence**:
- Existing `QuerySignals` tests live in `services/xstockstrat-ingest/tests/test_ingest_servicer.py`
  (confirmed: `grep -rln "QuerySignals" services/xstockstrat-ingest/tests/` → this file only).
- Fake-DB / context fixtures: `services/xstockstrat-ingest/tests/conftest.py` (`_ctx` at `:15`).

**TDD**: `red-green required`

**Instructions**:
1. Extend the existing `QuerySignals` test path: the fake DB `fetch` result rows must include an
   `ingested_at` key (a tz-aware `datetime`), matching the new SELECT column. Assert the returned
   `ExternalSignal` carries it: `resp.signals[0].HasField("ingested_at")` is `True` and the value
   round-trips (`resp.signals[0].ingested_at.ToDatetime(tzinfo=UTC)` equals the seeded row's
   `ingested_at`). This satisfies **AC-6**.
2. Write it red-first: against the pre-Step-3 tree the assertion fails (field unset). C-13:
   the seeded signal row is an inline literal with a single consumer (this test) — inline is
   compliant; do not create a `conftest` fixture home for it.

**Verification**:
```bash
cd services/xstockstrat-ingest && ruff check . && ruff format --check . && pytest --cov=app --cov-fail-under=40
```
Confirm ≥40% coverage and the new assertion passes (and failed before Step 3).

---

### Step 5 — service: zero-trap-safe config read + `signal_axis` decay in `_compute_opportunities`

**Status**: `pending`
**Service**: `xstockstrat-analysis`
**Files**:
- `services/xstockstrat-analysis/app/config/watcher.py` — modify
- `services/xstockstrat-analysis/app/handlers/servicer.py` — modify

**Reviewers**: `xstockstrat-analysis` owner — strategy scoring determinism, no look-ahead bias

**Codebase Evidence**:
- `_compute_opportunities`: `services/xstockstrat-analysis/app/handlers/servicer.py:2083-2242`.
- Drain awaits: `signals = await self._drain_active_signals(propagation_meta)` (`:2098`),
  `held` (`:2099`), `bindings` (`:2100`). `signals_by_symbol` built at `:2106-2108`.
- **Signals-merge section (verified current trunk shape — 134/131 NOT landed):** `:2154-2168`, a
  two-level nested loop:
  ```python
  for sym, sigs in signals_by_symbol.items():        # :2154
      targets = [k for k in candidates if k[0] == sym]  # :2155
      if not targets:
          _candidate(sym, "")
          targets = [(sym, "")]
      for key in targets:                            # :2159
          c = candidates[key]
          for sig in sigs:                           # :2161
              _add_provenance(c, sig.source)
              c["signal_axis"] = max(c["signal_axis"], sig.conviction)   # :2163  ← WRITE SITE
              if sig.conviction > c["_best_sig_conv"]:                    # :2164
                  c["_best_sig_conv"] = sig.conviction
                  c["best_direction"] = sig.direction
                  if not c["thesis"]:
                      c["thesis"] = sig.headline
  ```
  `targets` can have >1 entry (a symbol bound to multiple watchlist strategies), so the write site runs
  once per (target × signal) — hence the design's per-signal hoist.
- Post-loop cut: `max_universe = self._cfg.get_int(...)` at `:2172`; `speculative.sort(key=... signal_axis ...)`
  at `:2175`.
- Config watcher: `services/xstockstrat-analysis/app/config/watcher.py` — `get_int_present` at
  `:103-114` (presence-aware, `v.HasField("int_val")`); `get_float` at `:124-130` does
  `return v.float_val or default` — **the zero-trap**: a stored `0.0` is falsy and collapses to the
  default. No `get_float_present` exists (grep-confirmed). This is the recon Critical finding and the
  design's required, explicit code change.
- `ConfigValue.float_val` is oneof member #3: `packages/proto/config/v1/config.proto:48-52`
  (`oneof value { ... double float_val = 3; ... }`) — `HasField("float_val")` is valid.
- Imports already present in `servicer.py`: `import math` (`:17`),
  `from datetime import UTC, datetime, timedelta` (`:19`), `log = logging.getLogger(__name__)` (`:61`).
  No new imports needed.
- Sibling config-read shape in this function area:
  `self._cfg.get_int("analysis.opportunity.max_universe_size", 100)` (`:2172`).

**TDD**: `red-green required`

**Instructions**:

**Part A — `watcher.py`: add `get_float_present` (design-mandated explicit change).**
Add a method mirroring `get_int_present` (`watcher.py:103-114`) exactly, on the `float_val` oneof member:
```python
def get_float_present(self, key: str, default: float) -> float:
    """Presence-aware float read (feature 022): returns the stored ``float_val`` whenever the
    field is set — **including a legitimate 0.0** — else the default. Mirrors ``get_int_present``;
    use this (never ``get_float``) for keys where 0 is a meaningful value, e.g.
    ``analysis.scoring.signal_decay_half_life_hours`` (0 disables decay, FR-3) which the
    ``get_float`` zero-trap would otherwise swallow into the default."""
    if self._snapshot is None:
        return default
    v = self._snapshot.values.get(key)
    if v is None:
        return default
    return v.float_val if v.HasField("float_val") else default
```
Do **not** modify the existing `get_float` (other callers depend on it).

**Part B — `servicer.py`: decay in `_compute_opportunities`.**
1. **Capture `now_utc` once, immediately after the `_drain_active_signals` await resolves** (after
   `:2098`, before the `:2099`/`:2100` drains). Also read the half-life and init the missing counters
   here (FR-5 — a single reference instant per pass; the placement avoids the round-1 negative-age race
   where a signal ingested concurrently with the `:2098` await could carry `ingested_at > now_utc`):
   ```python
   now_utc = datetime.now(UTC)
   half_life = self._cfg.get_float_present("analysis.scoring.signal_decay_half_life_hours", 24.0)
   missing_ingested_at_count = 0
   total_signal_count = len(signals)
   ```
   This is a **new** local variable, distinct from `session_end_seconds` (`:2184`, a later bars-derived
   running max used only for `valid_until` — do not reuse it).
2. **Rewrite the signals-merge section (`:2154-2168`)** to compute each signal's decayed contribution
   **once per signal**, hoisted above the `targets` loop into a `sig_contribs` list, then reuse it
   across every target (avoids re-decay/re-log/re-count when `len(targets) > 1`):
   ```python
   for sym, sigs in signals_by_symbol.items():
       targets = [k for k in candidates if k[0] == sym]
       if not targets:
           _candidate(sym, "")
           targets = [(sym, "")]

       # Decay computed ONCE per signal, above the targets loop.
       sig_contribs = []
       for sig in sigs:
           raw_conviction = sig.conviction
           if sig.HasField("ingested_at"):
               ingested_dt = sig.ingested_at.ToDatetime(tzinfo=UTC)
               raw_age_hours = (now_utc - ingested_dt).total_seconds() / 3600
               age_hours = max(0.0, raw_age_hours)      # defensive clamp (race / clock skew)
               age_clamped = raw_age_hours < 0.0
               age_known = True
           else:
               age_hours = None
               age_clamped = False
               age_known = False
               missing_ingested_at_count += 1
           # Age-derivation branches ONLY on HasField(ingested_at); decay-application branches
           # ONLY on half_life. Neither gates the other, so all log-referenced names are bound
           # in every combination (closes the UnboundLocalError on FR-3's disable path).
           decay_multiplier = (
               math.exp(-math.log(2) / half_life * age_hours)
               if (half_life > 0 and age_known)
               else 1.0
           )
           effective_conviction = raw_conviction * decay_multiplier
           if not math.isfinite(effective_conviction):
               effective_conviction = 0.0   # explicit guard (future-refactor insurance)
           log.debug(
               "signal_axis decay: symbol=%s source=%s raw_conviction=%s age_hours=%s "
               "age_known=%s age_clamped=%s decay_multiplier=%s effective_conviction=%s",
               sym, sig.source, raw_conviction, age_hours, age_known, age_clamped,
               decay_multiplier, effective_conviction,
           )
           sig_contribs.append((sig, effective_conviction))

       for key in targets:
           c = candidates[key]
           for sig, effective_conviction in sig_contribs:
               _add_provenance(c, sig.source)
               c["signal_axis"] = max(c["signal_axis"], effective_conviction)   # decayed
               if sig.conviction > c["_best_sig_conv"]:   # thesis/direction stay on RAW conviction
                   c["_best_sig_conv"] = sig.conviction
                   c["best_direction"] = sig.direction
                   if not c["thesis"]:
                       c["thesis"] = sig.headline
   ```
   - **`effective_conviction = raw_conviction * decay_multiplier`** — no `source_weight` factor, because
     `weight_for`/source-weight is NOT in the landed `_compute_opportunities` (F-04; verified this spec).
     See the merge-order rebase constraint in `## Step Dependencies`: if 134 has landed by execute time,
     `/sdd-execute` adds the `× source_weight` factor (and `source_weight` to the DEBUG log) against the
     **real** landed symbol, never an invented one.
   - Thesis/`best_direction`/`_best_sig_conv` stay keyed on **raw** `sig.conviction` (FR-1 scopes decay
     to `signal_axis` only — an accepted, documented asymmetry, `design.md` § Scope Decisions).
3. **After the section-3 double loop completes, before the `max_universe` read (`:2172`)**, emit one
   aggregated WARNING (never one-per-signal — `_compute_opportunities` runs per-user, so per-signal
   warnings would scale as active-signals × active-users during an ingest/analysis deploy-ordering race):
   ```python
   if missing_ingested_at_count > 0:
       log.warning(
           "%d of %d signals missing ingested_at this compute pass; treated as fresh "
           "(decay_multiplier=1.0)",
           missing_ingested_at_count, total_signal_count,
       )
   ```
4. No new outbound gRPC call is added (decay reads `sig.ingested_at` from signals already fetched by the
   existing `_drain_active_signals` → `QuerySignals` drain) — header-propagation constraint N/A.
5. F-07: no hardcoded config value — the half-life is read via `get_float_present` from the WatchConfig
   snapshot.

**Verification**:
```bash
cd services/xstockstrat-analysis && ruff check . && ruff format --check .
```
Plus the paired test in Step 6.

---

### Step 6 — test: `get_float_present` presence + `_compute_opportunities` decay

**Status**: `pending`
**Service**: `xstockstrat-analysis`
**Files**:
- `services/xstockstrat-analysis/tests/test_config_watcher.py` — modify
- `services/xstockstrat-analysis/tests/test_analysis_servicer.py` — modify

**Reviewers**: `xstockstrat-analysis` owner — strategy scoring determinism, no look-ahead bias

**Codebase Evidence**:
- Watcher tests: `services/xstockstrat-analysis/tests/test_config_watcher.py` (currently only
  `resolve_environment`/`resolve_trading_mode` cases; `get_float_present` is net-new coverage).
- `_compute_opportunities` / `signal_axis` tests + the in-memory `_FakeOppRepo` end-to-end harness:
  `services/xstockstrat-analysis/tests/test_analysis_servicer.py:3517` (harness),
  `:3769-3792` (existing `signal_axis` assertions, e.g. `signal_axis == 0.9`).
- Existing `ExternalSignal` fixture builder: `_sig(symbol, direction, conviction, source="src")` at
  `test_analysis_servicer.py:3504-3512` — extend with an optional `ingested_at` parameter.

**TDD**: `red-green required`

**Instructions**:
1. **`test_config_watcher.py` — `get_float_present`:** with a snapshot holding a `ConfigValue` whose
   `float_val` is explicitly `0.0`, assert `get_float_present(key, 24.0) == 0.0` (the zero-trap-safe
   read — this is the FR-3 rollback contract, and would return `24.0` under the old `get_float`). Also
   assert: an unset key returns the default; a set positive value returns that value.
2. **`test_analysis_servicer.py` — decay in `_compute_opportunities`** (extend `_sig` to set
   `ingested_at`, drive the real compute via the `_FakeOppRepo` harness, mock the config snapshot so
   `get_float_present("analysis.scoring.signal_decay_half_life_hours", …)` returns the test half-life).
   Cover, red-first:
   - **AC (t=0):** a signal ingested at `now_utc` with half-life 24 → `signal_axis == raw_conviction`
     (multiplier 1.0).
   - **AC-5 (t=half_life):** ingested 24h ago, half-life 24 → `signal_axis ≈ 0.5 × raw_conviction`.
   - **AC-5 (t=3×half_life):** ingested 72h ago, half-life 24 → `signal_axis ≈ 0.125 × raw_conviction`.
   - **AC-1 (t=2×half_life):** ingested 48h ago, half-life 24 → `signal_axis ≈ 0.25 × raw_conviction`
     (a quarter of an otherwise-identical fresh signal).
   - **AC-2 / FR-3 (disabled):** half-life `0` (and separately a negative value) → `decay_multiplier`
     1.0 for every signal → `signal_axis == raw_conviction` regardless of age (matches pre-feature
     behavior).
   - **AC-5 (missing `ingested_at`):** a signal with `ingested_at` unset → `age_known=False`,
     `decay_multiplier=1.0` regardless of the configured half-life (the deploy-ordering-race regression
     surface — must NOT underflow to 0.0).
   - **AC-7 (aggregated WARNING):** in a compute pass with N signals missing `ingested_at`, assert
     **exactly one** `log.warning` call is made (patch/capture the logger and assert the call **count**
     is 1, not ≥1), reporting the count — never one-per-signal.
3. C-13: the seeded signals are inline literals consumed only by these analysis tests — inline is
   compliant; do not create a `conftest` fixture home. (`_sig` is the existing single-file inline
   builder; extend it in place.)

**Verification**:
```bash
cd services/xstockstrat-analysis && ruff check . && ruff format --check . && pytest --cov=app --cov-fail-under=40
```
Confirm ≥40% coverage and every case above passes (each failed before Step 5).

---

### Step 7 — config: declare `analysis.scoring.signal_decay_half_life_hours` default

**Status**: `pending`
**Service**: `xstockstrat-analysis`
**Files**:
- `services/xstockstrat-analysis/CLAUDE.md` — modify

**Reviewers**: `xstockstrat-analysis` owner — config key naming (`<service>.<category>.<key>`),
default declaration (the config-adding service owns the key per the reviewer matrix)

**Codebase Evidence**:
- Config governance: defaults are declared in each service's `CLAUDE.md` (root `CLAUDE.md` § Config
  Governance Rules). Analysis's table is `services/xstockstrat-analysis/CLAUDE.md` § Config Keys
  Consumed (namespace `analysis`), with existing `analysis.scoring.*` rows (`shrinkage_days`,
  `min_evidence_symbols`, `min_evidence_days`) and `analysis.opportunity.*` rows.
- Key naming `<service>.<category>.<key>` = `analysis.scoring.signal_decay_half_life_hours` — conforms.
- No config-service seed migration (see `## Execution Summary` — runtime-registered, matching the
  sibling `analysis.scoring.*` keys per `services/xstockstrat-config/docs/context-constitution-findings.md:13`).

**TDD**: `N/A (config/docs — key-default declaration, no code path)`

**Instructions**:
1. In `services/xstockstrat-analysis/CLAUDE.md` § Config Keys Consumed table, add a row (next to the
   other `analysis.scoring.*` rows):
   > `| analysis.scoring.signal_decay_half_life_hours | float | 24.0 | Exponential half-life (hours) for age decay of a signal's contribution to the Opportunities queue's signal_axis (feature 022); effective = conviction × exp(−ln2/half_life × age_hours), age from ExternalSignal.ingested_at. Set to 0 (or negative) to disable decay for rollback (FR-3). Read via get_float_present (never get_float — a configured 0 is legitimate and the get_float zero-trap would swallow it). |`
2. Keep the wording consistent with the existing zero-trap notes on `refresh_hour_utc` /
   `default_exit_cooldown_days`.

**Verification**:
```bash
grep -n "signal_decay_half_life_hours" services/xstockstrat-analysis/CLAUDE.md
```
Row present, type `float`, default `24.0`, names `get_float_present` and the 0-disables-decay contract.

---

## Deviation Log

_Populated by /sdd-execute as implementation proceeds._
