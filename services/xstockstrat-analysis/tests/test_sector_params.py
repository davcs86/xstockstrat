"""Feature 217 — per-sector component-param overrides.

The ACs' "override" is a component PARAM (C-15 amendment, context.md 2026-10-06): an RSI component
`period` default 14, override 10 for TECHNOLOGY, 7 for COMMUNICATION_SERVICES. The fake
ComputeIndicator echoes the period it was called with on every bar, so a bar's series value IS
the param it was scored with. Real ``marketdata_pb2.Bar`` (``bar.time``) — never MagicMock
(fails.md:727); the look-ahead test reclassifies MID-series and asserts interior bars
(fails.md:1852).
"""

import json
from datetime import UTC, date, datetime, timedelta
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import grpc
import pytest
from gen.analysis.v1 import analysis_pb2
from gen.common.v1 import common_pb2
from gen.indicators.v1 import indicators_pb2
from gen.marketdata.v1 import marketdata_pb2
from google.protobuf.struct_pb2 import Struct

from app.services import sector_params
from app.services.evaluator import FundamentalPeriod, StrategyEvaluator, _validate_definition

from .test_analysis_servicer import (
    _DAY,
    _EOF_PAGE,
    _W_START,
    _bar,
    _owned_ctx,
    _points,
    _windowed_req,
    make_servicer,
)

TECH = common_pb2.Sector.SECTOR_TECHNOLOGY
COMM = common_pb2.Sector.SECTOR_COMMUNICATION_SERVICES
FIN = common_pb2.Sector.SECTOR_FINANCIALS
EPOCH = datetime(1900, 1, 1, tzinfo=UTC)


def _day_bars(start: date, end: date) -> list:
    bars, d = [], start
    while d <= end:
        b = marketdata_pb2.Bar(symbol="XYZ", open=100, high=100, low=100, close=100)
        b.time.FromDatetime(datetime(d.year, d.month, d.day, tzinfo=UTC))
        bars.append(b)
        d += timedelta(days=1)
    return bars


def _row(
    sector, valid_from: datetime, valid_to: datetime | None = None, source="fmp", symbol="XYZ"
):
    r = marketdata_pb2.SectorHistoryRow(symbol=symbol, sector=sector, source=source)
    r.valid_from.FromDatetime(valid_from)
    if valid_to is not None:
        r.valid_to.FromDatetime(valid_to)
    return r


def _rsi_definition(by_sector: dict[int, float], default=14.0):
    d = analysis_pb2.StrategyDefinition(
        strategy_id="s",
        components=[
            analysis_pb2.StrategyComponent(
                ref_name="rsi",
                kind=analysis_pb2.COMPONENT_KIND_BUILTIN_INDICATOR,
                indicator="RSI",
                params={"period": 5.0},
            )
        ],
        entry_rule=json.dumps({"fn": "<", "lhs": "rsi", "rhs": 30}),
    )
    ov = d.sector_param_overrides.add(
        component_ref="rsi", param_name="period", default_value=default
    )
    for sector, value in by_sector.items():
        ov.by_sector.add(sector=sector, value=value)
    return d


def _echo_stub():
    stub = MagicMock()

    async def _compute(req, metadata=None):
        return _points([req.params["period"]] * len(req.values))

    stub.ComputeIndicator = AsyncMock(side_effect=_compute)
    return stub


async def _scored_periods(definition, bars, sectors):
    ev = StrategyEvaluator(_echo_stub(), ())
    _, series = await ev.evaluate_with_series(definition, bars, sector_by_bar=sectors)
    return series["rsi"]


@pytest.mark.asyncio
async def test_ac6_override_applied_for_every_bar():
    bars = _day_bars(date(2018, 1, 1), date(2018, 1, 31))
    sectors, _ = sector_params.sector_by_bar([_row(TECH, datetime(2017, 1, 1, tzinfo=UTC))], bars)
    got = await _scored_periods(_rsi_definition({TECH: 10.0}), bars, sectors)
    assert got == [10.0] * len(bars)


