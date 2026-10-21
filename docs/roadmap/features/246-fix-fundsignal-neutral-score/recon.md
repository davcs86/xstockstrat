# Recon: fix-fundsignal-neutral-score

**Created**: 2026-10-20
**From**: product-spec.md
**Affected services**: xstockstrat-analysis (code change), xstockstrat-ingest (downstream recipient, no change
anticipated). Consumer surfaces (C-14, product spec): xstockstrat-ui `/insights/opportunities`, xstockstrat-agent
`list_opportunities` / `run_fundamentals_scan` (no discovery pass run, see Risks / Not-found).

---

## Objective

The fundamentals signal producer's built-in scorer returns a fabricated neutral `0.5` when no metric is usable
(`services/xstockstrat-analysis/app/engine/fundsignal_loop.py:432`). Its truthiness checks (`:420-430`) also treat a
reported `0.0` as absent. The `0.5` then enters the cross-sectional quantile, the `analysis.fundsignal_emitted`
table and ingest `IngestSignal` as a real signal. The fix reads absence from `Fundamentals.missing_metrics` (proto
field 18). FR-1: a symbol missing every metric is never scored, ranked or emitted. FR-2: a partial row is scored
from its present metrics, real zeros included. No proto, migration or config change is anticipated.

## Codebase Map

- **`xstockstrat-analysis`** (Python)
  - Entry point: `FundamentalsSignalLoop.run_once`, `app/engine/fundsignal_loop.py:169`. The scheduled loop and
    `RunFundamentalsScan` share it.
  - Handler/servicer: `RunFundamentalsScan`, `app/handlers/servicer.py:3812`. It is admin-gated and forwards to
    `run_once(force, dry_run, override_symbols, metadata)`.
  - Last migration: `027_contract_owner_dimension.up.sql` (`services/xstockstrat-analysis/migrations/`). The next
    free number is 028; none is needed.
  - Config-read pattern:
    - `self._cfg.get_float("analysis.fundsignal.min_conviction_to_emit", default=0.0)`, `fundsignal_loop.py:229`
    - `get_int("analysis.fundsignal.valid_days", default=90)`, `:232`
    - `get_str("analysis.fundsignal.scoring_formula_id", "")`, `:201` and `:411`
  - Other key symbols (all in `fundsignal_loop.py` unless noted):
    - `_builtin_score` — `:416-432`. A `@staticmethod` taking one arg `f`. Truthiness checks at
      `:420,423,425,428,430`; neutral fallback `return sum(parts) / len(parts) if parts else 0.5` at `:432`.
    - `_BUILTIN_BANDS` — `:45-50`. Bands for `pe_ratio`, `pb_ratio`, `roe`, `debt_to_equity`. `_lin` is at
      `:53`. `eps` is scored inline: 1.0 if > 0, else 0.0 (`:430-431`).
    - `_score` — `:409-414`. Formula branch at `:412-413`; built-in dict comprehension at `:414`.
    - `_score_via_formula` — `:447-467`. Builds a raw wire dict at `:452-459` and never reads `missing_metrics`.
      Skips a symbol on exception at `:465-466`.
    - `_map_directions` — `:469-485`. `buy_cut = _quantile(ordered, buy_quantile)` at `:475`; `s >= buy_cut` →
      `buy` at `:479`. `_quantile` (nearest rank) is at `:631-640`.
    - `run_once` flow:
      - `dry_run` returns at `:195`, before scoring.
      - The formula pre-flight and abort are at `:201-206`.
      - `force` delete is at `:210-216`; `_already_emitted` skip at `:217-219`.
      - `_paced_fetch` at `:223`, then `scores = await self._score(...)` at `:226` and `directions` at `:230`.
      - `_ensure_source_registered` at `:236`.
      - Emit loop at `:237-269`: `score < min_conv` at `:240`; `fundsignal_emitted` claim insert at `:243-254`;
        `_emit_signal` at `:257`.
      - `_finish(symbols_done=len(fetched))` at `:286-293`.
    - `_paced_fetch` — `:381-407`. A failed chunk is logged and skipped (`:401-402`). A symbol missing from the
      response never enters `fetched` (`:399-400`).
    - `_emit_signal` — `:520-550`. `valid_until = now + valid_days` at `:524-525`; `conviction=float(conviction)`
      at `:533`.
    - `_finish` — `:552-580`. Updates `fundsignal_runs`. The `run_completed` ledger payload (a free-form dict) is at
      `:564-568`, and `FundamentalsScanSummary(symbols_processed=symbols_done)` at `:575`.
  - Downstream consumer: `resolve_fundamentals_universe`, `app/engine/live_loop.py:149-195`. It returns
    `signal_symbols & fundamentals_symbols` (`:192`). Callers: `live_loop.py:370`, `live_loop.py:511-515`,
    `app/engine/entry_backfill.py:89-90`.
  - Schema: `analysis.fundsignal_emitted`, `migrations/004_fundsignal_emitted.up.sql:6-15`. PK is
    `(symbol, source, as_of_date)`. `score numeric` and `direction text` are both nullable.
  - Tests:
    - `tests/test_fundsignal_loop.py`: `_make_cfg` `:20`, `_fund` `:31-42`, `_make_loop` `:45-68`
      (`_get_multi` stub at `:60-61`), `_emitted_inserts` `:549-552`.
    - A second fundsignal fixture runs the formula path: `tests/test_owner_header_guard.py:197`
      (`_FUND_VALUES`) and `:200-224`.
    - `tests/conftest.py`: `ctx_with` `:71`, `RecordingStub` `:83`, `fund_period` `:49`.
    - pytest config: `pyproject.toml:30-32`.
