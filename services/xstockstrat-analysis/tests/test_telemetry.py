"""Feature 171 — the built OTel Resource must omit the removed trading_mode attribute."""

import logging
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import pytest


def test_build_resource_omits_trading_mode(monkeypatch):
    monkeypatch.setenv("TRADING_MODE", "paper")
    from app.telemetry import _build_resource

    attrs = _build_resource().attributes
    assert "trading_mode" not in attrs
    assert "service.name" in attrs
    assert "deployment.environment" in attrs
    assert attrs["platform"] == "xstockstrat"


def _start_receiver(status):
    seen = []

    class Handler(BaseHTTPRequestHandler):
        def do_POST(self):
            self.rfile.read(int(self.headers.get("Content-Length", 0)))
            seen.append((self.path, self.headers.get("Authorization")))
            self.send_response(status)
            self.end_headers()

        def log_message(self, *args):
            pass

    srv = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return srv, seen


def _export_one_span(monkeypatch, srv, headers):
    monkeypatch.setenv("OTEL_ENABLED", "true")
    monkeypatch.setenv("OTEL_EXPORTER_OTLP_ENDPOINT", f"http://127.0.0.1:{srv.server_port}/otlp")
    monkeypatch.setenv("OTEL_EXPORTER_OTLP_HEADERS", headers)
    from opentelemetry import trace

    from app.telemetry import init_telemetry

    init_telemetry()
    with trace.get_tracer("t").start_as_current_span("s"):
        pass
    trace.get_tracer_provider().force_flush()


@pytest.mark.parametrize(
    "headers", ["Authorization=Basic dGVzdDprZXk=", "Authorization=Basic%20dGVzdDprZXk%3D"]
)
def test_init_exports_over_otlp_http(otel_reset, monkeypatch, headers):
    # Feature 226 AC-1: configured only by OTel spec env vars -> POST <path>/v1/traces with auth.
    srv, seen = _start_receiver(200)
    try:
        _export_one_span(monkeypatch, srv, headers)
    finally:
        srv.shutdown()
        srv.server_close()
    assert ("/otlp/v1/traces", "Basic dGVzdDprZXk=") in seen


def test_init_logs_export_failure(otel_reset, monkeypatch, caplog):
    # Feature 226 AC-3: a rejected export is logged.
    srv, _ = _start_receiver(400)
    try:
        with caplog.at_level(logging.ERROR):
            _export_one_span(monkeypatch, srv, "Authorization=Basic dGVzdDprZXk=")
    finally:
        srv.shutdown()
        srv.server_close()
    assert "code: 400" in caplog.text


# ---- Feature 274: metrics + logs export, rpc.server.duration, cancel status, flush ----

import asyncio  # noqa: E402
import json  # noqa: E402
import os  # noqa: E402
import pathlib  # noqa: E402
import signal  # noqa: E402
import subprocess  # noqa: E402
import sys  # noqa: E402
import time  # noqa: E402

SERVICE_DIR = pathlib.Path(__file__).resolve().parent.parent
VECTORS = json.loads(
    (SERVICE_DIR.parent.parent / "scripts" / "testdata" / "rpc-status-vectors.json").read_text()
)
AUTH = "Basic dGVzdDprZXk="
HEADER_FORMS = ["Authorization=Basic dGVzdDprZXk=", "Authorization=Basic%20dGVzdDprZXk%3D"]


def _start_body_receiver(status=200):
    """Like _start_receiver but also keeps (path, auth, body) for decoding."""
    seen = []

    class Handler(BaseHTTPRequestHandler):
        def do_POST(self):
            body = self.rfile.read(int(self.headers.get("Content-Length", 0)))
            seen.append((self.path, self.headers.get("Authorization"), body))
            self.send_response(status)
            self.end_headers()

        def log_message(self, *args):
            pass

    srv = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return srv, seen


def _enable(monkeypatch, srv, headers=HEADER_FORMS[0]):
    monkeypatch.setenv("OTEL_ENABLED", "true")
    monkeypatch.setenv("OTEL_EXPORTER_OTLP_ENDPOINT", f"http://127.0.0.1:{srv.server_port}/otlp")
    monkeypatch.setenv("OTEL_EXPORTER_OTLP_HEADERS", headers)


def _flush_all():
    from opentelemetry import metrics, trace
    from opentelemetry._logs import get_logger_provider

    trace.get_tracer_provider().force_flush()
    metrics.get_meter_provider().force_flush()
    get_logger_provider().force_flush()


