"""OpenTelemetry initialisation for xstockstrat-indicators.

Activated only when OTEL_ENABLED=true. All imports are deferred so the
service starts cleanly if the OTel packages are absent.
"""

import asyncio
import inspect
import logging
import os

import grpc

log = logging.getLogger(__name__)

# Matches scripts/testdata/rpc-status-vectors.json bucket bounds (shared by all runtimes).
RPC_DURATION_BUCKETS_MS = [0, 5, 10, 25, 50, 75, 100, 250, 500, 750, 1000, 2500, 5000, 7500, 10000]


def _enabled() -> bool:
    return os.getenv("OTEL_ENABLED", "false").lower() == "true"


def _build_resource():
    """Build the sole OTel Resource passed to init_telemetry (SDK import deferred; the omitted
    attributes are guarded by tests/test_telemetry.py)."""
    from opentelemetry.sdk.resources import Resource

    return Resource.create(
        {
            "service.name": os.getenv("SERVICE_NAME", "indicators"),
            "deployment.environment": os.getenv("APPLICATION_ENV", "development"),
            "platform": "xstockstrat",
        }
    )


def grpc_status_code(span) -> int:
    """Integer gRPC status of a finished SERVER span; first match wins."""
    from opentelemetry.trace import StatusCode

    code = span.attributes.get("rpc.grpc.status_code")
    if isinstance(code, int) and not isinstance(code, bool) and code != 0:
        return code
    if any(event.name == "exception" for event in span.events):
        return 2
    if span.status.status_code == StatusCode.ERROR:
        return 2
    return 0


def _make_rpc_duration_processor():
    from opentelemetry import metrics
    from opentelemetry.sdk.trace import SpanProcessor
    from opentelemetry.trace import SpanKind

    class RpcDurationProcessor(SpanProcessor):
        """Records `rpc.server.duration` (ms) from finished gRPC SERVER spans: instrumentation-grpc
        emits no RPC metric, so the histogram is derived from the span it already creates."""

        def __init__(self) -> None:
            self._histogram = None

        def on_end(self, span) -> None:
            attrs = span.attributes or {}
            if span.kind != SpanKind.SERVER or attrs.get("rpc.system") != "grpc":
                return
            if self._histogram is None:
                # Created on first use, from the provider installed by then.
                self._histogram = metrics.get_meter("xstockstrat.rpc").create_histogram(
                    "rpc.server.duration",
                    unit="ms",
                    explicit_bucket_boundaries_advisory=RPC_DURATION_BUCKETS_MS,
                )
            self._histogram.record(
                (span.end_time - span.start_time) / 1e6,
                {
                    "rpc.system": "grpc",
                    "rpc.service": str(attrs.get("rpc.service", "")),
                    "rpc.method": str(attrs.get("rpc.method", "")),
                    "rpc.grpc.status_code": grpc_status_code(span),
                },
            )

    return RpcDurationProcessor()


def _stamp_cancel_status(context) -> None:
    """Stamp the live span 4 (deadline expired) or 1 (client cancel) before the cancel unwinds."""
    from opentelemetry import trace

    try:
        remaining = context.time_remaining()
    except Exception:  # noqa: BLE001
        remaining = None
    code = 4 if remaining is not None and remaining <= 0 else 1
    trace.get_current_span().set_attribute("rpc.grpc.status_code", code)


