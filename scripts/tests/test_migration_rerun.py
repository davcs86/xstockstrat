"""Unit tests for scripts/migration-rerun.py; the database path is covered by the CI migration-rerun job."""

import subprocess

import pytest
from conftest import load_script

mr = load_script("migration-rerun.py")

CONTRACT = (
    "-- contract-of: services/xstockstrat-config/migrations/040_config_markers.up.sql\n"
)
R_BODY = (
    CONTRACT
    + "-- allow_296:begin\nVALUES\n  ('a', 'b', 'staging', NULL, 'x'),\n\t('c', 'd', 'staging', NULL, 'y')\n"
    + "-- allow_296:end\nSELECT ('not', 'a tuple line');\n"
)
D_BODY = (
    "DELETE FROM t USING\n-- dead_rows_305:begin\n(VALUES\n  ('ns', 'k1', 'staging', 'sha1'),\n"
    "  ('ns', 'k2', 'production', 'sha2')\n) AS dead_rows_305(namespace, key, environment, value_sha256)\n"
    "-- dead_rows_305:end\nWHERE true;\n"
)
A_BODY = (
    "-- alias_removal_306:begin\n(VALUES\n  ('platform', 'log_level')\n) AS alias_removal_306(namespace, key)\n"
    "-- alias_removal_306:end\n"
)


@pytest.fixture
def cfg_dir(tmp_path):
    files = {
        "040_config_markers.up.sql": "SELECT 1;\n",
        "044_config_relative_keys.up.sql": R_BODY,
        "045_config_key_check.up.sql": "SELECT 1;\n",
        "046_config_dead_rows_prune.up.sql": D_BODY,
        "047_config_alias_removal_rows.up.sql": A_BODY,
    }
    for name, body in files.items():
        (tmp_path / name).write_text(body)
    return tmp_path


def test_service_db_url_appends_to_an_existing_query_string():
    assert (
        mr.service_db_url("postgres://h/db?sslmode=disable", "config")
        == "postgres://h/db?sslmode=disable&x-migrations-table=config_schema_migrations"
    )


def test_service_db_url_starts_a_query_string():
    assert (
        mr.service_db_url("postgres://h/db", "ingest")
        == "postgres://h/db?x-migrations-table=ingest_schema_migrations"
    )


def test_discover(cfg_dir):
    p = mr.discover(str(cfg_dir))
    assert (p.r, p.cfg_pre, p.r1, p.cfg_top) == (44, 43, 45, 47)
    assert p.r_file == str(cfg_dir / "044_config_relative_keys.up.sql")
    assert (p.r_base, p.r1_base) == ("044_config_relative_keys", "045_config_key_check")
    assert p.r_actor == "system:config-migration-044"
    assert p.r1_actor == "system:config-migration-045"
    assert p.allow_tuples == 2
    assert (p.d_base, p.d_tuples) == ("046_config_dead_rows_prune", 2)
    assert p.d_block == (
        "(VALUES\n  ('ns', 'k1', 'staging', 'sha1'),\n  ('ns', 'k2', 'production', 'sha2')\n"
        ") AS dead_rows_305(namespace, key, environment, value_sha256)"
    )
    assert (p.a_base, p.a_pairs) == ("047_config_alias_removal_rows", 1)
    assert (
        p.a_block
        == "(VALUES\n  ('platform', 'log_level')\n) AS alias_removal_306(namespace, key)"
    )


def test_discover_ignores_a_contract_marker_below_the_first_five_lines(cfg_dir):
    (cfg_dir / "048_late.up.sql").write_text("\n" * 5 + CONTRACT)
    assert mr.discover(str(cfg_dir)).r == 44


def discover_error(cfg_dir, capsys):
    with pytest.raises(SystemExit) as exit_info:
        mr.discover(str(cfg_dir))
    assert exit_info.value.code == 1
    return capsys.readouterr().err


def test_discover_without_a_contract_migration(cfg_dir, capsys):
    (cfg_dir / "044_config_relative_keys.up.sql").write_text("SELECT 1;\n")
    assert discover_error(cfg_dir, capsys) == (
        "migration-rerun: expected exactly one config migration with contract-of 040_config_markers, found 0\n"
    )


def test_discover_with_two_contract_migrations(cfg_dir, capsys):
    (cfg_dir / "045_config_key_check.up.sql").write_text(CONTRACT)
    assert discover_error(cfg_dir, capsys) == (
        "migration-rerun: expected exactly one config migration with contract-of 040_config_markers, found 2\n"
    )


def test_discover_without_the_check_migration(cfg_dir, capsys):
    (cfg_dir / "045_config_key_check.up.sql").unlink()
    assert discover_error(cfg_dir, capsys) == (
        "migration-rerun: the CHECK migration 045_* after 044_config_relative_keys is missing\n"
    )


