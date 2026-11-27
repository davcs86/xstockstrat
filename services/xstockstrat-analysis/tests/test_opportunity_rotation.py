"""Feature 366 — live-only rotation across computes (acceptance.feature @AC-1..@AC-12).

Drives the real ``_compute_opportunities`` through the kick-recompute path (the production caller)
over the shared feature-097 harness; only the inputs (signals, held, deny lists, config) change.
"""

import asyncio
import logging
from datetime import UTC, datetime, timedelta
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from gen.analysis.v1 import analysis_pb2
from gen.common.v1 import common_pb2

from app.handlers import servicer
from tests import test_telemetry
from tests.test_analysis_servicer import (
    _FIRING_BARS,
    _GT_100,
    _HEADERS,
    _ctx,
    _materialized_svc,
    _sig,
    _StampedComputeState,
    _strat_row,
    _unavailable_served_row,
    _wl,
)
from tests.test_live_loop_telemetry import metric_sum

_UID = "u1"
_META = [("x-user-id", _UID)]
_SQUEEZE = "squeeze_breakout_trend"
_BLEND = "fundamentals_macd_blend"
_DIP = "dip_buyer_vol_stop"
_LIVE = (_SQUEEZE, _BLEND)
_LT_100 = {"fn": "<", "lhs": "sma", "rhs": 100.0}  # never fires on _FIRING_BARS
# Sorted: AAPL, MSFT, NVDA, T00..T41 — chunks of 20 end at pool[19], pool[39], then wrap.
POOL = sorted(["AAPL", "MSFT", "NVDA"] + [f"T{i:02d}" for i in range(42)])
_SHORTFALL = "opportunity live-only rotation shortfall"
_REISSUE = "analysis.opportunity.read_reissue"

metric_reader = test_telemetry.metric_reader


def _live_strats(symbols, ids=_LIVE, denied=None):
    denied = denied or {}
    return [
        _strat_row(
            sid,
            entry=_GT_100,
            exit_=_LT_100,
            symbols=list(symbols),
            created_at=datetime(2024, 1, 1, tzinfo=UTC) + timedelta(days=i),
            denied=denied.get(sid),
        )
        for i, sid in enumerate(ids)
    ]


def _signals(symbols, direction="buy"):
    return [_sig(s, direction, 0.5 + i / 1000, source="uw") for i, s in enumerate(symbols)]


def _rotation_svc(
    pool=POOL,
    *,
    covered=None,
    watch=True,
    held=(),
    live_ids=_LIVE,
    cycle_days=None,
    state=None,
):
    """The Background: every pool symbol has a buy signal, is watchlist-bound to dip_buyer_vol_stop
    and covered by the live strategies. The blend id is pointed elsewhere so fundamentals_macd_blend
    is an ordinary live strategy here (the feature-168 force-run is not under test)."""
    covered = list(covered or pool)
    live = _live_strats(covered, live_ids)
    strategies = {r["strategy_id"]: r for r in live}
    strategies[_DIP] = _strat_row(_DIP, entry=_GT_100, exit_=_LT_100)
    svc = _materialized_svc(
        signals=_signals(pool),
        held=held,
        watchlists=[_wl(bindings=[(s, _DIP) for s in pool])] if watch else [],
        strategies=strategies,
        bars={s: _FIRING_BARS for s in covered},
        live_strategies=live,
    )
    overrides = {}
    if cycle_days is not None:
        overrides["opportunity.live_only_cycle_max_days"] = cycle_days
    _set_ints(svc, overrides)
    svc._cfg.get_str = MagicMock(
        side_effect=lambda key, default="": (
            "unused_blend_id" if key == "engine.fundamentals_blend_strategy_id" else default
        )
    )
    svc._opportunity_compute_state_repo = state or _StampedComputeState(
        datetime.now(UTC) - timedelta(days=1)
    )
    return svc


