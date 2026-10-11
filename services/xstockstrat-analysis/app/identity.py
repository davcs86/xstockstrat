"""The reserved platform identity and the single builder of an owner ``x-user-id`` header."""

SYSTEM_IDENTITY = "system"


def owner_metadata(owner: str) -> list[tuple[str, str]]:
    """Owner metadata for an outbound call; raises ValueError for an empty or `system` owner."""
    if not owner or owner == SYSTEM_IDENTITY:
        raise ValueError(f"owner-scoped call needs a real owner, got {owner!r}")
    return [("x-user-id", owner)]
