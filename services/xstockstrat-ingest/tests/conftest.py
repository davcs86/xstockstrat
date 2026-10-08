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
    `x-user-id` header (headerless N caller); `internal_caller` adds `x-internal-caller`;
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