- **`xstockstrat-ingest`** (Python). Passive recipient; no change anticipated.
  - Handler/servicer: `IngestSignal`, `app/handlers/servicer.py:940`, delegating to `_ingest_external_signal`
    (`:966`), which it shares with the `mcp_client` loop.
  - Conviction validation is a range check only (`:986-987`), so `0.5` passes. `0.0` is stored as NULL
    (`:1006`, INGEST-4) and read back as `0.0` (`:1252`).
  - System grant: `"analysis-fundsignal": frozenset({"ManageSignalSource", "IngestSignal"})` at `:92` and
    `_SYSTEM_GRANT_SAN = "xstockstrat-analysis"` at `:95`, resolved in `_resolve_owner` (`:353`).
  - Dedup claim (`ingest.signal_dedup_claims`) is at `:1041-1056`.
  - `QuerySignals` is at `:1154`. Its `active_window` expiry filter is opt-in (`:1193-1210`, INGEST-5).
  - Last migration: `014_contract_signal_ownership.up.sql`. The next free number would be 015; none is needed.
  - Config-read pattern: n/a. Only `ingest.signals.dedup_window_hours` touches the `IngestSignal` path, and it is
    unaffected.

## Patterns to REUSE

- **Absence check.** Reuse `missing_metrics` membership, as in the screener's `_fundamental_value`
  (`app/services/screener.py:402-403`: `if metric_name in fund.missing_metrics: return None`). The set-then-map
  shape is at `app/handlers/servicer.py:6481-6482` and `:6557-6558`:
  `missing = set(p.missing_metrics)`; `{m: (None if m in missing else getattr(p, m)) ...}`. Do not add a new
  presence helper unless 244-fix-python-config-zero-trap lands one first (overlap note, `context.md`).
- **"Metrics the built-in scorer reads" set.** Derive it from the `_BUILTIN_BANDS` keys (`fundsignal_loop.py:45-50`)
  plus `eps`, so the FR-1 "every metric" test cannot drift from the scorer. Do not reuse
  `_FUNDAMENTAL_FIELDS` (`screener.py:40-52`, 11 names) or `_FUNDAMENTAL_METRICS` (`app/services/evaluator.py:186`).
  Both are supersets: they include `market_cap`, `dividend_yield` and others, which the built-in scorer never
  reads. Canonical names match the proto field names verbatim (`packages/proto/marketdata/v1/marketdata.proto:213-220`).
