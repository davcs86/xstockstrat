"""Unit tests for scripts/homelab-mtls-env.py."""

import pytest
from conftest import load_script

hm = load_script("homelab-mtls-env.py")

PEM = "-----BEGIN X-----\nabc\n-----END X-----\n"


def make_tree(root, leaves=("xstockstrat-trading", "xstockstrat-ui")):
    (root / "_ca").mkdir()
    (root / "_ca" / "ca.pem").write_text(PEM)
    for leaf in leaves:
        (root / leaf).mkdir()
        (root / leaf / "cert.pem").write_text(PEM)
        (root / leaf / "key.pem").write_text(PEM)


def test_quote_pem_escapes_newlines_and_normalises_line_endings():
    assert hm.quote_pem("a\r\nb\n\n", "x") == '"a\\nb\\n"'


@pytest.mark.parametrize("bad", ['a"b', "a$b", "a\\b"])
def test_quote_pem_rejects_characters_dotenv_reinterprets(bad):
    with pytest.raises(SystemExit) as exc:
        hm.quote_pem(bad, "LABEL")
    assert "LABEL" in str(exc.value)


def test_main_prints_ca_then_sorted_leaves_then_db_ca(tmp_path, monkeypatch, capsys):
    make_tree(tmp_path)
    monkeypatch.setenv("CERTS_DIR", str(tmp_path))
    monkeypatch.setenv("DB_CA_CERT", PEM)
    hm.main()
    lines = capsys.readouterr().out.splitlines()
    assert [line.split("=", 1)[0] for line in lines] == [
        "MTLS_CA_CERT",
        "TRADING_MTLS_CERT",
        "TRADING_MTLS_KEY",
        "UI_MTLS_CERT",
        "UI_MTLS_KEY",
        "DATABASE_CA_CERT",
    ]
    quoted = '"' + PEM.replace("\n", "\\n") + '"'
    assert all(line.split("=", 1)[1] == quoted for line in lines)


def test_main_requires_certs_dir(monkeypatch):
    monkeypatch.delenv("CERTS_DIR", raising=False)
    with pytest.raises(SystemExit, match="CERTS_DIR is required"):
        hm.main()


def test_main_requires_db_ca_cert(tmp_path, monkeypatch):
    make_tree(tmp_path)
    monkeypatch.setenv("CERTS_DIR", str(tmp_path))
    monkeypatch.delenv("DB_CA_CERT", raising=False)
    with pytest.raises(SystemExit, match="DB_CA_CERT is required"):
        hm.main()


def test_main_fails_without_leaves(tmp_path, monkeypatch):
    make_tree(tmp_path, leaves=())
    monkeypatch.setenv("CERTS_DIR", str(tmp_path))
    with pytest.raises(SystemExit, match="no xstockstrat-\\* leaves"):
        hm.main()


def test_main_names_missing_files(tmp_path, monkeypatch):
    make_tree(tmp_path)
    (tmp_path / "xstockstrat-ui" / "key.pem").unlink()
    monkeypatch.setenv("CERTS_DIR", str(tmp_path))
    with pytest.raises(SystemExit) as exc:
        hm.main()
    assert "xstockstrat-ui" in str(exc.value) and "key.pem" in str(exc.value)