@pytest.mark.asyncio
async def test_ac7_mid_series_reclassification_no_lookahead():
    bars = _day_bars(date(2018, 8, 1), date(2018, 11, 30))
    split = datetime(2018, 10, 1, tzinfo=UTC)
    rows = [_row(TECH, datetime(2018, 1, 1, tzinfo=UTC), split), _row(COMM, split)]
    sectors, _ = sector_params.sector_by_bar(rows, bars)
    got = await _scored_periods(_rsi_definition({TECH: 10.0, COMM: 7.0}), bars, sectors)
    by_day = {b.time.ToDatetime().date(): v for b, v in zip(bars, got, strict=True)}
    # interior bars on both sides of the boundary, plus the boundary itself
    for d in (date(2018, 8, 15), date(2018, 9, 10), date(2018, 9, 30)):
        assert by_day[d] == 10.0, d
    for d in (date(2018, 10, 1), date(2018, 10, 20), date(2018, 11, 15)):
        assert by_day[d] == 7.0, d


@pytest.mark.asyncio
async def test_ac8_unclassified_symbol_uses_default():
    bars = _day_bars(date(2018, 1, 1), date(2018, 1, 10))
    sectors, used_seed = sector_params.sector_by_bar([], bars)
    got = await _scored_periods(_rsi_definition({TECH: 10.0}), bars, sectors)
    assert got == [14.0] * len(bars) and not used_seed


@pytest.mark.asyncio
async def test_ac10_pre_go_live_bar_resolves_to_epoch_seed():
    bars = _day_bars(date(2015, 3, 1), date(2015, 3, 20))
    sectors, used_seed = sector_params.sector_by_bar([_row(TECH, EPOCH, source="seed")], bars)
    got = await _scored_periods(_rsi_definition({TECH: 10.0}), bars, sectors)
    assert got == [10.0] * len(bars)
    assert used_seed  # drives the seed-span warning


@pytest.mark.asyncio
async def test_ac13_seeded_vs_unseeded_in_one_run():
    bars = _day_bars(date(2015, 3, 1), date(2015, 3, 5))
    d = _rsi_definition({TECH: 10.0})
    xyz, _ = sector_params.sector_by_bar([_row(TECH, EPOCH, source="seed")], bars)
    newco, _ = sector_params.sector_by_bar([], bars)
    assert await _scored_periods(d, bars, xyz) == [10.0] * 5
    assert await _scored_periods(d, bars, newco) == [14.0] * 5


@pytest.mark.asyncio
async def test_no_override_parity_is_byte_identical():
    bars = _day_bars(date(2018, 1, 1), date(2018, 1, 5))
    d = _rsi_definition({})
    del d.sector_param_overrides[:]
    stub = _echo_stub()
    ev = StrategyEvaluator(stub, ())
    _, with_sectors = await ev.evaluate_with_series(d, bars, sector_by_bar=[TECH] * 5)
    _, plain = await ev.evaluate_with_series(d, bars)
    assert with_sectors == plain and plain["rsi"] == [5.0] * 5
    assert stub.ComputeIndicator.await_count == 2  # one compute per run, never K


@pytest.mark.asyncio
async def test_k_distinct_variants_computed_once_each():
    bars = _day_bars(date(2018, 9, 25), date(2018, 10, 5))
    split = datetime(2018, 10, 1, tzinfo=UTC)
    sectors, _ = sector_params.sector_by_bar(
        [_row(TECH, datetime(2018, 1, 1, tzinfo=UTC), split), _row(COMM, split)], bars
    )
    stub = _echo_stub()
    ev = StrategyEvaluator(stub, ())
    await ev.evaluate_with_series(
        _rsi_definition({TECH: 10.0, COMM: 7.0}), bars, sector_by_bar=sectors
    )
    assert stub.ComputeIndicator.await_count == 2
    assert all(len(c.args[0].values) == len(bars) for c in stub.ComputeIndicator.await_args_list)


def _scalar_resp(**scalars):
    out = Struct()
    out.update(scalars)
    return SimpleNamespace(success=True, output=out, error="")


