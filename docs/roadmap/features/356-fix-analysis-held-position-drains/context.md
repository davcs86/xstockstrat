# Context Log: fix-analysis-held-position-drains

Append-only. Each session appends a new ## Session entry. Never delete or edit prior entries.

---

## Session 2026-11-17 (/sdd-triage)

- Bug recorded via defect report `docs/reports/2026-11-17-analysis-held-position-drains-trust-page-token-defect.md` (no GitHub issue — Issues disabled): analysis held-position drains trust next_page_token and return partial results as success
- Source: feature 353 (`fix-listpositions-nextpagetoken-skips`) design § Open Risks follow-up
- Severity: SEV-3
- Routed to SDD path (Track C)
- Created: feature.md, product-spec.md, acceptance.feature (regression scenario), context.md
- Affected services (from report): xstockstrat-analysis (upstream, unchanged: xstockstrat-portfolio `ListPositions`)
- Root cause hypothesis: Both loops predate the token-looping consumer rule (feature 257) and copy the best-effort pattern: the exit trusts the server token and the error path returns accumulated state. Shared helper vs in-place hardening is an open design question (operator decision 2026-11-17: decide in design).
- Recommended design depth: quick → `/sdd-design fix-analysis-held-position-drains quick` (rationale: SEV-3, single service, no proto/migration/config — rubric says skip; operator chose quick so the helper-vs-in-place fork is debated)
- Development branch: feature/fix-analysis-held-position-drains
- Operator decision (2026-11-17): whether both drains share one helper or are hardened in place is decided in `/sdd-design` (not pre-constrained).
- Must PRESERVE `@AC-16 @feature-294` (`services/xstockstrat-analysis/acceptance/signal-map-instrumentation.feature`: a failed held drain is still counted) and `@AC-8 @feature-262` (`fix-analysis-owner-scope.feature`: drains stay owner-scoped).
- Sibling loops with the same shape (`live_loop.py:535` watchlists, `:601` signals, `:178` fundamentals universe) are out of scope unless design argues otherwise.

## Session 2026-11-17 — sdd-review product-spec

- Product spec approved. Status: draft → spec-ready. Criteria verdict: PASS WITH WARNINGS (0 fails, 0 floor breaches).
- Warnings:
  - Criterion 8 / FR-6: `@AC-4` (non-gRPC exception in `_drain_held_symbols`) was not red-before-green, because `servicer.py:6428` catches only `grpc.RpcError` and a non-gRPC exception already propagates. **Resolved:** dropped `@regression` from `@AC-4` (kept as a guard scenario), and FR-6 now says only `@regression` scenarios must fail on current code.
  - FR-4 live loop: `live_loop.py:401-402` caches `held_cache` only on success and the handler at `:409` catches only `ValueError`, so a failed owner could be re-drained once per strategy and the metric fired per strategy. **Resolved:** FR-4 now states a failed owner is drained at most once per cycle and `drain_failures{source=held}` is recorded once per failed owner per cycle; `@AC-7` now uses two `o-1` strategies and asserts exactly one `ListPositions` call for `o-1` and a metric increase of exactly 1.
  - Criterion 8 wording: several `Then` steps assert drain-boundary detail (call counts, "raises to its caller"). Accepted for a bug fix; RPC-boundary outcomes are covered by `@AC-5`/`@AC-6`.
  - Criterion 11 (advisory): Consumer Surface uses prose, not checkboxes. Accepted.
  - Trading-domain C-1 to C-5 detection grep fired on "portfolio"/"broker"/"order"; satisfied by the spec's explicit no-broker/order/fill/BrokerType declaration.
- Overlap findings (WARN, no FAIL):
  - `services/xstockstrat-analysis/app/handlers/servicer.py` — same function `_compute_opportunities` edited by `308-fix-analysis-per-symbol-isolation` (spec-ready); rebase/manual-merge risk.
  - `servicer.py` — `327-fix-analysis-evidence-dry` (spec-ready) edits a disjoint region (live-gate SQL literal); rebase-only.
  - `services/xstockstrat-analysis/app/engine/live_loop.py` — 327 names live_loop.py as a live-gate SQL site; unconfirmed whether it edits the file (possible WARN).
  - No config, proto or migration overlap. Context only: 353 (upstream ListPositions fix, soft precedence, not a hard dependency), 357, 358 (draft peers, no shared file).
  - Merge-order: no entry required (rebase-level overlaps only).
- Recommended design depth: quick (SEV-3, single service, no proto/migration/config, rebase-only overlap; one round settles the shared-helper vs in-place fork).

OPERATOR DECISIONS (binding, recorded 2026-11-17):
- Operator 2026-11-17: whether live_loop._drain_held and servicer._drain_held_symbols share one helper or are hardened in place is decided in design, not pre-constrained.
- Follow docs/roadmap/ledger/fails.md:3311: fail closed, reject a token equal to the one sent, test against a fake that ignores the token.
- PRESERVE @AC-16 @feature-294 (signal-map-instrumentation.feature) and @AC-8 @feature-262 (fix-analysis-owner-scope.feature).
- Do not touch features 351, 353 or 354.
- Red-before-green is mandatory.

## Session 2026-11-17 — sdd-batch design gate (round 2)

`/sdd-design fix-analysis-held-position-drains` (full) is halted at its approval gate after round 2 (gate policy: halt). design.md is not written and status.md is unchanged (still `spec-ready`). The debate register is `debate.md` (D-1..D-10, R-1..R-7, O-1..O-3).

## Open Threads

