"""Shared pytest fixtures for xstockstrat-agent tests."""
import pytest

@pytest.fixture(autouse=True)
def set_env(monkeypatch):
    monkeypatch.setenv("INGEST_HTTP_ENDPOINT", "http://ingest-test:8055")
    monkeypatch.setenv("NOTIFY_HTTP_ENDPOINT", "http://notify-test:8059")
    monkeypatch.setenv("ANALYSIS_HTTP_ENDPOINT", "http://analysis-test:8056")
    monkeypatch.setenv("MCP_AGENT_SECRET", "test-secret")
    monkeypatch.setenv("MCP_TRANSPORT", "stdio")
    monkeypatch.setenv("IDENTITY_ENDPOINT", "identity-test:50058")
    monkeypatch.setenv("CONFIG_ENDPOINT", "config-test:50060")
