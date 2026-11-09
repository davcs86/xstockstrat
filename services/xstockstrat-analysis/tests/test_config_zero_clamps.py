"""Feature 244 @AC-6 / @AC-7 (analysis rows).

@AC-6: a stored 0 / "" on an FR-3 key resolves to the site's coded default (the table resolves the
default from the guard's AST scan; the seams build the real consumers).
@AC-7: a stored 0 / "" whose coded default is also 0 / "" keeps its value (over-clamp tripwire).
"""

import importlib
from unittest.mock import AsyncMock, MagicMock

import pytest
from gen.analysis.v1 import analysis_pb2

from tests.conftest import snapshot_watcher
from tests.test_config_read_classification import APP_DIR, FR3_KEYS, HONOUR_KEYS, collect

from .test_analysis_servicer import (
    _owned_ctx,
    _series_bars,
    _sma_def,
    _windowed_req,
    _wire_evaluated,
    make_servicer,
)
from .test_fundsignal_loop import _make_loop

_CLAMP_BY_TYPE = {"int": "int_positive", "float": "float_positive", "string": "str_nonempty"}
_ZERO_BY_TYPE = {"int": 0, "float": 0.0, "string": ""}

# (key, type, effective) — the analysis @AC-6 rows of acceptance.feature, minus the
# default_fill_model honour row (a site seam below).
AC6_ROWS = [
    ("engine.eval_interval_seconds", "int", 60),
    ("engine.max_strategies_per_cycle", "int", 50),
    ("engine.fundamentals_blend_strategy_id", "string", "fundamentals_macd_blend"),
    ("strategy.default_cooldown_days", "int", 31),
    ("scoring.shrinkage_days", "int", 250),
    ("screener.max_duration_seconds", "int", 120),
    ("backtest.portfolio_position_weight", "float", 0.10),
    ("backtest.detail_retention_per_strategy", "int", 20),
    ("opportunity.max_concurrent_bars_fetches", "int", 2),
    ("backtest.max_range_days", "int", 730),
    ("snapshot.indicator_timeout_ms", "int", 500),
    ("screener.max_universe_size", "int", 100),
    ("opportunity.max_universe_size", "int", 100),
    ("fundsignal.run_interval_hours", "int", 24),
    ("fundsignal.daily_call_budget", "int", 200),
    ("strategy.max_concurrent_entry_backfill", "int", 4),
    ("backtest.portfolio_max_concurrent", "int", 9),
    ("series.max_concurrent_components", "int", 4),
    ("opportunity.max_concurrent_candidates", "int", 4),
    ("compute.max_worker_threads", "int", 4),
    ("readiness_materializer.max_concurrent_bars_fetches", "int", 2),
    ("screener.max_concurrent_formula_evals", "int", 4),
    ("fundsignal.source_slug", "string", "fundamentals"),
    ("fundsignal.max_symbols_per_run", "int", 200),
    ("fundsignal.valid_days", "int", 90),
    ("snapshot.signal_timeout_ms", "int", 500),
    ("patterns.indicator_bucket_count", "int", 5),
    ("opportunity.max_live_strategies_per_symbol", "int", 5),
    ("opportunity.max_live_only_symbols_per_compute", "int", 20),
    ("opportunity.max_live_held_symbols_per_compute", "int", 20),
    ("opportunity.valid_window_hours", "int", 24),
    ("opportunity.snooze_default_hours", "int", 24),
    ("opportunity.read_db_budget_ms", "int", 20000),
    ("opportunity.live_enrich_timeout_ms", "int", 3000),
]

_TYPE_BY_KEY = {key: typ for key, typ, _ in AC6_ROWS}


@pytest.fixture(scope="module")
def scan():
    return collect(APP_DIR)


def _clamp(name):
    return getattr(importlib.import_module("app.config.watcher"), name)


def _site_default(scan, key):
    module, default_src = sorted(scan.clamps[key])[0]
    return eval(default_src, vars(importlib.import_module(module)))


def _all_fr3_zero():
    """A real watcher with every FR-3 key, plus default_fill_model, stored at its zero."""
    values = {key: _ZERO_BY_TYPE[typ] for key, typ in _TYPE_BY_KEY.items()}
    values["backtest.default_fill_model"] = 0
    return snapshot_watcher(**values)


def test_ac6_table_covers_every_fr3_key():
    assert {key for key, _, _ in AC6_ROWS} == FR3_KEYS


@pytest.mark.parametrize(("key", "typ", "effective"), AC6_ROWS)
def test_ac6_stored_zero_reads_as_site_default(scan, key, typ, effective):
    default = _site_default(scan, key)
    w = snapshot_watcher(**{key: _ZERO_BY_TYPE[typ]})
    assert _clamp(_CLAMP_BY_TYPE[typ])(w, key, default) == effective


def test_ac6_negative_int_reads_as_site_default(scan):
    key = "backtest.portfolio_max_concurrent"
    w = snapshot_watcher(**{key: -5})
    assert _clamp("int_positive")(w, key, _site_default(scan, key)) == 9


