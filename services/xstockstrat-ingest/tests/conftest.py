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

import pytest


def _ctx(
    access_scope: str = "4",
    user_id: str = "u1",
    peer_sans: tuple[str, ...] = (),
    internal_caller: str = "",
):
    """A fake gRPC context: invocation_metadata carries the access scope; abort raises.

    Centralized here (feature 092, C-13) once a second suite (TriggerBackfill authz in
    test_ingest_servicer.py) needed the same builder that test_cancel_backfill.py had inline.
    `"4"` = ADMIN bit set (0x04); `"0"` = no admin bit. Feature 224: `user_id=""` omits the
    `x-user-id` header (headerless caller, rejected UNAUTHENTICATED since feature 225);
    `internal_caller` adds `x-internal-caller`;
    `peer_sans` is the verified mTLS peer SAN list (empty = no TLS peer identity).
    """
    metadata = [("x-access-scope", access_scope)]
    if user_id:
        metadata.append(("x-user-id", user_id))
    metadata.append(("x-trace-id", "t1"))
    if internal_caller:
        metadata.append(("x-internal-caller", internal_caller))
    ctx = MagicMock()
    ctx.invocation_metadata = MagicMock(return_value=metadata)
    ctx.peer_identity_key = MagicMock(
        return_value="x509_subject_alternative_name" if peer_sans else None
    )
    ctx.peer_identities = MagicMock(return_value=[s.encode() for s in peer_sans])
    ctx.abort = AsyncMock(side_effect=Exception("aborted"))
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
    """Isolate a test calling init_telemetry: the OTel providers are set-once per process."""
    import logging

    from opentelemetry import metrics, trace
    from opentelemetry._logs import _internal as logs_internal
    from opentelemetry.instrumentation.grpc import GrpcAioInstrumentorServer
    from opentelemetry.metrics import _internal as metrics_internal
    from opentelemetry.util._once import Once

    monkeypatch.setattr(trace, "_TRACER_PROVIDER_SET_ONCE", Once())
    monkeypatch.setattr(trace, "_TRACER_PROVIDER", None)
    monkeypatch.setattr(metrics_internal, "_METER_PROVIDER_SET_ONCE", Once())
    monkeypatch.setattr(metrics_internal, "_METER_PROVIDER", None)
    monkeypatch.setattr(logs_internal, "_LOGGER_PROVIDER_SET_ONCE", Once())
    monkeypatch.setattr(logs_internal, "_LOGGER_PROVIDER", None)
    monkeypatch.setenv("NO_PROXY", "127.0.0.1")
    monkeypatch.setenv("no_proxy", "127.0.0.1")
    monkeypatch.setattr(GrpcAioInstrumentorServer, "instrument", lambda self, **kw: None)
    root = logging.getLogger()
    handlers_before = list(root.handlers)
    yield
    for h in list(root.handlers):
        if h not in handlers_before:
            root.removeHandler(h)
    for provider in (
        trace.get_tracer_provider(),
        metrics.get_meter_provider(),
        logs_internal.get_logger_provider(),
    ):
        if hasattr(provider, "shutdown"):
            provider.shutdown()
