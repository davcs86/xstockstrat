"""SSO mode and issuer reads for the agent (feature 345); no read is cached across requests."""

import logging
import re

# One receiver alias per namespace: config-wiring attributes each read by its receiver name.
from app.config import watcher as agent_config
from app.config import watcher as identity_config

log = logging.getLogger(__name__)

ISSUER_PATTERN = r"^(?:https://(?:(?:(?![a-z0-9]{2}--)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)*(?![a-z0-9]{2}--)[a-z](?:[a-z0-9-]{0,61}[a-z0-9])?|127\.0\.0\.1|\[::1\])(?::(?!443(?:/|$))(?:6553[0-5]|655[0-2][0-9]|65[0-4][0-9]{2}|6[0-4][0-9]{3}|[1-5][0-9]{4}|[1-9][0-9]{0,3}))?|http://(?:localhost|127\.0\.0\.1|\[::1\])(?::(?!80(?:/|$))(?:6553[0-5]|655[0-2][0-9]|65[0-4][0-9]{2}|6[0-4][0-9]{3}|[1-5][0-9]{4}|[1-9][0-9]{0,3}))?)(?:/(?!\.\.?(?:/|$))[A-Za-z0-9._~!$&'()*+,;=:-]+)*$"  # noqa: E501
_ISSUER_RE = re.compile(ISSUER_PATTERN)

AUTH_MODES = ("local", "both", "oidc")

_logged: set = set()


def is_valid_issuer(v) -> bool:
    return isinstance(v, str) and _ISSUER_RE.fullmatch(v) is not None


def parse_auth_mode(raw: str | None) -> tuple[str, bool]:
    """(mode, invalid): absent is a valid `local`; any other non-mode value is invalid `local`."""
    if raw is None:
        return "local", False
    if raw in AUTH_MODES:
        return raw, False
    return "local", True


def _log_once(level: str, message: str, key: tuple, extra: dict) -> None:
    if key in _logged:
        return
    _logged.add(key)
    getattr(log, level)(message, extra=extra)


def _reset_log_once() -> None:
    _logged.clear()


def current_auth_mode() -> str:
    raw = identity_config.read_config_value("identity", "auth.mode")
    mode, invalid = parse_auth_mode(raw)
    if invalid:
        _log_once("warning", "auth_mode_invalid", ("auth_mode", raw), {"value": raw})
    return mode


def agent_issuer() -> tuple[str, bool]:
    v = agent_config.read_config_value("agent", "oidc.issuer") or ""
    valid = is_valid_issuer(v)
    if not valid:
        _log_once("error", "sso_issuer_invalid", ("agent_issuer", v), {"reason": "agent_issuer"})
    return v, valid