def test_ac6_servicer_init_semaphores_and_pool():
    from app.handlers.servicer import AnalysisServicer

    svc = AnalysisServicer(
        _all_fr3_zero(),
        marketdata_channel=MagicMock(),
        indicators_channel=MagicMock(),
        ingest_channel=MagicMock(),
        ledger_channel=MagicMock(),
    )
    try:
        assert svc._component_series_sem.limit == 4
        assert svc._bars_fetch_sem.limit == 2
        assert svc._candidates_sem.limit == 4
        assert svc._compute.limit == 4
        assert svc._readiness_materializer_bars_sem.limit == 2
    finally:
        svc._compute.shutdown(wait=False)


@pytest.mark.asyncio
@pytest.mark.parametrize(("seeded", "grown"), [(None, 6), (2, 3)])
async def test_compute_pool_limit_follows_seeded_key_and_on_change(seeded, grown):
    """Feature 295 B2 (b): the real ComputePool reads analysis.compute.max_worker_threads live."""
    import asyncio

    from gen.config.v1 import config_pb2

    from app.handlers.servicer import AnalysisServicer

    key = "compute.max_worker_threads"
    watcher = snapshot_watcher(**({} if seeded is None else {key: seeded}))
    watcher._snapshot_event = asyncio.Event()
    svc = AnalysisServicer(
        watcher,
        marketdata_channel=MagicMock(),
        indicators_channel=MagicMock(),
        ingest_channel=MagicMock(),
        ledger_channel=MagicMock(),
    )
    limiter = svc._compute._limiter
    start = 4 if seeded is None else seeded
    waiter = None
    try:
        assert svc._compute.limit == start
        for _ in range(start):
            await limiter.acquire()
        waiter = asyncio.create_task(limiter.acquire())
        await asyncio.sleep(0)
        assert not waiter.done()

        snap = config_pb2.ConfigSnapshot(namespace="analysis", version="v2")
        snap.values[key].int_val = grown
        watcher._apply(snap)
        assert svc._compute.limit == grown
        await asyncio.wait_for(waiter, 1)  # on_change woke the pool's waiter
    finally:
        if waiter is not None:
            waiter.cancel()
        svc._compute.shutdown(wait=False)


def test_ac6_named_readers():
    import app.engine.fundsignal_loop as fundsignal_module
    import app.handlers.servicer as servicer_module

    w = _all_fr3_zero()
    assert servicer_module.blend_strategy_id(w) == "fundamentals_macd_blend"
    assert servicer_module.default_cooldown_days(w) == 31
    assert fundsignal_module.fundsignal_source_slug(w) == "fundamentals"


def test_ac6_screener_formula_semaphore():
    from app.services.screener import ScreenerEngine

    engine = ScreenerEngine(MagicMock(), MagicMock(), MagicMock(), _all_fr3_zero(), {})
    assert engine._sem._value == 4


@pytest.mark.asyncio
async def test_ac6_fundsignal_disabled_tick_sleeps_default_interval():
    loop = _make_loop()
    loop._cfg = _all_fr3_zero()
    loop._next_sleep_seconds = AsyncMock(return_value=0)
    assert await loop._tick() == 86400


@pytest.mark.asyncio
async def test_ac6_default_fill_model_zero_is_legacy():
    svc = _wire_evaluated(make_servicer(), _series_bars(6, 12))
    req = _windowed_req(_sma_def())
    svc._cfg = _all_fr3_zero()
    svc._backtest_runs_repo = AsyncMock()
    result = await svc.RunBacktest(req, context=_owned_ctx())
    assert result.fill_model == analysis_pb2.FILL_MODEL_SAME_BAR_CLOSE


def test_ac7_refresh_hours_keep_stored_midnight():
    svc = make_servicer()
    svc._cfg = snapshot_watcher(
        **{
            "opportunity.refresh_hour_utc": 0,
            "readiness_materializer.refresh_hour_utc": 0,
        }
    )
    assert svc._opportunity_refresh_hour() == 0
    assert svc._readiness_materializer_hour() == 0


@pytest.mark.parametrize(
    ("key", "getter", "stored"),
    [
        ("fundsignal.min_conviction_to_emit", "get_float", 0.0),
        ("fundsignal.scoring_formula_id", "get_str", ""),
        ("fundsignal.explicit_symbols", "get_str", ""),
    ],
)
def test_ac7_fundsignal_zero_reads_back_as_stored(scan, key, getter, stored):
    _, default_src = sorted(scan.reads[key])[0]
    w = snapshot_watcher(**{key: stored})
    assert getattr(w, getter)(key, eval(default_src)) == stored


@pytest.mark.parametrize(
    "key",
    [
        "opportunity.refresh_hour_utc",
        "readiness_materializer.refresh_hour_utc",
        "fundsignal.min_conviction_to_emit",
        "fundsignal.scoring_formula_id",
        "fundsignal.explicit_symbols",
    ],
)
def test_ac7_keys_are_honoured_never_clamped(scan, key):
    assert key in HONOUR_KEYS
    assert key not in FR3_KEYS
    assert key not in scan.clamps
