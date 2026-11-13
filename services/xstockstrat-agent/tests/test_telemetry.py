"""Feature 171 — the built OTel Resource omits trading_mode; init stays non-blocking on error."""

import logging
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import pytest


@pytest.mark.parametrize(
    ("host_provider", "want", "service_name"),
    [
        (None, "unknown", "agent"),
        ("aws", "unknown", "agent"),
        ("Homelab", "unknown", "agent"),
        ("homelab", "homelab", "agent"),
        ("digitalocean", "digitalocean", None),
    ],
    ids=["unset", "aws", "Homelab", "homelab", "digitalocean-default-name"],
)
def test_build_resource_omits_trading_mode(monkeypatch, host_provider, want, service_name):
    # Feature 332: host.provider accepts only the exact lowercase target names.
    monkeypatch.setenv("TRADING_MODE", "paper")
    if host_provider is None:
        monkeypatch.delenv("HOST_PROVIDER", raising=False)
    else:
        monkeypatch.setenv("HOST_PROVIDER", host_provider)
    if service_name is None:
        monkeypatch.delenv("SERVICE_NAME", raising=False)
    else:
        monkeypatch.setenv("SERVICE_NAME", service_name)
    from app.telemetry import _build_resource

    attrs = _build_resource().attributes
    assert "trading_mode" not in attrs
    assert "service.name" in attrs
    assert "deployment.environment" in attrs
    assert attrs["platform"] == "xstockstrat"
    assert attrs["host.provider"] == want
    assert attrs["service.instance.id"] == f"{want}-{attrs['service.name']}"


def test_init_telemetry_non_blocking_on_error(monkeypatch):
    # Force the exporter to raise inside init_telemetry's try: init must swallow it (AC-2). Patch
    # the source module — OTLPSpanExporter is imported locally, so a module patch would miss it.
    monkeypatch.setenv("OTEL_ENABLED", "true")

    def _boom(*a, **k):
        raise RuntimeError("exporter down")

    monkeypatch.setattr(
        "opentelemetry.exporter.otlp.proto.http.trace_exporter.OTLPSpanExporter",
        _boom,
    )
    import app.telemetry as tel

    tel.init_telemetry()  # must not raise


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

import os  # noqa: E402
import pathlib  # noqa: E402
import signal  # noqa: E402
import subprocess  # noqa: E402
import sys  # noqa: E402

SERVICE_DIR = pathlib.Path(__file__).resolve().parent.parent
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


@pytest.mark.parametrize("headers", HEADER_FORMS)
def test_init_exports_metrics_and_logs_with_resource(otel_reset, monkeypatch, headers):
    # AC-19 (extends 226 AC-1) + AC-10 row; 332 AC-1 (Python row) + 336 AC-1:
    # host.provider and the provider-prefixed id on every signal.
    from opentelemetry import metrics, trace
    from opentelemetry.proto.collector.logs.v1 import logs_service_pb2
    from opentelemetry.proto.collector.metrics.v1 import metrics_service_pb2
    from opentelemetry.proto.collector.trace.v1 import trace_service_pb2

    from app.telemetry import init_telemetry

    monkeypatch.setenv("HOST_PROVIDER", "homelab")
    monkeypatch.setenv("SERVICE_NAME", "agent")
    srv, seen = _start_body_receiver()
    try:
        _enable(monkeypatch, srv, headers)
        init_telemetry()
        metrics.get_meter("t").create_counter("t.count").add(1)
        logging.getLogger("t").warning("hello bridge")
        with trace.get_tracer("t").start_as_current_span("s"):
            pass
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
    trace_req = trace_service_pb2.ExportTraceServiceRequest()
    trace_req.ParseFromString(by_path["/otlp/v1/traces"][1])
    for resource in (
        metrics_req.resource_metrics[0].resource,
        logs_req.resource_logs[0].resource,
        trace_req.resource_spans[0].resource,
    ):
        res = {a.key: a.value.string_value for a in resource.attributes}
        assert res["platform"] == "xstockstrat"
        assert res["service.name"] and res["deployment.environment"]
        assert "trading_mode" not in res
        assert res["host.provider"] == "homelab"
        assert res["service.instance.id"] == "homelab-agent"

    # @AC-2: every exported datapoint carries the provider, equal to the resource's (D-6).
    metric_res = {
        a.key: a.value.string_value for a in metrics_req.resource_metrics[0].resource.attributes
    }
    datapoints = [
        dp
        for rm in metrics_req.resource_metrics
        for sm in rm.scope_metrics
        for m in sm.metrics
        for dp in (m.sum.data_points or m.gauge.data_points or m.histogram.data_points)
    ]
    assert datapoints
    for dp in datapoints:
        got = {a.key: a.value.string_value for a in dp.attributes}
        assert got.get("host.provider") == metric_res["host.provider"], got


