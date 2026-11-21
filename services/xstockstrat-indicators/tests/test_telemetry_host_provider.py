"""Unit tests for the host.provider exporter wrapper (feature 337)."""

import logging

import pytest
from opentelemetry.sdk.metrics import Counter, MeterProvider
from opentelemetry.sdk.metrics.export import (
    AggregationTemporality,
    Metric,
    MetricExporter,
    MetricExportResult,
    MetricsData,
    NumberDataPoint,
    PeriodicExportingMetricReader,
    ResourceMetrics,
    ScopeMetrics,
    Sum,
)
from opentelemetry.sdk.util.instrumentation import InstrumentationScope

from app.telemetry import _with_host_provider


class FakeExporter(MetricExporter):
    def __init__(self):
        super().__init__(preferred_temporality={Counter: AggregationTemporality.DELTA})
        self.exported = []
        self.flushes = []
        self.shutdowns = []

    def export(self, metrics_data, timeout_millis=10_000, **kwargs):
        self.exported.append(metrics_data)
        return MetricExportResult.SUCCESS

    def force_flush(self, timeout_millis=10_000):
        self.flushes.append(timeout_millis)
        return True

    def shutdown(self, timeout_millis=30_000, **kwargs):
        self.shutdowns.append(kwargs.get("timeout", timeout_millis))


def _batch(*attribute_sets):
    points = [
        NumberDataPoint(attributes=attrs, start_time_unix_nano=1, time_unix_nano=2, value=7 + i)
        for i, attrs in enumerate(attribute_sets)
    ]
    metric = Metric(
        name="c",
        description="",
        unit="",
        data=Sum(
            data_points=points,
            aggregation_temporality=AggregationTemporality.DELTA,
            is_monotonic=True,
        ),
    )
    scope = ScopeMetrics(scope=InstrumentationScope("s"), metrics=[metric], schema_url="")
    return MetricsData(
        resource_metrics=[ResourceMetrics(resource=None, scope_metrics=[scope], schema_url="")]
    )


def _points(batch):
    return [
        p
        for rm in batch.resource_metrics
        for sm in rm.scope_metrics
        for m in sm.metrics
        for p in m.data.data_points
    ]


def test_labelling_failure_exports_the_original_batch_and_warns_once(caplog, monkeypatch):
    # B1 @AC-5
    fake = FakeExporter()
    wrapped = _with_host_provider(fake, "homelab")

    def boom(self, metrics_data):
        raise RuntimeError("boom")

    monkeypatch.setattr(type(wrapped), "_labelled", boom, raising=False)
    first, second = _batch({"outcome": "a"}), _batch({"outcome": "b"})
    with caplog.at_level(logging.WARNING):
        assert wrapped.export(first) == MetricExportResult.SUCCESS
        assert wrapped.export(second) == MetricExportResult.SUCCESS
    assert fake.exported[0] is first and fake.exported[1] is second
    for batch in fake.exported:
        assert all("host.provider" not in p.attributes for p in _points(batch))
    assert [p.value for p in _points(fake.exported[0])] == [7]
    warnings = [r for r in caplog.records if "host_provider" in r.getMessage()]
    assert len(warnings) == 1


def test_existing_host_provider_key_is_overwritten_and_input_untouched():
    # B2 @AC-13
    fake = FakeExporter()
    original = _batch({"host.provider": "x", "outcome": "ok"})
    _with_host_provider(fake, "homelab").export(original)
    (point,) = _points(fake.exported[0])
    assert dict(point.attributes) == {"host.provider": "homelab", "outcome": "ok"}
    assert point.value == 7
    assert _points(original)[0].attributes["host.provider"] == "x"


def test_every_point_of_a_batch_is_labelled():
    fake = FakeExporter()
    _with_host_provider(fake, "digitalocean").export(_batch({"o": "a"}, {"o": "b"}, {}))
    assert [dict(p.attributes) for p in _points(fake.exported[0])] == [
        {"o": "a", "host.provider": "digitalocean"},
        {"o": "b", "host.provider": "digitalocean"},
        {"host.provider": "digitalocean"},
    ]


def test_wrapper_keeps_preferred_temporality_and_forwards_flush_and_shutdown():
    # B3 @AC-21, B4
    fake = FakeExporter()
    wrapped = _with_host_provider(fake, "homelab")
    assert wrapped._preferred_temporality[Counter] == AggregationTemporality.DELTA
    wrapped.force_flush(123)
    wrapped.shutdown(timeout_millis=5)
    assert fake.flushes == [123]
    assert len(fake.shutdowns) == 1


def test_periodic_reader_shutdown_reaches_the_inner_exporter():
    # @AC-16: the reader calls shutdown(timeout=...) and must not raise.
    fake = FakeExporter()
    reader = PeriodicExportingMetricReader(
        _with_host_provider(fake, "homelab"), export_interval_millis=3_600_000
    )
    MeterProvider(metric_readers=[reader])
    reader.shutdown()
    assert len(fake.shutdowns) == 1


def test_a_bare_object_exporter_does_not_break_construction():
    # test_telemetry_allowlist replaces the exporter with object(); construction must not raise.
    _with_host_provider(object(), "homelab")


@pytest.mark.parametrize("provider", ["homelab", "digitalocean", "unknown"])
def test_label_value_is_the_given_provider(provider):
    fake = FakeExporter()
    _with_host_provider(fake, provider).export(_batch({}))
    assert _points(fake.exported[0])[0].attributes["host.provider"] == provider