- **Approach.** D-1..D-5 stand unchanged. One shared `_drain_positions_paged(stub, user_id, metadata) -> list` helper in `app/handlers/servicer.py` (next to `_fetch_historical_fundamentals_paged`, `:6672`) raises `_PositionsPageError(Exception)` on any page-body error, a repeated non-empty token, or cap exhaustion (50 pages), and never returns partial rows. `live_loop._drain_held` counts `drain_failures{source=held}` and re-raises; the live-loop cycle catches `_PositionsPageError` before `ValueError`, logs one WARNING per owner (naming the first strategy) and skips that owner via a per-cycle `failed_owners` set; `ScreenSymbols` degrades to `held = {}`. Round 2 pins: the wrapping `try` covers only the page body, so the guard's own error is not re-wrapped (D-6); design.md records consequence (d) and the 5,000-position effective cap (D-7, D-8); the impl spec sweeps the existing bare-`MagicMock` portfolio fakes before the RED run (D-9); later strategies of a failed owner are skipped without another log line (D-10). No proto, migration, config, pool or other-service change; features 351, 353 and 354 untouched.
- **Strongest open objection — O-3 (blocking, record-only; C-11, P-03).** The daily opportunity refresh (`servicer.py:6055-6067`) calls `_compute_opportunities` directly, so after the fix a portfolio failure fails that user's refresh, counted only as a failed `_log_items_tick` item, with no retry and no `recompute{outcome=failed}` (only the kick path at `servicer.py:4957` records that). design.md must record this as consequence (d), and the product-spec FR-4/AC-5 counting wording must be corrected (kick path counts `recompute{failed}`; daily refresh counts a failed loop-tick item). No new instrument (R-6). O-1 (non-blocking) stays open until design.md records all four consequences (a)–(d). O-2 closed in round 2.
- **Floor status.** No Floor breaches in either round.
- **Uncovered @AC changes (not covered by an operator decision).** All PRESERVE: `@AC-3 @feature-262`; `@AC-6 @feature-191`; `@AC-6/@AC-7/@AC-10 @feature-185/@feature-289` (recompute failure path); `@AC-2 @feature-168` and `@AC-1/@AC-3 @feature-193` (held set assumed complete); feature-097 daily refresh "one bad user never kills the pass" (no `@AC` id located). Covered by operator decision: PRESERVE `@AC-16 @feature-294`, `@AC-8 @feature-262`; EXTEND `@AC-5 @feature-356` (counting wording) and `@AC-1..@AC-9 @feature-356`.
- **Open risks carried to design.md.** Effective fail-closed bound is 5,000 positions per owner (portfolio clamps 1000 → 100, `portfolio_repo.go:137-138`); daily-refresh queues stay stale ~24h during a portfolio outage; a transient boot failure leaves that owner's entry-backfill state unseeded until restart; existing `MagicMock` fakes may flip branch (sweep before RED); vacuous-green risk unless the RED run on the base commit uses `RpcError`-subclass fakes and is recorded here.