def _set_ints(svc, overrides):
    svc._cfg.get_int = MagicMock(side_effect=lambda key, default=0: overrides.get(key, default))


def _set_signals(svc, signals):
    svc._ingest.QuerySignals = AsyncMock(
        return_value=SimpleNamespace(
            signals=list(signals), page=SimpleNamespace(next_page_token="")
        )
    )


async def _compute(svc, *, expect_ok=True):
    """One full recompute through the production kick path; returns the stored rows."""
    svc._kick_opportunity_recompute(_UID, _META)
    for _ in range(30000):
        if _UID not in svc._opportunity_recomputing:
            break
        await asyncio.sleep(0.001)
    assert _UID not in svc._opportunity_recomputing
    if expect_ok:
        assert _UID not in svc._opportunity_compute_failures
    return svc._opportunities_repo.rows.get(_UID, [])


def _rows(svc, symbol=None, strategy=None):
    return [
        r
        for r in svc._opportunities_repo.rows.get(_UID, [])
        if (symbol is None or r["symbol"] == symbol)
        and (strategy is None or r["strategy_id"] == strategy)
    ]


def _symbols_with(svc, strategy):
    return {r["symbol"] for r in _rows(svc, strategy=strategy)}


def _cursor(svc):
    return svc._opportunity_compute_state_repo._row.get("live_only_cursor")


def _assert_every_pool_symbol_has_a_row(svc, pool):
    stored = {r["symbol"] for r in _rows(svc)}
    assert set(pool) <= stored  # invariant O-10


# ── pure helpers ────────────────────────────────────────────────────────────────


def test_rotation_chunk_empty_pool_keeps_cursor():
    assert servicer._rotation_chunk([], "AAPL", 20) == ([], "AAPL")
    assert servicer._rotation_chunk([], None, 20) == ([], None)


def test_rotation_chunk_first_resume_and_wrap():
    chunk1, c1 = servicer._rotation_chunk(POOL, None, 20)
    assert chunk1 == POOL[:20] and c1 == POOL[19]
    chunk2, c2 = servicer._rotation_chunk(POOL, c1, 20)
    assert chunk2 == POOL[20:40] and c2 == POOL[39]
    chunk3, c3 = servicer._rotation_chunk(POOL, c2, 20)
    assert chunk3 == POOL[40:] + POOL[:15] and c3 == POOL[14]


def test_rotation_chunk_cursor_past_end_wraps_to_start():
    chunk, cursor = servicer._rotation_chunk(POOL, "ZZZZ", 20)
    assert chunk == POOL[:20] and cursor == POOL[19]


def test_rotation_chunk_removed_cursor_resumes_after_its_position():
    pool = [s for s in POOL if s != POOL[19]]
    chunk, _ = servicer._rotation_chunk(pool, POOL[19], 20)
    assert chunk[0] == POOL[20]


def test_rotation_chunk_small_pool_is_whole_pool_once():
    chunk, cursor = servicer._rotation_chunk(["A", "B", "C"], "B", 20)
    assert chunk == ["C", "A", "B"] and cursor == "B"


def test_carry_within_cycle_boundary_is_exclusive():
    now = datetime(2026, 11, 26, 5, tzinfo=UTC)
    future = now + timedelta(hours=1)
    assert (
        servicer._carry_within_cycle(future, now - timedelta(days=3), now, 3) is False
    )  # @AC-12 >=
    assert servicer._carry_within_cycle(
        future, now - timedelta(days=3) + timedelta(microseconds=1), now, 3
    )
    assert servicer._carry_within_cycle(now, now - timedelta(hours=1), now, 3) is False  # expired


# ── behaviour ───────────────────────────────────────────────────────────────────


