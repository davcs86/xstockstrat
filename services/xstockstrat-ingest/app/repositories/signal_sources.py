from __future__ import annotations


async def get_active_source(db_pool, slug: str) -> dict | None:
    row = await db_pool.fetchrow(
        "SELECT slug, display_name, source_type, extractor_module, credentials_ref,"
        " active, config_json FROM ingest.signal_sources WHERE slug = $1 AND active = TRUE",
        slug,
    )
    return dict(row) if row is not None else None


async def list_all_sources(db_pool, include_inactive: bool = False) -> list[dict]:
    if include_inactive:
        rows = await db_pool.fetch(
            "SELECT slug, display_name, source_type, extractor_module, credentials_ref,"
            " active, config_json, created_at FROM ingest.signal_sources ORDER BY created_at ASC"
        )
    else:
        rows = await db_pool.fetch(
            "SELECT slug, display_name, source_type, extractor_module, credentials_ref,"
            " active, config_json, created_at FROM ingest.signal_sources"
            " WHERE active = TRUE ORDER BY created_at ASC"
        )
    return [dict(row) for row in rows]


async def upsert_source(
    db_pool,
    *,
    slug: str,
    display_name: str,
    source_type: str,
    extractor_module: str,
    credentials_ref: str | None,
    config_json: dict | None,
) -> dict:
    row = await db_pool.fetchrow(
        "INSERT INTO ingest.signal_sources"
        " (slug, display_name, source_type, extractor_module, credentials_ref, config_json)"
        " VALUES ($1, $2, $3, $4, $5, $6)"
        " ON CONFLICT (slug) DO UPDATE SET"
        "   display_name = EXCLUDED.display_name,"
        "   source_type = EXCLUDED.source_type,"
        "   extractor_module = EXCLUDED.extractor_module,"
        "   credentials_ref = EXCLUDED.credentials_ref,"
        "   config_json = EXCLUDED.config_json"
        " RETURNING *",
        slug,
        display_name,
        source_type,
        extractor_module,
        credentials_ref,
        config_json,
    )
    return dict(row)


async def deactivate_source(db_pool, slug: str) -> dict | None:
    row = await db_pool.fetchrow(
        "UPDATE ingest.signal_sources SET active = FALSE WHERE slug = $1 RETURNING *",
        slug,
    )
    return dict(row) if row is not None else None


def validate_config_json(source_type: str, config_json: dict | None) -> str | None:
    cfg = config_json or {}

    if source_type in ("simple_email", "email_attachment", "linked_email"):
        if not cfg.get("sender_patterns"):
            return f"{source_type} requires non-empty sender_patterns in config_json"
        if not cfg.get("subject_patterns"):
            return f"{source_type} requires non-empty subject_patterns in config_json"
        if source_type == "email_attachment" and not cfg.get("attachment_mime_types"):
            return "email_attachment requires non-empty attachment_mime_types in config_json"
        if source_type == "linked_email" and not cfg.get("url_patterns"):
            return "linked_email requires non-empty url_patterns in config_json"

    elif source_type in ("simple_website", "authenticated_website"):
        if not cfg.get("url"):
            return f"{source_type} requires non-empty url in config_json"
        if not cfg.get("scrape_selector"):
            return f"{source_type} requires non-empty scrape_selector in config_json"

    return None
