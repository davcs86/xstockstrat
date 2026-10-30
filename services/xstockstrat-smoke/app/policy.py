"""RPC policy: methods annotated `idempotency_level = NO_SIDE_EFFECTS` in the local descriptors,
approved benign reads, and (phase 2) allowlisted owner-scoped writes under every guard."""

from collections.abc import Awaitable, Callable, Mapping
from dataclasses import dataclass, field

from google.protobuf import descriptor_pb2, unknown_fields

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
    write: bool = False


@dataclass(frozen=True)
class ScopedWrite:
    # Returns a refusal reason for the request, or None when it may be sent.
    predicate: Callable[[object], str | None]


def _submessages(fd, value):
    if fd.message_type is None:
        return []
    if fd.message_type.GetOptions().map_entry:
        return [v for v in value.values() if hasattr(v, "ListFields")]
    return list(value) if fd.is_repeated else [value]


def has_unknown_fields(message) -> bool:
    if len(unknown_fields.UnknownFieldSet(message)):
        return True
    return any(
        has_unknown_fields(sub)
        for fd, value in message.ListFields()
        for sub in _submessages(fd, value)
    )


def no_strategy_bindings(request) -> str | None:
    for fd, value in request.ListFields():
        if fd.name.endswith("strategy_id") and value:
            return f"carries a strategy_id binding ({fd.name})"
        for sub in _submessages(fd, value):
            reason = no_strategy_bindings(sub)
            if reason:
                return reason
    return None


FIXTURE_PREFIX = "smoke-"


def watchlist_fixture_write(request) -> str | None:
    reason = no_strategy_bindings(request)
    if reason:
        return reason
    if "name" in request.DESCRIPTOR.fields_by_name and request.name:
        if not request.name.startswith(FIXTURE_PREFIX):
            return f"name {request.name!r} lacks the {FIXTURE_PREFIX!r} fixture prefix"
    return None


_PORTFOLIO = "xstockstrat.portfolio.v1.PortfolioService/"
# Portfolio-owner approval of this allowlist is pending (feature 280 context.md); flag defaults off.
SCOPED_WRITES: dict[str, ScopedWrite] = {
    _PORTFOLIO + m: ScopedWrite(watchlist_fixture_write)
    for m in (
        "CreateWatchlist",
        "UpdateWatchlist",
        "AddWatchlistSymbols",
        "RemoveWatchlistSymbols",
        "DeleteWatchlist",
    )
}
STAGING_ENVS = frozenset({"homelab-staging", "do-dev"})


@dataclass(frozen=True)
class WritePolicy:
    enabled: bool
    env: str
    allowlist: Mapping[str, ScopedWrite] = field(default_factory=lambda: SCOPED_WRITES)


# Operator override of FR-5 (feature 280 design): zero enabled entries until a check needs one.
BENIGN_READS: dict[str, BenignRead] = {}


def decide(
    full_method: str,
    *,
    descriptors,
    benign=BENIGN_READS,
    writes: WritePolicy | None = None,
    request=None,
) -> Decision:
    if full_method in HARD_DENIED:
        return Decision(False, f"{full_method} is hard-denied")
    service, _, method = full_method.partition("/")
    try:
        desc = descriptors.FindServiceByName(service).FindMethodByName(method)
    except KeyError:
        desc = None
    if desc is None:
        return Decision(False, f"{full_method}: unknown method")
    if request is not None and request.DESCRIPTOR.full_name != desc.input_type.full_name:
        return Decision(
            False,
            f"{full_method}: request type {request.DESCRIPTOR.full_name} "
            f"is not {desc.input_type.full_name}",
        )
    if desc.GetOptions().idempotency_level == descriptor_pb2.MethodOptions.NO_SIDE_EFFECTS:
        return Decision(True, "NO_SIDE_EFFECTS")
    entry = benign.get(full_method)
    if entry is not None:
        return Decision(True, f"benign read: {entry.side_effect}", entry.guard)
    scoped = writes.allowlist.get(full_method) if writes is not None else None
    if scoped is None:
        return Decision(False, f"{full_method} is not annotated NO_SIDE_EFFECTS")
    if not writes.enabled:
        return Decision(False, f"{full_method}: smoke.writes.enabled is false")
    if writes.env not in STAGING_ENVS:
        return Decision(False, f"{full_method}: env {writes.env!r} is not a staging label")
    if request is None:
        return Decision(False, f"{full_method}: no request to check")
    if has_unknown_fields(request):
        return Decision(False, f"{full_method}: request carries unknown fields")
    refusal = scoped.predicate(request)
    if refusal:
        return Decision(False, f"{full_method}: {refusal}")
    return Decision(True, "scoped write", write=True)


def live(*, descriptors, env: str, writes_enabled: Callable[[], bool]):
    """A per-call decider: the kill switch is re-read on every call, so a flip needs no restart."""

    def _decide(full_method: str, request=None) -> Decision:
        writes = WritePolicy(enabled=bool(writes_enabled()), env=env)
        return decide(full_method, descriptors=descriptors, writes=writes, request=request)

    return _decide
