"""Shared pytest fixtures for xstockstrat-agent tests."""

import pathlib
import sys
import threading
import types
from concurrent.futures import ThreadPoolExecutor
from types import SimpleNamespace

import pytest

# Claim sets for the derived-scope tests (feature 073/092). roles_to_access_scope maps
# admin→15, trader→11, viewer→1; only admin carries the ADMIN bit (0x04).
ADMIN = {"user_id": "u-1", "email": "a@b.c", "roles": ["admin"], "aud": "http://x"}
TRADER = {"user_id": "u-2", "email": "t@b.c", "roles": ["trader"], "aud": "http://x"}
VIEWER = {"user_id": "u-3", "email": "v@b.c", "roles": ["viewer"], "aud": "http://x"}

# Outer bound so a missing deadline fails instead of hanging.
HANG_GUARD_S = 10


def _ctx(claims: dict | None, *, with_request: bool = True):
    """A fake MCP Context whose request carries (or lacks) verified claims on its ASGI scope.

    Centralized here (feature 092, C-13) once test_tools.py became a second consumer of the
    builder test_config_tools.py had inline. Import: ``from tests.conftest import _ctx, ADMIN``.
    """
    from app.scopes import MCP_CLAIMS_SCOPE_KEY  # local import: gen path is set up below

    state = {MCP_CLAIMS_SCOPE_KEY: claims} if claims is not None else {}
    request = SimpleNamespace(scope={"state": state}) if with_request else None
    return SimpleNamespace(request_context=SimpleNamespace(request=request))


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
    # Feature 147: MCP_AGENT_SECRET is retired; the OAuth txn blob is signed with JWT_SECRET.
    monkeypatch.setenv("JWT_SECRET", "test-jwt-secret")
    monkeypatch.setenv("MCP_TRANSPORT", "stdio")
    monkeypatch.setenv("IDENTITY_ENDPOINT", "identity-test:50058")
    monkeypatch.setenv("CONFIG_ENDPOINT", "config-test:50060")
    # Feature 210: mtls.secure_channel is fail-closed — it raises unless MTLS_* are set. Dummy PEM
    # bytes satisfy grpc.ssl_channel_credentials at construction; channels are lazy, so mocked-stub
    # tests never handshake. (test_mtls.py's fail-closed test delenv's these in its own body.)
    monkeypatch.setenv("MTLS_CERT", "dev-cert")
    monkeypatch.setenv("MTLS_KEY", "dev-key")
    monkeypatch.setenv("MTLS_CA_CERT", "dev-ca")
    # Also patch module-level vars — they are read at import time so setenv alone has no effect on
    # tests that import the module before fixtures run.
    from app import client, oauth_server

    monkeypatch.setattr(client, "INGEST_ENDPOINT", "ingest-test:50055")
    monkeypatch.setattr(client, "NOTIFY_ENDPOINT", "notify-test:50059")
    monkeypatch.setattr(client, "ANALYSIS_ENDPOINT", "analysis-test:50056")
    monkeypatch.setattr(oauth_server, "JWT_SECRET", "test-jwt-secret")


@pytest.fixture
def hung_config_server(monkeypatch):
    """Start an in-process ConfigService and point ``client.get_config_value`` at it (feature 247).

    ``start()`` (no args) hangs ``GetConfig`` until the caller's deadline expires;
    ``start(answer_after_s=…, values=…)`` answers a snapshot after that delay. The returned handle
    exposes ``port`` and ``entered`` (handler entries). Sync + threaded, unlike the ``grpc.aio``
    server in test_list_opportunities_deadline.py: ``TestClient``'s portal loop cannot serve a
    pytest-loop-bound aio server.
    """
    import grpc  # noqa: PLC0415
    from gen.config.v1 import config_pb2, config_pb2_grpc  # noqa: PLC0415

    from app import client  # noqa: PLC0415

    stop = threading.Event()
    servers = []

    def start(*, answer_after_s: float | None = None, values: dict | None = None):
        lock = threading.Lock()
        counter = {"entered": 0}

        class _Config(config_pb2_grpc.ConfigServiceServicer):
            def GetConfig(self, request, context):  # noqa: N802
                with lock:
                    counter["entered"] += 1
                if answer_after_s is None:
                    while context.is_active() and not stop.is_set():
                        stop.wait(0.05)
                    return config_pb2.ConfigSnapshot()
                stop.wait(answer_after_s)
                return config_pb2.ConfigSnapshot(
                    namespace=request.namespace, version="1", values=values or {}
                )

        server = grpc.server(ThreadPoolExecutor(max_workers=8))
        config_pb2_grpc.add_ConfigServiceServicer_to_server(_Config(), server)
        port = server.add_insecure_port("127.0.0.1:0")
        server.start()
        servers.append(server)

        monkeypatch.setattr(client, "CONFIG_ENDPOINT", f"127.0.0.1:{port}")
        monkeypatch.setattr(
            client.mtls, "secure_channel", lambda ep, _svc: grpc.aio.insecure_channel(ep)
        )

        class _Handle:
            def __init__(self) -> None:
                self.port = port

            @property
            def entered(self) -> int:
                with lock:
                    return counter["entered"]

        return _Handle()

    yield start
    stop.set()
    for server in servers:
        server.stop(0).wait()


