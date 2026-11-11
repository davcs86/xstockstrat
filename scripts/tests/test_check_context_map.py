"""Unit tests for scripts/check-context-map.py."""

from conftest import load_script

cm = load_script("check-context-map.py")


def write(root, rel, text=""):
    path = root / rel
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text)


def tree(root, map_text="", **files):
    write(root, cm.MAP, map_text)
    for rel, text in files.items():
        write(root, rel, text)


def test_missing_map_fails(tmp_path, capsys):
    assert cm.main(str(tmp_path)) == 1
    assert capsys.readouterr().out == f"MISSING: {cm.MAP}\n"


def test_all_references_resolve(tmp_path, capsys):
    tree(
        tmp_path,
        "path: docs/a.md\nhelper: scripts/tool.py\ntests: scripts/t.test.mjs\n",
        **{
            "docs/a.md": "",
            "scripts/tool.py": "",
            "scripts/t.test.mjs": "",
            "CLAUDE.md": "see docs/a.md",
        },
    )
    assert cm.main(str(tmp_path)) == 0
    assert (
        capsys.readouterr().out == "OK - all context-map and doc references resolve.\n"
    )


def test_missing_map_path_is_reported(tmp_path, capsys):
    tree(tmp_path, "path: docs/gone.md\nhelper: scripts/gone.py\n")
    assert cm.main(str(tmp_path)) == 1
    out = capsys.readouterr().out
    assert "  MISSING: docs/gone.md\n" in out
    assert "  MISSING: scripts/gone.py\n" in out
    assert out.endswith(
        "FAILED - fix the MISSING references above (or mark them as placeholders).\n"
    )


def test_stale_reference_in_each_scanned_source_kind(tmp_path):
    sources = {
        "services/x/CLAUDE.md": "docs/from-claude.md",
        ".claude/skills/s/SKILL.md": "docs/from-skill.md",
        ".claude/skills/s/reference/r.md": ".claude/from-reference.md",
        ".claude/agents/a.md": "docs/from-agent.md",
    }
    tree(tmp_path, **sources)
    assert cm.missing(str(tmp_path)) == sorted(sources.values())


def test_unscanned_files_are_ignored(tmp_path):
    tree(
        tmp_path,
        **{
            "docs/other.md": "docs/gone.md",
            ".claude/skills/s/notes.md": "docs/gone.md",
            "node_modules/pkg/CLAUDE.md": "docs/gone.md",
        },
    )
    assert cm.missing(str(tmp_path)) == []


def test_urls_are_stripped_before_matching(tmp_path):
    tree(
        tmp_path,
        **{
            "CLAUDE.md": "[x](https://github.com/o/r/blob/main/docs/remote.md) and docs/local.md"
        },
    )
    assert cm.missing(str(tmp_path)) == ["docs/local.md"]


def test_placeholders_are_skipped(tmp_path):
    text = "docs/features/<slug>/x.md docs/path/to/x.md docs/exact/x.md docs/.../x.md\n"
    tree(tmp_path, "path: docs/<NNN-slug>/context.md\n", **{"CLAUDE.md": text})
    assert cm.missing(str(tmp_path)) == []
