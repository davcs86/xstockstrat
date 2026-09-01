"""Unit tests for app/repositories/signal_sources.py."""

import json
from unittest.mock import AsyncMock, MagicMock

import pytest

from app.repositories.signal_sources import (
    deactivate_source,
    get_active_source,
    get_source,
    insert_source,
    list_all_sources,
    reactivate_source,
    update_source,
    validate_config_json,
)

# ---------------------------------------------------------------------------
# validate_config_json — sync helper, no DB needed
# ---------------------------------------------------------------------------


class TestValidateConfigJson:
    # ── email types ──────────────────────────────────────────────────────────

    def test_simple_email_valid(self):
        cfg = {"sender_patterns": ["@example.com"], "subject_patterns": ["Alert"]}
        assert validate_config_json("simple_email", cfg) is None

    def test_simple_email_missing_sender(self):
        err = validate_config_json("simple_email", {"subject_patterns": ["Alert"]})
        assert err is not None
        assert "sender_patterns" in err

    def test_simple_email_missing_subject(self):
        err = validate_config_json("simple_email", {"sender_patterns": ["@x.com"]})
        assert err is not None
        assert "subject_patterns" in err

    def test_simple_email_empty_config(self):
        assert validate_config_json("simple_email", {}) is not None

    def test_simple_email_none_config(self):
        assert validate_config_json("simple_email", None) is not None

    # ── attachment types ─────────────────────────────────────────────────────

    def test_email_attachment_valid(self):
        cfg = {
            "sender_patterns": ["@x.com"],
            "subject_patterns": ["Report"],
            "attachment_mime_types": ["application/pdf"],
        }
        assert validate_config_json("email_attachment", cfg) is None

    def test_email_attachment_missing_mime(self):
        cfg = {"sender_patterns": ["@x.com"], "subject_patterns": ["Report"]}
        err = validate_config_json("email_attachment", cfg)
        assert err is not None
        assert "attachment_mime_types" in err

    def test_mediated_email_attachment_valid(self):
        cfg = {
            "sender_patterns": ["@x.com"],
            "subject_patterns": ["Report"],
            "attachment_mime_types": ["text/csv"],
        }
        assert validate_config_json("mediated_email_attachment", cfg) is None

    def test_mediated_email_attachment_missing_mime(self):
        cfg = {"sender_patterns": ["@x.com"], "subject_patterns": ["Report"]}
        err = validate_config_json("mediated_email_attachment", cfg)
        assert err is not None

    # ── linked email ─────────────────────────────────────────────────────────

    def test_linked_email_valid(self):
        cfg = {
            "sender_patterns": ["@x.com"],
            "subject_patterns": ["Link"],
            "url_patterns": ["https://example.com"],
        }
        assert validate_config_json("linked_email", cfg) is None

    def test_linked_email_missing_urls(self):
        cfg = {"sender_patterns": ["@x.com"], "subject_patterns": ["Link"]}
        err = validate_config_json("linked_email", cfg)
        assert err is not None
        assert "url_patterns" in err

    def test_mediated_linked_email_valid(self):
        cfg = {
            "sender_patterns": ["@x.com"],
            "subject_patterns": ["Link"],
            "url_patterns": ["https://example.com"],
        }
        assert validate_config_json("mediated_linked_email", cfg) is None

    # ── website types ────────────────────────────────────────────────────────

    def test_simple_website_valid(self):
        cfg = {"url": "https://example.com", "scrape_selector": "div.content"}
        assert validate_config_json("simple_website", cfg) is None

    def test_simple_website_missing_url(self):
        err = validate_config_json("simple_website", {"scrape_selector": "div"})
        assert err is not None
        assert "url" in err

    def test_simple_website_missing_selector(self):
        err = validate_config_json("simple_website", {"url": "https://example.com"})
        assert err is not None
        assert "scrape_selector" in err

    def test_authenticated_website_valid(self):
        cfg = {"url": "https://example.com", "scrape_selector": "table"}
        assert validate_config_json("authenticated_website", cfg) is None

    def test_mediated_simple_website_valid(self):
        cfg = {"url": "https://example.com", "scrape_selector": "p"}
        assert validate_config_json("mediated_simple_website", cfg) is None

    def test_mediated_authenticated_website_missing_url(self):
        err = validate_config_json("mediated_authenticated_website", {"scrape_selector": "p"})
        assert err is not None

    # ── mediated simple email ────────────────────────────────────────────────

    def test_mediated_simple_email_valid(self):
        cfg = {"sender_patterns": ["@x.com"], "subject_patterns": ["Alert"]}
        assert validate_config_json("mediated_simple_email", cfg) is None

    def test_mediated_simple_email_missing_sender(self):
        assert (
            validate_config_json("mediated_simple_email", {"subject_patterns": ["Alert"]})
            is not None
        )

    # ── derived + fail-closed (feature 062) ──────────────────────────────────

    def test_derived_requires_no_config(self):
        # Internally-produced signals (e.g. the fundamentals producer) need no config.
        assert validate_config_json("derived", None) is None
        assert validate_config_json("derived", {}) is None

    def test_unknown_source_type_is_rejected(self):
        # Fail-closed: an unrecognized source_type must be rejected, not fail-open.
        err = validate_config_json("bogus_type", {})
        assert err is not None
        assert "unsupported source_type" in err


