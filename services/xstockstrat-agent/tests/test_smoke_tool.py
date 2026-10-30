"""Feature 280 (S7) — staging-only `smoke_checks` agent tool: registration gate, admin gate,
HTTP client behaviour, mTLS server-name pinning and run-file schema validation."""

import asyncio
import os
import pathlib
import socket
import ssl
import subprocess
import threading

import httpx
import pytest
from mcp.server.mcpserver import MCPServer

from app import smoke_client
from app.tools import register_tools
from tests.conftest import ADMIN, TRADER, _ctx

_REPO = pathlib.Path(__file__).resolve().parents[3]
_APP = pathlib.Path(__file__).resolve().parents[1] / "app"


def _server(monkeypatch, endpoint: str | None) -> MCPServer:
    if endpoint is None:
        monkeypatch.delenv("SMOKE_ENDPOINT", raising=False)
    else:
        monkeypatch.setenv("SMOKE_ENDPOINT", endpoint)
    server = MCPServer("test-agent")
    register_tools(server)
    return server


def _fn(server: MCPServer):
    return server._tool_manager.get_tool("smoke_checks").fn


def test_absent_when_endpoint_unset_and_count_45(monkeypatch):
    server = _server(monkeypatch, None)
    assert server._tool_manager.get_tool("smoke_checks") is None
    assert len(server._tool_manager.list_tools()) == 45


def test_present_when_set(monkeypatch):
    server = _server(monkeypatch, "xstockstrat-smoke:9110")
    assert server._tool_manager.get_tool("smoke_checks") is not None
    assert len(server._tool_manager.list_tools()) == 46


async def test_non_admin_permission_error_before_http(monkeypatch):
    fn = _fn(_server(monkeypatch, "xstockstrat-smoke:9110"))

    def boom(*a, **k):
        raise AssertionError("HTTP client built for a non-admin caller")

    monkeypatch.setattr(smoke_client, "build_client", boom)
    with pytest.raises(PermissionError):
        await fn(ctx=_ctx(TRADER), action="list")


class _Recorder:
    """Stands in for the pinned httpx client; records requests, replays canned responses."""

    def __init__(self, responses):
        self.responses = responses
        self.calls = []

    async def request(self, method, url, **kw):
        self.calls.append((method, url, kw))
        status, body, headers = self.responses.pop(0)
        return httpx.Response(
            status, json=body, headers=headers, request=httpx.Request(method, url)
        )

    async def aclose(self):
        pass


def _install(monkeypatch, responses) -> _Recorder:
    rec = _Recorder(responses)
    monkeypatch.setattr(smoke_client, "build_client", lambda: rec)
    return rec


async def test_run_posts_ids_and_returns_run_id(monkeypatch):
    fn = _fn(_server(monkeypatch, "xstockstrat-smoke:9110"))
    rec = _install(monkeypatch, [(202, {"run_id": "abc"}, {})])
    out = await fn(ctx=_ctx(ADMIN), action="run", checks=["c1", "c2"])
    assert out == {"run_id": "abc"}
    method, url, kw = rec.calls[0]
    assert (method, url) == ("POST", "https://xstockstrat-smoke:9110/runs")
    assert kw["json"] == {"checks": ["c1", "c2"]}


async def test_run_conflict_surfaces_retry_after(monkeypatch):
    fn = _fn(_server(monkeypatch, "xstockstrat-smoke:9110"))
    _install(
        monkeypatch,
        [(409, {"error": "run_in_progress", "retry_after_s": 12}, {"Retry-After": "12"})],
    )
    out = await fn(ctx=_ctx(ADMIN), action="run", checks=["c1"])
    assert out == {"error": "run_in_progress", "retry_after_s": 12}


async def test_argument_validation(monkeypatch):
    fn = _fn(_server(monkeypatch, "xstockstrat-smoke:9110"))
    _install(monkeypatch, [])
    with pytest.raises(ValueError):
        await fn(ctx=_ctx(ADMIN), action="run")
    with pytest.raises(ValueError):
        await fn(ctx=_ctx(ADMIN), action="get_run")


def _record():
    return {
        "check_id": "c1",
        "check_hash": "a" * 64,
        "feature": "280",
        "part": "p",
        "outcome": "PASS",
        "started_at": "2026-10-30T00:00:00Z",
        "duration_ms": 3,
        "rpcs_invoked": [],
        "evidence": {"k": 1},
    }


def _run_file(**over):
    body = {
        "schema_version": 1,
        "run_id": "abc",
        "env": "homelab-staging",
        "deployed_sha": "deadbeef",
        "started_at": "2026-10-30T00:00:00Z",
        "trigger": "agent",
        "triggered_by": "xstockstrat-agent",
        "records": [_record()],
    }
    body.update(over)
    return body