@pytest.mark.parametrize(
    ("slug", "found"),
    [("config_dead_rows_prune", 0), ("config_dead_rows_prune", 2)]
    + [("config_alias_removal_rows", 0), ("config_alias_removal_rows", 2)],
)
def test_discover_needs_exactly_one_slug_migration(cfg_dir, capsys, slug, found):
    if found == 0:
        next(cfg_dir.glob(f"*_{slug}.up.sql")).unlink()
    else:
        (cfg_dir / f"099_{slug}.up.sql").write_text("SELECT 1;\n")
    assert discover_error(cfg_dir, capsys) == (
        f"migration-rerun: expected exactly one *_{slug}.up.sql, found {found}\n"
    )


def test_marked_lines_includes_both_markers_and_runs_to_eof_without_an_end():
    text = "a\n-- x:begin\nb\n-- x:end\nc\n-- x:begin\nd\n"
    assert mr.marked_lines(text, "x:begin", "x:end") == [
        "-- x:begin",
        "b",
        "-- x:end",
        "-- x:begin",
        "d",
    ]
    assert mr.marked_lines("a\nb\n", "x:begin", "x:end") == []


def test_count_tuples_counts_only_lines_opening_a_quoted_tuple():
    lines = ["  ('a', 1),", "\t('b', 2)", "('c', 3)", "VALUES ('d', 4)", "  (1, 2)", ""]
    assert mr.count_tuples(lines) == 3


def test_block_body_of_an_empty_or_absent_block_is_empty():
    assert mr.block_body("-- m:begin\n-- m:end\n", "m") == ""
    assert mr.block_body("SELECT 1;\n", "m") == ""
    assert mr.count_tuples([""]) == 0


def test_render_seed_substitutes_only_the_seed_variable():
    sql = b"'${SEED_USER_ID}' $SEED_USER_ID. $SEED_USER_ID_X ${SEED_USER_ID_X} ${SEED_USER_ID $OTHER ${OTHER}"
    assert mr.render_seed(sql, b"u-1") == (
        b"'u-1' u-1. $SEED_USER_ID_X ${SEED_USER_ID_X} ${SEED_USER_ID $OTHER ${OTHER}"
    )


def test_render_seed_takes_the_seed_literally():
    assert mr.render_seed(b"${SEED_USER_ID}", rb"a\1b") == rb"a\1b"


def test_signed_copy_replaces_the_allow_block_body():
    assert mr.signed_copy(R_BODY, ["VALUES", "  ('s', 't')"]) == (
        CONTRACT
        + "-- allow_296:begin\nVALUES\n  ('s', 't')\n-- allow_296:end\nSELECT ('not', 'a tuple line');\n"
    )


def test_sha_of():
    assert mr.sha_of(5000) == "encode(sha256(convert_to('5000', 'UTF8')), 'hex')"


def test_split_assertions():
    names = [
        "analysis-026.sql",
        "config-031.sql",
        "config-043.sql",
        "config-044.sql",
        "config-heal.sql",
        "fixtures-pre-224.sql",
        "ingest-014.sql",
    ]
    assert mr.split_assertions(names, 44) == (
        ["config-031.sql", "config-043.sql"],
        ["analysis-026.sql", "config-044.sql", "config-heal.sql", "ingest-014.sql"],
    )


FORMULAS = '''_OTHER = 1
_INSERT_SQL = """
INSERT INTO f (a, b) VALUES ($1, $2)
ON CONFLICT DO UPDATE SET c = $13, d = $9
"""
_NO_PARAMS_SQL = """
SELECT 1
"""
'''


@pytest.fixture
def formulas(tmp_path):
    path = tmp_path / "formulas_repository.py"
    path.write_text(FORMULAS)
    return str(path)


def test_repo_sql_returns_the_constant_body(formulas):
    assert mr.repo_sql("_INSERT_SQL", formulas) == (
        "INSERT INTO f (a, b) VALUES ($1, $2)\nON CONFLICT DO UPDATE SET c = $13, d = $9"
    )
    assert mr.repo_sql("_MISSING_SQL", formulas) == ""


def test_max_param_is_numeric_not_lexical():
    assert mr.max_param("$1 $13 $9 $2") == "13"
    assert mr.max_param("SELECT 1") == ""


def test_check_params_accepts_the_supplied_count(formulas):
    mr.check_params("_INSERT_SQL", 13, formulas)


def test_check_params_rejects_a_different_count(formulas, capsys):
    with pytest.raises(SystemExit) as exit_info:
        mr.check_params("_INSERT_SQL", 12, formulas)
    assert exit_info.value.code == 1
    assert capsys.readouterr().err == (
        "migration-rerun: AC-11: _INSERT_SQL has 13 params, harness supplies 12\n"
    )


