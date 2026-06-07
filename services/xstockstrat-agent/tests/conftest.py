"""Shared pytest fixtures for xstockstrat-agent tests."""

import pathlib
import sys
import types

import pytest


def _setup_gen_path() -> None:
    """Register the proto gen directory as the 'gen' namespace package."""
    service_root = pathlib.Path(__file__).resolve().parents[1]
    proto_gen = (service_root / "../../packages/proto/gen/python").resolve()

    if not proto_gen.exists():
        return

    if str(proto_gen) not in sys.path:
        sys.path.insert(0, str(proto_gen))

    if "gen" not in sys.modules:
        gen_mod = types.ModuleType("gen")
        gen_mod.__path__ = [str(proto_gen)]
        gen_mod.__package__ = "gen"
        sys.modules["gen"] = gen_mod


_setup_gen_path()


@pytest.fixture(autouse=True)
def set_env(monkeypatch):
    monkeypatch.setenv("INGEST_ENDPOINT", "ingest-test:50055")
    monkeypatch.setenv("NOTIFY_ENDPOINT", "notify-test:50059")
    monkeypatch.setenv("ANALYSIS_ENDPOINT", "analysis-test:50056")
    monkeypatch.setenv("MCP_AGENT_SECRET", "test-secret")
    monkeypatch.setenv("MCP_TRANSPORT", "stdio")
    monkeypatch.setenv("IDENTITY_ENDPOINT", "identity-test:50058")
    monkeypatch.setenv("CONFIG_ENDPOINT", "config-test:50060")
    # Also patch module-level vars in client.py — they are read at import time so
    # setenv alone has no effect on tests that import the module before fixtures run.
    from app import client

    monkeypatch.setattr(client, "INGEST_ENDPOINT", "ingest-test:50055")
    monkeypatch.setattr(client, "NOTIFY_ENDPOINT", "notify-test:50059")
    monkeypatch.setattr(client, "ANALYSIS_ENDPOINT", "analysis-test:50056")
    monkeypatch.setattr(client, "MCP_AGENT_SECRET", "test-secret")