- **Skip by omission (no score).** Leave the symbol out of the `scores` dict. The existing seam already does this:
  a symbol absent from `scores` skips both `_map_directions` and the emit loop (`fundsignal_loop.py:237-238`, whose
  comment says "A symbol whose formula scoring failed has no score and is skipped"). `_score_via_formula` already
  omits a symbol on exception (`:465-466`). Use this in preference to feature 144's
  `score_unavailable` flag (`screener.py:479`, rank-last sort at `:152`). The product spec is stricter than
  feature 144: the symbol is never ranked.
- **Skip visibility.** Log with the existing shape
  `log.warning("fundsignal: formula scoring failed for %s: %s", sym, e)` (`:466`). A run-level skipped count can go
  in the free-form `run_completed` ledger payload (`:564-568`) with no proto change.
- **Test fixtures.** Real `marketdata_pb2.Fundamentals(symbol=..., missing_metrics=[...])` messages are used in
  `tests/test_screener.py:288-296` (`test_fundamental_hard_filter_missing_field_fails_closed_not_lte_zero`, `:280`).
  Proto messages always carry `missing_metrics` and follow proto shape (C-13). Also reuse:
  - `_make_loop` (`test_fundsignal_loop.py:45-68`), via its `_get_multi` stub (`:60-61`);
  - `_emitted_inserts(loop)` (`:549-552`) for "no `fundsignal_emitted` row";
  - the `loop._ingest.IngestSignal` AsyncMock (`:64`) `await_args` for the `ExternalSignal` conviction;
  - `RecordingStub` (`tests/conftest.py:83`).
- **Discriminating regression test** (insights.md:2489-2497). AC-1's first two Thens separate bug from fix; the
  MSFT `buy` Then alone does not. AC-2 asserts 0.30, where the buggy code yields 0.6 because `if f.roe:` (`:425`)
  drops the 0.0.

## Existing Business Rules (preserve / extend)

