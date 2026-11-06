"""Indicators sandbox and template signals (feature 294 AC-37 counters, AC-39 indicators half)."""

import logging

from gen.indicators.v1 import indicators_pb2

from app.handlers.servicer import IndicatorsServicer
from app.services import sandbox
from tests import test_telemetry
from tests.conftest import OWNER_HEADERS, ctx_with
from tests.test_execute_formula_concurrency import _cfg, _exec_req, _timeout_execute_double
from tests.test_formula_templates import _instantiate, _seed, _servicer
from tests.test_telemetry_instruments import _data_points

# The fixture is local to test_telemetry.py (not conftest); this binding exposes it here.
metric_reader = test_telemetry.metric_reader


def _count(reader, name, **attrs):
    return sum(p.value for p in _data_points(reader, name) if dict(p.attributes) == attrs)


def _samples(reader, name, **attrs):
    return sum(p.count for p in _data_points(reader, name) if dict(p.attributes) == attrs)


async def test_ac37_timeout_counted_and_warned_with_rpc_ok(metric_reader, monkeypatch, caplog):
    monkeypatch.setattr(sandbox, "execute_formula", _timeout_execute_double)
    servicer = IndicatorsServicer(config_watcher=_cfg(max_concurrent=4, timeout_ms=5000))
    ctx = ctx_with(OWNER_HEADERS)

    with caplog.at_level(logging.WARNING, logger="app.handlers.servicer"):
        resp = await servicer.ExecuteFormula(_exec_req(), ctx)

    assert _count(metric_reader, "indicators.sandbox.executions", exit_reason="timeout") == 1
    assert _samples(metric_reader, "indicators.sandbox.duration", exit_reason="timeout") == 1
    assert _samples(metric_reader, "indicators.sandbox.queue_wait") == 1
    warns = [r for r in caplog.records if r.levelno == logging.WARNING]
    assert [getattr(r, "exit_reason", None) for r in warns] == ["timeout"]
    assert resp.exit_reason == indicators_pb2.SANDBOX_EXIT_REASON_TIMEOUT
    ctx.abort.assert_not_awaited()


async def test_ac39_instantiate_template_ok_counted(metric_reader):
    svc = _servicer()
    await _seed(svc)

    formula = await _instantiate(svc)

    assert formula.formula_id
    assert _count(metric_reader, "template.instantiate", service="indicators", outcome="ok") == 1
