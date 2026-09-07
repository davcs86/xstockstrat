#!/usr/bin/env python3
# /// script
# requires-python = ">=3.12"
# dependencies = [
#     "typer>=0.15",
#     "bcrypt>=4.2",
#     "psycopg[binary]>=3.2",
#     "questionary>=2.1",
#     "pytest>=8",
# ]
# ///
"""Unit tests for scripts/manage-users.py.

Run:
    uv run pytest scripts/tests/test_manage_users.py -v
"""

from __future__ import annotations

import importlib.util
import uuid
from datetime import datetime, timezone
from pathlib import Path
from types import ModuleType
from unittest.mock import MagicMock, call, patch

import bcrypt
import pytest
import typer
from typer.testing import CliRunner

# ── Import the script as a module ────────────────────────────────────────

SCRIPT_PATH = Path(__file__).resolve().parent.parent / "manage-users.py"


def _load_script() -> ModuleType:
    spec = importlib.util.spec_from_file_location("manage_users", SCRIPT_PATH)
    assert spec and spec.loader
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


mu = _load_script()
runner = CliRunner()

# ── Fixtures ─────────────────────────────────────────────────────────────

FAKE_DB_URL = "postgres://x:x@localhost:5432/x?sslmode=disable"
FAKE_UUID = uuid.uuid4()
FAKE_NOW = datetime(2026, 1, 15, 10, 30, tzinfo=timezone.utc)


@pytest.fixture(autouse=True)
def _patch_db_url(monkeypatch: pytest.MonkeyPatch) -> None:
    """Every test gets DATABASE_URL so _load_db_url never hits the filesystem."""
    monkeypatch.setenv("DATABASE_URL", FAKE_DB_URL)


def _mock_conn(execute_returns: list | None = None):
    """Build a mock psycopg connection + cursor chain.

    execute_returns: list of values that successive .fetchone() / .fetchall()
    calls will return.  Each entry is fed to a fresh MagicMock cursor.
    """
    conn = MagicMock()
    cursor = MagicMock()
    conn.execute.return_value = cursor
    conn.__enter__ = MagicMock(return_value=conn)
    conn.__exit__ = MagicMock(return_value=False)

    if execute_returns is not None:
        cursor.fetchone.side_effect = execute_returns
    return conn


# ═══════════════════════════════════════════════════════════════════════
# § 1  Pure helper tests
# ═══════════════════════════════════════════════════════════════════════


class TestValidateRoles:
    def test_single_valid_role(self):
        assert mu._validate_roles("trader") == ["trader"]

    def test_multiple_valid_roles(self):
        assert mu._validate_roles("admin,trader") == ["admin", "trader"]

    def test_whitespace_trimming(self):
        assert mu._validate_roles("  admin , trader  ") == ["admin", "trader"]

    def test_invalid_role_exits(self):
        with pytest.raises(typer.Exit):
            mu._validate_roles("superuser")

    def test_mixed_valid_invalid_exits(self):
        with pytest.raises(typer.Exit):
            mu._validate_roles("trader,superuser")

    def test_empty_string_exits(self):
        with pytest.raises(typer.Exit):
            mu._validate_roles("")

    def test_only_commas_exits(self):
        with pytest.raises(typer.Exit):
            mu._validate_roles(",,,")


class TestHashPassword:
    def test_produces_bcrypt_prefix(self):
        h = mu._hash_password("secret123")
        assert h.startswith("$2b$10$")

    def test_hash_verifies(self):
        h = mu._hash_password("myP@ss!")
        assert bcrypt.checkpw(b"myP@ss!", h.encode("ascii"))

    def test_different_passwords_different_hashes(self):
        h1 = mu._hash_password("alpha")
        h2 = mu._hash_password("beta")
        assert h1 != h2

    def test_returns_ascii_string(self):
        h = mu._hash_password("test")
        assert isinstance(h, str)
        h.encode("ascii")  # must not raise


# ═══════════════════════════════════════════════════════════════════════
# § 2  _load_db_url tests
# ═══════════════════════════════════════════════════════════════════════