- **PRESERVE** `@AC-8 @FR-5 @FR-6 @feature-201` "On a partial fundamentals row the strategy omits absent metrics (does not penalize) and diverges from the producer" (`services/xstockstrat-analysis/acceptance/fundamentals-formula-inputs.feature`) — the formula-path producer passes a missing metric as 0.0 (hard zero); partial-row behaviour must not change (spec marks PRESERVE)
- **EXTEND** `@AC-8 @FR-5 @FR-6 @feature-201` "On a partial fundamentals row the strategy omits absent metrics (does not penalize) and diverges from the producer" (`services/xstockstrat-analysis/acceptance/fundamentals-formula-inputs.feature`) — only if design extends the all-missing skip to the formula path; it adds a new all-missing case alongside the partial-row rule
- **PRESERVE** `@AC-4 @FR-5 @feature-201` "One formula, identical I/O in the producer and in a strategy — fully-populated rows" (`services/xstockstrat-analysis/acceptance/fundamentals-formula-inputs.feature`) — fully-populated rows score identically if the formula path is touched
- **PRESERVE** `@AC-1 @feature-156` "The producer runs its first cycle promptly on a fresh deploy, not after a full interval" (`services/xstockstrat-analysis/acceptance/fix-fundamentals-signal-producer.feature`) — source registration and first `run_once` must still occur when the whole universe is data-less
- **PRESERVE** `@AC-4 @feature-156` "A caught cycle error retries after retry_seconds, not a full interval" (`services/xstockstrat-analysis/acceptance/fix-fundamentals-signal-producer.feature`) — a cycle with zero scorable symbols must complete normally, not raise
- **PRESERVE** `@AC-6 @feature-156` "A manual scan does not contaminate the scheduled cadence" (`services/xstockstrat-analysis/acceptance/fix-fundamentals-signal-producer.feature`) — `RunFundamentalsScan` shares `run_once`; `blocked_until_ms` stays unchanged
- **PRESERVE** `@AC-37 @FR-3 @FR-6 @feature-224` "Fundamentals scan fails closed on a non-system scoring formula" (`services/xstockstrat-analysis/acceptance/private-by-default-templates.feature`) — no built-in fallback on the formula path; no emit and no `fundsignal_emitted` row on abort
- **PRESERVE** `@AC-6 @FR-3 @FR-1 @feature-224` "The fundamentals loop still runs the system scoring formula" (`docs/sdd/business-rules/platform.feature`) — system-identity `ExecuteFormula` unchanged
- **PRESERVE** `@AC-36 @FR-4 @feature-224` "System slugs are reserved in both directions" (`docs/sdd/business-rules/platform.feature`) — registration failure still aborts with an ERROR alert and no emit
- **PRESERVE** `@AC-26 @FR-6 @feature-224` "System-owned fundamentals signals are visible to every user" (`docs/sdd/business-rules/platform.feature`) — symbols with data are still emitted and consumed
- **PRESERVE** `@AC-1 @FR-1 @FR-3 @FR-4 @feature-168` "Blend strategy runs on the fundamentals universe intersection" (`services/xstockstrat-analysis/acceptance/fundamentals-blend-universe.feature`) — universe rule unchanged; data-less symbols drop out because they have no signal
- **PRESERVE** `@AC-2 @FR-1 @feature-186` "Blend strategy is skipped when fundamentals universe is empty" (`services/xstockstrat-analysis/acceptance/fundamentals-blend-strategy-restrictions.feature`) — more reachable after the fix; must stay a clean skip
- **PRESERVE** `@AC-1 @regression @feature-193` "the queue attributes the blend only inside the fundamentals universe" (`services/xstockstrat-analysis/acceptance/fix-blend-queue-fundamentals-universe.feature`) — queue attribution rule unchanged under a smaller universe
- **PRESERVE** `@AC-10 @FR-8 @feature-215` "Partial rows evaluate and filings at or after the window's last bar do not count" (`services/xstockstrat-analysis/acceptance/block-fundamentals-strategy-on-etf.feature`) — strategy-side partial rows still evaluate; do not couple FR-1 to `fundamentals_guard`
- **PRESERVE** `@AC-33 @FR-6 @feature-224` "A user cannot write as the system owner" (`services/xstockstrat-ingest/acceptance/private-by-default-templates.feature`) — system-write grant unchanged; no ingest change anticipated

Ordering constraints these rules impose:

- The skip runs inside `run_once`, after the `:201-206` pre-flight. It never precedes or masks `_ensure_source_registered` (`:236`). It also never raises: a data-less universe must still register and complete normally (156 `@AC-1/@AC-4`, 224 `@AC-36`).
- Keep it downstream of `_resolve_universe`/`_apply_symbol_cap` (`:182-183`), so the 154 FMP-cap rotation rules (`@AC-6/@AC-9`) are unaffected.

Notes, from scenario-recon:

- **No CHANGE is required** by FR-1/FR-2 as written. `@AC-8`'s "producer passes pe_ratio as 0.0 / hard zero" is
  bound to the `value_quality` formula (`fundamentals-formula-inputs.feature:47-53`). No durable `@AC` covers the
  built-in scorer's partial-row behaviour, so FR-2 is not constrained by one.
- **Conditional CHANGE.** If design makes the formula path omit absent metrics (extending FR-2 there), that alters
  `@AC-8 @feature-201` and needs explicit user sign-off in `context.md`. None is recorded: the binding operator
  decisions of 2026-10-20 cover no `@AC` CHANGE. A silent change is a C-16 regression.
- **Coverage gap, not a guarantee.** No durable `@AC` covers any of:
  - `_map_directions` quantile mapping;
  - `min_conviction_to_emit` or `valid_days`;
  - `fundsignal_emitted` idempotency or the `force` re-emit;
  - the `dry_run` early return.

  This feature's `@AC-1/@AC-2` are the first guards there. Retraction of stored signals has no rule, so any
  remediation would be net-new, not a CHANGE.

Out of scope (scenario-recon, not impacted):