@pytest.fixture
def metric_reader(otel_reset):
    """Global MeterProvider backed by an in-memory reader (the processor reads the global meter)."""
    from opentelemetry import metrics
    from opentelemetry.sdk.metrics import MeterProvider
    from opentelemetry.sdk.metrics.export import InMemoryMetricReader

    reader = InMemoryMetricReader()
    metrics.set_meter_provider(MeterProvider(metric_readers=[reader]))
    return reader


def _duration_points(reader):
    data = reader.get_metrics_data()
    points = []
    for rm in data.resource_metrics if data else []:
        for sm in rm.scope_metrics:
            for m in sm.metrics:
                if m.name == "rpc.server.duration":
                    assert m.unit == "ms"
                    points.extend(m.data.data_points)
    return points


@pytest.mark.parametrize("headers", HEADER_FORMS)
def test_init_exports_metrics_and_logs_with_resource(otel_reset, monkeypatch, headers):
    # AC-19 (extends feature 226 AC-1) + AC-10 indicators row.
    from opentelemetry import metrics
    from opentelemetry.proto.collector.logs.v1 import logs_service_pb2
    from opentelemetry.proto.collector.metrics.v1 import metrics_service_pb2

    from app.telemetry import init_telemetry

    srv, seen = _start_body_receiver()
    try:
        _enable(monkeypatch, srv, headers)
        init_telemetry()
        metrics.get_meter("t").create_counter("t.count").add(1)
        logging.getLogger("t").warning("hello bridge")
        _flush_all()
    finally:
        srv.shutdown()
        srv.server_close()
    by_path = {path: (auth, body) for path, auth, body in seen}
    assert by_path["/otlp/v1/metrics"][0] == AUTH
    assert by_path["/otlp/v1/logs"][0] == AUTH
    metrics_req = metrics_service_pb2.ExportMetricsServiceRequest()
    metrics_req.ParseFromString(by_path["/otlp/v1/metrics"][1])
    logs_req = logs_service_pb2.ExportLogsServiceRequest()
    logs_req.ParseFromString(by_path["/otlp/v1/logs"][1])
    for resource in (metrics_req.resource_metrics[0].resource, logs_req.resource_logs[0].resource):
        res = {a.key: a.value.string_value for a in resource.attributes}
        assert res["platform"] == "xstockstrat"
        assert res["service.name"] and res["deployment.environment"]
        assert "trading_mode" not in res


def test_handler_is_instrumentation_logging_handler(otel_reset, monkeypatch):
    # D8: the bridge handler comes from opentelemetry.instrumentation.logging.
    from app.telemetry import init_telemetry

    srv, _ = _start_body_receiver()
    try:
        _enable(monkeypatch, srv)
        before = list(logging.getLogger().handlers)
        init_telemetry()
        added = [h for h in logging.getLogger().handlers if h not in before]
    finally:
        srv.shutdown()
        srv.server_close()
    assert [type(h).__module__ for h in added] == ["opentelemetry.instrumentation.logging.handler"]


@pytest.mark.parametrize(
    "vector",
    [v for v in VECTORS["vectors"] if "python" in v["applies_to"]],
    ids=lambda v: v["name"],
)
def test_rpc_duration_status_vectors(metric_reader, vector):
    # AC-15: shared status-derivation vectors; buckets are the shared boundaries.
    from opentelemetry.sdk.trace import TracerProvider
    from opentelemetry.trace import SpanKind, Status, StatusCode

    from app.telemetry import _make_rpc_duration_processor

    tp = TracerProvider()
    tp.add_span_processor(_make_rpc_duration_processor())
    spec = vector["span"]
    span = tp.get_tracer("t").start_span(
        "s", kind=getattr(SpanKind, spec["kind"]), attributes=spec["attributes"]
    )
    for ev in spec["events"]:
        span.add_event(ev["name"], ev["attributes"])
    if spec["status"] == "ERROR":
        span.set_status(Status(StatusCode.ERROR))
    span.end()
    points = _duration_points(metric_reader)
    assert len(points) == 1
    assert points[0].attributes["rpc.grpc.status_code"] == vector["expected_code"]
    assert isinstance(points[0].attributes["rpc.grpc.status_code"], int)
    assert points[0].attributes["rpc.system"] == "grpc"
    assert list(points[0].explicit_bounds) == VECTORS["bucket_boundaries_ms"]


def test_rpc_duration_ignores_non_server_or_non_grpc_spans(metric_reader):
    from opentelemetry.sdk.trace import TracerProvider
    from opentelemetry.trace import SpanKind

    from app.telemetry import _make_rpc_duration_processor

    tp = TracerProvider()
    tp.add_span_processor(_make_rpc_duration_processor())
    tr = tp.get_tracer("t")
    tr.start_span("c", kind=SpanKind.CLIENT, attributes={"rpc.system": "grpc"}).end()
    tr.start_span("h", kind=SpanKind.SERVER, attributes={"rpc.system": "http"}).end()
    assert _duration_points(metric_reader) == []