async def test_ac1_one_compute_evaluates_one_chunk():
    """@AC-1: one compute gives exactly 20 symbols rows for each live strategy."""
    svc = _rotation_svc()
    await _compute(svc)
    assert _symbols_with(svc, _SQUEEZE) == set(POOL[:20])
    assert _symbols_with(svc, _BLEND) == set(POOL[:20])
    assert _cursor(svc) == POOL[19]
    _assert_every_pool_symbol_has_a_row(svc, POOL)


async def test_ac2_ac10_three_computes_cover_the_pool_within_the_cycle(caplog):
    """@AC-2 / @AC-10: three computes cover all 45 symbols; no compute evaluates more than 20 and
    ceil(45/20)=3 is not over the 3-day cycle, so no shortfall is logged."""
    svc = _rotation_svc()
    with caplog.at_level(logging.INFO, logger="app.handlers.servicer"):
        for _ in range(3):
            before = datetime.now(UTC)
            await _compute(svc)
            fresh = {
                r["symbol"] for r in _rows(svc, strategy=_SQUEEZE) if r["computed_at"] > before
            }
            assert len(fresh) <= 20
            _assert_every_pool_symbol_has_a_row(svc, POOL)
    assert _symbols_with(svc, _SQUEEZE) == set(POOL)
    assert _symbols_with(svc, _BLEND) == set(POOL)
    assert not [r for r in caplog.records if _SHORTFALL in r.getMessage()]


async def test_ac3_earlier_chunk_row_keeps_its_own_stamps():
    """@AC-3: AAPL's first-compute row keeps valid_until and computed_at after a compute in which
    AAPL is not in the chunk; fresh live-only rows are stamped now + cycle days."""
    svc = _rotation_svc()
    before = datetime.now(UTC)
    await _compute(svc)
    (first,) = _rows(svc, "AAPL", _SQUEEZE)
    assert (
        before + timedelta(days=3) <= first["valid_until"] <= datetime.now(UTC) + timedelta(days=3)
    )
    await _compute(svc)
    assert "AAPL" not in POOL[20:40]
    (second,) = _rows(svc, "AAPL", _SQUEEZE)
    assert second["valid_until"] == first["valid_until"]
    assert second["computed_at"] == first["computed_at"]


async def test_ac4_symbol_leaving_the_pool_loses_carried_rows():
    """@AC-4: AAPL's signal expires, so its carried live rows go; dip_buyer_vol_stop stays."""
    svc = _rotation_svc()
    await _compute(svc)
    _set_signals(svc, _signals([s for s in POOL if s != "AAPL"]))
    await _compute(svc)
    assert _rows(svc, "AAPL", _SQUEEZE) == [] and _rows(svc, "AAPL", _BLEND) == []
    assert len(_rows(svc, "AAPL", _DIP)) == 1


async def test_ac5_rotation_position_survives_a_restart():
    """@AC-5: a new servicer sharing the stored rows and compute state resumes after the cursor."""
    state = _StampedComputeState(datetime.now(UTC) - timedelta(days=1))
    state._row["live_only_cursor"] = "AAPL"  # first chunk: MSFT, NVDA, T00..T16
    first_svc = _rotation_svc(state=state)
    await _compute(first_svc)
    first_chunk = _symbols_with(first_svc, _SQUEEZE)
    assert "NVDA" in first_chunk and "AAPL" not in first_chunk and len(first_chunk) == 20
    (nvda,) = _rows(first_svc, "NVDA", _SQUEEZE)

    restarted = _rotation_svc(state=state)
    restarted._opportunities_repo = first_svc._opportunities_repo
    await _compute(restarted)
    gained = _symbols_with(restarted, _SQUEEZE) - first_chunk
    assert len(gained) == 20
    (nvda_after,) = _rows(restarted, "NVDA", _SQUEEZE)
    assert nvda_after["valid_until"] == nvda["valid_until"]


