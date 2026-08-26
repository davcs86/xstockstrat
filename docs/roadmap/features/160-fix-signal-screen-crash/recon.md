# Recon: fix-signal-screen-crash

**Created**: 2026-08-26
**From**: product-spec.md (Track C bug)
**Affected services**: xstockstrat-analysis

---

## Objective

Signal-weighted `ScreenSymbols` crashes with `AttributeError: timestamp` because
`app/services/scoring.py` reads `bar.timestamp` while the marketdata `Bar` proto exposes the candle
time as `bar.time`. The crash is source-agnostic — it breaks every signal-weighted screen
(`signal_sources` set + `signal_weight > 0`), not just the fundamentals producer. Fix the field name
and add a regression test that reproduces on the current code.

## Codebase Map

- **`xstockstrat-analysis`** (Python 3.12)
  - **Crash site**: `app/services/scoring.py:17` — `compute_signal_score(signals_map, bar, signal_sources, source_weights)`; `bar_ts = bar.timestamp.ToDatetime()`. `bar_ts` is used only for the validity-window gate at `:27`/`:29` (`bar_ts < valid_from` / `bar_ts > valid_until`). Every other read in the function is on `sig` and correct (`sig.valid_from`/`valid_until` `:25`, `sig.conviction`/`sig.direction` `:31-34`).
  - **Caller**: `app/services/screener.py:263-269` — `latest_bar = bars_resp.bars[-1] if closes else None` (`:265`, from `GetBars` at `:229`) → `scoring.compute_signal_score(signals_map, latest_bar, …)` (`:267`). Blend gate: `_fetch_signals` `screener.py:329` `if not request.signal_sources or request.signal_weight <= 0:` (returns empty map → blend skipped, which is why technical-only screens work); mirrored `signals_present` flag at `:520`.
  - **Marketdata `Bar` proto**: `packages/proto/marketdata/v1/marketdata.proto:44-58` — `google.protobuf.Timestamp time = 2;`. Full set: `symbol(1), time(2), open(3), high(4), low(5), close(6), volume(7), vwap(8), trade_count(9), timeframe(10 deprecated), source(11), timeframe_enum(12)`. **No `timestamp` field.**
  - **Signal proto**: `packages/proto/ingest/v1/ingest.proto:105-117` `ExternalSignal` (QuerySignals) — `source, symbol, direction, conviction, valid_from, valid_until, headline, raw_url, tags, ingested_at`. All blend accesses match — no signal-side mismatch.
  - **Test homes**: `tests/test_analysis_helpers.py` — `TestComputeSignalScore` / `TestComputeSignalScoreWithWeights` (uses `_make_bar` at `:163-167`, a **`MagicMock`** whose `.timestamp.ToDatetime` is stubbed → auto-vivifies `.timestamp`, which is exactly why the bug was invisible). `tests/test_screener.py` — `bars()` fixture builds **real** `marketdata_pb2.Bar(close=c)` at `:30-31` (no `time` set, no signal-blend coverage). No `test_scoring.py`; no `Bar`/`ExternalSignal` builder in `tests/conftest.py`.

## Patterns to REUSE

- **Correct bar-time accessor** → `bar.time` — already used correctly elsewhere in the same service (`servicer.py:3920` `diag.timestamp.CopyFrom(bar.time)`; `evaluator.py:43` comment "`bar.time` (NOT `bar.timestamp`)"). The fix aligns `scoring.py` with the existing convention, not a new pattern.
- **Real-proto construction for the regression test** → mirror `tests/test_screener.py:30-31` (`marketdata_pb2.Bar(...)`) and set the `time` field (`bar.time.FromDatetime(...)` / `GetCurrentTime()`), plus a real `ExternalSignal`. A `MagicMock` bar must NOT be used for the RED test — it hides the defect (the root reason it shipped).
- **Fix the blind spot, not just the line** → consider replacing/augmenting `_make_bar`'s `MagicMock` with a real `Bar` in the `compute_signal_score` tests so `.timestamp`-style field-name bugs fail closed (ledger insight 2026: proto-mirror/field accessors want a real-proto test, cf. C-10 descriptor-parity).

## Existing Business Rules (preserve / extend)

_Constitution **C-16**._

- **No existing screening guarantee exists in the `xstockstrat-analysis` acceptance suite.** The only promoted suite (`services/xstockstrat-analysis/acceptance/fix-fundamentals-signal-producer.feature`, `@AC-1..7`, `@feature-156`) covers the fundamentals **scheduler** only — no `@AC-*` asserts on `ScreenSymbols`, signal-weighted/blend screening, scoring, or coverage-gap reporting. So the `bar.timestamp`→`bar.time` fix has **no existing `@AC-*` to regress** (no PRESERVE/EXTEND/CHANGE). The new regression scenario is net-new coverage and a promotion candidate at launch, so the crash cannot silently return.
- `platform.feature` `@AC-8` (`MCP_AGENT_SECRET` absence) — scanned, not relevant.

## Dependencies

- Proto/RPC: none (read-only field-name fix; no `.proto` change).
- Migration: none.
- Config keys: none.
- Inter-service edges: none new (the screener already calls `GetBars`/`QuerySignals`).
- New env vars / ports: none.

## Risks / Not-found

- **The mock hid the bug** (`## Not found`: no real-`Bar` fixture in conftest). The RED test must build a real `marketdata_pb2.Bar` with `time` set; a `MagicMock` bar reproduces nothing (P-06 red-before-green would be vacuous). This is the one real design decision.
- No other latent `bar.timestamp` reader on a marketdata `Bar` in the service (verified — other `.timestamp` reads are on `intent`/backtest-`SymbolDiagnostics` protos that legitimately have a `timestamp` field).
- Consumer surface (C-14): the crash reaches users via the agent `screen_symbols` MCP tool and the `/insights` screener — but the fix **restores** those existing surfaces; it adds no new surface and needs no UI/agent change.

## Recommended Scope

Advisory step boundaries (input to grilling + `/sdd-spec`):

1. **test (RED)** — add a regression test for `compute_signal_score` (and/or a screener signal-blend test) using a **real** `marketdata_pb2.Bar(time=…)` + real `ExternalSignal`, asserting the validity-window logic runs and returns a 0.0–1.0 score / an OK screen result. Fails on current code with `AttributeError: timestamp` (traces `@AC-1`/`@AC-2`).
2. **service (GREEN)** — `scoring.py:17` `bar.timestamp` → `bar.time`.
3. Optional within scope: harden `_make_bar` (`test_analysis_helpers.py:163`) toward a real `Bar` so the field-name class of bug can't hide again — design decides whether to fold in or leave as a note.
