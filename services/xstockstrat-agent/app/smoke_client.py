"""Pinned mutual-TLS HTTP client for the staging xstockstrat-smoke API (feature 280).

Plain httpx on purpose (not egress.py: the target is an internal mesh peer, not a public URL).
Verification is never relaxed: the server name is pinned to `xstockstrat-smoke` via SNI.
"""

import json
import os
import ssl
import tempfile
from pathlib import Path

import httpx
from jsonschema import Draft202012Validator

SERVER_NAME = "xstockstrat-smoke"
PIN = {"sni_hostname": SERVER_NAME}
_TIMEOUT_S = 30
_SCHEMA = json.loads((Path(__file__).parent / "smoke_run_file.v1.json").read_text())
_VALIDATOR = Draft202012Validator(_SCHEMA)


def build_ssl_context() -> ssl.SSLContext:
    """Verify the platform CA and the pinned name; present the agent's own leaf."""
    cert = os.environ.get("MTLS_CERT", "")
    key = os.environ.get("MTLS_KEY", "")
    ca = os.environ.get("MTLS_CA_CERT", "")
    if not cert or not key or not ca:
        raise RuntimeError(
            "smoke: MTLS_CERT, MTLS_KEY and MTLS_CA_CERT must all be set (fail-closed)"
        )
    ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_CLIENT)
    ctx.check_hostname = True
    ctx.verify_mode = ssl.CERT_REQUIRED
    ctx.load_verify_locations(cadata=ca)
    paths = []
    try:
        for pem in (cert, key):
            fd, path = tempfile.mkstemp(suffix=".pem")  # mkstemp creates the file 0600
            paths.append(path)
            with os.fdopen(fd, "w") as f:
                f.write(pem)
        ctx.load_cert_chain(paths[0], paths[1])
    finally:
        for path in paths:
            Path(path).unlink(missing_ok=True)
    return ctx


def build_client() -> httpx.AsyncClient:
    return httpx.AsyncClient(verify=build_ssl_context(), trust_env=False, timeout=_TIMEOUT_S)


def validate_run_file(body: object) -> None:
    errors = sorted(_VALIDATOR.iter_errors(body), key=lambda e: list(e.path))
    if errors:
        e = errors[0]
        where = "/".join(str(p) for p in e.path) or "<root>"
        raise RuntimeError(f"smoke: run-file body failed schema validation at {where}: {e.message}")
