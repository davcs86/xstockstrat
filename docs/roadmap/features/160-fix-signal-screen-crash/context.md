# Context: fix-signal-screen-crash  (archived 2026-08-26)

**Feature**: ./feature.md
**Status**: launched — archived by /sdd-archiver; verbose specs pruned (recoverable via git history).

## Archive Synthesis — 2026-08-26 — /sdd-archiver

**What**: A signal-weighted `ScreenSymbols` (any `signal_sources` set + `signal_weight > 0`) crashed
server-side with `AttributeError: timestamp`, because the signal-blend scorer at `scoring.py:17` read
`bar.timestamp` on a marketdata `Bar` whose only time field is `time`. This was the SECOND occurrence
of a bug feature 064 already fixed and ledgered — 064 corrected `servicer.py`'s six sites, but the
scorer had since been EXTRACTED to `app/services/scoring.py` (feature 060) carrying its own MagicMock
bar builder, so the fix never reached the moved code. Shipped exactly as designed: a one-line source
rename + two RED regression tests + reshaping the `_make_bar` MagicMock into a real `Bar`; all 3
execute steps "Deviations: none."

**Why (irrecoverable rationale)**: The reshape of `_make_bar` (MagicMock → real `marketdata_pb2.Bar`)
was deliberately in-scope, not scope creep — it is the direct closure of the ledger blind spot
(fails.md:725-727) that let this typo class survive a code move. Chosen over a minimal single-test fix
precisely because a minimal diff re-arms the exact trap the ledger already adjudicated.

**Rejected alternatives** (all were in the now-deleted design.md):
- A single new real-`Bar` test, leave `_make_bar` a MagicMock — lost: re-arms the blind spot; the next
  `bar.<typo>` re-hides.
- `@AC-2` as a bare `score ∈ [0,1]` or a `fields_by_name("timestamp")` descriptor check — lost:
  vacuous / a schema tautology, passes on buggy and fixed code alike.
- Relax `@AC-2` to an inequality instead of the hard-coded 0.9 — lost: the exact value also catches a
  silent change to the `(net+1)/2` mapping.
- Degrade `@AC-1` to the `compute_signal_score` unit seam — lost: leaves the real `ScreenerEngine.screen()`
  staging repro unverified.
- Centralize a `Bar` builder into `tests/conftest.py` (C-13) — lost: the two consumers need different
  shapes; speculative abstraction over two one-line constructors.
- A PRODUCTION guard for unset `bar.time` — rejected: marketdata ALWAYS populates `time` (the candle
  key), so a guard is speculative scope creep; the epoch concern is a test-fixture concern only.
  (Absence of code can't be grepped — this consciously-declined guard would otherwise be re-litigated
  from scratch by a future toucher.)

**Scars & gotchas**:
- A signal-weighted screener RED test silently guards nothing unless it supplies ≥2 time-set bars. A
  formula criterion sets `needs_technical=True`, so `_eval_symbol` short-circuits to INSUFFICIENT_DATA
  and returns at `screener.py:243-251` when `len(closes)<2` — BEFORE the blend that hits `scoring.py`.
  The bare `bars()` helper builds `Bar(close=c)` with no time, which either epoch-excludes the signal
  or short-circuits. A positive "blend actually ran" assertion (an in-window signal moves the final
  score off the 0.5 neutral default) is required so a future earlier-return can't make the test pass
  without reaching the fixed line. (Recorded at insights.md 2026-08-26.)
- `screen()` has NO per-symbol try/except (`screener.py:119-129`), so a per-symbol `AttributeError`
  from `compute_signal_score` propagates unwrapped and fails the whole RPC as gRPC UNKNOWN — that is
  why one bad field access took down the entire screen rather than one symbol.
- The correct convention was already documented and still missed: `evaluator.py:43` carries a docstring
  explicitly warning "bar.time (NOT bar.timestamp)" — the extracted scorer never inherited the warning.
  An in-code warning does not protect a copy made into a new module.

**Permanent deviations**: none — spec followed the approved design 1:1; every step "Deviations: none."

**Cross-feature signal**: Latent since feature 060's extraction, this crash surfaced only when feature
154's fundamentals producer became the first live consumer to exercise the signal-weighted path on
staging. Code paths with no active producer can carry a latent crash indefinitely; a new upstream
producer is the moment its downstream consumers get their first real exercise. Mocked unit tests never
reached this live edge — only the post-deploy `screen_symbols` smoke did.

**Deferred follow-ons**: none outstanding. The one open item (a required live post-deploy
`screen_symbols` smoke) was closed in-feature: all three symbols returned SCREEN_RESULT_STATUS_OK after
PR #1023 rode to dev/staging.

**Ledger entries written**: insights.md (1, design — the clear-the-guard-then-assert-discriminating
regression-test rule), fails.md (0). The `bar.timestamp`-does-not-exist / MagicMock-hides-it fail was
already recorded at fails.md:1670-1685 (DUP — twice-recurred 064→160, a strong candidate to promote to
a binding Constitution rule near C-13, but the existing entry is complete; not re-added).
**Runtime-invariant recommendations (→ /context-constitution)**: candidate ANALYSIS-* (low confidence,
recoverable) — `ScreenerEngine.screen()` has NO per-symbol error isolation (`screener.py:119-129`); any
exception in one symbol's `_eval_symbol` propagates unwrapped and fails the entire RPC as gRPC UNKNOWN,
rather than degrading that one symbol.
**Scenario promotion (C-16)**: both `@AC-*` were already promoted at launch to
`services/xstockstrat-analysis/acceptance/fix-signal-screen-crash.feature` — nothing new to write
(idempotent).
**Pruned artifacts**: product-spec.md, recon.md, design.md, implementation-spec.md — last present at 996210e4.
