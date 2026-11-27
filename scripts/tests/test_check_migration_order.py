"""Unit tests for scripts/check-migration-order.py against a throwaway repo whose base branch is `main`."""

import subprocess

import pytest
from conftest import SCRIPTS_DIR, load_script

mo = load_script("check-migration-order.py")

CI_WORKFLOW = SCRIPTS_DIR.parent / ".github/workflows/ci.yml"

CFG = "services/xstockstrat-config/migrations"
OTHER = "services/xstockstrat-other/migrations"


def git(repo, *args):
    done = subprocess.run(
        ["git", *args], cwd=repo, check=True, capture_output=True, text=True
    )
    return done.stdout.strip()


def add(repo, rel, text="SELECT 1;\n"):
    path = repo / rel
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text)


def commit(repo, msg):
    git(repo, "add", "-A")
    git(repo, "commit", "-q", "-m", msg)


@pytest.fixture
def repo(tmp_path, monkeypatch):
    git(tmp_path, "init", "-q", "-b", "main")
    for key, value in (
        ("user.email", "t@example.invalid"),
        ("user.name", "t"),
        ("commit.gpgsign", "false"),
    ):
        git(tmp_path, "config", key, value)
    for name in ("023_a", "025_b"):
        add(tmp_path, f"{CFG}/{name}.up.sql")
        add(tmp_path, f"{CFG}/{name}.down.sql")
    for name in ("008_a", "009_b"):
        add(tmp_path, f"{OTHER}/{name}.up.sql")
    commit(tmp_path, "base")
    git(tmp_path, "checkout", "-q", "-b", "work")
    monkeypatch.chdir(tmp_path)
    return tmp_path


def added(repo, *rels):
    for rel in rels:
        add(repo, rel)
    commit(repo, "work")


@pytest.mark.parametrize("argv", [[], ["a", "b", "c"], ["main", "--nope"]])
def test_usage_error_exits_2(argv, capsys):
    assert mo.main(argv) == 2
    assert "usage:" in capsys.readouterr().err


def test_ac2_late_lower_number_is_refused(repo, capsys):
    added(repo, f"{CFG}/024_late_seed.up.sql")
    assert mo.main(["main"]) == 1
    err = capsys.readouterr().err
    assert f"order-gate: {CFG}/024_late_seed.up.sql: version 024" in err
    assert "maximum 025" in err


def test_version_equal_to_the_maximum_is_refused(repo, capsys):
    added(repo, f"{CFG}/025_dup.up.sql")
    assert mo.main(["main"]) == 1
    assert "version 025 is not above" in capsys.readouterr().err


def test_version_above_the_maximum_passes(repo, capsys):
    added(repo, f"{CFG}/026_next.up.sql")
    assert mo.main(["main"]) == 0
    assert "order-gate: ok" in capsys.readouterr().out


def test_stale_branch_compares_against_the_tip_of_base(repo, capsys):
    git(repo, "checkout", "-q", "main")
    added(repo, f"{CFG}/026_x.up.sql")
    git(repo, "checkout", "-q", "work")
    added(repo, f"{CFG}/026_y.up.sql")
    assert mo.main(["main"]) == 1
    assert "maximum 026" in capsys.readouterr().err


def test_renumber_is_refused_as_a_delete(repo, capsys):
    git(repo, "mv", f"{CFG}/025_b.up.sql", f"{CFG}/022_b.up.sql")
    commit(repo, "renumber")
    assert mo.main(["main"]) == 1
    err = capsys.readouterr().err
    assert f"{CFG}/025_b.up.sql: an applied migration was deleted" in err


def test_delete_is_refused(repo, capsys):
    (repo / f"{CFG}/023_a.up.sql").unlink()
    commit(repo, "delete")
    assert mo.main(["main"]) == 1
    assert "was deleted" in capsys.readouterr().err


def test_modify_is_refused(repo, capsys):
    add(repo, f"{CFG}/023_a.up.sql", "SELECT 2;\n")
    commit(repo, "modify")
    assert mo.main(["main"]) == 1
    assert "was modified" in capsys.readouterr().err


def test_two_added_files_sharing_a_version_are_refused(repo, capsys):
    added(repo, f"{CFG}/026_a.up.sql", f"{CFG}/026_b.up.sql")
    assert mo.main(["main"]) == 1
    assert "share version 026" in capsys.readouterr().err


def test_down_files_are_ignored(repo, capsys):
    add(repo, f"{CFG}/025_b.down.sql", "SELECT 2;\n")
    added(repo, f"{CFG}/026_n.down.sql")
    assert mo.main(["main"]) == 0
    assert "order-gate: ok" in capsys.readouterr().out


def test_a_new_service_accepts_any_number(repo, capsys):
    added(repo, "services/xstockstrat-new/migrations/000_schema.up.sql")
    assert mo.main(["main"]) == 0
    assert "order-gate: ok" in capsys.readouterr().out


@pytest.mark.parametrize(("name", "expected"), [("010_c", 0), ("009_c", 1)])
def test_versions_compare_as_decimals(repo, name, expected):
    added(repo, f"{OTHER}/{name}.up.sql")
    assert mo.main(["main"]) == expected


def test_unparseable_name_is_refused(repo, capsys):
    added(repo, f"{CFG}/abc.up.sql")
    assert mo.main(["main"]) == 1
    assert "cannot parse" in capsys.readouterr().err


def test_forbid_new_refuses_any_added_migration(repo, capsys):
    added(repo, f"{CFG}/026_next.up.sql")
    assert mo.main(["main", "--forbid-new"]) == 1
    assert "may not add a migration" in capsys.readouterr().err


def test_forbid_new_passes_with_no_added_migration(repo, capsys):
    add(repo, "README.md", "x\n")
    commit(repo, "docs")
    assert mo.main(["main", "--forbid-new"]) == 0
    assert "order-gate: ok" in capsys.readouterr().out


def test_ci_runs_the_order_gate_and_the_ci_gate_requires_it():
    lines = CI_WORKFLOW.read_text().splitlines()
    for line in (
        "  migration-order-gate:",
        "      - migration-order-gate",
        '          echo "migration-order-gate: ${{ needs.migration-order-gate.result }}"',
        "              - 'scripts/check-migration-order.py'",
        (
            "          FORBID_NEW: ${{ (github.base_ref == 'main' && !(github.head_ref == 'main-dev'"
            " && github.event.pull_request.head.repo.full_name == github.repository))"
            " && '--forbid-new' || '' }}"
        ),
        '          python3 scripts/check-migration-order.py "origin/$BASE_REF" $FORBID_NEW',
    ):
        assert line in lines, line
