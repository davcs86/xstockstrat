"""Feature 205 — ListFundamentalMetrics handler (G2 completeness/fail-loud) + the G1 cross-service
data_key contract (every derived data_key is a real marketdata.Fundamentals field)."""

from unittest.mock import MagicMock

from gen.indicators.v1 import indicators_pb2
from gen.marketdata.v1 import marketdata_pb2

from app.handlers.servicer import IndicatorsServicer


def _cfg_stub():
    cfg = MagicMock()
    cfg.sandbox_max_concurrent.return_value = 4
    return cfg


async def _list():
    servicer = IndicatorsServicer(config_watcher=_cfg_stub())
    return await servicer.ListFundamentalMetrics(
        indicators_pb2.ListFundamentalMetricsRequest(), MagicMock()
    )


async def test_lists_all_metrics_with_meaning_and_key():
    # G2: every non-UNSPECIFIED enum value → a non-empty data_key AND a non-empty meaning.
    resp = await _list()
    assert len(resp.metrics) == 11
    for info in resp.metrics:
        assert info.data_key, f"empty data_key for metric {info.metric}"
        assert info.meaning, f"empty meaning for metric {info.metric}"


async def test_response_covers_exactly_the_enum():
    # Completeness guard: the response's enum set equals all non-zero FundamentalMetric values.
    resp = await _list()
    got = {info.metric for info in resp.metrics}
    want = {v.number for v in indicators_pb2.FundamentalMetric.DESCRIPTOR.values if v.number != 0}
    assert got == want


async def test_data_keys_are_real_marketdata_fundamentals_fields():
    # G1 cross-service contract: every derived data_key names a real marketdata.Fundamentals field.
    resp = await _list()
    fund_fields = set(marketdata_pb2.Fundamentals.DESCRIPTOR.fields_by_name)
    for info in resp.metrics:
        assert info.data_key in fund_fields, f"data_key {info.data_key!r} not a Fundamentals field"