```sdd-batch-design-state
{
  "round": 2,
  "synth": {
    "approach": "This round keeps the D-1..D-5 mechanism unchanged. It adds three implementation pins and a fuller design.md record.\n\n1. **Helper.** `services/xstockstrat-analysis/app/handlers/servicer.py`, next to `_fetch_historical_fundamentals_paged` (`:6672`).\n   - Add `class _PositionsPageError(Exception)` beside `_BarFetchError` and `_FundamentalsPageError` (`:385-390`). It is not a `ValueError`.\n   - Add `async def _drain_positions_paged(stub, user_id, metadata) -> list`. It loops `for _ in range(_MAX_DRAIN_PAGES)` (`:347`) with `page_size=_BAR_PAGE_SIZE` (`:298`).\n   - **New pin: no double wrap.** The `try/except Exception as e: raise _PositionsPageError(...) from e` covers only the page body: the `await stub.ListPositions(...)`, `list(resp.positions)` and the `resp.page.next_page_token` read.\n   - The `next and next == sent` check runs after that `try`, so its error is not re-wrapped. So does the loop-exhaustion path, which logs a WARNING naming user_id and the cap of 50 pages, then raises.\n   - An empty token returns all rows. The helper never returns partial rows.\n\n2. **`live_loop._drain_held`** (`app/engine/live_loop.py:563-590`).\n   - Keep the `None` return at `:566` and `owner_metadata(owner)` before any RPC.\n   - Call the helper.\n   - On `except _PositionsPageError`, call `record_live_loop_drain_failure(\"held\")` and re-raise without logging (D-4).\n   - Return `{_normalize_symbol(p.symbol) for p in rows}`.\n   - Imports go in the existing block at `:41-50`.\n\n3. **`servicer._drain_held_symbols`** (`:6404-6437`).\n   - Keep the `None` return.\n   - Sum `abs(market_value)` per normalized symbol over the complete rows.\n   - No try/except.\n\n4. **Callers.**\n   - **Live-loop cycle** (`live_loop.py:391-411`):\n     - Add a `failed_owners: set[str]` next to `held_cache`, checked before the `try` with `if owner in failed_owners: continue`.\n     - Add `except _PositionsPageError` before `except ValueError` (`:409`). It logs one WARNING naming the first strategy and the owner, then adds the owner to the set (D-3).\n     - Later strategies of that owner are skipped without another log line. FR-4 requires only one WARNING per owner. design.md states this.\n   - **`ScreenSymbols`** (`:3935`): catch `_PositionsPageError`, log a WARNING, set `held = {}`, and still return the response.\n   - **No code change** at `_compute_opportunities` (`:5365`), `_kick_opportunity_recompute._run` (`:4945-4958`), `_opportunity_refresh_tick` (`:6055-6067`) or `entry_backfill.py:146-159`.\n\n5. **design.md \"Behaviour changes accepted under fail-closed\"** (record only, no code).\n   - **(a) Entry backfill, once at boot.** `entry_backfill.py:52-58` already documents a per-owner skip when a drain fails. What changes is the set of conditions that count as failure: a duplicate token, the cap, a non-gRPC page error, and an error on page 2 or later that used to return partial rows. A transient failure at boot therefore leaves that owner's `last_entry_at` unseeded until the process restarts. There is no retry; adding one would be a separate feature.\n   - **(b) Portfolio outage.** Every owner is skipped each cycle. The outage shows up as `drain_failures{source=held}` +1 per owner per cycle, plus one WARNING per owner.\n   - **(c) `ScreenSymbols`.** The request loses its held badges and is not aborted.\n   - **(d) New: daily opportunity refresh** (`servicer.py:6055-6067`).\n     - Today a portfolio `RpcError` yields a partial held map and a degraded ranking that counts as a success.\n     - After the fix, that user's refresh raises. The exception is caught per user at `:6061-6063` and counted only as a failed item in `_log_items_tick(OPPORTUNITY_REFRESH, ...)` (`:6067`).\n     - The pass still advances to the next refresh hour (`:6066`), so that user's queue stays stale until the next day.\n     - This path records no `recompute{outcome=failed}`.\n   - **Correct the FR-4/AC-5 counting wording** in product-spec.md and the AC text: \"the kick path (`_run`) counts `analysis.opportunity.recompute{outcome=failed}`; the daily refresh counts a failed item in its loop tick\". No new instrument is added; the Fix Scope rules that out.\n   - **Effective cap.** Portfolio clamps any `pageSize > 500` to 100 (`services/xstockstrat-portfolio/internal/repository/portfolio_repo.go:137-138`). The 1000 that is requested is ignored, so the real fail-closed bound is 50 × 100 = 5,000 positions per owner.\n   - **Duplicate tokens.** Portfolio pages with a strict keyset cursor (`portfolio_repo.go:166-167`), so a correct server cannot re-serve the token it was sent. The duplicate-token guard defends against a server defect or a fake. It is not an expected production path.\n\n6. **Red before green** (D-5, unchanged), plus one new spec obligation that comes **before** the RED run: sweep the existing fakes.\n   - **Sites to sweep:** the implementation spec lists each site that installs a bare `svc._portfolio = MagicMock()` or a shared truthy `next_page_token`:\n     - `tests/test_owner_header_guard.py:314`\n     - `tests/test_unreadable_formula.py:743`\n     - `tests/test_readiness_materializer.py:55`\n     - `tests/test_watchlist_readiness.py:35`\n     - `tests/test_analysis_servicer.py:4804,6509`\n     - `tests/conftest.py:103`\n   - **Per site,** the spec states whether its path reaches `_drain_held` or `_drain_held_symbols`. If it does, it states the expected new outcome: an owner skip or a `failed` recompute instead of a swallowed `TypeError`. It also says whether the fake needs an `AsyncMock` returning an empty token, so that no \"evaluated\" assertion silently flips.\n   - **Other test steps:**\n     - Write `tests/test_held_position_drains.py`. The AC-1/2/3 tests also run through the live-loop cycle. The AC-3/5/6 fakes raise `grpc.RpcError` subclasses, and the AC-7 o-1 strategies use explicit symbols.\n     - AC-5 runs in `tests/test_list_opportunities_deadlines.py`.\n     - Flip `test_ac16_failed_held_drain_counted_without_owner` (`tests/test_live_loop_telemetry.py:121-127`) to `pytest.raises(_PositionsPageError)`.\n     - Record the RED run on the base commit in context.md. Then implement, then run `uv run pytest --cov=app --cov-fail-under=40` over the full suite.\n\nThere is no proto, migration, config, pool or other-service change. Features 351, 353 and 354 are not touched.",
    "open_objections": [
      {
        "text": "O-1 stays open. The proposal recorded consequences (a) to (c) but missed (d): the daily opportunity refresh at `servicer.py:6055-6067` calls `_compute_opportunities` directly. After the fix, a portfolio failure there fails that user's refresh, which is counted only as a failed item in `_log_items_tick`. The pass still advances a full day, with no retry and no `recompute{outcome=failed}`. O-1 closes once design.md records all four consequences (a) to (d).",
        "blocking": false
      },
      {
        "text": "Record-only (C-11, P-03, `fails.md:3356-3358`). The FR-4/AC-5 claim in the product spec, that held-drain failures are counted by `analysis.opportunity.recompute{outcome=failed}`, is false on the daily-refresh path. Only `_kick_opportunity_recompute._run` records that metric (`servicer.py:4957`). Before approval, design.md must add consequence (d), and the product-spec FR-4/AC-5 wording must be corrected to: the kick path counts `recompute{failed}`, and the daily refresh counts a failed item in its loop tick. No new metric is added.",
        "blocking": true
      }
    ],
    "floor_breaches": [],
    "business_rule_changes": [
      {
        "ac_id": "@AC-16 @feature-294",
        "kind": "PRESERVE",
        "covered_by_operator_decision": true
      },
      {
        "ac_id": "@AC-8 @feature-262",
        "kind": "PRESERVE",
        "covered_by_operator_decision": true
      },
      {
        "ac_id": "@AC-3 @feature-262",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "@AC-6 @feature-191",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "@AC-6/@AC-7/@AC-10 @feature-185/@feature-289 (recompute failure path)",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "@AC-2 @feature-168, @AC-1/@AC-3 @feature-193 (held set assumed complete)",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "feature-097 daily opportunity refresh: one bad user never kills the pass (no @AC id located)",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "@AC-5 @feature-356 (counting wording corrected: kick path counts recompute{failed}, daily refresh counts a failed loop-tick item)",
        "kind": "EXTEND",
        "covered_by_operator_decision": true
      },
      {
        "ac_id": "@AC-1..@AC-9 @feature-356 (new fail-closed held-drain rules)",
        "kind": "EXTEND",
        "covered_by_operator_decision": true
      }
    ],
    "rejected_alternatives": [
      "Catch `_PositionsPageError` inside `_compute_opportunities` and fall back to an empty held map. Lost because held symbols would rank at 0.0 and the queue would look normal. That is the silent partial result `fails.md:3311-3312` forbids.",
      "Add a `recompute{failed}` (or new) metric on the daily-refresh path so FR-4's claim becomes true. Lost because the Fix Scope rules out new instruments. The spec wording is corrected instead.",
      "Request the server's honored page size (500 or less) so the 50-page cap covers 25k positions. Lost because it changes the request literal and is out of scope. It is noted as a follow-up next to the positions-paging module note.",
      "Mirror the backfill by collecting every skipped strategy id for the failed owner and naming them all in the WARNING. Lost because FR-4 requires only one WARNING per owner, and the extra code is not needed for that. design.md states that the WARNING names the first strategy only.",
      "Place the `next == sent` and cap checks inside the page-body `try`. Lost because the guard's own `_PositionsPageError` would be re-wrapped, giving misleading cause chains.",
      "Leave the check of existing fakes to the Step-4 full-suite run. Lost because a bare `MagicMock` portfolio's `TypeError` is now an owner skip instead of being swallowed. That can silently flip 'evaluated' or 'recompute ok' assertions, so the sweep must be a named spec obligation before RED.",
      "Add an alias constant or a comment for `_BAR_PAGE_SIZE` in the positions drain. Lost because an alias is a near-duplicate constant (DRY), a comment would describe mechanism (CLAUDE.md rule 5), and a rename touches the out-of-scope bar call sites."
    ],
    "open_risks": [
      "The effective fail-closed threshold is 5,000 positions per owner, not 50,000: portfolio clamps the requested 1000 to 100 (`portfolio_repo.go:137-138`). An owner above 5,000 positions is skipped every cycle (AC-2), with a WARNING and the metric.",
      "The daily refresh during a portfolio outage leaves the affected users' queues stale for about 24h, with no retry and no `recompute{failed}` signal. It is visible only as failed items in the refresh loop tick (`servicer.py:6066-6067`). This is accepted; it is recorded as (d).",
      "A transient `ListPositions` failure at boot leaves that owner's entry-backfill cooldown state unseeded until the process restarts. A portfolio outage skips every owner in the live loop each cycle. Both are accepted under the fail-closed rule.",
      "Existing tests with a bare `MagicMock` portfolio (`test_owner_header_guard.py:314`, `test_unreadable_formula.py:743`, `test_readiness_materializer.py:55`, `test_watchlist_readiness.py:35`, `test_analysis_servicer.py:4804,6509`, `conftest.py:103`) may now take the owner-skip or recompute-failed branch. The spec's per-site sweep must land before the RED run.",
      "The live-loop held drain now reads the servicer constants instead of `live_loop._DRAIN_PAGES` and `_DRAIN_PAGE_SIZE`. The values are equal today but could drift later. The sibling drains keep using the live_loop constants.",
      "Wrapping every page exception turns a programming error such as an `AttributeError` into an owner skip. The original exception is kept as `__cause__`.",
      "`next == sent` does not catch an A→B→A token cycle; the 50-page cap is the backstop. A real duplicate token is unlikely because portfolio uses a strict keyset cursor (`portfolio_repo.go:166-167`).",
      "After a `gather` at `servicer.py:5365` raises, the sibling drains are left running. This is existing behaviour and is left unchanged to avoid a conflict with feature 308.",
      "Vacuous-green risk (`fails.md:3350-3353`). The RED claims hold only with `RpcError`-subclass fakes and explicit-symbol AC-7 strategies. The RED run on the base commit must be recorded."
    ],
    "constitution_rules_touched": [
      "C-01",
      "C-03",
      "C-08",
      "C-11",
      "C-15",
      "C-16",
      "C-18",
      "P-03",
      "P-06",
      "F-07",
      "PLAT-4"
    ],
    "rationale": "The adversary found no Floor breach and no register violation, so the D-1..D-5 mechanism stands. This round only refines the record and pins how the work is carried out.\n\n**Claims I checked against the code**\n- **Daily refresh.** `servicer.py:6055-6067` calls `_compute_opportunities` per user. It catches `Exception`, counts the failure only through `_log_items_tick`, and advances the schedule regardless. `servicer.py:4957` (the kick path) is the only place that records `recompute{failed}`.\n- **Page-size clamp.** `portfolio_repo.go:137-138` clamps `pageSize > 500` to 100.\n- **Keyset cursor.** `portfolio_repo.go:166-167` uses a strict keyset cursor.\n\n**O-1**\n- O-1 cannot close: the proposal's answer covered three of the four consequences.\n- The missing one, the daily refresh, also makes the product spec's FR-4/AC-5 counting claim false on that path. That is the `fails.md:3356-3358` shape, so it is raised as a blocking but record-only objection.\n- The approach adopts the record, (d) plus the wording fix, without new code or instruments, per the Fix Scope.\n\n**O-2**\n- O-2 is closed. The placement and naming answer was concrete, and the adversary agreed to close it once the 5,000-position cap is on record, which the approach now does.\n\n**Adopted refinements (each cuts risk at no scope cost)**\n- **Non-blocking objection 3:** the equality and cap checks sit outside the wrapping `try`, so the guard's own error is not re-wrapped and cause chains stay clean.\n- **Objection 4:** the sweep of existing fakes becomes a named spec obligation before the RED run, which extends the vacuous-green ledger rule to fakes that now take a different branch.\n- **Objection 5:** resolved by recording rather than adding code, since FR-4 asks for only one WARNING per owner (CLAUDE.md rule 2).\n\n**Risk wording corrected**\n- A duplicate token from a correct server is unlikely.\n- The real cap is 5,000 positions.\n\n**Operator decisions**\n- Fail closed, reject a repeated token, and test with a fake that ignores the token: honoured.\n- `@AC-16 @feature-294` and `@AC-8 @feature-262` are preserved.\n- Red before green: honoured.\n- Features 351, 353 and 354 are untouched.",
    "register_delta": {
      "new_decisions": [
        {
          "text": "In `_drain_positions_paged`, the `try/except Exception -> raise _PositionsPageError from e` wraps only the page body (await, row collection, token read). The `next == sent` check and the cap-exhaustion WARNING-and-raise run outside that `try`, so the guard's own `_PositionsPageError` is never re-wrapped.",
          "evidence": "Adversary r2 objection 3. Without this, the error raised inside the `try` gets re-wrapped and the cause chains become misleading."
        },
        {
          "text": "design.md's 'Behaviour changes accepted under fail-closed' records consequence (d). The daily opportunity refresh now fails the affected user's refresh during a portfolio outage. That failure is counted only as a failed loop-tick item, records no `recompute{failed}`, and the queue stays stale until the next day's pass. The product-spec FR-4/AC-5 counting wording is corrected to say that the kick path counts `recompute{failed}` and the daily refresh counts a failed loop-tick item. No new instrument is added.",
          "evidence": "`servicer.py:6055-6067` (per-user catch, `_log_items_tick`, unconditional `schedule.advance`); `servicer.py:4957` is the only `record_opportunity_recompute(..., \"failed\")`; `fails.md:3356-3358`."
        },
        {
          "text": "design.md records that the effective fail-closed bound is 50 pages x 100 = 5,000 positions per owner, because portfolio clamps the requested 1000 to 100. It also records that a correct portfolio cannot re-serve the token it was sent (strict keyset cursor), so the duplicate-token guard defends against server defects and fakes.",
          "evidence": "`services/xstockstrat-portfolio/internal/repository/portfolio_repo.go:137-138` (clamp) and `:166-167` (keyset cursor `(symbol, trading_mode, account_id) > cursor`)."
        },
        {
          "text": "Before the RED run, the implementation spec sweeps every existing bare `MagicMock` portfolio and shared-truthy-token fake by name: `test_owner_header_guard.py:314`, `test_unreadable_formula.py:743`, `test_readiness_materializer.py:55`, `test_watchlist_readiness.py:35`, `test_analysis_servicer.py:4804,6509`, `conftest.py:103`. For each, it states whether its path reaches either held drain and what the expected new outcome is.",
          "evidence": "Adversary r2 objection 4: a non-awaitable `MagicMock().ListPositions` `TypeError` is swallowed today at `live_loop.py:582`, but under the fix it is wrapped and becomes an owner skip. Extends `fails.md:3350-3353`."
        },
        {
          "text": "The live-loop `failed_owners` pre-check skips the failed owner's later strategies without another log line. The single per-owner WARNING names the first strategy and the owner, and design.md states this.",
          "evidence": "Adversary r2 objection 5; FR-4 requires only one WARNING per owner; CLAUDE.md rule 2 (minimum code)."
        }
      ],
      "new_rejected": [
        {
          "text": "Catch `_PositionsPageError` in `_compute_opportunities` and fall back to an empty held map so the daily refresh still produces a queue.",
          "why": "Held symbols would rank at 0.0 and the queue would look normal, which is the silent partial result `fails.md:3311-3312` forbids."
        },
        {
          "text": "Add a `recompute{failed}` or other new metric on the daily-refresh path.",
          "why": "The Fix Scope rules out new instruments. The FR-4/AC-5 wording is corrected instead."
        },
        {
          "text": "Request the server's honoured page size (500 or less) so the cap covers 25k positions.",
          "why": "It changes the request literal and is out of scope for this fix. It is a follow-up only."
        }
      ],
      "new_objections": [
        {
          "text": "Record-only, blocking (C-11, P-03). design.md must add consequence (d), the daily opportunity refresh at `servicer.py:6055-6067`, and the product-spec FR-4/AC-5 wording must be corrected: only the kick path records `recompute{outcome=failed}` (`servicer.py:4957`), while the daily refresh counts a failed loop-tick item.",
          "blocking": true
        }
      ],
      "closed_objections": [
        {
          "id": "O-2",
          "how": "Accepted. The helper stays in `servicer.py`, following the paged-helper precedent (`servicer.py:6672`, `live_loop.py:41-50`). `_BAR_PAGE_SIZE` is already the positions page size at `servicer.py:6423`. There is no alias (DRY), no comment (rule 5) and no rename (out of scope). design.md records that portfolio clamps the size to 100 (`portfolio_repo.go:137-138`), so the effective cap is 5,000 positions. `app/services/positions_paging.py` is noted as a follow-up."
        }
      ],
      "reopen_petitions": [],
      "reopened": []
    }
  },
  "floor_breaches": []
}
```

## Session 2026-11-17 — sdd-batch design gate (round 3)

`/sdd-design fix-analysis-held-position-drains` (full) is halted at its approval gate after round 3 (gate policy: halt). design.md is not written and status.md is unchanged (still `spec-ready`). The debate register is `debate.md` (D-1..D-10, R-1..R-9, O-1..O-7, P-1..P-2).

## Open Threads

- **Approach.** No code change this round. The mechanism stays as D-1..D-4, D-6 and D-8..D-10 define it: the shared `_drain_positions_paged` and `_PositionsPageError` in `app/handlers/servicer.py`; a `try` that wraps only the page body, with the equality and cap checks outside it; the live-loop `failed_owners` set, handled before `except ValueError` (`live_loop.py:409`); the `ScreenSymbols` guard; the D-9 sweep of existing fakes; red before green. The remaining work is accurate record edits, corrected against the code: (1) design.md "Behaviour changes accepted under fail-closed" (a) cites `entry_backfill.py:52-58,142-159` and `:199-202`; (d) the daily refresh (`servicer.py:6055-6067`) logs a per-user WARNING, skips `_replace_and_stamp_compute_state`, still advances the schedule, records no `recompute{failed}`, and `_log_items_tick` (`servicer.py:377-382`) records no failed count — a partial failure writes a normal `loop tick ok`, and only an all-users failure leaves no tick record; (2) product-spec FR-4 counting sentence rewritten accordingly, and the `compute_failed` clause limited to cold reads (`servicer.py:4784-4795`; stored queues served stale, `:4798-4801`); (3) `@AC-5` When step narrowed to the on-demand recompute path, no new scenario; (4) the AC-5 harness moves from `tests/test_list_opportunities_deadlines.py` (kick mocked at `:98`) to `tests/test_analysis_tick_telemetry.py` (`_refresh_svc`) or `tests/test_opportunity_compute_state.py` (`_opp_svc`), restoring the real `_compute_opportunities`/`_drain_held_symbols`, with a page-1 `grpc.RpcError`-subclass `ListPositions` fake, seeded previous rows, and asserts that the replace is never awaited, `recompute{kind=full,outcome=failed}` == 1 and `recompute{outcome=ok}` == 0; (5) no new daily-refresh @AC — the spec names `test_opportunity_refresh.py:77` and `test_analysis_tick_telemetry.py:61+`. Items 1(d), 2 and 4 depend on the operator's verdict on P-1 (REOPEN D-7, wording only) and P-2 (REOPEN D-5, harness clause only); the substance of D-7 ("record, no new instrument") and D-5 ("RpcError-subclass fakes, real path") is kept. No proto, migration, config or other-service change; features 351, 353 and 354 untouched.
- **Strongest open objection — O-4 / O-3 (blocking, record accuracy; P-03, C-11).** D-7 and the proposed FR-4/(d) text say a daily-refresh failure is "counted as a failed loop-tick item". That is false: `_log_items_tick` (`servicer.py:377-382`) takes no failed count. O-3 and O-4 close only with the corrected FR-4 text above, which needs the operator's verdict on P-1. O-5 (blocking, C-15 vacuous green): the AC-5 harness named by D-5 never reaches `_run` (`servicer.py:4940-4960`); closes only with the corrected harness, which needs the verdict on P-2. Non-blocking: O-1 (records (a)–(d) accurately), O-6 (`compute_failed` cold-read only), O-7 (cite `entry_backfill.py:199-202`).
- **Floor status.** No Floor breaches in any of the three rounds.
- **Uncovered @AC changes (not covered by an operator decision).** EXTEND `@AC-5 @feature-356` (When step narrowed to the on-demand recompute path; needs sign-off at the gate). PRESERVE: `@AC-3 @feature-262`; `@AC-6 @feature-191`; `@AC-6/@AC-7/@AC-10 @feature-185/@feature-289` (`@AC-7` `compute_failed` stays cold-read-only); `@AC-2 @feature-168`, `@AC-1/@AC-3 @feature-193`; feature-097/158 daily-refresh per-user isolation and loop-tick record semantics (no `@AC` id located; `_log_items_tick` untouched). Covered by operator decision: PRESERVE `@AC-16 @feature-294`, `@AC-8 @feature-262`; EXTEND `@AC-1..@AC-9 @feature-356`.
- **Open risks carried to design.md.** A single-user daily-refresh held-drain failure gives no metric and a healthy-looking tick (one WARNING only; queue stale ~24h); an all-users failure shows only as a missing `opportunity_refresh` tick record; 5,000-position effective bound per owner (`portfolio_repo.go:137-138`); transient boot failure leaves entry-backfill state unseeded until restart (`entry_backfill.py:199-202`); D-9 fakes may flip branch (sweep before RED); AC-5 vacuous-green risk until P-2 is ruled on; `next == sent` misses an A→B→A cycle (50-page cap is the backstop); live-loop held drain reads the servicer page constants while sibling drains keep live_loop's.

```sdd-batch-design-state
{
  "round": 3,
  "synth": {
    "approach": "The code mechanism stays exactly as D-1..D-4, D-6 and D-8..D-10 define it: the shared `_drain_positions_paged` and `_PositionsPageError` in `services/xstockstrat-analysis/app/handlers/servicer.py`; a `try` that wraps only the page body, with the equality and cap checks outside it; the live-loop `failed_owners` set, whose handler comes before `except ValueError` (`live_loop.py:409`); the `ScreenSymbols` guard; the D-9 sweep of existing fakes; and red before green. This round changes no code. The remaining work is accurate record edits, which the orchestrator writes (P-01).\n\nThe proposer's text for those edits is corrected against the code, which I checked this round.\n\n**1. design.md, section \"Behaviour changes accepted under fail-closed\"**\n- **(a) Entry backfill.** Cite both `entry_backfill.py:52-58,142-159` (per-owner skip) and `:199-202` (the boot-time call site and the WARNING for skipped owners). A transient held-drain failure at boot leaves that owner's `last_entry_at` unseeded until the process restarts. There is no retry.\n- **(b) Portfolio outage.** Every owner is skipped in the live loop each cycle. Each skip records `drain_failures{source=held}` +1 and one WARNING per owner per cycle.\n- **(c) `ScreenSymbols`.** The response loses its held badges but the request is not aborted.\n- **(d) Daily opportunity refresh** (`servicer.py:6055-6067`). Use this corrected wording:\n  - `_compute_opportunities` raises for the affected user (`:6059`). The per-user `except Exception` catches it and logs `opportunity daily refresh failed for user=%s` (`:6061-6063`).\n  - `_replace_and_stamp_compute_state` (`:6060`) is skipped, so the previous queue stays and is stale until the next day's pass. The schedule still advances (`:6066`).\n  - `_log_items_tick` (`servicer.py:377-382`) records no failed-item count. When some users fail, it writes an ordinary `loop tick ok`, so a partial failure looks exactly like a healthy pass apart from the per-user WARNING. When every user fails, it writes no `loop tick ok` record for that pass.\n  - No `recompute{failed}` is recorded on this path.\n  - Accepted, not coded (R-5, R-6).\n\n**2. product-spec.md, FR-4, the `_compute_opportunities` bullet.** The counting sentence becomes:\n> \"On the on-demand recompute path (`_kick_opportunity_recompute._run`, `servicer.py:4940-4960`) the failure is counted by `analysis.opportunity.recompute{outcome=failed}`. On the daily refresh pass (`servicer.py:6055-6067`) it is logged as a per-user WARNING only. If every user fails, the pass writes no `loop tick ok` record; a partial failure is otherwise indistinguishable from a healthy pass in the tick record. The pass still advances to the next day. In both paths the user's previous queue is not replaced. No new metric instrument is added.\"\n\nThe `compute_failed` clause becomes:\n> \"On a cold read (no stored queue), repeated kick-path failures surface `compute_failed` (feature 185 @AC-7, `servicer.py:4784-4795`). A user with a stored queue keeps being served the stale rows (`:4798-4801`).\"\n\n**3. acceptance.feature, @AC-5.** The When step is narrowed to `When the opportunity queue for \"u-1\" is recomputed through the on-demand recompute path`. Both Then steps stay. No new scenario is added.\n\n**4. AC-5 test harness.** This is a correction to D-5's harness clause and is pending the operator's verdict on the REOPEN.\n- D-5 names `tests/test_list_opportunities_deadlines.py`. That file replaces `_kick_opportunity_recompute` with a `MagicMock` (`:98`), so a test there can never reach `_run`.\n- The spec should instead use `tests/test_analysis_tick_telemetry.py`, following the `_refresh_svc` and `test_ac51_failed_full_recompute_counted_with_traceback` pattern (`:44-50`, `:174-184`). Alternatively it can use `tests/test_opportunity_compute_state.py` (`_opp_svc`, `:45-53`; the real kick at `:118`).\n- Both helpers stub `_compute_opportunities` with an `AsyncMock` by default (`:48` and `:52`). The AC-5 test must therefore restore the real bound `_compute_opportunities`, or at least the real `_drain_held_symbols` inside it, and set `ListPositions` to raise a `grpc.RpcError` subclass on page 1.\n- It must seed the previous rows and assert:\n  - `replace_for_user` and `_replace_and_stamp_compute_state` are never awaited;\n  - `recompute{kind=full,outcome=failed}` == 1;\n  - `recompute{outcome=ok}` == 0.\n\n**5. Daily-refresh behaviour.** No new @AC is added. The spec names by test the existing per-user isolation coverage, `tests/test_opportunity_refresh.py:77` (an `AsyncMock` with `side_effect=RuntimeError`), and the tick-record tests in `test_analysis_tick_telemetry.py:61+`. These show that (d)'s corrected wording describes behaviour that is already tested.\n\nItems 1(d), 2 and 4 depend on the operator ruling on the adversary's REOPEN D-7 (wording only) and REOPEN D-5 (harness clause only) petitions. The underlying decisions are kept: D-7 still means \"record, no new instrument\" and D-5 still means \"RpcError-subclass fakes, real path\".\n\nThere is no proto, migration, config or other-service change. Features 351, 353 and 354 are not touched.",
    "open_objections": [
      {
        "text": "O-1 stays open until design.md records (a) to (d) with accurate wording. Three things are needed: (a) cites `entry_backfill.py:199-202` as well as `:52-58,142-159`; (d) states the real signal from `_log_items_tick` (`servicer.py:377-382`), which is a per-user WARNING only, with a missing `loop tick ok` record only when every user fails; and the 'failed-item count' claim is removed.",
        "blocking": false
      },
      {
        "text": "O-3 stays open. The proposed FR-4 and (d) text claim that a daily-refresh failure is 'counted as a failed item in that pass's loop tick'. That is false: `_log_items_tick` (`servicer.py:377-382`) emits no failed count, writes a normal `loop tick ok` on partial failure, and writes nothing when every user fails. O-3 closes only when the corrected FR-4 replacement text in the approach is used, which also requires the operator's verdict on REOPEN D-7, since D-7's own wording repeats the false claim.",
        "blocking": true
      },
      {
        "text": "The AC-5 harness named by D-5 is vacuous (`fails.md:3350-3353`). `tests/test_list_opportunities_deadlines.py:98` replaces `_kick_opportunity_recompute` with a `MagicMock`, so `_run` (`servicer.py:4940-4960`) is never reached. The spec must instead name `tests/test_analysis_tick_telemetry.py` (`_refresh_svc`, `:44-50`, `:174-184`) or `tests/test_opportunity_compute_state.py` (`_opp_svc`, `:45-53`, `:118`). Both stub `_compute_opportunities` by default, so the test must restore the real method or the real `_drain_held_symbols`, use a page-1 `grpc.RpcError`-subclass `ListPositions` fake, seed the previous rows, and assert that the replace is never awaited. This needs the operator's verdict on REOPEN D-5 (harness clause).",
        "blocking": true
      },
      {
        "text": "The kept FR-4 clause 'Repeated failures surface `compute_failed`' is too broad. `compute_failed` is set only in the `n == 0` cold-read branch (`servicer.py:4784-4795`). A user with a stored queue (AC-5's own precondition) is served stale rows (`:4798-4801`) and only `recompute{failed}` fires. The clause must be limited to cold reads.",
        "blocking": false
      }
    ],
    "floor_breaches": [],
    "business_rule_changes": [
      {
        "ac_id": "@AC-16 @feature-294",
        "kind": "PRESERVE",
        "covered_by_operator_decision": true
      },
      {
        "ac_id": "@AC-8 @feature-262",
        "kind": "PRESERVE",
        "covered_by_operator_decision": true
      },
      {
        "ac_id": "@AC-3 @feature-262",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "@AC-6 @feature-191",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "@AC-6/@AC-7/@AC-10 @feature-185/@feature-289 (recompute failure path; @AC-7 compute_failed stays cold-read-only)",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "@AC-2 @feature-168, @AC-1/@AC-3 @feature-193 (held set assumed complete)",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "feature-097/158 daily opportunity refresh per-user isolation and loop-tick record semantics (no @AC id located; `_log_items_tick` untouched)",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "@AC-5 @feature-356 (When step narrowed to the on-demand recompute path; the daily-refresh signal is a per-user WARNING, not a counted tick item)",
        "kind": "EXTEND",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "@AC-1..@AC-9 @feature-356 (new fail-closed held-drain rules)",
        "kind": "EXTEND",
        "covered_by_operator_decision": true
      }
    ],
    "rejected_alternatives": [
      "Catch `_PositionsPageError` in `_compute_opportunities` and fall back to an empty held map. Lost because held symbols would rank at 0.0 in a normal-looking queue, which is the silent partial result `fails.md:3311-3312` forbids (R-5).",
      "Add `recompute{failed}` or a new metric on the daily-refresh path. Lost because the Fix Scope rules out new instruments (R-6).",
      "Request the server's honoured page size (500 or less). Lost because it is out of scope; follow-up only (R-7).",
      "Describe the daily-refresh failure as 'counted as a failed loop-tick item'. Lost because it is false: `_log_items_tick` (`servicer.py:377-382`) emits no failed count.",
      "Run the AC-5 test in `tests/test_list_opportunities_deadlines.py`. Lost because that file mocks `_kick_opportunity_recompute` (`:98`), so `_run` is never reached and the test would be vacuous (`fails.md:3350-3353`).",
      "Run the AC-5 test with `_refresh_svc` or `_opp_svc` as-is. Lost because both stub `_compute_opportunities` with an `AsyncMock`, so the held drain is never exercised.",
      "Add a new daily-refresh @AC asserting the WARNING and the missing tick record. Lost because it is extra test scope (CLAUDE.md rule 2). Existing per-user isolation and tick-record tests (`test_opportunity_refresh.py:77`, `test_analysis_tick_telemetry.py:61+`) are named in the spec instead.",
      "Keep @AC-5's When step un-narrowed and test both paths. Lost because the daily path records no `recompute{failed}`, so the Then step would be false there."
    ],
    "open_risks": [
      "A single-user held-drain failure during the daily refresh gives no metric and no tick signal. The tick record looks healthy (`servicer.py:377-382`), and only one WARNING per user marks it. That user's queue stays stale for about 24h. Operators who watch only `recompute{failed}` or loop-tick presence will miss it until the next kick-path read. This is accepted under fail-closed, R-5 and R-6.",
      "If every user fails during a portfolio outage at the refresh hour, the only aggregate signal is a missing `opportunity_refresh` `loop tick ok` record, and all queues stay stale for about 24h.",
      "The effective fail-closed bound is 5,000 positions per owner (portfolio clamps the page size to 100, `portfolio_repo.go:137-138`). An owner above that is skipped every cycle.",
      "A transient boot-time held-drain failure leaves entry-backfill cooldown state unseeded until restart (`entry_backfill.py:199-202`). A portfolio outage skips every owner in the live loop each cycle.",
      "Existing bare `MagicMock` portfolio fakes (the D-9 list) may now take the owner-skip or recompute-failed branch. The sweep must land before RED.",
      "Vacuous-green risk on AC-5 until REOPEN D-5 is ruled on: the register still names a harness that mocks the kick. If the operator declines the petition, AC-5 cannot be proven red.",
      "`next == sent` misses an A to B to A token cycle; the 50-page cap is the backstop. Wrapping every page exception turns programming errors into owner skips, with `__cause__` preserved.",
      "The live-loop held drain now reads the servicer page constants, while the sibling drains keep the live_loop constants. The values are equal today but could drift."
    ],
    "constitution_rules_touched": [
      "C-01",
      "C-03",
      "C-08",
      "C-11",
      "C-15",
      "C-16",
      "C-18",
      "P-01",
      "P-02",
      "P-03",
      "P-06",
      "F-07",
      "PLAT-4"
    ],
    "rationale": "I checked the adversary's claims against the code this round, and all of them hold.\n\n**What the code shows**\n- **`_log_items_tick`** (`servicer.py:377-382`) returns early when `failed == total` and otherwise logs a plain tick. It takes no failed count.\n- **`test_list_opportunities_deadlines.py:98`** replaces `_kick_opportunity_recompute` with a `MagicMock`.\n- **The two alternative helpers**, `_refresh_svc` in `test_analysis_tick_telemetry.py:44-50` and `_opp_svc` in `test_opportunity_compute_state.py:45-53`, both stub `_compute_opportunities` with an `AsyncMock`. So they work for AC-5 only if the real method is restored.\n- **`compute_failed`** is set only in the `n == 0` branch (`servicer.py:4784-4795`). Stored queues are served stale (`:4798-4801`).\n- **`entry_backfill.py:199-202`** holds the per-owner skip WARNING after the pass.\n\n**Effect on the proposal**\n- Its no-code, record-only direction is right, and no Floor breach or register violation was found.\n- Two of the facts it would write down are false (the loop-tick count and the broad `compute_failed` clause), and its named AC-5 harness is vacuous.\n- An objection the proposal does not concretely answer stays open. O-1 and O-3 therefore remain open. Closing them on the proposed text would record a false observability claim, the `fails.md:3356-3358` shape.\n- The two blocking adversary objections become new O entries.\n\n**Register handling**\n- D-7's wording ('counted only as a failed loop-tick item') and D-5's harness clause both rest on facts now shown to be wrong. The adversary filed REOPEN petitions on each, with new evidence not already on record.\n- Only the operator can reopen, so these are recorded as pending petitions, not new decisions. `reopened` is empty.\n- The approach keeps the substance of both decisions: D-7 still means 'record, no new instrument', and D-5 still means 'RpcError fakes, real path'. It marks the corrected wording and harness as contingent on the operator's verdict.\n\n**Operator decisions:** all honoured.\n- Fail closed, reject a repeated token, and test with a fake that ignores the token.\n- `@AC-16 @feature-294` and `@AC-8 @feature-262` are preserved.\n- Red before green.\n- Features 351, 353 and 354 are untouched.\n\n**Covered by operator decision.** The @AC-5 wording narrowing is marked as not covered by an operator decision: no operator steer sanctions it explicitly, so it needs sign-off at the approval gate.",
    "register_delta": {
      "new_decisions": [],
      "new_rejected": [
        {
          "text": "Describe the daily-refresh held-drain failure as counted in the loop tick (a 'failed loop-tick item' or 'failed-item count').",
          "why": "`_log_items_tick` (`servicer.py:377-382`) emits no failed count. It writes a normal `loop tick ok` on partial failure and no record only when every user fails."
        },
        {
          "text": "Run the AC-5 test against a harness whose kick (`test_list_opportunities_deadlines.py:98`) or `_compute_opportunities` (`test_analysis_tick_telemetry.py:48`, `test_opportunity_compute_state.py:52`) is mocked.",
          "why": "The held drain and `_run` are never exercised, which makes the test vacuous (`fails.md:3350-3353`)."
        }
      ],
      "new_objections": [
        {
          "text": "Blocking (P-03, C-11). The FR-4 and design.md (d) text must not say that a daily-refresh failure is 'counted as a failed item in the loop tick'. `_log_items_tick` (`servicer.py:377-382`) records no failed count. The accurate signal is a per-user WARNING (`:6063`), plus a missing `loop tick ok` record only when every user fails; a partial failure is indistinguishable from a healthy pass. The 'Strongest risk' paragraph must drop the failed-item-count signal.",
          "blocking": true
        },
        {
          "text": "Blocking (C-15, vacuous green). The AC-5 harness named in D-5, `tests/test_list_opportunities_deadlines.py`, mocks `_kick_opportunity_recompute` (`:98`). The spec must use `test_analysis_tick_telemetry.py` (`:44-50`, `:174-184`) or `test_opportunity_compute_state.py` (`:45-53`, `:118`), restore the real `_compute_opportunities` or `_drain_held_symbols`, use a page-1 `grpc.RpcError`-subclass `ListPositions` fake, seed the previous rows, and assert that the replace is never awaited.",
          "blocking": true
        },
        {
          "text": "Non-blocking (P-03). Limit the FR-4 'Repeated failures surface `compute_failed`' clause to cold reads. `compute_failed` is set only when `n == 0` (`servicer.py:4784-4795`), and stored queues are served stale (`:4798-4801`).",
          "blocking": false
        },
        {
          "text": "Non-blocking (record accuracy). Consequence (a) must cite `entry_backfill.py:199-202` as well as `:52-58,142-159`, so the boot-only, no-retry claim has its evidence.",
          "blocking": false
        }
      ],
      "closed_objections": [],
      "reopen_petitions": [
        {
          "target": "D-7",
          "evidence": "Adversary r3, wording only. `servicer.py:377-382`: `_log_items_tick` records no failed-item count; it writes a normal tick on partial failure and no tick when every user fails. D-7's evidence cited only `:6055-6067`. Requested change: replace 'counted only as a failed loop-tick item' with 'logged as a per-user WARNING; the tick record is missing only when every user fails'. 'Record, no new instrument' stays.",
          "is_new": true
        },
        {
          "target": "D-5",
          "evidence": "Adversary r3, AC-5 harness clause only. `tests/test_list_opportunities_deadlines.py:98` replaces `_kick_opportunity_recompute` with a `MagicMock`, so `_run` (`servicer.py:4940-4960`) is unreachable. The alternatives `test_analysis_tick_telemetry.py:44-50` and `test_opportunity_compute_state.py:45-53` stub `_compute_opportunities`, so the real method must be restored. Not on record because D-5 named the file without checking its fixtures.",
          "is_new": true
        }
      ],
      "reopened": []
    }
  },
  "floor_breaches": []
}
```
