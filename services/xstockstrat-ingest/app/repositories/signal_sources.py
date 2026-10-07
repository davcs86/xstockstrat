from __future__ import annotations

import json
from datetime import datetime

from gen.ingest.v1 import ingest_pb2

# Source-health freshness thresholds: fed within LIVE → live; within STALE → stale;
# older / never / errored → down.
_HEALTH_LIVE_SECONDS = 24 * 3600
_HEALTH_STALE_SECONDS = 7 * 24 * 3600


def derive_health_status(
    last_seen_at: datetime | None, last_error: str | None, now: datetime
) -> str:
    """Derive a source's health string from last-seen freshness + last-error, on read.

    Returns one of ``"live" | "stale" | "down" | "unspecified"`` (mapped to the
    SourceHealthStatus enum by the servicer). A source that has never fed a signal
    (``last_seen_at is None``) and has no error is ``"unspecified"`` (Unknown); a source
    whose last operation errored is ``"down"``."""
    if last_seen_at is None:
        return "down" if last_error else "unspecified"
    age = (now - last_seen_at).total_seconds()
    if last_error and age >= _HEALTH_LIVE_SECONDS:
        # A recent successful feed clears a stale error; an old feed + error → down.
        return "down"
    if age < _HEALTH_LIVE_SECONDS:
        return "live"
    if age < _HEALTH_STALE_SECONDS:
        return "stale"
    return "down"


SYSTEM_OWNER = "system"


def owner_scope_predicate(scope: int, idx: int) -> tuple[str, bool]:
    """WHERE fragment for a SignalScope; returns (sql, uses_param) — `$idx` is the owner when used.

    UNSPECIFIED (and any unknown value) = own + system; OWN = own only; SYSTEM = system only.
    """
    if scope == ingest_pb2.SIGNAL_SCOPE_OWN:
        return f"user_id = ${idx}", True
    if scope == ingest_pb2.SIGNAL_SCOPE_SYSTEM:
        return f"user_id = '{SYSTEM_OWNER}'", False
    return f"(user_id = ${idx} OR user_id = '{SYSTEM_OWNER}')", True


_LIST_COLS = (
    "user_id, slug, display_name, source_type, extractor_module, credentials_ref,"
    " active, config_json, created_at, last_seen_at, last_error, signals_fed,"
    " reliability_weight"
)


async def list_all_sources(db_pool, include_inactive: bool = False) -> list[dict]:
    """Every owner's sources — only for headerless (release-N) reads and the mcp_client poller."""
    if include_inactive:
        rows = await db_pool.fetch(
            f"SELECT {_LIST_COLS} FROM ingest.signal_sources ORDER BY created_at ASC"
        )
    else:
        rows = await db_pool.fetch(
            f"SELECT {_LIST_COLS} FROM ingest.signal_sources WHERE active = TRUE"
            " ORDER BY created_at ASC"
        )
    return [dict(row) for row in rows]


async def list_sources(
    db_pool, owner: str, scope: int, include_inactive: bool = False
) -> list[dict]:
    """The sources visible to `owner` under a SignalScope (own + system by default)."""
    predicate, uses_param = owner_scope_predicate(scope, 1)
    active = "" if include_inactive else " AND active = TRUE"
    rows = await db_pool.fetch(
        f"SELECT {_LIST_COLS} FROM ingest.signal_sources WHERE {predicate}{active}"
        " ORDER BY created_at ASC",
        *((owner,) if uses_param else ()),
    )
    return [dict(row) for row in rows]


async def slug_holders(db_pool, slug: str) -> list[str]:
    """Every owner holding `slug` (deliberately not owner-scoped: reserved-slug and headerless
    resolution need the full holder set)."""
    rows = await db_pool.fetch(
        "SELECT user_id FROM ingest.signal_sources WHERE slug = $1 ORDER BY user_id", slug
    )
    return [row["user_id"] for row in rows]


async def mark_source_fed(db_pool, user_id: str, slug: str) -> None:
    """Record a successful signal feed: bump last_seen_at + signals_fed, clear last_error
    (feature 083). Best-effort — callers wrap this so a bookkeeping failure never fails ingest."""
    await db_pool.execute(
        "UPDATE ingest.signal_sources"
        " SET last_seen_at = NOW(), signals_fed = signals_fed + 1, last_error = NULL"
        " WHERE user_id = $1 AND slug = $2",
        user_id,
        slug,
    )


async def mark_source_error(db_pool, user_id: str, slug: str, error: str) -> None:
    """Record the last error a source's ingest hit (feature 083). Best-effort."""
    await db_pool.execute(
        "UPDATE ingest.signal_sources SET last_error = $3 WHERE user_id = $1 AND slug = $2",
        user_id,
        slug,
        error,
    )


async def touch_source_last_seen(db_pool, user_id: str, slug: str) -> None:
    """Record that a source is alive (heard from it) without counting a new signal fed —
    used on a dedup hit, where mark_source_fed's signals_fed bump would be wrong (feature 111)."""
    await db_pool.execute(
        "UPDATE ingest.signal_sources SET last_seen_at = NOW() WHERE user_id = $1 AND slug = $2",
        user_id,
        slug,
    )


