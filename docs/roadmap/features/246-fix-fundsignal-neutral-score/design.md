# Design: fix-fundsignal-neutral-score

**Created**: 2026-10-21
**Rounds**: 8 (full; termination: approved by the operator 2026-10-21)
**Approved by**: operator @ 2026-10-21 (round-8 design; 5-round cap lifted to 8 by operator override, `context.md:244-245`)
**Grounded in**: recon.md

Source report: `docs/reports/2026-10-19-analysis-fundsignal-neutral-score-fabricated-defect.md`.
Debate record: rounds 1-5 at `c937f066` (`context.md:143-254`); rounds 6-8 at `38ce1789`
(`context.md:256-394`). The gate writes below (B.1 spec amendments, B.2/B.3 reports) land in the same
commit as this file, on top of `38ce1789`.

---

## Chosen Approach

**Production code: one file, `services/xstockstrat-analysis/app/engine/fundsignal_loop.py`.**

- `_builtin_score` (`:416-432`, recon.md:34-37): compute `missing = set(f.missing_metrics)` once; each
  truthiness guard (`:420,423,425,428,430`) becomes `if "<metric>" not in missing:`; value branches are
  unchanged except pb (`:424`), which becomes `0.0 if pb <= 0` to match pe (`:421`); an empty `parts`
  returns `None` (today `0.5`, `:432`). The `_BUILTIN_BANDS` comment at `:47` changes from
  `<0 handled specially` to `<=0 handled specially`. Absence is read by membership, the screener's
  pattern (recon.md:85-89; `screener.py:402-403`, `servicer.py:6481-6482`).
- `_score` (`:409-414`, recon.md:47) returns `(scores, unscored)`; its one caller is `:226`. In the
  built-in branch a `None` score adds the symbol to `unscored` and leaves it out of `scores`.
- `_score_via_formula` (`:447-467`, recon.md:39-40): after the 6-key dict (`:452-459`),
  `if set(f.missing_metrics).issuperset(fundamentals): unscored.append(sym); continue` (FR-3). Partial
  rows still send wire 0.0 (`@AC-8 @feature-201`). Formula-exception skips (`:465-466`) keep their own
  WARN and are not counted as unscored.
- Skip by omission (recon.md:95-100): a symbol absent from `scores` skips `_map_directions` (`:230`) and
  the emit loop (`:237-238`), so it gets no quantile slot, no `analysis.fundsignal_emitted` row and no
  `IngestSignal`.
- `_warn_unscored(run_id, unscored, total)` with `total = len(fetched)` (the `symbols_done` that both
  `_finish` `:289` and `_abort_cycle` `:274` record): one
  `log.warning("fundsignal run %s: %d of %d symbols unscored (no fundamentals): %s", run_id, len(unscored), total, ",".join(sorted(unscored)))`
  in the `_apply_symbol_cap` shape (`:350-355`, recon.md:101-103); no-op when `unscored` is empty. It is
  called right after `:226` and before the `try`/`_ensure_source_registered` (`:235-236`), so it fires
  on both the normal `_finish` (`:286`) and the `_SystemWriteRejected` abort (`:270-278`); `run_id`
  comes from `:170`. It never raises, so a data-less universe still registers and completes
  (recon.md:140-143).
- Unchanged: `_finish`, `_abort_cycle`, the `run_completed` payload, `FundamentalsScanSummary`.
  `symbols_processed` keeps meaning "fetched" (`:289`; recon.md:56-57); skipped symbols are counted in
  it and visible only in the WARN.

**Tests (RED first, C-13).**

- `fundamentals_row(symbol, missing=(), **metrics)` in `services/xstockstrat-analysis/tests/conftest.py`,
  returning a real `marketdata_pb2.Fundamentals` (recon.md:104-110, 213-222). Consumers: `_fund`
  (`test_fundsignal_loop.py:31`), `test_owner_header_guard.py:197,221`, and `_snapshot_resp`
  (`test_fundamentals_formula_servicer.py:93-95`) as a pass-through.
