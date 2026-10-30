"""Phase-1 RPC read policy: only methods annotated `idempotency_level = NO_SIDE_EFFECTS` in the
local descriptors, plus explicitly approved benign reads, may be called."""

from collections.abc import Awaitable, Callable
from dataclasses import dataclass

from google.protobuf import descriptor_pb2

HARD_DENIED = frozenset({"xstockstrat.config.v1.ConfigService/GetSecret"})


@dataclass(frozen=True)
class BenignRead:
    side_effect: str
    # Returns a refusal reason, or None when the read is safe for the calling Rpc's user.
    guard: Callable[..., Awaitable[str | None]] | None


@dataclass(frozen=True)
class Decision:
    allowed: bool
    reason: str
    guard: Callable[..., Awaitable[str | None]] | None = None


# Operator override of FR-5 (feature 280 design): zero enabled entries until a check needs one.
BENIGN_READS: dict[str, BenignRead] = {}


def decide(full_method: str, *, descriptors, benign=BENIGN_READS) -> Decision:
    if full_method in HARD_DENIED:
        return Decision(False, f"{full_method} is hard-denied")
    service, _, method = full_method.partition("/")
    try:
        desc = descriptors.FindServiceByName(service).FindMethodByName(method)
    except KeyError:
        desc = None
    if desc is None:
        return Decision(False, f"{full_method}: unknown method")
    if desc.GetOptions().idempotency_level == descriptor_pb2.MethodOptions.NO_SIDE_EFFECTS:
        return Decision(True, "NO_SIDE_EFFECTS")
    entry = benign.get(full_method)
    if entry is not None:
        return Decision(True, f"benign read: {entry.side_effect}", entry.guard)
    return Decision(False, f"{full_method} is not annotated NO_SIDE_EFFECTS")
