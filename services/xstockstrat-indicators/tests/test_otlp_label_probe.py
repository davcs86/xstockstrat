"""Feature 337 Step 1 probe: what it exports, its exit codes, and that headers never leak."""

import pytest
from opentelemetry.sdk.metrics.export import MetricExportResult

from app.maintenance import otlp_label_probe as probe

SECRET = "Authorization=Basic c2VjcmV0LXRva2Vu"


class FakeExporter:
    result = MetricExportResult.SUCCESS
    batches: list = []

    def export(self, metrics_data, timeout_millis=10000, **kwargs):
        type(self).batches.append(metrics_data)
        return type(self).result


@pytest.fixture
def exporter(monkeypatch):
    FakeExporter.result = MetricExportResult.SUCCESS
    FakeExporter.batches = []
    monkeypatch.setattr(probe, "OTLPMetricExporter", FakeExporter)
    monkeypatch.setenv("OTEL_EXPORTER_OTLP_ENDPOINT", "https://otlp-gateway.example.test/otlp")
    monkeypatch.setenv("OTEL_EXPORTER_OTLP_HEADERS", SECRET)
    return FakeExporter


def _points(batch, name):
    (rm,) = batch.resource_metrics
    (sm,) = rm.scope_metrics
    (metric,) = [m for m in sm.metrics if m.name == name]
    return rm.resource, [(dict(p.attributes), p.value) for p in metric.data.data_points]


def test_exports_the_datapoint_shapes_ac17_and_ac22(exporter):
    assert probe.main([]) == 0
    (batch,) = exporter.batches
    resource, probe_points = _points(batch, "smoke337.probe")
    _, join_points = _points(batch, "smoke337.join")
    assert dict(resource.attributes) == {
        "service.name": "smoke-337",
        "deployment.environment": "smoke",
        "host.provider": "unknown",
        "service.instance.id": "smoke-337",
    }
    assert probe_points == [({"host.provider": "homelab"}, 1)]
    assert sorted(join_points, key=lambda p: len(p[0])) == [
        ({}, 1),
        ({"host.provider": "homelab"}, 1),
    ]


def test_failed_export_exits_1(exporter, capsys):
    exporter.result = MetricExportResult.FAILURE
    assert probe.main([]) == 1
    assert "export failed" in capsys.readouterr().out


@pytest.mark.parametrize("missing", ["OTEL_EXPORTER_OTLP_ENDPOINT", "OTEL_EXPORTER_OTLP_HEADERS"])
def test_missing_config_exits_2_without_exporting(exporter, monkeypatch, missing):
    monkeypatch.delenv(missing)
    assert probe.main([]) == 2
    assert exporter.batches == []


def test_output_prints_queries_and_endpoint_host_but_never_headers(exporter, capsys):
    assert probe.main([]) == 0
    out = capsys.readouterr().out
    assert "c2VjcmV0" not in out and "Authorization" not in out
    assert "otlp-gateway.example.test" in out
    assert 'smoke337_probe_total{deployment_environment="smoke"}' in out
    assert "sum without (host_provider) (" in out
    assert "group_left (host_provider)" in out
    assert "last_over_time(smoke337_join_total" in out