def test_check_params_rejects_a_missing_constant(formulas, capsys):
    with pytest.raises(SystemExit) as exit_info:
        mr.check_params("_UPDATE_SQL", 8, formulas)
    assert exit_info.value.code == 1
    assert capsys.readouterr().err == (
        f"migration-rerun: AC-11: _UPDATE_SQL not found in {formulas}\n"
    )


def test_line_of_is_the_first_matching_line_number():
    out = "error: x\n  secret-class-twin marketdata/fmp.api_key/staging\n  secret-class-twin again\n"
    assert mr.line_of(out, "secret-class-twin") == 2
    assert mr.line_of(out, "absent") is None


def test_top_migration(tmp_path):
    for name in (
        "000_init.up.sql",
        "007_bars.up.sql",
        "012_news.up.sql",
        "012_news.down.sql",
        "notes.up.sql",
    ):
        (tmp_path / name).touch()
    assert mr.top_migration(str(tmp_path)) == (12, "012_news")


def test_top_migration_without_one_above_000(tmp_path):
    (tmp_path / "000_init.up.sql").touch()
    assert mr.top_migration(str(tmp_path)) == (0, "")


def test_must_contain(capsys):
    mr.must_contain("a\nforce 40\n", "force 40", "AC-28 (c)")
    with pytest.raises(SystemExit) as exit_info:
        mr.must_contain("a\nb\n", "force 40", "AC-28 (c)")
    assert exit_info.value.code == 1
    assert capsys.readouterr().err == (
        "migration-rerun: AC-28 (c): output lacks 'force 40':\na\nb\n"
    )


@pytest.mark.parametrize("version", ["43 (dirty)", "43 (dirty)\nextra"])
def test_must_be_dirty_accepts(monkeypatch, version):
    monkeypatch.setattr(mr, "mig_version", lambda schema: version)
    mr.must_be_dirty("config", 43)


@pytest.mark.parametrize("version", ["43", "143 (dirty)", "error: no migration"])
def test_must_be_dirty_rejects(monkeypatch, capsys, version):
    monkeypatch.setattr(mr, "mig_version", lambda schema: version)
    with pytest.raises(SystemExit) as exit_info:
        mr.must_be_dirty("config", 43)
    assert exit_info.value.code == 1
    assert capsys.readouterr().err == (
        f"migration-rerun: config should be dirty at 43, got: {version}\n"
    )


def test_must_be_clean(monkeypatch, capsys):
    monkeypatch.setattr(mr, "mig_version", lambda schema: "43")
    mr.must_be_clean("config", 43)
    monkeypatch.setattr(mr, "mig_version", lambda schema: "43 (dirty)")
    with pytest.raises(SystemExit) as exit_info:
        mr.must_be_clean("config", 43)
    assert exit_info.value.code == 1
    assert capsys.readouterr().err == (
        "migration-rerun: config should be clean at 43, got: 43 (dirty)\n"
    )


def test_call_exits_with_the_status_of_a_failing_command():
    mr.call(["sh", "-c", "exit 0"])
    with pytest.raises(SystemExit) as exit_info:
        mr.call(["sh", "-c", "exit 3"])
    assert exit_info.value.code == 3


def test_captured_returns_status_and_both_streams():
    assert mr.captured(["sh", "-c", "echo out; echo err >&2; exit 4"]) == (
        4,
        "out\nerr\n",
    )


def test_exit_status_of_a_signalled_command_is_128_plus_the_signal():
    done = subprocess.run(["sh", "-c", "kill -TERM $$"], check=False)
    assert mr.exit_status(done) == 143


@pytest.mark.parametrize(
    ("env", "missing"),
    [
        ({}, "DATABASE_URL"),
        ({"SEED_USER_ID": "u"}, "DATABASE_URL"),
        ({"DATABASE_URL": "", "SEED_USER_ID": "u"}, "DATABASE_URL"),
        ({"DATABASE_URL": "postgres://h/db"}, "SEED_USER_ID"),
    ],
)
def test_main_needs_both_variables_before_running_anything(
    monkeypatch, capsys, env, missing
):
    for name in ("DATABASE_URL", "SEED_USER_ID"):
        monkeypatch.delenv(name, raising=False)
    for name, value in env.items():
        monkeypatch.setenv(name, value)

    def no_commands(*args, **kwargs):
        raise AssertionError("a command ran")

    monkeypatch.setattr(subprocess, "run", no_commands)
    monkeypatch.setattr(subprocess, "Popen", no_commands)
    monkeypatch.setattr(mr, "discover", no_commands)
    assert mr.main() == 1
    assert capsys.readouterr().err == f"migration-rerun: {missing} is required\n"