- Other scenarios in the analysis suites: 156 `@AC-2/3/5/7`, 158 `durable-loop-scheduler`, 154 `@AC-3..9`,
  199 `opportunity-composite-score` (its 0.5 is the shrinkage prior), 190 `@AC-11`, 160, the 215 guard scenarios,
  201 `@AC-1/2/3/7`, and the other blend-strategy rules.
- The ingest suites (`private-by-default-enforce-contract`, `mcp-client-signal-source`,
  `historical-fundamentals-backtest`).
- The other `platform.feature` rules.
- The ui and agent `fix-fundamentals-signal-producer` suites (ui `@AC-9`, agent `@AC-8` admin gates), which are
  PRESERVE and unaffected.

## Dependencies

- **Proto/RPC.** No change. The fix reads `repeated string missing_metrics = 18;`
  (`packages/proto/marketdata/v1/marketdata.proto:241`, contract `:213-220`) and emits
  `ExternalSignal.conviction = 4` (`packages/proto/ingest/v1/ingest.proto:127`). `FundamentalsScanSummary` fields
  1-7 (`packages/proto/analysis/v1/analysis.proto:558-566`) have no skipped-count field, and adding one would be a
  proto change outside Fix Scope. The marketdata producer of `missing_metrics` is `toProtoFundamentals`
  (`services/xstockstrat-marketdata/internal/service/marketdata_service.go:2036`, `:2056`), used by
  `GetFundamentalsMulti` (`:1677-1711`).
- **Migration.** None. Next free numbers would be analysis `028` and ingest `015`.
- **Config keys.** Existing keys only; none new: `analysis.fundsignal.scoring_formula_id` (seeded empty,
  `services/xstockstrat-config/migrations/008_analysis_fundsignal_keys.up.sql:34-35`),
  `analysis.fundsignal.min_conviction_to_emit`, `buy_quantile`, `sell_quantile`, `valid_days` and `source_slug`.
- **Inter-service edges.** All existing; none new:
  - analysis → marketdata `GetFundamentalsMulti`;
  - analysis → ingest `IngestSignal` / `ManageSignalSource`;
  - analysis → indicators `GetFormula` / `ExecuteFormula` (formula path only).
- **New env vars / ports.** None. `INGEST_ENDPOINT` and `MARKETDATA_ENDPOINT` already exist in the analysis env
  block.

## Risks / Not-found

1. **Fixture hazard.** `_fund` (`tests/test_fundsignal_loop.py:31-42`, 3 call sites) is a `SimpleNamespace` with no
   `missing_metrics`. A second fundsignal fixture has the same gap: `_FUND_VALUES` at
   `tests/test_owner_header_guard.py:197`, used at `:219-223` on the formula path. An unguarded `f.missing_metrics`
   read raises `AttributeError` in both.
   - Real `Fundamentals` messages always carry the field, so a defensive `getattr` in production code would only
     accommodate the tests. Update the fixtures instead.
   - Two consumers share the fundamentals-row shape, so C-13's second-consumer rule may force a
     `tests/conftest.py` home.
   - Bound the blast radius by grep before changing the shape (fails.md:1351). Today `test_analysis_servicer.py`
     mocks `run_once` wholesale (`:1314-1383`).
2. **Return-type hazard.** `TestScoringFailClosed` monkeypatches `_builtin_score` to return `0.5`
   (`test_fundsignal_loop.py:649,660,672,683`). `test_builtin_score_deterministic` (`:188-192`) asserts
   `0.0 <= score <= 1.0`. A `None` "no score" return must stay consistent with both. These are mocks, not business
   rules (`context.md`).
3. **Re-fetch on same-day rerun.** A skipped symbol writes no `fundsignal_emitted` row, so `_already_emitted`
   (`:217-219`) never excludes it, and each same-day rerun re-fetches it (a cache call). That breaks the analysis
   `CLAUDE.md` claim "a same-day re-run emits nothing new and spends zero cache calls".
   - A skip-marker row would avoid it: the `score` and `direction` columns are nullable, so it needs no migration.
     But AC-1 requires "no `analysis.fundsignal_emitted` row" for data-less symbols, so the option is excluded.
   - Design must accept the re-fetch and correct the `CLAUDE.md` wording, or choose another route.