- `BUILTIN_SCORER_METRICS = (*fundsignal_loop._BUILTIN_BANDS, "eps")` module-local in
  `test_fundsignal_loop.py` (single consumer file; C-13 lazy materialisation,
  `docs/patterns/test-data-inventory.md:70-76`; derived per recon.md:90-94).
- AC-1: MSFT scores ~0.8667; keys reaching `_map_directions` == {MSFT}; no direction asserted (B.1 drops
  the `with direction "buy"` Then); `caplog` asserts exactly one unscored WARN with the cycle `run_id` and
  `DIA,IWM,QQQ,SPY,VOO`.
- AC-2: ZRO scores 0.30 (`_lin(20,10,35)=0.6`, `_lin(0,0.25,0.05)=0.0`). Buggy code yields 0.6.
- AC-3, one formula-path cycle, synthetic NODATA (all six formula keys missing) and DIVONLY (five missing,
  `dividend_yield` 0.013): `ExecuteFormula` called exactly once (`fundamentals_scoring.py:52`; buggy code
  calls it twice) with dividend_yield 0.013, pe_ratio 0.0, `x-user-id: system`,
  `x-internal-caller: analysis-fundsignal`; exactly one IngestSignal and one `fundsignal_emitted` row, both
  DIVONLY (harness composite 0.7, `test_fundsignal_loop.py:543`); none for NODATA; no direction asserted.
- Abort-path wiring test: `ManageSignalSource` rejects -> `_SystemWriteRejected` -> `_abort_cycle`; the
  WARN is still logged. Fails if the call is deleted or moved inside the `try`.
- Zero-value table: pe->0.0, pb->0.0, roe->0.0, de->1.0, eps->0.0. `_warn_unscored` unit test (one WARN
  with `run_id` + sorted symbols; none on empty). `TestScoringFailClosed` (`:649-683`) stays green
  (recon.md:223-226).

**Consumer surfaces (C-14).** No code change in ui or agent. `/insights/opportunities`
(`services/xstockstrat-ui/src/app/insights/opportunities/page.tsx`) and MCP `list_opportunities`
(`services/xstockstrat-agent/app/tools.py:1518`) stop receiving new fabricated rows; the live blend universe
(`live_loop.py:149-192`, recon.md:58-60) loses data-less symbols. MCP `run_fundamentals_scan`
(`tools.py:1401`) emits nothing for data-less symbols. Stored fabricated signals are owned by
`docs/reports/2026-10-21-ingest-fundsignal-fabricated-signals-not-retracted-defect.md` (B.2, amendments
(a)-(d)); its residual (c), partial-row wrong-score signals (ZRO-shape 0.6 vs 0.30), stays live up to
`valid_days`.