def test_mcp_tool_duration_datapoint_keys_gain_only_host_provider(otel_reset, monkeypatch):
    # @AC-18: over the real init pipeline the keys are the two existing plus host.provider.
    import time

    from opentelemetry.proto.collector.metrics.v1 import metrics_service_pb2

    from app.telemetry import init_telemetry
    from app.tool_metrics import ToolMetricsMiddleware

    monkeypatch.setenv("HOST_PROVIDER", "homelab")
    srv, seen = _start_body_receiver()
    try:
        _enable(monkeypatch, srv)
        init_telemetry()
        ToolMetricsMiddleware(server=None)._record("get_config", "ok", time.perf_counter())
        _flush_all()
    finally:
        srv.shutdown()
        srv.server_close()
    keys = set()
    for path, _auth, body in seen:
        if path != "/otlp/v1/metrics":
            continue
        req = metrics_service_pb2.ExportMetricsServiceRequest()
        req.ParseFromString(body)
        for rm in req.resource_metrics:
            for sm in rm.scope_metrics:
                for m in sm.metrics:
                    if m.name == "mcp.tool.duration":
                        for dp in m.histogram.data_points:
                            keys.add(frozenset(a.key for a in dp.attributes))
    assert keys == {frozenset({"gen_ai.tool.name", "outcome", "host.provider"})}


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

    from app.telemetry import init_telemetry

    monkeypatch.setenv("OTEL_ENABLED", "false")
    before = list(logging.getLogger().handlers)
    init_telemetry()
    assert logging.getLogger().handlers == before
    assert not hasattr(trace.get_tracer_provider(), "force_flush")
    assert not hasattr(metrics.get_meter_provider(), "force_flush")


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


def test_agent_resource_and_warn_log_correlated_to_span(otel_reset, monkeypatch):
    # AC-10 agent row + AC-11 agent row.
    from opentelemetry import metrics, trace
    from opentelemetry.proto.collector.logs.v1 import logs_service_pb2
    from opentelemetry.proto.collector.metrics.v1 import metrics_service_pb2

    from app.telemetry import init_telemetry

    srv, seen = _start_body_receiver()
    monkeypatch.setenv("SERVICE_NAME", "agent")
    monkeypatch.setenv("APPLICATION_ENV", "staging")
    try:
        _enable(monkeypatch, srv)
        init_telemetry()
        metrics.get_meter("t").create_counter("t.count").add(1)
        with trace.get_tracer("t").start_as_current_span("s") as span:
            logging.getLogger("t").warning("inside span")
            trace_id = span.get_span_context().trace_id
        _flush_all()
    finally:
        srv.shutdown()
        srv.server_close()
    by_path = {path: body for path, _auth, body in seen}
    mreq = metrics_service_pb2.ExportMetricsServiceRequest()
    mreq.ParseFromString(by_path["/otlp/v1/metrics"])
    res = {a.key: a.value.string_value for a in mreq.resource_metrics[0].resource.attributes}
    assert res["service.name"] == "agent"
    assert res["deployment.environment"] == "staging"
    assert res["platform"] == "xstockstrat"
    lreq = logs_service_pb2.ExportLogsServiceRequest()
    lreq.ParseFromString(by_path["/otlp/v1/logs"])
    recs = [
        r
        for rl in lreq.resource_logs
        for sl in rl.scope_logs
        for r in sl.log_records
        if r.body.string_value == "inside span"
    ]
    assert len(recs) == 1
    assert recs[0].severity_text == "WARN"
    assert int.from_bytes(recs[0].trace_id, "big") == trace_id