async def test_ac6_joining_symbol_is_reached_within_one_cycle():
    """@AC-6: ZM gains a signal after compute 1 and has rows within 3 more computes."""
    svc = _rotation_svc(covered=POOL + ["ZM"])
    await _compute(svc)
    _set_signals(svc, _signals(POOL + ["ZM"]))
    for _ in range(3):
        await _compute(svc)
    assert _rows(svc, "ZM", _SQUEEZE)


async def test_ac7_held_and_watchlist_rows_are_unaffected():
    """@AC-7: held AAPL keeps dip_buyer_vol_stop and both live rows, exit-traced, every compute."""
    svc = _rotation_svc(held=["AAPL"])
    for _ in range(3):
        await _compute(svc)
        for sid in (_DIP, _SQUEEZE, _BLEND):
            (row,) = _rows(svc, "AAPL", sid)
            assert "position" in row["provenance"]
            # exit rule (< 100) never fires on _FIRING_BARS; the entry rule would pass 1/1
            assert row["readiness_json"]["total_conditions"] == 1
            assert row["readiness_json"]["passing_conditions"] == 0


async def test_ac8_removed_members_do_not_delay_the_rest():
    """@AC-8: 10 covered symbols lose their signals; 3 more computes cover the other 35."""
    svc = _rotation_svc()
    await _compute(svc)
    removed = POOL[:10]
    remaining = [s for s in POOL if s not in removed]
    _set_signals(svc, _signals(remaining))
    for _ in range(3):
        await _compute(svc)
    assert _symbols_with(svc, _SQUEEZE) == set(remaining)


async def test_ac9_held_and_per_symbol_caps_keep_their_limits():
    """@AC-9: 25 held symbols, 7 live strategies each → exactly 20 held symbols get live rows and
    none gets more than 5."""
    held = [f"H{i:02d}" for i in range(25)]
    ids = [f"live{i}" for i in range(7)]
    svc = _rotation_svc(pool=held, held=held, watch=False, live_ids=ids)
    await _compute(svc)
    per_symbol = {s: len([r for r in _rows(svc, s) if r["strategy_id"] in ids]) for s in held}
    assert sum(1 for n in per_symbol.values() if n) == 20
    assert max(per_symbol.values()) == 5


async def test_ac11_oversized_pool_keeps_the_limit_and_logs_the_shortfall_once(caplog):
    """@AC-11: a 350-symbol pool gets at most 20 new live symbols and the exact shortfall line,
    once; a second identical compute logs nothing new."""
    pool = sorted(f"P{i:03d}" for i in range(350))
    svc = _rotation_svc(pool=pool, watch=False, live_ids=(_SQUEEZE,))
    with caplog.at_level(logging.INFO, logger="app.handlers.servicer"):
        await _compute(svc)
        assert len(_symbols_with(svc, _SQUEEZE)) == 20
        await _compute(svc)
    lines = [r.getMessage() for r in caplog.records if _SHORTFALL in r.getMessage()]
    assert lines == [
        f"{_SHORTFALL}: user=u1 pool=350 per_compute=20 projected_computes=18 cycle_max_days=3"
    ]


async def test_ac12_carried_row_older_than_one_cycle_is_removed():
    """@AC-12: a carried row computed 4 days ago (cycle 3) is dropped; dip_buyer_vol_stop stays."""
    svc = _rotation_svc()
    await _compute(svc)
    (row,) = _rows(svc, "AAPL", _SQUEEZE)
    row["computed_at"] = datetime.now(UTC) - timedelta(days=4)
    row["valid_until"] = row["computed_at"] + timedelta(days=3)
    await _compute(svc)
    assert _rows(svc, "AAPL", _SQUEEZE) == []
    assert len(_rows(svc, "AAPL", _BLEND)) == 1
    assert len(_rows(svc, "AAPL", _DIP)) == 1