async def test_agent_validates_run_file_against_schema_copy(monkeypatch):
    fn = _fn(_server(monkeypatch, "xstockstrat-smoke:9110"))
    good = {"status": "done", "records": [], "file": {"path": "p", "body": _run_file()}}
    bad = {"status": "done", "records": [], "file": {"path": "p", "body": _run_file(env="prod")}}
    running = {"status": "running", "records": []}
    rec = _install(monkeypatch, [(200, good, {}), (200, bad, {}), (200, running, {})])
    out = await fn(ctx=_ctx(ADMIN), action="get_run", run_id="abc")
    assert out["status"] == "done" and rec.calls[0][:2] == (
        "GET",
        "https://xstockstrat-smoke:9110/runs/abc",
    )
    with pytest.raises(RuntimeError, match="run-file"):
        await fn(ctx=_ctx(ADMIN), action="get_run", run_id="abc")
    assert (await fn(ctx=_ctx(ADMIN), action="get_run", run_id="abc"))["status"] == "running"


def test_schema_copy_matches_smoke_schema():
    src = _REPO / "services/xstockstrat-smoke/schema/run-file.v1.json"
    assert (_APP / "smoke_run_file.v1.json").read_bytes() == src.read_bytes()


def test_no_secret_material_in_module():
    text = (_APP / "smoke_client.py").read_text()
    assert "verify=False" not in text and "check_hostname = False" not in text


# ── real TLS: a platform leaf with the wrong SAN must be rejected (AC-33 agent half) ──


def _sh(*args):
    subprocess.run(args, check=True, capture_output=True)


@pytest.fixture
def tls_pki(tmp_path):
    d = tmp_path
    _sh(
        "openssl", "req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", f"{d}/ca.key",
        "-out", f"{d}/ca.pem", "-subj", "/CN=test-ca", "-days", "2",
        "-addext", "basicConstraints=critical,CA:TRUE",
        "-addext", "keyUsage=critical,keyCertSign,cRLSign",
    )  # fmt: skip
    out = {"ca": (d / "ca.pem").read_text()}
    for name in ("xstockstrat-agent", "xstockstrat-smoke", "xstockstrat-ledger"):
        _sh(
            "openssl", "req", "-newkey", "rsa:2048", "-nodes", "-keyout", f"{d}/{name}.key",
            "-out", f"{d}/{name}.csr", "-subj", f"/CN={name}",
        )  # fmt: skip
        (d / f"{name}.ext").write_text(
            f"subjectAltName=DNS:{name}\nextendedKeyUsage=serverAuth,clientAuth\n"
        )
        _sh(
            "openssl", "x509", "-req", "-in", f"{d}/{name}.csr", "-CA", f"{d}/ca.pem",
            "-CAkey", f"{d}/ca.key", "-CAcreateserial", "-out", f"{d}/{name}.pem",
            "-days", "2", "-extfile", f"{d}/{name}.ext",
        )  # fmt: skip
        out[name] = {
            "cert": (d / f"{name}.pem").read_text(),
            "key": (d / f"{name}.key").read_text(),
            "cert_path": str(d / f"{name}.pem"),
            "key_path": str(d / f"{name}.key"),
        }
    return out


def _serve(pki, leaf):
    """A blocking TLS server on localhost that answers one HTTP request; returns (port, hits)."""
    ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
    ctx.load_cert_chain(pki[leaf]["cert_path"], pki[leaf]["key_path"])
    ctx.load_verify_locations(cadata=pki["ca"])
    ctx.verify_mode = ssl.CERT_REQUIRED
    sock = socket.socket()
    sock.bind(("127.0.0.1", 0))
    sock.listen(1)
    hits = []

    def run():
        try:
            conn, _ = sock.accept()
            with ctx.wrap_socket(conn, server_side=True) as tls:
                data = tls.recv(4096)
                hits.append(data)
                body = b'{"deployed_sha":"x","checks":[],"load_errors":[]}'
                tls.sendall(
                    b"HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nConnection: close\r\n"
                    + f"Content-Length: {len(body)}\r\n\r\n".encode()
                    + body
                )
        except (ssl.SSLError, OSError):
            pass
        finally:
            sock.close()

    threading.Thread(target=run, daemon=True).start()
    return sock.getsockname()[1], hits


