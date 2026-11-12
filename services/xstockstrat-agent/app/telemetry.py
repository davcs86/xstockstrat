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


def _host_provider() -> str:
    # Exact lowercase deploy-target names only; anything else is "unknown", never an error.
    p = os.getenv("HOST_PROVIDER", "")
    return p if p in ("digitalocean", "homelab") else "unknown"


def _build_resource():
    """Build the sole OTel Resource passed to init_telemetry (SDK import deferred; the omitted
    attributes are guarded by tests/test_telemetry.py)."""
    from opentelemetry.sdk.resources import Resource

    service_name = os.getenv("SERVICE_NAME", "agent")
    provider = _host_provider()
    return Resource.create(
        {
            "service.name": service_name,
            "deployment.environment": os.getenv("APPLICATION_ENV", "development"),
            "platform": "xstockstrat",
            "host.provider": provider,
            "service.instance.id": f"{provider}-{service_name}",
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


_METER_NAME = "xstockstrat.agent"


def _current_provider():
    """The installed MeterProvider, or None while only the API's default proxy is in place."""
    from opentelemetry import metrics
    from opentelemetry.metrics import _internal as metrics_internal

    provider = metrics.get_meter_provider()
    if provider is getattr(metrics_internal, "_PROXY_METER_PROVIDER", None):
        return None
    return provider


class _Bound:
    """One instrument, re-created whenever the global MeterProvider's identity changes."""

    def __init__(self, name: str, **kwargs) -> None:
        self._name = name
        self._kwargs = kwargs
        self._provider = None
        self._inst = None

    def _create(self, meter):
        raise NotImplementedError

    def _instrument(self):
        provider = _current_provider()
        if provider is None:
            return None
        if self._inst is None or provider is not self._provider:
            self._inst = self._create(provider.get_meter(_METER_NAME))
            self._provider = provider
        return self._inst


class Counter(_Bound):
    def __init__(self, name: str, unit: str = "", description: str = "") -> None:
        super().__init__(name, unit=unit, description=description)

    def _create(self, meter):
        return meter.create_counter(self._name, **self._kwargs)

    def add(self, amount: int = 1, attributes: dict | None = None) -> None:
        try:
            inst = self._instrument()
            if inst is not None:
                inst.add(amount, attributes)
        except Exception:  # noqa: BLE001
            pass


class Histogram(_Bound):
    def __init__(
        self,
        name: str,
        unit: str = "",
        description: str = "",
        buckets: list[float] | None = None,
    ) -> None:
        super().__init__(
            name, unit=unit, description=description, explicit_bucket_boundaries_advisory=buckets
        )

    def _create(self, meter):
        return meter.create_histogram(self._name, **self._kwargs)

    def record(self, value: float, attributes: dict | None = None) -> None:
        try:
            inst = self._instrument()
            if inst is not None:
                inst.record(value, attributes)
        except Exception:  # noqa: BLE001
            pass


class Gauge(_Bound):
    """Observable gauge; `observe()` returns the sample, or None to report nothing. Call
    `register()` after the MeterProvider is installed (and again after it changes)."""

    def __init__(self, name: str, observe, unit: str = "", description: str = "") -> None:
        super().__init__(name, unit=unit, description=description)
        self._observe = observe

    def _create(self, meter):
        from opentelemetry.metrics import Observation

        created = []

        def callback(_options):
            try:
                # A superseded provider keeps calling this; only the current binding reports.
                if created and self._inst is created[0]:
                    value = self._observe()
                    if value is not None:
                        return [Observation(value)]
            except Exception:  # noqa: BLE001
                pass
            return []

        inst = meter.create_observable_gauge(self._name, callbacks=[callback], **self._kwargs)
        created.append(inst)
        return inst

    def register(self) -> None:
        try:
            self._instrument()
        except Exception:  # noqa: BLE001
            pass


# Label keys; every attribute the agent's record helpers (app/tool_metrics.py) write uses one.
KEY_REASON = "reason"
KEY_GRANT_TYPE = "grant_type"
KEY_OUTCOME = "outcome"
KEY_BACKEND = "backend"
KEY_GRPC_CODE = "grpc_code"
KEY_KIND = "kind"

AUTH_REJECTED = Counter("mcp.auth.rejected", description="MCP gate rejections by reason")
OAUTH_REQUESTS = Counter("oauth.requests", description="POST /oauth/token by grant and outcome")
OAUTH_TXN_REJECTED = Counter("oauth.txn.rejected", description="Rejected OAuth txn blobs by reason")
BACKEND_RPC_ERRORS = Counter(
    "agent.backend.rpc_errors", description="Backend gRPC errors leaving a secure_channel block"
)
DEGRADED = Counter("agent.degraded", description="Best-effort steps that fell back or were skipped")
