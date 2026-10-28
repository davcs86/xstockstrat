"""
pytest conftest: add the shared proto stubs to sys.path so that
`from gen.xxx.v1 import ...` works in tests without a running container.

The proto stubs live at ../../packages/proto/gen/python relative to the
service root, mirroring the Dockerfile's `ln -s /proto/gen/python /app/gen`.
"""

import pathlib
import sys
import types
from unittest.mock import AsyncMock, MagicMock

import grpc
import pytest

OWNER_HEADERS = [("x-user-id", "user-a"), ("x-access-scope", "1"), ("x-trace-id", "t-1")]
OTHER_HEADERS = [("x-user-id", "user-b"), ("x-access-scope", "1"), ("x-trace-id", "t-1")]


def ctx_with(metadata, peer_sans=()):
    """A grpc.aio servicer context replaying ``metadata``; ``peer_sans`` are the mTLS peer's SAN
    entries (empty = no verified peer identity). ``abort`` raises."""
    ctx = MagicMock()
    ctx.invocation_metadata = MagicMock(return_value=list(metadata))
    ctx.peer_identity_key = MagicMock(
        return_value="x509_subject_alternative_name" if peer_sans else None
    )
    ctx.peer_identities = MagicMock(
        return_value=[s.encode() for s in peer_sans] if peer_sans else None
    )
    ctx.abort = AsyncMock(side_effect=grpc.RpcError("aborted"))
    return ctx


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


# Run unconditionally at import time — conftest.py is imported before
# test modules are collected, so this executes early enough.
_setup_gen_path()


def snapshot_watcher(**values):
    """A dial-free ConfigWatcher; each value lands in the oneof member matching its Python type."""
    from gen.config.v1 import config_pb2

    from app.config.watcher import ConfigWatcher

    # __new__ bypasses __init__'s channel + watch-task dial (fails-074: never a live watcher).
    w = ConfigWatcher.__new__(ConfigWatcher)
    snap = config_pb2.ConfigSnapshot()
    for key, val in values.items():
        # bool before int: bool is an int subclass.
        if isinstance(val, bool):
            snap.values[key].bool_val = val
        elif isinstance(val, int):
            snap.values[key].int_val = val
        elif isinstance(val, float):
            snap.values[key].float_val = val
        elif isinstance(val, str):
            snap.values[key].string_val = val
        else:
            raise TypeError(f"snapshot_watcher: unsupported value type for {key}: {type(val)!r}")
    w._snapshot = snap
    return w


@pytest.fixture
def otel_reset(monkeypatch):
    """Isolate a test calling init_telemetry: the OTel tracer provider is set-once per process."""
    from opentelemetry import trace
    from opentelemetry.instrumentation.grpc import GrpcAioInstrumentorServer
    from opentelemetry.util._once import Once

    monkeypatch.setattr(trace, "_TRACER_PROVIDER_SET_ONCE", Once())
    monkeypatch.setattr(trace, "_TRACER_PROVIDER", None)
    monkeypatch.setenv("NO_PROXY", "127.0.0.1")
    monkeypatch.setenv("no_proxy", "127.0.0.1")
    monkeypatch.setattr(GrpcAioInstrumentorServer, "instrument", lambda self, **kw: None)
    yield
    provider = trace.get_tracer_provider()
    if hasattr(provider, "shutdown"):
        provider.shutdown()
