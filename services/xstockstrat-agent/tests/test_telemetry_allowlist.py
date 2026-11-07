"""Feature 294 final allowlist pass for agent (AC-41, AC-42)."""

import logging

import grpc

from app import telemetry, tool_metrics

ALLOWED_KEYS = {v for k, v in vars(telemetry).items() if k.startswith("KEY_")}
FORBIDDEN_KEYS = {
    "user_id",
    "email",
    "client_id",
    "account_id",
    "order_id",
    "intent_id",
    "symbol",
    "strategy_id",
    "stream_key",
    "slug",
    "category",
    "internal_caller",
    "secret",
    "api_key",
    "token",
}
MIN_INSTRUMENTS = {
    "mcp.auth.rejected",
    "oauth.requests",
    "oauth.txn.rejected",
    "agent.backend.rpc_errors",
    "agent.degraded",
}
MCP_TOOL_KEYS = {"gen_ai.tool.name", "outcome"}


def _drive() -> None:
    tool_metrics.record_auth_rejected("missing_bearer")
    tool_metrics.record_oauth_request("authorization_code", "ok")
    tool_metrics.record_oauth_txn_rejected("bad_sig")
    tool_metrics.record_backend_rpc_error("ingest", grpc.StatusCode.UNAVAILABLE)
    tool_metrics.record_degraded("auto_alert")


def _keys_by_instrument(reader) -> dict[str, set[str]]:
    data = reader.get_metrics_data()
    out: dict[str, set[str]] = {}
    for rm in data.resource_metrics if data else []:
        for sm in rm.scope_metrics:
            for m in sm.metrics:
                keys = out.setdefault(m.name, set())
                for p in m.data.data_points:
                    keys.update(dict(p.attributes))
    return out


def test_ac41_every_label_key_is_a_module_constant(metric_reader):
    _drive()
    collected = _keys_by_instrument(metric_reader)
    assert MIN_INSTRUMENTS <= set(collected)
    for name in MIN_INSTRUMENTS:
        assert collected[name] <= ALLOWED_KEYS, (name, collected[name])
        assert not collected[name] & FORBIDDEN_KEYS, (name, collected[name])


def test_ac41_mcp_tool_duration_keeps_name_and_keys(metric_reader):
    tool_metrics.ToolMetricsMiddleware(server=None)._record("get_config", "ok", 0.0)
    assert _keys_by_instrument(metric_reader)["mcp.tool.duration"] == MCP_TOOL_KEYS


def _counting_exporter(monkeypatch, raise_on_create=False):
    import opentelemetry.exporter.otlp.proto.http.metric_exporter as metric_exporter

    created = []

    def factory(*_a, **_kw):
        created.append(1)
        if raise_on_create:
            raise RuntimeError("exporter construction failed")
        return object()

    monkeypatch.setattr(metric_exporter, "OTLPMetricExporter", factory)
    return created


def test_ac42_disabled_creates_no_exporter_and_helpers_do_not_raise(otel_reset, monkeypatch):
    monkeypatch.setenv("OTEL_ENABLED", "false")
    created = _counting_exporter(monkeypatch)
    telemetry.init_telemetry()
    _drive()
    assert created == []


def test_ac42_failing_init_still_lets_the_service_start(otel_reset, monkeypatch, caplog):
    monkeypatch.setenv("OTEL_ENABLED", "true")
    created = _counting_exporter(monkeypatch, raise_on_create=True)
    with caplog.at_level(logging.WARNING):
        telemetry.init_telemetry()
    _drive()
    assert created == [1]
    assert "OTel init failed" in caplog.text
