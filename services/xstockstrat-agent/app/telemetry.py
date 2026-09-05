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
    """Configure OTel TracerProvider and instrument the gRPC aio client. No-op when disabled."""
    if os.getenv("OTEL_ENABLED", "false").lower() != "true":
        return

    try:
        from opentelemetry import trace
        from opentelemetry.exporter.otlp.proto.grpc.trace_exporter import OTLPSpanExporter
        from opentelemetry.instrumentation.grpc import GrpcAioInstrumentorClient
        from opentelemetry.sdk.trace import TracerProvider
        from opentelemetry.sdk.trace.export import BatchSpanProcessor

        endpoint = os.getenv("OTEL_EXPORTER_OTLP_ENDPOINT", "otel-collector:4317")
        svc_name = os.getenv("SERVICE_NAME", "agent")

        resource = _build_resource()
        exporter = OTLPSpanExporter(endpoint=endpoint, insecure=True)
        provider = TracerProvider(resource=resource)
        provider.add_span_processor(BatchSpanProcessor(exporter))
        trace.set_tracer_provider(provider)

        GrpcAioInstrumentorClient().instrument()

        log.info("OTel tracing initialised", extra={"endpoint": endpoint, "service": svc_name})

    except Exception as exc:  # noqa: BLE001
        log.warning("OTel init failed — continuing without tracing: %s", exc)
