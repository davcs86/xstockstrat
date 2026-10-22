# Recon: fix-analysis-backtest-bounds

**Created**: 2026-10-21
**From**: product-spec.md
**Affected services**: xstockstrat-analysis, xstockstrat-config

---

## Objective

Two SEV-2 defects from the 2026-10-20 debt-radar scan (D-28, D-29; Track C).

- **D-28.** `_fetch_bars_paged` is documented to fail loudly on a re-served page. Instead it silently returns the
  first page whenever a token-bearing request adds no newer bar. FR-1 makes that case raise `_BarFetchError`. FR-2
  keeps genuine EOF returning normally.
- **D-29.** The seeded `analysis.backtest.max_duration_seconds` has no reader. FR-3, the OQ-1 default, enforces it
  on `RunBacktest` with `DEADLINE_EXCEEDED`, mirroring the screener's existing deadline.

## Codebase Map

- **`xstockstrat-analysis`** (Python 3.13)
  - Handler/servicer: `services/xstockstrat-analysis/app/handlers/servicer.py`
    - `RunBacktest` — `:784-785` (`@owner_scoped`, `async def RunBacktest`). The body runs to about `:1354`; no
      `asyncio.wait_for` and no deadline anywhere in it.
    - D-28 fix site — `_fetch_bars_paged` `:1394-1448`. Docstring `:1395-1411`. Loop state: `page_token = ""` `:1413`,
      `last_seen` `:1414`, `fresh` filter `:1429-1431`. The `if not fresh: return bars` terminal is `:1432-1435`;
      `page_token = resp.page.next_page_token` `:1441`. The page-cap raise `:1445-1448` ends with
      `"— refusing to return a truncated series"`.
    - Constants: `_BAR_PAGE_SIZE = 1000` `:294`, `_MAX_BAR_PAGES = 32` `:298`. The class
      `class _BarFetchError(Exception):` is at `:358`.
    - Direct callers of `_fetch_bars_paged`: `:1464`, `:1472` (inside `_resolve_prefixed_bars` `:1450`),
      `:1924`, `:1926` (`_load_benchmark_bars_windowed` `:1900`), `:1955`, `:4961`, `:5570`
      (`_fetch_benchmark_into` `:5567`). It is also injected as `fetch_bars=self._fetch_bars_paged` at `:3941`,
      `:4211`, `:5116`, `:6025`.
    - Backtest per-symbol path: `_backtest_symbol` `:1490` and `_backtest_symbol_evaluated` `:1995` call
      `_resolve_prefixed_bars` at `:1517` and `:2027`. `_load_benchmark_bars` `:1719` calls it at `:1751`.
    - CPU cores run off-loop: `run_in_executor(self._compute_executor, _core)` at `:1717`, `:2229`, `:2400`.
  - Last migration: none owned here for this feature (key lives in config).
  - Config-read pattern:
    - Screener deadline `servicer.py:3786-3796`: `deadline = self._cfg.get_int("analysis.screener.max_duration_seconds", 120)`,
      then `asyncio.wait_for(engine.screen(...), timeout=deadline)`. `except TimeoutError` →
      `context.abort(grpc.StatusCode.DEADLINE_EXCEEDED, f"screen exceeded {deadline}s deadline")`, then `return`.
    - `RunBacktest` reads at `:787-794`: `get_float` for commission/slippage, and `get_int(..., 0)` for
      `default_fill_model`. That last read uses the zero-trap on purpose; the comment there says so.
    - Presence-aware precedent: `servicer.py:3890` `get_int_present("analysis.readiness.stale_after_seconds", 30)`
      and `:5938`.
  - Other key symbols:
    - `get_int` — `app/config/watcher.py:99`. Returns `v.int_val or default` (zero-trap).
    - `get_int_present` — `app/config/watcher.py:107`. Returns the stored value, including 0. Falls back to the
      default only when the key is absent.
  - Docs: `services/xstockstrat-analysis/CLAUDE.md:468`
    `| analysis.backtest.max_duration_seconds | int | 300 | Max backtest run time |`. The screener row is at `:497`.
  - Tests:
    - `tests/test_warmup.py` `class TestFetchBarsPaged` `:210`, with helpers `_bar` `:193`, `_page` `:199` and
      `_svc_with_pages` `:203`.
    - The test locking in the bug is `test_identical_page_with_identical_token_terminates` `:236-243`. It asserts
      `[1, 2]` and `await_count == 2`.
    - Neighbours: cursor-follow `:216`, token-forward `:230`, overlap `:245`, page-cap raises `:255`,
      empty-first-page `:263`, full page with empty token = EOF `:267`.
