from app.trigger import pending
from tests._trigger_helpers import HASH_A, HASH_B, HASH_C, HASH_D, body, rec, write_json

CATALOG = [
    {"id": "c1", "check_hash": HASH_A},
    {"id": "c2", "check_hash": HASH_B},
    {"id": "c3", "check_hash": HASH_C},
]


def flat(*records, env="do-dev"):
    return [{**r, "env": env} for r in records]


def test_pending_excludes_pass_same_hash_env():
    recorded = flat(rec("c1", "PASS", HASH_A), rec("c2", "FAIL", HASH_B))
    assert pending.pending(CATALOG, recorded, "do-dev") == ["c2", "c3"]


def test_pass_in_another_env_does_not_count():
    recorded = flat(rec("c1", "PASS", HASH_A), env="homelab-staging")
    assert pending.pending(CATALOG, recorded, "do-dev") == ["c1", "c2", "c3"]


def test_edited_check_pending_again():
    recorded = flat(rec("c1", "PASS", HASH_A))
    catalog = [{"id": "c1", "check_hash": HASH_D}]
    assert pending.pending(catalog, recorded, "do-dev") == ["c1"]


def test_fail_then_pass_both_retained(tmp_path):
    fail = body(run_id="r1", env="do-dev", records=[rec("c2", "FAIL", HASH_B)])
    ok = body(
        run_id="r2",
        env="do-dev",
        started_at="2026-10-30T04:15:00Z",
        records=[rec("c2", "PASS", HASH_B, "2026-10-30T04:15:00.000Z")],
    )
    for b in (fail, ok):
        write_json(
            tmp_path / "smoke-results" / "do-dev" / f"{b['started_at']}-{b['run_id']}.json", b
        )
    recorded = pending.read_recorded(tmp_path)
    assert [r["outcome"] for r in recorded] == ["FAIL", "PASS"]
    assert all(r["env"] == "do-dev" for r in recorded)
    assert pending.pending(CATALOG[1:2], recorded, "do-dev") == []


def test_trigger_package_is_stdlib_only():
    import ast
    import pathlib
    import sys

    root = pathlib.Path(__file__).resolve().parents[1] / "app" / "trigger"
    for f in root.glob("*.py"):
        for node in ast.walk(ast.parse(f.read_text())):
            mods = []
            if isinstance(node, ast.Import):
                mods = [a.name for a in node.names]
            elif isinstance(node, ast.ImportFrom) and node.module:
                mods = [node.module]
            for m in mods:
                top = m.split(".")[0]
                ok = top in sys.stdlib_module_names or m.startswith("app.trigger")
                assert ok or (top == "jsonschema" and f.name == "record.py"), f"{f.name}: {m}"