async def test_lowered_cycle_drops_a_row_stamped_under_the_longer_cycle():
    """O-23: a row stamped under cycle 5, still unexpired but 4 days old, drops once cycle is 3."""
    svc = _rotation_svc(cycle_days=5)
    await _compute(svc)
    (row,) = _rows(svc, "AAPL", _SQUEEZE)
    assert row["valid_until"] > datetime.now(UTC) + timedelta(days=4)
    row["computed_at"] = datetime.now(UTC) - timedelta(days=4)
    _set_ints(svc, {"opportunity.live_only_cycle_max_days": 3})
    await _compute(svc)
    assert _rows(svc, "AAPL", _SQUEEZE) == []


async def test_signal_flip_drops_carried_row_and_markers_are_kept():
    """Predicate (f): a buy→sell flip drops the carried row; a formula_unreadable or
    fundamentals_unavailable carried row with stored UNSPECIFIED is kept without comparing."""
    svc = _rotation_svc()
    await _compute(svc)
    (msft,) = _rows(svc, "MSFT", _SQUEEZE)
    msft["provenance"] = msft["provenance"] + ["formula_unreadable"]
    msft["action"] = 0
    (nvda,) = _rows(svc, "NVDA", _SQUEEZE)
    nvda["provenance"] = nvda["provenance"] + ["fundamentals_unavailable"]
    nvda["action"] = 0
    _set_signals(
        svc,
        [_sig("AAPL", "sell", 0.9, source="uw")] + _signals([s for s in POOL if s != "AAPL"]),
    )
    await _compute(svc)
    assert _rows(svc, "AAPL", _SQUEEZE) == []  # flipped → dropped
    assert len(_rows(svc, "MSFT", _SQUEEZE)) == 1  # marker kept
    assert len(_rows(svc, "NVDA", _SQUEEZE)) == 1  # marker kept
    assert len(_rows(svc, "T00", _SQUEEZE)) == 1  # unchanged direction kept


async def test_best_direction_parity_with_step3_on_tied_convictions():
    """best_direction_by_symbol uses step 3's first-seen strict '>' on raw conviction."""
    rest = _signals([s for s in POOL if s != "AAPL"])
    buy = _sig("AAPL", "buy", 0.8, source="uw")
    sell = _sig("AAPL", "sell", 0.8, source="x")
    for order, kept in (([buy, sell], True), ([sell, buy], False)):
        svc = _rotation_svc()
        await _compute(svc)
        assert len(_rows(svc, "AAPL", _SQUEEZE)) == 1
        _set_signals(svc, order + rest)
        await _compute(svc)  # AAPL is outside this chunk, so its row is a carry candidate
        assert len(_rows(svc, "AAPL", _SQUEEZE)) == (1 if kept else 0)


async def test_denied_carried_pair_leaves_only_the_muted_placeholder():
    """D-15: a carried (AAPL, squeeze) whose strategy then denies AAPL leaves exactly one row for
    that key, the muted placeholder; AAPL's (sym, '') row matches a never-carried denied symbol."""
    pool = sorted(["AAPL"] + [f"T{i:02d}" for i in range(24)])

    def _svc_with(cursor=None):
        state = _StampedComputeState(datetime.now(UTC) - timedelta(days=1))
        if cursor is not None:
            state._row["live_only_cursor"] = cursor
        return _rotation_svc(pool=pool, watch=False, live_ids=(_SQUEEZE,), state=state)

    def _deny(svc):
        denied = _live_strats(pool, (_SQUEEZE,), denied={_SQUEEZE: ["AAPL"]})
        svc._strategies_repo.list_live_enabled = AsyncMock(return_value=denied)

    carried = _svc_with()
    await _compute(carried)
    assert len(_rows(carried, "AAPL", _SQUEEZE)) == 1
    _deny(carried)
    await _compute(carried)
    (only,) = _rows(carried, "AAPL", _SQUEEZE)
    assert "denied" in only["provenance"]

    never_carried = _svc_with(cursor=pool[19])
    _deny(never_carried)
    await _compute(never_carried)
    keys = sorted(r["opportunity_key"] for r in _rows(carried, "AAPL"))
    assert keys == sorted(r["opportunity_key"] for r in _rows(never_carried, "AAPL"))


