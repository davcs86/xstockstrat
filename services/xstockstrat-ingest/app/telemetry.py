"""
OpenTelemetry instrumentation for xstockstrat-ingest.

Configures global OTEL providers for traces, metrics, and logs.
No-op when OTEL_ENABLED != "true" or when OTel packages are not installed.
"""
import logging
import os

log = logging.getLogger(__name__)


def init(service_name: str) -> None:
    """Configure global OTEL providers. No-op when OTEL_ENABLED != 'true'."""
    if os.environ.get("OTEL_ENABLED") != "true":
        return

    try:
        from opentelemetry import trace, metrics
        from opentelemetry.sdk.resources import Resource, SERVICE_NAME
        from opentelemetry.sdk.trace import TracerProvider
        from opentelemetry.sdk.trace.export import BatchSpanProcessor
        from opentelemetry.sdk.metrics import MeterProvider
        from opentelemetry.sdk.metrics.export import PeriodicExportingMetricReader
        from opentelemetry.exporter.otlp.proto.http.trace_exporter import OTLPSpanExporter
        from opentelemetry.exporter.otlp.proto.http.metric_exporter import OTLPMetricExporter
        from opentelemetry.instrumentation.logging import LoggingInstrumentor
    except ImportError as exc:
        log.warning("opentelemetry packages not installed, skipping otel init: %s", exc)
        return

    resource = Resource(attributes={SERVICE_NAME: service_name})

    provider = TracerProvider(resource=resource)
    provider.add_span_processor(BatchSpanProcessor(OTLPSpanExporter()))
    trace.set_tracer_provider(provider)

    reader = PeriodicExportingMetricReader(OTLPMetricExporter(), export_interval_millis=10_000)
    meter_provider = MeterProvider(resource=resource, metric_readers=[reader])
    metrics.set_meter_provider(meter_provider)

    # Injects trace_id / span_id into stdlib log records
    LoggingInstrumentor().instrument(set_logging_format=True)

    log.info("opentelemetry initialized for service=%s", service_name)
