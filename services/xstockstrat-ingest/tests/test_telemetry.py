from app.telemetry import init_telemetry


def test_init_telemetry_no_op_when_disabled(monkeypatch):
    monkeypatch.delenv("OTEL_ENABLED", raising=False)
    init_telemetry()


def test_init_telemetry_enabled_catches_import_error(monkeypatch):
    monkeypatch.setenv("OTEL_ENABLED", "true")
    init_telemetry()