@pytest.mark.asyncio
async def test_ac14_override_reaches_fundamentals_formula_params():
    """@AC-14: the fscore fundamentals formula is executed with de_bad=12.0 for a FINANCIALS bar."""
    seen = []

    async def _exec(req, metadata=None):
        seen.append(dict(req.input_params))
        return _scalar_resp(value=0.5, composite=0.6)

    stub = MagicMock()
    stub.ExecuteFormula = AsyncMock(side_effect=_exec)
    d = analysis_pb2.StrategyDefinition(
        strategy_id="fundamentals_macd_blend",
        components=[
            analysis_pb2.StrategyComponent(
                ref_name="fscore",
                kind=analysis_pb2.COMPONENT_KIND_CUSTOM_FORMULA,
                formula_id="vq",
                params={"de_bad": 2.0},
            )
        ],
        entry_rule=json.dumps({"fn": ">", "lhs": "fscore.composite", "rhs": 0.5}),
    )
    ov = d.sector_param_overrides.add(
        component_ref="fscore", param_name="de_bad", default_value=2.0
    )
    ov.by_sector.add(sector=FIN, value=12.0)
    bars = _day_bars(date(2026, 8, 1), date(2026, 8, 5))
    funds = [FundamentalPeriod(filed_date=date(2026, 7, 24), values={"debt_to_equity": 8.8})]
    fmap = {"vq": [indicators_pb2.FUNDAMENTAL_METRIC_DEBT_TO_EQUITY]}
    sectors, _ = sector_params.sector_by_bar([_row(FIN, EPOCH, source="seed", symbol="AXP")], bars)
    await StrategyEvaluator(stub, ()).evaluate_with_series(
        d, bars, None, None, funds, fmap, sector_by_bar=sectors
    )
    assert seen and all(p["de_bad"] == 12.0 for p in seen)
    # live-snapshot surface: apply_sector resolves the same override for the current sector
    live = sector_params.apply_sector(d, FIN)
    assert live.components[0].params["de_bad"] == 12.0
    assert d.components[0].params["de_bad"] == 2.0  # original never mutated
    assert sector_params.apply_sector(live, common_pb2.Sector.SECTOR_ENERGY) is not live


def test_apply_sector_without_overrides_returns_same_object():
    d = _rsi_definition({})
    del d.sector_param_overrides[:]
    assert sector_params.apply_sector(d, TECH) is d


def test_sector_by_bar_boundaries():
    split = datetime(2018, 10, 1, tzinfo=UTC)
    bars = _day_bars(date(2018, 9, 30), date(2018, 10, 1))
    gap_rows = [_row(TECH, datetime(2018, 1, 1, tzinfo=UTC), split)]  # closed, no successor
    sectors, _ = sector_params.sector_by_bar(gap_rows, bars)
    assert sectors == [TECH, sector_params.UNSPECIFIED]  # valid_to exclusive, no carry-forward
    before = _day_bars(date(2017, 12, 31), date(2017, 12, 31))
    assert sector_params.sector_by_bar(gap_rows, before)[0] == [sector_params.UNSPECIFIED]


@pytest.mark.parametrize(
    "mutate, msg",
    [
        (lambda o: setattr(o, "component_ref", "nope"), "matches no component"),
        (lambda o: setattr(o, "param_name", ""), "param_name is required"),
        (lambda o: o.by_sector.add(sector=0, value=1.0), "SECTOR_UNSPECIFIED"),
        (lambda o: o.by_sector.add(sector=TECH, value=1.0), "duplicate sector"),
        (lambda o: setattr(o, "default_value", float("nan")), "finite"),
    ],
)
def test_validate_overrides_rejects(mutate, msg):
    d = _rsi_definition({TECH: 10.0})
    mutate(d.sector_param_overrides[0])
    with pytest.raises(ValueError, match=msg):
        _validate_definition(d)


def test_validate_overrides_rejects_duplicate_and_fundamental_operand():
    d = _rsi_definition({TECH: 10.0})
    d.sector_param_overrides.add(component_ref="rsi", param_name="period", default_value=1.0)
    with pytest.raises(ValueError, match="duplicate override"):
        _validate_definition(d)
    d2 = _rsi_definition({})
    d2.components.add(
        ref_name="pe", kind=analysis_pb2.COMPONENT_KIND_FUNDAMENTAL, fundamental_metric="pe_ratio"
    )
    d2.sector_param_overrides.add(component_ref="pe", param_name="x", default_value=1.0)
    with pytest.raises(ValueError, match="fundamental operand"):
        _validate_definition(d2)


# ── RunBacktest wiring: one batched GetSectorHistory, seed-span + outage warnings ───────────────