class _CancelStatusInterceptor(grpc.aio.ServerInterceptor):
    """Stamps the span's status on cancellation, which instrumentation-grpc never sees (it catches
    Exception, and CancelledError is a BaseException)."""

    _FACTORIES = {
        (False, False): ("unary_unary", grpc.unary_unary_rpc_method_handler),
        (False, True): ("unary_stream", grpc.unary_stream_rpc_method_handler),
        (True, False): ("stream_unary", grpc.stream_unary_rpc_method_handler),
        (True, True): ("stream_stream", grpc.stream_stream_rpc_method_handler),
    }

    async def intercept_service(self, continuation, handler_call_details):
        handler = await continuation(handler_call_details)
        if handler is None:
            return None
        attr, factory = self._FACTORIES[
            (bool(handler.request_streaming), bool(handler.response_streaming))
        ]
        behavior = getattr(handler, attr, None)
        if behavior is None:
            return handler

        if inspect.isasyncgenfunction(behavior):

            async def wrapped(request_or_iterator, context):
                try:
                    async for item in behavior(request_or_iterator, context):
                        yield item
                except asyncio.CancelledError:
                    _stamp_cancel_status(context)
                    raise

        elif inspect.iscoroutinefunction(behavior):

            async def wrapped(request_or_iterator, context):
                try:
                    return await behavior(request_or_iterator, context)
                except asyncio.CancelledError:
                    _stamp_cancel_status(context)
                    raise

        else:
            return handler

        return factory(
            wrapped,
            request_deserializer=handler.request_deserializer,
            response_serializer=handler.response_serializer,
        )


def server_interceptors() -> list:
    """Interceptors for grpc.aio.server(); empty when telemetry is disabled."""
    return [_CancelStatusInterceptor()] if _enabled() else []


def init_telemetry() -> None:
    """Configure OTel trace, metric and log providers and instrument gRPC. No-op when disabled."""
    if not _enabled():
        return

    try:
        from opentelemetry import metrics, trace
        from opentelemetry._logs import set_logger_provider
        from opentelemetry.exporter.otlp.proto.http._log_exporter import OTLPLogExporter
        from opentelemetry.exporter.otlp.proto.http.metric_exporter import OTLPMetricExporter
        from opentelemetry.exporter.otlp.proto.http.trace_exporter import OTLPSpanExporter
        from opentelemetry.instrumentation.grpc import GrpcAioInstrumentorServer
        from opentelemetry.instrumentation.logging.handler import LoggingHandler
        from opentelemetry.sdk._logs import LoggerProvider
        from opentelemetry.sdk._logs.export import BatchLogRecordProcessor
        from opentelemetry.sdk.metrics import MeterProvider
        from opentelemetry.sdk.metrics.export import PeriodicExportingMetricReader
        from opentelemetry.sdk.trace import TracerProvider
        from opentelemetry.sdk.trace.export import BatchSpanProcessor

        endpoint = os.getenv("OTEL_EXPORTER_OTLP_ENDPOINT")
        svc_name = os.getenv("SERVICE_NAME", "indicators")

        resource = _build_resource()
        # No endpoint/insecure args: they override OTEL_EXPORTER_OTLP_* (path, TLS, headers).
        span_exporter = OTLPSpanExporter()
        metric_exporter = OTLPMetricExporter()
        log_exporter = OTLPLogExporter()

        provider = TracerProvider(resource=resource)
        provider.add_span_processor(BatchSpanProcessor(span_exporter))
        provider.add_span_processor(_make_rpc_duration_processor())
        trace.set_tracer_provider(provider)

        meter_provider = MeterProvider(
            resource=resource,
            metric_readers=[PeriodicExportingMetricReader(metric_exporter)],
        )
        metrics.set_meter_provider(meter_provider)

        logger_provider = LoggerProvider(resource=resource)
        logger_provider.add_log_record_processor(BatchLogRecordProcessor(log_exporter))
        set_logger_provider(logger_provider)

        # Providers register their own atexit flush. The filter keeps SDK/exporter failure logs
        # ("opentelemetry*") off this handler so they cannot loop back into export.
        handler = LoggingHandler(level=logging.NOTSET, logger_provider=logger_provider)
        handler.addFilter(lambda record: not record.name.startswith("opentelemetry"))
        logging.getLogger().addHandler(handler)

        GrpcAioInstrumentorServer().instrument()

        log.info("OTel tracing initialised", extra={"endpoint": endpoint, "service": svc_name})

    except Exception as exc:  # noqa: BLE001
        log.warning("OTel init failed — continuing without tracing: %s", exc)