@pytest.fixture
def hung_backend(monkeypatch):
    """Start an in-process gRPC server that serves ANY method and point one endpoint at it (273).

    ``start(endpoint_attr, *, module=None, answers=None)`` redirects ``module.<endpoint_attr>``
    (default module ``app.client``). Per method name, ``answers`` maps to ``(delay_s, msg)`` (answer
    ``msg`` after the delay), ``(delay_s, msg, trailers)`` (also set ``trailers`` as trailing
    metadata) or ``(delay_s, grpc.StatusCode)`` (abort after the delay); an absent method hangs
    until the caller's deadline. The handle exposes ``port``, ``calls`` (a list of
    ``(method, metadata_dict)``) and ``entered``. Config paths keep 247's ``hung_config_server``
    (typed ConfigService); this fixture serves every other service, untyped (raw bytes).
    """
    import grpc  # noqa: PLC0415

    from app import client  # noqa: PLC0415

    stop = threading.Event()
    servers = []

    def start(endpoint_attr: str, *, module=None, answers: dict | None = None):
        lock = threading.Lock()
        calls: list[tuple[str, dict]] = []
        replies = answers or {}

        def _handle(method: str, context) -> bytes:
            with lock:
                calls.append((method, dict(context.invocation_metadata())))
            reply = replies.get(method)
            if reply is None:
                while context.is_active() and not stop.is_set():
                    stop.wait(0.05)
                return b""
            delay_s, outcome, *rest = reply
            stop.wait(delay_s)
            if isinstance(outcome, grpc.StatusCode):
                context.abort(outcome, "rejected")
            if rest:
                context.set_trailing_metadata(rest[0])
            return outcome.SerializeToString()

        class _AnyMethod(grpc.GenericRpcHandler):
            def service(self, details):
                method = details.method.rsplit("/", 1)[-1]
                return grpc.unary_unary_rpc_method_handler(lambda _req, ctx: _handle(method, ctx))

        server = grpc.server(ThreadPoolExecutor(max_workers=8))
        server.add_generic_rpc_handlers((_AnyMethod(),))
        port = server.add_insecure_port("127.0.0.1:0")
        server.start()
        servers.append(server)

        monkeypatch.setattr(module or client, endpoint_attr, f"127.0.0.1:{port}")
        monkeypatch.setattr(
            client.mtls, "secure_channel", lambda ep, _svc: grpc.aio.insecure_channel(ep)
        )

        class _Handle:
            def __init__(self) -> None:
                self.port = port
                self.calls = calls

            @property
            def entered(self) -> int:
                with lock:
                    return len(calls)

        return _Handle()

    yield start
    stop.set()
    for server in servers:
        server.stop(0).wait()


@pytest.fixture
def bound_admin():
    """Bind ADMIN as the outbound caller, as CallerPropagationMiddleware does at the edge."""
    from app import client  # local import: gen path is set up above
    from app.scopes import roles_to_access_scope

    token = client.set_caller(ADMIN["user_id"], roles_to_access_scope(ADMIN["roles"]), "trace-241")
    try:
        yield
    finally:
        client.reset_caller(token)


def credentialed_source(**overrides) -> dict:
    """A signal source with has_credentials=True (feature 093, C-13 shared fixture).

    Consumed by both extract-tool tests to exercise the "credentials required → RuntimeError"
    branch, which the default (has_credentials=False) `_SOURCES` fixtures never reach.
    """
    src = {
        "slug": "cred_src",
        "display_name": "Credentialed Source",
        "source_type": "mediated_authenticated_website",
        "config_json": {"url": "https://gated.example.com"},
        "has_credentials": True,
    }
    src.update(overrides)
    return src


@pytest.fixture
def otel_reset(monkeypatch):
    """Isolate a test calling init_telemetry: the OTel providers are set-once per process."""
    import logging

    from opentelemetry import metrics, trace
    from opentelemetry._logs import _internal as logs_internal
    from opentelemetry.instrumentation.grpc import GrpcAioInstrumentorClient
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
    monkeypatch.setattr(GrpcAioInstrumentorClient, "instrument", lambda self, **kw: None)
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


@pytest.fixture
def metric_reader(otel_reset):
    """Global MeterProvider backed by an in-memory reader."""
    from opentelemetry import metrics
    from opentelemetry.sdk.metrics import MeterProvider
    from opentelemetry.sdk.metrics.export import InMemoryMetricReader

    reader = InMemoryMetricReader()
    metrics.set_meter_provider(MeterProvider(metric_readers=[reader]))
    return reader
