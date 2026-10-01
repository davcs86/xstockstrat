"""In-process mutual-TLS handshake + negative matrix + propagation tests (feature 210, Step 6).

Self-contained: mints a CA + leaves via openssl in a tmp fixture (no dependency on
scripts/gen-dev-certs.sh having run), stands up an in-process grpc.aio server with
app.mtls.server_credentials(), and exercises the handshake over a generic echo method.
Covers @AC-1 (plaintext refused), @AC-2 (mutual accept), @AC-4 (fail-closed boot),
@AC-5 (trio propagated unchanged), and the negative matrix (wrong-CA + wrong-SAN rejected).
"""

import subprocess
from pathlib import Path

import grpc
import grpc.aio
import pytest

from app import mtls

SVC = "xstockstrat-test"
_METHOD = "/test.Echo/Call"


def _run(*args):
    subprocess.run(args, check=True, capture_output=True)


def _leaf(tmp: Path, name: str, ca: Path, cakey: Path) -> tuple[str, str]:
    ext = tmp / f"{name}.ext"
    ext.write_text(f"subjectAltName=DNS:{name}\nextendedKeyUsage=serverAuth,clientAuth\n")
    _run("openssl", "req", "-newkey", "rsa:2048", "-nodes", "-keyout", str(tmp / f"{name}-key.pem"),
         "-out", str(tmp / f"{name}.csr"), "-subj", f"/CN={name}")
    _run("openssl", "x509", "-req", "-in", str(tmp / f"{name}.csr"), "-CA", str(ca), "-CAkey", str(cakey),
         "-CAcreateserial", "-out", str(tmp / f"{name}.pem"), "-days", "1", "-extfile", str(ext))
    return (tmp / f"{name}.pem").read_text(), (tmp / f"{name}-key.pem").read_text()


@pytest.fixture(scope="module")
def pki(tmp_path_factory):
    tmp = tmp_path_factory.mktemp("mtls")
    ca, cakey = tmp / "ca.pem", tmp / "ca-key.pem"
    _run("openssl", "req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", str(cakey),
         "-out", str(ca), "-days", "1", "-subj", "/CN=test-ca")
    server_cert, server_key = _leaf(tmp, SVC, ca, cakey)
    client_cert, client_key = _leaf(tmp, "xstockstrat-client", ca, cakey)
    # a leaf from a DIFFERENT CA (wrong-CA negative half)
    fca, fcakey = tmp / "fca.pem", tmp / "fca-key.pem"
    _run("openssl", "req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", str(fcakey),
         "-out", str(fca), "-days", "1", "-subj", "/CN=foreign-ca")
    foreign_cert, foreign_key = _leaf(tmp, "xstockstrat-client", fca, fcakey)
    return {
        "ca": ca.read_text(), "server_cert": server_cert, "server_key": server_key,
        "client_cert": client_cert, "client_key": client_key,
        "foreign_cert": foreign_cert, "foreign_key": foreign_key,
    }


def _set_env(mp, cert, key, ca):
    mp.setenv("MTLS_CERT", cert)
    mp.setenv("MTLS_KEY", key)
    mp.setenv("MTLS_CA_CERT", ca)


async def _serve(pki, monkeypatch):
    """Start an in-process mTLS server with a generic echo method; return (port, captured)."""
    _set_env(monkeypatch, pki["server_cert"], pki["server_key"], pki["ca"])
    captured: dict = {}

    async def _handler(request_bytes, context):
        captured["md"] = dict(context.invocation_metadata())
        return b"ok"

    rpc = grpc.unary_unary_rpc_method_handler(
        _handler, request_deserializer=lambda b: b, response_serializer=lambda b: b
    )
    generic = grpc.method_handlers_generic_handler("test.Echo", {"Call": rpc})
    server = grpc.aio.server()
    server.add_generic_rpc_handlers((generic,))
    port = server.add_secure_port("127.0.0.1:0", mtls.server_credentials())
    await server.start()
    return server, port, captured


async def _call(port, creds, target, monkeypatch, pki, client_cert, client_key, md=None):
    _set_env(monkeypatch, client_cert, client_key, pki["ca"])
    if creds == "insecure":
        channel = grpc.aio.insecure_channel(f"127.0.0.1:{port}")
    else:
        channel = grpc.aio.secure_channel(
            f"127.0.0.1:{port}", mtls.channel_credentials(), options=mtls.target_override(target)
        )
    try:
        call = channel.unary_unary(_METHOD, request_serializer=lambda b: b, response_deserializer=lambda b: b)
        return await call(b"ping", metadata=md, timeout=3)
    finally:
        await channel.close()


# --- @AC-4: fail-closed boot ---

def test_fail_closed_when_env_absent(monkeypatch):
    monkeypatch.delenv("MTLS_CERT", raising=False)
    monkeypatch.delenv("MTLS_KEY", raising=False)
    monkeypatch.delenv("MTLS_CA_CERT", raising=False)
    with pytest.raises(RuntimeError):
        mtls.server_credentials()
    with pytest.raises(RuntimeError):
        mtls.channel_credentials()


# --- @AC-2 mutual accept + @AC-5 trio propagation ---

async def test_mutual_handshake_and_propagation(pki, monkeypatch):
    server, port, captured = await _serve(pki, monkeypatch)
    try:
        resp = await _call(port, "secure", SVC, monkeypatch, pki, pki["client_cert"], pki["client_key"],
                           md=(("x-user-id", "u-1"), ("x-access-scope", "7"), ("x-trace-id", "t-1")))
        assert resp == b"ok"  # @AC-2
        md = captured["md"]  # @AC-5
        assert md.get("x-user-id") == "u-1"
        assert md.get("x-access-scope") == "7"
        assert md.get("x-trace-id") == "t-1"
    finally:
        await server.stop(grace=None)


# --- @AC-1: plaintext client refused ---

async def test_plaintext_client_refused(pki, monkeypatch):
    server, port, _ = await _serve(pki, monkeypatch)
    try:
        with pytest.raises(grpc.aio.AioRpcError):
            await _call(port, "insecure", SVC, monkeypatch, pki, pki["client_cert"], pki["client_key"])
    finally:
        await server.stop(grace=None)


# --- negative matrix (a): wrong-CA client cert rejected ---

async def test_wrong_ca_rejected(pki, monkeypatch):
    server, port, _ = await _serve(pki, monkeypatch)
    try:
        with pytest.raises(grpc.aio.AioRpcError):
            await _call(port, "secure", SVC, monkeypatch, pki, pki["foreign_cert"], pki["foreign_key"])
    finally:
        await server.stop(grace=None)


# --- negative matrix (b): valid-CA cert but WRONG pinned SAN rejected ---

async def test_wrong_san_rejected(pki, monkeypatch):
    server, port, _ = await _serve(pki, monkeypatch)
    try:
        with pytest.raises(grpc.aio.AioRpcError):
            await _call(port, "secure", "xstockstrat-wrong", monkeypatch, pki,
                       pki["client_cert"], pki["client_key"])
    finally:
        await server.stop(grace=None)
