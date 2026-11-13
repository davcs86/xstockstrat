"""Unit tests for scripts/check-watcher-copies.py."""

from conftest import SCRIPTS_DIR, load_script

wc = load_script("check-watcher-copies.py")


def populate(root, overrides=None):
    for paths in wc.COPIES.values():
        for path in paths:
            target = root / path
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes((overrides or {}).get(path, b"same\n"))


def test_identical_copies_pass(tmp_path, capsys):
    populate(tmp_path)
    assert wc.main([str(tmp_path)]) == 0
    assert (
        capsys.readouterr().out == "check-watcher-copies: all groups byte-identical\n"
    )


def test_a_differing_copy_names_itself_and_the_reference(tmp_path, capsys):
    odd = wc.COPIES["py"][2]
    populate(tmp_path, {odd: b"same\n\n"})
    assert wc.main([str(tmp_path)]) == 1
    captured = capsys.readouterr()
    assert captured.out == ""
    assert (
        captured.err
        == f"check-watcher-copies: group py: {odd} differs from {wc.COPIES['py'][0]}\n"
    )


def test_a_missing_copy_fails_and_the_rest_are_still_compared(tmp_path, capsys):
    populate(tmp_path, {wc.COPIES["go"][2]: b"drift\n"})
    (tmp_path / wc.COPIES["go"][0]).unlink()
    assert wc.main([str(tmp_path)]) == 1
    err = capsys.readouterr().err
    assert f"group go: missing {wc.COPIES['go'][0]}" in err
    assert f"group go: {wc.COPIES['go'][2]} differs from {wc.COPIES['go'][1]}" in err


def test_groups_are_independent(tmp_path):
    populate(tmp_path, {p: b"node flavour\n" for p in wc.COPIES["node"]})
    assert wc.problems(str(tmp_path)) == []


def test_the_real_tree_is_clean():
    assert wc.problems(str(SCRIPTS_DIR.parent)) == []
