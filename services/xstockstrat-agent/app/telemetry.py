"""OpenTelemetry initialisation for xstockstrat-agent.

Activated only when OTEL_ENABLED=true. All imports are deferred so the
service starts cleanly if the OTel packages are absent.

The agent is a gRPC *client* (it dials ingest/notify/analysis/indicators/
identity/config over ``grpc.aio``) rather than a gRPC server, so it
instruments the aio client channel instead of a server.
"""

import logging
import os

log = logging.getLogger(__name__)


def _build_resource():
    """Build the sole OTel Resource passed to init_telemetry (SDK import deferred; the omitted
    attributes are guarded by tests/test_telemetry.py)."""
    from opentelemetry.sdk.resources import Resource

    return Resource.create(
        {
            "service.name": os.getenv("SERVICE_NAME", "agent"),
            "deployment.environment": os.getenv("APPLICATION_ENV", "development"),
            "platform": "xstockstrat",
        }
    )


def init_telemetry() -> None:
    """Configure OTel trace, metric and log providers and instrument the gRPC aio client.

    No-op when disabled.
    """
    if os.getenv("OTEL_ENABLED", "false").lower() != "true":
        return

    try:
        from opentelemetry import metrics, trace
        from opentelemetry._logs import set_logger_provider
        from opentelemetry.exporter.otlp.proto.http._log_exporter import OTLPLogExporter
        from opentelemetry.exporter.otlp.proto.http.metric_exporter import OTLPMetricExporter
        from opentelemetry.exporter.otlp.proto.http.trace_exporter import OTLPSpanExporter
        from opentelemetry.instrumentation.grpc import GrpcAioInstrumentorClient
        from opentelemetry.instrumentation.logging.handler import LoggingHandler
        from opentelemetry.sdk._logs import LoggerProvider
        from opentelemetry.sdk._logs.export import BatchLogRecordProcessor
        from opentelemetry.sdk.metrics import MeterProvider
        from opentelemetry.sdk.metrics.export import PeriodicExportingMetricReader
        from opentelemetry.sdk.trace import TracerProvider
        from opentelemetry.sdk.trace.export import BatchSpanProcessor

        endpoint = os.getenv("OTEL_EXPORTER_OTLP_ENDPOINT")
        svc_name = os.getenv("SERVICE_NAME", "agent")

        resource = _build_resource()
        # No endpoint/insecure args: they override OTEL_EXPORTER_OTLP_* (path, TLS, headers).
        provider = TracerProvider(resource=resource)
        provider.add_span_processor(BatchSpanProcessor(OTLPSpanExporter()))
        trace.set_tracer_provider(provider)

        metrics.set_meter_provider(
            MeterProvider(
                resource=resource,
                metric_readers=[PeriodicExportingMetricReader(OTLPMetricExporter())],
            )
        )

        logger_provider = LoggerProvider(resource=resource)
        logger_provider.add_log_record_processor(BatchLogRecordProcessor(OTLPLogExporter()))
        set_logger_provider(logger_provider)

        # Providers register their own atexit flush. The filter keeps SDK/exporter failure logs
        # ("opentelemetry*") off this handler so they cannot loop back into export.
        handler = LoggingHandler(level=logging.NOTSET, logger_provider=logger_provider)
        handler.addFilter(lambda record: not record.name.startswith("opentelemetry"))
        logging.getLogger().addHandler(handler)

        GrpcAioInstrumentorClient().instrument()

        log.info("OTel tracing initialised", extra={"endpoint": endpoint, "service": svc_name})

    except Exception as exc:  # noqa: BLE001
        log.warning("OTel init failed — continuing without tracing: %s", exc)