async def test_held_denied_symbol_drops_its_carried_row():
    """Predicate (b): once AAPL is held and denied, the only (AAPL, squeeze) row is the fresh
    held+denied row, never the carried live-only one."""
    pool = sorted(["AAPL"] + [f"T{i:02d}" for i in range(24)])
    svc = _rotation_svc(pool=pool, watch=False, live_ids=(_SQUEEZE,))
    await _compute(svc)
    (carried,) = _rows(svc, "AAPL", _SQUEEZE)
    svc._portfolio.ListPositions = AsyncMock(
        return_value=SimpleNamespace(
            positions=[SimpleNamespace(symbol="AAPL", market_value=1000.0)],
            page=SimpleNamespace(next_page_token=""),
        )
    )
    denied = _live_strats(pool, (_SQUEEZE,), denied={_SQUEEZE: ["AAPL"]})
    svc._strategies_repo.list_live_enabled = AsyncMock(return_value=denied)
    await _compute(svc)
    (row,) = _rows(svc, "AAPL", _SQUEEZE)
    assert {"position", "denied"} <= set(row["provenance"])
    assert row["computed_at"] > carried["computed_at"]


async def test_all_sell_pool_advances_cursor_and_keeps_it_through_the_empty_stamp():
    """O-20: an all-sell pool yields rows == [] with a non-null cursor; the cursor commits, the
    empty stamp applies and the stamp does not clobber the cursor."""
    pool = sorted(f"T{i:02d}" for i in range(25))
    svc = _rotation_svc(pool=pool, watch=False, live_ids=(_SQUEEZE,))
    _set_signals(svc, _signals(pool, direction="sell"))
    before = datetime.now(UTC)
    rows = await _compute(svc)
    assert rows == []
    assert _cursor(svc) == pool[19]
    assert svc._opportunity_compute_state_repo._row["valid_until"] > before


async def test_carry_read_failure_fails_the_compute_closed():
    """D-3 (356 @AC-5/@AC-10): read_attributed_rows raising fails the recompute; rows and cursor
    are unchanged and recompute{kind=full,outcome=failed} counts it."""
    svc = _rotation_svc()
    await _compute(svc)
    rows_before = [dict(r) for r in _rows(svc)]
    cursor_before = _cursor(svc)
    svc._opportunities_repo.read_attributed_rows = AsyncMock(side_effect=RuntimeError("db down"))
    with patch("app.handlers.servicer.telemetry.record_opportunity_recompute") as rec:
        await _compute(svc, expect_ok=False)
    assert svc._opportunity_compute_failures[_UID] == 1
    rec.assert_called_with("full", "failed")
    assert _rows(svc) == rows_before
    assert _cursor(svc) == cursor_before


async def test_cursor_write_failure_rolls_back_the_queue_replace():
    """D-2: write_cursor raising inside the transaction leaves the stored rows unchanged."""
    svc = _rotation_svc()
    await _compute(svc)
    rows_before = [dict(r) for r in _rows(svc)]
    svc._opportunity_compute_state_repo.write_cursor = AsyncMock(
        side_effect=RuntimeError("cursor write failed")
    )
    await _compute(svc, expect_ok=False)
    assert _rows(svc) == rows_before
    assert _cursor(svc) == POOL[19]


