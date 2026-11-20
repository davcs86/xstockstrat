"""Unit tests for the pure parts of scripts/sops_secrets.py; sops-secrets.test.sh covers the sops/age paths."""

import pytest

import sops_secrets as ss


@pytest.fixture(autouse=True)
def _no_secret_file(monkeypatch, tmp_path):
    for name in ss.legacy_names(ss.DO) + ss.legacy_names(ss.HOMELAB):
        monkeypatch.delenv(name, raising=False)
    monkeypatch.delenv("GITHUB_STEP_SUMMARY", raising=False)
    monkeypatch.setattr(
        ss, "default_file", lambda env: str(tmp_path / "absent.enc.yaml")
    )


def set_required(monkeypatch, target):
    for name, required, _ in ss.keys_for(target):
        if required:
            monkeypatch.setenv(ss.legacy_name(name), f"value-of-{name}")


def test_keys_for_scopes_names_to_the_target():
    do = {n for n, _, _ in ss.keys_for(ss.DO)}
    homelab = {n for n, _, _ in ss.keys_for(ss.HOMELAB)}
    assert "PROJECT_ID" in do and "PROJECT_ID" not in homelab
    assert "TS_AUTHKEY" in homelab and "TS_AUTHKEY" not in do
    assert "JWT_SECRET" in do & homelab


def test_keys_for_rejects_a_duplicate_row(monkeypatch):
    monkeypatch.setattr(ss, "KEYS", ss.KEYS + (ss.KEYS[0],))
    with pytest.raises(ss.SecretError, match="twice"):
        ss.keys_for(ss.DO)


def test_keys_for_rejects_a_non_common_row_with_a_foreign_target(monkeypatch):
    monkeypatch.setattr(ss, "KEYS", (("homelab", "X", True, (ss.DO,)),))
    with pytest.raises(ss.SecretError, match="own namespace"):
        ss.keys_for(ss.DO)


def test_legacy_names_are_sorted_and_prefixed():
    names = ss.legacy_names(ss.DO)
    assert names == sorted(names)
    assert all(n.startswith("LEGACY_") for n in names)


def test_mask_skips_short_values(capsys):
    ss.mask("abc")
    assert capsys.readouterr().out == ""


def test_mask_escapes_workflow_command_data(capsys):
    ss.mask("50%off")
    assert set(capsys.readouterr().out.splitlines()) == {"::add-mask::50%25off"}


def test_mask_masks_each_long_line_of_a_multiline_value(capsys):
    ss.mask("first-line\nab\nthird-line")
    assert capsys.readouterr().out == "::add-mask::first-line\n::add-mask::third-line\n"


def test_resolve_rejects_an_unknown_environment():
    with pytest.raises(ss.SecretError, match="environment must be one of"):
        ss.resolve("dev", ss.DO)


def test_resolve_falls_back_to_legacy_env_and_masks_it(monkeypatch, capsys):
    set_required(monkeypatch, ss.DO)
    values, sources = ss.resolve("staging", ss.DO)
    assert values["JWT_SECRET"] == "value-of-JWT_SECRET"
    assert sources["JWT_SECRET"] == "github"
    assert sources["SLACK_WEBHOOK_URL"] == "absent (optional)"
    assert "::add-mask::value-of-JWT_SECRET" in capsys.readouterr().out


def test_resolve_exits_1_naming_only_the_missing_required_key(monkeypatch, capsys):
    set_required(monkeypatch, ss.DO)
    monkeypatch.delenv("LEGACY_JWT_SECRET")
    with pytest.raises(SystemExit) as exc:
        ss.resolve("staging", ss.DO)
    assert exc.value.code == 1
    assert (
        "::error::JWT_SECRET is in neither SOPS nor the GitHub secrets"
        in capsys.readouterr().out
    )


def test_resolve_writes_the_step_summary(monkeypatch, tmp_path):
    set_required(monkeypatch, ss.DO)
    summary = tmp_path / "summary.md"
    monkeypatch.setenv("GITHUB_STEP_SUMMARY", str(summary))
    ss.resolve("staging", ss.DO)
    text = summary.read_text()
    assert text.startswith("### Secret sources\n")
    assert "- JWT_SECRET: github\n" in text
    assert "value-of-" not in text


def test_quoted_rejects_values_the_env_file_cannot_hold():
    assert ss._quoted("K", "plain") == "K='plain'"
    for bad in ("it's", "a\nb", f"x{ss.DELIM_PREFIX}y"):
        with pytest.raises(ss.SecretError):
            ss._quoted("K", bad)
