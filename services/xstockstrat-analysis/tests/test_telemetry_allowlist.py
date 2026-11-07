"""Feature 294 final allowlist pass for analysis (AC-41, AC-42, AC-7)."""

import ast
import logging
from pathlib import Path

import grpc

from app import telemetry
from tests import test_telemetry

# The fixture is local to test_telemetry.py (not conftest); this binding exposes it here.
metric_reader = test_telemetry.metric_reader

APP = Path(__file__).resolve().parent.parent / "app"
ALLOWED_KEYS = {v for k, v in vars(telemetry).items() if k.startswith("KEY_")}
FORBIDDEN_KEYS = {
    "user_id",
    "email",
    "client_id",
    "account_id",
    "order_id",
    "intent_id",
    "symbol",
    "strategy_id",
    "stream_key",
    "slug",
    "category",
    "internal_caller",
    "secret",
    "api_key",
    "token",
}
MIN_INSTRUMENTS = {
    "analysis.live_loop.pairs",
    "analysis.live_loop.drain_failures",
    "analysis.live_loop.triggers",
    "analysis.live_loop.cycle.duration",
    "analysis.fundsignal.signals",
    "analysis.opportunity.recompute",
    "template.instantiate",
}
RPC_KEYS = {"rpc.system", "rpc.service", "rpc.method", "rpc.grpc.status_code"}


def _drive() -> None:
    telemetry.record_live_loop_pair("ok")
    telemetry.record_live_loop_drain_failure("signals")
    telemetry.record_live_loop_trigger("entry", "alerted")
    telemetry.record_live_loop_cycle_duration(0.5)
    telemetry.record_fundsignal_signal("emitted")
    telemetry.record_opportunity_recompute("full", "ok")
    telemetry.record_template_instantiate()
    telemetry.record_template_instantiate(grpc.StatusCode.NOT_FOUND)
    telemetry.log_tick_ok(logging.getLogger("allowlist"), telemetry.Loop.FUNDSIGNAL, 1.0)


def _keys_by_instrument(reader) -> dict[str, set[str]]:
    data = reader.get_metrics_data()
    out: dict[str, set[str]] = {}
    for rm in data.resource_metrics if data else []:
        for sm in rm.scope_metrics:
            for m in sm.metrics:
                keys = out.setdefault(m.name, set())
                for p in m.data.data_points:
                    keys.update(dict(p.attributes))
    return out


def test_ac41_every_label_key_is_a_module_constant(metric_reader):
    _drive()
    collected = _keys_by_instrument(metric_reader)
    assert MIN_INSTRUMENTS <= set(collected)
    for name in MIN_INSTRUMENTS:
        assert collected[name] <= ALLOWED_KEYS, (name, collected[name])
        assert not collected[name] & FORBIDDEN_KEYS, (name, collected[name])


def test_ac41_rpc_server_duration_keeps_name_and_keys(metric_reader):
    from opentelemetry.sdk.trace import TracerProvider
    from opentelemetry.trace import SpanKind

    tp = TracerProvider()
    tp.add_span_processor(telemetry._make_rpc_duration_processor())
    attrs = {"rpc.system": "grpc", "rpc.service": "s", "rpc.method": "m"}
    tp.get_tracer("t").start_span("s", kind=SpanKind.SERVER, attributes=attrs).end()
    assert _keys_by_instrument(metric_reader)["rpc.server.duration"] == RPC_KEYS


def test_ac41_live_loop_cycle_literal_is_kept():
    source = (APP / "engine" / "live_loop.py").read_text()
    assert source.count("live_loop: cycle complete") == 1


def _counting_exporter(monkeypatch, raise_on_create=False):
    import opentelemetry.exporter.otlp.proto.http.metric_exporter as metric_exporter

    created = []

    def factory(*_a, **_kw):
        created.append(1)
        if raise_on_create:
            raise RuntimeError("exporter construction failed")
        return object()

    monkeypatch.setattr(metric_exporter, "OTLPMetricExporter", factory)
    return created


def test_ac42_disabled_creates_no_exporter_and_helpers_do_not_raise(otel_reset, monkeypatch):
    monkeypatch.setenv("OTEL_ENABLED", "false")
    created = _counting_exporter(monkeypatch)
    telemetry.init_telemetry()
    _drive()
    assert created == []


def test_ac42_failing_init_still_lets_the_service_start(otel_reset, monkeypatch, caplog):
    monkeypatch.setenv("OTEL_ENABLED", "true")
    created = _counting_exporter(monkeypatch, raise_on_create=True)
    with caplog.at_level(logging.WARNING):
        telemetry.init_telemetry()
    _drive()
    assert created == [1]
    assert "OTel init failed" in caplog.text


def _callee(call: ast.Call) -> str | None:
    f = call.func
    return f.id if isinstance(f, ast.Name) else f.attr if isinstance(f, ast.Attribute) else None


def _loop_arguments() -> list[ast.expr]:
    """The loop argument of every log_tick_ok call, following one parameter relay."""
    trees = [ast.parse(p.read_text()) for p in APP.rglob("*.py")]
    args, relays = [], {}
    for tree in trees:
        for fn in ast.walk(tree):
            if not isinstance(fn, ast.FunctionDef | ast.AsyncFunctionDef):
                continue
            params = [a.arg for a in fn.args.args]
            for call in ast.walk(fn):
                if isinstance(call, ast.Call) and _callee(call) == "log_tick_ok":
                    arg = call.args[1]
                    if isinstance(arg, ast.Name) and arg.id in params:
                        relays[fn.name] = params.index(arg.id)
                    else:
                        args.append(arg)
    for tree in trees:
        for call in ast.walk(tree):
            if isinstance(call, ast.Call) and _callee(call) in relays:
                args.append(call.args[relays[_callee(call)]])
    return args


def test_ac7_every_written_loop_is_in_the_closed_set():
    assert len(telemetry.Loop) <= 8
    args = _loop_arguments()
    assert args, "no log_tick_ok call found"
    for arg in args:
        assert isinstance(arg, ast.Attribute), ast.unparse(arg)
        assert ast.unparse(arg.value).split(".")[-1] == "Loop", ast.unparse(arg)
        assert arg.attr in telemetry.Loop.__members__, ast.unparse(arg)