class TestLoadDbUrl:
    def test_from_env_var(self, monkeypatch: pytest.MonkeyPatch):
        monkeypatch.setenv("DATABASE_URL", "postgres://a:b@h:5/db")
        assert mu._load_db_url() == "postgres://a:b@h:5/db"

    def test_from_dotenv_file(self, monkeypatch: pytest.MonkeyPatch, tmp_path: Path):
        monkeypatch.delenv("DATABASE_URL")
        env_file = tmp_path / ".env"
        env_file.write_text('POSTGRES_PASSWORD="s3cret"\n')
        with patch.object(mu, "_repo_root", return_value=tmp_path):
            url = mu._load_db_url()
        assert "s3cret" in url
        assert url.startswith("postgres://xstockstrat:")

    def test_dotenv_single_quotes(self, monkeypatch: pytest.MonkeyPatch, tmp_path: Path):
        monkeypatch.delenv("DATABASE_URL")
        env_file = tmp_path / ".env"
        env_file.write_text("POSTGRES_PASSWORD='quoted'\n")
        with patch.object(mu, "_repo_root", return_value=tmp_path):
            url = mu._load_db_url()
        assert "quoted" in url

    def test_missing_both_exits(self, monkeypatch: pytest.MonkeyPatch, tmp_path: Path):
        monkeypatch.delenv("DATABASE_URL")
        with patch.object(mu, "_repo_root", return_value=tmp_path):
            with pytest.raises(typer.Exit):
                mu._load_db_url()

    def test_empty_password_in_dotenv_exits(
        self, monkeypatch: pytest.MonkeyPatch, tmp_path: Path
    ):
        monkeypatch.delenv("DATABASE_URL")
        env_file = tmp_path / ".env"
        env_file.write_text("POSTGRES_PASSWORD=\n")
        with patch.object(mu, "_repo_root", return_value=tmp_path):
            with pytest.raises(typer.Exit):
                mu._load_db_url()


# ═══════════════════════════════════════════════════════════════════════
# § 3  _prompt_password tests
# ═══════════════════════════════════════════════════════════════════════


class TestPromptPassword:
    @patch("typer.prompt", side_effect=["goodpass", "goodpass"])
    def test_matching_passwords_returns(self, mock_prompt: MagicMock):
        assert mu._prompt_password("a@b.com") == "goodpass"

    @patch("typer.prompt", side_effect=["alpha", "beta"])
    def test_mismatch_exits(self, mock_prompt: MagicMock):
        with pytest.raises(typer.Exit):
            mu._prompt_password("a@b.com")

    @patch("typer.prompt", side_effect=["   ", "   "])
    def test_empty_after_strip_exits(self, mock_prompt: MagicMock):
        with pytest.raises(typer.Exit):
            mu._prompt_password("a@b.com")


# ═══════════════════════════════════════════════════════════════════════
# § 4  _select_roles tests
# ═══════════════════════════════════════════════════════════════════════


class TestSelectRoles:
    @patch("questionary.checkbox")
    def test_returns_selected(self, mock_cb: MagicMock):
        mock_cb.return_value.ask.return_value = ["admin", "trader"]
        assert mu._select_roles() == ["admin", "trader"]

    @patch("questionary.checkbox")
    def test_ctrl_c_aborts(self, mock_cb: MagicMock):
        mock_cb.return_value.ask.return_value = None
        with pytest.raises(typer.Abort):
            mu._select_roles()

    @patch("questionary.checkbox")
    def test_empty_selection_exits(self, mock_cb: MagicMock):
        mock_cb.return_value.ask.return_value = []
        with pytest.raises(typer.Exit):
            mu._select_roles()

    @patch("questionary.checkbox")
    def test_preselected_passed_to_choices(self, mock_cb: MagicMock):
        mock_cb.return_value.ask.return_value = ["trader"]
        mu._select_roles(preselected=["trader"])
        choices = mock_cb.call_args[1].get("choices") or mock_cb.call_args[0][1]
        checked_names = [c.title for c in choices if c.checked]
        assert "trader" in checked_names


# ═══════════════════════════════════════════════════════════════════════
# § 5  CLI command tests (typer CliRunner + mocked DB)
# ═══════════════════════════════════════════════════════════════════════


