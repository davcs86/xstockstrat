"""StrategyTemplatesRepository — persistence for ``analysis.strategy_templates`` (feature 224).

``payload`` is a whole ``StrategyDefinition`` as JSONB whose components' ``formula_id`` hold formula
TEMPLATE ids; callers work with a plain ``dict``. A retired template keeps its row (``retired_at``).
"""

import json


def _to_dict(row) -> dict | None:
    if row is None:
        return None
    d = dict(row)
    raw = d.get("payload")
    if isinstance(raw, str):
        d["payload"] = json.loads(raw) if raw else {}
    elif raw is None:
        d["payload"] = {}
    return d


class StrategyTemplatesRepository:
    def __init__(self, db_pool):
        self._db = db_pool

    async def list_active(self) -> list[dict]:
        rows = await self._db.fetch(
            "SELECT * FROM analysis.strategy_templates WHERE retired_at IS NULL ORDER BY name"
        )
        return [_to_dict(r) for r in rows]

    async def get(self, template_id: str) -> dict | None:
        row = await self._db.fetchrow(
            "SELECT * FROM analysis.strategy_templates WHERE template_id = $1", template_id
        )
        return _to_dict(row)

    async def create(self, meta, payload_json: dict, created_by: str) -> dict:
        row = await self._db.fetchrow(
            """
            INSERT INTO analysis.strategy_templates
                (template_id, name, description, payload, created_by)
            VALUES ($1, $2, $3, $4::jsonb, $5)
            RETURNING *
            """,
            meta.template_id,
            meta.name,
            meta.description,
            json.dumps(payload_json),
            created_by,
        )
        return _to_dict(row)

    async def update(self, template_id: str, payload_json: dict) -> dict | None:
        """Replace the payload and bump ``version`` in one UPDATE; None if missing or retired."""
        row = await self._db.fetchrow(
            """
            UPDATE analysis.strategy_templates
               SET payload = $2::jsonb, version = version + 1, updated_at = NOW()
             WHERE template_id = $1 AND retired_at IS NULL
            RETURNING *
            """,
            template_id,
            json.dumps(payload_json),
        )
        return _to_dict(row)

    async def retire(self, template_id: str) -> dict | None:
        row = await self._db.fetchrow(
            """
            UPDATE analysis.strategy_templates
               SET retired_at = COALESCE(retired_at, NOW()), updated_at = NOW()
             WHERE template_id = $1
            RETURNING *
            """,
            template_id,
        )
        return _to_dict(row)

    async def latest_versions(self, ids) -> dict[str, int]:
        """``{template_id: version}`` for the active ids among ``ids``; retired/missing omitted."""
        rows = await self._db.fetch(
            "SELECT template_id, version FROM analysis.strategy_templates "
            "WHERE template_id = ANY($1::text[]) AND retired_at IS NULL",
            list(ids),
        )
        return {r["template_id"]: int(r["version"]) for r in rows}
