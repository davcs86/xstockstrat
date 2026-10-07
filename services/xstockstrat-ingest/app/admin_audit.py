"""FR-13 admin-read audit: an ADMIN reading another owner's objects emits ``audit.admin_read``.

One event on the admin's stream carries every foreign id; one event per distinct foreign owner
carries that owner's ids (1 + K). A read of only the admin's own objects emits nothing.
"""

import asyncio

from gen.ledger.v1 import ledger_pb2
from google.protobuf.struct_pb2 import Struct

# Fixed invariant caps (operator round-5 ruling: named constants, not config keys). Ledger runs
# with DB_POOL_MAX=1, so appends serialize there; 4 in flight bounds the queue we add to it.
_AUDIT_APPEND_CONCURRENCY = 4
# K ceiling = the largest list page an owner selector can return; ingest enforces no list cap
# of its own, so this matches the platform's 100-row default list page.
_AUDIT_MAX_OWNERS_PER_PAGE = 100

_PROPAGATED_HEADERS = ("x-user-id", "x-access-scope", "x-trace-id")


class AdminAuditError(Exception):
    """The audit could not be recorded; the read MUST fail closed (UNAVAILABLE)."""


def _event(admin_id, object_kind, stream_owner, ids):
    payload = Struct()
    payload.update({"admin_id": admin_id, "object_kind": object_kind, "object_ids": list(ids)})
    return ledger_pb2.AppendEventRequest(
        event_type="audit.admin_read",
        source_service="xstockstrat-ingest",
        stream_key=f"user:{stream_owner}",
        payload=payload,
        user_id=stream_owner,
    )


async def audit_admin_read(
    ledger_stub, admin_id, object_kind, ids_by_owner: dict[str, list[str]], trace_meta
) -> None:
    """Append the 1 + K ``audit.admin_read`` events; raise ``AdminAuditError`` on any failure."""
    foreign = {o: list(ids) for o, ids in ids_by_owner.items() if o and o != admin_id and ids}
    if not foreign:
        return
    if len(foreign) > _AUDIT_MAX_OWNERS_PER_PAGE:
        raise AdminAuditError(f"{len(foreign)} owners on one page exceeds the audit ceiling")
    metadata = [(k, v) for k, v in trace_meta if k in _PROPAGATED_HEADERS]
    all_ids = [i for ids in foreign.values() for i in ids]
    events = [_event(admin_id, object_kind, admin_id, all_ids)] + [
        _event(admin_id, object_kind, owner, ids) for owner, ids in foreign.items()
    ]
    sem = asyncio.Semaphore(_AUDIT_APPEND_CONCURRENCY)

    async def _append(ev):
        async with sem:
            await ledger_stub.AppendEvent(ev, metadata=metadata)

    results = await asyncio.gather(*(_append(ev) for ev in events), return_exceptions=True)
    failures = [r for r in results if isinstance(r, BaseException)]
    if failures:
        raise AdminAuditError(f"audit.admin_read append failed: {failures[0]}") from failures[0]
