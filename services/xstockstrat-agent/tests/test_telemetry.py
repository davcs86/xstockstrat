"""Feature 171 — the built OTel Resource omits trading_mode; init stays non-blocking on error."""


def test_build_resource_omits_trading_mode(monkeypatch):
    monkeypatch.setenv("TRADING_MODE", "paper")
    from app.telemetry import _build_resource

    attrs = _build_resource().attributes
    assert "trading_mode" not in attrs
    assert "service.name" in attrs
    assert "deployment.environment" in attrs
    assert attrs["platform"] == "xstockstrat"


def test_init_telemetry_non_blocking_on_error(monkeypatch):
    # Force the exporter constructor to raise inside init_telemetry's try; init must swallow it
    # (AC-2) and set no global tracer provider. Patch the source-module symbol because the name is
    # imported locally inside the try (a module-attr patch would not intercept the local import).
    monkeypatch.setenv("OTEL_ENABLED", "true")

    def _boom(*a, **k):
        raise RuntimeError("exporter down")

    monkeypatch.setattr(
        "opentelemetry.exporter.otlp.proto.grpc.trace_exporter.OTLPSpanExporter",
        _boom,
    )
    import app.telemetry as tel

    tel.init_telemetry()  # must not raise
