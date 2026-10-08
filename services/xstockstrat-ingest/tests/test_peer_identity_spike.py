"""Peer-SAN spike (feature 224, Step 5): grpc.aio exposes the mTLS client's SAN to the handler.

Proves on the real mTLS harness that `context.peer_identity_key()` is the X.509 SAN and that
`context.peer_identities()` carries the exact DNS SAN of the presented client leaf. Steps 14/19/21
bind `x-internal-caller` grants to that value.
"""

import grpc
import grpc.aio
import pytest

from app import mtls
from tests.test_mtls import SVC, _call, _leaf, _run, _set_env

_ANALYSIS = "xstockstrat-analysis"


@pytest.fixture(scope="module")
def san_pki(tmp_path_factory):
    tmp = tmp_path_factory.mktemp("san")
    ca, cakey = tmp / "ca.pem", tmp / "ca-key.pem"
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
        "/CN=test-ca",
    )
    server_cert, server_key = _leaf(tmp, SVC, ca, cakey)
    analysis_cert, analysis_key = _leaf(tmp, _ANALYSIS, ca, cakey)
    other_cert, other_key = _leaf(tmp, "xstockstrat-client", ca, cakey)
    return {
        "ca": ca.read_text(),
        "server_cert": server_cert,
        "server_key": server_key,
        "analysis": (analysis_cert, analysis_key),
        "other": (other_cert, other_key),
    }


async def _serve_capturing_peer(pki, monkeypatch):
    _set_env(monkeypatch, pki["server_cert"], pki["server_key"], pki["ca"])
    captured: dict = {}

    async def _handler(request_bytes, context):
        captured["key"] = context.peer_identity_key()
        captured["ids"] = list(context.peer_identities() or [])
        return b"ok"

    rpc = grpc.unary_unary_rpc_method_handler(
        _handler, request_deserializer=lambda b: b, response_serializer=lambda b: b
    )
    server = grpc.aio.server()
    server.add_generic_rpc_handlers(
        (grpc.method_handlers_generic_handler("test.Echo", {"Call": rpc}),)
    )
    port = server.add_secure_port("127.0.0.1:0", mtls.server_credentials())
    await server.start()
    return server, port, captured


async def test_peer_identities_carry_exact_client_san(san_pki, monkeypatch):
    server, port, captured = await _serve_capturing_peer(san_pki, monkeypatch)
    try:
        cert, key = san_pki["analysis"]
        assert await _call(port, "mtls", SVC, monkeypatch, san_pki, cert, key) == b"ok"
        assert captured["key"] == "x509_subject_alternative_name"
        assert b"xstockstrat-analysis" in captured["ids"]
    finally:
        await server.stop(None)


async def test_other_client_san_does_not_match(san_pki, monkeypatch):
    server, port, captured = await _serve_capturing_peer(san_pki, monkeypatch)
    try:
        cert, key = san_pki["other"]
        assert await _call(port, "mtls", SVC, monkeypatch, san_pki, cert, key) == b"ok"
        assert b"xstockstrat-analysis" not in captured["ids"]
        assert b"xstockstrat-client" in captured["ids"]
    finally:
        await server.stop(None)
