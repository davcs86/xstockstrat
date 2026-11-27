"""The reserved platform identity and the single builder of an owner ``x-user-id`` header."""

SYSTEM_IDENTITY = "system"


def is_real_owner(owner: str) -> bool:
    """True for an owner that may scope an outbound call: neither empty nor `system`."""
    return bool(owner) and owner != SYSTEM_IDENTITY


def owner_metadata(owner: str) -> list[tuple[str, str]]:
    """Owner metadata for an outbound call; raises ValueError for an empty or `system` owner."""
    if not is_real_owner(owner):
        raise ValueError(f"owner-scoped call needs a real owner, got {owner!r}")
    return [("x-user-id", owner)]