def test_export_failure_visible_on_stdout_not_exported(otel_reset, monkeypatch, caplog):
    # EXTEND feature 226 AC-3: failures stay on the stdout path (opentelemetry* filter).
    from opentelemetry import metrics
    from opentelemetry.proto.collector.logs.v1 import logs_service_pb2

    from app.telemetry import init_telemetry

    srv, seen = _start_body_receiver(400)
    try:
        _enable(monkeypatch, srv)
        with caplog.at_level(logging.ERROR):
            init_telemetry()
            metrics.get_meter("t").create_counter("t.count").add(1)
            logging.getLogger("t").warning("payload")
            _flush_all()
    finally:
        srv.shutdown()
        srv.server_close()
    assert "code: 400" in caplog.text
    for path, _auth, body in seen:
        if path.endswith("/v1/logs"):
            req = logs_service_pb2.ExportLogsServiceRequest()
            req.ParseFromString(body)
            assert b"code: 400" not in req.SerializeToString()


def test_disabled_installs_nothing(otel_reset, monkeypatch):
    from opentelemetry import metrics, trace

    from app.telemetry import init_telemetry, server_interceptors

    monkeypatch.setenv("OTEL_ENABLED", "false")
    before = list(logging.getLogger().handlers)
    init_telemetry()
    assert logging.getLogger().handlers == before
    assert not hasattr(trace.get_tracer_provider(), "force_flush")
    assert not hasattr(metrics.get_meter_provider(), "force_flush")
    assert server_interceptors() == []


def test_real_main_exits_without_hard_exit():
    # The subprocess flush test models main.py's shutdown; this pins that the model is faithful.
    src = (SERVICE_DIR / "app" / "main.py").read_text()
    assert "os._exit" not in src
    assert "sys.exit" not in src


CHILD = """
import asyncio, logging, signal
logging.basicConfig(level=logging.INFO)
from opentelemetry import metrics
from app.telemetry import init_telemetry

async def main():
    init_telemetry()
    c = metrics.get_meter("t").create_counter("t.count")
    c.add(1); c.add(1)
    for i in range(3):
        logging.getLogger("t").info("line %d", i)
    stop = asyncio.Event()
    loop = asyncio.get_running_loop()
    # Mirrors handle_shutdown: the handler only schedules work, it never exits the process.
    signal.signal(signal.SIGTERM, lambda *_: loop.call_soon_threadsafe(stop.set))
    print("ready", flush=True)
    await stop.wait()

asyncio.run(main())
"""


def test_sigterm_flushes_metrics_and_logs_at_normal_exit(monkeypatch):
    srv, seen = _start_body_receiver()
    env = {
        **os.environ,
        "OTEL_ENABLED": "true",
        "OTEL_EXPORTER_OTLP_ENDPOINT": f"http://127.0.0.1:{srv.server_port}/otlp",
        "OTEL_EXPORTER_OTLP_HEADERS": HEADER_FORMS[0],
        "OTEL_METRIC_EXPORT_INTERVAL": "600000",
        "NO_PROXY": "127.0.0.1",
        "no_proxy": "127.0.0.1",
        "PYTHONPATH": str(SERVICE_DIR),
    }
    proc = subprocess.Popen(
        [sys.executable, "-c", CHILD],
        cwd=SERVICE_DIR,
        env=env,
        stdout=subprocess.PIPE,
        stderr=subprocess.DEVNULL,
        text=True,
    )
    try:
        assert proc.stdout.readline().strip() == "ready"
        assert not [p for p, _, _ in seen if p.endswith("/v1/metrics")]
        proc.send_signal(signal.SIGTERM)
        assert proc.wait(timeout=30) == 0
    finally:
        if proc.poll() is None:
            proc.kill()
        srv.shutdown()
        srv.server_close()
    paths = [p for p, _, _ in seen]
    assert "/otlp/v1/metrics" in paths
    assert "/otlp/v1/logs" in paths


def _cancel_status_codes(metric_reader, expected_code, timeout=5.0):
    deadline = time.time() + timeout
    while time.time() < deadline:
        codes = [p.attributes["rpc.grpc.status_code"] for p in _duration_points(metric_reader)]
        if expected_code in codes:
            return codes
        time.sleep(0.05)
    return [p.attributes["rpc.grpc.status_code"] for p in _duration_points(metric_reader)]