class TestMcpClientValidation:
    """feature 166 — mcp_client is fail-closed: it requires mcp_endpoint + mcp_tool, and the
    register path treats it as credential-required (bearer is mandatory)."""

    def test_mcp_client_valid(self):
        cfg = {"mcp_endpoint": "https://mcp.acme.example/mcp", "mcp_tool": "get_signals"}
        assert validate_config_json("mcp_client", cfg) is None

    def test_mcp_client_missing_endpoint_names_the_field(self):
        # AC-6: the error names the missing field.
        err = validate_config_json("mcp_client", {"mcp_tool": "get_signals"})
        assert err is not None
        assert "mcp_endpoint" in err

    def test_mcp_client_missing_tool_names_the_field(self):
        err = validate_config_json("mcp_client", {"mcp_endpoint": "https://x"})
        assert err is not None
        assert "mcp_tool" in err

    def test_mcp_client_is_credential_required(self):
        from app.handlers.servicer import _SS_CREDENTIAL_REQUIRED_TYPES

        assert "mcp_client" in _SS_CREDENTIAL_REQUIRED_TYPES


# ---------------------------------------------------------------------------
# get_active_source
# ---------------------------------------------------------------------------


class TestGetActiveSource:
    @pytest.mark.asyncio
    async def test_returns_dict_when_row_found(self):
        db = MagicMock()
        db.fetchrow = AsyncMock(
            return_value={
                "slug": "uw",
                "display_name": "Unusual Whales",
                "active": True,
                "source_type": "simple_email",
                "extractor_module": "app.extractors.example_simple_email",
                "credentials_ref": None,
                "config_json": None,
            }
        )
        result = await get_active_source(db, "uw")
        assert result["slug"] == "uw"
        db.fetchrow.assert_awaited_once()

    @pytest.mark.asyncio
    async def test_returns_none_when_not_found(self):
        db = MagicMock()
        db.fetchrow = AsyncMock(return_value=None)
        result = await get_active_source(db, "missing")
        assert result is None


# ---------------------------------------------------------------------------
# list_all_sources
# ---------------------------------------------------------------------------


class TestListAllSources:
    @pytest.mark.asyncio
    async def test_active_only_by_default(self):
        db = MagicMock()
        db.fetch = AsyncMock(
            return_value=[
                {
                    "slug": "uw",
                    "active": True,
                    "display_name": "UW",
                    "source_type": "simple_email",
                    "extractor_module": "app.extractors.noop",
                    "credentials_ref": None,
                    "config_json": None,
                    "created_at": None,
                }
            ]
        )
        result = await list_all_sources(db)
        assert len(result) == 1
        sql_call = db.fetch.call_args[0][0]
        assert "active = TRUE" in sql_call

    @pytest.mark.asyncio
    async def test_include_inactive_omits_filter(self):
        db = MagicMock()
        db.fetch = AsyncMock(return_value=[])
        await list_all_sources(db, include_inactive=True)
        sql_call = db.fetch.call_args[0][0]
        assert "active = TRUE" not in sql_call


# ---------------------------------------------------------------------------
# insert_source / update_source / get_source / reactivate_source (feature 088)
# ---------------------------------------------------------------------------


def _row(**over):
    base = {
        "slug": "uw",
        "display_name": "UW",
        "source_type": "simple_email",
        "extractor_module": "app.extractors.noop",
        "credentials_ref": None,
        "active": True,
        "config_json": None,
        "created_at": None,
    }
    base.update(over)
    return base


