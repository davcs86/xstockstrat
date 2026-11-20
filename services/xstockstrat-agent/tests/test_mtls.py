"""Unit + structural tests for the agent's mutual-TLS secure-channel factory (feature 210, Step 12).

Asserts the factory (app/mtls.py) pins the verified server authority to the TARGET SERVICE NAME (not
the dialed host), builds real channel credentials from env PEM material, and fails closed when the
MTLS_* env is absent. Plus a structural regression guard that no `insecure_channel` dial survives
the 69-site sweep of app/client.py + app/auth.py.
"""

import subprocess
from pathlib import Path
from types import SimpleNamespace

import grpc
import pytest

from app import mtls
from tests.conftest import HANG_GUARD_S

SVC = "xstockstrat-trading"
AGENT = "xstockstrat-agent"
UI = "xstockstrat-ui"
_APP = Path(__file__).resolve().parent.parent / "app"


def _run(*args):
    subprocess.run(args, check=True, capture_output=True)


def _ca(tmp: Path, name: str) -> tuple[Path, Path]:
    """Mint a self-signed CA; returns (cert path, key path)."""
    ca, cakey = tmp / f"{name}.pem", tmp / f"{name}-key.pem"
    _run(
        "openssl",
        "req",
        "-x509",
        "-newkey",
        "rsa:2048",
        "-nodes",
        "-keyout",
        str(cakey),
        "-out",
        str(ca),
        "-days",
        "1",
        "-subj",
        f"/CN={name}",
    )
    return ca, cakey


def _leaf(tmp: Path, name: str, ca: Path, cakey: Path, stem: str | None = None) -> tuple[str, str]:
    """Mint a leaf with SAN ``name`` signed by ``ca``; returns (cert PEM, key PEM)."""
    stem = stem or name
    ext = tmp / f"{stem}.ext"
    ext.write_text(f"subjectAltName=DNS:{name}\nextendedKeyUsage=serverAuth,clientAuth\n")
    _run(
        "openssl",
        "req",
        "-newkey",
        "rsa:2048",
        "-nodes",
        "-keyout",
        str(tmp / f"{stem}-key.pem"),
        "-out",
        str(tmp / f"{stem}.csr"),
        "-subj",
        f"/CN={name}",
    )
    _run(
        "openssl",
        "x509",
        "-req",
        "-in",
        str(tmp / f"{stem}.csr"),
        "-CA",
        str(ca),
        "-CAkey",
        str(cakey),
        "-CAcreateserial",
        "-out",
        str(tmp / f"{stem}.pem"),
        "-days",
        "1",
        "-extfile",
        str(ext),
    )
    return (tmp / f"{stem}.pem").read_text(), (tmp / f"{stem}-key.pem").read_text()


@pytest.fixture
def agent_pki(tmp_path):
    """Mint a CA + agent leaf via openssl and set MTLS_* env to them (fail-open for this test)."""
    ca, cakey = _ca(tmp_path, "ca")
    cert, key = _leaf(tmp_path, AGENT, ca, cakey)
    return {"cert": cert, "key": key, "ca": ca.read_text()}


@pytest.fixture(scope="module")
def catalog_pki(tmp_path_factory):
    """One platform CA with agent, UI and other-service leaves, plus a foreign-CA leaf named UI."""
    tmp = tmp_path_factory.mktemp("catalog-mtls")
    ca, cakey = _ca(tmp, "ca")
    foreign_ca, foreign_cakey = _ca(tmp, "foreign-ca")
    return {
        "ca": ca.read_text(),
        "agent": _leaf(tmp, AGENT, ca, cakey),
        "ui": _leaf(tmp, UI, ca, cakey),
        "other": _leaf(tmp, SVC, ca, cakey),
        "foreign_ui": _leaf(tmp, UI, foreign_ca, foreign_cakey, stem="foreign-ui"),
    }


def _set_env(mp, pki):
    mp.setenv("MTLS_CERT", pki["cert"])
    mp.setenv("MTLS_KEY", pki["key"])
    mp.setenv("MTLS_CA_CERT", pki["ca"])


def test_secure_channel_pins_authority_to_service_name(monkeypatch, agent_pki):
    """The factory pins ssl_target_name_override to the TARGET SERVICE NAME, not the dialed host."""
    _set_env(monkeypatch, agent_pki)
    captured = {}

    def _spy(endpoint, creds, options=None):
        captured["endpoint"] = endpoint
        captured["creds"] = creds
        captured["options"] = options
        return object()  # stand-in channel; we only assert the dial args

    monkeypatch.setattr(grpc.aio, "secure_channel", _spy)
    mtls.secure_channel("10.0.0.5:50051", SVC)  # dialed host deliberately != service name
    assert captured["endpoint"] == "10.0.0.5:50051"
    assert ("grpc.ssl_target_name_override", SVC) in captured["options"]
    assert isinstance(captured["creds"], grpc.ChannelCredentials)


def test_channel_credentials_built_from_env_pem(monkeypatch, agent_pki):
    _set_env(monkeypatch, agent_pki)
    creds = mtls.channel_credentials()
    assert isinstance(creds, grpc.ChannelCredentials)