async def _serve_sleeper(tp):
    import grpc
    from opentelemetry.instrumentation.grpc import aio_server_interceptor

    from app.telemetry import _CancelStatusInterceptor

    started = asyncio.Event()

    async def sleeper(request, context):
        started.set()
        await asyncio.sleep(30)
        return b""

    handler = grpc.method_handlers_generic_handler(
        "t.T", {"Sleep": grpc.unary_unary_rpc_method_handler(sleeper)}
    )
    server = grpc.aio.server(
        interceptors=[aio_server_interceptor(tracer_provider=tp), _CancelStatusInterceptor()]
    )
    server.add_generic_rpc_handlers((handler,))
    port = server.add_insecure_port("127.0.0.1:0")
    await server.start()
    return server, port, started


def _tracer_provider_with_processor():
    from opentelemetry.sdk.trace import TracerProvider

    from app.telemetry import _make_rpc_duration_processor

    tp = TracerProvider()
    tp.add_span_processor(_make_rpc_duration_processor())
    return tp


def test_deadline_expiry_records_status_4(metric_reader):
    # AC-22: a handler cancelled by an expired client deadline records DEADLINE_EXCEEDED (4).
    import grpc

    async def run():
        server, port, _ = await _serve_sleeper(_tracer_provider_with_processor())
        try:
            async with grpc.aio.insecure_channel(f"127.0.0.1:{port}") as ch:
                with pytest.raises(grpc.aio.AioRpcError) as ei:
                    await ch.unary_unary("/t.T/Sleep")(b"", timeout=0.05)
                assert ei.value.code() == grpc.StatusCode.DEADLINE_EXCEEDED
        finally:
            await server.stop(0)

    asyncio.run(run())
    assert 4 in _cancel_status_codes(metric_reader, 4)


def test_client_cancel_records_status_1(metric_reader):
    # AC-22: a handler cancelled by the client records CANCELLED (1).
    import grpc

    async def run():
        server, port, started = await _serve_sleeper(_tracer_provider_with_processor())
        try:
            async with grpc.aio.insecure_channel(f"127.0.0.1:{port}") as ch:
                call = ch.unary_unary("/t.T/Sleep")(b"")
                await asyncio.wait_for(started.wait(), 5)
                call.cancel()
                with pytest.raises(asyncio.CancelledError):
                    await call
        finally:
            await server.stop(0)

    asyncio.run(run())
    assert 1 in _cancel_status_codes(metric_reader, 1)


def test_run_backtest_log_line_carries_server_span_trace_context(otel_reset, caplog):
    # AC-3: the real `running backtest` INFO record is correlated to the surrounding SERVER span,
    # and the stdout (caplog) line is unchanged.
    from unittest.mock import AsyncMock, MagicMock

    from opentelemetry.instrumentation.logging.handler import LoggingHandler
    from opentelemetry.sdk._logs import LoggerProvider
    from opentelemetry.sdk._logs.export import InMemoryLogRecordExporter, SimpleLogRecordProcessor
    from opentelemetry.sdk.trace import TracerProvider
    from opentelemetry.trace import SpanKind

    from tests.test_analysis_servicer import TestRunBacktest, _owned_ctx, make_servicer

    exporter = InMemoryLogRecordExporter()
    provider = LoggerProvider()
    provider.add_log_record_processor(SimpleLogRecordProcessor(exporter))
    handler = LoggingHandler(level=logging.NOTSET, logger_provider=provider)

    svc = make_servicer()
    svc._ledger = MagicMock()
    svc._ledger.AppendEvent = AsyncMock(return_value=MagicMock())
    bars = MagicMock()
    bars.bars = [MagicMock()]
    bars.page.next_page_token = ""
    svc._marketdata = MagicMock()
    svc._marketdata.GetBars = AsyncMock(return_value=bars)
    req = TestRunBacktest()._legacy_req(["AAPL"])

    tracer = TracerProvider().get_tracer("t")
    root = logging.getLogger()
    root.addHandler(handler)
    try:
        with caplog.at_level(logging.INFO):
            with tracer.start_as_current_span("RunBacktest", kind=SpanKind.SERVER) as span:
                asyncio.run(svc.RunBacktest(req, context=_owned_ctx()))
                ctx = span.get_span_context()
    finally:
        root.removeHandler(handler)

    records = [
        r.log_record
        for r in exporter.get_finished_logs()
        if str(r.log_record.body).startswith("running backtest id=")
    ]
    assert len(records) == 1
    assert str(records[0].body).endswith("strategy=s1 symbols=['AAPL']")
    assert records[0].trace_id == ctx.trace_id
    assert records[0].span_id == ctx.span_id
    assert any(
        r.getMessage().startswith("running backtest id=")
        and r.getMessage().endswith("strategy=s1 symbols=['AAPL']")
        for r in caplog.records
    )
