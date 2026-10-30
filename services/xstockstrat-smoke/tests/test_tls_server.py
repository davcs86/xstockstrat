"""Real-TLS tests of the mTLS listener and its SAN allowlist (openssl-minted CA and leaves)."""

import os
import pathlib
import subprocess
import sys

import httpx
import pytest

from app import main, tls_server
from app.catalog import load_catalog
from tests._helpers import Counter, make_runner, wait_done
from tests.conftest import PIN, PROTO_GEN, SERVICE_ROOT, tls_client


def smoke_app(catalog=None, runner=None):
    counter = Counter()
    runner = runner or make_runner([counter.check])
    app = main.build_app(runner=runner, catalog=catalog or runner.catalog, deployed_sha="a1b2c3d")
    return tls_server.san_gate(app), counter, runner


async def test_agent_leaf_gets_200(pki, serve_tls):
    app, _, _ = smoke_app(catalog=load_catalog())
    base = await serve_tls(app)
    async with tls_client(pki, "xstockstrat-agent") as c:
        r = await c.get(f"{base}/checks", extensions=PIN)
    assert r.status_code == 200
    body = r.json()
    assert body["deployed_sha"] == "a1b2c3d"
    (entry,) = [c for c in body["checks"] if c["id"] == "example.pass_trivial"]
    assert entry["feature"] == "smoke-check-runtime"
    assert entry["part"] == "phase-1"
    assert len(entry["check_hash"]) == 64
    assert set(entry["check_hash"]) <= set("0123456789abcdef")


async def test_trigger_leaf_gets_200(pki, serve_tls):
    app, counter, runner = smoke_app()
    base = await serve_tls(app)
    async with tls_client(pki, "xstockstrat-smoke-trigger") as c:
        r = await c.post(f"{base}/runs", json={"checks": ["c.count"]}, extensions=PIN)
        assert r.status_code == 202
        run_id = r.json()["run_id"]
        await wait_done(runner, run_id)
        r = await c.get(f"{base}/runs/{run_id}", extensions=PIN)
    assert r.status_code == 200
    assert r.json()["file"]["body"]["triggered_by"] == "xstockstrat-smoke-trigger"
    assert counter.runs == 1


async def test_no_client_cert_connection_fails_and_nothing_runs(pki, serve_tls):
    app, counter, _ = smoke_app()
    base = await serve_tls(app)
    async with tls_client(pki, None) as c:
        with pytest.raises(httpx.TransportError):
            await c.post(f"{base}/runs", json={"checks": ["c.count"]}, extensions=PIN)
    assert counter.runs == 0


async def test_trading_leaf_gets_403_and_nothing_runs(pki, serve_tls):
    app, counter, _ = smoke_app()
    base = await serve_tls(app)
    async with tls_client(pki, "xstockstrat-trading") as c:
        r = await c.post(f"{base}/runs", json={"checks": ["c.count"]}, extensions=PIN)
    assert r.status_code == 403
    assert counter.runs == 0


async def test_wrong_san_server_rejected_by_pinned_client(pki, serve_tls):
    seen = []

    async def app(scope, receive, send):
        seen.append(scope["type"])

    base = await serve_tls(tls_server.san_gate(app), leaf="xstockstrat-ledger")
    async with tls_client(pki, "xstockstrat-agent") as c:
        with pytest.raises(httpx.ConnectError, match="(?i)hostname|certificate verify failed"):
            await c.get(f"{base}/checks", extensions=PIN)
    assert "http" not in seen


def _run_main(env, tmp_path):
    (tmp_path / "gen").symlink_to(PROTO_GEN)
    env = {
        "PATH": os.environ["PATH"],
        "PYTHONPATH": f"{SERVICE_ROOT}{os.pathsep}{tmp_path}",
        **env,
    }
    return subprocess.run(
        [sys.executable, "-m", "app.main"],
        cwd=SERVICE_ROOT,
        env=env,
        capture_output=True,
        text=True,
        timeout=60,
    )


def test_refuses_to_start_without_mtls_material_naming_var(pki, tmp_path):
    leaf = pki["xstockstrat-smoke"]
    proc = _run_main(
        {"SMOKE_GIT_SHA": "a1b2c3d", "MTLS_CERT": leaf["cert"], "MTLS_CA_CERT": pki["ca"]},
        tmp_path,
    )
    assert proc.returncode != 0
    assert "MTLS_KEY" in proc.stderr
    assert "running on" not in proc.stderr.lower()


def test_refuses_to_start_without_git_sha(pki, tmp_path):
    leaf = pki["xstockstrat-smoke"]
    proc = _run_main(
        {"MTLS_CERT": leaf["cert"], "MTLS_KEY": leaf["key"], "MTLS_CA_CERT": pki["ca"]},
        tmp_path,
    )
    assert proc.returncode != 0
    assert "SMOKE_GIT_SHA" in proc.stderr


def test_tmpdir_empty_after_startup(pki, tmp_path, monkeypatch):
    monkeypatch.setattr("tempfile.tempdir", str(tmp_path))
    leaf = pki["xstockstrat-smoke"]
    ctx = tls_server.build_ssl_context(leaf["cert"], leaf["key"], pki["ca"])
    assert ctx.verify_mode.name == "CERT_REQUIRED"
    assert list(pathlib.Path(tmp_path).iterdir()) == []


def test_tmpdir_empty_when_key_is_invalid(pki, tmp_path, monkeypatch):
    monkeypatch.setattr("tempfile.tempdir", str(tmp_path))
    with pytest.raises(Exception):
        tls_server.build_ssl_context(pki["xstockstrat-smoke"]["cert"], "garbage", pki["ca"])
    assert list(pathlib.Path(tmp_path).iterdir()) == []


def test_san_hook_not_installed_is_fatal(pki):
    leaf = pki["xstockstrat-smoke"]
    ctx = tls_server.build_ssl_context(leaf["cert"], leaf["key"], pki["ca"])
    app, _, _ = smoke_app()
    with pytest.raises(tls_server.SanHookMissing, match="SAN hook"):
        tls_server.make_server(app, ctx, host="127.0.0.1", port=9110, http="auto")


def test_san_hook_installed_by_default(pki):
    leaf = pki["xstockstrat-smoke"]
    ctx = tls_server.build_ssl_context(leaf["cert"], leaf["key"], pki["ca"])
    app, _, _ = smoke_app()
    server = tls_server.make_server(app, ctx, host="127.0.0.1", port=9110)
    assert issubclass(server.config.http_protocol_class, tls_server.SanProtocol)
    assert server.config.ssl is ctx