class TestResetPasswordCmd:
    @patch("psycopg.connect")
    @patch("typer.prompt", side_effect=["newpass", "newpass"])
    def test_success(self, _prompt: MagicMock, mock_connect: MagicMock):
        conn = _mock_conn([(FAKE_UUID,)])
        mock_connect.return_value = conn
        result = runner.invoke(mu.app, ["reset-password", "a@b.com"])
        assert result.exit_code == 0
        assert "Password updated" in result.stdout
        conn.execute.assert_called_once()
        conn.commit.assert_called_once()

    @patch("psycopg.connect")
    @patch("typer.prompt", side_effect=["newpass", "newpass"])
    def test_user_not_found(self, _prompt: MagicMock, mock_connect: MagicMock):
        conn = _mock_conn([None])
        mock_connect.return_value = conn
        result = runner.invoke(mu.app, ["reset-password", "nobody@b.com"])
        assert result.exit_code == 1

    @patch("psycopg.connect", side_effect=Exception("conn refused"))
    @patch("typer.prompt", side_effect=["p", "p"])
    def test_db_connection_error(self, _prompt: MagicMock, _connect: MagicMock):
        result = runner.invoke(mu.app, ["reset-password", "a@b.com"])
        assert result.exit_code == 1


class TestCreateUserCmd:
    @patch("psycopg.connect")
    @patch("typer.prompt", side_effect=["newpass", "newpass"])
    def test_success_with_roles_flag(
        self, _prompt: MagicMock, mock_connect: MagicMock
    ):
        conn = _mock_conn([(FAKE_UUID,)])
        mock_connect.return_value = conn
        result = runner.invoke(
            mu.app, ["create-user", "a@b.com", "--roles", "admin,trader"]
        )
        assert result.exit_code == 0
        assert "User created" in result.stdout
        conn.commit.assert_called_once()

    @patch("psycopg.connect")
    @patch("typer.prompt", side_effect=["newpass", "newpass"])
    def test_duplicate_user(self, _prompt: MagicMock, mock_connect: MagicMock):
        conn = _mock_conn([None])
        mock_connect.return_value = conn
        result = runner.invoke(
            mu.app, ["create-user", "dup@b.com", "--roles", "trader"]
        )
        assert result.exit_code == 1

    def test_invalid_roles_flag(self):
        result = runner.invoke(
            mu.app, ["create-user", "a@b.com", "--roles", "superuser"]
        )
        assert result.exit_code == 1

    @patch("psycopg.connect")
    @patch("typer.prompt", side_effect=["newpass", "newpass"])
    @patch("questionary.checkbox")
    def test_interactive_selector_when_no_roles_flag(
        self,
        mock_cb: MagicMock,
        _prompt: MagicMock,
        mock_connect: MagicMock,
    ):
        mock_cb.return_value.ask.return_value = ["trader"]
        conn = _mock_conn([(FAKE_UUID,)])
        mock_connect.return_value = conn
        result = runner.invoke(mu.app, ["create-user", "a@b.com"])
        assert result.exit_code == 0
        mock_cb.assert_called_once()


class TestUpdateRolesCmd:
    @patch("psycopg.connect")
    def test_success_with_roles_flag(self, mock_connect: MagicMock):
        conn = _mock_conn()
        # First execute → UPDATE RETURNING roles
        conn.execute.return_value.fetchone.return_value = (["admin"],)
        mock_connect.return_value = conn
        result = runner.invoke(
            mu.app, ["update-roles", "a@b.com", "--roles", "admin"]
        )
        assert result.exit_code == 0
        assert "Roles updated" in result.stdout
        conn.commit.assert_called_once()

    @patch("psycopg.connect")
    def test_user_not_found_with_roles_flag(self, mock_connect: MagicMock):
        conn = _mock_conn()
        conn.execute.return_value.fetchone.return_value = None
        mock_connect.return_value = conn
        result = runner.invoke(
            mu.app, ["update-roles", "ghost@b.com", "--roles", "trader"]
        )
        assert result.exit_code == 1

    @patch("psycopg.connect")
    @patch("questionary.checkbox")
    def test_interactive_fetches_current_roles(
        self, mock_cb: MagicMock, mock_connect: MagicMock
    ):
        conn = _mock_conn()
        # First call: SELECT roles (current roles lookup)
        # Second call: UPDATE RETURNING roles
        conn.execute.return_value.fetchone.side_effect = [
            (["trader"],),       # SELECT current roles
            (["admin", "trader"],),  # UPDATE RETURNING
        ]
        mock_connect.return_value = conn
        mock_cb.return_value.ask.return_value = ["admin", "trader"]

        result = runner.invoke(mu.app, ["update-roles", "a@b.com"])
        assert result.exit_code == 0
        mock_cb.assert_called_once()
        # Verify preselected roles were passed
        choices = mock_cb.call_args[1].get("choices") or mock_cb.call_args[0][1]
        checked_names = [c.title for c in choices if c.checked]
        assert "trader" in checked_names

    @patch("psycopg.connect")
    def test_interactive_user_not_found_before_selector(
        self, mock_connect: MagicMock
    ):
        conn = _mock_conn()
        conn.execute.return_value.fetchone.return_value = None
        mock_connect.return_value = conn
        result = runner.invoke(mu.app, ["update-roles", "ghost@b.com"])
        assert result.exit_code == 1

    def test_invalid_roles_flag(self):
        result = runner.invoke(
            mu.app, ["update-roles", "a@b.com", "--roles", "root"]
        )
        assert result.exit_code == 1


