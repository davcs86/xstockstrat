"""FormulaTemplatesRepository — asyncpg-backed persistence for indicators.formula_templates."""

import json


def _to_dict(row) -> dict | None:
    if row is None:
        return None
    d = dict(row)
    if isinstance(d.get("payload"), str):
        d["payload"] = json.loads(d["payload"])
    return d


class FormulaTemplatesRepository:
    """The admin-curated formula template catalog (feature 224)."""

    def __init__(self, db_pool):
        self._db = db_pool

    async def list_active(self) -> list[dict]:
        rows = await self._db.fetch(
            "SELECT * FROM indicators.formula_templates WHERE retired_at IS NULL "
            "ORDER BY template_id"
        )
        return [_to_dict(r) for r in rows]

    async def get(self, template_id) -> dict | None:
        row = await self._db.fetchrow(
            "SELECT * FROM indicators.formula_templates WHERE template_id = $1", template_id
        )
        return _to_dict(row)

    async def create(self, meta, payload_json, created_by) -> dict:
        row = await self._db.fetchrow(
            """
            INSERT INTO indicators.formula_templates
                (template_id, name, description, payload, created_by)
            VALUES ($1, $2, $3, $4::jsonb, $5)
            RETURNING *
            """,
            meta.template_id,
            meta.name,
            meta.description or "",
            json.dumps(payload_json),
            created_by,
        )
        return _to_dict(row)

    async def update(self, template_id, payload_json) -> dict | None:
        """None when the template is missing or retired."""
        row = await self._db.fetchrow(
            """
            UPDATE indicators.formula_templates
               SET payload = $2::jsonb, version = version + 1, updated_at = NOW()
             WHERE template_id = $1 AND retired_at IS NULL
            RETURNING *
            """,
            template_id,
            json.dumps(payload_json),
        )
        return _to_dict(row)

    async def retire(self, template_id) -> dict | None:
        row = await self._db.fetchrow(
            """
            UPDATE indicators.formula_templates
               SET retired_at = COALESCE(retired_at, NOW())
             WHERE template_id = $1
            RETURNING *
            """,
            template_id,
        )
        return _to_dict(row)

    async def latest_versions(self, ids) -> dict[str, int]:
        """template_id -> current version for the non-retired templates among ``ids``."""
        rows = await self._db.fetch(
            "SELECT template_id, version FROM indicators.formula_templates "
            "WHERE template_id = ANY($1::text[]) AND retired_at IS NULL",
            list(ids),
        )
        return {r["template_id"]: r["version"] for r in rows}