- **`xstockstrat-config`** (Node.js 24)
  - Seeds:
    - `migrations/001_config_tables.up.sql:69`
      `('analysis', 'backtest.max_duration_seconds', 'int', '300', 'Max backtest wall-clock time', '300', 'xstockstrat-analysis')`.
    - `migrations/002_config_environment.up.sql:71`, the production row: `'120'`, `'production'`.
  - `migrations/029_heal_config_keys_full_dotted.up.sql:24-25` (`SET key = namespace || '.' || key`). The live row
    key is therefore the full dotted `analysis.backtest.max_duration_seconds`.
  - Last migration on disk: `030_marketdata_edgar_snapshot_keys.up.sql`. The spec says 031 is claimed by 243 and 032
    by 248, though neither file is on disk; 032 is also double-claimed by 244 and 248 per the review. The next free
    number is **033**, needed only under retire.
  - Config code has no key registry: defaults come from the call sites, per `services/xstockstrat-config/CLAUDE.md`.
    No config source or test references "backtest".

## Patterns to REUSE

- FR-1 raise → reuse `_BarFetchError` (`servicer.py:358`) and the page-cap message tail
  `"refusing to return a truncated series"` (`:1445-1448`). AC-1 and AC-4 match on it, as does the existing test
  at `test_warmup.py:255`.
- FR-1 discriminator → reuse the loop's own `page_token` (`:1413`/`:1441`). Inside `if not fresh:`, a non-empty
  `page_token` means it was just sent, so the page was re-served or came back empty → raise. An empty `page_token`
  is genuine EOF, including an empty first page (FR-2). No new state is needed.
- FR-3 deadline → mirror the screener block `servicer.py:3786-3796` (`asyncio.wait_for` + `except TimeoutError` +
  `context.abort(DEADLINE_EXCEEDED, ...)` + `return`). FR-3 must not edit the screener block, which feature 245 owns.
- FR-3 presence-aware read → `get_int_present` (`watcher.py:107`; precedent `servicer.py:3890`), not `get_int`
  (`watcher.py:99`).
  - Feature 244 (`implementation-ready`, not landed) plans an `int_positive` clamp helper; there is no
    `int_positive` in `app/` today. Its key table does not list the backtest key. Design picks whether ≤ 0 means
    "no limit" or reject, and whether to rebase on 244's helper.
- Test harnesses:
  - `test_warmup.py:193-207` (`_svc_with_pages`), for AC-1, AC-2 and AC-4.
  - `make_servicer()` + `_owned_ctx()` RunBacktest harness: `tests/test_fill_model.py:185-196`, `:244`;
    `tests/test_backtest_fundamentals_guard.py:195`; `tests/test_analysis_servicer.py:198`.
  - Config mock pattern: `tests/test_screener.py:20-26` (`cfg = MagicMock()` + a `defaults` dict). For AC-3 the
    mock must also stub `get_int_present` (see the fails ledger entry in Risks).
- Retire path only: the migration 020 pattern, a plain `DELETE ... WHERE namespace=... AND key=...` with a
  down-migration re-insert `ON CONFLICT (namespace, key, environment, COALESCE(user_id, '')) DO NOTHING`
  (`services/xstockstrat-config/migrations/020_remove_analysis_signal_source_weights.up.sql:8-10`,
  `.down.sql:9-24`). The post-147 seed shape (both env rows, NULL user_id, dotted key) is in
  `030_marketdata_edgar_snapshot_keys.up.sql:22-55`.

## Existing Business Rules (preserve / extend)

