"""Unit + structural tests for the agent's mutual-TLS secure-channel factory (feature 210, Step 12).

Asserts the factory (app/mtls.py) pins the verified server authority to the TARGET SERVICE NAME (not
the dialed host), builds real channel credentials from env PEM material, and fails closed when the
MTLS_* env is absent. Plus a structural regression guard that no `insecure_channel` dial survives
the 69-site sweep of app/client.py + app/auth.py.
"""

import subprocess
from pathlib import Path

import grpc
import pytest

from app import mtls

SVC = "xstockstrat-trading"
_APP = Path(__file__).resolve().parent.parent / "app"


def _run(*args):
    subprocess.run(args, check=True, capture_output=True)


@pytest.fixture
def agent_pki(tmp_path):
    """Mint a CA + agent leaf via openssl and set MTLS_* env to them (fail-open for this test)."""
    ca, cakey = tmp_path / "ca.pem", tmp_path / "ca-key.pem"
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
    ext = tmp_path / "agent.ext"
    ext.write_text("subjectAltName=DNS:xstockstrat-agent\nextendedKeyUsage=serverAuth,clientAuth\n")
    _run(
        "openssl",
        "req",
        "-newkey",
        "rsa:2048",
        "-nodes",
        "-keyout",
        str(tmp_path / "agent-key.pem"),
        "-out",
        str(tmp_path / "agent.csr"),
        "-subj",
        "/CN=xstockstrat-agent",
    )
    _run(
        "openssl",
        "x509",
        "-req",
        "-in",
        str(tmp_path / "agent.csr"),
        "-CA",
        str(ca),
        "-CAkey",
        str(cakey),
        "-CAcreateserial",
        "-out",
        str(tmp_path / "agent.pem"),
        "-days",
        "1",
        "-extfile",
        str(ext),
    )
    return {
        "cert": (tmp_path / "agent.pem").read_text(),
        "key": (tmp_path / "agent-key.pem").read_text(),
        "ca": ca.read_text(),
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


def test_no_insecure_channel_remains():
    """Regression guard for the 69-site sweep — no plaintext dial may survive."""
    for name in ("client.py", "auth.py"):
        assert "insecure_channel" not in (_APP / name).read_text(), (
            f"insecure_channel found in {name}"
        )
