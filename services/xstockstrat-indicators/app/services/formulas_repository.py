"""
FormulasRepository — asyncpg-backed persistence for indicators.formulas.

Mirrors the DB-query style of services/xstockstrat-ingest/app/handlers/servicer.py
(fetchrow / fetch / fetchval / execute). The servicer keeps an in-memory cache and
delegates durable storage to this repository when a DB pool is available.

JSONB `input_schema` is encoded/decoded as JSON here so callers always work with a
plain ``dict``. `formula_id` is a string UUID (the servicer generates it via
``uuid.uuid4()``), so all queries cast it with ``$1::uuid``.
"""

import json


def _to_dict(row) -> dict:
    """Convert an asyncpg Record to a plain dict, decoding the JSONB input_schema."""
    if row is None:
        return None
    d = dict(row)
    raw = d.get("input_schema")
    if isinstance(raw, str):
        d["input_schema"] = json.loads(raw) if raw else {}
    elif raw is None:
        d["input_schema"] = {}
    params_raw = d.get("parameters")
    if isinstance(params_raw, str):
        d["parameters"] = json.loads(params_raw) if params_raw else []
    elif params_raw is None:
        d["parameters"] = []
    outputs_raw = d.get("outputs")
    if isinstance(outputs_raw, str):
        d["outputs"] = json.loads(outputs_raw) if outputs_raw else []
    elif outputs_raw is None:
        d["outputs"] = []
    return d


class FormulasRepository:
    """CRUD persistence for the ``indicators.formulas`` table."""

    def __init__(self, db_pool):
        self._db = db_pool

    async def create(
        self,
        formula_id,
        name,
        description,
        source,
        author,
        is_public,
        input_schema,
        parameters=None,
        outputs=None,
    ) -> dict:
        row = await self._db.fetchrow(
            """
            INSERT INTO indicators.formulas
                (formula_id, name, description, source, author, is_public, input_schema,
                 parameters, outputs)
            VALUES ($1::uuid, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb, $9::jsonb)
            RETURNING *
            """,
            formula_id,
            name,
            description or "",
            source,
            author,
            is_public,
            json.dumps(dict(input_schema) if input_schema else {}),
            json.dumps(list(parameters) if parameters else []),
            json.dumps(list(outputs) if outputs else []),
        )
        return _to_dict(row)

    async def upsert(
        self,
        formula_id,
        name,
        description,
        source,
        author,
        is_public,
        input_schema,
        parameters=None,
        outputs=None,
    ) -> dict:
        """Idempotent insert-or-update keyed on the formula_id PK.

        Used by the startup seeding hook (feature 063): re-seeding the same well-known
        id on every restart is safe, and a band/param/source change takes effect on the
        next deploy. Mirrors ``create``'s JSONB encoding.
        """
        row = await self._db.fetchrow(
            """
            INSERT INTO indicators.formulas
                (formula_id, name, description, source, author, is_public, input_schema,
                 parameters, outputs)
            VALUES ($1::uuid, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb, $9::jsonb)
            ON CONFLICT (formula_id) DO UPDATE SET
                name = EXCLUDED.name,
                description = EXCLUDED.description,
                source = EXCLUDED.source,
                author = EXCLUDED.author,
                is_public = EXCLUDED.is_public,
                input_schema = EXCLUDED.input_schema,
                parameters = EXCLUDED.parameters,
                outputs = EXCLUDED.outputs,
                updated_at = NOW()
            RETURNING *
            """,
            formula_id,
            name,
            description or "",
            source,
            author,
            is_public,
            json.dumps(dict(input_schema) if input_schema else {}),
            json.dumps(list(parameters) if parameters else []),
            json.dumps(list(outputs) if outputs else []),
        )
        return _to_dict(row)

    async def get_by_id(self, formula_id) -> dict | None:
        row = await self._db.fetchrow(
            "SELECT * FROM indicators.formulas WHERE formula_id = $1::uuid",
            formula_id,
        )
        return _to_dict(row)

    async def list(
        self,
        author_filter: str,
        include_public: bool,
        page_size: int,
        page_offset: int,
    ) -> tuple[list[dict], int]:
        # An empty author_filter never matches the author column, so when no filter
        # is supplied only the include_public branch returns rows.
        where = "WHERE (author = $1 OR ($2 AND is_public = TRUE))"
        total = await self._db.fetchval(
            f"SELECT COUNT(*) FROM indicators.formulas {where}",
            author_filter,
            include_public,
        )
        sql = f"""
            SELECT * FROM indicators.formulas {where}
            ORDER BY created_at DESC
        """
        params = [author_filter, include_public]
        if page_size and page_size > 0:
            sql += " LIMIT $3 OFFSET $4"
            params.extend([page_size, page_offset or 0])
        rows = await self._db.fetch(sql, *params)
        return [_to_dict(r) for r in rows], int(total or 0)

    async def update(
        self,
        formula_id,
        name,
        description,
        source,
        is_public,
        parameters=None,
        outputs=None,
    ) -> dict | None:
        row = await self._db.fetchrow(
            """
            UPDATE indicators.formulas
               SET name = $2, description = $3, source = $4, is_public = $5,
                   parameters = $6::jsonb, outputs = $7::jsonb, updated_at = NOW()
             WHERE formula_id = $1::uuid
            RETURNING *
            """,
            formula_id,
            name,
            description or "",
            source,
            is_public,
            json.dumps(list(parameters) if parameters else []),
            json.dumps(list(outputs) if outputs else []),
        )
        return _to_dict(row)

    async def delete(self, formula_id) -> bool:
        result = await self._db.execute(
            "DELETE FROM indicators.formulas WHERE formula_id = $1::uuid",
            formula_id,
        )
        return result == "DELETE 1"
