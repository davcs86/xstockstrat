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

## Open Threads

- [ ] Keep the manual dev smoke (live signal-weighted `screen_symbols` returns OK on dev) a REQUIRED
  checked acceptance step — mocked tests can't prove the live edge. Target: execution / before close.
- [ ] Confirm `ingest_pb2.QuerySignalsResponse.signals` field name at /sdd-spec (inferred from
  `screener.py:337`). Target: test #2 step.