4. **Count semantics and silent skips.** `symbols_done=len(fetched)` (`:289`) still counts skipped symbols.
   `FundamentalsScanSummary` cannot carry a skipped count without a proto change. A skip must never be silent
   (fails.md:132, fails.md:2451): at minimum a log line, and optionally a count in the ledger payload (`:564-568`).
5. **Formula path (Open for Design).** `_score_via_formula` (`:452-459`) ignores `missing_metrics`, so under a
   configured `scoring_formula_id` a data-less ETF is scored from wire zeros (fails.md:2724-2727). The path is
   opt-in and seeded empty (`008_analysis_fundsignal_keys.up.sql:34-35`).
   - Extend the all-missing skip to this path: EXTEND `@AC-8`.
   - Make it omit absent metrics: CHANGE `@AC-8`, which needs sign-off and has none.
   - Leave it: name the follow-up feature.

   One placement covers both scorers: a guard between `:223` and `:226` that filters `fetched`. It interacts with
   the `symbols_done` semantics in risk 4.
6. **Digest correction (not a risk).** The analysis digest flagged that `_score` (`:412-414`) falls back to the
   built-in scorer when `self._indicators is None` and a formula id is set. That cannot happen from `run_once`:
   `_scoring_formula_is_system` returns `False` when `self._indicators is None` (`:436-437`), so the cycle aborts at
   `:202-206` before `_score`.
7. **Already-stored fabricated signals (C-14, Open for Design).** Stored rows stay live for up to `valid_days`
   (default 90; `:232`, `:524-525`), feeding `ListOpportunities`, MCP `list_opportunities` and the blend universe
   (`live_loop.py:192`). No retraction path exists:
   - `services/xstockstrat-ingest/app` has no `DELETE`/`UPDATE` on `ingest.newsletter_signals` and no
     retract/expire RPC.
   - `QuerySignals` has no join on `signal_sources.active`, so `ManageSignalSource` deactivate does not hide stored
     signals.
   - A `force=true` rerun (`fundsignal_loop.py:210-216`) deletes only the analysis-side `fundsignal_emitted` rows.

   Remediation needs new ingest code, so design names an operator remediation or a follow-up feature. C-14 does
   not accept a vague "later".
8. **Emitting at 0.0 is not a fix.** Ingest stores 0.0 as NULL (`ingest servicer.py:1006`, INGEST-4) and reads it
   back as 0.0 (`:1252`). Analysis `compute_signal_score` then turns conviction 0 back into 0.5
   (`app/services/scoring.py:31`), so a 0.0 emit is re-fabricated downstream. Only skipping the emit works.
   Ingest dedup does not suppress the 0.5 rows either: `valid_until` moves each day, so the claim misses
   (`:1041-1056`).
9. **Absence granularity** (fails.md:2479-2482, fails.md:2844-2847). This fix adds the field-level case:
   `missing_metrics` listing all five scorer metrics (FR-1) or some of them (FR-2). The other two levels already
   skip by omission:
   - batch: a failed chunk is logged, and its symbols leave `fetched` (`:401-402`);
   - row: a symbol absent from the response (for example the EDGAR omission, feature 215) never enters
     `fetched` (`:399-400`).

   Each level needs its own fixture.
10. **Quantile membership** (neighbour of fails.md:804-819). After the fix, `_map_directions` ranks only scored
    symbols. With one scored symbol, `buy_cut` equals its score and `s >= buy_cut` gives `buy` (`:479`). AC-1's
    MSFT `buy` (≈0.867 = (0.6+1.0+1.0)/3) relies on this existing behaviour.
11. **Sibling neutral-0.5 sweep** (fails.md:1815-1822: fix or file each). Neutral-0.5 shapes elsewhere in
    `services/xstockstrat-analysis/app`:
    - `app/services/scoring.py:15,39` — no-signal neutral in `compute_signal_score` (feature 060 golden-pinned
      backtest math);
    - `scoring.py:31` — conviction 0 read as 0.5;
    - `app/services/screener.py:467` — `norm.get(..., 0.5)` default;
    - `screener.py:480` — already flagged via `score_unavailable` by feature 144.

    Design must fix or explicitly file each. 245-fix-screener-symbol-isolation (draft) touches only `screener.py`.
