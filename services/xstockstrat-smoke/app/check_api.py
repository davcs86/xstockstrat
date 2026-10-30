"""The API check modules are written against (contract: services/xstockstrat-smoke/CLAUDE.md)."""

from dataclasses import dataclass
from typing import Any

CHECKS_API_VERSION = 1


@dataclass(frozen=True)
class CheckMeta:
    id: str
    feature: str
    part: str
    timeout_s: float


def check(id: str, feature: str, part: str, timeout_s: float = 30):
    def register(fn):
        fn.__smoke_check__ = CheckMeta(id, feature, part, timeout_s)
        return fn

    return register


class CheckFailure(Exception):
    """Raised by a check to record outcome FAIL with this message as evidence."""


class CheckContext:
    def __init__(self, *, db, rpc):
        self.db = db
        self.rpc = rpc
        self.evidence_items: dict[str, Any] = {}

    def evidence(self, key: str, value: Any) -> None:
        self.evidence_items[key] = value
