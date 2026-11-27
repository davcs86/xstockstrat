"""Agent SSO mode resolution (feature 345): auth.mode and agent oidc.issuer reads, log-once."""

import logging

from app import sso_mode
from app.config import watcher
from tests.test_config_watcher import install_watcher


def _records(caplog, message):
    return [r for r in caplog.records if r.getMessage() == message]


def test_identity_is_watched():
    assert "identity" in watcher.WATCHED_NAMESPACES


def test_ac72_invalid_mode_is_local_and_logs_once(monkeypatch, caplog):
    """@AC-72 (agent leg)"""
    install_watcher(monkeypatch, "identity", **{"auth.mode": "sso"})
    with caplog.at_level(logging.WARNING, logger="app.sso_mode"):
        assert sso_mode.current_auth_mode() == "local"
        assert sso_mode.current_auth_mode() == "local"
    assert len(_records(caplog, "auth_mode_invalid")) == 1


def test_ac31_absent_mode_is_local_without_log(caplog):
    """@AC-31 (agent leg)"""
    with caplog.at_level(logging.WARNING, logger="app.sso_mode"):
        assert sso_mode.current_auth_mode() == "local"
    assert _records(caplog, "auth_mode_invalid") == []


def test_valid_mode_is_returned(monkeypatch):
    install_watcher(monkeypatch, "identity", **{"auth.mode": "oidc"})
    assert sso_mode.current_auth_mode() == "oidc"


def test_ac55_invalid_issuer_logs_error_once_per_value(monkeypatch, caplog):
    """@AC-55 (agent log)"""
    install_watcher(monkeypatch, "agent", **{"oidc.issuer": "http://auth.example.test"})
    with caplog.at_level(logging.WARNING, logger="app.sso_mode"):
        assert sso_mode.agent_issuer() == ("http://auth.example.test", False)
        assert sso_mode.agent_issuer() == ("http://auth.example.test", False)
        errors = [r for r in _records(caplog, "sso_issuer_invalid") if r.levelno == logging.ERROR]
        assert len(errors) == 1
        assert errors[0].reason == "agent_issuer"
        install_watcher(monkeypatch, "agent", **{"oidc.issuer": "https://auth.example.test/"})
        assert sso_mode.agent_issuer() == ("https://auth.example.test/", False)
    assert len(_records(caplog, "sso_issuer_invalid")) == 2


def test_valid_issuer(monkeypatch, caplog):
    install_watcher(monkeypatch, "agent", **{"oidc.issuer": "https://auth.example.test"})
    with caplog.at_level(logging.WARNING, logger="app.sso_mode"):
        assert sso_mode.agent_issuer() == ("https://auth.example.test", True)
    assert _records(caplog, "sso_issuer_invalid") == []
