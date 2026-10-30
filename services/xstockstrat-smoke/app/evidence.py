"""Evidence sanitizing: flat scalars, secret redaction by key name and value pattern, size cap."""

import json
import re
from typing import Any

EVIDENCE_CAP_BYTES = 4096
MAX_STRING_CHARS = 512
MAX_KEY_CHARS = 64
REDACTED = "[redacted]"

_SECRET_KEY = re.compile(r"(?i)token|secret|passw|api_?key|auth|cookie|credential|private|dsn|pem")
_VALUE_PATTERNS = (
    (re.compile(r"-----BEGIN [^-]+-----.*?(-----END [^-]+-----|$)", re.S), REDACTED),
    (re.compile(r"eyJ[\w-]+\.[\w-]+\.[\w-]*"), REDACTED),
    (re.compile(r"(?i)\bbearer\s+\S+"), f"Bearer {REDACTED}"),
    (re.compile(r"(\w+://[^:/\s@]+):[^@\s]+@"), rf"\1:{REDACTED}@"),
    (
        re.compile(r"(?i)\b(password|passwd|secret|token|api_?key)(\s*[=:]\s*)\S+"),
        rf"\1\2{REDACTED}",
    ),
)


def redact_text(text: str) -> str:
    for pattern, repl in _VALUE_PATTERNS:
        text = pattern.sub(repl, text)
    if len(text) > MAX_STRING_CHARS:
        text = text[:MAX_STRING_CHARS] + "...[truncated]"
    return text


def _scalar(value: Any) -> str | int | float | bool | None:
    if value is None or isinstance(value, bool | int | float):
        return value
    return redact_text(value if isinstance(value, str) else repr(value))


def sanitize(evidence: dict) -> dict:
    out: dict[str, Any] = {}
    for key, value in evidence.items():
        key = str(key)[:MAX_KEY_CHARS]
        candidate = REDACTED if _SECRET_KEY.search(key) else _scalar(value)
        trial = {**out, key: candidate, "_truncated": True}
        if len(json.dumps(trial).encode()) > EVIDENCE_CAP_BYTES:
            out["_truncated"] = True
            break
        out[key] = candidate
    return out
