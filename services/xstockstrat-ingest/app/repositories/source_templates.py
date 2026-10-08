"""Repository for the ``ingest.source_templates`` catalog (feature 224).

Module-level async functions in the style of ``signal_sources.py`` — each takes the asyncpg pool
(or a transaction connection) first and stays proto-free; ``payload`` is a SignalSource dict.
"""

from __future__ import annotations

import json

_COLS = (
    "template_id, name, description, payload, version, retired_at, created_by,"
    " created_at, updated_at"
)


async def list_active(db_pool) -> list[dict]:
    rows = await db_pool.fetch(
        f"SELECT {_COLS} FROM ingest.source_templates WHERE retired_at IS NULL"
        " ORDER BY created_at ASC"
    )
    return [dict(row) for row in rows]


async def get(db_pool, template_id: str) -> dict | None:
    """The template, retired or not (callers decide what a retired template means)."""
    row = await db_pool.fetchrow(
        f"SELECT {_COLS} FROM ingest.source_templates WHERE template_id = $1", template_id
    )
    return dict(row) if row is not None else None


async def create(
    db_pool, *, template_id: str, name: str, description: str, payload: dict, created_by: str
) -> dict:
    """Raises asyncpg.UniqueViolationError on an existing template_id."""
    row = await db_pool.fetchrow(
        "INSERT INTO ingest.source_templates"
        " (template_id, name, description, payload, created_by)"
        f" VALUES ($1, $2, $3, $4, $5) RETURNING {_COLS}",
        template_id,
        name,
        description,
        json.dumps(payload),
        created_by,
    )
    return dict(row)


async def update(
    db_pool, template_id: str, name: str, description: str, payload: dict
) -> dict | None:
    """Replace an active template's content and bump its version by 1; None if missing/retired."""
    row = await db_pool.fetchrow(
        "UPDATE ingest.source_templates"
        " SET name = $2, description = $3, payload = $4,"
        " version = version + 1, updated_at = NOW()"
        f" WHERE template_id = $1 AND retired_at IS NULL RETURNING {_COLS}",
        template_id,
        name,
        description,
        json.dumps(payload),
    )
    return dict(row) if row is not None else None


async def retire(db_pool, template_id: str) -> dict | None:
    """Hide the template from the catalog; instances are never touched. None if missing."""
    row = await db_pool.fetchrow(
        "UPDATE ingest.source_templates"
        " SET retired_at = NOW(), updated_at = NOW()"
        f" WHERE template_id = $1 RETURNING {_COLS}",
        template_id,
    )
    return dict(row) if row is not None else None


async def latest_versions(db_pool, template_ids: list[str]) -> dict[str, int]:
    """{template_id: version} for the active templates among `template_ids`, in one query."""
    if not template_ids:
        return {}
    rows = await db_pool.fetch(
        "SELECT template_id, version FROM ingest.source_templates"
        " WHERE template_id = ANY($1::text[]) AND retired_at IS NULL",
        list(template_ids),
    )
    return {row["template_id"]: row["version"] for row in rows}


async def stamp_origin(
    db_pool, user_id: str, slug: str, template_id: str, template_version: int
) -> dict | None:
    """Record an instance's template provenance on the owner's source row."""
    row = await db_pool.fetchrow(
        "UPDATE ingest.signal_sources"
        " SET origin_template_id = $3, origin_template_version = $4"
        " WHERE user_id = $1 AND slug = $2 RETURNING *",
        user_id,
        slug,
        template_id,
        template_version,
    )
    return dict(row) if row is not None else None
