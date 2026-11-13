"""Unit tests for scripts/config-wiring-py-reads.py."""

import json
import textwrap

from conftest import load_script

cw = load_script("config-wiring-py-reads.py")

REL = "services/xstockstrat-demo/app/main.py"


def extract(tmp_path, capsys, source, forwarders=(), rel=REL):
    path = tmp_path / rel
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(textwrap.dedent(source))
    cw.main(str(tmp_path), list(forwarders))
    return json.loads(capsys.readouterr().out)


def test_literal_key_with_default(tmp_path, capsys):
    got = extract(tmp_path, capsys, 'x = cfg.get_int("a.b", 5)\n')
    assert got == {
        "reads": [
            {
                "file": REL,
                "line": 1,
                "receiver": "cfg",
                "getter": "get_int",
                "key": "a.b",
                "default": 5,
            }
        ],
        "dynamic": [],
    }


def test_keyword_arguments_and_negative_default(tmp_path, capsys):
    got = extract(tmp_path, capsys, 'x = cfg.get_float(default=-1.5, key="a.b")\n')
    assert got["reads"][0]["key"] == "a.b"
    assert got["reads"][0]["default"] == -1.5


def test_non_literal_default_is_omitted(tmp_path, capsys):
    got = extract(tmp_path, capsys, 'x = cfg.get_str("a.b", other())\n')
    assert "default" not in got["reads"][0]


def test_module_constant_resolves_to_its_key(tmp_path, capsys):
    got = extract(tmp_path, capsys, 'KEY: str = "a.b"\nx = cfg.get_bool(KEY)\n')
    assert got["reads"][0]["key"] == "a.b"


def test_values_get_and_subscript_reads(tmp_path, capsys):
    got = extract(
        tmp_path, capsys, 'a = self.values.get("k.one")\nb = self.values["k.two"]\n'
    )
    assert [(r["key"], r["getter"]) for r in got["reads"]] == [
        ("k.one", "get"),
        ("k.two", "[]"),
    ]


def test_unresolvable_key_is_reported_dynamic_with_its_scope(tmp_path, capsys):
    source = """
    class Loader:
        def read(self, name):
            return cfg.get_str(name)
    """
    got = extract(tmp_path, capsys, source)
    assert got["reads"] == []
    assert got["dynamic"][0]["symbol"] == "Loader.read"
    assert got["dynamic"][0]["dynamic"] is True


def test_forwarder_reports_call_sites_not_its_own_passthrough(tmp_path, capsys):
    source = """
    def read_limit(cfg, key):
        return cfg.get_int(key)

    x = read_limit(cfg, "limits.max")
    """
    forwarders = [{"file": REL, "symbol": "read_limit", "keyArg": 1}]
    got = extract(tmp_path, capsys, source, forwarders)
    assert [(r["key"], r["getter"]) for r in got["reads"]] == [
        ("limits.max", "read_limit")
    ]
    assert got["dynamic"] == []


def test_test_directories_are_skipped(tmp_path, capsys):
    rel = "services/xstockstrat-demo/app/tests/test_x.py"
    got = extract(tmp_path, capsys, 'x = cfg.get_int("a.b")\n', rel=rel)
    assert got == {"reads": [], "dynamic": []}
