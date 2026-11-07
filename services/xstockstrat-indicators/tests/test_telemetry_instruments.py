"""Rebinding metric accessors (AC-42)."""

import logging

from app import telemetry
from tests import test_telemetry

# The fixture is local to test_telemetry.py (not conftest); this binding exposes it here.
metric_reader = test_telemetry.metric_reader


def _data_points(reader, name):
    data = reader.get_metrics_data()
    return [
        p
        for rm in (data.resource_metrics if data else [])
        for sm in rm.scope_metrics
        for m in sm.metrics
        if m.name == name
        for p in m.data.data_points
    ]


def _points(reader, name):
    return [p.value for p in _data_points(reader, name)]


def _histogram_counts(reader, name):
    return [p.count for p in _data_points(reader, name)]


def _fresh_reader(monkeypatch):
    """Re-arm the set-once exactly as `otel_reset` does and install a second in-memory reader."""
    from opentelemetry import metrics
    from opentelemetry.metrics import _internal as metrics_internal
    from opentelemetry.sdk.metrics import MeterProvider
    from opentelemetry.sdk.metrics.export import InMemoryMetricReader
    from opentelemetry.util._once import Once

    old = metrics.get_meter_provider()
    monkeypatch.setattr(metrics_internal, "_METER_PROVIDER_SET_ONCE", Once())
    monkeypatch.setattr(metrics_internal, "_METER_PROVIDER", None)
    reader = InMemoryMetricReader()
    metrics.set_meter_provider(MeterProvider(metric_readers=[reader]))
    return reader, old


def _no_duplicate_warning(caplog):
    return not [
        r
        for r in caplog.records
        if r.name.startswith("opentelemetry") and r.levelno >= logging.WARNING
    ]


def test_counter_rebinds_on_provider_change(metric_reader, monkeypatch, caplog):
    caplog.set_level(logging.WARNING)
    counter = telemetry.Counter("test.instruments.counter")
    counter.add(2)
    counter.add(1)
    assert _points(metric_reader, "test.instruments.counter") == [3]

    reader_b, old = _fresh_reader(monkeypatch)
    counter.add(5)
    assert _points(reader_b, "test.instruments.counter") == [5]
    assert _points(metric_reader, "test.instruments.counter") == [3]
    old.shutdown()
    assert _no_duplicate_warning(caplog)


def test_histogram_rebinds_on_provider_change(metric_reader, monkeypatch, caplog):
    caplog.set_level(logging.WARNING)
    hist = telemetry.Histogram("test.instruments.histogram", unit="ms", buckets=[10.0, 100.0])
    hist.record(5.0)
    assert _histogram_counts(metric_reader, "test.instruments.histogram") == [1]

    reader_b, old = _fresh_reader(monkeypatch)
    hist.record(50.0)
    hist.record(500.0)
    assert _histogram_counts(reader_b, "test.instruments.histogram") == [2]
    old.shutdown()
    assert _no_duplicate_warning(caplog)


def test_gauge_rebinds_on_provider_change(metric_reader, monkeypatch, caplog):
    caplog.set_level(logging.WARNING)
    value = {"v": 7.0}
    gauge = telemetry.Gauge("test.instruments.gauge", lambda: value["v"])
    gauge.register()
    gauge.register()
    assert _points(metric_reader, "test.instruments.gauge") == [7.0]

    reader_b, old = _fresh_reader(monkeypatch)
    gauge.register()
    value["v"] = 9.0
    assert _points(reader_b, "test.instruments.gauge") == [9.0]
    assert _points(metric_reader, "test.instruments.gauge") == []
    old.shutdown()
    assert _no_duplicate_warning(caplog)


def test_gauge_reports_nothing_when_observe_returns_none(metric_reader):
    telemetry.Gauge("test.instruments.gauge_none", lambda: None).register()
    assert _points(metric_reader, "test.instruments.gauge_none") == []


def _raise(*_args, **_kwargs):
    raise RuntimeError("instrument fault")


def test_raising_instrument_does_not_propagate(metric_reader, monkeypatch):
    counter = telemetry.Counter("test.instruments.raise_counter")
    hist = telemetry.Histogram("test.instruments.raise_histogram")
    monkeypatch.setattr(type(counter._instrument()), "add", _raise)
    monkeypatch.setattr(type(hist._instrument()), "record", _raise)
    counter.add(1)
    hist.record(1.0)

    gauge = telemetry.Gauge("test.instruments.raise_gauge", _raise)
    gauge.register()
    assert _points(metric_reader, "test.instruments.raise_gauge") == []

    broken = telemetry.Gauge("test.instruments.raise_register", lambda: 1.0)
    monkeypatch.setattr(broken, "_create", _raise)
    broken.register()


def test_disabled_helpers_are_noops_and_init_creates_no_exporter(otel_reset, monkeypatch):
    from opentelemetry import metrics
    from opentelemetry.exporter.otlp.proto.http import (
        _log_exporter,
        metric_exporter,
        trace_exporter,
    )
    from opentelemetry.metrics import _internal as metrics_internal

    created = []
    for module, name in (
        (trace_exporter, "OTLPSpanExporter"),
        (metric_exporter, "OTLPMetricExporter"),
        (_log_exporter, "OTLPLogExporter"),
    ):
        monkeypatch.setattr(module, name, lambda *_a, _n=name, **_k: created.append(_n))
    monkeypatch.delenv("OTEL_ENABLED", raising=False)
    telemetry.init_telemetry()
    assert created == []
    assert metrics.get_meter_provider() is metrics_internal._PROXY_METER_PROVIDER

    counter = telemetry.Counter("test.instruments.disabled_counter")
    hist = telemetry.Histogram("test.instruments.disabled_histogram")
    gauge = telemetry.Gauge("test.instruments.disabled_gauge", lambda: 1.0)
    counter.add(1)
    hist.record(1.0)
    gauge.register()
    assert (counter._inst, hist._inst, gauge._inst) == (None, None, None)