- **PRESERVE** `@AC-4` "A long backtest does not block another user's read" (`services/xstockstrat-analysis/acceptance/analysis-concurrency-offload.feature`, `@feature-176`) — the FR-3 deadline must not put backtest compute back on the event loop.
- **PRESERVE** `@AC-8` "A fundamentals outage is not reported as absence" (`services/xstockstrat-analysis/acceptance/block-fundamentals-strategy-on-etf.feature`, `@feature-215`) — fetch-failed means a "rerun" warning with no evidence cell. That stays distinct from FR-1's `_BarFetchError` and FR-3's `DEADLINE_EXCEEDED`.
- **PRESERVE** `@AC-12` "Point-in-time fundamentals are read across all pages" (`services/xstockstrat-analysis/acceptance/block-fundamentals-strategy-on-etf.feature`, `@feature-215`) — the PIT fundamentals pager is separate and stays UNKNOWN on a stuck token; FR-1 touches only `_fetch_bars_paged`.
- **PRESERVE** `@AC-13` "A bars outage on a fundamentals strategy stays a data-unavailable row and heals correctly" (`services/xstockstrat-analysis/acceptance/block-fundamentals-strategy-on-etf.feature`, `@feature-215`) — a bars-fetch error in opportunity compute must still produce the data-unavailable row.
- **PRESERVE** `@AC-1` "A data-unavailable symbol is marked unavailable, not evaluated-0/0" (`services/xstockstrat-analysis/acceptance/opportunity-compute-robustness.feature`, `@feature-185`) — FR-1's error must land on the data-unavailable sentinel.
- **PRESERVE** `@AC-2` "An evaluated-but-not-passing symbol is NOT marked unavailable" (`services/xstockstrat-analysis/acceptance/opportunity-compute-robustness.feature`, `@feature-185`) — genuine EOF (FR-2) must still evaluate normally.
- **PRESERVE** `@AC-5` (`services/xstockstrat-analysis/acceptance/opportunity-compute-robustness.feature`, `@feature-185`) — the sentinel must survive persistence when the new error is raised.
- **PRESERVE** `@AC-2` "A data-unavailable readiness row is decorated UNKNOWN, not perpetual PENDING" (`services/xstockstrat-analysis/acceptance/readiness-caching-poll-discipline.feature`, `@feature-181`) — a bars-fetch error must still map to the `bar_epoch = -1` UNKNOWN row.
- **PRESERVE** `@AC-1`, `@AC-2` (`@FR-1 @FR-5 @feature-177`), readiness cache FAST/SLOW and the `bar_epoch` bust (`services/xstockstrat-analysis/acceptance/readiness-caching-poll-discipline.feature`) — a successful paged fetch gives an identical `bar_epoch`, and a failed one stamps nothing truncated.
- **PRESERVE** `@AC-10` "An unspecified request with no config override is byte-for-byte legacy" (`services/xstockstrat-analysis/acceptance/backtest-next-bar-fill.feature`, `@feature-151`) — a run inside the limit is unchanged by the deadline.
- **PRESERVE** `@AC-4 @FR-3 @feature-151` "Legacy same-bar-close fill remains the default and is unchanged" (`services/xstockstrat-analysis/acceptance/backtest-next-bar-fill.feature:28`) — a run that finishes within the limit is unchanged by the FR-3 deadline wrapper.
- **PRESERVE** `@AC-9 @FR-3 @feature-151` "The effective fill model is resolved once and round-trips" (`backtest-next-bar-fill.feature:64`) — the `default_fill_model` read (intentional `get_int` zero-trap) stays intact beside the new presence-aware `max_duration_seconds` read.
- **PRESERVE** `@AC-1 @FR-1 @feature-176` "Opportunity compute fans out concurrently but yields the identical set" (`analysis-concurrency-offload.feature:11`) — the success path of the paged fetch is unchanged in membership and order.
- **PRESERVE** `@AC-4 @FR-4 @feature-152` "Insufficient benchmark history names the benchmark in coverage_gaps" (`services/xstockstrat-analysis/acceptance/market-regime-benchmark-operand.feature:34`) — a genuine short history stays INSUFFICIENT_DATA, distinct from a re-served page (`_BarFetchError`).
- **PRESERVE** `@AC-5 @FR-3 @feature-152` "Benchmark bars are warmed from before start for a reproducible window" (`market-regime-benchmark-operand.feature:42`) — multi-page warm-up loads still return the full series (FR-2).
- **PRESERVE** `@AC-2 @FR-2 @feature-215` "A fundamentals-gated backtest on an ETF returns an explicit reason, not a silent no-trade" (`block-fundamentals-strategy-on-etf.feature:24`) — the refusal and INSUFFICIENT_DATA mapping survive the deadline wrapper.
- **PRESERVE** `@AC-3 @regression @feature-149` "Per-symbol evidence cells and the derived grade are unchanged" (`services/xstockstrat-analysis/acceptance/fix-backtest-annualized-return.feature:22`) — a run failing by `DEADLINE_EXCEEDED` or `_BarFetchError` writes no partial evidence and does not alter the grade.
- **EXTEND** `@AC-32 @FR-12 @feature-224` "Agent docs and strat-lab skill stay in parity with the tool contract" (`docs/sdd/business-rules/platform.feature:300`) — the strat-lab `backtest` skill and `docs/runbooks/mcp-tools.md` gain the two new failure modes (`DEADLINE_EXCEEDED`, "refusing to return a truncated series"); the existing parity checks (list `list_templates`/`instantiate_template`, no `is_public`/`include_public`) must still pass.
- No existing acceptance suite for xstockstrat-config asserts on `analysis.backtest.max_duration_seconds`. Suites scanned: `config-secrets-and-scoping`, `opportunity-config-operability`, `surface-signal-weight-decay-config`, `readiness-materializer-config-keys`, `config-ui-usability`.
- No CHANGE is flagged, so C-16 needs no sign-off. D-28 and D-29 are new guarantees. Only the unit test `test_warmup.py:236` is inverted (C-18; it is not a promoted `@AC-*`).
- At promotion, this feature's `@AC-1..4` numbers repeat in existing suites (e.g. `@AC-4 @feature-151`, `@AC-4 @feature-152`); the `@feature-272` provenance tag keeps them distinct.
- Verification gap: only `analysis-concurrency-offload.feature` was read in full; the other suites were scanned by tag/title. Verify the Then-clauses of the PRESERVE rows during design.