**Docs / C-10 / F-08 (same PR).** Analysis `CLAUDE.md:123` (a rerun re-fetches unscored symbols, bounded by
`daily_call_budget`; ingest dedups per owner, `servicer.py:1041-1056`) plus the producer bullets (unscored
WARN); `services/xstockstrat-analysis/docs/context-constitution.md:42`; `dry_run` doc drift ("score +
report", but `dry_run` returns before scoring, `fundsignal_loop.py:195-199`) fixed at
`services/xstockstrat-agent/app/tools.py:1409` and `docs/runbooks/mcp-tools.md:836`;
`packages/proto/analysis/v1/analysis.proto:554` logged in `docs/context-constitution-findings.md`, not
edited. The spec step's Files list must name: `services/xstockstrat-analysis/app/engine/fundsignal_loop.py`,
`services/xstockstrat-analysis/tests/conftest.py`, `tests/test_fundsignal_loop.py`,
`tests/test_owner_header_guard.py`, `tests/test_fundamentals_formula_servicer.py`,
`services/xstockstrat-analysis/CLAUDE.md`, `services/xstockstrat-analysis/docs/context-constitution.md`,
`services/xstockstrat-agent/app/tools.py`, `docs/runbooks/mcp-tools.md`,
`docs/context-constitution-findings.md`. Root teardown: `/context-forge:context-constitution refresh`, or a
manual reconciliation recorded in the PR.

**Gates (blocking).**

- (a) Vendor-zero probe: discharged for staging (`context.md:246-250`): SPY/VOO/QQQ list all seven metrics in
  `missing_metrics`; no explicit vendor zero for pb_ratio or debt_to_equity.
- (b) Dev smoke after deploy: MCP `run_fundamentals_scan symbols=[SPY,VOO,QQQ,IWM,DIA] force=false
  dry_run=false`. PASS iff `symbols_processed==5`, `deferred_count==0`, `signals_emitted==0`, and the
  `_warn_unscored` line whose `run_id` equals the summary `run_id` lists all five (DO logs, dev
  xstockstrat-analysis; a line from another run does not count). Record dev `min_conviction_to_emit` and
  `scoring_formula_id`. `symbols_processed<5` (retry next UTC day) or no log access = INCONCLUSIVE.
  `force=true` forbidden (`:210-216`). FAIL blocks promotion; its signals go to B.2 (d).
- (c) Prod parity before promotion: record prod `marketdata.fundamentals.provider` and `snapshot_source` in
  context.md; if either differs from staging (finnhub/vendor), re-run (a) under prod's path, same blocking
  rule.

**Sibling sweep (ledger `fails.md:1815-1822`), dispositions word for word.**

- `scoring.py:15,39`: intended neutral.
- `scoring.py:31`: owned by B.3(1), `docs/reports/2026-10-21-analysis-zero-conviction-read-as-neutral-defect.md`.
- `screener.py:467`: unreachable.
- `screener.py:480`: owned by 144.
- `fundamentals_value_quality.py:162,180`: owned by B.3(3),
  `docs/reports/2026-10-21-analysis-fundsignal-formula-partial-row-wire-zero-defect.md`.

**Provider-boundary trace (adversary r8; UNVERIFIED, execute must re-grep before citing as fact).** D/E=0 or
P/B=0 reaches the scorer only as an explicit vendor zero: `finnhub_client.go:176-189,209-220`,
`fmp_client.go:301-352`, `edgar_client.go:560-562`, `marketdata_repo.go:537-562`,
`marketdata_service.go:2033-2038`. Unverified residual: cache rows written before the pointer types
existed, bounded by the 24h TTL.

**Footprint.** One analysis production file, tests, one agent docstring, docs. No proto, migration, config,
or ingest/indicators code change. Promotion target for AC-1/2/3: the analysis durable suite
(`services/xstockstrat-analysis/acceptance/fundamentals-formula-inputs.feature` for AC-3, or a sibling).

## Rejected Alternatives

- Restore `with direction "buy"` to AC-1 and assert it — locks the n=1 quantile defect (`:470-480`) into a rule; r3/B.1 dropped it.
- `BUILTIN_SCORER_METRICS` in `tests/conftest.py` (r7) — one consumer file; C-13 lazy materialisation; leaks a production private into the shared conftest.
- Production `_BUILTIN_METRICS` constant (r5) — read only by tests (C-18).
- `_warn_unscored` with `total` unspecified — `len(fetched)`, `len(to_process)`, `len(universe)` give different "N of M"; `len(fetched)` matches `symbols_done`.
- `_warn_unscored` unit test alone — stays green if the call site is deleted or moved inside the `try`; replaced by `run_once`-level `caplog` tests.
- `_warn_unscored` without `run_id` — smoke (b) cannot tell its own run from a scheduled cycle.
- `fundamentals_row` deriving `missing_metrics` from omitted canonical metrics — changes feature-201 `_snapshot_resp` semantics and widens the diff.
- Unscored count in the `run_completed` ledger payload / `symbols_unscored` (r4/r5) — no reader (`insightsBff.ts:151-156`); YAGNI.
- `symbols_unscored` field in `FundamentalsScanSummary` — proto change outside Fix Scope.
- Inline `if unscored: log.warning(...)` — equivalent once wiring tests exist; helper kept for the direct unit test.
- AC-3 as one VOO, not emitted (r4-r7 wording) — contradicts `@AC-8`/`@AC-26`; replaced by NODATA + DIVONLY.
- Real tickers in AC-3 fixtures — staging VOO lists `dividend_yield` as missing.
- Edit the `analysis.proto:554` comment here — adds a buf-gen/proto-freshness touchpoint against Fix Scope "Proto: none".
- Keep pb `< 0` — an impossible P/B of 0 gets the top band score 1.0.
- Notify WARN via `_emit_warning` for unscored symbols — an alert every cycle for ETFs that never have data.
- Smoke via `dry_run=true` (returns at `:195-199` before scoring) or `force=true` (deletes the day's rows, `:210-216`).
- Treat the staging probe as covering prod — provider and `snapshot_source` are per environment; replaced by gate (c).
- One pre-`_score` absence filter on `fetched` — mixes the five-key built-in rule with the six-key formula rule.
- Count unscored as `len(fetched)-len(scores)` — mislabels formula-exception skips (`:465-466`).
- Emit data-less symbols as hold or conviction 0.0 — INGEST-4 plus `scoring.py:31` turn it back into 0.5 (recon.md:260-265).
- Skip-marker `fundsignal_emitted` row — AC-1 "no row" forbids it.
- Omit absent metrics on the formula path now — a CHANGE to `@AC-8` with no operator decision; owned by B.3(3).
- B.2 predicate `score=0.5` alone, match by `signal_id`, or a new ingest RPC — over-expires, misses force-rerun orphans, or overbuilds.
- Defensive `getattr(f, "missing_metrics", ())` in production code — masks bad fixtures.
- Migrate every inline `Fundamentals` row repo-wide into the factory — "while I'm here" scope.

## Open Risks

- [ ] FR-2 trusts `missing_metrics`; after pb `<= 0`, de=0 still scores 1.0, so pb=0 + de=0 averages 0.5 (accepted residual). Gates (a)-(c) cover only probed environments and dates; pre-pointer-type cache rows unverified (24h TTL) — gates (b)/(c), pre-promotion.
- [ ] Provider-boundary citations not re-grepped — `/sdd-execute` service step, before citing.
- [ ] Probe sampled SPY/VOO/QQQ only; IWM/DIA covered by smoke (b) — post-deploy smoke.
- [ ] Skip visibility is log-only; smoke (b) needs DO log access, else INCONCLUSIVE (`fails.md:2463`) — post-deploy smoke.
- [ ] A failing smoke emits up to five fabricated dev signals until B.2 (d) runs — B.2 dev run.
- [ ] Formula path: a DIVONLY-like row is scored from wire zeros under any formula that ignores `dividend_yield` (`@AC-8`, `fails.md:2725` shape); opt-in, seeded empty (`008_analysis_fundsignal_keys.up.sql:33-34`) — owned by B.3(3).
- [ ] Small-n quantile: one scored symbol is labelled buy (`:470-480`); the fix makes small sets more common — owned by B.3(2), `docs/reports/2026-10-21-analysis-fundsignal-small-cross-section-quantile-defect.md`.
- [ ] Stored fabricated 0.5 signals live up to `valid_days` (90) until B.2 runs; opportunity surfaces lag until the next recompute; ZRO-shape partial-row signals outside B.2 — owned by B.2.
- [ ] Real zeros reported as present now score 0.0 and read as 0.5 downstream — owned by B.3(1).
- [ ] Same-day reruns re-fetch unscored symbols, bounded by `daily_call_budget` — docs step (analysis `CLAUDE.md:123`).
- [ ] Overlap with 244-fix-python-config-zero-trap on `min_conviction_to_emit` (`:229`) and any presence helper; reuse whichever lands first — `/sdd-spec`.

## Constitution Rules Touched

- `C-11` — honored by: FULL design per operator decision; 8 rounds under the operator-raised cap; operator approval 2026-10-21.
- `C-13` — honored by: `fundamentals_row` factory in `tests/conftest.py` (3 consumers); `BUILTIN_SCORER_METRICS` module-local; synthetic NODATA/DIVONLY fixtures; zero-value table test.
- `C-08` / `P-06` — honored by: `run_once`-level `caplog` tests on the normal and abort paths prove the WARN call site.
- `C-14` — honored by: consumer surfaces named; B.2 owns stored fabricated signals (amendments (a)-(d)); B.3(1)-(3) own the residuals; gates (a)-(c).
- `C-15` — honored by: AC-1 direction Then removed in `acceptance.feature` (B.1, this commit), so scenario and test agree; AC-3 Thens observable on the wire; IDs append-only.
- `C-16` — honored by: business rules below; no CHANGE to a durable `@AC`.
- `C-18` — honored by: no production constant or proto field only tests read; `symbols_unscored` dropped.
- `C-10` — honored by: analysis `CLAUDE.md:123`, `context-constitution.md:42`, `tools.py:1409`, `mcp-tools.md:836` fixed; `analysis.proto:554` logged in findings; root teardown.
- `F-08` — honored by: the spec step's Files list names every touched file (Chosen Approach, Docs).
- `F-01` / `F-04` / `F-06` / `F-07` — honored by: no migration, no invented paths (provider trace flagged unverified), pool unchanged, no config literal.
- `P-02` — honored by: only the synthesized state carried between rounds.
- `P-03` — honored by: every gate has an evaluable, run-attributed pass condition; `total` defined.
- `P-04` / `P-05` — honored by: rounds 1-5 at `c937f066`, rounds 6-8 at `38ce1789`; gate writes precede this approval in the same commit.

## Business Rules Touched (C-16)

Operator decisions (2026-10-21, `context.md`): standing auto-approve authorization; full design depth;
5-round cap lifted to 8; round-8 design approved, approval writer files B.2/B.3 and applies B.1. No CHANGE
line exists, so no `@AC` change needed operator coverage.

- EXTEND `@AC-1 @FR-1` (246, feature-local, pre-launch) — last Then drops `with direction "buy"` (r3/B.1); formula-id Given moved out of Background; ID unchanged.
- EXTEND `@AC-2 @FR-2` (246) — formula-id Given moved out of Background.
- EXTEND `@AC-3 @FR-3` (246, new) — NODATA all-six-missing skipped; DIVONLY partial row scored once as system with wire pe_ratio 0.0 and emitted.
- EXTEND `@AC-8 @feature-201` "On a partial fundamentals row the strategy omits absent metrics … and diverges from the producer" (`services/xstockstrat-analysis/acceptance/fundamentals-formula-inputs.feature:47-53`) — new case: producer partial row passes wire 0.0, asserted durably by AC-3 DIVONLY. A B.3(3) fix would need a CHANGE sign-off.
- PRESERVE `@AC-6 @feature-224` "The fundamentals loop still runs the system scoring formula" (`docs/sdd/business-rules/platform.feature:258`) — not regressed by: DIVONLY reaches `ExecuteFormula` as system (AC-3).
- PRESERVE `@AC-26 @feature-224` "System-owned fundamentals signals are visible to every user" (`docs/sdd/business-rules/platform.feature:292`) — not regressed by: partial rows are still emitted as system.
- PRESERVE `@AC-36 @feature-224` "System slugs are reserved in both directions" (`docs/sdd/business-rules/platform.feature:314`) — not regressed by: registration path and abort unchanged.
- PRESERVE `@AC-37 @feature-224` "Fundamentals scan fails closed on a non-system scoring formula" (`services/xstockstrat-analysis/acceptance/private-by-default-templates.feature:61`) — not regressed by: the unscored branch never falls through to `_builtin_score`.
- PRESERVE `@AC-4 @feature-201` "One formula, identical I/O … fully-populated rows" (`fundamentals-formula-inputs.feature`) — not regressed by: the skip never fires on a populated row; `_snapshot_resp` is a factory pass-through.
- PRESERVE `@AC-1` / `@AC-4 @feature-156` (`services/xstockstrat-analysis/acceptance/fix-fundamentals-signal-producer.feature`) — not regressed by: source registers with empty scores (`:236`); WARN before the `try`, never raises; an all-skipped cycle reaches `_finish` (`:286`).
- PRESERVE `@AC-6 @feature-154` (`services/xstockstrat-analysis/acceptance/fundsignal-watchlist-universe.feature:39`) — not regressed by: symbol cap still applied before scoring (`:183`).
