# Debate Register: fix-analysis-held-position-drains

**State**: in-debate
**Mode**: full
**Rounds run**: 2 (round numbers continue across runs; the mode's 2–5 / 1 bounds count this run only)

## Rounds

| Round | Date | Run by | +D | +R | O closed | +O | Petitions | Progress |
|---|---|---|---|---|---|---|---|---|
| 1 | 2026-11-17 | /sdd-batch | 5 | 4 | 0 | 2 | 0 | yes |
| 2 | 2026-11-17 | /sdd-batch | 5 | 3 | 1 | 1 | 0 | yes |

## Settled Decisions

<!-- Status: settled → superseded by D-m (only after a user-approved REOPEN) -->
| ID | Round | Decision | Evidence | Status |
|---|---|---|---|---|
| D-1 | 1 | Use one shared `_drain_positions_paged(stub, user_id, metadata) -> list` helper in `app/handlers/servicer.py`, next to `_fetch_historical_fundamentals_paged`. `live_loop._drain_held` (set reducer) and `servicer._drain_held_symbols` (summed market-value reducer) both call it. Do not harden each drain in place. This resolves the operator-delegated fork. | Identical loop bodies at `live_loop.py:571-589` and `servicer.py:6417-6436`. Precedent: `live_loop.py:41-42` imports `servicer._fetch_historical_fundamentals_paged` (`servicer.py:6672-6703`). The adversary accepted the shared helper as the better call. | settled |
| D-2 | 1 | All three held-drain failure paths raise `_PositionsPageError(Exception)`, which is not a `ValueError`: (a) any exception in the whole page body (await, row collection, token read), wrapped `from e`; (b) a non-empty `next_page_token` equal to the token sent; (c) cap exhaustion with a token pending, after a WARNING naming the user and cap 50. The helper never returns partial rows. | Adversary objections 1 and 2. The `except ValueError` owner-skip at `live_loop.py:409`. The `run_forever` catch-all at `live_loop.py:351-352` would otherwise abort every owner. `fails.md:3311`. | settled |
| D-3 | 1 | The live-loop cycle catches `except _PositionsPageError` before `except ValueError`. It adds the owner to a per-cycle `failed_owners` set and skips that owner's later strategies without draining again. It does not broaden to `except Exception`. | `entry_backfill.py:142-159` short-circuit pattern. FR-4 says drained at most once per cycle. A broad catch would alter the out-of-scope `_drain_watchlist` and `_drain_owner_signals` handling. | settled |
| D-4 | 1 | `_drain_held` records `record_live_loop_drain_failure("held")` and re-raises without logging. The caller logs the owner-level WARNING and the helper logs the cap WARNING. | Adversary objection 8. Keeps `@AC-16 @feature-294` (`live_loop.py:584`) without double-counting. | settled |
| D-5 | 1 | RED fakes that target `_drain_held_symbols` and its callers (AC-3/5/6) raise a `grpc.RpcError` subclass; only AC-4 uses a non-gRPC exception. The AC-7 fixture gives the o-1 strategies explicit symbols. AC-5 uses the recompute harness `tests/test_list_opportunities_deadlines.py`. AC-1/2/3 are also exercised through the live-loop cycle. | Adversary objections 3 and 4. `servicer.py:6428` catches only `RpcError`. `fails.md:3350-3353` (vacuous green). | settled |
| D-6 | 2 | In `_drain_positions_paged`, the `try/except Exception -> raise _PositionsPageError from e` wraps only the page body (await, row collection, token read). The `next == sent` check and the cap-exhaustion WARNING-and-raise run outside that `try`, so the guard's own `_PositionsPageError` is never re-wrapped. | Adversary r2 objection 3. Without this, the error raised inside the `try` gets re-wrapped and the cause chains become misleading. | settled |
| D-7 | 2 | design.md's 'Behaviour changes accepted under fail-closed' records consequence (d). The daily opportunity refresh now fails the affected user's refresh during a portfolio outage. That failure is counted only as a failed loop-tick item, records no `recompute{failed}`, and the queue stays stale until the next day's pass. The product-spec FR-4/AC-5 counting wording is corrected to say that the kick path counts `recompute{failed}` and the daily refresh counts a failed loop-tick item. No new instrument is added. | `servicer.py:6055-6067` (per-user catch, `_log_items_tick`, unconditional `schedule.advance`); `servicer.py:4957` is the only `record_opportunity_recompute(..., "failed")`; `fails.md:3356-3358`. | settled |
| D-8 | 2 | design.md records that the effective fail-closed bound is 50 pages x 100 = 5,000 positions per owner, because portfolio clamps the requested 1000 to 100. It also records that a correct portfolio cannot re-serve the token it was sent (strict keyset cursor), so the duplicate-token guard defends against server defects and fakes. | `services/xstockstrat-portfolio/internal/repository/portfolio_repo.go:137-138` (clamp) and `:166-167` (keyset cursor `(symbol, trading_mode, account_id) > cursor`). | settled |
| D-9 | 2 | Before the RED run, the implementation spec sweeps every existing bare `MagicMock` portfolio and shared-truthy-token fake by name: `test_owner_header_guard.py:314`, `test_unreadable_formula.py:743`, `test_readiness_materializer.py:55`, `test_watchlist_readiness.py:35`, `test_analysis_servicer.py:4804,6509`, `conftest.py:103`. For each, it states whether its path reaches either held drain and what the expected new outcome is. | Adversary r2 objection 4: a non-awaitable `MagicMock().ListPositions` `TypeError` is swallowed today at `live_loop.py:582`, but under the fix it is wrapped and becomes an owner skip. Extends `fails.md:3350-3353`. | settled |
| D-10 | 2 | The live-loop `failed_owners` pre-check skips the failed owner's later strategies without another log line. The single per-owner WARNING names the first strategy and the owner, and design.md states this. | Adversary r2 objection 5; FR-4 requires only one WARNING per owner; CLAUDE.md rule 2 (minimum code). | settled |

## Rejected Alternatives (locked)

<!-- Status: locked → reopened @ round N (user, context.md <ISO>) -->
| ID | Round | Alternative | Why rejected | Status |
|---|---|---|---|---|
| R-1 | 1 | Harden `_drain_held` and `_drain_held_symbols` in place, each with its own copy of the token guard. | The token rule and every RED fake would be duplicated (DRY guard rail) across identical loop bodies. | locked |
| R-2 | 1 | Broaden the live-loop cycle handler to `except Exception` for held-drain failures. | Not needed once all failure paths are typed and the whole page body is wrapped. It would also change failure handling for the out-of-scope watchlist and signal drains. | locked |
| R-3 | 1 | Wrap only the `ListPositions` await in the helper. | Errors while reading the response would escape unwrapped and abort the whole cycle or the ScreenSymbols RPC. | locked |
| R-4 | 1 | Add `max_pages`/`page_size` parameters to the shared helper. | YAGNI: no test patches the drain-page constants (adversary grep). | locked |
| R-5 | 2 | Catch `_PositionsPageError` in `_compute_opportunities` and fall back to an empty held map so the daily refresh still produces a queue. | Held symbols would rank at 0.0 and the queue would look normal, which is the silent partial result `fails.md:3311-3312` forbids. | locked |
| R-6 | 2 | Add a `recompute{failed}` or other new metric on the daily-refresh path. | The Fix Scope rules out new instruments. The FR-4/AC-5 wording is corrected instead. | locked |
| R-7 | 2 | Request the server's honoured page size (500 or less) so the cap covers 25k positions. | It changes the request literal and is out of scope for this fix. It is a follow-up only. | locked |

## Objections

<!-- Status: open → closed @ round N (<how>) | waived @ round N (user) | reopened @ round N (user) -->
| ID | Round | Objection | Blocking | Status |
|---|---|---|---|---|
| O-1 | 1 | Record as accepted consequences, not 'no change': (1) a transient boot-time held-drain failure skips that owner's entry backfill for the life of the process, with no retry (`entry_backfill.py:52-58,199-202`); (2) a portfolio outage skips every owner in the live loop each cycle. | no | open |
| O-2 | 1 | Helper placement in the ~6.7k-line handler module, the extra private cross-layer import, and the misleading `_BAR_PAGE_SIZE` name used for positions (C-18). | no | closed @ round 2 (Accepted. The helper stays in `servicer.py`, following the paged-helper precedent (`servicer.py:6672`, `live_loop.py:41-50`). `_BAR_PAGE_SIZE` is already the positions page size at `servicer.py:6423`. There is no alias (DRY), no comment (rule 5) and no rename (out of scope). design.md records that portfolio clamps the size to 100 (`portfolio_repo.go:137-138`), so the effective cap is 5,000 positions. `app/services/positions_paging.py` is noted as a follow-up.) |
| O-3 | 2 | Record-only, blocking (C-11, P-03). design.md must add consequence (d), the daily opportunity refresh at `servicer.py:6055-6067`, and the product-spec FR-4/AC-5 wording must be corrected: only the kick path records `recompute{outcome=failed}` (`servicer.py:4957`), while the daily refresh counts a failed loop-tick item. | yes | open |

## Reopen Petitions

<!-- Verdict: dropped (evidence not new — already on record at <ID>) | pending user | user reopened | user declined -->
| ID | Round | Target | New evidence | Verdict |
|---|---|---|---|---|
