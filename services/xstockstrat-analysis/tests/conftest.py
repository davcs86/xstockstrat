"""
pytest conftest: add the shared proto stubs to sys.path so that
`from gen.xxx.v1 import ...` works in tests without a running container.
"""

import pathlib
import sys
import types
from unittest.mock import AsyncMock, MagicMock

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

from datetime import date  # noqa: E402

from app.services.evaluator import FundamentalPeriod  # noqa: E402


def fund_period(filed_date, **values):
    """One evaluator PIT filing (feature 215 fixtures)."""
    return FundamentalPeriod(filed_date=filed_date, values=dict(values))


# Feature 215 PIT fixtures: SCHD (an ETF) has no SEC filings; AAPL has quarterly filings carrying
# all six seeded fscore inputs (pe, pb, dividend_yield, roe, debt_to_equity, eps).
SCHD_PIT_PERIODS = []
AAPL_PIT_PERIODS = [
    fund_period(
        filed,
        pe_ratio=30.0,
        pb_ratio=45.0,
        dividend_yield=0.005,
        roe=1.5,
        debt_to_equity=1.8,
        eps=6.0,
    )
    for filed in (date(2024, 5, 3), date(2024, 8, 2), date(2024, 11, 1))
]


def ctx_with(headers):
    """A gRPC servicer context replaying ``headers`` ([(key, value)]); ``abort`` raises."""
    ctx = MagicMock()
    ctx.invocation_metadata = MagicMock(return_value=list(headers))
    ctx.abort = AsyncMock(side_effect=Exception("aborted"))
    return ctx


OWNER_HEADERS = [("x-user-id", "u-1"), ("x-access-scope", "1"), ("x-trace-id", "t-1")]
OTHER_HEADERS = [("x-user-id", "u-2"), ("x-access-scope", "1"), ("x-trace-id", "t-2")]


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
