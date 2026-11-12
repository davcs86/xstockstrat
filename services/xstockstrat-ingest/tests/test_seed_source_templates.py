"""Feature 335 — the seeded source templates are valid and instantiable.

The seed is raw SQL, so it bypasses ManageTemplate validation; these tests run each seeded payload
through the same validators and the real InstantiateTemplate handler.
"""

import json
import re
from datetime import UTC, datetime
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from gen.ingest.v1 import ingest_pb2
from google.protobuf.json_format import ParseDict

from app.handlers import servicer as servicer_mod
from app.repositories.signal_sources import validate_config_json
from tests._helpers import transaction_conn
from tests.conftest import _ctx
from tests.test_ingest_servicer import make_servicer
from tests.test_source_templates import _ST, _instantiate

_MIGRATIONS = Path(__file__).resolve().parent.parent / "migrations"
_SLUGS = ["sec_edgar_8k", "sec_edgar_form4", "prnewswire_releases", "robinhood_snacks"]
_TS = datetime(2026, 11, 12, tzinfo=UTC)


def _seed_file(suffix: str) -> str:
    matches = sorted(_MIGRATIONS.glob(f"*_seed_source_templates.{suffix}.sql"))
    assert len(matches) == 1, matches
    return matches[0].read_text()


def _rows() -> list[dict]:
    lits = re.findall(r"\$t\$(.*?)\$t\$", _seed_file("up"), re.DOTALL)
    assert lits and len(lits) % 4 == 0, len(lits)
    return [
        {
            "template_id": lits[i],
            "name": lits[i + 1],
            "description": lits[i + 2],
            # The pool has no JSONB codec: asyncpg returns JSONB as JSON text.
            "payload": json.dumps(json.loads(lits[i + 3])),
            "version": 1,
            "retired_at": None,
            "created_by": "system",
            "created_at": _TS,
            "updated_at": _TS,
        }
        for i in range(0, len(lits), 4)
    ]


def _payload(row: dict) -> dict:
    return json.loads(row["payload"])


def test_every_payload_is_a_valid_credential_free_source():
    for row in _rows():
        payload = _payload(row)
        assert set(payload) <= set(servicer_mod._TEMPLATE_PAYLOAD_FIELDS), row["template_id"]
        parsed = ParseDict(payload, ingest_pb2.SignalSource())
        assert validate_config_json(payload["source_type"], payload.get("config_json")) is None
        assert servicer_mod._weight_error(parsed) is None
        assert payload["extractor_module"], row["template_id"]
        assert servicer_mod._template_payload(parsed) == payload, row["template_id"]
        assert row["name"] == payload["display_name"], row["template_id"]


def test_ac19_ac22_the_seed_holds_exactly_the_four_system_templates():
    rows = _rows()
    assert sorted(r["template_id"] for r in rows) == sorted(f"tpl-{s}" for s in _SLUGS)
    assert all(servicer_mod._template_to_proto(r).meta.read_only for r in rows)
    text = _seed_file("up")
    assert text.count("::jsonb, 'system')") == 4
    assert "requires-env" not in text and "COMMIT" not in text and "credentials_ref" in text


@pytest.mark.asyncio
async def test_ac6_catalog_lists_the_four_seeded_sources():
    svc = make_servicer(db=MagicMock())
    with patch(f"{_ST}.list_active", AsyncMock(return_value=_rows())):
        listed = await svc.ListTemplates(
            ingest_pb2.ListTemplatesRequest(), _ctx("0", user_id="bob")
        )
    assert sorted(t.payload.slug for t in listed.templates) == sorted(_SLUGS)
    assert all(t.meta.read_only and t.meta.version == 1 for t in listed.templates)
    form4 = next(r for r in _rows() if r["template_id"] == "tpl-sec_edgar_form4")
    assert _payload(form4)["source_type"] == "mediated_simple_website"
    assert _payload(form4)["config_json"]["scrape_selector"] == "entry"


@pytest.mark.asyncio
async def test_ac7_prnewswire_template_instantiates_into_a_private_source():
    template = next(r for r in _rows() if r["template_id"] == "tpl-prnewswire_releases")
    req, patches, ins, _stamp = _instantiate(template=template, slug="bob_prnewswire")
    db, _conn = transaction_conn()
    svc = make_servicer(db=db)
    ctx = _ctx("0", user_id="bob")
    with patches[0], patches[1], patches[2], patches[3]:
        await svc.InstantiateTemplate(req, ctx)
    kwargs = ins.call_args.kwargs
    assert kwargs["user_id"] == "bob" and kwargs["slug"] == "bob_prnewswire"
    assert kwargs["active"] is True and kwargs["reliability_weight"] == 1.0
    assert kwargs["credentials_ref"] is None
    assert (
        kwargs["config_json"]["url"]
        == "https://www.prnewswire.com/news-releases/news-releases-list/"
    )


def test_the_fundamentals_source_insert_matches_the_producer_and_the_down_spares_it():
    up, down = _seed_file("up"), _seed_file("down")
    for literal in (
        "'system'",
        "'fundamentals'",
        "'Fundamentals Signal Producer'",
        "'derived'",
        "'app.extractors.noop'",
    ):
        assert literal in up, literal
    assert "pg_advisory_xact_lock(hashtext('fundamentals'))" in up
    assert "WHERE slug = 'fundamentals'" in up
    statements = "\n".join(line for line in down.splitlines() if not line.lstrip().startswith("--"))
    assert "signal_sources" not in statements and "source_templates" in statements
