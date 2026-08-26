# Context Log: fix-signal-screen-crash

Append-only. Each session appends a new ## Session entry. Never delete or edit prior entries.

---

## Session 2026-08-26 (/sdd-triage)

- Bug recorded via defect report `docs/reports/2026-08-26-signal-screen-bar-timestamp-crash-defect.md`
  (GitHub Issues disabled on this repo → `--from-report` path).
- Discovered during the feature-154 fundamentals-producer first-cycle check-in on staging: the
  producer ran and registered its `fundamentals` (`derived`) source, but consuming the signals via
  `screen_symbols(signal_sources=["fundamentals"], signal_weight>0)` crashed server-side with
  `AttributeError: timestamp`. Verified reproducible (4×) and bracketed against a healthy technical-only
  baseline.
- Severity: SEV-2. Environment: dev (main-dev). Config-only: no. Impact type: signal-screen-crash.
- Routed to SDD path (Track C).
- Created: feature.md, product-spec.md, acceptance.feature (regression scenarios), context.md.
- Affected services: xstockstrat-analysis (single).
- Root cause (high confidence): `app/services/scoring.py:17` reads `bar.timestamp.ToDatetime()`, but
  the marketdata `Bar` proto field is `time` (`packages/proto/marketdata/v1/marketdata.proto` →
  `Timestamp time = 2`). Reached from `app/services/screener.py` only when `signal_sources` set and
  `signal_weight > 0` (gate at `screener.py:329`), which is why technical-only screens work. Fix:
  `bar.timestamp` → `bar.time` + regression test; grep for other `bar.timestamp` readers.
- Confirmed the buggy line still present on `main-dev` at triage time (`scoring.py:17`).
- Recommended design depth: **quick** → `/sdd-design fix-signal-screen-crash quick` (rationale: SEV-2
  per C-0; single service, no proto/migration/config and a crystal-clear one-line root cause, so `skip`
  straight to `/sdd-spec` is a defensible alternative if the operator prefers).
- Development branch: feature/fix-signal-screen-crash.
- NNN note: assigned **159** as max(existing NNN)+1 (158 was the highest on disk), per the root
  CLAUDE.md Feature Numbering rule — not the count-based snippet in the triage skill (which under-counts
  when gaps exist).

## Session 2026-08-26 — sdd-design (2 rounds, full)

- Phase 0 Recon (recon.md): codebase-discovery + scenario-recon. Sole fix is `scoring.py:17`
  `bar.timestamp` → `bar.time`; all `sig.*` reads correct; no other latent bar.timestamp reader. The
  `_make_bar` MagicMock (`test_analysis_helpers.py:163-167`) auto-vivifies `.timestamp` → why the bug
  shipped. No existing @AC screening guarantee to regress.
- Phase 1 Grilling (design.md): 2 full rounds, proposer vs adversary. **Chosen:** one-line fix + a
  window-discriminating unit RED anchor (@AC-2, in-window score 0.9 vs out-of-window 0.5, flips with
  bar.time) + a real ScreenerEngine.screen() seam RED test (@AC-1, the exact staging repro) + reshaping
  `_make_bar` MagicMock → real `marketdata_pb2.Bar` (ledger-mandated, fails.md:725-727).
- **Ledger hit:** this bug is a direct recurrence of `fails.md:725-727` (assert on real proto instances,
  not MagicMock) — feature 064 applied that rule to servicer.py's six sites but missed the extracted
  `scoring.py`/`_make_bar`. The reshape closes that blind spot → not scope creep.
- **Round-2 adversary constraints folded into design.md:** (1) [P-06] @AC-1 needs **≥2 time-set bars**
  + a positive "blend actually ran" assertion — else `_eval_symbol` short-circuits to INSUFFICIENT_DATA
  (`screener.py:243-251`) before the blend and the RED guards nothing; (2) [C-15] name the collateral-RED
  tests the reshape reddens (`test_buy_signal_raises_score_above_half`/`…lowers…`/`test_expired_signal_is_ignored`/
  WithWeights) and assert they GREEN post-fix. Cleared: @AC-2's hard-coded 0.9 is the correct transform
  (keep it); reshape breaks nothing post-fix (scoring reads only bar.time).
