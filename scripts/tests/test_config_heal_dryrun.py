"""Unit tests for scripts/config-heal-dryrun.py; the database path is covered by the CI freshness job."""

import pytest
from conftest import load_script

hd = load_script("config-heal-dryrun.py")


@pytest.mark.parametrize(
    ("argv", "expected"),
    [
        (["--fresh"], ("fresh", None, None)),
        (["--staging", "inv.jsonl"], ("staging", "inv.jsonl", None)),
        (
            ["--staging", "inv.jsonl", "--reveal", "rev.jsonl"],
            ("staging", "inv.jsonl", "rev.jsonl"),
        ),
        (
            ["--reveal", "rev.jsonl", "--staging", "inv.jsonl"],
            ("staging", "inv.jsonl", "rev.jsonl"),
        ),
    ],
)
def test_parse_args(argv, expected):
    assert hd.parse_args(argv) == expected


@pytest.mark.parametrize(
    "argv", [[], ["--staging"], ["--reveal"], ["--fresh", "--reveal", "x"], ["--bogus"]]
)
def test_parse_args_rejects(argv):
    with pytest.raises(hd.Usage):
        hd.parse_args(argv)


def test_main_usage_error_exits_2(capsys):
    assert hd.main(["--bogus"]) == 2
    assert capsys.readouterr().err == hd.USAGE + "\n"


def test_main_missing_inventory_exits_2_before_needing_a_database(
    monkeypatch, capsys, tmp_path
):
    monkeypatch.delenv("DATABASE_URL", raising=False)
    assert hd.main(["--staging", str(tmp_path / "nope.jsonl")]) == 2
    assert "inventory not found" in capsys.readouterr().err


def test_main_missing_reveal_file_exits_2(capsys, tmp_path):
    inventory = tmp_path / "inv.jsonl"
    inventory.touch()
    assert (
        hd.main(["--staging", str(inventory), "--reveal", str(tmp_path / "nope.jsonl")])
        == 2
    )
    assert "reveal file not found" in capsys.readouterr().err


def test_strip_fixture_tuples_only_touches_041(tmp_path):
    body = "  ('a', 'b'),\n  ('x', 'y'), -- fixture\n  ('c', 'd') -- fixture  \nSELECT 1; -- fixture note\n"
    for name in ("041_heal.up.sql", "042_next.up.sql"):
        (tmp_path / name).write_text(body)
    hd.strip_fixture_tuples(str(tmp_path))
    assert (
        tmp_path / "041_heal.up.sql"
    ).read_text() == "  ('a', 'b'),\nSELECT 1; -- fixture note\n"
    assert (tmp_path / "042_next.up.sql").read_text() == body


def test_report_sorts_rows_in_byte_order_under_the_header():
    content, count = hd.report(b"retyped\tb\nZ-upper\ta\ndefault-synced\tc\n")
    assert count == 3
    assert content == hd.HEADER + b"Z-upper\ta\ndefault-synced\tc\nretyped\tb\n"


def test_report_of_no_rows_is_the_header():
    assert hd.report(b"") == (hd.HEADER, 0)
