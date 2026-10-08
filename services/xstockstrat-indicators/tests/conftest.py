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