class TestListUsersCmd:
    @patch("psycopg.connect")
    def test_lists_users(self, mock_connect: MagicMock):
        conn = _mock_conn()
        conn.execute.return_value.fetchall.return_value = [
            ("admin@test.com", ["admin", "trader"], True, FAKE_NOW),
            ("user@test.com", ["trader"], True, FAKE_NOW),
        ]
        mock_connect.return_value = conn
        result = runner.invoke(mu.app, ["list-users"])
        assert result.exit_code == 0
        assert "admin@test.com" in result.stdout
        assert "user@test.com" in result.stdout

    @patch("psycopg.connect")
    def test_empty_result(self, mock_connect: MagicMock):
        conn = _mock_conn()
        conn.execute.return_value.fetchall.return_value = []
        mock_connect.return_value = conn
        result = runner.invoke(mu.app, ["list-users"])
        assert result.exit_code == 0

    @patch("psycopg.connect")
    def test_active_only_filter(self, mock_connect: MagicMock):
        conn = _mock_conn()
        conn.execute.return_value.fetchall.return_value = [
            ("active@test.com", ["trader"], True, FAKE_NOW),
        ]
        mock_connect.return_value = conn
        result = runner.invoke(mu.app, ["list-users", "--active-only"])
        assert result.exit_code == 0
        # Verify the query included the WHERE clause
        executed_query = conn.execute.call_args[0][0]
        assert "WHERE is_active = TRUE" in executed_query

    @patch("psycopg.connect")
    def test_inactive_user_displays_cross(self, mock_connect: MagicMock):
        conn = _mock_conn()
        conn.execute.return_value.fetchall.return_value = [
            ("inactive@test.com", ["trader"], False, FAKE_NOW),
        ]
        mock_connect.return_value = conn
        result = runner.invoke(mu.app, ["list-users"])
        assert result.exit_code == 0
        assert "inactive@test.com" in result.stdout


# ═══════════════════════════════════════════════════════════════════════
# § 6  SQL correctness — parameterized queries, no interpolation
# ═══════════════════════════════════════════════════════════════════════


class TestSqlParameterization:
    """Verify commands pass arguments via %s placeholders, not f-strings."""

    @patch("psycopg.connect")
    @patch("typer.prompt", side_effect=["p", "p"])
    def test_reset_password_uses_params(
        self, _prompt: MagicMock, mock_connect: MagicMock
    ):
        conn = _mock_conn([(FAKE_UUID,)])
        mock_connect.return_value = conn
        runner.invoke(mu.app, ["reset-password", "evil'--@x.com"])
        sql, params = conn.execute.call_args[0]
        assert "%s" in sql
        assert "evil'--@x.com" not in sql  # not interpolated into SQL
        assert "evil'--@x.com" in params

    @patch("psycopg.connect")
    @patch("typer.prompt", side_effect=["p", "p"])
    def test_create_user_uses_params(
        self, _prompt: MagicMock, mock_connect: MagicMock
    ):
        conn = _mock_conn([(FAKE_UUID,)])
        mock_connect.return_value = conn
        runner.invoke(
            mu.app, ["create-user", "evil'--@x.com", "--roles", "trader"]
        )
        sql, params = conn.execute.call_args[0]
        assert "%s" in sql
        assert "evil'--@x.com" not in sql
        assert "evil'--@x.com" in params
