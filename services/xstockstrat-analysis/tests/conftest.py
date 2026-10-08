"""
pytest conftest: add the shared proto stubs to sys.path so that
`from gen.xxx.v1 import ...` works in tests without a running container.
"""

import pathlib
import sys
import types
from unittest.mock import AsyncMock, MagicMock


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


def ctx_with(headers):
    """A gRPC servicer context replaying ``headers`` ([(key, value)]); ``abort`` raises."""
    ctx = MagicMock()
    ctx.invocation_metadata = MagicMock(return_value=list(headers))
    ctx.abort = AsyncMock(side_effect=Exception("aborted"))
    return ctx


class RecordingStub:
    """A fake gRPC stub: every attribute is an AsyncMock recording ``(method, request, metadata)``
    into ``calls``. ``responses`` maps a method name to a return value, an exception to raise, or a
    function of the request; an unmapped method returns a ``MagicMock``."""

    def __init__(self, responses=None):
        self.calls: list[tuple[str, object, list]] = []
        self._responses = dict(responses or {})

    def __getattr__(self, name):
        if name.startswith("_"):
            raise AttributeError(name)

        async def _call(request, metadata=None, **_kw):
            self.calls.append((name, request, list(metadata or ())))
            resp = self._responses.get(name)
            if isinstance(resp, BaseException):
                raise resp
            if isinstance(resp, types.FunctionType):
                return resp(request)
            return MagicMock() if resp is None else resp

        mock = AsyncMock(side_effect=_call)
        setattr(self, name, mock)
        return mock

    def of(self, method):
        return [c for c in self.calls if c[0] == method]