async def test_heal_stamps_live_only_row_with_cycle_and_others_with_session_window():
    """D-7 heal (185 @AC-8 regression guard): a healed live-only row gets now + cycle_max_days; a
    healed watchlist row keeps session_end + valid_window_hours (the newest bar is ~now here)."""
    svc = _materialized_svc(
        watchlists=[_wl(bindings=[("MSFT", "sx")])],
        strategies={"sx": _strat_row("sx", entry=_GT_100)},
        bars={"AAPL": _FIRING_BARS, "MSFT": _FIRING_BARS},
    )
    old = datetime.now(UTC) - timedelta(seconds=400)
    svc._opportunities_repo.rows[_UID] = [
        _unavailable_served_row(
            "AAPL", "sx", provenance=["live_strategy", "unavailable"], computed_at=old
        ),
        _unavailable_served_row(
            "MSFT", "sx", provenance=["watchlist", "unavailable"], computed_at=old
        ),
    ]
    before = datetime.now(UTC)
    await svc._retry_unavailable_symbols(_UID, {"AAPL", "MSFT"}, _META)
    after = datetime.now(UTC)
    live, watch = _rows(svc, symbol="AAPL")[0], _rows(svc, symbol="MSFT")[0]
    assert "unavailable" not in live["provenance"] and "unavailable" not in watch["provenance"]
    assert before + timedelta(days=3) <= live["valid_until"] <= after + timedelta(days=3)
    session_floor = before.replace(microsecond=0)  # session_end = the newest bar's whole second
    window = timedelta(hours=24)
    assert session_floor + window <= watch["valid_until"] <= after + window


# ── read side: one include_expired read split into branches (i)-(v) ──────────────

_HEAL_AGE_S = servicer._OPPORTUNITY_UNAVAILABLE_RETRY_SECONDS + 60


def _served(symbol, provenance, *, expired=False, age_s=0, strategy=_SQUEEZE, conviction=0.0):
    now = datetime.now(UTC)
    row = _unavailable_served_row(
        symbol,
        strategy,
        provenance=provenance,
        computed_at=now - timedelta(seconds=age_s),
        valid_until=now + (timedelta(hours=-1) if expired else timedelta(hours=1)),
    )
    return {**row, "conviction": conviction}


def _read_svc(rows, *, symbol_scoped=False):
    svc = _materialized_svc()
    repo = svc._opportunities_repo
    repo.rows[_UID] = rows
    orig = repo.read

    async def _read(*a, **kw):
        out = await orig(*a, **kw)
        return [r for r in out if r["symbol"] == kw["symbol"]] if symbol_scoped else out

    repo.read = AsyncMock(side_effect=_read)
    repo.available_sources = AsyncMock(wraps=repo.available_sources)
    svc._kick_opportunity_recompute = MagicMock()
    svc._kick_opportunity_retry = MagicMock()
    return svc


async def _list_opps(svc, **req):
    return await svc.ListOpportunities(
        analysis_pb2.ListOpportunitiesRequest(page=common_pb2.PageRequest(page_size=50), **req),
        _ctx(_HEADERS),
    )


def _read_flags(svc):
    return [c.kwargs["include_expired"] for c in svc._opportunities_repo.read.await_args_list]


def _facet_flag(svc):
    return svc._opportunities_repo.available_sources.await_args.kwargs["include_expired"]


@pytest.mark.usefixtures("read_path")
async def test_read_branch_i_expired_curated_row_serves_stale_and_kicks(metric_reader):
    svc = _read_svc([_served("AAPL", ["watchlist"], expired=True), _served("MSFT", ["watchlist"])])
    resp = await _list_opps(svc)
    assert sorted(o.symbol for o in resp.opportunities) == ["AAPL", "MSFT"]
    assert _read_flags(svc) == [True]
    svc._kick_opportunity_recompute.assert_called_once()
    svc._kick_opportunity_retry.assert_not_called()
    assert _facet_flag(svc) is True
    assert metric_sum(metric_reader, _REISSUE) == 0