## Dependencies

- Proto/RPC: none. `RunBacktest` reuses the existing gRPC status `DEADLINE_EXCEEDED`, and no message changes.
- Migration: none under enforce (the default). Under retire, the next number is `033` for
  `services/xstockstrat-config/migrations/`. The `DELETE` must use the dotted key
  `analysis.backtest.max_duration_seconds` (post-029); the short key matches nothing.
- Config keys: `analysis.backtest.max_duration_seconds` (existing). It gets its first reader; name, type and seeded
  values (staging 300, production 120) are unchanged.
- Inter-service edges: unchanged (analysis → marketdata `GetBars`, already paged).
- New env vars / ports: none.

## Risks / Not-found

- **R-1 — FR-1's error can be swallowed, silently, in `RunBacktest`.** A `_BarFetchError` from the per-symbol path
  (`_backtest_symbol`/`_backtest_symbol_evaluated` → `_resolve_prefixed_bars` → `_fetch_bars_paged`) reaches the
  symbol loop's generic handler at `servicer.py:1130-1132`: `except Exception as e: log.warning("backtest symbol %s
  error: %s — skipping", ...); continue`.
  - So the fix changes "truncated series" into "symbol silently dropped from the run", not into a loud RPC
    failure.
  - Design must decide one of: catch `_BarFetchError` explicitly and abort the RPC (status to pin, e.g.
    `UNAVAILABLE`); record a per-symbol skip/warning visible in the result; or accept the skip. Whichever is chosen,
    keep it distinct from the `@AC-8 @feature-215` "rerun" warning.
  - There is no named `except _BarFetchError` anywhere in `app/`.
- **R-2 — other callers already treat any exception as best-effort.**
  - Benchmark: `:1924-1928` (`except Exception` → `bars = []`), and `_load_benchmark_bars` `:951-965` catches only
    `_InsufficientData`.
  - Readiness-materializer surgical retry: `:4961-4963` (`except Exception` → warn).
  - Materializer benchmark: `:5570-5573` (`except Exception` → `fetch_failed.add(sym)`, `[]`).
  - The `fetch_bars=` injections (`:3941`, `:4211`, `:5116`, `:6025`) feed the engines. Design should confirm each
    one maps an exception to the `@feature-185` unavailable sentinel or the `@feature-181` `bar_epoch = -1` row; this
    was not verified here.
  - A benchmark that is silently `[]` on a re-served page is a pre-existing best-effort choice and is out of scope
    for per-caller logic. Note it in the design.
- **R-3 — `asyncio.wait_for` cannot stop an executor thread.** CPU cores run via `run_in_executor` (`:1717`,
  `:2229`, `:2400`).
  - Cancelling the awaiting coroutine returns `DEADLINE_EXCEEDED` on time, but the thread keeps running until its
    core finishes and still holds a `_compute_executor` slot.
  - AC-3's "within 2 seconds" holds for the RPC response, not for CPU release. Design must say so and must not move
    compute back onto the loop (`@AC-4 @feature-176`).
  - Design must also make sure a cancelled run writes no `analysis.backtest.completed` ledger event (`:1346`), no
    evidence cell and no run history. The `analysis.backtest.started` append is at `:818`; design decides whether it
    sits inside or outside the bound.