def _wire(svc, bars, sector_resp=None, sector_exc=None):
    svc._ledger = MagicMock()
    svc._ledger.AppendEvent = AsyncMock(return_value=MagicMock())
    svc._backtest_run_symbols_repo = AsyncMock()
    svc._indicators = _echo_stub()
    svc._marketdata = MagicMock()
    svc._marketdata.GetBars = AsyncMock(return_value=SimpleNamespace(page=_EOF_PAGE, bars=bars))
    if sector_exc is not None:
        svc._marketdata.GetSectorHistory = AsyncMock(side_effect=sector_exc)
    else:
        svc._marketdata.GetSectorHistory = AsyncMock(return_value=sector_resp)
    return svc


class _Unavailable(grpc.RpcError):
    def code(self):
        return grpc.StatusCode.UNAVAILABLE


@pytest.mark.asyncio
async def test_run_backtest_snapshots_sector_history_once_and_warns_on_seed():
    bars = [_bar(_W_START + i * _DAY, 100.0 + i) for i in range(-40, 20)]
    for b in bars:
        b.symbol = "AAPL"
    resp = marketdata_pb2.GetSectorHistoryResponse(
        rows=[_row(TECH, EPOCH, source="seed", symbol="AAPL")]
    )
    svc = _wire(make_servicer(), bars, sector_resp=resp)
    result = await svc.RunBacktest(
        _windowed_req(_rsi_definition({TECH: 10.0}), symbols=("AAPL",)), _owned_ctx()
    )
    assert svc._marketdata.GetSectorHistory.await_count == 1
    call = svc._marketdata.GetSectorHistory.await_args
    assert list(call.args[0].symbols) == ["AAPL"]
    assert ("x-user-id", "u1") in list(call.kwargs["metadata"])  # header trio propagated
    assert any("seed span" in w and "AAPL" in w for w in result.warnings)
    periods = {c.args[0].params["period"] for c in svc._indicators.ComputeIndicator.await_args_list}
    assert periods == {10.0}


@pytest.mark.asyncio
async def test_run_backtest_sector_outage_falls_back_to_defaults():
    bars = [_bar(_W_START + i * _DAY, 100.0 + i) for i in range(-40, 20)]
    svc = _wire(make_servicer(), bars, sector_exc=_Unavailable())
    result = await svc.RunBacktest(
        _windowed_req(_rsi_definition({TECH: 10.0}), symbols=("AAPL",)), _owned_ctx()
    )
    assert result.status == analysis_pb2.BACKTEST_STATUS_OK
    assert any("sector classification unavailable" in w for w in result.warnings)
    periods = {c.args[0].params["period"] for c in svc._indicators.ComputeIndicator.await_args_list}
    assert periods == {14.0}


@pytest.mark.asyncio
async def test_run_backtest_without_overrides_never_calls_sector_rpc():
    bars = [_bar(_W_START + i * _DAY, 100.0 + i) for i in range(-40, 20)]
    d = _rsi_definition({})
    del d.sector_param_overrides[:]
    svc = _wire(make_servicer(), bars, sector_resp=marketdata_pb2.GetSectorHistoryResponse())
    await svc.RunBacktest(_windowed_req(d, symbols=("AAPL",)), _owned_ctx())
    assert svc._marketdata.GetSectorHistory.await_count == 0


@pytest.mark.asyncio
async def test_sector_definition_caches_and_degrades():
    svc = make_servicer()
    svc._marketdata = MagicMock()
    svc._marketdata.GetCurrentSector = AsyncMock(
        return_value=marketdata_pb2.GetCurrentSectorResponse(
            sectors=[marketdata_pb2.SymbolSector(symbol="XYZ", sector=TECH)]
        )
    )
    d = _rsi_definition({TECH: 10.0})
    r1 = await svc._sector_definition(d, "xyz", ())
    r2 = await svc._sector_definition(d, "XYZ", ())
    assert r1.components[0].params["period"] == 10.0 == r2.components[0].params["period"]
    assert svc._marketdata.GetCurrentSector.await_count == 1  # cached
    svc._marketdata.GetCurrentSector = AsyncMock(side_effect=_Unavailable())
    r3 = await svc._sector_definition(d, "NEWCO", ())
    assert r3.components[0].params["period"] == 14.0  # outage → default bucket, never an error


def test_warmup_sizes_for_hungriest_sector_variant():
    from app.services import warmup

    d = _rsi_definition({TECH: 30.0}, default=14.0)
    plain = _rsi_definition({})
    del plain.sector_param_overrides[:]
    plain.components[0].params["period"] = 30.0
    assert warmup.required_prefix_bars(d) == warmup.required_prefix_bars(plain)