@pytest.mark.usefixtures("read_path")
async def test_read_branch_iii_all_fresh_heals_and_keeps_repository_order(metric_reader):
    """185 @AC-8 heal on the fresh branch; 190 @AC-8/@AC-9 rows served in the repo's order."""
    svc = _read_svc(
        [
            _served("MSFT", ["watchlist"], conviction=0.5),
            _served("AAPL", ["live_strategy"], conviction=0.9),
            _served("AAPL", ["watchlist"], strategy=_DIP, conviction=0.1),
            _served("NVDA", ["live_strategy", "unavailable"], age_s=_HEAL_AGE_S),
        ]
    )
    resp = await _list_opps(svc)
    assert [o.opportunity_key for o in resp.opportunities] == [
        f"u1|AAPL|{_SQUEEZE}",
        f"u1|AAPL|{_DIP}",
        f"u1|MSFT|{_SQUEEZE}",
        f"u1|NVDA|{_SQUEEZE}",
    ]
    assert _read_flags(svc) == [True]
    svc._kick_opportunity_recompute.assert_not_called()
    assert svc._kick_opportunity_retry.call_args.args[1] == {"NVDA"}
    assert _facet_flag(svc) is False
    assert metric_sum(metric_reader, _REISSUE) == 0


@pytest.mark.usefixtures("read_path")
async def test_read_branch_iv_expired_live_only_row_reissues_fresh_read(metric_reader):
    """@AC-3 steady state: an expired carried live-only row is hidden by the re-issued fresh read,
    never kicks, the heal still fires, and read_reissue counts the second read."""
    svc = _read_svc(
        [
            _served("AAPL", ["watchlist"]),
            _served("MSFT", ["live_strategy"], expired=True),
            _served("NVDA", ["live_strategy", "unavailable"], age_s=_HEAL_AGE_S),
        ]
    )
    resp = await _list_opps(svc)
    assert sorted(o.symbol for o in resp.opportunities) == ["AAPL", "NVDA"]
    assert _read_flags(svc) == [True, False]
    svc._kick_opportunity_recompute.assert_not_called()
    assert svc._kick_opportunity_retry.call_args.args[1] == {"NVDA"}
    assert _facet_flag(svc) is False
    assert metric_sum(metric_reader, _REISSUE) == 1


@pytest.mark.usefixtures("read_path")
async def test_read_branch_v_only_expired_live_only_rows_take_the_all_stale_body(metric_reader):
    svc = _read_svc([_served("AAPL", ["live_strategy"], expired=True)])
    resp = await _list_opps(svc)
    assert [o.symbol for o in resp.opportunities] == ["AAPL"]
    assert _read_flags(svc) == [True, True]
    svc._kick_opportunity_recompute.assert_called_once()
    assert _facet_flag(svc) is True
    assert metric_sum(metric_reader, _REISSUE) == 0


@pytest.mark.usefixtures("read_path")
async def test_read_branch_v_fresh_elsewhere_serves_filtered_empty_without_kick(metric_reader):
    svc = _read_svc(
        [_served("AAPL", ["live_strategy"], expired=True), _served("MSFT", ["watchlist"])],
        symbol_scoped=True,
    )
    resp = await _list_opps(svc, symbol="AAPL")
    assert list(resp.opportunities) == []
    assert resp.computing is False and resp.compute_failed is False
    assert _read_flags(svc) == [True]
    svc._kick_opportunity_recompute.assert_not_called()
    assert metric_sum(metric_reader, _REISSUE) == 0


@pytest.mark.usefixtures("read_path")
async def test_list_opportunities_serves_each_rows_own_valid_until():
    """C-14 consumer surface: a fresh row and a carried live-only row keep distinct valid_until."""
    fresh, carried = _served("AAPL", ["watchlist"]), _served("MSFT", ["live_strategy"])
    carried["valid_until"] = datetime.now(UTC) + timedelta(days=2)
    svc = _read_svc([fresh, carried])
    resp = await _list_opps(svc)
    got = {o.symbol: o.valid_until.ToDatetime(tzinfo=UTC) for o in resp.opportunities}
    assert got == {"AAPL": fresh["valid_until"], "MSFT": carried["valid_until"]}