12. **Overlap** (`context.md`):
    - 244-fix-python-config-zero-trap reads `analysis.fundsignal.min_conviction_to_emit` (`:229`). Coordinate; it is
      not blocking. If 244 adds presence helpers, reuse them.
    - 215 is complementary.
13. **Doc drift, owed in the teardown if behaviour changes.** Two statements in the analysis `CLAUDE.md` "Fundamentals
    Signal Producer" bullets are wrong or about to be:
    - "ingest's `IngestSignal` does **not** dedup" is already stale: ingest dedups per owner since features 111/224
      (`servicer.py:1041-1056`).
    - The "spends zero cache calls" claim (risk 3) will no longer hold.

    `services/xstockstrat-analysis/docs/context-constitution.md:42` (feature 144 bullet) names the producer as the
    unfixed twin.

**Not found:**

- No producer-side `missing_metrics` read: grep of `fundsignal_loop.py` finds no match.
- No producer test with a data-less symbol, a zero-valued metric or a `missing_metrics` fixture:
  `test_fundsignal_loop.py` has no `missing_metrics` match.
- No `score_unavailable`-style flag or skipped-symbol counter in the producer or in `FundamentalsScanSummary`.
- No ingest retraction, deletion, invalidation or supersede mechanism, and no `signal_sources.active` filter in
  `QuerySignals`.
- No durable `@AC` for quantile mapping, `min_conviction_to_emit`, `valid_days`, idempotency/`force` or `dry_run`.
- No ingest durable scenario on conviction semantics for the fundamentals producer.
- **C-14 blind spot.** No `codebase-discovery` pass ran for xstockstrat-ui or xstockstrat-agent. Only the paths
  are confirmed: `services/xstockstrat-ui/src/app/insights/opportunities/page.tsx`, and
  `services/xstockstrat-agent/app/tools.py:1401` (`run_fundamentals_scan`) and `:1518` (`list_opportunities`).
  - Per the product spec, the surface change is row volume only, with no code change anticipated.
  - The other ui/agent suites (opportunities rendering, the `list_opportunities` projection) were not read.
  - Design confirms whether those surfaces need a step or only a dev smoke check.
- Not read: `services/xstockstrat-analysis/docs/scoring.md`, `warmup.md`. Not audited: `docker-compose.yml` /
  `.do/app*.yaml` (no new env vars).

## Recommended Scope

Advisory, not binding:

1. **test (RED)** — `tests/test_fundsignal_loop.py`:
   - Write AC-1 and AC-2 as non-dry-run `run_once` cycles over `explicit` universes, with
     `marketdata_pb2.Fundamentals(..., missing_metrics=[...])` fixtures (the `test_screener.py:288-296` precedent).
   - Update `_fund` (and `_FUND_VALUES` if the formula path changes) to carry `missing_metrics`, centralizing per
     C-13 if a second consumer appears.
   - Expected red: AC-1 emits 6 signals (5 ETFs `buy`); AC-2 yields 0.6.
2. **service** — `_builtin_score` reads presence from `missing_metrics` (FR-2: real 0.0 scored; partial row scored
   from present metrics). It yields "no score" when all five metrics are missing, and `_score` omits that symbol
   (FR-1), with a skip log line. Placement (inside the scorer vs. a guard ahead of `_score`) is a design fork.
3. **design-dependent** — Formula path: either the all-missing skip (EXTEND `@AC-8`, plus a test proving partial
   rows still pass 0.0) or a named follow-up feature.
4. **docs** — Correct the analysis `CLAUDE.md` producer bullets (idempotency and cache-call claim, stale dedup
   claim), plus the teardown (context-constitution refresh) for the touched docs.
5. **C-14 follow-up** — Name the feature that owns retraction of already-stored fabricated signals (ingest), or an
   operator remediation. Decide whether the ui and agent surfaces need more than a dev smoke check.