def test_fail_closed_when_env_absent(monkeypatch):
    monkeypatch.delenv("MTLS_CERT", raising=False)
    monkeypatch.delenv("MTLS_KEY", raising=False)
    monkeypatch.delenv("MTLS_CA_CERT", raising=False)
    with pytest.raises(RuntimeError):
        mtls.channel_credentials()
    with pytest.raises(RuntimeError):
        mtls.secure_channel("host:1", SVC)
    with pytest.raises(RuntimeError):
        mtls.server_credentials()


def test_no_insecure_channel_remains():
    """Regression guard for the 69-site sweep — no plaintext dial may survive."""
    for name in ("client.py", "auth.py"):
        assert "insecure_channel" not in (_APP / name).read_text(), (
            f"insecure_channel found in {name}"
        )


# --- feature 360: the internal tool catalog RPC (AgentService.ListTools) ---


async def _serve_catalog(mp, pki):
    """Start the real catalog server under the agent leaf; returns (server, port, mcp_server)."""
    from app.catalog_service import build_catalog_server  # noqa: PLC0415
    from app.main import create_server  # noqa: PLC0415

    cert, key = pki["agent"]
    _set_env(mp, {"cert": cert, "key": key, "ca": pki["ca"]})
    mcp_server = create_server()
    server, port = build_catalog_server(mcp_server, "127.0.0.1:0")
    await server.start()
    return server, port, mcp_server


async def _list_tools(port, pki, leaf):
    """Call ListTools with ``leaf`` as the client certificate (None = no client certificate)."""
    from gen.agent.v1 import agent_pb2, agent_pb2_grpc  # noqa: PLC0415

    if leaf is None:
        creds = grpc.ssl_channel_credentials(root_certificates=pki["ca"].encode())
    else:
        cert, key = pki[leaf]
        creds = grpc.ssl_channel_credentials(
            root_certificates=pki["ca"].encode(),
            private_key=key.encode(),
            certificate_chain=cert.encode(),
        )
    channel = grpc.aio.secure_channel(
        f"127.0.0.1:{port}", creds, options=[("grpc.ssl_target_name_override", AGENT)]
    )
    try:
        stub = agent_pb2_grpc.AgentServiceStub(channel)
        return await stub.ListTools(agent_pb2.ListToolsRequest(), timeout=HANG_GUARD_S)
    finally:
        await channel.close()


async def test_catalog_lists_every_registered_tool_to_the_ui(monkeypatch, catalog_pki):
    """AC-6: the UI certificate reads every registered tool with name, description and schema."""
    from google.protobuf.json_format import MessageToDict  # noqa: PLC0415

    server, port, mcp_server = await _serve_catalog(monkeypatch, catalog_pki)
    try:
        response = await _list_tools(port, catalog_pki, "ui")
    finally:
        await server.stop(grace=None)
    expected = {t.name: t for t in await mcp_server.list_tools()}
    assert len(expected) > 0
    assert {t.name for t in response.tools} == set(expected)
    for tool in response.tools:
        assert tool.description == (expected[tool.name].description or "")
        assert MessageToDict(tool.input_schema) == expected[tool.name].input_schema


@pytest.mark.parametrize(
    ("leaf", "code"),
    [
        ("other", grpc.StatusCode.PERMISSION_DENIED),  # platform cert, but not the UI's
        (None, grpc.StatusCode.UNAVAILABLE),  # no client certificate: handshake fails
        ("foreign_ui", grpc.StatusCode.UNAVAILABLE),  # UI name, but not signed by the platform CA
    ],
)
async def test_catalog_refuses_every_caller_but_the_ui(monkeypatch, catalog_pki, leaf, code):
    """AC-5: only the UI certificate, chained to the platform CA, may read the catalog."""
    server, port, _ = await _serve_catalog(monkeypatch, catalog_pki)
    try:
        await _list_tools(port, catalog_pki, "ui")  # baseline: this server accepts the UI
        with pytest.raises(grpc.aio.AioRpcError) as exc:
            await _list_tools(port, catalog_pki, leaf)
    finally:
        await server.stop(grace=None)
    assert exc.value.code() == code


async def test_catalog_maps_a_missing_description_to_empty_string():
    from gen.agent.v1 import agent_pb2  # noqa: PLC0415

    from app.catalog_service import UI_PEER_SAN, CatalogServicer  # noqa: PLC0415

    async def _tools():
        return [SimpleNamespace(name="t", description=None, input_schema={"type": "object"})]

    def _abort(code, details):
        raise AssertionError(f"aborted: {code} {details}")

    context = SimpleNamespace(
        peer_identity_key=lambda: "x509_subject_alternative_name",
        peer_identities=lambda: [UI_PEER_SAN.encode()],
        abort=_abort,
    )
    servicer = CatalogServicer(SimpleNamespace(list_tools=_tools))
    response = await servicer.ListTools(agent_pb2.ListToolsRequest(), context)
    assert [(t.name, t.description) for t in response.tools] == [("t", "")]


async def test_http_mode_fails_closed_before_the_http_port_listens(monkeypatch):
    """Missing MTLS_* stops _run_http before uvicorn serves, so port 9000 never listens."""
    import uvicorn  # noqa: PLC0415

    from app import main  # noqa: PLC0415

    for name in ("MTLS_CERT", "MTLS_KEY", "MTLS_CA_CERT"):
        monkeypatch.delenv(name, raising=False)
    served = []

    async def _serve(self):
        served.append(self)

    monkeypatch.setattr(uvicorn.Server, "serve", _serve)
    with pytest.raises(RuntimeError):
        await main._run_http()
    assert served == []