- Constitution: no Floor breach; C-08/P-06/C-13/C-14/C-15 honored; C-16 none (net-new coverage).
- Status: draft → design-approved. Next: `/sdd-spec fix-signal-screen-crash`.

## Session 2026-08-26 — sdd-spec

- Generated implementation-spec.md with **3 steps**. Status: design-approved → implementation-ready.
- Steps: (1) test — reshape `_make_bar` (MagicMock → real `marketdata_pb2.Bar`) + add the
  `compute_signal_score` field anchor (`@AC-2`, in-window 0.9 vs out-of-window 0.5) in
  `tests/test_analysis_helpers.py`; (2) test — `ScreenerEngine.screen()` signal-weighted seam returns
  OK, the staging repro (`@AC-1`) in `tests/test_screener.py`; (3) service — `scoring.py:17`
  `bar.timestamp` → `bar.time`. Reviewers (all steps): xstockstrat-analysis owner.
- Scenario coverage (C-15): `@AC-1`→Step 2, `@AC-2`→Step 1. Both `@AC-*` covered.
- Consumer surface (C-14): internal/platform-only — the fix restores the existing agent
  `screen_symbols` tool + `/insights` screener; no new surface, so no agent/UI step (stated as a
  decision in the spec's Execution Summary, not an omission).
- Key codebase findings (grounded evidence for the spec):
  - Crash site confirmed present: `app/services/scoring.py:17` `bar_ts = bar.timestamp.ToDatetime()`;
    marketdata `Bar` has `Timestamp time = 2`, no `timestamp` field (`marketdata.proto:44-46`).
  - `_compute_signal_score` (imported by the test at `test_analysis_helpers.py:14`) **is**
    `scoring.compute_signal_score` — re-exported at `app/handlers/servicer.py:63`. The existing suite
    already exercises the crash site.
  - `screen()` awaits `_eval_symbol` at `screener.py:119-129` with **no** per-symbol try/except, so
    the `AttributeError` from `compute_signal_score` (`screener.py:267`) propagates unwrapped → the
    gRPC UNKNOWN. Blend gate at `screener.py:329` (`signal_sources` + `signal_weight > 0`).
  - P-06 trap re-confirmed: a formula (`needs_technical`) criterion short-circuits to
    INSUFFICIENT_DATA at `screener.py:243-251` when `len(closes) < 2` — test #2 needs ≥2 time-set bars.

## Decisions

- **Spec follows the approved design 1:1**: 3 steps (2 test RED, 1 service GREEN), no scope added.
- **C-13**: real-proto builders stay inline in each test file (single consumer each; different shapes)
  — no `tests/conftest.py` centralization (matches design § Rejected Alternatives).
- **`_make_signal` stays a MagicMock**; only `_make_bar` is reshaped to a real `Bar` (only `bar.time`
  is read on the bar by `compute_signal_score`).

## Open Threads

- [x] Confirm `ingest_pb2.QuerySignalsResponse.signals` field name — **RESOLVED at /sdd-spec**:
  `repeated ExternalSignal signals = 1` (`ingest.proto:136-139`); message `QuerySignalsResponse`;
  import `from gen.ingest.v1 import ingest_pb2`. `ExternalSignal` fields
  `source/symbol/direction/conviction/valid_from/valid_until` verified (`ingest.proto:105-117`).
- [ ] Keep the manual dev smoke (live signal-weighted `screen_symbols` returns OK on dev) a REQUIRED
  checked acceptance step — folded into Step 3's Verification + Step Dependencies. Target: execution /
  before close.

## Session 2026-08-26 — sdd-review impl-spec (advisory)

- Result: 0 failures, 2 warnings (advisory — did not block). PASS WITH WARNINGS. No Floor breach.
- Overlap scan: CLEAN — no migration/proto/config surface; the three touched files are shared only with
  launched features (042/125/140); no in-flight same-file overlap. No merge-order row needed.
- Warnings:
  - Step 1/Step 2 (`test` steps) state no `--cov-fail-under` in their own Verification — `[x]` ADDRESSED:
    added an explicit "Coverage (C-08): deliberately not measured on this RED-only step; gate satisfied
    at Step 3's GREEN full-suite `--cov-fail-under=40`" note to both test steps' Verification, so the
    split is documented in the spec rather than implicit. (A RED-only step can't measure coverage.)
  - Step 1 collateral-RED list was non-exhaustive — `[x]` FIXED in the spec: added
    `test_future_signal_is_ignored` (`:221`) and `test_zero_conviction_uses_default_half` (`:229`) to the
    named collateral-RED tests, and noted the two neutral short-circuit tests that stay GREEN.
- Unresolved ✗ / ⚠ carried into execution: **none**.

## Session 2026-08-26 — sdd-execute (sequential)

### Step 1 — reshape _make_bar to a real Bar + @AC-2 anchor [done]
- Reshaped `_make_bar` (MagicMock → real `marketdata_pb2.Bar` with `bar.time` set) and added the
  `@AC-2` window-discriminating anchor (`test_reads_bar_time_field_in_window` → 0.9 in-window;
  `test_out_of_window_bar_time_excludes_signal` → 0.5) in `tests/test_analysis_helpers.py`.
- **TDD RED (captured, pre-Step-3):** `pytest -k TestComputeSignalScore` → **15 failed, 2 passed** —
  all failures `AttributeError: timestamp` at `scoring.py:17` (the right reason). The 2 passing are the
  neutral short-circuit tests (`test_empty_signals_map_returns_neutral`/`test_no_sources_returns_neutral`)
  as the spec predicted. GREEN lands at Step 3 (the fix).
- Lint: `ruff check`/`ruff format --check` pass (ruff --fix reorganized the two new proto imports —
  in-scope, own changed lines).
- Files modified: `services/xstockstrat-analysis/tests/test_analysis_helpers.py`
- Deviations: none.

### Step 2 — ScreenerEngine.screen() signal-weighted seam RED (@AC-1) [done]
- Added `from gen.ingest.v1 import ingest_pb2` + `from datetime import datetime` and
  `test_signal_weighted_screen_returns_ok_not_crash` (with a local `_timed_bar` helper) to
  `tests/test_screener.py`. Two time-set bars (clears the `INSUFFICIENT_DATA` short-circuit),
  `md.GetBars`/`ind.ExecuteFormula`/`ind.ComputeIndicator`/`ingest.QuerySignals` wired via AsyncMock;
  request `symbols=["AARD","BABA","WLTH"], signal_sources=["fundamentals"], signal_weight=1,
  technical_weight=0`, in-window buy@0.8 straddling the last bar's time.
- **TDD RED (captured, pre-Step-3):** `pytest tests/test_screener.py -k signal_weighted_screen_returns_ok`
  → **1 failed** with `AttributeError: timestamp. Did you mean: 'timeframe'?` at `scoring.py:17`,
  propagating unwrapped out of `screen()` — the exact staging repro. GREEN lands at Step 3.
- **Positive "blend actually ran" assertion (design round-2):** with `signal_weight=1`/
  `technical_weight=0`, `combine_score` returns `signal_score` verbatim and `signal_sub` is **not**
  universe-normalized, so the in-window buy@0.8 blends to a final `score == 0.9` (off the 0.5 neutral
  default). Asserted on all 3 results — a future earlier-return that never reaches `scoring.py` would
  leave 0.5 and fail this, so the test can't pass without exercising the fixed line.
- Lint: `ruff check`/`ruff format --check` pass (one own-line reflow applied by `ruff format`).
- Files modified: `services/xstockstrat-analysis/tests/test_screener.py`
- Deviations: none.
