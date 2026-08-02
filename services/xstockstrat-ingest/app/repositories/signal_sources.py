from __future__ import annotations

import json
from datetime import datetime

# Source-health freshness thresholds (feature 083). Health is derived on read from
# last_seen_at: fed within LIVE → live; within STALE → stale; older / never / errored → down.
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


async def get_active_source(db_pool, slug: str) -> dict | None:
    row = await db_pool.fetchrow(
        "SELECT slug, display_name, source_type, extractor_module, credentials_ref,"
        " active, config_json FROM ingest.signal_sources WHERE slug = $1 AND active = TRUE",
        slug,
    )
    return dict(row) if row is not None else None


async def list_all_sources(db_pool, include_inactive: bool = False) -> list[dict]:
    cols = (
        "slug, display_name, source_type, extractor_module, credentials_ref,"
        " active, config_json, created_at, last_seen_at, last_error, signals_fed"
    )
    if include_inactive:
        rows = await db_pool.fetch(
            f"SELECT {cols} FROM ingest.signal_sources ORDER BY created_at ASC"
        )
    else:
        rows = await db_pool.fetch(
            f"SELECT {cols} FROM ingest.signal_sources WHERE active = TRUE ORDER BY created_at ASC"
        )
    return [dict(row) for row in rows]


async def mark_source_fed(db_pool, slug: str) -> None:
    """Record a successful signal feed: bump last_seen_at + signals_fed, clear last_error
    (feature 083). Best-effort — callers wrap this so a bookkeeping failure never fails ingest."""
    await db_pool.execute(
        "UPDATE ingest.signal_sources"
        " SET last_seen_at = NOW(), signals_fed = signals_fed + 1, last_error = NULL"
        " WHERE slug = $1",
        slug,
    )


async def mark_source_error(db_pool, slug: str, error: str) -> None:
    """Record the last error a source's ingest hit (feature 083). Best-effort."""
    await db_pool.execute(
        "UPDATE ingest.signal_sources SET last_error = $2 WHERE slug = $1",
        slug,
        error,
    )


async def get_source(db_pool, slug: str) -> dict | None:
    """Fetch a signal source by slug, or None (feature 088: honest register/update verbs)."""
    row = await db_pool.fetchrow("SELECT * FROM ingest.signal_sources WHERE slug = $1", slug)
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
) -> dict:
    """Strict create (feature 088). Raises asyncpg.UniqueViolationError on an existing slug — the
    servicer maps that to ALREADY_EXISTS. Replaces the old blind upsert on the register path."""
    # The pool has no JSONB codec, so asyncpg expects JSONB params as JSON text, not dicts.
    config_param = json.dumps(config_json) if config_json is not None else None
    row = await db_pool.fetchrow(
        "INSERT INTO ingest.signal_sources"
        " (slug, display_name, source_type, extractor_module, credentials_ref, config_json, active)"
        " VALUES ($1, $2, $3, $4, $5, $6, $7)"
        " RETURNING *",
        slug,
        display_name,
        source_type,
        extractor_module,
        credentials_ref,
        config_param,
        active,
    )
    return dict(row)


async def update_source(
    db_pool,
    *,
    slug: str,
    display_name: str,
    source_type: str,
    extractor_module: str,
    credentials_ref: str | None,
    config_json: dict | None,
) -> dict | None:
    """Write the already-merged columns for an existing source (feature 088). Never touches `active`
    (lifecycle is reactivate/deactivate only). Returns None if the slug is gone."""
    config_param = json.dumps(config_json) if config_json is not None else None
    row = await db_pool.fetchrow(
        "UPDATE ingest.signal_sources SET"
        "   display_name = $2,"
        "   source_type = $3,"
        "   extractor_module = $4,"
        "   credentials_ref = $5,"
        "   config_json = $6"
        " WHERE slug = $1"
        " RETURNING *",
        slug,
        display_name,
        source_type,
        extractor_module,
        credentials_ref,
        config_param,
    )
    return dict(row) if row is not None else None


async def reactivate_source(db_pool, slug: str) -> dict | None:
    """Set active = TRUE (feature 088: reactivation decoupled from update)."""
    row = await db_pool.fetchrow(
        "UPDATE ingest.signal_sources SET active = TRUE WHERE slug = $1 RETURNING *",
        slug,
    )
    return dict(row) if row is not None else None


async def deactivate_source(db_pool, slug: str) -> dict | None:
    row = await db_pool.fetchrow(
        "UPDATE ingest.signal_sources SET active = FALSE WHERE slug = $1 RETURNING *",
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
        # Internally-produced (non-extraction) signal — e.g. the fundamentals signal
        # producer (feature 062). No extraction config is required (config_json is NULL).
        return None

    else:
        # Fail-closed (feature 062): reject any source_type not explicitly allow-listed
        # above. The allow-list is a superset of the ingest.signal_sources source_type DB
        # CHECK, so no CHECK-valid type is wrongly rejected.
        return f"unsupported source_type {source_type!r}"

    return None