async def get_source(db_pool, user_id: str, slug: str) -> dict | None:
    """An owner's signal source by slug, or None (feature 088: honest register/update verbs)."""
    row = await db_pool.fetchrow(
        "SELECT * FROM ingest.signal_sources WHERE user_id = $1 AND slug = $2", user_id, slug
    )
    return dict(row) if row is not None else None


async def insert_source(
    db_pool,
    *,
    slug: str,
    display_name: str,
    source_type: str,
    extractor_module: str,
    credentials_ref: str | None,
    config_json: dict | None,
    active: bool = True,
    reliability_weight: float,
    user_id: str,
) -> dict:
    """Strict create (feature 088). Raises asyncpg.UniqueViolationError on an existing
    (user_id, slug) — the servicer checks holders first under an advisory lock.

    feature 134: reliability_weight is the INSERT column/param ($8), placed after `active`
    so the existing test's config_json positional index (6) is preserved; feature 224 appends
    the owner ($9)."""
    # The pool has no JSONB codec, so asyncpg expects JSONB params as JSON text, not dicts.
    config_param = json.dumps(config_json) if config_json is not None else None
    row = await db_pool.fetchrow(
        "INSERT INTO ingest.signal_sources"
        " (slug, display_name, source_type, extractor_module, credentials_ref, config_json, active,"
        " reliability_weight, user_id)"
        " VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)"
        " RETURNING *",
        slug,
        display_name,
        source_type,
        extractor_module,
        credentials_ref,
        config_param,
        active,
        reliability_weight,
        user_id,
    )
    return dict(row)


async def update_source(
    db_pool,
    *,
    user_id: str,
    slug: str,
    display_name: str,
    source_type: str,
    extractor_module: str,
    credentials_ref: str | None,
    config_json: dict | None,
    reliability_weight: float,
) -> dict | None:
    """Write the already-merged columns for an owner's existing source (feature 088). Never
    touches `active` (lifecycle is reactivate/deactivate only). Returns None if the row is gone.

    feature 134: reliability_weight is the SET column/param ($7); feature 224: owner is $8."""
    config_param = json.dumps(config_json) if config_json is not None else None
    row = await db_pool.fetchrow(
        "UPDATE ingest.signal_sources SET"
        "   display_name = $2,"
        "   source_type = $3,"
        "   extractor_module = $4,"
        "   credentials_ref = $5,"
        "   config_json = $6,"
        "   reliability_weight = $7"
        " WHERE slug = $1 AND user_id = $8"
        " RETURNING *",
        slug,
        display_name,
        source_type,
        extractor_module,
        credentials_ref,
        config_param,
        reliability_weight,
        user_id,
    )
    return dict(row) if row is not None else None


async def reactivate_source(db_pool, user_id: str, slug: str) -> dict | None:
    """Set active = TRUE (feature 088: reactivation decoupled from update)."""
    row = await db_pool.fetchrow(
        "UPDATE ingest.signal_sources SET active = TRUE"
        " WHERE user_id = $1 AND slug = $2 RETURNING *",
        user_id,
        slug,
    )
    return dict(row) if row is not None else None


async def deactivate_source(db_pool, user_id: str, slug: str) -> dict | None:
    row = await db_pool.fetchrow(
        "UPDATE ingest.signal_sources SET active = FALSE"
        " WHERE user_id = $1 AND slug = $2 RETURNING *",
        user_id,
        slug,
    )
    return dict(row) if row is not None else None


def validate_config_json(source_type: str, config_json: dict | None) -> str | None:
    cfg = config_json or {}

    if source_type in (
        "simple_email",
        "email_attachment",
        "linked_email",
        "mediated_simple_email",
        "mediated_email_attachment",
        "mediated_linked_email",
    ):
        if not cfg.get("sender_patterns"):
            return f"{source_type} requires non-empty sender_patterns in config_json"
        if not cfg.get("subject_patterns"):
            return f"{source_type} requires non-empty subject_patterns in config_json"
        if source_type in ("email_attachment", "mediated_email_attachment") and not cfg.get(
            "attachment_mime_types"
        ):
            return f"{source_type} requires non-empty attachment_mime_types in config_json"
        if source_type in ("linked_email", "mediated_linked_email") and not cfg.get("url_patterns"):
            return f"{source_type} requires non-empty url_patterns in config_json"

    elif source_type in (
        "simple_website",
        "authenticated_website",
        "mediated_simple_website",
        "mediated_authenticated_website",
    ):
        if not cfg.get("url"):
            return f"{source_type} requires non-empty url in config_json"
        if not cfg.get("scrape_selector"):
            return f"{source_type} requires non-empty scrape_selector in config_json"

    elif source_type == "derived":
        # Internally-produced signal (e.g. fundamentals producer); no extraction config required.
        return None

    elif source_type == "mcp_client":
        # Fail-closed on both fields (never default): the loop needs mcp_endpoint + mcp_tool
        # from config_json; the bearer is a credential (credentials_ref), never config_json.
        if not cfg.get("mcp_endpoint"):
            return f"{source_type} requires non-empty mcp_endpoint in config_json"
        if not cfg.get("mcp_tool"):
            return f"{source_type} requires non-empty mcp_tool in config_json"

    else:
        # Fail-closed: reject any source_type not allow-listed above. The allow-list is a
        # superset of the signal_sources source_type DB CHECK, so no valid type is rejected.
        return f"unsupported source_type {source_type!r}"

    return None
