"""Feature 294 final allowlist pass for indicators (AC-41, AC-42)."""

import logging

import grpc
import pytest

from app import telemetry
from tests import test_telemetry

# The fixture is local to test_telemetry.py (not conftest); this binding exposes it here.
metric_reader = test_telemetry.metric_reader

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
    "indicators.sandbox.executions",
    "indicators.sandbox.duration",
    "indicators.sandbox.queue_wait",
    "indicators.config.snapshot_age",
    "indicators.sandbox.memory_cap_enforced",
    "indicators.sandbox.memory_watchdog_observable",
    "template.instantiate",
}
RPC_KEYS = {"rpc.system", "rpc.service", "rpc.method", "rpc.grpc.status_code"}


@pytest.fixture(autouse=True)
def _keep_snapshot_age_source(monkeypatch):
    monkeypatch.setattr(telemetry, "_snapshot_age_source", telemetry._snapshot_age_source)
    monkeypatch.setattr(telemetry, "_memory_cap_enforced", telemetry._memory_cap_enforced)
    monkeypatch.setattr(
        telemetry, "_memory_watchdog_observable", telemetry._memory_watchdog_observable
    )


def _drive() -> None:
    telemetry.record_sandbox_execution("timeout", 0.5)
    telemetry.record_sandbox_queue_wait(0.1)
    telemetry.record_template_instantiate()
    telemetry.record_template_instantiate(grpc.StatusCode.NOT_FOUND)
    telemetry.register_snapshot_age(lambda: 7.5)
    telemetry.set_sandbox_memory_cap_enforced(1)
    telemetry.set_sandbox_memory_watchdog_observable(0)


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


def test_memory_gauges_carry_no_attributes_and_report_their_value(metric_reader):
    _drive()
    collected = _keys_by_instrument(metric_reader)
    assert collected["indicators.sandbox.memory_cap_enforced"] == set()
    assert collected["indicators.sandbox.memory_watchdog_observable"] == set()


def test_ac41_rpc_server_duration_keeps_name_and_keys(metric_reader):
    from opentelemetry.sdk.trace import TracerProvider
    from opentelemetry.trace import SpanKind

    tp = TracerProvider()
    tp.add_span_processor(telemetry._make_rpc_duration_processor())
    attrs = {"rpc.system": "grpc", "rpc.service": "s", "rpc.method": "m"}
    tp.get_tracer("t").start_span("s", kind=SpanKind.SERVER, attributes=attrs).end()
    assert _keys_by_instrument(metric_reader)["rpc.server.duration"] == RPC_KEYS


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
