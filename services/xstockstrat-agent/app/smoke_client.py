"""Pinned mutual-TLS HTTP client for the staging xstockstrat-smoke API (feature 280).

Plain httpx on purpose (not egress.py: the target is an internal mesh peer, not a public URL).
Verification is never relaxed: the server name is pinned to `xstockstrat-smoke` via SNI.
"""

import json
import os
import re
import ssl
import tempfile
from pathlib import Path

import httpx
from jsonschema import Draft202012Validator

SERVER_NAME = "xstockstrat-smoke"
PIN = {"sni_hostname": SERVER_NAME}
_TIMEOUT_S = 30
MAX_RESPONSE_BYTES = 1024 * 1024
MAX_CHECKS = 200
_RUN_ID = re.compile(r"[A-Za-z0-9_-]{1,64}")
_CHECK_ID = re.compile(r"[A-Za-z0-9][A-Za-z0-9_.-]{0,127}")
_VALIDATORS = {
    v: Draft202012Validator(
        json.loads((Path(__file__).parent / f"smoke_run_file.v{v}.json").read_text())
    )
    for v in (1, 2)
}


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
    version = body.get("schema_version") if isinstance(body, dict) else None
    validator = _VALIDATORS.get(version) if isinstance(version, int) else None
    if validator is None:
        raise RuntimeError(f"smoke: run-file body has unsupported schema_version {version!r}")
    errors = sorted(validator.iter_errors(body), key=lambda e: list(e.path))
    if errors:
        e = errors[0]
        where = "/".join(str(p) for p in e.path) or "<root>"
        raise RuntimeError(f"smoke: run-file body failed schema validation at {where}: {e.message}")


def check_run_id(run_id: str) -> str:
    if not _RUN_ID.fullmatch(run_id):
        raise ValueError("run_id must match [A-Za-z0-9_-]{1,64}")
    return run_id


def check_ids(checks: list[str]) -> list[str]:
    if len(checks) > MAX_CHECKS:
        raise ValueError(f"checks has at most {MAX_CHECKS} ids")
    for c in checks:
        if not _CHECK_ID.fullmatch(c):
            raise ValueError("check ids must match [A-Za-z0-9][A-Za-z0-9_.-]{0,127}")
    return checks


def parse_json(r: httpx.Response) -> dict:
    """Bounded, tolerant body parse: oversize or non-JSON bodies become clean errors."""
    if len(r.content) > MAX_RESPONSE_BYTES:
        raise RuntimeError("smoke response too large")
    try:
        data = r.json()
    except ValueError:
        raise RuntimeError(f"smoke service returned non-JSON body (HTTP {r.status_code})") from None
    if not isinstance(data, dict):
        raise RuntimeError("smoke service returned a non-object body")
    return data