@pytest.mark.parametrize(
    "server_leaf,ok", [("xstockstrat-ledger", False), ("xstockstrat-smoke", True)]
)
async def test_name_pinning_rejects_wrong_san_server(monkeypatch, tls_pki, server_leaf, ok):
    monkeypatch.setenv("MTLS_CERT", tls_pki["xstockstrat-agent"]["cert"])
    monkeypatch.setenv("MTLS_KEY", tls_pki["xstockstrat-agent"]["key"])
    monkeypatch.setenv("MTLS_CA_CERT", tls_pki["ca"])
    port, hits = _serve(tls_pki, server_leaf)
    client = smoke_client.build_client()
    try:
        url = f"https://127.0.0.1:{port}/checks"
        if ok:
            r = await client.request("GET", url, extensions=smoke_client.PIN)
            assert r.status_code == 200
        else:
            with pytest.raises(httpx.ConnectError):
                await client.request("GET", url, extensions=smoke_client.PIN)
            await asyncio.sleep(0.1)
            assert hits == []
    finally:
        await client.aclose()


def test_temp_pem_files_unlinked_and_private(monkeypatch, tls_pki):
    import tempfile

    monkeypatch.setenv("MTLS_CERT", tls_pki["xstockstrat-agent"]["cert"])
    monkeypatch.setenv("MTLS_KEY", tls_pki["xstockstrat-agent"]["key"])
    monkeypatch.setenv("MTLS_CA_CERT", tls_pki["ca"])
    before = set(os.listdir(tempfile.gettempdir()))
    ctx = smoke_client.build_ssl_context()
    assert ctx.check_hostname and ctx.verify_mode == ssl.CERT_REQUIRED
    assert set(os.listdir(tempfile.gettempdir())) <= before


def test_missing_mtls_material_fails_closed(monkeypatch):
    for v in ("MTLS_CERT", "MTLS_KEY", "MTLS_CA_CERT"):
        monkeypatch.delenv(v, raising=False)
    with pytest.raises(RuntimeError, match="fail-closed"):
        smoke_client.build_ssl_context()


# ── hardening: bounded input and output, robust 409 ──


class _RawRecorder(_Recorder):
    async def request(self, method, url, **kw):
        self.calls.append((method, url, kw))
        status, content, headers = self.responses.pop(0)
        return httpx.Response(
            status, content=content, headers=headers, request=httpx.Request(method, url)
        )


async def test_non_json_409_still_reports_run_in_progress(monkeypatch):
    fn = _fn(_server(monkeypatch, "xstockstrat-smoke:9110"))
    rec = _RawRecorder([(409, b"<html>busy</html>", {})])
    monkeypatch.setattr(smoke_client, "build_client", lambda: rec)
    out = await fn(ctx=_ctx(ADMIN), action="run", checks=["c1"])
    assert out == {"error": "run_in_progress", "retry_after_s": None}


async def test_oversized_response_is_refused(monkeypatch):
    fn = _fn(_server(monkeypatch, "xstockstrat-smoke:9110"))
    rec = _RawRecorder([(200, b"x" * (smoke_client.MAX_RESPONSE_BYTES + 1), {})])
    monkeypatch.setattr(smoke_client, "build_client", lambda: rec)
    with pytest.raises(RuntimeError, match="too large"):
        await fn(ctx=_ctx(ADMIN), action="list")


async def test_non_json_success_is_a_clean_error(monkeypatch):
    fn = _fn(_server(monkeypatch, "xstockstrat-smoke:9110"))
    rec = _RawRecorder([(200, b"not json", {})])
    monkeypatch.setattr(smoke_client, "build_client", lambda: rec)
    with pytest.raises(RuntimeError, match="non-JSON"):
        await fn(ctx=_ctx(ADMIN), action="list")


@pytest.mark.parametrize("bad", ["..", "../x", "a/b", "", "a" * 65, "a b"])
async def test_run_id_charset_enforced_before_http(monkeypatch, bad):
    fn = _fn(_server(monkeypatch, "xstockstrat-smoke:9110"))
    rec = _install(monkeypatch, [])
    with pytest.raises(ValueError):
        await fn(ctx=_ctx(ADMIN), action="get_run", run_id=bad)
    assert rec.calls == []


@pytest.mark.parametrize("bad", [["a b"], ["x" * 129], ["a/b"], [""], ["ok", "$"]])
async def test_check_id_charset_enforced_before_http(monkeypatch, bad):
    fn = _fn(_server(monkeypatch, "xstockstrat-smoke:9110"))
    rec = _install(monkeypatch, [])
    with pytest.raises(ValueError):
        await fn(ctx=_ctx(ADMIN), action="run", checks=bad)
    assert rec.calls == []


async def test_check_count_is_capped(monkeypatch):
    fn = _fn(_server(monkeypatch, "xstockstrat-smoke:9110"))
    rec = _install(monkeypatch, [])
    with pytest.raises(ValueError, match="at most"):
        await fn(ctx=_ctx(ADMIN), action="run", checks=[f"c{i}" for i in range(201)])
    assert rec.calls == []
