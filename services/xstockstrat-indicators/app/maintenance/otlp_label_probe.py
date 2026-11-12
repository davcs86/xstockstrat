"""Operator probe (feature 337 Step 1): does a datapoint attribute become a metric label?

Runs in the indicators image (DO console, /app) on the dev app, which already injects the OTLP
endpoint and headers:
    python -m app.maintenance.otlp_label_probe
Exports ONE smoke batch (deployment.environment=smoke) with the real OTLP exporter, then prints
the queries to run within 5 minutes. Exit 0 = exported, 1 = export failed, 2 = OTLP env missing.
The resource is built directly, so OTEL_RESOURCE_ATTRIBUTES cannot alter it; headers are never
printed. The smoke series go stale on their own.
"""

import argparse
import os
import sys
from datetime import UTC, datetime
from urllib.parse import urlsplit

from opentelemetry.exporter.otlp.proto.http.metric_exporter import OTLPMetricExporter
from opentelemetry.sdk.metrics import MeterProvider
from opentelemetry.sdk.metrics.export import InMemoryMetricReader, MetricExportResult
from opentelemetry.sdk.resources import Resource

PROVIDER_KEY = "host.provider"
PROBE = "smoke337.probe"
JOIN = "smoke337.join"
RESOURCE = {
    "service.name": "smoke-337",
    "deployment.environment": "smoke",
    PROVIDER_KEY: "unknown",
    "service.instance.id": "smoke-337",
}
SELECTOR = 'deployment_environment="smoke"'
PROBE_QUERY = f"smoke337_probe_total{{{SELECTOR}}}"
LEFT = f"last_over_time(smoke337_join_total{{{SELECTOR}}}[15m])"
JOIN_TAIL = (
    "* on (job, instance, deployment_environment) group_left (host_provider) "
    f"group by (job, instance, deployment_environment, host_provider) (target_info{{{SELECTOR}}})"
)
GREEN_QUERY = f"sum without (host_provider) ({LEFT}) {JOIN_TAIL}"
RED_QUERY = f"{LEFT} {JOIN_TAIL}"


def collect():
    reader = InMemoryMetricReader()
    provider = MeterProvider(resource=Resource(RESOURCE), metric_readers=[reader])
    meter = provider.get_meter("xstockstrat.smoke337")
    meter.create_counter(PROBE).add(1, {PROVIDER_KEY: "homelab"})
    join = meter.create_counter(JOIN)
    join.add(1)
    join.add(1, {PROVIDER_KEY: "homelab"})
    data = reader.get_metrics_data()
    provider.shutdown()
    return data


def main(argv=None) -> int:
    argparse.ArgumentParser(
        prog="python -m app.maintenance.otlp_label_probe", description=__doc__
    ).parse_args(argv)
    endpoint = os.environ.get("OTEL_EXPORTER_OTLP_ENDPOINT")
    if not endpoint or not os.environ.get("OTEL_EXPORTER_OTLP_HEADERS"):
        print("OTEL_EXPORTER_OTLP_ENDPOINT and OTEL_EXPORTER_OTLP_HEADERS must be set")
        return 2
    sent_at = datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%SZ")
    host = urlsplit(endpoint).netloc or "?"
    if OTLPMetricExporter().export(collect()) != MetricExportResult.SUCCESS:
        print(f"export failed to {host} (check the endpoint and headers; nothing was recorded)")
        return 1
    print(f"exported {sent_at} to {host}: {PROBE} x1, {JOIN} x2 as {RESOURCE}")
    print("Within 5 minutes, on datasource grafanacloud-prom:")
    print(f"  AC-17: {PROBE_QUERY}")
    print("         one series with host_provider=homelab; its label names hold host_provider,")
    print("         not host.provider")
    print(f"  AC-22 GREEN: sum by (service_name, host_provider) ({GREEN_QUERY})")
    print("         exactly 1 row, value 2")
    print(f"  AC-22 RED: sum by (service_name, host_provider) ({RED_QUERY})")
    print("         a many-to-one duplicate-labels error, or record that it did not reproduce")
    return 0


if __name__ == "__main__":
    sys.exit(main())
