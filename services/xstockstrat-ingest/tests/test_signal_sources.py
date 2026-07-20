"""Unit tests for app/repositories/signal_sources.py."""

from unittest.mock import AsyncMock, MagicMock

import pytest

from app.repositories.signal_sources import (
    deactivate_source,
    get_active_source,
    list_all_sources,
    upsert_source,
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
# upsert_source
# ---------------------------------------------------------------------------


class TestUpsertSource:
    @pytest.mark.asyncio
    async def test_calls_insert_on_conflict(self):
        db = MagicMock()
        db.fetchrow = AsyncMock(
            return_value={
                "slug": "uw",
                "display_name": "UW",
                "source_type": "simple_email",
                "extractor_module": "app.extractors.noop",
                "credentials_ref": None,
                "active": True,
                "config_json": None,
                "created_at": None,
            }
        )
        result = await upsert_source(
            db,
            slug="uw",
            display_name="UW",
            source_type="simple_email",
            extractor_module="app.extractors.noop",
            credentials_ref=None,
            config_json=None,
        )
        assert result["slug"] == "uw"
        sql_call = db.fetchrow.call_args[0][0]
        assert "ON CONFLICT" in sql_call
        assert "RETURNING" in sql_call


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
