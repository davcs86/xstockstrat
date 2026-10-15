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
