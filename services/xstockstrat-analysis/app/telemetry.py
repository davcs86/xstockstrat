"""OpenTelemetry initialisation for xstockstrat-analysis.

Activated only when OTEL_ENABLED=true. All imports are deferred so the
service starts cleanly if the OTel packages are absent.
"""
import logging
import os

log = logging.getLogger(__name__)


def init_telemetry() -> None:
    """Configure OTel TracerProvider and instrument gRPC. No-op when disabled."""
    if os.getenv("OTEL_ENABLED", "false").lower() != "true":
        return

    try:
        from opentelemetry import trace
        from opentelemetry.exporter.otlp.proto.grpc.trace_exporter import OTLPSpanExporter
        from opentelemetry.instrumentation.grpc import GrpcAioInstrumentorServer
        from opentelemetry.sdk.resources import Resource
        from opentelemetry.sdk.trace import TracerProvider
        from opentelemetry.sdk.trace.export import BatchSpanProcessor

        endpoint = os.getenv("OTEL_EXPORTER_OTLP_ENDPOINT", "otel-collector:4317")
        svc_name = os.getenv("OTEL_SERVICE_NAME", "xstockstrat-analysis")
        environment = os.getenv("APP_ENV", "dev")

        resource = Resource.create(
            {
                "service.name": svc_name,
                "deployment.environment": environment,
            }
        )
        exporter = OTLPSpanExporter(endpoint=endpoint, insecure=True)
        provider = TracerProvider(resource=resource)
        provider.add_span_processor(BatchSpanProcessor(exporter))
        trace.set_tracer_provider(provider)

        GrpcAioInstrumentorServer().instrument()

        log.info("OTel tracing initialised", extra={"endpoint": endpoint, "service": svc_name})

    except Exception as exc:  # noqa: BLE001
        log.warning("OTel init failed — continuing without tracing: %s", exc)