- **R-4 — AC-3 timing flake.** Pin a deterministic delay injection, such as a stubbed engine awaiting an
  `asyncio.Event`/`sleep` with a 1 s limit, or a patched `asyncio.wait_for`. Do not use real compute. No existing
  test covers `DEADLINE_EXCEEDED` for the screener or the backtest, and recon did not locate how tests capture
  `context.abort`.
- **R-5 — the production value of 120 s takes effect for the first time** (`002_config_environment.up.sql:71`).
  Before launch, check dev backtest durations against it (product-spec § Consumer Surface).
- **R-6 — ≤ 0 semantics are open.** `get_int_present` returns a stored 0. Design must pick "no limit" or "reject",
  and add an `@AC` for it. Under `get_int` a stored 0 would silently become 300; that is the 244 trap.
- **R-7 — overlaps.**
  - 244 (`implementation-ready`) changes the analysis getters → rebase on it, or merge after it.
  - 215 (in-progress) shares the `RunBacktest` region.
  - 245 owns the screener deadline at `:3786`; do not edit it.
  - 274 cites `servicer.py:799-800` inside `RunBacktest`.
  - Per-user overrides of this key are exercised by 263's acceptance (`263-fix-edge-owner-scope/acceptance.feature:32,47`).
    Reading through `self._cfg` at call time must keep per-user resolution working.
- **R-8 — consumer surface (C-14).** The strat-lab `backtest` skill (`plugins/strat-lab/skills/backtest/SKILL.md`,
  which exists) must document both new failure modes in the same PR (`docs/patterns/strat-lab-plugin.md`). Also matching
  `run_backtest`: `reference/output-handling.md`, `reference/aggregation.md`, `plugins/strat-lab/README.md`; and the
  error table in `docs/runbooks/mcp-tools.md` (sibling row `:412`, `max_range_days` → `INVALID_ARGUMENT`) gains rows. Recon has
  not read whether the agent `run_backtest` tool or the `/insights` UI already renders `DEADLINE_EXCEEDED` with a
  message; settle this at design.
- Ledger traps:
  - fails.md:1394-1396 (feature 116): an analysis test-helper factory missing a `get_int_present` stub fails at
    runtime → the AC-3 cfg mock must stub `get_int_present`.
  - insights.md:178-190 (feature 071): pagination fixes are rarely "no behavior change". FR-1 turns some formerly
    "successful" runs into failures or skips; state that delta in the design.
- Not found / not verified:
  - Migrations 031 and 032 are not on disk; the 033 numbering relies on the spec and review.
  - `docs/reports/2026-10-19-dead-config-keys-defect.md` was not opened. Under retire, note the key there.
  - Did not verify whether the injected `fetch_bars=` engines catch exceptions.

## Recommended Scope

Advisory:

1. **D-28 guard.** In `_fetch_bars_paged`, raise `_BarFetchError` inside `if not fresh:` when `page_token` is
   non-empty, and update the docstring.
   - Invert `test_warmup.py:236` (C-18).
   - Add AC-4 (token plus empty page → raise) and the AC-2 regression guards.
2. **R-1 resolution.** Decide what `RunBacktest` does with `_BarFetchError` (abort vs a visible skip). Add an
   explicit handler before `except Exception` at `:1130`, with a test.
3. **D-29 enforce.** Read `get_int_present("analysis.backtest.max_duration_seconds", 300)` at call time.
   - Wrap the backtest body in `asyncio.wait_for`. On `TimeoutError`, `context.abort(DEADLINE_EXCEEDED, "<pinned
     message naming the limit>")`.
   - Implement the ≤ 0 choice. Add AC-3 with a deterministic delay.
4. **Docs and consumer surface.** Update the analysis `CLAUDE.md:468` row if the semantics change (e.g. "0 = no
   limit"), and the strat-lab `backtest` skill (both failure modes) while keeping `@AC-32` parity.
5. (Retire path only, if OQ-1 flips.) Config migration 033 up/down using the dotted key. Drop `CLAUDE.md:468` and
   rewrite FR-3/@AC-3.