class TestInsertUpdateSource:
    @pytest.mark.asyncio
    async def test_insert_is_a_plain_insert_no_conflict(self):
        # Feature 088: register is a strict INSERT (no ON CONFLICT); a duplicate slug raises
        # UniqueViolationError, which the servicer maps to ALREADY_EXISTS.
        db = MagicMock()
        db.fetchrow = AsyncMock(return_value=_row())
        result = await insert_source(
            db,
            slug="uw",
            display_name="UW",
            source_type="simple_email",
            extractor_module="app.extractors.noop",
            credentials_ref=None,
            config_json=None,
            reliability_weight=1.0,  # feature 134 — kwarg now required
        )
        assert result["slug"] == "uw"
        sql = db.fetchrow.call_args[0][0]
        assert "INSERT INTO" in sql and "RETURNING" in sql
        assert "ON CONFLICT" not in sql
        # feature 134: reliability_weight is the trailing positional arg (after active), so the
        # config_json index (6) that the next test asserts stays valid.
        assert db.fetchrow.call_args[0][-1] == 1.0
        assert "reliability_weight" in sql

    @pytest.mark.asyncio
    async def test_insert_config_json_passed_as_json_text(self):
        db = MagicMock()
        db.fetchrow = AsyncMock(return_value=_row(source_type="mediated_simple_website"))
        await insert_source(
            db,
            slug="edgar",
            display_name="EDGAR",
            source_type="mediated_simple_website",
            extractor_module="",
            credentials_ref=None,
            config_json={"url": "https://example.com", "scrape_selector": "entry"},
            reliability_weight=1.0,  # feature 134 — appended after active; index 6 stays config
        )
        config_arg = db.fetchrow.call_args[0][6]
        assert isinstance(config_arg, str)
        assert json.loads(config_arg) == {"url": "https://example.com", "scrape_selector": "entry"}

    @pytest.mark.asyncio
    async def test_update_writes_merged_columns_and_never_active(self):
        db = MagicMock()
        db.fetchrow = AsyncMock(return_value=_row(display_name="New"))
        await update_source(
            db,
            slug="uw",
            display_name="New",
            source_type="simple_email",
            extractor_module="app.extractors.noop",
            credentials_ref="secret.x",
            config_json=None,
            reliability_weight=0.5,  # feature 134 — kwarg now required
        )
        sql = db.fetchrow.call_args[0][0]
        assert sql.strip().startswith("UPDATE ingest.signal_sources")
        assert "active" not in sql  # lifecycle stays reactivate/deactivate only
        assert "reliability_weight" in sql  # feature 134 — written in the SET clause
        assert db.fetchrow.call_args[0][-1] == 0.5

    @pytest.mark.asyncio
    async def test_get_source_returns_none_when_missing(self):
        db = MagicMock()
        db.fetchrow = AsyncMock(return_value=None)
        assert await get_source(db, "nope") is None

    @pytest.mark.asyncio
    async def test_reactivate_sets_active_true(self):
        db = MagicMock()
        db.fetchrow = AsyncMock(return_value=_row(active=True))
        row = await reactivate_source(db, "uw")
        assert row["active"] is True
        assert "active = TRUE" in db.fetchrow.call_args[0][0]

    @pytest.mark.asyncio
    async def test_reactivate_returns_none_when_missing(self):
        db = MagicMock()
        db.fetchrow = AsyncMock(return_value=None)
        assert await reactivate_source(db, "nope") is None


# ---------------------------------------------------------------------------
# deactivate_source
# ---------------------------------------------------------------------------


class TestDeactivateSource:
    @pytest.mark.asyncio
    async def test_returns_none_when_slug_not_found(self):
        db = MagicMock()
        db.fetchrow = AsyncMock(return_value=None)
        result = await deactivate_source(db, "nonexistent")
        assert result is None

    @pytest.mark.asyncio
    async def test_returns_row_when_deactivated(self):
        db = MagicMock()
        db.fetchrow = AsyncMock(
            return_value={
                "slug": "uw",
                "active": False,
                "display_name": "UW",
                "source_type": "simple_email",
                "extractor_module": "app.extractors.noop",
                "credentials_ref": None,
                "config_json": None,
                "created_at": None,
            }
        )
        result = await deactivate_source(db, "uw")
        assert result["active"] is False
